import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_GROK_V2V_TOOL_NAMES, SYNTX_GET_GROK_V2V_PARAMETERS_TOOL_NAME } from "../src/mcp/owner-grok-v2v-tools.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

type Runtime = ReturnType<typeof createObservedOwnerRuntime> & {
  readonly ownerGrokV2vLifecycle?: { close(): Promise<void> };
};
type RuntimeOptions = Parameters<typeof createObservedOwnerRuntime>[0] & Readonly<Record<string, unknown>>;
const CATALOG = join(process.cwd(), "catalog");
const OPERATOR_FFPROBE_PATH = resolve(process.execPath);

async function connected(runtime: Runtime) {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "grok-v2v-runtime-composition-2067", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

test("Grok V2V remains absent by default; opt-in registers only six tools and getter performs no I/O", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("No provider request is allowed in this registration test."); };
  const defaults = createObservedOwnerRuntime({ catalogDirectory: CATALOG, fetchImpl }) as Runtime;
  const defaultConnection = await connected(defaults);
  let enabled: Runtime | undefined;
  let enabledConnection: Awaited<ReturnType<typeof connected>> | undefined;
  try {
    const defaultNames = (await defaultConnection.client.listTools()).tools.map(({ name }) => name);
    assert.equal(OWNER_GROK_V2V_TOOL_NAMES.some((name) => defaultNames.includes(name)), false);
    assert.equal(Reflect.get(defaults.serverOptions, "ownerGrokV2v"), undefined);
    assert.equal(fetchCalls, 0);

    enabled = createObservedOwnerRuntime({
      catalogDirectory: CATALOG,
      fetchImpl,
      ownerGrokV2vEnabled: true,
      ownerGrokV2vFfprobePath: OPERATOR_FFPROBE_PATH,
      ownerGrokV2vUploadDestination: "hidden"
    } as RuntimeOptions) as Runtime;
    assert.ok(Reflect.get(enabled, "ownerGrokV2vLifecycle"), "MISSING_GROK_V2V_LIFECYCLE");
    assert.ok(Reflect.get(enabled.serverOptions, "ownerGrokV2v"), "MISSING_GROK_V2V_COMPOSITION");
    enabledConnection = await connected(enabled);
    const tools = (await enabledConnection.client.listTools()).tools;
    const names = tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (OWNER_GROK_V2V_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...OWNER_GROK_V2V_TOOL_NAMES].sort());
    assert.deepEqual(names.filter((name) => !(OWNER_GROK_V2V_TOOL_NAMES as readonly string[]).includes(name)).sort(), [...defaultNames].sort());

    const getter = await enabledConnection.client.callTool({ name: SYNTX_GET_GROK_V2V_PARAMETERS_TOOL_NAME,
      arguments: { model_id: "grok_v2v" } });
    assert.equal(getter.isError, undefined, JSON.stringify(getter));
    const output = getter.structuredContent as { status: string; model_id: string; runtime_usable: false;
      dispatch_allowed: false; backend_acceptance: "UNPROVEN" };
    assert.equal(output.status, "SOURCE_REVIEWED_STATIC_ONLY");
    assert.equal(output.model_id, "grok_v2v");
    assert.equal(output.runtime_usable, false);
    assert.equal(output.dispatch_allowed, false);
    assert.equal(output.backend_acceptance, "UNPROVEN");
    assert.equal(JSON.stringify(getter).includes("https://"), false);
    assert.equal(fetchCalls, 0, "runtime construction, tools/list and getter must not use the network");
  } finally {
    await enabled?.ownerGrokV2vLifecycle?.close();
    await enabledConnection?.client.close();
    await enabledConnection?.server.close();
    await defaultConnection.client.close();
    await defaultConnection.server.close();
    enabled?.authStore.close?.();
    defaults.authStore.close?.();
  }
});

test("invalid Grok V2V opt-in and durable-mode conflict fail before stdio attaches", async () => {
  const prior = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_GROK_V2V = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_GROK_V2V configuration/u);
    assert.equal(input.listenerCount("end"), 0);

    process.env.SYNTX_OWNER_GROK_V2V = "1";
    process.env.SYNTX_OWNER_GROK_V2V_FFPROBE_PATH = OPERATOR_FFPROBE_PATH;
    process.env.SYNTX_OWNER_GROK_V2V_UPLOAD_DESTINATION = "hidden";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of prior) process.env[name] = value;
  }
});

test("Grok V2V lifecycle closes on input EOF before owner-auth release", { timeout: 5000 }, async () => {
  const events: string[] = [];
  let resolveTransportClosed!: () => void;
  const transportClosed = new Promise<void>((resolvePromise) => { resolveTransportClosed = resolvePromise; });
  const input = new PassThrough();
  const transport = {
    onclose: undefined as (() => void) | undefined,
    async close() { events.push("transport.close"); resolveTransportClosed(); }
  };
  const runtime = createObservedOwnerRuntime({
    catalogDirectory: CATALOG,
    fetchImpl: async () => { throw new Error("EOF lifecycle test must not make network requests."); },
    ownerGrokV2vEnabled: true,
    ownerGrokV2vFfprobePath: OPERATOR_FFPROBE_PATH,
    ownerGrokV2vUploadDestination: "hidden"
  } as RuntimeOptions) as Runtime;
  const lifecycle = runtime.ownerGrokV2vLifecycle;
  assert.ok(lifecycle, "GROK_V2V_LIFECYCLE_REQUIRED");
  const observedLifecycle = {
    async close() {
      events.push("grok-v2v.close.start");
      await lifecycle.close();
      events.push("grok-v2v.close.done");
    }
  };

  // Preserve all established positions; Grok V2V is the new final argument.
  const args: unknown[] = Array.from({ length: 53 }, () => undefined);
  args[0] = transport;
  args[5] = () => { events.push("owner-auth.release"); };
  args[6] = input;
  args.push(observedLifecycle);
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;

  try {
    input.push(null);
    input.resume();
    await transportClosed;
    assert.deepEqual(events, [
      "grok-v2v.close.start",
      "grok-v2v.close.done",
      "owner-auth.release",
      "transport.close"
    ]);
  } finally {
    input.destroy();
    runtime.authStore.close?.();
    // The normal EOF path already drained this lifecycle; this is idempotent
    // cleanup for an assertion or timeout failure.
    await close();
  }
});
