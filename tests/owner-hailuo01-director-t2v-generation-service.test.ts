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
  OwnerHailuo01DirectorT2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError
} from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import {
  createOwnerHailuo01DirectorT2vProfile,
  OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_VARIANT_ID
} from "../src/application/owner-hailuo01-director-t2v-profile.js";

const FIRST_ATTEMPT = "link_hailuo_director_test_attempt_001";
const SECOND_ATTEMPT = "link_hailuo_director_test_attempt_002";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "director-test-tenant", subject: "director-test-owner" });
interface RequestRecord { readonly url: URL; readonly method: string; readonly body: unknown }

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setup(options: { readonly denyAccessRead?: number } = {}) {
  let now = Date.now();
  const store = new InMemoryAuthLinkStore(() => now);
  const attempts = [FIRST_ATTEMPT, SECOND_ATTEMPT];
  let attemptIndex = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: `director-challenge-${attemptIndex}`, approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-director-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, store, {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => attempts[attemptIndex++]!
  });
  for (const attemptId of attempts) {
    await linkService.createAttempt(AUTH_BINDING);
    await linkService.issueHandoff(AUTH_BINDING, attemptId);
    const linked = await linkService.checkAttempt(AUTH_BINDING, attemptId);
    assert.equal(linked.status, "LINKED");
    assert.equal(linked.linked, true);
  }
  let ready = false;
  let lastChat = "";
  let chats = 0;
  let videoPosts = 0;
  let clientResolves = 0;
  let modelAccessReads = 0;
  let statusReads = 0;
  const costs: Array<Readonly<Record<string, string | number | boolean>>> = [];
  const requests: RequestRecord[] = [];
  let messageGetHook: ((messageId: string) => Promise<void> | void) | undefined;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chats += 1;
      lastChat = `director-chat-${chats}`;
      return response({ uuid: lastChat });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      return response({ id: `director-echo-${videoPosts}` });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") {
      const index = Number(inProgress[1]!.split("-").at(-1));
      return response(ready ? [{ message_id: `director-bot-${index}`, message_object_id: "director-video-object",
        object_type: "video", model_type: "hailuo-01-director" }] : []);
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") {
      const index = Number(history[1]!.split("-").at(-1));
      const rows = [
        { id: `director-echo-${index}`, chat_id: 802, author_id: 12001, message_object: [] },
        ...(ready ? [{ id: `director-bot-${index}`, chat_id: 802, author_id: -1, message_object: [{
          id: "director-video-object", message_id: `director-bot-${index}`, object_type: "video", model_type: "hailuo-01-director"
        }] }] : [])
      ];
      return response({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (message && method === "GET") {
      const messageId = message[2]!;
      await messageGetHook?.(messageId);
      if (messageId.startsWith("director-echo-")) return response({ id: messageId, chat_id: 802, author_id: 12001, message_object: [] });
      return response({ id: messageId, chat_id: 802, author_id: -1, message_object: ready ? [{
        id: "director-video-object", message_id: messageId, object_type: "video", model_type: "hailuo-01-director",
        completed: true, object_url: "https://r2.syntx.ai/hailuo/director.mp4"
      }] : [] });
    }
    throw new Error(`Unexpected controlled route ${method} ${url.pathname}`);
  };

  const profile = createOwnerHailuo01DirectorT2vProfile();
  const principalLinkService = {
    getStatus: (binding: AuthBinding, attemptId: string) => {
      statusReads += 1;
      return linkService.getStatus(binding, attemptId);
    }
  };
  const service = new OwnerHailuo01DirectorT2vGenerationService({
    profile, binding: AUTH_BINDING, linkService: principalLinkService,
    resolveSubscription: async (): Promise<SyntxSubscription> => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
    resolveModelAccess: async (attemptId, modelId, costParameters): Promise<ModelAccessResult> => {
      modelAccessReads += 1;
      assert.ok(attempts.includes(attemptId));
      assert.equal(modelId, "hailuo-01-director");
      costs.push(Object.freeze({ ...costParameters }));
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
        catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: "hailuo-01-director", ai_name: "hailuo-minimax", model_type: "hailuo-01-director",
        account_read_live: true, parameter_keys: Object.keys(costParameters).sort(), parameters_redacted: true,
        access: modelAccessReads === options.denyAccessRead ? false : true, cost: null, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString()
      };
    },
    resolveChatClient: () => {
      clientResolves += 1;
      return new SyntxChatHttpClient({
        credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
          return operation("synthetic-director-credential");
        } },
        fetchImpl, requestTimeoutMs: 2_000
      });
    },
    now: () => now,
    wait: async () => undefined
  });
  return {
    profile, service, linkService, costs, requests,
    counts: () => ({ chats, videoPosts, clientResolves, modelAccessReads, statusReads }),
    setReady(value: boolean) { ready = value; },
    setMessageGetHook(hook: typeof messageGetHook) { messageGetHook = hook; },
    advance(ms: number) { now += ms; },
    get lastChat() { return lastChat; }
  };
}

