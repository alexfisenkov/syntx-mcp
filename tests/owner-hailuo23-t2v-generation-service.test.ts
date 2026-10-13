import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import { OwnerHailuo23T2vGenerationService } from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerHailuo23T2vProfile } from "../src/application/owner-hailuo23-t2v-profile.js";

const ATTEMPT_ID = "link_hailuo23_service_test_0001";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "hailuo23-test-tenant", subject: "hailuo23-test-owner" });

interface HttpRequestRecord { readonly url: URL; readonly method: string; readonly body: unknown }

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setup(options: { readonly loseGenerationAck?: boolean } = {}) {
  let now = Date.now();
  const store = new InMemoryAuthLinkStore(() => now);
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-hailuo23-upstream", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_upstreamAttemptId, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-hailuo23-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, store, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT_ID });
  const created = await linkService.createAttempt(AUTH_BINDING);
  await linkService.issueHandoff(AUTH_BINDING, created.attempt_id);
  const linked = await linkService.checkAttempt(AUTH_BINDING, created.attempt_id);
  assert.equal(linked.linked, true);

  const chats = new Map<string, { readonly echoId: string; readonly botId: string; readonly artifactUrl: string; ready: boolean }>();
  const requests: HttpRequestRecord[] = [];
  let chatCount = 0;
  let videoPosts = 0;
  let clientResolves = 0;
  let subscriptionReads = 0;
  const costReads: { readonly modelId: string; readonly parameters: Readonly<Record<string, unknown>> }[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : method === "POST" && url.pathname === "/api/v1/video/generate"
      ? JSON.parse(String(init.body)) as unknown : null;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1;
      return jsonResponse({ uuid: `hailuo23-chat-${chatCount}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      const request = body as { readonly chat_id: string };
      const state = { echoId: `hailuo23-echo-${videoPosts}`, botId: `hailuo23-bot-${videoPosts}`,
        artifactUrl: `https://r2.syntx.ai/hailuo23/result-${videoPosts}.mp4`, ready: !options.loseGenerationAck };
      chats.set(request.chat_id, state);
      if (options.loseGenerationAck) throw new Error("synthetic generation ACK lost after dispatch");
      return jsonResponse({ id: state.echoId });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") {
      const state = chats.get(inProgress[1]!);
      return jsonResponse(state?.ready ? [{ message_id: state.botId, message_object_id: `video-${state.botId}`,
        object_type: "video", model_type: "hailuo-2.3" }] : []);
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") {
      const state = chats.get(history[1]!);
      const rows = state === undefined ? [] : [
        { id: state.echoId, chat_id: 701, author_id: 12345, message_object: [] },
        ...(state.ready ? [{ id: state.botId, chat_id: 701, author_id: -1, message_object: [{
          id: `video-${state.botId}`, message_id: state.botId, object_type: "video", model_type: "hailuo-2.3"
        }] }] : [])
      ];
      return jsonResponse({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: rows.length === 0 ? 0 : 1, has_next: false, has_previous: false } });
    }
    const message = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (message && method === "GET") {
      const state = chats.get(message[1]!);
      if (state === undefined) return jsonResponse({ id: message[2], chat_id: 701, author_id: 12345, message_object: [] });
      if (message[2] === state.echoId) return jsonResponse({ id: state.echoId, chat_id: 701, author_id: 12345, message_object: [] });
      return jsonResponse({ id: state.botId, chat_id: 701, author_id: -1, message_object: state.ready ? [{
        id: `video-${state.botId}`, message_id: state.botId, object_type: "video", model_type: "hailuo-2.3",
        completed: true, object_url: state.artifactUrl
      }] : [] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const profile = createOwnerHailuo23T2vProfile();
  const createService = (selectedProfile = profile) => {
    return new OwnerHailuo23T2vGenerationService({
      profile: selectedProfile,
      binding: AUTH_BINDING,
      linkService,
      resolveSubscription: async (): Promise<SyntxSubscription> => {
        subscriptionReads += 1;
        return { active: true, plan_type: "PAID", end_date: null, end_date_kind: null };
      },
      resolveModelAccess: async (_attemptId, modelId, costParameters): Promise<ModelAccessResult> => {
        costReads.push({ modelId, parameters: Object.freeze({ ...costParameters }) });
        return {
          catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
          catalog_version: `${selectedProfile.catalog.fetched_at}.${selectedProfile.catalog.source_hashes.models.slice(7, 19)}`,
          model_id: "hailuo-2.3", ai_name: "hailuo-minimax", model_type: "hailuo-2.3", account_read_live: true,
          parameter_keys: Object.keys(costParameters).sort(), parameters_redacted: true, access: true, cost: null,
          discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString()
        };
      },
      resolveChatClient: () => {
        clientResolves += 1;
        return new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
          return operation("synthetic-hailuo23-credential");
        } }, fetchImpl, requestTimeoutMs: 1_000 });
      },
      now: () => now,
      wait: async () => undefined,
      videoTimeoutMs: 20
    });
  };
  const service = createService();
  return {
    service, profile, createService, linkService, requests, costReads,
    counts: () => ({ chatCount, videoPosts, clientResolves, subscriptionReads }),
    advance(milliseconds: number) { now += milliseconds; },
    makeReady() { for (const state of chats.values()) state.ready = true; }
  };
}

