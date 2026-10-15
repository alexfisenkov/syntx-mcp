import test from "node:test";
import assert from "node:assert/strict";
import {
  getOwnerWan30T2vGenerationSourceContract,
  normalizeOwnerWan30T2vGenerationIntent,
  OwnerWan30T2vGenerationParametersError,
  prepareOwnerWan30T2vGenerationWireCandidate
} from "../src/application/owner-wan30-t2v-generation-parameters.js";

const VALID = {
  prompt: "A small silver kite crosses a pale sky",
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

test("source contract keeps the current observed profile distinct and defaults unknown", () => {
  const source = getOwnerWan30T2vGenerationSourceContract();
  assert.equal(source.profile_id, "owner-wan30-t2v-web-request-observed-1807");
  assert.equal(source.status, "WEB_REQUEST_OBSERVED");
  assert.equal(source.model_id, "wan_30_t2v");
  assert.equal(source.source_pins.public_catalog_version,
    "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json");
  assert.equal(source.source_pins.form_build_id, "1792069332");
  assert.deepEqual(source.controls.aspect_ratio.values, ["16:9", "9:16", "1:1", "4:3", "3:4"]);
  assert.deepEqual(source.controls.resolution.values, ["480P", "720P", "1080P"]);
  assert.deepEqual(source.controls.rendering_speed.values, ["basic", "prime"]);
  assert.deepEqual(source.fixed_settings, { file_urls: [], shot_type: "single", audio_setting: "auto", duration: 0 });
  assert.equal(source.effective_defaults, "UNKNOWN");
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
});

test("normalizer binds an explicit intent and labels catalog cost values as candidates", () => {
  const normalized = normalizeOwnerWan30T2vGenerationIntent(VALID);
  assert.deepEqual(normalized.intent, {
    model_id: "wan_30_t2v",
    prompt: VALID.prompt,
    parameters: VALID.parameters
  });
  assert.deepEqual(normalized.cost_query_candidate, {
    keys: ["resolution", "video_duration", "duration", "rendering_speed"],
    values: { resolution: "480P", video_duration: 2, duration: 0, rendering_speed: "basic" },
    confidence: "OBSERVED_SETTINGS_NOT_QUOTE_CALLER_JOINED",
    current_quote: "UNKNOWN"
  });
  assert.equal(normalized.effective_defaults, "UNKNOWN");
  assert.equal(normalized.dispatch_allowed, false);
  assert.equal(normalized.backend_acceptance, "UNPROVEN");
  assert.equal(normalized.source_profile_id, "owner-wan30-t2v-web-request-observed-1807");
});

test("wire candidate mirrors observed settings without accepting media URLs or binding chat ID", () => {
  const { intent } = normalizeOwnerWan30T2vGenerationIntent(VALID);
  const candidate = prepareOwnerWan30T2vGenerationWireCandidate(intent);
  assert.deepEqual(candidate, {
    method: "POST",
    path: "video/generate",
    query_candidate: { ai_name: "wan_video" },
    prompt_candidate: VALID.prompt,
    settings_candidate: {
      model_type: "wan_30_t2v",
      file_urls: [],
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
    profile_id: "owner-wan30-t2v-web-request-observed-1807",
    source_pins: getOwnerWan30T2vGenerationSourceContract().source_pins,
    status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED",
    chat_id_bound: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
  assert.throws(() => prepareOwnerWan30T2vGenerationWireCandidate({ ...intent, file_urls: [] }), OwnerWan30T2vGenerationParametersError);
  assert.throws(() => prepareOwnerWan30T2vGenerationWireCandidate({
    ...intent, parameters: { ...intent.parameters, caller_setting: true }
  }), OwnerWan30T2vGenerationParametersError);
  assert.throws(() => prepareOwnerWan30T2vGenerationWireCandidate({ ...intent, model_id: "wan_27_t2v" }),
    OwnerWan30T2vGenerationParametersError);
});

test("normalizer enforces explicit UI bounds and preserves the prompt verbatim", () => {
  const prompt = ` ${"x".repeat(1498)} `;
  const result = normalizeOwnerWan30T2vGenerationIntent({ ...VALID, prompt });
  assert.equal(result.intent.prompt, prompt);
  const rejects = (input: unknown) => assert.throws(
    () => normalizeOwnerWan30T2vGenerationIntent(input),
    (error: unknown) => error instanceof OwnerWan30T2vGenerationParametersError && error.code === "INVALID_PARAMETERS"
  );
  rejects({ ...VALID, prompt: `${prompt}x` });
  rejects({ ...VALID, model_id: "wan_30_t2v" });
  rejects({ ...VALID, file_urls: [] });
  rejects({ ...VALID, parameters: { ...VALID.parameters, aspect_ratio: "Adaptive" } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, resolution: "4K" } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, video_duration: 1 } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, video_duration: 31 } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, video_duration: 2.5 } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, seed: -1 } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, seed: 2_147_483_648 } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, prompt_extend: 1 } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, native_audio: "false" } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, rendering_speed: "turbo" } });
  rejects({ ...VALID, parameters: { ...VALID.parameters, caller_setting: true } });
});

test("normalizer rejects accessors and proxies without executing their traps", () => {
  let getterRuns = 0;
  const parameterGetter = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(VALID.parameters)) {
    Object.defineProperty(parameterGetter, key, { enumerable: true, get: () => { getterRuns += 1; return value; } });
  }
  assert.throws(() => normalizeOwnerWan30T2vGenerationIntent({ ...VALID, parameters: parameterGetter }), OwnerWan30T2vGenerationParametersError);
  assert.equal(getterRuns, 0);
  const revoked = Proxy.revocable({ ...VALID }, {});
  revoked.revoke();
  assert.throws(() => normalizeOwnerWan30T2vGenerationIntent(revoked.proxy), OwnerWan30T2vGenerationParametersError);
});
