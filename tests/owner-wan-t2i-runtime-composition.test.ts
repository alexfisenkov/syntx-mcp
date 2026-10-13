import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import test from "node:test";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { OwnerWanT2iGenerationService } from "../src/application/owner-wan-t2i-generation-service.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  SYNTX_OWNER_GENERATE_WAN_T2I_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN_T2I_IMAGE_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_WAN_T2I_IMAGE_TOOL_NAME
} from "../src/mcp/owner-wan-t2i-tools.js";
import { closeOwnerReadServicesOnTransportEof, readOwnerWanT2iImageFlag, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";

const STDIO_OWNER_URL = new URL("../src/transports/stdio-owner.js", import.meta.url);
const MODEL_IDS = ["wan_25_t2i_preview", "wan_26_t2i"] as const;
const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
const RESOLUTIONS = ["720P", "1080P"] as const;
const BATCHES = [1, 2, 3, 4] as const;
const ATTEMPT = "link_wan_t2i_runtime_846_000000000001";
const TOOL_NAMES = [SYNTX_OWNER_GENERATE_WAN_T2I_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_WAN_T2I_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN_T2I_IMAGE_RECOVERIES_TOOL_NAME] as const;

test("WAN T2I owner-stdio flag is strict and opts into the actual runtime composition", async () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerWanT2iImageFlag(value), false);
  assert.equal(readOwnerWanT2iImageFlag("1"), true);
  for (const value of ["true", "false", " 1", "1 ", "01"]) {
    assert.throws(() => readOwnerWanT2iImageFlag(value), /Invalid SYNTX_OWNER_WAN_T2I_IMAGE configuration/u);
  }

  const calls: string[] = [];
  const fetchImpl: typeof fetch = async () => { calls.push("fetch"); throw new Error("Unexpected startup fetch"); };
  const defaults = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(defaults.serverOptions.ownerWanT2iImageReferences, undefined);
  const enabled = createObservedOwnerRuntime({ ownerWanT2iImageEnabled: true, fetchImpl } as unknown as
    Parameters<typeof createObservedOwnerRuntime>[0]);
  const composition = enabled.serverOptions.ownerWanT2iImageReferences;
  assert.ok(composition, "MISSING_WAN_T2I_RUNTIME_COMPOSITION");
  assert.equal(typeof composition.generationService.generate, "function");
  assert.equal(typeof composition.generationService.invalidateAttempt, "function");
  assert.equal(typeof composition.generationService.close, "function");
  assert.deepEqual(calls, []);
  await composition.generationService.close();
});

test("owner stdio keeps all three WAN T2I tools absent by default and exposes them only for exact flag 1", async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined &&
    !name.startsWith("SYNTX_OWNER_") && name !== "SYNTX_PUBLIC_CATALOG_VERSION"));
  const entrypoint = fileURLToPath(STDIO_OWNER_URL);
  const listNames = async (enabled: boolean): Promise<string[]> => {
    const client = new Client({ name: "wan-t2i-owner-stdio-runtime", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [entrypoint], cwd: process.cwd(),
      env: { ...env, SYNTX_PUBLIC_CATALOG_VERSION: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        ...(enabled ? { SYNTX_OWNER_WAN_T2I_IMAGE: "1" } : {}) }, stderr: "pipe" });
    await client.connect(transport as unknown as Transport);
    try { return (await client.listTools()).tools.map(({ name }) => name); }
    finally { await client.close(); }
  };
  const defaultNames = await listNames(false);
  assert.equal(TOOL_NAMES.some((name) => defaultNames.includes(name)), false);
  const enabledNames = await listNames(true);
  assert.deepEqual(TOOL_NAMES.filter((name) => enabledNames.includes(name)), TOOL_NAMES);
});

test("owner stdio rejects malformed WAN T2I flag and durable-generation conflict before startup", async () => {
  const previous = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_WAN_T2I_IMAGE = "true";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()), /Invalid SYNTX_OWNER_WAN_T2I_IMAGE configuration/u);
    process.env.SYNTX_OWNER_WAN_T2I_IMAGE = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()), /Durable owner generation cannot be combined/u);
  } finally {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of previous) process.env[name] = value;
  }
});

