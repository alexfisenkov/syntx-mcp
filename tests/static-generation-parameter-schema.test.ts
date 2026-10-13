import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  loadMaplessSettingsInventoryVersion,
  serializeMaplessSettingsInventory
} from "../src/catalog/mapless-settings-inventory.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  buildSyntxPublicCatalogSnapshot,
  serializeSyntxPublicCatalogSnapshot
} from "../src/catalog/syntx-public-catalog.js";
import {
  buildStaticGenerationParameterSchemas,
  parseStaticGenerationParameterSchemaArtifact,
  staticFormControlAnalysisSchema,
  staticGenerationParameterSchemaCatalogSchema,
  type StaticFormControlAnalysis
} from "../src/catalog/static-generation-parameter-schema.js";

const PUBLIC_CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const SETTINGS_INVENTORY_VERSION = "sha256-87e96b78b145338af1a666c92ab8a9811f46eb82b8f377331a103b0b409aec38.json";

function buildCurrentProjection() {
  return buildStaticGenerationParameterSchemas({
    publicCatalog: loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION),
    publicCatalogVersion: PUBLIC_CATALOG_VERSION,
    settingsInventory: loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION),
    settingsInventoryVersion: SETTINGS_INVENTORY_VERSION
  });
}

test("static schema projection covers the current active image and video model set without runtime claims", () => {
  const projection = buildCurrentProjection();
  assert.equal(projection.models.length, 99);
  assert.equal(projection.summary.image_models, 41);
  assert.equal(projection.summary.video_models, 58);
  assert.equal(projection.status, "STATIC_PARTIAL");
  assert.equal(projection.runtime_usable, false);
  assert.ok(projection.models.every((model) => model.schema_status === "STATIC_PARTIAL" && model.runtime_usable === false));
});

test("static schema projection binds exact public and mapless artifact versions", () => {
  const projection = buildCurrentProjection();
  assert.equal(projection.public_catalog.version, PUBLIC_CATALOG_VERSION);
  assert.equal(projection.settings_inventory.version, SETTINGS_INVENTORY_VERSION);
  assert.equal(projection.settings_inventory.public_catalog_version, PUBLIC_CATALOG_VERSION);
  assert.ok(projection.models.every((model) => model.public_model_binding.model_id === model.model_id));
});

test("public enum schemas use value types and exact model value-key bindings", () => {
  const projection = buildCurrentProjection();
  const byId = new Map(projection.models.map((model) => [model.model_id, model]));
  const grok = byId.get("grok_t2v");
  assert.ok(grok);
  assert.deepEqual(grok.parameter_schema.properties.aspect_ratio, {
    type: "string", enum: ["2:3", "3:2", "1:1", "9:16", "16:9"]
  });
  const luma = byId.get("ray-3.14");
  assert.ok(luma);
  assert.deepEqual(luma.parameter_schema.properties.quality, {
    type: "string", enum: ["360p", "540p", "720p", "1080p"]
  });
  assert.equal(Object.hasOwn(luma.parameter_schema.properties, "get_cost_params"), false);
  assert.equal(Object.hasOwn(luma.parameter_schema.properties, "allowed_media_types"), false);
  const seedance = byId.get("seedance-2.0");
  assert.ok(seedance);
  for (const metadataKey of ["accepted_file_types", "allowed_media_types", "file_count_limit", "max_file_size", "uploadable", "get_cost_params"]) {
    assert.equal(Object.hasOwn(seedance.parameter_schema.properties, metadataKey), false);
    assert.ok(seedance.excluded_public_metadata_keys.includes(metadataKey));
  }
  assert.equal(seedance.unknown_field_keys.includes("mode"), true);
  assert.equal(seedance.blockers.includes("DEFAULTS_NOT_PROJECTED"), true);
  assert.equal(seedance.blockers.includes("CONDITIONAL_RULES_NOT_FULLY_EVALUATED"), true);
});

