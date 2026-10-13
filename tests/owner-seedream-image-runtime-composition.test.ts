import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PassThrough } from "node:stream";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  SYNTX_OWNER_GENERATE_SEEDREAM_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_SEEDREAM_IMAGE_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_SEEDREAM_IMAGE_TOOL_NAME,
  SYNTX_UPLOAD_SEEDREAM_IMAGE_REFERENCE_TOOL_NAME
} from "../src/mcp/owner-seedream-image-tools.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  closeOwnerReadServicesOnTransportEof,
  readOwnerSeedreamImageReferencesFlag,
  runObservedOwnerStdioServer
} from "../src/transports/stdio-owner.js";

test("Seedream owner image-reference flag is strict and default-off", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerSeedreamImageReferencesFlag(value), false);
  assert.equal(readOwnerSeedreamImageReferencesFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerSeedreamImageReferencesFlag(value),
      /Invalid SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES configuration/u);
  }
});

test("Seedream services are absent by default and explicit opt-in composes services and four tools", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    throw new Error("Seedream runtime composition must not access the provider.");
  };
  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(defaultRuntime.serverOptions.ownerSeedreamImageReferences, undefined);
  const defaultServer = createMcpServer(defaultRuntime.application, defaultRuntime.serverOptions);
  const defaultClient = new Client({ name: "seedream-owner-default-test", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  await defaultServer.connect(defaultServerTransport);
  await defaultClient.connect(defaultClientTransport);
  try {
    const names = (await defaultClient.listTools()).tools.map((tool) => tool.name);
    for (const name of [SYNTX_UPLOAD_SEEDREAM_IMAGE_REFERENCE_TOOL_NAME, SYNTX_OWNER_GENERATE_SEEDREAM_IMAGE_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_SEEDREAM_IMAGE_TOOL_NAME, SYNTX_OWNER_LIST_SEEDREAM_IMAGE_RECOVERIES_TOOL_NAME]) {
      assert.equal(names.includes(name), false);
    }
  } finally {
    await defaultClient.close();
    await defaultServer.close();
  }

  const optedInOptions = { ownerSeedreamImageReferencesEnabled: true, fetchImpl } as unknown as
    Parameters<typeof createObservedOwnerRuntime>[0];
  const optedInRuntime = createObservedOwnerRuntime(optedInOptions);
  const composition = optedInRuntime.serverOptions.ownerSeedreamImageReferences;
  assert.ok(composition);
  assert.equal(typeof composition.uploadService.upload, "function");
  assert.equal(typeof composition.uploadService.invalidateAttempt, "function");
  assert.equal(typeof composition.uploadService.close, "function");
  assert.equal(typeof composition.generationService.generate, "function");
  assert.equal(typeof composition.generationService.reconcile, "function");
  assert.equal(typeof composition.generationService.listRecoveries, "function");
  assert.equal(typeof composition.generationService.invalidateAttempt, "function");
  assert.equal(typeof composition.generationService.close, "function");
  const server = createMcpServer(optedInRuntime.application, optedInRuntime.serverOptions);
  const client = new Client({ name: "seedream-owner-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const expected = [SYNTX_UPLOAD_SEEDREAM_IMAGE_REFERENCE_TOOL_NAME, SYNTX_OWNER_GENERATE_SEEDREAM_IMAGE_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_SEEDREAM_IMAGE_TOOL_NAME, SYNTX_OWNER_LIST_SEEDREAM_IMAGE_RECOVERIES_TOOL_NAME];
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map(({ name }) => name).filter((name) => expected.includes(name as typeof expected[number])).sort(),
      [...expected].sort());
  } finally {
    await client.close();
    await server.close();
  }
  assert.equal(fetchCalls, 0);
  await composition.generationService.close();
});

test("Seedream Pro runtime preflight uses the candidate's exact zero-reference batch size and resolution before dispatch", async () => {
  const modelReads: URL[] = [];
  const routes: string[] = [];
  const runtime = createObservedOwnerRuntime({
    ownerSeedreamImageReferencesEnabled: true,
    fetchImpl: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      routes.push(url.pathname);
      if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "100" });
      if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO" });
      if (url.pathname === "/api/v2/get_model_info") {
        modelReads.push(url);
        return Response.json({ access: false, cost: 4, discount_cost: null,
          free_remaining_generations: null, limit: null, show_warning: false });
      }
      throw new Error("Unexpected route before denied synthetic Seedream preflight.");
    }
  });
  const attemptId = "link_seedream_runtime_preflight_0123456789";
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-seedream-attempt");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-seedream-credential" });
  const generation = runtime.serverOptions.ownerSeedreamImageReferences?.generationService;
  assert.ok(generation);
  try {
    await assert.rejects(generation.generate({
      attemptId,
      variant: "seedream-5.0-pro",
      reference_handles: [],
      parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: null, background: null },
      prompt: "Synthetic denied preflight"
    }), (error: unknown) => typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "PREFLIGHT_FAILED");
    assert.equal(modelReads.length, 1);
    assert.equal(modelReads[0]?.searchParams.get("ai_name"), "seedream");
    assert.equal(modelReads[0]?.searchParams.get("batch_size"), "0");
    assert.equal(modelReads[0]?.searchParams.get("resolution"), "1K");
    assert.deepEqual([...modelReads[0]!.searchParams.keys()].sort(), ["ai_name", "batch_size", "model_type", "resolution"]);
    assert.deepEqual(routes, ["/api/v1/user/balance", "/api/v1/user/subscription", "/api/v2/get_model_info"]);
  } finally {
    await generation.close();
  }
});

