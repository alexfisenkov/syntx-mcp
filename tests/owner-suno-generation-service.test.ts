import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OWNER_SUNO_GENERATION_PUBLIC_VERSION, OWNER_SUNO_GENERATION_MODEL_IDS,
  } from "../src/application/owner-suno-generation-parameters.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const SERVICE_URL = new URL("../src/application/owner-suno-generation-service.js", import.meta.url).href;
const ATTEMPT_A = "link_suno_service_attempt_a_0123456789";
const ATTEMPT_B = "link_suno_service_attempt_b_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "suno-service-test-tenant", subject: "suno-service-test-owner" });
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_SUNO_GENERATION_PUBLIC_VERSION));
const stores = new Set<InMemoryAuthLinkStore>();
afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

interface ServiceResult extends Record<string, unknown> {
  readonly status: "completed" | "partial_results";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly recovery_id: string;
  readonly artifacts: readonly Record<string, unknown>[];
  readonly observed_artifact_count: number;
  readonly next_offset: number | null;
  readonly diagnostic: Readonly<{ history_get_calls: number; result_get_calls: number; gaps: readonly string[]; counters_saturated: boolean }>;
}
interface ServiceApi {
  generate(input: unknown, signal?: AbortSignal): Promise<ServiceResult>;
  reconcile(input: unknown, signal?: AbortSignal): Promise<ServiceResult>;
  listRecoveries(input: unknown): Promise<readonly Record<string, unknown>[]>;
  getResultPage(input: unknown): Promise<ServiceResult>;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
function request(modelId: typeof OWNER_SUNO_GENERATION_MODEL_IDS[number], overrides: Record<string, unknown> = {}) {
  return Object.freeze({ model_id: modelId, mode: "generate", prompt: "A short, warm instrumental phrase",
    is_custom_mode: false, is_instrumental: true, negative_tags: "crowd noise", styles: "minimal, warm", title: "Service fixture", ...overrides });
}

async function fixture(options: { readonly outputCount?: number; readonly incomplete?: boolean; readonly loseAck?: boolean;
  readonly allIncomplete?: boolean; readonly readyAfterResultReads?: number;
  readonly catalogVersion?: string; readonly resolveClient?: (attemptId: string) => unknown;
  readonly gatePost?: { readonly entered: () => void; readonly aborted: () => void } } = {}) {
  let now = Date.parse("2026-10-13T04:00:00.000Z"), chatCount = 0, postCount = 0;
  const counts = { chats: 0, posts: 0, historyGets: 0, resultGets: 0, balanceGets: 0, subscriptionGets: 0, modelAccessGets: 0 };
  const events: Array<{ readonly method: string; readonly url: URL; readonly body?: unknown }> = [];
  const jobs = new Map<string, { readonly model: string; readonly prompt: string; readonly ack: string;
    readonly rows: readonly { readonly messageId: string; readonly objects: readonly { readonly id: string; readonly url: string; readonly complete: boolean }[] }[] }>();
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-suno-service-challenge", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-suno-service-credential" });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(() => now); stores.add(store);
  const attemptQueue = [ATTEMPT_A, ATTEMPT_B];
  const linkService = new PerUserLinkService(provider, store, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => attemptQueue.shift() ?? "link_suno_service_extra_0123456789" });
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
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push({ method, url, ...(body === undefined ? {} : { body }) });
    if (url.origin !== "https://api.syntx.ai") throw new Error("Unexpected origin");
    if (url.pathname === "/api/v1/user/balance" && method === "GET") { counts.balanceGets += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      counts.subscriptionGets += 1; return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      counts.modelAccessGets += 1;
      if (url.searchParams.get("ai_name") !== "suno" || url.searchParams.get("version") !== url.searchParams.get("model_type")) {
        throw new Error("Suno source-version cost-query projection mismatch");
      }
      return Response.json({ access: true, cost: 3, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1; counts.chats += 1;
      const chatBody = body as { readonly scope: string; readonly title: string };
      if (chatBody.scope !== "audio" || typeof chatBody.title !== "string") throw new Error("Suno chat-create wire mismatch");
      return Response.json({ uuid: `suno-service-chat-${chatCount}` });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      postCount += 1; counts.posts += 1;
      const requestBody = body as { readonly chat_uuid: string; readonly prompt: string; readonly settings: Record<string, unknown> };
      if (url.search !== "?ai_name=suno" || !requestBody.settings ||
          (requestBody.settings.model_type !== "V6" && requestBody.settings.model_type !== "V6_wild") ||
          requestBody.settings.mode !== "generate" || requestBody.settings.file_urls instanceof Array && requestBody.settings.file_urls.length !== 0) {
        throw new Error("Suno generation wire mismatch");
      }
      assert.equal(requestBody.settings.model_type === "V6" || requestBody.settings.model_type === "V6_wild", true);
      const total = requestBody.prompt.includes("suno-service-eighty") ? 80 : options.outputCount ?? 2;
      const ack = `suno-service-ack-${postCount}`;
      const rows = Array.from({ length: Math.ceil(total / 64) }, (_, part) => {
        const offset = part * 64, length = Math.min(64, total - offset), messageId = `suno-service-bot-${postCount}-${part + 1}`;
        const objects = Array.from({ length }, (_, index) => {
          const ordinal = offset + index + 1;
          return Object.freeze({ id: `suno-service-object-${postCount}-${ordinal}`,
            url: `https://r2.syntx.ai/audio/suno-service-${postCount}-${ordinal}.mp3`,
            complete: !options.allIncomplete && !(options.incomplete && ordinal === 2) });
        });
        return Object.freeze({ messageId, objects: Object.freeze(objects) });
      });
      jobs.set(requestBody.chat_uuid, Object.freeze({ model: String(requestBody.settings.model_type), prompt: requestBody.prompt, ack,
        rows: Object.freeze(rows) }));
      if (options.loseAck) throw new Error("Synthetic connection lost after possible audio POST");
      if (requestBody.prompt.includes("suno-service-revoke-drain")) {
        options.gatePost?.entered();
        return new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (!signal || typeof signal.addEventListener !== "function") throw new Error("Native audio request signal was not forwarded");
          signal.addEventListener("abort", () => { options.gatePost?.aborted(); reject(new DOMException("synthetic revoke drain", "AbortError")); }, { once: true });
        });
      }
      return Response.json({ id: ack });
    }
    const historyMatch = /^\/api\/v1\/chats\/(suno-service-chat-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch && method === "GET") {
      counts.historyGets += 1;
      if (url.search !== "?page=1&page_size=10") throw new Error("Suno fixed history paging mismatch");
      const job = jobs.get(historyMatch[1]!); assert.ok(job, "native history is scoped to a genuine created chat");
      const messages: Array<Record<string, unknown>> = [{ id: job.ack, chat_id: 9123, author_id: 4312, message_object: [{
        id: `suno-service-ack-text-${postCount}`, message_id: job.ack, object_type: "text", object_text: job.prompt, model_type: job.model
      }] }, ...job.rows.map((row) => ({ id: row.messageId, chat_id: 9123, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.messageId, object_type: "audio", model_type: job.model })) }))];
      const page = Number(url.searchParams.get("page")), size = 10, pages = Math.ceil(messages.length / size);
      return Response.json({ messages: messages.slice((page - 1) * size, page * size), pagination: {
        page, page_size: size, total_count: messages.length, total_pages: pages, has_next: page < pages, has_previous: page > 1
      } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(suno-service-chat-\d+)\/(suno-service-bot-\d+-\d+)$/u.exec(url.pathname);
    if (resultMatch && method === "GET") {
      counts.resultGets += 1;
      const job = jobs.get(resultMatch[1]!), row = job?.rows.find((candidate) => candidate.messageId === resultMatch[2]);
      assert.ok(job && row, "result GET requires the message ID discovered from this chat's genuine history");
      return Response.json({ id: row.messageId, chat_id: 9123, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.messageId, object_type: "audio",
          object_url: object.url, completed: object.complete || (options.readyAfterResultReads !== undefined && counts.resultGets > options.readyAfterResultReads),
          model_type: job.model })),
        created_at: "2026-10-13T04:00:00Z", updated_at: "2026-10-13T04:00:00Z", is_favorite: false });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attemptId: string): SyntxChatHttpClient => {
    const existing = clients.get(attemptId);
    if (existing) return existing;
    const client = new SyntxChatHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl, maxResponseBytes: 2 * 1024 * 1024 });
    clients.set(attemptId, client);
    return client;
  };
  const serviceModule = await import(SERVICE_URL).catch(() => null) as Record<string, unknown> | null;
  assert.equal(typeof serviceModule?.OwnerSunoGenerationService, "function", "MISSING_OWNER_SUNO_GENERATION_SERVICE");
  const GenerationService = serviceModule!.OwnerSunoGenerationService as new (options: Record<string, unknown>) => ServiceApi;
  const createService = (overrides: { readonly catalogVersion?: string; readonly resolveChatClient?: (attemptId: string) => unknown } = {}) =>
    new GenerationService({ binding: BINDING, linkService, catalog: CATALOG,
      catalog_version: overrides.catalogVersion ?? OWNER_SUNO_GENERATION_PUBLIC_VERSION,
      resolveChatClient: overrides.resolveChatClient ?? options.resolveClient ?? resolveChatClient,
      createAccountStatusService: (attemptId: string) => new AccountStatusService(new SyntxHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl }), () => now),
      createModelAccessService: (attemptId: string) => new ModelAccessService(CATALOG,
        new SyntxHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl }), () => now),
      now: () => now, pollDelayMs: 0, maxPollAttempts: 1 });
  const service = createService();
  return { service, createService, linkService, events, counts, clients, get now() { return now; }, advance(ms: number) { now += ms; },
    async close() { await service.close(); } };
}

