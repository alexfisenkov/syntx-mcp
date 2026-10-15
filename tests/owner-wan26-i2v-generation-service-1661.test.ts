import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerWan26I2vGenerationService, OwnerWan26I2vGenerationServiceError,
  OWNER_WAN26_I2V_GENERATION_CATALOG_VERSION } from "../src/application/owner-wan26-i2v-generation-service.js";
import { OwnerWan26I2vReferenceService } from "../src/application/owner-wan26-i2v-reference-service.js";
import { createOwnerWan26I2vRequestPreparer } from "../src/application/owner-wan26-i2v-request-preparer.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const exec = promisify(execFile);
const ATTEMPT = "link_wan26_generation_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "wan26-generation-1661", subject: "owner" });
const MODEL_IDS = ["wan_26_i2v", "wan_26_i2v_flash"] as const;
const MEDIA = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const BASE_WALL = Date.parse("2026-10-15T10:00:00.000Z");

interface NativeState {
  wallNow: number;
  monoNow: number;
  subscriptionActive: boolean;
  denyQuoteCall: number | null;
  blockNextQuote: boolean;
  blockNextHistoryGet: boolean;
  quoteEntered?: () => void;
  releaseQuote?: (response: Response) => void;
  historyEntered?: () => void;
  releaseHistory?: () => void;
  loseNextStartAck: boolean;
  pendingFirstResult: boolean;
  grownHistory: boolean;
  globalFetchCalls: number;
  imageUploads: number;
  audioUploads: number;
  chatCreates: number;
  generationPosts: number;
  historyGets: number;
  resultGets: number;
  accountBalanceReads: number;
  subscriptionReads: number;
  quoteReads: number;
  costCalls: Readonly<Record<string, string>>[];
  promptByChat: Map<string, string>;
  modelByChat: Map<string, string>;
  ackByChat: Map<string, string>;
  resultGetsByChat: Map<string, number>;
  historyGetsByChat: Map<string, number>;
  videoBodies: Record<string, unknown>[];
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png384(): Buffer {
  const bytes = Buffer.from(PNG_BASE64, "base64"); bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(run: (token: string) => Promise<T>) { return run("synthetic-wan26-generation-test-token"); } };
}
function response(value: unknown): Response { return Response.json(value); }
function page(messages: readonly unknown[], total = messages.length) {
  return { messages, pagination: { page: 1, page_size: 10, total_count: total, total_pages: total === 0 ? 0 : 1,
    has_next: false, has_previous: false } };
}
function accountEndDate(state: NativeState): string { return new Date(state.wallNow + 60 * 60_000).toISOString(); }
function createNativeState(): NativeState {
  return { wallNow: BASE_WALL, monoNow: 1_000, subscriptionActive: true, denyQuoteCall: null, blockNextQuote: false,
    blockNextHistoryGet: false,
    loseNextStartAck: false, pendingFirstResult: false, grownHistory: false, globalFetchCalls: 0,
    imageUploads: 0, audioUploads: 0, chatCreates: 0, generationPosts: 0, historyGets: 0, resultGets: 0,
    accountBalanceReads: 0, subscriptionReads: 0, quoteReads: 0, costCalls: [], promptByChat: new Map(), modelByChat: new Map(),
    ackByChat: new Map(), resultGetsByChat: new Map(), historyGetsByChat: new Map(), videoBodies: [] };
}

async function linked(state: NativeState): Promise<PerUserLinkService> {
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "wan26-generation-test", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => state.wallNow), {
    now: () => state.wallNow, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  return links;
}

