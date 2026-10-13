import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import type { GenerationContractCatalogModel } from "../src/adapter/syntx/generation-contract-executor.js";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import {
  createOwnerReviewedContractCallPolicy,
  prepareOwnerReviewedContractCall
} from "../src/application/owner-contract-probe-policy.js";
import {
  createGenerationContractRegistryV2,
  serializeGenerationContractRegistryV2,
  type GenerationContractV2Input,
  type GenerationContractRegistryV2Input
} from "../src/domain/generation-contract-v2.js";

const SOURCE_HASH = `sha256:${"a".repeat(64)}`;
const MODEL_ID = "seedance-2.0";
const VARIANT_ID = "seedance-2.0-t2v-source-reviewed-no-reference-mini";
const CATALOG_VERSION = "2026-10-14T00:00:00.000Z.aaaaaaaaaaaa";
const ATTEMPT_ID = "link_cost_bindings_test_00000000001";
const HAILUO02_REGISTRY = "sha256-9d93e36903179921e9febd7f1a5794a4577f9c5f2b87dc413448a9383339cb0c.json";
const HAILUO02_SCHEMA_HASH = "sha256:31b415e56a382010b58f66e2e81ab76a13bbf7cb214969300afdd09007c839d2";
const BINDINGS = {
  video_duration: { kind: "parameter", parameter: "video_duration" },
  duration: { kind: "literal", value: 0 },
  mode: { kind: "literal", value: "mini" },
  size: { kind: "parameter", parameter: "aspect_ratio" },
  resolution: { kind: "parameter", parameter: "resolution" }
} as const;
const COSTS = { video_duration: 5, duration: 0, mode: "mini", size: "16:9", resolution: "720p" } as const;

function contract(overrides: Partial<GenerationContractV2Input> = {}): GenerationContractV2Input {
  return {
    variant_id: VARIANT_ID,
    model_id: MODEL_ID,
    operation_id: "generate-video",
    modality: "video",
    route: "video",
    ai_name: "seedance",
    model_type: MODEL_ID,
    status: "reviewed",
    provenance: {
      settings_source_sha256: SOURCE_HASH,
      reviewed_at: "2026-10-14T00:00:00.000Z",
      references: [
        { kind: "public_catalog", reference: "fixture model", sha256: SOURCE_HASH },
        { kind: "frontend_static", reference: "fixture settings", sha256: SOURCE_HASH },
        { kind: "manual_review", reference: "fixture review" }
      ]
    },
    parameters: {
      type: "object", additional_properties: false, required: ["prompt", "resolution", "aspect_ratio", "video_duration"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 200 },
        resolution: { type: "string", enum: ["480p", "720p"] },
        aspect_ratio: { type: "string", enum: ["16:9", "9:16"] },
        video_duration: { type: "integer", minimum: 1, maximum: 10 },
        frames: { type: "array", items: { type: "string" }, max_items: 2 }
      },
      conditions: [], conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-video", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { resolution: "resolution", aspect_ratio: "aspect_ratio", video_duration: "video_duration", frames: "frames" },
      fixed_settings: { mode: "mini", generate_audio: true }, media_reference_fields: {}
    },
    output: { decoder_profile: "seedance-video-mp4", mime_types: ["video/mp4"] },
    limits: { max_parameters: 8, max_value_depth: 4, max_serialized_bytes: 4096, max_normalized_nodes: 20_000 },
    ...overrides
  };
}

function makeRegistry(contractInput: GenerationContractV2Input) {
  const input: GenerationContractRegistryV2Input = {
    schema_version: "2.0.0", catalog_version: CATALOG_VERSION,
    source_hashes: { ai: SOURCE_HASH, llm_models: SOURCE_HASH, models: SOURCE_HASH }, contracts: [contractInput]
  };
  return createGenerationContractRegistryV2(input);
}

