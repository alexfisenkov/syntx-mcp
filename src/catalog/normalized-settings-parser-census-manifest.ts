import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import {
  assertSettingsSourceInventoryMatchesPublicCatalog,
  loadSettingsSourceInventory,
  settingsSourceInventorySchema,
  type SettingsSourceArtifact,
  type SettingsSourceInventory
} from "./settings-source-inventory.js";
import {
  loadSyntxPublicCatalogSnapshot,
  sha256CanonicalPayload,
  syntxPublicCatalogSnapshotSchema,
  type SyntxPublicAiEntry,
  type SyntxPublicCatalogSnapshot,
  type SyntxPublicModelEntry
} from "./syntx-public-catalog.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/u;
const FORM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MODULE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u;
const BUILD_ID_PATTERN = /^\d{6,20}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_REF_ID_PATTERN = /^settings-source-[a-f0-9]{64}$/u;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SETTINGS_SOURCE_PREFIX = "/src/components/chat/forms/settings/";
const COHORT_VERSION = "1.0.0" as const;
const SOURCE_VERIFICATION_STATUS =
  "PINNED_IN_INVENTORY_NOT_REFETCHED" as const;
const COMPILATION_STATUS = "NOT_COMPILED" as const;

const SOURCE_DISPOSITIONS = [
  "PINNED_IN_INVENTORY_CURRENT_MODEL_BEARING_FORM_ROOT",
  "PINNED_IN_INVENTORY_CURRENT_ZERO_MODEL_FORM_ROOT",
  "PINNED_IN_INVENTORY_CURRENT_FORM_AUXILIARY",
  "PINNED_IN_INVENTORY_UNBOUND_PROVIDER_FORM",
  "PINNED_IN_INVENTORY_DIRECT_SETTINGS_HELPER",
  "PINNED_IN_INVENTORY_SETTINGS_REGISTRY"
] as const;
const SOURCE_KINDS = [
  "VUE_SFC",
  "TYPESCRIPT_MODULE",
  "JAVASCRIPT_MODULE"
] as const;

type SourceDisposition = (typeof SOURCE_DISPOSITIONS)[number];
type SourceKind = (typeof SOURCE_KINDS)[number];

const CURRENT_MAPPED_DISPOSITIONS = new Set<SourceDisposition>([
  "PINNED_IN_INVENTORY_CURRENT_MODEL_BEARING_FORM_ROOT",
  "PINNED_IN_INVENTORY_CURRENT_ZERO_MODEL_FORM_ROOT",
  "PINNED_IN_INVENTORY_CURRENT_FORM_AUXILIARY"
]);

const DEFERRED_DISPOSITIONS = new Set<SourceDisposition>([
  "PINNED_IN_INVENTORY_UNBOUND_PROVIDER_FORM",
  "PINNED_IN_INVENTORY_DIRECT_SETTINGS_HELPER",
  "PINNED_IN_INVENTORY_SETTINGS_REGISTRY"
]);

export type NormalizedSettingsParserCensusManifestErrorCode =
  | "CENSUS_MANIFEST_DRIFT_DETECTED"
  | "CENSUS_MANIFEST_INVALID"
  | "SOURCE_RELATIONSHIP_INVALID"
  | "SOURCE_VALIDATION_FAILED";

export class NormalizedSettingsParserCensusManifestError extends Error {
  constructor(readonly code: NormalizedSettingsParserCensusManifestErrorCode) {
    super(
      "SYNTX normalized settings parser census manifest could not be processed safely."
    );
    this.name = "NormalizedSettingsParserCensusManifestError";
  }
}

const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(IDENTIFIER_PATTERN);
const formIdSchema = z.string().min(1).max(160).regex(FORM_ID_PATTERN);
const moduleNameSchema = z
  .string()
  .min(4)
  .max(300)
  .regex(MODULE_NAME_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const sourceRefIdSchema = z.string().regex(SOURCE_REF_ID_PATTERN);
const positiveIntegerSchema = z.number().int().positive();
const nonnegativeIntegerSchema = z.number().int().nonnegative();
const utcTimestampSchema = z
  .string()
  .regex(UTC_TIMESTAMP_PATTERN)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected a valid UTC timestamp."
  });
const sourcePathSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (value) =>
      isNormalizedSettingsSourcePath(value) &&
      trySourceKindFromPath(value) !== undefined,
    {
      message:
        "Expected a normalized settings source path with a supported extension."
    }
  );

function sortedUniqueStringArraySchema<T extends z.ZodType<string>>(
  itemSchema: T,
  maximum: number
) {
  return z
    .array(itemSchema)
    .max(maximum)
    .superRefine((values, context) => {
      if (!isSortedUniqueStrings(values)) {
        context.addIssue({
          code: "custom",
          message: "Expected unique strings in canonical order."
        });
      }
    });
}

const sortedIdentifierArraySchema = sortedUniqueStringArraySchema(
  identifierSchema,
  10_000
);
const sortedFormIdArraySchema = sortedUniqueStringArraySchema(
  formIdSchema,
  1_000
);
const sortedSourceRefIdArraySchema = sortedUniqueStringArraySchema(
  sourceRefIdSchema,
  10_000
);

const payloadHashesSchema = z
  .object({
    ai: sha256Schema,
    models: sha256Schema,
    llm_models: sha256Schema
  })
  .strict();

const publicCatalogBindingSchema = z
  .object({
    canonical_sha256: sha256Schema,
    fetched_at: utcTimestampSchema,
    payload_hashes: payloadHashesSchema
  })
  .strict();

const sourceInventoryBindingSchema = z
  .object({
    canonical_sha256: sha256Schema,
    generated_at: utcTimestampSchema,
    build_id: z.string().regex(BUILD_ID_PATTERN),
    public_catalog_hashes: payloadHashesSchema
  })
  .strict();

const publicAiReferenceSchema = z
  .object({
    aggregate_ai_sha256: sha256Schema,
    key: z.literal("value"),
    ai_name: identifierSchema,
    canonical_sha256: sha256Schema
  })
  .strict();

const inventoryFormReferenceSchema = z
  .object({
    aggregate_inventory_sha256: sha256Schema,
    key: z.literal("ai_name"),
    ai_name: identifierSchema,
    form_id: formIdSchema,
    canonical_sha256: sha256Schema
  })
  .strict();

const inventoryUnboundFormReferenceSchema = z
  .object({
    aggregate_inventory_sha256: sha256Schema,
    key: z.literal("form_id"),
    form_id: formIdSchema,
    canonical_sha256: sha256Schema
  })
  .strict();

const publicModelReferenceSchema = z
  .object({
    aggregate_models_sha256: sha256Schema,
    key: z.literal("value"),
    model_id: identifierSchema,
    canonical_sha256: sha256Schema
  })
  .strict();

const inventoryModelReferenceSchema = z
  .object({
    aggregate_inventory_sha256: sha256Schema,
    key: z.literal("model_id"),
    model_id: identifierSchema,
    canonical_sha256: sha256Schema
  })
  .strict();

const sourceIdentitySchema = z
  .object({
    source_ref_id: sourceRefIdSchema,
    role: z.enum([
      "SETTINGS_REGISTRY",
      "PROVIDER_FORM",
      "DIRECT_SETTINGS_HELPER"
    ]),
    module_name: moduleNameSchema,
    form_id: formIdSchema.nullable(),
    module_javascript_sha256: sha256Schema,
    module_source_map_sha256: sha256Schema,
    source_index: nonnegativeIntegerSchema,
    source_path: sourcePathSchema,
    source_content_sha256: sha256Schema,
    source_kind: z.enum(SOURCE_KINDS),
    disposition: z.enum(SOURCE_DISPOSITIONS)
  })
  .strict();

