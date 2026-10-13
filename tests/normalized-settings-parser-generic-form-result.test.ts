import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { NormalizedSettingsBlocker } from "../src/catalog/normalized-settings-parser-canary.js";
import type { FormProjectionName as GenericAdapterFormProjectionName } from "../tools/settings-ir/build-generic-form-parser-canary.js";
import {
  buildGenericFormParserCanaryCompilerOutput,
  type BuildGenericFormParserCanaryCompilerOutputInput
} from "../tools/settings-ir/build-generic-form-parser-canary.js";
import {
  GENERIC_IMPLEMENTATION_COMPONENT_NAMES,
  GenericFormResultError,
  assertNormalizedSettingsParserGenericFormResultUnchanged,
  findGenericFormResultPath,
  loadNormalizedSettingsParserGenericFormResult,
  normalizedSettingsParserGenericFormResultSchema,
  serializeNormalizedSettingsParserGenericFormResult,
  type NormalizedSettingsParserGenericFormResult
} from "../src/catalog/normalized-settings-parser-generic-form-result.js";
import {
  EXTERNAL_BLOCKER_CODES,
  LOCAL_BLOCKER_CODES
} from "../src/catalog/normalized-settings-parser-generic-form-vocabulary.js";

const SHA = (byte: string) => `sha256:${byte.repeat(64)}`;
const SOURCE_REF_ID = `settings-source-${"a".repeat(64)}`;
const TS = "2026-09-04T02:30:00.000Z";
// Built from joined words, not a literal token-shaped string — same style
// as tests/owner-runtime.test.ts's SECRET — so this fixture (which exists
// specifically to trigger the schema's own Bearer-token pattern detector)
// doesn't itself trip the repo's staged secret scanner.
const FAKE_BEARER_TOKEN =
  "Bearer " + ["fake", "test", "token", "value", "never", "real"].join("");
const TS_LATER = "2026-09-04T02:30:01.000Z";

