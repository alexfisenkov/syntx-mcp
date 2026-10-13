// Persistable, Zod-validated result artifact for the generic (non-Banana)
// Gate C1b path — one artifact per form. Deliberately NOT a generic version
// of normalized-settings-parser-source-backed-result.ts's two-tier structure
// (separate canary artifact, then a result that re-verifies the canary
// byte-for-byte): D-039 in docs/проект/решения.md explains why — Banana's
// canary (Gate B) predates the census manifest (Gate C0) and existed only
// to record pinned source hashes before Gate C0 did that for every form.
// The census manifest already IS that pinned checkpoint for all 42 forms, so
// this schema goes directly from adapter output to one persisted result,
// with no intermediate canary file and no `bindings.parser_result`.
//
// This file holds the envelope schema and its relational cross-checks only.
// The static-value/locator/projection/blocker vocabulary
// (normalized-settings-parser-generic-form-vocabulary.ts, DEBT-034) is a
// separate module — split out after two critic-review rounds found every
// BLOCK-level defect lived in that vocabulary or in checks using it, and
// that module deserved its own guarded surface rather than growing further
// inside this one.
//
// This file is NOT hash-bound in any published artifact yet (no generic
// Gate C1b result has been created) — editing it is free right now.
// Once a first artifact exists, `schema_version` becomes a real contract:
// changing these schemas after that means bumping it and republishing
// every generic-path artifact, not a same-version in-place edit.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import {
  FORM_PROJECTION_NAMES,
  blockerArraySchema,
  engineMetadataSchema,
  formProjectionsSchema,
  hasDuplicates,
  identifierSchema,
  isCanonicallyOrdered,
  nonnegativeIntegerSchema,
  positiveIntegerSchema,
  sha256Schema,
  sourceRefSchema,
  addIssue
} from "./normalized-settings-parser-generic-form-vocabulary.js";

const FORM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SOURCE_REF_ID_PATTERN = /^settings-source-[a-f0-9]{64}$/u;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SETTINGS_SOURCE_PREFIX = "/src/components/chat/forms/settings/";

const formIdSchema = z.string().min(1).max(64).regex(FORM_ID_PATTERN);
const sourceRefIdSchema = z.string().regex(SOURCE_REF_ID_PATTERN);
const utcTimestampSchema = z
  .string()
  .regex(UTC_TIMESTAMP_PATTERN)
  .refine(
    (value) => Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value,
    { message: "Expected a canonical UTC timestamp." }
  );

function isSortedUniqueStrings(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value
  );
}

// --- Envelope ---------------------------------------------------------

// Mirrors normalized-settings-parser-source-backed-result.ts's
// SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES (7 names) with the 3
// Banana-specific ones swapped for their generic-path equivalents (per
// D-039's committed mapping) plus ONE addition Banana's own list has no
// counterpart for. "generic-form-result-toolchain" names
// tools/settings-ir/generic-form-result-toolchain.ts (Gate C1b step 5,
// D-043), which imports this list rather than inventing its own.
// "generic-form-adapter-input-from-manifest" names
// tools/settings-ir/generic-form-adapter-input-from-manifest.ts (the
// derive layer, Gate C1b step 2, D-038) — added by D-045 (DEBT-036's
// resolution): its code decides which manifest fields become
// scope.form_id/model_ids/root_source_ref_id, materially shaping the
// artifact's content, but was left out of the first 7-name list (a
// mechanical carryover from Banana, which has no separate derive layer
// at all — its own manifest verification lives elsewhere). Without
// hash-binding it, an offline audit could not tell whether an artifact
// was built with the derive-layer code currently on disk; only a full
// network re-fetch via --check-source (which re-derives from scratch
// and compares) could ever have caught a change there. Exported for the
// toolchain constructor to import.
// Alphabetically ordered — the schema's own isCanonicallyOrdered check
// below sorts by name and compares, so this list must actually BE sorted,
// not just declared in some other deliberate order (unlike Banana's
// SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES, whose schema instead
// requires an exact match to declaration order). A mechanical 3-name swap
// from Banana's list (D-039) previously preserved Banana's POSITIONS
// without re-checking alphabetical order, which broke it: Banana's
// "source-backed-result-toolchain" happened to sort in the same slot it
// was declared in, but this list's replacement name
// "generic-form-result-toolchain" does not (critic-code/critic-practice
// BLOCK, Gate C1b step 5 round 1 — buildImplementationComponentRecords()
// would have failed its own schema's ordering check on every real run).
// Verified again here, not just asserted: [...].sort() on this exact
// 8-element array reproduces the declared order unchanged.
export const GENERIC_IMPLEMENTATION_COMPONENT_NAMES = [
  "generic-form-adapter",
  "generic-form-adapter-input-from-manifest",
  "generic-form-result-toolchain",
  "immutable-json-snapshot",
  "normalized-generic-form-result",
  "pinned-settings-source-loader",
  "static-settings-compiler",
  "typescript-runtime"
] as const;

