import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerMagnificUpscaleSourceParameters,
  normalizeOwnerMagnificUpscaleParameters,
  OwnerMagnificUpscaleParametersError
} from "../src/application/owner-magnific-upscale-parameters.js";

const SOURCE_STATE = {
  scale_factor: "2x",
  optimized_for: "standard",
  engine: "automatic",
  creativity: 3,
  hdr: 3,
  resemblance: 3,
  fractality: 3,
  sharpen: 30,
  smart_grain: 30,
  ultra_detail: 30,
  flavor: "sublime"
} as const;

function request(
  variant: "creative" | "precision_v1" | "precision_v2" = "creative",
  overrides: Record<string, unknown> = {},
  dimensions: Record<string, unknown> = { width: 1_000, height: 1_000 }
) {
  return { variant, parameters: { ...SOURCE_STATE, ...overrides }, dimensions };
}

test("descriptor identifies all source controls, branch visibility, source pins, and non-activation", () => {
  const descriptor = getOwnerMagnificUpscaleSourceParameters();
  assert.deepEqual(descriptor.variants, ["creative", "precision_v1", "precision_v2"]);
  assert.deepEqual(Object.keys(descriptor.controls), [
    "model_type", "scale_factor", "optimized_for", "engine", "creativity", "hdr", "resemblance",
    "fractality", "sharpen", "smart_grain", "ultra_detail", "flavor"
  ]);
  assert.deepEqual(descriptor.controls.model_type.values, ["creative", "precision_v1", "precision_v2"]);
  assert.deepEqual(descriptor.controls.scale_factor.values, ["2x", "4x", "8x", "16x"]);
  assert.deepEqual(descriptor.controls.flavor.values, ["sublime", "photo", "photo_denoiser"]);
  assert.deepEqual({
    model_type: descriptor.controls.model_type.visible_by_variant,
    scale_factor: descriptor.controls.scale_factor.visible_by_variant,
    optimized_for: descriptor.controls.optimized_for.visible_by_variant,
    engine: descriptor.controls.engine.visible_by_variant,
    creativity: descriptor.controls.creativity.visible_by_variant,
    hdr: descriptor.controls.hdr.visible_by_variant,
    resemblance: descriptor.controls.resemblance.visible_by_variant,
    fractality: descriptor.controls.fractality.visible_by_variant,
    sharpen: descriptor.controls.sharpen.visible_by_variant,
    smart_grain: descriptor.controls.smart_grain.visible_by_variant,
    ultra_detail: descriptor.controls.ultra_detail.visible_by_variant,
    flavor: descriptor.controls.flavor.visible_by_variant
  }, {
    model_type: { creative: true, precision_v1: true, precision_v2: true },
    scale_factor: { creative: true, precision_v1: false, precision_v2: "NOT T.value" },
    optimized_for: { creative: true, precision_v1: false, precision_v2: false },
    engine: { creative: true, precision_v1: false, precision_v2: false },
    creativity: { creative: true, precision_v1: false, precision_v2: false },
    hdr: { creative: true, precision_v1: false, precision_v2: false },
    resemblance: { creative: true, precision_v1: false, precision_v2: false },
    fractality: { creative: true, precision_v1: false, precision_v2: false },
    sharpen: { creative: false, precision_v1: true, precision_v2: true },
    smart_grain: { creative: false, precision_v1: true, precision_v2: true },
    ultra_detail: { creative: false, precision_v1: true, precision_v2: true },
    flavor: { creative: false, precision_v1: false, precision_v2: true }
  });
  assert.deepEqual(descriptor.controls.creativity.range, { minimum: -10, maximum: 10, step: 1 });
  assert.deepEqual(descriptor.controls.sharpen.range, { minimum: 0, maximum: 100, step: 1 });
  assert.equal(descriptor.controls.scale_factor.precision_v2_visibility_source, "NOT T.value");
  assert.equal(descriptor.scale_choices.limit_confidence, "SOURCE_UI_GATING_ONLY_NOT_PROVIDER_LIMIT_OR_OUTPUT_GEOMETRY");
  assert.equal(descriptor.initializer_candidate.status, "PROVENANCE_ONLY_NOT_DEFAULT");
  assert.equal(descriptor.dispatch_allowed, false);
  assert.equal(descriptor.runtime_activation, false);
  assert.equal(descriptor.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.controls.creativity.range), true);
  assert.equal(Object.hasOwn(descriptor, "max_file_size"), false);
  assert.deepEqual(descriptor.source_pins, {
    public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    settings_inventory_sha256: "sha256:00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61",
    form_sha256: "sha256:0d3559b37f3ce20528638a45307e7ce30a9cf9a6aa2e446b059f30830aae14e8",
    settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
    upscaler_helper_sha256: "sha256:91f684d0675d788483698f2fa5c974be8d55ba925915a84449871e67b600487b",
    app_sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf",
    parent_sha256: "sha256:8b00e34ae7e8d848c3967255648ce8839853690643a68726cf3faee26b913587",
    submit_helper_sha256: "sha256:83fdb2ef6086fc92c8497abd6fbfb4cb4f673a8cc44b695e3d865fd6dc021aad",
    cost_helper_sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9"
  });
});