test("numeric and length bounds remain attached only to their explicit public fields", () => {
  const projection = buildCurrentProjection();
  const seedance = projection.models.find((model) => model.model_id === "seedance-2.0");
  assert.ok(seedance);
  assert.deepEqual(seedance.parameter_schema.properties.prompt, { type: "string", max_length: 35_000 });
  const duration = seedance.field_evidence.find((field) => field.field === "video_duration");
  assert.ok(duration);
  assert.equal(duration.status, "PUBLIC_NUMERIC_BOUNDS_TYPE_UNKNOWN");
  assert.deepEqual(duration.public_constraint, {
    field: "video_duration",
    value_type: "UNKNOWN",
    minimum: 2,
    maximum: 15,
    source_setting_keys: ["min_video_duration", "max_video_duration"],
    classification: "PUBLIC_NUMERIC_BOUNDS_ONLY"
  });
  assert.equal(Object.hasOwn(seedance.parameter_schema.properties, "video_duration"), false);

  const banana = projection.models.find((model) => model.model_id === "banana2");
  assert.ok(banana);
  assert.deepEqual(banana.parameter_schema.properties.prompt, { type: "string" });
  assert.equal(Object.hasOwn(banana.parameter_schema.properties, "image_size"), false);
});

test("static enum projection uses option values rather than display labels", () => {
  const sourceCatalog = loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION);
  const changedModels = structuredClone(sourceCatalog.models);
  const grok = changedModels.find((model) => model.value === "grok_t2v");
  assert.ok(grok?.settings?.aspect_ratio);
  grok.settings.aspect_ratio[0]!.label = "Portrait label only";
  const publicCatalog = buildSyntxPublicCatalogSnapshot({
    aiPayload: sourceCatalog.ai,
    llmModelsPayload: { count: sourceCatalog.llm_models.length, models: sourceCatalog.llm_models },
    modelsPayload: changedModels,
    fetchedAt: sourceCatalog.fetched_at
  });
  const publicCatalogVersion = artifactVersion(serializeSyntxPublicCatalogSnapshot(publicCatalog));
  const settingsInventory = structuredClone(loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION));
  settingsInventory.public_catalog.version = publicCatalogVersion;
  settingsInventory.public_catalog.models_sha256 = publicCatalog.sources.models.canonical_sha256;
  for (const model of settingsInventory.models) {
    const current = publicCatalog.models.find((candidate) => candidate.value === model.model_id);
    assert.ok(current);
    model.settings = current.settings;
    model.enum_constraints = Object.fromEntries(Object.entries(current.settings ?? {}).filter(([, value]) => Array.isArray(value)));
  }
  const settingsInventoryVersion = artifactVersion(serializeMaplessSettingsInventory(settingsInventory));
  const projection = buildStaticGenerationParameterSchemas({
    publicCatalog,
    publicCatalogVersion,
    settingsInventory,
    settingsInventoryVersion
  });
  const grokProjection = projection.models.find((model) => model.model_id === "grok_t2v");
  assert.ok(grokProjection);
  assert.equal(grokProjection.parameter_schema.properties.aspect_ratio?.type, "string");
  assert.deepEqual(grokProjection.parameter_schema.properties.aspect_ratio?.enum, ["2:3", "3:2", "1:1", "9:16", "16:9"]);
  assert.equal(grokProjection.parameter_schema.properties.aspect_ratio?.enum?.includes("Portrait label only"), false);
});

test("projection rejects a public enum with a value of the wrong declared type", () => {
  const publicCatalog = structuredClone(loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION));
  const grok = publicCatalog.models.find((model) => model.value === "grok_t2v");
  assert.ok(grok?.settings?.aspect_ratio);
  (grok.settings.aspect_ratio[0] as unknown as { value: unknown }).value = 23;
  assert.throws(
    () => buildStaticGenerationParameterSchemas({
      publicCatalog,
      publicCatalogVersion: PUBLIC_CATALOG_VERSION,
      settingsInventory: loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION),
      settingsInventoryVersion: SETTINGS_INVENTORY_VERSION
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PUBLIC_CATALOG_INVALID"
  );
});

