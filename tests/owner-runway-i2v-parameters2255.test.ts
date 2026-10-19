import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerRunwayI2vSourceProfile,
  normalizeOwnerRunwayI2vParameters
} from "../src/application/owner-runway-i2v-parameters.js";

function input(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    model_id: "4genfirstframeimage",
    prompt: "A quiet cinematic shot.",
    aspect_ratio: "16:9",
    video_duration: 5,
    seed: null,
    ...overrides
  };
}

function withCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof Error && (error as Error & { code?: unknown }).code === code;
}

test("exposes pinned source facts without turning them into defaults or dispatch authority", () => {
  const profile = getOwnerRunwayI2vSourceProfile();
  assert.equal(profile.form_id, "runway");
  assert.equal(profile.form_category, "video");
  assert.equal(profile.scope, "video");
  assert.equal(profile.source_pins.form_build_id, "1792363638");
  assert.equal(profile.source_pins.form_sha256, "sha256:975b82daca30bf02e5b0591373fcf6a944b25661a42ffaa4d039c2c1ab36cb91");
  assert.equal(profile.form_initializer.video_duration, "5.0");
  assert.equal(profile.form_initializer.aspect_ratio, "1");
  assert.equal(profile.effective_defaults, "UNKNOWN");
  assert.equal(profile.dispatch_allowed, false);
  assert.equal(profile.runtime_usable, false);
  assert.equal(profile.backend_acceptance, "UNPROVEN");
});

test("2254 source refresh pins current identical form bytes and the mandatory one-crop selection", () => {
  const profile = getOwnerRunwayI2vSourceProfile();
  assert.equal(profile.source_pins.form_build_id, "1792363638");
  assert.equal(profile.source_pins.historical_observed_build_id, "1792156098");
  assert.equal(profile.source_pins.form_sha256, "sha256:975b82daca30bf02e5b0591373fcf6a944b25661a42ffaa4d039c2c1ab36cb91");
  assert.equal(profile.crop_requirement, "EXACTLY_ONE_CROPPED_FILE");
  assert.equal(profile.scope, "video");
  assert.equal(profile.source_pins.reference_serializer_sha256, "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc");
  assert.equal(normalizeOwnerRunwayI2vParameters(input()).crop_requirement, "EXACTLY_ONE_CROPPED_FILE");
});

test("normalizes only explicit supported Gen4 choices and projects exact source keys", () => {
  for (const model_id of ["4genfirstframeimage", "turbo4genfirstframeimage"]) {
    for (const [aspect_ratio, sourceAspect] of [["21:9", "219"], ["16:9", "169"], ["4:3", "43"], ["1:1", "11"], ["3:4", "34"], ["9:16", "916"]] as const) {
      for (const [video_duration, sourceDuration] of [[5, "5.0"], [10, "10.0"]] as const) {
        const normalized = normalizeOwnerRunwayI2vParameters(input({ model_id, aspect_ratio, video_duration }));
        assert.deepEqual(normalized.intent, { model_id, prompt: "A quiet cinematic shot.", aspect_ratio, video_duration, seed: null });
        assert.deepEqual(normalized.source_parameters, {
          model_type: model_id,
          aspect_ratio: sourceAspect,
          video_duration: sourceDuration,
          seed: null
        });
        assert.equal(normalized.status, "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY");
        assert.equal(normalized.dispatch_allowed, false);
        assert.equal(normalized.runtime_usable, false);
        assert.equal(normalized.backend_acceptance, "UNPROVEN");
        assert.equal(Object.isFrozen(normalized), true);
        assert.equal(Object.isFrozen(normalized.intent), true);
        assert.equal(Object.isFrozen(normalized.source_parameters), true);
      }
    }
  }
});

test("rejects implicit defaults, unsupported choices, extra fields, proxies, and accessors", () => {
  assert.throws(() => normalizeOwnerRunwayI2vParameters({}), withCode("INVALID_PARAMETERS"));
  for (const invalid of [
    input({ model_id: "text2video" }), input({ aspect_ratio: "adaptive" }),
    input({ video_duration: 8 }), input({ video_duration: "5.0" }), input({ seed: 0 }),
    input({ prompt: "  " }), input({ prompt: "x".repeat(1_001) }),
    input({ prompt: "\ud800" }), input({ file_urls: [] })
  ]) assert.throws(() => normalizeOwnerRunwayI2vParameters(invalid), withCode("INVALID_PARAMETERS"));
  assert.throws(() => normalizeOwnerRunwayI2vParameters(new Proxy(input(), {})), withCode("INVALID_PARAMETERS"));
  const accessor = input();
  Object.defineProperty(accessor, "prompt", { enumerable: true, get: () => "must not run" });
  assert.throws(() => normalizeOwnerRunwayI2vParameters(accessor), withCode("INVALID_PARAMETERS"));
});
