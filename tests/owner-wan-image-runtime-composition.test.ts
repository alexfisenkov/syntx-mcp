import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  closeOwnerReadServicesOnTransportEof,
  readOwnerWanImageReferencesFlag,
  runObservedOwnerStdioServer
} from "../src/transports/stdio-owner.js";

test("WAN owner image reference flag is strict and default-off", () => {
  for (const value of [undefined, "", "0"]) {
    assert.equal(readOwnerWanImageReferencesFlag(value), false);
  }
  assert.equal(readOwnerWanImageReferencesFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerWanImageReferencesFlag(value), /Invalid SYNTX_OWNER_WAN_IMAGE_REFERENCES/u);
  }
});

test("WAN owner image reference services are absent by default and composed only by explicit opt-in", async () => {
  const defaultRuntime = createObservedOwnerRuntime();
  assert.equal(defaultRuntime.serverOptions.ownerWanImageReferences, undefined);

  const optedInRuntime = createObservedOwnerRuntime({
    ownerWanImageReferencesEnabled: true,
    fetchImpl: (async () => {
      throw new Error("Provider access is not expected during local WAN composition.");
    }) as typeof fetch
  });
  const composition = optedInRuntime.serverOptions.ownerWanImageReferences;
  assert.ok(composition);
  assert.ok(composition.uploadService);
  assert.ok(composition.generationService);
  let uploadCloseCalls = 0;
  const originalUploadClose = composition.uploadService.close.bind(composition.uploadService);
  composition.uploadService.close = async () => {
    uploadCloseCalls += 1;
    await originalUploadClose();
  };
  await composition.generationService.close();
  assert.equal(uploadCloseCalls, 1);

  assert.throws(() => createObservedOwnerRuntime({
    publicCatalogVersion: "sha256-3c1ceb7c199054fad6ff2653f0bba6a16f09b80c8531a4d94776e6ee08b0f609.json",
    ownerWanImageReferencesEnabled: true
  }), /selected e551 source-pinned public catalog/u);
});

