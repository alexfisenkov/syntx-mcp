// Static-value / locator / projection / blocker vocabulary for the generic
// (non-Banana) Gate C1b result schema — split out of
// normalized-settings-parser-generic-form-result.ts (DEBT-034: that file
// grew to ~770 lines mixing this vocabulary, the envelope schema, and
// relational cross-checks; every BLOCK-level defect two critic-review
// rounds found lived in this vocabulary or in checks that use it, so it
// gets its own module with its own surface rather than growing further
// inside the envelope file).
//
// Source of truth for the blocker/projection vocabulary specifically:
// normalized-settings-parser-canary.ts's LOCAL_BLOCKER_CODES/
// EXTERNAL_BLOCKER_CODES — NOT static-settings-compiler.ts's raw
// StaticSettingsBlockerCode (an earlier draft used that wider vocabulary on
// a "wider is safer" theory that four critics independently proved
// backwards by feeding this schema the real adapter's actual output — see
// D-040, docs/проект/решения.md). This module cannot import canary.ts's
// private schemas (Gate B protected file), so the literal arrays below are
// a hand-written runtime counterpart, checked against canary.ts's exported
// NormalizedSettingsBlocker type by a two-directional compile-time guard in
// the result schema's test file — not trusted by comment alone.
import { z } from "zod/v4";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

// Mirrors normalized-settings-parser-canary.ts's SECRET_LIKE_PATTERNS /
// FORBIDDEN_STATIC_KEYS exactly (that file, not static-settings-compiler.ts
// — an earlier draft named the wrong file here, caught by critic-risk; the
// compiler module has its own, differently-named and differently-scoped
// constants, FORBIDDEN_OBJECT_KEYS/SECRET_LIKE_OBJECT_KEYS/
// SECRET_LIKE_VALUE_PATTERNS, which are a separate, earlier gate — not a
// substitute for this one). canary.ts's copy is not exported either (Gate B
// protected file, only inferred types are exported), so the same safety net
// is re-declared here for values that reach this schema.
const SECRET_LIKE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~-]{16,}/iu,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu,
  /\b(?:ghp|github_pat|sk|xox[baprs])[-_][A-Za-z0-9_-]{16,}/u,
  /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/u
] as const;
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

export const identifierSchema = z.string().min(1).max(160).regex(IDENTIFIER_PATTERN);
export const sha256Schema = z.string().regex(SHA256_PATTERN);
export const positiveIntegerSchema = z.number().int().positive();
export const nonnegativeIntegerSchema = z.number().int().nonnegative();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

// Re-sorts by keyFn and compares — robust against sort keys that can
// legitimately repeat (e.g. same AST path proven at two locations), where
// a naive "each key strictly greater than the last" check would wrongly
// reject valid input. Matches how build-generic-form-parser-canary.ts's own
// sortAndDedupeFacts/sortAndDedupeNormalizedBlockers construct their output.
export function isCanonicallyOrdered<T>(
  items: readonly T[],
  keyFn: (item: T) => string
): boolean {
  const resorted = [...items].sort((left, right) =>
    compareText(keyFn(left), keyFn(right))
  );
  return items.every((item, index) => keyFn(item) === keyFn(resorted[index]!));
}

export function addIssue(
  context: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string
): void {
  context.addIssue({ code: "custom", path: [...path], message });
}

const safeStaticKeySchema = z
  .string()
  .min(1)
  .max(160)
  .regex(IDENTIFIER_PATTERN)
  .refine((value) => !FORBIDDEN_STATIC_KEYS.has(value), {
    message: "Static key is reserved."
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
type NormalizedStaticValue =
  | null
  | boolean
  | number
  | string
  | readonly NormalizedStaticValue[]
  | { readonly [key: string]: NormalizedStaticValue };
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
          // Bounded and unique only — NOT canonical-order, unlike every
          // other array in this module. Object.keys() on a plain object
          // always returns integer-like keys ("2", "10") first in NUMERIC
          // order regardless of insertion order (JS's own
          // [[OwnPropertyKeys]] rule), so a lexicographic-order check here
          // would be unsatisfiable for any settings value that happens to
          // have a numeric-looking key — not a defect in the data, a
          // structural impossibility in checking it this way. Found by
          // critic-code reading build-generic-form-parser-canary.ts's own
          // canonicalizeStaticValue, which has the same latent property.
          if (Object.keys(record).length > 512) {
            context.addIssue({
              code: "custom",
              message: "Static object keys must be bounded."
            });
          }
        })
    ])
);

export const sourceRefSchema = z
  .object({
    provider_javascript_sha256: sha256Schema,
    provider_source_map_sha256: sha256Schema,
    source_index: nonnegativeIntegerSchema,
    source_path: z.string().min(1).max(2_000),
    source_content_sha256: sha256Schema
  })
  .strict();

const staticLocatorSchema = z
  .object({
    source_index: nonnegativeIntegerSchema,
    source_path: z.string().min(1).max(2_000),
    source_content_sha256: sha256Schema,
    line: positiveIntegerSchema,
    column: positiveIntegerSchema,
    node_kind: identifierSchema
  })
  .strict();

