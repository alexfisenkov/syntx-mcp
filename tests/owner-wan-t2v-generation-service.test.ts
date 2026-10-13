import assert from "node:assert/strict";
import test from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  normalizeOwnerWanT2vGenerationParameters,
  OwnerWanT2vGenerationParametersError
} from "../src/application/owner-wan-t2v-generation-parameters.js";

const CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan-t2v-generation-tenant", subject: "wan-t2v-generation-subject" });
const ATTEMPT = "link_wan_t2v_generation_test_000000000001";
const SERVICE_URL = new URL("../src/application/owner-wan-t2v-generation-service.js", import.meta.url).href;

type ServiceResult = Record<string, unknown>;
interface T2vServiceApi {
  generate(input: unknown, signal?: AbortSignal): Promise<ServiceResult>;
  reconcile(input: unknown, signal?: AbortSignal): Promise<ServiceResult>;
  listRecoveries(input: unknown): Promise<readonly ServiceResult[]>;
  getResultPage(input: unknown): Promise<ServiceResult>;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
}

interface FixtureOptions {
  readonly outputCount?: number;
  readonly losePostAck?: boolean;
  readonly failSecondModelInfo?: boolean;
  readonly foreignOwnerRow?: boolean;
  readonly malformedResultModel?: boolean;
  readonly unknownResultModel?: boolean;
  readonly secondHistoryPage?: boolean;
  readonly paginatedHistory?: boolean;
  readonly partialFirstResult?: boolean;
  readonly ownerAckObjectType?: string;
  readonly ownerAckObjectModel?: string | null;
  readonly ownerAckObjectId?: string;
  readonly duplicateOwnerAck?: boolean;
  readonly pendingResults?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  let now = Date.parse("2026-10-13T00:00:00.000Z");
  let chatCount = 0;
  let modelInfoReads = 0;
  let modelAccess = true;
  const jobs = new Map<string, {
    readonly modelId: string;
    readonly ackId: string;
    readonly ackObjects: readonly { readonly id: string; readonly objectType: string; readonly modelType: string | null }[];
    readonly messages: readonly { readonly messageId: string; readonly objects: readonly { readonly id: string; readonly url: string }[] }[];
  }>();
  const events: Array<{ readonly method: string; readonly url: URL; readonly body: unknown }> = [];
  const counts = { accountFactories: 0, accessFactories: 0, accountReads: 0, modelInfoReads: 0,
    chatCreates: 0, posts: 0, historyGets: 0, resultGets: 0, inProgressGets: 0, principalReads: 0 };
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-wan-t2v-credential");
    }
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body) as unknown;
    events.push({ method, url, body });
    if (url.pathname === "/api/v1/user/balance") {
      counts.accountReads += 1;
      return Response.json({ balance: "1000" });
    }
    if (url.pathname === "/api/v1/user/subscription") {
      counts.accountReads += 1;
      return Response.json({ active: true, type: "PRO", end_date: "2026-10-14T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      counts.modelInfoReads += 1;
      modelInfoReads += 1;
      const access = options.failSecondModelInfo && modelInfoReads === 2 ? false : modelAccess;
      return Response.json({ access, cost: 2, discount_cost: null, free_remaining_generations: null,
        limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chatCreates += 1;
      chatCount += 1;
      return Response.json({ uuid: `wan-t2v-generation-chat-${chatCount}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      counts.posts += 1;
      const request = body as { readonly chat_id: string; readonly prompt: string; readonly settings: { readonly model_type: string } };
      const ackId = `wan-t2v-owner-ack-${counts.posts}`;
      const outputCount = options.pendingResults ? 0 : options.outputCount ?? 1;
      const outputRows: Array<{ messageId: string; objects: Array<{ id: string; url: string }> }> = [];
      let remaining = outputCount;
      let start = 0;
      while (remaining > 0) {
        const count = Math.min(options.partialFirstResult ? 1 : 64, remaining);
        const messageId = `wan-t2v-bot-${counts.posts}-${outputRows.length + 1}`;
        outputRows.push({ messageId, objects: Array.from({ length: count }, (_, index) => {
          const number = start + index + 1;
          return { id: `wan-t2v-object-${counts.posts}-${number}`, url: `https://r2.syntx.ai/generated/wan-${counts.posts}-${number}.mp4` };
        }) });
        remaining -= count;
        start += count;
      }
      const ackModel = options.ownerAckObjectModel === undefined ? request.settings.model_type : options.ownerAckObjectModel;
      const ackObjects = options.ownerAckObjectType === undefined ? [] : [{
        id: options.ownerAckObjectId ?? `wan-t2v-owner-ack-object-${counts.posts}`,
        objectType: options.ownerAckObjectType,
        modelType: ackModel
      }];
      jobs.set(request.chat_id, { modelId: request.settings.model_type, ackId, ackObjects, messages: outputRows });
      if (options.losePostAck) throw new Error("synthetic lost POST acknowledgment");
      return Response.json({ id: ackId });
    }
    const historyMatch = /^\/api\/v1\/chats\/(wan-t2v-generation-chat-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch) {
      counts.historyGets += 1;
      const chatId = historyMatch[1]!;
      const job = jobs.get(chatId);
      assert.ok(job, "history must be scoped to a chat created by this real client");
      const allMessages: Array<Record<string, unknown>> = [
        { id: job.ackId, chat_id: 9123, author_id: 4123, message_object: job.ackObjects.map((object) => ({
          id: object.id, message_id: job.ackId, object_type: object.objectType,
          ...(object.modelType === null ? {} : { model_type: object.modelType }), completed: true
        })) }
      ];
      if (options.duplicateOwnerAck) allMessages.push({ id: job.ackId, chat_id: 9123, author_id: 4123,
        message_object: job.ackObjects.map((object) => ({ id: object.id, message_id: job.ackId, object_type: object.objectType,
          ...(object.modelType === null ? {} : { model_type: object.modelType }), completed: true })) });
      if (options.foreignOwnerRow) allMessages.push({ id: "wan-t2v-foreign-owner-row", chat_id: 9123, author_id: 7001, message_object: [] });
      for (const row of job.messages) allMessages.push({ id: row.messageId, chat_id: 9123, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.messageId, object_type: "video",
          ...(options.unknownResultModel ? {} : { model_type: job.modelId }) })) });
      if (options.paginatedHistory) {
        for (let index = 0; index < 8; index += 1) allMessages.push({ id: `wan-t2v-empty-bot-${index}`, chat_id: 9123,
          author_id: -1, message_object: [] });
      }
      const page = Number(url.searchParams.get("page"));
      const totalCount = options.secondHistoryPage ? allMessages.length + 10 : allMessages.length;
      const totalPages = options.secondHistoryPage ? 2 : Math.ceil(totalCount / 10);
      const messages = options.secondHistoryPage ? allMessages : allMessages.slice((page - 1) * 10, page * 10);
      return Response.json({ messages, pagination: { page, page_size: 10, total_count: totalCount,
        total_pages: totalPages, has_next: page < totalPages, has_previous: page > 1 } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(wan-t2v-generation-chat-\d+)\/(wan-t2v-bot-\d+-\d+)$/u.exec(url.pathname);
    if (resultMatch) {
      counts.resultGets += 1;
      const job = jobs.get(resultMatch[1]!);
      assert.ok(job);
      const row = job.messages.find((entry) => entry.messageId === resultMatch[2]);
      assert.ok(row);
      const partialFirst = options.partialFirstResult === true && counts.resultGets === 2;
      return Response.json({ id: row.messageId, chat_id: 9123, author_id: -1, message_object: row.objects.map((object, index) => ({
        id: object.id, message_id: row.messageId, object_type: "video",
        ...(options.unknownResultModel ? {} : { model_type: options.malformedResultModel ? "wan_26_i2v" : job.modelId }),
        completed: !partialFirst || (!options.partialFirstResult && index === 0), object_url: object.url
      })) });
    }
    if (/\/inprogress$/u.test(url.pathname)) {
      counts.inProgressGets += 1;
      return Response.json([]);
    }
    throw new Error(`Unexpected synthetic HTTP request: ${method} ${url.pathname}`);
  };
  const linkService = new PerUserLinkService({} as never, {
    async getSnapshot(_binding: unknown, attemptId: string) {
      counts.principalReads += 1;
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
        status: "LINKED" as const, expires_at: null, linked: true };
    }
  } as never);
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, maxResponseBytes: 1024 * 1024 });
  const createAccountStatusService = () => {
    counts.accountFactories += 1;
    return new AccountStatusService(new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now);
  };
  const createModelAccessService = () => {
    counts.accessFactories += 1;
    return new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now);
  };
  return {
    binding: BINDING, linkService, chatClient, events, counts, createAccountStatusService, createModelAccessService,
    get now() { return now; }, advance(ms: number) { now += ms; }, setModelAccess(value: boolean) { modelAccess = value; }
  };
}

