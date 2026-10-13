import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";
import { OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION } from "../src/application/owner-elevenlabs-generation-parameters.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider, AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const ATTEMPT = "link_elevenlabs_tts_service_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "elevenlabs-tts-service-tenant", subject: "elevenlabs-tts-service-owner" });
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION));
const SERVICE_URL = new URL("../src/application/owner-elevenlabs-tts-generation-service.js", import.meta.url).href;
const PROMPT = "A careful synthetic voice sample.";
const TTS_MODELS = ["eleven_multilingual_v2", "eleven_v3", "eleven_v4", "eleven_v4_turbo"] as const;
const stores = new Set<InMemoryAuthLinkStore>();

afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

interface ServiceResult extends Record<string, unknown> {
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
  readonly recovery_id: string;
  readonly artifacts: readonly Record<string, unknown>[];
  readonly next_offset: number | null;
}
interface ServiceApi {
  generate(input: unknown, signal?: AbortSignal): Promise<ServiceResult>;
  reconcile(input: unknown, signal?: AbortSignal): Promise<ServiceResult>;
  listRecoveries(input: unknown): Promise<readonly Record<string, unknown>[]>;
  getResultPage(input: unknown): Promise<ServiceResult>;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
}
interface FixtureOptions { readonly audioCount?: number; readonly loseAck?: boolean; readonly gatePost?: { entered: () => void; wait: Promise<void> } }

