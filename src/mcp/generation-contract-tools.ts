import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { validateGenerationParameters, GenerationContractValidationError } from "../application/generation-contract-validator.js";
import type { DiscoveryModelRecord } from "../catalog/discovery-catalog.js";
import type { MaplessSettingsInventory } from "../catalog/mapless-settings-inventory.js";
import {
  generationContractRegistrySchema,
  generationParameterSchema,
  type GenerationContract,
  type GenerationContractRegistry
} from "../domain/generation-contract.js";
import { maplessSettingsInventorySchema } from "../catalog/mapless-settings-inventory.js";
import {
  staticGenerationParameterSchemaCatalogSchema,
  type StaticGenerationParameterSchemaCatalog,
  type StaticGenerationParameterSchemaModel
} from "../catalog/static-generation-parameter-schema.js";
import { sha256CanonicalPayload } from "../catalog/syntx-public-catalog.js";
import { GenerationContractExecutionError, GenerationContractExecutor } from "../adapter/syntx/generation-contract-executor.js";
import { GenerationContractExecutorV2, GenerationContractExecutionErrorV2 } from "../adapter/syntx/generation-contract-executor-v2.js";
import { validateGenerationParametersV2, GenerationContractValidationErrorV2 } from "../application/generation-contract-validator-v2.js";
import { generationContractRegistryV2Schema, type GenerationContractRegistryV2, type GenerationContractV2 } from "../domain/generation-contract-v2.js";
import {
  loadPinnedBananaConditionalSettingsV19,
  makeSourceDerivedParameterCandidate,
  sourceDerivedParameterCandidateSchema,
  type LoadedBananaConditionalSettingsV19
} from "../catalog/banana-conditional-settings-v19.js";
import {
  loadPinnedWanResolutionRatioCandidatesV25,
  makeWanResolutionRatioCandidateV25,
  wanResolutionRatioCandidateSchema,
  type LoadedWanResolutionRatioV25
} from "../catalog/wan-resolution-ratio-candidates-v25.js";
import {
  loadPinnedHailuoResolutionDurationCandidatesV26,
  makeHailuoResolutionDurationCandidateV26,
  hailuoResolutionDurationCandidateV26Schema,
  type LoadedHailuoResolutionDurationV26
} from "../catalog/hailuo-resolution-duration-candidates-v26.js";

export const SYNTX_GENERATION_SCHEMA_TOOL_NAME = "syntx_get_generation_schema" as const;
export const SYNTX_VALIDATE_GENERATION_TOOL_NAME = "syntx_validate_generation" as const;
export const DEFAULT_MAPLESS_SETTINGS_INVENTORY_VERSION =
  "sha256-87e96b78b145338af1a666c92ab8a9811f46eb82b8f377331a103b0b409aec38.json";

const schemaStatuses = ["NOT_AVAILABLE", "discovered", "static_partial", "reviewed", "live_verified", "blocked", "BLOCKED"] as const;
const coverageStatuses = ["PUBLIC_CATALOG_ONLY", "STATIC_PARTIAL", "discovered", "static_partial", "reviewed", "live_verified", "BLOCKED"] as const;
const blockedReasonCodes = [
  "CONTRACT_REGISTRY_NOT_SUPPLIED",
  "CONTRACT_NOT_PRESENT",
  "CONTRACT_NOT_REVIEWED",
  "CONTRACT_MARKED_BLOCKED",
  "REGISTRY_CATALOG_MISMATCH",
  "CONTRACT_IDENTITY_MISMATCH",
  "MODEL_INACTIVE",
  "OPERATION_NOT_IN_CURRENT_CATALOG",
  "MAPLESS_CATALOG_MISMATCH",
  "CONTRACT_VARIANT_REQUIRED",
  "CONTRACT_VARIANT_NOT_FOUND",
  "CONTRACT_VARIANT_NOT_SUPPORTED"
] as const;

const settingsEvidenceSchema = z.object({
  evidence_level: z.literal("STATIC_PUBLIC_API_AND_COMPILED_JS"),
  generated_at: z.iso.datetime(),
  build_id: z.string(),
  inventory_version: z.string().nullable(),
  public_catalog_version: z.string(),
  public_catalog_fetched_at: z.iso.datetime(),
  source_hashes: z.object({
    public_models: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    settings_registry: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    settings3: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    use_settings_params: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    form: z.string().regex(/^sha256:[a-f0-9]{64}$/u).nullable()
  }).strict(),
  form_id: z.string().nullable(),
  form_binding_status: z.enum(["STRUCTURAL_MATCH", "UNKNOWN"]),
  settings_status: z.enum(["PUBLIC_SETTINGS_KNOWN", "UNKNOWN"]),
  public_settings_keys: z.array(z.string()),
  model_value_settings_keys: z.array(z.string()),
  generic_setting_keys: z.array(z.string()),
  payload_field_keys: z.array(z.string()),
  enum_constraints: z.record(z.string(), z.unknown()),
  defaults_status: z.enum(["PARTIAL_STATIC", "UNKNOWN"]),
  static_setting_defaults: z.record(z.string(), z.unknown()),
  unknown_reasons: z.array(z.string()),
  runtime_usable: z.literal(false)
}).strict();

