import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  SyntxChatHttpClient,
  isOwnerElevenLabsTtsAudioResultMessageContext,
  isOwnerElevenLabsTtsChatContext
} from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerElevenLabsTtsRequestPreparer } from "../src/application/owner-elevenlabs-tts-request-preparer.js";
import { OwnerElevenLabsTtsOneShotPolicy } from "../src/application/owner-elevenlabs-tts-one-shot-policy.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";

const ATTEMPT = "link_elevenlabs_tts_native_0123456789";
const BINDING = Object.freeze({ tenant_id: "elevenlabs-native-tenant", subject: "elevenlabs-native-owner" });
const CREDENTIAL = "synthetic-elevenlabs-native-credential";
const VOICE_ID = "provider_voice_native_private";
const PROMPT = "Подготовь техническую озвучку: проверка передачи голоса.";
const stores = new Set<InMemoryAuthLinkStore>();
const methods = Object.freeze({
  create: "createOwnerElevenLabsTtsChat",
  start: "startElevenLabsTtsWithOwnedCandidate",
  list: "listOwnedElevenLabsTtsCandidates",
  result: "getOwnedElevenLabsTtsResult"
});

afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

interface NativeApi {
  createOwnerElevenLabsTtsChat(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  startElevenLabsTtsWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  listOwnedElevenLabsTtsCandidates(chat: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getOwnedElevenLabsTtsResult(context: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

function native(client: SyntxChatHttpClient): NativeApi { return client as unknown as NativeApi; }
function code(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected;
}

async function fixture(options: { loseAck?: boolean; modelId?: string;
  historyBody?: (chatUuid: string, echoId: string | null, page: number, modelId: string) => unknown;
  resultBody?: (messageId: string, modelId: string) => unknown } = {}) {
  let now = Date.parse("2026-10-13T02:00:00.000Z");
  const modelId = options.modelId ?? "eleven_v4_turbo";
  const events: Array<{ method: string; pathname: string; query: string; body: unknown }> = [];
  let chatCount = 0, audioPosts = 0, historyGets = 0, resultGets = 0;
  let latestChatUuid = "", latestAck = "";
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-native-tts-challenge", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: CREDENTIAL });
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
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return linkService.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
    }
  };
  const audioObject = (messageId: string, objectId: string, model = modelId) => ({
    id: objectId, message_id: messageId, object_type: "audio", object_url: "https://r2.syntx.ai/generated/test.mp3",
    completed: true, model_type: model
  });
  const history = (chatUuid: string, echoId: string | null, page: number) => options.historyBody?.(chatUuid, echoId, page, modelId) ?? ({
    messages: [
      { id: echoId ?? "tts-owner-ack-lost-response", chat_id: 9001, author_id: 42,
        message_object: [{ id: "tts-owner-text-object", message_id: echoId ?? "tts-owner-ack-lost-response",
          object_type: "text", object_text: PROMPT, model_type: modelId }] },
      { id: "tts-bot-message-1", chat_id: 9001, author_id: -1, message_object: [audioObject("tts-bot-message-1", "tts-audio-object-1")] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push({ method, pathname: url.pathname, query: url.search, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1; latestChatUuid = `owner-tts-audio-chat-${chatCount}`;
      return Response.json({ uuid: latestChatUuid });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      audioPosts += 1; latestAck = `tts-owner-ack-${audioPosts}`;
      if (options.loseAck) throw new Error("synthetic connection lost after POST start");
      return Response.json({ id: latestAck });
    }
    if (url.pathname.endsWith("/messages") && method === "GET") {
      historyGets += 1;
      return Response.json(history(url.pathname.split("/")[4]!, latestAck || null, Number(url.searchParams.get("page"))));
    }
    const message = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (message && method === "GET") {
      resultGets += 1;
      return Response.json(options.resultBody?.(message[2]!, modelId) ?? { id: message[2], chat_id: 9001, author_id: -1,
        message_object: [audioObject(message[2]!, "tts-audio-object-1")],
        created_at: "2026-10-13T02:00:00Z", is_favorite: false });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const voiceClient = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () => Response.json([
    { voice_id: VOICE_ID, name: "Synthetic native voice" }
  ]) });
  const voiceReferenceService = new OwnerElevenLabsVoiceReferenceService({ binding: BINDING, linkService,
    resolveClient: () => voiceClient, now: () => now });
  const voiceList = await voiceReferenceService.listVoices({ attemptId: ATTEMPT });
  const voiceRef = String((voiceList.voices as unknown as Array<Record<string, unknown>>)[0]!.voice_ref);
  const principal = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
  const preparer = new OwnerElevenLabsTtsRequestPreparer({ voiceReferenceService, now: () => now });
  const oneShotPolicy = new OwnerElevenLabsTtsOneShotPolicy({ preparer, now: () => now });
  const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal, request: {
    model_id: modelId, mode: "text_to_speech", prompt: PROMPT, voice_ref: voiceRef,
    stability: 0.5, similarity_boost: 0.5,
    ...(["eleven_v4", "eleven_v4_turbo"].includes(modelId) ? { language_code: "auto" } : {})
  } });
  const permit = oneShotPolicy.createPermit({ candidate, attemptId: ATTEMPT, principal });
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const otherClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  return {
    client, api: native(client), otherClient, otherApi: native(otherClient), candidate, permit, preparer, oneShotPolicy, principal, linkService,
    get now() { return now; }, set now(value: number) { now = value; },
    get events() { return events; },
    get counts() { return { chats: chatCount, posts: audioPosts, history: historyGets, results: resultGets }; },
    get latestChatUuid() { return latestChatUuid; },
    async close() { oneShotPolicy.close(); preparer.close(); await voiceReferenceService.close(); }
  };
}

test("TTS native owner seam exposes the four purpose-built methods", () => {
  for (const method of Object.values(methods)) assert.equal(typeof (SyntxChatHttpClient.prototype as unknown as Record<string, unknown>)[method], "function");
});

test("native owner path creates only a fresh audio chat and sends one exact private TTS body", async () => {
  const f = await fixture();
  try {
    const chat = await f.api.createOwnerElevenLabsTtsChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    assert.equal(chat.chat_uuid, "owner-tts-audio-chat-1");
    assert.equal(chat.model_id, "eleven_v4_turbo");
    assert.equal(isOwnerElevenLabsTtsChatContext(chat, f.client), true);
    assert.equal(isOwnerElevenLabsTtsChatContext(chat, f.otherClient), false);
    assert.equal(JSON.stringify(chat).includes(VOICE_ID), false);
    const receipt = await f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate,
      permit: f.permit, preparer: f.preparer, oneShotPolicy: f.oneShotPolicy,
      principal: f.principal, attemptId: ATTEMPT });
    assert.deepEqual(receipt, { chat_uuid: "owner-tts-audio-chat-1", message_id: "tts-owner-ack-1" });
    assert.equal(f.counts.posts, 1);
    const chatCreate = f.events.find(({ pathname }) => pathname === "/api/v1/chats");
    assert.deepEqual({ method: chatCreate?.method, scope: (chatCreate?.body as { scope?: unknown } | undefined)?.scope },
      { method: "POST", scope: "audio" });
    assert.deepEqual(f.events.filter(({ pathname }) => pathname === "/api/v1/audio/generate").map(({ method, query, body }) =>
      ({ method, query, body })), [{ method: "POST", query: "?ai_name=elevenlabs", body: {
        chat_uuid: "owner-tts-audio-chat-1", prompt: PROMPT, settings: {
          model_type: "eleven_v4_turbo", mode: "text_to_speech", voice_id: VOICE_ID, chars_count: PROMPT.length,
          stability: 0.5, similarity_boost: 0.5, file_urls: [], language_code: "auto"
        }
      } }]);
    assert.equal(JSON.stringify(chat).includes("file_urls"), false);
    await assert.rejects(f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate,
      permit: f.permit, preparer: f.preparer, oneShotPolicy: f.oneShotPolicy,
      principal: f.principal, attemptId: ATTEMPT }), (error: unknown) => code(error, "CHAT_DISPATCH_ALREADY_STARTED"));
    assert.equal(f.counts.posts, 1);
  } finally { await f.close(); }
});

