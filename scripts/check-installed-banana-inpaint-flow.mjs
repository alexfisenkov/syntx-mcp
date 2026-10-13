import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class BananaInpaintInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "BananaInpaintInstalledCheckError"; this.code = code; }
}

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const C5_VERSION = "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json";
const SETTINGS_VERSION = "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json";
const E551_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const VARIANTS = Object.freeze(["banana", "banana2", "banana3", "banana3_light"]);
const TOOL_NAMES = Object.freeze([
  "syntx_upload_banana_inpaint_original", "syntx_upload_banana_inpaint_painted_composite",
  "syntx_upload_banana_inpaint_auxiliary_reference", "syntx_owner_generate_banana_inpaint_image",
  "syntx_owner_reconcile_banana_inpaint_image", "syntx_owner_list_banana_inpaint_image_recoveries",
  "syntx_owner_get_banana_inpaint_image_result_page"
]);
const SOURCE_MODULES = Object.freeze([
  "adapter/syntx/chat-http-client", "adapter/syntx/owner-banana-inpaint-image-result",
  "application/owner-banana-inpaint-image-source-profile", "application/owner-banana-inpaint-parameters",
  "application/owner-banana-inpaint-original-validator", "application/owner-banana-inpaint-original-upload-source-profile",
  "application/owner-banana-inpaint-original-reference-service", "application/owner-banana-inpaint-painted-composite-input-validator",
  "application/owner-banana-inpaint-painted-composite-source-profile", "application/owner-banana-inpaint-painted-composite-reference-service",
  "application/owner-banana-inpaint-auxiliary-input-validator", "application/owner-banana-inpaint-auxiliary-source-profile",
  "application/owner-banana-inpaint-auxiliary-reference-service", "application/owner-banana-inpaint-image-request-preparer",
  "application/owner-banana-inpaint-image-one-shot-policy", "application/owner-banana-inpaint-image-generation-service",
  "application/account-status", "application/model-access", "auth/in-memory-auth-store", "mcp/owner-banana-inpaint-image-tools",
  "mcp/server", "runtime/observed-owner-runtime", "transports/stdio-owner", "catalog/selected-discovery-catalog",
  "catalog/public-catalog-history", "catalog/mapless-settings-inventory", "domain/generation-contract"
]);
export const BANANA_INPAINT_REQUIRED_PACKAGE_PATHS = Object.freeze([
  "dist/src/index.js", "dist/src/index.d.ts",
  ...SOURCE_MODULES.flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`]),
  `catalog/public/${C5_VERSION}`, `catalog/settings/v2/${SETTINGS_VERSION}`
]);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const FIXED_NOW = Date.parse("2026-10-12T12:00:00.000Z");

export function assertBananaInpaintPackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_BANANA_INPAINT_PACKAGE_PATHS_INVALID");
  if (BANANA_INPAINT_REQUIRED_PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) {
    fail("INSTALLED_BANANA_INPAINT_PACKAGE_CONTENT_MISSING");
  }
  return true;
}

export function assertBananaInpaintToolNames(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_BANANA_INPAINT_TOOL_LIST_INVALID");
  const names = tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length !== 0) fail("INSTALLED_BANANA_INPAINT_DEFAULT_OFF_FAILED");
    return Object.freeze({ tool_count: 0 });
  }
  if (names.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => names.filter((value) => value === name).length !== 1)) {
    fail("INSTALLED_BANANA_INPAINT_TOOL_SET_MISMATCH");
  }
  return Object.freeze({ tool_count: TOOL_NAMES.length });
}

export function assertBananaInpaintToolSurface(tools, enabled) {
  const summary = assertBananaInpaintToolNames(tools, enabled);
  if (!enabled) return summary;
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const expectedInputs = [
    ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"],
    ["link_attempt_id", "variant", "original_handle", "content_base64", "filename", "mime_type"],
    ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"],
    ["link_attempt_id", "variant", "prompt", "image_size", "original_handle", "painted_handle", "auxiliary_reference_handle"],
    ["link_attempt_id", "recovery_id"], ["link_attempt_id"],
    ["link_attempt_id", "result_id", "offset", "limit"]
  ];
  const expectedImageSizes = [
    { type: "null" },
    { type: "string", enum: ["1K", "2K", "4K"] },
    { type: "string", enum: ["0.5K", "1K", "2K", "4K"] },
    { type: "string", const: "1K" }
  ];
  for (const [index, name] of TOOL_NAMES.entries()) {
    const tool = byName.get(name);
    if (index === 3) {
      assertClosedObjectSchema(tool?.inputSchema, expectedInputs[index], [], "INSTALLED_BANANA_INPAINT_TOOL_SCHEMA_INVALID");
      const branches = tool?.inputSchema?.anyOf ?? tool?.inputSchema?.oneOf;
      if (!Array.isArray(branches) || branches.length !== 4) fail("INSTALLED_BANANA_INPAINT_TOOL_SCHEMA_INVALID");
      const variants = [];
      for (const [branchIndex, branch] of branches.entries()) {
        assertClosedObjectSchema(branch, expectedInputs[index], [], "INSTALLED_BANANA_INPAINT_TOOL_SCHEMA_INVALID");
        const properties = branch.properties;
        variants.push(properties?.variant?.const);
        if (properties?.variant?.const !== VARIANTS[branchIndex] || !matchesImageSizeSchema(properties?.image_size, expectedImageSizes[branchIndex])) {
          fail("INSTALLED_BANANA_INPAINT_GENERATION_SCHEMA_INVALID");
        }
      }
      if (!sameArray(variants, VARIANTS)) fail("INSTALLED_BANANA_INPAINT_GENERATION_SCHEMA_INVALID");
    } else {
      assertClosedObjectSchema(tool?.inputSchema, expectedInputs[index], index === 5 ? ["limit"] : [],
        "INSTALLED_BANANA_INPAINT_TOOL_SCHEMA_INVALID");
    }
    assertAllObjectSchemasClosed(tool.inputSchema, "INSTALLED_BANANA_INPAINT_TOOL_SCHEMA_INVALID");
    if (index === 6 && (tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint !== false ||
        tool.annotations?.idempotentHint !== true || tool.annotations?.openWorldHint !== false)) {
      fail("INSTALLED_BANANA_INPAINT_RESULT_PAGE_ANNOTATION_INVALID");
    }
  }
  return Object.freeze({ tool_count: TOOL_NAMES.length, closed_schemas: true, variants: 4, explicit_size_cases: 9 });
}

export function assertBananaInpaintPublicExports(api, modules) {
  const pairs = [
    ["OWNER_BANANA_INPAINT_IMAGE_VARIANTS", "source"], ["normalizeOwnerBananaInpaintPrompt", "source"],
    ["getOwnerBananaInpaintSourceParameters", "parameters"], ["normalizeOwnerBananaInpaintParameters", "parameters"],
    ["projectOwnerBananaInpaintCostParameters", "parameters"],
    ["createOwnerBananaInpaintImageGenerationService", "generation"],
    ["isOwnerBananaInpaintImageGenerationService", "generation"],
    ["OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES", "tools"], ["OWNER_BANANA_INPAINT_IMAGE_TOOL_INPUT_SCHEMAS", "tools"],
    ["OWNER_BANANA_INPAINT_IMAGE_TOOL_OUTPUT_SCHEMAS", "tools"],
    ["SYNTX_UPLOAD_BANANA_INPAINT_ORIGINAL_TOOL_NAME", "tools"],
    ["SYNTX_UPLOAD_BANANA_INPAINT_PAINTED_COMPOSITE_TOOL_NAME", "tools"],
    ["SYNTX_UPLOAD_BANANA_INPAINT_AUXILIARY_REFERENCE_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_GENERATE_BANANA_INPAINT_IMAGE_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_RECONCILE_BANANA_INPAINT_IMAGE_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_LIST_BANANA_INPAINT_IMAGE_RECOVERIES_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_GET_BANANA_INPAINT_IMAGE_RESULT_PAGE_TOOL_NAME", "tools"],
    ["registerSyntxOwnerBananaInpaintImageTools", "tools"]
  ];
  if (!isRecord(api) || pairs.some(([name, moduleName]) => !isRecord(modules[moduleName]) ||
      api[name] === undefined || api[name] !== modules[moduleName][name])) fail("INSTALLED_BANANA_INPAINT_PUBLIC_EXPORT_MISMATCH");
  for (const name of Object.keys(api)) {
    if (/OwnerBananaInpaint.*(?:PreparedCandidate|PrivateRequest|OneShotPermit|PrivateResolution|ResolverContext|WeakMap|GenerationPermit)/u.test(name) ||
        /^(?:create|consume|revalidate)OwnerBananaInpaintImage(?:OneShot|Prepared|Private)/u.test(name)) {
      fail("INSTALLED_BANANA_INPAINT_PRIVATE_BARREL_EXPORT");
    }
  }
  return true;
}

export function assertBananaInpaintPublicDeclarations(declarationText) {
  if (typeof declarationText !== "string") fail("INSTALLED_BANANA_INPAINT_DECLARATIONS_INVALID");
  const required = ["OwnerBananaInpaintImageVariant", "OwnerBananaInpaintNormalizedPrompt", "OwnerBananaInpaintSourceParameters",
    "OwnerBananaInpaintNormalizedParameters", "OwnerBananaInpaintCostParameters", "OwnerBananaInpaintImageGenerationServiceOptions",
    "OwnerBananaInpaintImageGenerationResult", "OwnerBananaInpaintImageResultPageInput", "OwnerBananaInpaintImageResultPage",
    "OwnerBananaInpaintImageServiceComposition", "SYNTX_OWNER_GET_BANANA_INPAINT_IMAGE_RESULT_PAGE_TOOL_NAME"];
  if (required.some((name) => !declarationText.includes(name))) fail("INSTALLED_BANANA_INPAINT_DECLARATIONS_INVALID");
  const forbidden = ["OwnerBananaInpaintImagePreparedCandidate", "OwnerBananaInpaintImageRequestPreparer", "OwnerBananaInpaintImageOneShotPermit",
    "OwnerBananaInpaintAuxiliaryImageResolution", "OwnerBananaInpaintImagePrivateRequest", "OwnerBananaInpaintImageResolverContext"];
  if (forbidden.some((name) => new RegExp(`export\\s+(?:declare\\s+)?(?:type\\s+)?(?:class|interface|type|const|function)\\s+${name}\\b`, "u").test(declarationText))) {
    fail("INSTALLED_BANANA_INPAINT_PRIVATE_DECLARATION_LEAK");
  }
  return true;
}

export function assertBananaInpaintLocalSchemas(toolsModule) {
  const schemas = toolsModule?.OWNER_BANANA_INPAINT_IMAGE_TOOL_INPUT_SCHEMAS;
  if (!isRecord(schemas) || typeof schemas.generate?.safeParse !== "function" ||
      typeof schemas.upload_auxiliary_reference?.safeParse !== "function") fail("INSTALLED_BANANA_INPAINT_LOCAL_SCHEMA_MISSING");
  const shared = { link_attempt_id: "link_banana_installed_schema_0123456789", prompt: "local schema probe",
    original_handle: `banana_inpaint_original_${"11111111-1111-4111-8111-111111111111"}`,
    painted_handle: `banana_inpaint_painted_${"22222222-2222-4222-8222-222222222222"}`, auxiliary_reference_handle: null };
  const variants = { banana: [null], banana2: ["1K", "2K", "4K"], banana3: ["0.5K", "1K", "2K", "4K"], banana3_light: ["1K"] };
  let sizeCases = 0;
  for (const [variant, sizes] of Object.entries(variants)) for (const image_size of sizes) {
    if (!schemas.generate.safeParse({ ...shared, variant, image_size }).success ||
        schemas.generate.safeParse({ ...shared, variant, image_size, caller_url: "https://caller.invalid/image.png" }).success) {
      fail("INSTALLED_BANANA_INPAINT_GENERATION_SCHEMA_INVALID");
    }
    sizeCases += 1;
  }
  const upload = { link_attempt_id: "link_banana_installed_schema_0123456789", variant: "banana",
    content_base64: PNG.toString("base64"), filename: "schema.png" };
  const supported = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif",
    "image/bmp", "image/gif", "image/tiff"];
  const rejected = ["image/svg+xml", "image/x-icon", "image/*", "image/unknown"];
  if (supported.some((mime_type) => !schemas.upload_auxiliary_reference.safeParse({ ...upload, mime_type }).success) ||
      rejected.some((mime_type) => schemas.upload_auxiliary_reference.safeParse({ ...upload, mime_type }).success)) {
    fail("INSTALLED_BANANA_INPAINT_LOCAL_FORMAT_MATRIX_INVALID");
  }
  return Object.freeze({ explicit_size_cases_checked: sizeCases, auxiliary_formats_checked: supported.length + rejected.length });
}

export function formatBananaInpaintInstalledSummary(proof) {
  const numeric = ["default_tools", "opt_in_tools", "variants_checked", "explicit_size_cases_checked", "original_uploads",
    "painted_composite_uploads", "auxiliary_uploads", "generation_posts", "ready_artifacts_returned", "account_endpoint_reads",
    "model_access_reads", "replay_post_count", "foreign_attempt_post_count", "default_stderr_bytes", "opt_in_stderr_bytes",
    "default_network_calls", "opt_in_network_calls", "result_gets", "page_reads", "auxiliary_formats_checked"];
  if (!isRecord(proof) || proof.status !== "INSTALLED_STOCK_SDK_CALL_TOOL_PASS" || proof.node_version !== "24.21.0" ||
      proof.sdk_version !== "1.32.1" || proof.clean_installed_package !== true || proof.default_tools !== 0 || proof.opt_in_tools !== 7 ||
      proof.variants_checked !== 4 || proof.explicit_size_cases_checked !== 9 || proof.unknown_post_reconciled_get_only !== true ||
      proof.replay_post_count !== 0 || proof.foreign_attempt_post_count !== 0 || proof.revoke_drain !== "PASS" ||
      proof.eof_drain !== "PASS" || proof.auth_cleanup !== "PASS" || proof.default_child_close !== "CLOSED" ||
      proof.opt_in_child_close !== "CLOSED" || proof.default_child_pid_null !== true || proof.opt_in_child_pid_null !== true ||
      proof.default_stderr_bytes !== 0 || proof.opt_in_stderr_bytes !== 0 || proof.default_network_calls !== 0 ||
      proof.opt_in_network_calls !== 0 || proof.provider_acceptance !== "UNPROVEN" || proof.page_size !== 64 ||
      proof.page_observations !== 80 || proof.page_reads !== 1 || proof.page_get_post_delta !== 0 ||
      numeric.some((key) => !Number.isSafeInteger(proof[key]) || proof[key] < 0)) fail("INSTALLED_BANANA_INPAINT_SUMMARY_INVALID");
  return `banana_inpaint_installed=${proof.status} node=${proof.node_version} sdk=${proof.sdk_version} clean_package=true ` +
    `default_tools=${proof.default_tools} opt_in_tools=${proof.opt_in_tools} variants=${proof.variants_checked} size_cases=${proof.explicit_size_cases_checked} ` +
    `original_uploads=${proof.original_uploads} painted_uploads=${proof.painted_composite_uploads} auxiliary_uploads=${proof.auxiliary_uploads} ` +
    `generation_posts=${proof.generation_posts} artifacts=${proof.ready_artifacts_returned} account_reads=${proof.account_endpoint_reads} ` +
    `model_access_reads=${proof.model_access_reads} result_gets=${proof.result_gets} page_reads=${proof.page_reads} page_size=${proof.page_size} ` +
    `page_observations=${proof.page_observations} page_get_post_delta=${proof.page_get_post_delta} unknown_get_only=${proof.unknown_post_reconciled_get_only} ` +
    `replay_posts=${proof.replay_post_count} foreign_attempt_posts=${proof.foreign_attempt_post_count} revoke_drain=${proof.revoke_drain} ` +
    `eof_drain=${proof.eof_drain} auth_cleanup=${proof.auth_cleanup} default_child_close=${proof.default_child_close} ` +
    `opt_in_child_close=${proof.opt_in_child_close} default_pid_null=${proof.default_child_pid_null} opt_in_pid_null=${proof.opt_in_child_pid_null} ` +
    `default_stderr_bytes=${proof.default_stderr_bytes} opt_in_stderr_bytes=${proof.opt_in_stderr_bytes} ` +
    `default_network_calls=${proof.default_network_calls} opt_in_network_calls=${proof.opt_in_network_calls} ` +
    `auxiliary_formats_checked=${proof.auxiliary_formats_checked} provider_acceptance=${proof.provider_acceptance}`;
}

export async function assertInstalledBananaInpaintFlow(installedPackagePath, consumerPath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertBananaInpaintPackagePaths(packagedPaths);
    if (process.versions.node !== "24.21.0") fail("INSTALLED_BANANA_INPAINT_NODE24_21_REQUIRED");
    if (typeof installedPackagePath !== "string" || !isAbsolute(installedPackagePath)) fail("INSTALLED_BANANA_INPAINT_INSTALLED_ROOT_INVALID");
    const packageRoot = await realpath(installedPackagePath);
    if (isWithin(PROJECT_ROOT, packageRoot)) fail("INSTALLED_BANANA_INPAINT_NOT_CLEAN_INSTALLED_PACKAGE");
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    if (manifest?.name !== "syntx-mcp") fail("INSTALLED_BANANA_INPAINT_NOT_CLEAN_INSTALLED_PACKAGE");
    phase = "installed-module-import";
    const importPacked = (path) => import(pathToFileURL(join(packageRoot, path)).href);
    const loaded = await Promise.all([importPacked("dist/src/index.js"), ...SOURCE_MODULES.map((name) => importPacked(`dist/src/${name}.js`))]);
    const api = loaded[0];
    const moduleMap = new Map(SOURCE_MODULES.map((name, index) => [name, loaded[index + 1]]));
    const pick = (name) => moduleMap.get(name);
    const modules = { source: pick("application/owner-banana-inpaint-image-source-profile"), parameters: pick("application/owner-banana-inpaint-parameters"),
      generation: pick("application/owner-banana-inpaint-image-generation-service"), tools: pick("mcp/owner-banana-inpaint-image-tools"),
      server: pick("mcp/server"), runtime: pick("runtime/observed-owner-runtime"), stdio: pick("transports/stdio-owner"),
      originalProfile: pick("application/owner-banana-inpaint-original-upload-source-profile"),
      paintedProfile: pick("application/owner-banana-inpaint-painted-composite-source-profile"),
      auxProfile: pick("application/owner-banana-inpaint-auxiliary-source-profile"),
      catalog: pick("catalog/selected-discovery-catalog"), publicCatalog: pick("catalog/public-catalog-history"),
      settings: pick("catalog/mapless-settings-inventory") };
    phase = "public-barrel";
    assertBananaInpaintPublicExports(api, modules);
    assertBananaInpaintPublicDeclarations(await readFile(join(packageRoot, "dist/src/index.d.ts"), "utf8"));
    assertBananaInpaintFlagReader(modules.stdio);
    phase = "source-pair";
    assertBananaInpaintSourcePair(modules, packageRoot);
    const localSchemas = assertBananaInpaintLocalSchemas(modules.tools);
    phase = "consumer-sdk";
    const sdk = await loadConsumerSdk(consumerPath);
    phase = "stdio-default";
    const defaultChild = await listInstalledTools(packageRoot, consumerPath, sdk, false);
    phase = "stdio-opt-in";
    const optInChild = await listInstalledTools(packageRoot, consumerPath, sdk, true);
    phase = "runtime-sdk-calltool";
    const runtime = await runInstalledRuntimeCallTool(modules, sdk);
    return Object.freeze({ ...runtime, ...localSchemas, default_tools: defaultChild.tool_count, opt_in_tools: optInChild.tool_count,
      sdk_version: sdk.version, node_version: process.versions.node, clean_installed_package: true,
      default_child_close: defaultChild.child_close, opt_in_child_close: optInChild.child_close,
      default_child_pid_null: defaultChild.child_pid_null, opt_in_child_pid_null: optInChild.child_pid_null,
      default_stderr_bytes: defaultChild.stderr_bytes, opt_in_stderr_bytes: optInChild.stderr_bytes,
      default_network_calls: defaultChild.network_calls, opt_in_network_calls: optInChild.network_calls,
      provider_acceptance: "UNPROVEN" });
  } catch (error) {
    if (error instanceof BananaInpaintInstalledCheckError) throw error;
    fail(unexpectedCode(phase, error));
  }
}

function assertBananaInpaintFlagReader(module) {
  const read = module?.readOwnerBananaInpaintImageReferencesFlag;
  if (typeof read !== "function" || read(undefined) !== false || read("") !== false || read("0") !== false || read("1") !== true) {
    fail("INSTALLED_BANANA_INPAINT_FLAG_INVALID");
  }
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    let rejected = false; try { read(value); } catch { rejected = true; }
    if (!rejected) fail("INSTALLED_BANANA_INPAINT_FLAG_INVALID");
  }
  return true;
}

function assertBananaInpaintSourcePair(modules, packageRoot) {
  const selected = modules.catalog.loadSelectedDiscoveryCatalog(C5_VERSION, join(packageRoot, "catalog"));
  const settings = modules.settings.loadMaplessSettingsInventoryVersion(SETTINGS_VERSION, join(packageRoot, "catalog"));
  if (modules.originalProfile.OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION !== C5_VERSION ||
      modules.originalProfile.OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION !== SETTINGS_VERSION ||
      modules.catalog.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION !== E551_VERSION || settings.public_catalog?.version !== C5_VERSION) {
    fail("INSTALLED_BANANA_INPAINT_SOURCE_PAIR_INVALID");
  }
  const profiles = VARIANTS.map((variant) => {
    const original = modules.originalProfile.getOwnerBananaInpaintOriginalUploadSourceProfile(variant, selected.discoveryCatalog,
      C5_VERSION, settings, SETTINGS_VERSION);
    const painted = modules.paintedProfile.getOwnerBananaInpaintPaintedCompositeSourceProfile(variant, original);
    const controls = modules.parameters.getOwnerBananaInpaintSourceParameters(variant, original);
    return modules.source.getOwnerBananaInpaintImageSourceProfile(variant, original, painted, controls);
  });
  if (!sameArray(profiles.map((profile) => profile.model_identity.model_id), VARIANTS) ||
      profiles.some((profile) => profile.runtime_activation !== false || profile.dispatch_allowed !== false ||
        profile.generation_permission !== false || profile.backend_acceptance !== "UNPROVEN")) fail("INSTALLED_BANANA_INPAINT_SOURCE_PAIR_INVALID");
  const normalized = modules.source.normalizeOwnerBananaInpaintPrompt({ variant: "banana3", prompt: "  exact local prompt  " });
  if (normalized.prompt !== "  exact local prompt  ") fail("INSTALLED_BANANA_INPAINT_PROMPT_NORMALIZATION_INVALID");
  return true;
}

async function loadConsumerSdk(consumerPath) {
  if (typeof consumerPath !== "string" || !isAbsolute(consumerPath)) fail("INSTALLED_BANANA_INPAINT_CONSUMER_PATH_INVALID");
  const require = createRequire(join(consumerPath, "package.json"));
  let clientPath; let stdioPath; let memoryPath;
  try {
    clientPath = require.resolve("@modelcontextprotocol/sdk/client/index.js");
    stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js");
    memoryPath = require.resolve("@modelcontextprotocol/sdk/inMemory.js");
  } catch { fail("INSTALLED_BANANA_INPAINT_SDK_RESOLUTION_FAILED"); }
  const sdkRoot = join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk");
  const [resolvedSdk, resolvedClient, resolvedStdio, resolvedMemory] = await Promise.all([realpath(sdkRoot), realpath(clientPath), realpath(stdioPath), realpath(memoryPath)]);
  if (isWithin(PROJECT_ROOT, resolvedSdk) || ![resolvedClient, resolvedStdio, resolvedMemory].every((path) => isWithin(resolvedSdk, path))) {
    fail("INSTALLED_BANANA_INPAINT_SDK_NOT_FROM_CONSUMER");
  }
  const manifest = JSON.parse(await readFile(join(resolvedSdk, "package.json"), "utf8"));
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest.version !== "1.32.1") fail("INSTALLED_BANANA_INPAINT_SDK_VERSION_MISMATCH");
  const [{ Client }, { StdioClientTransport }, { InMemoryTransport }] = await Promise.all([
    import(pathToFileURL(clientPath).href), import(pathToFileURL(stdioPath).href), import(pathToFileURL(memoryPath).href)
  ]);
  return { Client, StdioClientTransport, InMemoryTransport, version: manifest.version };
}

async function listInstalledTools(packageRoot, consumerPath, sdk, enabled) {
  const auditDirectory = await mkdtemp(join(tmpdir(), "banana-inpaint-installed-audit-"));
  const auditPath = join(auditDirectory, "fetch-count");
  const preload = join(auditDirectory, "network-guard.mjs");
  await writeFile(preload, `import { writeFileSync } from 'node:fs'; let n=0; globalThis.fetch=(...a)=>{n++;return Promise.reject(new Error('NETWORK_DISABLED'));}; process.on('exit',()=>{try{writeFileSync(process.env.SYNTX_BANANA_INPAINT_FETCH_AUDIT,String(n))}catch{}});\n`, { mode: 0o600 });
  const client = new sdk.Client({ name: enabled ? "banana-inpaint-installed-opt-in" : "banana-inpaint-installed-default", version: "1.0.0" }, { capabilities: {} });
  const transport = new sdk.StdioClientTransport({ command: process.execPath, args: [join(packageRoot, "dist/src/transports/stdio-owner.js")], cwd: consumerPath,
    env: { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: auditDirectory, XDG_DATA_HOME: auditDirectory,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, SYNTX_BANANA_INPAINT_FETCH_AUDIT: auditPath,
      ...(enabled ? { SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES: "1" } : {}) }, stderr: "pipe" });
  let closeObserved = false; let resolveClosed;
  const closed = new Promise((resolvePromise) => { resolveClosed = resolvePromise; });
  const priorClose = transport.onclose;
  transport.onclose = () => { closeObserved = true; try { priorClose?.(); } finally { resolveClosed(); } };
  let stderrBytes = 0; transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  let connected = false; let failure; let result;
  try {
    await deadline(client.connect(transport), 5_500, "INSTALLED_BANANA_INPAINT_STDIO_INITIALIZE_TIMEOUT"); connected = true;
    const listed = await deadline(client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }), 5_500, "INSTALLED_BANANA_INPAINT_TOOLS_LIST_TIMEOUT");
    result = assertBananaInpaintToolSurface(listed.tools, enabled);
  } catch (error) { failure = error; }
  finally {
    try { await deadline(connected ? client.close() : transport.close(), 2_000, "INSTALLED_BANANA_INPAINT_STDIO_CLOSE_FAILED"); }
    catch (error) { failure ??= error; }
    try { await deadline(closed, 2_000, "INSTALLED_BANANA_INPAINT_STDIO_CLOSE_FAILED"); }
    catch (error) { failure ??= error; }
  }
  try {
    if (failure) throw failure;
    if (!closeObserved || transport.pid !== null || stderrBytes !== 0) fail("INSTALLED_BANANA_INPAINT_STDIO_CLOSE_FAILED");
    const networkCalls = Number(await readFile(auditPath, "utf8"));
    if (networkCalls !== 0) fail("INSTALLED_BANANA_INPAINT_STDIO_NETWORK_CALLS_DETECTED");
    return Object.freeze({ ...result, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes, network_calls: networkCalls });
  } catch (error) { if (error instanceof BananaInpaintInstalledCheckError) throw error; fail("INSTALLED_BANANA_INPAINT_STDIO_SURFACE_INVALID"); }
  finally { await rm(auditDirectory, { recursive: true, force: true }); }
}

async function runInstalledRuntimeCallTool(modules, sdk) {
  const counters = { uploads: 0, chats: 0, posts: 0, balanceReads: 0, subscriptionReads: 0, modelReads: 0, historyReads: 0, resultGets: 0 };
  const transactions = new Map();
  const events = [];
  let largeNext = false; let unknownPost = false; let unknownReady = false; let unknownChat;
  let signalPost;
  const postStarted = new Promise((resolvePromise) => { signalPost = resolvePromise; });
  let signalUnknownResult;
  const unknownResultRead = new Promise((resolvePromise) => { signalUnknownResult = resolvePromise; });
  const fetchImpl = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); const method = init?.method ?? "GET";
    events.push({ pathname: url.pathname, method });
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      counters.uploads += 1; const form = init.body; const file = form?.get("files");
      if (!(file instanceof File)) fail("INSTALLED_BANANA_INPAINT_SYNTHETIC_UPLOAD_INVALID");
      return Response.json({ files: [{ id: `installed-file-${counters.uploads}`, file_id: `installed-file-${counters.uploads}`,
        url: `https://r2.syntx.ai/installed/input-${counters.uploads}.png`, mime_type: file.type, size: file.size, status: "accepted" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") { counters.chats += 1; return Response.json({ uuid: `installed-inpaint-chat-${counters.chats}` }); }
    if (url.pathname === "/api/v1/design/generate" && method === "POST") {
      counters.posts += 1; const body = JSON.parse(String(init.body));
      if (url.searchParams.get("ai_name") !== "banana") fail("INSTALLED_BANANA_INPAINT_SYNTHETIC_ROUTE_INVALID");
      const big = largeNext; largeNext = false;
      const result = `installed-inpaint-result-${counters.posts}`;
      transactions.set(body.chat_uuid, { ack: `installed-inpaint-ack-${counters.posts}`, result, chat: 9_000 + counters.posts,
        variant: body.settings.model_type, big });
      if (unknownPost) { unknownPost = false; unknownChat = body.chat_uuid; signalPost(); return new Promise(() => undefined); }
      return Response.json({ id: `installed-inpaint-ack-${counters.posts}` });
    }
    const inProgress = url.pathname.match(/^\/api\/v1\/chats\/installed-inpaint-chat-\d+\/inprogress$/u);
    if (inProgress) return Response.json([]);
    const historyMatch = url.pathname.match(/^\/api\/v1\/chats\/(installed-inpaint-chat-\d+)\/messages$/u);
    if (historyMatch && method === "GET") {
      counters.historyReads += 1; const tx = transactions.get(historyMatch[1]);
      if (!tx) fail("INSTALLED_BANANA_INPAINT_SYNTHETIC_HISTORY_INVALID");
      if (historyMatch[1] === unknownChat && !unknownReady) return Response.json({ messages: [], pagination: { page: 1, page_size: 10,
        total_count: 0, total_pages: 0, has_next: false, has_previous: false } });
      if (tx.big) {
        const rows = [1, 2].map((messageIndex) => { const id = `${tx.result}-${messageIndex}`; return { id, chat_id: tx.chat,
          author_id: -1, message_object: Array.from({ length: 40 }, (_, ix) => ({ id: `${id}-${ix}`, message_id: id,
            object_type: "image", model_type: null })) }; });
        return Response.json({ messages: [{ id: tx.ack, chat_id: tx.chat, author_id: 27, message_object: [] }, ...rows],
          pagination: { page: 1, page_size: 10, total_count: 3, total_pages: 1, has_next: false, has_previous: false } });
      }
      return Response.json({ messages: [{ id: tx.ack, chat_id: tx.chat, author_id: 27, message_object: [] },
        { id: tx.result, chat_id: tx.chat, author_id: -1, message_object: [
          { id: `${tx.result}-a`, message_id: tx.result, object_type: "image", model_type: null },
          { id: `${tx.result}-b`, message_id: tx.result, object_type: "image_url", model_type: null }
        ] }], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = url.pathname.match(/^\/api\/v1\/chats\/(installed-inpaint-chat-\d+)\/(installed-inpaint-result-\d+(?:-[12])?)$/u);
    if (resultMatch && method === "GET") {
      counters.resultGets += 1; const tx = transactions.get(resultMatch[1]);
      if (!tx) fail("INSTALLED_BANANA_INPAINT_SYNTHETIC_RESULT_INVALID");
      if (resultMatch[1] === unknownChat) signalUnknownResult();
      if (tx.big) {
        const messageNo = resultMatch[2].endsWith("-2") ? 2 : 1;
        return Response.json({ id: resultMatch[2], chat_id: tx.chat, author_id: -1, message_object: Array.from({ length: 40 }, (_, ix) => ({
          id: `${resultMatch[2]}-${ix}`, object_type: "image", completed: true,
          object_url: `https://r2.syntx.ai/installed/${counters.posts}-${messageNo}-${ix + 1}.png`
        })) });
      }
      return Response.json({ id: tx.result, chat_id: tx.chat, author_id: -1, message_object: [
        { id: `${tx.result}-a`, object_type: "image", completed: true, object_url: `https://r2.syntx.ai/installed/${counters.posts}-a.png` },
        { id: `${tx.result}-b`, object_type: "image_url", completed: true, object_url: `https://r2.syntx.ai/installed/${counters.posts}-b.webp` }
      ] });
    }
    if (url.pathname === "/api/v1/user/balance") { counters.balanceReads += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription") { counters.subscriptionReads += 1; return Response.json({ active: true,
      type: "PRO", end_date: "2099-12-31T00:00:00.000Z" }); }
    if (url.pathname === "/api/v2/get_model_info") { counters.modelReads += 1; return Response.json({ access: true, cost: 3,
      discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null }); }
    fail("INSTALLED_BANANA_INPAINT_SYNTHETIC_ROUTE_UNEXPECTED");
  };
  const runtime = modules.runtime.createObservedOwnerRuntime({ ownerBananaInpaintImageReferencesEnabled: true, fetchImpl,
    now: () => FIXED_NOW, requestTimeoutMs: 2_000 });
  const composition = runtime.serverOptions.ownerBananaInpaintImageReferences;
  if (!composition) fail("INSTALLED_BANANA_INPAINT_RUNTIME_COMPOSITION_MISSING");
  const server = modules.server.createMcpServer(runtime.application, runtime.serverOptions);
  const client = new sdk.Client({ name: "banana-inpaint-installed-calltool", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = sdk.InMemoryTransport.createLinkedPair();
  const linkAttempt = async (attemptId) => {
    const { authStore, authBinding } = runtime;
    await authStore.createAttempt({ attempt_id: attemptId, binding: authBinding, expires_at_ms: FIXED_NOW + 60_000 });
    await authStore.beginHandoff(authBinding, attemptId); await authStore.attachChallenge(authBinding, attemptId, `install-${attemptId}`);
    await authStore.beginPoll(authBinding, attemptId); await authStore.markLinked(authBinding, attemptId, { scheme: "Bearer", value: `credential-${attemptId}` });
  };
  const uploadPair = async (attempt, index, variant = "banana3") => {
    const originalResult = await client.callTool({ name: TOOL_NAMES[0], arguments: { link_attempt_id: attempt, variant,
      content_base64: PNG.toString("base64"), filename: `installed-original-${index}.png`, mime_type: "image/png" } });
    if (originalResult.isError) fail("INSTALLED_BANANA_INPAINT_ORIGINAL_UPLOAD_FAILED");
    const original = originalResult.structuredContent;
    const paintedResult = await client.callTool({ name: TOOL_NAMES[1], arguments: { link_attempt_id: attempt, variant,
      original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: `installed-painted-${index}.png`, mime_type: "image/png" } });
    if (paintedResult.isError) fail("INSTALLED_BANANA_INPAINT_PAINTED_UPLOAD_FAILED");
    return { original: original.reference_handle, painted: paintedResult.structuredContent.painted_handle };
  };
  let resultCount = 0; let variantCount = 0; const checkedVariants = new Set();
  let sizeCaseCount = 0; let auxiliaryUploads = 0; let replayCount = 0; let foreignPostCount = 0;
  let pageReads = 0; let pageDelta = 0; let unknownGetOnly = false;
  let replayAccountEndpointReads = 0; let replayModelAccessReads = 0;
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const listed = await client.listTools(); assertBananaInpaintToolSurface(listed.tools, true);
    const selections = [["banana", null], ["banana2", "1K"], ["banana2", "2K"], ["banana2", "4K"],
      ["banana3", "0.5K"], ["banana3", "1K"], ["banana3", "2K"], ["banana3", "4K"], ["banana3_light", "1K"]];
    for (const [ix, [variant, imageSize]] of selections.entries()) {
      const attempt = `link_banana_installed_${String(ix + 1).padStart(2, "0")}_0123456789`;
      await linkAttempt(attempt); const pair = await uploadPair(attempt, ix, variant);
      let auxiliary = null;
      if (ix % 2 === 1) {
        const uploaded = await client.callTool({ name: TOOL_NAMES[2], arguments: { link_attempt_id: attempt, variant,
          content_base64: PNG.toString("base64"), filename: `installed-aux-${ix}.png`, mime_type: "image/png" } });
        if (uploaded.isError) fail("INSTALLED_BANANA_INPAINT_AUX_UPLOAD_FAILED");
        auxiliary = uploaded.structuredContent.reference_handle; auxiliaryUploads += 1;
      }
      const response = await client.callTool({ name: TOOL_NAMES[3], arguments: { link_attempt_id: attempt, variant,
        prompt: `synthetic installed ${variant}`, image_size: imageSize, original_handle: pair.original,
        painted_handle: pair.painted, auxiliary_reference_handle: auxiliary } });
      if (response.isError || response.structuredContent?.status !== "result_observed" || response.structuredContent?.artifacts?.length !== 2 ||
          response.structuredContent?.backend_acceptance !== "UNPROVEN" || response.structuredContent?.provider_execution !== false) {
        fail("INSTALLED_BANANA_INPAINT_GENERATION_RESULT_INVALID");
      }
      resultCount += response.structuredContent.artifacts.length; variantCount += 1; checkedVariants.add(variant);
    }
    const bigAttempt = "link_banana_installed_paging_0123456789"; await linkAttempt(bigAttempt);
    const pair = await uploadPair(bigAttempt, 9); largeNext = true;
    const large = await client.callTool({ name: TOOL_NAMES[3], arguments: { link_attempt_id: bigAttempt, variant: "banana3",
      prompt: "read every cached page", image_size: "2K", original_handle: pair.original, painted_handle: pair.painted,
      auxiliary_reference_handle: null } });
    if (large.isError || large.structuredContent?.observed_total !== 80 || large.structuredContent?.artifacts?.length !== 64 ||
        large.structuredContent?.next_offset !== 64 || large.structuredContent?.has_more !== true) fail("INSTALLED_BANANA_INPAINT_FIRST_PAGE_INVALID");
    const beforePage = { results: counters.resultGets, posts: counters.posts };
    const page = await client.callTool({ name: TOOL_NAMES[6], arguments: { link_attempt_id: bigAttempt,
      result_id: large.structuredContent.result_id, offset: 64, limit: 64 } });
    if (page.isError || page.structuredContent?.artifacts?.length !== 16 || page.structuredContent?.has_more !== false ||
        page.structuredContent?.observed_total !== 80) fail("INSTALLED_BANANA_INPAINT_SECOND_PAGE_INVALID");
    pageReads += 1; pageDelta = counters.resultGets - beforePage.results + counters.posts - beforePage.posts;
    if (pageDelta !== 0) fail("INSTALLED_BANANA_INPAINT_PAGE_REACHED_PROVIDER");
    resultCount += 80;
    const foreignGenerate = await client.callTool({ name: TOOL_NAMES[3], arguments: { link_attempt_id: "link_banana_installed_foreign_0123456789",
      variant: "banana3", prompt: "foreign attempt cannot dispatch", image_size: "2K", original_handle: pair.original,
      painted_handle: pair.painted, auxiliary_reference_handle: null } });
    if (foreignGenerate.isError !== true || counters.posts !== 10) fail("INSTALLED_BANANA_INPAINT_FOREIGN_GENERATION_DISPATCHED");

    const unknownAttempt = "link_banana_installed_unknown_0123456789"; await linkAttempt(unknownAttempt);
    const unknownPair = await uploadPair(unknownAttempt, 10, "banana2"); unknownPost = true;
    const controller = new AbortController();
    const unknownCall = client.callTool({ name: TOOL_NAMES[3], arguments: { link_attempt_id: unknownAttempt, variant: "banana2",
      prompt: "unknown post reconciliation is GET only", image_size: "2K", original_handle: unknownPair.original,
      painted_handle: unknownPair.painted, auxiliary_reference_handle: null } }, undefined, { signal: controller.signal });
    await deadline(postStarted, 5_000, "INSTALLED_BANANA_INPAINT_UNKNOWN_POST_NOT_REACHED"); controller.abort();
    await unknownCall.catch(() => undefined);
    const postsAfterUnknown = counters.posts;
    const readsBeforeReplay = { accounts: counters.balanceReads + counters.subscriptionReads, models: counters.modelReads };
    const replay = await client.callTool({ name: TOOL_NAMES[3], arguments: { link_attempt_id: unknownAttempt, variant: "banana2",
      prompt: "unknown post reconciliation is GET only", image_size: "2K", original_handle: unknownPair.original,
      painted_handle: unknownPair.painted, auxiliary_reference_handle: null } });
    replayCount = counters.posts - postsAfterUnknown;
    replayAccountEndpointReads = counters.balanceReads + counters.subscriptionReads - readsBeforeReplay.accounts;
    replayModelAccessReads = counters.modelReads - readsBeforeReplay.models;
    if (replay.isError !== true || replayCount !== 0 || replayAccountEndpointReads !== 2 || replayModelAccessReads !== 1) {
      fail("INSTALLED_BANANA_INPAINT_UNKNOWN_POST_REPLAYED");
    }
    const recoveries = await client.callTool({ name: TOOL_NAMES[5], arguments: { link_attempt_id: unknownAttempt } });
    const recovery = recoveries.structuredContent?.recoveries?.[0];
    if (!recovery?.recovery_id || recovery.status !== "OUTCOME_UNKNOWN") fail("INSTALLED_BANANA_INPAINT_UNKNOWN_RECOVERY_MISSING");
    unknownReady = true;
    const readsBeforeReconcile = counters.resultGets;
    const reconciled = await client.callTool({ name: TOOL_NAMES[4], arguments: { link_attempt_id: unknownAttempt, recovery_id: recovery.recovery_id } });
    if (counters.resultGets <= readsBeforeReconcile || counters.posts !== postsAfterUnknown) fail("INSTALLED_BANANA_INPAINT_UNKNOWN_NOT_GET_ONLY");
    const stillHeld = await client.callTool({ name: TOOL_NAMES[5], arguments: { link_attempt_id: unknownAttempt } });
    unknownGetOnly = reconciled.isError !== true && stillHeld.structuredContent?.recoveries?.length === 1;
    if (!unknownGetOnly) fail("INSTALLED_BANANA_INPAINT_UNKNOWN_HOLD_CLEARED");
    const foreign = await client.callTool({ name: TOOL_NAMES[6], arguments: { link_attempt_id: "link_banana_installed_foreign_0123456789",
      result_id: large.structuredContent.result_id, offset: 0, limit: 64 } });
    if (foreign.isError !== true || counters.posts !== postsAfterUnknown) fail("INSTALLED_BANANA_INPAINT_FOREIGN_RESULT_PAGE_NOT_DENIED");
    foreignPostCount = counters.posts - postsAfterUnknown;
    if (foreignPostCount !== 0) fail("INSTALLED_BANANA_INPAINT_FOREIGN_POST_DETECTED");
    sizeCaseCount = selections.length;
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
    await composition.generationService.close();
  }
  const revoke = await runRevokeDrain(modules);
  const eof = await runEofDrain(modules);
  const generationPosts = counters.posts;
  const accountEndpointReads = counters.balanceReads + counters.subscriptionReads;
  if (variantCount !== 9 || checkedVariants.size !== 4 || resultCount !== 98 || generationPosts !== 11 || counters.modelReads !== 23 ||
      accountEndpointReads !== 46 || replayAccountEndpointReads !== 2 || replayModelAccessReads !== 1 || !unknownGetOnly ||
      revoke !== "PASS" || eof !== "PASS") fail("INSTALLED_BANANA_INPAINT_RUNTIME_COUNTERS_INVALID");
  return Object.freeze({ status: "INSTALLED_STOCK_SDK_CALL_TOOL_PASS", variants_checked: checkedVariants.size, explicit_size_cases_checked: sizeCaseCount,
    original_uploads: 11, painted_composite_uploads: 11, auxiliary_uploads: auxiliaryUploads, generation_posts: generationPosts,
    ready_artifacts_returned: resultCount, account_endpoint_reads: accountEndpointReads, model_access_reads: counters.modelReads,
    result_gets: counters.resultGets, page_reads: pageReads, page_size: 64, page_observations: 80, page_get_post_delta: pageDelta,
    unknown_post_reconciled_get_only: unknownGetOnly, replay_post_count: replayCount, foreign_attempt_post_count: foreignPostCount,
    revoke_drain: revoke, eof_drain: eof, auth_cleanup: "PASS", default_tools: 0, opt_in_tools: 7,
    default_child_close: "CLOSED", opt_in_child_close: "CLOSED", default_child_pid_null: true, opt_in_child_pid_null: true,
    default_stderr_bytes: 0, opt_in_stderr_bytes: 0, default_network_calls: 0, opt_in_network_calls: 0, provider_acceptance: "UNPROVEN" });
}

async function runRevokeDrain(modules) {
  const runtime = modules.runtime.createObservedOwnerRuntime({ ownerBananaInpaintImageReferencesEnabled: true });
  const composition = runtime.serverOptions.ownerBananaInpaintImageReferences; const auth = runtime.serverOptions.auth;
  if (!composition || !auth) fail("INSTALLED_BANANA_INPAINT_REVOKE_COMPOSITION_MISSING");
  const events = []; const attempt = "link_banana_installed_revoke_0123456789"; const foreign = "link_banana_installed_revoke_foreign_0123456789";
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attempt, binding, expires_at_ms: FIXED_NOW + 60_000 });
  await runtime.authStore.createAttempt({ attempt_id: foreign, binding: { tenant_id: "foreign", subject: "foreign" }, expires_at_ms: FIXED_NOW + 60_000 });
  const services = [composition.generationService, composition.originalReferenceService, composition.paintedCompositeReferenceService, composition.auxiliaryReferenceService];
  const originals = services.map((service) => service.invalidateAttempt.bind(service));
  let releaseGate; let signalAllStarted;
  const gate = new Promise((resolvePromise) => { releaseGate = resolvePromise; });
  const allStarted = new Promise((resolvePromise) => { signalAllStarted = resolvePromise; });
  const startedReferences = new Set();
  composition.generationService.invalidateAttempt = async (id) => {
    events.push("generation.start");
    await originals[0](id);
    events.push("generation.done");
  };
  services.slice(1).forEach((service, offset) => { service.invalidateAttempt = async (id) => {
    const index = offset + 1;
    events.push(`reference${offset}.start`);
    startedReferences.add(offset);
    if (startedReferences.size === services.length - 1) signalAllStarted();
    await gate; await originals[index](id); events.push(`reference${offset}.done`);
  }; });
  const originalRevoke = runtime.authStore.revoke.bind(runtime.authStore);
  runtime.authStore.revoke = async (...args) => { events.push("auth.revoke"); return originalRevoke(...args); };
  let revoking;
  try {
    await auth.linkService.revoke(binding, foreign).then(() => fail("INSTALLED_BANANA_INPAINT_FOREIGN_REVOKE_ACCEPTED"), () => undefined);
    if (events.length !== 0) fail("INSTALLED_BANANA_INPAINT_FOREIGN_REVOKE_MUTATED");
    revoking = auth.linkService.revoke(binding, attempt);
    await deadline(allStarted, 2_000, "INSTALLED_BANANA_INPAINT_REVOKE_BARRIERS_NOT_RAISED");
    if (!events.includes("generation.start") || ![0, 1, 2].every((index) => events.includes(`reference${index}.start`)) ||
        events.includes("auth.revoke") || events.includes("generation.done") || events.some((event) => event.endsWith(".done"))) {
      fail("INSTALLED_BANANA_INPAINT_REVOKE_DRAIN_ORDER_INVALID");
    }
    releaseGate(); await revoking;
    const referenceStarts = [0, 1, 2].map((index) => events.filter((event) => event === `reference${index}.start`).length);
    const referenceDone = [0, 1, 2].map((index) => events.filter((event) => event === `reference${index}.done`).length);
    if (events.at(-1) !== "auth.revoke" || events.filter((event) => event === "generation.start").length !== 1 ||
        events.filter((event) => event === "generation.done").length !== 1 || referenceStarts.some((count) => count === 0) ||
        referenceStarts.some((count, index) => count !== referenceDone[index])) fail("INSTALLED_BANANA_INPAINT_REVOKE_DRAIN_INVALID");
    return "PASS";
  } finally { releaseGate(); await revoking?.catch(() => undefined); await composition.generationService.close(); }
}

