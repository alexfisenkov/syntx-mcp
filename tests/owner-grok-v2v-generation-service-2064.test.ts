import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import {
  OwnerGrokV2vGenerationService,
  OwnerGrokV2vGenerationServiceError,
  isOwnerGrokV2vGenerationService
} from "../src/application/owner-grok-v2v-generation-service.js";
import { OwnerGrokV2vOriginalReferenceService } from "../src/application/owner-grok-v2v-original-reference-service.js";
import { createOwnerGrokV2vOwnedRequestPreparer } from "../src/application/owner-grok-v2v-owned-request-preparer.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const ATTEMPT = "link_grok_generation_2064_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "grok-v2v-generation-tenant", subject: "grok-v2v-generation-owner" });
const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, join(process.cwd(), "catalog")));
const CHAT = "grok-v2v-generation-chat";
const ACK = "grok-v2v-generation-ack";
const PROMPT_BASE = "a red kite over a quiet sea";
let nextScenario = 0;
const SOURCE_URL = "https://r2.syntx.ai/grok-v2v/hidden/original.mp4";
const RESULT_MESSAGE = "grok-v2v-generation-result";
const RESULT_URLS = [
  "https://r2.syntx.ai/grok-v2v/results/first.mp4",
  "https://r2.syntx.ai/grok-v2v/results/second.mp4"
] as const;
const SOURCE = (() => {
  const bytes = new Uint8Array(28), view = new DataView(bytes.buffer);
  view.setUint32(0, 20);
  bytes.set(new TextEncoder().encode("ftypisom"), 4);
  bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8);
  bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
})();
const VIDEO_PROBE = {
  streams: [
    { codec_type: "video", codec_name: "synthetic-codec", width: 960, height: 432, duration: "3.1", disposition: { attached_pic: 0 } },
    { codec_type: "audio", codec_name: "synthetic-audio", duration: "3.14" }
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.12" }
};

function response(value: unknown, status = 200): Response { return Response.json(value, { status }); }

async function ffprobeFixture(): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-grok-v2v-generation-2064-"));
  const binary = join(directory, "ffprobe");
  const source = `#!${process.execPath}\nconst fs=require("node:fs");const args=process.argv.slice(2);` +
    `const path=args.at(-1);if(!path||!fs.statSync(path).isFile())process.exit(40);` +
    `const i=args.indexOf("-protocol_whitelist"),e=args.indexOf("-show_entries");` +
    `if(i<0||args[i+1]!=="file"||e<0||!args[e+1].includes("stream_disposition=attached_pic"))process.exit(41);` +
    `process.stdout.write(${JSON.stringify(JSON.stringify(VIDEO_PROBE))});\n`;
  await writeFile(binary, source, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}

interface HarnessOptions {
  readonly access?: boolean;
  readonly balance?: string;
  readonly cost?: number | null;
  readonly failFirstHistory?: boolean;
  readonly onGenerationAck?: () => void;
  readonly resolveGenerationClient?: (client: SyntxChatHttpClient, replacement: SyntxChatHttpClient) => unknown;
}

interface Calls {
  balance: number;
  subscription: number;
  quote: number;
  upload: number;
  chat: number;
  generate: number;
  history: number;
  result: number;
  quoteCostParameters: Readonly<Record<string, string>>[];
  generationBody: Record<string, unknown> | undefined;
}

interface Harness {
  readonly service: OwnerGrokV2vGenerationService;
  readonly references: OwnerGrokV2vOriginalReferenceService;
  readonly links: PerUserLinkService;
  readonly client: SyntxChatHttpClient;
  readonly calls: Calls;
  readonly prompt: string;
  readonly uploadOriginal: () => Promise<string>;
  readonly close: () => Promise<void>;
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const prompt = `${PROMPT_BASE} scenario-${++nextScenario}`;
  const fixture = await ffprobeFixture();
  const now = () => 1_000_000;
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-grok-generation-owner", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-grok-generation-linked-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), {
    now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
  });
  const attempt = await links.createAttempt(BINDING);
  await links.issueHandoff(BINDING, attempt.attempt_id);
  await links.checkAttempt(BINDING, attempt.attempt_id);
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (token: string) => Promise<T>) {
    return links.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
  } };
  const calls: Calls = { balance: 0, subscription: 0, quote: 0, upload: 0, chat: 0, generate: 0, history: 0,
    result: 0, quoteCostParameters: [], generationBody: undefined };
  let client!: SyntxChatHttpClient;
  const rows = () => [
    { id: ACK, chat_id: 88103, author_id: 17, message_object: [
      { id: "grok-v2v-owner-prompt", message_id: ACK, object_type: "text", object_text: prompt },
      { id: "grok-v2v-owner-input", message_id: ACK, object_type: "video", object_url: SOURCE_URL, model_type: "grok_v2v" }
    ] },
    { id: RESULT_MESSAGE, chat_id: 88103, author_id: -1, message_object: RESULT_URLS.map((object_url, index) => ({
      id: `grok-v2v-result-object-${index + 1}`, message_id: RESULT_MESSAGE, object_type: "video", object_url,
      completed: true, model_type: "grok_v2v"
    })) }
  ];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? "GET";
    if (url.pathname === "/api/v1/user/balance") { calls.balance++; return response({ balance: options.balance ?? "1.00" }); }
    if (url.pathname === "/api/v1/user/subscription") {
      calls.subscription++;
      return response({ active: false, type: null, end_date: null });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      calls.quote++;
      assert.equal(url.searchParams.get("ai_name"), "grok_video");
      assert.equal(url.searchParams.get("model_type"), "grok_v2v");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "resolution", "video_duration"]);
      assert.equal(url.searchParams.get("resolution"), "720p");
      assert.equal(url.searchParams.get("video_duration"), "3.14");
      calls.quoteCostParameters.push(Object.freeze({ resolution: url.searchParams.get("resolution")!,
        video_duration: url.searchParams.get("video_duration")! }));
      return response({ access: options.access ?? true, cost: options.cost === undefined ? 0.25 : options.cost,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      calls.upload++;
      const form = init.body as FormData;
      assert.deepEqual([...form.keys()], ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("model_type"), "grok_v2v");
      const file = form.get("files"); assert.ok(file instanceof File);
      assert.equal(file.name, "source.mp4"); assert.equal(file.type, "video/mp4");
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), SOURCE);
      return response({ files: [{ filename: "source.mp4", url: SOURCE_URL, status: "success",
        size: SOURCE.byteLength, content_type: "video/mp4" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      calls.chat++;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["scope", "title"]);
      assert.equal(body.scope, "video");
      return response({ uuid: CHAT });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      calls.generate++;
      assert.equal(url.search, "?ai_name=grok_video");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["chat_id", "prompt", "settings"]);
      assert.equal(body.chat_id, CHAT);
      assert.equal(body.prompt, prompt);
      const settings = body.settings as Record<string, unknown>;
      assert.deepEqual(settings, { model_type: "grok_v2v", aspect_ratio: null, video_duration: 3.14,
        resolution: "720p", file_urls: [{ type: "video", url: SOURCE_URL }] });
      assert.equal(Object.hasOwn(settings, "n"), false);
      assert.equal(Object.hasOwn(settings, "draft"), false);
      assert.equal(Object.hasOwn(settings, "width"), false);
      assert.equal(Object.hasOwn(settings, "height"), false);
      calls.generationBody = body;
      options.onGenerationAck?.();
      return response({ id: ACK });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/messages` && method === "GET") {
      calls.history++;
      if (options.failFirstHistory && calls.history === 1) return response({ error: "synthetic history unavailable" }, 503);
      return response({ messages: rows(), pagination: { page: 1, page_size: 10, total_count: 2,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/${RESULT_MESSAGE}` && method === "GET") {
      calls.result++;
      return response(rows()[1]);
    }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
  client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const replacement = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const references = new OwnerGrokV2vOriginalReferenceService({ ffprobePath: fixture.binary, destination: "hidden",
    binding: BINDING, linkService: links, resolveClient: () => client, now });
  const preparer = createOwnerGrokV2vOwnedRequestPreparer({ referenceService: references, now });
  const resolveChatClient = options.resolveGenerationClient
    ? () => options.resolveGenerationClient!(client, replacement)
    : () => client;
  const service = new OwnerGrokV2vGenerationService({ binding: BINDING, linkService: links, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, preparer, referenceService: references, resolveChatClient, now,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), now),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), now) });
  let handle: string | undefined;
  return {
    service, references, links, client, calls, prompt,
    async uploadOriginal() {
      const uploaded = await references.uploadReference({ attemptId: ATTEMPT, model_id: "grok_v2v", filename: "source.mp4",
        mime_type: "video/mp4", bytes: SOURCE });
      handle = uploaded.grok_reference_handle;
      return uploaded.grok_reference_handle;
    },
    async close() {
      await service.close();
      await references.close();
      await rm(fixture.directory, { recursive: true, force: true });
      void handle;
    }
  };
}

