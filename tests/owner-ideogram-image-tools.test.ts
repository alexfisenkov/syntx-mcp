import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { createDefaultApplication } from "../src/application/factory.js";
import {
  OWNER_IDEOGRAM_IMAGE_GENERATION_ERROR_CODES,
  OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS,
  OWNER_IDEOGRAM_IMAGE_GENERATION_PHASES,
  OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS,
  OwnerIdeogramImageGenerationServiceError,
  OwnerIdeogramImageGenerationService,
  type OwnerIdeogramImageGenerationPreflightInput,
  type OwnerIdeogramImageGenerationPreflightResult,
  type OwnerIdeogramImageGenerationDiagnostic,
  type OwnerIdeogramImageGenerationResult,
  type OwnerIdeogramImageRecoveryListItem
} from "../src/application/owner-ideogram-image-generation-service.js";
import { OWNER_IDEOGRAM_IMAGE_CONTEXTS, normalizeOwnerIdeogramImageParameters } from "../src/application/owner-ideogram-image-parameters.js";
import { OwnerIdeogramImageUploadService, type OwnerIdeogramImageUploadReceipt } from "../src/application/owner-ideogram-image-upload-service.js";
import { OwnerIdeogramImageMaskUploadService, type OwnerIdeogramImageMaskUploadReceipt } from "../src/application/owner-ideogram-image-mask-upload-service.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { createMcpServer, type OwnerIdeogramImageServiceComposition } from "../src/mcp/server.js";
import {
  OWNER_IDEOGRAM_IMAGE_TOOL_NAMES,
  registerSyntxOwnerIdeogramImageTools,
  SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_IDEOGRAM_IMAGE_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_IDEOGRAM_IMAGE_TOOL_NAME,
  SYNTX_UPLOAD_IDEOGRAM_IMAGE_REFERENCE_TOOL_NAME
} from "../src/mcp/owner-ideogram-image-tools.js";

const ATTEMPT = "link_ideogram_mcp_test_attempt_000001";
const HANDLE_A = "ideogram_image_823e4567-e89b-12d3-a456-426614174000";
const HANDLE_B = "ideogram_image_823e4567-e89b-12d3-a456-426614174001";
const RECOVERY = "ideogram_image_recovery_823e4567-e89b-12d3-a456-426614174002";
const HASH = `sha256:${"a".repeat(64)}` as `sha256:${string}`;
const BINDING = Object.freeze({ tenant_id: "ideogram-tools-tenant", subject: "ideogram-tools-owner" });
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
  resolve(process.cwd(), "catalog")).discoveryCatalog;
const DIAGNOSTIC: OwnerIdeogramImageGenerationDiagnostic = Object.freeze({
  phase: "GENERATION_POST", post_started: true, echo_ack_known: false,
  history_binding: "PENDING", history_binding_reason: null, history_get_calls: 0, history_get_calls_saturated: false,
  result_get_calls: 0, result_get_calls_saturated: false, result_status: "NOT_READ", result_reason: null
});

interface Case {
  readonly model_id: "ideogram" | "ideogram_40" | "ideogram_45";
  readonly mode: typeof OWNER_IDEOGRAM_IMAGE_CONTEXTS[number]["mode"];
  readonly prompt: string | null;
  readonly handles: readonly string[];
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly mask_handle?: string;
}

function cases(): readonly Case[] {
  return [
    { model_id: "ideogram", mode: "generate", prompt: "create a clean portrait", handles: [], parameters: {
      rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024", seed: null,
      color_palette: { kind: "custom", colors: [{ color_hex: "#aabbcc", color_weight: 37.5 }] }
    } },
    { model_id: "ideogram", mode: "remix", prompt: "remix this", handles: [HANDLE_A], parameters: {
      rendering_speed: "QUALITY", num_images: 2, aspect_ratio: "3:2", resolution: "1024x1024", image_weight: 72.5
    } },
    { model_id: "ideogram", mode: "reframe", prompt: null, handles: [HANDLE_A], parameters: {
      rendering_speed: "DEFAULT", num_images: 3, resolution: "896x1024"
    } },
    { model_id: "ideogram", mode: "replace_background", prompt: "replace the background", handles: [HANDLE_A], parameters: {
      rendering_speed: "TURBO", num_images: 4, seed: null, color_palette: { kind: "preset", name: "warm" }
    } },
    { model_id: "ideogram", mode: "character_reference", prompt: "keep the character", handles: [HANDLE_A], parameters: {
      rendering_speed: "DEFAULT", num_images: 5, aspect_ratio: "1:1", resolution: "1024x1024", style_type: "REALISTIC"
    } },
    { model_id: "ideogram_40", mode: "generate", prompt: "modern scene", handles: [], parameters: {
      rendering_speed: "TURBO", num_images: 6, aspect_ratio: "1:2", resolution: "2K", seed: 42, magic_prompt: "AUTO"
    } },
    { model_id: "ideogram_40", mode: "generate", prompt: "use the reference", handles: [HANDLE_A], parameters: {
      rendering_speed: "TURBO", num_images: 2, aspect_ratio: null, resolution: "1K", image_weight_auto: false, image_weight: 37.5
    } },
    { model_id: "ideogram_40", mode: "transparent", prompt: "transparent logo", handles: [], parameters: {
      rendering_speed: "QUALITY", num_images: 7, aspect_ratio: "16:9", resolution: "4K", magic_prompt: "OFF"
    } },
    { model_id: "ideogram_45", mode: "generate", prompt: "fast source image", handles: [HANDLE_A], parameters: {
      rendering_speed: "FLASH", num_images: 8, aspect_ratio: "1:1", resolution: "2K", magic_prompt: null
    } },
    { model_id: "ideogram_45", mode: "precise_edit", prompt: "edit the source", handles: [HANDLE_A, HANDLE_B], parameters: {
      rendering_speed: "DEFAULT", num_images: 2, seed: null
    } }
  ];
}

