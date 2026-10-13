import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import type { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { OwnerSeedreamEditorOriginalReferenceService } from "../src/application/owner-seedream-editor-original-reference-service.js";
import { OwnerSeedreamEditorDrawingReferenceService } from "../src/application/owner-seedream-editor-drawing-reference-service.js";
import { OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION as C5, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION as SETTINGS_62 } from "../src/application/owner-seedream-editor-original-upload-source-profile.js";
import { createOwnerSeedreamEditorImageGenerationService } from "../src/application/owner-seedream-editor-image-generation-service.js";

const ATTEMPT = "link_seedream_editor_generation_0123456789";
const RELINKED = "link_seedream_editor_relinked_0123456789";
const BINDING = Object.freeze({ tenant_id: "seedream-editor-generation-tenant", subject: "seedream-editor-generation-subject" });
const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
function response(value: unknown): Response { return Response.json(value); }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (credential: string) => Promise<T>) { return fn("synthetic-editor-generation-credential"); } }; }

function fixture(options: { objects?: number; resultMessages?: number; unknownPost?: boolean; historyInitiallyEmpty?: boolean; access?: boolean;
  blockPoll?: boolean; expiredSubscription?: boolean; delayedChat?: boolean; invalidateNativeDuringPost?: boolean } = {}) {
  let currentNow = NOW;
  let linked = true;
  let upload = 0, chats = 0, generationPosts = 0, accountReads = 0, modelReads = 0, resultGets = 0, historyGets = 0;
  let chatStarted = false, accountReadsAfterChat = 0, modelReadsAfterChat = 0;
  let historyReady = !options.historyInitiallyEmpty;
  let waitStarted!: () => void;
  const pollWaitEntered = new Promise<void>((resolve) => { waitStarted = resolve; });
  const objectCount = options.objects ?? 1, resultMessages = options.resultMessages ?? 1;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats/upload-files" && init?.method === "POST") {
      upload += 1; const form = init.body as FormData, destination = form.get("destination");
      return response({ files: [{ id: `editor-${upload}`, file_id: `editor-${upload}`, url: `https://r2.syntx.ai/editor/${upload}.png`,
        ...(destination === "uploaded" ? { mime_type: "image/png", size: PNG.length, status: "accepted" } : {}) }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") { chats += 1; chatStarted = true;
      if (options.delayedChat) currentNow += 31_000;
      return response({ uuid: `editor-chat-${chats}` }); }
    if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") { generationPosts += 1;
      if (options.invalidateNativeDuringPost) chatClient.invalidateSeedreamEditorImageAttempt(ATTEMPT);
      if (options.unknownPost) throw new Error("synthetic POST response lost after possible dispatch");
      return response({ id: `editor-ack-${generationPosts}` }); }
    if (/\/api\/v1\/chats\/[^/]+\/inprogress$/u.test(url.pathname)) return response([]);
    if (/\/api\/v1\/chats\/[^/]+\/messages$/u.test(url.pathname)) {
      historyGets += 1;
      const chat = url.pathname.split("/").at(-2)!;
      const rows = historyReady ? Array.from({ length: resultMessages }, (_, messageIndex) => ({
        id: `editor-result-${messageIndex + 1}`, chat_id: 742, author_id: -1, message_object: Array.from({ length: objectCount }, (_, index) => ({
          id: `editor-object-${messageIndex + 1}-${index}`, message_id: `editor-result-${messageIndex + 1}`, object_type: "image",
          model_type: "seedream-5.0-pro"
        }))
      })) : [];
      const messages = options.unknownPost ? rows : [{ id: "editor-ack-1", chat_id: 742, author_id: 7, message_object: [] }, ...rows];
      return response({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
        total_pages: messages.length === 0 ? 0 : Math.ceil(messages.length / 10), has_next: false, has_previous: false }, chat_uuid: chat });
    }
    if (/\/api\/v1\/chats\/editor-chat-\d+\/editor-result-\d+$/u.test(url.pathname)) {
      resultGets += 1; const id = url.pathname.split("/").at(-1)!; const messageIndex = Number(id.slice("editor-result-".length));
      return response({ id, chat_id: 742, author_id: -1, message_object: Array.from({ length: objectCount }, (_, index) => ({
        id: `editor-object-${messageIndex}-${index}`, object_type: "image",
        object_url: `https://r2.syntx.ai/editor/result-${messageIndex}-${index}.webp`, completed: true, model_type: "seedream-5.0-pro"
      })) });
    }
    if (url.pathname === "/api/v1/user/balance") { accountReads += 1; if (chatStarted) accountReadsAfterChat += 1; return response({ balance: "900" }); }
    if (url.pathname === "/api/v1/user/subscription") { accountReads += 1; if (chatStarted) accountReadsAfterChat += 1; return response({ active: true, type: "PRO",
      end_date: options.expiredSubscription ? "2020-01-01T00:00:00.000Z" : "2099-12-31T00:00:00.000Z" }); }
    if (url.pathname === "/api/v2/get_model_info") { modelReads += 1; if (chatStarted) modelReadsAfterChat += 1;
      return response({ access: options.access ?? true, cost: 3, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: null }); }
    throw new Error(`Unexpected synthetic request ${init?.method ?? "GET"} ${url.pathname}`);
  };
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return { attempt_id: attemptId,
    authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const, status: linked ? "LINKED" as const : "UNLINKED" as const,
    expires_at: null, linked }; } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl, requestTimeoutMs: 2_000 });
  const httpClient = new SyntxHttpClient({ credentialBroker: broker(), fetchImpl, requestTimeoutMs: 2_000 });
  const catalog = loadSelectedDiscoveryCatalog(C5, join(process.cwd(), "catalog")).discoveryCatalog;
  const settings = loadMaplessSettingsInventoryVersion(SETTINGS_62, join(process.cwd(), "catalog"));
  const originalReferenceService = new OwnerSeedreamEditorOriginalReferenceService({ binding: BINDING, linkService, catalog,
    public_catalog_version: C5, settings_inventory: settings, settings_inventory_version: SETTINGS_62,
    resolveClient: () => chatClient, now: () => NOW });
  const drawingReferenceService = new OwnerSeedreamEditorDrawingReferenceService({ originalReferenceService, binding: BINDING,
    linkService, catalog, public_catalog_version: C5, settings_inventory: settings, settings_inventory_version: SETTINGS_62,
    resolveClient: () => chatClient, now: () => NOW });
  const service = createOwnerSeedreamEditorImageGenerationService({ binding: BINDING, linkService, originalReferenceService,
    drawingReferenceService, resolveChatClient: () => chatClient,
    createAccountStatusService: () => new AccountStatusService(httpClient, () => currentNow),
    createModelAccessService: (_attemptId: string, inputCatalog: DiscoveryCatalogRepository) => new ModelAccessService(inputCatalog, httpClient, () => currentNow),
    now: () => currentNow, pollDelayMs: 0, maxPollAttempts: 1,
    ...(options.blockPoll ? { wait: async (_ms: number, signal: AbortSignal) => { waitStarted();
      await new Promise<void>((_resolve, reject) => { if (signal.aborted) { reject(new Error("aborted")); return; }
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); }); } } : {}) });
  return { service, originalReferenceService, drawingReferenceService, setHistoryReady(value: boolean) { historyReady = value; },
    setLinked(value: boolean) { linked = value; },
    chatClient, latestChatUuid: () => chats === 0 ? null : `editor-chat-${chats}`, historyGetCount: () => historyGets,
    waitForPoll: () => pollWaitEntered,
    setNow(value: number) { currentNow = value; },
    freshnessCounts: () => ({ accountReadsAfterChat, modelReadsAfterChat }),
    counts: () => ({ upload, chats, generationPosts, accountReads, modelReads, resultGets }) };
}

