import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  createGenerationContractRegistry,
  type GenerationContractRegistryInput
} from "../src/domain/generation-contract.js";
import {
  archiveGenerationContractRegistry,
  loadGenerationContractRegistry,
  listGenerationContractVersions
} from "../src/catalog/generation-contract-history.js";
import {
  GenerationContractValidationError,
  validateGenerationParameters
} from "../src/application/generation-contract-validator.js";
import {
  GenerationContractExecutor,
  type GenerationContractCatalogPort
} from "../src/adapter/syntx/generation-contract-executor.js";

const SOURCE_HASH = `sha256:${"a".repeat(64)}`;
const SETTINGS_HASH = `sha256:${"b".repeat(64)}`;
const GENERATION_CONTRACT_CATALOG_DIRECTORY = resolve("catalog");
const GENERATION_CONTRACT_PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const HISTORICAL_BANANA_REGISTRY_VERSION = "sha256-78c65766ddf4149de0f63dc730d86b1dc0d45ec7adef9da0bf38b89095e47216.json";
const CURRENT_OWNER_MEDIA_REGISTRY_VERSION = "sha256-0a82b91685746f4aeec1b0ba4e24fccdc21532d4e3feac85969e55302b463d45.json";

function registryInput(): GenerationContractRegistryInput {
  return {
    schema_version: "1.0.0",
    catalog_version: "2026-10-08T00:00:00.000Z.aaaaaaaaaaaa",
    source_hashes: {
      ai: SOURCE_HASH,
      llm_models: SOURCE_HASH,
      models: SOURCE_HASH
    },
    contracts: [{
      model_id: "image-model-a",
      operation_id: "generate-image",
      modality: "image",
      route: "design",
      ai_name: "provider-a",
      model_type: "image-model-a",
      status: "reviewed",
      provenance: {
        settings_source_sha256: SETTINGS_HASH,
        references: [
          { kind: "public_catalog", reference: "test-catalog-model", sha256: SOURCE_HASH },
          { kind: "frontend_static", reference: "test-settings-source", sha256: SETTINGS_HASH },
          { kind: "manual_review", reference: "test-fixture" }
        ],
        reviewed_at: "2026-10-08T00:00:00.000Z"
      },
      parameters: {
        type: "object",
        additional_properties: false,
        required: ["prompt", "mode"],
        properties: {
          prompt: { type: "string", min_length: 1, max_length: 100 },
          mode: { type: "string", enum: ["basic", "advanced"] },
          advanced_prompt: { type: "string", min_length: 1, max_length: 80 },
          quality: { type: "integer", minimum: 1, maximum: 4, default: 2 },
          enabled: { type: "boolean", default: false },
          tags: { type: "array", items: { type: "string", enum: ["reference", "style"] }, min_items: 0, max_items: 2, default: [] }
        },
        conditions: [{ when: { field: "mode", equals: "advanced" }, require: ["advanced_prompt"] }]
      },
      wire: {
        prompt_field: "prompt",
        settings_fields: { mode: "mode", quality: "quality", advanced_prompt: "advanced_prompt", enabled: "enabled", tags: "tags" },
        fixed_settings: { stream: false }
      },
      output: { decoder_profile: "image-model-a-v1", mime_types: ["image/png"] },
      limits: { max_parameters: 16, max_value_depth: 4, max_serialized_bytes: 4096 }
    }]
  };
}

function makeExecutor(overrides: Partial<{ ai_name: string; upstream_id: string; active: boolean; source_hashes: { ai: string; llm_models: string; models: string } }> = {}) {
  const registry = createGenerationContractRegistry(registryInput());
  const model = {
    id: "image-model-a",
    upstream_id: overrides.upstream_id ?? "image-model-a",
    ai_name: overrides.ai_name ?? "provider-a",
    display_name: "Image A",
    description: null,
    active: overrides.active ?? true,
    default: false,
    type: "image",
    scope: "image",
    modalities: ["image" as const],
    operations: [{ id: "generate-image" as const, display_name: "Generate image", output_modality: "image" as const, derivation: "PUBLIC_AI_SCOPE" as const }],
    features: { files_generation: false, files_processing: false, image_generation: true, image_processing: false, search: false },
    settings: null,
    llm_enrichment: null,
    catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT" as const,
    runtime_usable: false as const,
    fetched_at: "2026-10-08T00:00:00.000Z",
    source_hashes: overrides.source_hashes ?? registry.source_hashes
  };
  const catalog: GenerationContractCatalogPort = {
    getModel(id) {
      if (id !== model.id) throw new Error("MODEL_NOT_FOUND");
      return structuredClone(model);
    }
  };
  return new GenerationContractExecutor(registry, catalog);
}