function generationResult(input: Case): OwnerIdeogramImageGenerationResult {
  return Object.freeze({ status: "result_observed", namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN",
    mode_confidence: "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO", ai_name: "ideogram", model_id: input.model_id, mode: input.mode,
    operation_id: "generate-image", profile_id: "ideogram-image-source-profile-v1", profile_schema_hash: HASH,
    catalog_version: "catalog-v1", reference_count: input.handles.length, mask_present: input.mask_handle !== undefined,
    mask_acceptance: input.mask_handle === undefined ? "NOT_REQUESTED" : "UNPROVEN", output_count: input.parameters.num_images as number,
    cost_input_confidence: "SOURCE_CALLBACK_INPUTS_ONLY_PRICE_AND_BILLING_UNPROVEN",
    artifacts: Array.from({ length: input.parameters.num_images as number }, (_, index) => Object.freeze({
      url: `https://r2.syntx.ai/ideogram/result-${index + 1}.png`, mime_type: "image/png", mime_source: "URL_EXTENSION",
      width: null, height: null, geometry_verified: false as const
    })) });
}

function caseFromGenerateInput(input: unknown): Case {
  const value = input as { model_id: Case["model_id"]; mode: Case["mode"]; prompt: string | null;
    reference_handles: readonly string[]; parameters: Readonly<Record<string, unknown>>; mask_handle?: string };
  return { model_id: value.model_id, mode: value.mode, prompt: value.prompt, handles: value.reference_handles,
    parameters: value.parameters, ...(value.mask_handle === undefined ? {} : { mask_handle: value.mask_handle }) };
}

const UPLOAD_RECEIPT: OwnerIdeogramImageUploadReceipt = Object.freeze({
  status: "uploaded", reference_handle: HANDLE_A, model_id: "ideogram_40", mode: "generate",
  original_mime_type: "image/png", mime_type: "image/png", width: 640, height: 480, size: 128,
  sha256: HASH, expires_in_seconds: 899, metadata_confidence: "CONTAINER_METADATA_ONLY",
  validation_scope: "LOCAL_INPUT_VALIDATION_ONLY_NOT_PROVIDER_ACCEPTANCE"
});
const MASK_HANDLE = "ideogram_mask_823e4567-e89b-12d3-a456-426614174003";
const MASK_UPLOAD_RECEIPT: OwnerIdeogramImageMaskUploadReceipt = Object.freeze({ status: "uploaded", mask_handle: MASK_HANDLE,
  width: 640, height: 480, pair_sha256: HASH, expires_in_seconds: 899,
  confidence_scope: "LOCAL_MASK_BYTES_ONLY_NOT_PROVIDER_ACCEPTANCE" });

function composition(overrides: Record<string, unknown> = {}): OwnerIdeogramImageServiceComposition {
  return {
    uploadService: { async upload() { return UPLOAD_RECEIPT; }, async invalidateAttempt() {}, async close() {} },
    maskUploadService: { async upload() { return MASK_UPLOAD_RECEIPT; }, async invalidateAttempt() {}, async close() {} },
    generationService: {
      async generate(input: unknown) {
        const value = caseFromGenerateInput(input);
        normalizeOwnerIdeogramImageParameters({ model_id: value.model_id, mode: value.mode,
          reference_count: value.handles.length, mask_present: value.mask_handle !== undefined, prompt: value.prompt, parameters: value.parameters });
        return generationResult(value);
      },
      async reconcile() { return generationResult(cases()[0]!); },
      async listRecoveries() { return []; },
      async invalidateAttempt() {}, async close() {}
    },
    ...overrides
  } as unknown as OwnerIdeogramImageServiceComposition;
}

function actualPreflight(input: Readonly<OwnerIdeogramImageGenerationPreflightInput>, now: number): OwnerIdeogramImageGenerationPreflightResult {
  return {
    account: { balance: { unit: "tokens", available: null }, subscription: { active: true, plan_type: "FREE", end_date: null, end_date_kind: null },
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE, source_build: ACCOUNT_SOURCE_BUILD, observed_at: new Date(now).toISOString() },
    model_access: { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
      model_id: input.model_id, ai_name: "ideogram", model_type: input.model_id, account_read_live: true,
      parameter_keys: Object.keys(input.cost_inputs).sort(), parameters_redacted: true, access: true, cost: 7.25,
      discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString() }
  };
}

async function connected(server: McpServer): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: "owner-ideogram-image-tools-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

function nestedObjects(value: unknown, visit: (object: Record<string, unknown>, path: string) => void, path = "$" ): void {
  if (Array.isArray(value)) { value.forEach((item, index) => nestedObjects(item, visit, `${path}[${index}]`)); return; }
  if (!value || typeof value !== "object") return;
  visit(value as Record<string, unknown>, path);
  for (const [key, nested] of Object.entries(value)) nestedObjects(nested, visit, `${path}.${key}`);
}

function textContents(value: unknown): string[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { content?: unknown }).content)) return [];
  return ((value as { content: unknown[] }).content).flatMap((part) =>
    part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"
      ? [(part as { text: string }).text] : []);
}

