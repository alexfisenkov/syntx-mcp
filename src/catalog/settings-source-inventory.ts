import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import {
  loadSyntxPublicCatalogSnapshot,
  syntxPublicCatalogSnapshotSchema,
  type SyntxPublicCatalogSnapshot
} from "./syntx-public-catalog.js";

const JAVASCRIPT_MEDIA_TYPES = new Set([
  "application/javascript",
  "application/x-javascript",
  "text/javascript"
]);
const SOURCE_MAP_MEDIA_TYPES = new Set([
  "application/json",
  "application/octet-stream"
]);
const SETTINGS_SOURCE_MARKER = "/src/components/chat/forms/settings/";
const SOURCE_MAP_LEGACY_ROOT_PREFIX = "../../../src/";
const SOURCE_MAP_CANONICAL_ROOT_PREFIX = "/src/";
const SOURCE_MAP_RELATIVE_ROOT_PREFIX = "src/";
const SOURCE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const MODULE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u;
const FORM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/u;
const BUILD_ID_PATTERN = /^\d{6,20}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "break",
  "case",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "extends",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield"
]);
const CONTROL_PAREN_KEYWORDS = new Set([
  "catch",
  "for",
  "if",
  "switch",
  "while",
  "with"
]);

export type SettingsSourceInventoryErrorCode =
  | "SOURCE_FETCH_FAILED"
  | "SOURCE_REDIRECTED"
  | "SOURCE_MEDIA_TYPE_INVALID"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_UTF8_INVALID"
  | "SOURCE_MAP_INVALID"
  | "REGISTRY_MAPPING_INVALID"
  | "FAMILY_FORM_MAPPING_INVALID"
  | "SOURCE_CLOSURE_LIMIT_EXCEEDED"
  | "SOURCE_DRIFT_DETECTED";

export class SettingsSourceInventoryError extends Error {
  constructor(readonly code: SettingsSourceInventoryErrorCode) {
    super("SYNTX settings source inventory could not be derived safely.");
    this.name = "SettingsSourceInventoryError";
  }
}

const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(IDENTIFIER_PATTERN);
const formIdSchema = z.string().min(1).max(160).regex(FORM_ID_PATTERN);
const moduleNameSchema = z.string().min(4).max(300).regex(MODULE_NAME_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const utcTimestampSchema = z
  .string()
  .regex(UTC_TIMESTAMP_PATTERN)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected a valid UTC timestamp."
  });
const positiveIntegerSchema = z.number().int().positive();
const nonnegativeIntegerSchema = z.number().int().nonnegative();

const publicCatalogProvenanceSchema = z
  .object({
    fetched_at: utcTimestampSchema,
    ai_sha256: sha256Schema,
    models_sha256: sha256Schema,
    llm_models_sha256: sha256Schema
  })
  .strict();

const sourceMapMetadataSchema = z
  .object({
    version: z.literal(3),
    file: z.string().min(1).max(2_000),
    source_count: positiveIntegerSchema,
    sources_content_count: positiveIntegerSchema,
    settings_source_count: nonnegativeIntegerSchema,
    settings_sources: z
      .array(
        z
          .object({
            source_index: nonnegativeIntegerSchema,
            source_path: z.string().min(1).max(2_000),
            source_content_sha256: sha256Schema
          })
          .strict()
      )
      .max(5_000)
  })
  .strict()
  .superRefine((metadata, context) => {
    if (metadata.settings_source_count !== metadata.settings_sources.length) {
      context.addIssue({
        code: "custom",
        path: ["settings_source_count"],
        message: "Settings source count does not match its locator list."
      });
    }
    const indexes = new Set<number>();
    const paths = new Set<string>();
    for (const [index, source] of metadata.settings_sources.entries()) {
      if (
        indexes.has(source.source_index) ||
        paths.has(source.source_path) ||
        !isCanonicalSettingsSourcePath(source.source_path)
      ) {
        context.addIssue({
          code: "custom",
          path: ["settings_sources", index],
          message: "Settings source locator is invalid or duplicated."
        });
      }
      indexes.add(source.source_index);
      paths.add(source.source_path);
    }
  });

const sourceArtifactSchema = z
  .object({
    role: z.enum([
      "SETTINGS_REGISTRY",
      "PROVIDER_FORM",
      "DIRECT_SETTINGS_HELPER"
    ]),
    kind: z.enum(["JAVASCRIPT", "SOURCE_MAP_V3"]),
    module_name: moduleNameSchema,
    form_id: formIdSchema.nullable(),
    url: z
      .string()
      .url()
      .max(2_000)
      .regex(/^https:\/\/syntx\.ai\/assets\/\d{6,20}\/[A-Za-z0-9][A-Za-z0-9._-]*\.js(?:\.map)?$/u),
    content_type: z.string().min(1).max(200),
    bytes: positiveIntegerSchema,
    sha256: sha256Schema,
    source_map: sourceMapMetadataSchema.nullable()
  })
  .strict();

const registryLocatorSchema = z
  .object({
    module_url: z.string().url().max(2_000),
    module_sha256: sha256Schema,
    // Added additively for registry rotations where the provider bundle name
    // is no longer the form_id (for example seedance2.js for seedance.vue).
    // Optional keeps existing immutable 1.0.0 inventories loadable.
    module_name: moduleNameSchema.optional(),
    form_path_line: positiveIntegerSchema,
    form_path_column: positiveIntegerSchema,
    dynamic_import_line: positiveIntegerSchema,
    dynamic_import_column: positiveIntegerSchema
  })
  .strict();

const familyFormSchema = z
  .object({
    ai_name: identifierSchema,
    form_id: formIdSchema,
    ai_active: z.boolean(),
    model_count: nonnegativeIntegerSchema,
    evidence: registryLocatorSchema
  })
  .strict();

const unboundFormSchema = z
  .object({
    form_id: formIdSchema,
    evidence: registryLocatorSchema
  })
  .strict();

const literalEvidenceSchema = z
  .object({
    module_url: z.string().url().max(2_000),
    module_sha256: sha256Schema,
    source_map_url: z.string().url().max(2_000),
    source_map_sha256: sha256Schema,
    source_index: nonnegativeIntegerSchema,
    source_path: z.string().min(1).max(2_000),
    source_content_sha256: sha256Schema,
    token_kind: z.literal("EXACT_QUOTED_LITERAL_REFERENCE"),
    line: positiveIntegerSchema,
    column: positiveIntegerSchema
  })
  .strict();

const modelEvidenceClassSchema = z.enum([
  "LITERAL_REFERENCE_EVIDENCE",
  "DYNAMIC_FAMILY_FORM",
  "LEGACY_INACTIVE_NO_FORM"
]);

const modelInventoryEntrySchema = z
  .object({
    model_id: identifierSchema,
    ai_name: identifierSchema,
    active: z.boolean(),
    evidence_class: modelEvidenceClassSchema,
    form_id: formIdSchema.nullable(),
    evidence: z.array(literalEvidenceSchema).max(500)
  })
  .strict();

const summarySchema = z
  .object({
    public_ai_families: nonnegativeIntegerSchema,
    registry_forms: nonnegativeIntegerSchema,
    mapped_family_forms: nonnegativeIntegerSchema,
    unbound_registry_forms: nonnegativeIntegerSchema,
    current_families_without_models: nonnegativeIntegerSchema,
    model_variants: nonnegativeIntegerSchema,
    literal_reference_evidence: nonnegativeIntegerSchema,
    dynamic_family_form: nonnegativeIntegerSchema,
    legacy_inactive_no_form: nonnegativeIntegerSchema,
    legacy_families: nonnegativeIntegerSchema,
    provider_form_modules: nonnegativeIntegerSchema,
    direct_settings_helper_modules: nonnegativeIntegerSchema,
    unpinned_direct_dependencies: nonnegativeIntegerSchema,
    source_artifacts: nonnegativeIntegerSchema
  })
  .strict();

const closureSchema = z
  .object({
    status: z.literal("OPEN"),
    boundary: z.literal("DIRECT_SETTINGS_SOURCE_HELPERS_ONLY"),
    unpinned_direct_dependencies: z
      .array(moduleNameSchema)
      .max(512)
      .superRefine(addDuplicateStringIssues),
    open_items: z
      .array(
        z.enum([
          "TRANSITIVE_HELPER_CLOSURE_NOT_PINNED",
          "UI_RULE_DATAFLOW_NOT_COMPILED",
          "BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED",
          "ACTIVE_FRONTEND_BUILD_DISCOVERY_NOT_PINNED"
        ])
      )
      .length(4)
  })
  .strict();

const inventoryBaseSchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    catalog_kind: z.literal("OBSERVED_FRONTEND_SETTINGS_SOURCE_INVENTORY"),
    evidence_level: z.literal("STATIC_CLIENT_OBSERVATION"),
    runtime_usable: z.literal(false),
    generated_at: utcTimestampSchema,
    build: z
      .object({
        id: z.string().regex(BUILD_ID_PATTERN),
        base_url: z
          .string()
          .url()
          .regex(/^https:\/\/syntx\.ai\/assets\/\d{6,20}\/$/u)
      })
      .strict(),
    public_catalog: publicCatalogProvenanceSchema,
    source_artifacts: z.array(sourceArtifactSchema).min(4).max(1_000),
    family_forms: z.array(familyFormSchema).min(1).max(1_000),
    unbound_registry_forms: z.array(unboundFormSchema).max(1_000),
    legacy_families: z
      .array(identifierSchema)
      .max(1_000)
      .superRefine(addDuplicateStringIssues),
    models: z.array(modelInventoryEntrySchema).min(1).max(10_000),
    closure: closureSchema,
    summary: summarySchema,
    limitations: z
      .array(
        z.enum([
          "FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT",
          "DYNAMIC_FORMS_REQUIRE_FURTHER_SCHEMA_COMPILATION",
          "NO_GENERATION_OR_AUTH_CALLS_PERFORMED"
        ])
      )
      .length(3)
  })
  .strict();

export const settingsSourceInventorySchema = inventoryBaseSchema.superRefine(
  (inventory, context) => {
    validateInventoryRelationships(inventory, context);
  }
);

