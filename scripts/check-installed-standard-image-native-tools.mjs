import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export class StandardImageNativeToolsError extends Error {
  constructor(code) { super(code); this.name = "StandardImageNativeToolsError"; this.code = code; }
}

const PACKAGE_PATHS = Object.freeze([
  "dist/src/index.js", "dist/src/index.d.ts",
  ...[
    "application/owner-standard-image-input-validator",
    "application/owner-standard-image-aux-input-validator",
    "application/owner-standard-image-request-preparer",
    "application/owner-standard-image-history-binding",
    "application/owner-standard-image-one-shot-policy",
    "application/owner-standard-image-upload-service",
    "application/owner-standard-image-generation-service",
    "application/owner-banana-image-parameters",
    "application/owner-banana-image-source-profile",
    "application/owner-gpt-image-parameters",
    "application/owner-gpt-image-source-profile",
    "mcp/owner-standard-image-tools",
    "mcp/server",
    "runtime/observed-owner-runtime",
    "transports/stdio-owner",
    "adapter/syntx/chat-http-client",
    "adapter/syntx/upload-reference-bridge",
    "catalog/selected-discovery-catalog"
  ].flatMap((modulePath) => [`dist/src/${modulePath}.js`, `dist/src/${modulePath}.d.ts`])
]);
const TOOL_NAMES = Object.freeze([
  "syntx_upload_standard_image_reference",
  "syntx_owner_generate_standard_image",
  "syntx_owner_reconcile_standard_image",
  "syntx_owner_list_standard_image_recoveries"
]);
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

export function assertStandardImageNativePackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) {
    throw new StandardImageNativeToolsError("INSTALLED_STANDARD_IMAGE_PACKAGE_PATHS_INVALID");
  }
  if (PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) {
    throw new StandardImageNativeToolsError("INSTALLED_STANDARD_IMAGE_PACKAGE_CONTENT_MISSING");
  }
  return true;
}

/** Accepts canonical realpaths only when resolution began at this consumer's direct SDK dependency. */
export function assertConsumerSdkResolution({ consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath,
  clientModulePath, stdioModulePath, projectRoot }) {
  if (![consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath, clientModulePath, stdioModulePath, projectRoot]
    .every((path) => typeof path === "string" && isAbsolute(path))) {
    fail("INSTALLED_STANDARD_IMAGE_SDK_NOT_FROM_CONSUMER");
  }
  const consumerRoot = resolve(consumerPath);
  const lexicalSdkPath = resolve(sdkPackagePath);
  const expectedConsumerSdkPath = join(consumerRoot, "node_modules", "@modelcontextprotocol", "sdk");
  const sdkRoot = resolve(resolvedSdkPackagePath);
  if (lexicalSdkPath !== expectedConsumerSdkPath || !isPathWithin(resolvedConsumerPath, sdkRoot) ||
      isPathWithin(projectRoot, sdkRoot) ||
      !isPathWithin(sdkRoot, resolve(clientModulePath)) || !isPathWithin(sdkRoot, resolve(stdioModulePath))) {
    fail("INSTALLED_STANDARD_IMAGE_SDK_NOT_FROM_CONSUMER");
  }
  return true;
}

