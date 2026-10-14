import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import {
  OwnerHailuoLiveT2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError
} from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerHailuoLiveT2vProfile } from "../src/application/owner-hailuo-live-t2v-profile.js";

const ATTEMPT_ID = "link_hailuo_live_service_test_0001";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "hailuo-live-test-tenant", subject: "hailuo-live-test-owner" });
type RequestRecord = { readonly url: URL; readonly method: string; readonly body: unknown };

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setup() {
  let now = Date.now();
  const store = new InMemoryAuthLinkStore(() => now);
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-hailuo-live-upstream", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-hailuo-live-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, store, {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT_ID
  });
  await linkService.createAttempt(AUTH_BINDING);
  await linkService.issueHandoff(AUTH_BINDING, ATTEMPT_ID);
  assert.equal((await linkService.checkAttempt(AUTH_BINDING, ATTEMPT_ID)).linked, true);

  const profile = createOwnerHailuoLiveT2vProfile(resolve(process.cwd(), "catalog"));
  const requests: RequestRecord[] = [];
  const accessParameters: Array<Readonly<Record<string, unknown>>> = [];
  let ready = false;
  let chatCount = 0;
  let videoPosts = 0;
  let modelAccessReads = 0;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1;
      return response({ uuid: `hailuo-live-chat-${chatCount}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      return response({ id: `hailuo-live-echo-${videoPosts}` });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") return response(ready ? [{ message_id: `hailuo-live-bot-${videoPosts}`,
      object_type: "video", model_type: "hailuo-01-live" }] : []);
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") {
      const rows = [
        { id: `hailuo-live-echo-${videoPosts}`, chat_id: 701, author_id: 12345, message_object: [] },
        ...(ready ? [{ id: `hailuo-live-bot-${videoPosts}`, chat_id: 701, author_id: -1, message_object: [{
          id: `hailuo-live-video-${videoPosts}`, message_id: `hailuo-live-bot-${videoPosts}`, object_type: "video", model_type: "hailuo-01-live"
        }] }] : [])
      ];
      return response({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (message && method === "GET") return response({ id: message[2], chat_id: 701, author_id: -1, message_object: ready ? [{
      id: `hailuo-live-video-${videoPosts}`, message_id: message[2], object_type: "video", model_type: "hailuo-01-live",
      completed: true, object_url: `https://r2.syntx.ai/hailuo-live/result-${videoPosts}.mp4`
    }] : [] });
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const service = new OwnerHailuoLiveT2vGenerationService({
    profile, binding: AUTH_BINDING, linkService,
    resolveSubscription: async (): Promise<SyntxSubscription> => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
    resolveModelAccess: async (_attemptId, modelId, costParameters): Promise<ModelAccessResult> => {
      modelAccessReads += 1;
      accessParameters.push(Object.freeze({ ...costParameters }));
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
        catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: modelId, ai_name: "hailuo-minimax", model_type: "hailuo-01-live", account_read_live: true,
        parameter_keys: Object.keys(costParameters).sort(), parameters_redacted: true, access: true, cost: null,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString()
      };
    },
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-hailuo-live-credential");
    } }, fetchImpl, requestTimeoutMs: 1_000 }),
    now: () => now, wait: async () => undefined, videoTimeoutMs: 15
  });
  return {
    service, profile, linkService, requests, accessParameters,
    counts: () => ({ chatCount, videoPosts, modelAccessReads }),
    setReady(value: boolean) { ready = value; },
    advance(milliseconds: number) { now += milliseconds; }
  };
}

