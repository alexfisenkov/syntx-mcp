import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resolve } from "node:path";
import {
  OwnerMagnificUpscaleUploadService,
  type OwnerMagnificUpscaleUploadReceipt
} from "../src/application/owner-magnific-upscale-upload-service.js";
import {
  OwnerMagnificUpscaleGenerationService,
  OwnerMagnificUpscaleGenerationServiceError,
  type OwnerMagnificUpscaleGenerationResult,
  type OwnerMagnificUpscaleRecoveryListItem,
  type OwnerMagnificUpscaleUnknownDiagnostic
} from "../src/application/owner-magnific-upscale-generation-service.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import type { AuthBinding } from "../src/auth/types.js";
import { createDefaultApplication } from "../src/application/factory.js";
import {
  createMcpServer,
  type CreateMcpServerOptions,
  type OwnerMagnificUpscaleServiceComposition
} from "../src/mcp/server.js";
import {
  SYNTX_OWNER_GENERATE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_MAGNIFIC_UPSCALE_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME,
  SYNTX_UPLOAD_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME
} from "../src/mcp/owner-magnific-upscale-tools.js";

const ATTEMPT = "link_magnific_tools_test_attempt_000001";
const AUTH_BINDING = Object.freeze({ tenant_id: "magnific-tools-tenant", subject: "magnific-tools-subject" });
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolve(process.cwd(), "catalog")).discoveryCatalog;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const NOW = Date.now();
const IMAGE_HANDLE = "magnific_image_823e4567-e89b-12d3-a456-426614174000";
const RECOVERY_ID = "magnific_recovery_823e4567-e89b-12d3-a456-426614174001";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const PARAMETERS = Object.freeze({
  scale_factor: "2x", optimized_for: "films_n_photography", engine: "magnific_sparkle", creativity: 2, hdr: -3,
  resemblance: 4, fractality: 1, sharpen: 37, smart_grain: 28, ultra_detail: 61, flavor: "sublime"
} as const);
const DIAGNOSTIC: OwnerMagnificUpscaleUnknownDiagnostic = Object.freeze({
  phase: "GENERATION_POST", post_started: true, echo_ack_known: false,
  history_binding: "NONE", history_binding_reason: null,
  history_get_calls: 0, history_get_calls_saturated: false,
  inprogress_get_calls: 0, inprogress_get_calls_saturated: false,
  result_get_calls: 0, result_get_calls_saturated: false,
  result_status: "NOT_READ", result_reason: null
});

function linkedAttempt(attemptId: string) {
  return {
    attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const, status: "LINKED" as const,
    expires_at: new Date(NOW + 60 * 60_000).toISOString(), linked: true as const
  };
}

function uploadReceipt(variant: "creative" | "precision_v1" | "precision_v2"): OwnerMagnificUpscaleUploadReceipt {
  return {
    status: "accepted" as const,
    image_handle: IMAGE_HANDLE,
    variant,
    mime_type: "image/png" as const,
    size: 68,
    width: 1,
    height: 1,
    sha256: `sha256:${"a".repeat(64)}`,
    expires_in_seconds: 900 as const,
    metadata_confidence: "CONTAINER_METADATA_ONLY" as const
  };
}

function generationResult(variant: "creative" | "precision_v1" | "precision_v2"): OwnerMagnificUpscaleGenerationResult {
  return {
    status: "result_observed" as const,
    backend_acceptance: "unproven" as const,
    ai_name: "magnific" as const,
    model_id: variant,
    variant,
    operation_id: "upscale-image" as const,
    profile_id: "magnific-upscale-source-reviewed-v1" as const,
    profile_schema_hash: `sha256:${"b".repeat(64)}`,
    catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
    request_fingerprint: `sha256:${"c".repeat(64)}`,
    requested_scale_factor: "2x" as const,
    input_image: {
      mime_type: "image/png", width: 1, height: 1, size: 68,
      sha256: `sha256:${"a".repeat(64)}`, metadata_confidence: "CONTAINER_METADATA_ONLY" as const
    },
    expected_output_geometry: null,
    actual_image: { mime_type: "image/png", width: null, height: null },
    geometry_verified: false as const,
    artifact: { url: "https://r2.syntx.ai/generated/result.png", mime_type: "image/png", mime_source: "URL_EXTENSION" as const }
  };
}