function makeExecutor(contractInput: GenerationContractV2Input) {
  const registry = makeRegistry(contractInput);
  const model: GenerationContractCatalogModel = {
    id: MODEL_ID, upstream_id: MODEL_ID, ai_name: "seedance", active: true,
    operations: [{ id: "generate-video", output_modality: "video" }], fetched_at: "2026-10-14T00:00:00.000Z",
    source_hashes: { ai: SOURCE_HASH, llm_models: SOURCE_HASH, models: SOURCE_HASH }
  };
  return { registry, executor: new GenerationContractExecutorV2(registry, { getModel: () => model }) };
}

function policyInput(contractInput: GenerationContractV2Input, costs: Readonly<Record<string, string | number | boolean>> = COSTS) {
  const { registry, executor } = makeExecutor(contractInput);
  const registryVersion = `sha256-${createHash("sha256").update(serializeGenerationContractRegistryV2(registry)).digest("hex")}.json`;
  return {
    registry, executor, registryVersion,
    input: {
      registry, registryVersion, executor, attemptId: ATTEMPT_ID, modelId: MODEL_ID,
      operationId: "generate-video" as const, variantId: VARIANT_ID,
      parameters: { prompt: "synthetic", resolution: "720p", aspect_ratio: "16:9", video_duration: 5 },
      costParameters: costs
    }
  };
}

test("an omitted optional cost binding preserves the existing V2 contract content address", () => {
  const hailuo02 = loadGenerationContractRegistryV2(HAILUO02_REGISTRY, resolve("catalog"));
  const hailuo02Contract = hailuo02.contracts.find((item) => item.variant_id === "hailuo-02-t2v-source-reviewed-no-reference-768p-6-10-1080p-6s");
  assert.equal(hailuo02Contract?.schema_hash, HAILUO02_SCHEMA_HASH);
  assert.equal(Object.hasOwn(hailuo02Contract ?? {}, "cost_parameter_bindings"), false);

  const first = makeRegistry(contract()).contracts[0]!;
  const roundTrip = makeRegistry(contract()).contracts[0]!;
  assert.equal(Object.hasOwn(first, "cost_parameter_bindings"), false);
  assert.equal(first.schema_hash, roundTrip.schema_hash);
  assert.equal(serializeGenerationContractRegistryV2(makeRegistry(contract())), serializeGenerationContractRegistryV2(makeRegistry(contract())));
});

test("reviewed cost bindings project aliases and literals without changing the prepared video wire settings", async () => {
  const contractWithBindings = { ...contract(), cost_parameter_bindings: BINDINGS } as GenerationContractV2Input;
  const { registry, executor, input, registryVersion } = policyInput(contractWithBindings);
  const policy = createOwnerReviewedContractCallPolicy(input);
  let observedCosts: Readonly<Record<string, string | number | boolean>> | undefined;
  const prepared = await prepareOwnerReviewedContractCall(policy, ATTEMPT_ID,
    async () => ({ active: true, plan_type: "OwnerTest", end_date: null, end_date_kind: null }),
    async (_attemptId, _modelId, costParameters) => {
      observedCosts = costParameters;
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: registry.catalog_version,
        model_id: MODEL_ID, ai_name: "seedance", model_type: MODEL_ID,
        account_read_live: true, parameter_keys: Object.keys(costParameters).sort(), parameters_redacted: true,
        access: true, cost: null, discount_cost: null, free_remaining_generations: null, limit: null,
        show_warning: null, observed_at: "2026-10-14T00:00:00.000Z"
      };
    });
  assert.deepEqual(observedCosts === undefined ? undefined : { ...observedCosts }, COSTS);
  assert.deepEqual(prepared.settings, { model_type: MODEL_ID, mode: "mini", generate_audio: true,
    resolution: "720p", aspect_ratio: "16:9", video_duration: 5 });
  assert.equal(Object.hasOwn(prepared.settings, "duration"), false);
  assert.equal(Object.hasOwn(prepared.settings, "size"), false);
  assert.equal(registryVersion, input.registryVersion);
  assert.equal(executor.getContract(MODEL_ID, "generate-video", VARIANT_ID)?.schema_hash, registry.contracts[0]!.schema_hash);
  assert.deepEqual(registry.contracts[0]?.cost_parameter_bindings, BINDINGS);
  assert.notEqual(registry.contracts[0]?.schema_hash, makeRegistry(contract()).contracts[0]?.schema_hash);
  assert.notEqual(registry.registry_sha256, makeRegistry(contract()).registry_sha256);

  const { costParameters: _suppliedCosts, ...baseInput } = input;
  const fieldPolicy = createOwnerReviewedContractCallPolicy({ ...baseInput, costParameterFields: Object.keys(BINDINGS).reverse() });
  let fieldProjection: Readonly<Record<string, string | number | boolean>> | undefined;
  await prepareOwnerReviewedContractCall(fieldPolicy, ATTEMPT_ID,
    async () => ({ active: true, plan_type: "OwnerTest", end_date: null, end_date_kind: null }),
    async (_attemptId, _modelId, costParameters) => {
      fieldProjection = costParameters;
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: registry.catalog_version,
        model_id: MODEL_ID, ai_name: "seedance", model_type: MODEL_ID,
        account_read_live: true, parameter_keys: Object.keys(costParameters).sort(), parameters_redacted: true,
        access: true, cost: null, discount_cost: null, free_remaining_generations: null, limit: null,
        show_warning: null, observed_at: "2026-10-14T00:00:00.000Z"
      };
    });
  assert.deepEqual(fieldProjection === undefined ? undefined : { ...fieldProjection }, COSTS);
});

