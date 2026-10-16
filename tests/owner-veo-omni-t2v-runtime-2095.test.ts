import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

const NAMES = [
  "syntx_owner_get_veo_omni_t2v_source", "syntx_owner_generate_veo_omni_t2v",
  "syntx_owner_reconcile_veo_omni_t2v", "syntx_owner_list_veo_omni_t2v_recoveries"
];
const makeRuntime = (enabled: boolean) => createObservedOwnerRuntime({
  ...{ ownerVeoOmniT2vEnabled: enabled }, catalogDirectory: resolve(process.cwd(), "catalog"),
  fetchImpl: async () => { throw new Error("Unexpected network request in Omni composition test"); }
});

test("Omni T2V runtime is default-off and exposes four isolated opt-in SDK tools without network", async () => {
  for (const enabled of [false, true]) {
    const runtime = makeRuntime(enabled);
    const server = createMcpServer(runtime.application, runtime.serverOptions);
    const client = new Client({ name: `omni-runtime-${enabled}`, version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = (await client.listTools()).tools.filter(({ name }) => NAMES.includes(name));
      assert.deepEqual(tools.map(({ name }) => name), enabled ? NAMES : []);
      if (enabled) {
        assert.deepEqual(tools.map(({ annotations }) => annotations?.readOnlyHint), [true, false, true, true]);
        const result = await client.callTool({ name: NAMES[0]!, arguments: {} });
        assert.notEqual(result.isError, true);
        assert.deepEqual((result.structuredContent as Record<string, unknown>).identity, {
          model_id: "veo_omni", ai_name: "veo3", model_type: "veo_omni", operation_id: "generate-video"
        });
        assert.equal((result.structuredContent as Record<string, unknown>).dispatch_allowed, false);
      }
    } finally {
      const lifecycle = (runtime as unknown as { ownerVeoOmniT2vLifecycle?: { close(): Promise<void> } }).ownerVeoOmniT2vLifecycle;
      await lifecycle?.close();
      await Promise.allSettled([client.close(), server.close(), clientTransport.close(), serverTransport.close()]);
      runtime.authStore.close?.();
    }
  }
});

test("Omni T2V stdio exact flag rejects other values and conflicts with durable generation", async () => {
  const saved = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith("SYNTX_OWNER_")) delete process.env[key];
    process.env.SYNTX_OWNER_VEO_OMNI_T2V = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_VEO_OMNI_T2V configuration/u);
    process.env.SYNTX_OWNER_VEO_OMNI_T2V = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const key of Object.keys(process.env)) if (key.startsWith("SYNTX_OWNER_")) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("Omni T2V lifecycle drains through the existing stdio Veo slot before auth release", async () => {
  const runtime = makeRuntime(true) as ReturnType<typeof makeRuntime> & {
    ownerVeoOmniT2vLifecycle?: { close(): Promise<void> };
  };
  assert.ok(runtime.ownerVeoOmniT2vLifecycle);
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { async start() {}, async send() {}, async close() {} } as unknown as Transport;
  const args: unknown[] = [transport, undefined, undefined, undefined, undefined,
    () => { events.push("auth.close"); }, input];
  args.push(...Array.from({ length: 28 }, () => undefined), {
    async close() { events.push("omni.close"); await runtime.ownerVeoOmniT2vLifecycle!.close(); }
  });
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
  try {
    await close();
    assert.deepEqual(events, ["omni.close", "auth.close"]);
    await close();
    assert.deepEqual(events, ["omni.close", "auth.close"]);
  } finally {
    await runtime.ownerVeoOmniT2vLifecycle.close();
    input.destroy();
    runtime.authStore.close?.();
  }
});
