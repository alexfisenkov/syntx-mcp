import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class OwnerFluxImageInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "OwnerFluxImageInstalledCheckError"; this.code = code; }
}

const TOOL_NAMES = Object.freeze([
  "syntx_upload_flux_image_reference", "syntx_register_flux_public_lora", "syntx_owner_generate_flux_image",
  "syntx_owner_reconcile_flux_image", "syntx_owner_list_flux_image_recoveries"
]);
const PHASES = Object.freeze(["package-paths", "node-runtime", "module-import", "public-exports", "source-contract",
  "declarations", "flag-reader", "stdio-default", "stdio-opt-in"]);
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const GENERATION_PHASES = Object.freeze(["REQUEST_PREPARE", "PRINCIPAL", "ASSET_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
  "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"]);
const GENERATION_ERRORS = Object.freeze(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "REFERENCE_ALREADY_CLAIMED", "PREFLIGHT_FAILED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"]);
const HISTORY_REASONS = Object.freeze(["INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
  "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE", "MESSAGE_CHAT_MISMATCH",
  "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH", "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID",
  "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS", "BOT_MESSAGE_BEFORE_ACK", "BOT_OBJECTS_INVALID", "BOT_MODEL_MISMATCH"]);
const RESULT_REASONS = Object.freeze(["NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH",
  "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH",
  "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE"]);
const UPLOAD_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"]);
const CANONICAL_MIMES = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const MODELS = Object.freeze(["flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"]);
const RESOLUTIONS = Object.freeze({
  "flux-1": Object.freeze(["1344x768", "1216x832", "1152x896", "1280x1024", "1024x1024", "1024x1280", "896x1152", "832x1216", "768x1344"]),
  "flux-pro-1.1": Object.freeze(["1152x896", "1280x1024"]),
  "flux-pro-1.1-ultra": Object.freeze(["3136x1344", "2752x1536", "2368x1792", "2048x2048", "1792x2368", "1536x2752", "1344x3136"])
});
const SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
});
const SOURCE_PINS = Object.freeze({
  public_catalog_version: PUBLIC_VERSION, public_catalog_fetched_at: "2026-10-08T13:18:39.393Z",
  public_models_sha256: SOURCE_HASHES.models, form_build_id: "1791467421", form_module: "flux.js",
  form_sha256: "sha256:80307235518f6f0c80952ce4a5a0834ee373d7294f8dc90e58748d57389de664",
  form_freshness: "ROOT590_ANONYMOUS_GET_MATCHED_PIN", settings_helper_module: "settings3.js",
  settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
  lora_component_module: "LinkLora.vue", lora_component_sha256: "sha256:1f28ad5b0f171f68288c827fe0725518aab51e24c590f32a5703303f1c5fc2ba",
  source_execution: false
});
const PROFILE_LORA_COMPONENT_SHA256 = "sha256:1f28ad5b0f171f68288c827fe0725518aab51e24c590f32a5703303f1c5fc2ba";

export function assertOwnerFluxImageToolNames(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_FLUX_IMAGE_TOOLS_LIST_INVALID");
  const names = tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length !== 0) fail("INSTALLED_FLUX_IMAGE_DEFAULT_OFF_FAILED");
    return Object.freeze({ flux_image_tool_count: 0 });
  }
  if (names.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => names.filter((item) => item === name).length !== 1)) {
    fail("INSTALLED_FLUX_IMAGE_TOOL_SET_MISMATCH");
  }
  return Object.freeze({ flux_image_tool_count: TOOL_NAMES.length });
}

