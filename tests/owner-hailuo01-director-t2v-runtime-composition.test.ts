import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_VARIANT_ID, createOwnerHailuo01DirectorT2vProfile } from "../src/application/owner-hailuo01-director-t2v-profile.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, readOwnerHailuo01DirectorT2vFlag, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

const DIRECTOR_TOOL_NAMES = [
  "syntx_owner_get_hailuo01_director_t2v_source",
  "syntx_owner_generate_hailuo01_director_t2v",
  "syntx_owner_reconcile_hailuo01_director_t2v",
  "syntx_owner_list_hailuo01_director_t2v_recoveries"
] as const;
const OWNER_STDIO_URL = new URL("../src/transports/stdio-owner.js", import.meta.url);
const ALL_MEDIA_OPT_IN_FLAGS = [
  "SYNTX_OWNER_ACCOUNT_STATUS", "SYNTX_OWNER_CLARITY_UPSCALE", "SYNTX_OWNER_MAGNIFIC_UPSCALE",
  "SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES", "SYNTX_OWNER_WAN_IMAGE_REFERENCES", "SYNTX_OWNER_STANDARD_IMAGE_REFERENCES",
  "SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES", "SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES", "SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES",
  "SYNTX_OWNER_FLUX_IMAGE_REFERENCES", "SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES", "SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES",
  "SYNTX_OWNER_UNI_IMAGE_REFERENCES", "SYNTX_OWNER_SOUL_IMAGE_REFERENCES", "SYNTX_OWNER_WAN_T2I_IMAGE",
  "SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES", "SYNTX_OWNER_WAN_T2V_VIDEOS", "SYNTX_OWNER_ELEVENLABS_TTS",
  "SYNTX_OWNER_SUNO_GENERATION", "SYNTX_OWNER_LUMA_T2V", "SYNTX_OWNER_HAILUO01_T2V", "SYNTX_OWNER_HAILUO01_DIRECTOR_T2V"
];

type Runtime = ReturnType<typeof createObservedOwnerRuntime> & {
  readonly ownerHailuo01DirectorT2vLifecycle?: { close(): Promise<void> };
};

async function listToolDefinitions(runtime: Runtime) {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-hailuo01-director-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return (await client.listTools()).tools; }
  finally { await client.close(); await server.close(); }
}

async function callTool(runtime: Runtime, name: string, args: Record<string, unknown>) {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-hailuo01-director-call-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await client.callTool({ name, arguments: args }); }
  finally { await client.close(); await server.close(); }
}

async function callServerTool(application: unknown, options: unknown, name: string, args: Record<string, unknown>) {
  const server = Reflect.apply(createMcpServer, undefined, [application, options]) as ReturnType<typeof createMcpServer>;
  const client = new Client({ name: "owner-hailuo01-director-codec-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await client.callTool({ name, arguments: args }); }
  finally { await client.close(); await server.close(); }
}

test("Hailuo Director stdio flag is strict and default-off", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerHailuo01DirectorT2vFlag(value), false);
  assert.equal(readOwnerHailuo01DirectorT2vFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerHailuo01DirectorT2vFlag(value), /Invalid SYNTX_OWNER_HAILUO01_DIRECTOR_T2V configuration/u);
  }
});

