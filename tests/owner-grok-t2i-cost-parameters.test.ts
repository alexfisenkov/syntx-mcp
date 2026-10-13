import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { projectOwnerGrokT2iCostParameters } from "../src/application/owner-grok-t2i-cost-parameters.js";
import { OwnerGrokT2iParametersError } from "../src/application/owner-grok-t2i-parameters.js";

test("Grok Imagine 2 projects explicit source controls to caller keys and keeps routing separate", () => {
  const result = projectOwnerGrokT2iCostParameters({
    model_id: "grok_imagine_2",
    reference_count: 2,
    parameters: { aspect_ratio: "9:16", batch_size: 3, resolution: "2k", details_quality: "medium" }
  });
  assert.deepEqual(result, {
    model_id: "grok_imagine_2",
    routing: { ai_name: "grok_image", model_type: "grok_imagine_2" },
    cost_inputs: { batch_size: 3, resolution: "2k", details_quality: "medium", ref_count: 2 },
    reference_count_context: {
      reference_count: 2,
      confidence: "SOURCE_SELECTOR_COUNT_ONLY_NOT_OWNED_REFERENCE_PROOF",
      owned_references_bound: false
    },
    source_binding: {
      form_build_id: "1791467421",
      form_sha256: "sha256:1bbf68ba51172eeacaa936e66755236179d8595bde98b54f78414b30645b2f5d",
      cost2_build_id: "1791467421",
      cost2_sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9",
      value_chain: "ROOT770_COST2_PROJECTOR_TO_GETCOST"
    },
    confidence: "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP",
    dispatch_allowed: false,
    runtime_activation: false,
    backend_acceptance: "UNPROVEN"
  });
});

test("reference count remains explicit UI context and never becomes an owned-reference grant", () => {
  const result = projectOwnerGrokT2iCostParameters({
    model_id: "grok_imagine_2",
    reference_count: 0,
    parameters: { aspect_ratio: "1:1", batch_size: 1, resolution: "1k", details_quality: "low" }
  });
  assert.deepEqual(result.reference_count_context, {
    reference_count: 0,
    confidence: "SOURCE_SELECTOR_COUNT_ONLY_NOT_OWNED_REFERENCE_PROOF",
    owned_references_bound: false
  });
});

