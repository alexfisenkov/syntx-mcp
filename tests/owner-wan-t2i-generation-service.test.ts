import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";
import { OwnerWanT2iRequestPreparer } from "../src/application/owner-wan-t2i-request-preparer.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import { createOwnerWanT2iOneShotPermit } from "../src/application/owner-wan-t2i-one-shot-policy.js";
import { AbsoluteRequestDeadline } from "../src/adapter/syntx/request-deadline.js";

const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", VERSION), "utf8"
))));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan-t2i-generation-tenant", subject: "wan-t2i-generation-subject" });
const ATTEMPT = "link_wan_t2i_generation_test_000000000001";
const SERVICE_URL = new URL("../src/application/owner-wan-t2i-generation-service.js", import.meta.url).href;

function fixture(options: { readonly partialFirstBatchFour?: boolean; readonly loseAck?: boolean; readonly endDate?: string;
  readonly gateFirstBalance?: boolean } = {}) {
  let now = Date.parse("2026-10-11T00:00:00.000Z");
  let subscriptionActive = true;
  let chatCount = 0;
  const jobs = new Map<string, { readonly modelId: string; readonly batchSize: number; readonly ackId: string; readonly botId: string }>();
  const events: Array<{ method: string; url: URL; body: unknown }> = [];
  const counts = { accountFactories: 0, accessFactories: 0, preflightGets: 0, chatCreates: 0, posts: 0, historyGets: 0, resultGets: 0 };
  let announceFirstBalance!: () => void;
  const firstBalanceStarted = new Promise<void>((resolve) => { announceFirstBalance = resolve; });
  let releaseFirstBalance!: () => void;
  const firstBalanceGate = new Promise<void>((resolve) => { releaseFirstBalance = resolve; });
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-wan-t2i-generation-credential");
  } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body) as unknown;
    events.push({ method, url, body });
    if (url.pathname === "/api/v1/user/balance") {
      counts.preflightGets += 1;
      if (options.gateFirstBalance && counts.preflightGets === 1) { announceFirstBalance(); await firstBalanceGate; }
      return Response.json({ balance: "1000" });
    }
    if (url.pathname === "/api/v1/user/subscription") {
      counts.preflightGets += 1;
      return Response.json({ active: subscriptionActive, type: "PRO", end_date: options.endDate ?? "2026-10-12T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      return Response.json({ access: true, cost: 2, discount_cost: null, free_remaining_generations: null, limit: 0.5, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chatCreates += 1;
      chatCount += 1;
      return Response.json({ uuid: `wan-t2i-generation-chat-844-${chatCount}` });
    }
    if (url.pathname === "/api/v1/design/generate" && method === "POST") {
      counts.posts += 1;
      const request = body as { readonly chat_uuid: string; readonly settings: { readonly model_type: string; readonly batch_size: number } };
      const ackId = `wan-t2i-owner-ack-844-${counts.posts}`;
      const botId = `wan-t2i-bot-message-844-${counts.posts}`;
      jobs.set(request.chat_uuid, { modelId: request.settings.model_type, batchSize: request.settings.batch_size, ackId, botId });
      if (options.loseAck) throw new Error("synthetic lost acknowledgment");
      return Response.json({ id: ackId });
    }
    const historyMatch = /^\/api\/v1\/chats\/(wan-t2i-generation-chat-844-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch) {
      counts.historyGets += 1;
      const job = jobs.get(historyMatch[1]!);
      assert.ok(job);
      const visibleBatch = options.partialFirstBatchFour && job.batchSize === 4 && counts.historyGets === 1 ? 1 : job.batchSize;
      return Response.json({ messages: [
        { id: job.ackId, chat_id: 9001, author_id: 42, message_object: [] },
        { id: job.botId, chat_id: 9001, author_id: -1, message_object: Array.from({ length: visibleBatch }, (_, index) => ({
          id: 2001 + index, message_id: job.botId, object_type: "image", model_type: job.modelId
        })) }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(wan-t2i-generation-chat-844-\d+)\/(wan-t2i-bot-message-844-\d+)$/u.exec(url.pathname);
    if (resultMatch) {
      counts.resultGets += 1;
      const job = jobs.get(resultMatch[1]!);
      assert.ok(job);
      assert.equal(resultMatch[2], job.botId);
      const visibleBatch = options.partialFirstBatchFour && job.batchSize === 4 && counts.resultGets === 1 ? 1 : job.batchSize;
      return Response.json({ id: job.botId, chat_id: 9001, author_id: -1, message_object: Array.from({ length: visibleBatch }, (_, index) => ({
        id: 2001 + index, message_id: job.botId, object_type: "image", model_type: job.modelId,
        completed: true, object_url: `https://r2.syntx.ai/wan-t2i/result-${counts.posts}-${index + 1}.png`
      })) });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const linkService = new PerUserLinkService({} as never, {
    async getSnapshot(_binding: unknown, attemptId: string) {
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
        status: "LINKED" as const, expires_at: null, linked: true };
    }
  } as never);
  const chatClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const preparer = new OwnerWanT2iRequestPreparer({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: VERSION, now: () => now });
  const createAccountStatusService = () => {
    counts.accountFactories += 1;
    return new AccountStatusService(new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => now);
  };
  const createModelAccessService = () => {
    counts.accessFactories += 1;
    return new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker: broker, fetchImpl }), () => now);
  };
  return { events, counts, linkService, chatClient, preparer, createAccountStatusService, createModelAccessService,
    firstBalanceStarted, releaseFirstBalance,
    get now() { return now; }, advance(ms: number) { now += ms; }, setSubscriptionActive(active: boolean) { subscriptionActive = active; } };
}

test("a deadline-bound actual candidate and permit reach the one-shot native T2I boundary", async () => {
  const f = fixture();
  const input = { model_id: "wan_25_t2i_preview" as const, prompt: "A native-boundary probe",
    parameters: { aspect_ratio: "1:1" as const, resolution: "720P" as const, batch_size: 1 as const, prompt_extend: false,
      seed: null, color_palette: null, bbox_list: [] as const } };
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService: f.linkService });
  const deadline = new AbsoluteRequestDeadline(30_000, undefined, () => new Error("synthetic deadline"));
  const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, principal, input, signal: deadline.signal });
  assert.equal(f.preparer.isPreparedCandidateForPrincipal(candidate, { attemptId: ATTEMPT, principal }), true);
  assert.deepEqual(candidate.request.settings, { n: 1, model_type: input.model_id, ...input.parameters, file_urls: [] });
  const chat = await f.chatClient.createChat("image", "wan-t2i-native-probe");
  const permit = createOwnerWanT2iOneShotPermit({ preparer: f.preparer, candidate, principal, attemptId: ATTEMPT, catalog: CATALOG,
    catalog_version: VERSION, now: () => f.now });
  try {
    try {
      await f.chatClient.startWanT2iImageWithOwnedCandidate({ preparer: f.preparer, candidate, permit, principal,
        attemptId: ATTEMPT, chat_uuid: chat.chat_uuid }, deadline.signal);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "none";
      assert.fail(`native-boundary failed: ${error instanceof Error ? error.name : "unknown"}/${code}; counts=${JSON.stringify(f.counts)}`);
    }
    assert.equal(f.counts.posts, 1);
  } finally { deadline.close(); await f.preparer.close(); }
});

