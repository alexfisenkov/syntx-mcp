import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class UniImageInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "UniImageInstalledCheckError"; this.code = code; }
}

const MODELS = Object.freeze(["uni-1", "uni-1.1-modify-image", "uni-1.1-remove-background"]);
const TOOL_NAMES = Object.freeze(["syntx_upload_uni_image_reference", "syntx_owner_generate_uni_image",
  "syntx_owner_reconcile_uni_image", "syntx_owner_list_uni_image_recoveries"]);
const AUTO_RATIOS = Object.freeze(["3:1", "2:1", "16:9", "3:2", "1:1", "4:3", "2:3", "3:4", "9:16", "1:2", "1:3"]);
const MANGA_RATIOS = Object.freeze(["9:16", "2:3", "1:2", "1:3"]);
const MODES = Object.freeze(["auto", "manga"]);
const SEEDS = Object.freeze([null, 0, 2_147_483_647]);
const INPUT_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"]);
const MODEL_HASHES = Object.freeze({
  "uni-1": "sha256:9c095d9bc71d214d8005b55038a4212f7b19fb3fb9255fe3b8c0e8d24ab7b02d",
  "uni-1.1-modify-image": "sha256:61fab99d9e121bc9e29742a071e328dc4ee2a9c5140472f2d2025fb4ce538796",
  "uni-1.1-remove-background": "sha256:88ac8c582d2ebbb3c65866c38b9638eaef1d1c1df1855ecf096b5c61575fd96c"
});
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const GENERATION_PHASES = Object.freeze(["REQUEST_PREPARE", "PRINCIPAL", "ASSET_ISSUE", "CANDIDATE_PREPARE", "PREFLIGHT", "CHAT_CREATE",
  "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"]);
const GENERATION_ERROR_CODES = Object.freeze(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
  "REFERENCE_ALREADY_CLAIMED", "ASSET_UNAVAILABLE", "PREFLIGHT_FAILED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"]);
const HISTORY_REASONS = Object.freeze(["HISTORY_SHAPE_INVALID", "CHAT_SCOPE_MISMATCH", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_AMBIGUOUS",
  "OWNER_INPUT_OBJECTS_MISMATCH", "HISTORY_MESSAGE_SET_INVALID", "RESULT_MESSAGE_NOT_FOUND", "RESULT_MESSAGE_AMBIGUOUS",
  "RESULT_OBJECTS_INVALID", "RESULT_OBJECTS_OVER_LIMIT", "PROFILE_BINDING_INVALID"]);
const RESULT_REASONS = Object.freeze(["NO_RESULT_OBJECTS", "NO_COMPLETED_RESULT_OBJECTS", "OBSERVED_RESULT_OBJECTS_PARTIAL", "SOME_RESULTS_NOT_COMPLETED",
  "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "RESULT_OBJECT_SHAPE_INVALID",
  "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH",
  "RESULT_URL_UNSAFE", "EXTRANEOUS_RESULT_OBJECTS", "DUPLICATE_RESULT_OBJECT_ID"]);