const uiChoiceSchema = z.object({
  value: z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]),
  label: z.string().max(500).nullable()
}).strict();
const uiSourceLocationSchema = z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict();
const uiParameterControlSchema = z.object({
  ui_choices: z.array(uiChoiceSchema).max(256),
  nullable: z.boolean().describe("True only when the observed UI option list contains a literal null option; it does not claim caller or wire nullability."),
  nullable_semantics: z.literal("UI_OPTION_LIST_CONTAINS_NULL_ONLY"),
  default_candidate: z.object({
    status: z.enum(["STATIC_LITERAL", "STATIC_LOCAL_CONSTANT", "UNRESOLVED", "NOT_PRESENT"]),
    value: z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]),
    value_type: z.enum(["string", "number", "integer", "boolean"]).nullable(),
    redacted: z.boolean(),
    source_location: uiSourceLocationSchema.nullable()
  }).strict().describe("Observed UI literal candidate only; not an effective or accepted generation default."),
  conditional_unresolved: z.boolean().describe("True when source control conditions or relevant watcher branches were observed but not evaluated."),
  source: z.object({
    form_id: z.string().nullable(),
    form_source_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u).nullable(),
    binding_location: uiSourceLocationSchema,
    option_source_location: uiSourceLocationSchema.nullable()
  }).strict(),
  blockers: z.array(z.string().min(1).max(160)).max(64)
}).strict();
const uiParameterFieldSchema = z.object({
  field: z.string().min(1).max(160),
  evidence_status: z.enum([
    "COMMON_OPERATION_FIELD", "PROVEN_PUBLIC_ENUM", "STATIC_FORM_CONTROL_CANDIDATE",
    "PUBLIC_NUMERIC_BOUNDS_TYPE_UNKNOWN", "UNKNOWN", "SERVER_OWNED"
  ]),
  controls: z.array(uiParameterControlSchema).max(128)
}).strict();
const uiParameterEvidenceSchema = z.object({
  status: z.enum(["MATCHED", "STALE", "UNAVAILABLE"]),
  version: z.string().min(1).max(200).nullable(),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u).nullable(),
  source_schema_version: z.enum(["1.1.0", "1.2.0"]).nullable(),
  migration_status: z.enum(["CURRENT", "LEGACY_V1_1_DEFAULTED_UNKNOWN", "SCHEMA_MIGRATION_REQUIRED"]).nullable(),
  runtime_usable: z.literal(false),
  reason_code: z.enum([
    "UI_PROJECTION_NOT_LOADED", "UI_PROJECTION_CATALOG_MISMATCH",
    "UI_PROJECTION_SETTINGS_INVENTORY_MISMATCH", "UI_PROJECTION_MODEL_NOT_FOUND",
    "UI_PROJECTION_OPERATION_NOT_FOUND", "UI_PROJECTION_MODEL_BINDING_MISMATCH",
    "UI_PROJECTION_FORM_BINDING_MISMATCH", "SCHEMA_MIGRATION_REQUIRED"
  ]).nullable(),
  control_structure_status: z.enum(["CONTROLS_FOUND", "UNRESOLVED_STRUCTURE", "NOT_CHECKED"]).nullable(),
  blocked_reasons: z.array(z.enum([
    "UI_FORM_CONTROL_STRUCTURE_UNRESOLVED",
    "UI_FORM_CONTROL_STRUCTURE_NOT_CHECKED",
    "UI_SETTINGS_ROOT_UNRESOLVED",
    "UI_SETTINGS_ROOT_NOT_CHECKED",
    "UI_PROJECTION_MIGRATED_UNKNOWN_FIELDS",
    "UI_STATIC_CONTROL_FACTS_EMPTY"
  ])).max(8),
  source: z.object({
    schema_version: z.string().max(32),
    public_catalog_version: z.string().max(200),
    settings_inventory_version: z.string().max(200),
    settings_inventory_generated_at: z.iso.datetime(),
    settings_build_id: z.string().max(20),
    model_id: z.string().max(160),
    ai_name: z.string().max(160),
    upstream_model_value: z.string().max(160),
    operation_id: z.string().max(80),
    model_schema_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    form_id: z.string().nullable(),
    form_source_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u).nullable(),
    control_structure_status: z.enum(["CONTROLS_FOUND", "UNRESOLVED_STRUCTURE", "NOT_CHECKED"]),
    settings_root_status: z.enum([
      "LEXICAL_BINDING_FOUND", "UNRESOLVED_GLOBAL_IDENTIFIER", "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED",
      "NO_SETTINGS_REFERENCE", "NOT_CHECKED"
    ]).nullable()
  }).strict().nullable(),
  fields: z.array(uiParameterFieldSchema).max(128)
}).strict();

export const generationSchemaOutputSchema = z.object({
  schema_version: z.literal("1.0.0"),
  model_id: z.string(),
  operation_id: z.string().nullable(),
  catalog_version: z.string(),
  catalog_kind: z.literal("OFFICIAL_PUBLIC_API_SNAPSHOT"),
  active: z.boolean(),
  ai_name: z.string(),
  model_type: z.string(),
  runtime_usable: z.literal(false),
  schema_status: z.enum(schemaStatuses),
  coverage_status: z.enum(coverageStatuses),
  blocked_reasons: z.array(z.enum(blockedReasonCodes)),
  schema_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u).nullable(),
  parameter_schema: generationParameterSchema.nullable(),
  contract_schema_version: z.literal("2.0.0").optional(),
  variant_id: z.string().min(1).max(160).optional(),
  available_variant_ids: z.array(z.string().min(1).max(160)).max(256).optional(),
  parameter_schema_v2: z.object({
    type: z.literal("object"),
    additional_properties: z.literal(false),
    required: z.array(z.string()),
    properties: z.record(z.string(), z.unknown()),
    conditions: z.array(z.unknown()),
    conditional_enums: z.array(z.unknown())
  }).strict().nullable().optional(),
  contract_evidence: z.object({
    status: z.enum(["discovered", "static_partial", "reviewed", "live_verified", "blocked"]),
    settings_source_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u).nullable(),
    source_kinds: z.array(z.enum(["public_catalog", "frontend_static", "official_contract", "manual_review", "live_owner"])),
    reviewed_at: z.iso.datetime().nullable(),
    live_observed_at: z.iso.datetime().nullable()
  }).strict().nullable(),
  public_settings_coverage: z.literal("ALLOWLISTED_PUBLIC_API_FIELDS"),
  public_settings: z.record(z.string(), z.unknown()).nullable(),
  source_derived_parameter_candidate: z.union([
    sourceDerivedParameterCandidateSchema,
    wanResolutionRatioCandidateSchema,
    hailuoResolutionDurationCandidateV26Schema
  ]).optional(),
  settings_evidence_status: z.enum(["MATCHED", "STALE", "UNAVAILABLE", "MODEL_NOT_FOUND"]),
  settings_evidence: settingsEvidenceSchema.nullable(),
  ui_parameter_evidence: uiParameterEvidenceSchema
}).strict();

export const generationValidationOutputSchema = z.object({
  schema_version: z.literal("1.0.0"),
  model_id: z.string(),
  operation_id: z.string(),
  catalog_version: z.string(),
  runtime_usable: z.literal(false),
  validation_status: z.enum(["VALID", "INVALID", "NOT_AVAILABLE", "BLOCKED"]),
  reason_code: z.string().nullable(),
  schema_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u).nullable(),
  contract_schema_version: z.literal("2.0.0").optional(),
  variant_id: z.string().min(1).max(160).optional(),
  available_variant_ids: z.array(z.string().min(1).max(160)).max(256).optional(),
  normalized_parameter_keys: z.array(z.string()),
  defaulted_parameter_keys: z.array(z.string()),
  parameters_redacted: z.literal(true)
}).strict();

