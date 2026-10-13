#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { isDeepStrictEqual } from "node:util";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class ElevenLabsTtsInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "ElevenLabsTtsInstalledCheckError"; this.code = code; }
}

const MODELS = Object.freeze(["eleven_multilingual_v2", "eleven_v3", "eleven_v4", "eleven_v4_turbo"]);
const TOOL_NAMES = Object.freeze([
  "syntx_get_elevenlabs_tts_parameters", "syntx_owner_list_elevenlabs_voice_references",
  "syntx_owner_generate_elevenlabs_tts", "syntx_owner_reconcile_elevenlabs_tts",
  "syntx_owner_list_elevenlabs_tts_recoveries", "syntx_owner_get_elevenlabs_tts_result_page"
]);
const CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const SETTINGS_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json";
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const SOURCE_MODULES = Object.freeze([
  "application/owner-elevenlabs-generation-parameters", "application/owner-elevenlabs-voice-reference-service",
  "application/owner-elevenlabs-tts-request-preparer", "application/owner-elevenlabs-tts-one-shot-policy",
  "application/owner-elevenlabs-tts-generation-service", "application/account-status", "application/model-access",
  "adapter/syntx/owner-elevenlabs-audio-result", "adapter/syntx/chat-http-client",
  "mcp/owner-elevenlabs-tts-tools", "mcp/server", "runtime/observed-owner-runtime", "transports/stdio-owner",
  "catalog/public-catalog-history", "catalog/discovery-catalog", "auth/in-memory-auth-store", "auth/link-service"
]);
export const ELEVENLABS_TTS_REQUIRED_PACKAGE_PATHS = Object.freeze([
  "package.json", "dist/src/index.js", "dist/src/index.d.ts",
  ...SOURCE_MODULES.flatMap((moduleName) => [`dist/src/${moduleName}.js`, `dist/src/${moduleName}.d.ts`]),
  `catalog/public/${CATALOG_VERSION}`, `catalog/settings/v2/${SETTINGS_VERSION}`
]);

export function assertElevenLabsTtsPackagePaths(paths) {
  if (!(paths instanceof Set)) fail("INSTALLED_ELEVENLABS_TTS_PACKAGE_PATHS_INVALID");
  if (ELEVENLABS_TTS_REQUIRED_PACKAGE_PATHS.some((path) => !paths.has(path))) fail("INSTALLED_ELEVENLABS_TTS_PACKAGE_CONTENT_MISSING");
  return true;
}

export function assertElevenLabsTtsFlagReader(stdio) {
  const reader = stdio?.readOwnerElevenLabsTtsFlag;
  if (typeof reader !== "function" || reader(undefined) !== false || reader("") !== false || reader("0") !== false || reader("1") !== true) {
    fail("INSTALLED_ELEVENLABS_TTS_FLAG_READER_INVALID");
  }
  for (const value of ["true", "yes", "01", " 1 ", "1 ", "2"]) {
    let rejected = false; try { reader(value); } catch { rejected = true; }
    if (!rejected) fail("INSTALLED_ELEVENLABS_TTS_FLAG_READER_INVALID");
  }
  return true;
}

export function assertElevenLabsTtsToolNames(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_ELEVENLABS_TTS_TOOL_LIST_INVALID");
  const selected = tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (selected.length !== 0) fail("INSTALLED_ELEVENLABS_TTS_DEFAULT_OFF_FAILED");
    return Object.freeze({ tool_count: 0 });
  }
  if (selected.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => selected.filter((entry) => entry === name).length !== 1)) {
    fail("INSTALLED_ELEVENLABS_TTS_TOOL_SET_MISMATCH");
  }
  return Object.freeze({ tool_count: TOOL_NAMES.length });
}

export function assertElevenLabsTtsToolSurface(tools, enabled, modules) {
  const names = assertElevenLabsTtsToolNames(tools, enabled);
  if (!enabled) return Object.freeze({ ...names, closed_schemas: true, model_branches: 0 });
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const requiredInputs = [[], ["link_attempt_id"], ["link_attempt_id", "model_id", "mode", "prompt", "voice_ref", "stability", "similarity_boost"],
    ["link_attempt_id", "recovery_id"], ["link_attempt_id"], ["link_attempt_id", "recovery_id"]];
  const optionalInputs = [[], [], ["language_code"], [], ["limit"], ["offset"]];
  const outputKeys = [
    ["backend_acceptance", "controls", "effective_defaults", "models", "runtime_usable", "source_binding", "status"],
    ["coverage", "has_more", "ownership_confidence", "page", "page_size", "source_confidence", "status", "total", "voices"],
    ["artifacts", "backend_acceptance", "diagnostic", "has_more", "model_id", "next_offset", "observed_artifact_count", "offset", "page_size", "parameters", "provider_terminal_status", "recovery_id", "source_binding", "status", "status_semantics"],
    ["artifacts", "backend_acceptance", "diagnostic", "has_more", "model_id", "next_offset", "observed_artifact_count", "offset", "page_size", "parameters", "provider_terminal_status", "recovery_id", "source_binding", "status", "status_semantics"],
    ["recoveries"],
    ["artifacts", "backend_acceptance", "diagnostic", "has_more", "model_id", "next_offset", "observed_artifact_count", "offset", "page_size", "parameters", "provider_terminal_status", "recovery_id", "source_binding", "status", "status_semantics"]
  ];
  for (let index = 0; index < TOOL_NAMES.length; index += 1) {
    const tool = byName.get(TOOL_NAMES[index]);
    assertClosedObject(tool?.inputSchema, requiredInputs[index], optionalInputs[index], `INSTALLED_ELEVENLABS_TTS_INPUT_SCHEMA_${index}_INVALID`);
    assertClosedObject(tool?.outputSchema, outputKeys[index], [], `INSTALLED_ELEVENLABS_TTS_OUTPUT_SCHEMA_${index}_INVALID`);
    assertEveryObjectClosed(tool.inputSchema, `INSTALLED_ELEVENLABS_TTS_INPUT_SCHEMA_${index}_INVALID`);
    assertEveryObjectClosed(tool.outputSchema, `INSTALLED_ELEVENLABS_TTS_OUTPUT_SCHEMA_${index}_INVALID`);
  }
  const generate = byName.get(TOOL_NAMES[2]), branches = generate.inputSchema.oneOf;
  if (!Array.isArray(branches) || branches.length !== MODELS.length) fail("INSTALLED_ELEVENLABS_TTS_MODEL_BRANCHES_INVALID");
  for (const [index, branch] of branches.entries()) {
    assertClosedObject(branch, ["link_attempt_id", "model_id", "mode", "prompt", "voice_ref", "stability", "similarity_boost"],
      index >= 2 ? ["language_code"] : [], "INSTALLED_ELEVENLABS_TTS_MODEL_BRANCH_INVALID");
    if (branch.properties?.model_id?.const !== MODELS[index] || branch.properties?.mode?.const !== "text_to_speech") {
      fail("INSTALLED_ELEVENLABS_TTS_MODEL_BRANCH_INVALID");
    }
    if (index < 2) {
      if (branch.properties.stability?.const !== 0.5 || branch.properties.similarity_boost?.const !== 0.5) {
        fail("INSTALLED_ELEVENLABS_TTS_NON_V4_CONTROL_SCHEMA_INVALID");
      }
    } else if (branch.properties.stability?.minimum !== 0 || branch.properties.stability?.maximum !== 1 ||
        branch.properties.similarity_boost?.minimum !== 0 || branch.properties.similarity_boost?.maximum !== 1 ||
        branch.properties.language_code?.const !== "auto") fail("INSTALLED_ELEVENLABS_TTS_V4_CONTROL_SCHEMA_INVALID");
  }
  if (generate.annotations?.destructiveHint !== true || byName.get(TOOL_NAMES[3]).annotations?.readOnlyHint !== true ||
      byName.get(TOOL_NAMES[4]).annotations?.readOnlyHint !== true || byName.get(TOOL_NAMES[5]).annotations?.readOnlyHint !== true) {
    fail("INSTALLED_ELEVENLABS_TTS_TOOL_ANNOTATIONS_INVALID");
  }
  let controlCases = 0;
  if (modules !== undefined) {
    const schema = modules?.tools?.OWNER_ELEVENLABS_TTS_TOOL_INPUT_SCHEMAS?.generate;
    const outputSchema = modules?.tools?.OWNER_ELEVENLABS_TTS_TOOL_OUTPUT_SCHEMAS?.parameters;
    if (typeof schema?.safeParse !== "function" || typeof outputSchema?.safeParse !== "function") fail("INSTALLED_ELEVENLABS_TTS_VALIDATOR_MISSING");
    controlCases = assertElevenLabsTtsControlMatrix(schema);
    const profile = modules.parameters.getOwnerElevenLabsGenerationParameterProfile();
    if (profile.runtime_usable !== false || profile.dispatch_allowed !== false || profile.backend_acceptance !== "UNPROVEN" ||
        profile.source_binding.public_catalog_version !== CATALOG_VERSION || profile.source_binding.settings_inventory_version !== SETTINGS_VERSION ||
        !sameArray(profile.tts_model_ids, MODELS)) fail("INSTALLED_ELEVENLABS_TTS_SOURCE_CONTRACT_INVALID");
    if (!outputSchema.safeParse(sourceProjectionForCheck(profile)).success) fail("INSTALLED_ELEVENLABS_TTS_SOURCE_SCHEMA_INVALID");
  }
  return Object.freeze({ ...names, closed_schemas: true, model_branches: MODELS.length, control_cases: controlCases });
}

