#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { isDeepStrictEqual } from "node:util";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class WanT2vFlowInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "WanT2vFlowInstalledCheckError"; this.code = code; }
}

const MODELS = Object.freeze(["wan_26_t2v", "wan_27_t2v"]);
const TOOL_NAMES = Object.freeze([
  "syntx_get_wan_t2v_parameters", "syntx_owner_generate_wan_t2v_video", "syntx_owner_reconcile_wan_t2v_video",
  "syntx_owner_list_wan_t2v_recoveries", "syntx_owner_get_wan_t2v_result_page"
]);
const RATIOS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"]);
const RESOLUTIONS = Object.freeze(["720P", "1080P"]);
const DURATIONS = Object.freeze([2, 15]);
const SEEDS = Object.freeze([null, 0, 2_147_483_647]);
const CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const SETTINGS_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json";
const ATTEMPT_PREFIX = "link_wan_t2v_installed_checker_";
const SOURCE_MODULES = Object.freeze([
  "application/owner-wan-t2v-generation-parameters", "application/owner-wan-t2v-generation-service",
  "application/account-status", "application/model-access", "adapter/syntx/owner-wan-t2v-video-result",
  "adapter/syntx/chat-http-client", "mcp/owner-wan-t2v-video-tools", "mcp/server",
  "runtime/observed-owner-runtime", "transports/stdio-owner", "catalog/selected-discovery-catalog",
  "catalog/public-catalog-history", "catalog/mapless-settings-inventory", "auth/in-memory-auth-store"
]);
export const WAN_T2V_REQUIRED_PACKAGE_PATHS = Object.freeze([
  "package.json", "dist/src/index.js", "dist/src/index.d.ts",
  ...SOURCE_MODULES.flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`]),
  `catalog/public/${CATALOG_VERSION}`, `catalog/settings/v2/${SETTINGS_VERSION}`
]);
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

export function assertWanT2vPackagePaths(paths) {
  if (!(paths instanceof Set)) fail("INSTALLED_WAN_T2V_PACKAGE_PATHS_INVALID");
  if (WAN_T2V_REQUIRED_PACKAGE_PATHS.some((path) => !paths.has(path))) fail("INSTALLED_WAN_T2V_PACKAGE_CONTENT_MISSING");
  return true;
}

export function assertWanT2vFlagReader(stdio) {
  const reader = stdio?.readOwnerWanT2vVideosFlag;
  if (typeof reader !== "function" || reader(undefined) !== false || reader("") !== false || reader("0") !== false || reader("1") !== true) {
    fail("INSTALLED_WAN_T2V_FLAG_READER_INVALID");
  }
  for (const value of ["true", "yes", "01", " 1 ", "1 ", "2"]) {
    let rejected = false; try { reader(value); } catch { rejected = true; }
    if (!rejected) fail("INSTALLED_WAN_T2V_FLAG_READER_INVALID");
  }
  return true;
}

export function assertWanT2vToolNames(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_WAN_T2V_TOOL_LIST_INVALID");
  const names = tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length) fail("INSTALLED_WAN_T2V_DEFAULT_OFF_FAILED");
    return Object.freeze({ tool_count: 0 });
  }
  if (names.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => names.filter((entry) => entry === name).length !== 1)) {
    fail("INSTALLED_WAN_T2V_TOOL_SET_MISMATCH");
  }
  return Object.freeze({ tool_count: TOOL_NAMES.length });
}

export function assertWanT2vToolSurface(tools, enabled, modules) {
  const names = assertWanT2vToolNames(tools, enabled);
  if (!enabled) return Object.freeze({ ...names, closed_schemas: true, model_branches: 0 });
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const [parameters, generate, reconcile, list, page] = TOOL_NAMES.map((name) => byName.get(name));
  const inputKeys = [[], ["link_attempt_id", "model_id", "parameters", "prompt"], ["link_attempt_id", "recovery_id"],
    ["link_attempt_id"], ["link_attempt_id", "recovery_id"]];
  const outputKeys = [
    ["backend_acceptance", "caller_gaps", "controls", "cost_projection", "dispatch_allowed", "effective_defaults", "models", "runtime_usable", "source_pins", "status"],
    ["artifacts", "backend_acceptance", "cost_input_confidence", "cost_inputs", "diagnostic", "has_more", "model_id", "next_offset", "observed_artifact_count", "offset", "page_size", "parameters", "provider_terminal_status", "recovery_id", "status", "status_semantics"],
    ["artifacts", "backend_acceptance", "cost_input_confidence", "cost_inputs", "diagnostic", "has_more", "model_id", "next_offset", "observed_artifact_count", "offset", "page_size", "parameters", "provider_terminal_status", "recovery_id", "status", "status_semantics"],
    ["recoveries"],
    ["artifacts", "backend_acceptance", "cost_input_confidence", "cost_inputs", "diagnostic", "has_more", "model_id", "next_offset", "observed_artifact_count", "offset", "page_size", "parameters", "provider_terminal_status", "recovery_id", "status", "status_semantics"]
  ];
  for (let index = 0; index < TOOL_NAMES.length; index += 1) {
    const tool = byName.get(TOOL_NAMES[index]);
    assertExactClosedObject(tool?.inputSchema, inputKeys[index], index === 3 ? ["limit"] : index === 4 ? ["offset"] : [],
      `INSTALLED_WAN_T2V_INPUT_SCHEMA_${index}_INVALID`);
    assertExactClosedObject(tool?.outputSchema, outputKeys[index], [], `INSTALLED_WAN_T2V_OUTPUT_SCHEMA_${index}_INVALID`);
    assertEveryObjectClosed(tool.inputSchema, `INSTALLED_WAN_T2V_INPUT_SCHEMA_${index}_INVALID`);
    assertEveryObjectClosed(tool.outputSchema, `INSTALLED_WAN_T2V_OUTPUT_SCHEMA_${index}_INVALID`);
  }
  const branches = generate.inputSchema.oneOf;
  if (!Array.isArray(branches) || branches.length !== MODELS.length) fail("INSTALLED_WAN_T2V_MODEL_BRANCHES_INVALID");
  for (const [index, branch] of branches.entries()) {
    assertExactClosedObject(branch, ["link_attempt_id", "model_id", "parameters", "prompt"], [], "INSTALLED_WAN_T2V_MODEL_BRANCHES_INVALID");
    if (branch.properties?.model_id?.const !== MODELS[index]) fail("INSTALLED_WAN_T2V_MODEL_BRANCHES_INVALID");
    const parameter = branch.properties.parameters;
    const branchKey = index === 0 ? "shot_type" : "native_audio";
    const expected = ["aspect_ratio", "prompt_extend", "resolution", "seed", "video_duration", branchKey].sort();
    assertExactClosedObject(parameter, expected, [], "INSTALLED_WAN_T2V_MODEL_PARAMETER_BRANCH_INVALID");
    if (!sameArray(parameter.properties.aspect_ratio?.enum, RATIOS) || !sameArray(parameter.properties.resolution?.enum, RESOLUTIONS) ||
        parameter.properties.video_duration?.minimum !== 2 || parameter.properties.video_duration?.maximum !== 15 ||
        parameter.properties.prompt_extend?.type !== "boolean" || parameter.properties.seed?.anyOf?.[0]?.minimum !== 0 ||
        parameter.properties.seed?.anyOf?.[0]?.maximum !== 2_147_483_647) fail("INSTALLED_WAN_T2V_PARAMETER_SCHEMA_INVALID");
    if (index === 0 && !sameArray(parameter.properties.shot_type?.enum, ["single", "multi"])) fail("INSTALLED_WAN_T2V_PARAMETER_SCHEMA_INVALID");
    if (index === 1 && parameter.properties.native_audio?.type !== "boolean") fail("INSTALLED_WAN_T2V_PARAMETER_SCHEMA_INVALID");
  }
  if (generate.annotations?.destructiveHint !== true || reconcile.annotations?.readOnlyHint !== true ||
      list.annotations?.readOnlyHint !== true || page.annotations?.readOnlyHint !== true ||
      reconcile.annotations?.idempotentHint !== true || page.annotations?.idempotentHint !== true) fail("INSTALLED_WAN_T2V_TOOL_ANNOTATIONS_INVALID");
  if (typeof modules?.tools?.OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS?.generate?.safeParse !== "function") {
    fail("INSTALLED_WAN_T2V_INPUT_VALIDATOR_MISSING");
  }
  const parameterCases = assertWanT2vParameterMatrix(modules.tools.OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS.generate);
  assertWanT2vSourceOutput(modules.tools.OWNER_WAN_T2V_TOOL_OUTPUT_SCHEMAS.parameters.safeParse(
    modules.parameters.getOwnerWanT2vGenerationParametersSource()));
  return Object.freeze({ ...names, closed_schemas: true, model_branches: 2, parameter_schema_cases: parameterCases });
}

export function assertWanT2vParameterMatrix(schema) {
  let cases = 0;
  for (const model_id of MODELS) for (const aspect_ratio of RATIOS) for (const resolution of RESOLUTIONS) {
    for (const video_duration of DURATIONS) for (const prompt_extend of [false, true]) for (const seed of SEEDS) {
      const branches = model_id === "wan_26_t2v" ? ["single", "multi"] : [false, true];
      for (const branch of branches) {
        const parameters = { aspect_ratio, resolution, video_duration, prompt_extend, seed,
          ...(model_id === "wan_26_t2v" ? { shot_type: branch } : { native_audio: branch }) };
        if (!schema.safeParse({ link_attempt_id: `${ATTEMPT_PREFIX}000000000001`, model_id, prompt: "explicit installed schema test", parameters }).success) {
          fail("INSTALLED_WAN_T2V_PARAMETER_MATRIX_INVALID");
        }
        cases += 1;
      }
    }
  }
  if (cases !== 480) fail("INSTALLED_WAN_T2V_PARAMETER_MATRIX_INVALID");
  const base = { link_attempt_id: `${ATTEMPT_PREFIX}000000000001`, model_id: MODELS[0], prompt: "valid", parameters: {
    aspect_ratio: RATIOS[0], resolution: RESOLUTIONS[0], video_duration: 5, prompt_extend: false, seed: null, shot_type: "single"
  } };
  for (const [field, value] of [["n", 1], ["model_type", "wan_26_t2v"], ["size", "720P"], ["version", "v1"], ["file_urls", []], ["reference_handles", []]]) {
    if (schema.safeParse({ ...base, [field]: value }).success) fail("INSTALLED_WAN_T2V_INPUT_NEGATIVE_MATRIX_INVALID");
  }
  if (schema.safeParse({ ...base, prompt: "😀".repeat(17_000) }).success ||
      schema.safeParse({ ...base, parameters: { ...base.parameters, video_duration: 1 } }).success ||
      schema.safeParse({ ...base, parameters: { ...base.parameters, native_audio: false } }).success) {
    fail("INSTALLED_WAN_T2V_INPUT_NEGATIVE_MATRIX_INVALID");
  }
  return cases;
}

export function assertWanT2vSourceContract(parametersModule, toolsModule) {
  const source = parametersModule?.getOwnerWanT2vGenerationParametersSource?.();
  if (!isRecord(source) || !sameArray(source.models?.map((row) => row.model_id), MODELS) ||
      source.source_pins?.public_catalog_version !== CATALOG_VERSION || source.source_pins?.settings_inventory_version !== SETTINGS_VERSION ||
      source.runtime_usable !== false || source.dispatch_allowed !== false || source.backend_acceptance !== "UNPROVEN" ||
      source.effective_defaults !== "UNKNOWN" || source.cost_projection?.amount_or_quote !== "UNPROVEN" ||
      !sameArray(source.controls?.resolution?.values, RESOLUTIONS) || !sameArray(source.controls?.aspect_ratio?.values, RATIOS) ||
      source.controls?.video_duration?.minimum !== 2 || source.controls?.video_duration?.maximum !== 15 ||
      source.controls?.seed?.minimum !== 0 || source.controls?.seed?.maximum !== 2_147_483_647 ||
      !sameArray(source.cost_projection?.declared_keys, ["video_duration", "resolution"]) ||
      source.models.some((model) => model.static_status !== "CURRENT_STATIC_SOURCE_METADATA_ONLY" || model.ai_name !== "wan_video")) {
    fail("INSTALLED_WAN_T2V_SOURCE_CONTRACT_INVALID");
  }
  const parsed = toolsModule?.OWNER_WAN_T2V_TOOL_OUTPUT_SCHEMAS?.parameters?.safeParse(source);
  assertWanT2vSourceOutput(parsed);
  return Object.freeze({ models: source.models.length, source_flags_false: true, public_catalog_version: CATALOG_VERSION, settings_inventory_version: SETTINGS_VERSION });
}

export function assertWanT2vPublicExports(api, modules) {
  const pairs = [
    ["OWNER_WAN_T2V_GENERATION_MODEL_IDS", "parameters"], ["getOwnerWanT2vGenerationParametersSource", "parameters"],
    ["normalizeOwnerWanT2vGenerationParameters", "parameters"], ["OwnerWanT2vGenerationParametersError", "parameters"],
    ["OWNER_WAN_T2V_TOOL_NAMES", "tools"], ["OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS", "tools"],
    ["OWNER_WAN_T2V_TOOL_OUTPUT_SCHEMAS", "tools"], ["SYNTX_GET_WAN_T2V_PARAMETERS_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_GENERATE_WAN_T2V_VIDEO_TOOL_NAME", "tools"], ["SYNTX_OWNER_RECONCILE_WAN_T2V_VIDEO_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_LIST_WAN_T2V_RECOVERIES_TOOL_NAME", "tools"], ["SYNTX_OWNER_GET_WAN_T2V_RESULT_PAGE_TOOL_NAME", "tools"],
    ["registerSyntxOwnerWanT2vVideoTools", "tools"], ["createMcpServer", "server"], ["createObservedOwnerRuntime", "runtime"]
  ];
  if (!isRecord(api) || pairs.some(([name, group]) => !isRecord(modules[group]) || api[name] === undefined || api[name] !== modules[group][name])) {
    fail("INSTALLED_WAN_T2V_PUBLIC_EXPORT_MISMATCH");
  }
  for (const name of ["OwnerWanT2vGenerationService", "OwnerWanT2vGenerationServiceError", "OwnerWanT2vPreparedCandidate",
    "OwnerWanT2vGenerationWireCandidatePrivate", "OwnerWanT2vOneShotPermit", "OwnerWanT2vVideoResultReadContext"]) {
    if (Object.hasOwn(api, name)) fail("INSTALLED_WAN_T2V_PRIVATE_EXPORT_LEAK");
  }
  return true;
}

export function assertWanT2vDeclarations(text) {
  if (typeof text !== "string") fail("INSTALLED_WAN_T2V_DECLARATIONS_INVALID");
  const safe = ["OwnerWanT2vGenerationModel", "OwnerWanT2vGenerationParameters", "OwnerWanT2vGenerationIntent",
    "OwnerWanT2vGenerationSourceContract", "OwnerWanT2vGenerationNormalizedIntent", "OwnerWanT2vGenerationWireCandidate",
    "OwnerWanT2vVideoServiceComposition", "RegisterSyntxOwnerWanT2vVideoToolsOptions"];
  if (safe.some((name) => !text.includes(name))) fail("INSTALLED_WAN_T2V_DECLARATIONS_INVALID");
  for (const name of ["OwnerWanT2vGenerationService", "OwnerWanT2vGenerationServiceError", "OwnerWanT2vPreparedCandidate", "OwnerWanT2vOneShotPermit"]) {
    if (new RegExp(`export\\s+(?:declare\\s+)?(?:type\\s+)?(?:class|interface|type|const|function)\\s+${name}\\b`, "u").test(text)) {
      fail("INSTALLED_WAN_T2V_PRIVATE_DECLARATION_LEAK");
    }
  }
  return true;
}

export async function loadWanT2vConsumerSdk(consumerPath) {
  if (typeof consumerPath !== "string" || !isAbsolute(consumerPath)) fail("INSTALLED_WAN_T2V_CONSUMER_PATH_INVALID");
  const require = createRequire(join(consumerPath, "package.json"));
  let files;
  try {
    files = ["@modelcontextprotocol/sdk/client/index.js", "@modelcontextprotocol/sdk/client/stdio.js", "@modelcontextprotocol/sdk/inMemory.js"]
      .map((specifier) => require.resolve(specifier));
  } catch { fail("INSTALLED_WAN_T2V_SDK_RESOLUTION_FAILED"); }
  const sdkRoot = await realpath(join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk"));
  const resolvedFiles = await Promise.all(files.map((path) => realpath(path)));
  if (isWithin(PROJECT_ROOT, sdkRoot) || resolvedFiles.some((path) => !isWithin(sdkRoot, path))) fail("INSTALLED_WAN_T2V_SDK_NOT_FROM_CONSUMER");
  const manifest = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8"));
  if (manifest.name !== "@modelcontextprotocol/sdk" || manifest.version !== "1.32.1") fail("INSTALLED_WAN_T2V_SDK_VERSION_MISMATCH");
  const [{ Client }, { StdioClientTransport }, { InMemoryTransport }] = await Promise.all(resolvedFiles.map((path) => import(pathToFileURL(path).href)));
  return Object.freeze({ Client, StdioClientTransport, InMemoryTransport, version: manifest.version });
}

export function formatWanT2vInstalledSummary(proof) {
  const numbers = ["default_tools", "opt_in_tools", "model_branches_checked", "parameter_schema_cases", "generation_posts",
    "result_messages", "artifacts_seen", "page_reads", "page_size", "page_observations", "page_io_delta", "unknown_recoveries",
    "replay_posts", "default_stderr_bytes", "opt_in_stderr_bytes", "default_network_calls", "opt_in_network_calls",
    "authenticated_network_calls", "billing_calls"];
  if (!isRecord(proof) || proof.status !== "INSTALLED_STOCK_SDK_WAN_T2V_CALLTOOL_PASS" || proof.node_version !== "24.21.0" ||
      proof.sdk_version !== "1.32.1" || proof.clean_installed_package !== true || proof.default_tools !== 0 || proof.opt_in_tools !== 5 ||
      proof.model_branches_checked !== 2 || proof.parameter_schema_cases !== 480 || proof.generation_posts !== 5 ||
      proof.result_messages !== 4 || proof.artifacts_seen !== 82 || proof.page_reads !== 1 || proof.page_size !== 64 ||
      proof.page_observations !== 80 || proof.page_io_delta !== 0 || proof.unknown_recoveries !== 1 || proof.recovery_get_only !== true ||
      proof.replay_posts !== 0 || proof.revoke_drain !== "PASS" || proof.eof_drain !== "PASS" || proof.auth_cleanup !== "PASS" ||
      proof.default_child_close !== "CLOSED" || proof.opt_in_child_close !== "CLOSED" || proof.default_child_pid_null !== true ||
      proof.opt_in_child_pid_null !== true || proof.default_stderr_bytes !== 0 || proof.opt_in_stderr_bytes !== 0 ||
      proof.default_network_calls !== 0 || proof.opt_in_network_calls !== 0 || proof.authenticated_network_calls !== 0 ||
      proof.billing_calls !== 0 || proof.runtime_usable !== false || proof.dispatch_allowed !== false ||
      proof.backend_acceptance !== "UNPROVEN" || proof.provider_terminal_status !== "UNPROVEN" ||
      proof.source_catalog_version !== CATALOG_VERSION || proof.source_settings_version !== SETTINGS_VERSION ||
      numbers.some((key) => !Number.isSafeInteger(proof[key]) || proof[key] < 0)) fail("INSTALLED_WAN_T2V_SUMMARY_INVALID");
  return `wan_t2v_installed=${proof.status} node=${proof.node_version} sdk=${proof.sdk_version} clean_package=true ` +
    `default_tools=${proof.default_tools} opt_in_tools=${proof.opt_in_tools} model_branches=${proof.model_branches_checked} ` +
    `parameter_schema_cases=${proof.parameter_schema_cases} generation_posts=${proof.generation_posts} result_messages=${proof.result_messages} ` +
    `artifacts_seen=${proof.artifacts_seen} page_reads=${proof.page_reads} page_size=${proof.page_size} page_observations=${proof.page_observations} ` +
    `page_io_delta=${proof.page_io_delta} unknown_recoveries=${proof.unknown_recoveries} recovery_get_only=${proof.recovery_get_only} ` +
    `source_catalog=${proof.source_catalog_version} source_settings=${proof.source_settings_version} ` +
    `replay_posts=${proof.replay_posts} revoke_drain=${proof.revoke_drain} eof_drain=${proof.eof_drain} auth_cleanup=${proof.auth_cleanup} ` +
    `default_close=${proof.default_child_close} opt_in_close=${proof.opt_in_child_close} default_pid_null=${proof.default_child_pid_null} ` +
    `opt_in_pid_null=${proof.opt_in_child_pid_null} stderr=${proof.default_stderr_bytes + proof.opt_in_stderr_bytes} ` +
    `stdio_network=${proof.default_network_calls + proof.opt_in_network_calls} authenticated_network=${proof.authenticated_network_calls} ` +
    `billing=${proof.billing_calls} runtime_usable=${proof.runtime_usable} dispatch_allowed=${proof.dispatch_allowed} ` +
    `backend_acceptance=${proof.backend_acceptance} provider_terminal_status=${proof.provider_terminal_status}`;
}

export async function assertInstalledWanT2vFlow(installedPackagePath, consumerPath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertWanT2vPackagePaths(packagedPaths);
    if (process.versions.node !== "24.21.0") fail("INSTALLED_WAN_T2V_NODE24_21_REQUIRED");
    if (!isAbsolute(installedPackagePath) || !isAbsolute(consumerPath)) fail("INSTALLED_WAN_T2V_INSTALLED_ROOT_INVALID");
    const installedRoot = await realpath(installedPackagePath);
    if (isWithin(PROJECT_ROOT, installedRoot)) fail("INSTALLED_WAN_T2V_NOT_CLEAN_PACKAGE");
    const manifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
    if (manifest.name !== "syntx-mcp") fail("INSTALLED_WAN_T2V_NOT_CLEAN_PACKAGE");
    phase = "module-import";
    const importPacked = (name) => import(pathToFileURL(join(installedRoot, `dist/src/${name}.js`)).href);
    const [api, parameters, tools, service, result, server, runtime, stdio] = await Promise.all([
      importPacked("index"), importPacked("application/owner-wan-t2v-generation-parameters"), importPacked("mcp/owner-wan-t2v-video-tools"),
      importPacked("application/owner-wan-t2v-generation-service"), importPacked("adapter/syntx/owner-wan-t2v-video-result"),
      importPacked("mcp/server"), importPacked("runtime/observed-owner-runtime"), importPacked("transports/stdio-owner")
    ]);
    const modules = { parameters, tools, service, result, server, runtime, stdio };
    phase = "public-exports";
    assertWanT2vPublicExports(api, modules);
    assertWanT2vDeclarations(await readFile(join(installedRoot, "dist/src/index.d.ts"), "utf8"));
    phase = "source-contract";
    const source = assertWanT2vSourceContract(parameters, tools);
    assertWanT2vFlagReader(stdio);
    phase = "consumer-sdk";
    const sdk = await loadWanT2vConsumerSdk(consumerPath);
    phase = "stdio-surfaces";
    const off = await listInstalledTools(installedRoot, consumerPath, sdk, false, modules);
    const on = await listInstalledTools(installedRoot, consumerPath, sdk, true, modules);
    phase = "calltool-regression";
    const fixture = await runWanT2vCallToolRegression(modules, sdk);
    const proof = Object.freeze({ ...fixture, default_tools: off.tool_count, opt_in_tools: on.tool_count,
      node_version: process.versions.node, sdk_version: sdk.version, clean_installed_package: true,
      default_child_close: off.child_close, opt_in_child_close: on.child_close,
      default_child_pid_null: off.child_pid_null, opt_in_child_pid_null: on.child_pid_null,
      default_stderr_bytes: off.stderr_bytes, opt_in_stderr_bytes: on.stderr_bytes,
      default_network_calls: off.network_calls, opt_in_network_calls: on.network_calls,
      runtime_usable: source.source_flags_false ? false : true, dispatch_allowed: source.source_flags_false ? false : true,
      backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN" });
    // Validate the formatter against counters measured by the actual installed callTool run above.
    formatWanT2vInstalledSummary(proof);
    return proof;
  } catch (error) {
    if (error instanceof WanT2vFlowInstalledCheckError) throw error;
    fail(`INSTALLED_WAN_T2V_${phase.replace(/[^a-z0-9]+/giu, "_").toUpperCase()}_FAILED`);
  }
}

export async function listInstalledTools(packageRoot, consumerPath, sdk, enabled, modules) {
  const directory = await mkdtemp(join(tmpdir(), "wan-t2v-installed-stdio-"));
  const audit = join(directory, "fetch-count"), preload = join(directory, "network-guard.mjs");
  await writeFile(preload, `import { writeFileSync } from 'node:fs'; let n=0; globalThis.fetch=(...a)=>{n++;return Promise.reject(new Error('NETWORK_DISABLED'));}; process.on('exit',()=>{try{writeFileSync(process.env.SYNTX_WAN_T2V_FETCH_AUDIT,String(n))}catch{}});\n`, { mode: 0o600 });
  const client = new sdk.Client({ name: enabled ? "wan-t2v-opt-in" : "wan-t2v-default", version: "1.0.0" }, { capabilities: {} });
  const transport = new sdk.StdioClientTransport({ command: process.execPath, args: [join(packageRoot, "dist/src/transports/stdio-owner.js")],
    cwd: consumerPath, env: { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: directory, XDG_DATA_HOME: directory,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, SYNTX_WAN_T2V_FETCH_AUDIT: audit,
      ...(enabled ? { SYNTX_OWNER_WAN_T2V_VIDEOS: "1" } : {}) }, stderr: "pipe" });
  let closed = false, stderrBytes = 0, connected = false, failure, surface;
  let closeSignal; const closedPromise = new Promise((resolvePromise) => { closeSignal = resolvePromise; });
  transport.onclose = () => { closed = true; closeSignal(); };
  transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  try {
    await withDeadline(client.connect(transport), 7_000, "INSTALLED_WAN_T2V_STDIO_INIT_TIMEOUT"); connected = true;
    const response = await withDeadline(client.listTools({}, { timeout: 7_000, maxTotalTimeout: 7_000 }), 7_000, "INSTALLED_WAN_T2V_TOOLS_LIST_TIMEOUT");
    surface = assertWanT2vToolSurface(response.tools, enabled, modules);
  } catch (error) { failure = error; }
  finally {
    try { await withDeadline(connected ? client.close() : transport.close(), 3_000, "INSTALLED_WAN_T2V_STDIO_CLOSE_TIMEOUT"); }
    catch (error) { failure ??= error; }
    try { await withDeadline(closedPromise, 3_000, "INSTALLED_WAN_T2V_STDIO_PROCESS_DID_NOT_CLOSE"); }
    catch (error) { failure ??= error; }
  }
  try {
    if (failure) throw failure;
    if (!closed || transport.pid !== null || stderrBytes !== 0) fail("INSTALLED_WAN_T2V_STDIO_CLEANUP_FAILED");
    const networkCalls = Number(await readFile(audit, "utf8"));
    if (networkCalls !== 0) fail("INSTALLED_WAN_T2V_STDIO_NETWORK_CALLS");
    return Object.freeze({ ...surface, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes, network_calls: networkCalls });
  } catch (error) {
    if (error instanceof WanT2vFlowInstalledCheckError) throw error;
    fail("INSTALLED_WAN_T2V_STDIO_SURFACE_INVALID");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function runWanT2vCallToolRegression(modules, sdk) {
  if (!modules?.runtime?.createObservedOwnerRuntime || !modules?.server?.createMcpServer || !sdk?.Client || !sdk?.InMemoryTransport) {
    fail("INSTALLED_WAN_T2V_RUNTIME_ABI_MISSING");
  }
  const counts = { chats: 0, generationPosts: 0, historyGets: 0, resultGets: 0, accountReads: 0, modelAccessReads: 0 };
  const transactions = new Map();
  const posts = [];
  const fixedNow = Date.parse("2026-10-13T00:00:00.000Z");
  let revokeAttemptId, revokeStarted, signalSeen, statusAtAbort;
  const revokePostStarted = new Promise((resolvePromise) => { revokeStarted = resolvePromise; });
  const revokeSignalSeen = new Promise((resolvePromise) => { signalSeen = resolvePromise; });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    if (url.origin !== "https://api.syntx.ai") fail("INSTALLED_WAN_T2V_UPSTREAM_ORIGIN_INVALID");
    if (url.pathname === "/api/v1/user/balance" && method === "GET") { counts.accountReads += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      counts.accountReads += 1; return Response.json({ active: true, type: "PRO", end_date: "2026-10-14T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      counts.modelAccessReads += 1; return Response.json({ access: true, cost: 2, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1; return Response.json({ uuid: `wan-t2v-installed-chat-${counts.chats}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      counts.generationPosts += 1;
      const body = JSON.parse(String(init.body));
      if (url.search !== "?ai_name=wan_video" || !sameKeys(body, ["chat_id", "prompt", "settings"]) ||
          body.settings.model_type !== "wan_26_t2v" && body.settings.model_type !== "wan_27_t2v") fail("INSTALLED_WAN_T2V_GENERATION_WIRE_INVALID");
      posts.push(body);
      if (String(body.prompt).includes("wan-t2v-unknown-ack")) return Promise.reject(new Error("synthetic post acknowledgment loss"));
      if (String(body.prompt).includes("wan-t2v-revoke-drain")) {
        revokeStarted();
        return new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (!signal || typeof signal.addEventListener !== "function") fail("INSTALLED_WAN_T2V_REVOKE_SIGNAL_MISSING");
          signal.addEventListener("abort", async () => {
            statusAtAbort = (await runtime.authStore.getSnapshot(runtime.authBinding, revokeAttemptId)).status;
            signalSeen(); reject(new DOMException("synthetic revoke drain", "AbortError"));
          }, { once: true });
        });
      }
      const modelId = body.settings.model_type;
      const outputCount = String(body.prompt).includes("wan-t2v-multi80") ? 80 : 1;
      const ackId = `wan-t2v-installed-owner-${counts.generationPosts}`;
      const ackTextObject = { id: `wan-t2v-installed-ack-text-${counts.generationPosts}`, modelType: modelId };
      let remaining = outputCount, outputIndex = 0;
      const messages = Array.from({ length: Math.ceil(outputCount / 64) }, (_, part) => {
        const count = Math.min(64, remaining); const messageId = `wan-t2v-installed-bot-${counts.generationPosts}-${part + 1}`;
        const objects = Array.from({ length: count }, () => {
          outputIndex += 1; return { id: `wan-t2v-installed-object-${counts.generationPosts}-${outputIndex}`,
            url: `https://r2.syntx.ai/installed/wan-t2v-${counts.generationPosts}-${outputIndex}.mp4` };
        });
        remaining -= count; return { messageId, objects };
      });
      transactions.set(body.chat_id, { ackId, ackTextObject, modelId, messages });
      return Response.json({ id: ackId });
    }
    const history = /^\/api\/v1\/chats\/(wan-t2v-installed-chat-\d+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      counts.historyGets += 1;
      const tx = transactions.get(history[1]);
      const page = Number(url.searchParams.get("page")), pageSize = 10;
      if (!tx) {
        const empty = [];
        return Response.json({ messages: empty, pagination: { page, page_size: pageSize, total_count: 0, total_pages: 0,
          has_next: false, has_previous: false } });
      }
      const all = [{ id: tx.ackId, chat_id: 9123, author_id: 4312, message_object: [{
        id: tx.ackTextObject.id, message_id: tx.ackId, object_type: "text", model_type: tx.ackTextObject.modelType, completed: true
      }] }, ...tx.messages.map((message) => ({
        id: message.messageId, chat_id: 9123, author_id: -1,
        message_object: message.objects.map((item) => ({ id: item.id, message_id: message.messageId, object_type: "video", model_type: tx.modelId }))
      }))];
      const pages = Math.ceil(all.length / pageSize);
      return Response.json({ messages: all.slice((page - 1) * pageSize, page * pageSize),
        pagination: { page, page_size: pageSize, total_count: all.length, total_pages: pages,
          has_next: page < pages, has_previous: page > 1 } });
    }
    const result = /^\/api\/v1\/chats\/(wan-t2v-installed-chat-\d+)\/(wan-t2v-installed-bot-\d+-\d+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      counts.resultGets += 1; const tx = transactions.get(result[1]);
      const message = tx?.messages.find((item) => item.messageId === result[2]);
      if (!tx || !message) fail("INSTALLED_WAN_T2V_RESULT_CONTEXT_INVALID");
      return Response.json({ id: message.messageId, chat_id: 9123, author_id: -1,
        message_object: message.objects.map((item) => ({ id: item.id, message_id: message.messageId, object_type: "video",
          model_type: tx.modelId, completed: true, object_url: item.url })) });
    }
    if (/\/inprogress$/u.test(url.pathname) && method === "GET") return Response.json([]);
    fail("INSTALLED_WAN_T2V_SYNTHETIC_ROUTE_UNEXPECTED");
  };
  const runtime = modules.runtime.createObservedOwnerRuntime({ ownerWanT2vVideosEnabled: true, fetchImpl, now: () => fixedNow,
    requestTimeoutMs: 2_000 });
  const server = modules.server.createMcpServer(runtime.application, runtime.serverOptions);
  const client = new sdk.Client({ name: "wan-t2v-installed-calltool", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = sdk.InMemoryTransport.createLinkedPair();
  let pageIoDelta = -1, replayPosts = -1, revokeDrain = "FAIL", eofDrain = "FAIL", authCleanup = "FAIL";
  let modelBranchesChecked = 0, parameterSchemaCases = 0, artifactsSeen = 0, unknownRecoveries = 0;
  let pageReads = 0, pageObservations = 0, recoveryGetOnly = false;
  let authStoreClosed = false;
  let step = "connect";
  const attempt = (suffix) => `${ATTEMPT_PREFIX}${suffix}_012345678901`;
  const linkAttempt = async (id) => {
    await runtime.authStore.createAttempt({ attempt_id: id, binding: runtime.authBinding, expires_at_ms: fixedNow + 600_000 });
    await runtime.authStore.beginHandoff(runtime.authBinding, id);
    await runtime.authStore.attachChallenge(runtime.authBinding, id, `synthetic-challenge-${id}`);
    await runtime.authStore.beginPoll(runtime.authBinding, id);
    await runtime.authStore.markLinked(runtime.authBinding, id, { scheme: "Bearer", value: `synthetic-credential-${id}` });
  };
  const call = (name, args) => withDeadline(client.callTool({ name, arguments: args }, undefined,
    { timeout: 8_000, maxTotalTimeout: 8_000 }), 8_000, "INSTALLED_WAN_T2V_CALLTOOL_TIMEOUT");
  try {
    await withDeadline(server.connect(serverTransport), 3_000, "INSTALLED_WAN_T2V_SERVER_CONNECT_TIMEOUT");
    await withDeadline(client.connect(clientTransport), 3_000, "INSTALLED_WAN_T2V_CLIENT_CONNECT_TIMEOUT");
    const actualTools = await withDeadline(client.listTools({}, { timeout: 3_000, maxTotalTimeout: 3_000 }), 3_000,
      "INSTALLED_WAN_T2V_INPROCESS_TOOLS_LIST_TIMEOUT");
    assertWanT2vToolSurface(actualTools.tools, true, modules);
    const names = actualTools.tools.map((tool) => tool.name).filter((name) => TOOL_NAMES.includes(name));
    if (!sameArray(names, TOOL_NAMES)) fail("INSTALLED_WAN_T2V_INPROCESS_TOOLS_INVALID");

    step = "source_tool";
    const sourceRead = await call(TOOL_NAMES[0], {});
    if (sourceRead.isError || sourceRead.structuredContent?.runtime_usable !== false || sourceRead.structuredContent?.dispatch_allowed !== false ||
        sourceRead.structuredContent?.backend_acceptance !== "UNPROVEN") fail("INSTALLED_WAN_T2V_SOURCE_TOOL_INVALID");

    step = "parameter_matrix";
    parameterSchemaCases = assertWanT2vParameterMatrix(modules.tools.OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS.generate);
    step = "model26";
    await linkAttempt(attempt("model26"));
    const prompt26 = "Explicit installed WAN 2.6 model-branch intent.";
    const result26 = await call(TOOL_NAMES[1], { link_attempt_id: attempt("model26"), model_id: "wan_26_t2v", prompt: prompt26,
      parameters: { resolution: "1080P", aspect_ratio: "16:9", video_duration: 2, prompt_extend: true,
        seed: 2_147_483_647, shot_type: "multi" } });
    if (result26.isError) {
      const error = readErrorText(result26);
      let hint = "";
      if (error?.error?.code === "OUTCOME_UNKNOWN" && typeof error.error.recovery_id === "string") {
        const listed = await call(TOOL_NAMES[3], { link_attempt_id: attempt("model26") });
        const diagnostic = listed.structuredContent?.recoveries?.[0]?.diagnostic;
        hint = safeDiagnosticHint(diagnostic);
      }
      fail(`INSTALLED_WAN_T2V_MODEL26_SERVICE_${safeServiceErrorCode(result26)}${hint ? `_${hint}` : ""}`);
    }
    if (result26.structuredContent?.model_id !== "wan_26_t2v") fail("INSTALLED_WAN_T2V_MODEL26_MODEL_ECHO_INVALID");
    if (result26.structuredContent?.artifacts?.length !== 1) fail("INSTALLED_WAN_T2V_MODEL26_ARTIFACT_COUNT_INVALID");
    if (result26.structuredContent?.backend_acceptance !== "UNPROVEN" || result26.structuredContent?.provider_terminal_status !== "UNPROVEN") {
      fail("INSTALLED_WAN_T2V_MODEL26_ACCEPTANCE_BOUNDARY_INVALID");
    }
    artifactsSeen += result26.structuredContent.artifacts.length;
    modelBranchesChecked += 1;

    step = "model27";
    await linkAttempt(attempt("model27"));
    const prompt27 = "Explicit installed WAN 2.7 model-branch intent.";
    const result27 = await call(TOOL_NAMES[1], { link_attempt_id: attempt("model27"), model_id: "wan_27_t2v", prompt: prompt27,
      parameters: { resolution: "720P", aspect_ratio: "4:3", video_duration: 15, prompt_extend: false, seed: null, native_audio: true } });
    if (result27.isError || result27.structuredContent?.model_id !== "wan_27_t2v" || result27.structuredContent?.artifacts?.length !== 1) {
      fail("INSTALLED_WAN_T2V_MODEL27_CALLTOOL_INVALID");
    }
    artifactsSeen += result27.structuredContent.artifacts.length;
    modelBranchesChecked += 1;
    const postBodies = transactions.size;
    if (postBodies !== 2) fail("INSTALLED_WAN_T2V_TWO_BRANCH_POST_COUNT_INVALID");
    const expectedPostSettings = [
      { model_type: "wan_26_t2v", resolution: "1080P", aspect_ratio: "16:9", video_duration: 2, prompt_extend: true,
        seed: 2_147_483_647, shot_type: "multi", file_urls: [] },
      { model_type: "wan_27_t2v", resolution: "720P", aspect_ratio: "4:3", video_duration: 15, prompt_extend: false,
        seed: null, native_audio: true, file_urls: [] }
    ];
    if (posts.length < 2 || !sameKeys(posts[0].settings, Object.keys(expectedPostSettings[0])) ||
        !sameJson(posts[0].settings, expectedPostSettings[0]) || !sameJson(posts[1].settings, expectedPostSettings[1]) ||
        posts[0].prompt !== prompt26 || posts[1].prompt !== prompt27) fail("INSTALLED_WAN_T2V_MODEL_SETTINGS_WIRE_INVALID");

    step = "multi80";
    await linkAttempt(attempt("multi80"));
    const multi = await call(TOOL_NAMES[1], { link_attempt_id: attempt("multi80"), model_id: "wan_26_t2v", prompt: "wan-t2v-multi80 native history fixture",
      parameters: { resolution: "720P", aspect_ratio: "1:1", video_duration: 5, prompt_extend: true, seed: null, shot_type: "single" } });
    if (multi.isError || multi.structuredContent?.observed_artifact_count !== 80 || multi.structuredContent?.artifacts?.length !== 64 ||
        multi.structuredContent?.next_offset !== 64 || multi.structuredContent?.has_more !== true) fail("INSTALLED_WAN_T2V_PAGE_ONE_INVALID");
    artifactsSeen += multi.structuredContent.artifacts.length;
    const beforePageIo = { post: counts.generationPosts, history: counts.historyGets, result: counts.resultGets };
    const secondPage = await call(TOOL_NAMES[4], { link_attempt_id: attempt("multi80"), recovery_id: multi.structuredContent.recovery_id, offset: 64 });
    pageIoDelta = counts.generationPosts - beforePageIo.post + counts.historyGets - beforePageIo.history + counts.resultGets - beforePageIo.result;
    if (secondPage.isError || secondPage.structuredContent?.artifacts?.length !== 16 || secondPage.structuredContent?.has_more !== false ||
        secondPage.structuredContent?.observed_artifact_count !== 80 || pageIoDelta !== 0) fail("INSTALLED_WAN_T2V_PAGE_TWO_INVALID");
    artifactsSeen += secondPage.structuredContent.artifacts.length;
    pageReads += 1;
    pageObservations += multi.structuredContent.artifacts.length + secondPage.structuredContent.artifacts.length;

    step = "unknown_recovery";
    await linkAttempt(attempt("unknown"));
    const unknown = await call(TOOL_NAMES[1], { link_attempt_id: attempt("unknown"), model_id: "wan_27_t2v", prompt: "wan-t2v-unknown-ack",
      parameters: { resolution: "720P", aspect_ratio: "1:1", video_duration: 5, prompt_extend: false, seed: null, native_audio: false } });
    const unknownError = readErrorText(unknown);
    const recoveryId = unknownError?.error?.recovery_id;
    if (!unknown.isError || unknownError?.error?.code !== "OUTCOME_UNKNOWN" || !/^wan_t2v_recovery_[0-9a-f-]{36}$/u.test(String(recoveryId))) {
      fail("INSTALLED_WAN_T2V_UNKNOWN_OUTCOME_INVALID");
    }
    unknownRecoveries += 1;
    const recoveryList = await call(TOOL_NAMES[3], { link_attempt_id: attempt("unknown") });
    if (recoveryList.isError || recoveryList.structuredContent?.recoveries?.[0]?.recovery_id !== recoveryId) fail("INSTALLED_WAN_T2V_RECOVERY_LIST_INVALID");
    const postsBeforeRecovery = counts.generationPosts, historyBeforeRecovery = counts.historyGets;
    const reconciliation = await call(TOOL_NAMES[2], { link_attempt_id: attempt("unknown"), recovery_id: recoveryId });
    const retry = await call(TOOL_NAMES[1], { link_attempt_id: attempt("unknown"), model_id: "wan_27_t2v", prompt: "wan-t2v-unknown-ack",
      parameters: { resolution: "720P", aspect_ratio: "1:1", video_duration: 5, prompt_extend: false, seed: null, native_audio: false } });
    replayPosts = counts.generationPosts - postsBeforeRecovery;
    recoveryGetOnly = counts.generationPosts === postsBeforeRecovery && counts.historyGets > historyBeforeRecovery;
    if (!reconciliation.isError || !retry.isError || replayPosts !== 0 || !recoveryGetOnly) fail("INSTALLED_WAN_T2V_RECOVERY_NOT_GET_ONLY");

    step = "revoke_drain";
    revokeAttemptId = attempt("revoke-drain"); await linkAttempt(revokeAttemptId);
    const pending = call(TOOL_NAMES[1], { link_attempt_id: revokeAttemptId, model_id: "wan_26_t2v", prompt: "wan-t2v-revoke-drain",
      parameters: { resolution: "720P", aspect_ratio: "1:1", video_duration: 5, prompt_extend: true, seed: null, shot_type: "single" } });
    await withDeadline(revokePostStarted, 4_000, "INSTALLED_WAN_T2V_REVOKE_POST_NOT_STARTED");
    const authLink = runtime.serverOptions.auth?.linkService;
    if (!authLink) fail("INSTALLED_WAN_T2V_REVOKE_AUTH_SURFACE_MISSING");
    await withDeadline(authLink.revoke(runtime.authBinding, revokeAttemptId), 4_000, "INSTALLED_WAN_T2V_REVOKE_DRAIN_TIMEOUT");
    await withDeadline(revokeSignalSeen, 2_000, "INSTALLED_WAN_T2V_REVOKE_SIGNAL_TIMEOUT");
    const pendingResult = await withDeadline(pending, 2_000, "INSTALLED_WAN_T2V_REVOKE_CALLTOOL_TIMEOUT");
    if (!pendingResult.isError || statusAtAbort !== "LINKED" ||
        (await runtime.authStore.getSnapshot(runtime.authBinding, revokeAttemptId)).status !== "REVOKED") fail("INSTALLED_WAN_T2V_REVOKE_DRAIN_INVALID");
    revokeDrain = "PASS";

    step = "eof_drain";
    const eofEvents = [], input = new PassThrough();
    let onTransportClose;
    const transportClosed = new Promise((resolvePromise) => { onTransportClose = resolvePromise; });
    const transport = { onclose: undefined, async close() { this.onclose?.(); onTransportClose(); } };
    const lifecycle = runtime.ownerWanT2vVideosLifecycle;
    if (!lifecycle) fail("INSTALLED_WAN_T2V_EOF_LIFECYCLE_MISSING");
    const lifecycleAdapter = { async close() { eofEvents.push("wan_t2v_close"); await lifecycle.close(); } };
    step = "eof_setup";
    const close = modules.stdio.closeOwnerReadServicesOnTransportEof(transport, undefined, undefined, undefined, undefined,
      () => { eofEvents.push("auth_release"); runtime.authStore.close(); authStoreClosed = true; authCleanup = "PASS"; },
      input, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, true, undefined, undefined, undefined, lifecycleAdapter);
    input.resume(); input.end();
    step = "eof_process_close";
    await withDeadline(transportClosed, 3_000, "INSTALLED_WAN_T2V_EOF_PROCESS_DID_NOT_CLOSE");
    step = "eof_service_drain";
    await withDeadline(close(), 3_000, "INSTALLED_WAN_T2V_EOF_DRAIN_TIMEOUT");
    input.destroy();
    step = "eof_order";
    if (!sameArray(eofEvents, ["wan_t2v_close", "auth_release"])) fail("INSTALLED_WAN_T2V_EOF_ORDER_INVALID");
    eofDrain = "PASS";

    step = "proof_return";
    return Object.freeze({ status: "INSTALLED_STOCK_SDK_WAN_T2V_CALLTOOL_PASS", model_branches_checked: modelBranchesChecked,
      parameter_schema_cases: parameterSchemaCases, generation_posts: counts.generationPosts, result_messages: counts.resultGets, artifacts_seen: artifactsSeen,
      page_reads: pageReads, page_size: multi.structuredContent.page_size, page_observations: pageObservations,
      page_io_delta: pageIoDelta, unknown_recoveries: unknownRecoveries,
      recovery_get_only: recoveryGetOnly, replay_posts: replayPosts, revoke_drain: revokeDrain,
      eof_drain: eofDrain, auth_cleanup: authCleanup,
      source_catalog_version: CATALOG_VERSION, source_settings_version: SETTINGS_VERSION,
      authenticated_network_calls: 0, billing_calls: 0, runtime_usable: false, dispatch_allowed: false,
      backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN" });
  } catch (error) {
    if (error instanceof WanT2vFlowInstalledCheckError) throw error;
    const errorName = isRecord(error) && typeof error.name === "string" ? error.name : "";
    const kind = /^[A-Za-z][A-Za-z0-9]{0,31}$/u.test(errorName) ? `OBJECT_${errorName.toUpperCase()}` :
      error === undefined ? "UNDEFINED_THROWN" : error === null ? "NULL_THROWN" : `THROWN_${typeof error}`.toUpperCase();
    fail(`INSTALLED_WAN_T2V_CALLTOOL_${step.toUpperCase()}_${kind}_FAILED`);
  } finally {
    const cleanup = [];
    const cleanupOperations = [() => client.close(), () => server.close(), () => runtime.ownerWanT2vVideosLifecycle?.close(),
      ...(authStoreClosed ? [] : [() => runtime.authStore.close()])];
    for (const operation of cleanupOperations) {
      try { await withDeadline(operation(), 2_000, "INSTALLED_WAN_T2V_CLEANUP_TIMEOUT"); } catch { cleanup.push("FAILED"); }
    }
    if (cleanup.length) fail("INSTALLED_WAN_T2V_CLEANUP_FAILED");
  }
}

function assertWanT2vSourceOutput(parsed) {
  if (!parsed?.success || parsed.data?.runtime_usable !== false || parsed.data?.dispatch_allowed !== false ||
      parsed.data?.backend_acceptance !== "UNPROVEN" || parsed.data?.source_pins?.public_catalog_version !== CATALOG_VERSION ||
      parsed.data?.source_pins?.settings_inventory_version !== SETTINGS_VERSION) fail("INSTALLED_WAN_T2V_SOURCE_OUTPUT_INVALID");
}
function assertExactClosedObject(schema, required, optional, code) {
  if (!isRecord(schema) || schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(schema.properties ?? {}).sort(), [...required, ...optional].sort()) ||
      !sameArray([...(schema.required ?? [])].sort(), [...required].sort())) fail(code);
}
function assertEveryObjectClosed(value, code) {
  if (Array.isArray(value)) { value.forEach((item) => assertEveryObjectClosed(item, code)); return; }
  if (!isRecord(value)) return;
  if (value.type === "object" && value.additionalProperties !== false) fail(code);
  for (const child of Object.values(value)) assertEveryObjectClosed(child, code);
}
function readErrorText(result) {
  const text = Array.isArray(result?.content) ? result.content.find((item) => item?.type === "text")?.text : undefined;
  try { return JSON.parse(text ?? "{}"); } catch { return undefined; }
}
function safeServiceErrorCode(result) {
  const code = readErrorText(result)?.error?.code;
  return ["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH", "PREFLIGHT_FAILED",
    "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"].includes(code) ? code : "UNKNOWN";
}
function safeDiagnosticHint(diagnostic) {
  const candidate = diagnostic?.history_reason ?? diagnostic?.result_reason;
  return typeof candidate === "string" && /^[A-Z0-9_]{1,96}$/u.test(candidate) ? candidate : "";
}
function sameKeys(value, expected) { return isRecord(value) && sameArray(Object.keys(value).sort(), [...expected].sort()); }
function sameJson(actual, expected) { return isDeepStrictEqual(actual, expected); }
function sameArray(actual, expected) { return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((item, index) => item === expected[index]); }
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isWithin(parent, child) { const path = relative(parent, child); return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path)); }
function withDeadline(promise, milliseconds, code) { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new WanT2vFlowInstalledCheckError(code)), milliseconds); })]).finally(() => clearTimeout(timer)); }
function fail(code) { throw new WanT2vFlowInstalledCheckError(code); }