const inventoryEvidenceLocatorSchema = z
  .object({
    source_ref_id: sourceRefIdSchema,
    token_kind: z.literal("EXACT_QUOTED_LITERAL_REFERENCE"),
    line: positiveIntegerSchema,
    column: positiveIntegerSchema
  })
  .strict();

const formRecordSchema = z
  .object({
    form_id: formIdSchema,
    ai_name: identifierSchema,
    ai_active: z.boolean(),
    public_ai_ref: publicAiReferenceSchema,
    inventory_form_ref: inventoryFormReferenceSchema,
    model_ids: sortedIdentifierArraySchema,
    root_source_ref_id: sourceRefIdSchema,
    auxiliary_source_ref_ids: sortedSourceRefIdArraySchema
  })
  .strict();

const modelRecordSchema = z
  .object({
    model_id: identifierSchema,
    ai_name: identifierSchema,
    active: z.boolean(),
    cohort: z.enum(["CURRENT_MAPPED_FORM", "LEGACY_INACTIVE_NO_FORM"]),
    form_id: formIdSchema.nullable(),
    evidence_class: z.enum([
      "LITERAL_REFERENCE_EVIDENCE",
      "DYNAMIC_FAMILY_FORM",
      "LEGACY_INACTIVE_NO_FORM"
    ]),
    public_model_ref: publicModelReferenceSchema,
    inventory_model_ref: inventoryModelReferenceSchema,
    inventory_evidence: z.array(inventoryEvidenceLocatorSchema).max(1_000)
  })
  .strict();

const unboundFormRecordSchema = z
  .object({
    form_id: formIdSchema,
    inventory_form_ref: inventoryUnboundFormReferenceSchema,
    source_ref_ids: sortedSourceRefIdArraySchema
  })
  .strict();

const cohortSchema = z
  .object({
    kind: z.literal("EXACT_FULL_SETTINGS_INVENTORY_COHORT"),
    version: z.literal(COHORT_VERSION),
    canonical_sha256: sha256Schema,
    current_form_ids: sortedFormIdArraySchema,
    current_model_bearing_form_ids: sortedFormIdArraySchema,
    current_zero_model_form_ids: sortedFormIdArraySchema,
    current_model_ids: sortedIdentifierArraySchema,
    legacy_no_form_model_ids: sortedIdentifierArraySchema,
    all_model_ids: sortedIdentifierArraySchema,
    unbound_provider_form_ids: sortedFormIdArraySchema,
    all_source_ref_ids: sortedSourceRefIdArraySchema
  })
  .strict();

const compileBoundarySchema = z
  .object({
    current_mapped_provider_source_ref_ids: sortedSourceRefIdArraySchema,
    deferred_source_ref_ids: sortedSourceRefIdArraySchema
  })
  .strict();

const summarySchema = z
  .object({
    current_forms: nonnegativeIntegerSchema,
    current_model_bearing_forms: nonnegativeIntegerSchema,
    current_zero_model_forms: nonnegativeIntegerSchema,
    current_model_contexts: nonnegativeIntegerSchema,
    legacy_no_form_models: nonnegativeIntegerSchema,
    model_variants: nonnegativeIntegerSchema,
    literal_evidence_models: nonnegativeIntegerSchema,
    dynamic_current_models: nonnegativeIntegerSchema,
    unbound_provider_forms: nonnegativeIntegerSchema,
    inventory_evidence_locators: nonnegativeIntegerSchema,
    provider_inventory_evidence_locators: nonnegativeIntegerSchema,
    helper_inventory_evidence_locators: nonnegativeIntegerSchema,
    helper_inventory_evidence_source_refs: nonnegativeIntegerSchema,
    source_refs: nonnegativeIntegerSchema,
    current_mapped_provider_source_refs: nonnegativeIntegerSchema,
    deferred_source_refs: nonnegativeIntegerSchema,
    current_model_bearing_form_root_source_refs: nonnegativeIntegerSchema,
    current_zero_model_form_root_source_refs: nonnegativeIntegerSchema,
    current_form_auxiliary_source_refs: nonnegativeIntegerSchema,
    unbound_provider_source_refs: nonnegativeIntegerSchema,
    direct_settings_helper_source_refs: nonnegativeIntegerSchema,
    settings_registry_source_refs: nonnegativeIntegerSchema,
    vue_source_refs: nonnegativeIntegerSchema,
    typescript_source_refs: nonnegativeIntegerSchema,
    javascript_source_refs: nonnegativeIntegerSchema,
    current_root_vue_source_refs: nonnegativeIntegerSchema,
    current_auxiliary_vue_source_refs: nonnegativeIntegerSchema,
    current_auxiliary_typescript_source_refs: nonnegativeIntegerSchema,
    current_auxiliary_javascript_source_refs: nonnegativeIntegerSchema
  })
  .strict();

const censusManifestBaseSchema = z
  .object({
    schema_version: z.literal("2.0.0"),
    catalog_kind: z.literal(
      "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CENSUS_MANIFEST"
    ),
    evidence_level: z.literal("STATIC_INVENTORY_COHORT_PLAN"),
    runtime_usable: z.literal(false),
    source_verification_status: z.literal(SOURCE_VERIFICATION_STATUS),
    compilation_status: z.literal(COMPILATION_STATUS),
    generated_at: utcTimestampSchema,
    public_catalog: publicCatalogBindingSchema,
    source_inventory: sourceInventoryBindingSchema,
    cohort: cohortSchema,
    compile_boundary: compileBoundarySchema,
    source_identities: z.array(sourceIdentitySchema).min(1).max(10_000),
    forms: z.array(formRecordSchema).min(1).max(1_000),
    models: z.array(modelRecordSchema).min(1).max(10_000),
    unbound_provider_forms: z.array(unboundFormRecordSchema).max(1_000),
    summary: summarySchema,
    limitations: z.tuple([
      z.literal("FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT"),
      z.literal("INVENTORY_IDENTITIES_ONLY"),
      z.literal("NO_VENDOR_CODE_EXECUTION"),
      z.literal("NO_GENERATION_OR_AUTH_CALLS_PERFORMED")
    ])
  })
  .strict();

export type NormalizedSettingsParserCensusManifest = z.infer<
  typeof censusManifestBaseSchema
>;
export type NormalizedSettingsParserCensusSourceIdentity =
  NormalizedSettingsParserCensusManifest["source_identities"][number];
export type NormalizedSettingsParserCensusModel =
  NormalizedSettingsParserCensusManifest["models"][number];

export const normalizedSettingsParserCensusManifestSchema =
  censusManifestBaseSchema.superRefine((manifest, context) => {
    validateManifestRelationships(manifest, context);
  });

export interface BuildNormalizedSettingsParserCensusManifestInput {
  publicCatalog: SyntxPublicCatalogSnapshot;
  inventory: SettingsSourceInventory;
}

export interface LoadNormalizedSettingsParserCensusManifestOptions {
  path?: string;
  publicCatalog?: SyntxPublicCatalogSnapshot;
  inventory?: SettingsSourceInventory;
}

