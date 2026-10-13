import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as checker from "../scripts/check-installed-suno-generation-flow.mjs";

const MODELS = ["V6", "V6_wild"];
const TOOL_NAMES = ["syntx_get_suno_generate_parameters", "syntx_owner_generate_suno_audio",
  "syntx_owner_reconcile_suno_audio", "syntx_owner_list_suno_recoveries", "syntx_owner_get_suno_result_page"];

test("installed Suno checker requires the exact compiled generation modules and pinned source archives", () => {
  assert.ok(checker.SUNO_GENERATION_REQUIRED_PACKAGE_PATHS.includes("dist/src/index.js"));
  assert.ok(checker.SUNO_GENERATION_REQUIRED_PACKAGE_PATHS.includes("dist/src/mcp/owner-suno-generation-tools.js"));
  assert.ok(checker.SUNO_GENERATION_REQUIRED_PACKAGE_PATHS.includes("dist/src/application/owner-suno-generation-service.js"));
  assert.ok(checker.SUNO_GENERATION_REQUIRED_PACKAGE_PATHS.includes("catalog/public/sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json"));
  assert.ok(checker.SUNO_GENERATION_REQUIRED_PACKAGE_PATHS.includes("catalog/settings/v2/sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json"));
  assert.equal(checker.assertSunoGenerationPackagePaths(new Set(checker.SUNO_GENERATION_REQUIRED_PACKAGE_PATHS)), true);
  assert.throws(() => checker.assertSunoGenerationPackagePaths(new Set()), (error) => error.code === "INSTALLED_SUNO_GENERATION_PACKAGE_CONTENT_MISSING");
});

test("installed Suno owner tools are default-off and opt in exactly five actions", () => {
  assert.deepEqual(checker.assertSunoGenerationToolNames([], false), { tool_count: 0 });
  assert.throws(() => checker.assertSunoGenerationToolNames([{ name: TOOL_NAMES[0] }], false),
    (error) => error.code === "INSTALLED_SUNO_GENERATION_DEFAULT_OFF_FAILED");
  assert.deepEqual(checker.assertSunoGenerationToolNames(TOOL_NAMES.map((name) => ({ name })), true), { tool_count: 5 });
  assert.throws(() => checker.assertSunoGenerationToolNames([...TOOL_NAMES.map((name) => ({ name })), { name: TOOL_NAMES[0] }], true),
    (error) => error.code === "INSTALLED_SUNO_GENERATION_TOOL_SET_MISMATCH");
});

test("installed Suno strict flag parser accepts only unset, empty, zero, or one", () => {
  const reader = (value) => {
    if (value === undefined || value === "" || value === "0") return false;
    if (value === "1") return true;
    throw new Error("invalid flag");
  };
  assert.equal(checker.assertSunoGenerationFlagReader({ readOwnerSunoGenerationFlag: reader }), true);
});

