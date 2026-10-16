import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerSyntxOwnerKling4Tools, OWNER_KLING4_TOOL_NAMES } from "../src/mcp/owner-kling4-tools.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { getOwnerKling4SourceProfile } from "../src/application/owner-kling4-parameters.js";

const ATTEMPT = "link_kling4_generation_2148_0123456789abcdef";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "kling4-generation-2148", subject: "synthetic-owner" });
const KEYFRAMES = "kling_4_keyframes" as const;
const OMNI = "kling_4_omni" as const;
const OUTPUT_URL = "https://r2.syntx.ai/kling4-generation-2148/output/result.mp4";
const BASE_NOW = Date.parse("2026-10-17T00:00:00.000Z");
let serial = 0;

type ModelId = typeof KEYFRAMES | typeof OMNI;
type Context = Record<string, any>;
interface Api {
  readonly OwnerKling4GenerationService: new (options: unknown) => Context;
  readonly OwnerKling4GenerationServiceError: new (code: string) => Error & { readonly code: string; readonly recovery_id?: string };
  readonly OwnerKling4ReferenceService: new (options: unknown) => Context;
  createOwnerKling4RequestPreparer(options: unknown): Context;
}
interface TestRuntime {
  readonly api: Api;
  readonly service: Context;
  readonly referenceService: Context;
  readonly counts: { uploads: number; chats: number; gens: number; history: number; results: number; quotes: number; balances: number; subs: number };
  readonly quoteParameters: Readonly<Record<string, string>>[];
  readonly handles: readonly string[];
  readonly modelId: ModelId;
  readonly prompt: string;
  advance(ms: number): void;
  setHistoryReady(ready: boolean): void;
  close(): Promise<void>;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length); out.write(name, 4); data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(300); header.writeUInt32BE(300, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(300 * 1201))), chunk("IEND", Buffer.alloc(0))]);
}

function mp4(): Uint8Array {
  const b = new Uint8Array(28), v = new DataView(b.buffer);
  v.setUint32(0, 20); b.set(new TextEncoder().encode("ftypisom"), 4); b.set(new TextEncoder().encode("mp41"), 16);
  v.setUint32(20, 8); b.set(new TextEncoder().encode("mdat"), 24); return b;
}

async function ffprobeFixture(): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-k4-generation-2148-"));
  const binary = join(directory, "ffprobe-fixture");
  const result = JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 700, height: 700,
    start_time: "0.000000", duration: "4.250000", disposition: { attached_pic: 0 } }],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "4.250000" } });
  await writeFile(binary, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(result)});\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700); return { directory, binary: await realpath(binary) };
}

function expectedWire(modelId: ModelId) {
  return { model_type: modelId, version: "4.0", mode: "hd", aspect_ratio: "21:9", video_duration: 8,
    native_audio: modelId === KEYFRAMES, file_urls: modelId === KEYFRAMES ? [{ type: "image", url: "https://r2.syntx.ai/kling4-generation-2148/ref.png" }]
      : [{ type: "video", url: "https://r2.syntx.ai/kling4-generation-2148/ref.mp4" }] };
}