test("uses the actual WAN T2I preparer, two fresh preflights, fixed native POST, and bound result GET", async () => {
  const f = fixture();
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    let module: Record<string, unknown> | undefined;
    try { module = await import(SERVICE_URL) as Record<string, unknown>; } catch { /* Expected initial runtime RED: service module does not exist yet. */ }
    assert.equal(typeof module?.OwnerWanT2iGenerationService, "function", "MISSING_OWNER_WAN_T2I_GENERATION_SERVICE");
    const Service = module!.OwnerWanT2iGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: f.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: f.preparer, resolveChatClient: () => f.chatClient,
      createAccountStatusService: f.createAccountStatusService, createModelAccessService: f.createModelAccessService,
      now: () => f.now, pollDelayMs: 0, maxPollAttempts: 2 });
    let result: Record<string, unknown>;
    try {
      result = await service.generate({ attemptId: ATTEMPT, input: { model_id: "wan_25_t2i_preview", prompt: "A quiet mountain at dawn",
        parameters: { aspect_ratio: "1:1", resolution: "720P", batch_size: 1, prompt_extend: false,
          seed: null, color_palette: null, bbox_list: [] } } });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "none";
      assert.fail(`synthetic generation failed: ${error instanceof Error ? error.name : "unknown"}/${code}; calls=${f.events.map(({ method, url }) => `${method} ${url.pathname}`).join(" | ")}; counts=${JSON.stringify(f.counts)}`);
    }
    assert.equal(result.status, "result_observed");
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(f.counts.accountFactories, 2);
    assert.equal(f.counts.accessFactories, 2);
    assert.equal(f.counts.preflightGets, 4);
    assert.equal(f.counts.chatCreates, 1);
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.historyGets, 1);
    assert.equal(f.counts.resultGets, 1);
    const accessReads = f.events.filter(({ url }) => url.pathname === "/api/v2/get_model_info");
    assert.equal(accessReads.length, 2);
    for (const event of accessReads) {
      assert.equal(event.url.searchParams.get("ai_name"), "wan_image");
      assert.equal(event.url.searchParams.get("model_type"), "wan_25_t2i_preview");
      assert.deepEqual(Array.from(event.url.searchParams.keys()).slice(2), ["batch_size"]);
    }
    const post = f.events.find(({ method, url }) => method === "POST" && url.pathname === "/api/v1/design/generate");
    assert.deepEqual(post?.body, { chat_uuid: "wan-t2i-generation-chat-844-1", prompt: "A quiet mountain at dawn",
      settings: { n: 1, model_type: "wan_25_t2i_preview", aspect_ratio: "1:1", resolution: "720P", batch_size: 1,
        prompt_extend: false, seed: null, color_palette: null, bbox_list: [], file_urls: [] } });
  } finally { await service?.close(); }
});

