import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import type { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { createOwnerSeedreamEditorImageGenerationService } from "../src/application/owner-seedream-editor-image-generation-service.js";
import { OwnerSeedreamEditorOriginalReferenceService } from "../src/application/owner-seedream-editor-original-reference-service.js";
import { OwnerSeedreamEditorDrawingReferenceService } from "../src/application/owner-seedream-editor-drawing-reference-service.js";
import { OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION as C5,
  OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION as SETTINGS_62 } from "../src/application/owner-seedream-editor-original-upload-source-profile.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS } from "../src/application/owner-seedream-image-parameters.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";

const moduleUrl = new URL("../src/mcp/owner-seedream-editor-image-tools.js", import.meta.url).href;
const toolsModule = await import(moduleUrl).catch(() => null) as Record<string, unknown> | null;
const FIXED_NOW = Date.parse("2026-10-12T12:00:00.000Z");
const ATTEMPT = "link_seedream_editor_tools_0123456789";
const BINDING = Object.freeze({ tenant_id: "seedream-editor-tools-tenant", subject: "seedream-editor-tools-subject" });
const VARIANTS = OWNER_SEEDREAM_IMAGE_VARIANTS;
const RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;
const RESOLUTIONS: Record<string, readonly string[]> = { "seedream-4": ["1K", "2K", "4K"], "seedream-4.5": ["2K", "4K"],
  "seedream-5": ["2K", "3K", "4K"], "seedream-5.0-flash": ["1K", "1.5K", "2K"], "seedream-5.0-pro": ["1K", "2K"] };
const CATALOG = loadSelectedDiscoveryCatalog(C5, join(process.cwd(), "catalog")).discoveryCatalog;
const SETTINGS = loadMaplessSettingsInventoryVersion(SETTINGS_62, join(process.cwd(), "catalog"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function jsonResponse(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function linked(attemptId: string) { return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
  status: "LINKED" as const, expires_at: null, linked: true }; }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (credential: string) => Promise<T>) { return fn("synthetic-editor-mcp-credential"); } }; }

