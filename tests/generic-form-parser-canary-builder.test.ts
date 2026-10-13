import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { StaticSettingsSourceRef } from "../src/catalog/normalized-settings-parser-canary.js";
import {
  BananaParserCanaryCompilerError,
  buildBananaParserCanaryCompilerOutput
} from "../tools/settings-ir/build-banana-parser-canary.js";
import {
  GenericFormParserCanaryCompilerError,
  buildGenericFormParserCanaryCompilerOutput,
  type BuildGenericFormParserCanaryCompilerOutputInput
} from "../tools/settings-ir/build-generic-form-parser-canary.js";

const ARTIFACT_SHA256 = `sha256:${"2".repeat(64)}`;
const BANANA_MODEL_IDS = ["banana", "banana2", "banana3", "banana3_light"];

// This suite exists to prove the generic adapter (built for the other 41
// forms) reproduces the Banana adapter's behavior when called with Banana's
// own parameters, on the same synthetic fixtures the Banana suite already
// uses — both on the accept path (PROVEN facts, not just BLOCKED ones) and
// on every reject path Banana itself tests. Field-by-field equality (via
// assert.deepEqual, not literal byte comparison) minus
// engine.implementation_sha256 (which necessarily differs — it hashes a
// different file) is the regression evidence, and it is only as strong as
// what each test actually forces the two adapters to disagree on.

function genericBananaInput(
  overrides: Partial<BuildGenericFormParserCanaryCompilerOutputInput> & {
    source: string;
  }
): BuildGenericFormParserCanaryCompilerOutputInput {
  return {
    sourceRef: makeSourceRef(overrides.source, "banana"),
    formId: "banana",
    expectedAiName: "banana",
    modelIds: BANANA_MODEL_IDS,
    auxiliarySourceRefIds: [],
    ...overrides
  };
}

test("reproduces the Banana adapter's BLOCKED-path output when called with Banana's parameters", () => {
  const source = vueSfc(`
import { computed, watch } from "vue"
const SCOPE = "image"
const AI_NAME = "banana"
const settingsGroups = { format: ["aspect_ratio"] }
const defaultSettings = {
  aspect_ratio: "9:16",
  image_size: "2K",
  seed: resolveSeed()
}
const controls = computed(() => [{ id: "quality" }])
watch(AI_NAME, () => {})
`, `<section v-if="visible" />`);

  const bananaOutput = buildBananaParserCanaryCompilerOutput({
    source,
    sourceRef: makeSourceRef(source, "banana")
  });
  const genericOutput = buildGenericFormParserCanaryCompilerOutput(
    genericBananaInput({ source })
  );

  assert.equal(genericOutput.parser_profile, bananaOutput.parser_profile);
  assert.deepEqual(genericOutput.forms[0]!.form_id, bananaOutput.forms[0]!.form_id);
  assert.deepEqual(
    genericOutput.forms[0]!.source_ref,
    bananaOutput.forms[0]!.source_ref
  );
  assert.deepEqual(
    genericOutput.forms[0]!.projections,
    bananaOutput.forms[0]!.projections
  );
  assert.deepEqual(genericOutput.forms[0]!.blockers, bananaOutput.forms[0]!.blockers);
  assert.deepEqual(genericOutput.forms[0]!.model_ids, BANANA_MODEL_IDS);
  assert.equal(genericOutput.engine.name, bananaOutput.engine.name);
  assert.equal(genericOutput.engine.version, bananaOutput.engine.version);
  assert.equal(
    genericOutput.engine.execution_mode,
    bananaOutput.engine.execution_mode
  );
  assert.equal(genericOutput.engine.type_checking, bananaOutput.engine.type_checking);
  assert.equal(genericOutput.engine.emit, bananaOutput.engine.emit);
  assert.equal(
    genericOutput.engine.import_resolution,
    bananaOutput.engine.import_resolution
  );
  // Deliberately NOT equal: each adapter hashes its own file on disk plus
  // the shared static-settings-compiler.js, so the two implementation sets
  // are genuinely different bytes.
  assert.notEqual(
    genericOutput.engine.implementation_sha256,
    bananaOutput.engine.implementation_sha256
  );
});

