import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerKontextImageSourceParameters,
  normalizeOwnerKontextImageParameters,
  OwnerKontextImageParametersError
} from "../src/application/owner-kontext-image-parameters.js";

const RESOLUTIONS = ["1344x768", "1152x896", "1024x1024", "896x1152", "768x1344"] as const;
const VARIANTS = ["flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"] as const;

function params(overrides: Record<string, unknown> = {}) {
  return { resolution: "1024x1024", cfg: 1, steps: 10, image_strength: 0, ...overrides };
}

test("Kontext source descriptor pins all variants, four controls, reference policy, and unresolved evidence", () => {
  const descriptor = getOwnerKontextImageSourceParameters();
  assert.deepEqual(descriptor.variants, VARIANTS);
  assert.deepEqual(Object.keys(descriptor.controls), ["resolution", "cfg", "steps", "image_strength"]);
  assert.deepEqual(descriptor.controls.resolution.values, RESOLUTIONS);
  assert.deepEqual(descriptor.reference_count, {
    "flux-kontext-pro": { minimum: 0, maximum: 1, confidence: "CLIENT_FORM_ONLY_BACKEND_UNPROVEN" },
    "flux-kontext-max": { minimum: 0, maximum: 1, confidence: "CLIENT_FORM_ONLY_BACKEND_UNPROVEN" },
    "flux-kontext-multi": { minimum: 1, maximum: 4, confidence: "CLIENT_FORM_ONLY_BACKEND_UNPROVEN" }
  });
  assert.equal(descriptor.controls.steps.range.slider_step, 1);
  assert.equal(descriptor.controls.steps.range.integer_only_proven, false);
  assert.equal(descriptor.controls.cfg.range.slider_step, 0.1);
  assert.equal(descriptor.controls.cfg.range.multiple_of_step_required, false);
  assert.equal(descriptor.controls.image_strength.range.slider_step, 0.1);
  assert.equal(descriptor.controls.image_strength.range.multiple_of_step_required, false);
  assert.equal(descriptor.ai_name, "flux");
  assert.equal(descriptor.scope, "image");
  assert.deepEqual(descriptor.source_pins, {
    public_catalog_snapshot: "sha256-c6fdcc522def8f6f4ef2c172d23822164f0124b29bb5fe86e2b5dce5c54b9fbc.json",
    flux_form_sha256: "sha256:80307235518f6f0c80952ce4a5a0834ee373d7294f8dc90e58748d57389de664",
    image_caller_module_sha256: "sha256:eb4fe700c7afae0756348aad3118c55ec8c9b5f5e5d18832045be07bbd368447",
    image_sender_module_sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae",
    file_mapper_module_sha256: "sha256:8a1c0d06d68b82d97ac6a58ed7caf8d2e759d31cc10f0b1ceb26d676fa664706",
    slider_form_sha256: "sha256:406cd52179aa2ed1a526ab9ce5466d7a19f7653f7efd58bb91f7a1253fe061b6"
  });
  assert.equal(descriptor.dispatch_allowed, false);
  assert.equal(descriptor.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.controls.cfg.range), true);
  assert.throws(() => normalizeOwnerKontextImageParameters({
    variant: VARIANTS[0], parameters: params({ workflow_type: "default", civitai_loras: [] })
  }), OwnerKontextImageParametersError);
});

test("normalizer preserves every explicit resolution and numeric boundary for each variant", () => {
  for (const variant of VARIANTS) {
    for (const resolution of RESOLUTIONS) {
      const result = normalizeOwnerKontextImageParameters({
        variant,
        parameters: { resolution, cfg: 1, steps: 10, image_strength: 0 }
      });
      assert.equal(result.model_id, variant);
      assert.equal(result.variant, variant);
      assert.equal(result.ai_name, "flux");
      assert.equal(result.scope, "image");
      assert.equal(result.parameters.resolution, resolution);
      assert.equal(result.parameters.cfg, 1);
      assert.equal(result.parameters.steps, 10);
      assert.equal(result.parameters.image_strength, 0);
      assert.equal(Object.isFrozen(result.parameters), true);
    }
    const maximum = normalizeOwnerKontextImageParameters({
      variant,
      parameters: { resolution: "768x1344", cfg: 4, steps: 28, image_strength: 1 }
    });
    assert.equal(maximum.parameters.cfg, 4);
    assert.equal(maximum.parameters.steps, 28);
    assert.equal(maximum.parameters.image_strength, 1);
    assert.equal(Object.isFrozen(maximum), true);
  }
});

