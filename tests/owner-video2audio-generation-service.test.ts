import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { createOwnerVideo2AudioSourceProfile } from "../src/application/owner-video2audio-source-profile.js";
import { OwnerVideo2AudioOriginalReferenceService } from "../src/application/owner-video2audio-original-reference-service.js";
import { createOwnerVideo2AudioRequestPreparer } from "../src/application/owner-video2audio-request-preparer.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";

const MODULE_URL = new URL("../src/application/owner-video2audio-generation-service.js", import.meta.url).href;
const serviceModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPT = "link_video2audio_generation_owner_0123456789";
const FOREIGN_ATTEMPT = "link_video2audio_generation_foreign_9876543210";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "video2audio-generation-tenant", subject: "video2audio-generation-owner" });
const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);
const ORIGINAL_URL = "https://r2.syntx.ai/video2audio/generation-original.mp4";
const PROMPT = "Create a soft instrumental track from this video.";
const stores = new Set<InMemoryAuthLinkStore>();
afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

interface ServiceApi {
  generate(input: unknown, signal?: AbortSignal): Promise<Record<string, any>>;
  reconcile(input: unknown, signal?: AbortSignal): Promise<Record<string, any>>;
  listRecoveries(input: unknown): Promise<readonly Record<string, any>[]>;
  getResultPage(input: unknown): Promise<Record<string, any>>;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function brokerFor(linkService: PerUserLinkService, attemptId: string): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return linkService.useCredential(BINDING, attemptId, (credential) => operation(credential.value));
  } };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function makeVideo2AudioFixture(options: { readonly loseGenerationAck?: boolean; readonly activeSubscription?: boolean;
  readonly modelAccessAllowed?: boolean; readonly balance?: string; readonly subscriptionEndDate?: string;
  readonly revokeAfterBalance?: boolean;
  readonly resultReadyAfterResultGets?: number;
  readonly outputCount?: number; readonly revokeAfterHistoryGet?: boolean;
  readonly generationGate?: { readonly entered: () => void; readonly aborted: () => void } } = {}) {
  let now = Date.parse("2026-10-13T04:00:00.000Z"), nextAttemptIndex = 0;
  const attemptQueue = [ATTEMPT, FOREIGN_ATTEMPT];
  const counts = { balanceGets: 0, subscriptionGets: 0, modelAccessGets: 0, uploadPosts: 0, chatPosts: 0,
    generationPosts: 0, historyGets: 0, resultGets: 0, authorizeCalls: 0, nativeClientResolutions: 0 };
  const events: string[] = [];
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: `synthetic-${attemptQueue[nextAttemptIndex - 1]}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-video2audio-generation-credential" });
      return { state: "LINKED" };
    }
  };
  const linkStore = new InMemoryAuthLinkStore(() => now); stores.add(linkStore);
  const linkService = new PerUserLinkService(provider, linkStore, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => attemptQueue[nextAttemptIndex++] ?? `link_video2audio_extra_${nextAttemptIndex}` });
  for (const attemptId of [ATTEMPT, FOREIGN_ATTEMPT]) {
    await linkService.createAttempt(BINDING);
    await linkService.issueHandoff(BINDING, attemptId);
    await linkService.checkAttempt(BINDING, attemptId);
  }
  const profile = createOwnerVideo2AudioSourceProfile();
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push(`${method} ${url.pathname}`);
    if (url.origin !== "https://api.syntx.ai") throw new Error("Unexpected synthetic test origin");
    if (url.pathname === "/api/v1/user/balance" && method === "GET") {
      counts.balanceGets += 1;
      if (options.revokeAfterBalance && counts.balanceGets === 1) await linkStore.revoke(BINDING, ATTEMPT);
      return jsonResponse({ balance: options.balance ?? "1000" });
    }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      counts.subscriptionGets += 1;
      return jsonResponse({ active: options.activeSubscription ?? true, type: "PRO",
        end_date: options.subscriptionEndDate ?? "2099-12-31T00:00:00Z" });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      counts.modelAccessGets += 1;
      assert.deepEqual(url.searchParams.getAll("ai_name"), ["video2audio"]);
      assert.deepEqual(url.searchParams.getAll("model_type"), ["video2audio"]);
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type"]);
      return jsonResponse({ access: options.modelAccessAllowed ?? true, cost: 4, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      counts.uploadPosts += 1;
      const form = init.body as FormData;
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), MP4);
      return jsonResponse({ total: 1, successful: 1, failed: 0, duplicates: 0,
        files: [{ filename: "original.mp4", url: ORIGINAL_URL, status: "success", content_type: "video/mp4", size: MP4.byteLength, duration: 5.64 }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chatPosts += 1;
      assert.deepEqual(body, { scope: "audio", title: (body as { title: string }).title });
      return jsonResponse({ uuid: `video2audio-generation-chat-${counts.chatPosts}` });
    }
    const chatId = "video2audio-generation-chat-1";
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      counts.generationPosts += 1;
      assert.equal(url.search, "?ai_name=video2audio");
      assert.deepEqual(body, { chat_uuid: chatId, prompt: PROMPT, settings: { model_type: "video2audio", mode: "generate",
        duration: 5.64, negative_prompt: "", seed: 0, file_urls: [{ type: "video", url: ORIGINAL_URL }] } });
      if (options.generationGate) {
        options.generationGate.entered();
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) throw new Error("Native generation signal was not forwarded");
          if (signal.aborted) { options.generationGate!.aborted(); reject(new DOMException("aborted", "AbortError")); return; }
          signal.addEventListener("abort", () => { options.generationGate!.aborted(); reject(new DOMException("aborted", "AbortError")); }, { once: true });
        });
      }
      if (options.loseGenerationAck) throw new Error("Synthetic transport lost the possible generation ACK");
      return jsonResponse({ id: "video2audio-generation-ack-1" });
    }
    if (url.pathname === `/api/v1/chats/${chatId}/messages` && method === "GET") {
      counts.historyGets += 1;
      if (options.revokeAfterHistoryGet && counts.historyGets === 1) await linkStore.revoke(BINDING, ATTEMPT);
      const outputCount = options.outputCount ?? 2;
      const outputMessages = Array.from({ length: Math.ceil(outputCount / 64) }, (_unused, pageIndex) => {
        const firstIndex = pageIndex * 64;
        const objectCount = Math.min(64, outputCount - firstIndex);
        const messageId = `video2audio-generation-bot-result-${pageIndex + 1}`;
        return { id: messageId, chat_id: 72401, author_id: -1, message_object: Array.from({ length: objectCount }, (_item, index) => {
          const ordinal = firstIndex + index + 1;
          const type = ordinal % 2 === 0 ? "audio" : "video";
          return { id: `video2audio-generation-object-${ordinal}`, message_id: messageId, object_type: type, model_type: "video2audio" };
        }) };
      });
      return jsonResponse({ messages: [
        { id: "video2audio-generation-ack-1", chat_id: 72401, author_id: 4821, message_object: [{ id: "video2audio-generation-ack-text",
          message_id: "video2audio-generation-ack-1", object_type: "text", object_text: PROMPT, model_type: "video2audio" }] },
        ...outputMessages
      ], pagination: { page: 1, page_size: 10, total_count: 1 + outputMessages.length, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMessageMatch = /^\/api\/v1\/chats\/video2audio-generation-chat-1\/(video2audio-generation-bot-result-\d+)$/u.exec(url.pathname);
    if (resultMessageMatch && method === "GET") {
      counts.resultGets += 1;
      const messageId = resultMessageMatch[1]!;
      const outputCount = options.outputCount ?? 2;
      const pageIndex = Number(messageId.slice("video2audio-generation-bot-result-".length)) - 1;
      const firstIndex = pageIndex * 64;
      const objectCount = Math.min(64, Math.max(0, outputCount - firstIndex));
      return jsonResponse({ id: messageId, chat_id: 72401, author_id: -1, message_object: Array.from({ length: objectCount }, (_item, index) => {
        const ordinal = firstIndex + index + 1;
        const type = ordinal % 2 === 0 ? "audio" : "video";
        return { id: `video2audio-generation-object-${ordinal}`, message_id: messageId, object_type: type, model_type: "video2audio",
          completed: options.resultReadyAfterResultGets === undefined || counts.resultGets > options.resultReadyAfterResultGets,
          object_url: type === "audio" ? `https://r2.syntx.ai/video2audio/result-${ordinal}.m4a` : `https://r2.syntx.ai/video2audio/result-${ordinal}.mp4` };
      }) });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const clients = new Map<string, SyntxChatHttpClient>();
  const resolveClient = (attemptId: string): SyntxChatHttpClient => {
    counts.nativeClientResolutions += 1;
    const existing = clients.get(attemptId);
    if (existing) return existing;
    const client = new SyntxChatHttpClient({ credentialBroker: brokerFor(linkService, attemptId), fetchImpl });
    clients.set(attemptId, client); return client;
  };
  const originalReferenceService = new OwnerVideo2AudioOriginalReferenceService({ profile, binding: BINDING,
    linkService, resolveClient, now: () => now });
  const preparer = createOwnerVideo2AudioRequestPreparer({ profile, originalReferenceService, now: () => now });
  const serviceOptions = {
    profile, preparer, binding: BINDING, linkService,
    resolveCurrentAccountLimits: async (attemptId: string, signal?: AbortSignal) => {
      const client = new SyntxHttpClient({ credentialBroker: brokerFor(linkService, attemptId), fetchImpl });
      const accountService = new AccountStatusService(client, () => now);
      return Reflect.apply(AccountStatusService.prototype.getAccountStatus, accountService, [signal]);
    },
    resolveModelAccess: async (attemptId: string, request: unknown, signal?: AbortSignal) => {
      const client = new SyntxHttpClient({ credentialBroker: brokerFor(linkService, attemptId), fetchImpl });
      const accessService = new ModelAccessService(profile.catalog, client, () => now);
      return Reflect.apply(ModelAccessService.prototype.getModelAccess, accessService, [request, signal]);
    },
    now: () => now, timeoutMs: 60_000, pollDelayMs: 0, maxPollAttempts: 1
  };
  const GenerationService = serviceModule?.OwnerVideo2AudioGenerationService as (new (options: unknown) => ServiceApi) | undefined;
  assert.equal(typeof GenerationService, "function", "MISSING_OWNER_VIDEO2AUDIO_GENERATION_SERVICE");
  const service = new GenerationService!(serviceOptions);
  return { service, serviceOptions, preparer, originalReferenceService, linkService, clients, counts, events,
    get now() { return now; }, advance(ms: number) { now += ms; },
    async upload(attemptId = ATTEMPT) {
      return originalReferenceService.uploadOriginal({ attemptId, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 });
    },
    async close() { if (typeof service.close === "function") await service.close(); await preparer.close(); await originalReferenceService.close(); }
  };
}

