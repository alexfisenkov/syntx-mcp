import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class SeedreamImageNativeToolsError extends Error {
  constructor(code) { super(code); this.name = "SeedreamImageNativeToolsError"; this.code = code; }
}

const PACKAGE_MODULES = Object.freeze([
  "application/owner-seedream-image-parameters", "application/owner-seedream-image-source-profile",
  "application/owner-seedream-image-input-validator", "application/owner-seedream-extra-image-inspector",
  "application/owner-png-alpha-inspector", "application/owner-seedream-source-alpha-witness",
  "application/owner-seedream-image-upload-service", "application/owner-seedream-image-request-preparer",
  "application/owner-seedream-image-history-binding", "application/owner-seedream-image-one-shot-policy",
  "application/owner-seedream-image-generation-service", "mcp/owner-seedream-image-tools", "mcp/server",
  "runtime/observed-owner-runtime", "transports/stdio-owner", "adapter/syntx/chat-http-client",
  "adapter/syntx/seedream-image-result", "adapter/syntx/upload-reference-bridge", "catalog/selected-discovery-catalog"
]);

const PACKAGE_PATHS = Object.freeze(["dist/src/index.js", "dist/src/index.d.ts",
  ...PACKAGE_MODULES.flatMap((path) => [`dist/src/${path}.js`, `dist/src/${path}.d.ts`])
]);
const TOOL_NAMES = Object.freeze([
  "syntx_upload_seedream_image_reference", "syntx_owner_generate_seedream_image",
  "syntx_owner_reconcile_seedream_image", "syntx_owner_list_seedream_image_recoveries"
]);
const CHECK_PHASES = Object.freeze(["package-paths", "node-runtime", "module-import", "public-exports", "compiled-api", "source-profile",
  "declarations", "flag-reader", "stdio-default", "stdio-opt-in"]);
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const VARIANTS = Object.freeze(["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"]);
const RATIOS = Object.freeze(["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"]);
const ALL_RESOLUTIONS = Object.freeze(["1K", "1.5K", "2K", "3K", "4K"]);
const RESOLUTIONS = Object.freeze({
  "seedream-4": Object.freeze(["1K", "2K", "4K"]),
  "seedream-4.5": Object.freeze(["2K", "4K"]),
  "seedream-5": Object.freeze(["2K", "3K", "4K"]),
  "seedream-5.0-flash": Object.freeze(["1K", "1.5K", "2K"]),
  "seedream-5.0-pro": Object.freeze(["1K", "2K"])
});
const REFERENCE_CAPS = Object.freeze({ "seedream-4": 4, "seedream-4.5": 4, "seedream-5": 14, "seedream-5.0-flash": 10, "seedream-5.0-pro": 10 });
const BASIC_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]);
const EXTRA_MIMES = Object.freeze(["image/bmp", "image/gif", "image/tiff", "image/heic", "image/heif"]);
const ALL_SOURCE_MIMES = Object.freeze([...BASIC_MIMES, ...EXTRA_MIMES]);
const FLASH_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/heic", "image/heif", "image/tiff", "image/gif", "image/webp"]);
const PRO_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"]);
const CANONICAL_MIMES = Object.freeze(["image/jpeg", "image/png", "image/avif", "image/webp", "image/bmp", "image/gif", "image/tiff", "image/heic", "image/heif"]);
const SOURCE_ALPHA_CONFIDENCES = Object.freeze(["SOURCE_CANVAS_ALPHA8_NEAREST_SAMPLED", "UNSUPPORTED_PNG_ALPHA_COMPOSITION", "NOT_PNG_SOURCE"]);
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const SETTINGS_VERSION = "sha256:00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61";
const SOURCE_FORM_SHA256 = "sha256:3e762f2725970438f392c18f1d4153e93d4aee1165597e28207a8853a0a5b1d1";
const SOURCE_APP_SHA256 = "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf";
const GENERATION_PHASES = Object.freeze(["REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
  "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"]);
const GENERATION_ERROR_CODES = Object.freeze(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "REFERENCE_ALREADY_CLAIMED", "PREFLIGHT_FAILED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"]);
const HISTORY_REASONS = Object.freeze(["INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
  "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE", "MESSAGE_CHAT_MISMATCH",
  "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH", "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID",
  "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS", "BOT_MESSAGE_BEFORE_ACK", "BOT_OBJECTS_INVALID", "BOT_MODEL_MISMATCH"]);
const RESULT_REASONS = Object.freeze(["NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH",
  "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH",
  "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE"]);

export function assertSeedreamImageNativePackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_SEEDREAM_IMAGE_PACKAGE_PATHS_INVALID");
  if (PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) fail("INSTALLED_SEEDREAM_IMAGE_PACKAGE_CONTENT_MISSING");
  return true;
}

/** Bind imported modules to their declared package paths; array order is not an API. */
export function mapSeedreamImageNativeModules(modulePaths, loadedModules) {
  if (!Array.isArray(modulePaths) || !Array.isArray(loadedModules) || modulePaths.length !== loadedModules.length ||
      modulePaths.some((path) => typeof path !== "string") || new Set(modulePaths).size !== modulePaths.length ||
      loadedModules.some((module) => !isRecord(module))) fail("INSTALLED_SEEDREAM_IMAGE_MODULE_MAP_INVALID");
  return new Map(modulePaths.map((path, index) => [path, loadedModules[index]]));
}

