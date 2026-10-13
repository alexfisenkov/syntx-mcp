import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { join } from "node:path";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import {
  OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
  OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION
} from "../src/application/owner-banana-inpaint-original-upload-source-profile.js";
import { OwnerBananaInpaintOriginalReferenceService } from "../src/application/owner-banana-inpaint-original-reference-service.js";
import { OwnerBananaInpaintPaintedCompositeReferenceService } from "../src/application/owner-banana-inpaint-painted-composite-reference-service.js";
import { OwnerBananaInpaintAuxiliaryReferenceService } from "../src/application/owner-banana-inpaint-auxiliary-reference-service.js";
import { createOwnerBananaInpaintImageGenerationService } from "../src/application/owner-banana-inpaint-image-generation-service.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import type { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";

const MODULE_URL = new URL("../src/mcp/owner-banana-inpaint-image-tools.js", import.meta.url).href;
const moduleValue = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;

const ATTEMPT = "link_banana_tools_0123456789abcdef";
const ORIGINAL = `banana_inpaint_original_${"11111111-1111-4111-8111-111111111111"}`;
const PAINTED = `banana_inpaint_painted_${"22222222-2222-4222-8222-222222222222"}`;
const AUXILIARY = `banana_inpaint_auxiliary_${"33333333-3333-4333-8333-333333333333"}`;
const RECOVERY = `banana_inpaint_recovery_${"44444444-4444-4444-8444-444444444444"}`;
const FIXED_NOW = Date.parse("2026-10-12T12:00:00.000Z");
const OWNER_BINDING = Object.freeze({ tenant_id: "banana-tools-tenant", subject: "banana-tools-subject" });
const INPAINT_CATALOG = loadSelectedDiscoveryCatalog(OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
  join(process.cwd(), "catalog")).discoveryCatalog;