async function createRuntime(modelId: ModelId, overrides: { free?: boolean; lowBalance?: boolean; loseAck?: boolean; skipInitialUpload?: boolean;
  staleSecondQuote?: boolean; initiallyPending?: boolean } = {}): Promise<TestRuntime> {
  const [generationApi, referenceApi, preparerApi, native] = await Promise.all([
    import(new URL("../src/application/owner-kling4-generation-service.js", import.meta.url).href),
    import(new URL("../src/application/owner-kling4-reference-service.js", import.meta.url).href),
    import(new URL("../src/application/owner-kling4-request-preparer.js", import.meta.url).href),
    import(new URL("../src/adapter/syntx/owner-kling4-native-context.js", import.meta.url).href)
  ]);
  const api = { ...generationApi, ...referenceApi, ...preparerApi } as unknown as Api;
  assert.ok(api.OwnerKling4GenerationService, "K4 generation facade must be importable");
  assert.ok(native.readOwnerKling4NativeDispatchStatus, "K4 native result binding must be available");
  let time = BASE_NOW + ++serial;
  const prompt = `Create a calm scene from [[ref:1]]. Case ${serial}.`;
  const now = () => time;
  const advance = (ms: number) => { time += ms; };
  const profile = getOwnerKling4SourceProfile(modelId);
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(profile.source_catalog_version, resolve(process.cwd(), "catalog")));
  const linksProvider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-k4-generation-2148", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-k4-generation-test-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(linksProvider, new InMemoryAuthLinkStore(now), { now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const counts = { uploads: 0, chats: 0, gens: 0, history: 0, results: 0, quotes: 0, balances: 0, subs: 0 };
  const quoteParameters: Readonly<Record<string, string>>[] = [];
  const chat = "88148";
  const ownerMessage = "k4-generation-owner-2148";
  const botMessage = "k4-generation-bot-2148";
  const objectId = "k4-generation-video-object-2148";
  let dispatchedPrompt = "";
  let historyReady = !overrides.initiallyPending;
  let probe: { directory: string; binary: string } | undefined;

  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    if (url.origin === "https://api.syntx.ai" && url.pathname === "/api/v1/user/balance") {
      counts.balances += 1; return json({ balance: overrides.lowBalance ? "0.09" : "10.00" });
    }
    if (url.origin === "https://api.syntx.ai" && url.pathname === "/api/v1/user/subscription") {
      counts.subs += 1; return json({ active: true, type: overrides.free ? "FREE" : "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    }
    if (url.origin === "https://api.syntx.ai" && url.pathname === "/api/v2/get_model_info") {
      counts.quotes += 1;
      quoteParameters.push(Object.freeze(Object.fromEntries([...url.searchParams.entries()].filter(([key]) => !["ai_name", "model_type"].includes(key)))));
      return json({ access: true, cost: overrides.staleSecondQuote && counts.quotes === 2 ? null : 0.1,
        discount_cost: null, free_remaining_generations: 100, limit: null, show_warning: false });
    }
    if (url.origin !== "https://api.syntx.ai") throw new Error("unexpected origin");
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      counts.uploads += 1;
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
      assert.equal(form.get("model_type"), modelId);
      return json({ files: [{ id: `k4-generation-upload-${counts.uploads}`,
        url: modelId === KEYFRAMES ? "https://r2.syntx.ai/kling4-generation-2148/ref.png" : "https://r2.syntx.ai/kling4-generation-2148/ref.mp4",
        mime_type: file.type, size: file.size, status: "uploaded" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1; return json({ uuid: chat });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      counts.gens += 1; assert.equal(url.search, "?ai_name=kling");
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: unknown };
      assert.equal(body.chat_id, chat); assert.deepEqual(body.settings, expectedWire(modelId)); dispatchedPrompt = body.prompt;
      if (overrides.loseAck) throw new Error("synthetic lost acknowledgement");
      return json({ id: ownerMessage });
    }
    if (url.pathname === `/api/v1/chats/${chat}/messages` && method === "GET") {
      counts.history += 1;
      const messages: unknown[] = [{ id: ownerMessage, chat_id: chat, author_id: 17, message_object: [
          { id: "k4-generation-owner-text-2148", message_id: ownerMessage, object_type: "text", object_text: dispatchedPrompt },
          ...(modelId === KEYFRAMES ? [{ id: "k4-generation-owner-input-2148", message_id: ownerMessage, object_type: "image",
            object_url: "https://r2.syntx.ai/kling4-generation-2148/ref.png", model_type: modelId }] : [{ id: "k4-generation-owner-input-2148",
            message_id: ownerMessage, object_type: "video", object_url: "https://r2.syntx.ai/kling4-generation-2148/ref.mp4", model_type: modelId }])
        ] }];
      if (historyReady) messages.push({ id: botMessage, chat_id: chat, author_id: -1, message_object: [{ id: objectId, message_id: botMessage,
          object_type: "video", model_type: modelId, completed: true, object_url: OUTPUT_URL }] }
      );
      return json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1,
        has_next: false, has_previous: false } });
    }
    if (url.pathname === `/api/v1/chats/${chat}/${botMessage}` && method === "GET") {
      counts.results += 1;
      return json({ id: botMessage, chat_id: chat, author_id: -1, message_object: [{ id: objectId, message_id: botMessage,
        object_type: "video", model_type: modelId, completed: true, object_url: OUTPUT_URL }] });
    }
    throw new Error(`unexpected synthetic request ${method} ${url.pathname}`);
  };
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return links.useCredential(BINDING, ATTEMPT, credential => operation(credential.value));
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl, requestTimeoutMs: 1_000 });
  const newHttpClient = () => new SyntxHttpClient({ credentialBroker: broker, fetchImpl, requestTimeoutMs: 1_000 });
  if (modelId === OMNI) probe = await ffprobeFixture();
  const store = new api.OwnerKling4ReferenceService({ binding: BINDING, linkService: links, resolveClient: () => chatClient,
    ffprobePath: probe?.binary ?? process.execPath, now });
  const preparer = api.createOwnerKling4RequestPreparer({ referenceService: store, now });
  let generation: Context | undefined;
  try {
    const filename = modelId === KEYFRAMES ? "ref.png" : "ref.mp4";
    const mime = modelId === KEYFRAMES ? "image/png" : "video/mp4";
    const bytes = modelId === KEYFRAMES ? png() : mp4();
    const uploaded = overrides.skipInitialUpload ? undefined : await store.uploadReference({ attemptId: ATTEMPT, model_id: modelId, filename, mime_type: mime, bytes });
    const createAccountStatusService = () => new AccountStatusService(newHttpClient(), now);
    const createModelAccessService = () => new ModelAccessService(catalog, newHttpClient(), now);
    const catalogVersion = profile.source_catalog_version;
    generation = new api.OwnerKling4GenerationService({ binding: BINDING, linkService: links, catalog, catalog_version: catalogVersion,
      preparer, referenceService: store, resolveChatClient: () => chatClient, createAccountStatusService,
      createModelAccessService, resolveSubscription: (_attemptId: string, signal?: AbortSignal) => newHttpClient().getSubscription(signal), now });
    return { api, service: generation, referenceService: store, counts, quoteParameters, handles: uploaded ? [uploaded.reference_handle] : [], modelId, prompt, advance,
      setHistoryReady(ready) { historyReady = ready; },
      async close() { await generation?.close(); await preparer.close(); await store.close(); if (probe) await rm(probe.directory, { recursive: true, force: true }); } };
  } catch (error) {
    await generation?.close(); await preparer.close(); await store.close(); if (probe) await rm(probe.directory, { recursive: true, force: true }); throw error;
  }
}

