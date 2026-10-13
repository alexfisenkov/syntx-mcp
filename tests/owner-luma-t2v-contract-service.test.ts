import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import type { GenerationContractRegistryV2 } from "../src/domain/generation-contract-v2.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import {
  OwnerLumaT2vContractService,
  OwnerLumaT2vContractServiceError,
  OWNER_LUMA_T2V_CONTRACT_REGISTRY_VERSION,
  OWNER_LUMA_T2V_CONTRACT_VARIANT_ID
} from "../src/application/owner-luma-t2v-contract-service.js";
import { normalizeOwnerLumaT2vGenerationParameters } from "../src/application/owner-luma-t2v-generation-parameters.js";

const ATTEMPT_ID = "link_owner_luma_t2v_test_0001";
const SECOND_ATTEMPT_ID = "link_owner_luma_t2v_test_0002";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "luma-test-tenant", subject: "luma-test-owner" });
const INPUT = Object.freeze({
  attemptId: ATTEMPT_ID,
  prompt: "A paper boat floating on a calm blue pond.",
  quality: "360p" as const,
  aspect_ratio: "16:9" as const,
  video_duration: 5 as const
});

interface HttpRequestRecord { readonly url: URL; readonly method: string; readonly body: unknown }

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function createLinkedOwnerService(now: () => number) {
  let attemptIndex = 0;
  let challengeIndex = 0;
  const attemptIds = [ATTEMPT_ID, SECOND_ATTEMPT_ID];
  const store = new InMemoryAuthLinkStore(now);
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() {
      challengeIndex += 1;
      return { upstream_attempt_id: `synthetic-upstream-${challengeIndex}`, approval_url: "https://syntx.ai/auth" };
    },
    async pollChallenge(_upstreamAttemptId, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-owner-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, store, {
    now,
    defaultTtlMs: 5 * 60_000,
    attemptIdGenerator: () => attemptIds[attemptIndex++]!
  });
  for (const attemptId of attemptIds) {
    const created = await linkService.createAttempt(AUTH_BINDING);
    assert.equal(created.attempt_id, attemptId);
    await linkService.issueHandoff(AUTH_BINDING, attemptId);
    const linked = await linkService.checkAttempt(AUTH_BINDING, attemptId);
    assert.equal(linked.status, "LINKED");
    assert.equal(linked.linked, true);
  }
  return { store, linkService };
}

