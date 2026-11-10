import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSyntxOwnerSeedream55ImageTools,
  SYNTX_UPLOAD_SEEDREAM55_IMAGE_REFERENCE_TOOL_NAME, SYNTX_OWNER_GENERATE_SEEDREAM55_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_SEEDREAM55_IMAGE_TOOL_NAME, SYNTX_OWNER_LIST_SEEDREAM55_IMAGE_RECOVERIES_TOOL_NAME,
  SYNTX_GET_SEEDREAM55_IMAGE_PARAMETERS_TOOL_NAME
} from "../src/mcp/owner-seedream-image-tools.js";
import { SEEDREAM55_PUBLIC_CATALOG_VERSION } from "../src/application/owner-seedream55-image-source-profile.js";

const attempt = "link_seedream55_tools_test_attempt_000001";
const names = [SYNTX_UPLOAD_SEEDREAM55_IMAGE_REFERENCE_TOOL_NAME, SYNTX_OWNER_GENERATE_SEEDREAM55_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_SEEDREAM55_IMAGE_TOOL_NAME, SYNTX_OWNER_LIST_SEEDREAM55_IMAGE_RECOVERIES_TOOL_NAME,
  SYNTX_GET_SEEDREAM55_IMAGE_PARAMETERS_TOOL_NAME];

test("Seedream 5.5 advertises isolated tools and sends exact fake wire through the service port", async () => {
  const seen: unknown[] = [];
  let posts = 0, gets = 0;
  const result = (parameters: Record<string, unknown>) => ({
    status: "result_observed", namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN",
    ai_name: "seedream", model_id: "seedream-5.5", variant: "seedream-5.5", operation_id: "generate-image",
    profile_id: "seedream55-image-source-reviewed-v1", profile_schema_hash: `sha256:${"a".repeat(64)}`,
    catalog_version: SEEDREAM55_PUBLIC_CATALOG_VERSION, request_fingerprint: `sha256:${"b".repeat(64)}`,
    parameters, cost_inputs: { batch_size: 0, resolution: parameters.resolution },
    cost_input_confidence: "SOURCE_JOINED_CONTROLLED_STATE_NOT_QUOTE", reference_count: 0, input_references: [],
    actual_image: { mime_type: "image/png", width: null, height: null }, geometry_verified: false,
    artifact: { url: "https://r2.syntx.ai/seedream/result.png", mime_type: "image/png", mime_source: "URL_EXTENSION",
      width: null, height: null, geometry_verified: false }
  });
  const uploadService = { async upload(input: unknown) { seen.push(input); return {
    status: "uploaded", reference_handle: "seedream_image_00000000-0000-4000-8000-000000000001", variant: "seedream-5.5",
    original_mime_type: "image/jpg", mime_type: "image/jpeg", width: 20, height: 20, size: 42,
    sha256: `sha256:${"c".repeat(64)}`, expires_in_seconds: 900, metadata_confidence: "CONTAINER_METADATA_ONLY",
    validation_confidence: "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;SOURCE_CONTAINER_METADATA_ONLY_NOT_PROVIDER_ACCEPTANCE",
    source_alpha_eligible: false, source_alpha_confidence: "NOT_PNG_SOURCE", source_sample_width: null, source_sample_height: null
  }; } };
  const generationService = {
    async generate(input: unknown) { posts += 1; seen.push(input); return result((input as { parameters: Record<string, unknown> }).parameters); },
    async reconcile() { gets += 1; return result({ aspect_ratio: "1:1", resolution: "2K", output_format: "png", background: "auto" }); },
    async listRecoveries() { gets += 1; return []; }
  };
  const server = new McpServer({ name: "seedream55-test", version: "1.0.0" });
  registerSyntxOwnerSeedream55ImageTools(server, { uploadService, generationService } as never);
  const client = new Client({ name: "seedream55-client", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map(({ name }) => name).sort(), [...names].sort());
    const source = await client.callTool({ name: SYNTX_GET_SEEDREAM55_IMAGE_PARAMETERS_TOOL_NAME, arguments: {} });
    assert.equal(source.isError, undefined, JSON.stringify(source));
    assert.equal((source.structuredContent as { evidence_level: string }).evidence_level, "STATIC_PUBLIC_SOURCE_ONLY");
    const badSource = await client.callTool({ name: SYNTX_GET_SEEDREAM55_IMAGE_PARAMETERS_TOOL_NAME, arguments: { hidden: true } });
    assert.equal(badSource.isError, true);
    const generate = tools.find(({ name }) => name === SYNTX_OWNER_GENERATE_SEEDREAM55_IMAGE_TOOL_NAME)!;
    assert.equal(JSON.stringify(generate.inputSchema).includes("seedream-5.5"), true);
    const parameters = { aspect_ratio: "1:1", resolution: "1.5K", output_format: "png", background: "transparent" };
    const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_SEEDREAM55_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: attempt, variant: "seedream-5.5", reference_handles: [], parameters, prompt: "local fake" } });
    assert.equal(generated.isError, undefined, JSON.stringify(generated));
    assert.deepEqual((generated.structuredContent as { parameters: unknown }).parameters, parameters);
    assert.equal(posts, 1);
    for (const bad of [
      { ...parameters, resolution: "3K" }, { ...parameters, output_format: "jpeg" },
      { ...parameters, background: "unsupported" }
    ]) {
      const rejected = await client.callTool({ name: SYNTX_OWNER_GENERATE_SEEDREAM55_IMAGE_TOOL_NAME,
        arguments: { link_attempt_id: attempt, variant: "seedream-5.5", reference_handles: [], parameters: bad, prompt: "local fake" } });
      assert.equal(rejected.isError, true);
    }
    assert.equal(posts, 1);
    const reconciled = await client.callTool({ name: SYNTX_OWNER_RECONCILE_SEEDREAM55_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: attempt, recovery_id: "seedream_image_recovery_00000000-0000-4000-8000-000000000001" } });
    assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled));
    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_SEEDREAM55_IMAGE_RECOVERIES_TOOL_NAME,
      arguments: { link_attempt_id: attempt, limit: 5 } });
    assert.equal(listed.isError, undefined);
    assert.equal(gets, 2);
    assert.equal(posts, 1);
  } finally { await client.close(); await server.close(); }
});
