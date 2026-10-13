import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, readOwnerHailuo01T2vFlag, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

const HAILUO01_T2V_TOOL_NAMES = [
  "syntx_owner_get_hailuo01_t2v_source",
  "syntx_owner_generate_hailuo01_t2v",
  "syntx_owner_reconcile_hailuo01_t2v",
  "syntx_owner_list_hailuo01_t2v_recoveries"
] as const;
const OWNER_STDIO_URL = new URL("../src/transports/stdio-owner.js", import.meta.url);
const ALL_MEDIA_OPT_IN_FLAGS = [
  "SYNTX_OWNER_ACCOUNT_STATUS", "SYNTX_OWNER_CLARITY_UPSCALE", "SYNTX_OWNER_MAGNIFIC_UPSCALE",
  "SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES", "SYNTX_OWNER_WAN_IMAGE_REFERENCES", "SYNTX_OWNER_STANDARD_IMAGE_REFERENCES",
  "SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES", "SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES", "SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES",
  "SYNTX_OWNER_FLUX_IMAGE_REFERENCES", "SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES", "SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES",
  "SYNTX_OWNER_UNI_IMAGE_REFERENCES", "SYNTX_OWNER_SOUL_IMAGE_REFERENCES", "SYNTX_OWNER_WAN_T2I_IMAGE",
  "SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES", "SYNTX_OWNER_WAN_T2V_VIDEOS", "SYNTX_OWNER_ELEVENLABS_TTS",
  "SYNTX_OWNER_SUNO_GENERATION", "SYNTX_OWNER_LUMA_T2V", "SYNTX_OWNER_HAILUO01_T2V"
];

type TestRuntime = ReturnType<typeof createObservedOwnerRuntime> & {
  readonly ownerHailuo01T2vLifecycle?: { close(): Promise<void> };
};

async function listToolDefinitions(runtime: TestRuntime) {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-hailuo01-t2v-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return (await client.listTools()).tools; }
  finally { await client.close(); await server.close(); }
}
async function listTools(runtime: TestRuntime): Promise<string[]> { return (await listToolDefinitions(runtime)).map(({ name }) => name); }
async function callTool(runtime: TestRuntime, name: string, args: Record<string, unknown>) {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-hailuo01-t2v-call-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await client.callTool({ name, arguments: args }); }
  finally { await client.close(); await server.close(); }
}

test("Hailuo 01 owner T2V flag is strict and default-off", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerHailuo01T2vFlag(value), false);
  assert.equal(readOwnerHailuo01T2vFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerHailuo01T2vFlag(value), /Invalid SYNTX_OWNER_HAILUO01_T2V configuration/u);
  }
});

test("Hailuo 01 T2V is opt-in only, adds four exact tools, and performs no startup I/O", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("Unexpected startup network access"); };
  const defaults = Reflect.apply(createObservedOwnerRuntime, undefined, [{ fetchImpl }]) as TestRuntime;
  assert.equal(Reflect.get(defaults.serverOptions, "ownerHailuo01T2v"), undefined);
  const defaultNames = await listTools(defaults);

  const enabled = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerHailuo01T2vEnabled: true, fetchImpl }]) as TestRuntime;
  const composition = Reflect.get(enabled.serverOptions, "ownerHailuo01T2v");
  assert.ok(composition, "MISSING_OWNER_HAILUO01_T2V_COMPOSITION");
  try {
    const enabledNames = await listTools(enabled);
    assert.deepEqual(enabledNames.filter((name) => (HAILUO01_T2V_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...HAILUO01_T2V_TOOL_NAMES].sort());
    assert.deepEqual(enabledNames.filter((name) => !(HAILUO01_T2V_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...defaultNames].sort(), "the opt-in retains the complete existing tool surface");
    const definitions = await listToolDefinitions(enabled);
    const generate = definitions.find(({ name }) => name === HAILUO01_T2V_TOOL_NAMES[1]);
    assert.ok(generate, "MISSING_HAILUO01_GENERATE_TOOL");
    const generateSchema = generate.inputSchema as { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown };
    assert.deepEqual(Object.keys(generateSchema.properties ?? {}).sort(), ["link_attempt_id", "prompt", "resolution", "video_duration"]);
    assert.deepEqual([...(generateSchema.required ?? [])].sort(), ["link_attempt_id", "prompt", "resolution", "video_duration"]);
    assert.equal(generateSchema.additionalProperties, false, "caller model selectors and raw settings are denied");
    const source = await callTool(enabled, HAILUO01_T2V_TOOL_NAMES[0], {});
    assert.notEqual(source.isError, true);
    const sourceDescriptor = source.structuredContent as { status?: string; controls?: { prompt?: { source_max_length?: string; local_bound?: number } } };
    assert.equal(sourceDescriptor.status, "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_UI_OBSERVATION");
    assert.equal(sourceDescriptor.controls?.prompt?.source_max_length, "UNKNOWN");
    assert.equal(sourceDescriptor.controls?.prompt?.local_bound, 5_000);
    const unlinked = await callTool(enabled, HAILUO01_T2V_TOOL_NAMES[1], {
      link_attempt_id: "link_unlinked_hailuo01_t2v_0123456789", prompt: "synthetic auth guard", resolution: "720p", video_duration: 6
    });
    assert.equal(unlinked.isError, true, "an unlinked attempt is not generation authority");
    const recoveries = await callTool(enabled, HAILUO01_T2V_TOOL_NAMES[3], {
      link_attempt_id: "link_unlinked_hailuo01_t2v_0123456789"
    });
    assert.notEqual(recoveries.isError, true);
    assert.deepEqual(recoveries.structuredContent, { recoveries: [] });
    assert.equal(fetchCalls, 0, "runtime construction and tools/list must not contact SYNTX");
  } finally {
    const lifecycle = Reflect.get(enabled, "ownerHailuo01T2vLifecycle") as { close(): Promise<void> } | undefined;
    await lifecycle?.close();
  }
});

