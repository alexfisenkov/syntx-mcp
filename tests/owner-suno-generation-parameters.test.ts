import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const MODULE_URL = new URL("../src/application/owner-suno-generation-parameters.js", import.meta.url).href;
const parameterModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const PUBLIC_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const SETTINGS_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json";
const MODEL_IDS = ["V6", "V6_wild"] as const;

type Normalize = (input: unknown) => Record<string, any>;

function normalize(input: unknown): Record<string, any> {
  assert.ok(parameterModule, "MISSING_OWNER_SUNO_GENERATION_PARAMETERS_MODULE");
  assert.equal(typeof parameterModule.normalizeOwnerSunoGenerationParameters, "function");
  return (parameterModule.normalizeOwnerSunoGenerationParameters as Normalize)(input);
}

function explicitInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model_id: "V6",
    mode: "generate",
    prompt: "A bright, sparse instrumental loop",
    is_custom_mode: false,
    is_instrumental: false,
    negative_tags: "",
    styles: "",
    title: "",
    ...overrides
  };
}

test("reports source-pinned active Suno generate coverage without promoting runtime use", () => {
  assert.ok(parameterModule, "MISSING_OWNER_SUNO_GENERATION_PARAMETERS_MODULE");
  assert.equal(typeof parameterModule.getOwnerSunoGenerationParameterSource, "function");
  const source = (parameterModule.getOwnerSunoGenerationParameterSource as () => Record<string, any>)();
  const catalog = loadPublicCatalogVersion(PUBLIC_VERSION, join(process.cwd(), "catalog"));
  const inventory = loadMaplessSettingsInventoryVersion(SETTINGS_VERSION, join(process.cwd(), "catalog"));

  assert.equal(source.profile_id, "owner-suno-generate-parameters-source-v1");
  assert.deepEqual(source.model_ids, MODEL_IDS);
  assert.equal(source.source_pins.public_catalog_version, PUBLIC_VERSION);
  assert.equal(source.source_pins.settings_inventory_version, SETTINGS_VERSION);
  assert.equal(source.source_pins.build_id, "1791811899");
  assert.equal(source.source_pins.form_module, "suno.js");
  assert.equal(source.source_pins.form_bytes, 44975);
  assert.equal(source.source_pins.form_sha256,
    "sha256:3b4eb9ade783591aaf8087289e29f09c06ee8d54be827395e9d19613c62574b3");

  for (const modelId of MODEL_IDS) {
    const publicModel = catalog.models.find((model) => model.value === modelId);
    const settingsModel = inventory.models.find((model) => model.model_id === modelId);
    const profileModel = source.models[modelId] as Record<string, any>;
    assert.ok(publicModel);
    assert.ok(settingsModel);
    assert.equal(publicModel.ai_name, "suno");
    assert.equal(publicModel.active, true);
    assert.equal(settingsModel.ai_name, "suno");
    assert.equal(settingsModel.active, true);
    assert.equal(settingsModel.form_id, "suno");
    assert.equal(settingsModel.settings_status, "PUBLIC_SETTINGS_KNOWN");
    assert.equal(settingsModel.defaults_status, "UNKNOWN");
    assert.deepEqual(profileModel.model_value_settings_keys, [
      "is_custom_mode", "is_instrumental", "model_type", "negative_tags", "styles", "title"
    ]);
    assert.deepEqual(profileModel.payload_field_keys, ["model_type"]);
    assert.deepEqual(profileModel.settings_limits, {
      simple_mode_prompt_length: 500,
      custom_mode_prompt_length: 5000,
      style_prompt_limit: 1000,
      title_limit: 80
    });
    assert.deepEqual(settingsModel.settings, publicModel.settings);
  }

  assert.deepEqual(source.controls.prompt, {
    measure: "UTF16_CODE_UNITS",
    simple_max: 500,
    custom_max: 5000,
    nonblank: true,
    nonblank_policy: "LOCAL_VALIDATION_POLICY_NOT_UI_VALIDATOR",
    effective_default: "UNKNOWN"
  });
  assert.deepEqual(source.controls.styles, { max: 1000, effective_default: "UNKNOWN" });
  assert.deepEqual(source.controls.title, { max: 80, effective_default: "UNKNOWN" });
  assert.deepEqual(source.controls.negative_tags, {
    local_max: 5000,
    measure: "UTF16_CODE_UNITS",
    bound_label: "LOCAL_RESOURCE_BOUND_NOT_UI_LIMIT",
    source_ui_limit: "UNKNOWN"
  });
  assert.equal(source.cost_projection.declared_cost_query_keys[0], "version");
  assert.equal(source.cost_projection.generation_value_mapping, "UNPROVEN_NOT_INCLUDED_IN_GENERATE_SETTINGS");
  assert.equal(source.effective_defaults, "UNKNOWN");
  assert.equal(source.runtime_usable, false);
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(source), true);
  assert.equal(Object.isFrozen(source.model_ids), true);
});

