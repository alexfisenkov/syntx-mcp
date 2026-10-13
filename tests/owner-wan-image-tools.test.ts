import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OwnerWanImageGenerationServiceError, type OwnerWanImageGenerationResult,
  type OwnerWanImageRecoveryListItem } from "../src/application/owner-wan-image-generation-service.js";
import { OwnerWanImageUploadServiceError, type OwnerWanImageUploadReceipt } from "../src/application/owner-wan-image-upload-service.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer, type CreateMcpServerOptions } from "../src/mcp/server.js";
import {
  registerSyntxOwnerWanImageTools,
  SYNTX_OWNER_GENERATE_WAN_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_WAN_IMAGE_TOOL_NAME,
  SYNTX_UPLOAD_WAN_REFERENCE_IMAGE_TOOL_NAME
} from "../src/mcp/owner-wan-image-tools.js";

const ATTEMPT = "link_wan_tools_test_attempt_000001";
const HANDLE = "wan_image_823e4567-e89b-12d3-a456-426614174000";
const RECOVERY_ID = "wan_image_recovery_823e4567-e89b-12d3-a456-426614174001";
const PARAMETERS = Object.freeze({ aspect_ratio: "1:1", resolution: "2K", batch_size: 4, prompt_extend: true,
  seed: null, color_palette: Object.freeze([
    Object.freeze({ hex: "#FF0000", ratio: "50.00%" }), Object.freeze({ hex: "#00FF00", ratio: "30.00%" }),
    Object.freeze({ hex: "#0000FF", ratio: "20.00%" })
  ]), bbox_list: Object.freeze([Object.freeze([[1, 2, 100, 200] as const])]) });
const DIAGNOSTIC = Object.freeze({ phase: "GENERATION_POST" as const, post_started: true, echo_ack_known: true,
  history_binding: "PENDING" as const, history_binding_reason: null, history_get_calls: 1,
  history_get_calls_saturated: false, inprogress_get_calls: 0, inprogress_get_calls_saturated: false,
  result_get_calls: 0, result_get_calls_saturated: false, result_status: "NOT_READ" as const, result_reason: null });

function result(variant: OwnerWanImageGenerationResult["variant"], handles: readonly string[], parameters = PARAMETERS): OwnerWanImageGenerationResult {
  return Object.freeze({ status: "result_observed", backend_acceptance: "unproven", ai_name: "wan_image", model_id: variant,
    variant, operation_id: "generate-image", profile_id: "wan-image-source-reviewed-v1",
    profile_schema_hash: `sha256:${"a".repeat(64)}`, catalog_version: "2026-10-08T13:18:39.393Z.36e6960df354",
    request_fingerprint: `sha256:${"b".repeat(64)}`, parameters, cost_inputs: Object.freeze({ batch_size: parameters.batch_size }),
    cost_input_confidence: "SOURCE_JOINED_BATCH_SIZE_ONLY", requested_batch_size: parameters.batch_size,
    bbox_coordinate_policy: parameters.bbox_list.some((entry) => entry.length > 0)
      ? "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" : null,
    reference_count: handles.length, input_images: Object.freeze(handles.map((_, index) => Object.freeze({ mime_type: "image/png",
      width: 384, height: 384, size: 1024, sha256: `sha256:${String(index + 1).repeat(64)}`,
      metadata_confidence: "CONTAINER_METADATA_ONLY" }))),
    artifacts: Object.freeze(Array.from({ length: parameters.batch_size }, (_, index) => Object.freeze({
      url: `https://r2.syntx.ai/results/${variant}-${index + 1}.png`, mime_type: "image/png", mime_source: "URL_EXTENSION",
      width: null, height: null, geometry_verified: false
    }))), expected_output_geometry: null, geometry_verified: false });
}

const UPLOAD: OwnerWanImageUploadReceipt = Object.freeze({ status: "uploaded", reference_handle: HANDLE,
  variant: "wan_27_image_pro", original_mime_type: "image/bmp", mime_type: "image/bmp", width: 384, height: 384,
  size: 1024, sha256: `sha256:${"c".repeat(64)}`, expires_in_seconds: 899, metadata_confidence: "CONTAINER_METADATA_ONLY",
  coordinate_projection: Object.freeze({ orientation: 1, projected_width: 384, projected_height: 384,
    confidence: "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE" }) });