test("owner stdio rejects unknown WAN flag values and conflicts with durable generation", async () => {
  const names = [
    "SYNTX_OWNER_WAN_IMAGE_REFERENCES",
    "SYNTX_OWNER_DURABLE_GENERATION",
    "SYNTX_OWNER_GENERATE_CONTRACT_MEDIA",
    "SYNTX_OWNER_GENERATE_IMAGE",
    "SYNTX_OWNER_GENERATE_VIDEO",
    "SYNTX_OWNER_IMAGE_REFERENCES",
    "SYNTX_OWNER_GROK_IMAGE_REFERENCES",
    "SYNTX_OWNER_CLARITY_UPSCALE",
    "SYNTX_OWNER_MAGNIFIC_UPSCALE",
    "SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES"
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.SYNTX_OWNER_WAN_IMAGE_REFERENCES = "true";
    await assert.rejects(
      runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_WAN_IMAGE_REFERENCES configuration/u
    );

    process.env.SYNTX_OWNER_WAN_IMAGE_REFERENCES = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(
      runObservedOwnerStdioServer(new PassThrough()),
      /Durable owner generation cannot be combined/u
    );
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("WAN generation service drains before owner auth cleanup on stdio EOF", async () => {
  const events: string[] = [];
  let signalTransportClosed!: () => void;
  const transportClosed = new Promise<void>((resolve) => { signalTransportClosed = resolve; });
  let transport!: Transport;
  transport = {
    async start() {},
    async send() {},
    async close() { transport.onclose?.(); signalTransportClosed(); }
  };
  const input = new PassThrough();
  const closeOnce = closeOwnerReadServicesOnTransportEof(
    transport,
    undefined,
    undefined,
    undefined,
    undefined,
    () => { events.push("auth-profile"); },
    input,
    undefined,
    undefined,
    undefined,
    { async close() { events.push("wan-generation-owned-upload-drain"); } }
  );
  input.resume();
  input.push(null);
  await transportClosed;
  await closeOnce();
  assert.deepEqual(events, ["wan-generation-owned-upload-drain", "auth-profile"]);
  assert.equal(input.listenerCount("end"), 0);

  const disconnectEvents: string[] = [];
  let disconnectedTransport!: Transport;
  disconnectedTransport = {
    async start() {},
    async send() {},
    async close() { disconnectedTransport.onclose?.(); }
  };
  const disconnectedInput = new PassThrough();
  const closeOnDisconnect = closeOwnerReadServicesOnTransportEof(
    disconnectedTransport,
    undefined,
    undefined,
    undefined,
    undefined,
    () => { disconnectEvents.push("auth-profile"); },
    disconnectedInput,
    undefined,
    undefined,
    undefined,
    { async close() { disconnectEvents.push("wan-generation-owned-upload-drain"); } }
  );
  disconnectedTransport.onclose?.();
  await closeOnDisconnect();
  assert.deepEqual(disconnectEvents, ["wan-generation-owned-upload-drain", "auth-profile"]);
  assert.equal(disconnectedInput.listenerCount("end"), 0);
});

test("WAN runtime preflight queries the exact variant with batch_size as its only cost parameter", async () => {
  const modelReads: URL[] = [];
  const runtime = createObservedOwnerRuntime({
    ownerWanImageReferencesEnabled: true,
    fetchImpl: (async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "100" });
      if (url.pathname === "/api/v1/user/subscription") {
        return Response.json({ active: true, type: "PRO" });
      }
      if (url.pathname === "/api/v2/get_model_info") {
        modelReads.push(url);
        return Response.json({
          access: false,
          cost: 4,
          discount_cost: null,
          free_remaining_generations: null,
          limit: null,
          show_warning: false
        });
      }
      throw new Error("Unexpected provider route during denied first preflight.");
    }) as typeof fetch
  });
  const attemptId = "link_wan_runtime_preflight_0123456789";
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-wan-attempt");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-wan-credential" });

  const service = runtime.serverOptions.ownerWanImageReferences?.generationService;
  assert.ok(service);
  try {
    await assert.rejects(
      service.generate({
        attemptId,
        variant: "wan_27_image",
        reference_handles: [],
        parameters: {
          aspect_ratio: "1:1",
          resolution: "2K",
          batch_size: 4,
          prompt_extend: true,
          seed: null,
          color_palette: [
            { hex: "#FF0000", ratio: "50.00%" },
            { hex: "#00FF00", ratio: "30.00%" },
            { hex: "#0000FF", ratio: "20.00%" }
          ],
          bbox_list: []
        },
        prompt: "Synthetic denied preflight",
        bbox_coordinate_policy: null
      }),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error &&
        (error as { code?: unknown }).code === "PREFLIGHT_FAILED"
    );
    assert.equal(modelReads.length, 1);
    assert.equal(modelReads[0]?.searchParams.get("ai_name"), "wan_image");
    assert.equal(modelReads[0]?.searchParams.get("model_type"), "wan_27_image");
    assert.equal(modelReads[0]?.searchParams.get("batch_size"), "4");
    assert.deepEqual([...modelReads[0]!.searchParams.keys()].sort(), ["ai_name", "batch_size", "model_type"]);
  } finally {
    await service.close();
  }
});

test("owner unlink drains WAN generation before removing the linked credential", async () => {
  const events: string[] = [];
  const runtime = createObservedOwnerRuntime({ ownerWanImageReferencesEnabled: true });
  const composition = runtime.serverOptions.ownerWanImageReferences;
  assert.ok(composition);
  const attemptId = "link_wan_runtime_revoke_0123456789";
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-wan-attempt");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-wan-credential" });

  const generation = composition.generationService;
  const originalInvalidate = generation.invalidateAttempt.bind(generation);
  generation.invalidateAttempt = async (id) => {
    events.push("wan-invalidate");
    await originalInvalidate(id);
  };
  const originalRevoke = runtime.linkService.revoke.bind(runtime.linkService);
  runtime.linkService.revoke = async (...args) => {
    events.push("credential-revoke");
    return originalRevoke(...args);
  };

  try {
    const auth = runtime.serverOptions.auth;
    assert.ok(auth);
    const revoked = await auth.linkService.revoke(binding, attemptId);
    assert.equal(revoked.status, "REVOKED");
    await auth.onRevoked?.(attemptId);
    assert.deepEqual(events, ["wan-invalidate", "credential-revoke"]);
  } finally {
    await generation.close();
  }
});