async function makeService(f: ReturnType<typeof fixture>, resolveChatClient: (attemptId: string) => unknown = () => f.chatClient,
  Constructor?: new (options: Record<string, unknown>) => T2vServiceApi): Promise<T2vServiceApi> {
  let module: Record<string, unknown> | undefined;
  try { module = await import(SERVICE_URL) as Record<string, unknown>; } catch { /* Intentional initial TDD RED: the new service module is absent. */ }
  assert.equal(typeof module?.OwnerWanT2vGenerationService, "function", "MISSING_OWNER_WAN_T2V_GENERATION_SERVICE");
  const Service = Constructor ?? module!.OwnerWanT2vGenerationService as new (options: Record<string, unknown>) => T2vServiceApi;
  return new Service({ binding: f.binding, linkService: f.linkService, catalog: CATALOG, catalog_version: CATALOG_VERSION,
    resolveChatClient, createAccountStatusService: f.createAccountStatusService,
    createModelAccessService: f.createModelAccessService, now: () => f.now, pollDelayMs: 0, maxPollAttempts: 1 });
}

const INPUT_26 = Object.freeze({ model_id: "wan_26_t2v", prompt: "A green kite rises over the sea.", parameters: Object.freeze({
  resolution: "720P", aspect_ratio: "16:9", video_duration: 5, prompt_extend: true, seed: 0, shot_type: "multi"
}) });
const INPUT_27 = Object.freeze({ model_id: "wan_27_t2v", prompt: "A quiet train passes a snowy field.", parameters: Object.freeze({
  resolution: "1080P", aspect_ratio: "3:4", video_duration: 15, prompt_extend: false, seed: null, native_audio: true
}) });

