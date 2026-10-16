import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_TOPAZ_ENHANCE_MODEL_ID,
  getOwnerTopazEnhanceSourceProfile
} from "../src/application/owner-topaz-enhance-source-profile.js";
import {
  normalizeOwnerTopazEnhanceParameters,
  projectOwnerTopazEnhanceWireSettings,
  OwnerTopazEnhanceParametersError,
  type OwnerTopazEnhanceParametersInput
} from "../src/application/owner-topaz-enhance-parameters.js";

const validParameters = Object.freeze({
  blur: -10,
  halo: 0,
  focus: "normal",
  grain: "off",
  model: "rhea-1",
  noise: 10,
  details: 20,
  preblur: -20,
  upscale: 2,
  prenoise: 30,
  compression: 40,
  interpolation: 60
} as const);

function validInput(): OwnerTopazEnhanceParametersInput {
  return {
    model_id: OWNER_TOPAZ_ENHANCE_MODEL_ID,
    parameters: { ...validParameters }
  };
}

test("Topaz Enhance profile pins reviewed source and stays static-only", () => {
  const profile = getOwnerTopazEnhanceSourceProfile(OWNER_TOPAZ_ENHANCE_MODEL_ID);
  assert.ok(profile);
  assert.equal(profile.model_id, "topaz_enhance");
  assert.equal(profile.ai_name, "topaz_ai");
  assert.equal(profile.source_pins.source_build_id, "1792133067");
  assert.equal(profile.source_pins.public_catalog_version, "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json");
  assert.equal(profile.source_pins.public_models_sha256, "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1");
  assert.deepEqual(profile.source_pins.modules, {
    topaz_enhance: "sha256:de4f0e844a1c41d8b2dfad185bf360974543ca162daf6c4d3604c19e3379ad2a",
    topaz_models: "sha256:50bbd38a27592dd187e8b21349bfcb148c35b8ebdb60df373b578c419bc90e40",
    upscaler3: "sha256:406fbed9c59ffe38d9e02e8475de2e26706a3a8b4f09fe839b3a29c5a8a43d55",
    use_upscaler_tool: "sha256:bcdd047929542224ea0289fbc495a00ef22f53f5ca98be6b489b2c47885e8561",
    app: "sha256:5488b33ac6de23e559932a485c7cf2f7d034151f3d735005dfb0a334ee21a175",
    upscaler_page: "sha256:31d71db2e4f1b96517b2a4d34158290568a9e0253c87d8541ad492dcd2cf1c7b",
    new_session_button: "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc"
  });
  assert.deepEqual(profile.controls.model.values, ["ghq-5", "rhea-1", "prob-4", "iris-3", "gcg-5"]);
  assert.deepEqual(profile.controls.upscale.values, [1, 2, 4]);
  assert.deepEqual(profile.controls.interpolation.values, [24, 25, 30, 45, 50, 60]);
  assert.deepEqual(profile.controls.numeric.values, { prenoise: [0, 100], compression: [-100, 100], details: [-100, 100], blur: [-100, 100], noise: [-100, 100], halo: [-100, 100], preblur: [-100, 100] });
  assert.deepEqual(profile.controls.focus.values, ["off", "normal", "strong"]);
  assert.deepEqual(profile.controls.grain.values, ["off", "on"]);
  assert.equal(profile.catalog_default_model, "rhea-1");
  assert.equal(profile.form_fallback_model, "prob-4");
  assert.equal(profile.effective_defaults, "UNKNOWN");
  assert.equal(profile.controls.conditional_combinations, "UNPROVEN");
  assert.equal(profile.runtime_usable, false);
  assert.equal(profile.dispatch_allowed, false);
  assert.equal(profile.backend_acceptance, "UNPROVEN");
  assert.equal(getOwnerTopazEnhanceSourceProfile("slc-1"), undefined);
  assert.equal(Object.isFrozen(profile.source_pins.modules), true);
  assert.equal(Object.isFrozen(profile.controls.numeric.values), true);
});

