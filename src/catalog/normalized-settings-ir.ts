import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import {
  assertSettingsSourceInventoryMatchesPublicCatalog,
  loadSettingsSourceInventory,
  settingsSourceInventorySchema,
  type SettingsSourceInventory
} from "./settings-source-inventory.js";
import {
  loadSyntxPublicCatalogSnapshot,
  sha256CanonicalPayload,
  syntxPublicCatalogSnapshotSchema,
  type SyntxPublicCatalogSnapshot,
  type SyntxPublicModelEntry
} from "./syntx-public-catalog.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/u;
const FORM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BUILD_ID_PATTERN = /^\d{6,20}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PINNED_CANARY_REGISTRY_JAVASCRIPT_SHA256 =
  "sha256:0b449167dfc460e698db2370b7b91ba0eaa5c078662587ee369f7d524a9fa301";
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SETTINGS_SOURCE_PREFIX = "/src/components/chat/forms/settings/";

const SETTINGS_PROJECTIONS = [
  "computed_rules",
  "conditional_rules",
  "controls",
  "defaults",
  "payload_projection",
  "watch_rules"
] as const;
const BACKEND_EQUIVALENCE_PROJECTIONS = [
  "cost_projection",
  "payload_projection"
] as const;
const EXPECTED_BLOCKERS = [
  ...BACKEND_EQUIVALENCE_PROJECTIONS.map((projection) => ({
    code: "BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED" as const,
    projection
  })),
  ...SETTINGS_PROJECTIONS.map((projection) => ({
    code: "SETTINGS_SOURCE_NOT_COMPILED" as const,
    projection
  }))
] as const;
const RESERVED_COST_PARAMETERS = new Set(["ai_name", "model_type"]);

export type NormalizedSettingsIrErrorCode =
  | "CANARY_DRIFT_DETECTED"
  | "CANARY_INVALID"
  | "SCOPE_INVALID"
  | "SOURCE_RELATIONSHIP_INVALID"
  | "SOURCE_VALIDATION_FAILED";

export class NormalizedSettingsIrError extends Error {
  constructor(readonly code: NormalizedSettingsIrErrorCode) {
    super("SYNTX normalized settings IR canary could not be processed safely.");
    this.name = "NormalizedSettingsIrError";
  }
}

const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(IDENTIFIER_PATTERN);
const formIdSchema = z.string().min(1).max(160).regex(FORM_ID_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const positiveIntegerSchema = z.number().int().positive();
const nonnegativeIntegerSchema = z.number().int().nonnegative();
const utcTimestampSchema = z
  .string()
  .regex(UTC_TIMESTAMP_PATTERN)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected a valid UTC timestamp."
  });

const sortedUniqueIdentifierArraySchema = z
  .array(identifierSchema)
  .min(1)
  .max(10_000)
  .superRefine((values, context) => {
    addSortedUniqueIssues(values, context);
  });

const uniqueIdentifierArraySchema = z
  .array(identifierSchema)
  .max(200)
  .superRefine((values, context) => {
    addUniqueIssues(values, context);
  });

const fieldLocatorSchema = z
  .object({
    source_index: nonnegativeIntegerSchema,
    source_path: z
      .string()
      .min(1)
      .max(2_000)
      .refine(isNormalizedSettingsSourcePath, {
        message: "Expected a normalized settings source path."
      }),
    source_content_sha256: sha256Schema,
    token_kind: z.literal("EXACT_QUOTED_LITERAL_REFERENCE"),
    line: positiveIntegerSchema,
    column: positiveIntegerSchema
  })
  .strict();

const blockedProjectionSchema = z
  .object({ status: z.literal("BLOCKED") })
  .strict();

const costProjectionSchema = z
  .object({
    status: z.literal("PROVEN"),
    proof_scope: z.literal("PARAMETER_OWNERSHIP_CLASSIFICATION_ONLY"),
    server_derived: z.tuple([
      z.literal("ai_name"),
      z.literal("model_type")
    ]),
    caller_supplied_candidates: uniqueIdentifierArraySchema
  })
  .strict();