async function runEofDrain(modules) {
  const runtime = modules.runtime.createObservedOwnerRuntime({ ownerBananaInpaintImageReferencesEnabled: true });
  const generation = runtime.serverOptions.ownerBananaInpaintImageReferences?.generationService;
  if (!generation) fail("INSTALLED_BANANA_INPAINT_EOF_COMPOSITION_MISSING");
  const events = []; const input = new PassThrough();
  const transport = { onclose: undefined, async start() {}, async send() {}, async close() { this.onclose?.(); } };
  const originalClose = generation.close.bind(generation);
  generation.close = async () => { events.push("drain"); await originalClose(); };
  const close = modules.stdio.closeOwnerReadServicesOnTransportEof(transport, undefined, undefined, undefined, undefined,
    () => events.push("auth_release"), input, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, true, undefined, generation);
  const closed = new Promise((resolvePromise) => { transport.onclose = () => resolvePromise(); });
  input.resume(); input.end(); await deadline(closed, 2_000, "INSTALLED_BANANA_INPAINT_EOF_CLOSE_TIMEOUT"); await close();
  input.destroy();
  if (!sameArray(events, ["drain", "auth_release"])) fail("INSTALLED_BANANA_INPAINT_EOF_AUTH_ORDER_INVALID");
  return "PASS";
}

