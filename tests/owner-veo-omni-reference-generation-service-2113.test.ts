import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadSyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerVeoOmniReferenceService } from "../src/application/owner-veo-omni-reference-service.js";
import { getOwnerVeoOmniReferenceProfile } from "../src/application/owner-veo-omni-reference-profile.js";
import { OwnerVeoOmniReferenceGenerationService, isOwnerVeoOmniReferenceGenerationService } from "../src/application/owner-veo-omni-reference-generation-service.js";
import { createOwnerVeoOmniReferenceRequestPreparer, type OwnerVeoOmniReferenceRequestPreparer } from "../src/application/owner-veo-omni-reference-request-preparer.js";
import { OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES, registerSyntxOwnerVeoOmniReferenceTools } from "../src/mcp/owner-veo-omni-reference-tools.js";

const ATTEMPT = "link_veo_omni_generation_2113_owner_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "veo-omni-generation-2113", subject: "synthetic-owner" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const OUTPUT_URL = "https://r2.syntx.ai/veo-omni-generation-2113/output/result.mp4";
let runtimeSerial = 0;
const BASE_NOW = Date.parse("2026-10-17T00:00:00.000Z");

function hasCode(code: string, recoveryId?: string) {
  return (error: unknown): boolean => !!error && typeof error === "object" && "code" in error && error.code === code &&
    (recoveryId === undefined || ("recovery_id" in error && error.recovery_id === recoveryId));
}
function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function videoBytes(): Uint8Array {
  const bytes = new Uint8Array(28), view = new DataView(bytes.buffer);
  view.setUint32(0, 20); bytes.set(new TextEncoder().encode("ftypisom"), 4); bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8); bytes.set(new TextEncoder().encode("mdat"), 24); return bytes;
}
async function ffprobeFixture(): Promise<{ readonly directory: string; readonly binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-veo-omni-generation-2113-"));
  const binary = join(directory, "ffprobe-fixture");
  const output = JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360,
    duration: "1.25", disposition: { attached_pic: 0 } }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1.25" } });
  const script = `#!${process.execPath}\nconst fs=require("node:fs");const args=process.argv.slice(2);const file=args.at(-1);` +
    `if(!file||!fs.statSync(file).isFile())process.exit(41);const p=args.indexOf("-protocol_whitelist");` +
    `if(p<0||args[p+1]!=="file")process.exit(42);process.stdout.write(${JSON.stringify(output)});\n`;
  await writeFile(binary, script, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}

interface RuntimeOptions {
  readonly secondQuote?: "good" | "missing";
  readonly secondBalanceTooLow?: boolean;
  readonly subscriptionPlan?: string | null;
  readonly subscriptionActive?: boolean | null;
  readonly loseGenerationAck?: boolean;
  readonly wrongResultModel?: boolean;
  readonly initiallyPendingResult?: boolean;
  readonly blockNextSubscription?: boolean;
  readonly videoProbe?: boolean;
}
interface Runtime {
  readonly service: OwnerVeoOmniReferenceGenerationService;
  readonly referenceService: OwnerVeoOmniReferenceService;
  readonly preparer: OwnerVeoOmniReferenceRequestPreparer;
  readonly client: SyntxChatHttpClient;
  readonly prompt: string;
  readonly state: {
    chatCreates: number; generationPosts: number; historyGets: number; resultGets: number;
    quoteGets: number; balanceGets: number; subscriptionGets: number; subscriptionResolverCalls: number;
    accountFactories: number; accessFactories: number; quoteParameters: Readonly<Record<string, string>>[];
  };
  readonly advance: (ms: number) => void;
  readonly setHistoryReady: (ready: boolean) => void;
  readonly setActiveSources: (sources: readonly Readonly<{ kind: string; url: string }>[], inputType?: "image" | "references") => void;
  readonly uploadOne: (kind: "image" | "video", filename: string) => Promise<{ handle: string; source: { kind: string; url: string } }>;
  readonly handles: string[];
  readonly sources: Readonly<{ kind: string; url: string }>[];
  readonly rawInput: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  readonly blockEntered: Promise<void>;
  close(): Promise<void>;
}

async function linkedOwner(now: () => number): Promise<PerUserLinkService> {
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "omni-generation-2113", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-veo-omni-generation-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), {
    now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
  });
  await links.createAttempt(BINDING);
  await links.issueHandoff(BINDING, ATTEMPT);
  await links.checkAttempt(BINDING, ATTEMPT);
  return links;
}

