import { createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  maplessSettingsInventorySchema,
  serializeMaplessSettingsInventory,
  type MaplessSettingsInventory
} from "./mapless-settings-inventory.js";
import {
  DiscoveryCatalogRepository
} from "./discovery-catalog.js";
import {
  sha256CanonicalPayload,
  canonicalJson,
  serializeSyntxPublicCatalogSnapshot,
  syntxPublicCatalogSnapshotSchema,
  type SyntxPublicCatalogSnapshot,
  type SyntxPublicModelEntry
} from "./syntx-public-catalog.js";
import {
  generationParameterPropertySchema,
  type GenerationParameterProperty
} from "../domain/generation-contract.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const versionSchema = z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u);
const identifierSchema = z.string().min(1).max(160);
const operationSchema = z.enum(["generate-image", "generate-video"]);
const modalitySchema = z.enum(["image", "video"]);
const propertySchema = generationParameterPropertySchema;
const sourceLocationSchema = z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict();
const scalarValueSchema = z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]);

const staticFormOptionSchema = z.object({
  value: scalarValueSchema,
  label: z.string().max(500).nullable()
}).strict();
const staticSourceImportBindingSchema = z.object({
  specifier: z.string().max(500),
  imported_name: z.string().max(160),
  local_name: z.string().max(160)
}).strict();

const staticOptionChildEvidenceSchema = z.object({
  location: sourceLocationSchema,
  component_local_name: z.string().max(160).nullable(),
  component_import: staticSourceImportBindingSchema.nullable(),
  component_resolver_import: staticSourceImportBindingSchema.nullable(),
  resolved_component_name: z.string().max(200).nullable(),
  value_status: z.enum(["STATIC_LITERAL", "STATIC_LOCAL_CONSTANT", "UNRESOLVED_LOCAL_IMPORT", "DYNAMIC"]),
  value: scalarValueSchema.nullable(),
  value_expression_kind: z.string().max(100),
  value_identifier: z.string().max(160).nullable(),
  value_property_path: z.array(z.string().max(160)).max(16)
}).strict();

const staticFormConditionSchema = z.object({
  field: identifierSchema.nullable(),
  operator: z.enum(["===", "==", "!==", "!=", "SWITCH_CASE", "UNRESOLVED"]),
  value: scalarValueSchema,
  branch: z.enum(["THEN", "ELSE", "CASE"]),
  source_location: sourceLocationSchema,
  evaluated: z.literal(false)
}).strict();

const staticSettingsContextEvidenceSchema = z.object({
  status: z.enum(["IMPORTED_COMPONENT_HELPER_CHAIN", "DIRECT_OR_OTHER_SETTINGS_REFERENCE", "NOT_OBSERVED"]),
  helper_import: staticSourceImportBindingSchema.nullable(),
  helper_call_location: sourceLocationSchema.nullable(),
  context_argument_identifier: identifierSchema.nullable(),
  context_argument_origin_import: staticSourceImportBindingSchema.nullable()
}).strict();

const staticFormFactoryFallbackSchema = z.object({
  field: identifierSchema,
  value_status: z.enum(["STATIC_LITERAL", "STATIC_LOCAL_CONSTANT", "CONDITIONAL_OR_DYNAMIC"]),
  value_kind: z.enum(["SCALAR", "EMPTY_ARRAY", "CONDITIONAL", "DYNAMIC", "COMPLEX"]),
  value: scalarValueSchema,
  source_location: sourceLocationSchema
}).strict();

const staticSettings3StoreBindingSchema = z.object({
  status: z.enum(["SETTINGS3_U_STORE_BOUND", "UNRESOLVED_SETTINGS3_STORE_CALL", "NO_SETTINGS3_U_STORE", "NOT_ANALYZED_IN_THIS_EXTRACTOR_VERSION"]),
  module_specifier: z.string().max(500).nullable(),
  imported_name: z.string().max(160).nullable(),
  local_name: z.string().max(160).nullable(),
  call_location: sourceLocationSchema.nullable(),
  operation_modality: z.enum(["image", "video"]).nullable(),
  ai_name: identifierSchema.nullable(),
  returned_methods: z.array(z.object({
    method_name: identifierSchema,
    local_name: identifierSchema
  }).strict()).max(64),
  settings_root_status: z.enum(["LEXICAL_BINDING_FOUND", "UNRESOLVED_GLOBAL_IDENTIFIER", "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED", "NO_SETTINGS_REFERENCE", "NOT_CHECKED"]),
  initial_factory_fallbacks: z.array(staticFormFactoryFallbackSchema).max(256),
  blockers: z.array(z.string().min(1)).max(16)
}).strict();

const unresolvedModelValueControlSchema = z.object({
  location: sourceLocationSchema,
  expression_kind: z.string().max(100),
  expression_path: z.array(z.string().max(160)).max(16),
  root_identifier: z.string().max(160).nullable(),
  collection_source_path: z.array(z.string().max(160)).max(16),
  collection_source_settings_field: identifierSchema.nullable(),
  nested_property_path: z.array(z.string().max(160)).max(16),
  component_name: z.string().max(200).nullable(),
  component_import: staticSourceImportBindingSchema.nullable(),
  component_resolver_import: staticSourceImportBindingSchema.nullable(),
  property_names: z.array(z.string().max(160)).max(128),
  literal_name_property: z.string().max(160).nullable(),
  numeric_props: z.array(z.object({
    name: z.string().max(160),
    value: scalarValueSchema,
    source_location: sourceLocationSchema
  }).strict()).max(16),
  conditions: z.array(staticFormConditionSchema).max(64),
  reason: z.enum(["MODEL_VALUE_ROOT_ORIGIN_UNRESOLVED", "SETTINGS_FIELD_NOT_IN_MAPLESS_ALLOWLIST", "NON_SETTINGS_UI_CONTROL"])
}).strict();

export const staticFormControlEvidenceSchema = z.object({
  field: identifierSchema,
  binding_location: sourceLocationSchema,
  source_context: z.object({
    setting_binding_kind: z.enum(["DIRECT_SETTINGS_PROPERTY", "COMPUTED_GETTER", "COMPUTED_GETTER_TRANSFORMED", "SETTINGS3_STORE_DIRECT_PROPERTY", "DIRECT_COMPONENT_CONTEXT_SETTINGS_PROPERTY", "UNRESOLVED"]),
    settings_root_status: z.enum(["LEXICAL_BINDING_FOUND", "UNRESOLVED_GLOBAL_IDENTIFIER", "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED", "NOT_SETTINGS_REFERENCE"]).default("UNRESOLVED_GLOBAL_IDENTIFIER"),
    setting_root_identifier: z.string().max(160).nullable().default(null),
    settings_context_evidence: staticSettingsContextEvidenceSchema.default({
      status: "NOT_OBSERVED", helper_import: null, helper_call_location: null,
      context_argument_identifier: null, context_argument_origin_import: null
    }),
    render_call_location: sourceLocationSchema.nullable(),
    render_helper: z.string().max(160).nullable(),
    render_helper_import: staticSourceImportBindingSchema.nullable(),
    component_local_name: z.string().max(160).nullable(),
    component_import: staticSourceImportBindingSchema.nullable(),
    component_resolver_import: staticSourceImportBindingSchema.nullable(),
    props_argument_index: z.number().int().nonnegative().nullable(),
    sibling_property_names: z.array(z.string().max(160)).max(128)
  }).strict(),
  component_name: z.string().max(200).nullable(),
  declared_input_type: z.string().max(100).nullable(),
  value_type: z.enum(["string", "number", "integer", "boolean"]).nullable(),
  options_status: z.enum(["STATIC_LITERAL_ARRAY", "STATIC_LOCAL_CONSTANT", "STATIC_VNODE_CHILDREN", "UNRESOLVED_LOCAL_IMPORT", "DYNAMIC", "NOT_PRESENT"]),
  option_values: z.array(staticFormOptionSchema).max(256),
  option_children: z.array(staticOptionChildEvidenceSchema).max(128),
  options_nullable: z.boolean(),
  option_source_location: sourceLocationSchema.nullable(),
  option_source_binding: z.object({
    property_name: z.string().max(160).nullable(),
    expression_kind: z.string().max(100).nullable(),
    identifier: z.string().max(160).nullable(),
    property_path: z.array(z.string().max(160)).max(16),
    import_ref: z.string().max(500).nullable()
  }).strict(),
  option_import_refs: z.array(z.string().max(500)).max(32),
  numeric_constraints: z.object({
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    step: z.number().finite().positive().optional()
  }).strict().nullable(),
  numeric_prop_facts: z.object({
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    step: z.number().finite().optional(),
    caller_value_type_proven: z.boolean()
  }).strict().nullable().default(null),
  string_constraints: z.object({
    min_length: z.number().int().nonnegative().optional(),
    max_length: z.number().int().nonnegative().optional()
  }).strict().nullable(),
  literal_default: z.object({
    status: z.enum(["STATIC_LITERAL", "STATIC_LOCAL_CONSTANT", "UNRESOLVED", "NOT_PRESENT"]),
    value: scalarValueSchema,
    value_type: z.enum(["string", "number", "integer", "boolean"]).nullable(),
    string_length: z.number().int().nonnegative().nullable(),
    source_location: sourceLocationSchema.nullable(),
    redacted: z.boolean()
  }).strict(),
  conditions: z.array(staticFormConditionSchema).max(64),
  unknown_reasons: z.array(z.string().min(1)).max(32)
}).strict();