test("Video2Audio generation service exposes an owner-only service factory", () => {
  assert.ok(serviceModule, "MISSING_OWNER_VIDEO2AUDIO_GENERATION_SERVICE_MODULE");
  assert.equal(typeof serviceModule.OwnerVideo2AudioGenerationService, "function",
    "MISSING_OWNER_VIDEO2AUDIO_GENERATION_SERVICE");
  assert.equal(typeof serviceModule.isOwnerVideo2AudioGenerationService, "function",
    "MISSING_OWNER_VIDEO2AUDIO_GENERATION_SERVICE_GUARD");
});

test("generation performs two fresh account/model gates then one exact native POST and returns mixed video/audio results", async () => {
  const fixture = await makeVideo2AudioFixture({ balance: "0" });
  try {
    const uploaded = await fixture.upload();
    const result = await fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT, video_original_handle: uploaded.video_original_handle });
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.deepEqual(result.artifacts.map((artifact: Record<string, unknown>) => artifact.object_type), ["video", "audio"]);
    assert.equal(fixture.counts.balanceGets, 2);
    assert.equal(fixture.counts.subscriptionGets, 2);
    assert.equal(fixture.counts.modelAccessGets, 2);
    assert.equal(fixture.counts.uploadPosts, 1);
    assert.equal(fixture.counts.chatPosts, 1);
    assert.equal(fixture.counts.generationPosts, 1);
    assert.equal(fixture.counts.historyGets, 1);
    assert.equal(fixture.counts.resultGets, 1);
    const listedResults = await fixture.service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(listedResults.length, 1, "completed recovery remains discoverable if the caller lost its result response");
    assert.equal(listedResults[0]?.recovery_id, result.recovery_id);
    assert.equal(listedResults[0]?.status, "completed");
    for (const privateValue of [PROMPT, uploaded.video_original_handle, ORIGINAL_URL, "video2audio-generation-chat-1",
      "video2audio-generation-ack-1", BINDING.subject]) {
      assert.equal(JSON.stringify(result).includes(privateValue), false, `public result leaked ${privateValue}`);
    }
    assert.ok(fixture.events.indexOf("GET /api/v2/get_model_info") < fixture.events.indexOf("POST /api/v1/chats"));
    const accessIndexes = fixture.events.flatMap((event, index) => event === "GET /api/v2/get_model_info" ? [index] : []);
    const chatIndex = fixture.events.indexOf("POST /api/v1/chats");
    const generationIndex = fixture.events.indexOf("POST /api/v1/audio/generate");
    assert.equal(accessIndexes.length, 2);
    assert.ok(accessIndexes[0]! < chatIndex && chatIndex < accessIndexes[1]! && accessIndexes[1]! < generationIndex,
      "both fresh model-access reads must bracket chat creation before the one generation POST");
  } finally { await fixture.close(); }
});

