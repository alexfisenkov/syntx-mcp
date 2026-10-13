import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class IdeogramImageReferenceInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "IdeogramImageReferenceInstalledCheckError"; this.code = code; }
}

const PACKAGE_MODULES = Object.freeze([
  "application/owner-ideogram-image-parameters", "application/owner-ideogram-image-source-profile",
  "application/owner-ideogram-image-input", "application/owner-ideogram-image-upload-service",
  "application/owner-ideogram-image-mask-upload-service",
  "application/owner-ideogram-image-request-preparer", "application/owner-ideogram-image-history-binding",
  "application/owner-ideogram-image-one-shot-policy", "application/owner-ideogram-image-generation-service",
  "application/owner-ideogram-painted-mask-codec", "mcp/owner-ideogram-image-tools", "mcp/server",
  "runtime/observed-owner-runtime", "transports/stdio-owner", "adapter/syntx/chat-http-client",
  "adapter/syntx/ideogram-image-result", "adapter/syntx/upload-reference-bridge", "catalog/selected-discovery-catalog"
]);
const PACKAGE_PATHS = Object.freeze(["dist/src/index.js", "dist/src/index.d.ts",
  ...PACKAGE_MODULES.flatMap((path) => [`dist/src/${path}.js`, `dist/src/${path}.d.ts`])]);
