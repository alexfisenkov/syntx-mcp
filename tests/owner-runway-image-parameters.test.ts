import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerRunwayImageSourceParameters,
  normalizeOwnerRunwayImageParameters
} from "../src/application/owner-runway-image-parameters.js";

test("Runway Frames source descriptor and normalization preserve all six resolutions and fractional temperatures", () => {
  assert.deepEqual(getOwnerRunwayImageSourceParameters().parameters.resolution.values, [
    "2112x912", "1920x1088", "1456x1088", "1088x1088", "1088x1456", "1088x1920"
  ]);
  const result = normalizeOwnerRunwayImageParameters({
    variant: "runway_frames", reference_count: 2,
    parameters: { resolution: "1456x1088", temperature: 2.375 }
  });
  assert.deepEqual(result.parameters, { resolution: "1456x1088", temperature: 2.375 });
  assert.deepEqual(result.source_wire_settings, { resolution: "1456x1088", temperature: 2.375, n: 1 });
  assert.deepEqual(result.cost_inputs, {});
  assert.equal(result.reference_binding.owned_references_bound, false);
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.backend_acceptance, "UNPROVEN");
});

test("Runway Frames accepts finite temperature boundaries and every reference-count context", () => {
  for (const temperature of [1, 1.125, 2.5, 4.875, 5]) {
    for (const reference_count of [0, 1, 2, 3]) {
      const result = normalizeOwnerRunwayImageParameters({
        variant: "runway_frames", reference_count,
        parameters: { resolution: "2112x912", temperature }
      });
      assert.equal(result.parameters.temperature, temperature);
      assert.equal(result.reference_count, reference_count);
      assert.equal(result.reference_binding.reference_count, reference_count);
    }
  }
});

test("Runway Frames rejects out-of-range, non-finite, coerced, incomplete, and hostile explicit states", () => {
  const valid = { variant: "runway_frames", reference_count: 0, parameters: { resolution: "1088x1088", temperature: 3.25 } };
  const invalidInputs: unknown[] = [
    { ...valid, reference_count: -1 }, { ...valid, reference_count: 4 }, { ...valid, reference_count: 1.5 },
    { ...valid, reference_count: "1" }, { ...valid, variant: "runway-frames" },
    { ...valid, parameters: { resolution: "1088x1088", temperature: 0.999 } },
    { ...valid, parameters: { resolution: "1088x1088", temperature: 5.001 } },
    { ...valid, parameters: { resolution: "1088x1088", temperature: Number.NaN } },
    { ...valid, parameters: { resolution: "1088x1088", temperature: Number.POSITIVE_INFINITY } },
    { ...valid, parameters: { resolution: "1088x1088", temperature: "3.25" } },
    { ...valid, parameters: { resolution: "1024x1024", temperature: 3.25 } },
    { ...valid, parameters: { resolution: "1088x1088" } },
    { ...valid, parameters: { resolution: "1088x1088", temperature: 3.25, seed: 7 } },
    Object.assign(Object.create({ inherited: true }), valid), new Proxy(valid, {})
  ];
  const accessorParameters = Object.defineProperties({}, {
    resolution: { enumerable: true, value: "1088x1088" },
    temperature: { enumerable: true, get: () => 3.25 }
  });
  invalidInputs.push({ ...valid, parameters: accessorParameters });
  for (const input of invalidInputs) assert.throws(() => normalizeOwnerRunwayImageParameters(input));
});

test("Runway Frames source descriptor is frozen, source-pinned, unknown-default, and non-dispatching", () => {
  const descriptor = getOwnerRunwayImageSourceParameters();
  assert.deepEqual(descriptor.variants, ["runway_frames"]);
  assert.equal(descriptor.reference_limits.maximum, 3);
  assert.deepEqual(descriptor.fixed_wire, { n: 1, confidence: "STATIC_SOURCE_MAPPING_NOT_BACKEND_ACCEPTANCE" });
  assert.equal(descriptor.local_safety_bounds.maximum_image_file_bytes, 33_554_432);
  assert.equal(descriptor.local_safety_bounds.maximum_prompt_utf8_bytes, 65_536);
  assert.equal(descriptor.local_safety_bounds.image_file_confidence, "LOCAL_PROCESS_RESOURCE_CEILING_NOT_PROVIDER_LIMIT");
  assert.equal(descriptor.local_safety_bounds.dimensions, "SOURCE_LIMIT_UNKNOWN; PROFILE_DOES_NOT_CLAIM_UNBOUNDED_DIMENSIONS");
  assert.equal(descriptor.parameters.temperature.manual_input_policy, "PRESERVE_FINITE_IN_RANGE_FRACTIONS_NO_QUANTIZATION");
  assert.equal(descriptor.effective_defaults, "UNKNOWN");
  assert.equal(descriptor.dispatch_allowed, false);
  assert.equal(descriptor.runtime_activation, false);
  assert.equal(descriptor.backend_acceptance, "UNPROVEN");
  assert.equal(descriptor.source_pins.form_module, "runway-frames.js");
  assert.match(descriptor.source_pins.form_sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.parameters.resolution.values), true);
});
