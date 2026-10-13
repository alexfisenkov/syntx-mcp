import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerBananaImageSourceParameters,
  normalizeOwnerBananaImageParameters,
  OwnerBananaImageParametersError
} from "../src/application/owner-banana-image-parameters.js";

const RATIOS = [null, "21:9", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "1:1"] as const;
const EXPECTED_VARIANTS = [
  { variant: "banana", sizes: [null], thinking: [null], maximum: 4 },
  { variant: "banana-2.1", sizes: ["1K", "2K", "4K"], thinking: ["minimal", "medium", "high"], maximum: 14 },
  { variant: "banana2", sizes: ["1K", "2K", "4K"], thinking: [null], maximum: 14 },
  { variant: "banana3", sizes: ["0.5K", "1K", "2K", "4K"], thinking: [null], maximum: 14 },
  { variant: "banana3_light", sizes: ["1K"], thinking: [null], maximum: 14 }
] as const;

function input(variant: string, aspect_ratio: unknown, image_size: unknown, thinking_level: unknown, reference_count = 0) {
  return { variant, reference_count, parameters: { aspect_ratio, image_size, thinking_level } };
}

test("source parameters expose the five exact variants, visible/inactive fields, and non-dispatch status", () => {
  const source = getOwnerBananaImageSourceParameters();
  assert.deepEqual(source.variants, EXPECTED_VARIANTS.map(({ variant }) => variant));
  assert.deepEqual(source.controls.aspect_ratio.values, RATIOS);
  assert.deepEqual(source.controls.image_size.values_by_variant, {
    banana: [null], "banana-2.1": ["1K", "2K", "4K"], banana2: ["1K", "2K", "4K"],
    banana3: ["0.5K", "1K", "2K", "4K"], banana3_light: ["1K"]
  });
  assert.deepEqual(source.controls.thinking_level.values_by_variant, {
    banana: [null], "banana-2.1": ["minimal", "medium", "high"], banana2: [null], banana3: [null], banana3_light: [null]
  });
  assert.deepEqual(source.reference_limits, {
    banana: { minimum: 0, maximum: 4 }, "banana-2.1": { minimum: 0, maximum: 14 },
    banana2: { minimum: 0, maximum: 14 }, banana3: { minimum: 0, maximum: 14 }, banana3_light: { minimum: 0, maximum: 14 }
  });
  assert.deepEqual(source.cost_policy, {
    banana: { controlled_inputs: [], quote_or_amount: "UNPROVEN" },
    "banana-2.1": { controlled_inputs: ["image_size"], quote_or_amount: "UNPROVEN" },
    banana2: { controlled_inputs: ["image_size"], quote_or_amount: "UNPROVEN" },
    banana3: { controlled_inputs: ["image_size"], quote_or_amount: "UNPROVEN" },
    banana3_light: { controlled_inputs: ["image_size"], quote_or_amount: "UNPROVEN" }
  });
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(source.controls.image_size.values_by_variant.banana3), true);
});

