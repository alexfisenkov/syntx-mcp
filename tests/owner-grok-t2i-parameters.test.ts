import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerGrokT2iSourceParameters,
  normalizeOwnerGrokT2iParameters,
  OwnerGrokT2iParametersError
} from "../src/application/owner-grok-t2i-parameters.js";

const MODELS = ["grok_t2i", "grok_t2i_pro", "grok_imagine_2", "grok_imagine_quality"] as const;
const BASE_RATIOS = ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"];
const IMAGINE_RATIOS = ["1:1", "2:3", "3:2", "9:16", "16:9"];

function candidate(model_id: typeof MODELS[number], reference_count: number, parameters: Record<string, unknown> = {}) {
  return { model_id, reference_count, parameters };
}
function explicitParameters(model_id: typeof MODELS[number], overrides: Record<string, unknown> = {}) {
  return { aspect_ratio: "1:1", batch_size: 1, resolution: "1k",
    ...(model_id === "grok_imagine_2" ? { details_quality: "low" } : {}), ...overrides };
}

test("source matrix keeps every T2I model's ratio branch and details-quality support separate", () => {
  const matrix = getOwnerGrokT2iSourceParameters();
  assert.deepEqual(matrix.models, MODELS);
  assert.deepEqual(matrix.controls.resolution.values, ["1k", "2k"]);
  assert.deepEqual(matrix.controls.batch_size.values, [1, 2, 3, 4, 5]);
  assert.deepEqual(matrix.models_by_id.grok_t2i.aspect_ratio_without_references, BASE_RATIOS);
  assert.deepEqual(matrix.models_by_id.grok_t2i_pro.aspect_ratio_without_references, BASE_RATIOS);
  assert.deepEqual(matrix.models_by_id.grok_imagine_2.aspect_ratio_without_references, IMAGINE_RATIOS);
  assert.deepEqual(matrix.models_by_id.grok_imagine_2.aspect_ratio_with_references, BASE_RATIOS);
  assert.deepEqual(matrix.models_by_id.grok_imagine_quality.aspect_ratio_without_references, IMAGINE_RATIOS);
  assert.deepEqual(matrix.models_by_id.grok_imagine_quality.aspect_ratio_with_references, BASE_RATIOS);
  assert.deepEqual(matrix.models_by_id.grok_imagine_2.details_quality.values, ["low", "medium"]);
  assert.deepEqual(matrix.defaults, { aspect_ratio: "1:1", batch_size: 1, resolution: "1k", imagine_2_details_quality: "low" });
  assert.equal(matrix.defaults_confidence, "SOURCE_FORM_CANDIDATES_METADATA_ONLY_NOT_NORMALIZER_INJECTION");
  assert.equal(Object.hasOwn(matrix.models_by_id.grok_t2i, "details_quality"), false);
  assert.equal(Object.hasOwn(matrix.models_by_id.grok_t2i_pro, "details_quality"), false);
  assert.equal(Object.hasOwn(matrix.models_by_id.grok_imagine_quality, "details_quality"), false);
});

test("normalization preserves explicit values and emits no legacy low-quality value for Pro or Imagine Quality", () => {
  const want: Array<{ model_id: typeof MODELS[number]; reference_count: number; parameters: Record<string, string | number> }> = [
    { model_id: "grok_t2i", reference_count: 0, parameters: { aspect_ratio: "1:1", batch_size: 1, resolution: "1k" } },
    { model_id: "grok_t2i_pro", reference_count: 0, parameters: { aspect_ratio: "1:1", batch_size: 1, resolution: "1k" } },
    { model_id: "grok_imagine_2", reference_count: 0, parameters: { aspect_ratio: "1:1", batch_size: 1, resolution: "1k", details_quality: "low" } },
    { model_id: "grok_imagine_quality", reference_count: 0, parameters: { aspect_ratio: "1:1", batch_size: 1, resolution: "1k" } }
  ];
  for (const expected of want) {
    const result = normalizeOwnerGrokT2iParameters(candidate(expected.model_id, expected.reference_count, expected.parameters));
    assert.deepEqual(result.parameters, expected.parameters);
    assert.deepEqual(result.source_json_mapping, { model_type: expected.model_id, ...expected.parameters });
    assert.equal(Object.hasOwn(result.source_json_mapping, "n"), false);
    assert.equal(Object.hasOwn(result.source_json_mapping, "file_urls"), false);
  }
});

test("reference count selects only the source-supported ratio branch without granting upload permission", () => {
  for (const model_id of ["grok_imagine_2", "grok_imagine_quality"] as const) {
    const noReferences = normalizeOwnerGrokT2iParameters(candidate(model_id, 0, explicitParameters(model_id)));
    const withReferences = normalizeOwnerGrokT2iParameters(candidate(model_id, 1, explicitParameters(model_id)));
    assert.deepEqual(noReferences.controls.aspect_ratio, IMAGINE_RATIOS);
    assert.deepEqual(withReferences.controls.aspect_ratio, BASE_RATIOS);
    assert.equal(withReferences.reference_binding.reference_count, 1);
    assert.equal(withReferences.reference_binding.confidence, "SOURCE_UI_SELECTOR_ONLY_NOT_UPLOAD_PERMISSION");
    assert.equal(withReferences.reference_binding.owned_references_bound, false);
  }
  for (const model_id of ["grok_t2i", "grok_t2i_pro"] as const) {
    assert.deepEqual(normalizeOwnerGrokT2iParameters(candidate(model_id, 0, explicitParameters(model_id))).controls.aspect_ratio, BASE_RATIOS);
  }
});

