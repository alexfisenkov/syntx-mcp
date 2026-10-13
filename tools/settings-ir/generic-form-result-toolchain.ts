// Constructs one generic Gate C1b result artifact for one real catalog
// form: census manifest → deriveGenericFormAdapterInputFromManifest (step
// 2) → one bounded pinned-source fetch → buildGenericFormParserCanaryCompilerOutput
// (step 1) → envelope validated by normalizedSettingsParserGenericFormResultSchema
// (step 3/4). Lives here, not in src/catalog/, because it imports the
// generic adapter and the derive layer — both excluded from the npm
// package that src/catalog/ ships in (D-042, docs/проект/решения.md).
//
// Mirrors source-backed-result-toolchain.ts's
// buildBananaSourceBackedResultFromPinnedSource: never writes an artifact,
// never retries a failed request, does exactly one bounded fetch. Reachable
// today only from this module's own tests — not wired into any CLI/npm
// script yet (that is a separate future step, mirroring
// scripts/sync-normalized-settings-parser-source-backed-result.mjs, which
// owns the actual --confirm-source-fetch flag parsing and the create-once
// write via immutable-json-snapshot.ts). This function's own
// confirmedSourceFetch parameter is a second, independent gate — not a
// replacement for that CLI's — because DEBT-019a already established in
// this project that an exported network-capable function must not rely
// solely on a caller's argv gating to stay closed.
//
// The envelope-construction step (assembleGenericFormResult below) is
// factored out as a pure, network-free function deliberately: every
// BLOCK-level bug found in this module's first review round (a missing
// required summary field, a mis-ordered implementation-component list, a
// checkout-path-dependent hash) lived entirely in that step, and none of
// them were reachable by this file's first test suite because every test
// stopped before or at the network call. This split makes that step
// directly testable with zero network mocking.
//
// DEBT-036 resolved by D-045: the derive layer
// (generic-form-adapter-input-from-manifest.ts) materially affects this
// artifact's content (which model_ids/root_source_ref_id get scoped in),
// so it is now one of the 8 names in GENERIC_IMPLEMENTATION_COMPONENT_NAMES
// and hash-bound in buildImplementationComponentRecords() below.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertNormalizedSettingsParserCensusManifestMatchesSources,
  loadNormalizedSettingsParserCensusManifest,
  serializeNormalizedSettingsParserCensusManifest,
  type NormalizedSettingsParserCensusManifest
} from "../../src/catalog/normalized-settings-parser-census-manifest.js";
import {
  GENERIC_IMPLEMENTATION_COMPONENT_NAMES,
  normalizedSettingsParserGenericFormResultSchema,
  type NormalizedSettingsParserGenericFormResult
} from "../../src/catalog/normalized-settings-parser-generic-form-result.js";
import {
  loadSettingsSourceInventory,
  settingsSourceInventorySchema,
  type SettingsSourceInventory
} from "../../src/catalog/settings-source-inventory.js";
import {
  loadSyntxPublicCatalogSnapshot,
  sha256CanonicalPayload,
  syntxPublicCatalogSnapshotSchema,
  type SyntxPublicCatalogSnapshot
} from "../../src/catalog/syntx-public-catalog.js";
import {
  buildGenericFormParserCanaryCompilerOutput,
  type GenericFormParserCompilerOutput
} from "./build-generic-form-parser-canary.js";
import {
  deriveGenericFormAdapterInputFromManifest,
  type GenericFormAdapterManifestDerivedInput
} from "./generic-form-adapter-input-from-manifest.js";
import { fetchPinnedSettingsFormSourceMaterial } from "./pinned-settings-source-loader.js";

export type GenericFormResultToolchainErrorCode =
  | "GENERIC_TOOLCHAIN_INVALID_INPUT_SHAPE"
  | "GENERIC_TOOLCHAIN_SOURCE_FETCH_NOT_CONFIRMED"
  | "GENERIC_TOOLCHAIN_AUXILIARY_REFS_NOT_SUPPORTED"
  | "GENERIC_TOOLCHAIN_CENSUS_MANIFEST_MISMATCH"
  | "GENERIC_TOOLCHAIN_FETCHED_SOURCE_MISMATCH"
  | "GENERIC_TOOLCHAIN_RESULT_INVALID"
  | "GENERIC_TOOLCHAIN_READ_FAILED";

