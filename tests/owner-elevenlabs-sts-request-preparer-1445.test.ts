import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerElevenLabsStsOriginalReferenceService } from "../src/application/owner-elevenlabs-sts-original-reference-service.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";
import { createOwnerElevenLabsStsRequestPreparer } from "../src/application/owner-elevenlabs-sts-request-preparer.js";
import { createOwnerElevenLabsStsOneShotPermit, consumeOwnerElevenLabsStsOneShotPermit,
  revalidateOwnerElevenLabsStsOneShotPermit } from "../src/application/owner-elevenlabs-sts-one-shot-policy.js";
import { OwnerElevenLabsStsOneShotPolicyError } from "../src/application/owner-elevenlabs-sts-one-shot-policy.js";
import test from "node:test";

const ATTEMPT = "link_sts_preparer_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "sts-preparer-tenant", subject: "sts-preparer-owner" });
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
const ORIGINAL_URL = "https://r2.syntx.ai/private/sts-original.mp3";

function credentialBroker(): SyntxCredentialBroker { return { async useCredential<T>(run: (credential: string) => Promise<T>) { return run("synthetic-sts-preparer-credential"); } }; }
function json(payload: unknown): Response { return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }); }
async function fixture() {
  let now = 1_000_000, uploadCount = 0, voiceGets = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-sts-preparer", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => now);
  const links = new PerUserLinkService(provider, store, { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const chatClient = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/chats/upload-files")) {
      uploadCount++; const form = init?.body as FormData; const file = form.get("files"); assert.ok(file instanceof File);
      return json({ files: [{ filename: "input.mp3", url: ORIGINAL_URL, status: "success", size: MP3.byteLength, content_type: "audio/mpeg", duration: 11.006259 }] });
    }
    throw new Error("unexpected synthetic request");
  } });
  const voiceClient = new SyntxHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    voiceGets++; return json([{ voice_id: "voice_sts_001", name: "Studio" }]);
  } });
  const voices = new OwnerElevenLabsVoiceReferenceService({ binding: BINDING, linkService: links, resolveClient: () => voiceClient, now: () => now });
  const page = await voices.listVoices({ attemptId: ATTEMPT });
  const voiceRef = (page.voices[0] as { voice_ref: string }).voice_ref;
  const dir = await mkdtemp(join(tmpdir(), "syntx-sts-preparer-"));
  const ffprobe = join(dir, "ffprobe");
  const output = JSON.stringify({ streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 2, nb_read_frames: "500", duration: "11.006259" }], format: { format_name: "mp3", duration: "11.006259" } });
  await writeFile(ffprobe, `#!/bin/sh\nprintf '%s' '${output}'\n`); await chmod(ffprobe, 0o700);
  const originals = new OwnerElevenLabsStsOriginalReferenceService({ ffprobePath: ffprobe, destination: "hidden", binding: BINDING,
    linkService: links, resolveClient: () => chatClient, now: () => now });
  const receipt = await originals.uploadOriginal({ attemptId: ATTEMPT, filename: "input.mp3", mime_type: "audio/mpeg", bytes: MP3 });
  const preparer = createOwnerElevenLabsStsRequestPreparer({ originalReferenceService: originals, voiceReferenceService: voices, now: () => now });
  return { get now() { return now; }, advance(ms: number) { now += ms; }, links, chatClient, voiceClient, voices, originals, receipt, voiceRef, preparer,
    counts: () => ({ uploadCount, voiceGets }), cleanup: async () => { await preparer.close(); await originals.close(); await voices.close(); store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("prepares the current source-pinned empty-prompt typed-audio STS request from genuine owner references", async () => {
  const f = await fixture();
  try {
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, audio_original_handle: f.receipt.audio_original_handle, voice_ref: f.voiceRef });
    assert.deepEqual(Object.keys(candidate).sort(), ["backend_acceptance", "dispatch_allowed", "duration_projection_status", "duration_seconds", "expires_at", "intent_fingerprint", "model_id", "mode", "profile_schema_hash", "request_fingerprint", "runtime_usable", "source_sha256", "status"].sort());
    assert.equal(candidate.duration_seconds, 11);
    assert.equal(candidate.model_id, "eleven_multilingual_sts_v2");
    assert.equal(candidate.mode, "speech_to_speech");
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.duration_projection_status, "SOURCE_VERIFIED");
    assert.equal(JSON.stringify(candidate).includes(ORIGINAL_URL), false);
    assert.equal(JSON.stringify(candidate).includes(f.receipt.audio_original_handle), false);
    const request = f.preparer.getPrivateRequest(candidate);
    assert.equal(request.prompt, "");
    assert.deepEqual(Object.keys(request.settings).sort(), ["duration", "file_urls", "mode", "model_type", "voice_id"].sort());
    assert.deepEqual(request.settings, { model_type: "eleven_multilingual_sts_v2", mode: "speech_to_speech", voice_id: "voice_sts_001", duration: 11,
      file_urls: [{ type: "audio", url: ORIGINAL_URL }] });
    assert.deepEqual(f.counts(), { uploadCount: 1, voiceGets: 1 });
  } finally { await f.cleanup(); }
});