export function assertElevenLabsTtsControlMatrix(schema) {
  if (!schema || typeof schema.safeParse !== "function") fail("INSTALLED_ELEVENLABS_TTS_VALIDATOR_MISSING");
  const attempt = "link_elevenlabs_installed_checker_012345678901";
  const voice_ref = "owner_elevenlabs_voice_00000000-0000-4000-8000-000000000001";
  let checked = 0;
  for (const model_id of MODELS.slice(0, 2)) {
    const candidate = { link_attempt_id: attempt, model_id, mode: "text_to_speech", prompt: "installed source-shaped TTS matrix",
      voice_ref, stability: 0.5, similarity_boost: 0.5 };
    if (!schema.safeParse(candidate).success) fail("INSTALLED_ELEVENLABS_TTS_CONTROL_MATRIX_INVALID");
    checked += 1;
    for (const field of ["stability", "similarity_boost"]) {
      if (schema.safeParse({ ...candidate, [field]: 0.55 }).success) fail("INSTALLED_ELEVENLABS_TTS_NON_V4_CONTROL_MATRIX_INVALID");
    }
  }
  for (const model_id of MODELS.slice(2)) for (let stabilityStep = 0; stabilityStep <= 20; stabilityStep += 1) {
    for (let similarityStep = 0; similarityStep <= 20; similarityStep += 1) {
      const candidate = { link_attempt_id: attempt, model_id, mode: "text_to_speech", prompt: "installed source-shaped TTS matrix",
        voice_ref, stability: stabilityStep / 20, similarity_boost: similarityStep / 20, language_code: "auto" };
      if (!schema.safeParse(candidate).success) fail("INSTALLED_ELEVENLABS_TTS_CONTROL_MATRIX_INVALID");
      checked += 1;
    }
  }
  const invalid = { link_attempt_id: attempt, model_id: MODELS[0], mode: "text_to_speech", prompt: "valid", voice_ref,
    stability: 0.5, similarity_boost: 0.5 };
  for (const extra of [{ mode: "text_to_dialogue" }, { ai_name: "elevenlabs" }, { file_urls: [] }, { n: 1 }, { voice_id: "private" }]) {
    if (schema.safeParse({ ...invalid, ...extra }).success) fail("INSTALLED_ELEVENLABS_TTS_NEGATIVE_MATRIX_INVALID");
  }
  if (schema.safeParse({ ...invalid, prompt: "😀".repeat(2501) }).success ||
      schema.safeParse({ ...invalid, prompt: "\ud800" }).success) fail("INSTALLED_ELEVENLABS_TTS_PROMPT_BOUNDARY_INVALID");
  if (checked !== 884) fail("INSTALLED_ELEVENLABS_TTS_CONTROL_MATRIX_INVALID");
  return checked;
}

export function assertElevenLabsTtsPublicExports(api, modules) {
  const pairs = [
    ["OWNER_ELEVENLABS_TTS_TOOL_NAMES", "tools"], ["OWNER_ELEVENLABS_TTS_TOOL_INPUT_SCHEMAS", "tools"],
    ["OWNER_ELEVENLABS_TTS_TOOL_OUTPUT_SCHEMAS", "tools"], ["registerSyntxOwnerElevenLabsTtsTools", "tools"],
    ["SYNTX_GET_ELEVENLABS_TTS_PARAMETERS_TOOL_NAME", "tools"], ["SYNTX_OWNER_LIST_ELEVENLABS_VOICE_REFERENCES_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_GENERATE_ELEVENLABS_TTS_TOOL_NAME", "tools"], ["SYNTX_OWNER_RECONCILE_ELEVENLABS_TTS_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_LIST_ELEVENLABS_TTS_RECOVERIES_TOOL_NAME", "tools"], ["SYNTX_OWNER_GET_ELEVENLABS_TTS_RESULT_PAGE_TOOL_NAME", "tools"],
    ["OWNER_ELEVENLABS_TTS_MODEL_IDS", "parameters"], ["getOwnerElevenLabsGenerationParameterProfile", "parameters"],
    ["normalizeOwnerElevenLabsGenerationParameters", "parameters"], ["createObservedOwnerRuntime", "runtime"], ["createMcpServer", "server"]
  ];
  if (!isRecord(api) || pairs.some(([name, group]) => !isRecord(modules[group]) || api[name] === undefined || api[name] !== modules[group][name])) {
    fail("INSTALLED_ELEVENLABS_TTS_PUBLIC_EXPORT_MISMATCH");
  }
  for (const name of ["OwnerElevenLabsTtsGenerationService", "OwnerElevenLabsVoiceReferenceService", "OwnerElevenLabsTtsRequestPreparer",
    "OwnerElevenLabsTtsOneShotPolicy", "OwnerElevenLabsTtsPreparedCandidate", "OwnerElevenLabsVoicePrivateResolution",
    "OwnerElevenLabsTtsChatContext", "OwnerElevenLabsAudioResultReadContext"]) {
    if (Object.hasOwn(api, name)) fail("INSTALLED_ELEVENLABS_TTS_PRIVATE_EXPORT_LEAK");
  }
  return true;
}

