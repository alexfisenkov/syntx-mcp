import assert from "node:assert/strict";
import test from "node:test";
import {
  assertConsumerSdkResolution,
  assertStandardImageNativePackagePaths,
  assertStandardImageSourceSnapshot,
  assertStandardImageToolSurface,
  StandardImageNativeToolsError
} from "../scripts/check-installed-standard-image-native-tools.mjs";

const REQUIRED = [
  "dist/src/index.js", "dist/src/index.d.ts",
  "dist/src/application/owner-standard-image-input-validator.js",
  "dist/src/application/owner-standard-image-input-validator.d.ts",
  "dist/src/application/owner-standard-image-aux-input-validator.js",
  "dist/src/application/owner-standard-image-aux-input-validator.d.ts",
  "dist/src/application/owner-standard-image-request-preparer.js",
  "dist/src/application/owner-standard-image-request-preparer.d.ts",
  "dist/src/application/owner-standard-image-history-binding.js",
  "dist/src/application/owner-standard-image-history-binding.d.ts",
  "dist/src/application/owner-standard-image-one-shot-policy.js",
  "dist/src/application/owner-standard-image-one-shot-policy.d.ts",
  "dist/src/application/owner-standard-image-upload-service.js",
  "dist/src/application/owner-standard-image-upload-service.d.ts",
  "dist/src/application/owner-standard-image-generation-service.js",
  "dist/src/application/owner-standard-image-generation-service.d.ts",
  "dist/src/application/owner-banana-image-parameters.js",
  "dist/src/application/owner-banana-image-parameters.d.ts",
  "dist/src/application/owner-banana-image-source-profile.js",
  "dist/src/application/owner-banana-image-source-profile.d.ts",
  "dist/src/application/owner-gpt-image-parameters.js",
  "dist/src/application/owner-gpt-image-parameters.d.ts",
  "dist/src/application/owner-gpt-image-source-profile.js",
  "dist/src/application/owner-gpt-image-source-profile.d.ts",
  "dist/src/mcp/owner-standard-image-tools.js",
  "dist/src/mcp/owner-standard-image-tools.d.ts",
  "dist/src/mcp/server.js", "dist/src/mcp/server.d.ts",
  "dist/src/runtime/observed-owner-runtime.js", "dist/src/runtime/observed-owner-runtime.d.ts",
  "dist/src/transports/stdio-owner.js", "dist/src/transports/stdio-owner.d.ts",
  "dist/src/adapter/syntx/chat-http-client.js", "dist/src/adapter/syntx/chat-http-client.d.ts",
  "dist/src/adapter/syntx/upload-reference-bridge.js", "dist/src/adapter/syntx/upload-reference-bridge.d.ts",
  "dist/src/catalog/selected-discovery-catalog.js", "dist/src/catalog/selected-discovery-catalog.d.ts"
];
const VARIANTS = [
  "banana", "banana-2.1", "banana2", "banana3", "banana3_light",
  "gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"
];
const PHASES = ["REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
  "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "IN_PROGRESS_GET", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"];
const HISTORY_REASONS = ["INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
  "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE",
  "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH",
  "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID", "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS", "BOT_MESSAGE_BEFORE_ACK",
  "BOT_OBJECTS_INVALID", "BOT_MODEL_MISMATCH"];
const RESULT_REASONS = ["NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH",
  "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID",
  "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE"];
const object = (properties, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false
});
const string = { type: "string" };
const num = { type: "integer", minimum: 0, maximum: 34 };
const variants = { type: "string", enum: VARIANTS };
const nullableEnum = (items) => ({ anyOf: [{ type: "string", enum: items }, { type: "null" }] });
const bananaParameters = object({
  aspect_ratio: nullableEnum(["21:9", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "1:1"]),
  image_size: nullableEnum(["1K", "2K", "4K", "0.5K"]),
  thinking_level: nullableEnum(["minimal", "medium", "high"])
});
const gptParameters = object({
  aspect_ratio: { type: "string", enum: ["1:1", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "21:9"] },
  quality: nullableEnum(["1K", "2K", "4K"]),
  details_quality: nullableEnum(["low", "medium", "high", "xhigh", "max"])
});