const blockerProjectionSchema = z.enum([
  "computed_rules",
  "conditional_rules",
  "controls",
  "cost_projection",
  "defaults",
  "payload_projection",
  "watch_rules"
]);

const blockerSchema = z
  .object({
    code: z.enum([
      "BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED",
      "SETTINGS_SOURCE_NOT_COMPILED"
    ]),
    projection: blockerProjectionSchema
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

const normalizedModelRecordSchema = z
  .object({
    model_id: identifierSchema,
    ai_name: identifierSchema,
    active: z.boolean(),
    form_id: formIdSchema,
    evidence_class: z.enum([
      "LITERAL_REFERENCE_EVIDENCE",
      "DYNAMIC_FAMILY_FORM"
    ]),
    public_model_ref: publicModelReferenceSchema,
    completeness: z.literal("PARTIAL"),
    defaults: blockedProjectionSchema,
    controls: blockedProjectionSchema,
    conditional_rules: blockedProjectionSchema,
    watch_rules: blockedProjectionSchema,
    computed_rules: blockedProjectionSchema,
    payload_projection: blockedProjectionSchema,
    cost_projection: costProjectionSchema,
    blockers: z.array(blockerSchema).length(EXPECTED_BLOCKERS.length),
    field_locators: z.array(fieldLocatorSchema).max(500),
    runtime_usable: z.literal(false)
  })
  .strict();

const summarySchema = z
  .object({
    scoped_models: positiveIntegerSchema,
    partial_models: positiveIntegerSchema,
    literal_reference_evidence_models: nonnegativeIntegerSchema,
    dynamic_family_form_models: nonnegativeIntegerSchema,
    field_locators: nonnegativeIntegerSchema,
    proven_cost_classifications: positiveIntegerSchema,
    runtime_usable_models: z.literal(0)
  })
  .strict();

const normalizedSettingsIrCanaryBaseSchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    catalog_kind: z.literal("OBSERVED_NORMALIZED_SETTINGS_IR_CANARY"),
    evidence_level: z.literal("STATIC_CLIENT_OBSERVATION"),
    runtime_usable: z.literal(false),
    generated_at: utcTimestampSchema,
    scope: z
      .object({
        kind: z.literal("EXACT_MODEL_SET"),
        model_ids: sortedUniqueIdentifierArraySchema
      })
      .strict(),
    source_inventory: z
      .object({
        canonical_sha256: sha256Schema,
        build_id: z.string().regex(BUILD_ID_PATTERN),
        public_catalog_hashes: z
          .object({
            ai: sha256Schema,
            models: sha256Schema,
            llm_models: sha256Schema
          })
          .strict()
      })
      .strict(),
    source_scope: z
      .object({
        boundary: z.literal("DIRECT_SETTINGS_SOURCE_HELPERS_ONLY"),
        parser_profile: z.literal("STATIC_SETTINGS_V1"),
        compilation_status: z.literal("NOT_COMPILED"),
        registry_javascript_sha256: z.literal(
          PINNED_CANARY_REGISTRY_JAVASCRIPT_SHA256
        ),
        vendor_code_executed: z.literal(false),
        vendor_source_persisted: z.literal(false)
      })
      .strict(),
    models: z.array(normalizedModelRecordSchema).min(1).max(10_000),
    summary: summarySchema,
    limitations: z.tuple([
      z.literal("FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT"),
      z.literal("NO_GENERATION_OR_AUTH_CALLS_PERFORMED"),
      z.literal("SETTINGS_SOURCE_NOT_COMPILED")
    ])
  })
  .strict();

export const normalizedSettingsIrCanarySchema =
  normalizedSettingsIrCanaryBaseSchema.superRefine((canary, context) => {
    validateCanaryRelationships(canary, context);
  });

export type NormalizedSettingsIrCanary = z.infer<
  typeof normalizedSettingsIrCanaryBaseSchema
>;
export type NormalizedSettingsIrModelRecord =
  NormalizedSettingsIrCanary["models"][number];

