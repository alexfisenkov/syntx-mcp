import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { RemoteOwnerStdioBridge, type RemoteOwnerChildPort } from "../src/runtime/remote-owner-stdio-bridge.js";

const read: Tool = { name: "syntx_fake_read", description: "Read reference", inputSchema: { type: "object", properties: { handle: { type: "string" } } },
  outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
  annotations: { readOnlyHint: true, idempotentHint: true }, _meta: { "test/metadata": "preserved" } };
const paid: Tool = { name: "syntx_fake_generate", inputSchema: { type: "object" }, annotations: { readOnlyHint: false } };
const local: Tool = { name: "syntx_upload_standard_image_reference_file", inputSchema: { type: "object", properties: { absolute_path: { type: "string" } } } };
function fake(overrides: Partial<RemoteOwnerChildPort> = {}): RemoteOwnerChildPort {
  return { async listTools() { return { tools: [read, paid, local, { name: "syntx_update_apply", inputSchema: { type: "object" } }] }; },
    async listResources() { return { resources: [{ name: "private", uri: "file:///private/profile" }, { name: "guide", uri: "syntx://maintenance/skill" }] }; },
    async readResource(uri) { return { contents: [{ uri, text: "guide" }] }; },
    async callTool() { return { content: [{ type: "text", text: "value" }], structuredContent: { value: "reference-value" }, _meta: { "test/result": true } }; },
    async close() {}, ...overrides };
}
async function session(bridge: RemoteOwnerStdioBridge) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const wireResults: Record<string, unknown>[] = [];
  const send = serverTransport.send.bind(serverTransport);
  serverTransport.send = async (message) => { if ("result" in message) wireResults.push(message.result); await send(message); };
  const server = bridge.createServer(); const client = new Client({ name: "private-owner-test", version: "1" });
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client, wireResults, close: async () => { await client.close(); await server.close(); } };
}

test("remote bridge preserves schemas, metadata and raw results across two sessions while hiding local tools/resources", async () => {
  let starts = 0, closes = 0, calls = 0;
  const bridge = new RemoteOwnerStdioBridge(async () => { starts++; return fake({ async callTool() { calls++; return { content: [{ type: "text", text: "raw" },
    { type: "resource_link", uri: "https://media.example/image.png", name: "image" }], structuredContent: { value: "persisted-handle" }, _meta: { "test/result": true } }; }, async close() { closes++; } }); });
  assert.equal(starts, 0);
  const first = await session(bridge);
  try {
    const list = await first.client.listTools(); assert.deepEqual(list.tools.map((tool) => tool.name), [read.name, paid.name]);
    const tool = list.tools[0]!;
    assert.deepEqual(tool.inputSchema, read.inputSchema); assert.deepEqual(tool.outputSchema, read.outputSchema); assert.deepEqual(tool.annotations, read.annotations);
    assert.equal(tool._meta?.["test/metadata"], "preserved");
    assert.deepEqual(tool._meta?.securitySchemes, [{ type: "oauth2", scopes: ["syntx:owner"] }]);
    // The SDK Client strips extension fields at Tool's top level; verify the actual wire result too.
    const rawTools = first.wireResults.find((result) => Array.isArray(result.tools))!.tools as Record<string, unknown>[];
    assert.deepEqual(rawTools[0]!.securitySchemes, tool._meta?.securitySchemes);
    const result = await first.client.callTool({ name: read.name, arguments: { handle: "owned" } });
    assert.deepEqual(result.structuredContent, { value: "persisted-handle" }); assert.deepEqual(result._meta, { "test/result": true });
    assert.equal((result.content as Array<{ type: string }>)[1]!.type, "resource_link");
    const hidden = await first.client.callTool({ name: local.name, arguments: { absolute_path: "/private/profile" } });
    assert.equal(hidden.isError, true); assert.equal(calls, 1);
    const resources = await first.client.listResources(); assert.deepEqual(resources.resources.map((r) => r.uri), ["syntx://maintenance/skill"]);
    await assert.rejects(first.client.readResource({ uri: "file:///private/profile" }));
  } finally { await first.close(); }
  assert.equal(closes, 0);
  const second = await session(bridge);
  try { assert.deepEqual((await second.client.callTool({ name: read.name, arguments: { handle: "owned" } })).structuredContent, { value: "persisted-handle" }); }
  finally { await second.close(); await bridge.close(); }
  assert.equal(starts, 1); assert.equal(closes, 1); assert.equal(calls, 2);
});

test("remote bridge never retries unknown paid calls and still allows read-only reconciliation", async () => {
  let paidCalls = 0, reads = 0;
  const bridge = new RemoteOwnerStdioBridge(async () => fake({ async callTool(name) {
    if (name === paid.name) { paidCalls++; throw new Error("secret-private-provider-message"); }
    reads++; return { content: [{ type: "text", text: "reconciled" }] };
  } }));
  try {
    const first = await bridge.callTool(paid.name); assert.equal(first.isError, true); assert.match(JSON.stringify(first), /OUTCOME_UNKNOWN/u);
    assert.equal(JSON.stringify(first).includes("secret-private"), false);
    const second = await bridge.callTool(paid.name); assert.equal(second.isError, true); assert.equal(paidCalls, 1);
    assert.equal((await bridge.callTool(read.name)).isError, undefined); assert.equal(reads, 1);
  } finally { await bridge.close(); }
});

test("remote bridge bounds simultaneous file/tool calls to two and drains before child EOF", async () => {
  let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
  let entered = 0, closed = false;
  const bridge = new RemoteOwnerStdioBridge(async () => fake({ async callTool() { entered++; await barrier; return { content: [] }; }, async close() { closed = true; } }));
  await bridge.listTools();
  const one = bridge.callTool(paid.name), two = bridge.callTool(read.name);
  for (let i = 0; entered < 2 && i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(entered, 2);
  assert.match(JSON.stringify(await bridge.callTool(read.name)), /REMOTE_OWNER_BUSY/u);
  const closing = bridge.close(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(closed, false);
  release(); await Promise.all([one, two, closing]); assert.equal(closed, true);
  await bridge.close();
});

test("remote bridge child loss fails closed without respawn and an unused bridge closes without spawning", async () => {
  let starts = 0, onLost!: () => void;
  const bridge = new RemoteOwnerStdioBridge(async (lost) => { starts++; onLost = lost; return fake(); });
  await bridge.ready(); onLost(); await assert.rejects(bridge.ready()); await assert.rejects(bridge.listTools()); assert.equal(starts, 1); await bridge.close();
  const unused = new RemoteOwnerStdioBridge(async () => { starts++; return fake(); }); await unused.close(); assert.equal(starts, 1);
});

test("remote bridge pagination never advertises a future local execution tool under another name", async () => {
  const bridge = new RemoteOwnerStdioBridge(async () => fake({ async listTools(cursor) {
    return cursor ? { tools: [{ name: "syntx_future_local", inputSchema: { type: "object", properties: { nested: { type: "object", properties: { command: { type: "string" } } } } } }, read] }
      : { tools: [paid], nextCursor: "page2" };
  } }));
  try { assert.deepEqual((await bridge.listTools()).map((tool) => tool.name), [paid.name, read.name]); assert.equal((await bridge.callTool("syntx_future_local")).isError, true); }
  finally { await bridge.close(); }
});