async function setup(options: {
  onModelAccess?: (call: number, linkService: PerUserLinkService) => Promise<void> | void;
  denyModelAccess?: boolean;
  wrongModelAccessKeys?: boolean;
  freeSubscription?: boolean;
  timeoutMs?: number;
  registry?: GenerationContractRegistryV2;
  registryVersion?: string;
} = {}) {
  let now = Date.now();
  const linked = await createLinkedOwnerService(() => now);
  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  const registryVersion = options.registryVersion ?? OWNER_LUMA_T2V_CONTRACT_REGISTRY_VERSION;
  const registry = options.registry ?? loadGenerationContractRegistryV2(registryVersion);

  const requests: HttpRequestRecord[] = [];
  const counts = { chats: 0, posts: 0, inprogress: 0, history: 0, messages: 0, modelAccess: 0, subscriptions: 0 };
  const modelAccessParameters: Readonly<Record<string, string | number | boolean>>[] = [];
  let ready = true;
  let failInProgress = false;
  let modelAccessHook = options.onModelAccess;
  let messageGetHook: ((attemptId: string, messageId: string) => Promise<void> | void) | undefined;
  let delayedAttemptId: string | undefined;
  let signalInProgressEntered: (() => void) | undefined;
  let slowInProgressGate: Promise<void> | undefined;
  let releaseSlowInProgress: (() => void) | undefined;
  let lastChatId = "";
  const fetchImplForAttempt = async (attemptId: string, input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1;
      lastChatId = `luma-chat-${counts.chats}`;
      return jsonResponse({ uuid: lastChatId });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      counts.posts += 1;
      return jsonResponse({ id: `luma-echo-${counts.posts}` });
    }
    const inprogressMatch = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inprogressMatch && method === "GET") {
      counts.inprogress += 1;
      if (attemptId === delayedAttemptId) {
        signalInProgressEntered?.();
        await slowInProgressGate;
      }
      if (failInProgress) throw new Error("synthetic in-progress GET failure");
      const jobId = Number(inprogressMatch[1]!.split("-").at(-1));
      return jsonResponse(ready ? [{ message_id: `luma-bot-${jobId}`, message_object_id: "luma-object-1",
        object_type: "video", model_type: "ray-3.14" }] : []);
    }
    const historyMatch = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (historyMatch && method === "GET") {
      counts.history += 1;
      const chatId = historyMatch[1]!;
      const jobId = Number(chatId.split("-").at(-1));
      const rows = [
        { id: `luma-echo-${jobId}`, chat_id: 701, author_id: 12345, message_object: [] },
        ...(ready ? [{ id: `luma-bot-${jobId}`, chat_id: 701, author_id: -1,
          message_object: [{ id: "luma-object-1", message_id: `luma-bot-${jobId}`,
            object_type: "video", model_type: "ray-3.14" }] }] : [])
      ];
      assert.ok(chatId.startsWith("luma-chat-"));
      return jsonResponse({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: rows.length === 0 ? 0 : 1, has_next: false, has_previous: false } });
    }
    const messageMatch = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (messageMatch && method === "GET") {
      counts.messages += 1;
      const messageId = messageMatch[2]!;
      await messageGetHook?.(attemptId, messageId);
      if (messageId.startsWith("luma-echo-")) {
        return jsonResponse({ id: messageId, chat_id: 701, author_id: 12345, message_object: [] });
      }
      return jsonResponse({ id: messageId, chat_id: 701, author_id: -1, message_object: ready ? [{
        id: "luma-object-1", message_id: messageId, object_type: "video", model_type: "ray-3.14",
        completed: true, object_url: "https://r2.syntx.ai/luma/video.mp4"
      }] : [] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const service = new OwnerLumaT2vContractService({
    binding: AUTH_BINDING,
    linkService: linked.linkService,
    registry,
    registryVersion,
    catalog,
    resolveSubscription: async () => {
      counts.subscriptions += 1;
      const subscription: SyntxSubscription = { active: !options.freeSubscription,
        plan_type: options.freeSubscription ? "FREE" : "PAID", end_date: null, end_date_kind: null };
      return subscription;
    },
    resolveModelAccess: async (attemptId, modelId, costParameters) => {
      counts.modelAccess += 1;
      modelAccessParameters.push(Object.freeze({ ...costParameters }));
      await modelAccessHook?.(counts.modelAccess, linked.linkService);
      assert.ok([ATTEMPT_ID, SECOND_ATTEMPT_ID].includes(attemptId));
      assert.equal(modelId, "ray-3.14");
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
        catalog_version: registry.catalog_version,
        model_id: "ray-3.14",
        ai_name: "luma",
        model_type: "ray-3.14",
        account_read_live: true,
        parameter_keys: options.wrongModelAccessKeys ? ["quality"] : Object.keys(costParameters).sort(),
        parameters_redacted: true,
        access: options.denyModelAccess ? false : true,
        cost: null,
        discount_cost: null,
        free_remaining_generations: null,
        limit: null,
        show_warning: false,
        observed_at: new Date(now).toISOString()
      } satisfies ModelAccessResult;
    },
    resolveChatClient: (attemptId) => new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
        return operation("synthetic-owner-credential");
      } },
      fetchImpl: (input, init) => fetchImplForAttempt(attemptId, input, init),
      requestTimeoutMs: 2_000
    }),
    now: () => now,
    wait: async () => undefined
  });
  return {
    service,
    catalog,
    registry,
    linkService: linked.linkService,
    requests,
    counts,
    modelAccessParameters,
    setReady(value: boolean) { ready = value; },
    setFailInProgress(value: boolean) { failInProgress = value; },
    setModelAccessHook(hook: typeof modelAccessHook) { modelAccessHook = hook; },
    setMessageGetHook(hook: typeof messageGetHook) { messageGetHook = hook; },
    delayInProgressFor(attemptId: string) {
      delayedAttemptId = attemptId;
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      slowInProgressGate = new Promise<void>((resolve) => { release = resolve; });
      signalInProgressEntered = entered;
      releaseSlowInProgress = () => { ready = true; release(); };
      return { started, release: () => releaseSlowInProgress?.() };
    },
    clearInProgressDelay() { delayedAttemptId = undefined; signalInProgressEntered = undefined; slowInProgressGate = undefined; },
    advance(ms: number) { now += ms; },
    lastChatId: () => lastChatId
  };

}

