import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SYNTX_OWNER_KLING_T2V_TOOL_NAMES } from "../src/mcp/owner-kling-t2v-tools.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

test("Kling T2V family is default-off, source-only on opt-in, strict by model, and closes both engines without network", async () => {
  let networkCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    networkCalls += 1;
    throw new Error("Unexpected network request in composition test");
  };
  const catalogDirectory = resolve(process.cwd(), "catalog");
  const disabled = createObservedOwnerRuntime({ catalogDirectory, fetchImpl });
  assert.equal(disabled.serverOptions.ownerKlingT2v, undefined);
  disabled.authStore.close?.();

  const runtime = createObservedOwnerRuntime({
    ownerKlingT2vEnabled: true,
    catalogDirectory,
    fetchImpl
  });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "kling-runtime-composition", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of SYNTX_OWNER_KLING_T2V_TOOL_NAMES) {
      assert.equal(listed.filter((listedName) => listedName === name).length, 1);
    }

    for (const model_id of ["kling_text2video", "kling_o1_text2video"] as const) {
      const source = await client.callTool({
        name: SYNTX_OWNER_KLING_T2V_TOOL_NAMES[0],
        arguments: { model_id }
      });
      assert.notEqual(source.isError, true);
      const sourceOutput = source.structuredContent as unknown as { identity?: { model_id?: string } } | undefined;
      assert.equal(sourceOutput?.identity?.model_id, model_id);
    }

    const wrongFamilyShape = await client.callTool({
      name: SYNTX_OWNER_KLING_T2V_TOOL_NAMES[1],
      arguments: {
        link_attempt_id: "link_kling_runtime_composition_000001",
        model_id: "kling_text2video",
        prompt: "synthetic only",
        mode: "hd",
        aspect_ratio: "16:9",
        video_duration: 5
      }
    });
    assert.equal(wrongFamilyShape.isError, true, "base Kling must not accept the O1-shaped request without its exact base fields");

    await runtime.ownerKlingT2vLifecycle?.close();
    assert.throws(
      () => runtime.serverOptions.ownerKlingT2v!.generationService.generate({
        model_id: "kling_o1_text2video",
        attemptId: "link_kling_runtime_composition_000001",
        prompt: "synthetic only",
        mode: "hd",
        aspect_ratio: "16:9",
        video_duration: 5
      }),
      { code: "SERVICE_CLOSED" }
    );
    assert.equal(networkCalls, 0);
  } finally {
    await runtime.ownerKlingT2vLifecycle?.close();
    await client.close();
    await server.close();
    runtime.authStore.close?.();
  }
});

test("Kling opt-in uses strict 1-only parsing and includes its paid tools in the durable-mode conflict", async () => {
  const saved = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_KLING_T2V = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_KLING_T2V configuration/u);
    process.env.SYNTX_OWNER_KLING_T2V = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

test("Kling lifecycle drains before auth release on owner stdio EOF", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { async start() {}, async send() {}, async close() {} } as unknown as Transport;
  const runtime = createObservedOwnerRuntime({ ownerKlingT2vEnabled: true,
    fetchImpl: async () => { throw new Error("Synthetic EOF cleanup must not use network"); } });
  const lifecycle = runtime.ownerKlingT2vLifecycle;
  assert.ok(lifecycle);
  const lifecycleProbe = { async close() { events.push("kling.lifecycle.close"); await lifecycle.close(); } };
  const args: unknown[] = [transport, undefined, undefined, undefined, undefined,
    () => { events.push("auth.close"); }, input];
  args.push(...Array.from({ length: 27 }, () => undefined), lifecycleProbe);
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
  try {
    await close();
    assert.deepEqual(events, ["kling.lifecycle.close", "auth.close"]);
    assert.throws(() => runtime.serverOptions.ownerKlingT2v!.generationService.generate({
      model_id: "kling_o1_text2video", attemptId: "link_kling_runtime_eof_00000001", prompt: "synthetic",
      mode: "hd", aspect_ratio: "16:9", video_duration: 5
    }), { code: "SERVICE_CLOSED" });
  } finally {
    await lifecycle.close();
    input.destroy();
    runtime.authStore.close?.();
  }
});
