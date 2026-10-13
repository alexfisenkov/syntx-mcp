import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import {
  assertNormalizedSettingsParserCanaryMatchesSources,
  loadNormalizedSettingsParserCanary,
  normalizedSettingsParserCanarySchema,
  serializeNormalizedSettingsParserCanary,
  type NormalizedSettingsParserCanary,
} from "./normalized-settings-parser-canary.js";
import {
  assertNormalizedSettingsParserCensusManifestMatchesSources,
  loadNormalizedSettingsParserCensusManifest,
  normalizedSettingsParserCensusManifestSchema,
  serializeNormalizedSettingsParserCensusManifest,
  type NormalizedSettingsParserCensusManifest,
} from "./normalized-settings-parser-census-manifest.js";
import {
  loadSettingsSourceInventory,
  settingsSourceInventorySchema,
  type SettingsSourceInventory,
} from "./settings-source-inventory.js";
import {
  loadSyntxPublicCatalogSnapshot,
  sha256CanonicalPayload,
  syntxPublicCatalogSnapshotSchema,
  type SyntxPublicCatalogSnapshot,
} from "./syntx-public-catalog.js";

const BANANA_FORM_ID = "banana" as const;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_REF_ID_PATTERN = /^settings-source-[a-f0-9]{64}$/u;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SAFE_COMPONENT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,79}$/u;
const MAX_IMPLEMENTATION_COMPONENT_BYTES = 16 * 1024 * 1024;
const MAX_IMPLEMENTATION_SET_BYTES = 32 * 1024 * 1024;

export const SOURCE_BACKED_C1A_CHECKPOINT = Object.freeze({
  censusArtifactBytes: 428_390,
  censusArtifactSha256:
    "sha256:611196c4245adf1a4d7860cc1ad183192dc074ececd538bdbf99b65efe5bad06",
  censusCohortSha256:
    "sha256:8c8b4bc02272e3fddd3d11dcc24cb903b66a3ff13848c2ea4085b852d7b8e959",
  publicCatalogSha256:
    "sha256:0353e9e078bd53f4d5ca4748151408cbd163fdc93d21b6ff977511f086a4c9d0",
  sourceInventorySha256:
    "sha256:ef0664760b57870c49e3d6d6261f695bbbd1168ef964ee93e7109c1222c4af74",
  parserArtifactBytes: 16_600,
  parserArtifactSha256:
    "sha256:018cda7ac6a4baf31988a62e18020a24b9055baa2c5d67298218794d7c2ffdda",
  normalizedCompilerSha256:
    "sha256:d053c0cf41c8263cc1f34e794cd7dcb6e1f883dede08d6508c769c703307fe3a",
  sourceRefId:
    "settings-source-ff759f253b2f9344caca2a7590276fb14274b8f3cca06ea3fa4f934cbf69b793",
  typescriptVersion: "5.9.3",
});

export const SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES = [
  "banana-parser-adapter",
  "immutable-json-snapshot",
  "normalized-source-backed-result",
  "pinned-settings-source-loader",
  "source-backed-result-toolchain",
  "static-settings-compiler",
  "typescript-runtime",
] as const;

const SOURCE_BACKED_LIMITATIONS = [
  "DECLARED_SUBSET_ONLY_NOT_FULL_COHORT",
  "FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT",
  "PINNED_BUILD_MATCH_IS_NOT_ACTIVE_BUILD_DISCOVERY",
  "PAYLOAD_AND_BACKEND_EQUIVALENCE_UNVERIFIED",
  "NO_GENERATION_OR_AUTH_CALLS_PERFORMED",
] as const;

export type NormalizedSettingsParserSourceBackedResultErrorCode =
  | "SOURCE_BACKED_RESULT_DRIFT_DETECTED"
  | "SOURCE_BACKED_RESULT_INVALID"
  | "SOURCE_RELATIONSHIP_INVALID"
  | "SOURCE_VALIDATION_FAILED"
  | "IMPLEMENTATION_RELATIONSHIP_INVALID";

