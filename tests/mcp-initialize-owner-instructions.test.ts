import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";

test("MCP initialize retains public snapshot boundary and describes owner-native routing", async () => {
  const server=createMcpServer(createDefaultApplication()),client=new Client({name:"instructions-test",version:"1"});
  const [caller,host]=InMemoryTransport.createLinkedPair();
  try {await server.connect(host);await client.connect(caller);const instructions=client.getInstructions();assert.ok(instructions);
    assert.ok(instructions.startsWith("This server exposes a dated official-public SYNTX catalog snapshot. Public records are not account entitlement; paid upstream operations remain fail-closed in the default profile."));
    assert.match(instructions,/syntx_get_media_coverage/);assert.match(instructions,/generic registry availability is separate/);
    assert.match(instructions,/never retry a mutation/);assert.match(instructions,/GET reconciliation/);
  } finally {await client.close();await server.close();}
});
