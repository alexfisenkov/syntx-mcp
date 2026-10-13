import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { OwnerSeedreamImageGenerationServiceError } from "../src/application/owner-seedream-image-generation-service.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { createMcpServer, type CreateMcpServerOptions } from "../src/mcp/server.js";

const TOOL_NAMES = [
  "syntx_upload_seedream_image_reference",
  "syntx_owner_generate_seedream_image",
  "syntx_owner_reconcile_seedream_image",
  "syntx_owner_list_seedream_image_recoveries"
];

async function inspectTools(options?: CreateMcpServerOptions) {
  const server = createMcpServer(createDefaultApplication(), options);
  const client = new Client({ name: "seedream-image-tools-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return { tools: (await client.listTools()).tools, client, server }; }
  catch (error) { await client.close(); await server.close(); throw error; }
}

test("Seedream tools remain absent by default and are exposed by the explicit owner composition", async () => {
  const defaults = await inspectTools();
  try { assert.equal(defaults.tools.some(({ name }) => TOOL_NAMES.includes(name)), false); }
  finally { await defaults.client.close(); await defaults.server.close(); }

  const composition = {
    uploadService: { async upload() { throw new Error("unused"); }, async invalidateAttempt() {}, async close() {} },
    generationService: { async generate() { throw new Error("unused"); }, async reconcile() { throw new Error("unused"); },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {} }
  };
  const owner = await inspectTools({ ownerSeedreamImageReferences: composition } as unknown as CreateMcpServerOptions);
  try { assert.deepEqual(owner.tools.map(({ name }) => name).filter((name) => TOOL_NAMES.includes(name)).sort(), [...TOOL_NAMES].sort()); }
  finally { await owner.client.close(); await owner.server.close(); }
});

test("generation tool preserves all 104 source ratio-resolution pairs and four explicit Flash branches", async () => {
  const variants = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;
  const resolutions = { "seedream-4": ["1K", "2K", "4K"], "seedream-4.5": ["2K", "4K"],
    "seedream-5": ["2K", "3K", "4K"], "seedream-5.0-flash": ["1K", "1.5K", "2K"], "seedream-5.0-pro": ["1K", "2K"] } as const;
  const ratios = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;
  const received: Array<{ variant: string; parameters: Record<string, unknown>; reference_handles: string[] }> = [];
  const generationService = {
    async generate(input: unknown) {
      const request = input as { variant: typeof variants[number]; parameters: Record<string, unknown>; reference_handles: string[] };
      received.push(request);
      const cost_inputs = request.variant === "seedream-5.0-pro"
        ? { batch_size: request.reference_handles.length, resolution: request.parameters.resolution as string } : {};
      return { status: "result_observed", namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN",
        ai_name: "seedream", model_id: request.variant, variant: request.variant, operation_id: "generate-image",
        profile_id: "seedream-image-source-reviewed-v1", profile_schema_hash: `sha256:${"a".repeat(64)}`,
        catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, request_fingerprint: `sha256:${"b".repeat(64)}`,
        parameters: request.parameters, cost_inputs, cost_input_confidence: "SOURCE_JOINED_CONTROLLED_STATE_NOT_QUOTE",
        reference_count: request.reference_handles.length, input_references: [], actual_image: { mime_type: "image/png", width: null, height: null },
        geometry_verified: false, artifact: { url: "https://r2.syntx.ai/seedream/result.png", mime_type: "image/png",
          mime_source: "URL_EXTENSION", width: null, height: null, geometry_verified: false } };
    },
    async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; },
    async invalidateAttempt() {}, async close() {}
  };
  const composition = { uploadService: { async upload() { throw new Error("unused"); }, async invalidateAttempt() {}, async close() {} }, generationService };
  const { client, server } = await inspectTools({ ownerSeedreamImageReferences: composition } as unknown as CreateMcpServerOptions);
  try {
    let accepted = 0;
    for (const variant of variants) for (const aspect_ratio of ratios) for (const resolution of resolutions[variant]) {
      const flash = variant === "seedream-5.0-flash";
      const parameters = { aspect_ratio, resolution, output_format: flash ? "png" : null, background: flash ? "opaque" : null };
      const result = await client.callTool({ name: "syntx_owner_generate_seedream_image", arguments: {
        link_attempt_id: "link_seedream_tools_test_attempt_000001", variant, reference_handles: [], parameters, prompt: "exact source controls"
      } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.deepEqual((result.structuredContent as { parameters: unknown }).parameters, parameters);
      accepted += 1;
    }
    for (const output_format of ["jpeg", "png"] as const) for (const background of ["opaque", "transparent"] as const) {
      const parameters = { aspect_ratio: "1:1", resolution: "1K", output_format, background };
      const result = await client.callTool({ name: "syntx_owner_generate_seedream_image", arguments: {
        link_attempt_id: "link_seedream_tools_test_attempt_000001", variant: "seedream-5.0-flash", reference_handles: [], parameters, prompt: "Flash branches"
      } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.deepEqual((result.structuredContent as { parameters: unknown }).parameters, parameters);
      accepted += 1;
    }
    assert.equal(accepted, 108);
    assert.equal(received.length, 108);
    assert.deepEqual(received.find((request) => request.variant === "seedream-5.0-pro")?.parameters,
      { aspect_ratio: "21:9", resolution: "1K", output_format: null, background: null });
  } finally { await client.close(); await server.close(); }
});

test("closed Seedream schemas reject wrong variant controls, oversized reference sets, and caller ownership claims", async () => {
  let generationCalls = 0, uploadCalls = 0;
  const composition = {
    uploadService: { async upload() { uploadCalls += 1; throw new Error("unused upload"); }, async invalidateAttempt() {}, async close() {} },
    generationService: { async generate() { generationCalls += 1; throw new Error("invalid input reached generation service"); },
      async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {} }
  };
  const { client, server } = await inspectTools({ ownerSeedreamImageReferences: composition } as unknown as CreateMcpServerOptions);
  const attempt = "link_seedream_tools_test_attempt_000001";
  const validParams = { aspect_ratio: "1:1", resolution: "1K", output_format: null, background: null };
  const handles = Array.from({ length: 15 }, (_, index) => `seedream_image_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  try {
    const invalidRequests = [
      { link_attempt_id: attempt, variant: "seedream-4.5", reference_handles: [], parameters: validParams, prompt: "wrong resolution" },
      { link_attempt_id: attempt, variant: "seedream-5", reference_handles: [], parameters: { aspect_ratio: "1:1", resolution: "2K" }, prompt: "no implicit nulls" },
      { link_attempt_id: attempt, variant: "seedream-5.0-flash", reference_handles: [], parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: null, background: null }, prompt: "Flash fields required" },
      { link_attempt_id: attempt, variant: "seedream-4", reference_handles: handles, parameters: validParams, prompt: "source ref count" },
      { link_attempt_id: attempt, variant: "seedream-5.0-flash", reference_handles: [], parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "transparent" }, prompt: "caller cannot assert alpha", source_alpha_eligible: true },
      { link_attempt_id: attempt, variant: "seedream-5", reference_handles: [], parameters: validParams, prompt: "caller cannot set URL", source_alpha_witness: {}, file_url: "https://private.invalid/secret" }
    ];
    for (const arguments_ of invalidRequests) {
      const result = await client.callTool({ name: "syntx_owner_generate_seedream_image", arguments: arguments_ });
      assert.equal(result.isError, true);
      assert.equal(JSON.stringify(result).includes("https://private.invalid"), false);
    }
    const unsupportedUpload = await client.callTool({ name: "syntx_upload_seedream_image_reference", arguments: {
      link_attempt_id: attempt, variant: "seedream-5", content_base64: "AAAA", filename: "image.bmp", mime_type: "image/bmp"
    } });
    assert.equal(unsupportedUpload.isError, true);
    assert.equal(generationCalls, 0);
    assert.equal(uploadCalls, 0);
  } finally { await client.close(); await server.close(); }
});

test("upload tool returns only the closed safe receipt and preserves source MIME alias context", async () => {
  let received: unknown;
  const composition = {
    uploadService: { async upload(input: unknown) {
      received = input;
      return { status: "uploaded", reference_handle: "seedream_image_00000000-0000-4000-8000-000000000001", variant: "seedream-4",
        original_mime_type: "image/jpg", mime_type: "image/jpeg", width: 20, height: 20, size: 42,
        sha256: `sha256:${"c".repeat(64)}`, expires_in_seconds: 900, metadata_confidence: "CONTAINER_METADATA_ONLY",
        validation_confidence: "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;SOURCE_CONTAINER_METADATA_ONLY_NOT_PROVIDER_ACCEPTANCE",
        source_alpha_eligible: false, source_alpha_confidence: "NOT_PNG_SOURCE", source_sample_width: null, source_sample_height: null };
    }, async invalidateAttempt() {}, async close() {} },
    generationService: { async generate() { throw new Error("unused"); }, async reconcile() { throw new Error("unused"); },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {} }
  };
  const { client, server } = await inspectTools({ ownerSeedreamImageReferences: composition } as unknown as CreateMcpServerOptions);
  try {
    const result = await client.callTool({ name: "syntx_upload_seedream_image_reference", arguments: {
      link_attempt_id: "link_seedream_tools_test_attempt_000001", variant: "seedream-4", content_base64: "AAAA", filename: "reference.jpg", mime_type: "image/jpg"
    } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const forwarded = received as Record<string, unknown>;
    const { signal, ...forwardedRequest } = forwarded;
    assert.ok(signal instanceof AbortSignal);
    assert.deepEqual(forwardedRequest, { attemptId: "link_seedream_tools_test_attempt_000001", variant: "seedream-4",
      content_base64: "AAAA", filename: "reference.jpg", mime_type: "image/jpg" });
    const receipt = result.structuredContent as Record<string, unknown>;
    assert.equal(receipt.original_mime_type, "image/jpg");
    assert.equal(receipt.mime_type, "image/jpeg");
    assert.equal(receipt.source_alpha_eligible, false);
    assert.equal(JSON.stringify(result).includes("file_url"), false);
    assert.equal(JSON.stringify(result).includes("reference.jpg"), false);
  } finally { await client.close(); await server.close(); }
});

test("SDK listTools publishes closed input and five strict full-control parameter branches", async () => {
  const composition = {
    uploadService: { async upload() { throw new Error("unused"); }, async invalidateAttempt() {}, async close() {} },
    generationService: { async generate() { throw new Error("unused"); }, async reconcile() { throw new Error("unused"); },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {} }
  };
  const { tools, client, server } = await inspectTools({ ownerSeedreamImageReferences: composition } as unknown as CreateMcpServerOptions);
  try {
    for (const name of ["syntx_upload_seedream_image_reference", "syntx_owner_generate_seedream_image"]) {
      const tool = tools.find((candidate) => candidate.name === name)!;
      const schema = tool.inputSchema as Record<string, unknown>;
      assert.equal(schema.type, "object");
      assert.equal(schema.additionalProperties, false);
      const properties = schema.properties as Record<string, Record<string, unknown>>;
      if (name === "syntx_owner_generate_seedream_image") {
        const parameters = properties.parameters!;
        const branches = (parameters.oneOf ?? parameters.anyOf) as Array<Record<string, unknown>>;
        assert.ok(Array.isArray(branches), JSON.stringify(parameters));
        assert.equal(branches.length, 5);
        for (const branch of branches) {
          assert.equal(branch.additionalProperties, false);
          const parameterProperties = branch.properties as Record<string, Record<string, unknown>>;
          assert.deepEqual(Object.keys(parameterProperties).sort(), ["aspect_ratio", "background", "output_format", "resolution"].sort());
          assert.deepEqual((branch.required as string[]).sort(), ["aspect_ratio", "background", "output_format", "resolution"].sort());
        }
      } else {
        assert.deepEqual((properties.variant!.enum as string[]).sort(), ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"].sort());
        assert.equal(properties.content_base64!.maxLength, 36_700_160);
      }
    }
  } finally { await client.close(); await server.close(); }
});

test("upload tool enforces variant-specific source base64 ceilings before calling the uploader", async () => {
  let uploadCalls = 0;
  const composition = {
    uploadService: { async upload() { uploadCalls += 1; throw new Error("oversized upload reached service"); }, async invalidateAttempt() {}, async close() {} },
    generationService: { async generate() { throw new Error("unused"); }, async reconcile() { throw new Error("unused"); },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {} }
  };
  const { client, server } = await inspectTools({ ownerSeedreamImageReferences: composition } as unknown as CreateMcpServerOptions);
  const cases = [["seedream-5", 13_981_020], ["seedream-5.0-flash", 14_680_068]] as const;
  try {
    for (const [variant, length] of cases) {
      const result = await client.callTool({ name: "syntx_upload_seedream_image_reference", arguments: {
        link_attempt_id: "link_seedream_tools_test_attempt_000001", variant, content_base64: "A".repeat(length), filename: "large.png", mime_type: "image/png"
      } });
      assert.equal(result.isError, true);
    }
    assert.equal(uploadCalls, 0);
  } finally { await client.close(); await server.close(); }
});

test("reconcile and recovery listing are read-only and unknown errors expose only safe recovery diagnostics", async () => {
  const recoveryId = `seedream_image_recovery_${"a".repeat(8)}-${"b".repeat(4)}-${"c".repeat(4)}-${"d".repeat(4)}-${"e".repeat(12)}`;
  const diagnostic = { phase: "GENERATION_POST", post_started: true, echo_ack_known: false, history_binding: "NONE", history_binding_reason: null,
    history_get_calls: 0, history_get_calls_saturated: false, result_get_calls: 0, result_get_calls_saturated: false,
    result_status: "NOT_READ", result_reason: null } as const;
  const recovery = { recovery_id: recoveryId, created_at: "2026-10-11T00:00:00.000Z", model_id: "seedream-5.0-flash",
    operation_id: "generate-image", status: "OUTCOME_UNKNOWN", diagnostic };
  const composition = {
    uploadService: { async upload() { throw new Error("unused"); }, async invalidateAttempt() {}, async close() {} },
    generationService: { async generate() { throw new Error("unused"); }, async reconcile() {
      throw new OwnerSeedreamImageGenerationServiceError("OUTCOME_UNKNOWN", recoveryId, diagnostic);
    }, async listRecoveries() { return [recovery]; }, async invalidateAttempt() {}, async close() {} }
  };
  const { tools, client, server } = await inspectTools({ ownerSeedreamImageReferences: composition } as unknown as CreateMcpServerOptions);
  try {
    const reconcileTool = tools.find(({ name }) => name === "syntx_owner_reconcile_seedream_image")!;
    const listTool = tools.find(({ name }) => name === "syntx_owner_list_seedream_image_recoveries")!;
    assert.equal(reconcileTool.annotations?.readOnlyHint, true);
    assert.equal(reconcileTool.annotations?.idempotentHint, true);
    assert.equal(listTool.annotations?.readOnlyHint, true);
    assert.equal(listTool.annotations?.idempotentHint, true);
    const attempt = "link_seedream_tools_test_attempt_000001";
    const unknown = await client.callTool({ name: "syntx_owner_reconcile_seedream_image", arguments: { link_attempt_id: attempt, recovery_id: recoveryId } });
    assert.equal(unknown.isError, true);
    assert.equal(JSON.stringify(unknown).includes(recoveryId), true);
    assert.equal(JSON.stringify(unknown).includes("GENERATION_POST"), true);
    assert.equal(JSON.stringify(unknown).includes("principal"), false);
    const listed = await client.callTool({ name: "syntx_owner_list_seedream_image_recoveries", arguments: { link_attempt_id: attempt, limit: 5 } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    assert.equal(JSON.stringify(listed.structuredContent).includes("prompt"), false);
    assert.equal(JSON.stringify(listed.structuredContent).includes("url"), false);
    assert.equal(JSON.stringify(listed.structuredContent).includes("principal"), false);
  } finally { await client.close(); await server.close(); }
});
