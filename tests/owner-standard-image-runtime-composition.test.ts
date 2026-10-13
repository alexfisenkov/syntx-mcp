import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resolve } from "node:path";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_STANDARD_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_STANDARD_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_STANDARD_IMAGE_RECOVERIES_TOOL_NAME
} from "../src/mcp/owner-standard-image-tools.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  closeOwnerReadServicesOnTransportEof,
  readOwnerStandardImageReferencesFlag,
  runObservedOwnerStdioServer
} from "../src/transports/stdio-owner.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { PassThrough } from "node:stream";

test("standard image owner flag is strict and default-off", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerStandardImageReferencesFlag(value), false);
  assert.equal(readOwnerStandardImageReferencesFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerStandardImageReferencesFlag(value),
      /Invalid SYNTX_OWNER_STANDARD_IMAGE_REFERENCES configuration/u);
  }
});

test("standard image owner composition is absent by default and opt-in adds the four SDK tools without startup traffic", async () => {
  const standardImageToolNames = [SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_TOOL_NAME,
    SYNTX_OWNER_GENERATE_STANDARD_IMAGE_TOOL_NAME, SYNTX_OWNER_RECONCILE_STANDARD_IMAGE_TOOL_NAME,
    SYNTX_OWNER_LIST_STANDARD_IMAGE_RECOVERIES_TOOL_NAME];
  let fetchCalls = 0;
  const defaultRuntime = createObservedOwnerRuntime({
    publicCatalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    catalogDirectory: resolve(process.cwd(), "catalog"),
    fetchImpl: async () => { fetchCalls += 1; throw new Error("runtime construction must not fetch"); }
  });
  assert.equal(defaultRuntime.serverOptions.ownerStandardImageReferences, undefined);
  const defaultServer = createMcpServer(defaultRuntime.application, defaultRuntime.serverOptions);
  const defaultClient = new Client({ name: "standard-owner-default-test", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  await defaultServer.connect(defaultServerTransport);
  await defaultClient.connect(defaultClientTransport);
  try {
    const names = (await defaultClient.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.filter((name) => standardImageToolNames.includes(name as typeof standardImageToolNames[number])).length, 0);
  } finally {
    await defaultClient.close();
    await defaultServer.close();
  }

  const runtime = createObservedOwnerRuntime({
    ownerStandardImageReferencesEnabled: true,
    publicCatalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    catalogDirectory: resolve(process.cwd(), "catalog"),
    fetchImpl: async () => { fetchCalls += 1; throw new Error("runtime construction must not fetch"); }
  });
  const composition = runtime.serverOptions.ownerStandardImageReferences;
  assert.ok(composition);
  assert.equal(fetchCalls, 0);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "standard-owner-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.filter((name) => standardImageToolNames.includes(name as typeof standardImageToolNames[number])).length, 4);
  } finally {
    await client.close();
    await server.close();
    await composition.generationService.close();
  }
});

test("standard generation drains before credential revoke and EOF cleanup precedes auth close", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { onclose: undefined, async close() {} } as unknown as Transport;
  const close = closeOwnerReadServicesOnTransportEof(
    transport, undefined, undefined, undefined, undefined,
    () => { events.push("auth.close"); }, input,
    undefined, undefined, undefined, undefined,
    { async close() { events.push("standard.generation.close"); } }
  );
  await close();
  await close();
  assert.deepEqual(events, ["standard.generation.close", "auth.close"]);
  input.destroy();
});