test("reviewed no-reference engine exposes a distinct Hailuo 2.3 service wrapper", () => {
  assert.equal(typeof OwnerHailuo23T2vGenerationService, "function");
});

test("Hailuo 2.3 service emits the explicit reviewed pair and preflights the same cost fields twice", async () => {
  const state = await setup();
  try {
    const pairs = [
      { resolution: "768p", video_duration: 6 },
      { resolution: "768p", video_duration: 10 },
      { resolution: "1080p", video_duration: 6 }
    ] as const;
    const outputs: unknown[] = [];
    for (const [index, pair] of pairs.entries()) {
      outputs.push(await state.service.generate({ attemptId: ATTEMPT_ID, prompt: `Hailuo reviewed pair ${index + 1}.`, ...pair }));
    }
    assert.equal(outputs.length, 3);
    assert.equal(state.costReads.length, 6);
    for (const [index, pair] of pairs.entries()) {
      for (const read of state.costReads.slice(index * 2, index * 2 + 2)) {
        assert.equal(read.modelId, "hailuo-2.3");
        assert.deepEqual(read.parameters, pair);
      }
    }
    const posts = state.requests.filter((request) => request.method === "POST" && request.url.pathname === "/api/v1/video/generate");
    assert.equal(posts.length, 3);
    for (const [index, post] of posts.entries()) {
      assert.equal(post.url.search, "?ai_name=hailuo-minimax");
      assert.deepEqual(post.body, { chat_id: `hailuo23-chat-${index + 1}`, prompt: `Hailuo reviewed pair ${index + 1}.`, settings: {
        model_type: "hailuo-2.3", video_duration: pairs[index]!.video_duration,
        resolution: pairs[index]!.resolution, file_urls: []
      } });
    }
  } finally { await state.service.close(); }
});

test("unsupported Hailuo 2.3 pair and unknown input fields are rejected before auth, access, or chat", async () => {
  const state = await setup();
  try {
    for (const invalid of [
      { resolution: "1080p", video_duration: 10 },
      { resolution: "512p", video_duration: 6 },
      { resolution: "768p", video_duration: 6, mode: "standard" }
    ]) {
      assert.throws(() => state.service.generate({ attemptId: ATTEMPT_ID, prompt: "A yellow duck on a pond.", ...invalid } as never),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    }
    assert.deepEqual(state.counts(), { chatCount: 0, videoPosts: 0, clientResolves: 0, subscriptionReads: 0 });
    assert.equal(state.costReads.length, 0);
  } finally { await state.service.close(); }
});

test("Hailuo 2.3 recovery after 16 minutes uses the captured client and does not replay the POST", async () => {
  const state = await setup({ loseGenerationAck: true });
  try {
    const unknown = await state.service.generate({ attemptId: ATTEMPT_ID, prompt: "One Hailuo 2.3 unknown request.",
      resolution: "768p", video_duration: 6 }).catch((error: unknown) => error);
    assert.ok(unknown instanceof Error);
    assert.equal("code" in unknown ? unknown.code : undefined, "OUTCOME_UNKNOWN");
    assert.equal(state.service.listRecoveries(ATTEMPT_ID).length, 1);
    const before = state.counts();
    const chatId = "hailuo23-chat-1";
    state.advance(16 * 60_000);
    state.makeReady();
    const recoveryId = (unknown as unknown as { readonly recovery_id: string }).recovery_id;
    const recovered = await state.service.reconcile({ attemptId: ATTEMPT_ID, recovery_id: recoveryId });
    assert.equal((recovered as { readonly status: string }).status, "reviewed");
    assert.deepEqual(state.counts(), before, "reconcile must not create chats, dispatch, resolve another client, or re-preflight");
    assert.equal(state.requests.filter((request) => request.method === "POST" && request.url.pathname === "/api/v1/video/generate").length, 1);
    assert.equal(state.service.listRecoveries(ATTEMPT_ID).length, 0);
    assert.ok(state.requests.some((request) => request.method === "GET" && request.url.pathname.startsWith(`/api/v1/chats/${String(chatId)}/`)));
  } finally { await state.service.close(); }
});
