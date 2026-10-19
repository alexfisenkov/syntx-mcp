import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerGrokI2vSourceProfile,
  normalizeOwnerGrokI2vParameters
} from "../src/application/owner-grok-i2v-parameters.js";

const I2V_RATIOS = ["16:9"] as const;
const I15_RATIOS = ["16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "1:1"] as const;
const RESOLUTIONS = ["480p", "720p"] as const;
function input(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { model_id: "grok_i2v", prompt: "Preserve the exact prompt. 🚲", aspect_ratio: "16:9", video_duration: 6, resolution: "480p", ...overrides };
}
function withCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof Error && (error as Error & { code?: unknown }).code === code;
}

test("2280 profile records source candidates without injecting defaults or runtime authority", () => {
  const profile = getOwnerGrokI2vSourceProfile();
  assert.equal(profile.source_pins.form_build_id, "1792363638");
  assert.equal(profile.source_pins.form_module, "grok-video.js");
  assert.equal(profile.source_pins.form_sha256, "sha256:cc36221a4c696fb91b43166558800e2b1df18e49dcb3c06997b7cfeafb3c5159");
  assert.deepEqual(profile.model_ids, ["grok_i2v", "grok_15_i2v"]);
  assert.equal(profile.ai_name, "grok_video"); assert.equal(profile.scope, "video");
  assert.deepEqual(profile.initializer_candidates, { aspect_ratio: "16:9", video_duration: 5, resolution: "480p" });
  assert.equal(profile.effective_defaults, "UNKNOWN");
  assert.equal(profile.controls.aspect_ratio.grok_i2v.control_visibility, "HIDDEN_IN_SOURCE_FORM");
  assert.equal(profile.initial_image_geometry_policy.grok_i2v.aspect_ratio, "16:9");
  assert.equal(profile.initial_image_geometry_policy.grok_15_i2v.aspect_ratio, "UNKNOWN");
  assert.equal(profile.dispatch_allowed, false); assert.equal(profile.runtime_usable, false);
  assert.equal(profile.backend_acceptance, "UNPROVEN"); assert.equal(Object.isFrozen(profile), true);
});

test("2280 normalizes only explicit model-specific aspect and duration values", () => {
  for (const aspect_ratio of I2V_RATIOS) for (const video_duration of [6, 10]) for (const resolution of RESOLUTIONS) {
    const normalized = normalizeOwnerGrokI2vParameters(input({ aspect_ratio, video_duration, resolution }));
    assert.deepEqual(normalized.source_parameters, { model_type: "grok_i2v", aspect_ratio, video_duration, resolution });
    assert.equal(normalized.intent.prompt, "Preserve the exact prompt. 🚲");
    assert.equal(normalized.dispatch_allowed, false); assert.equal(normalized.backend_acceptance, "UNPROVEN");
  }
  for (const aspect_ratio of I15_RATIOS) for (let video_duration = 1; video_duration <= 15; video_duration += 1) for (const resolution of RESOLUTIONS) {
    const normalized = normalizeOwnerGrokI2vParameters(input({ model_id: "grok_15_i2v", aspect_ratio, video_duration, resolution }));
    assert.deepEqual(normalized.source_parameters, { model_type: "grok_15_i2v", aspect_ratio, video_duration, resolution });
  }
});

test("2280 rejects implicit defaults, foreign controls, unsupported ratios and duration boundaries", () => {
  for (const invalid of [
    {}, input({ model_id: "grok-15-i2v" }), input({ aspect_ratio: "9:16" }),
    input({ video_duration: 5 }), input({ video_duration: 10.5 }), input({ video_duration: 0 }),
    input({ resolution: "1080p" }), input({ seed: null }),
    input({ model_id: "grok_15_i2v", video_duration: 0 }), input({ model_id: "grok_15_i2v", video_duration: 16 }),
    input({ model_id: "grok_15_i2v", video_duration: 1.2 }), input({ model_id: "grok_15_i2v", aspect_ratio: "2:1" }),
    input({ model_id: "grok_15_i2v", prompt: "x".repeat(2_001) }), input({ prompt: "x".repeat(5_001) }),
    input({ prompt: "\ud800" })
  ]) assert.throws(() => normalizeOwnerGrokI2vParameters(invalid), withCode("INVALID_PARAMETERS"));
});

test("2280 rejects proxies and accessors without invoking getters", () => {
  assert.throws(() => normalizeOwnerGrokI2vParameters(new Proxy(input(), {})), withCode("INVALID_PARAMETERS"));
  let getterCalls = 0;
  const accessor = input();
  Object.defineProperty(accessor, "prompt", { enumerable: true, get() { getterCalls += 1; return "must not run"; } });
  assert.throws(() => normalizeOwnerGrokI2vParameters(accessor), withCode("INVALID_PARAMETERS"));
  assert.equal(getterCalls, 0);
});