export class NormalizedSettingsParserSourceBackedResultError extends Error {
  constructor(
    readonly code: NormalizedSettingsParserSourceBackedResultErrorCode,
  ) {
    super(
      "SYNTX normalized settings source-backed result could not be processed safely.",
    );
    this.name = "NormalizedSettingsParserSourceBackedResultError";
  }
}

const sha256Schema = z.string().regex(SHA256_PATTERN);
const sourceRefIdSchema = z.string().regex(SOURCE_REF_ID_PATTERN);
const positiveIntegerSchema = z.number().int().positive();
const utcTimestampSchema = z
  .string()
  .regex(UTC_TIMESTAMP_PATTERN)
  .refine((value) => isCanonicalUtcTimestamp(value), {
    message: "Expected a valid UTC timestamp.",
  });

const parserSummarySchema = z
  .object({
    scoped_models: z.literal(4),
    compiled_forms: z.literal(1),
    partial_forms: z.literal(1),
    partial_models: z.literal(4),
    proven_projections: z.literal(0),
    absent_proven_projections: z.literal(0),
    blocked_projections: z.literal(6),
    blocked_projections_with_static_candidates: z.literal(2),
    form_blockers: z.literal(17),
    model_blockers: z.literal(4),
    runtime_usable_models: z.literal(0),
  })
  .strict();

const implementationComponentSchema = z
  .object({
    name: z.string().regex(SAFE_COMPONENT_NAME_PATTERN),
    bytes: positiveIntegerSchema.max(MAX_IMPLEMENTATION_COMPONENT_BYTES),
    sha256: sha256Schema,
  })
  .strict();

const engineSchema = z
  .object({
    name: z.literal("typescript"),
    version: z.literal(SOURCE_BACKED_C1A_CHECKPOINT.typescriptVersion),
    normalized_compiler_sha256: z.literal(
      SOURCE_BACKED_C1A_CHECKPOINT.normalizedCompilerSha256,
    ),
    execution_mode: z.literal("SYNTAX_ONLY_NO_VENDOR_EXECUTION"),
    type_checking: z.literal(false),
    emit: z.literal(false),
    import_resolution: z.literal(false),
  })
  .strict();

const sourceVerificationRecordSchema = z
  .object({
    source_ref_id: sourceRefIdSchema,
    fetched_artifacts: z.literal(2),
    verification_status: z.literal("JS_MAP_AND_SOURCE_HASH_MATCHED"),
    compilation_input: z.literal(true),
  })
  .strict();