test("Editor generation publishes a native owner service and preserves the source-derived cost and actual results", async (t) => {
  const f = fixture(); t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  const original = await f.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-pro",
    content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" });
  const drawing = await f.drawingReferenceService.uploadDrawing({ attemptId: ATTEMPT, variant: "seedream-5.0-pro",
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "drawing.png", mime_type: "image/png" });
  const result = await f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5.0-pro", prompt: "synthetic editor flow",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: drawing.drawing_handle } });
  assert.equal(result.status, "completed"); assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal(result.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
  assert.equal(result.requested_model, "seedream-5.0-pro"); assert.equal(result.model_echo, "MATCHED");
  assert.deepEqual(result.cost_inputs, { batch_size: 2, resolution: "2K" });
  assert.equal(result.observed_total, 1); assert.equal(result.artifacts[0]?.url, "https://r2.syntx.ai/editor/result-1-0.webp");
  assert.equal(result.artifacts[0]?.width, null); assert.equal(result.artifacts[0]?.geometry_verified, false);
  assert.deepEqual(f.counts(), { upload: 2, chats: 1, generationPosts: 1, accountReads: 4, modelReads: 2, resultGets: 1 });
});

test("caches every observed image and reads page two without another provider request", async (t) => {
  const f = fixture({ objects: 40, resultMessages: 2 });
  t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  const original = await f.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-pro",
    content_base64: PNG.toString("base64"), filename: "page-original.png", mime_type: "image/png" });
  const result = await f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5.0-pro", prompt: "all observations",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: null } });
  assert.equal(result.observed_total, 80); assert.equal(result.artifacts.length, 64); assert.equal(result.next_offset, 64);
  assert.equal(result.has_more, true); assert.deepEqual(result.cost_inputs, { batch_size: 1, resolution: "2K" });
  const before = f.counts();
  const page = await f.service.getResultPage({ attemptId: ATTEMPT, result_id: result.result_id, offset: 64 });
  assert.equal(page.artifacts.length, 16); assert.equal(page.next_offset, null); assert.equal(page.has_more, false);
  await assert.rejects(() => f.service.getResultPage({ attemptId: RELINKED, result_id: result.result_id, offset: 64 }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "RESULT_NOT_FOUND");
  assert.deepEqual(f.counts(), before, "a cached page must issue no provider GET or POST");
});

