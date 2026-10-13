import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { OwnerSoulCharacterOptionsService } from "../src/application/owner-soul-character-options-service.js";
import { OwnerSoulImageGenerationService } from "../src/application/owner-soul-image-generation-service.js";
import { OwnerSoulStyleOptionsService } from "../src/application/owner-soul-style-options-service.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";
import { SYNTX_LIST_OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME } from "../src/mcp/owner-soul-style-options-tool.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";

const STDIO_OWNER_URL = new URL("../src/transports/stdio-owner.js", import.meta.url).href;

async function linkSyntheticAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string,
  nowMs = Date.now()): Promise<void> {
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: nowMs + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: `synthetic-${attemptId}-credential` });
}

test("Soul image owner flag is strict and enabled only by the exact value 1", async () => {
  const module = await import(STDIO_OWNER_URL) as Record<string, unknown>;
  assert.equal(typeof module.readOwnerSoulImageReferencesFlag, "function", "MISSING_SOUL_IMAGE_RUNTIME_FLAG_READER");
  const read = module.readOwnerSoulImageReferencesFlag as (value: string | undefined) => boolean;
  for (const value of [undefined, "", "0"]) assert.equal(read(value), false);
  assert.equal(read("1"), true);
  for (const value of ["true", " 1", "1 ", "01", "false"]) {
    assert.throws(() => read(value), /Invalid SYNTX_OWNER_SOUL_IMAGE_REFERENCES configuration/u);
  }
});

test("owner stdio rejects malformed Soul image flag and durable-mode conflict before startup", async () => {
  const originalOwnerVariables = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  try {
    for (const name of originalOwnerVariables.keys()) delete process.env[name];
    process.env.SYNTX_OWNER_SOUL_IMAGE_REFERENCES = "true";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_SOUL_IMAGE_REFERENCES configuration/u);
    process.env.SYNTX_OWNER_SOUL_IMAGE_REFERENCES = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Durable owner generation cannot be combined/u);
  } finally {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of originalOwnerVariables) process.env[name] = value;
  }
});

test("stdio startup failure closes the composed Soul generation service and both selectors", async () => {
  const environment = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const events: string[] = [];
  const originalGenerationClose = OwnerSoulImageGenerationService.prototype.close;
  OwnerSoulImageGenerationService.prototype.close = async function () {
    events.push("generation.close");
    return originalGenerationClose.call(this);
  };
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_SOUL_IMAGE_REFERENCES = "1";
    const failingInput = {
      on(event: string) {
        if (event === "end") throw new Error("synthetic stdio startup failure");
        return this;
      },
      off() { return this; }
    } as unknown as Readable;
    await assert.rejects(runObservedOwnerStdioServer(failingInput), /synthetic stdio startup failure/u);
    assert.deepEqual(events, ["generation.close"]);
  } finally {
    OwnerSoulImageGenerationService.prototype.close = originalGenerationClose;
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of environment) process.env[name] = value;
  }
});

test("opt-in composes the actual Soul generation and selector services without startup traffic", async () => {
  let fetches = 0;
  const runtime = createObservedOwnerRuntime({ ownerSoulImageReferencesEnabled: true, fetchImpl: async () => {
    fetches += 1;
    throw new Error("Soul runtime composition must not perform startup I/O.");
  } });
  const composition = runtime.serverOptions.ownerSoulImageReferences;
  assert.ok(composition, "MISSING_SOUL_IMAGE_RUNTIME_COMPOSITION");
  assert.ok(composition.generationService instanceof OwnerSoulImageGenerationService);
  assert.ok(composition.characterOptionsService instanceof OwnerSoulCharacterOptionsService);
  assert.ok(runtime.serverOptions.ownerSoulStyleOptions instanceof OwnerSoulStyleOptionsService,
    "the existing style-list service remains available through the same Soul opt-in");
  assert.equal(fetches, 0);
  await composition.generationService.close();
});

test("Soul stdio opt-in exposes exactly four Soul tools plus the shared Style list tool", async () => {
  const flags = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined &&
    !name.startsWith("SYNTX_OWNER_") && name !== "SYNTX_PUBLIC_CATALOG_VERSION"));
  const entrypoint = fileURLToPath(STDIO_OWNER_URL);
  const runClient = async (enabled: boolean): Promise<string[]> => {
    const client = new Client({ name: "soul-runtime-tools-test", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [entrypoint], cwd: process.cwd(),
      env: { ...flags, SYNTX_PUBLIC_CATALOG_VERSION: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        ...(enabled ? { SYNTX_OWNER_SOUL_IMAGE_REFERENCES: "1" } : {}) }, stderr: "pipe" });
    await client.connect(transport as unknown as Transport);
    try { return (await client.listTools()).tools.map(({ name }) => name); }
    finally { await client.close(); }
  };
  const defaultNames = await runClient(false);
  const soulNames = ["syntx_owner_generate_soul_image", "syntx_owner_reconcile_soul_image",
    "syntx_owner_list_soul_image_recoveries", "syntx_list_owner_soul_character_options"];
  for (const name of soulNames) assert.equal(defaultNames.includes(name), false);
  assert.equal(defaultNames.includes(SYNTX_LIST_OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME), false);
  const enabledNames = await runClient(true);
  for (const name of soulNames) assert.equal(enabledNames.includes(name), true);
  assert.equal(enabledNames.includes(SYNTX_LIST_OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME), true,
    "Soul opt-in must expose the shared Style selector even without its older independent flag");
  assert.equal(soulNames.filter((name) => enabledNames.includes(name)).length, 4);
});