test("dispatches each explicit T2V branch once through the actual chat client with two fresh live preflights", async () => {
  const f = fixture();
  const service = await makeService(f);
  try {
    const first = await service.generate({ attemptId: ATTEMPT, input: INPUT_26 });
    const second = await service.generate({ attemptId: ATTEMPT, input: INPUT_27 });
    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
    assert.equal(first.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(first.backend_acceptance, "UNPROVEN");
    assert.equal(first.provider_terminal_status, "UNPROVEN");
    assert.equal(f.counts.accountFactories, 4);
    assert.equal(f.counts.accessFactories, 4);
    assert.equal(f.counts.accountReads, 8);
    assert.equal(f.counts.modelInfoReads, 4);
    assert.equal(f.counts.chatCreates, 2);
    assert.equal(f.counts.posts, 2);
    assert.equal(f.counts.historyGets, 2);
    assert.equal(f.counts.resultGets, 2);
    const costReads = f.events.filter((event) => event.url.pathname === "/api/v2/get_model_info");
    assert.equal(costReads.length, 4);
    assert.deepEqual(costReads.map((event) => event.url.searchParams.get("ai_name")),
      ["wan_video", "wan_video", "wan_video", "wan_video"]);
    assert.equal(costReads[0]?.url.searchParams.get("model_type"), "wan_26_t2v");
    assert.equal(costReads[0]?.url.searchParams.get("video_duration"), "5");
    assert.equal(costReads[0]?.url.searchParams.get("resolution"), "720P");
    const posts = f.events.filter((event) => event.method === "POST" && event.url.pathname === "/api/v1/video/generate");
    assert.deepEqual(posts.map((event) => event.url.searchParams.get("ai_name")), ["wan_video", "wan_video"]);
    assert.deepEqual(posts[0]?.body, { chat_id: "wan-t2v-generation-chat-1", prompt: INPUT_26.prompt, settings: {
      model_type: "wan_26_t2v", resolution: "720P", aspect_ratio: "16:9", video_duration: 5,
      prompt_extend: true, seed: 0, shot_type: "multi", file_urls: []
    } });
    assert.deepEqual(posts[1]?.body, { chat_id: "wan-t2v-generation-chat-2", prompt: INPUT_27.prompt, settings: {
      model_type: "wan_27_t2v", resolution: "1080P", aspect_ratio: "3:4", video_duration: 15,
      prompt_extend: false, seed: null, native_audio: true, file_urls: []
    } });
    const beforeDuplicate = { ...f.counts };
    const duplicate = await service.generate({ attemptId: ATTEMPT, input: INPUT_26 });
    assert.equal(duplicate.status, "completed");
    assert.equal(f.counts.principalReads, beforeDuplicate.principalReads + 1);
    assert.deepEqual({ ...f.counts, principalReads: beforeDuplicate.principalReads }, beforeDuplicate,
      "a completed semantic intent is returned from the private local result cache");
  } finally { await service.close(); }
});

test("completed semantic cache is revalidated for the exact current principal and does not expire into a second POST", async () => {
  const f = fixture();
  const service = await makeService(f);
  try {
    const first = await service.generate({ attemptId: ATTEMPT, input: INPUT_26 });
    assert.equal(first.status, "completed");
    const before = { ...f.counts };
    f.advance(16 * 60_000);
    const cached = await service.generate({ attemptId: ATTEMPT, input: INPUT_26 });
    assert.equal(cached.recovery_id, first.recovery_id);
    assert.equal(f.counts.principalReads, before.principalReads + 1, "cache reuse resolves the current principal again");
    assert.deepEqual({ ...f.counts, principalReads: before.principalReads }, before,
      "an exact-principal cache hit performs no provider IO");
  } finally { await service.close(); }
});

test("completed semantic cache cannot disclose a result across linked attempts with the same tenant and subject", async () => {
  const f = fixture();
  const service = await makeService(f);
  try {
    const first = await service.generate({ attemptId: ATTEMPT, input: INPUT_26 });
    assert.equal(first.status, "completed");
    const before = { ...f.counts };
    await assert.rejects(service.generate({ attemptId: "link_wan_t2v_generation_test_000000000002", input: INPUT_26 }),
      (error: unknown) => {
        assert.equal((error as { code?: unknown }).code, "INTENT_ALREADY_CLAIMED");
        assert.equal((error as { recovery_id?: unknown }).recovery_id, undefined);
        return true;
      });
    assert.equal(f.counts.posts, before.posts, "a different linked attempt cannot replay the completed semantic intent");
    assert.equal(f.counts.chatCreates, before.chatCreates);
    assert.equal(f.counts.historyGets, before.historyGets);
    assert.equal(f.counts.resultGets, before.resultGets);
  } finally { await service.close(); }
});

test("binds eighty native results across history pages and serves 64 plus 16 from local cache", async () => {
  const f = fixture({ outputCount: 80, paginatedHistory: true, ownerAckObjectType: "text", ownerAckObjectModel: "wan_26_t2v" });
  const service = await makeService(f);
  try {
    const first = await service.generate({ attemptId: ATTEMPT, input: INPUT_26 });
    assert.equal(first.status, "completed");
    assert.equal(first.observed_artifact_count, 80);
    assert.equal(first.page_size, 64);
    assert.equal(first.has_more, true);
    assert.equal((first.artifacts as readonly unknown[]).length, 64);
    const firstArtifact = (first.artifacts as readonly Record<string, unknown>[])[0];
    assert.equal(firstArtifact?.model_echo, "MATCHED");
    assert.equal(typeof firstArtifact?.message_object_id, "string");
    const beforePage = { ...f.counts };
    const second = await service.getResultPage({ attemptId: ATTEMPT, recovery_id: first.recovery_id, offset: 64 });
    assert.equal(second.status, "completed");
    assert.equal(second.observed_artifact_count, 80);
    assert.equal(second.has_more, false);
    assert.equal(second.next_offset, null);
    assert.equal((second.artifacts as readonly unknown[]).length, 16);
    assert.equal(f.counts.principalReads, beforePage.principalReads + 1);
    assert.deepEqual({ ...f.counts, principalReads: beforePage.principalReads }, beforePage,
      "result pages are fresh-principal-authorized local reads of already-decoded artifacts");
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.historyGets, 2, "native source history is aggregated across its two pages");
    assert.equal(f.counts.resultGets, 2, "each observed result message is read through the native WAN T2V decoder");
  } finally { await service.close(); }
});

