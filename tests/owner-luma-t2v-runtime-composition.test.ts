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
import { closeOwnerReadServicesOnTransportEof, readOwnerLumaT2vFlag, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

const LUMA_T2V_TOOL_NAMES = [
  "syntx_owner_generate_luma_t2v",
  "syntx_owner_reconcile_luma_t2v",
  "syntx_owner_list_luma_t2v_recoveries"
] as const;
const OWNER_STDIO_URL = new URL("../src/transports/stdio-owner.js", import.meta.url);
const ALL_MEDIA_OPT_IN_FLAGS = [
  "SYNTX_OWNER_ACCOUNT_STATUS", "SYNTX_OWNER_CLARITY_UPSCALE", "SYNTX_OWNER_MAGNIFIC_UPSCALE",
  "SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES", "SYNTX_OWNER_WAN_IMAGE_REFERENCES", "SYNTX_OWNER_STANDARD_IMAGE_REFERENCES",
  "SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES", "SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES", "SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES",
  "SYNTX_OWNER_FLUX_IMAGE_REFERENCES", "SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES", "SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES",
  "SYNTX_OWNER_UNI_IMAGE_REFERENCES", "SYNTX_OWNER_SOUL_IMAGE_REFERENCES", "SYNTX_OWNER_WAN_T2I_IMAGE",
  "SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES", "SYNTX_OWNER_WAN_T2V_VIDEOS", "SYNTX_OWNER_ELEVENLABS_TTS",
  "SYNTX_OWNER_SUNO_GENERATION", "SYNTX_OWNER_LUMA_T2V"
];

type LumaRuntime = ReturnType<typeof createObservedOwnerRuntime> & {
  serverOptions: ReturnType<typeof createObservedOwnerRuntime>["serverOptions"] & {
    ownerLumaT2v?: { generationService: {
      close(): Promise<void>;
      invalidateAttempt(attemptId: string): Promise<void>;
      generate(input: unknown, signal?: AbortSignal): Promise<unknown>;
    } };
  };
  ownerLumaT2vLifecycle?: { close(): Promise<void>; invalidateAttempt(attemptId: string): Promise<void> };
};

async function listTools(runtime: LumaRuntime): Promise<string[]> {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-luma-t2v-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return (await client.listTools()).tools.map(({ name }) => name); }
  finally { await client.close(); await server.close(); }
}

test("Luma T2V stdio opt-in is strict and default-off", async () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerLumaT2vFlag(value), false);
  assert.equal(readOwnerLumaT2vFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerLumaT2vFlag(value), /Invalid SYNTX_OWNER_LUMA_T2V configuration/u);
  }
});

test("Luma T2V runtime is default-off and opt-in adds only its three tools without startup I/O", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("Unexpected startup network access"); };
  const defaults = createObservedOwnerRuntime({ fetchImpl }) as LumaRuntime;
  assert.equal(defaults.serverOptions.ownerLumaT2v, undefined);
  const defaultNames = await listTools(defaults);
  assert.equal(LUMA_T2V_TOOL_NAMES.some((name) => defaultNames.includes(name)), false);

  const enabled = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerLumaT2vEnabled: true, fetchImpl }]) as LumaRuntime;
  const composition = enabled.serverOptions.ownerLumaT2v;
  assert.ok(composition, "MISSING_OWNER_LUMA_T2V_COMPOSITION");
  try {
    const enabledNames = await listTools(enabled);
    assert.deepEqual(enabledNames.filter((name) => LUMA_T2V_TOOL_NAMES.includes(name as typeof LUMA_T2V_TOOL_NAMES[number])).sort(),
      [...LUMA_T2V_TOOL_NAMES].sort());
    assert.deepEqual(enabledNames.filter((name) => !LUMA_T2V_TOOL_NAMES.includes(name as typeof LUMA_T2V_TOOL_NAMES[number])).sort(),
      [...defaultNames].sort(), "the opt-in retains the full pre-existing tool surface");
    const server = createMcpServer(enabled.application, enabled.serverOptions);
    const client = new Client({ name: "owner-luma-t2v-unlinked-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({ name: LUMA_T2V_TOOL_NAMES[0], arguments: {
        link_attempt_id: "link_unlinked_luma_t2v_attempt_0123456789", prompt: "synthetic auth guard",
        quality: "360p", aspect_ratio: "16:9", video_duration: 5
      } });
      assert.equal(result.isError, true, "an unlinked attempt must not be treated as generation authority");
    } finally {
      await client.close();
      await server.close();
    }
    assert.equal(fetchCalls, 0, "runtime composition and tools/list must not read upstream");
  } finally {
    await composition.generationService.close();
  }
});

