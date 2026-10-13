import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolve } from "node:path";
import { createDefaultApplication } from "../src/application/factory.js";
import {
  OwnerKontextImageGenerationServiceError,
  OwnerKontextImageGenerationService,
  type OwnerKontextImageGenerationPreflightInput,
  type OwnerKontextImageGenerationPreflightResult,
  type OwnerKontextImageGenerationResult,
  type OwnerKontextImageRecoveryListItem
} from "../src/application/owner-kontext-image-generation-service.js";
import {
  OwnerKontextImageUploadService,
  OwnerKontextImageUploadServiceError,
  type OwnerKontextImageUploadReceipt
} from "../src/application/owner-kontext-image-upload-service.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { createMcpServer, type CreateMcpServerOptions } from "../src/mcp/server.js";
import {
  registerSyntxOwnerKontextImageTools,
  SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_KONTEXT_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_KONTEXT_IMAGE_TOOL_NAME,
  SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME
} from "../src/mcp/owner-kontext-image-tools.js";

const ATTEMPT = "link_kontext_tools_test_attempt_000001";
const HANDLE = "kontext_image_823e4567-e89b-12d3-a456-426614174000";
const RECOVERY_ID = "kontext_recovery_823e4567-e89b-12d3-a456-426614174001";
const BASE64_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const AUTH_BINDING = Object.freeze({ tenant_id: "kontext-tools-tenant", subject: "kontext-tools-subject" });
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
  resolve(process.cwd(), "catalog")).discoveryCatalog;
const NOW = Date.now();
const PARAMETERS = Object.freeze({ resolution: "1152x896", cfg: 1.05, steps: 10.5, image_strength: 0.123 });
const DIAGNOSTIC = Object.freeze({
  phase: "GENERATION_POST" as const,
  post_started: true,
  echo_ack_known: true,
  history_binding: "PENDING" as const,
  history_binding_reason: null,
  history_get_calls: 1,
  history_get_calls_saturated: false,
  inprogress_get_calls: 0,
  inprogress_get_calls_saturated: false,
  result_get_calls: 0,
  result_get_calls_saturated: false,
  result_status: "NOT_READ" as const,
  result_reason: null
});
const INPUT_METADATA = Object.freeze({
  mime_type: "image/png" as const,
  width: 1200,
  height: 800,
  size: 1_024,
  sha256: `sha256:${"a".repeat(64)}`,
  metadata_confidence: "CONTAINER_METADATA_ONLY" as const
});
const RESULT: OwnerKontextImageGenerationResult = Object.freeze({
  status: "result_observed",
  backend_acceptance: "unproven",
  ai_name: "flux",
  model_id: "flux-kontext-pro",
  variant: "flux-kontext-pro",
  operation_id: "generate-image",
  profile_id: "flux-kontext-source-reviewed-v1",
  profile_schema_hash: `sha256:${"b".repeat(64)}`,
  catalog_version: "2026-10-08T13:18:39.393Z.36e6960df354",
  request_fingerprint: `sha256:${"c".repeat(64)}`,
  parameters: PARAMETERS,
  requested_resolution: PARAMETERS.resolution,
  workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA",
  reference_count: 1,
  input_images: [INPUT_METADATA],
  expected_output_geometry: null,
  actual_image: Object.freeze({ mime_type: "image/jpeg", width: null, height: null }),
  geometry_verified: false,
  artifact: Object.freeze({ url: "https://r2.syntx.ai/generated/result.png", mime_type: "image/png", mime_source: "URL_EXTENSION" })
});

function resultFor(
  variant: OwnerKontextImageGenerationResult["variant"],
  referenceCount = 1
): OwnerKontextImageGenerationResult {
  return Object.freeze({
    ...RESULT,
    model_id: variant,
    variant,
    reference_count: referenceCount,
    input_images: Object.freeze(Array.from({ length: referenceCount }, (_, index) => ({
      ...INPUT_METADATA,
      sha256: `sha256:${String(index + 1).repeat(64)}`
    })))
  });
}
const UPLOAD: OwnerKontextImageUploadReceipt = Object.freeze({
  status: "uploaded",
  reference_handle: HANDLE,
  variant: "flux-kontext-pro",
  original_mime_type: "image/jpg",
  mime_type: "image/jpeg",
  width: 1,
  height: 1,
  size: 68,
  sha256: `sha256:${"d".repeat(64)}`,
  expires_in_seconds: 899,
  metadata_confidence: "CONTAINER_METADATA_ONLY"
});