test("validator applies explicit defaults and rejects unknown, invalid, and over-limit values", () => {
  const contract = createGenerationContractRegistry(registryInput()).contracts[0]!;
  assert.deepEqual(validateGenerationParameters(contract, { prompt: "hello", mode: "basic" }), {
    prompt: "hello", mode: "basic", quality: 2, enabled: false, tags: []
  });
  for (const params of [
    { prompt: "hello", mode: "basic", surprise: true },
    { prompt: "hello", mode: "other" },
    { prompt: "hello", mode: "basic", quality: 5 },
    { prompt: "hello", mode: "basic", enabled: "false" },
    { prompt: "hello", mode: "basic", tags: ["unsupported"] },
    { prompt: "", mode: "basic" },
    { prompt: "x".repeat(101), mode: "basic" }
  ]) {
    assert.throws(() => validateGenerationParameters(contract, params), GenerationContractValidationError);
  }
});

test("optional Banana 2.1 registry record prepares only its exact observed settings tuple", () => {
  const versions = listGenerationContractVersions(GENERATION_CONTRACT_CATALOG_DIRECTORY);
  assert.ok(versions.includes(HISTORICAL_BANANA_REGISTRY_VERSION), "the historical UI-observation registry remains available");
  assert.ok(versions.includes(CURRENT_OWNER_MEDIA_REGISTRY_VERSION), "the new owner-MCP registry is additive");
  const registry = loadGenerationContractRegistry(HISTORICAL_BANANA_REGISTRY_VERSION, GENERATION_CONTRACT_CATALOG_DIRECTORY);
  assert.equal(registry.catalog_version, "2026-10-08T13:18:39.393Z.36e6960df354");
  const contract = registry.contracts.find((candidate) => candidate.model_id === "banana-2.1");
  assert.ok(contract);
  assert.equal(contract.status, "live_verified");
  assert.equal(contract.ai_name, "banana");
  assert.equal(contract.model_type, "banana-2.1");
  assert.equal(contract.provenance.references.find((reference) => reference.kind === "live_owner")?.sha256,
    "sha256:0790f114bfd89eb033132d7b7c8c68a82590a55ef91fa6e07f5f49d90310d4bf");
  assert.deepEqual(contract.parameters.properties.file_urls, {
    type: "array", items: { type: "string" }, min_items: 0, max_items: 0, default: []
  });

  const publicSnapshot = loadPublicCatalogVersion(GENERATION_CONTRACT_PUBLIC_VERSION, GENERATION_CONTRACT_CATALOG_DIRECTORY);
  const catalog = new DiscoveryCatalogRepository(publicSnapshot);
  const resolved = catalog.getModel("banana-2.1");
  assert.equal(resolved.ai_name, "banana");
  const executor = new GenerationContractExecutor(registry, catalog);
  const prepared = executor.prepare({
    model_id: "banana-2.1",
    operation_id: "generate-image",
    catalog_version: registry.catalog_version,
    parameters: { prompt: "profile-bound fixture", file_urls: [] }
  });
  assert.equal(prepared.ai_name, "banana");
  assert.equal(prepared.prompt, "profile-bound fixture");
  assert.deepEqual(prepared.settings, {
    n: 1,
    aspect_ratio: "1:1",
    image_size: "1K",
    thinking_level: "minimal",
    file_urls: [],
    model_type: "banana-2.1"
  });
});

