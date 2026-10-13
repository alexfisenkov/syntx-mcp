import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class SeedreamEditorInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "SeedreamEditorInstalledCheckError"; this.code = code; }
}

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const C5 = "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json";
const SETTINGS_62 = "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json";
const VARIANTS = Object.freeze(["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"]);
const TOOL_NAMES = Object.freeze([
  "syntx_get_seedream_editor_image_parameters", "syntx_upload_seedream_editor_original", "syntx_upload_seedream_editor_drawing",
  "syntx_owner_generate_seedream_editor_image", "syntx_owner_reconcile_seedream_editor_image",
  "syntx_owner_list_seedream_editor_image_recoveries", "syntx_owner_get_seedream_editor_image_result_page"
]);
const SOURCE_MODULES = Object.freeze([
  "adapter/syntx/chat-http-client", "adapter/syntx/owner-seedream-editor-image-result",
  "application/owner-seedream-editor-parameters", "application/owner-seedream-editor-generation-parameters",
  "application/owner-seedream-editor-original-validator", "application/owner-seedream-editor-original-upload-source-profile",
  "application/owner-seedream-editor-original-reference-service", "application/owner-seedream-editor-drawing-input-validator",
  "application/owner-seedream-editor-drawing-source-profile", "application/owner-seedream-editor-drawing-reference-service",
  "application/owner-seedream-editor-generation-source-profile", "application/owner-seedream-editor-image-request-preparer",
  "application/owner-seedream-editor-image-one-shot-policy", "application/owner-seedream-editor-image-generation-service",
  "application/owner-seedream-editor-image-history-binding", "application/account-status", "application/model-access",
  "auth/in-memory-auth-store", "auth/link-service", "mcp/owner-seedream-editor-image-tools", "mcp/server",
  "runtime/observed-owner-runtime", "transports/stdio-owner", "catalog/selected-discovery-catalog",
  "catalog/public-catalog-history", "catalog/mapless-settings-inventory", "domain/generation-contract"
]);
export const SEEDREAM_EDITOR_REQUIRED_PACKAGE_PATHS = Object.freeze([
  "dist/src/index.js", "dist/src/index.d.ts", ...SOURCE_MODULES.flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`]),
  `catalog/public/${C5}`, `catalog/settings/v2/${SETTINGS_62}`
]);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const FIXED_NOW = Date.parse("2026-10-12T12:00:00.000Z");

export function assertSeedreamEditorPackagePaths(paths) {
  if (!(paths instanceof Set)) fail("INSTALLED_SEEDREAM_EDITOR_PACKAGE_PATHS_INVALID");
  if (SEEDREAM_EDITOR_REQUIRED_PACKAGE_PATHS.some((path) => !paths.has(path))) fail("INSTALLED_SEEDREAM_EDITOR_PACKAGE_CONTENT_MISSING");
  return true;
}

export function assertSeedreamEditorToolNames(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_SEEDREAM_EDITOR_TOOL_LIST_INVALID");
  const names = tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length) fail("INSTALLED_SEEDREAM_EDITOR_DEFAULT_OFF_FAILED");
    return Object.freeze({ tool_count: 0 });
  }
  if (names.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => names.filter((entry) => entry === name).length !== 1)) {
    fail("INSTALLED_SEEDREAM_EDITOR_TOOL_SET_MISMATCH");
  }
  return Object.freeze({ tool_count: TOOL_NAMES.length });
}

export function assertSeedreamEditorToolSurface(tools, enabled) {
  const result = assertSeedreamEditorToolNames(tools, enabled); if (!enabled) return result;
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const expected = [[], ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"],
    ["link_attempt_id", "variant", "original_handle", "content_base64", "filename", "mime_type"],
    ["link_attempt_id", "variant", "prompt", "parameters", "original_handle", "drawing_handle"],
    ["link_attempt_id", "recovery_id"], ["link_attempt_id"], ["link_attempt_id", "result_id", "offset"]];
  for (const [i, name] of TOOL_NAMES.entries()) {
    const tool = byName.get(name);
    if (i === 1 || i === 3) {
      const branches = tool?.inputSchema?.anyOf ?? tool?.inputSchema?.oneOf;
      if (!Array.isArray(branches) || branches.length !== VARIANTS.length) fail("INSTALLED_SEEDREAM_EDITOR_VARIANT_SCHEMA_INVALID");
      if (tool.inputSchema.type === "object") {
        assertClosedObjectSchema(tool.inputSchema, expected[i], [], "INSTALLED_SEEDREAM_EDITOR_VARIANT_SCHEMA_INVALID");
      }
      for (const [branchIndex, branch] of branches.entries()) {
        assertClosedObjectSchema(branch, expected[i], [], "INSTALLED_SEEDREAM_EDITOR_VARIANT_SCHEMA_INVALID");
        if (branch.properties?.variant?.const !== VARIANTS[branchIndex]) fail("INSTALLED_SEEDREAM_EDITOR_VARIANT_SCHEMA_INVALID");
      }
    } else {
      assertClosedObjectSchema(tool?.inputSchema, expected[i], i === 5 || i === 6 ? ["limit"] : [],
        `INSTALLED_SEEDREAM_EDITOR_TOOL_SCHEMA_INVALID_${i}`);
    }
    assertAllObjectSchemasClosed(tool.inputSchema, "INSTALLED_SEEDREAM_EDITOR_TOOL_SCHEMA_INVALID");
    assertAllObjectSchemasClosed(tool.outputSchema, "INSTALLED_SEEDREAM_EDITOR_TOOL_OUTPUT_SCHEMA_INVALID");
  }
  const page = byName.get(TOOL_NAMES[6]);
  if (page.annotations?.readOnlyHint !== true || page.annotations?.destructiveHint !== false ||
      page.annotations?.idempotentHint !== true || page.annotations?.openWorldHint !== false) fail("INSTALLED_SEEDREAM_EDITOR_PAGE_ANNOTATION_INVALID");
  return Object.freeze({ tool_count: 7, closed_schemas: true, variants: 5 });
}

export function assertSeedreamEditorPublicExports(api, modules) {
  const pairs = [
    ["getOwnerSeedreamEditorSourceParameters", "parameters"], ["normalizeOwnerSeedreamEditorParameters", "parameters"],
    ["projectOwnerSeedreamEditorCostParameters", "parameters"], ["normalizeOwnerSeedreamEditorGenerationParameters", "generationParameters"],
    ["OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES", "tools"], ["OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_INPUT_SCHEMAS", "tools"],
    ["OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_OUTPUT_SCHEMAS", "tools"], ["SYNTX_GET_SEEDREAM_EDITOR_IMAGE_PARAMETERS_TOOL_NAME", "tools"],
    ["SYNTX_UPLOAD_SEEDREAM_EDITOR_ORIGINAL_TOOL_NAME", "tools"], ["SYNTX_UPLOAD_SEEDREAM_EDITOR_DRAWING_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_GENERATE_SEEDREAM_EDITOR_IMAGE_TOOL_NAME", "tools"], ["SYNTX_OWNER_RECONCILE_SEEDREAM_EDITOR_IMAGE_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_LIST_SEEDREAM_EDITOR_IMAGE_RECOVERIES_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_GET_SEEDREAM_EDITOR_IMAGE_RESULT_PAGE_TOOL_NAME", "tools"], ["registerSyntxOwnerSeedreamEditorImageTools", "tools"]
  ];
  if (!isRecord(api) || pairs.some(([name, module]) => !isRecord(modules[module]) || api[name] === undefined || api[name] !== modules[module][name])) {
    fail("INSTALLED_SEEDREAM_EDITOR_PUBLIC_EXPORT_MISMATCH");
  }
  for (const name of Object.keys(api)) if (/OwnerSeedreamEditor.*(?:PreparedCandidate|PrivateRequest|OneShotPermit|PrivateResolution|ResolverContext|WeakMap|GenerationPermit)/u.test(name) ||
      /^(?:create|consume|revalidate)OwnerSeedreamEditorImage(?:OneShot|Prepared|Private)/u.test(name)) fail("INSTALLED_SEEDREAM_EDITOR_PRIVATE_BARREL_EXPORT");
  return true;
}

export function assertSeedreamEditorPublicDeclarations(text) {
  if (typeof text !== "string") fail("INSTALLED_SEEDREAM_EDITOR_DECLARATIONS_INVALID");
  const required = ["OwnerSeedreamEditorVariant", "OwnerSeedreamEditorParameters", "OwnerSeedreamEditorCostParameters",
    "OwnerSeedreamEditorImageGenerateInput", "OwnerSeedreamEditorImageGenerationResult", "OwnerSeedreamEditorImageResultPage",
    "OwnerSeedreamEditorImageServiceComposition", "SYNTX_OWNER_GET_SEEDREAM_EDITOR_IMAGE_RESULT_PAGE_TOOL_NAME"];
  if (required.some((name) => !text.includes(name))) fail("INSTALLED_SEEDREAM_EDITOR_DECLARATIONS_INVALID");
  const forbidden = ["OwnerSeedreamEditorImagePreparedCandidate", "OwnerSeedreamEditorImageRequestPreparer", "OwnerSeedreamEditorImageOneShotPermit",
    "OwnerSeedreamEditorOriginalPrivateResolution", "OwnerSeedreamEditorDrawingPrivateResolution", "OwnerSeedreamEditorResolverContext"];
  if (forbidden.some((name) => new RegExp(`export\\s+(?:declare\\s+)?(?:type\\s+)?(?:class|interface|type|const|function)\\s+${name}\\b`, "u").test(text))) {
    fail("INSTALLED_SEEDREAM_EDITOR_PRIVATE_DECLARATION_LEAK");
  }
  return true;
}

export function assertSeedreamEditorSourceMatrix(parametersModule) {
  const source = parametersModule?.getOwnerSeedreamEditorSourceParameters?.();
  if (!isRecord(source) || source.runtime_usable !== false || source.dispatch_allowed !== false || source.backend_acceptance !== "UNPROVEN" ||
      !sameArray(source.model_variants, VARIANTS) || source.aspect_ratios.length !== 8) fail("INSTALLED_SEEDREAM_EDITOR_SOURCE_MATRIX_INVALID");
  let pairs = 0;
  for (const variant of VARIANTS) {
    const resolutions = source.resolutions_by_variant[variant];
    if (!Array.isArray(resolutions) || !resolutions.length) fail("INSTALLED_SEEDREAM_EDITOR_SOURCE_MATRIX_INVALID");
    for (const aspect_ratio of source.aspect_ratios) for (const resolution of resolutions) {
      const intent = parametersModule.normalizeOwnerSeedreamEditorParameters({ variant, parameters: { aspect_ratio, resolution } });
      if (intent.variant !== variant || intent.parameters.aspect_ratio !== aspect_ratio || intent.parameters.resolution !== resolution) fail("INSTALLED_SEEDREAM_EDITOR_SOURCE_MATRIX_INVALID");
      const empty = parametersModule.projectOwnerSeedreamEditorCostParameters({ variant, parameters: intent.parameters, can_reset: false });
      const drawn = parametersModule.projectOwnerSeedreamEditorCostParameters({ variant, parameters: intent.parameters, can_reset: true });
      if (variant === "seedream-5.0-pro") {
        if (empty.batch_size !== 1 || drawn.batch_size !== 2 || empty.resolution !== resolution || drawn.resolution !== resolution) fail("INSTALLED_SEEDREAM_EDITOR_COST_MATRIX_INVALID");
      } else if (Object.keys(empty).length || Object.keys(drawn).length) fail("INSTALLED_SEEDREAM_EDITOR_COST_MATRIX_INVALID");
      pairs += 1;
    }
  }
  if (pairs !== 104) fail("INSTALLED_SEEDREAM_EDITOR_SOURCE_MATRIX_INVALID");
  return Object.freeze({ variants: 5, parameter_pairs: pairs, cost_cases: 208 });
}

export function formatSeedreamEditorInstalledSummary(proof) {
  const counters = ["default_tools", "opt_in_tools", "variants_checked", "parameter_pairs_checked", "cost_cases_checked",
    "original_uploads", "drawing_uploads", "generation_posts", "ready_artifacts", "account_reads", "model_access_reads",
    "result_gets", "page_reads", "page_size", "page_observations", "partial_results", "unknown_model_echo", "unsafe_url_cases",
    "model_mismatch_cases", "expired_source_rejections", "replay_posts", "default_stderr_bytes", "opt_in_stderr_bytes",
    "default_network_calls", "opt_in_network_calls"];
  if (!isRecord(proof) || proof.status !== "INSTALLED_STOCK_SDK_EDITOR_CALLTOOL_PASS" || proof.node_version !== "24.21.0" ||
      proof.sdk_version !== "1.32.1" || proof.clean_installed_package !== true || proof.default_tools !== 0 || proof.opt_in_tools !== 7 ||
      proof.variants_checked !== 5 || proof.parameter_pairs_checked !== 104 || proof.cost_cases_checked !== 208 ||
      proof.original_uploads !== 12 || proof.drawing_uploads !== 5 || proof.generation_posts !== 12 || proof.ready_artifacts !== 89 ||
      proof.account_reads !== 52 || proof.model_access_reads !== 26 || proof.result_gets !== 40 ||
      proof.unknown_get_only !== true || proof.replay_posts !== 0 || proof.page_size !== 64 ||
      proof.page_observations !== 80 || proof.page_reads !== 1 || proof.page_get_post_delta !== 0 || proof.partial_results !== 1 ||
      proof.unknown_model_echo !== 1 || proof.unsafe_url_cases !== 1 || proof.model_mismatch_cases !== 1 || proof.expired_source_rejections !== 1 ||
      proof.source_catalog_version !== C5 || proof.source_settings_version !== SETTINGS_62 || proof.revoke_drain !== "PASS" ||
      proof.eof_drain !== "PASS" || proof.auth_cleanup !== "PASS" ||
      proof.provider_acceptance !== "UNPROVEN" ||
      proof.backend_completion !== "UNPROVEN" || proof.default_child_close !== "CLOSED" || proof.opt_in_child_close !== "CLOSED" ||
      proof.default_child_pid_null !== true || proof.opt_in_child_pid_null !== true || proof.default_network_calls !== 0 || proof.opt_in_network_calls !== 0 ||
      proof.authenticated_network_calls !== 0 || proof.billing_calls !== 0 || counters.some((key) => !Number.isSafeInteger(proof[key]) || proof[key] < 0)) {
    fail("INSTALLED_SEEDREAM_EDITOR_SUMMARY_INVALID");
  }
  return `seedream_editor_installed=${proof.status} node=${proof.node_version} sdk=${proof.sdk_version} clean_package=true ` +
    `default_tools=${proof.default_tools} opt_in_tools=${proof.opt_in_tools} variants=${proof.variants_checked} parameter_pairs=${proof.parameter_pairs_checked} ` +
    `cost_cases=${proof.cost_cases_checked} source_C5=${proof.source_catalog_version} settings_62bc=${proof.source_settings_version} ` +
    `original_uploads=${proof.original_uploads} drawing_uploads=${proof.drawing_uploads} ` +
    `generation_posts=${proof.generation_posts} ready_artifacts=${proof.ready_artifacts} account_reads=${proof.account_reads} ` +
    `model_access_reads=${proof.model_access_reads} result_gets=${proof.result_gets} page_reads=${proof.page_reads} page_size=${proof.page_size} ` +
    `page_observations=${proof.page_observations} page_get_post_delta=${proof.page_get_post_delta} partial_results=${proof.partial_results} ` +
    `unknown_model_echo=${proof.unknown_model_echo} unsafe_url_cases=${proof.unsafe_url_cases} model_mismatch_cases=${proof.model_mismatch_cases} ` +
    `expired_source_rejections=${proof.expired_source_rejections} unknown_get_only=${proof.unknown_get_only} ` +
    `replay_posts=${proof.replay_posts} authenticated_network=${proof.authenticated_network_calls} billing=${proof.billing_calls} ` +
    `revoke_drain=${proof.revoke_drain} eof_drain=${proof.eof_drain} auth_cleanup=${proof.auth_cleanup} ` +
    `default_close=${proof.default_child_close} opt_in_close=${proof.opt_in_child_close} default_pid_null=${proof.default_child_pid_null} ` +
    `opt_in_pid_null=${proof.opt_in_child_pid_null} stderr=${proof.default_stderr_bytes + proof.opt_in_stderr_bytes} ` +
    `stdio_network=${proof.default_network_calls + proof.opt_in_network_calls} backend_completion=${proof.backend_completion} provider_acceptance=${proof.provider_acceptance}`;
}

export async function assertInstalledSeedreamEditorFlow(packagePath, consumerPath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertSeedreamEditorPackagePaths(packagedPaths);
    if (process.versions.node !== "24.21.0") fail("INSTALLED_SEEDREAM_EDITOR_NODE24_21_REQUIRED");
    if (typeof packagePath !== "string" || !isAbsolute(packagePath)) fail("INSTALLED_SEEDREAM_EDITOR_INSTALLED_ROOT_INVALID");
    const root = await realpath(packagePath); if (isWithin(PROJECT_ROOT, root)) fail("INSTALLED_SEEDREAM_EDITOR_NOT_CLEAN_PACKAGE");
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (manifest?.name !== "syntx-mcp") fail("INSTALLED_SEEDREAM_EDITOR_NOT_CLEAN_PACKAGE");
    phase = "packed-import";
    const importPacked = (name) => import(pathToFileURL(join(root, `dist/src/${name}.js`)).href);
    const [api, parameters, generationParameters, originalProfile, generationProfile, generation, tools, runtime, server, stdio,
      catalogModule, settingsModule, authStoreModule, linkModule] = await Promise.all([
      importPacked("index"), importPacked("application/owner-seedream-editor-parameters"), importPacked("application/owner-seedream-editor-generation-parameters"),
      importPacked("application/owner-seedream-editor-original-upload-source-profile"), importPacked("application/owner-seedream-editor-generation-source-profile"),
      importPacked("application/owner-seedream-editor-image-generation-service"), importPacked("mcp/owner-seedream-editor-image-tools"),
      importPacked("runtime/observed-owner-runtime"), importPacked("mcp/server"), importPacked("transports/stdio-owner"),
      importPacked("catalog/selected-discovery-catalog"), importPacked("catalog/mapless-settings-inventory"),
      importPacked("auth/in-memory-auth-store"), importPacked("auth/link-service")
    ]);
    const modules = { parameters, generationParameters, originalProfile, generationProfile, generation, tools };
    assertSeedreamEditorPublicExports(api, modules);
    assertSeedreamEditorPublicDeclarations(await readFile(join(root, "dist/src/index.d.ts"), "utf8"));
    const matrix = assertSeedreamEditorSourceMatrix(parameters);
    const selected = catalogModule.loadSelectedDiscoveryCatalog(C5).discoveryCatalog;
    const settings = settingsModule.loadMaplessSettingsInventoryVersion(SETTINGS_62);
    for (const variant of VARIANTS) {
      const base = originalProfile.getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, selected, C5, settings, SETTINGS_62);
      const joined = generationProfile.getOwnerSeedreamEditorGenerationSourceProfile(variant, base);
      if (base.variant !== variant || base.public_catalog_version !== C5 || base.settings_inventory_version !== SETTINGS_62 ||
          joined.source_binding.public_catalog_version !== C5 || joined.source_binding.settings_inventory_version !== SETTINGS_62) {
        fail("INSTALLED_SEEDREAM_EDITOR_SOURCE_PROFILE_BINDING_INVALID");
      }
    }
    phase = "consumer-sdk"; const sdk = await loadConsumerSdk(consumerPath);
    phase = "stdio-surface";
    const off = await listInstalledTools(root, consumerPath, sdk, false);
    const on = await listInstalledTools(root, consumerPath, sdk, true);
    phase = "installed-calltool";
    const runtimeProof = await runInstalledCallTool({ runtime, server, stdio, catalogModule, settingsModule, authStoreModule, linkModule, parameters }, sdk);
    const revoke = await runRevokeDrain({ runtime });
    const eof = await runEofDrain({ runtime, stdio });
    return composeSeedreamEditorInstalledProof({ runtimeProof, matrix, off, on, sdkVersion: sdk.version,
      nodeVersion: process.versions.node, revokeDrain: revoke, eofDrain: eof });
  } catch (error) { if (error instanceof SeedreamEditorInstalledCheckError) throw error; fail(unexpectedCode(phase, error)); }
}

export function composeSeedreamEditorInstalledProof({ runtimeProof, matrix, off, on, sdkVersion, nodeVersion, revokeDrain, eofDrain }) {
  return Object.freeze({ ...runtimeProof, variants_checked: matrix.variants, parameter_pairs_checked: matrix.parameter_pairs,
    cost_cases_checked: matrix.cost_cases, default_tools: off.tool_count, opt_in_tools: on.tool_count,
    sdk_version: sdkVersion, node_version: nodeVersion, clean_installed_package: true,
    default_child_close: off.child_close, opt_in_child_close: on.child_close,
    default_child_pid_null: off.child_pid_null, opt_in_child_pid_null: on.child_pid_null,
    default_stderr_bytes: off.stderr_bytes, opt_in_stderr_bytes: on.stderr_bytes,
    default_network_calls: off.network_calls, opt_in_network_calls: on.network_calls,
    revoke_drain: revokeDrain, eof_drain: eofDrain, auth_cleanup: "PASS",
    provider_acceptance: "UNPROVEN", backend_completion: "UNPROVEN" });
}

export async function loadConsumerSdk(consumerPath) {
  if (typeof consumerPath !== "string" || !isAbsolute(consumerPath)) fail("INSTALLED_SEEDREAM_EDITOR_CONSUMER_PATH_INVALID");
  const require = createRequire(join(consumerPath, "package.json")); let clientPath, stdioPath, memoryPath;
  try { clientPath = require.resolve("@modelcontextprotocol/sdk/client/index.js"); stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js");
    memoryPath = require.resolve("@modelcontextprotocol/sdk/inMemory.js"); } catch { fail("INSTALLED_SEEDREAM_EDITOR_SDK_RESOLUTION_FAILED"); }
  const sdkRoot = join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk");
  const resolvedSdk = await realpath(sdkRoot), resolvedFiles = await Promise.all([clientPath, stdioPath, memoryPath].map((path) => realpath(path)));
  if (isWithin(PROJECT_ROOT, resolvedSdk) || resolvedFiles.some((file) => !isWithin(resolvedSdk, file))) fail("INSTALLED_SEEDREAM_EDITOR_SDK_NOT_FROM_CONSUMER");
  const manifest = JSON.parse(await readFile(join(resolvedSdk, "package.json"), "utf8"));
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest.version !== "1.32.1") fail("INSTALLED_SEEDREAM_EDITOR_SDK_VERSION_MISMATCH");
  const [{ Client }, { StdioClientTransport }, { InMemoryTransport }] = await Promise.all([import(pathToFileURL(clientPath).href),
    import(pathToFileURL(stdioPath).href), import(pathToFileURL(memoryPath).href)]);
  return { Client, StdioClientTransport, InMemoryTransport, version: manifest.version };
}

export async function listInstalledTools(packageRoot, consumerPath, sdk, enabled) {
  const directory = await mkdtemp(join(tmpdir(), "seedream-editor-installed-audit-")), audit = join(directory, "fetch-count"), preload = join(directory, "network-guard.mjs");
  await writeFile(preload, `import { writeFileSync } from 'node:fs'; let n=0; globalThis.fetch=(...a)=>{n++;return Promise.reject(new Error('NETWORK_DISABLED'));}; process.on('exit',()=>{try{writeFileSync(process.env.SYNTX_EDITOR_FETCH_AUDIT,String(n))}catch{}});\n`, { mode: 0o600 });
  const client = new sdk.Client({ name: enabled ? "seedream-editor-opt-in" : "seedream-editor-default", version: "1.0.0" }, { capabilities: {} });
  const transport = new sdk.StdioClientTransport({ command: process.execPath, args: [join(packageRoot, "dist/src/transports/stdio-owner.js")], cwd: consumerPath,
    env: { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: directory, XDG_DATA_HOME: directory, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      SYNTX_EDITOR_FETCH_AUDIT: audit, ...(enabled ? { SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES: "1" } : {}) }, stderr: "pipe" });
  let closed = false, resolveClosed; const closePromise = new Promise((resolve) => { resolveClosed = resolve; });
  transport.onclose = () => { closed = true; resolveClosed(); }; let stderrBytes = 0; transport.stderr?.on("data", (x) => { stderrBytes += Buffer.byteLength(x); });
  let connected = false, failure, result;
  try { await deadline(client.connect(transport), 5_500, "INSTALLED_SEEDREAM_EDITOR_STDIO_INIT_TIMEOUT"); connected = true;
    const listing = await deadline(client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }), 5_500, "INSTALLED_SEEDREAM_EDITOR_TOOLS_LIST_TIMEOUT");
    result = assertSeedreamEditorToolSurface(listing.tools, enabled);
  } catch (error) { failure = error; }
  finally { try { await deadline(connected ? client.close() : transport.close(), 2_000, "INSTALLED_SEEDREAM_EDITOR_STDIO_CLOSE_FAILED"); } catch (error) { failure ??= error; }
    try { await deadline(closePromise, 2_000, "INSTALLED_SEEDREAM_EDITOR_STDIO_CLOSE_FAILED"); } catch (error) { failure ??= error; } }
  try { if (failure) throw failure; if (!closed || transport.pid !== null || stderrBytes) fail("INSTALLED_SEEDREAM_EDITOR_STDIO_CLOSE_FAILED");
    const networkCalls = Number(await readFile(audit, "utf8")); if (networkCalls !== 0) fail("INSTALLED_SEEDREAM_EDITOR_STDIO_NETWORK_CALLS");
    return Object.freeze({ ...result, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes, network_calls: networkCalls });
  } catch (error) { if (error instanceof SeedreamEditorInstalledCheckError) throw error; fail("INSTALLED_SEEDREAM_EDITOR_STDIO_SURFACE_INVALID"); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

async function runInstalledCallTool(modules, sdk) {
  if (!modules?.runtime?.createObservedOwnerRuntime || !sdk?.InMemoryTransport) fail("INSTALLED_SEEDREAM_EDITOR_RUNTIME_ABI_MISSING");
  return runCallToolScenario(modules, sdk);
}

/** Local synthetic regression seam: callers supply real compiled runtime modules and stock SDK classes. */
export async function runSeedreamEditorCallToolRegression(modules, sdk) {
  if (!modules?.runtime?.createObservedOwnerRuntime || !modules?.server?.createMcpServer ||
      !modules?.stdio?.closeOwnerReadServicesOnTransportEof || !sdk?.Client || !sdk?.InMemoryTransport) {
    fail("INSTALLED_SEEDREAM_EDITOR_RUNTIME_ABI_MISSING");
  }
  return runCallToolScenario(modules, sdk);
}

async function runCallToolScenario(modules, sdk) {
  const counters = { uploads: 0, originalUploads: 0, drawingUploads: 0, chats: 0, posts: 0, balance: 0, subscription: 0,
    model: 0, histories: 0, resultGets: 0 };
  const transactions = new Map(); let now = FIXED_NOW, unknownPost = false, unknownReady = false, unknownChat;
  let announceUnknownPost; const unknownPostStarted = new Promise((resolve) => { announceUnknownPost = resolve; });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); const method = init.method ?? "GET";
    if (url.origin !== "https://api.syntx.ai") fail("INSTALLED_SEEDREAM_EDITOR_UPSTREAM_ORIGIN_INVALID");
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      if (url.search !== "") fail("INSTALLED_SEEDREAM_EDITOR_UPLOAD_ROUTE_INVALID");
      counters.uploads += 1; const form = init.body, file = form?.get("files"), destination = form?.get("destination");
      if (!(file instanceof File) || !sameArray([...form.keys()], ["files", "destination", "check_duplicates", "model_type"]) ||
          form.get("check_duplicates") !== "true" || !VARIANTS.includes(String(form.get("model_type"))) ||
          !["uploaded", "hidden"].includes(String(destination))) fail("INSTALLED_SEEDREAM_EDITOR_UPLOAD_WIRE_INVALID");
      if (destination === "uploaded") counters.originalUploads += 1; else counters.drawingUploads += 1;
      return Response.json({ files: [{ id: `editor-file-${counters.uploads}`, file_id: `editor-file-${counters.uploads}`,
        url: `https://r2.syntx.ai/installed/editor-input-${counters.uploads}.png`,
        ...(destination === "uploaded" ? { mime_type: file.type, size: file.size, status: "accepted" } : {}) }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      if (url.search !== "") fail("INSTALLED_SEEDREAM_EDITOR_CHAT_ROUTE_INVALID");
      counters.chats += 1; const body = JSON.parse(String(init.body));
      if (!sameArray(Object.keys(body).sort(), ["scope", "title"]) || body.scope !== "tool_image_inpaint" || typeof body.title !== "string") {
        fail("INSTALLED_SEEDREAM_EDITOR_CHAT_WIRE_INVALID");
      }
      return Response.json({ uuid: `installed-editor-chat-${counters.chats}` });
    }
    if (url.pathname === "/api/v1/design/generate" && method === "POST") {
      counters.posts += 1;
      if (url.search !== "?ai_name=seedream" || url.searchParams.size !== 1) fail("INSTALLED_SEEDREAM_EDITOR_GENERATION_ROUTE_INVALID");
      const body = JSON.parse(String(init.body)), settings = body.settings, variant = settings?.model_type;
      if (!sameArray(Object.keys(body).sort(), ["chat_uuid", "prompt", "settings"]) ||
          !sameArray(Object.keys(settings ?? {}).sort(), ["aspect_ratio", "file_urls", "model_type", "n", "resolution", "stream"]) ||
          !VARIANTS.includes(variant) || settings.n !== 1 || settings.stream !== false || !Array.isArray(settings.file_urls) ||
          settings.file_urls.length < 1 || settings.file_urls.length > 2 || settings.file_urls.some((entry) => entry.type !== "image")) {
        fail("INSTALLED_SEEDREAM_EDITOR_GENERATION_BODY_INVALID");
      }
      if (settings.file_urls.some((entry) => !sameArray(Object.keys(entry).sort(), ["type", "url"]) || typeof entry.url !== "string" ||
          !entry.url.startsWith("https://r2.syntx.ai/"))) fail("INSTALLED_SEEDREAM_EDITOR_GENERATION_REFERENCES_INVALID");
      const id = counters.posts, chat = body.chat_uuid, ack = `editor-owner-ack-${id}`;
      const mode = body.prompt.includes("unknown-echo") ? "unknown" : body.prompt.includes("partial") ? "partial" :
        body.prompt.includes("unsafe-result") ? "unsafe" : body.prompt.includes("mismatch-model") ? "mismatch" : "normal";
      transactions.set(chat, { id, chat, ack, result: `editor-result-${id}`, providerChat: 8000 + id, variant, mode,
        big: body.prompt.includes("eighty-observed-images"), noAck: body.prompt.includes("unknown-post") });
      if (unknownPost) {
        unknownPost = false; unknownChat = chat; announceUnknownPost();
        throw new Error("Synthetic response lost after possible Editor generation dispatch.");
      }
      return Response.json({ id: ack });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/(installed-editor-chat-\d+)\/inprogress$/u);
    if (inProgress && method === "GET") { if (url.search !== "") fail("INSTALLED_SEEDREAM_EDITOR_INPROGRESS_ROUTE_INVALID"); return Response.json([]); }
    const historyPath = url.pathname.match(/^\/api\/v1\/chats\/(installed-editor-chat-\d+)\/messages$/u);
    if (historyPath && method === "GET") {
      if (JSON.stringify([...url.searchParams.entries()]) !== JSON.stringify([["page", "1"], ["page_size", "10"]])) {
        fail("INSTALLED_SEEDREAM_EDITOR_HISTORY_ROUTE_INVALID");
      }
      counters.histories += 1; const tx = transactions.get(historyPath[1]);
      if (!tx) fail("INSTALLED_SEEDREAM_EDITOR_HISTORY_CONTEXT_INVALID");
      if (historyPath[1] === unknownChat && !unknownReady) return historyResponse([], tx.providerChat);
      if (tx.noAck) return historyResponse([botRow(tx, 1)], tx.providerChat);
      if (tx.big) return historyResponse([{ id: tx.ack, chat_id: tx.providerChat, author_id: 21, message_object: [] }, botRow(tx, 1, 40), botRow(tx, 2, 40)], tx.providerChat);
      return historyResponse([{ id: tx.ack, chat_id: tx.providerChat, author_id: 21, message_object: [] }, botRow(tx, 1)], tx.providerChat);
    }
    const resultPath = url.pathname.match(/^\/api\/v1\/chats\/(installed-editor-chat-\d+)\/(editor-result-\d+(?:-[12])?)$/u);
    if (resultPath && method === "GET") {
      if (url.search !== "") fail("INSTALLED_SEEDREAM_EDITOR_RESULT_ROUTE_INVALID");
      counters.resultGets += 1; const tx = transactions.get(resultPath[1]); if (!tx) fail("INSTALLED_SEEDREAM_EDITOR_RESULT_CONTEXT_INVALID");
      const part = resultPath[2].endsWith("-2") ? 2 : 1;
      const count = tx.big ? 40 : tx.mode === "partial" ? 2 : 1;
      const objects = Array.from({ length: count }, (_, ix) => {
        const incomplete = tx.mode === "partial" && ix === 1;
        const object = { id: `editor-object-${tx.id}-${part}-${ix}`, object_type: ix % 2 ? "image_url" : "image",
          object_url: `${tx.mode === "unsafe" ? "https://untrusted.invalid" : "https://r2.syntx.ai"}/installed/editor-${tx.id}-${part}-${ix}.${ix % 2 ? "webp" : "png"}`,
          completed: !incomplete, ...(tx.mode !== "unknown" ? { model_type: tx.mode === "mismatch" ? "seedream-4" : tx.variant } : {}) };
        return object;
      });
      return Response.json({ id: resultPath[2], chat_id: tx.providerChat, author_id: -1, message_object: objects });
    }
    if (url.pathname === "/api/v1/user/balance" && method === "GET") { if (url.search !== "") fail("INSTALLED_SEEDREAM_EDITOR_BALANCE_ROUTE_INVALID"); counters.balance += 1; return Response.json({ balance: "900" }); }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      if (url.search !== "?ref=false") fail("INSTALLED_SEEDREAM_EDITOR_SUBSCRIPTION_ROUTE_INVALID");
      counters.subscription += 1; return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      const variant = url.searchParams.get("model_type"), keys = [...url.searchParams.keys()].sort();
      const expectedKeys = variant === "seedream-5.0-pro" ? ["ai_name", "batch_size", "model_type", "resolution"] : ["ai_name", "model_type"];
      if (url.searchParams.get("ai_name") !== "seedream" || !VARIANTS.includes(variant) || !sameArray(keys, expectedKeys) ||
          (variant === "seedream-5.0-pro" && (!["1", "2"].includes(url.searchParams.get("batch_size")) ||
            !["1K", "2K"].includes(url.searchParams.get("resolution"))))) {
        fail("INSTALLED_SEEDREAM_EDITOR_MODEL_ACCESS_QUERY_INVALID");
      }
      counters.model += 1; return Response.json({ access: true, cost: 3, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: null }); }
    fail("INSTALLED_SEEDREAM_EDITOR_SYNTHETIC_ROUTE_UNEXPECTED");
  };
  const runtime = modules.runtime.createObservedOwnerRuntime({ ownerSeedreamEditorImageReferencesEnabled: true, fetchImpl,
    now: () => now, requestTimeoutMs: 2_000 });
  const server = modules.server.createMcpServer(runtime.application, runtime.serverOptions), client = new sdk.Client({ name: "seedream-editor-installed-calltool", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = sdk.InMemoryTransport.createLinkedPair();
  const attempt = (tag) => `link_editor_${tag}_0123456789`;
  const linkAttempt = async (id, expiryMs = 60_000) => linkSyntheticAttempt(runtime, id, now + expiryMs);
  const call = async (index, args, opts) => client.callTool({ name: TOOL_NAMES[index], arguments: args }, undefined, opts);
  let posts = 0, artifacts = 0, pageReads = 0, pageDelta = 0, replayPosts = 0, unknownGetOnly = false;
  let partialResults = 0, unknownModelEcho = 0, unsafeUrlCases = 0, modelMismatchCases = 0, expiredSourceRejections = 0;
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const listing = await client.listTools(); assertSeedreamEditorToolSurface(listing.tools, true);
    const sourceTool = await call(0, {});
    if (sourceTool.isError || sourceTool.structuredContent?.backend_acceptance !== "UNPROVEN") fail("INSTALLED_SEEDREAM_EDITOR_SOURCE_TOOL_FAILED");
    const sourceVariants = sourceTool.structuredContent.variants;
    const expectedSource = modules.parameters.getOwnerSeedreamEditorSourceParameters();
    if (!sameArray(sourceVariants.map((entry) => entry.variant), expectedSource.model_variants) ||
        sourceVariants.some((entry) => !sameArray(entry.aspect_ratios, expectedSource.aspect_ratios) ||
          !sameArray(entry.resolutions, expectedSource.resolutions_by_variant[entry.variant]))) fail("INSTALLED_SEEDREAM_EDITOR_SOURCE_CALLTOOL_MATRIX_MISMATCH");
    let pairs = 0;
    for (const row of sourceVariants) pairs += row.aspect_ratios.length * row.resolutions.length;
    if (sourceVariants.length !== 5 || pairs !== 104) fail("INSTALLED_SEEDREAM_EDITOR_SOURCE_CALLTOOL_MATRIX_INVALID");

    for (const [index, variant] of VARIANTS.entries()) {
      const id = attempt(`variant_${index}`); await linkAttempt(id);
      const original = await call(1, { link_attempt_id: id, variant, content_base64: PNG.toString("base64"), filename: `o-${index}.png`, mime_type: "image/png" });
      if (original.isError) fail("INSTALLED_SEEDREAM_EDITOR_ORIGINAL_UPLOAD_FAILED");
      const drawing = await call(2, { link_attempt_id: id, variant, original_handle: original.structuredContent.reference_handle,
        content_base64: PNG.toString("base64"), filename: `d-${index}.png`, mime_type: "image/png" });
      if (drawing.isError) fail("INSTALLED_SEEDREAM_EDITOR_DRAWING_UPLOAD_FAILED");
      const row = sourceVariants.find((entry) => entry.variant === variant), params = { aspect_ratio: row.aspect_ratios[0], resolution: row.resolutions[0] };
      const withDrawing = await call(3, { link_attempt_id: id, variant, prompt: `installed variant ${variant}`, parameters: params,
        original_handle: original.structuredContent.reference_handle, drawing_handle: drawing.structuredContent.drawing_handle });
      if (withDrawing.isError || withDrawing.structuredContent?.status !== "completed" || withDrawing.structuredContent?.model_echo !== "MATCHED" ||
          withDrawing.structuredContent?.backend_acceptance !== "UNPROVEN" || withDrawing.structuredContent?.status_semantics !== "LOCAL_OBSERVED_AVAILABILITY_ONLY") {
        fail("INSTALLED_SEEDREAM_EDITOR_VARIANT_GENERATION_INVALID");
      }
      artifacts += withDrawing.structuredContent.artifacts.length;
      if (variant === "seedream-5.0-pro") {
        const originalOnly = await call(3, { link_attempt_id: id, variant, prompt: "installed pro B1", parameters: params,
          original_handle: original.structuredContent.reference_handle, drawing_handle: null });
        if (originalOnly.isError || originalOnly.structuredContent?.cost_inputs?.batch_size !== 1) fail("INSTALLED_SEEDREAM_EDITOR_PRO_B1_INVALID");
        artifacts += originalOnly.structuredContent.artifacts.length;
        const paired = withDrawing.structuredContent;
        if (paired.cost_inputs?.batch_size !== 2) fail("INSTALLED_SEEDREAM_EDITOR_PRO_B2_INVALID");
      }
    }

    const bigAttempt = attempt("paging"); await linkAttempt(bigAttempt);
    const original = await call(1, { link_attempt_id: bigAttempt, variant: "seedream-5", content_base64: PNG.toString("base64"), filename: "page.png", mime_type: "image/png" });
    if (original.isError) fail("INSTALLED_SEEDREAM_EDITOR_PAGE_UPLOAD_FAILED");
    const large = await call(3, { link_attempt_id: bigAttempt, variant: "seedream-5", prompt: "eighty-observed-images", parameters: { aspect_ratio: "1:1", resolution: "2K" },
      original_handle: original.structuredContent.reference_handle, drawing_handle: null });
    if (large.isError || large.structuredContent?.observed_total !== 80 || large.structuredContent.artifacts.length !== 64 ||
        large.structuredContent.next_offset !== 64 || !large.structuredContent.has_more) fail("INSTALLED_SEEDREAM_EDITOR_PAGE_ONE_INVALID");
    const beforePage = { get: counters.resultGets, post: counters.posts };
    const second = await call(6, { link_attempt_id: bigAttempt, result_id: large.structuredContent.result_id, offset: 64, limit: 64 });
    if (second.isError || second.structuredContent?.artifacts.length !== 16 || second.structuredContent?.has_more || second.structuredContent?.observed_total !== 80) {
      fail("INSTALLED_SEEDREAM_EDITOR_PAGE_TWO_INVALID");
    }
    pageReads = 1; pageDelta = counters.resultGets - beforePage.get + counters.posts - beforePage.post; artifacts += 80;
    if (pageDelta !== 0) fail("INSTALLED_SEEDREAM_EDITOR_PAGE_REACHED_PROVIDER");

    const unknownAttempt = attempt("unknown"); await linkAttempt(unknownAttempt); unknownPost = true;
    const originalUnknown = await call(1, { link_attempt_id: unknownAttempt, variant: "seedream-4.5", content_base64: PNG.toString("base64"), filename: "unknown.png", mime_type: "image/png" });
    if (originalUnknown.isError) fail("INSTALLED_SEEDREAM_EDITOR_UNKNOWN_UPLOAD_FAILED");
    const uncertain = call(3, { link_attempt_id: unknownAttempt, variant: "seedream-4.5", prompt: "unknown-post no retry", parameters: { aspect_ratio: "1:1", resolution: "2K" },
      original_handle: originalUnknown.structuredContent.reference_handle, drawing_handle: null });
    await deadline(unknownPostStarted, 4_000, "INSTALLED_SEEDREAM_EDITOR_UNKNOWN_POST_NOT_REACHED");
    const uncertainResult = await uncertain.catch(() => null);
    if (!uncertainResult?.isError) fail("INSTALLED_SEEDREAM_EDITOR_UNKNOWN_POST_NOT_REPORTED");
    unknownReady = true;
    const recoveryList = await call(5, { link_attempt_id: unknownAttempt });
    const recovery = recoveryList.structuredContent?.recoveries?.[0]; if (recoveryList.isError || !recovery) fail("INSTALLED_SEEDREAM_EDITOR_RECOVERY_NOT_LISTED");
    const postCount = counters.posts, accountCount = counters.balance + counters.subscription, accessCount = counters.model, getCount = counters.resultGets;
    const reconciled = await call(4, { link_attempt_id: unknownAttempt, recovery_id: recovery.recovery_id });
    if (reconciled.isError || reconciled.structuredContent?.status !== "partial_results" || reconciled.structuredContent.model_echo !== "MATCHED") {
      fail("INSTALLED_SEEDREAM_EDITOR_GET_ONLY_RECOVERY_INVALID");
    }
    artifacts += reconciled.structuredContent.artifacts.length;
    const recoveryWasGetOnly = counters.posts === postCount && counters.balance + counters.subscription === accountCount &&
      counters.model === accessCount && counters.resultGets > getCount;
    const retry = await call(3, { link_attempt_id: unknownAttempt, variant: "seedream-4.5", prompt: "unknown-post no retry", parameters: { aspect_ratio: "1:1", resolution: "2K" },
      original_handle: originalUnknown.structuredContent.reference_handle, drawing_handle: null });
    replayPosts = counters.posts - postCount; unknownGetOnly = recoveryWasGetOnly && replayPosts === 0 && retry.isError;
    if (!unknownGetOnly) fail("INSTALLED_SEEDREAM_EDITOR_UNKNOWN_POST_REPLAYED");

    const unknownEchoAttempt = attempt("echo_unknown"); await linkAttempt(unknownEchoAttempt);
    const echoOriginal = await call(1, { link_attempt_id: unknownEchoAttempt, variant: "seedream-5", content_base64: PNG.toString("base64"), filename: "echo.png", mime_type: "image/png" });
    const unknownEcho = await call(3, { link_attempt_id: unknownEchoAttempt, variant: "seedream-5", prompt: "unknown-echo", parameters: { aspect_ratio: "1:1", resolution: "2K" },
      original_handle: echoOriginal.structuredContent.reference_handle, drawing_handle: null });
    if (unknownEcho.isError || unknownEcho.structuredContent?.model_echo !== "UNKNOWN" || unknownEcho.structuredContent?.status !== "partial_results") {
      fail("INSTALLED_SEEDREAM_EDITOR_UNKNOWN_ECHO_INVALID");
    }
    unknownModelEcho += 1; artifacts += unknownEcho.structuredContent.artifacts.length;
    const totals = counters.posts;
    const foreign = await call(3, { link_attempt_id: attempt("foreign"), variant: "seedream-5", prompt: "foreign scope", parameters: { aspect_ratio: "1:1", resolution: "2K" },
      original_handle: echoOriginal.structuredContent.reference_handle, drawing_handle: null });
    if (!foreign.isError || counters.posts !== totals) fail("INSTALLED_SEEDREAM_EDITOR_FOREIGN_ATTEMPT_DISPATCHED");

    const partialAttempt = attempt("partial"); await linkAttempt(partialAttempt);
    const partialOriginal = await call(1, { link_attempt_id: partialAttempt, variant: "seedream-5", content_base64: PNG.toString("base64"), filename: "partial.png", mime_type: "image/png" });
    const partialResult = await call(3, { link_attempt_id: partialAttempt, variant: "seedream-5", prompt: "partial result object", parameters: { aspect_ratio: "1:1", resolution: "2K" },
      original_handle: partialOriginal.structuredContent.reference_handle, drawing_handle: null });
    if (partialResult.isError || partialResult.structuredContent?.status !== "partial_results" || partialResult.structuredContent.artifacts.length !== 1) {
      fail("INSTALLED_SEEDREAM_EDITOR_PARTIAL_RESULT_INVALID");
    }
    partialResults += 1; artifacts += 1;

    for (const mode of ["unsafe-result", "mismatch-model"]) {
      const modeAttempt = attempt(mode); await linkAttempt(modeAttempt);
      const upload = await call(1, { link_attempt_id: modeAttempt, variant: "seedream-5", content_base64: PNG.toString("base64"), filename: `${mode}.png`, mime_type: "image/png" });
      const beforeMode = counters.posts;
      const failed = await call(3, { link_attempt_id: modeAttempt, variant: "seedream-5", prompt: mode, parameters: { aspect_ratio: "1:1", resolution: "2K" },
        original_handle: upload.structuredContent.reference_handle, drawing_handle: null });
      if (!failed.isError || counters.posts !== beforeMode + 1) fail("INSTALLED_SEEDREAM_EDITOR_GAP_OUTCOME_INVALID");
      if (mode === "unsafe-result") unsafeUrlCases += 1; else modelMismatchCases += 1;
    }

    const expiryAttempt = attempt("expired"); await linkAttempt(expiryAttempt, 2 * 60 * 60_000);
    const expiryOriginal = await call(1, { link_attempt_id: expiryAttempt, variant: "seedream-5", content_base64: PNG.toString("base64"), filename: "expires.png", mime_type: "image/png" });
    now += 901_000; const beforeExpired = counters.posts;
    const expired = await call(3, { link_attempt_id: expiryAttempt, variant: "seedream-5", prompt: "expired original", parameters: { aspect_ratio: "1:1", resolution: "2K" },
      original_handle: expiryOriginal.structuredContent.reference_handle, drawing_handle: null });
    if (!expired.isError || counters.posts !== beforeExpired) fail("INSTALLED_SEEDREAM_EDITOR_EXPIRED_REFERENCE_DISPATCHED");
    expiredSourceRejections += 1;
    return Object.freeze({ status: "INSTALLED_STOCK_SDK_EDITOR_CALLTOOL_PASS", generation_posts: counters.posts, original_uploads: counters.originalUploads,
      drawing_uploads: counters.drawingUploads, ready_artifacts: artifacts, account_reads: counters.balance + counters.subscription,
      model_access_reads: counters.model, result_gets: counters.resultGets, page_reads: pageReads, page_size: 64,
      page_observations: 80, page_get_post_delta: pageDelta, source_catalog_version: C5, source_settings_version: SETTINGS_62,
      partial_results: partialResults, unknown_model_echo: unknownModelEcho,
      unsafe_url_cases: unsafeUrlCases, model_mismatch_cases: modelMismatchCases, expired_source_rejections: expiredSourceRejections,
      unknown_get_only: unknownGetOnly, replay_posts: replayPosts,
      authenticated_network_calls: 0, billing_calls: 0, auth_cleanup: "PASS" });
  } finally {
    await client.close(); await server.close();
    await runtime.ownerSeedreamEditorImageReferencesLifecycle?.close();
    await runtime.authStore.close?.();
  }

  function historyResponse(messages, providerChat) {
    return Response.json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
      total_pages: messages.length === 0 ? 0 : Math.ceil(messages.length / 10), has_next: false, has_previous: false } });
  }
  function botRow(tx, part, count = 1) {
    const id = `editor-result-${tx.id}-${part}`;
    return { id, chat_id: tx.providerChat, author_id: -1, message_object: Array.from({ length: count }, (_, ix) => ({ id: `editor-object-${tx.id}-${part}-${ix}`,
      message_id: id, object_type: ix % 2 ? "image_url" : "image",
      model_type: tx.mode === "unknown" ? null : tx.mode === "mismatch" ? "seedream-4" : tx.variant })) };
  }
}