test("reproduces the Banana adapter's PROVEN-path output when called with Banana's parameters", () => {
  // Same identical value across all four Banana models — unlike the
  // BLOCKED-path fixture above, this exercises buildBindingProjection's
  // PROVEN branch (allBindingsEqual across a real multi-model tuple), which
  // is the code path that will actually produce a future artifact's data.
  const source = vueSfc(`
const SCOPE = "image"
const AI_NAME = "banana"
const defaultSettings = { aspect_ratio: "1:1", image_size: "2K" }
`);

  const bananaOutput = buildBananaParserCanaryCompilerOutput({
    source,
    sourceRef: makeSourceRef(source, "banana")
  });
  const genericOutput = buildGenericFormParserCanaryCompilerOutput(
    genericBananaInput({ source })
  );

  assert.equal(
    bananaOutput.forms[0]!.projections.defaults.status,
    "PROVEN",
    "fixture must actually exercise the PROVEN branch"
  );
  assert.deepEqual(
    genericOutput.forms[0]!.projections,
    bananaOutput.forms[0]!.projections
  );
  assert.deepEqual(genericOutput.forms[0]!.blockers, bananaOutput.forms[0]!.blockers);
});

test("matches Banana's reject outcome when the source no longer matches its pinned hash", () => {
  const validSource = vueSfc(`
const SCOPE = "image"
const AI_NAME = "banana"
`);
  // sourceRef stays pinned to validSource's hash; the source passed to each
  // adapter is one byte different — both must reject on the mismatch.
  const staleSourceRef = makeSourceRef(validSource, "banana");
  const driftedSource = `${validSource}\n`;

  assert.throws(
    () =>
      buildBananaParserCanaryCompilerOutput({
        source: driftedSource,
        sourceRef: staleSourceRef
      }),
    hasBananaCode("SOURCE_RELATIONSHIP_INVALID")
  );
  assert.throws(
    () =>
      buildGenericFormParserCanaryCompilerOutput(
        genericBananaInput({ source: driftedSource, sourceRef: staleSourceRef })
      ),
    hasCode("SOURCE_RELATIONSHIP_INVALID")
  );
});

test("matches Banana's reject outcome when SCOPE changes without updating the pinned hash", () => {
  const validSource = vueSfc(`
const SCOPE = "image"
const AI_NAME = "banana"
`);
  // sourceRef stays pinned to validSource's hash; the source passed to each
  // adapter has a different SCOPE value baked in — hash no longer matches.
  const staleSourceRef = makeSourceRef(validSource, "banana");
  const changedSource = validSource.replace('"image"', '"video"');

  assert.throws(
    () =>
      buildBananaParserCanaryCompilerOutput({
        source: changedSource,
        sourceRef: staleSourceRef
      }),
    hasBananaCode("SOURCE_RELATIONSHIP_INVALID")
  );
  assert.throws(
    () =>
      buildGenericFormParserCanaryCompilerOutput(
        genericBananaInput({ source: changedSource, sourceRef: staleSourceRef })
      ),
    hasCode("SOURCE_RELATIONSHIP_INVALID")
  );
});

test("matches Banana's reject outcome on an oversize source", () => {
  const oversizeSource = "x".repeat(1_048_577);
  const sourceRef = makeSourceRef(oversizeSource, "banana");

  assert.throws(
    () =>
      buildBananaParserCanaryCompilerOutput({
        source: oversizeSource,
        sourceRef
      }),
    hasBananaCode("PARSER_OUTPUT_INVALID")
  );
  assert.throws(
    () =>
      buildGenericFormParserCanaryCompilerOutput(
        genericBananaInput({ source: oversizeSource, sourceRef })
      ),
    hasCode("PARSER_OUTPUT_INVALID")
  );
});