export function buildNormalizedSettingsParserCensusManifest(
  input: BuildNormalizedSettingsParserCensusManifestInput
): NormalizedSettingsParserCensusManifest {
  const { publicCatalog, inventory } = validateSources(
    input.publicCatalog,
    input.inventory
  );
  const inventoryHash = sha256CanonicalPayload(inventory);
  const sourceIdentities = buildSourceIdentities(inventory);
  const sourceByLocator = indexSourceIdentitiesByLocator(sourceIdentities);

  const publicAiByName = indexUnique(
    publicCatalog.ai,
    (entry) => entry.value
  );
  const publicModelsById = indexUnique(
    publicCatalog.models,
    (entry) => entry.value
  );
  const inventoryModelsById = indexUnique(
    inventory.models,
    (entry) => entry.model_id
  );

  const models = [...inventory.models]
    .sort((left, right) => compareText(left.model_id, right.model_id))
    .map((inventoryModel) => {
      const publicModel = publicModelsById.get(inventoryModel.model_id);
      if (publicModel === undefined) {
        throw new NormalizedSettingsParserCensusManifestError(
          "SOURCE_RELATIONSHIP_INVALID"
        );
      }
      return buildModelRecord(
        publicModel,
        inventoryModel,
        inventory,
        inventoryHash,
        sourceByLocator
      );
    });
  if (models.length !== publicModelsById.size || models.length !== inventoryModelsById.size) {
    throw new NormalizedSettingsParserCensusManifestError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }

  const modelsByAiName = groupBy(models, (model) => model.ai_name);
  const sourceById = new Map(
    sourceIdentities.map((source) => [source.source_ref_id, source] as const)
  );
  const forms = [...inventory.family_forms]
    .sort((left, right) => compareText(left.form_id, right.form_id))
    .map((inventoryForm) => {
      const publicAi = publicAiByName.get(inventoryForm.ai_name);
      if (publicAi === undefined) {
        throw new NormalizedSettingsParserCensusManifestError(
          "SOURCE_RELATIONSHIP_INVALID"
        );
      }
      return buildFormRecord(
        publicAi,
        inventoryForm,
        inventory,
        inventoryHash,
        modelsByAiName.get(inventoryForm.ai_name) ?? [],
        sourceIdentities
      );
    });

  const unboundProviderForms = [...inventory.unbound_registry_forms]
    .sort((left, right) => compareText(left.form_id, right.form_id))
    .map((unboundForm) => {
      const sourceRefIds = sourceIdentities
        .filter(
          (source) =>
            source.form_id === unboundForm.form_id &&
            source.disposition ===
              "PINNED_IN_INVENTORY_UNBOUND_PROVIDER_FORM"
        )
        .map((source) => source.source_ref_id)
        .sort(compareText);
      if (sourceRefIds.length === 0) {
        throw new NormalizedSettingsParserCensusManifestError(
          "SOURCE_RELATIONSHIP_INVALID"
        );
      }
      return {
        form_id: unboundForm.form_id,
        inventory_form_ref: {
          aggregate_inventory_sha256: inventoryHash,
          key: "form_id" as const,
          form_id: unboundForm.form_id,
          canonical_sha256: sha256CanonicalPayload(unboundForm)
        },
        source_ref_ids: sourceRefIds
      };
    });

  const currentMappedProviderSourceRefIds = sourceIdentities
    .filter((source) => CURRENT_MAPPED_DISPOSITIONS.has(source.disposition))
    .map((source) => source.source_ref_id)
    .sort(compareText);
  const deferredSourceRefIds = sourceIdentities
    .filter((source) => DEFERRED_DISPOSITIONS.has(source.disposition))
    .map((source) => source.source_ref_id)
    .sort(compareText);

  const scopeWithoutHash = {
    kind: "EXACT_FULL_SETTINGS_INVENTORY_COHORT" as const,
    version: COHORT_VERSION,
    current_form_ids: forms.map((form) => form.form_id).sort(compareText),
    current_model_bearing_form_ids: forms
      .filter((form) => form.model_ids.length > 0)
      .map((form) => form.form_id)
      .sort(compareText),
    current_zero_model_form_ids: forms
      .filter((form) => form.model_ids.length === 0)
      .map((form) => form.form_id)
      .sort(compareText),
    current_model_ids: models
      .filter((model) => model.cohort === "CURRENT_MAPPED_FORM")
      .map((model) => model.model_id)
      .sort(compareText),
    legacy_no_form_model_ids: models
      .filter((model) => model.cohort === "LEGACY_INACTIVE_NO_FORM")
      .map((model) => model.model_id)
      .sort(compareText),
    all_model_ids: models.map((model) => model.model_id).sort(compareText),
    unbound_provider_form_ids: unboundProviderForms
      .map((form) => form.form_id)
      .sort(compareText),
    all_source_ref_ids: sourceIdentities
      .map((source) => source.source_ref_id)
      .sort(compareText)
  };
  const compileBoundary = {
    current_mapped_provider_source_ref_ids:
      currentMappedProviderSourceRefIds,
    deferred_source_ref_ids: deferredSourceRefIds
  };
  const cohort = {
    ...scopeWithoutHash,
    canonical_sha256: calculateCohortHash({
      sourceVerificationStatus: SOURCE_VERIFICATION_STATUS,
      compilationStatus: COMPILATION_STATUS,
      scope: scopeWithoutHash,
      compileBoundary,
      sourceIdentities,
      forms,
      models,
      unboundProviderForms
    })
  };

  const candidate = {
    schema_version: "2.0.0",
    catalog_kind:
      "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CENSUS_MANIFEST",
    evidence_level: "STATIC_INVENTORY_COHORT_PLAN",
    runtime_usable: false,
    source_verification_status: SOURCE_VERIFICATION_STATUS,
    compilation_status: COMPILATION_STATUS,
    generated_at: inventory.generated_at,
    public_catalog: {
      canonical_sha256: sha256CanonicalPayload(publicCatalog),
      fetched_at: publicCatalog.fetched_at,
      payload_hashes: {
        ai: publicCatalog.sources.ai.canonical_sha256,
        models: publicCatalog.sources.models.canonical_sha256,
        llm_models: publicCatalog.sources.llm_models.canonical_sha256
      }
    },
    source_inventory: {
      canonical_sha256: inventoryHash,
      generated_at: inventory.generated_at,
      build_id: inventory.build.id,
      public_catalog_hashes: {
        ai: inventory.public_catalog.ai_sha256,
        models: inventory.public_catalog.models_sha256,
        llm_models: inventory.public_catalog.llm_models_sha256
      }
    },
    cohort,
    compile_boundary: compileBoundary,
    source_identities: sourceIdentities,
    forms,
    models,
    unbound_provider_forms: unboundProviderForms,
    summary: summarizeManifest(
      forms,
      models,
      unboundProviderForms,
      sourceIdentities,
      sourceById
    ),
    limitations: [
      "FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT",
      "INVENTORY_IDENTITIES_ONLY",
      "NO_VENDOR_CODE_EXECUTION",
      "NO_GENERATION_OR_AUTH_CALLS_PERFORMED"
    ]
  } as const;

  try {
    return normalizedSettingsParserCensusManifestSchema.parse(candidate);
  } catch (error) {
    if (process.env.SYNTX_DEBUG_CENSUS === "1") console.error(error);
    throw new NormalizedSettingsParserCensusManifestError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }
}

export function loadNormalizedSettingsParserCensusManifest(
  options: LoadNormalizedSettingsParserCensusManifestOptions = {}
): NormalizedSettingsParserCensusManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(
      readFileSync(options.path ?? findDefaultCensusManifestPath(), "utf8")
    );
  } catch {
    throw new NormalizedSettingsParserCensusManifestError(
      "CENSUS_MANIFEST_INVALID"
    );
  }

  const manifest = parseManifest(raw);
  const publicCatalog =
    options.publicCatalog ?? loadPublicCatalogForValidation();
  const inventory =
    options.inventory ?? loadInventoryForValidation(publicCatalog);
  assertNormalizedSettingsParserCensusManifestMatchesSources(
    manifest,
    publicCatalog,
    inventory
  );
  return manifest;
}

export function serializeNormalizedSettingsParserCensusManifest(
  manifest: NormalizedSettingsParserCensusManifest,
  publicCatalog: SyntxPublicCatalogSnapshot,
  inventory: SettingsSourceInventory
): string {
  assertNormalizedSettingsParserCensusManifestMatchesSources(
    manifest,
    publicCatalog,
    inventory
  );
  return serializeManifestShape(manifest);
}