test("an inactive current subscription denies before chat creation or generation POST", async () => {
  const fixture = await makeVideo2AudioFixture({ activeSubscription: false });
  try {
    const uploaded = await fixture.upload();
    await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT,
      video_original_handle: uploaded.video_original_handle }),
    (error: unknown) => errorCode(error) === "SUBSCRIPTION_REQUIRED");
    assert.equal(fixture.counts.generationPosts, 0);
    assert.equal(fixture.counts.chatPosts, 0);
    assert.equal(fixture.counts.modelAccessGets, 1);
  } finally { await fixture.close(); }
});

test("an expired current subscription denies before chat creation or generation POST", async () => {
  const fixture = await makeVideo2AudioFixture({ subscriptionEndDate: "2001-01-01T00:00:00Z" });
  try {
    const uploaded = await fixture.upload();
    await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT,
      video_original_handle: uploaded.video_original_handle }), (error: unknown) => errorCode(error) === "SUBSCRIPTION_REQUIRED");
    assert.equal(fixture.counts.chatPosts, 0);
    assert.equal(fixture.counts.generationPosts, 0);
  } finally { await fixture.close(); }
});

test("a live model-access denial blocks chat mutation and the generation POST", async () => {
  const fixture = await makeVideo2AudioFixture({ modelAccessAllowed: false });
  try {
    const uploaded = await fixture.upload();
    await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT,
      video_original_handle: uploaded.video_original_handle }), (error: unknown) => errorCode(error) === "PREFLIGHT_FAILED");
    assert.equal(fixture.counts.modelAccessGets, 1);
    assert.equal(fixture.counts.chatPosts, 0);
    assert.equal(fixture.counts.generationPosts, 0);
  } finally { await fixture.close(); }
});