export const staticFormControlAnalysisSchema = z.object({
  schema_version: z.literal("1.6.0"),
  catalog_kind: z.literal("STATIC_FORM_CONTROL_AST_EVIDENCE"),
  evidence_level: z.literal("HASH_PINNED_COMPILED_JS_AST"),
  public_catalog_version: versionSchema,
  settings_inventory_version: versionSchema,
  build_id: z.string().regex(/^\d{6,20}$/u),
  runtime_usable: z.literal(false),
  forms: z.array(z.object({
    form_id: z.string().min(1).max(64),
    module_name: z.string().min(1).max(300),
    url: z.url(),
    bytes: z.number().int().positive(),
    source_sha256: sha256Schema,
    parse_diagnostics: z.literal(0),
    control_structure_status: z.enum(["CONTROLS_FOUND", "UNRESOLVED_STRUCTURE"]),
    control_binding_key_source: z.enum(["MAPLESS_MODEL_VALUE_KEY_LIST", "DIRECT_SETTINGS_MODEL_VALUE_AST", "NO_CONTROL_BINDINGS", "NOT_ANALYZED_IN_THIS_EXTRACTOR_VERSION"]),
    settings3_store_binding: staticSettings3StoreBindingSchema,
    unresolved_model_value_controls: z.array(unresolvedModelValueControlSchema).max(512),
    model_ids: z.array(identifierSchema).max(256),
    local_imports: z.array(z.object({
      specifier: z.string().min(1).max(500),
      imported_name: z.string().min(1).max(160),
      local_name: z.string().min(1).max(160),
      location: sourceLocationSchema
    }).strict()).max(512),
    controls: z.array(staticFormControlEvidenceSchema).max(512),
    watch_effects: z.array(z.object({
      location: sourceLocationSchema,
      read_fields: z.array(identifierSchema).max(128),
      written_fields: z.array(identifierSchema).max(128),
      transformation_status: z.literal("AST_CAPTURED_NOT_EXECUTED")
    }).strict()).max(256),
    blockers: z.array(z.string().min(1)).max(64)
  }).strict()).min(1).max(100),
  unbound_model_ids: z.array(identifierSchema).max(1_000),
  limitations: z.array(z.string().min(1)).min(1).max(64)
}).strict();

export type StaticFormControlEvidence = z.infer<typeof staticFormControlEvidenceSchema>;
export type StaticFormControlAnalysis = z.infer<typeof staticFormControlAnalysisSchema>;

const publicConstraintFactSchema = z.object({
  field: identifierSchema,
  value_type: z.literal("UNKNOWN"),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  source_setting_keys: z.array(identifierSchema).min(1).max(2),
  classification: z.literal("PUBLIC_NUMERIC_BOUNDS_ONLY")
}).strict().superRefine((fact, context) => {
  if (fact.minimum === undefined && fact.maximum === undefined) {
    context.addIssue({ code: "custom", message: "At least one numeric bound is required." });
  }
  if (fact.minimum !== undefined && fact.maximum !== undefined && fact.minimum > fact.maximum) {
    context.addIssue({ code: "custom", path: ["minimum"], message: "Minimum may not exceed maximum." });
  }
});

const fieldEvidenceSchema = z.object({
  field: identifierSchema,
  status: z.enum([
    "COMMON_OPERATION_FIELD",
    "PROVEN_PUBLIC_ENUM",
    "STATIC_FORM_CONTROL_CANDIDATE",
    "PUBLIC_NUMERIC_BOUNDS_TYPE_UNKNOWN",
    "UNKNOWN",
    "SERVER_OWNED"
  ]),
  property_schema: propertySchema.nullable(),
  public_constraint: publicConstraintFactSchema.nullable(),
  public_settings_status: z.enum(["PRESENT", "ABSENT", "NOT_APPLICABLE", "UNKNOWN"]).default("UNKNOWN"),
  static_control_evidence: z.array(staticFormControlEvidenceSchema).max(128),
  unresolved_control_evidence: z.array(unresolvedModelValueControlSchema).max(128).default([]),
  source: z.object({
    kind: z.enum(["COMMON_REQUEST_PORT", "MODEL_VALUE_SETTINGS_KEYS", "HASH_PINNED_FORM_CONTROL_AST", "TRANSPORT_OWNED"]),
    form_id: z.string().nullable(),
    form_source_sha256: sha256Schema.nullable(),
    public_setting_keys: z.array(identifierSchema).max(2)
  }).strict(),
  blockers: z.array(z.string().min(1)).max(8)
}).strict();

const projectedSettings3StoreBindingSchema = staticSettings3StoreBindingSchema.extend({
  ai_name_match_status: z.enum(["MATCHED", "MISMATCH", "NOT_CHECKED"])
}).strict();

const modelProjectionSchema = z.object({
  model_id: identifierSchema,
  ai_name: identifierSchema,
  operation_id: operationSchema,
  modality: modalitySchema,
  active: z.literal(true),
  schema_status: z.enum(["STATIC_PARTIAL", "STATIC_COMPLETE"]),
  runtime_usable: z.literal(false),
  public_model_binding: z.object({
    model_id: identifierSchema,
    ai_name: identifierSchema,
    upstream_model_value: identifierSchema,
    canonical_sha256: sha256Schema
  }).strict(),
  settings_form_binding: z.object({
    form_id: z.string().nullable(),
    status: z.enum(["STRUCTURAL_MATCH", "UNKNOWN"]),
    module_name: z.string().nullable(),
    source_sha256: sha256Schema.nullable(),
    control_structure_status: z.enum(["CONTROLS_FOUND", "UNRESOLVED_STRUCTURE", "NOT_CHECKED"]).default("NOT_CHECKED"),
    source_store_binding: projectedSettings3StoreBindingSchema.nullable().default(null),
    unresolved_model_value_controls: z.array(unresolvedModelValueControlSchema).max(512).default([])
  }).strict(),
  parameter_schema: z.object({
    type: z.literal("object"),
    additional_properties: z.literal(false),
    required: z.array(identifierSchema).max(64),
    properties: z.record(identifierSchema, propertySchema).refine((properties) => Object.keys(properties).length <= 64)
  }).strict(),
  required_fields_status: z.literal("COMMON_REQUEST_PORT_ONLY"),
  defaults_status: z.literal("NOT_PROJECTED"),
  conditions_status: z.literal("UNKNOWN"),
  wire_status: z.literal("NOT_RUNTIME_VERIFIED"),
  field_evidence: z.array(fieldEvidenceSchema).max(128),
  unknown_field_keys: z.array(identifierSchema).max(128),
  excluded_public_metadata_keys: z.array(identifierSchema).max(256),
  blockers: z.array(z.string().min(1)).min(1).max(32),
  schema_sha256: sha256Schema
}).strict();