test("genuine one-shot receipt revalidates and consumes once; principal, clone and replay fail closed", async () => {
  const f = await fixture();
  try {
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, audio_original_handle: f.receipt.audio_original_handle, voice_ref: f.voiceRef });
    const principal = f.preparer.inspectCandidate(candidate)!.principal;
    const input = { preparer: f.preparer, candidate, principal, attemptId: ATTEMPT };
    await assert.rejects(() => createOwnerElevenLabsStsOneShotPermit({ ...input,
      principal: { ...principal, subject_id: "different-owner" } }),
    (error: unknown) => error instanceof OwnerElevenLabsStsOneShotPolicyError && error.code === "PRINCIPAL_MISMATCH");
    const cloned = Object.freeze({ ...candidate });
    await assert.rejects(() => createOwnerElevenLabsStsOneShotPermit({ ...input, candidate: cloned as typeof candidate }), /./);
    const permit = await createOwnerElevenLabsStsOneShotPermit(input);
    await assert.rejects(() => createOwnerElevenLabsStsOneShotPermit(input),
      (error: unknown) => error instanceof OwnerElevenLabsStsOneShotPolicyError && error.code === "CANDIDATE_ALREADY_ISSUED");
    await revalidateOwnerElevenLabsStsOneShotPermit({ ...input, permit });
    const consumed = consumeOwnerElevenLabsStsOneShotPermit({ ...input, permit });
    assert.equal(consumed.status, "consumed");
    assert.equal(consumed.dispatch_allowed, false);
    assert.equal(consumed.request_fingerprint, candidate.request_fingerprint);
    await assert.rejects(() => revalidateOwnerElevenLabsStsOneShotPermit({ ...input, permit }),
      (error: unknown) => error instanceof OwnerElevenLabsStsOneShotPolicyError && error.code === "PERMIT_ALREADY_CONSUMED");
    assert.throws(() => consumeOwnerElevenLabsStsOneShotPermit({ ...input, permit }),
      (error: unknown) => error instanceof OwnerElevenLabsStsOneShotPolicyError && error.code === "PERMIT_ALREADY_CONSUMED");
    const clonedPermit = Object.freeze({ ...permit });
    assert.throws(() => consumeOwnerElevenLabsStsOneShotPermit({ ...input, permit: clonedPermit as typeof permit }),
      (error: unknown) => error instanceof OwnerElevenLabsStsOneShotPolicyError && error.code === "PERMIT_INVALID");
    assert.equal(candidate.dispatch_allowed, false);
  } finally { await f.cleanup(); }
});

test("candidate expires with the source or voice reference and is invalidated by attempt epoch", async () => {
  const f = await fixture();
  try {
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, audio_original_handle: f.receipt.audio_original_handle, voice_ref: f.voiceRef });
    await f.preparer.invalidateAttempt(ATTEMPT);
    assert.equal(f.preparer.inspectCandidate(candidate), undefined);
    assert.throws(() => f.preparer.getPrivateRequest(candidate), /./);
  } finally { await f.cleanup(); }
  const expiring = await fixture();
  try {
    const candidate = await expiring.preparer.prepare({ attemptId: ATTEMPT, audio_original_handle: expiring.receipt.audio_original_handle, voice_ref: expiring.voiceRef });
    expiring.advance(15 * 60_000 + 1);
    assert.equal(expiring.preparer.inspectCandidate(candidate), undefined);
    assert.equal(expiring.preparer.withCapturedNativeOriginal(candidate, (_client, _reference, url) => url), ORIGINAL_URL,
      "the genuine captured witness remains available for a later GET-only join after candidate TTL");
  } finally { await expiring.cleanup(); }
  const issued = await fixture();
  try {
    const candidate = await issued.preparer.prepare({ attemptId: ATTEMPT, audio_original_handle: issued.receipt.audio_original_handle, voice_ref: issued.voiceRef });
    const principal = issued.preparer.inspectCandidate(candidate)!.principal;
    const input = { preparer: issued.preparer, candidate, principal, attemptId: ATTEMPT };
    const permit = await createOwnerElevenLabsStsOneShotPermit(input);
    issued.advance(15 * 60_000 + 1);
    await assert.rejects(() => revalidateOwnerElevenLabsStsOneShotPermit({ ...input, permit }), /./);
  } finally { await issued.cleanup(); }
});

test("candidate clones, unknown voice references, and mismatched genuine service boundaries are rejected", async () => {
  const f = await fixture();
  try {
    const forgedVoiceService = Object.create(Object.getPrototypeOf(f.voices)) as typeof f.voices;
    const forgedPreparer = createOwnerElevenLabsStsRequestPreparer({ originalReferenceService: f.originals,
      voiceReferenceService: forgedVoiceService });
    await assert.rejects(() => forgedPreparer.prepare({ attemptId: ATTEMPT, audio_original_handle: f.receipt.audio_original_handle,
      voice_ref: f.voiceRef }), /./);
    await forgedPreparer.close();
    await assert.rejects(() => f.preparer.prepare({ attemptId: ATTEMPT, audio_original_handle: f.receipt.audio_original_handle,
      voice_ref: "owner_elevenlabs_voice_00000000-0000-4000-8000-000000000000" }), /./);
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, audio_original_handle: f.receipt.audio_original_handle, voice_ref: f.voiceRef });
    assert.equal(f.preparer.inspectCandidate({ ...candidate }), undefined);
  } finally { await f.cleanup(); }
});