function recoveryItem(variant: "creative" | "precision_v1" | "precision_v2"): OwnerMagnificUpscaleRecoveryListItem {
  return {
    recovery_id: RECOVERY_ID,
    created_at: new Date(NOW).toISOString(),
    model_id: variant,
    operation_id: "upscale-image" as const,
    status: "OUTCOME_UNKNOWN" as const,
    diagnostic: DIAGNOSTIC
  };
}

function serviceComposition(overrides: {
  upload?: (input: unknown) => Promise<OwnerMagnificUpscaleUploadReceipt>;
  generate?: (input: unknown) => Promise<OwnerMagnificUpscaleGenerationResult>;
  reconcile?: (input: unknown) => Promise<OwnerMagnificUpscaleGenerationResult>;
  listRecoveries?: (input: unknown) => Promise<readonly OwnerMagnificUpscaleRecoveryListItem[]>;
} = {}) {
  const uploadCalls: unknown[] = [];
  const generationCalls: Array<{ method: string; input: unknown }> = [];
  const owner: OwnerMagnificUpscaleServiceComposition = {
    uploadService: {
      async upload(input: unknown) { uploadCalls.push(input); return overrides.upload?.(input) ?? uploadReceipt((input as { variant: "creative" | "precision_v1" | "precision_v2" }).variant); },
      invalidateAttempt() {},
      async close() {}
    },
    generationService: {
      async generate(input: unknown) { generationCalls.push({ method: "generate", input }); return overrides.generate?.(input) ?? generationResult((input as { variant: "creative" | "precision_v1" | "precision_v2" }).variant); },
      async reconcile(input: unknown) { generationCalls.push({ method: "reconcile", input }); return overrides.reconcile?.(input) ?? generationResult("precision_v2"); },
      async listRecoveries(input: unknown) { generationCalls.push({ method: "listRecoveries", input }); return overrides.listRecoveries?.(input) ?? [recoveryItem("precision_v2")]; },
      async invalidateAttempt() {},
      async close() {}
    }
  };
  return { owner, uploadCalls, generationCalls };
}

