import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerVideo2AudioSourceProfile,
  isAuthenticOwnerVideo2AudioSourceProfile
} from "../src/application/owner-video2audio-source-profile.js";
import {
  normalizeOwnerVideo2AudioInput,
  validateOwnerVideo2AudioTrustedUploadDuration,
  OwnerVideo2AudioInputParametersError
} from "../src/application/owner-video2audio-input-parameters.js";

const MP4_BYTES = Uint8Array.from([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32
]);
const PROMPT = "Soft ripples move across the lake in a gentle breeze.";

function input(overrides: Record<string, unknown> = {}) {
  return { prompt: `  ${PROMPT}  `, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4_BYTES, ...overrides };
}

test("Video2Audio source profile is pinned to current B066/1b48 and remains source-only", () => {
  const profile = createOwnerVideo2AudioSourceProfile();
  assert.equal(isAuthenticOwnerVideo2AudioSourceProfile(profile), true);
  assert.equal(profile.source.identity.model_id, "video2audio");
  assert.equal(profile.source.identity.ai_name, "video2audio");
  assert.equal(profile.source.identity.operation_id, "generate-audio");
  assert.equal(profile.source.model_access_observation.account_scope, "HISTORICAL_OWNER_UI_OBSERVATION_NOT_CURRENT_USER_ENTITLEMENT");
  assert.equal(profile.source.model_access_observation.current_user_access, "NOT_READ");
  assert.deepEqual(profile.source.cost_projection.query_caller_keys, []);
  assert.equal(profile.source.defaults, "UNKNOWN");
  assert.equal(profile.source.runtime_usable, false);
  assert.equal(profile.source.dispatch_allowed, false);
  assert.equal(profile.source.backend_acceptance, "UNPROVEN");
});

test("pure normalizer trims Unicode prompt, copies the exact MP4, and creates no dispatch permission", () => {
  const profile = createOwnerVideo2AudioSourceProfile();
  const original = new Uint8Array(MP4_BYTES);
  const normalized = normalizeOwnerVideo2AudioInput(input({ prompt: `  ${PROMPT} 🌧️  `, bytes: original }), profile);
  original.fill(0);
  assert.equal(normalized.status, "SOURCE_REVIEWED_EXPLICIT_INPUT");
  assert.equal(normalized.model_id, "video2audio");
  assert.equal(normalized.prompt, `${PROMPT} 🌧️`);
  assert.equal(normalized.original.mime_type, "video/mp4");
  assert.equal(normalized.original.filename, "original.mp4");
  assert.equal(normalized.original.size, MP4_BYTES.byteLength);
  assert.deepEqual(normalized.original.bytes, MP4_BYTES);
  assert.equal(normalized.original.sha256.startsWith("sha256:"), true);
  assert.deepEqual(normalized.fixed_settings, { model_type: "video2audio", mode: "generate", negative_prompt: "", seed: 0 });
  assert.equal("duration" in normalized, false);
  assert.equal(normalized.duration_binding.status, "TRUSTED_UPLOAD_RECEIPT_REQUIRED");
  assert.equal(normalized.runtime_usable, false);
  assert.equal(normalized.dispatch_allowed, false);
  assert.equal(normalized.backend_acceptance, "UNPROVEN");
});

test("normalized original bytes are omitted from enumerable and JSON-visible metadata", () => {
  const normalized = normalizeOwnerVideo2AudioInput(input(), createOwnerVideo2AudioSourceProfile());
  assert.equal(Object.keys(normalized.original).includes("bytes"), false);
  assert.equal(JSON.stringify(normalized.original).includes("bytes"), false);
  assert.deepEqual(normalized.original.bytes, MP4_BYTES);
});

