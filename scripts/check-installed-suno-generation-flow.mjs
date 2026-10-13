#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { isDeepStrictEqual } from "node:util";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class SunoGenerationInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "SunoGenerationInstalledCheckError"; this.code = code; }
}

const MODELS = Object.freeze(["V6", "V6_wild"]);
const TOOL_NAMES = Object.freeze([
  "syntx_get_suno_generate_parameters", "syntx_owner_generate_suno_audio", "syntx_owner_reconcile_suno_audio",
  "syntx_owner_list_suno_recoveries", "syntx_owner_get_suno_result_page"
]);
const SUNO_DIAGNOSTIC_GAP_CODES = Object.freeze([
  "HISTORY_UNVERIFIED", "HISTORY_INCOMPLETE", "HISTORY_EMPTY", "OWNER_ACK_MISSING", "OWNER_ACK_MISMATCH",
  "OWNER_ACK_AMBIGUOUS", "BOT_RESULT_NOT_OBSERVED", "AUDIO_OBJECT_IDS_INVALID", "AUDIO_MODEL_ECHO_MISMATCH",
  "ENVELOPE_SHAPE_INVALID", "OUTER_MESSAGE_ID_MISMATCH", "NOT_BOT_MESSAGE", "PROVIDER_CHAT_ID_MISMATCH",
  "UNRECOGNIZED_MESSAGE_FIELDS", "MESSAGE_OBJECT_ARRAY_INVALID", "MESSAGE_OBJECT_ARRAY_EMPTY", "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT",
  "UNRECOGNIZED_OBJECT_FIELDS", "OBJECT_ENTRY_INVALID", "OBJECT_ID_UNAVAILABLE", "OBJECT_ID_DUPLICATE", "OBJECT_ID_UNEXPECTED",
  "EXPECTED_OBJECT_ID_MISSING", "OBJECT_MESSAGE_ID_MISMATCH", "OBJECT_TYPE_UNSUPPORTED", "OBJECT_INCOMPLETE",
  "OBJECT_COMPLETION_UNKNOWN", "OBJECT_URL_MISSING", "OBJECT_URL_INVALID", "OBJECT_URL_UNSAFE", "MIME_TYPE_UNKNOWN",
  "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "AUDIO_RESULT_UNVERIFIED", "RESULT_GET_UNAVAILABLE", "RESULT_LIMIT_EXCEEDED"
]);
const CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const SETTINGS_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json";
const FORM_SHA256 = "sha256:3b4eb9ade783591aaf8087289e29f09c06ee8d54be827395e9d19613c62574b3";
const ATTEMPT_PREFIX = "link_suno_installed_checker_";
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const SOURCE_MODULES = Object.freeze([
  "application/owner-suno-generation-parameters", "application/owner-suno-generation-request-preparer",
  "application/owner-suno-generation-one-shot-policy", "application/owner-suno-generation-service",
  "application/account-status", "application/model-access", "adapter/syntx/owner-suno-audio-result",
  "adapter/syntx/chat-http-client", "mcp/owner-suno-generation-tools", "mcp/server",
  "runtime/observed-owner-runtime", "transports/stdio-owner", "catalog/public-catalog-history",
  "catalog/discovery-catalog", "auth/in-memory-auth-store", "auth/link-service"
]);
export const SUNO_GENERATION_REQUIRED_PACKAGE_PATHS = Object.freeze([
  "package.json", "dist/src/index.js", "dist/src/index.d.ts",
  ...SOURCE_MODULES.flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`]),
  `catalog/public/${CATALOG_VERSION}`, `catalog/settings/v2/${SETTINGS_VERSION}`
]);

export function assertSunoGenerationPackagePaths(paths) {
  if (!(paths instanceof Set)) fail("INSTALLED_SUNO_GENERATION_PACKAGE_PATHS_INVALID");
  if (SUNO_GENERATION_REQUIRED_PACKAGE_PATHS.some((path) => !paths.has(path))) fail("INSTALLED_SUNO_GENERATION_PACKAGE_CONTENT_MISSING");
  return true;
}

export function assertSunoGenerationFlagReader(stdio) {
  const reader = stdio?.readOwnerSunoGenerationFlag;
  if (typeof reader !== "function" || reader(undefined) !== false || reader("") !== false || reader("0") !== false || reader("1") !== true) {
    fail("INSTALLED_SUNO_GENERATION_FLAG_READER_INVALID");
  }
  for (const value of ["true", "yes", "01", " 1 ", "1 ", "2"]) {
    let rejected = false; try { reader(value); } catch { rejected = true; }
    if (!rejected) fail("INSTALLED_SUNO_GENERATION_FLAG_READER_INVALID");
  }
  return true;
}

export function assertSunoGenerationToolNames(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_SUNO_GENERATION_TOOL_LIST_INVALID");
  const selected = tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (selected.length !== 0) fail("INSTALLED_SUNO_GENERATION_DEFAULT_OFF_FAILED");
    return Object.freeze({ tool_count: 0 });
  }
  if (selected.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => selected.filter((entry) => entry === name).length !== 1)) {
    fail("INSTALLED_SUNO_GENERATION_TOOL_SET_MISMATCH");
  }
  return Object.freeze({ tool_count: TOOL_NAMES.length });
}

export function assertSunoGenerationToolSurface(tools, enabled, modules) {
  const names = assertSunoGenerationToolNames(tools, enabled);
  if (!enabled) return Object.freeze({ ...names, closed_schemas: true, model_branches: 0, mode_flag_cases: 0 });
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const inputKeys = [[], ["link_attempt_id", "model_id", "mode", "prompt", "is_custom_mode", "is_instrumental", "negative_tags", "styles", "title"],
    ["link_attempt_id", "recovery_id"], ["link_attempt_id"], ["link_attempt_id", "recovery_id"]];
  const optionalInputs = [[], [], [], ["limit"], ["offset"]];
  const outputKeys = [
    ["status", "source_pins", "model_ids", "models", "controls", "cost_projection", "effective_defaults", "runtime_usable", "dispatch_allowed", "backend_acceptance"],
    ["status", "status_semantics", "backend_acceptance", "provider_terminal_status", "model_id", "parameters", "source_binding", "cost_inputs", "cost_input_confidence", "recovery_id", "observed_artifact_count", "offset", "page_size", "artifacts", "has_more", "next_offset", "diagnostic"],
    ["status", "status_semantics", "backend_acceptance", "provider_terminal_status", "model_id", "parameters", "source_binding", "cost_inputs", "cost_input_confidence", "recovery_id", "observed_artifact_count", "offset", "page_size", "artifacts", "has_more", "next_offset", "diagnostic"],
    ["recoveries"],
    ["status", "status_semantics", "backend_acceptance", "provider_terminal_status", "model_id", "parameters", "source_binding", "cost_inputs", "cost_input_confidence", "recovery_id", "observed_artifact_count", "offset", "page_size", "artifacts", "has_more", "next_offset", "diagnostic"]
  ];
  for (let index = 0; index < TOOL_NAMES.length; index += 1) {
    const tool = byName.get(TOOL_NAMES[index]);
    assertClosedObject(tool?.inputSchema, inputKeys[index], optionalInputs[index], `INSTALLED_SUNO_GENERATION_INPUT_SCHEMA_${index}_INVALID`);
    assertClosedObject(tool?.outputSchema, outputKeys[index], [], `INSTALLED_SUNO_GENERATION_OUTPUT_SCHEMA_${index}_INVALID`);
    assertEveryObjectClosed(tool.inputSchema, `INSTALLED_SUNO_GENERATION_INPUT_SCHEMA_${index}_INVALID`);
    assertEveryObjectClosed(tool.outputSchema, `INSTALLED_SUNO_GENERATION_OUTPUT_SCHEMA_${index}_INVALID`);
  }
  const [parameters, generate, reconcile, list, page] = TOOL_NAMES.map((name) => byName.get(name));
  const branches = generate?.inputSchema?.oneOf;
  if (!Array.isArray(branches) || branches.length !== 2) fail("INSTALLED_SUNO_GENERATION_MODEL_BRANCHES_INVALID");
  const requiredBranchKeys = inputKeys[1];
  for (const branch of branches) {
    assertClosedObject(branch, requiredBranchKeys, [], "INSTALLED_SUNO_GENERATION_MODEL_BRANCH_INVALID");
    if (!sameArray(branch.properties?.model_id?.enum, MODELS) || branch.properties?.mode?.const !== "generate" ||
        typeof branch.properties?.is_custom_mode?.const !== "boolean" || branch.properties.prompt?.maxLength !== (branch.properties.is_custom_mode.const ? 5_000 : 500)) {
      fail("INSTALLED_SUNO_GENERATION_MODEL_BRANCH_INVALID");
    }
    if (branch.properties?.negative_tags?.maxLength !== 5_000 || branch.properties?.styles?.maxLength !== 1_000 ||
        branch.properties?.title?.maxLength !== 80) fail("INSTALLED_SUNO_GENERATION_TEXT_BOUND_SCHEMA_INVALID");
  }
  if (generate.annotations?.destructiveHint !== true || reconcile.annotations?.readOnlyHint !== true ||
      list.annotations?.readOnlyHint !== true || page.annotations?.readOnlyHint !== true ||
      reconcile.annotations?.idempotentHint !== true || page.annotations?.idempotentHint !== true) {
    fail("INSTALLED_SUNO_GENERATION_TOOL_ANNOTATIONS_INVALID");
  }
  const schema = modules?.tools?.OWNER_SUNO_GENERATION_TOOL_INPUT_SCHEMAS?.generate;
  const outputSchema = modules?.tools?.OWNER_SUNO_GENERATION_TOOL_OUTPUT_SCHEMAS?.parameters;
  if (typeof schema?.safeParse !== "function" || typeof outputSchema?.safeParse !== "function") fail("INSTALLED_SUNO_GENERATION_VALIDATOR_MISSING");
  const modeFlagCases = assertSunoGenerationParameterMatrix(schema);
  assertSunoGenerationDiagnosticGapCoverage(modules.tools.OWNER_SUNO_GENERATION_TOOL_OUTPUT_SCHEMAS.generate);
  const source = modules.parameters.getOwnerSunoGenerationParameterSource();
  assertSunoGenerationSourceContract(source, outputSchema);
  return Object.freeze({ ...names, closed_schemas: true, model_branches: 2, mode_flag_cases: modeFlagCases });
}

export function assertSunoGenerationDiagnosticGapCoverage(schema) {
  if (typeof schema?.safeParse !== "function") fail("INSTALLED_SUNO_GENERATION_OUTPUT_SCHEMA_MISSING");
  for (const gap of SUNO_DIAGNOSTIC_GAP_CODES) {
    const output = {
      status: "partial_results", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
      provider_terminal_status: "UNPROVEN", model_id: "V6", parameters: { mode: "generate", is_custom_mode: false, is_instrumental: false },
      source_binding: { public_catalog_version: CATALOG_VERSION, settings_inventory_version: SETTINGS_VERSION, form_sha256: FORM_SHA256 },
      cost_inputs: { version: "V6" }, cost_input_confidence: "PUBLIC_VERSION_KEY_LOCAL_PROJECTION_NOT_UI_QUOTE_OR_CAP",
      recovery_id: "suno_generation_recovery_00000000-0000-4000-8000-000000000001", observed_artifact_count: 0,
      offset: 0, page_size: 64, artifacts: [], has_more: false, next_offset: null,
      diagnostic: { phase: "RESULT_BINDING", post_started: true, ack_known: true, history_status: "COMPLETE", owner_ack_status: "MATCHED",
        history_get_calls: 1, result_get_calls: 1, result_status: "PARTIAL", gaps: [gap], counters_saturated: false }
    };
    if (!schema.safeParse(output).success) fail("INSTALLED_SUNO_GENERATION_OUTPUT_GAP_DTO_SCHEMA_INVALID");
  }
  return SUNO_DIAGNOSTIC_GAP_CODES.length;
}

export function assertSunoGenerationParameterMatrix(schema) {
  if (typeof schema?.safeParse !== "function") fail("INSTALLED_SUNO_GENERATION_VALIDATOR_MISSING");
  let cases = 0;
  for (const model_id of MODELS) for (const is_custom_mode of [false, true]) for (const is_instrumental of [false, true]) {
    const prompt = is_custom_mode ? "Explicit installed Suno custom-mode prompt 🎵" : "Explicit installed Suno simple prompt 🎵";
    const value = { link_attempt_id: `${ATTEMPT_PREFIX}matrix_012345678901`, model_id, mode: "generate", prompt,
      is_custom_mode, is_instrumental, negative_tags: "", styles: "", title: "Installed schema matrix" };
    if (!schema.safeParse(value).success) fail("INSTALLED_SUNO_GENERATION_MODE_FLAG_MATRIX_INVALID");
    cases += 1;
  }
  const base = { link_attempt_id: `${ATTEMPT_PREFIX}boundary_012345678901`, model_id: MODELS[0], mode: "generate",
    prompt: "x", is_custom_mode: false, is_instrumental: false, negative_tags: "", styles: "", title: "x" };
  if (!schema.safeParse({ ...base, prompt: "😀".repeat(250), title: "t".repeat(80), styles: "s".repeat(1_000), negative_tags: "n".repeat(5_000) }).success ||
      !schema.safeParse({ ...base, is_custom_mode: true, prompt: "😀".repeat(2_500) }).success ||
      schema.safeParse({ ...base, prompt: "😀".repeat(251) }).success ||
      schema.safeParse({ ...base, is_custom_mode: true, prompt: "😀".repeat(2_501) }).success ||
      schema.safeParse({ ...base, title: "t".repeat(81) }).success || schema.safeParse({ ...base, styles: "s".repeat(1_001) }).success ||
      schema.safeParse({ ...base, negative_tags: "n".repeat(5_001) }).success || schema.safeParse({ ...base, prompt: "\uD800" }).success ||
      schema.safeParse({ ...base, mode: "cover" }).success || schema.safeParse({ ...base, ai_name: "suno" }).success ||
      schema.safeParse({ ...base, file_urls: [] }).success || schema.safeParse({ ...base, source_clip_id: "foreign" }).success ||
      schema.safeParse({ ...base, version: 2 }).success) fail("INSTALLED_SUNO_GENERATION_BOUNDARY_MATRIX_INVALID");
  for (const key of ["mode", "prompt", "is_custom_mode", "is_instrumental", "negative_tags", "styles", "title"]) {
    const missing = { ...base }; delete missing[key]; if (schema.safeParse(missing).success) fail("INSTALLED_SUNO_GENERATION_REQUIRED_FIELD_MATRIX_INVALID");
  }
  if (cases !== 8) fail("INSTALLED_SUNO_GENERATION_MODE_FLAG_MATRIX_INVALID");
  return cases;
}

export function assertSunoGenerationSourceContract(source, outputSchema) {
  const modelKeys = ["is_custom_mode", "is_instrumental", "model_type", "negative_tags", "styles", "title"];
  const modelEntries = isRecord(source?.models) ? MODELS.map((modelId) => source.models[modelId]) : [];
  if (!isRecord(source) || source.status !== "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT" || !sameArray(source.model_ids, MODELS) ||
      source.source_pins?.public_catalog_version !== CATALOG_VERSION || source.source_pins?.settings_inventory_version !== SETTINGS_VERSION ||
      source.source_pins?.form_sha256 !== FORM_SHA256 || source.source_pins?.form_module !== "suno.js" || source.source_pins?.form_bytes !== 44_975 ||
      source.runtime_usable !== false || source.dispatch_allowed !== false || source.backend_acceptance !== "UNPROVEN" ||
      source.effective_defaults !== "UNKNOWN" || !sameArray(source.cost_projection?.declared_cost_query_keys, ["version"]) ||
      source.cost_projection?.generation_value_mapping !== "UNPROVEN_NOT_INCLUDED_IN_GENERATE_SETTINGS" ||
      source.controls?.prompt?.measure !== "UTF16_CODE_UNITS" || source.controls?.prompt?.simple_max !== 500 ||
      source.controls?.prompt?.custom_max !== 5_000 || source.controls?.prompt?.effective_default !== "UNKNOWN" ||
      source.controls?.prompt?.nonblank_policy !== "LOCAL_VALIDATION_POLICY_NOT_UI_VALIDATOR" ||
      source.controls?.negative_tags?.local_max !== 5_000 || source.controls?.negative_tags?.measure !== "UTF16_CODE_UNITS" ||
      source.controls?.negative_tags?.bound_label !== "LOCAL_RESOURCE_BOUND_NOT_UI_LIMIT" ||
      source.controls?.negative_tags?.source_ui_limit !== "UNKNOWN" || source.controls?.styles?.max !== 1_000 || source.controls?.title?.max !== 80 ||
      modelEntries.length !== 2 || modelEntries.some((model, index) => model?.model_id !== MODELS[index] || model.ai_name !== "suno" ||
        model.active !== true || model.defaults_status !== "UNKNOWN" || !sameArray(model.model_value_settings_keys, modelKeys) ||
        !sameArray(model.payload_field_keys, ["model_type"]))) fail("INSTALLED_SUNO_GENERATION_SOURCE_CONTRACT_INVALID");
  const projection = { status: source.status, source_pins: source.source_pins, model_ids: source.model_ids,
    models: modelEntries, controls: source.controls, cost_projection: source.cost_projection,
    effective_defaults: source.effective_defaults, runtime_usable: source.runtime_usable,
    dispatch_allowed: source.dispatch_allowed, backend_acceptance: source.backend_acceptance };
  const parsed = outputSchema?.safeParse(projection);
  if (!parsed?.success) fail("INSTALLED_SUNO_GENERATION_SOURCE_SCHEMA_INVALID");
  return Object.freeze({ models: modelEntries.length, source_flags_false: true, public_catalog_version: CATALOG_VERSION,
    settings_inventory_version: SETTINGS_VERSION, cost_projection: "MODEL_ID_LOCAL_NOT_UI_QUOTE" });
}

export function assertSunoGenerationPublicExports(api, modules) {
  const pairs = [
    ["OWNER_SUNO_GENERATION_MODEL_IDS", "parameters"], ["OWNER_SUNO_GENERATION_PUBLIC_VERSION", "parameters"],
    ["OWNER_SUNO_GENERATION_SETTINGS_VERSION", "parameters"], ["getOwnerSunoGenerationParameterSource", "parameters"],
    ["normalizeOwnerSunoGenerationParameters", "parameters"], ["OwnerSunoGenerationParametersError", "parameters"],
    ["OWNER_SUNO_GENERATION_TOOL_NAMES", "tools"], ["OWNER_SUNO_GENERATION_TOOL_INPUT_SCHEMAS", "tools"],
    ["OWNER_SUNO_GENERATION_TOOL_OUTPUT_SCHEMAS", "tools"], ["registerSyntxOwnerSunoGenerationTools", "tools"],
    ["SYNTX_GET_SUNO_GENERATE_PARAMETERS_TOOL_NAME", "tools"], ["SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_RECONCILE_SUNO_AUDIO_TOOL_NAME", "tools"], ["SYNTX_OWNER_LIST_SUNO_RECOVERIES_TOOL_NAME", "tools"],
    ["SYNTX_OWNER_GET_SUNO_RESULT_PAGE_TOOL_NAME", "tools"], ["OwnerSunoGenerationServiceError", "service"],
    ["createMcpServer", "server"], ["createObservedOwnerRuntime", "runtime"]
  ];
  if (!isRecord(api) || pairs.some(([name, group]) => !isRecord(modules[group]) || api[name] === undefined || api[name] !== modules[group][name])) {
    fail("INSTALLED_SUNO_GENERATION_PUBLIC_EXPORT_MISMATCH");
  }
  for (const name of ["OwnerSunoGenerationService", "OwnerSunoGenerationRequestPreparer", "OwnerSunoGenerationOneShotPolicy",
    "OwnerSunoGenerationPreparedCandidate", "OwnerSunoGenerationOneShotPermit", "OwnerSunoGenerationChatContext",
    "OwnerSunoGenerationResultMessageContext"]) {
    if (Object.hasOwn(api, name)) fail("INSTALLED_SUNO_GENERATION_PRIVATE_EXPORT_LEAK");
  }
  return true;
}

export function assertSunoGenerationDeclarations(text) {
  if (typeof text !== "string") fail("INSTALLED_SUNO_GENERATION_DECLARATIONS_INVALID");
  const required = ["OwnerSunoGenerationModel", "OwnerSunoGenerationRequest", "OwnerSunoGenerationParameterSource",
    "OwnerSunoNormalizedGenerationParameters", "OwnerSunoGenerationResult", "OwnerSunoGenerationRecoveryListItem",
    "OwnerSunoGenerationServiceComposition", "RegisterSyntxOwnerSunoGenerationToolsOptions"];
  if (required.some((name) => !text.includes(name))) fail("INSTALLED_SUNO_GENERATION_DECLARATIONS_INVALID");
  for (const name of ["OwnerSunoGenerationService", "OwnerSunoGenerationRequestPreparer", "OwnerSunoGenerationOneShotPolicy",
    "OwnerSunoGenerationPreparedCandidate", "OwnerSunoGenerationOneShotPermit"]) {
    if (new RegExp(`export\\s+(?:declare\\s+)?(?:type\\s+)?(?:class|interface|type|const|function)\\s+${name}\\b`, "u").test(text)) {
      fail("INSTALLED_SUNO_GENERATION_PRIVATE_DECLARATION_LEAK");
    }
  }
  return true;
}

export function formatSunoGenerationInstalledSummary(proof) {
  const counters = ["default_tools", "opt_in_tools", "model_branches_checked", "mode_flag_cases", "parameter_schema_cases", "generation_posts",
    "result_messages", "artifacts_seen", "page_reads", "page_size", "page_observations", "page_io_delta", "unknown_recoveries",
    "saturated_history_get_calls", "replay_posts", "default_stderr_bytes", "opt_in_stderr_bytes", "default_network_calls",
    "opt_in_network_calls", "authenticated_network_calls", "billing_calls"];
  if (!isRecord(proof) || proof.status !== "INSTALLED_STOCK_SDK_SUNO_GENERATION_CALLTOOL_PASS" || proof.node_version !== "24.21.0" ||
      proof.sdk_version !== "1.32.1" || proof.clean_installed_package !== true || proof.default_tools !== 0 || proof.opt_in_tools !== 5 ||
      proof.model_branches_checked !== 2 || proof.mode_flag_cases !== 8 || proof.parameter_schema_cases !== 8 || proof.generation_posts !== 13 ||
      proof.result_messages !== 14 || proof.artifacts_seen !== 89 || proof.pending_zero_ready_recoveries !== 1 ||
      proof.object_incomplete_gap_preserved !== true || proof.page_reads !== 1 || proof.page_size !== 64 ||
      proof.page_observations !== 80 || proof.page_io_delta !== 0 || proof.unknown_recoveries !== 1 ||
      proof.recovery_get_only_after_16m !== true || proof.saturated_history_get_calls !== 255 || proof.diagnostic_counters_saturated !== true ||
      proof.replay_posts !== 0 || proof.foreign_attempt_denied !== true || proof.same_binding_new_link_denied !== true ||
      proof.cached_url_denied_after_revoke !== true || proof.revoke_drain !== "PASS" || proof.eof_drain !== "PASS" ||
      proof.auth_cleanup !== "PASS" || proof.default_child_close !== "CLOSED" || proof.opt_in_child_close !== "CLOSED" ||
      proof.default_child_pid_null !== true || proof.opt_in_child_pid_null !== true || proof.default_stderr_bytes !== 0 || proof.opt_in_stderr_bytes !== 0 ||
      proof.default_network_calls !== 0 || proof.opt_in_network_calls !== 0 || proof.authenticated_network_calls !== 0 || proof.billing_calls !== 0 ||
      proof.runtime_usable !== false || proof.dispatch_allowed !== false || proof.backend_acceptance !== "UNPROVEN" ||
      proof.provider_terminal_status !== "UNPROVEN" || proof.source_public_version !== CATALOG_VERSION ||
      proof.source_settings_version !== SETTINGS_VERSION || proof.cost_projection !== "MODEL_ID_LOCAL_NOT_UI_QUOTE" ||
      proof.private_request_text_exposed !== false || proof.private_classes_exported !== false || counters.some((key) => !Number.isSafeInteger(proof[key]) || proof[key] < 0)) {
    fail("INSTALLED_SUNO_GENERATION_SUMMARY_INVALID");
  }
  return `suno_generation_installed=${proof.status} node=${proof.node_version} sdk=${proof.sdk_version} clean_package=true ` +
    `default_tools=${proof.default_tools} opt_in_tools=${proof.opt_in_tools} models=${proof.model_branches_checked} mode_flag_cases=${proof.mode_flag_cases} ` +
    `parameter_schema_cases=${proof.parameter_schema_cases} generation_posts=${proof.generation_posts} result_messages=${proof.result_messages} ` +
    `pending_zero_ready_recoveries=${proof.pending_zero_ready_recoveries} object_incomplete_gap_preserved=${proof.object_incomplete_gap_preserved} ` +
    `artifacts=${proof.artifacts_seen} page_reads=${proof.page_reads} page_size=${proof.page_size} page_observations=${proof.page_observations} ` +
    `page_io_delta=${proof.page_io_delta} unknown_recoveries=${proof.unknown_recoveries} recovery_get_only_after_16m=${proof.recovery_get_only_after_16m} ` +
    `saturated_history_get_calls=${proof.saturated_history_get_calls} counters_saturated=${proof.diagnostic_counters_saturated} replay_posts=${proof.replay_posts} ` +
    `foreign_attempt_denied=${proof.foreign_attempt_denied} same_binding_new_link_denied=${proof.same_binding_new_link_denied} ` +
    `cached_url_denied_after_revoke=${proof.cached_url_denied_after_revoke} revoke_drain=${proof.revoke_drain} eof_drain=${proof.eof_drain} ` +
    `auth_cleanup=${proof.auth_cleanup} default_close=${proof.default_child_close} opt_in_close=${proof.opt_in_child_close} ` +
    `default_pid_null=${proof.default_child_pid_null} opt_in_pid_null=${proof.opt_in_child_pid_null} ` +
    `stderr=${proof.default_stderr_bytes + proof.opt_in_stderr_bytes} stdio_network=${proof.default_network_calls + proof.opt_in_network_calls} ` +
    `authenticated_network=${proof.authenticated_network_calls} billing=${proof.billing_calls} cost_projection=${proof.cost_projection} ` +
    `private_request_text_exposed=${proof.private_request_text_exposed} private_classes_exported=${proof.private_classes_exported} ` +
    `source_public=${proof.source_public_version} source_settings=${proof.source_settings_version} runtime_usable=${proof.runtime_usable} ` +
    `dispatch_allowed=${proof.dispatch_allowed} backend_acceptance=${proof.backend_acceptance} provider_terminal_status=${proof.provider_terminal_status}`;
}
export async function assertInstalledSunoGenerationFlow(installedPackagePath, consumerPath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertSunoGenerationPackagePaths(packagedPaths);
    if (process.versions.node !== "24.21.0") fail("INSTALLED_SUNO_GENERATION_NODE24_21_REQUIRED");
    if (!isAbsolute(installedPackagePath) || !isAbsolute(consumerPath)) fail("INSTALLED_SUNO_GENERATION_INSTALLED_ROOT_INVALID");
    const installedRoot = await realpath(installedPackagePath);
    if (isWithin(PROJECT_ROOT, installedRoot)) fail("INSTALLED_SUNO_GENERATION_NOT_CLEAN_PACKAGE");
    const manifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
    if (manifest.name !== "syntx-mcp") fail("INSTALLED_SUNO_GENERATION_NOT_CLEAN_PACKAGE");
    phase = "packed-modules";
    const importPacked = (name) => import(pathToFileURL(join(installedRoot, `dist/src/${name}.js`)).href);
    const [api, parameters, tools, service, audioResult, chatClient, server, runtime, stdio] = await Promise.all([
      importPacked("index"), importPacked("application/owner-suno-generation-parameters"), importPacked("mcp/owner-suno-generation-tools"),
      importPacked("application/owner-suno-generation-service"), importPacked("adapter/syntx/owner-suno-audio-result"),
      importPacked("adapter/syntx/chat-http-client"), importPacked("mcp/server"), importPacked("runtime/observed-owner-runtime"),
      importPacked("transports/stdio-owner")
    ]);
    const modules = { parameters, tools, service, audioResult, chatClient, server, runtime, stdio };
    phase = "public-surface";
    assertSunoGenerationPublicExports(api, modules);
    assertSunoGenerationDeclarations(await readFile(join(installedRoot, "dist/src/index.d.ts"), "utf8"));
    assertSunoGenerationFlagReader(stdio);
    const source = assertSunoGenerationSourceContract(parameters.getOwnerSunoGenerationParameterSource(),
      tools.OWNER_SUNO_GENERATION_TOOL_OUTPUT_SCHEMAS.parameters);
    phase = "consumer-sdk";
    const sdk = await loadSunoGenerationConsumerSdk(consumerPath);
    phase = "stdio-surface";
    const off = await listInstalledSunoTools(installedRoot, consumerPath, sdk, false, modules);
    const on = await listInstalledSunoTools(installedRoot, consumerPath, sdk, true, modules);
    phase = "stock-calltool";
    const flow = await runSunoGenerationCallToolFlow(modules, sdk, installedRoot);
    const proof = Object.freeze({ ...flow, default_tools: off.tool_count, opt_in_tools: on.tool_count,
      default_child_close: off.child_close, opt_in_child_close: on.child_close,
      default_child_pid_null: off.child_pid_null, opt_in_child_pid_null: on.child_pid_null,
      default_stderr_bytes: off.stderr_bytes, opt_in_stderr_bytes: on.stderr_bytes,
      default_network_calls: off.network_calls, opt_in_network_calls: on.network_calls,
      node_version: process.versions.node, sdk_version: sdk.version, clean_installed_package: true,
      source_public_version: source.public_catalog_version, source_settings_version: source.settings_inventory_version,
      cost_projection: source.cost_projection, runtime_usable: false, dispatch_allowed: false,
      backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN" });
    formatSunoGenerationInstalledSummary(proof);
    return proof;
  } catch (error) {
    if (error instanceof SunoGenerationInstalledCheckError) throw error;
    fail(`INSTALLED_SUNO_GENERATION_${phase.replace(/[^a-z0-9]+/giu, "_").toUpperCase()}_FAILED`);
  }
}

export async function loadSunoGenerationConsumerSdk(consumerPath) {
  if (typeof consumerPath !== "string" || !isAbsolute(consumerPath)) fail("INSTALLED_SUNO_GENERATION_CONSUMER_PATH_INVALID");
  const require = createRequire(join(consumerPath, "package.json"));
  let resolvedFiles;
  try {
    resolvedFiles = ["@modelcontextprotocol/sdk/client/index.js", "@modelcontextprotocol/sdk/client/stdio.js",
      "@modelcontextprotocol/sdk/inMemory.js"].map((specifier) => require.resolve(specifier));
  } catch { fail("INSTALLED_SUNO_GENERATION_SDK_RESOLUTION_FAILED"); }
  const sdkRoot = await realpath(join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk"));
  const canonicalFiles = await Promise.all(resolvedFiles.map((path) => realpath(path)));
  if (isWithin(PROJECT_ROOT, sdkRoot) || canonicalFiles.some((path) => !isWithin(sdkRoot, path))) {
    fail("INSTALLED_SUNO_GENERATION_SDK_NOT_FROM_CONSUMER");
  }
  const packageInfo = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8"));
  if (packageInfo.name !== "@modelcontextprotocol/sdk" || packageInfo.version !== "1.32.1") {
    fail("INSTALLED_SUNO_GENERATION_SDK_VERSION_MISMATCH");
  }
  const [{ Client }, { StdioClientTransport }, { InMemoryTransport }] = await Promise.all(
    canonicalFiles.map((path) => import(pathToFileURL(path).href)));
  return Object.freeze({ Client, StdioClientTransport, InMemoryTransport, version: packageInfo.version });
}

async function listInstalledSunoTools(packageRoot, consumerPath, sdk, enabled, modules) {
  const directory = await mkdtemp(join(tmpdir(), "suno-generation-installed-stdio-"));
  const auditFile = join(directory, "fetch-count"), preload = join(directory, "network-guard.mjs");
  await writeFile(preload,
    "import { writeFileSync } from 'node:fs'; let count=0; globalThis.fetch=(...args)=>{count++;return Promise.reject(new Error('NETWORK_DISABLED'));}; process.on('exit',()=>{try{writeFileSync(process.env.SYNTX_SUNO_FETCH_AUDIT,String(count))}catch{}});\n",
    { mode: 0o600 });
  const client = new sdk.Client({ name: enabled ? "suno-generation-opt-in" : "suno-generation-default", version: "1.0.0" }, { capabilities: {} });
  const transport = new sdk.StdioClientTransport({ command: process.execPath,
    args: [join(packageRoot, "dist/src/transports/stdio-owner.js")], cwd: consumerPath,
    env: { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: directory, XDG_DATA_HOME: directory,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, SYNTX_SUNO_FETCH_AUDIT: auditFile,
      ...(enabled ? { SYNTX_OWNER_SUNO_GENERATION: "1" } : {}) }, stderr: "pipe" });
  let didClose = false, stderrBytes = 0, connected = false, failure, surface;
  let notifyClosed; const closePromise = new Promise((resolvePromise) => { notifyClosed = resolvePromise; });
  transport.onclose = () => { didClose = true; notifyClosed(); };
  transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  try {
    await withDeadline(client.connect(transport), 7_000, "INSTALLED_SUNO_GENERATION_STDIO_INIT_TIMEOUT"); connected = true;
    const listed = await withDeadline(client.listTools({}, { timeout: 7_000, maxTotalTimeout: 7_000 }),
      7_000, "INSTALLED_SUNO_GENERATION_STDIO_TOOLS_LIST_TIMEOUT");
    surface = assertSunoGenerationToolSurface(listed.tools, enabled, modules);
  } catch (error) { failure = error; }
  finally {
    try { await withDeadline(connected ? client.close() : transport.close(), 3_000, "INSTALLED_SUNO_GENERATION_STDIO_CLOSE_TIMEOUT"); }
    catch (error) { failure ??= error; }
    try { await withDeadline(closePromise, 3_000, "INSTALLED_SUNO_GENERATION_STDIO_PROCESS_CLOSE_TIMEOUT"); }
    catch (error) { failure ??= error; }
  }
  try {
    if (failure) throw failure;
    if (!didClose || transport.pid !== null || stderrBytes !== 0) fail("INSTALLED_SUNO_GENERATION_STDIO_CLEANUP_FAILED");
    const networkCalls = Number(await readFile(auditFile, "utf8"));
    if (networkCalls !== 0) fail("INSTALLED_SUNO_GENERATION_STDIO_NETWORK_CALLS");
    return Object.freeze({ ...surface, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes, network_calls: networkCalls });
  } catch (error) {
    if (error instanceof SunoGenerationInstalledCheckError) throw error;
    fail("INSTALLED_SUNO_GENERATION_STDIO_SURFACE_INVALID");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function runSunoGenerationCallToolFlow(modules, sdk, installedRoot) {
  if (!modules.runtime?.createObservedOwnerRuntime || !modules.server?.createMcpServer || !sdk?.Client || !sdk?.InMemoryTransport) {
    fail("INSTALLED_SUNO_GENERATION_RUNTIME_ABI_MISSING");
  }
  const fixedNow = Date.parse("2026-10-13T02:00:00.000Z");
  let now = fixedNow;
  const counts = { chats: 0, generationPosts: 0, historyGets: 0, resultGets: 0, accountReads: 0, modelAccessReads: 0 };
  const transactions = new Map(); const posts = [];
  const resultReadsByChat = new Map();
  let revokeAttemptId, revokeStarted, revokeSignalSeen, revokeStatusAtAbort;
  let eofAttemptId, eofStarted, eofSignalSeen, eofStatusAtAbort;
  const revokePostPromise = new Promise((resolvePromise) => { revokeStarted = resolvePromise; });
  const revokeAbortPromise = new Promise((resolvePromise) => { revokeSignalSeen = resolvePromise; });
  const eofPostPromise = new Promise((resolvePromise) => { eofStarted = resolvePromise; });
  const eofAbortPromise = new Promise((resolvePromise) => { eofSignalSeen = resolvePromise; });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    if (url.origin !== "https://api.syntx.ai") fail("INSTALLED_SUNO_GENERATION_UPSTREAM_ORIGIN_INVALID");
    if (url.pathname === "/api/v1/user/balance" && method === "GET") {
      counts.accountReads += 1; return Response.json({ balance: "1000" });
    }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      counts.accountReads += 1; return Response.json({ active: true, type: "PRO", end_date: "2026-10-15T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      counts.modelAccessReads += 1;
      const model = url.searchParams.get("model_type");
      if (url.searchParams.get("ai_name") !== "suno" || !MODELS.includes(model) || url.searchParams.get("version") !== model) {
        fail("INSTALLED_SUNO_GENERATION_MODEL_ACCESS_QUERY_INVALID");
      }
      return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1; return Response.json({ uuid: `suno-installed-chat-${counts.chats}` });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      counts.generationPosts += 1;
      if (url.search !== "?ai_name=suno") fail("INSTALLED_SUNO_GENERATION_QUERY_INVALID");
      const body = JSON.parse(String(init.body));
      if (!sameKeys(body, ["chat_uuid", "prompt", "settings"]) || typeof body.prompt !== "string" ||
          !isRecord(body.settings) || !MODELS.includes(body.settings.model_type) || body.settings.mode !== "generate" ||
          !sameKeys(body.settings, ["model_type", "mode", "is_custom_mode", "is_instrumental", "negative_tags", "styles", "title", "file_urls"]) ||
          !Array.isArray(body.settings.file_urls) || body.settings.file_urls.length !== 0) fail("INSTALLED_SUNO_GENERATION_WIRE_SETTINGS_INVALID");
      posts.push(body);
      if (body.prompt === "Suno installed unknown acknowledgement fixture") {
        const tx = createAudioTransaction(body, counts.generationPosts, 0, true);
        transactions.set(body.chat_uuid, tx);
        return Promise.reject(new Error("Synthetic network failure after the single Suno generation POST."));
      }
      if (body.prompt === "Suno installed revoke drain fixture") {
        revokeStarted();
        return waitForAbort(init.signal, async () => { revokeStatusAtAbort = (await runtime.authStore.getSnapshot(runtime.authBinding, revokeAttemptId)).status; revokeSignalSeen(); });
      }
      if (body.prompt === "Suno installed EOF drain fixture") {
        eofStarted();
        return waitForAbort(init.signal, async () => { eofStatusAtAbort = (await runtime.authStore.getSnapshot(runtime.authBinding, eofAttemptId)).status; eofSignalSeen(); });
      }
      const outputCount = body.prompt === "Suno installed 80-object fixture" ? 80 : 1;
      const tx = createAudioTransaction(body, counts.generationPosts, outputCount, false,
        body.prompt === "Suno installed incomplete-object fixture");
      transactions.set(body.chat_uuid, tx);
      return Response.json({ id: tx.ackId });
    }
    const history = /^\/api\/v1\/chats\/(suno-installed-chat-\d+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      counts.historyGets += 1;
      const tx = transactions.get(history[1]);
      const page = Number(url.searchParams.get("page")), pageSize = 10;
      if (!tx || tx.unknown) return Response.json({ messages: [], pagination: { page, page_size: pageSize,
        total_count: 0, total_pages: 0, has_next: false, has_previous: false } });
      const rows = [{ id: tx.ackId, chat_id: 9321, author_id: 4242,
        message_object: [{ id: tx.ackObjectId, message_id: tx.ackId, object_type: "text", object_text: tx.prompt, model_type: tx.model }] },
      ...tx.messages.map((item) => ({ id: item.messageId, chat_id: 9321, author_id: -1,
        message_object: item.objects.map((object) => ({ id: object.id, message_id: item.messageId, object_type: "audio", model_type: tx.model })) }))];
      const pages = Math.ceil(rows.length / pageSize);
      return Response.json({ messages: rows.slice((page - 1) * pageSize, page * pageSize), pagination: {
        page, page_size: pageSize, total_count: rows.length, total_pages: pages, has_next: page < pages, has_previous: page > 1
      } });
    }
    const result = /^\/api\/v1\/chats\/(suno-installed-chat-\d+)\/(suno-installed-bot-\d+-\d+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      counts.resultGets += 1;
      const tx = transactions.get(result[1]);
      const message = tx?.messages.find((item) => item.messageId === result[2]);
      if (!tx || !message) fail("INSTALLED_SUNO_GENERATION_RESULT_CONTEXT_INVALID");
      const messageReadCount = (resultReadsByChat.get(result[1]) ?? 0) + 1;
      resultReadsByChat.set(result[1], messageReadCount);
      return Response.json({ id: message.messageId, chat_id: 9321, author_id: -1,
        message_object: message.objects.map((object) => ({ id: object.id, message_id: message.messageId, object_type: "audio",
          object_url: object.url, completed: !(tx.incompleteFirst && messageReadCount <= 3), model_type: tx.model })) });
    }
    fail("INSTALLED_SUNO_GENERATION_SYNTHETIC_ROUTE_UNEXPECTED");
  };

  const runtime = modules.runtime.createObservedOwnerRuntime({ ownerSunoGenerationEnabled: true,
    publicCatalogVersion: CATALOG_VERSION, catalogDirectory: join(installedRoot, "catalog"), fetchImpl, now: () => now, requestTimeoutMs: 3_000 });
  const server = modules.server.createMcpServer(runtime.application, runtime.serverOptions);
  const client = new sdk.Client({ name: "installed-suno-generation-calltool", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = sdk.InMemoryTransport.createLinkedPair();
  const errorText = (value) => readErrorText(value);
  const call = (name, args, timeout = 10_000) => withDeadline(client.callTool({ name, arguments: args }, undefined,
    { timeout, maxTotalTimeout: timeout }), timeout, "INSTALLED_SUNO_GENERATION_CALLTOOL_TIMEOUT");
  let phase = "connect";
  let revokeDrain = "FAIL", eofDrain = "FAIL", authCleanup = "FAIL";
  let modelBranchesChecked = 0, modeFlagCases = 0, parameterSchemaCases = 0, artifactsSeen = 0;
  let pageReads = 0, pageObservations = 0, pageIoDelta = -1, unknownRecoveries = 0;
  let recoveryGetOnlyAfter16m = false, saturatedHistoryGetCalls = 0, diagnosticCountersSaturated = false;
  let pendingZeroReadyRecoveries = 0, objectIncompleteGapPreserved = false;
  let foreignAttemptDenied = false, sameBindingNewLinkDenied = false, cachedUrlDeniedAfterRevoke = false;
  let replayPosts = -1, authStoreClosed = false;
  try {
    await withDeadline(server.connect(serverTransport), 4_000, "INSTALLED_SUNO_GENERATION_SERVER_CONNECT_TIMEOUT");
    await withDeadline(client.connect(clientTransport), 4_000, "INSTALLED_SUNO_GENERATION_CLIENT_CONNECT_TIMEOUT");
    phase = "tools-list";
    const listed = await withDeadline(client.listTools({}, { timeout: 4_000, maxTotalTimeout: 4_000 }), 4_000,
      "INSTALLED_SUNO_GENERATION_TOOLS_LIST_TIMEOUT");
    const surface = assertSunoGenerationToolSurface(listed.tools, true, modules);
    if (surface.tool_count !== 5 || !sameArray(listed.tools.filter((tool) => TOOL_NAMES.includes(tool.name)).map((tool) => tool.name), TOOL_NAMES)) {
      fail("INSTALLED_SUNO_GENERATION_TOOL_ORDER_INVALID");
    }
    phase = "static-parameters";
    const staticOutput = await call(TOOL_NAMES[0], {});
    if (staticOutput.isError || staticOutput.structuredContent?.runtime_usable !== false || staticOutput.structuredContent?.dispatch_allowed !== false ||
        staticOutput.structuredContent?.backend_acceptance !== "UNPROVEN" || staticOutput.structuredContent?.effective_defaults !== "UNKNOWN") {
      fail("INSTALLED_SUNO_GENERATION_STATIC_PARAMETER_OUTPUT_INVALID");
    }
    if (counts.generationPosts !== 0 || counts.historyGets !== 0 || counts.resultGets !== 0) fail("INSTALLED_SUNO_GENERATION_STATIC_TOOL_SIDE_EFFECT");

    phase = "request-matrix";
    parameterSchemaCases = assertSunoGenerationParameterMatrix(modules.tools.OWNER_SUNO_GENERATION_TOOL_INPUT_SCHEMAS.generate);
    const matrixAttempt = makeAttempt("matrix");
    await linkAttempt(runtime, matrixAttempt, fixedNow);
    const matrixRequests = [];
    for (const model_id of MODELS) for (const is_custom_mode of [false, true]) for (const is_instrumental of [false, true]) {
      const request = Object.freeze({ link_attempt_id: matrixAttempt, model_id, mode: "generate",
        prompt: `Suno installed ${model_id} ${is_custom_mode} ${is_instrumental} 🎵`, is_custom_mode, is_instrumental,
        negative_tags: `tag-${matrixRequests.length}`, styles: `style-${matrixRequests.length}`, title: `Track ${matrixRequests.length}` });
      const response = await call(TOOL_NAMES[1], request);
      assertCompletedResult(response, model_id, request);
      if (matrixRequests.length === 0) matrixRequests.push({ request, recovery_id: response.structuredContent.recovery_id,
        url: response.structuredContent.artifacts[0]?.url });
      artifactsSeen += response.structuredContent.artifacts.length;
      modeFlagCases += 1;
    }
    modelBranchesChecked = MODELS.length;
    if (!sameArray(posts.slice(0, 8).map((body) => body.settings.model_type), ["V6", "V6", "V6", "V6", "V6_wild", "V6_wild", "V6_wild", "V6_wild"])) {
      fail("INSTALLED_SUNO_GENERATION_MODEL_BRANCH_POSTS_INVALID");
    }
    if (posts.slice(0, 8).some((body, index) => body.prompt !== `Suno installed ${body.settings.model_type} ${index % 4 >= 2} ${index % 2 === 1} 🎵` ||
        body.settings.is_custom_mode !== (index % 4 >= 2) || body.settings.is_instrumental !== (index % 2 === 1))) {
      fail("INSTALLED_SUNO_GENERATION_EXPLICIT_CONTROLS_WIRE_INVALID");
    }

    phase = "multi80-pages";
    const multiAttempt = makeAttempt("multi80"); await linkAttempt(runtime, multiAttempt, now);
    const multiRequest = { link_attempt_id: multiAttempt, model_id: "V6", mode: "generate", prompt: "Suno installed 80-object fixture",
      is_custom_mode: true, is_instrumental: false, negative_tags: "", styles: "", title: "80-object local fixture" };
    const firstPage = await call(TOOL_NAMES[1], multiRequest);
    if (firstPage.isError || firstPage.structuredContent?.observed_artifact_count !== 80 || firstPage.structuredContent?.artifacts?.length !== 64 ||
        firstPage.structuredContent?.page_size !== 64 || firstPage.structuredContent?.next_offset !== 64 || firstPage.structuredContent?.has_more !== true) {
      fail("INSTALLED_SUNO_GENERATION_PAGE_ONE_INVALID");
    }
    assertNoPrivateText(firstPage, [multiRequest.prompt, multiRequest.negative_tags, multiRequest.styles, multiRequest.title]);
    const beforePage = { generationPosts: counts.generationPosts, historyGets: counts.historyGets, resultGets: counts.resultGets };
    const secondPage = await call(TOOL_NAMES[4], { link_attempt_id: multiAttempt, recovery_id: firstPage.structuredContent.recovery_id, offset: 64 });
    pageIoDelta = (counts.generationPosts - beforePage.generationPosts) + (counts.historyGets - beforePage.historyGets) +
      (counts.resultGets - beforePage.resultGets);
    if (secondPage.isError || secondPage.structuredContent?.observed_artifact_count !== 80 || secondPage.structuredContent?.offset !== 64 ||
        secondPage.structuredContent?.artifacts?.length !== 16 || secondPage.structuredContent?.has_more !== false || pageIoDelta !== 0) {
      fail("INSTALLED_SUNO_GENERATION_PAGE_TWO_INVALID");
    }
    artifactsSeen += firstPage.structuredContent.artifacts.length + secondPage.structuredContent.artifacts.length;
    pageReads += 1; pageObservations += firstPage.structuredContent.artifacts.length + secondPage.structuredContent.artifacts.length;

    phase = "zero-ready-incomplete-recovery";
    const pendingAttempt = makeAttempt("pending-object"); await linkAttempt(runtime, pendingAttempt, now);
    const pendingRequest = { link_attempt_id: pendingAttempt, model_id: "V6", mode: "generate",
      prompt: "Suno installed incomplete-object fixture", is_custom_mode: true, is_instrumental: false,
      negative_tags: "", styles: "", title: "incomplete object" };
    const pending = await call(TOOL_NAMES[1], pendingRequest);
    const pendingError = errorText(pending);
    if (!pending.isError || pendingError?.error?.code !== "OUTCOME_UNKNOWN" ||
        !/^suno_generation_recovery_[0-9a-f-]{36}$/u.test(String(pendingError.error?.recovery_id))) {
      fail("INSTALLED_SUNO_GENERATION_ZERO_READY_OBJECT_NOT_RECOVERABLE");
    }
    const pendingList = await call(TOOL_NAMES[3], { link_attempt_id: pendingAttempt });
    const pendingRecovery = pendingList.structuredContent?.recoveries?.find((item) => item.recovery_id === pendingError.error.recovery_id);
    objectIncompleteGapPreserved = pendingRecovery?.status === "outcome_unknown" && pendingRecovery?.observed_artifact_count === 0 &&
      pendingRecovery?.diagnostic?.gaps?.includes("OBJECT_INCOMPLETE") === true;
    if (pendingList.isError || !objectIncompleteGapPreserved) fail("INSTALLED_SUNO_GENERATION_ZERO_READY_RECOVERY_LIST_INVALID");
    const pendingPostCount = counts.generationPosts, pendingResultGets = counts.resultGets;
    const pendingReconcile = await call(TOOL_NAMES[2], { link_attempt_id: pendingAttempt, recovery_id: pendingError.error.recovery_id });
    if (pendingReconcile.isError || pendingReconcile.structuredContent?.status !== "completed" ||
        pendingReconcile.structuredContent?.artifacts?.length !== 1 || counts.generationPosts !== pendingPostCount ||
        counts.resultGets !== pendingResultGets + 1) fail("INSTALLED_SUNO_GENERATION_ZERO_READY_GET_RECOVERY_INVALID");
    assertNoPrivateText(pendingReconcile, [pendingRequest.prompt, pendingRequest.negative_tags, pendingRequest.styles, pendingRequest.title]);
    pendingZeroReadyRecoveries = 1;
    artifactsSeen += pendingReconcile.structuredContent.artifacts.length;

    phase = "unknown-ack-reconcile";
    const unknownAttempt = makeAttempt("unknown"); await linkAttempt(runtime, unknownAttempt, now);
    const unknownRequest = { link_attempt_id: unknownAttempt, model_id: "V6_wild", mode: "generate",
      prompt: "Suno installed unknown acknowledgement fixture", is_custom_mode: true, is_instrumental: true,
      negative_tags: "", styles: "private style", title: "private title" };
    const unknown = await call(TOOL_NAMES[1], unknownRequest);
    const unknownError = errorText(unknown);
    const recoveryId = unknownError?.error?.recovery_id;
    if (!unknown.isError || unknownError?.error?.code !== "OUTCOME_UNKNOWN" ||
        !/^suno_generation_recovery_[0-9a-f-]{36}$/u.test(String(recoveryId))) fail("INSTALLED_SUNO_GENERATION_UNKNOWN_OUTCOME_INVALID");
    unknownRecoveries = 1;
    assertNoPrivateText(unknown, [unknownRequest.prompt, unknownRequest.negative_tags, unknownRequest.styles, unknownRequest.title]);
    const generationPostsBeforeLateGet = counts.generationPosts;
    now += 16 * 60_000;
    for (let index = 0; index < 260; index += 1) {
      const reconciled = await call(TOOL_NAMES[2], { link_attempt_id: unknownAttempt, recovery_id: recoveryId }, 8_000);
      if (!reconciled.isError || errorText(reconciled)?.error?.code !== "OUTCOME_UNKNOWN") fail("INSTALLED_SUNO_GENERATION_LATE_RECONCILE_INVALID");
      if (counts.generationPosts !== generationPostsBeforeLateGet) fail("INSTALLED_SUNO_GENERATION_UNKNOWN_POST_REPLAYED");
    }
    recoveryGetOnlyAfter16m = counts.generationPosts === generationPostsBeforeLateGet && counts.historyGets > 0;
    const diagnosticList = await call(TOOL_NAMES[3], { link_attempt_id: unknownAttempt });
    const diagnostic = diagnosticList.structuredContent?.recoveries?.find((item) => item.recovery_id === recoveryId)?.diagnostic;
    saturatedHistoryGetCalls = diagnostic?.history_get_calls ?? -1;
    diagnosticCountersSaturated = diagnostic?.counters_saturated === true;
    if (diagnosticList.isError || saturatedHistoryGetCalls !== 255 || !diagnosticCountersSaturated || diagnostic?.result_get_calls !== 0) {
      fail("INSTALLED_SUNO_GENERATION_DIAGNOSTIC_SATURATION_INVALID");
    }
    const postsBeforeRetry = counts.generationPosts;
    const retry = await call(TOOL_NAMES[1], unknownRequest);
    replayPosts = counts.generationPosts - postsBeforeRetry;
    if (!retry.isError || errorText(retry)?.error?.code !== "OUTCOME_UNKNOWN" || replayPosts !== 0) fail("INSTALLED_SUNO_GENERATION_UNKNOWN_REPLAY_INVALID");

    phase = "foreign-recovery";
    const foreignAttempt = makeAttempt("foreign"); await linkAttempt(runtime, foreignAttempt, now);
    const foreign = await call(TOOL_NAMES[2], { link_attempt_id: foreignAttempt, recovery_id: recoveryId });
    foreignAttemptDenied = foreign.isError && errorText(foreign)?.error?.code === "RECOVERY_NOT_FOUND" && !JSON.stringify(foreign).includes("r2.syntx.ai");
    if (!foreignAttemptDenied) fail("INSTALLED_SUNO_GENERATION_FOREIGN_ATTEMPT_RECOVERY_LEAK");

    phase = "revoke-and-semantic-rebind";
    const semantic = matrixRequests[0];
    const authLink = runtime.serverOptions.auth?.linkService;
    if (!authLink || !semantic?.recovery_id || typeof semantic.url !== "string") fail("INSTALLED_SUNO_GENERATION_REVOKE_AUTH_SURFACE_MISSING");
    await authLink.revoke(runtime.authBinding, matrixAttempt);
    const oldPage = await call(TOOL_NAMES[4], { link_attempt_id: matrixAttempt, recovery_id: semantic.recovery_id });
    cachedUrlDeniedAfterRevoke = oldPage.isError && !JSON.stringify(oldPage).includes("r2.syntx.ai") && !JSON.stringify(oldPage).includes(semantic.url);
    if (!cachedUrlDeniedAfterRevoke) fail("INSTALLED_SUNO_GENERATION_REVOKED_RESULT_URL_LEAK");
    const newAttempt = makeAttempt("same-owner-new-link"); await linkAttempt(runtime, newAttempt, now);
    const rebind = await call(TOOL_NAMES[1], { ...semantic.request, link_attempt_id: newAttempt });
    sameBindingNewLinkDenied = rebind.isError && errorText(rebind)?.error?.code === "INTENT_ALREADY_CLAIMED" &&
      !JSON.stringify(rebind).includes("r2.syntx.ai") && counts.generationPosts === postsBeforeRetry;
    if (!sameBindingNewLinkDenied) fail("INSTALLED_SUNO_GENERATION_NEW_LINK_SEMANTIC_REPLAY_INVALID");

    phase = "revoke-drain";
    revokeAttemptId = makeAttempt("revoke-drain"); await linkAttempt(runtime, revokeAttemptId, now);
    const revokeRequest = { link_attempt_id: revokeAttemptId, model_id: "V6", mode: "generate",
      prompt: "Suno installed revoke drain fixture", is_custom_mode: false, is_instrumental: false,
      negative_tags: "", styles: "", title: "revoke" };
    const pendingRevoke = call(TOOL_NAMES[1], revokeRequest, 8_000);
    await withDeadline(revokePostPromise, 4_000, "INSTALLED_SUNO_GENERATION_REVOKE_POST_NOT_STARTED");
    await withDeadline(authLink.revoke(runtime.authBinding, revokeAttemptId), 4_000, "INSTALLED_SUNO_GENERATION_REVOKE_DRAIN_TIMEOUT");
    await withDeadline(revokeAbortPromise, 2_000, "INSTALLED_SUNO_GENERATION_REVOKE_ABORT_NOT_SEEN");
    const revokeResult = await withDeadline(pendingRevoke, 2_000, "INSTALLED_SUNO_GENERATION_REVOKE_CALLTOOL_TIMEOUT");
    const revokeStatus = (await runtime.authStore.getSnapshot(runtime.authBinding, revokeAttemptId)).status;
    if (!revokeResult.isError || revokeStatusAtAbort !== "LINKED" || revokeStatus !== "REVOKED") fail("INSTALLED_SUNO_GENERATION_REVOKE_DRAIN_INVALID");
    revokeDrain = "PASS";

    phase = "eof-drain";
    eofAttemptId = makeAttempt("eof-drain"); await linkAttempt(runtime, eofAttemptId, now);
    const eofRequest = { link_attempt_id: eofAttemptId, model_id: "V6_wild", mode: "generate", prompt: "Suno installed EOF drain fixture",
      is_custom_mode: true, is_instrumental: false, negative_tags: "", styles: "", title: "eof" };
    const pendingEof = call(TOOL_NAMES[1], eofRequest, 8_000);
    await withDeadline(eofPostPromise, 4_000, "INSTALLED_SUNO_GENERATION_EOF_POST_NOT_STARTED");
    const eofEvents = [];
    const input = new PassThrough();
    let signalTransportClosed;
    const transportClosed = new Promise((resolvePromise) => { signalTransportClosed = resolvePromise; });
    const transport = { onclose: undefined, async close() { this.onclose?.(); signalTransportClosed(); } };
    const lifecycle = runtime.ownerSunoGenerationLifecycle;
    if (!lifecycle) fail("INSTALLED_SUNO_GENERATION_EOF_LIFECYCLE_MISSING");
    const lifecycleAdapter = { async close() { eofEvents.push("suno_generation_close"); await lifecycle.close(); } };
    const noOwnerServiceArgs = Array(12).fill(undefined);
    const noGenerationServiceArgs = Array(5).fill(undefined);
    const closeOwnerServices = modules.stdio.closeOwnerReadServicesOnTransportEof(transport,
      undefined, undefined, undefined, undefined,
      () => { eofEvents.push("auth_release"); runtime.authStore.close(); authStoreClosed = true; authCleanup = "PASS"; },
      input, ...noOwnerServiceArgs, false, ...noGenerationServiceArgs, lifecycleAdapter);
    input.resume(); input.end();
    await withDeadline(transportClosed, 3_000, "INSTALLED_SUNO_GENERATION_EOF_CHILD_NOT_CLOSED");
    await withDeadline(closeOwnerServices(), 3_000, "INSTALLED_SUNO_GENERATION_EOF_DRAIN_TIMEOUT");
    const eofResult = await withDeadline(pendingEof, 2_000, "INSTALLED_SUNO_GENERATION_EOF_CALLTOOL_TIMEOUT");
    input.destroy();
    if (!eofResult.isError || eofStatusAtAbort !== "LINKED" || !authStoreClosed ||
        !sameArray(eofEvents, ["suno_generation_close", "auth_release"])) fail("INSTALLED_SUNO_GENERATION_EOF_ORDER_INVALID");
    eofDrain = "PASS";

    if (counts.generationPosts !== 13 || counts.resultGets !== 14 || artifactsSeen !== 89 || pendingZeroReadyRecoveries !== 1 ||
        !recoveryGetOnlyAfter16m || replayPosts !== 0 || !diagnosticCountersSaturated) {
      fail("INSTALLED_SUNO_GENERATION_MEASURED_COUNTS_INVALID");
    }
    return Object.freeze({ status: "INSTALLED_STOCK_SDK_SUNO_GENERATION_CALLTOOL_PASS", model_branches_checked: modelBranchesChecked,
      mode_flag_cases: modeFlagCases, parameter_schema_cases: parameterSchemaCases, generation_posts: counts.generationPosts, result_messages: counts.resultGets,
      artifacts_seen: artifactsSeen, page_reads: pageReads, page_size: 64, page_observations: pageObservations, page_io_delta: pageIoDelta,
      unknown_recoveries: unknownRecoveries, recovery_get_only_after_16m: recoveryGetOnlyAfter16m,
      saturated_history_get_calls: saturatedHistoryGetCalls, diagnostic_counters_saturated: diagnosticCountersSaturated,
      pending_zero_ready_recoveries: pendingZeroReadyRecoveries, object_incomplete_gap_preserved: objectIncompleteGapPreserved,
      replay_posts: replayPosts, foreign_attempt_denied: foreignAttemptDenied, same_binding_new_link_denied: sameBindingNewLinkDenied,
      cached_url_denied_after_revoke: cachedUrlDeniedAfterRevoke, revoke_drain: revokeDrain, eof_drain: eofDrain, auth_cleanup: authCleanup,
      authenticated_network_calls: 0, billing_calls: 0, private_request_text_exposed: false, private_classes_exported: false });
  } catch (error) {
    if (error instanceof SunoGenerationInstalledCheckError) throw error;
    const name = isRecord(error) && typeof error.name === "string" ? error.name : "";
    const kind = /^[A-Za-z][A-Za-z0-9]{0,31}$/u.test(name) ? `OBJECT_${name.toUpperCase()}` :
      error === undefined ? "UNDEFINED_THROWN" : error === null ? "NULL_THROWN" : `THROWN_${typeof error}`.toUpperCase();
    fail(`INSTALLED_SUNO_GENERATION_CALLTOOL_${phase.toUpperCase()}_${kind}_FAILED`);
  } finally {
    const errors = [];
    for (const operation of [() => client.close(), () => server.close(), () => runtime.ownerSunoGenerationLifecycle?.close(),
      ...(authStoreClosed ? [] : [() => runtime.authStore.close()])]) {
      try { await withDeadline(operation(), 2_000, "INSTALLED_SUNO_GENERATION_CLEANUP_TIMEOUT"); } catch { errors.push("FAILED"); }
    }
    if (errors.length) fail("INSTALLED_SUNO_GENERATION_CLEANUP_FAILED");
  }
}
function createAudioTransaction(body, postIndex, outputCount, unknown, incompleteFirst = false) {
  const ackId = `suno-installed-owner-ack-${postIndex}`;
  let remaining = outputCount, objectIndex = 0;
  const messages = Array.from({ length: Math.ceil(outputCount / 64) }, (_, part) => {
    const count = Math.min(64, remaining);
    const messageId = `suno-installed-bot-${postIndex}-${part + 1}`;
    const objects = Array.from({ length: count }, () => {
      objectIndex += 1;
      return Object.freeze({ id: `suno-installed-object-${postIndex}-${objectIndex}`,
        url: `https://r2.syntx.ai/installed/suno-${postIndex}-${objectIndex}.mp3` });
    });
    remaining -= count;
    return Object.freeze({ messageId, objects: Object.freeze(objects) });
  });
  return Object.freeze({ prompt: body.prompt, model: body.settings.model_type, ackId,
    ackObjectId: `suno-installed-ack-object-${postIndex}`, messages: Object.freeze(messages), unknown, incompleteFirst });
}