test("all three variants return full frozen explicit state and derive variant model_type and cost inputs", () => {
  for (const variant of ["creative", "precision_v1", "precision_v2"] as const) {
    const result = normalizeOwnerMagnificUpscaleParameters(request(variant));
    assert.equal(result.variant, variant);
    assert.equal(result.ai_name, "magnific");
    assert.equal(result.model_type, variant);
    assert.deepEqual(result.parameters, SOURCE_STATE);
    assert.deepEqual(result.dimensions, { width: 1_000, height: 1_000 });
    assert.deepEqual(result.cost_inputs, { width: 1_000, height: 1_000, scale_factor: "2x" });
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.parameters), true);
    assert.equal(Object.isFrozen(result.dimensions), true);
    assert.equal(Object.isFrozen(result.cost_inputs), true);
    assert.equal(Object.hasOwn(result, "file_urls"), false);
  }
});

test("source UI scale choices use literal index multipliers and fall back to 2x only when none fit", () => {
  assert.deepEqual(normalizeOwnerMagnificUpscaleParameters(request("creative", { scale_factor: "8x" }, {
    width: 1_000, height: 1_000
  })).ui_scale_choices, ["2x", "4x", "8x"]);
  assert.deepEqual(normalizeOwnerMagnificUpscaleParameters(request("creative", { scale_factor: "2x" }, {
    width: 5_000, height: 5_060
  })).ui_scale_choices, ["2x"]);
  assert.deepEqual(normalizeOwnerMagnificUpscaleParameters(request("creative", { scale_factor: "2x" }, {
    width: 6_000, height: 6_000
  })).ui_scale_choices, ["2x"]);
});

test("every source enum and all four scale strings normalize when the UI allows them", () => {
  for (const scale_factor of ["2x", "4x", "8x", "16x"] as const) {
    const result = normalizeOwnerMagnificUpscaleParameters(request("creative", { scale_factor }, { width: 1, height: 1 }));
    assert.equal(result.parameters.scale_factor, scale_factor);
    assert.deepEqual(result.ui_scale_choices, ["2x", "4x", "8x", "16x"]);
  }
  for (const optimized_for of [
    "standard", "soft_portraits", "hard_portraits", "art_n_illustration", "videogame_assets",
    "nature_n_landscapes", "films_n_photography", "3d_renders", "science_fiction_n_horror"
  ] as const) {
    assert.equal(normalizeOwnerMagnificUpscaleParameters(request("creative", { optimized_for })).parameters.optimized_for, optimized_for);
  }
  for (const engine of ["automatic", "magnific_illusio", "magnific_sharpy", "magnific_sparkle"] as const) {
    assert.equal(normalizeOwnerMagnificUpscaleParameters(request("creative", { engine })).parameters.engine, engine);
  }
  for (const flavor of ["sublime", "photo", "photo_denoiser"] as const) {
    const result = normalizeOwnerMagnificUpscaleParameters(request("precision_v2", { flavor }));
    assert.equal(result.parameters.flavor, flavor);
    assert.equal(result.scale_lock, flavor === "sublime" ? null : "PRECISION_V2_PHOTO_FIXED_2X");
  }
});

test("precision scale locks require explicit 2x and never silently replace caller scale", () => {
  const v1 = normalizeOwnerMagnificUpscaleParameters(request("precision_v1"));
  assert.deepEqual(v1.ui_scale_choices, ["2x"]);
  assert.equal(v1.scale_lock, "PRECISION_V1_FIXED_2X");
  for (const flavor of ["photo", "photo_denoiser"] as const) {
    const v2 = normalizeOwnerMagnificUpscaleParameters(request("precision_v2", { flavor }));
    assert.deepEqual(v2.ui_scale_choices, ["2x"]);
    assert.equal(v2.scale_lock, "PRECISION_V2_PHOTO_FIXED_2X");
    assert.throws(() => normalizeOwnerMagnificUpscaleParameters(request("precision_v2", { flavor, scale_factor: "4x" })),
      (error: unknown) => error instanceof OwnerMagnificUpscaleParametersError && error.code === "INVALID_PARAMETERS");
  }
  assert.deepEqual(normalizeOwnerMagnificUpscaleParameters(request("precision_v2", { flavor: "sublime", scale_factor: "8x" })).ui_scale_choices,
    ["2x", "4x", "8x"]);
  assert.equal(normalizeOwnerMagnificUpscaleParameters(request("precision_v2", { flavor: "sublime" })).scale_lock, null);
  assert.throws(() => normalizeOwnerMagnificUpscaleParameters(request("precision_v1", { scale_factor: "4x" })),
    (error: unknown) => error instanceof OwnerMagnificUpscaleParametersError && error.code === "INVALID_PARAMETERS");
});