async function linkSyntheticAttempt(runtime, attemptId, expiresAt) {
  const store = runtime.authStore, binding = runtime.authBinding;
  await store.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: expiresAt });
  await store.beginHandoff(binding, attemptId); await store.attachChallenge(binding, attemptId, `synthetic-${attemptId}`);
  await store.beginPoll(binding, attemptId); await store.markLinked(binding, attemptId, { scheme: "Bearer", value: `synthetic-${attemptId}` });
}

export async function runRevokeDrain(modules) {
  const runtime = modules.runtime.createObservedOwnerRuntime({ ownerSeedreamEditorImageReferencesEnabled: true, now: () => FIXED_NOW });
  const composition = runtime.serverOptions.ownerSeedreamEditorImageReferences, auth = runtime.serverOptions.auth;
  if (!composition || !auth) fail("INSTALLED_SEEDREAM_EDITOR_REVOKE_COMPOSITION_MISSING");
  const attempt = "link_editor_revoke_0123456789", binding = runtime.authBinding;
  await linkSyntheticAttempt(runtime, attempt, FIXED_NOW + 60_000);
  await auth.linkService.revoke(binding, attempt);
  const status = await runtime.linkService.getStatus(binding, attempt);
  if (status.linked !== false || status.status === "LINKED") fail("INSTALLED_SEEDREAM_EDITOR_REVOKE_DRAIN_FAILED");
  await runtime.ownerSeedreamEditorImageReferencesLifecycle.close();
  await runtime.authStore.close?.();
  return "PASS";
}