function validResult(): NormalizedSettingsParserGenericFormResult {
  return {
    schema_version: "1.0.0",
    catalog_kind: "OBSERVED_NORMALIZED_SETTINGS_IR_GENERIC_FORM_RESULT",
    evidence_level: "STATIC_PINNED_SOURCE_COMPILATION",
    runtime_usable: false,
    generated_at: TS_LATER,
    source_observed_at: TS,
    bindings: {
      census_manifest: {
        schema_version: "2.0.0",
        catalog_kind: "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CENSUS_MANIFEST",
        artifact_bytes: 428_390,
        artifact_sha256: SHA("1"),
        generated_at: TS,
        cohort_sha256: SHA("2"),
        public_catalog_sha256: SHA("3"),
        source_inventory_sha256: SHA("4")
      }
    },
    scope: {
      kind: "SINGLE_FORM_NO_AUXILIARIES_V1",
      form_id: "wan-t2i",
      ai_name: "wan",
      model_ids: ["wan-t2i-1", "wan-t2i-2"],
      root_source_ref_id: SOURCE_REF_ID
    },
    source_verification: {
      status: "PINNED_SOURCE_BYTES_REFETCHED_AND_MATCHED",
      source_ref_id: SOURCE_REF_ID,
      fetched_artifacts: 2,
      verification_status: "JS_MAP_AND_SOURCE_HASH_MATCHED",
      compilation_input: true,
      vendor_source_persisted: false
    },
    form: {
      form_id: "wan-t2i",
      source_ref: {
        provider_javascript_sha256: SHA("5"),
        provider_source_map_sha256: SHA("6"),
        source_index: 2,
        source_path: "/src/components/chat/forms/settings/wan-t2i.vue",
        source_content_sha256: SHA("7")
      },
      completeness: "PARTIAL",
      projections: {
        defaults: {
          status: "PROVEN",
          proof_scope: "STATIC_LITERAL_TREE_ONLY",
          facts: [
            {
              path: ["aspect_ratio"],
              value: "1:1",
              locator: {
                source_index: 2,
                source_path: "/src/components/chat/forms/settings/wan-t2i.vue",
                source_content_sha256: SHA("7"),
                line: 3,
                column: 5,
                node_kind: "ObjectLiteralExpression"
              }
            }
          ]
        },
        controls: { status: "ABSENT_PROVEN", proof_scope: "NO_RELEVANT_STATIC_CONSTRUCT_WITHIN_COMPILER_PROFILE" },
        conditional_rules: { status: "ABSENT_PROVEN", proof_scope: "NO_RELEVANT_STATIC_CONSTRUCT_WITHIN_COMPILER_PROFILE" },
        watch_rules: { status: "BLOCKED" },
        computed_rules: { status: "ABSENT_PROVEN", proof_scope: "NO_RELEVANT_STATIC_CONSTRUCT_WITHIN_COMPILER_PROFILE" },
        payload_projection: { status: "ABSENT_PROVEN", proof_scope: "NO_RELEVANT_STATIC_CONSTRUCT_WITHIN_COMPILER_PROFILE" }
      },
      blockers: [
        {
          code: "WATCH_RULE_NOT_INTERPRETED",
          projection: "watch_rules",
          locator: {
            source_index: 2,
            source_path: "/src/components/chat/forms/settings/wan-t2i.vue",
            source_content_sha256: SHA("7"),
            line: 10,
            column: 1,
            node_kind: "CallExpression"
          }
        }
      ],
      runtime_usable: false
    },
    toolchain: {
      parser_profile: "STATIC_SETTINGS_V1",
      compilation_status: "PARTIAL_COMPILED",
      engine: {
        name: "typescript",
        version: "5.9.3",
        implementation_sha256: SHA("8"),
        execution_mode: "SYNTAX_ONLY_NO_VENDOR_EXECUTION",
        type_checking: false,
        emit: false,
        import_resolution: false
      },
      implementation_hash_algorithm: "FRAMED_COMPONENT_BYTES_SHA256_V1",
      // Derived from the schema's own exported canonical name list, sorted
      // — not retyped by hand, so this fixture cannot silently drift from
      // GENERIC_IMPLEMENTATION_COMPONENT_NAMES the way a hand-copied array
      // could.
      implementation_components: [...GENERIC_IMPLEMENTATION_COMPONENT_NAMES]
        .sort()
        .map((name, index) => ({
          name,
          bytes: 1_000 + index,
          sha256: SHA(index.toString(16))
        })),
      implementation_set_sha256: SHA("a"),
      vendor_code_executed: false
    },
    result: {
      verification_status: "EXACT_RECOMPILED_ADAPTER_OUTPUT_MATCH",
      summary: {
        scoped_models: 2,
        partial_forms: 1,
        partial_models: 2,
        proven_projections: 1,
        absent_proven_projections: 4,
        blocked_projections: 1,
        blocked_projections_with_static_candidates: 0,
        form_blockers: 1,
        runtime_usable_models: 0
      }
    },
    coverage: {
      c0_forms: 42,
      declared_forms: 1,
      unscoped_c0_forms: 41,
      c0_models: 192,
      declared_models: 2,
      unscoped_c0_models: 190,
      c0_source_refs: 123,
      declared_source_refs: 1,
      verified_source_refs: 1,
      compiled_source_units: 1,
      unscoped_c0_source_refs: 122
    },
    limitations: [
      "DECLARED_SUBSET_ONLY_NOT_FULL_COHORT",
      "FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT",
      "PINNED_BUILD_MATCH_IS_NOT_ACTIVE_BUILD_DISCOVERY",
      "PAYLOAD_AND_BACKEND_EQUIVALENCE_UNVERIFIED",
      "NO_GENERATION_OR_AUTH_CALLS_PERFORMED"
    ]
  };
}

