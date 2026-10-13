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
  OwnerHailuo02T2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError
} from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerHailuo02T2vProfile } from "../src/application/owner-hailuo02-t2v-profile.js";

const ATTEMPT_ID = "link_hailuo02_service_test_0001";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "hailuo02-test-tenant", subject: "hailuo02-test-owner" });

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setup() {
  let now = Date.now();
  const store = new InMemoryAuthLinkStore(() => now);
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-hailuo02-upstream", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-hailuo02-credential" });
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
  let chatCount = 0;
  let videoPosts = 0;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1;
      return response({ uuid: `hailuo02-chat-${chatCount}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      return response({ id: `hailuo02-echo-${videoPosts}` });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") return response([{ message_id: `hailuo02-bot-${videoPosts}`, object_type: "video", model_type: "hailuo-02" }]);
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") {
      const rows = [
        { id: `hailuo02-echo-${videoPosts}`, chat_id: 701, author_id: 12345, message_object: [] },
        { id: `hailuo02-bot-${videoPosts}`, chat_id: 701, author_id: -1, message_object: [{
          id: `video-hailuo02-${videoPosts}`, message_id: `hailuo02-bot-${videoPosts}`, object_type: "video", model_type: "hailuo-02"
        }] }
      ];
      return response({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (message && method === "GET") return response({ id: message[2], chat_id: 701, author_id: -1, message_object: [{
      id: `video-hailuo02-${videoPosts}`, message_id: `hailuo02-bot-${videoPosts}`, object_type: "video", model_type: "hailuo-02",
      completed: true, object_url: `https://r2.syntx.ai/hailuo02/result-${videoPosts}.mp4`
    }] });
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const profile = createOwnerHailuo02T2vProfile(resolve(process.cwd(), "catalog"));
  const service = new OwnerHailuo02T2vGenerationService({
    profile, binding: AUTH_BINDING, linkService,
    resolveSubscription: async (): Promise<SyntxSubscription> => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
    resolveModelAccess: async (_attemptId, _modelId, costParameters): Promise<ModelAccessResult> => ({
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
      catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
      model_id: "hailuo-02", ai_name: "hailuo-minimax", model_type: "hailuo-02", account_read_live: true,
      parameter_keys: Object.keys(costParameters).sort(), parameters_redacted: true, access: true, cost: null,
      discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString()
    }),
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-hailuo02-credential");
    } }, fetchImpl, requestTimeoutMs: 1_000 }),
    now: () => now, wait: async () => undefined, videoTimeoutMs: 20
  });
  return { service, profile, requests, counts: () => ({ chatCount, videoPosts }), advance(milliseconds: number) { now += milliseconds; } };
}

test("Hailuo 02 service admits its authentic sealed profile and preserves explicit no-reference wire settings", async () => {
  const state = await setup();
  try {
    assert.equal(state.service.getParametersSource().identity.model_id, "hailuo-02");
    const output = await state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A yellow duck on a quiet pond.", resolution: "768p", video_duration: 6 });
    assert.equal(output.model_id, "hailuo-02");
    assert.equal(output.artifacts.length, 1);
    const post = state.requests.find((request) => request.method === "POST" && request.url.pathname === "/api/v1/video/generate");
    assert.ok(post);
    assert.equal(post.url.search, "?ai_name=hailuo-minimax");
    assert.deepEqual(post.body, { chat_id: "hailuo02-chat-1", prompt: "A yellow duck on a quiet pond.", settings: {
      file_urls: [], model_type: "hailuo-02", resolution: "768p", video_duration: 6
    } });
    assert.deepEqual(state.counts(), { chatCount: 1, videoPosts: 1 });
  } finally { await state.service.close(); }
});

test("Hailuo 02 rejects unsupported pairs and injected selector fields before any request", async () => {
  const state = await setup();
  try {
    for (const invalid of [
      { resolution: "512p", video_duration: 6 },
      { resolution: "512p", video_duration: 10 },
      { resolution: "1080p", video_duration: 10 },
      { resolution: "768p", video_duration: 6, mode: "standard" }
    ]) {
      assert.throws(() => state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A yellow duck.", ...invalid } as never),
        (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "INVALID_REQUEST");
    }
    assert.deepEqual(state.counts(), { chatCount: 0, videoPosts: 0 });
    assert.equal(state.requests.length, 0);
  } finally { await state.service.close(); }
});