test("Ideogram MCP tools are absent by default and appear only with the explicit composition", async () => {
  const application = createDefaultApplication();
  assert.throws(() => createMcpServer(application, { ownerDurableGeneration: {} as never,
    ownerIdeogramImageReferences: composition() }), /OWNER_DURABLE_GENERATION_COMPOSITION_CONFLICT/u);
  const defaultServer = createMcpServer(application);
  const defaults = await connected(defaultServer);
  try {
    const listed = await defaults.client.listTools();
    assert.equal(listed.tools.some((tool) => OWNER_IDEOGRAM_IMAGE_TOOL_NAMES.includes(tool.name as never)), false);
  } finally { await defaults.close(); }

  const legacyServer = new McpServer({ name: "owner-ideogram-four-tool-compatibility", version: "1" });
  registerSyntxOwnerIdeogramImageTools(legacyServer, composition({ maskUploadService: undefined }));
  const legacy = await connected(legacyServer);
  try {
    const names = (await legacy.client.listTools()).tools.map((tool) => tool.name)
      .filter((name) => OWNER_IDEOGRAM_IMAGE_TOOL_NAMES.includes(name as never));
    assert.deepEqual(names, OWNER_IDEOGRAM_IMAGE_TOOL_NAMES.filter((name) => String(name) !== "syntx_upload_ideogram_mask"));
  } finally { await legacy.close(); }

  const server = createMcpServer(application, { ownerIdeogramImageReferences: composition() });
  const linked = await connected(server);
  try {
    const listed = await linked.client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).filter((name) => OWNER_IDEOGRAM_IMAGE_TOOL_NAMES.includes(name as never)),
      [...OWNER_IDEOGRAM_IMAGE_TOOL_NAMES]);
    const generation = listed.tools.find((tool) => tool.name === SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME)!;
    const upload = listed.tools.find((tool) => tool.name === SYNTX_UPLOAD_IDEOGRAM_IMAGE_REFERENCE_TOOL_NAME)!;
    const generationInput = generation.inputSchema as { properties?: Record<string, unknown> };
    const uploadInput = upload.inputSchema as { properties?: Record<string, unknown> };
    const generationContext = generationInput.properties?.context as { anyOf?: readonly unknown[]; oneOf?: readonly unknown[] };
    const uploadContext = uploadInput.properties?.context as { anyOf?: readonly unknown[]; oneOf?: readonly unknown[] };
    assert.equal((generationContext.anyOf ?? generationContext.oneOf)?.length, 9);
    assert.equal((uploadContext.anyOf ?? uploadContext.oneOf)?.length, 8);
    for (const tool of listed.tools.filter((candidate) => OWNER_IDEOGRAM_IMAGE_TOOL_NAMES.includes(candidate.name as never))) {
      nestedObjects(tool.inputSchema, (object, path) => { if (object.type === "object") assert.equal(object.additionalProperties, false, `input ${tool.name} ${path}: ${JSON.stringify(object)}`); });
      nestedObjects(tool.outputSchema, (object, path) => { if (object.type === "object") assert.equal(object.additionalProperties, false, `output ${tool.name} ${path}: ${JSON.stringify(object)}`); });
    }
  } finally { await linked.close(); }
});

test("mask upload is a separate optional strict tool with a fixed base handle and a redacted receipt", async () => {
  const calls: unknown[] = [];
  const maskService = { async upload(input: unknown) { calls.push(input); return MASK_UPLOAD_RECEIPT; },
    async invalidateAttempt() {}, async close() {} };
  const server = new McpServer({ name: "owner-ideogram-mask-tool-tests", version: "1" });
  registerSyntxOwnerIdeogramImageTools(server, composition({ maskUploadService: maskService }));
  const linked = await connected(server);
  try {
    const listed = await linked.client.listTools();
    const maskTool = listed.tools.find((tool) => tool.name === "syntx_upload_ideogram_mask");
    assert.ok(maskTool);
    nestedObjects(maskTool.inputSchema, (object) => { if (object.type === "object") assert.equal(object.additionalProperties, false); });
    nestedObjects(maskTool.outputSchema, (object) => { if (object.type === "object") assert.equal(object.additionalProperties, false); });
    const inputSchema = maskTool.inputSchema as { properties?: Record<string, unknown>; required?: readonly string[] };
    assert.deepEqual(Object.keys(inputSchema.properties ?? {}).sort(), ["base_reference_handle", "link_attempt_id", "painted_rgba_png_base64"].sort());
    assert.deepEqual([...(inputSchema.required ?? [])].sort(), ["base_reference_handle", "link_attempt_id", "painted_rgba_png_base64"].sort());
    const maskInput = { link_attempt_id: ATTEMPT, base_reference_handle: HANDLE_A, painted_rgba_png_base64: "AAAA" };
    const result = await linked.client.callTool({ name: maskTool.name, arguments: maskInput });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, MASK_UPLOAD_RECEIPT);
    const serviceInput = calls[0] as Record<string, unknown>;
    assert.equal(serviceInput.attemptId, ATTEMPT);
    assert.equal(serviceInput.base_reference_handle, HANDLE_A);
    assert.equal(serviceInput.painted_rgba_png_base64, "AAAA");
    assert.equal(serviceInput.signal instanceof AbortSignal, true);
    for (const key of ["mask_present", "model_id", "mime_type", "filename", "role", "polarity", "url"]) {
      assert.equal(Object.hasOwn(serviceInput, key), false);
    }
    for (const key of ["base_reference_handle", "normal_url", "inverse_url", "url", "file_id"]) {
      assert.equal(Object.hasOwn(result.structuredContent ?? {}, key), false);
    }
    assert.equal(JSON.stringify(result.structuredContent).includes("https://"), false);

    for (const extra of [
      { mask_present: true }, { mime_type: "image/png" }, { filename: "mask.png" }, { role: "mask" }, { polarity: false }, { url: "https://r2.syntx.ai/x" }
    ]) {
      const rejected = await linked.client.callTool({ name: maskTool.name, arguments: { ...maskInput, ...extra } });
      assert.equal(rejected.isError, true);
    }
    assert.equal(calls.length, 1);
  } finally { await linked.close(); }
});