export class GenericFormResultToolchainError extends Error {
  constructor(
    readonly code: GenericFormResultToolchainErrorCode,
    readonly formId?: string,
    options?: { cause?: unknown }
  ) {
    super(
      `SYNTX generic form result toolchain request was rejected${
        formId === undefined ? "" : ` (form_id: ${formId})`
      }.`,
      options
    );
    this.name = "GenericFormResultToolchainError";
  }
}

export interface BuildGenericFormResultFromPinnedSourceInput {
  readonly formId: string;
  /** Set only by a caller that has independently confirmed network intent. */
  readonly confirmedSourceFetch: boolean;
  readonly publicCatalog?: SyntxPublicCatalogSnapshot;
  readonly inventory?: SettingsSourceInventory;
  readonly censusManifest?: NormalizedSettingsParserCensusManifest;
  /** Raw census artifact text — needed for bindings.census_manifest's own
   * artifact_bytes/artifact_sha256, which hash the file's bytes, not a
   * canonical payload of the parsed object. */
  readonly censusArtifactText?: string;
  readonly sourceObservedAt?: string;
  readonly generatedAt?: string;
  readonly fetchImpl?: typeof fetch;
  readonly absoluteTimeoutMs?: number;
  readonly maxJavaScriptBytes?: number;
  readonly maxSourceMapBytes?: number;
}

/**
 * Performs exactly one bounded pinned-source fetch for one real catalog
 * form, compiles it through the generic adapter, and returns a validated
 * (but not yet persisted) NormalizedSettingsParserGenericFormResult.
 */
