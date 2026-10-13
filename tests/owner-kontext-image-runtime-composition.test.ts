import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_KONTEXT_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_KONTEXT_IMAGE_TOOL_NAME,
  SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME
} from "../src/mcp/owner-kontext-image-tools.js";
import * as ownerStdio from "../src/transports/stdio-owner.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

const KONTEXT_TOOLS = [
  SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_KONTEXT_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_KONTEXT_RECOVERIES_TOOL_NAME
];
const KONTEXT_PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const KONTEXT_PROMPT = "  keep this prompt exactly  ";
const KONTEXT_PARAMETERS = Object.freeze({ resolution: "1024x1024", cfg: 2.7, steps: 17.5, image_strength: 0.63 });

async function listedOwnerTools(runtime: ReturnType<typeof createObservedOwnerRuntime>): Promise<string[]> {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "kontext-owner-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return (await client.listTools()).tools.map((tool) => tool.name); }
  finally { await client.close(); await server.close(); }
}

test("Kontext owner stdio flag is strict and defaults off", () => {
  const readFlag = (ownerStdio as unknown as {
    readOwnerKontextImageReferencesFlag?: (value: string | undefined) => boolean;
  }).readOwnerKontextImageReferencesFlag;
  assert.equal(typeof readFlag, "function", "Kontext owner flag parser must be exported for the stdio boundary");
  assert.equal(readFlag?.(undefined), false);
  assert.equal(readFlag?.(""), false);
  assert.equal(readFlag?.("0"), false);
  assert.equal(readFlag?.("1"), true);
  for (const value of ["true", "yes", "01", " 1 ", "2"]) {
    assert.throws(() => readFlag?.(value), /Invalid SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES configuration/u);
  }
});

test("explicit Kontext runtime opt-in builds the private composition without startup traffic", async () => {
  let defaultFetchCalls = 0;
  const defaultRuntime = createObservedOwnerRuntime({
    publicCatalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    catalogDirectory: resolve(process.cwd(), "catalog"),
    fetchImpl: async () => { defaultFetchCalls += 1; throw new Error("default runtime must not fetch"); }
  });
  assert.equal(defaultRuntime.serverOptions.ownerKontextImageReferences, undefined);

  assert.throws(() => createObservedOwnerRuntime({
    ownerKontextImageReferencesEnabled: true,
    publicCatalogVersion: "sha256-c6fdcc522def8f6f4ef2c172d23822164f0124b29bb5fe86e2b5dce5c54b9fbc.json",
    catalogDirectory: resolve(process.cwd(), "catalog")
  }), /selected e551 source-pinned public catalog/u,
  "Kontext runtime must reject a real adjacent catalog snapshot rather than drift sources");

  let fetchCalls = 0;
  const runtime = createObservedOwnerRuntime({
    ownerKontextImageReferencesEnabled: true,
    publicCatalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    catalogDirectory: resolve(process.cwd(), "catalog"),
    fetchImpl: async () => { fetchCalls += 1; throw new Error("runtime construction must not fetch"); }
  } as Parameters<typeof createObservedOwnerRuntime>[0]);
  const composition = runtime.serverOptions.ownerKontextImageReferences;
  assert.ok(composition, "explicit opt-in must construct the owner-only composition");
  assert.equal(fetchCalls, 0, "composition is local-only at startup");
  assert.equal(defaultFetchCalls, 0);
  try {
    const names = await listedOwnerTools(defaultRuntime);
    assert.equal(names.filter((name) => KONTEXT_TOOLS.includes(name as typeof KONTEXT_TOOLS[number])).length, 0);
  } finally {
    await composition.generationService.close();
  }
});

