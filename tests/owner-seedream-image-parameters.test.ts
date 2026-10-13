import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerSeedreamImageSourceParameters,
  normalizeOwnerSeedreamImageParameters,
  OwnerSeedreamImageParametersError
} from "../src/application/owner-seedream-image-parameters.js";

const VARIANTS = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;
const RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;
const RESOLUTIONS = {
  "seedream-4": ["1K", "2K", "4K"],
  "seedream-4.5": ["2K", "4K"],
  "seedream-5": ["2K", "3K", "4K"],
  "seedream-5.0-flash": ["1K", "1.5K", "2K"],
  "seedream-5.0-pro": ["1K", "2K"]
} as const;

function input(variant: typeof VARIANTS[number], overrides: Record<string, unknown> = {}) {
  const flash = variant === "seedream-5.0-flash";
  return {
    variant,
    reference_count: 0,
    parameters: { aspect_ratio: "1:1", resolution: RESOLUTIONS[variant][0], output_format: flash ? "jpeg" : null, background: flash ? "opaque" : null, ...overrides }
  };
}

test("Seedream descriptor exposes all five variants, ratios, resolutions, and inactive Flash-only controls", () => {
  const descriptor = getOwnerSeedreamImageSourceParameters();
  assert.deepEqual(descriptor.variants, VARIANTS);
  assert.deepEqual(descriptor.controls.aspect_ratio.values, RATIOS);
  assert.deepEqual(descriptor.controls.resolution.values_by_variant, RESOLUTIONS);
  assert.deepEqual(descriptor.controls.output_format.active_by_variant, {
    "seedream-4": false, "seedream-4.5": false, "seedream-5": false,
    "seedream-5.0-flash": true, "seedream-5.0-pro": false
  });
  assert.equal(descriptor.effective_defaults, "UNKNOWN");
  assert.equal(descriptor.runtime_activation, false);
  assert.equal(descriptor.dispatch_allowed, false);
  assert.equal(descriptor.backend_acceptance, "UNPROVEN");
});

test("all explicit ratio and resolution combinations normalize without narrowing source choices", () => {
  let count = 0;
  for (const variant of VARIANTS) for (const aspect_ratio of RATIOS) for (const resolution of RESOLUTIONS[variant]) {
    const result = normalizeOwnerSeedreamImageParameters({
      ...input(variant), parameters: { ...input(variant).parameters, aspect_ratio, resolution }
    });
    assert.equal(result.parameters.aspect_ratio, aspect_ratio);
    assert.equal(result.parameters.resolution, resolution);
    count += 1;
  }
  assert.equal(count, 104);
});

test("only Flash retains explicit format/background, and transparency requires declared eligibility context", () => {
  const jpegOpaque = normalizeOwnerSeedreamImageParameters(input("seedream-5.0-flash", { output_format: "jpeg", background: "opaque" }));
  assert.deepEqual(jpegOpaque.parameters, { aspect_ratio: "1:1", resolution: "1K", output_format: "jpeg", background: "opaque" });
  const pngOpaque = normalizeOwnerSeedreamImageParameters(input("seedream-5.0-flash", { output_format: "png", background: "opaque" }));
  assert.deepEqual(pngOpaque.wire_settings, { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "opaque", stream: false, n: 1 });
  const transparent = normalizeOwnerSeedreamImageParameters({
    ...input("seedream-5.0-flash", { output_format: "png", background: "transparent" }),
    reference_count: 1,
    transparency_context: { reference_count: 1, source_mime_types: ["image/png"], pixel_alpha_eligible: true }
  });
  assert.equal(transparent.transparency_eligibility.pixel_alpha_proven, false);
  assert.equal(transparent.transparency_eligibility.owned_references_bound, false);
  assert.throws(() => normalizeOwnerSeedreamImageParameters(input("seedream-5.0-flash", { output_format: "jpeg", background: "transparent" })), OwnerSeedreamImageParametersError);
  assert.throws(() => normalizeOwnerSeedreamImageParameters(input("seedream-5.0-flash", { output_format: "png", background: "transparent" })), OwnerSeedreamImageParametersError);
  for (const variant of VARIANTS.filter((item) => item !== "seedream-5.0-flash")) {
    assert.deepEqual(normalizeOwnerSeedreamImageParameters(input(variant)).wire_settings,
      { aspect_ratio: "1:1", resolution: RESOLUTIONS[variant][0], stream: false, n: 1 });
  }
});

test("every explicit reference count through the source ceiling is accepted and one above is rejected", () => {
  const maxima = { "seedream-4": 4, "seedream-4.5": 4, "seedream-5": 14, "seedream-5.0-flash": 10, "seedream-5.0-pro": 10 } as const;
  for (const variant of VARIANTS) {
    for (const reference_count of [0, maxima[variant]]) {
      const result = normalizeOwnerSeedreamImageParameters({ ...input(variant), reference_count });
      assert.equal(result.reference_count, reference_count);
    }
    assert.throws(() => normalizeOwnerSeedreamImageParameters({ ...input(variant), reference_count: maxima[variant] + 1 }), OwnerSeedreamImageParametersError);
  }
});

test("Pro cost inputs count every declared reference including zero and omit cost inputs on other variants", () => {
  const freeOfReferences = normalizeOwnerSeedreamImageParameters({
    ...input("seedream-5.0-pro"), reference_count: 0
  });
  assert.deepEqual(freeOfReferences.cost_inputs, { batch_size: 0, resolution: "1K" });
  const withReferences = normalizeOwnerSeedreamImageParameters({ ...input("seedream-5.0-pro"), reference_count: 4 });
  assert.deepEqual(withReferences.cost_inputs, { batch_size: 4, resolution: "1K" });
  for (const variant of VARIANTS.filter((item) => item !== "seedream-5.0-pro")) {
    assert.deepEqual(normalizeOwnerSeedreamImageParameters(input(variant)).cost_inputs, {});
  }
});

test("normalizer rejects malformed, coerced, accessor, proxy, extra, and contradictory states", () => {
  for (const bad of [
    input("seedream-5.0-flash", { aspect_ratio: "5:4" }),
    input("seedream-4.5", { resolution: "1K" }),
    input("seedream-4", { output_format: "png" }),
    input("seedream-5.0-flash", { background: "transparent" }),
    { ...input("seedream-4"), parameters: { ...input("seedream-4").parameters, extra: true } },
    { ...input("seedream-5.0-flash"), reference_count: 1, transparency_context: { reference_count: 1, source_mime_types: ["image/jpeg"], pixel_alpha_eligible: true } },
    { ...input("seedream-5.0-flash"), transparency_context: { reference_count: 1, source_mime_types: ["image/png", "image/png"], pixel_alpha_eligible: true } }
  ]) assert.throws(() => normalizeOwnerSeedreamImageParameters(bad), OwnerSeedreamImageParametersError);
  const accessor = Object.defineProperty({}, "variant", { enumerable: true, get() { throw new Error("must not invoke"); } });
  assert.throws(() => normalizeOwnerSeedreamImageParameters(accessor), OwnerSeedreamImageParametersError);
  assert.throws(() => normalizeOwnerSeedreamImageParameters(new Proxy(input("seedream-4"), {})), OwnerSeedreamImageParametersError);
});
