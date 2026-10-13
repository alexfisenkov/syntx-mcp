import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { PassThrough } from "node:stream";
import {
  OWNER_IDEOGRAM_IMAGE_TOOL_NAMES
} from "../src/mcp/owner-ideogram-image-tools.js";
import { createMcpServer } from "../src/mcp/server.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { OwnerIdeogramImageMaskUploadService } from "../src/application/owner-ideogram-image-mask-upload-service.js";
import {
  closeOwnerReadServicesOnTransportEof,
  readOwnerIdeogramImageReferencesFlag,
  runObservedOwnerStdioServer
} from "../src/transports/stdio-owner.js";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const chunk = Buffer.alloc(data.byteLength + 12);
  chunk.writeUInt32BE(data.byteLength, 0); body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), data.byteLength + 8);
  return chunk;
}

function rgbaPng(alpha: number): Buffer {
  const raw = Buffer.from([0, 0x20, 0x40, 0x60, alpha]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  try {
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr),
      pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
  } finally { raw.fill(0); ihdr.fill(0); }
}

function linkedAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string): Promise<void> {
  const binding = runtime.authBinding;
  return (async () => {
    await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
    await runtime.authStore.beginHandoff(binding, attemptId);
    await runtime.authStore.attachChallenge(binding, attemptId, `synthetic-ideogram-${attemptId.slice(-8)}`);
    await runtime.authStore.beginPoll(binding, attemptId);
    await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-ideogram-credential" });
  })();
}

test("Ideogram owner flag is strict and default-off", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerIdeogramImageReferencesFlag(value), false);
  assert.equal(readOwnerIdeogramImageReferencesFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerIdeogramImageReferencesFlag(value),
      /Invalid SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES configuration/u);
  }
});

test("Ideogram tools are absent by default and opt-in composes five tools without startup traffic", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    throw new Error("Ideogram runtime composition must not access SYNTX.");
  };
  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(defaultRuntime.serverOptions.ownerIdeogramImageReferences, undefined);
  const defaultServer = createMcpServer(defaultRuntime.application, defaultRuntime.serverOptions);
  const defaultClient = new Client({ name: "ideogram-owner-default-test", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  await defaultServer.connect(defaultServerTransport);
  await defaultClient.connect(defaultClientTransport);
  try {
    const names = (await defaultClient.listTools()).tools.map(({ name }) => name);
    for (const name of OWNER_IDEOGRAM_IMAGE_TOOL_NAMES) assert.equal(names.includes(name), false);
  } finally {
    await defaultClient.close();
    await defaultServer.close();
  }

  const runtime = createObservedOwnerRuntime({ ownerIdeogramImageReferencesEnabled: true, fetchImpl });
  const composition = runtime.serverOptions.ownerIdeogramImageReferences;
  assert.ok(composition);
  const maskUploadService = composition.maskUploadService;
  assert.ok(maskUploadService instanceof OwnerIdeogramImageMaskUploadService);
  for (const method of ["upload", "invalidateAttempt", "close"] as const) {
    assert.equal(typeof composition.uploadService[method], "function");
  }
  for (const method of ["upload", "resolveMask", "invalidateAttempt", "close"] as const) {
    assert.equal(typeof maskUploadService[method], "function");
  }
  for (const method of ["generate", "reconcile", "listRecoveries", "invalidateAttempt", "close"] as const) {
    assert.equal(typeof composition.generationService[method], "function");
  }
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "ideogram-owner-opt-in-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map(({ name }) => name);
    const ideogramNames = names.filter((name) => OWNER_IDEOGRAM_IMAGE_TOOL_NAMES.includes(name as typeof OWNER_IDEOGRAM_IMAGE_TOOL_NAMES[number]));
    assert.equal(ideogramNames.length, 5);
    assert.deepEqual(ideogramNames.sort(),
      [...OWNER_IDEOGRAM_IMAGE_TOOL_NAMES].sort());
  } finally {
    await client.close();
    await server.close();
    await composition.generationService.close();
  }
  assert.equal(fetchCalls, 0);
});

test("Ideogram opt-in composes the real mask upload service without startup traffic", async () => {
  let fetchCalls = 0;
  const runtime = createObservedOwnerRuntime({ ownerIdeogramImageReferencesEnabled: true, fetchImpl: async () => {
    fetchCalls += 1;
    throw new Error("Ideogram runtime composition must not access SYNTX at startup.");
  } });
  const composition = runtime.serverOptions.ownerIdeogramImageReferences;
  assert.ok(composition);
  const maskUploadService = composition.maskUploadService;
  assert.ok(maskUploadService instanceof OwnerIdeogramImageMaskUploadService);
  assert.equal(fetchCalls, 0);
  await composition.generationService.close();
});