const sourceBackedResultSchemaBase = z
  .object({
    schema_version: z.literal("3.0.0"),
    catalog_kind: z.literal(
      "OBSERVED_NORMALIZED_SETTINGS_IR_SOURCE_BACKED_RESULT",
    ),
    evidence_level: z.literal("STATIC_PINNED_SOURCE_COMPILATION"),
    runtime_usable: z.literal(false),
    generated_at: utcTimestampSchema,
    source_observed_at: utcTimestampSchema,
    bindings: z
      .object({
        census_manifest: z
          .object({
            schema_version: z.literal("2.0.0"),
            catalog_kind: z.literal(
              "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CENSUS_MANIFEST",
            ),
            artifact_bytes: z.literal(
              SOURCE_BACKED_C1A_CHECKPOINT.censusArtifactBytes,
            ),
            artifact_sha256: z.literal(
              SOURCE_BACKED_C1A_CHECKPOINT.censusArtifactSha256,
            ),
            generated_at: utcTimestampSchema,
            cohort_sha256: z.literal(
              SOURCE_BACKED_C1A_CHECKPOINT.censusCohortSha256,
            ),
            public_catalog_sha256: z.literal(
              SOURCE_BACKED_C1A_CHECKPOINT.publicCatalogSha256,
            ),
            source_inventory_sha256: z.literal(
              SOURCE_BACKED_C1A_CHECKPOINT.sourceInventorySha256,
            ),
          })
          .strict(),
        parser_result: z
          .object({
            schema_version: z.literal("1.1.0"),
            catalog_kind: z.literal(
              "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CANARY",
            ),
            artifact_bytes: z.literal(
              SOURCE_BACKED_C1A_CHECKPOINT.parserArtifactBytes,
            ),
            artifact_sha256: z.literal(
              SOURCE_BACKED_C1A_CHECKPOINT.parserArtifactSha256,
            ),
            generated_at: utcTimestampSchema,
            compilation_status: z.literal("PARTIAL_COMPILED"),
          })
          .strict(),
      })
      .strict(),
    scope: z
      .object({
        kind: z.literal("EXACT_C0_FORM_MODEL_SOURCE_SUBSET"),
        closure_policy: z.literal("C0_FORM_ROOTS_WITH_NO_AUXILIARIES_V1"),
        full_cohort: z.literal(false),
        form_ids: z.tuple([z.literal(BANANA_FORM_ID)]),
        model_ids: z.tuple([
          z.literal("banana"),
          z.literal("banana2"),
          z.literal("banana3"),
          z.literal("banana3_light"),
        ]),
        source_ref_ids: z.tuple([
          z.literal(SOURCE_BACKED_C1A_CHECKPOINT.sourceRefId),
        ]),
      })
      .strict(),
    source_verification: z
      .object({
        status: z.literal("PINNED_SOURCE_BYTES_REFETCHED_AND_MATCHED"),
        sources: z.tuple([sourceVerificationRecordSchema]),
        vendor_source_persisted: z.literal(false),
      })
      .strict(),
    toolchain: z
      .object({
        parser_profile: z.literal("STATIC_SETTINGS_V1"),
        compilation_status: z.literal("PARTIAL_COMPILED"),
        engine: engineSchema,
        implementation_hash_algorithm: z.literal(
          "FRAMED_COMPONENT_BYTES_SHA256_V1",
        ),
        implementation_components: z
          .array(implementationComponentSchema)
          .length(SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES.length),
        implementation_set_sha256: sha256Schema,
        vendor_code_executed: z.literal(false),
      })
      .strict(),
    result: z
      .object({
        verification_status: z.literal(
          "EXACT_RECOMPILED_PARSER_ARTIFACT_MATCH",
        ),
        parser_artifact_sha256: sha256Schema,
        summary: parserSummarySchema,
      })
      .strict(),
    coverage: z
      .object({
        c0_forms: z.literal(42),
        declared_forms: z.literal(1),
        unscoped_c0_forms: z.literal(41),
        c0_models: z.literal(192),
        declared_models: z.literal(4),
        unscoped_c0_models: z.literal(188),
        c0_source_refs: z.literal(123),
        declared_source_refs: z.literal(1),
        verified_source_refs: z.literal(1),
        compiled_source_units: z.literal(1),
        unscoped_c0_source_refs: z.literal(122),
        c0_current_mapped_provider_source_refs: z.literal(76),
        declared_current_mapped_provider_source_refs: z.literal(1),
        c0_deferred_source_refs: z.literal(47),
        declared_deferred_source_refs: z.literal(0),
        compiled_forms: z.literal(1),
        partial_forms: z.literal(1),
        partial_models: z.literal(4),
        proven_projections: z.literal(0),
        absent_proven_projections: z.literal(0),
        blocked_projections: z.literal(6),
        blocked_projections_with_static_candidates: z.literal(2),
        form_blockers: z.literal(17),
        model_blockers: z.literal(4),
        runtime_usable_models: z.literal(0),
      })
      .strict(),
    limitations: z.tuple([
      z.literal(SOURCE_BACKED_LIMITATIONS[0]),
      z.literal(SOURCE_BACKED_LIMITATIONS[1]),
      z.literal(SOURCE_BACKED_LIMITATIONS[2]),
      z.literal(SOURCE_BACKED_LIMITATIONS[3]),
      z.literal(SOURCE_BACKED_LIMITATIONS[4]),
    ]),
  })
  .strict();

