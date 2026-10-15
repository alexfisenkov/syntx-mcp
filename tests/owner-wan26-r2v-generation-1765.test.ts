import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerWan26R2vGenerationService, OwnerWan26R2vGenerationServiceError,
  OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION } from "../src/application/owner-wan26-r2v-generation-service.js";
import { OwnerWan26R2vReferenceService } from "../src/application/owner-wan26-r2v-reference-service.js";
import { createOwnerWan26R2vRequestPreparer } from "../src/application/owner-wan26-r2v-request-preparer.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const ATTEMPT = "link_wan26_r2v_service_0123456789";
const RELINK_ATTEMPT = "link_wan26_r2v_relink_0123456789";
const BINDING = Object.freeze({ tenant_id: "wan26-r2v-service-1765", subject: "owner" });
const TOOLS = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((item) => existsSync(item.ffmpeg) && existsSync(item.ffprobe));
const run = promisify(execFile);
const BASE_TIME = Date.parse("2026-10-16T10:00:00.000Z");
type Model = "wan_26_r2v" | "wan_26_r2v_flash";

interface State {
  now: number; nextChat: number; nextPost: number; posts: number; histories: number; results: number;
  accountReads: number; quoteReads: number; denyQuote: boolean; quoteUnavailable: boolean;
  staleAccount: boolean; subscriptionActive: boolean; loseNextAck: boolean; pendingNextResult: boolean;
  postGate?: { readonly entered: Promise<void>; readonly markEntered: () => void; readonly wait: Promise<void>; readonly release: () => void };
  chats: Map<string, { model: Model; prompt: string; ack: string; result: string; object: string; secondObject: string }>;
  costCalls: Record<string, string>[];
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function image384(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(use: (credential: string) => Promise<T>) { return use("synthetic-wan26-r2v-1765-token"); } };
}
function freshState(): State {
  return { now: BASE_TIME, nextChat: 0, nextPost: 0, posts: 0, histories: 0, results: 0, accountReads: 0, quoteReads: 0,
    denyQuote: false, quoteUnavailable: false, staleAccount: false, subscriptionActive: true,
    loseNextAck: false, pendingNextResult: false, chats: new Map(), costCalls: [] };
}
async function linked(state: State): Promise<PerUserLinkService> {
  const attempts = [ATTEMPT, RELINK_ATTEMPT]; let nextAttempt = 0;
  const provider: AuthLinkProvider = { authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "r2v-1765", approval_url: "https://example.invalid/approval" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-link-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => state.now), {
    now: () => state.now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => attempts[nextAttempt++] ?? ATTEMPT
  });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT); return links;
}
function parameters(model: "wan_26_r2v"): { resolution: "1080P"; aspect_ratio: "16:9"; video_duration: 6; seed: number; native_audio?: never };
function parameters(model: "wan_26_r2v_flash"): { resolution: "1080P"; aspect_ratio: "16:9"; video_duration: 6; seed: number; native_audio: boolean };
function parameters(model: Model) {
  const common = { resolution: "1080P" as const, aspect_ratio: "16:9" as const, video_duration: 6 as const, seed: 17 };
  return model === "wan_26_r2v_flash" ? { ...common, native_audio: false } : common;
}