test("Ideogram opt-in stays pinned to the selected e551 catalog", () => {
  assert.throws(() => createObservedOwnerRuntime({
    ownerIdeogramImageReferencesEnabled: true,
    publicCatalogVersion: "sha256-3c1ceb7c199054fad6ff2653f0bba6a16f09b80c8531a4d94776e6ee08b0f609.json"
  }), /selected e551 source-pinned public catalog/u);
  assert.equal(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION.startsWith("sha256-"), true);
});

test("Ideogram runtime preflight sends the exact candidate model and cost inputs before native dispatch", async () => {
  const modelReads: URL[] = [];
  const routes: string[] = [];
  const runtime = createObservedOwnerRuntime({
    ownerIdeogramImageReferencesEnabled: true,
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
      throw new Error("Unexpected route before denied synthetic Ideogram preflight.");
    }
  });
  const attemptId = "link_ideogram_runtime_preflight_0123456789";
  await linkedAttempt(runtime, attemptId);
  const generation = runtime.serverOptions.ownerIdeogramImageReferences?.generationService;
  assert.ok(generation);
  try {
    await assert.rejects(generation.generate({
      attemptId,
      model_id: "ideogram_45",
      mode: "generate",
      prompt: "Synthetic denied preflight",
      reference_handles: [],
      parameters: { rendering_speed: "TURBO", num_images: 3, aspect_ratio: "1:1", resolution: "1K" }
    }), (error: unknown) => typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "PREFLIGHT_FAILED");
    assert.equal(modelReads.length, 1);
    assert.equal(modelReads[0]?.searchParams.get("ai_name"), "ideogram");
    assert.equal(modelReads[0]?.searchParams.get("model_type"), "ideogram_45");
    assert.equal(modelReads[0]?.searchParams.get("rendering_speed"), "TURBO");
    assert.equal(modelReads[0]?.searchParams.get("batch_size"), "3");
    assert.deepEqual([...modelReads[0]!.searchParams.keys()].sort(), ["ai_name", "batch_size", "model_type", "rendering_speed"]);
    assert.deepEqual(routes, ["/api/v1/user/balance", "/api/v1/user/subscription", "/api/v2/get_model_info"]);
  } finally {
    await generation.close();
  }
});