export interface GenerationContractCatalogModel extends Pick<DiscoveryModelRecord,
  "id" | "upstream_id" | "ai_name" | "active" | "default" | "description" | "display_name" |
  "features" | "operations" | "fetched_at" | "source_hashes" | "settings" | "type"> {
  readonly catalog_version: string;
}

export interface RegisterSyntxGenerationContractToolsOptions {
  resolveModel(modelId: string): GenerationContractCatalogModel;
  registry?: GenerationContractRegistry | null;
  registryV2?: GenerationContractRegistryV2 | null;
  maplessSettingsInventory?: MaplessSettingsInventory | null;
  maplessSettingsInventoryVersion?: string | null;
  staticParameterProjection?: StaticGenerationParameterSchemaCatalog | null;
  staticParameterProjectionVersion?: string | null;
  staticParameterProjectionSha256?: string | null;
  staticParameterProjectionSourceSchemaVersion?: "1.1.0" | "1.2.0" | null;
  staticParameterProjectionMigrationStatus?: "CURRENT" | "LEGACY_V1_1_DEFAULTED_UNKNOWN" | "SCHEMA_MIGRATION_REQUIRED" | null;
}

export type GenerationSchemaOutput = z.infer<typeof generationSchemaOutputSchema>;
export type GenerationValidationOutput = z.infer<typeof generationValidationOutputSchema>;

