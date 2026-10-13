import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createOwnerHailuo02T2vProfile } from "../src/application/owner-hailuo02-t2v-profile.js";
import {
  SYNTX_OWNER_HAILUO02_T2V_TOOL_NAMES,
  SYNTX_OWNER_GET_HAILUO02_T2V_SOURCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_HAILUO02_T2V_TOOL_NAME,
  registerSyntxOwnerHailuo02T2vTools
} from "../src/mcp/owner-hailuo02-t2v-tools.js";

test("Hailuo 02 MCP exposes four tools, source pins, and rejects unreviewed generation inputs", async () => {
  const profile = createOwnerHailuo02T2vProfile(resolve(process.cwd(), "catalog"));
  let generateCalls = 0;
  const server = new McpServer({ name: "hailuo02-tools-test", version: "1.0.0" });
  registerSyntxOwnerHailuo02T2vTools(server, { service: {
    getParametersSource: () => profile.source,
    async generate() { generateCalls += 1; throw new Error("unexpected generate"); },
    async reconcile() { throw new Error("unexpected reconcile"); },
    listRecoveries: () => []
  } as never });
  const client = new Client({ name: "hailuo02-tools-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...SYNTX_OWNER_HAILUO02_T2V_TOOL_NAMES].sort());
    const source = await client.callTool({ name: SYNTX_OWNER_GET_HAILUO02_T2V_SOURCE_TOOL_NAME, arguments: {} });
    assert.equal(source.isError, undefined);
    assert.equal((source.structuredContent as { identity: { model_id: string } }).identity.model_id, "hailuo-02");
    const invalid = await client.callTool({ name: SYNTX_OWNER_GENERATE_HAILUO02_T2V_TOOL_NAME, arguments: {
      link_attempt_id: "link_hailuo02_tools_test_0001", prompt: "A yellow duck.", resolution: "512p", video_duration: 6
    } });
    assert.equal(invalid.isError, true);
    assert.equal(generateCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});