function createActualComposition(options: { readonly resultObjects?: number; readonly resultMessages?: number } = {}) {
  let now = FIXED_NOW, uploads = 0, chats = 0, generationPosts = 0, accountReads = 0, modelReads = 0, historyReads = 0, resultReads = 0;
  const isLinked = new Map<string, boolean>([[ATTEMPT, true]]);
  const transactions = new Map<string, { readonly ack: string | null; readonly resultIds: readonly string[]; readonly chatId: number; readonly variant: string }>();
  const objectCount = options.resultObjects ?? 8, messageCount = options.resultMessages ?? 10;
  const credentialBroker = broker();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats/upload-files" && init?.method === "POST") {
      uploads += 1;
      const form = init.body as FormData, file = form.get("files") as File;
      return jsonResponse({ files: [{ id: `editor-file-${uploads}`, file_id: `editor-file-${uploads}`,
        url: `https://r2.syntx.ai/editor/input-${uploads}.png`, ...(form.get("destination") === "uploaded"
          ? { mime_type: file.type, size: file.size, status: "accepted" } : {}) }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") { chats += 1; return jsonResponse({ uuid: `editor-tool-chat-${chats}` }); }
    if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") {
      generationPosts += 1;
      const body = JSON.parse(String(init.body)) as { chat_uuid: string; prompt: string; settings: { model_type: string } };
      const unknown = body.prompt.includes("unknown outcome");
      const resultIds = Object.freeze(Array.from({ length: unknown ? 1 : messageCount }, (_, index) => `editor-tool-result-${generationPosts}-${index + 1}`));
      const ack = unknown ? null : `editor-tool-ack-${generationPosts}`;
      transactions.set(body.chat_uuid, { ack, resultIds, chatId: 7_400 + generationPosts, variant: body.settings.model_type });
      return jsonResponse(ack === null ? {} : { id: ack });
    }
    if (/^\/api\/v1\/chats\/editor-tool-chat-\d+\/inprogress$/u.test(url.pathname)) return jsonResponse([]);
    const history = /^\/api\/v1\/chats\/(editor-tool-chat-\d+)\/messages$/u.exec(url.pathname);
    if (history && init?.method === "GET") {
      historyReads += 1;
      const tx = transactions.get(history[1]!); assert.ok(tx);
      const bots = tx.resultIds.map((messageId) => ({ id: messageId, chat_id: tx.chatId, author_id: -1,
        message_object: Array.from({ length: objectCount }, (_, index) => ({ id: `${messageId}-object-${index + 1}`,
          message_id: messageId, object_type: index % 2 ? "image_url" : "image", model_type: tx.variant })) }));
      const messages = [...(tx.ack === null ? [] : [{ id: tx.ack, chat_id: tx.chatId, author_id: 27, message_object: [] }]), ...bots];
      const page = Number(url.searchParams.get("page")), size = Number(url.searchParams.get("page_size"));
      const totalPages = messages.length === 0 ? 0 : Math.ceil(messages.length / 10);
      return jsonResponse({ messages: messages.slice((page - 1) * size, page * size),
        pagination: { page, page_size: size, total_count: messages.length, total_pages: totalPages,
          has_next: page < totalPages, has_previous: page > 1 } });
    }
    const resultRoute = /^\/api\/v1\/chats\/(editor-tool-chat-\d+)\/(editor-tool-result-\d+-\d+)$/u.exec(url.pathname);
    if (resultRoute && init?.method === "GET") {
      resultReads += 1;
      const tx = transactions.get(resultRoute[1]!); assert.ok(tx);
      const messageId = resultRoute[2]!; assert.ok(tx.resultIds.includes(messageId));
      return jsonResponse({ id: messageId, chat_id: tx.chatId, author_id: -1, message_object: Array.from({ length: objectCount }, (_, index) => ({
        id: `${messageId}-object-${index + 1}`, object_type: index % 2 ? "image_url" : "image",
        object_url: `https://r2.syntx.ai/editor/results/${messageId}-${index + 1}.png`, completed: true, model_type: tx.variant
      })) });
    }
    if (url.pathname === "/api/v1/user/balance") { accountReads += 1; return jsonResponse({ balance: "900" }); }
    if (url.pathname === "/api/v1/user/subscription") {
      accountReads += 1;
      return jsonResponse({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      modelReads += 1;
      return jsonResponse({ access: true, cost: 3, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    }
    throw new Error(`Unexpected synthetic route ${init?.method ?? "GET"} ${url.pathname}`);
  };
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    return isLinked.get(attemptId) === false ? { ...linked(attemptId), status: "REVOKED" as const, linked: false } : linked(attemptId);
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 2_000 });
  const httpClient = new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 2_000 });
  const originalReferenceService = new OwnerSeedreamEditorOriginalReferenceService({ binding: BINDING, linkService, catalog: CATALOG,
    public_catalog_version: C5, settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62, resolveClient: () => chatClient, now: () => now });
  const drawingReferenceService = new OwnerSeedreamEditorDrawingReferenceService({ originalReferenceService, binding: BINDING,
    linkService, catalog: CATALOG, public_catalog_version: C5, settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62,
    resolveClient: () => chatClient, now: () => now });
  const generationService = createOwnerSeedreamEditorImageGenerationService({ binding: BINDING, linkService, originalReferenceService,
    drawingReferenceService, resolveChatClient: () => chatClient,
    createAccountStatusService: () => new AccountStatusService(httpClient, () => now),
    createModelAccessService: (_attemptId: string, catalog: DiscoveryCatalogRepository) => new ModelAccessService(catalog, httpClient, () => now),
    now: () => now, pollDelayMs: 0, maxPollAttempts: 1 });
  return { composition: { originalReferenceService, drawingReferenceService, generationService }, isLinked,
    counts: () => ({ uploads, chats, generationPosts, accountReads, modelReads, historyReads, resultReads }),
    async close() { await generationService.close(); await drawingReferenceService.close(); await originalReferenceService.close(); } };
}

async function connectServer(options?: Parameters<typeof createMcpServer>[1]) {
  const server = createMcpServer(createDefaultApplication(), options);
  const client = new Client({ name: "seedream-editor-image-tools-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client, server };
}

test("publishes the seven fixed Seedream Editor owner tools and strict schemas", () => {
  assert.ok(toolsModule, "MISSING_OWNER_SEEDREAM_EDITOR_IMAGE_TOOLS_MODULE");
  assert.deepEqual(toolsModule.OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES, [
    "syntx_get_seedream_editor_image_parameters",
    "syntx_upload_seedream_editor_original",
    "syntx_upload_seedream_editor_drawing",
    "syntx_owner_generate_seedream_editor_image",
    "syntx_owner_reconcile_seedream_editor_image",
    "syntx_owner_list_seedream_editor_image_recoveries",
    "syntx_owner_get_seedream_editor_image_result_page"
  ]);
  assert.equal(typeof toolsModule.registerSyntxOwnerSeedreamEditorImageTools, "function");
  assert.ok(toolsModule.OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_INPUT_SCHEMAS);
  assert.ok(toolsModule.OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_OUTPUT_SCHEMAS);
});

test("source controls and per-variant schema cover all 104 exact ratio-resolution combinations", () => {
  assert.ok(toolsModule, "MISSING_OWNER_SEEDREAM_EDITOR_IMAGE_TOOLS_MODULE");
  const inputs = toolsModule.OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_INPUT_SCHEMAS as {
    generate: { safeParse(input: unknown): { success: boolean } };
    upload_drawing: { safeParse(input: unknown): { success: boolean } };
  };
  let total = 0;
  for (const variant of VARIANTS) for (const aspect_ratio of RATIOS) for (const resolution of RESOLUTIONS[variant]!) {
    const common = { link_attempt_id: ATTEMPT, variant, prompt: "Preserve the composition.", parameters: { aspect_ratio, resolution },
      original_handle: `seedream_editor_original_${"11111111-1111-4111-8111-111111111111"}` };
    assert.equal(inputs.generate.safeParse({ ...common, drawing_handle: null }).success, true, `${variant}/${aspect_ratio}/${resolution}/no-drawing`);
    assert.equal(inputs.generate.safeParse({ ...common, drawing_handle: `seedream_editor_drawing_${"22222222-2222-4222-8222-222222222222"}` }).success,
      true, `${variant}/${aspect_ratio}/${resolution}/drawing`);
    total += 1;
  }
  assert.equal(total, 104);
  const invalid = { link_attempt_id: ATTEMPT, variant: "seedream-4", prompt: "valid", parameters: { aspect_ratio: "1:1", resolution: "1K" },
    original_handle: `seedream_editor_original_${"11111111-1111-4111-8111-111111111111"}`, drawing_handle: null };
  for (const key of ["url", "file_url", "principal", "permit", "preparer", "n", "stream", "model_type", "background", "output_format", "mask", "billing_count"])
    assert.equal(inputs.generate.safeParse({ ...invalid, [key]: "caller-authority" }).success, false, `reject ${key}`);
  assert.equal(inputs.generate.safeParse({ ...invalid, prompt: "  \n " }).success, false);
  assert.equal(inputs.generate.safeParse({ ...invalid, parameters: { aspect_ratio: "1:1", resolution: "1.5K" } }).success, false);
  assert.equal(inputs.upload_drawing.safeParse({ link_attempt_id: ATTEMPT, variant: "seedream-5", original_handle: invalid.original_handle,
    content_base64: PNG.toString("base64"), filename: "drawing.png", mime_type: "image/jpeg" }).success, false);
});

test("default MCP has no Editor tools; genuine composition registers exactly seven", async (t) => {
  const defaults = await connectServer();
  try {
    const names = (await defaults.client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => (toolsModule!.OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES as readonly string[]).includes(name)), false);
  } finally { await Promise.all([defaults.client.close(), defaults.server.close()]); }

  const fixture = createActualComposition(); t.after(() => fixture.close());
  const owner = await connectServer({ ownerSeedreamEditorImageReferences: fixture.composition });
  try {
    const listed = (await owner.client.listTools()).tools;
    const names = listed.map(({ name }) => name).filter((name) => (toolsModule!.OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES as readonly string[]).includes(name));
    assert.deepEqual(names.sort(), [...toolsModule!.OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES as readonly string[]].sort());
    const sourceTool = listed.find(({ name }) => name === "syntx_get_seedream_editor_image_parameters");
    assert.equal(sourceTool?.annotations?.readOnlyHint, true);
    assert.equal(sourceTool?.annotations?.destructiveHint, false);
  } finally { await Promise.all([owner.client.close(), owner.server.close()]); }
});

test("Stock SDK advertises closed object fields and all five variant branches", async (t) => {
  const fixture = createActualComposition();
  t.after(() => fixture.close());
  const owner = await connectServer({ ownerSeedreamEditorImageReferences: fixture.composition });
  t.after(async () => { await owner.client.close(); await owner.server.close(); });
  const listing = (await owner.client.listTools()).tools;
  const expected = [
    ["syntx_upload_seedream_editor_original", ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"]],
    ["syntx_owner_generate_seedream_editor_image", ["link_attempt_id", "variant", "prompt", "parameters", "original_handle", "drawing_handle"]]
  ] as const;
  for (const [name, fields] of expected) {
    const tool = listing.find((entry) => entry.name === name);
    assert.ok(tool);
    assert.equal(tool.inputSchema.type, "object");
    assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [...fields].sort());
    assert.deepEqual([...(tool.inputSchema.required ?? [])].sort(), [...fields].sort());
    assert.equal(tool.inputSchema.additionalProperties, false);
    const branches = (tool.inputSchema.oneOf ?? tool.inputSchema.anyOf) as { properties: { variant: { const: string } }; additionalProperties: boolean }[];
    assert.equal(branches?.length, 5);
    assert.deepEqual(branches.map((branch) => branch.properties.variant.const), OWNER_SEEDREAM_IMAGE_VARIANTS);
    assert.ok(branches.every((branch) => branch.additionalProperties === false));
  }
});

test("rejects structural fake services instead of exposing owner tools", () => {
  assert.throws(() => createMcpServer(createDefaultApplication(), { ownerSeedreamEditorImageReferences: {
    originalReferenceService: { async upload() { return {}; }, async close() {}, async invalidateAttempt() {} },
    drawingReferenceService: { async uploadDrawing() { return {}; }, async close() {}, async invalidateAttempt() {} },
    generationService: { async generate() { return {}; }, async reconcile() { return {}; }, async listRecoveries() { return []; },
      async getResultPage() { return {}; }, async close() {}, async invalidateAttempt() {} }
  } as never }), /SEEDREAM_EDITOR_SERVICE_COMPOSITION_INVALID/u);
});

test("rejects revoked proxy composition and dangling Unicode", () => {
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assert.throws(() => createMcpServer(createDefaultApplication(), { ownerSeedreamEditorImageReferences: revoked.proxy as never }),
    /SEEDREAM_EDITOR_SERVICE_COMPOSITION_INVALID/u);
  const schemas = toolsModule!.OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_INPUT_SCHEMAS as {
    generate: { safeParse(value: unknown): { success: boolean } };
    upload_original: { safeParse(value: unknown): { success: boolean } };
  };
  const base = { link_attempt_id: ATTEMPT, variant: "seedream-5", prompt: "A valid prompt",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: `seedream_editor_original_${"11111111-1111-4111-8111-111111111111"}`, drawing_handle: null };
  assert.equal(schemas.generate.safeParse({ ...base, prompt: "dangling \ud800" }).success, false);
  assert.equal(schemas.upload_original.safeParse({ link_attempt_id: ATTEMPT, variant: "seedream-5", content_base64: PNG.toString("base64"),
    filename: "dangling\ud800.png", mime_type: "image/png" }).success, false);
});

test("Stock SDK completes the real upload-drawing-generate-80-results-page flow without provider paging on cached reads", async (t) => {
  const fixture = createActualComposition({ resultObjects: 8, resultMessages: 10 });
  t.after(() => fixture.close());
  const owner = await connectServer({ ownerSeedreamEditorImageReferences: fixture.composition });
  t.after(async () => { await owner.client.close(); await owner.server.close(); });

  const source = await owner.client.callTool({ name: "syntx_get_seedream_editor_image_parameters", arguments: {} });
  assert.equal(source.isError, undefined);
  const sourceData = source.structuredContent as { variants: { variant: string; aspect_ratios: string[]; resolutions: string[] }[]; backend_acceptance: string };
  assert.equal(sourceData.variants.length, 5); assert.equal(sourceData.backend_acceptance, "UNPROVEN");
  assert.equal(sourceData.variants.reduce((sum, value) => sum + value.aspect_ratios.length * value.resolutions.length, 0), 104);

  const original = await owner.client.callTool({ name: "syntx_upload_seedream_editor_original", arguments: {
    link_attempt_id: ATTEMPT, variant: "seedream-5.0-pro", content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png"
  } });
  assert.equal(original.isError, undefined, JSON.stringify(original));
  const originalData = original.structuredContent as Record<string, unknown>;
  assert.equal(originalData.variant, "seedream-5.0-pro");
  assert.equal("url" in originalData || "file_url" in originalData, false);
  const originalHandle = originalData.reference_handle as string;

  const drawing = await owner.client.callTool({ name: "syntx_upload_seedream_editor_drawing", arguments: {
    link_attempt_id: ATTEMPT, variant: "seedream-5.0-pro", original_handle: originalHandle,
    content_base64: PNG.toString("base64"), filename: "drawing.png", mime_type: "image/png"
  } });
  assert.equal(drawing.isError, undefined, JSON.stringify(drawing));
  const drawingData = drawing.structuredContent as Record<string, unknown>;
  assert.equal(drawingData.original_handle, originalHandle); assert.equal(drawingData.generation_permit, false);
  assert.equal("url" in drawingData || "file_url" in drawingData, false);

  const generated = await owner.client.callTool({ name: "syntx_owner_generate_seedream_editor_image", arguments: {
    link_attempt_id: ATTEMPT, variant: "seedream-5.0-pro", prompt: "Preserve the subject and color palette.",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: originalHandle,
    drawing_handle: drawingData.drawing_handle
  } });
  assert.equal(generated.isError, undefined, JSON.stringify(generated));
  const result = generated.structuredContent as Record<string, unknown>;
  assert.equal(result.status, "completed"); assert.equal(result.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
  assert.equal(result.backend_acceptance, "UNPROVEN"); assert.equal(result.observed_total, 80);
  assert.equal(result.next_offset, 64); assert.equal(result.has_more, true);
  assert.equal((result.artifacts as unknown[]).length, 64);
  assert.deepEqual(result.cost_inputs, { batch_size: 2, resolution: "2K" });
  const countsBeforePage = fixture.counts();
  const page = await owner.client.callTool({ name: "syntx_owner_get_seedream_editor_image_result_page", arguments: {
    link_attempt_id: ATTEMPT, result_id: result.result_id, offset: 64
  } });
  assert.equal(page.isError, undefined, JSON.stringify(page));
  const pageData = page.structuredContent as { offset: number; artifacts: unknown[]; next_offset: number | null; has_more: boolean };
  assert.equal(pageData.offset, 64); assert.equal(pageData.artifacts.length, 16); assert.equal(pageData.next_offset, null); assert.equal(pageData.has_more, false);
  assert.deepEqual(fixture.counts(), countsBeforePage, "cached result paging must not issue provider GET or POST");
  assert.equal(fixture.counts().generationPosts, 1); assert.equal(fixture.counts().uploads, 2);
});

test("Stock SDK reconciles an unknown result using GET only and sanitizes caller/foreign-owner failures", async (t) => {
  const fixture = createActualComposition({ resultObjects: 1, resultMessages: 1 });
  t.after(() => fixture.close());
  const owner = await connectServer({ ownerSeedreamEditorImageReferences: fixture.composition });
  t.after(async () => { await owner.client.close(); await owner.server.close(); });
  const original = await owner.client.callTool({ name: "syntx_upload_seedream_editor_original", arguments: {
    link_attempt_id: ATTEMPT, variant: "seedream-5", content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png"
  } });
  const originalHandle = (original.structuredContent as { reference_handle: string }).reference_handle;
  const unknown = await owner.client.callTool({ name: "syntx_owner_generate_seedream_editor_image", arguments: {
    link_attempt_id: ATTEMPT, variant: "seedream-5", prompt: "unknown outcome fixture",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: originalHandle, drawing_handle: null
  } });
  assert.equal(unknown.isError, true);
  const error = JSON.parse((unknown.content as { text: string }[])[0]!.text) as { error: { code: string; recovery_id: string } };
  assert.equal(error.error.code, "OUTCOME_UNKNOWN");
  assert.match(error.error.recovery_id, /^seedream_editor_recovery_/u);
  const beforeReconcile = fixture.counts();
  const recoveries = await owner.client.callTool({ name: "syntx_owner_list_seedream_editor_image_recoveries", arguments: { link_attempt_id: ATTEMPT } });
  assert.equal(recoveries.isError, undefined);
  const recoveryItems = (recoveries.structuredContent as { recoveries: { recovery_id: string }[] }).recoveries;
  assert.ok(recoveryItems.some((item) => item.recovery_id === error.error.recovery_id));
  const reconciled = await owner.client.callTool({ name: "syntx_owner_reconcile_seedream_editor_image", arguments: {
    link_attempt_id: ATTEMPT, recovery_id: error.error.recovery_id
  } });
  assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled));
  const observed = reconciled.structuredContent as Record<string, unknown>;
  assert.equal(observed.status, "partial_results"); assert.equal(observed.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
  assert.equal(observed.backend_acceptance, "UNPROVEN");
  assert.equal(fixture.counts().generationPosts, 1);
  assert.ok(fixture.counts().historyReads > beforeReconcile.historyReads);

  const forged = await owner.client.callTool({ name: "syntx_owner_generate_seedream_editor_image", arguments: {
    link_attempt_id: ATTEMPT, variant: "seedream-5", prompt: "must reject caller capabilities",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: originalHandle, drawing_handle: null,
    file_url: "https://r2.syntx.ai/forged.png", permit: "caller-controlled"
  } });
  assert.equal(forged.isError, true);
  assert.equal(fixture.counts().generationPosts, 1);
  fixture.isLinked.set("link_seedream_editor_foreign_0123456789", false);
  const foreign = await owner.client.callTool({ name: "syntx_owner_generate_seedream_editor_image", arguments: {
    link_attempt_id: "link_seedream_editor_foreign_0123456789", variant: "seedream-5", prompt: "not linked",
    parameters: { aspect_ratio: "1:1", resolution: "2K" }, original_handle: originalHandle, drawing_handle: null
  } });
  assert.equal(foreign.isError, true);
  const foreignError = JSON.parse((foreign.content as { text: string }[])[0]!.text) as { error: { code: string; message: string } };
  assert.equal(foreignError.error.code, "PRINCIPAL_NOT_LINKED");
  assert.equal(foreignError.error.message.includes("credential"), false);
  assert.equal(fixture.counts().generationPosts, 1);
});