export type SettingsSourceArtifact = z.infer<typeof sourceArtifactSchema>;
export type SettingsSourceInventory = z.infer<typeof inventoryBaseSchema>;
export type SettingsModelEvidenceClass = z.infer<
  typeof modelEvidenceClassSchema
>;

export interface RefreshSettingsSourceInventoryOptions {
  fetchImpl?: typeof fetch;
  buildId?: string;
  generatedAt?: string;
  absoluteTimeoutMs?: number;
  maxJavaScriptBytes?: number;
  maxSourceMapBytes?: number;
  concurrency?: number;
  maxDirectDependencies?: number;
}

interface FetchedArtifact {
  metadata: SettingsSourceArtifact;
  text: string;
}

interface ParsedSourceMap {
  metadata: z.infer<typeof sourceMapMetadataSchema>;
  settingsSources: Array<{
    index: number;
    path: string;
    content: string;
  }>;
}

interface SourceModule {
  moduleName: string;
  formId: string | null;
  role: SettingsSourceArtifact["role"];
  javascript: FetchedArtifact;
  sourceMap: FetchedArtifact;
  parsedMap: ParsedSourceMap;
  dependencies: string[];
}

interface StringToken {
  value: string;
  line: number;
  column: number;
  start: number;
  end: number;
}

interface RegistryForm {
  formId: string;
  moduleName: string;
  formPath: StringToken;
  dynamicImport: StringToken;
}

interface RegistrySyntaxToken {
  kind: "identifier" | "opaque" | "punctuator" | "string";
  value: string;
  start: number;
  end: number;
  stringToken?: StringToken;
}

export async function refreshSettingsSourceInventory(
  publicCatalog: SyntxPublicCatalogSnapshot,
  options: RefreshSettingsSourceInventoryOptions = {}
): Promise<SettingsSourceInventory> {
  const validatedPublicCatalog =
    syntxPublicCatalogSnapshotSchema.parse(publicCatalog);
  const buildId = options.buildId ?? "1788368942";
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const absoluteTimeoutMs = options.absoluteTimeoutMs ?? 120_000;
  const maxJavaScriptBytes = options.maxJavaScriptBytes ?? 16 * 1024 * 1024;
  const maxSourceMapBytes = options.maxSourceMapBytes ?? 32 * 1024 * 1024;
  const concurrency = options.concurrency ?? 6;
  const maxDirectDependencies = options.maxDirectDependencies ?? 256;

  validateRefreshOptions({
    buildId,
    generatedAt,
    absoluteTimeoutMs,
    maxJavaScriptBytes,
    maxSourceMapBytes,
    concurrency,
    maxDirectDependencies
  });

  const baseUrl = `https://syntx.ai/assets/${buildId}/`;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const deadline = new AbsoluteDeadline(absoluteTimeoutMs);

  try {
    const registryModule = await fetchSourceModule({
      moduleName: "Settings2.js",
      formId: null,
      role: "SETTINGS_REGISTRY",
      baseUrl,
      fetchImpl,
      deadline,
      maxJavaScriptBytes,
      maxSourceMapBytes
    });
    const registryForms = extractRegistryForms(registryModule.javascript.text);
    const formIds = registryForms.map((entry) => entry.formId).sort(compareText);

    const providerModules = await mapWithConcurrency(
      formIds,
      concurrency,
      async (formId) => {
        const registryForm = registryForms.find((entry) => entry.formId === formId);
        if (registryForm === undefined) {
          throw new SettingsSourceInventoryError("REGISTRY_MAPPING_INVALID");
        }
        return fetchSourceModule({
          moduleName: registryForm.moduleName,
          formId,
          role: "PROVIDER_FORM",
          baseUrl,
          fetchImpl,
          deadline,
          maxJavaScriptBytes,
          maxSourceMapBytes
        });
      }
    );

    for (const provider of providerModules) {
      const expectedPath = `/src/components/chat/forms/settings/${provider.formId}.vue`;
      if (
        !provider.parsedMap.settingsSources.some(
          (source) => source.path === expectedPath
        )
      ) {
        throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
      }
    }

    const providerModuleNames = new Set(
      providerModules.map((entry) => entry.moduleName)
    );
    const allDirectDependencies = new Set<string>();
    for (const provider of providerModules) {
      for (const dependency of provider.dependencies) {
        if (
          dependency !== registryModule.moduleName &&
          !providerModuleNames.has(dependency)
        ) {
          allDirectDependencies.add(dependency);
        }
      }
    }
    if (allDirectDependencies.size > maxDirectDependencies) {
      throw new SettingsSourceInventoryError(
        "SOURCE_CLOSURE_LIMIT_EXCEEDED"
      );
    }

    const helperMapCandidates = await mapWithConcurrency(
      [...allDirectDependencies].sort(compareText),
      concurrency,
      async (moduleName) => {
        const sourceMap = await fetchTextArtifact({
          moduleName,
          artifactName: `${moduleName}.map`,
          formId: null,
          role: "DIRECT_SETTINGS_HELPER",
          kind: "SOURCE_MAP_V3",
          baseUrl,
          fetchImpl,
          deadline,
          maxBytes: maxSourceMapBytes
        });
        return {
          moduleName,
          sourceMap,
          parsedMap: parseSourceMap(sourceMap.text)
        };
      }
    );

    const relevantHelperMaps = helperMapCandidates.filter(
      (entry) => entry.parsedMap.settingsSources.length > 0
    );
    const helperModules = await mapWithConcurrency(
      relevantHelperMaps,
      concurrency,
      async (candidate): Promise<SourceModule> => {
        const javascript = await fetchTextArtifact({
          moduleName: candidate.moduleName,
          artifactName: candidate.moduleName,
          formId: null,
          role: "DIRECT_SETTINGS_HELPER",
          kind: "JAVASCRIPT",
          baseUrl,
          fetchImpl,
          deadline,
          maxBytes: maxJavaScriptBytes
        });
        return {
          moduleName: candidate.moduleName,
          formId: null,
          role: "DIRECT_SETTINGS_HELPER",
          javascript,
          sourceMap: withSourceMapMetadata(
            candidate.sourceMap,
            candidate.parsedMap
          ),
          parsedMap: candidate.parsedMap,
          dependencies: extractRelativeJavaScriptDependencies(javascript.text)
        };
      }
    );

    const currentAiNames = new Set(
      validatedPublicCatalog.ai.map((entry) => entry.value)
    );
    assertNoDuplicateStrings(
      [...currentAiNames],
      validatedPublicCatalog.ai.length
    );
    const modelsByFamily = groupModelsByFamily(validatedPublicCatalog);
    const registryByForm = new Map(
      registryForms.map((entry) => [entry.formId, entry])
    );
    const familyForms = validatedPublicCatalog.ai
      .map((ai) => {
        const formId = toObservedFormId(ai.value);
        const registryForm = registryByForm.get(formId);
        if (registryForm === undefined) {
          throw new SettingsSourceInventoryError(
            "FAMILY_FORM_MAPPING_INVALID"
          );
        }
        return {
          ai_name: ai.value,
          form_id: formId,
          ai_active: ai.active,
          model_count: modelsByFamily.get(ai.value)?.length ?? 0,
          evidence: makeRegistryLocator(registryModule, registryForm)
        };
      })
      .sort((left, right) => compareText(left.ai_name, right.ai_name));
    assertNoDuplicateStrings(
      familyForms.map((entry) => entry.form_id),
      familyForms.length
    );

    const mappedForms = new Set(familyForms.map((entry) => entry.form_id));
    const unboundRegistryForms = registryForms
      .filter((entry) => !mappedForms.has(entry.formId))
      .map((entry) => ({
        form_id: entry.formId,
        evidence: makeRegistryLocator(registryModule, entry)
      }))
      .sort((left, right) => compareText(left.form_id, right.form_id));

    const legacyFamilies = [...modelsByFamily.keys()]
      .filter((aiName) => !currentAiNames.has(aiName))
      .sort(compareText);
    for (const aiName of legacyFamilies) {
      const familyModels = modelsByFamily.get(aiName) ?? [];
      if (familyModels.length === 0 || familyModels.some((entry) => entry.active)) {
        throw new SettingsSourceInventoryError(
          "FAMILY_FORM_MAPPING_INVALID"
        );
      }
    }

    const modulesByName = new Map<string, SourceModule>([
      [registryModule.moduleName, registryModule],
      ...providerModules.map((entry) => [entry.moduleName, entry] as const),
      ...helperModules.map((entry) => [entry.moduleName, entry] as const)
    ]);
    const models = validatedPublicCatalog.models
      .map((model) => {
        if (!currentAiNames.has(model.ai_name)) {
          return {
            model_id: model.value,
            ai_name: model.ai_name,
            active: model.active,
            evidence_class: "LEGACY_INACTIVE_NO_FORM" as const,
            form_id: null,
            evidence: []
          };
        }

        const formId = toObservedFormId(model.ai_name);
        const registryForm = registryByForm.get(formId);
        const provider = registryForm === undefined
          ? undefined
          : modulesByName.get(registryForm.moduleName);
        if (provider === undefined) {
          throw new SettingsSourceInventoryError(
            "FAMILY_FORM_MAPPING_INVALID"
          );
        }
        const relevantModuleNames = [
          provider.moduleName,
          ...provider.dependencies.filter((dependency) =>
            modulesByName.has(dependency)
          )
        ];
        const evidence = collectLiteralEvidence(
          model.value,
          relevantModuleNames,
          modulesByName
        );
        return {
          model_id: model.value,
          ai_name: model.ai_name,
          active: model.active,
          evidence_class:
            evidence.length > 0
              ? ("LITERAL_REFERENCE_EVIDENCE" as const)
              : ("DYNAMIC_FAMILY_FORM" as const),
          form_id: formId,
          evidence
        };
      })
      .sort((left, right) => compareText(left.model_id, right.model_id));

    assertNoDuplicateStrings(
      models.map((entry) => entry.model_id),
      models.length
    );

    const selectedHelperNames = new Set(
      helperModules.map((entry) => entry.moduleName)
    );
    const unpinnedDirectDependencies = [...allDirectDependencies]
      .filter((entry) => !selectedHelperNames.has(entry))
      .sort(compareText);
    const sourceArtifacts = [
      registryModule,
      ...providerModules,
      ...helperModules
    ]
      .flatMap((entry) => [
        entry.javascript.metadata,
        entry.sourceMap.metadata
      ])
      .sort(compareArtifacts);

    const summary = deriveSummary({
      publicAiFamilies: validatedPublicCatalog.ai.length,
      registryForms: registryForms.length,
      familyForms,
      unboundRegistryForms,
      legacyFamilies,
      models,
      providerModules,
      helperModules,
      unpinnedDirectDependencies,
      sourceArtifacts
    });

    const candidate = {
      schema_version: "1.0.0",
      catalog_kind: "OBSERVED_FRONTEND_SETTINGS_SOURCE_INVENTORY",
      evidence_level: "STATIC_CLIENT_OBSERVATION",
      runtime_usable: false,
      generated_at: generatedAt,
      build: { id: buildId, base_url: baseUrl },
      public_catalog: {
        fetched_at: validatedPublicCatalog.fetched_at,
        ai_sha256: validatedPublicCatalog.sources.ai.canonical_sha256,
        models_sha256: validatedPublicCatalog.sources.models.canonical_sha256,
        llm_models_sha256:
          validatedPublicCatalog.sources.llm_models.canonical_sha256
      },
      source_artifacts: sourceArtifacts,
      family_forms: familyForms,
      unbound_registry_forms: unboundRegistryForms,
      legacy_families: legacyFamilies,
      models,
      closure: {
        status: "OPEN",
        boundary: "DIRECT_SETTINGS_SOURCE_HELPERS_ONLY",
        unpinned_direct_dependencies: unpinnedDirectDependencies,
        open_items: [
          "TRANSITIVE_HELPER_CLOSURE_NOT_PINNED",
          "UI_RULE_DATAFLOW_NOT_COMPILED",
          "BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED",
          "ACTIVE_FRONTEND_BUILD_DISCOVERY_NOT_PINNED"
        ]
      },
      summary,
      limitations: [
        "FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT",
        "DYNAMIC_FORMS_REQUIRE_FURTHER_SCHEMA_COMPILATION",
        "NO_GENERATION_OR_AUTH_CALLS_PERFORMED"
      ]
    } as const;

    return settingsSourceInventorySchema.parse(candidate);
  } finally {
    deadline.close();
  }
}