test("native owner TTS accepts exactly the four source model IDs", async () => {
  for (const modelId of ["eleven_multilingual_v2", "eleven_v3", "eleven_v4", "eleven_v4_turbo"]) {
    const f = await fixture({ modelId });
    try {
      const chat = await f.api.createOwnerElevenLabsTtsChat({ candidate: f.candidate, permit: f.permit,
        preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
      await f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
        preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
      const body = f.events.find(({ pathname }) => pathname === "/api/v1/audio/generate")?.body as {
        settings: Record<string, unknown>;
      };
      assert.equal(body.settings.model_type, modelId);
      assert.equal(body.settings.stability, 0.5);
      assert.equal(body.settings.similarity_boost, 0.5);
      assert.equal(Object.hasOwn(body.settings, "language_code"), modelId === "eleven_v4" || modelId === "eleven_v4_turbo");
      assert.equal(f.counts.posts, 1);
    } finally { await f.close(); }
  }
});

test("owned TTS history requires the exact nonempty positive text ACK and result reads use minted contexts only", async () => {
  const f = await fixture();
  try {
    const chat = await f.api.createOwnerElevenLabsTtsChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    await f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    const snapshot = await f.api.listOwnedElevenLabsTtsCandidates(chat);
    assert.equal(snapshot.history_binding_status, "BOUND");
    assert.equal(snapshot.owner_ack_status, "MATCHED");
    assert.equal((snapshot.contexts as unknown[]).length, 1);
    const context = (snapshot.contexts as unknown[])[0];
    assert.equal(isOwnerElevenLabsTtsAudioResultMessageContext(context, f.client), true);
    assert.equal(isOwnerElevenLabsTtsAudioResultMessageContext(context, f.otherClient), false);
    await assert.rejects(f.otherApi.getOwnedElevenLabsTtsResult(context),
      (error: unknown) => code(error, "RESULT_CONTEXT_INVALID"));
    const revoked = Proxy.revocable(context as object, {});
    revoked.revoke();
    await assert.rejects(f.api.getOwnedElevenLabsTtsResult(revoked.proxy),
      (error: unknown) => code(error, "RESULT_CONTEXT_INVALID"));
    assert.equal(f.counts.results, 0, "foreign or proxied contexts must fail before the result GET");
    const result = await f.api.getOwnedElevenLabsTtsResult(context);
    assert.equal(result.message_binding, "BOUND");
    assert.equal((result.ready_audio as unknown[]).length, 1);
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.history, 1);
    assert.equal(f.counts.results, 1);
    await assert.rejects(f.api.getOwnedElevenLabsTtsResult({
      chat_uuid: chat.chat_uuid, message_id: "foreign-message", model_id: "eleven_v4_turbo",
      provider_chat_id: "9001", message_object_ids: ["tts-audio-object-1"]
    }));
    assert.equal(f.counts.results, 1, "forged context must be rejected before the GET");
  } finally { await f.close(); }
});

test("lost audio POST is reserved as unknown and reconciliation is GET-only with prompt-bound ACK", async () => {
  const f = await fixture({ loseAck: true });
  try {
    const chat = await f.api.createOwnerElevenLabsTtsChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    await assert.rejects(f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT }));
    await assert.rejects(f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT }));
    assert.equal(f.counts.posts, 1);
    const snapshot = await f.api.listOwnedElevenLabsTtsCandidates(chat);
    assert.equal(snapshot.owner_ack_status, "MATCHED");
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.history, 1);
  } finally { await f.close(); }
});