export const normalizedSettingsParserSourceBackedResultSchema =
  sourceBackedResultSchemaBase.superRefine((result, context) => {
    addInternalIssues(result, context);
  });

export type NormalizedSettingsParserSourceBackedResult = z.infer<
  typeof normalizedSettingsParserSourceBackedResultSchema
>;

export interface SourceBackedImplementationComponentInput {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface LoadNormalizedSettingsParserSourceBackedResultOptions {
  readonly path?: string;
  readonly publicCatalog?: SyntxPublicCatalogSnapshot;
  readonly inventory?: SettingsSourceInventory;
  readonly censusManifest?: NormalizedSettingsParserCensusManifest;
  readonly censusArtifactText?: string;
  readonly parserCanary?: NormalizedSettingsParserCanary;
  readonly parserArtifactText?: string;
}

function isCanonicalUtcTimestamp(value: string): boolean {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

export function loadNormalizedSettingsParserSourceBackedResult(
  options: LoadNormalizedSettingsParserSourceBackedResultOptions = {},
): NormalizedSettingsParserSourceBackedResult {
  let raw: unknown;
  try {
    raw = JSON.parse(
      readFileSync(options.path ?? findDefaultResultPath(), "utf8"),
    );
  } catch {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "SOURCE_BACKED_RESULT_INVALID",
    );
  }
  const result = parseSourceBackedResult(raw);
  const sources = loadValidationSources(options);
  assertNormalizedSettingsParserSourceBackedResultMatchesSources(
    result,
    sources,
  );
  return result;
}

export function serializeNormalizedSettingsParserSourceBackedResult(
  result: NormalizedSettingsParserSourceBackedResult,
  sources: SourceBackedResultValidationSources,
): string {
  const parsed = parseSourceBackedResult(result);
  assertNormalizedSettingsParserSourceBackedResultMatchesSources(
    parsed,
    sources,
  );
  return serializeResultShape(parsed);
}

export function assertNormalizedSettingsParserSourceBackedResultUnchanged(
  recorded: NormalizedSettingsParserSourceBackedResult,
  observed: NormalizedSettingsParserSourceBackedResult,
): void {
  if (serializeResultShape(recorded) !== serializeResultShape(observed)) {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "SOURCE_BACKED_RESULT_DRIFT_DETECTED",
    );
  }
}

export interface SourceBackedResultValidationSources {
  readonly publicCatalog: SyntxPublicCatalogSnapshot;
  readonly inventory: SettingsSourceInventory;
  readonly censusManifest: NormalizedSettingsParserCensusManifest;
  readonly censusArtifactText: string;
  readonly parserCanary: NormalizedSettingsParserCanary;
  readonly parserArtifactText: string;
}