test("projection rejects stale or cross-bound catalog and mapless versions", () => {
  const publicCatalog = loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION);
  const settingsInventory = loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION);
  assert.throws(
    () => buildStaticGenerationParameterSchemas({
      publicCatalog,
      publicCatalogVersion: "sha256-0000000000000000000000000000000000000000000000000000000000000000.json",
      settingsInventory,
      settingsInventoryVersion: SETTINGS_INVENTORY_VERSION
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PUBLIC_CATALOG_HASH_MISMATCH"
  );

  const crossedInventory = structuredClone(settingsInventory);
  crossedInventory.public_catalog.version = "sha256-1111111111111111111111111111111111111111111111111111111111111111.json";
  const crossedInventoryVersion = artifactVersion(serializeMaplessSettingsInventory(crossedInventory));
  assert.throws(
    () => buildStaticGenerationParameterSchemas({
      publicCatalog,
      publicCatalogVersion: PUBLIC_CATALOG_VERSION,
      settingsInventory: crossedInventory,
      settingsInventoryVersion: crossedInventoryVersion
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "MAPLESS_PUBLIC_CATALOG_MISMATCH"
  );
});

test("cost parameter names do not manufacture enums when public constraints are missing", () => {
  const projection = buildCurrentProjection();
  const seedance = projection.models.find((model) => model.model_id === "seedance_pro");
  assert.ok(seedance);
  const duration = seedance.field_evidence.find((field) => field.field === "video_duration");
  assert.equal(duration?.status, "UNKNOWN");
  assert.equal(duration?.public_constraint, null);
  assert.equal(Object.hasOwn(seedance.parameter_schema.properties, "video_duration"), false);
});

test("hash-bound static UI options become explicitly non-wire candidate schemas", () => {
  const publicCatalog = loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION);
  const settingsInventory = loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION);
  const banana = settingsInventory.models.find((model) => model.model_id === "banana2");
  assert.ok(banana?.form_id);
  const form = settingsInventory.forms.find((candidate) => candidate.form_id === banana.form_id);
  assert.ok(form);
  const analysis = staticFormAnalysis(form.form_id, form.module_name, form.javascript.url, form.javascript.bytes, form.javascript.sha256, ["banana2"]);
  const projection = buildStaticGenerationParameterSchemas({
    publicCatalog,
    publicCatalogVersion: PUBLIC_CATALOG_VERSION,
    settingsInventory,
    settingsInventoryVersion: SETTINGS_INVENTORY_VERSION,
    staticFormControlAnalysis: analysis
  });
  const model = projection.models.find((candidate) => candidate.model_id === "banana2");
  assert.ok(model);
  assert.deepEqual(model.parameter_schema.properties.image_size, { type: "string", enum: ["1K", "2K"] });
  const evidence = model.field_evidence.find((field) => field.field === "image_size");
  assert.equal(evidence?.status, "STATIC_FORM_CONTROL_CANDIDATE");
  assert.equal(evidence?.source.kind, "HASH_PINNED_FORM_CONTROL_AST");
  assert.ok(evidence?.blockers.includes("STATIC_UI_CONTROL_CANDIDATE_NOT_WIRE_VERIFIED"));
  assert.equal(model.runtime_usable, false);
});

test("conditional or watch-mutated controls are not projected from static UI evidence", () => {
  const publicCatalog = loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION);
  const settingsInventory = loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION);
  const banana = settingsInventory.models.find((model) => model.model_id === "banana2");
  assert.ok(banana?.form_id);
  const form = settingsInventory.forms.find((candidate) => candidate.form_id === banana.form_id);
  assert.ok(form);
  const analysis = staticFormAnalysis(form.form_id, form.module_name, form.javascript.url, form.javascript.bytes, form.javascript.sha256, ["banana2"]);
  analysis.forms[0]!.controls[0]!.conditions.push({
    field: "model_type", operator: "===", value: "banana2", branch: "THEN",
    source_location: { line: 1, column: 1 }, evaluated: false
  });
  analysis.forms[0]!.watch_effects.push({
    location: { line: 1, column: 1 }, read_fields: ["image_size"], written_fields: ["image_size"],
    transformation_status: "AST_CAPTURED_NOT_EXECUTED"
  });
  const projection = buildStaticGenerationParameterSchemas({
    publicCatalog, publicCatalogVersion: PUBLIC_CATALOG_VERSION, settingsInventory,
    settingsInventoryVersion: SETTINGS_INVENTORY_VERSION, staticFormControlAnalysis: analysis
  });
  const model = projection.models.find((candidate) => candidate.model_id === "banana2");
  assert.ok(model);
  assert.equal(Object.hasOwn(model.parameter_schema.properties, "image_size"), false);
  assert.ok(model.unknown_field_keys.includes("image_size"));
});