test("accepts a source-shaped owner text acknowledgment without counting it as a video result", async () => {
  const f = fixture({ outputCount: 1, ownerAckObjectType: "text", ownerAckObjectModel: "wan_26_t2v" });
  const service = await makeService(f);
  try {
    const result = await service.generate({ attemptId: ATTEMPT, input: INPUT_26 });
    assert.equal(result.status, "completed");
    assert.equal(result.observed_artifact_count, 1);
    assert.equal((result.artifacts as readonly Record<string, unknown>[])[0]?.message_object_id, "wan-t2v-object-1-1");
    assert.equal(f.counts.resultGets, 1, "only the bot video object is read as a result");
  } finally { await service.close(); }
});

test("does not invent an owner ACK model echo when the native history model field is absent", async () => {
  const f = fixture({ outputCount: 1, ownerAckObjectType: "text", ownerAckObjectModel: null });
  const service = await makeService(f);
  try {
    const result = await service.generate({ attemptId: ATTEMPT, input: INPUT_26 });
    assert.equal(result.status, "completed");
    assert.equal(result.observed_artifact_count, 1);
  } finally { await service.close(); }
});

test("rejects malformed owner acknowledgment media and never reads its bot result", async (t) => {
  const cases = [
    { name: "wrong owner object type", options: { ownerAckObjectType: "video", ownerAckObjectModel: "wan_26_t2v" } },
    { name: "wrong owner model", options: { ownerAckObjectType: "text", ownerAckObjectModel: "wan_27_t2v" } },
    { name: "duplicate owner message", options: { ownerAckObjectType: "text", ownerAckObjectModel: "wan_26_t2v", duplicateOwnerAck: true } },
    { name: "invalid owner object ID", options: { ownerAckObjectType: "text", ownerAckObjectModel: "wan_26_t2v", ownerAckObjectId: "bad id" } },
    { name: "owner object ID collides with bot result", options: { ownerAckObjectType: "text", ownerAckObjectModel: "wan_26_t2v",
      ownerAckObjectId: "wan-t2v-object-1-1" } }
  ] as const;
  for (const entry of cases) await t.test(entry.name, async () => {
    const f = fixture({ outputCount: 1, ...entry.options });
    const service = await makeService(f);
    try {
      await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INPUT_26 }), (error: unknown) => {
        assert.equal((error as { code?: unknown }).code, "OUTCOME_UNKNOWN");
        return true;
      });
      assert.equal(f.counts.posts, 1);
      assert.equal(f.counts.historyGets, 1);
      assert.equal(f.counts.resultGets, 0, "invalid ACK bindings must not reach result GET");
    } finally { await service.close(); }
  });
});