test("principal loss during the first account read is reported before chat creation", async () => {
  const fixture = await makeVideo2AudioFixture({ revokeAfterBalance: true });
  try {
    const uploaded = await fixture.upload();
    await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT,
      video_original_handle: uploaded.video_original_handle }), (error: unknown) => errorCode(error) === "PRINCIPAL_NOT_LINKED");
    assert.equal(fixture.counts.chatPosts, 0);
    assert.equal(fixture.counts.generationPosts, 0);
  } finally { await fixture.close(); }
});

test("a lost generation ACK stays listable and PENDING without a fabricated context or a second POST", async () => {
  const fixture = await makeVideo2AudioFixture({ loseGenerationAck: true });
  try {
    const uploaded = await fixture.upload();
    let failure: unknown;
    try {
      await fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT, video_original_handle: uploaded.video_original_handle });
    } catch (error) { failure = error; }
    assert.equal(errorCode(failure), "OUTCOME_UNKNOWN");
    const recoveryId = (failure as { recovery_id: string }).recovery_id;
    const listed = await fixture.service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.recovery_id, recoveryId);
    assert.equal(listed[0]?.status, "outcome_unknown");
    const pending = await fixture.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(pending.status, "PENDING");
    assert.equal(pending.diagnostic.owner_ack_status, "MISSING");
    assert.equal(pending.diagnostic.result_get_calls, 0);
    await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT,
      video_original_handle: uploaded.video_original_handle }), (error: unknown) => errorCode(error) === "OUTCOME_UNKNOWN");
    assert.equal(fixture.counts.generationPosts, 1);
    assert.equal(fixture.counts.historyGets, 0, "native lost-ACK state mints no result contexts and performs no GET without ACK");
    assert.equal(fixture.counts.resultGets, 0);
  } finally { await fixture.close(); }
});

