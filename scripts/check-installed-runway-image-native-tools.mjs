import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export class RunwayImageNativeToolsError extends Error {
  constructor(code) { super(code); this.name = "RunwayImageNativeToolsError"; this.code = code; }
}

const TOOL_NAMES = Object.freeze([
  "syntx_upload_runway_image_reference",
  "syntx_owner_generate_runway_image",
  "syntx_owner_reconcile_runway_image",
  "syntx_owner_list_runway_image_recoveries"
]);
const VARIANTS = Object.freeze(["runway_frames"]);
const SOURCE_CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const RESOLUTIONS = Object.freeze(["2112x912", "1920x1088", "1456x1088", "1088x1088", "1088x1456", "1088x1920"]);
const INPUT_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"]);
const OUTPUT_MIMES = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const VALIDATION_CONFIDENCES = Object.freeze([
  "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
  "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT"
]);
const PHASES = Object.freeze(["REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
  "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"]);
const ERROR_CODES = Object.freeze(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "REFERENCE_ALREADY_CLAIMED", "PREFLIGHT_FAILED", "PRE_DISPATCH_FAILED",
  "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"]);
const RESULT_REASONS = Object.freeze(["NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH",
  "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH",
  "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE"]);
const HISTORY_REASONS = Object.freeze(["INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
  "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE", "MESSAGE_CHAT_MISMATCH",
  "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH", "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID",
  "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS", "BOT_MESSAGE_BEFORE_ACK", "BOT_OBJECTS_INVALID", "BOT_MODEL_MISMATCH"]);
const PACKAGE_MODULES = Object.freeze([
  "application/owner-runway-image-parameters", "application/owner-runway-image-source-profile",
  "application/owner-runway-image-upload-service", "application/owner-runway-image-request-preparer",
  "application/owner-runway-image-history-binding", "application/owner-runway-image-one-shot-policy",
  "application/owner-runway-image-generation-service", "mcp/owner-runway-image-tools", "mcp/server",
  "runtime/observed-owner-runtime", "transports/stdio-owner", "adapter/syntx/chat-http-client",
  "adapter/syntx/runway-image-result", "adapter/syntx/upload-reference-bridge", "catalog/selected-discovery-catalog"
]);
const PACKAGE_PATHS = Object.freeze(["dist/src/index.js", "dist/src/index.d.ts",
  ...PACKAGE_MODULES.flatMap((path) => [`dist/src/${path}.js`, `dist/src/${path}.d.ts`])]);
const CHECK_PHASES = Object.freeze(["package-paths", "node-runtime", "module-import", "public-exports", "compiled-api", "source-profile",
  "declarations", "flag-reader", "stdio-default", "stdio-opt-in"]);
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

export function assertRunwayImageNativePackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_RUNWAY_IMAGE_PACKAGE_PATHS_INVALID");
  if (PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) fail("INSTALLED_RUNWAY_IMAGE_PACKAGE_CONTENT_MISSING");
  return true;
}

/** Bind loaded modules by their declared package path so list edits cannot shift consumers. */
export function mapRunwayImageNativeModules(modulePaths, loadedModules) {
  if (!Array.isArray(modulePaths) || !Array.isArray(loadedModules) || modulePaths.length !== loadedModules.length ||
      modulePaths.some((path) => typeof path !== "string") || new Set(modulePaths).size !== modulePaths.length ||
      loadedModules.some((module) => !isRecord(module))) fail("INSTALLED_RUNWAY_IMAGE_MODULE_MAP_INVALID");
  return new Map(modulePaths.map((path, index) => [path, loadedModules[index]]));
}

/** Safe phase/class diagnostic: exception messages and private values are never returned. */
export function runwayImageUnexpectedErrorCode(phase, error) {
  if (!CHECK_PHASES.includes(phase)) fail("INSTALLED_RUNWAY_IMAGE_DIAGNOSTIC_PHASE_INVALID");
  return `INSTALLED_RUNWAY_IMAGE_UNEXPECTED_${phase}_${allowlistedErrorClass(error)}`;
}

