import assert from "node:assert/strict";
import test from "node:test";

async function checker() {
  return import("../scripts/check-installed-grok-t2i-image-tools.mjs");
}

const ENUMS = {
  phases: ["REQUEST_PREPARE", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING",
    "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"],
  errorCodes: ["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "MODEL_BINDING_MISMATCH", "PRINCIPAL_NOT_LINKED",
    "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"],
  historyReasons: ["INVALID_INPUT", "HISTORY_SHAPE_INVALID", "HISTORY_INCOMPLETE", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
    "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE",
    "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH",
    "OWNER_ACK_AMBIGUOUS", "OWNER_REFERENCE_SET_MISMATCH", "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS", "BOT_MESSAGE_BEFORE_ACK",
    "BOT_OUTPUT_COUNT_INVALID", "BOT_OUTPUT_NAMESPACE_UNVERIFIED", "OUTPUT_BATCH_PARTIAL"],
  resultReasons: ["NO_IMAGE_OBJECTS", "RESULT_OBJECTS_PENDING", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH",
    "NOT_BOT_MESSAGE", "OUTPUT_COUNT_INVALID", "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH",
    "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE", "RESULT_MIME_UNKNOWN",
    "RESULT_OBJECT_DUPLICATE", "OUTPUT_BATCH_PARTIAL"]
};