async function withClient<T>(options: CreateMcpServerOptions, run: (client: Client) => Promise<T>): Promise<T> {
  const application = createDefaultApplication({ discoveryCatalog: CATALOG, runtimeCapabilities: null });
  const server = createMcpServer(application, options);
  const client = new Client({ name: "magnific-owner-tools-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await run(client); }
  finally { await client.close(); await server.close(); }
}

function generationInput(variant: string, overrides: Record<string, unknown> = {}) {
  return {
    link_attempt_id: ATTEMPT,
    variant,
    image_handle: IMAGE_HANDLE,
    parameters: PARAMETERS,
    ...overrides
  };
}

test("default MCP keeps Magnific tools absent; an explicit owner composition adds exactly the four dedicated tools", async () => {
  const defaultNames: string[] = await withClient({}, async (client) => (await client.listTools()).tools.map((tool) => tool.name));
  assert.equal(defaultNames.includes(SYNTX_UPLOAD_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME), false);
  assert.equal(defaultNames.includes(SYNTX_OWNER_GENERATE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME), false);
  const { owner } = serviceComposition();
  const names: string[] = await withClient({ ownerMagnificUpscale: owner }, async (client) => (await client.listTools()).tools.map((tool) => tool.name));
  const expected = [
    SYNTX_UPLOAD_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME,
    SYNTX_OWNER_GENERATE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME,
    SYNTX_OWNER_RECONCILE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME,
    SYNTX_OWNER_LIST_MAGNIFIC_UPSCALE_RECOVERIES_TOOL_NAME
  ];
  assert.deepEqual(names.filter((name) => expected.includes(name)), expected);
});

test("tools/list exposes all eleven explicit controls and the three closed model variants", async () => {
  const { owner } = serviceComposition();
  await withClient({ ownerMagnificUpscale: owner }, async (client) => {
    const tools = (await client.listTools()).tools;
    const upload = tools.find((tool) => tool.name === SYNTX_UPLOAD_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME)!;
    const generate = tools.find((tool) => tool.name === SYNTX_OWNER_GENERATE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME)!;
    const uploadSchema = upload.inputSchema as { properties: Record<string, { enum?: readonly string[]; description?: string }> };
    const generateSchema = generate.inputSchema as {
      properties: Record<string, {
        enum?: readonly string[];
        properties?: Record<string, { enum?: readonly string[] }>;
        description?: string;
      }>;
    };
    assert.deepEqual(uploadSchema.properties.variant?.enum, ["creative", "precision_v1", "precision_v2"]);
    assert.deepEqual(generateSchema.properties.variant?.enum, ["creative", "precision_v1", "precision_v2"]);
    assert.deepEqual(uploadSchema.properties.mime_type?.enum, ["image/jpeg", "image/png", "image/avif", "image/webp"]);
    assert.deepEqual(Object.keys(generateSchema.properties.parameters?.properties ?? {}).sort(), [
      "creativity", "engine", "flavor", "fractality", "hdr", "optimized_for", "resemblance", "scale_factor",
      "sharpen", "smart_grain", "ultra_detail"
    ]);
    assert.deepEqual(generateSchema.properties.parameters?.properties?.scale_factor?.enum, ["2x", "4x", "8x", "16x"]);
    assert.deepEqual(generateSchema.properties.parameters?.properties?.optimized_for?.enum, [
      "standard", "soft_portraits", "hard_portraits", "art_n_illustration", "videogame_assets",
      "nature_n_landscapes", "films_n_photography", "3d_renders", "science_fiction_n_horror"
    ]);
    assert.deepEqual(generateSchema.properties.parameters?.properties?.engine?.enum,
      ["automatic", "magnific_illusio", "magnific_sharpy", "magnific_sparkle"]);
    assert.deepEqual(generateSchema.properties.parameters?.properties?.flavor?.enum, ["sublime", "photo", "photo_denoiser"]);
    assert.match(generate.description ?? "", /full explicit state|all eleven/iu);
    assert.match(generateSchema.properties.variant?.description ?? "", /Magnific|Magnific/i);
    const reconcile = tools.find((tool) => tool.name === SYNTX_OWNER_RECONCILE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME)!;
    const list = tools.find((tool) => tool.name === SYNTX_OWNER_LIST_MAGNIFIC_UPSCALE_RECOVERIES_TOOL_NAME)!;
    for (const mutating of [upload, generate]) {
      assert.equal(mutating.annotations?.readOnlyHint, false);
      assert.equal(mutating.annotations?.destructiveHint, true);
      assert.equal(mutating.annotations?.idempotentHint, false);
      assert.equal(mutating.annotations?.openWorldHint, true);
    }
    assert.deepEqual(reconcile.annotations, {
      title: "Reconcile a Magnific upscale", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true
    });
    assert.deepEqual(list.annotations, {
      title: "List Magnific recovery handles", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
    });
  });
});

test("owner tools route upload, all three variant states, reconciliation, and recovery listing", async () => {
  const { owner, uploadCalls, generationCalls } = serviceComposition();
  await withClient({ ownerMagnificUpscale: owner }, async (client) => {
    const uploadTool = (await client.listTools()).tools.find((tool) => tool.name === SYNTX_UPLOAD_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME)!;
    const uploadSchema = uploadTool.inputSchema as { properties: Record<string, { maxLength?: number }> };
    assert.equal(uploadSchema.properties.content_base64?.maxLength, Math.ceil((10 * 1024 * 1024) / 3) * 4);
    for (const variant of ["creative", "precision_v1", "precision_v2"] as const) {
      const uploaded = await client.callTool({ name: SYNTX_UPLOAD_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments: {
        link_attempt_id: ATTEMPT, variant, content_base64: PNG, filename: "magnific.png", mime_type: "image/png"
      } });
      assert.equal(uploaded.isError, undefined);
      assert.equal((uploaded.structuredContent as { variant: string }).variant, variant);
      assert.equal((uploaded.structuredContent as { metadata_confidence: string }).metadata_confidence, "CONTAINER_METADATA_ONLY");
      assert.equal(JSON.stringify(uploaded).includes("r2.syntx.ai"), false);
      const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments:
        generationInput(variant, { prompt: "A bright red kite" })
      });
      assert.equal(generated.isError, undefined);
      assert.equal((generated.structuredContent as { variant: string }).variant, variant);
      assert.equal((generated.structuredContent as { expected_output_geometry: unknown }).expected_output_geometry, null);
      assert.equal((generated.structuredContent as { geometry_verified: boolean }).geometry_verified, false);
      assert.equal((generated.structuredContent as { artifact: { mime_source: string } }).artifact.mime_source, "URL_EXTENSION");
      assert.equal("mime_confidence" in (generated.structuredContent as Record<string, unknown>), false);
    }
    const reconciled = await client.callTool({ name: SYNTX_OWNER_RECONCILE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: RECOVERY_ID
    } });
    assert.equal(reconciled.isError, undefined);
    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_MAGNIFIC_UPSCALE_RECOVERIES_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT
    } });
    assert.equal(listed.isError, undefined);
    assert.equal((listed.structuredContent as { recoveries: readonly unknown[] }).recoveries.length, 1);
  });
  assert.equal(uploadCalls.length, 3);
  assert.deepEqual(uploadCalls.map((value) => (value as { variant: string }).variant), ["creative", "precision_v1", "precision_v2"]);
  assert.deepEqual(generationCalls.map((call) => call.method), ["generate", "generate", "generate", "reconcile", "listRecoveries"]);
  assert.deepEqual(generationCalls.slice(0, 3).map((call) => (call.input as { parameters: unknown }).parameters), [PARAMETERS, PARAMETERS, PARAMETERS]);
  assert.deepEqual(generationCalls.slice(0, 3).map((call) => (call.input as { variant: string }).variant),
    ["creative", "precision_v1", "precision_v2"]);
});