export function assertElevenLabsTtsDeclarations(text) {
  if (typeof text !== "string") fail("INSTALLED_ELEVENLABS_TTS_DECLARATIONS_INVALID");
  const required = ["OwnerElevenLabsTtsModel", "OwnerElevenLabsTtsRequest", "OwnerElevenLabsTtsGenerationResult",
    "OwnerElevenLabsTtsRecoveryListItem", "OwnerElevenLabsTtsServiceComposition", "RegisterSyntxOwnerElevenLabsTtsToolsOptions"];
  if (required.some((name) => !text.includes(name))) fail("INSTALLED_ELEVENLABS_TTS_DECLARATIONS_INVALID");
  for (const name of ["OwnerElevenLabsTtsGenerationService", "OwnerElevenLabsVoiceReferenceService", "OwnerElevenLabsTtsRequestPreparer",
    "OwnerElevenLabsTtsOneShotPolicy", "OwnerElevenLabsTtsPreparedCandidate", "OwnerElevenLabsVoicePrivateResolution"]) {
    if (new RegExp(`export\\s+(?:declare\\s+)?(?:type\\s+)?(?:class|interface|type|const|function)\\s+${name}\\b`, "u").test(text)) {
      fail("INSTALLED_ELEVENLABS_TTS_PRIVATE_DECLARATION_LEAK");
    }
  }
  return true;
}

export function formatElevenLabsTtsInstalledSummary(proof) {
  const counters = ["default_tools", "opt_in_tools", "model_branches_checked", "control_cases_checked", "generation_posts", "result_messages",
    "artifacts_seen", "page_reads", "page_size", "page_observations", "page_io_delta", "unknown_recoveries", "replay_posts",
    "default_stderr_bytes", "opt_in_stderr_bytes", "default_network_calls", "opt_in_network_calls", "authenticated_network_calls",
    "billing_calls", "voice_provider_ids_exposed", "fresh_preflight_operations"];
  if (!isRecord(proof) || proof.status !== "INSTALLED_STOCK_SDK_ELEVENLABS_TTS_CALLTOOL_PASS" || proof.node_version !== "24.21.0" ||
      proof.sdk_version !== "1.32.1" || proof.clean_installed_package !== true || proof.default_tools !== 0 || proof.opt_in_tools !== 6 ||
      proof.model_branches_checked !== 4 || proof.control_cases_checked !== 884 || proof.generation_posts !== 7 || proof.result_messages !== 7 ||
      proof.artifacts_seen !== 85 || proof.page_reads !== 1 || proof.page_size !== 64 || proof.page_observations !== 80 || proof.page_io_delta !== 0 ||
      proof.unknown_recoveries !== 1 || proof.recovery_get_only !== true || proof.replay_posts !== 0 || proof.revoke_drain !== "PASS" ||
      proof.eof_drain !== "PASS" || proof.auth_cleanup !== "PASS" || proof.default_child_close !== "CLOSED" || proof.opt_in_child_close !== "CLOSED" ||
      proof.default_child_pid_null !== true || proof.opt_in_child_pid_null !== true || proof.default_stderr_bytes !== 0 || proof.opt_in_stderr_bytes !== 0 ||
      proof.default_network_calls !== 0 || proof.opt_in_network_calls !== 0 || proof.authenticated_network_calls !== 0 || proof.billing_calls !== 0 ||
      proof.voice_provider_ids_exposed !== 0 || proof.fresh_preflight_operations !== 14 || proof.runtime_usable !== false ||
      proof.backend_acceptance !== "UNPROVEN" || proof.provider_terminal_status !== "UNPROVEN" || proof.source_catalog_version !== CATALOG_VERSION ||
      counters.some((key) => !Number.isSafeInteger(proof[key]) || proof[key] < 0)) fail("INSTALLED_ELEVENLABS_TTS_SUMMARY_INVALID");
  return `elevenlabs_tts_installed=${proof.status} node=${proof.node_version} sdk=${proof.sdk_version} clean_package=true ` +
    `default_tools=${proof.default_tools} opt_in_tools=${proof.opt_in_tools} models=${proof.model_branches_checked} controls=${proof.control_cases_checked} ` +
    `generation_posts=${proof.generation_posts} result_messages=${proof.result_messages} artifacts=${proof.artifacts_seen} ` +
    `page_reads=${proof.page_reads} page_size=${proof.page_size} page_observations=${proof.page_observations} page_io_delta=${proof.page_io_delta} ` +
    `unknown_recoveries=${proof.unknown_recoveries} recovery_get_only=${proof.recovery_get_only} replay_posts=${proof.replay_posts} ` +
    `fresh_preflights=${proof.fresh_preflight_operations} voice_provider_ids_exposed=${proof.voice_provider_ids_exposed} ` +
    `revoke_drain=${proof.revoke_drain} eof_drain=${proof.eof_drain} auth_cleanup=${proof.auth_cleanup} ` +
    `default_close=${proof.default_child_close} opt_in_close=${proof.opt_in_child_close} default_pid_null=${proof.default_child_pid_null} ` +
    `opt_in_pid_null=${proof.opt_in_child_pid_null} stderr=${proof.default_stderr_bytes + proof.opt_in_stderr_bytes} ` +
    `stdio_network=${proof.default_network_calls + proof.opt_in_network_calls} authenticated_network=${proof.authenticated_network_calls} ` +
    `billing=${proof.billing_calls} source_catalog=${proof.source_catalog_version} runtime_usable=${proof.runtime_usable} ` +
    `backend_acceptance=${proof.backend_acceptance} provider_terminal_status=${proof.provider_terminal_status}`;
}

