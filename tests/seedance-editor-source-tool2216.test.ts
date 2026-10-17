import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";

test("default MCP exposes the offline Seedance Editor contract without claiming generation readiness", async () => {
  const server = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "seedance-editor-contract-fixture", version: "1.0.0" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(right);
    await client.connect(left);
    const listed = await client.listTools();
    const tool = listed.tools.find(row => row.name === "syntx_get_seedance_editor_source");
    assert.ok(tool, "source contract tool must be registered in the default server");
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
    });
    const result = await client.callTool({ name: tool.name, arguments: {} });
    assert.notEqual(result.isError, true);
    const output = result.structuredContent as Record<string, unknown>;
    assert.equal(output.network_access, false);
    assert.equal(output.paid_operations, false);
    assert.equal(output.dispatch_allowed, false);
    const profile = output.profile as Record<string, unknown>;
    assert.equal(profile.form_id, "seedance-editor");
    assert.equal(profile.scope, "tool_video_inpaint");
    assert.equal(profile.ai_name, "seedance");
    assert.equal(profile.model_type, "seedance-2.5");
    assert.deepEqual(profile.resolution_values, ["480p", "720p", "1080p"]);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.equal(profile.runtime_usable, false);
    assert.equal(profile.cost_projection, "UNKNOWN");
    assert.deepEqual(JSON.parse((result.content as { type: string; text: string }[])[0]!.text), output);
    const rejected = await client.callTool({ name: tool.name, arguments: { file_urls: ["https://example.invalid/private"] } });
    assert.equal(rejected.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /link_attempt_id|auth_token|access_token|source\.mp4/u);
  } finally {
    await client.close();
    await server.close();
  }
});