test("possible POST timeout keeps semantic claim and recovery performs GET-only reconciliation", async (t) => {
  const f = fixture({ unknownPost: true, historyInitiallyEmpty: true });
  t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  const original = await f.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-pro",
    content_base64: PNG.toString("base64"), filename: "unknown-original.png", mime_type: "image/png" });
  let recoveryId = "";
  await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5.0-pro", prompt: "unknown POST",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: null } }),
  (error: unknown) => { if (!(error instanceof Error) || !("code" in error) || error.code !== "OUTCOME_UNKNOWN" ||
      !("recovery_id" in error) || typeof error.recovery_id !== "string") return false; recoveryId = error.recovery_id; return true; });
  f.setHistoryReady(true);
  const recovered = await f.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
  assert.equal(recovered.status, "partial_results", "ACK-unavailable recovery reports observed outputs without claiming terminality");
  assert.equal(recovered.model_echo, "MATCHED"); assert.equal(recovered.artifacts.length, 1);
  await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5.0-pro", prompt: "unknown POST",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: null } }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "INTENT_ALREADY_CLAIMED");
  const relinkedOriginal = await f.originalReferenceService.upload({ attemptId: RELINKED, variant: "seedream-5.0-pro",
    content_base64: PNG.toString("base64"), filename: "same-content-relinked.png", mime_type: "image/png" });
  await assert.rejects(() => f.service.generate({ attemptId: RELINKED, input: { variant: "seedream-5.0-pro", prompt: "unknown POST",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: relinkedOriginal.reference_handle, drawing_handle: null } }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "INTENT_ALREADY_CLAIMED");
  assert.equal(f.counts().generationPosts, 1, "uncertain generation is never replayed");
});