export async function assertInstalledElevenLabsTtsFlow(installedPackagePath, consumerPath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertElevenLabsTtsPackagePaths(packagedPaths);
    if (process.versions.node !== "24.21.0") fail("INSTALLED_ELEVENLABS_TTS_NODE24_21_REQUIRED");
    if (!isAbsolute(installedPackagePath) || !isAbsolute(consumerPath)) fail("INSTALLED_ELEVENLABS_TTS_INSTALLED_ROOT_INVALID");
    const installedRoot = await realpath(installedPackagePath);
    if (isWithin(PROJECT_ROOT, installedRoot)) fail("INSTALLED_ELEVENLABS_TTS_NOT_CLEAN_PACKAGE");
    const manifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
    if (manifest.name !== "syntx-mcp") fail("INSTALLED_ELEVENLABS_TTS_NOT_CLEAN_PACKAGE");
    phase = "packed-modules";
    const importPacked = (name) => import(pathToFileURL(join(installedRoot, `dist/src/${name}.js`)).href);
    const [api, parameters, tools, generationService, voiceService, prep, oneShot, audioResult, chatClient, server, runtime, stdio,
      catalog, authStore] = await Promise.all([
      importPacked("index"), importPacked("application/owner-elevenlabs-generation-parameters"), importPacked("mcp/owner-elevenlabs-tts-tools"),
      importPacked("application/owner-elevenlabs-tts-generation-service"), importPacked("application/owner-elevenlabs-voice-reference-service"),
      importPacked("application/owner-elevenlabs-tts-request-preparer"), importPacked("application/owner-elevenlabs-tts-one-shot-policy"),
      importPacked("adapter/syntx/owner-elevenlabs-audio-result"), importPacked("adapter/syntx/chat-http-client"),
      importPacked("mcp/server"), importPacked("runtime/observed-owner-runtime"), importPacked("transports/stdio-owner"),
      importPacked("catalog/public-catalog-history"), importPacked("auth/in-memory-auth-store")
    ]);
    const modules = { parameters, tools, generationService, voiceService, prep, oneShot, audioResult, chatClient, server, runtime, stdio };
    phase = "public-surface";
    assertElevenLabsTtsPublicExports(api, modules);
    assertElevenLabsTtsDeclarations(await readFile(join(installedRoot, "dist/src/index.d.ts"), "utf8"));
    assertElevenLabsTtsFlagReader(stdio);
    const sdk = await loadElevenLabsConsumerSdk(consumerPath);
    phase = "stdio-surface";
    const off = await listInstalledElevenLabsTools(installedRoot, consumerPath, sdk, false);
    const on = await listInstalledElevenLabsTools(installedRoot, consumerPath, sdk, true);
    phase = "stock-calltool";
    const flow = await runElevenLabsTtsCallToolFlow(modules, sdk, catalog, authStore);
    const proof = Object.freeze({ ...flow, default_tools: off.tool_count, opt_in_tools: on.tool_count,
      default_child_close: off.child_close, opt_in_child_close: on.child_close,
      default_child_pid_null: off.child_pid_null, opt_in_child_pid_null: on.child_pid_null,
      default_stderr_bytes: off.stderr_bytes, opt_in_stderr_bytes: on.stderr_bytes,
      default_network_calls: off.network_calls, opt_in_network_calls: on.network_calls,
      node_version: process.versions.node, sdk_version: sdk.version, clean_installed_package: true,
      source_catalog_version: CATALOG_VERSION, runtime_usable: false, backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN" });
    formatElevenLabsTtsInstalledSummary(proof);
    return proof;
  } catch (error) {
    if (error instanceof ElevenLabsTtsInstalledCheckError) throw error;
    fail(`INSTALLED_ELEVENLABS_TTS_${phase.replace(/[^a-z0-9]+/giu, "_").toUpperCase()}_FAILED`);
  }
}

export async function loadElevenLabsConsumerSdk(consumerPath) {
  if (typeof consumerPath !== "string" || !isAbsolute(consumerPath)) fail("INSTALLED_ELEVENLABS_TTS_CONSUMER_PATH_INVALID");
  const require = createRequire(join(consumerPath, "package.json"));
  let files;
  try { files = ["@modelcontextprotocol/sdk/client/index.js", "@modelcontextprotocol/sdk/client/stdio.js", "@modelcontextprotocol/sdk/inMemory.js"].map((item) => require.resolve(item)); }
  catch { fail("INSTALLED_ELEVENLABS_TTS_SDK_RESOLUTION_FAILED"); }
  const sdkRoot = await realpath(join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk"));
  const resolved = await Promise.all(files.map((path) => realpath(path)));
  if (isWithin(PROJECT_ROOT, sdkRoot) || resolved.some((path) => !isWithin(sdkRoot, path))) fail("INSTALLED_ELEVENLABS_TTS_SDK_NOT_FROM_CONSUMER");
  const manifest = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8"));
  if (manifest.name !== "@modelcontextprotocol/sdk" || manifest.version !== "1.32.1") fail("INSTALLED_ELEVENLABS_TTS_SDK_VERSION_MISMATCH");
  const [{ Client }, { StdioClientTransport }, { InMemoryTransport }] = await Promise.all(resolved.map((path) => import(pathToFileURL(path).href)));
  return Object.freeze({ Client, StdioClientTransport, InMemoryTransport, version: manifest.version });
}

export async function listInstalledElevenLabsTools(packageRoot, consumerPath, sdk, enabled) {
  const directory = await mkdtemp(join(tmpdir(), "elevenlabs-tts-installed-stdio-"));
  const audit = join(directory, "fetch-count"), preload = join(directory, "network-guard.mjs");
  await writeFile(preload, "import { writeFileSync } from 'node:fs'; let count=0; globalThis.fetch=(...args)=>{count++;return Promise.reject(new Error('NETWORK_DISABLED'));}; process.on('exit',()=>{try{writeFileSync(process.env.SYNTX_ELEVENLABS_TTS_FETCH_AUDIT,String(count))}catch{}});\n", { mode: 0o600 });
  const client = new sdk.Client({ name: enabled ? "elevenlabs-tts-opt-in" : "elevenlabs-tts-default", version: "1.0.0" }, { capabilities: {} });
  const transport = new sdk.StdioClientTransport({ command: process.execPath, args: [join(packageRoot, "dist/src/transports/stdio-owner.js")],
    cwd: consumerPath, env: { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: directory, XDG_DATA_HOME: directory,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, SYNTX_ELEVENLABS_TTS_FETCH_AUDIT: audit,
      ...(enabled ? { SYNTX_OWNER_ELEVENLABS_TTS: "1" } : {}) }, stderr: "pipe" });
  let closed = false, stderrBytes = 0, connected = false, failure, surface;
  let notifyClosed; const closePromise = new Promise((resolvePromise) => { notifyClosed = resolvePromise; });
  transport.onclose = () => { closed = true; notifyClosed(); };
  transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  try {
    await deadline(client.connect(transport), 6_000, "INSTALLED_ELEVENLABS_TTS_STDIO_INIT_TIMEOUT"); connected = true;
    const list = await deadline(client.listTools({}, { timeout: 6_000, maxTotalTimeout: 6_000 }), 6_000, "INSTALLED_ELEVENLABS_TTS_TOOLS_LIST_TIMEOUT");
    surface = assertElevenLabsTtsToolSurface(list.tools, enabled, undefined);
  } catch (error) { failure = error; }
  finally {
    try { await deadline(connected ? client.close() : transport.close(), 2_500, "INSTALLED_ELEVENLABS_TTS_STDIO_CLOSE_TIMEOUT"); } catch (error) { failure ??= error; }
    try { await deadline(closePromise, 2_500, "INSTALLED_ELEVENLABS_TTS_STDIO_PROCESS_CLOSE_TIMEOUT"); } catch (error) { failure ??= error; }
  }
  try {
    if (failure) throw failure;
    if (!closed || transport.pid !== null || stderrBytes !== 0) fail("INSTALLED_ELEVENLABS_TTS_STDIO_CLEANUP_FAILED");
    const networkCalls = Number(await readFile(audit, "utf8"));
    if (networkCalls !== 0) fail("INSTALLED_ELEVENLABS_TTS_STDIO_NETWORK_CALLS");
    return Object.freeze({ ...surface, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes, network_calls: networkCalls });
  } catch (error) {
    if (error instanceof ElevenLabsTtsInstalledCheckError) throw error;
    fail("INSTALLED_ELEVENLABS_TTS_STDIO_SURFACE_FAILED");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function runElevenLabsTtsCallToolFlow(modules, sdk, catalogModule, authStoreModule) {
  if (!modules.runtime?.createObservedOwnerRuntime || !modules.server?.createMcpServer || !sdk?.InMemoryTransport) fail("INSTALLED_ELEVENLABS_TTS_RUNTIME_ABI_MISSING");
  const fixedNow = Date.parse("2026-10-13T02:00:00.000Z"); let now = fixedNow;
  const counts = { chats: 0, generationPosts: 0, historyGets: 0, resultGets: 0, voiceGets: 0, balanceGets: 0, subscriptionGets: 0, modelInfoGets: 0, billingCalls: 0 };
  const transactions = new Map(); const posts = []; let revokeAttemptId, revokeStarted, revokeSignalSeen, statusAtAbort;
  const onRevokePost = new Promise((resolvePromise) => { revokeStarted = resolvePromise; });
  const onRevokeAbort = new Promise((resolvePromise) => { revokeSignalSeen = resolvePromise; });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); const method = init.method ?? "GET";
    if (url.origin !== "https://api.syntx.ai") fail("INSTALLED_ELEVENLABS_TTS_UPSTREAM_ORIGIN_INVALID");
    if (url.pathname === "/api/v1/user/balance" && method === "GET") { counts.balanceGets += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") { counts.subscriptionGets += 1;
      return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" }); }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") { counts.modelInfoGets += 1;
      if (url.searchParams.get("ai_name") !== "elevenlabs" || !MODELS.includes(url.searchParams.get("model_type"))) fail("INSTALLED_ELEVENLABS_TTS_MODEL_ACCESS_QUERY_INVALID");
      return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null }); }
    if (url.pathname === "/api/v1/audio/elevenlabs/voice_examples" && method === "GET") {
      counts.voiceGets += 1;
      if (url.search !== "?page=1&page_size=10") fail("INSTALLED_ELEVENLABS_TTS_VOICE_LIST_QUERY_INVALID");
      return Response.json([{ voice_id: "synthetic_private_elevenlabs_voice", name: "Synthetic installed voice" }]);
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1; const body = JSON.parse(String(init.body));
      if (!sameKeys(body, ["scope", "title"]) || body.scope !== "audio" || typeof body.title !== "string") fail("INSTALLED_ELEVENLABS_TTS_CHAT_BODY_INVALID");
      return Response.json({ uuid: `elevenlabs-installed-chat-${counts.chats}` });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      counts.generationPosts += 1;
      if (url.search !== "?ai_name=elevenlabs") fail("INSTALLED_ELEVENLABS_TTS_GENERATION_ROUTE_INVALID");
      const body = JSON.parse(String(init.body)); const settings = body.settings;
      if (!sameKeys(body, ["chat_uuid", "prompt", "settings"]) || !MODELS.includes(settings?.model_type) ||
          settings.mode !== "text_to_speech" || typeof settings.voice_id !== "string" || !settings.voice_id ||
          !Number.isFinite(settings.stability) || !Number.isFinite(settings.similarity_boost) || !Array.isArray(settings.file_urls) || settings.file_urls.length) {
        fail("INSTALLED_ELEVENLABS_TTS_GENERATION_BODY_INVALID");
      }
      if ((settings.model_type === MODELS[0] || settings.model_type === MODELS[1]) &&
          (settings.stability !== 0.5 || settings.similarity_boost !== 0.5)) fail("INSTALLED_ELEVENLABS_TTS_NON_V4_WIRE_INVALID");
      if ((settings.model_type === MODELS[2] || settings.model_type === MODELS[3]) &&
          (Math.round(settings.stability * 20) !== settings.stability * 20 || Math.round(settings.similarity_boost * 20) !== settings.similarity_boost * 20 ||
            (settings.language_code !== undefined && settings.language_code !== "auto"))) fail("INSTALLED_ELEVENLABS_TTS_V4_WIRE_INVALID");
      posts.push(body);
      const total = body.prompt.includes("elevenlabs-80-output-fixture") ? 80 : 1;
      const ack = `elevenlabs-installed-ack-${counts.generationPosts}`;
      const rows = Array.from({ length: Math.ceil(total / 64) }, (_, batchIndex) => {
        const start = batchIndex * 64, length = Math.min(64, total - start), messageId = `elevenlabs-installed-bot-${counts.generationPosts}-${batchIndex + 1}`;
        const objects = Array.from({ length }, (_, itemIndex) => ({ id: `elevenlabs-installed-object-${counts.generationPosts}-${start + itemIndex + 1}`,
          url: `https://r2.syntx.ai/installed/elevenlabs-${counts.generationPosts}-${start + itemIndex + 1}.mp3` }));
        return { messageId, objects };
      });
      const transaction = { chat: body.chat_uuid, ack, model: settings.model_type, prompt: body.prompt, rows };
      transactions.set(body.chat_uuid, transaction);
      if (body.prompt.includes("elevenlabs-unknown-ack")) throw new Error("synthetic acknowledgement lost after possible audio POST");
      if (body.prompt.includes("elevenlabs-revoke-drain")) {
        revokeStarted();
        return new Promise((_resolve, reject) => {
          if (!init.signal || typeof init.signal.addEventListener !== "function") fail("INSTALLED_ELEVENLABS_TTS_REVOKE_SIGNAL_MISSING");
          init.signal.addEventListener("abort", async () => {
            statusAtAbort = (await runtime.authStore.getSnapshot(runtime.authBinding, revokeAttemptId)).status;
            revokeSignalSeen(); reject(new DOMException("synthetic owner revoke", "AbortError"));
          }, { once: true });
        });
      }
      return Response.json({ id: ack });
    }
    const historyMatch = /^\/api\/v1\/chats\/(elevenlabs-installed-chat-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch && method === "GET") {
      counts.historyGets += 1;
      const tx = transactions.get(historyMatch[1]); if (!tx) fail("INSTALLED_ELEVENLABS_TTS_HISTORY_CONTEXT_INVALID");
      if (url.search !== "?page=1&page_size=10") fail("INSTALLED_ELEVENLABS_TTS_HISTORY_QUERY_INVALID");
      const messages = [{ id: tx.ack, chat_id: 9001, author_id: 42, message_object: [{ id: `ack-object-${tx.ack}`,
        message_id: tx.ack, object_type: "text", object_text: tx.prompt, model_type: tx.model }] }, ...tx.rows.map((row) => ({
        id: row.messageId, chat_id: 9001, author_id: -1,
        message_object: row.objects.map((object) => ({ id: object.id, message_id: row.messageId, object_type: "audio", model_type: tx.model }))
      }))];
      const page = Number(url.searchParams.get("page")), size = 10, totalPages = Math.ceil(messages.length / size);
      return Response.json({ messages: messages.slice((page - 1) * size, page * size), pagination: { page, page_size: size,
        total_count: messages.length, total_pages: totalPages, has_next: page < totalPages, has_previous: page > 1 } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(elevenlabs-installed-chat-\d+)\/(elevenlabs-installed-bot-\d+-\d+)$/u.exec(url.pathname);
    if (resultMatch && method === "GET") {
      counts.resultGets += 1;
      const tx = transactions.get(resultMatch[1]), row = tx?.rows.find((item) => item.messageId === resultMatch[2]);
      if (!tx || !row) fail("INSTALLED_ELEVENLABS_TTS_RESULT_CONTEXT_INVALID");
      return Response.json({ id: row.messageId, chat_id: 9001, author_id: -1, message_object: row.objects.map((object) => ({
        id: object.id, message_id: row.messageId, object_type: "audio", object_url: object.url, completed: true, model_type: tx.model
      })), created_at: "2026-10-13T02:00:00Z", updated_at: "2026-10-13T02:00:00Z", is_favorite: false });
    }
    if (/billing|payment/iu.test(url.pathname)) { counts.billingCalls += 1; fail("INSTALLED_ELEVENLABS_TTS_BILLING_ROUTE_FORBIDDEN"); }
    fail("INSTALLED_ELEVENLABS_TTS_SYNTHETIC_ROUTE_UNEXPECTED");
  };
  const runtime = modules.runtime.createObservedOwnerRuntime({ ownerElevenLabsTtsEnabled: true, fetchImpl, now: () => now, requestTimeoutMs: 2_000 });
  const server = modules.server.createMcpServer(runtime.application, runtime.serverOptions);
  const client = new sdk.Client({ name: "elevenlabs-tts-installed-calltool", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = sdk.InMemoryTransport.createLinkedPair();
  const attempt = (tag) => `link_elevenlabs_installed_${tag}_012345678901`;
  const linkAttempt = async (id) => {
    await runtime.authStore.createAttempt({ attempt_id: id, binding: runtime.authBinding, expires_at_ms: now + 86_400_000 });
    await runtime.authStore.beginHandoff(runtime.authBinding, id);
    await runtime.authStore.attachChallenge(runtime.authBinding, id, `synthetic-challenge-${id}`);
    await runtime.authStore.beginPoll(runtime.authBinding, id);
    await runtime.authStore.markLinked(runtime.authBinding, id, { scheme: "Bearer", value: `synthetic-credential-${id}` });
  };
  const call = (name, args) => deadline(client.callTool({ name, arguments: args }, undefined, { timeout: 8_000, maxTotalTimeout: 8_000 }),
    8_000, "INSTALLED_ELEVENLABS_TTS_CALLTOOL_TIMEOUT");
  let connected = false, schema = false, parameterCases = 0, modelBranches = 0, observedArtifacts = 0, pageReads = 0, pageIoDelta = -1;
  let unknownRecoveries = 0, replayPosts = -1, recoveryGetOnly = false, revokeDrain = "FAIL", eofDrain = "FAIL", authCleanup = "FAIL";
  let voiceProviderIdsExposed = 0, authStoreClosed = false;
  let step = "connect";
  try {
    await deadline(server.connect(serverTransport), 3_000, "INSTALLED_ELEVENLABS_TTS_SERVER_CONNECT_TIMEOUT");
    await deadline(client.connect(clientTransport), 3_000, "INSTALLED_ELEVENLABS_TTS_CLIENT_CONNECT_TIMEOUT"); connected = true;
    const listing = await deadline(client.listTools({}, { timeout: 4_000, maxTotalTimeout: 4_000 }), 4_000, "INSTALLED_ELEVENLABS_TTS_TOOLS_TIMEOUT");
    const surface = assertElevenLabsTtsToolSurface(listing.tools, true, modules); schema = surface.closed_schemas; parameterCases = surface.control_cases;
    const offCall = await call(TOOL_NAMES[0], {});
    if (offCall.isError || offCall.structuredContent?.backend_acceptance !== "UNPROVEN" || offCall.structuredContent?.runtime_usable !== false) {
      fail("INSTALLED_ELEVENLABS_TTS_SOURCE_CALLTOOL_INVALID");
    }

    const mainAttempt = attempt("main"); await linkAttempt(mainAttempt);
    let completedRecoveryId, completedArtifactUrl;
    const voiceResult = await call(TOOL_NAMES[1], { link_attempt_id: mainAttempt });
    if (voiceResult.isError) {
      const code = readError(voiceResult)?.error?.code;
      fail(`INSTALLED_ELEVENLABS_TTS_VOICE_LIST_ERROR_${safeToken(code)}`);
    }
    if (voiceResult.structuredContent?.voices?.length !== 1 ||
        voiceResult.structuredContent.voices[0]?.name !== "Synthetic installed voice") fail("INSTALLED_ELEVENLABS_TTS_VOICE_LIST_INVALID");
    if (JSON.stringify(voiceResult.structuredContent).includes("synthetic_private_elevenlabs_voice") || JSON.stringify(voiceResult.structuredContent).includes("https://")) {
      voiceProviderIdsExposed += 1; fail("INSTALLED_ELEVENLABS_TTS_PRIVATE_VOICE_DATA_EXPOSED");
    }
    const voiceRef = voiceResult.structuredContent.voices[0].voice_ref;
    const invalidNonV4 = await call(TOOL_NAMES[2], { ...ttsInput(mainAttempt, MODELS[1], voiceRef), stability: 0.55 });
    if (!invalidNonV4.isError || counts.generationPosts !== 0) fail("INSTALLED_ELEVENLABS_TTS_INVALID_INPUT_DISPATCHED");
    for (const [index, model] of MODELS.entries()) {
      step = `model-${index}`;
      const request = ttsInput(mainAttempt, model, voiceRef, `installed full TTS model ${model}`);
      const result = await call(TOOL_NAMES[2], request);
      if (result.isError) fail(`INSTALLED_ELEVENLABS_TTS_MODEL_ERROR_${index}_${safeToken(readError(result)?.error?.code)}`);
      if (result.structuredContent?.model_id !== model || result.structuredContent?.artifacts?.length !== 1 ||
          result.structuredContent?.status_semantics !== "LOCAL_OBSERVED_AVAILABILITY_ONLY" ||
          result.structuredContent?.backend_acceptance !== "UNPROVEN" || result.structuredContent?.provider_terminal_status !== "UNPROVEN") {
        fail(`INSTALLED_ELEVENLABS_TTS_MODEL_FLOW_INVALID_${index}`);
      }
      modelBranches += 1; observedArtifacts += result.structuredContent.artifacts.length;
      const wire = posts.at(-1);
      if (wire.prompt !== request.prompt || wire.settings.model_type !== model || wire.settings.voice_id !== "synthetic_private_elevenlabs_voice" ||
          (index < 2 && (wire.settings.stability !== 0.5 || wire.settings.similarity_boost !== 0.5))) fail("INSTALLED_ELEVENLABS_TTS_WIRE_PROJECTION_INVALID");
      if (JSON.stringify(result.structuredContent).includes("synthetic_private_elevenlabs_voice") || JSON.stringify(result.structuredContent).includes("synthetic-credential")) {
        voiceProviderIdsExposed += 1; fail("INSTALLED_ELEVENLABS_TTS_PRIVATE_DATA_EXPOSED");
      }
      if (index === 0) { completedRecoveryId = result.structuredContent.recovery_id; completedArtifactUrl = result.structuredContent.artifacts[0]?.url; }
    }

    step = "all-80-results";
    const multi = await call(TOOL_NAMES[2], ttsInput(mainAttempt, MODELS[3], voiceRef, "elevenlabs-80-output-fixture"));
    if (multi.isError || multi.structuredContent?.observed_artifact_count !== 80 || multi.structuredContent?.artifacts?.length !== 64 ||
        multi.structuredContent?.next_offset !== 64 || multi.structuredContent?.has_more !== true) fail("INSTALLED_ELEVENLABS_TTS_PAGE_ONE_INVALID");
    const beforePage = { posts: counts.generationPosts, history: counts.historyGets, results: counts.resultGets };
    const second = await call(TOOL_NAMES[5], { link_attempt_id: mainAttempt, recovery_id: multi.structuredContent.recovery_id, offset: 64 });
    pageIoDelta = (counts.generationPosts - beforePage.posts) + (counts.historyGets - beforePage.history) + (counts.resultGets - beforePage.results);
    if (second.isError || second.structuredContent?.artifacts?.length !== 16 || second.structuredContent?.has_more !== false ||
        second.structuredContent?.observed_artifact_count !== 80 || pageIoDelta !== 0) fail("INSTALLED_ELEVENLABS_TTS_PAGE_TWO_INVALID");
    const observedIds = [...multi.structuredContent.artifacts, ...second.structuredContent.artifacts].map((item) => item.message_object_id);
    if (new Set(observedIds).size !== 80) fail("INSTALLED_ELEVENLABS_TTS_OBJECTS_LOST_OR_DUPLICATED");
    observedArtifacts += observedIds.length; pageReads += 1;
    await rememberCompletedAndVerifyRevocation({ runtime, call, linkAttempt, attempt, recoveryId: completedRecoveryId,
      artifactUrl: completedArtifactUrl });

    step = "unknown-ack";
    const unknownAttempt = attempt("unknown"); await linkAttempt(unknownAttempt);
    const unknownVoice = await call(TOOL_NAMES[1], { link_attempt_id: unknownAttempt });
    const unknownRef = unknownVoice.structuredContent?.voices?.[0]?.voice_ref;
    const unknown = await call(TOOL_NAMES[2], ttsInput(unknownAttempt, MODELS[3], unknownRef, "elevenlabs-unknown-ack"));
    const unknownError = readError(unknown), recoveryId = unknownError?.error?.recovery_id;
    if (!unknown.isError || unknownError?.error?.code !== "OUTCOME_UNKNOWN" || !/^elevenlabs_tts_recovery_[0-9a-f-]{36}$/u.test(String(recoveryId))) {
      fail("INSTALLED_ELEVENLABS_TTS_UNKNOWN_OUTCOME_INVALID");
    }
    unknownRecoveries += 1;
    const recList = await call(TOOL_NAMES[4], { link_attempt_id: unknownAttempt });
    if (recList.isError || recList.structuredContent?.recoveries?.[0]?.recovery_id !== recoveryId) fail("INSTALLED_ELEVENLABS_TTS_RECOVERY_LIST_INVALID");
    const beforeRead = { posts: counts.generationPosts, history: counts.historyGets, results: counts.resultGets };
    now += 16 * 60_000;
    const replay = await call(TOOL_NAMES[2], ttsInput(unknownAttempt, MODELS[3], unknownRef, "elevenlabs-unknown-ack"));
    const reconciled = await call(TOOL_NAMES[3], { link_attempt_id: unknownAttempt, recovery_id: recoveryId });
    replayPosts = counts.generationPosts - beforeRead.posts;
    recoveryGetOnly = replay.isError && reconciled.isError === undefined && counts.historyGets === beforeRead.history + 1 &&
      counts.resultGets === beforeRead.results + 1 && counts.generationPosts === beforeRead.posts;
    if (!recoveryGetOnly || counts.chats !== 6) fail("INSTALLED_ELEVENLABS_TTS_RECOVERY_NOT_GET_ONLY");
    if (JSON.stringify(reconciled.structuredContent).includes("synthetic_private_elevenlabs_voice")) fail("INSTALLED_ELEVENLABS_TTS_PRIVATE_DATA_EXPOSED");
    observedArtifacts += reconciled.structuredContent.artifacts.length;

    step = "revoke-drain";
    revokeAttemptId = attempt("revoke"); await linkAttempt(revokeAttemptId);
    const revokeVoice = await call(TOOL_NAMES[1], { link_attempt_id: revokeAttemptId });
    const revokeRef = revokeVoice.structuredContent?.voices?.[0]?.voice_ref;
    const pending = call(TOOL_NAMES[2], ttsInput(revokeAttemptId, MODELS[0], revokeRef, "elevenlabs-revoke-drain"));
    await deadline(onRevokePost, 4_000, "INSTALLED_ELEVENLABS_TTS_REVOKE_POST_NOT_STARTED");
    const linkService = runtime.serverOptions.auth?.linkService; if (!linkService) fail("INSTALLED_ELEVENLABS_TTS_REVOKE_AUTH_MISSING");
    await deadline(linkService.revoke(runtime.authBinding, revokeAttemptId), 4_000, "INSTALLED_ELEVENLABS_TTS_REVOKE_DRAIN_TIMEOUT");
    await deadline(onRevokeAbort, 2_000, "INSTALLED_ELEVENLABS_TTS_REVOKE_SIGNAL_TIMEOUT");
    const pendingResult = await deadline(pending, 2_000, "INSTALLED_ELEVENLABS_TTS_REVOKE_CALL_TIMEOUT");
    if (!pendingResult.isError || statusAtAbort !== "LINKED" || (await runtime.authStore.getSnapshot(runtime.authBinding, revokeAttemptId)).status !== "REVOKED") {
      fail("INSTALLED_ELEVENLABS_TTS_REVOKE_DRAIN_INVALID");
    }
    revokeDrain = "PASS";

    step = "eof-drain";
    const lifecycle = runtime.ownerElevenLabsTtsLifecycle;
    if (!lifecycle?.close) fail("INSTALLED_ELEVENLABS_TTS_EOF_LIFECYCLE_MISSING");
    const events = [], input = new PassThrough();
    let signalClosed; const processClosed = new Promise((resolvePromise) => { signalClosed = resolvePromise; });
    const transport = { onclose: undefined, async close() { this.onclose?.(); signalClosed(); } };
    const close = modules.stdio.closeOwnerReadServicesOnTransportEof(transport, undefined, undefined, undefined, undefined,
      () => { events.push("auth_release"); runtime.authStore.close(); authStoreClosed = true; authCleanup = "PASS"; },
      input, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, true, undefined, undefined, undefined, undefined,
      { async close() { events.push("tts_lifecycle"); await lifecycle.close(); } });
    input.resume(); input.end(); await deadline(processClosed, 3_000, "INSTALLED_ELEVENLABS_TTS_EOF_PROCESS_TIMEOUT");
    await deadline(close(), 3_000, "INSTALLED_ELEVENLABS_TTS_EOF_DRAIN_TIMEOUT"); input.destroy();
    if (!sameArray(events, ["tts_lifecycle", "auth_release"])) fail("INSTALLED_ELEVENLABS_TTS_EOF_ORDER_INVALID");
    eofDrain = "PASS";

    if (counts.generationPosts !== 7 || modelBranches !== 4 || observedArtifacts !== 85 || counts.modelInfoGets !== 14 ||
        counts.balanceGets !== 14 || counts.subscriptionGets !== 14 || counts.billingCalls !== 0 || voiceProviderIdsExposed !== 0) {
      fail("INSTALLED_ELEVENLABS_TTS_MEASURED_COUNTS_MISMATCH");
    }
    return Object.freeze({ status: "INSTALLED_STOCK_SDK_ELEVENLABS_TTS_CALLTOOL_PASS", model_branches_checked: modelBranches,
      control_cases_checked: parameterCases, generation_posts: counts.generationPosts, result_messages: counts.resultGets,
      artifacts_seen: observedArtifacts, page_reads: pageReads, page_size: 64, page_observations: 80, page_io_delta: pageIoDelta,
      unknown_recoveries: unknownRecoveries, recovery_get_only: recoveryGetOnly, replay_posts: replayPosts,
      revoke_drain: revokeDrain, eof_drain: eofDrain, auth_cleanup: authCleanup, voice_provider_ids_exposed: voiceProviderIdsExposed,
      fresh_preflight_operations: 14, authenticated_network_calls: 0, billing_calls: counts.billingCalls });
  } catch (error) {
    if (error instanceof ElevenLabsTtsInstalledCheckError) throw error;
    fail(`INSTALLED_ELEVENLABS_TTS_CALLTOOL_${step.toUpperCase()}_FAILED`);
  } finally {
    const errors = [];
    for (const close of [() => client.close(), () => server.close(), () => runtime.ownerElevenLabsTtsLifecycle?.close(),
      ...(authStoreClosed ? [] : [() => runtime.authStore.close()])]) {
      try { await deadline(close(), 2_000, "INSTALLED_ELEVENLABS_TTS_CLEANUP_TIMEOUT"); } catch { errors.push("FAILED"); }
    }
    if (errors.length) fail("INSTALLED_ELEVENLABS_TTS_CLEANUP_FAILED");
  }
}

async function rememberCompletedAndVerifyRevocation({ runtime, call, linkAttempt, attempt: makeAttempt, recoveryId, artifactUrl }) {
  if (typeof recoveryId !== "string" || typeof artifactUrl !== "string") fail("INSTALLED_ELEVENLABS_TTS_COMPLETED_REVOKE_FIXTURE_INVALID");
  const linkService = runtime.serverOptions.auth?.linkService;
  // Revoke the owning attempt only after its completed result is cached. No replacement account or provider call is used.
  await linkService.revoke(runtime.authBinding, "link_elevenlabs_installed_main_012345678901");
  const replacement = makeAttempt("same-binding-new-link"); await linkAttempt(replacement);
  const page = await call(TOOL_NAMES[5], { link_attempt_id: replacement, recovery_id: recoveryId, offset: 0 });
  const reconcile = await call(TOOL_NAMES[3], { link_attempt_id: "link_elevenlabs_installed_main_012345678901", recovery_id: recoveryId });
  const text = JSON.stringify({ page: page.structuredContent, reconcile: readError(reconcile) });
  if (!page.isError || !reconcile.isError || text.includes(artifactUrl)) fail("INSTALLED_ELEVENLABS_TTS_REVOKED_CACHE_LEAK");
}

function ttsInput(link_attempt_id, model_id, voice_ref, prompt = "installed full-parameter TTS") {
  return { link_attempt_id, model_id, mode: "text_to_speech", prompt, voice_ref, stability: model_id === MODELS[0] || model_id === MODELS[1] ? 0.5 : 0.5,
    similarity_boost: model_id === MODELS[0] || model_id === MODELS[1] ? 0.5 : 0.75,
    ...(model_id === MODELS[2] || model_id === MODELS[3] ? { language_code: "auto" } : {}) };
}

function sourceProjectionForCheck(profile) {
  return { status: "CURRENT_STATIC_SOURCE_CONTRACT",
    source_binding: { build_id: profile.source_binding.build_id, form_module: profile.source_binding.form_module.name,
      form_bytes: profile.source_binding.form_module.bytes, form_sha256: profile.source_binding.form_module.sha256,
      public_catalog_version: profile.source_binding.public_catalog_version,
      settings_inventory_version: profile.source_binding.settings_inventory_version },
    models: profile.tts_model_ids.map((model_id) => ({ model_id, mode: "text_to_speech",
      max_prompt_length: profile.models[model_id].limits.max_prompt_length,
      language_code: model_id === "eleven_v4" || model_id === "eleven_v4_turbo" ? "auto_only" : "NOT_SUPPORTED",
      control_policy: model_id === "eleven_v4" || model_id === "eleven_v4_turbo" ? "V4_SOURCE_SLIDERS" : "FIXED_LOCAL_0_5_UNPROVEN_UI" })),
    controls: { stability_similarity: { min: profile.builder.stability.min, max: profile.builder.stability.max,
      step: profile.builder.stability.step, applies_to: "V4_MODELS_ONLY",
      non_v4_policy: "EXPLICIT_0_5_LOCAL_PREPARER_RULE_UNPROVEN_UI" },
      voice_reference: "EXPIRING_OWNER_BOUND_OPAQUE_REFERENCE", language_code: "auto_only_for_v4_models" },
    effective_defaults: "UNKNOWN", runtime_usable: false, backend_acceptance: "UNPROVEN" };
}
function assertClosedObject(schema, required, optional, code) {
  if (!isRecord(schema) || schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(schema.properties ?? {}).sort(), [...required, ...optional].sort()) ||
      !sameArray([...(schema.required ?? [])].sort(), [...required].sort())) fail(code);
}
function assertEveryObjectClosed(value, code) {
  if (Array.isArray(value)) { value.forEach((entry) => assertEveryObjectClosed(entry, code)); return; }
  if (!isRecord(value)) return;
  if (value.type === "object" && value.additionalProperties !== false) fail(code);
  for (const child of Object.values(value)) assertEveryObjectClosed(child, code);
}
function readError(result) {
  const text = Array.isArray(result?.content) ? result.content.find((entry) => entry?.type === "text")?.text : undefined;
  try { return JSON.parse(text ?? "{}"); } catch { return undefined; }
}
function safeToken(value) { return typeof value === "string" && /^[A-Z0-9_]{1,64}$/u.test(value) ? value : "UNKNOWN"; }
function sameKeys(value, expected) { return isRecord(value) && sameArray(Object.keys(value).sort(), [...expected].sort()); }
function sameArray(left, right) { return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => item === right[index]); }
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isWithin(parent, child) { const path = relative(parent, child); return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path)); }
function deadline(promise, milliseconds, code) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new ElevenLabsTtsInstalledCheckError(code)), milliseconds); })])
    .finally(() => clearTimeout(timer));
}
function fail(code) { throw new ElevenLabsTtsInstalledCheckError(code); }
