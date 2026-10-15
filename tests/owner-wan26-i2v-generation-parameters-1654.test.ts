import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerWan26I2vGenerationParametersSource,
  normalizeOwnerWan26I2vCostParameters,
  normalizeOwnerWan26I2vGenerationParameters,
  OwnerWan26I2vGenerationParametersError
} from "../src/application/owner-wan26-i2v-generation-parameters.js";

const MODELS = ["wan_26_i2v", "wan_26_i2v_flash"] as const;
type ModelId = typeof MODELS[number];
function input(model_id: ModelId, values: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model_id,
    prompt: "explicit prompt",
    parameters: {
      resolution: "720P", aspect_ratio: "16:9", video_duration: 2,
      prompt_extend: false, seed: null, native_audio: model_id === "wan_26_i2v_flash" ? false : false,
      ...values
    }
  };
}
function rejectsInvalid(value: unknown): void {
  assert.throws(() => normalizeOwnerWan26I2vGenerationParameters(value), (error: unknown) =>
    error instanceof OwnerWan26I2vGenerationParametersError && error.code === "INVALID_PARAMETERS");
}

test("both exact WAN 2.6 model IDs normalize explicit boundary controls without filling defaults", () => {
  for (const model_id of MODELS) {
    for (const resolution of ["720P", "1080P"] as const) for (const aspect_ratio of ["16:9", "9:16", "1:1", "4:3", "3:4"] as const) {
      for (const video_duration of [2, 15]) for (const seed of [null, 0, 2_147_483_647]) {
        const value = input(model_id, { resolution, aspect_ratio, video_duration, prompt_extend: true, seed,
          native_audio: model_id === "wan_26_i2v_flash" ? true : false });
        const normalized = normalizeOwnerWan26I2vGenerationParameters(value);
        assert.equal(normalized.status, "EXPLICIT_LOCAL_PARAMETERS_NORMALIZED");
        assert.equal(normalized.intent.model_id, model_id);
        assert.deepEqual(normalized.intent.parameters, {
          resolution, aspect_ratio, video_duration, prompt_extend: true, seed,
          native_audio: model_id === "wan_26_i2v_flash"
        });
        assert.equal(normalized.effective_defaults, "UNKNOWN");
        assert.equal(normalized.intent.parameters.video_duration, video_duration);
        assert.equal("shot_type" in normalized.intent.parameters, false);
        assert.equal("audio_setting" in normalized.intent.parameters, false);
        assert.equal(Object.isFrozen(normalized), true);
        assert.equal(Object.isFrozen(normalized.intent), true);
        assert.equal(Object.isFrozen(normalized.intent.parameters), true);
      }
    }
  }
});

test("prompt is explicit and empty is preserved, while B066 local prompt bound is enforced", () => {
  const empty = normalizeOwnerWan26I2vGenerationParameters({ ...input("wan_26_i2v"), prompt: "" });
  assert.equal(empty.intent.prompt, "");
  assert.equal(normalizeOwnerWan26I2vGenerationParameters({ ...input("wan_26_i2v"), prompt: "x".repeat(1_500) }).intent.prompt?.length, 1_500);
  rejectsInvalid({ ...input("wan_26_i2v"), prompt: "x".repeat(1_501) });
  rejectsInvalid({ ...input("wan_26_i2v"), prompt: "\uD800" });
  rejectsInvalid({ ...input("wan_26_i2v"), prompt: undefined });
});

test("model-specific audio policy, hidden reference duration, and output length are preserved", () => {
  rejectsInvalid(input("wan_26_i2v", { native_audio: true }));
  for (const native_audio of [false, true]) {
    const normalized = normalizeOwnerWan26I2vGenerationParameters(input("wan_26_i2v_flash", { native_audio }));
    assert.equal(normalized.intent.parameters.native_audio, native_audio);
  }
  for (const extra of [
    { shot_type: "multi" }, { audio_setting: "origin" }, { duration: 4 },
    { file_urls: [] }, { url: "https://example.test/audio.wav" }
  ]) rejectsInvalid(input("wan_26_i2v_flash", extra));
  const source = getOwnerWan26I2vGenerationParametersSource();
  assert.deepEqual(source.wire_facts.fixed_fields, { shot_type: "single", audio_setting: "auto" });
  assert.equal(source.wire_facts.duration, "OMITTED_FROM_FINAL_SETTINGS");
  assert.equal(source.wire_facts.video_duration, "EXPLICIT_OUTPUT_LENGTH_PRESERVED");
  assert.equal(source.controls.video_duration.minimum, 2);
  assert.equal(source.controls.video_duration.maximum, 15);
});