test("Soul EOF drain closes generation-owned selectors before auth-release callback", async () => {
  const events: string[] = [];
  const runtime = createObservedOwnerRuntime({ ownerSoulImageReferencesEnabled: true, fetchImpl: async () => {
    throw new Error("No startup requests are expected.");
  } });
  const composition = runtime.serverOptions.ownerSoulImageReferences;
  assert.ok(composition);
  const generationService = composition.generationService;
  const originalGenerationClose = generationService.close.bind(generationService);
  const originalStyleClose = runtime.serverOptions.ownerSoulStyleOptions!.close.bind(runtime.serverOptions.ownerSoulStyleOptions);
  assert.ok(composition.characterOptionsService instanceof OwnerSoulCharacterOptionsService);
  const characterOptionsService = composition.characterOptionsService;
  const originalCharacterClose = characterOptionsService.close.bind(characterOptionsService);
  generationService.close = async () => { events.push("generation.begin"); await originalGenerationClose(); events.push("generation.done"); };
  runtime.serverOptions.ownerSoulStyleOptions!.close = async () => { events.push("style.close"); await originalStyleClose(); };
  characterOptionsService.close = async () => { events.push("character.close"); await originalCharacterClose(); };
  const input = new PassThrough();
  const transport: Transport = { async start() {}, async send() {}, async close() { transport.onclose?.(); } };
  const close = closeOwnerReadServicesOnTransportEof(transport, undefined, undefined, undefined, undefined,
    () => { events.push("auth.release"); }, input, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, generationService, true);
  try {
    await close();
    assert.deepEqual(events, ["generation.begin", "generation.done", "auth.release"]);
    await assert.rejects(runtime.serverOptions.ownerSoulStyleOptions!.listOptions({ attemptId: "link_soul_eof_closed_000000000001" }),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error &&
        (error as { code?: unknown }).code === "SERVICE_CLOSED");
    await assert.rejects(composition.characterOptionsService.listOptions({ attemptId: "link_soul_eof_closed_000000000001" }),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error &&
        (error as { code?: unknown }).code === "SERVICE_CLOSED");
    await close();
    assert.equal(events.filter((event) => event === "auth.release").length, 1);
  } finally { input.destroy(); }
});

test("failed Soul generation drain keeps auth binding and fails closed", async () => {
  const attemptId = "link_soul_runtime_eof_failure_000000000001";
  const runtime = createObservedOwnerRuntime({ ownerSoulImageReferencesEnabled: true, fetchImpl: async () => {
    throw new Error("No upstream request is expected for close-failure fixture.");
  } });
  const composition = runtime.serverOptions.ownerSoulImageReferences;
  assert.ok(composition);
  await linkSyntheticAttempt(runtime, attemptId);
  const generationService = composition.generationService;
  const originalClose = generationService.close.bind(generationService);
  generationService.close = async () => { throw new Error("synthetic Soul generation drain failure"); };
  const input = new PassThrough();
  const transport: Transport = { async start() {}, async send() {}, async close() { transport.onclose?.(); } };
  const close = closeOwnerReadServicesOnTransportEof(transport, undefined, undefined, undefined, undefined,
    () => runtime.authStore.close?.(), input, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, generationService, true);
  const previousExitCode = process.exitCode;
  try {
    await assert.rejects(close(), /synthetic Soul generation drain failure/u);
    assert.equal((await runtime.linkService.getStatus(runtime.authBinding, attemptId)).status, "LINKED",
      "auth remains usable if generation/selector drain failed");
  } finally {
    process.exitCode = previousExitCode;
    generationService.close = originalClose;
    await originalClose();
    input.destroy();
  }
});

