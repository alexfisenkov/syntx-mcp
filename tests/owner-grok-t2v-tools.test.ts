import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  SYNTX_OWNER_GROK_T2V_TOOL_NAMES,
  registerSyntxOwnerGrokT2vTools
} from "../src/mcp/owner-grok-t2v-tools.js";
import { OWNER_GROK_T2V_CONTRACT_VARIANT_ID, createOwnerGrokT2vProfile } from "../src/application/owner-grok-t2v-profile.js";
import { OwnerReviewedNoReferenceT2vServiceError } from "../src/application/owner-reviewed-no-reference-t2v-service.js";

const ATTEMPT = "link_grok_t2v_tools_attempt_0001";
const RECOVERY = "recovery_00000000-0000-4000-8000-000000000001";

test("Grok T2V tools expose one source, strict generation, and GET-only recovery operations", async () => {
  const profile = createOwnerGrokT2vProfile("catalog");
  const calls: Array<{ method: string; input: unknown }> = [];
  let unknown = true;
  const service = {
    getParametersSource() { calls.push({ method: "source", input: {} }); return profile.source; },
    getReviewedContract() { return profile.registry.contracts[0]!; },
    async generate(input: unknown) { calls.push({ method: "generate", input }); if (unknown) throw new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", RECOVERY); return { status: "reviewed" as const, confidence_scope: "exact_result_only" as const, model_id: "grok_t2v" as const, operation_id: "generate-video" as const, modality: "video" as const, variant_id: OWNER_GROK_T2V_CONTRACT_VARIANT_ID, artifacts: [] }; },
    async reconcile(input: unknown) { calls.push({ method: "reconcile", input }); return { status: "reviewed" as const, confidence_scope: "exact_result_only" as const, model_id: "grok_t2v" as const, operation_id: "generate-video" as const, modality: "video" as const, variant_id: OWNER_GROK_T2V_CONTRACT_VARIANT_ID, artifacts: [] }; },
    listRecoveries(attemptId: string, limit = 20) { calls.push({ method: "list", input: { attemptId, limit } }); return [{ recovery_id: RECOVERY, model_id: "grok_t2v" as const, operation_id: "generate-video" as const, variant_id: OWNER_GROK_T2V_CONTRACT_VARIANT_ID, created_at: new Date().toISOString() }].slice(0, limit); },
    async invalidateAttempt() {}, async close() {}
  };
  const server = new McpServer({ name: "grok-t2v-test", version: "1" });
  registerSyntxOwnerGrokT2vTools(server, { service });
  const client = new Client({ name: "grok-t2v-test-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), SYNTX_OWNER_GROK_T2V_TOOL_NAMES);
    assert.deepEqual(tools.tools.map((tool) => tool.annotations?.readOnlyHint), [true, false, true, true]);
    const source = await client.callTool({ name: SYNTX_OWNER_GROK_T2V_TOOL_NAMES[0], arguments: {} }) as CallToolResult;
    assert.equal(source.isError, undefined);
    const sourceValue = source.structuredContent as { identity: { model_id: string; ai_name: string } };
    assert.deepEqual(sourceValue.identity, { model_id: "grok_t2v", ai_name: "grok_video", model_type: "grok_t2v", operation_id: "generate-video" });
    assert.equal((await client.callTool({ name: SYNTX_OWNER_GROK_T2V_TOOL_NAMES[0], arguments: { model_id: "grok_t2v" } })).isError, true);

    const base = { link_attempt_id: ATTEMPT, prompt: "A red paper boat crossing a moonlit pond.", aspect_ratio: "1:1", resolution: "720p", video_duration: 8 };
    const unknownResult = await client.callTool({ name: SYNTX_OWNER_GROK_T2V_TOOL_NAMES[1], arguments: base }) as CallToolResult;
    assert.equal(unknownResult.isError, true);
    assert.match(unknownResult.content[0]?.type === "text" ? unknownResult.content[0].text : "", /OUTCOME_UNKNOWN/u);
    assert.equal((await client.callTool({ name: SYNTX_OWNER_GROK_T2V_TOOL_NAMES[1], arguments: { ...base, model_id: "grok_t2v" } })).isError, true);
    assert.equal((await client.callTool({ name: SYNTX_OWNER_GROK_T2V_TOOL_NAMES[1], arguments: { ...base, video_duration: 8.5 } })).isError, true);
    const reconciled = await client.callTool({ name: SYNTX_OWNER_GROK_T2V_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, recovery_id: RECOVERY } }) as CallToolResult;
    assert.equal(reconciled.isError, undefined);
    const listed = await client.callTool({ name: SYNTX_OWNER_GROK_T2V_TOOL_NAMES[3], arguments: { link_attempt_id: ATTEMPT, limit: 1 } }) as CallToolResult;
    assert.equal(listed.isError, undefined);
    assert.deepEqual(calls.filter((call) => call.method === "generate")[0]?.input, { attemptId: ATTEMPT, prompt: base.prompt, aspect_ratio: "1:1", resolution: "720p", video_duration: 8 });
    assert.deepEqual(calls.find((call) => call.method === "reconcile")?.input, { attemptId: ATTEMPT, recovery_id: RECOVERY });
    assert.equal(unknown, true, "the tool must not repeat a generation after an unknown outcome");
  } finally {
    await client.close(); await server.close();
  }
});
