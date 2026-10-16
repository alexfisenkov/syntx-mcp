import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_KLING4_TOOL_NAMES } from "../src/mcp/owner-kling4-tools.js";
import { runObservedOwnerStdioServer, closeOwnerReadServicesOnTransportEof } from "../src/transports/stdio-owner.js";

test("K4 observed runtime registers exactly six opt-in SDK tools without auth/network", async () => {
  for (const enabled of [false, true]) {
    let calls = 0;
    const runtime = createObservedOwnerRuntime({ ownerKling4Enabled: enabled, ownerKling4FfprobePath: process.execPath,
      ownerKling4MaxVideoFileBytes: 2048, catalogDirectory: resolve("catalog"),
      fetchImpl: async () => { calls++; throw new Error("Unexpected network in local runtime registration"); } });
    const server = createMcpServer(runtime.application, runtime.serverOptions);
    const client = new Client({ name: "k4-runtime2150", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(ct), server.connect(st)]);
      const names = (await client.listTools()).tools.map(x => x.name);
      assert.deepEqual(names.filter(name => (OWNER_KLING4_TOOL_NAMES as readonly string[]).includes(name)), enabled ? OWNER_KLING4_TOOL_NAMES : []);
      assert.equal(names.includes("syntx_owner_generate_kling_keyframes"), false);
      if (enabled) {
        for (const model_id of ["kling_4_keyframes", "kling_4_omni"]) {
          const value = await client.callTool({ name: OWNER_KLING4_TOOL_NAMES[0], arguments: { model_id } });
          assert.notEqual(value.isError, true);
          assert.equal((value.structuredContent as { local_policy: { max_video_file_bytes: number } }).local_policy.max_video_file_bytes, 2048);
        }
      }
      assert.equal(calls, 0);
    } finally {
      await runtime.ownerKling4Lifecycle?.close();
      await Promise.allSettled([client.close(), server.close()]); runtime.authStore.close?.();
    }
  }
});

test("K4 stdio rejects malformed flag, missing operator probe and durable conflict before linking", async () => {
  const saved = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith("SYNTX_OWNER_")) delete process.env[key];
    process.env.SYNTX_OWNER_KLING4 = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_KLING4 configuration/u);
    process.env.SYNTX_OWNER_KLING4 = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_KLING4 operator configuration/u);
    process.env.SYNTX_OWNER_KLING4_FFPROBE_PATH = process.execPath;
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const key of Object.keys(process.env)) if (key.startsWith("SYNTX_OWNER_")) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("K4 lifecycle closes before auth release in the existing Kling cleanup slot", async () => {
  const runtime = createObservedOwnerRuntime({ ownerKling4Enabled: true, ownerKling4FfprobePath: process.execPath,
    catalogDirectory: resolve("catalog"), fetchImpl: async () => { throw new Error("Unexpected network"); } });
  assert.ok(runtime.ownerKling4Lifecycle);
  const events: string[] = [], input = new PassThrough();
  const transport = { async start() {}, async send() {}, async close() {} } as unknown as Transport;
  const args: unknown[] = [transport, undefined, undefined, undefined, undefined, () => { events.push("auth.close"); }, input];
  // Existing API's Kling Keyframes lifecycle slot, also used by the real stdio combination.
  args.push(...Array.from({ length: 36 }, () => undefined), { async close() { events.push("k4.close"); await runtime.ownerKling4Lifecycle!.close(); } });
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
  try {
    await close(); await close();
    assert.deepEqual(events, ["k4.close", "auth.close"]);
    await assert.rejects(runtime.serverOptions.ownerKling4!.referenceService.uploadReference({}),
      (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "SERVICE_CLOSED");
  } finally { await runtime.ownerKling4Lifecycle.close(); input.destroy(); runtime.authStore.close?.(); }
});
