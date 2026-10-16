import assert from "node:assert/strict";
import test from "node:test";
import * as importedParameters from "../src/application/owner-wan27-videoedit-parameters.js";

const PARAMETERS_API = importedParameters as unknown as {
  normalizeOwnerWan27VideoEditParameters(input: unknown): Readonly<Record<string, unknown>>;
  getOwnerWan27VideoEditSourceProfile(): Readonly<Record<string, unknown>>;
  OWNER_WAN27_VIDEOEDIT_PARAMETERS_SOURCE: Readonly<Record<string, unknown>>;
};

function request(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    model_id: "wan_27_videoedit",
    prompt: "A short scene with a slow camera move.",
    resolution: "720P",
    aspect_ratio: "16:9",
    audio_setting: "auto",
    prompt_extend: true,
    seed: null,
    duration_mode: "preserve_input",
    source_input_duration_seconds: 2.37,
    ...overrides
  };
}

function invalidParameters(error: unknown): boolean {
  return error instanceof Error && (error as Error & { code?: unknown }).code === "INVALID_PARAMETERS";
}

function normalized(input: unknown): Readonly<Record<string, unknown>> {
  return PARAMETERS_API.normalizeOwnerWan27VideoEditParameters(input);
}

function settingsOf(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const intent = value.intent as Readonly<Record<string, unknown>>;
  return intent.settings as Readonly<Record<string, unknown>>;
}

test("projects preserve-input fractional seconds and explicit native fields without authority", () => {
  const result = normalized(request());
  const intent = result.intent as Readonly<Record<string, unknown>>;
  assert.equal(intent.model_id, "wan_27_videoedit");
  assert.equal(intent.prompt, "A short scene with a slow camera move.");
  assert.deepEqual(settingsOf(result), {
    model_type: "wan_27_videoedit",
    resolution: "720P",
    aspect_ratio: "16:9",
    video_duration: 2.37,
    audio_setting: "auto",
    prompt_extend: true,
    seed: null,
    native_audio: false,
    shot_type: "single",
    duration: 2.37,
    rendering_speed: "basic"
  });
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.runtime_usable, false);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal(result.effective_defaults, "UNKNOWN");
  assert.deepEqual(result.source_input_duration_context, {
    seconds: 2.37,
    authority: "SOURCE_ONLY_NOT_VALIDATED_VIDEO_RECEIPT"
  });
  assert.match(String(result.intent_fingerprint), /^sha256:[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(intent));
  assert.ok(Object.isFrozen(intent.settings));
});

test("projects custom integer duration while preserving seed zero and audio mode", () => {
  const result = normalized(request({
    resolution: "1080P",
    aspect_ratio: "3:4",
    audio_setting: "origin",
    prompt_extend: false,
    seed: 0,
    duration_mode: "custom",
    custom_video_duration: 3,
    source_input_duration_seconds: 7.99
  }));
  assert.deepEqual(settingsOf(result), {
    model_type: "wan_27_videoedit",
    resolution: "1080P",
    aspect_ratio: "3:4",
    video_duration: 3,
    audio_setting: "origin",
    prompt_extend: false,
    seed: 0,
    native_audio: false,
    shot_type: "single",
    duration: 7.99,
    rendering_speed: "basic"
  });
});

test("fingerprints aliases by their normalized native intent, not duration_mode", () => {
  const preserve = normalized(request({ source_input_duration_seconds: 2 }));
  const custom = normalized(request({ duration_mode: "custom", custom_video_duration: 2, source_input_duration_seconds: 2 }));
  assert.deepEqual(settingsOf(preserve), settingsOf(custom));
  assert.notEqual(preserve.duration_mode, custom.duration_mode);
  assert.equal(preserve.intent_fingerprint, custom.intent_fingerprint);
});

test("bounds custom duration by floor(input seconds), with inclusive 2 and 10 endpoints", () => {
  assert.equal(settingsOf(normalized(request({ duration_mode: "custom", custom_video_duration: 2 }))).video_duration, 2);
  assert.equal(settingsOf(normalized(request({ duration_mode: "custom", custom_video_duration: 10, source_input_duration_seconds: 10 }))).video_duration, 10);
  for (const custom_video_duration of [1, 2.5, 3, 11, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => normalized(request({ duration_mode: "custom", custom_video_duration })), invalidParameters);
  }
  assert.throws(() => normalized(request({ duration_mode: "custom", source_input_duration_seconds: 2 })), invalidParameters);
  assert.throws(() => normalized(request({ duration_mode: "preserve_input", custom_video_duration: 2 })), invalidParameters);
});

test("rejects non-target model, invalid source duration, caller wire overrides, and hostile input records", () => {
  assert.throws(() => normalized(request({ model_id: "wan_27_r2v" })), invalidParameters);
  for (const source_input_duration_seconds of [Number.NaN, Number.POSITIVE_INFINITY, 1.99, 10.01, 20]) {
    assert.throws(() => normalized(request({ source_input_duration_seconds })), invalidParameters);
  }
  for (const field of ["video_duration", "native_audio", "duration", "model_type", "file_urls", "chat_id", "unknown"]) {
    assert.throws(() => normalized(request({ [field]: 2 })), invalidParameters);
  }
  assert.throws(() => normalized(new Proxy(request(), {})), invalidParameters);
  const getter = request();
  Object.defineProperty(getter, "prompt", { enumerable: true, get: () => "getter must not run" });
  assert.throws(() => normalized(getter), invalidParameters);
});

test("uses a conservative 1500 UTF-16 prompt guard and preserves target source gaps", () => {
  const maximum = "x".repeat(1_500);
  assert.equal((normalized(request({ prompt: maximum })).intent as Record<string, unknown>).prompt, maximum);
  assert.throws(() => normalized(request({ prompt: "x".repeat(1_501) })), invalidParameters);
  assert.throws(() => normalized(request({ prompt: "   " })), invalidParameters);
  const source = PARAMETERS_API.getOwnerWan27VideoEditSourceProfile();
  assert.equal(source.model_id, "wan_27_videoedit");
  assert.equal(source.ai_name, "wan_video");
  assert.match(String(source.source_sha256), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(source.source_sha256, PARAMETERS_API.OWNER_WAN27_VIDEOEDIT_PARAMETERS_SOURCE.source_sha256);
  assert.equal(source.runtime_usable, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
  assert.equal(source.provider_defaults, "UNPROVEN");
  assert.ok(Object.isFrozen(source));
});