const INPAINT_SETTINGS = loadMaplessSettingsInventoryVersion(OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
  join(process.cwd(), "catalog"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function createActualOwnerComposition(options: { readonly botMessages?: number; readonly objectsPerMessage?: number } = {}) {
  const botMessages = options.botMessages ?? 1;
  const objectsPerMessage = options.objectsPerMessage ?? 2;
  let currentNow = FIXED_NOW;
  const counts = { uploads: 0, chats: 0, posts: 0, accountReads: 0, modelReads: 0, historyReads: 0, resultReads: 0 };
  const transactions = new Map<string, { ack: string; results: readonly string[]; chat_id: number }>();
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-inpaint-mcp-credential");
  } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats/upload-files" && init?.method === "POST") {
      counts.uploads += 1;
      const form = init.body as FormData;
      const file = form.get("files");
      assert.ok(file instanceof File);
      return Response.json({ files: [{ id: `mcp-file-${counts.uploads}`, file_id: `mcp-file-${counts.uploads}`,
        url: `https://r2.syntx.ai/inpaint/input-${counts.uploads}.png`, mime_type: file.type, size: file.size, status: "accepted" }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") {
      counts.chats += 1;
      return Response.json({ uuid: `inpaint-mcp-chat-${counts.chats}` });
    }
    if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") {
      counts.posts += 1;
      const request = JSON.parse(String(init.body)) as { chat_uuid: string };
      transactions.set(request.chat_uuid, { ack: `inpaint-mcp-ack-${counts.posts}`,
        results: Object.freeze(Array.from({ length: botMessages }, (_, index) => botMessages === 1
          ? `inpaint-mcp-result-${counts.posts}` : `inpaint-mcp-result-${counts.posts}-${index + 1}`)), chat_id: 6100 + counts.posts });
      return Response.json({ id: `inpaint-mcp-ack-${counts.posts}` });
    }
    if (/^\/api\/v1\/chats\/inpaint-mcp-chat-\d+\/inprogress$/u.test(url.pathname)) return Response.json([]);
    const history = url.pathname.match(/^\/api\/v1\/chats\/(inpaint-mcp-chat-\d+)\/messages$/u);
    if (history && init?.method === "GET") {
      counts.historyReads += 1;
      const transaction = transactions.get(history[1]!);
      assert.ok(transaction);
      const resultRows = transaction.results.map((messageId) => ({ id: messageId, chat_id: transaction.chat_id, author_id: -1,
        message_object: Array.from({ length: objectsPerMessage }, (_, index) => ({ id: `${messageId}-object-${index}`,
          message_id: messageId, object_type: index % 2 === 0 ? "image" : "image_url", model_type: null })) }));
      const messages = [{ id: transaction.ack, chat_id: transaction.chat_id, author_id: 27, message_object: [] }, ...resultRows];
      return Response.json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultRoute = url.pathname.match(/^\/api\/v1\/chats\/(inpaint-mcp-chat-\d+)\/(inpaint-mcp-result-\d+(?:-\d+)?)$/u);
    if (resultRoute && init?.method === "GET") {
      counts.resultReads += 1;
      const transaction = transactions.get(resultRoute[1]!);
      assert.ok(transaction);
      assert.ok(transaction.results.includes(resultRoute[2]!));
      const messageIndex = transaction.results.indexOf(resultRoute[2]!);
      return Response.json({ id: resultRoute[2], chat_id: transaction.chat_id, author_id: -1,
        message_object: Array.from({ length: objectsPerMessage }, (_, index) => ({ id: `${resultRoute[2]}-object-${index}`,
          object_type: index % 2 === 0 ? "image" : "image_url",
          object_url: botMessages === 1 && objectsPerMessage === 2
            ? `https://r2.syntx.ai/inpaint/results/${counts.posts}-${index === 0 ? "a.png" : "b.webp"}`
            : `https://r2.syntx.ai/inpaint/results/${counts.posts}-${messageIndex + 1}-${index + 1}.png`, completed: true })) });
    }
    if (url.pathname === "/api/v1/user/balance") { counts.accountReads += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription") {
      counts.accountReads += 1;
      return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      counts.modelReads += 1;
      return Response.json({ access: true, cost: 3, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    }
    throw new Error(`Unexpected synthetic route ${url.pathname}`);
  };
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true };
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 2_000 });
  const httpClient = new SyntxHttpClient({ credentialBroker, fetchImpl, requestTimeoutMs: 2_000 });
  const originalReferenceService = new OwnerBananaInpaintOriginalReferenceService({ binding: OWNER_BINDING, linkService,
    catalog: INPAINT_CATALOG, public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
    settings_inventory: INPAINT_SETTINGS, settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
    resolveClient: () => chatClient, now: () => currentNow });
  const paintedCompositeReferenceService = new OwnerBananaInpaintPaintedCompositeReferenceService({ originalReferenceService,
    binding: OWNER_BINDING, linkService, catalog: INPAINT_CATALOG, public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
    settings_inventory: INPAINT_SETTINGS, settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
    resolveClient: () => chatClient, now: () => currentNow });
  const auxiliaryReferenceService = new OwnerBananaInpaintAuxiliaryReferenceService({ binding: OWNER_BINDING, linkService,
    catalog: INPAINT_CATALOG, public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
    settings_inventory: INPAINT_SETTINGS, settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
    resolveClient: () => chatClient, now: () => currentNow });
  const generationService = createOwnerBananaInpaintImageGenerationService({ binding: OWNER_BINDING, linkService,
    originalReferenceService, paintedCompositeReferenceService, auxiliaryReferenceService,
    resolveChatClient: () => chatClient,
    createAccountStatusService: () => new AccountStatusService(httpClient, () => currentNow),
    createModelAccessService: (_attemptId: string, catalog: DiscoveryCatalogRepository) => new ModelAccessService(catalog, httpClient, () => currentNow),
    now: () => currentNow, pollDelayMs: 0, maxPollAttempts: 1 });
  return { composition: { originalReferenceService, paintedCompositeReferenceService, auxiliaryReferenceService, generationService },
    counts, advanceClock(milliseconds: number) { currentNow += milliseconds; }, async close() { await generationService.close(); } };
}

test("exports the seven fixed owner Banana Inpaint tools and closed input/output schemas", () => {
  assert.ok(moduleValue, "MISSING_OWNER_BANANA_INPAINT_MCP_MODULE");
  assert.deepEqual(moduleValue.OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES, [
    "syntx_upload_banana_inpaint_original",
    "syntx_upload_banana_inpaint_painted_composite",
    "syntx_upload_banana_inpaint_auxiliary_reference",
    "syntx_owner_generate_banana_inpaint_image",
    "syntx_owner_reconcile_banana_inpaint_image",
    "syntx_owner_list_banana_inpaint_image_recoveries",
    "syntx_owner_get_banana_inpaint_image_result_page"
  ]);
  assert.equal(typeof moduleValue.registerSyntxOwnerBananaInpaintImageTools, "function");
  assert.ok(moduleValue.OWNER_BANANA_INPAINT_IMAGE_TOOL_INPUT_SCHEMAS);
  assert.ok(moduleValue.OWNER_BANANA_INPAINT_IMAGE_TOOL_OUTPUT_SCHEMAS);
  const inputSchemas = moduleValue.OWNER_BANANA_INPAINT_IMAGE_TOOL_INPUT_SCHEMAS as { get_result_page?: unknown };
  const outputSchemas = moduleValue.OWNER_BANANA_INPAINT_IMAGE_TOOL_OUTPUT_SCHEMAS as { get_result_page?: unknown };
  assert.ok(inputSchemas.get_result_page, "MISSING_BANANA_INPAINT_RESULT_PAGE_INPUT_SCHEMA");
  assert.ok(outputSchemas.get_result_page, "MISSING_BANANA_INPAINT_RESULT_PAGE_OUTPUT_SCHEMA");
});

test("strict generation schema accepts exactly all four variants and nine explicit image-size states", () => {
  assert.ok(moduleValue, "MISSING_OWNER_BANANA_INPAINT_MCP_MODULE");
  const schemas = moduleValue.OWNER_BANANA_INPAINT_IMAGE_TOOL_INPUT_SCHEMAS as {
    generate: { safeParse(value: unknown): { success: boolean } }
  };
  const cases = [
    ["banana", null], ["banana2", "1K"], ["banana2", "2K"], ["banana2", "4K"],
    ["banana3", "0.5K"], ["banana3", "1K"], ["banana3", "2K"], ["banana3", "4K"],
    ["banana3_light", "1K"]
  ] as const;
  for (const [index, [variant, image_size]] of cases.entries()) {
    assert.equal(schemas.generate.safeParse({ link_attempt_id: ATTEMPT, variant, prompt: `explicit prompt ${index}`,
      image_size, original_handle: ORIGINAL, painted_handle: PAINTED, auxiliary_reference_handle: index % 2 ? AUXILIARY : null }).success,
    true, `valid explicit state ${variant}/${String(image_size)}`);
  }
  assert.equal(cases.length, 9);
});

test("strict generation schema rejects crossed settings, missing auxiliary null, caller authority, and over-limit prompts", () => {
  assert.ok(moduleValue, "MISSING_OWNER_BANANA_INPAINT_MCP_MODULE");
  const schemas = moduleValue.OWNER_BANANA_INPAINT_IMAGE_TOOL_INPUT_SCHEMAS as {
    generate: { safeParse(value: unknown): { success: boolean } }
  };
  const valid = { link_attempt_id: ATTEMPT, variant: "banana2", prompt: "preserve this explicit prompt", image_size: "2K",
    original_handle: ORIGINAL, painted_handle: PAINTED, auxiliary_reference_handle: null };
  assert.equal(schemas.generate.safeParse({ ...valid, image_size: null }).success, false);
  assert.equal(schemas.generate.safeParse({ ...valid, auxiliary_reference_handle: undefined }).success, false);
  for (const key of ["url", "principal", "chat_uuid", "permit", "profile_schema_hash", "source_hash", "scope", "editor", "n", "model_type"]) {
    assert.equal(schemas.generate.safeParse({ ...valid, [key]: "caller-controlled" }).success, false, `reject ${key}`);
  }
  assert.equal(schemas.generate.safeParse({ ...valid, prompt: " \n\t " }).success, false);
  assert.equal(schemas.generate.safeParse({ ...valid, prompt: "p".repeat(65_537) }).success, false);
});

test("result-page request is strict, owner-attempt scoped, and bounded to page offsets and sizes", () => {
  assert.ok(moduleValue, "MISSING_OWNER_BANANA_INPAINT_MCP_MODULE");
  const schemas = moduleValue.OWNER_BANANA_INPAINT_IMAGE_TOOL_INPUT_SCHEMAS as {
    get_result_page: { safeParse(value: unknown): { success: boolean } }
  };
  const valid = { link_attempt_id: ATTEMPT, result_id: `banana_inpaint_result_${"55555555-5555-4555-8555-555555555555"}`,
    offset: 64, limit: 64 };
  assert.equal(schemas.get_result_page.safeParse(valid).success, true);
  for (const invalid of [
    { ...valid, offset: -1 }, { ...valid, offset: 524_289 }, { ...valid, limit: 0 }, { ...valid, limit: 65 },
    { ...valid, url: "https://caller.invalid/result.png" }, { ...valid, principal: { subject: "caller" } },
    { ...valid, chat_uuid: "caller-chat" }, { ...valid, cursor: "caller-cursor" }
  ]) assert.equal(schemas.get_result_page.safeParse(invalid).success, false);
});

test("upload schemas preserve each role's local MIME matrix and reject the unsupported image wildcard gaps", () => {
  assert.ok(moduleValue, "MISSING_OWNER_BANANA_INPAINT_MCP_MODULE");
  const schemas = moduleValue.OWNER_BANANA_INPAINT_IMAGE_TOOL_INPUT_SCHEMAS as {
    upload_original: { safeParse(value: unknown): { success: boolean } };
    upload_painted_composite: { safeParse(value: unknown): { success: boolean } };
    upload_auxiliary_reference: { safeParse(value: unknown): { success: boolean } };
  };
  const original = { link_attempt_id: ATTEMPT, variant: "banana", content_base64: "AA==", filename: "image.png", mime_type: "image/png" };
  for (const mime_type of ["image/jpeg", "image/png"]) {
    assert.equal(schemas.upload_original.safeParse({ ...original, mime_type }).success, true);
  }
  const painted = { ...original, original_handle: ORIGINAL, mime_type: "image/png" };
  assert.equal(schemas.upload_painted_composite.safeParse(painted).success, true);
  assert.equal(schemas.upload_painted_composite.safeParse({ ...painted, mime_type: "image/jpeg" }).success, false);
  for (const mime_type of ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif",
    "image/bmp", "image/gif", "image/tiff"]) {
    assert.equal(schemas.upload_auxiliary_reference.safeParse({ ...original, mime_type }).success, true, `local parser format ${mime_type}`);
  }
  for (const mime_type of ["image/svg+xml", "image/x-icon", "image/*", "image/unknown"]) {
    assert.equal(schemas.upload_auxiliary_reference.safeParse({ ...original, mime_type }).success, false, `reject ${mime_type}`);
  }
});