/** Check five public JSON-schema surfaces; never call a tool or echo schema contents on failure. */
export function assertOwnerFluxImageToolSurface(tools, enabled, diagnosticEnums) {
  const counts = assertOwnerFluxImageToolNames(tools, enabled);
  if (!enabled) return counts;
  const code = "INSTALLED_FLUX_IMAGE_SCHEMA_INVALID";
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const [upload, register, generate, reconcile, list] = TOOL_NAMES.map((name) => byName.get(name));
  for (const tool of [upload, register, generate, reconcile, list]) {
    assertAllObjectsStrict(tool.inputSchema, code); assertAllObjectsStrict(tool.outputSchema, code);
  }
  const uploadInput = props(upload.inputSchema, code), registerInput = props(register.inputSchema, code);
  const generateInput = props(generate.inputSchema, code), reconcileInput = props(reconcile.inputSchema, code);
  const listInput = props(list.inputSchema, code), uploadOutput = props(upload.outputSchema, code);
  const registerOutput = props(register.outputSchema, code), generateOutput = props(generate.outputSchema, code);
  const recoveriesOutput = props(list.outputSchema, code);
  const attempt = "^link_[A-Za-z0-9_-]{20,120}$", image = "^flux_image_[0-9a-f-]{36}$";
  const lora = "^flux_lora_[0-9a-f-]{36}$", recovery = "^flux_image_recovery_[0-9a-f-]{36}$";
  assertStrictObject(upload.inputSchema, ["link_attempt_id", "content_base64", "filename", "mime_type"], [], code);
  assertStrictObject(register.inputSchema, ["link_attempt_id", "model_version_id", "file_id"], ["model_id_source"], code);
  assertStrictObject(generate.inputSchema, ["link_attempt_id", "model_id", "prompt", "parameters"], ["image_reference_handle"], code);
  assertStrictObject(reconcile.inputSchema, ["link_attempt_id", "recovery_id"], [], code);
  assertStrictObject(list.inputSchema, ["link_attempt_id"], ["limit"], code);
  assertStrictObject(upload.outputSchema, ["status", "reference_handle", "model_id", "source_mime_type", "mime_type", "width", "height", "size",
    "sha256", "expires_in_seconds", "metadata_confidence", "size_limit_confidence"], [], code);
  assertStrictObject(register.outputSchema, ["status", "reference_handle", "model_id", "source_model_id", "model_version_id", "file_id", "size",
    "sha256", "expires_in_seconds", "content_confidence", "legal_approval", "license_compatibility", "backend_acceptance"], [], code);
  assertStrictObject(generate.outputSchema, ["status", "namespace_confidence", "backend_acceptance", "ai_name", "model_id", "variant", "operation_id",
    "profile_id", "profile_schema_hash", "catalog_version", "request_fingerprint", "parameters", "cost_inputs", "cost_input_confidence",
    "reference_count", "input_references", "lora_assets", "actual_image", "geometry_verified", "artifact", "legal_approval", "license_compatibility"], [], code);
  assertStrictObject(list.outputSchema, ["recoveries"], [], code);
  if (uploadInput.link_attempt_id?.pattern !== attempt || registerInput.link_attempt_id?.pattern !== attempt ||
      generateInput.link_attempt_id?.pattern !== attempt || reconcileInput.link_attempt_id?.pattern !== attempt ||
      listInput.link_attempt_id?.pattern !== attempt || reconcileInput.recovery_id?.pattern !== recovery ||
      generateInput.image_reference_handle?.pattern !== image || !sameArray(uploadInput.mime_type?.enum, UPLOAD_MIMES)) {
    fail("INSTALLED_FLUX_IMAGE_ID_SCHEMA_INVALID");
  }
  if (uploadInput.content_base64?.minLength !== 4 || uploadInput.content_base64?.maxLength !== 44_739_244 ||
      uploadInput.content_base64?.pattern !== "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" ||
      uploadInput.filename?.minLength !== 1 || uploadInput.filename?.maxLength !== 255 ||
      !assertPositiveSafeInteger(registerInput.model_version_id) || !assertPositiveSafeInteger(registerInput.file_id) ||
      (registerInput.model_id_source !== undefined && !assertPositiveSafeInteger(registerInput.model_id_source)) ||
      listInput.limit?.minimum !== 1 || listInput.limit?.maximum !== 20) fail("INSTALLED_FLUX_IMAGE_INPUT_SCHEMA_INVALID");
  if (uploadOutput.status?.const !== "uploaded" || uploadOutput.reference_handle?.pattern !== image || uploadOutput.model_id?.const !== "flux-1" ||
      !sameArray(uploadOutput.source_mime_type?.enum, UPLOAD_MIMES) || !sameArray(uploadOutput.mime_type?.enum, CANONICAL_MIMES) ||
      !assertPositiveBoundedInteger(uploadOutput.width, 0xffff_ffff) || !assertPositiveBoundedInteger(uploadOutput.height, 0xffff_ffff) ||
      !assertPositiveBoundedInteger(uploadOutput.size, 33_554_432) || uploadOutput.sha256?.pattern !== "^sha256:[a-f0-9]{64}$" ||
      uploadOutput.expires_in_seconds?.type !== "integer" || uploadOutput.expires_in_seconds?.minimum !== 1 || uploadOutput.expires_in_seconds?.maximum !== 900 ||
      uploadOutput.metadata_confidence?.const !== "CONTAINER_METADATA_ONLY" ||
      uploadOutput.size_limit_confidence?.const !== "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" ||
      registerOutput.reference_handle?.pattern !== lora || registerOutput.model_id?.const !== "flux-1" ||
      !assertPositiveSafeInteger(registerOutput.source_model_id) || !assertPositiveSafeInteger(registerOutput.model_version_id) ||
      !assertPositiveSafeInteger(registerOutput.file_id) || !assertPositiveBoundedInteger(registerOutput.size, 1_073_741_824) ||
      registerOutput.sha256?.pattern !== "^sha256:[a-f0-9]{64}$" || registerOutput.expires_in_seconds?.minimum !== 1 || registerOutput.expires_in_seconds?.maximum !== 900 ||
      registerOutput.content_confidence?.const !== "STREAMED_SHA256_AND_SAFETENSORS_STRUCTURE" ||
      registerOutput.legal_approval?.const !== "NOT_ESTABLISHED" || registerOutput.license_compatibility?.const !== "UNPROVEN" ||
      registerOutput.backend_acceptance?.const !== "UNPROVEN") fail("INSTALLED_FLUX_IMAGE_ASSET_OUTPUT_SCHEMA_INVALID");
  assertFluxGenerationInput(generate.inputSchema, generateInput, image, lora, code);
  assertFluxGenerationOutput(generate.outputSchema, generateOutput, CANONICAL_MIMES, code);
  assertFluxRecoveryOutput(list.outputSchema, recoveriesOutput, recovery, diagnosticEnums, code);
  for (const [tool, readOnly, destructive, idempotent, openWorld] of [
    [upload, false, true, false, true], [register, false, false, false, true], [generate, false, true, false, true],
    [reconcile, true, false, true, true], [list, true, false, true, false]
  ]) {
    const annotations = tool.annotations ?? {};
    if (annotations.readOnlyHint !== readOnly || annotations.destructiveHint !== destructive ||
        annotations.idempotentHint !== idempotent || annotations.openWorldHint !== openWorld) fail("INSTALLED_FLUX_IMAGE_ANNOTATIONS_INVALID");
  }
  if (!String(generate.description ?? "").includes("do not repeat") || !String(reconcile.description ?? "").includes("GET-only") ||
      !String(list.description ?? "").includes("are not returned")) fail("INSTALLED_FLUX_IMAGE_BOUNDARY_DESCRIPTION_INVALID");
  return counts;
}

export function ownerFluxImageUnexpectedErrorCode(phase, error) {
  if (!PHASES.includes(phase)) fail("INSTALLED_FLUX_IMAGE_DIAGNOSTIC_PHASE_INVALID");
  return `INSTALLED_FLUX_IMAGE_UNEXPECTED_${phase}_${errorClass(error)}`;
}

export function assertOwnerFluxImagePackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_FLUX_IMAGE_PACKAGE_PATHS_INVALID");
  if (REQUIRED_PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) fail("INSTALLED_FLUX_IMAGE_PACKAGE_CONTENT_MISSING");
  return true;
}

