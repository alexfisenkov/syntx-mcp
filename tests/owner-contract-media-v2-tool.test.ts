import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import type { GenerationContractCatalogModel, GenerationContractCatalogPort } from "../src/adapter/syntx/generation-contract-executor.js";
import { createReviewedContractPreflight } from "../src/application/reviewed-contract-preflight.js";
import type { OwnerContractMediaService } from "../src/application/owner-contract-media.js";
import { registerSyntxOwnerContractMediaTools } from "../src/mcp/owner-contract-media-tool.js";
import { createGenerationContractRegistryV2, type GenerationContractRegistryV2Input, type GenerationContractV2Input } from "../src/domain/generation-contract-v2.js";

const SOURCE_HASHES = { ai: `sha256:${"a".repeat(64)}`, llm_models: `sha256:${"b".repeat(64)}`, models: `sha256:${"c".repeat(64)}` };
const SETTINGS_HASH = `sha256:${"d".repeat(64)}`;
const CATALOG_VERSION = `2026-10-09T00:00:00.000Z.${SOURCE_HASHES.models.slice(7, 19)}`;

function variant(variantId: string, quality: string): GenerationContractV2Input {
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
        { kind: "public_catalog", reference: "catalog-model", sha256: SOURCE_HASHES.models },
        { kind: "frontend_static", reference: "wire-settings", sha256: SETTINGS_HASH },
        { kind: "manual_review", reference: "reviewed-exact-request" },
        { kind: "live_owner", reference: "live-exact-request", sha256: SETTINGS_HASH }
      ],
      reviewed_at: "2026-10-09T00:00:00.000Z",
      live_observed_at: "2026-10-09T00:00:00.000Z"
    },
    parameters: {
      type: "object", additional_properties: false, required: ["prompt", "quality"],
      properties: { prompt: { type: "string", min_length: 1, max_length: 100 }, quality: { type: "string", enum: [quality] } },
      conditions: [], conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { quality: "render_quality" }, fixed_settings: {}, media_reference_fields: {}
    },
    output: { decoder_profile: "image-jpeg", mime_types: ["image/jpeg"] },
    limits: { max_parameters: 8, max_value_depth: 3, max_serialized_bytes: 4096, max_normalized_nodes: 128 }
  };
}

test("owner media MCP preflights the selected v2 variant and rejects missing variant before subscription lookup", async () => {
  const registryInput: GenerationContractRegistryV2Input = {
    schema_version: "2.0.0", catalog_version: CATALOG_VERSION, source_hashes: SOURCE_HASHES,
    contracts: [variant("high", "2K"), variant("low", "1K")]
  };
  const registry = createGenerationContractRegistryV2(registryInput);
  const model: GenerationContractCatalogModel = {
    id: "image-model-a", upstream_id: "upstream-image-a", ai_name: "provider-a", active: true,
    operations: [{ id: "generate-image", output_modality: "image" }],
    fetched_at: "2026-10-09T00:00:00.000Z", source_hashes: SOURCE_HASHES
  };
  const catalog: GenerationContractCatalogPort = { getModel: () => model };
  const executor = new GenerationContractExecutorV2(registry, catalog);
  const calls: string[] = [];
  const prepareGeneration = createReviewedContractPreflight({
    executor,
    resolveSubscription: async (attemptId) => {
      calls.push(`subscription:${attemptId}`);
      return { active: true, plan_type: "Elite", end_date: null, end_date_kind: null };
    }
  });
  let preparedVariant: string | undefined;
  const fakeService = {
    generate: async (input: { prepared: { contract_metadata?: { variant_id: string } } }) => {
      preparedVariant = input.prepared.contract_metadata?.variant_id;
      return { model_id: "image-model-a", operation_id: "generate-image", modality: "image", artifacts: [] };
    },
    reconcile: async () => ({ model_id: "image-model-a", operation_id: "generate-image", modality: "image", artifacts: [] })
  } as unknown as OwnerContractMediaService;
  const server = new McpServer({ name: "owner-v2-test", version: "1.0.0" });
  registerSyntxOwnerContractMediaTools(server, {
    registry,
    executor,
    service: fakeService,
    prepareGeneration,
    resolveChatClient: () => ({}) as never
  });
  const client = new Client({ name: "owner-v2-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const common = {
      link_attempt_id: "link_12345678901234567890",
      model_id: "image-model-a",
      operation_id: "generate-image",
      parameters: { prompt: "private prompt", quality: "2K" }
    };
    const ambiguous = await client.callTool({ name: "syntx_owner_generate_media", arguments: common });
    assert.equal(ambiguous.isError, true);
    assert.equal(JSON.stringify(ambiguous).includes("private prompt"), false);
    assert.deepEqual(calls, []);

    const selected = await client.callTool({ name: "syntx_owner_generate_media", arguments: { ...common, variant_id: "high" } });
    assert.equal(selected.isError, undefined);
    assert.equal((selected.structuredContent as Record<string, unknown>).variant_id, "high");
    assert.equal(preparedVariant, "high");
    assert.deepEqual(calls, ["subscription:link_12345678901234567890"]);
    assert.equal(JSON.stringify(selected).includes("private prompt"), false);
  } finally {
    await client.close();
    await server.close();
  }
});
