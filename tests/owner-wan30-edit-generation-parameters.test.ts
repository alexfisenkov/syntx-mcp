import test from "node:test";
import assert from "node:assert/strict";
import {
  getOwnerWan30EditGenerationSourceContract,
  normalizeOwnerWan30EditGenerationIntent,
  OwnerWan30EditGenerationParametersError
} from "../src/application/owner-wan30-edit-generation-parameters.js";

const VALID = {
  prompt: "Keep the subject's motion and surroundings natural.",
  parameters: {
    aspect_ratio: "16:9",
    resolution: "480P",
    video_duration: 2,
    prompt_extend: true,
    shot_type: "single",
    audio_setting: "auto",
    seed: null,
    native_audio: true,
    duration: 2,
    rendering_speed: "basic"
  }
} as const;

const rejects = (input: unknown) => assert.throws(
  () => normalizeOwnerWan30EditGenerationIntent(input),
  (error: unknown) => error instanceof OwnerWan30EditGenerationParametersError && error.code === "INVALID_PARAMETERS"
);

test("source contract records only the observed Edit request, tuple, quote and ACK semantics", () => {
  const source = getOwnerWan30EditGenerationSourceContract();
  assert.equal(source.profile_id, "owner-wan30-edit-web-request-observed-1918");
  assert.equal(source.status, "LIVE_UI_SINGLE_REQUEST_OBSERVED");
  assert.equal(source.model_id, "wan_30_edit");
  assert.equal(source.ai_name, "wan_video");
  assert.equal(source.source_pins.public_catalog_version,
    "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json");
  assert.equal(source.source_pins.model_source_sha256,
    "20b8c6482d72dbb4bf7e6500a0fbc0514eeac29bf5b7170559cd7665045583e3");
  assert.equal(source.current_form_source, "NOT_REOBSERVED");
  assert.deepEqual(source.wire_observation.request_body_keys, ["chat_id", "prompt", "settings"]);
  assert.equal(source.wire_observation.method, "POST");
  assert.equal(source.wire_observation.path, "/api/v1/video/generate");
  assert.equal(source.wire_observation.query, "ai_name=wan_video");
  assert.deepEqual(source.wire_observation.settings_keys, [
    "model_type", "file_urls", "aspect_ratio", "resolution", "video_duration", "prompt_extend",
    "shot_type", "audio_setting", "seed", "native_audio", "duration", "rendering_speed"
  ]);
  assert.deepEqual(source.wire_observation.file_urls_entry, {
    type: "video", url_source: "TRUSTED_NATIVE_OWN_UPLOAD_WITNESS"
  });
  assert.equal(source.wire_observation.prompt_serialization,
    "EXACT_PLAIN_CALLER_PROMPT_NO_REFERENCE_MARKERS_NO_ADDED_SPACE");
  assert.deepEqual(source.owner_ack_observation.object_types_in_order, ["text", "video"]);
  assert.equal(source.owner_ack_observation.matching_policy, "EXACT_SET_ANY_ORDER_NOT_ORDER_PROOF");
  assert.equal(source.owner_ack_observation.text_object_matches, "EXACT_PLAIN_WIRE_PROMPT");
  assert.equal(source.owner_ack_observation.video_object_url_matches, "EXACT_UPLOADED_URL");
  assert.deepEqual(source.quote_observation.observed_keys,
    ["resolution", "video_duration", "duration", "rendering_speed"]);
  assert.deepEqual(source.quote_observation.observed_values, {
    resolution: "480P", video_duration: 2, duration: 2, rendering_speed: "basic"
  });
  assert.equal(source.quote_observation.billing_semantics, "UNPROVEN");
  assert.deepEqual(source.historical_pre_upload_ui_state, {
    evidence: "BEFORE_OWN_VIDEO_UPLOAD", native_audio: false, duration: 0,
    default_semantics: "NOT_ESTABLISHED"
  });
  assert.equal(source.profile_scope.other_formats_and_durations, "UNKNOWN");
  assert.equal(source.profile_scope.other_settings, "UNKNOWN");
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.runtime_usable, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
});

test("normalizer preserves the exact plain prompt and accepts only the observed tuple", () => {
  const prompt = "  Keep this exact text, including https://example.invalid and <<<literal text>>>  ";
  const result = normalizeOwnerWan30EditGenerationIntent({ ...VALID, prompt });
  assert.equal(result.intent.model_id, "wan_30_edit");
  assert.equal(result.intent.prompt, prompt);
  assert.deepEqual(result.intent.parameters, VALID.parameters);
  assert.equal(result.source_profile_id, "owner-wan30-edit-web-request-observed-1918");
  assert.equal(result.effective_defaults, "UNKNOWN");
  assert.equal(result.runtime_usable, false);
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.backend_acceptance, "UNPROVEN");

  rejects({ ...VALID, prompt: "   " });
  rejects({ ...VALID, prompt: "invalid-\ud800" });
  rejects({ ...VALID, prompt: `${"x".repeat(20_000)}x` });
  rejects({ ...VALID, parameters: { ...VALID.parameters, native_audio: false } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, duration: 0 } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, resolution: "720P" } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, unknown_setting: true } });
});

test("pure intent excludes caller URL, chat id, and model type bindings", () => {
  rejects({ ...VALID, file_urls: [{ type: "video", url: "caller-url" }] });
  rejects({ ...VALID, chat_id: "caller-chat" });
  rejects({ ...VALID, model_type: "wan_30_edit" });
  rejects({ ...VALID, parameters: { ...VALID.parameters, file_urls: [{ type: "video", url: "caller-url" }] } });
});

test("strict records reject accessors and proxies without executing getters", () => {
  let getterRuns = 0;
  const parameterGetter = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(VALID.parameters)) {
    Object.defineProperty(parameterGetter, key, { enumerable: true, get: () => { getterRuns += 1; return value; } });
  }
  rejects({ ...VALID, parameters: parameterGetter });
  assert.equal(getterRuns, 0);
  const revoked = Proxy.revocable({ ...VALID }, {});
  revoked.revoke();
  rejects(revoked.proxy);
});