const PACKAGE_MODULES = Object.freeze([
  "application/owner-flux-image-parameters", "application/owner-flux-image-source-profile",
  "application/owner-flux-image-request-preparer", "application/owner-flux-image-history-binding",
  "application/owner-flux-image-one-shot-policy", "application/owner-flux-image-upload-service",
  "application/owner-flux-image-asset-service", "application/owner-flux-image-generation-service",
  "application/owner-runway-flux-image-input-validator",
  "adapter/syntx/chat-http-client", "adapter/syntx/flux-image-result", "adapter/syntx/upload-reference-bridge",
  "adapter/civitai/public-model-file-client", "adapter/civitai/public-model-file-attestor",
  "adapter/civitai/pinned-https-download-transport", "mcp/owner-flux-image-tools", "mcp/server",
  "runtime/observed-owner-runtime", "transports/stdio-owner", "catalog/selected-discovery-catalog"
]);
const REQUIRED_PACKAGE_PATHS = Object.freeze(["dist/src/index.js", "dist/src/index.d.ts",
  ...PACKAGE_MODULES.flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`])]);

export function mapOwnerFluxImageNativeModules(modulePaths, loadedModules) {
  if (!Array.isArray(modulePaths) || !Array.isArray(loadedModules) || modulePaths.length !== loadedModules.length ||
      modulePaths.some((path) => typeof path !== "string") || new Set(modulePaths).size !== modulePaths.length ||
      loadedModules.some((module) => !isRecord(module))) fail("INSTALLED_FLUX_IMAGE_MODULE_MAP_INVALID");
  return new Map(modulePaths.map((path, index) => [path, loadedModules[index]]));
}

export function assertConsumerSdkResolution({ consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath,
  clientModulePath, stdioModulePath, projectRoot }) {
  const paths = [consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath, clientModulePath, stdioModulePath, projectRoot];
  if (!paths.every((path) => typeof path === "string" && isAbsolute(path))) fail("INSTALLED_FLUX_IMAGE_SDK_NOT_FROM_CONSUMER");
  const expectedSdk = join(resolve(consumerPath), "node_modules", "@modelcontextprotocol", "sdk");
  const sdkRoot = resolve(resolvedSdkPackagePath);
  if (resolve(sdkPackagePath) !== expectedSdk || !isPathWithin(resolvedConsumerPath, sdkRoot) || isPathWithin(projectRoot, sdkRoot) ||
      !isPathWithin(sdkRoot, resolve(clientModulePath)) || !isPathWithin(sdkRoot, resolve(stdioModulePath))) {
    fail("INSTALLED_FLUX_IMAGE_SDK_NOT_FROM_CONSUMER");
  }
  return true;
}

/** Verify installed Flux declarations against independent source pins; this grants no runtime or provider proof. */
export function assertOwnerFluxImageSourceContract(parametersModule, profileModule, catalog, catalogVersion) {
  const code = "INSTALLED_FLUX_IMAGE_SOURCE_CONTRACT_INVALID";
  let section = "api";
  try {
    if (typeof parametersModule?.getOwnerFluxImageSourceParameters !== "function" ||
        typeof parametersModule?.normalizeOwnerFluxImageParameters !== "function" ||
        typeof profileModule?.getOwnerFluxImageSourceProfile !== "function" || catalogVersion !== PUBLIC_VERSION) fail(code);
    section = "parameters";
    const source = parametersModule.getOwnerFluxImageSourceParameters();
    if (!sameArray(source?.models, MODELS) || !sameJson(source?.resolutions, RESOLUTIONS) ||
        !sameJson(source?.source_pins, SOURCE_PINS) || source?.profile_id !== "flux-image-source-parameters-v1" ||
        source?.source_pins?.source_execution !== false || source?.dispatch_allowed !== false || source?.runtime_activation !== false ||
        source?.backend_acceptance !== "UNPROVEN" || source?.defaults !== "UNKNOWN_CALLBACK_ORDER_AND_CACHED_UI_NOT_PROVEN" ||
        source?.fixed_wire?.n !== 1 || source?.workflow_policy !== "EXPLICIT_CONTROLLED_LOCAL_POLICY_CIVITAI_IFF_LORAS_NONEMPTY_OTHERWISE_DEFAULT_NOT_CALLBACK_DEFAULT_PROOF" ||
        source?.raw_policy !== "NO_USER_CONTROL_FLUX1_AND_PRO_OMIT_ULTRA_FIXED_FALSE_NOT_WATCHER_DEFAULT_PROOF" ||
        source?.cost_policy?.quote_or_amount !== "UNPROVEN" || source?.cost_policy?.controlled_inputs?.length !== 0 ||
        source?.numeric_controls?.cfg?.minimum !== 1 || source?.numeric_controls?.cfg?.maximum !== 4 ||
        source?.numeric_controls?.cfg?.manual_values !== "FINITE_IN_RANGE_NO_QUANTIZATION" ||
        source?.numeric_controls?.steps?.minimum !== 10 || source?.numeric_controls?.steps?.maximum !== 28 ||
        source?.numeric_controls?.steps?.manual_values !== "FINITE_IN_RANGE_NO_QUANTIZATION" ||
        source?.numeric_controls?.image_strength?.minimum !== 0 || source?.numeric_controls?.image_strength?.maximum !== 1 ||
        source?.numeric_controls?.image_strength?.manual_values !== "FINITE_IN_RANGE_NO_QUANTIZATION" ||
        source?.numeric_controls?.lora_strength?.minimum !== 0 || source?.numeric_controls?.lora_strength?.maximum !== 1.5 ||
        source?.numeric_controls?.lora_strength?.manual_values !== "FINITE_IN_RANGE_NO_QUANTIZATION" ||
        source?.reference_limits?.["flux-1"]?.maximum !== 1 || source?.reference_limits?.["flux-pro-1.1"]?.maximum !== 0 ||
        source?.reference_limits?.["flux-pro-1.1-ultra"]?.maximum !== 0 || source?.lora_policy?.model !== "flux-1" ||
        source?.lora_policy?.maximum !== 3 || source?.lora_policy?.strength_clip !== "MUST_EQUAL_STRENGTH_MODEL_SOURCE_SYNC" ||
        source?.lora_policy?.ownership !== "SOURCE_URL_METADATA_ONLY_NATIVE_OWNED_ISSUER_REQUIRED") fail(code);

    section = "profiles";
    let resolutionCases = 0;
    for (const model of MODELS) {
      const profile = profileModule.getOwnerFluxImageSourceProfile(model, catalog, catalogVersion);
      const referenceMaximum = model === "flux-1" ? 1 : 0;
      const accepted = model === "flux-1" ? ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] : [];
      if (profile?.profile_id !== "flux-image-source-reviewed-v1" || profile.model_id !== model || profile.variant !== model ||
          profile.ai_name !== "flux" || profile.model_type !== model || profile.operation_id !== "generate-image" ||
          profile.public_catalog_version !== PUBLIC_VERSION || profile.reference_count?.minimum !== 0 ||
          profile.reference_count?.maximum !== referenceMaximum || !sameArray(profile.media_limits?.accepted_file_types, accepted) ||
          profile.media_limits?.file_count_limit !== referenceMaximum || profile.media_limits?.max_file_size !== 0 ||
          profile.media_limits?.file_size_interpretation !== "ZERO_UNRESOLVED_NOT_UNLIMITED" ||
          profile.media_limits?.provider_acceptance !== "UNPROVEN" ||
          profile.dispatch_allowed !== false || profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN" ||
          profile.effective_defaults !== "UNKNOWN_CALLBACK_ORDER_AND_CACHED_UI_NOT_PROVEN" ||
          !sameJson(profile.source_binding?.selected_public_source_hashes, SOURCE_HASHES) ||
          profile.source_binding?.selected_public_catalog_version !== PUBLIC_VERSION ||
          profile.source_binding?.settings_source?.nominal_owned_lora_grant !== false ||
          profile.source_binding?.settings_source?.lora_source_url_data_only !== true ||
          profile.source_binding?.settings_source?.controls_source !== "ROOT591_STATIC_CONTROL_JOIN" ||
          profile.source_binding?.settings_source?.workflow_policy !== "EXPLICIT_LOCAL_CIVITAI_IFF_LORAS_NONEMPTY_OTHERWISE_DEFAULT" ||
          profile.source_binding?.settings_source?.raw_mapping !== "FLUX1_AND_PRO_OMITTED_ULTRA_FALSE_FIXED_SOURCE_CONTROL" ||
          profile.source_binding?.settings_source?.watcher_defaults !== "UNKNOWN_CALLBACK_ORDER_AND_CACHED_UI_NOT_PROVEN" ||
          profile.source_binding?.cost_source?.quote_amount_currency_actual_billing_hardcap !== "UNPROVEN" ||
          profile.source_binding?.cost_source?.declared_keys?.length !== 0 || profile.source_binding?.cost_source?.controlled_inputs?.length !== 0 ||
          profile.source_binding?.source_artifacts?.form?.build_id !== "1791467421" ||
          profile.source_binding?.source_artifacts?.form?.sha256 !== SOURCE_PINS.form_sha256 ||
          profile.source_binding?.source_artifacts?.form?.freshness !== SOURCE_PINS.form_freshness ||
          profile.source_binding?.source_artifacts?.form?.bytes !== 10_970 ||
          profile.source_binding?.source_artifacts?.form?.evidence !== "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" ||
          profile.source_binding?.source_artifacts?.settings_helper?.module !== SOURCE_PINS.settings_helper_module ||
          profile.source_binding?.source_artifacts?.settings_helper?.sha256 !== SOURCE_PINS.settings_helper_sha256 ||
          profile.source_binding?.source_artifacts?.lora_component?.module !== SOURCE_PINS.lora_component_module ||
          profile.source_binding?.source_artifacts?.lora_component?.sha256 !== PROFILE_LORA_COMPONENT_SHA256 ||
          !/^sha256:[a-f0-9]{64}$/u.test(profile.profile_schema_hash)) fail(code);

      section = "resolutions";
      for (const resolution of RESOLUTIONS[model]) {
        const raw = model === "flux-pro-1.1-ultra" ? false : null;
        const normalized = parametersModule.normalizeOwnerFluxImageParameters({ variant: model, reference_count: 0,
          parameters: { resolution, cfg: 1.35, steps: 12.5, image_strength: 0.65, workflow_type: "default", raw, civitai_loras: [] } });
        if (normalized?.parameters?.resolution !== resolution || normalized.parameters.cfg !== 1.35 || normalized.parameters.steps !== 12.5 ||
            normalized.parameters.image_strength !== 0.65 || normalized.parameters.raw !== raw || normalized.parameters.workflow_type !== "default" ||
            Object.keys(normalized.cost_inputs ?? {}).length !== 0 || normalized.cost_input_confidence !== "NO_SOURCE_COST_INPUTS_QUOTE_AND_BILLING_UNPROVEN" ||
            normalized.backend_acceptance !== "UNPROVEN" || normalized.dispatch_allowed !== false || normalized.runtime_activation !== false) fail(code);
        resolutionCases += 1;
      }
    }
    if (resolutionCases !== 18) fail(code);

    section = "loras";
    for (let count = 0; count <= 3; count += 1) {
      const loras = Array.from({ length: count }, (_, index) => {
        const id = String(4_000 + index);
        const strength = [0, 0.375, 1.5][index % 3];
        return { id, url: `https://civitai.com/api/download/models/${id}?fileId=${5_000 + index}`,
          strength_model: strength, strength_clip: strength };
      });
      const normalized = parametersModule.normalizeOwnerFluxImageParameters({ variant: "flux-1", reference_count: 0,
        parameters: { resolution: "1024x1024", cfg: 2.25, steps: 17.5, image_strength: 0.5,
          workflow_type: count === 0 ? "default" : "civitai", raw: null, civitai_loras: loras } });
      if (normalized?.parameters?.civitai_loras?.length !== count || normalized.parameters.workflow_type !== (count === 0 ? "default" : "civitai") ||
          normalized.parameters.civitai_loras.some((item) => item.strength_clip !== item.strength_model)) fail(code);
    }
    return Object.freeze({ flux_models_checked: MODELS.length, flux_resolution_cases_checked: resolutionCases,
      flux_lora_counts_checked: 4, lora_pin_consistency: SOURCE_PINS.lora_component_sha256 === PROFILE_LORA_COMPONENT_SHA256 ? "MATCH" : "DECLARATIONS_DIFFER",
      source_execution_claimed: false });
  } catch { fail(`${code}_${section.toUpperCase()}`); }
}

