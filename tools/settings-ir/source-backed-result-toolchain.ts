import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  assertNormalizedSettingsParserCanaryUnchanged,
  buildNormalizedSettingsParserCanary,
  assertNormalizedSettingsParserCanaryMatchesSources,
  normalizedSettingsParserCanarySchema,
  serializeNormalizedSettingsParserCanary,
  type NormalizedSettingsParserCanary,
} from "../../src/catalog/normalized-settings-parser-canary.js";
import {
  assertNormalizedSettingsParserCensusManifestMatchesSources,
  normalizedSettingsParserCensusManifestSchema,
  serializeNormalizedSettingsParserCensusManifest,
  type NormalizedSettingsParserCensusManifest,
} from "../../src/catalog/normalized-settings-parser-census-manifest.js";
import {
  normalizedSettingsParserSourceBackedResultSchema,
  SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES,
  SOURCE_BACKED_C1A_CHECKPOINT,
  type NormalizedSettingsParserSourceBackedResult,
  type SourceBackedImplementationComponentInput,
} from "../../src/catalog/normalized-settings-parser-source-backed-result.js";
import {
  sha256CanonicalPayload,
  syntxPublicCatalogSnapshotSchema,
  type SyntxPublicCatalogSnapshot,
} from "../../src/catalog/syntx-public-catalog.js";
import {
  settingsSourceInventorySchema,
  type SettingsSourceInventory,
} from "../../src/catalog/settings-source-inventory.js";
import { buildBananaParserCanaryCompilerOutput } from "./build-banana-parser-canary.js";
import { fetchPinnedSettingsFormSourceMaterial } from "./pinned-settings-source-loader.js";

const FORM_ID = "banana" as const;

export type SourceBackedResultToolchainErrorCode =
  "SOURCE_BACKED_TOOLCHAIN_INVALID" | "SOURCE_BACKED_TOOLCHAIN_READ_FAILED";

export class SourceBackedResultToolchainError extends Error {
  constructor(readonly code: SourceBackedResultToolchainErrorCode) {
    super("SYNTX source-backed result toolchain request was rejected.");
    this.name = "SourceBackedResultToolchainError";
  }
}

export interface BuildBananaSourceBackedResultInput {
  readonly publicCatalog: SyntxPublicCatalogSnapshot;
  readonly inventory: SettingsSourceInventory;
  readonly censusManifest: NormalizedSettingsParserCensusManifest;
  readonly censusArtifactText: string;
  readonly parserArtifactText: string;
  /** Set only by the orchestrator immediately after verified source fetch. */
  readonly sourceObservedAt?: string;
  /** Set only after fresh compilation has finished. */
  readonly generatedAt?: string;
  readonly fetchImpl?: typeof fetch;
  readonly absoluteTimeoutMs?: number;
  readonly maxJavaScriptBytes?: number;
  readonly maxSourceMapBytes?: number;
}

interface ValidatedLocalInputs {
  readonly publicCatalog: SyntxPublicCatalogSnapshot;
  readonly inventory: SettingsSourceInventory;
  readonly censusManifest: NormalizedSettingsParserCensusManifest;
  readonly censusArtifactText: string;
  readonly parserArtifactText: string;
  readonly parserCanary: NormalizedSettingsParserCanary;
}

/** Verifies only the local implementation-byte/compiler-pair relationship. */
function assertImplementationPreflight(
  parserCanary: NormalizedSettingsParserCanary,
): void {
  const components = collectSourceBackedImplementationComponents();
  const compilerHash = framedHash([
    {
      name: "adapter",
      bytes: requireBytes(components, "banana-parser-adapter"),
    },
    {
      name: "static-compiler",
      bytes: requireBytes(components, "static-settings-compiler"),
    },
  ]);
  if (
    compilerHash !== parserCanary.compiler.engine.implementation_sha256 ||
    compilerHash !== SOURCE_BACKED_C1A_CHECKPOINT.normalizedCompilerSha256
  ) {
    throw new SourceBackedResultToolchainError(
      "SOURCE_BACKED_TOOLCHAIN_INVALID",
    );
  }
}