const LITERAL_VALID_COMBINATIONS = [
  "banana|~|~|~",
  "banana|21:9|~|~",
  "banana|16:9|~|~",
  "banana|9:16|~|~",
  "banana|5:4|~|~",
  "banana|4:5|~|~",
  "banana|4:3|~|~",
  "banana|3:4|~|~",
  "banana|3:2|~|~",
  "banana|2:3|~|~",
  "banana|1:1|~|~",
  "banana-2.1|~|1K|minimal",
  "banana-2.1|21:9|1K|minimal",
  "banana-2.1|16:9|1K|minimal",
  "banana-2.1|9:16|1K|minimal",
  "banana-2.1|5:4|1K|minimal",
  "banana-2.1|4:5|1K|minimal",
  "banana-2.1|4:3|1K|minimal",
  "banana-2.1|3:4|1K|minimal",
  "banana-2.1|3:2|1K|minimal",
  "banana-2.1|2:3|1K|minimal",
  "banana-2.1|1:1|1K|minimal",
  "banana-2.1|~|1K|medium",
  "banana-2.1|21:9|1K|medium",
  "banana-2.1|16:9|1K|medium",
  "banana-2.1|9:16|1K|medium",
  "banana-2.1|5:4|1K|medium",
  "banana-2.1|4:5|1K|medium",
  "banana-2.1|4:3|1K|medium",
  "banana-2.1|3:4|1K|medium",
  "banana-2.1|3:2|1K|medium",
  "banana-2.1|2:3|1K|medium",
  "banana-2.1|1:1|1K|medium",
  "banana-2.1|~|1K|high",
  "banana-2.1|21:9|1K|high",
  "banana-2.1|16:9|1K|high",
  "banana-2.1|9:16|1K|high",
  "banana-2.1|5:4|1K|high",
  "banana-2.1|4:5|1K|high",
  "banana-2.1|4:3|1K|high",
  "banana-2.1|3:4|1K|high",
  "banana-2.1|3:2|1K|high",
  "banana-2.1|2:3|1K|high",
  "banana-2.1|1:1|1K|high",
  "banana-2.1|~|2K|minimal",
  "banana-2.1|21:9|2K|minimal",
  "banana-2.1|16:9|2K|minimal",
  "banana-2.1|9:16|2K|minimal",
  "banana-2.1|5:4|2K|minimal",
  "banana-2.1|4:5|2K|minimal",
  "banana-2.1|4:3|2K|minimal",
  "banana-2.1|3:4|2K|minimal",
  "banana-2.1|3:2|2K|minimal",
  "banana-2.1|2:3|2K|minimal",
  "banana-2.1|1:1|2K|minimal",
  "banana-2.1|~|2K|medium",
  "banana-2.1|21:9|2K|medium",
  "banana-2.1|16:9|2K|medium",
  "banana-2.1|9:16|2K|medium",
  "banana-2.1|5:4|2K|medium",
  "banana-2.1|4:5|2K|medium",
  "banana-2.1|4:3|2K|medium",
  "banana-2.1|3:4|2K|medium",
  "banana-2.1|3:2|2K|medium",
  "banana-2.1|2:3|2K|medium",
  "banana-2.1|1:1|2K|medium",
  "banana-2.1|~|2K|high",
  "banana-2.1|21:9|2K|high",
  "banana-2.1|16:9|2K|high",
  "banana-2.1|9:16|2K|high",
  "banana-2.1|5:4|2K|high",
  "banana-2.1|4:5|2K|high",
  "banana-2.1|4:3|2K|high",
  "banana-2.1|3:4|2K|high",
  "banana-2.1|3:2|2K|high",
  "banana-2.1|2:3|2K|high",
  "banana-2.1|1:1|2K|high",
  "banana-2.1|~|4K|minimal",
  "banana-2.1|21:9|4K|minimal",
  "banana-2.1|16:9|4K|minimal",
  "banana-2.1|9:16|4K|minimal",
  "banana-2.1|5:4|4K|minimal",
  "banana-2.1|4:5|4K|minimal",
  "banana-2.1|4:3|4K|minimal",
  "banana-2.1|3:4|4K|minimal",
  "banana-2.1|3:2|4K|minimal",
  "banana-2.1|2:3|4K|minimal",
  "banana-2.1|1:1|4K|minimal",
  "banana-2.1|~|4K|medium",
  "banana-2.1|21:9|4K|medium",
  "banana-2.1|16:9|4K|medium",
  "banana-2.1|9:16|4K|medium",
  "banana-2.1|5:4|4K|medium",
  "banana-2.1|4:5|4K|medium",
  "banana-2.1|4:3|4K|medium",
  "banana-2.1|3:4|4K|medium",
  "banana-2.1|3:2|4K|medium",
  "banana-2.1|2:3|4K|medium",
  "banana-2.1|1:1|4K|medium",
  "banana-2.1|~|4K|high",
  "banana-2.1|21:9|4K|high",
  "banana-2.1|16:9|4K|high",
  "banana-2.1|9:16|4K|high",
  "banana-2.1|5:4|4K|high",
  "banana-2.1|4:5|4K|high",
  "banana-2.1|4:3|4K|high",
  "banana-2.1|3:4|4K|high",
  "banana-2.1|3:2|4K|high",
  "banana-2.1|2:3|4K|high",
  "banana-2.1|1:1|4K|high",
  "banana2|~|1K|~",
  "banana2|21:9|1K|~",
  "banana2|16:9|1K|~",
  "banana2|9:16|1K|~",
  "banana2|5:4|1K|~",
  "banana2|4:5|1K|~",
  "banana2|4:3|1K|~",
  "banana2|3:4|1K|~",
  "banana2|3:2|1K|~",
  "banana2|2:3|1K|~",
  "banana2|1:1|1K|~",
  "banana2|~|2K|~",
  "banana2|21:9|2K|~",
  "banana2|16:9|2K|~",
  "banana2|9:16|2K|~",
  "banana2|5:4|2K|~",
  "banana2|4:5|2K|~",
  "banana2|4:3|2K|~",
  "banana2|3:4|2K|~",
  "banana2|3:2|2K|~",
  "banana2|2:3|2K|~",
  "banana2|1:1|2K|~",
  "banana2|~|4K|~",
  "banana2|21:9|4K|~",
  "banana2|16:9|4K|~",
  "banana2|9:16|4K|~",
  "banana2|5:4|4K|~",
  "banana2|4:5|4K|~",
  "banana2|4:3|4K|~",
  "banana2|3:4|4K|~",
  "banana2|3:2|4K|~",
  "banana2|2:3|4K|~",
  "banana2|1:1|4K|~",
  "banana3|~|0.5K|~",
  "banana3|21:9|0.5K|~",
  "banana3|16:9|0.5K|~",
  "banana3|9:16|0.5K|~",
  "banana3|5:4|0.5K|~",
  "banana3|4:5|0.5K|~",
  "banana3|4:3|0.5K|~",
  "banana3|3:4|0.5K|~",
  "banana3|3:2|0.5K|~",
  "banana3|2:3|0.5K|~",
  "banana3|1:1|0.5K|~",
  "banana3|~|1K|~",
  "banana3|21:9|1K|~",
  "banana3|16:9|1K|~",
  "banana3|9:16|1K|~",
  "banana3|5:4|1K|~",
  "banana3|4:5|1K|~",
  "banana3|4:3|1K|~",
  "banana3|3:4|1K|~",
  "banana3|3:2|1K|~",
  "banana3|2:3|1K|~",
  "banana3|1:1|1K|~",
  "banana3|~|2K|~",
  "banana3|21:9|2K|~",
  "banana3|16:9|2K|~",
  "banana3|9:16|2K|~",
  "banana3|5:4|2K|~",
  "banana3|4:5|2K|~",
  "banana3|4:3|2K|~",
  "banana3|3:4|2K|~",
  "banana3|3:2|2K|~",
  "banana3|2:3|2K|~",
  "banana3|1:1|2K|~",
  "banana3|~|4K|~",
  "banana3|21:9|4K|~",
  "banana3|16:9|4K|~",
  "banana3|9:16|4K|~",
  "banana3|5:4|4K|~",
  "banana3|4:5|4K|~",
  "banana3|4:3|4K|~",
  "banana3|3:4|4K|~",
  "banana3|3:2|4K|~",
  "banana3|2:3|4K|~",
  "banana3|1:1|4K|~",
  "banana3_light|~|1K|~",
  "banana3_light|21:9|1K|~",
  "banana3_light|16:9|1K|~",
  "banana3_light|9:16|1K|~",
  "banana3_light|5:4|1K|~",
  "banana3_light|4:5|1K|~",
  "banana3_light|4:3|1K|~",
  "banana3_light|3:4|1K|~",
  "banana3_light|3:2|1K|~",
  "banana3_light|2:3|1K|~",
  "banana3_light|1:1|1K|~"
] as const;