export function registerSyntxGenerationContractTools(
  server: McpServer,
  options: RegisterSyntxGenerationContractToolsOptions
): void {
  const service = new GenerationContractToolsService(options);
  server.registerTool(SYNTX_GENERATION_SCHEMA_TOOL_NAME, {
    title: "Get generation schema",
    description: "Read the selected public model and separately labeled static UI or reviewed parameter evidence. UI choices/default candidates do not establish wire acceptance, and static evidence is never promoted to an executable schema; this tool performs no network or paid operation.",
    inputSchema: z.object({
      model_id: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
      operation_id: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).optional(),
      variant_id: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).optional()
    }).strict(),
    outputSchema: generationSchemaOutputSchema,
    annotations: { title: "Get generation schema", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ model_id, operation_id, variant_id }): Promise<CallToolResult> => safeCall(() => service.getSchema(model_id, operation_id, variant_id), generationSchemaOutputSchema));

  server.registerTool(SYNTX_VALIDATE_GENERATION_TOOL_NAME, {
    title: "Validate generation parameters",
    description: "Validate parameters locally against a reviewed, catalog-bound schema and return only parameter names and status. Prompt and parameter values are never returned; this does not execute generation.",
    inputSchema: z.object({
      model_id: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
      operation_id: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
      variant_id: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).optional(),
      parameters: z.record(z.string(), z.unknown())
    }).strict(),
    outputSchema: generationValidationOutputSchema,
    annotations: { title: "Validate generation parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ model_id, operation_id, variant_id, parameters }): Promise<CallToolResult> => safeCall(() => service.validate(model_id, operation_id, parameters, variant_id), generationValidationOutputSchema));
}

class GenerationContractToolsService {
  readonly #registry: GenerationContractRegistry | null;
  readonly #executor: GenerationContractExecutor | null;
  readonly #registryV2: GenerationContractRegistryV2 | null;
  readonly #executorV2: GenerationContractExecutorV2 | null;
  readonly #inventory: MaplessSettingsInventory | null;
  readonly #inventoryVersion: string | null;
  readonly #staticProjection: StaticGenerationParameterSchemaCatalog | null;
  readonly #staticProjectionVersion: string | null;
  readonly #staticProjectionSha256: string | null;
  readonly #staticProjectionSourceSchemaVersion: "1.1.0" | "1.2.0" | null;
  readonly #staticProjectionMigrationStatus: "CURRENT" | "LEGACY_V1_1_DEFAULTED_UNKNOWN" | "SCHEMA_MIGRATION_REQUIRED" | null;
  readonly #sourceDerivedParameterArtifact: LoadedBananaConditionalSettingsV19 | null;
  readonly #wanResolutionRatioArtifact: LoadedWanResolutionRatioV25 | null;
  readonly #hailuoResolutionDurationArtifact: LoadedHailuoResolutionDurationV26 | null;
  readonly #resolveModel: (modelId: string) => GenerationContractCatalogModel;

  constructor(options: RegisterSyntxGenerationContractToolsOptions) {
    this.#resolveModel = options.resolveModel;
    this.#registry = options.registry == null ? null : freezeJson(generationContractRegistrySchema.parse(options.registry));
    this.#registryV2 = options.registryV2 == null ? null : freezeJson(generationContractRegistryV2Schema.parse(options.registryV2));
    this.#inventory = options.maplessSettingsInventory == null ? null : freezeJson(maplessSettingsInventorySchema.parse(options.maplessSettingsInventory));
    this.#inventoryVersion = options.maplessSettingsInventoryVersion ?? null;
    this.#staticProjection = options.staticParameterProjection == null
      ? null
      : freezeJson(staticGenerationParameterSchemaCatalogSchema.parse(options.staticParameterProjection));
    this.#staticProjectionVersion = options.staticParameterProjectionVersion ?? null;
    this.#staticProjectionSha256 = options.staticParameterProjectionSha256 ?? null;
    this.#staticProjectionSourceSchemaVersion = options.staticParameterProjectionSourceSchemaVersion ?? null;
    this.#staticProjectionMigrationStatus = options.staticParameterProjectionMigrationStatus ?? null;
    this.#sourceDerivedParameterArtifact = loadPinnedBananaConditionalSettingsV19();
    this.#wanResolutionRatioArtifact = loadPinnedWanResolutionRatioCandidatesV25();
    this.#hailuoResolutionDurationArtifact = loadPinnedHailuoResolutionDurationCandidatesV26();
    this.#executor = this.#registry === null ? null : new GenerationContractExecutor(this.#registry, {
      getModel: (modelId) => {
        const resolved = this.#resolveModel(modelId);
        return {
          id: resolved.id,
          upstream_id: resolved.upstream_id,
          ai_name: resolved.ai_name,
          active: resolved.active,
          operations: resolved.operations,
          fetched_at: resolved.fetched_at,
          source_hashes: resolved.source_hashes
        };
      }
    });
    this.#executorV2 = this.#registryV2 === null ? null : new GenerationContractExecutorV2(this.#registryV2, {
      getModel: (modelId) => {
        const resolved = this.#resolveModel(modelId);
        return {
          id: resolved.id,
          upstream_id: resolved.upstream_id,
          ai_name: resolved.ai_name,
          active: resolved.active,
          operations: resolved.operations,
          fetched_at: resolved.fetched_at,
          source_hashes: resolved.source_hashes
        };
      }
    });
  }

  getSchema(modelId: string, requestedOperationId?: string, requestedVariantId?: string): GenerationSchemaOutput {
    const model = this.#resolveModel(modelId);
    const operationId = requestedOperationId ?? model.operations[0]?.id ?? null;
    const operation = operationId === null ? undefined : model.operations.find((candidate) => candidate.id === operationId);
    const settings = this.#settingsEvidence(model);
    const bananaSourceDerivedCandidate = makeSourceDerivedParameterCandidate(
      this.#sourceDerivedParameterArtifact,
      model,
      operationId,
      operation?.output_modality
    );
    const wanSourceDerivedCandidate = makeWanResolutionRatioCandidateV25(
      this.#wanResolutionRatioArtifact,
      model,
      operationId,
      operation?.output_modality
    );
    const hailuoSourceDerivedCandidate = makeHailuoResolutionDurationCandidateV26(
      this.#hailuoResolutionDurationArtifact,
      model,
      operationId,
      operation?.output_modality
    );
    const sourceDerivedCandidate = bananaSourceDerivedCandidate ?? wanSourceDerivedCandidate ?? hailuoSourceDerivedCandidate;
    const base = {
      schema_version: "1.0.0" as const,
      model_id: model.id,
      operation_id: operationId,
      catalog_version: model.catalog_version,
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT" as const,
      active: model.active,
      ai_name: model.ai_name,
      model_type: model.upstream_id,
      runtime_usable: false as const,
      public_settings_coverage: "ALLOWLISTED_PUBLIC_API_FIELDS" as const,
      public_settings: model.settings === null ? null : structuredClone(model.settings),
      ...(sourceDerivedCandidate === null ? {} : { source_derived_parameter_candidate: sourceDerivedCandidate }),
      settings_evidence_status: settings.status,
      settings_evidence: settings.evidence,
      ui_parameter_evidence: this.#uiParameterEvidence(model, operationId, operation)
    };

    if (operationId === null) return generationSchemaOutputSchema.parse({
      ...base,
      schema_status: "NOT_AVAILABLE",
      coverage_status: settings.status === "MATCHED" ? "STATIC_PARTIAL" : "PUBLIC_CATALOG_ONLY",
      blocked_reasons: ["OPERATION_NOT_IN_CURRENT_CATALOG"],
      schema_hash: null,
      parameter_schema: null,
      contract_evidence: null
    });

    if (!operation) return generationSchemaOutputSchema.parse({
      ...base,
      schema_status: "BLOCKED",
      coverage_status: "BLOCKED",
      blocked_reasons: ["OPERATION_NOT_IN_CURRENT_CATALOG"],
      schema_hash: null,
      parameter_schema: null,
      contract_evidence: null
    });

    if (!model.active) return generationSchemaOutputSchema.parse({
      ...base,
      schema_status: "BLOCKED",
      coverage_status: "BLOCKED",
      blocked_reasons: ["MODEL_INACTIVE"],
      schema_hash: null,
      parameter_schema: null,
      contract_evidence: null
    });

    const v2Schema = this.#getV2Schema(base, model, operationId, operation.output_modality, requestedVariantId);
    if (v2Schema !== null) return v2Schema;
    if (requestedVariantId !== undefined) return generationSchemaOutputSchema.parse({
      ...base,
      schema_status: "BLOCKED",
      coverage_status: "BLOCKED",
      blocked_reasons: ["CONTRACT_VARIANT_NOT_SUPPORTED"],
      schema_hash: null,
      parameter_schema: null,
      contract_evidence: null
    });

    if ((this.#registry === null || this.#executor === null) && (this.#registryV2 === null || this.#executorV2 === null)) return generationSchemaOutputSchema.parse({
      ...base,
      schema_status: "NOT_AVAILABLE",
      coverage_status: settings.status === "MATCHED" ? "STATIC_PARTIAL" : "PUBLIC_CATALOG_ONLY",
      blocked_reasons: [
        ...(settings.status === "STALE" ? ["MAPLESS_CATALOG_MISMATCH" as const] : []),
        "CONTRACT_REGISTRY_NOT_SUPPLIED"
      ],
      schema_hash: null,
      parameter_schema: null,
      contract_evidence: null
    });

    if (this.#registry === null || this.#executor === null) return generationSchemaOutputSchema.parse({
      ...base,
      schema_status: "NOT_AVAILABLE",
      coverage_status: "PUBLIC_CATALOG_ONLY",
      blocked_reasons: ["CONTRACT_NOT_PRESENT"],
      schema_hash: null,
      parameter_schema: null,
      contract_evidence: null
    });

    if (!registryMatchesModel(this.#registry, model)) return generationSchemaOutputSchema.parse({
      ...base,
      schema_status: "BLOCKED",
      coverage_status: "BLOCKED",
      blocked_reasons: ["REGISTRY_CATALOG_MISMATCH"],
      schema_hash: null,
      parameter_schema: null,
      contract_evidence: null
    });

    const contract = this.#executor.getContract(model.id, operationId);
    if (contract === null) return generationSchemaOutputSchema.parse({
      ...base,
      schema_status: "NOT_AVAILABLE",
      coverage_status: settings.evidence?.form_binding_status === "STRUCTURAL_MATCH" ? "STATIC_PARTIAL" : "PUBLIC_CATALOG_ONLY",
      blocked_reasons: ["CONTRACT_NOT_PRESENT"],
      schema_hash: null,
      parameter_schema: null,
      contract_evidence: null
    });

    if (!contractMatchesModel(contract, model, operation.output_modality)) return generationSchemaOutputSchema.parse({
      ...base,
      schema_status: "BLOCKED",
      coverage_status: "BLOCKED",
      blocked_reasons: ["CONTRACT_IDENTITY_MISMATCH"],
      schema_hash: contract.schema_hash,
      parameter_schema: null,
      contract_evidence: null
    });

    if (contract.status === "blocked") return generationSchemaOutputSchema.parse({
      ...base,
      schema_status: "BLOCKED",
      coverage_status: "BLOCKED",
      blocked_reasons: ["CONTRACT_MARKED_BLOCKED"],
      schema_hash: contract.schema_hash,
      parameter_schema: null,
      contract_evidence: contractEvidence(contract)
    });

    const notReviewed = contract.status === "discovered" || contract.status === "static_partial";
    return generationSchemaOutputSchema.parse({
      ...base,
      schema_status: contract.status,
      coverage_status: contract.status,
      blocked_reasons: notReviewed ? ["CONTRACT_NOT_REVIEWED"] : [],
      schema_hash: contract.schema_hash,
      parameter_schema: safeParameterSchema(contract),
      contract_evidence: contractEvidence(contract)
    });
  }

  validate(modelId: string, operationId: string, parameters: unknown, variantId?: string): GenerationValidationOutput {
    const model = this.#resolveModel(modelId);
    const schema = this.getSchema(modelId, operationId, variantId);
    const base = {
      schema_version: "1.0.0" as const,
      model_id: model.id,
      operation_id: operationId,
      catalog_version: model.catalog_version,
      runtime_usable: false as const,
      reason_code: null as string | null,
      schema_hash: schema.schema_hash,
      ...(schema.contract_schema_version === undefined ? {} : {
        contract_schema_version: schema.contract_schema_version,
        ...(schema.variant_id === undefined ? {} : { variant_id: schema.variant_id }),
        ...(schema.available_variant_ids === undefined ? {} : { available_variant_ids: schema.available_variant_ids })
      }),
      normalized_parameter_keys: [] as string[],
      defaulted_parameter_keys: [] as string[],
      parameters_redacted: true as const
    };

    if (schema.schema_status === "BLOCKED") return generationValidationOutputSchema.parse({
      ...base,
      validation_status: "BLOCKED",
      reason_code: schema.blocked_reasons[0] ?? "CONTRACT_IDENTITY_MISMATCH"
    });
    if (schema.schema_status !== "reviewed" && schema.schema_status !== "live_verified") return generationValidationOutputSchema.parse({
      ...base,
      validation_status: "NOT_AVAILABLE",
      reason_code: schema.blocked_reasons[0] ?? "CONTRACT_NOT_REVIEWED"
    });

    if (schema.contract_schema_version === "2.0.0") {
      const contract = this.#executorV2?.getContract(model.id, operationId, schema.variant_id);
      if (!contract) return generationValidationOutputSchema.parse({
        ...base,
        validation_status: "BLOCKED",
        reason_code: "CONTRACT_NOT_PRESENT"
      });
      try {
        const normalized = validateGenerationParametersV2(contract, parameters);
        const supplied = new Set(Object.keys(parameters as Record<string, unknown>));
        const keys = Object.keys(normalized);
        this.#executorV2!.prepare({
          model_id: model.id,
          operation_id: operationId,
          variant_id: contract.variant_id,
          catalog_version: model.catalog_version,
          parameters: normalized
        });
        return generationValidationOutputSchema.parse({
          ...base,
          validation_status: "VALID",
          normalized_parameter_keys: keys,
          defaulted_parameter_keys: keys.filter((key) => !supplied.has(key))
        });
      } catch (error) {
        if (error instanceof GenerationContractValidationErrorV2) return generationValidationOutputSchema.parse({
          ...base,
          validation_status: "INVALID",
          reason_code: error.code
        });
        if (error instanceof GenerationContractExecutionErrorV2 &&
            (error.code === "GENERATION_CONTRACT_PROMPT_INVALID" || error.code === "GENERATION_CONTRACT_VALIDATION_FAILED")) {
          return generationValidationOutputSchema.parse({
            ...base,
            validation_status: "INVALID",
            reason_code: error.validationCode ?? "PROMPT_INVALID"
          });
        }
        const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : "CONTRACT_IDENTITY_MISMATCH";
        return generationValidationOutputSchema.parse({ ...base, validation_status: "BLOCKED", reason_code: code });
      }
    }

    const contract = this.#executor?.getContract(model.id, operationId);
    if (!contract) return generationValidationOutputSchema.parse({
      ...base,
      validation_status: "NOT_AVAILABLE",
      reason_code: "CONTRACT_NOT_PRESENT"
    });

    try {
      const normalized = validateGenerationParameters(contract, parameters);
      // The validator only succeeds for a bounded plain JSON object, so its own-key list is safe here.
      const supplied = new Set(Object.keys(parameters as Record<string, unknown>));
      const keys = Object.keys(normalized);
      this.#executor!.prepare({
        model_id: model.id,
        operation_id: operationId,
        catalog_version: model.catalog_version,
        parameters: normalized as Record<string, unknown>
      });
      return generationValidationOutputSchema.parse({
        ...base,
        validation_status: "VALID",
        normalized_parameter_keys: keys,
        defaulted_parameter_keys: keys.filter((key) => !supplied.has(key))
      });
    } catch (error) {
      if (error instanceof GenerationContractValidationError) return generationValidationOutputSchema.parse({
        ...base,
        validation_status: "INVALID",
        reason_code: error.code
      });
      if (error instanceof GenerationContractExecutionError && error.code === "GENERATION_CONTRACT_PROMPT_INVALID") return generationValidationOutputSchema.parse({
        ...base,
        validation_status: "INVALID",
        reason_code: "PROMPT_INVALID"
      });
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "CONTRACT_IDENTITY_MISMATCH";
      return generationValidationOutputSchema.parse({
        ...base,
        validation_status: "BLOCKED",
        reason_code: code
      });
    }
  }

  #getV2Schema(
    base: Omit<GenerationSchemaOutput, "schema_status" | "coverage_status" | "blocked_reasons" | "schema_hash" | "parameter_schema" | "contract_evidence">,
    model: GenerationContractCatalogModel,
    operationId: string,
    modality: string,
    requestedVariantId?: string
  ): GenerationSchemaOutput | null {
    const executor = this.#executorV2;
    const registry = this.#registryV2;
    if (executor === null || registry === null) return null;
    const available = executor.availableVariantIds(model.id, operationId);
    if (available.length === 0) {
      if (requestedVariantId === undefined) return null;
      return generationSchemaOutputSchema.parse({
        ...base,
        schema_status: "BLOCKED",
        coverage_status: "BLOCKED",
        blocked_reasons: ["CONTRACT_VARIANT_NOT_FOUND"],
        schema_hash: null,
        parameter_schema: null,
        contract_schema_version: "2.0.0",
        variant_id: requestedVariantId,
        available_variant_ids: [],
        parameter_schema_v2: null,
        contract_evidence: null
      });
    }

    const variantBase = {
      ...base,
      contract_schema_version: "2.0.0" as const,
      available_variant_ids: [...available]
    };
    if (!registryMatchesModelV2(registry, model)) return generationSchemaOutputSchema.parse({
      ...variantBase,
      schema_status: "BLOCKED",
      coverage_status: "BLOCKED",
      blocked_reasons: ["REGISTRY_CATALOG_MISMATCH"],
      schema_hash: null,
      parameter_schema: null,
      ...(requestedVariantId === undefined ? {} : { variant_id: requestedVariantId }),
      parameter_schema_v2: null,
      contract_evidence: null
    });
    if (requestedVariantId === undefined && available.length > 1) return generationSchemaOutputSchema.parse({
      ...variantBase,
      schema_status: "BLOCKED",
      coverage_status: "BLOCKED",
      blocked_reasons: ["CONTRACT_VARIANT_REQUIRED"],
      schema_hash: null,
      parameter_schema: null,
      parameter_schema_v2: null,
      contract_evidence: null
    });
    if (requestedVariantId !== undefined && !available.includes(requestedVariantId)) return generationSchemaOutputSchema.parse({
      ...variantBase,
      schema_status: "BLOCKED",
      coverage_status: "BLOCKED",
      blocked_reasons: ["CONTRACT_VARIANT_NOT_FOUND"],
      schema_hash: null,
      parameter_schema: null,
      variant_id: requestedVariantId,
      parameter_schema_v2: null,
      contract_evidence: null
    });

    const selectedVariant = requestedVariantId ?? available[0]!;
    let contract: GenerationContractV2 | null;
    try { contract = executor.getContract(model.id, operationId, selectedVariant); }
    catch { contract = null; }
    if (contract === null) return generationSchemaOutputSchema.parse({
      ...variantBase,
      schema_status: "BLOCKED",
      coverage_status: "BLOCKED",
      blocked_reasons: ["CONTRACT_VARIANT_NOT_FOUND"],
      schema_hash: null,
      parameter_schema: null,
      variant_id: selectedVariant,
      parameter_schema_v2: null,
      contract_evidence: null
    });
    if (!contractMatchesModelV2(contract, model, modality)) return generationSchemaOutputSchema.parse({
      ...variantBase,
      schema_status: "BLOCKED",
      coverage_status: "BLOCKED",
      blocked_reasons: ["CONTRACT_IDENTITY_MISMATCH"],
      schema_hash: contract.schema_hash,
      parameter_schema: null,
      variant_id: selectedVariant,
      parameter_schema_v2: null,
      contract_evidence: null
    });
    if (contract.status === "blocked") return generationSchemaOutputSchema.parse({
      ...variantBase,
      schema_status: "BLOCKED",
      coverage_status: "BLOCKED",
      blocked_reasons: ["CONTRACT_MARKED_BLOCKED"],
      schema_hash: contract.schema_hash,
      parameter_schema: null,
      variant_id: selectedVariant,
      parameter_schema_v2: null,
      contract_evidence: contractEvidenceV2(contract)
    });
    const notReviewed = contract.status === "discovered" || contract.status === "static_partial";
    return generationSchemaOutputSchema.parse({
      ...variantBase,
      schema_status: contract.status,
      coverage_status: contract.status,
      blocked_reasons: notReviewed ? ["CONTRACT_NOT_REVIEWED"] : [],
      schema_hash: contract.schema_hash,
      parameter_schema: null,
      variant_id: contract.variant_id,
      parameter_schema_v2: safeV2ParameterSchema(contract),
      contract_evidence: contractEvidenceV2(contract)
    });
  }

  #settingsEvidence(model: GenerationContractCatalogModel): { status: "MATCHED" | "STALE" | "UNAVAILABLE" | "MODEL_NOT_FOUND"; evidence: z.infer<typeof settingsEvidenceSchema> | null } {
    if (this.#inventory === null) return { status: "UNAVAILABLE", evidence: null };
    if (this.#inventory.public_catalog.models_sha256 !== model.source_hashes.models || this.#inventory.public_catalog.fetched_at !== model.fetched_at) {
      return { status: "STALE", evidence: null };
    }
    const row = this.#inventory.models.find((candidate) => candidate.model_id === model.id);
    if (!row) return { status: "UNAVAILABLE", evidence: null };
    if (row.ai_name !== model.ai_name || row.public_type_label !== model.type || row.active !== model.active) {
      return { status: "MODEL_NOT_FOUND", evidence: null };
    }
    const form = row.form_id === null ? undefined : this.#inventory.forms.find((candidate) => candidate.form_id === row.form_id);
    const promptLike = (key: string) => /prompt/i.test(key);
    const defaults = Object.fromEntries(Object.entries(row.static_setting_defaults).filter(([key]) => !promptLike(key)));
    return {
      status: "MATCHED",
      evidence: settingsEvidenceSchema.parse({
        evidence_level: this.#inventory.evidence_level,
        generated_at: this.#inventory.generated_at,
        build_id: this.#inventory.build.id,
        inventory_version: this.#inventoryVersion,
        public_catalog_version: this.#inventory.public_catalog.version,
        public_catalog_fetched_at: this.#inventory.public_catalog.fetched_at,
        source_hashes: {
          public_models: this.#inventory.public_catalog.models_sha256,
          settings_registry: this.#inventory.registry.sha256,
          settings3: this.#inventory.framework.settings3.sha256,
          use_settings_params: this.#inventory.framework.useSettingsParams.sha256,
          form: form?.javascript.sha256 ?? null
        },
        form_id: row.form_id,
        form_binding_status: row.form_binding_status,
        settings_status: row.settings_status,
        public_settings_keys: Object.keys(row.settings ?? {}).sort(),
        model_value_settings_keys: [...row.model_value_settings_keys],
        generic_setting_keys: [...row.generic_setting_keys],
        payload_field_keys: [...row.payload_field_keys],
        enum_constraints: structuredClone(row.enum_constraints),
        defaults_status: row.defaults_status,
        static_setting_defaults: defaults,
        unknown_reasons: [...row.unknown_reasons],
        runtime_usable: false
      })
    };
  }

  #uiParameterEvidence(
    model: GenerationContractCatalogModel,
    operationId: string | null,
    operation: GenerationContractCatalogModel["operations"][number] | undefined
  ): z.infer<typeof uiParameterEvidenceSchema> {
    const empty = (
      status: "STALE" | "UNAVAILABLE",
      reasonCode: z.infer<typeof uiParameterEvidenceSchema>["reason_code"]
    ) => ({
      status,
      version: this.#staticProjectionVersion,
      sha256: this.#staticProjectionSha256,
      source_schema_version: this.#staticProjectionSourceSchemaVersion,
      migration_status: this.#staticProjectionMigrationStatus,
      runtime_usable: false as const,
      reason_code: reasonCode,
      control_structure_status: null,
      blocked_reasons: [],
      source: null,
      fields: []
    });

    const projection = this.#staticProjection;
    if (projection === null) return empty("UNAVAILABLE", this.#staticProjectionMigrationStatus === "SCHEMA_MIGRATION_REQUIRED"
      ? "SCHEMA_MIGRATION_REQUIRED"
      : "UI_PROJECTION_NOT_LOADED");
    if (operationId === null || operation === undefined) {
      return empty("UNAVAILABLE", "UI_PROJECTION_OPERATION_NOT_FOUND");
    }
    if (!matchesCurrentUiProjection(projection, model, this.#inventory, this.#inventoryVersion)) {
      return empty("STALE", this.#inventory === null || this.#inventoryVersion === null ||
        this.#inventoryVersion !== projection.settings_inventory.version
        ? "UI_PROJECTION_SETTINGS_INVENTORY_MISMATCH"
        : "UI_PROJECTION_CATALOG_MISMATCH");
    }

    const projectedModel = projection.models.find((candidate) =>
      candidate.model_id === model.id && candidate.operation_id === operationId
    );
    if (!projectedModel) {
      const hasModel = projection.models.some((candidate) => candidate.model_id === model.id);
      return empty("UNAVAILABLE", hasModel ? "UI_PROJECTION_OPERATION_NOT_FOUND" : "UI_PROJECTION_MODEL_NOT_FOUND");
    }

    const inventoryModel = this.#inventory?.models.find((candidate) => candidate.model_id === model.id);
    const form = inventoryModel?.form_id === null || inventoryModel?.form_id === undefined
      ? undefined
      : this.#inventory?.forms.find((candidate) => candidate.form_id === inventoryModel.form_id);
    if (projectedModel.active !== model.active || !model.active || projectedModel.ai_name !== model.ai_name ||
        projectedModel.public_model_binding.upstream_model_value !== model.upstream_id ||
        projectedModel.public_model_binding.canonical_sha256 !== currentPublicModelHash(model) ||
        operation.output_modality !== projectedModel.modality || !inventoryModel ||
        projectedModel.settings_form_binding.form_id !== inventoryModel.form_id ||
        projectedModel.settings_form_binding.status !== inventoryModel.form_binding_status ||
        (inventoryModel.form_binding_status === "STRUCTURAL_MATCH" && (!form ||
          projectedModel.settings_form_binding.module_name !== form.module_name ||
          projectedModel.settings_form_binding.source_sha256 !== form.javascript.sha256)) ||
        (this.#staticProjectionMigrationStatus !== "LEGACY_V1_1_DEFAULTED_UNKNOWN" &&
          projectedModel.schema_sha256 !== projectedModelSchemaHash(projection, projectedModel))) {
      return empty("STALE", form === undefined && projectedModel.settings_form_binding.form_id !== null
        ? "UI_PROJECTION_FORM_BINDING_MISMATCH"
        : "UI_PROJECTION_MODEL_BINDING_MISMATCH");
    }

    const controls = projectedModel.field_evidence
      .filter((field) => field.static_control_evidence.length > 0)
      .map((field) => ({
        field: field.field,
        evidence_status: field.status,
        controls: field.static_control_evidence.map((control) => {
          const redactValues = field.field === "prompt" || control.literal_default.redacted;
          return {
            ui_choices: field.field === "prompt" ? [] : control.option_values.map((option) => ({ ...option })),
            nullable: field.field !== "prompt" && control.options_nullable,
            nullable_semantics: "UI_OPTION_LIST_CONTAINS_NULL_ONLY" as const,
            default_candidate: {
              status: control.literal_default.status,
              value: redactValues ? null : control.literal_default.value,
              value_type: control.literal_default.value_type,
              redacted: redactValues,
              source_location: control.literal_default.source_location
            },
            conditional_unresolved: control.conditions.some((condition) => !condition.evaluated) ||
              field.blockers.some((blocker) => blocker.includes("CONDITION") || blocker.includes("WATCH_MUTATION")),
            source: {
              form_id: projectedModel.settings_form_binding.form_id,
              form_source_sha256: projectedModel.settings_form_binding.source_sha256,
              binding_location: control.binding_location,
              option_source_location: control.option_source_location
            },
            blockers: [...new Set([...field.blockers, ...control.unknown_reasons])].slice(0, 64)
          };
        })
      }));
    const controlStructureStatus = projectedModel.settings_form_binding.control_structure_status;
    const settingsRootStatus = projectedModel.settings_form_binding.source_store_binding?.settings_root_status ?? null;
    const blockedReasons = new Set<z.infer<typeof uiParameterEvidenceSchema>["blocked_reasons"][number]>();
    if (controlStructureStatus === "UNRESOLVED_STRUCTURE") blockedReasons.add("UI_FORM_CONTROL_STRUCTURE_UNRESOLVED");
    if (controlStructureStatus === "NOT_CHECKED") blockedReasons.add("UI_FORM_CONTROL_STRUCTURE_NOT_CHECKED");
    if (settingsRootStatus === "UNRESOLVED_GLOBAL_IDENTIFIER" || settingsRootStatus === "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED") {
      blockedReasons.add("UI_SETTINGS_ROOT_UNRESOLVED");
    }
    if (settingsRootStatus === "NOT_CHECKED") blockedReasons.add("UI_SETTINGS_ROOT_NOT_CHECKED");
    if (this.#staticProjectionMigrationStatus === "LEGACY_V1_1_DEFAULTED_UNKNOWN") {
      blockedReasons.add("UI_PROJECTION_MIGRATED_UNKNOWN_FIELDS");
    }
    if (controls.length === 0) blockedReasons.add("UI_STATIC_CONTROL_FACTS_EMPTY");

    return {
      status: "MATCHED",
      version: this.#staticProjectionVersion,
      sha256: this.#staticProjectionSha256,
      source_schema_version: this.#staticProjectionSourceSchemaVersion,
      migration_status: this.#staticProjectionMigrationStatus,
      runtime_usable: false,
      reason_code: null,
      control_structure_status: controlStructureStatus,
      blocked_reasons: [...blockedReasons],
      source: {
        schema_version: projection.schema_version,
        public_catalog_version: projection.public_catalog.version,
        settings_inventory_version: projection.settings_inventory.version,
        settings_inventory_generated_at: projection.settings_inventory.generated_at,
        settings_build_id: projection.settings_inventory.build_id,
        model_id: projectedModel.model_id,
        ai_name: projectedModel.ai_name,
        upstream_model_value: projectedModel.public_model_binding.upstream_model_value,
        operation_id: projectedModel.operation_id,
        model_schema_sha256: projectedModel.schema_sha256,
        form_id: projectedModel.settings_form_binding.form_id,
        form_source_sha256: projectedModel.settings_form_binding.source_sha256,
        control_structure_status: controlStructureStatus,
        settings_root_status: settingsRootStatus
      },
      fields: controls
    };
  }
}

