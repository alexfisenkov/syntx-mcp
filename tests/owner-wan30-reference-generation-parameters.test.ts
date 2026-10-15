import test from "node:test";
import assert from "node:assert/strict";
import {
  getOwnerWan30ReferenceGenerationSourceContract,
  normalizeOwnerWan30ReferenceGenerationIntent,
  OwnerWan30ReferenceGenerationParametersError,
  projectOwnerWan30ReferenceGenerationWireCandidate
} from "../src/application/owner-wan30-reference-generation-parameters.js";

const VALID = {
  prompt: "A paper lantern floats above a quiet blue lake",
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
  () => normalizeOwnerWan30ReferenceGenerationIntent(input),
  (error: unknown) => error instanceof OwnerWan30ReferenceGenerationParametersError && error.code === "INVALID_PARAMETERS"
);

test("source contract pins the Reference UI POST, selected-mode quote, and one observed tuple", () => {
  const source = getOwnerWan30ReferenceGenerationSourceContract();
  assert.equal(source.profile_id, "owner-wan30-reference-web-request-observed-1865");
  assert.equal(source.status, "WEB_REQUEST_OBSERVED_SINGLE_TUPLE");
  assert.equal(source.model_id, "wan_30_reference");
  assert.equal(source.ai_name, "wan_video");
  assert.equal(source.source_pins.form_build_id, "1792069332");
  assert.equal(source.source_pins.form_module_sha256,
    "25e2fb226a57a9134541e26fee726d18f9075bc90f428610c3733950a58c7423");
  assert.equal(source.wire_observation.evidence, "ONE_ORDINARY_UI_POST_HTTP_200");
  assert.equal(source.quote_observation.path, "/api/v2/get_model_info");
  assert.deepEqual(source.wire_observation.request_body_keys, ["chat_id", "prompt", "settings"]);
  assert.deepEqual(source.wire_observation.settings_keys, [
    "model_type", "file_urls", "aspect_ratio", "resolution", "video_duration", "prompt_extend",
    "shot_type", "audio_setting", "seed", "native_audio", "duration", "rendering_speed"
  ]);
  assert.deepEqual(source.wire_observation.file_urls_entry_types, ["image"]);
  assert.deepEqual(source.quote_observation.observed_keys, ["resolution", "video_duration", "duration", "rendering_speed"]);
  assert.equal(source.quote_observation.full_constraints, "UNPROVEN");
  assert.equal(source.controls.local_operator_allowlist_only, true);
  assert.equal(source.prompt_limit.source, "UI_COUNTER_LOCAL_OPERATOR_BOUND_NOT_PROVIDER_LIMIT");
  assert.equal(source.effective_defaults, "UNKNOWN");
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
});

test("normalizer preserves prompt verbatim but rejects delimiters, excess length, and any other tuple", () => {
  const prompt = ` ${"x".repeat(19_998)} `;
  const result = normalizeOwnerWan30ReferenceGenerationIntent({ ...VALID, prompt });
  assert.equal(result.intent.model_id, "wan_30_reference");
  assert.equal(result.intent.prompt, prompt);
  assert.deepEqual(result.intent.parameters, VALID.parameters);
  assert.equal(result.runtime_usable, false);
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  rejects({ ...VALID, prompt: `${prompt}x` });
  rejects({ ...VALID, prompt: "text <<<reference>>>" });
  rejects({ ...VALID, prompt: "invalid-\ud800" });
  rejects({ ...VALID, prompt: "   " });
  rejects({ ...VALID, parameters: { ...VALID.parameters, resolution: "720P" } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, audio_setting: "basic" } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, seed: 1 } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, unknown_setting: true } });
});

test("wire candidate is a literal 11-scalar projection and keeps URL binding outside settings", () => {
  const normalized = normalizeOwnerWan30ReferenceGenerationIntent(VALID);
  const candidate = projectOwnerWan30ReferenceGenerationWireCandidate(normalized.intent);
  assert.deepEqual(candidate.settings_candidate, {
    model_type: "wan_30_reference",
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
  assert.deepEqual(candidate.reference_prompt_plan, {
    reference_prefix: "<<<",
    reference_suffix: ">>>",
    prompt_separator: " ",
    trailing_space: true,
    file_urls_entry_type: "image",
    file_urls_bound: false,
    trusted_reference_url_required: true,
    url_source: "TRUSTED_OWNER_REFERENCE_LAYER_NOT_ACCEPTED_HERE"
  });
  assert.equal(Object.hasOwn(candidate.settings_candidate, "file_urls"), false);
  assert.equal(candidate.chat_id_bound, false);
  assert.equal(candidate.dispatch_allowed, false);
  assert.equal(candidate.backend_acceptance, "UNPROVEN");
});

test("projection rejects another model, URL-bearing extras, and unknown settings", () => {
  const normalized = normalizeOwnerWan30ReferenceGenerationIntent(VALID);
  assert.throws(() => projectOwnerWan30ReferenceGenerationWireCandidate({ ...normalized.intent, model_id: "wan_30_t2v" }),
    OwnerWan30ReferenceGenerationParametersError);
  assert.throws(() => projectOwnerWan30ReferenceGenerationWireCandidate({ ...normalized.intent, file_urls: [{ url: "caller-url" }] }),
    OwnerWan30ReferenceGenerationParametersError);
  rejects({ ...VALID, parameters: { ...VALID.parameters, url: "caller-url" } });
});

test("strict records reject proxies and accessors without running getters", () => {
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