const implementationComponentSchema = z
  .object({
    name: z.enum(GENERIC_IMPLEMENTATION_COMPONENT_NAMES),
    bytes: positiveIntegerSchema,
    sha256: sha256Schema
  })
  .strict();

const GENERIC_RESULT_LIMITATIONS = [
  "DECLARED_SUBSET_ONLY_NOT_FULL_COHORT",
  "FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT",
  "PINNED_BUILD_MATCH_IS_NOT_ACTIVE_BUILD_DISCOVERY",
  "PAYLOAD_AND_BACKEND_EQUIVALENCE_UNVERIFIED",
  "NO_GENERATION_OR_AUTH_CALLS_PERFORMED"
] as const;

const genericFormResultBaseSchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    catalog_kind: z.literal("OBSERVED_NORMALIZED_SETTINGS_IR_GENERIC_FORM_RESULT"),
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
              "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CENSUS_MANIFEST"
            ),
            artifact_bytes: positiveIntegerSchema,
            artifact_sha256: sha256Schema,
            generated_at: utcTimestampSchema,
            cohort_sha256: sha256Schema,
            public_catalog_sha256: sha256Schema,
            source_inventory_sha256: sha256Schema
          })
          .strict()
      })
      .strict(),
    scope: z
      .object({
        kind: z.literal("SINGLE_FORM_NO_AUXILIARIES_V1"),
        form_id: formIdSchema,
        ai_name: identifierSchema,
        model_ids: z
          .array(identifierSchema)
          .min(1)
          .max(64)
          .superRefine((values, context) => {
            if (new Set(values).size !== values.length || !isSortedUniqueStrings(values)) {
              context.addIssue({
                code: "custom",
                message: "model_ids must be unique and canonically ordered."
              });
            }
          }),
        root_source_ref_id: sourceRefIdSchema
      })
      .strict(),
    source_verification: z
      .object({
        status: z.literal("PINNED_SOURCE_BYTES_REFETCHED_AND_MATCHED"),
        source_ref_id: sourceRefIdSchema,
        fetched_artifacts: z.literal(2),
        verification_status: z.literal("JS_MAP_AND_SOURCE_HASH_MATCHED"),
        compilation_input: z.literal(true),
        vendor_source_persisted: z.literal(false)
      })
      .strict(),
    form: z
      .object({
        form_id: formIdSchema,
        source_ref: sourceRefSchema,
        completeness: z.literal("PARTIAL"),
        projections: formProjectionsSchema,
        blockers: blockerArraySchema,
        runtime_usable: z.literal(false)
      })
      .strict(),
    toolchain: z
      .object({
        parser_profile: z.literal("STATIC_SETTINGS_V1"),
        compilation_status: z.literal("PARTIAL_COMPILED"),
        engine: engineMetadataSchema,
        implementation_hash_algorithm: z.literal("FRAMED_COMPONENT_BYTES_SHA256_V1"),
        implementation_components: z
          .array(implementationComponentSchema)
          .length(GENERIC_IMPLEMENTATION_COMPONENT_NAMES.length)
          .superRefine((components, context) => {
            const names = components.map((component) => component.name);
            if (hasDuplicates(names)) {
              context.addIssue({ code: "custom", message: "Implementation components must have unique names." });
            }
            if (!isCanonicallyOrdered(components, (component) => component.name)) {
              context.addIssue({ code: "custom", message: "Implementation components must be canonically ordered by name." });
            }
          }),
        implementation_set_sha256: sha256Schema,
        vendor_code_executed: z.literal(false)
      })
      .strict(),
    result: z
      .object({
        verification_status: z.literal("EXACT_RECOMPILED_ADAPTER_OUTPUT_MATCH"),
        summary: z
          .object({
            scoped_models: positiveIntegerSchema,
            partial_forms: z.literal(1),
            partial_models: nonnegativeIntegerSchema,
            proven_projections: nonnegativeIntegerSchema,
            absent_proven_projections: nonnegativeIntegerSchema,
            blocked_projections: nonnegativeIntegerSchema,
            blocked_projections_with_static_candidates: nonnegativeIntegerSchema,
            form_blockers: nonnegativeIntegerSchema,
            runtime_usable_models: z.literal(0)
          })
          .strict()
      })
      .strict(),
    coverage: z
      .object({
        c0_forms: positiveIntegerSchema,
        declared_forms: z.literal(1),
        unscoped_c0_forms: nonnegativeIntegerSchema,
        c0_models: positiveIntegerSchema,
        declared_models: positiveIntegerSchema,
        unscoped_c0_models: nonnegativeIntegerSchema,
        c0_source_refs: positiveIntegerSchema,
        declared_source_refs: z.literal(1),
        verified_source_refs: z.literal(1),
        compiled_source_units: z.literal(1),
        unscoped_c0_source_refs: nonnegativeIntegerSchema
      })
      .strict(),
    limitations: z.tuple([
      z.literal(GENERIC_RESULT_LIMITATIONS[0]),
      z.literal(GENERIC_RESULT_LIMITATIONS[1]),
      z.literal(GENERIC_RESULT_LIMITATIONS[2]),
      z.literal(GENERIC_RESULT_LIMITATIONS[3]),
      z.literal(GENERIC_RESULT_LIMITATIONS[4])
    ])
  })
  .strict();