export function assertNormalizedSettingsParserSourceBackedResultMatchesSources(
  resultInput: NormalizedSettingsParserSourceBackedResult,
  sourcesInput: SourceBackedResultValidationSources,
): void {
  const result = parseSourceBackedResult(resultInput);
  const sources = validateExternalSources(sourcesInput);
  const form = requireBananaCensusForm(sources.censusManifest);
  const sourceIdentity = requireBananaSourceIdentity(
    sources.censusManifest,
    form.root_source_ref_id,
  );
  const parserForm = sources.parserCanary.forms[0];

  const expectedCensusHash = sha256Text(sources.censusArtifactText);
  const expectedParserHash = sha256Text(sources.parserArtifactText);
  if (
    result.bindings.census_manifest.artifact_bytes !==
      Buffer.byteLength(sources.censusArtifactText, "utf8") ||
    result.bindings.census_manifest.artifact_sha256 !== expectedCensusHash ||
    result.bindings.census_manifest.generated_at !==
      sources.censusManifest.generated_at ||
    result.bindings.census_manifest.cohort_sha256 !==
      sources.censusManifest.cohort.canonical_sha256 ||
    result.bindings.census_manifest.public_catalog_sha256 !==
      sha256CanonicalPayload(sources.publicCatalog) ||
    result.bindings.census_manifest.source_inventory_sha256 !==
      sha256CanonicalPayload(sources.inventory) ||
    result.bindings.parser_result.artifact_bytes !==
      Buffer.byteLength(sources.parserArtifactText, "utf8") ||
    result.bindings.parser_result.artifact_sha256 !== expectedParserHash ||
    result.bindings.parser_result.generated_at !==
      sources.parserCanary.generated_at ||
    result.result.parser_artifact_sha256 !== expectedParserHash ||
    serializeComparable(result.result.summary) !==
      serializeComparable(sources.parserCanary.summary) ||
    serializeComparable(result.scope.form_ids) !==
      serializeComparable([BANANA_FORM_ID]) ||
    serializeComparable(result.scope.model_ids) !==
      serializeComparable(form.model_ids) ||
    serializeComparable(result.scope.source_ref_ids) !==
      serializeComparable([form.root_source_ref_id]) ||
    result.source_verification.sources[0].source_ref_id !==
      form.root_source_ref_id ||
    result.toolchain.engine.normalized_compiler_sha256 !==
      sources.parserCanary.compiler.engine.implementation_sha256 ||
    result.toolchain.engine.version !==
      sources.parserCanary.compiler.engine.version ||
    parserForm.form_id !== form.form_id ||
    parserForm.source_ref.provider_javascript_sha256 !==
      sourceIdentity.module_javascript_sha256 ||
    parserForm.source_ref.provider_source_map_sha256 !==
      sourceIdentity.module_source_map_sha256 ||
    parserForm.source_ref.source_index !== sourceIdentity.source_index ||
    parserForm.source_ref.source_path !== sourceIdentity.source_path ||
    parserForm.source_ref.source_content_sha256 !==
      sourceIdentity.source_content_sha256
  ) {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "SOURCE_RELATIONSHIP_INVALID",
    );
  }

  const expectedCoverage = buildExpectedCoverage(
    sources.censusManifest,
    sources.parserCanary,
  );
  if (
    serializeComparable(result.coverage) !==
    serializeComparable(expectedCoverage)
  ) {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "SOURCE_RELATIONSHIP_INVALID",
    );
  }
}

export function assertNormalizedSettingsParserSourceBackedResultMatchesImplementations(
  resultInput: NormalizedSettingsParserSourceBackedResult,
  implementationComponents: readonly SourceBackedImplementationComponentInput[],
): void {
  const result = parseSourceBackedResult(resultInput);
  const expected = buildImplementationComponents(implementationComponents);
  const normalizedCompilerSha256 = hashFramedComponents([
    {
      name: "adapter",
      bytes: requireComponentBytes(
        implementationComponents,
        "banana-parser-adapter",
      ),
    },
    {
      name: "static-compiler",
      bytes: requireComponentBytes(
        implementationComponents,
        "static-settings-compiler",
      ),
    },
  ]);
  if (
    serializeComparable(result.toolchain.implementation_components) !==
      serializeComparable(expected) ||
    result.toolchain.implementation_set_sha256 !==
      sha256CanonicalPayload(expected) ||
    normalizedCompilerSha256 !==
      result.toolchain.engine.normalized_compiler_sha256 ||
    normalizedCompilerSha256 !==
      SOURCE_BACKED_C1A_CHECKPOINT.normalizedCompilerSha256
  ) {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "IMPLEMENTATION_RELATIONSHIP_INVALID",
    );
  }
}