function input(model_id: ModelId, reference_handles: readonly string[], prompt: string, attemptId = ATTEMPT) {
  return { attemptId, model_id, prompt, version: "4.0", mode: "hd",
    aspect_ratio: "21:9", video_duration: 8, native_audio: model_id === KEYFRAMES, reference_handles: [...reference_handles] };
}

test("dispatches the exact profile-bound K4 wire and current selected-file quote for both model IDs", async () => {
  for (const modelId of [KEYFRAMES, OMNI] as const) {
    const runtime = await createRuntime(modelId);
    try {
      const result = await runtime.service.generate(input(modelId, runtime.handles, runtime.prompt));
      assert.equal(result.status, "completed"); assert.equal(result.model_id, modelId);
      assert.equal(result.cost_cap_enforced, false); assert.equal(result.provider_terminal_status, "UNPROVEN");
      assert.equal(result.source_binding.profile_sha256, getOwnerKling4SourceProfile(modelId).source_sha256);
      assert.equal(result.source_binding.public_catalog_version, getOwnerKling4SourceProfile(modelId).source_catalog_version);
      assert.match(result.recovery_id, /^kling4_recovery_[0-9a-f-]{36}$/u);
      assert.equal(runtime.counts.chats, 1); assert.equal(runtime.counts.gens, 1);
      assert.equal(runtime.counts.quotes, 2); assert.equal(runtime.counts.balances, 2);
      assert.equal(runtime.quoteParameters[0]?.video_duration, "8");
      assert.equal(runtime.quoteParameters[0]?.version, "4.0");
      assert.equal(runtime.quoteParameters[0]?.mode, "hd");
      assert.equal(runtime.quoteParameters[0]?.duration, modelId === OMNI ? "4.25" : undefined);
    } finally { await runtime.close(); }
  }
});

test("paid-plan, quote and balance gates fail closed before any K4 chat or GEN", async () => {
  for (const patch of [{ free: true }, { lowBalance: true }, { staleSecondQuote: true }] as const) {
    const runtime = await createRuntime(KEYFRAMES, patch);
    try {
      await assert.rejects(runtime.service.generate(input(KEYFRAMES, runtime.handles, runtime.prompt)));
      assert.equal(runtime.counts.chats, "staleSecondQuote" in patch ? 1 : 0); assert.equal(runtime.counts.gens, 0);
    } finally { await runtime.close(); }
  }
});