function recovery(model_id: "flux-kontext-pro" | "flux-kontext-max" | "flux-kontext-multi" = "flux-kontext-pro"): OwnerKontextImageRecoveryListItem {
  return { recovery_id: RECOVERY_ID, created_at: "2026-10-10T12:00:00.000Z", model_id,
    operation_id: "generate-image", status: "OUTCOME_UNKNOWN", diagnostic: DIAGNOSTIC };
}

function harness(service: {
  readonly uploadService: { upload(input: unknown): Promise<OwnerKontextImageUploadReceipt> };
  readonly generationService: {
    generate(input: unknown, signal?: AbortSignal): Promise<OwnerKontextImageGenerationResult>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerKontextImageGenerationResult>;
    listRecoveries(input: unknown): Promise<readonly OwnerKontextImageRecoveryListItem[]>;
  };
}) {
  const server = new McpServer({ name: "owner-kontext-image-tools-test", version: "1.0.0" });
  registerSyntxOwnerKontextImageTools(server, service);
  const client = new Client({ name: "owner-kontext-image-tools-client", version: "1.0.0" });
  return { server, client };
}

async function connect(server: McpServer, client: Client): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
}

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED",
    expires_at: new Date(NOW + 60 * 60_000).toISOString(), linked: true };
}

function freshPreflight(variant: OwnerKontextImageGenerationResult["variant"]): OwnerKontextImageGenerationPreflightResult {
  return {
    account: {
      balance: { unit: "tokens", available: null },
      subscription: { active: true, plan_type: "PAID", end_date: null, end_date_kind: null },
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE,
      source_build: ACCOUNT_SOURCE_BUILD,
      observed_at: new Date(NOW).toISOString()
    },
    model_access: {
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
      catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
      model_id: variant, ai_name: "flux", model_type: variant, account_read_live: true,
      parameter_keys: [], parameters_redacted: true, access: true, cost: 1,
      discount_cost: null, free_remaining_generations: null, limit: null,
      show_warning: false, observed_at: new Date(NOW).toISOString()
    }
  };
}

