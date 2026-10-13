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

const CANARY_MODEL_IDS = [
  "banana",
  "banana2",
  "banana3",
  "banana3_light"
] as const;
const CANARY_FORM_ID = "banana";
const CANARY_AI_NAME = "banana";
const CANARY_MODULE_NAME = "banana.js";
const SETTINGS_SOURCE_PREFIX = "/src/components/chat/forms/settings/";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/u;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const BUILD_ID_PATTERN = /^\d{6,20}$/u;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const RESERVED_COST_PARAMETERS = new Set(["ai_name", "model_type"]);
const FORBIDDEN_STATIC_KEYS = new Set([
  "__proto__",
  "access_token",
  "authorization",
  "code",
  "constructor",
  "cookie",
  "map",
  "password",
  "private_key",
  "prototype",
  "raw",
  "raw_source",
  "refresh_token",
  "secret",
  "snippet",
  "source",
  "source_map",
  "sourcesContent",
  "token"
]);
const SECRET_LIKE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~-]{16,}/iu,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu,
  /\b(?:ghp|github_pat|sk|xox[baprs])[-_][A-Za-z0-9_-]{16,}/u,
  /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/u
] as const;

const FORM_PROJECTION_NAMES = [
  "computed_rules",
  "conditional_rules",
  "controls",
  "defaults",
  "payload_projection",
  "watch_rules"
] as const;

const LOCAL_BLOCKER_CODES = [
  "CALL_EXPRESSION_NOT_INTERPRETED",
  "COMPUTED_RULE_NOT_INTERPRETED",
  "DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED",
  "SOURCE_PATTERN_NOT_RECOGNIZED",
  "TEMPLATE_CONTROL_FLOW_NOT_COMPILED",
  "WATCH_RULE_NOT_INTERPRETED"
] as const;
const EXTERNAL_BLOCKER_CODES = [
  "BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED",
  "PAYLOAD_PROJECTION_UNVERIFIED"
] as const;
const LOCAL_BLOCKER_CODE_SET = new Set<string>(LOCAL_BLOCKER_CODES);
const EXTERNAL_BLOCKER_CODE_SET = new Set<string>(EXTERNAL_BLOCKER_CODES);
const BLOCKER_ALLOWED_PROJECTIONS: Readonly<
  Record<
    | (typeof LOCAL_BLOCKER_CODES)[number]
    | (typeof EXTERNAL_BLOCKER_CODES)[number],
    readonly string[]
  >
> = {
  CALL_EXPRESSION_NOT_INTERPRETED: FORM_PROJECTION_NAMES,
  COMPUTED_RULE_NOT_INTERPRETED: ["computed_rules"],
  WATCH_RULE_NOT_INTERPRETED: ["watch_rules"],
  DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED: FORM_PROJECTION_NAMES,
  TEMPLATE_CONTROL_FLOW_NOT_COMPILED: ["conditional_rules", "controls"],
  SOURCE_PATTERN_NOT_RECOGNIZED: FORM_PROJECTION_NAMES,
  PAYLOAD_PROJECTION_UNVERIFIED: ["payload_projection"],
  BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED: [
    "cost_projection",
    "payload_projection"
  ]
};

export type NormalizedSettingsParserCanaryErrorCode =
  | "PARSER_CANARY_DRIFT_DETECTED"
  | "PARSER_CANARY_INVALID"
  | "PARSER_OUTPUT_INVALID"
  | "SOURCE_RELATIONSHIP_INVALID"
  | "SOURCE_VALIDATION_FAILED";

export class NormalizedSettingsParserCanaryError extends Error {
  constructor(readonly code: NormalizedSettingsParserCanaryErrorCode) {
    super(
      "SYNTX normalized settings parser canary could not be processed safely."
    );
    this.name = "NormalizedSettingsParserCanaryError";
  }
}

export type NormalizedStaticValue =
  | null
  | boolean
  | number
  | string
  | NormalizedStaticValue[]
  | { [key: string]: NormalizedStaticValue };

const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(IDENTIFIER_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const positiveIntegerSchema = z.number().int().positive();
const nonnegativeIntegerSchema = z.number().int().nonnegative();
const utcTimestampSchema = z
  .string()
  .regex(UTC_TIMESTAMP_PATTERN)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected a valid UTC timestamp."
  });
const safeStaticStringSchema = z
  .string()
  .max(2_048)
  .refine(
    (value) =>
      !value.includes("\r") &&
      !value.includes("\n") &&
      SECRET_LIKE_PATTERNS.every((pattern) => !pattern.test(value)),
    { message: "Static value is not safe to persist." }
  );
const safeStaticKeySchema = z
  .string()
  .min(1)
  .max(160)
  .regex(IDENTIFIER_PATTERN)
  .refine((value) => !FORBIDDEN_STATIC_KEYS.has(value), {
    message: "Static key is reserved."
  });

