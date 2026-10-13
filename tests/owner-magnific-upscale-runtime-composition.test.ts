import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { PassThrough } from "node:stream";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

const MAGNIFIC_TOOL_NAMES = [
  "syntx_upload_magnific_upscale_image",
  "syntx_owner_generate_magnific_upscale_image",
  "syntx_owner_reconcile_magnific_upscale_image",
  "syntx_owner_list_magnific_upscale_recoveries"
];

async function listToolNames(runtime: ReturnType<typeof createObservedOwnerRuntime>): Promise<string[]> {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-magnific-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return (await client.listTools()).tools.map((tool) => tool.name); }
  finally { await client.close(); await server.close(); }
}

test("Magnific owner runtime is default-off with no tools or reads", async () => {
  let fetchCalls = 0;
  const runtime = createObservedOwnerRuntime({
    fetchImpl: async () => { fetchCalls += 1; throw new Error("runtime startup must not read upstream"); }
  });
  assert.equal((runtime.serverOptions as unknown as { ownerMagnificUpscale?: unknown }).ownerMagnificUpscale, undefined);
  const names = await listToolNames(runtime);
  assert.equal(MAGNIFIC_TOOL_NAMES.some((name) => names.includes(name)), false);
  assert.equal(fetchCalls, 0);
});

test("strict Magnific stdio flag accepts only disabled values and exact opt-in", async () => {
  const module = await import("../src/transports/stdio-owner.js") as unknown as {
    readOwnerMagnificUpscaleFlag?: (value: string | undefined) => boolean;
  };
  assert.equal(typeof module.readOwnerMagnificUpscaleFlag, "function");
  const readFlag = module.readOwnerMagnificUpscaleFlag!;
  assert.equal(readFlag(undefined), false);
  assert.equal(readFlag(""), false);
  assert.equal(readFlag("0"), false);
  assert.equal(readFlag("1"), true);
  for (const value of ["true", "yes", "01", " 1 ", "2"]) {
    assert.throws(() => readFlag(value), /Invalid SYNTX_OWNER_MAGNIFIC_UPSCALE configuration/u);
  }
});

test("explicit Magnific opt-in adds exactly four tools without startup reads", async () => {
  let fetchCalls = 0;
  const runtime = createObservedOwnerRuntime({
    ownerMagnificUpscaleEnabled: true,
    fetchImpl: async () => { fetchCalls += 1; throw new Error("service creation must not read upstream"); }
  });
  const composition = (runtime.serverOptions as unknown as {
    ownerMagnificUpscale?: { generationService: { close(): Promise<void> } };
  }).ownerMagnificUpscale;
  assert.ok(composition);
  try {
    const names = await listToolNames(runtime);
    assert.deepEqual(names.filter((name) => MAGNIFIC_TOOL_NAMES.includes(name)), MAGNIFIC_TOOL_NAMES);
    assert.equal(fetchCalls, 0);
  } finally {
    await composition.generationService.close();
  }
});

test("owner stdio rejects invalid Magnific flag and durable-generation conflict before runtime startup", async () => {
  const oldDurable = process.env.SYNTX_OWNER_DURABLE_GENERATION;
  const oldMagnific = process.env.SYNTX_OWNER_MAGNIFIC_UPSCALE;
  try {
    process.env.SYNTX_OWNER_MAGNIFIC_UPSCALE = "true";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_MAGNIFIC_UPSCALE configuration/u);
    process.env.SYNTX_OWNER_MAGNIFIC_UPSCALE = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Durable owner generation cannot be combined/u);
  } finally {
    if (oldMagnific === undefined) delete process.env.SYNTX_OWNER_MAGNIFIC_UPSCALE;
    else process.env.SYNTX_OWNER_MAGNIFIC_UPSCALE = oldMagnific;
    if (oldDurable === undefined) delete process.env.SYNTX_OWNER_DURABLE_GENERATION;
    else process.env.SYNTX_OWNER_DURABLE_GENERATION = oldDurable;
  }
});

test("Magnific opt-in rejects a non-source-pinned catalog before creating services", () => {
  assert.throws(() => createObservedOwnerRuntime({
    ownerMagnificUpscaleEnabled: true,
    publicCatalogVersion: "sha256-c6fdcc522def8f6f4ef2c172d23822164f0124b29bb5fe86e2b5dce5c54b9fbc.json"
  }), /selected source-pinned public catalog/u);
});