test("static model_type guards apply only to the exact selected catalog model", () => {
  const publicCatalog = loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION);
  const settingsInventory = loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION);
  const banana = settingsInventory.models.find((model) => model.model_id === "banana2");
  assert.ok(banana?.form_id);
  const form = settingsInventory.forms.find((candidate) => candidate.form_id === banana.form_id);
  assert.ok(form);
  const analysis = staticFormAnalysis(form.form_id, form.module_name, form.javascript.url, form.javascript.bytes, form.javascript.sha256, ["banana2"]);
  analysis.forms[0]!.controls[0]!.conditions.push({
    field: "model_type", operator: "===", value: "banana2", branch: "THEN",
    source_location: { line: 1, column: 1 }, evaluated: false
  });
  const matches = buildStaticGenerationParameterSchemas({
    publicCatalog, publicCatalogVersion: PUBLIC_CATALOG_VERSION, settingsInventory,
    settingsInventoryVersion: SETTINGS_INVENTORY_VERSION, staticFormControlAnalysis: analysis
  }).models.find((candidate) => candidate.model_id === "banana2");
  assert.ok(matches);
  assert.ok(matches.field_evidence.find((field) => field.field === "image_size")?.blockers.includes("STATIC_MODEL_TYPE_CONDITION_MATCHED_TO_CATALOG_MODEL"));

  analysis.forms[0]!.controls[0]!.conditions[0]!.value = "banana-2.1";
  const doesNotMatch = buildStaticGenerationParameterSchemas({
    publicCatalog, publicCatalogVersion: PUBLIC_CATALOG_VERSION, settingsInventory,
    settingsInventoryVersion: SETTINGS_INVENTORY_VERSION, staticFormControlAnalysis: analysis
  }).models.find((candidate) => candidate.model_id === "banana2");
  assert.ok(doesNotMatch);
  assert.equal(Object.hasOwn(doesNotMatch.parameter_schema.properties, "image_size"), false);
});

test("matched form source with no controls cannot masquerade as covered", () => {
  const publicCatalog = loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION);
  const settingsInventory = loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION);
  const banana = settingsInventory.models.find((model) => model.model_id === "banana2");
  assert.ok(banana?.form_id);
  const form = settingsInventory.forms.find((candidate) => candidate.form_id === banana.form_id);
  assert.ok(form);
  const analysis = staticFormAnalysis(form.form_id, form.module_name, form.javascript.url, form.javascript.bytes, form.javascript.sha256, ["banana2"]);
  analysis.forms[0]!.controls = [];
  analysis.forms[0]!.control_structure_status = "UNRESOLVED_STRUCTURE";
  analysis.forms[0]!.blockers = ["NO_STATIC_MODEL_VALUE_CONTROL_FOUND"];
  const projection = buildStaticGenerationParameterSchemas({
    publicCatalog, publicCatalogVersion: PUBLIC_CATALOG_VERSION, settingsInventory,
    settingsInventoryVersion: SETTINGS_INVENTORY_VERSION, staticFormControlAnalysis: analysis
  });
  const model = projection.models.find((candidate) => candidate.model_id === "banana2");
  assert.ok(model);
  assert.equal(model.settings_form_binding.status, "STRUCTURAL_MATCH");
  assert.equal(model.settings_form_binding.control_structure_status, "UNRESOLVED_STRUCTURE");
  assert.ok(model.blockers.includes("FORM_SOURCE_CONTROL_STRUCTURE_UNRESOLVED"));
  const imageSize = model.field_evidence.find((field) => field.field === "image_size");
  assert.equal(imageSize?.status, "UNKNOWN");
  assert.ok(imageSize?.blockers.includes("FORM_SOURCE_CONTROL_STRUCTURE_UNRESOLVED"));
});