export function assertStandardImageToolSurface(tools, enabled, sourceParameters, diagnosticEnums) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") {
    throw new StandardImageNativeToolsError("INSTALLED_STANDARD_IMAGE_TOOLS_LIST_INVALID");
  }
  const names = tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length !== 0) throw new StandardImageNativeToolsError("INSTALLED_STANDARD_IMAGE_DEFAULT_OFF_FAILED");
    return Object.freeze({ standard_image_tool_count: 0 });
  }
  if (names.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => names.filter((item) => item === name).length !== 1)) {
    fail("INSTALLED_STANDARD_IMAGE_TOOL_SET_MISMATCH");
  }
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const [upload, generate, reconcile, list] = TOOL_NAMES.map((name) => byName.get(name));
  const code = "INSTALLED_STANDARD_IMAGE_SCHEMA_INVALID";
  for (const tool of [upload, generate, reconcile, list]) {
    assertAllObjectsStrict(tool.inputSchema, code);
    assertAllObjectsStrict(tool.outputSchema, code);
  }

  const uploadInput = schemaProperties(upload.inputSchema, code);
  const generateInput = schemaProperties(generate.inputSchema, code);
  const uploadOutput = schemaProperties(upload.outputSchema, code);
  const generateOutput = schemaProperties(generate.outputSchema, code);
  const listOutput = schemaProperties(list.outputSchema, code);
  const attemptPattern = "^link_[A-Za-z0-9_-]{20,120}$";
  const referencePattern = "^standard_image_[0-9a-f-]{36}$";
  const recoveryPattern = "^standard_image_recovery_[0-9a-f-]{36}$";

  assertStrictObject(upload.inputSchema,
    ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"], [], code);
  assertStrictObject(generate.inputSchema,
    ["link_attempt_id", "variant", "reference_handles", "parameters", "prompt"], [], code);
  assertStrictObject(reconcile.inputSchema, ["link_attempt_id", "recovery_id"], [], code);
  assertStrictObject(list.inputSchema, ["link_attempt_id"], ["limit"], code);
  assertStrictObject(upload.outputSchema, ["status", "reference_handle", "variant", "kind", "original_mime_type", "mime_type",
    "width", "height", "duration", "size", "sha256", "expires_in_seconds", "metadata_confidence", "validation_confidence"], [], code);
  assertStrictObject(generate.outputSchema, ["status", "backend_acceptance", "ai_name", "model_id", "variant", "operation_id",
    "profile_id", "profile_schema_hash", "catalog_version", "request_fingerprint", "parameters", "cost_inputs",
    "cost_input_confidence", "reference_count", "total_reference_count", "counts_by_kind", "input_references",
    "actual_image", "geometry_verified", "artifact"], [], code);
  assertStrictObject(list.outputSchema, ["recoveries", "confidence_scope"], [], code);

  if (uploadInput.link_attempt_id?.pattern !== attemptPattern || generateInput.link_attempt_id?.pattern !== attemptPattern ||
      reconcile.inputSchema.properties?.link_attempt_id?.pattern !== attemptPattern ||
      list.inputSchema.properties?.link_attempt_id?.pattern !== attemptPattern ||
      reconcile.inputSchema.properties?.recovery_id?.pattern !== recoveryPattern ||
      !sameArray(uploadInput.variant?.enum, VARIANTS) || !sameArray(generateInput.variant?.enum, VARIANTS)) fail("INSTALLED_STANDARD_IMAGE_ID_INPUT_SCHEMA_INVALID");
  if (uploadInput.content_base64?.minLength !== 4 || uploadInput.content_base64?.maxLength !== 44_739_244 ||
      uploadInput.content_base64?.pattern !== "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" ||
      !String(uploadInput.filename?.description ?? "").includes("local paths and URLs are rejected") ||
      !sameArray(uploadInput.mime_type?.enum, ORIGINAL_MIMES)) fail("INSTALLED_STANDARD_IMAGE_UPLOAD_INPUT_SCHEMA_INVALID");
  if (generateInput.reference_handles?.type !== "array" || generateInput.reference_handles?.maxItems !== 34 ||
      generateInput.reference_handles?.items?.pattern !== referencePattern || typeof generateInput.prompt?.description !== "string" ||
      !generateInput.prompt.description.includes("65,536-byte")) fail("INSTALLED_STANDARD_IMAGE_GENERATION_INPUT_SCHEMA_INVALID");
  if (list.inputSchema.properties?.limit?.minimum !== 1 || list.inputSchema.properties?.limit?.maximum !== 20 ||
      list.inputSchema.properties?.limit?.default !== 20) fail("INSTALLED_STANDARD_IMAGE_RECOVERY_INPUT_SCHEMA_INVALID");

  assertParameterUnion(generateInput.parameters, code, sourceParameters);
  assertParameterUnion(generateOutput.parameters, code, sourceParameters);
  assertExactUnionKeys(generateOutput.cost_inputs, [
    [], ["image_size"], ["quality", "details_quality"], ["quality", "details_quality", "ref_count"]
  ], code);
  assertStrictObject(generateOutput.counts_by_kind, ["image", "video", "file"], [], code);
  assertStrictObject(generateOutput.actual_image, ["mime_type", "width", "height"], [], code);
  assertStrictObject(generateOutput.artifact, ["url", "mime_type", "mime_source", "width", "height", "geometry_verified"], [], code);
  if (uploadOutput.status?.const !== "uploaded" || uploadOutput.reference_handle?.pattern !== referencePattern ||
      !sameArray(uploadOutput.variant?.enum, VARIANTS) || !sameArray(uploadOutput.original_mime_type?.enum, ORIGINAL_MIMES) ||
      !sameArray(uploadOutput.mime_type?.enum, CANONICAL_MIMES) ||
      !sameArray(uploadOutput.metadata_confidence?.enum, ["CONTAINER_METADATA_ONLY", "NOT_EXTRACTED"]) ||
      !sameArray(uploadOutput.validation_confidence?.enum, VALIDATION_CONFIDENCES) ||
      uploadOutput.width?.anyOf?.length !== 2 || uploadOutput.height?.anyOf?.length !== 2) fail("INSTALLED_STANDARD_IMAGE_UPLOAD_OUTPUT_SCHEMA_INVALID");
  if (generateOutput.status?.const !== "result_observed" || generateOutput.backend_acceptance?.const !== "unproven" ||
      !sameArray(generateOutput.variant?.enum, VARIANTS) || !sameArray(generateOutput.model_id?.enum, VARIANTS) ||
      generateOutput.operation_id?.const !== "generate-image" ||
      generateOutput.geometry_verified?.const !== false || generateOutput.actual_image?.properties?.width?.type !== "null" ||
      generateOutput.actual_image?.properties?.height?.type !== "null" ||
      generateOutput.artifact?.properties?.geometry_verified?.const !== false ||
      generateOutput.artifact?.properties?.mime_source?.enum?.join(",") !== "URL_EXTENSION,UNKNOWN" ||
      generateOutput.input_references?.type !== "array" || generateOutput.input_references?.maxItems !== 34 ||
      generateOutput.input_references?.items?.properties?.metadata_confidence?.enum?.join(",") !== "CONTAINER_METADATA_ONLY,UNKNOWN") {
    fail("INSTALLED_STANDARD_IMAGE_GENERATION_OUTPUT_SCHEMA_INVALID");
  }
  if (listOutput.confidence_scope?.const !== "process_local_get_only_recovery" ||
      listOutput.recoveries?.type !== "array" || listOutput.recoveries?.maxItems !== 20) fail("INSTALLED_STANDARD_IMAGE_RECOVERY_OUTPUT_SCHEMA_INVALID");
  const recovery = listOutput.recoveries.items;
  assertStrictObject(recovery, ["recovery_id", "created_at", "model_id", "operation_id", "status", "diagnostic"], [], code);
  assertStrictObject(recovery.properties.diagnostic, ["phase", "post_started", "echo_ack_known", "history_binding",
    "history_binding_reason", "history_get_calls", "history_get_calls_saturated", "inprogress_get_calls",
    "inprogress_get_calls_saturated", "result_get_calls", "result_get_calls_saturated", "result_status", "result_reason"], [], code);
  if (recovery.properties.recovery_id?.pattern !== recoveryPattern || !sameArray(recovery.properties.model_id?.enum, VARIANTS) ||
      recovery.properties.status?.const !== "OUTCOME_UNKNOWN") fail(code);
  if (diagnosticEnums !== undefined) assertDiagnosticEnums(recovery.properties.diagnostic, diagnosticEnums, code);

  assertToolAnnotations(upload, false, code);
  assertToolAnnotations(generate, false, code);
  assertToolAnnotations(reconcile, true, code);
  assertToolAnnotations(list, true, code);
  if (!String(generate.description ?? "").includes("may incur provider cost or token usage") ||
      !String(generate.description ?? "").includes("do not retry") ||
      !String(reconcile.description ?? "").includes("GET-only") ||
      !String(list.description ?? "").includes("never starts or retries")) fail("INSTALLED_STANDARD_IMAGE_OPERATION_BOUNDARY_INVALID");
  return Object.freeze({ standard_image_tool_count: TOOL_NAMES.length });
}