export const staticGenerationParameterSchemaCatalogSchema = z.object({
  schema_version: z.enum(["1.1.0", "1.2.0"]).transform(() => "1.2.0" as const),
  catalog_kind: z.literal("STATIC_GENERATION_PARAMETER_SCHEMA_PROJECTION"),
  status: z.enum(["STATIC_PARTIAL", "STATIC_COMPLETE"]),
  runtime_usable: z.literal(false),
  public_catalog: z.object({
    version: versionSchema,
    fetched_at: z.iso.datetime(),
    source_hashes: z.object({ ai: sha256Schema, llm_models: sha256Schema, models: sha256Schema }).strict()
  }).strict(),
  settings_inventory: z.object({
    version: versionSchema,
    generated_at: z.iso.datetime(),
    build_id: z.string().regex(/^\d{6,20}$/u),
    public_catalog_version: versionSchema,
    public_models_sha256: sha256Schema
  }).strict(),
  summary: z.object({
    projected_models: z.number().int().nonnegative(),
    image_models: z.number().int().nonnegative(),
    video_models: z.number().int().nonnegative(),
    static_complete_models: z.number().int().nonnegative(),
    static_partial_models: z.number().int().nonnegative(),
    models_with_proven_enum_fields: z.number().int().nonnegative(),
    projected_enum_fields: z.number().int().nonnegative(),
    public_numeric_constraint_facts: z.number().int().nonnegative(),
    static_ui_control_facts: z.number().int().nonnegative(),
    static_ui_nullable_option_controls: z.number().int().nonnegative(),
    static_ui_dynamic_option_controls: z.number().int().nonnegative(),
    static_ui_guarded_controls: z.number().int().nonnegative(),
    static_ui_unresolved_model_value_controls: z.number().int().nonnegative().default(0),
    models_with_unresolved_form_control_structure: z.number().int().nonnegative().default(0),
    models_with_not_checked_form_control_structure: z.number().int().nonnegative().default(0),
    models_with_matched_settings3_ai_name: z.number().int().nonnegative().default(0),
    models_with_unresolved_settings_root: z.number().int().nonnegative().default(0),
    ui_only_field_facts: z.number().int().nonnegative().default(0)
  }).strict(),
  models: z.array(modelProjectionSchema).min(1).max(10_000)
}).strict().superRefine((catalog, context) => {
  if (catalog.status !== "STATIC_PARTIAL" || catalog.runtime_usable !== false) {
    context.addIssue({ code: "custom", path: ["status"], message: "A mapless public projection cannot claim complete or runtime-usable coverage." });
  }
  if (catalog.summary.projected_models !== catalog.models.length ||
      catalog.summary.static_partial_models !== catalog.models.filter((model) => model.schema_status === "STATIC_PARTIAL").length ||
      catalog.summary.static_complete_models !== catalog.models.filter((model) => model.schema_status === "STATIC_COMPLETE").length) {
    context.addIssue({ code: "custom", path: ["summary"], message: "Projection summary does not match model rows." });
  }
  const keys = catalog.models.map((model) => `${model.model_id}\u0000${model.operation_id}`);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: ["models"], message: "Model/operation bindings must be unique." });
  for (const model of catalog.models) {
    for (const field of model.field_evidence) {
      for (const control of field.static_control_evidence) {
        if (control.field !== field.field) {
          context.addIssue({ code: "custom", path: ["models"], message: "Static control evidence must remain attached to its exact field." });
        }
        if (model.settings_form_binding.form_id === null ||
            field.source.form_id !== model.settings_form_binding.form_id ||
            field.source.form_source_sha256 !== model.settings_form_binding.source_sha256) {
          context.addIssue({ code: "custom", path: ["models"], message: "Static control evidence must remain bound to the selected model form hash." });
        }
      }
    }
  }
  const controls = catalog.models.flatMap((model) => model.field_evidence.flatMap((field) => field.static_control_evidence));
  if (catalog.summary.static_ui_control_facts !== controls.length ||
      catalog.summary.static_ui_nullable_option_controls !== controls.filter((control) => control.options_nullable).length ||
      catalog.summary.static_ui_dynamic_option_controls !== controls.filter((control) => control.options_status === "DYNAMIC" || control.options_status === "UNRESOLVED_LOCAL_IMPORT").length ||
      catalog.summary.static_ui_guarded_controls !== controls.filter((control) => control.conditions.length > 0).length) {
    context.addIssue({ code: "custom", path: ["summary"], message: "Static UI control evidence summary does not match field records." });
  }
  const unresolvedModelValueControls = catalog.models.reduce((sum, model) =>
    sum + model.settings_form_binding.unresolved_model_value_controls.length, 0);
  if (catalog.summary.static_ui_unresolved_model_value_controls !== unresolvedModelValueControls) {
    context.addIssue({ code: "custom", path: ["summary"], message: "Unresolved modelValue evidence summary does not match form records." });
  }
  if (catalog.summary.models_with_unresolved_form_control_structure !==
      catalog.models.filter((model) => model.settings_form_binding.control_structure_status === "UNRESOLVED_STRUCTURE").length) {
    context.addIssue({ code: "custom", path: ["summary"], message: "Unresolved form-control structure summary does not match model rows." });
  }
  if (catalog.summary.models_with_not_checked_form_control_structure !==
      catalog.models.filter((model) => model.settings_form_binding.control_structure_status === "NOT_CHECKED").length) {
    context.addIssue({ code: "custom", path: ["summary"], message: "Not-checked form-control structure summary does not match model rows." });
  }
  if (catalog.summary.models_with_matched_settings3_ai_name !== catalog.models.filter((model) =>
      model.settings_form_binding.source_store_binding?.ai_name_match_status === "MATCHED").length ||
      catalog.summary.models_with_unresolved_settings_root !== catalog.models.filter((model) => {
        const root = model.settings_form_binding.source_store_binding?.settings_root_status;
        return root === "UNRESOLVED_GLOBAL_IDENTIFIER" || root === "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED";
      }).length ||
      catalog.summary.ui_only_field_facts !== catalog.models.reduce((sum, model) =>
        sum + model.field_evidence.filter((field) => field.public_settings_status === "ABSENT" &&
          (field.static_control_evidence.length > 0 || field.unresolved_control_evidence.length > 0)).length, 0)) {
    context.addIssue({ code: "custom", path: ["summary"], message: "Source-store and UI-only evidence summary does not match model rows." });
  }
});

export type StaticGenerationParameterSchemaCatalog = z.infer<typeof staticGenerationParameterSchemaCatalogSchema>;
export type StaticGenerationParameterSchemaModel = StaticGenerationParameterSchemaCatalog["models"][number];

export interface BuildStaticGenerationParameterSchemasInput {
  publicCatalog: SyntxPublicCatalogSnapshot;
  publicCatalogVersion: string;
  settingsInventory: MaplessSettingsInventory;
  settingsInventoryVersion: string;
  staticFormControlAnalysis?: StaticFormControlAnalysis | undefined;
}

export type StaticGenerationParameterSchemaErrorCode =
  | "PUBLIC_CATALOG_INVALID"
  | "PUBLIC_CATALOG_VERSION_INVALID"
  | "PUBLIC_CATALOG_HASH_MISMATCH"
  | "SETTINGS_INVENTORY_INVALID"
  | "SETTINGS_INVENTORY_VERSION_INVALID"
  | "SETTINGS_INVENTORY_HASH_MISMATCH"
  | "MAPLESS_PUBLIC_CATALOG_MISMATCH"
  | "MAPLESS_MODEL_BINDING_MISMATCH"
  | "MAPLESS_FORM_BINDING_MISMATCH"
  | "STATIC_FORM_ANALYSIS_BINDING_MISMATCH"
  | "STATIC_SCHEMA_ARTIFACT_HASH_MISMATCH"
  | "STATIC_SCHEMA_ARTIFACT_INVALID";

export class StaticGenerationParameterSchemaError extends Error {
  constructor(readonly code: StaticGenerationParameterSchemaErrorCode) {
    super("Static generation parameter evidence is not bound to the selected public catalog and settings inventory.");
    this.name = "StaticGenerationParameterSchemaError";
  }
}

