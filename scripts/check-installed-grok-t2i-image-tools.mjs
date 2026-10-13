import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class GrokT2iImageToolsInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "GrokT2iImageToolsInstalledCheckError"; this.code = code; }
}

const MODELS = Object.freeze(["grok_t2i", "grok_t2i_pro", "grok_imagine_2", "grok_imagine_quality"]);
const TOOL_NAMES = Object.freeze(["syntx_upload_grok_t2i_image_reference", "syntx_owner_generate_grok_t2i_image",
  "syntx_owner_reconcile_grok_t2i_image", "syntx_owner_list_grok_t2i_image_recoveries"]);
const MODULES = Object.freeze(["application/owner-grok-t2i-parameters", "application/owner-grok-t2i-cost-parameters",
  "application/owner-grok-t2i-source-profile", "application/owner-grok-t2i-image-input-validator",
  "application/owner-grok-t2i-image-upload-service", "application/owner-grok-t2i-request-preparer",
  "application/owner-grok-t2i-one-shot-policy", "application/owner-grok-t2i-history-binding",
  "application/owner-grok-t2i-generation-service", "mcp/owner-grok-t2i-image-tools", "mcp/server",
  "runtime/observed-owner-runtime", "transports/stdio-owner", "adapter/syntx/chat-http-client",
  "adapter/syntx/upload-reference-bridge", "catalog/selected-discovery-catalog"]);