export function loadSettingsSourceInventory(
  path?: string,
  publicCatalog?: SyntxPublicCatalogSnapshot
): SettingsSourceInventory {
  const inventoryPath = path ?? findDefaultInventoryPath();
  const raw: unknown = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const inventory = settingsSourceInventorySchema.parse(raw);
  assertSettingsSourceInventoryMatchesPublicCatalog(
    inventory,
    publicCatalog ?? loadSyntxPublicCatalogSnapshot()
  );
  return inventory;
}

export function serializeSettingsSourceInventory(
  inventory: SettingsSourceInventory
): string {
  const validated = settingsSourceInventorySchema.parse(inventory);
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export function assertSettingsSourceInventoryUnchanged(
  recorded: SettingsSourceInventory,
  observed: SettingsSourceInventory
): void {
  if (
    serializeSettingsSourceInventory(recorded) !==
    serializeSettingsSourceInventory(observed)
  ) {
    throw new SettingsSourceInventoryError("SOURCE_DRIFT_DETECTED");
  }
}

export function assertSettingsSourceInventoryMatchesPublicCatalog(
  inventory: SettingsSourceInventory,
  publicCatalog: SyntxPublicCatalogSnapshot
): void {
  const validatedPublicCatalog =
    syntxPublicCatalogSnapshotSchema.parse(publicCatalog);
  if (
    inventory.public_catalog.fetched_at !== validatedPublicCatalog.fetched_at ||
    inventory.public_catalog.ai_sha256 !==
      validatedPublicCatalog.sources.ai.canonical_sha256 ||
    inventory.public_catalog.models_sha256 !==
      validatedPublicCatalog.sources.models.canonical_sha256 ||
    inventory.public_catalog.llm_models_sha256 !==
      validatedPublicCatalog.sources.llm_models.canonical_sha256 ||
    inventory.family_forms.length !== validatedPublicCatalog.ai.length ||
    inventory.models.length !== validatedPublicCatalog.models.length
  ) {
    throw new SettingsSourceInventoryError("FAMILY_FORM_MAPPING_INVALID");
  }

  const familyByName = new Map(
    inventory.family_forms.map((entry) => [entry.ai_name, entry])
  );
  for (const ai of validatedPublicCatalog.ai) {
    const family = familyByName.get(ai.value);
    if (
      family === undefined ||
      family.ai_active !== ai.active ||
      family.form_id !== toObservedFormId(ai.value) ||
      family.model_count !==
        validatedPublicCatalog.models.filter(
          (model) => model.ai_name === ai.value
        ).length
    ) {
      throw new SettingsSourceInventoryError("FAMILY_FORM_MAPPING_INVALID");
    }
  }

  const modelById = new Map(
    inventory.models.map((entry) => [entry.model_id, entry])
  );
  const publicAiNames = new Set(
    validatedPublicCatalog.ai.map((entry) => entry.value)
  );
  for (const publicModel of validatedPublicCatalog.models) {
    const model = modelById.get(publicModel.value);
    const expectedFormId = publicAiNames.has(publicModel.ai_name)
      ? toObservedFormId(publicModel.ai_name)
      : null;
    if (
      model === undefined ||
      model.ai_name !== publicModel.ai_name ||
      model.active !== publicModel.active ||
      model.form_id !== expectedFormId ||
      (expectedFormId === null) !==
        (model.evidence_class === "LEGACY_INACTIVE_NO_FORM")
    ) {
      throw new SettingsSourceInventoryError("FAMILY_FORM_MAPPING_INVALID");
    }
  }
  const expectedLegacyFamilies = [...new Set(
    validatedPublicCatalog.models
      .filter((model) => !publicAiNames.has(model.ai_name))
      .map((model) => model.ai_name)
  )].sort(compareText);
  if (
    JSON.stringify(expectedLegacyFamilies) !==
    JSON.stringify(inventory.legacy_families)
  ) {
    throw new SettingsSourceInventoryError("FAMILY_FORM_MAPPING_INVALID");
  }
}

function validateRefreshOptions(options: {
  buildId: string;
  generatedAt: string;
  absoluteTimeoutMs: number;
  maxJavaScriptBytes: number;
  maxSourceMapBytes: number;
  concurrency: number;
  maxDirectDependencies: number;
}): void {
  if (
    !BUILD_ID_PATTERN.test(options.buildId) ||
    !UTC_TIMESTAMP_PATTERN.test(options.generatedAt) ||
    !Number.isFinite(Date.parse(options.generatedAt)) ||
    !isBoundedInteger(options.absoluteTimeoutMs, 1, 300_000) ||
    !isBoundedInteger(options.maxJavaScriptBytes, 1_024, 64 * 1024 * 1024) ||
    !isBoundedInteger(options.maxSourceMapBytes, 1_024, 64 * 1024 * 1024) ||
    !isBoundedInteger(options.concurrency, 1, 8) ||
    !isBoundedInteger(options.maxDirectDependencies, 1, 512)
  ) {
    throw new TypeError("Settings source inventory bounds are invalid.");
  }
}

async function fetchSourceModule(input: {
  moduleName: string;
  formId: string | null;
  role: SettingsSourceArtifact["role"];
  baseUrl: string;
  fetchImpl: typeof fetch;
  deadline: AbsoluteDeadline;
  maxJavaScriptBytes: number;
  maxSourceMapBytes: number;
}): Promise<SourceModule> {
  const javascript = await fetchTextArtifact({
    moduleName: input.moduleName,
    artifactName: input.moduleName,
    formId: input.formId,
    role: input.role,
    kind: "JAVASCRIPT",
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    deadline: input.deadline,
    maxBytes: input.maxJavaScriptBytes
  });
  const sourceMap = await fetchTextArtifact({
    moduleName: input.moduleName,
    artifactName: `${input.moduleName}.map`,
    formId: input.formId,
    role: input.role,
    kind: "SOURCE_MAP_V3",
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    deadline: input.deadline,
    maxBytes: input.maxSourceMapBytes
  });
  const parsedMap = parseSourceMap(sourceMap.text);
  return {
    moduleName: input.moduleName,
    formId: input.formId,
    role: input.role,
    javascript,
    sourceMap: withSourceMapMetadata(sourceMap, parsedMap),
    parsedMap,
    dependencies: extractRelativeJavaScriptDependencies(javascript.text)
  };
}

async function fetchTextArtifact(input: {
  moduleName: string;
  artifactName: string;
  formId: string | null;
  role: SettingsSourceArtifact["role"];
  kind: SettingsSourceArtifact["kind"];
  baseUrl: string;
  fetchImpl: typeof fetch;
  deadline: AbsoluteDeadline;
  maxBytes: number;
}): Promise<FetchedArtifact> {
  if (
    !MODULE_NAME_PATTERN.test(input.moduleName) ||
    !new RegExp(`^${escapeRegularExpression(input.moduleName)}(?:\\.map)?$`, "u").test(
      input.artifactName
    )
  ) {
    throw new SettingsSourceInventoryError("SOURCE_FETCH_FAILED");
  }
  const url = new URL(input.artifactName, input.baseUrl).href;
  let response: Response;
  let pendingResponse: Promise<Response> | undefined;
  try {
    pendingResponse = input.fetchImpl(url, {
      method: "GET",
      headers: {
        accept:
          input.kind === "JAVASCRIPT"
            ? "application/javascript"
            : "application/json, application/octet-stream;q=0.9",
        "accept-encoding": "identity"
      },
      credentials: "omit",
      redirect: "manual",
      cache: "no-store",
      signal: input.deadline.signal
    });
    response = await input.deadline.waitFor(
      pendingResponse
    );
  } catch {
    if (pendingResponse !== undefined) {
      void pendingResponse.then(
        (lateResponse) => cancelBody(lateResponse.body),
        () => undefined
      );
    }
    throw new SettingsSourceInventoryError("SOURCE_FETCH_FAILED");
  }

  try {
    if (response.status >= 300 && response.status <= 399) {
      cancelBody(response.body);
      throw new SettingsSourceInventoryError("SOURCE_REDIRECTED");
    }
    if (!response.ok) {
      cancelBody(response.body);
      throw new SettingsSourceInventoryError("SOURCE_FETCH_FAILED");
    }
    if (response.url !== url) {
      cancelBody(response.body);
      throw new SettingsSourceInventoryError("SOURCE_REDIRECTED");
    }
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    const allowedMediaTypes =
      input.kind === "JAVASCRIPT"
        ? JAVASCRIPT_MEDIA_TYPES
        : SOURCE_MAP_MEDIA_TYPES;
    if (contentType === undefined || !allowedMediaTypes.has(contentType)) {
      cancelBody(response.body);
      throw new SettingsSourceInventoryError("SOURCE_MEDIA_TYPE_INVALID");
    }

    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      const parsedLength = Number(declaredLength);
      if (
        !Number.isSafeInteger(parsedLength) ||
        parsedLength < 0 ||
        parsedLength > input.maxBytes
      ) {
        cancelBody(response.body);
        throw new SettingsSourceInventoryError("SOURCE_TOO_LARGE");
      }
    }
    if (response.body === null) {
      throw new SettingsSourceInventoryError("SOURCE_FETCH_FAILED");
    }

    const bytes = await readBoundedBody(
      response.body,
      input.maxBytes,
      input.deadline
    );
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new SettingsSourceInventoryError("SOURCE_UTF8_INVALID");
    }
    const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    return {
      text,
      metadata: {
        role: input.role,
        kind: input.kind,
        module_name: input.moduleName,
        form_id: input.formId,
        url,
        content_type: contentType,
        bytes: bytes.byteLength,
        sha256,
        source_map: null
      }
    };
  } finally {
    // Successful reads consume the body; rejected reads cancel it at the branch.
  }
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  deadline: AbsoluteDeadline
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      let item: ReadableStreamReadResult<Uint8Array>;
      try {
        item = await deadline.waitFor(reader.read());
      } catch {
        cancelReader(reader);
        throw new SettingsSourceInventoryError("SOURCE_FETCH_FAILED");
      }
      if (item.done) break;
      totalBytes += item.value.byteLength;
      if (totalBytes > maxBytes) {
        cancelReader(reader);
        throw new SettingsSourceInventoryError("SOURCE_TOO_LARGE");
      }
      chunks.push(item.value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A hostile injected stream can retain a pending read after the deadline.
    }
  }

  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function parseSourceMap(text: string): ParsedSourceMap {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }
  if (!isPlainRecord(candidate)) {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }
  const { version, file, names, mappings, sources, sourcesContent } = candidate;
  if (
    version !== 3 ||
    typeof file !== "string" ||
    file.length < 1 ||
    file.length > 2_000 ||
    !Array.isArray(names) ||
    names.length > 100_000 ||
    names.some(
      (name) => typeof name !== "string" || name.length > 20_000
    ) ||
    typeof mappings !== "string" ||
    !Array.isArray(sources) ||
    !Array.isArray(sourcesContent) ||
    sources.length < 1 ||
    sources.length > 5_000 ||
    sources.length !== sourcesContent.length
  ) {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }

  const settingsSources: ParsedSourceMap["settingsSources"] = [];
  const settingsPaths = new Set<string>();
  for (let index = 0; index < sources.length; index += 1) {
    const pathValue = sources[index];
    const contentValue = sourcesContent[index];
    if (
      typeof pathValue !== "string" ||
      pathValue.length < 1 ||
      pathValue.length > 2_000 ||
      pathValue.includes("\0") ||
      typeof contentValue !== "string"
    ) {
      throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
    }
    const normalizedPath = normalizeSettingsSourcePath(pathValue);
    if (normalizedPath !== null) {
      if (settingsPaths.has(normalizedPath)) {
        throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
      }
      settingsPaths.add(normalizedPath);
      settingsSources.push({
        index,
        path: normalizedPath,
        content: contentValue
      });
    }
  }

  return {
    metadata: {
      version: 3,
      file,
      source_count: sources.length,
      sources_content_count: sourcesContent.length,
      settings_source_count: settingsSources.length,
      settings_sources: settingsSources.map((source) => ({
        source_index: source.index,
        source_path: source.path,
        source_content_sha256: `sha256:${createHash("sha256")
          .update(source.content)
          .digest("hex")}`
      }))
    },
    settingsSources
  };
}