async function fixture(options: FixtureOptions = {}) {
  let now = Date.parse("2026-10-13T02:00:00.000Z");
  let chats = 0;
  let audioPosts = 0;
  let historyGets = 0;
  let resultGets = 0;
  let modelInfoGets = 0;
  let latestChat = "";
  let latestAck = "";
  const counts = { chats: 0, audioPosts: 0, historyGets: 0, resultGets: 0, modelInfoGets: 0, accountReads: 0 };
  const events: Array<{ readonly method: string; readonly pathname: string; readonly body: unknown }> = [];
  const jobs = new Map<string, { readonly prompt: string; readonly model: string; readonly ack: string;
    readonly outputRows: readonly { readonly messageId: string; readonly objects: readonly { readonly id: string; readonly url: string }[] }[] }>();
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-tts-service-challenge", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-tts-service-credential" });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(() => now);
  stores.add(store);
  const linkService = new PerUserLinkService(provider, store, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING);
  await linkService.issueHandoff(BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(BINDING, ATTEMPT)).status, "LINKED");
  const brokerFor = (attemptId: string): SyntxCredentialBroker => ({
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return linkService.useCredential(BINDING, attemptId, (credential) => operation(credential.value));
    }
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push({ method, pathname: url.pathname, body });
    if (url.pathname === "/api/v1/user/balance" && method === "GET") {
      counts.accountReads += 1;
      return Response.json({ balance: "1000" });
    }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      counts.accountReads += 1;
      return Response.json({ active: true, type: "PRO", end_date: "2026-10-14T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      modelInfoGets += 1;
      counts.modelInfoGets += 1;
      return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null,
        limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/audio/elevenlabs/voice_examples" && method === "GET") {
      return Response.json([{ voice_id: "synthetic_private_voice_id", name: "Synthetic TTS voice" }]);
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chats += 1; counts.chats += 1; latestChat = `elevenlabs-tts-service-chat-${chats}`;
      return Response.json({ uuid: latestChat });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      audioPosts += 1; counts.audioPosts += 1;
      const request = body as { readonly chat_uuid: string; readonly prompt: string; readonly settings: { readonly model_type: string } };
      latestAck = `elevenlabs-tts-service-ack-${audioPosts}`;
      const total = options.audioCount ?? 1;
      const outputRows = total === 0 ? [] : Array.from({ length: Math.ceil(total / 64) }, (_, rowIndex) => {
        const offset = rowIndex * 64;
        const length = Math.min(64, total - offset);
        const messageId = `elevenlabs-tts-service-bot-${audioPosts}-${rowIndex + 1}`;
        return Object.freeze({ messageId, objects: Object.freeze(Array.from({ length }, (_, index) => {
          const objectNumber = offset + index + 1;
          return Object.freeze({ id: `elevenlabs-tts-service-object-${audioPosts}-${objectNumber}`,
            url: `https://r2.syntx.ai/generated/tts-${audioPosts}-${objectNumber}.mp3` });
        })) });
      });
      jobs.set(request.chat_uuid, Object.freeze({ prompt: request.prompt, model: request.settings.model_type, ack: latestAck,
        outputRows: Object.freeze(outputRows) }));
      if (options.gatePost) { options.gatePost.entered(); await options.gatePost.wait; }
      if (options.loseAck) throw new Error("synthetic connection lost after POST started");
      return Response.json({ id: latestAck });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      historyGets += 1; counts.historyGets += 1;
      const job = jobs.get(history[1]!);
      assert.ok(job, "history must be scoped to a chat created by the native client");
      const messages: Array<Record<string, unknown>> = [{ id: job.ack, chat_id: 9001, author_id: 41,
        message_object: [{ id: `ack-object-${job.ack}`, message_id: job.ack, object_type: "text",
          object_text: job.prompt, model_type: job.model }] }];
      for (const row of job.outputRows) messages.push({ id: row.messageId, chat_id: 9001, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.messageId, object_type: "audio",
          model_type: job.model, completed: true })) });
      const page = Number(url.searchParams.get("page"));
      const pageSize = 10;
      const pageRows = messages.slice((page - 1) * pageSize, page * pageSize);
      return Response.json({ messages: pageRows, pagination: { page, page_size: pageSize, total_count: messages.length,
        total_pages: Math.ceil(messages.length / pageSize), has_next: page < Math.ceil(messages.length / pageSize), has_previous: page > 1 } });
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      resultGets += 1; counts.resultGets += 1;
      const job = jobs.get(result[1]!);
      assert.ok(job);
      const row = job.outputRows.find((entry) => entry.messageId === result[2]);
      assert.ok(row);
      return Response.json({ id: row.messageId, chat_id: 9001, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.messageId, object_type: "audio",
          object_url: object.url, completed: true, model_type: job.model })),
        created_at: "2026-10-13T02:00:00Z", updated_at: "2026-10-13T02:00:00Z", is_favorite: false });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const voiceClients = new Map<string, SyntxHttpClient>();
  const voiceReferenceService = new OwnerElevenLabsVoiceReferenceService({ binding: BINDING, linkService,
    resolveClient: (attemptId: string) => {
      let client = voiceClients.get(attemptId);
      if (!client) { client = new SyntxHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl }); voiceClients.set(attemptId, client); }
      return client;
    }, now: () => now });
  const voices = await voiceReferenceService.listVoices({ attemptId: ATTEMPT });
  const voiceRef = voices.voices[0]!.voice_ref;
  const chatClients = new Map<string, SyntxChatHttpClient>();
  const resolveChatClient = (attemptId: string) => {
    let client = chatClients.get(attemptId);
    if (!client) {
      client = new SyntxChatHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl, maxResponseBytes: 2 * 1024 * 1024 });
      chatClients.set(attemptId, client);
    }
    return client;
  };
  const createAccountStatusService = (attemptId: string) => new AccountStatusService(new SyntxHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl }), () => now);
  const createModelAccessService = (attemptId: string) => new ModelAccessService(CATALOG,
    new SyntxHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl }), () => now);
  const serviceModule = await import(SERVICE_URL).catch(() => undefined) as Record<string, unknown> | undefined;
  assert.equal(typeof serviceModule?.OwnerElevenLabsTtsGenerationService, "function", "MISSING_OWNER_ELEVENLABS_TTS_GENERATION_SERVICE");
  const Service = serviceModule!.OwnerElevenLabsTtsGenerationService as new (input: Record<string, unknown>) => ServiceApi;
  const service = new Service({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION, resolveChatClient,
    voiceReferenceService, createAccountStatusService, createModelAccessService, now: () => now });
  return {
    service, voiceReferenceService, voiceRef, events, counts, linkService, store, provider,
    get now() { return now; }, advance(ms: number) { now += ms; },
    async createLinkedAttempt(attemptId: string) {
      const nextLinkService = new PerUserLinkService(provider, store, { now: () => now, defaultTtlMs: 30 * 60_000,
        attemptIdGenerator: () => attemptId });
      await nextLinkService.createAttempt(BINDING);
      await nextLinkService.issueHandoff(BINDING, attemptId);
      assert.equal((await nextLinkService.checkAttempt(BINDING, attemptId)).status, "LINKED");
    },
    async close() { await service.close(); await voiceReferenceService.close(); }
  };
}

function request(modelId: typeof TTS_MODELS[number], voiceRef: string, prompt = PROMPT) {
  return Object.freeze({ model_id: modelId, mode: "text_to_speech", prompt, voice_ref: voiceRef,
    stability: 0.5, similarity_boost: 0.5, ...(modelId === "eleven_v4" || modelId === "eleven_v4_turbo" ? { language_code: "auto" } : {}) });
}

test("TTS generation uses each of the four explicit source models with two fresh preflights and honest local result semantics", async () => {
  const f = await fixture();
  try {
    const results: ServiceResult[] = [];
    for (const modelId of TTS_MODELS) results.push(await f.service.generate({ attemptId: ATTEMPT,
      request: request(modelId, f.voiceRef, `${PROMPT} ${modelId}`) }));
    assert.deepEqual(results.map((result) => result.model_id), TTS_MODELS);
    assert.ok(results.every((result) => result.status_semantics === "LOCAL_OBSERVED_AVAILABILITY_ONLY" &&
      result.backend_acceptance === "UNPROVEN" && result.provider_terminal_status === "UNPROVEN"));
    assert.deepEqual(f.counts, { chats: 4, audioPosts: 4, historyGets: 4, resultGets: 4, modelInfoGets: 8, accountReads: 16 });
    const posts = f.events.filter((event) => event.pathname === "/api/v1/audio/generate");
    assert.equal(posts.length, 4);
    assert.deepEqual(posts.map((event) => (event.body as { settings: { model_type: string } }).settings.model_type), TTS_MODELS);
    assert.equal(JSON.stringify(results).includes("synthetic_private_voice_id"), false);
  } finally { await f.close(); }
});

