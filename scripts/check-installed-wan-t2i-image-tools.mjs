#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod/v4";

export class WanT2iImageToolsInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "WanT2iImageToolsInstalledCheckError"; this.code = code; }
}

const MODELS = Object.freeze(["wan_25_t2i_preview", "wan_26_t2i"]);
const TOOL_NAMES = Object.freeze(["syntx_owner_generate_wan_t2i_image", "syntx_owner_reconcile_wan_t2i_image",
  "syntx_owner_list_wan_t2i_image_recoveries"]);
const RATIOS = Object.freeze(["1:1", "3:4", "4:3", "9:16", "16:9"]);
const RESOLUTIONS = Object.freeze(["720P", "1080P"]);
const BATCHES = Object.freeze([1, 2, 3, 4]);
const DEFAULT_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const MODEL_ROWS = Object.freeze({
  wan_25_t2i_preview: "85dd8513cc1fb51429fef15454ec7959935284734cbb4d0f58c7feb7e046883a",
  wan_26_t2i: "44ab97682526f0564452a190742c059754a16427e5b09ce5c4736d79e2000f6e"
});
const DISCOVERY_ROWS = Object.freeze({
  wan_25_t2i_preview: "sha256:46c6575ccb75a4e8475979993b5f0f7142d96c5f3ec68c075816798352321d26",
  wan_26_t2i: "sha256:608eca0223fedd4ad09afcdf772774f04542dd2a266176aa3b10cc24a9c74b9b"
});
const PROFILE_HASHES = Object.freeze({
  wan_25_t2i_preview: "sha256:b5f06e2310c449b9509fb2f3f4d044a89ae07e9b40c0cfb318330540f7cc14ab",
  wan_26_t2i: "sha256:755216d9b6037ba0515b75c91b7af7f69724443e30f19a8128a6f1a1574f488e"
});
const PHASE_NAMES = Object.freeze(["package-paths", "node-runtime", "module-import", "public-exports", "source-contract",
  "tool-schemas", "declarations", "flag-reader", "stdio-default", "stdio-opt-in", "in-process-runtime"]);
