import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationContractCatalogModel, GenerationContractCatalogPort } from "../src/adapter/syntx/generation-contract-executor.js";
import { GenerationContractExecutorV2, GenerationContractExecutionErrorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import { createReviewedContractPreflight } from "../src/application/reviewed-contract-preflight.js";
import { createGenerationContractRegistryV2, type GenerationContractRegistryV2Input, type GenerationContractV2Input } from "../src/domain/generation-contract-v2.js";

const AI_HASH = `sha256:${"a".repeat(64)}`;
const LLM_HASH = `sha256:${"b".repeat(64)}`;
const MODEL_HASH = `sha256:${"c".repeat(64)}`;
const SETTINGS_HASH = `sha256:${"d".repeat(64)}`;
const CATALOG_VERSION = `2026-10-09T00:00:00.000Z.${MODEL_HASH.slice(7, 19)}`;
const SOURCE_HASHES = { ai: AI_HASH, llm_models: LLM_HASH, models: MODEL_HASH };

function variant(variantId: string, quality: string, defaultMode = "automatic"): GenerationContractV2Input {
  return {
    variant_id: variantId,
    model_id: "image-model-a",
    operation_id: "generate-image",
    modality: "image",
    route: "design",
    ai_name: "provider-a",
    model_type: "upstream-image-a",
    status: "live_verified",
    provenance: {
      settings_source_sha256: SETTINGS_HASH,
      references: [
        { kind: "public_catalog", reference: "exact-model", sha256: MODEL_HASH },
        { kind: "frontend_static", reference: "exact-form", sha256: SETTINGS_HASH },
        { kind: "manual_review", reference: "owner-reviewed-exact-payload" },
        { kind: "live_owner", reference: "observed-exact-payload", sha256: SETTINGS_HASH }
      ],
      reviewed_at: "2026-10-09T00:00:00.000Z",
      live_observed_at: "2026-10-09T00:00:00.000Z"
    },
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt", "quality"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 200 },
        quality: { type: "string", enum: [quality], default: quality },
        mode: { type: "string", enum: ["automatic", "manual"], default: defaultMode },
        details: {
          type: "object",
          additional_properties: false,
          required: ["strength"],
          properties: {
            strength: { type: "number", minimum: 0, maximum: 1, step: 0.1, default: 0.5 },
            crop: { type: "string", nullable: true, enum: [null, "square"], default: null }
          },
          default: {}
        }
      },
      conditions: [{ when: { field: "mode", equals: "manual" }, require: ["quality"] }],
      conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image",
      input_kind: "prompt",
      prompt_field: "prompt",
      settings_fields: { quality: "render_quality", mode: "mode", details: "options" },
      fixed_settings: { copies: 1 },
      media_reference_fields: {}
    },
    output: { decoder_profile: "image-jpeg", mime_types: ["image/jpeg"] },
    limits: { max_parameters: 16, max_value_depth: 5, max_serialized_bytes: 4096, max_normalized_nodes: 256 }
  };
}

function makeRegistry(contracts = [variant("low", "1K"), variant("high", "2K")]) {
  const input: GenerationContractRegistryV2Input = {
    schema_version: "2.0.0",
    catalog_version: CATALOG_VERSION,
    source_hashes: SOURCE_HASHES,
    contracts
  };
  return createGenerationContractRegistryV2(input);
}

function makeCatalog(overrides: Partial<GenerationContractCatalogModel> = {}) {
  const model: GenerationContractCatalogModel = {
    id: "image-model-a",
    upstream_id: "upstream-image-a",
    ai_name: "provider-a",
    active: true,
    operations: [{ id: "generate-image", output_modality: "image" }],
    fetched_at: "2026-10-09T00:00:00.000Z",
    source_hashes: SOURCE_HASHES,
    ...overrides
  };
  let reads = 0;
  const catalog: GenerationContractCatalogPort = {
    getModel(modelId) {
      reads += 1;
      if (modelId !== model.id) throw new Error("MODEL_NOT_FOUND");
      return structuredClone(model);
    }
  };
  return { catalog, getReads: () => reads };
}

function executionError(code: string) {
  return (error: unknown): error is GenerationContractExecutionErrorV2 =>
    error instanceof GenerationContractExecutionErrorV2 && error.code === code;
}

test("v2 executor requires an explicit variant when an exact model operation has multiple contracts", () => {
  const fixture = makeCatalog();
  const executor = new GenerationContractExecutorV2(makeRegistry(), fixture.catalog);
  assert.deepEqual(executor.availableVariantIds("image-model-a", "generate-image"), ["high", "low"]);
  assert.throws(() => executor.prepare({
    model_id: "image-model-a", operation_id: "generate-image", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "hello" }
  }), executionError("GENERATION_CONTRACT_VARIANT_AMBIGUOUS"));
  assert.throws(() => executor.prepare({
    model_id: "image-model-a", operation_id: "generate-image", variant_id: "not-a-variant", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "hello" }
  }), executionError("GENERATION_CONTRACT_VARIANT_NOT_FOUND"));
  assert.equal(fixture.getReads(), 0, "variant ambiguity is rejected before catalog lookup");
});

test("v2 prepare maps parameter fields to exact wire keys and keeps action, operation, and selected variant metadata", () => {
  const fixture = makeCatalog();
  const executor = new GenerationContractExecutorV2(makeRegistry(), fixture.catalog);
  const prepared = executor.prepare({
    model_id: "image-model-a", operation_id: "generate-image", variant_id: "low", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "hello", details: { strength: 0.7 } }
  });
  assert.equal(prepared.prompt, "hello");
  assert.equal(prepared.settings.model_type, "upstream-image-a");
  assert.equal(prepared.settings.render_quality, "1K");
  assert.equal(prepared.settings.options && typeof prepared.settings.options, "object");
  assert.deepEqual(prepared.settings.options, { strength: 0.7, crop: null });
  assert.equal(Object.hasOwn(prepared.settings, "quality"), false);
  assert.deepEqual(prepared.contract_metadata, {
    schema_version: "2.0.0",
    operation_id: "generate-image",
    dispatch_action: "generate-image",
    variant_id: "low"
  });
  assert.equal(fixture.getReads(), 1);
});

