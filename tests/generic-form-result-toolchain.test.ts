import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  loadNormalizedSettingsParserCensusManifest,
  serializeNormalizedSettingsParserCensusManifest
} from "../src/catalog/normalized-settings-parser-census-manifest.js";
import { GENERIC_IMPLEMENTATION_COMPONENT_NAMES } from "../src/catalog/normalized-settings-parser-generic-form-result.js";
import { loadSettingsSourceInventory } from "../src/catalog/settings-source-inventory.js";
import { loadSyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import {
  buildGenericFormParserCanaryCompilerOutput,
  type BuildGenericFormParserCanaryCompilerOutputInput
} from "../tools/settings-ir/build-generic-form-parser-canary.js";
import { GenericFormAdapterManifestDeriveError } from "../tools/settings-ir/generic-form-adapter-input-from-manifest.js";
import {
  GenericFormResultToolchainError,
  assembleGenericFormResult,
  buildGenericFormResultFromPinnedSource,
  buildImplementationComponentRecords
} from "../tools/settings-ir/generic-form-result-toolchain.js";
import { SettingsSourceInventoryError } from "../src/catalog/settings-source-inventory.js";

// Two layers of coverage here, deliberately kept separate:
//
// 1. buildGenericFormResultFromPinnedSource's gates and loaders — tested
//    fully offline, against the real committed census manifest, proving
//    both fail-closed gates run (and run in the right order) before any
//    network call happens.
// 2. assembleGenericFormResult — the pure, network-free envelope
//    construction step — tested with a real synthetic compile, reaching
//    schema validation directly. This exists because every BLOCK bug
//    found in this module's first review round (a missing required
//    summary field, a mis-ordered implementation-component list, a
//    checkout-path-dependent hash) lived in exactly this step, and none
//    of layer 1's tests could ever have caught them: all five of them stop
//    before or at the network call. A full happy-path test of
//    buildGenericFormResultFromPinnedSource itself, through a real gated
//    network fetch, remains a separate, deliberate, logged step — not
//    something to fake convincingly offline.

function throwingFetch(): typeof fetch {
  return (() => {
    throw new Error("must not fetch");
  }) as unknown as typeof fetch;
}

test("rejects any confirmedSourceFetch value other than the boolean true, before any network call", async () => {
  const nonTrueValues: unknown[] = [undefined, false, 0, "true", "false", 1, null];
  for (const value of nonTrueValues) {
    await assert.rejects(
      () =>
        buildGenericFormResultFromPinnedSource({
          formId: "banana",
          confirmedSourceFetch: value as unknown as boolean,
          fetchImpl: throwingFetch()
        }),
      (error: unknown) =>
        error instanceof GenericFormResultToolchainError &&
        error.code === "GENERIC_TOOLCHAIN_SOURCE_FETCH_NOT_CONFIRMED",
      `expected rejection for confirmedSourceFetch = ${JSON.stringify(value)}`
    );
  }
});

test("rejects a non-object input before any network call", async () => {
  await assert.rejects(
    () =>
      buildGenericFormResultFromPinnedSource(
        null as unknown as Parameters<typeof buildGenericFormResultFromPinnedSource>[0]
      ),
    (error: unknown) =>
      error instanceof GenericFormResultToolchainError &&
      error.code === "GENERIC_TOOLCHAIN_INVALID_INPUT_SHAPE"
  );
});

test("rejects a form with non-empty auxiliary_source_ref_ids before any network call", async () => {
  // "beeble" is a real form in the committed census manifest — verified
  // here by reading the manifest, not assumed, since a future census
  // resync could change which forms have auxiliary refs.
  const censusManifest = loadNormalizedSettingsParserCensusManifest();
  const beeble = censusManifest.forms.find((form) => form.form_id === "beeble");
  assert.ok(beeble !== undefined, "expected 'beeble' to exist in the committed census manifest");
  assert.ok(
    beeble.auxiliary_source_ref_ids.length > 0,
    "expected 'beeble' to have at least one auxiliary source ref"
  );

  await assert.rejects(
    () =>
      buildGenericFormResultFromPinnedSource({
        formId: "beeble",
        confirmedSourceFetch: true,
        fetchImpl: throwingFetch()
      }),
    (error: unknown) =>
      error instanceof GenericFormResultToolchainError &&
      error.code === "GENERIC_TOOLCHAIN_AUXILIARY_REFS_NOT_SUPPORTED"
  );
});

test("rejects an unknown form_id before any network call, propagating the derive layer's own error", async () => {
  await assert.rejects(
    () =>
      buildGenericFormResultFromPinnedSource({
        formId: "does-not-exist",
        confirmedSourceFetch: true,
        fetchImpl: throwingFetch()
      }),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "FORM_NOT_FOUND"
  );
});

test("an unknown form_id never invokes fetchImpl, proven by a call counter rather than a thrown error", async () => {
  // Round 1 critic-code WARN (Gate C1b step 7): after DEBT-036 resolved
  // and DEBT_036_RESOLVED flipped to true in the CLI, the CLI's own
  // fail-closed gate for that debt is permanently inert — the only thing
  // left standing between an accidental test invocation (a real, eligible
  // form_id, --confirm-source-fetch, and no fetchImpl override) and a real
  // network request is the derive layer running before the fetch. This
  // test proves that invariant directly and mechanically, with a call
  // counter rather than a throwing mock — a throwing mock only proves "if
  // called, this specific error surfaces first"; a counter proves "never
  // called" outright, which is the actual property that matters here.
  let fetchCallCount = 0;
  const countingFetch = (async () => {
    fetchCallCount += 1;
    throw new Error("must not be reached");
  }) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      buildGenericFormResultFromPinnedSource({
        formId: "does-not-exist",
        confirmedSourceFetch: true,
        fetchImpl: countingFetch
      }),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "FORM_NOT_FOUND"
  );
  assert.equal(fetchCallCount, 0);
});

