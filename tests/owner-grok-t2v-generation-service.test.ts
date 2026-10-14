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
import * as serviceModule from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { OwnerReviewedNoReferenceT2vServiceError } from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerGrokT2vProfile, OWNER_GROK_T2V_CONTRACT_VARIANT_ID } from "../src/application/owner-grok-t2v-profile.js";

const ATTEMPT = "link_grok_t2v_service_attempt_001";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "grok-service-tenant", subject: "grok-service-owner" });
type ServicePort = {
  getParametersSource(): { identity: { model_id: string; ai_name: string; model_type: string } };
  getReviewedContract(): { variant_id: string };
  generate(input: unknown, signal?: AbortSignal): Promise<{ model_id: string; variant_id: string }>;
  reconcile(input: unknown, signal?: AbortSignal): Promise<{ model_id: string; variant_id: string }>;
  listRecoveries(attemptId: string, limit?: number): readonly { recovery_id: string; variant_id: string }[];
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
};

function json(payload: unknown): Response { return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }); }

async function setup() {
  let now = Date.now();
  const store = new InMemoryAuthLinkStore(() => now);
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-grok", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-grok-credential" }); return { state: "LINKED" }; }
  };
  const linkService = new PerUserLinkService(provider, store, { now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING);
  await linkService.issueHandoff(BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(BINDING, ATTEMPT)).linked, true);
  const profile = createOwnerGrokT2vProfile(resolve(process.cwd(), "catalog"));
  const requests: Array<{ url: URL; method: string; body: unknown }> = [];
  const costs: Array<{ modelId: string; parameters: Record<string, unknown> }> = [];
  const ready = new Map<string, boolean>();
  let chats = 0;
  let posts = 0;
  let readyOnCreate = false;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input)); const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") { chats += 1; const id = `grok-chat-${chats}`; ready.set(id, readyOnCreate); return json({ uuid: id }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") { posts += 1; return json({ id: `grok-echo-${posts}` }); }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") { const id = inProgress[1]!; return json(ready.get(id) ? [{ message_id: `grok-bot-${id}`, object_type: "video", model_type: "grok_t2v" }] : []); }
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") { const id = history[1]!; return json({ messages: ready.get(id) ? [{ id: `grok-bot-${id}`, chat_id: 701, author_id: -1, message_object: [{ id: `grok-video-${id}`, message_id: `grok-bot-${id}`, object_type: "video", model_type: "grok_t2v" }] }] : [], pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1, has_next: false, has_previous: false } }); }
    const message = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (message && method === "GET") { const id = message[1]!; return json({ id: message[2], chat_id: 701, author_id: -1, message_object: ready.get(id) ? [{ id: `grok-video-${id}`, message_id: message[2], object_type: "video", model_type: "grok_t2v", completed: true, object_url: `https://r2.syntx.ai/grok/${id}.mp4` }] : [] }); }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const ctor = (serviceModule as unknown as Record<string, unknown>).OwnerGrokT2vGenerationService;
  assert.equal(typeof ctor, "function", "Grok T2V service export is missing");
  const service = new (ctor as new (options: Record<string, unknown>) => ServicePort)({
    profile, binding: BINDING, linkService,
    resolveSubscription: async (): Promise<SyntxSubscription> => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
    resolveModelAccess: async (_attemptId: string, modelId: string, parameters: Readonly<Record<string, unknown>>): Promise<ModelAccessResult> => {
      costs.push({ modelId, parameters: { ...parameters } });
      return { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: modelId, ai_name: "grok_video", model_type: "grok_t2v", account_read_live: true, parameter_keys: Object.keys(parameters).sort(),
        parameters_redacted: true, access: true, cost: null, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString() };
    },
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-grok-credential"); } }, fetchImpl, requestTimeoutMs: 1_000 }),
    now: () => now, wait: async () => undefined, videoTimeoutMs: 10
  });
  return { service, linkService, requests, costs, counts: () => ({ chats, posts }),
    setReadyOnCreate(value: boolean) { readyOnCreate = value; }, setReady(chatId: string) { ready.set(chatId, true); },
    close: () => service.close() };
}