const RECOVERY: OwnerWanImageRecoveryListItem = Object.freeze({ recovery_id: RECOVERY_ID,
  created_at: "2026-10-10T12:00:00.000Z", model_id: "wan_27_image_pro", operation_id: "generate-image",
  status: "OUTCOME_UNKNOWN", diagnostic: DIAGNOSTIC });

type ServicePorts = {
  uploadService: { upload(input: unknown): Promise<OwnerWanImageUploadReceipt> };
  generationService: {
    generate(input: unknown, signal?: AbortSignal): Promise<OwnerWanImageGenerationResult>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerWanImageGenerationResult>;
    listRecoveries(input: unknown): Promise<readonly OwnerWanImageRecoveryListItem[]>;
  };
};

function harness(ports: ServicePorts) {
  const server = new McpServer({ name: "owner-wan-image-tools-test", version: "1.0.0" });
  registerSyntxOwnerWanImageTools(server, ports);
  const client = new Client({ name: "owner-wan-image-tools-client", version: "1.0.0" });
  return { server, client };
}

async function connect(server: McpServer, client: Client): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
}

function validInput(variant: OwnerWanImageGenerationResult["variant"], count: number, withBoxes = false) {
  const parameters = { ...PARAMETERS,
    resolution: variant === "wan_25_i2i_preview" ? "720P" : variant === "wan_26_image" ? "1080P" : "2K",
    color_palette: variant === "wan_25_i2i_preview" || variant === "wan_26_image" ? null : PARAMETERS.color_palette,
    bbox_list: Array.from({ length: count }, (_, index) => withBoxes && index === 0 ? [[1, 2, 100, 200]] : []) };
  return { link_attempt_id: ATTEMPT, variant, reference_handles: Array.from({ length: count }, (_, i) =>
    `wan_image_823e4567-e89b-12d3-a456-42661417400${i}`), parameters: { ...PARAMETERS,
      ...parameters },
    prompt: "  Preserve this exact WAN prompt.  ",
    bbox_coordinate_policy: withBoxes ? "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" : null };
}

test("WAN owner tools expose exactly four tools with strict complete input schemas", async () => {
  const { server, client } = harness({ uploadService: { async upload() { return UPLOAD; } }, generationService: {
    async generate(input) { const value = input as { variant: OwnerWanImageGenerationResult["variant"]; reference_handles: readonly string[]; parameters: typeof PARAMETERS };
      return result(value.variant, value.reference_handles, value.parameters); },
    async reconcile() { return result("wan_27_image_pro", [], { ...PARAMETERS, bbox_list: [] }); },
    async listRecoveries() { return [RECOVERY]; }
  } });
  await connect(server, client);
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map(({ name }) => name).sort(), [SYNTX_UPLOAD_WAN_REFERENCE_IMAGE_TOOL_NAME,
      SYNTX_OWNER_GENERATE_WAN_IMAGE_TOOL_NAME, SYNTX_OWNER_RECONCILE_WAN_IMAGE_TOOL_NAME,
      SYNTX_OWNER_LIST_WAN_RECOVERIES_TOOL_NAME].sort());
    const generateTool = tools.find(({ name }) => name === SYNTX_OWNER_GENERATE_WAN_IMAGE_TOOL_NAME)!;
    const schema = generateTool.inputSchema as { properties: Record<string, { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }>;
      required: string[]; additionalProperties?: boolean };
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(Object.keys(schema.properties.parameters!.properties!).sort(), ["aspect_ratio", "bbox_list", "batch_size",
      "color_palette", "prompt_extend", "resolution", "seed"].sort());
    assert.equal(schema.properties.parameters?.additionalProperties, false);
    assert.deepEqual(schema.properties.parameters?.required?.sort(), ["aspect_ratio", "bbox_list", "batch_size", "color_palette",
      "prompt_extend", "resolution", "seed"].sort());
    assert.ok(schema.required.includes("bbox_coordinate_policy"));
    const uploadTool = tools.find(({ name }) => name === SYNTX_UPLOAD_WAN_REFERENCE_IMAGE_TOOL_NAME)!;
    const uploadSchema = uploadTool.inputSchema as { properties: Record<string, { maxLength?: number; enum?: readonly string[] }> };
    assert.equal(uploadSchema.properties.content_base64?.maxLength, Math.ceil((20 * 1024 * 1024) / 3) * 4);
    assert.deepEqual(uploadSchema.properties.mime_type?.enum, ["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp"]);
  } finally { await client.close(); await server.close(); }
});