/** Full no-network preflight for the exact C1a local checkpoint. */
export function assertSourceBackedLocalPreflight(
  input: BuildBananaSourceBackedResultInput,
): void {
  assertBuildInputShape(input);
  void validateFullLocalPreflight(input);
}

function validateFullLocalPreflight(
  input: BuildBananaSourceBackedResultInput,
): ValidatedLocalInputs {
  try {
    const publicCatalog = syntxPublicCatalogSnapshotSchema.parse(
      input.publicCatalog,
    );
    const inventory = settingsSourceInventorySchema.parse(input.inventory);
    const censusManifest = normalizedSettingsParserCensusManifestSchema.parse(
      input.censusManifest,
    );
    if (
      typeof input.censusArtifactText !== "string" ||
      typeof input.parserArtifactText !== "string"
    )
      throw new Error();
    const parserCanary = normalizedSettingsParserCanarySchema.parse(
      JSON.parse(input.parserArtifactText),
    );
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
      Buffer.byteLength(input.censusArtifactText, "utf8") !==
        SOURCE_BACKED_C1A_CHECKPOINT.censusArtifactBytes ||
      sha256Text(input.censusArtifactText) !==
        SOURCE_BACKED_C1A_CHECKPOINT.censusArtifactSha256 ||
      censusManifest.cohort.canonical_sha256 !==
        SOURCE_BACKED_C1A_CHECKPOINT.censusCohortSha256 ||
      sha256CanonicalPayload(publicCatalog) !==
        SOURCE_BACKED_C1A_CHECKPOINT.publicCatalogSha256 ||
      sha256CanonicalPayload(inventory) !==
        SOURCE_BACKED_C1A_CHECKPOINT.sourceInventorySha256 ||
      Buffer.byteLength(input.parserArtifactText, "utf8") !==
        SOURCE_BACKED_C1A_CHECKPOINT.parserArtifactBytes ||
      sha256Text(input.parserArtifactText) !==
        SOURCE_BACKED_C1A_CHECKPOINT.parserArtifactSha256 ||
      serializeNormalizedSettingsParserCensusManifest(
        censusManifest,
        publicCatalog,
        inventory,
      ) !== input.censusArtifactText ||
      serializeNormalizedSettingsParserCanary(
        parserCanary,
        publicCatalog,
        inventory,
      ) !== input.parserArtifactText ||
      !isCanonicalUtc(censusManifest.generated_at) ||
      !isCanonicalUtc(parserCanary.generated_at)
    )
      throw new Error();
    validateLoaderOptions(
      input,
      censusManifest.generated_at,
      parserCanary.generated_at,
    );
    assertImplementationPreflight(parserCanary);
    return {
      publicCatalog,
      inventory,
      censusManifest,
      censusArtifactText: input.censusArtifactText,
      parserArtifactText: input.parserArtifactText,
      parserCanary,
    };
  } catch {
    throw new SourceBackedResultToolchainError(
      "SOURCE_BACKED_TOOLCHAIN_INVALID",
    );
  }
}

/**
 * Performs exactly one bounded pinned Banana JS/map fetch, keeps the verified
 * Vue source in memory, recompiles all four exact model contexts, and requires
 * the canonical compiler result to match the recorded Gate B parser artifact.
 * It never writes an artifact and never retries a failed request. Default
 * source time is captured immediately after the verified loader returns;
 * overrides exist only for immutable check-source comparison after a fresh
 * fetch and compilation still occur.
 */