test("unknown TTS POST remains GET-reconcilable after the input voice-reference TTL without replay", async () => {
  const f = await fixture({ loseAck: true });
  try {
    const chat = await f.api.createOwnerElevenLabsTtsChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    await assert.rejects(f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT }));
    f.now += 15 * 60_000 + 1;
    await assert.rejects(f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT }),
    (error: unknown) => code(error, "CHAT_DISPATCH_ALREADY_STARTED"));
    const snapshot = await f.api.listOwnedElevenLabsTtsCandidates(chat);
    assert.equal(snapshot.owner_ack_status, "MATCHED");
    const result = await f.api.getOwnedElevenLabsTtsResult((snapshot.contexts as unknown[])[0]);
    assert.equal(result.message_binding, "BOUND");
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.history, 1);
    assert.equal(f.counts.results, 1);
  } finally { await f.close(); }
});

test("owned TTS history reads exactly seven bounded pages for 64 messages and binds every bot audio object", async () => {
  const f = await fixture({ historyBody: (_chatUuid, echoId, page, modelId) => {
    const rows = Array.from({ length: 64 }, (_, index) => index === 0
      ? { id: echoId!, chat_id: 9001, author_id: 42,
        message_object: [{ id: "tts-owner-text-object", message_id: echoId!, object_type: "text",
          object_text: PROMPT, model_type: modelId }] }
      : { id: `tts-bot-message-${index}`, chat_id: 9001, author_id: -1,
        message_object: [{ id: `tts-audio-object-${index}`, message_id: `tts-bot-message-${index}`, object_type: "audio",
          object_url: "https://r2.syntx.ai/generated/test.mp3", completed: true, model_type: modelId }] });
    const start = (page - 1) * 10;
    const messages = rows.slice(start, start + 10);
    return { messages, pagination: { page, page_size: 10, total_count: 64, total_pages: 7,
      has_next: page < 7, has_previous: page > 1 } };
  } });
  try {
    const chat = await f.api.createOwnerElevenLabsTtsChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    await f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    const snapshot = await f.api.listOwnedElevenLabsTtsCandidates(chat);
    assert.equal(snapshot.history_binding_status, "BOUND");
    assert.equal(snapshot.history_get_calls, 7);
    assert.equal(snapshot.total_count, 64);
    assert.equal((snapshot.contexts as unknown[]).length, 63);
    assert.equal(f.counts.history, 7);
    assert.equal(f.counts.posts, 1);
  } finally { await f.close(); }
});