test("TTS result pages preserve all 80 native observations and cached page reads do not issue another GET", async () => {
  const f = await fixture({ audioCount: 80 });
  try {
    const first = await f.service.generate({ attemptId: ATTEMPT, request: request("eleven_v4_turbo", f.voiceRef) });
    assert.equal(first.artifacts.length, 64);
    assert.equal(first.next_offset, 64);
    assert.equal(first.observed_artifact_count, 80);
    const afterGeneration = { ...f.counts };
    const second = await f.service.getResultPage({ attemptId: ATTEMPT, recovery_id: first.recovery_id, offset: 64 });
    assert.equal(second.artifacts.length, 16);
    assert.equal(second.offset, 64);
    assert.equal(second.next_offset, null);
    assert.deepEqual(f.counts, afterGeneration, "page projection must be memory-only");
    assert.equal(new Set([...first.artifacts, ...second.artifacts].map((item) => item.message_object_id)).size, 80);
  } finally { await f.close(); }
});

test("uncertain TTS POST remains reconcilable past the voice reference TTL and never replays", async () => {
  const f = await fixture({ loseAck: true });
  try {
    const input = { attemptId: ATTEMPT, request: request("eleven_v4_turbo", f.voiceRef) };
    await assert.rejects(f.service.generate(input), (error: unknown) => error instanceof Error &&
      "code" in error && error.code === "OUTCOME_UNKNOWN" && "recovery_id" in error && typeof error.recovery_id === "string");
    const recovery = (await f.service.listRecoveries({ attemptId: ATTEMPT }))[0];
    assert.ok(recovery);
    f.advance(16 * 60_000);
    await assert.rejects(f.service.generate(input), (error: unknown) => error instanceof Error &&
      "code" in error && error.code === "INTENT_ALREADY_CLAIMED");
    const before = { ...f.counts };
    const reconciled = await f.service.reconcile({ attemptId: ATTEMPT, recovery_id: recovery.recovery_id });
    assert.equal(reconciled.status, "completed");
    assert.equal(reconciled.artifacts.length, 1);
    assert.equal(f.counts.audioPosts, before.audioPosts);
    assert.equal(f.counts.chats, before.chats);
    assert.equal(f.counts.historyGets, before.historyGets + 1);
    assert.equal(f.counts.resultGets, before.resultGets + 1);
  } finally { await f.close(); }
});

test("closing the TTS generation service leaves the runtime-owned voice resolver open", async () => {
  const f = await fixture();
  try {
    await f.service.close();
    const voices = await f.voiceReferenceService.listVoices({ attemptId: ATTEMPT });
    assert.equal(voices.status, "available");
    assert.equal(voices.voices.length, 1);
  } finally { await f.voiceReferenceService.close(); }
});

test("reconciling a completed TTS recovery revalidates the current linked principal before returning cached URLs", async () => {
  const f = await fixture();
  try {
    const result = await f.service.generate({ attemptId: ATTEMPT, request: request("eleven_v4_turbo", f.voiceRef) });
    await f.linkService.revoke(BINDING, ATTEMPT);
    const before = { ...f.counts };
    await assert.rejects(f.service.reconcile({ attemptId: ATTEMPT, recovery_id: result.recovery_id }));
    assert.deepEqual(f.counts, before, "a revoked principal cannot read a cached URL or trigger a recovery GET");
  } finally { await f.close(); }
});

test("same binding on a new linked attempt cannot receive another attempt's cached TTS result", async () => {
  const f = await fixture();
  try {
    await f.service.generate({ attemptId: ATTEMPT, request: request("eleven_v4_turbo", f.voiceRef) });
    const secondAttempt = "link_elevenlabs_tts_service_new_attempt_0123456789";
    await f.createLinkedAttempt(secondAttempt);
    const voices = await f.voiceReferenceService.listVoices({ attemptId: secondAttempt });
    const secondVoiceRef = voices.voices[0]!.voice_ref;
    const before = { ...f.counts };
    await assert.rejects(f.service.generate({ attemptId: secondAttempt, request: request("eleven_v4_turbo", secondVoiceRef) }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INTENT_ALREADY_CLAIMED");
    assert.equal(f.counts.audioPosts, before.audioPosts);
    assert.equal(f.counts.chats, before.chats);
    assert.equal(f.counts.historyGets, before.historyGets);
    assert.equal(f.counts.resultGets, before.resultGets);
  } finally { await f.close(); }
});