export function assertNormalizedSettingsParserCensusManifestUnchanged(
  recorded: NormalizedSettingsParserCensusManifest,
  observed: NormalizedSettingsParserCensusManifest
): void {
  if (
    serializeManifestShape(recorded) !== serializeManifestShape(observed)
  ) {
    throw new NormalizedSettingsParserCensusManifestError(
      "CENSUS_MANIFEST_DRIFT_DETECTED"
    );
  }
}

export function assertNormalizedSettingsParserCensusManifestMatchesSources(
  manifest: NormalizedSettingsParserCensusManifest,
  publicCatalog: SyntxPublicCatalogSnapshot,
  inventory: SettingsSourceInventory
): void {
  const validated = parseManifest(manifest);
  const rebuilt = buildNormalizedSettingsParserCensusManifest({
    publicCatalog,
    inventory
  });
  if (serializeManifestShape(validated) !== serializeManifestShape(rebuilt)) {
    throw new NormalizedSettingsParserCensusManifestError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }
}

function buildSourceIdentities(
  inventory: SettingsSourceInventory
): NormalizedSettingsParserCensusSourceIdentity[] {
  const familyByFormId = new Map(
    inventory.family_forms.map((form) => [form.form_id, form] as const)
  );
  const unboundFormIds = new Set(
    inventory.unbound_registry_forms.map((form) => form.form_id)
  );
  const artifactsByModule = groupBy(
    inventory.source_artifacts,
    (artifact) => artifact.module_name
  );
  const identities: NormalizedSettingsParserCensusSourceIdentity[] = [];

  for (const mapArtifact of inventory.source_artifacts) {
    if (mapArtifact.kind !== "SOURCE_MAP_V3") continue;
    const javascript = (artifactsByModule.get(mapArtifact.module_name) ?? []).find(
      (artifact) => artifact.kind === "JAVASCRIPT"
    );
    if (
      javascript === undefined ||
      javascript.role !== mapArtifact.role ||
      javascript.form_id !== mapArtifact.form_id ||
      mapArtifact.source_map === null
    ) {
      throw new NormalizedSettingsParserCensusManifestError(
        "SOURCE_RELATIONSHIP_INVALID"
      );
    }

    for (const source of mapArtifact.source_map.settings_sources) {
      const core = {
        role: mapArtifact.role,
        module_name: mapArtifact.module_name,
        form_id: mapArtifact.form_id,
        module_javascript_sha256: javascript.sha256,
        module_source_map_sha256: mapArtifact.sha256,
        source_index: source.source_index,
        source_path: source.source_path,
        source_content_sha256: source.source_content_sha256
      };
      identities.push({
        source_ref_id: makeSourceRefId(core),
        ...core,
        source_kind: sourceKindFromPath(source.source_path),
        disposition: deriveSourceDisposition(
          mapArtifact,
          source.source_path,
          familyByFormId,
          unboundFormIds
        )
      });
    }
  }

  identities.sort((left, right) =>
    compareText(left.source_ref_id, right.source_ref_id)
  );
  if (
    new Set(identities.map((source) => source.source_ref_id)).size !==
    identities.length
  ) {
    throw new NormalizedSettingsParserCensusManifestError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }
  return identities;
}

function deriveSourceDisposition(
  mapArtifact: SettingsSourceArtifact,
  sourcePath: string,
  familyByFormId: ReadonlyMap<
    string,
    SettingsSourceInventory["family_forms"][number]
  >,
  unboundFormIds: ReadonlySet<string>
): SourceDisposition {
  if (mapArtifact.role === "DIRECT_SETTINGS_HELPER") {
    return "PINNED_IN_INVENTORY_DIRECT_SETTINGS_HELPER";
  }
  if (mapArtifact.role === "SETTINGS_REGISTRY") {
    return "PINNED_IN_INVENTORY_SETTINGS_REGISTRY";
  }
  if (mapArtifact.form_id === null) {
    throw new NormalizedSettingsParserCensusManifestError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }
  const family = familyByFormId.get(mapArtifact.form_id);
  if (family === undefined) {
    if (unboundFormIds.has(mapArtifact.form_id)) {
      return "PINNED_IN_INVENTORY_UNBOUND_PROVIDER_FORM";
    }
    throw new NormalizedSettingsParserCensusManifestError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }
  if (
    sourcePath !==
    `${SETTINGS_SOURCE_PREFIX}${mapArtifact.form_id}.vue`
  ) {
    return "PINNED_IN_INVENTORY_CURRENT_FORM_AUXILIARY";
  }
  return family.model_count === 0
    ? "PINNED_IN_INVENTORY_CURRENT_ZERO_MODEL_FORM_ROOT"
    : "PINNED_IN_INVENTORY_CURRENT_MODEL_BEARING_FORM_ROOT";
}

function buildFormRecord(
  publicAi: SyntxPublicAiEntry,
  inventoryForm: SettingsSourceInventory["family_forms"][number],
  inventory: SettingsSourceInventory,
  inventoryHash: string,
  models: readonly NormalizedSettingsParserCensusModel[],
  sourceIdentities: readonly NormalizedSettingsParserCensusSourceIdentity[]
): NormalizedSettingsParserCensusManifest["forms"][number] {
  const formSources = sourceIdentities.filter(
    (source) =>
      source.role === "PROVIDER_FORM" &&
      source.form_id === inventoryForm.form_id &&
      CURRENT_MAPPED_DISPOSITIONS.has(source.disposition)
  );
  const rootSources = formSources.filter(
    (source) =>
      source.source_path ===
      `${SETTINGS_SOURCE_PREFIX}${inventoryForm.form_id}.vue`
  );
  if (rootSources.length !== 1) {
    throw new NormalizedSettingsParserCensusManifestError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }
  const modelIds = models.map((model) => model.model_id).sort(compareText);
  if (inventoryForm.model_count !== modelIds.length) {
    throw new NormalizedSettingsParserCensusManifestError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }
  return {
    form_id: inventoryForm.form_id,
    ai_name: inventoryForm.ai_name,
    ai_active: inventoryForm.ai_active,
    public_ai_ref: {
      aggregate_ai_sha256: inventory.public_catalog.ai_sha256,
      key: "value",
      ai_name: publicAi.value,
      canonical_sha256: sha256CanonicalPayload(publicAi)
    },
    inventory_form_ref: {
      aggregate_inventory_sha256: inventoryHash,
      key: "ai_name",
      ai_name: inventoryForm.ai_name,
      form_id: inventoryForm.form_id,
      canonical_sha256: sha256CanonicalPayload(inventoryForm)
    },
    model_ids: modelIds,
    root_source_ref_id: rootSources[0]!.source_ref_id,
    auxiliary_source_ref_ids: formSources
      .filter((source) => source.source_ref_id !== rootSources[0]!.source_ref_id)
      .map((source) => source.source_ref_id)
      .sort(compareText)
  };
}

