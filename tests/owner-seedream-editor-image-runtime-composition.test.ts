import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PassThrough } from "node:stream";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import test from "node:test";
import { OwnerSeedreamEditorOriginalReferenceService } from "../src/application/owner-seedream-editor-original-reference-service.js";
import { OwnerSeedreamEditorDrawingReferenceService } from "../src/application/owner-seedream-editor-drawing-reference-service.js";
import { isOwnerSeedreamEditorImageGenerationService } from "../src/application/owner-seedream-editor-image-generation-service.js";
import {
  OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES,
  SYNTX_OWNER_GENERATE_SEEDREAM_EDITOR_IMAGE_TOOL_NAME
} from "../src/mcp/owner-seedream-editor-image-tools.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime, getObservedOwnerRuntimeStartupCleanup } from "../src/runtime/observed-owner-runtime.js";
import {
  closeOwnerImageReferenceServiceOnTransportEof,
  readOwnerSeedreamEditorImageReferencesFlag,
  runObservedOwnerStdioServer
} from "../src/transports/stdio-owner.js";

const FIXED_NOW = Date.parse("2026-10-12T12:00:00.000Z");
const ATTEMPT = "link_seedream_editor_runtime_0123456789";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

async function linkSyntheticAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string): Promise<void> {
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: FIXED_NOW + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: `synthetic-${attemptId}-credential` });
}

test("Seedream Editor owner-stdio flag is strict and default-off", () => {
  const read = readOwnerSeedreamEditorImageReferencesFlag;
  for (const value of [undefined, "", "0"]) assert.equal(read(value), false);
  assert.equal(read("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => read(value), /Invalid SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES configuration/u);
  }
});

test("malformed Seedream Editor opt-in rejects before stdio attaches input or begins auth startup", async () => {
  const previous = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES = "true";
    await assert.rejects(runObservedOwnerStdioServer(input),
      /Invalid SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES configuration/u);
    assert.equal(input.listenerCount("end"), 0, "a malformed flag must fail before transport setup");
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of previous) process.env[name] = value;
  }
});

test("Seedream Editor owner runtime remains absent without its operator opt-in", () => {
  let fetchCalls = 0;
  const runtime = createObservedOwnerRuntime({ fetchImpl: async () => {
    fetchCalls += 1;
    throw new Error("Runtime composition cannot contact SYNTX.");
  } });
  assert.equal((runtime.serverOptions as unknown as Record<string, unknown>).ownerSeedreamEditorImageReferences, undefined);
  assert.equal(fetchCalls, 0);
});

test("actual owner runtime and Stock SDK expose exactly seven Editor tools only on opt-in", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    throw new Error("Editor composition cannot contact SYNTX during initialization or tool listing.");
  };
  const disabled = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(disabled.serverOptions.ownerSeedreamEditorImageReferences, undefined);
  assert.equal(disabled.serverOptions.ownerSeedreamImageReferences, undefined);
  const disabledServer = createMcpServer(disabled.application, disabled.serverOptions);
  const disabledClient = new Client({ name: "seedream-editor-default", version: "1.0.0" });
  const [disabledClientTransport, disabledServerTransport] = InMemoryTransport.createLinkedPair();
  await disabledServer.connect(disabledServerTransport);
  await disabledClient.connect(disabledClientTransport);
  try {
    const names = (await disabledClient.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES.includes(
      name as typeof OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES[number])), false);
  } finally { await Promise.all([disabledClient.close(), disabledServer.close()]); }

  const enabled = createObservedOwnerRuntime({ ownerSeedreamEditorImageReferencesEnabled: true, fetchImpl, now: () => FIXED_NOW });
  const composition = enabled.serverOptions.ownerSeedreamEditorImageReferences;
  assert.ok(composition);
  assert.ok(composition.originalReferenceService instanceof OwnerSeedreamEditorOriginalReferenceService);
  assert.ok(composition.drawingReferenceService instanceof OwnerSeedreamEditorDrawingReferenceService);
  assert.equal(isOwnerSeedreamEditorImageGenerationService(composition.generationService), true);
  assert.equal(enabled.serverOptions.ownerSeedreamImageReferences, undefined,
    "Editor opt-in must not enable ordinary Seedream references or its E551 profile");
  assert.equal(fetchCalls, 0, "real source-pinned classes must not perform startup I/O");
  const enabledServer = createMcpServer(enabled.application, enabled.serverOptions);
  const enabledClient = new Client({ name: "seedream-editor-opt-in", version: "1.0.0" });
  const [enabledClientTransport, enabledServerTransport] = InMemoryTransport.createLinkedPair();
  await enabledServer.connect(enabledServerTransport);
  await enabledClient.connect(enabledClientTransport);
  try {
    const tools = (await enabledClient.listTools()).tools;
    assert.deepEqual(tools.map(({ name }) => name).filter((name) => OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES.includes(
      name as typeof OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES[number])), OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES);
    const generationTool = tools.find(({ name }) => name === SYNTX_OWNER_GENERATE_SEEDREAM_EDITOR_IMAGE_TOOL_NAME);
    assert.ok(generationTool);
    assert.equal((generationTool.inputSchema as { type?: unknown }).type, "object");
    assert.equal(fetchCalls, 0, "Stock SDK initialize/listTools must not fetch account state or start generation");
  } finally {
    await Promise.all([enabledClient.close(), enabledServer.close()]);
    await enabled.ownerSeedreamEditorImageReferencesLifecycle?.close();
  }
});