test("immutable full-catalog UI evidence projection reconciles all 99 model IDs and source facts", async () => {
  const analysisPath = "catalog/runtime/v11/static-form-control-analysis-v1.6-e5517ee5-87e96b78-097959987e8cb737.json";
  const projectionPath = "catalog/runtime/v11/static-generation-parameter-schema-v1.2-e5517ee5-87e96b78-7cfe38ace55eadde.json";
  const analysisText = await readFile(analysisPath, "utf8");
  const projectionText = await readFile(projectionPath, "utf8");
  assert.equal(
    "sha256:" + createHash("sha256").update(analysisText, "utf8").digest("hex"),
    "sha256:097959987e8cb737249d53cce8a3281f34958c8f1a5f6bbc66e4f4d8eda054a2"
  );
  assert.equal(
    "sha256:" + createHash("sha256").update(projectionText, "utf8").digest("hex"),
    "sha256:7cfe38ace55eadde73f5e14716b5263b8da41d122eaba3d914c15c7d7ca13d26"
  );
  const analysis = staticFormControlAnalysisSchema.parse(JSON.parse(analysisText));
  const projection = staticGenerationParameterSchemaCatalogSchema.parse(JSON.parse(projectionText));
  const rebuilt = buildStaticGenerationParameterSchemas({
    publicCatalog: loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION),
    publicCatalogVersion: PUBLIC_CATALOG_VERSION,
    settingsInventory: loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION),
    settingsInventoryVersion: SETTINGS_INVENTORY_VERSION,
    staticFormControlAnalysis: analysis
  });
  assert.deepEqual(projection, rebuilt);
  assert.equal(projection.models.length, 99);
  assert.equal(new Set(projection.models.map((model) => model.model_id)).size, 99);
  assert.equal(projection.summary.image_models, 41);
  assert.equal(projection.summary.video_models, 58);
  assert.equal(projection.summary.static_ui_control_facts, 199);
  assert.equal(projection.summary.static_ui_nullable_option_controls, 5);
  assert.equal(projection.summary.static_ui_dynamic_option_controls, 122);
  assert.equal(projection.summary.static_ui_guarded_controls, 116);
  assert.equal(projection.summary.static_ui_unresolved_model_value_controls, 29);
  assert.equal(projection.summary.models_with_unresolved_form_control_structure, 0);
  assert.equal(projection.summary.models_with_matched_settings3_ai_name, 10);
  assert.equal(projection.summary.models_with_unresolved_settings_root, 10);
  assert.deepEqual(analysis.forms.filter((form) => ["beeble", "flux", "higgsfield", "runway-frames"].includes(form.form_id))
    .map((form) => [form.form_id, form.control_structure_status, form.settings3_store_binding.status]), [
      ["beeble", "CONTROLS_FOUND", "SETTINGS3_U_STORE_BOUND"],
      ["flux", "CONTROLS_FOUND", "SETTINGS3_U_STORE_BOUND"],
      ["higgsfield", "CONTROLS_FOUND", "SETTINGS3_U_STORE_BOUND"],
      ["runway-frames", "CONTROLS_FOUND", "SETTINGS3_U_STORE_BOUND"]
    ]);
  assert.ok(analysis.forms.filter((form) => ["beeble", "flux", "higgsfield", "runway-frames"].includes(form.form_id))
    .every((form) => form.settings3_store_binding.settings_root_status === "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED"));
  assert.equal(projection.runtime_usable, false);
  assert.ok(projection.models.every((model) => model.schema_status === "STATIC_PARTIAL" && model.runtime_usable === false));
  assert.ok(projection.models.filter((model) => model.settings_form_binding.control_structure_status === "UNRESOLVED_STRUCTURE")
    .every((model) => model.blockers.includes("FORM_SOURCE_CONTROL_STRUCTURE_UNRESOLVED")));

  const banana = projection.models.find((model) => model.model_id === "banana2");
  assert.ok(banana);
  const ratioFacts = banana.field_evidence.find((field) => field.field === "aspect_ratio")?.static_control_evidence;
  assert.equal(ratioFacts?.[0]?.options_nullable, true);
  assert.deepEqual(ratioFacts?.[0]?.option_values.map((option) => option.value), [
    null, "21:9", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "1:1"
  ]);
  assert.equal(Object.hasOwn(banana.parameter_schema.properties, "aspect_ratio"), false);
  assert.ok(banana.field_evidence.find((field) => field.field === "aspect_ratio")?.blockers.includes("STATIC_UI_ENUM_NULL_NOT_SUPPORTED_BY_PARAMETER_PROPERTY"));
  const imageSizeFacts = banana.field_evidence.find((field) => field.field === "image_size")?.static_control_evidence;
  assert.equal(imageSizeFacts?.[0]?.option_children[0]?.resolved_component_name, "el-option");
  assert.equal(imageSizeFacts?.[0]?.option_children[0]?.value_status, "DYNAMIC");

  const seedance = projection.models.find((model) => model.model_id === "seedance-2.0");
  assert.ok(seedance);
  const audioToggle = seedance.field_evidence.find((field) => field.field === "generate_audio")?.static_control_evidence[0];
  assert.equal(audioToggle?.component_name, "el-switch");
  assert.equal(audioToggle?.value_type, "boolean");
  assert.ok(audioToggle?.conditions.length);
  assert.ok(audioToggle?.conditions.every((condition) => condition.evaluated === false));
  assert.equal(Object.hasOwn(seedance.parameter_schema.properties, "generate_audio"), false);

  const switchx = projection.models.find((model) => model.model_id === "switchx");
  assert.ok(switchx);
  assert.equal(switchx.settings_form_binding.source_store_binding?.ai_name_match_status, "MATCHED");
  assert.equal(switchx.settings_form_binding.source_store_binding?.settings_root_status, "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED");
  assert.equal(switchx.field_evidence.find((field) => field.field === "resolution")?.public_settings_status, "ABSENT");
  assert.ok(switchx.field_evidence.find((field) => field.field === "resolution")?.blockers.includes("UI_ONLY_FIELD_NOT_IN_PUBLIC_SETTINGS"));
  assert.equal(Object.hasOwn(switchx.parameter_schema.properties, "resolution"), false);
  assert.ok(switchx.settings_form_binding.source_store_binding?.initial_factory_fallbacks.some((fallback) =>
    fallback.field === "resolution" && fallback.value === "720P" && fallback.value_status === "STATIC_LITERAL"));
  const dopLite = projection.models.find((model) => model.model_id === "dop-lite");
  assert.ok(dopLite);
  const motions = dopLite.field_evidence.find((field) => field.field === "motions");
  assert.equal(motions?.unresolved_control_evidence[0]?.nested_property_path[0], "strength");
  assert.equal(Object.hasOwn(dopLite.parameter_schema.properties, "motions"), false);
});