function createFetch(state: NativeState): typeof fetch {
  return async (input, init = {}) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const method = init.method ?? (input instanceof Request ? input.method : "GET");
    const url = new URL(rawUrl);
    if (url.pathname === "/api/v1/user/balance") { state.accountBalanceReads += 1; return response({ balance: "920.5" }); }
    if (url.pathname === "/api/v1/user/subscription") {
      state.subscriptionReads += 1;
      return response({ active: state.subscriptionActive, type: "PRO", end_date: accountEndDate(state) });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      state.quoteReads += 1;
      const all = Object.fromEntries(url.searchParams.entries());
      state.costCalls.push(Object.freeze({ ...all }));
      if (state.blockNextQuote) {
        state.blockNextQuote = false; state.quoteEntered?.();
        return new Promise<Response>((resolve, reject) => {
          state.releaseQuote = resolve;
          const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
          if (signal?.aborted) reject(new Error("synthetic quote abort"));
          else signal?.addEventListener("abort", () => reject(new Error("synthetic quote abort")), { once: true });
        });
      }
      const access = state.denyQuoteCall === state.quoteReads ? false : true;
      return response({ access, cost: 7.5, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
      assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
      if (file.type.startsWith("image/")) state.imageUploads += 1; else state.audioUploads += 1;
      return response({ files: [{ id: `file-${state.imageUploads + state.audioUploads}`, url: `https://r2.syntx.ai/uploaded/${file.name}`,
        filename: file.name, mime_type: file.type, content_type: file.type, media_type: file.type.startsWith("image/") ? "image" : "audio",
        type: file.type.startsWith("image/") ? "image" : "audio", size: file.size, status: "uploaded" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      state.chatCreates += 1;
      return response({ uuid: `wan-chat-${state.chatCreates}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      assert.equal(url.searchParams.get("ai_name"), "wan_video");
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      const chatId = body.chat_id, modelId = String(body.settings.model_type);
      state.modelByChat.set(chatId, modelId); state.promptByChat.set(chatId, body.prompt);
      assert.equal(Object.hasOwn(body.settings, "duration"), false);
      const files = body.settings.file_urls as readonly { type: string; url: string }[];
      assert.equal(files[0]?.type, "image"); assert.ok(files[0]?.url.startsWith("https://r2.syntx.ai/uploaded/"));
      assert.ok(files.length === 1 || (files.length === 2 && files[1]?.type === "audio"));
      state.videoBodies.push(body as unknown as Record<string, unknown>); state.generationPosts += 1;
      const ack = `wan-ack-${state.generationPosts}`; state.ackByChat.set(chatId, ack);
      if (state.loseNextStartAck) { state.loseNextStartAck = false; throw new Error("synthetic lost start acknowledgement"); }
      return response({ id: ack });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history) {
      const chatId = decodeURIComponent(history[1]!); state.historyGets += 1;
      const calls = (state.historyGetsByChat.get(chatId) ?? 0) + 1; state.historyGetsByChat.set(chatId, calls);
      const modelId = state.modelByChat.get(chatId)!, ack = state.ackByChat.get(chatId) ?? `wan-ack-${chatId.split("-").at(-1)}`;
      const prompt = state.promptByChat.get(chatId)!;
      const ids = state.grownHistory && calls >= 2 ? ["video-object-1", "video-object-2"] : ["video-object-1"];
      const owner = { id: ack, chat_id: 421, author_id: 27,
        message_object: [{ id: `text-${chatId}`, message_id: ack, object_type: "text", model_type: modelId, object_text: prompt }] };
      const botId = `bot-${chatId}`;
      const bot = { id: botId, chat_id: 421, author_id: -1,
        message_object: ids.map((id) => ({ id, message_id: botId, object_type: "video", model_type: modelId, completed: true })) };
      const historyResponse = response(page([owner, bot]));
      if (state.blockNextHistoryGet) {
        state.blockNextHistoryGet = false;
        state.historyEntered?.();
        return new Promise<Response>((resolve) => { state.releaseHistory = () => resolve(historyResponse); });
      }
      return historyResponse;
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result) {
      const chatId = decodeURIComponent(result[1]!), messageId = decodeURIComponent(result[2]!);
      state.resultGets += 1;
      const calls = (state.resultGetsByChat.get(chatId) ?? 0) + 1; state.resultGetsByChat.set(chatId, calls);
      const modelId = state.modelByChat.get(chatId)!;
      const ids = state.grownHistory && (state.historyGetsByChat.get(chatId) ?? 0) >= 2 ? ["video-object-1", "video-object-2"] : ["video-object-1"];
      const pending = state.pendingFirstResult && calls === 1;
      return response({ id: messageId, chat_id: 421, author_id: -1, message_object: ids.map((id, index) => ({ id,
        message_id: messageId, object_type: "video", model_type: modelId, completed: !pending,
        object_url: pending ? null : `https://r2.syntx.ai/generated/${chatId}-${index + 1}.mp4` })) });
    }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  };
}

async function createHarness(state: NativeState) {
  const links = await linked(state), fetchImpl = createFetch(state);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 5_000, fetchImpl });
  const catalogDirectory = join(process.cwd(), "catalog");
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_WAN26_I2V_GENERATION_CATALOG_VERSION, catalogDirectory));
  const references = new OwnerWan26I2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: MEDIA?.ffprobe ?? "/opt/homebrew/bin/ffprobe", now: () => state.monoNow });
  const preparer = createOwnerWan26I2vRequestPreparer({ referenceService: references, now: () => state.monoNow });
  const service = new OwnerWan26I2vGenerationService({ binding: BINDING, linkService: links, catalog,
    catalog_version: OWNER_WAN26_I2V_GENERATION_CATALOG_VERSION, preparer, resolveChatClient: () => client,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker(), fetchImpl }), () => state.wallNow),
    createModelAccessService: () => new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker: broker(), fetchImpl }), () => state.wallNow),
    now: () => state.wallNow, timeoutMs: 10_000 });
  return { links, client, catalog, references, preparer, service, close: async () => { await service.close(); await references.close(); } };
}