test("Suno service validates each exact source model and takes two fresh preflight snapshots before one native POST", async () => {
  const f = await fixture();
  try {
    const outputs: ServiceResult[] = [];
    for (const [index, modelId] of OWNER_SUNO_GENERATION_MODEL_IDS.entries()) {
      const intent = request(modelId, { is_custom_mode: index === 1, prompt: index === 1 ? "custom prompt" : "simple phrase",
        styles: index === 1 ? "ambient" : "", title: `model ${modelId}` });
      outputs.push(await f.service.generate({ attemptId: ATTEMPT_A, request: intent }));
    }
    assert.deepEqual(outputs.map((result) => result.model_id), OWNER_SUNO_GENERATION_MODEL_IDS);
    assert.ok(outputs.every((result) => result.status_semantics === "LOCAL_OBSERVED_AVAILABILITY_ONLY" &&
      result.backend_acceptance === "UNPROVEN" && result.provider_terminal_status === "UNPROVEN"));
    assert.equal(f.counts.posts, 2);
    assert.equal(f.counts.chats, 2);
    assert.equal(f.counts.balanceGets, 4);
    assert.equal(f.counts.subscriptionGets, 4);
    assert.equal(f.counts.modelAccessGets, 4);
    const posts = f.events.filter((event) => event.method === "POST" && event.url.pathname === "/api/v1/audio/generate");
    assert.equal(posts.length, 2);
    assert.deepEqual(posts.map((event) => (event.body as { settings: { model_type: string } }).settings.model_type), ["V6", "V6_wild"]);
    assert.deepEqual(posts.map((event) => (event.body as { settings: unknown }).settings), [
      { model_type: "V6", mode: "generate", is_custom_mode: false, is_instrumental: true, negative_tags: "crowd noise",
        styles: "", title: "model V6", file_urls: [] },
      { model_type: "V6_wild", mode: "generate", is_custom_mode: true, is_instrumental: true, negative_tags: "crowd noise",
        styles: "ambient", title: "model V6_wild", file_urls: [] }
    ]);
    assert.ok(posts.every((event) => (event.body as { settings: { is_instrumental: boolean } }).settings.is_instrumental));
    assert.equal(JSON.stringify(outputs).includes("simple phrase"), false);
    assert.equal(JSON.stringify(outputs).includes("ambient"), false);
  } finally { await f.close(); }
});