test("legacy projection artifact is hash-verified and conservatively migrated in memory", async () => {
  const legacyPath = "catalog/runtime/v11/static-generation-parameter-schema-v1.1-e5517ee5-87e96b78-6e9e23581252ac96.json";
  const serialized = await readFile(legacyPath, "utf8");
  const parsed = parseStaticGenerationParameterSchemaArtifact(
    serialized,
    "sha256:6e9e23581252ac9645a88edf90cbf4262a3f4ee64b9a336e58478204fc819839"
  );
  assert.equal(parsed.source_schema_version, "1.1.0");
  assert.equal(parsed.migration_status, "LEGACY_V1_1_DEFAULTED_UNKNOWN");
  assert.equal(parsed.catalog.schema_version, "1.2.0");
  assert.equal(parsed.catalog.models.length, 99);
  assert.equal(parsed.catalog.summary.models_with_not_checked_form_control_structure, 99);
  assert.equal(parsed.catalog.summary.models_with_unresolved_form_control_structure, 0);
  assert.ok(parsed.catalog.models.every((model) => model.settings_form_binding.control_structure_status === "NOT_CHECKED"));
  const withControls = parsed.catalog.models.find((model) => model.field_evidence.some((field) => field.static_control_evidence.length > 0));
  assert.ok(withControls);
  assert.equal(withControls.settings_form_binding.source_store_binding, null);
  assert.ok(withControls.field_evidence.flatMap((field) => field.static_control_evidence)
    .every((control) => control.source_context.settings_root_status === "UNRESOLVED_GLOBAL_IDENTIFIER"));
  assert.throws(
    () => parseStaticGenerationParameterSchemaArtifact(serialized, "sha256:" + "0".repeat(64)),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "STATIC_SCHEMA_ARTIFACT_HASH_MISMATCH"
  );
});