export async function buildGenericFormResultFromPinnedSource(
  input: BuildGenericFormResultFromPinnedSourceInput
): Promise<NormalizedSettingsParserGenericFormResult> {
  assertBuildInputShape(input);
  if (input.confirmedSourceFetch !== true) {
    throw new GenericFormResultToolchainError(
      "GENERIC_TOOLCHAIN_SOURCE_FETCH_NOT_CONFIRMED",
      input.formId
    );
  }

  let publicCatalog: SyntxPublicCatalogSnapshot;
  let inventory: SettingsSourceInventory;
  try {
    publicCatalog = input.publicCatalog ?? loadSyntxPublicCatalogSnapshot();
    inventory =
      input.inventory ?? loadSettingsSourceInventory(undefined, publicCatalog);
  } catch (error) {
    throw new GenericFormResultToolchainError(
      "GENERIC_TOOLCHAIN_READ_FAILED",
      input.formId,
      { cause: error }
    );
  }

  let censusManifest: NormalizedSettingsParserCensusManifest;
  const censusArtifactText =
    input.censusArtifactText ?? readDefaultCensusArtifactText();
  // Ties all four census-adjacent inputs together explicitly, even when
  // censusManifest comes from the default loader below (which already does
  // this internally, via loadNormalizedSettingsParserCensusManifest) — a
  // caller-supplied censusManifest must be held to the exact same bar, and
  // nothing else ever checked that censusArtifactText's bytes actually
  // serialize the SAME manifest object (critic-code, Gate C1b step 5 round
  // 1 — the gap Banana's own validateFullLocalPreflight closes for its
  // path but this file did not). The default-load failure path and this
  // explicit cross-check are deliberately the SAME catch and the SAME error
  // code now (round 2 finding: they used to be split, so a caller-supplied
  // publicCatalog/inventory pair that merely disagreed with each other —
  // not a file-read problem at all — surfaced as GENERIC_TOOLCHAIN_READ_FAILED
  // with its cause silently dropped, instead of GENERIC_TOOLCHAIN_CENSUS_MANIFEST_MISMATCH
  // with the real error attached).
  try {
    censusManifest =
      input.censusManifest ??
      loadNormalizedSettingsParserCensusManifest({ publicCatalog, inventory });
    assertNormalizedSettingsParserCensusManifestMatchesSources(
      censusManifest,
      publicCatalog,
      inventory
    );
    if (
      serializeNormalizedSettingsParserCensusManifest(
        censusManifest,
        publicCatalog,
        inventory
      ) !== censusArtifactText
    ) {
      throw new Error("census artifact text does not serialize the census manifest");
    }
  } catch (error) {
    throw new GenericFormResultToolchainError(
      "GENERIC_TOOLCHAIN_CENSUS_MANIFEST_MISMATCH",
      input.formId,
      { cause: error }
    );
  }

  const derived = deriveGenericFormAdapterInputFromManifest(
    censusManifest,
    input.formId
  );
  // Checked BEFORE the network fetch below, deliberately: the adapter
  // itself also rejects non-empty auxiliary refs, but only after
  // compiling — paying for a gated fetch just to learn that is wasted
  // (documented requirement from generic-form-adapter-input-from-manifest.ts).
  if (derived.adapterInput.auxiliarySourceRefIds.length !== 0) {
    throw new GenericFormResultToolchainError(
      "GENERIC_TOOLCHAIN_AUXILIARY_REFS_NOT_SUPPORTED",
      input.formId
    );
  }

  // Timestamp overrides are validated before the network call — a caller
  // that passes them at all (e.g. an immutable check-source
  // re-verification against an already-published artifact) gets a fast,
  // typed rejection instead of paying for a fetch that a stale/malformed
  // pair would only fail after (mirrors source-backed-result-toolchain.ts's
  // validateLoaderOptions). Neither override is required: when both are
  // omitted, the defaults below capture real timestamps at the right
  // moment instead.
  validateOptionalTimestampPair(
    input.sourceObservedAt,
    input.generatedAt,
    censusManifest.generated_at
  );

  const material = await fetchPinnedSettingsFormSourceMaterial(
    inventory,
    input.formId,
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
        : { maxSourceMapBytes: input.maxSourceMapBytes })
    }
  );
  // Captured immediately after the verified loader returns, not before the
  // fetch — matches source-backed-result-toolchain.ts's documented timing.
  // A default captured before the fetch would systematically record a
  // moment earlier than when the source was actually observed.
  const sourceObservedAt = input.sourceObservedAt ?? new Date().toISOString();

  // The manifest-derived sourceRef is a PINNED/DECLARED expectation, not
  // itself proof of anything about what was just fetched (documented in
  // generic-form-adapter-input-from-manifest.ts's header) — this is the
  // actual verification step that closes that gap, field by field, not
  // just the content hash the adapter itself re-checks.
  const pinned = derived.adapterInput.sourceRef;
  const mismatches = {
    provider_javascript_sha256:
      material.artifacts.javascript.sha256 !== pinned.provider_javascript_sha256,
    provider_source_map_sha256:
      material.artifacts.source_map.sha256 !== pinned.provider_source_map_sha256,
    source_index: material.source.source_index !== pinned.source_index,
    source_path: material.source.source_path !== pinned.source_path,
    source_content_sha256:
      material.source.source_content_sha256 !== pinned.source_content_sha256
  };
  if (Object.values(mismatches).some(Boolean)) {
    // The mismatch flags name which field(s) diverged without carrying the
    // actual hash values into the error (critic-code: an opaque mismatch
    // across 5 fields is unnecessarily hard to diagnose across many forms).
    throw new GenericFormResultToolchainError(
      "GENERIC_TOOLCHAIN_FETCHED_SOURCE_MISMATCH",
      input.formId,
      { cause: mismatches }
    );
  }

  const compiled = buildGenericFormParserCanaryCompilerOutput({
    ...derived.adapterInput,
    source: material.source.content
  });
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  // Computed exactly once and reused below — calling this twice (as this
  // file's first draft did) reads 8 files, including the TypeScript
  // runtime, redundantly, and opens a window where implementation_components
  // and implementation_set_sha256 could silently diverge if a file changed
  // between the two calls (critic-code).
  const implementationComponents = buildImplementationComponentRecords();

  return assembleGenericFormResult({
    compiled,
    derived,
    censusManifest,
    censusArtifactText,
    publicCatalog,
    inventory,
    sourceObservedAt,
    generatedAt,
    implementationComponents
  });
}

