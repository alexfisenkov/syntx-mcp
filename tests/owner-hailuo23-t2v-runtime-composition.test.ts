import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PassThrough } from "node:stream";
import test from "node:test";
import { OWNER_HAILUO23_T2V_CONTRACT_VARIANT_ID, createOwnerHailuo23T2vProfile } from "../src/application/owner-hailuo23-t2v-profile.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, readOwnerHailuo23T2vFlag, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

const TOOLS = [
  "syntx_owner_get_hailuo23_t2v_source",
  "syntx_owner_generate_hailuo23_t2v",
  "syntx_owner_reconcile_hailuo23_t2v",
  "syntx_owner_list_hailuo23_t2v_recoveries"
] as const;

type Runtime = ReturnType<typeof createObservedOwnerRuntime> & { ownerHailuo23T2vLifecycle?: { close(): Promise<void> } };

async function listTools(runtime: Runtime) {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "hailuo23-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return (await client.listTools()).tools; }
  finally { await client.close(); await server.close(); }
}

async function callTool(runtime: Runtime, name: string, args: Record<string, unknown>) {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "hailuo23-runtime-call-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await client.callTool({ name, arguments: args }); }
  finally { await client.close(); await server.close(); }
}

test("Hailuo 2.3 stdio flag is strict and default-off", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerHailuo23T2vFlag(value), false);
  assert.equal(readOwnerHailuo23T2vFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerHailuo23T2vFlag(value), /Invalid SYNTX_OWNER_HAILUO23_T2V configuration/u);
  }
});

test("Hailuo 2.3 opt-in adds four strict tools and rejects the unreviewed 1080p/10 pair before I/O", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("Unexpected startup/network access"); };
  const defaults = createObservedOwnerRuntime({ fetchImpl }) as Runtime;
  assert.equal(Reflect.get(defaults.serverOptions, "ownerHailuo23T2v"), undefined);
  const defaultNames = (await listTools(defaults)).map(({ name }) => name);
  const enabled = createObservedOwnerRuntime({ ownerHailuo23T2vEnabled: true, fetchImpl }) as Runtime;
  assert.ok(Reflect.get(enabled.serverOptions, "ownerHailuo23T2v"), "MISSING_HAILUO23_COMPOSITION");
  try {
    const definitions = await listTools(enabled);
    const names = definitions.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (TOOLS as readonly string[]).includes(name)).sort(), [...TOOLS].sort());
    assert.deepEqual(names.filter((name) => !(TOOLS as readonly string[]).includes(name)).sort(), [...defaultNames].sort());
    const generate = definitions.find(({ name }) => name === TOOLS[1]);
    assert.ok(generate);
    const schema = generate.inputSchema as { properties?: Record<string, { enum?: unknown[]; anyOf?: Array<{ const?: unknown }>; maxLength?: number }>; required?: string[]; additionalProperties?: unknown };
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), ["link_attempt_id", "prompt", "resolution", "video_duration"]);
    assert.deepEqual([...(schema.required ?? [])].sort(), ["link_attempt_id", "prompt", "resolution", "video_duration"]);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.properties?.resolution?.enum, ["768p", "1080p"]);
    const durationSchema = schema.properties?.video_duration as { enum?: unknown[]; anyOf?: Array<{ const?: unknown }> } | undefined;
    assert.deepEqual(durationSchema?.enum ?? durationSchema?.anyOf?.map((option) => option.const), [6, 10]);
    assert.equal(schema.properties?.prompt?.maxLength, 5_000);
    const profile = createOwnerHailuo23T2vProfile();
    const source = await callTool(enabled, TOOLS[0], {});
    assert.notEqual(source.isError, true);
    assert.deepEqual((source.structuredContent as { controls?: unknown }).controls, profile.source.controls);
    assert.equal((source.structuredContent as { runtime_usable?: boolean }).runtime_usable, false);
    assert.equal((source.structuredContent as { dispatch_allowed?: boolean }).dispatch_allowed, false);
    const invalid = await callTool(enabled, TOOLS[1], {
      link_attempt_id: "link_hailuo23_invalid_pair_test_0123456789", prompt: "invalid pair", resolution: "1080p", video_duration: 10
    });
    assert.equal(invalid.isError, true);
    assert.equal(fetchCalls, 0, "default construction, tools/list, source, and invalid pair are no-I/O");
  } finally { await enabled.ownerHailuo23T2vLifecycle?.close(); }
});