export interface ParsedStaticGenerationParameterSchemaArtifact {
  readonly catalog: StaticGenerationParameterSchemaCatalog;
  readonly source_schema_version: "1.1.0" | "1.2.0";
  readonly migration_status: "CURRENT" | "LEGACY_V1_1_DEFAULTED_UNKNOWN";
  readonly sha256: string;
}

/** Verify exact bytes before parsing; legacy v1.1 input is upgraded in memory with conservative unknown defaults. */
export function parseStaticGenerationParameterSchemaArtifact(
  serializedArtifact: string,
  expectedSha256: string
): ParsedStaticGenerationParameterSchemaArtifact {
  if (!/^sha256:[a-f0-9]{64}$/u.test(expectedSha256)) throw projectionError("STATIC_SCHEMA_ARTIFACT_HASH_MISMATCH");
  const actualSha256 = "sha256:" + createHash("sha256").update(serializedArtifact, "utf8").digest("hex");
  if (actualSha256 !== expectedSha256) throw projectionError("STATIC_SCHEMA_ARTIFACT_HASH_MISMATCH");
  let decoded: unknown;
  try { decoded = JSON.parse(serializedArtifact); }
  catch { throw projectionError("STATIC_SCHEMA_ARTIFACT_INVALID"); }
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw projectionError("STATIC_SCHEMA_ARTIFACT_INVALID");
  }
  const sourceVersion = (decoded as Record<string, unknown>).schema_version;
  if (sourceVersion !== "1.1.0" && sourceVersion !== "1.2.0") throw projectionError("STATIC_SCHEMA_ARTIFACT_INVALID");
  let catalog: StaticGenerationParameterSchemaCatalog;
  try {
    const input = sourceVersion === "1.1.0" ? migrateLegacyProjectionV1_1(decoded) : decoded;
    catalog = staticGenerationParameterSchemaCatalogSchema.parse(input);
  }
  catch { throw projectionError("STATIC_SCHEMA_ARTIFACT_INVALID"); }
  return {
    catalog,
    source_schema_version: sourceVersion,
    migration_status: sourceVersion === "1.1.0" ? "LEGACY_V1_1_DEFAULTED_UNKNOWN" : "CURRENT",
    sha256: actualSha256
  };
}

function migrateLegacyProjectionV1_1(decoded: unknown): unknown {
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) return decoded;
  const legacy = structuredClone(decoded) as Record<string, unknown>;
  const models = Array.isArray(legacy.models) ? legacy.models : [];
  let notChecked = 0;
  let unresolved = 0;
  for (const modelValue of models) {
    if (modelValue === null || typeof modelValue !== "object" || Array.isArray(modelValue)) continue;
    const model = modelValue as Record<string, unknown>;
    const binding = model.settings_form_binding && typeof model.settings_form_binding === "object"
      ? model.settings_form_binding as Record<string, unknown>
      : null;
    if (binding) {
      binding.control_structure_status ??= "NOT_CHECKED";
      binding.source_store_binding ??= null;
      binding.unresolved_model_value_controls ??= [];
      notChecked += Number(binding.control_structure_status === "NOT_CHECKED");
      unresolved += Number(binding.control_structure_status === "UNRESOLVED_STRUCTURE");
    }
    if (!Array.isArray(model.field_evidence)) continue;
    for (const evidenceValue of model.field_evidence) {
      if (evidenceValue === null || typeof evidenceValue !== "object" || Array.isArray(evidenceValue)) continue;
      const evidence = evidenceValue as Record<string, unknown>;
      evidence.public_settings_status ??= "UNKNOWN";
      evidence.unresolved_control_evidence ??= [];
      if (!Array.isArray(evidence.static_control_evidence)) continue;
      for (const controlValue of evidence.static_control_evidence) {
        if (controlValue === null || typeof controlValue !== "object" || Array.isArray(controlValue)) continue;
        const control = controlValue as Record<string, unknown>;
        control.numeric_prop_facts ??= null;
        const sourceContext = control.source_context && typeof control.source_context === "object"
          ? control.source_context as Record<string, unknown>
          : null;
        if (sourceContext) {
          sourceContext.settings_root_status ??= "UNRESOLVED_GLOBAL_IDENTIFIER";
          sourceContext.setting_root_identifier ??= null;
          sourceContext.settings_context_evidence ??= {
            status: "NOT_OBSERVED",
            helper_import: null,
            helper_call_location: null,
            context_argument_identifier: null,
            context_argument_origin_import: null
          };
        }
      }
    }
  }
  const summary = legacy.summary && typeof legacy.summary === "object" && !Array.isArray(legacy.summary)
    ? legacy.summary as Record<string, unknown>
    : null;
  if (summary) {
    summary.models_with_unresolved_form_control_structure ??= unresolved;
    summary.models_with_not_checked_form_control_structure ??= notChecked;
    summary.models_with_matched_settings3_ai_name ??= 0;
    summary.models_with_unresolved_settings_root ??= 0;
    summary.ui_only_field_facts ??= 0;
    summary.static_ui_unresolved_model_value_controls ??= 0;
  }
  legacy.schema_version = "1.1.0";
  return legacy;
}

const NUMERIC_LIMIT_BINDINGS: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  video_duration: ["min_video_duration", "max_video_duration"],
  audio_duration: ["min_audio_duration", "max_audio_duration"],
  video_total_duration: ["min_video_total_duration", "max_video_total_duration"],
  audio_total_duration: ["min_audio_total_duration", "max_audio_total_duration"],
  image_width: ["min_image_width", "max_image_width"],
  image_height: ["min_image_height", "max_image_height"],
  image_pixel_count: ["min_image_pixel_count", "max_image_pixel_count"],
  video_width: ["min_video_width", "max_video_width"],
  video_height: ["min_video_height", "max_video_height"],
  video_fps: ["min_video_fps", "max_video_fps"],
  video_pixel_count: ["min_video_pixel_count", "max_video_pixel_count"]
});

const SERVER_OWNED_FIELDS = new Set(["model_type", "ai_name"]);
const PUBLIC_METADATA_FIELDS = new Set([
  "accepted_file_types", "allowed_media_types", "attach_info_text",
  "file_count_limit", "files_mention", "get_cost_params",
  "hdr_video_support", "max_audio_duration", "max_audio_file_size",
  "max_audio_total_duration", "max_file_size", "max_image_aspect_ratio",
  "max_image_dimension", "max_image_file_size", "max_image_height",
  "max_image_pixel_count", "max_image_width", "max_prompt_length", "max_side",
  "max_total_file_size", "max_video_aspect_ratio", "max_video_duration",
  "max_video_file_size", "max_video_fps", "max_video_height",
  "max_video_pixel_count", "max_video_total_duration", "max_video_width",
  "min_audio_duration", "min_audio_total_duration", "min_dimension",
  "min_image_aspect_ratio", "min_image_height", "min_image_pixel_count",
  "min_image_width", "min_prompt_length", "min_side", "min_video_aspect_ratio",
  "min_video_duration", "min_video_fps", "min_video_height",
  "min_video_pixel_count", "min_video_total_duration", "min_video_width",
  "models", "prohibited_codecs", "uploadable"
]);

