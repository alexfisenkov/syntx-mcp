import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { closeOwnerReadServicesOnTransportEof, readOwnerWanT2vVideosFlag, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";
import { isOwnerWanT2vGenerationService } from "../src/application/owner-wan-t2v-generation-service.js";
import {
  SYNTX_OWNER_GENERATE_WAN_T2V_VIDEO_TOOL_NAME,
  SYNTX_OWNER_GET_WAN_T2V_RESULT_PAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN_T2V_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_WAN_T2V_VIDEO_TOOL_NAME,
  SYNTX_GET_WAN_T2V_PARAMETERS_TOOL_NAME
} from "../src/mcp/owner-wan-t2v-video-tools.js";

const WAN_T2V_TOOLS = [
  SYNTX_GET_WAN_T2V_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_GENERATE_WAN_T2V_VIDEO_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_WAN_T2V_VIDEO_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN_T2V_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_WAN_T2V_RESULT_PAGE_TOOL_NAME
] as const;
const OWNER_STDIO_URL = new URL("../src/transports/stdio-owner.js", import.meta.url);

test("WAN T2V runtime flag is exact, strict, and default-off", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerWanT2vVideosFlag(value), false);
  assert.equal(readOwnerWanT2vVideosFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerWanT2vVideosFlag(value), /Invalid SYNTX_OWNER_WAN_T2V_VIDEOS configuration/u);
  }
});

test("malformed WAN T2V environment flag rejects before stdio attaches the input", async () => {
  const previous = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_WAN_T2V_VIDEOS = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_WAN_T2V_VIDEOS configuration/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of previous) process.env[name] = value;
  }
});

test("owner stdio registers zero WAN T2V tools by default and all five only for exact opt-in 1", async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined &&
    !name.startsWith("SYNTX_OWNER_") && name !== "SYNTX_PUBLIC_CATALOG_VERSION"));
  const entrypoint = fileURLToPath(OWNER_STDIO_URL);
  const listNames = async (enabled: boolean): Promise<string[]> => {
    const client = new Client({ name: "wan-t2v-owner-stdio-test", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [entrypoint], cwd: process.cwd(),
      env: { ...env, ...(enabled ? { SYNTX_OWNER_WAN_T2V_VIDEOS: "1" } : {}) }, stderr: "pipe" });
    await client.connect(transport as unknown as Transport);
    try { return (await client.listTools()).tools.map(({ name }) => name); }
    finally { await client.close(); }
  };
  const defaultNames = await listNames(false);
  assert.equal(defaultNames.some((name) => (WAN_T2V_TOOLS as readonly string[]).includes(name)), false);
  const enabledNames = await listNames(true);
  assert.deepEqual(enabledNames.filter((name) => (WAN_T2V_TOOLS as readonly string[]).includes(name)).sort(), [...WAN_T2V_TOOLS].sort());
});

test("WAN T2V runtime is default-off and opt-in composes the branded B066 generation service", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("Unexpected startup network access"); };
  const defaults = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(defaults.serverOptions.ownerWanT2vVideos, undefined);

  const enabled = createObservedOwnerRuntime({ ownerWanT2vVideosEnabled: true, fetchImpl });
  const composition = enabled.serverOptions.ownerWanT2vVideos;
  assert.ok(composition, "MISSING_OWNER_WAN_T2V_COMPOSITION");
  assert.ok(enabled.ownerWanT2vVideosLifecycle, "MISSING_OWNER_WAN_T2V_LIFECYCLE");
  assert.equal(isOwnerWanT2vGenerationService(composition.generationService), true);
  assert.equal(typeof composition.generationService.generate, "function");
  assert.equal(typeof composition.generationService.invalidateAttempt, "function");
  assert.equal(typeof composition.generationService.close, "function");
  assert.equal(fetchCalls, 0, "composition must not contact SYNTX during startup");
  await composition.generationService.close();
  await enabled.ownerWanT2vVideosLifecycle.close();
});