async function createAudioFixtures(t: { skip(message?: string): void }) {
  if (!MEDIA) { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return null; }
  try { await exec(MEDIA.ffmpeg, ["-version"]); await exec(MEDIA.ffprobe, ["-version"]); }
  catch { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return null; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-generation-1661-"));
  const mp3 = join(directory, "tone.mp3"), wav = join(directory, "tone.wav");
  await exec(MEDIA.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.4",
    "-ac", "1", "-ar", "16000", "-codec:a", "libmp3lame", "-q:a", "6", mp3]);
  await exec(MEDIA.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=3.4",
    "-ac", "1", "-ar", "16000", "-codec:a", "pcm_s16le", wav]);
  return { directory, mp3: await readFile(mp3), wav: await readFile(wav) };
}
function input(model_id: typeof MODEL_IDS[number], image_handle: string, prompt: string, audio_handle: string | null) {
  return { attemptId: ATTEMPT, request: { model_id, image_handle, audio_handle, prompt,
    parameters: { resolution: "720P", aspect_ratio: "16:9", video_duration: 6, prompt_extend: true,
      seed: null, native_audio: model_id === "wan_26_i2v_flash" } } };
}
function knownError(code: string) { return (error: unknown) => error instanceof OwnerWan26I2vGenerationServiceError && error.code === code; }
function patchGlobalFetch(): { count(): number; restore(): void } {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("generation test must inject every transport"); };
  return { count: () => calls, restore: () => { globalThis.fetch = original; } };
}

