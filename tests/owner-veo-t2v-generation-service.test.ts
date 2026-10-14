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
import * as ownerServiceModule from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { OwnerReviewedNoReferenceT2vServiceError } from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import {
  OWNER_VEO_T2V_CONTRACT_VARIANT_IDS,
  createOwnerVeoT2vProfile,
  type OwnerVeoT2vModelId
} from "../src/application/owner-veo-t2v-profile.js";

const ATTEMPT = "link_veo_service_test_attempt_0001";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "veo-test-tenant", subject: "veo-test-owner" });
const MODEL_IDS: readonly OwnerVeoT2vModelId[] = ["veo3", "veo3fast", "veo3fast_r"];

interface HttpRequestRecord { readonly url: URL; readonly method: string; readonly body: unknown }
interface VeoGenerationService {
  getParametersSource(modelId: OwnerVeoT2vModelId): { identity: { model_id: string } };
  getReviewedContract(modelId: OwnerVeoT2vModelId): { variant_id: string };
  generate(input: Record<string, unknown>, signal?: AbortSignal): Promise<{ model_id: string; variant_id: string }>;
  reconcile(input: Record<string, unknown>, signal?: AbortSignal): Promise<{ model_id: string; variant_id: string }>;
  listRecoveries(attemptId: string, limit?: number): readonly { recovery_id: string; model_id: string; variant_id: string }[];
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setup() {
  let now = Date.now();
  const store = new InMemoryAuthLinkStore(() => now);
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-veo-upstream", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-veo-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, store, {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
  });
  await linkService.createAttempt(AUTH_BINDING);
  await linkService.issueHandoff(AUTH_BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(AUTH_BINDING, ATTEMPT)).linked, true);

  const requests: HttpRequestRecord[] = [];
  const costs: Array<{ readonly modelId: string; readonly parameters: Readonly<Record<string, unknown>> }> = [];
  const ready = new Map<string, boolean>();
  const modelByChat = new Map<string, string>();
  let chatCount = 0;
  let videoPosts = 0;
  let readyOnCreate = false;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1;
      const chatId = `veo-chat-${chatCount}`;
      const settings = (body as { settings?: { model_type?: string } } | null)?.settings;
      modelByChat.set(chatId, settings?.model_type ?? "veo3");
      if (readyOnCreate) ready.set(chatId, true);
      return response({ uuid: chatId });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      const generation = body as { chat_id?: string; settings?: { model_type?: string } } | null;
      if (generation?.chat_id && generation.settings?.model_type) modelByChat.set(generation.chat_id, generation.settings.model_type);
      return response({ id: `veo-echo-${videoPosts}` });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") {
      const chatId = inProgress[1]!;
      return response(ready.get(chatId) ? [{ message_id: `veo-bot-${chatId}`, object_type: "video", model_type: modelByChat.get(chatId) }] : []);
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") {
      const chatId = history[1]!;
      const rows = [
        { id: `veo-echo-${chatId}`, chat_id: 701, author_id: 12345, message_object: [] },
        ...(ready.get(chatId) ? [{ id: `veo-bot-${chatId}`, chat_id: 701, author_id: -1, message_object: [{
          id: `veo-video-${chatId}`, message_id: `veo-bot-${chatId}`, object_type: "video", model_type: modelByChat.get(chatId)
        }] }] : [])
      ];
      return response({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (message && method === "GET") {
      const chatId = message[1]!;
      return response({ id: message[2], chat_id: 701, author_id: -1, message_object: ready.get(chatId) ? [{
        id: `veo-video-${chatId}`, message_id: message[2], object_type: "video", model_type: modelByChat.get(chatId),
        completed: true, object_url: `https://r2.syntx.ai/veo/${chatId}.mp4`
      }] : [] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };

  const catalogDirectory = resolve(process.cwd(), "catalog");
  const profile = createOwnerVeoT2vProfile("veo3", catalogDirectory);
  const constructor = (ownerServiceModule as unknown as Record<string, unknown>).OwnerVeoT2vGenerationService;
  assert.equal(typeof constructor, "function", "Veo T2V family service export is missing");
  const service = new (constructor as new (options: Record<string, unknown>) => VeoGenerationService)({
    catalogDirectory,
    binding: AUTH_BINDING,
    linkService,
    resolveSubscription: async (): Promise<SyntxSubscription> => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
    resolveModelAccess: async (_attemptId: string, modelId: string, parameters: Readonly<Record<string, unknown>>): Promise<ModelAccessResult> => {
      costs.push({ modelId, parameters: Object.freeze({ ...parameters }) });
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
        catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: modelId, ai_name: "veo3", model_type: modelId, account_read_live: true,
        parameter_keys: Object.keys(parameters).sort(), parameters_redacted: true, access: true, cost: null,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString()
      };
    },
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-veo-credential");
    } }, fetchImpl, requestTimeoutMs: 1_000 }),
    now: () => now,
    wait: async () => undefined,
    videoTimeoutMs: 10
  });
  return {
    service, linkService, requests, costs,
    counts: () => ({ chatCount, videoPosts }),
    setReady(chatId: string) { ready.set(chatId, true); },
    setReadyOnCreate(value: boolean) { readyOnCreate = value; },
    advance(milliseconds: number) { now += milliseconds; }
  };
}