/** Build a deterministic, source-bound candidate catalog; it never promotes static facts to executable contracts. */
export function buildStaticGenerationParameterSchemas(
  input: BuildStaticGenerationParameterSchemasInput
): StaticGenerationParameterSchemaCatalog {
  const publicCatalog = parsePublicCatalog(input.publicCatalog);
  const settingsInventory = parseSettingsInventory(input.settingsInventory);
  verifyArtifactVersion(input.publicCatalogVersion, serializeSyntxPublicCatalogSnapshot(publicCatalog), "PUBLIC_CATALOG_VERSION_INVALID", "PUBLIC_CATALOG_HASH_MISMATCH");
  verifyArtifactVersion(input.settingsInventoryVersion, serializeMaplessSettingsInventory(settingsInventory), "SETTINGS_INVENTORY_VERSION_INVALID", "SETTINGS_INVENTORY_HASH_MISMATCH");
  if (
    settingsInventory.public_catalog.version !== input.publicCatalogVersion ||
    settingsInventory.public_catalog.fetched_at !== publicCatalog.fetched_at ||
    settingsInventory.public_catalog.models_sha256 !== publicCatalog.sources.models.canonical_sha256
  ) throw projectionError("MAPLESS_PUBLIC_CATALOG_MISMATCH");

  let formControlAnalysis: StaticFormControlAnalysis | undefined;
  if (input.staticFormControlAnalysis !== undefined) {
    try { formControlAnalysis = staticFormControlAnalysisSchema.parse(input.staticFormControlAnalysis); }
    catch { throw projectionError("STATIC_FORM_ANALYSIS_BINDING_MISMATCH"); }
    if (formControlAnalysis.public_catalog_version !== input.publicCatalogVersion ||
        formControlAnalysis.settings_inventory_version !== input.settingsInventoryVersion ||
        formControlAnalysis.build_id !== settingsInventory.build.id || formControlAnalysis.runtime_usable !== false) {
      throw projectionError("STATIC_FORM_ANALYSIS_BINDING_MISMATCH");
    }
  }

  const discovery = new DiscoveryCatalogRepository(publicCatalog);
  const maplessByModelId = new Map(settingsInventory.models.map((model) => [model.model_id, model] as const));
  const formsById = new Map(settingsInventory.forms.map((form) => [form.form_id, form] as const));
  const publicModelsById = new Map(publicCatalog.models.map((model) => [model.value, model] as const));
  const catalogModelIds = new Set(publicCatalog.models.map((model) => model.value));
  validateMaplessModelBindings(publicModelsById, maplessByModelId);

  const rows = publicCatalog.models
    .filter((publicModel) => publicModel.active)
    .map((publicModel) => {
      const discoveryModel = discovery.getModel(publicModel.value);
      const operation = discoveryModel.operations.find((candidate) =>
        (candidate.id === "generate-image" && candidate.output_modality === "image") ||
        (candidate.id === "generate-video" && candidate.output_modality === "video")
      );
      if (!operation) return null;
      const operationId = operation.id === "generate-image" ? "generate-image" : "generate-video";
      const modality = operation.id === "generate-image" ? "image" : "video";
      const mapless = maplessByModelId.get(publicModel.value);
      if (!mapless) throw projectionError("MAPLESS_MODEL_BINDING_MISMATCH");
      return projectModel({
        publicModel,
        mapless,
        form: mapless.form_id === null ? undefined : formsById.get(mapless.form_id),
        catalogVersion: input.publicCatalogVersion,
        settingsInventoryVersion: input.settingsInventoryVersion,
        formControlAnalysis,
        catalogModelIds,
        operationId,
        modality
      });
    })
    .filter((model): model is StaticGenerationParameterSchemaModel => model !== null)
    .sort((left, right) => left.model_id.localeCompare(right.model_id));

  const imageModels = rows.filter((model) => model.modality === "image").length;
  const videoModels = rows.filter((model) => model.modality === "video").length;
  const staticCompleteModels = rows.filter((model) => model.schema_status === "STATIC_COMPLETE").length;
  const output = {
    schema_version: "1.2.0" as const,
    catalog_kind: "STATIC_GENERATION_PARAMETER_SCHEMA_PROJECTION" as const,
    status: "STATIC_PARTIAL" as const,
    runtime_usable: false as const,
    public_catalog: {
      version: input.publicCatalogVersion,
      fetched_at: publicCatalog.fetched_at,
      source_hashes: {
        ai: publicCatalog.sources.ai.canonical_sha256,
        llm_models: publicCatalog.sources.llm_models.canonical_sha256,
        models: publicCatalog.sources.models.canonical_sha256
      }
    },
    settings_inventory: {
      version: input.settingsInventoryVersion,
      generated_at: settingsInventory.generated_at,
      build_id: settingsInventory.build.id,
      public_catalog_version: settingsInventory.public_catalog.version,
      public_models_sha256: settingsInventory.public_catalog.models_sha256
    },
    summary: {
      projected_models: rows.length,
      image_models: imageModels,
      video_models: videoModels,
      static_complete_models: staticCompleteModels,
      static_partial_models: rows.length - staticCompleteModels,
      models_with_proven_enum_fields: rows.filter((model) => model.field_evidence.some((field) => field.status === "PROVEN_PUBLIC_ENUM")).length,
      projected_enum_fields: rows.reduce((total, model) => total + model.field_evidence.filter((field) => field.status === "PROVEN_PUBLIC_ENUM").length, 0),
      public_numeric_constraint_facts: rows.reduce((total, model) => total + model.field_evidence.filter((field) => field.public_constraint !== null).length, 0),
      static_ui_control_facts: rows.reduce((total, model) => total + model.field_evidence.reduce((subTotal, field) => subTotal + field.static_control_evidence.length, 0), 0),
      static_ui_nullable_option_controls: rows.reduce((total, model) => total + model.field_evidence.reduce((subTotal, field) => subTotal + field.static_control_evidence.filter((control) => control.options_nullable).length, 0), 0),
      static_ui_dynamic_option_controls: rows.reduce((total, model) => total + model.field_evidence.reduce((subTotal, field) => subTotal + field.static_control_evidence.filter((control) => control.options_status === "DYNAMIC" || control.options_status === "UNRESOLVED_LOCAL_IMPORT").length, 0), 0),
      static_ui_guarded_controls: rows.reduce((total, model) => total + model.field_evidence.reduce((subTotal, field) => subTotal + field.static_control_evidence.filter((control) => control.conditions.length > 0).length, 0), 0),
      static_ui_unresolved_model_value_controls: rows.reduce((total, model) => total + model.settings_form_binding.unresolved_model_value_controls.length, 0),
      models_with_unresolved_form_control_structure: rows.filter((model) => model.settings_form_binding.control_structure_status === "UNRESOLVED_STRUCTURE").length,
      models_with_not_checked_form_control_structure: rows.filter((model) => model.settings_form_binding.control_structure_status === "NOT_CHECKED").length,
      models_with_matched_settings3_ai_name: rows.filter((model) => model.settings_form_binding.source_store_binding?.ai_name_match_status === "MATCHED").length,
      models_with_unresolved_settings_root: rows.filter((model) => {
        const root = model.settings_form_binding.source_store_binding?.settings_root_status;
        return root === "UNRESOLVED_GLOBAL_IDENTIFIER" || root === "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED";
      }).length,
      ui_only_field_facts: rows.reduce((total, model) => total + model.field_evidence.filter((field) =>
        field.public_settings_status === "ABSENT" &&
        (field.static_control_evidence.length > 0 || field.unresolved_control_evidence.length > 0)
      ).length, 0)
    },
    models: rows
  };
  return staticGenerationParameterSchemaCatalogSchema.parse(output);
}

interface ProjectModelInput {
  publicModel: SyntxPublicModelEntry;
  mapless: MaplessSettingsInventory["models"][number];
  form: MaplessSettingsInventory["forms"][number] | undefined;
  catalogVersion: string;
  settingsInventoryVersion: string;
  formControlAnalysis: StaticFormControlAnalysis | undefined;
  catalogModelIds: ReadonlySet<string>;
  operationId: "generate-image" | "generate-video";
  modality: "image" | "video";
}