export const normalizedSettingsParserGenericFormResultSchema =
  genericFormResultBaseSchema.superRefine((result, context) => {
    validateGenericFormResultRelationships(result, context);
  });

export type NormalizedSettingsParserGenericFormResult = z.infer<
  typeof normalizedSettingsParserGenericFormResultSchema
>;

export type GenericFormResultErrorCode =
  // Distinct from GENERIC_FORM_RESULT_INVALID (file exists but is
  // corrupt/malformed/fails the schema) — a future writer deciding whether
  // it is safe to create a new artifact needs to tell "nothing here yet"
  // apart from "something here is broken and must not be silently
  // overwritten" (critic-code, matching Gate C1a's own
  // SOURCE_RESULT_ALREADY_EXISTS / existsSync pairing for the same reason).
  | "GENERIC_FORM_RESULT_NOT_FOUND"
  | "GENERIC_FORM_RESULT_INVALID"
  | "GENERIC_FORM_RESULT_DRIFT_DETECTED"
  | "GENERIC_FORM_ID_INVALID";

export class GenericFormResultError extends Error {
  constructor(
    readonly code: GenericFormResultErrorCode,
    readonly formId?: string,
    options?: { cause?: unknown }
  ) {
    super(
      `SYNTX generic form result artifact could not be handled safely${
        formId === undefined ? "" : ` (form_id: ${formId})`
      }.`,
      options
    );
    this.name = "GenericFormResultError";
  }
}