test("Kontext opt-in attaches attempt-revoke invalidation without upstream reads", async () => {
  let fetchCalls = 0;
  const runtime = createObservedOwnerRuntime({
    ownerKontextImageReferencesEnabled: true,
    publicCatalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    catalogDirectory: resolve(process.cwd(), "catalog"),
    fetchImpl: async () => { fetchCalls += 1; throw new Error("revocation invalidation must remain local"); }
  } as Parameters<typeof createObservedOwnerRuntime>[0]);
  const composition = (runtime.serverOptions as unknown as {
    ownerKontextImageReferences?: { generationService: { close(): Promise<void> } };
  }).ownerKontextImageReferences;
  assert.ok(composition);
  try {
    const onRevoked = runtime.serverOptions.auth?.onRevoked;
    assert.equal(typeof onRevoked, "function", "the enabled owner generation service must be invalidated on unlink");
    await onRevoked?.("link_kontext_revoke_0123456789");
    assert.equal(fetchCalls, 0);
  } finally {
    await composition.generationService.close();
  }
});

test("stdio EOF closes Kontext generation once before releasing owner auth", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const transport = { onclose: undefined, async close() {} } as unknown as Transport;
  const close = closeOwnerReadServicesOnTransportEof(
    transport, undefined, undefined, undefined, undefined,
    () => { events.push("auth.close"); }, input, undefined, undefined,
    { async close() { events.push("kontext.generation.close"); } }
  );
  await close();
  await close();
  assert.deepEqual(events, ["kontext.generation.close", "auth.close"]);
  input.destroy();
});

test("durable owner mode rejects Kontext paid composition before runtime startup", async () => {
  const previousKontext = process.env.SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES;
  const previousDurable = process.env.SYNTX_OWNER_DURABLE_GENERATION;
  try {
    process.env.SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Durable owner generation cannot be combined with legacy paid generation tools/u);
  } finally {
    if (previousKontext === undefined) delete process.env.SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES;
    else process.env.SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES = previousKontext;
    if (previousDurable === undefined) delete process.env.SYNTX_OWNER_DURABLE_GENERATION;
    else process.env.SYNTX_OWNER_DURABLE_GENERATION = previousDurable;
  }
});

test("stdio rejects invalid Kontext flag before other startup configuration", async () => {
  const previousKontext = process.env.SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES;
  const previousDurable = process.env.SYNTX_OWNER_DURABLE_GENERATION;
  try {
    process.env.SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES = "true";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES configuration/u);
  } finally {
    if (previousKontext === undefined) delete process.env.SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES;
    else process.env.SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES = previousKontext;
    if (previousDurable === undefined) delete process.env.SYNTX_OWNER_DURABLE_GENERATION;
    else process.env.SYNTX_OWNER_DURABLE_GENERATION = previousDurable;
  }
});