export function assertSeedreamImageToolNames(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_SEEDREAM_IMAGE_TOOLS_LIST_INVALID");
  const names = tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length !== 0) fail("INSTALLED_SEEDREAM_IMAGE_DEFAULT_OFF_FAILED");
    return Object.freeze({ seedream_image_tool_count: 0 });
  }
  if (names.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => names.filter((item) => item === name).length !== 1)) {
    fail("INSTALLED_SEEDREAM_IMAGE_TOOL_SET_MISMATCH");
  }
  return Object.freeze({ seedream_image_tool_count: TOOL_NAMES.length });
}

/** Verify the actual installed MCP JSON schema surface against fixed local expectations. */
export function assertSeedreamImageToolSurface(tools, enabled, diagnosticEnums) {
  const counts = assertSeedreamImageToolNames(tools, enabled);
  if (!enabled) return counts;
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const [upload, generate, reconcile, list] = TOOL_NAMES.map((name) => byName.get(name));
  const code = "INSTALLED_SEEDREAM_IMAGE_SCHEMA_INVALID";
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
  const reference = "^seedream_image_[0-9a-f-]{36}$";
  const recovery = "^seedream_image_recovery_[0-9a-f-]{36}$";
  assertStrictObject(upload.inputSchema, ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"], [], code);
  assertStrictObject(generate.inputSchema, ["link_attempt_id", "variant", "reference_handles", "parameters", "prompt"], [], code);
  assertStrictObject(reconcile.inputSchema, ["link_attempt_id", "recovery_id"], [], code);
  assertStrictObject(list.inputSchema, ["link_attempt_id", "limit"], [], code);
  assertStrictObject(upload.outputSchema, ["status", "reference_handle", "variant", "original_mime_type", "mime_type",
    "width", "height", "size", "sha256", "expires_in_seconds", "metadata_confidence", "validation_confidence",
    "source_alpha_eligible", "source_alpha_confidence", "source_sample_width", "source_sample_height"], [], code);
  assertStrictObject(generate.outputSchema, ["status", "namespace_confidence", "backend_acceptance", "ai_name", "model_id", "variant",
    "operation_id", "profile_id", "profile_schema_hash", "catalog_version", "request_fingerprint", "parameters", "cost_inputs",
    "cost_input_confidence", "reference_count", "input_references", "actual_image", "geometry_verified", "artifact"], [], code);
  assertStrictObject(list.outputSchema, ["recoveries", "confidence_scope"], [], code);
  if (uploadInput.link_attempt_id?.pattern !== attempt || generateInput.link_attempt_id?.pattern !== attempt ||
      reconcile.inputSchema.properties?.link_attempt_id?.pattern !== attempt || list.inputSchema.properties?.link_attempt_id?.pattern !== attempt ||
      reconcile.inputSchema.properties?.recovery_id?.pattern !== recovery ||
      !sameArray(uploadInput.variant?.enum, VARIANTS) || !sameArray(generateInput.variant?.enum, VARIANTS)) fail("INSTALLED_SEEDREAM_IMAGE_ID_SCHEMA_INVALID");
  if (uploadInput.content_base64?.minLength !== 4 || uploadInput.content_base64?.pattern !== "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" ||
      uploadInput.filename?.minLength !== 1 || uploadInput.filename?.maxLength !== 255 || !sameArray(uploadInput.mime_type?.enum, ALL_SOURCE_MIMES)) {
    fail("INSTALLED_SEEDREAM_IMAGE_UPLOAD_INPUT_SCHEMA_INVALID");
  }
  if (generateInput.reference_handles?.type !== "array" || generateInput.reference_handles?.maxItems !== 14 ||
      generateInput.reference_handles?.items?.pattern !== reference || generateInput.prompt?.minLength !== 1 || generateInput.prompt?.maxLength !== 65_536 ||
      list.inputSchema.properties?.limit?.minimum !== 1 || list.inputSchema.properties?.limit?.maximum !== 20) {
    fail("INSTALLED_SEEDREAM_IMAGE_GENERATION_INPUT_SCHEMA_INVALID");
  }
  assertSeedreamParameterUnion(generateInput.parameters, code);
  if (uploadOutput.status?.const !== "uploaded" || uploadOutput.reference_handle?.pattern !== reference ||
      !sameArray(uploadOutput.variant?.enum, VARIANTS) || !sameArray(uploadOutput.original_mime_type?.enum, ALL_SOURCE_MIMES) ||
      !sameArray(uploadOutput.mime_type?.enum, CANONICAL_MIMES) || uploadOutput.metadata_confidence?.const !== "CONTAINER_METADATA_ONLY" ||
      !hasNumericMaximum(uploadOutput.source_sample_width, 1_024) || !hasNumericMaximum(uploadOutput.source_sample_height, 1_024) ||
      !sameArray(uploadOutput.source_alpha_confidence?.enum, SOURCE_ALPHA_CONFIDENCES)) fail("INSTALLED_SEEDREAM_IMAGE_UPLOAD_OUTPUT_SCHEMA_INVALID");
  const outputParameters = properties(generateOutput.parameters, code);
  assertStrictObject(generateOutput.parameters, ["aspect_ratio", "resolution", "output_format", "background"], [], code);
  if (!sameArray(outputParameters.aspect_ratio?.enum, RATIOS) || !sameArray(outputParameters.resolution?.enum, ALL_RESOLUTIONS) ||
      !isNullableNull(outputParameters.output_format) || !isNullableNull(outputParameters.background)) fail(code);
  assertStrictObject(generateOutput.actual_image, ["mime_type", "width", "height"], [], code);
  assertStrictObject(generateOutput.artifact, ["url", "mime_type", "mime_source", "width", "height", "geometry_verified"], [], code);
  assertStrictObject(generateOutput.input_references.items, ["source_mime_type", "mime_type", "width", "height", "size", "sha256",
    "metadata_confidence", "source_alpha"], [], code);
  if (generateOutput.status?.const !== "result_observed" || generateOutput.namespace_confidence?.const !== "SOURCE_SHAPED_UNVERIFIED" ||
      generateOutput.backend_acceptance?.const !== "UNPROVEN" || generateOutput.geometry_verified?.const !== false ||
      generateOutput.reference_count?.maximum !== 14 || generateOutput.input_references?.maxItems !== 14 ||
      generateOutput.actual_image?.properties?.width?.type !== "null" || generateOutput.actual_image?.properties?.height?.type !== "null" ||
      generateOutput.artifact?.properties?.geometry_verified?.const !== false ||
      !sameArray(generateOutput.artifact?.properties?.mime_source?.enum, ["URL_EXTENSION", "UNKNOWN"]) ||
      !isNullableNull(outputParameters.output_format) || !isNullableNull(outputParameters.background)) {
    fail("INSTALLED_SEEDREAM_IMAGE_GENERATION_OUTPUT_SCHEMA_INVALID");
  }
  assertSeedreamCostUnion(generateOutput.cost_inputs, code);
  if (listOutput.confidence_scope?.const !== "process_local_get_only_recovery" || listOutput.recoveries?.type !== "array" ||
      listOutput.recoveries?.maxItems !== 20) fail("INSTALLED_SEEDREAM_IMAGE_RECOVERY_OUTPUT_SCHEMA_INVALID");
  const recoveryItem = listOutput.recoveries.items;
  assertStrictObject(recoveryItem, ["recovery_id", "created_at", "model_id", "operation_id", "status", "diagnostic"], [], code);
  const diagnostic = recoveryItem.properties.diagnostic;
  assertStrictObject(diagnostic, ["phase", "post_started", "echo_ack_known", "history_binding", "history_binding_reason",
    "history_get_calls", "history_get_calls_saturated", "result_get_calls", "result_get_calls_saturated", "result_status", "result_reason"], [], code);
  if (recoveryItem.properties.recovery_id?.pattern !== recovery || !sameArray(recoveryItem.properties.model_id?.enum, VARIANTS) ||
      recoveryItem.properties.status?.const !== "OUTCOME_UNKNOWN" ||
      !sameArray(diagnostic.properties.phase?.enum, GENERATION_PHASES) ||
      !sameArray(nullableEnum(diagnostic.properties.history_binding_reason), HISTORY_REASONS) ||
      !sameArray(nullableEnum(diagnostic.properties.result_reason), RESULT_REASONS)) fail("INSTALLED_SEEDREAM_IMAGE_RECOVERY_OUTPUT_SCHEMA_INVALID");
  if (diagnosticEnums !== undefined && (!sameArray(diagnosticEnums.phases, GENERATION_PHASES) ||
      !sameArray(diagnosticEnums.errorCodes, GENERATION_ERROR_CODES) || !sameArray(diagnosticEnums.historyReasons, HISTORY_REASONS) ||
      !sameArray(diagnosticEnums.resultReasons, RESULT_REASONS))) fail("INSTALLED_SEEDREAM_IMAGE_RECOVERY_OUTPUT_SCHEMA_INVALID");
  assertToolAnnotations(upload, false, false, code);
  assertToolAnnotations(generate, false, true, code);
  assertToolAnnotations(reconcile, true, true, code);
  assertToolAnnotations(list, true, true, code);
  if (!String(generate.description ?? "").includes("do not repeat") || !String(reconcile.description ?? "").includes("GET-only") ||
      !String(list.description ?? "").includes("never returned")) fail("INSTALLED_SEEDREAM_IMAGE_OPERATION_BOUNDARY_INVALID");
  return counts;
}

export function assertConsumerSdkResolution({ consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath,
  clientModulePath, stdioModulePath, projectRoot }) {
  if (![consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath, clientModulePath, stdioModulePath, projectRoot]
    .every((path) => typeof path === "string" && isAbsolute(path))) fail("INSTALLED_SEEDREAM_IMAGE_SDK_NOT_FROM_CONSUMER");
  const expectedSdk = join(resolve(consumerPath), "node_modules", "@modelcontextprotocol", "sdk");
  const sdkRoot = resolve(resolvedSdkPackagePath);
  if (resolve(sdkPackagePath) !== expectedSdk || !isPathWithin(resolvedConsumerPath, sdkRoot) ||
      isPathWithin(projectRoot, sdkRoot) || !isPathWithin(sdkRoot, resolve(clientModulePath)) ||
      !isPathWithin(sdkRoot, resolve(stdioModulePath))) fail("INSTALLED_SEEDREAM_IMAGE_SDK_NOT_FROM_CONSUMER");
  return true;
}

export function seedreamImageUnexpectedErrorCode(phase, error) {
  if (!CHECK_PHASES.includes(phase)) fail("INSTALLED_SEEDREAM_IMAGE_DIAGNOSTIC_PHASE_INVALID");
  return `INSTALLED_SEEDREAM_IMAGE_UNEXPECTED_${phase}_${allowlistedErrorClass(error)}`;
}

/** Exercise only the installed pure Seedream source/parameter APIs; this grants no owned input or dispatch proof. */
export function assertSeedreamImageSourceContract(parameters, profileModule, selectedCatalog, selectedVersion) {
  const source = parameters?.getOwnerSeedreamImageSourceParameters?.();
  if (!source || selectedVersion !== PUBLIC_VERSION || !sameArray(source.variants, VARIANTS) ||
      !sameArray(source.parameter_keys, ["aspect_ratio", "resolution", "output_format", "background"]) ||
      source.inactive_control_policy !== "EXPLICIT_NULL_IN_LOCAL_STATE_OMITTED_FROM_WIRE" ||
      source.fixed_wire?.n !== 1 || source.fixed_wire?.stream !== false || source.effective_defaults !== "UNKNOWN" ||
      source.dispatch_allowed !== false || source.runtime_activation !== false || source.backend_acceptance !== "UNPROVEN" ||
      source.cost_boundary?.quote_or_cost_amount !== "UNPROVEN" || source.cost_boundary?.effective_inputs !==
        "PRO_BATCH_SIZE_EQUALS_EXPLICIT_REFERENCE_COUNT_INCLUDING_ZERO; RESOLUTION_EXPLICIT; OTHERS_EMPTY") {
    fail("INSTALLED_SEEDREAM_IMAGE_COMPILED_API_REGRESSION_FAILED");
  }
  const pins = source.source_pins;
  if (pins?.public_catalog !== PUBLIC_VERSION || pins?.settings_inventory !== SETTINGS_VERSION ||
      pins?.form_build_id !== "1791467421" || pins?.form_module !== "seedream.js" || pins?.form_bytes !== 9_142 ||
      pins?.form_sha256 !== SOURCE_FORM_SHA256 || pins?.app_store_sha256 !== SOURCE_APP_SHA256 ||
      !String(pins?.fixed_sender_source ?? "").includes("NOT_RUNTIME_VERIFIED")) fail("INSTALLED_SEEDREAM_IMAGE_SOURCE_PROFILE_INVALID");

  const selected = selectedCatalog;
  if (!selected || !profileModule || typeof profileModule.getOwnerSeedreamImageSourceProfile !== "function") {
    fail("INSTALLED_SEEDREAM_IMAGE_SOURCE_PROFILE_INVALID");
  }
  let parameterCombinationCount = 0;
  for (const variant of VARIANTS) {
    const profile = profileModule.getOwnerSeedreamImageSourceProfile(variant, selected, selectedVersion);
    const cap = REFERENCE_CAPS[variant];
    const expectedMimes = variant === "seedream-5.0-flash" ? FLASH_MIMES : variant === "seedream-5.0-pro" ? PRO_MIMES : BASIC_MIMES;
    const expectedCostKeys = variant === "seedream-5.0-pro" ? ["batch_size", "resolution"] : [];
    if (profile.variant !== variant || profile.model_id !== variant || profile.ai_name !== "seedream" ||
        profile.model_type !== variant || profile.operation_id !== "generate-image" ||
        profile.public_catalog_version !== selectedVersion || profile.dispatch_allowed !== false ||
        profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN" || profile.effective_defaults !== "UNKNOWN" ||
        profile.reference_count?.minimum !== 0 || profile.reference_count?.maximum !== cap ||
        profile.public_settings?.file_count_limit !== cap || !sameArray(profile.public_settings?.accepted_file_types, expectedMimes) ||
        !sameArray(profile.mime_policy?.accepted_file_types, expectedMimes) ||
        !sameArray(profile.cost_policy?.declared_metadata_keys, expectedCostKeys) ||
        !sameArray(profile.cost_policy?.controlled_inputs, expectedCostKeys) ||
        profile.cost_policy?.quote_or_amount !== "UNPROVEN" ||
        profile.source_binding?.selected_public_catalog_version !== PUBLIC_VERSION ||
        profile.source_binding?.settings_inventory?.version !== SETTINGS_VERSION ||
        profile.source_binding?.settings_inventory?.runtime_usable !== false ||
        profile.source_binding?.form_source?.build_id !== "1791467421" || profile.source_binding?.form_source?.sha256 !== SOURCE_FORM_SHA256) {
      fail("INSTALLED_SEEDREAM_IMAGE_SOURCE_PROFILE_INVALID");
    }
    for (const resolution of RESOLUTIONS[variant]) {
      for (const aspect_ratio of RATIOS) {
        const parametersInput = variant === "seedream-5.0-flash"
          ? { aspect_ratio, resolution, output_format: "jpeg", background: "opaque" }
          : { aspect_ratio, resolution, output_format: null, background: null };
        const normalized = parameters.normalizeOwnerSeedreamImageParameters({ variant, reference_count: 0, parameters: parametersInput });
        const expectedCost = variant === "seedream-5.0-pro" ? { batch_size: 0, resolution } : {};
        if (normalized.variant !== variant || normalized.parameters.aspect_ratio !== aspect_ratio ||
            normalized.parameters.resolution !== resolution || normalized.reference_count !== 0 || normalized.wire_settings.n !== 1 ||
            normalized.wire_settings.stream !== false || !isDeepStrictEqual(normalized.cost_inputs, expectedCost) ||
            normalized.dispatch_allowed !== false || normalized.runtime_activation !== false || normalized.backend_acceptance !== "UNPROVEN" ||
            normalized.transparency_eligibility?.pixel_alpha_proven !== false ||
            normalized.transparency_eligibility?.owned_references_bound !== false ||
            normalized.transparency_eligibility?.browser_geometry_proven !== false) fail("INSTALLED_SEEDREAM_IMAGE_PARAMETER_MATRIX_INVALID");
        if (variant !== "seedream-5.0-flash" && (Object.hasOwn(normalized.wire_settings, "output_format") ||
            Object.hasOwn(normalized.wire_settings, "background"))) fail("INSTALLED_SEEDREAM_IMAGE_PARAMETER_MATRIX_INVALID");
        if (variant === "seedream-5.0-flash" && (normalized.wire_settings.output_format !== "jpeg" ||
            normalized.wire_settings.background !== "opaque")) fail("INSTALLED_SEEDREAM_IMAGE_PARAMETER_MATRIX_INVALID");
        parameterCombinationCount += 1;
      }
    }
  }
  if (parameterCombinationCount !== 104) fail("INSTALLED_SEEDREAM_IMAGE_PARAMETER_MATRIX_INVALID");

  const flashBase = { aspect_ratio: "1:1", resolution: "1K" };
  for (const [output_format, background] of [["jpeg", "opaque"], ["png", "opaque"]]) {
    const normalized = parameters.normalizeOwnerSeedreamImageParameters({ variant: "seedream-5.0-flash", reference_count: 0,
      parameters: { ...flashBase, output_format, background } });
    if (normalized.parameters.output_format !== output_format || normalized.parameters.background !== background ||
        normalized.dispatch_allowed !== false || normalized.transparency_eligibility.pixel_alpha_proven !== false) {
      fail("INSTALLED_SEEDREAM_IMAGE_FLASH_BRANCH_INVALID");
    }
  }
  const transparent = parameters.normalizeOwnerSeedreamImageParameters({ variant: "seedream-5.0-flash", reference_count: 1,
    parameters: { ...flashBase, output_format: "png", background: "transparent" },
    transparency_context: { reference_count: 1, source_mime_types: ["image/png"], pixel_alpha_eligible: true } });
  if (transparent.parameters.background !== "transparent" || transparent.transparency_eligibility.pixel_alpha_proven !== false ||
      transparent.transparency_eligibility.owned_references_bound !== false || transparent.dispatch_allowed !== false) {
    fail("INSTALLED_SEEDREAM_IMAGE_FLASH_BRANCH_INVALID");
  }
  let rejectedJpegTransparency = false;
  try {
    parameters.normalizeOwnerSeedreamImageParameters({ variant: "seedream-5.0-flash", reference_count: 1,
      parameters: { ...flashBase, output_format: "jpeg", background: "transparent" },
      transparency_context: { reference_count: 1, source_mime_types: ["image/png"], pixel_alpha_eligible: true } });
  } catch { rejectedJpegTransparency = true; }
  if (!rejectedJpegTransparency) fail("INSTALLED_SEEDREAM_IMAGE_FLASH_BRANCH_INVALID");
  return Object.freeze({ seedream_variants_checked: 5, seedream_parameter_combinations_checked: parameterCombinationCount,
    source_execution_claimed: false });
}

/** Installed tarball check: imports only the consumer copy and lists tools without calling them. */
export async function assertInstalledSeedreamImageNativeTools(installedPackagePath, consumerPath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertSeedreamImageNativePackagePaths(packagedPaths);
    phase = "node-runtime";
    if (Number(process.versions.node.split(".")[0]) !== 24) fail("INSTALLED_SEEDREAM_IMAGE_NODE24_REQUIRED");
    const importPacked = (relativePath) => import(pathToFileURL(join(installedPackagePath, relativePath)).href);
    let loaded;
    phase = "module-import";
    try {
      loaded = await Promise.all([importPacked("dist/src/index.js"), ...PACKAGE_MODULES.map((name) => importPacked(`dist/src/${name}.js`))]);
    } catch { fail("INSTALLED_SEEDREAM_IMAGE_MODULE_IMPORT_FAILED"); }
    const api = loaded[0];
    const moduleMap = mapSeedreamImageNativeModules(PACKAGE_MODULES, loaded.slice(1));
    const moduleFor = (name) => moduleMap.get(name);
    const parameters = moduleFor("application/owner-seedream-image-parameters");
    const profile = moduleFor("application/owner-seedream-image-source-profile");
    const input = moduleFor("application/owner-seedream-image-input-validator");
    const extra = moduleFor("application/owner-seedream-extra-image-inspector");
    const png = moduleFor("application/owner-png-alpha-inspector");
    const witness = moduleFor("application/owner-seedream-source-alpha-witness");
    const upload = moduleFor("application/owner-seedream-image-upload-service");
    const preparer = moduleFor("application/owner-seedream-image-request-preparer");
    const history = moduleFor("application/owner-seedream-image-history-binding");
    const permit = moduleFor("application/owner-seedream-image-one-shot-policy");
    const generation = moduleFor("application/owner-seedream-image-generation-service");
    const tools = moduleFor("mcp/owner-seedream-image-tools");
    const server = moduleFor("mcp/server");
    const runtime = moduleFor("runtime/observed-owner-runtime");
    const stdio = moduleFor("transports/stdio-owner");
    const client = moduleFor("adapter/syntx/chat-http-client");
    const selectedCatalog = moduleFor("catalog/selected-discovery-catalog");

    phase = "public-exports";
    assertSeedreamImagePublicExports(api, { parameters, profile, input, extra, png, witness, upload, preparer,
      history, permit, generation, tools, server, runtime, client });

    phase = "compiled-api";
    const selectedVersion = selectedCatalog.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
    const selected = selectedCatalog.loadSelectedDiscoveryCatalog(selectedVersion, join(installedPackagePath, "catalog"));
    const sourceSummary = assertSeedreamImageSourceContract(parameters, profile, selected.discoveryCatalog, selectedVersion);
    if (selectedVersion !== PUBLIC_VERSION) fail("INSTALLED_SEEDREAM_IMAGE_SOURCE_PROFILE_INVALID");

    phase = "declarations";
    const declaration = await readFile(join(installedPackagePath, "dist/src/index.d.ts"), "utf8");
    const declarations = ["OwnerSeedreamImageVariant", "OwnerSeedreamImageParameters", "OwnerSeedreamImageSourceProfile",
      "OwnerSeedreamImageOwnedReferenceSet", "OwnerSeedreamImagePreparedCandidate", "OwnerSeedreamImageOneShotPermit",
      "OwnerSeedreamImageUploadServiceOptions", "OwnerSeedreamImageUploadInput", "OwnerSeedreamImageUploadReceipt",
      "OwnerSeedreamImageGenerationServiceOptions", "OwnerSeedreamImageGenerationPreflightInput", "OwnerSeedreamImageGenerateInput",
      "OwnerSeedreamImageGenerationResult", "OwnerSeedreamImageRecoveryListItem", "OwnerSeedreamImageServiceComposition",
      "RegisterSyntxOwnerSeedreamImageToolsOptions", "SeedreamImageReferenceUploadRequest", "StartSeedreamImageWithOwnedCandidateInput",
      "InternalSeedreamImageResult"];
    if (declarations.some((name) => !declaration.includes(name))) fail("INSTALLED_SEEDREAM_IMAGE_DECLARATION_INVALID");

    phase = "flag-reader";
    const flag = stdio.readOwnerSeedreamImageReferencesFlag;
    if (typeof flag !== "function" || flag(undefined) !== false || flag("") !== false || flag("0") !== false || flag("1") !== true) {
      fail("INSTALLED_SEEDREAM_IMAGE_FLAG_INVALID");
    }
    for (const value of ["true", "yes", "01", " 1 "]) {
      let rejected = false; try { flag(value); } catch { rejected = true; }
      if (!rejected) fail("INSTALLED_SEEDREAM_IMAGE_FLAG_INVALID");
    }

    const diagnosticEnums = {
      phases: generation.OWNER_SEEDREAM_IMAGE_GENERATION_PHASES,
      errorCodes: generation.OWNER_SEEDREAM_IMAGE_GENERATION_ERROR_CODES,
      historyReasons: generation.OWNER_SEEDREAM_IMAGE_GENERATION_HISTORY_REASONS,
      resultReasons: generation.OWNER_SEEDREAM_IMAGE_GENERATION_RESULT_REASONS
    };
    phase = "stdio-default";
    const defaultResult = await listInstalledSeedreamImageTools(installedPackagePath, consumerPath, false, diagnosticEnums);
    phase = "stdio-opt-in";
    const optInResult = await listInstalledSeedreamImageTools(installedPackagePath, consumerPath, true, diagnosticEnums);
    return Object.freeze({
      default_tools: defaultResult.seedream_image_tool_count, opt_in_tools: optInResult.seedream_image_tool_count,
      source_metadata: "PASS", parameter_combinations_checked: sourceSummary.seedream_parameter_combinations_checked,
      sdk_version: optInResult.sdk_version, node_path: process.execPath,
      default_child_close: defaultResult.child_close, opt_in_child_close: optInResult.child_close,
      default_child_pid_null: defaultResult.child_pid_null, opt_in_child_pid_null: optInResult.child_pid_null,
      default_stderr_bytes: defaultResult.stderr_bytes, opt_in_stderr_bytes: optInResult.stderr_bytes,
      sdk_operations: Object.freeze(["initialize", "tools/list", "close"]), tool_calls: 0, network_calls: 0
    });
  } catch (error) {
    if (error instanceof SeedreamImageNativeToolsError) throw error;
    fail(seedreamImageUnexpectedErrorCode(phase, error));
  }
}