function withSourceMapMetadata(
  artifact: FetchedArtifact,
  parsed: ParsedSourceMap
): FetchedArtifact {
  return {
    text: artifact.text,
    metadata: {
      ...artifact.metadata,
      source_map: parsed.metadata
    }
  };
}

function extractRegistryForms(source: string): RegistryForm[] {
  const tokens = scanRegistrySyntaxTokens(source);
  const formPaths = new Map<string, RegistryForm[]>();
  const imports = new Map<string, RegistrySyntaxToken[]>();
  const boundImportStarts = new Set<number>();
  const registryObjectStarts = new Set<number>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "string" || token.stringToken === undefined) continue;
    const formMatch = /^\.\/forms\/settings\/([a-z0-9]+(?:-[a-z0-9]+)*)\.vue$/u.exec(
      token.value
    );
    if (formMatch?.[1] !== undefined) {
      const formId = formMatch[1];
      const objectStart = findEnclosingObjectStart(tokens, index);
      if (
        objectStart === null ||
        !isAllowedRegistryObjectParent(tokens, objectStart) ||
        !hasRegistryToken(tokens[index - 1], "punctuator", ["{", ","]) ||
        !hasRegistryToken(tokens[index + 1], "punctuator", [":"]) ||
        !hasRegistryToken(tokens[index + 2], "punctuator", ["("]) ||
        !hasRegistryToken(tokens[index + 3], "punctuator", [")"]) ||
        !hasRegistryToken(tokens[index + 4], "punctuator", ["=>"])
      ) {
        throw new SettingsSourceInventoryError("REGISTRY_MAPPING_INVALID");
      }
      const dynamicImport = parseRegistryLoader(tokens, index + 5);
      if (dynamicImport === null || dynamicImport.stringToken === undefined) {
        throw new SettingsSourceInventoryError("REGISTRY_MAPPING_INVALID");
      }
      appendToMap(formPaths, formId, {
        formId,
        moduleName: moduleNameFromImportSymbol(dynamicImport),
        formPath: token.stringToken,
        dynamicImport: dynamicImport.stringToken
      });
      boundImportStarts.add(dynamicImport.start);
      registryObjectStarts.add(tokens[objectStart]!.start);
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const importKeyword = tokens[index];
    const specifier = tokens[index + 2];
    if (
      !hasRegistryToken(importKeyword, "identifier", ["import"]) ||
      hasRegistryToken(tokens[index - 1], "punctuator", [".", "?."]) ||
      !hasRegistryToken(tokens[index + 1], "punctuator", ["("]) ||
      specifier?.kind !== "string" ||
      !hasRegistryToken(tokens[index + 3], "punctuator", [")"])
    ) {
      continue;
    }
    if (isSafeRegistryModuleSpecifier(specifier.value)) {
      appendToMap(imports, specifier.value.slice(2), specifier);
    }
  }

  if (
    formPaths.size < 1 ||
    imports.size < 1 ||
    registryObjectStarts.size !== 1
  ) {
    throw new SettingsSourceInventoryError("REGISTRY_MAPPING_INVALID");
  }
  const formIds = new Set(formPaths.keys());
  const result: RegistryForm[] = [];
  for (const formId of formIds) {
    const paths = formPaths.get(formId) ?? [];
    const moduleName = paths[0]?.moduleName;
    const targets = moduleName === undefined ? [] : imports.get(moduleName) ?? [];
    if (
      paths.length !== 1 ||
      targets.length !== 1 ||
      !boundImportStarts.has(targets[0]!.start) ||
      paths[0]!.dynamicImport.start !== targets[0]!.start ||
      paths[0]!.moduleName !== moduleName
    ) {
      throw new SettingsSourceInventoryError("REGISTRY_MAPPING_INVALID");
    }
    result.push(paths[0]!);
  }
  const moduleOwners = new Map<string, string>();
  const formIdModuleNames = new Set(
    [...formPaths.keys()].map((formId) => `${formId}.js`)
  );
  for (const form of result) {
    if (
      formIdModuleNames.has(form.moduleName) &&
      form.moduleName !== `${form.formId}.js`
    ) {
      throw new SettingsSourceInventoryError("REGISTRY_MAPPING_INVALID");
    }
    const owner = moduleOwners.get(form.moduleName);
    if (owner !== undefined && owner !== form.formId) {
      throw new SettingsSourceInventoryError("REGISTRY_MAPPING_INVALID");
    }
    moduleOwners.set(form.moduleName, form.formId);
  }
  if (
    imports.size !== moduleOwners.size ||
    [...imports.keys()].some((moduleName) => !moduleOwners.has(moduleName))
  ) {
    throw new SettingsSourceInventoryError("REGISTRY_MAPPING_INVALID");
  }
  return result.sort((left, right) => compareText(left.formId, right.formId));
}

function isSafeRegistryModuleSpecifier(value: string): boolean {
  return /^\.\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(value);
}

function moduleNameFromImportSymbol(input: RegistrySyntaxToken): string {
  if (input.kind !== "string" || !isSafeRegistryModuleSpecifier(input.value)) {
    throw new SettingsSourceInventoryError("REGISTRY_MAPPING_INVALID");
  }
  return input.value.slice(2);
}

function findEnclosingObjectStart(
  tokens: readonly RegistrySyntaxToken[],
  propertyIndex: number
): number | null {
  let depth = 0;
  for (let index = propertyIndex - 1; index >= 0; index -= 1) {
    if (hasRegistryToken(tokens[index], "punctuator", ["}"])) {
      depth += 1;
      continue;
    }
    if (!hasRegistryToken(tokens[index], "punctuator", ["{"])) continue;
    if (depth === 0) return index;
    depth -= 1;
  }
  return null;
}