interface GenericImplementationComponentRecord {
  name: (typeof GENERIC_IMPLEMENTATION_COMPONENT_NAMES)[number];
  bytes: number;
  sha256: string;
}

export interface AssembleGenericFormResultInput {
  readonly compiled: GenericFormParserCompilerOutput;
  readonly derived: GenericFormAdapterManifestDerivedInput;
  readonly censusManifest: NormalizedSettingsParserCensusManifest;
  readonly censusArtifactText: string;
  readonly publicCatalog: SyntxPublicCatalogSnapshot;
  readonly inventory: SettingsSourceInventory;
  readonly sourceObservedAt: string;
  readonly generatedAt: string;
  readonly implementationComponents: readonly GenericImplementationComponentRecord[];
}

/**
 * Pure envelope construction: assembles and validates the full result
 * object from already-verified pieces. Never touches the network, reads no
 * file, and never throws for a reason unrelated to its own inputs — the
 * only production caller (buildGenericFormResultFromPinnedSource above)
 * calls this strictly AFTER its own fetch and hash verification succeed,
 * but nothing here requires that ordering. That separation exists
 * specifically so this step — where every BLOCK-level bug in this module's
 * first review round actually lived (a missing required summary field, a
 * mis-ordered implementation-component list, a checkout-path-dependent
 * hash) — is directly testable without mocking a network call at all.
 */
export function assembleGenericFormResult(
  input: AssembleGenericFormResultInput
): NormalizedSettingsParserGenericFormResult {
  const compiledForm = input.compiled.forms[0];
  const summary = summarizeCompiledForm(compiledForm);
  const formIsPartial =
    compiledForm.blockers.length > 0 ||
    Object.values(compiledForm.projections).some(
      (projection) => projection.status === "BLOCKED"
    );

  const candidate = {
    schema_version: "1.0.0",
    catalog_kind: "OBSERVED_NORMALIZED_SETTINGS_IR_GENERIC_FORM_RESULT",
    evidence_level: "STATIC_PINNED_SOURCE_COMPILATION",
    runtime_usable: false,
    generated_at: input.generatedAt,
    source_observed_at: input.sourceObservedAt,
    bindings: {
      census_manifest: {
        schema_version: "2.0.0",
        catalog_kind: "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CENSUS_MANIFEST",
        artifact_bytes: Buffer.byteLength(input.censusArtifactText, "utf8"),
        artifact_sha256: sha256Text(input.censusArtifactText),
        generated_at: input.censusManifest.generated_at,
        cohort_sha256: input.censusManifest.cohort.canonical_sha256,
        public_catalog_sha256: sha256CanonicalPayload(input.publicCatalog),
        source_inventory_sha256: sha256CanonicalPayload(input.inventory)
      }
    },
    scope: {
      kind: "SINGLE_FORM_NO_AUXILIARIES_V1",
      form_id: input.derived.adapterInput.formId,
      ai_name: input.derived.adapterInput.expectedAiName,
      model_ids: [...input.derived.adapterInput.modelIds],
      root_source_ref_id: input.derived.rootSourceRefId
    },
    source_verification: {
      status: "PINNED_SOURCE_BYTES_REFETCHED_AND_MATCHED",
      source_ref_id: input.derived.rootSourceRefId,
      fetched_artifacts: 2,
      verification_status: "JS_MAP_AND_SOURCE_HASH_MATCHED",
      compilation_input: true,
      vendor_source_persisted: false
    },
    form: {
      form_id: compiledForm.form_id,
      source_ref: compiledForm.source_ref,
      completeness: "PARTIAL",
      projections: compiledForm.projections,
      blockers: compiledForm.blockers,
      runtime_usable: false
    },
    toolchain: {
      parser_profile: "STATIC_SETTINGS_V1",
      compilation_status: "PARTIAL_COMPILED",
      engine: input.compiled.engine,
      implementation_hash_algorithm: "FRAMED_COMPONENT_BYTES_SHA256_V1",
      implementation_components: input.implementationComponents,
      implementation_set_sha256: sha256CanonicalPayload(
        input.implementationComponents
      ),
      vendor_code_executed: false
    },
    result: {
      verification_status: "EXACT_RECOMPILED_ADAPTER_OUTPUT_MATCH",
      summary: {
        scoped_models: input.derived.adapterInput.modelIds.length,
        partial_forms: 1,
        partial_models: formIsPartial
          ? input.derived.adapterInput.modelIds.length
          : 0,
        ...summary
      }
    },
    coverage: buildCoverage(
      input.censusManifest,
      input.derived.adapterInput.modelIds.length
    ),
    limitations: [
      "DECLARED_SUBSET_ONLY_NOT_FULL_COHORT",
      "FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT",
      "PINNED_BUILD_MATCH_IS_NOT_ACTIVE_BUILD_DISCOVERY",
      "PAYLOAD_AND_BACKEND_EQUIVALENCE_UNVERIFIED",
      "NO_GENERATION_OR_AUTH_CALLS_PERFORMED"
    ]
  };

  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new GenericFormResultToolchainError(
      "GENERIC_TOOLCHAIN_RESULT_INVALID",
      input.derived.adapterInput.formId,
      { cause: parsed.error }
    );
  }
  return parsed.data;
}