test("validator enforces conditional requirements after normalization", () => {
  const contract = createGenerationContractRegistry(registryInput()).contracts[0]!;
  assert.throws(
    () => validateGenerationParameters(contract, { prompt: "hello", mode: "advanced" }),
    (error: unknown) => error instanceof GenerationContractValidationError && error.code === "CONDITION_FAILED"
  );
  assert.deepEqual(
    validateGenerationParameters(contract, { prompt: "hello", mode: "advanced", quality: 3, advanced_prompt: "detail" }),
    { prompt: "hello", mode: "advanced", quality: 3, advanced_prompt: "detail", enabled: false, tags: [] }
  );
});

test("validator enforces field-count and serialized-byte limits", () => {
  const input = registryInput();
  input.contracts[0]!.limits.max_parameters = 1;
  const limitedFields = createGenerationContractRegistry(input).contracts[0]!;
  assert.throws(
    () => validateGenerationParameters(limitedFields, { prompt: "hello", mode: "basic" }),
    (error: unknown) => error instanceof GenerationContractValidationError && error.code === "INPUT_LIMIT_EXCEEDED"
  );
  input.contracts[0]!.limits.max_parameters = 16;
  input.contracts[0]!.limits.max_serialized_bytes = 128;
  const limitedBytes = createGenerationContractRegistry(input).contracts[0]!;
  assert.throws(
    () => validateGenerationParameters(limitedBytes, { prompt: "hello", mode: "basic", advanced_prompt: "x".repeat(80) }),
    (error: unknown) => error instanceof GenerationContractValidationError && error.code === "INPUT_LIMIT_EXCEEDED"
  );
});

test("validator accepts a declared array of 256 values", () => {
  const input = registryInput();
  const tags = input.contracts[0]!.parameters.properties.tags;
  if (!tags || tags.type !== "array") throw new Error("TEST_FIXTURE_INVALID");
  tags.max_items = 256;
  const contract = createGenerationContractRegistry(input).contracts[0]!;
  const normalized = validateGenerationParameters(contract, {
    prompt: "hello", mode: "basic", tags: Array.from({ length: 256 }, () => "style")
  });
  assert.equal((normalized.tags as string[]).length, 256);
});

test("validator counts explicit defaults toward max_parameters", () => {
  const input = registryInput();
  input.contracts[0]!.limits.max_parameters = 4;
  const contract = createGenerationContractRegistry(input).contracts[0]!;
  assert.throws(
    () => validateGenerationParameters(contract, { prompt: "hello", mode: "basic" }),
    (error: unknown) => error instanceof GenerationContractValidationError && error.code === "INPUT_LIMIT_EXCEEDED"
  );
});

test("validator enforces serialized byte limits after applying defaults", () => {
  const input = registryInput();
  input.contracts[0]!.limits.max_serialized_bytes = 128;
  input.contracts[0]!.parameters.properties.payload = {
    type: "string", max_length: 200, default: "x".repeat(150)
  };
  input.contracts[0]!.wire.settings_fields.payload = "payload";
  const contract = createGenerationContractRegistry(input).contracts[0]!;
  assert.throws(
    () => validateGenerationParameters(contract, { prompt: "hello", mode: "basic" }),
    (error: unknown) => error instanceof GenerationContractValidationError && error.code === "INPUT_LIMIT_EXCEEDED"
  );
});

