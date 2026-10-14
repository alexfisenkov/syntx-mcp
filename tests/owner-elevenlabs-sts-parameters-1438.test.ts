import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/application/owner-elevenlabs-sts-parameters.js", import.meta.url).href;
const moduleValue = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;

type Normalize = (input: unknown) => Record<string, unknown>;
const request = Object.freeze({
  model_id: "eleven_multilingual_sts_v2",
  mode: "speech_to_speech",
  audio_original_handle: "elevenlabs_sts_original_00000000-0000-4000-8000-000000000000",
  voice_ref: "owner_elevenlabs_voice_00000000-0000-4000-8000-000000000001"
});

function normalize(input: unknown = request): Record<string, unknown> {
  assert.ok(moduleValue, "MISSING_OWNER_ELEVENLABS_STS_PARAMETERS_MODULE");
  const normalizeRequest = moduleValue.normalizeOwnerElevenLabsStsParameters as Normalize;
  assert.equal(typeof normalizeRequest, "function", "MISSING_OWNER_ELEVENLABS_STS_PARAMETERS_NORMALIZER");
  return normalizeRequest(input);
}

function invalidParameters(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "INVALID_PARAMETERS";
}

test("normalizes the fixed STS v2 request using only opaque owner references", () => {
  const result = normalize();
  assert.deepEqual(result, {
    model_id: "eleven_multilingual_sts_v2",
    mode: "speech_to_speech",
    audio_original_handle: request.audio_original_handle,
    voice_ref: request.voice_ref,
    source_scope: "PARTIAL_OWNER_STS_PARAMETERS",
    runtime_usable: false,
    generation_allowed: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal("duration" in result, false);
  assert.equal("prompt" in result, false);
  assert.equal("settings" in result, false);
});

test("keeps the one WAV refusal tuple and decoder cardinality bound explicitly scoped", () => {
  assert.ok(moduleValue, "MISSING_OWNER_ELEVENLABS_STS_PARAMETERS_MODULE");
  const getProfile = moduleValue.getOwnerElevenLabsStsParameterProfile as () => Record<string, any>;
  assert.equal(typeof getProfile, "function", "MISSING_OWNER_ELEVENLABS_STS_PARAMETER_PROFILE");
  const profile = getProfile();
  assert.equal(profile.input_boundary.wav, "WAV1418_UPLOAD_REJECTED;NOT_PROMOTED");
  assert.equal(profile.result_output_policy, "ONE_OBJECT_LOCAL_BOUND");
});

test("rejects caller duration, prompts, arbitrary settings, and unknown fields", () => {
  for (const extra of [
    { duration: 11 }, { prompt: "caller text" }, { settings: {} }, { file_urls: ["https://example.invalid/a.mp3"] }
  ]) {
    assert.throws(() => normalize({ ...request, ...extra }), invalidParameters);
  }
});

test("rejects raw URLs, provider identifiers, foreign model or mode, and malformed handles", () => {
  const invalid = [
    { ...request, audio_original_handle: "https://r2.syntx.ai/private.mp3" },
    { ...request, audio_original_handle: "provider-file-123" },
    { ...request, voice_ref: "provider-voice-id" },
    { ...request, model_id: "eleven_multilingual_v2" },
    { ...request, mode: "text_to_speech" },
    { ...request, audio_original_handle: "elevenlabs_sts_original_not-a-uuid" }
  ];
  for (const value of invalid) assert.throws(() => normalize(value), invalidParameters);
});

test("rejects proxy input without invoking caller accessors", () => {
  let reads = 0;
  const input = { ...request };
  Object.defineProperty(input, "mode", { enumerable: true, get() { reads += 1; return request.mode; } });
  assert.throws(() => normalize(input), invalidParameters);
  const revoked = Proxy.revocable({ ...request }, {});
  revoked.revoke();
  assert.throws(() => normalize(revoked.proxy), invalidParameters);
  assert.equal(reads, 0);
});
