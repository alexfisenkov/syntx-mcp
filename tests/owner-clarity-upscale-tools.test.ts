import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OwnerClarityUpscaleGenerationServiceError, type OwnerClarityUpscaleGenerationService } from "../src/application/owner-clarity-upscale-generation-service.js";
import type { OwnerClarityUpscaleUploadService } from "../src/application/owner-clarity-upscale-upload-service.js";
import {
  registerSyntxOwnerClarityUpscaleTools,
  SYNTX_OWNER_CLARITY_UPSCALE_GENERATE_TOOL_NAME,
  SYNTX_OWNER_CLARITY_UPSCALE_LIST_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_CLARITY_UPSCALE_RECONCILE_TOOL_NAME,
  SYNTX_OWNER_CLARITY_UPSCALE_UPLOAD_TOOL_NAME
} from "../src/mcp/owner-clarity-upscale-tools.js";

const ATTEMPT = "link_clarity_tools_test_attempt_000000000000";
const IMAGE_HANDLE = "clarity_image_823e4567-e89b-12d3-a456-426614174000";
const RECOVERY_ID = "clarity_recovery_823e4567-e89b-12d3-a456-426614174000";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const DIAGNOSTIC = {
  phase: "POST_CALL_STARTED" as const, echo_ack_known: false, history_get_eligible: false,
  history_get_performed: false, history_get_count: 0, history_get_count_capped: false,
  history_binding: "NOT_RUN" as const, history_binding_reason: null, result_get_performed: false, result_get_count: 0,
  result_get_count_capped: false, unverified_reason: null, upstream_error_code: "UPSTREAM_TIMEOUT" as const
};

const UPLOAD_RECEIPT = {
  status: "accepted" as const,
  image_handle: IMAGE_HANDLE,
  mime_type: "image/png" as const,
  size: 68,
  width: 1,
  height: 1,
  sha256: `sha256:${"a".repeat(64)}`,
  expires_in_seconds: 900 as const,
  confidence_scope: "input_bytes_sniffed_and_dimensions_checked" as const,
  metadata_confidence: "CONTAINER_METADATA_ONLY" as const,
  upload_destination: "uploaded" as const,
  destination_source_binding: "root347_clarity_default_upload" as const,
  coverage: {
    source_mime_types: ["image/jpeg", "image/png", "image/avif", "image/webp"],
    source_max_bytes: 25 * 1024 * 1024,
    implemented_mime_types: ["image/jpeg", "image/png", "image/avif", "image/webp"],
    implemented_max_bytes: 25 * 1024 * 1024,
    status: "STRUCTURALLY_VALIDATED_NOT_PROVIDER_ACCEPTANCE",
    upload_destination: "uploaded",
    destination_source_binding: "root347_clarity_default_upload"
  }
} as const;

const RESULT = {
  status: "result_observed" as const,
  backend_acceptance: "unproven" as const,
  model_id: "clarity" as const,
  operation_id: "upscale-image" as const,
  profile_id: "clarity-upscale-source-reviewed-v1",
  profile_schema_hash: `sha256:${"b".repeat(64)}`,
  catalog_version: "2026-10-08T13:18:39.393Z.36e6960df354",
  request_fingerprint: `sha256:${"c".repeat(64)}`,
  requested_scale_factor: 2,
  input_image: { mime_type: "image/png", width: 100, height: 100 },
  expected_output_geometry: { width: 200, height: 200 },
  actual_image: { mime_type: "image/jpeg", width: null, height: null },
  geometry_verified: false as const,
  artifact: { url: "https://r2.syntx.ai/generated/opaque.jpg", mime_type: "image/jpeg", mime_confidence: "URL_EXTENSION_ONLY" as const }
};

function harness(service: {
  readonly uploadService: Pick<OwnerClarityUpscaleUploadService, "upload">;
  readonly generationService: Pick<OwnerClarityUpscaleGenerationService, "generate" | "reconcile" | "listRecoveries">;
}) {
  const server = new McpServer({ name: "owner-clarity-upscale-tools-test", version: "1.0.0" });
  registerSyntxOwnerClarityUpscaleTools(server, service);
  const client = new Client({ name: "owner-clarity-upscale-tools-client", version: "1.0.0" });
  return { server, client };
}

async function connect(server: McpServer, client: Client): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
}