function validateExternalSources(
  input: SourceBackedResultValidationSources,
): SourceBackedResultValidationSources {
  let publicCatalog: SyntxPublicCatalogSnapshot;
  let inventory: SettingsSourceInventory;
  let censusManifest: NormalizedSettingsParserCensusManifest;
  let parserCanary: NormalizedSettingsParserCanary;
  try {
    publicCatalog = syntxPublicCatalogSnapshotSchema.parse(input.publicCatalog);
    inventory = settingsSourceInventorySchema.parse(input.inventory);
    censusManifest = normalizedSettingsParserCensusManifestSchema.parse(
      input.censusManifest,
    );
    parserCanary = normalizedSettingsParserCanarySchema.parse(
      input.parserCanary,
    );
  } catch {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "SOURCE_VALIDATION_FAILED",
    );
  }
  if (
    typeof input.censusArtifactText !== "string" ||
    typeof input.parserArtifactText !== "string"
  ) {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "SOURCE_VALIDATION_FAILED",
    );
  }
  try {
    assertNormalizedSettingsParserCensusManifestMatchesSources(
      censusManifest,
      publicCatalog,
      inventory,
    );
    assertNormalizedSettingsParserCanaryMatchesSources(
      parserCanary,
      publicCatalog,
      inventory,
    );
    if (
      serializeNormalizedSettingsParserCensusManifest(
        censusManifest,
        publicCatalog,
        inventory,
      ) !== input.censusArtifactText ||
      serializeNormalizedSettingsParserCanary(
        parserCanary,
        publicCatalog,
        inventory,
      ) !== input.parserArtifactText
    ) {
      throw new Error("canonical artifact mismatch");
    }
  } catch {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "SOURCE_RELATIONSHIP_INVALID",
    );
  }
  return {
    publicCatalog,
    inventory,
    censusManifest,
    censusArtifactText: input.censusArtifactText,
    parserCanary,
    parserArtifactText: input.parserArtifactText,
  };
}

function requireBananaCensusForm(
  census: NormalizedSettingsParserCensusManifest,
): NormalizedSettingsParserCensusManifest["forms"][number] {
  const matches = census.forms.filter(
    (form) => form.form_id === BANANA_FORM_ID,
  );
  const form = matches[0];
  if (
    matches.length !== 1 ||
    form === undefined ||
    form.auxiliary_source_ref_ids.length !== 0 ||
    serializeComparable(form.model_ids) !==
      serializeComparable(["banana", "banana2", "banana3", "banana3_light"])
  ) {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "SOURCE_RELATIONSHIP_INVALID",
    );
  }
  return form;
}

function requireBananaSourceIdentity(
  census: NormalizedSettingsParserCensusManifest,
  sourceRefId: string,
): NormalizedSettingsParserCensusManifest["source_identities"][number] {
  const matches = census.source_identities.filter(
    (identity) => identity.source_ref_id === sourceRefId,
  );
  const identity = matches[0];
  if (
    matches.length !== 1 ||
    identity === undefined ||
    identity.role !== "PROVIDER_FORM" ||
    identity.form_id !== BANANA_FORM_ID ||
    identity.source_kind !== "VUE_SFC" ||
    identity.disposition !==
      "PINNED_IN_INVENTORY_CURRENT_MODEL_BEARING_FORM_ROOT" ||
    !census.compile_boundary.current_mapped_provider_source_ref_ids.includes(
      sourceRefId,
    )
  ) {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "SOURCE_RELATIONSHIP_INVALID",
    );
  }
  return identity;
}

function buildImplementationComponents(
  inputs: readonly SourceBackedImplementationComponentInput[],
): Array<{ name: string; bytes: number; sha256: string }> {
  if (
    !Array.isArray(inputs) ||
    inputs.length !== SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES.length
  ) {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "IMPLEMENTATION_RELATIONSHIP_INVALID",
    );
  }
  let totalBytes = 0;
  const components = inputs.map((input, index) => {
    const expectedName = SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES[index];
    if (
      expectedName === undefined ||
      !isPlainRecord(input) ||
      input.name !== expectedName ||
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength < 1 ||
      input.bytes.byteLength > MAX_IMPLEMENTATION_COMPONENT_BYTES
    ) {
      throw new NormalizedSettingsParserSourceBackedResultError(
        "IMPLEMENTATION_RELATIONSHIP_INVALID",
      );
    }
    totalBytes += input.bytes.byteLength;
    return {
      name: expectedName,
      bytes: input.bytes.byteLength,
      sha256: sha256Bytes(input.bytes),
    };
  });
  if (totalBytes > MAX_IMPLEMENTATION_SET_BYTES) {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "IMPLEMENTATION_RELATIONSHIP_INVALID",
    );
  }
  return components;
}