test("result output preserves every observed artifact and refuses invented MIME or dimensions", () => {
  assert.ok(moduleValue, "MISSING_OWNER_BANANA_INPAINT_MCP_MODULE");
  const schemas = moduleValue.OWNER_BANANA_INPAINT_IMAGE_TOOL_OUTPUT_SCHEMAS as {
    generate: { safeParse(value: unknown): { success: boolean } };
    reconcile: { safeParse(value: unknown): { success: boolean } };
    get_result_page: { safeParse(value: unknown): { success: boolean } };
  };
  const artifact = (object_index: number, message_id: string, suffix: string) => ({
    url: `https://r2.syntx.ai/inpaint/results/${suffix}.png`, mime_type: null, width: null, height: null,
    geometry_verified: false, message_id, object_index
  });
  const base = { backend_acceptance: "UNPROVEN", provider_execution: false, attempt_id: ATTEMPT, variant: "banana3",
    ai_name: "banana", model_type: "banana3", result_id: `banana_inpaint_result_${"55555555-5555-4555-8555-555555555555"}`,
    observed_total: 2, next_offset: null, has_more: false,
    artifacts: [artifact(0, "result-message-a", "a"), artifact(1, "result-message-a", "b")] };
  assert.equal(schemas.generate.safeParse({ ...base, status: "result_observed" }).success, true);
  assert.equal(schemas.reconcile.safeParse({ ...base, status: "partial_results", recovery_id: RECOVERY }).success, true);
  assert.equal(schemas.generate.safeParse({ ...base, status: "result_observed", mime_type: "image/png" }).success, false);
  assert.equal(schemas.generate.safeParse({ ...base, status: "result_observed", artifacts: [artifact(0, "result-message-a", "a")] .map((item) => ({ ...item, width: 512 })) }).success, false);
  assert.equal(schemas.reconcile.safeParse({ ...base, status: "partial_results" }).success, false);
  assert.equal(schemas.get_result_page.safeParse({ result_id: base.result_id, offset: 64, limit: 64,
    observed_total: 80, next_offset: null, has_more: false,
    artifacts: Array.from({ length: 16 }, (_, index) => artifact(index, "result-message-b", `b-${index}`)) }).success, true);
});

