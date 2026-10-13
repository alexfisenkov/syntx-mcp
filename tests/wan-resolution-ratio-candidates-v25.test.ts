import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadSelectedPublicCatalog } from "../src/catalog/public-catalog-history.js";
import {
  WAN_RESOLUTION_RATIO_V25_SHA256,
  WAN_RESOLUTION_RATIO_V25_VERSION,
  loadPinnedWanResolutionRatioCandidatesV25,
  parsePinnedWanResolutionRatioCandidatesV25Bytes,
  parseWanResolutionRatioCandidatesV25Document,
  makeWanResolutionRatioCandidateV25
} from "../src/catalog/wan-resolution-ratio-candidates-v25.js";
import {
  loadPinnedBananaConditionalSettingsV19,
  makeSourceDerivedParameterCandidate
} from "../src/catalog/banana-conditional-settings-v19.js";

const PINNED_PATH = resolve("catalog/runtime/v25", WAN_RESOLUTION_RATIO_V25_VERSION);
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";

function currentModel(id: string) {
  const snapshot = loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: resolve("catalog") }).snapshot;
  const catalog = new DiscoveryCatalogRepository(snapshot);
  const model = catalog.getModel(id);
  return { catalog, model: { ...model, catalog_version: `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}` } };
}

test("v25 WAN source artifact loads only by exact bytes and validates strict UTF-8/schema", () => {
  const bytes = readFileSync(PINNED_PATH);
  const loaded = loadPinnedWanResolutionRatioCandidatesV25(resolve("catalog"));
  assert.ok(loaded);
  assert.equal(bytes.byteLength, 4591);
  assert.equal(loaded.artifact_sha256, WAN_RESOLUTION_RATIO_V25_SHA256);
  assert.equal(parsePinnedWanResolutionRatioCandidatesV25Bytes(bytes).artifact_sha256, loaded.artifact_sha256);
  assert.equal(loaded.artifact.model_ids.length, 11);
  assert.deepEqual(loaded.artifact.target_fields, ["resolution", "aspect_ratio"]);
  assert.equal(loaded.artifact.runtime_usable, false);
  assert.equal(loaded.artifact.backend_acceptance, false);

  assert.throws(() => parsePinnedWanResolutionRatioCandidatesV25Bytes(Buffer.from("{}")), /SIZE_INVALID/u);
  const changedSameSize = Buffer.from(bytes);
  changedSameSize[0] = changedSameSize[0]! ^ 1;
  assert.throws(() => parsePinnedWanResolutionRatioCandidatesV25Bytes(changedSameSize), /HASH_MISMATCH/u);
  assert.throws(() => parseWanResolutionRatioCandidatesV25Document(Buffer.from([0xff])), /UTF8_INVALID/u);
  assert.throws(() => parseWanResolutionRatioCandidatesV25Document(Buffer.from("{}")));
});