test("Luma contract remains source-reviewed and the real chat client posts the exact 360p pilot body", async () => {
  const state = await setup();
  try {
    const source = state.service.getParametersSource();
    assert.equal(source.controls.quality.values.length * source.controls.aspect_ratio.values.length * source.controls.video_duration.values.length, 48);
    const reviewed = state.service.getReviewedContract();
    assert.equal(reviewed.variant_id, OWNER_LUMA_T2V_CONTRACT_VARIANT_ID);
    assert.equal(reviewed.status, "reviewed");
    assert.equal(reviewed.provenance.live_observed_at, undefined);
    assert.equal(normalizeOwnerLumaT2vGenerationParameters({ model_id: "ray-3.14", mode: "text2video",
      prompt: INPUT.prompt, quality: INPUT.quality, aspect_ratio: INPUT.aspect_ratio, video_duration: INPUT.video_duration }).intent.video_duration, 5);

    const result = await state.service.generate(INPUT);
    assert.equal(result.status, "reviewed");
    assert.equal(result.confidence_scope, "exact_result_only");
    assert.deepEqual(result.artifacts, [{ url: "https://r2.syntx.ai/luma/video.mp4", mime_type: "video/mp4" }]);
    const post = state.requests.find((request) => request.url.pathname === "/api/v1/video/generate");
    assert.ok(post);
    assert.equal(post.url.searchParams.get("ai_name"), "luma");
    assert.deepEqual(post.body, {
      chat_id: "luma-chat-1",
      prompt: INPUT.prompt,
      settings: { model_type: "ray-3.14", video_duration: 5, quality: "360p", aspect_ratio: "16:9",
        gen_type: "text2video", file_urls: [] }
    });
    assert.equal(state.counts.posts, 1);
    assert.equal(state.counts.subscriptions, 2);
    assert.equal(state.counts.modelAccess, 2);
    assert.deepEqual(state.modelAccessParameters, [
      { quality: "360p", video_duration: 5 },
      { quality: "360p", video_duration: 5 }
    ]);
  } finally { await state.service.close(); }
});

test("Luma request rejects non-enumerated controls and missing explicit choices before any chat", async () => {
  const state = await setup();
  try {
    assert.throws(() => state.service.generate({ ...INPUT, quality: "4k" } as never),
      (error: unknown) => error instanceof OwnerLumaT2vContractServiceError && error.code === "INVALID_REQUEST");
    assert.throws(() => state.service.generate({ ...INPUT, video_duration: undefined }),
      (error: unknown) => error instanceof OwnerLumaT2vContractServiceError && error.code === "INVALID_REQUEST");
    assert.equal(state.counts.chats, 0);
    assert.equal(state.counts.posts, 0);
  } finally { await state.service.close(); }
});