test("all WAN variants pass all seven explicit fields, ordered references, and batch four to the service", async () => {
  const calls: Array<{ input: unknown; signal: AbortSignal | undefined }> = [];
  const { server, client } = harness({ uploadService: { async upload() { return UPLOAD; } }, generationService: {
    async generate(input, signal) {
      calls.push({ input, signal });
      const value = input as { variant: OwnerWanImageGenerationResult["variant"]; reference_handles: readonly string[];
        parameters: typeof PARAMETERS; bbox_coordinate_policy: "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" | null };
      return result(value.variant, value.reference_handles, value.parameters);
    }, async reconcile() { return result("wan_27_image_pro", [], { ...PARAMETERS, bbox_list: [] }); }, async listRecoveries() { return []; }
  } });
  await connect(server, client);
  try {
    for (const [variant, count] of [["wan_25_i2i_preview", 3], ["wan_26_image", 4], ["wan_27_image", 0], ["wan_27_image_pro", 9]] as const) {
      const input = validInput(variant, count, variant === "wan_27_image_pro");
      const called = await client.callTool({ name: SYNTX_OWNER_GENERATE_WAN_IMAGE_TOOL_NAME, arguments: input });
      assert.equal(called.isError, undefined);
      const returned = called.structuredContent as OwnerWanImageGenerationResult;
      assert.equal(returned.variant, variant);
      assert.equal(returned.artifacts.length, 4);
      assert.ok(returned.artifacts.every((artifact) => artifact.width === null && artifact.height === null && artifact.geometry_verified === false));
    }
    assert.equal(calls.length, 4);
    const nine = calls[3]!.input as { reference_handles: readonly string[]; parameters: typeof PARAMETERS; bbox_coordinate_policy: string };
    assert.equal(nine.reference_handles.length, 9);
    assert.equal(nine.parameters.bbox_list.length, 9);
    assert.equal(nine.bbox_coordinate_policy, "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER");
    assert.deepEqual(Object.keys(nine.parameters).sort(), ["aspect_ratio", "bbox_list", "batch_size", "color_palette", "prompt_extend", "resolution", "seed"].sort());
    assert.ok(calls.every(({ signal }) => signal instanceof AbortSignal));
  } finally { await client.close(); await server.close(); }
});

test("upload receipt exposes only the bounded coordinate projection DTO", async () => {
  const { server, client } = harness({ uploadService: { async upload() { return UPLOAD; } }, generationService: {
    async generate() { return result("wan_27_image", [], { ...PARAMETERS, bbox_list: [] }); },
    async reconcile() { return result("wan_27_image", [], { ...PARAMETERS, bbox_list: [] }); }, async listRecoveries() { return []; }
  } });
  await connect(server, client);
  try {
    const uploaded = await client.callTool({ name: SYNTX_UPLOAD_WAN_REFERENCE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, variant: "wan_27_image_pro", content_base64: "AAAA", filename: "ref.bmp", mime_type: "image/bmp"
    } });
    assert.equal(uploaded.isError, undefined);
    const receipt = uploaded.structuredContent as OwnerWanImageUploadReceipt;
    assert.deepEqual(receipt.coordinate_projection, {
      orientation: 1, projected_width: 384, projected_height: 384,
      confidence: "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE"
    });
    assert.equal(JSON.stringify(uploaded).includes("private"), false);
  } finally { await client.close(); await server.close(); }
});