test("ACKed Editor recovery remains GET-only after candidate TTL while the same principal stays linked", async (t) => {
  const f = fixture({ historyInitiallyEmpty: true });
  t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  const original = await f.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-pro",
    content_base64: PNG.toString("base64"), filename: "long-job-original.png", mime_type: "image/png" });
  let recoveryId = "";
  await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5.0-pro", prompt: "long Editor job",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: null } }),
  (error: unknown) => { if (!(error instanceof Error) || !("code" in error) || error.code !== "OUTCOME_UNKNOWN" ||
      !("recovery_id" in error) || typeof error.recovery_id !== "string") return false; recoveryId = error.recovery_id; return true; });
  assert.deepEqual(f.counts(), { upload: 1, chats: 1, generationPosts: 1, accountReads: 4, modelReads: 2, resultGets: 0 });

  f.setNow(NOW + 16 * 60_000);
  f.setHistoryReady(true);
  const recoveries = await f.service.listRecoveries({ attemptId: ATTEMPT });
  assert.ok(recoveries.some((item) => item.recovery_id === recoveryId), "unknown recovery remains in the bounded ledger after input TTL");
  const recovered = await f.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
  assert.equal(recovered.status, "completed");
  assert.equal(recovered.artifacts.length, 1);
  assert.equal(recovered.artifacts[0]?.url, "https://r2.syntx.ai/editor/result-1-0.webp");
  const page = await f.service.getResultPage({ attemptId: ATTEMPT, result_id: recovered.result_id, offset: 0 });
  assert.equal(page.artifacts.length, 1, "cached result pages remain available after candidate TTL when freshly linked");
  f.setLinked(false);
  await assert.rejects(() => f.service.getResultPage({ attemptId: ATTEMPT, result_id: recovered.result_id, offset: 0 }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_NOT_LINKED");
  f.setLinked(true);
  assert.deepEqual(f.counts(), { upload: 1, chats: 1, generationPosts: 1, accountReads: 4, modelReads: 2, resultGets: 1 },
    "post-dispatch recovery performs only history/result GETs and never uploads or repeats generation");
});

test("lost-ACK Editor recovery witness survives a long POST and reconciles without candidate TTL", async (t) => {
  const f = fixture({ unknownPost: true, historyInitiallyEmpty: true });
  t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  const original = await f.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-pro",
    content_base64: PNG.toString("base64"), filename: "lost-ack-long-original.png", mime_type: "image/png" });
  let recoveryId = "";
  await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5.0-pro", prompt: "lost ACK long Editor job",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: null } }),
  (error: unknown) => { if (!(error instanceof Error) || !("code" in error) || error.code !== "OUTCOME_UNKNOWN" ||
      !("recovery_id" in error) || typeof error.recovery_id !== "string") return false; recoveryId = error.recovery_id; return true; });

  f.setNow(NOW + 16 * 60_000);
  f.setHistoryReady(true);
  const recoveries = await f.service.listRecoveries({ attemptId: ATTEMPT });
  assert.ok(recoveries.some((item) => item.recovery_id === recoveryId), "lost-ACK recovery remains visible after input TTL");
  const recovered = await f.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
  assert.equal(recovered.status, "partial_results", "lost owner ACK stays conservatively partial despite a bound bot result");
  assert.equal(recovered.artifacts.length, 1);
  assert.deepEqual(f.counts(), { upload: 1, chats: 1, generationPosts: 1, accountReads: 4, modelReads: 2, resultGets: 1 },
    "lost-ACK reconciliation is read-only after POST and does not repeat upload or generation");
});

test("fresh model-access denial stops before chat creation and generation POST", async (t) => {
  const f = fixture({ access: false });
  t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  const original = await f.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5",
    content_base64: PNG.toString("base64"), filename: "denied-original.png", mime_type: "image/png" });
  await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5", prompt: "denied",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: null } }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "PREFLIGHT_FAILED");
  assert.deepEqual(f.counts(), { upload: 1, chats: 0, generationPosts: 0, accountReads: 2, modelReads: 1, resultGets: 0 });
});

test("pre-aborted request and revoked proxy are rejected without leaking errors or dispatch", async (t) => {
  const f = fixture(); t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assert.throws(() => f.service.generate(revoked.proxy), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5", prompt: "already cancelled",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: "synthetic-handle", drawing_handle: null } }, controller.signal),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "PRE_DISPATCH_FAILED");
  assert.equal(f.counts().chats, 0); assert.equal(f.counts().generationPosts, 0);
});

test("expired offset subscription is denied before creating the Editor chat", async (t) => {
  const f = fixture({ expiredSubscription: true });
  t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5", prompt: "expired plan",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: "synthetic-handle", drawing_handle: null } }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "PREFLIGHT_FAILED");
  assert.equal(f.counts().chats, 0); assert.equal(f.counts().generationPosts, 0);
});

test("second preflight is refreshed after a slow chat creation", async (t) => {
  const f = fixture({ delayedChat: true });
  t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  const original = await f.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-pro",
    content_base64: PNG.toString("base64"), filename: "slow-chat-original.png", mime_type: "image/png" });
  const result = await f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5.0-pro", prompt: "fresh after chat",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: null } });
  assert.equal(result.status, "completed");
  assert.deepEqual(f.freshnessCounts(), { accountReadsAfterChat: 2, modelReadsAfterChat: 1 });
});