test("rejects a zero-model form before any network call, propagating the derive layer's own error", async () => {
  await assert.rejects(
    () =>
      buildGenericFormResultFromPinnedSource({
        formId: "banana-inpaint",
        confirmedSourceFetch: true,
        fetchImpl: throwingFetch()
      }),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "FORM_HAS_NO_MODELS"
  );
});

test("rejects an explicit censusManifest whose text does not match the provided censusArtifactText, before any network call", async () => {
  // publicCatalog/inventory/censusManifest are all mutually real and
  // consistent here — only censusArtifactText is bogus — so this isolates
  // the byte-comparison half of the cross-check from the structural half.
  const censusManifest = loadNormalizedSettingsParserCensusManifest();
  await assert.rejects(
    () =>
      buildGenericFormResultFromPinnedSource({
        formId: "banana",
        confirmedSourceFetch: true,
        censusManifest,
        censusArtifactText: "not the real census artifact text",
        fetchImpl: throwingFetch()
      }),
    (error: unknown) =>
      error instanceof GenericFormResultToolchainError &&
      error.code === "GENERIC_TOOLCHAIN_CENSUS_MANIFEST_MISMATCH"
  );
});

test("rejects a non-canonical or unpaired timestamp override before any network call", async () => {
  await assert.rejects(
    () =>
      buildGenericFormResultFromPinnedSource({
        formId: "banana",
        confirmedSourceFetch: true,
        sourceObservedAt: "2026-09-04 12:00:00",
        fetchImpl: throwingFetch()
      }),
    (error: unknown) =>
      error instanceof GenericFormResultToolchainError &&
      error.code === "GENERIC_TOOLCHAIN_INVALID_INPUT_SHAPE"
  );
  await assert.rejects(
    () =>
      buildGenericFormResultFromPinnedSource({
        formId: "banana",
        confirmedSourceFetch: true,
        sourceObservedAt: "2026-09-04T12:00:00.000Z",
        // generatedAt omitted — sourceObservedAt/generatedAt must be
        // provided together or not at all.
        fetchImpl: throwingFetch()
      }),
    (error: unknown) =>
      error instanceof GenericFormResultToolchainError &&
      error.code === "GENERIC_TOOLCHAIN_INVALID_INPUT_SHAPE"
  );
});

test("reaches the network step for a form with no auxiliary refs once every prior gate passes", async () => {
  // "banana" has 0 auxiliary refs in the real committed manifest. This
  // proves every prior gate (confirmedSourceFetch, input shape, census
  // cross-validation, auxiliary refs, timestamp validation) was satisfied
  // and execution actually reached fetchPinnedSettingsFormSourceMaterial.
  // It can't prove the fetch itself succeeds (offline) — and it can't
  // observe a raw error thrown by fetchImpl either: pinned-settings-source-loader.ts's
  // own fetchTextArtifact deliberately catches and normalizes ANY
  // fetchImpl failure into SettingsSourceInventoryError("SOURCE_FETCH_FAILED"),
  // fail-closed, never leaking the raw underlying error. That normalized
  // error is itself the proof execution reached the fetch call — it can
  // only originate inside fetchTextArtifact, reachable only after every
  // prior gate passed.
  await assert.rejects(
    () =>
      buildGenericFormResultFromPinnedSource({
        formId: "banana",
        confirmedSourceFetch: true,
        fetchImpl: (() => {
          throw new Error("must not matter — normalized away");
        }) as unknown as typeof fetch
      }),
    (error: unknown) =>
      error instanceof SettingsSourceInventoryError &&
      error.code === "SOURCE_FETCH_FAILED"
  );
});