test("bbox policy is explicit, upload is typed, and errors expose only closed safe evidence", async () => {
  const secret = "PRIVATE_URL_PROMPT_PALETTE_PROVIDER_BODY";
  const calls: string[] = [];
  const { server, client } = harness({ uploadService: { async upload() { calls.push("upload"); throw new OwnerWanImageUploadServiceError("UPLOAD_REJECTED"); } },
    generationService: {
      async generate(_input) { calls.push("generate"); const value = _input as { variant: OwnerWanImageGenerationResult["variant"]; reference_handles: readonly string[]; parameters: typeof PARAMETERS };
        return result(value.variant, value.reference_handles, value.parameters); },
      async reconcile(_input) { calls.push("reconcile"); throw new OwnerWanImageGenerationServiceError("OUTCOME_UNKNOWN", RECOVERY_ID, DIAGNOSTIC); },
      async listRecoveries() { calls.push("list"); return [RECOVERY]; }
    } });
  await connect(server, client);
  try {
    const invalid = await client.callTool({ name: SYNTX_OWNER_GENERATE_WAN_IMAGE_TOOL_NAME, arguments: {
      ...validInput("wan_27_image", 1, true), bbox_coordinate_policy: null
    } });
    assert.equal(invalid.isError, true);
    assert.equal(calls.includes("generate"), false);
    const upload = await client.callTool({ name: SYNTX_UPLOAD_WAN_REFERENCE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, variant: "wan_27_image", content_base64: "AAAA", filename: "input.bmp", mime_type: "image/bmp"
    } });
    assert.equal(upload.isError, true);
    assert.equal(JSON.stringify(upload).includes("UPLOAD_REJECTED"), true);
    const recon = await client.callTool({ name: SYNTX_OWNER_RECONCILE_WAN_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: RECOVERY_ID
    } });
    assert.equal(recon.isError, true);
    const text = JSON.stringify(recon);
    assert.equal(text.includes("OUTCOME_UNKNOWN"), true);
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes(RECOVERY_ID), true);
    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_WAN_RECOVERIES_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listed.isError, undefined);
    assert.deepEqual((listed.structuredContent as { recoveries: unknown[] }).recoveries, [RECOVERY]);
    assert.deepEqual(calls, ["upload", "reconcile", "list"]);
  } finally { await client.close(); await server.close(); }
});

test("WAN server composition remains explicit and incompatible with durable paid mode", async () => {
  const application = createDefaultApplication();
  const defaults: CreateMcpServerOptions = {};
  assert.equal(defaults.ownerWanImageReferences, undefined);
  const defaultServer = createMcpServer(application);
  const defaultClient = new Client({ name: "wan-default-off-client", version: "1.0.0" });
  await connect(defaultServer, defaultClient);
  try {
    const names = (await defaultClient.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => name.includes("wan_image") || name.includes("wan_reference")), false);
  } finally { await defaultClient.close(); await defaultServer.close(); }
  const composition = { uploadService: { async upload() { return UPLOAD; }, async invalidateAttempt() {}, async close() {} },
    generationService: { async generate() { return result("wan_27_image_pro", [], { ...PARAMETERS, bbox_list: [] }); },
      async reconcile() { return result("wan_27_image_pro", [], { ...PARAMETERS, bbox_list: [] }); }, async listRecoveries() { return []; },
      async invalidateAttempt() {}, async close() {} } };
  const ownerServer = createMcpServer(application, { ownerWanImageReferences: composition });
  const ownerClient = new Client({ name: "wan-owner-optin-client", version: "1.0.0" });
  await connect(ownerServer, ownerClient);
  try {
    const names = (await ownerClient.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => [SYNTX_UPLOAD_WAN_REFERENCE_IMAGE_TOOL_NAME,
      SYNTX_OWNER_GENERATE_WAN_IMAGE_TOOL_NAME, SYNTX_OWNER_RECONCILE_WAN_IMAGE_TOOL_NAME,
      SYNTX_OWNER_LIST_WAN_RECOVERIES_TOOL_NAME].includes(name as typeof SYNTX_UPLOAD_WAN_REFERENCE_IMAGE_TOOL_NAME)).sort(),
    [SYNTX_UPLOAD_WAN_REFERENCE_IMAGE_TOOL_NAME, SYNTX_OWNER_GENERATE_WAN_IMAGE_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_WAN_IMAGE_TOOL_NAME, SYNTX_OWNER_LIST_WAN_RECOVERIES_TOOL_NAME].sort());
  } finally { await ownerClient.close(); await ownerServer.close(); }
  assert.throws(() => createMcpServer(application, { ownerWanImageReferences: composition,
    ownerDurableGeneration: {} as NonNullable<CreateMcpServerOptions["ownerDurableGeneration"]> }),
  /OWNER_DURABLE_GENERATION_COMPOSITION_CONFLICT/u);
});