/** Public barrel may expose safe owners and DTOs, but no 623 candidate WeakMap state or one-shot grant helpers. */
export function assertOwnerFluxImagePublicExports(api, modules) {
  const code = "INSTALLED_FLUX_IMAGE_PUBLIC_EXPORTS_INVALID";
  const expected = [
    ["OWNER_FLUX_IMAGE_MODELS", "parameters"], ["getOwnerFluxImageSourceParameters", "parameters"],
    ["normalizeOwnerFluxImageParameters", "parameters"], ["OwnerFluxImageParametersError", "parameters"],
    ["getOwnerFluxImageSourceProfile", "profile"], ["OwnerFluxImageSourceProfileError", "profile"],
    ["OwnerFluxImageUploadService", "upload"], ["OwnerFluxImageUploadServiceError", "upload"],
    ["OwnerFluxImageAssetService", "assets"], ["OwnerFluxImageAssetServiceError", "assets"],
    ["OwnerFluxImageGenerationService", "generation"], ["OwnerFluxImageGenerationServiceError", "generation"],
    ["OWNER_FLUX_IMAGE_GENERATION_PHASES", "generation"], ["OWNER_FLUX_IMAGE_GENERATION_ERROR_CODES", "generation"],
    ["OWNER_FLUX_IMAGE_GENERATION_HISTORY_REASONS", "generation"], ["OWNER_FLUX_IMAGE_GENERATION_RESULT_REASONS", "generation"],
    ["OWNER_FLUX_IMAGE_TOOL_NAMES", "tools"], ["SYNTX_UPLOAD_FLUX_IMAGE_REFERENCE_TOOL_NAME", "tools"],
    ["SYNTX_REGISTER_FLUX_PUBLIC_LORA_TOOL_NAME", "tools"], ["SYNTX_OWNER_GENERATE_FLUX_IMAGE_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_RECONCILE_FLUX_IMAGE_TOOL_NAME", "tools"], ["SYNTX_OWNER_LIST_FLUX_IMAGE_RECOVERIES_TOOL_NAME", "tools"],
    ["registerSyntxOwnerFluxImageTools", "tools"]
  ];
  if (!isRecord(api) || !isRecord(modules) || expected.some(([name]) => !Object.hasOwn(api, name)) ||
      expected.some(([name, moduleName]) => api[name] !== modules[moduleName]?.[name]) ||
      ["getOwnerFluxImagePreparedCandidateState", "observeOwnerFluxImageCandidateClock", "prepareOwnerFluxImageRequest",
        "createOwnerFluxImageOneShotPermit", "consumeOwnerFluxImageOneShotPermit"].some((name) => Object.hasOwn(api, name))) fail(code);
  return Object.freeze({ safe_flux_exports_checked: expected.length, private_candidate_exports_absent: true });
}

