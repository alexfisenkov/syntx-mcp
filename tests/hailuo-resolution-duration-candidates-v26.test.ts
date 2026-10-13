import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadSelectedPublicCatalog } from "../src/catalog/public-catalog-history.js";
import { loadPinnedBananaConditionalSettingsV19, makeSourceDerivedParameterCandidate } from "../src/catalog/banana-conditional-settings-v19.js";
import { loadPinnedWanResolutionRatioCandidatesV25, makeWanResolutionRatioCandidateV25 } from "../src/catalog/wan-resolution-ratio-candidates-v25.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  HAILUO_RESOLUTION_DURATION_V26_VERSION,
  loadPinnedHailuoResolutionDurationCandidatesV26,
  makeHailuoResolutionDurationCandidateV26,
  parseHailuoResolutionDurationCandidatesV26Document,
  parsePinnedHailuoResolutionDurationCandidatesV26Bytes
} from "../src/catalog/hailuo-resolution-duration-candidates-v26.js";

const CATALOG_DIRECTORY = resolve("catalog");
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";

function currentModel(id: string) {
  const snapshot = loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: CATALOG_DIRECTORY }).snapshot;
  const catalog = new DiscoveryCatalogRepository(snapshot);
  const model = catalog.getModel(id);
  return { catalog, model: { ...model, catalog_version: `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}` } };
}

