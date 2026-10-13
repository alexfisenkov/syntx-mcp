import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";

test("settings evidence is a default read-only, offline surface", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(createDefaultApplication());
  await server.connect(serverTransport);
  const client = new Client({ name: "settings-evidence-test", version: "1" });
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    const tool = listed.tools.find((entry) => entry.name === "syntx_get_settings_evidence");
    assert.equal(tool?.annotations?.readOnlyHint, true);
    const result = await client.callTool({ name: "syntx_get_settings_evidence", arguments: { form_id: "seedream" } });
    assert.equal(result.isError, undefined);
    const value = result.structuredContent as Record<string, unknown>;
    assert.equal(value.network_access, false);
    assert.equal(value.paid_operations, false);
    const results = value.results as Array<Record<string, unknown>>;
    assert.equal(results.length, 1);
    assert.equal(results[0]?.form_id, "seedream");
    assert.equal(results[0]?.runtime_usable, false);
    assert.match(String(results[0]?.census_artifact_sha256), /^sha256:[a-f0-9]{64}$/u);
    assert.match(String(results[0]?.public_catalog_sha256), /^sha256:[a-f0-9]{64}$/u);
    assert.match(String(results[0]?.source_inventory_sha256), /^sha256:[a-f0-9]{64}$/u);
  } finally {
    await client.close();
    await server.close();
  }
});

test("settings evidence index returns the complete current form set", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(createDefaultApplication());
  await server.connect(serverTransport);
  const client = new Client({ name: "settings-evidence-index-test", version: "1" });
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: "syntx_get_settings_evidence", arguments: {} });
    assert.equal(result.isError, undefined);
    const value = result.structuredContent as { results: Array<Record<string, unknown>> };
    assert.equal(value.results.length, 23);
    assert.equal(new Set(value.results.map((entry) => entry.form_id)).size, 23);
    for (const entry of value.results) {
      assert.match(String(entry.census_artifact_sha256), /^sha256:[a-f0-9]{64}$/u);
      assert.equal(entry.runtime_usable, false);
    }
  } finally {
    await client.close();
    await server.close();
  }
});