export async function buildBananaSourceBackedResultFromPinnedSource(
  input: BuildBananaSourceBackedResultInput,
): Promise<NormalizedSettingsParserSourceBackedResult> {
  assertBuildInputShape(input);
  const local = validateFullLocalPreflight(input);
  const material = await fetchPinnedSettingsFormSourceMaterial(
    local.inventory,
    FORM_ID,
    {
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
      ...(input.absoluteTimeoutMs === undefined
        ? {}
        : { absoluteTimeoutMs: input.absoluteTimeoutMs }),
      ...(input.maxJavaScriptBytes === undefined
        ? {}
        : { maxJavaScriptBytes: input.maxJavaScriptBytes }),
      ...(input.maxSourceMapBytes === undefined
        ? {}
        : { maxSourceMapBytes: input.maxSourceMapBytes }),
    },
  );

  const sourceObservedAt = input.sourceObservedAt ?? new Date().toISOString();
  const compilerOutput = buildBananaParserCanaryCompilerOutput({
    source: material.source.content,
    sourceRef: {
      provider_javascript_sha256: material.artifacts.javascript.sha256,
      provider_source_map_sha256: material.artifacts.source_map.sha256,
      source_index: material.source.source_index,
      source_path: material.source.source_path,
      source_content_sha256: material.source.source_content_sha256,
    },
  });
  const parserCanary: NormalizedSettingsParserCanary =
    buildNormalizedSettingsParserCanary({
      publicCatalog: local.publicCatalog,
      inventory: local.inventory,
      compilerOutput,
    });
  assertFreshParserCanaryMatchesRecorded(local.parserCanary, parserCanary);

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  return constructSourceBackedResultAfterVerifiedCompilation({
    publicCatalog: local.publicCatalog,
    inventory: local.inventory,
    censusManifest: local.censusManifest,
    censusArtifactText: local.censusArtifactText,
    parserCanary,
    parserArtifactText: local.parserArtifactText,
    sourceObservedAt,
    generatedAt,
    implementationComponents: collectSourceBackedImplementationComponents(),
  });
}

function assertFreshParserCanaryMatchesRecorded(
  recorded: NormalizedSettingsParserCanary,
  fresh: NormalizedSettingsParserCanary,
): void {
  try {
    assertNormalizedSettingsParserCanaryUnchanged(recorded, fresh);
  } catch {
    throw new SourceBackedResultToolchainError(
      "SOURCE_BACKED_TOOLCHAIN_INVALID",
    );
  }
}

export function __testOnlyAssertFreshParserCanaryMatchesRecorded(
  recorded: NormalizedSettingsParserCanary,
  fresh: NormalizedSettingsParserCanary,
): void {
  assertFreshParserCanaryMatchesRecorded(recorded, fresh);
}

