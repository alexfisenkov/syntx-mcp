import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PassThrough } from "node:stream";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  SYNTX_UPLOAD_RUNWAY_IMAGE_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_RUNWAY_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_RUNWAY_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_RUNWAY_IMAGE_RECOVERIES_TOOL_NAME
} from "../src/mcp/owner-runway-image-tools.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  closeOwnerReadServicesOnTransportEof,
  readOwnerRunwayImageReferencesFlag,
  runObservedOwnerStdioServer
} from "../src/transports/stdio-owner.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";

test("Runway owner image reference flag is strict and default-off", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerRunwayImageReferencesFlag(value), false);
  assert.equal(readOwnerRunwayImageReferencesFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerRunwayImageReferencesFlag(value),
      /Invalid SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES configuration/u);
  }
});

test("Runway owner image services are absent by default and opt-in composes without startup traffic", async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error("Runway runtime composition must not access the provider.");
  };
  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl: fetchImpl as typeof fetch });
  assert.equal(defaultRuntime.serverOptions.ownerRunwayImageReferences, undefined);
  const defaultServer = createMcpServer(defaultRuntime.application, defaultRuntime.serverOptions);
  const defaultClient = new Client({ name: "runway-owner-default-test", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  await defaultServer.connect(defaultServerTransport);
  await defaultClient.connect(defaultClientTransport);
  try {
    const names = (await defaultClient.listTools()).tools.map((tool) => tool.name);
    for (const name of [SYNTX_UPLOAD_RUNWAY_IMAGE_REFERENCE_TOOL_NAME,
      SYNTX_OWNER_GENERATE_RUNWAY_IMAGE_TOOL_NAME, SYNTX_OWNER_RECONCILE_RUNWAY_IMAGE_TOOL_NAME,
      SYNTX_OWNER_LIST_RUNWAY_IMAGE_RECOVERIES_TOOL_NAME]) assert.equal(names.includes(name), false);
  } finally {
    await defaultClient.close();
    await defaultServer.close();
  }

  const optedInRuntime = createObservedOwnerRuntime({
    ownerRunwayImageReferencesEnabled: true,
    fetchImpl: fetchImpl as typeof fetch
  });
  const composition = optedInRuntime.serverOptions.ownerRunwayImageReferences;
  assert.ok(composition);
  assert.ok(composition.uploadService);
  assert.ok(composition.generationService);
  assert.equal(fetchCalls, 0);
  let uploadClosed = 0;
  const originalUploadClose = composition.uploadService.close.bind(composition.uploadService);
  composition.uploadService.close = async () => { uploadClosed += 1; await originalUploadClose(); };
  await composition.generationService.close();
  assert.equal(uploadClosed, 1);
});

test("Runway owner runtime exposes only four native closed tools on explicit opt-in", async () => {
  const namesExpected = [SYNTX_UPLOAD_RUNWAY_IMAGE_REFERENCE_TOOL_NAME,
    SYNTX_OWNER_GENERATE_RUNWAY_IMAGE_TOOL_NAME, SYNTX_OWNER_RECONCILE_RUNWAY_IMAGE_TOOL_NAME,
    SYNTX_OWNER_LIST_RUNWAY_IMAGE_RECOVERIES_TOOL_NAME];
  const providerRoutes: string[] = [];
  const runtime = createObservedOwnerRuntime({
    ownerRunwayImageReferencesEnabled: true,
    publicCatalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    fetchImpl: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      providerRoutes.push(url.pathname);
      if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "100" });
      if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO" });
      if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: false, cost: 4, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: false });
      throw new Error("Unexpected provider route in synthetic SDK call.");
    }
  });
  const composition = runtime.serverOptions.ownerRunwayImageReferences;
  assert.ok(composition);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "runway-owner-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = (await client.listTools()).tools;
    const names = tools.map((tool) => tool.name);
    assert.equal(names.filter((name) => namesExpected.includes(name as typeof namesExpected[number])).length, 4);
    for (const name of namesExpected) {
      const tool = tools.find((entry) => entry.name === name);
      assert.ok(tool);
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal(tool.outputSchema?.additionalProperties, false);
    }
    const invalid = await client.callTool({ name: SYNTX_OWNER_GENERATE_RUNWAY_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: "link_runway_invalid_schema_0123456789", variant: "runway_frames", reference_handles: [],
      parameters: { resolution: "not-a-source-resolution", temperature: 3 }, prompt: "No dispatch", extra: true
    } });
    assert.equal(invalid.isError, true);
    assert.deepEqual(providerRoutes, []);
    const attemptId = "link_runway_native_call_0123456789";
    const binding = runtime.authBinding;
    await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
    await runtime.authStore.beginHandoff(binding, attemptId);
    await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-runway-sdk-call");
    await runtime.authStore.beginPoll(binding, attemptId);
    await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-runway-sdk-credential" });
    const denied = await client.callTool({ name: SYNTX_OWNER_GENERATE_RUNWAY_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: attemptId, variant: "runway_frames", reference_handles: [],
      parameters: { resolution: "1088x1088", temperature: 2.375 }, prompt: "Synthetic denied preflight"
    } });
    assert.equal(denied.isError, true);
    assert.doesNotMatch(JSON.stringify(denied), /synthetic-runway-sdk-credential/u);
    assert.deepEqual(providerRoutes, ["/api/v1/user/balance", "/api/v1/user/subscription", "/api/v2/get_model_info"]);
  } finally {
    await client.close();
    await server.close();
    await composition.generationService.close();
  }
});