test("revocation drains an active result-history GET through actual runtime services before releasing credentials", async () => {
  const events: string[] = [];
  let signalPollStarted!: () => void;
  let signalPollAborted!: () => void;
  const pollStarted = new Promise<void>((resolve) => { signalPollStarted = resolve; });
  const pollAborted = new Promise<void>((resolve) => { signalPollAborted = resolve; });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/v1/chats/upload-files" && init?.method === "POST") {
      return Response.json({ files: [{ id: "editor-runtime-original", file_id: "editor-runtime-original",
        url: "https://r2.syntx.ai/editor-runtime/original.png", mime_type: "image/png", size: PNG.length, status: "accepted" }] });
    }
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "100" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO",
      end_date: "2099-12-31T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 3, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: null });
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") return Response.json({ uuid: "editor-runtime-chat" });
    if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") return Response.json({ id: "editor-runtime-ack" });
    if (/\/api\/v1\/chats\/[^/]+\/inprogress$/u.test(url.pathname)) return Response.json([]);
    if (/\/api\/v1\/chats\/[^/]+\/messages$/u.test(url.pathname)) {
      signalPollStarted();
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) { signalPollAborted(); reject(new Error("synthetic history GET aborted")); return; }
        signal?.addEventListener("abort", () => {
          signalPollAborted(); reject(new Error("synthetic history GET aborted"));
        }, { once: true });
      });
    }
    throw new Error(`Unexpected synthetic Editor runtime route: ${init?.method ?? "GET"} ${url.pathname}`);
  };
  const runtime = createObservedOwnerRuntime({ ownerSeedreamEditorImageReferencesEnabled: true, fetchImpl,
    now: () => FIXED_NOW, requestTimeoutMs: 10_000 });
  const composition = runtime.serverOptions.ownerSeedreamEditorImageReferences;
  assert.ok(composition);
  await linkSyntheticAttempt(runtime, ATTEMPT);
  const original = await composition.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "seedream-5",
    content_base64: PNG.toString("base64"), filename: "runtime-original.png", mime_type: "image/png" });

  const originalPrototype = OwnerSeedreamEditorOriginalReferenceService.prototype;
  const drawingPrototype = OwnerSeedreamEditorDrawingReferenceService.prototype;
  const generationPrototype = Object.getPrototypeOf(composition.generationService) as {
    invalidateAttempt(attemptId: string): Promise<void>;
  };
  const oldOriginalInvalidate = originalPrototype.invalidateAttempt;
  const oldDrawingInvalidate = drawingPrototype.invalidateAttempt;
  const oldGenerationInvalidate = generationPrototype.invalidateAttempt;
  const oldCredentialRevoke = runtime.linkService.revoke.bind(runtime.linkService);
  originalPrototype.invalidateAttempt = async function (attemptId: string): Promise<void> {
    events.push("original.start");
    try { await oldOriginalInvalidate.call(this, attemptId); } finally { events.push("original.done"); }
  };
  drawingPrototype.invalidateAttempt = async function (attemptId: string): Promise<void> {
    events.push("drawing.start");
    try { await oldDrawingInvalidate.call(this, attemptId); } finally { events.push("drawing.done"); }
  };
  generationPrototype.invalidateAttempt = async function (attemptId: string): Promise<void> {
    events.push("generation.start");
    try { await oldGenerationInvalidate.call(this, attemptId); } finally { events.push("generation.done"); }
  };
  const mutableLinkService = runtime.linkService as unknown as {
    revoke(binding: typeof runtime.authBinding, attemptId: string): Promise<unknown>;
  };
  mutableLinkService.revoke = async (binding, attemptId) => {
    events.push("credential.cleanup");
    return oldCredentialRevoke(binding, attemptId);
  };

  const pending = composition.generationService.generate({ attemptId: ATTEMPT, input: { variant: "seedream-5",
    prompt: "synthetic pending poll for lifecycle test", parameters: { aspect_ratio: "1:1", resolution: "2K" },
    original_handle: original.reference_handle, drawing_handle: null } });
  const expectedAbort = assert.rejects(pending, (error: unknown) => error instanceof Error && "code" in error && error.code === "OUTCOME_UNKNOWN");
  try {
    await pollStarted;
    const revoked = await runtime.serverOptions.auth!.linkService.revoke(runtime.authBinding, ATTEMPT);
    await pollAborted;
    await expectedAbort;
    assert.equal(revoked.status, "REVOKED");
    assert.deepEqual(events, ["generation.start", "generation.done", "drawing.start", "drawing.done",
      "original.start", "original.done", "credential.cleanup"]);
    assert.equal((await runtime.linkService.getStatus(runtime.authBinding, ATTEMPT)).linked, false);
  } finally {
    originalPrototype.invalidateAttempt = oldOriginalInvalidate;
    drawingPrototype.invalidateAttempt = oldDrawingInvalidate;
    generationPrototype.invalidateAttempt = oldGenerationInvalidate;
    await runtime.ownerSeedreamEditorImageReferencesLifecycle?.close();
  }
});