test("installed Suno surface requires exact schemas and checks all eight model/mode-flag combinations", () => {
  const params = { safeParse(value) { return { success: value?.runtime_usable === false && value?.dispatch_allowed === false && value?.backend_acceptance === "UNPROVEN", data: value }; } };
  const inputs = { generate: { safeParse(value) {
    const expectedKeys = ["link_attempt_id", "model_id", "mode", "prompt", "is_custom_mode", "is_instrumental", "negative_tags", "styles", "title"];
    if (!value || !MODELS.includes(value.model_id) || value.mode !== "generate" || typeof value.is_custom_mode !== "boolean" ||
        typeof value.is_instrumental !== "boolean" || typeof value.prompt !== "string" || !isWellFormed(value.prompt) || typeof value.title !== "string" ||
        typeof value.styles !== "string" || typeof value.negative_tags !== "string" ||
        !assertExactKeysForFixture(value, expectedKeys)) return { success: false };
    const promptLimit = value.is_custom_mode ? 5_000 : 500;
    return { success: value.prompt.trim().length > 0 && value.prompt.length <= promptLimit && value.styles.length <= 1_000 &&
      value.title.length <= 80 && value.negative_tags.length <= 5_000 };
  } } };
  const outputs = { parameters: params, generate: { safeParse() { return { success: true }; } } };
  const modules = { parameters: { getOwnerSunoGenerationParameterSource() { return { runtime_usable: false,
    dispatch_allowed: false, backend_acceptance: "UNPROVEN", model_ids: MODELS,
    status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT", effective_defaults: "UNKNOWN",
    models: Object.fromEntries(MODELS.map((model_id) => [model_id, { model_id, ai_name: "suno", active: true, defaults_status: "UNKNOWN",
      model_value_settings_keys: ["is_custom_mode", "is_instrumental", "model_type", "negative_tags", "styles", "title"],
      payload_field_keys: ["model_type"] }])),
    cost_projection: { declared_cost_query_keys: ["version"], generation_value_mapping: "UNPROVEN_NOT_INCLUDED_IN_GENERATE_SETTINGS" },
    controls: { prompt: { measure: "UTF16_CODE_UNITS", simple_max: 500, custom_max: 5_000, effective_default: "UNKNOWN",
      nonblank_policy: "LOCAL_VALIDATION_POLICY_NOT_UI_VALIDATOR" },
      negative_tags: { local_max: 5_000, measure: "UTF16_CODE_UNITS", bound_label: "LOCAL_RESOURCE_BOUND_NOT_UI_LIMIT", source_ui_limit: "UNKNOWN" },
      styles: { max: 1_000 }, title: { max: 80 } },
    source_pins: { public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
      settings_inventory_version: "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
      form_sha256: "sha256:3b4eb9ade783591aaf8087289e29f09c06ee8d54be827395e9d19613c62574b3", form_module: "suno.js", form_bytes: 44_975 } }; } },
    tools: { OWNER_SUNO_GENERATION_TOOL_INPUT_SCHEMAS: inputs, OWNER_SUNO_GENERATION_TOOL_OUTPUT_SCHEMAS: outputs } };
  const schemas = TOOL_NAMES.map((name, index) => ({ name, inputSchema: closedInput(index), outputSchema: closedOutput(index),
    annotations: index === 1 ? { destructiveHint: true } : { readOnlyHint: true,
      ...(index === 2 || index === 4 ? { idempotentHint: true } : {}) } }));
  assert.equal(checker.assertSunoGenerationToolSurface(schemas, true, modules).mode_flag_cases, 8);
  assert.throws(() => checker.assertSunoGenerationToolSurface(schemas.slice(0, 4), true, modules),
    (error) => error.code === "INSTALLED_SUNO_GENERATION_TOOL_SET_MISMATCH");

  function closedInput(index) {
    const keys = index === 0 ? [] : index === 1 ? ["link_attempt_id", "model_id", "mode", "prompt", "is_custom_mode", "is_instrumental", "negative_tags", "styles", "title"] :
      index === 2 || index === 4 ? ["link_attempt_id", "recovery_id"] : ["link_attempt_id"];
    const properties = Object.fromEntries([...keys, ...(index === 3 ? ["limit"] : index === 4 ? ["offset"] : [])].map((key) => [key, {}]));
    if (index === 1) {
      properties.model_id = { enum: MODELS };
      properties.mode = { const: "generate" };
      properties.negative_tags = { maxLength: 5_000 };
      properties.styles = { maxLength: 1_000 };
      properties.title = { maxLength: 80 };
    }
    return { type: "object", properties, required: keys,
      additionalProperties: false, ...(index === 1 ? { oneOf: [false, true].map((custom) => ({ type: "object", properties: {
        ...properties, is_custom_mode: { const: custom }, prompt: { maxLength: custom ? 5_000 : 500 }
      }, required: keys, additionalProperties: false })) } : {}) };
  }
  function closedOutput(index) {
    const keys = index === 0 ? ["status", "source_pins", "model_ids", "models", "controls", "cost_projection", "effective_defaults", "runtime_usable", "dispatch_allowed", "backend_acceptance"] :
      index === 3 ? ["recoveries"] : ["status", "status_semantics", "backend_acceptance", "provider_terminal_status", "model_id", "parameters", "source_binding", "cost_inputs", "cost_input_confidence", "recovery_id", "observed_artifact_count", "offset", "page_size", "artifacts", "has_more", "next_offset", "diagnostic"];
    return { type: "object", properties: Object.fromEntries(keys.map((key) => [key, {}])), required: keys, additionalProperties: false };
  }
  function assertExactKeysForFixture(value, expected) {
    return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
  }
});

test("Suno validator checks UTF-16 prompt bounds and exact title/style/local-tag boundaries", () => {
  const schema = { safeParse(value) {
    const promptMax = value?.is_custom_mode ? 5_000 : 500;
    const expected = ["link_attempt_id", "model_id", "mode", "prompt", "is_custom_mode", "is_instrumental", "negative_tags", "styles", "title"];
    return { success: Object.keys(value ?? {}).length === expected.length && expected.every((key) => Object.hasOwn(value ?? {}, key)) &&
      MODELS.includes(value?.model_id) && value?.mode === "generate" && typeof value?.is_custom_mode === "boolean" &&
      typeof value?.is_instrumental === "boolean" && typeof value?.prompt === "string" && value.prompt.length <= promptMax &&
      value.prompt.trim().length > 0 && value.prompt.length > 0 && isWellFormed(value.prompt) && typeof value?.styles === "string" && value.styles.length <= 1_000 &&
      typeof value?.title === "string" && value.title.length <= 80 && typeof value?.negative_tags === "string" && value.negative_tags.length <= 5_000 }; } };
  assert.equal(checker.assertSunoGenerationParameterMatrix(schema), 8);
});

test("installed result output schema must preserve every native history/audio diagnostic gap code", () => {
  assert.equal(checker.assertSunoGenerationDiagnosticGapCoverage({ safeParse() { return { success: true }; } }), 36);
  assert.throws(() => checker.assertSunoGenerationDiagnosticGapCoverage({ safeParse(value) {
    return { success: value?.diagnostic?.gaps?.[0] !== "UNRECOGNIZED_MESSAGE_FIELDS" };
  } }), (error) => error.code === "INSTALLED_SUNO_GENERATION_OUTPUT_GAP_DTO_SCHEMA_INVALID");
});