function validNativeTools() {
  const attempt = { type: "string", pattern: "^link_[A-Za-z0-9_-]{20,120}$" };
  const handle = { type: "string", pattern: "^standard_image_[0-9a-f-]{36}$" };
  const uploadOutput = object({ status: { const: "uploaded" }, reference_handle: handle, variant: variants,
    kind: { enum: ["image", "video", "file"] },
    original_mime_type: { enum: ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif", "video/mp4", "video/webm", "video/quicktime", "video/mpeg", "video/mov", "video/3gpp", "video/x-flv", "video/x-ms-wmv", "application/pdf"] },
    mime_type: { enum: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif", "video/mp4", "video/webm", "video/quicktime", "video/mpeg", "video/3gpp", "video/x-flv", "video/x-ms-wmv", "application/pdf"] },
    width: { anyOf: [{ type: "integer" }, { type: "null" }] }, height: { anyOf: [{ type: "integer" }, { type: "null" }] },
    duration: { anyOf: [{ type: "number" }, { type: "null" }] }, size: { type: "integer", minimum: 1, maximum: 33554432 },
    sha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, expires_in_seconds: num,
    metadata_confidence: { enum: ["CONTAINER_METADATA_ONLY", "NOT_EXTRACTED"] },
    validation_confidence: { enum: [
      "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;BANANA_21_CATALOG_METADATA_CEILING_PROVIDER_UNPROVEN",
      "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
      "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
      "HEIF_PRIMARY_ITEM_ISPE_ASSOCIATION_ONLY;BANANA_21_CATALOG_METADATA_CEILING_PROVIDER_UNPROVEN",
      "HEIF_PRIMARY_ITEM_ISPE_ASSOCIATION_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
      "STRUCTURAL_CONTAINER_VALIDATED_NOT_DECODED", "PDF_HEADER_TAIL_GUARDS_ONLY_NOT_PARSED"
    ] } });
  const ref = object({ kind: { enum: ["image", "video", "file"] }, mime_type: string, width: { anyOf: [{ type: "integer" }, { type: "null" }] },
    height: { anyOf: [{ type: "integer" }, { type: "null" }] }, duration: { anyOf: [{ type: "number" }, { type: "null" }] },
    size: { type: "integer", minimum: 1, maximum: 33554432 }, sha256: string,
    metadata_confidence: { enum: ["CONTAINER_METADATA_ONLY", "UNKNOWN"] } });
  const artifact = object({ url: { type: "string", format: "uri" }, mime_type: { anyOf: [{ type: "string" }, { type: "null" }] },
    mime_source: { enum: ["URL_EXTENSION", "UNKNOWN"] }, width: { type: "null" }, height: { type: "null" }, geometry_verified: { const: false } });
  const costInputs = { anyOf: [
    object({}),
    object({ image_size: { enum: ["1K", "2K", "4K", "0.5K"] } }),
    object({ quality: { enum: ["1K", "2K", "4K"] }, details_quality: { enum: ["low", "medium", "high", "xhigh", "max"] } }),
    object({ quality: { enum: ["1K", "2K", "4K"] }, details_quality: { enum: ["low", "medium", "high", "xhigh", "max"] }, ref_count: { type: "integer", minimum: 1, maximum: 34 } })
  ] };
  const generationOutput = object({ status: { const: "result_observed" }, backend_acceptance: { const: "unproven" },
    ai_name: { enum: ["banana", "sora-images"] }, model_id: variants, variant: variants, operation_id: { const: "generate-image" },
    profile_id: string, profile_schema_hash: string, catalog_version: string, request_fingerprint: string,
    parameters: { anyOf: [bananaParameters, gptParameters] }, cost_inputs: costInputs, cost_input_confidence: string,
    reference_count: num, total_reference_count: num, counts_by_kind: object({ image: num, video: num, file: num }),
    input_references: { type: "array", items: ref, maxItems: 34 },
    actual_image: object({ mime_type: { anyOf: [{ type: "string" }, { type: "null" }] }, width: { type: "null" }, height: { type: "null" } }),
    geometry_verified: { const: false }, artifact });
  const diagnostic = object({ phase: { type: "string", enum: PHASES }, post_started: { type: "boolean" }, echo_ack_known: { type: "boolean" },
    history_binding: { type: "string", enum: ["NONE", "PENDING", "READY", "INVALID"] },
    history_binding_reason: { anyOf: [{ type: "string", enum: HISTORY_REASONS }, { type: "null" }] },
    history_get_calls: num, history_get_calls_saturated: { type: "boolean" }, inprogress_get_calls: num,
    inprogress_get_calls_saturated: { type: "boolean" }, result_get_calls: num, result_get_calls_saturated: { type: "boolean" },
    result_status: { type: "string", enum: ["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"] },
    result_reason: { anyOf: [{ type: "string", enum: RESULT_REASONS }, { type: "null" }] } });
  const recoveryListOutput = object({ recoveries: { type: "array", maxItems: 20, items: object({
    recovery_id: { type: "string", pattern: "^standard_image_recovery_[0-9a-f-]{36}$" }, created_at: string,
    model_id: variants, operation_id: { const: "generate-image" }, status: { const: "OUTCOME_UNKNOWN" }, diagnostic }) },
    confidence_scope: { const: "process_local_get_only_recovery" } });
  const uploadInput = object({ link_attempt_id: attempt, variant: variants,
    content_base64: { type: "string", minLength: 4, maxLength: 44739244,
      pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" },
    filename: { type: "string", description: "Portable basename; local paths and URLs are rejected." },
    mime_type: { type: "string", enum: ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif", "video/mp4", "video/webm", "video/quicktime", "video/mpeg", "video/mov", "video/3gpp", "video/x-flv", "video/x-ms-wmv", "application/pdf"] } });
  const generationInput = object({ link_attempt_id: attempt, variant: variants,
    reference_handles: { type: "array", items: handle, maxItems: 34 },
    parameters: { anyOf: [bananaParameters, gptParameters] }, prompt: { type: "string", description: "65,536-byte local guard." } });
  const listInput = object({ link_attempt_id: attempt, limit: { type: "integer", minimum: 1, maximum: 20, default: 20 } }, ["link_attempt_id"]);
  const tool = (name, inputSchema, outputSchema, readOnly, description = "") => ({ name, inputSchema, outputSchema, description,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: true } });
  return [
    tool("syntx_upload_standard_image_reference", uploadInput, uploadOutput, false),
    tool("syntx_owner_generate_standard_image", generationInput, generationOutput, false,
      "Generation may incur provider cost or token usage; this is not a quote. do not retry an unknown outcome."),
    tool("syntx_owner_reconcile_standard_image", object({ link_attempt_id: attempt,
      recovery_id: { type: "string", pattern: "^standard_image_recovery_[0-9a-f-]{36}$" } }), generationOutput, true,
      "Read-only bounded GET-only reconciliation."),
    tool("syntx_owner_list_standard_image_recoveries", listInput, recoveryListOutput, true,
      "Read-only list; never starts or retries generation.")
  ];
}

test("installed standard image contract requires every runtime and declaration module", () => {
  assert.equal(assertStandardImageNativePackagePaths(new Set(REQUIRED)), true);
  assert.throws(() => assertStandardImageNativePackagePaths(new Set(REQUIRED.slice(1))),
    (error) => error instanceof StandardImageNativeToolsError &&
      error.code === "INSTALLED_STANDARD_IMAGE_PACKAGE_CONTENT_MISSING");
  assert.throws(() => assertStandardImageNativePackagePaths([]),
    (error) => error instanceof StandardImageNativeToolsError &&
      error.code === "INSTALLED_STANDARD_IMAGE_PACKAGE_PATHS_INVALID");
});

test("default standard image surface stays empty and rejects a leaked native tool", () => {
  assert.deepEqual(assertStandardImageToolSurface([], false), { standard_image_tool_count: 0 });
  assert.throws(() => assertStandardImageToolSurface([
    { name: "syntx_owner_generate_standard_image" }
  ], false), (error) => error instanceof StandardImageNativeToolsError &&
    error.code === "INSTALLED_STANDARD_IMAGE_DEFAULT_OFF_FAILED");
});

test("opt-in standard image surface accepts the exact four closed synthetic schemas", () => {
  assert.deepEqual(assertStandardImageToolSurface(validNativeTools(), true, undefined,
    { phases: PHASES, historyReasons: HISTORY_REASONS, resultReasons: RESULT_REASONS }), { standard_image_tool_count: 4 });
});

test("literal negative schema fixtures reject missing variant, widened base64, and private output fields", () => {
  const cases = [
    (tools) => { tools[1].inputSchema.properties.variant.enum.pop(); },
    (tools) => { tools[0].inputSchema.properties.content_base64.maxLength += 1; },
    (tools) => { tools[0].outputSchema.properties.private_url = string; },
    (tools) => { tools[1].inputSchema.properties.parameters.anyOf[0].additionalProperties = true; }
  ];
  for (const mutate of cases) {
    const tools = structuredClone(validNativeTools());
    mutate(tools);
    assert.throws(() => assertStandardImageToolSurface(tools, true, undefined,
      { phases: PHASES, historyReasons: HISTORY_REASONS, resultReasons: RESULT_REASONS }),
      (error) => error instanceof StandardImageNativeToolsError && error.code.startsWith("INSTALLED_STANDARD_IMAGE_"));
  }
  const diagnostics = structuredClone(validNativeTools());
  diagnostics[3].outputSchema.properties.recoveries.items.properties.diagnostic.properties.phase.enum.pop();
  assert.throws(() => assertStandardImageToolSurface(diagnostics, true, undefined,
    { phases: PHASES, historyReasons: HISTORY_REASONS, resultReasons: RESULT_REASONS }),
  (error) => error instanceof StandardImageNativeToolsError && error.code === "INSTALLED_STANDARD_IMAGE_DIAGNOSTIC_ENUM_INVALID");
});

test("source metadata snapshot binds all ten profiles to the selected e551 catalog", () => {
  const version = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
  const profiles = VARIANTS.map((variant, index) => ({
    variant, model_id: variant,
    profile_id: variant.startsWith("banana") ? "banana-image-source-reviewed-v1" : "gpt-image-family-source-reviewed-v1",
    model_type: variant, ai_name: variant.startsWith("banana") ? "banana" : "sora-images",
    public_catalog_version: version,
    operation_id: "generate-image", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
    runtime_activation: false, effective_defaults: "UNKNOWN",
    reference_count: { minimum: 0, maximum: [4, 14, 14, 14, 14, 5, 10, 10, 16, 16][index] },
    profile_schema_hash: `sha256:${"a".repeat(64)}`, source_binding: { selected_public_catalog_version: version }
  }));
  const snapshot = {
    variants: VARIANTS,
    profiles,
    catalogVersion: version,
    banana: { profile_id: "banana-image-source-parameters-v1", variants: VARIANTS.slice(0, 5),
      source_pins: { public_catalog_version: version, form_sha256: "sha256:b66e233dc1ad667fc128b25c19255458ce51fe4bf6e4648d3848b27b402c1c1e",
        settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe", source_execution: false },
      dispatch_allowed: false, backend_acceptance: "UNPROVEN",
      controls: {
        aspect_ratio: { values: [null, "21:9", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "1:1"] },
        image_size: { values_by_variant: { banana: [null], "banana-2.1": ["1K", "2K", "4K"], banana2: ["1K", "2K", "4K"], banana3: ["0.5K", "1K", "2K", "4K"], banana3_light: ["1K"] } },
        thinking_level: { values_by_variant: { banana: [null], "banana-2.1": ["minimal", "medium", "high"], banana2: [null], banana3: [null], banana3_light: [null] } }
      } },
    gpt: { variants: VARIANTS.slice(5), source_pins: { catalog: version,
      form_sha256: "sha256:b30879e1d8171abf2dcab0dd490fbf561fab85495f022c8215b414d17178a966",
      helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
      app_sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" }, dispatch_allowed: false,
      runtime_activation: false, backend_acceptance: "UNPROVEN",
      parameters: {
        aspect_ratio: { legacy_values: ["3:2", "1:1", "2:3"], mapped_values: ["1:1", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "21:9"] },
        quality: { values: ["1K", "2K", "4K"] },
        details_quality: { gpt_image_2_values: ["low", "medium", "high"], gpt_image_25_values: ["low", "medium", "high", "xhigh", "max"] }
      },
      cost_policy: { optional_reference_count_wire: "OMIT_WHEN_ZERO_SOURCE_SERIALIZER_USES_UNDEFINED", amount_currency_actual_billing_hardcap: "UNPROVEN" } },
    inputPolicy: { banana_21: { source_image_max_bytes: 7_340_032 },
      other_variants: { local_process_max_bytes: 33_554_432, policy: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" },
      dimensions: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" }
  };
  const validated = assertStandardImageSourceSnapshot(snapshot);
  assert.deepEqual({ variants: validated.variants, source_metadata: validated.source_metadata,
    selected_catalog: validated.selected_catalog }, { variants: 10, source_metadata: "PASS", selected_catalog: version });
  assert.equal(validated.banana, snapshot.banana);
  assert.equal(validated.gpt, snapshot.gpt);
  assert.throws(() => assertStandardImageSourceSnapshot({ ...snapshot, profiles: profiles.slice(1) }),
    (error) => error instanceof StandardImageNativeToolsError && error.code === "INSTALLED_STANDARD_IMAGE_SOURCE_METADATA_INVALID");
  assert.throws(() => assertStandardImageSourceSnapshot({
    ...snapshot,
    banana: { ...snapshot.banana,
      source_pins: { ...snapshot.banana.source_pins, public_catalog_version: `sha256-${"0".repeat(64)}.json` } }
  }),
  (error) => error instanceof StandardImageNativeToolsError && error.code === "INSTALLED_STANDARD_IMAGE_SOURCE_METADATA_INVALID");
});

test("consumer SDK resolution accepts macOS temp realpaths but rejects repository or unrelated paths", () => {
  const consumerPath = "/var/folders/test/T/syntx-package-smoke/consumer";
  const resolvedConsumerPath = "/private/var/folders/test/T/syntx-package-smoke/consumer";
  const sdkPackagePath = `${consumerPath}/node_modules/@modelcontextprotocol/sdk`;
  const resolvedSdkPackagePath = `${resolvedConsumerPath}/node_modules/@modelcontextprotocol/sdk`;
  const clientModulePath = `${resolvedSdkPackagePath}/dist/esm/client/index.js`;
  const stdioModulePath = `${resolvedSdkPackagePath}/dist/esm/client/stdio.js`;
  const projectRoot = "/Users/AlexFisenkov/Documents/MCP for SYNTX AI";
  assert.equal(clientModulePath.startsWith(`${sdkPackagePath}/`), false,
    "the literal /var to /private realpath alias reproduces the old lexical-prefix failure");
  const valid = { consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath, clientModulePath, stdioModulePath, projectRoot };
  assert.equal(assertConsumerSdkResolution(valid), true);
  assert.throws(() => assertConsumerSdkResolution({ ...valid,
    sdkPackagePath: "/tmp/unrelated/node_modules/@modelcontextprotocol/sdk" }),
  (error) => error instanceof StandardImageNativeToolsError && error.code === "INSTALLED_STANDARD_IMAGE_SDK_NOT_FROM_CONSUMER");
  const escapedSdk = "/external/packages/@modelcontextprotocol/sdk";
  assert.throws(() => assertConsumerSdkResolution({ ...valid, resolvedSdkPackagePath: escapedSdk,
    clientModulePath: `${escapedSdk}/dist/esm/client/index.js`, stdioModulePath: `${escapedSdk}/dist/esm/client/stdio.js` }),
  (error) => error instanceof StandardImageNativeToolsError && error.code === "INSTALLED_STANDARD_IMAGE_SDK_NOT_FROM_CONSUMER");
  const repositorySdk = `${projectRoot}/node_modules/@modelcontextprotocol/sdk`;
  assert.throws(() => assertConsumerSdkResolution({ ...valid, resolvedSdkPackagePath: repositorySdk,
    clientModulePath: `${repositorySdk}/dist/esm/client/index.js`, stdioModulePath: `${repositorySdk}/dist/esm/client/stdio.js` }),
  (error) => error instanceof StandardImageNativeToolsError && error.code === "INSTALLED_STANDARD_IMAGE_SDK_NOT_FROM_CONSUMER");
  assert.throws(() => assertConsumerSdkResolution({ ...valid, clientModulePath: "/tmp/unrelated/sdk/client/index.js" }),
  (error) => error instanceof StandardImageNativeToolsError && error.code === "INSTALLED_STANDARD_IMAGE_SDK_NOT_FROM_CONSUMER");
});