export interface BuildNormalizedSettingsIrCanaryInput {
  publicCatalog: SyntxPublicCatalogSnapshot;
  inventory: SettingsSourceInventory;
  modelIds: readonly string[];
}

export interface LoadNormalizedSettingsIrCanaryOptions {
  path?: string;
  publicCatalog?: SyntxPublicCatalogSnapshot;
  inventory?: SettingsSourceInventory;
}

export function buildNormalizedSettingsIrCanary(
  input: BuildNormalizedSettingsIrCanaryInput
): NormalizedSettingsIrCanary {
  const { publicCatalog, inventory } = validateSources(
    input.publicCatalog,
    input.inventory
  );
  const modelIds = validateAndSortScope(input.modelIds);
  const publicModelsById = indexUniquePublicModels(publicCatalog.models);
  const inventoryModelsById = indexUniqueInventoryModels(inventory.models);

  const models = modelIds.map((modelId) => {
    const publicModel = publicModelsById.get(modelId);
    const inventoryModel = inventoryModelsById.get(modelId);
    if (
      publicModel === undefined ||
      inventoryModel === undefined ||
      inventoryModel.ai_name !== publicModel.ai_name ||
      inventoryModel.active !== publicModel.active ||
      !isCurrentInventoryModel(inventoryModel)
    ) {
      throw new NormalizedSettingsIrError("SOURCE_RELATIONSHIP_INVALID");
    }

    return buildModelRecord(publicModel, inventoryModel, inventory);
  });

  const candidate = {
    schema_version: "1.0.0",
    catalog_kind: "OBSERVED_NORMALIZED_SETTINGS_IR_CANARY",
    evidence_level: "STATIC_CLIENT_OBSERVATION",
    runtime_usable: false,
    generated_at: inventory.generated_at,
    scope: {
      kind: "EXACT_MODEL_SET",
      model_ids: modelIds
    },
    source_inventory: {
      canonical_sha256: sha256CanonicalPayload(inventory),
      build_id: inventory.build.id,
      public_catalog_hashes: {
        ai: inventory.public_catalog.ai_sha256,
        models: inventory.public_catalog.models_sha256,
        llm_models: inventory.public_catalog.llm_models_sha256
      }
    },
    source_scope: {
      boundary: "DIRECT_SETTINGS_SOURCE_HELPERS_ONLY",
      parser_profile: "STATIC_SETTINGS_V1",
      compilation_status: "NOT_COMPILED",
      registry_javascript_sha256:
        PINNED_CANARY_REGISTRY_JAVASCRIPT_SHA256,
      vendor_code_executed: false,
      vendor_source_persisted: false
    },
    models,
    summary: summarizeCanary(models),
    limitations: [
      "FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT",
      "NO_GENERATION_OR_AUTH_CALLS_PERFORMED",
      "SETTINGS_SOURCE_NOT_COMPILED"
    ]
  } as const;

  return parseCanary(candidate);
}

export function loadNormalizedSettingsIrCanary(
  options: LoadNormalizedSettingsIrCanaryOptions = {}
): NormalizedSettingsIrCanary {
  let raw: unknown;
  try {
    raw = JSON.parse(
      readFileSync(options.path ?? findDefaultCanaryPath(), "utf8")
    );
  } catch {
    throw new NormalizedSettingsIrError("CANARY_INVALID");
  }

  const canary = parseCanary(raw);
  const publicCatalog =
    options.publicCatalog ?? loadPublicCatalogForCanaryValidation();
  const inventory =
    options.inventory ?? loadInventoryForCanaryValidation(publicCatalog);
  assertNormalizedSettingsIrCanaryMatchesSources(
    canary,
    publicCatalog,
    inventory
  );
  return canary;
}

export function serializeNormalizedSettingsIrCanary(
  canary: NormalizedSettingsIrCanary,
  publicCatalog: SyntxPublicCatalogSnapshot,
  inventory: SettingsSourceInventory
): string {
  assertNormalizedSettingsIrCanaryMatchesSources(
    canary,
    publicCatalog,
    inventory
  );
  return serializeCanaryShape(canary);
}