test("invalid Luma flag and durable-mode conflict fail before owner stdio attaches", async () => {
  const prior = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_LUMA_T2V = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_LUMA_T2V configuration/u);
    assert.equal(input.listenerCount("end"), 0);
    process.env.SYNTX_OWNER_LUMA_T2V = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of prior) process.env[name] = value;
  }
});

test("owner stdio keeps the joint 103-tool media surface and adds the three Luma tools", async () => {
  const client = new Client({ name: "owner-luma-t2v-stdio-test", version: "1.0.0" });
  const env = { PATH: process.env.PATH ?? "", ...Object.fromEntries(ALL_MEDIA_OPT_IN_FLAGS.map((flag) => [flag, "1"])) };
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(OWNER_STDIO_URL)],
    cwd: process.cwd(), env, stderr: "pipe" });
  await client.connect(transport as unknown as Transport);
  try {
    const names = (await client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.length, 106, "the prior 103 enabled-media tools remain, plus three Luma tools");
    assert.deepEqual(names.filter((name) => LUMA_T2V_TOOL_NAMES.includes(name as typeof LUMA_T2V_TOOL_NAMES[number])).sort(),
      [...LUMA_T2V_TOOL_NAMES].sort());
  } finally { await client.close(); }
});

test("owner revoke invalidates Luma state while the link is still live", async () => {
  const runtime = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerLumaT2vEnabled: true,
    fetchImpl: async () => { throw new Error("Synthetic auth revocation must not use network"); } }]) as LumaRuntime;
  const composition = runtime.serverOptions.ownerLumaT2v;
  assert.ok(composition);
  const attemptId = "link_luma_runtime_revoke_0123456789";
  const binding = runtime.authBinding;
  const events: string[] = [];
  const originalInvalidate = composition.generationService.invalidateAttempt.bind(composition.generationService);
  composition.generationService.invalidateAttempt = async (actualAttemptId) => {
    const current = await runtime.authStore.getSnapshot(binding, actualAttemptId);
    events.push(`invalidate:${current.status}`);
    await originalInvalidate(actualAttemptId);
  };
  try {
    await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
    await runtime.authStore.beginHandoff(binding, attemptId);
    await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-luma-attempt");
    await runtime.authStore.beginPoll(binding, attemptId);
    await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-luma-credential" });
    const linkService = runtime.serverOptions.auth?.linkService;
    assert.ok(linkService);
    await linkService.revoke(binding, attemptId);
    assert.deepEqual(events, ["invalidate:LINKED"]);
    assert.equal((await runtime.authStore.getSnapshot(binding, attemptId)).status, "REVOKED");
  } finally {
    await composition.generationService.close();
  }
});

test("runtime Luma model-access preflight denies dispatch for a linked synthetic owner", async () => {
  const attemptId = "link_luma_runtime_preflight_0123456789";
  const routes: string[] = [];
  const runtime = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerLumaT2vEnabled: true,
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      routes.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: null });
      if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: false, cost: 1, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: null });
      throw new Error(`Unexpected synthetic preflight route: ${url.pathname}`);
    } }]) as LumaRuntime;
  const composition = runtime.serverOptions.ownerLumaT2v;
  assert.ok(composition);
  const binding = runtime.authBinding;
  try {
    await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
    await runtime.authStore.beginHandoff(binding, attemptId);
    await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-luma-attempt");
    await runtime.authStore.beginPoll(binding, attemptId);
    await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-luma-credential" });
    await assert.rejects(composition.generationService.generate({ attemptId, prompt: "preflight denial",
      quality: "360p", aspect_ratio: "16:9", video_duration: 5 }), (error: unknown) => {
      assert.equal(Reflect.get(error as object, "code"), "MODEL_ACCESS_UNAVAILABLE");
      return true;
    });
    assert.ok(routes.includes("GET /api/v1/user/subscription"));
    assert.ok(routes.includes("GET /api/v2/get_model_info"));
    assert.equal(routes.some((route) => route === "POST /api/v1/chats" || route === "POST /api/v1/video/generate"), false);
  } finally {
    await composition.generationService.close();
  }
});

