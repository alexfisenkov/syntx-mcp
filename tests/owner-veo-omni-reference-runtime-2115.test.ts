import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES } from "../src/mcp/owner-veo-omni-reference-tools.js";
import { runObservedOwnerStdioServer, closeOwnerReadServicesOnTransportEof } from "../src/transports/stdio-owner.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

test("Omni reference runtime opts in six SDK tools without network and keeps T2V independent", async () => {
  for (const enabled of [false, true]) {
    let networkCalls = 0;
    const runtime = createObservedOwnerRuntime({
      ...{ ownerVeoOmniReferencesEnabled: enabled, ownerVeoOmniReferencesFfprobePath: process.execPath, ownerVeoOmniReferencesMaxFileBytes: 1024 },
      catalogDirectory: resolve(process.cwd(), "catalog"), fetchImpl: async () => { networkCalls++; throw new Error("Unexpected network"); }
    });
    const server = createMcpServer(runtime.application, runtime.serverOptions);
    const client = new Client({ name: "omni-reference-runtime2115", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(st), client.connect(ct)]);
      const names = (await client.listTools()).tools.map(({ name }) => name);
      assert.deepEqual(names.filter((name) => (OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES as readonly string[]).includes(name)),
        enabled ? OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES : []);
      assert.equal(names.includes("syntx_owner_generate_veo_omni_t2v"), false);
      if (enabled) {
        const source = await client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[0], arguments: {} });
        assert.notEqual(source.isError, true);
        assert.equal((source.structuredContent as { local_policy: { max_file_bytes: number } }).local_policy.max_file_bytes, 1024);
      }
      assert.equal(networkCalls, 0);
    } finally {
      await (runtime as unknown as { ownerVeoOmniReferencesLifecycle?: { close(): Promise<void> } }).ownerVeoOmniReferencesLifecycle?.close();
      await Promise.allSettled([client.close(), server.close()]); runtime.authStore.close?.();
    }
  }
});

test("Omni reference stdio rejects invalid flag, missing probe and durable combination before input/auth", async () => {
  const saved = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith("SYNTX_OWNER_")) delete process.env[key];
    process.env.SYNTX_OWNER_VEO_OMNI_REFERENCES = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_VEO_OMNI_REFERENCES configuration/u);
    process.env.SYNTX_OWNER_VEO_OMNI_REFERENCES = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_VEO_OMNI_REFERENCES operator configuration/u);
    process.env.SYNTX_OWNER_VEO_OMNI_REFERENCES_FFPROBE_PATH = process.execPath;
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const key of Object.keys(process.env)) if (key.startsWith("SYNTX_OWNER_")) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("Omni reference lifecycle drains the Veo stdio slot before auth release and closes once", async () => {
  const runtime = createObservedOwnerRuntime({ ownerVeoOmniReferencesEnabled: true, ownerVeoOmniReferencesFfprobePath: process.execPath,
    catalogDirectory: resolve(process.cwd(), "catalog"), fetchImpl: async () => { throw new Error("Unexpected network"); } });
  const lifecycle = (runtime as unknown as { ownerVeoOmniReferencesLifecycle?: { close(): Promise<void> } }).ownerVeoOmniReferencesLifecycle;
  assert.ok(lifecycle);
  const events: string[] = [], input = new PassThrough();
  const transport = { async start() {}, async send() {}, async close() {} } as unknown as Transport;
  const args: unknown[] = [transport, undefined, undefined, undefined, undefined, () => { events.push("auth.close"); }, input];
  args.push(...Array.from({ length: 28 }, () => undefined), { async close() { events.push("refs.close"); await lifecycle.close(); } });
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
  try {
    await close(); await close();
    assert.deepEqual(events, ["refs.close", "auth.close"]);
    await assert.rejects(runtime.serverOptions.ownerVeoOmniReferences!.referenceService.uploadReference({}),
      (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "SERVICE_CLOSED");
  } finally { await lifecycle.close(); input.destroy(); runtime.authStore.close?.(); }
});
