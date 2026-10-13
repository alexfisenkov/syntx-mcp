import assert from "node:assert/strict";
import test from "node:test";
import { loadNormalizedSettingsParserCensusManifest } from "../src/catalog/normalized-settings-parser-census-manifest.js";
import { loadSettingsSourceInventory } from "../src/catalog/settings-source-inventory.js";
import { loadSyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import {
  GenericFormAdapterManifestDeriveError,
  deriveGenericFormAdapterInputFromManifest,
  type GenericFormAdapterManifestDerivedInput
} from "../tools/settings-ir/generic-form-adapter-input-from-manifest.js";
import {
  GenericFormParserCanaryCompilerError,
  buildGenericFormParserCanaryCompilerOutput
} from "../tools/settings-ir/build-generic-form-parser-canary.js";

// Assigning a derived adapterInput to this exact type is the compile-time
// half of the regression coverage: any future field drift between
// GenericFormAdapterManifestDerivedInput and
// BuildGenericFormParserCanaryCompilerOutputInput fails typecheck here
// before it ever reaches a runtime PARSER_OUTPUT_INVALID surprise.
function assertAssignableToAdapterInput(
  derived: GenericFormAdapterManifestDerivedInput
): void {
  const check: import("../tools/settings-ir/build-generic-form-parser-canary.js").BuildGenericFormParserCanaryCompilerOutputInput =
    { ...derived.adapterInput, source: "" };
  void check;
}

function loadRealManifest() {
  const publicCatalog = loadSyntxPublicCatalogSnapshot();
  const inventory = loadSettingsSourceInventory(undefined, publicCatalog);
  return loadNormalizedSettingsParserCensusManifest({ publicCatalog, inventory });
}

test("derives a valid adapter input for the banana form from the real committed manifest", () => {
  const manifest = loadRealManifest();
  const form = manifest.forms.find((entry) => entry.form_id === "banana");
  assert.ok(form);
  const root = manifest.source_identities.find(
    (identity) => identity.source_ref_id === form.root_source_ref_id
  );
  assert.ok(root);

  const derived = deriveGenericFormAdapterInputFromManifest(manifest, "banana");
  assertAssignableToAdapterInput(derived);

  assert.equal(derived.rootSourceRefId, form.root_source_ref_id);
  assert.equal(derived.adapterInput.formId, "banana");
  assert.equal(derived.adapterInput.expectedAiName, "banana");
  assert.deepEqual(
    [...derived.adapterInput.modelIds].sort(),
    ["banana", "banana2", "banana3", "banana3_light"]
  );
  assert.equal(derived.adapterInput.auxiliarySourceRefIds.length, 0);
  // Full field-by-field comparison, not just a format regex or one field —
  // a swapped javascript/source-map hash pair would pass a looser check.
  assert.deepEqual(derived.adapterInput.sourceRef, {
    provider_javascript_sha256: root.module_javascript_sha256,
    provider_source_map_sha256: root.module_source_map_sha256,
    source_index: root.source_index,
    source_path: root.source_path,
    source_content_sha256: root.source_content_sha256
  });
});

test("the derived adapter input for banana is accepted by the real adapter (not just typechecks)", () => {
  const manifest = loadRealManifest();
  const derived = deriveGenericFormAdapterInputFromManifest(manifest, "banana");

  // Real source bytes are not available offline, so this must fail — but it
  // has to fail for the source/hash mismatch reason, past parseBuildInput's
  // hasExactKeys shape check. Failing with PARSER_OUTPUT_INVALID here would
  // mean the spread shape itself is wrong (the bug practice/code both found:
  // an extra sibling key breaks hasExactKeys before any hashing happens).
  assert.throws(
    () =>
      buildGenericFormParserCanaryCompilerOutput({
        ...derived.adapterInput,
        source: "not the real banana source"
      }),
    (error: unknown) =>
      error instanceof GenericFormParserCanaryCompilerError &&
      error.code === "SOURCE_RELATIONSHIP_INVALID"
  );
});

test("derives a valid adapter input for every model-bearing form in the real manifest (39/39)", () => {
  const manifest = loadRealManifest();
  const modelBearingForms = manifest.forms.filter((form) => form.model_ids.length > 0);
  assert.equal(modelBearingForms.length, 39);

  for (const form of modelBearingForms) {
    const root = manifest.source_identities.find(
      (identity) => identity.source_ref_id === form.root_source_ref_id
    );
    assert.ok(root, `missing root source identity for ${form.form_id}`);
    const derived = deriveGenericFormAdapterInputFromManifest(manifest, form.form_id);
    assertAssignableToAdapterInput(derived);

    assert.equal(derived.rootSourceRefId, form.root_source_ref_id);
    assert.equal(derived.adapterInput.formId, form.form_id);
    assert.equal(derived.adapterInput.expectedAiName, form.ai_name);
    assert.deepEqual([...derived.adapterInput.modelIds], [...form.model_ids]);
    assert.deepEqual(
      [...derived.adapterInput.auxiliarySourceRefIds],
      [...form.auxiliary_source_ref_ids]
    );
    assert.deepEqual(derived.adapterInput.sourceRef, {
      provider_javascript_sha256: root.module_javascript_sha256,
      provider_source_map_sha256: root.module_source_map_sha256,
      source_index: root.source_index,
      source_path: root.source_path,
      source_content_sha256: root.source_content_sha256
    });
  }
});

test("returned arrays are independent copies, not live references into the manifest", () => {
  const manifest = loadRealManifest();
  const form = manifest.forms.find((entry) => entry.form_id === "banana");
  assert.ok(form);
  const derived = deriveGenericFormAdapterInputFromManifest(manifest, "banana");

  assert.notEqual(derived.adapterInput.modelIds, form.model_ids);
  assert.notEqual(derived.adapterInput.auxiliarySourceRefIds, form.auxiliary_source_ref_ids);

  (derived.adapterInput.modelIds as string[]).push("INJECTED");
  assert.deepEqual(
    [...form.model_ids],
    ["banana", "banana2", "banana3", "banana3_light"],
    "mutating the returned array must not corrupt the source manifest"
  );
});

test("carries auxiliary_source_ref_ids through for the 13 forms that have them", () => {
  const manifest = loadRealManifest();
  const withAuxiliaries = manifest.forms.filter(
    (form) => form.auxiliary_source_ref_ids.length > 0
  );
  assert.equal(withAuxiliaries.length, 13);

  for (const form of withAuxiliaries) {
    const derived = deriveGenericFormAdapterInputFromManifest(manifest, form.form_id);
    assert.equal(
      derived.adapterInput.auxiliarySourceRefIds.length,
      form.auxiliary_source_ref_ids.length
    );
    // The adapter itself, not this derive step, is the single rejection
    // point for forms it cannot yet compile.
    assert.throws(
      () =>
        buildGenericFormParserCanaryCompilerOutput({
          ...derived.adapterInput,
          source: "irrelevant, rejected before any hashing"
        }),
      (error: unknown) =>
        error instanceof GenericFormParserCanaryCompilerError &&
        error.code === "AUXILIARY_SOURCE_REFS_NOT_SUPPORTED"
    );
  }
});

test("rejects the three zero-model forms with a distinct code, not silently", () => {
  const manifest = loadRealManifest();
  const zeroModelForms = ["banana-inpaint", "seedance-editor", "seedream-editor"];
  const actualZeroModelForms = manifest.forms
    .filter((form) => form.model_ids.length === 0)
    .map((form) => form.form_id)
    .sort();
  assert.deepEqual(actualZeroModelForms, zeroModelForms.slice().sort());

  for (const formId of zeroModelForms) {
    assert.throws(
      () => deriveGenericFormAdapterInputFromManifest(manifest, formId),
      (error: unknown) =>
        error instanceof GenericFormAdapterManifestDeriveError &&
        error.code === "FORM_HAS_NO_MODELS"
    );
  }
});

test("rejects an unknown form_id instead of returning undefined fields", () => {
  const manifest = loadRealManifest();
  assert.throws(
    () => deriveGenericFormAdapterInputFromManifest(manifest, "does-not-exist"),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "FORM_NOT_FOUND"
  );
});

test("rejects a manifest that does not conform to the schema, even though it typechecks", () => {
  assert.throws(
    () => deriveGenericFormAdapterInputFromManifest({ forms: [] }, "banana"),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "CENSUS_MANIFEST_INVALID"
  );
  assert.throws(
    () => deriveGenericFormAdapterInputFromManifest(null, "banana"),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "CENSUS_MANIFEST_INVALID"
  );
});

function tamperBananaRoot(
  manifest: ReturnType<typeof loadRealManifest>,
  patch: Record<string, unknown>
): ReturnType<typeof loadRealManifest> {
  const banana = manifest.forms.find((form) => form.form_id === "banana");
  assert.ok(banana);
  return {
    ...manifest,
    source_identities: manifest.source_identities.map((identity) =>
      identity.source_ref_id === banana.root_source_ref_id
        ? { ...identity, ...patch }
        : identity
    )
  };
}

// These six all tamper a real, once-valid manifest so that the root source
// identity for "banana" violates one of the relationships
// normalizedSettingsParserCensusManifestSchema's own superRefine enforces
// (validateFormRelationships, normalized-settings-parser-census-manifest.ts:1037)
// — role/form_id, source_kind/path, disposition, and the source's own
// self-referential id. Every one of them is caught by the schema re-parse
// this file's derive function runs first, so all six surface as
// CENSUS_MANIFEST_INVALID, not a role-specific code — there is no second,
// independent check inside this file's own logic to name separately (see
// this file's header comment; verified empirically that each of these six
// patches independently fails normalizedSettingsParserCensusManifestSchema.safeParse
// on the real committed manifest, not assumed from reading the schema).
test("rejects a manifest whose root source identity's form_id no longer matches its form (schema-level, not this file's own check)", () => {
  const manifest = loadRealManifest();
  const tampered = tamperBananaRoot(manifest, { form_id: "not-banana" });
  assert.throws(
    () => deriveGenericFormAdapterInputFromManifest(tampered, "banana"),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "CENSUS_MANIFEST_INVALID"
  );
});

test("rejects a manifest whose root source identity's source_kind no longer matches its path (schema-level)", () => {
  const manifest = loadRealManifest();
  const tampered = tamperBananaRoot(manifest, { source_kind: "JAVASCRIPT_MODULE" });
  assert.throws(
    () => deriveGenericFormAdapterInputFromManifest(tampered, "banana"),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "CENSUS_MANIFEST_INVALID"
  );
});

test("rejects a manifest whose root source identity's role no longer matches (schema-level)", () => {
  const manifest = loadRealManifest();
  const tampered = tamperBananaRoot(manifest, { role: "SETTINGS_REGISTRY" });
  assert.throws(
    () => deriveGenericFormAdapterInputFromManifest(tampered, "banana"),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "CENSUS_MANIFEST_INVALID"
  );
});

test("rejects a manifest whose root source identity's disposition no longer matches its model count (schema-level)", () => {
  const manifest = loadRealManifest();
  const tampered = tamperBananaRoot(manifest, {
    disposition: "PINNED_IN_INVENTORY_CURRENT_ZERO_MODEL_FORM_ROOT"
  });
  assert.throws(
    () => deriveGenericFormAdapterInputFromManifest(tampered, "banana"),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "CENSUS_MANIFEST_INVALID"
  );
});

test("rejects a manifest whose root source identity's source_path no longer matches its form_id (schema-level)", () => {
  const manifest = loadRealManifest();
  const tampered = tamperBananaRoot(manifest, {
    source_path: "/src/components/chat/forms/settings/not-banana.vue"
  });
  assert.throws(
    () => deriveGenericFormAdapterInputFromManifest(tampered, "banana"),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "CENSUS_MANIFEST_INVALID"
  );
});

test("rejects a manifest whose root source identity's own id no longer matches its content (schema-level)", () => {
  const manifest = loadRealManifest();
  // Changing a hashed field without recomputing source_ref_id breaks the
  // self-referential id the manifest schema itself defines and checks.
  const tampered = tamperBananaRoot(manifest, {
    module_javascript_sha256: `sha256:${"0".repeat(64)}`
  });
  assert.throws(
    () => deriveGenericFormAdapterInputFromManifest(tampered, "banana"),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "CENSUS_MANIFEST_INVALID"
  );
});

test("rejects a manifest whose root_source_ref_id points at nothing in source_identities (schema-level)", () => {
  const manifest = loadRealManifest();
  const tampered: typeof manifest = {
    ...manifest,
    forms: manifest.forms.map((form) =>
      form.form_id === "banana"
        ? {
            ...form,
            root_source_ref_id: `settings-source-${"0".repeat(64)}`
          }
        : form
    )
  };

  assert.throws(
    () => deriveGenericFormAdapterInputFromManifest(tampered, "banana"),
    (error: unknown) =>
      error instanceof GenericFormAdapterManifestDeriveError &&
      error.code === "CENSUS_MANIFEST_INVALID"
  );
});