export function assertOwnerFluxImageDeclarations(declarationText) {
  const required = ["OwnerFluxImageUploadServiceOptions", "OwnerFluxImageUploadInput", "OwnerFluxImageUploadReceipt",
    "OwnerFluxImageUploadServiceErrorCode", "OwnerFluxImageAssetServiceOptions", "OwnerFluxPublicLoraRegistrationInput",
    "OwnerFluxPublicLoraReceipt", "OwnerFluxImageAssetIssueInput", "OwnerFluxImageAssetServiceErrorCode",
    "OwnerFluxImageAssetSet", "OwnerFluxLoraRequest", "OwnerFluxImageGenerationParameters", "OwnerFluxImageGenerationPreflightInput",
    "OwnerFluxImageGenerationPreflightResult", "OwnerFluxImageGenerationPreflight", "OwnerFluxImageGenerationServiceOptions",
    "OwnerFluxImageGenerateInput", "OwnerFluxImageReconcileInput", "OwnerFluxImageRecoveryListInput", "OwnerFluxImageGenerationPhase",
    "OwnerFluxImageGenerationResultReason", "OwnerFluxImageGenerationDiagnostic", "OwnerFluxImageGenerationResult",
    "OwnerFluxImageRecoveryListItem", "OwnerFluxImageGenerationServiceErrorCode", "RegisterSyntxOwnerFluxImageToolsOptions",
    "OwnerFluxImageServiceComposition"];
  if (typeof declarationText !== "string" || required.some((name) => !declarationText.includes(name)) ||
      ["getOwnerFluxImagePreparedCandidateState", "observeOwnerFluxImageCandidateClock", "OwnerFluxImagePreparedCandidate"].some((name) => declarationText.includes(name))) {
    fail("INSTALLED_FLUX_IMAGE_DECLARATION_INVALID");
  }
  return Object.freeze({ safe_flux_declarations_checked: required.length, private_candidate_declarations_absent: true });
}

/** Import only the installed package copy and inspect SDK tools/list; no tool is called. */
export async function assertInstalledOwnerFluxImageNativeTools(installedPackagePath, consumerPath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertOwnerFluxImagePackagePaths(packagedPaths);
    phase = "node-runtime";
    if (Number(process.versions.node.split(".")[0]) !== 24) fail("INSTALLED_FLUX_IMAGE_NODE24_REQUIRED");
    const importPacked = (name) => import(pathToFileURL(join(installedPackagePath, `dist/src/${name}.js`)).href);
    let loaded;
    phase = "module-import";
    try { loaded = await Promise.all([import(pathToFileURL(join(installedPackagePath, "dist/src/index.js")).href),
      ...PACKAGE_MODULES.map(importPacked)]); }
    catch { fail("INSTALLED_FLUX_IMAGE_MODULE_IMPORT_FAILED"); }
    const api = loaded[0]; const moduleMap = mapOwnerFluxImageNativeModules(PACKAGE_MODULES, loaded.slice(1));
    const moduleFor = (name) => moduleMap.get(name);
    const parameters = moduleFor("application/owner-flux-image-parameters");
    const profile = moduleFor("application/owner-flux-image-source-profile");
    const upload = moduleFor("application/owner-flux-image-upload-service");
    const assets = moduleFor("application/owner-flux-image-asset-service");
    const generation = moduleFor("application/owner-flux-image-generation-service");
    const tools = moduleFor("mcp/owner-flux-image-tools");
    const server = moduleFor("mcp/server");
    const stdio = moduleFor("transports/stdio-owner");
    const selectedCatalog = moduleFor("catalog/selected-discovery-catalog");

    phase = "public-exports";
    const exportsSummary = assertOwnerFluxImagePublicExports(api, { parameters, profile, upload, assets, generation, tools, server });
    if (typeof api.readOwnerFluxImageReferencesFlag !== "undefined" ||
        typeof moduleFor("application/owner-flux-image-request-preparer").getOwnerFluxImagePreparedCandidateState !== "function" ||
        typeof moduleFor("application/owner-flux-image-request-preparer").observeOwnerFluxImageCandidateClock !== "function") {
      fail("INSTALLED_FLUX_IMAGE_PRIVATE_EXPORT_BOUNDARY_INVALID");
    }

    phase = "source-contract";
    const version = selectedCatalog.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
    const selected = selectedCatalog.loadSelectedDiscoveryCatalog(version, join(installedPackagePath, "catalog"));
    const sourceSummary = assertOwnerFluxImageSourceContract(parameters, profile, selected.discoveryCatalog, version);
    if (sourceSummary.lora_pin_consistency !== "MATCH") fail("INSTALLED_FLUX_IMAGE_SOURCE_PINS_DISAGREE");

    phase = "declarations";
    let declaration;
    try { declaration = await readFile(join(installedPackagePath, "dist/src/index.d.ts"), "utf8"); }
    catch { fail("INSTALLED_FLUX_IMAGE_DECLARATION_INVALID"); }
    const declarations = assertOwnerFluxImageDeclarations(declaration);

    phase = "flag-reader";
    const readFlag = stdio.readOwnerFluxImageReferencesFlag;
    if (typeof readFlag !== "function" || readFlag(undefined) !== false || readFlag("") !== false || readFlag("0") !== false || readFlag("1") !== true) {
      fail("INSTALLED_FLUX_IMAGE_FLAG_INVALID");
    }
    for (const value of ["true", "yes", "01", " 1 "]) {
      let rejected = false; try { readFlag(value); } catch { rejected = true; }
      if (!rejected) fail("INSTALLED_FLUX_IMAGE_FLAG_INVALID");
    }

    const diagnostics = { phases: generation.OWNER_FLUX_IMAGE_GENERATION_PHASES,
      errorCodes: generation.OWNER_FLUX_IMAGE_GENERATION_ERROR_CODES,
      historyReasons: generation.OWNER_FLUX_IMAGE_GENERATION_HISTORY_REASONS,
      resultReasons: generation.OWNER_FLUX_IMAGE_GENERATION_RESULT_REASONS };
    phase = "stdio-default";
    const defaults = await listInstalledOwnerFluxImageTools(installedPackagePath, consumerPath, false, diagnostics);
    phase = "stdio-opt-in";
    const optIn = await listInstalledOwnerFluxImageTools(installedPackagePath, consumerPath, true, diagnostics);
    return Object.freeze({ ...exportsSummary, ...declarations, ...sourceSummary,
      default_tools: defaults.flux_image_tool_count, opt_in_tools: optIn.flux_image_tool_count,
      node_path: process.execPath, sdk_version: optIn.sdk_version,
      default_child_close: defaults.child_close, opt_in_child_close: optIn.child_close,
      default_child_pid_null: defaults.child_pid_null, opt_in_child_pid_null: optIn.child_pid_null,
      default_stderr_bytes: defaults.stderr_bytes, opt_in_stderr_bytes: optIn.stderr_bytes,
      sdk_operations: Object.freeze(["initialize", "tools/list", "close"]), tool_calls: 0, network_calls: 0 });
  } catch (error) {
    if (error instanceof OwnerFluxImageInstalledCheckError) throw error;
    fail(ownerFluxImageUnexpectedErrorCode(phase, error));
  }
}