test("installed Suno public API permits DTOs and blocks preparer, permit, and native-context exports", () => {
  const parameterApi = { OWNER_SUNO_GENERATION_MODEL_IDS: MODELS,
    OWNER_SUNO_GENERATION_PUBLIC_VERSION: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
    OWNER_SUNO_GENERATION_SETTINGS_VERSION: "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
    getOwnerSunoGenerationParameterSource() {}, normalizeOwnerSunoGenerationParameters() {},
    OwnerSunoGenerationParametersError: class {} };
  const toolApi = { OWNER_SUNO_GENERATION_TOOL_NAMES: TOOL_NAMES, OWNER_SUNO_GENERATION_TOOL_INPUT_SCHEMAS: {},
    OWNER_SUNO_GENERATION_TOOL_OUTPUT_SCHEMAS: {}, registerSyntxOwnerSunoGenerationTools() {},
    SYNTX_GET_SUNO_GENERATE_PARAMETERS_TOOL_NAME: TOOL_NAMES[0], SYNTX_OWNER_GENERATE_SUNO_AUDIO_TOOL_NAME: TOOL_NAMES[1],
    SYNTX_OWNER_RECONCILE_SUNO_AUDIO_TOOL_NAME: TOOL_NAMES[2], SYNTX_OWNER_LIST_SUNO_RECOVERIES_TOOL_NAME: TOOL_NAMES[3],
    SYNTX_OWNER_GET_SUNO_RESULT_PAGE_TOOL_NAME: TOOL_NAMES[4] };
  const service = { OwnerSunoGenerationServiceError: class {} };
  const server = { createMcpServer() {} }, runtime = { createObservedOwnerRuntime() {} };
  const groups = { parameters: parameterApi, tools: toolApi, service, server, runtime };
  const api = { ...parameterApi, ...toolApi, ...service, ...server, ...runtime };
  assert.equal(checker.assertSunoGenerationPublicExports(api, groups), true);
  assert.throws(() => checker.assertSunoGenerationPublicExports({ ...api, OwnerSunoGenerationOneShotPermit: class {} }, groups),
    (error) => error.code === "INSTALLED_SUNO_GENERATION_PRIVATE_EXPORT_LEAK");
});

test("Suno installed summary requires measured SDK, paging, safety, and non-acceptance fields", () => {
  const proof = {
    status: "INSTALLED_STOCK_SDK_SUNO_GENERATION_CALLTOOL_PASS", node_version: "24.21.0", sdk_version: "1.32.1", clean_installed_package: true,
    default_tools: 0, opt_in_tools: 5, model_branches_checked: 2, mode_flag_cases: 8, parameter_schema_cases: 8,
    generation_posts: 13, result_messages: 14, artifacts_seen: 89, pending_zero_ready_recoveries: 1,
    object_incomplete_gap_preserved: true, page_reads: 1, page_size: 64, page_observations: 80,
    page_io_delta: 0, unknown_recoveries: 1, recovery_get_only_after_16m: true, saturated_history_get_calls: 255, replay_posts: 0,
    revoke_drain: "PASS", eof_drain: "PASS", foreign_attempt_denied: true, same_binding_new_link_denied: true,
    cached_url_denied_after_revoke: true, diagnostic_counters_saturated: true, auth_cleanup: "PASS",
    default_child_close: "CLOSED", opt_in_child_close: "CLOSED", default_child_pid_null: true, opt_in_child_pid_null: true,
    default_stderr_bytes: 0, opt_in_stderr_bytes: 0, default_network_calls: 0, opt_in_network_calls: 0,
    authenticated_network_calls: 0, billing_calls: 0, private_request_text_exposed: false, private_classes_exported: false,
    source_public_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
    source_settings_version: "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
    cost_projection: "MODEL_ID_LOCAL_NOT_UI_QUOTE", runtime_usable: false, dispatch_allowed: false,
    backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN"
  };
  const summary = checker.formatSunoGenerationInstalledSummary(proof);
  for (const field of ["default_tools=0", "opt_in_tools=5", "mode_flag_cases=8", "page_observations=80", "page_io_delta=0",
    "pending_zero_ready_recoveries=1", "object_incomplete_gap_preserved=true", "recovery_get_only_after_16m=true",
    "replay_posts=0", "foreign_attempt_denied=true", "counters_saturated=true",
    "runtime_usable=false", "backend_acceptance=UNPROVEN"]) assert.ok(summary.includes(field), field);
  assert.throws(() => checker.formatSunoGenerationInstalledSummary({ ...proof, diagnostic_counters_saturated: false }),
    (error) => error.code === "INSTALLED_SUNO_GENERATION_SUMMARY_INVALID");
});

test("package smoke requires installed Suno generation proof and formats the measured receipt", async () => {
  const source = await readFile(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("assertInstalledSunoGenerationFlow"), true);
  assert.equal(source.includes("formatSunoGenerationInstalledSummary"), true);
  assert.equal(source.includes("${installedSunoGenerationFlow}"), true);
});

function isWellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
