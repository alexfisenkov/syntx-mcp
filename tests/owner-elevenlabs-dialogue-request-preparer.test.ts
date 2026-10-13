import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import type { AuthLinkProvider } from "../src/auth/types.js";

const MODULE_URL = new URL("../src/application/owner-elevenlabs-dialogue-request-preparer.js", import.meta.url).href;
const moduleApi = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPT = "link_elevenlabs_dialogue_preparer_0123456789";
const BINDING = Object.freeze({ tenant_id: "elevenlabs-dialogue-tenant", subject: "elevenlabs-dialogue-owner" });
const CREDENTIAL = "synthetic-elevenlabs-dialogue-credential";
const VOICE_IDS = ["provider_voice_dialogue_A", "provider_voice_dialogue_B"] as const;
const stores = new Set<InMemoryAuthLinkStore>();

afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

interface PreparerApi {
  prepare(input: unknown): Promise<Record<string, unknown>>;
  inspectCandidate(candidate: unknown): Record<string, unknown> | undefined;
  revalidateCandidate(input: unknown): Record<string, unknown>;
  invalidateAttempt(attemptId: unknown): void;
  close(): void;
}
interface VoiceServiceApi {
  listVoices(input: unknown): Promise<Record<string, unknown>>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}
interface Fixture {
  readonly principal: Readonly<Record<string, unknown>>;
  readonly voiceRefs: readonly string[];
  readonly voiceIds: typeof VOICE_IDS;
  readonly preparer: PreparerApi;
  readonly voiceService: VoiceServiceApi;
  close(): Promise<void>;
}

function code(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected;
}

async function fixture(): Promise<Fixture> {
  let now = Date.parse("2026-10-14T00:00:00.000Z");
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-dialogue-challenge", approval_url: "https://example.invalid/" }; },
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
    { voice_id: VOICE_IDS[0], name: "Synthetic dialogue voice A" },
    { voice_id: VOICE_IDS[1], name: "Synthetic dialogue voice B" }
  ]), { headers: { "content-type": "application/json" } }) });
  const VoiceService = (await import("../src/application/owner-elevenlabs-voice-reference-service.js"))
    .OwnerElevenLabsVoiceReferenceService as unknown as new (options: unknown) => VoiceServiceApi;
  const voiceService = new VoiceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: () => now });
  const listing = await voiceService.listVoices({ attemptId: ATTEMPT });
  const voiceRefs = (listing.voices as Array<Record<string, unknown>>).map((voice) => String(voice.voice_ref));
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService: links });
  const Preparer = moduleApi?.OwnerElevenLabsDialogueRequestPreparer as new (options: unknown) => PreparerApi;
  assert.equal(typeof Preparer, "function", "MISSING_OWNER_ELEVENLABS_DIALOGUE_REQUEST_PREPARER");
  const preparer = new Preparer!({ voiceReferenceService: voiceService, now: () => now });
  return { principal, voiceRefs, voiceIds: VOICE_IDS, preparer, voiceService,
    async close() { preparer.close(); await voiceService.close(); } };
}

function dialogueRequest(voiceRefs: readonly string[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model_id: "eleven_v4",
    mode: "text_to_dialogue",
    prompt: "",
    inputs: [
      { name: "Guide", text: "First line 😀.", voice_ref: voiceRefs[0] },
      { name: "Guest", text: "Second line.", voice_ref: voiceRefs[1] }
    ],
    stability: 0.35,
    similarity_boost: 0.65,
    ...overrides
  };
}

test("ElevenLabs dialogue preparer exists as a separate internal seam", () => {
  assert.equal(typeof moduleApi?.OwnerElevenLabsDialogueRequestPreparer, "function");
  assert.equal(typeof moduleApi?.getOwnerElevenLabsDialogueSourceProfile, "function");
});

