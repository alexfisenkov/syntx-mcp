import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createOwnerHailuoLiveT2vProfile } from "../src/application/owner-hailuo-live-t2v-profile.js";
import type { OwnerReviewedNoReferenceT2vGenerationOutput } from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import {
  SYNTX_OWNER_HAILUO_LIVE_T2V_TOOL_NAMES,
  SYNTX_OWNER_GET_HAILUO_LIVE_T2V_SOURCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_HAILUO_LIVE_T2V_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_HAILUO_LIVE_T2V_TOOL_NAME,
  SYNTX_OWNER_LIST_HAILUO_LIVE_T2V_RECOVERIES_TOOL_NAME,
  registerSyntxOwnerHailuoLiveT2vTools
} from "../src/mcp/owner-hailuo-live-t2v-tools.js";

const ATTEMPT_ID = "link_hailuo_live_tools_test_0001";
const RECOVERY_ID = "recovery_2ea93667-6104-42bd-84ba-3546cd1a64f6";

test("Hailuo Live MCP exposes the fixed source, generation, reconciliation and recovery-list tools", async () => {
  const profile = createOwnerHailuoLiveT2vProfile(resolve(process.cwd(), "catalog"));
  let generateCalls = 0;
  const generateInputs: unknown[] = [];
  const reconcileInputs: unknown[] = [];
  const listInputs: unknown[] = [];
  const result: OwnerReviewedNoReferenceT2vGenerationOutput = {
    status: "reviewed", confidence_scope: "exact_result_only", model_id: "hailuo-01-live",
    operation_id: "generate-video", modality: "video", variant_id: "hailuo-01-live-t2v-source-reviewed-no-reference-720p-6s",
    artifacts: [{ url: "https://r2.syntx.ai/hailuo-live/result.mp4", mime_type: "video/mp4" }]
  };
  const server = new McpServer({ name: "hailuo-live-tools-test", version: "1.0.0" });
  registerSyntxOwnerHailuoLiveT2vTools(server, { service: {
    getParametersSource: () => profile.source,
    async generate(input: unknown) { generateCalls += 1; generateInputs.push(input); return result; },
    async reconcile(input: unknown) { reconcileInputs.push(input); return result; },
    listRecoveries(attemptId: string, limit: number) { listInputs.push({ attemptId, limit }); return []; }
  } as never });
  const client = new Client({ name: "hailuo-live-tools-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(({ name }) => name).sort(), [...SYNTX_OWNER_HAILUO_LIVE_T2V_TOOL_NAMES].sort());
    const generateTool = tools.tools.find(({ name }) => name === SYNTX_OWNER_GENERATE_HAILUO_LIVE_T2V_TOOL_NAME);
    assert.ok(generateTool);
    const schema = generateTool.inputSchema as { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown };
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), ["link_attempt_id", "prompt", "resolution", "video_duration"]);
    assert.deepEqual([...(schema.required ?? [])].sort(), ["link_attempt_id", "prompt", "resolution", "video_duration"]);
    assert.equal(schema.additionalProperties, false);

    const source = await client.callTool({ name: SYNTX_OWNER_GET_HAILUO_LIVE_T2V_SOURCE_TOOL_NAME, arguments: {} });
    assert.equal(source.isError, undefined);
    assert.equal((source.structuredContent as { identity: { model_id: string } }).identity.model_id, "hailuo-01-live");
    assert.equal((source.structuredContent as { no_reference_source: { zero_file_guard_status: string } }).no_reference_source.zero_file_guard_status,
      "NO_LIVE_VALIDATOR_REQUIRES_FILES");

    const invalid = await client.callTool({ name: SYNTX_OWNER_GENERATE_HAILUO_LIVE_T2V_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT_ID, prompt: "A calm lake.", resolution: "720p", video_duration: 6, aspect_ratio: "16:9"
    } });
    assert.equal(invalid.isError, true);
    assert.equal(generateCalls, 0);
    const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_HAILUO_LIVE_T2V_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT_ID, prompt: "A calm lake.", resolution: "720p", video_duration: 6
    } });
    assert.equal(generated.isError, undefined);
    assert.deepEqual(generateInputs, [{ attemptId: ATTEMPT_ID, prompt: "A calm lake.", resolution: "720p", video_duration: 6 }]);

    const recovered = await client.callTool({ name: SYNTX_OWNER_RECONCILE_HAILUO_LIVE_T2V_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT_ID, recovery_id: RECOVERY_ID
    } });
    assert.equal(recovered.isError, undefined);
    assert.deepEqual(reconcileInputs, [{ attemptId: ATTEMPT_ID, recovery_id: RECOVERY_ID }]);
    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_HAILUO_LIVE_T2V_RECOVERIES_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT_ID, limit: 7
    } });
    assert.equal(listed.isError, undefined);
    assert.deepEqual(listInputs, [{ attemptId: ATTEMPT_ID, limit: 7 }]);
  } finally {
    await client.close();
    await server.close();
  }
});