test("all 80 observed audio objects across two bot messages require exactly two owned GETs", async () => {
  const objects = (messageId: string, prefix: string) => Array.from({ length: 40 }, (_, index) => ({
    id: `${prefix}-${index + 1}`, message_id: messageId, object_type: "audio",
    object_url: `https://r2.syntx.ai/generated/${prefix}-${index + 1}.mp3`, completed: true, model_type: "eleven_v4_turbo"
  }));
  const f = await fixture({
    historyBody: (_chatUuid, echoId) => ({ messages: [
      { id: echoId!, chat_id: 9001, author_id: 42, message_object: [{ id: "tts-owner-text-object", message_id: echoId!,
        object_type: "text", object_text: PROMPT, model_type: "eleven_v4_turbo" }] },
      { id: "tts-bot-message-a", chat_id: 9001, author_id: -1, message_object: objects("tts-bot-message-a", "tts-audio-a") },
      { id: "tts-bot-message-b", chat_id: 9001, author_id: -1, message_object: objects("tts-bot-message-b", "tts-audio-b") }
    ], pagination: { page: 1, page_size: 10, total_count: 3, total_pages: 1, has_next: false, has_previous: false } }),
    resultBody: (messageId) => ({ id: messageId, chat_id: 9001, author_id: -1,
      message_object: objects(messageId, messageId === "tts-bot-message-a" ? "tts-audio-a" : "tts-audio-b"),
      created_at: "2026-10-13T02:00:00Z", is_favorite: false })
  });
  try {
    const chat = await f.api.createOwnerElevenLabsTtsChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    await f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    const snapshot = await f.api.listOwnedElevenLabsTtsCandidates(chat);
    const contexts = snapshot.contexts as unknown[];
    assert.equal(contexts.length, 2);
    const results = await Promise.all(contexts.map((context) => f.api.getOwnedElevenLabsTtsResult(context)));
    assert.deepEqual(results.map((result) => (result.ready_audio as unknown[]).length), [40, 40]);
    assert.equal(f.counts.results, 2);
    assert.equal(f.counts.posts, 1);
  } finally { await f.close(); }
});