test("Hailuo Director is opt-in only and the actual Stock SDK exposes exactly four strict tools", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("Unexpected startup network access"); };
  const defaults = Reflect.apply(createObservedOwnerRuntime, undefined, [{ fetchImpl }]) as Runtime;
  assert.equal(Reflect.get(defaults.serverOptions, "ownerHailuo01DirectorT2v"), undefined);
  const defaultNames = (await listToolDefinitions(defaults)).map(({ name }) => name);

  const enabled = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerHailuo01DirectorT2vEnabled: true, fetchImpl }]) as Runtime;
  assert.ok(Reflect.get(enabled.serverOptions, "ownerHailuo01DirectorT2v"), "MISSING_HAILUO_DIRECTOR_COMPOSITION");
  try {
    const enabledDefinitions = await listToolDefinitions(enabled);
    const enabledNames = enabledDefinitions.map(({ name }) => name);
    assert.deepEqual(enabledNames.filter((name) => (DIRECTOR_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...DIRECTOR_TOOL_NAMES].sort());
    assert.deepEqual(enabledNames.filter((name) => !(DIRECTOR_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...defaultNames].sort(), "the Director opt-in retains the full existing MCP tool surface");

    const generate = enabledDefinitions.find(({ name }) => name === DIRECTOR_TOOL_NAMES[1]);
    assert.ok(generate, "MISSING_HAILUO_DIRECTOR_GENERATE_TOOL");
    const schema = generate.inputSchema as { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown };
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), ["link_attempt_id", "prompt", "resolution", "video_duration"]);
    assert.deepEqual([...(schema.required ?? [])].sort(), ["link_attempt_id", "prompt", "resolution", "video_duration"]);
    assert.equal(schema.additionalProperties, false, "no caller model selector, preset, or raw settings are accepted");

    const source = await callTool(enabled, DIRECTOR_TOOL_NAMES[0], {});
    assert.notEqual(source.isError, true);
    const sourceContent = source.structuredContent as { identity?: { model_id?: string; model_type?: string }; runtime_usable?: boolean; dispatch_allowed?: boolean };
    assert.deepEqual(sourceContent.identity, { model_id: "hailuo-01-director", ai_name: "hailuo-minimax",
      model_type: "hailuo-01-director", operation_id: "generate-video" });
    assert.equal(sourceContent.runtime_usable, false);
    assert.equal(sourceContent.dispatch_allowed, false);

    const unlinked = await callTool(enabled, DIRECTOR_TOOL_NAMES[1], {
      link_attempt_id: "link_director_unlinked_attempt_0123456789", prompt: "synthetic auth guard", resolution: "720p", video_duration: 6
    });
    assert.equal(unlinked.isError, true, "the Stock SDK handler enforces the linked-owner gate after schema validation");
    const empty = await callTool(enabled, DIRECTOR_TOOL_NAMES[3], { link_attempt_id: "link_director_unlinked_attempt_0123456789" });
    assert.notEqual(empty.isError, true);
    assert.deepEqual(empty.structuredContent, { recoveries: [] });
    const missing = await callTool(enabled, DIRECTOR_TOOL_NAMES[2], {
      link_attempt_id: "link_director_unlinked_attempt_0123456789",
      recovery_id: "recovery_00000000-0000-4000-8000-000000000000"
    });
    assert.equal(missing.isError, true, "a syntactically valid opaque recovery id does not bypass the linked-owner gate");
    assert.equal(fetchCalls, 0, "startup, tools/list, source, and empty recovery listing perform no network I/O");
  } finally {
    await enabled.ownerHailuo01DirectorT2vLifecycle?.close();
  }
});

test("actual Stock SDK handlers preserve Director generation, GET recovery, and recovery-list output codecs", async () => {
  const runtime = Reflect.apply(createObservedOwnerRuntime, undefined, [{ fetchImpl: async () => {
    throw new Error("The codec test service is synthetic and must not use network");
  } }]) as Runtime;
  const profile = createOwnerHailuo01DirectorT2vProfile();
  const result = {
    status: "reviewed", confidence_scope: "exact_result_only", model_id: "hailuo-01-director",
    operation_id: "generate-video", modality: "video", variant_id: OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_VARIANT_ID,
    artifacts: [{ url: "https://media.example.invalid/director.mp4", mime_type: "video/mp4", byte_size: 12,
      width: 1280, height: 720, duration_seconds: 6 }]
  };
  const recoveryId = "recovery_00000000-0000-4000-8000-000000000000";
  const createdAt = "2026-10-13T00:00:00.000Z";
  const options = {
    ownerHailuo01DirectorT2v: { generationService: {
      getParametersSource: () => profile.source,
      generate: async () => result,
      reconcile: async () => result,
      listRecoveries: () => [{ recovery_id: recoveryId, model_id: "hailuo-01-director", operation_id: "generate-video",
        variant_id: OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_VARIANT_ID, created_at: createdAt }]
    } }
  };
  try {
    const generated = await callServerTool(runtime.application, options, DIRECTOR_TOOL_NAMES[1], { link_attempt_id: "link_codec_test_0123456789",
      prompt: "synthetic codec", resolution: "720p", video_duration: 6 });
    assert.deepEqual(generated.structuredContent, result);
    const reconciled = await callServerTool(runtime.application, options, DIRECTOR_TOOL_NAMES[2], { link_attempt_id: "link_codec_test_0123456789",
      recovery_id: recoveryId });
    assert.deepEqual(reconciled.structuredContent, result);
    assert.deepEqual(reconciled._meta, { recovery_id: recoveryId });
    const listed = await callServerTool(runtime.application, options, DIRECTOR_TOOL_NAMES[3], { link_attempt_id: "link_codec_test_0123456789" });
    assert.deepEqual(listed.structuredContent, { recoveries: [{ recovery_id: recoveryId, model_id: "hailuo-01-director",
      operation_id: "generate-video", variant_id: OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_VARIANT_ID, created_at: createdAt }] });
  } finally {
    await runtime.ownerHailuo01DirectorT2vLifecycle?.close();
  }
});