test("pure local artifact pagination slices 80 already-observed values into 64 plus 16", async () => {
  const module = await import(SERVICE_URL) as Record<string, unknown>;
  const paginate = module.paginateOwnerWanT2vArtifacts as (items: readonly unknown[], offset: number) => {
    readonly artifacts: readonly unknown[]; readonly next_offset: number | null;
  };
  const artifacts = Array.from({ length: 80 }, (_, index) => ({ url: `https://local.invalid/${index}.mp4` }));
  const first = paginate(artifacts, 0);
  assert.equal(first.artifacts.length, 64);
  assert.equal(first.next_offset, 64);
  const second = paginate(artifacts, first.next_offset!);
  assert.equal(second.artifacts.length, 16);
  assert.equal(second.next_offset, null);
});

test("reconciles partial local availability with GET only after account access expires", async () => {
  const f = fixture({ outputCount: 2, partialFirstResult: true });
  const service = await makeService(f);
  try {
    const partial = await service.generate({ attemptId: ATTEMPT, input: INPUT_26 });
    assert.equal(partial.status, "partial_results");
    assert.equal(partial.observed_artifact_count, 1);
    const before = { ...f.counts };
    f.setModelAccess(false);
    f.advance(5 * 60_000);
    const recovered = await service.reconcile({ attemptId: ATTEMPT, recovery_id: partial.recovery_id });
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.observed_artifact_count, 2);
    assert.equal(f.counts.posts, before.posts);
    assert.equal(f.counts.chatCreates, before.chatCreates);
    assert.equal(f.counts.accountFactories, before.accountFactories);
    assert.equal(f.counts.accessFactories, before.accessFactories);
    assert.equal(f.counts.accountReads, before.accountReads);
    assert.equal(f.counts.modelInfoReads, before.modelInfoReads);
    assert.equal(f.counts.historyGets, before.historyGets + 1);
    assert.equal(f.counts.resultGets, before.resultGets + 2);
  } finally { await service.close(); }
});