// Equivalent to (not a byte-identical copy of) the adapter's own
// staticFactSortKey/staticFactIdentity (build-generic-form-parser-canary.ts
// ~922-933) — same fields, same JSON.stringify(path) ordering. The join
// separator differs from the adapter's (a single ASCII space here; the
// adapter uses the null control character) — this does not change sort
// order or uniqueness, since the padded numeric fields have no
// prefix-collision risk either way. NOT a naive `path.join(" ")` (an
// earlier draft's mistake): the same `path` legitimately repeats at
// different locations with different values (e.g. a projection merges
// candidates from two source bindings), and the adapter sorts by
// JSON.stringify(path), which orders differently from a plain joined
// string for paths of different lengths. The adapter's own
// "stableStringify" is, as of this writing, literally JSON.stringify — see
// build-generic-form-parser-canary.ts's stableStringify — so
// staticFactIdentity below matches its actual behavior, not just its name;
// this equivalence is NOT verified by any automated guard.
function staticFactSortKey(fact: {
  path: readonly string[];
  locator: { line: number; column: number };
}): string {
  return [
    JSON.stringify(fact.path),
    String(fact.locator.line).padStart(10, "0"),
    String(fact.locator.column).padStart(10, "0")
  ].join(" ");
}
function staticFactIdentity(fact: {
  path: readonly string[];
  value: unknown;
  locator: { line: number; column: number };
}): string {
  return `${staticFactSortKey(fact)} ${JSON.stringify(fact.value)}`;
}
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
    if (hasDuplicates(facts.map(staticFactIdentity))) {
      context.addIssue({ code: "custom", message: "Static facts must be unique." });
    }
    if (!isCanonicallyOrdered(facts, staticFactSortKey)) {
      context.addIssue({ code: "custom", message: "Static facts must be canonically ordered." });
    }
  });

// NOT exported: no consumer needs the bare union outside this module — only
// formProjectionsSchema (the validated 6-key record built from it) does.
// Exporting this without also exporting the record risks a future consumer
// validating one projection with none of the cross-form checks (round 2
// critic-code, verifying this module's split).
const formProjectionSchema = z.union([
  z.object({
    status: z.literal("PROVEN"),
    proof_scope: z.literal("STATIC_LITERAL_TREE_ONLY"),
    facts: staticFactArraySchema
  }).strict(),
  z.object({
    status: z.literal("ABSENT_PROVEN"),
    proof_scope: z.literal("NO_RELEVANT_STATIC_CONSTRUCT_WITHIN_COMPILER_PROFILE")
  }).strict(),
  z.object({
    status: z.literal("BLOCKED"),
    proof_scope: z.literal("STATIC_CANDIDATES_ONLY_NOT_RUNTIME_SEMANTICS"),
    static_candidates: staticFactArraySchema
  }).strict(),
  z.object({ status: z.literal("BLOCKED") }).strict()
]);

// The 6-name curated projection taxonomy both adapters (Banana and generic)
// already produce — see build-generic-form-parser-canary.ts's own local
// FormProjectionName type, which this array is checked against in tests.
export const FORM_PROJECTION_NAMES = [
  "computed_rules",
  "conditional_rules",
  "controls",
  "defaults",
  "payload_projection",
  "watch_rules"
] as const;
export const formProjectionsSchema = z
  .object(
    Object.fromEntries(
      FORM_PROJECTION_NAMES.map((name) => [name, formProjectionSchema])
    ) as Record<(typeof FORM_PROJECTION_NAMES)[number], typeof formProjectionSchema>
  )
  .strict();

// NOT the compiler's raw 21-code vocabulary (StaticSettingsBlockerCode,
// static-settings-compiler.ts) — that was an earlier draft's mistake,
// caught independently by critic-practice, critic-risk, and critic-code
// (the last proved it by feeding the real published banana artifact's
// blockers, catalog/runtime/v1/normalized-settings-parser-canary.json,
// through safeParse and watching it fail). The adapter's own
// mapBlockerCode() (build-generic-form-parser-canary.ts ~857-879) maps
// every raw compiler code down to this same narrow set before it ever
// reaches an artifact, and unconditionally appends two "external" blockers
// with locator: null. This local/external split, and the exact code
// lists, mirror normalized-settings-parser-canary.ts's LOCAL_BLOCKER_CODES /
// EXTERNAL_BLOCKER_CODES exactly (that file is hash-bound and cannot be
// imported from at runtime — DEBT-032 — but its NormalizedSettingsBlocker
// TYPE is exported and used as a compile-time drift guard in the result
// schema's test file instead of trusting this list by inspection alone).
// Exported so that test file can check these two arrays (not a
// hand-retyped copy of them) against canary.ts's NormalizedSettingsBlocker
// type — a guard against a union retyped in the test file instead of
// imported would keep passing typecheck even if these arrays drifted from
// what it claims to check (critic-skeptic, round 2).
export const LOCAL_BLOCKER_CODES = [
  "CALL_EXPRESSION_NOT_INTERPRETED",
  "COMPUTED_RULE_NOT_INTERPRETED",
  "DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED",
  "SOURCE_PATTERN_NOT_RECOGNIZED",
  "TEMPLATE_CONTROL_FLOW_NOT_COMPILED",
  "WATCH_RULE_NOT_INTERPRETED"
] as const;
export const EXTERNAL_BLOCKER_CODES = [
  "BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED",
  "PAYLOAD_PROJECTION_UNVERIFIED"
] as const;
// code -> which projections that code may legitimately target, mirroring
// canary.ts's BLOCKER_ALLOWED_PROJECTIONS (minus "cost_projection", which
// does not exist in this schema — no per-model cost-projection layer in
// the generic path).
const BLOCKER_ALLOWED_PROJECTIONS: Readonly<
  Record<
    | (typeof LOCAL_BLOCKER_CODES)[number]
    | (typeof EXTERNAL_BLOCKER_CODES)[number],
    readonly (typeof FORM_PROJECTION_NAMES)[number][]
  >