test("MCP generation accepts all source mode contexts and forwards explicit values without defaults", async () => {
  const generated: unknown[] = [];
  const serviceFailures: string[] = [];
  const services = composition({ generationService: {
    async generate(input: unknown) {
      generated.push(input);
      const value = caseFromGenerateInput(input);
      try {
        normalizeOwnerIdeogramImageParameters({ model_id: value.model_id, mode: value.mode,
          reference_count: value.handles.length, mask_present: value.mask_handle !== undefined, prompt: value.prompt, parameters: value.parameters });
        return generationResult(value);
      } catch (error) { serviceFailures.push(error instanceof Error ? `${error.name}:${error.message}` : String(error)); throw error; }
    }, async reconcile() { return generationResult(cases()[0]!); }, async listRecoveries() { return []; },
    async invalidateAttempt() {}, async close() {}
  } });
  const server = new McpServer({ name: "owner-ideogram-generation-tests", version: "1" });
  registerSyntxOwnerIdeogramImageTools(server, services);
  const linked = await connected(server);
  try {
    const entries = cases();
    for (const item of entries) {
      const result = await linked.client.callTool({ name: SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME,
        arguments: { link_attempt_id: ATTEMPT, context: { model_id: item.model_id, mode: item.mode },
          prompt: item.prompt, reference_handles: item.handles, parameters: item.parameters } });
      assert.equal(result.isError, undefined, `${item.model_id}/${item.mode}/${item.handles.length}: ${JSON.stringify(result.structuredContent)} ${JSON.stringify(textContents(result))} calls=${generated.length} service=${serviceFailures.at(-1) ?? "none"}`);
      const structured = result.structuredContent as Record<string, unknown> | undefined;
      assert.equal(structured?.model_id, item.model_id);
      assert.equal(structured?.mode, item.mode);
    }
    assert.equal(generated.length, entries.length);
    for (let index = 0; index < entries.length; index += 1) {
      const expected = entries[index]!;
      const actual = generated[index] as Record<string, unknown>;
      assert.equal(actual.attemptId, ATTEMPT);
      assert.equal(actual.model_id, expected.model_id);
      assert.equal(actual.mode, expected.mode);
      assert.equal(actual.prompt, expected.prompt);
      assert.deepEqual(actual.reference_handles, expected.handles);
      assert.deepEqual(actual.parameters, expected.parameters);
      assert.equal(Object.hasOwn(actual, "model_type"), false);
      assert.equal(Object.hasOwn(actual, "n"), false);
    }
  } finally { await linked.close(); }
});

test("generation accepts only a private mask handle in precise edit, preserves ordinary reference count, and labels acceptance unproven", async () => {
  const forwarded: unknown[] = [];
  const server = new McpServer({ name: "owner-ideogram-masked-generation-tests", version: "1" });
  registerSyntxOwnerIdeogramImageTools(server, composition({ generationService: {
    async generate(input: unknown) {
      forwarded.push(input);
      const value = caseFromGenerateInput(input);
      normalizeOwnerIdeogramImageParameters({ model_id: value.model_id, mode: value.mode,
        reference_count: value.handles.length, mask_present: value.mask_handle !== undefined,
        prompt: value.prompt, parameters: value.parameters });
      return generationResult(value);
    }, async reconcile() { return generationResult({ ...cases()[9]!, mask_handle: MASK_HANDLE }); },
    async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {}
  } }));
  const linked = await connected(server);
  try {
    const validArgs = { link_attempt_id: ATTEMPT, context: { model_id: "ideogram_45", mode: "precise_edit" },
      prompt: "edit only this source", reference_handles: [HANDLE_A], mask_handle: MASK_HANDLE,
      parameters: { rendering_speed: "DEFAULT", num_images: 2 } };
    const result = await linked.client.callTool({ name: SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME, arguments: validArgs });
    assert.equal(result.isError, undefined);
    const output = result.structuredContent as Record<string, unknown>;
    assert.equal(output.mask_present, true);
    assert.equal(output.mask_acceptance, "UNPROVEN");
    assert.equal(output.reference_count, 1);
    const forwardedInput = forwarded[0] as Record<string, unknown>;
    assert.deepEqual(forwardedInput.reference_handles, [HANDLE_A]);
    assert.equal(forwardedInput.mask_handle, MASK_HANDLE);
    assert.equal(Object.hasOwn(forwardedInput, "mask_present"), false);
    assert.equal(Object.hasOwn(forwardedInput, "mask_url"), false);
    assert.equal(JSON.stringify(output).includes(MASK_HANDLE), false);
    assert.equal(JSON.stringify(output).includes("normal_url"), false);
    assert.equal(JSON.stringify(output).includes("inverse_url"), false);

    const invalid = [
      { ...validArgs, context: { model_id: "ideogram_45", mode: "generate" } },
      { ...validArgs, reference_handles: [] },
      { ...validArgs, reference_handles: [HANDLE_A, HANDLE_B, HANDLE_A] },
      { ...validArgs, reference_handles: [HANDLE_A, HANDLE_B, HANDLE_A, HANDLE_B, HANDLE_A] },
      { ...validArgs, mask_handle: HANDLE_A },
      { ...validArgs, mask_present: true },
      { ...validArgs, mask_url: "https://r2.syntx.ai/private/mask" }
    ];
    for (const arguments_ of invalid) {
      const rejected = await linked.client.callTool({ name: SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME, arguments: arguments_ });
      assert.equal(rejected.isError, true);
    }
    assert.equal(forwarded.length, 1);
  } finally { await linked.close(); }
});