test("runs all 80 explicit model, aspect-ratio, resolution, and batch combinations without narrowing batch cost", async () => {
  const f = fixture();
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerWanT2iGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: f.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: f.preparer, resolveChatClient: () => f.chatClient,
      createAccountStatusService: f.createAccountStatusService, createModelAccessService: f.createModelAccessService,
      now: () => f.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const models = ["wan_25_t2i_preview", "wan_26_t2i"] as const;
    const ratios = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
    const resolutions = ["720P", "1080P"] as const;
    const seeds = [null, 0, 2_147_483_647] as const;
    let index = 0;
    for (const model_id of models) for (const aspect_ratio of ratios) for (const resolution of resolutions) {
      for (const batch_size of [1, 2, 3, 4] as const) {
        const prompt = `Explicit request ${index}`;
        const prompt_extend = index % 2 === 0;
        const seed = seeds[index % seeds.length]!;
        const result = await service.generate({ attemptId: ATTEMPT, input: { model_id, prompt,
          parameters: { aspect_ratio, resolution, batch_size, prompt_extend, seed, color_palette: null, bbox_list: [] } } });
        assert.equal(result.status, "result_observed");
        assert.equal(result.requested_batch_size, batch_size);
        assert.equal(result.actual_result_count, batch_size);
        assert.equal(result.count_confidence, "CURRENT_MESSAGE_MATCHES_EXPLICIT_BATCH_NOT_PROVIDER_TERMINAL");
        assert.equal(result.provider_terminal_confidence, "UNPROVEN");
        assert.equal((result.artifacts as readonly unknown[]).length, batch_size);
        index += 1;
      }
    }
    assert.equal(index, 80);
    assert.equal(f.counts.posts, 80);
    assert.equal(f.counts.chatCreates, 80);
    assert.equal(f.counts.accountFactories, 160);
    assert.equal(f.counts.accessFactories, 160);
    assert.equal(f.counts.historyGets, 80);
    assert.equal(f.counts.resultGets, 80);
    const accessReads = f.events.filter(({ url }) => url.pathname === "/api/v2/get_model_info");
    assert.equal(accessReads.length, 160);
    for (let i = 0; i < accessReads.length; i += 1) {
      assert.deepEqual(Array.from(accessReads[i]!.url.searchParams.keys()).slice(2), ["batch_size"]);
    }
  } finally { await service?.close(); }
});