function validateGenericFormResultRelationships(
  result: NormalizedSettingsParserGenericFormResult,
  context: z.RefinementCtx
): void {
  if (Date.parse(result.generated_at) < Date.parse(result.source_observed_at)) {
    addIssue(context, ["generated_at"], "Result was generated before its source was observed.");
  }
  if (result.scope.form_id !== result.form.form_id) {
    addIssue(context, ["form", "form_id"], "Form id differs from declared scope.");
  }
  if (
    result.form.source_ref.source_path !==
    `${SETTINGS_SOURCE_PREFIX}${result.scope.form_id}.vue`
  ) {
    addIssue(context, ["form", "source_ref", "source_path"], "Source path does not match declared form id.");
  }
  if (result.scope.root_source_ref_id !== result.source_verification.source_ref_id) {
    addIssue(context, ["source_verification", "source_ref_id"], "Verified source ref differs from declared scope.");
  }
  if (result.scope.model_ids.length !== result.result.summary.scoped_models) {
    addIssue(context, ["result", "summary", "scoped_models"], "Scoped model count differs from declared model_ids.");
  }
  if (result.coverage.declared_models !== result.scope.model_ids.length) {
    addIssue(context, ["coverage", "declared_models"], "Declared model count differs from declared model_ids.");
  }
  if (result.coverage.unscoped_c0_forms !== result.coverage.c0_forms - 1) {
    addIssue(context, ["coverage", "unscoped_c0_forms"], "Unscoped form count is not an exact complement.");
  }
  if (result.coverage.unscoped_c0_models !== result.coverage.c0_models - result.coverage.declared_models) {
    addIssue(context, ["coverage", "unscoped_c0_models"], "Unscoped model count is not an exact complement.");
  }
  if (result.coverage.unscoped_c0_source_refs !== result.coverage.c0_source_refs - 1) {
    addIssue(context, ["coverage", "unscoped_c0_source_refs"], "Unscoped source ref count is not an exact complement.");
  }
  const summary = summarizeProjectionsAndBlockers(result.form.projections, result.form.blockers);
  if (
    summary.proven_projections !== result.result.summary.proven_projections ||
    summary.absent_proven_projections !== result.result.summary.absent_proven_projections ||
    summary.blocked_projections !== result.result.summary.blocked_projections ||
    summary.blocked_projections_with_static_candidates !==
      result.result.summary.blocked_projections_with_static_candidates ||
    summary.form_blockers !== result.result.summary.form_blockers
  ) {
    addIssue(context, ["result", "summary"], "Summary counts do not match the recorded projections/blockers.");
  }
  // Every scoped model shares the same merged form-level projections/blockers
  // (the adapter compiles one set for the whole form, not per model), so
  // "partial" is all-or-nothing: any blocker or non-PROVEN projection makes
  // every scoped model partial, and zero blockers with all projections
  // PROVEN/ABSENT_PROVEN makes none of them partial.
  const formIsPartial =
    result.form.blockers.length > 0 ||
    FORM_PROJECTION_NAMES.some(
      (name) => result.form.projections[name].status === "BLOCKED"
    );
  const expectedPartialModels = formIsPartial ? result.scope.model_ids.length : 0;
  if (result.result.summary.partial_models !== expectedPartialModels) {
    addIssue(
      context,
      ["result", "summary", "partial_models"],
      "Partial-model count is inconsistent with recorded blockers/projections."
    );
  }
  // The four checks below mirror normalized-settings-parser-canary.ts's
  // validateFormCompilation (~965-1032) — lost in this file's first draft
  // (found by critic-code and critic-risk independently) and restored here
  // rather than left as a documented gap, since each one guards against a
  // hand-constructed artifact making a false proof claim, not just against
  // the current adapter's own output shape.
  for (const name of FORM_PROJECTION_NAMES) {
    const projection = result.form.projections[name];
    const matchingBlockers = result.form.blockers.filter(
      (blocker) => blocker.projection === name
    );
    if (projection.status === "BLOCKED" && matchingBlockers.length === 0) {
      addIssue(context, ["form", "projections", name], "Blocked projection has no matching blocker.");
    }
    if (projection.status !== "BLOCKED" && matchingBlockers.length > 0) {
      addIssue(context, ["form", "blockers"], "Non-blocked projection has a contradictory blocker.");
    }
    const facts =
      projection.status === "PROVEN"
        ? projection.facts
        : projection.status === "BLOCKED" && "static_candidates" in projection
          ? projection.static_candidates
          : [];
    for (const fact of facts) {
      if (!locatorMatchesSourceRef(fact.locator, result.form.source_ref)) {
        addIssue(
          context,
          ["form", "projections", name],
          "Projection locator is outside the compiled source."
        );
      }
    }
  }
  for (const blocker of result.form.blockers) {
    if (blocker.locator !== null && !locatorMatchesSourceRef(blocker.locator, result.form.source_ref)) {
      addIssue(context, ["form", "blockers"], "Blocker locator is outside the compiled source.");
    }
  }
}

