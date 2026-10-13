import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../dist/src/application/factory.js";
import * as compiledRunwayParameters from "../dist/src/application/owner-runway-image-parameters.js";
import * as compiledRunwayProfile from "../dist/src/application/owner-runway-image-source-profile.js";
import * as compiledServer from "../dist/src/mcp/server.js";
import * as compiledGeneration from "../dist/src/application/owner-runway-image-generation-service.js";
import * as compiledRunwayTools from "../dist/src/mcp/owner-runway-image-tools.js";
import * as compiledSelectedCatalog from "../dist/src/catalog/selected-discovery-catalog.js";
import {
  assertConsumerSdkResolution,
  assertRunwayImageNativePackagePaths,
  assertRunwayImageToolNames,
  assertRunwayImageToolSurface,
  mapRunwayImageNativeModules,
  runwayImageUnexpectedErrorCode,
  RunwayImageNativeToolsError
} from "../scripts/check-installed-runway-image-native-tools.mjs";

const REQUIRED = [
  "dist/src/index.js", "dist/src/index.d.ts",
  ...[
    "application/owner-runway-image-parameters",
    "application/owner-runway-image-source-profile",
    "application/owner-runway-image-upload-service",
    "application/owner-runway-image-request-preparer",
    "application/owner-runway-image-history-binding",
    "application/owner-runway-image-one-shot-policy",
    "application/owner-runway-image-generation-service",
    "mcp/owner-runway-image-tools", "mcp/server", "runtime/observed-owner-runtime",
    "transports/stdio-owner", "adapter/syntx/chat-http-client", "adapter/syntx/runway-image-result", "adapter/syntx/upload-reference-bridge",
    "catalog/selected-discovery-catalog"
  ].flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`])
];

test("installed Runway package requires the complete compiled implementation and public declarations", () => {
  assert.equal(assertRunwayImageNativePackagePaths(new Set(REQUIRED)), true);
  assert.throws(() => assertRunwayImageNativePackagePaths(new Set(REQUIRED.filter((path) => path !== "dist/src/mcp/server.d.ts"))),
    (error) => error instanceof RunwayImageNativeToolsError && error.code === "INSTALLED_RUNWAY_IMAGE_PACKAGE_CONTENT_MISSING");
});

test("installed Runway module bindings follow package paths, not import-array positions", () => {
  const names = ["adapter/syntx/runway-image-result", "adapter/syntx/upload-reference-bridge", "catalog/selected-discovery-catalog"];
  const loaded = [{ id: "result" }, { id: "upload-bridge" }, { id: "selected-catalog" }];
  const mapped = mapRunwayImageNativeModules(names, loaded);
  assert.equal(mapped.get("catalog/selected-discovery-catalog"), loaded[2]);
  assert.equal(mapped.get("adapter/syntx/runway-image-result"), loaded[0]);
  assert.throws(() => mapRunwayImageNativeModules(names, loaded.slice(1)),
    (error) => error instanceof RunwayImageNativeToolsError && error.code === "INSTALLED_RUNWAY_IMAGE_MODULE_MAP_INVALID");
});

test("Runway installed checker diagnostics include only an allowlisted phase and error class", () => {
  const error = new TypeError("/Users/private path and secret text must not be copied");
  const code = runwayImageUnexpectedErrorCode("compiled-api", error);
  assert.equal(code, "INSTALLED_RUNWAY_IMAGE_UNEXPECTED_compiled-api_TypeError");
  assert.equal(code.includes("/Users"), false);
  assert.equal(code.includes("secret"), false);
  assert.throws(() => runwayImageUnexpectedErrorCode("unknown-phase", new Error("unused")),
    (failure) => failure instanceof RunwayImageNativeToolsError && failure.code === "INSTALLED_RUNWAY_IMAGE_DIAGNOSTIC_PHASE_INVALID");
});

test("installed Runway SDK resolution accepts canonical consumer paths and rejects project or foreign SDKs", () => {
  const valid = {
    consumerPath: "/tmp/consumer", resolvedConsumerPath: "/private/tmp/consumer",
    sdkPackagePath: "/tmp/consumer/node_modules/@modelcontextprotocol/sdk",
    resolvedSdkPackagePath: "/private/tmp/consumer/node_modules/@modelcontextprotocol/sdk",
    clientModulePath: "/private/tmp/consumer/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js",
    stdioModulePath: "/private/tmp/consumer/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js",
    projectRoot: "/Users/AlexFisenkov/project"
  };
  assert.equal(assertConsumerSdkResolution(valid), true);
  assert.throws(() => assertConsumerSdkResolution({ ...valid,
    sdkPackagePath: "/Users/AlexFisenkov/project/node_modules/@modelcontextprotocol/sdk",
    resolvedSdkPackagePath: "/Users/AlexFisenkov/project/node_modules/@modelcontextprotocol/sdk"
  }), (error) => error instanceof RunwayImageNativeToolsError && error.code === "INSTALLED_RUNWAY_IMAGE_SDK_NOT_FROM_CONSUMER");
  assert.throws(() => assertConsumerSdkResolution({ ...valid,
    resolvedStdioModulePath: "/tmp/foreign/sdk/dist/esm/client/stdio.js",
    stdioModulePath: "/tmp/foreign/sdk/dist/esm/client/stdio.js"
  }), (error) => error instanceof RunwayImageNativeToolsError && error.code === "INSTALLED_RUNWAY_IMAGE_SDK_NOT_FROM_CONSUMER");
});

test("Runway native tool surface is default-off and reports only the four exact owner tools", () => {
  const names = [
    "syntx_upload_runway_image_reference", "syntx_owner_generate_runway_image",
    "syntx_owner_reconcile_runway_image", "syntx_owner_list_runway_image_recoveries"
  ];
  assert.deepEqual(assertRunwayImageToolNames([], false), { runway_image_tool_count: 0 });
  const fixture = names.map((name) => ({ name }));
  assert.deepEqual(assertRunwayImageToolNames(fixture, true), { runway_image_tool_count: 4 });
  assert.throws(() => assertRunwayImageToolNames([...fixture, fixture[0]], true),
    (error) => error instanceof RunwayImageNativeToolsError && error.code === "INSTALLED_RUNWAY_IMAGE_TOOL_SET_MISMATCH");
  assert.throws(() => assertRunwayImageToolNames([{ name: "syntx_owner_generate_runway_image" }], false),
    (error) => error instanceof RunwayImageNativeToolsError && error.code === "INSTALLED_RUNWAY_IMAGE_DEFAULT_OFF_FAILED");
});

test("Runway installed tool schemas preserve the independent six-resolution fractional contract", () => {
  const tools = literalRunwayTools();
  const diagnosticEnums = {
    phases: ["REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN",
      "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"],
    errorCodes: ["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH", "REFERENCE_UNAVAILABLE",
      "REFERENCE_EXPIRED", "REFERENCE_ALREADY_CLAIMED", "PREFLIGHT_FAILED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"],
    historyReasons: ["INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH", "PROVIDER_CHAT_INVALID",
      "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE", "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID",
      "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH", "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID", "BOT_MESSAGE_NOT_FOUND",
      "BOT_MESSAGE_AMBIGUOUS", "BOT_MESSAGE_BEFORE_ACK", "BOT_OBJECTS_INVALID", "BOT_MODEL_MISMATCH"],
    resultReasons: ["NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE",
      "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH",
      "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE"]
  };
  assert.deepEqual(assertRunwayImageToolSurface(tools, true, diagnosticEnums), { runway_image_tool_count: 4 });

  const roundedTemperature = structuredClone(tools);
  const inputParameters = roundedTemperature[1].inputSchema.properties.parameters.properties.temperature;
  inputParameters.multipleOf = 1;
  assert.throws(() => assertRunwayImageToolSurface(roundedTemperature, true, diagnosticEnums),
    (error) => error instanceof RunwayImageNativeToolsError && error.code === "INSTALLED_RUNWAY_IMAGE_GENERATION_INPUT_SCHEMA_INVALID");

  const unsafeResolution = structuredClone(tools);
  unsafeResolution[1].inputSchema.properties.parameters.properties.resolution.enum.push("auto");
  assert.throws(() => assertRunwayImageToolSurface(unsafeResolution, true, diagnosticEnums),
    (error) => error instanceof RunwayImageNativeToolsError && error.code === "INSTALLED_RUNWAY_IMAGE_GENERATION_INPUT_SCHEMA_INVALID");
});

test("actual compiled public API and SDK descriptors match the independent Runway contract", async () => {
  assert.equal(compiledRunwayTools.SYNTX_UPLOAD_RUNWAY_IMAGE_REFERENCE_TOOL_NAME, "syntx_upload_runway_image_reference");
  assert.equal(compiledRunwayTools.SYNTX_OWNER_GENERATE_RUNWAY_IMAGE_TOOL_NAME, "syntx_owner_generate_runway_image");
  assert.equal(compiledRunwayTools.SYNTX_OWNER_RECONCILE_RUNWAY_IMAGE_TOOL_NAME, "syntx_owner_reconcile_runway_image");
  assert.equal(compiledRunwayTools.SYNTX_OWNER_LIST_RUNWAY_IMAGE_RECOVERIES_TOOL_NAME, "syntx_owner_list_runway_image_recoveries");
  const selectedVersion = compiledSelectedCatalog.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  assert.equal(selectedVersion, "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json");
  const selectedCatalog = compiledSelectedCatalog.loadSelectedDiscoveryCatalog(selectedVersion).discoveryCatalog;
  const sourceParameters = compiledRunwayParameters.getOwnerRunwayImageSourceParameters();
  assert.equal(sourceParameters.source_pins.source_execution, false);
  const sourceProfile = compiledRunwayProfile.getOwnerRunwayImageSourceProfile("runway_frames", selectedCatalog, selectedVersion);
  assert.equal(sourceProfile.public_catalog_version, selectedVersion);
  assert.equal(sourceProfile.dispatch_allowed, false);
  assert.equal(sourceProfile.backend_acceptance, "UNPROVEN");

  const ownerComposition = {
    uploadService: { async upload() { throw new Error("not called"); }, async invalidateAttempt() {}, async close() {} },
    generationService: { async generate() { throw new Error("not called"); }, async reconcile() { throw new Error("not called"); },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {} }
  };
  const readTools = async (options) => {
    const server = compiledServer.createMcpServer(createDefaultApplication(), options);
    const client = new Client({ name: "runway-installed-schema-regression", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try { return await client.listTools(); }
    finally { await client.close(); await server.close(); }
  };
  const defaults = await readTools({});
  assert.deepEqual(assertRunwayImageToolSurface(defaults.tools, false), { runway_image_tool_count: 0 });
  const optedIn = await readTools({ ownerRunwayImageReferences: ownerComposition });
  assert.deepEqual(assertRunwayImageToolSurface(optedIn.tools, true, {
    phases: compiledGeneration.OWNER_RUNWAY_IMAGE_GENERATION_PHASES,
    errorCodes: compiledGeneration.OWNER_RUNWAY_IMAGE_GENERATION_ERROR_CODES,
    historyReasons: compiledGeneration.OWNER_RUNWAY_IMAGE_GENERATION_HISTORY_REASONS,
    resultReasons: compiledGeneration.OWNER_RUNWAY_IMAGE_GENERATION_RESULT_REASONS
  }), { runway_image_tool_count: 4 });
});

function literalRunwayTools() {
  const strict = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
  const enumeration = (values) => ({ type: "string", enum: values });
  const nullableEnum = (values) => ({ anyOf: [enumeration(values), { type: "null" }] });
  const string = { type: "string" };
  const bool = { type: "boolean" };
  const number = { type: "number" };
  const resolutions = ["2112x912", "1920x1088", "1456x1088", "1088x1088", "1088x1456", "1088x1920"];
  const inputMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"];
  const outputMimes = ["image/jpeg", "image/png", "image/webp", "image/avif"];
  const phases = ["REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN",
    "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"];
  const history = ["INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH", "PROVIDER_CHAT_INVALID",
    "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE", "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID",
    "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH", "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID", "BOT_MESSAGE_NOT_FOUND",
    "BOT_MESSAGE_AMBIGUOUS", "BOT_MESSAGE_BEFORE_ACK", "BOT_OBJECTS_INVALID", "BOT_MODEL_MISMATCH"];
  const results = ["NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE",
    "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH",
    "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE"];
  const variant = enumeration(["runway_frames"]);
  const parameterSchema = strict({ resolution: enumeration(resolutions), temperature: { ...number, minimum: 1, maximum: 5 } });
  const attempt = { ...string, pattern: "^link_[A-Za-z0-9_-]{20,120}$" };
  const refPattern = "^runway_image_[0-9a-f-]{36}$";
  const recoveryPattern = "^runway_image_recovery_[0-9a-f-]{36}$";
  const annotations = (readOnly, openWorld = false) => ({ readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: openWorld });
  const diagnostic = strict({ phase: enumeration(phases), post_started: bool, echo_ack_known: bool,
    history_binding: enumeration(["NONE", "PENDING", "READY", "INVALID"]), history_binding_reason: nullableEnum(history),
    history_get_calls: number, history_get_calls_saturated: bool, result_get_calls: number, result_get_calls_saturated: bool,
    result_status: enumeration(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]), result_reason: nullableEnum(results) });
  const parametersOutput = parameterSchema;
  const uploadOutput = strict({ status: { const: "uploaded" }, reference_handle: { ...string, pattern: refPattern }, variant,
    original_mime_type: enumeration(inputMimes), mime_type: enumeration(outputMimes), width: { type: "integer", exclusiveMinimum: 0, maximum: 4_294_967_295 },
    height: { type: "integer", exclusiveMinimum: 0, maximum: 4_294_967_295 }, size: { type: "integer", exclusiveMinimum: 0, maximum: 33_554_432 },
    sha256: { ...string, pattern: "^sha256:[a-f0-9]{64}$" }, expires_in_seconds: { type: "integer", minimum: 1, maximum: 900 },
    metadata_confidence: { const: "CONTAINER_METADATA_ONLY" },
    validation_confidence: enumeration([
      "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
      "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT"
    ]) });
  const actualImage = strict({ mime_type: nullableEnum(outputMimes), width: { type: "null" }, height: { type: "null" } });
  const artifact = strict({ url: string, mime_type: nullableEnum(outputMimes), mime_source: enumeration(["URL_EXTENSION", "UNKNOWN"]),
    width: { type: "null" }, height: { type: "null" }, geometry_verified: { const: false } });
  const generationOutput = strict({ status: { const: "result_observed" }, backend_acceptance: { const: "unproven" }, ai_name: { const: "runway-frames" },
    model_id: { const: "runway_frames" }, variant: { const: "runway_frames" }, operation_id: { const: "generate-image" }, profile_id: string,
    profile_schema_hash: string, catalog_version: string, request_fingerprint: string, parameters: parametersOutput,
    cost_inputs: strict({}), cost_input_confidence: { const: "SOURCE_JOINED_METADATA_KEYS_NONE_NOT_FREE_PRICE" },
    reference_count: { type: "integer", minimum: 0, maximum: 3 },
    input_references: { type: "array", items: strict({ kind: { const: "image" }, mime_type: enumeration(outputMimes), width: number,
      height: number, size: number, sha256: string, metadata_confidence: enumeration(["CONTAINER_METADATA_ONLY", "UNKNOWN"]) }), maxItems: 3 },
    actual_image: actualImage, geometry_verified: { const: false }, artifact });
  const recoveryItem = strict({ recovery_id: { ...string, pattern: recoveryPattern }, created_at: string, model_id: { const: "runway_frames" },
    operation_id: { const: "generate-image" }, status: { const: "OUTCOME_UNKNOWN" }, diagnostic });
  const recoveryOutput = strict({ recoveries: { type: "array", items: recoveryItem, maxItems: 20 },
    confidence_scope: { const: "process_local_get_only_recovery" } });
  return [
    { name: "syntx_upload_runway_image_reference", description: "Upload", inputSchema: strict({ link_attempt_id: attempt, variant,
      content_base64: { ...string, minLength: 4, maxLength: 44_739_244, pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" },
      filename: { ...string, minLength: 1, maxLength: 255 }, mime_type: enumeration(inputMimes) }),
      outputSchema: uploadOutput, annotations: annotations(false) },
    { name: "syntx_owner_generate_runway_image", description: "Starts one real billed generation; may incur provider cost; do not repeat.",
      inputSchema: strict({ link_attempt_id: attempt, variant,
        reference_handles: { type: "array", items: { ...string, pattern: refPattern }, maxItems: 3 }, parameters: parameterSchema,
        prompt: { ...string, minLength: 1, maxLength: 65_536 } }), outputSchema: generationOutput, annotations: annotations(false, true) },
    { name: "syntx_owner_reconcile_runway_image", description: "Read-only GET-only reconciliation. Never starts another generation.",
      inputSchema: strict({ link_attempt_id: attempt, recovery_id: { ...string, pattern: recoveryPattern } }),
      outputSchema: generationOutput, annotations: annotations(true, true) },
    { name: "syntx_owner_list_runway_image_recoveries", description: "Lists bounded recovery metadata; private details are never returned.",
      inputSchema: strict({ link_attempt_id: attempt, limit: { ...number, minimum: 1, maximum: 20, default: 20 } }, ["link_attempt_id"]),
      outputSchema: recoveryOutput, annotations: annotations(true, true) }
  ];
}