const normalizedStaticValueSchema: z.ZodType<NormalizedStaticValue> = z.lazy(
  () =>
    z.union([
      z.null(),
      z.boolean(),
      z.number().finite(),
      safeStaticStringSchema,
      z.array(normalizedStaticValueSchema).max(2_048),
      z
        .record(safeStaticKeySchema, normalizedStaticValueSchema)
        .superRefine((record, context) => {
          const keys = Object.keys(record);
          if (keys.length > 512 || !isSortedUniqueStrings(keys)) {
            context.addIssue({
              code: "custom",
              message: "Static object keys must be bounded, unique, and ordered."
            });
          }
        })
    ])
);

const sourceRefSchema = z
  .object({
    provider_javascript_sha256: sha256Schema,
    provider_source_map_sha256: sha256Schema,
    source_index: nonnegativeIntegerSchema,
    source_path: z
      .string()
      .min(1)
      .max(2_000)
      .refine(isNormalizedSettingsSourcePath, {
        message: "Expected a normalized settings source path."
      }),
    source_content_sha256: sha256Schema
  })
  .strict();

const staticLocatorSchema = z
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
    line: positiveIntegerSchema,
    column: positiveIntegerSchema,
    node_kind: identifierSchema
  })
  .strict();

const staticFactSchema = z
  .object({
    path: z.array(safeStaticKeySchema).min(1).max(32),
    value: normalizedStaticValueSchema,
    locator: staticLocatorSchema
  })
  .strict();

const staticFactArraySchema = z
  .array(staticFactSchema)
  .min(1)
  .max(2_048)
  .superRefine((facts, context) => {
    const keys = facts.map(staticFactKey);
    if (new Set(keys).size !== keys.length || !isSortedStrings(keys)) {
      context.addIssue({
        code: "custom",
        message: "Static facts must be unique and canonically ordered."
      });
    }
  });

const provenProjectionSchema = z
  .object({
    status: z.literal("PROVEN"),
    proof_scope: z.literal("STATIC_LITERAL_TREE_ONLY"),
    facts: staticFactArraySchema
  })
  .strict();
const absentProvenProjectionSchema = z
  .object({
    status: z.literal("ABSENT_PROVEN"),
    proof_scope: z.literal(
      "NO_RELEVANT_STATIC_CONSTRUCT_WITHIN_COMPILER_PROFILE"
    )
  })
  .strict();
const blockedProjectionSchema = z
  .object({ status: z.literal("BLOCKED") })
  .strict();
const blockedProjectionWithCandidatesSchema = z
  .object({
    status: z.literal("BLOCKED"),
    proof_scope: z.literal(
      "STATIC_CANDIDATES_ONLY_NOT_RUNTIME_SEMANTICS"
    ),
    static_candidates: staticFactArraySchema
  })
  .strict();
const formProjectionSchema = z.union([
  provenProjectionSchema,
  absentProvenProjectionSchema,
  blockedProjectionWithCandidatesSchema,
  blockedProjectionSchema
]);

const formProjectionNameSchema = z.enum(FORM_PROJECTION_NAMES);
const localBlockerSchema = z
  .object({
    code: z.enum(LOCAL_BLOCKER_CODES),
    projection: formProjectionNameSchema,
    locator: staticLocatorSchema
  })
  .strict();
const externalBlockerSchema = z
  .object({
    code: z.enum(EXTERNAL_BLOCKER_CODES),
    projection: z.enum([...FORM_PROJECTION_NAMES, "cost_projection"]),
    locator: z.null()
  })
  .strict();
const blockerSchema = z.union([localBlockerSchema, externalBlockerSchema]);
const blockerArraySchema = z
  .array(blockerSchema)
  .min(1)
  .max(512)
  .superRefine((blockers, context) => {
    const keys = blockers.map(blockerKey);
    if (new Set(keys).size !== keys.length || !isSortedStrings(keys)) {
      context.addIssue({
        code: "custom",
        message: "Blockers must be unique and canonically ordered."
      });
    }
  });

const engineMetadataSchema = z
  .object({
    name: identifierSchema,
    version: z.string().regex(SEMVER_PATTERN),
    implementation_sha256: sha256Schema,
    execution_mode: z.literal("SYNTAX_ONLY_NO_VENDOR_EXECUTION"),
    type_checking: z.literal(false),
    emit: z.literal(false),
    import_resolution: z.literal(false)
  })
  .strict();

const formProjectionsSchema = z
  .object({
    defaults: formProjectionSchema,
    controls: formProjectionSchema,
    conditional_rules: formProjectionSchema,
    watch_rules: formProjectionSchema,
    computed_rules: formProjectionSchema,
    payload_projection: formProjectionSchema
  })
  .strict();

const normalizedFormCompilerOutputSchema = z
  .object({
    form_id: z.literal(CANARY_FORM_ID),
    source_ref: sourceRefSchema,
    projections: formProjectionsSchema,
    blockers: blockerArraySchema
  })
  .strict()
  .superRefine((form, context) => {
    validateFormCompilation(form, context);
  });