test("strict input rejects missing, sparse, malformed, coerced, and out-of-range values", () => {
  const valid = input("wan_26_i2v");
  rejectsInvalid({ ...valid, model_id: "wan_26_i2v_other" });
  rejectsInvalid({ ...valid, extra: true });
  rejectsInvalid({ ...valid, prompt: 12 });
  rejectsInvalid({ ...valid, parameters: { ...((valid.parameters) as object), aspect_ratio: undefined } });
  rejectsInvalid({ ...valid, parameters: { ...((valid.parameters) as object), video_duration: 1 } });
  rejectsInvalid({ ...valid, parameters: { ...((valid.parameters) as object), video_duration: 16 } });
  for (const seed of [Number.NaN, 1.5, -1, 2_147_483_648, "0"]) {
    rejectsInvalid({ ...valid, parameters: { ...((valid.parameters) as object), seed } });
  }
  rejectsInvalid({ ...valid, parameters: { ...((valid.parameters) as object), resolution: "480P" } });
  rejectsInvalid({ ...valid, parameters: { ...((valid.parameters) as object), prompt_extend: 1 } });
});

test("source report is frozen and labels historical pins, cost candidates, and coverage gaps honestly", () => {
  const source = getOwnerWan26I2vGenerationParametersSource();
  assert.equal(Object.isFrozen(source), true);
  assert.equal(Object.isFrozen(source.source_pins), true);
  assert.equal(Object.isFrozen(source.models), true);
  assert.equal(Object.isFrozen(source.models[0]), true);
  assert.equal(source.source_pins.form_build_id, "1791904852");
  assert.equal(source.source_pins.form_module, "wan-video.js");
  const currentPins = source.source_pins as unknown as Record<string, unknown>;
  assert.equal(currentPins.public_catalog_version,
    "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json");
  assert.equal(currentPins.public_models_sha256, "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a");
  assert.equal(currentPins.public_catalog_fetched_at, "2026-10-15T07:17:24.901Z");
  assert.equal(currentPins.files_mention, false);
  assert.equal(source.source_pins.video_script_module, "video.js");
  assert.equal(source.source_pins.new_session_helper_module, "NewSessionButton.js");
  assert.equal(source.source_pins.seed_helper_freshness, "PRIOR_PINNED_NOT_FRESH");
  assert.equal(source.effective_defaults, "UNKNOWN");
  assert.equal(source.prompt_limit.source, "HISTORICAL_B066_LOCAL_GUARD_NOT_CURRENT_UI_LIMIT");
  assert.equal(source.current_catalog_status, "UNKNOWN");
  assert.equal(source.current_quote_status, "UNKNOWN");
  assert.equal(source.provider_acceptance, "UNPROVEN");
  assert.deepEqual(source.coverage_gaps, [
    "CURRENT_CATALOG_NOT_ESTABLISHED", "CURRENT_QUOTE_NOT_ESTABLISHED",
    "EFFECTIVE_UI_DEFAULTS_NOT_ESTABLISHED", "PROVIDER_ACCEPTANCE_NOT_ESTABLISHED"
  ]);
  const regularCost = normalizeOwnerWan26I2vCostParameters(input("wan_26_i2v"));
  assert.deepEqual(regularCost.keys, ["resolution", "video_duration"]);
  assert.deepEqual(Object.keys(regularCost.values), ["resolution", "video_duration"]);
  assert.equal(regularCost.confidence, "PINNED_C396_METADATA_NOT_CURRENT_QUOTE");
  const flashCost = normalizeOwnerWan26I2vCostParameters(input("wan_26_i2v_flash", { native_audio: true }));
  assert.deepEqual(flashCost.keys, ["resolution", "video_duration", "native_audio"]);
  assert.deepEqual(Object.keys(flashCost.values), ["resolution", "video_duration", "native_audio"]);
  assert.equal(flashCost.confidence, "PINNED_C396_METADATA_NOT_CURRENT_QUOTE");
  assert.equal(source.cost_projection.source, "PINNED_C396_METADATA_NOT_CURRENT_QUOTE");
});

test("descriptor-only parsing rejects accessors, proxies, extra properties, and sparse records without invoking getters", () => {
  let calls = 0;
  const record = input("wan_26_i2v");
  Object.defineProperty(record, "prompt", { get() { calls += 1; return "unsafe"; }, enumerable: true });
  rejectsInvalid(record);
  const parameterRecord = input("wan_26_i2v");
  const params = parameterRecord.parameters as Record<string, unknown>;
  Object.defineProperty(params, "resolution", { get() { calls += 1; return "720P"; }, enumerable: true });
  rejectsInvalid(parameterRecord);
  const valid = input("wan_26_i2v");
  rejectsInvalid(new Proxy(valid, {}));
  rejectsInvalid({ ...valid, parameters: new Proxy(valid.parameters as object, {}) });
  const withSymbol = input("wan_26_i2v");
  Object.defineProperty(withSymbol, Symbol("extra"), { value: true });
  rejectsInvalid(withSymbol);
  assert.equal(calls, 0);
});