function isAllowedRegistryObjectParent(
  tokens: readonly RegistrySyntaxToken[],
  objectStart: number
): boolean {
  if (
    tokens[objectStart - 1]?.kind === "opaque" &&
    tokens[objectStart - 1]?.value === "=" &&
    tokens[objectStart - 2]?.kind === "identifier" &&
    hasRegistryToken(tokens[objectStart - 3], "identifier", [
      "const",
      "let",
      "var"
    ])
  ) {
    return true;
  }
  return (
    hasRegistryToken(tokens[objectStart - 1], "punctuator", ["("]) &&
    hasRegistryToken(tokens[objectStart - 2], "identifier", ["assign"]) &&
    hasRegistryToken(tokens[objectStart - 3], "punctuator", ["."]) &&
    hasRegistryToken(tokens[objectStart - 4], "identifier", ["Object"])
  );
}

function parseRegistryLoader(
  tokens: readonly RegistrySyntaxToken[],
  start: number
): RegistrySyntaxToken | null {
  const directImport = tokens[start + 2];
  if (
    hasRegistryToken(tokens[start], "identifier", ["import"]) &&
    hasRegistryToken(tokens[start + 1], "punctuator", ["("]) &&
    directImport?.kind === "string" &&
    isSafeRegistryModuleSpecifier(directImport.value) &&
    hasRegistryToken(tokens[start + 3], "punctuator", [")"]) &&
    hasRegistryToken(tokens[start + 4], "punctuator", [",", "}"])
  ) {
    return directImport;
  }

  const wrappedImport = tokens[start + 7];
  if (
    tokens[start]?.kind !== "identifier" ||
    !/^[A-Za-z_$]$/u.test(tokens[start].value) ||
    !hasRegistryToken(tokens[start + 1], "punctuator", ["("]) ||
    !hasRegistryToken(tokens[start + 2], "punctuator", ["("]) ||
    !hasRegistryToken(tokens[start + 3], "punctuator", [")"]) ||
    !hasRegistryToken(tokens[start + 4], "punctuator", ["=>"]) ||
    !hasRegistryToken(tokens[start + 5], "identifier", ["import"]) ||
    !hasRegistryToken(tokens[start + 6], "punctuator", ["("]) ||
    wrappedImport?.kind !== "string" ||
    !isSafeRegistryModuleSpecifier(wrappedImport.value) ||
    !hasRegistryToken(tokens[start + 8], "punctuator", [")"]) ||
    !hasRegistryToken(tokens[start + 9], "punctuator", [","]) ||
    !hasRegistryToken(tokens[start + 10], "identifier", ["__vite__mapDeps"]) ||
    !hasRegistryToken(tokens[start + 11], "punctuator", ["("]) ||
    !hasRegistryToken(tokens[start + 12], "punctuator", ["["])
  ) {
    return null;
  }

  let cursor = start + 13;
  let expectInteger = true;
  let sawInteger = false;
  while (!hasRegistryToken(tokens[cursor], "punctuator", ["]"])) {
    const token = tokens[cursor];
    if (token === undefined) return null;
    if (expectInteger) {
      if (token.kind !== "opaque" || !/^(?:0|[1-9][0-9]*)$/u.test(token.value)) {
        return null;
      }
      sawInteger = true;
    } else if (!hasRegistryToken(token, "punctuator", [","])) {
      return null;
    }
    expectInteger = !expectInteger;
    cursor += 1;
  }
  if ((sawInteger && expectInteger) || (!sawInteger && !expectInteger)) {
    return null;
  }
  if (
    !hasRegistryToken(tokens[cursor + 1], "punctuator", [")"]) ||
    !hasRegistryToken(tokens[cursor + 2], "punctuator", [")"]) ||
    !hasRegistryToken(tokens[cursor + 3], "punctuator", [",", "}"])
  ) {
    return null;
  }
  return wrappedImport;
}

function hasRegistryToken(
  token: RegistrySyntaxToken | undefined,
  kind: RegistrySyntaxToken["kind"],
  values: readonly string[]
): boolean {
  return token?.kind === kind && values.includes(token.value);
}

function scanRegistrySyntaxTokens(source: string): RegistrySyntaxToken[] {
  const stringsByStart = new Map(
    scanQuotedStringTokens(source).map((token) => [token.start, token] as const)
  );
  const tokens: RegistrySyntaxToken[] = [];
  let index = 0;
  let canStartRegex = true;
  let pendingControlParen = false;
  const controlParenStack: boolean[] = [];

  while (index < source.length) {
    if (source.startsWith("//", index)) {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) {
        throw new SettingsSourceInventoryError("REGISTRY_MAPPING_INVALID");
      }
      index = end + 2;
      continue;
    }
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end < 0) {
        throw new SettingsSourceInventoryError("REGISTRY_MAPPING_INVALID");
      }
      index = end + 3;
      continue;
    }
    if (/\s/u.test(source[index]!)) {
      index += 1;
      continue;
    }

    const stringToken = stringsByStart.get(index);
    if (stringToken !== undefined) {
      tokens.push({
        kind: "string",
        value: stringToken.value,
        start: stringToken.start,
        end: stringToken.end,
        stringToken
      });
      index = stringToken.end;
      pendingControlParen = false;
      canStartRegex = false;
      continue;
    }

    const character = source[index]!;
    if (character === "\"" || character === "'" || character === "`") {
      const end = skipOpaqueQuotedLiteral(source, index, character);
      tokens.push({ kind: "opaque", value: character, start: index, end });
      index = end;
      pendingControlParen = false;
      canStartRegex = false;
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/u.test(source[index]!)) {
        index += 1;
      }
      const value = source.slice(start, index);
      tokens.push({ kind: "identifier", value, start, end: index });
      pendingControlParen = CONTROL_PAREN_KEYWORDS.has(value);
      canStartRegex = pendingControlParen || REGEX_PREFIX_KEYWORDS.has(value);
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[0-9]/u.test(source[index]!)) {
        index += 1;
      }
      tokens.push({
        kind: "opaque",
        value: source.slice(start, index),
        start,
        end: index
      });
      pendingControlParen = false;
      canStartRegex = false;
      continue;
    }
    if (character === "/") {
      const regexEnd = canStartRegex
        ? findRegularExpressionLiteralEnd(source, index)
        : -1;
      if (regexEnd > index) {
        tokens.push({
          kind: "opaque",
          value: "regex",
          start: index,
          end: regexEnd
        });
        index = regexEnd;
        pendingControlParen = false;
        canStartRegex = false;
        continue;
      }
    }

    const start = index;
    let value: string;
    if (source.startsWith("=>", index) || source.startsWith("?.", index)) {
      value = source.slice(index, index + 2);
      index += 2;
    } else {
      value = character;
      index += 1;
    }
    const kind: RegistrySyntaxToken["kind"] =
      "{}[](),:.".includes(value) || value === "=>" || value === "?."
        ? "punctuator"
        : "opaque";
    tokens.push({ kind, value, start, end: index });

    if (value === "(") {
      controlParenStack.push(pendingControlParen);
      pendingControlParen = false;
      canStartRegex = true;
    } else if (value === ")") {
      pendingControlParen = false;
      canStartRegex = controlParenStack.pop() ?? false;
    } else if (
      value === "}" ||
      value === "]" ||
      value === "." ||
      value === "?."
    ) {
      pendingControlParen = false;
      canStartRegex = false;
    } else {
      pendingControlParen = false;
      canStartRegex = true;
    }
  }

  return tokens;
}

function skipOpaqueQuotedLiteral(
  source: string,
  start: number,
  quote: string
): number {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index + 1;
    if (quote !== "`" && (source[index] === "\n" || source[index] === "\r")) {
      break;
    }
  }
  throw new SettingsSourceInventoryError("REGISTRY_MAPPING_INVALID");
}

function extractRelativeJavaScriptDependencies(source: string): string[] {
  const dependencies = new Set<string>();
  for (const token of scanQuotedStringTokens(source)) {
    const match = /^\.\/([A-Za-z0-9][A-Za-z0-9._-]*\.js)$/u.exec(token.value);
    if (match?.[1] === undefined || !isModuleSpecifier(source, token)) continue;
    dependencies.add(match[1]);
  }
  return [...dependencies].sort(compareText);
}

function isDynamicImportSpecifier(source: string, token: StringToken): boolean {
  const before = source.slice(Math.max(0, token.start - 80), token.start);
  const after = source.slice(token.end, Math.min(source.length, token.end + 20));
  return /\bimport\s*\(\s*$/u.test(before) && /^\s*\)/u.test(after);
}

function isModuleSpecifier(source: string, token: StringToken): boolean {
  if (isDynamicImportSpecifier(source, token)) return true;
  const before = source.slice(Math.max(0, token.start - 300), token.start);
  return /\bfrom\s*$/u.test(before) || /\bimport\s*$/u.test(before);
}