test("WAN26 R2V app service quotes exact finite parameters and reconciles an ambiguous POST with GET only", async (t) => {
  if (!TOOLS) { t.skip("ffmpeg/ffprobe pair unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "wan26-r2v-generation-1765-"));
  const state = freshState(), links = await linked(state), png = image384();
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 5_000, fetchImpl: async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    if (method === "GET" && url.pathname.endsWith("/user/balance")) { state.accountReads += 1; return response({ balance: "920.5" }); }
    if (method === "GET" && url.pathname.endsWith("/user/subscription")) {
      state.accountReads += 1; return response({ active: state.subscriptionActive, type: "PRO", end_date: new Date(state.now + 3_600_000).toISOString() });
    }
    if (method === "GET" && url.pathname.endsWith("/get_model_info")) {
      state.quoteReads += 1; const keys = Object.fromEntries(url.searchParams.entries()); state.costCalls.push(keys);
      if (state.quoteUnavailable) throw new Error("synthetic quote transport unavailable");
      return response({ access: !state.denyQuote, cost: state.denyQuote ? null : 7.5, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (method === "POST" && url.pathname.endsWith("/chats/upload-files")) {
      const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File);
      const video = file.type === "video/mp4", kind = video ? "video" : "image";
      return response({ files: [{ id: `upload-${file.name}`, filename: file.name, url: `https://r2.syntx.ai/r2v/${file.name}`,
        mime_type: file.type, content_type: file.type, type: kind, media_type: kind, status: "uploaded", size: file.size }] });
    }
    if (method === "POST" && url.pathname.endsWith("/chats")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>; assert.deepEqual(Object.keys(body), ["title", "scope"]);
      assert.equal(body.scope, "video"); const chat = `service-chat-${++state.nextChat}`; return response({ uuid: chat });
    }
    if (method === "POST" && url.pathname.endsWith("/video/generate")) {
      assert.equal(url.search, "?ai_name=wan_video"); const body = JSON.parse(String(init?.body)) as Record<string, any>;
      const model = body.settings.model_type as Model; assert.ok(model === "wan_26_r2v" || model === "wan_26_r2v_flash");
      assert.equal(body.settings.file_urls.length, 2); assert.deepEqual(body.settings.file_urls.map((item: { type: string }) => item.type), ["video", "image"]);
      state.posts += 1; state.nextPost += 1; const ack = `owner-ack-${state.nextPost}`;
      const result = `result-${state.nextPost}`, object = `video-object-${state.nextPost}`, secondObject = `video-object-${state.nextPost}-2`;
      state.chats.set(body.chat_id, { model, prompt: body.prompt, ack, result, object, secondObject });
      const postGate = state.postGate; delete state.postGate;
      if (postGate) { postGate.markEntered(); await postGate.wait; }
      if (state.loseNextAck) { state.loseNextAck = false; throw new Error("synthetic lost POST acknowledgement"); }
      return response({ id: ack });
    }
    if (method === "GET" && url.pathname.endsWith("/messages")) {
      state.histories += 1; const chatId = decodeURIComponent(url.pathname.split("/").at(-2)!); const item = state.chats.get(chatId);
      assert.ok(item); assert.equal(url.searchParams.get("page"), "1"); assert.equal(url.searchParams.get("page_size"), "10");
      const messages = [
        { id: item.ack, chat_id: 77265, author_id: 27, message_object: [{ id: `${item.ack}-text`, message_id: item.ack,
          object_type: "text", model_type: item.model, object_text: item.prompt }] },
        { id: item.result, chat_id: 77265, author_id: -1, message_object: [
          { id: item.object, message_id: item.result, object_type: "video", model_type: item.model, completed: true },
          { id: item.secondObject, message_id: item.result, object_type: "video", model_type: item.model, completed: true }
        ] }
      ];
      return response({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (method === "GET" && /\/chats\/[^/]+\/[^/]+$/u.test(url.pathname)) {
      state.results += 1; const parts = url.pathname.split("/").filter(Boolean), chatId = decodeURIComponent(parts.at(-2)!);
      const item = state.chats.get(chatId); assert.ok(item);
      const pending = state.pendingNextResult; state.pendingNextResult = false;
      return response({ id: item.result, chat_id: 77265, author_id: -1, message_object: [
        { id: item.object, message_id: item.result, object_type: "video", model_type: item.model, completed: !pending,
          object_url: pending ? null : `https://r2.syntx.ai/r2v/results/${item.object}.mp4` },
        { id: item.secondObject, message_id: item.result, object_type: "video", model_type: item.model, completed: !pending,
          object_url: pending ? null : `https://r2.syntx.ai/r2v/results/${item.secondObject}.webm` }
      ] });
    }
    throw new Error(`unexpected synthetic route ${method} ${url.pathname}`);
  } });
  const referenceService = new OwnerWan26R2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffmpegPath: TOOLS.ffmpeg, ffprobePath: TOOLS.ffprobe, now: () => state.now });
  const preparer = createOwnerWan26R2vRequestPreparer({ binding: BINDING, linkService: links, referenceService, now: () => state.now });
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION, join(process.cwd(), "catalog")));
  const service = new OwnerWan26R2vGenerationService({ binding: BINDING, linkService: links, catalog,
    catalog_version: OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION, preparer, referenceService, resolveChatClient: () => client,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker(), fetchImpl: clientFetch(state) }),
      () => state.now - (state.staleAccount ? 300_000 : 0)),
    createModelAccessService: () => new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker: broker(), fetchImpl: clientFetch(state) }), () => state.now),
    now: () => state.now, timeoutMs: 15_000 });
  try {
    const source = join(directory, "source.mp4");
    await run(TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=384x384:rate=24:duration=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", source]);
    const videoBytes = new Uint8Array(await readFile(source));
    const handles = new Map<Model, readonly string[]>(), durations = new Map<Model, number>();
    for (const model of ["wan_26_r2v", "wan_26_r2v_flash"] as const) {
      const imageReceipt = await referenceService.uploadImage({ attemptId: ATTEMPT, model_id: model,
        content_base64: png.toString("base64"), filename: `${model}.png`, mime_type: "image/png" });
      const videoReceipt = await referenceService.uploadSelectedVideo({ attemptId: ATTEMPT, model_id: model,
        content_base64: Buffer.from(videoBytes).toString("base64"), filename: `${model}.mp4`, mime_type: "video/mp4",
        start_seconds: 0, end_seconds: 0.8, total_reference_count: 2 });
      handles.set(model, [videoReceipt.reference_handle, imageReceipt.reference_handle]);
      durations.set(model, Math.round(videoReceipt.selected_duration_seconds! * 100) / 100);
    }
    const originalIntent = await preparer.prepare({ attemptId: ATTEMPT, model_id: "wan_26_r2v", prompt: "regular\nsecond line",
      parameters: parameters("wan_26_r2v"), reference_handles: handles.get("wan_26_r2v")! });
    const originalIntentFingerprint = preparer.inspectCandidate(originalIntent)!.intent_fingerprint;
    state.loseNextAck = true;
    await assert.rejects(service.generate({ attemptId: ATTEMPT, request: { model_id: "wan_26_r2v", prompt: "regular\nsecond line",
      parameters: parameters("wan_26_r2v"), reference_handles: handles.get("wan_26_r2v")! } }),
    (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "OUTCOME_UNKNOWN" && !!error.recovery_id);
    const recoveryId = [...(await service.listRecoveries({ attemptId: ATTEMPT }))][0]?.recovery_id; assert.ok(recoveryId);
    assert.equal(state.posts, 1); assert.equal(state.histories, 0, "lost start acknowledgement returns unknown without dispatch replay");
    await assert.rejects(service.generate({ attemptId: ATTEMPT, request: { model_id: "wan_26_r2v", prompt: "regular\nsecond line",
      parameters: parameters("wan_26_r2v"), reference_handles: handles.get("wan_26_r2v")! } }),
    (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "INTENT_ALREADY_CLAIMED");
    assert.equal(state.posts, 1, "same intent remains claimed after an ambiguous POST");
    await assert.rejects(service.reconcile({ attemptId: "link_foreign_owner_0123456789", recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "PRINCIPAL_NOT_LINKED");
    state.pendingNextResult = true;
    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "OUTCOME_UNKNOWN" &&
        error.diagnostic?.gaps.includes("RESULT_PENDING") === true && error.diagnostic.pending_object_indices.length === 2);
    assert.deepEqual(Object.keys(state.costCalls[0]!).sort(), ["ai_name", "duration", "model_type", "resolution", "video_duration"]);
    assert.equal(state.costCalls[0]?.ai_name, "wan_video"); assert.equal(state.costCalls[0]?.model_type, "wan_26_r2v");
    assert.equal(Number(state.costCalls[0]?.duration), durations.get("wan_26_r2v"),
      "cost duration follows selected crop receipt, not the caller's video_duration setting");

    const flash = await service.generate({ attemptId: ATTEMPT, request: { model_id: "wan_26_r2v_flash", prompt: "flash prompt\nline two",
      parameters: parameters("wan_26_r2v_flash"), reference_handles: handles.get("wan_26_r2v_flash")! } });
    assert.equal(flash.status, "completed"); assert.equal(flash.model_id, "wan_26_r2v_flash"); assert.equal(flash.artifacts.length, 2);
    assert.equal(flash.page_size, 64);
    assert.deepEqual(Object.keys(state.costCalls[2]!).sort(), ["ai_name", "duration", "model_type", "native_audio", "resolution", "video_duration"]);
    assert.equal(state.costCalls[2]?.ai_name, "wan_video"); assert.equal(state.costCalls[2]?.model_type, "wan_26_r2v_flash");
    assert.equal(state.posts, 2);

    state.denyQuote = true;
    const before = state.posts;
    await assert.rejects(service.generate({ attemptId: ATTEMPT, request: { model_id: "wan_26_r2v", prompt: "denied quote",
      parameters: parameters("wan_26_r2v"), reference_handles: handles.get("wan_26_r2v")! } }),
    (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    assert.equal(state.posts, before, "access=false quote is denied before the generation POST");
    state.denyQuote = false; state.subscriptionActive = false;
    await assert.rejects(service.generate({ attemptId: ATTEMPT, request: { model_id: "wan_26_r2v", prompt: "inactive account",
      parameters: parameters("wan_26_r2v"), reference_handles: handles.get("wan_26_r2v")! } }),
    (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    state.subscriptionActive = true; state.staleAccount = true;
    await assert.rejects(service.generate({ attemptId: ATTEMPT, request: { model_id: "wan_26_r2v", prompt: "stale account",
      parameters: parameters("wan_26_r2v"), reference_handles: handles.get("wan_26_r2v")! } }),
    (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    state.staleAccount = false; state.quoteUnavailable = true;
    await assert.rejects(service.generate({ attemptId: ATTEMPT, request: { model_id: "wan_26_r2v", prompt: "quote unavailable",
      parameters: parameters("wan_26_r2v"), reference_handles: handles.get("wan_26_r2v")! } }),
    (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    state.quoteUnavailable = false;
    assert.equal(state.posts, before, "inactive, stale, and unavailable current preflight all stop before POST");
    assert.ok(state.accountReads >= 16); assert.equal(state.quoteReads, 8);

    const beforeAbort = { posts: state.posts, quotes: state.quoteReads, accounts: state.accountReads, chats: state.nextChat,
      histories: state.histories, results: state.results };
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const activeRuns = controllers.map((controller, index) => service.generate({ attemptId: ATTEMPT, request: {
      model_id: "wan_26_r2v", prompt: `busy cancellation ${index}`, parameters: parameters("wan_26_r2v"),
      reference_handles: handles.get("wan_26_r2v")!
    } }, controller.signal));
    assert.throws(() => service.generate({ attemptId: ATTEMPT, request: { model_id: "wan_26_r2v", prompt: "over capacity",
      parameters: parameters("wan_26_r2v"), reference_handles: handles.get("wan_26_r2v")! } }),
    (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "SERVICE_BUSY");
    for (const controller of controllers) controller.abort();
    await Promise.allSettled(activeRuns);
    assert.deepEqual({ posts: state.posts, quotes: state.quoteReads, accounts: state.accountReads, chats: state.nextChat,
      histories: state.histories, results: state.results }, beforeAbort,
      "pre-aborted runs start no account, quote, chat, or generation I/O");

    const postGate = createPostGate(); state.postGate = postGate;
    const heldGeneration = service.generate({ attemptId: ATTEMPT, request: { model_id: "wan_26_r2v", prompt: "initial generation held",
      parameters: parameters("wan_26_r2v"), reference_handles: handles.get("wan_26_r2v")! } });
    await postGate.entered;
    const heldRecoveryId = (await service.listRecoveries({ attemptId: ATTEMPT, limit: 1 }))[0]?.recovery_id; assert.ok(heldRecoveryId);
    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: heldRecoveryId }),
      (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "SERVICE_BUSY");
    await assert.rejects(service.reconcile({ attemptId: "link_foreign_busy_0123456789", recovery_id: heldRecoveryId }),
      (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "PRINCIPAL_NOT_LINKED");
    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: heldRecoveryId }),
      (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "SERVICE_BUSY",
      "foreign reconcile cannot release the initial generation observer lock");
    postGate.release();
    const heldResult = await heldGeneration;
    assert.equal(heldResult.status, "completed"); assert.equal(heldResult.page_size, 64);

    state.now += 15 * 60_000 + 1_000;
    const recovered = await service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(recovered.status, "completed"); assert.equal(recovered.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(recovered.provider_terminal_status, "UNPROVEN"); assert.equal(recovered.cost_cap_enforced, false);
    assert.equal(recovered.source_binding.source_readiness, "PARTIAL_SOURCE_EXPLICIT_SETTINGS");
    assert.deepEqual(recovered.diagnostic.gaps, [], "a later successful observation clears prior pending gaps");
    assert.deepEqual(recovered.diagnostic.pending_object_indices, []);
    assert.equal(recovered.artifacts.length, 2); assert.deepEqual(recovered.artifacts.map((artifact) => artifact.object_index), [0, 1]);
    assert.deepEqual(recovered.artifacts.map((artifact) => artifact.mime_type), ["video/mp4", "video/webm"]);
    assert.equal(recovered.page_size, 64);
    assert.equal(state.posts, 3, "expired prepared input does not cause a second generation POST during GET-only recovery");
    assert.equal(state.histories, 4); assert.equal(state.results, 4);
    await service.invalidateAttempt(ATTEMPT);
    await assert.rejects(service.getResultPage({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "RECOVERY_NOT_FOUND");
    await links.createAttempt(BINDING); await links.issueHandoff(BINDING, RELINK_ATTEMPT); await links.checkAttempt(BINDING, RELINK_ATTEMPT);
    const relinkImage = await referenceService.uploadImage({ attemptId: RELINK_ATTEMPT, model_id: "wan_26_r2v",
      content_base64: png.toString("base64"), filename: "wan_26_r2v.png", mime_type: "image/png" });
    const relinkVideo = await referenceService.uploadSelectedVideo({ attemptId: RELINK_ATTEMPT, model_id: "wan_26_r2v",
      content_base64: Buffer.from(videoBytes).toString("base64"), filename: "wan_26_r2v.mp4", mime_type: "video/mp4",
      start_seconds: 0, end_seconds: 0.8, total_reference_count: 2 });
    const relinkHandles = [relinkVideo.reference_handle, relinkImage.reference_handle];
    const relinkCandidate = await preparer.prepare({ attemptId: RELINK_ATTEMPT, model_id: "wan_26_r2v", prompt: "regular\nsecond line",
      parameters: parameters("wan_26_r2v"), reference_handles: relinkHandles });
    assert.equal(preparer.inspectCandidate(relinkCandidate)!.intent_fingerprint, originalIntentFingerprint,
      "same owner intent and source bytes produce the same fingerprint after a new auth connection");
    const beforeReplay = { posts: state.posts, quotes: state.quoteReads, chats: state.nextChat };
    await assert.rejects(service.generate({ attemptId: RELINK_ATTEMPT, request: { model_id: "wan_26_r2v", prompt: "regular\nsecond line",
      parameters: parameters("wan_26_r2v"), reference_handles: relinkHandles } }),
    (error: unknown) => error instanceof OwnerWan26R2vGenerationServiceError && error.code === "INTENT_ALREADY_CLAIMED");
    assert.deepEqual({ posts: state.posts, quotes: state.quoteReads, chats: state.nextChat }, beforeReplay,
      "invalidation and relinking cannot replay an ambiguous paid intent");
    assert.deepEqual(await service.listRecoveries({ attemptId: RELINK_ATTEMPT }), []);
    await service.invalidateAttempt("link_untracked_attempt_0123456789");
    const invalidation = service.invalidateAttempt(RELINK_ATTEMPT);
    assert.strictEqual(service.invalidateAttempt(RELINK_ATTEMPT), invalidation, "same-attempt invalidation coalesces to one promise");
    let closeFinished = false;
    const closing = service.close().then(() => { closeFinished = true; });
    assert.equal(closeFinished, false, "close waits for an invalidation already in progress");
    await closing;
    assert.equal(closeFinished, true);
    await assert.doesNotReject(() => service.invalidateAttempt(RELINK_ATTEMPT), "invalidate after close is an idempotent no-op");
  } finally {
    await service.close(); await referenceService.close(); await rm(directory, { recursive: true, force: true });
  }
});

function createPostGate(): NonNullable<State["postGate"]> {
  let markEntered!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { entered, markEntered, wait, release };
}

function clientFetch(state: State): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/user/balance")) { state.accountReads += 1; return response({ balance: "920.5" }); }
    if (url.pathname.endsWith("/user/subscription")) {
      state.accountReads += 1; return response({ active: state.subscriptionActive, type: "PRO", end_date: new Date(state.now + 3_600_000).toISOString() });
    }
    if (url.pathname.endsWith("/get_model_info")) {
      state.quoteReads += 1; const keys = Object.fromEntries(url.searchParams.entries()); state.costCalls.push(keys);
      if (state.quoteUnavailable) throw new Error("synthetic quote transport unavailable");
      return response({ access: !state.denyQuote, cost: state.denyQuote ? null : 7.5, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: false });
    }
    throw new Error(`unexpected preflight route ${init?.method ?? "GET"} ${url.pathname}`);
  };
}
