import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { OwnerStandardImageGenerationServiceError } from "../src/application/owner-standard-image-generation-service.js";
import { OwnerStandardImageUploadServiceError } from "../src/application/owner-standard-image-upload-service.js";
import { createMcpServer, type CreateMcpServerOptions } from "../src/mcp/server.js";

const STANDARD_TOOL_NAMES = [
  "syntx_upload_standard_image_reference",
  "syntx_owner_generate_standard_image",
  "syntx_owner_reconcile_standard_image",
  "syntx_owner_list_standard_image_recoveries"
];

async function names(options?: CreateMcpServerOptions) {
  const server = createMcpServer(createDefaultApplication(), options);
  const client = new Client({ name: "standard-image-composition-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return (await client.listTools()).tools.map(({ name }) => name);
  } finally {
    await client.close();
    await server.close();
  }
}

async function connect(server: ReturnType<typeof createMcpServer>, client: Client): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
}

function digest(value: number): string { return `sha256:${value.toString(16).padStart(2, "0").repeat(32)}`; }

test("standard image tools are absent by default and appear only for explicit composition", async () => {
  const defaultNames = await names();
  assert.equal(STANDARD_TOOL_NAMES.some((name) => defaultNames.includes(name)), false);

  const composition = {
    uploadService: { async upload() { throw new Error("unused upload fixture"); }, async invalidateAttempt() {}, async close() {} },
    generationService: {
      async generate() { throw new Error("unused generation fixture"); },
      async reconcile() { throw new Error("unused reconcile fixture"); },
      async listRecoveries() { return []; },
      async invalidateAttempt() {}, async close() {}
    }
  };
  const ownerNames = await names({ ownerStandardImageReferences: composition } as unknown as CreateMcpServerOptions);
  assert.deepEqual(ownerNames.filter((name) => STANDARD_TOOL_NAMES.includes(name)).sort(), STANDARD_TOOL_NAMES.sort());
});