test("returns known partial artifacts and reconciles by GET only after the subscription has expired", async () => {
  const endDate = new Date(Date.parse("2026-10-11T00:00:00.000Z") + 5 * 60_000).toISOString();
  const f = fixture({ partialFirstBatchFour: true, endDate });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    listRecoveries(input: unknown): Promise<readonly Record<string, unknown>[]>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerWanT2iGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: f.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: f.preparer, resolveChatClient: () => f.chatClient,
      createAccountStatusService: f.createAccountStatusService, createModelAccessService: f.createModelAccessService,
      now: () => f.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const input = { model_id: "wan_26_t2i" as const, prompt: "Keep partial outputs available for recovery",
      parameters: { aspect_ratio: "16:9" as const, resolution: "1080P" as const, batch_size: 4 as const,
        prompt_extend: true, seed: 2_147_483_647, color_palette: null, bbox_list: [] as const } };
    const partial = await service.generate({ attemptId: ATTEMPT, input });
    assert.equal(partial.status, "partial_results");
    assert.equal(partial.actual_result_count, 1);
    assert.equal((partial.artifacts as readonly unknown[]).length, 1);
    assert.equal(partial.count_confidence, "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL");
    assert.equal(typeof partial.recovery_id, "string");
    f.setSubscriptionActive(false);
    f.advance(6 * 60_000);
    const recovered = await service.reconcile({ attemptId: ATTEMPT, recovery_id: partial.recovery_id });
    assert.equal(recovered.status, "result_observed");
    assert.equal(recovered.actual_result_count, 4);
    assert.equal((recovered.artifacts as readonly unknown[]).length, 4);
    assert.equal(recovered.provider_terminal_confidence, "UNPROVEN");
    assert.equal(f.counts.accountFactories, 2);
    assert.equal(f.counts.accessFactories, 2);
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.chatCreates, 1);
    assert.equal(f.counts.historyGets, 2);
    assert.equal(f.counts.resultGets, 2);
    assert.deepEqual(await service.listRecoveries({ attemptId: ATTEMPT }), []);
  } finally { await service?.close(); }
});

test("a lost POST acknowledgment leaves a stable non-evicting unknown hold and never retries", async () => {
  const f = fixture({ loseAck: true });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    listRecoveries(input: unknown): Promise<readonly Record<string, unknown>[]>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerWanT2iGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: f.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: f.preparer, resolveChatClient: () => f.chatClient,
      createAccountStatusService: f.createAccountStatusService, createModelAccessService: f.createModelAccessService,
      now: () => f.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const input = { model_id: "wan_25_t2i_preview" as const, prompt: "Unknown outcome is never replayed",
      parameters: { aspect_ratio: "1:1" as const, resolution: "720P" as const, batch_size: 1 as const,
        prompt_extend: false, seed: null, color_palette: null, bbox_list: [] as const } };
    let recoveryId = "";
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input }), (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, "OUTCOME_UNKNOWN");
      recoveryId = String((error as { recovery_id?: unknown }).recovery_id);
      assert.equal((error as { diagnostic?: { post_started?: unknown; echo_ack_known?: unknown } }).diagnostic?.post_started, true);
      assert.equal((error as { diagnostic?: { echo_ack_known?: unknown } }).diagnostic?.echo_ack_known, false);
      return true;
    });
    const listed = await service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.recovery_id, recoveryId);
    const beforePosts = f.counts.posts;
    const beforePreflights = f.counts.preflightGets;
    const changedAttempt = "link_wan_t2i_generation_test_000000000002";
    await assert.rejects(service.generate({ attemptId: changedAttempt, input }), (error: unknown) =>
      (error as { code?: unknown }).code === "INTENT_ALREADY_CLAIMED");
    assert.equal(f.counts.posts, beforePosts);
    assert.equal(f.counts.preflightGets, beforePreflights);
    f.advance(16 * 60_000);
    await assert.rejects(service.generate({ attemptId: changedAttempt, input }), (error: unknown) =>
      (error as { code?: unknown }).code === "INTENT_ALREADY_CLAIMED");
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.preflightGets, beforePreflights);
  } finally { await service?.close(); }
});