test("buildImplementationComponentRecords returns exactly the canonical names, uniquely and in canonical order", () => {
  const components = buildImplementationComponentRecords();
  assert.equal(components.length, GENERIC_IMPLEMENTATION_COMPONENT_NAMES.length);
  const names = components.map((component) => component.name);
  assert.deepEqual(names, [...GENERIC_IMPLEMENTATION_COMPONENT_NAMES].sort());
  assert.equal(new Set(names).size, names.length);
  for (const component of components) {
    assert.ok(component.bytes > 0, `${component.name} should have nonzero bytes`);
    assert.match(component.sha256, /^sha256:[0-9a-f]{64}$/u);
  }
  // Reproducible within the same run: calling it twice must not disagree
  // (production code now calls this exactly once and reuses the result,
  // but this proves it would not matter if it were called again).
  const second = buildImplementationComponentRecords();
  assert.deepEqual(second, components);
});

test("assembleGenericFormResult accepts a real synthetic compile end to end", () => {
  // A minimal but real census manifest / public catalog / inventory triple
  // — loaded, not fabricated, so bindings.census_manifest reflects a real
  // object graph rather than hand-typed placeholder hashes.
  const publicCatalog = loadSyntxPublicCatalogSnapshot();
  const inventory = loadSettingsSourceInventory(undefined, publicCatalog);
  const censusManifest = loadNormalizedSettingsParserCensusManifest({
    publicCatalog,
    inventory
  });
  // The real canonical serialization, not JSON.stringify(censusManifest) —
  // production's readDefaultCensusArtifactText() reads exactly these bytes
  // off disk, and serializeManifestShape is not plain JSON.stringify
  // (round 2 finding: an earlier version of this test used JSON.stringify,
  // which meant bindings.census_manifest.artifact_sha256 here would never
  // equal a real artifact's).
  const censusArtifactText = serializeNormalizedSettingsParserCensusManifest(
    censusManifest,
    publicCatalog,
    inventory
  );

  const formId = "banana";
  const modelIds = ["banana", "banana2", "banana3", "banana3_light"];
  const source = vueSfc(`
const SCOPE = "image"
const AI_NAME = "banana"
const defaultSettings = { aspect_ratio: "1:1", image_size: "2K" }
`);
  const adapterInput = makeAdapterInput(formId, modelIds, source);
  const compiled = buildGenericFormParserCanaryCompilerOutput(adapterInput);

  const derived = {
    rootSourceRefId: `settings-source-${"a".repeat(64)}`,
    adapterInput: {
      sourceRef: adapterInput.sourceRef,
      formId,
      expectedAiName: "banana",
      modelIds,
      auxiliarySourceRefIds: []
    }
  };

  const result = assembleGenericFormResult({
    compiled,
    derived,
    censusManifest,
    censusArtifactText,
    publicCatalog,
    inventory,
    sourceObservedAt: "2026-09-04T02:30:00.000Z",
    generatedAt: "2026-09-04T02:30:01.000Z",
    implementationComponents: buildImplementationComponentRecords()
  });

  assert.equal(result.scope.form_id, formId);
  assert.equal(result.result.summary.runtime_usable_models, 0);
  assert.equal(result.result.summary.scoped_models, modelIds.length);
  assert.equal(result.runtime_usable, false);
  assert.equal(result.form.runtime_usable, false);
  assert.deepEqual(
    result.toolchain.implementation_components.map((c) => c.name),
    [...GENERIC_IMPLEMENTATION_COMPONENT_NAMES].sort()
  );
});

function vueSfc(script: string, template = "<section />"): string {
  return `<script setup lang="ts">${script}</script>\n<template>${template}</template>\n`;
}

function makeAdapterInput(
  formId: string,
  modelIds: readonly string[],
  source: string
): BuildGenericFormParserCanaryCompilerOutputInput {
  const ARTIFACT_SHA256 = `sha256:${"2".repeat(64)}`;
  return {
    source,
    sourceRef: {
      provider_javascript_sha256: ARTIFACT_SHA256,
      provider_source_map_sha256: ARTIFACT_SHA256,
      source_index: 2,
      source_path: `/src/components/chat/forms/settings/${formId}.vue`,
      source_content_sha256: `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`
    },
    formId,
    expectedAiName: "banana",
    modelIds,
    auxiliarySourceRefIds: []
  };
}