/** Require canonical realpaths rooted in this consumer's direct SDK dependency. */
export function assertConsumerSdkResolution({ consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath,
  clientModulePath, stdioModulePath, projectRoot }) {
  if (![consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath, clientModulePath, stdioModulePath, projectRoot]
    .every((path) => typeof path === "string" && isAbsolute(path))) fail("INSTALLED_RUNWAY_IMAGE_SDK_NOT_FROM_CONSUMER");
  const expectedSdk = join(resolve(consumerPath), "node_modules", "@modelcontextprotocol", "sdk");
  const sdkRoot = resolve(resolvedSdkPackagePath);
  if (resolve(sdkPackagePath) !== expectedSdk || !isPathWithin(resolvedConsumerPath, sdkRoot) ||
      isPathWithin(projectRoot, sdkRoot) || !isPathWithin(sdkRoot, resolve(clientModulePath)) ||
      !isPathWithin(sdkRoot, resolve(stdioModulePath))) fail("INSTALLED_RUNWAY_IMAGE_SDK_NOT_FROM_CONSUMER");
  return true;
}

export function assertRunwayImageToolNames(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_RUNWAY_IMAGE_TOOLS_LIST_INVALID");
  const names = tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length !== 0) fail("INSTALLED_RUNWAY_IMAGE_DEFAULT_OFF_FAILED");
    return Object.freeze({ runway_image_tool_count: 0 });
  }
  if (names.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => names.filter((item) => item === name).length !== 1)) {
    fail("INSTALLED_RUNWAY_IMAGE_TOOL_SET_MISMATCH");
  }
  return Object.freeze({ runway_image_tool_count: TOOL_NAMES.length });
}

