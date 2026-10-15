import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerWan25I2vGenerationService, OwnerWan25I2vGenerationServiceError,
  OWNER_WAN25_I2V_GENERATION_CATALOG_VERSION } from "../src/application/owner-wan25-i2v-generation-service.js";
import { OwnerWan25I2vReferenceService } from "../src/application/owner-wan25-i2v-reference-service.js";
import { createOwnerWan25I2vRequestPreparer } from "../src/application/owner-wan25-i2v-request-preparer.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const ATTEMPT = "link_wan25_generation_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "wan25-generation-1688", subject: "owner" });
const CATALOG_VERSION = "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json";
const BASE_WALL = Date.parse("2026-10-15T10:00:00.000Z");
interface State {
  wallNow: number; monoNow: number; access: boolean; lostAck: boolean; blockHistory: boolean;
  historyEntered?: () => void; releaseHistory?: () => void; imageUploads: number; chats: number; posts: number;
  histories: number; results: number; balances: number; subscriptions: number; quotes: number;
  costCalls: Readonly<Record<string, string>>[]; body?: Record<string, unknown>; currentAck?: string;
}
function png384(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  let crc = 0xffff_ffff; for (const byte of bytes.subarray(12, 29)) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  bytes.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, 29); return bytes;
}
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (token: string) => Promise<T>) { return fn("synthetic-wan25-generation-token"); } }; }
function json(value: unknown): Response { return Response.json(value); }
function createState(): State { return { wallNow: BASE_WALL, monoNow: 1_000, access: true, lostAck: false, blockHistory: false,
  imageUploads: 0, chats: 0, posts: 0, histories: 0, results: 0, balances: 0, subscriptions: 0, quotes: 0, costCalls: [] }; }
async function linked(state: State): Promise<PerUserLinkService> {
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "wan25-generation-test", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => state.wallNow), { now: () => state.wallNow,
    defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT); return links;
}
function page(messages: readonly unknown[]) { return { messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
  total_pages: messages.length === 0 ? 0 : 1, has_next: false, has_previous: false } }; }