test("runs real owned native generation for both models, image-only and optional MP3/WAV audio, with exact fresh quote keys", async (t) => {
  const fixtures = await createAudioFixtures(t); if (!fixtures) return;
  const state = createNativeState(), harness = await createHarness(state), imageBytes = png384(), fetchGuard = patchGlobalFetch();
  try {
    for (const [index, model_id] of MODEL_IDS.entries()) {
      const image = await harness.references.uploadImage({ attemptId: ATTEMPT, model_id,
        filename: `frame-${index}.png`, mime_type: "image/png", content_base64: imageBytes.toString("base64") });
      const imageOnly = await harness.service.generate(input(model_id, image.image_handle, `image only ${model_id}`, null));
      assert.equal(imageOnly.status, "completed"); assert.equal(imageOnly.model_id, model_id); assert.equal(imageOnly.observed_artifact_count, 1);
      assert.equal(imageOnly.cost_cap_enforced, false); assert.equal(imageOnly.provider_terminal_status, "UNPROVEN");
      assert.equal(imageOnly.backend_acceptance, "UNPROVEN"); assert.equal(imageOnly.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
      assert.equal(imageOnly.artifacts[0]?.object_url.startsWith("https://r2.syntx.ai/generated/"), true);
      const duplicateInput = input(model_id, image.image_handle, `image only ${model_id}`, null);
      await assert.rejects(harness.service.generate(duplicateInput), knownError("INTENT_ALREADY_CLAIMED"));
      assert.equal(state.generationPosts, (index * 2 + 1));
      const fixture = index === 0 ? { bytes: fixtures.mp3, filename: "tone.mp3", mime_type: "audio/mp3" } :
        { bytes: fixtures.wav, filename: "tone.wav", mime_type: "audio/wav" };
      const audio = await harness.references.uploadAudio({ attemptId: ATTEMPT, model_id, filename: fixture.filename,
        mime_type: fixture.mime_type, content_base64: fixture.bytes.toString("base64") });
      const withAudio = await harness.service.generate(input(model_id, image.image_handle, `image and audio ${model_id}`, audio.audio_handle));
      assert.equal(withAudio.model_id, model_id); assert.equal(withAudio.observed_artifact_count, 1);
    }
    assert.equal(state.generationPosts, 4); assert.equal(state.chatCreates, 4);
    assert.equal(state.historyGets, 4); assert.equal(state.resultGets, 4);
    assert.equal(state.quoteReads, 8); assert.equal(state.accountBalanceReads, 8); assert.equal(state.subscriptionReads, 8);
    for (const call of state.costCalls) {
      assert.equal(call.resolution, "720P"); assert.equal(call.video_duration, "6");
      const keys = Object.keys(call).filter((key) => key !== "ai_name" && key !== "model_type").sort();
      if (call.model_type === "wan_26_i2v") {
        assert.deepEqual(keys, ["resolution", "video_duration"]); assert.equal(call.native_audio, undefined);
      } else {
        assert.equal(call.model_type, "wan_26_i2v_flash");
        assert.deepEqual(keys, ["native_audio", "resolution", "video_duration"]); assert.equal(call.native_audio, "true");
      }
    }
    assert.equal(state.videoBodies.every((body) => !JSON.stringify(body).includes("920.5")), true);
    assert.equal(fetchGuard.count(), 0);
  } finally {
    await harness.close(); imageBytes.fill(0); fixtures.mp3.fill(0); fixtures.wav.fill(0);
    await rm(fixtures.directory, { recursive: true, force: true }); fetchGuard.restore();
  }
});

test("stale first subscription preflight happens before permit/chat and does not burn the intent", async () => {
  const state = createNativeState(), harness = await createHarness(state), imageBytes = png384(), fetchGuard = patchGlobalFetch();
  try {
    const image = await harness.references.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_i2v",
      filename: "fresh.png", mime_type: "image/png", content_base64: imageBytes.toString("base64") });
    const request = input("wan_26_i2v", image.image_handle, "retry after fresh account preflight", null);
    state.subscriptionActive = false;
    await assert.rejects(harness.service.generate(request), knownError("PREFLIGHT_FAILED"));
    assert.equal(state.chatCreates, 0); assert.equal(state.generationPosts, 0);
    state.subscriptionActive = true;
    const result = await harness.service.generate(request);
    assert.equal(result.status, "completed"); assert.equal(state.chatCreates, 1); assert.equal(state.generationPosts, 1);
    assert.equal(fetchGuard.count(), 0);
  } finally { await harness.close(); imageBytes.fill(0); fetchGuard.restore(); }
});