test("strict schemas reject partial/extra state, arbitrary model or URL fields, invalid base64 and oversized UTF-8 prompt before service", async () => {
  const { owner, uploadCalls, generationCalls } = serviceComposition();
  await withClient({ ownerMagnificUpscale: owner }, async (client) => {
    const full = { ...PARAMETERS };
    const missing = { ...full } as Record<string, unknown>;
    delete missing.flavor;
    const extra = { ...full, model_type: "creative" };
    for (const args of [
      generationInput("creative", { parameters: missing }),
      generationInput("creative", { parameters: extra }),
      generationInput("creative", { model_id: "creative" }),
      generationInput("creative", { url: "https://r2.syntx.ai/private.png" }),
      generationInput("creative", { parameters: { ...PARAMETERS, n: 1 } }),
      generationInput("creative", { prompt: "é".repeat(2_501) })
    ]) {
      assert.equal((await client.callTool({ name: SYNTX_OWNER_GENERATE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments: args })).isError, true);
    }
    for (const content_base64 of ["not base64", "AAAA\n"]) {
      assert.equal((await client.callTool({ name: SYNTX_UPLOAD_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments: {
        link_attempt_id: ATTEMPT, variant: "creative", content_base64, filename: "in.png", mime_type: "image/png"
      } })).isError, true);
    }
    const extraUpload = await client.callTool({ name: SYNTX_UPLOAD_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, variant: "creative", content_base64: PNG, filename: "in.png", mime_type: "image/png", path: "/tmp/in.png"
    } });
    assert.equal(extraUpload.isError, true);
  });
  assert.equal(uploadCalls.length, 0);
  assert.equal(generationCalls.length, 0);
});

test("errors redact raw exceptions and only expose a validated opaque unknown recovery handle plus closed diagnostic", async () => {
  const secret = "PRIVATE_TRACE_AND_SIGNED_PROVIDER_URL";
  const { owner } = serviceComposition({
    upload: async () => { throw new Error(secret); },
    generate: async () => { throw new OwnerMagnificUpscaleGenerationServiceError("OUTCOME_UNKNOWN", RECOVERY_ID, DIAGNOSTIC); },
    reconcile: async () => { throw new OwnerMagnificUpscaleGenerationServiceError("OUTCOME_UNKNOWN", "bad/recovery"); },
    listRecoveries: async () => { throw new Error(secret); }
  });
  await withClient({ ownerMagnificUpscale: owner }, async (client) => {
    const upload = await client.callTool({ name: SYNTX_UPLOAD_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, variant: "creative", content_base64: PNG, filename: "in.png", mime_type: "image/png"
    } });
    assert.equal(upload.isError, true);
    assert.equal(JSON.stringify(upload).includes(secret), false);

    const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments: generationInput("precision_v2") });
    const generationError = (generated.content as readonly { text?: string }[])[0]?.text ?? "";
    assert.equal(generated.isError, true);
    assert.equal(generationError.includes(RECOVERY_ID), true);
    assert.equal(generationError.includes(secret), false);
    assert.deepEqual(JSON.parse(generationError).error.diagnostic, DIAGNOSTIC);

    const reconciled = await client.callTool({ name: SYNTX_OWNER_RECONCILE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: RECOVERY_ID
    } });
    assert.equal(reconciled.isError, true);
    assert.equal(JSON.stringify(reconciled).includes("bad/recovery"), false);
    assert.equal(JSON.stringify(reconciled).includes(secret), false);

    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_MAGNIFIC_UPSCALE_RECOVERIES_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listed.isError, true);
    assert.equal(JSON.stringify(listed).includes(secret), false);
  });
});