function projectModel(input: ProjectModelInput): StaticGenerationParameterSchemaModel {
  const { publicModel, mapless, form } = input;
  if (!sameJson(publicModel.settings, mapless.settings) || publicModel.ai_name !== mapless.ai_name ||
      publicModel.active !== mapless.active || publicModel.type !== mapless.public_type_label) {
    throw projectionError("MAPLESS_MODEL_BINDING_MISMATCH");
  }
  const formBound = mapless.form_binding_status === "STRUCTURAL_MATCH" && mapless.form_id !== null && form !== undefined;
  if (mapless.form_binding_status === "STRUCTURAL_MATCH" && (!form || form.form_id !== mapless.form_id)) {
    throw projectionError("MAPLESS_FORM_BINDING_MISMATCH");
  }
  if (formBound && !sameStrings(form.javascript.model_value_settings_keys, mapless.model_value_settings_keys)) {
    throw projectionError("MAPLESS_FORM_BINDING_MISMATCH");
  }

  const sameSourceFormEvidence = formBound && input.formControlAnalysis !== undefined
    ? input.formControlAnalysis.forms.find((candidate) => candidate.form_id === form!.form_id &&
        candidate.source_sha256 === form!.javascript.sha256)
    : undefined;
  if (sameSourceFormEvidence && (sameSourceFormEvidence.url !== form!.javascript.url ||
      sameSourceFormEvidence.module_name !== form!.module_name || sameSourceFormEvidence.bytes !== form!.javascript.bytes)) {
    throw projectionError("STATIC_FORM_ANALYSIS_BINDING_MISMATCH");
  }
  const formControlEvidence = sameSourceFormEvidence?.model_ids.includes(publicModel.value) ? sameSourceFormEvidence : undefined;
  const controlStructureStatus = sameSourceFormEvidence?.control_structure_status ?? "NOT_CHECKED";
  const sourceStore = sameSourceFormEvidence?.settings3_store_binding ?? null;
  const sourceStoreAiMatchStatus: "MATCHED" | "MISMATCH" | "NOT_CHECKED" =
    sourceStore?.status !== "SETTINGS3_U_STORE_BOUND" ? "NOT_CHECKED"
      : sourceStore.ai_name === publicModel.ai_name ? "MATCHED" : "MISMATCH";
  const projectedSourceStore = sourceStore === null
    ? null
    : { ...sourceStore, ai_name_match_status: sourceStoreAiMatchStatus };
  const canUseSourceControls = sourceStore?.status !== "SETTINGS3_U_STORE_BOUND" || sourceStoreAiMatchStatus === "MATCHED";

  const formSourceSha256 = formBound ? form!.javascript.sha256 : null;
  const settings = publicModel.settings ?? {};
  const settingsRecord = settings as Record<string, unknown>;
  const properties: Record<string, GenerationParameterProperty> = {};
  const fieldEvidence: z.infer<typeof fieldEvidenceSchema>[] = [];
  const unknownFieldKeys: string[] = [];
  const storeDerivedControlKeys = sourceStoreAiMatchStatus === "MATCHED"
    ? formControlEvidence?.controls
      .filter((control) => control.source_context.setting_binding_kind === "DIRECT_COMPONENT_CONTEXT_SETTINGS_PROPERTY")
      .map((control) => control.field) ?? []
    : [];
  const nestedControlKeys = sourceStoreAiMatchStatus === "MATCHED"
    ? formControlEvidence?.unresolved_model_value_controls
      .map((control) => control.collection_source_settings_field)
      .filter((field): field is string => field !== null) ?? []
    : [];
  const candidateKeys = [...new Set([...mapless.model_value_settings_keys, ...storeDerivedControlKeys, ...nestedControlKeys])].sort();
  const controlsForField = (field: string): StaticFormControlEvidence[] =>
    canUseSourceControls ? formControlEvidence?.controls.filter((control) => control.field === field) ?? [] : [];
  const unresolvedControlsForField = (field: string): StaticFormControlAnalysis["forms"][number]["unresolved_model_value_controls"] =>
    canUseSourceControls ? formControlEvidence?.unresolved_model_value_controls.filter((control) => control.collection_source_settings_field === field) ?? [] : [];
  const publicSettingsStatus = (field: string): "PRESENT" | "ABSENT" =>
    settingsRecord[field === "mode" ? "allowed_modes" : field] === undefined ? "ABSENT" : "PRESENT";

  const promptProperty = promptSchema(settings);
  const promptControls = controlsForField("prompt");
  properties.prompt = promptProperty;
  fieldEvidence.push({
    field: "prompt",
    status: "COMMON_OPERATION_FIELD",
    property_schema: promptProperty,
    public_constraint: null,
    public_settings_status: "NOT_APPLICABLE",
    static_control_evidence: promptControls,
    unresolved_control_evidence: [],
    source: {
      kind: "COMMON_REQUEST_PORT",
      form_id: promptControls.length > 0 ? mapless.form_id : null,
      form_source_sha256: promptControls.length > 0 ? formSourceSha256 : null,
      public_setting_keys: [
        ...(positiveInteger(settings.min_prompt_length) ? ["min_prompt_length"] : []),
        ...(positiveInteger(settings.max_prompt_length) ? ["max_prompt_length"] : [])
      ]
    },
    blockers: ["COMMON_PROMPT_TRIM_POLICY_NOT_PROJECTED"]
  });

  for (const field of candidateKeys) {
    if (field === "prompt") continue;
    const staticControls = controlsForField(field);
    const unresolvedControlFacts = unresolvedControlsForField(field);
    const staticControl = staticControls.length === 1 ? staticControls[0] : undefined;
    if (SERVER_OWNED_FIELDS.has(field)) {
      fieldEvidence.push({
        field,
        status: "SERVER_OWNED",
        property_schema: null,
        public_constraint: null,
        public_settings_status: "NOT_APPLICABLE",
        static_control_evidence: staticControls,
        unresolved_control_evidence: unresolvedControlFacts,
        source: { kind: "TRANSPORT_OWNED", form_id: mapless.form_id, form_source_sha256: formSourceSha256, public_setting_keys: [] },
        blockers: ["SERVER_OWNED_FIELD_NOT_CALLER_PARAMETER"]
      });
      continue;
    }
    if (PUBLIC_METADATA_FIELDS.has(field)) {
      fieldEvidence.push({
        field,
        status: "UNKNOWN",
        property_schema: null,
        public_constraint: null,
        public_settings_status: publicSettingsStatus(field),
        static_control_evidence: staticControls,
        unresolved_control_evidence: unresolvedControlFacts,
        source: {
          kind: "MODEL_VALUE_SETTINGS_KEYS",
          form_id: mapless.form_id,
          form_source_sha256: formSourceSha256,
          public_setting_keys: []
        },
        blockers: ["PUBLIC_METADATA_NOT_CALLER_PARAMETER"]
      });
      continue;
    }

    const enumResult = formBound ? enumForField(field, settings) : null;
    if (enumResult) {
      properties[field] = enumResult.property;
      fieldEvidence.push({
        field,
        status: "PROVEN_PUBLIC_ENUM",
        property_schema: enumResult.property,
        public_constraint: null,
        public_settings_status: "PRESENT",
        static_control_evidence: staticControls,
        unresolved_control_evidence: unresolvedControlFacts,
        source: {
          kind: "MODEL_VALUE_SETTINGS_KEYS",
          form_id: mapless.form_id,
          form_source_sha256: formSourceSha256,
          public_setting_keys: [enumResult.publicSettingKey]
        },
        blockers: []
      });
      continue;
    }

    const controlProjection = staticControl ? staticFormControlProperty(
      staticControl,
      formControlEvidence!.watch_effects,
      publicModel.value,
      input.catalogModelIds
    ) : null;
    if (controlProjection) {
      properties[field] = controlProjection.property;
      fieldEvidence.push({
        field,
        status: "STATIC_FORM_CONTROL_CANDIDATE",
        property_schema: controlProjection.property,
        public_constraint: null,
        public_settings_status: publicSettingsStatus(field),
        static_control_evidence: staticControls,
        unresolved_control_evidence: unresolvedControlFacts,
        source: {
          kind: "HASH_PINNED_FORM_CONTROL_AST",
          form_id: mapless.form_id,
          form_source_sha256: formSourceSha256,
          public_setting_keys: []
        },
        blockers: [
          ...controlProjection.blockers,
          ...(publicSettingsStatus(field) === "ABSENT" ? ["UI_ONLY_FIELD_NOT_IN_PUBLIC_SETTINGS"] : []),
          ...(sourceStore?.settings_root_status === "UNRESOLVED_GLOBAL_IDENTIFIER" ||
              sourceStore?.settings_root_status === "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED"
            ? ["SOURCE_SETTINGS_ROOT_ORIGIN_UNRESOLVED"]
            : [])
        ]
      });
      continue;
    }

    const numericFact = numericConstraintForField(field, settings);
    if (numericFact) {
      fieldEvidence.push({
        field,
        status: "PUBLIC_NUMERIC_BOUNDS_TYPE_UNKNOWN",
        property_schema: null,
        public_constraint: numericFact,
        public_settings_status: "PRESENT",
        static_control_evidence: staticControls,
        unresolved_control_evidence: unresolvedControlFacts,
        source: {
          kind: "MODEL_VALUE_SETTINGS_KEYS",
          form_id: mapless.form_id,
          form_source_sha256: formSourceSha256,
          public_setting_keys: [...numericFact.source_setting_keys]
        },
        blockers: ["CALLER_VALUE_TYPE_NOT_PROVEN"]
      });
      unknownFieldKeys.push(field);
      continue;
    }

    const controlBlockers = staticControls.flatMap((control) =>
      staticControlBlockers(control, formControlEvidence?.watch_effects ?? [], publicModel.value, input.catalogModelIds)
    );
    const evidenceBlockers = controlBlockers.length > 0
      ? [...new Set(controlBlockers)].slice(0, 8)
      : [controlStructureStatus === "UNRESOLVED_STRUCTURE"
        ? "FORM_SOURCE_CONTROL_STRUCTURE_UNRESOLVED"
        : unresolvedControlFacts.length > 0 ? "PROVIDER_NESTED_OR_NONSETTINGS_UI_CONTROL"
        : formBound ? "NO_TYPED_PUBLIC_PARAMETER_CONSTRAINT" : "FORM_SOURCE_BINDING_UNKNOWN"];
    if (publicSettingsStatus(field) === "ABSENT" && staticControls.length + unresolvedControlFacts.length > 0) {
      evidenceBlockers.push("UI_ONLY_FIELD_NOT_IN_PUBLIC_SETTINGS");
    }
    if (sourceStoreAiMatchStatus === "MISMATCH") evidenceBlockers.push("SETTINGS3_AI_NAME_MISMATCH");
    if (sourceStore?.settings_root_status === "UNRESOLVED_GLOBAL_IDENTIFIER" ||
        sourceStore?.settings_root_status === "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED") {
      if (staticControls.length + unresolvedControlFacts.length > 0) evidenceBlockers.push("SOURCE_SETTINGS_ROOT_ORIGIN_UNRESOLVED");
    }
    fieldEvidence.push({
      field,
      status: "UNKNOWN",
      property_schema: null,
      public_constraint: null,
      public_settings_status: publicSettingsStatus(field),
      static_control_evidence: staticControls,
      unresolved_control_evidence: unresolvedControlFacts,
      source: {
        kind: "MODEL_VALUE_SETTINGS_KEYS",
        form_id: mapless.form_id,
        form_source_sha256: formSourceSha256,
        public_setting_keys: []
      },
      blockers: evidenceBlockers
    });
    unknownFieldKeys.push(field);
  }

  const blockers = new Set<string>([
    "DEFAULTS_NOT_PROJECTED",
    "CONDITIONAL_RULES_NOT_FULLY_EVALUATED",
    "GENERATION_PAYLOAD_NOT_RUNTIME_VERIFIED"
  ]);
  if (!formBound && mapless.model_value_settings_keys.length > 0) blockers.add("FORM_SOURCE_BINDING_UNKNOWN");
  if (formBound && input.formControlAnalysis !== undefined && !formControlEvidence) blockers.add("FORM_CONTROL_AST_BINDING_MISSING");
  if (controlStructureStatus === "UNRESOLVED_STRUCTURE") blockers.add("FORM_SOURCE_CONTROL_STRUCTURE_UNRESOLVED");
  if (sourceStoreAiMatchStatus === "MISMATCH") blockers.add("SETTINGS3_AI_NAME_MISMATCH");
  if (sourceStore?.status === "UNRESOLVED_SETTINGS3_STORE_CALL") blockers.add("SETTINGS3_STORE_BINDING_UNRESOLVED");
  if (sourceStore?.settings_root_status === "UNRESOLVED_GLOBAL_IDENTIFIER" ||
      sourceStore?.settings_root_status === "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED") blockers.add("SOURCE_SETTINGS_ROOT_ORIGIN_UNRESOLVED");
  if (unknownFieldKeys.length > 0) blockers.add("UNPROJECTED_PARAMETER_VALUE_TYPES");
  if (mapless.settings_status === "UNKNOWN") blockers.add("PUBLIC_SETTINGS_UNKNOWN");

  const schema = {
    type: "object" as const,
    additional_properties: false as const,
    required: ["prompt"],
    properties
  };
  return {
    model_id: publicModel.value,
    ai_name: publicModel.ai_name,
    operation_id: input.operationId,
    modality: input.modality,
    active: true,
    schema_status: "STATIC_PARTIAL",
    runtime_usable: false,
    public_model_binding: {
      model_id: publicModel.value,
      ai_name: publicModel.ai_name,
      upstream_model_value: publicModel.value,
      canonical_sha256: sha256CanonicalPayload(publicModel)
    },
    settings_form_binding: {
      form_id: mapless.form_id,
      status: mapless.form_binding_status,
      module_name: form?.module_name ?? null,
      source_sha256: formSourceSha256,
      control_structure_status: formBound ? controlStructureStatus : "NOT_CHECKED",
      source_store_binding: projectedSourceStore,
      unresolved_model_value_controls: formControlEvidence?.unresolved_model_value_controls ?? []
    },
    parameter_schema: schema,
    required_fields_status: "COMMON_REQUEST_PORT_ONLY",
    defaults_status: "NOT_PROJECTED",
    conditions_status: "UNKNOWN",
    wire_status: "NOT_RUNTIME_VERIFIED",
    field_evidence: fieldEvidence,
    unknown_field_keys: [...new Set(unknownFieldKeys)].sort(),
    excluded_public_metadata_keys: [...new Set([
      ...mapless.generic_setting_keys,
      ...Object.keys(settings).filter((key) => !candidateKeys.includes(key) && key !== "max_prompt_length" && key !== "min_prompt_length")
    ])].sort(),
    blockers: [...blockers].sort(),
    schema_sha256: sha256CanonicalPayload({ schema, field_evidence: fieldEvidence, bindings: {
      catalog_version: input.catalogVersion,
      settings_inventory_version: input.settingsInventoryVersion,
      model_id: publicModel.value,
      form_id: mapless.form_id,
      form_source_sha256: formSourceSha256
    } })
  };
}