test("masked Ideogram runtime performs two fresh 45 precise-edit preflights using ordinary ref_count only", async () => {
  const modelReads: URL[] = [];
  const accountReads: string[] = [];
  const routes: string[] = [];
  let generationPosts = 0;
  const runtime = createObservedOwnerRuntime({
    ownerIdeogramImageReferencesEnabled: true,
    fetchImpl: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      routes.push(url.pathname);
      if (url.pathname === "/api/v1/chats/upload-files") {
        const file = (init?.body as FormData).get("files");
        assert.ok(file instanceof File);
        const destination = String((init?.body as FormData).get("destination"));
        const suffix = destination === "hidden" ? file.name : "base";
        return Response.json({ files: [{ id: `runtime-mask-${suffix}`, url: `https://r2.syntx.ai/runtime/ideogram/${suffix}`,
          mime_type: file.type, size: file.size }] });
      }
      if (url.pathname === "/api/v1/user/balance") { accountReads.push(url.pathname); return Response.json({ balance: "100" }); }
      if (url.pathname === "/api/v1/user/subscription") {
        accountReads.push(url.pathname); return Response.json({ active: true, type: "PRO" });
      }
      if (url.pathname === "/api/v2/get_model_info") {
        modelReads.push(url);
        return Response.json({ access: modelReads.length === 1, cost: 4, discount_cost: null,
          free_remaining_generations: null, limit: null, show_warning: false });
      }
      if (url.pathname === "/api/v1/chats" && init?.method === "POST") return Response.json({ uuid: "ideogram-mask-runtime-chat" });
      if (url.pathname === "/api/v1/design/generate") { generationPosts += 1; return Response.json({ id: "unexpected-post" }); }
      throw new Error(`Unexpected synthetic Ideogram runtime route: ${url.pathname}`);
    }
  });
  const composition = runtime.serverOptions.ownerIdeogramImageReferences;
  assert.ok(composition);
  const maskUploadService = composition.maskUploadService;
  assert.ok(maskUploadService instanceof OwnerIdeogramImageMaskUploadService);
  const attemptId = "link_ideogram_runtime_mask_cost_0123456789";
  await linkedAttempt(runtime, attemptId);
  const baseBytes = rgbaPng(255);
  const paintedBytes = rgbaPng(1);
  try {
    const base = await composition.uploadService.upload({ attemptId, model_id: "ideogram_45", mode: "precise_edit",
      content_base64: baseBytes.toString("base64"), filename: "base.png", mime_type: "image/png" });
    const mask = await maskUploadService.upload({ attemptId, base_reference_handle: base.reference_handle,
      painted_rgba_png_base64: paintedBytes.toString("base64") });
    await assert.rejects(composition.generationService.generate({ attemptId, model_id: "ideogram_45", mode: "precise_edit",
      prompt: "synthetic preflight only", reference_handles: [base.reference_handle], mask_handle: mask.mask_handle,
      parameters: { rendering_speed: "TURBO", num_images: 1 } }),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "PREFLIGHT_FAILED");
    assert.equal(modelReads.length, 2, `expected both fresh model reads; observed routes: ${routes.join(", ")}`);
    for (const url of modelReads) {
      assert.equal(url.searchParams.get("ai_name"), "ideogram");
      assert.equal(url.searchParams.get("model_type"), "ideogram_45");
      assert.equal(url.searchParams.get("rendering_speed"), "TURBO");
      assert.equal(url.searchParams.get("ref_count"), "1");
      assert.equal(url.searchParams.get("batch_size"), "1");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "batch_size", "model_type", "ref_count", "rendering_speed"]);
    }
    assert.equal(accountReads.filter((route) => route === "/api/v1/user/balance").length, 2);
    assert.equal(accountReads.filter((route) => route === "/api/v1/user/subscription").length, 2);
    assert.equal(generationPosts, 0);
    assert.equal(routes.filter((route) => route === "/api/v1/chats").length, 1);
  } finally {
    baseBytes.fill(0); paintedBytes.fill(0);
    await composition.generationService.close();
  }
});

test("Ideogram revoke drains generation and upload before unlink; failed drain retains the link", async () => {
  const runtime = createObservedOwnerRuntime({ ownerIdeogramImageReferencesEnabled: true });
  const composition = runtime.serverOptions.ownerIdeogramImageReferences;
  assert.ok(composition);
  const maskUploadService = composition.maskUploadService;
  assert.ok(maskUploadService);
  const attemptId = "link_ideogram_runtime_revoke_0123456789";
  await linkedAttempt(runtime, attemptId);
  const events: string[] = [];
  const originalGenerationInvalidate = composition.generationService.invalidateAttempt.bind(composition.generationService);
  composition.generationService.invalidateAttempt = async (id) => {
    events.push("generation.invalidate.start");
    await originalGenerationInvalidate(id);
    events.push("generation.invalidate.done");
  };
  const originalMaskInvalidate = maskUploadService.invalidateAttempt.bind(maskUploadService);
  maskUploadService.invalidateAttempt = async (id) => {
    events.push("mask.invalidate.start");
    await originalMaskInvalidate(id);
    events.push("mask.invalidate.done");
  };
  const originalUploadInvalidate = composition.uploadService.invalidateAttempt.bind(composition.uploadService);
  composition.uploadService.invalidateAttempt = async (id) => {
    events.push("upload.invalidate.start");
    await originalUploadInvalidate(id);
    events.push("upload.invalidate.done");
  };
  const originalLinkRevoke = runtime.linkService.revoke.bind(runtime.linkService);
  runtime.linkService.revoke = async (binding, id) => {
    events.push("link.revoke");
    return originalLinkRevoke(binding, id);
  };
  const result = await runtime.serverOptions.auth!.linkService.revoke(runtime.authBinding, attemptId);
  assert.equal(result.status, "REVOKED");
  assert.deepEqual(events, ["generation.invalidate.start", "mask.invalidate.start", "mask.invalidate.done",
    "upload.invalidate.start", "upload.invalidate.done", "generation.invalidate.done", "link.revoke"]);
  await composition.generationService.close();

  const failed = createObservedOwnerRuntime({ ownerIdeogramImageReferencesEnabled: true });
  const failedComposition = failed.serverOptions.ownerIdeogramImageReferences;
  assert.ok(failedComposition);
  const failedAttempt = "link_ideogram_runtime_failed_drain_0123456789";
  await linkedAttempt(failed, failedAttempt);
  failedComposition.generationService.invalidateAttempt = async () => { throw new Error("synthetic Ideogram drain failure"); };
  try {
    await assert.rejects(failed.serverOptions.auth!.linkService.revoke(failed.authBinding, failedAttempt), /synthetic Ideogram drain failure/u);
    assert.equal((await failed.linkService.getStatus(failed.authBinding, failedAttempt)).status, "LINKED");
  } finally {
    await failedComposition.generationService.close();
  }
});