test("the actual owner MCP composition dispatches all 80 full WAN T2I states with two fresh preflights each", async () => {
  const fixtureNow = Date.now();
  const subscriptionEndDate = new Date(fixtureNow + 24 * 60 * 60_000).toISOString();
  const events: Array<{ method: string; url: URL; body: unknown }> = [];
  const jobs = new Map<string, { model_id: string; batch_size: number; ack_id: string; bot_id: string }>();
  const counts = { balance: 0, subscription: 0, access: 0, chats: 0, posts: 0, history: 0, results: 0 };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push({ method, url, body });
    if (url.pathname === "/api/v1/user/balance") { counts.balance += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription") {
      counts.subscription += 1;
      return Response.json({ active: true, type: "PRO", end_date: subscriptionEndDate });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      counts.access += 1;
      return Response.json({ access: true, cost: 3, discount_cost: null, free_remaining_generations: null,
        limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1;
      return Response.json({ uuid: `wan-runtime-chat-${counts.chats}` });
    }
    if (url.pathname === "/api/v1/design/generate" && method === "POST") {
      counts.posts += 1;
      const request = body as { settings: { model_type: string; batch_size: number }; chat_uuid: string };
      const ack_id = `wan-runtime-owner-ack-${counts.posts}`;
      const bot_id = `wan-runtime-bot-message-${counts.posts}`;
      jobs.set(request.chat_uuid, { model_id: request.settings.model_type, batch_size: request.settings.batch_size, ack_id, bot_id });
      return Response.json({ id: ack_id });
    }
    const historyMatch = /^\/api\/v1\/chats\/(wan-runtime-chat-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch) {
      counts.history += 1;
      const job = jobs.get(historyMatch[1]!);
      assert.ok(job);
      return Response.json({ messages: [
        { id: job.ack_id, chat_id: 9001, author_id: 42, message_object: [] },
        { id: job.bot_id, chat_id: 9001, author_id: -1, message_object: Array.from({ length: job.batch_size }, (_, index) => ({
          id: 7000 + index, message_id: job.bot_id, object_type: "image", model_type: job.model_id
        })) }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(wan-runtime-chat-\d+)\/(wan-runtime-bot-message-\d+)$/u.exec(url.pathname);
    if (resultMatch) {
      counts.results += 1;
      const job = jobs.get(resultMatch[1]!);
      assert.ok(job);
      assert.equal(resultMatch[2], job.bot_id);
      return Response.json({ id: job.bot_id, chat_id: 9001, author_id: -1, message_object: Array.from({ length: job.batch_size }, (_, index) => ({
        id: 7000 + index, message_id: job.bot_id, object_type: "image", model_type: job.model_id, completed: true,
        object_url: `https://r2.syntx.ai/wan-runtime/${counts.posts}-${index + 1}.png`
      })) });
    }
    throw new Error(`Unexpected synthetic WAN runtime request ${method} ${url.pathname}`);
  };
  const runtime = createObservedOwnerRuntime({ ownerWanT2iImageEnabled: true, fetchImpl, now: () => fixtureNow });
  const composition = runtime.serverOptions.ownerWanT2iImageReferences;
  assert.ok(composition);
  const generation = composition.generationService;
  assert.ok(generation instanceof OwnerWanT2iGenerationService);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "wan-t2i-actual-runtime-calltool", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await runtime.authStore.createAttempt({ attempt_id: ATTEMPT, binding: runtime.authBinding, expires_at_ms: fixtureNow + 60_000 });
  await runtime.authStore.beginHandoff(runtime.authBinding, ATTEMPT);
  await runtime.authStore.attachChallenge(runtime.authBinding, ATTEMPT, "synthetic-wan-t2i-runtime-846");
  await runtime.authStore.beginPoll(runtime.authBinding, ATTEMPT);
  await runtime.authStore.markLinked(runtime.authBinding, ATTEMPT, { scheme: "Bearer", value: "synthetic-runtime-credential" });
  try {
    const advertised = (await client.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(TOOL_NAMES.filter((name) => advertised.includes(name)), TOOL_NAMES);
    let index = 0;
    for (const model_id of MODEL_IDS) for (const aspect_ratio of RATIOS) for (const resolution of RESOLUTIONS) {
      for (const batch_size of BATCHES) {
        const prompt = `Explicit runtime intent ${index}`;
        const prompt_extend = index % 2 === 0;
        const seed = index % 3 === 0 ? null : index % 3 === 1 ? 0 : 2_147_483_647;
        const input = { link_attempt_id: ATTEMPT, model_id, prompt,
          parameters: { aspect_ratio, resolution, batch_size, prompt_extend, seed, color_palette: null, bbox_list: [] } };
        const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_WAN_T2I_IMAGE_TOOL_NAME, arguments: input });
        assert.notEqual(result.isError, true, JSON.stringify(result));
        const output = result.structuredContent as Record<string, unknown>;
        assert.equal(output.status, "result_observed");
        assert.equal(output.model_id, model_id);
        assert.equal(output.requested_batch_size, batch_size);
        assert.equal(output.actual_result_count, batch_size);
        assert.equal((output.artifacts as readonly unknown[]).length, batch_size);
        const posted = events.filter((event) => event.method === "POST" && event.url.pathname === "/api/v1/design/generate")[index]!;
        assert.deepEqual(posted.body, { chat_uuid: `wan-runtime-chat-${index + 1}`, prompt,
          settings: { n: 1, model_type: model_id, aspect_ratio, resolution, batch_size, prompt_extend, seed,
            color_palette: null, bbox_list: [], file_urls: [] } });
        index += 1;
      }
    }
    assert.equal(index, 80);
    assert.deepEqual(counts, { balance: 160, subscription: 160, access: 160, chats: 80, posts: 80, history: 80, results: 80 });
    const accessQueries = events.filter(({ url }) => url.pathname === "/api/v2/get_model_info");
    assert.equal(accessQueries.length, 160);
    for (const event of accessQueries) {
      assert.equal(event.url.searchParams.get("ai_name"), "wan_image");
      assert.ok(MODEL_IDS.includes(event.url.searchParams.get("model_type") as typeof MODEL_IDS[number]));
      assert.deepEqual([...event.url.searchParams.keys()].sort(), ["ai_name", "batch_size", "model_type"]);
      assert.equal(event.url.searchParams.has("resolution"), false);
      assert.equal(event.url.searchParams.has("aspect_ratio"), false);
    }
  } finally {
    await client.close();
    await server.close();
    await generation.close();
  }
});

test("failed second fresh model-access read prevents the actual native POST", async () => {
  const fixtureNow = Date.now();
  const subscriptionEndDate = new Date(fixtureNow + 24 * 60 * 60_000).toISOString();
  const counts = { balance: 0, subscription: 0, access: 0, chats: 0, posts: 0 };
  const runtime = createObservedOwnerRuntime({ ownerWanT2iImageEnabled: true, now: () => fixtureNow,
    fetchImpl: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/v1/user/balance") { counts.balance += 1; return Response.json({ balance: "10" }); }
    if (url.pathname === "/api/v1/user/subscription") { counts.subscription += 1; return Response.json({ active: true, type: "PRO", end_date: subscriptionEndDate }); }
    if (url.pathname === "/api/v2/get_model_info") {
      counts.access += 1;
      return Response.json({ access: counts.access === 1, cost: 2, discount_cost: null, free_remaining_generations: null,
        limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") { counts.chats += 1; return Response.json({ uuid: "wan-denied-chat" }); }
    if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") { counts.posts += 1; return Response.json({ id: "unexpected" }); }
    throw new Error(`Unexpected second-preflight route ${url.pathname}`);
  } });
  const generation = runtime.serverOptions.ownerWanT2iImageReferences?.generationService;
  assert.ok(generation);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "wan-t2i-second-preflight-denial", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await runtime.authStore.createAttempt({ attempt_id: ATTEMPT, binding: runtime.authBinding, expires_at_ms: fixtureNow + 60_000 });
  await runtime.authStore.beginHandoff(runtime.authBinding, ATTEMPT);
  await runtime.authStore.attachChallenge(runtime.authBinding, ATTEMPT, "synthetic-denial");
  await runtime.authStore.beginPoll(runtime.authBinding, ATTEMPT);
  await runtime.authStore.markLinked(runtime.authBinding, ATTEMPT, { scheme: "Bearer", value: "synthetic-runtime-credential" });
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_WAN_T2I_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, model_id: "wan_25_t2i_preview", prompt: "Fresh access denial",
      parameters: { aspect_ratio: "1:1", resolution: "720P", batch_size: 1, prompt_extend: false,
        seed: null, color_palette: null, bbox_list: [] }
    } });
    assert.equal(result.isError, true);
    assert.deepEqual(counts, { balance: 2, subscription: 2, access: 2, chats: 1, posts: 0 });
  } finally { await client.close(); await server.close(); await generation.close(); }
});

test("WAN T2I revoke drains the generation service before credential revoke and retains auth on drain failure", async () => {
  const runtime = createObservedOwnerRuntime({ ownerWanT2iImageEnabled: true, fetchImpl: async () => {
    throw new Error("No fetch should occur in the revoke fixture.");
  } });
  const generation = runtime.serverOptions.ownerWanT2iImageReferences?.generationService;
  assert.ok(generation);
  await runtime.authStore.createAttempt({ attempt_id: ATTEMPT, binding: runtime.authBinding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(runtime.authBinding, ATTEMPT);
  await runtime.authStore.attachChallenge(runtime.authBinding, ATTEMPT, "synthetic-revoke");
  await runtime.authStore.beginPoll(runtime.authBinding, ATTEMPT);
  await runtime.authStore.markLinked(runtime.authBinding, ATTEMPT, { scheme: "Bearer", value: "synthetic-runtime-credential" });
  const events: string[] = [];
  const originalInvalidate = generation.invalidateAttempt.bind(generation);
  generation.invalidateAttempt = async (attemptId) => { events.push("service.drain.start"); await originalInvalidate(attemptId); events.push("service.drain.done"); };
  const originalStoreRevoke = runtime.authStore.revoke.bind(runtime.authStore);
  runtime.authStore.revoke = async (binding, attemptId) => { events.push("auth.revoke"); return originalStoreRevoke(binding, attemptId); };
  try {
    await runtime.serverOptions.auth!.linkService.revoke(runtime.authBinding, ATTEMPT);
    assert.deepEqual(events, ["service.drain.start", "service.drain.done", "auth.revoke"]);
    assert.equal((await runtime.linkService.getStatus(runtime.authBinding, ATTEMPT)).status, "REVOKED");

    const next = "link_wan_t2i_runtime_846_drainfail_000001";
    await runtime.authStore.createAttempt({ attempt_id: next, binding: runtime.authBinding, expires_at_ms: Date.now() + 60_000 });
    await runtime.authStore.beginHandoff(runtime.authBinding, next);
    await runtime.authStore.attachChallenge(runtime.authBinding, next, "synthetic-drainfail");
    await runtime.authStore.beginPoll(runtime.authBinding, next);
    await runtime.authStore.markLinked(runtime.authBinding, next, { scheme: "Bearer", value: "synthetic-runtime-credential-2" });
    generation.invalidateAttempt = async () => { throw new Error("synthetic WAN T2I drain failure"); };
    await assert.rejects(runtime.serverOptions.auth!.linkService.revoke(runtime.authBinding, next), /synthetic WAN T2I drain failure/u);
    assert.equal((await runtime.linkService.getStatus(runtime.authBinding, next)).status, "LINKED");
  } finally { await generation.close(); }
});

test("failed WAN T2I EOF drain does not release linked owner auth", async () => {
  const runtime = createObservedOwnerRuntime({ ownerWanT2iImageEnabled: true, fetchImpl: async () => {
    throw new Error("No fetch should occur in failed EOF drain fixture.");
  } });
  const generation = runtime.serverOptions.ownerWanT2iImageReferences?.generationService;
  assert.ok(generation);
  await runtime.authStore.createAttempt({ attempt_id: ATTEMPT, binding: runtime.authBinding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(runtime.authBinding, ATTEMPT);
  await runtime.authStore.attachChallenge(runtime.authBinding, ATTEMPT, "synthetic-eof-drain-failure");
  await runtime.authStore.beginPoll(runtime.authBinding, ATTEMPT);
  await runtime.authStore.markLinked(runtime.authBinding, ATTEMPT, { scheme: "Bearer", value: "synthetic-runtime-credential" });
  const originalClose = generation.close.bind(generation);
  generation.close = async () => { throw new Error("synthetic EOF drain failure"); };
  const events: string[] = [];
  const input = new PassThrough();
  const transport: Transport = { async start() {}, async send() {}, async close() { transport.onclose?.(); } };
  const close = closeOwnerReadServicesOnTransportEof(transport, undefined, undefined, undefined, undefined,
    () => { events.push("auth.release"); }, input, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, true, generation);
  const oldExitCode = process.exitCode;
  try {
    await assert.rejects(close, /synthetic EOF drain failure/u);
    assert.deepEqual(events, []);
    assert.equal((await runtime.linkService.getStatus(runtime.authBinding, ATTEMPT)).status, "LINKED");
  } finally {
    process.exitCode = oldExitCode;
    generation.close = originalClose;
    await originalClose();
    input.destroy();
  }
});

test("WAN T2I EOF and startup failure drain the actual service and owned preparer before auth release", async () => {
  const paths = {
    preparer: new URL("../src/application/owner-wan-t2i-request-preparer.js", import.meta.url).href,
    service: new URL("../src/application/owner-wan-t2i-generation-service.js", import.meta.url).href,
    runtime: new URL("../src/runtime/observed-owner-runtime.js", import.meta.url).href,
    stdio: new URL("../src/transports/stdio-owner.js", import.meta.url).href
  };
  const script = `
    import { PassThrough } from "node:stream";
    const events=[];
    const preparer=await import(${JSON.stringify(paths.preparer)});
    const closePreparer=preparer.OwnerWanT2iRequestPreparer.prototype.close;
    preparer.OwnerWanT2iRequestPreparer.prototype.close=async function(){events.push("preparer.close");return closePreparer.call(this)};
    const service=await import(${JSON.stringify(paths.service)});
    const closeGeneration=service.OwnerWanT2iGenerationService.prototype.close;
    service.OwnerWanT2iGenerationService.prototype.close=async function(){events.push("generation.close.begin");await closeGeneration.call(this);events.push("generation.close.done")};
    const runtimeModule=await import(${JSON.stringify(paths.runtime)});
    const stdio=await import(${JSON.stringify(paths.stdio)});
    const runtime=runtimeModule.createObservedOwnerRuntime({ownerWanT2iImageEnabled:true,fetchImpl:async()=>{throw Error("unexpected fetch")} });
    const generation=runtime.serverOptions.ownerWanT2iImageReferences.generationService;
    const input=new PassThrough();
    const transport={async start(){},async send(){},async close(){transport.onclose?.()}};
    const drain=stdio.closeOwnerReadServicesOnTransportEof(transport,undefined,undefined,undefined,undefined,()=>events.push("auth.release"),
      input,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,true,generation);
    await drain(); const eofEvents=events.splice(0);
    process.env.SYNTX_OWNER_WAN_T2I_IMAGE="1";
    const failing={on(event){if(event==="end")throw Error("synthetic startup failure");return this},off(){return this}};
    try{await stdio.runObservedOwnerStdioServer(failing)}catch(error){if(error.message!=="synthetic startup failure")throw error}
    console.log(JSON.stringify({eof:eofEvents,startup:events}));
  `;
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined &&
    !name.startsWith("SYNTX_OWNER_") && name !== "SYNTX_PUBLIC_CATALOG_VERSION"));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd(),
    env: { ...cleanEnv, SYNTX_PUBLIC_CATALOG_VERSION: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION }, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout.trim()) as { eof: string[]; startup: string[] };
  assert.deepEqual(observed.eof, ["generation.close.begin", "preparer.close", "generation.close.done", "auth.release"]);
  assert.deepEqual(observed.startup, ["generation.close.begin", "preparer.close", "generation.close.done"]);
});
