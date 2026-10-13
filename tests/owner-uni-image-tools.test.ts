import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerUniImageGenerationService, type OwnerUniImageGenerationPreflightInput } from "../src/application/owner-uni-image-generation-service.js";
import { OwnerUniImageRequestPreparer } from "../src/application/owner-uni-image-request-preparer.js";
import { OwnerUniImageUploadService } from "../src/application/owner-uni-image-upload-service.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_UNI_IMAGE_TOOL_INPUT_SCHEMAS, registerSyntxOwnerUniImageTools } from "../src/mcp/owner-uni-image-tools.js";

const TOOL_NAMES = [
  "syntx_upload_uni_image_reference",
  "syntx_owner_generate_uni_image",
  "syntx_owner_reconcile_uni_image",
  "syntx_owner_list_uni_image_recoveries"
];

async function inspect(options?: unknown) {
  const server = createMcpServer(createDefaultApplication(), options as never);
  const client = new Client({ name: "uni-image-tools-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return { tools: (await client.listTools()).tools, client, server }; }
  catch (error) { await client.close(); await server.close(); throw error; }
}

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"
))));
const OWNER_BINDING = Object.freeze({ tenant_id: "uni-tools-tenant", subject: "uni-tools-subject" });
const FIXED_NOW = Date.parse("2026-10-11T00:00:00.000Z");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
  0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