test("Clarity owner module exposes four tools with five explicit settings plus optional top-level prompt and no caller model_type or n", async () => {
  const calls: Array<{ name: string; input: unknown }> = [];
  const service = {
    uploadService: { async upload(input: unknown) { calls.push({ name: "upload", input }); return UPLOAD_RECEIPT; } },
    generationService: {
      async generate(input: unknown) { calls.push({ name: "generate", input }); return RESULT; },
      async reconcile(input: unknown) { calls.push({ name: "reconcile", input }); return RESULT; },
      async listRecoveries(input: unknown) { calls.push({ name: "list", input }); return [{ recovery_id: RECOVERY_ID, created_at: "2026-10-10T10:00:00.000Z", model_id: "clarity" as const, operation_id: "upscale-image" as const, status: "OUTCOME_UNKNOWN" as const, diagnostic: DIAGNOSTIC }]; }
    }
  };
  const { server, client } = harness(service);
  await connect(server, client);
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((item) => item.name).sort(), [
      SYNTX_OWNER_CLARITY_UPSCALE_UPLOAD_TOOL_NAME,
      SYNTX_OWNER_CLARITY_UPSCALE_GENERATE_TOOL_NAME,
      SYNTX_OWNER_CLARITY_UPSCALE_RECONCILE_TOOL_NAME,
      SYNTX_OWNER_CLARITY_UPSCALE_LIST_RECOVERIES_TOOL_NAME
    ].sort());
    const generateTool = tools.find((item) => item.name === SYNTX_OWNER_CLARITY_UPSCALE_GENERATE_TOOL_NAME)!;
    const inputSchema = generateTool.inputSchema as { properties?: Record<string, { properties?: Record<string, unknown> }> };
    assert.deepEqual(Object.keys(inputSchema.properties?.parameters?.properties ?? {}).sort(), [
      "cfg", "denoise", "professional_mode", "scale_factor", "strength"
    ]);
    assert.ok("prompt" in (inputSchema.properties ?? {}));

    const uploaded = await client.callTool({ name: SYNTX_OWNER_CLARITY_UPSCALE_UPLOAD_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, content_base64: PNG, filename: "input.png", mime_type: "image/png"
    } });
    assert.equal(uploaded.isError, undefined);
    assert.equal((uploaded.structuredContent as { image_handle: string }).image_handle, IMAGE_HANDLE);
    assert.equal(JSON.stringify(uploaded).includes("r2.syntx.ai"), false);
    assert.equal(JSON.stringify(uploaded).includes(PNG), false);

    const generated = await client.callTool({ name: SYNTX_OWNER_CLARITY_UPSCALE_GENERATE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT,
      image_handle: IMAGE_HANDLE,
      prompt: "restore detail",
      parameters: { professional_mode: false, scale_factor: 2, strength: 0.85, cfg: 6, denoise: 0.2 }
    } });
    assert.equal(generated.isError, undefined);
    assert.equal((generated.structuredContent as { backend_acceptance: string }).backend_acceptance, "unproven");
    assert.deepEqual(calls[1], { name: "generate", input: {
      attemptId: ATTEMPT, image_handle: IMAGE_HANDLE,
      parameters: { professional_mode: false, scale_factor: 2, strength: 0.85, cfg: 6, denoise: 0.2 },
      prompt: "restore detail"
    } });

    const listed = await client.callTool({ name: SYNTX_OWNER_CLARITY_UPSCALE_LIST_RECOVERIES_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listed.isError, undefined);
    assert.equal((listed.structuredContent as { recoveries: readonly unknown[] }).recoveries.length, 1);
    assert.deepEqual((listed.structuredContent as { recoveries: readonly { diagnostic: unknown }[] }).recoveries[0]?.diagnostic, DIAGNOSTIC);
    assert.equal(JSON.stringify(calls).includes("r2.syntx.ai"), false);
  } finally { await client.close(); await server.close(); }
});

test("Clarity tool schemas reject paths, arbitrary URLs, extra fields, and malformed parameter objects before service calls", async () => {
  let calls = 0;
  const { server, client } = harness({
    uploadService: { async upload() { calls += 1; return UPLOAD_RECEIPT; } },
    generationService: {
      async generate() { calls += 1; return RESULT; },
      async reconcile() { calls += 1; return RESULT; },
      async listRecoveries() { calls += 1; return []; }
    }
  });
  await connect(server, client);
  try {
    for (const arguments_ of [
      { link_attempt_id: ATTEMPT, path: "/tmp/input.png", url: "https://example.invalid/image.png" },
      { link_attempt_id: ATTEMPT, image_handle: IMAGE_HANDLE, parameters: { professional_mode: false, scale_factor: 2, strength: 0.85, cfg: 6, denoise: 0.2, file_urls: ["https://example.invalid"] } }
    ]) {
      const result = await client.callTool({ name: SYNTX_OWNER_CLARITY_UPSCALE_GENERATE_TOOL_NAME, arguments: arguments_ });
      assert.equal(result.isError, true);
    }
    const upload = await client.callTool({ name: SYNTX_OWNER_CLARITY_UPSCALE_UPLOAD_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, content_base64: PNG, filename: "input.png", mime_type: "image/png", path: "/tmp/input.png"
    } });
    assert.equal(upload.isError, true);
    assert.equal(calls, 0);
  } finally { await client.close(); await server.close(); }
});