test("installed Grok T2I package gate requires compiled implementation and declaration paths", async () => {
  const api = await checker();
  assert.equal(typeof api.assertGrokT2iNativePackagePaths, "function");
  const modules = ["application/owner-grok-t2i-parameters", "application/owner-grok-t2i-cost-parameters",
    "application/owner-grok-t2i-source-profile", "application/owner-grok-t2i-image-input-validator",
    "application/owner-grok-t2i-image-upload-service",
    "application/owner-grok-t2i-request-preparer", "application/owner-grok-t2i-one-shot-policy",
    "application/owner-grok-t2i-history-binding", "application/owner-grok-t2i-generation-service",
    "mcp/owner-grok-t2i-image-tools", "mcp/server", "runtime/observed-owner-runtime", "transports/stdio-owner",
    "adapter/syntx/chat-http-client", "adapter/syntx/upload-reference-bridge", "catalog/selected-discovery-catalog"];
  const paths = new Set(["dist/src/index.js", "dist/src/index.d.ts", ...modules.flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`])]);
  assert.equal(api.assertGrokT2iNativePackagePaths(paths), true);
  paths.delete("dist/src/application/owner-grok-t2i-generation-service.d.ts");
  assert.throws(() => api.assertGrokT2iNativePackagePaths(paths), (error) => error.code === "INSTALLED_GROK_T2I_PACKAGE_CONTENT_MISSING");
});

test("only the four Grok T2I owner tools appear under exact opt-in", async () => {
  const api = await checker();
  assert.deepEqual(api.assertGrokT2iToolNames([], false), { grok_t2i_tool_count: 0 });
  const names = ["syntx_upload_grok_t2i_image_reference", "syntx_owner_generate_grok_t2i_image",
    "syntx_owner_reconcile_grok_t2i_image", "syntx_owner_list_grok_t2i_image_recoveries"];
  assert.deepEqual(api.assertGrokT2iToolNames(names.map((name) => ({ name })), true), { grok_t2i_tool_count: 4 });
  assert.throws(() => api.assertGrokT2iToolNames([...names.map((name) => ({ name })), { name: names[0] }], true),
    (error) => error.code === "INSTALLED_GROK_T2I_TOOL_SET_MISMATCH");
  assert.throws(() => api.assertGrokT2iToolNames([{ name: names[0] }], false),
    (error) => error.code === "INSTALLED_GROK_T2I_DEFAULT_OFF_FAILED");
});

test("diagnostic errors contain only a closed checker phase and allowlisted error class", async () => {
  const api = await checker();
  const code = api.grokT2iUnexpectedErrorCode("source-contract", new TypeError("secret path and token"));
  assert.equal(code, "INSTALLED_GROK_T2I_UNEXPECTED_source-contract_TypeError");
  assert.equal(code.includes("secret"), false);
  assert.throws(() => api.grokT2iUnexpectedErrorCode("unknown", new Error("unused")),
    (error) => error.code === "INSTALLED_GROK_T2I_DIAGNOSTIC_PHASE_INVALID");
});

test("reason enums reject widened arrays and the SDK resolver rejects non-consumer copies", async () => {
  const api = await checker();
  assert.equal(api.assertGrokT2iDiagnosticEnums(ENUMS), true);
  const enums = { ...ENUMS };
  assert.throws(() => api.assertGrokT2iDiagnosticEnums({ ...enums, historyReasons: [...enums.historyReasons, "RAW_PROVIDER_ERROR"] }),
    (error) => error.code === "INSTALLED_GROK_T2I_RECOVERY_ENUMS_INVALID");
  const consumer = "/private/tmp/consumer";
  const good = { consumerPath: "/tmp/consumer", resolvedConsumerPath: consumer,
    sdkPackagePath: "/tmp/consumer/node_modules/@modelcontextprotocol/sdk",
    resolvedSdkPackagePath: `${consumer}/node_modules/@modelcontextprotocol/sdk`,
    clientModulePath: `${consumer}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`,
    stdioModulePath: `${consumer}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js`, projectRoot: "/tmp/project" };
  assert.equal(api.assertConsumerSdkResolution(good), true);
  assert.throws(() => api.assertConsumerSdkResolution({ ...good,
    resolvedSdkPackagePath: "/Users/AlexFisenkov/project/node_modules/@modelcontextprotocol/sdk" }),
  (error) => error.code === "INSTALLED_GROK_T2I_SDK_NOT_FROM_CONSUMER");
});

test("Grok T2I tool schemas reject an open top-level object before accepting the installed surface", async () => {
  const api = await checker();
  const names = ["syntx_upload_grok_t2i_image_reference", "syntx_owner_generate_grok_t2i_image",
    "syntx_owner_reconcile_grok_t2i_image", "syntx_owner_list_grok_t2i_image_recoveries"];
  const open = { type: "object", properties: {}, required: [] };
  const tools = names.map((name) => ({ name, inputSchema: open, outputSchema: open }));
  assert.throws(() => api.assertGrokT2iToolSurface(tools, true, ENUMS),
    (error) => error.code === "INSTALLED_GROK_T2I_UPLOAD_INPUT_OBJECT_SCHEMA_INVALID");
});

test("a literal strict four-tool schema fixture passes, while missing fields, widened caps, and false acceptance fail", async () => {
  const api = await checker();
  const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
  const enumeration = (values) => ({ type: "string", enum: values });
  const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
  const nullableEnum = (values) => ({ anyOf: [{ type: "string", enum: values }, { type: "null" }] });
  const link = { type: "string", pattern: "^link_[A-Za-z0-9_-]{20,120}$" };
  const handle = { type: "string", pattern: "^grok_t2i_image_[0-9a-f-]{36}$" };
  const recovery = { type: "string", pattern: "^grok_t2i_recovery_[0-9a-f-]{36}$" };
  const baseParams = object({ aspect_ratio: enumeration(["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"]),
    batch_size: { anyOf: [1, 2, 3, 4, 5].map((value) => ({ const: value, type: "integer" })) }, resolution: enumeration(["1k", "2k"]) });
  const imagineParams = object({ aspect_ratio: enumeration(["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"]),
    batch_size: { anyOf: [1, 2, 3, 4, 5].map((value) => ({ const: value, type: "integer" })) }, resolution: enumeration(["1k", "2k"]),
    details_quality: enumeration(["low", "medium"]) });
  const uploadInput = object({ link_attempt_id: link, model_id: enumeration(["grok_imagine_2", "grok_imagine_quality"]),
    content_base64: { type: "string", minLength: 4, maxLength: Math.ceil(64 * 1024 * 1024 / 3) * 4,
      pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" },
    filename: { type: "string", minLength: 1, maxLength: 255 },
    mime_type: enumeration(["image/jpeg", "image/jpg", "image/png", "image/webp"]) });
  const generateInput = object({ link_attempt_id: link, model_id: enumeration(["grok_t2i", "grok_t2i_pro", "grok_imagine_2", "grok_imagine_quality"]),
    prompt: { type: "string", minLength: 1, maxLength: 5_000 }, reference_handles: { type: "array", items: handle, maxItems: 5 },
    parameters: { anyOf: [baseParams, imagineParams, baseParams] } });
  const reconcileInput = object({ link_attempt_id: link, recovery_id: recovery });
  const listInput = object({ link_attempt_id: link, limit: integer(1, 20) }, ["link_attempt_id"]);
  const uploadOutput = object({ status: { const: "uploaded" }, reference_handle: handle,
    model_id: enumeration(["grok_imagine_2", "grok_imagine_quality"]), source_mime_type: enumeration(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
    mime_type: enumeration(["image/jpeg", "image/png", "image/webp"]), width: integer(1, 0xffff_ffff), height: integer(1, 0xffff_ffff),
    size: integer(1, 64 * 1024 * 1024), sha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    expires_in_seconds: integer(1, 900), metadata_confidence: { const: "CONTAINER_METADATA_ONLY" },
    size_limit_confidence: { const: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" } });
  const artifact = object({ message_object_id: { type: "string", minLength: 1, maxLength: 160 }, url: { type: "string", format: "uri", maxLength: 4_096 },
    mime_type: { type: "string", minLength: 1, maxLength: 64 }, width: { type: "null" }, height: { type: "null" }, geometry_verified: { const: false } });
  const generationOutput = object({ status: { const: "result_observed" }, backend_acceptance: { const: "UNPROVEN" },
    namespace_confidence: { const: "SOURCE_SHAPED_UNVERIFIED" }, ai_name: { const: "grok_image" },
    model_id: enumeration(["grok_t2i", "grok_t2i_pro", "grok_imagine_2", "grok_imagine_quality"]), operation_id: { const: "generate-image" },
    profile_id: { type: "string", minLength: 1, maxLength: 160 }, profile_schema_hash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    catalog_version: { type: "string", minLength: 1, maxLength: 160 }, request_fingerprint: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    parameters: object({ aspect_ratio: enumeration(["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"]),
      resolution: enumeration(["1k", "2k"]), batch_size: { anyOf: [1, 2, 3, 4, 5].map((value) => ({ const: value, type: "integer" })) },
      details_quality: enumeration(["low", "medium"]) },
      ["aspect_ratio", "resolution", "batch_size"]), reference_count: integer(0, 5), artifacts: { type: "array", items: artifact, maxItems: 5 } });
  const diagnostic = object({ phase: enumeration(ENUMS.phases), post_started: { type: "boolean" }, echo_ack_known: { type: "boolean" },
    history_status: enumeration(["NONE", "PENDING", "READY", "PARTIAL", "UNVERIFIED", "INVALID"]),
    history_reason: nullableEnum(ENUMS.historyReasons), result_status: enumeration(["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]),
    result_reason: nullableEnum(ENUMS.resultReasons), history_get_calls: integer(0, 255), history_get_calls_saturated: { type: "boolean" },
    result_get_calls: integer(0, 255), result_get_calls_saturated: { type: "boolean" } });
  const recoveryItem = object({ recovery_id: recovery, created_at: { type: "string", format: "date-time" },
    model_id: enumeration(["grok_t2i", "grok_t2i_pro", "grok_imagine_2", "grok_imagine_quality"]),
    operation_id: { const: "generate-image" }, status: { const: "OUTCOME_UNKNOWN" }, diagnostic });
  const listOutput = object({ recoveries: { type: "array", items: recoveryItem, maxItems: 20 } });
  const names = ["syntx_upload_grok_t2i_image_reference", "syntx_owner_generate_grok_t2i_image",
    "syntx_owner_reconcile_grok_t2i_image", "syntx_owner_list_grok_t2i_image_recoveries"];
  const tools = names.map((name, index) => ({ name, inputSchema: [uploadInput, generateInput, reconcileInput, listInput][index],
    outputSchema: [uploadOutput, generationOutput, generationOutput, listOutput][index],
    description: index === 1 ? "If uncertain, do not repeat." : index === 2 ? "GET-only reconciliation." : index === 3 ? "process-local recoveries." : "Upload.",
    annotations: index < 2 ? { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }));
  assert.deepEqual(api.assertGrokT2iToolSurface(tools, true, ENUMS), { grok_t2i_tool_count: 4 });
  const widened = structuredClone(tools); widened[1].inputSchema.properties.reference_handles.maxItems = 6;
  assert.throws(() => api.assertGrokT2iToolSurface(widened, true, ENUMS), (error) => error.code === "INSTALLED_GROK_T2I_INPUT_SCHEMA_INVALID");
  const misleading = structuredClone(tools); misleading[1].outputSchema.properties.backend_acceptance.const = "ACCEPTED";
  assert.throws(() => api.assertGrokT2iToolSurface(misleading, true, ENUMS), (error) => error.code === "INSTALLED_GROK_T2I_OUTPUT_SCHEMA_INVALID");
});

test("source admission rejects runtime activation and a changed pinned form without source lookup", async () => {
  const api = await checker();
  const source = { profile_id: "grok-t2i-source-parameters-v1", models: ["grok_t2i", "grok_t2i_pro", "grok_imagine_2", "grok_imagine_quality"], dispatch_allowed: false,
    runtime_activation: true, backend_acceptance: "UNPROVEN", cost_inputs: null, cost_projection_status: "NOT_JOINED",
    source_mapping_confidence: "PINNED_FORM_STATIC_CONTROL_CANDIDATES_NOT_WIRE_OR_RUNTIME_PROOF",
    defaults_confidence: "SOURCE_FORM_CANDIDATES_METADATA_ONLY_NOT_NORMALIZER_INJECTION",
    controls: { aspect_ratio: { base_values: ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"],
      imagine_values: ["1:1", "2:3", "3:2", "9:16", "16:9"] }, resolution: { values: ["1k", "2k"] },
      batch_size: { values: [1, 2, 3, 4, 5] }, details_quality: { values: ["low", "medium"] } },
    source_pins: { form_build_id: "1791467421", form_module: "grok-image.js", form_sha256: "wrong", source_execution: false } };
  assert.throws(() => api.assertGrokT2iSourceContract({ getOwnerGrokT2iSourceParameters: () => source }, {}, {}, {},
    "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json"),
  (error) => error.code === "INSTALLED_GROK_T2I_COMPILED_API_REGRESSION_FAILED");
  source.runtime_activation = false;
  assert.throws(() => api.assertGrokT2iSourceContract({ getOwnerGrokT2iSourceParameters: () => source }, {}, {}, {},
    "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json"),
  (error) => error.code === "INSTALLED_GROK_T2I_SOURCE_PIN_INVALID");
});

test("safe public barrel allowlist passes but nominal candidate and permit exports are rejected", async () => {
  const api = await checker();
  const functions = Object.fromEntries(["OWNER_GROK_T2I_MODELS", "getOwnerGrokT2iSourceParameters", "normalizeOwnerGrokT2iParameters",
    "OwnerGrokT2iParametersError", "projectOwnerGrokT2iCostParameters", "getOwnerGrokT2iSourceProfile", "OwnerGrokT2iSourceProfileError",
    "OwnerGrokT2iImageUploadService", "OwnerGrokT2iImageUploadServiceError", "OwnerGrokT2iGenerationService",
    "OwnerGrokT2iGenerationServiceError", "createOwnerGrokT2iGenerationService", "OWNER_GROK_T2I_GENERATION_PHASES",
    "OWNER_GROK_T2I_GENERATION_ERROR_CODES", "OWNER_GROK_T2I_HISTORY_REASONS", "OWNER_GROK_T2I_RESULT_REASONS",
    "registerSyntxOwnerGrokT2iImageTools", "createMcpServer", "createObservedOwnerRuntime",
    "SYNTX_UPLOAD_GROK_T2I_IMAGE_REFERENCE_TOOL_NAME", "SYNTX_OWNER_GENERATE_GROK_T2I_IMAGE_TOOL_NAME",
    "SYNTX_OWNER_RECONCILE_GROK_T2I_IMAGE_TOOL_NAME", "SYNTX_OWNER_LIST_GROK_T2I_IMAGE_RECOVERIES_TOOL_NAME",
    "OWNER_GROK_T2I_IMAGE_TOOL_NAMES"].map((name) => [name, Object.freeze({ name })]));
  const modules = { parameters: {}, cost: {}, profile: {}, upload: {}, generation: {}, tools: {}, server: {}, runtime: {} };
  for (const name of ["OWNER_GROK_T2I_MODELS", "getOwnerGrokT2iSourceParameters", "normalizeOwnerGrokT2iParameters", "OwnerGrokT2iParametersError"])
    modules.parameters[name] = functions[name];
  modules.cost.projectOwnerGrokT2iCostParameters = functions.projectOwnerGrokT2iCostParameters;
  for (const name of ["getOwnerGrokT2iSourceProfile", "OwnerGrokT2iSourceProfileError"]) modules.profile[name] = functions[name];
  for (const name of ["OwnerGrokT2iImageUploadService", "OwnerGrokT2iImageUploadServiceError"]) modules.upload[name] = functions[name];
  for (const name of ["OwnerGrokT2iGenerationService", "OwnerGrokT2iGenerationServiceError", "createOwnerGrokT2iGenerationService",
    "OWNER_GROK_T2I_GENERATION_PHASES", "OWNER_GROK_T2I_GENERATION_ERROR_CODES", "OWNER_GROK_T2I_HISTORY_REASONS", "OWNER_GROK_T2I_RESULT_REASONS"])
    modules.generation[name] = functions[name];
  for (const name of ["registerSyntxOwnerGrokT2iImageTools", "SYNTX_UPLOAD_GROK_T2I_IMAGE_REFERENCE_TOOL_NAME",
    "SYNTX_OWNER_GENERATE_GROK_T2I_IMAGE_TOOL_NAME", "SYNTX_OWNER_RECONCILE_GROK_T2I_IMAGE_TOOL_NAME",
    "SYNTX_OWNER_LIST_GROK_T2I_IMAGE_RECOVERIES_TOOL_NAME", "OWNER_GROK_T2I_IMAGE_TOOL_NAMES"]) modules.tools[name] = functions[name];
  modules.server.createMcpServer = functions.createMcpServer;
  modules.runtime.createObservedOwnerRuntime = functions.createObservedOwnerRuntime;
  assert.equal(api.assertGrokT2iPublicExports(functions, modules), true);
  assert.throws(() => api.assertGrokT2iPublicExports({ ...functions, OwnerGrokT2iPreparedCandidate: {} }, modules),
    (error) => error.code === "INSTALLED_GROK_T2I_PRIVATE_EXPORT_LEAK");
});