test("owner Kontext tools expose four default-off tool names and full explicit controls", async () => {
  const calls: Array<{ name: string; input: unknown }> = [];
  const { server, client } = harness({
    uploadService: { async upload(input) { calls.push({ name: "upload", input }); return UPLOAD; } },
    generationService: {
      async generate(input) {
        calls.push({ name: "generate", input });
        const request = input as { variant: OwnerKontextImageGenerationResult["variant"]; reference_handles: readonly string[] };
        return resultFor(request.variant, request.reference_handles.length);
      },
      async reconcile(input) { calls.push({ name: "reconcile", input }); return RESULT; },
      async listRecoveries(input) { calls.push({ name: "list", input }); return [recovery()]; }
    }
  });
  await connect(server, client);
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((item) => item.name).sort(), [
      SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME,
      SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_KONTEXT_IMAGE_TOOL_NAME,
      SYNTX_OWNER_LIST_KONTEXT_RECOVERIES_TOOL_NAME
    ].sort());
    const generateTool = tools.find((item) => item.name === SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME)!;
    const generateSchema = generateTool.inputSchema as { properties?: Record<string, { properties?: Record<string, unknown> }> };
    assert.deepEqual(Object.keys(generateSchema.properties?.parameters?.properties ?? {}).sort(), [
      "cfg", "image_strength", "resolution", "steps"
    ]);
    const uploadTool = tools.find((item) => item.name === SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME)!;
    const uploadSchema = uploadTool.inputSchema as { properties?: Record<string, { maxLength?: number; enum?: readonly string[] }> };
    assert.equal(uploadSchema.properties?.content_base64?.maxLength, Math.ceil((10 * 1024 * 1024) / 3) * 4);
    assert.deepEqual(uploadSchema.properties?.mime_type?.enum, ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]);

    const uploaded = await client.callTool({ name: SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, variant: "flux-kontext-pro", content_base64: BASE64_PNG,
      filename: "референс.png", mime_type: "image/jpg"
    } });
    assert.equal(uploaded.isError, undefined);
    const uploadedCall = calls[0]!;
    const uploadedInput = uploadedCall.input as Record<string, unknown>;
    assert.deepEqual({ name: uploadedCall.name, input: Object.fromEntries(Object.entries(uploadedInput).filter(([key]) => key !== "signal")) }, { name: "upload", input: {
      attemptId: ATTEMPT, variant: "flux-kontext-pro", content_base64: BASE64_PNG,
      filename: "референс.png", mime_type: "image/jpg"
    } });

    for (const [variant, handles] of [
      ["flux-kontext-pro", [HANDLE]],
      ["flux-kontext-max", []],
      ["flux-kontext-multi", [HANDLE, "kontext_image_823e4567-e89b-12d3-a456-426614174002",
        "kontext_image_823e4567-e89b-12d3-a456-426614174003", "kontext_image_823e4567-e89b-12d3-a456-426614174004"]]
    ] as const) {
      const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME, arguments: {
        link_attempt_id: ATTEMPT, variant, reference_handles: handles, parameters: PARAMETERS,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "  preserve prompt  "
      } });
      assert.equal(generated.isError, undefined);
      assert.equal((generated.structuredContent as { backend_acceptance: string }).backend_acceptance, "unproven");
    }
    assert.deepEqual(calls.filter((call) => call.name === "generate").map((call) => call.input), [
      { attemptId: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [HANDLE], parameters: PARAMETERS,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "  preserve prompt  " },
      { attemptId: ATTEMPT, variant: "flux-kontext-max", reference_handles: [], parameters: PARAMETERS,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "  preserve prompt  " },
      { attemptId: ATTEMPT, variant: "flux-kontext-multi", reference_handles: [HANDLE,
        "kontext_image_823e4567-e89b-12d3-a456-426614174002", "kontext_image_823e4567-e89b-12d3-a456-426614174003",
        "kontext_image_823e4567-e89b-12d3-a456-426614174004"], parameters: PARAMETERS,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "  preserve prompt  " }
    ]);
    const reconciled = await client.callTool({ name: SYNTX_OWNER_RECONCILE_KONTEXT_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: RECOVERY_ID
    } });
    assert.equal(reconciled.isError, undefined);
    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_KONTEXT_RECOVERIES_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT
    } });
    assert.equal(listed.isError, undefined);
    assert.deepEqual(calls.slice(-2), [
      { name: "reconcile", input: { attemptId: ATTEMPT, recovery_id: RECOVERY_ID } },
      { name: "list", input: { attemptId: ATTEMPT, limit: 20 } }
    ]);
  } finally { await client.close(); await server.close(); }
});

