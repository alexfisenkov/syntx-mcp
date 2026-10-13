import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createDefaultApplication } from "../src/application/factory.js";

test("owner upload tool is registered only when explicitly composed and returns a redacted receipt", async () => {
  const server = createMcpServer(createDefaultApplication(), {
    uploadFile: {
      catalog: { getModel: (id: string) => ({ id, active: true, ai_name: "x", upstream_id: id }) } as never,
      resolveClient: () => ({ uploadFile: async () => ({ file_id: "42", mime_type: "image/png", size: 4, status: "accepted" }) } as never)
    }
  });
  const client = new Client({ name: "upload-tool", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name: "syntx_upload_file", arguments: {
    link_attempt_id: "link_12345678901234567890",
    model_id: "uni-1", filename: "x.png", mime_type: "image/png",
    content_base64: "iVBORw=="
  }});
  assert.deepEqual(result.structuredContent, { status: "accepted", file_id: "42", mime_type: "image/png", size: 4 });
  assert.equal(JSON.stringify(result).includes("url"), false);
  await client.close(); await server.close();
});

test("upload tool is not in default server", async () => {
  const server = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "upload-tool-default", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = await client.listTools();
  assert.equal(tools.tools.some((tool) => tool.name === "syntx_upload_file"), false);
  await client.close(); await server.close();
});