test("duplicate intent is rejected while its owner holds the preflight reservation", async () => {
  const state = createNativeState(), harness = await createHarness(state), imageBytes = png384(), fetchGuard = patchGlobalFetch();
  let quoteEntered!: () => void;
  const entered = new Promise<void>((resolve) => { quoteEntered = resolve; });
  try {
    const image = await harness.references.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_i2v_flash",
      filename: "claim.png", mime_type: "image/png", content_base64: imageBytes.toString("base64") });
    const request = input("wan_26_i2v_flash", image.image_handle, "same reserved intent", null);
    state.blockNextQuote = true; state.quoteEntered = quoteEntered;
    const pending = harness.service.generate(request);
    await entered;
    await assert.rejects(harness.service.generate(request), knownError("INTENT_ALREADY_CLAIMED"));
    assert.equal(state.generationPosts, 0); assert.equal(state.chatCreates, 0);
    state.releaseQuote!(response({ access: true, cost: 4, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false }));
    const result = await pending;
    assert.equal(result.status, "completed"); assert.equal(state.generationPosts, 1);
    assert.equal(fetchGuard.count(), 0);
  } finally { await harness.close(); imageBytes.fill(0); fetchGuard.restore(); }
});

test("a rejected concurrent reconcile cannot release another reconcile's busy lock", async () => {
  const state = createNativeState(), harness = await createHarness(state), imageBytes = png384();
  try {
    const image = await harness.references.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_i2v",
      filename: "reconcile-lock.png", mime_type: "image/png", content_base64: imageBytes.toString("base64") });
    state.loseNextStartAck = true;
    let recoveryError: unknown;
    try { await harness.service.generate(input("wan_26_i2v", image.image_handle, "reconcile lock recovery", null)); }
    catch (error) { recoveryError = error; }
    assert.ok(recoveryError instanceof OwnerWan26I2vGenerationServiceError);
    assert.equal(recoveryError.code, "OUTCOME_UNKNOWN");
    const recoveryId = recoveryError.recovery_id;
    assert.ok(recoveryId);

    let signalHistoryEntered!: () => void;
    const historyEntered = new Promise<void>((resolve) => { signalHistoryEntered = resolve; });
    state.historyEntered = signalHistoryEntered;
    state.blockNextHistoryGet = true;
    const first = harness.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    await historyEntered;
    await assert.rejects(harness.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }), knownError("OUTCOME_UNKNOWN"));
    await assert.rejects(harness.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }), knownError("OUTCOME_UNKNOWN"));
    assert.equal(state.historyGets, 1);

    state.releaseHistory?.();
    const completed = await first;
    assert.equal(completed.recovery_id, recoveryId);
    assert.equal(completed.observed_artifact_count, 1);
    assert.equal(state.historyGets, 1);
  } finally {
    state.releaseHistory?.();
    await harness.close(); imageBytes.fill(0);
  }
});

test("second fresh access check can stop before START without a generation POST", async () => {
  const state = createNativeState(), harness = await createHarness(state), imageBytes = png384(), fetchGuard = patchGlobalFetch();
  try {
    const image = await harness.references.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_i2v",
      filename: "preflight.png", mime_type: "image/png", content_base64: imageBytes.toString("base64") });
    state.denyQuoteCall = 2;
    await assert.rejects(harness.service.generate(input("wan_26_i2v", image.image_handle, "second check blocks", null)),
      knownError("PREFLIGHT_FAILED"));
    assert.equal(state.quoteReads, 2); assert.equal(state.accountBalanceReads, 2); assert.equal(state.subscriptionReads, 2);
    assert.equal(state.chatCreates, 1); assert.equal(state.generationPosts, 0);
    assert.equal(fetchGuard.count(), 0);
  } finally { await harness.close(); imageBytes.fill(0); fetchGuard.restore(); }
});