test("owner Kontext tool schemas reject missing, guessed, extra, and out-of-branch state before service calls", async () => {
  let calls = 0;
  const { server, client } = harness({
    uploadService: { async upload() { calls += 1; return UPLOAD; } },
    generationService: {
      async generate() { calls += 1; return RESULT; },
      async reconcile() { calls += 1; return RESULT; },
      async listRecoveries() { calls += 1; return []; }
    }
  });
  await connect(server, client);
  try {
    let invalidIndex = 0;
    for (const invalid of [
      { link_attempt_id: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [], parameters: PARAMETERS,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" },
      { link_attempt_id: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [], parameters: PARAMETERS,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "   " },
      { link_attempt_id: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [], parameters: PARAMETERS,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "ok", model_id: "flux-kontext-pro" },
      { link_attempt_id: ATTEMPT, variant: "flux-kontext-multi", reference_handles: [], parameters: PARAMETERS,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "multi needs ref" },
      { link_attempt_id: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [HANDLE, HANDLE], parameters: PARAMETERS,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "duplicate ref" },
      { link_attempt_id: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [HANDLE, "kontext_image_823e4567-e89b-12d3-a456-426614174002"], parameters: PARAMETERS,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "too many pro refs" },
      { link_attempt_id: ATTEMPT, variant: "flux-kontext-multi", reference_handles: [HANDLE,
        "kontext_image_823e4567-e89b-12d3-a456-426614174002", "kontext_image_823e4567-e89b-12d3-a456-426614174003",
        "kontext_image_823e4567-e89b-12d3-a456-426614174004", "kontext_image_823e4567-e89b-12d3-a456-426614174005"], parameters: PARAMETERS,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "too many multi refs" },
      { link_attempt_id: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [], parameters: { ...PARAMETERS, cfg: 4.01 },
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "range" },
      { link_attempt_id: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [], parameters: PARAMETERS,
        workflow_policy: "website-default", prompt: "policy mismatch" },
      { link_attempt_id: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [], parameters: PARAMETERS,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: `x${"😀".repeat(16_385)}` }
    ]) {
      const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME, arguments: invalid });
      assert.equal(result.isError, true, `accepted invalid request #${invalidIndex}: ${JSON.stringify(invalid).slice(0, 120)}`);
      invalidIndex += 1;
    }
    const invalidUpload = await client.callTool({ name: SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, variant: "flux-kontext-pro", content_base64: BASE64_PNG,
      filename: "../secret.png", mime_type: "image/png", path: "/private/secret.png"
    } });
    assert.equal(invalidUpload.isError, true);
    assert.equal(calls, 0);
  } finally { await client.close(); await server.close(); }
});

test("upload and generation errors redact unknown exception content and only expose safe recovery evidence", async () => {
  const secret = "PRIVATE_URL_PROMPT_PROVIDER_TRACE";
  const maliciousGenerationCode = new OwnerKontextImageGenerationServiceError("INVALID_REQUEST");
  Object.defineProperty(maliciousGenerationCode, "code", { value: secret });
  const maliciousUploadCode = new OwnerKontextImageUploadServiceError("INVALID_REQUEST");
  Object.defineProperty(maliciousUploadCode, "code", { value: secret });
  const { server, client } = harness({
    uploadService: { async upload() { throw maliciousUploadCode; } },
    generationService: {
      async generate() { throw maliciousGenerationCode; },
      async reconcile() { throw new Error(secret); },
      async listRecoveries() { throw new Error(secret); }
    }
  });
  await connect(server, client);
  try {
    const uploaded = await client.callTool({ name: SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, variant: "flux-kontext-pro", content_base64: BASE64_PNG,
      filename: "input.png", mime_type: "image/png"
    } });
    const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [HANDLE],
      parameters: PARAMETERS, workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: "redact"
    } });
    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_KONTEXT_RECOVERIES_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(uploaded.isError, true);
    assert.equal(generated.isError, true);
    assert.equal(listed.isError, true);
    assert.equal(JSON.stringify([uploaded, generated, listed]).includes(secret), false);
    assert.equal(JSON.parse((uploaded.content as readonly { text: string }[])[0]!.text).error.code, "UPLOAD_FAILED");
    assert.equal(JSON.parse((generated.content as readonly { text: string }[])[0]!.text).error.code, "GENERATION_FAILED");
    assert.match(JSON.parse((generated.content as readonly { text: string }[])[0]!.text).error.message, /do not repeat/u);
  } finally { await client.close(); await server.close(); }
});