test("runtime Luma model-access sends exact cost parameters on both fresh preflights", async () => {
  const attemptId = "link_luma_runtime_cost_0123456789";
  const modelAccessQueries: Array<{ keys: string[]; quality: string | null; video_duration: string | null }> = [];
  let chatCreates = 0;
  let videoPosts = 0;
  const runtime = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerLumaT2vEnabled: true,
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: null });
      if (url.pathname === "/api/v2/get_model_info") {
        modelAccessQueries.push({ keys: [...url.searchParams.keys()].sort(), quality: url.searchParams.get("quality"),
          video_duration: url.searchParams.get("video_duration") });
        return Response.json({ access: modelAccessQueries.length === 1, cost: 1, discount_cost: null,
          free_remaining_generations: null, limit: null, show_warning: null });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        chatCreates += 1;
        return Response.json({ uuid: "luma-cost-preflight-chat" });
      }
      if (url.pathname === "/api/v1/video/generate" && method === "POST") {
        videoPosts += 1;
        throw new Error("Second model-access denial must happen before video dispatch");
      }
      throw new Error(`Unexpected synthetic cost-preflight route: ${method} ${url.pathname}`);
    } }]) as LumaRuntime;
  const composition = runtime.serverOptions.ownerLumaT2v;
  assert.ok(composition);
  const binding = runtime.authBinding;
  try {
    await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
    await runtime.authStore.beginHandoff(binding, attemptId);
    await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-luma-cost-attempt");
    await runtime.authStore.beginPoll(binding, attemptId);
    await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-luma-credential" });
    await assert.rejects(composition.generationService.generate({ attemptId, prompt: "second preflight denial",
      quality: "360p", aspect_ratio: "16:9", video_duration: 5 }), (error: unknown) => {
      assert.equal(Reflect.get(error as object, "code"), "MODEL_ACCESS_UNAVAILABLE");
      return true;
    });
    assert.deepEqual(modelAccessQueries, [0, 1].map(() => ({
      keys: ["ai_name", "model_type", "quality", "video_duration"], quality: "360p", video_duration: "5"
    })));
    assert.equal(chatCreates, 1);
    assert.equal(videoPosts, 0);
  } finally {
    await composition.generationService.close();
  }
});

test("stdio EOF closes the Luma lifecycle and drains service before releasing owner auth", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { onclose: undefined as (() => void) | undefined, async close() {} } as unknown as Transport;
  const runtime = Reflect.apply(createObservedOwnerRuntime, undefined, [{ ownerLumaT2vEnabled: true,
    fetchImpl: async () => { throw new Error("Synthetic EOF cleanup must not use network"); } }]) as LumaRuntime;
  const lifecycle = runtime.ownerLumaT2vLifecycle;
  const service = runtime.serverOptions.ownerLumaT2v?.generationService;
  assert.ok(lifecycle);
  assert.ok(service);
  const lifecycleProbe = { async close() { events.push("luma.lifecycle.close"); await lifecycle.close(); } };
  const args: unknown[] = [transport, undefined, undefined, undefined, undefined, () => { events.push("auth.close"); }, input];
  args.push(...Array.from({ length: 12 }, () => undefined), false, ...Array.from({ length: 6 }, () => undefined), lifecycleProbe);
  const close = Reflect.apply(closeOwnerReadServicesOnTransportEof, undefined, args) as () => Promise<void>;
  try {
    await close();
    assert.deepEqual(events, ["luma.lifecycle.close", "auth.close"]);
    assert.throws(() => service.generate({ attemptId: "link_luma_after_close_0123456789", prompt: "closed",
      quality: "720p", aspect_ratio: "16:9", video_duration: 5 }), (error: unknown) => {
      assert.equal(Reflect.get(error as object, "code"), "SERVICE_CLOSED");
      return true;
    });
  } finally { input.destroy(); }
});