const normalizedCompilerOutputSchema = z
  .object({
    parser_profile: z.literal("STATIC_SETTINGS_V1"),
    engine: engineMetadataSchema,
    forms: z.tuple([normalizedFormCompilerOutputSchema])
  })
  .strict();

export type StaticSettingsSourceRef = z.infer<typeof sourceRefSchema>;
export type StaticSettingsLocator = z.infer<typeof staticLocatorSchema>;
export type NormalizedSettingsProjection = z.infer<
  typeof formProjectionSchema
>;
export type NormalizedSettingsBlocker = z.infer<typeof blockerSchema>;
export type NormalizedSettingsCompilerEngine = z.infer<
  typeof engineMetadataSchema
>;
export type NormalizedSettingsFormCompilerOutput = z.infer<
  typeof normalizedFormCompilerOutputSchema
>;

export interface NormalizedSettingsParserCompilerOutput {
  parser_profile: "STATIC_SETTINGS_V1";
  engine: NormalizedSettingsCompilerEngine;
  forms: readonly [NormalizedSettingsFormCompilerOutput];
}

const publicAiReferenceSchema = z
  .object({
    aggregate_ai_sha256: sha256Schema,
    key: z.literal("value"),
    ai_name: z.literal(CANARY_AI_NAME),
    canonical_sha256: sha256Schema
  })
  .strict();