function createActualGenerationComposition() {
  const calls = { account_reads: 0, model_reads: 0, uploads: 0, chats: 0, posts: 0, histories: 0, results: 0 };
  const transactions = new Map<string, { variant: string; ack: string; result: string; chat_id: number; file_urls: string[] }>();
  let nextId = 0;
  let failHistoryOnce = false;
  let partialNextResult = false;
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-credential");
  } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/user/balance") { calls.account_reads += 1; return Response.json({ balance: "0.000" }); }
    if (url.pathname === "/api/v1/user/subscription") {
      calls.account_reads += 1; return Response.json({ active: true, type: "pro", end_date: null });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      calls.model_reads += 1; return Response.json({ access: true, cost: 1, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && init?.method === "POST") {
      calls.uploads += 1;
      const form = init.body as FormData;
      const file = form.get("files");
      assert.ok(file instanceof File);
      const modelType = String(form.get("model_type"));
      return Response.json({ files: [{ id: `uni-tool-file-${calls.uploads}`, url: `https://r2.syntx.ai/uni/input-${calls.uploads}.jpg`,
        mime_type: file.type, size: file.size, model_type: modelType }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") {
      nextId += 1; calls.chats += 1;
      return Response.json({ uuid: `uni-tool-chat-${nextId}` });
    }
    if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") {
      calls.posts += 1;
      const body = JSON.parse(String(init.body)) as { chat_uuid: string; prompt: string; settings: { model_type: string; file_urls?: string[] } };
      const tx = { variant: body.settings.model_type,
        ack: `uni-tool-ack-${calls.posts}`, result: `uni-tool-result-${calls.posts}`, chat_id: 9000 + calls.posts,
        file_urls: body.settings.file_urls ?? [] };
      transactions.set(body.chat_uuid, tx);
      return Response.json({ id: tx.ack });
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/(uni-tool-chat-\d+)\/messages$/u);
    if (history && init?.method === "GET") {
      calls.histories += 1;
      if (failHistoryOnce) { failHistoryOnce = false; throw new Error("synthetic first-history failure"); }
      const tx = transactions.get(history[1]!); assert.ok(tx);
      const ownerObjects = tx.file_urls.map((_, index) => ({ id: `uni-tool-input-${calls.posts}-${index + 1}`,
        message_id: tx.ack, object_type: "image", model_type: tx.variant }));
      const resultObjects = [1, 2].map((index) => ({ id: `uni-tool-output-${calls.posts}-${index}`,
        message_id: tx.result, object_type: "image", model_type: tx.variant }));
      return Response.json({ messages: [
        { id: tx.ack, chat_id: tx.chat_id, author_id: 42, message_object: ownerObjects },
        { id: tx.result, chat_id: tx.chat_id, author_id: -1, message_object: resultObjects }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultRoute = url.pathname.match(/^\/api\/v1\/chats\/(uni-tool-chat-\d+)\/(uni-tool-result-\d+)$/u);
    if (resultRoute && init?.method === "GET") {
      calls.results += 1;
      const tx = transactions.get(resultRoute[1]!); assert.ok(tx); assert.equal(resultRoute[2], tx.result);
      const resultIndexes = partialNextResult ? [1] : [1, 2];
      partialNextResult = false;
      return Response.json({ id: tx.result, chat_id: tx.chat_id, author_id: -1,
        message_object: resultIndexes.map((index) => ({ id: `uni-tool-output-${calls.posts}-${index}`, message_id: tx.result,
          object_type: "image", model_type: tx.variant, completed: true,
          object_url: `https://r2.syntx.ai/uni/output-${calls.posts}-${index}.${index === 1 ? "png" : "unknown"}` })) });
    }
    throw new Error(`Unexpected synthetic route ${url.pathname}`);
  };
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl });
  const readClient = new SyntxHttpClient({ credentialBroker, fetchImpl });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerUniImageUploadService({ binding: OWNER_BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => chatClient, now: () => FIXED_NOW });
  const preparer = new OwnerUniImageRequestPreparer({ binding: OWNER_BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => FIXED_NOW });
  const account = new AccountStatusService(readClient, () => FIXED_NOW);
  const modelAccess = new ModelAccessService(CATALOG, readClient, () => FIXED_NOW);
  const generationService = new OwnerUniImageGenerationService({ binding: OWNER_BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, preparer, resolveChatClient: () => chatClient,
    preflight: async (input: Readonly<OwnerUniImageGenerationPreflightInput>) => ({
      account: await account.getAccountStatus(input.signal),
      model_access: await modelAccess.getModelAccess({ model_id: input.model_id, cost_parameters: input.cost_inputs }, input.signal)
    }), now: () => FIXED_NOW, pollDelayMs: 0, maxPollAttempts: 2, wait: async () => undefined });
  return { composition: { uploadService, generationService }, calls,
    failHistoryOnce() { failHistoryOnce = true; },
    partialNextResult() { partialNextResult = true; },
    async close() { await generationService.close(); } };
}

test("the four Uni image tools are absent by default and appear only under explicit owner composition", async () => {
  const defaults = await inspect();
  try { assert.equal(defaults.tools.some(({ name }) => TOOL_NAMES.includes(name)), false); }
  finally { await defaults.client.close(); await defaults.server.close(); }

  const composition = {
    uploadService: { async upload() { throw new Error("unused"); } },
    generationService: { async generate() { throw new Error("unused"); }, async reconcile() { throw new Error("unused"); },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {} }
  };
  const owner = await inspect({ ownerUniImageReferences: composition });
  try {
    assert.deepEqual(owner.tools.map(({ name }) => name).filter((name) => TOOL_NAMES.includes(name)).sort(), [...TOOL_NAMES].sort());
    for (const tool of owner.tools.filter(({ name }) => TOOL_NAMES.includes(name))) {
      const inputSchema = tool.inputSchema as Record<string, unknown>;
      const outputSchema = tool.outputSchema as Record<string, unknown>;
      assert.equal(inputSchema.type, "object");
      assert.equal(inputSchema.additionalProperties, false);
      assert.equal(outputSchema.type, "object");
      assert.equal(outputSchema.additionalProperties, false);
      assert.equal(Object.hasOwn(inputSchema, "anyOf"), false);
    }
    const uploadBase64 = (owner.tools.find(({ name }) => name === "syntx_upload_uni_image_reference")!.inputSchema as
      { properties: Record<string, Record<string, unknown>> }).properties.content_base64!;
    assert.equal(uploadBase64.maxLength, Math.ceil((25 * 1024 * 1024) / 3) * 4);
    const annotations = Object.fromEntries(owner.tools.filter(({ name }) => TOOL_NAMES.includes(name))
      .map(({ name, annotations: value }) => [name, value])) as
      Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }>;
    assert.deepEqual([annotations.syntx_upload_uni_image_reference?.readOnlyHint,
      annotations.syntx_upload_uni_image_reference?.destructiveHint,
      annotations.syntx_upload_uni_image_reference?.idempotentHint], [false, true, false]);
    assert.deepEqual([annotations.syntx_owner_generate_uni_image?.readOnlyHint,
      annotations.syntx_owner_generate_uni_image?.destructiveHint], [false, true]);
    for (const name of ["syntx_owner_reconcile_uni_image", "syntx_owner_list_uni_image_recoveries"]) {
      assert.deepEqual([annotations[name]?.readOnlyHint, annotations[name]?.destructiveHint, annotations[name]?.idempotentHint], [true, false, true]);
    }
  } finally { await owner.client.close(); await owner.server.close(); }
});

test("strict upload schema accepts near-25-MiB canonical base64 linearly without uploading", () => {
  const maxBase64Chars = Math.ceil((25 * 1024 * 1024) / 3) * 4;
  const almostLimitBase64 = "A".repeat(maxBase64Chars - 4);
  const input = { link_attempt_id: "link_uni_tools_0123456789abcdef", variant: "uni-1", content_base64: almostLimitBase64,
    filename: "large.jpg", mime_type: "image/jpeg" };
  assert.equal(OWNER_UNI_IMAGE_TOOL_INPUT_SCHEMAS.upload.safeParse(input).success, true);
  assert.equal(OWNER_UNI_IMAGE_TOOL_INPUT_SCHEMAS.upload.safeParse({ ...input, content_base64: `${"A".repeat(maxBase64Chars - 4)}AA==` }).success, true,
    "the exact 25 MiB local ceiling is accepted");
  assert.equal(OWNER_UNI_IMAGE_TOOL_INPUT_SCHEMAS.upload.safeParse({ ...input, content_base64: `${almostLimitBase64}AAAA` }).success, false);
  assert.equal(OWNER_UNI_IMAGE_TOOL_INPUT_SCHEMAS.upload.safeParse({ ...input, content_base64: "AB==" }).success, false);
  assert.equal(OWNER_UNI_IMAGE_TOOL_INPUT_SCHEMAS.upload.safeParse({ ...input, content_base64: "AAAA=" }).success, false);
  for (const mime_type of ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"]) {
    assert.equal(OWNER_UNI_IMAGE_TOOL_INPUT_SCHEMAS.upload.safeParse({ ...input, content_base64: "AA==", mime_type }).success, true, mime_type);
  }
});

test("all four tools run through the real Uni services and synthetic fixed-route backend for all variants", async () => {
  const rig = createActualGenerationComposition();
  const owner = await inspect({ ownerUniImageReferences: rig.composition });
  const attemptFor = (suffix: string) => `link_uni_tools_000000000000000000${suffix}`;
  try {
    const scenarios = [
      { variant: "uni-1" as const, prompt: "explicit Uni prompt", parameters: { aspect_ratio: "16:9", seed: null, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null },
      { variant: "uni-1.1-modify-image" as const, prompt: "explicit Modify prompt", parameters: { seed: 0, mode: "manga" }, image_reference_handles: [], main_image_reference_handle: null },
      { variant: "uni-1.1-remove-background" as const, prompt: "", parameters: { invert_mask: true }, image_reference_handles: [], main_image_reference_handle: null }
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const attemptId = attemptFor(String(index + 1));
      let handles: string[] = [];
      let mainHandle: string | null = null;
      if (scenario.variant !== "uni-1") {
        const uploaded = await owner.client.callTool({ name: "syntx_upload_uni_image_reference", arguments: {
          link_attempt_id: attemptId, variant: scenario.variant, content_base64: JPEG.toString("base64"),
          filename: `${scenario.variant}.jpg`, mime_type: "image/jpeg"
        } });
        assert.equal(uploaded.isError, undefined);
        assert.equal((uploaded.structuredContent as Record<string, unknown>).status, "uploaded");
        assert.equal(JSON.stringify(uploaded.structuredContent).includes("https://"), false);
        handles = [(uploaded.structuredContent as { reference_handle: string }).reference_handle];
        if (scenario.variant === "uni-1.1-modify-image") mainHandle = handles[0]!;
      }
      const image_reference_handles = scenario.variant === "uni-1" ? [] : handles;
      const generated = await owner.client.callTool({ name: "syntx_owner_generate_uni_image", arguments: {
        link_attempt_id: attemptId, variant: scenario.variant, prompt: scenario.prompt, parameters: scenario.parameters,
        image_reference_handles, main_image_reference_handle: mainHandle
      } });
      assert.equal(generated.isError, undefined, `${scenario.variant}: ${JSON.stringify(generated)}`);
      const result = generated.structuredContent as Record<string, unknown>;
      assert.equal(result.status, "result_observed");
      assert.equal(result.observation_status, "COMPLETE");
      assert.equal(result.model_id, scenario.variant);
      assert.equal(result.actual_result_count, 2);
      assert.equal(result.result_count_confidence, "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL");
      const artifacts = result.artifacts as Array<{ message_object_id: string; mime_type: string | null; mime_source: string }>;
      assert.deepEqual(artifacts.map(({ message_object_id }) => message_object_id),
        [`uni-tool-output-${index + 1}-1`, `uni-tool-output-${index + 1}-2`]);
      assert.equal(artifacts[0]?.mime_type, "image/png");
      assert.equal(artifacts[0]?.mime_source, "URL_EXTENSION");
      assert.equal(artifacts[1]?.mime_type, null);
      assert.equal(artifacts[1]?.mime_source, "UNKNOWN");
    }

    const recoveryAttempt = attemptFor("4");
    rig.failHistoryOnce();
    const unknown = await owner.client.callTool({ name: "syntx_owner_generate_uni_image", arguments: {
      link_attempt_id: recoveryAttempt, variant: "uni-1", prompt: "reconcile after history timeout",
      parameters: { aspect_ratio: "1:1", seed: 1, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null
    } });
    assert.equal(unknown.isError, true);
    assert.equal(unknown.structuredContent, undefined, "errors never masquerade as structured success content");
    const errorContent = (unknown as { content: Array<{ type: string; text?: string }> }).content;
    const errorBody = JSON.parse(errorContent[0]?.type === "text" ? errorContent[0].text ?? "{}" : "{}") as { error: { recovery_id?: string; diagnostic?: unknown; message: string } };
    assert.match(errorBody.error.recovery_id ?? "", /^uni_image_recovery_[0-9a-f-]{36}$/u);
    assert.equal(JSON.stringify(errorBody).includes("synthetic"), false);
    assert.equal(JSON.stringify(errorBody).includes("https://"), false);
    assert.equal(JSON.stringify(errorBody).includes("reconcile after history timeout"), false);
    assert.deepEqual(Object.keys(errorBody.error.diagnostic as object).sort(), ["echo_ack_known", "history_binding", "history_binding_reason",
      "history_get_calls", "history_get_calls_saturated", "phase", "post_started", "result_get_calls", "result_get_calls_saturated",
      "result_reason", "result_status"].sort());
    const listed = await owner.client.callTool({ name: "syntx_owner_list_uni_image_recoveries", arguments: { link_attempt_id: recoveryAttempt } });
    assert.equal(listed.isError, undefined);
    assert.equal((listed.structuredContent as { recoveries: unknown[] }).recoveries.length, 1);
    assert.equal(JSON.stringify(listed.structuredContent).includes("https://"), false);
    const reconciled = await owner.client.callTool({ name: "syntx_owner_reconcile_uni_image", arguments: {
      link_attempt_id: recoveryAttempt, recovery_id: errorBody.error.recovery_id
    } });
    assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled));
    assert.equal((reconciled.structuredContent as Record<string, unknown>).observation_status, "COMPLETE");
    assert.equal((reconciled.structuredContent as { actual_result_count: number }).actual_result_count, 2);

    const partialAttempt = attemptFor("5");
    rig.partialNextResult();
    const partial = await owner.client.callTool({ name: "syntx_owner_generate_uni_image", arguments: {
      link_attempt_id: partialAttempt, variant: "uni-1", prompt: "partial results retain recovery",
      parameters: { aspect_ratio: "1:1", seed: 2, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null
    } });
    assert.equal(partial.isError, undefined, JSON.stringify(partial));
    assert.equal((partial.structuredContent as Record<string, unknown>).observation_status, "PARTIAL");
    assert.equal((partial.structuredContent as { actual_result_count: number }).actual_result_count, 1);
    assert.equal((partial.structuredContent as { artifacts: unknown[] }).artifacts.length, 1);
    const partialRecoveryId = (partial.structuredContent as { recovery_id: string }).recovery_id;
    assert.match(partialRecoveryId, /^uni_image_recovery_[0-9a-f-]{36}$/u);
    const partialListed = await owner.client.callTool({ name: "syntx_owner_list_uni_image_recoveries", arguments: { link_attempt_id: partialAttempt } });
    assert.equal((partialListed.structuredContent as { recoveries: unknown[] }).recoveries.length, 1);
    assert.equal(JSON.stringify(partialListed.structuredContent).includes("https://"), false);
    const partialReconciled = await owner.client.callTool({ name: "syntx_owner_reconcile_uni_image", arguments: {
      link_attempt_id: partialAttempt, recovery_id: partialRecoveryId
    } });
    assert.equal(partialReconciled.isError, undefined, JSON.stringify(partialReconciled));
    assert.equal((partialReconciled.structuredContent as Record<string, unknown>).observation_status, "COMPLETE");

    assert.deepEqual(rig.calls, { account_reads: 20, model_reads: 10, uploads: 2, chats: 5, posts: 5, histories: 6, results: 6 });
  } finally {
    await owner.client.close(); await owner.server.close(); await rig.close();
  }
});

test("generate tool preserves explicit Uni controls and rejects invalid branch/count/prompt shapes before service", async () => {
  const received: Array<Record<string, unknown>> = [];
  const service = {
    async generate(input: unknown) {
      const request = input as { attemptId: string; variant: string; parameters: unknown; prompt: string; image_reference_handles: string[] };
      received.push(request as unknown as Record<string, unknown>);
      return { status: "result_observed", observation_status: "PENDING", observation_reason: "NO_RESULT_OBJECTS",
        namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN", model_confidence: "PRIVATE_PROFILE_CONTEXT_NOT_PROVIDER_PROOF",
        model_id: request.variant, ai_name: "luma_image", operation_id: "generate-image", profile_id: "owner-uni-image-source-profile-v1",
        profile_schema_hash: `sha256:${"a".repeat(64)}`, catalog_version: CATALOG_VERSION,
        request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`,
        reference_count: request.image_reference_handles.length, actual_result_count: 0,
        result_count_confidence: "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL", recovery_id: null, artifacts: [] };
    },
    async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; },
    async invalidateAttempt() {}, async close() {}
  };
  const owner = await inspect({ ownerUniImageReferences: { uploadService: { async upload() { throw new Error("unused"); } }, generationService: service } });
  const handle = (index: number) => `uni_image_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const valid = [
    { variant: "uni-1", prompt: `${"x".repeat(5_998)}\n`, parameters: { aspect_ratio: "1:1", seed: 2_147_483_647, mode: "auto" },
      image_reference_handles: [], main_image_reference_handle: null },
    { variant: "uni-1.1-modify-image", prompt: "preserve all eight ordered handles", parameters: { seed: null, mode: "manga" },
      image_reference_handles: Array.from({ length: 8 }, (_, index) => handle(index + 1)), main_image_reference_handle: handle(8) },
    { variant: "uni-1.1-remove-background", prompt: "", parameters: { invert_mask: false },
      image_reference_handles: [handle(9)], main_image_reference_handle: null }
  ];
  try {
    for (const input of valid) {
      const result = await owner.client.callTool({ name: "syntx_owner_generate_uni_image", arguments: {
        link_attempt_id: "link_uni_tools_0000000000000000009", ...input
      } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
    }
    assert.equal(received.length, 3);
    assert.deepEqual(Object.keys(received[0]!).sort(), ["attemptId", "variant", "prompt", "parameters", "image_reference_handles", "main_image_reference_handle"].sort());
    assert.deepEqual(received[1]?.image_reference_handles, valid[1]!.image_reference_handles);
    assert.equal(received[1]?.main_image_reference_handle, handle(8));
    assert.deepEqual(received[2]?.parameters, { invert_mask: false });
    const invalid = [
      { ...valid[0]!, parameters: { aspect_ratio: "3:1", seed: 0, mode: "manga" } },
      { ...valid[0]!, parameters: { aspect_ratio: "1:1", seed: 2_147_483_648, mode: "auto" } },
      { ...valid[0]!, parameters: { aspect_ratio: "1:1", seed: null, mode: "auto", n: 1 } },
      { ...valid[0]!, prompt: "x".repeat(6_001) },
      { ...valid[0]!, prompt: `${"x".repeat(5_998)}\n\n` },
      { ...valid[1]!, image_reference_handles: valid[1]!.image_reference_handles.slice(0, 7) },
      { ...valid[1]!, main_image_reference_handle: handle(99) },
      { ...valid[1]!, image_reference_handles: [...valid[1]!.image_reference_handles, handle(9)] },
      { ...valid[2]!, image_reference_handles: [] },
      { ...valid[2]!, image_reference_handles: [handle(9), handle(10)] },
      { ...valid[2]!, main_image_reference_handle: handle(9) },
      { ...valid[2]!, n: 1 }
    ];
    for (const input of invalid) {
      const result = await owner.client.callTool({ name: "syntx_owner_generate_uni_image", arguments: {
        link_attempt_id: "link_uni_tools_0000000000000000009", ...input
      } });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
    }
    assert.equal(received.length, 3, "invalid schema branches cannot invoke the generation service");
  } finally { await owner.client.close(); await owner.server.close(); }
});

test("tool boundary rejects proxies, accessors, and extra keys before services and never echoes raw errors", async () => {
  type Handler = (input: unknown, extra: { signal?: AbortSignal }) => Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }>; structuredContent?: unknown }>;
  const handlers = new Map<string, Handler>();
  let serviceCalls = 0;
  const composition = { uploadService: { async upload() { serviceCalls += 1; throw new Error("private upload error"); } },
    generationService: { async generate() { serviceCalls += 1; throw new Error("private generation error"); },
      async reconcile() { serviceCalls += 1; throw new Error("private reconcile error"); }, async listRecoveries() { serviceCalls += 1; return []; } } };
  const fakeServer = { registerTool(name: string, _config: unknown, handler: Handler) { handlers.set(name, handler); } } as unknown as McpServer;
  registerSyntxOwnerUniImageTools(fakeServer, composition);
  const generate = handlers.get("syntx_owner_generate_uni_image");
  assert.ok(generate);
  const good = { link_attempt_id: "link_uni_tools_0000000000000000009", variant: "uni-1", prompt: "explicit",
    parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null };
  let getterCalls = 0;
  const accessor = { ...good, get prompt() { getterCalls += 1; return "explicit"; } };
  const proxy = new Proxy(good, {});
  const extraField = { ...good, n: 1 };
  for (const input of [proxy, accessor, extraField]) {
    const result = await generate(input, {});
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
  }
  assert.equal(getterCalls, 0);
  assert.equal(serviceCalls, 0);

  const serviceError = await generate(good, {});
  assert.equal(serviceError.isError, true);
  assert.equal(serviceError.structuredContent, undefined);
  assert.equal(serviceError.content[0]?.type, "text");
  assert.equal(serviceError.content[0]?.text?.includes("private generation error"), false);
  assert.equal(serviceCalls, 1);
});
