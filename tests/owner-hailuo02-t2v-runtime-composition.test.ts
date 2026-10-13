import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SYNTX_OWNER_HAILUO02_T2V_TOOL_NAMES } from "../src/mcp/owner-hailuo02-t2v-tools.js";
import { runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

test("Hailuo02 owner runtime exposes four tools only when enabled, without startup network", async () => {
  let requests = 0;
  const fetchImpl: typeof fetch = async () => { requests++; throw new Error("Unexpected network"); };
  const disabled = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(disabled.serverOptions.ownerHailuo02T2v, undefined);
  disabled.authStore.close?.();
  const runtime = createObservedOwnerRuntime({ ownerHailuo02T2vEnabled: true, fetchImpl });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "hailuo02-composition", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of SYNTX_OWNER_HAILUO02_T2V_TOOL_NAMES) assert.equal(names.filter((x) => x === name).length, 1);
    const source = await client.callTool({ name: SYNTX_OWNER_HAILUO02_T2V_TOOL_NAMES[0], arguments: {} });
    assert.notEqual(source.isError, true);
    assert.equal((source.structuredContent as { identity: { model_id: string } }).identity.model_id, "hailuo-02");
    const invalid = await client.callTool({ name: SYNTX_OWNER_HAILUO02_T2V_TOOL_NAMES[1], arguments: {
      link_attempt_id: "link_hailuo02_composition_0123456789", prompt: "synthetic", resolution: "1080p", video_duration: 10
    } });
    assert.equal(invalid.isError, true);
    await runtime.ownerHailuo02T2vLifecycle?.close();
    assert.throws(() => runtime.serverOptions.ownerHailuo02T2v!.generationService.generate({
      attemptId: "link_hailuo02_composition_0123456789", prompt: "synthetic", resolution: "768p", video_duration: 6
    }), { code: "SERVICE_CLOSED" });
    assert.equal(requests, 0);
  } finally {
    await runtime.ownerHailuo02T2vLifecycle?.close();
    await client.close(); await server.close(); runtime.authStore.close?.();
  }
});

test("Hailuo02 invalid flag and durable composition conflict fail before stdio attachment", async () => {
  const prior = new Map(Object.entries(process.env).filter(([key]) => key.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith("SYNTX_OWNER_")) delete process.env[key];
    process.env.SYNTX_OWNER_HAILUO02_T2V = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_HAILUO02_T2V configuration/u);
    process.env.SYNTX_OWNER_HAILUO02_T2V = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const key of Object.keys(process.env)) if (key.startsWith("SYNTX_OWNER_")) delete process.env[key];
    for (const [key, value] of prior) process.env[key] = value;
  }
});