test("every numeric UI boundary is inclusive and fractional or out-of-range values are rejected", () => {
  for (const value of [-10, 10]) {
    const result = normalizeOwnerMagnificUpscaleParameters(request("creative", {
      creativity: value, hdr: value, resemblance: value, fractality: value
    }));
    assert.deepEqual([result.parameters.creativity, result.parameters.hdr, result.parameters.resemblance, result.parameters.fractality],
      [value, value, value, value]);
  }
  for (const value of [0, 100]) {
    const result = normalizeOwnerMagnificUpscaleParameters(request("precision_v2", {
      sharpen: value, smart_grain: value, ultra_detail: value
    }));
    assert.deepEqual([result.parameters.sharpen, result.parameters.smart_grain, result.parameters.ultra_detail], [value, value, value]);
  }
  for (const bad of [
    { creativity: -11 }, { hdr: 11 }, { resemblance: 1.5 }, { fractality: Number.NaN },
    { sharpen: -1 }, { smart_grain: 101 }, { ultra_detail: Number.POSITIVE_INFINITY }
  ]) {
    assert.throws(() => normalizeOwnerMagnificUpscaleParameters(request("creative", bad)),
      (error: unknown) => error instanceof OwnerMagnificUpscaleParametersError && error.code === "INVALID_PARAMETERS");
  }
});

test("all explicit enums are closed and inactive fields are still required and validated", () => {
  for (const [key, value] of [
    ["optimized_for", "portrait"], ["engine", "unknown"], ["flavor", "photo-denoiser"], ["scale_factor", "2"]
  ] as const) {
    assert.throws(() => normalizeOwnerMagnificUpscaleParameters(request("creative", { [key]: value })),
      (error: unknown) => error instanceof OwnerMagnificUpscaleParametersError && error.code === "INVALID_PARAMETERS");
  }
  for (const key of Object.keys(SOURCE_STATE)) {
    const missing = { ...SOURCE_STATE } as Record<string, unknown>;
    delete missing[key];
    assert.throws(() => normalizeOwnerMagnificUpscaleParameters({
      variant: "precision_v1", parameters: missing, dimensions: { width: 1_000, height: 1_000 }
    }), (error: unknown) => error instanceof OwnerMagnificUpscaleParametersError && error.code === "INVALID_PARAMETERS");
  }
});

test("normalizer rejects unknown wire/model fields, wrong shapes, and caller-supplied model_type", () => {
  for (const bad of [
    request("creative", { model_type: "precision_v2" }), request("creative", { n: 1 }),
    request("creative", { file_urls: [] }), request("creative", { width: 1_000 }),
    { ...request(), variant: "MAGNIFIC" }, { ...request(), prompt: "not a control" },
    { ...request(), dimensions: { width: 1_000, height: 1_000, scale_factor: "2x" } },
    { variant: "creative", parameters: SOURCE_STATE, dimensions: { width: 1_000 } }
  ]) {
    assert.throws(() => normalizeOwnerMagnificUpscaleParameters(bad),
      (error: unknown) => error instanceof OwnerMagnificUpscaleParametersError && error.code === "INVALID_PARAMETERS");
  }
});

test("strict records reject symbols, accessors, foreign prototypes, and proxies without invoking getters", () => {
  const symbolParams = { ...SOURCE_STATE, [Symbol("extra")]: true };
  const accessorParams = { ...SOURCE_STATE };
  let getterCalled = false;
  Object.defineProperty(accessorParams, "creativity", { enumerable: true, get() { getterCalled = true; return 3; } });
  for (const parameters of [symbolParams, accessorParams, Object.assign(Object.create({ inherited: true }), SOURCE_STATE), new Proxy({ ...SOURCE_STATE }, {})]) {
    assert.throws(() => normalizeOwnerMagnificUpscaleParameters({
      variant: "creative", parameters, dimensions: { width: 1_000, height: 1_000 }
    }), (error: unknown) => error instanceof OwnerMagnificUpscaleParametersError && error.code === "INVALID_PARAMETERS");
  }
  assert.equal(getterCalled, false);
});

test("dimensions require positive safe integers and reject unsafe scale-area arithmetic", () => {
  for (const dimensions of [
    { width: 0, height: 1 }, { width: -1, height: 1 }, { width: 1.5, height: 2 },
    { width: Number.NaN, height: 2 }, { width: Number.MAX_SAFE_INTEGER, height: 64 },
    { width: "1000", height: 1 }
  ]) {
    assert.throws(() => normalizeOwnerMagnificUpscaleParameters(request("creative", {}, dimensions)),
      (error: unknown) => error instanceof OwnerMagnificUpscaleParametersError && error.code === "INVALID_PARAMETERS");
  }
});