test("Director runtime performs both fresh B066-bound cost reads with exact caller controls before dispatch", async () => {
  const attemptId = "link_hailuo01_director_preflight_0123456789";
  const accessQueries: Array<{ keys: string[]; ai_name: string | null; model_type: string | null; resolution: string | null; video_duration: string | null }> = [];
  let subscriptionReads = 0;
  let chatCreates = 0;
  let videoPosts = 0;
  const runtime = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerHailuo01DirectorT2vEnabled: true,
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
        subscriptionReads += 1;
        return Response.json({ active: true, type: "PRO", end_date: null });
      }
      if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
        accessQueries.push({ keys: [...url.searchParams.keys()].sort(), ai_name: url.searchParams.get("ai_name"),
          model_type: url.searchParams.get("model_type"), resolution: url.searchParams.get("resolution"),
          video_duration: url.searchParams.get("video_duration") });
        return Response.json({ access: accessQueries.length === 1, cost: 1, discount_cost: null,
          free_remaining_generations: null, limit: null, show_warning: false });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        chatCreates += 1;
        return Response.json({ uuid: "synthetic-hailuo-director-preflight-chat" });
      }
      if (url.pathname === "/api/v1/video/generate") {
        videoPosts += 1;
        throw new Error("Second denied Director access read must stop before video generation");
      }
      throw new Error(`Unexpected synthetic Director request: ${method} ${url.pathname}`);
    } }]) as Runtime;
  const composition = Reflect.get(runtime.serverOptions, "ownerHailuo01DirectorT2v") as { generationService: {
    generate(input: unknown): Promise<unknown>;
  } } | undefined;
  assert.ok(composition);
  try {
    await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: runtime.authBinding, expires_at_ms: Date.now() + 60_000 });
    await runtime.authStore.beginHandoff(runtime.authBinding, attemptId);
    await runtime.authStore.attachChallenge(runtime.authBinding, attemptId, "synthetic-hailuo-director-preflight");
    await runtime.authStore.beginPoll(runtime.authBinding, attemptId);
    await runtime.authStore.markLinked(runtime.authBinding, attemptId, { scheme: "Bearer", value: "synthetic-hailuo-credential" });

    await assert.rejects(composition.generationService.generate({ attemptId, prompt: "preflight denial", resolution: "720p", video_duration: 6 }),
      (error: unknown) => {
        assert.equal(Reflect.get(error as object, "code"), "MODEL_ACCESS_UNAVAILABLE");
        return true;
      });
    const exactQuery = { keys: ["ai_name", "model_type", "resolution", "video_duration"], ai_name: "hailuo-minimax",
      model_type: "hailuo-01-director", resolution: "720p", video_duration: "6" };
    assert.equal(subscriptionReads, 2);
    assert.deepEqual(accessQueries, [exactQuery, exactQuery]);
    assert.equal(chatCreates, 1);
    assert.equal(videoPosts, 0);
  } finally {
    await runtime.ownerHailuo01DirectorT2vLifecycle?.close();
  }
});

