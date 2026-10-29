import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/application/owner-suno-track-operation-parameters.js", import.meta.url).href;
const parameterModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
type Normalize = (input: unknown) => Record<string, any>;

function normalize(input: unknown): Record<string, any> {
  assert.ok(parameterModule, "MISSING_OWNER_SUNO_TRACK_OPERATION_PARAMETERS_MODULE");
  assert.equal(typeof parameterModule.normalizeOwnerSunoTrackOperationParameters, "function");
  return (parameterModule.normalizeOwnerSunoTrackOperationParameters as Normalize)(input);
}

function explicitInput(mode: "cover" | "extend" = "cover", overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    model_id: "V6",
    mode,
    track_handle: "track_00000000-0000-4000-8000-000000000001",
    prompt: "A sparse instrumental variation",
    is_custom_mode: false,
    is_instrumental: false,
    negative_tags: "",
    styles: "",
    title: "",
    ...(mode === "extend" ? { continue_at: 12.3 } : {})
  };
  return { ...base, ...overrides };
}

test("reports exact current cover/extend pins and source limits without enabling dispatch", () => {
  assert.ok(parameterModule, "MISSING_OWNER_SUNO_TRACK_OPERATION_PARAMETERS_MODULE");
  assert.equal(typeof parameterModule.getOwnerSunoTrackOperationParameterSource, "function");
  const source = (parameterModule.getOwnerSunoTrackOperationParameterSource as () => Record<string, any>)();

  assert.equal(source.profile_id, "owner-suno-track-operation-parameters-source-v1");
  assert.deepEqual(source.model_ids, ["V6", "V6_wild"]);
  assert.deepEqual(source.modes, ["cover", "extend"]);
  assert.equal(source.source_pins.form.build_id, "1791904852");
  assert.equal(source.source_pins.form.bytes, 44_975);
  assert.equal(source.source_pins.form.sha256,
    "sha256:23d8a074cb2a4579f52671a0dc4fe8a99ec7bbae925bfd5f5f0e8d4db5e6effa");
  assert.deepEqual(source.current_ui_admission, {
    status: "CURRENT_FORM_TRACK_OPERATION_ADMISSION_NOT_PROVIDER_POLICY",
    source_build_id: "1793202992",
    form: { module: "suno.js", bytes: 44_529, sha256: "sha256:7861b84e849dafd787bd484dd99b1dd6383d115d1398071b853fc6ee2bd609ae" },
    model_ids: ["V6", "V6_wild"],
    modes: ["cover", "extend"],
    is_instrumental: { allowed_values: [false], policy_reason: "TRACK_MODES_RESET_FALSE_AND_CONTROL_HAS_NO_TRUE_BINDING" }
  });
  assert.deepEqual(source.cost_projection.query_keys, ["ai_name", "model_type"]);
  assert.equal(source.cost_projection.model_type_source, "settings_candidate.model_type");
  assert.deepEqual(source.controls.continue_at, {
    measure: "SECONDS",
    minimum: 0,
    step: 0.1,
    maximum: "SOURCE_DURATION_NOT_AVAILABLE_TO_SERVICE",
    ui_default: 0
  });
  assert.equal(source.runtime_usable, false);
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
});

test("normalizes cover without caller clip/task IDs or continuation", () => {
  const result = normalize(explicitInput("cover", { model_id: "V6_wild", is_custom_mode: true, styles: "ambient" }));
  assert.equal(result.mode, "cover");
  assert.equal(result.model_id, "V6_wild");
  assert.equal(result.track_handle, "track_00000000-0000-4000-8000-000000000001");
  assert.equal("continue_at" in result.settings_candidate, false);
  assert.equal("source_clip_id" in result.settings_candidate, false);
  assert.equal("source_task_id" in result.settings_candidate, false);
  assert.deepEqual(result.cost_parameters, {});
});

test("normalizes extend continuation as explicit seconds on the UI tenth-second step", () => {
  const result = normalize(explicitInput("extend", { continue_at: 12.3 }));
  assert.equal(result.settings_candidate.mode, "extend");
  assert.equal(result.settings_candidate.continue_at, 12.3);
  assert.equal(result.continuation_measure, "SECONDS");
});

test("rejects instrumental track-operation intents for both modes and models", () => {
  for (const model_id of ["V6", "V6_wild"] as const) {
    for (const mode of ["cover", "extend"] as const) {
      assert.throws(() => normalize(explicitInput(mode, { model_id, is_custom_mode: true, is_instrumental: true })), isInvalidParameters,
        `${model_id}/${mode}`);
      const accepted = normalize(explicitInput(mode, { model_id, is_custom_mode: true, is_instrumental: false }));
      assert.equal(accepted.settings_candidate.is_custom_mode, true, `${model_id}/${mode} custom-mode scope remains independent`);
      assert.equal(accepted.settings_candidate.is_instrumental, false, `${model_id}/${mode}`);
    }
  }
});

test("rejects invalid mode-specific fields, raw IDs, unknown keys, and unsafe continuation values", () => {
  const invalid = [
    explicitInput("cover", { continue_at: 0 }),
    explicitInput("extend", { continue_at: undefined }),
    explicitInput("extend", { continue_at: -0.1 }),
    explicitInput("extend", { continue_at: 1.25 }),
    explicitInput("extend", { continue_at: Number.POSITIVE_INFINITY }),
    explicitInput("cover", { source_clip_id: "raw-clip" }),
    explicitInput("extend", { source_task_id: "raw-task" }),
    explicitInput("cover", { file_urls: [] }),
    explicitInput("cover", { mode: "generate" }),
    explicitInput("cover", { model_id: "V4" }),
    explicitInput("cover", { track_handle: "raw-clip" }),
    explicitInput("cover", { is_custom_mode: 1 })
  ];
  for (const input of invalid) assert.throws(() => normalize(input), isInvalidParameters);
});

test("preserves caller input and deep-freezes the normalized projection", () => {
  const input = explicitInput("extend", { prompt: " preserve spaces ", continue_at: 0 });
  const before = structuredClone(input);
  const result = normalize(input);
  assert.deepEqual(input, before);
  assert.equal(result.prompt, " preserve spaces ");
  assert.throws(() => { result.settings_candidate.title = "mutated"; }, TypeError);
  assert.equal(result.settings_candidate.title, "");
});

function isInvalidParameters(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "INVALID_PARAMETERS";
}