test("accepts a well-formed synthetic generic result", () => {
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(validResult());
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

// The single most important test in this file: everything above and below
// it is a hand-built fixture the schema's own author wrote to match the
// schema, which critic-practice, critic-risk, critic-code, and
// critic-skeptic independently flagged as circular — it proves the schema
// is internally consistent, not that it accepts what its one real producer
// emits. This test instead runs the actual generic adapter
// (build-generic-form-parser-canary.ts) on a synthetic .vue and wraps its
// real, unmodified output in this schema's envelope. It would have failed
// on this file's first draft (raw compiler blocker vocabulary, non-nullable
// locator, path-only fact/blocker uniqueness keys) — that first draft
// rejected every real artifact the adapter can produce.
function vueSfc(script: string, template = "<section />"): string {
  return `<script setup lang="ts">${script}</script>\n<template>${template}</template>\n`;
}
function makeAdapterInput(
  formId: string,
  modelIds: readonly string[],
  source: string
): BuildGenericFormParserCanaryCompilerOutputInput {
  return {
    source,
    sourceRef: {
      provider_javascript_sha256: SHA("5"),
      provider_source_map_sha256: SHA("6"),
      source_index: 2,
      source_path: `/src/components/chat/forms/settings/${formId}.vue`,
      source_content_sha256: `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`
    },
    formId,
    expectedAiName: "wan",
    modelIds,
    auxiliarySourceRefIds: []
  };
}

test("accepts the real generic adapter's actual output, unmodified", () => {
  const formId = "wan-t2i";
  const modelIds = ["wan-t2i-1", "wan-t2i-2"];
  const source = vueSfc(`
const SCOPE = "image"
const AI_NAME = "wan"
const defaultSettings = { aspect_ratio: "1:1", image_size: "2K" }
`);
  const adapterInput = makeAdapterInput(formId, modelIds, source);
  const compiled = buildGenericFormParserCanaryCompilerOutput(adapterInput);
  const compiledForm = compiled.forms[0];

  const result: NormalizedSettingsParserGenericFormResult = {
    ...validResult(),
    scope: {
      kind: "SINGLE_FORM_NO_AUXILIARIES_V1",
      form_id: formId,
      ai_name: "wan",
      model_ids: modelIds,
      root_source_ref_id: SOURCE_REF_ID
    },
    source_verification: {
      status: "PINNED_SOURCE_BYTES_REFETCHED_AND_MATCHED",
      source_ref_id: SOURCE_REF_ID,
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
      // The adapter's own blocker type is canary.ts's NormalizedSettingsBlocker,
      // whose external-blocker projection union structurally also allows
      // "cost_projection" (a per-model concept canary.ts has and this
      // schema deliberately does not) even though the generic adapter never
      // actually assigns that value — safe to narrow here.
      blockers: [...compiledForm.blockers] as NormalizedSettingsParserGenericFormResult["form"]["blockers"],
      runtime_usable: false
    },
    toolchain: {
      ...validResult().toolchain,
      engine: compiled.engine
    },
    result: {
      verification_status: "EXACT_RECOMPILED_ADAPTER_OUTPUT_MATCH",
      summary: {
        scoped_models: 2,
        partial_forms: 1,
        // payload_projection is always BLOCKED by the current adapter
        // (never proven/absent), so every scoped model is partial —
        // there is no clean-compile case to model here, unlike the
        // hand-built fixture above. Numbers below are the adapter's
        // ACTUAL output for this exact source, read by running it once
        // (node --input-type=module against dist/), not guessed:
        // defaults PROVEN, watch_rules/computed_rules ABSENT_PROVEN,
        // controls/conditional_rules/payload_projection BLOCKED, 4
        // blockers (2 SOURCE_PATTERN_NOT_RECOGNIZED + the 2 unconditional
        // external ones).
        partial_models: 2,
        proven_projections: 1,
        absent_proven_projections: 2,
        blocked_projections: 3,
        blocked_projections_with_static_candidates: 0,
        form_blockers: compiledForm.blockers.length,
        runtime_usable_models: 0
      }
    },
    coverage: {
      ...validResult().coverage,
      declared_models: 2,
      unscoped_c0_models: 190
    }
  };

  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(result);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2));
});

