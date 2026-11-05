import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createTestHarness } from "./helpers.js";

async function run(reference: string, callback: (client: Client) => Promise<void>): Promise<void> {
  const core = createTestHarness().core, original = core.estimateGeneration.bind(core);
  Object.defineProperty(core, "estimateGeneration", { value: async (...args: Parameters<typeof original>) => {
    const result = await original(...args); return { ...result, approval: { ...result.approval, reference } };
  } });
  const server = createMcpServer(core), client = new Client({ name: "estimate-schema-test", version: "1" });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try { await server.connect(host); await client.connect(caller); await callback(client); }
  finally { await client.close(); await server.close(); }
}
const request = { name: "syntx_estimate_generation", arguments: { model_id: "nano-banana-pro", operation_id: "text-to-image", parameters: { prompt: "synthetic test" } } };
test("estimate SDK schema uses standard prefix pattern and accepts valid reference", async () => {
  await run("urn:syntx-mcp:test-approval:123", async client => {
    const tools = await client.listTools(), tool = tools.tools.find(item => item.name === request.name); assert.ok(tool?.outputSchema);
    const schema = tool.outputSchema as unknown as { properties: { approval: { properties: { reference: { pattern?: string; format?: string } } } } };
    const field = schema.properties.approval.properties.reference;
    assert.equal(field.pattern, "^urn:syntx-mcp:"); assert.equal(field.format, undefined);
    assert.equal(JSON.stringify(tool.outputSchema).includes("starts_with"), false);
    const result = await client.callTool(request); assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal((result.structuredContent as { approval: { reference: string } }).approval.reference, "urn:syntx-mcp:test-approval:123");
  });
});
test("estimate SDK rejects an invalid reference prefix", async () => {
  await run("not-urn:syntx-mcp:test-approval:123", async client => {
    await client.listTools();
    const result = await client.callTool(request); assert.equal(result.isError, true);
  });
});