function generateInput(grokReferenceHandle: string, prompt: string) {
  return { attemptId: ATTEMPT, request: { model_id: "grok_v2v", prompt, grok_reference_handle: grokReferenceHandle } };
}

const posixFixture = { skip: process.platform === "win32" ? "POSIX ffprobe fixture; real Windows ffprobe acceptance NOT_RUN" : false };

test("source getter is static and generation uses two affordable C19 reads plus exact source-derived settings", posixFixture, async () => {
  const harness = await createHarness();
  try {
    assert.equal(isOwnerGrokV2vGenerationService(harness.service), true);
    const source = harness.service.getParametersSource();
    assert.equal(source.model_id, "grok_v2v");
    assert.equal(source.ai_name, "grok_video");
    assert.equal(source.runtime_usable, false);
    assert.equal(source.dispatch_allowed, false);
    assert.equal(source.effective_defaults, "UNKNOWN");
    assert.equal(harness.calls.quote, 0);

    const handle = await harness.uploadOriginal();
    assert.equal(harness.calls.upload, 1, "the real nominal-probe/reference/native upload setup completed before orchestration RED");
    assert.deepEqual({ balance: harness.calls.balance, quote: harness.calls.quote, chat: harness.calls.chat, generate: harness.calls.generate },
      { balance: 0, quote: 0, chat: 0, generate: 0 });
    const result = await harness.service.generate(generateInput(handle, harness.prompt));
    assert.equal(result.status, "completed");
    assert.equal(result.model_id, "grok_v2v");
    assert.equal(result.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.equal(result.cost_cap_enforced, false);
    assert.equal(result.output_count, "UNKNOWN");
    assert.equal(result.observed_artifact_count, 2);
    assert.deepEqual(result.diagnostic.gaps, []);
    assert.equal(result.diagnostic.owner_ack_status, "MATCHED");
    assert.equal(result.diagnostic.history_get_calls, 1);
    assert.equal(result.diagnostic.result_get_calls, 1);
    assert.equal(harness.calls.upload, 1);
    assert.equal(harness.calls.balance, 2);
    assert.equal(harness.calls.subscription, 2);
    assert.equal(harness.calls.quote, 2);
    assert.equal(harness.calls.chat, 1);
    assert.equal(harness.calls.generate, 1);
    assert.equal(harness.calls.history, 1);
    assert.equal(harness.calls.result, 1);
    assert.deepEqual(harness.calls.quoteCostParameters, [{ resolution: "720p", video_duration: "3.14" },
      { resolution: "720p", video_duration: "3.14" }]);
    assert.deepEqual(result.artifacts.map((artifact) => artifact.object_url).sort(), [...RESULT_URLS].sort());
    assert.ok(result.artifacts.every((artifact) => artifact.model_id === "grok_v2v" && artifact.chat_uuid === CHAT &&
      artifact.message_id === RESULT_MESSAGE && artifact.object_type === "video"));
    assert.equal(result.page_size, 64);
    const nextPage = await harness.service.getResultPage({ attemptId: ATTEMPT, recovery_id: result.recovery_id, offset: 1 });
    assert.equal(nextPage.artifacts.length, 1);
    assert.equal(nextPage.next_offset, null);
    assert.equal(harness.calls.result, 1, "paging uses the closed local result snapshot, not another GET");
    await harness.service.close();
    const stillOwned = await harness.references.resolveReference({ attemptId: ATTEMPT, model_id: "grok_v2v", grok_reference_handle: handle });
    assert.equal(stillOwned.generation_permit, false, "the generation service borrows, but does not close, the reference service");
  } finally { await harness.close(); }
});

test("C19 model access denial stops before chat and generation POSTs", posixFixture, async () => {
  const harness = await createHarness({ access: false });
  try {
    const handle = await harness.uploadOriginal();
    await assert.rejects(harness.service.generate(generateInput(handle, harness.prompt)), (error: unknown) =>
      error instanceof OwnerGrokV2vGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    assert.equal(harness.calls.quote, 1);
    assert.equal(harness.calls.chat, 0);
    assert.equal(harness.calls.generate, 0);
  } finally { await harness.close(); }
});

test("a finite quote above the fresh token balance is denied before chat or generation", posixFixture, async () => {
  const harness = await createHarness({ balance: "0.099", cost: 0.10 });
  try {
    const handle = await harness.uploadOriginal();
    await assert.rejects(harness.service.generate(generateInput(handle, harness.prompt)), (error: unknown) =>
      error instanceof OwnerGrokV2vGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    assert.equal(harness.calls.quote, 1);
    assert.equal(harness.calls.chat, 0);
    assert.equal(harness.calls.generate, 0);
  } finally { await harness.close(); }
});

test("caller cannot supply duration, resolution, URLs or native chat identifiers in the generation request", posixFixture, async () => {
  const harness = await createHarness();
  try {
    const handle = await harness.uploadOriginal();
    const request = generateInput(handle, harness.prompt);
    const extended = { ...request, request: { ...request.request, video_duration: 8, resolution: "480p",
      file_url: SOURCE_URL, chat_uuid: CHAT } };
    assert.throws(() => harness.service.generate(extended), (error: unknown) =>
      error instanceof OwnerGrokV2vGenerationServiceError && error.code === "INVALID_REQUEST");
    assert.equal(harness.calls.balance, 0);
    assert.equal(harness.calls.quote, 0);
    assert.equal(harness.calls.chat, 0);
    assert.equal(harness.calls.generate, 0);
  } finally { await harness.close(); }
});

test("an unknown history read is recovered with GET only and the semantic intent cannot be replayed", posixFixture, async () => {
  const harness = await createHarness({ failFirstHistory: true });
  try {
    const handle = await harness.uploadOriginal();
    const error = await harness.service.generate(generateInput(handle, harness.prompt)).then(() => undefined, (reason: unknown) => reason);
    assert.ok(error instanceof OwnerGrokV2vGenerationServiceError);
    assert.equal(error.code, "OUTCOME_UNKNOWN");
    assert.match(error.recovery_id ?? "", /^grok_v2v_recovery_[0-9a-f-]{36}$/u);
    const [item] = await harness.service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(item?.status, "outcome_unknown");
    assert.equal(item?.observed_artifact_count, 0);
    const generationBefore = harness.calls.generate;
    await assert.rejects(harness.service.generate(generateInput(handle, harness.prompt)), (reason: unknown) =>
      reason instanceof OwnerGrokV2vGenerationServiceError && reason.code === "INTENT_ALREADY_CLAIMED");
    const recovered = await harness.service.reconcile({ attemptId: ATTEMPT, recovery_id: error.recovery_id! });
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.observed_artifact_count, 2);
    assert.deepEqual(recovered.diagnostic.gaps, []);
    assert.equal(harness.calls.generate, generationBefore);
    assert.equal(harness.calls.chat, 1);
    assert.equal(harness.calls.history, 2);
    assert.equal(harness.calls.result, 1);
    assert.equal(harness.calls.quote, 2);
  } finally { await harness.close(); }
});

test("client replacement after a possible generation POST returns unknown without exposing foreign results", posixFixture, async () => {
  let rotated = false;
  const harness = await createHarness({ onGenerationAck: () => { rotated = true; },
    resolveGenerationClient: (client, replacement) => rotated ? replacement : client });
  try {
    const handle = await harness.uploadOriginal();
    const error = await harness.service.generate(generateInput(handle, harness.prompt)).then(() => undefined, (reason: unknown) => reason);
    assert.ok(error instanceof OwnerGrokV2vGenerationServiceError);
    assert.equal(error.code, "OUTCOME_UNKNOWN");
    assert.match(error.recovery_id ?? "", /^grok_v2v_recovery_[0-9a-f-]{36}$/u);
    assert.equal(harness.calls.generate, 1);
    assert.equal(harness.calls.history, 0);
    await assert.rejects(harness.service.reconcile({ attemptId: ATTEMPT, recovery_id: error.recovery_id! }), (reason: unknown) =>
      reason instanceof OwnerGrokV2vGenerationServiceError && reason.code === "RECOVERY_NOT_FOUND");
    assert.equal(harness.calls.result, 0);
    assert.equal(harness.calls.generate, 1);
  } finally { await harness.close(); }
});
