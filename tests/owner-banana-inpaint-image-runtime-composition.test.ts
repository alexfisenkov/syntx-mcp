import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES
} from "../src/mcp/owner-banana-inpaint-image-tools.js";
import { OwnerBananaInpaintOriginalReferenceService } from "../src/application/owner-banana-inpaint-original-reference-service.js";
import { OwnerBananaInpaintPaintedCompositeReferenceService } from "../src/application/owner-banana-inpaint-painted-composite-reference-service.js";
import { OwnerBananaInpaintAuxiliaryReferenceService } from "../src/application/owner-banana-inpaint-auxiliary-reference-service.js";
import { isOwnerBananaInpaintImageGenerationService } from "../src/application/owner-banana-inpaint-image-generation-service.js";
import { runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";
import { closeOwnerReadServicesOnTransportEof } from "../src/transports/stdio-owner.js";
import test from "node:test";

const FIXED_NOW = Date.parse("2026-10-12T12:00:00.000Z");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

async function linkSyntheticAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string,
  expiresAtMs = FIXED_NOW + 60_000): Promise<void> {
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: expiresAtMs });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: `synthetic-${attemptId}-credential` });
}

test("Banana Inpaint owner-stdio flag is strict and default-off", async () => {
  const module = await import("../src/transports/stdio-owner.js") as Record<string, unknown>;
  assert.equal(typeof module.readOwnerBananaInpaintImageReferencesFlag, "function",
    "MISSING_BANANA_INPAINT_IMAGE_RUNTIME_FLAG_READER");
  const read = module.readOwnerBananaInpaintImageReferencesFlag as (value: string | undefined) => boolean;
  for (const value of [undefined, "", "0"]) assert.equal(read(value), false);
  assert.equal(read("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => read(value), /Invalid SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES configuration/u);
  }
});

test("owner stdio rejects malformed Inpaint flag and durable paid-mode conflict before startup", async () => {
  const prior = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES = "true";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES configuration/u);
    process.env.SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Durable owner generation cannot be combined/u);
  } finally {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of prior) process.env[name] = value;
  }
});

test("owner runtime composes the actual pinned Inpaint services only on explicit opt-in", async () => {
  let fetches = 0;
  const fetchImpl: typeof fetch = async () => { fetches += 1; throw new Error("Composition must not perform network I/O."); };
  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(defaultRuntime.serverOptions.ownerBananaInpaintImageReferences, undefined);
  const defaultServer = createMcpServer(defaultRuntime.application, defaultRuntime.serverOptions);
  const defaultClient = new Client({ name: "banana-inpaint-runtime-default", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  await defaultServer.connect(defaultServerTransport);
  await defaultClient.connect(defaultClientTransport);
  try {
    const names = (await defaultClient.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES.includes(name as typeof OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES[number])), false);
  } finally { await Promise.all([defaultClient.close(), defaultServer.close()]); }

  const enabledRuntime = createObservedOwnerRuntime({ ownerBananaInpaintImageReferencesEnabled: true, fetchImpl });
  const composition = enabledRuntime.serverOptions.ownerBananaInpaintImageReferences;
  assert.ok(composition, "MISSING_BANANA_INPAINT_RUNTIME_COMPOSITION");
  assert.ok(composition.originalReferenceService instanceof OwnerBananaInpaintOriginalReferenceService);
  assert.ok(composition.paintedCompositeReferenceService instanceof OwnerBananaInpaintPaintedCompositeReferenceService);
  assert.ok(composition.auxiliaryReferenceService instanceof OwnerBananaInpaintAuxiliaryReferenceService);
  assert.equal(isOwnerBananaInpaintImageGenerationService(composition.generationService), true);
  assert.equal(fetches, 0, "pinned source composition must not perform startup network/auth/upload/generation calls");
  const enabledServer = createMcpServer(enabledRuntime.application, enabledRuntime.serverOptions);
  const enabledClient = new Client({ name: "banana-inpaint-runtime-optin", version: "1.0.0" });
  const [enabledClientTransport, enabledServerTransport] = InMemoryTransport.createLinkedPair();
  await enabledServer.connect(enabledServerTransport);
  await enabledClient.connect(enabledClientTransport);
  try {
    const names = (await enabledClient.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES.includes(name as typeof OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES[number])),
      OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES);
  } finally {
    await Promise.all([enabledClient.close(), enabledServer.close()]);
    await composition.generationService.close();
  }
  assert.equal(fetches, 0);
});