test("Suno service caches all 80 native audio observations as 64+16 without additional page I/O", async () => {
  const f = await fixture();
  try {
    const result = await f.service.generate({ attemptId: ATTEMPT_A,
      request: request("V6", { prompt: "suno-service-eighty observed tracks" }) });
    assert.equal(result.status, "completed");
    assert.equal(result.observed_artifact_count, 80);
    assert.equal(result.artifacts.length, 64);
    assert.equal(result.next_offset, 64);
    const before = { ...f.counts };
    const second = await f.service.getResultPage({ attemptId: ATTEMPT_A, recovery_id: result.recovery_id, offset: 64 });
    assert.equal(second.offset, 64);
    assert.equal(second.artifacts.length, 16);
    assert.equal(second.next_offset, null);
    assert.deepEqual(f.counts, before, "a local result page must not call native history or message GET again");
    assert.equal(new Set([...result.artifacts, ...second.artifacts].map((artifact) => artifact.message_object_id)).size, 80);
  } finally { await f.close(); }
});

test("Suno partial siblings remain available and accumulated native GET counters saturate explicitly", async () => {
  const f = await fixture({ outputCount: 2, incomplete: true });
  try {
    const first = await f.service.generate({ attemptId: ATTEMPT_A, request: request("V6") });
    assert.equal(first.status, "partial_results");
    assert.equal(first.artifacts.length, 1, "a ready sibling remains available when another audio object is incomplete");
    assert.ok(first.diagnostic.gaps.includes("OBJECT_INCOMPLETE"));
    for (let index = 0; index < 260; index += 1) {
      const observed = await f.service.reconcile({ attemptId: ATTEMPT_A, recovery_id: first.recovery_id });
      assert.equal(observed.status, "partial_results");
    }
    const diagnostic = (await f.service.listRecoveries({ attemptId: ATTEMPT_A }))[0]!.diagnostic as {
      history_get_calls: number; result_get_calls: number; counters_saturated: boolean;
    };
    assert.equal(diagnostic.history_get_calls, 255);
    assert.equal(diagnostic.result_get_calls, 255);
    assert.equal(diagnostic.counters_saturated, true);
  } finally { await f.close(); }
});