function matchesCurrentUiProjection(
  projection: StaticGenerationParameterSchemaCatalog,
  model: GenerationContractCatalogModel,
  inventory: MaplessSettingsInventory | null,
  inventoryVersion: string | null
): boolean {
  return projection.status === "STATIC_PARTIAL" && projection.runtime_usable === false &&
    projection.public_catalog.fetched_at === model.fetched_at &&
    projection.public_catalog.source_hashes.ai === model.source_hashes.ai &&
    projection.public_catalog.source_hashes.llm_models === model.source_hashes.llm_models &&
    projection.public_catalog.source_hashes.models === model.source_hashes.models &&
    model.catalog_version === `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}` &&
    projection.settings_inventory.public_catalog_version === projection.public_catalog.version &&
    projection.settings_inventory.public_models_sha256 === projection.public_catalog.source_hashes.models &&
    inventory !== null && inventoryVersion !== null && inventoryVersion === projection.settings_inventory.version &&
    inventory.generated_at === projection.settings_inventory.generated_at &&
    inventory.build.id === projection.settings_inventory.build_id &&
    inventory.public_catalog.version === projection.settings_inventory.public_catalog_version &&
    inventory.public_catalog.fetched_at === projection.public_catalog.fetched_at &&
    inventory.public_catalog.models_sha256 === projection.settings_inventory.public_models_sha256;
}