test("unknown POST receipt permits history GET but never attributes output without a genuine ACK", async () => {
  const f = fixture({ losePostAck: true });
  const service = await makeService(f);
  try {
    let recoveryId = "";
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INPUT_26 }), (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, "OUTCOME_UNKNOWN");
      recoveryId = String((error as { recovery_id?: unknown }).recovery_id);
      assert.equal((error as { diagnostic?: { post_started?: unknown; ack_known?: unknown } }).diagnostic?.post_started, true);
      assert.equal((error as { diagnostic?: { post_started?: unknown; ack_known?: unknown } }).diagnostic?.ack_known, false);
      return true;
    });
    const before = { ...f.counts };
    const list = await service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(list.length, 1);
    assert.equal(list[0]?.recovery_id, recoveryId);
    await assert.rejects(service.generate({ attemptId: "link_wan_t2v_generation_test_000000000002", input: INPUT_26 }),
      (error: unknown) => (error as { code?: unknown }).code === "INTENT_ALREADY_CLAIMED");
    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => {
        assert.equal((error as { code?: unknown }).code, "OUTCOME_UNKNOWN");
        assert.equal((error as { diagnostic?: { history_reason?: unknown } }).diagnostic?.history_reason,
          "OWNER_ACK_RECEIPT_UNKNOWN");
        return true;
      });
    assert.equal(f.counts.posts, before.posts);
    assert.equal(f.counts.chatCreates, before.chatCreates);
    assert.equal(f.counts.historyGets, before.historyGets + 1, "unknown ACK permits one bounded history read");
    assert.equal(f.counts.resultGets, before.resultGets, "no bot output is attributed without matching the ACK row");
  } finally { await service.close(); }
});

test("known-ACK pending WAN T2V recovery remains GET-only beyond the former 15-minute expiry", async () => {
  const f = fixture({ pendingResults: true, ownerAckObjectType: "text", ownerAckObjectModel: "wan_26_t2v" });
  const service = await makeService(f);
  try {
    let recoveryId = "";
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INPUT_26 }), (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, "OUTCOME_UNKNOWN");
      recoveryId = String((error as { recovery_id?: unknown }).recovery_id);
      assert.equal((error as { diagnostic?: { ack_known?: unknown } }).diagnostic?.ack_known, true);
      return true;
    });
    const before = { ...f.counts };
    f.advance(16 * 60_000);
    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }), (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, "OUTCOME_UNKNOWN");
      assert.equal((error as { diagnostic?: { ack_known?: unknown } }).diagnostic?.ack_known, true);
      return true;
    });
    assert.equal(f.counts.posts, before.posts, "a known-ACK recovery is never replayed after elapsed time");
    assert.equal(f.counts.chatCreates, before.chatCreates);
    assert.equal(f.counts.historyGets, before.historyGets + 1, "reconciliation performs another bounded history GET");
    assert.equal(f.counts.resultGets, before.resultGets, "pending history has no result-object GETs");
  } finally { await service.close(); }
});