test("the actual server keeps these tools absent by default and registers them only through owner composition", async () => {
  assert.ok(moduleValue, "MISSING_OWNER_BANANA_INPAINT_MCP_MODULE");
  const names = moduleValue.OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES as readonly string[];
  const application = createDefaultApplication({ discoveryCatalog: INPAINT_CATALOG, runtimeCapabilities: null });
  const defaults = createMcpServer(application, { maplessSettingsInventory: null, staticParameterProjection: null });
  const defaultClient = new Client({ name: "banana-inpaint-default-tools-test", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  try {
    await defaults.connect(defaultServerTransport);
    await defaultClient.connect(defaultClientTransport);
    const listed = (await defaultClient.listTools()).tools.map(({ name }) => name);
    assert.equal(listed.some((name) => names.includes(name)), false);
  } finally { await Promise.all([defaultClient.close(), defaults.close()]); }

  let generateCalls = 0;
  const ownerComposition = {
    originalReferenceService: { async upload() { throw new Error("unused"); } },
    paintedCompositeReferenceService: { async uploadPaintedComposite() { throw new Error("unused"); } },
    auxiliaryReferenceService: { async upload() { throw new Error("unused"); } },
    generationService: { async generate() { generateCalls += 1; throw new Error("unused"); }, async reconcile() { throw new Error("unused"); },
      async listRecoveries() { return []; }, async getResultPage() { throw new Error("unused"); },
      async invalidateAttempt() {}, async close() {} }
  };
  assert.throws(() => createMcpServer(application, { ownerDurableGeneration: {} as never,
    ownerBananaInpaintImageReferences: ownerComposition,
    maplessSettingsInventory: null, staticParameterProjection: null }), /OWNER_DURABLE_GENERATION_COMPOSITION_CONFLICT/u);
  const ownerServer = createMcpServer(application, {
    maplessSettingsInventory: null, staticParameterProjection: null,
    ownerBananaInpaintImageReferences: ownerComposition
  });
  const ownerClient = new Client({ name: "banana-inpaint-owner-tools-test", version: "1.0.0" });
  const [ownerClientTransport, ownerServerTransport] = InMemoryTransport.createLinkedPair();
  try {
    await ownerServer.connect(ownerServerTransport);
    await ownerClient.connect(ownerClientTransport);
    const listedTools = (await ownerClient.listTools()).tools;
    const listed = listedTools.filter(({ name }) => names.includes(name)).map(({ name }) => name);
    assert.deepEqual(listed, names);
    for (const tool of listedTools.filter(({ name }) => names.includes(name))) {
      assert.equal(tool.inputSchema.type, "object");
      assert.ok(tool.inputSchema.properties);
    }
    const generate = listedTools.find(({ name }) => name === "syntx_owner_generate_banana_inpaint_image");
    assert.ok(generate, "MISSING_INSTALLED_GENERATE_TOOL");
    const generateSchema = generate.inputSchema as {
      type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean;
      oneOf?: Array<{ type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }>;
      anyOf?: Array<{ type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }>;
    };
    const expectedProperties = ["link_attempt_id", "variant", "prompt", "image_size", "original_handle", "painted_handle",
      "auxiliary_reference_handle"];
    assert.deepEqual(Object.keys(generateSchema.properties ?? {}).sort(), expectedProperties.slice().sort());
    assert.deepEqual(generateSchema.required?.slice().sort(), expectedProperties.slice().sort());
    assert.equal(generateSchema.additionalProperties, false);
    assert.deepEqual((generateSchema.properties?.variant as { enum?: string[] } | undefined)?.enum,
      ["banana", "banana2", "banana3", "banana3_light"]);
    assert.deepEqual(generateSchema.properties?.prompt, { type: "string", minLength: 1, maxLength: 65_536 });
    assert.equal(JSON.stringify(generateSchema).includes('"$ref"'), false, "UNEXPECTED_UNCLOSED_SCHEMA_REFERENCE");
    const branches = generateSchema.oneOf ?? generateSchema.anyOf;
    assert.equal(branches?.length, 4, "EXPECTED_FOUR_VARIANT_SIZE_BRANCHES");
    const expectedBranches = [
      ["banana", { type: "null" }],
      ["banana2", { type: "string", enum: ["1K", "2K", "4K"] }],
      ["banana3", { type: "string", enum: ["0.5K", "1K", "2K", "4K"] }],
      ["banana3_light", { type: "string", const: "1K" }]
    ] as const;
    assert.deepEqual(branches?.map((branch) => ({
      keys: Object.keys(branch.properties ?? {}).sort(), required: branch.required?.slice().sort(),
      closed: branch.additionalProperties === false,
      variant: (branch.properties?.variant as { const?: string } | undefined)?.const,
      imageSize: branch.properties?.image_size
    })), expectedBranches.map(([variant, imageSize]) => ({
      keys: expectedProperties.slice().sort(), required: expectedProperties.slice().sort(), closed: true, variant, imageSize
    })));

    const validGenerateArgs = { link_attempt_id: ATTEMPT, variant: "banana", prompt: "explicit prompt", image_size: null,
      original_handle: ORIGINAL, painted_handle: PAINTED, auxiliary_reference_handle: null };
    for (const invalid of [
      { ...validGenerateArgs, variant: "banana2", image_size: null },
      { ...validGenerateArgs, url: "https://caller.invalid/arbitrary.png" },
      { ...validGenerateArgs, prompt: " \n\t " }
    ]) {
      const rejected = await ownerClient.callTool({ name: "syntx_owner_generate_banana_inpaint_image", arguments: invalid });
      assert.equal(rejected.isError, true);
    }
    assert.equal(generateCalls, 0);
  } finally { await Promise.all([ownerClient.close(), ownerServer.close()]); }
});

test("all nine real Inpaint intents reach the MCP client with every checked observed result artifact", async (t) => {
  const fixture = createActualOwnerComposition();
  t.after(() => fixture.close());
  const application = createDefaultApplication({ discoveryCatalog: INPAINT_CATALOG, runtimeCapabilities: null });
  const server = createMcpServer(application, { ownerBananaInpaintImageReferences: fixture.composition,
    maplessSettingsInventory: null, staticParameterProjection: null });
  const client = new Client({ name: "banana-inpaint-real-services-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const selections = [
    ["banana", null], ["banana2", "1K"], ["banana2", "2K"], ["banana2", "4K"],
    ["banana3", "0.5K"], ["banana3", "1K"], ["banana3", "2K"], ["banana3", "4K"], ["banana3_light", "1K"]
  ] as const;
  let firstAttempt: string | undefined;
  let firstOriginalHandle: string | undefined;
  let firstPaintedHandle: string | undefined;
  try {
    for (const [index, [variant, image_size]] of selections.entries()) {
      const attempt = `link_banana_mcp_intent_${String(index + 1).padStart(2, "0")}_0123456789`;
      const originalResponse = await client.callTool({ name: "syntx_upload_banana_inpaint_original", arguments: {
        link_attempt_id: attempt, variant, content_base64: PNG.toString("base64"), filename: `original-${index}.png`, mime_type: "image/png"
      } });
      assert.equal(originalResponse.isError, undefined, JSON.stringify(originalResponse));
      const original = originalResponse.structuredContent as { reference_handle: string };
      assert.match(original.reference_handle, /^banana_inpaint_original_[0-9a-f-]{36}$/u);
      assert.equal(JSON.stringify(originalResponse.structuredContent).includes("https://"), false);
      const paintedResponse = await client.callTool({ name: "syntx_upload_banana_inpaint_painted_composite", arguments: {
        link_attempt_id: attempt, variant, original_handle: original.reference_handle, content_base64: PNG.toString("base64"),
        filename: `painted-${index}.png`, mime_type: "image/png"
      } });
      assert.equal(paintedResponse.isError, undefined, JSON.stringify(paintedResponse));
      const painted = paintedResponse.structuredContent as { painted_handle: string; original_handle: string };
      assert.match(painted.painted_handle, /^banana_inpaint_painted_[0-9a-f-]{36}$/u);
      assert.equal(painted.original_handle, original.reference_handle);
      let auxiliaryHandle: string | null = null;
      if (index === 4) {
        const auxiliaryResponse = await client.callTool({ name: "syntx_upload_banana_inpaint_auxiliary_reference", arguments: {
          link_attempt_id: attempt, variant, content_base64: PNG.toString("base64"), filename: "auxiliary.png", mime_type: "image/png"
        } });
        assert.equal(auxiliaryResponse.isError, undefined, JSON.stringify(auxiliaryResponse));
        auxiliaryHandle = (auxiliaryResponse.structuredContent as { reference_handle: string }).reference_handle;
        assert.match(auxiliaryHandle, /^banana_inpaint_auxiliary_[0-9a-f-]{36}$/u);
      }
      const prompt = `synthetic owner result ${variant}/${image_size ?? "null"}`;
      const generated = await client.callTool({ name: "syntx_owner_generate_banana_inpaint_image", arguments: {
        link_attempt_id: attempt, variant, prompt, image_size, original_handle: original.reference_handle,
        painted_handle: painted.painted_handle, auxiliary_reference_handle: auxiliaryHandle
      } });
      assert.equal(generated.isError, undefined, `${variant}/${String(image_size)}: ${JSON.stringify(generated)}`);
      const result = generated.structuredContent as { status: string; backend_acceptance: string; provider_execution: boolean;
        variant: string; model_type: string; artifacts: Array<Record<string, unknown>> };
      assert.equal(result.status, "result_observed");
      assert.equal(result.backend_acceptance, "UNPROVEN");
      assert.equal(result.provider_execution, false);
    assert.equal(result.variant, variant);
    assert.equal(result.model_type, variant);
    assert.match((result as unknown as { result_id: string }).result_id,
      /^banana_inpaint_result_[0-9a-f-]{36}$/u);
    assert.equal((result as unknown as { observed_total: number }).observed_total, 2);
    assert.equal((result as unknown as { next_offset: number | null }).next_offset, null);
    assert.equal((result as unknown as { has_more: boolean }).has_more, false);
      assert.deepEqual(result.artifacts, [
        { url: `https://r2.syntx.ai/inpaint/results/${index + 1}-a.png`, mime_type: null, width: null, height: null,
          geometry_verified: false, message_id: `inpaint-mcp-result-${index + 1}`, object_index: 0 },
        { url: `https://r2.syntx.ai/inpaint/results/${index + 1}-b.webp`, mime_type: null, width: null, height: null,
          geometry_verified: false, message_id: `inpaint-mcp-result-${index + 1}`, object_index: 1 }
      ]);
      const responseText = JSON.stringify(generated.structuredContent);
      assert.equal(responseText.includes(prompt), false);
      assert.equal(responseText.includes(original.reference_handle), false);
      assert.equal(responseText.includes(painted.painted_handle), false);
      assert.equal(Object.hasOwn(result, "cost_inputs"), false);
      if (index === 0) {
        firstAttempt = attempt;
        firstOriginalHandle = original.reference_handle;
        firstPaintedHandle = painted.painted_handle;
      }
    }
    assert.deepEqual(fixture.counts, { uploads: 19, chats: 9, posts: 9, accountReads: 36, modelReads: 18, historyReads: 9, resultReads: 9 });

    const foreignAttempt = "link_banana_mcp_foreign_0123456789abcdef";
    const foreign = await client.callTool({ name: "syntx_owner_generate_banana_inpaint_image", arguments: {
      link_attempt_id: foreignAttempt, variant: "banana", prompt: "foreign owner must fail", image_size: null,
      original_handle: firstOriginalHandle, painted_handle: firstPaintedHandle, auxiliary_reference_handle: null
    } });
    assert.equal(foreign.isError, true);
    assert.equal(fixture.counts.posts, 9, "foreign attempt cannot dispatch a POST using another attempt's handles");
    assert.equal(fixture.counts.chats, 9);
    assert.ok(firstAttempt);
  } finally { await Promise.all([client.close(), server.close()]); }
});

test("80 ready observations cross the MCP boundary in two cached 64/16 pages without another POST", async (t) => {
  const fixture = createActualOwnerComposition({ botMessages: 2, objectsPerMessage: 40 });
  t.after(() => fixture.close());
  const application = createDefaultApplication({ discoveryCatalog: INPAINT_CATALOG, runtimeCapabilities: null });
  const server = createMcpServer(application, { ownerBananaInpaintImageReferences: fixture.composition,
    maplessSettingsInventory: null, staticParameterProjection: null });
  const client = new Client({ name: "banana-inpaint-80-artifact-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const attempt = "link_banana_mcp_eighty_results_0123456789";
  try {
    const original = await client.callTool({ name: "syntx_upload_banana_inpaint_original", arguments: {
      link_attempt_id: attempt, variant: "banana3", content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png"
    } });
    assert.equal(original.isError, undefined, JSON.stringify(original));
    const originalHandle = (original.structuredContent as { reference_handle: string }).reference_handle;
    const painted = await client.callTool({ name: "syntx_upload_banana_inpaint_painted_composite", arguments: {
      link_attempt_id: attempt, variant: "banana3", original_handle: originalHandle, content_base64: PNG.toString("base64"),
      filename: "painted.png", mime_type: "image/png"
    } });
    assert.equal(painted.isError, undefined, JSON.stringify(painted));
    const paintedHandle = (painted.structuredContent as { painted_handle: string }).painted_handle;
    const generated = await client.callTool({ name: "syntx_owner_generate_banana_inpaint_image", arguments: {
      link_attempt_id: attempt, variant: "banana3", prompt: "observe all result objects from both source-bound messages", image_size: "2K",
      original_handle: originalHandle, painted_handle: paintedHandle, auxiliary_reference_handle: null
    } });
    assert.equal(generated.isError, undefined, JSON.stringify(generated));
    const firstPage = generated.structuredContent as { result_id: string; observed_total: number; next_offset: number | null;
      has_more: boolean; artifacts: Array<{ url: string; message_id: string; object_index: number }> };
    assert.match(firstPage.result_id, /^banana_inpaint_result_[0-9a-f-]{36}$/u);
    assert.equal(firstPage.observed_total, 80);
    assert.equal(firstPage.next_offset, 64);
    assert.equal(firstPage.has_more, true);
    assert.equal(firstPage.artifacts.length, 64);
    assert.equal(firstPage.artifacts[0]?.url, "https://r2.syntx.ai/inpaint/results/1-1-1.png");
    assert.equal(firstPage.artifacts[63]?.url, "https://r2.syntx.ai/inpaint/results/1-2-24.png");
    const readsBeforePage = fixture.counts.resultReads;
    const postsBeforePage = fixture.counts.posts;
    const page = await client.callTool({ name: "syntx_owner_get_banana_inpaint_image_result_page", arguments: {
      link_attempt_id: attempt, result_id: firstPage.result_id, offset: 64, limit: 64
    } });
    assert.equal(page.isError, undefined, JSON.stringify(page));
    const secondPage = page.structuredContent as { result_id: string; offset: number; limit: number; observed_total: number;
      next_offset: number | null; has_more: boolean; artifacts: Array<{ url: string; message_id: string; object_index: number }> };
    assert.equal(secondPage.result_id, firstPage.result_id);
    assert.equal(secondPage.offset, 64);
    assert.equal(secondPage.limit, 64);
    assert.equal(secondPage.observed_total, 80);
    assert.equal(secondPage.next_offset, null);
    assert.equal(secondPage.has_more, false);
    assert.equal(secondPage.artifacts.length, 16);
    assert.equal(secondPage.artifacts[0]?.url, "https://r2.syntx.ai/inpaint/results/1-2-25.png");
    assert.equal(secondPage.artifacts[15]?.url, "https://r2.syntx.ai/inpaint/results/1-2-40.png");
    assert.equal(fixture.counts.resultReads, readsBeforePage, "cached page reads issue no provider GET");
    assert.equal(fixture.counts.posts, postsBeforePage, "result paging never issues a second generation POST");

    const foreign = await client.callTool({ name: "syntx_owner_get_banana_inpaint_image_result_page", arguments: {
      link_attempt_id: "link_banana_mcp_foreign_page_0123456789", result_id: firstPage.result_id, offset: 64, limit: 64
    } });
    assert.equal(foreign.isError, true);
    assert.match(JSON.stringify(foreign), /RESULT_NOT_FOUND/u);
    assert.equal(fixture.counts.posts, 1);
    assert.equal(fixture.counts.resultReads, readsBeforePage);

    const revokedAttempt = "link_banana_mcp_revoked_page_0123456789";
    const revokedOriginal = await client.callTool({ name: "syntx_upload_banana_inpaint_original", arguments: {
      link_attempt_id: revokedAttempt, variant: "banana3", content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png"
    } });
    assert.equal(revokedOriginal.isError, undefined, JSON.stringify(revokedOriginal));
    const revokedOriginalHandle = (revokedOriginal.structuredContent as { reference_handle: string }).reference_handle;
    const revokedPainted = await client.callTool({ name: "syntx_upload_banana_inpaint_painted_composite", arguments: {
      link_attempt_id: revokedAttempt, variant: "banana3", original_handle: revokedOriginalHandle,
      content_base64: PNG.toString("base64"), filename: "painted.png", mime_type: "image/png"
    } });
    assert.equal(revokedPainted.isError, undefined, JSON.stringify(revokedPainted));
    const revokedPaintedHandle = (revokedPainted.structuredContent as { painted_handle: string }).painted_handle;
    const revokedResult = await client.callTool({ name: "syntx_owner_generate_banana_inpaint_image", arguments: {
      link_attempt_id: revokedAttempt, variant: "banana3", prompt: "result page must stop after owner-attempt invalidation", image_size: "2K",
      original_handle: revokedOriginalHandle, painted_handle: revokedPaintedHandle, auxiliary_reference_handle: null
    } });
    assert.equal(revokedResult.isError, undefined, JSON.stringify(revokedResult));
    const revokedResultId = (revokedResult.structuredContent as { result_id: string }).result_id;
    const readsBeforeDenials = fixture.counts.resultReads;
    await fixture.composition.generationService.invalidateAttempt(revokedAttempt);
    const revoked = await client.callTool({ name: "syntx_owner_get_banana_inpaint_image_result_page", arguments: {
      link_attempt_id: revokedAttempt, result_id: revokedResultId, offset: 0, limit: 64
    } });
    assert.equal(revoked.isError, true);
    assert.match(JSON.stringify(revoked), /RESULT_NOT_FOUND/u);

    fixture.advanceClock(901_000);
    const expired = await client.callTool({ name: "syntx_owner_get_banana_inpaint_image_result_page", arguments: {
      link_attempt_id: attempt, result_id: firstPage.result_id, offset: 0, limit: 64
    } });
    assert.equal(expired.isError, true);
    assert.match(JSON.stringify(expired), /RESULT_NOT_FOUND/u);
    assert.equal(fixture.counts.posts, 2, "revoked and expired result-page reads never dispatch generation POSTs");
    assert.equal(fixture.counts.resultReads, readsBeforeDenials, "revoked and expired cached page reads issue no provider GET");
  } finally { await Promise.all([client.close(), server.close()]); }
});