const inventoryFormReferenceSchema = z
  .object({
    ai_name: z.literal(CANARY_AI_NAME),
    form_id: z.literal(CANARY_FORM_ID),
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
const costProjectionSchema = z
  .object({
    status: z.literal("PROVEN"),
    proof_scope: z.literal("PARAMETER_OWNERSHIP_CLASSIFICATION_ONLY"),
    server_derived: z.tuple([z.literal("ai_name"), z.literal("model_type")]),
    caller_supplied_candidates: z
      .array(identifierSchema)
      .max(200)
      .superRefine((values, context) => {
        if (!isSortedUniqueStrings(values)) {
          context.addIssue({
            code: "custom",
            message: "Cost candidates must be unique and ordered."
          });
        }
      })
  })
  .strict();
const modelCostBlockersSchema = z.tuple([
  z
    .object({
      code: z.literal("BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED"),
      projection: z.literal("cost_projection"),
      locator: z.null()
    })
    .strict()
]);

const compiledFormSchema = z
  .object({
    form_id: z.literal(CANARY_FORM_ID),
    public_ai_ref: publicAiReferenceSchema,
    inventory_form_ref: inventoryFormReferenceSchema,
    source_ref: sourceRefSchema,
    completeness: z.literal("PARTIAL"),
    projections: formProjectionsSchema,
    blockers: blockerArraySchema,
    runtime_usable: z.literal(false)
  })
  .strict()
  .superRefine((form, context) => {
    validateFormCompilation(form, context);
    if (
      form.public_ai_ref.ai_name !== form.inventory_form_ref.ai_name ||
      form.form_id !== form.inventory_form_ref.form_id
    ) {
      addIssue(context, ["inventory_form_ref"], "Form references differ.");
    }
  });

const normalizedModelSchema = z
  .object({
    model_id: identifierSchema,
    ai_name: z.literal(CANARY_AI_NAME),
    active: z.literal(true),
    evidence_class: z.literal("LITERAL_REFERENCE_EVIDENCE"),
    form_ref: z
      .object({ form_id: z.literal(CANARY_FORM_ID) })
      .strict(),
    public_model_ref: publicModelReferenceSchema,
    completeness: z.literal("PARTIAL"),
    cost_projection: costProjectionSchema,
    blockers: modelCostBlockersSchema,
    runtime_usable: z.literal(false)
  })
  .strict();

const summarySchema = z
  .object({
    scoped_models: z.literal(4),
    compiled_forms: z.literal(1),
    partial_forms: z.literal(1),
    partial_models: z.literal(4),
    proven_projections: nonnegativeIntegerSchema,
    absent_proven_projections: nonnegativeIntegerSchema,
    blocked_projections: positiveIntegerSchema,
    blocked_projections_with_static_candidates: nonnegativeIntegerSchema,
    form_blockers: positiveIntegerSchema,
    model_blockers: z.literal(4),
    runtime_usable_models: z.literal(0)
  })
  .strict();

const parserCanaryBaseSchema = z
  .object({
    schema_version: z.literal("1.1.0"),
    catalog_kind: z.literal(
      "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CANARY"
    ),
    evidence_level: z.literal("STATIC_CLIENT_OBSERVATION"),
    runtime_usable: z.literal(false),
    generated_at: utcTimestampSchema,
    scope: z
      .object({
        kind: z.literal("EXACT_MODEL_SET"),
        model_ids: z.tuple([
          z.literal("banana"),
          z.literal("banana2"),
          z.literal("banana3"),
          z.literal("banana3_light")
        ])
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
    compiler: z
      .object({
        parser_profile: z.literal("STATIC_SETTINGS_V1"),
        compilation_status: z.literal("PARTIAL_COMPILED"),
        engine: engineMetadataSchema,
        vendor_code_executed: z.literal(false),
        vendor_source_persisted: z.literal(false)
      })
      .strict(),
    forms: z.tuple([compiledFormSchema]),
    models: z.tuple([
      normalizedModelSchema,
      normalizedModelSchema,
      normalizedModelSchema,
      normalizedModelSchema
    ]),
    summary: summarySchema,
    limitations: z.tuple([
      z.literal("FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT"),
      z.literal("NO_GENERATION_OR_AUTH_CALLS_PERFORMED"),
      z.literal("PARTIAL_COMPILATION_HAS_EXPLICIT_BLOCKERS"),
      z.literal("PAYLOAD_AND_BACKEND_EQUIVALENCE_UNVERIFIED")
    ])
  })
  .strict();

export const normalizedSettingsParserCanarySchema =
  parserCanaryBaseSchema.superRefine((canary, context) => {
    validateCanaryRelationships(canary, context);
  });

export type NormalizedSettingsParserCanary = z.infer<
  typeof parserCanaryBaseSchema
>;
export type NormalizedSettingsParserCanaryForm =
  NormalizedSettingsParserCanary["forms"][number];

export interface BuildNormalizedSettingsParserCanaryInput {
  publicCatalog: SyntxPublicCatalogSnapshot;
  inventory: SettingsSourceInventory;
  compilerOutput: NormalizedSettingsParserCompilerOutput;
}

export interface LoadNormalizedSettingsParserCanaryOptions {
  path?: string;
  publicCatalog?: SyntxPublicCatalogSnapshot;
  inventory?: SettingsSourceInventory;
}

interface CanaryModelRelationship {
  publicModel: SyntxPublicModelEntry;
  inventoryModel: SettingsSourceInventory["models"][number];
}

export function buildNormalizedSettingsParserCanary(
  input: BuildNormalizedSettingsParserCanaryInput
): NormalizedSettingsParserCanary {
  const { publicCatalog, inventory } = validateSources(
    input.publicCatalog,
    input.inventory
  );
  const compilerOutput = parseCompilerOutput(input.compilerOutput);
  const relationships = deriveCanaryRelationships(publicCatalog, inventory);
  assertSourceRefsEqual(
    compilerOutput.forms[0].source_ref,
    relationships.sourceRef
  );

  const form = {
    form_id: CANARY_FORM_ID,
    public_ai_ref: relationships.publicAiRef,
    inventory_form_ref: relationships.inventoryFormRef,
    source_ref: relationships.sourceRef,
    completeness: "PARTIAL",
    projections: compilerOutput.forms[0].projections,
    blockers: compilerOutput.forms[0].blockers,
    runtime_usable: false
  } as const;
  const models: NormalizedSettingsParserCanary["models"] = [
    buildModelRecord(relationships.models[0].publicModel, inventory),
    buildModelRecord(relationships.models[1].publicModel, inventory),
    buildModelRecord(relationships.models[2].publicModel, inventory),
    buildModelRecord(relationships.models[3].publicModel, inventory)
  ];

  const candidate = {
    schema_version: "1.1.0",
    catalog_kind: "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CANARY",
    evidence_level: "STATIC_CLIENT_OBSERVATION",
    runtime_usable: false,
    generated_at: inventory.generated_at,
    scope: {
      kind: "EXACT_MODEL_SET",
      model_ids: CANARY_MODEL_IDS
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
    compiler: {
      parser_profile: "STATIC_SETTINGS_V1",
      compilation_status: "PARTIAL_COMPILED",
      engine: compilerOutput.engine,
      vendor_code_executed: false,
      vendor_source_persisted: false
    },
    forms: [form],
    models,
    summary: summarizeCanary(form, models),
    limitations: [
      "FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT",
      "NO_GENERATION_OR_AUTH_CALLS_PERFORMED",
      "PARTIAL_COMPILATION_HAS_EXPLICIT_BLOCKERS",
      "PAYLOAD_AND_BACKEND_EQUIVALENCE_UNVERIFIED"
    ]
  } as const;

  return parseCanary(candidate);
}

export function loadNormalizedSettingsParserCanary(
  options: LoadNormalizedSettingsParserCanaryOptions = {}
): NormalizedSettingsParserCanary {
  let raw: unknown;
  try {
    raw = JSON.parse(
      readFileSync(options.path ?? findDefaultParserCanaryPath(), "utf8")
    );
  } catch {
    throw new NormalizedSettingsParserCanaryError("PARSER_CANARY_INVALID");
  }
  const canary = parseCanary(raw);
  const publicCatalog =
    options.publicCatalog ?? loadPublicCatalogForValidation();
  const inventory =
    options.inventory ?? loadInventoryForValidation(publicCatalog);
  assertNormalizedSettingsParserCanaryMatchesSources(
    canary,
    publicCatalog,
    inventory
  );
  return canary;
}

export function serializeNormalizedSettingsParserCanary(
  canary: NormalizedSettingsParserCanary,
  publicCatalog: SyntxPublicCatalogSnapshot,
  inventory: SettingsSourceInventory
): string {
  assertNormalizedSettingsParserCanaryMatchesSources(
    canary,
    publicCatalog,
    inventory
  );
  return serializeCanaryShape(canary);
}

export function assertNormalizedSettingsParserCanaryUnchanged(
  recorded: NormalizedSettingsParserCanary,
  observed: NormalizedSettingsParserCanary
): void {
  if (serializeCanaryShape(recorded) !== serializeCanaryShape(observed)) {
    throw new NormalizedSettingsParserCanaryError(
      "PARSER_CANARY_DRIFT_DETECTED"
    );
  }
}

export function assertNormalizedSettingsParserCanaryMatchesSources(
  canaryInput: NormalizedSettingsParserCanary,
  publicCatalogInput: SyntxPublicCatalogSnapshot,
  inventoryInput: SettingsSourceInventory
): void {
  const canary = parseCanary(canaryInput);
  const { publicCatalog, inventory } = validateSources(
    publicCatalogInput,
    inventoryInput
  );
  const relationships = deriveCanaryRelationships(publicCatalog, inventory);
  const form = canary.forms[0];

  if (
    canary.generated_at !== inventory.generated_at ||
    canary.source_inventory.canonical_sha256 !==
      sha256CanonicalPayload(inventory) ||
    canary.source_inventory.build_id !== inventory.build.id ||
    canary.source_inventory.public_catalog_hashes.ai !==
      inventory.public_catalog.ai_sha256 ||
    canary.source_inventory.public_catalog_hashes.models !==
      inventory.public_catalog.models_sha256 ||
    canary.source_inventory.public_catalog_hashes.llm_models !==
      inventory.public_catalog.llm_models_sha256 ||
    serializeComparable(form.public_ai_ref) !==
      serializeComparable(relationships.publicAiRef) ||
    serializeComparable(form.inventory_form_ref) !==
      serializeComparable(relationships.inventoryFormRef) ||
    serializeComparable(form.source_ref) !==
      serializeComparable(relationships.sourceRef)
  ) {
    throw new NormalizedSettingsParserCanaryError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }

  for (const [index, relationship] of relationships.models.entries()) {
    const model = canary.models[index];
    if (
      model === undefined ||
      model.model_id !== relationship.publicModel.value ||
      model.ai_name !== relationship.publicModel.ai_name ||
      model.active !== relationship.publicModel.active ||
      model.public_model_ref.aggregate_models_sha256 !==
        inventory.public_catalog.models_sha256 ||
      model.public_model_ref.model_id !== relationship.publicModel.value ||
      model.public_model_ref.canonical_sha256 !==
        sha256CanonicalPayload(relationship.publicModel) ||
      serializeComparable(model.cost_projection) !==
        serializeComparable(buildCostProjection(relationship.publicModel))
    ) {
      throw new NormalizedSettingsParserCanaryError(
        "SOURCE_RELATIONSHIP_INVALID"
      );
    }
  }
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
    throw new NormalizedSettingsParserCanaryError("SOURCE_VALIDATION_FAILED");
  }
  try {
    assertSettingsSourceInventoryMatchesPublicCatalog(inventory, publicCatalog);
  } catch {
    throw new NormalizedSettingsParserCanaryError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }
  return { publicCatalog, inventory };
}

function deriveCanaryRelationships(
  publicCatalog: SyntxPublicCatalogSnapshot,
  inventory: SettingsSourceInventory
): {
  publicAiRef: z.infer<typeof publicAiReferenceSchema>;
  inventoryFormRef: z.infer<typeof inventoryFormReferenceSchema>;
  sourceRef: StaticSettingsSourceRef;
  models: readonly [
    CanaryModelRelationship,
    CanaryModelRelationship,
    CanaryModelRelationship,
    CanaryModelRelationship
  ];
} {
  const publicAiEntries = publicCatalog.ai.filter(
    (entry) => entry.value === CANARY_AI_NAME
  );
  const inventoryForms = inventory.family_forms.filter(
    (entry) =>
      entry.ai_name === CANARY_AI_NAME && entry.form_id === CANARY_FORM_ID
  );
  const formArtifacts = inventory.source_artifacts.filter(
    (artifact) =>
      artifact.role === "PROVIDER_FORM" &&
      artifact.form_id === CANARY_FORM_ID
  );
  const javascriptArtifacts = formArtifacts.filter(
    (artifact) =>
      artifact.kind === "JAVASCRIPT" &&
      artifact.module_name === CANARY_MODULE_NAME
  );
  const sourceMapArtifacts = formArtifacts.filter(
    (artifact) =>
      artifact.kind === "SOURCE_MAP_V3" &&
      artifact.module_name === CANARY_MODULE_NAME
  );
  const publicAi = publicAiEntries[0];
  const inventoryForm = inventoryForms[0];
  const javascript = javascriptArtifacts[0];
  const sourceMap = sourceMapArtifacts[0];
  const settingsSources = sourceMap?.source_map?.settings_sources ?? [];
  const settingsSource = settingsSources[0];

  if (
    publicAiEntries.length !== 1 ||
    publicAi === undefined ||
    !publicAi.active ||
    inventoryForms.length !== 1 ||
    inventoryForm === undefined ||
    !inventoryForm.ai_active ||
    inventoryForm.model_count !== CANARY_MODEL_IDS.length ||
    formArtifacts.length !== 2 ||
    javascriptArtifacts.length !== 1 ||
    javascript === undefined ||
    javascript.source_map !== null ||
    sourceMapArtifacts.length !== 1 ||
    sourceMap === undefined ||
    sourceMap.source_map === null ||
    sourceMap.source_map.settings_source_count !== 1 ||
    settingsSources.length !== 1 ||
    settingsSource === undefined
  ) {
    throw new NormalizedSettingsParserCanaryError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }

  const sourceRef: StaticSettingsSourceRef = {
    provider_javascript_sha256: javascript.sha256,
    provider_source_map_sha256: sourceMap.sha256,
    source_index: settingsSource.source_index,
    source_path: settingsSource.source_path,
    source_content_sha256: settingsSource.source_content_sha256
  };
  const publicModelsById = indexUniquePublicModels(publicCatalog.models);
  const inventoryModelsById = indexUniqueInventoryModels(inventory.models);
  const deriveModelRelationship = (
    modelId: string
  ): CanaryModelRelationship => {
    const publicModel = publicModelsById.get(modelId);
    const inventoryModel = inventoryModelsById.get(modelId);
    if (
      publicModel === undefined ||
      inventoryModel === undefined ||
      publicModel.ai_name !== CANARY_AI_NAME ||
      !publicModel.active ||
      inventoryModel.ai_name !== CANARY_AI_NAME ||
      !inventoryModel.active ||
      inventoryModel.form_id !== CANARY_FORM_ID ||
      inventoryModel.evidence_class !== "LITERAL_REFERENCE_EVIDENCE" ||
      inventoryModel.evidence.length === 0 ||
      !inventoryModel.evidence.every((evidence) =>
        inventoryEvidenceMatchesSourceRef(evidence, sourceRef)
      )
    ) {
      throw new NormalizedSettingsParserCanaryError(
        "SOURCE_RELATIONSHIP_INVALID"
      );
    }
    return { publicModel, inventoryModel };
  };
  const models = [
    deriveModelRelationship(CANARY_MODEL_IDS[0]),
    deriveModelRelationship(CANARY_MODEL_IDS[1]),
    deriveModelRelationship(CANARY_MODEL_IDS[2]),
    deriveModelRelationship(CANARY_MODEL_IDS[3])
  ] as const;

  return {
    publicAiRef: {
      aggregate_ai_sha256: inventory.public_catalog.ai_sha256,
      key: "value",
      ai_name: CANARY_AI_NAME,
      canonical_sha256: sha256CanonicalPayload(publicAi)
    },
    inventoryFormRef: {
      ai_name: CANARY_AI_NAME,
      form_id: CANARY_FORM_ID,
      canonical_sha256: sha256CanonicalPayload(inventoryForm)
    },
    sourceRef,
    models
  };
}

function buildModelRecord(
  publicModel: SyntxPublicModelEntry,
  inventory: SettingsSourceInventory
): NormalizedSettingsParserCanary["models"][number] {
  return {
    model_id: publicModel.value,
    ai_name: CANARY_AI_NAME,
    active: true,
    evidence_class: "LITERAL_REFERENCE_EVIDENCE",
    form_ref: { form_id: CANARY_FORM_ID },
    public_model_ref: {
      aggregate_models_sha256: inventory.public_catalog.models_sha256,
      key: "value",
      model_id: publicModel.value,
      canonical_sha256: sha256CanonicalPayload(publicModel)
    },
    completeness: "PARTIAL",
    cost_projection: buildCostProjection(publicModel),
    blockers: [
      {
        code: "BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED",
        projection: "cost_projection",
        locator: null
      }
    ],
    runtime_usable: false
  };
}

function buildCostProjection(
  publicModel: SyntxPublicModelEntry
): z.infer<typeof costProjectionSchema> {
  const candidates = new Set<string>();
  for (const parameter of publicModel.settings?.get_cost_params ?? []) {
    if (!RESERVED_COST_PARAMETERS.has(parameter)) candidates.add(parameter);
  }
  return {
    status: "PROVEN",
    proof_scope: "PARAMETER_OWNERSHIP_CLASSIFICATION_ONLY",
    server_derived: ["ai_name", "model_type"],
    caller_supplied_candidates: [...candidates].sort(compareText)
  };
}

function summarizeCanary(
  form: Pick<NormalizedSettingsParserCanaryForm, "projections" | "blockers">,
  models: readonly NormalizedSettingsParserCanary["models"][number][]
): NormalizedSettingsParserCanary["summary"] {
  const projections = Object.values(form.projections);
  const modelBlockers = models.reduce<number>(
    (total, model) => total + model.blockers.length,
    0
  );
  return {
    scoped_models: 4,
    compiled_forms: 1,
    partial_forms: 1,
    partial_models: 4,
    proven_projections: projections.filter(
      (projection) => projection.status === "PROVEN"
    ).length,
    absent_proven_projections: projections.filter(
      (projection) => projection.status === "ABSENT_PROVEN"
    ).length,
    blocked_projections: projections.filter(
      (projection) => projection.status === "BLOCKED"
    ).length,
    blocked_projections_with_static_candidates: projections.filter(
      (projection) =>
        projection.status === "BLOCKED" &&
        "static_candidates" in projection
    ).length,
    form_blockers: form.blockers.length,
    model_blockers: modelBlockers as 4,
    runtime_usable_models: 0
  };
}

function validateFormCompilation(
  form: {
    source_ref: StaticSettingsSourceRef;
    projections: Record<
      (typeof FORM_PROJECTION_NAMES)[number],
      NormalizedSettingsProjection
    >;
    blockers: readonly NormalizedSettingsBlocker[];
  },
  context: z.RefinementCtx
): void {
  let blockedCount = 0;
  for (const projectionName of FORM_PROJECTION_NAMES) {
    const projection = form.projections[projectionName];
    if (projection.status === "BLOCKED") {
      blockedCount += 1;
      if (
        !form.blockers.some(
          (blocker) => blocker.projection === projectionName
        )
      ) {
        addIssue(
          context,
          ["projections", projectionName],
          "Blocked projection has no matching blocker."
        );
      }
    } else if (
      form.blockers.some((blocker) => blocker.projection === projectionName)
    ) {
      addIssue(
        context,
        ["blockers"],
        "Non-blocked projection has a contradictory blocker."
      );
    }

    const facts =
      projection.status === "PROVEN"
        ? projection.facts
        : projection.status === "BLOCKED" &&
            "static_candidates" in projection
          ? projection.static_candidates
          : [];
    for (const fact of facts) {
      if (!locatorMatchesSourceRef(fact.locator, form.source_ref)) {
        addIssue(
          context,
          ["projections", projectionName],
          "Projection locator is outside the compiled source."
        );
      }
    }
  }
  if (blockedCount === 0) {
    addIssue(context, ["projections"], "Partial form must remain blocked.");
  }

  for (const [index, blocker] of form.blockers.entries()) {
    if (
      !BLOCKER_ALLOWED_PROJECTIONS[blocker.code].includes(blocker.projection)
    ) {
      addIssue(
        context,
        ["blockers", index, "projection"],
        "Blocker cannot target this projection."
      );
    }
    if (blocker.projection === "cost_projection") {
      addIssue(
        context,
        ["blockers", index],
        "Form blocker cannot target a model cost projection."
      );
      continue;
    }
    if (
      LOCAL_BLOCKER_CODE_SET.has(blocker.code) &&
      (blocker.locator === null ||
        !locatorMatchesSourceRef(blocker.locator, form.source_ref))
    ) {
      addIssue(
        context,
        ["blockers", index, "locator"],
        "Local blocker must have a locator in the compiled source."
      );
    }
    if (
      EXTERNAL_BLOCKER_CODE_SET.has(blocker.code) &&
      blocker.locator !== null
    ) {
      addIssue(
        context,
        ["blockers", index, "locator"],
        "External blocker must not claim a source locator."
      );
    }
  }
}

function validateCanaryRelationships(
  canary: NormalizedSettingsParserCanary,
  context: z.RefinementCtx
): void {
  const modelIds = canary.models.map((model) => model.model_id);
  if (!sameStringArray(modelIds, CANARY_MODEL_IDS)) {
    addIssue(context, ["models"], "Canary model scope is not exact.");
  }
  for (const [index, model] of canary.models.entries()) {
    if (
      model.public_model_ref.model_id !== model.model_id ||
      model.public_model_ref.aggregate_models_sha256 !==
        canary.source_inventory.public_catalog_hashes.models ||
      model.form_ref.form_id !== canary.forms[0].form_id
    ) {
      addIssue(
        context,
        ["models", index],
        "Model references are inconsistent."
      );
    }
  }
  if (
    canary.forms[0].public_ai_ref.aggregate_ai_sha256 !==
    canary.source_inventory.public_catalog_hashes.ai
  ) {
    addIssue(context, ["forms", 0], "AI reference is inconsistent.");
  }
  const expectedSummary = summarizeCanary(canary.forms[0], canary.models);
  if (
    serializeComparable(expectedSummary) !== serializeComparable(canary.summary)
  ) {
    addIssue(context, ["summary"], "Summary does not match the canary.");
  }
}

function parseCompilerOutput(
  output: NormalizedSettingsParserCompilerOutput
): z.infer<typeof normalizedCompilerOutputSchema> {
  try {
    return normalizedCompilerOutputSchema.parse(output);
  } catch {
    throw new NormalizedSettingsParserCanaryError("PARSER_OUTPUT_INVALID");
  }
}

function parseCanary(value: unknown): NormalizedSettingsParserCanary {
  try {
    return normalizedSettingsParserCanarySchema.parse(value);
  } catch {
    throw new NormalizedSettingsParserCanaryError("PARSER_CANARY_INVALID");
  }
}

function serializeCanaryShape(canary: NormalizedSettingsParserCanary): string {
  return `${JSON.stringify(parseCanary(canary), null, 2)}\n`;
}

function inventoryEvidenceMatchesSourceRef(
  evidence:
    | SettingsSourceInventory["models"][number]["evidence"][number]
    | undefined,
  sourceRef: StaticSettingsSourceRef
): boolean {
  return (
    evidence !== undefined &&
    evidence.module_sha256 === sourceRef.provider_javascript_sha256 &&
    evidence.source_map_sha256 === sourceRef.provider_source_map_sha256 &&
    evidence.source_index === sourceRef.source_index &&
    evidence.source_path === sourceRef.source_path &&
    evidence.source_content_sha256 === sourceRef.source_content_sha256
  );
}

function assertSourceRefsEqual(
  observed: StaticSettingsSourceRef,
  expected: StaticSettingsSourceRef
): void {
  if (serializeComparable(observed) !== serializeComparable(expected)) {
    throw new NormalizedSettingsParserCanaryError(
      "SOURCE_RELATIONSHIP_INVALID"
    );
  }
}

function locatorMatchesSourceRef(
  locator: StaticSettingsLocator,
  sourceRef: StaticSettingsSourceRef
): boolean {
  return (
    locator.source_index === sourceRef.source_index &&
    locator.source_path === sourceRef.source_path &&
    locator.source_content_sha256 === sourceRef.source_content_sha256
  );
}

function staticFactKey(fact: z.infer<typeof staticFactSchema>): string {
  return [
    JSON.stringify(fact.path),
    fact.locator.line.toString().padStart(10, "0"),
    fact.locator.column.toString().padStart(10, "0")
  ].join("\u0000");
}

function blockerKey(blocker: NormalizedSettingsBlocker): string {
  const locator = blocker.locator;
  return [
    blocker.projection,
    blocker.code,
    locator?.source_path ?? "",
    locator?.source_index.toString().padStart(10, "0") ?? "",
    locator?.line.toString().padStart(10, "0") ?? "",
    locator?.column.toString().padStart(10, "0") ?? "",
    locator?.node_kind ?? ""
  ].join("\u0000");
}

function indexUniquePublicModels(
  models: readonly SyntxPublicModelEntry[]
): ReadonlyMap<string, SyntxPublicModelEntry> {
  const result = new Map<string, SyntxPublicModelEntry>();
  for (const model of models) {
    if (result.has(model.value)) {
      throw new NormalizedSettingsParserCanaryError(
        "SOURCE_RELATIONSHIP_INVALID"
      );
    }
    result.set(model.value, model);
  }
  return result;
}

function indexUniqueInventoryModels(
  models: SettingsSourceInventory["models"]
): ReadonlyMap<string, SettingsSourceInventory["models"][number]> {
  const result = new Map<
    string,
    SettingsSourceInventory["models"][number]
  >();
  for (const model of models) {
    if (result.has(model.model_id)) {
      throw new NormalizedSettingsParserCanaryError(
        "SOURCE_RELATIONSHIP_INVALID"
      );
    }
    result.set(model.model_id, model);
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
  return (
    new Set(values).size === values.length && isSortedStrings(values)
  );
}

function isSortedStrings(values: readonly string[]): boolean {
  return values.every(
    (value, index) =>
      index === 0 || compareText(values[index - 1]!, value) < 0
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

function serializeComparable(value: unknown): string {
  return JSON.stringify(value);
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
    throw new NormalizedSettingsParserCanaryError("SOURCE_VALIDATION_FAILED");
  }
}

function loadInventoryForValidation(
  publicCatalog: SyntxPublicCatalogSnapshot
): SettingsSourceInventory {
  try {
    return loadSettingsSourceInventory(undefined, publicCatalog);
  } catch {
    throw new NormalizedSettingsParserCanaryError("SOURCE_VALIDATION_FAILED");
  }
}

function findDefaultParserCanaryPath(): string {
  const moduleDirectory = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    fileURLToPath(
      new URL(
        "../../../catalog/runtime/v1/normalized-settings-parser-canary.json",
        import.meta.url
      )
    ),
    fileURLToPath(
      new URL(
        "../../catalog/runtime/v1/normalized-settings-parser-canary.json",
        import.meta.url
      )
    )
  ];
  const existing = candidates.find((candidate) => existsSync(candidate));
  if (existing !== undefined) return existing;
  return `${moduleDirectory}/normalized-settings-parser-canary.json`;
}