test("accepts every source ratio, resolution, batch value, and Imagine 2 quality value in its applicable branch", () => {
  for (const model_id of MODELS) {
    const maxRefs = model_id === "grok_imagine_2" ? 5 : model_id === "grok_imagine_quality" ? 3 : 0;
    const ratios = model_id === "grok_imagine_2" || model_id === "grok_imagine_quality" ? IMAGINE_RATIOS : BASE_RATIOS;
    for (const aspect_ratio of ratios) for (const resolution of ["1k", "2k"] as const) for (const batch_size of [1, 2, 3, 4, 5]) {
      const parameters = explicitParameters(model_id, { aspect_ratio, resolution, batch_size,
        ...(model_id === "grok_imagine_2" ? { details_quality: "medium" } : {}) });
      const normalized = normalizeOwnerGrokT2iParameters(candidate(model_id, 0, parameters));
      assert.equal(normalized.parameters.aspect_ratio, aspect_ratio);
      assert.equal(normalized.parameters.resolution, resolution);
      assert.equal(normalized.parameters.batch_size, batch_size);
      assert.equal(normalized.reference_count, 0);
    }
    if (maxRefs > 0) {
      for (const aspect_ratio of BASE_RATIOS) {
        const referenced = normalizeOwnerGrokT2iParameters(candidate(model_id, maxRefs,
          explicitParameters(model_id, { aspect_ratio })));
        assert.equal(referenced.parameters.aspect_ratio, aspect_ratio);
        assert.equal(referenced.reference_count, maxRefs);
        assert.deepEqual(referenced.controls.aspect_ratio, BASE_RATIOS);
      }
    }
  }
});

test("accepts both Imagine 2 quality values across every ratio in both reference branches", () => {
  for (const details_quality of ["low", "medium"] as const) {
    for (const [reference_count, ratios] of [[0, IMAGINE_RATIOS], [1, BASE_RATIOS]] as const) {
      for (const aspect_ratio of ratios) {
        const result = normalizeOwnerGrokT2iParameters(candidate("grok_imagine_2", reference_count,
          explicitParameters("grok_imagine_2", { details_quality, aspect_ratio })));
        assert.equal(result.parameters.details_quality, details_quality);
        assert.equal(result.parameters.aspect_ratio, aspect_ratio);
      }
    }
  }
});

test("does not promote source controls into cost, dispatch, runtime, upload, or backend proof", () => {
  const result = normalizeOwnerGrokT2iParameters(candidate("grok_imagine_2", 2,
    explicitParameters("grok_imagine_2", { aspect_ratio: "16:9", batch_size: 5, resolution: "2k", details_quality: "medium" })));
  assert.equal(result.cost_inputs, null);
  assert.equal(result.cost_projection_status, "NOT_JOINED");
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.runtime_activation, false);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal(result.reference_binding.owned_references_bound, false);
});

test("rejects unsupported model/control branches, invalid values, and reference counts outside catalog limits", () => {
  const invalid = [
    candidate("grok_i2i" as typeof MODELS[number], 0),
    candidate("grok_t2i", 1), candidate("grok_t2i_pro", 1),
    candidate("grok_imagine_2", 6), candidate("grok_imagine_quality", 4),
    candidate("grok_t2i", 0, explicitParameters("grok_t2i", { aspect_ratio: "2:4" })),
    candidate("grok_imagine_2", 0, explicitParameters("grok_imagine_2", { aspect_ratio: "1:2" })),
    candidate("grok_t2i", 0, explicitParameters("grok_t2i", { resolution: "4k" })),
    candidate("grok_t2i", 0, explicitParameters("grok_t2i", { batch_size: 0 })), candidate("grok_t2i", 0, explicitParameters("grok_t2i", { batch_size: 5.5 })),
    candidate("grok_imagine_2", 0, explicitParameters("grok_imagine_2", { details_quality: "high" })),
    candidate("grok_t2i_pro", 0, explicitParameters("grok_t2i_pro", { details_quality: "low" })),
    candidate("grok_imagine_quality", 0, explicitParameters("grok_imagine_quality", { details_quality: "low" })),
    candidate("grok_imagine_2", 0, { aspect_ratio: "1:1", resolution: "1k", details_quality: "low" }),
    candidate("grok_t2i", 0, { ...explicitParameters("grok_t2i"), surprise: true })
  ];
  for (const value of invalid) assert.throws(() => normalizeOwnerGrokT2iParameters(value), OwnerGrokT2iParametersError);
});

test("rejects getters, proxies, and extra keys without mutating caller values", () => {
  const original = candidate("grok_imagine_2", 0, explicitParameters("grok_imagine_2"));
  const before = structuredClone(original);
  const normalized = normalizeOwnerGrokT2iParameters(original);
  assert.deepEqual(original, before);
  assert.equal(Object.isFrozen(normalized.parameters), true);
  let getterCalls = 0;
  const parameters = explicitParameters("grok_imagine_2");
  Object.defineProperty(parameters, "details_quality", { enumerable: true, get() { getterCalls += 1; return "low"; } });
  assert.throws(() => normalizeOwnerGrokT2iParameters(candidate("grok_imagine_2", 0, parameters)), OwnerGrokT2iParametersError);
  assert.equal(getterCalls, 0);
  let proxyTraps = 0;
  const proxied = new Proxy(original, { ownKeys() { proxyTraps += 1; return Reflect.ownKeys(original); } });
  assert.throws(() => normalizeOwnerGrokT2iParameters(proxied), OwnerGrokT2iParametersError);
  assert.equal(proxyTraps, 0);
});