function summarizeCompiledForm(compiledForm: {
  projections: Record<string, { status: string; static_candidates?: unknown }>;
  blockers: readonly unknown[];
}): {
  proven_projections: number;
  absent_proven_projections: number;
  blocked_projections: number;
  blocked_projections_with_static_candidates: number;
  form_blockers: number;
  runtime_usable_models: 0;
} {
  let proven = 0;
  let absentProven = 0;
  let blocked = 0;
  let blockedWithCandidates = 0;
  for (const projection of Object.values(compiledForm.projections)) {
    if (projection.status === "PROVEN") proven += 1;
    else if (projection.status === "ABSENT_PROVEN") absentProven += 1;
    else if (projection.status === "BLOCKED" && "static_candidates" in projection) {
      blocked += 1;
      blockedWithCandidates += 1;
    } else if (projection.status === "BLOCKED") blocked += 1;
  }
  return {
    proven_projections: proven,
    absent_proven_projections: absentProven,
    blocked_projections: blocked,
    blocked_projections_with_static_candidates: blockedWithCandidates,
    form_blockers: compiledForm.blockers.length,
    // Gate C1b never claims runtime usability — runtime_usable: false is
    // hardcoded at both the top level and the form level of the envelope
    // above, and this field must agree with that everywhere, always 0
    // (critic-code BLOCK: the schema requires this field and this file's
    // first draft never set it at all).
    runtime_usable_models: 0
  };
}

function buildCoverage(
  censusManifest: NormalizedSettingsParserCensusManifest,
  declaredModels: number
): {
  c0_forms: number;
  declared_forms: 1;
  unscoped_c0_forms: number;
  c0_models: number;
  declared_models: number;
  unscoped_c0_models: number;
  c0_source_refs: number;
  declared_source_refs: 1;
  verified_source_refs: 1;
  compiled_source_units: 1;
  unscoped_c0_source_refs: number;
} {
  const c0Forms = censusManifest.summary.current_forms;
  const c0Models = censusManifest.summary.model_variants;
  const c0SourceRefs = censusManifest.summary.source_refs;
  return {
    c0_forms: c0Forms,
    declared_forms: 1,
    unscoped_c0_forms: c0Forms - 1,
    c0_models: c0Models,
    declared_models: declaredModels,
    unscoped_c0_models: c0Models - declaredModels,
    c0_source_refs: c0SourceRefs,
    declared_source_refs: 1,
    verified_source_refs: 1,
    compiled_source_units: 1,
    unscoped_c0_source_refs: c0SourceRefs - 1
  };
}