export function assertNormalizedSettingsIrCanaryUnchanged(
  recorded: NormalizedSettingsIrCanary,
  observed: NormalizedSettingsIrCanary
): void {
  if (
    serializeCanaryShape(recorded) !== serializeCanaryShape(observed)
  ) {
    throw new NormalizedSettingsIrError("CANARY_DRIFT_DETECTED");
  }
}

export function assertNormalizedSettingsIrCanaryMatchesSources(
  canary: NormalizedSettingsIrCanary,
  publicCatalog: SyntxPublicCatalogSnapshot,
  inventory: SettingsSourceInventory
): void {
  const validatedCanary = parseCanary(canary);
  const rebuilt = buildNormalizedSettingsIrCanary({
    publicCatalog,
    inventory,
    modelIds: validatedCanary.scope.model_ids
  });
  if (
    serializeCanaryShape(validatedCanary) !== serializeCanaryShape(rebuilt)
  ) {
    throw new NormalizedSettingsIrError("SOURCE_RELATIONSHIP_INVALID");
  }
}

function buildModelRecord(
  publicModel: SyntxPublicModelEntry,
  inventoryModel: CurrentInventoryModel,
  inventory: SettingsSourceInventory
): NormalizedSettingsIrModelRecord {
  return {
    model_id: publicModel.value,
    ai_name: publicModel.ai_name,
    active: publicModel.active,
    form_id: inventoryModel.form_id,
    evidence_class: inventoryModel.evidence_class,
    public_model_ref: {
      aggregate_models_sha256: inventory.public_catalog.models_sha256,
      key: "value",
      model_id: publicModel.value,
      canonical_sha256: sha256CanonicalPayload(publicModel)
    },
    completeness: "PARTIAL",
    defaults: { status: "BLOCKED" },
    controls: { status: "BLOCKED" },
    conditional_rules: { status: "BLOCKED" },
    watch_rules: { status: "BLOCKED" },
    computed_rules: { status: "BLOCKED" },
    payload_projection: { status: "BLOCKED" },
    cost_projection: {
      status: "PROVEN",
      proof_scope: "PARAMETER_OWNERSHIP_CLASSIFICATION_ONLY",
      server_derived: ["ai_name", "model_type"],
      caller_supplied_candidates: uniqueCostCandidates(publicModel)
    },
    blockers: EXPECTED_BLOCKERS.map((entry) => ({ ...entry })),
    field_locators: sanitizeAndDeduplicateLocators(inventoryModel.evidence),
    runtime_usable: false
  };
}

type CurrentInventoryModel = SettingsSourceInventory["models"][number] & {
  form_id: string;
  evidence_class:
    | "LITERAL_REFERENCE_EVIDENCE"
    | "DYNAMIC_FAMILY_FORM";
};

function isCurrentInventoryModel(
  model: SettingsSourceInventory["models"][number]
): model is CurrentInventoryModel {
  return (
    model.form_id !== null &&
    model.evidence_class !== "LEGACY_INACTIVE_NO_FORM"
  );
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
    throw new NormalizedSettingsIrError("SOURCE_VALIDATION_FAILED");
  }
  try {
    assertSettingsSourceInventoryMatchesPublicCatalog(
      inventory,
      publicCatalog
    );
  } catch {
    throw new NormalizedSettingsIrError("SOURCE_RELATIONSHIP_INVALID");
  }
  const registryArtifacts = inventory.source_artifacts.filter(
    (artifact) =>
      artifact.role === "SETTINGS_REGISTRY" &&
      artifact.kind === "JAVASCRIPT" &&
      artifact.module_name === "Settings2.js" &&
      artifact.form_id === null
  );
  if (
    registryArtifacts.length !== 1 ||
    registryArtifacts[0]?.sha256 !==
      PINNED_CANARY_REGISTRY_JAVASCRIPT_SHA256
  ) {
    throw new NormalizedSettingsIrError("SOURCE_RELATIONSHIP_INVALID");
  }
  return { publicCatalog, inventory };
}