test("native MCP full flow binds all variants, zero-reference Pro, and four-reference Multi without retries", async () => {
  const variants = [
    { variant: "flux-kontext-pro" as const, references: 0, resolution: "1344x768" as const },
    { variant: "flux-kontext-max" as const, references: 1, resolution: "1024x1024" as const },
    { variant: "flux-kontext-multi" as const, references: 4, resolution: "768x1344" as const }
  ];
  const events: Array<{ method: string; path: string }> = [];
  const uploadedUrls = new Map<string, string[]>();
  let activeChat = 0;
  let activeVariant: typeof variants[number]["variant"] = "flux-kontext-pro";
  let activeOwnerEcho = "";
  let activeBotMessage = "";
  let uploadIndex = 0;
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kontext-mcp-integration-credential");
    }
  };
  const nativeClient = new SyntxChatHttpClient({
    credentialBroker,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      events.push({ method, path: url.pathname });
      if (url.pathname === "/api/v1/chats/upload-files") {
        assert.equal(method, "POST");
        assert.ok(init?.body instanceof FormData);
        const form = init.body as FormData;
        assert.equal(form.get("destination"), "uploaded");
        assert.equal(form.get("check_duplicates"), "true");
        const file = form.get("files");
        assert.ok(file instanceof File);
        assert.equal(file.type, "image/png");
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(BASE64_PNG, "base64"));
        activeVariant = String(form.get("model_type")) as typeof activeVariant;
        uploadIndex += 1;
        const objectUrl = `https://r2.syntx.ai/kontext/private-${uploadIndex}.png`;
        const references = uploadedUrls.get(activeVariant) ?? [];
        references.push(objectUrl);
        uploadedUrls.set(activeVariant, references);
        return Response.json({ files: [{ id: `private-provider-file-${uploadIndex}`, url: objectUrl,
          mime_type: "image/png", size: 68 }] });
      }
      if (url.pathname === "/api/v1/chats") {
        assert.equal(method, "POST");
        const body = JSON.parse(String(init?.body)) as { title: string; scope: string };
        assert.equal(body.scope, "image");
        assert.match(body.title, /^owner-kontext-/u);
        activeChat += 1;
        return Response.json({ uuid: `kontext-native-chat-${activeChat}` });
      }
      if (url.pathname === "/api/v1/design/generate") {
        assert.equal(method, "POST");
        const body = JSON.parse(String(init?.body)) as {
          chat_uuid: string; prompt: string; settings: Record<string, unknown>;
        };
        activeVariant = String(body.settings.model_type) as typeof activeVariant;
        assert.equal(url.searchParams.get("ai_name"), "flux");
        const item = variants.find(({ variant }) => variant === activeVariant)!;
        assert.equal(body.chat_uuid, `kontext-native-chat-${activeChat}`);
        assert.equal(body.prompt, `MCP exact prompt for ${activeVariant}`);
        assert.deepEqual(body.settings, {
          n: 1, model_type: activeVariant, workflow_type: "default", civitai_loras: [],
          resolution: item.resolution, cfg: 1.05, steps: 10.5, image_strength: 0.123,
          file_urls: (uploadedUrls.get(activeVariant) ?? []).map((url) => ({ type: "image", url }))
        });
        activeOwnerEcho = `kontext-owner-echo-${activeChat}`;
        activeBotMessage = `kontext-bot-message-${activeChat}`;
        return Response.json({ id: activeOwnerEcho });
      }
      const historyMatch = /^\/api\/v1\/chats\/(kontext-native-chat-\d+)\/messages$/u.exec(url.pathname);
      if (historyMatch) {
        assert.equal(method, "GET");
        assert.equal(url.searchParams.get("page"), "1");
        assert.equal(url.searchParams.get("page_size"), "10");
        const referenceObjects = (uploadedUrls.get(activeVariant) ?? []).map((_, index) => ({
          id: `owner-image-object-${activeChat}-${index + 1}`,
          message_id: activeOwnerEcho,
          object_type: "image",
          model_type: activeVariant
        }));
        const ownerObjects = [...referenceObjects, {
          id: `owner-text-object-${activeChat}`, message_id: activeOwnerEcho, object_type: "text", model_type: null
        }];
        return Response.json({
          messages: [
            { id: activeOwnerEcho, chat_id: 700 + activeChat, author_id: 12345, message_object: ownerObjects },
            { id: activeBotMessage, chat_id: 700 + activeChat, author_id: -1, message_object: [{
              id: `bot-image-object-${activeChat}`, message_id: activeBotMessage, object_type: "image", model_type: activeVariant
            }] }
          ],
          pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
        });
      }
      const resultMatch = /^\/api\/v1\/chats\/(kontext-native-chat-\d+)\/(kontext-bot-message-\d+)$/u.exec(url.pathname);
      if (resultMatch) {
        assert.equal(method, "GET");
        return Response.json({
          id: activeBotMessage,
          chat_id: 700 + activeChat,
          author_id: -1,
          message_object: [{ id: `bot-image-object-${activeChat}`, message_id: activeBotMessage,
            object_type: "image", model_type: activeVariant, completed: true,
            object_url: `https://r2.syntx.ai/kontext/output-${activeChat}.png` }]
        });
      }
      throw new Error(`Unexpected native route: ${url.pathname}`);
    }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never;
  const uploadService = new OwnerKontextImageUploadService({
    binding: AUTH_BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => nativeClient, now: () => NOW
  });
  const preflightInputs: OwnerKontextImageGenerationPreflightInput[] = [];
  const generationService = new OwnerKontextImageGenerationService({
    binding: AUTH_BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    uploadService, resolveChatClient: () => nativeClient,
    preflight: async (input: OwnerKontextImageGenerationPreflightInput) => {
      preflightInputs.push(input);
      return freshPreflight(input.variant);
    },
    now: () => NOW, timeoutMs: 1_000, pollDelayMs: 0, maxPollAttempts: 1
  });
  const composition = { uploadService, generationService };
  const server = createMcpServer(createDefaultApplication({ discoveryCatalog: CATALOG, runtimeCapabilities: null }), {
    ownerKontextImageReferences: composition
  });
  const client = new Client({ name: "kontext-native-full-flow-client", version: "1.0.0" });
  await connect(server, client);
  try {
    for (const item of variants) {
      const handles: string[] = [];
      for (let index = 0; index < item.references; index += 1) {
        const uploaded = await client.callTool({ name: SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME, arguments: {
          link_attempt_id: ATTEMPT, variant: item.variant, content_base64: BASE64_PNG,
          filename: `ref-${item.variant}-${index + 1}.png`, mime_type: "image/png"
        } });
        assert.equal(uploaded.isError, undefined);
        const receipt = uploaded.structuredContent as { reference_handle: string; variant: string; expires_in_seconds: number };
        assert.equal(receipt.variant, item.variant);
        assert.ok(receipt.expires_in_seconds > 0 && receipt.expires_in_seconds <= 900);
        assert.equal(JSON.stringify(uploaded).includes("r2.syntx.ai"), false);
        handles.push(receipt.reference_handle);
      }
      const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME, arguments: {
        link_attempt_id: ATTEMPT, variant: item.variant, reference_handles: handles,
        parameters: { resolution: item.resolution, cfg: 1.05, steps: 10.5, image_strength: 0.123 },
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: `MCP exact prompt for ${item.variant}`
      } });
      assert.equal(generated.isError, undefined);
      const observed = generated.structuredContent as OwnerKontextImageGenerationResult;
      assert.equal(observed.variant, item.variant);
      assert.equal(observed.reference_count, item.references);
      assert.equal(observed.requested_resolution, item.resolution);
      assert.deepEqual(observed.parameters, { resolution: item.resolution, cfg: 1.05, steps: 10.5, image_strength: 0.123 });
      assert.equal(observed.input_images.length, item.references);
      assert.deepEqual(observed.input_images, Array.from({ length: item.references }, () => ({
        mime_type: "image/png",
        width: 1,
        height: 1,
        size: Buffer.from(BASE64_PNG, "base64").byteLength,
        sha256: `sha256:${createHash("sha256").update(Buffer.from(BASE64_PNG, "base64")).digest("hex")}`,
        metadata_confidence: "CONTAINER_METADATA_ONLY"
      })));
      assert.equal(observed.backend_acceptance, "unproven");
      assert.equal(observed.geometry_verified, false);
      assert.equal(observed.expected_output_geometry, null);
      assert.equal(observed.actual_image.width, null);
      assert.equal(observed.artifact.mime_source, "URL_EXTENSION");
      assert.equal(JSON.stringify(observed).includes("kontext-native-chat-"), false);
      assert.equal(JSON.stringify(observed).includes("owner-echo"), false);
      assert.equal(JSON.stringify(observed).includes("private-provider-file"), false);
      assert.equal(JSON.stringify(observed).includes("reference_handle"), false);
    }
    assert.equal(uploadIndex, 5);
    assert.equal(events.filter(({ path }) => path === "/api/v1/chats/upload-files").length, 5);
    assert.equal(events.filter(({ path }) => path === "/api/v1/chats").length, 3);
    assert.equal(events.filter(({ path }) => path === "/api/v1/design/generate").length, 3);
    assert.equal(events.filter(({ path }) => path.endsWith("/messages")).length, 3);
    assert.equal(events.filter(({ path }) => /^\/api\/v1\/chats\/.*\/kontext-bot-message-\d+$/u.test(path)).length, 3);
    assert.equal(events.filter(({ method }) => method === "POST").length, 11);
    assert.equal(events.filter(({ method }) => method === "GET").length, 6);
    assert.equal(preflightInputs.length, 6);
    assert.ok(preflightInputs.every(({ cost_inputs }) => Object.keys(cost_inputs).length === 0));
  } finally {
    await client.close();
    await server.close();
    await generationService.close();
  }
});

