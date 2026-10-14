import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OWNER_SUNO_GENERATION_PUBLIC_VERSION } from "../src/application/owner-suno-generation-parameters.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { OwnerSunoGenerationService, type OwnerSunoGenerationServiceOptions } from "../src/application/owner-suno-generation-service.js";

const ATTEMPT_A = "link_suno_operation_service_owner_a_0123456789";
const ATTEMPT_B = "link_suno_operation_service_owner_b_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "suno-operation-service-tenant", subject: "suno-operation-service-owner" });
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_SUNO_GENERATION_PUBLIC_VERSION));
const stores = new Set<InMemoryAuthLinkStore>();

interface ServiceApi {
  generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  generateTrackOperation(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  reconcileTrackOperation(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  listTrackOperationRecoveries(input: unknown): Promise<readonly Record<string, unknown>[]>;
  getTrackOperationResultPage(input: unknown): Promise<Record<string, unknown>>;
  listTrackInputs(input: unknown): Promise<Record<string, unknown>>;
  invalidateAttempt(input: unknown): Promise<void>;
  close(): Promise<void>;
  getTrackOperationParametersSource(): Record<string, unknown>;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
function generateRequest() {
  return Object.freeze({ model_id: "V6", mode: "generate", prompt: "Synthetic source phrase",
    is_custom_mode: false, is_instrumental: true, negative_tags: "", styles: "", title: "Source fixture" });
}
function operationRequest(trackHandle: string, overrides: Record<string, unknown> = {}) {
  return Object.freeze({ model_id: "V6", mode: "cover", track_handle: trackHandle,
    prompt: "A bright cover arrangement", is_custom_mode: false, is_instrumental: false,
    negative_tags: "", styles: "warm strings", title: "Cover fixture", ...overrides });
}

async function fixture(options: { readonly denyOperationAccess?: boolean; readonly failFirstOperationHistory?: boolean;
  readonly operationErrorMode?: "error_only" | "mixed" } = {}) {
  let now = Date.parse("2026-10-14T00:00:00.000Z");
  let chatCounter = 0;
  let challengeCounter = 0;
  let deniedOperationAccess = false;
  let failFirstOperationHistory = options.failFirstOperationHistory ?? false;
  const counts = { chats: 0, generationPosts: 0, operationPosts: 0, historyGets: 0, resultGets: 0,
    operationHistoryGets: 0, accountReads: 0, modelAccessReads: 0 };
  const events: Array<{ readonly method: string; readonly url: URL; readonly body?: unknown }> = [];
  const jobs = new Map<string, { readonly model: string; readonly mode: string; readonly prompt: string; readonly ack: string;
    readonly objects: readonly { readonly id: string; readonly url: string; readonly metadata?: unknown }[]; readonly botError: boolean }>();
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { challengeCounter += 1; return { upstream_attempt_id: `synthetic-operation-challenge-${challengeCounter}`, approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-suno-operation-service-credential" });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(() => now); stores.add(store);
  const linkService = new PerUserLinkService(provider, store, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: (() => { const queue = [ATTEMPT_A, ATTEMPT_B]; return () => queue.shift() ?? ATTEMPT_A; })() });
  for (const attemptId of [ATTEMPT_A, ATTEMPT_B]) {
    await linkService.createAttempt(BINDING);
    await linkService.issueHandoff(BINDING, attemptId);
    assert.equal((await linkService.checkAttempt(BINDING, attemptId)).status, "LINKED");
  }
  const brokerFor = (attemptId: string): SyntxCredentialBroker => ({ async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return linkService.useCredential(BINDING, attemptId, (credential) => operation(credential.value));
  } });
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push({ method, url, ...(body === undefined ? {} : { body }) });
    if (url.origin !== "https://api.syntx.ai") throw new Error("Unexpected origin");
    if (url.pathname === "/api/v1/user/balance" && method === "GET") {
      counts.accountReads += 1;
      return Response.json({ balance: "1000" });
    }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      counts.modelAccessReads += 1;
      const model = url.searchParams.get("model_type");
      if (url.searchParams.get("ai_name") !== "suno" || (model !== "V6" && model !== "V6_wild")) throw new Error("Unexpected Suno model quote");
      const isOperationQuote = !url.searchParams.has("version");
      if (isOperationQuote && deniedOperationAccess) return Response.json({ access: false, cost: 3,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
      return Response.json({ access: true, cost: 3, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1;
      const chatBody = body as { readonly scope?: string; readonly title?: string };
      if (chatBody.scope !== "audio" || typeof chatBody.title !== "string") throw new Error("Unexpected audio chat");
      chatCounter += 1;
      return Response.json({ uuid: `operation-service-chat-${chatCounter}` });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      if (url.search !== "?ai_name=suno") throw new Error("Unexpected generation route");
      const input = body as { readonly chat_uuid: string; readonly prompt: string; readonly settings: Record<string, unknown> };
      const model = String(input.settings.model_type);
      if (model !== "V6" && model !== "V6_wild") throw new Error("Unexpected model");
      if (input.settings.mode === "generate") {
        counts.generationPosts += 1;
        if (Object.keys(input.settings).sort().join(",") !== "file_urls,is_custom_mode,is_instrumental,mode,model_type,negative_tags,styles,title") {
          throw new Error("Unexpected source generation payload");
        }
      } else {
        counts.operationPosts += 1;
        if (input.settings.mode !== "cover" && input.settings.mode !== "extend") throw new Error("Unexpected operation mode");
        if (typeof input.settings.source_clip_id !== "string" || typeof input.settings.source_task_id !== "string") {
          throw new Error("Operation did not use source-bound metadata");
        }
        assert.equal(input.settings.source_clip_id, "synthetic-source-clip");
        assert.equal(input.settings.source_task_id, "synthetic-source-task");
      }
      const ack = `operation-service-ack-${counts.generationPosts}-${counts.operationPosts}`;
      const operation = input.settings.mode !== "generate";
      const audioId = `operation-service-object-${counts.generationPosts}-${counts.operationPosts}`;
      const errorOnly = operation && options.operationErrorMode === "error_only";
      jobs.set(input.chat_uuid, Object.freeze({ model, mode: String(input.settings.mode), prompt: input.prompt, ack,
        botError: operation && options.operationErrorMode !== undefined,
        objects: Object.freeze(errorOnly ? [] : [{ id: audioId, url: `https://r2.syntx.ai/audio/${audioId}.mp3`,
          ...(operation ? {} : { metadata: { payload: { clip_id: "synthetic-source-clip", task_id: "synthetic-source-task" } } }) }]) }));
      return Response.json({ id: ack });
    }
    const historyMatch = /^\/api\/v1\/chats\/(operation-service-chat-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch && method === "GET") {
      const job = jobs.get(historyMatch[1]!);
      assert.ok(job, "history must bind to a genuine locally created chat");
      if (job.mode !== "generate") {
        counts.operationHistoryGets += 1;
        if (failFirstOperationHistory) {
          failFirstOperationHistory = false;
          throw new Error("Synthetic history GET unavailable once");
        }
      }
      counts.historyGets += 1;
      if (url.search !== "?page=1&page_size=10") throw new Error("Unexpected history paging");
      const objectRows = job.objects.map((object) => ({ id: object.id, message_id: `operation-service-bot-${historyMatch[1]}`,
        object_type: "audio", model_type: job.model }));
      const botObjects = [...objectRows, ...(job.botError ? [{ id: `operation-service-error-${historyMatch[1]}`,
        message_id: `operation-service-bot-${historyMatch[1]}`, object_type: "error", model_type: job.model }] : [])];
      return Response.json({ messages: [
        { id: job.ack, chat_id: 9432, author_id: 12, message_object: [{ id: `${job.ack}-text`, message_id: job.ack,
          object_type: "text", object_text: job.prompt, model_type: job.model }] },
        { id: `operation-service-bot-${historyMatch[1]}`, chat_id: 9432, author_id: -1, message_object: botObjects }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const chatIdMatch = /^\/api\/v1\/chats\/(operation-service-chat-\d+)\/(.+)$/u.exec(url.pathname);
    if (chatIdMatch && method === "GET") {
      const job = jobs.get(chatIdMatch[1]!);
      assert.ok(job, "result GET must follow same-chat history");
      const expectedMessage = `operation-service-bot-${chatIdMatch[1]}`;
      assert.equal(chatIdMatch[2], expectedMessage);
      counts.resultGets += 1;
      return Response.json({ id: expectedMessage, chat_id: 9432, author_id: -1,
        message_object: job.objects.map((object) => ({ id: object.id, message_id: expectedMessage,
          object_type: "audio", object_url: object.url, completed: true, model_type: job.model,
          ...(object.metadata === undefined ? {} : { metadata: object.metadata }) })),
        created_at: "2026-10-14T00:00:00Z", is_favorite: false });
    }
    throw new Error(`Unexpected synthetic request ${method} ${url.pathname}`);
  };
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attemptId: string): SyntxChatHttpClient => {
    const existing = clients.get(attemptId);
    if (existing) return existing;
    const client = new SyntxChatHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl,
      maxResponseBytes: 2 * 1024 * 1024 });
    clients.set(attemptId, client);
    return client;
  };
  const optionsFor = (catalogVersion = OWNER_SUNO_GENERATION_PUBLIC_VERSION): OwnerSunoGenerationServiceOptions => ({
    binding: BINDING, linkService, catalog: CATALOG, catalog_version: catalogVersion, resolveChatClient,
    createAccountStatusService: (attemptId) => new AccountStatusService(new SyntxHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl }), () => now),
    createModelAccessService: (attemptId) => new ModelAccessService(CATALOG,
      new SyntxHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl }), () => now),
    now: () => now, pollDelayMs: 0, maxPollAttempts: 1
  });
  const service = new OwnerSunoGenerationService(optionsFor());
  return { service: service as unknown as ServiceApi, counts, events,
    get now() { return now; }, advance(milliseconds: number) { now += milliseconds; },
    denyOperationAccess() { deniedOperationAccess = true; },
    async close() { await service.close(); } };
}

afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

async function seededTrack(f: Awaited<ReturnType<typeof fixture>>) {
  const source = await f.service.generate({ attemptId: ATTEMPT_A, request: generateRequest() });
  const tracks = await f.service.listTrackInputs({ attemptId: ATTEMPT_A, recovery_id: source.recovery_id });
  const first = (tracks.tracks as Array<{ track_handle: string; model_id: string }>)[0];
  assert.ok(first, "genuine generation result must mint an opaque source handle");
  assert.equal(first.model_id, "V6");
  return { source, track: first };
}

test("cover and extend use the genuine source-owned track binding and return only bounded safe result DTOs", async () => {
  const f = await fixture();
  try {
    const { track } = await seededTrack(f);
    const modelReadsBeforeCover = f.counts.modelAccessReads;
    const accountReadsBeforeCover = f.counts.accountReads;
    const result = await f.service.generateTrackOperation({ attemptId: ATTEMPT_A,
      request: operationRequest(track.track_handle) });
    assert.equal(f.counts.modelAccessReads - modelReadsBeforeCover, 2, "fresh model access is read before chat and again before POST");
    assert.equal(f.counts.accountReads - accountReadsBeforeCover, 2, "fresh account status is read before chat and again before POST");
    assert.equal(result.status, "completed");
    assert.equal(result.mode, "cover");
    assert.equal(result.model_id, "V6");
    assert.equal(result.page_size, 64);
    assert.equal(result.observed_artifact_count, 1);
    assert.equal((result.artifacts as Array<Record<string, unknown>>)[0]?.url, "https://r2.syntx.ai/audio/operation-service-object-1-1.mp3");
    const serialized = JSON.stringify(result);
    for (const hidden of ["synthetic-source-clip", "synthetic-source-task", "operation-service-chat", track.track_handle,
      "bright cover arrangement"]) assert.equal(serialized.includes(hidden), false);
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.provider_terminal_status, "UNPROVEN");

    const modelReadsBeforeExtend = f.counts.modelAccessReads;
    const extend = await f.service.generateTrackOperation({ attemptId: ATTEMPT_A,
      request: operationRequest(track.track_handle, { mode: "extend", continue_at: 12.3, title: "Extend fixture" }) });
    assert.equal(f.counts.modelAccessReads - modelReadsBeforeExtend, 2);
    assert.equal(extend.mode, "extend");
    assert.equal(f.counts.operationPosts, 2);
    const operationPosts = f.events.filter((event) => event.method === "POST" && event.url.pathname === "/api/v1/audio/generate" &&
      (event.body as { settings: { mode: string } }).settings.mode !== "generate");
    assert.equal(operationPosts.length, 2);
    assert.equal((operationPosts[1]!.body as { settings: { continue_at: number } }).settings.continue_at, 12.3);
    assert.deepEqual(f.service.getTrackOperationParametersSource().model_ids, ["V6", "V6_wild"]);
  } finally { await f.close(); }
});

test("foreign, expired, and model-mismatched opaque handles fail before a Cover/Extend POST", async () => {
  const f = await fixture();
  try {
    const { track } = await seededTrack(f);
    await assert.rejects(f.service.generateTrackOperation({ attemptId: ATTEMPT_B,
      request: operationRequest(track.track_handle) }), (error: unknown) => errorCode(error) === "INVALID_REQUEST");
    await assert.rejects(f.service.generateTrackOperation({ attemptId: ATTEMPT_A,
      request: operationRequest(track.track_handle, { model_id: "V6_wild" }) }),
    (error: unknown) => errorCode(error) === "INVALID_REQUEST");
    f.advance(16 * 60_000);
    await assert.rejects(f.service.generateTrackOperation({ attemptId: ATTEMPT_A,
      request: operationRequest(track.track_handle) }), (error: unknown) => errorCode(error) === "INVALID_REQUEST");
    assert.equal(f.counts.operationPosts, 0);
  } finally { await f.close(); }
});

test("each operation takes a fresh empty-cost-parameters access quote and denies before dispatch", async () => {
  const f = await fixture({ denyOperationAccess: true });
  try {
    const { track } = await seededTrack(f);
    f.denyOperationAccess();
    await assert.rejects(f.service.generateTrackOperation({ attemptId: ATTEMPT_A,
      request: operationRequest(track.track_handle) }), (error: unknown) => errorCode(error) === "PREFLIGHT_FAILED");
    assert.equal(f.counts.operationPosts, 0);
    const quoteRequests = f.events.filter((event) => event.method === "GET" && event.url.pathname === "/api/v2/get_model_info");
    assert.ok(quoteRequests.length >= 2, "one source quote and one fresh denied operation quote were read");
    const operationQuote = quoteRequests.at(-1)!.url;
    assert.equal(operationQuote.searchParams.get("ai_name"), "suno");
    assert.equal(operationQuote.searchParams.get("model_type"), "V6");
    assert.equal(operationQuote.searchParams.has("version"), false);
  } finally { await f.close(); }
});

test("same intent replays cached results without another POST; GET-only reconcile retains unknown outcomes", async () => {
  const f = await fixture({ failFirstOperationHistory: true });
  try {
    const { track } = await seededTrack(f);
    const intent = { attemptId: ATTEMPT_A, request: operationRequest(track.track_handle) };
    let recoveryId = "";
    await assert.rejects(f.service.generateTrackOperation(intent), (error: unknown) => {
      recoveryId = error && typeof error === "object" && "recovery_id" in error ? String(error.recovery_id) : "";
      return errorCode(error) === "OUTCOME_UNKNOWN";
    });
    assert.match(recoveryId, /^suno_track_operation_recovery_[0-9a-f-]{36}$/u);
    const unknowns = await f.service.listTrackOperationRecoveries({ attemptId: ATTEMPT_A });
    assert.equal(unknowns[0]?.recovery_id, recoveryId);
    const postsBeforeReconcile = f.counts.operationPosts;
    const historyBeforeReconcile = f.counts.operationHistoryGets;
    const reconciled = await f.service.reconcileTrackOperation({ attemptId: ATTEMPT_A, recovery_id: recoveryId });
    assert.equal(reconciled.status, "completed");
    assert.ok(f.counts.operationHistoryGets > historyBeforeReconcile, "reconcile performs same-chat history GET");
    assert.equal(f.counts.operationPosts, postsBeforeReconcile);
    const replay = await f.service.generateTrackOperation(intent);
    assert.equal(replay.recovery_id, recoveryId);
    assert.equal(f.counts.operationPosts, postsBeforeReconcile);
    assert.equal((await f.service.getTrackOperationResultPage({ attemptId: ATTEMPT_A, recovery_id: recoveryId, offset: 0 })).status, "completed");
  } finally { await f.close(); }
});

test("attempt invalidation denies handles before any later operation and close drains the composed engine", async () => {
  const f = await fixture();
  const { track } = await seededTrack(f);
  await f.service.invalidateAttempt(ATTEMPT_A);
  await assert.rejects(f.service.generateTrackOperation({ attemptId: ATTEMPT_A,
    request: operationRequest(track.track_handle) }), (error: unknown) => errorCode(error) === "PRINCIPAL_NOT_LINKED");
  assert.equal(f.counts.operationPosts, 0);
  await f.close();
  await assert.rejects(f.service.getTrackOperationResultPage({ attemptId: ATTEMPT_A,
    recovery_id: "suno_track_operation_recovery_00000000-0000-4000-8000-000000000000" }),
  (error: unknown) => errorCode(error) === "SERVICE_CLOSED");
});

test("a matched ACK plus bot error only becomes a typed recoverable observation without POST replay", async () => {
  const f = await fixture({ operationErrorMode: "error_only" });
  try {
    const { track } = await seededTrack(f);
    const intent = { attemptId: ATTEMPT_A, request: operationRequest(track.track_handle) };
    let recoveryId = "";
    const isObservedError = (error: unknown) => {
      recoveryId = error && typeof error === "object" && "recovery_id" in error ? String(error.recovery_id) : "";
      const diagnostic = error && typeof error === "object" && "diagnostic" in error
        ? error.diagnostic as { gaps?: readonly string[] } : undefined;
      return errorCode(error) === "UPSTREAM_OPERATION_ERROR" && diagnostic?.gaps?.includes("BOT_ERROR_OBSERVED") === true;
    };
    const resultGetsBefore = f.counts.resultGets;
    await assert.rejects(f.service.generateTrackOperation(intent), isObservedError);
    assert.match(recoveryId, /^suno_track_operation_recovery_[0-9a-f-]{36}$/u);
    assert.equal(f.counts.operationPosts, 1);
    assert.equal(f.counts.resultGets, resultGetsBefore, "error-only history produces no audio result GET");

    const records = await f.service.listTrackOperationRecoveries({ attemptId: ATTEMPT_A });
    assert.equal(records[0]?.recovery_id, recoveryId);
    assert.equal(records[0]?.status, "upstream_error_observed");
    assert.ok((records[0]?.diagnostic as { gaps: readonly string[] }).gaps.includes("BOT_ERROR_OBSERVED"));

    const historyBeforePage = f.counts.operationHistoryGets;
    const resultGetsBeforePage = f.counts.resultGets;
    await assert.rejects(f.service.getTrackOperationResultPage({ attemptId: ATTEMPT_A, recovery_id: recoveryId }), isObservedError);
    assert.equal(f.counts.operationHistoryGets, historyBeforePage, "cached error page performs no HTTP");
    assert.equal(f.counts.resultGets, resultGetsBeforePage, "cached error page performs no result GET");

    const historyBeforeReconcile = f.counts.operationHistoryGets;
    await assert.rejects(f.service.reconcileTrackOperation({ attemptId: ATTEMPT_A, recovery_id: recoveryId }), isObservedError);
    assert.ok(f.counts.operationHistoryGets > historyBeforeReconcile, "reconcile may perform GET-only history recovery");
    assert.equal(f.counts.operationPosts, 1, "reconcile does not repeat generation POST");

    await assert.rejects(f.service.generateTrackOperation(intent), isObservedError);
    assert.equal(f.counts.operationPosts, 1, "same-intent replay returns the cached typed observation");
  } finally { await f.close(); }
});

test("mixed bot error history preserves valid audio as partial results", async () => {
  const f = await fixture({ operationErrorMode: "mixed" });
  try {
    const { track } = await seededTrack(f);
    const result = await f.service.generateTrackOperation({ attemptId: ATTEMPT_A,
      request: operationRequest(track.track_handle) });
    assert.equal(result.status, "partial_results");
    assert.equal(result.observed_artifact_count, 1);
    assert.equal((result.artifacts as Array<{ url: string }>)[0]?.url,
      "https://r2.syntx.ai/audio/operation-service-object-1-1.mp3");
    assert.ok((result.diagnostic as { gaps: readonly string[] }).gaps.includes("BOT_ERROR_OBSERVED"));
    assert.equal(f.counts.operationPosts, 1);
  } finally { await f.close(); }
});
