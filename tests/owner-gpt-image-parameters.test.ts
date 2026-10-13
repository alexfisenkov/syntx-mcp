import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerGptImageSourceParameters,
  normalizeOwnerGptImageParameters
} from "../src/application/owner-gpt-image-parameters.js";

test("GPT Image parameter API exposes the full exact source matrix", async () => {
  assert.equal(typeof getOwnerGptImageSourceParameters, "function");
  assert.equal(typeof normalizeOwnerGptImageParameters, "function");
});

test("all 396 independently enumerated source combinations and 62 reference-count contexts validate", () => {
  const cases = [
    { variant: "gpt-image-1", ratios: ["3:2", "1:1", "2:3"], qualities: [null], details: [null] },
    { variant: "gpt-image-1.5", ratios: ["3:2", "1:1", "2:3"], qualities: [null], details: [null] },
    { variant: "gpt-image-2", ratios: ["1:1", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "21:9"], qualities: ["1K", "2K", "4K"], details: ["low", "medium", "high"] },
    { variant: "gpt-image-2.5-flare", ratios: ["1:1", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "21:9"], qualities: ["1K", "2K", "4K"], details: ["low", "medium", "high", "xhigh", "max"] },
    { variant: "gpt-image-2.5-sunburst", ratios: ["1:1", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "21:9"], qualities: ["1K", "2K", "4K"], details: ["low", "medium", "high", "xhigh", "max"] }
  ] as const;
  const expectedReferenceMaximums = [5, 10, 10, 16, 16] as const;
  let matrixCases = 0;
  let referenceContexts = 0;
  for (const [index, row] of cases.entries()) {
    for (const aspect_ratio of row.ratios) {
      for (const quality of row.qualities) {
        for (const details_quality of row.details) {
          const result = normalizeOwnerGptImageParameters({
            variant: row.variant,
            reference_count: 0,
            parameters: { aspect_ratio, quality, details_quality }
          });
          assert.equal(result.parameters.aspect_ratio, aspect_ratio);
          assert.equal(result.parameters.quality, quality);
          assert.equal(result.parameters.details_quality, details_quality);
          matrixCases += 1;
        }
      }
    }
    for (let reference_count = 0; reference_count <= expectedReferenceMaximums[index]!; reference_count += 1) {
      const first = row.ratios[0]!;
      const quality = row.qualities[0]!;
      const details_quality = row.details[0]!;
      const result = normalizeOwnerGptImageParameters({ variant: row.variant, reference_count, parameters: { aspect_ratio: first, quality, details_quality } });
      assert.equal(result.reference_count, reference_count);
      assert.equal(result.reference_count_confidence, "PUBLIC_CATALOG_DECLARED_LIMIT_NOT_PROVIDER_ACCEPTANCE_OR_OWNED_REFERENCES");
      if (row.variant === "gpt-image-2.5-flare" || row.variant === "gpt-image-2.5-sunburst") {
        assert.equal(Object.hasOwn(result.cost_inputs, "ref_count"), reference_count > 0);
        if (reference_count > 0) assert.equal(result.cost_inputs.ref_count, reference_count);
      }
      referenceContexts += 1;
    }
  }
  assert.equal(matrixCases, 396);
  assert.equal(referenceContexts, 62);
});

test("wire settings and source cost inputs keep variant-specific names and omit explicit-null legacy fields", () => {
  const legacy = normalizeOwnerGptImageParameters({
    variant: "gpt-image-1.5", reference_count: 10,
    parameters: { aspect_ratio: "3:2", quality: null, details_quality: null }
  });
  assert.deepEqual(legacy.source_wire_settings, { aspect_ratio: "3:2" });
  assert.deepEqual(legacy.cost_inputs, {});

  const gpt2 = normalizeOwnerGptImageParameters({
    variant: "gpt-image-2", reference_count: 4,
    parameters: { aspect_ratio: "21:9", quality: "2K", details_quality: "high" }
  });
  assert.deepEqual(gpt2.source_wire_settings, { aspect_ratio: "21:9", quality: "2K", details_quality: "high" });
  assert.deepEqual(gpt2.cost_inputs, { quality: "2K", details_quality: "high" });

  const gpt25 = normalizeOwnerGptImageParameters({
    variant: "gpt-image-2.5-flare", reference_count: 7,
    parameters: { aspect_ratio: "4:5", quality: "4K", details_quality: "xhigh" }
  });
  assert.deepEqual(gpt25.cost_inputs, { quality: "4K", details_quality: "xhigh", ref_count: 7 });
  const gpt25Empty = normalizeOwnerGptImageParameters({
    variant: "gpt-image-2.5-flare", reference_count: 0,
    parameters: { aspect_ratio: "4:5", quality: "4K", details_quality: "xhigh" }
  });
  assert.deepEqual(gpt25Empty.cost_inputs, { quality: "4K", details_quality: "xhigh" });
  assert.equal(gpt25.cost_input_confidence, "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP");
  assert.equal(gpt25.dispatch_allowed, false);
  assert.equal(gpt25.runtime_activation, false);
  assert.equal(gpt25.backend_acceptance, "UNPROVEN");
  assert.deepEqual(getOwnerGptImageSourceParameters().cost_policy.controlled_inputs["gpt-image-2.5-flare"], ["quality", "details_quality", "reference_count"]);
  assert.equal(Object.isFrozen(gpt25), true);
  assert.equal(Object.isFrozen(gpt25.parameters), true);
});