function validateAndSortScope(modelIds: readonly string[]): string[] {
  if (
    !Array.isArray(modelIds) ||
    modelIds.length === 0 ||
    modelIds.length > 10_000 ||
    modelIds.some(
      (modelId) =>
        typeof modelId !== "string" ||
        modelId.length === 0 ||
        modelId.length > 160 ||
        !IDENTIFIER_PATTERN.test(modelId)
    ) ||
    new Set(modelIds).size !== modelIds.length
  ) {
    throw new NormalizedSettingsIrError("SCOPE_INVALID");
  }
  return [...modelIds].sort(compareText);
}

function indexUniquePublicModels(
  models: readonly SyntxPublicModelEntry[]
): ReadonlyMap<string, SyntxPublicModelEntry> {
  const byId = new Map<string, SyntxPublicModelEntry>();
  for (const model of models) {
    if (byId.has(model.value)) {
      throw new NormalizedSettingsIrError("SOURCE_RELATIONSHIP_INVALID");
    }
    byId.set(model.value, model);
  }
  return byId;
}

function indexUniqueInventoryModels(
  models: SettingsSourceInventory["models"]
): ReadonlyMap<string, SettingsSourceInventory["models"][number]> {
  const byId = new Map<
    string,
    SettingsSourceInventory["models"][number]
  >();
  for (const model of models) {
    if (byId.has(model.model_id)) {
      throw new NormalizedSettingsIrError("SOURCE_RELATIONSHIP_INVALID");
    }
    byId.set(model.model_id, model);
  }
  return byId;
}

function sanitizeAndDeduplicateLocators(
  evidence: SettingsSourceInventory["models"][number]["evidence"]
): NormalizedSettingsIrModelRecord["field_locators"] {
  const locators = evidence.map((entry) => ({
    source_index: entry.source_index,
    source_path: entry.source_path,
    source_content_sha256: entry.source_content_sha256,
    token_kind: entry.token_kind,
    line: entry.line,
    column: entry.column
  }));
  const byKey = new Map<string, (typeof locators)[number]>();
  for (const locator of locators) {
    const key = JSON.stringify(locator);
    if (!byKey.has(key)) byKey.set(key, locator);
  }
  return [...byKey.values()].sort(compareLocators);
}

function uniqueCostCandidates(publicModel: SyntxPublicModelEntry): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const parameter of publicModel.settings?.get_cost_params ?? []) {
    if (RESERVED_COST_PARAMETERS.has(parameter) || seen.has(parameter)) {
      continue;
    }
    seen.add(parameter);
    candidates.push(parameter);
  }
  return candidates;
}

function summarizeCanary(
  models: readonly NormalizedSettingsIrModelRecord[]
): NormalizedSettingsIrCanary["summary"] {
  return {
    scoped_models: models.length,
    partial_models: models.length,
    literal_reference_evidence_models: models.filter(
      (model) => model.evidence_class === "LITERAL_REFERENCE_EVIDENCE"
    ).length,
    dynamic_family_form_models: models.filter(
      (model) => model.evidence_class === "DYNAMIC_FAMILY_FORM"
    ).length,
    field_locators: models.reduce(
      (total, model) => total + model.field_locators.length,
      0
    ),
    proven_cost_classifications: models.length,
    runtime_usable_models: 0
  };
}