function makeFetch(state: State): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init.method ?? (input instanceof Request ? input.method : "GET");
    if (url.pathname === "/api/v1/user/balance") { state.balances += 1; return json({ balance: "920.5" }); }
    if (url.pathname === "/api/v1/user/subscription") { state.subscriptions += 1;
      return json({ active: true, type: "PRO", end_date: new Date(BASE_WALL + 15 * 60_000).toISOString() }); }
    if (url.pathname === "/api/v2/get_model_info") { state.quotes += 1; const params = Object.fromEntries(url.searchParams.entries());
      state.costCalls.push(Object.freeze(params)); return json({ access: state.access, cost: 7.5, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: false }); }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File); state.imageUploads += 1;
      assert.equal(form.get("model_type"), "wan_25_i2v_preview");
      return json({ files: [{ id: `image-${state.imageUploads}`, url: `https://r2.syntx.ai/uploaded/${file.name}`,
        filename: file.name, mime_type: file.type, content_type: file.type, media_type: "image", type: "image", size: file.size, status: "uploaded" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") { state.chats += 1; return json({ uuid: `wan25-chat-${state.chats}` }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>, settings = body.settings as Record<string, unknown>;
      assert.equal(url.searchParams.get("ai_name"), "wan_video"); assert.equal(settings.model_type, "wan_25_i2v_preview");
      assert.equal(settings.native_audio, false); assert.equal(settings.shot_type, "single"); assert.equal(settings.audio_setting, "auto");
      assert.equal("duration" in settings, false); assert.deepEqual(settings.file_urls && (settings.file_urls as unknown[]).map((v) => (v as {type:string}).type), ["image"]);
      state.body = body; state.posts += 1; state.currentAck = `wan25-ack-${state.posts}`;
      if (state.lostAck) { state.lostAck = false; throw new Error("synthetic lost acknowledgement after write"); }
      return json({ id: state.currentAck });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history) {
      state.histories += 1; assert.equal(url.searchParams.get("page"), "1"); assert.equal(url.searchParams.get("page_size"), "10");
      const chatUuid = decodeURIComponent(history[1]!), prompt = state.body?.prompt;
      const owner = { id: state.currentAck, chat_id: 421, author_id: 27,
        message_object: [{ id: `owner-text-${chatUuid}`, message_id: state.currentAck, object_type: "text", model_type: "wan_25_i2v_preview", object_text: prompt }] };
      const bot = { id: `bot-${chatUuid}`, chat_id: 421, author_id: -1,
        message_object: [{ id: `video-object-${chatUuid}`, message_id: `bot-${chatUuid}`, object_type: "video", model_type: "wan_25_i2v_preview", completed: true }] };
      const result = json(page([owner, bot]));
      if (state.blockHistory) { state.blockHistory = false; state.historyEntered?.();
        return new Promise<Response>((resolve) => { state.releaseHistory = () => resolve(result); }); }
      return result;
    }
    const resultPath = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (resultPath) { state.results += 1; const chatUuid = decodeURIComponent(resultPath[1]!), messageId = decodeURIComponent(resultPath[2]!);
      return json({ id: messageId, chat_id: 421, author_id: -1, message_object: [{ id: `video-object-${chatUuid}`,
        message_id: messageId, object_type: "video", model_type: "wan_25_i2v_preview", completed: true,
        object_url: `https://r2.syntx.ai/generated/${chatUuid}.mp4` }] }); }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
}
async function harness(state: State) {
  const links = await linked(state), fetchImpl = makeFetch(state), credentials = broker();
  const client = new SyntxChatHttpClient({ credentialBroker: credentials, requestTimeoutMs: 5_000, fetchImpl });
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION, `${process.cwd()}/catalog`));
  const references = new OwnerWan25I2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: () => state.monoNow });
  const preparer = createOwnerWan25I2vRequestPreparer({ referenceService: references, now: () => state.monoNow });
  const service = new OwnerWan25I2vGenerationService({ binding: BINDING, linkService: links, catalog,
    catalog_version: OWNER_WAN25_I2V_GENERATION_CATALOG_VERSION, preparer, resolveChatClient: () => client,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: credentials, fetchImpl }), () => state.wallNow),
    createModelAccessService: () => new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker: credentials, fetchImpl }), () => state.wallNow),
    now: () => state.wallNow, timeoutMs: 8_000 });
  return { client, references, preparer, service, async close() { state.releaseHistory?.(); await service.close(); await references.close(); } };
}
function uploadInput(bytes: Buffer, name = "frame.png") { return { attemptId: ATTEMPT, model_id: "wan_25_i2v_preview",
  filename: name, mime_type: "image/png", content_base64: bytes.toString("base64") }; }
function generationInput(imageHandle: string, prompt = "prompt source") { return { attemptId: ATTEMPT, request: { model_id: "wan_25_i2v_preview",
  image_handle: imageHandle, audio_handle: null, prompt, parameters: { resolution: "720P", aspect_ratio: "16:9",
    video_duration: 5, prompt_extend: true, seed: null } } }; }
function errorCode(code: string) { return (e: unknown) => e instanceof OwnerWan25I2vGenerationServiceError && e.code === code; }