const VARIANTS = Object.freeze([
  "banana", "banana-2.1", "banana2", "banana3", "banana3_light",
  "gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"
]);
const ORIGINAL_MIMES = Object.freeze([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif",
  "video/mp4", "video/webm", "video/quicktime", "video/mpeg", "video/mov", "video/3gpp", "video/x-flv",
  "video/x-ms-wmv", "application/pdf"
]);
const CANONICAL_MIMES = Object.freeze([
  "image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif",
  "video/mp4", "video/webm", "video/quicktime", "video/mpeg", "video/3gpp", "video/x-flv", "video/x-ms-wmv", "application/pdf"
]);
const VALIDATION_CONFIDENCES = Object.freeze([
  "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;BANANA_21_CATALOG_METADATA_CEILING_PROVIDER_UNPROVEN",
  "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
  "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
  "HEIF_PRIMARY_ITEM_ISPE_ASSOCIATION_ONLY;BANANA_21_CATALOG_METADATA_CEILING_PROVIDER_UNPROVEN",
  "HEIF_PRIMARY_ITEM_ISPE_ASSOCIATION_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
  "STRUCTURAL_CONTAINER_VALIDATED_NOT_DECODED",
  "PDF_HEADER_TAIL_GUARDS_ONLY_NOT_PARSED"
]);