test("Kontext service composition is explicit, default-off, and incompatible with durable paid mode", async () => {
  const defaultOptions: CreateMcpServerOptions = {};
  assert.equal(defaultOptions.ownerKontextImageReferences, undefined);
  const application = createDefaultApplication();
  const defaultServer = createMcpServer(application);
  const defaultClient = new Client({ name: "kontext-default-off-client", version: "1.0.0" });
  await connect(defaultServer, defaultClient);
  try {
    const names = (await defaultClient.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.some((name) => name.startsWith("syntx_upload_kontext_") ||
      name.startsWith("syntx_owner_generate_kontext_") || name.startsWith("syntx_owner_reconcile_kontext_") ||
      name.startsWith("syntx_owner_list_kontext_")), false);
  } finally { await defaultClient.close(); await defaultServer.close(); }

  const composition = {
    uploadService: {
      async upload() { return UPLOAD; }, async invalidateAttempt() {}, async close() {}
    },
    generationService: {
      async generate() { return RESULT; }, async reconcile() { return RESULT; },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {}
    }
  };
  const ownerServer = createMcpServer(application, { ownerKontextImageReferences: composition });
  const ownerClient = new Client({ name: "kontext-owner-composition-client", version: "1.0.0" });
  await connect(ownerServer, ownerClient);
  try {
    const names = (await ownerClient.listTools()).tools.map((tool) => tool.name);
    assert.deepEqual(names.filter((name) => name.startsWith("syntx_upload_kontext_") ||
      name.startsWith("syntx_owner_generate_kontext_") || name.startsWith("syntx_owner_reconcile_kontext_") ||
      name.startsWith("syntx_owner_list_kontext_" )).sort(), [
      SYNTX_UPLOAD_KONTEXT_REFERENCE_IMAGE_TOOL_NAME,
      SYNTX_OWNER_GENERATE_KONTEXT_IMAGE_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_KONTEXT_IMAGE_TOOL_NAME,
      SYNTX_OWNER_LIST_KONTEXT_RECOVERIES_TOOL_NAME
    ].sort());
  } finally { await ownerClient.close(); await ownerServer.close(); }
  assert.throws(() => createMcpServer(application, {
    ownerKontextImageReferences: composition,
    ownerDurableGeneration: {} as NonNullable<CreateMcpServerOptions["ownerDurableGeneration"]>
  }), /OWNER_DURABLE_GENERATION_COMPOSITION_CONFLICT/u);
});
