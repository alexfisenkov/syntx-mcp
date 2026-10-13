import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SYNTX_OWNER_SEEDANCE20_T2V_TOOL_NAMES } from "../src/mcp/owner-seedance20-t2v-tools.js";

test("Seedance20 mini is default-off and its opted-in source/invalid request/lifecycle use no network", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; throw new Error("Unexpected network"); };
  const disabled = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(disabled.serverOptions.ownerSeedance20T2v, undefined);
  disabled.authStore.close?.();
  const runtime = createObservedOwnerRuntime({ ownerSeedance20T2vEnabled: true, fetchImpl });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "seedance20-composition", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of SYNTX_OWNER_SEEDANCE20_T2V_TOOL_NAMES) assert.equal(names.filter((x) => x === name).length, 1);
    const source = await client.callTool({ name: SYNTX_OWNER_SEEDANCE20_T2V_TOOL_NAMES[0], arguments: {} });
    assert.notEqual(source.isError, true);
    const invalid = await client.callTool({ name: SYNTX_OWNER_SEEDANCE20_T2V_TOOL_NAMES[1], arguments: {
      link_attempt_id: "link_seedance20_composition_0123456789", prompt: "synthetic", resolution: "480p", aspect_ratio: "16:9",
      video_duration: 4, generate_audio: false, mode: "pro"
    } });
    assert.equal(invalid.isError, true);
    await runtime.ownerSeedance20T2vLifecycle?.close();
    assert.throws(() => runtime.serverOptions.ownerSeedance20T2v!.generationService.generate({
      attemptId: "link_seedance20_composition_0123456789", prompt: "synthetic", resolution: "480p", aspect_ratio: "16:9",
      video_duration: 4, generate_audio: false
    }), { code: "SERVICE_CLOSED" });
    assert.equal(calls, 0);
  } finally {
    await runtime.ownerSeedance20T2vLifecycle?.close();
    await client.close(); await server.close(); runtime.authStore.close?.();
  }
});