// Mirrors source-backed-result-toolchain.ts's
// collectSourceBackedImplementationComponents (same typescript-runtime
// resolution; this list has 8 slots, Banana's has 7 — D-045 added the
// derive layer here with no Banana counterpart), against
// GENERIC_IMPLEMENTATION_COMPONENT_NAMES (D-039) instead of Banana's list.
// The "normalized-generic-form-result" slot hashes BOTH
// normalized-settings-parser-generic-form-result.ts and its vocabulary
// module (normalized-settings-parser-generic-form-vocabulary.ts, split out
// by D-041 after this component name was already fixed by D-039) framed
// together as one logical unit — the canonical name list has no slot for
// the vocabulary module on its own, and every BLOCK-level defect two
// critic-review rounds found on this schema lived in one of these two
// files, so binding only one of them would be an incomplete provenance
// claim. Unlike this file's first draft, every hash below is computed from
// file bytes and a STABLE logical label only — never a filesystem path —
// so implementation_set_sha256 does not depend on where this repository
// happens to be checked out (critic-code/critic-risk BLOCK, Gate C1b step
// 5 round 1: the first draft framed each component with its absolute
// file:// URL, including the repository's own emoji-and-space-bearing
// path, in the hashed bytes).
export function buildImplementationComponentRecords(): readonly GenericImplementationComponentRecord[] {
  const require = createRequire(import.meta.url);
  let typescriptRuntimePath: string;
  try {
    typescriptRuntimePath = require.resolve("typescript");
  } catch {
    throw new GenericFormResultToolchainError("GENERIC_TOOLCHAIN_READ_FAILED");
  }

  const singleFileUrls: Partial<
    Record<(typeof GENERIC_IMPLEMENTATION_COMPONENT_NAMES)[number], URL>
  > = {
    "generic-form-adapter": new URL(
      "./build-generic-form-parser-canary.js",
      import.meta.url
    ),
    "generic-form-adapter-input-from-manifest": new URL(
      "./generic-form-adapter-input-from-manifest.js",
      import.meta.url
    ),
    "immutable-json-snapshot": new URL(
      "./immutable-json-snapshot.js",
      import.meta.url
    ),
    "pinned-settings-source-loader": new URL(
      "./pinned-settings-source-loader.js",
      import.meta.url
    ),
    "generic-form-result-toolchain": new URL(import.meta.url),
    "static-settings-compiler": new URL(
      "./static-settings-compiler.js",
      import.meta.url
    ),
    "typescript-runtime": pathToFileURL(typescriptRuntimePath)
  };

  // Every slot is framed the same way (round 2 finding: the first version
  // framed only the composite "normalized-generic-form-result" slot and
  // hashed the rest as bare sha256(bytes) — two different algorithms
  // sharing one implementation_hash_algorithm label. An independent
  // verifier that frames every slot, going only by that label, would
  // recompute a different hash for the single-file slots and report a
  // false drift. Framing every slot — with the component's own canonical
  // name as its one part for single-file slots — makes the label actually
  // describe every slot uniformly).
  return GENERIC_IMPLEMENTATION_COMPONENT_NAMES.map((name) => {
    if (name === "normalized-generic-form-result") {
      const schemaBytes = readComponentBytes(
        new URL(
          "../../src/catalog/normalized-settings-parser-generic-form-result.js",
          import.meta.url
        )
      );
      const vocabularyBytes = readComponentBytes(
        new URL(
          "../../src/catalog/normalized-settings-parser-generic-form-vocabulary.js",
          import.meta.url
        )
      );
      return {
        name,
        bytes: schemaBytes.byteLength + vocabularyBytes.byteLength,
        sha256: framedHash([
          { name: "schema", bytes: schemaBytes },
          { name: "vocabulary", bytes: vocabularyBytes }
        ])
      };
    }
    const url = singleFileUrls[name];
    if (url === undefined) {
      throw new GenericFormResultToolchainError("GENERIC_TOOLCHAIN_READ_FAILED");
    }
    const bytes = readComponentBytes(url);
    return { name, bytes: bytes.byteLength, sha256: framedHash([{ name, bytes }]) };
  });
}

function readComponentBytes(url: URL): Buffer {
  try {
    return readFileSync(url);
  } catch {
    throw new GenericFormResultToolchainError("GENERIC_TOOLCHAIN_READ_FAILED");
  }
}

// A single NUL character, built at runtime rather than typed as a literal
// escape sequence in source — this project's Edit/Write tooling has
// corrupted literal NUL-style escape text into real 0x00 bytes more
// than once this session (see .журналы/), so every separator below is
// built this way instead of risking that class of corruption again.
const FRAME_SEPARATOR = String.fromCharCode(0);

