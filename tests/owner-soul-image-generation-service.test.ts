import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerSoulCharacterCatalogHttpClient } from "../src/adapter/syntx/owner-soul-character-catalog-http-client.js";
import { OwnerSoulStyleCatalogHttpClient } from "../src/adapter/syntx/owner-soul-style-catalog-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { OwnerSoulCharacterOptionsService } from "../src/application/owner-soul-character-options-service.js";
import { OwnerSoulImageRequestPreparer } from "../src/application/owner-soul-image-request-preparer.js";
import { OwnerSoulStyleOptionsService } from "../src/application/owner-soul-style-options-service.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";

const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", VERSION), "utf8"
))));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "soul-generation-tenant", subject: "soul-generation-subject" });
const ATTEMPT = "link_soul_generation_test_000000000001";
const SERVICE_URL = new URL("../src/application/owner-soul-image-generation-service.js", import.meta.url).href;

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

function createFixture(options: { advanceClockOnChatMs?: number; historyGrowth?: boolean; providerChanges?: boolean;
  botMessageChanges?: boolean; historyOrderChanges?: boolean; sparseInitialHistory?: boolean; historyStaysPartial?: boolean; resultUrlsChange?: boolean;
  characterReferences?: readonly (string | number)[]; generationAckLost?: boolean; endDate?: string; blockFirstBalance?: boolean;
  subscriptionActive?: boolean; access?: boolean | null; accountNowOffsetMs?: number; accessNowOffsetMs?: number } = {}) {
  let now = Date.parse("2026-10-11T00:00:00.000Z");
  let generatedBatch: 1 | 4 = 1;
  let chatCount = 0;
  let revoked = false;
  const events: Array<{ method: string; url: URL; body: unknown }> = [];
  const counters = { accountFactories: 0, accessFactories: 0, preflightReads: 0, chatCreates: 0, generationPosts: 0,
    historyGets: 0, resultGets: 0, styleGets: 0, characterGets: 0, balanceAborts: 0, revokes: 0 };
  let balanceReads = 0;
  let firstBalanceReady!: () => void;
  let releaseFirstBalance!: () => void;
  const firstBalanceStarted = new Promise<void>((resolve) => { firstBalanceReady = resolve; });
  const firstBalanceGate = new Promise<void>((resolve) => { releaseFirstBalance = resolve; });
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-soul-service-credential");
  } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body) as unknown;
    events.push({ method, url, body });
    if (url.pathname === "/api/v1/hf/lora/styles") {
      counters.styleGets += 1;
      return Response.json({ items: [{ style_id: "soul-private-style-source-id", name: "Reviewed Style", image: "https://images.invalid/style.png" }], total: 1 });
    }
    if (url.pathname === "/api/v1/hf/lora/list") {
      counters.characterGets += 1;
      const referenceId = options.characterReferences?.[Math.min(counters.characterGets - 1, options.characterReferences.length - 1)] ?? 0;
      return Response.json({ items: [{ id: "soul-private-record-id", reference_id: referenceId, title: "Ready Character", status: "completed" }], total: 1 });
    }
    if (url.pathname === "/api/v1/user/balance") {
      counters.preflightReads += 1;
      balanceReads += 1;
      if (options.blockFirstBalance && balanceReads === 1) {
        firstBalanceReady();
        await new Promise<void>((resolve, reject) => {
          const abort = () => { counters.balanceAborts += 1; reject(new Error("synthetic account read aborted")); };
          const signal = init?.signal;
          if (signal?.aborted) { abort(); return; }
          signal?.addEventListener("abort", abort, { once: true });
          firstBalanceGate.then(() => { signal?.removeEventListener("abort", abort); resolve(); });
        });
      }
      return Response.json({ balance: "1000" });
    }
    if (url.pathname === "/api/v1/user/subscription") {
      counters.preflightReads += 1;
      return Response.json({ active: options.subscriptionActive ?? true, type: "PRO", end_date: options.endDate ?? "2026-10-12T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      return Response.json({ access: options.access === undefined ? true : options.access, cost: 2, discount_cost: null,
        free_remaining_generations: null, limit: 0.5, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counters.chatCreates += 1;
      now += options.advanceClockOnChatMs ?? 0;
      chatCount += 1;
      return Response.json({ uuid: `soul-chat-824-${chatCount}` });
    }
    if (url.pathname === "/api/v1/design/generate" && method === "POST") {
      counters.generationPosts += 1;
      generatedBatch = ((body as { settings: { batch_size: 1 | 4 } }).settings.batch_size);
      if (options.generationAckLost) throw new Error("synthetic lost generation acknowledgement");
      return Response.json({ id: "owner-ack-824" });
    }
    const chatMessagesMatch = /^\/api\/v1\/chats\/(soul-chat-824-\d+)\/messages$/u.exec(url.pathname);
    if (chatMessagesMatch) {
      counters.historyGets += 1;
      const historyIndex = counters.historyGets;
      const outputIndices = options.historyStaysPartial && generatedBatch === 4 ? [0] :
        options.sparseInitialHistory && generatedBatch === 4 && historyIndex === 1 ? [0, 2] :
        options.historyGrowth && generatedBatch === 4 && historyIndex === 1 ? [0] : Array.from({ length: generatedBatch }, (_, index) => index);
      const providerId = options.providerChanges && historyIndex > 1 ? 9002 : 9001;
      const resultMessageId = options.botMessageChanges && historyIndex > 1 ? "soul-result-message-changed" : "soul-result-message-824";
      const resultObjects = outputIndices.map((index) => ({ id: 2001 + index,
        message_id: resultMessageId, object_type: "image", model_type: "higgsfield-soul" }));
      const rows = [
        { id: "owner-ack-824", chat_id: providerId, author_id: 42, message_object: [] },
        { id: resultMessageId, chat_id: providerId, author_id: -1, message_object: resultObjects }
      ];
      if (options.historyOrderChanges && historyIndex > 1) rows.reverse();
      return Response.json({ messages: [
        ...rows
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(soul-chat-824-\d+)\/([^/]+)$/u.exec(url.pathname);
    if (resultMatch) {
      counters.resultGets += 1;
      const outputIndices = options.historyStaysPartial && generatedBatch === 4 ? [0] :
        options.sparseInitialHistory && generatedBatch === 4 && counters.resultGets === 1 ? [0, 2] :
        options.historyGrowth && generatedBatch === 4 && counters.resultGets === 1 ? [0] : Array.from({ length: generatedBatch }, (_, index) => index);
      const objects = outputIndices.map((index) => ({ id: 2001 + index,
        message_id: resultMatch[2], object_type: "image", model_type: "higgsfield-soul", completed: true,
        object_url: options.resultUrlsChange && counters.resultGets > 1 && index === 0
          ? "https://r2.syntx.ai/soul/rotated-result-1.webp" : `https://r2.syntx.ai/soul/result-${index + 1}.png` }));
      return Response.json({ id: resultMatch[2], chat_id: 9001, author_id: -1, message_object: objects });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const linkService = new PerUserLinkService({} as never, {
    async getSnapshot(_binding: unknown, attemptId: string) {
      return revoked ? { ...linkedAttempt(attemptId), status: "REVOKED" as const, linked: false } : linkedAttempt(attemptId);
    },
    async revoke(_binding: unknown, attemptId: string) {
      counters.revokes += 1; revoked = true;
      return { ...linkedAttempt(attemptId), status: "REVOKED" as const, linked: false };
    }
  } as never);
  const styleClient = new OwnerSoulStyleCatalogHttpClient({ credentialBroker: broker, fetchImpl });
  const characterClient = new OwnerSoulCharacterCatalogHttpClient({ credentialBroker: broker, fetchImpl });
  const styleOptionsService = new OwnerSoulStyleOptionsService({ binding: BINDING, linkService, catalog: CATALOG,
    catalogVersion: VERSION, resolveClient: () => styleClient, now: () => now });
  const characterOptionsService = new OwnerSoulCharacterOptionsService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: VERSION, resolveClient: () => characterClient, now: () => now });
  const preparer = new OwnerSoulImageRequestPreparer({ binding: BINDING, linkService, styleOptionsService,
    characterOptionsService, catalog: CATALOG, catalog_version: VERSION, now: () => now });
  const chatClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const readClient = () => new SyntxHttpClient({ credentialBroker: broker, fetchImpl });
  const createAccountStatusService = () => {
    counters.accountFactories += 1;
    return new AccountStatusService(readClient(), () => now - (options.accountNowOffsetMs ?? 0));
  };
  const createModelAccessService = () => {
    counters.accessFactories += 1;
    return new ModelAccessService(CATALOG, readClient(), () => now - (options.accessNowOffsetMs ?? 0));
  };
  return { events, counters, linkService, styleOptionsService, characterOptionsService, preparer, chatClient,
    createAccountStatusService, createModelAccessService, firstBalanceStarted, releaseFirstBalance,
    get now() { return now; }, set now(value: number) { now = value; } };
}

test("runs one owned Soul generation through two fresh real account/access preflights and the fixed native boundary", async () => {
  const fixture = createFixture({ advanceClockOnChatMs: 5_000 });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    const styles = await fixture.styleOptionsService.listOptions({ attemptId: ATTEMPT });
    const characters = await fixture.characterOptionsService.listOptions({ attemptId: ATTEMPT });
    let module: Record<string, unknown> | undefined;
    try { module = await import(SERVICE_URL) as Record<string, unknown>; } catch { /* Expected initial runtime RED until implementation. */ }
    assert.equal(typeof module?.OwnerSoulImageGenerationService, "function", "MISSING_OWNER_SOUL_IMAGE_GENERATION_SERVICE");
    const Service = module!.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 2 });
    let result: Record<string, unknown>;
    try { result = await service.generate({ attemptId: ATTEMPT, input: { prompt: "A quiet portrait in a sunlit room",
      quality: "720p", resolution: "2048x1152", batch_size: 1, enhance_prompt: true, seed: 0,
      style: { kind: "selected", style_handle: styles.options[0]!.style_handle, strength: 0.7 },
      character: { kind: "selected", character_handle: characters.options[0]!.character_handle! } } }); }
    catch (error) {
      assert.fail(`unexpected synthetic generation failure: ${String(error)}; calls=${fixture.events.map(({ method, url }) => `${method} ${url.pathname}`).join(" | ")}`);
    }
    assert.equal(result.status, "result_observed");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.dispatch_allowed, false);
    assert.equal(fixture.counters.accountFactories, 2);
    assert.equal(fixture.counters.accessFactories, 2);
    assert.equal(fixture.counters.preflightReads, 4);
    assert.equal(fixture.counters.chatCreates, 1);
    assert.equal(fixture.counters.generationPosts, 1);
    assert.equal(fixture.counters.historyGets, 1);
    assert.equal(fixture.counters.resultGets, 1);
    const modelReads = fixture.events.filter(({ url }) => url.pathname === "/api/v2/get_model_info");
    assert.equal(modelReads.length, 2);
    for (const event of modelReads) {
      assert.equal(event.url.searchParams.get("ai_name"), "higgsfield-soul");
      assert.equal(event.url.searchParams.get("model_type"), "higgsfield-soul");
      assert.deepEqual(Array.from(event.url.searchParams.keys()).slice(2), ["batch_size", "quality", "resolution"]);
    }
    const chatIndex = fixture.events.findIndex(({ url, method }) => url.pathname === "/api/v1/chats" && method === "POST");
    const firstModelIndex = fixture.events.findIndex(({ url }) => url.pathname === "/api/v2/get_model_info");
    const secondModelIndex = fixture.events.findIndex(({ url }, index) => url.pathname === "/api/v2/get_model_info" && index > firstModelIndex);
    const postIndex = fixture.events.findIndex(({ url }) => url.pathname === "/api/v1/design/generate");
    assert.ok(firstModelIndex < chatIndex && chatIndex < secondModelIndex && secondModelIndex < postIndex,
      "the first access read precedes chat creation and the fresh second read precedes the single generation POST");
    const postBody = fixture.events[postIndex]!.body as { prompt: string; settings: Record<string, unknown> };
    assert.equal(postBody.prompt, "A quiet portrait in a sunlit room");
    assert.deepEqual(postBody.settings, { n: 1, model_type: "higgsfield-soul", quality: "720p", resolution: "2048x1152",
      batch_size: 1, enhance_prompt: true, seed: 0, style_id: "soul-private-style-source-id", style_strength: 0.7,
      reference_id: 0, file_urls: [] });
    assert.equal(Object.hasOwn(postBody.settings, "reference_strength"), false);
    assert.equal(Object.hasOwn(postBody.settings, "version"), false);
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("keeps none/none candidate expiry anchored before fresh preflights and chat creation", async () => {
  const fixture = createFixture({ advanceClockOnChatMs: 5_000 });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 2 });
    const result = await service.generate({ attemptId: ATTEMPT, input: { prompt: "A simple source-shaped image",
      quality: "720p", resolution: "2048x1152", batch_size: 1, enhance_prompt: false, seed: null,
      style: { kind: "none" }, character: { kind: "none" } } });
    assert.equal(result.status, "result_observed");
    assert.equal(fixture.counters.styleGets, 0);
    assert.equal(fixture.counters.characterGets, 0);
    assert.equal(fixture.counters.chatCreates, 1);
    assert.equal(fixture.counters.generationPosts, 1);
    const post = fixture.events.find(({ url }) => url.pathname === "/api/v1/design/generate")!;
    const body = post.body as { settings: Record<string, unknown> };
    assert.deepEqual(body.settings, { n: 1, model_type: "higgsfield-soul", quality: "720p", resolution: "2048x1152",
      batch_size: 1, enhance_prompt: false, seed: null, style_id: "", reference_id: "", file_urls: [] });
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("rebinds same chat and ACK when history grows from one to four outputs and preserves exact output order", async () => {
  const fixture = createFixture({ historyGrowth: true });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 3 });
    const result = await service.generate({ attemptId: ATTEMPT, input: { prompt: "Four observed results after delayed history expansion",
      quality: "1080p", resolution: "2048x1536", batch_size: 4, enhance_prompt: false, seed: null,
      style: { kind: "none" }, character: { kind: "none" } } });
    assert.equal(result.status, "result_observed");
    assert.equal(result.requested_batch_size, 4);
    assert.equal(result.actual_result_count, 4);
    assert.deepEqual((result.artifacts as Array<{ message_object_id: string }>).map(({ message_object_id }) => message_object_id),
      ["2001", "2002", "2003", "2004"]);
    assert.equal(fixture.counters.historyGets, 2);
    assert.equal(fixture.counters.resultGets, 2);
    assert.equal(fixture.counters.generationPosts, 1);
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("accepts a fresh full history that inserts unseen IDs between prior ordered IDs and updates a rotated safe URL", async () => {
  const fixture = createFixture({ sparseInitialHistory: true, resultUrlsChange: true });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 3 });
    const result = await service.generate({ attemptId: ATTEMPT, input: { prompt: "Retain sparse outputs as history grows",
      quality: "1080p", resolution: "2048x1536", batch_size: 4, enhance_prompt: false, seed: null,
      style: { kind: "none" }, character: { kind: "none" } } });
    assert.equal(result.status, "result_observed");
    const artifacts = result.artifacts as Array<{ message_object_id: string; url: string }>;
    assert.deepEqual(artifacts.map(({ message_object_id }) => message_object_id), ["2001", "2002", "2003", "2004"]);
    assert.equal(artifacts[0]?.url, "https://r2.syntx.ai/soul/rotated-result-1.webp");
    assert.equal(artifacts[2]?.url, "https://r2.syntx.ai/soul/result-3.png");
    assert.equal(fixture.counters.historyGets, 2);
    assert.equal(fixture.counters.resultGets, 2);
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("fails closed if a refreshed batch history changes provider, bot message, or owner/bot order", async () => {
  const cases = [
    { label: "provider id", options: { providerChanges: true }, reason: "HISTORY_MESSAGE_SET_INVALID" },
    { label: "bot message id", options: { botMessageChanges: true }, reason: "HISTORY_MESSAGE_SET_INVALID" },
    { label: "row order", options: { historyOrderChanges: true }, reason: "OWNER_ACK_AMBIGUOUS" }
  ] as const;
  const module = await import(SERVICE_URL) as Record<string, unknown>;
  const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => {
    generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  for (const entry of cases) {
    const fixture = createFixture({ historyGrowth: true, ...entry.options });
    const service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 3 });
    try {
      await assert.rejects(service.generate({ attemptId: ATTEMPT, input: { prompt: `batch history changed ${entry.label}`,
        quality: "1080p", resolution: "2048x1536", batch_size: 4, enhance_prompt: false, seed: null,
        style: { kind: "none" }, character: { kind: "none" } } }), (error: unknown) => {
        assert.equal(Reflect.get(error as object, "code"), "OUTCOME_UNKNOWN");
        assert.equal(Reflect.get(error as object, "diagnostic")?.history_reason, entry.reason);
        return true;
      });
      assert.equal(fixture.counters.generationPosts, 1, "the native POST is never retried after unknown outcome");
      assert.equal(fixture.counters.resultGets, 1, "the mutated history context is rejected before another result GET");
    } finally {
      await service.close(); await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
    }
  }
});

test("reconciles with GETs after subscription expiry without repeating account or model-access preflights", async () => {
  const fixture = createFixture({ historyGrowth: true, endDate: "2026-10-11T00:10:00.000Z" });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  let recoveryId: string | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const partial = await service.generate({ attemptId: ATTEMPT, input: { prompt: "recover an incomplete four-image observation",
      quality: "1080p", resolution: "2048x1536", batch_size: 4, enhance_prompt: false, seed: null,
      style: { kind: "none" }, character: { kind: "none" } } });
    assert.equal(partial.status, "partial_results");
    recoveryId = partial.recovery_id as string;
    assert.ok(recoveryId);
    const accountFactoryCount = fixture.counters.accountFactories;
    const accessFactoryCount = fixture.counters.accessFactories;
    fixture.now = Date.parse("2026-10-11T00:10:01.000Z");
    const recovered = await service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId! });
    assert.equal(recovered.status, "result_observed");
    assert.equal(recovered.actual_result_count, 4);
    assert.equal(fixture.counters.accountFactories, accountFactoryCount);
    assert.equal(fixture.counters.accessFactories, accessFactoryCount);
    assert.equal(fixture.counters.generationPosts, 1);
    assert.equal(fixture.counters.historyGets, 2);
    assert.equal(fixture.counters.resultGets, 2);
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("keeps dispatched Soul recovery GET-only after input TTL until the observed batch completes", async () => {
  const behavior: { historyStaysPartial?: boolean } = { historyStaysPartial: true };
  const fixture = createFixture(behavior);
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    listRecoveries(input: unknown): Promise<readonly unknown[]>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const pending = await service.generate({ attemptId: ATTEMPT, input: { prompt: "a long-running Soul batch",
      quality: "1080p", resolution: "2048x1536", batch_size: 4, enhance_prompt: false, seed: null,
      style: { kind: "none" }, character: { kind: "none" } } });
    assert.equal(pending.status, "partial_results");
    const recoveryId = pending.recovery_id as string;
    const accountFactories = fixture.counters.accountFactories;
    const accessFactories = fixture.counters.accessFactories;
    fixture.now += 16 * 60_000;
    behavior.historyStaysPartial = false;

    const listed = await service.listRecoveries({ attemptId: ATTEMPT });
    assert.ok(listed.some((item) => Reflect.get(item as object, "recovery_id") === recoveryId),
      "dispatched recovery remains available after the selector input TTL");
    const completed = await service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });

    assert.equal(completed.status, "result_observed");
    assert.equal(completed.actual_result_count, 4);
    assert.equal(fixture.counters.chatCreates, 1);
    assert.equal(fixture.counters.generationPosts, 1);
    assert.equal(fixture.counters.accountFactories, accountFactories);
    assert.equal(fixture.counters.accessFactories, accessFactories);
    assert.equal(fixture.counters.historyGets, 2);
    assert.equal(fixture.counters.resultGets, 2);
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("rechecks revoked owner authorization before long-lived Soul recovery GETs", async () => {
  const behavior: { historyStaysPartial?: boolean } = { historyStaysPartial: true };
  const fixture = createFixture(behavior);
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const pending = await service.generate({ attemptId: ATTEMPT, input: { prompt: "revoke before long recovery read",
      quality: "1080p", resolution: "2048x1536", batch_size: 4, enhance_prompt: false, seed: null,
      style: { kind: "none" }, character: { kind: "none" } } });
    const recoveryId = pending.recovery_id as string;
    const historyGets = fixture.counters.historyGets;
    const resultGets = fixture.counters.resultGets;
    fixture.now += 16 * 60_000;
    await fixture.linkService.revoke(BINDING, ATTEMPT);

    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }), (error: unknown) => {
      assert.equal(Reflect.get(error as object, "code"), "OUTCOME_UNKNOWN");
      return true;
    });
    assert.equal(fixture.counters.historyGets, historyGets, "revoked owner cannot trigger another history GET");
    assert.equal(fixture.counters.resultGets, resultGets, "revoked owner cannot trigger another result GET");
    assert.equal(fixture.counters.generationPosts, 1);
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("returns ordered known partial artifacts with a recovery handle and completes them through GET-only reconcile", async () => {
  const behavior: { historyStaysPartial?: boolean } = { historyStaysPartial: true };
  const fixture = createFixture(behavior);
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  let recoveryId: string | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const partial = await service.generate({ attemptId: ATTEMPT, input: { prompt: "retain the first result while the rest are pending",
      quality: "1080p", resolution: "2048x1536", batch_size: 4, enhance_prompt: false, seed: null,
      style: { kind: "none" }, character: { kind: "none" } } });
    assert.equal(partial.status, "partial_results");
    assert.equal(partial.actual_result_count, 1);
    assert.equal(partial.count_confidence, "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL");
    recoveryId = partial.recovery_id as string;
    assert.ok(recoveryId);
    assert.deepEqual((partial.artifacts as Array<{ message_object_id: string }>).map(({ message_object_id }) => message_object_id), ["2001"]);
    behavior.historyStaysPartial = false;
    const recovered = await service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(recovered.status, "result_observed");
    assert.equal(recovered.actual_result_count, 4);
    assert.deepEqual((recovered.artifacts as Array<{ message_object_id: string }>).map(({ message_object_id }) => message_object_id),
      ["2001", "2002", "2003", "2004"]);
    assert.equal(fixture.counters.generationPosts, 1);
    assert.equal(fixture.counters.accountFactories, 2);
    assert.equal(fixture.counters.accessFactories, 2);
    assert.equal(fixture.counters.historyGets, 2);
    assert.equal(fixture.counters.resultGets, 2);
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("refuses expired DATE_ONLY subscriptions, denied model access, and stale access reads before chat or POST", async () => {
  const cases = [
    { name: "expired DATE_ONLY subscription", options: { endDate: "2026-10-10" } },
    { name: "access false", options: { access: false } },
    { name: "stale account observation", options: { accountNowOffsetMs: 60_000 } },
    { name: "stale model-access observation", options: { accessNowOffsetMs: 60_000 } }
  ] as const;
  const module = await import(SERVICE_URL) as Record<string, unknown>;
  const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => {
    generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  };
  for (const entry of cases) {
    const fixture = createFixture(entry.options);
    const service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 2 });
    try {
      await assert.rejects(service.generate({ attemptId: ATTEMPT, input: { prompt: `deny ${entry.name}`,
        quality: "720p", resolution: "2048x1152", batch_size: 1, enhance_prompt: false, seed: null,
        style: { kind: "none" }, character: { kind: "none" } } }), (error: unknown) =>
        Reflect.get(error as object, "code") === "PREFLIGHT_FAILED");
      assert.equal(fixture.counters.chatCreates, 0);
      assert.equal(fixture.counters.generationPosts, 0);
    } finally {
      await service.close(); await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
    }
  }
});

test("rejects unobserved raw version fields before account or model-access reads", async () => {
  const fixture = createFixture();
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now });
    const explicit = { prompt: "do not guess hidden source fields", quality: "720p", resolution: "2048x1152", batch_size: 1,
      enhance_prompt: false, seed: null, style: { kind: "none" }, character: { kind: "none" }, version: "v1" };
    assert.throws(() => service!.generate({ attemptId: ATTEMPT, input: explicit }), (error: unknown) =>
      Reflect.get(error as object, "code") === "INVALID_REQUEST");
    assert.equal(fixture.counters.accountFactories, 0);
    assert.equal(fixture.counters.accessFactories, 0);
    assert.equal(fixture.counters.chatCreates, 0);
    assert.equal(fixture.counters.generationPosts, 0);
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("keeps 128 unknown semantic holds without eviction across TTL and a new link attempt", async () => {
  const fixture = createFixture({ generationAckLost: true });
  const secondAttempt = "link_soul_generation_test_000000000002";
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    listRecoveries(input: unknown): Promise<readonly unknown[]>; close(): Promise<void> } | undefined;
  try {
    const styles = await fixture.styleOptionsService.listOptions({ attemptId: ATTEMPT });
    const characters = await fixture.characterOptionsService.listOptions({ attemptId: ATTEMPT });
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const intent = (prompt: string, style?: string, character?: string) => ({ prompt, quality: "720p" as const,
      resolution: "2048x1152" as const, batch_size: 1 as const, enhance_prompt: false, seed: null,
      style: style ? { kind: "selected" as const, style_handle: style, strength: 0.5 } : { kind: "none" as const },
      character: character ? { kind: "selected" as const, character_handle: character } : { kind: "none" as const } });
    let firstRecoveryId = "";
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: intent("same intent survives retry", styles.options[0]!.style_handle,
      characters.options[0]!.character_handle!) }), (error: unknown) => {
      assert.equal(Reflect.get(error as object, "code"), "OUTCOME_UNKNOWN");
      firstRecoveryId = Reflect.get(error as object, "recovery_id") as string;
      assert.equal(Reflect.get(error as object, "diagnostic")?.post_started, true);
      assert.equal(Reflect.get(error as object, "diagnostic")?.echo_ack_known, false);
      return true;
    });
    assert.match(firstRecoveryId, /^soul_image_recovery_[0-9a-f-]{36}$/u);
    for (let index = 1; index < 128; index += 1) {
      await assert.rejects(service.generate({ attemptId: ATTEMPT, input: intent(`distinct held intent ${index}`) }),
        (error: unknown) => Reflect.get(error as object, "code") === "OUTCOME_UNKNOWN");
    }
    assert.equal(fixture.counters.generationPosts, 128);
    const listedRecoveries = await service.listRecoveries({ attemptId: ATTEMPT, limit: 2 });
    assert.equal(listedRecoveries.length, 2);
    const listedFirst = listedRecoveries[0] as { status: string; diagnostic: { post_started: boolean } };
    assert.equal(listedFirst.status, "OUTCOME_UNKNOWN");
    assert.equal(listedFirst.diagnostic.post_started, true);
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: intent("129th intent cannot evict an unknown hold") }),
      (error: unknown) => Reflect.get(error as object, "code") === "SERVICE_BUSY");
    assert.equal(fixture.counters.generationPosts, 128);
    fixture.now += 301_000;
    const freshStyles = await fixture.styleOptionsService.listOptions({ attemptId: secondAttempt });
    const freshCharacters = await fixture.characterOptionsService.listOptions({ attemptId: secondAttempt });
    await assert.rejects(service.generate({ attemptId: secondAttempt, input: intent("same intent survives retry",
      freshStyles.options[0]!.style_handle, freshCharacters.options[0]!.character_handle!) }),
    (error: unknown) => Reflect.get(error as object, "code") === "INTENT_ALREADY_CLAIMED");
    assert.equal(fixture.counters.generationPosts, 128, "new attempt handles and expired original handles do not authorize POST replay");
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("a busy duplicate cannot release the reservation owned by the first in-flight run", async () => {
  const fixture = createFixture({ generationAckLost: true, blockFirstBalance: true });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  const input = { prompt: "one semantic reservation owner", quality: "720p" as const, resolution: "2048x1152" as const,
    batch_size: 1 as const, enhance_prompt: false, seed: null, style: { kind: "none" as const }, character: { kind: "none" as const } };
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const ownerRun = service.generate({ attemptId: ATTEMPT, input });
    await fixture.firstBalanceStarted;
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input }), (error: unknown) =>
      Reflect.get(error as object, "code") === "SERVICE_BUSY");
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input }), (error: unknown) =>
      Reflect.get(error as object, "code") === "SERVICE_BUSY");
    assert.equal(fixture.counters.chatCreates, 0);
    assert.equal(fixture.counters.generationPosts, 0);
    fixture.releaseFirstBalance();
    await assert.rejects(ownerRun, (error: unknown) => Reflect.get(error as object, "code") === "OUTCOME_UNKNOWN");
    assert.equal(fixture.counters.chatCreates, 1);
    assert.equal(fixture.counters.generationPosts, 1);
  } finally {
    fixture.releaseFirstBalance();
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("attempt invalidation aborts and drains selected work before selector invalidation and later auth revocation", async () => {
  const fixture = createFixture({ blockFirstBalance: true });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    invalidateAttempt(attemptId: string): Promise<void>; close(): Promise<void> } | undefined;
  try {
    const styles = await fixture.styleOptionsService.listOptions({ attemptId: ATTEMPT });
    const characters = await fixture.characterOptionsService.listOptions({ attemptId: ATTEMPT });
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const run = service.generate({ attemptId: ATTEMPT, input: { prompt: "abort before chat creation",
      quality: "720p", resolution: "2048x1152", batch_size: 1, enhance_prompt: false, seed: null,
      style: { kind: "selected", style_handle: styles.options[0]!.style_handle, strength: 0.5 },
      character: { kind: "selected", character_handle: characters.options[0]!.character_handle! } } });
    await fixture.firstBalanceStarted;
    await service.invalidateAttempt(ATTEMPT);
    await assert.rejects(run, (error: unknown) => Reflect.get(error as object, "code") === "PREFLIGHT_FAILED");
    assert.equal(fixture.counters.balanceAborts, 1);
    assert.equal(fixture.counters.chatCreates, 0);
    assert.equal(fixture.counters.generationPosts, 0);
    assert.equal(fixture.counters.revokes, 0, "generation invalidation drains and invalidates selectors before the caller revokes auth");
    await assert.rejects(fixture.styleOptionsService.resolveStyleHandle({ attemptId: ATTEMPT, styleHandle: styles.options[0]!.style_handle }),
      (error: unknown) => typeof error === "object" && error !== null && Reflect.get(error, "code") === "OPTION_HANDLE_NOT_FOUND");
    await assert.rejects(fixture.characterOptionsService.resolveCharacterHandle({ attemptId: ATTEMPT,
      character_handle: characters.options[0]!.character_handle! }),
    (error: unknown) => typeof error === "object" && error !== null && Reflect.get(error, "code") === "OPTION_HANDLE_NOT_FOUND");
    await fixture.linkService.revoke(BINDING, ATTEMPT);
    assert.equal(fixture.counters.revokes, 1);
  } finally {
    fixture.releaseFirstBalance();
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("close aborts and drains an in-flight generation, then closes preparer and selectors before auth revoke", async () => {
  const fixture = createFixture({ blockFirstBalance: true });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  let run: Promise<Record<string, unknown>> | undefined;
  try {
    const styles = await fixture.styleOptionsService.listOptions({ attemptId: ATTEMPT });
    const characters = await fixture.characterOptionsService.listOptions({ attemptId: ATTEMPT });
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 1 });
    run = service.generate({ attemptId: ATTEMPT, input: { prompt: "close drains selector-bound work",
      quality: "720p", resolution: "2048x1152", batch_size: 1, enhance_prompt: false, seed: null,
      style: { kind: "selected", style_handle: styles.options[0]!.style_handle, strength: 0.5 },
      character: { kind: "selected", character_handle: characters.options[0]!.character_handle! } } });
    await fixture.firstBalanceStarted;
    await service.close();
    await assert.rejects(run, (error: unknown) => Reflect.get(error as object, "code") === "PREFLIGHT_FAILED");
    assert.equal(fixture.counters.balanceAborts, 1);
    assert.equal(fixture.counters.chatCreates, 0);
    assert.equal(fixture.counters.generationPosts, 0);
    assert.equal(fixture.counters.revokes, 0);
    await assert.rejects(fixture.styleOptionsService.listOptions({ attemptId: ATTEMPT }),
      (error: unknown) => typeof error === "object" && error !== null && Reflect.get(error, "code") === "SERVICE_CLOSED");
    await assert.rejects(fixture.characterOptionsService.listOptions({ attemptId: ATTEMPT }),
      (error: unknown) => typeof error === "object" && error !== null && Reflect.get(error, "code") === "SERVICE_CLOSED");
    await fixture.linkService.revoke(BINDING, ATTEMPT);
    assert.equal(fixture.counters.revokes, 1);
  } finally {
    fixture.releaseFirstBalance();
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("routes all fourteen explicit quality-resolution pairs for both source batch sizes through one native post each", async () => {
  const fixture = createFixture();
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  const pairs: readonly (readonly ["720p" | "1080p", string])[] = [
    ["720p", "2048x1152"], ["720p", "1680x1120"], ["720p", "1536x1152"], ["720p", "1536x1536"],
    ["720p", "1152x1536"], ["720p", "1120x1680"], ["720p", "1152x2048"],
    ["1080p", "2048x1152"], ["1080p", "2016x1344"], ["1080p", "2048x1536"], ["1080p", "1536x1536"],
    ["1080p", "1536x2048"], ["1080p", "1344x2016"], ["1080p", "1152x2048"]
  ];
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 1 });
    let sequence = 0;
    for (const [quality, resolution] of pairs) for (const batch_size of [1, 4] as const) {
      const result = await service.generate({ attemptId: ATTEMPT, input: { prompt: `matrix ${sequence++}`,
        quality, resolution, batch_size, enhance_prompt: (sequence % 2) === 0, seed: sequence,
        style: { kind: "none" }, character: { kind: "none" } } });
      assert.equal(result.status, "result_observed");
      assert.equal(result.requested_batch_size, batch_size);
      const post = fixture.events.filter(({ url }) => url.pathname === "/api/v1/design/generate").at(-1)!;
      const body = post.body as { prompt: string; settings: Record<string, unknown> };
      assert.equal(body.settings.quality, quality);
      assert.equal(body.settings.resolution, resolution);
      assert.equal(body.settings.batch_size, batch_size);
      assert.equal(Object.hasOwn(body.settings, "version"), false);
      assert.equal(Object.hasOwn(body.settings, "reference_strength"), false);
      assert.deepEqual(body.settings.file_urls, []);
    }
    assert.equal(fixture.counters.generationPosts, 28);
    assert.equal(fixture.counters.chatCreates, 28);
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("passes all eleven explicit Style strengths with numeric Character reference zero without truthiness coercion", async () => {
  const fixture = createFixture();
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    const styles = await fixture.styleOptionsService.listOptions({ attemptId: ATTEMPT });
    const characters = await fixture.characterOptionsService.listOptions({ attemptId: ATTEMPT });
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 1 });
    for (let step = 0; step <= 10; step += 1) {
      const strength = step / 10;
      const result: Record<string, unknown> = await service.generate({ attemptId: ATTEMPT, input: { prompt: `style strength ${step}`,
        quality: "720p", resolution: "2048x1152", batch_size: 1, enhance_prompt: true, seed: step,
        style: { kind: "selected", style_handle: styles.options[0]!.style_handle, strength },
        character: { kind: "selected", character_handle: characters.options[0]!.character_handle! } } });
      assert.equal(result.status, "result_observed");
      assert.deepEqual((result.parameters as { style: unknown }).style, { kind: "selected", strength });
      assert.deepEqual((result.parameters as { character: unknown }).character, { kind: "selected" });
      const post = fixture.events.filter(({ url }) => url.pathname === "/api/v1/design/generate").at(-1)!;
      const body = post.body as { settings: Record<string, unknown> };
      assert.equal(body.settings.style_strength, strength);
      assert.equal(body.settings.style_id, "soul-private-style-source-id");
      assert.equal(body.settings.reference_id, 0);
      assert.equal(typeof body.settings.reference_id, "number");
      assert.equal(Object.hasOwn(body.settings, "reference_strength"), false);
      assert.equal(Object.hasOwn(body.settings, "version"), false);
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes("soul-private-style-source-id"), false);
      assert.equal(serialized.includes("soul-private-record-id"), false);
    }
    assert.equal(fixture.counters.generationPosts, 11);
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("keeps numeric zero and string zero Character source values as distinct semantic intents", async () => {
  const fixture = createFixture({ characterReferences: [0, 0, "0", "0"] });
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const numericChoice = await fixture.characterOptionsService.listOptions({ attemptId: ATTEMPT });
    const generate = (characterHandle: string) => service!.generate({ attemptId: ATTEMPT, input: { prompt: "typed id intent",
      quality: "720p", resolution: "2048x1152", batch_size: 1, enhance_prompt: false, seed: null,
      style: { kind: "none" }, character: { kind: "selected", character_handle: characterHandle } } });
    const numeric = await generate(numericChoice.options[0]!.character_handle!);
    const stringChoice = await fixture.characterOptionsService.listOptions({ attemptId: ATTEMPT });
    const stringValue = await generate(stringChoice.options[0]!.character_handle!);
    assert.notEqual(numeric.intent_fingerprint, stringValue.intent_fingerprint);
    assert.notEqual(numeric.request_fingerprint, stringValue.request_fingerprint);
    assert.equal(fixture.counters.generationPosts, 2, "string `0` cannot hit the successful cache for numeric 0");
    const bodies = fixture.events.filter(({ url }) => url.pathname === "/api/v1/design/generate").map(({ body }) =>
      (body as { settings: Record<string, unknown> }).settings.reference_id);
    assert.deepEqual(bodies, [0, "0"]);
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});

test("success cache reuses the original candidate TTL and never renews it on cache hits", async () => {
  const fixture = createFixture();
  let service: { generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>; close(): Promise<void> } | undefined;
  const input = { prompt: "bounded original success cache", quality: "720p" as const, resolution: "2048x1152" as const,
    batch_size: 1 as const, enhance_prompt: false, seed: null, style: { kind: "none" as const }, character: { kind: "none" as const } };
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const Service = module.OwnerSoulImageGenerationService as new (options: Record<string, unknown>) => NonNullable<typeof service>;
    service = new Service({ binding: BINDING, linkService: fixture.linkService, catalog: CATALOG, catalog_version: VERSION,
      preparer: fixture.preparer, styleOptionsService: fixture.styleOptionsService, characterOptionsService: fixture.characterOptionsService,
      resolveChatClient: () => fixture.chatClient, createAccountStatusService: fixture.createAccountStatusService,
      createModelAccessService: fixture.createModelAccessService, now: () => fixture.now, pollDelayMs: 0, maxPollAttempts: 1 });
    const first = await service.generate({ attemptId: ATTEMPT, input });
    const firstPostCount = fixture.counters.generationPosts;
    fixture.now += 14 * 60_000;
    const cached = await service.generate({ attemptId: ATTEMPT, input });
    assert.equal(cached.request_fingerprint, first.request_fingerprint);
    assert.equal(fixture.counters.generationPosts, firstPostCount);
    assert.equal(fixture.counters.accountFactories, 2);
    fixture.now += 60_001;
    const afterOriginalExpiry = await service.generate({ attemptId: ATTEMPT, input });
    assert.equal(afterOriginalExpiry.status, "result_observed");
    assert.equal(fixture.counters.generationPosts, firstPostCount + 1,
      "expired success cache does not become an indefinitely renewed idempotency result");
  } finally {
    await service?.close();
    await fixture.preparer.close(); await fixture.styleOptionsService.close(); await fixture.characterOptionsService.close();
  }
});
