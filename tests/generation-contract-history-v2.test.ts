import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  archiveGenerationContractRegistry,
  listGenerationContractVersions,
} from "../src/catalog/generation-contract-history.js";
import {
  createGenerationContractRegistry,
  type GenerationContractRegistryInput as GenerationContractRegistryV1Input
} from "../src/domain/generation-contract.js";
import {
  createGenerationContractRegistryV2,
  serializeGenerationContractRegistryV2,
  type GenerationContractRegistryV2Input
} from "../src/domain/generation-contract-v2.js";

const SOURCE_SHA = `sha256:${"a".repeat(64)}`;
const SETTINGS_SHA = `sha256:${"b".repeat(64)}`;
const CATALOG_DIRECTORY = resolve("catalog");
const HISTORICAL_V1_VERSION = "sha256-78c65766ddf4149de0f63dc730d86b1dc0d45ec7adef9da0bf38b89095e47216.json";
const CURRENT_V2_VERSION = "sha256-e3a109c3b52f4e1a46b37d5a6f54f311f7f12f99b36da667f85258d928dabffe.json";

interface GenerationContractHistoryV2Api {
  archiveGenerationContractRegistryV2(registry: ReturnType<typeof createGenerationContractRegistryV2>, catalogDirectory?: string): Promise<{ version: string; path: string; status: "created" | "existing" }>;
  loadGenerationContractRegistryV2(version: string, catalogDirectory?: string): ReturnType<typeof createGenerationContractRegistryV2>;
  listGenerationContractRegistryV2(catalogDirectory?: string): string[];
  loadGenerationContractRegistryBySchemaVersion(schemaVersion: string, version: string, catalogDirectory?: string): unknown;
  loadSelectedGenerationContractRegistry(version: string, schemaVersion: string, catalogDirectory?: string): unknown;
}

async function historyV2(): Promise<GenerationContractHistoryV2Api> {
  const url = new URL("../src/catalog/generation-contract-history-v2.js", import.meta.url);
  return await import(url.href) as GenerationContractHistoryV2Api;
}

function fixtureV2Input(): GenerationContractRegistryV2Input {
  return {
    schema_version: "2.0.0",
    catalog_version: "2026-10-09T00:00:00.000Z.aaaaaaaaaaaa",
    source_hashes: { ai: SOURCE_SHA, llm_models: SOURCE_SHA, models: SOURCE_SHA },
    contracts: [{
      variant_id: "fixture-prompt-only-v1",
      model_id: "fixture-image-a",
      operation_id: "generate-image",
      modality: "image",
      route: "design",
      ai_name: "provider-a",
      model_type: "fixture-image-a",
      status: "static_partial",
      provenance: {
        settings_source_sha256: SETTINGS_SHA,
        references: [
          { kind: "public_catalog", reference: "fixture-model", sha256: SOURCE_SHA },
          { kind: "frontend_static", reference: "fixture-form", sha256: SETTINGS_SHA }
        ]
      },
      parameters: {
        type: "object",
        additional_properties: false,
        required: ["prompt"],
        properties: { prompt: { type: "string", min_length: 1 } },
        conditions: [],
        conditional_enums: []
      },
      wire: {
        dispatch_action: "generate-image",
        input_kind: "prompt",
        prompt_field: "prompt",
        settings_fields: {},
        fixed_settings: {},
        media_reference_fields: {}
      },
      output: { decoder_profile: "fixture-image-v2", mime_types: ["image/jpeg"] },
      limits: { max_parameters: 4, max_value_depth: 4, max_serialized_bytes: 4096, max_normalized_nodes: 256 }
    }]
  };
}