> = {
  CALL_EXPRESSION_NOT_INTERPRETED: FORM_PROJECTION_NAMES,
  COMPUTED_RULE_NOT_INTERPRETED: ["computed_rules"],
  WATCH_RULE_NOT_INTERPRETED: ["watch_rules"],
  DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED: FORM_PROJECTION_NAMES,
  TEMPLATE_CONTROL_FLOW_NOT_COMPILED: ["conditional_rules", "controls"],
  SOURCE_PATTERN_NOT_RECOGNIZED: FORM_PROJECTION_NAMES,
  PAYLOAD_PROJECTION_UNVERIFIED: ["payload_projection"],
  BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED: ["payload_projection"]
};
const localBlockerSchema = z
  .object({
    code: z.enum(LOCAL_BLOCKER_CODES),
    projection: z.enum(FORM_PROJECTION_NAMES),
    locator: staticLocatorSchema
  })
  .strict();
const externalBlockerSchema = z
  .object({
    code: z.enum(EXTERNAL_BLOCKER_CODES),
    projection: z.enum(FORM_PROJECTION_NAMES),
    locator: z.null()
  })
  .strict();
// NOT exported: same reasoning as formProjectionSchema above — only
// blockerArraySchema (with its uniqueness/order/BLOCKER_ALLOWED_PROJECTIONS
// checks) should be a consumer-facing surface, not the bare per-item union,
// which a future caller could validate a single blocker against while
// skipping every check that actually caught bugs in this schema so far.
const blockerSchema = z.union([localBlockerSchema, externalBlockerSchema]);
type GenericFormBlocker = z.infer<typeof blockerSchema>;
// Equivalent to (not a byte-identical copy of) the adapter's own dedup key
// (normalizedBlockerKey, build-generic-form-parser-canary.ts ~953-963) —
// same fields in the same order; the join separator differs (a single
// ASCII space here, the null control character there), which does not
// change sort order or uniqueness (same reasoning as staticFactSortKey
// above). This equivalence is NOT verified by any automated guard. NOT a
// naive `${projection} ${code}` (an earlier draft's mistake): the same
// (projection, code) pair legitimately repeats at different source
// locations — the real published banana.json has (computed_rules,
// COMPUTED_RULE_NOT_INTERPRETED) six times over. Only an exact duplicate
// location is actually a duplicate.
function blockerKey(blocker: GenericFormBlocker): string {
  const locator = blocker.locator;
  return [
    blocker.projection,
    blocker.code,
    locator?.source_path ?? "",
    locator === null ? "" : String(locator.source_index).padStart(10, "0"),
    locator === null ? "" : String(locator.line).padStart(10, "0"),
    locator === null ? "" : String(locator.column).padStart(10, "0"),
    locator?.node_kind ?? ""
  ].join(" ");
}
// Unlike canary.ts's identical-looking array (.min(1) there — banana's
// compilation always produced at least one blocker), this allows an empty
// array in principle. In practice the current adapter always appends the
// two external blockers above (payload_projection is never proven/absent —
// see the result schema's test suite), so a truly empty array cannot
// happen today; the schema still permits it rather than assume that never
// changes.
export const blockerArraySchema = z
  .array(blockerSchema)
  .max(512)
  .superRefine((blockers, context) => {
    if (hasDuplicates(blockers.map(blockerKey))) {
      context.addIssue({ code: "custom", message: "Blockers must be unique." });
    }
    if (!isCanonicallyOrdered(blockers, blockerKey)) {
      context.addIssue({ code: "custom", message: "Blockers must be canonically ordered." });
    }
    for (const [index, blocker] of blockers.entries()) {
      if (!BLOCKER_ALLOWED_PROJECTIONS[blocker.code].includes(blocker.projection)) {
        addIssue(context, [index, "projection"], "Blocker cannot target this projection.");
      }
    }
  });

export const engineMetadataSchema = z
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