function buildModelRecord(
  publicModel: SyntxPublicModelEntry,
  inventoryModel: SettingsSourceInventory["models"][number],
  inventory: SettingsSourceInventory,
  inventoryHash: string,
  sourceByLocator: ReadonlyMap<
    string,
    NormalizedSettingsParserCensusSourceIdentity
  >
): NormalizedSettingsParserCensusModel {
  const inventoryEvidence = inventoryModel.evidence
    .map((evidence) => {
      const source = sourceByLocator.get(locatorIdentityKey(evidence));
      if (source === undefined) {
        throw new NormalizedSettingsParserCensusManifestError(
          "SOURCE_RELATIONSHIP_INVALID"
        );
      }
      return {
        source_ref_id: source.source_ref_id,
        token_kind: evidence.token_kind,
        line: evidence.line,
        column: evidence.column
      };
    })
    .sort(compareEvidenceLocators);

  return {
    model_id: inventoryModel.model_id,
    ai_name: inventoryModel.ai_name,
    active: inventoryModel.active,
    cohort:
      inventoryModel.form_id === null
        ? "LEGACY_INACTIVE_NO_FORM"
        : "CURRENT_MAPPED_FORM",
    form_id: inventoryModel.form_id,
    evidence_class: inventoryModel.evidence_class,
    public_model_ref: {
      aggregate_models_sha256: inventory.public_catalog.models_sha256,
      key: "value",
      model_id: publicModel.value,
      canonical_sha256: sha256CanonicalPayload(publicModel)
    },
    inventory_model_ref: {
      aggregate_inventory_sha256: inventoryHash,
      key: "model_id",
      model_id: inventoryModel.model_id,
      canonical_sha256: sha256CanonicalPayload(inventoryModel)
    },
    inventory_evidence: inventoryEvidence
  };
}

function validateManifestRelationships(
  manifest: NormalizedSettingsParserCensusManifest,
  context: z.RefinementCtx
): void {
  if (
    manifest.generated_at !== manifest.source_inventory.generated_at ||
    !samePayloadHashes(
      manifest.public_catalog.payload_hashes,
      manifest.source_inventory.public_catalog_hashes
    )
  ) {
    addIssue(context, ["source_inventory"], "Source bindings differ.");
  }

  const sourceIds = manifest.source_identities.map(
    (source) => source.source_ref_id
  );
  if (
    !isSortedUniqueStrings(sourceIds) ||
    !sameStringArray(manifest.cohort.all_source_ref_ids, sourceIds)
  ) {
    addIssue(context, ["source_identities"], "Source identities are not canonical.");
  }
  const sourceById = new Map(
    manifest.source_identities.map(
      (source) => [source.source_ref_id, source] as const
    )
  );
  const formById = new Map(
    manifest.forms.map((form) => [form.form_id, form] as const)
  );
  const unboundById = new Map(
    manifest.unbound_provider_forms.map(
      (form) => [form.form_id, form] as const
    )
  );

  for (const [index, source] of manifest.source_identities.entries()) {
    if (source.source_ref_id !== makeSourceRefId(source)) {
      addIssue(context, ["source_identities", index, "source_ref_id"], "Source ID does not bind its identity.");
    }
    const expectedSourceKind = trySourceKindFromPath(source.source_path);
    if (
      expectedSourceKind === undefined ||
      source.source_kind !== expectedSourceKind
    ) {
      addIssue(context, ["source_identities", index, "source_kind"], "Source kind and path differ.");
    }
    if (
      (source.role === "PROVIDER_FORM") !== (source.form_id !== null) ||
      (source.role === "SETTINGS_REGISTRY" &&
        (source.module_name !== "Settings2.js" || source.form_id !== null)) ||
      (source.role !== "PROVIDER_FORM" && source.form_id !== null)
    ) {
      addIssue(context, ["source_identities", index], "Source role and form differ.");
    }
    if (
      source.role === "PROVIDER_FORM" &&
      source.form_id !== null &&
      !isProviderModuleForForm(source.module_name, source.form_id)
    ) {
      addIssue(context, ["source_identities", index, "module_name"], "Provider module and form differ.");
    }
    const expectedDisposition = expectedManifestDisposition(
      source,
      formById,
      unboundById
    );
    if (
      expectedDisposition === undefined ||
      source.disposition !== expectedDisposition
    ) {
      addIssue(context, ["source_identities", index, "disposition"], "Source disposition is inconsistent.");
    }
  }

  const expectedCurrentSourceIds = manifest.source_identities
    .filter((source) => CURRENT_MAPPED_DISPOSITIONS.has(source.disposition))
    .map((source) => source.source_ref_id)
    .sort(compareText);
  const expectedDeferredSourceIds = manifest.source_identities
    .filter((source) => DEFERRED_DISPOSITIONS.has(source.disposition))
    .map((source) => source.source_ref_id)
    .sort(compareText);
  if (
    !sameStringArray(
      manifest.compile_boundary.current_mapped_provider_source_ref_ids,
      expectedCurrentSourceIds
    ) ||
    !sameStringArray(
      manifest.compile_boundary.deferred_source_ref_ids,
      expectedDeferredSourceIds
    ) ||
    new Set([...expectedCurrentSourceIds, ...expectedDeferredSourceIds]).size !==
      sourceIds.length
  ) {
    addIssue(context, ["compile_boundary"], "Compile boundary is not an exact partition.");
  }

  validateFormRelationships(manifest, sourceById, context);
  validateModelRelationships(manifest, sourceById, context);
  validateUnboundFormRelationships(manifest, sourceById, context);

  const expectedCohortHash = calculateCohortHash({
    sourceVerificationStatus: manifest.source_verification_status,
    compilationStatus: manifest.compilation_status,
    scope: {
      kind: manifest.cohort.kind,
      version: manifest.cohort.version,
      current_form_ids: manifest.cohort.current_form_ids,
      current_model_bearing_form_ids:
        manifest.cohort.current_model_bearing_form_ids,
      current_zero_model_form_ids:
        manifest.cohort.current_zero_model_form_ids,
      current_model_ids: manifest.cohort.current_model_ids,
      legacy_no_form_model_ids: manifest.cohort.legacy_no_form_model_ids,
      all_model_ids: manifest.cohort.all_model_ids,
      unbound_provider_form_ids:
        manifest.cohort.unbound_provider_form_ids,
      all_source_ref_ids: manifest.cohort.all_source_ref_ids
    },
    compileBoundary: manifest.compile_boundary,
    sourceIdentities: manifest.source_identities,
    forms: manifest.forms,
    models: manifest.models,
    unboundProviderForms: manifest.unbound_provider_forms
  });
  if (manifest.cohort.canonical_sha256 !== expectedCohortHash) {
    addIssue(context, ["cohort", "canonical_sha256"], "Cohort hash does not match its exact lists.");
  }

  const expectedSummary = summarizeManifest(
    manifest.forms,
    manifest.models,
    manifest.unbound_provider_forms,
    manifest.source_identities,
    sourceById
  );
  if (JSON.stringify(manifest.summary) !== JSON.stringify(expectedSummary)) {
    addIssue(context, ["summary"], "Summary does not match manifest relationships.");
  }
}

/**
 * Some current builds split one provider form across numbered bundles (for
 * example `seedance2.js` for the `seedance` form). Keep the relationship
 * strict: accept the canonical form bundle or a numeric suffix only; arbitrary
 * module/form mismatches remain invalid.
 */
function isProviderModuleForForm(moduleName: string, formId: string): boolean {
  return moduleName === `${formId}.js` || new RegExp(`^${escapeRegExp(formId)}[0-9]+\\.js$`, "u").test(moduleName);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
}