function fixtureV1Input(): GenerationContractRegistryV1Input {
  return {
    schema_version: "1.0.0",
    catalog_version: "2026-10-09T00:00:00.000Z.aaaaaaaaaaaa",
    source_hashes: { ai: SOURCE_SHA, llm_models: SOURCE_SHA, models: SOURCE_SHA },
    contracts: [{
      model_id: "fixture-v1-image",
      operation_id: "generate-image",
      modality: "image",
      route: "design",
      ai_name: "provider-a",
      model_type: "fixture-v1-image",
      status: "discovered",
      provenance: {
        settings_source_sha256: null,
        references: [{ kind: "public_catalog", reference: "v1-fixture-model", sha256: SOURCE_SHA }]
      },
      parameters: {
        type: "object", additional_properties: false, required: ["prompt"],
        properties: { prompt: { type: "string", min_length: 1 } }, conditions: []
      },
      wire: { prompt_field: "prompt", settings_fields: {}, fixed_settings: {} },
      output: { decoder_profile: "fixture-v1-image", mime_types: ["image/jpeg"] },
      limits: { max_parameters: 2, max_value_depth: 2, max_serialized_bytes: 2048 }
    }]
  };
}

const sha256 = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("v2 history is create-once, hash-addressed, isolated from v1, and selectable by trusted schema version", async (t) => {
  const api = await historyV2();
  const catalogDirectory = await mkdtemp(join(tmpdir(), "syntx-contract-history-v2-"));
  t.after(async () => rm(catalogDirectory, { recursive: true, force: true }));
  const v1 = createGenerationContractRegistry(fixtureV1Input());
  const v1Archived = await archiveGenerationContractRegistry(v1, catalogDirectory);
  const v2 = createGenerationContractRegistryV2(fixtureV2Input());

  const first = await api.archiveGenerationContractRegistryV2(v2, catalogDirectory);
  const second = await api.archiveGenerationContractRegistryV2(v2, catalogDirectory);
  assert.equal(first.status, "created");
  assert.equal(second.status, "existing");
  assert.match(first.version, /^sha256-[a-f0-9]{64}\.json$/u);
  const archivedBytes = await readFile(first.path);
  assert.equal(first.version, `sha256-${createHash("sha256").update(archivedBytes).digest("hex")}.json`);
  assert.deepEqual(api.loadGenerationContractRegistryV2(first.version, catalogDirectory), v2);
  assert.deepEqual(api.listGenerationContractRegistryV2(catalogDirectory), [first.version]);
  assert.deepEqual(listGenerationContractVersions(catalogDirectory), [v1Archived.version]);
  assert.deepEqual(api.loadGenerationContractRegistryBySchemaVersion("1.0.0", v1Archived.version, catalogDirectory), v1);
  assert.deepEqual(api.loadGenerationContractRegistryBySchemaVersion("2.0.0", first.version, catalogDirectory), v2);
  assert.deepEqual(api.loadSelectedGenerationContractRegistry(v1Archived.version, "1.0.0", catalogDirectory), v1);
  assert.deepEqual(api.loadSelectedGenerationContractRegistry(first.version, "2.0.0", catalogDirectory), v2);
  assert.throws(() => api.loadGenerationContractRegistryBySchemaVersion("latest", first.version, catalogDirectory), /SCHEMA_VERSION_UNSUPPORTED/u);
  assert.deepEqual((await readdir(join(catalogDirectory, "generation-contracts-v2"))).sort(), [first.version]);
});