test("unknown-ACK WAN T2V recovery remains retained and GET-only beyond the former 15-minute expiry", async () => {
  const f = fixture({ losePostAck: true });
  const service = await makeService(f);
  try {
    let recoveryId = "";
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INPUT_26 }), (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, "OUTCOME_UNKNOWN");
      recoveryId = String((error as { recovery_id?: unknown }).recovery_id);
      return true;
    });
    const before = { ...f.counts };
    f.advance(16 * 60_000);
    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }), (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, "OUTCOME_UNKNOWN");
      assert.equal((error as { diagnostic?: { ack_known?: unknown } }).diagnostic?.ack_known, false);
      return true;
    });
    assert.equal(f.counts.posts, before.posts, "an unknown-ACK recovery is never replayed after elapsed time");
    assert.equal(f.counts.chatCreates, before.chatCreates);
    assert.equal(f.counts.historyGets, before.historyGets + 1, "reconciliation performs another bounded history GET");
    assert.equal(f.counts.resultGets, before.resultGets, "unknown ACK remains insufficient to attribute bot output");
  } finally { await service.close(); }
});

test("keeps missing result model echo explicit while retaining exact object attribution", async () => {
  const f = fixture({ unknownResultModel: true });
  const service = await makeService(f);
  try {
    const result = await service.generate({ attemptId: ATTEMPT, input: INPUT_27 });
    assert.equal(result.status, "completed");
    assert.equal(result.observed_artifact_count, 1);
    const artifact = (result.artifacts as readonly Record<string, unknown>[])[0];
    assert.equal(artifact?.model_echo, "UNKNOWN");
    assert.equal(artifact?.message_object_id, "wan-t2v-object-1-1");
    assert.equal((result.diagnostic as Record<string, unknown>).result_reason, "NATIVE_MODEL_ECHO_UNKNOWN");
  } finally { await service.close(); }
});

test("rejects invalid and foreign service inputs before chat creation or preflight", async () => {
  const f = fixture();
  const service = await makeService(f);
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: { ...INPUT_26, file_urls: ["https://r2.syntx.ai/x.mp4"] } }),
      (error: unknown) => (error as { code?: unknown }).code === "INVALID_REQUEST");
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: { ...INPUT_26, model_id: "wan_26_i2v" } }),
      (error: unknown) => (error as { code?: unknown }).code === "INVALID_REQUEST");
    await assert.rejects(service.generate({ attemptId: "not-a-linked-attempt", input: INPUT_26 }),
      (error: unknown) => (error as { code?: unknown }).code === "INVALID_REQUEST");
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: { ...INPUT_26, prompt: "x".repeat(65_537) } }),
      (error: unknown) => (error as { code?: unknown }).code === "INVALID_REQUEST");
    assert.equal(f.counts.accountFactories, 0);
    assert.equal(f.counts.chatCreates, 0);
    assert.equal(f.counts.posts, 0);
    assert.throws(() => normalizeOwnerWanT2vGenerationParameters({ ...INPUT_26, prompt: "bad\uD800" }),
      OwnerWanT2vGenerationParametersError);
  } finally { await service.close(); }
});

test("rejects a structurally similar fake chat client instead of dispatching through its methods", async () => {
  const f = fixture();
  const invoked: string[] = [];
  const forgedClient = {
    createChat: async () => { invoked.push("createChat"); return { chat_uuid: "forged-chat" }; },
    startVideo: async () => { invoked.push("startVideo"); return { chat_uuid: "forged-chat", message_id: "forged-message" }; },
    listMessageCandidates: async () => { invoked.push("history"); return {}; },
    getMessage: async () => { invoked.push("getMessage"); return {}; },
    listInProgress: async () => { invoked.push("inprogress"); return []; }
  };
  const service = await makeService(f, () => forgedClient);
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INPUT_26 }),
      (error: unknown) => (error as { code?: unknown }).code === "MODEL_BINDING_MISMATCH");
    assert.deepEqual(invoked, []);
    assert.equal(f.counts.posts, 0);
    assert.equal(f.counts.chatCreates, 0);
  } finally { await service.close(); }
});