test("fresh subscription and account model access are required before chat creation", async () => {
  const free = await setup({ freeSubscription: true });
  try {
    await assert.rejects(free.service.generate(INPUT),
      (error: unknown) => error instanceof OwnerLumaT2vContractServiceError && error.code === "SUBSCRIPTION_REQUIRED");
    assert.equal(free.counts.modelAccess, 0);
    assert.equal(free.counts.chats, 0);
  } finally { await free.service.close(); }

  const denied = await setup({ denyModelAccess: true });
  try {
    await assert.rejects(denied.service.generate(INPUT),
      (error: unknown) => error instanceof OwnerLumaT2vContractServiceError && error.code === "MODEL_ACCESS_UNAVAILABLE" &&
        error.diagnostic_code === "MODEL_ACCESS_DENIED");
    assert.equal(denied.counts.modelAccess, 1);
    assert.equal(denied.counts.chats, 0);
    assert.equal(denied.counts.posts, 0);
  } finally { await denied.service.close(); }

  const mismatched = await setup({ wrongModelAccessKeys: true });
  try {
    await assert.rejects(mismatched.service.generate(INPUT),
      (error: unknown) => error instanceof OwnerLumaT2vContractServiceError && error.code === "MODEL_ACCESS_UNAVAILABLE" &&
        error.diagnostic_code === "MODEL_ACCESS_PARAMETER_KEYS_MISMATCH");
    assert.equal(mismatched.counts.chats, 0);
    assert.equal(mismatched.counts.posts, 0);
  } finally { await mismatched.service.close(); }
});

test("the additive pinned V2 archive loads exactly one reviewed Luma T2V variant", async () => {
  const registry = loadGenerationContractRegistryV2(OWNER_LUMA_T2V_CONTRACT_REGISTRY_VERSION);
  assert.equal(registry.contracts.length, 1);
  assert.equal(registry.contracts[0]?.variant_id, OWNER_LUMA_T2V_CONTRACT_VARIANT_ID);
  assert.equal(registry.contracts[0]?.status, "reviewed");
  assert.equal(registry.contracts[0]?.provenance.live_observed_at, undefined);
  const state = await setup({ registry, registryVersion: OWNER_LUMA_T2V_CONTRACT_REGISTRY_VERSION });
  try {
    const result = await state.service.generate(INPUT);
    assert.equal(result.status, "reviewed");
    assert.equal(state.counts.posts, 1);
  } finally { await state.service.close(); }
});

test("unknown Luma result survives 16 minutes and same-attempt GET recovery creates no chat or POST", async () => {
  const state = await setup();
  try {
    state.setReady(false);
    state.setFailInProgress(true);
    const unknown = await state.service.generate(INPUT).catch((error: unknown) => error);
    assert.equal((unknown as { code?: string }).code, "OUTCOME_UNKNOWN",
      `${(unknown as Error).name}:${(unknown as Error).message}; counts=${JSON.stringify(state.counts)}`);
    const recoveryId = (unknown as { recovery_id?: string }).recovery_id!;
    const before = { ...state.counts };
    state.setFailInProgress(false);
    state.setReady(true);
    state.advance(16 * 60_000);

    const recovered = await state.service.reconcile({ attemptId: ATTEMPT_ID, recovery_id: recoveryId });
    assert.equal(recovered.status, "reviewed");
    assert.equal(state.counts.posts, before.posts);
    assert.equal(state.counts.chats, before.chats);
    assert.ok(state.counts.history > before.history);
    assert.ok(state.counts.messages > before.messages);
  } finally { await state.service.close(); }
});