test("Suno zero-ready bounded observations stay outcome-unknown and recover later by GET only", async () => {
  const f = await fixture({ outputCount: 2, allIncomplete: true, readyAfterResultReads: 1 });
  try {
    let recoveryId = "", generationError: unknown;
    try { await f.service.generate({ attemptId: ATTEMPT_A, request: request("V6") }); } catch (error) { generationError = error; }
    assert.equal(errorCode(generationError), "OUTCOME_UNKNOWN");
    assert.ok(generationError && typeof generationError === "object" && "recovery_id" in generationError &&
      typeof generationError.recovery_id === "string");
    recoveryId = (generationError as { recovery_id: string }).recovery_id;
    const recoveries = await f.service.listRecoveries({ attemptId: ATTEMPT_A });
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0]?.status, "outcome_unknown");
    assert.equal(recoveries[0]?.observed_artifact_count, 0);
    assert.ok((recoveries[0]?.diagnostic as { gaps: readonly string[] }).gaps.includes("OBJECT_INCOMPLETE"));
    const before = { ...f.counts };
    const recovered = await f.service.reconcile({ attemptId: ATTEMPT_A, recovery_id: recoveryId });
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.artifacts.length, 2);
    assert.equal(f.counts.posts, before.posts);
    assert.equal(f.counts.chats, before.chats);
    assert.equal(f.counts.historyGets, before.historyGets + 1);
    assert.equal(f.counts.resultGets, before.resultGets + 1);
  } finally { await f.close(); }
});

test("Suno attempt invalidation aborts an in-flight POST and drains without a second dispatch", async () => {
  let announceEntry!: () => void, announceAbort!: () => void;
  const entered = new Promise<void>((resolve) => { announceEntry = resolve; });
  const aborted = new Promise<void>((resolve) => { announceAbort = resolve; });
  const f = await fixture({ gatePost: { entered: announceEntry, aborted: announceAbort } });
  try {
    const pending = f.service.generate({ attemptId: ATTEMPT_A,
      request: request("V6", { prompt: "suno-service-revoke-drain" }) });
    await entered;
    await f.service.invalidateAttempt(ATTEMPT_A);
    await aborted;
    await assert.rejects(pending, (error) => errorCode(error) === "OUTCOME_UNKNOWN");
    assert.equal(f.counts.posts, 1);
    await assert.rejects(f.service.generate({ attemptId: ATTEMPT_A,
      request: request("V6", { prompt: "suno-service-revoke-drain" }) }), (error) => errorCode(error) === "PRINCIPAL_NOT_LINKED");
    assert.equal(f.counts.posts, 1);
  } finally { await f.close(); }
});