function scanQuotedStringTokens(source: string): StringToken[] {
  const tokens: StringToken[] = [];
  let index = 0;
  let line = 1;
  let column = 1;
  let canStartRegex = true;
  let pendingControlParen = false;
  const controlParenStack: boolean[] = [];

  const advance = (): string => {
    const character = source[index++]!;
    if (character === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return character;
  };

  while (index < source.length) {
    if (source.startsWith("//", index)) {
      while (index < source.length && advance() !== "\n") {
        // Skip line comments.
      }
      continue;
    }
    if (source.startsWith("/*", index)) {
      advance();
      advance();
      while (index < source.length && !source.startsWith("*/", index)) {
        advance();
      }
      if (source.startsWith("*/", index)) {
        advance();
        advance();
      }
      continue;
    }
    if (source.startsWith("<!--", index)) {
      while (index < source.length && !source.startsWith("-->", index)) {
        advance();
      }
      if (source.startsWith("-->", index)) {
        advance();
        advance();
        advance();
      }
      continue;
    }

    const quote = source[index];
    if (/\s/u.test(quote!)) {
      advance();
      continue;
    }

    if (/[A-Za-z_$]/u.test(quote!)) {
      let identifier = "";
      while (index < source.length && /[A-Za-z0-9_$]/u.test(source[index]!)) {
        identifier += advance();
      }
      pendingControlParen = CONTROL_PAREN_KEYWORDS.has(identifier);
      canStartRegex =
        pendingControlParen || REGEX_PREFIX_KEYWORDS.has(identifier);
      continue;
    }

    if (/[0-9]/u.test(quote!)) {
      while (index < source.length && /[A-Za-z0-9_.]/u.test(source[index]!)) {
        advance();
      }
      pendingControlParen = false;
      canStartRegex = false;
      continue;
    }

    if (quote === "/") {
      const regexEnd = canStartRegex
        ? findRegularExpressionLiteralEnd(source, index)
        : -1;
      if (regexEnd > index) {
        while (index < regexEnd) advance();
        pendingControlParen = false;
        canStartRegex = false;
        continue;
      }
      advance();
      if (source[index] === "=") advance();
      pendingControlParen = false;
      canStartRegex = true;
      continue;
    }

    if (quote === "(") {
      advance();
      controlParenStack.push(pendingControlParen);
      pendingControlParen = false;
      canStartRegex = true;
      continue;
    }
    if (quote === ")") {
      advance();
      pendingControlParen = false;
      canStartRegex = controlParenStack.pop() ?? false;
      continue;
    }
    if (quote === "]" || quote === "}") {
      advance();
      pendingControlParen = false;
      canStartRegex = false;
      continue;
    }
    if (source.startsWith("++", index) || source.startsWith("--", index)) {
      advance();
      advance();
      pendingControlParen = false;
      canStartRegex = false;
      continue;
    }
    if (quote === ".") {
      advance();
      pendingControlParen = false;
      canStartRegex = false;
      continue;
    }
    if (quote !== "\"" && quote !== "'" && quote !== "`") {
      advance();
      pendingControlParen = false;
      canStartRegex = true;
      continue;
    }

    const start = index;
    const tokenLine = line;
    const tokenColumn = column;
    advance();
    let value = "";
    let dynamicTemplate = false;
    let terminated = false;
    while (index < source.length) {
      const character = advance();
      if (character === quote) {
        terminated = true;
        break;
      }
      if (quote === "`" && character === "$" && source[index] === "{") {
        dynamicTemplate = true;
      }
      if (character !== "\\") {
        value += character;
        continue;
      }
      if (index >= source.length) break;
      const escaped = advance();
      if (escaped === "\n") continue;
      const decoded = decodeEscape(source, escaped, () => {
        if (index >= source.length) return undefined;
        return advance();
      });
      value += decoded;
    }
    if (terminated && !dynamicTemplate) {
      tokens.push({
        value,
        line: tokenLine,
        column: tokenColumn,
        start,
        end: index
      });
    }
    pendingControlParen = false;
    canStartRegex = false;
  }
  return tokens;
}

function findRegularExpressionLiteralEnd(
  source: string,
  start: number
): number {
  if (
    source[start] !== "/" ||
    source[start + 1] === "/" ||
    source[start + 1] === "*"
  ) {
    return -1;
  }
  let inCharacterClass = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === "\n" || character === "\r") return -1;
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (character === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (character !== "/" || inCharacterClass) continue;
    let end = index + 1;
    while (end < source.length && /[A-Za-z]/u.test(source[end]!)) end += 1;
    return end;
  }
  return -1;
}

function decodeEscape(
  source: string,
  escaped: string,
  take: () => string | undefined
): string {
  const simple: Record<string, string> = {
    "0": "\0",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v"
  };
  if (simple[escaped] !== undefined) return simple[escaped];
  if (escaped === "x") {
    const digits = `${take() ?? ""}${take() ?? ""}`;
    return /^[a-fA-F0-9]{2}$/u.test(digits)
      ? String.fromCodePoint(Number.parseInt(digits, 16))
      : `x${digits}`;
  }
  if (escaped === "u") {
    const first = take();
    if (first === "{") {
      let digits = "";
      for (let count = 0; count < 8; count += 1) {
        const next = take();
        if (next === undefined || next === "}") break;
        digits += next;
      }
      const codePoint = Number.parseInt(digits, 16);
      return /^[a-fA-F0-9]{1,6}$/u.test(digits) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : `u{${digits}}`;
    }
    const digits = `${first ?? ""}${take() ?? ""}${take() ?? ""}${take() ?? ""}`;
    return /^[a-fA-F0-9]{4}$/u.test(digits)
      ? String.fromCodePoint(Number.parseInt(digits, 16))
      : `u${digits}`;
  }
  void source;
  return escaped;
}

function collectLiteralEvidence(
  modelId: string,
  moduleNames: readonly string[],
  modulesByName: ReadonlyMap<string, SourceModule>
): z.infer<typeof literalEvidenceSchema>[] {
  const evidence: z.infer<typeof literalEvidenceSchema>[] = [];
  const visited = new Set<string>();
  for (const moduleName of moduleNames) {
    if (visited.has(moduleName)) continue;
    visited.add(moduleName);
    const sourceModule = modulesByName.get(moduleName);
    if (sourceModule === undefined) continue;
    for (const source of sourceModule.parsedMap.settingsSources) {
      for (const token of scanEvidenceStringTokens(
        source.path,
        source.content
      )) {
        if (token.value !== modelId) continue;
        const sourceContentSha256 = `sha256:${createHash("sha256")
          .update(source.content)
          .digest("hex")}`;
        evidence.push({
          module_url: sourceModule.javascript.metadata.url,
          module_sha256: sourceModule.javascript.metadata.sha256,
          source_map_url: sourceModule.sourceMap.metadata.url,
          source_map_sha256: sourceModule.sourceMap.metadata.sha256,
          source_index: source.index,
          source_path: source.path,
          source_content_sha256: sourceContentSha256,
          token_kind: "EXACT_QUOTED_LITERAL_REFERENCE",
          line: token.line,
          column: token.column
        });
      }
    }
  }
  return evidence.sort((left, right) =>
    compareText(
      `${left.source_map_url}:${left.source_index}:${left.line}:${left.column}`,
      `${right.source_map_url}:${right.source_index}:${right.line}:${right.column}`
    )
  );
}

function scanEvidenceStringTokens(
  sourcePath: string,
  source: string
): StringToken[] {
  if (!sourcePath.endsWith(".vue")) {
    return scanQuotedStringTokens(source);
  }

  const tokens: StringToken[] = [];
  for (const section of findVueSections(source, "script")) {
    tokens.push(
      ...scanQuotedStringTokens(section.content).map((token) =>
        relocateToken(token, section.start, source)
      )
    );
  }
  for (const section of findVueSections(source, "template")) {
    tokens.push(
      ...scanVueTemplateExpressionTokens(section.content).map((token) =>
        relocateToken(token, section.start, source)
      )
    );
  }
  const unique = new Map<string, StringToken>();
  for (const token of tokens) {
    unique.set(`${token.start}:${token.end}:${token.value}`, token);
  }
  return [...unique.values()].sort((left, right) => left.start - right.start);
}

function findVueSections(
  source: string,
  tagName: "script" | "template"
): Array<{ start: number; content: string }> {
  const sections: Array<{ start: number; content: string }> = [];
  const openingPattern = new RegExp(`<${tagName}\\b[^>]*>`, "giu");
  const lowerSource = source.toLowerCase();
  let opening: RegExpExecArray | null;
  while ((opening = openingPattern.exec(source)) !== null) {
    const start = opening.index + opening[0].length;
    const end = lowerSource.indexOf(`</${tagName}>`, start);
    if (end < 0) break;
    sections.push({ start, content: source.slice(start, end) });
    openingPattern.lastIndex = end + tagName.length + 3;
  }
  return sections;
}

function scanVueTemplateExpressionTokens(template: string): StringToken[] {
  const withoutComments = replaceHtmlCommentsWithSpaces(template);
  const attributePattern =
    /(?:^|[\s<])(?:v-[A-Za-z0-9_.:-]+(?:\[[^\]\r\n"'<>]+\])?(?:\.[A-Za-z0-9_-]+)*|[:@#](?:[A-Za-z0-9_.:-]+|\[[^\]\r\n"'<>]+\])(?:\.[A-Za-z0-9_-]+)*)\s*=\s*(["'])/gu;
  const tokens: StringToken[] = [];
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(withoutComments)) !== null) {
    const quote = match[1];
    if (quote === undefined) continue;
    const openingQuote = match.index + match[0].lastIndexOf(quote);
    const closingQuote = findUnescapedQuote(
      withoutComments,
      openingQuote + 1,
      quote
    );
    if (closingQuote < 0) break;
    const expressionStart = openingQuote + 1;
    const expression = template.slice(expressionStart, closingQuote);
    tokens.push(
      ...scanQuotedStringTokens(expression).map((token) =>
        relocateToken(token, expressionStart, template)
      )
    );
    attributePattern.lastIndex = closingQuote + 1;
  }
  return tokens;
}

function replaceHtmlCommentsWithSpaces(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/gu, (comment) =>
    comment.replace(/[^\n]/gu, " ")
  );
}

function findUnescapedQuote(
  source: string,
  start: number,
  quote: string
): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] !== quote) continue;
    let backslashes = 0;
    for (
      let cursor = index - 1;
      cursor >= start && source[cursor] === "\\";
      cursor -= 1
    ) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return index;
  }
  return -1;
}

function relocateToken(
  token: StringToken,
  offset: number,
  completeSource: string
): StringToken {
  const start = offset + token.start;
  const end = offset + token.end;
  const before = completeSource.slice(0, start);
  const lastNewline = before.lastIndexOf("\n");
  return {
    ...token,
    line: countLines(before),
    column: start - lastNewline,
    start,
    end
  };
}

function countLines(source: string): number {
  let lines = 1;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") lines += 1;
  }
  return lines;
}

function makeRegistryLocator(
  registryModule: SourceModule,
  registryForm: RegistryForm
): z.infer<typeof registryLocatorSchema> {
  return {
    module_url: registryModule.javascript.metadata.url,
    module_sha256: registryModule.javascript.metadata.sha256,
    ...(registryForm.moduleName === `${registryForm.formId}.js`
      ? {}
      : { module_name: registryForm.moduleName }),
    form_path_line: registryForm.formPath.line,
    form_path_column: registryForm.formPath.column,
    dynamic_import_line: registryForm.dynamicImport.line,
    dynamic_import_column: registryForm.dynamicImport.column
  };
}

