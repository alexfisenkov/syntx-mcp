import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerWan26R2vGenerationParametersSource,
  normalizeOwnerWan26R2vCostParameters,
  normalizeOwnerWan26R2vGenerationParameters,
  OwnerWan26R2vGenerationParametersError
} from "../src/application/owner-wan26-r2v-generation-parameters.js";

const parameters = Object.freeze({ resolution: "720P", aspect_ratio: "16:9", video_duration: 5, seed: null });
const input = (model_id: "wan_26_r2v" | "wan_26_r2v_flash" = "wan_26_r2v") => ({
  model_id,
  prompt: "A quiet mountain lake",
  parameters: model_id === "wan_26_r2v_flash" ? { ...parameters, native_audio: false } : { ...parameters }
});

test("source contract pins the observed WAN26 R2V controls and keeps runtime disabled", () => {
  const source = getOwnerWan26R2vGenerationParametersSource();
  assert.deepEqual(source.model_ids, ["wan_26_r2v", "wan_26_r2v_flash"]);
  assert.deepEqual(source.controls.resolution, ["720P", "1080P"]);
  assert.deepEqual(source.controls.aspect_ratio, ["16:9", "9:16", "1:1", "4:3", "3:4"]);
  assert.deepEqual(source.controls.video_duration, { values: [2, 3, 4, 5, 6, 7, 8, 9, 10], unit: "INTEGER_SECONDS" });
  assert.equal(source.runtime_usable, false);
  assert.equal(source.dispatch_allowed, false);
  assert.equal(Object.isFrozen(source), true);
});

test("normalizes complete explicit regular and Flash intents without adding defaults", () => {
  for (const model_id of ["wan_26_r2v", "wan_26_r2v_flash"] as const) {
    const result = normalizeOwnerWan26R2vGenerationParameters(input(model_id));
    assert.equal(result.status, "EXPLICIT_LOCAL_PARAMETERS_NORMALIZED");
    assert.deepEqual(result.intent, {
      model_id,
      prompt: "A quiet mountain lake",
      parameters: model_id === "wan_26_r2v_flash" ? { ...parameters, native_audio: false } : parameters
    });
    assert.equal(result.effective_defaults, "UNKNOWN");
    assert.equal(result.runtime_usable, false);
    assert.equal(result.dispatch_allowed, false);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.intent.parameters), true);
  }
});

test("accepts only the observed UI duration choices and rejects unproven parameter fields", () => {
  for (const video_duration of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    assert.equal(normalizeOwnerWan26R2vGenerationParameters({
      ...input(), parameters: { ...parameters, video_duration }
    }).intent.parameters.video_duration, video_duration);
  }
  for (const video_duration of [1, 11, 2.5, "5"]) {
    assert.throws(() => normalizeOwnerWan26R2vGenerationParameters({
      ...input(), parameters: { ...parameters, video_duration }
    }), OwnerWan26R2vGenerationParametersError);
  }
  for (const extra of [{ prompt_extend: false }]) {
    assert.throws(() => normalizeOwnerWan26R2vGenerationParameters({
      ...input(), parameters: { ...parameters, ...extra }
    }), OwnerWan26R2vGenerationParametersError);
  }
  assert.throws(() => normalizeOwnerWan26R2vGenerationParameters({
    ...input(), parameters: { resolution: "720P", aspect_ratio: "16:9", video_duration: 5, native_audio: true }
  }), OwnerWan26R2vGenerationParametersError);
  assert.throws(() => normalizeOwnerWan26R2vGenerationParameters({
    ...input(), parameters: { resolution: "720P", aspect_ratio: "16:9", video_duration: 5 }
  }), OwnerWan26R2vGenerationParametersError);
  assert.throws(() => normalizeOwnerWan26R2vGenerationParameters({
    ...input("wan_26_r2v_flash"), parameters: { ...parameters }
  }), OwnerWan26R2vGenerationParametersError);
  assert.equal(normalizeOwnerWan26R2vGenerationParameters({
    ...input("wan_26_r2v_flash"), parameters: { ...parameters, native_audio: true }
  }).intent.parameters.native_audio, true);
});

test("requires exact plain records and rejects proxies, accessors, symbols, and unknown keys", () => {
  const getterParameters = { ...parameters };
  Object.defineProperty(getterParameters, "resolution", { enumerable: true, get: () => "720P" });
  assert.throws(() => normalizeOwnerWan26R2vGenerationParameters({ ...input(), parameters: getterParameters }), OwnerWan26R2vGenerationParametersError);
  assert.throws(() => normalizeOwnerWan26R2vGenerationParameters({ ...input(), parameters: { ...parameters, extra: true } }), OwnerWan26R2vGenerationParametersError);
  assert.throws(() => normalizeOwnerWan26R2vGenerationParameters({ ...input(), [Symbol("extra")]: true }), OwnerWan26R2vGenerationParametersError);
  assert.throws(() => normalizeOwnerWan26R2vGenerationParameters(new Proxy(input(), {})), OwnerWan26R2vGenerationParametersError);
  const revoked = Proxy.revocable(input(), {});
  revoked.revoke();
  assert.throws(() => normalizeOwnerWan26R2vGenerationParameters(revoked.proxy), OwnerWan26R2vGenerationParametersError);
});

test("rejects unsupported model, invalid controls, and prompts beyond the catalog guard", () => {
  assert.throws(() => normalizeOwnerWan26R2vGenerationParameters({ ...input(), model_id: "wan_27_r2v" }), OwnerWan26R2vGenerationParametersError);
  assert.throws(() => normalizeOwnerWan26R2vGenerationParameters({ ...input(), prompt: "x".repeat(1_501) }), OwnerWan26R2vGenerationParametersError);
  for (const aspect_ratio of ["2:1", "auto", "16:9 "]) {
    assert.throws(() => normalizeOwnerWan26R2vGenerationParameters({
      ...input(), parameters: { ...parameters, aspect_ratio }
    }), OwnerWan26R2vGenerationParametersError);
  }
  for (const resolution of ["480P", "720p", "1080P "]) {
    assert.throws(() => normalizeOwnerWan26R2vGenerationParameters({
      ...input(), parameters: { ...parameters, resolution }
    }), OwnerWan26R2vGenerationParametersError);
  }
});

test("reports only catalog cost keys, never a quote or derived duration values", () => {
  const regular = normalizeOwnerWan26R2vCostParameters(input("wan_26_r2v"));
  const flash = normalizeOwnerWan26R2vCostParameters(input("wan_26_r2v_flash"));
  assert.deepEqual(regular.keys, ["resolution", "video_duration", "duration"]);
  assert.deepEqual(flash.keys, ["resolution", "video_duration", "duration", "native_audio"]);
  assert.equal(regular.values, "NOT_PROJECTED_PENDING_SOURCE_METRIC_AND_ROUNDING_PROOF");
  assert.equal(flash.values, "NOT_PROJECTED_PENDING_SOURCE_METRIC_AND_ROUNDING_PROOF");
  assert.equal("duration" in regular, false);
  assert.equal("duration" in flash, false);
  assert.equal(regular.current_quote, "UNKNOWN");
  assert.equal(flash.current_quote, "UNKNOWN");
});