function currentPublicModelHash(model: GenerationContractCatalogModel): string {
  return sha256CanonicalPayload({
    active: model.active,
    ai_name: model.ai_name,
    default: model.default,
    description: model.description,
    features: model.features,
    label: model.display_name,
    settings: model.settings,
    type: model.type,
    value: model.id
  });
}

function projectedModelSchemaHash(
  projection: StaticGenerationParameterSchemaCatalog,
  model: StaticGenerationParameterSchemaModel
): string {
  return sha256CanonicalPayload({
    schema: model.parameter_schema,
    field_evidence: model.field_evidence,
    bindings: {
      catalog_version: projection.public_catalog.version,
      settings_inventory_version: projection.settings_inventory.version,
      model_id: model.model_id,
      form_id: model.settings_form_binding.form_id,
      form_source_sha256: model.settings_form_binding.source_sha256
    }
  });
}

function registryMatchesModel(registry: GenerationContractRegistry, model: GenerationContractCatalogModel): boolean {
  return registry.catalog_version === model.catalog_version &&
    registry.source_hashes.ai === model.source_hashes.ai &&
    registry.source_hashes.llm_models === model.source_hashes.llm_models &&
    registry.source_hashes.models === model.source_hashes.models;
}

function registryMatchesModelV2(registry: GenerationContractRegistryV2, model: GenerationContractCatalogModel): boolean {
  return registry.catalog_version === model.catalog_version &&
    registry.source_hashes.ai === model.source_hashes.ai &&
    registry.source_hashes.llm_models === model.source_hashes.llm_models &&
    registry.source_hashes.models === model.source_hashes.models;
}