test("EOF lifecycle closes the real Editor service chain before the owner profile callback", async () => {
  const events: string[] = [];
  const runtime = createObservedOwnerRuntime({ ownerSeedreamEditorImageReferencesEnabled: true });
  const lifecycle = runtime.ownerSeedreamEditorImageReferencesLifecycle;
  assert.ok(lifecycle);
  const originalPrototype = OwnerSeedreamEditorOriginalReferenceService.prototype;
  const drawingPrototype = OwnerSeedreamEditorDrawingReferenceService.prototype;
  const generationPrototype = Object.getPrototypeOf(runtime.serverOptions.ownerSeedreamEditorImageReferences!.generationService) as {
    close(): Promise<void>;
  };
  const oldOriginalClose = originalPrototype.close;
  const oldDrawingClose = drawingPrototype.close;
  const oldGenerationClose = generationPrototype.close;
  originalPrototype.close = async function (): Promise<void> { events.push("original.close"); await oldOriginalClose.call(this); };
  drawingPrototype.close = async function (): Promise<void> { events.push("drawing.close"); await oldDrawingClose.call(this); };
  generationPrototype.close = async function (): Promise<void> { events.push("generation.close"); await oldGenerationClose.call(this); };
  const input = new PassThrough();
  let transport!: Transport;
  let signalTransportClosed!: () => void;
  const transportClosed = new Promise<void>((resolve) => { signalTransportClosed = resolve; });
  transport = { async start() {}, async send() {}, async close() { transport.onclose?.(); signalTransportClosed(); } };
  const close = closeOwnerImageReferenceServiceOnTransportEof(transport, lifecycle,
    () => { events.push("owner-profile.close"); }, input, true);
  input.resume();
  input.end();
  try {
    await transportClosed;
    await close();
    assert.deepEqual(events, ["generation.close", "drawing.close", "original.close", "owner-profile.close"]);
  } finally {
    input.destroy();
    originalPrototype.close = oldOriginalClose;
    drawingPrototype.close = oldDrawingClose;
    generationPrototype.close = oldGenerationClose;
    await lifecycle.close();
  }
});

test("partial Editor constructor failure closes only the original and drawing services it created", async () => {
  const events: string[] = [];
  const originalPrototype = OwnerSeedreamEditorOriginalReferenceService.prototype;
  const drawingPrototype = OwnerSeedreamEditorDrawingReferenceService.prototype;
  const oldOriginalClose = originalPrototype.close;
  const oldDrawingClose = drawingPrototype.close;
  originalPrototype.close = async function (): Promise<void> { events.push("original.close"); await oldOriginalClose.call(this); };
  drawingPrototype.close = async function (): Promise<void> { events.push("drawing.close"); await oldDrawingClose.call(this); };
  try {
    let thrown: unknown;
    try {
      createObservedOwnerRuntime({ ownerSeedreamEditorImageReferencesEnabled: true,
        now: () => -1 });
    } catch (error) { thrown = error; }
    assert.ok(thrown instanceof Error, "the generation constructor must reject the invalid trusted clock");
    const cleanup = getObservedOwnerRuntimeStartupCleanup(thrown);
    assert.ok(cleanup, "MISSING_PARTIAL_OWNER_RUNTIME_CLEANUP");
    await cleanup;
    assert.deepEqual(events, ["drawing.close", "original.close"]);
  } finally {
    originalPrototype.close = oldOriginalClose;
    drawingPrototype.close = oldDrawingClose;
  }
});