test("is deterministic for the same verified source, like the Banana adapter", () => {
  const source = vueSfc(`
const SCOPE = "image"
const AI_NAME = "banana"
const defaultSettings = { aspect_ratio: "1:1" }
`);
  const input = genericBananaInput({ source });
  const first = buildGenericFormParserCanaryCompilerOutput(input);
  const second = buildGenericFormParserCanaryCompilerOutput(input);
  assert.deepEqual(first, second);
});

test("never leaks source text into the output, like the Banana adapter", () => {
  const source = vueSfc(`
import { computed } from "vue"
const SCOPE = "image"
const AI_NAME = "banana"
const controls = computed(() => resolveSeed())
`, `<section v-if="visible" />`);
  const output = buildGenericFormParserCanaryCompilerOutput(
    genericBananaInput({ source })
  );
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes("import {"), false);
  assert.equal(serialized.includes("resolveSeed"), false);
  assert.equal(serialized.includes("v-if="), false);
});

test("attributes a single-model form's PROVEN facts to the exact model set compiled", () => {
  // With only one model, allBindingsEqual across a one-element array is
  // trivially true — nothing in buildBindingProjection alone would catch a
  // model-id-derived value being promoted as if it held for the whole form.
  // model_ids in the output is the (partial, see DEBT-027) mitigation: the
  // artifact at least records which models this PROVEN fact actually covers.
  const source = vueSfc(`
const SCOPE = "audio"
const AI_NAME = "elevenlabs"
const defaultSettings = { model: model_id }
`);
  const output = buildGenericFormParserCanaryCompilerOutput({
    source,
    sourceRef: makeSourceRef(source, "elevenlabs"),
    formId: "elevenlabs",
    expectedAiName: "elevenlabs",
    modelIds: ["elevenlabs-v1"],
    auxiliarySourceRefIds: []
  });
  assert.deepEqual(output.forms[0]!.model_ids, ["elevenlabs-v1"]);
  const defaults = output.forms[0]!.projections.defaults;
  assert.equal(defaults.status, "PROVEN");
  assert.equal(
    defaults.status === "PROVEN" && defaults.facts[0]!.value,
    "elevenlabs-v1"
  );
});

test("compiles a different form id with a different model count and AI name", () => {
  const source = vueSfc(`
const SCOPE = "video"
const AI_NAME = "seedance"
const defaultSettings = { duration: 5, resolution: "1080p" }
`);
  const output = buildGenericFormParserCanaryCompilerOutput({
    source,
    sourceRef: makeSourceRef(source, "seedance"),
    formId: "seedance",
    expectedAiName: "seedance",
    modelIds: ["seedance-1", "seedance-1-pro"],
    auxiliarySourceRefIds: []
  });

  assert.equal(output.forms.length, 1);
  const form = output.forms[0]!;
  assert.equal(form.form_id, "seedance");
  assert.deepEqual(form.model_ids, ["seedance-1", "seedance-1-pro"]);
  assert.equal(form.projections.defaults.status, "PROVEN");
});