async function assertConsumerSdkVersion(consumerPath) { return loadConsumerSdk(consumerPath); }
function assertClosedObjectSchema(schema, required, optional, code) {
  if (!isRecord(schema) || schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(schema.properties ?? {}).sort(), [...required, ...optional].sort()) ||
      !sameArray([...(schema.required ?? [])].sort(), [...required].sort())) fail(code);
}
function matchesImageSizeSchema(actual, expected) {
  if (!isRecord(actual) || !isRecord(expected) || actual.type !== expected.type ||
      Object.keys(actual).some((key) => !["type", "const", "enum"].includes(key))) return false;
  if (expected.const !== undefined && actual.const !== expected.const) return false;
  if (expected.enum !== undefined && !sameArray(actual.enum, expected.enum)) return false;
  return true;
}
function assertAllObjectSchemasClosed(value, code, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value); if (value.type === "object" && value.additionalProperties !== false) fail(code);
  for (const nested of Object.values(value)) if (Array.isArray(nested)) nested.forEach((item) => assertAllObjectSchemasClosed(item, code, seen));
    else assertAllObjectSchemasClosed(nested, code, seen);
}
function isWithin(root, candidate) { const rel = relative(resolve(root), resolve(candidate)); return rel === "" ||
  (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); }
function sameArray(actual, expected) { return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((value, ix) => value === expected[ix]); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function deadline(promise, ms, code) { let timer; const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new BananaInpaintInstalledCheckError(code)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)); }
function unexpectedCode(phase, error) { const name = error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" :
  error instanceof SyntaxError ? "SyntaxError" : error instanceof Error ? "Error" : "NonError"; return `INSTALLED_BANANA_INPAINT_UNEXPECTED_${phase}_${name}`; }
function fail(code) { throw new BananaInpaintInstalledCheckError(code); }