test("nominal service guard rejects forged, proxied, and subclass instances", async () => {
  const f = fixture();
  const service = await makeService(f);
  try {
    const module = await import(SERVICE_URL) as Record<string, unknown>;
    const guard = module.isOwnerWanT2vGenerationService as (value: unknown) => boolean;
    assert.equal(guard(service), true);
    assert.equal(guard(Object.create(Object.getPrototypeOf(service))), false);
    assert.equal(guard(new Proxy(service, {})), false);
    const Service = module.OwnerWanT2vGenerationService as new (options: Record<string, unknown>) => T2vServiceApi;
    class DerivedService extends Service {}
    await assert.rejects(makeService(f, () => f.chatClient, DerivedService), (error: unknown) =>
      (error as { code?: unknown }).code === "INVALID_REQUEST");
  } finally { await service.close(); }
});

test("fails the second live access preflight without dispatching after the private chat is created", async () => {
  const f = fixture({ failSecondModelInfo: true });
  const service = await makeService(f);
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INPUT_26 }),
      (error: unknown) => (error as { code?: unknown }).code === "PREFLIGHT_FAILED");
    assert.equal(f.counts.accountFactories, 2);
    assert.equal(f.counts.accessFactories, 2);
    assert.equal(f.counts.chatCreates, 1);
    assert.equal(f.counts.posts, 0);
    assert.equal(f.counts.historyGets, 0);
    assert.equal(f.counts.resultGets, 0);
  } finally { await service.close(); }
});

test("never attributes a result when the fresh private chat has another positive-author row", async () => {
  const f = fixture({ foreignOwnerRow: true });
  const service = await makeService(f);
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INPUT_27 }),
      (error: unknown) => (error as { code?: unknown }).code === "OUTCOME_UNKNOWN");
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.historyGets, 1);
    assert.equal(f.counts.resultGets, 0);
  } finally { await service.close(); }
});

test("rejects a current result whose per-object model binding differs from the explicit T2V model", async () => {
  const f = fixture({ malformedResultModel: true });
  const service = await makeService(f);
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INPUT_26 }),
      (error: unknown) => (error as { code?: unknown }).code === "OUTCOME_UNKNOWN");
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.historyGets, 1);
    assert.equal(f.counts.resultGets, 1);
  } finally { await service.close(); }
});

test("source page mismatch leaves a GET-only unknown recovery instead of guessing completeness", async () => {
  const f = fixture({ secondHistoryPage: true });
  const service = await makeService(f);
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INPUT_26 }),
      (error: unknown) => (error as { code?: unknown }).code === "OUTCOME_UNKNOWN");
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.historyGets, 1);
    assert.equal(f.counts.resultGets, 0);
    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: (await service.listRecoveries({ attemptId: ATTEMPT }))[0]!.recovery_id }),
      (error: unknown) => (error as { code?: unknown }).code === "OUTCOME_UNKNOWN");
    assert.equal(f.counts.posts, 1);
  } finally { await service.close(); }
});

test("invalidateAttempt and close stop later recovery reads without cancelling or replaying provider work", async () => {
  const f = fixture({ losePostAck: true });
  const service = await makeService(f);
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, input: INPUT_27 }),
      (error: unknown) => (error as { code?: unknown }).code === "OUTCOME_UNKNOWN");
    const id = (await service.listRecoveries({ attemptId: ATTEMPT }))[0]!.recovery_id;
    await service.invalidateAttempt(ATTEMPT);
    const before = { ...f.counts };
    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: id }),
      (error: unknown) => (error as { code?: unknown }).code === "RECOVERY_NOT_FOUND");
    assert.equal(f.counts.posts, before.posts);
    assert.equal(f.counts.historyGets, before.historyGets);
  } finally { await service.close(); }
});