test("Hailuo 2.3 MCP codecs preserve the typed result, recovery metadata, and list envelope", async () => {
  const runtime = createObservedOwnerRuntime({ fetchImpl: async () => { throw new Error("Synthetic codec must not use network"); } }) as Runtime;
  const profile = createOwnerHailuo23T2vProfile();
  const result = {
    status: "reviewed", confidence_scope: "exact_result_only", model_id: "hailuo-2.3", operation_id: "generate-video", modality: "video",
    variant_id: OWNER_HAILUO23_T2V_CONTRACT_VARIANT_ID,
    artifacts: [{ url: "https://media.example.invalid/hailuo23.mp4", mime_type: "video/mp4", byte_size: 12, width: 1366, height: 768, duration_seconds: 5.875 }]
  };
  const recoveryId = "recovery_00000000-0000-4000-8000-000000000000";
  const options = { ownerHailuo23T2v: { generationService: {
    getParametersSource: () => profile.source,
    generate: async () => result,
    reconcile: async () => result,
    listRecoveries: () => [{ recovery_id: recoveryId, model_id: "hailuo-2.3", operation_id: "generate-video",
      variant_id: OWNER_HAILUO23_T2V_CONTRACT_VARIANT_ID, created_at: "2026-10-13T00:00:00.000Z" }]
  } } };
  try {
    const generated = await callTool({ ...runtime, serverOptions: options } as Runtime, TOOLS[1], {
      link_attempt_id: "link_hailuo23_codec_attempt_0123456789", prompt: "synthetic", resolution: "768p", video_duration: 6
    });
    assert.deepEqual(generated.structuredContent, result);
    const reconciled = await callTool({ ...runtime, serverOptions: options } as Runtime, TOOLS[2], {
      link_attempt_id: "link_hailuo23_codec_attempt_0123456789", recovery_id: recoveryId
    });
    assert.deepEqual(reconciled.structuredContent, result);
    assert.deepEqual(reconciled._meta, { recovery_id: recoveryId });
    const listed = await callTool({ ...runtime, serverOptions: options } as Runtime, TOOLS[3], {
      link_attempt_id: "link_hailuo23_codec_attempt_0123456789"
    });
    assert.deepEqual(listed.structuredContent, { recoveries: [{ recovery_id: recoveryId, model_id: "hailuo-2.3",
      operation_id: "generate-video", variant_id: OWNER_HAILUO23_T2V_CONTRACT_VARIANT_ID, created_at: "2026-10-13T00:00:00.000Z" }] });
  } finally { await runtime.ownerHailuo23T2vLifecycle?.close(); }
});

test("invalid Hailuo 2.3 flag and durable conflict fail before stdio attaches", async () => {
  const prior = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_HAILUO23_T2V = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_HAILUO23_T2V configuration/u);
    assert.equal(input.listenerCount("end"), 0);
    process.env.SYNTX_OWNER_HAILUO23_T2V = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of prior) process.env[name] = value;
  }
});

test("Hailuo 2.3 lifecycle drains before auth release on transport EOF", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { onclose: undefined as (() => void) | undefined, async close() {} } as never;
  const lifecycle = { async close() { events.push("hailuo23.lifecycle.close"); } };
  const args: unknown[] = [transport, undefined, undefined, undefined, undefined, () => { events.push("auth.close"); }, input];
  args.push(...Array.from({ length: 12 }, () => undefined), false, ...Array.from({ length: 6 }, () => undefined), undefined,
    undefined, undefined, lifecycle);
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
  try { await close(); assert.deepEqual(events, ["hailuo23.lifecycle.close", "auth.close"]); }
  finally { input.destroy(); }
});