test("pinned v26 loader exposes source-bound Hailuo UI candidates and preserves the root exclusion", () => {
  const loaded = loadPinnedHailuoResolutionDurationCandidatesV26(CATALOG_DIRECTORY);
  assert.ok(loaded);
  assert.equal(loaded.artifact_version, HAILUO_RESOLUTION_DURATION_V26_VERSION);
  assert.equal(loaded.artifact.cohort.length, 9);
  assert.equal(loaded.artifact.runtime_usable, false);
  assert.equal(loaded.artifact.backend_acceptance, false);
  const excludedRoot = loaded.artifact.cohort.find((row) => row.model_id === "hailuo-minimax");
  assert.ok(excludedRoot);
  assert.equal(excludedRoot.selector_binding, "EXCLUDED_BY_VALUE_FILTER");
  assert.equal(excludedRoot.resolution_candidates_status, "UNRESOLVED");
  assert.equal(excludedRoot.duration_control, null);

  for (const modelId of ["hailuo-01", "hailuo-01-director", "hailuo-01-live", "hailuo-01-live-character", "hailuo-02", "hailuo-2.3", "hailuo-2.3-fast", "hailuo-3.0"]) {
    const { model } = currentModel(modelId);
    const candidate = makeHailuoResolutionDurationCandidateV26(loaded, model, "generate-video", "video");
    assert.ok(candidate, `${modelId} should have a source candidate`);
    assert.equal(candidate.candidate_status, "STATIC_UI_GETTER_CANDIDATE");
    assert.equal(candidate.runtime_usable, false);
    assert.equal(candidate.backend_acceptance, false);
    assert.deepEqual(candidate.parameter_schema.required, []);
    assert.equal(candidate.source.model_id, modelId);
    assert.deepEqual(candidate.operation_binding, {
      operation_id: "generate-video", evidence: "CURRENT_PUBLIC_CATALOG_OPERATION", output_modality: "video"
    });
  }

  const { model: hailuo02 } = currentModel("hailuo-02");
  const candidate02 = makeHailuoResolutionDurationCandidateV26(loaded, hailuo02, "generate-video", "video");
  assert.ok(candidate02);
  const resolution02 = candidate02.parameter_schema.properties.resolution;
  assert.ok(resolution02 && resolution02.type === "string");
  assert.deepEqual(resolution02.enum, ["512p", "768p", "1080p"]);
  assert.equal("default" in resolution02, false);
  const durationCases02 = candidate02.parameter_schema.conditional_enums[0] as { cases: Array<{ when: { equals: string }; allowed_values: unknown[] }> };
  assert.deepEqual(durationCases02.cases.map((entry) => [entry.when.equals, entry.allowed_values]), [
    ["512p", [6, 10]], ["768p", [6, 10]], ["1080p", [6]]
  ]);

  const { model: hailuo30 } = currentModel("hailuo-3.0");
  const candidate30 = makeHailuoResolutionDurationCandidateV26(loaded, hailuo30, "generate-video", "video");
  assert.ok(candidate30);
  const resolution30 = candidate30.parameter_schema.properties.resolution;
  assert.ok(resolution30 && resolution30.type === "string");
  assert.deepEqual(resolution30.enum, ["768p", "2K"]);
  assert.deepEqual(candidate30.parameter_schema.properties.video_duration, { type: "integer", minimum: 4, maximum: 15, step: 1 });
  assert.equal(candidate30.field_evidence.video_duration.ui_reset_candidate, 5);
  assert.equal(candidate30.field_evidence.video_duration.default, "UNKNOWN");
  assert.deepEqual(candidate30.resolution_duration_relation, [
    { resolution: "768p", durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
    { resolution: "2K", durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }
  ]);

  const { model: rootModel } = currentModel("hailuo-minimax");
  assert.equal(makeHailuoResolutionDurationCandidateV26(loaded, rootModel, "generate-video", "video"), null);
});

test("v26 hash-first and semantic parser reject corrupt bytes, extra facts, and changed candidate relations", () => {
  const artifactBytes = readFileSync(resolve("catalog/runtime/v26", HAILUO_RESOLUTION_DURATION_V26_VERSION));
  assert.throws(() => parsePinnedHailuoResolutionDurationCandidatesV26Bytes(Buffer.from("{}")), /SIZE_INVALID/u);
  const sameSizeMutation = Buffer.from(artifactBytes);
  sameSizeMutation[0] = sameSizeMutation[0]! ^ 1;
  assert.throws(() => parsePinnedHailuoResolutionDurationCandidatesV26Bytes(sameSizeMutation), /HASH_MISMATCH/u);
  assert.throws(() => parseHailuoResolutionDurationCandidatesV26Document(Buffer.from([0xff])), /UTF8_INVALID/u);

  const artifact = JSON.parse(artifactBytes.toString("utf8")) as Record<string, unknown>;
  assert.throws(() => parseHailuoResolutionDurationCandidatesV26Document(Buffer.from(JSON.stringify({ ...artifact, injected_fact: true }))), /unrecognized_keys/u);
  const changedRelation = structuredClone(artifact) as { cohort: Array<{ model_id: string; resolution_candidates: Array<{ value: string; durations: number[] }> }> };
  const hailuo02 = changedRelation.cohort.find((row) => row.model_id === "hailuo-02");
  assert.ok(hailuo02);
  hailuo02.resolution_candidates[0]!.durations.reverse();
  assert.throws(() => parseHailuoResolutionDurationCandidatesV26Document(Buffer.from(JSON.stringify(changedRelation))), /BINDING_INVALID/u);
});

test("v26 filesystem loader refuses symlink and oversized artifact replacement", () => {
  const source = resolve("catalog/runtime/v26", HAILUO_RESOLUTION_DURATION_V26_VERSION);
  const artifactBytes = readFileSync(source);
  const root = mkdtempSync(resolve(tmpdir(), "syntx-hailuo-v26-"));
  try {
    const versionDirectory = resolve(root, "runtime/v26");
    mkdirSync(versionDirectory, { recursive: true });
    symlinkSync(source, resolve(versionDirectory, HAILUO_RESOLUTION_DURATION_V26_VERSION));
    assert.equal(loadPinnedHailuoResolutionDurationCandidatesV26(root), null);
    rmSync(resolve(versionDirectory, HAILUO_RESOLUTION_DURATION_V26_VERSION));
    writeFileSync(resolve(versionDirectory, HAILUO_RESOLUTION_DURATION_V26_VERSION), Buffer.concat([artifactBytes, Buffer.from(" ")]));
    assert.equal(loadPinnedHailuoResolutionDurationCandidatesV26(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("v26 candidate maker fails closed when the current model or operation binding drifts", () => {
  const loaded = loadPinnedHailuoResolutionDurationCandidatesV26(CATALOG_DIRECTORY);
  assert.ok(loaded);
  const { model } = currentModel("hailuo-02");
  const noCandidate = (input: typeof model, operationId = "generate-video", outputModality = "video") =>
    makeHailuoResolutionDurationCandidateV26(loaded, input, operationId, outputModality);
  assert.equal(noCandidate({ ...model, active: false }), null);
  assert.equal(noCandidate({ ...model, ai_name: "foreign-provider" }), null);
  assert.equal(noCandidate({ ...model, upstream_id: "foreign-model" }), null);
  assert.equal(noCandidate({ ...model, fetched_at: "2026-10-09T00:00:00.000Z" }), null);
  assert.equal(noCandidate({ ...model, catalog_version: "sha256-foreign.json" }), null);
  assert.equal(noCandidate({ ...model, source_hashes: { ...model.source_hashes, models: `sha256:${"f".repeat(64)}` } }), null);
  assert.equal(noCandidate(model, "generate-image", "image"), null);
  assert.equal(noCandidate(model, "generate-video", "image"), null);
});

test("read-only MCP exposes Hailuo candidate union without accepted validation, paid tools, or network", async () => {
  const snapshot = loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: CATALOG_DIRECTORY }).snapshot;
  const discoveryCatalog = new DiscoveryCatalogRepository(snapshot);
  const application = createDefaultApplication({ discoveryCatalog, runtimeCapabilities: null });
  const server = createMcpServer(application);
  const client = new Client({ name: "hailuo-v26-candidate-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const oldFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network must not be called"); }) as typeof fetch;
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const toolNames = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(toolNames.includes("syntx_owner_generate_media"), false);
    assert.equal(toolNames.includes("syntx_upload_file"), false);
    assert.equal(toolNames.includes("syntx_owner_start_durable_generation"), false);

    for (const model_id of ["hailuo-02", "hailuo-3.0"]) {
      const result = await client.callTool({ name: "syntx_get_generation_schema", arguments: { model_id, operation_id: "generate-video" } });
      assert.equal(result.isError, undefined);
      const output = result.structuredContent as Record<string, unknown>;
      assert.equal(output.schema_status, "NOT_AVAILABLE");
      assert.equal(output.parameter_schema, null);
      const candidate = output.source_derived_parameter_candidate as Record<string, unknown>;
      assert.equal(candidate.candidate_status, "STATIC_UI_GETTER_CANDIDATE");
      assert.equal(candidate.runtime_usable, false);
      assert.equal(candidate.backend_acceptance, false);
    }

    const validation = await client.callTool({ name: "syntx_validate_generation", arguments: {
      model_id: "hailuo-02", operation_id: "generate-video", parameters: { resolution: "768p", video_duration: 6 }
    } });
    assert.equal((validation.structuredContent as Record<string, unknown>).validation_status, "NOT_AVAILABLE");

    const bananaOutput = (await client.callTool({ name: "syntx_get_generation_schema", arguments: {
      model_id: "banana2", operation_id: "generate-image"
    } })).structuredContent as Record<string, unknown>;
    const bananaModel = discoveryCatalog.getModel("banana2");
    const bananaOperation = bananaModel.operations.find((operation) => operation.id === "generate-image");
    const expectedBanana = makeSourceDerivedParameterCandidate(loadPinnedBananaConditionalSettingsV19(CATALOG_DIRECTORY), {
      ...bananaModel, catalog_version: `${bananaModel.fetched_at}.${bananaModel.source_hashes.models.slice(7, 19)}`
    }, "generate-image", bananaOperation?.output_modality);
    assert.deepEqual(bananaOutput.source_derived_parameter_candidate, expectedBanana);

    const wanOutput = (await client.callTool({ name: "syntx_get_generation_schema", arguments: {
      model_id: "wan_25_i2v_preview", operation_id: "generate-video"
    } })).structuredContent as Record<string, unknown>;
    const wanModel = discoveryCatalog.getModel("wan_25_i2v_preview");
    const wanOperation = wanModel.operations.find((operation) => operation.id === "generate-video");
    const expectedWan = makeWanResolutionRatioCandidateV25(loadPinnedWanResolutionRatioCandidatesV25(CATALOG_DIRECTORY), {
      ...wanModel, catalog_version: `${wanModel.fetched_at}.${wanModel.source_hashes.models.slice(7, 19)}`
    }, "generate-video", wanOperation?.output_modality);
    assert.deepEqual(wanOutput.source_derived_parameter_candidate, expectedWan);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    await client.close();
    await server.close();
  }
});