const ATTEMPT_PATTERN = "^link_[A-Za-z0-9_-]{20,120}$";
const HANDLE_PATTERN = "^uni_image_[0-9a-f-]{36}$";
const RECOVERY_PATTERN = "^uni_image_recovery_[0-9a-f-]{36}$";
const MAX_BYTES = 26_214_400;
const SOURCE_MODULES = Object.freeze([
  "application/owner-uni-image-parameters", "application/owner-uni-image-source-profile",
  "application/owner-uni-image-input-validator", "application/owner-uni-image-upload-service",
  "application/owner-uni-image-request-preparer", "application/owner-uni-image-one-shot-policy",
  "application/owner-uni-image-history-binding", "application/owner-uni-image-generation-service",
  "application/account-status", "application/model-access", "catalog/owner-uni-image-upload-profile",
  "catalog/selected-discovery-catalog", "catalog/public-catalog-history", "mcp/owner-uni-image-tools",
  "mcp/server", "runtime/observed-owner-runtime", "transports/stdio-owner", "adapter/syntx/chat-http-client",
  "adapter/syntx/owner-uni-image-result", "adapter/syntx/account-decoder", "adapter/syntx/upload-reference-bridge",
  "adapter/syntx/request-deadline", "auth/owner-reference-principal"
]);
const PACKAGE_PATHS = Object.freeze(["dist/src/index.js", "dist/src/index.d.ts",
  ...SOURCE_MODULES.flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`])]);
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const CHECK_PHASES = Object.freeze(["package-paths", "node-runtime", "module-import", "public-exports", "source-contract",
  "declarations", "flag-reader", "stdio-default", "stdio-opt-in"]);

export function assertUniImageNativePackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_UNI_IMAGE_PACKAGE_PATHS_INVALID");
  if (PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) fail("INSTALLED_UNI_IMAGE_PACKAGE_CONTENT_MISSING");
  return true;
}

export function mapUniImageNativeModules(modulePaths, loadedModules) {
  if (!Array.isArray(modulePaths) || !Array.isArray(loadedModules) || modulePaths.length !== loadedModules.length ||
      modulePaths.some((path) => typeof path !== "string") || new Set(modulePaths).size !== modulePaths.length ||
      loadedModules.some((module) => !isRecord(module))) fail("INSTALLED_UNI_IMAGE_MODULE_MAP_INVALID");
  return new Map(modulePaths.map((path, index) => [path, loadedModules[index]]));
}

export function assertUniImageToolNames(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_UNI_IMAGE_TOOLS_LIST_INVALID");
  const names = tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length !== 0) fail("INSTALLED_UNI_IMAGE_DEFAULT_OFF_FAILED");
    return Object.freeze({ uni_image_tool_count: 0 });
  }
  if (names.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => names.filter((item) => item === name).length !== 1)) {
    fail("INSTALLED_UNI_IMAGE_TOOL_SET_MISMATCH");
  }
  return Object.freeze({ uni_image_tool_count: TOOL_NAMES.length });
}

export function assertUniImageDiagnosticEnums(enums) {
  if (!enums || !sameArray(enums.phases, GENERATION_PHASES) || !sameArray(enums.errorCodes, GENERATION_ERROR_CODES) ||
      !sameArray(enums.historyReasons, HISTORY_REASONS) || !sameArray(enums.resultReasons, RESULT_REASONS)) {
    fail("INSTALLED_UNI_IMAGE_DIAGNOSTIC_ENUMS_INVALID");
  }
  return true;
}

export function assertUniImageFlagReader(stdioModule) {
  const reader = stdioModule?.readOwnerUniImageReferencesFlag;
  if (typeof reader !== "function" || reader(undefined) !== false || reader("") !== false || reader("0") !== false || reader("1") !== true) {
    fail("INSTALLED_UNI_IMAGE_FLAG_INVALID");
  }
  for (const value of ["true", "yes", "01", " 1 "]) {
    let rejected = false; try { reader(value); } catch { rejected = true; }
    if (!rejected) fail("INSTALLED_UNI_IMAGE_FLAG_INVALID");
  }
  return true;
}

export function assertUniImagePublicExports(api, modules) {
  const pairs = [
    ["OWNER_UNI_IMAGE_MODELS", "parameters"], ["getOwnerUniImageSourceParameters", "parameters"],
    ["normalizeOwnerUniImageParameters", "parameters"], ["OwnerUniImageParametersError", "parameters"],
    ["getOwnerUniImageSourceProfile", "sourceProfile"], ["OwnerUniImageSourceProfileError", "sourceProfile"],
    ["getOwnerUniImageUploadProfile", "uploadProfile"], ["OwnerUniImageUploadProfileError", "uploadProfile"],
    ["OwnerUniImageUploadService", "upload"], ["OwnerUniImageUploadServiceError", "upload"],
    ["OwnerUniImageGenerationService", "generation"], ["OwnerUniImageGenerationServiceError", "generation"],
    ["createOwnerUniImageGenerationService", "generation"], ["OWNER_UNI_IMAGE_GENERATION_PHASES", "generation"],
    ["OWNER_UNI_IMAGE_GENERATION_ERROR_CODES", "generation"], ["OWNER_UNI_IMAGE_GENERATION_HISTORY_REASONS", "generation"],
    ["OWNER_UNI_IMAGE_GENERATION_RESULT_REASONS", "generation"], ["registerSyntxOwnerUniImageTools", "tools"],
    ["SYNTX_UPLOAD_UNI_IMAGE_REFERENCE_TOOL_NAME", "tools"], ["SYNTX_OWNER_GENERATE_UNI_IMAGE_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_RECONCILE_UNI_IMAGE_TOOL_NAME", "tools"], ["SYNTX_OWNER_LIST_UNI_IMAGE_RECOVERIES_TOOL_NAME", "tools"],
    ["OWNER_UNI_IMAGE_TOOL_NAMES", "tools"], ["createMcpServer", "server"], ["createObservedOwnerRuntime", "runtime"]
  ];
  if (!isRecord(api) || pairs.some(([name, moduleName]) => !isRecord(modules[moduleName]) ||
      typeof api[name] === "undefined" || api[name] !== modules[moduleName][name])) fail("INSTALLED_UNI_IMAGE_PUBLIC_EXPORT_MISMATCH");
  for (const name of ["OwnerUniImagePreparedCandidate", "OwnerUniImageOwnedAssetSet", "OwnerUniImageOneShotPermit",
    "createOwnerUniImageOneShotPermit", "consumeOwnerUniImageOneShotPermit", "getOwnerUniImagePreparedCandidateState",
    "observeOwnerUniImageCandidateClock", "OwnerUniImageOwnedReferenceResolution", "OwnerUniImageReferenceResolverContext",
    "StartUniImageWithOwnedCandidateInput", "OwnerUniImageResultReadContext", "InternalOwnerUniImageResult", "readOwnerUniImageReferencesFlag"]) {
    if (Object.hasOwn(api, name)) fail("INSTALLED_UNI_IMAGE_PRIVATE_EXPORT_LEAK");
  }
  return true;
}

export function assertUniImageDeclarations(declarationText) {
  if (typeof declarationText !== "string") fail("INSTALLED_UNI_IMAGE_DECLARATIONS_INVALID");
  const safeNames = ["OwnerUniImageModel", "OwnerUniImageMode", "OwnerUniImageParametersInput", "OwnerUniImageInputParameters",
    "OwnerUniImageNormalizedParameters", "OwnerUniImageSourceParameters", "OwnerUniImageSourceProfile", "OwnerUniImageSourceProfileCatalogPort",
    "OwnerUniImageModelId", "OwnerUniImageUploadCatalogPort", "OwnerUniImageUploadProfile", "OwnerUniImageUploadSourceMetadata",
    "OwnerUniImageUploadLocalInputPolicy",
    "OwnerUniImageUploadServiceOptions", "OwnerUniImageUploadInput", "OwnerUniImageUploadReceipt", "OwnerUniImageGenerationServiceOptions",
    "OwnerUniImageGenerationPreflightInput", "OwnerUniImageGenerationPreflightResult", "OwnerUniImageGenerationPreflight",
    "OwnerUniImageGenerateInput", "OwnerUniImageReconcileInput", "OwnerUniImageRecoveryListInput", "OwnerUniImageGenerationPhase",
    "OwnerUniImageGenerationResultReason", "OwnerUniImageGenerationResult",
    "OwnerUniImageGenerationArtifact", "OwnerUniImageGenerationDiagnostic", "OwnerUniImageRecoveryListItem",
    "OwnerUniImageGenerationServiceErrorCode", "OwnerUniImageServiceComposition", "RegisterSyntxOwnerUniImageToolsOptions",
    "ObservedOwnerRuntimeOptions"];
  if (safeNames.some((name) => !declarationText.includes(name))) fail("INSTALLED_UNI_IMAGE_DECLARATIONS_INVALID");
  const privateNames = ["OwnerUniImagePreparedCandidate", "OwnerUniImageOwnedAssetSet", "OwnerUniImageOneShotPermit",
    "OwnerUniImageOwnedReferenceResolution", "getOwnerUniImagePreparedCandidateState", "observeOwnerUniImageCandidateClock",
    "StartUniImageWithOwnedCandidateInput", "InternalOwnerUniImageResult"];
  if (privateNames.some((name) => declarationText.includes(`export { ${name}`) || declarationText.includes(`export type { ${name}`))) {
    fail("INSTALLED_UNI_IMAGE_PRIVATE_DECLARATION_LEAK");
  }
  return true;
}

/** Installed-tarball gate; the only child MCP operations are initialize, tools/list, and close. */
export async function assertInstalledUniImageTools(installedPackagePath, consumerPath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertUniImageNativePackagePaths(packagedPaths);
    phase = "node-runtime";
    if (process.versions.node !== "24.21.0") fail("INSTALLED_UNI_IMAGE_NODE24_21_REQUIRED");
    const importPacked = (relativePath) => import(pathToFileURL(join(installedPackagePath, relativePath)).href);
    phase = "module-import";
    let loaded;
    try {
      loaded = await Promise.all([importPacked("dist/src/index.js"), ...SOURCE_MODULES.map((name) => importPacked(`dist/src/${name}.js`))]);
    } catch { fail("INSTALLED_UNI_IMAGE_MODULE_IMPORT_FAILED"); }
    const api = loaded[0]; const mapped = mapUniImageNativeModules(SOURCE_MODULES, loaded.slice(1));
    const moduleFor = (name) => mapped.get(name);
    const modules = {
      parameters: moduleFor("application/owner-uni-image-parameters"),
      sourceProfile: moduleFor("application/owner-uni-image-source-profile"),
      input: moduleFor("application/owner-uni-image-input-validator"),
      upload: moduleFor("application/owner-uni-image-upload-service"),
      preparer: moduleFor("application/owner-uni-image-request-preparer"),
      permit: moduleFor("application/owner-uni-image-one-shot-policy"),
      history: moduleFor("application/owner-uni-image-history-binding"),
      generation: moduleFor("application/owner-uni-image-generation-service"),
      uploadProfile: moduleFor("catalog/owner-uni-image-upload-profile"),
      tools: moduleFor("mcp/owner-uni-image-tools"), server: moduleFor("mcp/server"),
      runtime: moduleFor("runtime/observed-owner-runtime"), stdio: moduleFor("transports/stdio-owner"),
      client: moduleFor("adapter/syntx/chat-http-client"), result: moduleFor("adapter/syntx/owner-uni-image-result"),
      catalog: moduleFor("catalog/selected-discovery-catalog")
    };
    phase = "public-exports";
    assertUniImagePublicExports(api, modules);
    phase = "source-contract";
    const version = modules.catalog.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
    const selected = modules.catalog.loadSelectedDiscoveryCatalog(version, join(installedPackagePath, "catalog"));
    const source = assertUniImageSourceContract(modules.parameters, modules.sourceProfile, modules.uploadProfile, modules.input,
      selected.discoveryCatalog, version);
    if (version !== CATALOG_VERSION) fail("INSTALLED_UNI_IMAGE_SOURCE_PROFILE_INVALID");
    phase = "declarations";
    const declaration = await readFile(join(installedPackagePath, "dist/src/index.d.ts"), "utf8");
    assertUniImageDeclarations(declaration);
    phase = "flag-reader";
    assertUniImageFlagReader(modules.stdio);
    const enums = { phases: modules.generation.OWNER_UNI_IMAGE_GENERATION_PHASES,
      errorCodes: modules.generation.OWNER_UNI_IMAGE_GENERATION_ERROR_CODES,
      historyReasons: modules.generation.OWNER_UNI_IMAGE_GENERATION_HISTORY_REASONS,
      resultReasons: modules.generation.OWNER_UNI_IMAGE_GENERATION_RESULT_REASONS };
    phase = "stdio-default";
    const defaultSurface = await listInstalledUniImageTools(installedPackagePath, consumerPath, false, enums);
    phase = "stdio-opt-in";
    const optInSurface = await listInstalledUniImageTools(installedPackagePath, consumerPath, true, enums);
    return Object.freeze({ default_tools: defaultSurface.uni_image_tool_count, opt_in_tools: optInSurface.uni_image_tool_count,
      uni_models_checked: source.uni_models_checked, uni1_ratio_mode_pairs_checked: source.uni1_ratio_mode_pairs_checked,
      parameter_cases_checked: source.parameter_cases_checked, reference_count_cases_checked: source.reference_count_cases_checked,
      upload_mime_types_checked: source.upload_mime_types_checked, local_upload_bytes: source.local_upload_bytes,
      source_execution_claimed: false, provider_acceptance_claimed: false, sdk_version: optInSurface.sdk_version, node_path: process.execPath,
      default_child_close: defaultSurface.child_close, opt_in_child_close: optInSurface.child_close,
      default_child_pid_null: defaultSurface.child_pid_null, opt_in_child_pid_null: optInSurface.child_pid_null,
      default_stderr_bytes: defaultSurface.stderr_bytes, opt_in_stderr_bytes: optInSurface.stderr_bytes,
      default_network_calls: defaultSurface.network_calls, opt_in_network_calls: optInSurface.network_calls,
      sdk_operations: Object.freeze(["initialize", "tools/list", "close"]), auth_calls: 0, tool_calls: 0 });
  } catch (error) {
    if (error instanceof UniImageInstalledCheckError) throw error;
    fail(uniImageUnexpectedErrorCode(phase, error));
  }
}

async function listInstalledUniImageTools(installedPackagePath, consumerPath, enabled, enums) {
  const require = createRequire(join(consumerPath, "package.json"));
  let clientPath; let stdioPath;
  try {
    clientPath = require.resolve("@modelcontextprotocol/sdk/client/index.js");
    stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js");
  } catch { fail("INSTALLED_UNI_IMAGE_SDK_RESOLUTION_FAILED"); }
  const sdkPath = join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk");
  let resolvedConsumer; let resolvedSdk; let resolvedClient; let resolvedStdio;
  try { [resolvedConsumer, resolvedSdk, resolvedClient, resolvedStdio] = await Promise.all([
    realpath(consumerPath), realpath(sdkPath), realpath(clientPath), realpath(stdioPath)]); }
  catch { fail("INSTALLED_UNI_IMAGE_SDK_RESOLUTION_FAILED"); }
  assertUniImageConsumerSdkResolution({ consumerPath, resolvedConsumerPath: resolvedConsumer, sdkPackagePath: sdkPath,
    resolvedSdkPackagePath: resolvedSdk, clientModulePath: resolvedClient, stdioModulePath: resolvedStdio, projectRoot: PROJECT_ROOT });
  let manifest;
  try { manifest = JSON.parse(await readFile(join(resolvedSdk, "package.json"), "utf8")); }
  catch { fail("INSTALLED_UNI_IMAGE_SDK_MANIFEST_INVALID"); }
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest?.version !== "1.32.1") fail("INSTALLED_UNI_IMAGE_SDK_VERSION_MISMATCH");
  const [{ Client }, { StdioClientTransport }] = await Promise.all([import(pathToFileURL(clientPath).href), import(pathToFileURL(stdioPath).href)]);
  const auditDirectory = await mkdtemp(join(tmpdir(), "uni-image-fetch-audit-"));
  const auditFile = join(auditDirectory, "count"); const preload = join(auditDirectory, "network-audit.mjs");
  await writeFile(preload, `import { writeFileSync } from 'node:fs'; let count=0; globalThis.fetch=(...args)=>{ count++; return Promise.reject(new Error('NETWORK_DISABLED')); }; process.on('exit',()=>{ try { writeFileSync(process.env.SYNTX_UNI_IMAGE_NETWORK_AUDIT, String(count)); } catch {} });\n`, { mode: 0o600 });
  const client = new Client({ name: enabled ? "syntx-uni-image-opt-in" : "syntx-uni-image-default", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")],
    cwd: consumerPath, env: { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: auditDirectory, XDG_DATA_HOME: auditDirectory,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, SYNTX_UNI_IMAGE_NETWORK_AUDIT: auditFile,
      ...(enabled ? { SYNTX_OWNER_UNI_IMAGE_REFERENCES: "1" } : {}) }, stderr: "pipe" });
  let closeObserved = false; let resolveClose;
  const closed = new Promise((resolvePromise) => { resolveClose = resolvePromise; });
  const priorClose = transport.onclose;
  transport.onclose = () => { closeObserved = true; try { priorClose?.(); } finally { resolveClose(); } };
  let stderrBytes = 0; transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  let connected = false; let failure; let surface;
  try {
    await withDeadline(client.connect(transport), 5_500, "INSTALLED_UNI_IMAGE_STDIO_INITIALIZE_TIMEOUT"); connected = true;
    if (!Number.isSafeInteger(transport.pid) || transport.pid <= 0) fail("INSTALLED_UNI_IMAGE_STDIO_PID_INVALID");
    const listed = await withDeadline(client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }), 5_500, "INSTALLED_UNI_IMAGE_TOOLS_LIST_TIMEOUT");
    surface = assertUniImageToolSurface(listed.tools, enabled, enums);
  } catch (error) {
    failure = error instanceof UniImageInstalledCheckError ? error : new UniImageInstalledCheckError(uniImageUnexpectedErrorCode(
      enabled ? "stdio-opt-in" : "stdio-default", error));
  } finally {
    try { await withDeadline(connected ? client.close() : transport.close(), 2_000, "INSTALLED_UNI_IMAGE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new UniImageInstalledCheckError("INSTALLED_UNI_IMAGE_STDIO_CLOSE_FAILED"); }
    try { await withDeadline(closed, 2_000, "INSTALLED_UNI_IMAGE_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new UniImageInstalledCheckError("INSTALLED_UNI_IMAGE_STDIO_CLOSE_FAILED"); }
    if (!closeObserved || transport.pid !== null) failure ??= new UniImageInstalledCheckError("INSTALLED_UNI_IMAGE_STDIO_CLOSE_FAILED");
  }
  try {
    if (failure) throw failure;
    if (stderrBytes !== 0) fail("INSTALLED_UNI_IMAGE_STDIO_STDERR_NOT_EMPTY");
    let networkCalls;
    try { networkCalls = Number(await readFile(auditFile, "utf8")); } catch { fail("INSTALLED_UNI_IMAGE_NETWORK_AUDIT_MISSING"); }
    if (networkCalls !== 0) fail("INSTALLED_UNI_IMAGE_NETWORK_CALLS_DETECTED");
    return Object.freeze({ ...surface, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes,
      network_calls: networkCalls, sdk_version: manifest.version });
  } finally { await rm(auditDirectory, { recursive: true, force: true }); }
}

/** Verifies actual SDK tools/list schemas; source controls remain independently normalized by the source matrix. */
export function assertUniImageToolSurface(tools, enabled, enums) {
  const counts = assertUniImageToolNames(tools, enabled);
  if (!enabled) return counts;
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const [upload, generate, reconcile, list] = TOOL_NAMES.map((name) => byName.get(name));
  const code = "INSTALLED_UNI_IMAGE_SCHEMA_INVALID";
  for (const [tool, label] of [[upload, "UPLOAD"], [generate, "GENERATE"], [reconcile, "RECONCILE"], [list, "LIST"]]) {
    assertAllObjectsStrict(tool.inputSchema, `INSTALLED_UNI_IMAGE_${label}_INPUT_SCHEMA_NOT_STRICT`);
    assertAllObjectsStrict(tool.outputSchema, `INSTALLED_UNI_IMAGE_${label}_OUTPUT_SCHEMA_NOT_STRICT`);
  }
  assertUniImageDiagnosticEnums(enums);
  assertStrictObject(upload.inputSchema, ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"], [],
    "INSTALLED_UNI_IMAGE_UPLOAD_INPUT_FIELDS_INVALID");
  assertStrictObject(generate.inputSchema, ["link_attempt_id", "variant", "prompt", "parameters", "image_reference_handles", "main_image_reference_handle"], [],
    "INSTALLED_UNI_IMAGE_GENERATE_INPUT_FIELDS_INVALID");
  assertStrictObject(reconcile.inputSchema, ["link_attempt_id", "recovery_id"], [], "INSTALLED_UNI_IMAGE_RECONCILE_INPUT_FIELDS_INVALID");
  assertStrictObject(list.inputSchema, ["link_attempt_id"], ["limit"], "INSTALLED_UNI_IMAGE_LIST_INPUT_FIELDS_INVALID");
  assertStrictObject(upload.outputSchema, ["status", "reference_handle", "model_id", "source_mime_type", "mime_type", "width", "height",
    "size", "sha256", "expires_in_seconds", "metadata_confidence", "size_limit_confidence"], [], "INSTALLED_UNI_IMAGE_UPLOAD_OUTPUT_FIELDS_INVALID");
  assertStrictObject(generate.outputSchema, ["status", "observation_status", "observation_reason", "namespace_confidence", "backend_acceptance",
    "model_confidence", "model_id", "ai_name", "operation_id", "profile_id", "profile_schema_hash", "catalog_version", "request_fingerprint",
    "intent_fingerprint", "reference_count", "actual_result_count", "result_count_confidence", "recovery_id", "artifacts"], [],
    "INSTALLED_UNI_IMAGE_GENERATE_OUTPUT_FIELDS_INVALID");
  assertStrictObject(list.outputSchema, ["recoveries"], [], "INSTALLED_UNI_IMAGE_LIST_OUTPUT_FIELDS_INVALID");
  const uploadIn = properties(upload.inputSchema, code); const generateIn = properties(generate.inputSchema, code);
  const uploadOut = properties(upload.outputSchema, code); const generateOut = properties(generate.outputSchema, code);
  if (uploadIn.link_attempt_id?.pattern !== ATTEMPT_PATTERN || generateIn.link_attempt_id?.pattern !== ATTEMPT_PATTERN ||
      reconcile.inputSchema.properties?.link_attempt_id?.pattern !== ATTEMPT_PATTERN ||
      list.inputSchema.properties?.link_attempt_id?.pattern !== ATTEMPT_PATTERN ||
      reconcile.inputSchema.properties?.recovery_id?.pattern !== RECOVERY_PATTERN ||
      !sameArray(uploadIn.variant?.enum, MODELS) || !sameArray(generateIn.variant?.enum, MODELS)) fail("INSTALLED_UNI_IMAGE_ID_SCHEMA_INVALID");
  if (uploadIn.content_base64?.minLength !== 4 || uploadIn.content_base64?.maxLength !== Math.ceil(MAX_BYTES / 3) * 4 ||
      uploadIn.filename?.minLength !== 1 || uploadIn.filename?.maxLength !== 255 ||
      !sameArray(uploadIn.mime_type?.enum, INPUT_MIMES) || !sameJson(generateIn.parameters?.anyOf?.map((branch) => Object.keys(branch.properties ?? {}).sort()), [
        ["aspect_ratio", "mode", "seed"], ["mode", "seed"], ["invert_mask"]
      ])) fail("INSTALLED_UNI_IMAGE_INPUT_SCHEMA_INVALID");
  if (generateIn.image_reference_handles?.maxItems !== 9 || generateIn.image_reference_handles?.items?.pattern !== HANDLE_PATTERN ||
      !nullablePattern(generateIn.main_image_reference_handle, HANDLE_PATTERN) || generateIn.prompt?.maxLength !== 6_000 ||
      list.inputSchema.properties?.limit?.minimum !== 1 || list.inputSchema.properties?.limit?.maximum !== 20) {
    fail("INSTALLED_UNI_IMAGE_GENERATE_INPUT_SCHEMA_INVALID");
  }
  if (uploadOut.status?.const !== "uploaded" || uploadOut.reference_handle?.pattern !== HANDLE_PATTERN ||
      !sameArray(uploadOut.model_id?.enum, MODELS) || !sameArray(uploadOut.source_mime_type?.enum, INPUT_MIMES) ||
      !sameArray(uploadOut.mime_type?.enum, ["image/jpeg", "image/png", "image/webp", "image/avif"]) ||
      uploadOut.size?.maximum !== MAX_BYTES || uploadOut.size_limit_confidence?.const !== "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" ||
      uploadOut.metadata_confidence?.const !== "CONTAINER_METADATA_ONLY") fail("INSTALLED_UNI_IMAGE_UPLOAD_OUTPUT_SCHEMA_INVALID");
  if (generateOut.status?.const !== "result_observed" || !sameArray(generateOut.observation_status?.enum, ["COMPLETE", "PARTIAL", "PENDING", "UNVERIFIED"]) ||
      generateOut.namespace_confidence?.const !== "SOURCE_SHAPED_UNVERIFIED" || generateOut.backend_acceptance?.const !== "UNPROVEN" ||
      generateOut.model_confidence?.const !== "PRIVATE_PROFILE_CONTEXT_NOT_PROVIDER_PROOF" || generateOut.ai_name?.const !== "luma_image" ||
      generateOut.operation_id?.const !== "generate-image" || generateOut.reference_count?.minimum !== 0 || generateOut.reference_count?.maximum !== 9 ||
      generateOut.actual_result_count?.maximum !== 64 || generateOut.result_count_confidence?.const !== "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL" ||
      !nullablePattern(generateOut.recovery_id, RECOVERY_PATTERN) || generateOut.artifacts?.maxItems !== 64 ||
      hasAnyObjectKey(generate.inputSchema, ["n", "batch_size", "requested_count", "requested_batch"]) ||
      hasAnyObjectKey(generate.outputSchema, ["n", "batch_size", "requested_count", "requested_batch"])) fail("INSTALLED_UNI_IMAGE_GENERATE_OUTPUT_SCHEMA_INVALID");
  assertStrictObject(generateOut.artifacts?.items, ["message_object_id", "message_id", "url", "mime_type", "mime_source", "geometry_verified"], [],
    "INSTALLED_UNI_IMAGE_ARTIFACT_SCHEMA_INVALID");
  const artifact = properties(generateOut.artifacts.items, code);
  if (artifact.geometry_verified?.const !== false || !sameArray(artifact.mime_type?.anyOf?.find((branch) => Array.isArray(branch.enum))?.enum,
      ["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif", "image/bmp"]) ||
      !sameArray(artifact.mime_source?.enum, ["URL_EXTENSION", "UNKNOWN"])) fail("INSTALLED_UNI_IMAGE_ARTIFACT_SCHEMA_INVALID");
  const recoveries = properties(list.outputSchema, code).recoveries;
  if (recoveries?.type !== "array" || recoveries.maxItems !== 20) fail("INSTALLED_UNI_IMAGE_RECOVERY_SCHEMA_INVALID");
  assertStrictObject(recoveries.items, ["recovery_id", "created_at", "model_id", "status", "diagnostic"], [], "INSTALLED_UNI_IMAGE_RECOVERY_ITEM_INVALID");
  if (recoveries.items.properties?.recovery_id?.pattern !== RECOVERY_PATTERN || !sameArray(recoveries.items.properties?.model_id?.enum, MODELS) ||
      recoveries.items.properties?.status?.const !== "OUTCOME_UNKNOWN") fail("INSTALLED_UNI_IMAGE_RECOVERY_ITEM_INVALID");
  const diagnostic = properties(recoveries.items, code).diagnostic;
  assertStrictObject(diagnostic, ["phase", "post_started", "echo_ack_known", "history_binding", "history_binding_reason", "history_get_calls",
    "history_get_calls_saturated", "result_get_calls", "result_get_calls_saturated", "result_status", "result_reason"], [],
    "INSTALLED_UNI_IMAGE_DIAGNOSTIC_SCHEMA_INVALID");
  const diagnosticFields = properties(diagnostic, code);
  if (!sameArray(diagnosticFields.phase?.enum, GENERATION_PHASES) || !sameArray(diagnosticFields.history_binding_reason?.anyOf?.find((branch) => Array.isArray(branch.enum))?.enum,
      HISTORY_REASONS) || !sameArray(diagnosticFields.result_reason?.anyOf?.find((branch) => Array.isArray(branch.enum))?.enum, RESULT_REASONS) ||
      diagnosticFields.history_get_calls?.maximum !== 255 || diagnosticFields.result_get_calls?.maximum !== 255) fail("INSTALLED_UNI_IMAGE_DIAGNOSTIC_SCHEMA_INVALID");
  assertToolAnnotations(upload, false, true, true, "INSTALLED_UNI_IMAGE_UPLOAD_ANNOTATIONS_INVALID");
  assertToolAnnotations(generate, false, true, true, "INSTALLED_UNI_IMAGE_GENERATE_ANNOTATIONS_INVALID");
  assertToolAnnotations(reconcile, true, false, true, "INSTALLED_UNI_IMAGE_RECONCILE_ANNOTATIONS_INVALID");
  assertToolAnnotations(list, true, false, true, "INSTALLED_UNI_IMAGE_LIST_ANNOTATIONS_INVALID");
  if (!String(generate.description ?? "").includes("never retried") || !String(reconcile.description ?? "").includes("never starts") ||
      !String(list.description ?? "").includes("without prompts")) fail("INSTALLED_UNI_IMAGE_OPERATION_BOUNDARY_INVALID");
  return counts;
}

/** Cross-checks all pinned Uni metadata/control branches using only pure local source APIs. */
export function assertUniImageSourceContract(parameters, sourceProfiles, uploadProfiles, inputPolicy, catalog, selectedVersion) {
  if (selectedVersion !== CATALOG_VERSION || typeof parameters?.getOwnerUniImageSourceParameters !== "function" ||
      typeof parameters?.normalizeOwnerUniImageParameters !== "function" ||
      typeof sourceProfiles?.getOwnerUniImageSourceProfile !== "function" ||
      typeof uploadProfiles?.getOwnerUniImageUploadProfile !== "function" || !catalog) fail("INSTALLED_UNI_IMAGE_SOURCE_PROFILE_INVALID");
  const source = parameters.getOwnerUniImageSourceParameters();
  if (!sameArray(source.models, MODELS) || source.profile_id !== "owner-uni-image-source-parameters-v1" ||
      source.defaults !== "NOT_INJECTED" || source.dispatch_allowed !== false || source.runtime_activation !== false ||
      source.backend_acceptance !== "UNPROVEN" || source.source_mapping_confidence !== "ROOT787_ROOT789_ROOT798_STATIC_SOURCE_JOIN_NOT_PROVIDER_ACCEPTANCE" ||
      source.source_pins?.public_catalog_version !== CATALOG_VERSION || source.source_pins?.use_luma_module !== "useLuma.js" ||
      source.source_pins?.use_luma_build_id !== "1791467421" || source.source_pins?.use_luma_bytes !== 4_865 ||
      source.source_pins?.use_luma_sha256 !== "sha256:f884e576649f4663919a079ac910e733f2e09e909262ee9e75bdf049e828f1d6" ||
      source.source_pins?.seed_helper_executed !== false || source.cost_routing?.projection !== "ROUTING_MODEL_TYPE_ONLY_RESERVED_NOT_PRICE_QUOTE_BILLING_OR_ADMISSION") {
    fail("INSTALLED_UNI_IMAGE_COMPILED_API_REGRESSION_FAILED");
  }
  const expectedCounts = { "uni-1": [0, 9], "uni-1.1-modify-image": [1, 8], "uni-1.1-remove-background": [1, 1] };
  for (const model of MODELS) {
    const limits = expectedCounts[model]; const metadata = source.models_by_id?.[model];
    if (!metadata || metadata.reference_count.minimum !== limits[0] || metadata.reference_count.maximum !== limits[1] ||
        metadata.reference_count.confidence !== "PUBLIC_CATALOG_METADATA_ONLY_NOT_UPLOAD_PERMISSION" &&
        metadata.reference_count.confidence !== undefined) fail("INSTALLED_UNI_IMAGE_COMPILED_API_REGRESSION_FAILED");
  }
  const profileSummary = assertUniImageProfiles(sourceProfiles, uploadProfiles, inputPolicy, catalog, selectedVersion);
  let parameterCases = 0; let ratioModePairs = 0;
  const normalize = (variant, prompt, controls, count, mainIndex = null, countsAsParameterCase = true) => {
    const handles = Array.from({ length: count }, (_, index) => uniHandle(index + 1));
    const main = mainIndex === null ? null : handles[mainIndex];
    const normalized = parameters.normalizeOwnerUniImageParameters({ variant, prompt, parameters: controls,
      image_reference_handles: handles, main_image_reference_handle: main });
    if (normalized.variant !== variant || normalized.model_id !== variant || normalized.model_type !== variant ||
        normalized.ai_name !== "luma_image" || normalized.scope !== "image" || normalized.operation_id !== "generate-image" ||
        normalized.defaults_injected !== false || normalized.dispatch_allowed !== false || normalized.runtime_activation !== false ||
        normalized.backend_acceptance !== "UNPROVEN" || normalized.reference_selection.owned_references_bound !== false ||
        Object.keys(normalized.cost_inputs).length !== 0 || Object.hasOwn(normalized.custom_settings, "n") ||
        Object.hasOwn(normalized.custom_settings, "batch_size")) fail("INSTALLED_UNI_IMAGE_PARAMETER_MATRIX_INVALID");
    if (variant === "uni-1.1-modify-image" && normalized.ordered_image_reference_handles[0] !== main) fail("INSTALLED_UNI_IMAGE_REFERENCE_ORDER_INVALID");
    if (countsAsParameterCase) parameterCases += 1;
    return normalized;
  };
  for (const aspect_ratio of AUTO_RATIOS) {
    for (const mode of MODES) {
      if (mode === "manga" && !MANGA_RATIOS.includes(aspect_ratio)) continue;
      ratioModePairs += 1;
      for (const seed of SEEDS) normalize("uni-1", "source-contract prompt", { aspect_ratio, seed, mode }, 0);
    }
  }
  for (const mode of MODES) for (const seed of SEEDS) {
    normalize("uni-1.1-modify-image", "source-contract prompt", { seed, mode }, 2, 1);
  }
  for (const invert_mask of [false, true]) normalize("uni-1.1-remove-background", "", { invert_mask }, 1);
  let referenceCountCases = 0;
  for (const count of Array.from({ length: 10 }, (_, index) => index)) {
    normalize("uni-1", "reference count check", { aspect_ratio: "1:1", seed: null, mode: "auto" }, count, null, false);
    referenceCountCases += 1;
  }
  for (let count = 1; count <= 8; count += 1) {
    normalize("uni-1.1-modify-image", "reference count check", { seed: null, mode: "auto" }, count, count - 1, false);
    referenceCountCases += 1;
  }
  normalize("uni-1.1-remove-background", "", { invert_mask: false }, 1, null, false); referenceCountCases += 1;
  expectReject(() => parameters.normalizeOwnerUniImageParameters({ variant: "uni-1", prompt: "x",
    parameters: { aspect_ratio: "16:9", seed: null, mode: "manga" }, image_reference_handles: [], main_image_reference_handle: null }));
  expectReject(() => parameters.normalizeOwnerUniImageParameters({ variant: "uni-1.1-modify-image", prompt: "x",
    parameters: { seed: null, mode: "auto" }, image_reference_handles: [uniHandle(1)], main_image_reference_handle: null }));
  expectReject(() => parameters.normalizeOwnerUniImageParameters({ variant: "uni-1.1-remove-background", prompt: "",
    parameters: { invert_mask: false }, image_reference_handles: [], main_image_reference_handle: null }));
  if (ratioModePairs !== 15 || parameterCases !== 53 || referenceCountCases !== 19) fail("INSTALLED_UNI_IMAGE_PARAMETER_MATRIX_INVALID");
  return Object.freeze({ uni_models_checked: MODELS.length, uni1_ratio_mode_pairs_checked: ratioModePairs,
    parameter_cases_checked: parameterCases, reference_count_cases_checked: referenceCountCases,
    upload_mime_types_checked: profileSummary.upload_mime_types_checked, local_upload_bytes: profileSummary.local_upload_bytes,
    source_execution_claimed: false, provider_acceptance_claimed: false });
}

function assertUniImageProfiles(sourceProfiles, uploadProfiles, inputPolicy, catalog, version) {
  const expectedMimeTypes = INPUT_MIMES;
  const policy = inputPolicy?.OWNER_UNI_IMAGE_INPUT_POLICY;
  if (!policy || policy.local_max_bytes !== 26_214_400 || policy.local_max_bytes_policy !==
      "SELECTED_PUBLIC_METADATA_LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" || policy.source_max_bytes !== "UNKNOWN" ||
      policy.provider_max_bytes !== "UNKNOWN" || !sameArray(policy.accepted_mime_types, expectedMimeTypes)) {
    fail("INSTALLED_UNI_IMAGE_UPLOAD_POLICY_INVALID");
  }
  for (const model of MODELS) {
    const profile = sourceProfiles.getOwnerUniImageSourceProfile(model, catalog, version);
    const upload = uploadProfiles.getOwnerUniImageUploadProfile(model, catalog, version);
    if (profile.profile_id !== "owner-uni-image-source-profile-v1" || profile.model_id !== model || profile.ai_name !== "luma_image" ||
        profile.model_type !== model || profile.scope !== "image" || profile.operation_id !== "generate-image" ||
        profile.public_catalog_version !== version || profile.defaults !== "NOT_INJECTED" ||
        profile.dispatch_allowed !== false || profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN" ||
        profile.effective_defaults !== "UNKNOWN_SOURCE_INITIALIZERS_NOT_RUNTIME_DEFAULTS" ||
        profile.source_binding?.source_execution !== false || profile.source_binding?.full_public_record_verified !== true ||
        profile.source_binding?.full_public_record_sha256 !== MODEL_HASHES[model] ||
        profile.source_binding?.upload_profile_reference?.operation_id !== "upload-image-reference" ||
        profile.source_binding?.upload_profile_reference?.hash_scope !== "UPLOAD_ONLY_NOT_GENERATION_PROFILE_SCHEMA" ||
        profile.cost_routing?.ai_name !== "luma_image" || profile.cost_routing?.model_type !== model ||
        !sameArray(profile.cost_routing?.declared_parameter_keys, ["model_type"]) ||
        profile.cost_routing?.projection !== "ROUTING_ONLY_NOT_QUOTE_BILLING_OR_ADMISSION" ||
        Object.keys(profile.cost_routing?.cost_inputs ?? {}).length !== 0 ||
        profile.generation_readiness !== "SOURCE_PROFILE_ONLY_NOT_GENERATION_ADMISSION" ||
        !/^sha256:[a-f0-9]{64}$/u.test(profile.profile_schema_hash) ||
        upload.model_id !== model || upload.ai_name !== "luma_image" || upload.catalog_version !== version ||
        upload.source_metadata?.active !== true || upload.source_metadata?.uploadable !== true ||
        upload.source_metadata?.max_file_size !== 26_214_400 || !sameArray(upload.source_metadata.accepted_file_types, expectedMimeTypes) ||
        upload.source_metadata.confidence !== "PUBLIC_CATALOG_METADATA_NOT_PROVIDER_ACCEPTANCE" ||
        upload.local_input_policy?.local_max_bytes !== 26_214_400 ||
        upload.local_input_policy?.local_max_bytes_policy !== "SELECTED_PUBLIC_METADATA_LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" ||
        !sameArray(upload.local_input_policy.accepted_mime_types, expectedMimeTypes) ||
        upload.local_input_policy.jpeg_jpg_canonicalization !== "image/jpg_TO_image/jpeg") fail("INSTALLED_UNI_IMAGE_SOURCE_PROFILE_INVALID");
  }
  return Object.freeze({ upload_mime_types_checked: expectedMimeTypes.length, local_upload_bytes: policy.local_max_bytes });
}

function uniHandle(index) { return `uni_image_00000000-0000-0000-0000-${String(index).padStart(12, "0")}`; }
function expectReject(operation) { let rejected = false; try { operation(); } catch { rejected = true; } if (!rejected) fail("INSTALLED_UNI_IMAGE_NEGATIVE_MATRIX_INVALID"); }
function sameArray(actual, expected) { return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((item, index) => item === expected[index]); }
function sameJson(actual, expected) { try { return JSON.stringify(actual) === JSON.stringify(expected); } catch { return false; } }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function properties(schema, code) { if (!isRecord(schema?.properties)) fail(code); return schema.properties; }
function assertStrictObject(schema, required, optional, code) {
  const fields = properties(schema, code);
  if (schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(fields).sort(), [...required, ...optional].sort()) ||
      !sameArray([...(schema.required ?? [])].sort(), [...required].sort())) fail(code);
}
function assertAllObjectsStrict(schema, code, visited = new Set()) {
  if (!schema || typeof schema !== "object" || visited.has(schema)) return;
  visited.add(schema);
  if (schema.type === "object" && schema.additionalProperties !== false) fail(code);
  for (const value of Object.values(schema)) {
    if (Array.isArray(value)) for (const entry of value) assertAllObjectsStrict(entry, code, visited);
    else assertAllObjectsStrict(value, code, visited);
  }
}
function nullablePattern(schema, pattern) {
  return schema?.pattern === pattern || (Array.isArray(schema?.anyOf) && schema.anyOf.some((branch) => branch?.pattern === pattern) &&
    schema.anyOf.some((branch) => branch?.type === "null" || branch?.const === null));
}
function hasAnyObjectKey(schema, forbidden, visited = new Set()) {
  if (!schema || typeof schema !== "object" || visited.has(schema)) return false;
  visited.add(schema);
  if (schema.type === "object" && forbidden.some((key) => Object.hasOwn(schema.properties ?? {}, key))) return true;
  return Object.values(schema).some((value) => Array.isArray(value)
    ? value.some((entry) => hasAnyObjectKey(entry, forbidden, visited)) : hasAnyObjectKey(value, forbidden, visited));
}
function assertToolAnnotations(tool, readOnly, destructive, openWorld, code) {
  if (tool.annotations?.readOnlyHint !== readOnly || tool.annotations?.destructiveHint !== destructive ||
      tool.annotations?.idempotentHint !== readOnly || tool.annotations?.openWorldHint !== openWorld) fail(code);
}
export function assertUniImageConsumerSdkResolution({ consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath,
  clientModulePath, stdioModulePath, projectRoot }) {
  if (![consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath, clientModulePath, stdioModulePath, projectRoot]
    .every((path) => typeof path === "string" && isAbsolute(path))) fail("INSTALLED_UNI_IMAGE_SDK_NOT_FROM_CONSUMER");
  const expectedSdkPath = join(resolve(consumerPath), "node_modules", "@modelcontextprotocol", "sdk");
  const resolvedSdkRoot = resolve(resolvedSdkPackagePath);
  if (resolve(sdkPackagePath) !== expectedSdkPath || !isWithin(resolvedConsumerPath, resolvedSdkRoot) ||
      isWithin(projectRoot, resolvedSdkRoot) || !isWithin(resolvedSdkRoot, resolve(clientModulePath)) ||
      !isWithin(resolvedSdkRoot, resolve(stdioModulePath))) fail("INSTALLED_UNI_IMAGE_SDK_NOT_FROM_CONSUMER");
  return true;
}
function isWithin(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
function withDeadline(promise, milliseconds, code) {
  let timer;
  const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new UniImageInstalledCheckError(code)), milliseconds); timer.unref?.(); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
export function uniImageUnexpectedErrorCode(phase, error) {
  if (!CHECK_PHASES.includes(phase)) fail("INSTALLED_UNI_IMAGE_DIAGNOSTIC_PHASE_INVALID");
  let errorClass = "NonError";
  if (error instanceof TypeError) errorClass = "TypeError";
  else if (error instanceof ReferenceError) errorClass = "ReferenceError";
  else if (error instanceof SyntaxError) errorClass = "SyntaxError";
  else if (error instanceof RangeError) errorClass = "RangeError";
  else if (error instanceof AggregateError) errorClass = "AggregateError";
  else if (error instanceof Error) errorClass = "Error";
  return `INSTALLED_UNI_IMAGE_UNEXPECTED_${phase}_${errorClass}`;
}
function fail(code) { throw new UniImageInstalledCheckError(code); }
