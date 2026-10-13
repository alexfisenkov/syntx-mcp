import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import * as nativeClientModule from "../src/adapter/syntx/chat-http-client.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerElevenLabsDialogueRequestPreparer } from "../src/application/owner-elevenlabs-dialogue-request-preparer.js";
import { OwnerElevenLabsDialogueOneShotPolicy } from "../src/application/owner-elevenlabs-dialogue-one-shot-policy.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";

const ATTEMPT = "link_elevenlabs_dialogue_native_0123456789";
const BINDING = Object.freeze({ tenant_id: "elevenlabs-dialogue-native-tenant", subject: "elevenlabs-dialogue-native-owner" });
const CREDENTIAL = "synthetic-elevenlabs-dialogue-native-credential";
const VOICE_IDS = ["dialogue_native_voice_A", "dialogue_native_voice_B"] as const;
const PROMPT = "Use a calm, conversational delivery.";
const stores = new Set<InMemoryAuthLinkStore>();
const nativeClientExports = nativeClientModule as unknown as Record<string, unknown>;

afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

interface NativeApi {
  createOwnerElevenLabsDialogueChat(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  startOwnerElevenLabsDialogueWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  listOwnedElevenLabsDialogueCandidates(chat: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getOwnedElevenLabsDialogueResult(context: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
}
function native(client: SyntxChatHttpClient): NativeApi { return client as unknown as NativeApi; }
function isDialogueChatContext(value: unknown, client: unknown): boolean {
  const guard = nativeClientExports.isOwnerElevenLabsDialogueChatContext;
  return typeof guard === "function" && Reflect.apply(guard, undefined, [value, client]) === true;
}
function isDialogueResultContext(value: unknown, client: unknown): boolean {
  const guard = nativeClientExports.isOwnerElevenLabsDialogueAudioResultMessageContext;
  return typeof guard === "function" && Reflect.apply(guard, undefined, [value, client]) === true;
}
function code(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected;
}

async function fixture(options: { loseAck?: boolean; ownerRows?: (ack: string) => unknown[]; botModel?: string } = {}) {
  let now = Date.parse("2026-10-14T00:00:00.000Z");
  const events: Array<{ method: string; pathname: string; query: string; body: unknown }> = [];
  let chatCount = 0, audioPosts = 0, historyGets = 0, resultGets = 0;
  let chatUuid = "", ackId = "", providerChatId = 9002;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "dialogue-native-test", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: CREDENTIAL });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(() => now);
  stores.add(store);
  const links = new PerUserLinkService(provider, store, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING);
  await links.issueHandoff(BINDING, ATTEMPT);
  assert.equal((await links.checkAttempt(BINDING, ATTEMPT)).status, "LINKED");
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return links.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
    }
  };
  const voiceClient = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () => Response.json([
    { voice_id: VOICE_IDS[0], name: "Synthetic dialogue voice A" },
    { voice_id: VOICE_IDS[1], name: "Synthetic dialogue voice B" }
  ]) });
  const voiceService = new OwnerElevenLabsVoiceReferenceService({ binding: BINDING, linkService: links,
    resolveClient: () => voiceClient, now: () => now });
  const listing = await voiceService.listVoices({ attemptId: ATTEMPT });
  const refs = (listing.voices as unknown as Array<Record<string, unknown>>).map((row) => String(row.voice_ref));
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService: links });
  const preparer = new OwnerElevenLabsDialogueRequestPreparer({ voiceReferenceService: voiceService, now: () => now });
  const oneShotPolicy = new OwnerElevenLabsDialogueOneShotPolicy({ preparer, now: () => now });
  const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal, request: {
    model_id: "eleven_v4", mode: "text_to_dialogue", prompt: PROMPT,
    inputs: [
      { name: "Guide", text: "First line 😀.", voice_ref: refs[0] },
      { name: "Guest", text: "Second line.", voice_ref: refs[1] }
    ], stability: 0.35, similarity_boost: 0.65, language_code: "auto"
  } });
  const permit = oneShotPolicy.createPermit({ candidate, attemptId: ATTEMPT, principal });
  const audioObject = (messageId: string, objectId: string, model = options.botModel ?? "eleven_v4") => ({
    id: objectId, message_id: messageId, object_type: "audio", object_url: "https://r2.syntx.ai/dialogue/test.mp3",
    completed: true, model_type: model
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push({ method, pathname: url.pathname, query: url.search, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1; chatUuid = `owner-dialogue-chat-${chatCount}`;
      return Response.json({ uuid: chatUuid });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      audioPosts += 1; ackId = `dialogue-owner-ack-${audioPosts}`;
      if (options.loseAck) throw new Error("synthetic response lost after dispatch");
      return Response.json({ id: ackId });
    }
    if (url.pathname.endsWith("/messages") && method === "GET") {
      historyGets += 1;
      const ownerRows = options.ownerRows?.(ackId) ?? [{ id: ackId || "unmatched-owner-message", chat_id: providerChatId,
        author_id: 42, message_object: [{ id: "dialogue-owner-object", message_id: ackId || "unmatched-owner-message",
          object_type: "text", object_text: "provider echo may differ from outer prompt", model_type: "eleven_v4" }] }];
      const botMessageId = "dialogue-bot-message-1";
      const rows = [
        ...ownerRows,
        { id: botMessageId, chat_id: providerChatId, author_id: -1,
          message_object: [audioObject(botMessageId, "dialogue-audio-object-1")] }
      ];
      return Response.json({ messages: rows, pagination: { page: 1, page_size: 10, total_count: rows.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (message && method === "GET") {
      resultGets += 1;
      return Response.json({ id: message[2], chat_id: providerChatId, author_id: -1,
        message_object: [audioObject(message[2]!, "dialogue-audio-object-1")] });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const otherClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  return {
    client, otherClient, api: native(client), otherApi: native(otherClient), candidate, permit, preparer, oneShotPolicy, principal,
    events, get counts() { return { chats: chatCount, posts: audioPosts, history: historyGets, results: resultGets }; },
    set providerChatId(value: number) { providerChatId = value; },
    async close() { oneShotPolicy.close(); preparer.close(); await voiceService.close(); }
  };
}

test("native dialogue methods create a fresh audio chat and dispatch one unchanged prompt with ordered lines", async () => {
  const f = await fixture();
  try {
    for (const method of ["createOwnerElevenLabsDialogueChat", "startOwnerElevenLabsDialogueWithOwnedCandidate",
      "listOwnedElevenLabsDialogueCandidates", "getOwnedElevenLabsDialogueResult"]) {
      assert.equal(typeof (SyntxChatHttpClient.prototype as unknown as Record<string, unknown>)[method], "function", method);
    }
    assert.equal(typeof nativeClientExports.isOwnerElevenLabsDialogueChatContext, "function");
    assert.equal(typeof nativeClientExports.isOwnerElevenLabsDialogueAudioResultMessageContext, "function");
    const chat = await f.api.createOwnerElevenLabsDialogueChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    assert.equal(chat.chat_uuid, "owner-dialogue-chat-1");
    assert.equal(chat.model_id, "eleven_v4");
    assert.equal(isDialogueChatContext(chat, f.client), true);
    assert.equal(isDialogueChatContext(chat, f.otherClient), false);
    assert.equal(JSON.stringify(chat).includes(VOICE_IDS[0]), false);
    const receipt = await f.api.startOwnerElevenLabsDialogueWithOwnedCandidate({ chat, candidate: f.candidate,
      permit: f.permit, preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    assert.deepEqual(receipt, { chat_uuid: "owner-dialogue-chat-1", message_id: "dialogue-owner-ack-1" });
    assert.deepEqual(f.events.filter(({ pathname }) => pathname === "/api/v1/audio/generate").map(({ method, query, body }) =>
      ({ method, query, body })), [{ method: "POST", query: "?ai_name=elevenlabs", body: {
        chat_uuid: "owner-dialogue-chat-1", prompt: PROMPT, settings: {
          model_type: "eleven_v4", mode: "text_to_dialogue", chars_count: 26,
          inputs: [{ name: "Guide", text: "First line 😀.", voice_id: VOICE_IDS[0] },
            { name: "Guest", text: "Second line.", voice_id: VOICE_IDS[1] }],
          stability: 0.35, similarity_boost: 0.65, language_code: "auto"
        }
      } }]);
    assert.equal(f.counts.posts, 1);
    await assert.rejects(f.api.startOwnerElevenLabsDialogueWithOwnedCandidate({ chat, candidate: f.candidate,
      permit: f.permit, preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT }),
    (error: unknown) => code(error, "CHAT_DISPATCH_ALREADY_STARTED"));
    assert.equal(f.counts.posts, 1);
  } finally { await f.close(); }
});
test("dialogue history binds by the known ACK ID and chat, not a TTS-style prompt echo", async () => {
  const f = await fixture();
  try {
    const chat = await f.api.createOwnerElevenLabsDialogueChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    await f.api.startOwnerElevenLabsDialogueWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    const history = await f.api.listOwnedElevenLabsDialogueCandidates(chat);
    assert.equal(history.owner_ack_status, "MATCHED");
    assert.equal(history.history_binding_status, "BOUND");
    assert.equal((history.contexts as unknown[]).length, 1);
    const context = (history.contexts as unknown[])[0];
    assert.equal(isDialogueResultContext(context, f.client), true);
    assert.equal(isDialogueResultContext(context, f.otherClient), false);
    const result = await f.api.getOwnedElevenLabsDialogueResult(context);
    assert.equal(result.message_binding, "BOUND");
    assert.equal(result.model_echo, "MATCHED");
    assert.deepEqual(result.objects, [{ object_index: 0, message_object_id: "dialogue-audio-object-1",
      object_type: "audio", object_url: "https://r2.syntx.ai/dialogue/test.mp3" }]);
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.history, 1);
    assert.equal(f.counts.results, 1);
  } finally { await f.close(); }
});

test("lost dialogue ACK stays unknown and history recovery never guesses from an outer prompt", async () => {
  const f = await fixture({ loseAck: true });
  try {
    const chat = await f.api.createOwnerElevenLabsDialogueChat({ candidate: f.candidate, permit: f.permit,
      preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
    const input = { chat, candidate: f.candidate, permit: f.permit, preparer: f.preparer,
      oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT };
    await assert.rejects(f.api.startOwnerElevenLabsDialogueWithOwnedCandidate(input),
      (error: unknown) => code(error, "OUTCOME_UNKNOWN"));
    await assert.rejects(f.api.startOwnerElevenLabsDialogueWithOwnedCandidate(input));
    const history = await f.api.listOwnedElevenLabsDialogueCandidates(chat);
    assert.equal(history.owner_ack_status, "UNKNOWN");
    assert.equal((history.contexts as unknown[]).length, 0);
    assert.equal(f.counts.posts, 1);
    assert.equal(f.events.filter(({ method, pathname }) => method === "POST" && pathname === "/api/v1/audio/generate").length, 1);
  } finally { await f.close(); }
});