test("known-ACK recovery still GETs with the captured client after the original candidate TTL", async () => {
  const fixture = await makeVideo2AudioFixture({ resultReadyAfterResultGets: 1 });
  try {
    const uploaded = await fixture.upload();
    const first = await fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT, video_original_handle: uploaded.video_original_handle });
    assert.equal(first.status, "PARTIAL");
    assert.equal(first.artifacts.length, 0);
    assert.equal(fixture.counts.generationPosts, 1);
    const clientResolutionsBeforeRecovery = fixture.counts.nativeClientResolutions;
    fixture.advance(16 * 60_000);
    const recovered = await fixture.service.reconcile({ attemptId: ATTEMPT, recovery_id: first.recovery_id });
    assert.equal(recovered.status, "COMPLETE");
    assert.deepEqual(recovered.artifacts.map((artifact: Record<string, unknown>) => artifact.object_type), ["video", "audio"]);
    assert.equal(fixture.counts.generationPosts, 1, "recovery is GET-only after the generation POST may have happened");
    assert.equal(fixture.counts.chatPosts, 1);
    assert.equal(fixture.counts.nativeClientResolutions, clientResolutionsBeforeRecovery,
      "reconciliation must use the exact upload-time client, not resolve a replacement");
    assert.equal(fixture.counts.resultGets, 2);
  } finally { await fixture.close(); }
});

test("revoke clears private recovery state but a stable semantic tombstone blocks replay after relink", async () => {
  const fixture = await makeVideo2AudioFixture();
  try {
    const uploaded = await fixture.upload(ATTEMPT);
    const completed = await fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT, video_original_handle: uploaded.video_original_handle });
    assert.equal(completed.status, "COMPLETE");
    await fixture.linkService.revoke(BINDING, ATTEMPT);
    await fixture.service.invalidateAttempt(ATTEMPT);
    assert.deepEqual(await fixture.service.listRecoveries({ attemptId: FOREIGN_ATTEMPT }), []);
    const relinkedUpload = await fixture.upload(FOREIGN_ATTEMPT);
    await assert.rejects(() => fixture.service.generate({ attemptId: FOREIGN_ATTEMPT, prompt: PROMPT,
      video_original_handle: relinkedUpload.video_original_handle }), (error: unknown) => errorCode(error) === "INTENT_ALREADY_CLAIMED");
    assert.equal(fixture.counts.chatPosts, 1);
    assert.equal(fixture.counts.generationPosts, 1);
    assert.equal(fixture.counts.resultGets, 1);
  } finally { await fixture.close(); }
});

test("128 uncertain intents are nonevict and the 129th fails before native chat or generation POST", async () => {
  const fixture = await makeVideo2AudioFixture({ loseGenerationAck: true });
  try {
    const uploaded = await fixture.upload();
    for (let index = 0; index < 128; index += 1) {
      await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, prompt: `${PROMPT} Variation ${index}`,
        video_original_handle: uploaded.video_original_handle }), (error: unknown) => errorCode(error) === "OUTCOME_UNKNOWN");
    }
    assert.equal(fixture.counts.chatPosts, 128);
    assert.equal(fixture.counts.generationPosts, 128);
    await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, prompt: `${PROMPT} Variation 128`,
      video_original_handle: uploaded.video_original_handle }),
    (error: unknown) => errorCode(error) === "SERVICE_BUSY" || errorCode(error) === "CAPACITY_EXCEEDED");
    assert.equal(fixture.counts.chatPosts, 128, "the 129th intent is rejected before creating a native chat");
    assert.equal(fixture.counts.generationPosts, 128);
    const recoveries = await fixture.service.listRecoveries({ attemptId: ATTEMPT, limit: 128 });
    assert.equal(recoveries.length, 128);
    assert.ok(recoveries.every((item) => item.status === "outcome_unknown"));
  } finally { await fixture.close(); }
});

