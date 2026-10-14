import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SYNTX_OWNER_VEO_T2V_TOOL_NAMES } from "../src/mcp/owner-veo-t2v-tools.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

test("Veo T2V is default-off and source tools expose all three exact models without network", async () => {
  let networkCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    networkCalls += 1;
    throw new Error("Unexpected network request in composition test");
  };
  const catalogDirectory = resolve(process.cwd(), "catalog");
  const disabled = createObservedOwnerRuntime({ catalogDirectory, fetchImpl });
  assert.equal(disabled.serverOptions.ownerVeoT2v, undefined);
  disabled.authStore.close?.();

  const runtime = createObservedOwnerRuntime({ ownerVeoT2vEnabled: true, catalogDirectory, fetchImpl });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "veo-runtime-composition", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of SYNTX_OWNER_VEO_T2V_TOOL_NAMES) {
      assert.equal(listed.filter((listedName) => listedName === name).length, 1);
    }
    for (const model_id of ["veo3", "veo3fast", "veo3fast_r"] as const) {
      const source = await client.callTool({ name: SYNTX_OWNER_VEO_T2V_TOOL_NAMES[0], arguments: { model_id } });
      assert.notEqual(source.isError, true);
      const output = source.structuredContent as unknown as { identity?: { model_id?: string }; runtime_usable?: boolean } | undefined;
      assert.equal(output?.identity?.model_id, model_id);
      assert.equal(output?.runtime_usable, false);
    }
    for (const upscale of ["1080p", 3]) {
      const rejected = await client.callTool({
        name: SYNTX_OWNER_VEO_T2V_TOOL_NAMES[1],
        arguments: {
          link_attempt_id: "link_veo_runtime_rejected_0000001",
          model_id: "veo3",
          prompt: "synthetic invalid input",
          upscale,
          aspect_ratio: "16:9",
          video_duration: 8
        }
      });
      assert.equal(rejected.isError, true);
    }
    assert.equal(networkCalls, 0);
  } finally {
    await runtime.ownerVeoT2vLifecycle?.close();
    await client.close();
    await server.close();
    runtime.authStore.close?.();
  }
});

test("Veo opt-in accepts only 1 and joins the durable-generation legacy conflict", async () => {
  const saved = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_VEO_T2V = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_VEO_T2V configuration/u);
    process.env.SYNTX_OWNER_VEO_T2V = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

test("Veo lifecycle drains before auth release on owner stdio EOF", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { async start() {}, async send() {}, async close() {} } as unknown as Transport;
  const runtime = createObservedOwnerRuntime({ ownerVeoT2vEnabled: true,
    fetchImpl: async () => { throw new Error("Synthetic EOF cleanup must not use network"); } });
  const lifecycle = runtime.ownerVeoT2vLifecycle;
  assert.ok(lifecycle);
  const lifecycleProbe = { async close() { events.push("veo.lifecycle.close"); await lifecycle.close(); } };
  const args: unknown[] = [transport, undefined, undefined, undefined, undefined,
    () => { events.push("auth.close"); }, input];
  args.push(...Array.from({ length: 28 }, () => undefined), lifecycleProbe);
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
  try {
    await close();
    assert.deepEqual(events, ["veo.lifecycle.close", "auth.close"]);
    assert.throws(() => runtime.serverOptions.ownerVeoT2v!.generationService.generate({
      model_id: "veo3", attemptId: "link_veo_runtime_eof_0000000001", prompt: "synthetic close check",
      upscale: 0, aspect_ratio: "16:9", video_duration: 8
    }), { code: "SERVICE_CLOSED" });
  } finally {
    await lifecycle.close();
    input.destroy();
    runtime.authStore.close?.();
  }
});
