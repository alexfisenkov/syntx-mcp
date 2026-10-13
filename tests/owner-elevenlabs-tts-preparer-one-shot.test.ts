import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";

const PREPARER_MODULE_URL = new URL("../src/application/owner-elevenlabs-tts-request-preparer.js", import.meta.url).href;
const POLICY_MODULE_URL = new URL("../src/application/owner-elevenlabs-tts-one-shot-policy.js", import.meta.url).href;
const preparerModule = await import(PREPARER_MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const policyModule = await import(POLICY_MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPT = "link_elevenlabs_tts_preparer_0123456789";
const FOREIGN_ATTEMPT = "link_elevenlabs_tts_foreign_0123456789";
const BINDING = Object.freeze({ tenant_id: "elevenlabs-tts-tenant", subject: "elevenlabs-tts-owner" });
const VOICE_ID = "provider_voice_private_delta";
const CREDENTIAL = "synthetic-elevenlabs-tts-preparer-credential";
const stores = new Set<InMemoryAuthLinkStore>();

afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

interface PreparerApi {
  prepare(input: unknown): Promise<Record<string, unknown>>;
  inspectCandidate(candidate: unknown): Record<string, unknown> | undefined;
  revalidateCandidate(input: unknown): Record<string, unknown>;
  invalidateAttempt(attemptId: string): void;
  close(): void;
}
interface PolicyApi {
  createPermit(input: unknown): Record<string, unknown>;
  revalidate(input: unknown): Record<string, unknown>;
  consume(input: unknown): Record<string, unknown>;
  release(input: unknown): void;
  invalidateAttempt(attemptId: string): void;
  close(): void;
}

function code(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected;
}

async function makeFixture() {
  let now = Date.parse("2026-10-13T00:00:00.000Z");
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-elevenlabs-tts-challenge", approval_url: "https://example.invalid/" }; },
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
  const client = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () => new Response(JSON.stringify([
    { voice_id: VOICE_ID, name: "Synthetic owner voice" }
  ]), { headers: { "content-type": "application/json" } }) });
  const VoiceService = (await import("../src/application/owner-elevenlabs-voice-reference-service.js"))
    .OwnerElevenLabsVoiceReferenceService as unknown as new (options: unknown) => {
      listVoices(input: unknown): Promise<Record<string, unknown>>;
      resolveVoice(input: unknown): Promise<Record<string, unknown>>;
      isOwnedVoiceResolution(value: unknown, context: unknown): boolean;
      invalidateAttempt(attemptId: string): Promise<void>;
      close(): Promise<void>;
    };
  const voiceService = new VoiceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: () => now });
  const listing = await voiceService.listVoices({ attemptId: ATTEMPT });
  const voice = (listing.voices as Array<Record<string, unknown>>)[0]!;
  const voiceRef = String(voice.voice_ref);
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService: links });
  const RequestPreparer = preparerModule?.OwnerElevenLabsTtsRequestPreparer as new (options: unknown) => PreparerApi;
  const OneShotPolicy = policyModule?.OwnerElevenLabsTtsOneShotPolicy as new (options: unknown) => PolicyApi;
  assert.equal(typeof RequestPreparer, "function", "MISSING_OWNER_ELEVENLABS_TTS_REQUEST_PREPARER");
  assert.equal(typeof OneShotPolicy, "function", "MISSING_OWNER_ELEVENLABS_TTS_ONE_SHOT_POLICY");
  const preparer = new RequestPreparer({ voiceReferenceService: voiceService, now: () => now });
  const policy = new OneShotPolicy({ preparer, now: () => now });
  return {
    get now() { return now; }, set now(value: number) { now = value; },
    links, voiceService, voiceRef, principal, preparer, policy,
    async close() { policy.close(); preparer.close(); await voiceService.close(); }
  };
}

function ttsRequest(voice_ref: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model_id: "eleven_v4", mode: "text_to_speech", prompt: "A short line 😀.", voice_ref,
    stability: 0.35, similarity_boost: 0.65, ...overrides
  };
}

test("ElevenLabs TTS preparer and one-shot policy exist as private internal seams", () => {
  assert.equal(typeof preparerModule?.OwnerElevenLabsTtsRequestPreparer, "function");
  assert.equal(typeof policyModule?.OwnerElevenLabsTtsOneShotPolicy, "function");
});