test("normalizer accepts bounded off-grid manual input without rounding or imposing slider ticks", () => {
  for (const value of [1, 1.05, 1.123, 2.35, 3.999, 4]) {
    assert.equal(normalizeOwnerKontextImageParameters({
      variant: "flux-kontext-pro",
      parameters: { resolution: "1024x1024", cfg: value, steps: 10.25, image_strength: 0.123 }
    }).parameters.cfg, value);
    const strength = value / 4;
    assert.equal(normalizeOwnerKontextImageParameters({
      variant: "flux-kontext-max",
      parameters: { resolution: "1024x1024", cfg: 1.05, steps: 10.25, image_strength: strength }
    }).parameters.image_strength, strength);
  }
  assert.equal(normalizeOwnerKontextImageParameters({
    variant: "flux-kontext-multi",
    parameters: { resolution: "1024x1024", cfg: 1, steps: 10.25, image_strength: 0.3 }
  }).parameters.steps, 10.25);
  for (const variant of VARIANTS) {
    const result = normalizeOwnerKontextImageParameters({
      variant,
      parameters: { resolution: "1024x1024", cfg: 1.05, steps: 10.5, image_strength: 0.123 }
    });
    assert.deepEqual(result.parameters, { resolution: "1024x1024", cfg: 1.05, steps: 10.5, image_strength: 0.123 });
  }
  for (const invalid of [0.9, 4.1]) {
    assert.throws(() => normalizeOwnerKontextImageParameters({
      variant: "flux-kontext-pro",
      parameters: { resolution: "1024x1024", cfg: invalid, steps: 10, image_strength: 0 }
    }), OwnerKontextImageParametersError);
  }
  for (const invalid of [-0.1, 1.1]) {
    assert.throws(() => normalizeOwnerKontextImageParameters({
      variant: "flux-kontext-pro",
      parameters: { resolution: "1024x1024", cfg: 1, steps: 10, image_strength: invalid }
    }), OwnerKontextImageParametersError);
  }
});

test("normalizer rejects non-finite values, unknown state, invalid variants and non-source resolutions", () => {
  const valid = { variant: "flux-kontext-max", parameters: params() };
  for (const steps of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 9.99, 28.01]) {
    assert.throws(() => normalizeOwnerKontextImageParameters({
      ...valid, parameters: params({ steps })
    }), OwnerKontextImageParametersError);
  }
  for (const resolution of ["3:2", "1024", "1024x1024 ", "1344x768-alias"]) {
    assert.throws(() => normalizeOwnerKontextImageParameters({
      ...valid, parameters: params({ resolution })
    }), OwnerKontextImageParametersError);
  }
  for (const variant of ["flux-1", "flux-kontext", "flux-kontext-ultra", null, 1]) {
    assert.throws(() => normalizeOwnerKontextImageParameters({ ...valid, variant }), OwnerKontextImageParametersError);
  }
  for (const key of ["raw", "workflow_type", "civitai_loras", "file_urls", "model_type", "n"]) {
    assert.throws(() => normalizeOwnerKontextImageParameters({
      ...valid, parameters: params({ [key]: "caller-value" })
    }), OwnerKontextImageParametersError);
  }
  for (const missing of ["resolution", "cfg", "steps", "image_strength"]) {
    const state = params();
    delete (state as Record<string, unknown>)[missing];
    assert.throws(() => normalizeOwnerKontextImageParameters({ variant: "flux-kontext-pro", parameters: state }),
      OwnerKontextImageParametersError);
  }
  assert.throws(() => normalizeOwnerKontextImageParameters({
    variant: "flux-kontext-pro", parameters: params({ cfg: "1.5" })
  }), OwnerKontextImageParametersError);
});

test("normalizer rejects accessors, proxies, symbols and foreign prototypes then snapshots frozen values", () => {
  let getterCalls = 0;
  const withGetter = { variant: "flux-kontext-pro", parameters: params() };
  Object.defineProperty(withGetter.parameters, "steps", {
    enumerable: true,
    get() { getterCalls += 1; return 10; }
  });
  assert.throws(() => normalizeOwnerKontextImageParameters(withGetter), OwnerKontextImageParametersError);
  assert.equal(getterCalls, 0);
  assert.throws(() => normalizeOwnerKontextImageParameters(new Proxy({}, {})), OwnerKontextImageParametersError);
  assert.throws(() => normalizeOwnerKontextImageParameters({
    variant: "flux-kontext-pro", parameters: Object.assign(Object.create({ inherited: true }), params())
  }), OwnerKontextImageParametersError);
  const symbolState = params() as Record<string | symbol, unknown>;
  symbolState[Symbol("extra")] = true;
  assert.throws(() => normalizeOwnerKontextImageParameters({ variant: "flux-kontext-pro", parameters: symbolState }),
    OwnerKontextImageParametersError);

  const mutable = { variant: "flux-kontext-pro", parameters: params() };
  const result = normalizeOwnerKontextImageParameters(mutable);
  mutable.parameters.cfg = 4;
  mutable.parameters.steps = 28;
  assert.equal(result.parameters.cfg, 1);
  assert.equal(result.parameters.steps, 10);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.parameters), true);
});