test("rejects a form whose models disagree on SCOPE", () => {
  const source = vueSfc(`
const SCOPE = model_id === "x1" ? "image" : "video"
const AI_NAME = "mixed"
`);
  assert.throws(
    () =>
      buildGenericFormParserCanaryCompilerOutput({
        source,
        sourceRef: makeSourceRef(source, "mixed"),
        formId: "mixed",
        expectedAiName: "mixed",
        modelIds: ["x1", "x2"],
        auxiliarySourceRefIds: []
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );
});

test("rejects AI_NAME mismatch, empty/oversize/duplicate modelIds, and malformed formId", () => {
  const source = vueSfc(`
const SCOPE = "image"
const AI_NAME = "actual"
`);
  const sourceRef = makeSourceRef(source, "actual");

  assert.throws(
    () =>
      buildGenericFormParserCanaryCompilerOutput({
        source,
        sourceRef,
        formId: "actual",
        expectedAiName: "wrong",
        modelIds: ["m1"],
        auxiliarySourceRefIds: []
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );
  assert.throws(
    () =>
      buildGenericFormParserCanaryCompilerOutput({
        source,
        sourceRef,
        formId: "actual",
        expectedAiName: "actual",
        modelIds: [],
        auxiliarySourceRefIds: []
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );
  assert.throws(
    () =>
      buildGenericFormParserCanaryCompilerOutput({
        source,
        sourceRef,
        formId: "actual",
        expectedAiName: "actual",
        modelIds: Array.from({ length: 65 }, (_, i) => `m${i}`),
        auxiliarySourceRefIds: []
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );
  assert.throws(
    () =>
      buildGenericFormParserCanaryCompilerOutput({
        source,
        sourceRef,
        formId: "actual",
        expectedAiName: "actual",
        modelIds: ["m1", "m1"],
        auxiliarySourceRefIds: []
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );
  for (const badFormId of ["Actual", "actual!", "-actual", "a".repeat(65), ""]) {
    assert.throws(
      () =>
        buildGenericFormParserCanaryCompilerOutput({
          source,
          sourceRef: makeSourceRef(source, badFormId || "actual"),
          formId: badFormId,
          expectedAiName: "actual",
          modelIds: ["m1"],
          auxiliarySourceRefIds: []
        }),
      hasCode("PARSER_OUTPUT_INVALID"),
      `formId ${JSON.stringify(badFormId)} should be rejected`
    );
  }
});

test("rejects source/sourceRef path mismatch for the given formId", () => {
  const source = vueSfc(`
const SCOPE = "image"
const AI_NAME = "actual"
`);
  assert.throws(
    () =>
      buildGenericFormParserCanaryCompilerOutput({
        source,
        sourceRef: makeSourceRef(source, "actual"),
        formId: "other-form",
        expectedAiName: "actual",
        modelIds: ["m1"],
        auxiliarySourceRefIds: []
      }),
    hasCode("SOURCE_RELATIONSHIP_INVALID")
  );
});

test("rejects any non-empty auxiliarySourceRefIds instead of silently compiling only the root", () => {
  const source = vueSfc(`
const SCOPE = "image"
const AI_NAME = "actual"
`);
  assert.throws(
    () =>
      buildGenericFormParserCanaryCompilerOutput({
        source,
        sourceRef: makeSourceRef(source, "actual"),
        formId: "actual",
        expectedAiName: "actual",
        modelIds: ["m1"],
        auxiliarySourceRefIds: ["settings-source-abc"]
      }),
    hasCode("AUXILIARY_SOURCE_REFS_NOT_SUPPORTED")
  );
});

function vueSfc(script: string, template = "<section />"): string {
  return `<script setup lang="ts">${script}</script>\n<template>${template}</template>\n`;
}

function makeSourceRef(
  source: string,
  formId: string
): StaticSettingsSourceRef {
  return {
    provider_javascript_sha256: ARTIFACT_SHA256,
    provider_source_map_sha256: ARTIFACT_SHA256,
    source_index: 2,
    source_path: `/src/components/chat/forms/settings/${formId}.vue`,
    source_content_sha256: `sha256:${createHash("sha256")
      .update(source, "utf8")
      .digest("hex")}`
  };
}

function hasCode(code: GenericFormParserCanaryCompilerError["code"]) {
  return (error: unknown): boolean =>
    error instanceof GenericFormParserCanaryCompilerError &&
    error.code === code;
}

function hasBananaCode(code: BananaParserCanaryCompilerError["code"]) {
  return (error: unknown): boolean =>
    error instanceof BananaParserCanaryCompilerError && error.code === code;
}