function promptSchema(settings: Record<string, unknown>): GenerationParameterProperty {
  const min = positiveInteger(settings.min_prompt_length) ? settings.min_prompt_length : undefined;
  const max = positiveInteger(settings.max_prompt_length) ? settings.max_prompt_length : undefined;
  return {
    type: "string",
    ...(min === undefined ? {} : { min_length: min }),
    ...(max === undefined ? {} : { max_length: max })
  };
}

function staticFormControlProperty(
  control: StaticFormControlEvidence,
  watchEffects: StaticFormControlAnalysis["forms"][number]["watch_effects"],
  modelId: string,
  boundModelIds: ReadonlySet<string>
): { property: GenerationParameterProperty; blockers: string[] } | null {
  const type = control.value_type;
  if (type === null || control.source_context.setting_binding_kind === "COMPUTED_GETTER_TRANSFORMED" ||
      control.numeric_constraints?.step !== undefined ||
      watchEffects.some((effect) => effect.written_fields.includes(control.field))) return null;
  const conditionMatch = staticModelTypeConditionMatch(control.conditions, modelId, boundModelIds);
  if (conditionMatch !== true) return null;

  let candidate: Record<string, unknown>;
  const staticOptions = control.options_status === "STATIC_LITERAL_ARRAY" ||
    control.options_status === "STATIC_LOCAL_CONSTANT" || control.options_status === "STATIC_VNODE_CHILDREN";
  if (staticOptions) {
    const values = control.option_values.map((option) => option.value);
    if (values.length === 0 || values.length > 200 || values.some((value) => value === null) ||
        new Set(values.map(stableScalar)).size !== values.length || enumValueType(values) !== type) return null;
    candidate = { type, enum: values };
  } else if ((type === "number" || type === "integer") && control.numeric_constraints !== null) {
    candidate = {
      type,
      ...(control.numeric_constraints.minimum === undefined ? {} : { minimum: control.numeric_constraints.minimum }),
      ...(control.numeric_constraints.maximum === undefined ? {} : { maximum: control.numeric_constraints.maximum })
    };
  } else if (type === "string" && control.string_constraints !== null) {
    candidate = {
      type,
      ...(control.string_constraints.min_length === undefined ? {} : { min_length: control.string_constraints.min_length }),
      ...(control.string_constraints.max_length === undefined ? {} : { max_length: control.string_constraints.max_length })
    };
  } else {
    candidate = { type };
  }
  const parsed = propertySchema.safeParse(candidate);
  return parsed.success ? {
    property: parsed.data,
    blockers: [
      ...(control.conditions.length > 0 ? ["STATIC_MODEL_TYPE_CONDITION_MATCHED_TO_CATALOG_MODEL"] : []),
      "STATIC_UI_CONTROL_CANDIDATE_NOT_WIRE_VERIFIED"
    ]
  } : null;
}