test("invalid Hailuo flag and durable-generation conflict fail before stdio attaches", async () => {
  const prior = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_HAILUO01_T2V = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_HAILUO01_T2V configuration/u);
    assert.equal(input.listenerCount("end"), 0);
    process.env.SYNTX_OWNER_HAILUO01_T2V = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of prior) process.env[name] = value;
  }
});

test("owner stdio retains the existing media surface and adds four Hailuo 01 tools", async () => {
  const client = new Client({ name: "owner-hailuo01-t2v-stdio-test", version: "1.0.0" });
  const env = { PATH: process.env.PATH ?? "", ...Object.fromEntries(ALL_MEDIA_OPT_IN_FLAGS.map((flag) => [flag, "1"])) };
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(OWNER_STDIO_URL)],
    cwd: process.cwd(), env, stderr: "pipe" });
  await client.connect(transport as unknown as Transport);
  try {
    const tools = (await client.listTools()).tools;
    const names = tools.map(({ name }) => name);
    assert.equal(names.length, 110, "the 106 existing configured tools remain, plus four Hailuo tools");
    assert.deepEqual(names.filter((name) => (HAILUO01_T2V_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...HAILUO01_T2V_TOOL_NAMES].sort());
  } finally { await client.close(); }
});

test("runtime uses two fresh B066-bound access queries with only resolution and duration cost inputs", async () => {
  const attemptId = "link_hailuo01_runtime_preflight_0123456789";
  const routes: string[] = [];
  const accessQueries: Array<{ keys: string[]; resolution: string | null; video_duration: string | null }> = [];
  let subscriptionReads = 0;
  let chatCreates = 0;
  let videoPosts = 0;
  const runtime = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerHailuo01T2vEnabled: true,
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      routes.push(`${method} ${url.pathname}`);
      if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
        subscriptionReads += 1;
        return Response.json({ active: true, type: "PRO", end_date: null });
      }
      if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
        accessQueries.push({ keys: [...url.searchParams.keys()].sort(), resolution: url.searchParams.get("resolution"),
          video_duration: url.searchParams.get("video_duration") });
        return Response.json({ access: accessQueries.length === 1, cost: 1, discount_cost: null,
          free_remaining_generations: null, limit: null, show_warning: false });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        chatCreates += 1;
        return Response.json({ uuid: "synthetic-hailuo-preflight-chat" });
      }
      if (url.pathname === "/api/v1/video/generate") {
        videoPosts += 1;
        throw new Error("Second denied model-access read must stop before video generation");
      }
      throw new Error(`Unexpected synthetic Hailuo runtime request: ${method} ${url.pathname}`);
    } }]) as TestRuntime;
  const composition = Reflect.get(runtime.serverOptions, "ownerHailuo01T2v") as { generationService: { generate(input: unknown): Promise<unknown> } } | undefined;
  assert.ok(composition);
  try {
    await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: runtime.authBinding, expires_at_ms: Date.now() + 60_000 });
    await runtime.authStore.beginHandoff(runtime.authBinding, attemptId);
    await runtime.authStore.attachChallenge(runtime.authBinding, attemptId, "synthetic-hailuo-runtime-attempt");
    await runtime.authStore.beginPoll(runtime.authBinding, attemptId);
    await runtime.authStore.markLinked(runtime.authBinding, attemptId, { scheme: "Bearer", value: "synthetic-hailuo-credential" });

    await assert.rejects(composition.generationService.generate({ attemptId, prompt: "preflight denial",
      resolution: "720p", video_duration: 6 }), (error: unknown) => {
      assert.equal(Reflect.get(error as object, "code"), "MODEL_ACCESS_UNAVAILABLE");
      return true;
    });
    assert.equal(subscriptionReads, 2);
    assert.deepEqual(accessQueries, [0, 1].map(() => ({ keys: ["ai_name", "model_type", "resolution", "video_duration"],
      resolution: "720p", video_duration: "6" })));
    assert.equal(chatCreates, 1);
    assert.equal(videoPosts, 0);
    assert.equal(routes.filter((route) => route === "POST /api/v1/video/generate").length, 0);
  } finally {
    const lifecycle = Reflect.get(runtime, "ownerHailuo01T2vLifecycle") as { close(): Promise<void> } | undefined;
    await lifecycle?.close();
  }
});

