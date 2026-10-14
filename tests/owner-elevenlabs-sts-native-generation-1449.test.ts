import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerElevenLabsStsOriginalReferenceService } from "../src/application/owner-elevenlabs-sts-original-reference-service.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";
import { createOwnerElevenLabsStsRequestPreparer } from "../src/application/owner-elevenlabs-sts-request-preparer.js";
import { createOwnerElevenLabsStsOneShotPermit } from "../src/application/owner-elevenlabs-sts-one-shot-policy.js";

const ATTEMPT = "link_sts_native_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "sts-native-tenant", subject: "sts-native-owner" });
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
const ORIGINAL_URL = "https://r2.syntx.ai/private/sts-native-input.mp3";
const OUTPUT_URL = "https://r2.syntx.ai/private/sts-native-output.mp3";
function broker(): SyntxCredentialBroker { return { async useCredential<T>(run: (credential: string) => Promise<T>) { return run("synthetic-sts-native-credential"); } }; }
function json(value: unknown): Response { return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }); }

async function fixture(withBot = true) {
  let now = 1_000_000, uploads = 0, generations = 0, historyGets = 0, resultGets = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-sts-native", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => now);
  const links = new PerUserLinkService(provider, store, { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/chats/upload-files")) {
      uploads++;
      return json({ files: [{ filename: "input.mp3", url: ORIGINAL_URL, status: "success", size: MP3.byteLength,
        content_type: "audio/mpeg", duration: 11.006259 }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") return json({ uuid: "native-sts-chat" });
    if (url.pathname === "/api/v1/audio/generate") {
      generations++;
      assert.equal(url.search, "?ai_name=elevenlabs");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.chat_uuid, "native-sts-chat"); assert.equal(body.prompt, "");
      assert.deepEqual(Object.keys(body.settings as object).sort(), ["duration", "file_urls", "mode", "model_type", "voice_id"]);
      return json({ id: "owner-ack-001" });
    }
    if (url.pathname.endsWith("/messages") && init?.method === "GET") {
      historyGets++;
      const messages = [{ id: "owner-ack-001", chat_id: 42, author_id: 17,
        message_object: [{ id: "ack-object-001", message_id: "owner-ack-001", object_type: "audio", model_type: "eleven_multilingual_sts_v2" }] }];
      if (withBot) messages.push({ id: "bot-result-001", chat_id: 42, author_id: -1,
        message_object: [{ id: "bot-object-001", message_id: "bot-result-001", object_type: "audio", model_type: "eleven_multilingual_sts_v2" }] });
      return json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname.endsWith("/bot-result-001") && init?.method === "GET") {
      resultGets++;
      return json({ id: "bot-result-001", chat_id: 42, author_id: -1,
        message_object: [{ id: "bot-object-001", object_type: "audio", object_url: OUTPUT_URL, completed: true,
          model_type: "eleven_multilingual_sts_v2" }] });
    }
    throw new Error(`unexpected synthetic request ${url.pathname}`);
  } });
  const voiceClient = new SyntxHttpClient({ credentialBroker: broker(), fetchImpl: async () => json([{ voice_id: "voice_sts_001", name: "Studio" }]) });
  const voices = new OwnerElevenLabsVoiceReferenceService({ binding: BINDING, linkService: links, resolveClient: () => voiceClient, now: () => now });
  const voicePage = await voices.listVoices({ attemptId: ATTEMPT });
  const voiceRef = (voicePage.voices[0] as { voice_ref: string }).voice_ref;
  const directory = await mkdtemp(join(tmpdir(), "syntx-sts-native-1449-"));
  const ffprobe = join(directory, "ffprobe");
  const probeOutput = JSON.stringify({ streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 2,
    nb_read_frames: "500", duration: "11.006259" }], format: { format_name: "mp3", duration: "11.006259" } });
  await writeFile(ffprobe, `#!/bin/sh\nprintf '%s' '${probeOutput}'\n`); await chmod(ffprobe, 0o700);
  const originals = new OwnerElevenLabsStsOriginalReferenceService({ ffprobePath: ffprobe, destination: "hidden", binding: BINDING,
    linkService: links, resolveClient: () => client, now: () => now });
  const uploaded = await originals.uploadOriginal({ attemptId: ATTEMPT, filename: "input.mp3", mime_type: "audio/mpeg", bytes: MP3 });
  const preparer = createOwnerElevenLabsStsRequestPreparer({ originalReferenceService: originals, voiceReferenceService: voices, now: () => now });
  return { client, links, preparer, uploaded, voiceRef, advance(ms: number) { now += ms; }, counts: () => ({ uploads, generations, historyGets, resultGets }),
    async operation() {
      const candidate = await preparer.prepare({ attemptId: ATTEMPT, audio_original_handle: uploaded.audio_original_handle, voice_ref: voiceRef });
      const principal = preparer.inspectCandidate(candidate)!.principal;
      const permit = await createOwnerElevenLabsStsOneShotPermit({ preparer, candidate, principal, attemptId: ATTEMPT });
      return { preparer, candidate, permit, principal, attemptId: ATTEMPT, linkService: links, binding: BINDING };
    }, cleanup: async () => { await preparer.close(); await originals.close(); await voices.close(); store.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("genuine STS candidate generates once, survives source TTL for owned history and decodes exact bot MP3", async () => {
  const f = await fixture();
  try {
    const operation = await f.operation();
    let foreignFetches = 0;
    const foreignClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
      foreignFetches++; return json({ uuid: "foreign-sts-chat" });
    } });
    await assert.rejects(() => foreignClient.createOwnerElevenLabsStsChat(operation), /./);
    assert.equal(foreignFetches, 0, "a candidate captured by another client must fail before chat POST");
    const chat = await f.client.createOwnerElevenLabsStsChat(operation);
    assert.equal(Object.hasOwn(chat, "principal"), false);
    assert.equal(JSON.stringify(chat).includes(ORIGINAL_URL), false);
    const ack = await f.client.startElevenLabsStsWithOwnedCandidate({ ...operation, chat });
    assert.deepEqual(ack, { chat_uuid: "native-sts-chat", message_id: "owner-ack-001" });
    assert.equal(f.counts().generations, 1);
    await assert.rejects(() => f.client.startElevenLabsStsWithOwnedCandidate({ ...operation, chat }), /./);
    f.advance(15 * 60_000 + 1);
    const candidates = await f.client.listOwnedElevenLabsStsCandidates(chat);
    assert.equal(candidates.status, "COMPLETE"); assert.equal(candidates.owner_ack_status, "MATCHED");
    assert.equal(candidates.contexts.length, 1); assert.equal(JSON.stringify(candidates.contexts[0]).includes(ORIGINAL_URL), false);
    assert.equal(Object.hasOwn(candidates.contexts[0]!, "principal"), false);
    const result = await f.client.getOwnedElevenLabsStsResult(candidates.contexts[0]);
    assert.equal(result.message_binding, "BOUND"); assert.equal(result.model_echo, "MATCHED");
    assert.equal(result.ready_audio[0]?.object_url, OUTPUT_URL);
    assert.deepEqual(f.counts(), { uploads: 1, generations: 1, historyGets: 1, resultGets: 1 });
  } finally { await f.cleanup(); }
});