function staticModelTypeConditionMatch(
  conditions: StaticFormControlEvidence["conditions"],
  modelId: string,
  catalogModelIds: ReadonlySet<string>
): boolean | null {
  for (const condition of conditions) {
    if (condition.field !== "model_type" || typeof condition.value !== "string" ||
        !catalogModelIds.has(condition.value)) return null;
    let matches = modelId === condition.value;
    if (condition.operator === "!==" || condition.operator === "!=") matches = !matches;
    else if (condition.operator !== "===" && condition.operator !== "==" && condition.operator !== "SWITCH_CASE") return null;
    const branchMatches = condition.branch === "ELSE" ? !matches : matches;
    if (!branchMatches) return false;
  }
  return true;
}

function staticControlBlockers(
  control: StaticFormControlEvidence,
  watchEffects: StaticFormControlAnalysis["forms"][number]["watch_effects"],
  modelId: string,
  catalogModelIds: ReadonlySet<string>
): string[] {
  const blockers: string[] = [];
  const conditionMatch = staticModelTypeConditionMatch(control.conditions, modelId, catalogModelIds);
  if (conditionMatch === null) blockers.push("STATIC_CONTROL_CONDITIONS_UNRESOLVED");
  else if (conditionMatch === false) blockers.push("STATIC_CONTROL_NOT_PRESENT_FOR_CATALOG_MODEL");
  if (control.source_context.setting_binding_kind === "COMPUTED_GETTER_TRANSFORMED") blockers.push("COMPUTED_CONTROL_GETTER_TRANSFORMED");
  if (watchEffects.some((effect) => effect.written_fields.includes(control.field))) blockers.push("STATIC_CONTROL_WATCH_MUTATION_NOT_EVALUATED");
  if (control.options_nullable) blockers.push("STATIC_UI_ENUM_NULL_NOT_SUPPORTED_BY_PARAMETER_PROPERTY");
  if (control.options_status === "DYNAMIC" || control.options_status === "UNRESOLVED_LOCAL_IMPORT") blockers.push("STATIC_UI_OPTIONS_DYNAMIC_OR_UNRESOLVED");
  if (control.numeric_constraints?.step !== undefined) blockers.push("STATIC_CONTROL_STEP_NOT_REPRESENTABLE");
  if (control.value_type === null) blockers.push("STATIC_CONTROL_VALUE_TYPE_UNKNOWN");
  if (blockers.length === 0) blockers.push("STATIC_CONTROL_PROPERTY_NOT_SUPPORTED");
  return blockers;
}

function enumForField(
  field: string,
  settings: Record<string, unknown>
): { property: GenerationParameterProperty; publicSettingKey: string } | null {
  const publicSettingKey = field === "mode" ? "allowed_modes" : field;
  if (PUBLIC_METADATA_FIELDS.has(field) || SERVER_OWNED_FIELDS.has(field)) return null;
  const raw = settings[publicSettingKey];
  let values: unknown[] | null = null;
  if (field === "mode" && Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
    values = raw;
  } else if (Array.isArray(raw) && raw.every(isPublicOption)) {
    values = raw.map((item) => (item as { value: string | number }).value);
  }
  if (!values || values.length === 0 || values.length > 200) return null;
  const type = enumValueType(values);
  if (!type || new Set(values.map(stableScalar)).size !== values.length) return null;
  const candidate = { type, enum: values };
  const parsed = propertySchema.safeParse(candidate);
  return parsed.success ? { property: parsed.data, publicSettingKey } : null;
}

function numericConstraintForField(
  field: string,
  settings: Record<string, unknown>
): z.infer<typeof publicConstraintFactSchema> | null {
  const binding = NUMERIC_LIMIT_BINDINGS[field];
  if (!binding) return null;
  const [minimumKey, maximumKey] = binding;
  const minimum = typeof settings[minimumKey] === "number" && Number.isFinite(settings[minimumKey]) ? settings[minimumKey] as number : undefined;
  const maximum = typeof settings[maximumKey] === "number" && Number.isFinite(settings[maximumKey]) ? settings[maximumKey] as number : undefined;
  if (minimum === undefined && maximum === undefined) return null;
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) return null;
  return {
    field,
    value_type: "UNKNOWN",
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    source_setting_keys: [
      ...(minimum === undefined ? [] : [minimumKey]),
      ...(maximum === undefined ? [] : [maximumKey])
    ],
    classification: "PUBLIC_NUMERIC_BOUNDS_ONLY"
  };
}

function validateMaplessModelBindings(
  publicModels: ReadonlyMap<string, SyntxPublicModelEntry>,
  maplessModels: ReadonlyMap<string, MaplessSettingsInventory["models"][number]>
): void {
  if (publicModels.size !== maplessModels.size) throw projectionError("MAPLESS_MODEL_BINDING_MISMATCH");
  for (const [modelId, publicModel] of publicModels) {
    const mapless = maplessModels.get(modelId);
    if (!mapless || mapless.model_id !== modelId || mapless.ai_name !== publicModel.ai_name ||
        mapless.active !== publicModel.active || mapless.public_type_label !== publicModel.type ||
        !sameJson(mapless.settings, publicModel.settings)) {
      throw projectionError("MAPLESS_MODEL_BINDING_MISMATCH");
    }
  }
}

function parsePublicCatalog(input: SyntxPublicCatalogSnapshot): SyntxPublicCatalogSnapshot {
  try { return syntxPublicCatalogSnapshotSchema.parse(input); }
  catch { throw projectionError("PUBLIC_CATALOG_INVALID"); }
}

function parseSettingsInventory(input: MaplessSettingsInventory): MaplessSettingsInventory {
  try { return maplessSettingsInventorySchema.parse(input); }
  catch { throw projectionError("SETTINGS_INVENTORY_INVALID"); }
}

function verifyArtifactVersion(
  version: string,
  serialized: string,
  invalidCode: StaticGenerationParameterSchemaErrorCode,
  mismatchCode: StaticGenerationParameterSchemaErrorCode
): void {
  const match = /^sha256-([a-f0-9]{64})\.json$/u.exec(version);
  if (!match) throw projectionError(invalidCode);
  const actual = createHash("sha256").update(serialized, "utf8").digest("hex");
  if (actual !== match[1]) throw projectionError(mismatchCode);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isPublicOption(value: unknown): value is { label: string; value: string | number } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.label === "string" && (typeof candidate.value === "string" || (typeof candidate.value === "number" && Number.isFinite(candidate.value)));
}

function enumValueType(values: readonly unknown[]): "string" | "number" | "integer" | null {
  if (values.every((value) => typeof value === "string")) return "string";
  if (values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return values.every((value) => Number.isSafeInteger(value)) ? "integer" : "number";
  }
  return null;
}

function stableScalar(value: unknown): string {
  return JSON.stringify(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function projectionError(code: StaticGenerationParameterSchemaErrorCode): StaticGenerationParameterSchemaError {
  return new StaticGenerationParameterSchemaError(code);
}