test("MCP generation rejects invalid cardinality and every unsafe mode-conditional control before service", async () => {
  let calls = 0;
  const server = new McpServer({ name: "owner-ideogram-negative-tests", version: "1" });
  registerSyntxOwnerIdeogramImageTools(server, composition({ generationService: {
    async generate() { calls += 1; return generationResult(cases()[0]!); },
    async reconcile() { return generationResult(cases()[0]!); }, async listRecoveries() { return []; },
    async invalidateAttempt() {}, async close() {}
  } }));
  const linked = await connected(server);
  try {
    const base = cases()[0]!;
    const invalidInputs = [
      { ...base, handles: [HANDLE_A] },
      { ...cases()[6]!, parameters: { ...cases()[6]!.parameters, magic_prompt: "AUTO" } },
      { ...cases()[6]!, parameters: { ...cases()[6]!.parameters, seed: 42 } },
      { ...cases()[6]!, parameters: { ...cases()[6]!.parameters, image_weight_auto: true, image_weight: 37.5 } },
      { ...cases()[6]!, parameters: { ...cases()[6]!.parameters, aspect_ratio: "1:1" } },
      { ...cases()[8]!, handles: [], parameters: { ...cases()[8]!.parameters, rendering_speed: "FLASH" } },
      { ...cases()[8]!, parameters: { ...cases()[8]!.parameters, num_images: 9 } },
      { ...cases()[8]!, parameters: { ...cases()[8]!.parameters, aspect_ratio: "1:3", resolution: "1K" } },
      { ...cases()[9]!, handles: [HANDLE_A, HANDLE_A] },
      { ...cases()[2]!, prompt: "not-null" },
      { ...cases()[1]!, parameters: { ...cases()[1]!.parameters, n: 1 } },
      { ...cases()[0]!, parameters: { ...cases()[0]!.parameters, color_palette: { kind: "custom", colors: [] } } }
    ];
    for (const item of invalidInputs) {
      const result = await linked.client.callTool({ name: SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME,
        arguments: { link_attempt_id: ATTEMPT, context: { model_id: item.model_id, mode: item.mode },
          prompt: item.prompt, reference_handles: item.handles, parameters: item.parameters } });
      assert.equal(result.isError, true);
    }
    const mismatchedPair = await linked.client.callTool({ name: SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, context: { model_id: "ideogram_40", mode: "remix" }, prompt: "no pair",
        reference_handles: [HANDLE_A], parameters: { rendering_speed: "TURBO", num_images: 1 } } });
    assert.equal(mismatchedPair.isError, true);
    assert.equal(calls, 0);
  } finally { await linked.close(); }
});