test("a single variant may omit variant_id but stale or inactive catalog bindings fail closed", () => {
  const single = new GenerationContractExecutorV2(makeRegistry([variant("only", "1K")]), makeCatalog().catalog);
  assert.equal(single.prepare({
    model_id: "image-model-a", operation_id: "generate-image", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "hello" }
  }).contract_metadata.variant_id, "only");

  const inactive = new GenerationContractExecutorV2(makeRegistry([variant("only", "1K")]), makeCatalog({ active: false }).catalog);
  assert.throws(() => inactive.prepare({
    model_id: "image-model-a", operation_id: "generate-image", variant_id: "only", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "hello" }
  }), executionError("GENERATION_CONTRACT_IDENTITY_MISMATCH"));

  const stale = new GenerationContractExecutorV2(makeRegistry([variant("only", "1K")]), makeCatalog({ source_hashes: { ...SOURCE_HASHES, models: AI_HASH } }).catalog);
  assert.throws(() => stale.prepare({
    model_id: "image-model-a", operation_id: "generate-image", variant_id: "only", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "hello" }
  }), executionError("GENERATION_CONTRACT_IDENTITY_MISMATCH"));
});

test("v2 preparation rejects stale catalog, wrong AI/upstream/operation identity, and unsupported actions", () => {
  const baseRegistry = makeRegistry([variant("only", "1K")]);
  const baseRequest = {
    model_id: "image-model-a", operation_id: "generate-image", variant_id: "only", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "hello" }
  };
  const fixture = makeCatalog();
  const executor = new GenerationContractExecutorV2(baseRegistry, fixture.catalog);
  assert.throws(() => executor.prepare({ ...baseRequest, catalog_version: "stale-catalog" }), executionError("GENERATION_CONTRACT_CATALOG_MISMATCH"));
  assert.equal(fixture.getReads(), 0);
  assert.throws(() => new GenerationContractExecutorV2(baseRegistry, makeCatalog({ ai_name: "wrong-ai" }).catalog).prepare(baseRequest), executionError("GENERATION_CONTRACT_IDENTITY_MISMATCH"));
  assert.throws(() => new GenerationContractExecutorV2(baseRegistry, makeCatalog({ upstream_id: "wrong-upstream" }).catalog).prepare(baseRequest), executionError("GENERATION_CONTRACT_IDENTITY_MISMATCH"));
  assert.throws(() => new GenerationContractExecutorV2(baseRegistry, makeCatalog({ operations: [] }).catalog).prepare(baseRequest), executionError("GENERATION_CONTRACT_IDENTITY_MISMATCH"));

  const unsupported = variant("upscale", "1K");
  assert.throws(() => makeRegistry([{
    ...unsupported,
    operation_id: "upscale-image",
    status: "reviewed",
    wire: { ...unsupported.wire, dispatch_action: "upscale-image" }
  }]));
  const partialRegistry = makeRegistry([{
    ...unsupported,
    operation_id: "upscale-image",
    status: "static_partial",
    wire: { ...unsupported.wire, dispatch_action: "upscale-image" }
  }]);
  const unsupportedExecutor = new GenerationContractExecutorV2(partialRegistry, fixture.catalog);
  assert.throws(() => unsupportedExecutor.prepare({
    model_id: "image-model-a", operation_id: "upscale-image", variant_id: "upscale", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "hello", quality: "1K" }
  }), executionError("GENERATION_CONTRACT_NOT_REVIEWED"));
});

test("v2 preflight is pure local preparation with nested defaults, nullable values, and bounded parameters", () => {
  const executor = new GenerationContractExecutorV2(makeRegistry([variant("only", "1K")]), makeCatalog().catalog);
  const prepared = executor.prepare({
    model_id: "image-model-a", operation_id: "generate-image", variant_id: "only", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "hello", details: {} }
  });
  assert.deepEqual(prepared.settings.options, { strength: 0.5, crop: null });
  assert.throws(() => executor.prepare({
    model_id: "image-model-a", operation_id: "generate-image", variant_id: "only", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "x", details: { strength: 0.55 } }
  }), executionError("GENERATION_CONTRACT_VALIDATION_FAILED"));
  assert.throws(() => executor.prepare({
    model_id: "image-model-a", operation_id: "generate-image", variant_id: "only", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "x", surprise: true }
  }), executionError("GENERATION_CONTRACT_VALIDATION_FAILED"));
});

test("reviewed contract preflight preserves the selected v2 variant before subscription verification", async () => {
  const fixture = makeCatalog();
  const executor = new GenerationContractExecutorV2(makeRegistry(), fixture.catalog);
  const calls: string[] = [];
  const preflight = createReviewedContractPreflight({
    executor,
    resolveSubscription: async (attemptId) => {
      calls.push(attemptId);
      return { active: true, plan_type: "Elite", end_date: null, end_date_kind: null };
    }
  });
  const prepared = await preflight("link_exact_v2_attempt_0001", {
    model_id: "image-model-a", operation_id: "generate-image", variant_id: "high", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "private prompt", quality: "2K" }
  });
  assert.equal(prepared.contract_metadata.variant_id, "high");
  assert.deepEqual(calls, ["link_exact_v2_attempt_0001"]);
});