async function listInstalledOwnerFluxImageTools(installedPackagePath, consumerPath, enabled, diagnostics) {
  const require = createRequire(join(consumerPath, "package.json"));
  let clientPath; let stdioPath;
  try { clientPath = require.resolve("@modelcontextprotocol/sdk/client/index.js");
    stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js"); }
  catch { fail("INSTALLED_FLUX_IMAGE_SDK_RESOLUTION_FAILED"); }
  const sdkPath = join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk");
  let resolvedConsumer; let resolvedSdk; let resolvedClient; let resolvedStdio; let resolvedProject;
  try { [resolvedConsumer, resolvedSdk, resolvedClient, resolvedStdio, resolvedProject] = await Promise.all([
    realpath(consumerPath), realpath(sdkPath), realpath(clientPath), realpath(stdioPath), realpath(PROJECT_ROOT)
  ]); } catch { fail("INSTALLED_FLUX_IMAGE_SDK_RESOLUTION_FAILED"); }
  assertConsumerSdkResolution({ consumerPath, resolvedConsumerPath: resolvedConsumer, sdkPackagePath: sdkPath,
    resolvedSdkPackagePath: resolvedSdk, clientModulePath: resolvedClient, stdioModulePath: resolvedStdio, projectRoot: resolvedProject });
  let manifest;
  try { manifest = JSON.parse(await readFile(join(resolvedSdk, "package.json"), "utf8")); }
  catch { fail("INSTALLED_FLUX_IMAGE_SDK_MANIFEST_INVALID"); }
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest?.version !== "1.32.1") fail("INSTALLED_FLUX_IMAGE_SDK_VERSION_MISMATCH");
  const [{ Client }, { StdioClientTransport }] = await Promise.all([import(pathToFileURL(clientPath).href), import(pathToFileURL(stdioPath).href)]);
  const client = new Client({ name: enabled ? "syntx-installed-flux-opt-in" : "syntx-installed-flux-default", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")],
    cwd: consumerPath, env: enabled ? { SYNTX_OWNER_FLUX_IMAGE_REFERENCES: "1" } : {}, stderr: "pipe" });
  let closed = false; let resolveClose; const closeEvent = new Promise((resolvePromise) => { resolveClose = resolvePromise; });
  const previousClose = transport.onclose; transport.onclose = () => { closed = true; try { previousClose?.(); } finally { resolveClose(); } };
  let stderrBytes = 0; transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  let connected = false; let failure; let surface;
  try {
    await withDeadline(client.connect(transport), 5_500, "INSTALLED_FLUX_IMAGE_STDIO_INITIALIZE_TIMEOUT"); connected = true;
    if (!Number.isSafeInteger(transport.pid) || transport.pid <= 0) fail("INSTALLED_FLUX_IMAGE_STDIO_PID_INVALID");
    const listed = await withDeadline(client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }),
      5_500, "INSTALLED_FLUX_IMAGE_TOOLS_LIST_TIMEOUT");
    surface = assertOwnerFluxImageToolSurface(listed.tools, enabled, diagnostics);
  } catch (error) {
    failure = error instanceof OwnerFluxImageInstalledCheckError ? error :
      new OwnerFluxImageInstalledCheckError(ownerFluxImageUnexpectedErrorCode(enabled ? "stdio-opt-in" : "stdio-default", error));
  } finally {
    try { await withDeadline(connected ? client.close() : transport.close(), 2_000, "INSTALLED_FLUX_IMAGE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new OwnerFluxImageInstalledCheckError("INSTALLED_FLUX_IMAGE_STDIO_CLOSE_FAILED"); }
    try { await withDeadline(closeEvent, 2_000, "INSTALLED_FLUX_IMAGE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new OwnerFluxImageInstalledCheckError("INSTALLED_FLUX_IMAGE_STDIO_CLOSE_FAILED"); }
    if (!closed || transport.pid !== null) failure ??= new OwnerFluxImageInstalledCheckError("INSTALLED_FLUX_IMAGE_STDIO_CLOSE_FAILED");
  }
  if (failure) throw failure;
  if (stderrBytes !== 0) fail("INSTALLED_FLUX_IMAGE_STDIO_STDERR_NOT_EMPTY");
  return Object.freeze({ ...surface, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes, sdk_version: manifest.version });
}

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function props(schema, code) { if (!isRecord(schema?.properties)) fail(code); return schema.properties; }
function assertStrictObject(schema, required, optional, code) {
  if (schema?.type !== "object" || schema.additionalProperties !== false || !isRecord(schema.properties)) fail(code);
  const expected = [...required, ...optional].sort(), actual = Object.keys(schema.properties).sort();
  if (!sameArray(actual, expected)) fail(code);
  const actualRequired = Array.isArray(schema.required) ? [...schema.required].sort() : [];
  if (!sameArray(actualRequired, [...required].sort())) fail(code);
}
function assertAllObjectsStrict(schema, code, visited = new Set()) {
  if (!isRecord(schema) || visited.has(schema)) return;
  visited.add(schema);
  if (schema.type === "object" || schema.properties !== undefined) {
    if (schema.additionalProperties !== false || !isRecord(schema.properties)) fail(code);
    for (const value of Object.values(schema.properties)) assertAllObjectsStrict(value, code, visited);
  }
  if (schema.items !== undefined) assertAllObjectsStrict(schema.items, code, visited);
  for (const key of ["oneOf", "anyOf", "allOf", "prefixItems"]) {
    const branches = schema[key]; if (branches === undefined) continue;
    if (!Array.isArray(branches)) fail(code); for (const branch of branches) assertAllObjectsStrict(branch, code, visited);
  }
}
function unionBranches(schema) { return Array.isArray(schema?.oneOf) ? schema.oneOf : Array.isArray(schema?.anyOf) ? schema.anyOf : []; }
function enumValues(schema) {
  if (Array.isArray(schema?.enum)) return schema.enum;
  if (schema?.const !== undefined || schema?.const === null) return [schema.const];
  return unionBranches(schema).flatMap((item) => item?.const !== undefined || item?.const === null ? [item.const] :
    item?.type === "null" ? [null] : Array.isArray(item?.enum) ? item.enum : []);
}
function assertNumber(schema, min, max, integer = false) {
  return schema?.type === (integer ? "integer" : "number") && schema.minimum === min && schema.maximum === max && schema.multipleOf === undefined;
}
function assertPositiveSafeInteger(schema) { return schema?.type === "integer" &&
  (schema.minimum === 1 || schema.exclusiveMinimum === 0) && schema.maximum === Number.MAX_SAFE_INTEGER; }
function assertPositiveBoundedInteger(schema, maximum) { return schema?.type === "integer" && schema.exclusiveMinimum === 0 && schema.maximum === maximum; }
function assertNullableNumber(schema, max) {
  const branches = unionBranches(schema); const nullable = schema?.type === "number" || branches.some((item) => item?.type === "number");
  const nullBranch = schema?.type === "null" || branches.some((item) => item?.type === "null" || item?.const === null);
  return nullable && nullBranch && (schema?.maximum === max || branches.some((item) => item?.maximum === max));
}
function assertFluxGenerationInput(schema, fields, imageHandlePattern, loraHandlePattern, code) {
  if (!sameArray(fields.model_id?.enum, ["flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"]) ||
      fields.prompt?.minLength !== 1 || fields.prompt?.maxLength !== 65_536 || fields.image_reference_handle?.pattern !== imageHandlePattern) fail("INSTALLED_FLUX_IMAGE_GENERATION_INPUT_SCHEMA_INVALID");
  const branches = unionBranches(fields.parameters);
  if (branches.length !== 3) fail("INSTALLED_FLUX_IMAGE_GENERATION_INPUT_SCHEMA_INVALID");
  const expected = {
    "flux-1": { resolutions: ["1344x768", "1216x832", "1152x896", "1280x1024", "1024x1024", "1024x1280", "896x1152", "832x1216", "768x1344"], loras: 3, raw: null },
    "flux-pro-1.1": { resolutions: ["1152x896", "1280x1024"], loras: 0, raw: null },
    "flux-pro-1.1-ultra": { resolutions: ["3136x1344", "2752x1536", "2368x1792", "2048x2048", "1792x2368", "1536x2752", "1344x3136"], loras: 0, raw: false }
  };
  const observed = new Set();
  for (const branch of branches) {
    const p = props(branch, code);
    assertStrictObject(branch, ["resolution", "cfg", "steps", "image_strength", "workflow_type", "raw", "civitai_loras"], [], code);
    const raw = enumValues(p.raw); const model = raw.includes(false) ? "flux-pro-1.1-ultra" :
      p.civitai_loras?.maxItems === 3 ? "flux-1" : "flux-pro-1.1";
    const value = expected[model]; const loraItem = p.civitai_loras?.items; const loraProps = props(loraItem, code);
    if (observed.has(model) || !value || !sameArray(p.resolution?.enum, value.resolutions) ||
        !assertNumber(p.cfg, 1, 4) || !assertNumber(p.steps, 10, 28) || !assertNumber(p.image_strength, 0, 1) ||
        !sameArray(p.workflow_type?.enum, ["default", "civitai"]) || !raw.includes(value.raw) ||
        p.civitai_loras?.type !== "array" || p.civitai_loras?.maxItems !== value.loras ||
        loraProps.handle?.pattern !== loraHandlePattern || !assertNumber(loraProps.strength_model, 0, 1.5) ||
        !assertNumber(loraProps.strength_clip, 0, 1.5) || Object.hasOwn(loraProps, "url") || Object.hasOwn(loraProps, "id")) {
      fail("INSTALLED_FLUX_IMAGE_GENERATION_INPUT_SCHEMA_INVALID");
    }
    observed.add(model);
  }
  if (observed.size !== 3) fail("INSTALLED_FLUX_IMAGE_GENERATION_INPUT_SCHEMA_INVALID");
}
function assertFluxGenerationOutput(schema, fields, mimes, code) {
  assertStrictObject(fields.parameters, ["resolution", "cfg", "steps", "image_strength", "workflow_type", "raw", "lora_count"], [], code);
  assertStrictObject(fields.cost_inputs, [], [], code);
  assertStrictObject(fields.actual_image, ["mime_type", "width", "height"], [], code);
  assertStrictObject(fields.artifact, ["url", "mime_type", "mime_source", "width", "height", "geometry_verified"], [], code);
  assertStrictObject(fields.input_references.items, ["mime_type", "width", "height", "size", "sha256", "metadata_confidence"], [], code);
  assertStrictObject(fields.lora_assets.items, ["provenance", "size", "sha256", "strength_model", "strength_clip"], [], code);
  const parameter = props(fields.parameters, code);
  if (fields.status?.const !== "result_observed" || fields.namespace_confidence?.const !== "SOURCE_SHAPED_UNVERIFIED" ||
      fields.backend_acceptance?.const !== "UNPROVEN" || fields.ai_name?.const !== "flux" ||
      !sameArray(fields.model_id?.enum, ["flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"]) ||
      !sameArray(fields.variant?.enum, ["flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"]) ||
      fields.operation_id?.const !== "generate-image" || fields.profile_id?.maxLength !== 160 || fields.profile_schema_hash?.pattern !== "^sha256:[a-f0-9]{64}$" ||
      fields.request_fingerprint?.pattern !== "^sha256:[a-f0-9]{64}$" || fields.catalog_version?.maxLength !== 160 ||
      !sameArray(parameter.resolution?.enum, Object.values(RESOLUTIONS).flat().filter((item, index, list) => list.indexOf(item) === index)) ||
      !assertNumber(parameter.cfg, 1, 4) || !assertNumber(parameter.steps, 10, 28) || !assertNumber(parameter.image_strength, 0, 1) ||
      !sameArray(parameter.workflow_type?.enum, ["default", "civitai"]) || !enumValues(parameter.raw).includes(false) || !enumValues(parameter.raw).includes(null) ||
      parameter.lora_count?.minimum !== 0 || parameter.lora_count?.maximum !== 3 ||
      fields.cost_input_confidence?.const !== "NO_SOURCE_COST_INPUTS_QUOTE_AND_BILLING_UNPROVEN" ||
      fields.reference_count?.minimum !== 0 || fields.reference_count?.maximum !== 1 || fields.input_references?.maxItems !== 1 ||
      fields.lora_assets?.maxItems !== 3 || fields.geometry_verified?.const !== false ||
      fields.actual_image?.properties?.width?.type !== "null" || fields.actual_image?.properties?.height?.type !== "null" ||
      !sameArray(enumValues(fields.actual_image?.properties?.mime_type).filter((value) => value !== null), CANONICAL_MIMES) ||
      fields.artifact?.properties?.width?.type !== "null" || fields.artifact?.properties?.height?.type !== "null" ||
      fields.artifact?.properties?.geometry_verified?.const !== false || fields.legal_approval?.const !== "NOT_ESTABLISHED" ||
      fields.license_compatibility?.const !== "UNPROVEN") fail("INSTALLED_FLUX_IMAGE_GENERATION_OUTPUT_SCHEMA_INVALID");
  if (!sameArray(fields.input_references?.items?.properties?.mime_type?.enum, mimes) ||
      fields.input_references?.items?.properties?.metadata_confidence?.const !== "CONTAINER_METADATA_ONLY" ||
      !sameArray(fields.lora_assets?.items?.properties?.provenance?.enum ?? [fields.lora_assets?.items?.properties?.provenance?.const], ["public_civitai_verified"]) ||
      fields.lora_assets?.items?.properties?.size?.maximum !== 1_073_741_824) fail("INSTALLED_FLUX_IMAGE_GENERATION_OUTPUT_SCHEMA_INVALID");
}
function assertFluxRecoveryOutput(schema, fields, recoveryPattern, diagnosticEnums, code) {
  if (fields.recoveries?.type !== "array" || fields.recoveries?.maxItems !== 20) fail("INSTALLED_FLUX_IMAGE_RECOVERY_SCHEMA_INVALID");
  const item = fields.recoveries.items, itemProps = props(item, code);
  assertStrictObject(item, ["recovery_id", "created_at", "model_id", "operation_id", "status", "diagnostic"], [], code);
  const diagnostic = itemProps.diagnostic, d = props(diagnostic, code);
  assertStrictObject(diagnostic, ["phase", "post_started", "echo_ack_known", "history_binding", "history_binding_reason", "history_get_calls",
    "history_get_calls_saturated", "result_get_calls", "result_get_calls_saturated", "result_status", "result_reason"], [], code);
  if (itemProps.recovery_id?.pattern !== recoveryPattern || itemProps.created_at?.format !== "date-time" || itemProps.operation_id?.const !== "generate-image" ||
      itemProps.status?.const !== "OUTCOME_UNKNOWN" ||
      !sameArray(itemProps.model_id?.enum, ["flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"]) ||
      !sameArray(d.phase?.enum, GENERATION_PHASES) || !sameArray(enumValues(d.history_binding_reason).filter((v) => v !== null), HISTORY_REASONS) ||
      !sameArray(enumValues(d.result_reason).filter((v) => v !== null), RESULT_REASONS) ||
      d.history_get_calls?.maximum !== 255 || d.result_get_calls?.maximum !== 255) fail("INSTALLED_FLUX_IMAGE_RECOVERY_SCHEMA_INVALID");
  if (!diagnosticEnums || !sameArray(diagnosticEnums.phases, GENERATION_PHASES) || !sameArray(diagnosticEnums.errorCodes, GENERATION_ERRORS) ||
      !sameArray(diagnosticEnums.historyReasons, HISTORY_REASONS) || !sameArray(diagnosticEnums.resultReasons, RESULT_REASONS) ||
      ![diagnosticEnums.phases, diagnosticEnums.errorCodes, diagnosticEnums.historyReasons, diagnosticEnums.resultReasons].every(Object.isFrozen)) {
    fail("INSTALLED_FLUX_IMAGE_RECOVERY_ENUMS_INVALID");
  }
}
function sameArray(value, expected) { return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]); }
function sameJson(value, expected) { try { return JSON.stringify(value) === JSON.stringify(expected); } catch { return false; } }
function isPathWithin(root, path) { const rel = relative(resolve(root), resolve(path)); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); }
function errorClass(error) { const name = error instanceof Error ? error.constructor?.name : "Error";
  return new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "AggregateError"]).has(name) ? name : "Error"; }
function withDeadline(operation, milliseconds, code) {
  let timer;
  return Promise.race([Promise.resolve(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), milliseconds); })])
    .finally(() => clearTimeout(timer));
}
function fail(code) { throw new OwnerFluxImageInstalledCheckError(code); }
