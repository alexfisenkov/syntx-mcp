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
  OwnerReviewedNoReferenceT2vServiceError,
  OwnerSeedance20T2vGenerationService
} from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerSeedance20T2vProfile } from "../src/application/owner-seedance20-t2v-profile.js";

const ATTEMPT_ID = "link_seedance20_service_test_0001";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "seedance20-test-tenant", subject: "seedance20-test-owner" });

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setup() {
  let now = Date.now();
  const store = new InMemoryAuthLinkStore(() => now);
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-seedance20-upstream", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-seedance20-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, store, {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT_ID
  });
  await linkService.createAttempt(AUTH_BINDING);
  await linkService.issueHandoff(AUTH_BINDING, ATTEMPT_ID);
  assert.equal((await linkService.checkAttempt(AUTH_BINDING, ATTEMPT_ID)).linked, true);

  const requests: Array<{ readonly url: URL; readonly method: string; readonly body: unknown }> = [];
  const accessParameters: Array<Readonly<Record<string, unknown>>> = [];
  let chatCount = 0;
  let videoPosts = 0;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1;
      return response({ uuid: `seedance20-chat-${chatCount}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      return response({ id: `seedance20-echo-${videoPosts}` });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") return response([{ message_id: `seedance20-bot-${videoPosts}`, object_type: "video", model_type: "seedance-2.0" }]);
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") {
      const rows = [
        { id: `seedance20-echo-${videoPosts}`, chat_id: 701, author_id: 12345, message_object: [] },
        { id: `seedance20-bot-${videoPosts}`, chat_id: 701, author_id: -1, message_object: [{
          id: `video-seedance20-${videoPosts}`, message_id: `seedance20-bot-${videoPosts}`, object_type: "video", model_type: "seedance-2.0"
        }] }
      ];
      return response({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (message && method === "GET") return response({ id: message[2], chat_id: 701, author_id: -1, message_object: [{
      id: `video-seedance20-${videoPosts}`, message_id: `seedance20-bot-${videoPosts}`, object_type: "video", model_type: "seedance-2.0",
      completed: true, object_url: `https://r2.syntx.ai/seedance20/result-${videoPosts}.mp4`
    }] });
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const profile = createOwnerSeedance20T2vProfile(resolve(process.cwd(), "catalog"));
  const service = new OwnerSeedance20T2vGenerationService({
    profile, binding: AUTH_BINDING, linkService,
    resolveSubscription: async (): Promise<SyntxSubscription> => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
    resolveModelAccess: async (_attemptId, _modelId, costParameters): Promise<ModelAccessResult> => {
      accessParameters.push(Object.freeze({ ...costParameters }));
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
        catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: "seedance-2.0", ai_name: "seedance", model_type: "seedance-2.0", account_read_live: true,
        parameter_keys: Object.keys(costParameters).sort(), parameters_redacted: true, access: true, cost: null,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString()
      };
    },
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-seedance20-credential");
    } }, fetchImpl, requestTimeoutMs: 1_000 }),
    now: () => now, wait: async () => undefined, videoTimeoutMs: 20
  });
  return { service, profile, requests, accessParameters, counts: () => ({ chatCount, videoPosts }), advance(milliseconds: number) { now += milliseconds; } };
}

test("Seedance 2.0 service injects mini for preflight and one no-reference POST, then reads one result", async () => {
  const state = await setup();
  try {
    assert.equal(state.service.getParametersSource().identity.model_id, "seedance-2.0");
    const output = await state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A yellow duck on a quiet pond.", resolution: "720p",
      aspect_ratio: "16:9", video_duration: 5, generate_audio: true });
    assert.equal(output.model_id, "seedance-2.0");
    assert.equal(output.artifacts.length, 1);
    const post = state.requests.find((request) => request.method === "POST" && request.url.pathname === "/api/v1/video/generate");
    assert.ok(post);
    assert.equal(post.url.search, "?ai_name=seedance");
    assert.deepEqual(post.body, { chat_id: "seedance20-chat-1", prompt: "A yellow duck on a quiet pond.", settings: {
      file_urls: [], mode: "mini", model_type: "seedance-2.0", resolution: "720p", aspect_ratio: "16:9", video_duration: 5, generate_audio: true
    } });
    assert.deepEqual(state.accessParameters, [
      { video_duration: 5, duration: 0, mode: "mini", size: "16:9", resolution: "720p" },
      { video_duration: 5, duration: 0, mode: "mini", size: "16:9", resolution: "720p" }
    ]);
    assert.deepEqual(state.counts(), { chatCount: 1, videoPosts: 1 });
    assert.equal(state.requests.filter((request) => request.url.pathname.match(/^\/api\/v1\/chats\/[^/]+\/[^/]+$/u) && request.method === "GET").length, 1);
  } finally { await state.service.close(); }
});

test("Seedance 2.0 service rejects a caller mode selector and unreviewed inputs before network activity", async () => {
  const state = await setup();
  try {
    for (const invalid of [
      { resolution: "1080p", aspect_ratio: "16:9", video_duration: 5, generate_audio: true },
      { resolution: "720p", aspect_ratio: "16:9", video_duration: 16, generate_audio: true },
      { resolution: "720p", aspect_ratio: "16:9", video_duration: 5, generate_audio: true, mode: "mini" },
      { resolution: "720p", aspect_ratio: "16:9", video_duration: 5, generate_audio: true, file_urls: ["https://example.invalid/a.png"] }
    ]) {
      assert.throws(() => state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A yellow duck.", ...invalid } as never),
        (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "INVALID_REQUEST");
    }
    assert.deepEqual(state.counts(), { chatCount: 0, videoPosts: 0 });
    assert.equal(state.requests.length, 0);
  } finally { await state.service.close(); }
});