test("accepts every one of the 198 independently specified visible control combinations", () => {
  assert.equal(LITERAL_VALID_COMBINATIONS.length, 198);
  for (const combination of LITERAL_VALID_COMBINATIONS) {
    const [variant, ratio, size, thinking] = combination.split("|");
    const decode = (value: string) => value === "~" ? null : value;
    const result = normalizeOwnerBananaImageParameters(input(variant!, decode(ratio!), decode(size!), decode(thinking!), 0));
    assert.equal(result.variant, variant);
    assert.deepEqual(result.parameters, {
      aspect_ratio: decode(ratio!), image_size: decode(size!), thinking_level: decode(thinking!)
    });
  }
});

test("admits all 65 catalog reference-count states without claiming owned-reference support", () => {
  let accepted = 0;
  for (const expected of EXPECTED_VARIANTS) {
    for (let reference_count = 0; reference_count <= expected.maximum; reference_count += 1) {
      const image_size = expected.variant === "banana" ? null : expected.variant === "banana3" ? "0.5K" : "1K";
      const thinking_level = expected.variant === "banana-2.1" ? "minimal" : null;
      const result = normalizeOwnerBananaImageParameters(input(expected.variant, null, image_size, thinking_level, reference_count));
      assert.equal(result.reference_count, reference_count);
      assert.equal(result.reference_binding.owned_references_bound, false);
      accepted += 1;
    }
  }
  assert.equal(accepted, 65);
});

test("keeps caller nulls distinct from the source JSON field mapping", () => {
  const base = normalizeOwnerBananaImageParameters(input("banana", null, null, null));
  assert.deepEqual(base.parameters, { aspect_ratio: null, image_size: null, thinking_level: null });
  assert.deepEqual(base.source_json_mapping, { model_type: "banana", aspect_ratio: null, image_size: null });
  assert.deepEqual(base.cost_inputs, {});
  assert.equal(base.runtime_activation, false);
  const two = normalizeOwnerBananaImageParameters(input("banana-2.1", null, "2K", "high"));
  assert.deepEqual(two.source_json_mapping, { model_type: "banana-2.1", aspect_ratio: null, image_size: "2K", thinking_level: "high" });
  assert.deepEqual(two.cost_inputs, { image_size: "2K" });
  const lite = normalizeOwnerBananaImageParameters(input("banana3_light", null, "1K", null));
  assert.deepEqual(lite.source_json_mapping, { model_type: "banana3_light", aspect_ratio: null, image_size: "1K" });
  assert.equal(base.dispatch_allowed, false);
});

test("rejects invalid active or inactive axes and hostile/extraneous input without invoking getters", () => {
  for (const bad of [
    input("banana-2.1", null, "8K", "high"), input("banana-2.1", null, "2K", null),
    input("banana", null, "1K", null), input("banana", null, null, "medium"),
    input("banana3", "7:5", "2K", null), input("other", null, null, null),
    { ...input("banana", null, null, null), extra: true },
    { variant: "banana", reference_count: 0, parameters: Object.defineProperty({}, "aspect_ratio", { enumerable: true, get() { throw new Error("must not run"); } }) }
  ]) {
    assert.throws(() => normalizeOwnerBananaImageParameters(bad),
      (error: unknown) => error instanceof OwnerBananaImageParametersError && error.code === "INVALID_PARAMETERS");
  }
});