test("normalizes only explicit generate settings for both active IDs and all toggle combinations", () => {
  assert.ok(parameterModule, "MISSING_OWNER_SUNO_GENERATION_PARAMETERS_MODULE");
  for (const modelId of MODEL_IDS) {
    for (const customMode of [false, true]) {
      for (const instrumental of [false, true]) {
        const input = explicitInput({
          model_id: modelId,
          is_custom_mode: customMode,
          is_instrumental: instrumental,
          negative_tags: "crowd noise,  clipping ",
          styles: "minimal, bright",
          title: "Explicit title"
        });
        const result = normalize(input);
        assert.equal(result.model_id, modelId);
        assert.equal(result.mode, "generate");
        assert.equal(result.prompt, "A bright, sparse instrumental loop");
        assert.deepEqual(result.settings_candidate, {
          model_type: modelId,
          mode: "generate",
          is_custom_mode: customMode,
          is_instrumental: instrumental,
          negative_tags: "crowd noise,  clipping ",
          styles: "minimal, bright",
          title: "Explicit title"
        });
        assert.equal(result.runtime_usable, false);
        assert.equal(result.dispatch_allowed, false);
        assert.equal(result.backend_acceptance, "UNPROVEN");
        assert.equal(Object.isFrozen(result), true);
        assert.equal(Object.isFrozen(result.settings_candidate), true);
      }
    }
  }
});

test("uses UTF-16 prompt boundaries while preserving accepted Unicode verbatim", () => {
  assert.equal(normalize(explicitInput({ prompt: "x".repeat(500) })).prompt.length, 500);
  assert.equal(normalize(explicitInput({
    prompt: "😀".repeat(250),
    is_custom_mode: false
  })).prompt.length, 500);
  assert.throws(() => normalize(explicitInput({ prompt: "😀".repeat(251) })), isInvalidParameters);
  assert.equal(normalize(explicitInput({
    prompt: "😀".repeat(2500),
    is_custom_mode: true
  })).prompt.length, 5000);
  assert.throws(() => normalize(explicitInput({
    prompt: "😀".repeat(2501),
    is_custom_mode: true
  })), isInvalidParameters);
  assert.throws(() => normalize(explicitInput({ prompt: "x".repeat(501) })), isInvalidParameters);
  assert.throws(() => normalize(explicitInput({ prompt: "x".repeat(5001), is_custom_mode: true })), isInvalidParameters);
  assert.throws(() => normalize(explicitInput({ prompt: "   " })), isInvalidParameters);
  assert.throws(() => normalize(explicitInput({ prompt: "\uD800" })), isInvalidParameters);
});

test("applies explicit style/title and labeled local negative-tags bounds", () => {
  assert.equal(normalize(explicitInput({ styles: "s".repeat(1000) })).settings_candidate.styles.length, 1000);
  assert.throws(() => normalize(explicitInput({ styles: "s".repeat(1001) })), isInvalidParameters);
  assert.equal(normalize(explicitInput({ title: "t".repeat(80) })).settings_candidate.title.length, 80);
  assert.throws(() => normalize(explicitInput({ title: "t".repeat(81) })), isInvalidParameters);
  assert.equal(normalize(explicitInput({ negative_tags: "n".repeat(5000) })).settings_candidate.negative_tags.length, 5000);
  assert.throws(() => normalize(explicitInput({ negative_tags: "n".repeat(5001) })), isInvalidParameters);
});

test("does not silently clear explicit text when instrumental mode is selected", () => {
  const result = normalize(explicitInput({
    is_instrumental: true,
    title: "Retain this",
    styles: "keep style",
    negative_tags: "keep tag"
  }));
  assert.deepEqual(result.settings_candidate, {
    model_type: "V6",
    mode: "generate",
    is_custom_mode: false,
    is_instrumental: true,
    negative_tags: "keep tag",
    styles: "keep style",
    title: "Retain this"
  });
});

test("rejects non-generate modes, unlisted IDs, and fields outside the strict generate slice", () => {
  for (const invalid of [
    explicitInput({ model_id: "V4" }),
    explicitInput({ model_id: "V5" }),
    explicitInput({ mode: "cover" }),
    explicitInput({ mode: "extend" }),
    explicitInput({ file_urls: [] }),
    explicitInput({ source_clip_id: "clip" }),
    explicitInput({ source_task_id: "task" }),
    explicitInput({ continue_at: 1 }),
    explicitInput({ version: "V6" }),
    explicitInput({ is_custom_mode: undefined }),
    explicitInput({ is_instrumental: 1 }),
    explicitInput({ styles: null })
  ]) {
    assert.throws(() => normalize(invalid), isInvalidParameters);
  }
});

test("rejects getters, proxies, malformed arrays, and inherited request shapes without invoking getters", () => {
  let getterCalled = false;
  const getterInput = explicitInput();
  Object.defineProperty(getterInput, "title", {
    enumerable: true,
    get() { getterCalled = true; return ""; }
  });
  assert.throws(() => normalize(getterInput), isInvalidParameters);
  assert.equal(getterCalled, false);

  const revoked = Proxy.revocable(explicitInput(), {});
  revoked.revoke();
  assert.throws(() => normalize(revoked.proxy), isInvalidParameters);
  assert.throws(() => normalize(Object.assign(Object.create({ inherited: true }), explicitInput())), isInvalidParameters);
  assert.throws(() => normalize([]), isInvalidParameters);
});

test("preserves caller input and rejects unknown nested output mutations", () => {
  const input = explicitInput({
    prompt: "  preserve outer spaces  ",
    title: "  preserve title  ",
    styles: "  preserve style  "
  });
  const before = structuredClone(input);
  const result = normalize(input);
  assert.deepEqual(input, before);
  assert.equal(result.prompt, "  preserve outer spaces  ");
  assert.equal(result.settings_candidate.title, "  preserve title  ");
  assert.equal(result.settings_candidate.styles, "  preserve style  ");
  assert.throws(() => { result.settings_candidate.title = "mutated"; }, TypeError);
  assert.equal(result.settings_candidate.title, "  preserve title  ");
});

function isInvalidParameters(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "INVALID_PARAMETERS";
}
