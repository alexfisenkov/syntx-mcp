import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VARIANTS = Object.freeze([
  "wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"
]);
const PARAMETER_KEYS = Object.freeze([
  "aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "color_palette", "bbox_list"
]);
const CONTROL_KEYS = Object.freeze([
  "aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "bbox_list", "color_palette"
]);
const RATIOS = Object.freeze({
  wan_25_i2i_preview: ["1:1", "3:4", "4:3", "9:16", "16:9"],
  wan_26_image: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
  wan_27_image: ["1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
  wan_27_image_pro: ["1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
});
const RESOLUTIONS = Object.freeze({
  wan_25_i2i_preview: ["720P"], wan_26_image: ["720P", "1080P"],
  wan_27_image: ["1K", "2K"], wan_27_image_pro: ["1K", "2K", "4K"]
});
const COUNTS = Object.freeze({
  wan_25_i2i_preview: { minimum: 1, maximum: 3 }, wan_26_image: { minimum: 1, maximum: 4 },
  wan_27_image: { minimum: 0, maximum: 9 }, wan_27_image_pro: { minimum: 0, maximum: 9 }
});
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const EXPECTED_PATHS = Object.freeze([
  "docs/модели/WAN-image-источники-и-параметры.md",
  ...["owner-wan-image-parameters", "owner-wan-image-input-validator", "owner-wan-bmp-inspector", "owner-wan-image-prompt", "owner-wan-image-source-profile"]
    .flatMap((name) => [`dist/src/application/${name}.js`, `dist/src/application/${name}.d.ts`])
]);
const NATIVE_VARIANTS = Object.freeze(["wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"]);
const NATIVE_TOOL_NAMES = Object.freeze([
  "syntx_upload_wan_reference_image", "syntx_owner_generate_wan_image",
  "syntx_owner_reconcile_wan_image", "syntx_owner_list_wan_recoveries"
]);
const NATIVE_PARAMETER_KEYS = Object.freeze([
  "aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "color_palette", "bbox_list"
]);
const NATIVE_RATIOS = Object.freeze([
  "1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "21:9", "1:2", "2:1", "1:3", "3:1", "4:5", "5:4"
]);
const NATIVE_RESOLUTIONS = Object.freeze(["720P", "1080P", "1K", "2K", "4K"]);
const NATIVE_SOURCE_MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp"]);
const NATIVE_CANONICAL_MIME_TYPES = Object.freeze(["image/png", "image/jpeg", "image/bmp", "image/webp"]);
const NATIVE_COORDINATE_POLICY = "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER";
const NATIVE_DIAGNOSTIC_PHASES = Object.freeze([
  "REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
  "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "IN_PROGRESS_GET", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
]);
const NATIVE_HISTORY_BINDINGS = Object.freeze(["NONE", "PENDING", "READY", "INVALID"]);
const NATIVE_RESULT_STATUSES = Object.freeze(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]);
const NATIVE_RECOVERY_SCOPE = "process_local_get_only_recovery";
const NATIVE_PACKAGE_PATHS = Object.freeze([
  "docs/модели/WAN-image-источники-и-параметры.md",
  "dist/src/mcp/owner-wan-image-tools.js", "dist/src/mcp/owner-wan-image-tools.d.ts",
  ...["owner-wan-image-coordinate-metadata", "owner-wan-image-request-preparer", "owner-wan-image-upload-service",
    "owner-wan-image-one-shot-policy", "owner-wan-image-history-binding", "owner-wan-image-generation-service"]
    .flatMap((name) => [`dist/src/application/${name}.js`, `dist/src/application/${name}.d.ts`])
]);

export class WanAdmissionSmokeError extends Error {
  constructor(code) { super(code); this.name = "WanAdmissionSmokeError"; this.code = code; }
}

/** Runs only against files installed from the packed tarball in the temporary consumer. */
export async function assertInstalledWanAdmission(installedPackagePath, consumerPath, packagedPaths) {
  assertWanAdmissionPackagePaths(packagedPaths);
  const importPacked = (relativePath) => import(pathToFileURL(join(installedPackagePath, relativePath)).href);
  let parametersModule;
  let inputModule;
  let promptModule;
  let profileModule;
  let bmpModule;
  let selectedCatalogModule;
  try {
    [parametersModule, inputModule, promptModule, profileModule, bmpModule, selectedCatalogModule] = await Promise.all([
      importPacked("dist/src/application/owner-wan-image-parameters.js"),
      importPacked("dist/src/application/owner-wan-image-input-validator.js"),
      importPacked("dist/src/application/owner-wan-image-prompt.js"),
      importPacked("dist/src/application/owner-wan-image-source-profile.js"),
      importPacked("dist/src/application/owner-wan-bmp-inspector.js"),
      importPacked("dist/src/catalog/selected-discovery-catalog.js")
    ]);
  } catch { fail("INSTALLED_WAN_MODULE_IMPORT_FAILED"); }

  const descriptor = parametersModule.getOwnerWanImageSourceParameters();
  const selected = selectedCatalogModule.loadSelectedDiscoveryCatalog(CATALOG_VERSION, join(installedPackagePath, "catalog"));
  const profiles = VARIANTS.map((variant) => profileModule.getOwnerWanImageSourceProfile(variant, selected.discoveryCatalog, CATALOG_VERSION));
  const normalized = VARIANTS.map((variant) => parametersModule.normalizeOwnerWanImageParameters(sample(variant)));
  const inputPolicy = inputModule.OWNER_WAN_IMAGE_INPUT_POLICY;
  const promptSamples = VARIANTS.map((variant) => promptModule.normalizeOwnerWanImagePrompt({ variant, prompt: "WAN package admission" }));
  const promptMetric = promptModule.normalizeOwnerWanImagePrompt({ variant: "wan_27_image", prompt: "😀\nX" });
  const limits = bmpModule.inspectBoundedOwnerWanBmp(createOnePixelBmp());

  assertWanAdmissionSnapshot({ descriptor, profiles, normalized, inputPolicy, promptSamples, promptMetric, bmpLimits: limits });
  const child = await assertNoDedicatedWanImageTools(installedPackagePath, consumerPath);
  return Object.freeze({
    variants: VARIANTS.length, parameter_fields: PARAMETER_KEYS.length, profile_count: profiles.length,
    input_mime_types: inputPolicy.source_mime_types.length, bmp_fixture: "STRUCTURAL_ONLY",
    sdk_operations: Object.freeze(["initialize", "tools/list", "close"]), provider_calls: 0, auth_calls: 0,
    dedicated_wan_image_tools: 0, dispatch_allowed: false,
    child_close: child.child_close, child_pid_null: child.child_pid_null, child_stderr_bytes: child.stderr_bytes
  });
}

/** Checks the actual installed owner's default and explicit opt-in WAN tools/list surfaces. */
export async function assertInstalledWanNativeStdioSurface(installedPackagePath, consumerPath, packagedPaths) {
  assertWanNativePackagePaths(packagedPaths);
  const defaultResult = await listInstalledWanTools(installedPackagePath, consumerPath, {}, false);
  const optedInResult = await listInstalledWanTools(installedPackagePath, consumerPath,
    { SYNTX_OWNER_WAN_IMAGE_REFERENCES: "1" }, true);
  return Object.freeze({
    default_tools: defaultResult.wan_tool_count,
    opt_in_tools: optedInResult.wan_tool_count,
    schemas: "PASS",
    sdk_operations: Object.freeze(["initialize", "tools/list", "close"]),
    default_child_close: "CLOSED",
    opt_in_child_close: "CLOSED",
    default_child_pid_null: true,
    opt_in_child_pid_null: true,
    default_stderr_bytes: defaultResult.stderr_bytes,
    opt_in_stderr_bytes: optedInResult.stderr_bytes,
    provider_calls: 0,
    auth_calls: 0
  });
}

export function assertWanNativePackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_WAN_NATIVE_PACKAGE_PATHS_INVALID");
  if (NATIVE_PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) fail("INSTALLED_WAN_NATIVE_PACKAGE_CONTENT_MISSING");
  return true;
}