test("Stock SDK has no WAN T2V tools by default, exposes five on opt-in, and unlinked generation cannot dispatch", async () => {
  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl: async () => { throw new Error("No network expected"); } });
  const defaultServer = createMcpServer(defaultRuntime.application, defaultRuntime.serverOptions);
  const defaultClient = new Client({ name: "wan-t2v-default-runtime-test", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  try {
    await defaultServer.connect(defaultServerTransport);
    await defaultClient.connect(defaultClientTransport);
    const defaultNames = (await defaultClient.listTools()).tools.map(({ name }) => name);
    assert.equal(defaultNames.some((name) => (WAN_T2V_TOOLS as readonly string[]).includes(name)), false);
  } finally { await defaultClient.close(); }

  const fetchEvents: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    fetchEvents.push(`${init?.method ?? "GET"} ${new URL(input instanceof Request ? input.url : String(input)).pathname}`);
    throw new Error("Unlinked call must not reach provider transport");
  };
  const runtime = createObservedOwnerRuntime({ ownerWanT2vVideosEnabled: true, fetchImpl });
  assert.ok(runtime.ownerWanT2vVideosLifecycle, "MISSING_OWNER_WAN_T2V_LIFECYCLE");
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "wan-t2v-owner-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (WAN_T2V_TOOLS as readonly string[]).includes(name)).sort(), [...WAN_T2V_TOOLS].sort());
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_WAN_T2V_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: "link_unlinked_wan_t2v_attempt_0123456789",
      model_id: "wan_26_t2v",
      prompt: "synthetic test only",
      parameters: { resolution: "720P", aspect_ratio: "16:9", video_duration: 5,
        prompt_extend: true, seed: null, shot_type: "single", native_audio: false }
    } });
    assert.equal(result.isError, true);
    assert.deepEqual(fetchEvents, [], "an unlinked attempt must never issue a generation POST");
  } finally {
    await client.close();
    await runtime.ownerWanT2vVideosLifecycle.close();
  }
});

test("credential revoke aborts and drains the live WAN T2V POST before marking the attempt revoked", async () => {
  const attemptId = "link_wan_t2v_revoke_runtime_0123456789";
  const linkedBeforeAbort: string[] = [];
  let startPost!: () => void;
  const postStarted = new Promise<void>((resolve) => { startPost = resolve; });
  let finishAbort!: () => void;
  const abortSeen = new Promise<void>((resolve) => { finishAbort = resolve; });
  const subscriptionEnd = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  let posts = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: subscriptionEnd });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 2, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: false });
    if (url.pathname === "/api/v1/chats" && (init?.method ?? "GET") === "POST") return Response.json({ uuid: "wan-t2v-revoke-chat" });
    if (url.pathname === "/api/v1/video/generate" && (init?.method ?? "GET") === "POST") {
      posts += 1;
      startPost();
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        assert.ok(signal, "generation request must be cancellable");
        signal.addEventListener("abort", async () => {
          linkedBeforeAbort.push((await runtime.authStore.getSnapshot(runtime.authBinding, attemptId)).status);
          finishAbort();
          reject(new DOMException("aborted by test", "AbortError"));
        }, { once: true });
      });
    }
    throw new Error(`Unexpected synthetic request: ${init?.method ?? "GET"} ${url.pathname}`);
  };
  const runtime = createObservedOwnerRuntime({ ownerWanT2vVideosEnabled: true, fetchImpl });
  const composition = runtime.serverOptions.ownerWanT2vVideos;
  assert.ok(composition);
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: runtime.authBinding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(runtime.authBinding, attemptId);
  await runtime.authStore.attachChallenge(runtime.authBinding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(runtime.authBinding, attemptId);
  await runtime.authStore.markLinked(runtime.authBinding, attemptId, { scheme: "Bearer", value: "synthetic-runtime-credential" });

  const generation = composition.generationService.generate({ attemptId, input: {
    model_id: "wan_26_t2v", prompt: "Synthetic drain test.", parameters: {
      resolution: "720P", aspect_ratio: "16:9", video_duration: 5,
      prompt_extend: true, seed: 0, shot_type: "multi"
    }
  } });
  await postStarted;
  const revoke = runtime.serverOptions.auth?.linkService;
  assert.ok(revoke);
  await revoke.revoke(runtime.authBinding, attemptId);
  await abortSeen;
  await assert.rejects(generation);
  assert.equal(posts, 1);
  assert.deepEqual(linkedBeforeAbort, ["LINKED"], "credential must remain linked until the active POST is aborted and drained");
  assert.equal((await runtime.authStore.getSnapshot(runtime.authBinding, attemptId)).status, "REVOKED");
  await runtime.ownerWanT2vVideosLifecycle?.close();
});

test("WAN T2V generation drains before owner credentials are released on transport EOF", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { onclose: undefined as (() => void) | undefined, async close() { events.push("transport.close"); } };
  const close = closeOwnerReadServicesOnTransportEof(
    transport as never,
    undefined, undefined, undefined, undefined,
    () => events.push("auth.release"), input,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    true, undefined, undefined, undefined,
    { async close() { events.push("wan-t2v.close"); } }
  );
  await close();
  assert.deepEqual(events, ["wan-t2v.close", "auth.release"]);
  input.destroy();
});