test("STS native chat and result contexts are same-client and nominal; owner ACK absence never mints a result", async () => {
  const f = await fixture(false);
  try {
    const operation = await f.operation();
    const chat = await f.client.createOwnerElevenLabsStsChat(operation);
    await f.client.startElevenLabsStsWithOwnedCandidate({ ...operation, chat });
    await assert.rejects(() => f.client.listOwnedElevenLabsStsCandidates(Object.freeze({ ...chat })), /./);
    const pending = await f.client.listOwnedElevenLabsStsCandidates(chat);
    assert.equal(pending.owner_ack_status, "MATCHED"); assert.equal(pending.contexts.length, 0);
    assert.equal(pending.status, "PENDING");
    const foreign = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { throw new Error("should not fetch"); } });
    await assert.rejects(() => foreign.listOwnedElevenLabsStsCandidates(chat), /./);
    assert.equal(f.counts().generations, 1);
  } finally { await f.cleanup(); }
});

test("expired candidate is rejected before the single POST and untrusted authorize callbacks are not admitted", async () => {
  const f = await fixture();
  try {
    const operation = await f.operation();
    const chat = await f.client.createOwnerElevenLabsStsChat(operation);
    f.advance(15 * 60_000 + 1);
    await assert.rejects(() => f.client.startElevenLabsStsWithOwnedCandidate({ ...operation, chat }), /./);
    await assert.rejects(() => f.client.listOwnedElevenLabsStsCandidates({ chat, authorizeGet: async () => {} }), /./);
    assert.equal(f.counts().generations, 0);
  } finally { await f.cleanup(); }
});

test("direct exported helper cannot invoke a caller-supplied chat transport without a client-minted packet", async () => {
  const f = await fixture();
  try {
    const operation = await f.operation();
    let callbackCalls = 0;
    const native = await import("../src/adapter/syntx/owner-elevenlabs-sts-native-context.js");
    const fakePacket = Object.freeze({ client: f.client, callback: async () => { callbackCalls++; return { chat_uuid: "forged-chat" }; } });
    await assert.rejects(() => native.createOwnerElevenLabsStsNativeChat(operation, fakePacket));
    assert.equal(callbackCalls, 0);
    assert.equal(f.counts().generations, 0);
    assert.equal(f.counts().historyGets, 0);
    assert.equal(f.counts().resultGets, 0);
  } finally { await f.cleanup(); }
});