test("WAN25 exact preview service performs fresh C396 quote preflights and one image-only dispatch", async () => {
  const state = createState(), h = await harness(state), bytes = png384();
  try {
    const image = await h.references.uploadImage(uploadInput(bytes));
    const result = await h.service.generate(generationInput(image.image_handle));
    assert.equal(result.status, "completed"); assert.equal(result.model_id, "wan_25_i2v_preview");
    assert.equal(result.cost_cap_enforced, false); assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.equal(result.backend_acceptance, "UNPROVEN"); assert.equal(result.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(result.observed_artifact_count, 1); assert.equal(result.artifacts[0]?.object_url, "https://r2.syntx.ai/generated/wan25-chat-1.mp4");
    assert.equal(state.posts, 1); assert.equal(state.chats, 1); assert.equal(state.histories, 1); assert.equal(state.results, 1);
    assert.equal(state.balances, 2); assert.equal(state.subscriptions, 2); assert.equal(state.quotes, 2);
    assert.deepEqual(state.costCalls.map((call) => Object.keys(call).filter((k) => !["ai_name", "model_type"].includes(k)).sort()),
      [["resolution", "video_duration"], ["resolution", "video_duration"]]);
    for (const quote of state.costCalls) { assert.equal(quote.model_type, "wan_25_i2v_preview"); assert.equal(quote.ai_name, "wan_video");
      assert.equal(quote.resolution, "720P"); assert.equal(quote.video_duration, "5"); }
    assert.equal(state.body?.prompt, "prompt source");
    await assert.rejects(h.service.generate(generationInput(image.image_handle)), errorCode("INTENT_ALREADY_CLAIMED"));
    assert.equal(state.posts, 1); assert.equal(state.quotes, 2);
  } finally { await h.close(); bytes.fill(0); }
});

test("WAN25 lost ACK remains sticky and recovery is GET-only after quote expiry with recovery busy ownership", async () => {
  const state = createState(), h = await harness(state), bytes = png384();
  try {
    const image = await h.references.uploadImage(uploadInput(bytes)); const input = generationInput(image.image_handle);
    state.lostAck = true;
    let recoveryId = "";
    await assert.rejects(h.service.generate(input), (error: unknown) => { if (!(error instanceof OwnerWan25I2vGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
      recoveryId = error.recovery_id ?? ""; return recoveryId.length > 0; });
    const quoteCount = state.quotes, postCount = state.posts;
    await assert.rejects(h.service.generate(input), (error: unknown) => error instanceof OwnerWan25I2vGenerationServiceError &&
      error.code === "OUTCOME_UNKNOWN" && error.recovery_id === recoveryId);
    assert.equal(state.posts, postCount); assert.equal(state.quotes, quoteCount);
    state.monoNow += 16 * 60_000; state.wallNow += 16 * 60_000;
    let entered!: () => void; const gate = new Promise<void>((resolve) => { entered = resolve; });
    state.blockHistory = true; state.historyEntered = entered;
    const first = h.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }); await gate;
    await assert.rejects(h.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }), errorCode("SERVICE_BUSY"));
    await assert.rejects(h.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }), errorCode("SERVICE_BUSY"));
    state.releaseHistory?.();
    const result = await first;
    assert.equal(result.recovery_id, recoveryId); assert.equal(result.observed_artifact_count, 1);
    assert.equal(state.posts, postCount); assert.equal(state.quotes, quoteCount); assert.equal(state.balances, 2); assert.equal(state.subscriptions, 2);
    assert.equal(state.histories, 1); assert.equal(state.results, 1);
    const page = await h.service.getResultPage({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(page.artifacts.length, 1); assert.equal(page.artifacts[0]?.message_object_id, `video-object-wan25-chat-1`);
    assert.equal(state.posts, postCount); assert.equal(state.quotes, quoteCount);
    const listed = await h.service.listRecoveries({ attemptId: ATTEMPT }); assert.equal(listed[0]?.status, "completed");
  } finally { state.releaseHistory?.(); await h.close(); bytes.fill(0); }
});

test("WAN25 account/access preflight blocks before chat and permits retry before any one-shot claim", async () => {
  const state = createState(), h = await harness(state), bytes = png384();
  try {
    const image = await h.references.uploadImage(uploadInput(bytes)), input = generationInput(image.image_handle);
    state.access = false;
    await assert.rejects(h.service.generate(input), errorCode("PREFLIGHT_FAILED"));
    assert.equal(state.chats, 0); assert.equal(state.posts, 0); assert.equal(state.quotes, 1);
    state.access = true;
    const result = await h.service.generate(input); assert.equal(result.status, "completed");
    assert.equal(state.chats, 1); assert.equal(state.posts, 1); assert.equal(state.quotes, 3);
  } finally { await h.close(); bytes.fill(0); }
});
