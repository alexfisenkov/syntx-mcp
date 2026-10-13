import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { PassThrough } from "node:stream";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import * as ownerStdio from "../src/transports/stdio-owner.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";
import { openPrivateOwnerAuthProfile } from "../src/auth/private-owner-auth-profile.js";

const FLUX_TOOL_NAMES = [
  "syntx_upload_flux_image_reference",
  "syntx_register_flux_public_lora",
  "syntx_owner_generate_flux_image",
  "syntx_owner_reconcile_flux_image",
  "syntx_owner_list_flux_image_recoveries"
] as const;

function fluxRuntimeOptions(extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    ownerFluxImageReferencesEnabled: true
  } as unknown as Parameters<typeof createObservedOwnerRuntime>[0];
}

async function createLinkedAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string) {
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, `synthetic-flux-${attemptId.slice(-8)}`);
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-flux-credential" });
  return binding;
}

test("Flux owner-reference feature gate is strict and default-off", () => {
  const stdio = ownerStdio as unknown as Record<string, unknown>;
  assert.equal(typeof stdio.readOwnerFluxImageReferencesFlag, "function");
  const readFlag = stdio.readOwnerFluxImageReferencesFlag as (value: string | undefined) => boolean;
  for (const value of [undefined, "", "0"]) assert.equal(readFlag(value), false);
  assert.equal(readFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) assert.throws(() => readFlag(value));
});

test("Flux owner runtime is absent by default and explicit opt-in composes five tools without startup traffic", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    throw new Error("Flux runtime construction must not call the provider.");
  };
  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl });
  assert.equal((defaultRuntime.serverOptions as unknown as { ownerFluxImageReferences?: unknown }).ownerFluxImageReferences, undefined);
  const defaultServer = createMcpServer(defaultRuntime.application, defaultRuntime.serverOptions);
  const defaultClient = new Client({ name: "flux-owner-default-test", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  await defaultServer.connect(defaultServerTransport);
  await defaultClient.connect(defaultClientTransport);
  try {
    const names = (await defaultClient.listTools()).tools.map(({ name }) => name);
    for (const name of FLUX_TOOL_NAMES) assert.equal(names.includes(name), false);
  } finally {
    await defaultClient.close();
    await defaultServer.close();
  }

  const runtime = createObservedOwnerRuntime(fluxRuntimeOptions({ fetchImpl }));
  const composition = (runtime.serverOptions as unknown as { ownerFluxImageReferences?: {
    uploadService: { upload: unknown };
    assetService: { registerPublicLora: unknown };
    generationService: { generate: unknown; reconcile: unknown; listRecoveries: unknown; invalidateAttempt: unknown; close: () => Promise<void> };
  } }).ownerFluxImageReferences;
  assert.ok(composition);
  assert.equal(typeof composition.uploadService.upload, "function");
  assert.equal(typeof composition.assetService.registerPublicLora, "function");
  for (const method of ["generate", "reconcile", "listRecoveries", "invalidateAttempt", "close"] as const) {
    assert.equal(typeof composition.generationService[method], "function");
  }
  assert.equal(fetchCalls, 0);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "flux-owner-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => FLUX_TOOL_NAMES.includes(name as typeof FLUX_TOOL_NAMES[number])).sort(),
      [...FLUX_TOOL_NAMES].sort());
  } finally {
    await client.close();
    await server.close();
    await composition.generationService.close();
  }
});