function staticFormAnalysis(
  formId: string, moduleName: string, url: string, bytes: number, sourceHash: string, modelIds: string[]
): StaticFormControlAnalysis {
  return {
    schema_version: "1.6.0",
    catalog_kind: "STATIC_FORM_CONTROL_AST_EVIDENCE",
    evidence_level: "HASH_PINNED_COMPILED_JS_AST",
    public_catalog_version: PUBLIC_CATALOG_VERSION,
    settings_inventory_version: SETTINGS_INVENTORY_VERSION,
    build_id: "1791445568",
    runtime_usable: false,
    forms: [{
      form_id: formId, module_name: moduleName, url, bytes, source_sha256: sourceHash,
      parse_diagnostics: 0, control_structure_status: "CONTROLS_FOUND",
      control_binding_key_source: "MAPLESS_MODEL_VALUE_KEY_LIST",
      settings3_store_binding: {
        status: "NO_SETTINGS3_U_STORE", module_specifier: null, imported_name: null, local_name: null,
        call_location: null, operation_modality: null, ai_name: null, returned_methods: [],
        settings_root_status: "NO_SETTINGS_REFERENCE", initial_factory_fallbacks: [],
        blockers: ["SETTINGS3_U_STORE_NOT_FOUND"]
      },
      unresolved_model_value_controls: [],
      model_ids: modelIds, local_imports: [], watch_effects: [],
      blockers: [], controls: [{
        field: "image_size", binding_location: { line: 1, column: 1 },
        source_context: { setting_binding_kind: "DIRECT_SETTINGS_PROPERTY", settings_root_status: "NOT_SETTINGS_REFERENCE", setting_root_identifier: null, settings_context_evidence: { status: "NOT_OBSERVED", helper_import: null, helper_call_location: null, context_argument_identifier: null, context_argument_origin_import: null }, render_call_location: null, render_helper: null, render_helper_import: null, component_local_name: null, component_import: null, component_resolver_import: null, props_argument_index: null, sibling_property_names: ["modelValue"] },
        component_name: "el-select",
        declared_input_type: null, value_type: "string", options_status: "STATIC_LITERAL_ARRAY",
        option_values: [{ value: "1K", label: "Small" }, { value: "2K", label: "Large" }],
        option_children: [],
        options_nullable: false,
        option_source_location: { line: 1, column: 2 }, option_import_refs: [],
        option_source_binding: { property_name: "options", expression_kind: "ArrayLiteralExpression", identifier: null, property_path: [], import_ref: null },
        numeric_constraints: null, numeric_prop_facts: null, string_constraints: null,
        literal_default: { status: "NOT_PRESENT", value: null, value_type: null, string_length: null, source_location: null, redacted: false },
        conditions: [], unknown_reasons: []
      }]
    }],
    unbound_model_ids: [],
    limitations: ["Static AST evidence only."]
  };
}

function artifactVersion(serialized: string): string {
  const sha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
  return `sha256-${sha256}.json`;
}