test("Runway generation preflight uses fresh account status and exact empty source cost keys", async () => {
  const modelReads: URL[] = [];
  const accountReads: string[] = [];
  const runtime = createObservedOwnerRuntime({
    ownerRunwayImageReferencesEnabled: true,
    fetchImpl: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/api/v1/user/balance") {
        accountReads.push(url.pathname);
        return Response.json({ balance: "100" });
      }
      if (url.pathname === "/api/v1/user/subscription") {
        accountReads.push(url.pathname);
        return Response.json({ active: true, type: "PRO" });
      }
      if (url.pathname === "/api/v2/get_model_info") {
        modelReads.push(url);
        return Response.json({ access: false, cost: 4, discount_cost: null,
          free_remaining_generations: null, limit: null, show_warning: false });
      }
      throw new Error("Unexpected route before denied synthetic preflight.");
    }
  });
  const attemptId = "link_runway_runtime_preflight_0123456789";
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-runway-attempt");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-runway-credential" });
  const generation = runtime.serverOptions.ownerRunwayImageReferences?.generationService;
  assert.ok(generation);
  try {
    await assert.rejects(generation.generate({
      attemptId,
      variant: "runway_frames",
      reference_handles: [],
      parameters: { resolution: "1088x1088", temperature: 1.375 },
      prompt: "Synthetic denied preflight"
    }), (error: unknown) => typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "PREFLIGHT_FAILED");
    assert.equal(accountReads.length, 2);
    assert.equal(modelReads.length, 1);
    assert.equal(modelReads[0]?.searchParams.get("ai_name"), "runway-frames");
    assert.equal(modelReads[0]?.searchParams.get("model_type"), "runway_frames");
    assert.deepEqual([...modelReads[0]!.searchParams.keys()].sort(), ["ai_name", "model_type"]);
  } finally {
    await generation.close();
  }
});

test("Runway revoke and EOF drain both services before auth cleanup; a failed drain preserves the link", async () => {
  const runtime = createObservedOwnerRuntime({ ownerRunwayImageReferencesEnabled: true });
  const composition = runtime.serverOptions.ownerRunwayImageReferences;
  assert.ok(composition);
  const attemptId = "link_runway_runtime_revoke_0123456789";
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-runway-revoke");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-runway-credential" });
  const events: string[] = [];
  const generation = composition.generationService;
  const originalInvalidate = generation.invalidateAttempt.bind(generation);
  generation.invalidateAttempt = async (id) => { events.push("runway.drain"); await originalInvalidate(id); };
  const originalRevoke = runtime.linkService.revoke.bind(runtime.linkService);
  runtime.linkService.revoke = async (...args) => { events.push("credential.revoke"); return originalRevoke(...args); };
  const auth = runtime.serverOptions.auth;
  assert.ok(auth);
  const revoked = await auth.linkService.revoke(binding, attemptId);
  assert.equal(revoked.status, "REVOKED");
  assert.deepEqual(events, ["runway.drain", "credential.revoke"]);
  await auth.onRevoked?.(attemptId);
  assert.deepEqual(events, ["runway.drain", "credential.revoke", "runway.drain"]);

  const eofEvents: string[] = [];
  const input = new PassThrough();
  let transport!: Transport;
  let signalTransportClosed!: () => void;
  const transportClosed = new Promise<void>((resolve) => { signalTransportClosed = resolve; });
  transport = { async start() {}, async send() {}, async close() { transport.onclose?.(); signalTransportClosed(); } };
  const close = closeOwnerReadServicesOnTransportEof(
    transport, undefined, undefined, undefined, undefined,
    () => { eofEvents.push("auth.close"); }, input,
    undefined, undefined, undefined, undefined, undefined,
    { async close() { eofEvents.push("runway.generation.close"); } }
  );
  input.resume();
  input.push(null);
  await transportClosed;
  await close();
  assert.deepEqual(eofEvents, ["runway.generation.close", "auth.close"]);
  input.destroy();

  const failed = createObservedOwnerRuntime({ ownerRunwayImageReferencesEnabled: true });
  const failingService = failed.serverOptions.ownerRunwayImageReferences?.generationService;
  assert.ok(failingService);
  const failedAttempt = "link_runway_runtime_revoke_failure_0123456789";
  const failedBinding = failed.authBinding;
  await failed.authStore.createAttempt({ attempt_id: failedAttempt, binding: failedBinding, expires_at_ms: Date.now() + 60_000 });
  await failed.authStore.beginHandoff(failedBinding, failedAttempt);
  await failed.authStore.attachChallenge(failedBinding, failedAttempt, "synthetic-runway-revoke-failure");
  await failed.authStore.beginPoll(failedBinding, failedAttempt);
  await failed.authStore.markLinked(failedBinding, failedAttempt, { scheme: "Bearer", value: "synthetic-runway-failure-credential" });
  failingService.invalidateAttempt = async () => { throw new Error("Runway drain failed"); };
  try {
    await assert.rejects(failed.serverOptions.auth!.linkService.revoke(failedBinding, failedAttempt), /Runway drain failed/u);
    assert.equal((await failed.linkService.getStatus(failedBinding, failedAttempt)).status, "LINKED");
  } finally {
    await generation.close();
    await failingService.close();
  }
});

test("Runway opt-in rejects source drift, invalid flags, and durable paid composition", async () => {
  assert.throws(() => createObservedOwnerRuntime({
    ownerRunwayImageReferencesEnabled: true,
    publicCatalogVersion: "sha256-3c1ceb7c199054fad6ff2653f0bba6a16f09b80c8531a4d94776e6ee08b0f609.json"
  }), /selected e551 source-pinned public catalog/u);
  const names = ["SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES", "SYNTX_OWNER_DURABLE_GENERATION"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES = "true";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES configuration/u);
    process.env.SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Durable owner generation cannot be combined/u);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