const SOURCE_MODULES = Object.freeze([
  "application/owner-wan-t2i-parameters", "application/owner-wan-t2i-source-profile",
  "application/owner-wan-t2i-cost-parameters", "application/owner-wan-t2i-generation-service",
  "application/owner-wan-t2i-request-preparer", "application/owner-wan-t2i-one-shot-policy",
  "application/owner-wan-t2i-history-binding", "adapter/syntx/owner-wan-t2i-result",
  "adapter/syntx/chat-http-client", "adapter/syntx/http-client", "mcp/owner-wan-t2i-tools", "mcp/server",
  "runtime/observed-owner-runtime", "transports/stdio-owner", "catalog/selected-discovery-catalog",
  "catalog/discovery-catalog", "catalog/syntx-public-catalog", "domain/generation-contract"
]);
const PACKAGE_PATHS = Object.freeze(["dist/src/index.js", "dist/src/index.d.ts",
  ...SOURCE_MODULES.flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`])]);
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

export function assertWanT2iNativePackagePaths(paths) {
  if (!(paths instanceof Set)) fail("INSTALLED_WAN_T2I_PACKAGE_PATHS_INVALID");
  if (PACKAGE_PATHS.some((path) => !paths.has(path))) fail("INSTALLED_WAN_T2I_PACKAGE_CONTENT_MISSING");
  return true;
}

export function assertWanT2iDiagnosticEnums(enums) {
  if (!sameArray(enums?.phases, ["REQUEST_PREPARE", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN",
    "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"]) ||
      !sameArray(enums?.errorCodes, ["INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "MODEL_BINDING_MISMATCH",
        "PRINCIPAL_NOT_LINKED", "PREFLIGHT_FAILED", "INTENT_ALREADY_CLAIMED", "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"]) ||
      !Array.isArray(enums.historyReasons) || !Array.isArray(enums.resultReasons) || enums.historyReasons.length < 10 ||
      enums.resultReasons.length < 10 || [...enums.historyReasons, ...enums.resultReasons].some((value) => typeof value !== "string")) {
    fail("INSTALLED_WAN_T2I_DIAGNOSTIC_ENUMS_INVALID");
  }
  return true;
}

export function assertWanT2iFlagReader(stdio) {
  const reader = stdio?.readOwnerWanT2iImageFlag;
  if (typeof reader !== "function" || reader(undefined) !== false || reader("") !== false || reader("0") !== false || reader("1") !== true) {
    fail("INSTALLED_WAN_T2I_FLAG_READER_INVALID");
  }
  for (const input of ["true", "yes", "01", " 1 ", "1 ", "2"]) {
    let rejected = false; try { reader(input); } catch { rejected = true; }
    if (!rejected) fail("INSTALLED_WAN_T2I_FLAG_READER_INVALID");
  }
  return true;
}

export function assertWanT2iPublicExports(api, modules) {
  const pairs = [
    ["OWNER_WAN_T2I_MODELS", "parameters"], ["getOwnerWanT2iSourceParameters", "parameters"],
    ["normalizeOwnerWanT2iParameters", "parameters"], ["OwnerWanT2iParametersError", "parameters"],
    ["getOwnerWanT2iSourceProfile", "sourceProfile"], ["OwnerWanT2iSourceProfileError", "sourceProfile"],
    ["projectOwnerWanT2iCostParameters", "cost"], ["OwnerWanT2iGenerationService", "generation"],
    ["OwnerWanT2iGenerationServiceError", "generation"], ["OWNER_WAN_T2I_GENERATION_PHASES", "generation"],
    ["OWNER_WAN_T2I_GENERATION_ERROR_CODES", "generation"], ["OWNER_WAN_T2I_GENERATION_HISTORY_REASONS", "generation"],
    ["OWNER_WAN_T2I_GENERATION_RESULT_REASONS", "generation"], ["OWNER_WAN_T2I_TOOL_NAMES", "tools"],
    ["OWNER_WAN_T2I_TOOL_INPUT_SCHEMAS", "tools"], ["OWNER_WAN_T2I_TOOL_OUTPUT_SCHEMAS", "tools"],
    ["registerSyntxOwnerWanT2iTools", "tools"], ["createMcpServer", "server"], ["createObservedOwnerRuntime", "runtime"]
  ];
  if (!isRecord(api) || pairs.some(([name, group]) => !isRecord(modules[group]) || api[name] === undefined || api[name] !== modules[group][name])) {
    fail("INSTALLED_WAN_T2I_PUBLIC_EXPORT_MISMATCH");
  }
  for (const name of ["OwnerWanT2iPreparedCandidate", "OwnerWanT2iOneShotPermit", "createOwnerWanT2iOneShotPermit",
    "consumeOwnerWanT2iOneShotPermit", "getOwnerWanT2iPreparedCandidateState", "startWanT2iImageWithOwnedCandidateInput",
    "InternalOwnerWanT2iImageArtifact", "OwnerWanT2iResultReadContext"]) {
    if (Object.hasOwn(api, name)) fail("INSTALLED_WAN_T2I_PRIVATE_EXPORT_LEAK");
  }
  return true;
}

export function assertWanT2iDeclarations(text) {
  if (typeof text !== "string") fail("INSTALLED_WAN_T2I_DECLARATIONS_INVALID");
  const safe = ["OwnerWanT2iModel", "OwnerWanT2iParametersInput", "OwnerWanT2iParameters", "OwnerWanT2iNormalizedParameters",
    "OwnerWanT2iSourceParameters", "OwnerWanT2iSourceProfile", "OwnerWanT2iCostParameters", "OwnerWanT2iGenerationServiceOptions",
    "OwnerWanT2iGenerateInput", "OwnerWanT2iReconcileInput", "OwnerWanT2iRecoveryListInput", "OwnerWanT2iGenerationResult",
    "OwnerWanT2iGenerationDiagnostic", "OwnerWanT2iRecoveryListItem", "OwnerWanT2iGenerationServiceErrorCode",
    "OwnerWanT2iImageServiceComposition", "RegisterSyntxOwnerWanT2iToolsOptions"];
  if (safe.some((name) => !text.includes(name))) fail("INSTALLED_WAN_T2I_DECLARATIONS_INVALID");
  const privateNames = ["OwnerWanT2iPreparedCandidate", "OwnerWanT2iOneShotPermit", "getOwnerWanT2iPreparedCandidateState",
    "StartWanT2iImageWithOwnedCandidateInput", "InternalOwnerWanT2iImageArtifact"];
  if (privateNames.some((name) => text.includes(`export { ${name}`) || text.includes(`export type { ${name}`))) {
    fail("INSTALLED_WAN_T2I_PRIVATE_DECLARATION_LEAK");
  }
  return true;
}

/** Checks the pinned source profile and cost mapping with the package's actual pure domain APIs. */
export function assertWanT2iSourceContract(parameters, profiles, cost, catalog, selectedVersion) {
  if (selectedVersion !== DEFAULT_VERSION || !isRecord(catalog) ||
      typeof parameters?.getOwnerWanT2iSourceParameters !== "function" ||
      typeof parameters?.normalizeOwnerWanT2iParameters !== "function" ||
      typeof profiles?.getOwnerWanT2iSourceProfile !== "function" ||
      typeof cost?.projectOwnerWanT2iCostParameters !== "function") fail("INSTALLED_WAN_T2I_SOURCE_PROFILE_INVALID");
  const source = parameters.getOwnerWanT2iSourceParameters();
  if (!sameArray(source?.model_ids, MODELS) || source.dispatch_allowed !== false || source.runtime_activation !== false ||
      source.backend_acceptance !== "UNPROVEN" || source.effective_defaults !== "UNKNOWN" ||
      source.source_pins?.public_catalog_version !== DEFAULT_VERSION ||
      source.source_pins?.public_models_sha256 !== "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444" ||
      source.source_pins?.form_build_id !== "1791467421" ||
      source.source_pins?.form_sha256 !== "sha256:c1190674e29d4b943eaa3bfb3571a8716f4a9901de433fc423840aed393f11a3" ||
      source.source_pins?.settings_helper_sha256 !== "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" ||
      source.source_pins?.cost_source_sha256 !== "sha256:12db4cc4e9cce28d915b6a7179f26be03967122edc791a393bfbc485b201c223" ||
      source.source_pins?.cost_helper_sha256 !== "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9" ||
      !sameArray(source.cost?.declared_get_cost_params, ["size", "batch_size"]) || !sameArray(source.cost?.cost_inputs, ["batch_size"]) ||
      source.cost?.size !== "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS" || source.cost?.quote_billing_units_hard_cap !== "UNPROVEN") {
    fail("INSTALLED_WAN_T2I_SOURCE_PROFILE_INVALID");
  }
  for (const model of MODELS) {
    const profile = profiles.getOwnerWanT2iSourceProfile(model, catalog, selectedVersion);
    if (profile.profile_id !== "owner-wan-t2i-source-profile-v1" || profile.model_id !== model || profile.ai_name !== "wan_image" ||
        profile.model_type !== model || profile.operation_id !== "generate-image" || profile.scope !== "image" ||
        profile.public_catalog_version !== selectedVersion || profile.effective_defaults !== "UNKNOWN" ||
        profile.catalog_default_flag !== (model === "wan_26_t2i") ||
        profile.catalog_default_confidence !== "PUBLIC_CATALOG_FLAG_ONLY_NOT_RUNTIME_SELECTION" ||
        profile.dispatch_allowed !== false || profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN" ||
        profile.source_binding?.source_execution !== false ||
        profile.source_binding?.public_catalog_raw_model_row_schema_hash !== `sha256:${MODEL_ROWS[model]}` ||
        profile.source_binding?.public_catalog_raw_model_row_hash_codec !== "SHA256_JSON_STRINGIFY_EXACT_RAW_PUBLIC_RECORD" ||
        profile.source_binding?.discovery_model_record_schema_hash !== DISCOVERY_ROWS[model] ||
        profile.source_binding?.discovery_record_hash_codec !== "DOMAIN_SCHEMA_HASH_CANONICAL_JSON" ||
        profile.source_binding?.source_artifacts?.form?.build_id !== "1791467421" ||
        profile.source_binding?.source_artifacts?.sender?.module !== "video.js" ||
        profile.source_binding?.source_artifacts?.sender?.sha256 !== "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae" ||
        profile.source_binding?.source_control_confidence !== "PINNED_STATIC_SOURCE_NOT_EFFECTIVE_CACHE_OR_PROVIDER_PROOF" ||
        profile.public_input_metadata?.uploadable !== false || profile.public_input_metadata?.max_file_size !== 0 ||
        profile.public_input_metadata?.max_file_size_interpretation !== "ZERO_NOT_UNLIMITED_OR_PROVIDER_CAP" ||
        profile.public_input_metadata?.max_prompt_length !== 1_500 ||
        profile.cost_policy?.projection_status !== "JOINED_SOURCE_DEFINITION_ONLY_NO_INTENT_VALUES" ||
        profile.cost_policy?.confidence !== "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" ||
        profile.profile_schema_hash !== PROFILE_HASHES[model]) fail("INSTALLED_WAN_T2I_SOURCE_PROFILE_INVALID");
    for (const ratio of RATIOS) for (const resolution of RESOLUTIONS) for (const batch of BATCHES) {
      const intent = { model_id: model, prompt: "installed WAN source matrix", parameters: {
        aspect_ratio: ratio, resolution, batch_size: batch, prompt_extend: batch % 2 === 0,
        seed: batch === 4 ? 2_147_483_647 : null, color_palette: null, bbox_list: []
      } };
      const normalized = parameters.normalizeOwnerWanT2iParameters(intent);
      const projected = cost.projectOwnerWanT2iCostParameters(intent);
      if (normalized.dispatch_allowed !== false || normalized.backend_acceptance !== "UNPROVEN" ||
          normalized.source_bound_intent.model_id !== model || !sameJson(normalized.source_bound_intent.parameters, intent.parameters) ||
          projected.model_id !== model || projected.routing?.ai_name !== "wan_image" || projected.routing?.model_type !== model ||
          !sameJson(projected.cost_inputs, { batch_size: batch }) || Object.hasOwn(projected.cost_inputs, "size") ||
          !sameArray(projected.declared_model_info_keys, ["size", "batch_size"]) ||
          !sameArray(projected.omitted_model_info_keys, ["size"]) || projected.dispatch_allowed !== false ||
          projected.backend_acceptance !== "UNPROVEN" || projected.confidence !== "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP") {
        fail("INSTALLED_WAN_T2I_SOURCE_MATRIX_INVALID");
      }
    }
  }
  const promptCases = [
    ["a".repeat(1_500), true], ["a".repeat(1_499) + "\n", false], ["😀".repeat(750), true], ["😀".repeat(749) + "\n", true]
  ];
  for (const [prompt, accepted] of promptCases) {
    let passed = true;
    try { parameters.normalizeOwnerWanT2iParameters({ model_id: MODELS[0], prompt, parameters: {
      aspect_ratio: RATIOS[0], resolution: RESOLUTIONS[0], batch_size: 1, prompt_extend: false,
      seed: null, color_palette: null, bbox_list: [] } }); } catch { passed = false; }
    if (passed !== accepted) fail("INSTALLED_WAN_T2I_PROMPT_BOUNDARY_INVALID");
  }
  for (const invalid of [
    { model_id: MODELS[0], prompt: "p", parameters: { aspect_ratio: "1:1", resolution: "720P", batch_size: 1 } },
    { model_id: MODELS[0], prompt: "p", parameters: { aspect_ratio: "1:1", resolution: "720P", batch_size: 1,
      prompt_extend: false, seed: null, color_palette: null, bbox_list: [], size: "720P" } },
    { model_id: MODELS[0], prompt: "p", parameters: { aspect_ratio: "1:1", resolution: "720P", batch_size: 1,
      prompt_extend: false, seed: null, color_palette: [], bbox_list: [] } }
  ]) expectReject(() => parameters.normalizeOwnerWanT2iParameters(invalid));
  return Object.freeze({ models_checked: 2, parameter_cases_checked: 80, prompt_boundaries_checked: promptCases.length,
    cost_inputs_checked: 80, source_execution_claimed: false, provider_acceptance_claimed: false });
}

/** Checks the actual MCP JSON schemas, all 80 runtime schema states, and the three advertised operations. */
export function assertWanT2iToolSurface(tools, enabled, enums, modules) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_WAN_T2I_TOOL_LIST_INVALID");
  const names = tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length !== 0) fail("INSTALLED_WAN_T2I_DEFAULT_OFF_FAILED");
    return Object.freeze({ tool_count: 0, schemas_strict: true });
  }
  if (names.length !== TOOL_NAMES.length || TOOL_NAMES.some((name) => names.filter((item) => item === name).length !== 1)) {
    fail("INSTALLED_WAN_T2I_TOOL_SET_MISMATCH");
  }
  assertWanT2iDiagnosticEnums(enums);
  const byName = new Map(tools.filter((tool) => TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const [generate, reconcile, list] = TOOL_NAMES.map((name) => byName.get(name));
  for (const [tool, label] of [[generate, "GENERATE"], [reconcile, "RECONCILE"], [list, "LIST"]]) {
    assertAllObjectsStrict(tool?.inputSchema, `INSTALLED_WAN_T2I_${label}_INPUT_NOT_STRICT`);
    assertAllObjectsStrict(tool?.outputSchema, `INSTALLED_WAN_T2I_${label}_OUTPUT_NOT_STRICT`);
  }
  assertExactObject(generate.inputSchema, ["link_attempt_id", "model_id", "prompt", "parameters"], [], "INSTALLED_WAN_T2I_GENERATE_INPUT_INVALID");
  assertExactObject(generate.outputSchema, ["status", "dispatch_allowed", "backend_acceptance", "provider_execution", "model_id",
    "profile_id", "profile_schema_hash", "catalog_version", "request_fingerprint", "intent_fingerprint", "parameters", "cost_routing",
    "cost_inputs", "cost_input_confidence", "source_projection_confidence", "requested_batch_size", "actual_result_count",
    "count_confidence", "provider_terminal_confidence", "artifacts"], ["recovery_id"], "INSTALLED_WAN_T2I_GENERATE_OUTPUT_INVALID");
  assertExactObject(reconcile.inputSchema, ["link_attempt_id", "recovery_id"], [], "INSTALLED_WAN_T2I_RECONCILE_INPUT_INVALID");
  assertExactObject(list.inputSchema, ["link_attempt_id"], ["limit"], "INSTALLED_WAN_T2I_LIST_INPUT_INVALID");
  assertExactObject(list.outputSchema, ["recoveries"], [], "INSTALLED_WAN_T2I_RECOVERY_LIST_INVALID");
  const generateFields = generate.inputSchema.properties;
  const parameterFields = generateFields.parameters.properties;
  if (generateFields.link_attempt_id?.pattern !== "^link_[A-Za-z0-9_-]{20,120}$" ||
      !sameArray(generateFields.model_id?.enum, MODELS) || generateFields.prompt?.minLength !== 1 || generateFields.prompt?.maxLength !== 1_500 ||
      !sameArray(parameterFields.aspect_ratio?.enum, RATIOS) || !sameArray(parameterFields.resolution?.enum, RESOLUTIONS) ||
      !sameArray(parameterFields.batch_size?.anyOf?.map((branch) => branch.const), BATCHES) ||
      parameterFields.prompt_extend?.type !== "boolean" || parameterFields.seed?.anyOf?.[0]?.minimum !== 0 ||
      parameterFields.seed?.anyOf?.[0]?.maximum !== 2_147_483_647 || parameterFields.color_palette?.type !== "null" ||
      parameterFields.bbox_list?.maxItems !== 0 || generateFields.size !== undefined || hasAnyKey(generate.inputSchema,
        ["n", "model_type", "size", "version", "file_urls", "reference_handles"])) fail("INSTALLED_WAN_T2I_PARAMETER_SCHEMA_INVALID");
  if (reconcile.inputSchema.properties?.link_attempt_id?.pattern !== "^link_[A-Za-z0-9_-]{20,120}$" ||
      reconcile.inputSchema.properties?.recovery_id?.pattern !== "^wan_t2i_recovery_[0-9a-f-]{36}$" ||
      list.inputSchema.properties?.link_attempt_id?.pattern !== "^link_[A-Za-z0-9_-]{20,120}$" ||
      list.inputSchema.properties?.limit?.minimum !== 1 || list.inputSchema.properties?.limit?.maximum !== 20 ||
      !sameJson(reconcile.outputSchema, generate.outputSchema)) fail("INSTALLED_WAN_T2I_RECOVERY_SCHEMA_INVALID");
  if (modules?.tools?.OWNER_WAN_T2I_TOOL_INPUT_SCHEMAS?.generate === undefined) fail("INSTALLED_WAN_T2I_PARAMETER_MATRIX_UNAVAILABLE");
  let cases = 0;
  for (const model_id of MODELS) for (const aspect_ratio of RATIOS) for (const resolution of RESOLUTIONS) for (const batch_size of BATCHES) {
    const accepted = modules.tools.OWNER_WAN_T2I_TOOL_INPUT_SCHEMAS.generate.safeParse({ link_attempt_id: "link_installed_wan_t2i_checker_000001",
      model_id, prompt: `Explicit installed matrix ${cases}`, parameters: { aspect_ratio, resolution, batch_size,
        prompt_extend: batch_size % 2 === 0, seed: batch_size === 4 ? 2_147_483_647 : null, color_palette: null, bbox_list: [] } }).success;
    if (!accepted) fail("INSTALLED_WAN_T2I_PARAMETER_MATRIX_INVALID");
    cases += 1;
  }
  if (cases !== 80) fail("INSTALLED_WAN_T2I_PARAMETER_MATRIX_INVALID");
  const inputSchema = modules.tools.OWNER_WAN_T2I_TOOL_INPUT_SCHEMAS.generate;
  const validInput = { link_attempt_id: "link_installed_wan_t2i_checker_000001", model_id: MODELS[0], prompt: "explicit prompt",
    parameters: { aspect_ratio: RATIOS[0], resolution: RESOLUTIONS[0], batch_size: 1,
      prompt_extend: false, seed: null, color_palette: null, bbox_list: [] } };
  for (const field of ["n", "model_type", "size", "version", "file_urls", "reference_handles"]) {
    if (inputSchema.safeParse({ ...validInput, [field]: "unexpected" }).success) fail("INSTALLED_WAN_T2I_PARAMETER_NEGATIVE_MATRIX_INVALID");
  }
  if (inputSchema.safeParse({ ...validInput, prompt: `${"a".repeat(1_499)}\n` }).success ||
      !inputSchema.safeParse({ ...validInput, prompt: "😀".repeat(750) }).success ||
      inputSchema.safeParse({ ...validInput, parameters: { ...validInput.parameters, bbox_list: [[]] } }).success ||
      inputSchema.safeParse({ ...validInput, parameters: { ...validInput.parameters, seed: -1 } }).success) {
    fail("INSTALLED_WAN_T2I_PARAMETER_NEGATIVE_MATRIX_INVALID");
  }
  const outputs = generate.outputSchema.properties;
  if (!sameArray(outputs.status?.enum, ["result_observed", "partial_results"]) || outputs.dispatch_allowed?.const !== false ||
      outputs.backend_acceptance?.const !== "UNPROVEN" || outputs.provider_execution?.const !== false ||
      outputs.provider_terminal_confidence?.const !== "UNPROVEN" || outputs.artifacts?.maxItems !== 4 ||
      outputs.actual_result_count?.maximum !== 4 || outputs.requested_batch_size?.anyOf?.length !== 4 ||
      ["prompt", "file_urls", "raw_error", "authorization"].some((key) => Object.hasOwn(outputs, key))) {
    fail("INSTALLED_WAN_T2I_GENERATE_OUTPUT_INVALID");
  }
  if (!sameArray(Object.keys(outputs.parameters?.properties ?? {}).sort(),
      ["aspect_ratio", "batch_size", "bbox_list", "color_palette", "prompt_extend", "resolution", "seed"]) ||
      !sameArray(Object.keys(outputs.cost_inputs?.properties ?? {}).sort(), ["batch_size"]) ||
      !sameArray(outputs.cost_inputs?.properties?.batch_size?.anyOf?.map((branch) => branch.const), BATCHES) ||
      !sameArray(outputs.count_confidence?.enum, ["CURRENT_MESSAGE_MATCHES_EXPLICIT_BATCH_NOT_PROVIDER_TERMINAL", "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL"])) {
    fail("INSTALLED_WAN_T2I_GENERATE_OUTPUT_INVALID");
  }
  const recoveries = list.outputSchema.properties.recoveries;
  if (recoveries?.type !== "array" || recoveries.maxItems !== 20 || recoveries.items?.additionalProperties !== false ||
      recoveries.items?.properties?.status?.const !== "OUTCOME_UNKNOWN" ||
      recoveries.items?.properties?.diagnostic?.additionalProperties !== false) fail("INSTALLED_WAN_T2I_RECOVERY_LIST_INVALID");
  const diagnostic = recoveries.items.properties.diagnostic.properties;
  if (!sameArray(diagnostic.phase?.enum, enums.phases) || !sameArray(nullableEnum(diagnostic.history_reason), enums.historyReasons) ||
      !sameArray(nullableEnum(diagnostic.result_reason), enums.resultReasons) ||
      diagnostic.history_get_calls?.maximum !== 255 || diagnostic.result_get_calls?.maximum !== 255) {
    fail("INSTALLED_WAN_T2I_DIAGNOSTIC_SCHEMA_INVALID");
  }
  if (list.inputSchema.properties.limit?.minimum !== 1 || list.inputSchema.properties.limit?.maximum !== 20) {
    fail("INSTALLED_WAN_T2I_LIST_INPUT_INVALID");
  }
  assertAnnotations(generate, false, true, "INSTALLED_WAN_T2I_GENERATE_ANNOTATIONS_INVALID");
  assertAnnotations(reconcile, true, true, "INSTALLED_WAN_T2I_RECONCILE_ANNOTATIONS_INVALID");
  assertAnnotations(list, true, false, "INSTALLED_WAN_T2I_LIST_ANNOTATIONS_INVALID");
  if (!String(generate.description ?? "").includes("never repeat") || !String(reconcile.description ?? "").includes("GET-only") ||
      !String(list.description ?? "").includes("process-local")) fail("INSTALLED_WAN_T2I_OPERATION_BOUNDARY_INVALID");
  assertRuntimeOutputSemantics(modules.tools);
  return Object.freeze({ tool_count: 3, parameter_cases_checked: cases, schemas_strict: true });
}

function assertRuntimeOutputSemantics(tools) {
  const schema = tools.OWNER_WAN_T2I_TOOL_OUTPUT_SCHEMAS.generate;
  const artifact = { message_object_id: "installed_1", message_id: "installed_msg_1", object_type: "image",
    model_type: MODELS[0], completed: true, url: "https://r2.syntx.ai/wan-installed-check.png", mime_type: "image/png",
    mime_source: "URL_EXTENSION", width: null, height: null, geometry_verified: false };
  const base = { dispatch_allowed: false, backend_acceptance: "UNPROVEN", provider_execution: false, model_id: MODELS[0],
    profile_id: "owner-wan-t2i-source-profile-v1", profile_schema_hash: `sha256:${"a".repeat(64)}`, catalog_version: DEFAULT_VERSION,
    request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`,
    parameters: { aspect_ratio: RATIOS[0], resolution: RESOLUTIONS[0], batch_size: 2, prompt_extend: false, seed: null,
      color_palette: null, bbox_list: [] }, cost_routing: { ai_name: "wan_image", model_type: MODELS[0] }, cost_inputs: { batch_size: 2 },
    cost_input_confidence: "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP",
    source_projection_confidence: "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY",
    requested_batch_size: 2, actual_result_count: 2, provider_terminal_confidence: "UNPROVEN" };
  if (!schema.safeParse({ ...base, status: "result_observed",
    count_confidence: "CURRENT_MESSAGE_MATCHES_EXPLICIT_BATCH_NOT_PROVIDER_TERMINAL", artifacts: [artifact, { ...artifact,
      message_object_id: "installed_2", message_id: "installed_msg_2", url: "https://r2.syntx.ai/wan-installed-check-2.webp",
      mime_type: "image/webp", mime_source: "URL_EXTENSION" }] }).success ||
      !schema.safeParse({ ...base, status: "partial_results", count_confidence: "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL",
        artifacts: [artifact] }).success ||
      schema.safeParse({ ...base, status: "result_observed", count_confidence: "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL",
        artifacts: [artifact] }).success) fail("INSTALLED_WAN_T2I_OUTPUT_SEMANTICS_INVALID");
}

export async function assertInstalledWanT2iImageTools(installedPackagePath, consumerPath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertWanT2iNativePackagePaths(packagedPaths);
    phase = "node-runtime";
    if (process.versions.node !== "24.21.0") fail("INSTALLED_WAN_T2I_NODE24_21_REQUIRED");
    const importPacked = (name) => import(pathToFileURL(join(installedPackagePath, name)).href);
    phase = "module-import";
    let loaded;
    try { loaded = await Promise.all([importPacked("dist/src/index.js"), ...SOURCE_MODULES.map((name) => importPacked(`dist/src/${name}.js`))]); }
    catch { fail("INSTALLED_WAN_T2I_MODULE_IMPORT_FAILED"); }
    const api = loaded[0]; const moduleMap = new Map(SOURCE_MODULES.map((name, index) => [name, loaded[index + 1]]));
    const mod = (name) => moduleMap.get(name);
    const modules = { parameters: mod("application/owner-wan-t2i-parameters"), sourceProfile: mod("application/owner-wan-t2i-source-profile"),
      cost: mod("application/owner-wan-t2i-cost-parameters"), generation: mod("application/owner-wan-t2i-generation-service"),
      preparer: mod("application/owner-wan-t2i-request-preparer"), permit: mod("application/owner-wan-t2i-one-shot-policy"),
      history: mod("application/owner-wan-t2i-history-binding"), result: mod("adapter/syntx/owner-wan-t2i-result"),
      client: mod("adapter/syntx/chat-http-client"), tools: mod("mcp/owner-wan-t2i-tools"), server: mod("mcp/server"),
      runtime: mod("runtime/observed-owner-runtime"), stdio: mod("transports/stdio-owner"), catalog: mod("catalog/selected-discovery-catalog"),
      catalogRepository: mod("catalog/discovery-catalog"), publicCatalog: mod("catalog/syntx-public-catalog"), contract: mod("domain/generation-contract") };
    phase = "public-exports";
    assertWanT2iPublicExports(api, modules);
    phase = "source-contract";
    const version = modules.catalog.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
    const selected = modules.catalog.loadSelectedDiscoveryCatalog(version, join(installedPackagePath, "catalog"));
    const source = assertWanT2iSourceContract(modules.parameters, modules.sourceProfile, modules.cost, selected.discoveryCatalog, version);
    if (version !== DEFAULT_VERSION) fail("INSTALLED_WAN_T2I_SOURCE_PROFILE_INVALID");
    phase = "tool-schemas";
    const enumSet = { phases: modules.generation.OWNER_WAN_T2I_GENERATION_PHASES,
      errorCodes: modules.generation.OWNER_WAN_T2I_GENERATION_ERROR_CODES,
      historyReasons: modules.generation.OWNER_WAN_T2I_GENERATION_HISTORY_REASONS,
      resultReasons: modules.generation.OWNER_WAN_T2I_GENERATION_RESULT_REASONS };
    const toolMap = modules.tools.OWNER_WAN_T2I_TOOL_NAMES.map((name, index) => ({ name,
      inputSchema: jsonSchema(modules.tools.OWNER_WAN_T2I_TOOL_INPUT_SCHEMAS[["generate", "reconcile", "list_recoveries"][index]]),
      outputSchema: jsonSchema(modules.tools.OWNER_WAN_T2I_TOOL_OUTPUT_SCHEMAS[["generate", "reconcile", "list_recoveries"][index]]),
      description: ["Starts one generation; never repeat an unknown POST.", "GET-only reconciliation.", "Lists bounded process-local recovery records."][index],
      annotations: [
        { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
      ][index] }));
    const toolSurface = assertWanT2iToolSurface(toolMap, true, enumSet, modules);
    phase = "declarations";
    assertWanT2iDeclarations(await readFile(join(installedPackagePath, "dist/src/index.d.ts"), "utf8"));
    phase = "flag-reader";
    assertWanT2iFlagReader(modules.stdio);
    phase = "stdio-default";
    const defaultChild = await listInstalledWanT2iTools(installedPackagePath, consumerPath, false, enumSet, modules);
    phase = "stdio-opt-in";
    const optInChild = await listInstalledWanT2iTools(installedPackagePath, consumerPath, true, enumSet, modules);
    phase = "in-process-runtime";
    const positive = await assertWanT2iSyntheticRuntimeCall(modules, consumerPath, version);
    return Object.freeze({ ...source, ...toolSurface, default_tools: defaultChild.tool_count, opt_in_tools: optInChild.tool_count,
      sdk_version: optInChild.sdk_version, node_path: process.execPath,
      default_child_close: defaultChild.child_close, opt_in_child_close: optInChild.child_close,
      default_child_pid_null: defaultChild.child_pid_null, opt_in_child_pid_null: optInChild.child_pid_null,
      default_stderr_bytes: defaultChild.stderr_bytes, opt_in_stderr_bytes: optInChild.stderr_bytes,
      default_network_calls: defaultChild.network_calls, opt_in_network_calls: optInChild.network_calls,
      sdk_operations: Object.freeze(["initialize", "tools/list", "close"]), auth_calls: 0,
      in_process_sdk_operations: Object.freeze(["initialize", "tools/list", "tools/call", "close"]),
      synthetic_preflight_reads: positive.preflight_reads, synthetic_generation_posts: positive.generation_posts,
      synthetic_model_access_reads: positive.model_access_reads,
      source_execution_claimed: false, provider_acceptance_claimed: false });
  } catch (error) {
    if (error instanceof WanT2iImageToolsInstalledCheckError) throw error;
    fail(unexpectedCode(phase, error));
  }
}

async function listInstalledWanT2iTools(installedPackagePath, consumerPath, enabled, enums, modules) {
  const require = createRequire(join(consumerPath, "package.json"));
  let clientPath; let stdioPath;
  try { clientPath = require.resolve("@modelcontextprotocol/sdk/client/index.js"); stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js"); }
  catch { fail("INSTALLED_WAN_T2I_SDK_RESOLUTION_FAILED"); }
  const sdkRoot = join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk");
  let resolvedConsumer; let resolvedSdk; let resolvedClient; let resolvedStdio;
  try { [resolvedConsumer, resolvedSdk, resolvedClient, resolvedStdio] = await Promise.all([
    realpath(consumerPath), realpath(sdkRoot), realpath(clientPath), realpath(stdioPath)]); }
  catch { fail("INSTALLED_WAN_T2I_SDK_RESOLUTION_FAILED"); }
  assertConsumerSdkResolution({ consumerPath, resolvedConsumer, sdkRoot, resolvedSdk, resolvedClient, resolvedStdio, projectRoot: PROJECT_ROOT });
  let manifest;
  try { manifest = JSON.parse(await readFile(join(resolvedSdk, "package.json"), "utf8")); }
  catch { fail("INSTALLED_WAN_T2I_SDK_MANIFEST_INVALID"); }
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest?.version !== "1.32.1") fail("INSTALLED_WAN_T2I_SDK_VERSION_MISMATCH");
  const [{ Client }, { StdioClientTransport }] = await Promise.all([import(pathToFileURL(clientPath).href), import(pathToFileURL(stdioPath).href)]);
  const auditDir = await mkdtemp(join(tmpdir(), "wan-t2i-fetch-audit-"));
  const auditFile = join(auditDir, "count"); const preload = join(auditDir, "network-audit.mjs");
  await writeFile(preload, `import { writeFileSync } from 'node:fs'; let count=0; globalThis.fetch=(...args)=>{ count++; return Promise.reject(new Error('NETWORK_DISABLED')); }; process.on('exit',()=>{ try { writeFileSync(process.env.SYNTX_WAN_T2I_NETWORK_AUDIT, String(count)); } catch {} });\n`, { mode: 0o600 });
  const client = new Client({ name: enabled ? "syntx-wan-t2i-opt-in" : "syntx-wan-t2i-default", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(installedPackagePath, "dist/src/transports/stdio-owner.js")], cwd: consumerPath,
    env: { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: auditDir, XDG_DATA_HOME: auditDir,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, SYNTX_WAN_T2I_NETWORK_AUDIT: auditFile,
      ...(enabled ? { SYNTX_OWNER_WAN_T2I_IMAGE: "1" } : {}) }, stderr: "pipe" });
  let closeObserved = false; let resolveClose;
  const closed = new Promise((resolvePromise) => { resolveClose = resolvePromise; });
  const priorClose = transport.onclose;
  transport.onclose = () => { closeObserved = true; try { priorClose?.(); } finally { resolveClose(); } };
  let stderrBytes = 0; transport.stderr?.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
  let connected = false; let failure; let surface;
  try {
    await withDeadline(client.connect(transport), 5_500, "INSTALLED_WAN_T2I_STDIO_INITIALIZE_TIMEOUT"); connected = true;
    if (!Number.isSafeInteger(transport.pid) || transport.pid <= 0) fail("INSTALLED_WAN_T2I_STDIO_PID_INVALID");
    const response = await withDeadline(client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }), 5_500,
      "INSTALLED_WAN_T2I_TOOLS_LIST_TIMEOUT");
    surface = assertWanT2iListedSurface(response.tools, enabled, enums, modules);
  } catch (error) { failure = error; }
  finally {
    try { await withDeadline(connected ? client.close() : transport.close(), 2_000, "INSTALLED_WAN_T2I_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new WanT2iImageToolsInstalledCheckError("INSTALLED_WAN_T2I_STDIO_CLOSE_FAILED"); }
    try { await withDeadline(closed, 2_000, "INSTALLED_WAN_T2I_STDIO_CLOSE_FAILED"); }
    catch { failure ??= new WanT2iImageToolsInstalledCheckError("INSTALLED_WAN_T2I_STDIO_CLOSE_FAILED"); }
    if (!closeObserved || transport.pid !== null) failure ??= new WanT2iImageToolsInstalledCheckError("INSTALLED_WAN_T2I_STDIO_CLOSE_FAILED");
  }
  try {
    if (failure) throw failure;
    if (stderrBytes !== 0) fail("INSTALLED_WAN_T2I_STDIO_STDERR_NOT_EMPTY");
    const networkCalls = Number(await readFile(auditFile, "utf8"));
    if (networkCalls !== 0) fail("INSTALLED_WAN_T2I_NETWORK_CALLS_DETECTED");
    return Object.freeze({ ...surface, child_close: "CLOSED", child_pid_null: true, stderr_bytes: stderrBytes,
      network_calls: networkCalls, sdk_version: manifest.version });
  } finally { await rm(auditDir, { recursive: true, force: true }); }
}

export function assertWanT2iListedSurface(tools, enabled, enums, modules) {
  if (!Array.isArray(tools)) fail("INSTALLED_WAN_T2I_TOOL_LIST_INVALID");
  const selected = tools.filter((tool) => TOOL_NAMES.includes(tool?.name));
  if (!enabled) { if (selected.length) fail("INSTALLED_WAN_T2I_DEFAULT_OFF_FAILED"); return Object.freeze({ tool_count: 0 }); }
  if (!sameArray(selected.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort())) fail("INSTALLED_WAN_T2I_TOOL_SET_MISMATCH");
  return assertWanT2iToolSurface(tools, true, enums, modules);
}

export async function assertWanT2iSyntheticRuntimeCall(modules, consumerPath, catalogVersion, fixture = {}) {
  const nowMs = fixture.nowMs ?? Date.now();
  const subscriptionEndDate = fixture.subscriptionEndDate ?? new Date(nowMs + 24 * 60 * 60_000).toISOString();
  if (!Number.isSafeInteger(nowMs) || typeof subscriptionEndDate !== "string" || !Number.isFinite(Date.parse(subscriptionEndDate))) {
    fail("INSTALLED_WAN_T2I_SYNTHETIC_FIXTURE_INVALID");
  }
  const require = createRequire(join(consumerPath, "package.json"));
  const sdkClient = require.resolve("@modelcontextprotocol/sdk/client/index.js");
  const sdkInMemory = require.resolve("@modelcontextprotocol/sdk/inMemory.js");
  const [{ Client }, { InMemoryTransport }] = await Promise.all([import(pathToFileURL(sdkClient).href), import(pathToFileURL(sdkInMemory).href)]);
  const events = []; const jobs = new Map(); let postCount = 0; let preflightCount = 0; let subscriptionReads = 0;
  const fetchImpl = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); const method = init?.method ?? "GET";
    let body; if (typeof init?.body === "string") body = JSON.parse(init.body);
    events.push({ url, method, body });
    if (url.pathname === "/api/v1/user/balance") { preflightCount += 1; return Response.json({ balance: "100" }); }
    if (url.pathname === "/api/v1/user/subscription") { subscriptionReads += 1; return Response.json({ active: true, type: "PRO", end_date: subscriptionEndDate }); }
    if (url.pathname === "/api/v2/get_model_info") { return Response.json({ access: true, cost: 2, discount_cost: null,
      free_remaining_generations: null, limit: 1, show_warning: false }); }
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: "wan-installed-check-chat-1" });
    if (url.pathname === "/api/v1/design/generate" && method === "POST") {
      postCount += 1; const ack = "wan-installed-check-ack-1"; const bot = "wan-installed-check-bot-1";
      jobs.set(body.chat_uuid, { ack, bot, model: body.settings.model_type }); return Response.json({ id: ack });
    }
    if (url.pathname === "/api/v1/chats/wan-installed-check-chat-1/messages") {
      const job = jobs.get("wan-installed-check-chat-1");
      return Response.json({ messages: [
        { id: job.ack, chat_id: 9001, author_id: 42, message_object: [] },
        { id: job.bot, chat_id: 9001, author_id: -1, message_object: [{ id: "wan-check-object-1", message_id: job.bot,
          object_type: "image", model_type: job.model }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === "/api/v1/chats/wan-installed-check-chat-1/wan-installed-check-bot-1") {
      const job = jobs.get("wan-installed-check-chat-1");
      return Response.json({ id: job.bot, chat_id: 9001, author_id: -1, message_object: [{ id: "wan-check-object-1",
        message_id: job.bot, object_type: "image", model_type: job.model, completed: true,
        object_url: "https://r2.syntx.ai/wan-installed-check.png" }] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const runtime = modules.runtime.createObservedOwnerRuntime({ ownerWanT2iImageEnabled: true, fetchImpl,
    publicCatalogVersion: catalogVersion, requestTimeoutMs: 3_000, now: () => nowMs });
  const attemptId = "link_wan_t2i_installed_check_000001";
  const binding = runtime.authBinding; const store = runtime.authStore;
  await store.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: nowMs + 60_000 });
  await store.beginHandoff(binding, attemptId); await store.attachChallenge(binding, attemptId, "synthetic-wan-t2i-install-check");
  await store.beginPoll(binding, attemptId); await store.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-runtime-credential" });
  const composition = runtime.serverOptions.ownerWanT2iImageReferences;
  if (!composition) fail("INSTALLED_WAN_T2I_RUNTIME_COMPOSITION_MISSING");
  const server = modules.server.createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "wan-t2i-installed-inprocess-check", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const listed = await client.listTools(); assertWanT2iListedSurface(listed.tools, true,
      { phases: modules.generation.OWNER_WAN_T2I_GENERATION_PHASES,
        errorCodes: modules.generation.OWNER_WAN_T2I_GENERATION_ERROR_CODES,
        historyReasons: modules.generation.OWNER_WAN_T2I_GENERATION_HISTORY_REASONS,
        resultReasons: modules.generation.OWNER_WAN_T2I_GENERATION_RESULT_REASONS }, modules);
    const response = await client.callTool({ name: TOOL_NAMES[0], arguments: { link_attempt_id: attemptId, model_id: MODELS[0],
      prompt: "Installed package synthetic validation", parameters: { aspect_ratio: "1:1", resolution: "720P", batch_size: 1,
        prompt_extend: false, seed: null, color_palette: null, bbox_list: [] } } }, undefined,
      { timeout: 8_000, maxTotalTimeout: 8_000 });
    if (response.isError === true || response.structuredContent?.status !== "result_observed" ||
        response.structuredContent?.backend_acceptance !== "UNPROVEN" || response.structuredContent?.provider_execution !== false ||
        response.structuredContent?.artifacts?.length !== 1 || postCount !== 1 || preflightCount !== 2 || subscriptionReads !== 2 ||
        events.filter(({ url }) => url.pathname === "/api/v2/get_model_info").length !== 2 ||
        events.filter(({ url, method }) => url.pathname === "/api/v1/design/generate" && method === "POST").length !== 1) {
      fail("INSTALLED_WAN_T2I_SYNTHETIC_RUNTIME_CALL_INVALID");
    }
    return Object.freeze({ preflight_reads: preflightCount + subscriptionReads, model_access_reads: 2, generation_posts: postCount });
  } catch (error) { if (error instanceof WanT2iImageToolsInstalledCheckError) throw error; fail("INSTALLED_WAN_T2I_SYNTHETIC_RUNTIME_CALL_INVALID"); }
  finally { await Promise.allSettled([client.close(), server.close()]); await composition.generationService.close(); }
}

function assertExactObject(schema, required, optional, code) {
  if (!isRecord(schema) || schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(schema.properties ?? {}).sort(), [...required, ...optional].sort()) ||
      !sameArray([...(schema.required ?? [])].sort(), [...required].sort())) fail(code);
}
function assertAllObjectsStrict(schema, code, seen = new Set()) {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return;
  seen.add(schema); if (schema.type === "object" && schema.additionalProperties !== false) fail(code);
  for (const value of Object.values(schema)) if (Array.isArray(value)) value.forEach((item) => assertAllObjectsStrict(item, code, seen));
    else assertAllObjectsStrict(value, code, seen);
}
function assertAnnotations(tool, readOnly, openWorld, code) {
  if (tool.annotations?.readOnlyHint !== readOnly || tool.annotations?.destructiveHint !== !readOnly ||
      tool.annotations?.idempotentHint !== readOnly || tool.annotations?.openWorldHint !== openWorld) fail(code);
}
function hasAnyKey(schema, forbidden, seen = new Set()) {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return false;
  seen.add(schema);
  if (schema.type === "object" && forbidden.some((key) => Object.hasOwn(schema.properties ?? {}, key))) return true;
  return Object.values(schema).some((value) => Array.isArray(value) ? value.some((item) => hasAnyKey(item, forbidden, seen)) : hasAnyKey(value, forbidden, seen));
}
function assertConsumerSdkResolution({ consumerPath, resolvedConsumer, sdkRoot, resolvedSdk, resolvedClient, resolvedStdio, projectRoot }) {
  const paths = [consumerPath, resolvedConsumer, sdkRoot, resolvedSdk, resolvedClient, resolvedStdio, projectRoot];
  if (!paths.every((path) => typeof path === "string" && isAbsolute(path)) ||
      resolve(sdkRoot) !== join(resolve(consumerPath), "node_modules", "@modelcontextprotocol", "sdk") ||
      !isWithin(resolvedConsumer, resolvedSdk) || isWithin(projectRoot, resolvedSdk) ||
      !isWithin(resolvedSdk, resolvedClient) || !isWithin(resolvedSdk, resolvedStdio)) fail("INSTALLED_WAN_T2I_SDK_NOT_FROM_CONSUMER");
  return true;
}
function isWithin(root, candidate) { const rel = relative(resolve(root), resolve(candidate)); return rel === "" ||
  (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); }
function nullableEnum(schema) { return schema?.enum ?? schema?.anyOf?.find((branch) => Array.isArray(branch?.enum))?.enum; }
function withDeadline(promise, ms, code) { let timer; const timeout = new Promise((_resolve, reject) => {
  timer = setTimeout(() => reject(new WanT2iImageToolsInstalledCheckError(code)), ms); timer.unref?.();
}); return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)); }
function jsonSchema(schema) { return z.toJSONSchema(schema); }
function sameArray(actual, expected) { return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((value, index) => value === expected[index]); }
function sameJson(actual, expected) { try { return JSON.stringify(actual) === JSON.stringify(expected); } catch { return false; } }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function expectReject(operation) { let rejected = false; try { operation(); } catch { rejected = true; } if (!rejected) fail("INSTALLED_WAN_T2I_NEGATIVE_MATRIX_INVALID"); }
function unexpectedCode(phase, error) {
  if (!PHASE_NAMES.includes(phase)) fail("INSTALLED_WAN_T2I_DIAGNOSTIC_PHASE_INVALID");
  const name = error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" :
    error instanceof SyntaxError ? "SyntaxError" : error instanceof Error ? "Error" : "NonError";
  return `INSTALLED_WAN_T2I_UNEXPECTED_${phase}_${name}`;
}
function fail(code) { throw new WanT2iImageToolsInstalledCheckError(code); }