test("Veo family service binds all three exact profiles, numeric cost input, and one sealed generation body", async () => {
  const state = await setup();
  try {
    state.setReadyOnCreate(true);
    for (const modelId of MODEL_IDS) {
      assert.equal(state.service.getParametersSource(modelId).identity.model_id, modelId);
    }
    const requests = [
      { model_id: "veo3", upscale: 0, aspect_ratio: "16:9" },
      { model_id: "veo3fast", upscale: 1, aspect_ratio: "9:16" },
      { model_id: "veo3fast_r", upscale: 2, aspect_ratio: "16:9" }
    ] as const;
    for (const [index, request] of requests.entries()) {
      const output = await state.service.generate({ ...request, attemptId: ATTEMPT, prompt: `A quiet mountain village at sunrise ${index}.`, video_duration: 8 });
      assert.equal(output.model_id, request.model_id);
      assert.equal(output.variant_id, state.service.getReviewedContract(request.model_id).variant_id);
      assert.equal(output.variant_id, OWNER_VEO_T2V_CONTRACT_VARIANT_IDS[request.model_id]);
    }
    const posts = state.requests.filter((request) => request.method === "POST" && request.url.pathname === "/api/v1/video/generate");
    assert.deepEqual(posts.map((request) => request.body), requests.map((request, index) => ({
      chat_id: `veo-chat-${index + 1}`,
      prompt: `A quiet mountain village at sunrise ${index}.`,
      settings: { type: "text", model_type: request.model_id, file_urls: [], upscale: request.upscale,
        aspect_ratio: request.aspect_ratio, video_duration: 8 }
    })));
    assert.ok(posts.every((request) => request.url.search === "?ai_name=veo3"));
    assert.equal(state.costs.length, 6);
    assert.ok(state.costs.every(({ modelId, parameters }) => modelId.startsWith("veo3") && Object.keys(parameters).join() === "upscale"));
    assert.deepEqual(state.counts(), { chatCount: 3, videoPosts: 3 });
  } finally { await state.service.close(); }
});