test("stdio EOF closes Ideogram generation/upload before profile close and does not unlink the linked auth record", async () => {
  const runtime = createObservedOwnerRuntime({ ownerIdeogramImageReferencesEnabled: true });
  const composition = runtime.serverOptions.ownerIdeogramImageReferences;
  assert.ok(composition);
  const maskUploadService = composition.maskUploadService;
  assert.ok(maskUploadService);
  const attemptId = "link_ideogram_runtime_eof_0123456789";
  await linkedAttempt(runtime, attemptId);
  const events: string[] = [];
  const originalGenerationClose = composition.generationService.close.bind(composition.generationService);
  composition.generationService.close = async () => {
    events.push("generation.close.start"); await originalGenerationClose(); events.push("generation.close.done");
  };
  const originalMaskClose = maskUploadService.close.bind(maskUploadService);
  maskUploadService.close = async () => { events.push("mask.close.start"); await originalMaskClose(); events.push("mask.close.done"); };
  const originalUploadClose = composition.uploadService.close.bind(composition.uploadService);
  composition.uploadService.close = async () => { events.push("upload.close.start"); await originalUploadClose(); events.push("upload.close.done"); };
  const input = new PassThrough();
  let transport!: Transport;
  let signalTransportClosed!: () => void;
  const transportClosed = new Promise<void>((resolve) => { signalTransportClosed = resolve; });
  transport = { async start() {}, async send() {}, async close() { transport.onclose?.(); signalTransportClosed(); } };
  const close = closeOwnerReadServicesOnTransportEof(
    transport, undefined, undefined, undefined, undefined,
    () => { events.push("profile.close"); }, input,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, composition.generationService
  );
  input.resume();
  input.push(null);
  await transportClosed;
  await close();
  assert.equal(events[0], "generation.close.start");
  assert.ok(events.indexOf("mask.close.done") < events.indexOf("profile.close"));
  assert.ok(events.indexOf("upload.close.done") < events.indexOf("profile.close"));
  assert.ok(events.indexOf("generation.close.done") < events.indexOf("profile.close"));
  assert.equal(events.at(-1), "profile.close");
  assert.equal((await runtime.linkService.getStatus(runtime.authBinding, attemptId)).status, "LINKED");
  input.destroy();
});

test("stdio EOF surfaces generation close failure without unlinking the linked auth record", async () => {
  const runtime = createObservedOwnerRuntime({ ownerIdeogramImageReferencesEnabled: true });
  const composition = runtime.serverOptions.ownerIdeogramImageReferences;
  assert.ok(composition);
  const attemptId = "link_ideogram_runtime_eof_close_failure_0123456789";
  await linkedAttempt(runtime, attemptId);
  const originalClose = composition.generationService.close.bind(composition.generationService);
  const input = new PassThrough();
  const events: string[] = [];
  composition.generationService.close = async () => { events.push("generation.close"); throw new Error("synthetic Ideogram close failure"); };
  const transport: Transport = { async start() {}, async send() {}, async close() { transport.onclose?.(); } };
  const close = closeOwnerReadServicesOnTransportEof(
    transport, undefined, undefined, undefined, undefined,
    () => { events.push("profile.close"); }, input,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    composition.generationService
  );
  const previousExitCode = process.exitCode;
  try {
    await assert.rejects(close(), /synthetic Ideogram close failure/u);
    assert.deepEqual(events, ["generation.close", "profile.close"]);
    assert.equal((await runtime.linkService.getStatus(runtime.authBinding, attemptId)).status, "LINKED");
  } finally {
    process.exitCode = previousExitCode;
    await originalClose();
    input.destroy();
  }
});

test("owner stdio rejects a noncanonical Ideogram flag and durable-generation combination", async () => {
  const names = ["SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES", "SYNTX_OWNER_DURABLE_GENERATION"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES = "true";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES configuration/u);
    process.env.SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Durable owner generation cannot be combined/u);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