test("executor binds exact catalog identity and creates transport-owned settings", () => {
  const executor = makeExecutor();
  const prepared = executor.prepare({
    model_id: "image-model-a",
    operation_id: "generate-image",
    catalog_version: "2026-10-08T00:00:00.000Z.aaaaaaaaaaaa",
    parameters: { prompt: "hello", mode: "basic" }
  });
  assert.deepEqual(prepared, {
    prompt: "hello",
    settings: { mode: "basic", quality: 2, enabled: false, tags: [], stream: false, model_type: "image-model-a" },
    ai_name: "provider-a",
    modality: "image",
    schema_hash: prepared.schema_hash
  });
  assert.match(prepared.schema_hash, /^sha256:[a-f0-9]{64}$/u);
  let getterRead = false;
  const accessorRequest = {
    model_id: "image-model-a",
    operation_id: "generate-image",
    catalog_version: "2026-10-08T00:00:00.000Z.aaaaaaaaaaaa",
    get parameters() { getterRead = true; return { prompt: "hello", mode: "basic" }; }
  };
  assert.throws(() => executor.prepare(accessorRequest as Parameters<typeof executor.prepare>[0]));
  assert.equal(getterRead, false);
  assert.throws(() => executor.prepare({
    model_id: "image-model-a", operation_id: "generate-image",
    catalog_version: "different", parameters: { prompt: "hello", mode: "basic" }
  }));
  assert.throws(() => executor.prepare({
    model_id: "image-model-a", operation_id: "generate-video",
    catalog_version: "2026-10-08T00:00:00.000Z.aaaaaaaaaaaa", parameters: { prompt: "hello", mode: "basic" }
  }));
  for (const mismatched of [
    makeExecutor({ ai_name: "other-provider" }),
    makeExecutor({ upstream_id: "other-model-type" }),
    makeExecutor({ active: false }),
    makeExecutor({ source_hashes: { ai: SOURCE_HASH, llm_models: SETTINGS_HASH, models: SOURCE_HASH } })
  ]) {
    assert.throws(() => mismatched.prepare({
      model_id: "image-model-a", operation_id: "generate-image",
      catalog_version: "2026-10-08T00:00:00.000Z.aaaaaaaaaaaa", parameters: { prompt: "hello", mode: "basic" }
    }));
  }
  const unreviewed = registryInput();
  unreviewed.contracts[0]!.status = "static_partial";
  const unreviewedRegistry = createGenerationContractRegistry(unreviewed);
  const unreviewedExecutor = new GenerationContractExecutor(unreviewedRegistry, {
    getModel: () => ({
      id: "image-model-a", upstream_id: "image-model-a", ai_name: "provider-a", active: true,
      operations: [{ id: "generate-image", output_modality: "image" }],
      fetched_at: "2026-10-08T00:00:00.000Z", source_hashes: unreviewedRegistry.source_hashes
    })
  });
  assert.throws(
    () => unreviewedExecutor.prepare({
      model_id: "image-model-a", operation_id: "generate-image",
      catalog_version: unreviewedRegistry.catalog_version, parameters: { prompt: "hello", mode: "basic" }
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "GENERATION_CONTRACT_NOT_REVIEWED"
  );
});

test("executor lookup exposes only explicit registry entries", () => {
  const executor = makeExecutor();
  const contract = executor.getContract("image-model-a", "generate-image");
  assert.equal(contract?.status, "reviewed");
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract?.parameters), true);
  assert.equal(executor.getContract("unknown-model", "generate-image"), null);
  assert.equal(executor.getContract("image-model-a", "generate-video"), null);
  assert.equal(executor.listContracts().length, 1);
});

test("registry rejects invented live status without live evidence", () => {
  const candidate = registryInput();
  candidate.contracts[0]!.status = "live_verified";
  assert.throws(() => createGenerationContractRegistry(candidate));
});

test("registry rejects schema keywords incompatible with field type", () => {
  const stringMinimum = registryInput();
  stringMinimum.contracts[0]!.parameters.properties.mode = {
    type: "string", enum: ["basic", "advanced"], minimum: 0
  };
  assert.throws(() => createGenerationContractRegistry(stringMinimum));

  const booleanLength = registryInput();
  booleanLength.contracts[0]!.parameters.properties.enabled = {
    type: "boolean", default: false, max_length: 3
  };
  assert.throws(() => createGenerationContractRegistry(booleanLength));
});

test("contract history archives create-once and revalidates bytes and bindings", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-generation-contract-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const registry = createGenerationContractRegistry(registryInput());
  const archived = await archiveGenerationContractRegistry(registry, directory);
  assert.equal(archived.status, "created");
  assert.equal((await archiveGenerationContractRegistry(registry, directory)).status, "existing");
  assert.deepEqual(loadGenerationContractRegistry(archived.version, directory), registry);
  const bytes = await readFile(archived.path, "utf8");
  assert.match(bytes, /image-model-a/u);
  assert.deepEqual(listGenerationContractVersions(directory), [archived.version]);
  await writeFile(archived.path, bytes.replace("image-model-a", "image-model-b"));
  assert.throws(() => loadGenerationContractRegistry(archived.version, directory), /HASH_MISMATCH/u);
});