function waitForAbort(signal, afterAbort) {
  if (!signal || typeof signal.addEventListener !== "function") fail("INSTALLED_SUNO_GENERATION_ABORT_SIGNAL_MISSING");
  return new Promise((_resolvePromise, reject) => {
    const abort = async () => {
      signal.removeEventListener("abort", abort);
      try { await afterAbort(); } finally { reject(new DOMException("Synthetic Suno request aborted by owner lifecycle.", "AbortError")); }
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) void abort();
  });
}

function makeAttempt(suffix) { return `${ATTEMPT_PREFIX}${suffix}_012345678901`; }

async function linkAttempt(runtime, attemptId, now) {
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: runtime.authBinding, expires_at_ms: now + 60 * 60_000 });
  await runtime.authStore.beginHandoff(runtime.authBinding, attemptId);
  await runtime.authStore.attachChallenge(runtime.authBinding, attemptId, `synthetic-suno-challenge-${attemptId}`);
  await runtime.authStore.beginPoll(runtime.authBinding, attemptId);
  await runtime.authStore.markLinked(runtime.authBinding, attemptId, { scheme: "Bearer", value: `synthetic-suno-credential-${attemptId}` });
}

function assertCompletedResult(response, model, request) {
  const result = response?.structuredContent;
  if (response?.isError || !isRecord(result) || result.status !== "completed" || result.model_id !== model ||
      result.status_semantics !== "LOCAL_OBSERVED_AVAILABILITY_ONLY" || result.backend_acceptance !== "UNPROVEN" ||
      result.provider_terminal_status !== "UNPROVEN" || result.parameters?.mode !== "generate" ||
      result.parameters?.is_custom_mode !== request.is_custom_mode || result.parameters?.is_instrumental !== request.is_instrumental ||
      result.artifacts?.length !== 1 || result.page_size !== 64) fail("INSTALLED_SUNO_GENERATION_COMPLETED_RESULT_INVALID");
  if (Object.hasOwn(result, "prompt") || Object.hasOwn(result, "negative_tags") || Object.hasOwn(result, "styles") || Object.hasOwn(result, "title")) {
    fail("INSTALLED_SUNO_GENERATION_PRIVATE_REQUEST_TEXT_EXPOSED");
  }
  assertNoPrivateText(response, [request.prompt, request.negative_tags, request.styles, request.title]);
}

function assertNoPrivateText(value, texts) {
  const serialized = JSON.stringify(value);
  if (texts.some((text) => typeof text === "string" && text.length > 0 && serialized.includes(text))) {
    fail("INSTALLED_SUNO_GENERATION_PRIVATE_REQUEST_TEXT_EXPOSED");
  }
  return true;
}

function assertClosedObject(schema, required, optional, code) {
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
function sameKeys(value, expected) { return isRecord(value) && sameArray(Object.keys(value).sort(), [...expected].sort()); }
function sameArray(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isWithin(parent, child) { const path = relative(parent, child); return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path)); }
function withDeadline(promise, milliseconds, code) {
  let timer;
  return Promise.race([promise, new Promise((_resolvePromise, reject) => { timer = setTimeout(() => reject(new SunoGenerationInstalledCheckError(code)), milliseconds); })])
    .finally(() => clearTimeout(timer));
}
function fail(code) { throw new SunoGenerationInstalledCheckError(code); }