test("real MCP SDK callTool exercises runtime-backed uploads, fresh preflights, native POST and all nine variants", async () => {
  let now = FIXED_NOW;
  const counters = { uploads: 0, chats: 0, posts: 0, balanceReads: 0, subscriptionReads: 0, modelReads: 0, histories: 0, results: 0 };
  const transactions = new Map<string, { ack: string; result: string; providerChatId: number; variant: string;
    imageSize: string | null; manyObjects: boolean }>();
  const costQueries: URL[] = [];
  let failNextPost = false;
  let largeObservationNext = false;
  let unknownChatUuid: string | undefined;
  let unknownRecoveryReady = false;
  let signalUnknownPost!: () => void;
  let signalUnknownResultRead!: () => void;
  const unknownPostStarted = new Promise<void>((resolve) => { signalUnknownPost = resolve; });
  const unknownResultRead = new Promise<void>((resolve) => { signalUnknownResultRead = resolve; });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats/upload-files" && init?.method === "POST") {
      counters.uploads += 1;
      const form = init.body as FormData;
      const file = form.get("files");
      assert.ok(file instanceof File);
      return Response.json({ files: [{ id: `runtime-file-${counters.uploads}`, file_id: `runtime-file-${counters.uploads}`,
        url: `https://r2.syntx.ai/runtime/input-${counters.uploads}.png`, mime_type: file.type, size: file.size, status: "accepted" }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") {
      counters.chats += 1;
      return Response.json({ uuid: `banana-inpaint-runtime-chat-${counters.chats}` });
    }
    if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") {
      counters.posts += 1;
      assert.equal(url.searchParams.get("ai_name"), "banana");
      const body = JSON.parse(String(init.body)) as { chat_uuid: string; settings: { model_type: string; image_size: string | null } };
      const manyObjects = largeObservationNext;
      largeObservationNext = false;
      transactions.set(body.chat_uuid, { ack: `runtime-ack-${counters.posts}`, result: `runtime-result-${counters.posts}`,
        providerChatId: 7100 + counters.posts, variant: body.settings.model_type, imageSize: body.settings.image_size, manyObjects });
      if (failNextPost) {
        failNextPost = false;
        unknownChatUuid = body.chat_uuid;
        signalUnknownPost();
        return new Promise<Response>(() => undefined);
      }
      return Response.json({ id: `runtime-ack-${counters.posts}` });
    }
    if (/^\/api\/v1\/chats\/banana-inpaint-runtime-chat-\d+\/inprogress$/u.test(url.pathname)) return Response.json([]);
    const historyMatch = url.pathname.match(/^\/api\/v1\/chats\/(banana-inpaint-runtime-chat-\d+)\/messages$/u);
    if (historyMatch && init?.method === "GET") {
      counters.histories += 1;
      const transaction = transactions.get(historyMatch[1]!);
      assert.ok(transaction);
      if (historyMatch[1] === unknownChatUuid && !unknownRecoveryReady) {
        return Response.json({ messages: [], pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0,
          has_next: false, has_previous: false } });
      }
      if (historyMatch[1] === unknownChatUuid) {
        return Response.json({ messages: [{ id: transaction.result, chat_id: transaction.providerChatId, author_id: -1,
          message_object: [{ id: `${transaction.result}-object-a`, message_id: transaction.result, object_type: "image", model_type: null }] }],
        pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1, has_next: false, has_previous: false } });
      }
      if (transaction.manyObjects) {
        const rows = [1, 2].map((messageNumber) => {
          const messageId = `${transaction.result}-${messageNumber}`;
          return { id: messageId, chat_id: transaction.providerChatId, author_id: -1,
            message_object: Array.from({ length: 40 }, (_, objectIndex) => ({
              id: `${messageId}-object-${objectIndex + 1}`, message_id: messageId, object_type: "image", model_type: null
            })) };
        });
        return Response.json({ messages: [
          { id: transaction.ack, chat_id: transaction.providerChatId, author_id: 27, message_object: [] },
          ...rows
        ], pagination: { page: 1, page_size: 10, total_count: 3, total_pages: 1, has_next: false, has_previous: false } });
      }
      return Response.json({ messages: [
        { id: transaction.ack, chat_id: transaction.providerChatId, author_id: 27, message_object: [] },
        { id: transaction.result, chat_id: transaction.providerChatId, author_id: -1, message_object: [
          { id: `${transaction.result}-object-a`, message_id: transaction.result, object_type: "image", model_type: null },
          { id: `${transaction.result}-object-b`, message_id: transaction.result, object_type: "image_url", model_type: null }
        ] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = url.pathname.match(/^\/api\/v1\/chats\/(banana-inpaint-runtime-chat-\d+)\/(runtime-result-\d+(?:-[12])?)$/u);
    if (resultMatch && init?.method === "GET") {
      counters.results += 1;
      const transaction = transactions.get(resultMatch[1]!);
      assert.ok(transaction);
      assert.equal(resultMatch[2] === transaction.result || resultMatch[2] === `${transaction.result}-1` ||
        resultMatch[2] === `${transaction.result}-2`, true);
      if (resultMatch[1] === unknownChatUuid) signalUnknownResultRead();
      if (transaction.manyObjects) {
        const messageNumber = resultMatch[2] === `${transaction.result}-2` ? 2 : 1;
        return Response.json({ id: resultMatch[2], chat_id: transaction.providerChatId, author_id: -1,
          message_object: Array.from({ length: 40 }, (_, objectIndex) => ({
            id: `${resultMatch[2]}-object-${objectIndex + 1}`, object_type: "image",
            object_url: `https://r2.syntx.ai/runtime/${counters.posts}-${messageNumber}-${objectIndex + 1}.png`, completed: true
          })) });
      }
      return Response.json({ id: transaction.result, chat_id: transaction.providerChatId, author_id: -1, message_object: [
        { id: `${transaction.result}-object-a`, object_type: "image", object_url: `https://r2.syntx.ai/runtime/${counters.posts}-a.png`, completed: true },
        { id: `${transaction.result}-object-b`, object_type: "image_url", object_url: `https://r2.syntx.ai/runtime/${counters.posts}-b.webp`, completed: true }
      ] });
    }
    if (url.pathname === "/api/v1/user/balance") { counters.balanceReads += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription") {
      counters.subscriptionReads += 1;
      return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      counters.modelReads += 1;
      costQueries.push(url);
      return Response.json({ access: true, cost: 3, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    }
    throw new Error(`Unexpected synthetic runtime request ${init?.method ?? "GET"} ${url.pathname}`);
  };
  const runtime = createObservedOwnerRuntime({
    ownerBananaInpaintImageReferencesEnabled: true,
    authStore: new InMemoryAuthLinkStore(() => now),
    fetchImpl,
    now: () => now,
    requestTimeoutMs: 2_000
  });
  const composition = runtime.serverOptions.ownerBananaInpaintImageReferences;
  assert.ok(composition);
  assert.equal(counters.posts, 0, "runtime construction cannot dispatch");
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "banana-inpaint-runtime-calltool", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const selections = [
    ["banana", null], ["banana2", "1K"], ["banana2", "2K"], ["banana2", "4K"],
    ["banana3", "0.5K"], ["banana3", "1K"], ["banana3", "2K"], ["banana3", "4K"], ["banana3_light", "1K"]
  ] as const;
  try {
    const listed = (await client.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(listed.filter((name) => OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES.includes(
      name as typeof OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES[number])), OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES);
    for (const [index, [variant, image_size]] of selections.entries()) {
      const attemptId = `link_banana_runtime_${String(index + 1).padStart(2, "0")}_0123456789`;
      await linkSyntheticAttempt(runtime, attemptId);
      const originalResponse = await client.callTool({ name: "syntx_upload_banana_inpaint_original", arguments: {
        link_attempt_id: attemptId, variant, content_base64: PNG.toString("base64"), filename: `runtime-original-${index}.png`, mime_type: "image/png"
      } });
      assert.equal(originalResponse.isError, undefined, JSON.stringify(originalResponse));
      const original = originalResponse.structuredContent as { reference_handle: string };
      const paintedResponse = await client.callTool({ name: "syntx_upload_banana_inpaint_painted_composite", arguments: {
        link_attempt_id: attemptId, variant, original_handle: original.reference_handle,
        content_base64: PNG.toString("base64"), filename: `runtime-painted-${index}.png`, mime_type: "image/png"
      } });
      assert.equal(paintedResponse.isError, undefined, JSON.stringify(paintedResponse));
      const painted = paintedResponse.structuredContent as { painted_handle: string };
      let auxiliaryHandle: string | null = null;
      if (index % 2 === 1) {
        const auxiliaryResponse = await client.callTool({ name: "syntx_upload_banana_inpaint_auxiliary_reference", arguments: {
          link_attempt_id: attemptId, variant, content_base64: PNG.toString("base64"),
          filename: `runtime-aux-${index}.png`, mime_type: "image/png"
        } });
        assert.equal(auxiliaryResponse.isError, undefined, JSON.stringify(auxiliaryResponse));
        auxiliaryHandle = (auxiliaryResponse.structuredContent as { reference_handle: string }).reference_handle;
      }
      const generated = await client.callTool({ name: "syntx_owner_generate_banana_inpaint_image", arguments: {
        link_attempt_id: attemptId, variant, prompt: `runtime synthetic ${variant}/${image_size ?? "base"}`, image_size,
        original_handle: original.reference_handle, painted_handle: painted.painted_handle,
        auxiliary_reference_handle: auxiliaryHandle
      } });
      assert.equal(generated.isError, undefined, `${variant}/${String(image_size)}: ${JSON.stringify(generated)}`);
      const result = generated.structuredContent as { status: string; backend_acceptance: string; provider_execution: boolean;
        variant: string; model_type: string; artifacts: Array<Record<string, unknown>> };
      assert.equal(result.status, "result_observed");
      assert.equal(result.backend_acceptance, "UNPROVEN");
      assert.equal(result.provider_execution, false);
      assert.equal(result.variant, variant);
      assert.equal(result.model_type, variant);
      assert.deepEqual(result.artifacts, [
        { url: `https://r2.syntx.ai/runtime/${index + 1}-a.png`, mime_type: null, width: null, height: null,
          geometry_verified: false, message_id: `runtime-result-${index + 1}`, object_index: 0 },
        { url: `https://r2.syntx.ai/runtime/${index + 1}-b.webp`, mime_type: null, width: null, height: null,
          geometry_verified: false, message_id: `runtime-result-${index + 1}`, object_index: 1 }
      ]);
    }
    assert.deepEqual(counters, { uploads: 22, chats: 9, posts: 9, balanceReads: 18, subscriptionReads: 18, modelReads: 18, histories: 9, results: 9 });
    for (let index = 0; index < selections.length; index += 1) {
      const [variant, image_size] = selections[index]!;
      const query = costQueries[index * 2]!;
      assert.equal(query.searchParams.get("ai_name"), "banana");
      assert.equal(query.searchParams.get("model_type"), variant);
      assert.equal(query.searchParams.get("image_size"), image_size);
      const secondFreshQuery = costQueries[index * 2 + 1]!;
      assert.equal(secondFreshQuery.searchParams.get("ai_name"), "banana");
      assert.equal(secondFreshQuery.searchParams.get("model_type"), variant);
      assert.equal(secondFreshQuery.searchParams.get("image_size"), image_size);
    }

    const pagedAttempt = "link_banana_runtime_paged_0123456789";
    await linkSyntheticAttempt(runtime, pagedAttempt);
    const pagedOriginalResponse = await client.callTool({ name: "syntx_upload_banana_inpaint_original", arguments: {
      link_attempt_id: pagedAttempt, variant: "banana3", content_base64: PNG.toString("base64"),
      filename: "runtime-paged-original.png", mime_type: "image/png"
    } });
    assert.equal(pagedOriginalResponse.isError, undefined, JSON.stringify(pagedOriginalResponse));
    const pagedOriginal = pagedOriginalResponse.structuredContent as { reference_handle: string };
    const pagedPaintedResponse = await client.callTool({ name: "syntx_upload_banana_inpaint_painted_composite", arguments: {
      link_attempt_id: pagedAttempt, variant: "banana3", original_handle: pagedOriginal.reference_handle,
      content_base64: PNG.toString("base64"), filename: "runtime-paged-painted.png", mime_type: "image/png"
    } });
    assert.equal(pagedPaintedResponse.isError, undefined, JSON.stringify(pagedPaintedResponse));
    const pagedPainted = pagedPaintedResponse.structuredContent as { painted_handle: string };
    largeObservationNext = true;
    const largeGeneration = await client.callTool({ name: "syntx_owner_generate_banana_inpaint_image", arguments: {
      link_attempt_id: pagedAttempt, variant: "banana3", prompt: "preserve all observed result pages", image_size: "2K",
      original_handle: pagedOriginal.reference_handle, painted_handle: pagedPainted.painted_handle, auxiliary_reference_handle: null
    } });
    assert.equal(largeGeneration.isError, undefined, JSON.stringify(largeGeneration));
    const firstPage = largeGeneration.structuredContent as { result_id: string; observed_total: number; next_offset: number | null;
      has_more: boolean; artifacts: Array<{ url: string; message_id: string; object_index: number }> };
    assert.match(firstPage.result_id, /^banana_inpaint_result_[0-9a-f-]{36}$/u);
    assert.equal(firstPage.observed_total, 80);
    assert.equal(firstPage.next_offset, 64);
    assert.equal(firstPage.has_more, true);
    assert.equal(firstPage.artifacts.length, 64);
    assert.deepEqual(firstPage.artifacts[0], { url: "https://r2.syntx.ai/runtime/10-1-1.png", mime_type: null,
      width: null, height: null, geometry_verified: false, message_id: "runtime-result-10-1", object_index: 0 });
    assert.deepEqual(firstPage.artifacts[63], { url: "https://r2.syntx.ai/runtime/10-2-24.png", mime_type: null,
      width: null, height: null, geometry_verified: false, message_id: "runtime-result-10-2", object_index: 23 });
    const providerReadsBeforePage = counters.results;
    const postsBeforePage = counters.posts;
    const secondPageResponse = await client.callTool({ name: "syntx_owner_get_banana_inpaint_image_result_page", arguments: {
      link_attempt_id: pagedAttempt, result_id: firstPage.result_id, offset: 64, limit: 64
    } });
    assert.equal(secondPageResponse.isError, undefined, JSON.stringify(secondPageResponse));
    const secondPage = secondPageResponse.structuredContent as { result_id: string; offset: number; limit: number;
      observed_total: number; next_offset: number | null; has_more: boolean; artifacts: Array<{ url: string; message_id: string; object_index: number }> };
    assert.equal(secondPage.result_id, firstPage.result_id);
    assert.equal(secondPage.offset, 64);
    assert.equal(secondPage.limit, 64);
    assert.equal(secondPage.observed_total, 80);
    assert.equal(secondPage.next_offset, null);
    assert.equal(secondPage.has_more, false);
    assert.equal(secondPage.artifacts.length, 16);
    assert.deepEqual(secondPage.artifacts[0], { url: "https://r2.syntx.ai/runtime/10-2-25.png", mime_type: null,
      width: null, height: null, geometry_verified: false, message_id: "runtime-result-10-2", object_index: 24 });
    assert.deepEqual(secondPage.artifacts[15], { url: "https://r2.syntx.ai/runtime/10-2-40.png", mime_type: null,
      width: null, height: null, geometry_verified: false, message_id: "runtime-result-10-2", object_index: 39 });
    assert.equal(counters.results, providerReadsBeforePage, "cached page reads issue no native result GET");
    assert.equal(counters.posts, postsBeforePage, "result paging issues no generation POST");

    const unknownAttempt = "link_banana_runtime_unknown_0123456789";
    await linkSyntheticAttempt(runtime, unknownAttempt, FIXED_NOW + 2 * 60 * 60_000);
    const unknownOriginalResponse = await client.callTool({ name: "syntx_upload_banana_inpaint_original", arguments: {
      link_attempt_id: unknownAttempt, variant: "banana2", content_base64: PNG.toString("base64"),
      filename: "runtime-unknown-original.png", mime_type: "image/png"
    } });
    const unknownOriginal = unknownOriginalResponse.structuredContent as { reference_handle: string };
    const unknownPaintedResponse = await client.callTool({ name: "syntx_upload_banana_inpaint_painted_composite", arguments: {
      link_attempt_id: unknownAttempt, variant: "banana2", original_handle: unknownOriginal.reference_handle,
      content_base64: PNG.toString("base64"), filename: "runtime-unknown-painted.png", mime_type: "image/png"
    } });
    const unknownPainted = unknownPaintedResponse.structuredContent as { painted_handle: string };
    failNextPost = true;
    const generationController = new AbortController();
    const unknownGenerate = client.callTool({ name: "syntx_owner_generate_banana_inpaint_image", arguments: {
      link_attempt_id: unknownAttempt, variant: "banana2", prompt: "unknown post stays unresolved", image_size: "2K",
      original_handle: unknownOriginal.reference_handle, painted_handle: unknownPainted.painted_handle,
      auxiliary_reference_handle: null
    } }, undefined, { signal: generationController.signal });
    await unknownPostStarted;
    generationController.abort();
    await assert.rejects(unknownGenerate);
    assert.equal(counters.posts, 11, "one dispatched POST only; unknown ACK cannot be replayed");
    const recoveryResponse = await client.callTool({ name: "syntx_owner_list_banana_inpaint_image_recoveries", arguments: {
      link_attempt_id: unknownAttempt
    } });
    const recoveries = (recoveryResponse.structuredContent as { recoveries: Array<{ recovery_id: string; status: string }> }).recoveries;
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0]!.status, "OUTCOME_UNKNOWN");

    now = FIXED_NOW + 16 * 60_000;
    unknownRecoveryReady = true;
    const reconcileController = new AbortController();
    const reconcile = client.callTool({ name: "syntx_owner_reconcile_banana_inpaint_image", arguments: {
      link_attempt_id: unknownAttempt, recovery_id: recoveries[0]!.recovery_id
    } }, undefined, { signal: reconcileController.signal });
    const observedResult = await Promise.race([
      unknownResultRead.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000))
    ]);
    assert.equal(observedResult, true, "recovery must use the exact same client instance to reach the owned chat result GET");
    reconcileController.abort();
    await assert.rejects(reconcile);
    assert.equal(counters.posts, 11, "GET-only reconciliation does not issue a second generation POST");
    const stillUnknown = await client.callTool({ name: "syntx_owner_list_banana_inpaint_image_recoveries", arguments: {
      link_attempt_id: unknownAttempt
    } });
    assert.equal((stillUnknown.structuredContent as { recoveries: unknown[] }).recoveries.length, 1,
      "partial observation after UNKNOWN does not clear the unresolved hold");
  } finally {
    await Promise.all([client.close(), server.close()]);
    await composition.generationService.close();
  }
});

test("revoke validates the owner first, raises all Inpaint barriers before draining, then revokes credentials", async () => {
  const runtime = createObservedOwnerRuntime({ ownerBananaInpaintImageReferencesEnabled: true });
  const composition = runtime.serverOptions.ownerBananaInpaintImageReferences;
  assert.ok(composition);
  const auth = runtime.serverOptions.auth;
  assert.ok(auth);
  const originalSource = composition.originalReferenceService as OwnerBananaInpaintOriginalReferenceService;
  const paintedSource = composition.paintedCompositeReferenceService as OwnerBananaInpaintPaintedCompositeReferenceService;
  const auxiliarySource = composition.auxiliaryReferenceService as OwnerBananaInpaintAuxiliaryReferenceService;
  const events: string[] = [];
  const started = new Set<string>();
  let signalAllStarted!: () => void;
  const allStarted = new Promise<void>((resolve) => { signalAllStarted = resolve; });
  let releaseDrain!: () => void;
  const drainGate = new Promise<void>((resolve) => { releaseDrain = resolve; });
  const markStarted = (name: string): void => {
    events.push(`${name}.start`);
    started.add(name);
    if (started.size === 4) signalAllStarted();
  };
  const originalGenerationInvalidate = composition.generationService.invalidateAttempt.bind(composition.generationService);
  const originalInvalidate = originalSource.invalidateAttempt.bind(originalSource);
  const paintedInvalidate = paintedSource.invalidateAttempt.bind(paintedSource);
  const auxiliaryInvalidate = auxiliarySource.invalidateAttempt.bind(auxiliarySource);
  composition.generationService.invalidateAttempt = async (attemptId) => {
    markStarted("generation");
    await originalGenerationInvalidate(attemptId);
    events.push("generation.done");
  };
  originalSource.invalidateAttempt = async (attemptId) => {
    markStarted("original");
    await drainGate;
    await originalInvalidate(attemptId);
    events.push("original.done");
  };
  paintedSource.invalidateAttempt = async (attemptId) => {
    markStarted("painted");
    await drainGate;
    await paintedInvalidate(attemptId);
    events.push("painted.done");
  };
  auxiliarySource.invalidateAttempt = async (attemptId) => {
    markStarted("auxiliary");
    await drainGate;
    await auxiliaryInvalidate(attemptId);
    events.push("auxiliary.done");
  };
  const originalStoreRevoke = runtime.authStore.revoke.bind(runtime.authStore);
  runtime.authStore.revoke = async (...args) => { events.push("credentials.revoke"); return originalStoreRevoke(...args); };
  const ownerAttempt = "link_banana_runtime_revoke_owner_0123456789";
  const foreignAttempt = "link_banana_runtime_revoke_foreign_0123456789";
  await runtime.authStore.createAttempt({ attempt_id: ownerAttempt, binding: runtime.authBinding, expires_at_ms: Date.now() + 60_000 });
  const foreignBinding = { tenant_id: "another-tenant", subject: "another-owner" };
  await runtime.authStore.createAttempt({ attempt_id: foreignAttempt, binding: foreignBinding, expires_at_ms: Date.now() + 60_000 });
  try {
    await assert.rejects(auth.linkService.revoke(runtime.authBinding, foreignAttempt));
    assert.equal(events.length, 0, "foreign attempt must be rejected before any Inpaint invalidation");

    const revoke = auth.linkService.revoke(runtime.authBinding, ownerAttempt);
    const allStartedWithinBound = await Promise.race([
      allStarted.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000))
    ]);
    assert.equal(allStartedWithinBound, true, "generation and all three reference barriers must rise before awaiting drains");
    assert.equal(events.includes("credentials.revoke"), false);
    assert.equal(events.some((event) => event.endsWith(".done")), false);
    releaseDrain();
    const revoked = await revoke;
    assert.equal(revoked.status, "REVOKED");
    assert.equal(events.at(-1), "credentials.revoke");
  } finally {
    releaseDrain();
    await composition.generationService.close();
  }
});

