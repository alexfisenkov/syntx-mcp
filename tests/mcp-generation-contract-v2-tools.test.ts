import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSyntxGenerationContractTools } from "../src/mcp/generation-contract-tools.js";
import type { GenerationContractCatalogModel } from "../src/mcp/generation-contract-tools.js";
import { createGenerationContractRegistryV2, type GenerationContractV2Input } from "../src/domain/generation-contract-v2.js";

function v2Variant(
  model: GenerationContractCatalogModel,
  variantId: string,
  quality: string
): GenerationContractV2Input {
  const settingsHash = `sha256:${"d".repeat(64)}`;
  return {
    variant_id: variantId,
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
        { kind: "public_catalog", reference: "current-model-catalog", sha256: model.source_hashes.models },
        { kind: "frontend_static", reference: "v2-reviewed-settings", sha256: settingsHash },
        { kind: "manual_review", reference: "v2-test-review" }
      ],
      reviewed_at: "2026-10-09T00:00:00.000Z"
    },
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt", "quality"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 100 },
        quality: { type: "string", enum: [quality] }
      },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image",
      input_kind: "prompt",
      prompt_field: "prompt",
      settings_fields: { quality: "render_quality" },
      fixed_settings: {},
      media_reference_fields: {}
    },
    output: { decoder_profile: "image-test", mime_types: ["image/jpeg"] },
    limits: { max_parameters: 8, max_value_depth: 3, max_serialized_bytes: 4096, max_normalized_nodes: 128 }
  };
}

test("v2 schema and validation tools require explicit variants and never return prompt values", async () => {
  const sourceHashes = { ai: `sha256:${"a".repeat(64)}`, llm_models: `sha256:${"b".repeat(64)}`, models: `sha256:${"c".repeat(64)}` };
  const model: GenerationContractCatalogModel = {
    id: "banana2",
    upstream_id: "banana-2.1",
    ai_name: "banana",
    active: true,
    default: true,
    display_name: "Banana 2.1",
    description: null,
    features: { files_generation: false, files_processing: false, image_generation: true, image_processing: false, search: false },
    operations: [{ id: "generate-image", display_name: "Generate image", output_modality: "image", derivation: "PUBLIC_AI_SCOPE" } as GenerationContractCatalogModel["operations"][number]],
    fetched_at: "2026-10-09T00:00:00.000Z",
    source_hashes: sourceHashes,
    settings: null,
    type: "image",
    catalog_version: `2026-10-09T00:00:00.000Z.${sourceHashes.models.slice(7, 19)}`
  };
  const registry = createGenerationContractRegistryV2({
    schema_version: "2.0.0",
    catalog_version: model.catalog_version,
    source_hashes: model.source_hashes,
    contracts: [v2Variant(model, "high", "2K"), v2Variant(model, "low", "1K")]
  });
  const server = new McpServer({ name: "generation-v2-test", version: "1.0.0" });
  registerSyntxGenerationContractTools(server, {
    resolveModel(modelId) {
      if (modelId !== model.id) throw new Error("MODEL_NOT_FOUND");
      return model;
    },
    registryV2: registry
  });
  const client = new Client({ name: "generation-v2-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const ambiguous = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: model.id, operation_id: "generate-image" }
    });
    const ambiguousOutput = ambiguous.structuredContent as Record<string, unknown>;
    assert.equal(ambiguousOutput.schema_status, "BLOCKED");
    assert.equal(ambiguousOutput.blocked_reasons && (ambiguousOutput.blocked_reasons as string[])[0], "CONTRACT_VARIANT_REQUIRED");
    assert.deepEqual(ambiguousOutput.available_variant_ids, ["high", "low"]);
    assert.equal(ambiguousOutput.parameter_schema_v2, null);

    const selected = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: model.id, operation_id: "generate-image", variant_id: "high" }
    });
    const selectedOutput = selected.structuredContent as Record<string, unknown>;
    assert.equal(selectedOutput.schema_status, "reviewed");
    assert.equal(selectedOutput.contract_schema_version, "2.0.0");
    assert.equal(selectedOutput.variant_id, "high");
    assert.deepEqual(selectedOutput.available_variant_ids, ["high", "low"]);
    assert.ok(selectedOutput.parameter_schema_v2);

    const privatePrompt = "never-return-this-v2-prompt";
    const valid = await client.callTool({
      name: "syntx_validate_generation",
      arguments: { model_id: model.id, operation_id: "generate-image", variant_id: "high", parameters: { prompt: privatePrompt, quality: "2K" } }
    });
    const validOutput = valid.structuredContent as Record<string, unknown>;
    assert.equal(validOutput.validation_status, "VALID");
    assert.equal(validOutput.variant_id, "high");
    assert.deepEqual(validOutput.available_variant_ids, ["high", "low"]);
    assert.equal(JSON.stringify(valid).includes(privatePrompt), false);

    const unknown = await client.callTool({
      name: "syntx_validate_generation",
      arguments: { model_id: model.id, operation_id: "generate-image", variant_id: "missing", parameters: { prompt: privatePrompt } }
    });
    assert.equal((unknown.structuredContent as Record<string, unknown>).validation_status, "BLOCKED");
    assert.equal(JSON.stringify(unknown).includes(privatePrompt), false);
  } finally {
    await client.close();
    await server.close();
  }
});
