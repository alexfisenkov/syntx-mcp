import test from "node:test";
import assert from "node:assert/strict";
import {
  getOwnerWan30OmniGenerationSourceContract,
  normalizeOwnerWan30OmniGenerationIntent,
  OwnerWan30OmniGenerationParametersError,
  projectOwnerWan30OmniGenerationWireCandidate
} from "../src/application/owner-wan30-omni-generation-parameters.js";

const VALID = {
  prompt: "A calm aerial shot over a paper lantern; keep this scene coherent",
  parameters: {
    aspect_ratio: "16:9",
    resolution: "480P",
    video_duration: 2,
    prompt_extend: true,
    shot_type: "single",
    audio_setting: "auto",
    seed: null,
    native_audio: false,
    duration: 0,
    rendering_speed: "basic"
  }
} as const;

const rejects = (input: unknown) => assert.throws(
  () => normalizeOwnerWan30OmniGenerationIntent(input),
  (error: unknown) => error instanceof OwnerWan30OmniGenerationParametersError && error.code === "INVALID_PARAMETERS"
);

test("source contract binds the one Omni UI tuple, exact wire shape, and exact owner ACK facts", () => {
  const source = getOwnerWan30OmniGenerationSourceContract();
  assert.equal(source.profile_id, "owner-wan30-omni-web-request-observed-1874");
  assert.equal(source.status, "WEB_REQUEST_OBSERVED_SINGLE_TUPLE");
  assert.equal(source.model_id, "wan_30_omni");
  assert.equal(source.ai_name, "wan_video");
  assert.equal(source.source_pins.public_catalog_version,
    "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json");
  assert.equal(source.source_pins.form_build_id, "1792069332");
  assert.equal(source.source_pins.form_module_sha256,
    "25e2fb226a57a9134541e26fee726d18f9075bc90f428610c3733950a58c7423");
  assert.equal(source.source_pins.video_sender_module_sha256,
    "3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b");
  assert.deepEqual(source.wire_observation.request_body_keys, ["chat_id", "prompt", "settings"]);
  assert.deepEqual(source.wire_observation.settings_keys, [
    "model_type", "file_urls", "aspect_ratio", "resolution", "video_duration", "prompt_extend",
    "shot_type", "audio_setting", "seed", "native_audio", "duration", "rendering_speed"
  ]);
  assert.deepEqual(source.wire_observation.file_urls_entry_types, ["image"]);
  assert.equal(source.wire_observation.reference_count, 1);
  assert.equal(source.wire_observation.prompt_serialization.form, "<<<[OWN_REFERENCE_URL]>>> [PROMPT] ");
  assert.deepEqual(source.owner_ack_observation.object_types_in_order, ["text", "image"]);
  assert.equal(source.owner_ack_observation.model_id, "wan_30_omni");
  assert.equal(source.owner_ack_observation.text_object_matches, "EXACT_WIRE_PROMPT");
  assert.equal(source.owner_ack_observation.image_object_url_matches, "EXACT_FILE_URL");
  assert.deepEqual(source.quote_observation.observed_keys, ["resolution", "video_duration", "duration", "rendering_speed"]);
  assert.deepEqual(source.quote_observation.observed_values, {
    resolution: "480P", video_duration: 2, duration: 0, rendering_speed: "basic"
  });
  assert.equal(source.quote_observation.billing_semantics, "UNPROVEN");
  assert.equal(source.controls.valid_combinations, "UNPROVEN");
  assert.equal(source.profile_scope.other_omni_input_variants, "NOT_COVERED");
  assert.equal(source.effective_defaults, "UNKNOWN");
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
});

test("normalizer preserves prompt text including ordinary URLs and rejects delimiter injection or tuple changes", () => {
  const prompt = "Keep the existing scene; a citation such as https://example.invalid/path is plain prompt text";
  const result = normalizeOwnerWan30OmniGenerationIntent({ ...VALID, prompt });
  assert.equal(result.intent.model_id, "wan_30_omni");
  assert.equal(result.intent.prompt, prompt);
  assert.deepEqual(result.intent.parameters, VALID.parameters);
  assert.equal(result.runtime_usable, false);
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.backend_acceptance, "UNPROVEN");

  rejects({ ...VALID, prompt: "text <<<caller reference>>>" });
  rejects({ ...VALID, prompt: "invalid-\ud800" });
  rejects({ ...VALID, prompt: "   " });
  rejects({ ...VALID, prompt: `${"x".repeat(20_000)}x` });
  rejects({ ...VALID, parameters: { ...VALID.parameters, resolution: "720P" } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, audio_setting: "basic" } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, seed: 7 } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, unknown_setting: true } });
});

test("wire candidate contains only the 11 scalar settings and leaves the single image binding separate", () => {
  const normalized = normalizeOwnerWan30OmniGenerationIntent(VALID);
  const candidate = projectOwnerWan30OmniGenerationWireCandidate(normalized.intent);
  assert.deepEqual(candidate.settings_candidate, {
    model_type: "wan_30_omni",
    aspect_ratio: "16:9",
    resolution: "480P",
    video_duration: 2,
    prompt_extend: true,
    shot_type: "single",
    audio_setting: "auto",
    seed: null,
    native_audio: false,
    duration: 0,
    rendering_speed: "basic"
  });
  assert.equal(Object.keys(candidate.settings_candidate).length, 11);
  assert.equal(candidate.prompt_candidate, VALID.prompt);
  assert.deepEqual(candidate.required_reference_slots, ["image"]);
  assert.deepEqual(candidate.reference_prompt_plan, {
    form: "<<<[OWN_REFERENCE_URL]>>> [PROMPT] ",
    reference_prefix: "<<<",
    reference_suffix: ">>>",
    prompt_separator: " ",
    trailing_space: true,
    file_urls_entry_type: "image",
    file_urls_bound: false,
    trusted_reference_url_required: true,
    url_source: "TRUSTED_OWNER_OMNI_IMAGE_LAYER_NOT_ACCEPTED_HERE"
  });
  assert.equal(Object.hasOwn(candidate.settings_candidate, "file_urls"), false);
  assert.equal(candidate.chat_id_bound, false);
  assert.equal(candidate.dispatch_allowed, false);
  assert.equal(candidate.backend_acceptance, "UNPROVEN");
});

test("projection rejects model substitution and caller URL or file-url fields", () => {
  const normalized = normalizeOwnerWan30OmniGenerationIntent(VALID);
  assert.throws(() => projectOwnerWan30OmniGenerationWireCandidate({ ...normalized.intent, model_id: "wan_30_reference" }),
    OwnerWan30OmniGenerationParametersError);
  assert.throws(() => projectOwnerWan30OmniGenerationWireCandidate({ ...normalized.intent,
    file_urls: [{ type: "image", url: "caller-reference" }] }), OwnerWan30OmniGenerationParametersError);
  rejects({ ...VALID, parameters: { ...VALID.parameters, file_urls: [{ type: "image", url: "caller-reference" }] } });
});

test("strict records reject proxies and accessors without executing getters", () => {
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