test("prepared candidate hides raw voice ID while consumed one-shot yields exact private settings", async () => {
  const f = await makeFixture();
  try {
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef) });
    assert.equal(candidate.model_id, "eleven_v4");
    assert.equal(candidate.mode, "text_to_speech");
    assert.equal(candidate.chars_count, 16, "JavaScript UTF-16 length counts the astral symbol as two code units");
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.generation_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(typeof candidate.intent_fingerprint, "string");
    assert.equal(JSON.stringify(candidate).includes(VOICE_ID), false);
    assert.equal(JSON.stringify(candidate).includes("voice_name"), false);
    assert.equal(JSON.stringify(candidate).includes("file_urls"), false);

    const context = { candidate, attemptId: ATTEMPT, principal: f.principal };
    const permit = f.policy.createPermit(context);
    assert.equal(permit.dispatch_allowed, false);
    f.policy.revalidate({ ...context, permit });
    const consumed = f.policy.consume({ ...context, permit });
    assert.equal(consumed.dispatch_allowed, false);
    assert.deepEqual(consumed.private_request, {
      prompt: "A short line 😀.",
      settings: {
        model_type: "eleven_v4", mode: "text_to_speech", voice_id: VOICE_ID, chars_count: 16,
        stability: 0.35, similarity_boost: 0.65, file_urls: [], language_code: "auto"
      }
    });
    assert.equal(JSON.stringify(candidate).includes(VOICE_ID), false);
    assert.throws(() => f.policy.consume({ ...context, permit }), (error: unknown) => code(error, "PERMIT_ALREADY_CONSUMED"));
  } finally { await f.close(); }
});

test("non-V4 local TTS policy requires explicit 0.5 controls and omits V4-only language", async () => {
  const f = await makeFixture();
  try {
    await assert.rejects(f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef, { model_id: "eleven_v3", stability: 0.55 }) }),
    (error: unknown) => code(error, "UNSUPPORTED_MODEL_CONTROLS"));
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef, { model_id: "eleven_v3", stability: 0.5, similarity_boost: 0.5 }) });
    const context = { candidate, attemptId: ATTEMPT, principal: f.principal };
    const permit = f.policy.createPermit(context);
    f.policy.revalidate({ ...context, permit });
    const consumed = f.policy.consume({ ...context, permit });
    const settings = (consumed.private_request as { settings: Record<string, unknown> }).settings;
    assert.equal(settings.stability, 0.5);
    assert.equal(settings.similarity_boost, 0.5);
    assert.equal(Object.hasOwn(settings, "language_code"), false);
  } finally { await f.close(); }
});

test("TTS-only model matrix keeps both V4 models source language and excludes dialogue and STS", async () => {
  const f = await makeFixture();
  try {
    const multilingual = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef, { model_id: "eleven_multilingual_v2", stability: 0.5, similarity_boost: 0.5 }) });
    assert.equal(multilingual.model_id, "eleven_multilingual_v2");
    assert.equal(Object.hasOwn(multilingual, "language_code"), false);

    const turbo = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef, { model_id: "eleven_v4_turbo", stability: 0.5, similarity_boost: 0.5 }) });
    assert.equal(turbo.model_id, "eleven_v4_turbo");
    assert.equal(turbo.language_code, "auto");

    await assert.rejects(f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal, request: {
      model_id: "eleven_v3", mode: "text_to_dialogue", inputs: [
        { name: "A", text: "first", voice_ref: f.voiceRef }, { name: "B", text: "second", voice_ref: f.voiceRef }
      ], stability: 0.5, similarity_boost: 0.5
    } }));
    await assert.rejects(f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef, { model_id: "eleven_multilingual_sts_v2" }) }));
  } finally { await f.close(); }
});

test("same voice identity and semantic request has one fingerprint even after a new opaque reference is issued", async () => {
  const f = await makeFixture();
  try {
    const first = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef) });
    const firstContext = { candidate: first, attemptId: ATTEMPT, principal: f.principal };
    const firstPermit = f.policy.createPermit(firstContext);
    f.policy.revalidate({ ...firstContext, permit: firstPermit });
    f.policy.consume({ ...firstContext, permit: firstPermit });

    f.now += 15 * 60_000 + 1;
    const listing = await f.voiceService.listVoices({ attemptId: ATTEMPT });
    const nextVoiceRef = String((listing.voices as Array<Record<string, unknown>>)[0]!.voice_ref);
    assert.notEqual(nextVoiceRef, f.voiceRef);
    const second = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(nextVoiceRef) });
    assert.equal(second.intent_fingerprint, first.intent_fingerprint);
    assert.throws(() => f.policy.createPermit({ candidate: second, attemptId: ATTEMPT, principal: f.principal }),
      (error: unknown) => code(error, "INTENT_ALREADY_CLAIMED"));
  } finally { await f.close(); }
});