function locatorMatchesSourceRef(
  locator: { source_index: number; source_path: string; source_content_sha256: string },
  sourceRef: { source_index: number; source_path: string; source_content_sha256: string }
): boolean {
  return (
    locator.source_index === sourceRef.source_index &&
    locator.source_path === sourceRef.source_path &&
    locator.source_content_sha256 === sourceRef.source_content_sha256
  );
}

function summarizeProjectionsAndBlockers(
  projections: NormalizedSettingsParserGenericFormResult["form"]["projections"],
  blockers: NormalizedSettingsParserGenericFormResult["form"]["blockers"]
): {
  proven_projections: number;
  absent_proven_projections: number;
  blocked_projections: number;
  blocked_projections_with_static_candidates: number;
  form_blockers: number;
} {
  let proven = 0;
  let absentProven = 0;
  let blocked = 0;
  let blockedWithCandidates = 0;
  for (const name of FORM_PROJECTION_NAMES) {
    const projection = projections[name];
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
    form_blockers: blockers.length
  };
}

// --- Persistence --------------------------------------------------------
// One artifact per form: catalog/runtime/v4/<form_id>-generic-form-result.json
// (v4 follows v1 canary / v2 census manifest / v3 Banana source-backed
// result — but unlike those three, v4 holds many files, not one, since
// there is no single canonical form for the generic path).
//
// Deliberately NO construction function here, unlike
// normalized-settings-parser-canary.ts's buildNormalizedSettingsParserCanary
// (same file as its schema) — this mirrors
// normalized-settings-parser-source-backed-result.ts instead, which has
// none either (that file's own test asserts
// "buildNormalizedSettingsParserSourceBackedResultInput" does not exist on
// the module). Both this schema and Gate C1a's result schema depend on
// freshly-fetched source material and a network-fetch-driving toolchain,
// not just already-loaded static data (unlike the canary, whose inputs are
// all already in memory) — that construction lives in the toolchain module
// under tools/settings-ir/ (generic-form-result-toolchain.ts, D-043,
// exports assembleGenericFormResult/buildGenericFormResultFromPinnedSource),
// which this src/catalog/ file must not import from: tools/settings-ir/ is
// excluded from the npm package, and src/catalog/ ships in it. A still-future
// CLI/script layer writes the artifact via
// tools/settings-ir/immutable-json-snapshot.ts's create-once
// createImmutableJsonSnapshot (open(path, "wx", mode), never overwrites) —
// there is no write function in this file at all, by the same reasoning as
// no construction function.
//
// serializeGenericFormResultShape's byte output depends on the FIELD ORDER
// declared in genericFormResultBaseSchema above, not on the input object's
// own key order (Zod's parse() re-emits keys in schema-declaration order).
// Once a first artifact is published, reordering fields in that schema —
// even with no semantic change and no schema_version bump — silently
// changes serialize's bytes and breaks re-verifying that artifact (same
// class of irreversibility as DEBT-019(б)). Compare published artifacts
// with assertNormalizedSettingsParserGenericFormResultUnchanged (which
// re-derives both sides through the same serializer), never by diffing
// raw bytes against a hand-edited copy.

