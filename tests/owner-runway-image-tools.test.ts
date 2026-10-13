import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { OwnerRunwayImageGenerationServiceError } from "../src/application/owner-runway-image-generation-service.js";
import { createMcpServer, type CreateMcpServerOptions } from "../src/mcp/server.js";

const TOOL_NAMES = [
  "syntx_upload_runway_image_reference",
  "syntx_owner_generate_runway_image",
  "syntx_owner_reconcile_runway_image",
  "syntx_owner_list_runway_image_recoveries"
];

async function inspectTools(options?: CreateMcpServerOptions) {
  const server = createMcpServer(createDefaultApplication(), options);
  const client = new Client({ name: "runway-image-tools-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return { tools: (await client.listTools()).tools, client, server }; }
  catch (error) { await client.close(); await server.close(); throw error; }
}

test("Runway image tools are absent by default and appear for explicit owner composition", async () => {
  const defaults = await inspectTools();
  try { assert.equal(defaults.tools.some(({ name }) => TOOL_NAMES.includes(name)), false); }
  finally { await defaults.client.close(); await defaults.server.close(); }

  const composition = {
    uploadService: { async upload() { throw new Error("unused"); }, async invalidateAttempt() {}, async close() {} },
    generationService: { async generate() { throw new Error("unused"); }, async reconcile() { throw new Error("unused"); },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {} }
  };
  const owner = await inspectTools({ ownerRunwayImageReferences: composition } as unknown as CreateMcpServerOptions);
  try { assert.deepEqual(owner.tools.map(({ name }) => name).filter((name) => TOOL_NAMES.includes(name)).sort(), [...TOOL_NAMES].sort()); }
  finally { await owner.client.close(); await owner.server.close(); }
  assert.throws(() => createMcpServer(createDefaultApplication(), {
    ownerRunwayImageReferences: composition,
    ownerDurableGeneration: {} as NonNullable<CreateMcpServerOptions["ownerDurableGeneration"]>
  } as unknown as CreateMcpServerOptions), /OWNER_DURABLE_GENERATION_COMPOSITION_CONFLICT/u);
});

test("Runway schema exposes every resolution and finite fractional temperature without rounding", async () => {
  let received: unknown;
  const result = {
    status: "result_observed", backend_acceptance: "unproven", ai_name: "runway-frames", model_id: "runway_frames",
    variant: "runway_frames", operation_id: "generate-image", profile_id: "runway_profile", profile_schema_hash: `sha256:${"a".repeat(64)}`,
    catalog_version: "catalog-v1", request_fingerprint: `sha256:${"b".repeat(64)}`,
    parameters: { resolution: "2112x912", temperature: 1.25 }, cost_inputs: {},
    cost_input_confidence: "SOURCE_JOINED_METADATA_KEYS_NONE_NOT_FREE_PRICE", reference_count: 0, input_references: [],
    actual_image: { mime_type: null, width: null, height: null }, geometry_verified: false,
    artifact: { url: "https://r2.syntx.ai/result.unknown", mime_type: null, mime_source: "UNKNOWN", width: null, height: null, geometry_verified: false }
  };
  const composition = {
    uploadService: { async upload() { throw new Error("unused"); }, async invalidateAttempt() {}, async close() {} },
    generationService: {
      async generate(input: unknown) { received = input; return result; }, async reconcile() { throw new Error("unused"); },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {}
    }
  };
  const { tools, client, server } = await inspectTools({ ownerRunwayImageReferences: composition } as unknown as CreateMcpServerOptions);
  try {
    const tool = tools.find(({ name }) => name === "syntx_owner_generate_runway_image")!;
    const schema = tool.inputSchema as { properties: Record<string, { enum?: string[]; maximum?: number; items?: { pattern?: string }; maxItems?: number }>;
      required?: string[]; additionalProperties?: boolean };
    assert.deepEqual(schema.properties.parameters && (schema.properties.parameters as unknown as { properties: { resolution: { enum: string[] }; temperature: { minimum: number; maximum: number; multipleOf?: number } } }).properties.resolution.enum,
      ["2112x912", "1920x1088", "1456x1088", "1088x1088", "1088x1456", "1088x1920"]);
    const temperatureSchema = (schema.properties.parameters as unknown as { properties: { temperature: { minimum: number; maximum: number; multipleOf?: number } } }).properties.temperature;
    assert.equal(temperatureSchema.minimum, 1);
    assert.equal(temperatureSchema.maximum, 5);
    assert.equal(temperatureSchema.multipleOf, undefined);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.reference_handles?.maxItems, 3);
    assert.match(schema.properties.reference_handles?.items?.pattern ?? "", /^\^runway_image_/u);
    assert.deepEqual(schema.required?.sort(), ["link_attempt_id", "variant", "reference_handles", "parameters", "prompt"].sort());
    const valid = await client.callTool({ name: "syntx_owner_generate_runway_image", arguments: {
      link_attempt_id: "link_runway_test_attempt_000001", variant: "runway_frames", reference_handles: [],
      parameters: { resolution: "2112x912", temperature: 1.25 }, prompt: "Keep fractional temperature unchanged."
    } });
    assert.equal(valid.isError, undefined, JSON.stringify(valid));
    assert.equal((received as { parameters: { temperature: number } }).parameters.temperature, 1.25);
    const invalid = await client.callTool({ name: "syntx_owner_generate_runway_image", arguments: {
      link_attempt_id: "link_runway_test_attempt_000001", variant: "runway_frames", reference_handles: [],
      parameters: { resolution: "2112x912", temperature: 3 }, prompt: "Extra keys are rejected.", private_file_url: "https://private.invalid"
    } });
    assert.equal(invalid.isError, true);
    assert.equal(JSON.stringify(invalid).includes("private.invalid"), false);
    assert.equal((received as { parameters: { temperature: number } }).parameters.temperature, 1.25);
  } finally { await client.close(); await server.close(); }
});

test("Runway upload, reconciliation, recovery listing, and unknown-outcome errors stay source-shaped and private", async () => {
  const attempt = "link_runway_test_attempt_000001";
  const recoveryId = `runway_image_recovery_${"a".repeat(8)}-${"b".repeat(4)}-${"c".repeat(4)}-${"d".repeat(4)}-${"e".repeat(12)}`;
  const diagnostic = { phase: "GENERATION_POST", post_started: true, echo_ack_known: false, history_binding: "NONE",
    history_binding_reason: null, history_get_calls: 0, history_get_calls_saturated: false, result_get_calls: 0,
    result_get_calls_saturated: false, result_status: "NOT_READ", result_reason: null } as const;
  const generation = {
    status: "result_observed", backend_acceptance: "unproven", ai_name: "runway-frames", model_id: "runway_frames", variant: "runway_frames",
    operation_id: "generate-image", profile_id: "runway_profile", profile_schema_hash: `sha256:${"a".repeat(64)}`,
    catalog_version: "catalog-v1", request_fingerprint: `sha256:${"b".repeat(64)}`,
    parameters: { resolution: "1920x1088", temperature: 3.5 }, cost_inputs: {},
    cost_input_confidence: "SOURCE_JOINED_METADATA_KEYS_NONE_NOT_FREE_PRICE", reference_count: 0, input_references: [],
    actual_image: { mime_type: "image/png", width: null, height: null }, geometry_verified: false,
    artifact: { url: "https://r2.syntx.ai/result.png", mime_type: "image/png", mime_source: "URL_EXTENSION", width: null, height: null, geometry_verified: false }
  };
  const recovery = { recovery_id: recoveryId, created_at: "2026-10-11T00:00:00.000Z", model_id: "runway_frames",
    operation_id: "generate-image", status: "OUTCOME_UNKNOWN", diagnostic };
  const calls: string[] = [];
  const composition = {
    uploadService: { async upload(input: unknown) { calls.push("upload"); assert.equal((input as { attemptId: string }).attemptId, attempt);
      return { status: "uploaded", reference_handle: `runway_image_${"1".repeat(8)}-${"2".repeat(4)}-${"3".repeat(4)}-${"4".repeat(4)}-${"5".repeat(12)}`,
        variant: "runway_frames", original_mime_type: "image/jpeg", mime_type: "image/jpeg", width: 12, height: 8, size: 42,
        sha256: `sha256:${"c".repeat(64)}`, expires_in_seconds: 900, metadata_confidence: "CONTAINER_METADATA_ONLY",
        validation_confidence: "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" }; },
      async invalidateAttempt() {}, async close() {} },
    generationService: {
      async generate() { return generation; },
      async reconcile() { calls.push("reconcile"); return generation; },
      async listRecoveries() { calls.push("list"); return [recovery]; }, async invalidateAttempt() {}, async close() {}
    }
  };
  const { client, server } = await inspectTools({ ownerRunwayImageReferences: composition } as unknown as CreateMcpServerOptions);
  try {
    const uploaded = await client.callTool({ name: "syntx_upload_runway_image_reference", arguments: {
      link_attempt_id: attempt, variant: "runway_frames", content_base64: "AAAA", filename: "reference.jpg", mime_type: "image/jpeg"
    } });
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
    assert.equal((uploaded.structuredContent as { status: string }).status, "uploaded");
    const reconciled = await client.callTool({ name: "syntx_owner_reconcile_runway_image", arguments: { link_attempt_id: attempt, recovery_id: recoveryId } });
    assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled));
    const listed = await client.callTool({ name: "syntx_owner_list_runway_image_recoveries", arguments: { link_attempt_id: attempt } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    const text = JSON.stringify(listed.structuredContent);
    assert.equal(text.includes("prompt"), false);
    assert.equal(text.includes("url"), false);
    assert.equal(text.includes("principal"), false);
    assert.deepEqual(calls, ["upload", "reconcile", "list"]);

    const badComposition = { ...composition, generationService: { ...composition.generationService,
      async reconcile() { throw new Error("sensitive provider body should not escape"); } } };
    const badServer = createMcpServer(createDefaultApplication(), { ownerRunwayImageReferences: badComposition } as unknown as CreateMcpServerOptions);
    const badClient = new Client({ name: "runway-error-redaction-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await badServer.connect(serverTransport);
    await badClient.connect(clientTransport);
    try {
      const error = await badClient.callTool({ name: "syntx_owner_reconcile_runway_image", arguments: { link_attempt_id: attempt, recovery_id: recoveryId } });
      assert.equal(error.isError, true);
      assert.equal(JSON.stringify(error).includes("sensitive provider body"), false);
      assert.equal(JSON.stringify(error).includes(recoveryId), false);
      const invalidOutputServer = createMcpServer(createDefaultApplication(), { ownerRunwayImageReferences: {
        ...composition, generationService: { ...composition.generationService,
          async generate() { return { ...generation, private_file_url: "https://private.invalid/secret" }; } }
      } } as unknown as CreateMcpServerOptions);
      const invalidOutputClient = new Client({ name: "runway-invalid-output-test", version: "1.0.0" });
      const [invalidClientTransport, invalidServerTransport] = InMemoryTransport.createLinkedPair();
      await invalidOutputServer.connect(invalidServerTransport);
      await invalidOutputClient.connect(invalidClientTransport);
      try {
        const invalidOutput = await invalidOutputClient.callTool({ name: "syntx_owner_generate_runway_image", arguments: {
          link_attempt_id: attempt, variant: "runway_frames", reference_handles: [],
          parameters: generation.parameters, prompt: "Output schemas must reject undeclared fields."
        } });
        assert.equal(invalidOutput.isError, true);
        assert.equal(JSON.stringify(invalidOutput).includes("private.invalid"), false);
      } finally { await invalidOutputClient.close(); await invalidOutputServer.close(); }

      const unknownComposition = { ...composition, generationService: { ...composition.generationService,
        async reconcile() { throw new OwnerRunwayImageGenerationServiceError("OUTCOME_UNKNOWN", recoveryId, diagnostic); } } };
      const unknownServer = createMcpServer(createDefaultApplication(), { ownerRunwayImageReferences: unknownComposition } as unknown as CreateMcpServerOptions);
      const unknownClient = new Client({ name: "runway-outcome-unknown-test", version: "1.0.0" });
      const [unknownClientTransport, unknownServerTransport] = InMemoryTransport.createLinkedPair();
      await unknownServer.connect(unknownServerTransport);
      await unknownClient.connect(unknownClientTransport);
      try {
        const unknown = await unknownClient.callTool({ name: "syntx_owner_reconcile_runway_image", arguments: { link_attempt_id: attempt, recovery_id: recoveryId } });
        const unknownText = JSON.stringify(unknown);
        assert.equal(unknown.isError, true);
        assert.equal(unknownText.includes(recoveryId), true);
        assert.equal(unknownText.includes("diagnostic"), true);
        assert.equal(unknownText.includes("principal"), false);
      } finally { await unknownClient.close(); await unknownServer.close(); }
    } finally { await badClient.close(); await badServer.close(); }
  } finally { await client.close(); await server.close(); }
});