function requireComponentBytes(
  inputs: readonly SourceBackedImplementationComponentInput[],
  name: (typeof SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES)[number],
): Uint8Array {
  const matches = inputs.filter((input) => input.name === name);
  const bytes = matches[0]?.bytes;
  if (matches.length !== 1 || !(bytes instanceof Uint8Array)) {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "IMPLEMENTATION_RELATIONSHIP_INVALID",
    );
  }
  return bytes;
}

function hashFramedComponents(
  components: readonly { readonly name: string; readonly bytes: Uint8Array }[],
): string {
  const hash = createHash("sha256");
  for (const component of components) {
    hash.update(`${component.name}\0${component.bytes.byteLength}\0`, "utf8");
    hash.update(component.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function buildExpectedCoverage(
  census: NormalizedSettingsParserCensusManifest,
  parserCanary: NormalizedSettingsParserCanary,
): NormalizedSettingsParserSourceBackedResult["coverage"] {
  const expected = {
    c0_forms: 42,
    declared_forms: 1,
    unscoped_c0_forms: 41,
    c0_models: 192,
    declared_models: 4,
    unscoped_c0_models: 188,
    c0_source_refs: 123,
    declared_source_refs: 1,
    verified_source_refs: 1,
    compiled_source_units: 1,
    unscoped_c0_source_refs: 122,
    c0_current_mapped_provider_source_refs: 76,
    declared_current_mapped_provider_source_refs: 1,
    c0_deferred_source_refs: 47,
    declared_deferred_source_refs: 0,
    compiled_forms: 1,
    partial_forms: 1,
    partial_models: 4,
    proven_projections: 0,
    absent_proven_projections: 0,
    blocked_projections: 6,
    blocked_projections_with_static_candidates: 2,
    form_blockers: 17,
    model_blockers: 4,
    runtime_usable_models: 0,
  } as const;
  const observed = {
    c0_forms: census.summary.current_forms,
    declared_forms: 1,
    unscoped_c0_forms: census.summary.current_forms - 1,
    c0_models: census.summary.model_variants,
    declared_models: 4,
    unscoped_c0_models: census.summary.model_variants - 4,
    c0_source_refs: census.summary.source_refs,
    declared_source_refs: 1,
    verified_source_refs: 1,
    compiled_source_units: 1,
    unscoped_c0_source_refs: census.summary.source_refs - 1,
    c0_current_mapped_provider_source_refs:
      census.summary.current_mapped_provider_source_refs,
    declared_current_mapped_provider_source_refs: 1,
    c0_deferred_source_refs: census.summary.deferred_source_refs,
    declared_deferred_source_refs: 0,
    compiled_forms: parserCanary.summary.compiled_forms,
    partial_forms: parserCanary.summary.partial_forms,
    partial_models: parserCanary.summary.partial_models,
    proven_projections: parserCanary.summary.proven_projections,
    absent_proven_projections: parserCanary.summary.absent_proven_projections,
    blocked_projections: parserCanary.summary.blocked_projections,
    blocked_projections_with_static_candidates:
      parserCanary.summary.blocked_projections_with_static_candidates,
    form_blockers: parserCanary.summary.form_blockers,
    model_blockers: parserCanary.summary.model_blockers,
    runtime_usable_models: parserCanary.summary.runtime_usable_models,
  };
  if (serializeComparable(observed) !== serializeComparable(expected)) {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "SOURCE_RELATIONSHIP_INVALID",
    );
  }
  return expected;
}

function addInternalIssues(
  result: z.infer<typeof sourceBackedResultSchemaBase>,
  context: z.RefinementCtx,
): void {
  const names = result.toolchain.implementation_components.map(
    (component) => component.name,
  );
  if (
    serializeComparable(names) !==
    serializeComparable(SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES)
  ) {
    context.addIssue({
      code: "custom",
      path: ["toolchain", "implementation_components"],
      message: "Implementation components must be exact and canonical.",
    });
  }
  if (
    result.toolchain.implementation_set_sha256 !==
    sha256CanonicalPayload(result.toolchain.implementation_components)
  ) {
    context.addIssue({
      code: "custom",
      path: ["toolchain", "implementation_set_sha256"],
      message: "Implementation set hash does not match component metadata.",
    });
  }
  const implementationBytes = result.toolchain.implementation_components.reduce(
    (total, component) => total + component.bytes,
    0,
  );
  if (implementationBytes > MAX_IMPLEMENTATION_SET_BYTES) {
    context.addIssue({
      code: "custom",
      path: ["toolchain", "implementation_components"],
      message: "Implementation component bytes exceed the aggregate limit.",
    });
  }
  if (
    Date.parse(result.source_observed_at) <
      Date.parse(result.bindings.census_manifest.generated_at ?? "") ||
    Date.parse(result.source_observed_at) <
      Date.parse(result.bindings.parser_result.generated_at ?? "") ||
    Date.parse(result.generated_at) < Date.parse(result.source_observed_at) ||
    result.bindings.parser_result.artifact_sha256 !==
      result.result.parser_artifact_sha256 ||
    result.scope.source_ref_ids[0] !==
      result.source_verification.sources[0].source_ref_id ||
    result.coverage.unscoped_c0_forms !== result.coverage.c0_forms - 1 ||
    result.coverage.unscoped_c0_models !== result.coverage.c0_models - 4 ||
    result.coverage.unscoped_c0_source_refs !==
      result.coverage.c0_source_refs - 1 ||
    result.coverage.c0_current_mapped_provider_source_refs +
      result.coverage.c0_deferred_source_refs !==
      result.coverage.c0_source_refs
  ) {
    context.addIssue({
      code: "custom",
      message: "Source-backed result relationships are inconsistent.",
    });
  }
}

function parseSourceBackedResult(
  value: unknown,
): NormalizedSettingsParserSourceBackedResult {
  const parsed =
    normalizedSettingsParserSourceBackedResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new NormalizedSettingsParserSourceBackedResultError(
      "SOURCE_BACKED_RESULT_INVALID",
    );
  }
  return parsed.data;
}

function loadValidationSources(
  options: LoadNormalizedSettingsParserSourceBackedResultOptions,
): SourceBackedResultValidationSources {
  const publicCatalog =
    options.publicCatalog ?? loadSyntxPublicCatalogSnapshot();
  const inventory =
    options.inventory ?? loadSettingsSourceInventory(undefined, publicCatalog);
  const censusManifest =
    options.censusManifest ??
    loadNormalizedSettingsParserCensusManifest({ publicCatalog, inventory });
  const parserCanary =
    options.parserCanary ??
    loadNormalizedSettingsParserCanary({ publicCatalog, inventory });
  return {
    publicCatalog,
    inventory,
    censusManifest,
    censusArtifactText:
      options.censusArtifactText ??
      readFileSync(findDefaultCensusArtifactPath(), "utf8"),
    parserCanary,
    parserArtifactText:
      options.parserArtifactText ??
      readFileSync(findDefaultParserArtifactPath(), "utf8"),
  };
}

function findDefaultResultPath(): string {
  return findProjectArtifactPath(
    "catalog/runtime/v3/normalized-settings-parser-source-backed-result.json",
  );
}

function findDefaultCensusArtifactPath(): string {
  return findProjectArtifactPath(
    "catalog/runtime/v2/normalized-settings-parser-census-manifest.json",
  );
}

function findDefaultParserArtifactPath(): string {
  return findProjectArtifactPath(
    "catalog/runtime/v1/normalized-settings-parser-canary.json",
  );
}

function findProjectArtifactPath(relativePath: string): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDirectory, "../../../", relativePath),
    join(moduleDirectory, "../../", relativePath),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ?? candidates[0]!;
}

function serializeResultShape(
  result: NormalizedSettingsParserSourceBackedResult,
): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sha256Bytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function serializeComparable(value: unknown): string {
  return JSON.stringify(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