function contractMatchesModel(contract: GenerationContract, model: GenerationContractCatalogModel, modality: string): boolean {
  return contract.model_id === model.id && contract.ai_name === model.ai_name &&
    contract.model_type === model.upstream_id && contract.modality === modality;
}

function contractMatchesModelV2(contract: GenerationContractV2, model: GenerationContractCatalogModel, modality: string): boolean {
  return contract.model_id === model.id && contract.ai_name === model.ai_name &&
    contract.model_type === model.upstream_id && contract.modality === modality;
}

function contractEvidence(contract: GenerationContract) {
  return {
    status: contract.status,
    settings_source_sha256: contract.provenance.settings_source_sha256,
    source_kinds: [...new Set(contract.provenance.references.map((reference) => reference.kind))],
    reviewed_at: contract.provenance.reviewed_at ?? null,
    live_observed_at: contract.provenance.live_observed_at ?? null
  };
}

function contractEvidenceV2(contract: GenerationContractV2) {
  return {
    status: contract.status,
    settings_source_sha256: contract.provenance.settings_source_sha256,
    source_kinds: [...new Set(contract.provenance.references.map((reference) => reference.kind))],
    reviewed_at: contract.provenance.reviewed_at ?? null,
    live_observed_at: contract.provenance.live_observed_at ?? null
  };
}