test("invalid Director flag and durable-generation conflict fail before stdio attaches", async () => {
  const prior = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_HAILUO01_DIRECTOR_T2V = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_HAILUO01_DIRECTOR_T2V configuration/u);
    assert.equal(input.listenerCount("end"), 0);
    process.env.SYNTX_OWNER_HAILUO01_DIRECTOR_T2V = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of prior) process.env[name] = value;
  }
});

test("owner stdio retains existing configured tools and adds exactly four Director tools", async () => {
  const client = new Client({ name: "owner-hailuo01-director-stdio-test", version: "1.0.0" });
  const env = { PATH: process.env.PATH ?? "", ...Object.fromEntries(ALL_MEDIA_OPT_IN_FLAGS.map((flag) => [flag, "1"])) };
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(OWNER_STDIO_URL)],
    cwd: process.cwd(), env, stderr: "pipe"
  });
  await client.connect(transport as unknown as Transport);
  try {
    const names = (await client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.length, 114, "the 110 currently configured tools remain, plus four Director tools");
    assert.deepEqual(names.filter((name) => (DIRECTOR_TOOL_NAMES as readonly string[]).includes(name)).sort(), [...DIRECTOR_TOOL_NAMES].sort());
  } finally { await client.close(); }
});

test("Director revocation drains the captured service before the attempt is revoked", async () => {
  const runtime = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerHailuo01DirectorT2vEnabled: true,
    fetchImpl: async () => { throw new Error("Synthetic revoke must not use network"); } }]) as Runtime;
  const composition = Reflect.get(runtime.serverOptions, "ownerHailuo01DirectorT2v") as { generationService: {
    invalidateAttempt(attemptId: string): Promise<void>;
  } } | undefined;
  assert.ok(composition);
  const attemptId = "link_hailuo01_director_runtime_revoke_0123456789";
  const events: string[] = [];
  const invalidate = composition.generationService.invalidateAttempt.bind(composition.generationService);
  composition.generationService.invalidateAttempt = async (actualAttemptId) => {
    events.push(`invalidate:${(await runtime.authStore.getSnapshot(runtime.authBinding, actualAttemptId)).status}`);
    await invalidate(actualAttemptId);
  };
  try {
    await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: runtime.authBinding, expires_at_ms: Date.now() + 60_000 });
    await runtime.authStore.beginHandoff(runtime.authBinding, attemptId);
    await runtime.authStore.attachChallenge(runtime.authBinding, attemptId, "synthetic-hailuo-director-revoke");
    await runtime.authStore.beginPoll(runtime.authBinding, attemptId);
    await runtime.authStore.markLinked(runtime.authBinding, attemptId, { scheme: "Bearer", value: "synthetic-hailuo-credential" });
    const linkService = runtime.serverOptions.auth?.linkService;
    assert.ok(linkService);
    await linkService.revoke(runtime.authBinding, attemptId);
    assert.deepEqual(events, ["invalidate:LINKED"]);
    assert.equal((await runtime.authStore.getSnapshot(runtime.authBinding, attemptId)).status, "REVOKED");
  } finally {
    await runtime.ownerHailuo01DirectorT2vLifecycle?.close();
  }
});

test("stdio EOF drains the actual Director lifecycle before releasing owner auth", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { onclose: undefined as (() => void) | undefined, async close() {} } as unknown as Transport;
  const runtime = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerHailuo01DirectorT2vEnabled: true,
    fetchImpl: async () => { throw new Error("Synthetic EOF cleanup must not use network"); } }]) as Runtime;
  const lifecycle = runtime.ownerHailuo01DirectorT2vLifecycle;
  assert.ok(lifecycle);
  const lifecycleProbe = { async close() { events.push("director.lifecycle.close"); await lifecycle.close(); } };
  const args: unknown[] = [transport, undefined, undefined, undefined, undefined, () => { events.push("auth.close"); }, input];
  args.push(...Array.from({ length: 12 }, () => undefined), false, ...Array.from({ length: 6 }, () => undefined), undefined,
    undefined, lifecycleProbe);
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
  try {
    await close();
    assert.deepEqual(events, ["director.lifecycle.close", "auth.close"]);
  } finally { input.destroy(); }
});