test("upload MCP schema accepts AVIF and exposes the source 25 MiB base64 boundary", async () => {
  const calls: unknown[] = [];
  const { server, client } = harness({
    uploadService: { async upload(input: unknown) { calls.push(input); return {
      ...UPLOAD_RECEIPT, mime_type: "image/avif", size: 25 * 1024 * 1024, width: 9_000, height: 9_000
    }; } },
    generationService: {
      async generate() { return RESULT; },
      async reconcile() { return RESULT; },
      async listRecoveries() { return []; }
    }
  });
  await connect(server, client);
  try {
    const tool = (await client.listTools()).tools.find((item) => item.name === SYNTX_OWNER_CLARITY_UPSCALE_UPLOAD_TOOL_NAME)!;
    const schema = tool.inputSchema as { properties: Record<string, { maxLength?: number; enum?: readonly string[] }> };
    assert.equal(schema.properties.content_base64?.maxLength, Math.ceil((25 * 1024 * 1024) / 3) * 4);
    assert.deepEqual(schema.properties.mime_type?.enum, ["image/jpeg", "image/png", "image/avif", "image/webp"]);
    const uploaded = await client.callTool({ name: SYNTX_OWNER_CLARITY_UPSCALE_UPLOAD_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, content_base64: "AAAA", filename: "still.avif", mime_type: "image/avif"
    } });
    assert.equal(uploaded.isError, undefined);
    assert.equal(calls.length, 1);
    assert.equal((calls[0] as { mime_type: string }).mime_type, "image/avif");
    assert.equal((uploaded.structuredContent as { metadata_confidence: string }).metadata_confidence, "CONTAINER_METADATA_ONLY");
  } finally { await client.close(); await server.close(); }
});

test("Clarity tool error results redact raw exceptions and include only a valid unknown-outcome recovery ID", async () => {
  const secret = "PRIVATE_PROVIDER_URL_AND_TRACE";
  const { server, client } = harness({
    uploadService: { async upload() { throw new Error(secret); } },
    generationService: {
      async generate() { throw new OwnerClarityUpscaleGenerationServiceError("OUTCOME_UNKNOWN", RECOVERY_ID, DIAGNOSTIC); },
      async reconcile() { throw new OwnerClarityUpscaleGenerationServiceError("OUTCOME_UNKNOWN", "not-a-handle"); },
      async listRecoveries() { throw new Error(secret); }
    }
  });
  await connect(server, client);
  try {
    const generated = await client.callTool({ name: SYNTX_OWNER_CLARITY_UPSCALE_GENERATE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, image_handle: IMAGE_HANDLE,
      parameters: { professional_mode: false, scale_factor: 2, strength: 0.85, cfg: 6, denoise: 0.2 }
    } });
    const generationError = (generated.content as readonly { text?: string }[])[0]?.text ?? "";
    assert.equal(generated.isError, true);
    assert.match(generationError, new RegExp(RECOVERY_ID));
    assert.deepEqual(JSON.parse(generationError).error.diagnostic, DIAGNOSTIC);
    assert.equal(generationError.includes(secret), false);

    const uploaded = await client.callTool({ name: SYNTX_OWNER_CLARITY_UPSCALE_UPLOAD_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, content_base64: PNG, filename: "input.png", mime_type: "image/png"
    } });
    const uploadError = (uploaded.content as readonly { text?: string }[])[0]?.text ?? "";
    assert.equal(uploaded.isError, true);
    assert.equal(uploadError.includes(secret), false);

    const listed = await client.callTool({ name: SYNTX_OWNER_CLARITY_UPSCALE_LIST_RECOVERIES_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    const listError = (listed.content as readonly { text?: string }[])[0]?.text ?? "";
    assert.equal(listed.isError, true);
    assert.equal(listError.includes(secret), false);

    const reconciled = await client.callTool({ name: SYNTX_OWNER_CLARITY_UPSCALE_RECONCILE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, recovery_id: RECOVERY_ID } });
    const reconcileError = (reconciled.content as readonly { text?: string }[])[0]?.text ?? "";
    assert.equal(reconciled.isError, true);
    assert.equal(reconcileError.includes("not-a-handle"), false);
    assert.equal(reconcileError.includes(secret), false);
  } finally { await client.close(); await server.close(); }
});
