import test from "node:test";
import assert from "node:assert/strict";
import {
  getOwnerWan30FirstLastGenerationSourceContract,
  normalizeOwnerWan30FirstLastGenerationIntent,
  OwnerWan30FirstLastGenerationParametersError,
  projectOwnerWan30FirstLastGenerationWireCandidate
} from "../src/application/owner-wan30-first-last-generation-parameters.js";

const VALID = {
  prompt: "A blue cube becomes a red paper boat on calm water",
  parameters: {
    aspect_ratio: "16:9",
    resolution: "480P",
    video_duration: 2,
    prompt_extend: true,
    seed: null,
    native_audio: false,
    rendering_speed: "basic"
  }
} as const;

test("source contract isolates First/Last identity and labels the single tuple as local-only", () => {
  const source = getOwnerWan30FirstLastGenerationSourceContract();
  assert.equal(source.profile_id, "owner-wan30-first-last-web-request-observed-1823");
  assert.equal(source.status, "WEB_REQUEST_OBSERVED_SINGLE_TUPLE");
  assert.equal(source.model_id, "wan_30_first_last_frame");
  assert.equal(source.ai_name, "wan_video");
  assert.equal(source.source_pins.public_catalog_version,
    "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json");
  assert.equal(source.source_pins.form_build_id, "1792069332");
  assert.equal(source.wire_observation.method, "POST");
  assert.deepEqual(source.wire_observation.request_body_keys, ["chat_id", "prompt", "settings"]);
  assert.deepEqual(source.wire_observation.file_urls_role_order, ["first_frame", "last_frame"]);
  assert.equal(source.controls.status, "NOT_SOURCE_JOINED");
  assert.equal(source.controls.local_operator_allowlist_only, true);
  assert.equal(source.prompt_limit.source, "UI_COUNTER_LOCAL_OPERATOR_BOUND_NOT_PROVIDER_LIMIT");
  assert.equal(source.effective_defaults, "UNKNOWN");
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
});

test("normalizer accepts only the explicit captured settings tuple and preserves prompt verbatim", () => {
  const prompt = ` ${"x".repeat(19_998)} `;
  const result = normalizeOwnerWan30FirstLastGenerationIntent({ ...VALID, prompt });
  assert.equal(result.intent.model_id, "wan_30_first_last_frame");
  assert.equal(result.intent.prompt, prompt);
  assert.deepEqual(result.intent.parameters, VALID.parameters);
  assert.equal(result.runtime_usable, false);
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.backend_acceptance, "UNPROVEN");

  const rejects = (input: unknown) => assert.throws(
    () => normalizeOwnerWan30FirstLastGenerationIntent(input),
    (error: unknown) => error instanceof OwnerWan30FirstLastGenerationParametersError && error.code === "INVALID_PARAMETERS"
  );
  rejects({ ...VALID, prompt: `${prompt}x` });
  rejects({ ...VALID, model_id: "wan_30_t2v" });
  rejects({ ...VALID, file_urls: [] });
  rejects({ ...VALID, parameters: { ...VALID.parameters, aspect_ratio: "9:16" } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, resolution: "720P" } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, video_duration: 3 } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, prompt_extend: false } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, seed: 0 } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, native_audio: true } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, rendering_speed: "prime" } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, unknown_setting: true } });
});

test("wire projection keeps role requirements outside scalar settings and accepts no URLs", () => {
  const normalized = normalizeOwnerWan30FirstLastGenerationIntent(VALID);
  const candidate = projectOwnerWan30FirstLastGenerationWireCandidate(normalized.intent);
  assert.deepEqual(candidate, {
    method: "POST",
    path: "video/generate",
    query_candidate: { ai_name: "wan_video" },
    prompt_candidate: VALID.prompt,
    settings_candidate: {
      model_type: "wan_30_first_last_frame",
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
    },
    reference_shape: {
      observed_settings_key: "file_urls",
      observed_role_order: ["first_frame", "last_frame"],
      local_operator_slots: ["first_frame", "last_frame"],
      file_urls_bound: false,
      url_source: "TRUSTED_OWNER_REFERENCE_LAYER_NOT_ACCEPTED_HERE"
    },
    profile_id: "owner-wan30-first-last-web-request-observed-1823",
    source_pins: getOwnerWan30FirstLastGenerationSourceContract().source_pins,
    status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED",
    chat_id_bound: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
  assert.equal(Object.hasOwn(candidate.settings_candidate, "file_urls"), false);
  assert.equal(JSON.stringify(candidate).includes("https://"), false);
  assert.throws(() => projectOwnerWan30FirstLastGenerationWireCandidate({ ...normalized.intent, model_id: "wan_30_t2v" }),
    OwnerWan30FirstLastGenerationParametersError);
  assert.throws(() => projectOwnerWan30FirstLastGenerationWireCandidate({ ...normalized.intent, file_urls: [] }),
    OwnerWan30FirstLastGenerationParametersError);
});

test("normalizer rejects accessors and proxies without executing their traps", () => {
  let getterRuns = 0;
  const parameterGetter = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(VALID.parameters)) {
    Object.defineProperty(parameterGetter, key, { enumerable: true, get: () => { getterRuns += 1; return value; } });
  }
  assert.throws(() => normalizeOwnerWan30FirstLastGenerationIntent({ ...VALID, parameters: parameterGetter }),
    OwnerWan30FirstLastGenerationParametersError);
  assert.equal(getterRuns, 0);
  const revoked = Proxy.revocable({ ...VALID }, {});
  revoked.revoke();
  assert.throws(() => normalizeOwnerWan30FirstLastGenerationIntent(revoked.proxy), OwnerWan30FirstLastGenerationParametersError);
});