test("explicit request records reject missing, extra, inherited, accessor, and proxied state", () => {
  const valid = { variant: "gpt-image-2", reference_count: 0, parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "low" } };
  const invalidRequests: unknown[] = [
    { ...valid, parameters: { aspect_ratio: "1:1", quality: "1K" } },
    { ...valid, parameters: { ...valid.parameters, details_quality: "low", ratio: "1:1" } },
    Object.assign(Object.create({ inherited: true }), valid),
    new Proxy(valid, {})
  ];
  const accessorParameters = Object.defineProperties({}, {
    aspect_ratio: { enumerable: true, get: () => "1:1" },
    quality: { enumerable: true, value: "1K" },
    details_quality: { enumerable: true, value: "low" }
  });
  invalidRequests.push({ ...valid, parameters: accessorParameters });
  for (const request of invalidRequests) {
    assert.throws(() => normalizeOwnerGptImageParameters(request));
  }
});

test("normalization freezes a detached snapshot without mutating caller input", () => {
  const request = {
    variant: "gpt-image-2.5-sunburst",
    reference_count: 2,
    parameters: { aspect_ratio: "16:9", quality: "2K", details_quality: "max" }
  };
  const before = structuredClone(request);
  const result = normalizeOwnerGptImageParameters(request);
  assert.deepEqual(request, before);
  assert.notEqual(result.parameters, request.parameters);
  assert.equal(Object.isFrozen(request), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.parameters), true);
});

test("source descriptor is frozen and rejects unknown variants, aliases, defaults, and out-of-range counts", () => {
  const descriptor = getOwnerGptImageSourceParameters();
  assert.deepEqual(descriptor.variants, ["gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
  assert.equal(descriptor.defaults, "UNKNOWN");
  assert.equal(descriptor.dispatch_allowed, false);
  assert.equal(Object.isFrozen(descriptor), true);
  assert.throws(() => normalizeOwnerGptImageParameters({ variant: "gpt-image-3", reference_count: 0, parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "low" } }));
  assert.throws(() => normalizeOwnerGptImageParameters({ variant: "gpt-image-2", reference_count: 0, parameters: { aspect_ratio: "square", quality: "1K", details_quality: "low" } }));
  assert.throws(() => normalizeOwnerGptImageParameters({ variant: "gpt-image-2", reference_count: 0, parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "low", size: "2K" } }));
  assert.throws(() => normalizeOwnerGptImageParameters({ variant: "gpt-image-2", reference_count: 11, parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "low" } }));
  assert.throws(() => normalizeOwnerGptImageParameters({ variant: "gpt-image-2.5-flare", reference_count: 1.5, parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "low" } }));
  for (const invalid of [
    { variant: "gpt-image-1", reference_count: 0, parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: null } },
    { variant: "gpt-image-1.5", reference_count: 0, parameters: { aspect_ratio: "1:1", quality: null, details_quality: "low" } },
    { variant: "gpt-image-2", reference_count: 0, parameters: { aspect_ratio: "1:1", quality: null, details_quality: "low" } },
    { variant: "gpt-image-2", reference_count: 0, parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "xhigh" } },
    { variant: "gpt-image-2.5-flare", reference_count: 17, parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "low" } },
    { variant: "gpt-image-1", reference_count: 6, parameters: { aspect_ratio: "1:1", quality: null, details_quality: null } }
  ]) assert.throws(() => normalizeOwnerGptImageParameters(invalid));
});
