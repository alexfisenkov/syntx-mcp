import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import {
  OwnerReviewedNoReferenceT2vService,
  OwnerReviewedNoReferenceT2vServiceError
} from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerHailuo01T2vProfile } from "../src/application/owner-hailuo01-t2v-profile.js";

const ATTEMPT_ID = "link_owner_hailuo01_t2v_test_0001";
const SECOND_ATTEMPT_ID = "link_owner_hailuo01_t2v_test_0002";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "hailuo-test-tenant", subject: "hailuo-test-owner" });

interface HttpRequestRecord { readonly url: URL; readonly method: string; readonly body: unknown }

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setup() {
  let now = Date.now();
  const store = new InMemoryAuthLinkStore(() => now);
  const attemptIds = [ATTEMPT_ID, SECOND_ATTEMPT_ID];
  let attemptIndex = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-hailuo-upstream", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_upstreamAttemptId, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-owner-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, store, {
    now: () => now,
    defaultTtlMs: 5 * 60_000,
    attemptIdGenerator: () => attemptIds[attemptIndex++]!
  });
  let principalStatusReads = 0;
  const principalLinkService = {
    getStatus: (binding: AuthBinding, attemptId: string) => {
      principalStatusReads += 1;
      return linkService.getStatus(binding, attemptId);
    }
  };
  for (const attemptId of attemptIds) {
    const created = await linkService.createAttempt(AUTH_BINDING);
    assert.equal(created.attempt_id, attemptId);
    await linkService.issueHandoff(AUTH_BINDING, attemptId);
    const linked = await linkService.checkAttempt(AUTH_BINDING, attemptId);
    assert.equal(linked.status, "LINKED");
    assert.equal(linked.linked, true);
  }

  let ready = false;
  let lastChatId = "";
  const requests: HttpRequestRecord[] = [];
  let chats = 0;
  let videoPosts = 0;
  let modelAccessReads = 0;
  let clientResolves = 0;
  let denyAccessRead: number | undefined;
  let messageGetHook: ((messageId: string) => Promise<void> | void) | undefined;
  let subscriptions = 0;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chats += 1;
      lastChatId = `hailuo-chat-${chats}`;
      return jsonResponse({ uuid: lastChatId });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      return jsonResponse({ id: `hailuo-echo-${videoPosts}` });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") {
      const index = Number(inProgress[1]!.split("-").at(-1));
      return jsonResponse(ready ? [{ message_id: `hailuo-bot-${index}`, message_object_id: "hailuo-video-object",
        object_type: "video", model_type: "hailuo-01" }] : []);
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") {
      const chatId = history[1]!;
      const index = Number(chatId.split("-").at(-1));
      const rows = [
        { id: `hailuo-echo-${index}`, chat_id: 701, author_id: 12345, message_object: [] },
        ...(ready ? [{ id: `hailuo-bot-${index}`, chat_id: 701, author_id: -1, message_object: [{
          id: "hailuo-video-object", message_id: `hailuo-bot-${index}`, object_type: "video", model_type: "hailuo-01"
        }] }] : [])
      ];
      return jsonResponse({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const messageMatch = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (messageMatch && method === "GET") {
      const messageId = messageMatch[2]!;
      await messageGetHook?.(messageId);
      if (messageId.startsWith("hailuo-echo-")) {
        return jsonResponse({ id: messageId, chat_id: 701, author_id: 12345, message_object: [] });
      }
      return jsonResponse({ id: messageId, chat_id: 701, author_id: -1, message_object: ready ? [{
        id: "hailuo-video-object", message_id: messageId, object_type: "video", model_type: "hailuo-01",
        completed: true, object_url: "https://r2.syntx.ai/hailuo/video.mp4"
      }] : [] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const profile = createOwnerHailuo01T2vProfile();
  const createService = (selectedProfile = profile) => new OwnerReviewedNoReferenceT2vService({
    profile: selectedProfile,
    binding: AUTH_BINDING,
    linkService: principalLinkService,
    resolveSubscription: async (): Promise<SyntxSubscription> => {
      subscriptions += 1;
      return { active: true, plan_type: "PAID", end_date: null, end_date_kind: null };
    },
    resolveModelAccess: async (_attemptId, modelId, costParameters): Promise<ModelAccessResult> => {
      modelAccessReads += 1;
      assert.ok([ATTEMPT_ID, SECOND_ATTEMPT_ID].includes(_attemptId));
      assert.equal(modelId, "hailuo-01");
      assert.deepEqual(Object.keys(costParameters).sort(), ["resolution", "video_duration"]);
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
        catalog_version: `${selectedProfile.catalog.fetched_at}.${selectedProfile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: "hailuo-01", ai_name: "hailuo-minimax", model_type: "hailuo-01", account_read_live: true,
        parameter_keys: Object.keys(costParameters).sort(), parameters_redacted: true, access: modelAccessReads === denyAccessRead ? false : true, cost: null,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString()
      };
    },
    resolveChatClient: () => {
      clientResolves += 1;
      return new SyntxChatHttpClient({
        credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
          return operation("synthetic-owner-credential");
        } },
        fetchImpl,
        requestTimeoutMs: 2_000
      });
    },
    now: () => now,
    wait: async () => undefined
  });
  const service = createService();
  return {
    service, profile, linkService, requests, createService,
    counts: () => ({ chats, videoPosts, modelAccessReads, subscriptions, clientResolves, principalStatusReads }),
    setReady(value: boolean) { ready = value; },
    denyAccessOnRead(read: number) { denyAccessRead = read; },
    setMessageGetHook(hook: typeof messageGetHook) { messageGetHook = hook; },
    advance(milliseconds: number) { now += milliseconds; },
    get lastChatId() { return lastChatId; }
  };
}

test("reviewed Hailuo recovery uses the original chat after 16 minutes without replaying POST", async () => {
  const state = await setup();
  try {
    const source = state.service.getParametersSource();
    assert.equal(source.status, "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_UI_OBSERVATION");
    assert.equal(source.controls.prompt.source_max_length, "UNKNOWN");

    const unknown = await state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A red paper boat on a blue pond.",
      resolution: "720p", video_duration: 6 }).catch((error: unknown) => error);
    assert.ok(unknown instanceof OwnerReviewedNoReferenceT2vServiceError);
    assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    const originalChat = state.lastChatId;
    const beforeRecovery = state.counts();
    const recoveryReadStart = state.requests.length;
    assert.equal(beforeRecovery.chats, 1);
    assert.equal(beforeRecovery.videoPosts, 1);
    const generationGets = state.requests.filter((request) => request.method === "GET").length;
    assert.ok(beforeRecovery.principalStatusReads >= 2 * generationGets + 4,
      "initial media GETs must also resolve the same principal before and after each read");
    state.advance(16 * 60_000);
    state.setReady(true);

    const recovered = await state.service.reconcile({ attemptId: ATTEMPT_ID, recovery_id: unknown.recovery_id! });
    assert.equal(recovered.status, "reviewed");
    assert.equal(recovered.confidence_scope, "exact_result_only");
    assert.equal(recovered.model_id, "hailuo-01");
    assert.ok(recovered.artifacts.some((artifact) => artifact.url === "https://r2.syntx.ai/hailuo/video.mp4"));
    const afterRecovery = state.counts();
    assert.equal(afterRecovery.chats, beforeRecovery.chats);
    assert.equal(afterRecovery.videoPosts, beforeRecovery.videoPosts);
    assert.equal(afterRecovery.clientResolves, 1, "recovery must use the exact captured chat client from dispatch");
    const recoveryGets = state.requests.slice(recoveryReadStart).filter((request) => request.method === "GET").length;
    assert.ok(afterRecovery.principalStatusReads - beforeRecovery.principalStatusReads >= 2 * recoveryGets,
      "every recovery GET must resolve the same principal before and after the read");
    assert.ok(state.requests.some((request) => request.method === "GET" && request.url.pathname.startsWith(`/api/v1/chats/${originalChat}/`)));
    const post = state.requests.find((request) => request.method === "POST" && request.url.pathname === "/api/v1/video/generate");
    assert.ok(post);
    assert.equal(post.url.search, "?ai_name=hailuo-minimax");
    assert.deepEqual(post.body, { chat_id: originalChat, prompt: "A red paper boat on a blue pond.", settings: {
      model_type: "hailuo-01", video_duration: 6, resolution: "720p", file_urls: []
    } });
  } finally { await state.service.close(); }
});

test("a structurally cloned Hailuo profile cannot cross the sealed source-profile gate", async () => {
  const state = await setup();
  try {
    const forged = Object.freeze({ ...state.profile });
    assert.throws(() => state.createService(forged), /OWNER_REVIEWED_T2V_PROFILE_INVALID/u);
  } finally { await state.service.close(); }
});

test("second fresh model-access denial stops before the single video POST", async () => {
  const state = await setup();
  state.denyAccessOnRead(2);
  try {
    await assert.rejects(state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A small boat on calm water.",
      resolution: "720p", video_duration: 6 }),
    (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "MODEL_ACCESS_UNAVAILABLE");
    assert.equal(state.counts().modelAccessReads, 2);
    assert.equal(state.counts().chats, 1);
    assert.equal(state.counts().videoPosts, 0);
  } finally { await state.service.close(); }
});

test("semantic Hailuo intent cannot be replayed through a second linked attempt", async () => {
  const state = await setup();
  state.setReady(true);
  try {
    await state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A silver boat under morning light.", resolution: "720p", video_duration: 6 });
    await assert.rejects(state.service.generate({ attemptId: SECOND_ATTEMPT_ID, prompt: "A silver boat under morning light.",
      resolution: "720p", video_duration: 6 }),
    (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "INTENT_ALREADY_USED");
    assert.equal(state.counts().chats, 1);
    assert.equal(state.counts().videoPosts, 1);
  } finally { await state.service.close(); }
});

test("revocation during a bound recovery GET removes the handle and prevents further reads", async () => {
  const state = await setup();
  try {
    const unknown = await state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A boat at dusk.", resolution: "720p", video_duration: 6 })
      .catch((error: unknown) => error);
    assert.ok(unknown instanceof OwnerReviewedNoReferenceT2vServiceError);
    assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    state.setReady(true);
    state.setMessageGetHook(async () => { await state.linkService.revoke(AUTH_BINDING, ATTEMPT_ID); });
    const postsBefore = state.counts().videoPosts;
    await assert.rejects(state.service.reconcile({ attemptId: ATTEMPT_ID, recovery_id: unknown.recovery_id! }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "RECOVERY_NOT_FOUND");
    assert.equal(state.counts().videoPosts, postsBefore);
    assert.deepEqual(state.service.listRecoveries(ATTEMPT_ID), []);
  } finally { await state.service.close(); }
});

test("128 unknown Hailuo jobs are non-evicting; capacity rejects before another chat or POST", async () => {
  const state = await setup();
  try {
    let firstRecovery = "";
    for (let index = 0; index < 128; index += 1) {
      const unknown = await state.service.generate({ attemptId: ATTEMPT_ID, prompt: `Unique Hailuo prompt ${index}.`,
        resolution: "720p", video_duration: 6 }).catch((error: unknown) => error);
      assert.ok(unknown instanceof OwnerReviewedNoReferenceT2vServiceError);
      assert.equal(unknown.code, "OUTCOME_UNKNOWN");
      if (index === 0) firstRecovery = unknown.recovery_id!;
    }
    const before = state.counts();
    assert.throws(() => state.service.generate({ attemptId: ATTEMPT_ID, prompt: "129th Hailuo prompt.", resolution: "720p", video_duration: 6 }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "SERVICE_BUSY");
    assert.equal(state.counts().chats, before.chats);
    assert.equal(state.counts().videoPosts, before.videoPosts);
    state.setReady(true);
    const first = await state.service.reconcile({ attemptId: ATTEMPT_ID, recovery_id: firstRecovery });
    assert.equal(first.status, "reviewed");
    assert.equal(state.counts().videoPosts, before.videoPosts);
  } finally { await state.service.close(); }
});