test("projected keys reach the real model-access and HTTP GET boundary without swallowing reserved routing", async () => {
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
    "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    resolve(process.cwd(), "catalog")
  ));
  const urls: URL[] = [];
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-test-credential"); }
  };
  const client = new SyntxHttpClient({
    credentialBroker: broker,
    fetchImpl: async (input) => {
      urls.push(new URL(String(input)));
      return new Response(JSON.stringify({ access: true, cost: 0, discount_cost: 0,
        free_remaining_generations: 0, limit: 0, show_warning: false }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
  });
  const service = new ModelAccessService(catalog, client, () => Date.parse("2026-10-11T00:00:00.000Z"));
  const cases = [
    { model_id: "grok_t2i", reference_count: 0,
      parameters: { aspect_ratio: "1:1", batch_size: 2, resolution: "1k" }, expected: { batch_size: "2" } },
    { model_id: "grok_t2i_pro", reference_count: 0,
      parameters: { aspect_ratio: "16:9", batch_size: 5, resolution: "2k" }, expected: { batch_size: "5" } },
    { model_id: "grok_imagine_2", reference_count: 0,
      parameters: { aspect_ratio: "9:16", batch_size: 3, resolution: "2k", details_quality: "medium" },
      expected: { batch_size: "3", resolution: "2k", details_quality: "medium" } },
    { model_id: "grok_imagine_quality", reference_count: 0,
      parameters: { aspect_ratio: "9:16", batch_size: 4, resolution: "1k" },
      expected: { batch_size: "4", resolution: "1k" } }
  ] as const;
  for (const entry of cases) {
    const projection = projectOwnerGrokT2iCostParameters({
      model_id: entry.model_id, reference_count: entry.reference_count, parameters: entry.parameters
    });
    await service.getModelAccess({ model_id: projection.model_id, cost_parameters: projection.cost_inputs });
    const url = urls.at(-1)!;
    assert.equal(url.searchParams.get("ai_name"), "grok_image");
    assert.equal(url.searchParams.get("model_type"), entry.model_id);
    assert.deepEqual(url.searchParams.getAll("model_type"), [entry.model_id]);
    assert.deepEqual(Object.fromEntries([...url.searchParams.entries()].filter(([key]) => !["ai_name", "model_type"].includes(key)).sort()), entry.expected);
    assert.equal(url.searchParams.has("aspect_ratio"), false);
    assert.equal(url.searchParams.has("ref_count"), false);
  }

  const positiveReferenceProjection = projectOwnerGrokT2iCostParameters({
    model_id: "grok_imagine_2", reference_count: 2,
    parameters: { aspect_ratio: "16:9", batch_size: 1, resolution: "1k", details_quality: "low" }
  });
  await service.getModelAccess({ model_id: positiveReferenceProjection.model_id,
    cost_parameters: positiveReferenceProjection.cost_inputs });
  assert.equal(urls.at(-1)?.searchParams.get("ref_count"), "2");
  assert.equal(urls.at(-1)?.searchParams.get("model_type"), "grok_imagine_2");
  await assert.rejects(() => client.getModelInfo({ ai_name: "grok_image", model_type: "grok_imagine_2",
    cost_parameters: { model_type: "spoof" } }));
  assert.equal(urls.length, cases.length + 1);
});

test("literal full matrix preserves caller cost keys across model, resolution, batch, quality, and ref branches", () => {
  const baseRatios = ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"] as const;
  const imagineRatios = ["1:1", "2:3", "3:2", "9:16", "16:9"] as const;
  const models = [
    { model_id: "grok_t2i", reference_counts: [0], cost_keys: ["batch_size"] as const },
    { model_id: "grok_t2i_pro", reference_counts: [0], cost_keys: ["batch_size"] as const },
    { model_id: "grok_imagine_2", reference_counts: [0, 1, 2, 3, 4, 5], cost_keys: ["batch_size", "resolution", "details_quality", "ref_count"] as const },
    { model_id: "grok_imagine_quality", reference_counts: [0, 1, 2, 3], cost_keys: ["batch_size", "resolution"] as const }
  ] as const;
  let checked = 0;
  for (const model of models) for (const reference_count of model.reference_counts) {
    const ratios = reference_count > 0 || model.model_id === "grok_t2i" || model.model_id === "grok_t2i_pro"
      ? baseRatios : imagineRatios;
    for (const aspect_ratio of ratios) for (const resolution of ["1k", "2k"] as const) {
      for (const batch_size of [1, 2, 3, 4, 5] as const) for (const details_quality of model.model_id === "grok_imagine_2" ? ["low", "medium"] as const : [undefined]) {
        const parameters = { aspect_ratio, resolution, batch_size,
          ...(details_quality === undefined ? {} : { details_quality }) };
        const expected: Record<string, string | number> = {};
        for (const key of model.cost_keys) {
          if (key === "batch_size") expected.batch_size = batch_size;
          if (key === "resolution") expected.resolution = resolution;
          if (key === "details_quality" && details_quality !== undefined) expected.details_quality = details_quality;
          if (key === "ref_count" && reference_count > 0) expected.ref_count = reference_count;
        }
        const actual = projectOwnerGrokT2iCostParameters({ model_id: model.model_id, reference_count, parameters });
        assert.deepEqual(actual.cost_inputs, expected);
        assert.deepEqual(actual.routing, { ai_name: "grok_image", model_type: model.model_id });
        assert.equal(actual.reference_count_context.reference_count, reference_count);
        assert.equal(actual.reference_count_context.owned_references_bound, false);
        assert.equal(Object.hasOwn(actual.cost_inputs, "model_type"), false);
        assert.equal(Object.hasOwn(actual.cost_inputs, "ai_name"), false);
        assert.equal(Object.hasOwn(actual.cost_inputs, "aspect_ratio"), false);
        assert.equal(Object.hasOwn(actual.cost_inputs, "n"), false);
        assert.equal(Object.hasOwn(actual.cost_inputs, "stream"), false);
        assert.equal(Object.hasOwn(actual.cost_inputs, "ref_count"), reference_count > 0 && model.model_id === "grok_imagine_2");
        checked += 1;
      }
    }
  }
  assert.equal(checked, 1_500);
});

test("foreign, injected, malformed, accessor, and proxy input cannot widen the cost projection", () => {
  const valid = { model_id: "grok_imagine_2", reference_count: 0,
    parameters: { aspect_ratio: "1:1", batch_size: 1, resolution: "1k", details_quality: "low" } };
  const invalid: unknown[] = [
    { ...valid, model_id: "grok_imagine_3" },
    { ...valid, cost_parameters: { batch_size: 9 } },
    { ...valid, cost_inputs: { model_type: "spoof" } },
    { ...valid, ai_name: "other_image" },
    { ...valid, reference_count: 6 },
    { ...valid, model_id: "grok_imagine_quality", reference_count: 4,
      parameters: { aspect_ratio: "16:9", batch_size: 1, resolution: "1k" } },
    { ...valid, reference_count: null },
    { ...valid, parameters: { ...valid.parameters, model_type: "grok_imagine_2" } },
    { ...valid, parameters: { ...valid.parameters, n: 1 } },
    { ...valid, parameters: { aspect_ratio: "1:1", resolution: "1k", details_quality: "low" } },
    { ...valid, parameters: null }
  ];
  const accessor = { ...valid };
  Object.defineProperty(accessor.parameters, "batch_size", { enumerable: true, get: () => 1 });
  invalid.push(accessor, new Proxy(valid, {}));
  for (const candidate of invalid) {
    assert.throws(() => projectOwnerGrokT2iCostParameters(candidate), OwnerGrokT2iParametersError);
  }
});

test("projection is immutable and does not rewrite caller intent", () => {
  const input = { model_id: "grok_t2i", reference_count: 0,
    parameters: { aspect_ratio: "4:3", batch_size: 2, resolution: "2k" } };
  const before = structuredClone(input);
  const result = projectOwnerGrokT2iCostParameters(input);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.routing), true);
  assert.equal(Object.isFrozen(result.cost_inputs), true);
  assert.equal(Object.isFrozen(result.reference_count_context), true);
  assert.equal(Object.isFrozen(result.source_binding), true);
});