export async function runEofDrain(modules) {
  const runtime = modules.runtime.createObservedOwnerRuntime({ ownerSeedreamEditorImageReferencesEnabled: true, now: () => FIXED_NOW });
  const lifecycle = runtime.ownerSeedreamEditorImageReferencesLifecycle;
  if (!lifecycle || typeof lifecycle.close !== "function") fail("INSTALLED_SEEDREAM_EDITOR_EOF_COMPOSITION_MISSING");
  const events = [], transport = { onclose: undefined, async start() {}, async send() {}, async close() { this.onclose?.(); } }, input = new PassThrough();
  const lifecycleAdapter = { async close() { events.push("generation_and_references"); await lifecycle.close(); } };
  const close = modules.stdio.closeOwnerReadServicesOnTransportEof(transport, undefined, undefined, undefined, undefined,
    () => events.push("auth_release"), input, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, true, undefined, undefined, lifecycleAdapter);
  const closed = new Promise((resolve) => { transport.onclose = resolve; }); input.resume(); input.end(); await deadline(closed, 2_000, "INSTALLED_SEEDREAM_EDITOR_EOF_CLOSE_TIMEOUT");
  await close(); input.destroy(); await runtime.authStore.close?.();
  if (events[0] !== "generation_and_references" || events.at(-1) !== "auth_release") fail("INSTALLED_SEEDREAM_EDITOR_EOF_ORDER_INVALID");
  return "PASS";
}