/** Validate the installed SDK schemas against independent closed Runway literals. */
export function assertRunwayImageToolSurface(tools, enabled, diagnosticEnums) {
  const counts = assertRunwayImageToolNames(tools, enabled);
  if (!enabled) return counts;
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const [upload, generate, reconcile, list] = TOOL_NAMES.map((name) => byName.get(name));
  const code = "INSTALLED_RUNWAY_IMAGE_SCHEMA_INVALID";
  for (const tool of [upload, generate, reconcile, list]) {
    assertAllObjectsStrict(tool.inputSchema, code);
    assertAllObjectsStrict(tool.outputSchema, code);
  }
  const uploadInput = properties(upload.inputSchema, code);
  const generateInput = properties(generate.inputSchema, code);
  const uploadOutput = properties(upload.outputSchema, code);
  const generateOutput = properties(generate.outputSchema, code);
  const listOutput = properties(list.outputSchema, code);
  const attempt = "^link_[A-Za-z0-9_-]{20,120}$";
  const reference = "^runway_image_[0-9a-f-]{36}$";
  const recovery = "^runway_image_recovery_[0-9a-f-]{36}$";
  assertStrictObject(upload.inputSchema, ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"], [], code);
  assertStrictObject(generate.inputSchema, ["link_attempt_id", "variant", "reference_handles", "parameters", "prompt"], [], code);
  assertStrictObject(reconcile.inputSchema, ["link_attempt_id", "recovery_id"], [], code);
  assertStrictObject(list.inputSchema, ["link_attempt_id"], ["limit"], code);
  assertStrictObject(generateInput.parameters, ["resolution", "temperature"], [], code);
  assertStrictObject(upload.outputSchema, ["status", "reference_handle", "variant", "original_mime_type", "mime_type",
    "width", "height", "size", "sha256", "expires_in_seconds", "metadata_confidence", "validation_confidence"], [], code);
  assertStrictObject(generate.outputSchema, ["status", "backend_acceptance", "ai_name", "model_id", "variant", "operation_id",
    "profile_id", "profile_schema_hash", "catalog_version", "request_fingerprint", "parameters", "cost_inputs",
    "cost_input_confidence", "reference_count", "input_references", "actual_image", "geometry_verified", "artifact"], [], code);
  assertStrictObject(list.outputSchema, ["recoveries", "confidence_scope"], [], code);

  if (uploadInput.link_attempt_id?.pattern !== attempt || generateInput.link_attempt_id?.pattern !== attempt ||
      reconcile.inputSchema.properties?.link_attempt_id?.pattern !== attempt || list.inputSchema.properties?.link_attempt_id?.pattern !== attempt ||
      reconcile.inputSchema.properties?.recovery_id?.pattern !== recovery ||
      !sameArray(uploadInput.variant?.enum, VARIANTS) || !sameArray(generateInput.variant?.enum, VARIANTS)) fail("INSTALLED_RUNWAY_IMAGE_ID_SCHEMA_INVALID");
  if (uploadInput.content_base64?.minLength !== 4 || uploadInput.content_base64?.maxLength !== 44_739_244 ||
      uploadInput.content_base64?.pattern !== "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" ||
      uploadInput.filename?.minLength !== 1 || uploadInput.filename?.maxLength !== 255 || !sameArray(uploadInput.mime_type?.enum, INPUT_MIMES)) {
    fail("INSTALLED_RUNWAY_IMAGE_UPLOAD_INPUT_SCHEMA_INVALID");
  }
  const parameterFields = properties(generateInput.parameters, code);
  if (generateInput.reference_handles?.type !== "array" || generateInput.reference_handles?.maxItems !== 3 ||
      generateInput.reference_handles?.items?.pattern !== reference || generateInput.prompt?.minLength !== 1 || generateInput.prompt?.maxLength !== 65_536 ||
      !sameArray(parameterFields.resolution?.enum, RESOLUTIONS) || parameterFields.temperature?.type !== "number" ||
      parameterFields.temperature?.minimum !== 1 || parameterFields.temperature?.maximum !== 5 ||
      parameterFields.temperature?.multipleOf !== undefined || parameterFields.temperature?.integerOnly !== undefined) {
    fail("INSTALLED_RUNWAY_IMAGE_GENERATION_INPUT_SCHEMA_INVALID");
  }
  if (uploadInput.mime_type?.enum?.some((mime) => !INPUT_MIMES.includes(mime)) ||
      uploadOutput.status?.const !== "uploaded" || uploadOutput.reference_handle?.pattern !== reference ||
      !sameArray(uploadOutput.variant?.enum, VARIANTS) || !sameArray(uploadOutput.original_mime_type?.enum, INPUT_MIMES) ||
      !sameArray(uploadOutput.mime_type?.enum, OUTPUT_MIMES) ||
      uploadOutput.metadata_confidence?.const !== "CONTAINER_METADATA_ONLY" ||
      !sameArray(uploadOutput.validation_confidence?.enum, VALIDATION_CONFIDENCES) ||
      uploadOutput.width?.type !== "integer" || uploadOutput.height?.type !== "integer" ||
      uploadOutput.width?.exclusiveMinimum !== 0 || uploadOutput.height?.exclusiveMinimum !== 0 ||
      uploadOutput.width?.maximum !== 4_294_967_295 || uploadOutput.height?.maximum !== 4_294_967_295 ||
      uploadOutput.size?.type !== "integer" || uploadOutput.size?.exclusiveMinimum !== 0 || uploadOutput.size?.maximum !== 33_554_432 ||
      uploadOutput.sha256?.pattern !== "^sha256:[a-f0-9]{64}$" || uploadOutput.expires_in_seconds?.type !== "integer" ||
      uploadOutput.expires_in_seconds?.minimum !== 1 || uploadOutput.expires_in_seconds?.maximum !== 900) fail("INSTALLED_RUNWAY_IMAGE_UPLOAD_OUTPUT_SCHEMA_INVALID");
  const outputParameters = properties(generateOutput.parameters, code);
  assertStrictObject(generateOutput.parameters, ["resolution", "temperature"], [], code);
  assertStrictObject(generateOutput.cost_inputs, [], [], code);
  assertStrictObject(generateOutput.actual_image, ["mime_type", "width", "height"], [], code);
  assertStrictObject(generateOutput.artifact, ["url", "mime_type", "mime_source", "width", "height", "geometry_verified"], [], code);
  assertStrictObject(generateOutput.input_references.items,
    ["kind", "mime_type", "width", "height", "size", "sha256", "metadata_confidence"], [], code);
  if (generateOutput.status?.const !== "result_observed" || generateOutput.backend_acceptance?.const !== "unproven" ||
      generateOutput.ai_name?.const !== "runway-frames" || generateOutput.model_id?.const !== "runway_frames" ||
      generateOutput.variant?.const !== "runway_frames" || generateOutput.operation_id?.const !== "generate-image" ||
      generateOutput.geometry_verified?.const !== false || generateOutput.cost_input_confidence?.const !== "SOURCE_JOINED_METADATA_KEYS_NONE_NOT_FREE_PRICE" ||
      !sameArray(outputParameters.resolution?.enum, RESOLUTIONS) || outputParameters.temperature?.minimum !== 1 ||
      outputParameters.temperature?.maximum !== 5 || outputParameters.temperature?.multipleOf !== undefined ||
      generateOutput.reference_count?.type !== "integer" || generateOutput.reference_count?.minimum !== 0 ||
      generateOutput.reference_count?.maximum !== 3 || generateOutput.input_references?.maxItems !== 3 ||
      !sameArray(generateOutput.input_references?.items?.properties?.mime_type?.enum, OUTPUT_MIMES) ||
      generateOutput.input_references?.items?.properties?.kind?.const !== "image" ||
      generateOutput.actual_image?.properties?.width?.type !== "null" || generateOutput.actual_image?.properties?.height?.type !== "null" ||
      generateOutput.artifact?.properties?.width?.type !== "null" || generateOutput.artifact?.properties?.height?.type !== "null" ||
      generateOutput.artifact?.properties?.geometry_verified?.const !== false ||
      !sameArray(generateOutput.artifact?.properties?.mime_source?.enum, ["URL_EXTENSION", "UNKNOWN"]) ||
      !sameArray(generateOutput.artifact?.properties?.mime_type?.anyOf?.[0]?.enum ?? generateOutput.artifact?.properties?.mime_type?.enum, OUTPUT_MIMES)) {
    fail("INSTALLED_RUNWAY_IMAGE_GENERATION_OUTPUT_SCHEMA_INVALID");
  }
  if (listOutput.confidence_scope?.const !== "process_local_get_only_recovery" || listOutput.recoveries?.type !== "array" ||
      listOutput.recoveries?.maxItems !== 20) fail("INSTALLED_RUNWAY_IMAGE_RECOVERY_OUTPUT_SCHEMA_INVALID");
  const diagnostic = listOutput.recoveries.items?.properties?.diagnostic;
  assertStrictObject(listOutput.recoveries.items, ["recovery_id", "created_at", "model_id", "operation_id", "status", "diagnostic"], [], code);
  assertStrictObject(diagnostic, ["phase", "post_started", "echo_ack_known", "history_binding", "history_binding_reason",
    "history_get_calls", "history_get_calls_saturated", "result_get_calls", "result_get_calls_saturated", "result_status", "result_reason"], [], code);
  if (listOutput.recoveries.items?.properties?.recovery_id?.pattern !== recovery ||
      listOutput.recoveries.items?.properties?.status?.const !== "OUTCOME_UNKNOWN" ||
      !sameArray(diagnostic?.properties?.phase?.enum, PHASES) ||
      !sameArray(diagnostic?.properties?.history_binding_reason?.anyOf?.[0]?.enum ?? diagnostic?.properties?.history_binding_reason?.enum,
        HISTORY_REASONS) ||
      !sameArray(diagnostic?.properties?.result_reason?.anyOf?.[0]?.enum ?? diagnostic?.properties?.result_reason?.enum, RESULT_REASONS) ||
      !sameArray(diagnostic?.properties?.history_binding?.enum, ["NONE", "PENDING", "READY", "INVALID"]) ||
      !sameArray(diagnostic?.properties?.result_status?.enum, ["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"])) {
    fail("INSTALLED_RUNWAY_IMAGE_RECOVERY_OUTPUT_SCHEMA_INVALID");
  }
  if (diagnosticEnums !== undefined) {
    if (!sameArray(diagnosticEnums.phases, PHASES) || !sameArray(diagnosticEnums.historyReasons, HISTORY_REASONS) ||
        !sameArray(diagnosticEnums.resultReasons, RESULT_REASONS) || !sameArray(diagnosticEnums.errorCodes, ERROR_CODES)) fail(code);
  }
  assertToolAnnotations(upload, false, false, code);
  assertToolAnnotations(generate, false, true, code);
  assertToolAnnotations(reconcile, true, true, code);
  assertToolAnnotations(list, true, true, code);
  if (!String(generate.description ?? "").includes("real billed generation") || !String(generate.description ?? "").includes("do not repeat") ||
      !String(reconcile.description ?? "").includes("GET-only") || !/never starts another generation/iu.test(String(reconcile.description ?? "")) ||
      !String(list.description ?? "").includes("recovery metadata") || !String(list.description ?? "").includes("never returned")) {
    fail("INSTALLED_RUNWAY_IMAGE_OPERATION_BOUNDARY_INVALID");
  }
  return counts;
}

/** Compiled package regression plus real SDK listTools/stdio lifecycle only. */
export async function assertInstalledRunwayImageNativeTools(installedPackagePath, consumerPath, packagedPaths) {
  let phase = "package-paths";
  try {
  assertRunwayImageNativePackagePaths(packagedPaths);
  phase = "node-runtime";
  if (Number(process.versions.node.split(".")[0]) !== 24) fail("INSTALLED_RUNWAY_IMAGE_NODE24_REQUIRED");
  const importPacked = (relativePath) => import(pathToFileURL(join(installedPackagePath, relativePath)).href);
  let modules;
  phase = "module-import";
  try {
    modules = await Promise.all([
      importPacked("dist/src/index.js"),
      ...PACKAGE_MODULES.map((name) => importPacked(`dist/src/${name}.js`))
    ]);
  } catch { fail("INSTALLED_RUNWAY_IMAGE_MODULE_IMPORT_FAILED"); }
  const api = modules[0];
  const moduleMap = mapRunwayImageNativeModules(PACKAGE_MODULES, modules.slice(1));
  const moduleFor = (name) => moduleMap.get(name);
  const parameters = moduleFor("application/owner-runway-image-parameters");
  const profile = moduleFor("application/owner-runway-image-source-profile");
  const upload = moduleFor("application/owner-runway-image-upload-service");
  const preparer = moduleFor("application/owner-runway-image-request-preparer");
  const history = moduleFor("application/owner-runway-image-history-binding");
  const permit = moduleFor("application/owner-runway-image-one-shot-policy");
  const generation = moduleFor("application/owner-runway-image-generation-service");
  const toolsModule = moduleFor("mcp/owner-runway-image-tools");
  const serverModule = moduleFor("mcp/server");
  const runtimeModule = moduleFor("runtime/observed-owner-runtime");
  const stdioModule = moduleFor("transports/stdio-owner");
  const clientModule = moduleFor("adapter/syntx/chat-http-client");
  const selectedCatalogModule = moduleFor("catalog/selected-discovery-catalog");
  phase = "public-exports";
  const functionExports = ["getOwnerRunwayImageSourceParameters", "normalizeOwnerRunwayImageParameters", "getOwnerRunwayImageSourceProfile",
    "OwnerRunwayImageUploadService", "createOwnerRunwayImageOwnedReferenceBindingIssuer", "prepareOwnerRunwayImageRequest",
    "isOwnerRunwayImagePreparedCandidateForPrincipal", "getOwnerRunwayImagePreparedCandidateState", "correlateOwnerRunwayImageHistoryBinding",
    "createOwnerRunwayImageOneShotPermit", "consumeOwnerRunwayImageOneShotPermit", "OwnerRunwayImageGenerationService",
    "registerSyntxOwnerRunwayImageTools", "createMcpServer", "createObservedOwnerRuntime", "SyntxChatHttpClient"];
  for (const name of functionExports) if (typeof api[name] !== "function") fail(`INSTALLED_RUNWAY_IMAGE_PUBLIC_EXPORT_MISSING:${name}`);
  for (const name of ["SYNTX_UPLOAD_RUNWAY_IMAGE_REFERENCE_TOOL_NAME", "SYNTX_OWNER_GENERATE_RUNWAY_IMAGE_TOOL_NAME",
    "SYNTX_OWNER_RECONCILE_RUNWAY_IMAGE_TOOL_NAME", "SYNTX_OWNER_LIST_RUNWAY_IMAGE_RECOVERIES_TOOL_NAME"]) {
    if (api[name] !== toolsModule[name]) fail("INSTALLED_RUNWAY_IMAGE_PUBLIC_EXPORT_MISMATCH");
  }
  if (api.getOwnerRunwayImageSourceParameters !== parameters.getOwnerRunwayImageSourceParameters ||
      api.normalizeOwnerRunwayImageParameters !== parameters.normalizeOwnerRunwayImageParameters ||
      api.getOwnerRunwayImageSourceProfile !== profile.getOwnerRunwayImageSourceProfile ||
      api.OwnerRunwayImageUploadService !== upload.OwnerRunwayImageUploadService ||
      api.createOwnerRunwayImageOwnedReferenceBindingIssuer !== preparer.createOwnerRunwayImageOwnedReferenceBindingIssuer ||
      api.prepareOwnerRunwayImageRequest !== preparer.prepareOwnerRunwayImageRequest ||
      api.isOwnerRunwayImagePreparedCandidateForPrincipal !== preparer.isOwnerRunwayImagePreparedCandidateForPrincipal ||
      api.getOwnerRunwayImagePreparedCandidateState !== preparer.getOwnerRunwayImagePreparedCandidateState ||
      api.correlateOwnerRunwayImageHistoryBinding !== history.correlateOwnerRunwayImageHistoryBinding ||
      api.createOwnerRunwayImageOneShotPermit !== permit.createOwnerRunwayImageOneShotPermit ||
      api.consumeOwnerRunwayImageOneShotPermit !== permit.consumeOwnerRunwayImageOneShotPermit ||
      api.OwnerRunwayImageGenerationService !== generation.OwnerRunwayImageGenerationService ||
      api.registerSyntxOwnerRunwayImageTools !== toolsModule.registerSyntxOwnerRunwayImageTools ||
      api.OwnerRunwayImageParametersError !== parameters.OwnerRunwayImageParametersError ||
      api.OwnerRunwayImageSourceProfileError !== profile.OwnerRunwayImageSourceProfileError ||
      api.OwnerRunwayImagePrepareError !== preparer.OwnerRunwayImagePrepareError ||
      api.OwnerRunwayImageUploadServiceError !== upload.OwnerRunwayImageUploadServiceError ||
      api.OwnerRunwayImageOneShotPolicyError !== permit.OwnerRunwayImageOneShotPolicyError ||
      api.OwnerRunwayImageGenerationServiceError !== generation.OwnerRunwayImageGenerationServiceError ||
      api.OWNER_RUNWAY_IMAGE_GENERATION_PHASES !== generation.OWNER_RUNWAY_IMAGE_GENERATION_PHASES ||
      api.OWNER_RUNWAY_IMAGE_GENERATION_ERROR_CODES !== generation.OWNER_RUNWAY_IMAGE_GENERATION_ERROR_CODES ||
      api.OWNER_RUNWAY_IMAGE_GENERATION_RESULT_REASONS !== generation.OWNER_RUNWAY_IMAGE_GENERATION_RESULT_REASONS ||
      api.OWNER_RUNWAY_IMAGE_GENERATION_HISTORY_REASONS !== generation.OWNER_RUNWAY_IMAGE_GENERATION_HISTORY_REASONS ||
      api.createMcpServer !== serverModule.createMcpServer || api.createObservedOwnerRuntime !== runtimeModule.createObservedOwnerRuntime ||
      api.SyntxChatHttpClient !== clientModule.SyntxChatHttpClient) {
    fail("INSTALLED_RUNWAY_IMAGE_PUBLIC_EXPORT_MISMATCH");
  }
  phase = "compiled-api";
  const sourceParameters = api.getOwnerRunwayImageSourceParameters();
  const normalized = api.normalizeOwnerRunwayImageParameters({ variant: "runway_frames", reference_count: 1,
    parameters: { resolution: "1920x1088", temperature: 1.25 } });
  if (normalized.parameters.temperature !== 1.25 || normalized.source_wire_settings.n !== 1 || normalized.backend_acceptance !== "UNPROVEN" ||
      sourceParameters.source_pins?.source_execution !== false || sourceParameters.dispatch_allowed !== false || sourceParameters.runtime_activation !== false) {
    fail("INSTALLED_RUNWAY_IMAGE_COMPILED_API_REGRESSION_FAILED");
  }
  let rejectedInvalidTemperature = false;
  try { api.normalizeOwnerRunwayImageParameters({ variant: "runway_frames", reference_count: 0,
    parameters: { resolution: "1920x1088", temperature: 5.01 } }); } catch { rejectedInvalidTemperature = true; }
  if (!rejectedInvalidTemperature) fail("INSTALLED_RUNWAY_IMAGE_COMPILED_API_REGRESSION_FAILED");
  phase = "source-profile";
  const selectedVersion = selectedCatalogModule.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  const selected = selectedCatalogModule.loadSelectedDiscoveryCatalog(selectedVersion, join(installedPackagePath, "catalog"));
  const profileValue = api.getOwnerRunwayImageSourceProfile("runway_frames", selected.discoveryCatalog, selectedVersion);
  if (selectedVersion !== SOURCE_CATALOG_VERSION || profileValue.public_catalog_version !== SOURCE_CATALOG_VERSION ||
      profileValue.dispatch_allowed !== false || profileValue.runtime_activation !== false || profileValue.backend_acceptance !== "UNPROVEN" ||
      profileValue.fixed_wire?.n !== 1 || profileValue.reference_count?.maximum !== 3 ||
      !sameArray(profileValue.public_settings?.accepted_file_types, ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]) ||
      !sameArray(profileValue.public_settings?.allowed_media_types, ["images"]) || profileValue.public_settings?.file_count_limit !== 3 ||
      profileValue.cost_policy?.quote_or_amount !== "UNPROVEN" || profileValue.cost_policy?.confidence !== "NO_SOURCE_SCALAR_INPUTS_NOT_FREE_PRICE" ||
      profileValue.source_binding?.source_artifacts?.runway_form?.sha256 !== "sha256:1017f19b07dc888fa40ad9bc2d36121975d8c233ef0673bd7a7261b056c25447" ||
      profileValue.source_binding?.source_artifacts?.settings_helper?.sha256 !== "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" ||
      profileValue.source_binding?.source_artifacts?.app_store?.sha256 !== "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf") {
    fail("INSTALLED_RUNWAY_IMAGE_SOURCE_PROFILE_INVALID");
  }
  const sdkDiagnostics = {
    phases: generation.OWNER_RUNWAY_IMAGE_GENERATION_PHASES,
    errorCodes: generation.OWNER_RUNWAY_IMAGE_GENERATION_ERROR_CODES,
    historyReasons: generation.OWNER_RUNWAY_IMAGE_GENERATION_HISTORY_REASONS,
    resultReasons: generation.OWNER_RUNWAY_IMAGE_GENERATION_RESULT_REASONS
  };
  const declaration = await readFile(join(installedPackagePath, "dist/src/index.d.ts"), "utf8");
  phase = "declarations";
  if (["OwnerRunwayImageVariant", "OwnerRunwayImageParameters", "OwnerRunwayImageNormalizedParameters", "OwnerRunwayImageSourceProfile",
    "OwnerRunwayImageCatalogPort", "OwnerRunwayImageUploadServiceOptions", "OwnerRunwayImageUploadInput", "OwnerRunwayImageUploadReceipt",
    "OwnerRunwayImagePreparedCandidate", "OwnerRunwayImageReferenceBindingIssuer", "OwnerRunwayImageReferenceBindingIssueInput",
    "OwnerRunwayImageOneShotPermit", "OwnerRunwayImageGenerationServiceOptions", "OwnerRunwayImageGenerationResult",
    "OwnerRunwayImageRecoveryListItem", "OwnerRunwayImageServiceComposition", "RegisterSyntxOwnerRunwayImageToolsOptions",
    "RunwayImageReferenceUploadRequest", "StartRunwayImageWithOwnedCandidateInput", "CreateMcpServerOptions"].some((name) => !declaration.includes(name))) {
    fail("INSTALLED_RUNWAY_IMAGE_DECLARATION_INVALID");
  }
  const flag = stdioModule.readOwnerRunwayImageReferencesFlag;
  phase = "flag-reader";
  if (typeof flag !== "function" || flag(undefined) !== false || flag("") !== false || flag("0") !== false || flag("1") !== true) {
    fail("INSTALLED_RUNWAY_IMAGE_FLAG_INVALID");
  }
  for (const value of ["true", "yes", "01", " 1 "]) {
    let rejected = false; try { flag(value); } catch { rejected = true; }
    if (!rejected) fail("INSTALLED_RUNWAY_IMAGE_FLAG_INVALID");
  }
  phase = "stdio-default";
  const defaultResult = await listInstalledRunwayImageTools(installedPackagePath, consumerPath, false, sdkDiagnostics);
  phase = "stdio-opt-in";
  const optInResult = await listInstalledRunwayImageTools(installedPackagePath, consumerPath, true, sdkDiagnostics);
  return Object.freeze({
    default_tools: defaultResult.runway_image_tool_count, opt_in_tools: optInResult.runway_image_tool_count,
    source_metadata: "PASS", sdk_version: optInResult.sdk_version, node_path: process.execPath,
    default_child_close: defaultResult.child_close, opt_in_child_close: optInResult.child_close,
    default_child_pid_null: defaultResult.child_pid_null, opt_in_child_pid_null: optInResult.child_pid_null,
    default_stderr_bytes: defaultResult.stderr_bytes, opt_in_stderr_bytes: optInResult.stderr_bytes,
    sdk_operations: Object.freeze(["initialize", "tools/list", "close"]), tool_calls: 0, network_calls: 0
  });
  } catch (error) {
    if (error instanceof RunwayImageNativeToolsError) throw error;
    fail(runwayImageUnexpectedErrorCode(phase, error));
  }
}