test("caller cancellation after a possible POST preserves a listable GET-only recovery without replay", async () => {
  let markEntered!: () => void, markAborted!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const aborted = new Promise<void>((resolve) => { markAborted = resolve; });
  const fixture = await makeVideo2AudioFixture({ generationGate: { entered: markEntered, aborted: markAborted } });
  try {
    const uploaded = await fixture.upload();
    const controller = new AbortController();
    const pending = fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT, video_original_handle: uploaded.video_original_handle }, controller.signal);
    await entered;
    controller.abort();
    await aborted;
    let failure: unknown;
    try { await pending; } catch (error) { failure = error; }
    assert.equal(errorCode(failure), "OUTCOME_UNKNOWN");
    const recoveryId = (failure as { recovery_id: string }).recovery_id;
    const recoveries = await fixture.service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0]?.recovery_id, recoveryId);
    assert.equal(fixture.counts.generationPosts, 1);
    await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT,
      video_original_handle: uploaded.video_original_handle }), (error: unknown) => errorCode(error) === "OUTCOME_UNKNOWN");
    assert.equal(fixture.counts.generationPosts, 1);
  } finally { await fixture.close(); }
});

test("revocation after history GET prevents result GET and native invalidation clears the attempt context", async () => {
  const fixture = await makeVideo2AudioFixture({ revokeAfterHistoryGet: true });
  try {
    const uploaded = await fixture.upload();
    let failure: unknown;
    try { await fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT, video_original_handle: uploaded.video_original_handle }); }
    catch (error) { failure = error; }
    assert.equal(errorCode(failure), "OUTCOME_UNKNOWN");
    assert.equal(fixture.counts.historyGets, 1);
    assert.equal(fixture.counts.resultGets, 0, "post-GET owner reauthorization denies result access after revoke");
    await fixture.service.invalidateAttempt(ATTEMPT);
    await fixture.originalReferenceService.invalidateAttempt(ATTEMPT);
    assert.equal(fixture.clients.get(ATTEMPT)?.invalidateVideo2AudioAttempt(ATTEMPT), 0,
      "service invalidation removes the native per-attempt state");
    assert.equal(fixture.counts.generationPosts, 1);
  } finally { await fixture.close(); }
});

test("observed artifacts page locally as 64 plus the remainder without more provider GETs", async () => {
  const fixture = await makeVideo2AudioFixture({ outputCount: 65 });
  try {
    const uploaded = await fixture.upload();
    const complete = await fixture.service.generate({ attemptId: ATTEMPT, prompt: PROMPT, video_original_handle: uploaded.video_original_handle });
    assert.equal(complete.status, "COMPLETE");
    assert.equal(complete.observed_artifact_count, 65);
    assert.equal(complete.artifacts.length, 64);
    assert.equal(complete.next_offset, 64);
    const before = { historyGets: fixture.counts.historyGets, resultGets: fixture.counts.resultGets };
    const finalPage = await fixture.service.getResultPage({ attemptId: ATTEMPT, recovery_id: complete.recovery_id, offset: 64 });
    assert.equal(finalPage.offset, 64);
    assert.equal(finalPage.artifacts.length, 1);
    assert.equal(finalPage.next_offset, null);
    assert.deepEqual({ historyGets: fixture.counts.historyGets, resultGets: fixture.counts.resultGets }, before,
      "public artifact pagination is local and must not issue more native GETs");
    assert.equal(new Set([...complete.artifacts, ...finalPage.artifacts].map((artifact: Record<string, unknown>) => artifact.url)).size, 65);
  } finally { await fixture.close(); }
});