test("Director reviewed profile sends only exact 720p/6 no-ref settings and recovers after 16 minutes by GET", async () => {
  const state = await setup();
  try {
    const unknown = await state.service.generate({ attemptId: FIRST_ATTEMPT, prompt: "A paper kite over a quiet lake.",
      resolution: "720p", video_duration: 6 }).catch((error: unknown) => error);
    assert.ok(unknown instanceof OwnerReviewedNoReferenceT2vServiceError);
    assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    assert.deepEqual(state.costs, [
      { resolution: "720p", video_duration: 6 },
      { resolution: "720p", video_duration: 6 }
    ]);
    assert.equal(state.counts().chats, 1);
    assert.equal(state.counts().videoPosts, 1);
    const originalChat = state.lastChat;
    const request = state.requests.find((row) => row.method === "POST" && row.url.pathname === "/api/v1/video/generate");
    assert.ok(request);
    assert.equal(request.url.search, "?ai_name=hailuo-minimax");
    assert.deepEqual(request.body, { chat_id: originalChat, prompt: "A paper kite over a quiet lake.", settings: {
      model_type: "hailuo-01-director", video_duration: 6, resolution: "720p", file_urls: []
    } });
    state.advance(16 * 60_000);
    state.setReady(true);
    const getsBefore = state.requests.filter((row) => row.method === "GET").length;
    const statusBefore = state.counts().statusReads;
    const output = await state.service.reconcile({ attemptId: FIRST_ATTEMPT, recovery_id: unknown.recovery_id! });
    assert.equal(output.model_id, "hailuo-01-director");
    assert.equal(output.variant_id, OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_VARIANT_ID);
    assert.equal(output.confidence_scope, "exact_result_only");
    assert.ok(output.artifacts.some((artifact) => artifact.url === "https://r2.syntx.ai/hailuo/director.mp4"));
    assert.equal(state.counts().videoPosts, 1);
    assert.equal(state.counts().chats, 1);
    assert.equal(state.counts().clientResolves, 1);
    const recoveryGets = state.requests.filter((row) => row.method === "GET").length - getsBefore;
    assert.ok(state.counts().statusReads - statusBefore >= 2 * recoveryGets);
  } finally { await state.service.close(); }
});

test("Director's second literal model-access check denial blocks the video POST", async () => {
  const state = await setup({ denyAccessRead: 2 });
  try {
    await assert.rejects(state.service.generate({ attemptId: FIRST_ATTEMPT, prompt: "A quiet lake.", resolution: "720p", video_duration: 6 }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "MODEL_ACCESS_UNAVAILABLE");
    assert.deepEqual(state.costs, [{ resolution: "720p", video_duration: 6 }, { resolution: "720p", video_duration: 6 }]);
    assert.equal(state.counts().chats, 1);
    assert.equal(state.counts().videoPosts, 0);
  } finally { await state.service.close(); }
});

test("Director semantic intent remains claimed across linked attempts", async () => {
  const state = await setup();
  state.setReady(true);
  try {
    await state.service.generate({ attemptId: FIRST_ATTEMPT, prompt: "A silver kite.", resolution: "720p", video_duration: 6 });
    await assert.rejects(state.service.generate({ attemptId: SECOND_ATTEMPT, prompt: "A silver kite.", resolution: "720p", video_duration: 6 }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "INTENT_ALREADY_USED");
    assert.equal(state.counts().chats, 1);
    assert.equal(state.counts().videoPosts, 1);
  } finally { await state.service.close(); }
});

test("Director recovery is removed when the linked principal is revoked during GET", async () => {
  const state = await setup();
  try {
    const unknown = await state.service.generate({ attemptId: FIRST_ATTEMPT, prompt: "A paper kite.", resolution: "720p", video_duration: 6 })
      .catch((error: unknown) => error);
    assert.ok(unknown instanceof OwnerReviewedNoReferenceT2vServiceError);
    assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    state.setReady(true);
    state.setMessageGetHook(async () => { await state.linkService.revoke(AUTH_BINDING, FIRST_ATTEMPT); });
    await assert.rejects(state.service.reconcile({ attemptId: FIRST_ATTEMPT, recovery_id: unknown.recovery_id! }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "RECOVERY_NOT_FOUND");
    assert.deepEqual(state.service.listRecoveries(FIRST_ATTEMPT), []);
    assert.equal(state.counts().videoPosts, 1);
  } finally { await state.service.close(); }
});

test("Director unknown recoveries do not evict at 128 and capacity rejects before another chat", async () => {
  const state = await setup();
  try {
    let firstRecovery = "";
    for (let index = 0; index < 128; index += 1) {
      const unknown = await state.service.generate({ attemptId: FIRST_ATTEMPT, prompt: `Director prompt ${index}.`,
        resolution: "720p", video_duration: 6 }).catch((error: unknown) => error);
      assert.ok(unknown instanceof OwnerReviewedNoReferenceT2vServiceError);
      assert.equal(unknown.code, "OUTCOME_UNKNOWN");
      if (index === 0) firstRecovery = unknown.recovery_id!;
    }
    const before = state.counts();
    assert.throws(() => state.service.generate({ attemptId: FIRST_ATTEMPT, prompt: "129th Director prompt.", resolution: "720p", video_duration: 6 }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "SERVICE_BUSY");
    assert.equal(state.counts().chats, before.chats);
    assert.equal(state.counts().videoPosts, before.videoPosts);
    state.setReady(true);
    assert.equal((await state.service.reconcile({ attemptId: FIRST_ATTEMPT, recovery_id: firstRecovery })).status, "reviewed");
    assert.equal(state.counts().videoPosts, before.videoPosts);
  } finally { await state.service.close(); }
});