test("standard revoke drains before credential revocation and preserves the WAN pre-revoke guard", async () => {
  const events: string[] = [];
  const runtime = createObservedOwnerRuntime({ ownerStandardImageReferencesEnabled: true, ownerWanImageReferencesEnabled: true });
  const standard = runtime.serverOptions.ownerStandardImageReferences?.generationService;
  const wan = runtime.serverOptions.ownerWanImageReferences?.generationService;
  assert.ok(standard && wan);
  const attemptId = "link_standard_runtime_revoke_0123456789";
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-standard-revoke");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-standard-revoke-credential" });

  const originalStandardInvalidate = standard.invalidateAttempt.bind(standard);
  standard.invalidateAttempt = async (id) => { events.push("standard.invalidate"); await originalStandardInvalidate(id); };
  const originalWanInvalidate = wan.invalidateAttempt.bind(wan);
  wan.invalidateAttempt = async (id) => { events.push("wan.invalidate"); await originalWanInvalidate(id); };
  const originalStoreRevoke = runtime.authStore.revoke.bind(runtime.authStore);
  runtime.authStore.revoke = async (...args) => { events.push("credential.revoke"); return originalStoreRevoke(...args); };
  try {
    const auth = runtime.serverOptions.auth;
    assert.ok(auth);
    const revoked = await auth.linkService.revoke(binding, attemptId);
    assert.equal(revoked.status, "REVOKED");
    await auth.onRevoked?.(attemptId);
    assert.deepEqual(events, ["wan.invalidate", "standard.invalidate", "credential.revoke", "standard.invalidate"]);
  } finally {
    await Promise.all([standard.close(), wan.close()]);
  }
});

test("failed standard pre-revoke drain preserves the linked credential", async () => {
  const runtime = createObservedOwnerRuntime({ ownerStandardImageReferencesEnabled: true });
  const generation = runtime.serverOptions.ownerStandardImageReferences?.generationService;
  assert.ok(generation);
  const attemptId = "link_standard_runtime_revoke_fail_0123456789";
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-standard-revoke-failure");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-standard-credential" });
  generation.invalidateAttempt = async () => { throw new Error("generation drain failed"); };
  try {
    const auth = runtime.serverOptions.auth;
    assert.ok(auth);
    await assert.rejects(auth.linkService.revoke(binding, attemptId), /generation drain failed/u);
    assert.equal((await runtime.linkService.getStatus(binding, attemptId)).status, "LINKED");
  } finally {
    await generation.close();
  }
});

test("standard image opt-in rejects source drift, invalid stdio flags, and durable paid mode", async () => {
  assert.throws(() => createObservedOwnerRuntime({
    ownerStandardImageReferencesEnabled: true,
    publicCatalogVersion: "sha256-3c1ceb7c199054fad6ff2653f0bba6a16f09b80c8531a4d94776e6ee08b0f609.json"
  }), /selected e551 source-pinned public catalog/u);

  const names = ["SYNTX_OWNER_STANDARD_IMAGE_REFERENCES", "SYNTX_OWNER_DURABLE_GENERATION"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.SYNTX_OWNER_STANDARD_IMAGE_REFERENCES = "true";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_STANDARD_IMAGE_REFERENCES configuration/u);
    process.env.SYNTX_OWNER_STANDARD_IMAGE_REFERENCES = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Durable owner generation cannot be combined/u);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Banana/GPT model access uses exact source cost keys and omits zero-reference aliases", async () => {
  const modelReads: URL[] = [];
  const runtime = createObservedOwnerRuntime({
    ownerStandardImageReferencesEnabled: true,
    fetchImpl: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "100" });
      if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO" });
      if (url.pathname === "/api/v2/get_model_info") {
        modelReads.push(url);
        return Response.json({ access: false, cost: 4, discount_cost: null,
          free_remaining_generations: null, limit: null, show_warning: false });
      }
      throw new Error("Unexpected provider route in denied synthetic preflight.");
    }
  });
  const attemptId = "link_standard_runtime_cost_0123456789";
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-standard-attempt");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-standard-credential" });
  const service = runtime.serverOptions.ownerStandardImageReferences?.generationService;
  assert.ok(service);
  try {
    await assert.rejects(service.generate({ attemptId, variant: "gpt-image-1", reference_handles: [],
      parameters: { aspect_ratio: "1:1", quality: null, details_quality: null }, prompt: "Synthetic denied preflight" }),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "PREFLIGHT_FAILED");
    assert.equal(modelReads.length, 1);
    assert.equal(modelReads[0]?.searchParams.get("ai_name"), "sora-images");
    assert.equal(modelReads[0]?.searchParams.get("model_type"), "gpt-image-1");
    assert.deepEqual([...modelReads[0]!.searchParams.keys()].sort(), ["ai_name", "model_type"]);
  } finally {
    await service.close();
  }
});