test("Flux opt-in rejects source drift, invalid stdio flags, and durable paid mode", async () => {
  assert.throws(() => createObservedOwnerRuntime(fluxRuntimeOptions({
    publicCatalogVersion: "sha256-3c1ceb7c199054fad6ff2653f0bba6a16f09b80c8531a4d94776e6ee08b0f609.json"
  })), /selected e551 source-pinned public catalog/u);

  const names = ["SYNTX_OWNER_FLUX_IMAGE_REFERENCES", "SYNTX_OWNER_DURABLE_GENERATION"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.SYNTX_OWNER_FLUX_IMAGE_REFERENCES = "true";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_FLUX_IMAGE_REFERENCES configuration/u);
    process.env.SYNTX_OWNER_FLUX_IMAGE_REFERENCES = "1";
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

test("Flux RPC revoke drains generation before credential revocation and preserves LINKED on failure", async () => {
  const runtime = createObservedOwnerRuntime(fluxRuntimeOptions());
  const composition = (runtime.serverOptions as unknown as { ownerFluxImageReferences?: {
    generationService: { invalidateAttempt: (attemptId: string) => Promise<void>; close: () => Promise<void> };
  } }).ownerFluxImageReferences;
  assert.ok(composition);
  const generation = composition.generationService;
  const attemptId = "link_flux_runtime_revoke_0123456789";
  const binding = await createLinkedAttempt(runtime, attemptId);
  const events: string[] = [];
  const originalInvalidate = generation.invalidateAttempt.bind(generation);
  generation.invalidateAttempt = async (id) => { events.push("flux.invalidate"); await originalInvalidate(id); };
  const originalRevoke = runtime.authStore.revoke.bind(runtime.authStore);
  runtime.authStore.revoke = async (...args) => { events.push("credential.revoke"); return originalRevoke(...args); };
  try {
    const auth = runtime.serverOptions.auth;
    assert.ok(auth);
    const revoked = await auth.linkService.revoke(binding, attemptId);
    assert.equal(revoked.status, "REVOKED");
    assert.deepEqual(events, ["flux.invalidate", "credential.revoke"]);
  } finally {
    await generation.close();
  }

  const failedRuntime = createObservedOwnerRuntime(fluxRuntimeOptions());
  const failedComposition = (failedRuntime.serverOptions as unknown as { ownerFluxImageReferences?: {
    generationService: { invalidateAttempt: (attemptId: string) => Promise<void>; close: () => Promise<void> };
  } }).ownerFluxImageReferences;
  assert.ok(failedComposition);
  const failedAttempt = "link_flux_runtime_revoke_fail_0123456789";
  const failedBinding = await createLinkedAttempt(failedRuntime, failedAttempt);
  let storeRevokeCalls = 0;
  const failedOriginalRevoke = failedRuntime.authStore.revoke.bind(failedRuntime.authStore);
  failedRuntime.authStore.revoke = async (...args) => { storeRevokeCalls += 1; return failedOriginalRevoke(...args); };
  failedComposition.generationService.invalidateAttempt = async () => { throw new Error("synthetic Flux drain failure"); };
  try {
    const auth = failedRuntime.serverOptions.auth;
    assert.ok(auth);
    await assert.rejects(auth.linkService.revoke(failedBinding, failedAttempt), /synthetic Flux drain failure/u);
    assert.equal(storeRevokeCalls, 0);
    assert.equal((await failedRuntime.linkService.getStatus(failedBinding, failedAttempt)).status, "LINKED");
  } finally {
    await failedComposition.generationService.close();
  }
});

test("Flux EOF close drains before profile close and persistent LINKED credential remains reopenable after close failure", async (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "syntx-flux-runtime-profile-"));
  chmodSync(root, 0o700);
  const profileDirectory = join(root, "account-profile");
  const keyFilePath = join(root, "account.key");
  mkdirSync(profileDirectory, { mode: 0o700 });
  chmodSync(profileDirectory, 0o700);
  writeFileSync(keyFilePath, Buffer.alloc(32, 43), { mode: 0o600 });
  chmodSync(keyFilePath, 0o600);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const profile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  const runtime = createObservedOwnerRuntime(fluxRuntimeOptions({ authStore: profile.store, authBinding: profile.binding }));
  const composition = (runtime.serverOptions as unknown as { ownerFluxImageReferences?: {
    generationService: { close: () => Promise<void> };
  } }).ownerFluxImageReferences;
  assert.ok(composition);
  const attemptId = "link_flux_runtime_eof_close_failure_0123";
  await createLinkedAttempt(runtime, attemptId);
  const generation = composition.generationService;
  const originalClose = generation.close.bind(generation);
  const events: string[] = [];
  const previousExitCode = process.exitCode;
  generation.close = async () => { events.push("flux.close"); throw new Error("synthetic Flux close failure"); };
  const input = new PassThrough();
  const transport = { onclose: undefined, async close() {} } as unknown as Transport;
  const close = closeOwnerReadServicesOnTransportEof(
    transport, undefined, undefined, undefined, undefined,
    () => { events.push("profile.close"); profile.close(); }, input,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, generation
  );
  try {
    await assert.rejects(close(), /synthetic Flux close failure/u);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(process.exitCode, 1);
    process.exitCode = previousExitCode;
    assert.deepEqual(events, ["flux.close", "profile.close"]);
    const reopened = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
    try {
      const readRuntime = createObservedOwnerRuntime({ authStore: reopened.store, authBinding: reopened.binding });
      assert.equal((await readRuntime.linkService.getStatus(reopened.binding, attemptId)).status, "LINKED");
      assert.equal(await reopened.store.useCredential(reopened.binding, attemptId, (item) => item.value), "synthetic-flux-credential");
    } finally { reopened.close(); }
  } finally {
    input.destroy();
    await originalClose();
    profile.close();
  }
});