async function listInstalledSeedreamImageTools(installedPackagePath, consumerPath, enabled, diagnosticEnums) {
  const require = createRequire(join(consumerPath, "package.json"));
  let clientPath; let stdioPath;
  try {
    clientPath = require.resolve("@modelcontextprotocol/sdk/client/index.js");
    stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js");
  } catch { fail("INSTALLED_SEEDREAM_IMAGE_SDK_RESOLUTION_FAILED"); }
  const sdkPath = join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk");
  let resolvedConsumer; let resolvedSdk; let resolvedClient; let resolvedStdio; let resolvedProject;
  try {
    [resolvedConsumer, resolvedSdk, resolvedClient, resolvedStdio, resolvedProject] = await Promise.all([
      realpath(consumerPath), realpath(sdkPath), realpath(clientPath), realpath(stdioPath), realpath(PROJECT_ROOT)
    ]);
  } catch { fail("INSTALLED_SEEDREAM_IMAGE_SDK_RESOLUTION_FAILED"); }
  assertConsumerSdkResolution({ consumerPath, resolvedConsumerPath: resolvedConsumer, sdkPackagePath: sdkPath,
    resolvedSdkPackagePath: resolvedSdk, clientModulePath: resolvedClient, stdioModulePath: resolvedStdio, projectRoot: resolvedProject });
  let manifest;
  try { manifest = JSON.parse(await readFile(join(resolvedSdk, "package.json"), "utf8")); }
  catch { fail("INSTALLED_SEEDREAM_IMAGE_SDK_MANIFEST_INVALID"); }
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest?.version !== "1.32.1") fail("INSTALLED_SEEDREAM_IMAGE_SDK_VERSION_MISMATCH");
  const [{ Client }, { StdioClientTransport }] = await Promise.all([import(pathToFileURL(clientPath).href), import(pathToFileURL(stdioPath).href)]);
  const client = new Client({ name: enabled ? "syntx-installed-seedream-opt-in" : "syntx-installed-seedream-default", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")],
    cwd: consumerPath, env: enabled ? { SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES: "1" } : {}, stderr: "pipe" });
  let closeObserved = false; let resolveClose;
  const closed = new Promise((resolvePromise) => { resolveClose = resolvePromise; });
  const previousOnClose = transport.onclose;
  transport.onclose = () => { closeObserved = true; try { previousOnClose?.(); } finally { resolveClose(); } };
  let stderrBytes = 0;
  transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  let connected = false; let failure; let surface;
  try {
    await withDeadline(client.connect(transport), 5_500, "INSTALLED_SEEDREAM_IMAGE_STDIO_INITIALIZE_TIMEOUT");
    connected = true;
    if (!Number.isSafeInteger(transport.pid) || transport.pid <= 0) fail("INSTALLED_SEEDREAM_IMAGE_STDIO_PID_INVALID");
    const listed = await withDeadline(client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }),
      5_500, "INSTALLED_SEEDREAM_IMAGE_TOOLS_LIST_TIMEOUT");
    surface = assertSeedreamImageToolSurface(listed.tools, enabled, diagnosticEnums);
  } catch (error) {
    failure = error instanceof SeedreamImageNativeToolsError ? error :
      new SeedreamImageNativeToolsError(seedreamImageUnexpectedErrorCode(enabled ? "stdio-opt-in" : "stdio-default", error));
  } finally {
    try { await withDeadline(connected ? client.close() : transport.close(), 2_000, "INSTALLED_SEEDREAM_IMAGE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new SeedreamImageNativeToolsError("INSTALLED_SEEDREAM_IMAGE_STDIO_CLOSE_FAILED"); }
    try { await withDeadline(closed, 2_000, "INSTALLED_SEEDREAM_IMAGE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new SeedreamImageNativeToolsError("INSTALLED_SEEDREAM_IMAGE_STDIO_CLOSE_FAILED"); }
    if (!closeObserved || transport.pid !== null) failure ??= new SeedreamImageNativeToolsError("INSTALLED_SEEDREAM_IMAGE_STDIO_CLOSE_FAILED");
  }
  if (failure) throw failure;
  if (stderrBytes !== 0) fail("INSTALLED_SEEDREAM_IMAGE_STDIO_STDERR_NOT_EMPTY");
  return Object.freeze({ ...surface, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes, sdk_version: manifest.version });
}

function assertSeedreamImagePublicExports(api, modules) {
  const pairs = [
    ["OWNER_SEEDREAM_IMAGE_VARIANTS", "parameters"], ["getOwnerSeedreamImageSourceParameters", "parameters"],
    ["normalizeOwnerSeedreamImageParameters", "parameters"], ["OwnerSeedreamImageParametersError", "parameters"],
    ["getOwnerSeedreamImageSourceProfile", "profile"], ["OwnerSeedreamImageSourceProfileError", "profile"],
    ["createOwnerSeedreamImageOwnedReferenceBindingIssuer", "preparer"], ["prepareOwnerSeedreamImageRequest", "preparer"],
    ["OwnerSeedreamImagePrepareError", "preparer"],
    ["isOwnerSeedreamImagePreparedCandidateForPrincipal", "preparer"],
    ["correlateOwnerSeedreamImageHistoryBinding", "history"], ["createOwnerSeedreamImageOneShotPermit", "permit"],
    ["OwnerSeedreamImageOneShotPolicyError", "permit"],
    ["consumeOwnerSeedreamImageOneShotPermit", "permit"], ["OwnerSeedreamImageUploadService", "upload"],
    ["OwnerSeedreamImageUploadServiceError", "upload"],
    ["OWNER_SEEDREAM_IMAGE_GENERATION_PHASES", "generation"], ["OWNER_SEEDREAM_IMAGE_GENERATION_ERROR_CODES", "generation"],
    ["OWNER_SEEDREAM_IMAGE_GENERATION_HISTORY_REASONS", "generation"], ["OWNER_SEEDREAM_IMAGE_GENERATION_RESULT_REASONS", "generation"],
    ["OwnerSeedreamImageGenerationService", "generation"], ["registerSyntxOwnerSeedreamImageTools", "tools"],
    ["createMcpServer", "server"], ["createObservedOwnerRuntime", "runtime"], ["SyntxChatHttpClient", "client"]
  ];
  if (pairs.some(([name, moduleName]) => typeof api[name] === "undefined" || api[name] !== modules[moduleName][name])) {
    fail("INSTALLED_SEEDREAM_IMAGE_PUBLIC_EXPORT_MISMATCH");
  }
  for (const [name, moduleName] of [["SYNTX_UPLOAD_SEEDREAM_IMAGE_REFERENCE_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_GENERATE_SEEDREAM_IMAGE_TOOL_NAME", "tools"], ["SYNTX_OWNER_RECONCILE_SEEDREAM_IMAGE_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_LIST_SEEDREAM_IMAGE_RECOVERIES_TOOL_NAME", "tools"]]) {
    if (api[name] !== modules[moduleName][name]) fail("INSTALLED_SEEDREAM_IMAGE_PUBLIC_EXPORT_MISMATCH");
  }
  if (["observeOwnerSeedreamImageCandidateClock", "getOwnerSeedreamImagePreparedCandidateState", "createOwnerSeedreamSourceAlphaWitness",
    "snapshotOwnerSeedreamSourceAlphaWitness", "inspectOwnerPngSourceCanvasAlpha"]
    .some((name) => Object.hasOwn(api, name))) fail("INSTALLED_SEEDREAM_IMAGE_PRIVATE_EXPORT_LEAK");
}
function assertSeedreamParameterUnion(schema, code) {
  const branches = schema?.anyOf ?? schema?.oneOf;
  if (!Array.isArray(branches) || branches.length !== VARIANTS.length) fail(code);
  for (const branch of branches) {
    const fields = properties(branch, code);
    const variant = VARIANTS.find((item) => sameArray(fields.resolution?.enum, RESOLUTIONS[item]));
    if (!variant || !sameArray(fields.aspect_ratio?.enum, RATIOS)) fail(code);
    const flash = variant === "seedream-5.0-flash";
    if (flash ? (!sameArray(fields.output_format?.enum, ["jpeg", "png"]) || !sameArray(fields.background?.enum, ["opaque", "transparent"]))
      : (!isNullableNull(fields.output_format) || !isNullableNull(fields.background))) fail(code);
  }
}
function assertSeedreamCostUnion(schema, code) {
  const branches = schema?.anyOf ?? schema?.oneOf;
  if (!Array.isArray(branches) || branches.length !== 2) fail(code);
  const empty = branches.find((branch) => branch.type === "object" && Object.keys(branch.properties ?? {}).length === 0);
  const pro = branches.find((branch) => Object.hasOwn(branch.properties ?? {}, "batch_size"));
  if (!empty || !pro || pro.properties.batch_size?.minimum !== 0 || pro.properties.batch_size?.maximum !== 14 ||
      !sameArray(pro.properties.resolution?.enum, ALL_RESOLUTIONS)) fail(code);
}
function isNullableNull(schema) {
  return schema?.type === "null" || schema?.const === null || (schema?.anyOf ?? []).some((branch) => branch?.type === "null" || branch?.const === null);
}
function nullableEnum(schema) { return schema?.anyOf?.find((branch) => Array.isArray(branch?.enum))?.enum ?? schema?.enum; }
function assertAllObjectsStrict(schema, code, seen = new Set()) {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return;
  seen.add(schema);
  if (schema.type === "object" && schema.additionalProperties !== false) fail(code);
  for (const value of Object.values(schema)) {
    if (Array.isArray(value)) for (const item of value) assertAllObjectsStrict(item, code, seen);
    else assertAllObjectsStrict(value, code, seen);
  }
}
function assertStrictObject(schema, required, optional, code) {
  if (!isRecord(schema) || schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(schema.properties ?? {}).sort(), [...required, ...optional].sort()) ||
      !sameArray([...(schema.required ?? [])].sort(), [...required].sort())) fail(code);
}
function assertToolAnnotations(tool, readOnly, openWorld, code) {
  if (tool.annotations?.readOnlyHint !== readOnly || tool.annotations?.destructiveHint !== !readOnly ||
      tool.annotations?.idempotentHint !== readOnly || tool.annotations?.openWorldHint !== openWorld) fail(code);
}
function hasNumericMaximum(schema, maximum) {
  return schema?.maximum === maximum || (schema?.anyOf ?? []).some((branch) => branch?.maximum === maximum);
}
function properties(schema, code) { if (!isRecord(schema?.properties)) fail(code); return schema.properties; }
function withDeadline(promise, milliseconds, code) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new SeedreamImageNativeToolsError(code)), milliseconds); timer.unref?.(); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function sameArray(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}
function isPathWithin(root, candidate) {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}
function allowlistedErrorClass(error) {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof AggregateError) return "AggregateError";
  if (error instanceof Error) return "Error";
  return "NonError";
}
function fail(code) { throw new SeedreamImageNativeToolsError(code); }