test("Magnific service injection conflicts with durable mode and default server remains unchanged", () => {
  const { owner } = serviceComposition();
  const defaultOptions: CreateMcpServerOptions = {};
  assert.equal(defaultOptions.ownerMagnificUpscale, undefined);
  assert.throws(() => createMcpServer(createDefaultApplication({ discoveryCatalog: CATALOG, runtimeCapabilities: null }), {
    ownerMagnificUpscale: owner,
    ownerDurableGeneration: {} as NonNullable<CreateMcpServerOptions["ownerDurableGeneration"]>
  }), /OWNER_DURABLE_GENERATION_COMPOSITION_CONFLICT/u);
});

function createNativeServices(variant: "creative" | "precision_v1" | "precision_v2") {
  const fetchEvents: Array<{ method: string; path: string }> = [];
  const seenGenerateBodies: Array<Record<string, unknown>> = [];
  const chatUuid = "magnific-native-chat-001";
  const ownerEchoId = "20001";
  const botMessageId = "20002";
  const resultObjectId = "30021";
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-magnific-mcp-integration-credential");
    }
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    fetchEvents.push({ method, path: url.pathname });
    if (url.pathname === "/api/v1/chats/upload-files") {
      assert.equal(method, "POST");
      assert.ok(init?.body instanceof FormData);
      const file = init.body.get("files");
      assert.ok(file instanceof File);
      assert.equal(init.body.get("destination"), "uploaded");
      assert.equal(init.body.get("check_duplicates"), "true");
      assert.equal(init.body.get("model_type"), variant);
      return new Response(JSON.stringify({ files: [{ id: "native-input-file-1", url: "https://r2.syntx.ai/magnific/native-input.png",
        mime_type: "image/png", size: file.size }] }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    if (url.pathname === "/api/v1/chats") {
      assert.equal(method, "POST");
      assert.equal(JSON.parse(String(init?.body)).scope, "tool_image_upscaler");
      return new Response(JSON.stringify({ uuid: chatUuid }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/api/v1/design/generate") {
      assert.equal(method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      seenGenerateBodies.push(body);
      assert.equal(body.chat_uuid, chatUuid);
      if (variant === "creative") assert.equal(body.prompt, "native fakefetch upload to result");
      return new Response(JSON.stringify({ id: ownerEchoId }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === `/api/v1/chats/${chatUuid}/messages`) {
      assert.equal(method, "GET");
      assert.equal(url.searchParams.get("page"), "1");
      assert.equal(url.searchParams.get("page_size"), "10");
      return new Response(JSON.stringify({
        messages: [
          { id: ownerEchoId, chat_id: 76_543, author_id: 12, message_object: [
            { id: "30011", message_id: ownerEchoId, object_type: "image", model_type: null },
            { id: "30012", message_id: ownerEchoId, object_type: "text", model_type: variant }
          ] },
          { id: botMessageId, chat_id: 76_543, author_id: -1, message_object: [
            { id: resultObjectId, message_id: botMessageId, object_type: "image", model_type: variant }
          ] }
        ],
        pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === `/api/v1/chats/${chatUuid}/inprogress`) {
      assert.equal(method, "GET");
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === `/api/v1/chats/${chatUuid}/${botMessageId}`) {
      assert.equal(method, "GET");
      return new Response(JSON.stringify({
        id: botMessageId, chat_id: 76_543, author_id: -1,
        message_object: [{ id: resultObjectId, message_id: botMessageId, object_type: "image", model_type: variant,
          completed: true, object_url: "https://r2.syntx.ai/generated/magnific-native-result.png" }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected fakefetch path: ${url.pathname}`);
  };
  const linkService = {
    async getStatus(_binding: AuthBinding, attemptId: string) {
      return linkedAttempt(attemptId);
    }
  };
  const uploadService = new OwnerMagnificUpscaleUploadService({
    binding: AUTH_BINDING,
    linkService,
    catalog: CATALOG,
    catalogVersion: CATALOG_VERSION,
    now: () => NOW,
    resolveClient: () => new SyntxChatHttpClient({ credentialBroker, fetchImpl })
  });
  const generationService = new OwnerMagnificUpscaleGenerationService({
    binding: AUTH_BINDING,
    linkService,
    catalog: CATALOG,
    catalogVersion: CATALOG_VERSION,
    uploadService,
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker, fetchImpl }),
    preflight: async ({ variant }) => ({
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
        model_id: variant, ai_name: "magnific", model_type: variant, account_read_live: true,
        parameter_keys: ["height", "scale_factor", "width"], parameters_redacted: true,
        access: true, cost: 1.25, discount_cost: null, free_remaining_generations: null,
        limit: null, show_warning: false, observed_at: new Date(NOW).toISOString()
      }
    }),
    now: () => NOW,
    timeoutMs: 5_000,
    pollDelayMs: 0,
    maxPollAttempts: 3,
    wait: async () => {}
  });
  const composition: OwnerMagnificUpscaleServiceComposition = { uploadService, generationService };
  return { composition, fetchEvents, seenGenerateBodies, generationService };
}

test("native fakefetch MCP path uploads, validates full Magnific state, consumes one permit, GET-correlates, and returns honest geometry metadata", async () => {
  for (const variant of ["creative", "precision_v1", "precision_v2"] as const) {
    const native = createNativeServices(variant);
    await withClient({ ownerMagnificUpscale: native.composition }, async (client) => {
      const upload = await client.callTool({ name: SYNTX_UPLOAD_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments: {
        link_attempt_id: ATTEMPT, variant, content_base64: PNG, filename: "magnific-native.png", mime_type: "image/png"
      } });
      assert.equal(upload.isError, undefined, JSON.stringify({ upload, events: native.fetchEvents }));
      const imageHandle = (upload.structuredContent as { image_handle: string }).image_handle;
      assert.match(imageHandle, /^magnific_image_[0-9a-f-]{36}$/u);
      assert.equal(JSON.stringify(upload).includes("r2.syntx.ai"), false);

      const invalidParameters = variant === "precision_v1"
        ? { ...PARAMETERS, scale_factor: "4x" }
        : variant === "precision_v2"
          ? { ...PARAMETERS, scale_factor: "4x", flavor: "photo" }
          : PARAMETERS;
      const invalidPrompt = variant === "creative" ? { prompt: "bad\u0000prompt" } : {};
      if (variant !== "creative") {
        const rejected = await client.callTool({ name: SYNTX_OWNER_GENERATE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments: {
          link_attempt_id: ATTEMPT, variant, image_handle: imageHandle, parameters: invalidParameters
        } });
        assert.equal(rejected.isError, true);
      } else {
        const rejected = await client.callTool({ name: SYNTX_OWNER_GENERATE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments: {
          link_attempt_id: ATTEMPT, variant, image_handle: imageHandle, parameters: PARAMETERS, ...invalidPrompt
        } });
        assert.equal(rejected.isError, true);
      }
      assert.deepEqual(native.fetchEvents.map((event) => event.path), ["/api/v1/chats/upload-files"]);

      const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_MAGNIFIC_UPSCALE_IMAGE_TOOL_NAME, arguments: {
        link_attempt_id: ATTEMPT,
        variant,
        image_handle: imageHandle,
        prompt: "native fakefetch upload to result",
        parameters: PARAMETERS
      } });
      assert.equal(generated.isError, undefined, JSON.stringify(generated));
      const result = generated.structuredContent as Record<string, unknown>;
      assert.equal(result.backend_acceptance, "unproven");
      assert.equal(result.model_id, variant);
      assert.deepEqual(result.expected_output_geometry, null);
      assert.equal(result.geometry_verified, false);
      assert.equal((result.actual_image as { width: null }).width, null);
      assert.equal((result.artifact as { mime_source: string }).mime_source, "URL_EXTENSION");
      assert.deepEqual(native.seenGenerateBodies[0]?.settings, {
        n: 1, model_type: variant, width: 1, height: 1,
        ...PARAMETERS, file_urls: [{ type: "image", url: "https://r2.syntx.ai/magnific/native-input.png" }]
      });
      assert.deepEqual(native.fetchEvents.map((event) => event.method), ["POST", "POST", "POST", "GET", "GET"]);
      assert.deepEqual(native.fetchEvents.map((event) => event.path), [
        "/api/v1/chats/upload-files", "/api/v1/chats", "/api/v1/design/generate",
        "/api/v1/chats/magnific-native-chat-001/messages", "/api/v1/chats/magnific-native-chat-001/20002"
      ]);
    });
    await native.generationService.close();
  }
});