test("input normalization rejects a caller-supplied duration, URL, selector, or raw settings", () => {
  const profile = createOwnerVideo2AudioSourceProfile();
  for (const forbidden of [
    { duration: 5.64 }, { duration_seconds: 5.64 }, { file_url: "https://r2.syntx.ai/private.mp4" },
    { model_id: "another-model" }, { settings: { file_urls: [] } }
  ]) {
    assert.throws(() => normalizeOwnerVideo2AudioInput(input(forbidden), profile),
      (error: unknown) => error instanceof OwnerVideo2AudioInputParametersError && error.code === "INVALID_REQUEST");
  }
});

test("local validator accepts only a bounded MP4 file with matching name and declared MIME", () => {
  const profile = createOwnerVideo2AudioSourceProfile();
  const invalidInputs = [
    input({ mime_type: "video/quicktime" }),
    input({ filename: "original.mov" }),
    input({ bytes: Uint8Array.from([0, 0, 0, 8, 0, 0, 0, 0]) }),
    input({ bytes: new Uint8Array(0) }),
    input({ bytes: new Uint8Array(10 * 1024 * 1024 + 1) })
  ];
  for (const candidate of invalidInputs) {
    assert.throws(() => normalizeOwnerVideo2AudioInput(candidate, profile),
      (error: unknown) => error instanceof OwnerVideo2AudioInputParametersError && error.code === "ORIGINAL_VIDEO_INVALID");
  }
});

test("a revoked proxy around upload bytes is rejected with the fixed validation error", () => {
  const profile = createOwnerVideo2AudioSourceProfile();
  const revocable = Proxy.revocable(new Uint8Array(MP4_BYTES), {});
  revocable.revoke();
  assert.throws(() => normalizeOwnerVideo2AudioInput(input({ bytes: revocable.proxy }), profile),
    (error: unknown) => error instanceof OwnerVideo2AudioInputParametersError && error.code === "ORIGINAL_VIDEO_INVALID");
});

test("prompt local UTF-16 cap and Unicode well-formedness are enforced without claiming provider maximum", () => {
  const profile = createOwnerVideo2AudioSourceProfile();
  const exactLimit = "a".repeat(5_000);
  assert.equal(normalizeOwnerVideo2AudioInput(input({ prompt: exactLimit }), profile).prompt.length, 5_000);
  for (const prompt of [" \n ", "a".repeat(5_001), "bad\ud800"]) {
    assert.throws(() => normalizeOwnerVideo2AudioInput(input({ prompt }), profile),
      (error: unknown) => error instanceof OwnerVideo2AudioInputParametersError && error.code === "PROMPT_INVALID");
  }
  assert.equal(profile.source.controls.prompt.source_max_length, "UNKNOWN");
});

test("trusted upload duration is finite, positive, and bounded only by the UI hint", () => {
  const profile = createOwnerVideo2AudioSourceProfile();
  assert.equal(validateOwnerVideo2AudioTrustedUploadDuration(5.64, profile), 5.64);
  assert.equal(validateOwnerVideo2AudioTrustedUploadDuration(20, profile), 20);
  for (const duration of [0, -0.1, 20.001, Number.NaN, Number.POSITIVE_INFINITY, "5.64"]) {
    assert.throws(() => validateOwnerVideo2AudioTrustedUploadDuration(duration, profile),
      (error: unknown) => error instanceof OwnerVideo2AudioInputParametersError && error.code === "TRUSTED_UPLOAD_DURATION_INVALID");
  }
  assert.equal(profile.source.controls.duration.source, "TRUSTED_UPLOAD_METADATA_REQUIRED");
  assert.equal(profile.source.controls.duration.max_semantics, "UI_HINT_ONLY_NOT_BACKEND_LIMIT");
});

test("a structurally cloned Video2Audio profile is not accepted as a sealed source", () => {
  const profile = createOwnerVideo2AudioSourceProfile();
  const clone = Object.freeze({ ...profile });
  assert.equal(isAuthenticOwnerVideo2AudioSourceProfile(clone), false);
  assert.throws(() => normalizeOwnerVideo2AudioInput(input(), clone),
    (error: unknown) => error instanceof OwnerVideo2AudioInputParametersError && error.code === "SOURCE_PROFILE_INVALID");
});