test("stock owner SDK runs full Kontext upload/preflight/start/history/result for three variants", async () => {
  const attemptId = "link_kontext_runtime_owner_0123456789";
  const baseNow = Date.now();
  let fakeNow = baseNow;
  let activePlan = true;
  let pendingNextResult = false;
  let uploadCalls = 0;
  let chatCalls = 0;
  let generationCalls = 0;
  let historyCalls = 0;
  let inProgressCalls = 0;
  let resultCalls = 0;
  let accountCalls = 0;
  let modelQueries: Array<{ entries: Array<[string, string]>; model_id: string }> = [];
  const uploadedUrlByHandle = new Map<string, string>();
  const lastUploadUrl: { current?: string } = {};
  const chats = new Map<string, {
    index: number;
    variant: "flux-kontext-pro" | "flux-kontext-max" | "flux-kontext-multi";
    echoId: string;
    botId: string;
    objectId: string;
    providerChatId: number;
    fileUrls: Array<{ type: "image"; url: string }>;
    pendingResult: boolean;
  }>();
  const expectedGeneration: { current?: {
    variant: "flux-kontext-pro" | "flux-kontext-max" | "flux-kontext-multi";
    resolution: "1344x768" | "1152x896" | "1024x1024" | "896x1152" | "768x1344";
    referenceHandles: string[];
  } } = {};
  const runtime = createObservedOwnerRuntime({
    ownerKontextImageReferencesEnabled: true,
    publicCatalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    catalogDirectory: resolve(process.cwd(), "catalog"),
    now: () => fakeNow,
    fetchImpl: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/v1/user/balance") {
        accountCalls += 1;
        assert.equal(method, "GET");
        return Response.json({ balance: "120.50" });
      }
      if (url.pathname === "/api/v1/user/subscription") {
        accountCalls += 1;
        assert.equal(method, "GET");
        return Response.json({ active: activePlan, type: "PRO", end_date: null });
      }
      if (url.pathname === "/api/v2/get_model_info") {
        assert.equal(method, "GET");
        const entries = [...url.searchParams.entries()];
        const model_id = url.searchParams.get("model_type") ?? "";
        assert.equal(url.searchParams.get("ai_name"), "flux");
        assert.deepEqual(entries, [["ai_name", "flux"], ["model_type", model_id]],
          "Kontext cost2 params are exactly empty: no invented dimensions, controls, or reference count");
        modelQueries.push({ entries, model_id });
        return Response.json({ access: true, cost: 1.25, discount_cost: null,
          free_remaining_generations: null, limit: null, show_warning: false });
      }
      if (url.pathname === "/api/v1/chats/upload-files") {
        uploadCalls += 1;
        assert.equal(method, "POST");
        assert.ok(init?.body instanceof FormData);
        const form = init.body as FormData;
        assert.deepEqual([...form.keys()], ["files", "destination", "check_duplicates", "model_type"]);
        assert.equal(form.get("destination"), "uploaded");
        assert.equal(form.get("check_duplicates"), "true");
        const file = form.get("files");
        assert.ok(file instanceof File);
        const id = `kontext-native-file-${uploadCalls}`;
        lastUploadUrl.current = `https://r2.syntx.ai/kontext/input-${uploadCalls}.png`;
        return Response.json({ files: [{ id, url: lastUploadUrl.current, mime_type: "image/png", size: file.size }] });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        chatCalls += 1;
        const body = JSON.parse(String(init?.body)) as { title: string; scope: string };
        assert.equal(body.scope, "image");
        assert.match(body.title, /^owner-kontext-/u);
        return Response.json({ uuid: `kontext-runtime-chat-${chatCalls}` });
      }
      if (url.pathname === "/api/v1/design/generate") {
        generationCalls += 1;
        assert.equal(method, "POST");
        assert.equal(url.search, "?ai_name=flux");
        const spec = expectedGeneration.current;
        assert.ok(spec);
        const body = JSON.parse(String(init?.body)) as {
          chat_uuid: string; prompt: string; settings: Record<string, unknown>
        };
        const expectedUrls: Array<{ type: "image"; url: string }> = spec.referenceHandles.map((handle) => {
          const referenceUrl = uploadedUrlByHandle.get(handle);
          assert.ok(referenceUrl);
          return { type: "image" as const, url: referenceUrl };
        });
        assert.deepEqual(body, {
          chat_uuid: `kontext-runtime-chat-${chatCalls}`,
          prompt: KONTEXT_PROMPT,
          settings: {
            n: 1, model_type: spec.variant, workflow_type: "default", civitai_loras: [],
            resolution: spec.resolution, cfg: 2.7, steps: 17.5, image_strength: 0.63,
            file_urls: expectedUrls
          }
        });
        const index = chatCalls;
        const state = {
          index,
          variant: spec.variant,
          echoId: `kontext-runtime-echo-${index}`,
          botId: `kontext-runtime-bot-${index}`,
          objectId: `kontext-runtime-object-${index}`,
          providerChatId: 700 + index,
          fileUrls: expectedUrls,
          pendingResult: pendingNextResult
        };
        pendingNextResult = false;
        chats.set(body.chat_uuid, state);
        return Response.json({ id: state.echoId });
      }
      if (/^\/api\/v1\/chats\/[^/]+\/messages$/u.test(url.pathname) && method === "GET") {
        historyCalls += 1;
        const chatUuid = url.pathname.split("/")[4]!;
        const state = chats.get(chatUuid);
        assert.ok(state);
        assert.equal(url.search, "?page=1&page_size=10");
        const ownerObjects = state.fileUrls.map((_file, index) => ({
          id: `kontext-owner-ref-${state.index}-${index + 1}`,
          message_id: state.echoId,
          object_type: "image",
          model_type: state.variant
        }));
        ownerObjects.push({
          id: `kontext-owner-text-${state.index}`, message_id: state.echoId, object_type: "text", model_type: null
        } as never);
        return Response.json({
          messages: [
            { id: state.echoId, chat_id: state.providerChatId, author_id: 12345, message_object: ownerObjects },
            { id: state.botId, chat_id: state.providerChatId, author_id: -1, message_object: [{
              id: state.objectId, message_id: state.botId, object_type: "image", model_type: state.variant
            }] }
          ],
          pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
        });
      }
      if (/^\/api\/v1\/chats\/[^/]+\/inprogress$/u.test(url.pathname) && method === "GET") {
        inProgressCalls += 1;
        return Response.json([]);
      }
      if (/^\/api\/v1\/chats\/[^/]+\/[^/]+$/u.test(url.pathname) && method === "GET") {
        resultCalls += 1;
        const [, , , , chatUuid, messageId] = url.pathname.split("/");
        const state = chats.get(chatUuid!);
        assert.ok(state);
        assert.equal(messageId, state.botId);
        const pending = state.pendingResult;
        if (pending) fakeNow = baseNow + 180_001;
        return Response.json({ id: state.botId, chat_id: state.providerChatId, author_id: -1,
          message_object: [{ id: state.objectId, message_id: state.botId, object_type: "image",
            model_type: state.variant, completed: !pending, object_url: `https://r2.syntx.ai/kontext/output-${state.index}.png` }] });
      }
      throw new Error(`Unexpected fake runtime route: ${method} ${url.pathname}`);
    }
  });
  const composition = runtime.serverOptions.ownerKontextImageReferences;
  assert.ok(composition);
  const client = new Client({ name: "kontext-owner-sdk-runtime-test", version: "1.0.0" });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const principalBinding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: principalBinding, expires_at_ms: baseNow + 900_000 });
  await runtime.authStore.beginHandoff(principalBinding, attemptId);
  await runtime.authStore.attachChallenge(principalBinding, attemptId, "synthetic-kontekst-auth-attempt");
  await runtime.authStore.beginPoll(principalBinding, attemptId);
  await runtime.authStore.markLinked(principalBinding, attemptId, { scheme: "Bearer", value: "synthetic-kontext-runtime-credential" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).filter((name) => KONTEXT_TOOLS.includes(name as typeof KONTEXT_TOOLS[number])), KONTEXT_TOOLS);
    const scenarios = [
      { variant: "flux-kontext-pro", referenceCount: 0, resolution: "1344x768" },
      { variant: "flux-kontext-max", referenceCount: 0, resolution: "1152x896" },
      { variant: "flux-kontext-multi", referenceCount: 1, resolution: "1024x1024" },
      { variant: "flux-kontext-multi", referenceCount: 4, resolution: "896x1152" }
    ] as const;
    for (const scenario of scenarios) {
      const handles: string[] = [];
      for (let i = 0; i < scenario.referenceCount; i += 1) {
        const uploaded = await client.callTool({ name: SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME, arguments: {
          link_attempt_id: attemptId, variant: scenario.variant, content_base64: KONTEXT_PNG_1X1,
          filename: `${scenario.variant}-${i + 1}.png`, mime_type: "image/png"
        } });
        assert.equal(uploaded.isError, undefined);
        const receipt = uploaded.structuredContent as { reference_handle: string };
        handles.push(receipt.reference_handle);
        uploadedUrlByHandle.set(receipt.reference_handle, lastUploadUrl.current!);
      }
      expectedGeneration.current = { variant: scenario.variant, resolution: scenario.resolution, referenceHandles: handles };
      const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME, arguments: {
        link_attempt_id: attemptId, variant: scenario.variant, reference_handles: handles,
        parameters: { ...KONTEXT_PARAMETERS, resolution: scenario.resolution },
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: KONTEXT_PROMPT
      } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.equal((result.structuredContent as { variant: string }).variant, scenario.variant);
    }
    assert.equal(uploadCalls, 5);
    assert.equal(chatCalls, 4);
    assert.equal(generationCalls, 4);
    assert.deepEqual(modelQueries.map((query) => query.model_id), [
      "flux-kontext-pro", "flux-kontext-pro", "flux-kontext-max", "flux-kontext-max",
      "flux-kontext-multi", "flux-kontext-multi", "flux-kontext-multi", "flux-kontext-multi"
    ]);

    expectedGeneration.current = { variant: "flux-kontext-pro", resolution: "768x1344", referenceHandles: [] };
    pendingNextResult = true;
    const pending = await client.callTool({ name: SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: attemptId, variant: "flux-kontext-pro", reference_handles: [],
      parameters: { ...KONTEXT_PARAMETERS, resolution: "768x1344" },
      workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: KONTEXT_PROMPT
    } });
    assert.equal(pending.isError, true);
    const pendingError = JSON.parse((pending.content as readonly { text: string }[])[0]!.text) as {
      error: { code: string; recovery_id: string; diagnostic: { result_status: string; result_reason: string } }
    };
    assert.equal(pendingError.error.code, "OUTCOME_UNKNOWN");
    assert.equal(pendingError.error.diagnostic.result_status, "PENDING");
    assert.equal(pendingError.error.diagnostic.result_reason, "RESULT_NOT_COMPLETED");
    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_KONTEXT_RECOVERIES_TOOL_NAME, arguments: { link_attempt_id: attemptId } });
    assert.equal(listed.isError, undefined);
    assert.equal((listed.structuredContent as { recoveries: Array<{ recovery_id: string }> }).recoveries[0]?.recovery_id,
      pendingError.error.recovery_id);
    const pendingChat = chats.get(`kontext-runtime-chat-${chatCalls}`)!;
    pendingChat.pendingResult = false;
    const countAfterPending = { chatCalls, generationCalls, uploadCalls, modelQueries: modelQueries.length, accountCalls };
    const getsBeforeReconcile = { historyCalls, resultCalls };
    const reconciled = await client.callTool({ name: SYNTX_OWNER_RECONCILE_KONTEXT_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: attemptId, recovery_id: pendingError.error.recovery_id
    } });
    assert.equal(reconciled.isError, undefined);
    assert.deepEqual({ chatCalls, generationCalls, uploadCalls, modelQueries: modelQueries.length, accountCalls }, countAfterPending,
      "same-handle reconcile is GET-only: no new chat, POST, upload, account or cost query");
    assert.deepEqual({ historyCalls, resultCalls }, { historyCalls: getsBeforeReconcile.historyCalls,
      resultCalls: getsBeforeReconcile.resultCalls + 1 }, "known bot/object binding reconciles with one exact result GET");

    activePlan = false;
    const beforeInactive = { chatCalls, generationCalls };
    const inactive = await client.callTool({ name: SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: attemptId, variant: "flux-kontext-max", reference_handles: [],
      parameters: { ...KONTEXT_PARAMETERS, resolution: "768x1344" },
      workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: KONTEXT_PROMPT
    } });
    assert.equal(inactive.isError, true);
    assert.deepEqual({ chatCalls, generationCalls }, beforeInactive, "inactive plan blocks before chat and paid POST");

    const revokedUpload = await client.callTool({ name: SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: attemptId, variant: "flux-kontext-multi", content_base64: KONTEXT_PNG_1X1,
      filename: "revoked.png", mime_type: "image/png"
    } });
    assert.equal(revokedUpload.isError, undefined);
    const revokedHandle = (revokedUpload.structuredContent as { reference_handle: string }).reference_handle;
    const unlinked = await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } });
    assert.equal((unlinked.structuredContent as { status: string }).status, "REVOKED");
    const beforeRevoked = { chatCalls, generationCalls };
    const afterRevoke = await client.callTool({ name: SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: attemptId, variant: "flux-kontext-multi", reference_handles: [revokedHandle],
      parameters: { ...KONTEXT_PARAMETERS, resolution: "1024x1024" },
      workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: KONTEXT_PROMPT
    } });
    assert.equal(afterRevoke.isError, true);
    assert.deepEqual({ chatCalls, generationCalls }, beforeRevoked, "revoke invalidates owned upload state before further dispatch");
    assert.ok(historyCalls >= 5);
    assert.ok(resultCalls >= 6);
    assert.equal(inProgressCalls, 0, "an exact bot binding uses result GET directly, without in-progress guessing");
    assert.equal(modelQueries.every((query) => query.entries.length === 2), true);
  } finally {
    await client.close();
    await server.close();
    await composition.generationService.close();
  }
});