function toObservedFormId(aiName: string): string {
  const formId = aiName
    .replace(/([a-z])([0-9])/gu, "$1-$2")
    .replace(/([0-9])([a-z])/gu, "$1-$2")
    .replace(/_/gu, "-")
    .toLowerCase();
  if (!FORM_ID_PATTERN.test(formId)) {
    throw new SettingsSourceInventoryError("FAMILY_FORM_MAPPING_INVALID");
  }
  return formId;
}

function normalizeSettingsSourcePath(path: string): string | null {
  if (!looksLikeSettingsSourcePath(path)) return null;
  if (
    /[\\%\u0000-\u001f\u007f-\uffff]/u.test(path) ||
    path.includes("//")
  ) {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }

  let canonical: string | null = null;
  if (path.startsWith(SOURCE_MAP_CANONICAL_ROOT_PREFIX)) {
    canonical = path;
  } else if (path.startsWith(SOURCE_MAP_RELATIVE_ROOT_PREFIX)) {
    canonical = `/${path}`;
  } else if (path.startsWith(SOURCE_MAP_LEGACY_ROOT_PREFIX)) {
    canonical = `/src/${path.slice(SOURCE_MAP_LEGACY_ROOT_PREFIX.length)}`;
  }

  if (canonical === null) {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }

  const segments = canonical.slice(1).split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !SOURCE_PATH_SEGMENT_PATTERN.test(segment)
    )
  ) {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }
  if (!canonical.startsWith(SETTINGS_SOURCE_MARKER)) {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }
  if (!isCanonicalSettingsSourcePath(canonical)) {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }
  return canonical;
}

function looksLikeSettingsSourcePath(path: string): boolean {
  let candidate = path.normalize("NFKC");
  if (candidate.includes("%")) {
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      // The strict validation below rejects malformed escapes only when the
      // undecoded locator still points toward the settings directory.
    }
  }
  candidate = candidate.replace(/[\\\u2044\u2215\uff0f]/gu, "/");
  const marker = "components/chat/forms/";
  const markerIndex = candidate.toLowerCase().indexOf(marker);
  if (markerIndex < 0) return false;
  const nextSegment = candidate
    .slice(markerIndex + marker.length)
    .split("/", 1)[0]
    ?.toLowerCase();
  return nextSegment?.startsWith("settings") ?? false;
}

function isCanonicalSettingsSourcePath(path: string): boolean {
  if (
    !path.startsWith(SETTINGS_SOURCE_MARKER) ||
    /[\\%\u0000-\u001f\u007f-\uffff]/u.test(path) ||
    path.includes("//")
  ) {
    return false;
  }
  const relative = path.slice(SETTINGS_SOURCE_MARKER.length);
  return (
    relative.length > 0 &&
    relative
      .split("/")
      .every((segment) => SOURCE_PATH_SEGMENT_PATTERN.test(segment))
  );
}

function groupModelsByFamily(
  publicCatalog: SyntxPublicCatalogSnapshot
): Map<string, SyntxPublicCatalogSnapshot["models"]> {
  const mutable = new Map<
    string,
    Array<SyntxPublicCatalogSnapshot["models"][number]>
  >();
  for (const model of publicCatalog.models) {
    const group = mutable.get(model.ai_name) ?? [];
    group.push(model);
    mutable.set(model.ai_name, group);
  }
  return mutable as Map<string, SyntxPublicCatalogSnapshot["models"]>;
}

function deriveSummary(input: {
  publicAiFamilies: number;
  registryForms: number;
  familyForms: SettingsSourceInventory["family_forms"];
  unboundRegistryForms: SettingsSourceInventory["unbound_registry_forms"];
  legacyFamilies: string[];
  models: SettingsSourceInventory["models"];
  providerModules: SourceModule[];
  helperModules: SourceModule[];
  unpinnedDirectDependencies: string[];
  sourceArtifacts: SettingsSourceArtifact[];
}): SettingsSourceInventory["summary"] {
  return {
    public_ai_families: input.publicAiFamilies,
    registry_forms: input.registryForms,
    mapped_family_forms: input.familyForms.length,
    unbound_registry_forms: input.unboundRegistryForms.length,
    current_families_without_models: input.familyForms.filter(
      (entry) => entry.model_count === 0
    ).length,
    model_variants: input.models.length,
    literal_reference_evidence: input.models.filter(
      (entry) => entry.evidence_class === "LITERAL_REFERENCE_EVIDENCE"
    ).length,
    dynamic_family_form: input.models.filter(
      (entry) => entry.evidence_class === "DYNAMIC_FAMILY_FORM"
    ).length,
    legacy_inactive_no_form: input.models.filter(
      (entry) => entry.evidence_class === "LEGACY_INACTIVE_NO_FORM"
    ).length,
    legacy_families: input.legacyFamilies.length,
    provider_form_modules: input.providerModules.length,
    direct_settings_helper_modules: input.helperModules.length,
    unpinned_direct_dependencies: input.unpinnedDirectDependencies.length,
    source_artifacts: input.sourceArtifacts.length
  };
}

