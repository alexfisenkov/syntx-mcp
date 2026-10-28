import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createGenerationContractRegistry } from "../src/domain/generation-contract.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { createMcpServer } from "../src/mcp/server.js";
import { loadPinnedStaticParameterProjection } from "../src/catalog/static-form-control-history.js";
import { parseStaticGenerationParameterSchemaArtifact } from "../src/catalog/static-generation-parameter-schema.js";
import {
  loadPinnedBananaConditionalSettingsV19,
  makeSourceDerivedParameterCandidate,
  parsePinnedBananaConditionalSettingsV19Bytes
} from "../src/catalog/banana-conditional-settings-v19.js";

const HISTORICAL_E551_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";

function createHistoricalE551Application() {
  const selected = loadSelectedDiscoveryCatalog(HISTORICAL_E551_VERSION);
  return createDefaultApplication({ discoveryCatalog: selected.discoveryCatalog, runtimeCapabilities: null });
}

test("E551 generation schema lookup reports unavailable without a reviewed contract", async () => {
  const server = createMcpServer(createHistoricalE551Application());
  const client = new Client({ name: "generation-schema-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "banana2", operation_id: "generate-image" }
    });
    assert.equal(result.isError, undefined);
    const output = result.structuredContent as Record<string, unknown> | undefined;
    assert.equal(output?.schema_status, "NOT_AVAILABLE");
    assert.equal(output?.coverage_status, "STATIC_PARTIAL");
    assert.equal(output?.runtime_usable, false);
    assert.equal(output?.parameter_schema, null);
    assert.equal(output?.settings_evidence_status, "MATCHED");
    const evidence = output?.settings_evidence as Record<string, unknown>;
    assert.equal(evidence.runtime_usable, false);
    assert.match(String(evidence.public_catalog_version), /^sha256-[a-f0-9]{64}\.json$/u);
    const uiEvidence = output?.ui_parameter_evidence as Record<string, unknown>;
    const loadedUiProjection = loadPinnedStaticParameterProjection();
    assert.equal(uiEvidence.status, loadedUiProjection.projection === null ? "UNAVAILABLE" : "MATCHED");
    assert.equal(uiEvidence.version, "static-generation-parameter-schema-v1.2-e5517ee5-87e96b78-7cfe38ace55eadde.json");
    assert.equal(uiEvidence.sha256, "sha256:7cfe38ace55eadde73f5e14716b5263b8da41d122eaba3d914c15c7d7ca13d26");
    assert.equal(uiEvidence.runtime_usable, false);
    assert.equal(uiEvidence.source_schema_version, "1.2.0");
    assert.equal(uiEvidence.migration_status, loadedUiProjection.migration_status);
    if (loadedUiProjection.projection === null) {
      assert.equal(uiEvidence.reason_code, "SCHEMA_MIGRATION_REQUIRED");
      assert.deepEqual(uiEvidence.fields, []);
    } else {
      assert.equal(uiEvidence.control_structure_status, "CONTROLS_FOUND");
      assert.ok((uiEvidence.blocked_reasons as string[]).includes("UI_SETTINGS_ROOT_NOT_CHECKED"));
      assert.equal(loadedUiProjection.projection.summary.models_with_unresolved_settings_root, 10);
    }
    const uiFields = uiEvidence.fields as Array<Record<string, unknown>>;
    if (loadedUiProjection.projection !== null) {
      const aspectRatio = uiFields.find((field) => field.field === "aspect_ratio");
      assert.ok(aspectRatio);
      const aspectControl = (aspectRatio.controls as Array<Record<string, unknown>>)[0];
      assert.ok(aspectControl);
      assert.equal(aspectControl.nullable, true);
      assert.equal(aspectControl.nullable_semantics, "UI_OPTION_LIST_CONTAINS_NULL_ONLY");
      assert.ok((aspectControl.ui_choices as Array<Record<string, unknown>>).some((choice) => choice.value === null));
      assert.equal((aspectControl.default_candidate as Record<string, unknown>).status, "NOT_PRESENT");
      assert.equal(aspectControl.conditional_unresolved, false);
    }
    assert.equal(output?.schema_status, "NOT_AVAILABLE", "static UI evidence must not promote to a generation schema");
    assert.equal(output?.parameter_schema, null);
    const unavailableValidation = await client.callTool({
      name: "syntx_validate_generation",
      arguments: { model_id: "banana2", operation_id: "generate-image", parameters: { prompt: "must stay private" } }
    });
    const validationOutput = unavailableValidation.structuredContent as Record<string, unknown>;
    assert.equal(validationOutput.validation_status, "NOT_AVAILABLE");
    assert.equal(validationOutput.parameters_redacted, true);
    assert.equal(JSON.stringify(unavailableValidation).includes("must stay private"), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("reviewed generation schema validates locally and never returns prompt values", async () => {
  const application = createDefaultApplication();
  const resolved = application.getModel("banana2");
  assert.ok("ai_name" in resolved.model);
  const model = resolved.model;
  const settingsHash = `sha256:${"b".repeat(64)}`;
  const registry = createGenerationContractRegistry({
    schema_version: "1.0.0",
    catalog_version: resolved.catalog_version,
    source_hashes: model.source_hashes,
    contracts: [{
      model_id: model.id,
      operation_id: "generate-image",
      modality: "image",
      route: "design",
      ai_name: model.ai_name,
      model_type: model.upstream_id,
      status: "reviewed",
      provenance: {
        settings_source_sha256: settingsHash,
        references: [
          { kind: "public_catalog", reference: "current public catalog", sha256: model.source_hashes.models },
          { kind: "frontend_static", reference: "reviewed fixture", sha256: settingsHash },
          { kind: "manual_review", reference: "local test fixture" }
        ],
        reviewed_at: "2026-10-08T00:00:00.000Z"
      },
      parameters: {
        type: "object",
        additional_properties: false,
        required: ["prompt"],
        properties: {
          prompt: { type: "string", min_length: 1, max_length: 200 },
          quality: { type: "integer", minimum: 1, maximum: 4, default: 2 }
        },
        conditions: []
      },
      wire: { prompt_field: "prompt", settings_fields: { quality: "quality" }, fixed_settings: {} },
      output: { decoder_profile: "image-output-v1", mime_types: ["image/png"] },
      limits: { max_parameters: 8, max_value_depth: 3, max_serialized_bytes: 4096 }
    }]
  });
  const server = createMcpServer(application, { generationContractRegistry: registry });
  const client = new Client({ name: "generation-schema-reviewed-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const schemaResult = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: model.id, operation_id: "generate-image" }
    });
    assert.equal(schemaResult.isError, undefined);
    const schemaOutput = schemaResult.structuredContent as Record<string, unknown>;
    assert.equal(schemaOutput.schema_status, "reviewed");
    assert.equal(schemaOutput.runtime_usable, false);
    assert.ok(schemaOutput.parameter_schema);

    const privatePrompt = "private prompt value must never be returned";
    const validation = await client.callTool({
      name: "syntx_validate_generation",
      arguments: { model_id: model.id, operation_id: "generate-image", parameters: { prompt: privatePrompt } }
    });
    assert.equal(validation.isError, undefined);
    const validationOutput = validation.structuredContent as Record<string, unknown>;
    assert.equal(validationOutput.validation_status, "VALID");
    assert.equal(validationOutput.parameters_redacted, true);
    assert.deepEqual(validationOutput.defaulted_parameter_keys, ["quality"]);
    assert.equal(JSON.stringify(validation).includes(privatePrompt), false);

    const invalid = await client.callTool({
      name: "syntx_validate_generation",
      arguments: { model_id: model.id, operation_id: "generate-image", parameters: { prompt: privatePrompt, surprise: "must-not-echo" } }
    });
    assert.equal(invalid.isError, undefined);
    assert.equal((invalid.structuredContent as Record<string, unknown>).validation_status, "INVALID");
    assert.equal(JSON.stringify(invalid).includes(privatePrompt), false);
    assert.equal(JSON.stringify(invalid).includes("must-not-echo"), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("generation schema from a foreign catalog is blocked", async () => {
  const application = createDefaultApplication();
  const resolved = application.getModel("banana2");
  assert.ok("ai_name" in resolved.model);
  const registry = createGenerationContractRegistry({
    schema_version: "1.0.0",
    catalog_version: "foreign-catalog-version",
    source_hashes: resolved.model.source_hashes,
    contracts: []
  });
  const server = createMcpServer(application, { generationContractRegistry: registry });
  const client = new Client({ name: "generation-schema-foreign-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const schema = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "banana2", operation_id: "generate-image" }
    });
    const output = schema.structuredContent as Record<string, unknown>;
    assert.equal(output.schema_status, "BLOCKED");
    assert.deepEqual(output.blocked_reasons, ["REGISTRY_CATALOG_MISMATCH"]);
    assert.equal(output.parameter_schema, null);
    const validation = await client.callTool({
      name: "syntx_validate_generation",
      arguments: { model_id: "banana2", operation_id: "generate-image", parameters: { prompt: "private" } }
    });
    assert.equal((validation.structuredContent as Record<string, unknown>).validation_status, "BLOCKED");
    assert.equal(JSON.stringify(validation).includes("private"), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("every E551 public model returns an explicit schema status and matched static evidence", async () => {
  const loadedUiProjection = loadPinnedStaticParameterProjection();
  const application = createHistoricalE551Application();
  const first = application.searchModels({ include_inactive: true, limit: 100 });
  const second = application.searchModels({ include_inactive: true, limit: 100, cursor: first.next_cursor ?? undefined });
  const third = application.searchModels({ include_inactive: true, limit: 100, cursor: second.next_cursor ?? undefined });
  const models = [...first.models, ...second.models, ...third.models];
  const llmOnlyIds = new Set([
    "claude-haiku-5-5",
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "gpt-6.1-sol",
    "grok-4.7"
  ]);
  assert.equal(models.length, 205);
  const server = createMcpServer(application);
  const client = new Client({ name: "generation-schema-catalog-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    for (const listed of models) {
      const result = await client.callTool({
        name: "syntx_get_generation_schema",
        arguments: { model_id: listed.id }
      });
      assert.equal(result.isError, undefined, listed.id);
      const output = result.structuredContent as Record<string, unknown>;
      assert.ok(["NOT_AVAILABLE", "BLOCKED"].includes(String(output.schema_status)), listed.id);
      assert.equal(output.runtime_usable, false, listed.id);
      if (llmOnlyIds.has(listed.id)) {
        assert.equal(output.schema_status, "NOT_AVAILABLE", listed.id);
        assert.equal(output.coverage_status, "PUBLIC_CATALOG_ONLY", listed.id);
        assert.equal(output.parameter_schema, null, listed.id);
        assert.equal(output.contract_evidence, null, listed.id);
        assert.equal(output.settings_evidence_status, "UNAVAILABLE", listed.id);
        assert.equal(output.settings_evidence, null, listed.id);
        const validation = await client.callTool({
          name: "syntx_validate_generation",
          arguments: {
            model_id: listed.id,
            operation_id: "generate-text",
            parameters: { prompt: "must not be accepted" }
          }
        });
        const validationOutput = validation.structuredContent as Record<string, unknown>;
        assert.equal(validationOutput.validation_status, "NOT_AVAILABLE", listed.id);
        assert.deepEqual(validationOutput.normalized_parameter_keys, [], listed.id);
        assert.equal(validationOutput.parameters_redacted, true, listed.id);
        assert.equal(JSON.stringify(validation).includes("must not be accepted"), false, listed.id);
      } else {
        assert.equal(output.settings_evidence_status, "MATCHED", listed.id);
      }
      const uiEvidence = output.ui_parameter_evidence as Record<string, unknown>;
      assert.equal(uiEvidence.runtime_usable, false, listed.id);
      assert.ok(Array.isArray(uiEvidence.fields), listed.id);
      if (listed.active && ["generate-image", "generate-video"].includes(String(output.operation_id))) {
        assert.equal(uiEvidence.status, loadedUiProjection.projection === null ? "UNAVAILABLE" : "MATCHED", listed.id);
        if (loadedUiProjection.projection === null) assert.deepEqual(uiEvidence.fields, [], listed.id);
        if (uiEvidence.status === "MATCHED" && uiEvidence.control_structure_status !== "CONTROLS_FOUND") {
          assert.ok((uiEvidence.blocked_reasons as string[]).some((reason) =>
            reason === "UI_FORM_CONTROL_STRUCTURE_NOT_CHECKED" || reason === "UI_FORM_CONTROL_STRUCTURE_UNRESOLVED"
          ), listed.id);
        }
      } else {
        assert.equal(uiEvidence.status, "UNAVAILABLE", listed.id);
        assert.deepEqual(uiEvidence.fields, [], listed.id);
      }
    }

    const unknown = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "not-a-discovery-model" }
    });
    assert.equal(unknown.isError, true);
    const unknownResponse = unknown as {
      content: Array<{ type: string; text?: string }>;
    };
    const unknownText = unknownResponse.content[0];
    const unknownPayload = JSON.parse(unknownText?.type === "text" ? unknownText.text ?? "{}" : "{}") as {
      error?: { code?: string };
    };
    assert.equal(unknownPayload.error?.code, "MODEL_NOT_FOUND");
  } finally {
    await client.close();
    await server.close();
  }
});

test("stale injected UI model provenance is hidden and never becomes executable schema", async (t) => {
  const application = createHistoricalE551Application();
  const loaded = loadPinnedStaticParameterProjection();
  if (loaded.projection === null) { t.skip("hash-pinned legacy UI artifact is conservatively unavailable until schema migration completes"); return; }
  const projection = structuredClone(loaded.projection);
  const model = projection.models.find((candidate) => candidate.model_id === "banana2");
  assert.ok(model);
  model.ai_name = "stale-ai-name";
  const server = createMcpServer(application, {
    staticParameterProjection: projection,
    staticParameterProjectionVersion: "injected-test-projection",
    staticParameterProjectionSha256: null
  });
  const client = new Client({ name: "generation-schema-stale-ui-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const schema = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "banana2", operation_id: "generate-image" }
    });
    const output = schema.structuredContent as Record<string, unknown>;
    const uiEvidence = output.ui_parameter_evidence as Record<string, unknown>;
    assert.equal(uiEvidence.status, "STALE");
    assert.equal(uiEvidence.reason_code, "UI_PROJECTION_MODEL_BINDING_MISMATCH");
    assert.deepEqual(uiEvidence.fields, []);
    assert.equal(output.schema_status, "NOT_AVAILABLE");
    assert.equal(output.parameter_schema, null);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP exposes Banana source candidates separately from accepted schemas and validation", async () => {
  const application = createHistoricalE551Application();
  const server = createMcpServer(application);
  const client = new Client({ name: "banana-source-candidate-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const expected: Record<string, { sizes: string[] | null; thinking: string[] | null; imageDefault: string | null; thinkingDefault: string | null }> = {
      "banana-2.1": { sizes: ["1K", "2K", "4K"], thinking: ["minimal", "medium", "high"], imageDefault: "2K", thinkingDefault: "medium" },
      banana2: { sizes: ["1K", "2K", "4K"], thinking: null, imageDefault: "2K", thinkingDefault: null },
      banana3: { sizes: ["0.5K", "1K", "2K", "4K"], thinking: null, imageDefault: "2K", thinkingDefault: null },
      banana3_light: { sizes: ["1K"], thinking: null, imageDefault: "1K", thinkingDefault: null },
      banana: { sizes: null, thinking: null, imageDefault: null, thinkingDefault: null }
    };
    for (const [model_id, facts] of Object.entries(expected)) {
      const result = await client.callTool({ name: "syntx_get_generation_schema", arguments: { model_id, operation_id: "generate-image" } });
      assert.equal(result.isError, undefined, model_id);
      const output = result.structuredContent as Record<string, unknown>;
      assert.equal(output.schema_status, "NOT_AVAILABLE", model_id);
      assert.equal(output.parameter_schema, null, model_id);
      const candidate = output.source_derived_parameter_candidate as Record<string, unknown> | undefined;
      assert.ok(candidate, model_id);
      assert.equal(candidate.candidate_status, "STATIC_UI_CANDIDATE", model_id);
      assert.equal(candidate.runtime_usable, false, model_id);
      assert.equal(candidate.backend_acceptance, false, model_id);
      const source = candidate.source as Record<string, unknown>;
      assert.equal(source.model_id, model_id);
      assert.equal(source.settings_inventory_version, "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json");
      const fields = candidate.field_evidence as Record<string, Record<string, unknown>>;
      const properties = (candidate.parameter_schema as { properties: Record<string, unknown> }).properties;
      if (facts.sizes === null) {
        assert.equal(fields.image_size?.status, "CONTROL_NOT_RENDERED");
        assert.equal(Object.hasOwn(properties, "image_size"), false);
      } else {
        assert.deepEqual(fields.image_size?.allowed_values, facts.sizes);
        assert.equal(fields.image_size?.default_candidate, facts.imageDefault);
        assert.deepEqual((properties.image_size as { enum: string[] }).enum, facts.sizes);
      }
      if (facts.thinking === null) {
        assert.equal(fields.thinking_level?.status, "CONTROL_NOT_RENDERED");
        assert.equal(Object.hasOwn(properties, "thinking_level"), false);
      } else {
        assert.deepEqual(fields.thinking_level?.allowed_values, facts.thinking);
        assert.equal(fields.thinking_level?.default_candidate, facts.thinkingDefault);
        assert.deepEqual((properties.thinking_level as { enum: string[] }).enum, facts.thinking);
      }
    }

    const nonBanana = await client.callTool({ name: "syntx_get_generation_schema", arguments: { model_id: "gpt-image-1", operation_id: "generate-image" } });
    assert.equal(Object.hasOwn(nonBanana.structuredContent ?? {}, "source_derived_parameter_candidate"), false);
    const validation = await client.callTool({ name: "syntx_validate_generation", arguments: { model_id: "banana-2.1", operation_id: "generate-image", parameters: { model_type: "banana-2.1", image_size: "1K", thinking_level: "minimal" } } });
    assert.equal((validation.structuredContent as Record<string, unknown>).validation_status, "NOT_AVAILABLE");
  } finally {
    await client.close();
    await server.close();
  }
});

test("hash-pinned Banana candidate loader fails closed on corruption and model mismatch", () => {
  const path = resolve(process.cwd(), "catalog/runtime/v19/banana-conditional-settings-v1.0.0.json");
  const bytes = readFileSync(path);
  const loaded = loadPinnedBananaConditionalSettingsV19();
  assert.ok(loaded);
  assert.equal(parsePinnedBananaConditionalSettingsV19Bytes(bytes).artifact_sha256, loaded.artifact_sha256);
  assert.throws(() => parsePinnedBananaConditionalSettingsV19Bytes(Buffer.from("{}")), /SIZE_INVALID/u);
  const changed = Buffer.from(bytes);
  changed[0] = changed[0]! ^ 1;
  assert.throws(() => parsePinnedBananaConditionalSettingsV19Bytes(changed), /HASH_MISMATCH/u);
  assert.equal(makeSourceDerivedParameterCandidate(loaded, {
    id: "banana-2.1", upstream_id: "different-upstream-value", ai_name: "banana", active: true,
    catalog_version: "irrelevant", fetched_at: "2026-10-08T13:18:39.393Z",
    source_hashes: { models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444" }
  }, "generate-image", "image"), null);
});

test("stale injected UI source hashes hide all controls", async (t) => {
  const application = createDefaultApplication();
  const loaded = loadPinnedStaticParameterProjection();
  if (loaded.projection === null) { t.skip("hash-pinned legacy UI artifact is conservatively unavailable until schema migration completes"); return; }
  const projection = structuredClone(loaded.projection);
  projection.public_catalog.source_hashes.models = `sha256:${"a".repeat(64)}`;
  const server = createMcpServer(application, {
    staticParameterProjection: projection,
    staticParameterProjectionVersion: "stale-test-projection",
    staticParameterProjectionSha256: null
  });
  const client = new Client({ name: "generation-schema-stale-hashes-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const schema = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "banana2", operation_id: "generate-image" }
    });
    const output = schema.structuredContent as Record<string, unknown>;
    const uiEvidence = output.ui_parameter_evidence as Record<string, unknown>;
    assert.equal(uiEvidence.status, "STALE");
    assert.equal(uiEvidence.reason_code, "UI_PROJECTION_CATALOG_MISMATCH");
    assert.deepEqual(uiEvidence.fields, []);
  } finally {
    await client.close();
    await server.close();
  }
});

test("pinned UI projection hash mismatch fails closed instead of degrading to unavailable", (t) => {
  const catalogDirectory = mkdtempSync(join(tmpdir(), "syntx-ui-projection-tamper-"));
  t.after(() => rmSync(catalogDirectory, { recursive: true, force: true }));
  const targetDirectory = join(catalogDirectory, "runtime", "v11");
  mkdirSync(targetDirectory, { recursive: true });
  const version = "static-generation-parameter-schema-v1.2-e5517ee5-87e96b78-7cfe38ace55eadde.json";
  const original = readFileSync(resolve("catalog/runtime/v11", version));
  const tampered = Buffer.from(original);
  tampered[tampered.length - 2] = tampered[tampered.length - 2]! ^ 1;
  writeFileSync(join(targetDirectory, version), tampered);
  assert.throws(() => loadPinnedStaticParameterProjection(catalogDirectory), /STATIC_PARAMETER_PROJECTION_HASH_MISMATCH/u);
});

test("immutable v1.1 UI projection is hash-checked and migrated conservatively for MCP", async () => {
  const application = createHistoricalE551Application();
  const legacyVersion = "static-generation-parameter-schema-v1.1-e5517ee5-87e96b78-6e9e23581252ac96.json";
  const legacySha256 = "sha256:6e9e23581252ac9645a88edf90cbf4262a3f4ee64b9a336e58478204fc819839";
  const serialized = readFileSync(resolve("catalog/runtime/v11", legacyVersion), "utf8");
  const parsed = parseStaticGenerationParameterSchemaArtifact(serialized, legacySha256);
  assert.equal(parsed.source_schema_version, "1.1.0");
  assert.equal(parsed.migration_status, "LEGACY_V1_1_DEFAULTED_UNKNOWN");
  assert.equal(parsed.catalog.schema_version, "1.2.0");
  assert.equal(parsed.catalog.summary.models_with_not_checked_form_control_structure, 99);

  const server = createMcpServer(application, {
    staticParameterProjection: parsed.catalog,
    staticParameterProjectionVersion: legacyVersion,
    staticParameterProjectionSha256: parsed.sha256,
    staticParameterProjectionSourceSchemaVersion: parsed.source_schema_version,
    staticParameterProjectionMigrationStatus: parsed.migration_status
  });
  const client = new Client({ name: "generation-schema-legacy-projection-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const schema = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "banana2", operation_id: "generate-image" }
    });
    const output = schema.structuredContent as Record<string, unknown>;
    const uiEvidence = output.ui_parameter_evidence as Record<string, unknown>;
    assert.equal(uiEvidence.status, "MATCHED");
    assert.equal(uiEvidence.migration_status, "LEGACY_V1_1_DEFAULTED_UNKNOWN");
    assert.equal(uiEvidence.control_structure_status, "NOT_CHECKED");
    assert.ok((uiEvidence.blocked_reasons as string[]).includes("UI_PROJECTION_MIGRATED_UNKNOWN_FIELDS"));
    assert.ok((uiEvidence.blocked_reasons as string[]).includes("UI_FORM_CONTROL_STRUCTURE_NOT_CHECKED"));
    assert.equal(output.schema_status, "NOT_AVAILABLE");
    assert.equal(output.parameter_schema, null);
  } finally {
    await client.close();
    await server.close();
  }
});