test("lost K4 GEN acknowledgment remains unknown and never dispatches a second GEN", async () => {
  const runtime = await createRuntime(OMNI, { loseAck: true });
  try {
    let recoveryId = "";
    await assert.rejects(runtime.service.generate(input(OMNI, runtime.handles, runtime.prompt)), (error: unknown) => {
      assert.ok(error instanceof runtime.api.OwnerKling4GenerationServiceError);
      recoveryId = error.recovery_id ?? ""; return error.code === "OUTCOME_UNKNOWN" && /^kling4_recovery_/u.test(recoveryId);
    });
    assert.equal(runtime.counts.gens, 1);
    await assert.rejects(runtime.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }), (error: unknown) =>
      error instanceof runtime.api.OwnerKling4GenerationServiceError && error.code === "OUTCOME_UNKNOWN" && error.recovery_id === recoveryId);
    assert.equal(runtime.counts.gens, 1); assert.equal(runtime.counts.history, 0);
  } finally { await runtime.close(); }
});

test("expired input handles do not block same-owner GET reconciliation", async () => {
  const runtime = await createRuntime(KEYFRAMES, { initiallyPending: true });
  try {
    let recoveryId = "";
    await assert.rejects(runtime.service.generate(input(KEYFRAMES, runtime.handles, runtime.prompt)), (error: unknown) => {
      recoveryId = (error as { recovery_id?: string }).recovery_id ?? ""; return true;
    });
    assert.ok(recoveryId);
    assert.equal(runtime.counts.gens, 1);
    runtime.setHistoryReady(true);
    runtime.advance(16 * 60_000);
    const page = await runtime.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(page.status, "completed"); assert.equal(page.recovery_id, recoveryId); assert.equal(runtime.counts.gens, 1);
  } finally { await runtime.close(); }
});

test("genuine K4 core passes SDK upload to generation and owned result for both model IDs", async () => {
  for (const modelId of [KEYFRAMES, OMNI] as const) {
    const runtime = await createRuntime(modelId, { skipInitialUpload: true });
    const server = new McpServer({ name: "k4-genuine-sdk-2148", version: "1.0.0" });
    registerSyntxOwnerKling4Tools(server, {
      referenceService: { async uploadReference(value, signal) { return runtime.referenceService.uploadReference(value, signal); } },
      generationService: {
        async generate(value, signal) { return runtime.service.generate(value, signal); },
        async reconcile(value, signal) { return runtime.service.reconcile(value, signal); },
        async listRecoveries(value) { return runtime.service.listRecoveries(value); },
        async getResultPage(value) { return runtime.service.getResultPage(value); }
      }
    });
    const client = new Client({ name: "k4-genuine-sdk-client-2148", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(ct), server.connect(st)]);
      const source = await client.callTool({ name: OWNER_KLING4_TOOL_NAMES[0], arguments: { model_id: modelId } });
      assert.notEqual(source.isError, true);
      assert.equal(runtime.counts.uploads, 0);
      const sourceBytes = modelId === KEYFRAMES ? png() : Buffer.from(mp4());
      const uploaded = await client.callTool({ name: OWNER_KLING4_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT,
        model_id: modelId, filename: modelId === KEYFRAMES ? "ref.png" : "ref.mp4", mime_type: modelId === KEYFRAMES ? "image/png" : "video/mp4",
        content_base64: sourceBytes.toString("base64") } });
      assert.notEqual(uploaded.isError, true, JSON.stringify(uploaded));
      assert.doesNotMatch(JSON.stringify(uploaded), /r2\.syntx\.ai/u);
      const handle = (uploaded.structuredContent as { reference_handle: string }).reference_handle;
      const { attemptId, ...request } = input(modelId, [handle], runtime.prompt);
      const generated = await client.callTool({ name: OWNER_KLING4_TOOL_NAMES[2], arguments: { ...request, link_attempt_id: attemptId } });
      assert.notEqual(generated.isError, true, JSON.stringify(generated));
      const result = generated.structuredContent as { recovery_id: string; model_id: string; artifacts: Array<{ object_url: string }> };
      assert.equal(result.model_id, modelId); assert.equal(result.artifacts[0]?.object_url, OUTPUT_URL);
      assert.deepEqual([runtime.counts.uploads, runtime.counts.chats, runtime.counts.gens, runtime.counts.quotes, runtime.counts.balances], [1, 1, 1, 2, 2]);
      const readsBefore = runtime.counts.history + runtime.counts.results;
      for (const index of [3, 4, 5] as const) {
        const args = index === 4 ? { link_attempt_id: ATTEMPT } : { link_attempt_id: ATTEMPT, recovery_id: result.recovery_id };
        assert.notEqual((await client.callTool({ name: OWNER_KLING4_TOOL_NAMES[index], arguments: args })).isError, true);
      }
      assert.equal(runtime.counts.history + runtime.counts.results, readsBefore);
      assert.equal(runtime.counts.gens, 1);
    } finally { await client.close(); await server.close(); await runtime.close(); }
  }
});