test("Soul attempt revoke invalidates generation and selector capabilities before revoking auth", async () => {
  const attemptId = "link_soul_runtime_revoke_000000000001";
  const runtime = createObservedOwnerRuntime({ ownerSoulImageReferencesEnabled: true, fetchImpl: async () => {
    throw new Error("No upstream request is expected for invalidation.");
  } });
  const composition = runtime.serverOptions.ownerSoulImageReferences;
  assert.ok(composition);
  await linkSyntheticAttempt(runtime, attemptId);
  const events: string[] = [];
  const generationService = composition.generationService;
  const originalInvalidate = generationService.invalidateAttempt.bind(generationService);
  generationService.invalidateAttempt = async (value) => {
    events.push("generation.invalidate.begin");
    await originalInvalidate(value);
    events.push("generation.invalidate.done");
  };
  const store = runtime.authStore;
  const originalRevoke = store.revoke.bind(store);
  store.revoke = async (binding, value) => {
    events.push("auth.revoke");
    return originalRevoke(binding, value);
  };
  try {
    const ownerAuth = runtime.serverOptions.auth;
    assert.ok(ownerAuth);
    await ownerAuth.linkService.revoke(runtime.authBinding, attemptId);
    assert.deepEqual(events, ["generation.invalidate.begin", "generation.invalidate.done", "auth.revoke"]);
    assert.equal((await runtime.linkService.getStatus(runtime.authBinding, attemptId)).status, "REVOKED");
  } finally { await generationService.close(); }
});

test("runtime builds two fresh actual account/access preflights and keeps cost keys separate from routing", async () => {
  const fixtureNow = Date.now();
  const subscriptionEndDate = new Date(fixtureNow + 24 * 60 * 60_000).toISOString();
  const attemptId = "link_soul_runtime_test_000000000001";
  const routes: Array<{ method: string; url: URL }> = [];
  const modelReads: URL[] = [];
  let chatCreates = 0;
  let generationPosts = 0;
  const runtime = createObservedOwnerRuntime({ ownerSoulImageReferencesEnabled: true, now: () => fixtureNow,
    fetchImpl: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      routes.push({ method, url });
      if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
      if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: subscriptionEndDate });
      if (url.pathname === "/api/v1/hf/lora/styles") return Response.json({
        items: [{ style_id: "runtime-private-style-id", name: "Runtime style", image: "https://images.invalid/runtime-style.png" }], total: 1
      });
      if (url.pathname === "/api/v1/hf/lora/list") return Response.json({
        items: [{ id: "runtime-private-record-id", reference_id: "runtime-typed-reference-id", title: "Runtime Character", status: "completed" }], total: 1
      });
      if (url.pathname === "/api/v2/get_model_info") {
        modelReads.push(url);
        return Response.json({ access: modelReads.length === 1, cost: 2, discount_cost: null,
          free_remaining_generations: null, limit: null, show_warning: false });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        chatCreates += 1;
        return Response.json({ uuid: "soul-runtime-chat" });
      }
      if (url.pathname === "/api/v2/design/generate" && method === "POST") {
        generationPosts += 1;
        return Response.json({ id: "unexpected-generation-ack" });
      }
      throw new Error(`Unexpected synthetic Soul runtime route ${method} ${url.pathname}`);
    }
  });
  const generationService = runtime.serverOptions.ownerSoulImageReferences?.generationService;
  assert.ok(generationService);
  await linkSyntheticAttempt(runtime, attemptId, fixtureNow);
  try {
    const styleOptions = await runtime.serverOptions.ownerSoulStyleOptions!.listOptions({ attemptId });
    const characterOptions = await runtime.serverOptions.ownerSoulImageReferences!.characterOptionsService.listOptions({ attemptId });
    await assert.rejects(generationService.generate({ attemptId, input: { prompt: "Synthetic second-preflight denial",
      quality: "720p", resolution: "2048x1152", batch_size: 1, enhance_prompt: false, seed: null,
      style: { kind: "selected", style_handle: styleOptions.options[0]!.style_handle, strength: 0.7 },
      character: { kind: "selected", character_handle: characterOptions.options[0]!.character_handle! } } }),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "PREFLIGHT_FAILED");
    assert.deepEqual(routes.filter(({ url }) => url.pathname === "/api/v1/user/balance").map(() => "balance"), ["balance", "balance"]);
    assert.deepEqual(routes.filter(({ url }) => url.pathname === "/api/v1/user/subscription").map(() => "subscription"), ["subscription", "subscription"]);
    assert.equal(routes.filter(({ url }) => url.pathname === "/api/v1/hf/lora/styles").length, 2,
      "the preparer revalidates the exact Style service that issued the selected handle");
    assert.equal(routes.filter(({ url }) => url.pathname === "/api/v1/hf/lora/list").length, 2,
      "the preparer revalidates the exact Character service that issued the selected handle");
    assert.equal(modelReads.length, 2);
    for (const url of modelReads) {
      assert.equal(url.searchParams.get("ai_name"), "higgsfield-soul");
      assert.equal(url.searchParams.get("model_type"), "higgsfield-soul");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "batch_size", "model_type", "quality", "resolution"]);
      assert.equal(url.searchParams.has("version"), false);
    }
    assert.equal(chatCreates, 1, "the first fresh preflight must pass before a chat is created");
    assert.equal(generationPosts, 0, "the denied second fresh preflight prevents the one-shot native POST");
  } finally { await generationService.close(); }
});