test("Banana 2.1 accepts the full ordered mixed image-video-file reference set through MCP", async () => {
  const parameters = { aspect_ratio: "1:1", image_size: "1K", thinking_level: "minimal" };
  const references = [
    ...Array.from({ length: 14 }, (_, index) => ({ kind: "image" as const, mime_type: "image/jpeg", width: 1024, height: 768,
      duration: null, size: 1024, sha256: digest(index + 1), metadata_confidence: "CONTAINER_METADATA_ONLY" as const })),
    ...Array.from({ length: 10 }, (_, index) => ({ kind: "video" as const, mime_type: "video/mp4", width: null, height: null,
      duration: null, size: 2048, sha256: digest(index + 15), metadata_confidence: "UNKNOWN" as const })),
    ...Array.from({ length: 10 }, (_, index) => ({ kind: "file" as const, mime_type: "application/pdf", width: null, height: null,
      duration: null, size: 512, sha256: digest(index + 25), metadata_confidence: "UNKNOWN" as const }))
  ];
  const prompt = "Create a coherent image from the ordered mixed references.";
  let received: unknown;
  const composition = {
    uploadService: { async upload() { throw new Error("unused"); }, async invalidateAttempt() {}, async close() {} },
    generationService: {
      async generate(input: unknown) {
        received = input;
        return {
          status: "result_observed", backend_acceptance: "unproven", ai_name: "banana", model_id: "banana-2.1",
          variant: "banana-2.1", operation_id: "generate-image", profile_id: "banana-profile",
          profile_schema_hash: `sha256:${"a".repeat(64)}`, catalog_version: "catalog-v1",
          request_fingerprint: `sha256:${"b".repeat(64)}`, parameters, cost_inputs: { image_size: "1K" },
          cost_input_confidence: "SOURCE_JOINED_METADATA_KEYS_NOT_QUOTE", reference_count: 14, total_reference_count: 34,
          counts_by_kind: { image: 14, video: 10, file: 10 }, input_references: references,
          actual_image: { mime_type: "image/png", width: null, height: null }, geometry_verified: false,
          artifact: { url: "https://r2.syntx.ai/result.png", mime_type: "image/png", mime_source: "URL_EXTENSION",
            width: null, height: null, geometry_verified: false }
        };
      },
      async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; },
      async invalidateAttempt() {}, async close() {}
    }
  };
  const server = createMcpServer(createDefaultApplication(), { ownerStandardImageReferences: composition } as unknown as CreateMcpServerOptions);
  const client = new Client({ name: "standard-image-mixed-reference-test", version: "1.0.0" });
  await connect(server, client);
  try {
    const result = await client.callTool({ name: "syntx_owner_generate_standard_image", arguments: {
      link_attempt_id: "link_standard_test_attempt_000001", variant: "banana-2.1",
      reference_handles: Array.from({ length: 34 }, (_, index) => `standard_image_823e4567-e89b-12d3-a456-${String(index + 1).padStart(12, "0")}`),
      parameters, prompt
    } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal((received as { reference_handles: string[] }).reference_handles.length, 34);
    assert.equal((result.structuredContent as { total_reference_count: number }).total_reference_count, 34);
    const response = JSON.stringify(result);
    assert.equal(response.includes("standard_image_823e4567"), false);
    assert.equal(response.includes(prompt), false);
    assert.equal(response.includes("file_urls"), false);
  } finally { await client.close(); await server.close(); }
});

test("SDK schemas keep all ten variants, all three settings, strict nesting, and the 32 MiB encoded ceiling", async () => {
  let generateCalls = 0;
  const composition = {
    uploadService: { async upload() { throw new Error("unused"); }, async invalidateAttempt() {}, async close() {} },
    generationService: {
      async generate() { generateCalls += 1; throw new Error("should not reach generation"); },
      async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; },
      async invalidateAttempt() {}, async close() {}
    }
  };
  const server = createMcpServer(createDefaultApplication(), { ownerStandardImageReferences: composition } as unknown as CreateMcpServerOptions);
  const client = new Client({ name: "standard-image-schema-test", version: "1.0.0" });
  await connect(server, client);
  try {
    const tools = (await client.listTools()).tools;
    const generate = tools.find(({ name }) => name === "syntx_owner_generate_standard_image")!;
    const upload = tools.find(({ name }) => name === "syntx_upload_standard_image_reference")!;
    const input = generate.inputSchema as { properties: Record<string, { enum?: string[]; anyOf?: Array<{
      properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean
    }> }>; additionalProperties?: boolean };
    assert.deepEqual(input.properties.variant?.enum, ["banana", "banana-2.1", "banana2", "banana3", "banana3_light",
      "gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
    assert.equal(input.properties.reference_handles?.anyOf, undefined);
    assert.equal(input.additionalProperties, false);
    assert.equal(input.properties.parameters?.anyOf?.length, 2);
    for (const branch of input.properties.parameters!.anyOf!) {
      assert.deepEqual(branch.required?.sort(), ["aspect_ratio", "details_quality", "image_size", "quality", "thinking_level"].filter((key) =>
        Object.hasOwn(branch.properties ?? {}, key)).sort());
      assert.equal(branch.additionalProperties, false);
      assert.equal(Object.keys(branch.properties ?? {}).length, 3);
    }
    const uploadInput = upload.inputSchema as { properties: Record<string, { maxLength?: number; enum?: string[] }> };
    assert.equal(uploadInput.properties.content_base64?.maxLength, 44_739_244);
    assert.deepEqual(uploadInput.properties.mime_type?.enum, ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif",
      "image/heic", "image/heif", "video/mp4", "video/webm", "video/quicktime", "video/mpeg", "video/mov",
      "video/3gpp", "video/x-flv", "video/x-ms-wmv", "application/pdf"]);

    const invalid = await client.callTool({ name: "syntx_owner_generate_standard_image", arguments: {
      link_attempt_id: "link_standard_test_attempt_000001", variant: "gpt-image-2.5-flare", reference_handles: [],
      parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "low", file_urls: ["https://private.invalid/ref"] },
      prompt: "Do not forward caller supplied URL-like fields."
    } });
    assert.equal(invalid.isError, true);
    assert.equal(generateCalls, 0);
    const mismatchedVariant = await client.callTool({ name: "syntx_owner_generate_standard_image", arguments: {
      link_attempt_id: "link_standard_test_attempt_000001", variant: "gpt-image-1", reference_handles: [],
      parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "low" }, prompt: "Inactive controls are explicit nulls."
    } });
    assert.equal(mismatchedVariant.isError, true);
    assert.equal(generateCalls, 0);
    const malformedUnicode = await client.callTool({ name: "syntx_owner_generate_standard_image", arguments: {
      link_attempt_id: "link_standard_test_attempt_000001", variant: "banana", reference_handles: [],
      parameters: { aspect_ratio: "1:1", image_size: null, thinking_level: null }, prompt: "\uD800"
    } });
    assert.equal(malformedUnicode.isError, true);
    assert.equal(generateCalls, 0);
    const reconcile = tools.find(({ name }) => name === "syntx_owner_reconcile_standard_image")!;
    const list = tools.find(({ name }) => name === "syntx_owner_list_standard_image_recoveries")!;
    assert.equal((reconcile.annotations as { readOnlyHint?: boolean }).readOnlyHint, true);
    assert.equal((list.annotations as { readOnlyHint?: boolean }).readOnlyHint, true);
    assert.equal((generate.annotations as { readOnlyHint?: boolean }).readOnlyHint, false);
    assert.throws(() => createMcpServer(createDefaultApplication(), {
      ownerStandardImageReferences: composition,
      ownerDurableGeneration: {} as NonNullable<CreateMcpServerOptions["ownerDurableGeneration"]>
    }), /OWNER_DURABLE_GENERATION_COMPOSITION_CONFLICT/u);
  } finally { await client.close(); await server.close(); }
});