test("upload and read-only recovery tools pass exact DTOs and never expose private upload details", async () => {
  const uploadCalls: unknown[] = [];
  const generationCalls: string[] = [];
  const service = composition({
    uploadService: { async upload(input: unknown) { uploadCalls.push(input); return UPLOAD_RECEIPT; }, async invalidateAttempt() {}, async close() {} },
    generationService: {
      async generate() { return generationResult(cases()[0]!); },
      async reconcile(input: unknown) { generationCalls.push("reconcile"); assert.deepEqual(input, { attemptId: ATTEMPT, recovery_id: RECOVERY }); return generationResult(cases()[0]!); },
      async listRecoveries(input: unknown) { generationCalls.push("list"); assert.deepEqual(input, { attemptId: ATTEMPT, limit: 5 });
        return [{ recovery_id: RECOVERY, created_at: "2026-10-11T00:00:00.000Z", model_id: "ideogram_45", mode: "precise_edit",
          status: "OUTCOME_UNKNOWN", mask_present: false, mask_acceptance: "NOT_REQUESTED",
          diagnostic: DIAGNOSTIC } satisfies OwnerIdeogramImageRecoveryListItem]; },
      async invalidateAttempt() {}, async close() {}
    }
  });
  const server = new McpServer({ name: "owner-ideogram-metadata-tests", version: "1" });
  registerSyntxOwnerIdeogramImageTools(server, service);
  const linked = await connected(server);
  try {
    const upload = await linked.client.callTool({ name: SYNTX_UPLOAD_IDEOGRAM_IMAGE_REFERENCE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, context: { model_id: "ideogram_40", mode: "generate" }, content_base64: "AAAA",
        filename: "source.png", mime_type: "image/png" } });
    assert.equal(upload.isError, undefined);
    const uploadServiceInput = uploadCalls[0] as Record<string, unknown>;
    assert.equal(uploadServiceInput.attemptId, ATTEMPT);
    assert.equal(uploadServiceInput.model_id, "ideogram_40");
    assert.equal(uploadServiceInput.mode, "generate");
    assert.equal(uploadServiceInput.content_base64, "AAAA");
    assert.equal(uploadServiceInput.filename, "source.png");
    assert.equal(uploadServiceInput.mime_type, "image/png");
    assert.equal(uploadServiceInput.signal instanceof AbortSignal, true);
    const uploadDto = upload.structuredContent as Record<string, unknown> | undefined;
    assert.equal(Object.hasOwn(uploadDto ?? {}, "file_id"), false);
    assert.equal(Object.hasOwn(uploadDto ?? {}, "url"), false);

    const reconcile = await linked.client.callTool({ name: SYNTX_OWNER_RECONCILE_IDEOGRAM_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, recovery_id: RECOVERY } });
    const list = await linked.client.callTool({ name: SYNTX_OWNER_LIST_IDEOGRAM_IMAGE_RECOVERIES_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, limit: 5 } });
    assert.equal(reconcile.isError, undefined);
    assert.equal(list.isError, undefined);
    assert.deepEqual(generationCalls, ["reconcile", "list"]);
    assert.equal(JSON.stringify(list.structuredContent).includes("https://"), false);

    const invalidUpload = await linked.client.callTool({ name: SYNTX_UPLOAD_IDEOGRAM_IMAGE_REFERENCE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, context: { model_id: "ideogram_40", mode: "transparent" }, content_base64: "AAAA",
        filename: "source.png", mime_type: "image/png" } });
    assert.equal(invalidUpload.isError, true);
    assert.equal(uploadCalls.length, 1);
    for (const badUpload of [
      { context: { model_id: "ideogram_40", mode: "generate" }, content_base64: "AAAA", mime_type: "image/avif" },
      { context: { model_id: "ideogram_40", mode: "transparent" }, content_base64: "AAAA", mime_type: "image/png" },
      { context: { model_id: "ideogram_40", mode: "generate" }, content_base64: "bad base64", mime_type: "image/png" },
      { context: { model_id: "ideogram_40", mode: "generate" }, content_base64: "AB==", mime_type: "image/png" }
    ]) {
      const rejected = await linked.client.callTool({ name: SYNTX_UPLOAD_IDEOGRAM_IMAGE_REFERENCE_TOOL_NAME,
        arguments: { link_attempt_id: ATTEMPT, filename: "source.png", ...badUpload } });
      assert.equal(rejected.isError, true);
    }
    assert.equal(uploadCalls.length, 1);
  } finally { await linked.close(); }
});

test("unknown POST errors return only typed recovery/diagnostic fields and never raw exception text", async () => {
  const server = new McpServer({ name: "owner-ideogram-safe-errors", version: "1" });
  registerSyntxOwnerIdeogramImageTools(server, composition({ generationService: {
    async generate() { throw new OwnerIdeogramImageGenerationServiceError("OUTCOME_UNKNOWN", RECOVERY, DIAGNOSTIC); },
    async reconcile() { throw new Error("private-chat-secret-should-not-escape"); }, async listRecoveries() { throw new Error("private-list-secret"); },
    async invalidateAttempt() {}, async close() {}
  } }));
  const linked = await connected(server);
  try {
    const item = cases()[0]!;
    const unknown = await linked.client.callTool({ name: SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, context: { model_id: item.model_id, mode: item.mode }, prompt: item.prompt,
        reference_handles: item.handles, parameters: item.parameters } });
    assert.equal(unknown.isError, true);
    assert.equal(textContents(unknown).some((text) => text.includes("private-chat-secret")), false);
    assert.equal(JSON.parse(textContents(unknown)[0]!).error.recovery_id, RECOVERY);
    const reconcile = await linked.client.callTool({ name: SYNTX_OWNER_RECONCILE_IDEOGRAM_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, recovery_id: RECOVERY } });
    assert.equal(reconcile.isError, true);
    assert.equal(textContents(reconcile).some((text) => text.includes("private-chat-secret")), false);
  } finally { await linked.close(); }
});