function assertClosedObjectSchema(schema, required, optional, code) {
  if (!isRecord(schema) || schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(schema.properties ?? {}).sort(), [...required, ...optional].sort()) ||
      !sameArray([...(schema.required ?? [])].sort(), [...required].sort())) fail(code);
}
function assertAllObjectSchemasClosed(value, code) {
  if (Array.isArray(value)) { value.forEach((item) => assertAllObjectSchemasClosed(item, code)); return; }
  if (!isRecord(value)) return;
  if (value.type === "object" && value.additionalProperties !== false) fail(code);
  for (const child of Object.values(value)) assertAllObjectSchemasClosed(child, code);
}
function sameArray(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]); }
function isRecord(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function isWithin(parent, child) { const rel = relative(parent, child); return rel === "" || (!rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && rel !== ".." && !isAbsolute(rel)); }
function unexpectedCode(phase, error) { return `INSTALLED_SEEDREAM_EDITOR_${phase.replace(/[^a-z0-9]+/giu, "_").toUpperCase()}_FAILED`; }
function fail(code) { throw new SeedreamEditorInstalledCheckError(code); }
function deadline(promise, milliseconds, code) { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new SeedreamEditorInstalledCheckError(code)), milliseconds); })]).finally(() => clearTimeout(timer)); }