/** Private construction boundary: only called after the pinned loader returned. */
function constructSourceBackedResultAfterVerifiedCompilation(input: {
  publicCatalog: SyntxPublicCatalogSnapshot;
  inventory: SettingsSourceInventory;
  censusManifest: NormalizedSettingsParserCensusManifest;
  censusArtifactText: string;
  parserCanary: NormalizedSettingsParserCanary;
  parserArtifactText: string;
  sourceObservedAt: string;
  generatedAt: string;
  implementationComponents: readonly SourceBackedImplementationComponentInput[];
}): NormalizedSettingsParserSourceBackedResult {
  const components = input.implementationComponents.map((component) => ({
    name: component.name,
    bytes: component.bytes.byteLength,
    sha256: sha256Bytes(component.bytes),
  }));
  const form = input.censusManifest.forms.find(
    (entry) => entry.form_id === FORM_ID,
  );
  if (form === undefined || form.auxiliary_source_ref_ids.length !== 0) {
    throw new SourceBackedResultToolchainError(
      "SOURCE_BACKED_TOOLCHAIN_INVALID",
    );
  }
  const compilerHash = framedHash([
    {
      name: "adapter",
      bytes: requireBytes(
        input.implementationComponents,
        "banana-parser-adapter",
      ),
    },
    {
      name: "static-compiler",
      bytes: requireBytes(
        input.implementationComponents,
        "static-settings-compiler",
      ),
    },
  ]);
  if (
    compilerHash !== input.parserCanary.compiler.engine.implementation_sha256 ||
    compilerHash !== SOURCE_BACKED_C1A_CHECKPOINT.normalizedCompilerSha256
  ) {
    throw new SourceBackedResultToolchainError(
      "SOURCE_BACKED_TOOLCHAIN_INVALID",
    );
  }
  const parsed = normalizedSettingsParserSourceBackedResultSchema.safeParse({
    schema_version: "3.0.0",
    catalog_kind: "OBSERVED_NORMALIZED_SETTINGS_IR_SOURCE_BACKED_RESULT",
    evidence_level: "STATIC_PINNED_SOURCE_COMPILATION",
    runtime_usable: false,
    source_observed_at: input.sourceObservedAt,
    generated_at: input.generatedAt,
    bindings: {
      census_manifest: {
        schema_version: "2.0.0",
        catalog_kind: "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CENSUS_MANIFEST",
        artifact_bytes: Buffer.byteLength(input.censusArtifactText, "utf8"),
        artifact_sha256: sha256Text(input.censusArtifactText),
        generated_at: input.censusManifest.generated_at,
        cohort_sha256: input.censusManifest.cohort.canonical_sha256,
        public_catalog_sha256: sha256CanonicalPayload(input.publicCatalog),
        source_inventory_sha256: sha256CanonicalPayload(input.inventory),
      },
      parser_result: {
        schema_version: "1.1.0",
        catalog_kind: "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CANARY",
        artifact_bytes: Buffer.byteLength(input.parserArtifactText, "utf8"),
        artifact_sha256: sha256Text(input.parserArtifactText),
        generated_at: input.parserCanary.generated_at,
        compilation_status: "PARTIAL_COMPILED",
      },
    },
    scope: {
      kind: "EXACT_C0_FORM_MODEL_SOURCE_SUBSET",
      closure_policy: "C0_FORM_ROOTS_WITH_NO_AUXILIARIES_V1",
      full_cohort: false,
      form_ids: [FORM_ID],
      model_ids: [...form.model_ids],
      source_ref_ids: [form.root_source_ref_id],
    },
    source_verification: {
      status: "PINNED_SOURCE_BYTES_REFETCHED_AND_MATCHED",
      sources: [
        {
          source_ref_id: form.root_source_ref_id,
          fetched_artifacts: 2,
          verification_status: "JS_MAP_AND_SOURCE_HASH_MATCHED",
          compilation_input: true,
        },
      ],
      vendor_source_persisted: false,
    },
    toolchain: {
      parser_profile: "STATIC_SETTINGS_V1",
      compilation_status: "PARTIAL_COMPILED",
      engine: {
        name: "typescript",
        version: input.parserCanary.compiler.engine.version,
        normalized_compiler_sha256: compilerHash,
        execution_mode: "SYNTAX_ONLY_NO_VENDOR_EXECUTION",
        type_checking: false,
        emit: false,
        import_resolution: false,
      },
      implementation_hash_algorithm: "FRAMED_COMPONENT_BYTES_SHA256_V1",
      implementation_components: components,
      implementation_set_sha256: sha256CanonicalPayload(components),
      vendor_code_executed: false,
    },
    result: {
      verification_status: "EXACT_RECOMPILED_PARSER_ARTIFACT_MATCH",
      parser_artifact_sha256: sha256Text(input.parserArtifactText),
      summary: input.parserCanary.summary,
    },
    coverage: {
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
    },
    limitations: [
      "DECLARED_SUBSET_ONLY_NOT_FULL_COHORT",
      "FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT",
      "PINNED_BUILD_MATCH_IS_NOT_ACTIVE_BUILD_DISCOVERY",
      "PAYLOAD_AND_BACKEND_EQUIVALENCE_UNVERIFIED",
      "NO_GENERATION_OR_AUTH_CALLS_PERFORMED",
    ],
  });
  if (!parsed.success) {
    throw new SourceBackedResultToolchainError(
      "SOURCE_BACKED_TOOLCHAIN_INVALID",
    );
  }
  return parsed.data;
}