async function listInstalledWanTools(installedPackagePath, consumerPath, env, enabled) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"), import("@modelcontextprotocol/sdk/client/stdio.js")
  ]);
  const client = new Client({ name: enabled ? "syntx-installed-wan-opt-in" : "syntx-installed-wan-default", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")],
    cwd: consumerPath,
    env: { ...env },
    stderr: "pipe"
  });
  let closedObserved = false;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  const previousOnClose = transport.onclose;
  transport.onclose = () => {
    closedObserved = true;
    try { previousOnClose?.(); } finally { resolveClosed(true); }
  };
  let stderrBytes = 0;
  transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  let connected = false;
  let failure;
  let result;
  try {
    await withinDeadline(client.connect(transport), 5_500, "INSTALLED_WAN_NATIVE_STDIO_INITIALIZE_TIMEOUT");
    connected = true;
    const initialPid = transport.pid;
    if (!Number.isSafeInteger(initialPid) || initialPid <= 0) fail("INSTALLED_WAN_NATIVE_STDIO_PID_INVALID");
    const listed = await withinDeadline(client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }),
      5_500, "INSTALLED_WAN_NATIVE_TOOLS_LIST_TIMEOUT");
    result = assertWanImageToolSurface(listed.tools, enabled);
  } catch (error) {
    failure = error instanceof WanAdmissionSmokeError ? error : new WanAdmissionSmokeError("INSTALLED_WAN_NATIVE_TOOLS_LIST_FAILED");
  } finally {
    try {
      await withinDeadline(connected ? client.close() : transport.close(), 2_000, "INSTALLED_WAN_NATIVE_STDIO_CLOSE_FAILED");
    } catch { failure ??= new WanAdmissionSmokeError("INSTALLED_WAN_NATIVE_STDIO_CLOSE_FAILED"); }
    try { await withinDeadline(closed, 2_000, "INSTALLED_WAN_NATIVE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new WanAdmissionSmokeError("INSTALLED_WAN_NATIVE_STDIO_CLOSE_FAILED"); }
    if (!closedObserved || transport.pid !== null) failure ??= new WanAdmissionSmokeError("INSTALLED_WAN_NATIVE_STDIO_CLOSE_FAILED");
  }
  if (failure) throw failure;
  return Object.freeze({ wan_tool_count: result.wan_tool_count, stderr_bytes: stderrBytes });
}

/** Strictly validates only WAN's four tools; neighboring installed tools remain allowed. */
export function assertWanImageToolSurface(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_WAN_NATIVE_TOOLS_LIST_INVALID");
  const names = tools.filter((tool) => NATIVE_TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length !== 0) fail("INSTALLED_WAN_NATIVE_DEFAULT_OFF_FAILED");
    return Object.freeze({ wan_tool_count: 0 });
  }
  if (names.length !== NATIVE_TOOL_NAMES.length ||
      NATIVE_TOOL_NAMES.some((name) => names.filter((item) => item === name).length !== 1)) {
    fail("INSTALLED_WAN_NATIVE_TOOL_SET_MISMATCH");
  }
  const byName = new Map(tools.filter((tool) => NATIVE_TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const [upload, generate, reconcile, list] = NATIVE_TOOL_NAMES.map((name) => byName.get(name));
  const attemptPattern = "^link_[A-Za-z0-9_-]{20,120}$";
  const referencePattern = "^wan_image_[0-9a-f-]{36}$";
  const recoveryPattern = "^wan_image_recovery_[0-9a-f-]{36}$";
  const mimeInput = schemaProperties(upload.inputSchema).mime_type;
  const uploadInput = schemaProperties(upload.inputSchema);
  const generateInput = schemaProperties(generate.inputSchema);
  const parameterProperties = schemaProperties(generateInput.parameters);
  const uploadOutput = schemaProperties(upload.outputSchema);
  const generationOutput = schemaProperties(generate.outputSchema);
  const listOutput = schemaProperties(list.outputSchema);
  const recoveryItem = listOutput.recoveries?.items;
  const diagnostic = schemaProperties(recoveryItem).diagnostic;
  assertStrictObject(upload.inputSchema, ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"], [], "INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
  assertStrictObject(generate.inputSchema, ["link_attempt_id", "variant", "reference_handles", "parameters", "prompt", "bbox_coordinate_policy"], [], "INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
  assertStrictObject(generateInput.parameters, NATIVE_PARAMETER_KEYS, [], "INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
  assertStrictObject(reconcile.inputSchema, ["link_attempt_id", "recovery_id"], [], "INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
  assertStrictObject(list.inputSchema, ["link_attempt_id"], ["limit"], "INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
  assertStrictObject(generate.outputSchema, ["status", "backend_acceptance", "ai_name", "model_id", "variant", "operation_id", "profile_id",
    "profile_schema_hash", "catalog_version", "request_fingerprint", "parameters", "cost_inputs", "cost_input_confidence", "requested_batch_size",
    "bbox_coordinate_policy", "reference_count", "input_images", "artifacts", "expected_output_geometry", "geometry_verified"], [], "INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
  assertStrictObject(generationOutput.cost_inputs, ["batch_size"], [], "INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
  assertStrictObject(upload.outputSchema, ["status", "reference_handle", "variant", "original_mime_type", "mime_type", "width", "height", "size",
    "sha256", "expires_in_seconds", "metadata_confidence", "coordinate_projection"], [], "INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
  assertStrictObject(list.outputSchema, ["recoveries", "confidence_scope"], [], "INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
  for (const candidate of [upload, generate, reconcile, list]) {
    assertStrictOutput(candidate.outputSchema, "INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
    assertAllObjectsStrict(candidate.inputSchema, "INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
    assertAllObjectsStrict(candidate.outputSchema, "INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
  }
  if (uploadInput.link_attempt_id?.pattern !== attemptPattern ||
      generateInput.link_attempt_id?.pattern !== attemptPattern ||
      !sameArray(uploadInput.variant?.enum, NATIVE_VARIANTS) || !sameArray(generateInput.variant?.enum, NATIVE_VARIANTS) ||
      !sameArray(mimeInput?.enum, NATIVE_SOURCE_MIME_TYPES) ||
      uploadInput.content_base64?.minLength !== 4 ||
      uploadInput.content_base64?.maxLength !== Math.ceil((20 * 1024 * 1024) / 3) * 4 ||
      uploadInput.content_base64?.pattern !== "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" ||
      !String(uploadInput.filename?.description ?? "").includes("255 UTF-8 bytes") ||
      !String(uploadInput.filename?.description ?? "").includes("Local paths and URLs are not accepted") ||
      !sameArray(uploadOutput.variant?.enum, NATIVE_VARIANTS) ||
      !sameArray(uploadOutput.original_mime_type?.enum, NATIVE_SOURCE_MIME_TYPES) ||
      !sameArray(uploadOutput.mime_type?.enum, NATIVE_CANONICAL_MIME_TYPES) ||
      uploadOutput.reference_handle?.pattern !== referencePattern ||
      uploadOutput.metadata_confidence?.const !== "CONTAINER_METADATA_ONLY") fail("INSTALLED_WAN_NATIVE_SCHEMA_INVALID");

  if (generateInput.reference_handles?.items?.pattern !== referencePattern ||
      generateInput.reference_handles?.type !== "array" || generateInput.reference_handles.maxItems !== 9 ||
      !sameAnyOfConstants(generateInput.bbox_coordinate_policy, [NATIVE_COORDINATE_POLICY, null]) ||
      !sameAnyOfConstants(generationOutput.bbox_coordinate_policy, [NATIVE_COORDINATE_POLICY, null]) ||
      !String(generateInput.bbox_coordinate_policy?.description ?? "").includes("browser-natural dimensions") ||
      generateInput.prompt?.type !== "string" ||
      !String(generateInput.prompt.description ?? "").includes("UTF-16 code units plus LF count") ||
      !String(generateInput.prompt.description ?? "").includes("preserve the original, do not clip")) fail("INSTALLED_WAN_NATIVE_SCHEMA_INVALID");

  const ratiosByVariant = {
    wan_25_i2i_preview: ["1:1", "3:4", "4:3", "9:16", "16:9"],
    wan_26_image: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
    wan_27_image: ["1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    wan_27_image_pro: ["1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
  };
  const resolutionsByVariant = {
    wan_25_i2i_preview: ["720P"], wan_26_image: ["720P", "1080P"],
    wan_27_image: ["1K", "2K"], wan_27_image_pro: ["1K", "2K", "4K"]
  };
  if (!sameArray(parameterProperties.aspect_ratio?.enum, NATIVE_RATIOS) ||
      !sameArray(parameterProperties.resolution?.enum, NATIVE_RESOLUTIONS) ||
      !isIntegerRange(parameterProperties.batch_size, 1, 4) || parameterProperties.prompt_extend?.type !== "boolean" ||
      !isNullableIntegerRange(parameterProperties.seed, 0, 2_147_483_647) ||
      !isPaletteSchema(parameterProperties.color_palette) || !isBboxSchema(parameterProperties.bbox_list) ||
      Object.keys(ratiosByVariant).length !== NATIVE_VARIANTS.length || Object.keys(resolutionsByVariant).length !== NATIVE_VARIANTS.length ||
      !sameArray([...new Set(Object.values(ratiosByVariant).flat())], NATIVE_RATIOS) ||
      !sameArray([...new Set(Object.values(resolutionsByVariant).flat())], NATIVE_RESOLUTIONS)) fail("INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
  if (JSON.stringify(generateInput.parameters) !== JSON.stringify(generationOutput.parameters) ||
      !sameArray(generationOutput.model_id?.enum, NATIVE_VARIANTS) || !sameArray(generationOutput.variant?.enum, NATIVE_VARIANTS) ||
      generationOutput.ai_name?.const !== "wan_image" || generationOutput.operation_id?.const !== "generate-image" ||
      generationOutput.profile_id?.const !== "wan-image-source-reviewed-v1") fail("INSTALLED_WAN_NATIVE_SCHEMA_INVALID");

  if (!sameArray(Object.keys(uploadOutput).sort(), ["coordinate_projection", "expires_in_seconds", "height", "metadata_confidence", "mime_type", "original_mime_type", "reference_handle", "sha256", "size", "status", "variant", "width"].sort()) ||
      !isCoordinateProjectionSchema(uploadOutput.coordinate_projection)) fail("INSTALLED_WAN_NATIVE_UPLOAD_RECEIPT_SCHEMA_INVALID");
  if (generationOutput.backend_acceptance?.const !== "unproven" || generationOutput.status?.const !== "result_observed" ||
      generationOutput.expected_output_geometry?.type !== "null" || generationOutput.geometry_verified?.const !== false) fail("INSTALLED_WAN_NATIVE_RESULT_CONFIDENCE_SCHEMA_INVALID");
  if (!isInputImagesSchema(generationOutput.input_images)) fail("INSTALLED_WAN_NATIVE_PUBLIC_INPUT_SCHEMA_INVALID");
  if (!isArtifactArraySchema(generationOutput.artifacts)) fail("INSTALLED_WAN_NATIVE_ARTIFACT_SCHEMA_INVALID");
  if (generationOutput.reference_count?.maximum !== 9 || generationOutput.requested_batch_size?.minimum !== 1 ||
      generationOutput.requested_batch_size?.maximum !== 4 || generationOutput.cost_inputs?.properties?.batch_size?.maximum !== 4 ||
      !String(generate.description ?? "").includes("Cost inputs contain batch_size only")) fail("INSTALLED_WAN_NATIVE_BATCH_SCHEMA_INVALID");
  if (!String(generate.description ?? "").includes("do not retry")) fail("INSTALLED_WAN_NATIVE_RETRY_DESCRIPTION_INVALID");

  if (!isClosedDiagnosticSchema(diagnostic)) fail("INSTALLED_WAN_NATIVE_DIAGNOSTIC_SCHEMA_INVALID");
  if (listOutput.confidence_scope?.const !== NATIVE_RECOVERY_SCOPE ||
      listOutput.recoveries?.type !== "array" || listOutput.recoveries.maxItems !== 20) fail("INSTALLED_WAN_NATIVE_RECOVERY_SCHEMA_INVALID");
  if (recoveryItem?.properties?.recovery_id?.pattern !== recoveryPattern ||
      !sameArray(Object.keys(recoveryItem?.properties ?? {}).sort(), ["created_at", "diagnostic", "model_id", "operation_id", "recovery_id", "status"].sort()) ||
      !sameArray(Array.isArray(recoveryItem.required) ? [...recoveryItem.required].sort() : null,
        ["created_at", "diagnostic", "model_id", "operation_id", "recovery_id", "status"].sort())) fail("INSTALLED_WAN_NATIVE_RECOVERY_ITEM_SCHEMA_INVALID");
  if (recoveryItem.properties.operation_id?.const !== "generate-image" || recoveryItem.properties.status?.const !== "OUTCOME_UNKNOWN") fail("INSTALLED_WAN_NATIVE_RECOVERY_ITEM_SCOPE_INVALID");
  if (!sameArray(recoveryItem.properties.model_id?.enum, NATIVE_VARIANTS)) fail("INSTALLED_WAN_NATIVE_RECOVERY_MODEL_ENUM_INVALID");
  if (!String(reconcile.description ?? "").includes("GET-only") ||
      !String(reconcile.description ?? "").includes("process-local") ||
      !String(list.description ?? "").includes("process-local")) fail("INSTALLED_WAN_NATIVE_RECOVERY_DESCRIPTION_INVALID");

  const expectedAnnotations = [
    { title: "Upload a WAN image reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    { title: "Generate images with WAN", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    { title: "Reconcile a WAN image outcome", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    { title: "List WAN image recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  ];
  for (let index = 0; index < NATIVE_TOOL_NAMES.length; index += 1) {
    if (!sameRecord(byName.get(NATIVE_TOOL_NAMES[index]).annotations, expectedAnnotations[index])) fail("INSTALLED_WAN_NATIVE_ANNOTATIONS_INVALID");
  }
  return Object.freeze({ wan_tool_count: names.length });
}

export function assertWanAdmissionPackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_WAN_PACKAGE_PATHS_INVALID");
  const missing = EXPECTED_PATHS.filter((path) => !packagedPaths.has(path));
  if (missing.length) fail("INSTALLED_WAN_PACKAGE_CONTENT_MISSING");
}

/** Pure contract assertion kept separate so focused MJS tests can exercise rejection cases. */
export function assertWanAdmissionSnapshot(snapshot) {
  const { descriptor, profiles, normalized, inputPolicy, promptSamples, promptMetric, bmpLimits } = snapshot ?? {};
  if (!isRecord(descriptor) || !sameArray(descriptor.variants, VARIANTS) ||
      !sameArray(Object.keys(descriptor.controls ?? {}), CONTROL_KEYS) ||
      !sameRecord(descriptor.controls?.aspect_ratio?.variants, RATIOS) ||
      !sameRecord(descriptor.controls?.resolution?.variants, RESOLUTIONS) ||
      !sameRecord(descriptor.reference_limits, COUNTS) ||
      descriptor.controls?.batch_size?.kind !== "integer" || descriptor.controls.batch_size.range?.minimum !== 1 || descriptor.controls.batch_size.range?.maximum !== 4 ||
      descriptor.controls?.prompt_extend?.kind !== "boolean" || descriptor.controls?.seed?.kind !== "nullable_integer" ||
      descriptor.controls.seed.minimum !== 0 || descriptor.controls.seed.maximum !== 2_147_483_647 ||
      descriptor.controls?.bbox_list?.kind !== "ordered_per_reference_rectangles" || descriptor.controls.bbox_list.rectangles_per_reference?.minimum !== 0 || descriptor.controls.bbox_list.rectangles_per_reference?.maximum !== 2 ||
      descriptor.controls.bbox_list.active_by_variant?.wan_25_i2i_preview !== false || descriptor.controls.bbox_list.active_by_variant?.wan_26_image !== false ||
      descriptor.controls.bbox_list.active_by_variant?.wan_27_image !== true || descriptor.controls.bbox_list.active_by_variant?.wan_27_image_pro !== true ||
      descriptor.controls?.color_palette?.kind !== "nullable_palette" || descriptor.controls.color_palette.colors?.minimum !== 3 || descriptor.controls.color_palette.colors?.maximum !== 10 ||
      descriptor.controls.color_palette.active_by_variant?.wan_25_i2i_preview !== false || descriptor.controls.color_palette.active_by_variant?.wan_26_image !== false ||
      descriptor.controls.color_palette.active_by_variant?.wan_27_image !== true || descriptor.controls.color_palette.active_by_variant?.wan_27_image_pro !== true ||
      descriptor.conditions?.wan_27_image_pro_4k !== "REJECT_WHEN_REFERENCE_COUNT_IS_NONZERO; NEVER_COERCE_TO_2K" ||
      !sameArray(descriptor.cost_boundary?.declared_cost_metadata_keys, ["size", "batch_size"]) ||
      !sameArray(descriptor.cost_boundary?.effective_cost_input_keys, ["batch_size"]) ||
      descriptor.cost_boundary?.size !== "NO_CONTROLLED_VALUE; OMITTED_BY_SOURCE_SERIALIZER" ||
      descriptor.dispatch_allowed !== false || descriptor.runtime_activation !== false || descriptor.backend_acceptance !== "UNPROVEN") fail("INSTALLED_WAN_PARAMETER_DESCRIPTOR_MISMATCH");

  if (!Array.isArray(profiles) || profiles.length !== VARIANTS.length || !Array.isArray(normalized) || normalized.length !== VARIANTS.length ||
      !Array.isArray(promptSamples) || promptSamples.length !== VARIANTS.length) fail("INSTALLED_WAN_VARIANT_COVERAGE_MISMATCH");
  for (let index = 0; index < VARIANTS.length; index += 1) {
    const variant = VARIANTS[index];
    const profile = profiles[index];
    const result = normalized[index];
    const prompt = promptSamples[index];
    if (!isRecord(profile) || profile.variant !== variant || profile.model_id !== variant || profile.model_type !== variant || profile.ai_name !== "wan_image" ||
        profile.public_catalog_version !== CATALOG_VERSION || profile.profile_id !== "wan-image-source-reviewed-v1" ||
        !Number.isSafeInteger(profile.reference_count?.maximum) || profile.reference_count.maximum !== COUNTS[variant].maximum ||
        !sameArray(profile.parameters_source?.parameter_keys, PARAMETER_KEYS) ||
        !sameArray(profile.mime_policy?.source_values, ["image/png", "image/jpg", "image/jpeg", "image/bmp", "image/webp"]) ||
        !sameArray(profile.mime_policy?.canonical_values, ["image/png", "image/jpeg", "image/bmp", "image/webp"]) ||
        profile.prompt_policy?.unit !== "JS_UTF16_CODE_UNITS_PLUS_LF_COUNT" || profile.prompt_policy.maximum_units !== (variant.startsWith("wan_27") ? 5000 : 1500) ||
        profile.prompt_policy?.source_behavior !== "UI_CLIPS_OVER_BUDGET; LOCAL_NORMALIZER_REJECTS" || profile.prompt_policy?.backend_semantics !== "UNPROVEN" ||
        !sameArray(profile.cost_policy?.declared_metadata_keys, ["size", "batch_size"]) ||
        !sameArray(profile.cost_policy?.controlled_inputs, ["batch_size"]) || profile.cost_policy?.size_policy !== "OMITTED_NO_RESOLUTION_ALIAS" ||
        profile.dispatch_allowed !== false || profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN" ||
        profile.effective_defaults !== "UNKNOWN" || profile.output_batch_cardinality !== "UNPROVEN" ||
        !isRecord(result) || result.variant !== variant || !sameArray(Object.keys(result.parameters ?? {}), PARAMETER_KEYS) ||
        !sameRecord(result.cost_inputs, { batch_size: 1 }) || result.cost_input_confidence !== "SOURCE_JOINED_BATCH_SIZE_ONLY" ||
        result.cost_boundary !== "NO_SIZE_CONTROL_OR_RESOLUTION_MAPPING" || result.dispatch_allowed !== false || result.runtime_activation !== false || result.backend_acceptance !== "UNPROVEN" ||
        !isRecord(prompt) || prompt.variant !== variant || prompt.prompt !== "WAN package admission" ||
        prompt.length_units !== 21 || prompt.maximum_units !== profile.prompt_policy.maximum_units ||
        prompt.unit !== "JS_UTF16_CODE_UNITS_PLUS_LF_COUNT" || prompt.backend_limit !== "UNPROVEN") fail("INSTALLED_WAN_PROFILE_OR_NORMALIZER_MISMATCH");
  }
  if (!isRecord(inputPolicy) || !sameArray(inputPolicy.source_mime_types, ["image/png", "image/jpeg", "image/jpg", "image/bmp", "image/webp"]) ||
      inputPolicy.jpg_alias !== "image/jpg -> image/jpeg" || inputPolicy.metadata_confidence !== "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" ||
      inputPolicy.limits_policy !== "LOCAL_GUARD_FROM_SELECTED_CATALOG_NOT_PROVIDER_ACCEPTANCE") fail("INSTALLED_WAN_INPUT_POLICY_MISMATCH");
  if (!sameRecord(inputPolicy.variants, {
        wan_25_i2i_preview: { max_bytes: 10_485_760, min_dimension: 384, max_dimension: 5_000 },
        wan_26_image: { max_bytes: 10_485_760, min_dimension: 384, max_dimension: 5_000 },
        wan_27_image: { max_bytes: 20_971_520, min_dimension: 240, max_dimension: 8_000 },
        wan_27_image_pro: { max_bytes: 20_971_520, min_dimension: 240, max_dimension: 8_000 }
      })) fail("INSTALLED_WAN_INPUT_LIMITS_MISMATCH");
  if (!sameRecord(bmpLimits, { width: 1, height: 1 })) fail("INSTALLED_WAN_BMP_INSPECTOR_MISMATCH");
  if (!isRecord(promptMetric) || promptMetric.length_units !== 5 || promptMetric.unit !== "JS_UTF16_CODE_UNITS_PLUS_LF_COUNT" ||
      promptMetric.prompt !== "😀\nX") fail("INSTALLED_WAN_PROMPT_LENGTH_METRIC_MISMATCH");
  return true;
}

function sample(variant) {
  const ratio = RATIOS[variant][0];
  const resolution = RESOLUTIONS[variant][0];
  const references = COUNTS[variant].minimum;
  return { variant, reference_count: references, parameters: {
    aspect_ratio: ratio, resolution, batch_size: 1, prompt_extend: false, seed: null,
    color_palette: variant.startsWith("wan_27") ? null : null,
    bbox_list: Array.from({ length: references }, () => [])
  } };
}

async function assertNoDedicatedWanImageTools(installedPackagePath, consumerPath) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"), import("@modelcontextprotocol/sdk/client/stdio.js")
  ]);
  const client = new Client({ name: "syntx-installed-wan-admission", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")],
    cwd: consumerPath, env: {}, stderr: "pipe"
  });
  let closeObserved = false;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  const priorOnClose = transport.onclose;
  transport.onclose = () => { closeObserved = true; try { priorOnClose?.(); } finally { resolveClosed(true); } };
  let stderrBytes = 0;
  transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  let failure;
  try {
    await withinDeadline(client.connect(transport), 5_500, "INSTALLED_WAN_STDIO_INITIALIZE_TIMEOUT");
    const listed = await withinDeadline(client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }), 5_500, "INSTALLED_WAN_TOOLS_LIST_TIMEOUT");
    const names = (listed.tools ?? []).map((tool) => tool.name);
    if (names.some((name) => /wan[_-]image/iu.test(name))) fail("INSTALLED_WAN_IMAGE_TOOL_ADVERTISED");
  } catch (error) {
    failure = error instanceof WanAdmissionSmokeError ? error : new WanAdmissionSmokeError("INSTALLED_WAN_TOOLS_LIST_FAILED");
  } finally {
    try { await withinDeadline(client.close(), 2_000, "INSTALLED_WAN_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new WanAdmissionSmokeError("INSTALLED_WAN_STDIO_CLOSE_FAILED"); }
    try { await withinDeadline(closed, 2_000, "INSTALLED_WAN_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new WanAdmissionSmokeError("INSTALLED_WAN_STDIO_CLOSE_FAILED"); }
    if (!closeObserved || transport.pid !== null) failure ??= new WanAdmissionSmokeError("INSTALLED_WAN_STDIO_CLOSE_FAILED");
  }
  if (failure) throw failure;
  return Object.freeze({ child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes });
}

function createOnePixelBmp() {
  const bytes = Buffer.alloc(58);
  bytes.write("BM", 0, "ascii"); bytes.writeUInt32LE(58, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(1, 18); bytes.writeInt32LE(1, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(0, 30);
  bytes.writeUInt32LE(4, 34); return bytes;
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function sameArray(actual, expected) { return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected); }
function sameRecord(actual, expected) { return isRecord(actual) && JSON.stringify(actual) === JSON.stringify(expected); }
async function withinDeadline(promise, milliseconds, code) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new WanAdmissionSmokeError(code)), milliseconds); })
    ]);
  } finally { clearTimeout(timer); }
}
function fail(code) { throw new WanAdmissionSmokeError(code); }

function schemaProperties(schema) {
  if (!isRecord(schema) || !isRecord(schema.properties)) fail("INSTALLED_WAN_NATIVE_SCHEMA_INVALID");
  return schema.properties;
}
function assertStrictObject(schema, required, optional, code) {
  const properties = schemaProperties(schema);
  if (schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(properties).sort(), [...required, ...optional].sort()) ||
      !sameArray(Array.isArray(schema.required) ? [...schema.required].sort() : null, [...required].sort())) fail(code);
}
function assertStrictOutput(schema, code) {
  if (!isRecord(schema) || schema.type !== "object" || schema.additionalProperties !== false) fail(code);
}
function assertAllObjectsStrict(value, code) {
  if (Array.isArray(value)) { for (const item of value) assertAllObjectsStrict(item, code); return; }
  if (!isRecord(value)) return;
  if (value.type === "object" && value.additionalProperties !== false) fail(code);
  for (const child of Object.values(value)) assertAllObjectsStrict(child, code);
}
function hasAnyOf(schema, predicate) { return Array.isArray(schema?.anyOf) && schema.anyOf.some(predicate); }
function sameAnyOfConstants(schema, values) {
  if (!Array.isArray(schema?.anyOf) || schema.anyOf.length !== values.length) return false;
  return values.every((value) => schema.anyOf.some((item) => value === null ? item?.type === "null" : item?.const === value));
}
function isIntegerRange(schema, minimum, maximum) {
  return schema?.type === "integer" && schema.minimum === minimum && schema.maximum === maximum;
}
function isNullableIntegerRange(schema, minimum, maximum) {
  return hasAnyOf(schema, (item) => isIntegerRange(item, minimum, maximum)) && hasAnyOf(schema, (item) => item?.type === "null") && schema.anyOf.length === 2;
}
function isPaletteSchema(schema) {
  const array = schema?.anyOf?.find((item) => item?.type === "array");
  const color = array?.items;
  const properties = isRecord(color?.properties) ? color.properties : {};
  return schema?.anyOf?.length === 2 && schema.anyOf.some((item) => item?.type === "null") &&
    array?.minItems === 3 && array.maxItems === 10 && color?.type === "object" && color.additionalProperties === false &&
    sameArray(Object.keys(properties).sort(), ["hex", "ratio"]) && properties.hex?.pattern === "^#[0-9A-F]{6}$" &&
    properties.ratio?.pattern === "^(?:100|[1-9]\\d?)\\.00%$";
}
function isBboxSchema(schema) {
  const referenceItems = schema?.items;
  const rectangle = referenceItems?.items;
  return schema?.type === "array" && schema.maxItems === 9 && referenceItems?.type === "array" &&
    referenceItems.maxItems === 2 && rectangle?.type === "array" && rectangle.minItems === 4 && rectangle.maxItems === 4 &&
    rectangle.additionalItems === false && Array.isArray(rectangle.items) && rectangle.items.length === 4 &&
    rectangle.items.every((item) => item?.type === "integer" && item.minimum === 0 && item.maximum === Number.MAX_SAFE_INTEGER);
}
function isCoordinateProjectionSchema(schema) {
  if (!isRecord(schema) || schema.type !== "object" || schema.additionalProperties !== false ||
      !Array.isArray(schema.required) ||
      !sameArray(Object.keys(schema.properties ?? {}).sort(), ["confidence", "orientation", "projected_height", "projected_width"]) ||
      !sameArray([...schema.required].sort(), ["confidence", "orientation", "projected_height", "projected_width"])) return false;
  const nullableBoundedInt = (value, minimum, maximum, exclusive = false) => hasAnyOf(value, (item) => item?.type === "null") &&
    hasAnyOf(value, (item) => item?.type === "integer" &&
      (exclusive ? item.exclusiveMinimum === minimum : item.minimum === minimum) && item.maximum === maximum) && value.anyOf.length === 2;
  return nullableBoundedInt(schema.properties.orientation, 1, 8) &&
    nullableBoundedInt(schema.properties.projected_width, 0, 0xffff_ffff, true) &&
    nullableBoundedInt(schema.properties.projected_height, 0, 0xffff_ffff, true) &&
    sameArray(schema.properties.confidence?.enum, ["HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE", "UNSUPPORTED_OR_MALFORMED_METADATA"]);
}
function isInputImagesSchema(schema) {
  const image = schema?.items;
  const properties = image?.properties;
  return schema?.type === "array" && schema.maxItems === 9 && image?.type === "object" && image.additionalProperties === false && Array.isArray(image.required) &&
    sameArray(Object.keys(properties ?? {}).sort(), ["height", "metadata_confidence", "mime_type", "sha256", "size", "width"]) &&
    sameArray([...image.required].sort(), ["height", "metadata_confidence", "mime_type", "sha256", "size", "width"]) &&
    sameArray(properties.mime_type?.enum, NATIVE_CANONICAL_MIME_TYPES) && properties.metadata_confidence?.const === "CONTAINER_METADATA_ONLY" &&
    properties.width?.type === "integer" && properties.width.exclusiveMinimum === 0 &&
    properties.height?.type === "integer" && properties.height.exclusiveMinimum === 0 &&
    properties.size?.exclusiveMinimum === 0 && properties.size?.maximum === 20 * 1024 * 1024 &&
    properties.sha256?.pattern === "^sha256:[a-f0-9]{64}$";
}
function isArtifactArraySchema(schema) {
  const artifact = schema?.items;
  const properties = artifact?.properties;
  return schema?.type === "array" && schema.minItems === 1 && schema.maxItems === 4 && artifact?.type === "object" && artifact.additionalProperties === false && Array.isArray(artifact.required) &&
    sameArray(Object.keys(properties ?? {}).sort(), ["geometry_verified", "height", "mime_source", "mime_type", "url", "width"]) &&
    sameArray([...artifact.required].sort(), ["geometry_verified", "height", "mime_source", "mime_type", "url", "width"]) &&
    properties.url?.format === "uri" && hasAnyOf(properties.mime_type, (item) => item?.type === "null") &&
    hasAnyOf(properties.mime_type, (item) => item?.pattern === "^image\\/[a-z0-9.+-]{1,64}$") &&
    sameArray(properties.mime_source?.enum, ["URL_EXTENSION", "UNKNOWN"]) && properties.width?.type === "null" &&
    properties.height?.type === "null" && properties.geometry_verified?.const === false;
}
function isClosedNullableEnum(schema, values) {
  return hasAnyOf(schema, (item) => item?.type === "null") && hasAnyOf(schema, (item) => sameArray(item?.enum, values)) && schema.anyOf.length === 2;
}
function isClosedDiagnosticSchema(schema) {
  const properties = schema?.properties;
  const expected = ["echo_ack_known", "history_binding", "history_binding_reason", "history_get_calls", "history_get_calls_saturated",
    "inprogress_get_calls", "inprogress_get_calls_saturated", "phase", "post_started", "result_get_calls",
    "result_get_calls_saturated", "result_reason", "result_status"];
  const historyReasons = ["INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
    "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE", "MESSAGE_CHAT_MISMATCH",
    "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH", "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID",
    "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS", "BOT_OBJECTS_INVALID", "BOT_MODEL_MISMATCH", "BOT_BATCH_EXCEEDS_REQUEST", "BOT_BATCH_PENDING"];
  const resultReasons = ["NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESULT_BATCH_PENDING", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH",
    "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH",
    "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE", "RESULT_OBJECT_DUPLICATE"];
  return isRecord(schema) && schema.type === "object" && schema.additionalProperties === false &&
    Array.isArray(schema.required) &&
    sameArray(Object.keys(properties ?? {}).sort(), expected.sort()) && sameArray([...schema.required].sort(), expected.sort()) &&
    sameArray(properties.phase?.enum, NATIVE_DIAGNOSTIC_PHASES) && sameArray(properties.history_binding?.enum, NATIVE_HISTORY_BINDINGS) &&
    isClosedNullableEnum(properties.history_binding_reason, historyReasons) &&
    ["post_started", "echo_ack_known", "history_get_calls_saturated", "inprogress_get_calls_saturated", "result_get_calls_saturated"]
      .every((key) => properties[key]?.type === "boolean") &&
    ["history_get_calls", "inprogress_get_calls", "result_get_calls"].every((key) => isIntegerRange(properties[key], 0, 255)) &&
    sameArray(properties.result_status?.enum, NATIVE_RESULT_STATUSES) && isClosedNullableEnum(properties.result_reason, resultReasons);
}
