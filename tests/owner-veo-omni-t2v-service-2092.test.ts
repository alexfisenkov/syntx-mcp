import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import { OwnerReviewedNoReferenceT2vServiceError } from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import * as ownerServiceModule from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import type { AccountStatusResult } from "../src/application/account-status.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import { createOwnerVeoOmniT2vProfile } from "../src/application/owner-veo-omni-t2v-profile.js";

const ATTEMPT = "link_veo_omni_service_2092_attempt";
const AUTH_BINDING: AuthBinding = Object.freeze({ tenant_id: "veo-omni-2092", subject: "owner-2092" });
const CATALOG_DIRECTORY = resolve(process.cwd(), "catalog");

interface OmniGenerationService {
  getParametersSource(): { identity: { model_id: string } };
  getReviewedContract(): { variant_id: string };
  generate(input: Record<string, unknown>, signal?: AbortSignal): Promise<{ model_id: string; variant_id: string }>;
  reconcile(input: Record<string, unknown>, signal?: AbortSignal): Promise<{ model_id: string; variant_id: string }>;
  listRecoveries(attemptId: string, limit?: number): readonly { recovery_id: string; model_id: string }[];
  getRecoveryDiagnostic(input: Record<string, unknown>): Promise<unknown>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setup(overrides: {
  readonly balances?: readonly (string | null)[];
  readonly quotes?: readonly (number | null)[];
  readonly subscription?: SyntxSubscription;
  readonly requireAccountStatus?: boolean;
  readonly accountValue?: () => AccountStatusResult;
} = {}) {
  let now = Date.now();
  const store = new InMemoryAuthLinkStore(() => now);
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-veo-omni", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-veo-omni-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(provider, store, {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
  });
  await linkService.createAttempt(AUTH_BINDING);
  await linkService.issueHandoff(AUTH_BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(AUTH_BINDING, ATTEMPT)).linked, true);

  let chatCount = 0;
  let videoPosts = 0;
  let quoteReads = 0;
  const requests: Array<{ readonly url: URL; readonly method: string; readonly body: unknown }> = [];
  const ready = new Map<string, boolean>();
  const modelByChat = new Map<string, string>();
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1;
      const chatId = `omni-chat-${chatCount}`;
      const settings = (body as { settings?: { model_type?: string } } | null)?.settings;
      modelByChat.set(chatId, settings?.model_type ?? "veo_omni");
      ready.set(chatId, true);
      return response({ uuid: chatId });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      const generation = body as { chat_id?: string; settings?: { model_type?: string } } | null;
      if (generation?.chat_id && generation.settings?.model_type) modelByChat.set(generation.chat_id, generation.settings.model_type);
      return response({ id: `omni-echo-${videoPosts}` });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/inprogress$/u);
    if (inProgress && method === "GET") {
      const chatId = inProgress[1]!;
      return response(ready.get(chatId) ? [{ message_id: `omni-bot-${chatId}`, object_type: "video", model_type: modelByChat.get(chatId) }] : []);
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/messages$/u);
    if (history && method === "GET") {
      const chatId = history[1]!;
      return response({ messages: [
        { id: `omni-echo-${chatId}`, chat_id: 701, author_id: 12345, message_object: [] },
        { id: `omni-bot-${chatId}`, chat_id: 701, author_id: -1, message_object: [{
          id: `omni-video-${chatId}`, message_id: `omni-bot-${chatId}`, object_type: "video", model_type: modelByChat.get(chatId)
        }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = url.pathname.match(/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u);
    if (message && method === "GET") {
      const chatId = message[1]!;
      return response({ id: message[2], chat_id: 701, author_id: -1, message_object: [{
        id: `omni-video-${chatId}`, message_id: message[2], object_type: "video", model_type: modelByChat.get(chatId),
        completed: true, object_url: `https://r2.syntx.ai/omni/${chatId}.mp4`
      }] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };

  const profile = createOwnerVeoOmniT2vProfile(CATALOG_DIRECTORY);
  const serviceConstructor = (ownerServiceModule as unknown as Record<string, unknown>).OwnerVeoOmniT2vGenerationService;
  assert.equal(typeof serviceConstructor, "function", "Omni T2V generation service facade is missing");
  const service = new (serviceConstructor as new (options: Record<string, unknown>) => OmniGenerationService)({
    profile,
    binding: AUTH_BINDING,
    linkService,
    resolveSubscription: async () => overrides.subscription ?? { active: true, plan_type: "PAID", end_date: null, end_date_kind: null },
    resolveModelAccess: async (_attemptId: string, modelId: string, parameters: Readonly<Record<string, unknown>>): Promise<ModelAccessResult> => {
        const quotes = overrides.quotes ?? [0.125];
        const cost = quotes[Math.min(quoteReads, quotes.length - 1)] ?? null;
        quoteReads += 1;
        return {
          catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
          catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
          model_id: modelId,
          ai_name: "veo3",
          model_type: modelId,
          account_read_live: true,
          parameter_keys: Object.keys(parameters).sort(),
          parameters_redacted: true,
          access: true,
          cost,
          discount_cost: null,
          free_remaining_generations: null,
          limit: null,
          show_warning: false,
          observed_at: new Date(now).toISOString()
        };
      },
    ...(overrides.requireAccountStatus === false ? {} : {
      resolveAccountStatus: async (_attemptId: string): Promise<AccountStatusResult> => {
        const index = accountReads++;
        const balances = overrides.balances ?? ["0.125"];
        return overrides.accountValue?.() ?? {
          balance: { unit: "tokens", available: balances[Math.min(index, balances.length - 1)] ?? null },
          subscription: { active: true, plan_type: "PAID", end_date: null, end_date_kind: null },
          contract_evidence: "PUBLIC_FRONTEND_OBSERVED",
          source_build: "1789134564",
          observed_at: new Date(now).toISOString()
        };
      }
    }),
    resolveChatClient: () => new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
        return operation("synthetic-veo-omni-credential");
      } },
      fetchImpl,
      requestTimeoutMs: 1_000
    }),
    now: () => now,
    wait: async () => undefined,
    videoTimeoutMs: 10
  });
  return { service, linkService, profile, requests, counts: () => ({ chatCount, videoPosts }), accountReads: () => accountReads, quoteReads: () => quoteReads };
}

let accountReads = 0;

const validInput = {
  attemptId: ATTEMPT,
  prompt: "A quiet silver river through a pine forest at dawn.",
  upscale: 2,
  aspect_ratio: "16:9",
  video_duration: 10
} as const;

test("Omni facade runs two affordable preflights and sends the profile's exact text T2V wire request", async () => {
  accountReads = 0;
  const state = await setup();
  try {
    assert.equal(state.service.getParametersSource().identity.model_id, "veo_omni");
    assert.equal(state.service.getReviewedContract().variant_id, "veo-omni-t2v-source-reviewed-no-reference");
    const result = await state.service.generate(validInput);
    assert.equal(result.model_id, "veo_omni");
    assert.equal(result.variant_id, "veo-omni-t2v-source-reviewed-no-reference");
    assert.deepEqual(state.counts(), { chatCount: 1, videoPosts: 1 });
    assert.equal(state.accountReads(), 2);
    const post = state.requests.find((request) => request.method === "POST" && request.url.pathname === "/api/v1/video/generate");
    assert.deepEqual(post?.body, {
      chat_id: "omni-chat-1",
      prompt: validInput.prompt,
      settings: { type: "text", model_type: "veo_omni", file_urls: [], upscale: 2, aspect_ratio: "16:9", video_duration: 10 }
    });
    assert.equal(post?.url.search, "?ai_name=veo3");
  } finally { await state.service.close(); }
});

test("Omni facade stops before chat on insufficient balance and before POST if balance drops at the second gate", async () => {
  accountReads = 0;
  const first = await setup({ balances: ["0.124"] });
  try {
    await assert.rejects(first.service.generate(validInput), (error: unknown) =>
      error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "MODEL_ACCESS_UNAVAILABLE");
    assert.deepEqual(first.counts(), { chatCount: 0, videoPosts: 0 });
    assert.equal(first.accountReads(), 1);
  } finally { await first.service.close(); }

  accountReads = 0;
  const second = await setup({ balances: ["0.125", "0.124"] });
  try {
    await assert.rejects(second.service.generate(validInput), (error: unknown) =>
      error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "MODEL_ACCESS_UNAVAILABLE");
    assert.deepEqual(second.counts(), { chatCount: 1, videoPosts: 0 });
    assert.equal(second.accountReads(), 2);
  } finally { await second.service.close(); }

  accountReads = 0;
  const nullQuote = await setup({ quotes: [0.125, null], balances: ["1", "1"] });
  try {
    await assert.rejects(nullQuote.service.generate(validInput), (error: unknown) =>
      error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "MODEL_ACCESS_UNAVAILABLE");
    assert.deepEqual(nullQuote.counts(), { chatCount: 1, videoPosts: 0 });
    assert.equal(nullQuote.accountReads(), 2);
    assert.equal(nullQuote.quoteReads(), 2);
  } finally { await nullQuote.service.close(); }
});

test("Omni facade retains the independent paid active subscription gate and rejects untrusted configuration", async () => {
  for (const subscription of [
    { active: true, plan_type: "FREE", end_date: null, end_date_kind: null },
    { active: false, plan_type: "PAID", end_date: null, end_date_kind: null }
  ] as const) {
    accountReads = 0;
    const ineligible = await setup({ subscription });
    try {
      await assert.rejects(ineligible.service.generate(validInput), (error: unknown) =>
        error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "SUBSCRIPTION_REQUIRED");
      assert.deepEqual(ineligible.counts(), { chatCount: 0, videoPosts: 0 });
      assert.equal(ineligible.accountReads(), 0);
    } finally { await ineligible.service.close(); }
  }

  const valid = await setup();
  try {
    assert.throws(() => {
      const Constructor = (ownerServiceModule as unknown as Record<string, unknown>).OwnerVeoOmniT2vGenerationService as new (options: Record<string, unknown>) => OmniGenerationService;
      return new Constructor({
        profile: { ...valid.profile },
        binding: AUTH_BINDING,
        linkService: valid.linkService,
        resolveSubscription: async () => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
        resolveModelAccess: async () => ({}) as ModelAccessResult,
        resolveAccountStatus: async () => ({
          balance: { unit: "tokens", available: "1" },
          subscription: { active: true, plan_type: "PAID", end_date: null, end_date_kind: null },
          contract_evidence: "PUBLIC_FRONTEND_OBSERVED",
          source_build: "1789134564",
          observed_at: new Date().toISOString()
        })
      });
    }, /OWNER_REVIEWED_T2V_PROFILE_INVALID/u);

    assert.throws(() => {
      const Constructor = (ownerServiceModule as unknown as Record<string, unknown>).OwnerVeoOmniT2vGenerationService as new (options: Record<string, unknown>) => OmniGenerationService;
      return new Constructor({
        profile: valid.profile,
        binding: AUTH_BINDING,
        linkService: valid.linkService,
        resolveSubscription: async () => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
        resolveModelAccess: async () => ({})
      });
    }, /OWNER_VEO_OMNI_T2V_BUDGET_PREFLIGHT_INVALID/u);
  } finally { await valid.service.close(); }
});