function requireBytes(
  inputs: readonly SourceBackedImplementationComponentInput[],
  name: string,
): Uint8Array {
  const matches = inputs.filter((entry) => entry.name === name);
  if (matches.length !== 1 || !(matches[0]?.bytes instanceof Uint8Array))
    throw new SourceBackedResultToolchainError(
      "SOURCE_BACKED_TOOLCHAIN_INVALID",
    );
  return matches[0].bytes;
}

function framedHash(
  parts: readonly { name: string; bytes: Uint8Array }[],
): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(`${part.name}\0${part.bytes.byteLength}\0`, "utf8");
    hash.update(part.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function sha256Bytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function collectSourceBackedImplementationComponents(): readonly SourceBackedImplementationComponentInput[] {
  const require = createRequire(import.meta.url);
  let typescriptRuntimePath: string;
  try {
    typescriptRuntimePath = require.resolve("typescript");
  } catch {
    throw new SourceBackedResultToolchainError(
      "SOURCE_BACKED_TOOLCHAIN_READ_FAILED",
    );
  }

  const componentUrls = [
    new URL("./build-banana-parser-canary.js", import.meta.url),
    new URL("./immutable-json-snapshot.js", import.meta.url),
    new URL(
      "../../src/catalog/normalized-settings-parser-source-backed-result.js",
      import.meta.url,
    ),
    new URL("./pinned-settings-source-loader.js", import.meta.url),
    new URL(import.meta.url),
    new URL("./static-settings-compiler.js", import.meta.url),
    pathToFileURL(typescriptRuntimePath),
  ] as const;

  return SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES.map((name, index) => {
    const url = componentUrls[index];
    if (url === undefined) {
      throw new SourceBackedResultToolchainError(
        "SOURCE_BACKED_TOOLCHAIN_READ_FAILED",
      );
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(url);
    } catch {
      throw new SourceBackedResultToolchainError(
        "SOURCE_BACKED_TOOLCHAIN_READ_FAILED",
      );
    }
    return { name, bytes };
  });
}

function assertBuildInputShape(
  input: unknown,
): asserts input is BuildBananaSourceBackedResultInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SourceBackedResultToolchainError(
      "SOURCE_BACKED_TOOLCHAIN_INVALID",
    );
  }
}

function isCanonicalUtc(value: string): boolean {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function validateLoaderOptions(
  input: BuildBananaSourceBackedResultInput,
  censusGeneratedAt: string,
  parserGeneratedAt: string,
): void {
  if (
    (input.fetchImpl !== undefined && typeof input.fetchImpl !== "function") ||
    !isPositiveBound(input.absoluteTimeoutMs, 120_000) ||
    !isPositiveBound(input.maxJavaScriptBytes, 16 * 1024 * 1024) ||
    !isPositiveBound(input.maxSourceMapBytes, 32 * 1024 * 1024) ||
    !validOptionalTimestampPair(
      input.sourceObservedAt,
      input.generatedAt,
      censusGeneratedAt,
      parserGeneratedAt,
    )
  ) {
    throw new SourceBackedResultToolchainError(
      "SOURCE_BACKED_TOOLCHAIN_INVALID",
    );
  }
}

function validOptionalTimestampPair(
  sourceObservedAt: string | undefined,
  generatedAt: string | undefined,
  censusGeneratedAt?: string,
  parserGeneratedAt?: string,
): boolean {
  if (sourceObservedAt === undefined && generatedAt === undefined) return true;
  if (
    sourceObservedAt === undefined ||
    generatedAt === undefined ||
    !isCanonicalUtc(sourceObservedAt) ||
    !isCanonicalUtc(generatedAt)
  )
    return false;
  return (
    (censusGeneratedAt === undefined ||
      Date.parse(censusGeneratedAt) <= Date.parse(sourceObservedAt)) &&
    (parserGeneratedAt === undefined ||
      Date.parse(parserGeneratedAt) <= Date.parse(sourceObservedAt)) &&
    Date.parse(sourceObservedAt) <= Date.parse(generatedAt)
  );
}

function isPositiveBound(value: number | undefined, maximum: number): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && value >= 1 && value <= maximum)
  );
}