test("Veo recovery is model-bound, GET-only, globally listed, and removed after owner revocation", async () => {
  const state = await setup();
  try {
    const unknown = await state.service.generate({ model_id: "veo3fast_r", attemptId: ATTEMPT,
      prompt: "A silver kite over a field at sunrise.", upscale: 1, aspect_ratio: "9:16", video_duration: 8 })
      .catch((error: unknown) => error);
    assert.ok(unknown instanceof OwnerReviewedNoReferenceT2vServiceError);
    assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    const beforeRecovery = state.counts();
    const listed = state.service.listRecoveries(ATTEMPT, 20);
    assert.equal(listed.length, 1);
    assert.deepEqual({ recovery_id: listed[0]?.recovery_id, model_id: listed[0]?.model_id,
      variant_id: listed[0]?.variant_id }, {
      recovery_id: unknown.recovery_id, model_id: "veo3fast_r", variant_id: OWNER_VEO_T2V_CONTRACT_VARIANT_IDS.veo3fast_r
    });
    await assert.rejects(state.service.reconcile({ model_id: "veo3", attemptId: ATTEMPT, recovery_id: unknown.recovery_id! }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "RECOVERY_NOT_FOUND");
    state.setReady("veo-chat-1");
    const recovered = await state.service.reconcile({ model_id: "veo3fast_r", attemptId: ATTEMPT, recovery_id: unknown.recovery_id! });
    assert.equal(recovered.model_id, "veo3fast_r");
    assert.equal(state.counts().videoPosts, beforeRecovery.videoPosts);
    assert.ok(state.requests.some((request) => request.method === "GET" && request.url.pathname.includes("/veo-chat-1/")));

    let lastUnknown: OwnerReviewedNoReferenceT2vServiceError | undefined;
    let lastModel: OwnerVeoT2vModelId = "veo3";
    for (let index = 0; index < 21; index += 1) {
      const model_id = MODEL_IDS[index % MODEL_IDS.length]!;
      const result = await state.service.generate({ model_id, attemptId: ATTEMPT,
        prompt: `A blue sail crossing a quiet lake at dawn, scene ${index}.`, upscale: (index % 3) as 0 | 1 | 2,
        aspect_ratio: index % 2 === 0 ? "16:9" : "9:16", video_duration: 8 }).catch((error: unknown) => error);
      assert.ok(result instanceof OwnerReviewedNoReferenceT2vServiceError);
      assert.equal(result.code, "OUTCOME_UNKNOWN");
      lastUnknown = result;
      lastModel = model_id;
    }
    const globalRecoveries = state.service.listRecoveries(ATTEMPT, 20);
    assert.equal(globalRecoveries.length, 20);
    assert.deepEqual(new Set(globalRecoveries.map((item) => item.model_id)), new Set(MODEL_IDS));
    assert.ok(globalRecoveries.every((item) => item.variant_id === OWNER_VEO_T2V_CONTRACT_VARIANT_IDS[item.model_id as OwnerVeoT2vModelId]));
    assert.equal(state.service.listRecoveries(ATTEMPT, 1).length, 1);
    const postsBeforeRevoke = state.counts().videoPosts;
    await state.linkService.revoke(AUTH_BINDING, ATTEMPT);
    await state.service.invalidateAttempt(ATTEMPT);
    assert.deepEqual(state.service.listRecoveries(ATTEMPT), []);
    assert.ok(lastUnknown);
    await assert.rejects(state.service.reconcile({ model_id: lastModel, attemptId: ATTEMPT, recovery_id: lastUnknown.recovery_id! }));
    assert.equal(state.counts().videoPosts, postsBeforeRevoke);
  } finally { await state.service.close(); }
});

test("Veo family service rejects unsupported model ids, display labels, draft quality, and extra wire fields before dispatch", async () => {
  const state = await setup();
  try {
    const invalidInputs = [
      { model_id: "veo_omni", attemptId: ATTEMPT, prompt: "A landscape.", upscale: 0, aspect_ratio: "16:9", video_duration: 8 },
      { model_id: "veo3", attemptId: ATTEMPT, prompt: "A landscape.", upscale: "720p", aspect_ratio: "16:9", video_duration: 8 },
      { model_id: "veo3fast", attemptId: ATTEMPT, prompt: "A landscape.", upscale: "1080p", aspect_ratio: "16:9", video_duration: 8 },
      { model_id: "veo3fast_r", attemptId: ATTEMPT, prompt: "A landscape.", upscale: "4K", aspect_ratio: "16:9", video_duration: 8 },
      { model_id: "veo3", attemptId: ATTEMPT, prompt: "A landscape.", upscale: 3, aspect_ratio: "16:9", video_duration: 8 },
      { model_id: "veo3", attemptId: ATTEMPT, prompt: "A landscape.", upscale: 1, aspect_ratio: "16:9", video_duration: 8, model_type: "veo3" },
      { model_id: "veo3", attemptId: ATTEMPT, prompt: "A landscape.", upscale: 1, aspect_ratio: "16:9", video_duration: 8, type: "text" },
      { model_id: "veo3", attemptId: ATTEMPT, prompt: "A landscape.", upscale: 1, aspect_ratio: "16:9", video_duration: 8, file_urls: [] },
      { model_id: "veo3", attemptId: ATTEMPT, prompt: "A landscape.", upscale: 1, aspect_ratio: "16:9", video_duration: 8, url: "https://r2.syntx.ai/input.mp4" }
    ];
    for (const input of invalidInputs) {
      assert.throws(() => state.service.generate(input),
        (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "INVALID_REQUEST");
    }
    let getterCalls = 0;
    const accessor = Object.defineProperty({ model_id: "veo3", attemptId: ATTEMPT, prompt: "A landscape.", upscale: 0,
      aspect_ratio: "16:9", video_duration: 8 }, "prompt", { enumerable: true, get() { getterCalls += 1; return "A landscape."; } });
    assert.throws(() => state.service.generate(accessor as unknown as Record<string, unknown>),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "INVALID_REQUEST");
    assert.equal(getterCalls, 0);
    assert.deepEqual(state.counts(), { chatCount: 0, videoPosts: 0 });
    assert.equal(state.requests.length, 0);
  } finally { await state.service.close(); }
});

test("Veo family close reaches every sealed profile engine", async () => {
  const state = await setup();
  try {
    await state.service.close();
    for (const model_id of MODEL_IDS) {
      assert.throws(() => state.service.generate({ model_id, attemptId: ATTEMPT,
        prompt: "A quiet village at sunrise.", upscale: 0, aspect_ratio: "16:9", video_duration: 8 }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "SERVICE_CLOSED");
    }
    assert.deepEqual(state.counts(), { chatCount: 0, videoPosts: 0 });
  } finally { await state.service.close(); }
});