function validateFormRelationships(
  manifest: NormalizedSettingsParserCensusManifest,
  sourceById: ReadonlyMap<string, NormalizedSettingsParserCensusSourceIdentity>,
  context: z.RefinementCtx
): void {
  const formIds = manifest.forms.map((form) => form.form_id);
  const aiNames = manifest.forms.map((form) => form.ai_name);
  if (
    !isSortedUniqueStrings(formIds) ||
    new Set(aiNames).size !== aiNames.length ||
    !sameStringArray(manifest.cohort.current_form_ids, formIds)
  ) {
    addIssue(context, ["forms"], "Current forms are duplicated, unordered, or out of scope.");
  }
  const modelBearing = manifest.forms
    .filter((form) => form.model_ids.length > 0)
    .map((form) => form.form_id);
  const zeroModel = manifest.forms
    .filter((form) => form.model_ids.length === 0)
    .map((form) => form.form_id);
  if (
    !sameStringArray(
      manifest.cohort.current_model_bearing_form_ids,
      modelBearing
    ) ||
    !sameStringArray(manifest.cohort.current_zero_model_form_ids, zeroModel)
  ) {
    addIssue(context, ["cohort"], "Form cohorts do not match form records.");
  }

  for (const [index, form] of manifest.forms.entries()) {
    if (
      form.public_ai_ref.ai_name !== form.ai_name ||
      form.public_ai_ref.aggregate_ai_sha256 !==
        manifest.public_catalog.payload_hashes.ai ||
      form.inventory_form_ref.ai_name !== form.ai_name ||
      form.inventory_form_ref.form_id !== form.form_id ||
      form.inventory_form_ref.aggregate_inventory_sha256 !==
        manifest.source_inventory.canonical_sha256
    ) {
      addIssue(context, ["forms", index], "Form source references differ from the record.");
    }
    const root = sourceById.get(form.root_source_ref_id);
    const expectedRootDisposition =
      form.model_ids.length === 0
        ? "PINNED_IN_INVENTORY_CURRENT_ZERO_MODEL_FORM_ROOT"
        : "PINNED_IN_INVENTORY_CURRENT_MODEL_BEARING_FORM_ROOT";
    if (
      root === undefined ||
      root.role !== "PROVIDER_FORM" ||
      root.form_id !== form.form_id ||
      root.source_path !== `${SETTINGS_SOURCE_PREFIX}${form.form_id}.vue` ||
      root.disposition !== expectedRootDisposition
    ) {
      addIssue(context, ["forms", index, "root_source_ref_id"], "Form root reference is invalid.");
    }
    const expectedAuxiliaryIds = [...sourceById.values()]
      .filter(
        (source) =>
          source.form_id === form.form_id &&
          source.disposition ===
            "PINNED_IN_INVENTORY_CURRENT_FORM_AUXILIARY"
      )
      .map((source) => source.source_ref_id)
      .sort(compareText);
    if (!sameStringArray(form.auxiliary_source_ref_ids, expectedAuxiliaryIds)) {
      addIssue(context, ["forms", index, "auxiliary_source_ref_ids"], "Form auxiliary references are incomplete.");
    }
  }
}

function validateModelRelationships(
  manifest: NormalizedSettingsParserCensusManifest,
  sourceById: ReadonlyMap<string, NormalizedSettingsParserCensusSourceIdentity>,
  context: z.RefinementCtx
): void {
  const modelIds = manifest.models.map((model) => model.model_id);
  if (
    !isSortedUniqueStrings(modelIds) ||
    !sameStringArray(manifest.cohort.all_model_ids, modelIds)
  ) {
    addIssue(context, ["models"], "Models are duplicated, unordered, or out of scope.");
  }
  const currentModelIds = manifest.models
    .filter((model) => model.cohort === "CURRENT_MAPPED_FORM")
    .map((model) => model.model_id);
  const legacyModelIds = manifest.models
    .filter((model) => model.cohort === "LEGACY_INACTIVE_NO_FORM")
    .map((model) => model.model_id);
  if (
    !sameStringArray(manifest.cohort.current_model_ids, currentModelIds) ||
    !sameStringArray(
      manifest.cohort.legacy_no_form_model_ids,
      legacyModelIds
    )
  ) {
    addIssue(context, ["cohort"], "Model cohorts do not match model records.");
  }

  const modelsByForm = groupBy(
    manifest.models.filter(
      (model): model is NormalizedSettingsParserCensusModel & { form_id: string } =>
        model.form_id !== null
    ),
    (model) => model.form_id
  );
  for (const [formIndex, form] of manifest.forms.entries()) {
    const expected = (modelsByForm.get(form.form_id) ?? [])
      .map((model) => model.model_id)
      .sort(compareText);
    if (!sameStringArray(form.model_ids, expected)) {
      addIssue(context, ["forms", formIndex, "model_ids"], "Form model list is incomplete.");
    }
  }

  const formById = new Map(
    manifest.forms.map((form) => [form.form_id, form] as const)
  );
  for (const [index, model] of manifest.models.entries()) {
    if (
      model.public_model_ref.model_id !== model.model_id ||
      model.public_model_ref.aggregate_models_sha256 !==
        manifest.public_catalog.payload_hashes.models ||
      model.inventory_model_ref.model_id !== model.model_id ||
      model.inventory_model_ref.aggregate_inventory_sha256 !==
        manifest.source_inventory.canonical_sha256
    ) {
      addIssue(context, ["models", index], "Model source references differ from the record.");
    }
    const evidenceKeys = model.inventory_evidence.map(evidenceLocatorKey);
    if (
      new Set(evidenceKeys).size !== evidenceKeys.length ||
      !isSortedBy(model.inventory_evidence, compareEvidenceLocators)
    ) {
      addIssue(context, ["models", index, "inventory_evidence"], "Model evidence is duplicated or unordered.");
    }

    if (model.cohort === "LEGACY_INACTIVE_NO_FORM") {
      if (
        model.active ||
        model.form_id !== null ||
        model.evidence_class !== "LEGACY_INACTIVE_NO_FORM" ||
        model.inventory_evidence.length !== 0
      ) {
        addIssue(context, ["models", index], "Legacy model relationship is invalid.");
      }
      continue;
    }

    const form = model.form_id === null ? undefined : formById.get(model.form_id);
    if (
      form === undefined ||
      form.ai_name !== model.ai_name ||
      model.evidence_class === "LEGACY_INACTIVE_NO_FORM" ||
      (model.evidence_class === "LITERAL_REFERENCE_EVIDENCE") !==
        (model.inventory_evidence.length > 0)
    ) {
      addIssue(context, ["models", index], "Current model relationship is invalid.");
    }
    for (const [evidenceIndex, evidence] of model.inventory_evidence.entries()) {
      const source = sourceById.get(evidence.source_ref_id);
      const allowedProvider =
        source?.role === "PROVIDER_FORM" && source.form_id === model.form_id;
      const allowedHelper = source?.role === "DIRECT_SETTINGS_HELPER";
      if (source === undefined || (!allowedProvider && !allowedHelper)) {
        addIssue(
          context,
          ["models", index, "inventory_evidence", evidenceIndex],
          "Model evidence source is not in its inventory boundary."
        );
      }
    }
  }
}

function validateUnboundFormRelationships(
  manifest: NormalizedSettingsParserCensusManifest,
  sourceById: ReadonlyMap<string, NormalizedSettingsParserCensusSourceIdentity>,
  context: z.RefinementCtx
): void {
  const formIds = manifest.unbound_provider_forms.map((form) => form.form_id);
  if (
    !isSortedUniqueStrings(formIds) ||
    !sameStringArray(manifest.cohort.unbound_provider_form_ids, formIds)
  ) {
    addIssue(context, ["unbound_provider_forms"], "Unbound forms are not canonical.");
  }
  for (const [index, form] of manifest.unbound_provider_forms.entries()) {
    if (
      form.inventory_form_ref.form_id !== form.form_id ||
      form.inventory_form_ref.aggregate_inventory_sha256 !==
        manifest.source_inventory.canonical_sha256
    ) {
      addIssue(context, ["unbound_provider_forms", index], "Unbound form reference differs from the record.");
    }
    const expectedSourceIds = [...sourceById.values()]
      .filter(
        (source) =>
          source.form_id === form.form_id &&
          source.disposition ===
            "PINNED_IN_INVENTORY_UNBOUND_PROVIDER_FORM"
      )
      .map((source) => source.source_ref_id)
      .sort(compareText);
    if (!sameStringArray(form.source_ref_ids, expectedSourceIds)) {
      addIssue(context, ["unbound_provider_forms", index, "source_ref_ids"], "Unbound form sources are incomplete.");
    }
  }
}