test("all ten source variants accept only their complete explicit three-field setting state", async () => {
  const cases = [
    { variant: "banana", ai_name: "banana", parameters: { aspect_ratio: "1:1", image_size: null, thinking_level: null },
      cost_inputs: {}, confidence: "SOURCE_JOINED_METADATA_KEYS_NOT_QUOTE" },
    { variant: "banana-2.1", ai_name: "banana", parameters: { aspect_ratio: "16:9", image_size: "2K", thinking_level: "high" },
      cost_inputs: { image_size: "2K" }, confidence: "SOURCE_JOINED_METADATA_KEYS_NOT_QUOTE" },
    { variant: "banana2", ai_name: "banana", parameters: { aspect_ratio: "4:3", image_size: "4K", thinking_level: null },
      cost_inputs: { image_size: "4K" }, confidence: "SOURCE_JOINED_METADATA_KEYS_NOT_QUOTE" },
    { variant: "banana3", ai_name: "banana", parameters: { aspect_ratio: "9:16", image_size: "0.5K", thinking_level: null },
      cost_inputs: { image_size: "0.5K" }, confidence: "SOURCE_JOINED_METADATA_KEYS_NOT_QUOTE" },
    { variant: "banana3_light", ai_name: "banana", parameters: { aspect_ratio: null, image_size: "1K", thinking_level: null },
      cost_inputs: { image_size: "1K" }, confidence: "SOURCE_JOINED_METADATA_KEYS_NOT_QUOTE" },
    { variant: "gpt-image-1", ai_name: "sora-images", parameters: { aspect_ratio: "3:2", quality: null, details_quality: null },
      cost_inputs: {}, confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" },
    { variant: "gpt-image-1.5", ai_name: "sora-images", parameters: { aspect_ratio: "1:1", quality: null, details_quality: null },
      cost_inputs: {}, confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" },
    { variant: "gpt-image-2", ai_name: "sora-images", parameters: { aspect_ratio: "21:9", quality: "1K", details_quality: "medium" },
      cost_inputs: { quality: "1K", details_quality: "medium" }, confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" },
    { variant: "gpt-image-2.5-flare", ai_name: "sora-images", parameters: { aspect_ratio: "5:4", quality: "4K", details_quality: "xhigh" },
      cost_inputs: { quality: "4K", details_quality: "xhigh" }, confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" },
    { variant: "gpt-image-2.5-sunburst", ai_name: "sora-images", parameters: { aspect_ratio: "2:3", quality: "2K", details_quality: "max" },
      cost_inputs: { quality: "2K", details_quality: "max" }, confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" }
  ] as const;
  const composition = {
    uploadService: { async upload() { throw new Error("unused"); }, async invalidateAttempt() {}, async close() {} },
    generationService: {
      async generate(input: unknown) {
        const request = input as { variant: string; parameters: object };
        const selected = cases.find((entry) => entry.variant === request.variant)!;
        return {
          status: "result_observed", backend_acceptance: "unproven", ai_name: selected.ai_name,
          model_id: selected.variant, variant: selected.variant, operation_id: "generate-image", profile_id: "source-profile",
          profile_schema_hash: `sha256:${"a".repeat(64)}`, catalog_version: "catalog-v1",
          request_fingerprint: `sha256:${"b".repeat(64)}`, parameters: request.parameters,
          cost_inputs: selected.cost_inputs, cost_input_confidence: selected.confidence,
          reference_count: 0, total_reference_count: 0, counts_by_kind: { image: 0, video: 0, file: 0 }, input_references: [],
          actual_image: { mime_type: null, width: null, height: null }, geometry_verified: false,
          artifact: { url: "https://r2.syntx.ai/result.png", mime_type: "image/png", mime_source: "URL_EXTENSION",
            width: null, height: null, geometry_verified: false }
        };
      },
      async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; },
      async invalidateAttempt() {}, async close() {}
    }
  };
  const server = createMcpServer(createDefaultApplication(), { ownerStandardImageReferences: composition } as unknown as CreateMcpServerOptions);
  const client = new Client({ name: "standard-image-all-variants-test", version: "1.0.0" });
  await connect(server, client);
  try {
    for (const entry of cases) {
      const output = await client.callTool({ name: "syntx_owner_generate_standard_image", arguments: {
        link_attempt_id: "link_standard_test_attempt_000001", variant: entry.variant, reference_handles: [],
        parameters: entry.parameters, prompt: `Explicit settings for ${entry.variant}.`
      } });
      assert.equal(output.isError, undefined, `${entry.variant}: ${JSON.stringify(output)}`);
      assert.deepEqual((output.structuredContent as { parameters: unknown }).parameters, entry.parameters);
      assert.deepEqual((output.structuredContent as { cost_inputs: unknown }).cost_inputs, entry.cost_inputs);
    }
  } finally { await client.close(); await server.close(); }
});

test("empty GPT Image 2.5 input preserves explicit settings and omits zero ref_count from source cost inputs", async () => {
  let received: unknown;
  const parameters = { aspect_ratio: "1:1", quality: "2K", details_quality: "max" };
  const resultDto = {
    status: "result_observed", backend_acceptance: "unproven", ai_name: "sora-images", model_id: "gpt-image-2.5-sunburst",
    variant: "gpt-image-2.5-sunburst", operation_id: "generate-image", profile_id: "gpt-profile",
    profile_schema_hash: `sha256:${"a".repeat(64)}`, catalog_version: "catalog-v1",
    request_fingerprint: `sha256:${"b".repeat(64)}`, parameters, cost_inputs: { quality: "2K", details_quality: "max" },
    cost_input_confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP",
    reference_count: 0, total_reference_count: 0, counts_by_kind: { image: 0, video: 0, file: 0 }, input_references: [],
    actual_image: { mime_type: null, width: null, height: null }, geometry_verified: false,
    artifact: { url: "https://r2.syntx.ai/result.unknown", mime_type: null, mime_source: "UNKNOWN",
      width: null, height: null, geometry_verified: false }
  };
  const composition = {
    uploadService: { async upload() { throw new Error("unused"); }, async invalidateAttempt() {}, async close() {} },
    generationService: {
      async generate(input: unknown) { received = input; return resultDto; },
      async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; },
      async invalidateAttempt() {}, async close() {}
    }
  };
  const server = createMcpServer(createDefaultApplication(), { ownerStandardImageReferences: composition } as unknown as CreateMcpServerOptions);
  const client = new Client({ name: "standard-image-zero-cost-input-test", version: "1.0.0" });
  await connect(server, client);
  try {
    const output = await client.callTool({ name: "syntx_owner_generate_standard_image", arguments: {
      link_attempt_id: "link_standard_test_attempt_000001", variant: "gpt-image-2.5-sunburst", reference_handles: [],
      parameters, prompt: "Generate from a new prompt without references."
    } });
    assert.equal(output.isError, undefined, JSON.stringify(output));
    assert.deepEqual((received as { reference_handles: string[] }).reference_handles, []);
    assert.deepEqual((output.structuredContent as { cost_inputs: unknown }).cost_inputs, { quality: "2K", details_quality: "max" });
    assert.deepEqual((output.structuredContent as { artifact: unknown }).artifact, resultDto.artifact);
  } finally { await client.close(); await server.close(); }
});

test("upload receipt and unknown-outcome errors expose only strict public DTOs", async () => {
  const privateMarker = "PRIVATE_FILE_URL_PROVIDER_BODY_PROMPT_FILENAME";
  const receipt = {
    status: "uploaded", reference_handle: "standard_image_823e4567-e89b-12d3-a456-426614174000", variant: "gpt-image-2",
    kind: "image", original_mime_type: "image/jpeg", mime_type: "image/jpeg", width: 1024, height: 768, duration: null,
    size: 4096, sha256: `sha256:${"c".repeat(64)}`, expires_in_seconds: 899,
    metadata_confidence: "CONTAINER_METADATA_ONLY", validation_confidence: "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT"
  };
  const uploadInputByKind = {
    video: { ...receipt, variant: "banana-2.1", kind: "video", original_mime_type: "video/mov", mime_type: "video/quicktime",
      width: null, height: null, duration: null, metadata_confidence: "NOT_EXTRACTED",
      validation_confidence: "STRUCTURAL_CONTAINER_VALIDATED_NOT_DECODED" },
    file: { ...receipt, variant: "banana-2.1", kind: "file", original_mime_type: "application/pdf", mime_type: "application/pdf",
      width: null, height: null, duration: null, metadata_confidence: "NOT_EXTRACTED",
      validation_confidence: "PDF_HEADER_TAIL_GUARDS_ONLY_NOT_PARSED" }
  };
  const diagnostic = {
    phase: "GENERATION_POST", post_started: true, echo_ack_known: false, history_binding: "NONE", history_binding_reason: null,
    history_get_calls: 0, history_get_calls_saturated: false, inprogress_get_calls: 0, inprogress_get_calls_saturated: false,
    result_get_calls: 0, result_get_calls_saturated: false, result_status: "NOT_READ", result_reason: null
  } as const;
  let uploadCalls = 0;
  const composition = {
    uploadService: {
      async upload() {
        uploadCalls += 1;
        if (uploadCalls > 1) throw new OwnerStandardImageUploadServiceError("UPLOAD_OUTCOME_UNKNOWN");
        return receipt;
      }, async invalidateAttempt() {}, async close() {}
    },
    generationService: {
      async generate() { throw new Error(privateMarker); },
      async reconcile() { throw new OwnerStandardImageGenerationServiceError("OUTCOME_UNKNOWN",
        "standard_image_recovery_823e4567-e89b-12d3-a456-426614174001", diagnostic); },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {}
    }
  };
  const server = createMcpServer(createDefaultApplication(), { ownerStandardImageReferences: composition } as unknown as CreateMcpServerOptions);
  const client = new Client({ name: "standard-image-public-dto-test", version: "1.0.0" });
  await connect(server, client);
  try {
    const uploaded = await client.callTool({ name: "syntx_upload_standard_image_reference", arguments: {
      link_attempt_id: "link_standard_test_attempt_000001", variant: "gpt-image-2",
      content_base64: "AAAA", filename: "safe.jpg", mime_type: "image/jpeg"
    } });
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
    assert.deepEqual(Object.keys(uploaded.structuredContent as object).sort(), ["status", "reference_handle", "variant", "kind",
      "original_mime_type", "mime_type", "width", "height", "duration", "size", "sha256", "expires_in_seconds",
      "metadata_confidence", "validation_confidence"].sort());
    assert.equal(JSON.stringify(uploaded).includes("filename"), false);

    const uploadUnknown = await client.callTool({ name: "syntx_upload_standard_image_reference", arguments: {
      link_attempt_id: "link_standard_test_attempt_000001", variant: "gpt-image-2",
      content_base64: "AAAA", filename: "safe.jpg", mime_type: "image/jpeg"
    } });
    assert.equal(uploadUnknown.isError, true);
    assert.equal(JSON.stringify(uploadUnknown).includes("UPLOAD_OUTCOME_UNKNOWN"), true);
    assert.equal(JSON.stringify(uploadUnknown).includes(privateMarker), false);

    for (const [mimeType, expected] of [["video/mov", uploadInputByKind.video], ["application/pdf", uploadInputByKind.file]] as const) {
      uploadCalls = 2;
      (composition.uploadService.upload as (input: unknown) => Promise<unknown>) = async () => expected;
      const auxiliary = await client.callTool({ name: "syntx_upload_standard_image_reference", arguments: {
        link_attempt_id: "link_standard_test_attempt_000001", variant: "banana-2.1",
        content_base64: "AAAA", filename: "safe-input", mime_type: mimeType
      } });
      assert.equal(auxiliary.isError, undefined, JSON.stringify(auxiliary));
      assert.equal((auxiliary.structuredContent as { kind: string }).kind, expected.kind);
      assert.equal((auxiliary.structuredContent as { metadata_confidence: string }).metadata_confidence, "NOT_EXTRACTED");
    }

    const reconciled = await client.callTool({ name: "syntx_owner_reconcile_standard_image", arguments: {
      link_attempt_id: "link_standard_test_attempt_000001", recovery_id: "standard_image_recovery_823e4567-e89b-12d3-a456-426614174001"
    } });
    const text = JSON.stringify(reconciled);
    assert.equal(reconciled.isError, true);
    assert.equal(text.includes("OUTCOME_UNKNOWN"), true);
    assert.equal(text.includes("standard_image_recovery_823e4567-e89b-12d3-a456-426614174001"), true);
    assert.equal(text.includes(privateMarker), false);
    assert.equal(text.includes("PRIVATE_FILE_URL"), false);
  } finally { await client.close(); await server.close(); }
});

test("local prompt budget blocks before service invocation and malformed service output is redacted", async () => {
  const secret = "PRIVATE_URL_FILE_ID_RAW_ERROR_PROMPT";
  let calls = 0;
  const composition = {
    uploadService: { async upload() { throw new Error("unused"); }, async invalidateAttempt() {}, async close() {} },
    generationService: {
      async generate() { calls += 1; return { status: "result_observed", private_url: secret, prompt: secret, raw_error: secret }; },
      async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; },
      async invalidateAttempt() {}, async close() {}
    }
  };
  const server = createMcpServer(createDefaultApplication(), { ownerStandardImageReferences: composition } as unknown as CreateMcpServerOptions);
  const client = new Client({ name: "standard-image-bounded-input-test", version: "1.0.0" });
  await connect(server, client);
  try {
    const oversized = await client.callTool({ name: "syntx_owner_generate_standard_image", arguments: {
      link_attempt_id: "link_standard_test_attempt_000001", variant: "banana", reference_handles: [],
      parameters: { aspect_ratio: "1:1", image_size: null, thinking_level: null }, prompt: "a".repeat(65_537)
    } });
    assert.equal(oversized.isError, true);
    assert.equal(calls, 0);

    const malformed = await client.callTool({ name: "syntx_owner_generate_standard_image", arguments: {
      link_attempt_id: "link_standard_test_attempt_000001", variant: "banana", reference_handles: [],
      parameters: { aspect_ratio: "1:1", image_size: null, thinking_level: null }, prompt: "valid prompt"
    } });
    assert.equal(malformed.isError, true);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(malformed).includes(secret), false);
    assert.equal(JSON.stringify(malformed).includes("GENERATION_FAILED"), true);
  } finally { await client.close(); await server.close(); }
});

test("reconcile and recovery listing stay GET-only and return the closed 569 DTOs", async () => {
  const diagnostic = {
    phase: "RESULT_WAIT", post_started: true, echo_ack_known: true, history_binding: "READY", history_binding_reason: null,
    history_get_calls: 1, history_get_calls_saturated: false, inprogress_get_calls: 0, inprogress_get_calls_saturated: false,
    result_get_calls: 1, result_get_calls_saturated: false, result_status: "PENDING", result_reason: "RESULT_NOT_COMPLETED"
  } as const;
  const recovery = {
    recovery_id: "standard_image_recovery_823e4567-e89b-12d3-a456-426614174001", created_at: "2026-10-10T12:00:00.000Z",
    model_id: "banana", operation_id: "generate-image", status: "OUTCOME_UNKNOWN", diagnostic
  } as const;
  const resultDto = {
    status: "result_observed", backend_acceptance: "unproven", ai_name: "banana", model_id: "banana", variant: "banana",
    operation_id: "generate-image", profile_id: "banana-profile", profile_schema_hash: `sha256:${"a".repeat(64)}`,
    catalog_version: "catalog-v1", request_fingerprint: `sha256:${"b".repeat(64)}`,
    parameters: { aspect_ratio: "1:1", image_size: null, thinking_level: null }, cost_inputs: {},
    cost_input_confidence: "SOURCE_JOINED_METADATA_KEYS_NOT_QUOTE", reference_count: 0, total_reference_count: 0,
    counts_by_kind: { image: 0, video: 0, file: 0 }, input_references: [],
    actual_image: { mime_type: null, width: null, height: null }, geometry_verified: false,
    artifact: { url: "https://r2.syntx.ai/result", mime_type: null, mime_source: "UNKNOWN", width: null, height: null, geometry_verified: false }
  };
  const calls: string[] = [];
  let reconcileInput: unknown;
  let listInput: unknown;
  const composition = {
    uploadService: { async upload() { throw new Error("unused"); }, async invalidateAttempt() {}, async close() {} },
    generationService: {
      async generate() { calls.push("generate"); throw new Error("must not run"); },
      async reconcile(input: unknown) { calls.push("reconcile"); reconcileInput = input; return resultDto; },
      async listRecoveries(input: unknown) { calls.push("list"); listInput = input; return [recovery]; },
      async invalidateAttempt() {}, async close() {}
    }
  };
  const server = createMcpServer(createDefaultApplication(), { ownerStandardImageReferences: composition } as unknown as CreateMcpServerOptions);
  const client = new Client({ name: "standard-image-read-only-recovery-test", version: "1.0.0" });
  await connect(server, client);
  try {
    const reconciled = await client.callTool({ name: "syntx_owner_reconcile_standard_image", arguments: {
      link_attempt_id: "link_standard_test_attempt_000001", recovery_id: recovery.recovery_id
    } });
    assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled));
    assert.equal((reconciled.structuredContent as { backend_acceptance: string }).backend_acceptance, "unproven");
    assert.deepEqual(reconcileInput, { attemptId: "link_standard_test_attempt_000001", recovery_id: recovery.recovery_id });
    const listed = await client.callTool({ name: "syntx_owner_list_standard_image_recoveries", arguments: {
      link_attempt_id: "link_standard_test_attempt_000001", limit: 3
    } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    assert.deepEqual((listed.structuredContent as { recoveries: unknown[] }).recoveries, [recovery]);
    assert.equal((listed.structuredContent as { confidence_scope: string }).confidence_scope, "process_local_get_only_recovery");
    assert.deepEqual(listInput, { attemptId: "link_standard_test_attempt_000001", limit: 3 });
    assert.deepEqual(calls, ["reconcile", "list"]);
  } finally { await client.close(); await server.close(); }
});