test("stdio EOF drains an active native generation before auth release and closes the service", async () => {
  let signalPostStarted!: () => void;
  const postStarted = new Promise<void>((resolve) => { signalPostStarted = resolve; });
  let postCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats/upload-files" && init?.method === "POST") {
      const form = init.body as FormData;
      const file = form.get("files");
      assert.ok(file instanceof File);
      const id = crypto.randomUUID();
      return Response.json({ files: [{ id, file_id: id, url: `https://r2.syntx.ai/eof/${id}.png`, mime_type: file.type,
        size: file.size, status: "accepted" }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") return Response.json({ uuid: "banana-inpaint-eof-chat" });
    if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") {
      postCount += 1;
      signalPostStarted();
      return new Promise<Response>(() => undefined);
    }
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 3, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: null });
    if (/^\/api\/v1\/chats\/banana-inpaint-eof-chat\/inprogress$/u.test(url.pathname)) return Response.json([]);
    throw new Error(`Unexpected EOF fixture request ${init?.method ?? "GET"} ${url.pathname}`);
  };
  // The synthetic link expiry below is based on FIXED_NOW; align the runtime-owned store clock with it.
  const runtime = createObservedOwnerRuntime({ ownerBananaInpaintImageReferencesEnabled: true, fetchImpl, now: () => FIXED_NOW, requestTimeoutMs: 2_000 });
  const composition = runtime.serverOptions.ownerBananaInpaintImageReferences;
  assert.ok(composition);
  const attemptId = "link_banana_runtime_eof_0123456789";
  await linkSyntheticAttempt(runtime, attemptId);
  const original = await composition.originalReferenceService.upload({ attemptId, variant: "banana2",
    content_base64: PNG.toString("base64"), filename: "eof-original.png", mime_type: "image/png" });
  const painted = await composition.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId, variant: "banana2",
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "eof-painted.png", mime_type: "image/png" });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "banana-inpaint-runtime-eof", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const events: string[] = [];
  const input = new PassThrough();
  let transport!: Transport;
  transport = { async start() {}, async send() {}, async close() { transport.onclose?.(); } };
  const originalClose = composition.generationService.close.bind(composition.generationService);
  composition.generationService.close = async () => { events.push("generation.close.begin"); await originalClose(); events.push("generation.close.done"); };
  const close = closeOwnerReadServicesOnTransportEof(transport, undefined, undefined, undefined, undefined,
    () => { events.push("auth.release"); }, input, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, true, undefined, composition.generationService);
  const generation = client.callTool({ name: "syntx_owner_generate_banana_inpaint_image", arguments: {
    link_attempt_id: attemptId, variant: "banana2", prompt: "EOF drain fixture", image_size: "2K",
    original_handle: original.reference_handle, painted_handle: painted.painted_handle, auxiliary_reference_handle: null
  } });
  try {
    await postStarted;
    assert.equal(postCount, 1);
    await close();
    await Promise.allSettled([generation]);
    assert.deepEqual(events, ["generation.close.begin", "generation.close.done", "auth.release"]);
    assert.equal(postCount, 1, "no generation POST may race after the EOF barrier");
    await assert.rejects(composition.generationService.generate({ attemptId, variant: "banana2", prompt: "closed", image_size: "2K",
      original_handle: original.reference_handle, painted_handle: painted.painted_handle, auxiliary_reference_handle: null }),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "SERVICE_CLOSED");
    await assert.rejects(composition.originalReferenceService.upload({ attemptId, variant: "banana2",
      content_base64: PNG.toString("base64"), filename: "after-eof.png", mime_type: "image/png" }),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "SERVICE_CLOSED");
    assert.equal(postCount, 1, "closed input services cannot begin new work after EOF");
  } finally {
    await Promise.allSettled([client.close(), server.close(), close()]);
    input.destroy();
  }
});