test("expired owned original is rejected before creating the Editor chat or dispatching", async (t) => {
  const f = fixture(); t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  const original = await f.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5",
    content_base64: PNG.toString("base64"), filename: "expiring-original.png", mime_type: "image/png" });
  f.setNow(NOW + 15 * 60_000);
  await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5", prompt: "expired source",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: null } }));
  assert.equal(f.counts().generationPosts, 0); assert.equal(f.counts().chats, 0);
});

test("invalidation aborts and drains an active post before returning", async (t) => {
  const f = fixture({ historyInitiallyEmpty: true, blockPoll: true });
  t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  const original = await f.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5",
    content_base64: PNG.toString("base64"), filename: "drain-original.png", mime_type: "image/png" });
  const pending = f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5", prompt: "drain generation",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: null } });
  const observedOutcome = assert.rejects(() => pending,
    (error: unknown) => error instanceof Error && "code" in error && error.code === "OUTCOME_UNKNOWN");
  await f.waitForPoll();
  const chatUuid = f.latestChatUuid(); assert.ok(chatUuid);
  const witness = f.chatClient.getSeedreamEditorImagePostDispatchWitness({ attemptId: ATTEMPT, chat_uuid: chatUuid });
  const historyGetsBeforeRevoke = f.historyGetCount();
  await f.service.invalidateAttempt(ATTEMPT); await observedOutcome;
  assert.equal(f.counts().generationPosts, 1); assert.equal(f.counts().resultGets, 0);
  assert.throws(() => f.chatClient.getSeedreamEditorImagePostDispatchWitness({ attemptId: ATTEMPT, chat_uuid: chatUuid }));
  await assert.rejects(() => f.chatClient.listSeedreamEditorImageResultCandidates(witness));
  assert.equal(f.historyGetCount(), historyGetsBeforeRevoke, "revoked native witness cannot initiate another history GET");
});

test("service close drains then revokes retained native Editor post-dispatch witnesses", async (t) => {
  const f = fixture({ historyInitiallyEmpty: true });
  t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  const original = await f.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5",
    content_base64: PNG.toString("base64"), filename: "close-witness-original.png", mime_type: "image/png" });
  await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5", prompt: "close witness",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: null } }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "OUTCOME_UNKNOWN");
  const chatUuid = f.latestChatUuid(); assert.ok(chatUuid);
  const witness = f.chatClient.getSeedreamEditorImagePostDispatchWitness({ attemptId: ATTEMPT, chat_uuid: chatUuid });
  const historyGetsBeforeClose = f.historyGetCount();
  await f.service.close();
  assert.throws(() => f.chatClient.getSeedreamEditorImagePostDispatchWitness({ attemptId: ATTEMPT, chat_uuid: chatUuid }));
  await assert.rejects(() => f.chatClient.listSeedreamEditorImageResultCandidates(witness));
  assert.equal(f.historyGetCount(), historyGetsBeforeClose, "closed service leaves no reusable native read witness");
  assert.equal(f.counts().generationPosts, 1);
});

test("native witness loss after possible POST returns OUTCOME_UNKNOWN without a fabricated recovery ID", async (t) => {
  const f = fixture({ invalidateNativeDuringPost: true });
  t.after(async () => { await f.service.close(); await f.drawingReferenceService.close(); await f.originalReferenceService.close(); });
  const original = await f.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5",
    content_base64: PNG.toString("base64"), filename: "native-witness-race-original.png", mime_type: "image/png" });
  await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5", prompt: "native witness lost after dispatch",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: null } }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "OUTCOME_UNKNOWN" &&
    (!Object.hasOwn(error, "recovery_id") || (error as { recovery_id?: unknown }).recovery_id === undefined));
  assert.deepEqual(await f.service.listRecoveries({ attemptId: ATTEMPT }), [], "no native witness means no fabricated recovery entry");
  await assert.rejects(() => f.service.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5", prompt: "native witness lost after dispatch",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: original.reference_handle, drawing_handle: null } }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "INTENT_ALREADY_CLAIMED");
  assert.equal(f.counts().generationPosts, 1, "unknown claim remains consumed and cannot be replayed");
});