test("v2 load verifies exact bytes before decoding and rejects invalid versions and symlinks", async (t) => {
  const api = await historyV2();
  const catalogDirectory = await mkdtemp(join(tmpdir(), "syntx-contract-v2-integrity-"));
  t.after(async () => rm(catalogDirectory, { recursive: true, force: true }));
  const v2Directory = join(catalogDirectory, "generation-contracts-v2");
  await mkdir(v2Directory, { recursive: true });
  assert.throws(() => api.loadGenerationContractRegistryV2("latest", catalogDirectory), /VERSION_INVALID/u);

  const malformed = Buffer.from([0x7b, 0xff, 0x7d]);
  const badVersion = `sha256-${"0".repeat(64)}.json`;
  await writeFile(join(v2Directory, badVersion), malformed);
  assert.throws(() => api.loadGenerationContractRegistryV2(badVersion, catalogDirectory), /HASH_MISMATCH/u);

  const serialized = serializeGenerationContractRegistryV2(createGenerationContractRegistryV2(fixtureV2Input()));
  const validBytes = Buffer.from(serialized, "utf8");
  const validVersion = `sha256-${createHash("sha256").update(validBytes).digest("hex")}.json`;
  const externalPath = join(catalogDirectory, "outside.json");
  await writeFile(externalPath, validBytes);
  await symlink(externalPath, join(v2Directory, validVersion));
  assert.throws(() => api.loadGenerationContractRegistryV2(validVersion, catalogDirectory), /FILE_UNSAFE/u);

  const linkedCatalogDirectory = join(catalogDirectory, "catalog-link");
  await symlink(catalogDirectory, linkedCatalogDirectory, "dir");
  assert.throws(() => api.listGenerationContractRegistryV2(linkedCatalogDirectory), /DIRECTORY_UNSAFE/u);

  const oversizedVersion = `sha256-${"1".repeat(64)}.json`;
  const oversizedPath = join(v2Directory, oversizedVersion);
  const oversized = await open(oversizedPath, "w");
  try { await oversized.truncate(16 * 1024 * 1024 + 1); }
  finally { await oversized.close(); }
  assert.throws(() => api.loadGenerationContractRegistryV2(oversizedVersion, catalogDirectory), /SIZE_INVALID/u);
});

test("current v2 archive contains only the two exact owner media tuples and preserves v1 history", async () => {
  const api = await historyV2();
  const current = api.loadGenerationContractRegistryV2(CURRENT_V2_VERSION, CATALOG_DIRECTORY);
  assert.equal(current.schema_version, "2.0.0");
  assert.deepEqual(current.contracts.map((contract) => contract.model_id), ["banana-2.1", "seedance_pro-fast"]);
  assert.deepEqual(current.contracts.map((contract) => contract.variant_id), [
    "banana21-image-1k-minimal-square",
    "seedance-pro-fast-video-720p-mini-16x9-5s-audio"
  ]);
  assert.ok(current.contracts.every((contract) => contract.status === "live_verified"));
  assert.deepEqual(current.contracts[0]?.wire.fixed_settings, {
    aspect_ratio: "1:1", image_size: "1K", n: 1, thinking_level: "minimal"
  });
  assert.deepEqual(current.contracts[0]?.wire.settings_fields, { file_urls: "file_urls" });
  assert.deepEqual(current.contracts[0]?.output.mime_types, ["image/jpeg"]);
  assert.deepEqual(current.contracts[1]?.wire.fixed_settings, {
    aspect_ratio: "16:9", generate_audio: true, mode: "mini", resolution: "720p", video_duration: 5
  });
  assert.deepEqual(current.contracts[1]?.output.mime_types, ["video/mp4"]);
  assert.ok(api.listGenerationContractRegistryV2(CATALOG_DIRECTORY).includes(CURRENT_V2_VERSION));
  assert.ok(listGenerationContractVersions(CATALOG_DIRECTORY).includes(HISTORICAL_V1_VERSION));
  assert.ok(listGenerationContractVersions(CATALOG_DIRECTORY).includes("sha256-0a82b91685746f4aeec1b0ba4e24fccdc21532d4e3feac85969e55302b463d45.json"));
  assert.equal(sha256(await readFile(join(CATALOG_DIRECTORY, "generation-contracts", HISTORICAL_V1_VERSION))),
    "sha256:78c65766ddf4149de0f63dc730d86b1dc0d45ec7adef9da0bf38b89095e47216");
});

test("v2 history rejects duplicate model-operation variant IDs before publication", async (t) => {
  const catalogDirectory = await mkdtemp(join(tmpdir(), "syntx-contract-v2-duplicate-"));
  t.after(async () => rm(catalogDirectory, { recursive: true, force: true }));
  const input = fixtureV2Input();
  input.contracts.push({ ...input.contracts[0]!, status: "discovered" });
  assert.throws(() => createGenerationContractRegistryV2(input), /duplicate|variant/iu);
  await assert.rejects(readdir(join(catalogDirectory, "generation-contracts-v2")), /ENOENT/u);
});