export function assertStandardImageSourceSnapshot(snapshot) {
  const code = "INSTALLED_STANDARD_IMAGE_SOURCE_METADATA_INVALID";
  if (!isRecord(snapshot) || !sameArray(snapshot.variants, VARIANTS) || !Array.isArray(snapshot.profiles) ||
      snapshot.profiles.length !== VARIANTS.length || !isRecord(snapshot.banana) || !isRecord(snapshot.gpt) ||
      !isRecord(snapshot.inputPolicy)) fail(code);
  const bananaVariants = ["banana", "banana-2.1", "banana2", "banana3", "banana3_light"];
  const gptVariants = ["gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
  if (snapshot.banana.profile_id !== "banana-image-source-parameters-v1" ||
      !sameArray(snapshot.banana.variants, bananaVariants) ||
      snapshot.banana.source_pins?.public_catalog_version !== "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json" ||
      snapshot.banana.source_pins?.form_sha256 !== "sha256:b66e233dc1ad667fc128b25c19255458ce51fe4bf6e4648d3848b27b402c1c1e" ||
      snapshot.banana.source_pins?.settings_helper_sha256 !== "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" ||
      snapshot.banana.source_pins?.source_execution !== false || snapshot.banana.dispatch_allowed !== false ||
      snapshot.banana.backend_acceptance !== "UNPROVEN" ||
      !sameArray(snapshot.gpt.variants, gptVariants) || snapshot.gpt.source_pins?.catalog !== snapshot.banana.source_pins.public_catalog_version ||
      snapshot.gpt.source_pins?.form_sha256 !== "sha256:b30879e1d8171abf2dcab0dd490fbf561fab85495f022c8215b414d17178a966" ||
      snapshot.gpt.source_pins?.helper_sha256 !== "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" ||
      snapshot.gpt.source_pins?.app_sha256 !== "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" ||
      snapshot.gpt.dispatch_allowed !== false || snapshot.gpt.runtime_activation !== false ||
      snapshot.gpt.backend_acceptance !== "UNPROVEN" || snapshot.inputPolicy.banana_21?.source_image_max_bytes !== 7_340_032 ||
      snapshot.inputPolicy.other_variants?.local_process_max_bytes !== 33_554_432 ||
      snapshot.inputPolicy.other_variants?.policy !== "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" ||
      snapshot.inputPolicy.dimensions !== "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS") fail(code);
  if (!sameArray(snapshot.banana.controls?.aspect_ratio?.values,
      [null, "21:9", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "1:1"]) ||
      !sameArray(snapshot.banana.controls?.image_size?.values_by_variant?.banana, [null]) ||
      !sameArray(snapshot.banana.controls?.image_size?.values_by_variant?.["banana-2.1"], ["1K", "2K", "4K"]) ||
      !sameArray(snapshot.banana.controls?.image_size?.values_by_variant?.banana2, ["1K", "2K", "4K"]) ||
      !sameArray(snapshot.banana.controls?.image_size?.values_by_variant?.banana3, ["0.5K", "1K", "2K", "4K"]) ||
      !sameArray(snapshot.banana.controls?.image_size?.values_by_variant?.banana3_light, ["1K"]) ||
      !sameArray(snapshot.banana.controls?.thinking_level?.values_by_variant?.["banana-2.1"], ["minimal", "medium", "high"]) ||
      !sameArray(snapshot.banana.controls?.thinking_level?.values_by_variant?.banana3, [null]) ||
      snapshot.gpt.parameters?.aspect_ratio?.legacy_values?.join(",") !== "3:2,1:1,2:3" ||
      snapshot.gpt.parameters?.aspect_ratio?.mapped_values?.join(",") !== GPT_RATIOS.join(",") ||
      !sameArray(snapshot.gpt.parameters?.quality?.values, GPT_QUALITIES) ||
      !sameArray(snapshot.gpt.parameters?.details_quality?.gpt_image_2_values, ["low", "medium", "high"]) ||
      !sameArray(snapshot.gpt.parameters?.details_quality?.gpt_image_25_values, GPT_DETAILS) ||
      snapshot.gpt.cost_policy?.optional_reference_count_wire !== "OMIT_WHEN_ZERO_SOURCE_SERIALIZER_USES_UNDEFINED" ||
      snapshot.gpt.cost_policy?.amount_currency_actual_billing_hardcap !== "UNPROVEN") fail(code);
  const profiles = new Map(snapshot.profiles.map((profile) => [profile?.variant, profile]));
  if (profiles.size !== VARIANTS.length) fail(code);
  const referenceMaximums = [4, 14, 14, 14, 14, 5, 10, 10, 16, 16];
  for (const variant of VARIANTS) {
    const index = VARIANTS.indexOf(variant);
    const profile = profiles.get(variant);
    const expectedProfileId = variant.startsWith("banana") ? "banana-image-source-reviewed-v1" : "gpt-image-family-source-reviewed-v1";
    const expectedAiName = variant.startsWith("banana") ? "banana" : "sora-images";
    if (!isRecord(profile) || profile.model_id !== variant || profile.profile_id !== expectedProfileId ||
        profile.model_type !== variant || profile.ai_name !== expectedAiName ||
        profile.public_catalog_version !== snapshot.catalogVersion || profile.operation_id !== "generate-image" ||
        profile.dispatch_allowed !== false || profile.backend_acceptance !== "UNPROVEN" ||
        profile.runtime_activation !== false || profile.effective_defaults !== "UNKNOWN" ||
        profile.reference_count?.minimum !== 0 || profile.reference_count?.maximum !== referenceMaximums[index] ||
        profile.source_binding?.selected_public_catalog_version !== snapshot.catalogVersion ||
        !/^sha256:[a-f0-9]{64}$/u.test(profile.profile_schema_hash ?? "") || !isRecord(profile.source_binding)) fail(code);
  }
  return Object.freeze({
    variants: VARIANTS.length,
    source_metadata: "PASS",
    selected_catalog: snapshot.catalogVersion,
    banana: snapshot.banana,
    gpt: snapshot.gpt
  });
}

/** Checks compiled public exports, pinned source descriptors, and both installed stdio surfaces. */
export async function assertInstalledStandardImageNativeTools(installedPackagePath, consumerPath, packagedPaths) {
  assertStandardImageNativePackagePaths(packagedPaths);
  if (Number(process.versions.node.split(".")[0]) !== 24) {
    fail("INSTALLED_STANDARD_IMAGE_NODE24_REQUIRED");
  }
  const importPacked = (relativePath) => import(pathToFileURL(join(installedPackagePath, relativePath)).href);
  let modules;
  try {
    modules = await Promise.all([
      importPacked("dist/src/index.js"),
      importPacked("dist/src/application/owner-standard-image-input-validator.js"),
      importPacked("dist/src/application/owner-standard-image-aux-input-validator.js"),
      importPacked("dist/src/application/owner-standard-image-request-preparer.js"),
      importPacked("dist/src/application/owner-standard-image-history-binding.js"),
      importPacked("dist/src/application/owner-standard-image-one-shot-policy.js"),
      importPacked("dist/src/application/owner-standard-image-upload-service.js"),
      importPacked("dist/src/application/owner-standard-image-generation-service.js"),
      importPacked("dist/src/mcp/owner-standard-image-tools.js"),
      importPacked("dist/src/catalog/selected-discovery-catalog.js"),
      importPacked("dist/src/application/owner-banana-image-parameters.js"),
      importPacked("dist/src/application/owner-gpt-image-parameters.js")
    ]);
  } catch { fail("INSTALLED_STANDARD_IMAGE_MODULE_IMPORT_FAILED"); }
  const [api, input, aux, preparer, history, permit, uploadService, generationService, toolsModule,
    selectedCatalogModule, bananaModule, gptModule] = modules;
  for (const [name, value] of Object.entries({
    validateOwnerStandardImageInput: api.validateOwnerStandardImageInput,
    validateOwnerStandardImageUploadData: api.validateOwnerStandardImageUploadData,
    validateOwnerStandardImageAuxInput: api.validateOwnerStandardImageAuxInput,
    validateOwnerStandardImageAuxUploadData: api.validateOwnerStandardImageAuxUploadData,
    createOwnerStandardImageOwnedReferenceBindingIssuer: api.createOwnerStandardImageOwnedReferenceBindingIssuer,
    getOwnerStandardImageSourceProfile: api.getOwnerStandardImageSourceProfile,
    prepareOwnerStandardImageRequest: api.prepareOwnerStandardImageRequest,
    correlateOwnerStandardImageHistoryBinding: api.correlateOwnerStandardImageHistoryBinding,
    createOwnerStandardImageOneShotPermit: api.createOwnerStandardImageOneShotPermit,
    consumeOwnerStandardImageOneShotPermit: api.consumeOwnerStandardImageOneShotPermit,
    OwnerStandardImageUploadService: api.OwnerStandardImageUploadService,
    OwnerStandardImageGenerationService: api.OwnerStandardImageGenerationService,
    registerSyntxOwnerStandardImageTools: api.registerSyntxOwnerStandardImageTools
  })) if (typeof value !== "function") fail(`INSTALLED_STANDARD_IMAGE_PUBLIC_EXPORT_MISSING:${name}`);
  if (api.OwnerStandardImageInputError !== input.OwnerStandardImageInputError ||
      api.OwnerStandardImageAuxInputError !== aux.OwnerStandardImageAuxInputError ||
      api.OwnerStandardImagePrepareError !== preparer.OwnerStandardImagePrepareError ||
      api.OwnerStandardImageGenerationServiceError !== generationService.OwnerStandardImageGenerationServiceError ||
      api.SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_TOOL_NAME !== toolsModule.SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_TOOL_NAME ||
      api.SYNTX_OWNER_GENERATE_STANDARD_IMAGE_TOOL_NAME !== toolsModule.SYNTX_OWNER_GENERATE_STANDARD_IMAGE_TOOL_NAME ||
      api.SYNTX_OWNER_RECONCILE_STANDARD_IMAGE_TOOL_NAME !== toolsModule.SYNTX_OWNER_RECONCILE_STANDARD_IMAGE_TOOL_NAME ||
      api.SYNTX_OWNER_LIST_STANDARD_IMAGE_RECOVERIES_TOOL_NAME !== toolsModule.SYNTX_OWNER_LIST_STANDARD_IMAGE_RECOVERIES_TOOL_NAME) {
    fail("INSTALLED_STANDARD_IMAGE_PUBLIC_EXPORT_MISMATCH");
  }
  const catalogVersion = selectedCatalogModule.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  const selected = selectedCatalogModule.loadSelectedDiscoveryCatalog(catalogVersion, join(installedPackagePath, "catalog"));
  const profiles = VARIANTS.map((variant) => api.getOwnerStandardImageSourceProfile(variant, selected.discoveryCatalog, catalogVersion));
  const sourceSnapshot = assertStandardImageSourceSnapshot({
    variants: api.OWNER_STANDARD_IMAGE_VARIANTS,
    profiles,
    banana: bananaModule.getOwnerBananaImageSourceParameters(),
    gpt: gptModule.getOwnerGptImageSourceParameters(),
    inputPolicy: input.OWNER_STANDARD_IMAGE_INPUT_POLICY,
    catalogVersion
  });
  const normalizerCases = assertRepresentativeNormalizers(VARIANTS, bananaModule, gptModule);
  const diagnosticEnums = {
    phases: generationService.OWNER_STANDARD_IMAGE_GENERATION_PHASES,
    historyReasons: generationService.OWNER_STANDARD_IMAGE_GENERATION_HISTORY_REASONS,
    resultReasons: generationService.OWNER_STANDARD_IMAGE_GENERATION_RESULT_REASONS
  };
  const declaration = await readFile(join(installedPackagePath, "dist/src/index.d.ts"), "utf8");
  if (["OwnerStandardImageVariant", "OwnerStandardImageGenerationResult", "OwnerStandardImageUploadReceipt",
    "OwnerStandardImageServiceComposition", "RegisterSyntxOwnerStandardImageToolsOptions"].some((name) => !declaration.includes(name)) ||
      declaration.includes("OwnerStandardImageInputVariant")) {
    fail("INSTALLED_STANDARD_IMAGE_DECLARATION_VARIANT_CANONICALITY_INVALID");
  }
  const defaultResult = await listInstalledStandardImageTools(installedPackagePath, consumerPath, false, { banana: sourceSnapshot.banana, gpt: sourceSnapshot.gpt }, diagnosticEnums);
  const optInResult = await listInstalledStandardImageTools(installedPackagePath, consumerPath, true, { banana: sourceSnapshot.banana, gpt: sourceSnapshot.gpt }, diagnosticEnums);
  return Object.freeze({
    default_tools: defaultResult.standard_image_tool_count,
    opt_in_tools: optInResult.standard_image_tool_count,
    variants: sourceSnapshot.variants,
    normalizer_cases: normalizerCases,
    source_metadata: sourceSnapshot.source_metadata,
    sdk_version: optInResult.sdk_version,
    node_path: process.execPath,
    default_child_close: defaultResult.child_close,
    opt_in_child_close: optInResult.child_close,
    default_child_pid_null: defaultResult.child_pid_null,
    opt_in_child_pid_null: optInResult.child_pid_null,
    default_stderr_bytes: defaultResult.stderr_bytes,
    opt_in_stderr_bytes: optInResult.stderr_bytes,
    sdk_operations: Object.freeze(["initialize", "tools/list", "close"]),
    tool_calls: 0,
    network_calls: 0
  });
}

async function listInstalledStandardImageTools(installedPackagePath, consumerPath, enabled, sourceParameters, diagnosticEnums) {
  const consumerRequire = createRequire(join(consumerPath, "package.json"));
  let clientModulePath;
  let stdioModulePath;
  try {
    clientModulePath = consumerRequire.resolve("@modelcontextprotocol/sdk/client/index.js");
    stdioModulePath = consumerRequire.resolve("@modelcontextprotocol/sdk/client/stdio.js");
  } catch { fail("INSTALLED_STANDARD_IMAGE_SDK_RESOLUTION_FAILED"); }
  const sdkPackageRoot = join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk");
  let resolvedConsumerPath;
  let resolvedSdkPackageRoot;
  let resolvedClientModulePath;
  let resolvedStdioModulePath;
  let resolvedProjectRoot;
  try {
    [resolvedConsumerPath, resolvedSdkPackageRoot, resolvedClientModulePath, resolvedStdioModulePath, resolvedProjectRoot] = await Promise.all([
      realpath(consumerPath), realpath(sdkPackageRoot), realpath(clientModulePath), realpath(stdioModulePath), realpath(PROJECT_ROOT)
    ]);
  } catch { fail("INSTALLED_STANDARD_IMAGE_SDK_RESOLUTION_FAILED"); }
  assertConsumerSdkResolution({ consumerPath, resolvedConsumerPath, sdkPackagePath: sdkPackageRoot, resolvedSdkPackagePath: resolvedSdkPackageRoot,
    clientModulePath: resolvedClientModulePath, stdioModulePath: resolvedStdioModulePath, projectRoot: resolvedProjectRoot });
  let sdkManifest;
  try { sdkManifest = JSON.parse(await readFile(join(resolvedSdkPackageRoot, "package.json"), "utf8")); }
  catch { fail("INSTALLED_STANDARD_IMAGE_SDK_MANIFEST_INVALID"); }
  if (sdkManifest?.name !== "@modelcontextprotocol/sdk" || sdkManifest?.version !== "1.32.1") {
    fail("INSTALLED_STANDARD_IMAGE_SDK_VERSION_MISMATCH");
  }
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(clientModulePath).href), import(pathToFileURL(stdioModulePath).href)
  ]);
  const client = new Client({ name: enabled ? "syntx-installed-standard-image-opt-in" : "syntx-installed-standard-image-default", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")],
    cwd: consumerPath,
    env: enabled ? { SYNTX_OWNER_STANDARD_IMAGE_REFERENCES: "1" } : {},
    stderr: "pipe"
  });
  let closeObserved = false;
  let resolveClose;
  const closed = new Promise((resolve) => { resolveClose = resolve; });
  const previousOnClose = transport.onclose;
  transport.onclose = () => { closeObserved = true; try { previousOnClose?.(); } finally { resolveClose(); } };
  let stderrBytes = 0;
  transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  let connected = false;
  let failure;
  let surface;
  try {
    await withDeadline(client.connect(transport), 5_500, "INSTALLED_STANDARD_IMAGE_STDIO_INITIALIZE_TIMEOUT");
    connected = true;
    if (!Number.isSafeInteger(transport.pid) || transport.pid <= 0) fail("INSTALLED_STANDARD_IMAGE_STDIO_PID_INVALID");
    const listed = await withDeadline(client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }),
      5_500, "INSTALLED_STANDARD_IMAGE_TOOLS_LIST_TIMEOUT");
    surface = assertStandardImageToolSurface(listed.tools, enabled, sourceParameters, diagnosticEnums);
  } catch (error) {
    failure = error instanceof StandardImageNativeToolsError ? error : new StandardImageNativeToolsError("INSTALLED_STANDARD_IMAGE_STDIO_TOOLS_LIST_FAILED");
  } finally {
    try { await withDeadline(connected ? client.close() : transport.close(), 2_000, "INSTALLED_STANDARD_IMAGE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new StandardImageNativeToolsError("INSTALLED_STANDARD_IMAGE_STDIO_CLOSE_FAILED"); }
    try { await withDeadline(closed, 2_000, "INSTALLED_STANDARD_IMAGE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new StandardImageNativeToolsError("INSTALLED_STANDARD_IMAGE_STDIO_CLOSE_FAILED"); }
    if (!closeObserved || transport.pid !== null) failure ??= new StandardImageNativeToolsError("INSTALLED_STANDARD_IMAGE_STDIO_CLOSE_FAILED");
  }
  if (failure) throw failure;
  if (stderrBytes !== 0) fail("INSTALLED_STANDARD_IMAGE_STDIO_STDERR_NOT_EMPTY");
  return Object.freeze({ ...surface, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes, sdk_version: sdkManifest.version });
}

function assertParameterUnion(schema, code, sourceParameters) {
  const unions = unionSchemas(schema);
  if (unions.length !== 2) fail(code);
  const banana = unions.find((item) => sameArray(Object.keys(item?.properties ?? {}).sort(), ["aspect_ratio", "image_size", "thinking_level"].sort()));
  const gpt = unions.find((item) => sameArray(Object.keys(item?.properties ?? {}).sort(), ["aspect_ratio", "details_quality", "quality"].sort()));
  if (!banana || !gpt) fail(code);
  assertStrictObject(banana, ["aspect_ratio", "image_size", "thinking_level"], [], code);
  assertStrictObject(gpt, ["aspect_ratio", "quality", "details_quality"], [], code);
  for (const field of ["aspect_ratio", "image_size", "thinking_level"]) if (!hasNullableEnum(banana.properties[field])) fail(code);
  for (const field of ["quality", "details_quality"]) if (!hasNullableEnum(gpt.properties[field])) fail(code);
  if (!Array.isArray(gpt.properties.aspect_ratio?.enum)) fail(code);
  if (!sameArray(banana.properties.aspect_ratio.anyOf[0].enum, BANANA_RATIOS) ||
      !sameArray(banana.properties.image_size.anyOf[0].enum, BANANA_SIZES) ||
      !sameArray(banana.properties.thinking_level.anyOf[0].enum, BANANA_THINKING) ||
      !sameArray(gpt.properties.aspect_ratio.enum, GPT_RATIOS) ||
      !sameArray(gpt.properties.quality.anyOf[0].enum, GPT_QUALITIES) ||
      !sameArray(gpt.properties.details_quality.anyOf[0].enum, GPT_DETAILS)) fail(code);
  if (sourceParameters !== undefined) {
    const bananaSource = sourceParameters.banana;
    const gptSource = sourceParameters.gpt;
    if (!isRecord(bananaSource) || !isRecord(gptSource) ||
        !sameArray(banana.properties.aspect_ratio.anyOf[0].enum,
          bananaSource.controls.aspect_ratio.values.filter((value) => typeof value === "string")) ||
        !sameArray(banana.properties.image_size.anyOf[0].enum, BANANA_SIZES.filter((value) =>
          Object.values(bananaSource.controls.image_size.values_by_variant).flat().includes(value))) ||
        !sameArray(banana.properties.thinking_level.anyOf[0].enum, BANANA_THINKING.filter((value) =>
          Object.values(bananaSource.controls.thinking_level.values_by_variant).flat().includes(value))) ||
        !sameSet(gpt.properties.aspect_ratio.enum,
          [...new Set([...gptSource.parameters.aspect_ratio.legacy_values, ...gptSource.parameters.aspect_ratio.mapped_values])]) ||
        !sameArray(gpt.properties.quality.anyOf[0].enum, gptSource.parameters.quality.values) ||
        !sameArray(gpt.properties.details_quality.anyOf[0].enum,
          [...new Set([...gptSource.parameters.details_quality.gpt_image_2_values, ...gptSource.parameters.details_quality.gpt_image_25_values])])) fail(code);
  }
}

function assertDiagnosticEnums(schema, expected, code) {
  const properties = schemaProperties(schema, code);
  for (const [field, values] of [["phase", expected.phases], ["history_binding_reason", expected.historyReasons], ["result_reason", expected.resultReasons]]) {
    if (!Array.isArray(values) || values.length === 0 || !sameArray(enumValues(properties[field]), values)) fail("INSTALLED_STANDARD_IMAGE_DIAGNOSTIC_ENUM_INVALID");
  }
}

function assertRepresentativeNormalizers(variants, bananaModule, gptModule) {
  const banana = bananaModule.getOwnerBananaImageSourceParameters();
  const gpt = gptModule.getOwnerGptImageSourceParameters();
  let cases = 0;
  for (const variant of variants) {
    if (variant.startsWith("banana")) {
      const normalized = bananaModule.normalizeOwnerBananaImageParameters({
        variant,
        reference_count: 0,
        parameters: {
          aspect_ratio: banana.controls.aspect_ratio.values.find((value) => typeof value === "string"),
          image_size: banana.controls.image_size.values_by_variant[variant][0],
          thinking_level: banana.controls.thinking_level.values_by_variant[variant][0]
        }
      });
      if (normalized.variant !== variant || normalized.reference_count !== 0 || normalized.backend_acceptance !== "UNPROVEN") {
        fail("INSTALLED_STANDARD_IMAGE_PARAMETER_NORMALIZATION_INVALID");
      }
    } else {
      const legacy = variant === "gpt-image-1" || variant === "gpt-image-1.5";
      const normalized = gptModule.normalizeOwnerGptImageParameters({
        variant, reference_count: 0,
        parameters: {
          aspect_ratio: (legacy ? gpt.parameters.aspect_ratio.legacy_values : gpt.parameters.aspect_ratio.mapped_values)[0],
          quality: legacy ? null : gpt.parameters.quality.values[0],
          details_quality: legacy ? null : variant === "gpt-image-2"
            ? gpt.parameters.details_quality.gpt_image_2_values[0]
            : gpt.parameters.details_quality.gpt_image_25_values[0]
        }
      });
      if (normalized.variant !== variant || normalized.reference_count !== 0 || normalized.backend_acceptance !== "UNPROVEN") {
        fail("INSTALLED_STANDARD_IMAGE_PARAMETER_NORMALIZATION_INVALID");
      }
    }
    cases += 1;
  }
  if (cases !== VARIANTS.length) fail("INSTALLED_STANDARD_IMAGE_PARAMETER_NORMALIZATION_INVALID");
  return cases;
}

function assertExactUnionKeys(schema, expected, code) {
  const branches = unionSchemas(schema);
  const actual = branches.map((branch) => Object.keys(schemaProperties(branch, code)).sort());
  const orderedExpected = expected.map((keys) => [...keys].sort()).sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
  const orderedActual = actual.sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
  if (JSON.stringify(orderedActual) !== JSON.stringify(orderedExpected) || branches.some((branch) => branch.additionalProperties !== false)) fail(code);
}

function assertStrictObject(schema, required, optional, code) {
  const properties = schemaProperties(schema, code);
  const expectedRequired = [...required].sort();
  if (schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(properties).sort(), [...required, ...optional].sort()) ||
      !sameArray(Array.isArray(schema.required) ? [...schema.required].sort() : null, expectedRequired)) fail(code);
}

function assertToolAnnotations(tool, readOnly, code) {
  const expected = { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: true };
  if (!isRecord(tool.annotations) || Object.keys(expected).some((key) => tool.annotations[key] !== expected[key])) fail(code);
}

function assertAllObjectsStrict(value, code) {
  if (Array.isArray(value)) { for (const entry of value) assertAllObjectsStrict(entry, code); return; }
  if (!isRecord(value)) return;
  if (value.type === "object" && value.additionalProperties !== false) fail(code);
  for (const child of Object.values(value)) assertAllObjectsStrict(child, code);
}

function schemaProperties(schema, code) {
  if (!isRecord(schema) || !isRecord(schema.properties)) fail(code);
  return schema.properties;
}

function unionSchemas(schema) { return Array.isArray(schema?.anyOf) ? schema.anyOf : Array.isArray(schema?.oneOf) ? schema.oneOf : []; }
function hasNullableEnum(schema) { return unionSchemas(schema).length === 2 && unionSchemas(schema).some((item) => item?.type === "null") && unionSchemas(schema).some((item) => Array.isArray(item?.enum)); }
function enumValues(schema) { return Array.isArray(schema?.enum) ? schema.enum : unionSchemas(schema).find((item) => Array.isArray(item?.enum))?.enum; }
function sameArray(actual, expected) { return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected); }
function sameSet(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isPathWithin(root, candidate) {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return pathFromRoot === "" || pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}
async function withDeadline(promise, milliseconds, code) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new StandardImageNativeToolsError(code)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
function fail(code) { throw new StandardImageNativeToolsError(code); }

const BANANA_RATIOS = Object.freeze(["21:9", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "1:1"]);
const BANANA_SIZES = Object.freeze(["1K", "2K", "4K", "0.5K"]);
const BANANA_THINKING = Object.freeze(["minimal", "medium", "high"]);
const GPT_RATIOS = Object.freeze(["1:1", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "21:9"]);
const GPT_QUALITIES = Object.freeze(["1K", "2K", "4K"]);
const GPT_DETAILS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