const PACKAGE_PATHS = Object.freeze(["dist/src/index.js", "dist/src/index.d.ts",
  ...MODULES.flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`])]);
const PHASES = Object.freeze(["REQUEST_PREPARE", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN",
  "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"]);
const ERROR_CODES = Object.freeze(["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "MODEL_BINDING_MISMATCH",
  "PRINCIPAL_NOT_LINKED", "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"]);
const HISTORY_REASONS = Object.freeze(["INVALID_INPUT", "HISTORY_SHAPE_INVALID", "HISTORY_INCOMPLETE", "HISTORY_PAGE_INVALID",
  "CHAT_SCOPE_MISMATCH", "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID",
  "MESSAGE_ID_DUPLICATE", "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND",
  "OWNER_ACK_MISMATCH", "OWNER_ACK_AMBIGUOUS", "OWNER_REFERENCE_SET_MISMATCH", "BOT_MESSAGE_NOT_FOUND",
  "BOT_MESSAGE_AMBIGUOUS", "BOT_MESSAGE_BEFORE_ACK", "BOT_OUTPUT_COUNT_INVALID", "BOT_OUTPUT_NAMESPACE_UNVERIFIED", "OUTPUT_BATCH_PARTIAL"]);
const RESULT_REASONS = Object.freeze(["NO_IMAGE_OBJECTS", "RESULT_OBJECTS_PENDING", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH",
  "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "OUTPUT_COUNT_INVALID", "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH",
  "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE",
  "RESULT_MIME_UNKNOWN", "RESULT_OBJECT_DUPLICATE", "OUTPUT_BATCH_PARTIAL"]);
const DEFAULT_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const FORM_SHA = "sha256:1bbf68ba51172eeacaa936e66755236179d8595bde98b54f78414b30645b2f5d";
const COST_SHA = "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9";
const MODELS_HASH = "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
const MODEL_RECORD_HASHES = Object.freeze({
  grok_t2i: "sha256:907e7763ec4d7f29a1b076bfc3eacb63505b177a3734da8ab35f525d9bc794ea",
  grok_t2i_pro: "sha256:e580faab3470ebc62eeaacad867f28a20b06fd07872f577a96255db17c2a6cf5",
  grok_imagine_2: "sha256:475201e9ecd7cd80cc0406eb4542fe7677e464aa92bc5a3e018d08cee6c9aa39",
  grok_imagine_quality: "sha256:dcfc23cf05a050a8975049eb7d3f9299bfd43f4eaa5f7ac7d83c7ec422db3d4c"
});
const BASE_RATIOS = Object.freeze(["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"]);
const IMAGINE_RATIOS = Object.freeze(["1:1", "2:3", "3:2", "9:16", "16:9"]);
const ALL_RATIOS = Object.freeze([...new Set([...BASE_RATIOS, ...IMAGINE_RATIOS])]);
const RESOLUTIONS = Object.freeze(["1k", "2k"]);
const BATCHES = Object.freeze([1, 2, 3, 4, 5]);
const QUALITIES = Object.freeze(["low", "medium"]);
const CAPS = Object.freeze({ grok_t2i: 0, grok_t2i_pro: 0, grok_imagine_2: 5, grok_imagine_quality: 3 });
const PROMPT_LIMITS = Object.freeze({ grok_t2i: 5_000, grok_t2i_pro: 5_000, grok_imagine_2: 1_000, grok_imagine_quality: 1_000 });
const PHASE_NAMES = Object.freeze(["package-paths", "node-runtime", "module-import", "public-exports", "compiled-api",
  "source-contract", "prompt-budget", "declarations", "flag-reader", "stdio-default", "stdio-opt-in"]);
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

export async function assertInstalledGrokT2iImageTools(installedPackagePath, consumerPath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertGrokT2iNativePackagePaths(packagedPaths);
    phase = "node-runtime";
    if (process.versions.node !== "24.21.0") fail("INSTALLED_GROK_T2I_NODE24_21_REQUIRED");
    const importPacked = (path) => import(pathToFileURL(join(installedPackagePath, path)).href);
    phase = "module-import";
    let loaded;
    try { loaded = await Promise.all([importPacked("dist/src/index.js"), ...MODULES.map((name) => importPacked(`dist/src/${name}.js`))]); }
    catch { fail("INSTALLED_GROK_T2I_MODULE_IMPORT_FAILED"); }
    const api = loaded[0]; const moduleMap = mapGrokT2iNativeModules(MODULES, loaded.slice(1));
    const moduleFor = (name) => moduleMap.get(name);
    const modules = { parameters: moduleFor("application/owner-grok-t2i-parameters"), cost: moduleFor("application/owner-grok-t2i-cost-parameters"),
      profile: moduleFor("application/owner-grok-t2i-source-profile"), input: moduleFor("application/owner-grok-t2i-image-input-validator"),
      upload: moduleFor("application/owner-grok-t2i-image-upload-service"), preparer: moduleFor("application/owner-grok-t2i-request-preparer"),
      permit: moduleFor("application/owner-grok-t2i-one-shot-policy"), history: moduleFor("application/owner-grok-t2i-history-binding"),
      generation: moduleFor("application/owner-grok-t2i-generation-service"), tools: moduleFor("mcp/owner-grok-t2i-image-tools"),
      server: moduleFor("mcp/server"), runtime: moduleFor("runtime/observed-owner-runtime"), stdio: moduleFor("transports/stdio-owner"),
      client: moduleFor("adapter/syntx/chat-http-client"), catalog: moduleFor("catalog/selected-discovery-catalog") };
    phase = "public-exports";
    assertGrokT2iPublicExports(api, modules);
    phase = "compiled-api";
    const version = modules.catalog.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
    const selected = modules.catalog.loadSelectedDiscoveryCatalog(version, join(installedPackagePath, "catalog"));
    phase = "source-contract";
    const source = assertGrokT2iSourceContract(modules.parameters, modules.cost, modules.profile,
      selected.discoveryCatalog, version);
    if (version !== DEFAULT_VERSION) fail("INSTALLED_GROK_T2I_SOURCE_PROFILE_INVALID");
    phase = "prompt-budget";
    await assertGrokT2iPromptBudgets(modules, selected.discoveryCatalog, version);
    phase = "declarations";
    const declarations = await readFile(join(installedPackagePath, "dist/src/index.d.ts"), "utf8");
    for (const name of ["OwnerGrokT2iModel", "OwnerGrokT2iInputParameters", "OwnerGrokT2iSourceProfile",
      "OwnerGrokT2iCatalogPort", "OwnerGrokT2iCostParametersInput", "OwnerGrokT2iCostParameters",
      "OwnerGrokT2iImageUploadServiceOptions", "OwnerGrokT2iImageUploadInput", "OwnerGrokT2iImageUploadReceipt",
      "OwnerGrokT2iGenerationServiceOptions", "OwnerGrokT2iGenerateInput", "OwnerGrokT2iReconcileInput",
      "OwnerGrokT2iRecoveryListInput", "OwnerGrokT2iGenerationResult", "OwnerGrokT2iRecoveryListItem",
      "OwnerGrokT2iUnknownDiagnostic", "OwnerGrokT2iGenerationServiceErrorCode", "RegisterSyntxOwnerGrokT2iImageToolsOptions",
      "OwnerGrokT2iImageServiceComposition"]) if (!declarations.includes(name)) fail("INSTALLED_GROK_T2I_DECLARATION_INVALID");
    for (const name of ["OwnerGrokT2iPreparedCandidate", "OwnerGrokT2iOwnedAssetSet", "OwnerGrokT2iOneShotPermit",
      "OwnerGrokT2iRequestPreparer"]) if (declarations.includes(`export { ${name}`) || declarations.includes(`export type { ${name}`)) {
      fail("INSTALLED_GROK_T2I_PRIVATE_DECLARATION_LEAK");
    }
    phase = "flag-reader";
    const flag = modules.stdio.readOwnerGrokT2iImageReferencesFlag;
    if (typeof flag !== "function" || flag(undefined) !== false || flag("") !== false || flag("0") !== false || flag("1") !== true) {
      fail("INSTALLED_GROK_T2I_FLAG_INVALID");
    }
    for (const value of ["true", "yes", "01", " 1 "]) {
      let rejected = false; try { flag(value); } catch { rejected = true; }
      if (!rejected) fail("INSTALLED_GROK_T2I_FLAG_INVALID");
    }
    const enums = { phases: modules.generation.OWNER_GROK_T2I_GENERATION_PHASES,
      errorCodes: modules.generation.OWNER_GROK_T2I_GENERATION_ERROR_CODES,
      historyReasons: modules.generation.OWNER_GROK_T2I_HISTORY_REASONS,
      resultReasons: modules.generation.OWNER_GROK_T2I_RESULT_REASONS };
    assertGrokT2iDiagnosticEnums(enums);
    phase = "stdio-default";
    const defaultResult = await listInstalledGrokT2iTools(installedPackagePath, consumerPath, false, enums);
    phase = "stdio-opt-in";
    const optInResult = await listInstalledGrokT2iTools(installedPackagePath, consumerPath, true, enums);
    return Object.freeze({ default_tools: defaultResult.grok_t2i_tool_count, opt_in_tools: optInResult.grok_t2i_tool_count,
      grok_t2i_models_checked: source.grok_t2i_models_checked, parameter_cost_combinations_checked: source.parameter_cost_combinations_checked,
      prompt_budgets_checked: 4, source_execution_claimed: false, provider_acceptance_claimed: false,
      sdk_version: optInResult.sdk_version, node_path: process.execPath,
      default_child_close: defaultResult.child_close, opt_in_child_close: optInResult.child_close,
      default_child_pid_null: defaultResult.child_pid_null, opt_in_child_pid_null: optInResult.child_pid_null,
      default_stderr_bytes: defaultResult.stderr_bytes, opt_in_stderr_bytes: optInResult.stderr_bytes,
      default_network_calls: defaultResult.network_calls, opt_in_network_calls: optInResult.network_calls,
      sdk_operations: Object.freeze(["initialize", "tools/list", "close"]), auth_calls: 0, tool_calls: 0 });
  } catch (error) {
    if (error instanceof GrokT2iImageToolsInstalledCheckError) throw error;
    fail(grokT2iUnexpectedErrorCode(phase, error));
  }
}

async function assertGrokT2iPromptBudgets(modules, catalog, version) {
  const binding = Object.freeze({ tenant_id: "installed-grok-t2i-check", subject: "read-only-check" });
  const linkService = { async getStatus(_binding, attemptId) { return { attempt_id: attemptId,
    authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true }; } };
  const io = { credential_calls: 0, fetch_calls: 0 };
  const client = new modules.client.SyntxChatHttpClient({ credentialBroker: { async useCredential() {
    io.credential_calls += 1; throw new Error("installed prompt check attempted credential lookup");
  } }, fetchImpl: async () => { io.fetch_calls += 1; throw new Error("installed prompt check attempted network I/O"); } });
  const upload = new modules.upload.OwnerGrokT2iImageUploadService({ binding, linkService, catalog,
    catalog_version: version, resolveClient: () => client });
  const preparer = new modules.preparer.OwnerGrokT2iRequestPreparer({ binding, linkService, imageUploadService: upload,
    catalog, catalog_version: version });
  try {
    for (const model_id of MODELS) {
      const prompt = "x".repeat(PROMPT_LIMITS[model_id]);
      const parameters = { aspect_ratio: "1:1", resolution: "1k", batch_size: 1,
        ...(model_id === "grok_imagine_2" ? { details_quality: "low" } : {}) };
      const attempt_id = `link_grok_checker_${model_id}`;
      const principal = Object.freeze({ tenant_id: binding.tenant_id, subject_id: binding.subject, connection_id: attempt_id });
      const assets = await preparer.issue({ principal, attempt_id, model_id, prompt, parameters, reference_handles: [] });
      const candidate = await preparer.prepare({ principal, attempt_id, asset_set: assets });
      if (candidate.prompt_local_max_utf16_units !== PROMPT_LIMITS[model_id] ||
          candidate.prompt_limit_confidence !== "SOURCE_UI_BUDGET_LOCAL_REJECTION_NOT_PROVIDER_LIMIT" ||
          JSON.stringify(candidate).includes(prompt)) fail("INSTALLED_GROK_T2I_PROMPT_BUDGET_INVALID");
      let rejected = false;
      try { await preparer.issue({ principal, attempt_id, model_id, prompt: `${prompt}x`, parameters, reference_handles: [] }); }
      catch (error) { rejected = error instanceof modules.preparer.OwnerGrokT2iRequestPrepareError && error.code === "PROMPT_INVALID"; }
      if (!rejected) fail("INSTALLED_GROK_T2I_PROMPT_BUDGET_INVALID");
    }
    if (io.credential_calls !== 0 || io.fetch_calls !== 0) fail("INSTALLED_GROK_T2I_PROMPT_BUDGET_IO_DETECTED");
  } finally { await preparer.close(); await upload.close(); }
}

async function listInstalledGrokT2iTools(installedPackagePath, consumerPath, enabled, enums) {
  const require = createRequire(join(consumerPath, "package.json"));
  let clientPath; let stdioPath;
  try { clientPath = require.resolve("@modelcontextprotocol/sdk/client/index.js"); stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js"); }
  catch { fail("INSTALLED_GROK_T2I_SDK_RESOLUTION_FAILED"); }
  const sdkPath = join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk");
  let resolvedConsumer; let resolvedSdk; let resolvedClient; let resolvedStdio; let projectRoot;
  try { [resolvedConsumer, resolvedSdk, resolvedClient, resolvedStdio, projectRoot] = await Promise.all([
    realpath(consumerPath), realpath(sdkPath), realpath(clientPath), realpath(stdioPath), realpath(PROJECT_ROOT)]); }
  catch { fail("INSTALLED_GROK_T2I_SDK_RESOLUTION_FAILED"); }
  assertConsumerSdkResolution({ consumerPath, resolvedConsumerPath: resolvedConsumer, sdkPackagePath: sdkPath,
    resolvedSdkPackagePath: resolvedSdk, clientModulePath: resolvedClient, stdioModulePath: resolvedStdio, projectRoot });
  let manifest; try { manifest = JSON.parse(await readFile(join(resolvedSdk, "package.json"), "utf8")); }
  catch { fail("INSTALLED_GROK_T2I_SDK_MANIFEST_INVALID"); }
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest?.version !== "1.32.1") fail("INSTALLED_GROK_T2I_SDK_VERSION_MISMATCH");
  const [{ Client }, { StdioClientTransport }] = await Promise.all([import(pathToFileURL(clientPath).href), import(pathToFileURL(stdioPath).href)]);
  const auditDir = await mkdtemp(join(tmpdir(), "grok-t2i-fetch-audit-"));
  const auditFile = join(auditDir, "count"); const preload = join(auditDir, "audit.mjs");
  await writeFile(preload, `import { writeFileSync } from 'node:fs'; let count=0; globalThis.fetch=(...args)=>{ count++; return Promise.reject(new Error('NETWORK_DISABLED')); }; process.on('exit',()=>{ try { writeFileSync(process.env.SYNTX_GROK_T2I_NETWORK_AUDIT, String(count)); } catch {} });\n`, { mode: 0o600 });
  const client = new Client({ name: enabled ? "syntx-grok-t2i-opt-in" : "syntx-grok-t2i-default", version: "1.0.0" }, { capabilities: {} });
  const environment = { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: auditDir, XDG_DATA_HOME: auditDir,
    SYNTX_GROK_T2I_NETWORK_AUDIT: auditFile, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
    ...(enabled ? { SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES: "1" } : {}) };
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")], cwd: consumerPath, env: environment, stderr: "pipe" });
  let closeObserved = false; let resolveClose;
  const closed = new Promise((resolvePromise) => { resolveClose = resolvePromise; });
  const priorClose = transport.onclose;
  transport.onclose = () => { closeObserved = true; try { priorClose?.(); } finally { resolveClose(); } };
  let stderrBytes = 0; transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  let connected = false; let failure; let surface;
  try {
    await withDeadline(client.connect(transport), 5_500, "INSTALLED_GROK_T2I_STDIO_INITIALIZE_TIMEOUT"); connected = true;
    if (!Number.isSafeInteger(transport.pid) || transport.pid <= 0) fail("INSTALLED_GROK_T2I_STDIO_PID_INVALID");
    const listed = await withDeadline(client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }), 5_500,
      "INSTALLED_GROK_T2I_TOOLS_LIST_TIMEOUT");
    surface = assertGrokT2iToolSurface(listed.tools, enabled, enums);
  } catch (error) {
    failure = error instanceof GrokT2iImageToolsInstalledCheckError ? error :
      new GrokT2iImageToolsInstalledCheckError(grokT2iUnexpectedErrorCode(enabled ? "stdio-opt-in" : "stdio-default", error));
  } finally {
    try { await withDeadline(connected ? client.close() : transport.close(), 2_000, "INSTALLED_GROK_T2I_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new GrokT2iImageToolsInstalledCheckError("INSTALLED_GROK_T2I_STDIO_CLOSE_FAILED"); }
    try { await withDeadline(closed, 2_000, "INSTALLED_GROK_T2I_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new GrokT2iImageToolsInstalledCheckError("INSTALLED_GROK_T2I_STDIO_CLOSE_FAILED"); }
    if (!closeObserved || transport.pid !== null) failure ??= new GrokT2iImageToolsInstalledCheckError("INSTALLED_GROK_T2I_STDIO_CLOSE_FAILED");
  }
  try {
    if (failure) throw failure;
    if (stderrBytes !== 0) fail("INSTALLED_GROK_T2I_STDIO_STDERR_NOT_EMPTY");
    const networkCalls = Number(await readFile(auditFile, "utf8"));
    if (networkCalls !== 0) fail("INSTALLED_GROK_T2I_NETWORK_CALLS_DETECTED");
    return Object.freeze({ ...surface, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes,
      network_calls: networkCalls, sdk_version: manifest.version });
  } finally { await rm(auditDir, { recursive: true, force: true }); }
}

function assertGrokParameterBranches(schema, code) {
  const branches = schema?.anyOf ?? schema?.oneOf;
  if (!Array.isArray(branches) || branches.length !== 3) fail(code);
  let detailsBranches = 0;
  for (const branch of branches) {
    const fields = properties(branch, code);
    const keys = Object.keys(fields).sort();
    const baseKeys = ["aspect_ratio", "batch_size", "resolution"];
    const imagineKeys = [...baseKeys, "details_quality"].sort();
    if (sameArray(keys, imagineKeys)) {
      detailsBranches += 1;
      if (!sameArray(fields.details_quality?.enum, QUALITIES) || !sameArray(fields.aspect_ratio?.enum, ALL_RATIOS)) fail(code);
    } else if (!sameArray(keys, baseKeys.sort()) || !sameArray(fields.aspect_ratio?.enum, ALL_RATIOS)) fail(code);
    if (!sameArray(fields.resolution?.enum, RESOLUTIONS) || !sameArray(fields.batch_size?.anyOf?.map((item) => item.const), BATCHES)) fail(code);
  }
  if (detailsBranches !== 1) fail(code);
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
function assertAnnotations(tool, readOnly, openWorld, code) {
  if (tool.annotations?.readOnlyHint !== readOnly || tool.annotations?.destructiveHint !== !readOnly ||
      tool.annotations?.idempotentHint !== readOnly || tool.annotations?.openWorldHint !== openWorld) fail(code);
}
function properties(schema, code) { if (!isRecord(schema?.properties)) fail(code); return schema.properties; }
function isNullSchema(schema) { return schema?.type === "null" || schema?.const === null || (schema?.anyOf ?? []).some((item) => item?.type === "null" || item?.const === null); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function sameArray(actual, expected) { return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((item, i) => item === expected[i]); }
function within(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
function errorClass(error) {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof AggregateError) return "AggregateError";
  return error instanceof Error ? "Error" : "NonError";
}
function withDeadline(promise, milliseconds, code) {
  let timer;
  const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new GrokT2iImageToolsInstalledCheckError(code)), milliseconds); timer.unref?.(); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
function fail(code) { throw new GrokT2iImageToolsInstalledCheckError(code); }

export function assertGrokT2iNativePackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_GROK_T2I_PACKAGE_PATHS_INVALID");
  if (PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) fail("INSTALLED_GROK_T2I_PACKAGE_CONTENT_MISSING");
  return true;
}

export function mapGrokT2iNativeModules(modulePaths, loadedModules) {
  if (!Array.isArray(modulePaths) || !Array.isArray(loadedModules) || modulePaths.length !== loadedModules.length ||
      modulePaths.some((path) => typeof path !== "string") || new Set(modulePaths).size !== modulePaths.length ||
      loadedModules.some((module) => !isRecord(module))) fail("INSTALLED_GROK_T2I_MODULE_MAP_INVALID");
  return new Map(modulePaths.map((path, index) => [path, loadedModules[index]]));
}

export function assertGrokT2iToolNames(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_GROK_T2I_TOOLS_LIST_INVALID");
  const names = tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length) fail("INSTALLED_GROK_T2I_DEFAULT_OFF_FAILED");
    return Object.freeze({ grok_t2i_tool_count: 0 });
  }
  if (names.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => names.filter((entry) => entry === name).length !== 1)) {
    fail("INSTALLED_GROK_T2I_TOOL_SET_MISMATCH");
  }
  return Object.freeze({ grok_t2i_tool_count: 4 });
}

export function assertGrokT2iToolSurface(tools, enabled, enums) {
  const counts = assertGrokT2iToolNames(tools, enabled);
  if (!enabled) return counts;
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const [upload, generate, reconcile, list] = TOOL_NAMES.map((name) => byName.get(name));
  const code = "INSTALLED_GROK_T2I_SCHEMA_INVALID";
  for (const [tool, label] of [[upload, "UPLOAD"], [generate, "GENERATE"], [reconcile, "RECONCILE"], [list, "LIST"]]) {
    assertAllObjectsStrict(tool.inputSchema, `INSTALLED_GROK_T2I_${label}_INPUT_OBJECT_SCHEMA_INVALID`);
    assertAllObjectsStrict(tool.outputSchema, `INSTALLED_GROK_T2I_${label}_OUTPUT_OBJECT_SCHEMA_INVALID`);
  }
  assertGrokT2iDiagnosticEnums(enums);
  assertStrictObject(upload.inputSchema, ["link_attempt_id", "model_id", "content_base64", "filename", "mime_type"], [], "INSTALLED_GROK_T2I_UPLOAD_INPUT_FIELDS_INVALID");
  assertStrictObject(generate.inputSchema, ["link_attempt_id", "model_id", "prompt", "reference_handles", "parameters"], [], "INSTALLED_GROK_T2I_GENERATE_INPUT_FIELDS_INVALID");
  assertStrictObject(reconcile.inputSchema, ["link_attempt_id", "recovery_id"], [], "INSTALLED_GROK_T2I_RECONCILE_INPUT_FIELDS_INVALID");
  assertStrictObject(list.inputSchema, ["link_attempt_id"], ["limit"], "INSTALLED_GROK_T2I_LIST_INPUT_FIELDS_INVALID");
  assertStrictObject(upload.outputSchema, ["status", "reference_handle", "model_id", "source_mime_type", "mime_type", "width", "height",
    "size", "sha256", "expires_in_seconds", "metadata_confidence", "size_limit_confidence"], [], "INSTALLED_GROK_T2I_UPLOAD_OUTPUT_FIELDS_INVALID");
  assertStrictObject(generate.outputSchema, ["status", "backend_acceptance", "namespace_confidence", "ai_name", "model_id", "operation_id",
    "profile_id", "profile_schema_hash", "catalog_version", "request_fingerprint", "parameters", "reference_count", "artifacts"], [], "INSTALLED_GROK_T2I_GENERATION_OUTPUT_FIELDS_INVALID");
  assertStrictObject(list.outputSchema, ["recoveries"], [], "INSTALLED_GROK_T2I_LIST_OUTPUT_FIELDS_INVALID");
  const attempt = "^link_[A-Za-z0-9_-]{20,120}$";
  const handle = "^grok_t2i_image_[0-9a-f-]{36}$";
  const recovery = "^grok_t2i_recovery_[0-9a-f-]{36}$";
  const uploadIn = properties(upload.inputSchema, code); const genIn = properties(generate.inputSchema, code);
  const uploadOut = properties(upload.outputSchema, code); const genOut = properties(generate.outputSchema, code);
  if (uploadIn.link_attempt_id?.pattern !== attempt || genIn.link_attempt_id?.pattern !== attempt ||
      reconcile.inputSchema.properties?.link_attempt_id?.pattern !== attempt || list.inputSchema.properties?.link_attempt_id?.pattern !== attempt ||
      reconcile.inputSchema.properties?.recovery_id?.pattern !== recovery || !sameArray(genIn.model_id?.enum, MODELS) ||
      !sameArray(uploadIn.model_id?.enum, ["grok_imagine_2", "grok_imagine_quality"])) fail("INSTALLED_GROK_T2I_ID_SCHEMA_INVALID");
  if (genIn.prompt?.minLength !== 1 || genIn.prompt?.maxLength !== 5_000 || genIn.reference_handles?.maxItems !== 5 ||
      genIn.reference_handles?.items?.pattern !== handle || genIn.parameters?.anyOf?.length !== 3 ||
      uploadIn.content_base64?.minLength !== 4 || uploadIn.content_base64?.maxLength !== Math.ceil(64 * 1024 * 1024 / 3) * 4 ||
      !String(uploadIn.content_base64?.pattern ?? "").includes("A-Za-z0-9+/")) {
    fail("INSTALLED_GROK_T2I_INPUT_SCHEMA_INVALID");
  }
  assertGrokParameterBranches(genIn.parameters, "INSTALLED_GROK_T2I_GENERATE_PARAMETER_BRANCH_INVALID");
  if (uploadOut.status?.const !== "uploaded" || uploadOut.reference_handle?.pattern !== handle ||
      !sameArray(uploadOut.source_mime_type?.enum, ["image/jpeg", "image/jpg", "image/png", "image/webp"]) ||
      !sameArray(uploadOut.model_id?.enum, ["grok_imagine_2", "grok_imagine_quality"]) ||
      uploadOut.metadata_confidence?.const !== "CONTAINER_METADATA_ONLY" ||
      uploadOut.size_limit_confidence?.const !== "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" ||
      !sameArray(genOut.model_id?.enum, MODELS) || genOut.status?.const !== "result_observed" || genOut.backend_acceptance?.const !== "UNPROVEN" ||
      genOut.namespace_confidence?.const !== "SOURCE_SHAPED_UNVERIFIED" || genOut.ai_name?.const !== "grok_image" ||
      genOut.operation_id?.const !== "generate-image" || genOut.geometry_verified !== undefined) {
    fail("INSTALLED_GROK_T2I_OUTPUT_SCHEMA_INVALID");
  }
  const outputParams = properties(genOut.parameters, code);
  assertStrictObject(genOut.parameters, ["aspect_ratio", "resolution", "batch_size"], ["details_quality"], "INSTALLED_GROK_T2I_OUTPUT_PARAMETERS_FIELDS_INVALID");
  if (!sameArray(outputParams.aspect_ratio?.enum, ALL_RATIOS) || !sameArray(outputParams.resolution?.enum, RESOLUTIONS) ||
      !sameArray(outputParams.batch_size?.anyOf?.map((x) => x.const), BATCHES) ||
      !sameArray(outputParams.details_quality?.enum, QUALITIES)) fail("INSTALLED_GROK_T2I_OUTPUT_PARAMETER_SCHEMA_INVALID");
  if (genOut.artifacts?.maxItems !== 5 || genOut.reference_count?.maximum !== 5 ||
      !isNullSchema(genOut.artifacts?.items?.properties?.width) || !isNullSchema(genOut.artifacts?.items?.properties?.height) ||
      genOut.artifacts?.items?.properties?.geometry_verified?.const !== false) fail("INSTALLED_GROK_T2I_OUTPUT_SCHEMA_INVALID");
  const listOut = properties(list.outputSchema, code);
  if (listOut.recoveries?.type !== "array" || listOut.recoveries.maxItems !== 20) fail("INSTALLED_GROK_T2I_RECOVERY_SCHEMA_INVALID");
  const recoveryItem = listOut.recoveries.items;
  assertStrictObject(recoveryItem, ["recovery_id", "created_at", "model_id", "operation_id", "status", "diagnostic"], [],
    "INSTALLED_GROK_T2I_RECOVERY_ITEM_FIELDS_INVALID");
  const diagnostic = properties(recoveryItem, code).diagnostic;
  assertStrictObject(diagnostic, ["phase", "post_started", "echo_ack_known", "history_status", "history_reason", "result_status",
    "result_reason", "history_get_calls", "history_get_calls_saturated", "result_get_calls", "result_get_calls_saturated"], [],
    "INSTALLED_GROK_T2I_RECOVERY_DIAGNOSTIC_FIELDS_INVALID");
  const diagnosticFields = properties(diagnostic, code);
  if (recoveryItem.properties.recovery_id?.pattern !== recovery || !sameArray(recoveryItem.properties.model_id?.enum, MODELS) ||
      recoveryItem.properties.operation_id?.const !== "generate-image" || recoveryItem.properties.status?.const !== "OUTCOME_UNKNOWN" ||
      !sameArray(diagnosticFields.phase?.enum, PHASES) || !sameArray(diagnosticFields.history_reason?.anyOf?.find((x) => x.enum)?.enum, HISTORY_REASONS) ||
      !sameArray(diagnosticFields.result_reason?.anyOf?.find((x) => x.enum)?.enum, RESULT_REASONS) ||
      !sameArray(diagnosticFields.history_status?.enum, ["NONE", "PENDING", "READY", "PARTIAL", "UNVERIFIED", "INVALID"]) ||
      !sameArray(diagnosticFields.result_status?.enum, ["NOT_READ", "PENDING", "PARTIAL", "COMPLETE", "UNVERIFIED"]) ||
      diagnosticFields.history_get_calls?.maximum !== 255 || diagnosticFields.result_get_calls?.maximum !== 255) {
    fail("INSTALLED_GROK_T2I_RECOVERY_SCHEMA_INVALID");
  }
  assertAnnotations(upload, false, true, code); assertAnnotations(generate, false, true, code);
  assertAnnotations(reconcile, true, true, code); assertAnnotations(list, true, true, code);
  if (!String(generate.description ?? "").includes("do not repeat") || !String(reconcile.description ?? "").includes("GET-only") ||
      !String(list.description ?? "").includes("process-local")) fail("INSTALLED_GROK_T2I_OPERATION_BOUNDARY_INVALID");
  return counts;
}

export function assertGrokT2iDiagnosticEnums(enums) {
  if (!enums || !sameArray(enums.phases, PHASES) || !sameArray(enums.errorCodes, ERROR_CODES) ||
      !sameArray(enums.historyReasons, HISTORY_REASONS) || !sameArray(enums.resultReasons, RESULT_REASONS)) {
    fail("INSTALLED_GROK_T2I_RECOVERY_ENUMS_INVALID");
  }
  return true;
}

export function assertConsumerSdkResolution({ consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath,
  clientModulePath, stdioModulePath, projectRoot }) {
  if (![consumerPath, resolvedConsumerPath, sdkPackagePath, resolvedSdkPackagePath, clientModulePath, stdioModulePath, projectRoot]
    .every((path) => typeof path === "string" && isAbsolute(path))) fail("INSTALLED_GROK_T2I_SDK_NOT_FROM_CONSUMER");
  const expected = join(resolve(consumerPath), "node_modules", "@modelcontextprotocol", "sdk");
  const sdkRoot = resolve(resolvedSdkPackagePath);
  if (resolve(sdkPackagePath) !== expected || !within(resolvedConsumerPath, sdkRoot) || within(projectRoot, sdkRoot) ||
      !within(sdkRoot, resolve(clientModulePath)) || !within(sdkRoot, resolve(stdioModulePath))) fail("INSTALLED_GROK_T2I_SDK_NOT_FROM_CONSUMER");
  return true;
}

export function grokT2iUnexpectedErrorCode(phase, error) {
  if (!PHASE_NAMES.includes(phase)) fail("INSTALLED_GROK_T2I_DIAGNOSTIC_PHASE_INVALID");
  return `INSTALLED_GROK_T2I_UNEXPECTED_${phase}_${errorClass(error)}`;
}

/** Verifies source-bound controls and exact cost-query inputs without creating an owned candidate or dispatch authority. */
export function assertGrokT2iSourceContract(parameters, costs, profileModule, selectedCatalog, selectedVersion) {
  const source = parameters?.getOwnerGrokT2iSourceParameters?.();
  if (!source || selectedVersion !== DEFAULT_VERSION || !sameArray(source.models, MODELS) ||
      source.profile_id !== "grok-t2i-source-parameters-v1" || source.dispatch_allowed !== false || source.runtime_activation !== false ||
      source.backend_acceptance !== "UNPROVEN" || source.cost_inputs !== null || source.cost_projection_status !== "NOT_JOINED" ||
      source.source_mapping_confidence !== "PINNED_FORM_STATIC_CONTROL_CANDIDATES_NOT_WIRE_OR_RUNTIME_PROOF" ||
      source.defaults_confidence !== "SOURCE_FORM_CANDIDATES_METADATA_ONLY_NOT_NORMALIZER_INJECTION" ||
      !sameArray(source.controls?.aspect_ratio?.base_values, BASE_RATIOS) ||
      !sameArray(source.controls?.aspect_ratio?.imagine_values, IMAGINE_RATIOS) ||
      !sameArray(source.controls?.resolution?.values, RESOLUTIONS) || !sameArray(source.controls?.batch_size?.values, BATCHES) ||
      !sameArray(source.controls?.details_quality?.values, QUALITIES)) fail("INSTALLED_GROK_T2I_COMPILED_API_REGRESSION_FAILED");
  if (source.source_pins?.form_build_id !== "1791467421" || source.source_pins?.form_module !== "grok-image.js" ||
      source.source_pins?.form_sha256 !== FORM_SHA || source.source_pins?.source_execution !== false) fail("INSTALLED_GROK_T2I_SOURCE_PIN_INVALID");
  if (!profileModule || typeof profileModule.getOwnerGrokT2iSourceProfile !== "function" || !selectedCatalog) fail("INSTALLED_GROK_T2I_SOURCE_PROFILE_INVALID");
  let combinations = 0;
  for (const model_id of MODELS) {
    const profile = profileModule.getOwnerGrokT2iSourceProfile(model_id, selectedCatalog, selectedVersion);
    const cap = CAPS[model_id];
    if (profile.profile_id !== "owner-grok-t2i-source-profile-v1" || profile.model_id !== model_id || profile.ai_name !== "grok_image" ||
        profile.model_type !== model_id || profile.operation_id !== "generate-image" || profile.scope !== "image" ||
      profile.public_catalog_version !== selectedVersion || !/^sha256:[a-f0-9]{64}$/u.test(profile.profile_schema_hash) || profile.reference_selector?.minimum !== 0 ||
        profile.reference_selector.maximum !== cap || profile.reference_selector.owned_references_bound !== false ||
        profile.reference_selector.permission !== "SOURCE_SELECTOR_ONLY_NOT_UPLOAD_PERMISSION" || profile.cost_inputs !== null ||
        profile.cost_projection_status !== "NOT_JOINED" || profile.effective_defaults !== "SOURCE_CANDIDATES_ONLY_NOT_RUNTIME_DEFAULTS" ||
        profile.dispatch_allowed !== false || profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN" ||
        profile.source_binding?.selected_public_catalog_version !== selectedVersion ||
        profile.source_binding?.selected_public_source_hashes?.models !== MODELS_HASH ||
        profile.source_binding?.full_public_record_sha256 !== MODEL_RECORD_HASHES[model_id] ||
        profile.source_binding?.full_public_record_verified !== true ||
        profile.source_binding?.source_form?.build_id !== "1791467421" || profile.source_binding?.source_form?.module !== "grok-image.js" ||
        profile.source_binding?.source_form?.sha256 !== FORM_SHA || profile.source_binding?.source_form?.source_execution !== false ||
        profile.source_binding?.source_control_confidence !== "PINNED_STATIC_FORM_SOURCE_NOT_RENDERED_UI_OR_WIRE_PROOF" ||
        profile.public_input_metadata?.max_file_size_interpretation !== "ZERO_UNRESOLVED_NOT_UNLIMITED_OR_PROVIDER_CAP" ||
        profile.parameters_source?.models_by_id?.[model_id]?.reference_count_selector_maximum !== cap ||
        profile.parameters_source?.models_by_id?.[model_id]?.reference_count_confidence !== "PUBLIC_CATALOG_METADATA_ONLY_NOT_UPLOAD_PERMISSION") {
      fail("INSTALLED_GROK_T2I_SOURCE_PROFILE_INVALID");
    }
    for (let reference_count = 0; reference_count <= cap; reference_count += 1) {
      const ratios = model_id === "grok_t2i" || model_id === "grok_t2i_pro" || reference_count > 0 ? BASE_RATIOS : IMAGINE_RATIOS;
      for (const aspect_ratio of ratios) for (const resolution of RESOLUTIONS) for (const batch_size of BATCHES) {
        for (const details_quality of (model_id === "grok_imagine_2" ? QUALITIES : [undefined])) {
          const parameterInput = { aspect_ratio, resolution, batch_size, ...(details_quality === undefined ? {} : { details_quality }) };
          const normalized = parameters.normalizeOwnerGrokT2iParameters({ model_id, reference_count, parameters: parameterInput });
          const projected = costs.projectOwnerGrokT2iCostParameters({ model_id, reference_count, parameters: parameterInput });
          const expected = { batch_size,
            ...(model_id === "grok_imagine_2" || model_id === "grok_imagine_quality" ? { resolution } : {}),
            ...(model_id === "grok_imagine_2" ? { details_quality } : {}),
            ...(model_id === "grok_imagine_2" && reference_count > 0 ? { ref_count: reference_count } : {}) };
          if (normalized.variant !== model_id || normalized.reference_count !== reference_count ||
              !isDeepStrictEqual(normalized.parameters, parameterInput) || normalized.reference_binding?.owned_references_bound !== false ||
              !isDeepStrictEqual(normalized.source_json_mapping, { model_type: model_id, aspect_ratio, resolution, batch_size,
                ...(details_quality === undefined ? {} : { details_quality }) }) ||
              normalized.dispatch_allowed !== false || normalized.runtime_activation !== false || normalized.backend_acceptance !== "UNPROVEN" ||
              projected.model_id !== model_id || !isDeepStrictEqual(projected.routing, { ai_name: "grok_image", model_type: model_id }) ||
              !sameArray(Object.keys(projected.cost_inputs).sort(), Object.keys(expected).sort()) ||
              !isDeepStrictEqual(projected.cost_inputs, expected) || projected.source_binding?.form_sha256 !== FORM_SHA ||
              projected.source_binding?.cost2_sha256 !== COST_SHA ||
              projected.confidence !== "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" ||
              projected.dispatch_allowed !== false || projected.runtime_activation !== false || projected.backend_acceptance !== "UNPROVEN" ||
              Object.hasOwn(projected.cost_inputs, "ai_name") || Object.hasOwn(projected.cost_inputs, "model_type")) {
            fail("INSTALLED_GROK_T2I_PARAMETER_COST_MATRIX_INVALID");
          }
          combinations += 1;
        }
      }
    }
  }
  return Object.freeze({ grok_t2i_models_checked: MODELS.length, parameter_cost_combinations_checked: combinations,
    source_execution_claimed: false, provider_acceptance_claimed: false });
}

export function assertGrokT2iPublicExports(api, modules) {
  const pairs = [["OWNER_GROK_T2I_MODELS", "parameters"], ["getOwnerGrokT2iSourceParameters", "parameters"],
    ["normalizeOwnerGrokT2iParameters", "parameters"], ["OwnerGrokT2iParametersError", "parameters"],
    ["projectOwnerGrokT2iCostParameters", "cost"], ["getOwnerGrokT2iSourceProfile", "profile"],
    ["OwnerGrokT2iSourceProfileError", "profile"], ["OwnerGrokT2iImageUploadService", "upload"],
    ["OwnerGrokT2iImageUploadServiceError", "upload"], ["OwnerGrokT2iGenerationService", "generation"],
    ["OwnerGrokT2iGenerationServiceError", "generation"], ["createOwnerGrokT2iGenerationService", "generation"],
    ["OWNER_GROK_T2I_GENERATION_PHASES", "generation"],
    ["OWNER_GROK_T2I_GENERATION_ERROR_CODES", "generation"], ["OWNER_GROK_T2I_HISTORY_REASONS", "generation"],
    ["OWNER_GROK_T2I_RESULT_REASONS", "generation"], ["registerSyntxOwnerGrokT2iImageTools", "tools"],
    ["createMcpServer", "server"], ["createObservedOwnerRuntime", "runtime"]];
  if (pairs.some(([key, from]) => typeof api[key] === "undefined" || api[key] !== modules[from][key])) fail("INSTALLED_GROK_T2I_PUBLIC_EXPORT_MISMATCH");
  for (const name of ["SYNTX_UPLOAD_GROK_T2I_IMAGE_REFERENCE_TOOL_NAME", "SYNTX_OWNER_GENERATE_GROK_T2I_IMAGE_TOOL_NAME",
    "SYNTX_OWNER_RECONCILE_GROK_T2I_IMAGE_TOOL_NAME", "SYNTX_OWNER_LIST_GROK_T2I_IMAGE_RECOVERIES_TOOL_NAME", "OWNER_GROK_T2I_IMAGE_TOOL_NAMES"]) {
    if (api[name] !== modules.tools[name]) fail("INSTALLED_GROK_T2I_PUBLIC_EXPORT_MISMATCH");
  }
  const forbidden = ["OwnerGrokT2iRequestPreparer", "OwnerGrokT2iPreparedCandidate", "OwnerGrokT2iOwnedAssetSet",
    "OwnerGrokT2iOneShotPermit", "createOwnerGrokT2iOneShotPermit", "consumeOwnerGrokT2iOneShotPermit",
    "InternalGrokT2iImageBatchResult", "OwnerGrokT2iOwnedReferenceResolution"];
  if (forbidden.some((name) => Object.hasOwn(api, name))) fail("INSTALLED_GROK_T2I_PRIVATE_EXPORT_LEAK");
  return true;
}