function expectedManifestDisposition(
  source: NormalizedSettingsParserCensusSourceIdentity,
  formById: ReadonlyMap<
    string,
    NormalizedSettingsParserCensusManifest["forms"][number]
  >,
  unboundById: ReadonlyMap<
    string,
    NormalizedSettingsParserCensusManifest["unbound_provider_forms"][number]
  >
): SourceDisposition | undefined {
  if (source.role === "DIRECT_SETTINGS_HELPER") {
    return "PINNED_IN_INVENTORY_DIRECT_SETTINGS_HELPER";
  }
  if (source.role === "SETTINGS_REGISTRY") {
    return "PINNED_IN_INVENTORY_SETTINGS_REGISTRY";
  }
  if (source.form_id === null) return undefined;
  const form = formById.get(source.form_id);
  if (form !== undefined) {
    if (
      source.source_path ===
      `${SETTINGS_SOURCE_PREFIX}${source.form_id}.vue`
    ) {
      return form.model_ids.length === 0
        ? "PINNED_IN_INVENTORY_CURRENT_ZERO_MODEL_FORM_ROOT"
        : "PINNED_IN_INVENTORY_CURRENT_MODEL_BEARING_FORM_ROOT";
    }
    return "PINNED_IN_INVENTORY_CURRENT_FORM_AUXILIARY";
  }
  if (unboundById.has(source.form_id)) {
    return "PINNED_IN_INVENTORY_UNBOUND_PROVIDER_FORM";
  }
  return undefined;
}

function summarizeManifest(
  forms: readonly NormalizedSettingsParserCensusManifest["forms"][number][],
  models: readonly NormalizedSettingsParserCensusModel[],
  unboundForms: readonly NormalizedSettingsParserCensusManifest["unbound_provider_forms"][number][],
  sources: readonly NormalizedSettingsParserCensusSourceIdentity[],
  sourceById: ReadonlyMap<string, NormalizedSettingsParserCensusSourceIdentity>
): NormalizedSettingsParserCensusManifest["summary"] {
  const evidence = models.flatMap((model) => model.inventory_evidence);
  const helperEvidence = evidence.filter(
    (locator) =>
      sourceById.get(locator.source_ref_id)?.role === "DIRECT_SETTINGS_HELPER"
  );
  const providerEvidence = evidence.filter(
    (locator) =>
      sourceById.get(locator.source_ref_id)?.role === "PROVIDER_FORM"
  );
  const currentRootSources = sources.filter(
    (source) =>
      source.disposition ===
        "PINNED_IN_INVENTORY_CURRENT_MODEL_BEARING_FORM_ROOT" ||
      source.disposition ===
        "PINNED_IN_INVENTORY_CURRENT_ZERO_MODEL_FORM_ROOT"
  );
  const currentAuxiliarySources = sources.filter(
    (source) =>
      source.disposition ===
      "PINNED_IN_INVENTORY_CURRENT_FORM_AUXILIARY"
  );
  return {
    current_forms: forms.length,
    current_model_bearing_forms: forms.filter(
      (form) => form.model_ids.length > 0
    ).length,
    current_zero_model_forms: forms.filter(
      (form) => form.model_ids.length === 0
    ).length,
    current_model_contexts: models.filter(
      (model) => model.cohort === "CURRENT_MAPPED_FORM"
    ).length,
    legacy_no_form_models: models.filter(
      (model) => model.cohort === "LEGACY_INACTIVE_NO_FORM"
    ).length,
    model_variants: models.length,
    literal_evidence_models: models.filter(
      (model) => model.evidence_class === "LITERAL_REFERENCE_EVIDENCE"
    ).length,
    dynamic_current_models: models.filter(
      (model) => model.evidence_class === "DYNAMIC_FAMILY_FORM"
    ).length,
    unbound_provider_forms: unboundForms.length,
    inventory_evidence_locators: evidence.length,
    provider_inventory_evidence_locators: providerEvidence.length,
    helper_inventory_evidence_locators: helperEvidence.length,
    helper_inventory_evidence_source_refs: new Set(
      helperEvidence.map((locator) => locator.source_ref_id)
    ).size,
    source_refs: sources.length,
    current_mapped_provider_source_refs: sources.filter((source) =>
      CURRENT_MAPPED_DISPOSITIONS.has(source.disposition)
    ).length,
    deferred_source_refs: sources.filter((source) =>
      DEFERRED_DISPOSITIONS.has(source.disposition)
    ).length,
    current_model_bearing_form_root_source_refs: sources.filter(
      (source) =>
        source.disposition ===
        "PINNED_IN_INVENTORY_CURRENT_MODEL_BEARING_FORM_ROOT"
    ).length,
    current_zero_model_form_root_source_refs: sources.filter(
      (source) =>
        source.disposition ===
        "PINNED_IN_INVENTORY_CURRENT_ZERO_MODEL_FORM_ROOT"
    ).length,
    current_form_auxiliary_source_refs: currentAuxiliarySources.length,
    unbound_provider_source_refs: sources.filter(
      (source) =>
        source.disposition ===
        "PINNED_IN_INVENTORY_UNBOUND_PROVIDER_FORM"
    ).length,
    direct_settings_helper_source_refs: sources.filter(
      (source) =>
        source.disposition ===
        "PINNED_IN_INVENTORY_DIRECT_SETTINGS_HELPER"
    ).length,
    settings_registry_source_refs: sources.filter(
      (source) =>
        source.disposition === "PINNED_IN_INVENTORY_SETTINGS_REGISTRY"
    ).length,
    vue_source_refs: sources.filter(
      (source) => source.source_kind === "VUE_SFC"
    ).length,
    typescript_source_refs: sources.filter(
      (source) => source.source_kind === "TYPESCRIPT_MODULE"
    ).length,
    javascript_source_refs: sources.filter(
      (source) => source.source_kind === "JAVASCRIPT_MODULE"
    ).length,
    current_root_vue_source_refs: currentRootSources.filter(
      (source) => source.source_kind === "VUE_SFC"
    ).length,
    current_auxiliary_vue_source_refs: currentAuxiliarySources.filter(
      (source) => source.source_kind === "VUE_SFC"
    ).length,
    current_auxiliary_typescript_source_refs:
      currentAuxiliarySources.filter(
        (source) => source.source_kind === "TYPESCRIPT_MODULE"
      ).length,
    current_auxiliary_javascript_source_refs:
      currentAuxiliarySources.filter(
        (source) => source.source_kind === "JAVASCRIPT_MODULE"
      ).length
  };
}

function calculateCohortHash(input: {
  sourceVerificationStatus: NormalizedSettingsParserCensusManifest["source_verification_status"];
  compilationStatus: NormalizedSettingsParserCensusManifest["compilation_status"];
  scope: Omit<
    NormalizedSettingsParserCensusManifest["cohort"],
    "canonical_sha256"
  >;
  compileBoundary: NormalizedSettingsParserCensusManifest["compile_boundary"];
  sourceIdentities: readonly NormalizedSettingsParserCensusSourceIdentity[];
  forms: readonly NormalizedSettingsParserCensusManifest["forms"][number][];
  models: readonly NormalizedSettingsParserCensusModel[];
  unboundProviderForms: readonly NormalizedSettingsParserCensusManifest["unbound_provider_forms"][number][];
}): string {
  return sha256CanonicalPayload({
    source_verification_status: input.sourceVerificationStatus,
    compilation_status: input.compilationStatus,
    cohort: input.scope,
    compile_boundary: input.compileBoundary,
    source_identities: input.sourceIdentities,
    forms: input.forms,
    models: input.models,
    unbound_provider_forms: input.unboundProviderForms
  });
}