test("Topaz Enhance normalizer requires explicit exact controls and returns copied frozen data", () => {
  const input = validInput();
  const normalized = normalizeOwnerTopazEnhanceParameters(input);
  assert.deepEqual(normalized, input);
  assert.notEqual(normalized.parameters, input.parameters);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.parameters), true);
  assert.throws(() => normalizeOwnerTopazEnhanceParameters({ model_id: OWNER_TOPAZ_ENHANCE_MODEL_ID }), OwnerTopazEnhanceParametersError);
  assert.throws(() => normalizeOwnerTopazEnhanceParameters({ ...input, extra: 1 }), OwnerTopazEnhanceParametersError);
  assert.throws(() => normalizeOwnerTopazEnhanceParameters({ ...input, parameters: { ...input.parameters, promode: 1 } }), OwnerTopazEnhanceParametersError);
  assert.throws(() => normalizeOwnerTopazEnhanceParameters({ ...input, parameters: { ...input.parameters, model: "other" } }), OwnerTopazEnhanceParametersError);
  assert.throws(() => normalizeOwnerTopazEnhanceParameters({ ...input, parameters: { ...input.parameters, upscale: 3 } }), OwnerTopazEnhanceParametersError);
  assert.throws(() => normalizeOwnerTopazEnhanceParameters({ ...input, parameters: { ...input.parameters, prenoise: 1.5 } }), OwnerTopazEnhanceParametersError);
  assert.throws(() => normalizeOwnerTopazEnhanceParameters({ ...input, parameters: { ...input.parameters, blur: -101 } }), OwnerTopazEnhanceParametersError);
  assert.throws(() => normalizeOwnerTopazEnhanceParameters({ ...input, parameters: { ...input.parameters, compression: 101 } }), OwnerTopazEnhanceParametersError);
  assert.deepEqual(normalizeOwnerTopazEnhanceParameters({ ...input, parameters: { ...input.parameters, blur: -100, halo: 100, prenoise: 0 } }).parameters,
    { ...input.parameters, blur: -100, halo: 100, prenoise: 0 });
  const getterParameters = Object.defineProperty({ ...input.parameters }, "blur", { enumerable: true, get: () => 0 });
  assert.throws(() => normalizeOwnerTopazEnhanceParameters({ ...input, parameters: getterParameters }), OwnerTopazEnhanceParametersError);
  const proxy = new Proxy(input, {});
  assert.throws(() => normalizeOwnerTopazEnhanceParameters(proxy), OwnerTopazEnhanceParametersError);
});

test("Topaz Enhance projection emits only pure settings with observed fixed fields", () => {
  const normalized = normalizeOwnerTopazEnhanceParameters(validInput());
  const projected = projectOwnerTopazEnhanceWireSettings(normalized, { width: 1920, height: 1080, duration_seconds: 2.49 });
  assert.deepEqual(projected, {
    model_type: "topaz_enhance",
    resolution: "2",
    video_duration: 2,
    width: 1920,
    height: 1080,
    parameters: {
      blur: -10,
      halo: 0,
      blend: 0,
      focus: "normal",
      grain: "off",
      model: "rhea-1",
      noise: 10,
      details: 20,
      preblur: -20,
      promode: 0,
      upscale: 2,
      prenoise: 30,
      compression: 40,
      interpolation: 60
    }
  });
  assert.equal(Object.hasOwn(projected, "file_urls"), false);
  assert.equal(Object.hasOwn(projected, "prompt"), false);
  assert.equal(Object.hasOwn(projected, "chat_id"), false);
  assert.equal(Object.isFrozen(projected.parameters), true);
});

test("Topaz Enhance projection validates measured dimensions and applies only observed upscale-4 predicate", () => {
  const normalized = normalizeOwnerTopazEnhanceParameters({ ...validInput(), parameters: { ...validParameters, upscale: 4 } });
  assert.throws(() => projectOwnerTopazEnhanceWireSettings(validInput() as never, { width: 1920, height: 1080, duration_seconds: 2 }), OwnerTopazEnhanceParametersError);
  for (const video of [
    { width: 1280, height: 720, duration_seconds: 2 },
    { width: 640, height: 720, duration_seconds: 2 },
    { width: 1920, height: 1080, duration_seconds: 1.999 },
    { width: 1920, height: 1080, duration_seconds: 26.251 },
    { width: 0, height: 1080, duration_seconds: 2 },
    { width: 1920, height: Number.MAX_SAFE_INTEGER + 1, duration_seconds: 2 }
  ]) assert.throws(() => projectOwnerTopazEnhanceWireSettings(normalized, video), OwnerTopazEnhanceParametersError);
  assert.deepEqual(projectOwnerTopazEnhanceWireSettings(normalized, { width: 1279, height: 719, duration_seconds: 2 }).resolution, "4");
});