test("pinned loader refuses symlink source replacement; document parser rejects extra facts and semantic drift", () => {
  const loaded = loadPinnedWanResolutionRatioCandidatesV25(resolve("catalog"));
  assert.ok(loaded);
  const root = mkdtempSync(join(tmpdir(), "syntx-wan-v25-"));
  try {
    const versionDirectory = join(root, "runtime", "v25");
    mkdirSync(versionDirectory, { recursive: true });
    symlinkSync(PINNED_PATH, join(versionDirectory, WAN_RESOLUTION_RATIO_V25_VERSION));
    assert.equal(loadPinnedWanResolutionRatioCandidatesV25(root), null);

    const extraField = { ...loaded.artifact, injected_fact: true };
    assert.throws(() => parseWanResolutionRatioCandidatesV25Document(Buffer.from(JSON.stringify(extraField), "utf8")));

    const changedOrder = structuredClone(loaded.artifact);
    changedOrder.controls[0].model_options[0]!.values.reverse();
    assert.throws(() => parseWanResolutionRatioCandidatesV25Document(Buffer.from(JSON.stringify(changedOrder), "utf8")), /BINDING_INVALID/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("v25 candidates expose per-model resolution and 3/5 conditional ratios without defaults or requiredness", () => {
  const loaded = loadPinnedWanResolutionRatioCandidatesV25(resolve("catalog"));
  assert.ok(loaded);
  const { model: wan25 } = currentModel("wan_25_i2v_preview");
  const { model: wan27 } = currentModel("wan_27_t2v");
  const candidate25 = makeWanResolutionRatioCandidateV25(loaded, wan25, "generate-video", "video");
  const candidate27 = makeWanResolutionRatioCandidateV25(loaded, wan27, "generate-video", "video");
  assert.ok(candidate25);
  assert.ok(candidate27);
  assert.equal(candidate25.candidate_status, "STATIC_UI_GETTER_CANDIDATE");
  assert.equal(candidate25.runtime_usable, false);
  assert.equal(candidate25.backend_acceptance, false);
  assert.equal(candidate25.wrapper_semantics_verified, false);
  assert.equal(candidate25.wrapper_semantics, "UNKNOWN");
  assert.equal(candidate25.defaults_status, "UNKNOWN");
  assert.equal(candidate25.visibility_status, "UNKNOWN");
  assert.equal(candidate25.model_applicability, "UNKNOWN");

  assert.deepEqual(candidate25.parameter_schema.required, []);
  const resolution25 = candidate25.parameter_schema.properties.resolution;
  const resolution27 = candidate27.parameter_schema.properties.resolution;
  assert.ok(resolution25 && resolution25.type === "string");
  assert.ok(resolution27 && resolution27.type === "string");
  assert.deepEqual(resolution25.enum, ["480P", "720P", "1080P"]);
  assert.deepEqual(resolution27.enum, ["720P", "1080P"]);
  assert.equal("default" in candidate25.parameter_schema.properties.resolution!, false);
  assert.equal("default" in candidate25.parameter_schema.properties.aspect_ratio!, false);
  const ratioCases25 = candidate25.parameter_schema.conditional_enums[0] as { cases: Array<{ when: { equals: string }; allowed_values: string[] }> };
  const ratioCases27 = candidate27.parameter_schema.conditional_enums[0] as { cases: Array<{ when: { equals: string }; allowed_values: string[] }> };
  assert.deepEqual(ratioCases25.cases.map((entry) => [entry.when.equals, entry.allowed_values.length]), [["480P", 3], ["720P", 5], ["1080P", 5]]);
  assert.deepEqual(ratioCases27.cases.map((entry) => [entry.when.equals, entry.allowed_values.length]), [["720P", 5], ["1080P", 5]]);
  assert.equal(candidate25.field_evidence.aspect_ratio.required, "UNKNOWN");
  assert.equal(candidate25.field_evidence.aspect_ratio.default, "UNKNOWN");
  assert.equal(candidate25.field_evidence.aspect_ratio.visibility, "UNKNOWN");
});

test("inactive, missing, non-WAN, wrong-operation, and foreign-catalog models are omitted", () => {
  const loaded = loadPinnedWanResolutionRatioCandidatesV25(resolve("catalog"));
  assert.ok(loaded);
  const { catalog, model } = currentModel("wan_26_i2v");
  assert.equal(makeWanResolutionRatioCandidateV25(loaded, { ...model, active: false }, "generate-video", "video"), null);
  assert.equal(makeWanResolutionRatioCandidateV25(loaded, { ...model, id: "missing_wan_model" }, "generate-video", "video"), null);
  assert.equal(makeWanResolutionRatioCandidateV25(loaded, { ...model, id: "gpt-image-1", ai_name: "gpt_image" }, "generate-video", "video"), null);
  assert.equal(makeWanResolutionRatioCandidateV25(loaded, model, "generate-image", "image"), null);
  assert.equal(makeWanResolutionRatioCandidateV25(loaded, { ...model, catalog_version: "sha256-foreign.json" }, "generate-video", "video"), null);
  assert.equal(makeWanResolutionRatioCandidateV25(loaded, { ...model, source_hashes: { ...model.source_hashes, models: `sha256:${"f".repeat(64)}` } }, "generate-video", "video"), null);
  assert.equal(catalog.getModel("wan_26_i2v").active, true);
});

test("readonly MCP exposes WAN candidates while accepted schema and validate remain unavailable", async () => {
  const snapshot = loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: resolve("catalog") }).snapshot;
  const discoveryCatalog = new DiscoveryCatalogRepository(snapshot);
  const application = createDefaultApplication({ discoveryCatalog, runtimeCapabilities: null });
  const server = createMcpServer(application);
  const client = new Client({ name: "wan-v25-candidate-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const oldFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network must not be called"); }) as typeof fetch;
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    for (const [model_id, expectedResolution, ratioCaseCounts] of [
      ["wan_25_i2v_preview", ["480P", "720P", "1080P"], [3, 5, 5]],
      ["wan_27_t2v", ["720P", "1080P"], [5, 5]]
    ] as const) {
      const result = await client.callTool({
        name: "syntx_get_generation_schema",
        arguments: { model_id, operation_id: "generate-video" }
      });
      assert.equal(result.isError, undefined);
      const output = result.structuredContent as Record<string, unknown>;
      assert.equal(output.schema_status, "NOT_AVAILABLE");
      assert.equal(output.parameter_schema, null);
      const candidate = output.source_derived_parameter_candidate as Record<string, unknown>;
      assert.equal(candidate.candidate_status, "STATIC_UI_GETTER_CANDIDATE");
      assert.equal(candidate.runtime_usable, false);
      assert.equal(candidate.backend_acceptance, false);
      assert.equal(candidate.wrapper_semantics_verified, false);
      assert.equal(candidate.visibility_status, "UNKNOWN");
      const parameters = candidate.parameter_schema as {
        required: unknown[];
        properties: Record<string, { type: string; enum?: unknown[] }>;
        conditional_enums: Array<{ cases: Array<{ allowed_values: unknown[] }> }>;
      };
      assert.deepEqual(parameters.required, []);
      assert.deepEqual(parameters.properties.resolution?.enum, expectedResolution);
      assert.deepEqual(parameters.conditional_enums[0]?.cases.map((entry) => entry.allowed_values.length), ratioCaseCounts);
    }

    const bananaOutput = (await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "banana2", operation_id: "generate-image" }
    })).structuredContent as Record<string, unknown>;
    assert.equal(bananaOutput.schema_status, "NOT_AVAILABLE");
    const loadedBanana = loadPinnedBananaConditionalSettingsV19(resolve("catalog"));
    const bananaModel = discoveryCatalog.getModel("banana2");
    const bananaOperation = bananaModel.operations.find((operation) => operation.id === "generate-image");
    const expectedBanana = makeSourceDerivedParameterCandidate(
      loadedBanana,
      { ...bananaModel, catalog_version: `${bananaModel.fetched_at}.${bananaModel.source_hashes.models.slice(7, 19)}` },
      "generate-image",
      bananaOperation?.output_modality
    );
    assert.ok(expectedBanana);
    assert.deepEqual(bananaOutput.source_derived_parameter_candidate, expectedBanana);

    const nonWan = (await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "gpt-image-1", operation_id: "generate-image" }
    })).structuredContent as Record<string, unknown>;
    assert.equal(Object.hasOwn(nonWan, "source_derived_parameter_candidate"), false);
    const validation = await client.callTool({
      name: "syntx_validate_generation",
      arguments: { model_id: "wan_25_i2v_preview", operation_id: "generate-video", parameters: { resolution: "720P", aspect_ratio: "16:9" } }
    });
    assert.equal((validation.structuredContent as Record<string, unknown>).validation_status, "NOT_AVAILABLE");
    assert.equal((validation.structuredContent as Record<string, unknown>).runtime_usable, false);
    const tools = await client.listTools();
    assert.equal(tools.tools.some((tool) => tool.name === "syntx_owner_generate_media" || tool.name === "syntx_upload_file"), false);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    await client.close();
    await server.close();
  }
});