function validateInventoryRelationships(
  inventory: SettingsSourceInventory,
  context: z.RefinementCtx
): void {
  if (
    inventory.build.base_url !==
    `https://syntx.ai/assets/${inventory.build.id}/`
  ) {
    addCustomIssue(context, ["build"], "Build ID and base URL do not match.");
  }
  const artifactUrls = new Set<string>();
  const artifactsByUrl = new Map<string, SettingsSourceArtifact>();
  const moduleKinds = new Set<string>();
  const artifactsByModule = new Map<string, SettingsSourceArtifact[]>();
  const registryProviderModuleNames = new Set(
    [...inventory.family_forms, ...inventory.unbound_registry_forms]
      .map((entry) => entry.evidence.module_name)
      .filter((name): name is string => name !== undefined)
  );
  for (const [index, artifact] of inventory.source_artifacts.entries()) {
    const expectedBase = inventory.build.base_url;
    if (!artifact.url.startsWith(expectedBase)) {
      addCustomIssue(context, ["source_artifacts", index, "url"], "Artifact build mismatch.");
    }
    if (artifactUrls.has(artifact.url)) {
      addCustomIssue(context, ["source_artifacts", index, "url"], "Duplicate artifact URL.");
    }
    artifactUrls.add(artifact.url);
    artifactsByUrl.set(artifact.url, artifact);
    const moduleArtifacts = artifactsByModule.get(artifact.module_name) ?? [];
    moduleArtifacts.push(artifact);
    artifactsByModule.set(artifact.module_name, moduleArtifacts);
    const moduleKindKey = `${artifact.module_name}:${artifact.kind}`;
    if (moduleKinds.has(moduleKindKey)) {
      addCustomIssue(context, ["source_artifacts", index], "Duplicate module artifact kind.");
    }
    moduleKinds.add(moduleKindKey);
    if (
      (artifact.kind === "SOURCE_MAP_V3") !==
      (artifact.source_map !== null)
    ) {
      addCustomIssue(context, ["source_artifacts", index, "source_map"], "Source-map metadata mismatch.");
    }
    if (
      artifact.form_id !== null &&
      artifact.module_name !== `${artifact.form_id}.js` &&
      !registryProviderModuleNames.has(artifact.module_name)
    ) {
      addCustomIssue(context, ["source_artifacts", index, "form_id"], "Form module mismatch.");
    }
    if (
      (artifact.role === "PROVIDER_FORM") !== (artifact.form_id !== null) ||
      (artifact.role === "SETTINGS_REGISTRY" &&
        artifact.module_name !== "Settings2.js") ||
      (artifact.role !== "SETTINGS_REGISTRY" &&
        artifact.module_name === "Settings2.js")
    ) {
      addCustomIssue(context, ["source_artifacts", index], "Artifact role relationship is invalid.");
    }
    const expectedUrl = `${inventory.build.base_url}${artifact.module_name}${
      artifact.kind === "SOURCE_MAP_V3" ? ".map" : ""
    }`;
    if (artifact.url !== expectedUrl) {
      addCustomIssue(context, ["source_artifacts", index, "url"], "Artifact URL does not match its module.");
    }
    const allowedTypes =
      artifact.kind === "JAVASCRIPT"
        ? JAVASCRIPT_MEDIA_TYPES
        : SOURCE_MAP_MEDIA_TYPES;
    if (!allowedTypes.has(artifact.content_type)) {
      addCustomIssue(context, ["source_artifacts", index, "content_type"], "Artifact media type is invalid.");
    }
    if (
      artifact.role !== "SETTINGS_REGISTRY" &&
      artifact.kind === "SOURCE_MAP_V3" &&
      artifact.source_map?.settings_source_count === 0
    ) {
      addCustomIssue(context, ["source_artifacts", index, "source_map"], "Settings source map has no settings sources.");
    }
    if (
      artifact.role === "PROVIDER_FORM" &&
      artifact.kind === "SOURCE_MAP_V3" &&
      (artifact.form_id === null ||
        !artifact.source_map?.settings_sources.some(
          (source) =>
            source.source_path ===
            `${SETTINGS_SOURCE_MARKER}${artifact.form_id}.vue`
        ))
    ) {
      addCustomIssue(
        context,
        ["source_artifacts", index, "source_map"],
        "Provider source map does not contain its exact form source."
      );
    }
  }
  for (const [moduleName, artifacts] of artifactsByModule) {
    const javascript = artifacts.find((artifact) => artifact.kind === "JAVASCRIPT");
    const sourceMap = artifacts.find(
      (artifact) => artifact.kind === "SOURCE_MAP_V3"
    );
    if (
      artifacts.length !== 2 ||
      javascript === undefined ||
      sourceMap === undefined ||
      javascript.role !== sourceMap.role ||
      javascript.form_id !== sourceMap.form_id
    ) {
      addCustomIssue(context, ["source_artifacts"], `Module pair is invalid: ${moduleName}.`);
    }
  }

  const familyNames = new Set<string>();
  const mappedForms = new Set<string>();
  const familyFormByName = new Map<string, string>();
  for (const [index, entry] of inventory.family_forms.entries()) {
    if (familyNames.has(entry.ai_name)) {
      addCustomIssue(context, ["family_forms", index, "ai_name"], "Duplicate AI family.");
    }
    if (mappedForms.has(entry.form_id)) {
      addCustomIssue(context, ["family_forms", index, "form_id"], "Duplicate mapped form.");
    }
    familyNames.add(entry.ai_name);
    mappedForms.add(entry.form_id);
    familyFormByName.set(entry.ai_name, entry.form_id);
    let expectedFormId: string | undefined;
    try {
      expectedFormId = toObservedFormId(entry.ai_name);
    } catch {
      expectedFormId = undefined;
    }
    if (entry.form_id !== expectedFormId) {
      addCustomIssue(context, ["family_forms", index, "form_id"], "AI family does not map to its observed form ID.");
    }
    validateRegistryEvidence(
      entry.evidence,
      artifactsByUrl,
      context,
      ["family_forms", index, "evidence"]
    );
  }

  const unboundForms = new Set<string>();
  for (const [index, entry] of inventory.unbound_registry_forms.entries()) {
    if (mappedForms.has(entry.form_id) || unboundForms.has(entry.form_id)) {
      addCustomIssue(context, ["unbound_registry_forms", index, "form_id"], "Invalid unbound form.");
    }
    unboundForms.add(entry.form_id);
    validateRegistryEvidence(
      entry.evidence,
      artifactsByUrl,
      context,
      ["unbound_registry_forms", index, "evidence"]
    );
  }
  // New inventories record the exact registry import target. Verify that it
  // resolves to the provider pair carrying the same form_id. Older 1.0.0
  // snapshots omit module_name and retain their original validation path.
  for (const [index, entry] of [...inventory.family_forms, ...inventory.unbound_registry_forms].entries()) {
    const locator = entry.evidence;
    if (locator.module_name === undefined) continue;
    const provider = inventory.source_artifacts.find(
      (artifact) =>
        artifact.role === "PROVIDER_FORM" &&
        artifact.kind === "JAVASCRIPT" &&
        artifact.module_name === locator.module_name
    );
    if (provider === undefined || provider.form_id !== entry.form_id) {
      addCustomIssue(context, ["family_forms", index, "evidence", "module_name"], "Registry import target does not match its provider form.");
    }
  }
  const providerForms = new Set(
    inventory.source_artifacts
      .filter(
        (artifact) =>
          artifact.role === "PROVIDER_FORM" && artifact.kind === "JAVASCRIPT"
      )
      .map((artifact) => artifact.form_id)
      .filter((formId): formId is string => formId !== null)
  );
  if (
    providerForms.size !== mappedForms.size + unboundForms.size ||
    [...mappedForms, ...unboundForms].some((formId) => !providerForms.has(formId))
  ) {
    addCustomIssue(context, ["family_forms"], "Registry/provider form coverage mismatch.");
  }

  const legacyFamilies = new Set(inventory.legacy_families);
  const observedLegacyFamilies = new Set<string>();
  const modelIds = new Set<string>();
  for (const [index, model] of inventory.models.entries()) {
    if (modelIds.has(model.model_id)) {
      addCustomIssue(context, ["models", index, "model_id"], "Duplicate model ID.");
    }
    modelIds.add(model.model_id);
    const isLegacy = model.evidence_class === "LEGACY_INACTIVE_NO_FORM";
    if (isLegacy) observedLegacyFamilies.add(model.ai_name);
    if (
      isLegacy !== legacyFamilies.has(model.ai_name) ||
      (isLegacy && (model.active || model.form_id !== null || model.evidence.length > 0)) ||
      (!isLegacy &&
        (!familyNames.has(model.ai_name) ||
          model.form_id === null ||
          model.form_id !== familyFormByName.get(model.ai_name) ||
          legacyFamilies.has(model.ai_name))) ||
      ((model.evidence_class === "LITERAL_REFERENCE_EVIDENCE") !==
        (model.evidence.length > 0))
    ) {
      addCustomIssue(context, ["models", index], "Model evidence relationship is invalid.");
    }
    for (const [evidenceIndex, evidence] of model.evidence.entries()) {
      const javascript = artifactsByUrl.get(evidence.module_url);
      const sourceMap = artifactsByUrl.get(evidence.source_map_url);
      if (
        javascript === undefined ||
        sourceMap === undefined ||
        javascript.kind !== "JAVASCRIPT" ||
        sourceMap.kind !== "SOURCE_MAP_V3" ||
        javascript.module_name !== sourceMap.module_name ||
        javascript.sha256 !== evidence.module_sha256 ||
        sourceMap.sha256 !== evidence.source_map_sha256 ||
        sourceMap.source_map === null ||
        evidence.source_index >= sourceMap.source_map.source_count ||
        !isCanonicalSettingsSourcePath(evidence.source_path) ||
        !sourceMap.source_map.settings_sources.some(
          (source) =>
            source.source_index === evidence.source_index &&
            source.source_path === evidence.source_path &&
            source.source_content_sha256 === evidence.source_content_sha256
        )
      ) {
        addCustomIssue(
          context,
          ["models", index, "evidence", evidenceIndex],
          "Evidence artifact is not in the manifest."
        );
      }
    }
  }
  if (
    observedLegacyFamilies.size !== legacyFamilies.size ||
    [...legacyFamilies].some((family) => !observedLegacyFamilies.has(family))
  ) {
    addCustomIssue(context, ["legacy_families"], "Legacy family coverage mismatch.");
  }
  for (const [index, family] of inventory.family_forms.entries()) {
    const observedCount = inventory.models.filter(
      (model) => model.ai_name === family.ai_name
    ).length;
    if (family.model_count !== observedCount) {
      addCustomIssue(context, ["family_forms", index, "model_count"], "Family model count mismatch.");
    }
  }
  const storedModuleNames = new Set(artifactsByModule.keys());
  if (
    inventory.closure.unpinned_direct_dependencies.some((moduleName) =>
      storedModuleNames.has(moduleName)
    )
  ) {
    addCustomIssue(context, ["closure", "unpinned_direct_dependencies"], "Pinned module is listed as unpinned.");
  }

  const derivedSummary = deriveSummary({
    publicAiFamilies: inventory.family_forms.length,
    registryForms:
      inventory.family_forms.length + inventory.unbound_registry_forms.length,
    familyForms: inventory.family_forms,
    unboundRegistryForms: inventory.unbound_registry_forms,
    legacyFamilies: inventory.legacy_families,
    models: inventory.models,
    providerModules: Array.from({ length: providerForms.size }) as SourceModule[],
    helperModules: Array.from({
      length: new Set(
        inventory.source_artifacts
          .filter(
            (artifact) =>
              artifact.role === "DIRECT_SETTINGS_HELPER" &&
              artifact.kind === "JAVASCRIPT"
          )
          .map((artifact) => artifact.module_name)
      ).size
    }) as SourceModule[],
    unpinnedDirectDependencies: inventory.closure.unpinned_direct_dependencies,
    sourceArtifacts: inventory.source_artifacts
  });
  if (JSON.stringify(derivedSummary) !== JSON.stringify(inventory.summary)) {
    addCustomIssue(context, ["summary"], "Summary does not match inventory arrays.");
  }
}

function validateRegistryEvidence(
  evidence: z.infer<typeof registryLocatorSchema>,
  artifactsByUrl: ReadonlyMap<string, SettingsSourceArtifact>,
  context: z.RefinementCtx,
  path: PropertyKey[]
): void {
  const artifact = artifactsByUrl.get(evidence.module_url);
  if (
    artifact === undefined ||
    artifact.kind !== "JAVASCRIPT" ||
    artifact.role !== "SETTINGS_REGISTRY" ||
    artifact.sha256 !== evidence.module_sha256
  ) {
    addCustomIssue(context, path, "Registry evidence does not match the manifest.");
  }
}

function addCustomIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

function addDuplicateStringIssues(
  values: string[],
  context: z.RefinementCtx
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: "Duplicate value."
      });
    }
    seen.add(value);
  }
}

function assertNoDuplicateStrings(values: string[], expectedSize: number): void {
  if (new Set(values).size !== expectedSize) {
    throw new SettingsSourceInventoryError("FAMILY_FORM_MAPPING_INVALID");
  }
}

function appendToMap<Value>(
  map: Map<string, Value[]>,
  key: string,
  value: Value
): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

async function mapWithConcurrency<Input, Output>(
  input: readonly Input[],
  concurrency: number,
  operation: (value: Input) => Promise<Output>
): Promise<Output[]> {
  const output = new Array<Output>(input.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, input.length) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= input.length) return;
        output[index] = await operation(input[index]!);
      }
    }
  );
  await Promise.all(workers);
  return output;
}

class AbsoluteDeadline {
  readonly #controller = new AbortController();
  readonly #timeout: ReturnType<typeof setTimeout>;
  readonly #expired: Promise<never>;

  constructor(milliseconds: number) {
    let expire: (reason: Error) => void = () => undefined;
    this.#expired = new Promise((_, reject) => {
      expire = reject;
    });
    this.#timeout = setTimeout(() => {
      this.#controller.abort();
      expire(new Error("deadline"));
    }, milliseconds);
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  async waitFor<T>(operation: Promise<T>): Promise<T> {
    void operation.catch(() => undefined);
    return Promise.race([operation, this.#expired]);
  }

  close(): void {
    clearTimeout(this.#timeout);
    this.#controller.abort();
  }
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body === null) return;
  void body.cancel().catch(() => undefined);
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void reader.cancel().catch(() => undefined);
}

function compareArtifacts(
  left: SettingsSourceArtifact,
  right: SettingsSourceArtifact
): number {
  return compareText(
    `${left.role}:${left.module_name}:${left.kind}`,
    `${right.role}:${right.module_name}:${right.kind}`
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isBoundedInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function findDefaultInventoryPath(): string {
  const candidates = [
    fileURLToPath(
      new URL(
        "../../catalog/runtime/v1/settings-source-inventory.json",
        import.meta.url
      )
    ),
    fileURLToPath(
      new URL(
        "../../../catalog/runtime/v1/settings-source-inventory.json",
        import.meta.url
      )
    )
  ];
  const match = candidates.find((candidate) => existsSync(candidate));
  if (match === undefined) {
    throw new Error("Settings source inventory snapshot was not found.");
  }
  return match;
}