function makeSourceRefId(
  source: Pick<
    NormalizedSettingsParserCensusSourceIdentity,
    | "role"
    | "module_name"
    | "form_id"
    | "module_javascript_sha256"
    | "module_source_map_sha256"
    | "source_index"
    | "source_path"
    | "source_content_sha256"
  >
): string {
  return `settings-source-${sha256CanonicalPayload({
    role: source.role,
    module_name: source.module_name,
    form_id: source.form_id,
    module_javascript_sha256: source.module_javascript_sha256,
    module_source_map_sha256: source.module_source_map_sha256,
    source_index: source.source_index,
    source_path: source.source_path,
    source_content_sha256: source.source_content_sha256
  }).slice("sha256:".length)}`;
}

function indexSourceIdentitiesByLocator(
  sources: readonly NormalizedSettingsParserCensusSourceIdentity[]
): ReadonlyMap<string, NormalizedSettingsParserCensusSourceIdentity> {
  const result = new Map<string, NormalizedSettingsParserCensusSourceIdentity>();
  for (const source of sources) {
    const key = locatorIdentityKey({
      module_sha256: source.module_javascript_sha256,
      source_map_sha256: source.module_source_map_sha256,
      source_index: source.source_index,
      source_path: source.source_path,
      source_content_sha256: source.source_content_sha256
    });
    if (result.has(key)) {
      throw new NormalizedSettingsParserCensusManifestError(
        "SOURCE_RELATIONSHIP_INVALID"
      );
    }
    result.set(key, source);
  }
  return result;
}

function locatorIdentityKey(locator: {
  module_sha256: string;
  source_map_sha256: string;
  source_index: number;
  source_path: string;
  source_content_sha256: string;
}): string {
  return JSON.stringify([
    locator.module_sha256,
    locator.source_map_sha256,
    locator.source_index,
    locator.source_path,
    locator.source_content_sha256
  ]);
}

function evidenceLocatorKey(
  locator: NormalizedSettingsParserCensusModel["inventory_evidence"][number]
): string {
  return JSON.stringify([
    locator.source_ref_id,
    locator.line,
    locator.column,
    locator.token_kind
  ]);
}

function compareEvidenceLocators(
  left: NormalizedSettingsParserCensusModel["inventory_evidence"][number],
  right: NormalizedSettingsParserCensusModel["inventory_evidence"][number]
): number {
  return (
    compareText(left.source_ref_id, right.source_ref_id) ||
    left.line - right.line ||
    left.column - right.column ||
    compareText(left.token_kind, right.token_kind)
  );
}

function sourceKindFromPath(
  sourcePath: string
): SourceKind {
  const sourceKind = trySourceKindFromPath(sourcePath);
  if (sourceKind !== undefined) return sourceKind;
  throw new NormalizedSettingsParserCensusManifestError(
    "SOURCE_RELATIONSHIP_INVALID"
  );
}

function trySourceKindFromPath(
  sourcePath: string
): SourceKind | undefined {
  if (sourcePath.endsWith(".vue")) return "VUE_SFC";
  if (sourcePath.endsWith(".ts")) return "TYPESCRIPT_MODULE";
  if (sourcePath.endsWith(".js")) return "JAVASCRIPT_MODULE";
  return undefined;
}

function validateSources(
  publicCatalogInput: SyntxPublicCatalogSnapshot,
  inventoryInput: SettingsSourceInventory
): {
  publicCatalog: SyntxPublicCatalogSnapshot;
  inventory: SettingsSourceInventory;
} {
  let publicCatalog: SyntxPublicCatalogSnapshot;
  let inventory: SettingsSourceInventory;
  try {
    publicCatalog = syntxPublicCatalogSnapshotSchema.parse(publicCatalogInput);
    inventory = settingsSourceInventorySchema.parse(inventoryInput);
  } catch {
    throw new NormalizedSettingsParserCensusManifestError(
      "SOURCE_VALIDATION_FAILED"
    );
  }
  try {
    assertSettingsSourceInventoryMatchesPublicCatalog(
      inventory,
      publicCatalog
    );
  } catch {
    throw new NormalizedSettingsParserCensusManifestError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }
  return { publicCatalog, inventory };
}

function parseManifest(value: unknown): NormalizedSettingsParserCensusManifest {
  try {
    return normalizedSettingsParserCensusManifestSchema.parse(value);
  } catch {
    throw new NormalizedSettingsParserCensusManifestError(
      "CENSUS_MANIFEST_INVALID"
    );
  }
}

function serializeManifestShape(
  manifest: NormalizedSettingsParserCensusManifest
): string {
  const validated = parseManifest(manifest);
  return `${JSON.stringify(validated, null, 2)}\n`;
}

function indexUnique<T>(
  entries: readonly T[],
  keyOf: (entry: T) => string
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (result.has(key)) {
      throw new NormalizedSettingsParserCensusManifestError(
        "SOURCE_RELATIONSHIP_INVALID"
      );
    }
    result.set(key, entry);
  }
  return result;
}

function groupBy<T>(
  entries: readonly T[],
  keyOf: (entry: T) => string
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const values = result.get(key) ?? [];
    values.push(entry);
    result.set(key, values);
  }
  return result;
}

function isNormalizedSettingsSourcePath(value: string): boolean {
  if (
    !value.startsWith(SETTINGS_SOURCE_PREFIX) ||
    value.includes("\\") ||
    value.includes("//") ||
    value.includes("%") ||
    value.includes("\u2215") ||
    value.includes("\u2044")
  ) {
    return false;
  }
  const relative = value.slice(SETTINGS_SOURCE_PREFIX.length);
  const segments = relative.split("/");
  return (
    relative.length > 0 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        /^[A-Za-z0-9._-]+$/u.test(segment)
    )
  );
}

function isSortedUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length && isSortedBy(values, compareText);
}

function isSortedBy<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number
): boolean {
  return values.every(
    (value, index) =>
      index === 0 || compare(values[index - 1]!, value) < 0
  );
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function samePayloadHashes(
  left: NormalizedSettingsParserCensusManifest["public_catalog"]["payload_hashes"],
  right: NormalizedSettingsParserCensusManifest["source_inventory"]["public_catalog_hashes"]
): boolean {
  return (
    left.ai === right.ai &&
    left.models === right.models &&
    left.llm_models === right.llm_models
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

function loadPublicCatalogForValidation(): SyntxPublicCatalogSnapshot {
  try {
    return loadSyntxPublicCatalogSnapshot();
  } catch {
    throw new NormalizedSettingsParserCensusManifestError(
      "SOURCE_VALIDATION_FAILED"
    );
  }
}

function loadInventoryForValidation(
  publicCatalog: SyntxPublicCatalogSnapshot
): SettingsSourceInventory {
  try {
    return loadSettingsSourceInventory(undefined, publicCatalog);
  } catch {
    throw new NormalizedSettingsParserCensusManifestError(
      "SOURCE_VALIDATION_FAILED"
    );
  }
}

function findDefaultCensusManifestPath(): string {
  const moduleDirectory = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    fileURLToPath(
      new URL(
        "../../../catalog/runtime/v2/normalized-settings-parser-census-manifest.json",
        import.meta.url
      )
    ),
    fileURLToPath(
      new URL(
        "../../catalog/runtime/v2/normalized-settings-parser-census-manifest.json",
        import.meta.url
      )
    )
  ];
  const existing = candidates.find((candidate) => existsSync(candidate));
  if (existing !== undefined) return existing;
  return `${moduleDirectory}/normalized-settings-parser-census-manifest.json`;
}