// Mirrors normalized-settings-parser-source-backed-result.ts's
// findProjectArtifactPath exactly (join(), not string concatenation, and a
// fallback to the first — dist-relative — candidate rather than an
// unconditional extra "../" climb): an earlier draft built the fallback by
// concatenating moduleDirectory with a literal "/../../../..." string
// instead of joining through the same candidate list, which — from a
// src/catalog/ (not dist/src/catalog/) module location — resolved OUTSIDE
// this repository, into its parent directory. Caught by critic-risk and
// critic-practice independently, both by executing the resolver, not just
// reading it.
//
// READ-ONLY resolver — do not call this directly as a write target for a
// future toolchain's first-artifact publication. It always returns a path
// (existing or not) with no signal of which, and no create-once guarantee;
// Gate C1a's writer (scripts/sync-normalized-settings-parser-source-backed-result.mjs)
// pairs its own equivalent resolver with a separate existsSync check and a
// dedicated *_ALREADY_EXISTS rejection before ever writing — a future
// generic-path writer needs the same pairing, not this function alone
// (critic-risk, round on this addition).
export function findGenericFormResultPath(formId: string): string {
  if (!formIdSchema.safeParse(formId).success) {
    throw new GenericFormResultError("GENERIC_FORM_ID_INVALID", formId);
  }
  const fileName = `${formId}-generic-form-result.json`;
  const moduleDirectory = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    join(moduleDirectory, "../../../catalog/runtime/v4", fileName),
    join(moduleDirectory, "../../catalog/runtime/v4", fileName)
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ?? candidates[0]!;
}

export interface LoadNormalizedSettingsParserGenericFormResultOptions {
  path?: string;
}

export function loadNormalizedSettingsParserGenericFormResult(
  formId: string,
  options: LoadNormalizedSettingsParserGenericFormResultOptions = {}
): NormalizedSettingsParserGenericFormResult {
  // Validate formId even when options.path is given explicitly and this
  // never calls findGenericFormResultPath's own check — otherwise an
  // invalid formId surfaces as GENERIC_FORM_RESULT_INVALID (pointing at the
  // file) instead of GENERIC_FORM_ID_INVALID (pointing at the argument),
  // misdiagnosing which one is actually wrong (critic-practice).
  if (!formIdSchema.safeParse(formId).success) {
    throw new GenericFormResultError("GENERIC_FORM_ID_INVALID", formId);
  }
  let text: string;
  try {
    text = readFileSync(options.path ?? findGenericFormResultPath(formId), "utf8");
  } catch (error) {
    if (error instanceof GenericFormResultError) throw error;
    // Distinct from a read that succeeds but yields unparsable/invalid
    // content (below): "not found" is the one outcome under which a
    // future writer may safely create a new artifact.
    const isNotFound =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT";
    throw new GenericFormResultError(
      isNotFound ? "GENERIC_FORM_RESULT_NOT_FOUND" : "GENERIC_FORM_RESULT_INVALID",
      formId,
      { cause: error }
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new GenericFormResultError("GENERIC_FORM_RESULT_INVALID", formId, { cause: error });
  }
  const result = parseGenericFormResult(raw, formId);
  if (result.scope.form_id !== formId) {
    throw new GenericFormResultError("GENERIC_FORM_RESULT_INVALID", formId);
  }
  return result;
}

export function serializeNormalizedSettingsParserGenericFormResult(
  result: NormalizedSettingsParserGenericFormResult
): string {
  return serializeGenericFormResultShape(result);
}

export function assertNormalizedSettingsParserGenericFormResultUnchanged(
  recorded: NormalizedSettingsParserGenericFormResult,
  observed: NormalizedSettingsParserGenericFormResult
): void {
  if (
    serializeGenericFormResultShape(recorded) !==
    serializeGenericFormResultShape(observed)
  ) {
    throw new GenericFormResultError(
      "GENERIC_FORM_RESULT_DRIFT_DETECTED",
      recorded.scope.form_id
    );
  }
}

function parseGenericFormResult(
  value: unknown,
  formId?: string
): NormalizedSettingsParserGenericFormResult {
  try {
    return normalizedSettingsParserGenericFormResultSchema.parse(value);
  } catch (error) {
    throw new GenericFormResultError("GENERIC_FORM_RESULT_INVALID", formId, { cause: error });
  }
}

function serializeGenericFormResultShape(
  result: NormalizedSettingsParserGenericFormResult
): string {
  return `${JSON.stringify(parseGenericFormResult(result, result.scope?.form_id), null, 2)}\n`;
}