function safeParameterSchema(contract: GenerationContract): GenerationContract["parameters"] {
  const parameters = structuredClone(contract.parameters);
  const promptField = contract.wire.prompt_field;
  const promptProperty = parameters.properties[promptField];
  if (promptProperty && promptProperty.type !== "array") {
    const { default: _redactedDefault, enum: _redactedEnum, ...safeProperty } = promptProperty;
    parameters.properties[promptField] = safeProperty;
  }
  return parameters;
}

function safeV2ParameterSchema(contract: GenerationContractV2): GenerationContractV2["parameters"] {
  const parameters = structuredClone(contract.parameters);
  const promptField = contract.wire.prompt_field;
  const promptProperty = promptField === null ? undefined : parameters.properties[promptField];
  if (promptProperty && promptProperty.type !== "array" && promptProperty.type !== "object" && promptProperty.type !== "media_reference") {
    const { default: _redactedDefault, enum: _redactedEnum, ...safeProperty } = promptProperty;
    parameters.properties[promptField!] = safeProperty;
  }
  return parameters;
}

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) freezeJson(nested);
    Object.freeze(value);
  }
  return value;
}

function safeCall<T extends object>(work: () => T, schema: z.ZodType<T>): CallToolResult {
  try {
    const output = schema.parse(work());
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as Record<string, unknown> };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && error.code === "MODEL_NOT_FOUND"
      ? "MODEL_NOT_FOUND"
      : "GENERATION_SCHEMA_UNAVAILABLE";
    const message = code === "MODEL_NOT_FOUND" ? "The requested public catalog model was not found." : "The generation schema could not be read safely.";
    return { content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }], isError: true };
  }
}