function framedHash(parts: readonly { name: string; bytes: Uint8Array }[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(
      `${part.name}${FRAME_SEPARATOR}${part.bytes.byteLength}${FRAME_SEPARATOR}`,
      "utf8"
    );
    hash.update(part.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

// Resolved via the nearest ancestor package.json rather than a fixed
// relative-hop count: a fixed "../../.." guess is only correct for one
// specific execution depth (dist/ vs source) and silently resolves outside
// the repository at the other depth — exactly the bug class
// findGenericFormResultPath's fallback path had earlier this session
// (critic-risk/critic-code, Gate C1b step 5 round 1), fixed here by never
// guessing a depth at all.
function findProjectRootFromModule(moduleUrl: string): string {
  let dir = dirname(fileURLToPath(moduleUrl));
  for (let hop = 0; hop < 8; hop += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new GenericFormResultToolchainError("GENERIC_TOOLCHAIN_READ_FAILED");
}

function readDefaultCensusArtifactText(): string {
  const root = findProjectRootFromModule(import.meta.url);
  const path = join(
    root,
    "catalog",
    "runtime",
    "v2",
    "normalized-settings-parser-census-manifest.json"
  );
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new GenericFormResultToolchainError("GENERIC_TOOLCHAIN_READ_FAILED");
  }
}

// Validates the shape of explicitly-provided optional inputs, not just the
// input container itself — round 2 finding: the first version only checked
// that `input` was a non-null object, so a caller passing a malformed
// publicCatalog/inventory (e.g. `{}`, from a corrupted cache) surfaced as
// GENERIC_TOOLCHAIN_READ_FAILED with no read having actually happened,
// where Banana's own validateFullLocalPreflight precedent
// (source-backed-result-toolchain.ts) schema-parses all of its inputs the
// same way. censusManifest is deliberately NOT re-validated here: it
// already gets a full schema/relationship check inside
// buildGenericFormResultFromPinnedSource's own try/catch (with cause now
// preserved), so a second check here would be untestable duplication, not
// defense in depth.
function assertBuildInputShape(
  input: unknown
): asserts input is BuildGenericFormResultFromPinnedSourceInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new GenericFormResultToolchainError("GENERIC_TOOLCHAIN_INVALID_INPUT_SHAPE");
  }
  const candidate = input as Record<string, unknown>;
  if (
    candidate.publicCatalog !== undefined &&
    !syntxPublicCatalogSnapshotSchema.safeParse(candidate.publicCatalog).success
  ) {
    throw new GenericFormResultToolchainError("GENERIC_TOOLCHAIN_INVALID_INPUT_SHAPE");
  }
  if (
    candidate.inventory !== undefined &&
    !settingsSourceInventorySchema.safeParse(candidate.inventory).success
  ) {
    throw new GenericFormResultToolchainError("GENERIC_TOOLCHAIN_INVALID_INPUT_SHAPE");
  }
  if (
    candidate.censusArtifactText !== undefined &&
    typeof candidate.censusArtifactText !== "string"
  ) {
    throw new GenericFormResultToolchainError("GENERIC_TOOLCHAIN_INVALID_INPUT_SHAPE");
  }
}

function isCanonicalUtc(value: string): boolean {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function validateOptionalTimestampPair(
  sourceObservedAt: string | undefined,
  generatedAt: string | undefined,
  censusGeneratedAt: string
): void {
  if (sourceObservedAt === undefined && generatedAt === undefined) return;
  if (
    sourceObservedAt === undefined ||
    generatedAt === undefined ||
    !isCanonicalUtc(sourceObservedAt) ||
    !isCanonicalUtc(generatedAt) ||
    Date.parse(censusGeneratedAt) > Date.parse(sourceObservedAt) ||
    Date.parse(sourceObservedAt) > Date.parse(generatedAt)
  ) {
    throw new GenericFormResultToolchainError("GENERIC_TOOLCHAIN_INVALID_INPUT_SHAPE");
  }
}
