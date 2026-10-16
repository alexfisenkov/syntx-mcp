import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_FLUX3_VIDEO_MODEL_IDS,
  getOwnerFlux3VideoSourceProfile
} from "../src/application/owner-flux3-video-source-profile.js";
import {
  normalizeOwnerFlux3VideoParameters,
  OwnerFlux3VideoParametersError,
  projectOwnerFlux3VideoWireSettings,
  type OwnerFlux3VideoParameterValues
} from "../src/application/owner-flux3-video-parameters.js";

function parameters(video_duration: number): OwnerFlux3VideoParameterValues {
  return { resolution: "hd", video_duration, generate_audio: true };
}

test("Flux3 source profile is static-only and records the two bounded non-T2V contracts", () => {
  assert.deepEqual(OWNER_FLUX3_VIDEO_MODEL_IDS, ["flux3_i2v", "flux3_v2v"]);
  const i2v = getOwnerFlux3VideoSourceProfile("flux3_i2v");
  const v2v = getOwnerFlux3VideoSourceProfile("flux3_v2v");
  assert.ok(i2v);
  assert.ok(v2v);
  assert.equal(i2v.ai_name, "flux3_video");
  assert.equal(i2v.catalog_scope, "video");
  assert.deepEqual(i2v.controls.video_duration, [5, 20]);
  assert.deepEqual(v2v.controls.video_duration, [5, 15]);
  assert.deepEqual(i2v.controls.resolution, ["hd", "fhd"]);
  assert.deepEqual(i2v.controls.aspect_ratio, { mode: "SOURCE_FORCED", value: "auto", caller_control: false });
  assert.equal(i2v.effective_defaults, "UNKNOWN");
  assert.equal(i2v.runtime_usable, false);
  assert.equal(i2v.dispatch_allowed, false);
  assert.equal(i2v.backend_acceptance, "UNPROVEN");
  assert.equal(i2v.upstream_n, "OMITTED_FROM_EXPLICIT_VIDEO_SETTINGS");
  assert.equal(i2v.draft_cost_parameter, "UNSET_OMITTED_FROM_QUERY");
});

test("I2V normalization returns a fresh immutable exact projection with source-forced auto aspect", () => {
  const normalized = normalizeOwnerFlux3VideoParameters({ model_id: "flux3_i2v", parameters: parameters(20) });
  const projected = projectOwnerFlux3VideoWireSettings(normalized);
  assert.deepEqual(projected, {
    model_type: "flux3_i2v",
    video_duration: 20,
    resolution: "hd",
    aspect_ratio: "auto",
    generate_audio: true
  });
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.parameters), true);
  assert.equal(Object.isFrozen(projected), true);
  for (const forbidden of ["n", "prompt", "file_urls", "width", "height", "duration_seconds"]) {
    assert.equal(Object.hasOwn(projected, forbidden), false);
  }
});

test("V2V accepts only its own duration range and preserves explicit audio setting", () => {
  for (const duration of [5, 15]) {
    const normalized = normalizeOwnerFlux3VideoParameters({
      model_id: "flux3_v2v",
      parameters: { resolution: "fhd", video_duration: duration, generate_audio: false }
    });
    assert.deepEqual(projectOwnerFlux3VideoWireSettings(normalized), {
      model_type: "flux3_v2v",
      video_duration: duration,
      resolution: "fhd",
      aspect_ratio: "auto",
      generate_audio: false
    });
  }
  for (const duration of [4, 16, 20]) {
    assert.throws(
      () => normalizeOwnerFlux3VideoParameters({ model_id: "flux3_v2v", parameters: parameters(duration) }),
      OwnerFlux3VideoParametersError
    );
  }
});

test("normalizer enforces exact own data fields and rejects unsafe parameter objects", () => {
  const valid = { model_id: "flux3_i2v", parameters: parameters(5) };
  assert.throws(() => normalizeOwnerFlux3VideoParameters({ ...valid, n: 1 }), OwnerFlux3VideoParametersError);
  assert.throws(() => normalizeOwnerFlux3VideoParameters({
    model_id: "flux3_i2v",
    parameters: { ...parameters(5), aspect_ratio: "16:9" }
  }), OwnerFlux3VideoParametersError);
  const accessor = Object.defineProperty({}, "model_id", { enumerable: true, get: () => "flux3_i2v" });
  assert.throws(() => normalizeOwnerFlux3VideoParameters(accessor), OwnerFlux3VideoParametersError);
  const proxy = new Proxy(valid, {});
  assert.throws(() => normalizeOwnerFlux3VideoParameters(proxy), OwnerFlux3VideoParametersError);
  for (const bad of [4.5, 21, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => normalizeOwnerFlux3VideoParameters({
      model_id: "flux3_i2v",
      parameters: parameters(bad)
    }), OwnerFlux3VideoParametersError);
  }
  assert.throws(() => normalizeOwnerFlux3VideoParameters({
    model_id: "flux3_i2v",
    parameters: { resolution: "2k", video_duration: 5, generate_audio: true }
  }), OwnerFlux3VideoParametersError);
});

test("wire projection accepts only a normalized service-created parameter value", () => {
  assert.throws(() => projectOwnerFlux3VideoWireSettings({
    model_id: "flux3_i2v",
    parameters: parameters(5)
  } as never), OwnerFlux3VideoParametersError);
});