const TOOL_NAMES = Object.freeze([
  "syntx_upload_ideogram_image_reference", "syntx_upload_ideogram_mask", "syntx_owner_generate_ideogram_image",
  "syntx_owner_reconcile_ideogram_image", "syntx_owner_list_ideogram_image_recoveries"
]);
const CONTEXTS = Object.freeze([
  Object.freeze({ model_id: "ideogram", mode: "generate" }),
  Object.freeze({ model_id: "ideogram", mode: "remix" }),
  Object.freeze({ model_id: "ideogram", mode: "reframe" }),
  Object.freeze({ model_id: "ideogram", mode: "replace_background" }),
  Object.freeze({ model_id: "ideogram", mode: "character_reference" }),
  Object.freeze({ model_id: "ideogram_40", mode: "generate" }),
  Object.freeze({ model_id: "ideogram_40", mode: "transparent" }),
  Object.freeze({ model_id: "ideogram_45", mode: "generate" }),
  Object.freeze({ model_id: "ideogram_45", mode: "precise_edit" })
]);
const UPLOAD_CONTEXTS = Object.freeze(CONTEXTS.filter((context) => !(context.model_id === "ideogram_40" && context.mode === "transparent")));
const SAFE_EXPORTS = Object.freeze([
  ["OWNER_IDEOGRAM_IMAGE_CONTEXTS", "parameters"], ["getOwnerIdeogramImageParameterProfile", "parameters"],
  ["normalizeOwnerIdeogramImageParameters", "parameters"], ["OwnerIdeogramImageParametersError", "parameters"],
  ["getOwnerIdeogramImageSourceProfile", "profile"], ["OwnerIdeogramImageSourceProfileError", "profile"],
  ["OwnerIdeogramImageUploadService", "upload"], ["OwnerIdeogramImageUploadServiceError", "upload"],
  ["OWNER_IDEOGRAM_IMAGE_GENERATION_PHASES", "generation"], ["OWNER_IDEOGRAM_IMAGE_GENERATION_ERROR_CODES", "generation"],
  ["OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS", "generation"], ["OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS", "generation"],
  ["OwnerIdeogramImageGenerationService", "generation"], ["OwnerIdeogramImageGenerationServiceError", "generation"],
  ["OWNER_IDEOGRAM_IMAGE_TOOL_NAMES", "tools"], ["SYNTX_UPLOAD_IDEOGRAM_IMAGE_REFERENCE_TOOL_NAME", "tools"],
  ["SYNTX_OWNER_GENERATE_IDEOGRAM_IMAGE_TOOL_NAME", "tools"], ["SYNTX_OWNER_RECONCILE_IDEOGRAM_IMAGE_TOOL_NAME", "tools"],
  ["SYNTX_OWNER_LIST_IDEOGRAM_IMAGE_RECOVERIES_TOOL_NAME", "tools"], ["registerSyntxOwnerIdeogramImageTools", "tools"]
]);
export const IDEOGRAM_IMAGE_SAFE_EXPORT_NAMES = Object.freeze(SAFE_EXPORTS.map(([name]) => name));
export const IDEOGRAM_IMAGE_SAFE_DECLARATION_NAMES = Object.freeze([
  "OwnerIdeogramImageModelId", "OwnerIdeogramImageMode", "OwnerIdeogramImageContext", "OwnerIdeogramImageParameterInput",
  "OwnerIdeogramImageNormalizedParameters", "OwnerIdeogramImageSourceProfile", "OwnerIdeogramImageCatalogPort",
  "OwnerIdeogramImageUploadServiceOptions", "OwnerIdeogramImageUploadInput", "OwnerIdeogramImageUploadReceipt",
  "OwnerIdeogramImageUploadServiceErrorCode", "OwnerIdeogramImageGenerationPreflightInput", "OwnerIdeogramImageGenerationPreflightResult",
  "OwnerIdeogramImageGenerationPreflight", "OwnerIdeogramImageGenerationServiceOptions", "OwnerIdeogramImageGenerateInput",
  "OwnerIdeogramImageReconcileInput", "OwnerIdeogramImageRecoveryListInput", "OwnerIdeogramImageGenerationPhase",
  "OwnerIdeogramImageGenerationResultReason", "OwnerIdeogramImageGenerationDiagnostic", "OwnerIdeogramImageArtifact",
  "OwnerIdeogramImageGenerationResult", "OwnerIdeogramImageRecoveryListItem", "OwnerIdeogramImageGenerationServiceErrorCode",
  "RegisterSyntxOwnerIdeogramImageToolsOptions", "OwnerIdeogramImageServiceComposition"
]);
const PRIVATE_EXPORTS = Object.freeze([
  "createOwnerIdeogramImageAssetBindingIssuer", "prepareOwnerIdeogramImageRequest", "getOwnerIdeogramImagePreparedCandidateState",
  "observeOwnerIdeogramImageCandidateClock", "createOwnerIdeogramImageOneShotPermit", "consumeOwnerIdeogramImageOneShotPermit",
  "OwnerIdeogramImagePreparedCandidate", "OwnerIdeogramImagePreparedCandidateState", "OwnerIdeogramImageAssetSet",
  "OwnerIdeogramPaintedMaskVariants", "OwnerIdeogramPaintedMaskCodecError", "encodeOwnerIdeogramPaintedMaskVariants"
]);
const CHECK_PHASES = Object.freeze([
  "package-paths", "node-runtime", "module-import", "public-exports", "source-contract", "declarations", "flag-reader",
  "stdio-default", "stdio-opt-in"
]);
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const FORM_SHA256 = "sha256:fb8f93597c1dc69fa811e48f5d3218ef5724d9f2f1dd175a3a63f320f930274a";
const MODES_SHA256 = "sha256:d4ad75ddd2336d24cba03e1b32dc162d18ff8d7ff4b15b91ab4fd83175dcc5ac";
const RANDOM_SEED_SHA256 = "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b";
const MASK_FIELD_SHA256 = "sha256:939eb943acae4f98ac4204c24c8fbd07b9fcb472fd9f33e2087703175a80e665";
const IDEOGRAM_RESOLUTIONS = Object.freeze([
  "512x1536", "576x1408", "576x1472", "576x1536", "640x1344", "640x1408", "640x1472", "640x1536",
  "704x1152", "704x1216", "704x1280", "704x1344", "704x1408", "704x1472", "736x1312", "768x1088",
  "768x1216", "768x1280", "768x1344", "800x1280", "832x960", "832x1024", "832x1088", "832x1152",
  "832x1216", "832x1248", "864x1152", "896x960", "896x1024", "896x1088", "896x1120", "896x1152",
  "960x832", "960x896", "960x1024", "960x1088", "1024x832", "1024x896", "1024x960", "1024x1024",
  "1088x768", "1088x832", "1088x896", "1088x960", "1120x896", "1152x704", "1152x832", "1152x864",
  "1152x896", "1216x704", "1216x768", "1216x832", "1248x832", "1280x704", "1280x768", "1280x800",
  "1312x736", "1344x640", "1344x704", "1344x768", "1408x576", "1408x640", "1408x704", "1472x576",
  "1472x640", "1472x704", "1536x512", "1536x576", "1536x640"
]);
const IDEOGRAM_BASE_RATIOS = Object.freeze(["1:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "10:16", "16:10", "CUSTOM"]);
const IDEOGRAM_EXPANDED_RATIOS = Object.freeze(["1:1", "1:3", "1:2", "3:1", "2:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "10:16", "16:10"]);

export function assertIdeogramImagePackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_IDEOGRAM_IMAGE_PACKAGE_PATHS_INVALID");
  if (PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) fail("INSTALLED_IDEOGRAM_IMAGE_PACKAGE_CONTENT_MISSING");
  return true;
}

export function mapIdeogramImageModules(modulePaths, loadedModules) {
  if (!Array.isArray(modulePaths) || !Array.isArray(loadedModules) || modulePaths.length !== loadedModules.length ||
      modulePaths.some((path) => typeof path !== "string") || new Set(modulePaths).size !== modulePaths.length ||
      loadedModules.some((module) => !isRecord(module))) fail("INSTALLED_IDEOGRAM_IMAGE_MODULE_MAP_INVALID");
  return new Map(modulePaths.map((path, index) => [path, loadedModules[index]]));
}

export function assertIdeogramImageToolNames(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_IDEOGRAM_IMAGE_TOOLS_LIST_INVALID");
  const groupNames = tools.filter((tool) => typeof tool?.name === "string" && tool.name.startsWith("syntx_") && tool.name.includes("ideogram"))
    .map((tool) => tool.name);
  if (!enabled) {
    if (groupNames.length !== 0) fail("INSTALLED_IDEOGRAM_IMAGE_DEFAULT_OFF_FAILED");
    return Object.freeze({ ideogram_image_tool_count: 0 });
  }
  if (groupNames.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => groupNames.filter((item) => item === name).length !== 1) ||
      groupNames.some((name) => !TOOL_NAMES.includes(name))) fail("INSTALLED_IDEOGRAM_IMAGE_TOOL_SET_MISMATCH");
  return Object.freeze({ ideogram_image_tool_count: TOOL_NAMES.length });
}

export function assertIdeogramImageToolSurface(tools, enabled, diagnosticEnums, parameterProfile) {
  const counts = assertIdeogramImageToolNames(tools, enabled);
  if (!enabled) return counts;
  const code = "INSTALLED_IDEOGRAM_IMAGE_SCHEMA_INVALID";
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const [upload, maskUpload, generate, reconcile, list] = TOOL_NAMES.map((name) => byName.get(name));
  for (const tool of [upload, maskUpload, generate, reconcile, list]) {
    assertAllObjectsStrict(tool?.inputSchema, code);
    assertAllObjectsStrict(tool?.outputSchema, code);
  }
  assertStrictObject(upload.inputSchema, ["link_attempt_id", "context", "content_base64", "filename", "mime_type"], [], code);
  assertStrictObject(maskUpload.inputSchema, ["link_attempt_id", "base_reference_handle", "painted_rgba_png_base64"], [], code);
  assertStrictObject(generate.inputSchema, ["link_attempt_id", "context", "prompt", "reference_handles", "parameters"], ["mask_handle"], code);
  assertStrictObject(reconcile.inputSchema, ["link_attempt_id", "recovery_id"], [], code);
  assertStrictObject(list.inputSchema, ["link_attempt_id"], ["limit"], code);
  assertStrictObject(upload.outputSchema, ["status", "reference_handle", "model_id", "mode", "original_mime_type", "mime_type",
    "width", "height", "size", "sha256", "expires_in_seconds", "metadata_confidence", "validation_scope"], [], code);
  assertStrictObject(maskUpload.outputSchema, ["status", "mask_handle", "width", "height", "pair_sha256", "expires_in_seconds", "confidence_scope"], [], code);
  assertStrictObject(generate.outputSchema, ["status", "namespace_confidence", "backend_acceptance", "mode_confidence", "ai_name", "model_id",
    "mode", "operation_id", "profile_id", "profile_schema_hash", "catalog_version", "reference_count", "mask_present", "mask_acceptance", "output_count",
    "cost_input_confidence", "artifacts"], [], code);
  assertStrictObject(reconcile.outputSchema, ["status", "namespace_confidence", "backend_acceptance", "mode_confidence", "ai_name", "model_id",
    "mode", "operation_id", "profile_id", "profile_schema_hash", "catalog_version", "reference_count", "mask_present", "mask_acceptance", "output_count",
    "cost_input_confidence", "artifacts"], [], code);
  assertStrictObject(list.outputSchema, ["recoveries", "confidence_scope"], [], code);

  const uploadInput = props(upload.inputSchema, code), maskUploadInput = props(maskUpload.inputSchema, code), generateInput = props(generate.inputSchema, code);
  const maskUploadOutput = props(maskUpload.outputSchema, code);
  const uploadOutput = props(upload.outputSchema, code), generateOutput = props(generate.outputSchema, code);
  const reconcileInput = props(reconcile.inputSchema, code), listInput = props(list.inputSchema, code);
  const listOutput = props(list.outputSchema, code);
  const generationPairs = contextPairs(generateInput.context, code);
  const uploadPairs = contextPairs(uploadInput.context, code);
  if (!samePairSet(generationPairs, CONTEXTS) || !samePairSet(uploadPairs, UPLOAD_CONTEXTS)) fail("INSTALLED_IDEOGRAM_IMAGE_CONTEXT_SCHEMA_INVALID");

  if (generateInput.link_attempt_id?.pattern !== "^link_[A-Za-z0-9_-]{20,120}$" ||
      uploadInput.link_attempt_id?.pattern !== "^link_[A-Za-z0-9_-]{20,120}$" ||
      maskUploadInput.link_attempt_id?.pattern !== "^link_[A-Za-z0-9_-]{20,120}$" ||
      maskUploadInput.base_reference_handle?.pattern !== "^ideogram_image_[0-9a-f-]{36}$" ||
      maskUploadInput.painted_rgba_png_base64?.minLength !== 4 || maskUploadInput.painted_rgba_png_base64?.pattern !== "^[A-Za-z0-9+/]*={0,2}$" ||
      reconcileInput.link_attempt_id?.pattern !== "^link_[A-Za-z0-9_-]{20,120}$" ||
      listInput.link_attempt_id?.pattern !== "^link_[A-Za-z0-9_-]{20,120}$" ||
      uploadInput.content_base64?.minLength !== 4 || uploadInput.content_base64?.pattern !== "^[A-Za-z0-9+/]*={0,2}$" ||
      uploadInput.filename?.maxLength !== 255 || listInput.limit?.minimum !== 1 || listInput.limit?.maximum !== 20) {
    fail("INSTALLED_IDEOGRAM_IMAGE_INPUT_SCHEMA_INVALID");
  }
  const handles = generateInput.reference_handles;
  if (handles?.type !== "array" || handles.maxItems !== 5 || handles.items?.pattern !== "^ideogram_image_[0-9a-f-]{36}$" ||
      !isNullableString(generateInput.prompt) || generateInput.mask_handle?.pattern !== "^ideogram_mask_[0-9a-f-]{36}$" ||
      !parameterProfile) fail("INSTALLED_IDEOGRAM_IMAGE_INPUT_SCHEMA_INVALID");
  const parameterSummary = assertIdeogramParameterSchema(generateInput.parameters, parameterProfile, code);
  if (uploadOutput.status?.const !== "uploaded" || uploadOutput.reference_handle?.pattern !== "^ideogram_image_[0-9a-f-]{36}$" ||
      uploadOutput.metadata_confidence?.const !== "CONTAINER_METADATA_ONLY" ||
      uploadOutput.validation_scope?.const !== "LOCAL_INPUT_VALIDATION_ONLY_NOT_PROVIDER_ACCEPTANCE" ||
      uploadOutput.sha256?.pattern !== "^sha256:[a-f0-9]{64}$" || uploadOutput.expires_in_seconds?.minimum !== 1 || uploadOutput.expires_in_seconds?.maximum !== 900) {
    fail("INSTALLED_IDEOGRAM_IMAGE_UPLOAD_OUTPUT_SCHEMA_INVALID");
  }
  if (maskUploadOutput.status?.const !== "uploaded" || maskUploadOutput.mask_handle?.pattern !== "^ideogram_mask_[0-9a-f-]{36}$" ||
      maskUploadOutput.pair_sha256?.pattern !== "^sha256:[a-f0-9]{64}$" || maskUploadOutput.width?.maximum !== 16_384 ||
      maskUploadOutput.height?.maximum !== 16_384 || maskUploadOutput.expires_in_seconds?.minimum !== 1 ||
      maskUploadOutput.expires_in_seconds?.maximum !== 900 ||
      maskUploadOutput.confidence_scope?.const !== "LOCAL_MASK_BYTES_ONLY_NOT_PROVIDER_ACCEPTANCE") {
    fail("INSTALLED_IDEOGRAM_MASK_UPLOAD_OUTPUT_SCHEMA_INVALID");
  }

  const artifact = generateOutput.artifacts;
  const artifactProperties = props(artifact?.items, code);
  assertStrictObject(artifact.items, ["url", "mime_type", "mime_source", "width", "height", "geometry_verified"], [], code);
  if (generateOutput.status?.const !== "result_observed" || generateOutput.namespace_confidence?.const !== "SOURCE_SHAPED_UNVERIFIED" ||
      generateOutput.backend_acceptance?.const !== "UNPROVEN" || generateOutput.mode_confidence?.const !== "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO" ||
      generateOutput.ai_name?.const !== "ideogram" || generateOutput.operation_id?.const !== "generate-image" ||
      generateOutput.reference_count?.maximum !== 5 || generateOutput.output_count?.minimum !== 1 || generateOutput.output_count?.maximum !== 8 ||
      generateOutput.mask_present?.type !== "boolean" || !sameArray(generateOutput.mask_acceptance?.enum, ["UNPROVEN", "NOT_REQUESTED"]) ||
      artifact?.type !== "array" || artifact.maxItems !== 8 || artifact.minItems !== 1 || artifactProperties.geometry_verified?.const !== false ||
      artifactProperties.width?.type !== "null" || artifactProperties.height?.type !== "null") fail("INSTALLED_IDEOGRAM_IMAGE_OUTPUT_SCHEMA_INVALID");

  assertStrictObject(listOutput.recoveries?.items, ["recovery_id", "created_at", "model_id", "mode", "status", "mask_present", "mask_acceptance", "diagnostic"], [], code);
  const recovery = props(listOutput.recoveries.items, code);
  if (listOutput.confidence_scope?.const !== "process_local_get_only_recovery" || listOutput.recoveries?.type !== "array" ||
      listOutput.recoveries.maxItems !== 20 || recovery.recovery_id?.pattern !== "^ideogram_image_recovery_[0-9a-f-]{36}$" ||
      recovery.status?.const !== "OUTCOME_UNKNOWN" || recovery.mask_present?.type !== "boolean" ||
      !sameArray(recovery.mask_acceptance?.enum, ["UNPROVEN", "NOT_REQUESTED"])) fail("INSTALLED_IDEOGRAM_IMAGE_RECOVERY_SCHEMA_INVALID");
  const diagnostic = props(recovery.diagnostic, code);
  if (!sameArray(enumValues(diagnostic.phase), diagnosticEnums?.phases) ||
      !sameArray(enumValuesNullable(diagnostic.history_binding_reason).filter((value) => value !== null), diagnosticEnums?.historyReasons) ||
      !sameArray(enumValuesNullable(diagnostic.result_reason).filter((value) => value !== null), diagnosticEnums?.resultReasons) ||
      ![diagnosticEnums?.phases, diagnosticEnums?.errorCodes, diagnosticEnums?.historyReasons, diagnosticEnums?.resultReasons].every(Object.isFrozen)) {
    fail("INSTALLED_IDEOGRAM_IMAGE_RECOVERY_SCHEMA_INVALID");
  }
  for (const [tool, expected] of [
    [upload, [false, true, false, true]], [maskUpload, [false, true, false, true]], [generate, [false, true, false, true]],
    [reconcile, [true, false, true, true]], [list, [true, false, true, false]]
  ]) {
    const annotation = tool.annotations ?? {};
    if ([annotation.readOnlyHint, annotation.destructiveHint, annotation.idempotentHint, annotation.openWorldHint]
      .some((value, index) => value !== expected[index])) fail("INSTALLED_IDEOGRAM_IMAGE_ANNOTATIONS_INVALID");
  }
  if (!/(?:do not retry|must not be replayed)/iu.test(String(generate.description ?? "")) || !String(reconcile.description ?? "").includes("GET-only") ||
      !String(list.description ?? "").includes("no prompt")) fail("INSTALLED_IDEOGRAM_IMAGE_BOUNDARY_DESCRIPTION_INVALID");
  return Object.freeze({ ideogram_image_tool_count: 5, mask_upload_tool_count: 1,
    generation_context_pairs: generationPairs.length, upload_context_pairs: uploadPairs.length,
    parameter_shapes: parameterSummary.shapes, ratio_values: parameterSummary.ratios, resolution_values: parameterSummary.resolutions,
    batch_sizes: parameterSummary.batch_sizes, closed_object_schemas: true });
}

export function assertIdeogramImageSourceContract(parametersModule, profileModule, selectedCatalog, selectedVersion) {
  const source = parametersModule?.getOwnerIdeogramImageParameterProfile?.();
  if (!source || selectedVersion !== source.source_pins.public_catalog_version || source.source_pins.form_build_id !== "1791467421" ||
      source.source_pins.form_module_sha256 !== FORM_SHA256 || source.source_pins.helper_module_sha256 !== MODES_SHA256 ||
      source.source_pins.source_execution !== false || source.dispatch_allowed !== false || source.runtime_activation !== false ||
      source.backend_acceptance !== "UNPROVEN" || source.effective_defaults !== "UNKNOWN_NOT_FILLED_FROM_UI_INITIALIZER_CANDIDATES" ||
      source.num_images?.minimum !== 1 || source.num_images?.maximum !== 8 || source.num_images?.integer_only !== true ||
      source.seed?.minimum !== 0 || source.seed?.maximum !== 2_147_483_647 || source.seed?.nullable !== true ||
      source.seed?.integer_only !== true || !samePairSet(source.contexts, CONTEXTS)) fail("INSTALLED_IDEOGRAM_IMAGE_SOURCE_PROFILE_INVALID");
  const baseResolutions = source.resolutions?.ideogram_generate_remix_character_reference_reframe;
  const baseRatios = source.ratios?.ideogram;
  if (!Array.isArray(baseResolutions) || baseResolutions.length !== 69 || new Set(baseResolutions).size !== 69 ||
      !sameArray(baseResolutions, IDEOGRAM_RESOLUTIONS) || !sameArray(baseRatios, IDEOGRAM_BASE_RATIOS) ||
      !sameArray(source.ratios?.ideogram_40_generate, [null, ...IDEOGRAM_EXPANDED_RATIOS]) ||
      !sameArray(source.ratios?.ideogram_40_transparent, IDEOGRAM_EXPANDED_RATIOS) ||
      !sameArray(source.ratios?.ideogram_45_generate, IDEOGRAM_EXPANDED_RATIOS)) fail("INSTALLED_IDEOGRAM_IMAGE_SOURCE_PROFILE_INVALID");

  let contextsChecked = 0;
  for (const context of CONTEXTS) {
    const profile = profileModule?.getOwnerIdeogramImageSourceProfile?.(context.model_id, context.mode, selectedCatalog, selectedVersion);
    const form = profile?.source_binding?.source_artifacts?.form;
    const modeRegistry = profile?.source_binding?.source_artifacts?.mode_registry;
    if (!profile || profile.profile_id !== "ideogram-image-source-profile-v1" || profile.model_id !== context.model_id || profile.mode !== context.mode ||
        profile.public_catalog_version !== selectedVersion || profile.profile_schema_hash?.length !== 71 ||
        profile.dispatch_allowed !== false || profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN" ||
        profile.effective_defaults !== "UNKNOWN_NOT_FILLED_FROM_UI_INITIALIZER_CANDIDATES" ||
        profile.source_binding?.source_execution !== false ||
        profile.source_binding?.selected_public_catalog_version !== selectedVersion ||
        profile.source_binding?.settings_inventory?.runtime_usable !== false ||
        form?.build_id !== "1791467421" || form?.module !== "ideogram.js" || form?.sha256 !== FORM_SHA256 ||
        modeRegistry?.module !== "modes.registry.js" || modeRegistry?.sha256 !== MODES_SHA256 ||
        profile.source_binding?.source_artifacts?.random_seed?.sha256 !== RANDOM_SEED_SHA256 ||
        profile.source_binding?.source_artifacts?.mask_field?.sha256 !== MASK_FIELD_SHA256 ||
        profile.input_policy?.local_size_scope !== "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" ||
        profile.input_policy?.provider_acceptance !== "UNPROVEN") fail("INSTALLED_IDEOGRAM_IMAGE_SOURCE_PROFILE_INVALID");
    contextsChecked += 1;
  }

  let combinations = 0;
  for (const resolution of baseResolutions) {
    for (const ratio of baseRatios) {
      for (let batch = 1; batch <= 8; batch += 1) {
        const normalized = parametersModule.normalizeOwnerIdeogramImageParameters({ model_id: "ideogram", mode: "generate",
          reference_count: 0, mask_present: false, prompt: "installed source contract check",
          parameters: { rendering_speed: "TURBO", num_images: batch, aspect_ratio: ratio, resolution } });
        if (normalized.model_id !== "ideogram" || normalized.mode !== "generate" || normalized.parameters.num_images !== batch ||
            normalized.dispatch_allowed !== false || normalized.runtime_activation !== false || normalized.backend_acceptance !== "UNPROVEN" ||
            Object.hasOwn(normalized.source_json_mapping, "n") ||
            (ratio === "CUSTOM" ? Object.hasOwn(normalized.source_json_mapping, "aspect_ratio") : normalized.source_json_mapping.aspect_ratio !== ratio)) {
          fail("INSTALLED_IDEOGRAM_IMAGE_PARAMETER_MATRIX_INVALID");
        }
        combinations += 1;
      }
    }
  }

  const batchCases = CONTEXTS.map((context) => {
    const mode = context.mode;
    const model = context.model_id;
    const values = validParameters(source, model, mode);
    const referenceCount = mode === "generate" && (model === "ideogram" || model === "ideogram_45") ? 0
      : model === "ideogram_45" && mode === "precise_edit" ? 1
        : model === "ideogram_40" && mode === "transparent" ? 0
          : mode === "generate" && model === "ideogram_40" ? 0 : 1;
    for (let batch = 1; batch <= 8; batch += 1) {
      const normalized = parametersModule.normalizeOwnerIdeogramImageParameters({ model_id: model, mode, reference_count: referenceCount,
        mask_present: false, prompt: mode === "reframe" ? null : "installed source context check",
        parameters: { ...values, num_images: batch } });
      if (normalized.parameters.num_images !== batch || Object.hasOwn(normalized.source_json_mapping, "n")) fail("INSTALLED_IDEOGRAM_IMAGE_PARAMETER_MATRIX_INVALID");
    }
    return { model, mode };
  });
  const reframe = parametersModule.normalizeOwnerIdeogramImageParameters({ model_id: "ideogram", mode: "reframe",
    reference_count: 1, mask_present: false, prompt: null,
    parameters: { rendering_speed: "TURBO", num_images: 1, resolution: baseResolutions[0] } });
  if (reframe.prompt_policy !== "disabled" || reframe.source_mapping_confidence !== "STATIC_SOURCE_POLICY_NOT_RENDERED_UI_OR_PROVIDER_ACCEPTANCE" ||
      Object.hasOwn(reframe.source_json_mapping, "prompt")) fail("INSTALLED_IDEOGRAM_IMAGE_PARAMETER_MATRIX_INVALID");
  const imageWeight = parametersModule.normalizeOwnerIdeogramImageParameters({ model_id: "ideogram_40", mode: "generate",
    reference_count: 1, mask_present: false, prompt: "v4 image branch", parameters: {
      rendering_speed: "TURBO", num_images: 1, aspect_ratio: null, resolution: "1K", image_weight_auto: false, image_weight: 37.5
    } });
  if (Object.hasOwn(imageWeight.source_json_mapping, "image_weight_auto") || imageWeight.source_json_mapping.image_weight !== 37.5 ||
      Object.hasOwn(imageWeight.source_json_mapping, "magic_prompt")) fail("INSTALLED_IDEOGRAM_IMAGE_PARAMETER_MATRIX_INVALID");
  const flash = parametersModule.normalizeOwnerIdeogramImageParameters({ model_id: "ideogram_45", mode: "generate",
    reference_count: 1, mask_present: false, prompt: "flash image branch", parameters: {
      rendering_speed: "FLASH", num_images: 1, aspect_ratio: "1:1", resolution: "1K"
    } });
  if (flash.parameters.rendering_speed !== "FLASH") fail("INSTALLED_IDEOGRAM_IMAGE_PARAMETER_MATRIX_INVALID");
  return Object.freeze({ ideogram_contexts_checked: contextsChecked, ideogram_parameter_combinations_checked: combinations,
    ideogram_mode_batch_checks: batchCases.length * 8, ideogram_resolutions_checked: baseResolutions.length,
    source_execution_claimed: false });
}

export function assertIdeogramImagePublicExports(api, modules) {
  if (!isRecord(api) || !isRecord(modules) || SAFE_EXPORTS.some(([name]) => !Object.hasOwn(api, name)) ||
      SAFE_EXPORTS.some(([name, moduleKey]) => api[name] !== modules[moduleKey]?.[name]) ||
      PRIVATE_EXPORTS.some((name) => Object.hasOwn(api, name))) fail("INSTALLED_IDEOGRAM_IMAGE_PUBLIC_EXPORTS_INVALID");
  return Object.freeze({ safe_ideogram_image_exports_checked: SAFE_EXPORTS.length, private_candidate_and_codec_exports_absent: true });
}

export function assertIdeogramImageDeclarations(declarationText) {
  if (typeof declarationText !== "string" || IDEOGRAM_IMAGE_SAFE_DECLARATION_NAMES.some((name) => !declarationText.includes(name)) ||
      PRIVATE_EXPORTS.some((name) => declarationText.includes(name))) fail("INSTALLED_IDEOGRAM_IMAGE_DECLARATION_INVALID");
  return Object.freeze({ safe_ideogram_image_declarations_checked: IDEOGRAM_IMAGE_SAFE_DECLARATION_NAMES.length,
    private_candidate_and_codec_declarations_absent: true });
}

export function assertConsumerSdkResolution({ consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath,
  clientModulePath, stdioModulePath, projectRoot }) {
  const paths = [consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath, clientModulePath, stdioModulePath, projectRoot];
  if (!paths.every((path) => typeof path === "string" && isAbsolute(path))) fail("INSTALLED_IDEOGRAM_IMAGE_SDK_NOT_FROM_CONSUMER");
  const expectedSdk = join(resolve(consumerPath), "node_modules", "@modelcontextprotocol", "sdk");
  const sdkRoot = resolve(resolvedSdkPackagePath);
  if (resolve(sdkPackagePath) !== expectedSdk || !isPathWithin(resolvedConsumerPath, sdkRoot) || isPathWithin(projectRoot, sdkRoot) ||
      !isPathWithin(sdkRoot, resolve(clientModulePath)) || !isPathWithin(sdkRoot, resolve(stdioModulePath))) {
    fail("INSTALLED_IDEOGRAM_IMAGE_SDK_NOT_FROM_CONSUMER");
  }
  return true;
}

export function ideogramImageUnexpectedErrorCode(phase, error) {
  if (!CHECK_PHASES.includes(phase)) fail("INSTALLED_IDEOGRAM_IMAGE_DIAGNOSTIC_PHASE_INVALID");
  return `INSTALLED_IDEOGRAM_IMAGE_UNEXPECTED_${phase}_${errorClass(error)}`;
}

/** Import the installed package copy and exercise only read-only SDK list operations. */
export async function assertInstalledIdeogramImageReference(installedPackagePath, consumerPath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertIdeogramImagePackagePaths(packagedPaths);
    phase = "node-runtime";
    if (Number(process.versions.node.split(".")[0]) !== 24) fail("INSTALLED_IDEOGRAM_IMAGE_NODE24_REQUIRED");
    const importPacked = (name) => import(pathToFileURL(join(installedPackagePath, `dist/src/${name}.js`)).href);
    phase = "module-import";
    let loaded;
    try { loaded = await Promise.all([import(pathToFileURL(join(installedPackagePath, "dist/src/index.js")).href), ...PACKAGE_MODULES.map(importPacked)]); }
    catch { fail("INSTALLED_IDEOGRAM_IMAGE_MODULE_IMPORT_FAILED"); }
    const api = loaded[0];
    const modules = mapIdeogramImageModules(PACKAGE_MODULES, loaded.slice(1));
    const moduleFor = (name) => modules.get(name);
    const parameters = moduleFor("application/owner-ideogram-image-parameters");
    const profile = moduleFor("application/owner-ideogram-image-source-profile");
    const generation = moduleFor("application/owner-ideogram-image-generation-service");
    const stdio = moduleFor("transports/stdio-owner");
    const selectedCatalog = moduleFor("catalog/selected-discovery-catalog");
    phase = "public-exports";
    const exportSummary = assertIdeogramImagePublicExports(api, {
      parameters, profile, upload: moduleFor("application/owner-ideogram-image-upload-service"), generation,
      tools: moduleFor("mcp/owner-ideogram-image-tools")
    });
    phase = "source-contract";
    const version = selectedCatalog.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
    const selected = selectedCatalog.loadSelectedDiscoveryCatalog(version, join(installedPackagePath, "catalog"));
    const sourceSummary = assertIdeogramImageSourceContract(parameters, profile, selected.discoveryCatalog, version);
    phase = "declarations";
    const declaration = await readFile(join(installedPackagePath, "dist/src/index.d.ts"), "utf8");
    const declarationSummary = assertIdeogramImageDeclarations(declaration);
    phase = "flag-reader";
    const readFlag = stdio.readOwnerIdeogramImageReferencesFlag;
    if (typeof readFlag !== "function" || readFlag(undefined) !== false || readFlag("") !== false || readFlag("0") !== false || readFlag("1") !== true) {
      fail("INSTALLED_IDEOGRAM_IMAGE_FLAG_INVALID");
    }
    for (const invalid of ["true", "yes", "01", " 1 "]) {
      let rejected = false;
      try { readFlag(invalid); } catch { rejected = true; }
      if (!rejected) fail("INSTALLED_IDEOGRAM_IMAGE_FLAG_INVALID");
    }
    const diagnostics = { phases: generation.OWNER_IDEOGRAM_IMAGE_GENERATION_PHASES,
      errorCodes: generation.OWNER_IDEOGRAM_IMAGE_GENERATION_ERROR_CODES,
      historyReasons: generation.OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS,
      resultReasons: generation.OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS };
    phase = "stdio-default";
    const defaults = await listInstalledIdeogramImageTools(installedPackagePath, consumerPath, false, diagnostics, parameters.getOwnerIdeogramImageParameterProfile());
    phase = "stdio-opt-in";
    const optIn = await listInstalledIdeogramImageTools(installedPackagePath, consumerPath, true, diagnostics, parameters.getOwnerIdeogramImageParameterProfile());
    return Object.freeze({ ...exportSummary, ...declarationSummary, ...sourceSummary,
      default_tools: defaults.ideogram_image_tool_count, opt_in_tools: optIn.ideogram_image_tool_count,
      node_path: process.execPath, sdk_version: optIn.sdk_version,
      default_child_close: defaults.child_close, opt_in_child_close: optIn.child_close,
      default_child_pid_null: defaults.child_pid_null, opt_in_child_pid_null: optIn.child_pid_null,
      default_stderr_bytes: defaults.stderr_bytes, opt_in_stderr_bytes: optIn.stderr_bytes,
      sdk_operations: Object.freeze(["initialize", "tools/list", "close"]), tool_calls: 0, network_calls: 0 });
  } catch (error) {
    if (error instanceof IdeogramImageReferenceInstalledCheckError) throw error;
    fail(ideogramImageUnexpectedErrorCode(phase, error));
  }
}

async function listInstalledIdeogramImageTools(installedPackagePath, consumerPath, enabled, diagnostics, parameterProfile) {
  const require = createRequire(join(consumerPath, "package.json"));
  let clientPath; let stdioPath;
  try { clientPath = require.resolve("@modelcontextprotocol/sdk/client/index.js"); stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js"); }
  catch { fail("INSTALLED_IDEOGRAM_IMAGE_SDK_RESOLUTION_FAILED"); }
  const sdkPath = join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk");
  let resolvedConsumer; let resolvedSdk; let resolvedClient; let resolvedStdio; let resolvedProject;
  try { [resolvedConsumer, resolvedSdk, resolvedClient, resolvedStdio, resolvedProject] = await Promise.all([
    realpath(consumerPath), realpath(sdkPath), realpath(clientPath), realpath(stdioPath), realpath(fileURLToPath(new URL("../", import.meta.url)))
  ]); } catch { fail("INSTALLED_IDEOGRAM_IMAGE_SDK_RESOLUTION_FAILED"); }
  assertConsumerSdkResolution({ consumerPath, resolvedConsumerPath: resolvedConsumer, sdkPackagePath: sdkPath,
    resolvedSdkPackagePath: resolvedSdk, clientModulePath: resolvedClient, stdioModulePath: resolvedStdio, projectRoot: resolvedProject });
  let manifest;
  try { manifest = JSON.parse(await readFile(join(resolvedSdk, "package.json"), "utf8")); }
  catch { fail("INSTALLED_IDEOGRAM_IMAGE_SDK_MANIFEST_INVALID"); }
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest?.version !== "1.32.1") fail("INSTALLED_IDEOGRAM_IMAGE_SDK_VERSION_MISMATCH");
  const [{ Client }, { StdioClientTransport }] = await Promise.all([import(pathToFileURL(clientPath).href), import(pathToFileURL(stdioPath).href)]);
  const client = new Client({ name: enabled ? "ideogram-installed-owner-opt-in" : "ideogram-installed-owner-default", version: "1.0.0" }, { capabilities: {} });
  const env = { SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES: enabled ? "1" : "0" };
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")], cwd: consumerPath, env, stderr: "pipe" });
  let closed = false; let resolveClose;
  const closeEvent = new Promise((resolvePromise) => { resolveClose = resolvePromise; });
  const previousClose = transport.onclose;
  transport.onclose = () => { closed = true; try { previousClose?.(); } finally { resolveClose(); } };
  let stderrBytes = 0;
  transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  let connected = false; let failure; let surface;
  try {
    await withDeadline(client.connect(transport), 7_000, "INSTALLED_IDEOGRAM_IMAGE_STDIO_INITIALIZE_TIMEOUT");
    connected = true;
    if (!Number.isSafeInteger(transport.pid) || transport.pid <= 0) fail("INSTALLED_IDEOGRAM_IMAGE_STDIO_PID_INVALID");
    const listed = await withDeadline(client.listTools({}, { timeout: 7_000, maxTotalTimeout: 7_000 }),
      7_000, "INSTALLED_IDEOGRAM_IMAGE_TOOLS_LIST_TIMEOUT");
    surface = assertIdeogramImageToolSurface(listed.tools, enabled, diagnostics, parameterProfile);
  } catch (error) {
    failure = error instanceof IdeogramImageReferenceInstalledCheckError ? error :
      new IdeogramImageReferenceInstalledCheckError(ideogramImageUnexpectedErrorCode(enabled ? "stdio-opt-in" : "stdio-default", error));
  } finally {
    try { await withDeadline(connected ? client.close() : transport.close(), 2_000, "INSTALLED_IDEOGRAM_IMAGE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new IdeogramImageReferenceInstalledCheckError("INSTALLED_IDEOGRAM_IMAGE_STDIO_CLOSE_FAILED"); }
    try { await withDeadline(closeEvent, 2_000, "INSTALLED_IDEOGRAM_IMAGE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new IdeogramImageReferenceInstalledCheckError("INSTALLED_IDEOGRAM_IMAGE_STDIO_CLOSE_FAILED"); }
    if (!closed || transport.pid !== null) failure ??= new IdeogramImageReferenceInstalledCheckError("INSTALLED_IDEOGRAM_IMAGE_STDIO_CLOSE_FAILED");
  }
  if (failure) throw failure;
  if (stderrBytes !== 0) fail("INSTALLED_IDEOGRAM_IMAGE_STDIO_STDERR_NOT_EMPTY");
  return Object.freeze({ ...surface, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes, sdk_version: manifest.version });
}

function assertIdeogramParameterSchema(schema, profile, code) {
  const branches = unionBranches(schema);
  if (branches.length === 0) fail(code);
  const properties = [];
  for (const branch of branches) {
    assertStrictObjectShape(branch, code);
    const fields = props(branch, code);
    if (!Object.hasOwn(fields, "rendering_speed") || !Object.hasOwn(fields, "num_images")) fail(code);
    const batches = allSchemas(fields.num_images);
    if (!batches.some((item) => item.type === "integer" && item.minimum === profile.num_images.minimum && item.maximum === profile.num_images.maximum)) fail(code);
    properties.push(fields);
  }
  const propertySchemas = (key) => properties.flatMap((fields) => fields[key] === undefined ? [] : [fields[key]]);
  const speeds = propertySchemas("rendering_speed").flatMap(enumValues);
  if (!["TURBO", "DEFAULT", "QUALITY", "FLASH"].every((speed) => speeds.includes(speed))) fail(code);
  const magicPrompts = propertySchemas("magic_prompt").flatMap(enumValues);
  if (![...profile.magic_prompt, null].every((value) => magicPrompts.includes(value))) fail(code);
  const styleTypes = propertySchemas("style_type").flatMap(enumValues);
  if (![...profile.style_type, null].every((value) => styleTypes.includes(value))) fail(code);
  const resolutions = propertySchemas("resolution").flatMap(enumValues);
  if (!IDEOGRAM_RESOLUTIONS.every((resolution) => resolutions.includes(resolution)) || new Set(IDEOGRAM_RESOLUTIONS).size !== 69) fail(code);
  const ratios = propertySchemas("aspect_ratio").flatMap(enumValues);
  const expectedRatios = [...IDEOGRAM_BASE_RATIOS, null, ...IDEOGRAM_EXPANDED_RATIOS];
  if (!expectedRatios.every((ratio) => ratios.includes(ratio))) fail(code);
  const seeds = propertySchemas("seed").flatMap(allSchemas);
  if (!seeds.some((item) => item.type === "integer" && item.minimum === profile.seed.minimum && item.maximum === profile.seed.maximum) ||
      !seeds.some((item) => item.type === "null")) fail(code);
  const imageWeights = propertySchemas("image_weight").flatMap(allSchemas);
  if (!imageWeights.some((item) => item.type === "number" && item.minimum === profile.image_weight.minimum && item.maximum === profile.image_weight.maximum) ||
      !propertySchemas("image_weight_auto").flatMap(allSchemas).some((item) => item.type === "boolean")) fail(code);
  const palettes = propertySchemas("color_palette");
  const paletteBranches = palettes.flatMap(unionBranches);
  const paletteObjects = paletteBranches.filter((branch) => branch?.type === "object");
  if (!paletteObjects.some((branch) => props(branch, code).kind?.const === "preset") ||
      !paletteObjects.some((branch) => props(branch, code).kind?.const === "custom") ||
      !paletteBranches.some((branch) => branch?.type === "null")) fail(code);
  for (const branch of paletteObjects.filter((item) => props(item, code).kind?.const === "custom")) {
    const colors = props(branch, code).colors;
    if (colors?.type !== "array" || colors.minItems !== profile.color_palette.custom_local_limits.members_minimum ||
        colors.maxItems !== profile.color_palette.custom_local_limits.members_maximum) fail(code);
    const color = props(colors.items, code);
    if (color.color_hex?.maxLength !== profile.color_palette.custom_local_limits.hex_characters_maximum ||
        !allSchemas(color.color_weight).some((item) => item.type === "number" && item.minimum === profile.color_palette.custom_local_limits.weight_minimum &&
          item.maximum === profile.color_palette.custom_local_limits.weight_maximum)) fail(code);
  }
  if (!propertySchemas("style_preset").flatMap(allSchemas).some((item) => item.maxLength === profile.custom_source_bounds.style_preset_name_maximum) ||
      !propertySchemas("negative_prompt").flatMap(allSchemas).some((item) => item.maxLength === profile.custom_source_bounds.negative_prompt_maximum)) fail(code);
  return Object.freeze({ shapes: branches.length, ratios: new Set(ratios).size, resolutions: new Set(resolutions).size, batch_sizes: 8 });
}

function validParameters(profile, model, mode) {
  const speed = "TURBO";
  const parameters = { rendering_speed: speed, num_images: 1 };
  if (model === "ideogram" && ["generate", "remix", "character_reference"].includes(mode)) {
    parameters.aspect_ratio = profile.ratios.ideogram[0];
    parameters.resolution = profile.resolutions.ideogram_generate_remix_character_reference_reframe[0];
    if (mode === "remix") parameters.image_weight = 50;
    if (mode === "generate") parameters.seed = null;
  } else if (model === "ideogram" && mode === "reframe") {
    parameters.resolution = profile.resolutions.ideogram_generate_remix_character_reference_reframe[0];
  } else if (model === "ideogram" && mode === "replace_background") {
    parameters.seed = null;
  } else if (model === "ideogram_40" && mode === "generate") {
    parameters.aspect_ratio = profile.ratios.ideogram_40_generate.find((item) => item !== null);
    parameters.resolution = profile.resolutions.ideogram_40_generate[0];
  } else if (model === "ideogram_40" && mode === "transparent") {
    parameters.aspect_ratio = profile.ratios.ideogram_40_transparent[0];
    parameters.resolution = profile.resolutions.ideogram_40_transparent[0];
  } else if (model === "ideogram_45" && mode === "generate") {
    parameters.aspect_ratio = profile.ratios.ideogram_45_generate[0];
    parameters.resolution = profile.resolutions.ideogram_45_generate[0];
  } else if (model === "ideogram_45" && mode === "precise_edit") {
    parameters.seed = null;
  }
  return parameters;
}

function contextPairs(schema, code) {
  const branches = unionBranches(schema);
  if (branches.length === 0) fail(code);
  return branches.map((branch) => {
    assertStrictObject(branch, ["model_id", "mode"], [], code);
    const fields = props(branch, code);
    const model_id = literalValue(fields.model_id);
    const mode = literalValue(fields.mode);
    if (typeof model_id !== "string" || typeof mode !== "string") fail(code);
    return { model_id, mode };
  });
}

function samePairSet(actual, expected) {
  const stringify = (items) => items.map(({ model_id, mode }) => `${model_id}\u0000${mode}`).sort();
  return actual.length === expected.length && sameArray(stringify(actual), stringify(expected));
}

function assertStrictObject(schema, required, optional, code) {
  assertStrictObjectShape(schema, code);
  const properties = props(schema, code);
  const expectedKeys = [...required, ...optional].sort();
  if (!sameArray(Object.keys(properties).sort(), expectedKeys)) fail(code);
  if (!sameArray((Array.isArray(schema.required) ? schema.required.slice() : []).sort(), required.slice().sort())) fail(code);
}

function assertStrictObjectShape(schema, code) {
  if (schema?.type !== "object" || schema.additionalProperties !== false || !isRecord(schema.properties)) fail(code);
}

function assertAllObjectsStrict(schema, code, seen = new Set()) {
  if (!isRecord(schema) || seen.has(schema)) return;
  seen.add(schema);
  if (schema.type === "object" || schema.properties !== undefined) assertStrictObjectShape(schema, code);
  if (isRecord(schema.properties)) for (const nested of Object.values(schema.properties)) assertAllObjectsStrict(nested, code, seen);
  if (schema.items !== undefined) assertAllObjectsStrict(schema.items, code, seen);
  if (isRecord(schema.$defs)) for (const nested of Object.values(schema.$defs)) assertAllObjectsStrict(nested, code, seen);
  for (const key of ["oneOf", "anyOf", "allOf", "prefixItems"]) {
    if (schema[key] === undefined) continue;
    if (!Array.isArray(schema[key])) fail(code);
    for (const branch of schema[key]) assertAllObjectsStrict(branch, code, seen);
  }
}

function unionBranches(schema) {
  if (Array.isArray(schema?.oneOf)) return schema.oneOf;
  if (Array.isArray(schema?.anyOf)) return schema.anyOf;
  return [];
}
function allSchemas(schema) {
  if (!schema || typeof schema !== "object") return [];
  const branches = unionBranches(schema);
  return branches.length === 0 ? [schema] : branches.flatMap(allSchemas);
}
function enumValues(schema) {
  if (!schema || typeof schema !== "object") return [];
  if (schema.type === "null") return [null];
  if (Array.isArray(schema.enum)) return schema.enum;
  if (Object.hasOwn(schema, "const")) return [schema.const];
  return unionBranches(schema).flatMap(enumValues);
}
function enumValuesNullable(schema) { return enumValues(schema); }
function literalValue(schema) { return Object.hasOwn(schema ?? {}, "const") ? schema.const : Array.isArray(schema?.enum) && schema.enum.length === 1 ? schema.enum[0] : undefined; }
function props(schema, code) { if (!isRecord(schema?.properties)) fail(code); return schema.properties; }
function isNullableString(schema) {
  const nodes = allSchemas(schema);
  return nodes.some((item) => item.type === "string" && item.minLength === 1 && item.maxLength === 10_000) && nodes.some((item) => item.type === "null");
}
function assertToolNames(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_IDEOGRAM_IMAGE_TOOLS_LIST_INVALID");
  const group = tools.filter((tool) => typeof tool?.name === "string" && tool.name.startsWith("syntx_") && tool.name.includes("ideogram"))
    .map((tool) => tool.name);
  if (!enabled) {
    if (group.length !== 0) fail("INSTALLED_IDEOGRAM_IMAGE_DEFAULT_OFF_FAILED");
    return Object.freeze({ ideogram_image_tool_count: 0 });
  }
  if (group.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => group.filter((item) => item === name).length !== 1) ||
      group.some((name) => !TOOL_NAMES.includes(name))) fail("INSTALLED_IDEOGRAM_IMAGE_TOOL_SET_MISMATCH");
  return Object.freeze({ ideogram_image_tool_count: TOOL_NAMES.length });
}
function assertToolAnnotations(tool, readOnly, destructive, idempotent, openWorld) {
  const annotation = tool?.annotations ?? {};
  if (annotation.readOnlyHint !== readOnly || annotation.destructiveHint !== destructive || annotation.idempotentHint !== idempotent ||
      annotation.openWorldHint !== openWorld) fail("INSTALLED_IDEOGRAM_IMAGE_ANNOTATIONS_INVALID");
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function sameArray(value, expected) { return Array.isArray(value) && Array.isArray(expected) && value.length === expected.length && value.every((item, index) => item === expected[index]); }
function isPathWithin(root, path) { const rel = relative(resolve(root), resolve(path)); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); }
function errorClass(error) {
  const name = error instanceof Error ? error.constructor?.name : "Error";
  return new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "AggregateError"]).has(name) ? name : "Error";
}
function withDeadline(operation, milliseconds, code) {
  let timer;
  return Promise.race([Promise.resolve(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), milliseconds); })])
    .finally(() => clearTimeout(timer));
}
function fail(code) { throw new IdeogramImageReferenceInstalledCheckError(code); }
