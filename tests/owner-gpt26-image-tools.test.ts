import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSyntxOwnerGpt26ImageTools,
  SYNTX_GET_GPT26_IMAGE_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_GENERATE_GPT26_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_GPT26_IMAGE_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_GPT26_IMAGE_TOOL_NAME,
  SYNTX_UPLOAD_GPT26_IMAGE_REFERENCE_TOOL_NAME } from "../src/mcp/owner-gpt26-image-tools.js";
import { OWNER_GPT26_PUBLIC_CATALOG_VERSION } from "../src/application/owner-gpt26-image-source-profile.js";
import type { RegisterSyntxOwnerGpt26ImageToolsOptions } from "../src/mcp/owner-gpt26-image-tools.js";

const ATTEMPT = "link_gpt26_test_attempt_00000001";
const PARAMETERS = { aspect_ratio: "16:9", quality: "1K", details_quality: "max", output_format: "gif" };
const RESULT = {
  status: "result_observed", backend_acceptance: "unproven", ai_name: "sora-images",
  model_id: "gpt-image-2.6-flare", variant: "gpt-image-2.6-flare", operation_id: "generate-image",
  profile_id: "gpt-image-26-source-reviewed-v1", profile_schema_hash: `sha256:${"a".repeat(64)}`,
  catalog_version: OWNER_GPT26_PUBLIC_CATALOG_VERSION, request_fingerprint: `sha256:${"b".repeat(64)}`,
  parameters: PARAMETERS, cost_inputs: { quality: "1K", details_quality: "max", output_format: "gif" },
  cost_input_confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP",
  reference_count: 0, total_reference_count: 0, counts_by_kind: { image: 0, video: 0, file: 0 },
  input_references: [], actual_image: { mime_type: "image/gif", width: null, height: null },
  geometry_verified: false, artifact: { url: "https://r2.syntx.ai/result.gif", mime_type: "image/gif",
    mime_source: "URL_EXTENSION", width: null, height: null, geometry_verified: false }
};

async function withClient(options: RegisterSyntxOwnerGpt26ImageToolsOptions,
  run: (client: Client) => Promise<void>): Promise<void> {
  const server = new McpServer({ name: "gpt26-image-test", version: "1" });
  registerSyntxOwnerGpt26ImageTools(server, options);
  const client = new Client({ name: "gpt26-image-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await run(client); } finally { await client.close(); await server.close(); }
}

test("GPT26 advertises five isolated tools, source controls and exact four-field generation schema", async () => {
  const options = {
    uploadService: { async upload() { throw new Error("unused"); }, async assertLinkedAttempt() {} },
    generationService: { async generate() { throw new Error("unused"); }, async reconcile() { throw new Error("unused"); },
      async listRecoveries() { return []; } }
  } as unknown as RegisterSyntxOwnerGpt26ImageToolsOptions;
  await withClient(options, async client => {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map(tool => tool.name).sort(), [SYNTX_GET_GPT26_IMAGE_PARAMETERS_TOOL_NAME,
      SYNTX_UPLOAD_GPT26_IMAGE_REFERENCE_TOOL_NAME,
      SYNTX_OWNER_GENERATE_GPT26_IMAGE_TOOL_NAME, SYNTX_OWNER_RECONCILE_GPT26_IMAGE_TOOL_NAME,
      SYNTX_OWNER_LIST_GPT26_IMAGE_RECOVERIES_TOOL_NAME].sort());
    const input = tools.find(tool => tool.name === SYNTX_OWNER_GENERATE_GPT26_IMAGE_TOOL_NAME)!.inputSchema as unknown as {
      properties: { variant: { enum: string[] }; parameters: { required: string[]; properties: Record<string, unknown> } }
    };
    assert.deepEqual(input.properties.variant.enum, ["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]);
    assert.deepEqual(input.properties.parameters.required.sort(), ["aspect_ratio", "quality", "details_quality", "output_format"].sort());
    assert.deepEqual(Object.keys(input.properties.parameters.properties).sort(), ["aspect_ratio", "quality", "details_quality", "output_format"].sort());
    const source = await client.callTool({ name: SYNTX_GET_GPT26_IMAGE_PARAMETERS_TOOL_NAME, arguments: {} });
    assert.equal(source.isError, undefined, JSON.stringify(source));
    assert.deepEqual((source.structuredContent as { output_format: string[] }).output_format, ["png", "jpg", "webp", "gif"]);
    assert.equal((source.structuredContent as { max_total_file_size: number }).max_total_file_size, 80 * 1024 * 1024);
  });
});

test("GPT26 rejects invalid GIF controls before service invocation and validates owner-bound result identity", async () => {
  let calls = 0;
  let last: unknown;
  let returned: unknown = RESULT;
  const options = {
    uploadService: { async upload() { throw new Error("unused"); }, async assertLinkedAttempt() {} },
    generationService: {
      async generate(input: unknown) { calls += 1; last = input; return returned; },
      async reconcile() { return returned; }, async listRecoveries() { return []; }
    }
  } as unknown as RegisterSyntxOwnerGpt26ImageToolsOptions;
  await withClient(options, async client => {
    const args = { link_attempt_id: ATTEMPT, variant: "gpt-image-2.6-flare", reference_handles: [],
      parameters: PARAMETERS, prompt: "Create a looping illustration" };
    for (const bad of [
      { ...args, parameters: { ...PARAMETERS, quality: "2K" } },
      { ...args, parameters: { ...PARAMETERS, aspect_ratio: "21:9" } },
      { ...args, parameters: { ...PARAMETERS, transparency: true } },
      { ...args, variant: "gpt-image-2.5-flare" }
    ]) assert.equal((await client.callTool({ name: SYNTX_OWNER_GENERATE_GPT26_IMAGE_TOOL_NAME,
      arguments: bad })).isError, true);
    assert.equal(calls, 0);
    const valid = await client.callTool({ name: SYNTX_OWNER_GENERATE_GPT26_IMAGE_TOOL_NAME, arguments: args });
    assert.equal(valid.isError, undefined, JSON.stringify(valid));
    assert.deepEqual((last as { parameters: unknown }).parameters, PARAMETERS);
    assert.equal((valid.structuredContent as { artifact: { mime_type: string } }).artifact.mime_type, "image/gif");
    returned = { ...RESULT, model_id: "gpt-image-2.6-sunburst" };
    assert.equal((await client.callTool({ name: SYNTX_OWNER_GENERATE_GPT26_IMAGE_TOOL_NAME,
      arguments: args })).isError, true);
    returned = { ...RESULT, cost_inputs: { ...RESULT.cost_inputs, output_format: "png" } };
    assert.equal((await client.callTool({ name: SYNTX_OWNER_GENERATE_GPT26_IMAGE_TOOL_NAME,
      arguments: args })).isError, true);
  });
});