test("owned TTS history refuses a provider-chat change across pages", async () => {
  const f = await fixture({ historyBody: (_chatUuid, echoId, page, modelId) => {
    const messages = page === 1
      ? [{ id: echoId!, chat_id: 9001, author_id: 42,
          message_object: [{ id: "tts-owner-text-object", message_id: echoId!, object_type: "text",
            object_text: PROMPT, model_type: modelId }] },
        ...Array.from({ length: 9 }, (_, index) => ({ id: `tts-page-one-${index}`, chat_id: 9001, author_id: -1,
          message_object: [{ id: `tts-page-one-audio-${index}`, message_id: `tts-page-one-${index}`, object_type: "audio", model_type: modelId }] }))]
      : [{ id: "tts-foreign-provider-chat", chat_id: 9002, author_id: -1,
          message_object: [{ id: "tts-foreign-audio", message_id: "tts-foreign-provider-chat", object_type: "audio", model_type: modelId }] }];
    return { messages, pagination: { page, page_size: 10, total_count: 11, total_pages: 2,
      has_next: page === 1, has_previous: page > 1 } };
  } });
  try {
    const chat = await f.api.createOwnerElevenLabsTtsChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    await f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    const snapshot = await f.api.listOwnedElevenLabsTtsCandidates(chat);
    assert.equal(snapshot.history_binding_status, "UNVERIFIED");
    assert.equal(snapshot.status, "UNVERIFIED");
    assert.equal((snapshot.contexts as unknown[]).length, 0);
    assert.equal(f.counts.history, 2);
    assert.equal(f.counts.results, 0);
  } finally { await f.close(); }
});

test("audio history does not mint a result context from an empty owner ACK", async () => {
  const f = await fixture({ historyBody: (_chatUuid, echoId) => ({
    messages: [
      { id: echoId ?? "tts-owner-ack-lost-response", chat_id: 9001, author_id: 42,
        message_object: [{ id: "empty-ack-object", message_id: echoId ?? "tts-owner-ack-lost-response",
          object_type: "text", object_text: "", model_type: "eleven_v4_turbo" }] },
      { id: "tts-bot-message-1", chat_id: 9001, author_id: -1,
        message_object: [{ id: "tts-audio-object-1", message_id: "tts-bot-message-1", object_type: "audio",
          object_url: "https://r2.syntx.ai/generated/test.mp3", completed: true, model_type: "eleven_v4_turbo" }] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
  }) });
  try {
    const chat = await f.api.createOwnerElevenLabsTtsChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    await f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    const snapshot = await f.api.listOwnedElevenLabsTtsCandidates(chat);
    assert.notEqual(snapshot.owner_ack_status, "MATCHED");
    assert.equal((snapshot.contexts as unknown[]).length, 0);
    assert.equal(f.counts.results, 0);
  } finally { await f.close(); }
});

test("audio history requires the positive owner ACK model to match the prepared TTS model", async () => {
  const f = await fixture({ historyBody: (_chatUuid, echoId) => ({ messages: [
    { id: echoId!, chat_id: 9001, author_id: 42, message_object: [{ id: "tts-owner-text-object",
      message_id: echoId!, object_type: "text", object_text: PROMPT, model_type: "eleven_v4" }] },
    { id: "tts-bot-message-1", chat_id: 9001, author_id: -1, message_object: [{ id: "tts-audio-object-1",
      message_id: "tts-bot-message-1", object_type: "audio", model_type: "eleven_v4_turbo" }] }
  ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } }) });
  try {
    const chat = await f.api.createOwnerElevenLabsTtsChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    await f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    const snapshot = await f.api.listOwnedElevenLabsTtsCandidates(chat);
    assert.equal(snapshot.owner_ack_status, "MISMATCH");
    assert.equal((snapshot.contexts as unknown[]).length, 0);
    assert.equal(f.counts.results, 0);
  } finally { await f.close(); }
});

test("positive owner ACK without a bot audio row stays pending and causes no result GET or replay", async () => {
  const f = await fixture({ historyBody: (_chatUuid, echoId, _page, modelId) => ({
    messages: [{ id: echoId!, chat_id: 9001, author_id: 42,
      message_object: [{ id: "tts-owner-text-object", message_id: echoId!, object_type: "text",
        object_text: PROMPT, model_type: modelId }] }],
    pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1, has_next: false, has_previous: false }
  }) });
  try {
    const chat = await f.api.createOwnerElevenLabsTtsChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    await f.api.startElevenLabsTtsWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    const snapshot = await f.api.listOwnedElevenLabsTtsCandidates(chat);
    assert.equal(snapshot.status, "PENDING");
    assert.equal(snapshot.owner_ack_status, "MATCHED");
    assert.equal((snapshot.contexts as unknown[]).length, 0);
    assert.equal(f.counts.results, 0);
    assert.equal(f.counts.posts, 1);
  } finally { await f.close(); }
});