async function listInstalledRunwayImageTools(installedPackagePath, consumerPath, enabled, diagnosticEnums) {
  const require = createRequire(join(consumerPath, "package.json"));
  let clientPath; let stdioPath;
  try {
    clientPath = require.resolve("@modelcontextprotocol/sdk/client/index.js");
    stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js");
  } catch { fail("INSTALLED_RUNWAY_IMAGE_SDK_RESOLUTION_FAILED"); }
  const sdkPath = join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk");
  let resolvedConsumer; let resolvedSdk; let resolvedClient; let resolvedStdio; let resolvedProject;
  try {
    [resolvedConsumer, resolvedSdk, resolvedClient, resolvedStdio, resolvedProject] = await Promise.all([
      realpath(consumerPath), realpath(sdkPath), realpath(clientPath), realpath(stdioPath), realpath(PROJECT_ROOT)
    ]);
  } catch { fail("INSTALLED_RUNWAY_IMAGE_SDK_RESOLUTION_FAILED"); }
  assertConsumerSdkResolution({ consumerPath, resolvedConsumerPath: resolvedConsumer, sdkPackagePath: sdkPath,
    resolvedSdkPackagePath: resolvedSdk, clientModulePath: resolvedClient, stdioModulePath: resolvedStdio, projectRoot: resolvedProject });
  let manifest;
  try { manifest = JSON.parse(await readFile(join(resolvedSdk, "package.json"), "utf8")); }
  catch { fail("INSTALLED_RUNWAY_IMAGE_SDK_MANIFEST_INVALID"); }
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest?.version !== "1.32.1") fail("INSTALLED_RUNWAY_IMAGE_SDK_VERSION_MISMATCH");
  const [{ Client }, { StdioClientTransport }] = await Promise.all([import(pathToFileURL(clientPath).href), import(pathToFileURL(stdioPath).href)]);
  const client = new Client({ name: enabled ? "syntx-installed-runway-image-opt-in" : "syntx-installed-runway-image-default", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")],
    cwd: consumerPath, env: enabled ? { SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES: "1" } : {}, stderr: "pipe" });
  let closeObserved = false; let resolveClose;
  const closed = new Promise((resolvePromise) => { resolveClose = resolvePromise; });
  const previousOnClose = transport.onclose;
  transport.onclose = () => { closeObserved = true; try { previousOnClose?.(); } finally { resolveClose(); } };
  let stderrBytes = 0;
  transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  let connected = false; let failure; let surface;
  try {
    await withDeadline(client.connect(transport), 5_500, "INSTALLED_RUNWAY_IMAGE_STDIO_INITIALIZE_TIMEOUT");
    connected = true;
    if (!Number.isSafeInteger(transport.pid) || transport.pid <= 0) fail("INSTALLED_RUNWAY_IMAGE_STDIO_PID_INVALID");
    const listed = await withDeadline(client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }),
      5_500, "INSTALLED_RUNWAY_IMAGE_TOOLS_LIST_TIMEOUT");
    surface = assertRunwayImageToolSurface(listed.tools, enabled, diagnosticEnums);
  } catch (error) {
    failure = error instanceof RunwayImageNativeToolsError ? error : new RunwayImageNativeToolsError("INSTALLED_RUNWAY_IMAGE_STDIO_TOOLS_LIST_FAILED");
  } finally {
    try { await withDeadline(connected ? client.close() : transport.close(), 2_000, "INSTALLED_RUNWAY_IMAGE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new RunwayImageNativeToolsError("INSTALLED_RUNWAY_IMAGE_STDIO_CLOSE_FAILED"); }
    try { await withDeadline(closed, 2_000, "INSTALLED_RUNWAY_IMAGE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new RunwayImageNativeToolsError("INSTALLED_RUNWAY_IMAGE_STDIO_CLOSE_FAILED"); }
    if (!closeObserved || transport.pid !== null) failure ??= new RunwayImageNativeToolsError("INSTALLED_RUNWAY_IMAGE_STDIO_CLOSE_FAILED");
  }
  if (failure) throw failure;
  if (stderrBytes !== 0) fail("INSTALLED_RUNWAY_IMAGE_STDIO_STDERR_NOT_EMPTY");
  return Object.freeze({ ...surface, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes, sdk_version: manifest.version });
}

function assertToolAnnotations(tool, readOnly, openWorld, code) {
  if (tool.annotations?.readOnlyHint !== readOnly || tool.annotations?.destructiveHint !== !readOnly ||
      tool.annotations?.idempotentHint !== readOnly || tool.annotations?.openWorldHint !== openWorld) fail(code);
}
function assertStrictObject(schema, required, optional, code) {
  if (!isRecord(schema) || schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(schema.properties ?? {}).sort(), [...required, ...optional].sort()) ||
      !sameArray([...(schema.required ?? [])].sort(), [...required].sort())) fail(code);
}
function assertAllObjectsStrict(schema, code, seen = new Set()) {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return;
  seen.add(schema);
  if (schema.type === "object" && schema.additionalProperties !== false) fail(code);
  for (const value of Object.values(schema)) {
    if (Array.isArray(value)) for (const item of value) assertAllObjectsStrict(item, code, seen);
    else assertAllObjectsStrict(value, code, seen);
  }
}
function properties(schema, code) {
  if (!isRecord(schema?.properties)) fail(code);
  return schema.properties;
}
function sameArray(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function allowlistedErrorClass(error) {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof AggregateError) return "AggregateError";
  if (error instanceof Error) return "Error";
  return "NonError";
}
function isPathWithin(root, candidate) {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}
function withDeadline(promise, milliseconds, code) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new RunwayImageNativeToolsError(code)), milliseconds); timer.unref?.(); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
function fail(code) { throw new RunwayImageNativeToolsError(code); }