test("a concurrent duplicate cannot release or steal the first run's semantic reservation", async () => {
  const f = fixture({ gateFirstBalance: true });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerWanT2iGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: f.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: f.preparer, resolveChatClient: () => f.chatClient,
      createAccountStatusService: f.createAccountStatusService, createModelAccessService: f.createModelAccessService,
      now: () => f.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const input = { model_id: "wan_26_t2i" as const, prompt: "Reserve one exact semantic intent",
      parameters: { aspect_ratio: "3:4" as const, resolution: "720P" as const, batch_size: 2 as const,
        prompt_extend: false, seed: 0, color_palette: null, bbox_list: [] as const } };
    const first = service.generate({ attemptId: ATTEMPT, input });
    await f.firstBalanceStarted;
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input }), (error: unknown) =>
      (error as { code?: unknown }).code === "SERVICE_BUSY");
    f.releaseFirstBalance();
    const result = await first;
    assert.equal(result.status, "result_observed");
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.chatCreates, 1);
    assert.equal(f.counts.accountFactories, 2);
    assert.equal(f.counts.accessFactories, 2);
  } finally { f.releaseFirstBalance(); await service?.close(); }
});

test("keeps the 128th distinct unknown hold and rejects the 129th without eviction or another preflight", async () => {
  const f = fixture({ loseAck: true });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerWanT2iGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: f.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: f.preparer, resolveChatClient: () => f.chatClient,
      createAccountStatusService: f.createAccountStatusService, createModelAccessService: f.createModelAccessService,
      now: () => f.now, pollDelayMs: 0, maxPollAttempts: 1 });
    for (let index = 0; index < 128; index += 1) {
      const input = { model_id: "wan_25_t2i_preview" as const, prompt: `Distinct unresolved intent ${index}`,
        parameters: { aspect_ratio: "1:1" as const, resolution: "720P" as const, batch_size: 1 as const,
          prompt_extend: false, seed: index, color_palette: null, bbox_list: [] as const } };
      await assert.rejects(service.generate({ attemptId: ATTEMPT, input }), (error: unknown) =>
        (error as { code?: unknown }).code === "OUTCOME_UNKNOWN");
    }
    const previousPosts = f.counts.posts;
    const previousPreflights = f.counts.preflightGets;
    const overflowInput = { model_id: "wan_25_t2i_preview" as const, prompt: "129th must be busy, not evicted",
      parameters: { aspect_ratio: "3:4" as const, resolution: "1080P" as const, batch_size: 4 as const,
        prompt_extend: true, seed: 2_147_483_647, color_palette: null, bbox_list: [] as const } };
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: overflowInput }), (error: unknown) =>
      (error as { code?: unknown }).code === "SERVICE_BUSY");
    assert.equal(previousPosts, 128);
    assert.equal(f.counts.posts, previousPosts);
    assert.equal(f.counts.preflightGets, previousPreflights);
    assert.equal(f.counts.chatCreates, 128);
  } finally { await service?.close(); }
});

test("close aborts and drains a pre-dispatch account read before closing the actual preparer", async () => {
  const f = fixture({ gateFirstBalance: true });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerWanT2iGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: f.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: f.preparer, resolveChatClient: () => f.chatClient,
      createAccountStatusService: f.createAccountStatusService, createModelAccessService: f.createModelAccessService,
      now: () => f.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const input = { model_id: "wan_25_t2i_preview" as const, prompt: "Close drains before dispatch",
      parameters: { aspect_ratio: "4:3" as const, resolution: "720P" as const, batch_size: 1 as const,
        prompt_extend: false, seed: null, color_palette: null, bbox_list: [] as const } };
    const pending = service.generate({ attemptId: ATTEMPT, input });
    await f.firstBalanceStarted;
    const closing = service.close();
    await assert.rejects(pending, (error: unknown) => (error as { code?: unknown }).code === "PREFLIGHT_FAILED");
    await closing;
    assert.equal(f.counts.posts, 0);
    assert.equal(f.counts.chatCreates, 0);
  } finally { f.releaseFirstBalance(); await service?.close(); }
});