test("a supplied cost projection must match every reviewed binding exactly", () => {
  const contractWithBindings = { ...contract(), cost_parameter_bindings: BINDINGS } as GenerationContractV2Input;
  for (const costParameters of [
    { ...COSTS, duration: 1 },
    { duration: 0 },
    { ...COSTS, arbitrary: 0 }
  ]) {
    const { input } = policyInput(contractWithBindings, costParameters);
    assert.throws(() => createOwnerReviewedContractCallPolicy(input), { code: "PROBE_CONTRACT_NOT_REVIEWED" });
  }
});

test("mutated registry data and an executor with a foreign binding cannot mint the reviewed policy", () => {
  const contractWithBindings = { ...contract(), cost_parameter_bindings: BINDINGS } as GenerationContractV2Input;
  const normal = policyInput(contractWithBindings);
  const mutatedRegistry = structuredClone(normal.registry) as unknown as {
    contracts: Array<{ cost_parameter_bindings: Record<string, { kind: string; value?: number }> }>;
  };
  mutatedRegistry.contracts[0]!.cost_parameter_bindings.duration = { kind: "literal", value: 1 };
  assert.throws(() => createOwnerReviewedContractCallPolicy({ ...normal.input, registry: mutatedRegistry as never }));

  const foreignBindings = { ...BINDINGS, size: { kind: "parameter", parameter: "resolution" } } as const;
  const foreignExecutor = makeExecutor({ ...contract(), cost_parameter_bindings: foreignBindings } as GenerationContractV2Input).executor;
  assert.throws(() => createOwnerReviewedContractCallPolicy({ ...normal.input, executor: foreignExecutor }),
    { code: "PROBE_CONTRACT_NOT_REVIEWED" });
});

test("cost bindings reject unknown, non-scalar, reserved, and unbounded declarations", () => {
  const invalid = [
    { unknown: { kind: "parameter", parameter: "unknown" } },
    { media: { kind: "parameter", parameter: "frames" } },
    { ai_name: { kind: "literal", value: "spoof" } },
    JSON.parse('{"__proto__":{"kind":"literal","value":1}}') as Record<string, unknown>,
    { constructor: { kind: "literal", value: 1 } },
    Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`cost${index}`, { kind: "literal", value: 1 }]))
  ];
  for (const cost_parameter_bindings of invalid) {
    assert.throws(() => makeRegistry({ ...contract(), cost_parameter_bindings } as GenerationContractV2Input));
  }
  assert.throws(() => makeRegistry({ ...contract(), cost_parameter_bindings: {
    duration: { kind: "literal", value: Number.POSITIVE_INFINITY }
  } } as GenerationContractV2Input));
});