test("actual upload and generation services pass through MCP with synthetic transport only", async () => {
  const now = Date.now();
  const counts = { uploads: 0, chats: 0, posts: 0, histories: 0, results: 0, preflights: 0 };
  const byChat = new Map<string, Readonly<{ ackId: string; botMessageId: string; modelType: string; outputCount: number }>>();
  const uploadedParts: Array<Readonly<{ destination: string; modelType: string; filename: string; mimeType: string; url: string }>> = [];
  let loseMaskedPostAck = true;
  let postSettings: Record<string, unknown> | undefined;
  const routePaths: string[] = [];
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-owner-service-test-credential");
    }
  };
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    routePaths.push(url.pathname);
    if (url.pathname === "/api/v1/chats/upload-files") {
      counts.uploads += 1;
      const form = init?.body as FormData;
      const file = form.get("files");
      assert.ok(file instanceof Blob);
      const urlValue = `https://r2.syntx.ai/private/ideogram/native-${counts.uploads}.png`;
      uploadedParts.push(Object.freeze({ destination: String(form.get("destination")), modelType: String(form.get("model_type")),
        filename: file.name, mimeType: file.type, url: urlValue }));
      return Response.json({ files: [{ id: `ideogram-upload-private-id-${counts.uploads}`, url: urlValue, mime_type: file.type, size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats") {
      counts.chats += 1;
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { title: "owner-ideogram-image", scope: "image" });
      return Response.json({ uuid: `ideogram-sdk-chat-${counts.chats}` });
    }
    if (url.pathname === "/api/v1/design/generate") {
      counts.posts += 1;
      assert.equal(url.searchParams.get("ai_name"), "ideogram");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as { chat_uuid: string; settings: Record<string, unknown>; prompt: string };
      postSettings = body.settings;
      assert.equal(typeof body.prompt, "string");
      const ackId = `${body.chat_uuid}-owner-ack`;
      const botMessageId = `${body.chat_uuid}-bot-result`;
      byChat.set(body.chat_uuid, { ackId, botMessageId, modelType: String(body.settings.model_type),
        outputCount: Number(body.settings.num_images) });
      const fileUrls = body.settings.file_urls as Array<{ type: string; url: string }>;
      if (loseMaskedPostAck && fileUrls.some((file) => file.type === "mask")) {
        loseMaskedPostAck = false;
        throw new TypeError("synthetic mask POST acknowledgement was lost");
      }
      return Response.json({ id: ackId });
    }
    if (/^\/api\/v1\/chats\/ideogram-sdk-chat-\d+\/messages$/u.test(url.pathname)) {
      counts.histories += 1;
      assert.equal(init?.method, "GET");
      const chatId = url.pathname.split("/")[4]!;
      const current = byChat.get(chatId); assert.ok(current);
      const { ackId, botMessageId, modelType, outputCount } = current;
      const resultObjects = Array.from({ length: outputCount }, (_, index) => ({ id: `${chatId}-object-${index + 1}`,
        message_id: botMessageId, object_type: "image", model_type: modelType }));
      const messages = [
        { id: ackId, chat_id: 7101, author_id: 100, message_object: [{ id: "ideogram-sdk-owner-text", message_id: ackId,
          object_type: "text", model_type: modelType }] },
        { id: botMessageId, chat_id: 7101, author_id: -1, message_object: resultObjects }
      ];
      return Response.json({ messages, pagination: { page: 1, page_size: 10, total_count: 2,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    if (/^\/api\/v1\/chats\/ideogram-sdk-chat-\d+\/ideogram-sdk-chat-\d+-bot-result$/u.test(url.pathname)) {
      counts.results += 1;
      assert.equal(init?.method, "GET");
      const chatId = url.pathname.split("/")[4]!;
      const current = byChat.get(chatId); assert.ok(current);
      const { botMessageId, modelType, outputCount } = current;
      return Response.json({ id: botMessageId, chat_id: 7101, author_id: -1, message_object: Array.from({ length: outputCount }, (_, index) => ({
        id: `${chatId}-object-${index + 1}`, message_id: botMessageId, object_type: "image", model_type: modelType, completed: true,
        object_url: `https://r2.syntx.ai/ideogram/${chatId}-result-${index + 1}.png`
      })) });
    }
    throw new Error("unexpected synthetic transport route");
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const, status: "LINKED" as const,
      expires_at: new Date(now + 60 * 60_000).toISOString(), linked: true as const };
  } };
  const uploadService = new OwnerIdeogramImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const maskUploadService = new OwnerIdeogramImageMaskUploadService({ baseUploadService: uploadService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const generationService = new OwnerIdeogramImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, maskUploadService, resolveChatClient: () => client,
    preflight: async (input: Readonly<OwnerIdeogramImageGenerationPreflightInput>) => { counts.preflights += 1; return actualPreflight(input, now); },
    now: () => now, pollDelayMs: 0, maxPollAttempts: 2, wait: async () => undefined });
  const server = new McpServer({ name: "owner-ideogram-real-services-test", version: "1" });
  registerSyntxOwnerIdeogramImageTools(server, { uploadService, maskUploadService, generationService });
  const linked = await connected(server);
  try {
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
    const upload = await linked.client.callTool({ name: SYNTX_UPLOAD_IDEOGRAM_IMAGE_REFERENCE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, context: { model_id: "ideogram_45", mode: "generate" },
        content_base64: pngBase64, filename: "owned-source.png", mime_type: "image/png" } });
    assert.equal(upload.isError, undefined, JSON.stringify(textContents(upload)));
    const uploadResult = upload.structuredContent as Record<string, unknown>;
    const handle = uploadResult.reference_handle as string;
    assert.match(handle, /^ideogram_image_[0-9a-f-]{36}$/u);
    assert.equal(Object.hasOwn(uploadResult, "url"), false);
    assert.equal(Object.hasOwn(uploadResult, "file_id"), false);

    const generated = await linked.client.callTool({ name: SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, context: { model_id: "ideogram_45", mode: "generate" },
        prompt: "MCP to real service synthetic fixture", reference_handles: [handle],
        parameters: { rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1K" } } });
    assert.equal(generated.isError, undefined, `${JSON.stringify(textContents(generated))}; counts=${JSON.stringify(counts)} paths=${JSON.stringify(routePaths)}`);
    const generatedResult = generated.structuredContent as Record<string, unknown>;
    assert.equal(generatedResult.status, "result_observed");
    assert.equal(generatedResult.reference_count, 1);
    assert.equal(generatedResult.mask_present, false);
    assert.equal(generatedResult.mask_acceptance, "NOT_REQUESTED");
    assert.equal(counts.uploads, 1);
    assert.equal(counts.chats, 1);
    assert.equal(counts.posts, 1);
    assert.equal(counts.histories, 1);
    assert.equal(counts.results, 1);
    assert.equal(counts.preflights, 2);
    assert.deepEqual((postSettings?.file_urls as Array<{ type: string; url: string }>).map((item) => item.type), ["image"]);
    assert.equal(Object.hasOwn(postSettings ?? {}, "n"), false);
    assert.equal(Object.hasOwn(postSettings ?? {}, "mask"), false);
    assert.equal(JSON.stringify(generatedResult).includes("MCP to real service synthetic fixture"), false);

    const maskBaseUpload = await linked.client.callTool({ name: SYNTX_UPLOAD_IDEOGRAM_IMAGE_REFERENCE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, context: { model_id: "ideogram_45", mode: "precise_edit" },
        content_base64: pngBase64, filename: "masked-source.png", mime_type: "image/png" } });
    assert.equal(maskBaseUpload.isError, undefined, JSON.stringify(textContents(maskBaseUpload)));
    const baseHandle = (maskBaseUpload.structuredContent as Record<string, unknown>).reference_handle as string;
    const maskUpload = await linked.client.callTool({ name: "syntx_upload_ideogram_mask",
      arguments: { link_attempt_id: ATTEMPT, base_reference_handle: baseHandle, painted_rgba_png_base64: pngBase64 } });
    assert.equal(maskUpload.isError, undefined, JSON.stringify(textContents(maskUpload)));
    const maskReceipt = maskUpload.structuredContent as Record<string, unknown>;
    const maskHandle = maskReceipt.mask_handle as string;
    assert.match(maskHandle, /^ideogram_mask_[0-9a-f-]{36}$/u);
    for (const key of ["base_reference_handle", "url", "file_id", "normal_url", "inverse_url"]) assert.equal(Object.hasOwn(maskReceipt, key), false);
    const hiddenParts = uploadedParts.filter((part) => part.destination === "hidden");
    assert.deepEqual(hiddenParts.map((part) => [part.modelType, part.filename, part.mimeType]), [
      ["ideogram_45", "ideogram-mask-normal.png", "image/png"], ["ideogram_45", "ideogram-mask-inverse.png", "image/png"]
    ]);
    const masked = await linked.client.callTool({ name: SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, context: { model_id: "ideogram_45", mode: "precise_edit" },
        prompt: "MCP masked source fixture", reference_handles: [baseHandle], mask_handle: maskHandle,
        parameters: { rendering_speed: "DEFAULT", num_images: 2 } } });
    assert.equal(masked.isError, true, `${JSON.stringify(masked.structuredContent)}`);
    const unknownBody = JSON.parse(textContents(masked)[0]!) as { error: { code: string; recovery_id?: string } };
    assert.equal(unknownBody.error.code, "OUTCOME_UNKNOWN");
    assert.match(unknownBody.error.recovery_id ?? "", /^ideogram_image_recovery_[0-9a-f-]{36}$/u);
    const wireFiles = postSettings?.file_urls as Array<{ type: string; url: string }>;
    assert.deepEqual(wireFiles.map((item) => item.type), ["image", "mask"]);
    assert.equal(wireFiles[0]?.url, uploadedParts.find((part) => part.filename === "masked-source.png")?.url);
    assert.equal(wireFiles[1]?.url, hiddenParts[0]?.url, "the source-selected normal polarity is the only mask role URL sent");
    assert.equal(wireFiles.some((item) => item.url === hiddenParts[1]?.url), false, "inverse URL remains private");

    const recoveries = await linked.client.callTool({ name: SYNTX_OWNER_LIST_IDEOGRAM_IMAGE_RECOVERIES_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(recoveries.isError, undefined);
    const recoveryItem = ((recoveries.structuredContent as { recoveries: Array<Record<string, unknown>> }).recoveries)
      .find((item) => item.recovery_id === unknownBody.error.recovery_id);
    assert.ok(recoveryItem);
    assert.equal(recoveryItem.mask_present, true);
    assert.equal(recoveryItem.mask_acceptance, "UNPROVEN");
    const reconciled = await linked.client.callTool({ name: SYNTX_OWNER_RECONCILE_IDEOGRAM_IMAGE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, recovery_id: unknownBody.error.recovery_id } });
    assert.equal(reconciled.isError, true);
    const reconcileBody = JSON.parse(textContents(reconciled)[0]!) as { error: { code: string; recovery_id?: string; diagnostic?: { history_get_calls?: number } } };
    assert.equal(reconcileBody.error.code, "OUTCOME_UNKNOWN");
    assert.equal(reconcileBody.error.recovery_id, unknownBody.error.recovery_id);
    assert.equal(reconcileBody.error.diagnostic?.history_get_calls, 0,
      "without a known POST acknowledgement the service must not invent a history binding or issue a speculative GET");
    assert.deepEqual(counts, { uploads: 4, chats: 2, posts: 2, histories: 1, results: 1, preflights: 4 });
    assert.equal(JSON.stringify(reconciled).includes(maskHandle), false);
    assert.equal(JSON.stringify(reconciled).includes("MCP masked source fixture"), false);
  } finally { await linked.close(); await generationService.close(); }
});

test("exported reason and phase arrays are the complete imported generation DTO enums", () => {
  assert.equal(Object.isFrozen(OWNER_IDEOGRAM_IMAGE_GENERATION_PHASES), true);
  assert.equal(Object.isFrozen(OWNER_IDEOGRAM_IMAGE_GENERATION_ERROR_CODES), true);
  assert.equal(Object.isFrozen(OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS), true);
  assert.equal(Object.isFrozen(OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS), true);
});
