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
  OwnerKlingT2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError
} from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerKlingT2vProfile } from "../src/application/owner-kling-t2v-profile.js";

const ATTEMPT_BASE = "link_kling_service_test_base_0001";
const ATTEMPT_O1 = "link_kling_service_test_o1_0001";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "kling-test-tenant", subject: "kling-test-owner" });

interface HttpRequestRecord { readonly url: URL; readonly method: string; readonly body: unknown }

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setup() {
  let now = Date.now();
  const store = new InMemoryAuthLinkStore(() => now);
  const attempts = [ATTEMPT_BASE, ATTEMPT_O1];
  let attemptIndex = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-kling-upstream", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-kling-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, store, {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => attempts[attemptIndex++]!
  });
  for (const attemptId of attempts) {
    await linkService.createAttempt(AUTH_BINDING);
    await linkService.issueHandoff(AUTH_BINDING, attemptId);
    assert.equal((await linkService.checkAttempt(AUTH_BINDING, attemptId)).linked, true);
  }

  const requests: HttpRequestRecord[] = [];
  const costs: Array<{ readonly modelId: string; readonly parameters: Readonly<Record<string, unknown>> }> = [];
  const ready = new Map<string, boolean>();
  const chatModels = new Map<string, string>();
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
      const chatId = `kling-chat-${chatCount}`;
      if (readyOnCreate) ready.set(chatId, true);
      return response({ uuid: chatId });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      if (body !== null && typeof body === "object" && "chat_id" in body && "settings" in body &&
          body.settings !== null && typeof body.settings === "object" && "model_type" in body.settings) {
        chatModels.set(String(body.chat_id), String(body.settings.model_type));
      }
      return response({ id: `kling-echo-${videoPosts}` });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") {
      const chatId = inProgress[1]!;
      const index = Number(chatId.split("-").at(-1));
      return response(ready.get(chatId) ? [{ message_id: `kling-bot-${index}`, object_type: "video", model_type: chatModels.get(chatId) }] : []);
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") {
      const chatId = history[1]!;
      const index = Number(chatId.split("-").at(-1));
      const rows = [
        { id: `kling-echo-${index}`, chat_id: 701, author_id: 12345, message_object: [] },
        ...(ready.get(chatId) ? [{ id: `kling-bot-${index}`, chat_id: 701, author_id: -1, message_object: [{
          id: `kling-video-${index}`, message_id: `kling-bot-${index}`, object_type: "video", model_type: chatModels.get(chatId)
        }] }] : [])
      ];
      return response({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (message && method === "GET") {
      const chatId = message[1]!;
      const index = Number(chatId.split("-").at(-1));
      return response({ id: message[2], chat_id: 701, author_id: -1, message_object: ready.get(chatId) ? [{
        id: `kling-video-${index}`, message_id: message[2], object_type: "video", model_type: chatModels.get(chatId),
        completed: true, object_url: `https://r2.syntx.ai/kling/result-${index}.mp4`
      }] : [] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const profile = createOwnerKlingT2vProfile("kling_text2video", resolve(process.cwd(), "catalog"));
  const service = new OwnerKlingT2vGenerationService({
    catalogDirectory: resolve(process.cwd(), "catalog"),
    binding: AUTH_BINDING,
    linkService,
    resolveSubscription: async (): Promise<SyntxSubscription> => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
    resolveModelAccess: async (_attemptId, modelId, parameters): Promise<ModelAccessResult> => {
      costs.push({ modelId, parameters: Object.freeze({ ...parameters }) });
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
        catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: modelId, ai_name: "kling", model_type: modelId, account_read_live: true,
        parameter_keys: Object.keys(parameters).sort(), parameters_redacted: true, access: true, cost: null,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString()
      };
    },
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-kling-credential");
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

test("Kling family service routes the selected model to one sealed engine and projects its source-bound cost fields", async () => {
  const state = await setup();
  try {
    state.setReadyOnCreate(true);
    assert.equal(state.service.getParametersSource("kling_text2video").identity.model_id, "kling_text2video");
    assert.equal(state.service.getParametersSource("kling_o1_text2video").identity.model_id, "kling_o1_text2video");
    const output = await state.service.generate({ model_id: "kling_text2video", attemptId: ATTEMPT_BASE,
      prompt: "A quiet shoreline at sunrise.", version: "1.5", mode: "standart", aspect_ratio: "16:9", video_duration: 5, native_audio: false });
    assert.equal(output.model_id, "kling_text2video");
    assert.equal(output.artifacts.length, 1);
    const post = state.requests.find((request) => request.method === "POST" && request.url.pathname === "/api/v1/video/generate");
    assert.ok(post);
    assert.equal(post.url.search, "?ai_name=kling");
    assert.deepEqual(post.body, { chat_id: "kling-chat-1", prompt: "A quiet shoreline at sunrise.", settings: {
      model_type: "kling_text2video", version: "1.5", mode: "standart", aspect_ratio: "16:9", video_duration: 5, native_audio: false, file_urls: []
    } });
    assert.deepEqual(state.costs, [
      { modelId: "kling_text2video", parameters: { version: "1.5", mode: "standart", video_duration: 5, native_audio: false } },
      { modelId: "kling_text2video", parameters: { version: "1.5", mode: "standart", video_duration: 5, native_audio: false } }
    ]);
    assert.deepEqual(state.counts(), { chatCount: 1, videoPosts: 1 });
  } finally { await state.service.close(); }
});

test("Kling recovery is model-bound, GET-only, aggregate-listed, and removed on owner invalidation", async () => {
  const state = await setup();
  try {
    const unknown = await state.service.generate({ model_id: "kling_o1_text2video", attemptId: ATTEMPT_O1,
      prompt: "A silver kite over a field.", mode: "hd", aspect_ratio: "9:16", video_duration: 10 }).catch((error: unknown) => error);
    assert.ok(unknown instanceof OwnerReviewedNoReferenceT2vServiceError);
    assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    const beforeRecovery = state.counts();
    const listed = state.service.listRecoveries(ATTEMPT_O1);
    assert.equal(listed.length, 1);
    assert.deepEqual({ recovery_id: listed[0]?.recovery_id, model_id: listed[0]?.model_id,
      operation_id: listed[0]?.operation_id, variant_id: listed[0]?.variant_id }, {
      recovery_id: unknown.recovery_id, model_id: "kling_o1_text2video", operation_id: "generate-video",
      variant_id: state.service.getReviewedContract("kling_o1_text2video").variant_id
    });
    await assert.rejects(state.service.reconcile({ model_id: "kling_text2video", attemptId: ATTEMPT_O1, recovery_id: unknown.recovery_id! }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "RECOVERY_NOT_FOUND");
    state.setReady("kling-chat-1");
    const recovered = await state.service.reconcile({ model_id: "kling_o1_text2video", attemptId: ATTEMPT_O1, recovery_id: unknown.recovery_id! });
    assert.equal(recovered.model_id, "kling_o1_text2video");
    assert.equal(state.counts().videoPosts, beforeRecovery.videoPosts);
    assert.ok(state.requests.some((request) => request.method === "GET" && request.url.pathname.includes("/kling-chat-1/")));
    assert.deepEqual(state.costs.slice(-2), [
      { modelId: "kling_o1_text2video", parameters: { version: "", mode: "hd", video_duration: 10 } },
      { modelId: "kling_o1_text2video", parameters: { version: "", mode: "hd", video_duration: 10 } }
    ]);

    const secondUnknown = await state.service.generate({ model_id: "kling_o1_text2video", attemptId: ATTEMPT_O1,
      prompt: "A blue sail crossing a quiet lake.", mode: "hd", aspect_ratio: "16:9", video_duration: 5 }).catch((error: unknown) => error);
    assert.ok(secondUnknown instanceof OwnerReviewedNoReferenceT2vServiceError);
    assert.equal(secondUnknown.code, "OUTCOME_UNKNOWN");
    const postsBeforeInvalidate = state.counts().videoPosts;
    await state.service.invalidateAttempt(ATTEMPT_O1);
    assert.deepEqual(state.service.listRecoveries(ATTEMPT_O1), []);
    await assert.rejects(state.service.reconcile({ model_id: "kling_o1_text2video", attemptId: ATTEMPT_O1, recovery_id: secondUnknown.recovery_id! }));
    assert.equal(state.counts().videoPosts, postsBeforeInvalidate);
  } finally { await state.service.close(); }
});

test("Kling family input rejects an unsupported model and accessor properties before any request", async () => {
  const state = await setup();
  try {
    assert.throws(() => state.service.generate({ model_id: "kling_unknown", attemptId: ATTEMPT_BASE, prompt: "x" } as unknown as Parameters<typeof state.service.generate>[0]),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "INVALID_REQUEST");
    let getterCalls = 0;
    const accessor = Object.defineProperty({ model_id: "kling_text2video", attemptId: ATTEMPT_BASE, prompt: "x" }, "prompt", {
      enumerable: true, get() { getterCalls += 1; return "x"; }
    });
    assert.throws(() => state.service.generate(accessor as unknown as Parameters<typeof state.service.generate>[0]),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "INVALID_REQUEST");
    assert.equal(getterCalls, 0);
    assert.deepEqual(state.counts(), { chatCount: 0, videoPosts: 0 });
    assert.equal(state.requests.length, 0);
  } finally { await state.service.close(); }
});