test("prepared dialogue keeps ordered lines and private voice resolution out of the candidate", async () => {
  const f = await fixture();
  try {
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: dialogueRequest(f.voiceRefs) });
    assert.equal(candidate.model_id, "eleven_v4");
    assert.equal(candidate.mode, "text_to_dialogue");
    assert.equal(candidate.line_count, 2);
    assert.equal(candidate.chars_count, 26, "dialogue UTF-16 count includes the astral symbol as two code units");
    assert.equal(candidate.prompt_length, 0);
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.generation_allowed, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    for (const secret of [...VOICE_IDS, ...f.voiceRefs, "First line", "Second line", "Guide", "Guest"]) {
      assert.equal(JSON.stringify(candidate).includes(secret), false);
    }
    const getPrivateRequest = moduleApi?.getOwnerElevenLabsDialoguePrivateRequestForPolicy as
      (candidate: unknown) => Record<string, unknown>;
    const privateRequest = getPrivateRequest(candidate);
    assert.equal(privateRequest.prompt, "");
    assert.deepEqual(privateRequest.settings, {
      model_type: "eleven_v4", mode: "text_to_dialogue", chars_count: 26,
      inputs: [
        { name: "Guide", text: "First line 😀.", voice_id: VOICE_IDS[0] },
        { name: "Guest", text: "Second line.", voice_id: VOICE_IDS[1] }
      ],
      stability: 0.35, similarity_boost: 0.65, language_code: "auto"
    });
    const context = { candidate, attemptId: ATTEMPT, principal: f.principal };
    assert.equal(f.preparer.inspectCandidate(candidate)?.line_count, 2);
    assert.equal(f.preparer.revalidateCandidate(context).model_id, "eleven_v4");
    assert.equal(candidate.dispatch_allowed, false);
  } finally { await f.close(); }
});

test("V3 dialogue omits V4-only controls; unsupported model IDs and raw voice IDs fail closed", async () => {
  const f = await fixture();
  try {
    const v3 = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: dialogueRequest(f.voiceRefs, { model_id: "eleven_v3", stability: 0.5, similarity_boost: 0.5 }) });
    const getPrivateRequest = moduleApi?.getOwnerElevenLabsDialoguePrivateRequestForPolicy as
      (candidate: unknown) => { settings: Record<string, unknown> };
    const settings = getPrivateRequest(v3).settings;
    assert.equal(settings.mode, "text_to_dialogue");
    assert.equal(Object.hasOwn(settings, "stability"), false);
    assert.equal(Object.hasOwn(settings, "similarity_boost"), false);
    assert.equal(Object.hasOwn(settings, "language_code"), false);

    await assert.rejects(f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: dialogueRequest(f.voiceRefs, { model_id: "eleven_multilingual_v2" }) }),
    (error: unknown) => code(error, "INVALID_REQUEST"));
    const rawVoiceId = VOICE_IDS[0];
    const secondVoiceRef = f.voiceRefs[1];
    assert.ok(rawVoiceId);
    assert.ok(secondVoiceRef);
    await assert.rejects(f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: dialogueRequest([rawVoiceId, secondVoiceRef]) }),
    (error: unknown) => code(error, "INVALID_REQUEST"));
    const firstVoiceRef = f.voiceRefs[0];
    assert.ok(firstVoiceRef);
    await assert.rejects(f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: dialogueRequest(f.voiceRefs, { inputs: [{ name: "A", text: "one", voice_ref: firstVoiceRef }] }) }),
    (error: unknown) => code(error, "PARAMETERS_INVALID"));
  } finally { await f.close(); }
});

test("caller prompt is an explicit separate field, preserved privately and bounded by the model prompt limit", async () => {
  const f = await fixture();
  try {
    const prompt = "Operator context 😀";
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: dialogueRequest(f.voiceRefs, { prompt }) });
    assert.equal(candidate.prompt_length, prompt.length);
    assert.equal(JSON.stringify(candidate).includes(prompt), false);
    const getPrivateRequest = moduleApi?.getOwnerElevenLabsDialoguePrivateRequestForPolicy as
      (candidate: unknown) => { prompt: string; settings: Record<string, unknown> };
    assert.equal(getPrivateRequest(candidate).prompt, prompt);
    assert.equal(getPrivateRequest(candidate).settings.chars_count, 26, "outer prompt is excluded from dialogue cost count");

    await assert.rejects(f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: dialogueRequest(f.voiceRefs, { prompt: "x".repeat(10_001) }) }),
    (error: unknown) => code(error, "PARAMETERS_INVALID"));
  } finally { await f.close(); }
});

test("voice-handle invalidation expires the prepared dialogue candidate", async () => {
  const f = await fixture();
  try {
    const candidate = await f.preparer.prepare({ attemptId: ATTEMPT, principal: f.principal,
      request: dialogueRequest(f.voiceRefs) });
    const context = { candidate, attemptId: ATTEMPT, principal: f.principal };
    await f.voiceService.invalidateAttempt(ATTEMPT);
    assert.throws(() => f.preparer.revalidateCandidate(context), (error: unknown) => code(error, "VOICE_REFERENCE_UNAVAILABLE"));
  } finally { await f.close(); }
});