function validateCanaryRelationships(
  canary: NormalizedSettingsIrCanary,
  context: z.RefinementCtx
): void {
  const modelIds = canary.models.map((model) => model.model_id);
  if (
    !sameStringArray(canary.scope.model_ids, modelIds) ||
    new Set(modelIds).size !== modelIds.length ||
    !isSorted(modelIds)
  ) {
    addIssue(context, ["models"], "Declared scope and model records differ.");
  }

  for (const [index, model] of canary.models.entries()) {
    if (
      model.public_model_ref.model_id !== model.model_id ||
      model.public_model_ref.aggregate_models_sha256 !==
        canary.source_inventory.public_catalog_hashes.models
    ) {
      addIssue(
        context,
        ["models", index, "public_model_ref"],
        "Public model reference is inconsistent."
      );
    }
    if (!sameBlockers(model.blockers, EXPECTED_BLOCKERS)) {
      addIssue(
        context,
        ["models", index, "blockers"],
        "Required blockers are incomplete or unordered."
      );
    }
    const locatorKeys = model.field_locators.map((locator) =>
      JSON.stringify(locator)
    );
    if (
      new Set(locatorKeys).size !== locatorKeys.length ||
      !isLocatorArraySorted(model.field_locators)
    ) {
      addIssue(
        context,
        ["models", index, "field_locators"],
        "Field locators are duplicated or unordered."
      );
    }
  }

  const expectedSummary = summarizeCanary(canary.models);
  if (JSON.stringify(expectedSummary) !== JSON.stringify(canary.summary)) {
    addIssue(context, ["summary"], "Summary does not match model records.");
  }
}

function parseCanary(value: unknown): NormalizedSettingsIrCanary {
  try {
    return normalizedSettingsIrCanarySchema.parse(value);
  } catch {
    throw new NormalizedSettingsIrError("CANARY_INVALID");
  }
}

function serializeCanaryShape(canary: NormalizedSettingsIrCanary): string {
  const validated = parseCanary(canary);
  return `${JSON.stringify(validated, null, 2)}\n`;
}

function addSortedUniqueIssues(
  values: readonly string[],
  context: z.RefinementCtx
): void {
  addUniqueIssues(values, context);
  if (!isSorted(values)) {
    context.addIssue({
      code: "custom",
      message: "Expected identifiers in canonical order."
    });
  }
}

function addUniqueIssues(
  values: readonly string[],
  context: z.RefinementCtx
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      message: "Expected unique identifiers."
    });
  }
}

function isNormalizedSettingsSourcePath(value: string): boolean {
  if (
    !value.startsWith(SETTINGS_SOURCE_PREFIX) ||
    value.includes("\\") ||
    value.includes("//")
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

function compareLocators(
  left: NormalizedSettingsIrModelRecord["field_locators"][number],
  right: NormalizedSettingsIrModelRecord["field_locators"][number]
): number {
  return (
    compareText(left.source_path, right.source_path) ||
    left.source_index - right.source_index ||
    left.line - right.line ||
    left.column - right.column ||
    compareText(left.source_content_sha256, right.source_content_sha256) ||
    compareText(left.token_kind, right.token_kind)
  );
}

function isLocatorArraySorted(
  locators: NormalizedSettingsIrModelRecord["field_locators"]
): boolean {
  return locators.every(
    (locator, index) =>
      index === 0 || compareLocators(locators[index - 1]!, locator) < 0
  );
}

function sameBlockers(
  left: readonly { code: string; projection: string }[],
  right: readonly { code: string; projection: string }[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.code === right[index]?.code &&
        entry.projection === right[index]?.projection
    )
  );
}

function isSorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || compareText(values[index - 1]!, value) < 0
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

function loadPublicCatalogForCanaryValidation(): SyntxPublicCatalogSnapshot {
  try {
    return loadSyntxPublicCatalogSnapshot();
  } catch {
    throw new NormalizedSettingsIrError("SOURCE_VALIDATION_FAILED");
  }
}

function loadInventoryForCanaryValidation(
  publicCatalog: SyntxPublicCatalogSnapshot
): SettingsSourceInventory {
  try {
    return loadSettingsSourceInventory(undefined, publicCatalog);
  } catch {
    throw new NormalizedSettingsIrError("SOURCE_VALIDATION_FAILED");
  }
}

function findDefaultCanaryPath(): string {
  const candidates = [
    fileURLToPath(
      new URL(
        "../../catalog/runtime/v1/normalized-settings-ir-canary.json",
        import.meta.url
      )
    ),
    fileURLToPath(
      new URL(
        "../../../catalog/runtime/v1/normalized-settings-ir-canary.json",
        import.meta.url
      )
    )
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new NormalizedSettingsIrError("CANARY_INVALID");
  }
  return found;
}