test("schema permits a hypothetical fully clean form (0 blockers) even though today's adapter can never produce one", () => {
  // payload_projection is unconditionally BLOCKED by the current adapter
  // (build-generic-form-parser-canary.ts) and it unconditionally appends
  // two external blockers — so an artifact this clean cannot exist today.
  // This test is deliberately schema-only: it proves the schema does not
  // over-constrain a shape that could become reachable if that adapter
  // behavior ever changes, not that today's producer can reach it.
  const clean = validResult();
  clean.form.blockers = [];
  clean.form.projections.watch_rules = {
    status: "ABSENT_PROVEN",
    proof_scope: "NO_RELEVANT_STATIC_CONSTRUCT_WITHIN_COMPILER_PROFILE"
  };
  clean.result.summary = {
    scoped_models: 2,
    partial_forms: 1,
    partial_models: 0,
    proven_projections: 1,
    absent_proven_projections: 5,
    blocked_projections: 0,
    blocked_projections_with_static_candidates: 0,
    form_blockers: 0,
    runtime_usable_models: 0
  };
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(clean);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

test("accepts a single-model form (not just multi-model) — model_ids just needs length >= 1", () => {
  const single = validResult();
  single.scope.model_ids = ["wan-t2i-1"];
  single.coverage.declared_models = 1;
  single.coverage.unscoped_c0_models = 191;
  single.result.summary.scoped_models = 1;
  single.result.summary.partial_models = 1;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(single);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

test("rejects form.form_id that disagrees with scope.form_id", () => {
  const tampered = validResult();
  tampered.form.form_id = "different-form";
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects a source_path that does not encode the declared form_id", () => {
  const tampered = validResult();
  tampered.form.source_ref.source_path =
    "/src/components/chat/forms/settings/not-wan-t2i.vue";
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects source_verification.source_ref_id that disagrees with scope.root_source_ref_id", () => {
  const tampered = validResult();
  tampered.source_verification.source_ref_id = `settings-source-${"b".repeat(64)}`;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects scoped_models that disagrees with scope.model_ids.length", () => {
  const tampered = validResult();
  tampered.result.summary.scoped_models = 4;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects declared_models that disagrees with scope.model_ids.length", () => {
  const tampered = validResult();
  tampered.coverage.declared_models = 99;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects unscoped_c0_forms that is not c0_forms - 1", () => {
  const tampered = validResult();
  tampered.coverage.unscoped_c0_forms = 40;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects unscoped_c0_models that is not c0_models - declared_models", () => {
  const tampered = validResult();
  tampered.coverage.unscoped_c0_models = 999;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects unscoped_c0_source_refs that is not c0_source_refs - 1", () => {
  const tampered = validResult();
  tampered.coverage.unscoped_c0_source_refs = 0;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects a summary that disagrees with the actual recorded projections/blockers", () => {
  const tampered = validResult();
  tampered.result.summary.proven_projections = 99;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects blocked_projections that disagrees with the actual recorded projections", () => {
  const tampered = validResult();
  tampered.result.summary.blocked_projections = 0;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects partial_models that disagrees with whether the form actually has blockers", () => {
  const tampered = validResult();
  tampered.result.summary.partial_models = 0;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects a duplicate blocker (identical code+projection+locator twice)", () => {
  const tampered = validResult();
  tampered.form.blockers = [tampered.form.blockers[0]!, tampered.form.blockers[0]!];
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("accepts the same (projection, code) pair at two different locations (not a duplicate)", () => {
  // The real published banana.json has (computed_rules,
  // COMPUTED_RULE_NOT_INTERPRETED) six times at different locations — a
  // path-and-code-only uniqueness key (this file's first-draft mistake)
  // would wrongly reject this.
  const tampered = validResult();
  const first = tampered.form.blockers[0]!;
  assert.equal(first.locator !== null, true);
  const second: NormalizedSettingsParserGenericFormResult["form"]["blockers"][number] =
    first.locator === null
      ? first
      : { ...first, locator: { ...first.locator, line: first.locator.line + 1 } };
  tampered.form.blockers = [first, second];
  tampered.result.summary.form_blockers = 2;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

test("rejects duplicate model_ids", () => {
  const tampered = validResult();
  tampered.scope.model_ids = ["wan-t2i-1", "wan-t2i-1"];
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects unsorted model_ids", () => {
  const tampered = validResult();
  tampered.scope.model_ids = ["wan-t2i-2", "wan-t2i-1"];
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects a BLOCKED projection with no matching blocker", () => {
  const tampered = validResult();
  tampered.form.blockers = [];
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects a blocker targeting a non-BLOCKED projection", () => {
  const tampered = validResult();
  tampered.form.blockers = [
    { ...tampered.form.blockers[0]!, projection: "defaults" }
  ];
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects a blocker code paired with a projection it is not allowed to target", () => {
  const tampered = validResult();
  // COMPUTED_RULE_NOT_INTERPRETED may only target computed_rules per
  // BLOCKER_ALLOWED_PROJECTIONS — pointing it at watch_rules (which the
  // fixture already has BLOCKED with a matching WATCH_RULE_NOT_INTERPRETED)
  // is a code/projection mismatch even though the projection is BLOCKED.
  const original = tampered.form.blockers[0]!;
  assert.equal(original.locator !== null, true, "fixture invariant: blockers[0] must have a real locator");
  const locator = original.locator!;
  tampered.form.blockers = [
    { code: "COMPUTED_RULE_NOT_INTERPRETED", projection: original.projection, locator }
  ];
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects a fact whose locator points outside the compiled source", () => {
  const tampered = validResult();
  const proven = tampered.form.projections.defaults;
  assert.equal(proven.status, "PROVEN");
  tampered.form.projections.defaults = {
    status: "PROVEN",
    proof_scope: "STATIC_LITERAL_TREE_ONLY",
    facts: [
      {
        ...proven.facts[0]!,
        locator: { ...proven.facts[0]!.locator, source_path: "/src/components/chat/forms/settings/other-form.vue" }
      }
    ]
  };
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects a blocker whose locator points outside the compiled source", () => {
  const tampered = validResult();
  const blocker = tampered.form.blockers[0]!;
  assert.equal(blocker.locator !== null, true);
  tampered.form.blockers = [
    blocker.locator === null
      ? blocker
      : { ...blocker, locator: { ...blocker.locator, source_content_sha256: SHA("f") } }
  ];
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects a secret-like literal reaching a PROVEN fact's value", () => {
  const tampered = validResult();
  tampered.form.projections.defaults = {
    status: "PROVEN",
    proof_scope: "STATIC_LITERAL_TREE_ONLY",
    facts: [
      {
        path: ["api_key"],
        value: FAKE_BEARER_TOKEN,
        locator: tampered.form.projections.defaults.status === "PROVEN"
          ? tampered.form.projections.defaults.facts[0]!.locator
          : (() => {
              throw new Error("fixture invariant broken");
            })()
      }
    ]
  };
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects a reserved static key like __proto__", () => {
  const tampered = validResult();
  const original = tampered.form.projections.defaults;
  assert.equal(original.status, "PROVEN");
  tampered.form.projections.defaults = {
    status: "PROVEN",
    proof_scope: "STATIC_LITERAL_TREE_ONLY",
    facts: [{ ...original.facts[0]!, path: ["__proto__"] }]
  };
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects an unknown blocker code outside the local/external vocabulary", () => {
  const tampered = validResult();
  const raw: unknown = {
    blockers: [{ code: "NOT_A_REAL_BLOCKER_CODE", projection: "watch_rules", locator: tampered.form.blockers[0]!.locator }]
  };
  tampered.form.blockers = (raw as { blockers: typeof tampered.form.blockers }).blockers;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects an implementation_components list missing one of the canonical names", () => {
  const tampered = validResult();
  const all = tampered.toolchain.implementation_components;
  tampered.toolchain.implementation_components = all.slice(0, all.length - 1);
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects a duplicate implementation_components name (even with the total entry count otherwise correct)", () => {
  const tampered = validResult();
  const components = tampered.toolchain.implementation_components;
  tampered.toolchain.implementation_components = [
    components[0]!,
    components[0]!,
    ...components.slice(2)
  ];
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects extra unknown top-level keys (strict schema)", () => {
  const tampered = validResult() as NormalizedSettingsParserGenericFormResult & {
    extra_field?: string;
  };
  tampered.extra_field = "should not be allowed";
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

test("rejects generated_at earlier than source_observed_at", () => {
  const tampered = validResult();
  tampered.generated_at = TS;
  tampered.source_observed_at = TS_LATER;
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(tampered);
  assert.equal(parsed.success, false);
});

// Compile-time drift guards. The blocker-code guard checks the SCHEMA's
// OWN exported LOCAL_BLOCKER_CODES/EXTERNAL_BLOCKER_CODES arrays (not a
// hand-retyped union — round 2 of this file's own critic-review found that
// a retyped union lets the schema's real arrays drift without this guard
// ever noticing) against canary.ts's real exported type, checked BOTH ways
// so it actually proves equality rather than one-directional coverage. The
// earlier version of this guard checked against StaticSettingsBlockerCode
// (the compiler's raw 21-code vocabulary), which let the exact bug
// practice/risk/code/skeptic all found pass typecheck.
type SchemaBlockerCode =
  | (typeof LOCAL_BLOCKER_CODES)[number]
  | (typeof EXTERNAL_BLOCKER_CODES)[number];
type BlockerCodeMatchesCanaryExactly =
  NormalizedSettingsBlocker["code"] extends SchemaBlockerCode
    ? SchemaBlockerCode extends NormalizedSettingsBlocker["code"]
      ? true
      : false
    : false;
const blockerCodeVocabularyMatches: BlockerCodeMatchesCanaryExactly = true;
void blockerCodeVocabularyMatches;

type ProjectionNameIsSubsetOfAdapter = GenericAdapterFormProjectionName extends
  | "defaults"
  | "controls"
  | "conditional_rules"
  | "watch_rules"
  | "computed_rules"
  | "payload_projection"
  ? true
  : false;
const projectionNameVocabularyMatches: ProjectionNameIsSubsetOfAdapter = true;
void projectionNameVocabularyMatches;

// --- Persistence: findGenericFormResultPath / load / serialize / assertUnchanged ---

test("findGenericFormResultPath resolves inside this repository's catalog/runtime/v4, not just a matching suffix", () => {
  // A weaker endsWith-only check (this file's first-draft test) would still
  // pass for a path that escaped the repository into a sibling directory —
  // round 2 critic-code proved this by executing the resolver from a
  // src/catalog/ (not dist/) module location and finding it could resolve
  // one level above the project root. Comparing the full resolved path
  // against the actual project root rules that out.
  const path = findGenericFormResultPath("wan-t2i");
  const projectRoot = resolve(process.cwd());
  assert.equal(
    resolve(path),
    resolve(projectRoot, "catalog/runtime/v4/wan-t2i-generic-form-result.json")
  );
});

test("findGenericFormResultPath rejects a form_id that does not match the pattern", () => {
  for (const invalid of ["Not Valid!", "..", "../../etc/passwd", "a/b", "a.b", ""]) {
    assert.throws(
      () => findGenericFormResultPath(invalid),
      (error: unknown) =>
        error instanceof GenericFormResultError &&
        error.code === "GENERIC_FORM_ID_INVALID" &&
        error.formId === invalid,
      `expected rejection for ${JSON.stringify(invalid)}`
    );
  }
});

test("serializeNormalizedSettingsParserGenericFormResult produces canonical, newline-terminated JSON", () => {
  const text = serializeNormalizedSettingsParserGenericFormResult(validResult());
  assert.equal(text.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(text), validResult());
});

test("serializeNormalizedSettingsParserGenericFormResult rejects an invalid result even if the caller's type claims otherwise", () => {
  const tampered = validResult();
  tampered.scope.model_ids = [];
  assert.throws(() => serializeNormalizedSettingsParserGenericFormResult(tampered));
});

async function withTempDirectory<T>(
  run: (directory: string) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-generic-form-result-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("loadNormalizedSettingsParserGenericFormResult round-trips a written artifact", async () => {
  await withTempDirectory(async (directory) => {
    const path = join(directory, "wan-t2i-generic-form-result.json");
    await writeFile(path, serializeNormalizedSettingsParserGenericFormResult(validResult()), "utf8");
    const loaded = loadNormalizedSettingsParserGenericFormResult("wan-t2i", { path });
    assert.deepEqual(loaded, validResult());
  });
});

test("loadNormalizedSettingsParserGenericFormResult rejects a form_id that does not match the file's own scope", async () => {
  await withTempDirectory(async (directory) => {
    const path = join(directory, "wan-t2i-generic-form-result.json");
    await writeFile(path, serializeNormalizedSettingsParserGenericFormResult(validResult()), "utf8");
    assert.throws(
      () => loadNormalizedSettingsParserGenericFormResult("different-form", { path }),
      (error: unknown) =>
        error instanceof GenericFormResultError && error.code === "GENERIC_FORM_RESULT_INVALID"
    );
  });
});

test("loadNormalizedSettingsParserGenericFormResult rejects malformed JSON, not as NOT_FOUND", () => {
  return withTempDirectory(async (directory) => {
    const path = join(directory, "wan-t2i-generic-form-result.json");
    await writeFile(path, "{ not valid json", "utf8");
    assert.throws(
      () => loadNormalizedSettingsParserGenericFormResult("wan-t2i", { path }),
      (error: unknown) =>
        error instanceof GenericFormResultError &&
        error.code === "GENERIC_FORM_RESULT_INVALID" &&
        error.formId === "wan-t2i" &&
        error.cause !== undefined
    );
  });
});

test("loadNormalizedSettingsParserGenericFormResult rejects a schema-invalid but syntactically valid JSON file", () => {
  return withTempDirectory(async (directory) => {
    const path = join(directory, "wan-t2i-generic-form-result.json");
    await writeFile(path, JSON.stringify({}), "utf8");
    assert.throws(
      () => loadNormalizedSettingsParserGenericFormResult("wan-t2i", { path }),
      (error: unknown) =>
        error instanceof GenericFormResultError &&
        error.code === "GENERIC_FORM_RESULT_INVALID" &&
        error.cause !== undefined
    );
  });
});

test("loadNormalizedSettingsParserGenericFormResult distinguishes a missing file from a corrupt one", () => {
  // GENERIC_FORM_RESULT_NOT_FOUND (not the generic INVALID code) — a future
  // writer deciding whether it is safe to create an artifact needs "nothing
  // here yet" distinguishable from "something here is broken" (round 2,
  // critic-code).
  assert.throws(
    () =>
      loadNormalizedSettingsParserGenericFormResult("wan-t2i", {
        path: "/definitely/does/not/exist.json"
      }),
    (error: unknown) =>
      error instanceof GenericFormResultError &&
      error.code === "GENERIC_FORM_RESULT_NOT_FOUND" &&
      error.formId === "wan-t2i" &&
      error.cause !== undefined
  );
});

test("loadNormalizedSettingsParserGenericFormResult rejects an invalid explicit formId before touching the filesystem", () => {
  assert.throws(
    () =>
      loadNormalizedSettingsParserGenericFormResult("../../etc/passwd", {
        path: "/definitely/does/not/exist.json"
      }),
    (error: unknown) =>
      error instanceof GenericFormResultError && error.code === "GENERIC_FORM_ID_INVALID"
  );
});

test("assertNormalizedSettingsParserGenericFormResultUnchanged accepts an identical result", () => {
  assert.doesNotThrow(() =>
    assertNormalizedSettingsParserGenericFormResultUnchanged(validResult(), validResult())
  );
});

test("assertNormalizedSettingsParserGenericFormResultUnchanged rejects drift", () => {
  const changed = validResult();
  changed.generated_at = "2026-09-04T02:30:02.000Z";
  assert.throws(
    () => assertNormalizedSettingsParserGenericFormResultUnchanged(validResult(), changed),
    (error: unknown) =>
      error instanceof GenericFormResultError &&
      error.code === "GENERIC_FORM_RESULT_DRIFT_DETECTED"
  );
});