test("Suno uncertain POST remains GET-only after the input 15-minute TTL and never replays", async () => {
  const f = await fixture({ loseAck: true });
  try {
    const intent = request("V6_wild", { is_custom_mode: true, prompt: "a distinct custom phrase", styles: "orchestal" });
    let recoveryId = "";
    let unknownError: unknown;
    try { await f.service.generate({ attemptId: ATTEMPT_A, request: intent }); } catch (error) { unknownError = error; }
    assert.equal(errorCode(unknownError), "OUTCOME_UNKNOWN");
    assert.ok(unknownError && typeof unknownError === "object" && "recovery_id" in unknownError && typeof unknownError.recovery_id === "string",
      `error code=${errorCode(unknownError)} recovery_id=${String(unknownError && typeof unknownError === "object" && "recovery_id" in unknownError ? unknownError.recovery_id : undefined)}`);
    recoveryId = (unknownError as { recovery_id: string }).recovery_id;
    const before = { ...f.counts };
    const list = await f.service.listRecoveries({ attemptId: ATTEMPT_A });
    assert.equal(list.length, 1);
    f.advance(16 * 60_000);
    let replayError: unknown;
    try { await f.service.generate({ attemptId: ATTEMPT_A, request: intent }); } catch (error) { replayError = error; }
    assert.equal(errorCode(replayError), "OUTCOME_UNKNOWN");
    assert.equal((replayError as { recovery_id?: unknown }).recovery_id, recoveryId);
    const result = await f.service.reconcile({ attemptId: ATTEMPT_A, recovery_id: recoveryId });
    assert.equal(result.status, "completed");
    assert.equal(result.artifacts.length, 2);
    assert.equal(f.counts.posts, before.posts);
    assert.equal(f.counts.chats, before.chats);
    assert.equal(f.counts.historyGets, before.historyGets + 1);
    assert.equal(f.counts.resultGets, before.resultGets + 1);
  } finally { await f.close(); }
});

test("Suno cached results require the same live connection after revoke and a relink cannot replay the intent", async () => {
  const f = await fixture();
  try {
    const intent = request("V6");
    const complete = await f.service.generate({ attemptId: ATTEMPT_A, request: intent });
    const oldUrl = String(complete.artifacts[0]!.url);
    await f.linkService.revoke(BINDING, ATTEMPT_A);
    await f.service.invalidateAttempt(ATTEMPT_A);
    assert.equal((await f.linkService.checkAttempt(BINDING, ATTEMPT_A)).status, "REVOKED");
    await assert.rejects(f.service.reconcile({ attemptId: ATTEMPT_A, recovery_id: complete.recovery_id }),
      (error) => errorCode(error) === "PRINCIPAL_NOT_LINKED" || errorCode(error) === "RECOVERY_NOT_FOUND");
    assert.equal((await f.service.listRecoveries({ attemptId: ATTEMPT_B })).length, 0);
    await assert.rejects(f.service.getResultPage({ attemptId: ATTEMPT_B, recovery_id: complete.recovery_id, offset: 0 }),
      (error) => errorCode(error) === "RECOVERY_NOT_FOUND");
    await assert.rejects(f.service.generate({ attemptId: ATTEMPT_B, request: intent }), (error) => errorCode(error) === "INTENT_ALREADY_CLAIMED");
    assert.equal(f.counts.posts, 1);
    assert.equal(JSON.stringify(await f.service.listRecoveries({ attemptId: ATTEMPT_B })).includes(oldUrl), false);
  } finally { await f.close(); }
});

test("Suno source binding mismatch and a forged native-client prototype fail before any paid POST", async () => {
  const f = await fixture();
  try {
    assert.throws(() => f.createService({ catalogVersion: "wrong-catalog-version" }),
      (error: unknown) => errorCode(error) === "MODEL_BINDING_MISMATCH");
    const forged = Object.create(SyntxChatHttpClient.prototype) as SyntxChatHttpClient;
    const service = f.createService({ resolveChatClient: () => forged });
    await assert.rejects(service.generate({ attemptId: ATTEMPT_A, request: request("V6", { prompt: "forged client must not dispatch" }) }),
      (error) => errorCode(error) === "PRE_DISPATCH_FAILED");
    assert.equal(f.counts.posts, 0);
    await service.close();
  } finally { await f.close(); }
});

test("closing Suno generation service closes its owned preparation policy but leaves owner auth open", async () => {
  const f = await fixture();
  try {
    await f.service.close();
    assert.equal((await f.linkService.checkAttempt(BINDING, ATTEMPT_A)).status, "LINKED");
    await assert.rejects(f.service.generate({ attemptId: ATTEMPT_A, request: request("V6") }),
      (error) => errorCode(error) === "SERVICE_CLOSED");
    assert.equal(f.counts.posts, 0);
  } finally { await f.close(); }
});
