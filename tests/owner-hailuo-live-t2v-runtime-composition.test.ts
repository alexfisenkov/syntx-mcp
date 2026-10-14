import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SYNTX_OWNER_HAILUO_LIVE_T2V_TOOL_NAMES } from "../src/mcp/owner-hailuo-live-t2v-tools.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

test("Hailuo Live is default-off and its four SDK tools expose the fixed source pair without network", async () => {
  let networkCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    networkCalls += 1;
    throw new Error("Unexpected network request in composition test");
  };
  const catalogDirectory = resolve(process.cwd(), "catalog");
  const disabled = createObservedOwnerRuntime({ catalogDirectory, fetchImpl });
  assert.equal(disabled.serverOptions.ownerHailuoLiveT2v, undefined);
  const disabledServer = createMcpServer(disabled.application, disabled.serverOptions);
  const disabledClient = new Client({ name: "hailuo-live-runtime-disabled", version: "1.0.0" });
  const [disabledClientTransport, disabledServerTransport] = InMemoryTransport.createLinkedPair();
  try {
    await disabledServer.connect(disabledServerTransport);
    await disabledClient.connect(disabledClientTransport);
    assert.equal((await disabledClient.listTools()).tools.some((tool) => SYNTX_OWNER_HAILUO_LIVE_T2V_TOOL_NAMES.includes(tool.name as never)), false);
  } finally {
    await disabledClient.close();
    await disabledServer.close();
    disabled.authStore.close?.();
  }

  const runtime = createObservedOwnerRuntime({ ownerHailuoLiveT2vEnabled: true, catalogDirectory, fetchImpl });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "hailuo-live-runtime-composition", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools;
    for (const name of SYNTX_OWNER_HAILUO_LIVE_T2V_TOOL_NAMES) assert.equal(tools.filter((tool) => tool.name === name).length, 1);
    assert.deepEqual(tools.filter((tool) => SYNTX_OWNER_HAILUO_LIVE_T2V_TOOL_NAMES.includes(tool.name as never))
      .map((tool) => tool.annotations?.readOnlyHint), [true, false, true, true]);
    const source = await client.callTool({ name: SYNTX_OWNER_HAILUO_LIVE_T2V_TOOL_NAMES[0], arguments: {} });
    assert.notEqual(source.isError, true);
    const output = source.structuredContent as {
      identity?: { model_id?: string; ai_name?: string; model_type?: string };
      controls?: { resolution?: { values?: string[] }; video_duration?: { values?: number[] } };
      defaults?: string; runtime_usable?: boolean; dispatch_allowed?: boolean; backend_acceptance?: string;
    } | undefined;
    assert.deepEqual(output?.identity, {
      model_id: "hailuo-01-live", ai_name: "hailuo-minimax", model_type: "hailuo-01-live", operation_id: "generate-video"
    });
    assert.deepEqual(output?.controls?.resolution?.values, ["720p"]);
    assert.deepEqual(output?.controls?.video_duration?.values, [6]);
    assert.equal(output?.defaults, "UNKNOWN");
    assert.equal(output?.runtime_usable, false);
    assert.equal(output?.dispatch_allowed, false);
    assert.equal(output?.backend_acceptance, "UNPROVEN");

    const valid = { link_attempt_id: "link_hailuo_live_runtime_invalid_001", prompt: "Synthetic invalid-pair probe.",
      resolution: "720p", video_duration: 6 };
    for (const invalid of [
      { ...valid, resolution: "768p" }, { ...valid, video_duration: 10 },
      { ...valid, aspect_ratio: "16:9" }, { ...valid, file_urls: [] }
    ]) {
      const result = await client.callTool({ name: SYNTX_OWNER_HAILUO_LIVE_T2V_TOOL_NAMES[1], arguments: invalid });
      assert.equal(result.isError, true);
    }
    assert.equal(networkCalls, 0);
  } finally {
    await runtime.ownerHailuoLiveT2vLifecycle?.close();
    await client.close();
    await server.close();
    runtime.authStore.close?.();
  }
});

test("Hailuo Live opt-in accepts only 1 and conflicts with durable generation", async () => {
  const saved = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_HAILUO_LIVE_T2V = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_HAILUO_LIVE_T2V configuration/u);
    process.env.SYNTX_OWNER_HAILUO_LIVE_T2V = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

test("Hailuo Live lifecycle drains before auth release on owner stdio EOF", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { async start() {}, async send() {}, async close() {} } as unknown as Transport;
  let networkCalls = 0;
  const runtime = createObservedOwnerRuntime({ ownerHailuoLiveT2vEnabled: true,
    fetchImpl: async () => { networkCalls += 1; throw new Error("Synthetic EOF cleanup must not use network"); } });
  const lifecycle = runtime.ownerHailuoLiveT2vLifecycle;
  assert.ok(lifecycle);
  const grokLifecycleProbe = { async close() { events.push("grok.lifecycle.close"); } };
  const liveLifecycleProbe = { async close() { events.push("hailuo-live.lifecycle.close"); await lifecycle.close(); } };
  const args: unknown[] = [transport, undefined, undefined, undefined, undefined,
    () => { events.push("auth.close"); }, input];
  args.push(...Array.from({ length: 28 }, () => undefined), grokLifecycleProbe, liveLifecycleProbe);
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
  try {
    await close();
    assert.deepEqual(events, ["grok.lifecycle.close", "hailuo-live.lifecycle.close", "auth.close"]);
    assert.throws(() => runtime.serverOptions.ownerHailuoLiveT2v!.generationService.generate({
      attemptId: "link_hailuo_live_runtime_eof_0001", prompt: "Synthetic closed service check.", resolution: "720p", video_duration: 6
    }), { code: "SERVICE_CLOSED" });
    assert.equal(networkCalls, 0);
  } finally {
    await lifecycle.close();
    input.destroy();
    runtime.authStore.close?.();
  }
});