test("Grok service fixes the genuine source identity and sends only reviewed settings; cost projection stays preflight-only", async () => {
  const state = await setup();
  try {
    state.setReadyOnCreate(true);
    assert.deepEqual(state.service.getParametersSource().identity, { model_id: "grok_t2v", ai_name: "grok_video", model_type: "grok_t2v", operation_id: "generate-video" });
    assert.equal(state.service.getReviewedContract().variant_id, OWNER_GROK_T2V_CONTRACT_VARIANT_ID);
    const result = await state.service.generate({ attemptId: ATTEMPT, prompt: "A copper kite drifting over a quiet blue lake.", aspect_ratio: "3:2", resolution: "720p", video_duration: 9 });
    assert.equal(result.model_id, "grok_t2v"); assert.equal(result.variant_id, OWNER_GROK_T2V_CONTRACT_VARIANT_ID);
    assert.deepEqual(state.requests.filter((item) => item.method === "POST" && item.url.pathname === "/api/v1/video/generate").map((item) => item.body), [{
      chat_id: "grok-chat-1", prompt: "A copper kite drifting over a quiet blue lake.",
      settings: { model_type: "grok_t2v", file_urls: [], aspect_ratio: "3:2", resolution: "720p", video_duration: 9 }
    }]);
    assert.ok(state.requests.some((item) => item.method === "POST" && item.url.search === "?ai_name=grok_video"));
    assert.equal(state.costs.length, 2);
    assert.ok(state.costs.every(({ modelId, parameters }) => modelId === "grok_t2v" && Object.keys(parameters).sort().join() === "resolution,video_duration"));
    assert.deepEqual(state.counts(), { chats: 1, posts: 1 });
  } finally { await state.close(); }
});

test("Grok unknown generation has an attempt-bound recovery handle and reconciliation never repeats POST", async () => {
  const state = await setup();
  try {
    const unknown = await state.service.generate({ attemptId: ATTEMPT, prompt: "A tiny glass lighthouse under a violet sky.",
      aspect_ratio: "9:16", resolution: "480p", video_duration: 10 }).catch((error: unknown) => error);
    assert.ok(unknown instanceof OwnerReviewedNoReferenceT2vServiceError);
    assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    const listed = state.service.listRecoveries(ATTEMPT, 20);
    assert.equal(listed.length, 1); assert.equal(listed[0]?.recovery_id, unknown.recovery_id);
    const beforeReconcile = state.counts().posts;
    state.setReady("grok-chat-1");
    const result = await state.service.reconcile({ attemptId: ATTEMPT, recovery_id: unknown.recovery_id });
    assert.equal(result.model_id, "grok_t2v");
    assert.equal(state.counts().posts, beforeReconcile);
    assert.ok(state.requests.some((request) => request.method === "GET" && request.url.pathname.includes("grok-chat-1")));
    await state.service.invalidateAttempt(ATTEMPT);
    assert.deepEqual(state.service.listRecoveries(ATTEMPT), []);
  } finally { await state.close(); }
});

test("Grok service rejects raw model/wire fields and invalid integer durations before dispatch", async () => {
  const state = await setup();
  try {
    const valid = { attemptId: ATTEMPT, prompt: "A silver paper lantern in a dark garden.", aspect_ratio: "16:9", resolution: "480p", video_duration: 6 };
    for (const input of [
      { ...valid, model_id: "grok_t2v" }, { ...valid, settings: {} }, { ...valid, file_urls: [] },
      { ...valid, video_duration: 6.5 }, { ...valid, video_duration: "6" }, { ...valid, video_duration: 11 },
      { ...valid, aspect_ratio: "7:5" }, { ...valid, resolution: "1080p" }
    ]) assert.throws(() => state.service.generate(input), (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "INVALID_REQUEST");
    assert.deepEqual(state.counts(), { chats: 0, posts: 0 }); assert.equal(state.costs.length, 0);
  } finally { await state.close(); }
});