test("owner revoke drains Hailuo state before the attempt becomes revoked", async () => {
  const runtime = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerHailuo01T2vEnabled: true,
    fetchImpl: async () => { throw new Error("Synthetic revoke must not use network"); } }]) as TestRuntime;
  const composition = Reflect.get(runtime.serverOptions, "ownerHailuo01T2v") as { generationService: {
    invalidateAttempt(attemptId: string): Promise<void>;
  } } | undefined;
  assert.ok(composition);
  const attemptId = "link_hailuo01_runtime_revoke_0123456789";
  const events: string[] = [];
  const invalidate = composition.generationService.invalidateAttempt.bind(composition.generationService);
  composition.generationService.invalidateAttempt = async (actualAttemptId) => {
    events.push(`invalidate:${(await runtime.authStore.getSnapshot(runtime.authBinding, actualAttemptId)).status}`);
    await invalidate(actualAttemptId);
  };
  try {
    await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: runtime.authBinding, expires_at_ms: Date.now() + 60_000 });
    await runtime.authStore.beginHandoff(runtime.authBinding, attemptId);
    await runtime.authStore.attachChallenge(runtime.authBinding, attemptId, "synthetic-hailuo-revoke-attempt");
    await runtime.authStore.beginPoll(runtime.authBinding, attemptId);
    await runtime.authStore.markLinked(runtime.authBinding, attemptId, { scheme: "Bearer", value: "synthetic-hailuo-credential" });
    const linkService = runtime.serverOptions.auth?.linkService;
    assert.ok(linkService);
    await linkService.revoke(runtime.authBinding, attemptId);
    assert.deepEqual(events, ["invalidate:LINKED"]);
    assert.equal((await runtime.authStore.getSnapshot(runtime.authBinding, attemptId)).status, "REVOKED");
  } finally {
    const lifecycle = Reflect.get(runtime, "ownerHailuo01T2vLifecycle") as { close(): Promise<void> } | undefined;
    await lifecycle?.close();
  }
});

test("stdio EOF closes the Hailuo lifecycle before releasing owner auth", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { onclose: undefined as (() => void) | undefined, async close() {} } as unknown as Transport;
  const runtime = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerHailuo01T2vEnabled: true,
    fetchImpl: async () => { throw new Error("Synthetic EOF cleanup must not use network"); } }]) as TestRuntime;
  const lifecycle = Reflect.get(runtime, "ownerHailuo01T2vLifecycle") as { close(): Promise<void> } | undefined;
  assert.ok(lifecycle);
  const lifecycleProbe = { async close() { events.push("hailuo.lifecycle.close"); await lifecycle.close(); } };
  const args: unknown[] = [transport, undefined, undefined, undefined, undefined, () => { events.push("auth.close"); }, input];
  args.push(...Array.from({ length: 12 }, () => undefined), false, ...Array.from({ length: 6 }, () => undefined), undefined, lifecycleProbe);
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
  try {
    await close();
    assert.deepEqual(events, ["hailuo.lifecycle.close", "auth.close"]);
  } finally { input.destroy(); }
});