async function makeRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const prompt = `Create a cinematic movement using [[ref:1]] as the visual anchor. Case ${++runtimeSerial}.`;
  let wallNow = BASE_NOW;
  const now = () => wallNow;
  const advance = (ms: number) => { wallNow += ms; };
  const profile = getOwnerVeoOmniReferenceProfile();
  const catalog = new DiscoveryCatalogRepository(loadSyntxPublicCatalogSnapshot(resolve(process.cwd(),
    "catalog/public/sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json")));
  const links = await linkedOwner(now);
  const videoProbe = options.videoProbe ? await ffprobeFixture() : undefined;
  let historyReady = !options.initiallyPendingResult;
  const setHistoryReady = (ready: boolean) => { historyReady = ready; };
  let activeSources: readonly Readonly<{ kind: string; url: string }>[] = Object.freeze([]);
  let activeInputType: "image" | "references" = "image";
  const lastSourceUrls = new Map<string, readonly Readonly<{ kind: string; url: string }>[] >();
  const sentPromptByChat = new Map<string, string>();
  const setActiveSources = (sources: readonly Readonly<{ kind: string; url: string }>[], inputType: "image" | "references" = "image") => {
    activeSources = Object.freeze([...sources]); activeInputType = inputType;
  };
  let enteredBlock!: () => void;
  const blockEntered = new Promise<void>((resolve) => { enteredBlock = resolve; });
  const state = { chatCreates: 0, generationPosts: 0, historyGets: 0, resultGets: 0, quoteGets: 0, balanceGets: 0,
    subscriptionGets: 0, subscriptionResolverCalls: 0, accountFactories: 0, accessFactories: 0,
    quoteParameters: [] as Readonly<Record<string, string>>[], uploads: 0 };
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return links.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
    }
  };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    if (url.origin === "https://api.syntx.ai" && url.pathname === "/api/v1/user/balance" && method === "GET") {
      state.balanceGets += 1;
      return jsonResponse({ balance: options.secondBalanceTooLow && state.balanceGets === 2 ? "0.1" : "10" });
    }
    if (url.origin === "https://api.syntx.ai" && url.pathname === "/api/v1/user/subscription" && method === "GET") {
      state.subscriptionGets += 1;
      if (options.blockNextSubscription && state.subscriptionGets === 1) {
        enteredBlock();
        return await new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("subscription aborted")), { once: true }));
      }
      return jsonResponse({ active: options.subscriptionActive ?? true,
        type: options.subscriptionPlan ?? "PAID", end_date: "2099-12-31T00:00:00.000Z" });
    }
    if (url.origin === "https://api.syntx.ai" && url.pathname === "/api/v2/get_model_info" && method === "GET") {
      state.quoteGets += 1;
      state.quoteParameters.push(Object.freeze(Object.fromEntries([...url.searchParams.entries()].filter(([key]) => !["ai_name", "model_type"].includes(key)))));
      const missing = options.secondQuote === "missing" && state.quoteGets === 2;
      return jsonResponse({ access: true, cost: missing ? null : 0.125, discount_cost: null,
        free_remaining_generations: 100, limit: null, show_warning: false });
    }
    if (url.origin !== "https://api.syntx.ai") throw new Error("unexpected synthetic origin");
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      const form = init.body as FormData, file = form.get("files");
      assert.ok(file instanceof File);
      state.uploads += 1;
      return jsonResponse({ files: [{ id: `omni-generation-upload-${state.uploads}`,
        url: `https://r2.syntx.ai/veo-omni-generation-2113/reference-${file.name}`,
        status: "uploaded", mime_type: file.type, size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      state.chatCreates += 1;
      const chatId = `omni-generation-chat-${state.chatCreates}`;
      lastSourceUrls.set(chatId, activeSources);
      return jsonResponse({ uuid: chatId });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      state.generationPosts += 1;
      assert.equal(url.search, "?ai_name=veo3");
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      assert.equal("mode" in body.settings, false, "quote-only video_ref does not enter generation settings");
      const chatId = body.chat_id;
      const sourceList = lastSourceUrls.get(chatId) ?? [];
      const mentionUrl = sourceList[0]?.url;
      assert.ok(mentionUrl);
      assert.equal(body.prompt, prompt.replace("[[ref:1]]", `<<<${mentionUrl}>>>`));
      assert.deepEqual(body.settings, { model_type: "veo_omni", type: activeInputType, upscale: 2, aspect_ratio: "16:9",
        video_duration: 8, file_urls: sourceList.map((source) => ({ type: source.kind, url: source.url })) });
      sentPromptByChat.set(chatId, body.prompt);
      if (options.loseGenerationAck) throw new Error("synthetic generation acknowledgement loss");
      return jsonResponse({ id: "omni-generation-owner-ack-2113" });
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/(omni-generation-chat-\d+)\/messages$/u);
    if (history && method === "GET") {
      state.historyGets += 1;
      assert.equal(url.searchParams.get("page"), "1");
      assert.equal(url.searchParams.get("page_size"), "10");
      if (!historyReady) return jsonResponse({ messages: [], pagination: { page: 1, page_size: 10, total_count: 0,
        total_pages: 0, has_next: false, has_previous: false } });
      const chatId = history[1]!;
      const ownerId = "omni-generation-owner-ack-2113";
      const botId = `omni-generation-bot-${chatId}`;
      const sources: readonly Readonly<{ kind: string; url: string }>[] = (lastSourceUrls.get(chatId) ?? []);
      return jsonResponse({ messages: [
        { id: ownerId, chat_id: "88113", author_id: 17, message_object: [
          { id: "omni-generation-owner-text-2113", message_id: ownerId, object_type: "text", object_text: sentPromptByChat.get(chatId) },
          ...sources.map((source, index) => ({ id: `omni-generation-owner-source-${index}`, message_id: ownerId,
            object_type: source.kind, object_url: source.url, model_type: "veo_omni" }))
        ] },
        { id: botId, chat_id: "88113", author_id: -1, message_object: [{ id: `omni-generation-video-object-${chatId}`,
          message_id: botId, object_type: "video", model_type: options.wrongResultModel ? "wrong_model" : "veo_omni",
          completed: true, object_url: OUTPUT_URL }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const result = url.pathname.match(/^\/api\/v1\/chats\/(omni-generation-chat-\d+)\/(omni-generation-bot-omni-generation-chat-\d+)$/u);
    if (result && method === "GET") {
      state.resultGets += 1;
      return jsonResponse({ id: result[2], chat_id: "88113", author_id: -1, message_object: [{ id: `omni-generation-video-object-${result[1]}`,
        message_id: result[2], object_type: "video", model_type: "veo_omni", completed: true, object_url: OUTPUT_URL }] });
    }
    throw new Error(`unexpected synthetic request ${method} ${url.pathname}`);
  };
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const httpClient = () => new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 1_000 });
  const referenceService = new OwnerVeoOmniReferenceService({ binding: BINDING, linkService: links,
    resolveClient: () => client, ffprobePath: videoProbe?.binary ?? process.execPath, now });
  const preparer = createOwnerVeoOmniReferenceRequestPreparer({ referenceService, now });
  const createAccountStatusService = () => {
    state.accountFactories += 1;
    return new AccountStatusService(httpClient(), now);
  };
  const createModelAccessService = () => {
    state.accessFactories += 1;
    return new ModelAccessService(catalog, httpClient(), now);
  };
  const service = new OwnerVeoOmniReferenceGenerationService({ binding: BINDING, linkService: links,
    catalog, catalog_version: profile.source_pins.public_catalog_version, preparer, referenceService,
    resolveChatClient: () => client, createAccountStatusService, createModelAccessService,
    resolveSubscription: async (_attemptId: string, signal?: AbortSignal) => {
      state.subscriptionResolverCalls += 1;
      signal?.throwIfAborted();
      return await httpClient().getSubscription(signal);
    }, now });

  const uploadOne = async (kind: "image" | "video", filename: string) => {
    const result = await referenceService.uploadReference({ attemptId: ATTEMPT, filename,
      mime_type: kind === "image" ? "image/png" : "video/mp4", bytes: kind === "image" ? PNG : videoBytes() });
    const resolved = await referenceService.resolveReferences({ attemptId: ATTEMPT, reference_handles: [result.reference_handle] });
    const captured = referenceService.withCapturedReferences(resolved, (_client, refs) => refs[0]!);
    return { handle: result.reference_handle, source: { kind: captured.kind, url: captured.url } };
  };
  const handles: string[] = [], sources: Readonly<{ kind: string; url: string }>[] = [];
  const first = await uploadOne("image", "reference.png");
  handles.push(first.handle); sources.push(first.source);
  setActiveSources(sources);
  const rawInput = (overrides: Record<string, unknown> = {}) => ({ attemptId: ATTEMPT, prompt,
    input_type: "image", upscale: 2, aspect_ratio: "16:9", video_duration: 8, reference_handles: [...handles], ...overrides });
  return { service, referenceService, preparer, client, state, prompt, advance, setHistoryReady, blockEntered,
    setActiveSources, uploadOne, handles, sources, rawInput,
    async close() { await service.close(); await preparer.close(); await referenceService.close();
      if (videoProbe) await rm(videoProbe.directory, { recursive: true, force: true }); },
  };
}

test("exports a nominal service with source-only parameters and generation/recovery methods", async () => {
  const methods = Object.getOwnPropertyNames(OwnerVeoOmniReferenceGenerationService.prototype);
  assert.deepEqual(methods.sort(), ["close", "constructor", "generate", "getParametersSource", "getResultPage",
    "invalidateAttempt", "listRecoveries", "reconcile"].sort());
});

test("runs two independent paid gates and dispatches the exact ordered image-only typed request", async () => {
  const runtime = await makeRuntime();
  try {
    assert.equal(isOwnerVeoOmniReferenceGenerationService(runtime.service), true);
    assert.equal(runtime.service.getParametersSource().profile_sha256, getOwnerVeoOmniReferenceProfile().profile_sha256);
    const result = await runtime.service.generate(runtime.rawInput());
    assert.equal(result.status, "completed");
    assert.equal(result.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.equal(result.cost_cap_enforced, false);
    assert.equal(result.output_count, "UNKNOWN");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]!.object_url, OUTPUT_URL);
    assert.equal(runtime.state.generationPosts, 1);
    assert.equal(runtime.state.chatCreates, 1);
    assert.equal(runtime.state.quoteGets, 2);
    assert.equal(runtime.state.subscriptionResolverCalls, 2);
    assert.equal(runtime.state.accountFactories, 2);
    assert.equal(runtime.state.accessFactories, 2);
    assert.deepEqual(runtime.state.quoteParameters, [{ upscale: "2", video_duration: "8" }, { upscale: "2", video_duration: "8" }]);
    const post = runtime.state;
    assert.equal(post.balanceGets, 2);
    const listed = await runtime.service.listRecoveries({ attemptId: ATTEMPT, limit: 10 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.status, "completed");
    const page = await runtime.service.getResultPage({ attemptId: ATTEMPT, recovery_id: result.recovery_id, offset: 0 });
    assert.equal(page.artifacts[0]!.object_url, OUTPUT_URL);
  } finally { await runtime.close(); }
});

test("video references select the source-bound video_ref quote while keeping cost mode out of settings", async () => {
  const runtime = await makeRuntime({ videoProbe: true });
  try {
    const video = await runtime.uploadOne("video", "reference.mp4");
    const image = await runtime.uploadOne("image", "companion.png");
    runtime.handles.splice(0, runtime.handles.length, video.handle, image.handle);
    runtime.sources.splice(0, runtime.sources.length, video.source, image.source);
    runtime.setActiveSources([video.source, image.source], "references");
    const input = runtime.rawInput({ input_type: "references", reference_handles: [video.handle, image.handle] });
    const result = await runtime.service.generate(input);
    assert.equal(result.status, "completed");
    assert.deepEqual(runtime.state.quoteParameters, [
      { mode: "video_ref", upscale: "2", video_duration: "8" },
      { mode: "video_ref", upscale: "2", video_duration: "8" }
    ]);
    assert.equal(runtime.state.generationPosts, 1);
  } finally { await runtime.close(); }
});

test("a missing second-gate price and an unavailable paid subscription block generation", async () => {
  const missing = await makeRuntime({ secondQuote: "missing" });
  try {
    await assert.rejects(missing.service.generate(missing.rawInput()), hasCode("PREFLIGHT_FAILED"));
    assert.equal(missing.state.chatCreates, 1);
    assert.equal(missing.state.generationPosts, 0);
    assert.equal(missing.state.quoteGets, 2);
  } finally { await missing.close(); }

  const lowBalance = await makeRuntime({ secondBalanceTooLow: true });
  try {
    await assert.rejects(lowBalance.service.generate(lowBalance.rawInput()), hasCode("PREFLIGHT_FAILED"));
    assert.equal(lowBalance.state.chatCreates, 1);
    assert.equal(lowBalance.state.generationPosts, 0);
    assert.equal(lowBalance.state.quoteGets, 2);
  } finally { await lowBalance.close(); }

  const free = await makeRuntime({ subscriptionPlan: "FREE" });
  try {
    await assert.rejects(free.service.generate(free.rawInput()), hasCode("SUBSCRIPTION_REQUIRED"));
    assert.equal(free.state.chatCreates, 0);
    assert.equal(free.state.generationPosts, 0);
    assert.equal(free.state.quoteGets, 0);
  } finally { await free.close(); }
});

test("unknown generation POST is sticky; reconciliation is GET-only and preserves its recovery id", async () => {
  const runtime = await makeRuntime({ loseGenerationAck: true });
  try {
    let recoveryId = "";
    await assert.rejects(runtime.service.generate(runtime.rawInput()), (error: unknown) => {
      if (error && typeof error === "object" && "recovery_id" in error && typeof error.recovery_id === "string") recoveryId = error.recovery_id;
      return hasCode("OUTCOME_UNKNOWN")(error) && recoveryId.length > 0;
    });
    assert.equal(runtime.state.generationPosts, 1);
    await assert.rejects(runtime.service.generate(runtime.rawInput()), hasCode("INTENT_ALREADY_CLAIMED"));
    await assert.rejects(runtime.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }), hasCode("OUTCOME_UNKNOWN", recoveryId));
    assert.equal(runtime.state.generationPosts, 1);
    assert.equal(runtime.state.historyGets, 0);
    assert.equal(runtime.state.resultGets, 0);
  } finally { await runtime.close(); }
});

test("rejects a native result whose model echo contradicts the pinned Omni model", async () => {
  const runtime = await makeRuntime({ wrongResultModel: true });
  try {
    let recoveryId = "";
    await assert.rejects(runtime.service.generate(runtime.rawInput()), (error: unknown) => {
      if (error && typeof error === "object" && "recovery_id" in error && typeof error.recovery_id === "string") recoveryId = error.recovery_id;
      return hasCode("OUTCOME_UNKNOWN")(error) && recoveryId.length > 0;
    });
    assert.equal(runtime.state.generationPosts, 1);
    assert.equal(runtime.state.resultGets, 0);
    const items = await runtime.service.listRecoveries({ attemptId: ATTEMPT, limit: 5 });
    assert.equal(items.length, 1);
    assert.equal(items[0]!.status, "outcome_unknown");
    assert.deepEqual(items[0]!.diagnostic.gaps, ["BOT_VIDEO_MODEL_COMPLETION_OR_OBJECT_MISMATCH"]);
  } finally { await runtime.close(); }
});

test("GET recovery can finish after upload TTL without another price gate or generation POST", async () => {
  const runtime = await makeRuntime({ initiallyPendingResult: true });
  try {
    let recoveryId = "";
    await assert.rejects(runtime.service.generate(runtime.rawInput()), (error: unknown) => {
      if (error && typeof error === "object" && "recovery_id" in error && typeof error.recovery_id === "string") recoveryId = error.recovery_id;
      return hasCode("OUTCOME_UNKNOWN")(error) && recoveryId.length > 0;
    });
    assert.equal(runtime.state.generationPosts, 1);
    runtime.advance(16 * 60_000);
    runtime.setHistoryReady(true);
    const result = await runtime.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.recovery_id, recoveryId);
    assert.equal(result.artifacts[0]!.object_url, OUTPUT_URL);
    assert.equal(runtime.state.quoteGets, 2);
    assert.equal(runtime.state.generationPosts, 1);
  } finally { await runtime.close(); }
});

test("close aborts an in-flight first subscription read before chat or generation", async () => {
  const runtime = await makeRuntime({ blockNextSubscription: true });
  const pending = runtime.service.generate(runtime.rawInput());
  try {
    await runtime.blockEntered;
    await runtime.service.close();
    await assert.rejects(pending, (error: unknown) => error && typeof error === "object" &&
      "code" in error && ["SERVICE_CLOSED", "SUBSCRIPTION_STATUS_UNVERIFIED", "PREFLIGHT_FAILED", "PRE_DISPATCH_FAILED"].includes(String(error.code)));
    assert.equal(runtime.state.chatCreates, 0);
    assert.equal(runtime.state.generationPosts, 0);
  } finally { await runtime.close(); }
});

test("invalidation drains an aborted generation without surfacing its expected run rejection", async () => {
  const runtime = await makeRuntime({ blockNextSubscription: true });
  const pending = runtime.service.generate(runtime.rawInput());
  try {
    await runtime.blockEntered;
    await runtime.service.invalidateAttempt(ATTEMPT);
    await assert.rejects(pending, (error: unknown) => error && typeof error === "object" &&
      "code" in error && ["SERVICE_CLOSED", "SUBSCRIPTION_STATUS_UNVERIFIED", "PREFLIGHT_FAILED", "PRE_DISPATCH_FAILED"].includes(String(error.code)));
    assert.equal(runtime.state.chatCreates, 0);
    assert.equal(runtime.state.generationPosts, 0);
    await assert.rejects(runtime.referenceService.resolveReferences({ attemptId: ATTEMPT,
      reference_handles: [runtime.handles[0]!] }), hasCode("REFERENCE_UNAVAILABLE"));
  } finally { await runtime.close(); }
});

test("MCP SDK upload-to-generate returns a closed completed result and recovery pages", async () => {
  const runtime = await makeRuntime();
  const server = new McpServer({ name: "syntx-omni-reference-2113-test", version: "1" });
  registerSyntxOwnerVeoOmniReferenceTools(server, { referenceService: runtime.referenceService, generationService: runtime.service });
  const client = new Client({ name: "syntx-omni-reference-2113-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const uploaded = await client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, filename: "sdk.png", mime_type: "image/png", content_base64: PNG.toString("base64")
    } });
    assert.equal(uploaded.isError, undefined);
    const uploadReceipt = uploaded.structuredContent as { readonly status: string; readonly reference_handle: string; readonly model_id: string };
    assert.equal(uploadReceipt.status, "uploaded");
    assert.equal(uploadReceipt.model_id, "veo_omni");
    assert.match(uploadReceipt.reference_handle, /^veo_omni_reference_[0-9a-f-]{36}$/u);
    assert.equal(JSON.stringify(uploadReceipt).includes("r2.syntx.ai"), false);

    const sourceUrl = "https://r2.syntx.ai/veo-omni-generation-2113/reference-sdk.png";
    runtime.setActiveSources([{ kind: "image", url: sourceUrl }], "image");
    const generated = await client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[2], arguments: {
      link_attempt_id: ATTEMPT, prompt: runtime.prompt, input_type: "image", upscale: 2, aspect_ratio: "16:9",
      video_duration: 8, reference_handles: [uploadReceipt.reference_handle]
    } });
    assert.equal(generated.isError, undefined);
    const result = generated.structuredContent as {
      readonly status: string; readonly status_semantics: string; readonly backend_acceptance: string;
      readonly provider_terminal_status: string; readonly cost_cap_enforced: boolean; readonly output_count: string;
      readonly recovery_id: string; readonly model_id: string;
      readonly source_binding: Readonly<{ public_catalog_version: string; profile_sha256: string; request_fingerprint: string; intent_fingerprint: string }>;
      readonly artifacts: readonly Readonly<{ object_url: string; model_id: string; chat_uuid: string; message_id: string }>[];
    };
    assert.equal(result.status, "completed");
    assert.equal(result.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.equal(result.cost_cap_enforced, false);
    assert.equal(result.output_count, "UNKNOWN");
    assert.equal(result.model_id, "veo_omni");
    assert.equal(result.source_binding.public_catalog_version, getOwnerVeoOmniReferenceProfile().source_pins.public_catalog_version);
    assert.equal(result.source_binding.profile_sha256, getOwnerVeoOmniReferenceProfile().profile_sha256);
    assert.equal(result.source_binding.request_fingerprint.startsWith("sha256:"), true);
    assert.equal(result.source_binding.intent_fingerprint.startsWith("sha256:"), true);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]!.object_url, OUTPUT_URL);
    assert.equal(JSON.stringify(result).includes(sourceUrl), false);
    assert.equal(runtime.state.generationPosts, 1);
    assert.equal(runtime.state.quoteGets, 2);

    const recoveries = await client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[4], arguments: { link_attempt_id: ATTEMPT, limit: 5 } });
    assert.equal(recoveries.isError, undefined);
    const listed = recoveries.structuredContent as { readonly recoveries: readonly Readonly<{ recovery_id: string; status: string }>[] };
    assert.equal(listed.recoveries.length, 1);
    assert.equal(listed.recoveries[0]!.recovery_id, result.recovery_id);
    assert.equal(listed.recoveries[0]!.status, "completed");
    const page = await client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[5], arguments: {
      link_attempt_id: ATTEMPT, recovery_id: result.recovery_id, offset: 0
    } });
    assert.equal(page.isError, undefined);
    assert.deepEqual(page.structuredContent, result);
    assert.equal(runtime.state.generationPosts, 1);
    assert.equal(runtime.state.quoteGets, 2);
  } finally {
    await client.close();
    await server.close();
    await runtime.close();
  }
});