test("revocation during a result GET is rechecked immediately and removes the recovery", async () => {
  const state = await setup();
  try {
    state.setReady(false);
    state.setFailInProgress(true);
    const unknown = await state.service.generate(INPUT).catch((error: unknown) => error);
    assert.ok(unknown instanceof OwnerLumaT2vContractServiceError);
    assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    const recoveryId = unknown.recovery_id!;
    const postsBeforeRecovery = state.counts.posts;
    state.setFailInProgress(false);
    state.setReady(true);
    state.setMessageGetHook(async (attemptId, messageId) => {
      if (messageId.startsWith("luma-bot-")) await state.linkService.revoke(AUTH_BINDING, attemptId);
    });
    await assert.rejects(state.service.reconcile({ attemptId: ATTEMPT_ID, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerLumaT2vContractServiceError && error.code === "RECOVERY_NOT_FOUND");
    assert.equal(state.counts.posts, postsBeforeRecovery);
    assert.deepEqual(state.service.listRecoveries(ATTEMPT_ID), []);
  } finally { await state.service.close(); }
});

test("exact semantic intent cannot be replayed under a second linked attempt", async () => {
  const state = await setup();
  try {
    await state.service.generate(INPUT);
    await assert.rejects(state.service.generate({ ...INPUT, attemptId: SECOND_ATTEMPT_ID }),
      (error: unknown) => error instanceof OwnerLumaT2vContractServiceError && error.code === "INTENT_ALREADY_USED");
    assert.equal(state.counts.posts, 1);
    assert.equal(state.counts.chats, 1);
  } finally { await state.service.close(); }
});

test("revoked principal during the immediate preGEN access check stops without a generation POST", async () => {
  let revoked = false;
  const state = await setup({ onModelAccess: async (call, linkService) => {
    if (call === 2 && !revoked) {
      revoked = true;
      await linkService.revoke(AUTH_BINDING, ATTEMPT_ID);
    }
  } });
  try {
    await assert.rejects(state.service.generate(INPUT),
      (error: unknown) => error instanceof OwnerLumaT2vContractServiceError && error.code === "PRINCIPAL_NOT_LINKED");
    assert.equal(state.counts.chats, 1);
    assert.equal(state.counts.posts, 0);
  } finally { await state.service.close(); }
});

test("invalidating one attempt drains its work without waiting for another attempt's delayed GET", async () => {
  const state = await setup();
  try {
    state.setReady(false);
    state.setFailInProgress(true);
    const initialUnknown = await state.service.generate(INPUT).catch((error: unknown) => error);
    assert.ok(initialUnknown instanceof OwnerLumaT2vContractServiceError);
    assert.equal(initialUnknown.code, "OUTCOME_UNKNOWN");

    state.setFailInProgress(false);
    state.setReady(false);
    const delayed = state.delayInProgressFor(SECOND_ATTEMPT_ID);
    const secondGeneration = state.service.generate({ ...INPUT, attemptId: SECOND_ATTEMPT_ID,
      prompt: "A different paper boat prompt." });
    await delayed.started;
    await Promise.race([
      state.service.invalidateAttempt(ATTEMPT_ID),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("attempt invalidation waited for unrelated GET")), 250))
    ]);
    delayed.release();
    state.clearInProgressDelay();
    const secondResult = await secondGeneration;
    assert.equal(secondResult.status, "reviewed");
    assert.equal(state.counts.posts, 2);
  } finally { await state.service.close(); }
});

test("128 unknown recoveries are not evicted; a full store rejects before creating another chat", async () => {
  const state = await setup();
  try {
    state.setReady(false);
    state.setFailInProgress(true);
    let firstRecovery = "";
    for (let index = 0; index < 128; index += 1) {
      const unknown = await state.service.generate({ ...INPUT, prompt: `Unique paper boat prompt ${index}.` })
        .catch((error: unknown) => error);
      assert.ok(unknown instanceof OwnerLumaT2vContractServiceError);
      assert.equal(unknown.code, "OUTCOME_UNKNOWN");
      if (index === 0) firstRecovery = unknown.recovery_id!;
    }
    const before = { ...state.counts };
    await assert.rejects(state.service.generate({ ...INPUT, prompt: "A 129th unique paper boat prompt." }),
      (error: unknown) => error instanceof OwnerLumaT2vContractServiceError && error.code === "SERVICE_BUSY");
    assert.equal(state.counts.chats, before.chats);
    assert.equal(state.counts.posts, before.posts);
    state.setFailInProgress(false);
    state.setReady(true);
    const recoveredFirst = await state.service.reconcile({ attemptId: ATTEMPT_ID, recovery_id: firstRecovery });
    assert.equal(recoveredFirst.status, "reviewed");
    assert.equal(state.counts.posts, before.posts);
  } finally { await state.service.close(); }
});