test("owner SDK flow binds all variants to fresh account and exact dimension cost reads", async () => {
  const attemptId = "link_runtime_magnific_owner_0123456789";
  const now = Date.now();
  let fakeNow = now;
  let inactivePlan = false;
  let uploadNumber = 0;
  let chatNumber = 0;
  let generationNumber = 0;
  let resultGetCalls = 0;
  let pendingResults = false;
  const modelQueries: Array<{ ai_name: string | null; model_type: string | null; width: string | null; height: string | null; scale_factor: string | null }> = [];
  const generationBodies: Array<{ chat_uuid: string; settings: Record<string, unknown> }> = [];
  const routes: string[] = [];
  const runtime = createObservedOwnerRuntime({
    ownerMagnificUpscaleEnabled: true,
    now: () => fakeNow,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      routes.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "123.45" });
      if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: !inactivePlan, type: "PRO", end_date: null });
      if (url.pathname === "/api/v2/get_model_info") {
        modelQueries.push({
          ai_name: url.searchParams.get("ai_name"), model_type: url.searchParams.get("model_type"),
          width: url.searchParams.get("width"), height: url.searchParams.get("height"), scale_factor: url.searchParams.get("scale_factor")
        });
        return Response.json({ access: true, cost: 1.25, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
      }
      if (url.pathname === "/api/v1/chats/upload-files") {
        uploadNumber += 1;
        const file = (init?.body as FormData).get("files");
        assert.ok(file instanceof File);
        return Response.json({ files: [{ id: `file-${uploadNumber}`, url: `https://r2.syntx.ai/in-${uploadNumber}.png`, mime_type: "image/png", size: file.size }] });
      }
      if (url.pathname === "/api/v1/chats") {
        chatNumber += 1;
        return Response.json({ uuid: `runtime-magnific-chat-${chatNumber}` });
      }
      if (url.pathname === "/api/v1/design/generate") {
        generationNumber += 1;
        const body = JSON.parse(String(init?.body)) as { chat_uuid: string; settings: Record<string, unknown> };
        generationBodies.push(body);
        return Response.json({ id: `runtime-owner-echo-${generationNumber}` });
      }
      if (url.pathname.endsWith("/messages")) {
        const index = chatNumber;
        return Response.json({
          messages: [
            { id: `runtime-owner-echo-${index}`, chat_id: 700 + index, author_id: 12345, message_object: [] },
            { id: `runtime-bot-${index}`, chat_id: 700 + index, author_id: -1, message_object: [{
              id: `runtime-object-${index}`, message_id: `runtime-bot-${index}`, object_type: "image", model_type: modelQueries.at(-1)?.model_type
            }] }
          ],
          pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
        });
      }
      if (/^\/api\/v1\/chats\/runtime-magnific-chat-\d+\/runtime-bot-\d+$/u.test(url.pathname)) {
        const index = chatNumber;
        resultGetCalls += 1;
        if (pendingResults) fakeNow += 180_000;
        return Response.json({ id: `runtime-bot-${index}`, chat_id: 700 + index, author_id: -1, message_object: [{
          id: `runtime-object-${index}`, message_id: `runtime-bot-${index}`, object_type: "image",
          model_type: modelQueries.at(-1)?.model_type, completed: !pendingResults, object_url: `https://r2.syntx.ai/out-${index}.png`
        }] });
      }
      throw new Error(`Unexpected fake runtime route: ${url.pathname}`);
    }
  });
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: now + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-upstream-attempt");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-runtime-credential" });

  const client = new Client({ name: "owner-magnific-runtime-flow", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const composition = runtime.serverOptions.ownerMagnificUpscale;
  assert.ok(composition);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const parameters = {
    scale_factor: "2x", optimized_for: "films_n_photography", engine: "magnific_sparkle", creativity: 2,
    hdr: -3, resemblance: 4, fractality: 1, sharpen: 37, smart_grain: 28, ultra_detail: 61, flavor: "sublime"
  };
  try {
    for (const variant of ["creative", "precision_v1", "precision_v2"] as const) {
      const upload = await client.callTool({ name: "syntx_upload_magnific_upscale_image", arguments: {
        link_attempt_id: attemptId, variant, content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
        filename: `${variant}.png`, mime_type: "image/png"
      } });
      assert.equal(upload.isError, undefined);
      const imageHandle = (upload.structuredContent as { image_handle: string }).image_handle;
      const result = await client.callTool({ name: "syntx_owner_generate_magnific_upscale_image", arguments: {
        link_attempt_id: attemptId, variant, image_handle: imageHandle, parameters
      } });
      assert.equal(result.isError, undefined);
      assert.equal((result.structuredContent as { variant: string }).variant, variant);
    }
    const expectedQueries = ["creative", "creative", "precision_v1", "precision_v1", "precision_v2", "precision_v2"].map((variant) => ({
      ai_name: "magnific", model_type: variant, width: "1", height: "1", scale_factor: "2x"
    }));
    assert.deepEqual(modelQueries, expectedQueries);
    assert.equal(generationBodies.length, 3);
    assert.ok(generationBodies.every((body) => body.settings.n === 1 && body.settings.width === 1 && body.settings.height === 1));

    pendingResults = true;
    const pendingUpload = await client.callTool({ name: "syntx_upload_magnific_upscale_image", arguments: {
      link_attempt_id: attemptId, variant: "precision_v1", content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
      filename: "pending.png", mime_type: "image/png"
    } });
    const pendingHandle = (pendingUpload.structuredContent as { image_handle: string }).image_handle;
    const pending = await client.callTool({ name: "syntx_owner_generate_magnific_upscale_image", arguments: {
      link_attempt_id: attemptId, variant: "precision_v1", image_handle: pendingHandle, parameters
    } });
    assert.equal(pending.isError, true);
    const pendingText = (pending.content as readonly { text?: string }[])[0]?.text ?? "";
    const recoveryId = JSON.parse(pendingText).error.recovery_id as string;
    assert.match(recoveryId, /^magnific_recovery_[0-9a-f-]{36}$/u);
    const postsBeforeReconcile = generationNumber;
    const resultReadsBeforeReconcile = resultGetCalls;
    const preflightReadsBeforeReconcile = routes.filter((route) => route.startsWith("GET /api/v1/user/") || route === "GET /api/v2/get_model_info").length;
    pendingResults = false;
    const reconciled = await client.callTool({ name: "syntx_owner_reconcile_magnific_upscale_image", arguments: {
      link_attempt_id: attemptId, recovery_id: recoveryId
    } });
    assert.equal(reconciled.isError, undefined);
    assert.equal((reconciled.structuredContent as { variant: string }).variant, "precision_v1");
    assert.equal(generationNumber, postsBeforeReconcile, "late reconciliation never repeats generation POST");
    assert.equal(resultGetCalls, resultReadsBeforeReconcile + 1, "late recovery uses only the exact result GET");
    assert.equal(routes.filter((route) => route.startsWith("GET /api/v1/user/") || route === "GET /api/v2/get_model_info").length,
      preflightReadsBeforeReconcile, "reconciliation performs no account or model-access preflight");

    inactivePlan = true;
    const beforeDenied = { chatNumber, generationNumber };
    const upload = await client.callTool({ name: "syntx_upload_magnific_upscale_image", arguments: {
      link_attempt_id: attemptId, variant: "precision_v2", content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
      filename: "denied.png", mime_type: "image/png"
    } });
    assert.equal(upload.isError, undefined);
    const deniedHandle = (upload.structuredContent as { image_handle: string }).image_handle;
    const denied = await client.callTool({ name: "syntx_owner_generate_magnific_upscale_image", arguments: {
      link_attempt_id: attemptId, variant: "precision_v2", image_handle: deniedHandle, parameters
    } });
    assert.equal(denied.isError, true);
    assert.deepEqual({ chatNumber, generationNumber }, beforeDenied, "inactive subscription blocks before chat creation and POST");
    assert.deepEqual(modelQueries.slice(6), ["precision_v1", "precision_v1", "precision_v2"].map((variant) => ({
      ai_name: "magnific", model_type: variant, width: "1", height: "1", scale_factor: "2x"
    })), "the pending path performs two exact preflights and the denied upload binds its exact variant");

    const revokeUpload = await client.callTool({ name: "syntx_upload_magnific_upscale_image", arguments: {
      link_attempt_id: attemptId, variant: "precision_v2", content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
      filename: "revoked.png", mime_type: "image/png"
    } });
    const revokedHandle = (revokeUpload.structuredContent as { image_handle: string }).image_handle;
    const revoked = await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } });
    assert.equal((revoked.structuredContent as { status: string }).status, "REVOKED");
    const beforeRevokedGeneration = { chatNumber, generationNumber };
    const afterRevoke = await client.callTool({ name: "syntx_owner_generate_magnific_upscale_image", arguments: {
      link_attempt_id: attemptId, variant: "precision_v2", image_handle: revokedHandle, parameters
    } });
    assert.equal(afterRevoke.isError, true);
    assert.deepEqual({ chatNumber, generationNumber }, beforeRevokedGeneration, "revocation invalidates owned upload state before further generation");
    assert.ok(routes.includes("GET /api/v1/user/balance"));
    assert.ok(routes.includes("GET /api/v1/user/subscription"));
  } finally {
    await client.close();
    await server.close();
    await composition.generationService.close();
  }
});

test("stdio EOF lifecycle drains Magnific generation once before owner-auth cleanup", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { onclose: undefined, async close() {} } as unknown as Transport;
  const close = closeOwnerReadServicesOnTransportEof(
    transport,
    undefined,
    undefined,
    undefined,
    undefined,
    () => { events.push("auth.close"); },
    input,
    undefined,
    { async close() { events.push("magnific.generation.close"); } }
  );
  await close();
  await close();
  assert.deepEqual(events, ["magnific.generation.close", "auth.close"]);
  input.destroy();
});