test("Seedream revoke drains generation before credential revocation and failed drains retain the linked credential", async () => {
  const runtime = createObservedOwnerRuntime({ ownerSeedreamImageReferencesEnabled: true });
  const generation = runtime.serverOptions.ownerSeedreamImageReferences?.generationService;
  assert.ok(generation);
  const attemptId = "link_seedream_runtime_revoke_0123456789";
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-seedream-revoke");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-seedream-revoke-credential" });
  const events: string[] = [];
  const originalInvalidate = generation.invalidateAttempt.bind(generation);
  generation.invalidateAttempt = async (id) => { events.push("seedream.drain"); await originalInvalidate(id); };
  const originalRevoke = runtime.linkService.revoke.bind(runtime.linkService);
  runtime.linkService.revoke = async (...args) => { events.push("credential.revoke"); return originalRevoke(...args); };
  const auth = runtime.serverOptions.auth;
  assert.ok(auth);
  try {
    const revoked = await auth.linkService.revoke(binding, attemptId);
    assert.equal(revoked.status, "REVOKED");
    assert.deepEqual(events, ["seedream.drain", "credential.revoke"]);
  } finally { await generation.close(); }

  const failed = createObservedOwnerRuntime({ ownerSeedreamImageReferencesEnabled: true });
  const failedGeneration = failed.serverOptions.ownerSeedreamImageReferences?.generationService;
  assert.ok(failedGeneration);
  const failedAttempt = "link_seedream_runtime_drain_fail_0123456789";
  const failedBinding = failed.authBinding;
  await failed.authStore.createAttempt({ attempt_id: failedAttempt, binding: failedBinding, expires_at_ms: Date.now() + 60_000 });
  await failed.authStore.beginHandoff(failedBinding, failedAttempt);
  await failed.authStore.attachChallenge(failedBinding, failedAttempt, "synthetic-seedream-drain-failure");
  await failed.authStore.beginPoll(failedBinding, failedAttempt);
  await failed.authStore.markLinked(failedBinding, failedAttempt, { scheme: "Bearer", value: "synthetic-seedream-retained-credential" });
  failedGeneration.invalidateAttempt = async () => { throw new Error("Seedream drain failed"); };
  try {
    await assert.rejects(failed.serverOptions.auth!.linkService.revoke(failedBinding, failedAttempt), /Seedream drain failed/u);
    assert.equal((await failed.linkService.getStatus(failedBinding, failedAttempt)).status, "LINKED");
  } finally { await failedGeneration.close(); }
});

test("stdio EOF closes Seedream generation and its owned upload before closing the auth profile", async () => {
  const runtime = createObservedOwnerRuntime({ ownerSeedreamImageReferencesEnabled: true });
  const composition = runtime.serverOptions.ownerSeedreamImageReferences;
  assert.ok(composition);
  const events: string[] = [];
  const originalGenerationClose = composition.generationService.close.bind(composition.generationService);
  composition.generationService.close = async () => { events.push("seedream.generation.close"); await originalGenerationClose(); };
  const originalUploadClose = composition.uploadService.close.bind(composition.uploadService);
  composition.uploadService.close = async () => { events.push("seedream.upload.close"); await originalUploadClose(); };
  const input = new PassThrough();
  let transport!: Transport;
  let signalTransportClosed!: () => void;
  const transportClosed = new Promise<void>((resolve) => { signalTransportClosed = resolve; });
  transport = { async start() {}, async send() {}, async close() { transport.onclose?.(); signalTransportClosed(); } };
  const close = closeOwnerReadServicesOnTransportEof(
    transport, undefined, undefined, undefined, undefined,
    () => { events.push("auth.profile.close"); }, input,
    undefined, undefined, undefined, undefined, undefined, undefined, composition.generationService
  );
  input.resume();
  input.push(null);
  await transportClosed;
  await close();
  assert.deepEqual(events, ["seedream.generation.close", "seedream.upload.close", "auth.profile.close"]);
  input.destroy();
});

test("owner stdio rejects a noncanonical Seedream flag and forbids combining opt-in with durable generation", async () => {
  const names = ["SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES", "SYNTX_OWNER_DURABLE_GENERATION"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES = "true";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES configuration/u);
    process.env.SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Durable owner generation cannot be combined/u);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