test("lost START acknowledgement recovers GET-only after 16 minutes, candidate pruning and reference expiry", async (t) => {
  const fixtures = await createAudioFixtures(t); if (!fixtures) return;
  const state = createNativeState(), harness = await createHarness(state), imageBytes = png384(), fetchGuard = patchGlobalFetch();
  try {
    const image = await harness.references.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_i2v",
      filename: "recover.png", mime_type: "image/png", content_base64: imageBytes.toString("base64") });
    const request = input("wan_26_i2v", image.image_handle, "recover exact local intent", null);
    state.loseNextStartAck = true; state.pendingFirstResult = true; state.grownHistory = true;
    let recoveryId = "";
    await assert.rejects(harness.service.generate(request), (error: unknown) => {
      if (!(error instanceof OwnerWan26I2vGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
      recoveryId = error.recovery_id ?? ""; return recoveryId.length > 0;
    });
    const postsAtUnknown = state.generationPosts, quoteReadsAtUnknown = state.quoteReads, uploadsAtUnknown = state.imageUploads;
    assert.equal(postsAtUnknown, 1);
    await assert.rejects(harness.service.generate(request), (error: unknown) =>
      error instanceof OwnerWan26I2vGenerationServiceError && error.code === "OUTCOME_UNKNOWN" && error.recovery_id === recoveryId);
    assert.equal(state.generationPosts, postsAtUnknown); assert.equal(state.quoteReads, quoteReadsAtUnknown);
    state.monoNow += 16 * 60_000; state.wallNow += 16 * 60_000;
    await assert.rejects(harness.references.resolveReferences({ attempt_id: ATTEMPT, model_id: "wan_26_i2v",
      image_handle: image.image_handle, audio_handle: null }));
    await assert.rejects(harness.preparer.prepare({ attempt_id: ATTEMPT, model_id: "wan_26_i2v", image_handle: image.image_handle,
      audio_handle: null, prompt: "different, triggers real preparer pruning", parameters: request.request.parameters }));
    await assert.rejects(harness.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }), (error: unknown) =>
      error instanceof OwnerWan26I2vGenerationServiceError && error.code === "OUTCOME_UNKNOWN" &&
      error.recovery_id === recoveryId && error.diagnostic?.gaps.includes("RESULT_PENDING"));
    const secondPage = await harness.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(secondPage.recovery_id, recoveryId); assert.equal(secondPage.observed_artifact_count, 2);
    assert.deepEqual(secondPage.artifacts.map((artifact) => artifact.message_object_id), ["video-object-1", "video-object-2"]);
    assert.equal(secondPage.provider_terminal_status, "UNPROVEN"); assert.equal(secondPage.backend_acceptance, "UNPROVEN");
    const page = await harness.service.getResultPage({ attemptId: ATTEMPT, recovery_id: recoveryId, offset: 1 });
    assert.equal(page.page_size, 1); assert.equal(page.artifacts[0]?.message_object_id, "video-object-2");
    const listed = await harness.service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(listed.length, 1); assert.equal(listed[0]?.recovery_id, recoveryId); assert.equal(listed[0]?.status, "completed");
    assert.equal(state.generationPosts, postsAtUnknown); assert.equal(state.chatCreates, 1);
    assert.equal(state.quoteReads, quoteReadsAtUnknown); assert.equal(state.imageUploads, uploadsAtUnknown);
    assert.equal(fetchGuard.count(), 0);
    await harness.service.invalidateAttempt(ATTEMPT);
    assert.deepEqual(await harness.service.listRecoveries({ attemptId: ATTEMPT }), []);
    await assert.rejects(harness.service.getResultPage({ attemptId: ATTEMPT, recovery_id: recoveryId }), knownError("RECOVERY_NOT_FOUND"));
  } finally {
    await harness.close(); imageBytes.fill(0); fixtures.mp3.fill(0); fixtures.wav.fill(0);
    await rm(fixtures.directory, { recursive: true, force: true }); fetchGuard.restore();
  }
});