test("Hailuo Live service admits its authentic source profile and sends only the fixed no-reference request", async () => {
  const state = await setup();
  state.setReady(true);
  try {
    assert.equal(state.service.getParametersSource().identity.model_id, "hailuo-01-live");
    const output = await state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A slow moving river at dawn.", resolution: "720p", video_duration: 6 });
    assert.equal(output.model_id, "hailuo-01-live");
    assert.equal(output.artifacts.length, 1);
    const post = state.requests.find((request) => request.method === "POST" && request.url.pathname === "/api/v1/video/generate");
    assert.ok(post);
    assert.equal(post.url.search, "?ai_name=hailuo-minimax");
    assert.deepEqual(post.body, { chat_id: "hailuo-live-chat-1", prompt: "A slow moving river at dawn.", settings: {
      model_type: "hailuo-01-live", resolution: "720p", video_duration: 6, file_urls: []
    } });
    assert.deepEqual(state.accessParameters, [
      { resolution: "720p", video_duration: 6 }, { resolution: "720p", video_duration: 6 }
    ]);
    assert.deepEqual(state.counts(), { chatCount: 1, videoPosts: 1, modelAccessReads: 2 });
  } finally { await state.service.close(); }
});

test("Hailuo Live rejects unreviewed values and structurally copied profiles before network activity", async () => {
  const state = await setup();
  try {
    const forged = Object.freeze({ ...state.profile });
    assert.throws(() => new OwnerHailuoLiveT2vGenerationService({
      profile: forged as never, binding: AUTH_BINDING, linkService: state.linkService,
      resolveSubscription: async () => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
      resolveModelAccess: async () => { throw new Error("not called"); }, resolveChatClient: () => { throw new Error("not called"); }
    }), /OWNER_REVIEWED_T2V_PROFILE_INVALID/u);
    for (const invalid of [
      { resolution: "1080p", video_duration: 6 },
      { resolution: "720p", video_duration: 10 },
      { resolution: "720p", video_duration: 6, aspect_ratio: "16:9" },
      { resolution: "720p", video_duration: 6, file_urls: ["https://example.invalid/ref.png"] }
    ]) {
      assert.throws(() => state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A quiet river.", ...invalid } as never),
        (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "INVALID_REQUEST");
    }
    assert.deepEqual(state.counts(), { chatCount: 0, videoPosts: 0, modelAccessReads: 0 });
    assert.equal(state.requests.length, 0);
  } finally { await state.service.close(); }
});

test("Hailuo Live unknown recovery performs GET only and owner invalidation removes its handle", async () => {
  const state = await setup();
  try {
    const unknown = await state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A train crossing a bridge.", resolution: "720p", video_duration: 6 })
      .catch((error: unknown) => error);
    assert.ok(unknown instanceof OwnerReviewedNoReferenceT2vServiceError);
    assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    assert.equal(state.counts().videoPosts, 1);
    const records = state.service.listRecoveries(ATTEMPT_ID);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.model_id, "hailuo-01-live");
    state.setReady(true);
    const recovered = await state.service.reconcile({ attemptId: ATTEMPT_ID, recovery_id: unknown.recovery_id! });
    assert.equal(recovered.model_id, "hailuo-01-live");
    assert.equal(state.counts().videoPosts, 1, "reconcile must not replay generation");
    assert.ok(state.requests.some((request) => request.method === "GET" && request.url.pathname.includes("/hailuo-live-chat-1/")));

    state.setReady(false);
    const secondUnknown = await state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A boat at twilight.", resolution: "720p", video_duration: 6 })
      .catch((error: unknown) => error);
    assert.ok(secondUnknown instanceof OwnerReviewedNoReferenceT2vServiceError);
    assert.equal(secondUnknown.code, "OUTCOME_UNKNOWN");
    await state.service.invalidateAttempt(ATTEMPT_ID);
    await state.linkService.revoke(AUTH_BINDING, ATTEMPT_ID);
    assert.deepEqual(state.service.listRecoveries(ATTEMPT_ID), []);
    await assert.rejects(state.service.reconcile({ attemptId: ATTEMPT_ID, recovery_id: secondUnknown.recovery_id! }));
    assert.equal(state.counts().videoPosts, 2);
  } finally { await state.service.close(); }
});