test("foreign, expired, revoked, forged, or mutated voice contexts cannot yield a one-shot payload", async () => {
  const f = await makeFixture();
  try {
    await assert.rejects(f.preparer.prepare({ attemptId: FOREIGN_ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef) }));
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef) });
    const context = { candidate, attemptId: ATTEMPT, principal: f.principal };
    const permit = f.policy.createPermit(context);
    assert.throws(() => Object.defineProperty(candidate, "model_id", { value: "eleven_v3" }));
    f.now += 15 * 60_000 + 1;
    assert.throws(() => f.policy.revalidate({ ...context, permit }));
    assert.throws(() => f.policy.consume({ ...context, permit }));
  } finally { await f.close(); }
});

test("an already-expired opaque voice reference cannot be resolved into a TTS candidate", async () => {
  const f = await makeFixture();
  try {
    f.now += 15 * 60_000 + 1;
    await assert.rejects(f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef) }), (error: unknown) => {
        assert.equal(error instanceof Error && "code" in error ? error.code : undefined, "VOICE_REFERENCE_UNAVAILABLE");
        return true;
      });
  } finally { await f.close(); }
});

test("attempt invalidation revokes a prepared candidate before its permit can be consumed", async () => {
  const f = await makeFixture();
  try {
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef) });
    const context = { candidate, attemptId: ATTEMPT, principal: f.principal };
    const permit = f.policy.createPermit(context);
    await f.voiceService.invalidateAttempt(ATTEMPT);
    assert.throws(() => f.policy.revalidate({ ...context, permit }));
    assert.throws(() => f.policy.consume({ ...context, permit }));
  } finally { await f.close(); }
});

test("pre-dispatch release frees its semantic claim without exposing a private request", async () => {
  const f = await makeFixture();
  try {
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef) });
    const context = { candidate, attemptId: ATTEMPT, principal: f.principal };
    const first = f.policy.createPermit(context);
    f.policy.release({ ...context, permit: first });
    const second = f.policy.createPermit(context);
    assert.notEqual(second, first);
    f.policy.revalidate({ ...context, permit: second });
    const receipt = f.policy.consume({ ...context, permit: second });
    assert.equal(receipt.status, "consumed");
  } finally { await f.close(); }
});

test("one-shot attempt invalidation blocks new permits and preparer invalidation drops cached candidates", async () => {
  const f = await makeFixture();
  try {
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: ttsRequest(f.voiceRef) });
    const context = { candidate, attemptId: ATTEMPT, principal: f.principal };
    f.policy.invalidateAttempt(ATTEMPT);
    assert.throws(() => f.policy.createPermit(context), (error: unknown) => code(error, "ATTEMPT_INVALIDATED"));
    f.preparer.invalidateAttempt(ATTEMPT);
    assert.equal(f.preparer.inspectCandidate(candidate), undefined);
    assert.throws(() => f.preparer.revalidateCandidate(context));
  } finally { await f.close(); }
});

test("caller cannot provide raw voice IDs, proxies, or a substituted voice resolver", async () => {
  const f = await makeFixture();
  try {
    await assert.rejects(f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: { ...ttsRequest(f.voiceRef), voice_id: VOICE_ID } }));
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    assert.equal(f.preparer.inspectCandidate(revoked.proxy), undefined);
    assert.equal(f.preparer.inspectCandidate({ attempt_id: ATTEMPT, voice_id: VOICE_ID }), undefined);
    const RequestPreparer = preparerModule!.OwnerElevenLabsTtsRequestPreparer as new (options: unknown) => unknown;
    assert.throws(() => new RequestPreparer({ voiceReferenceService: {
      async resolveVoice() { return { voice_id: VOICE_ID }; }, isOwnedVoiceResolution() { return true; }
    } }), (error: unknown) => code(error, "VOICE_SERVICE_UNTRUSTED"));
  } finally { await f.close(); }
});
