import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createOwnerSeedance20T2vProfile } from "../src/application/owner-seedance20-t2v-profile.js";
import type { OwnerSeedance20T2vGenerationService } from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import {
  SYNTX_OWNER_SEEDANCE20_T2V_TOOL_NAMES,
  SYNTX_OWNER_GET_SEEDANCE20_T2V_SOURCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_SEEDANCE20_T2V_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_SEEDANCE20_T2V_TOOL_NAME,
  SYNTX_OWNER_LIST_SEEDANCE20_T2V_RECOVERIES_TOOL_NAME,
  registerSyntxOwnerSeedance20T2vTools
} from "../src/mcp/owner-seedance20-t2v-tools.js";

const OUTPUT = {
  status: "reviewed",
  confidence_scope: "exact_result_only",
  model_id: "seedance-2.0",
  operation_id: "generate-video",
  modality: "video",
  variant_id: "seedance-2.0-t2v-source-reviewed-no-reference-mini",
  artifacts: [{ url: "https://r2.syntx.ai/seedance20/result.mp4", mime_type: "video/mp4" }]
} as const;

test("Seedance 2.0 MCP exposes four tools and keeps mode server-injected", async () => {
  const profile = createOwnerSeedance20T2vProfile(resolve(process.cwd(), "catalog"));
  let generateCalls = 0;
  let observedInput: unknown;
  const service = {
    getParametersSource: () => profile.source,
    async generate(input: unknown) { generateCalls += 1; observedInput = input; return OUTPUT; },
    async reconcile() { return OUTPUT; },
    listRecoveries: () => []
  } as unknown as Pick<OwnerSeedance20T2vGenerationService, "getParametersSource" | "generate" | "reconcile" | "listRecoveries">;
  const server = new McpServer({ name: "seedance20-tools-test", version: "1.0.0" });
  registerSyntxOwnerSeedance20T2vTools(server, { service });
  const client = new Client({ name: "seedance20-tools-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...SYNTX_OWNER_SEEDANCE20_T2V_TOOL_NAMES].sort());
    const generationTool = listed.tools.find((tool) => tool.name === SYNTX_OWNER_GENERATE_SEEDANCE20_T2V_TOOL_NAME);
    assert.ok(generationTool);
    const properties = (generationTool.inputSchema as { properties?: Record<string, unknown> }).properties;
    assert.ok(properties);
    assert.equal(Object.hasOwn(properties, "mode"), false);
    assert.equal(Object.hasOwn(properties, "camera_fixed"), false);
    assert.equal(Object.hasOwn(properties, "file_urls"), false);

    const source = await client.callTool({ name: SYNTX_OWNER_GET_SEEDANCE20_T2V_SOURCE_TOOL_NAME, arguments: {} });
    assert.equal(source.isError, undefined);
    assert.equal((source.structuredContent as { identity: { model_id: string } }).identity.model_id, "seedance-2.0");

    const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_SEEDANCE20_T2V_TOOL_NAME, arguments: {
      link_attempt_id: "link_seedance20_tools_test_0001", prompt: "A yellow duck.", resolution: "720p",
      aspect_ratio: "16:9", video_duration: 5, generate_audio: true
    } });
    assert.equal(generated.isError, undefined);
    assert.equal(generateCalls, 1);
    assert.deepEqual(observedInput, { attemptId: "link_seedance20_tools_test_0001", prompt: "A yellow duck.", resolution: "720p",
      aspect_ratio: "16:9", video_duration: 5, generate_audio: true });

    const attemptedMode = await client.callTool({ name: SYNTX_OWNER_GENERATE_SEEDANCE20_T2V_TOOL_NAME, arguments: {
      link_attempt_id: "link_seedance20_tools_test_0001", prompt: "A yellow duck.", resolution: "720p",
      aspect_ratio: "16:9", video_duration: 5, generate_audio: true, mode: "pro"
    } });
    assert.equal(attemptedMode.isError, true);
    assert.equal(generateCalls, 1);

    const reconciled = await client.callTool({ name: SYNTX_OWNER_RECONCILE_SEEDANCE20_T2V_TOOL_NAME, arguments: {
      link_attempt_id: "link_seedance20_tools_test_0001", recovery_id: "recovery_00000000-0000-4000-8000-000000000001"
    } });
    assert.equal(reconciled.isError, undefined);
    const recoveries = await client.callTool({ name: SYNTX_OWNER_LIST_SEEDANCE20_T2V_RECOVERIES_TOOL_NAME, arguments: {
      link_attempt_id: "link_seedance20_tools_test_0001"
    } });
    assert.equal(recoveries.isError, undefined);
    assert.deepEqual((recoveries.structuredContent as { recoveries: unknown[] }).recoveries, []);
  } finally {
    await client.close();
    await server.close();
  }
});
