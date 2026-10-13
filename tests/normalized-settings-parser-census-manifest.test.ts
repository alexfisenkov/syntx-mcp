import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertNormalizedSettingsParserCensusManifestMatchesSources,
  assertNormalizedSettingsParserCensusManifestUnchanged,
  buildNormalizedSettingsParserCensusManifest,
  loadNormalizedSettingsParserCensusManifest,
  NormalizedSettingsParserCensusManifestError,
  normalizedSettingsParserCensusManifestSchema,
  serializeNormalizedSettingsParserCensusManifest,
  type NormalizedSettingsParserCensusManifest,
  type NormalizedSettingsParserCensusManifestErrorCode
} from "../src/catalog/normalized-settings-parser-census-manifest.js";
import {
  loadSettingsSourceInventory,
  type SettingsSourceInventory
} from "../src/catalog/settings-source-inventory.js";
import {
  loadSyntxPublicCatalogSnapshot,
  type SyntxPublicCatalogSnapshot
} from "../src/catalog/syntx-public-catalog.js";

const DIFFERENT_SHA256 = `sha256:${"f".repeat(64)}`;
const PRIVATE_MARKER = "PRIVATE_VENDOR_SOURCE_BODY_MUST_NOT_ESCAPE";
const ZERO_MODEL_FORM_IDS = [
  "banana-inpaint",
  "seedance-editor",
  "seedream-editor"
];
const LEGACY_MODEL_IDS = [
  "audio2text",
  "hedra",
  "kling-kolors",
  "lips-sync",
  "pika",
  "recraft",
  "sound-generator",
  "speech-synthesis",
  "stable-diffusion",
  "voice-clone"
];
const UNBOUND_FORM_IDS = ["imagen-4", "midjourney", "midjourney-video"];

test("builds the exact full C0 inventory cohort without runtime promotion", () => {
  const sources = loadSources();
  const manifest = buildNormalizedSettingsParserCensusManifest(sources);

  assert.equal(manifest.schema_version, "2.0.0");
  assert.equal(
    manifest.catalog_kind,
    "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CENSUS_MANIFEST"
  );
  assert.equal(manifest.evidence_level, "STATIC_INVENTORY_COHORT_PLAN");
  assert.equal(manifest.runtime_usable, false);
  assert.equal(
    manifest.source_verification_status,
    "PINNED_IN_INVENTORY_NOT_REFETCHED"
  );
  assert.equal(manifest.compilation_status, "NOT_COMPILED");
  assert.equal(manifest.cohort.kind, "EXACT_FULL_SETTINGS_INVENTORY_COHORT");
  assert.equal(manifest.cohort.version, "1.0.0");
  assert.match(manifest.cohort.canonical_sha256, /^sha256:[a-f0-9]{64}$/u);

  assert.deepEqual(manifest.summary, {
    current_forms: 42,
    current_model_bearing_forms: 39,
    current_zero_model_forms: 3,
    current_model_contexts: 182,
    legacy_no_form_models: 10,
    model_variants: 192,
    literal_evidence_models: 97,
    dynamic_current_models: 85,
    unbound_provider_forms: 3,
    inventory_evidence_locators: 351,
    provider_inventory_evidence_locators: 324,
    helper_inventory_evidence_locators: 27,
    helper_inventory_evidence_source_refs: 6,
    source_refs: 123,
    current_mapped_provider_source_refs: 76,
    deferred_source_refs: 47,
    current_model_bearing_form_root_source_refs: 39,
    current_zero_model_form_root_source_refs: 3,
    current_form_auxiliary_source_refs: 34,
    unbound_provider_source_refs: 4,
    direct_settings_helper_source_refs: 39,
    settings_registry_source_refs: 4,
    vue_source_refs: 94,
    typescript_source_refs: 11,
    javascript_source_refs: 18,
    current_root_vue_source_refs: 42,
    current_auxiliary_vue_source_refs: 18,
    current_auxiliary_typescript_source_refs: 10,
    current_auxiliary_javascript_source_refs: 6
  });

  assert.deepEqual(manifest.cohort.current_zero_model_form_ids, ZERO_MODEL_FORM_IDS);
  assert.deepEqual(manifest.cohort.legacy_no_form_model_ids, LEGACY_MODEL_IDS);
  assert.deepEqual(manifest.cohort.unbound_provider_form_ids, UNBOUND_FORM_IDS);
  assert.deepEqual(
    manifest.cohort.all_model_ids,
    sources.publicCatalog.models.map((model) => model.value).sort(compareText)
  );
  assert.equal(manifest.cohort.current_model_ids.length, 182);
  assert.equal(manifest.cohort.all_source_ref_ids.length, 123);
  assert.equal(manifest.forms.length, 42);
  assert.equal(manifest.models.length, 192);
  assert.equal(manifest.unbound_provider_forms.length, 3);
  assert.equal(
    manifest.models.filter(
      (model) => model.cohort === "CURRENT_MAPPED_FORM" && !model.active
    ).length > 0,
    true
  );
});

test("binds all 123 inventory source identities and all 351 model locators", () => {
  const sources = loadSources();
  const manifest = buildNormalizedSettingsParserCensusManifest(sources);
  const sourceIds = manifest.source_identities.map(
    (source) => source.source_ref_id
  );
  assert.equal(new Set(sourceIds).size, 123);
  assert.deepEqual(sourceIds, [...sourceIds].sort(compareText));
  for (const source of manifest.source_identities) {
    assert.match(source.source_ref_id, /^settings-source-[a-f0-9]{64}$/u);
  }

  const dispositionCounts = countBy(
    manifest.source_identities,
    (source) => source.disposition
  );
  assert.deepEqual(dispositionCounts, {
    PINNED_IN_INVENTORY_CURRENT_MODEL_BEARING_FORM_ROOT: 39,
    PINNED_IN_INVENTORY_CURRENT_ZERO_MODEL_FORM_ROOT: 3,
    PINNED_IN_INVENTORY_CURRENT_FORM_AUXILIARY: 34,
    PINNED_IN_INVENTORY_UNBOUND_PROVIDER_FORM: 4,
    PINNED_IN_INVENTORY_DIRECT_SETTINGS_HELPER: 39,
    PINNED_IN_INVENTORY_SETTINGS_REGISTRY: 4
  });

  const sourceById = new Map(
    manifest.source_identities.map(
      (source) => [source.source_ref_id, source] as const
    )
  );
  const actualEvidence = manifest.models
    .flatMap((model) =>
      model.inventory_evidence.map((locator) => {
        const source = sourceById.get(locator.source_ref_id);
        assert.ok(source);
        return JSON.stringify([
          model.model_id,
          source.module_javascript_sha256,
          source.module_source_map_sha256,
          source.source_index,
          source.source_path,
          source.source_content_sha256,
          locator.token_kind,
          locator.line,
          locator.column
        ]);
      })
    )
    .sort(compareText);
  const expectedEvidence = sources.inventory.models
    .flatMap((model) =>
      model.evidence.map((locator) =>
        JSON.stringify([
          model.model_id,
          locator.module_sha256,
          locator.source_map_sha256,
          locator.source_index,
          locator.source_path,
          locator.source_content_sha256,
          locator.token_kind,
          locator.line,
          locator.column
        ])
      )
    )
    .sort(compareText);
  assert.equal(actualEvidence.length, 351);
  assert.deepEqual(actualEvidence, expectedEvidence);

  const helperEvidence = manifest.models.flatMap((model) =>
    model.inventory_evidence.filter(
      (locator) =>
        sourceById.get(locator.source_ref_id)?.role ===
        "DIRECT_SETTINGS_HELPER"
    )
  );
  assert.equal(helperEvidence.length, 27);
  assert.equal(
    new Set(helperEvidence.map((locator) => locator.source_ref_id)).size,
    6
  );
});

test("keeps form, model, unbound, and compile-boundary relationships exact", () => {
  const sources = loadSources();
  const manifest = buildNormalizedSettingsParserCensusManifest(sources);
  const sourceById = new Map(
    manifest.source_identities.map(
      (source) => [source.source_ref_id, source] as const
    )
  );
  const inventoryForms = new Map(
    sources.inventory.family_forms.map((form) => [form.form_id, form] as const)
  );

  for (const form of manifest.forms) {
    const inventoryForm = inventoryForms.get(form.form_id);
    assert.ok(inventoryForm);
    assert.equal(form.ai_name, inventoryForm.ai_name);
    assert.equal(form.model_ids.length, inventoryForm.model_count);
    const root = sourceById.get(form.root_source_ref_id);
    assert.ok(root);
    assert.equal(
      root.source_path,
      `/src/components/chat/forms/settings/${form.form_id}.vue`
    );
    for (const sourceRefId of form.auxiliary_source_ref_ids) {
      const source = sourceById.get(sourceRefId);
      assert.ok(source);
      assert.equal(source.form_id, form.form_id);
      assert.equal(
        source.disposition,
        "PINNED_IN_INVENTORY_CURRENT_FORM_AUXILIARY"
      );
    }
  }

  for (const model of manifest.models) {
    const publicModel = sources.publicCatalog.models.find(
      (entry) => entry.value === model.model_id
    );
    const inventoryModel = sources.inventory.models.find(
      (entry) => entry.model_id === model.model_id
    );
    assert.ok(publicModel);
    assert.ok(inventoryModel);
    assert.equal(model.ai_name, publicModel.ai_name);
    assert.equal(model.active, publicModel.active);
    assert.equal(model.form_id, inventoryModel.form_id);
  }

  assert.deepEqual(
    manifest.unbound_provider_forms.map((form) => form.form_id),
    UNBOUND_FORM_IDS
  );
  for (const form of manifest.unbound_provider_forms) {
    for (const sourceRefId of form.source_ref_ids) {
      const source = sourceById.get(sourceRefId);
      assert.ok(source);
      assert.equal(source.form_id, form.form_id);
      assert.equal(
        source.disposition,
        "PINNED_IN_INVENTORY_UNBOUND_PROVIDER_FORM"
      );
    }
  }

  assert.equal(
    manifest.compile_boundary.current_mapped_provider_source_ref_ids.length,
    76
  );
  assert.equal(manifest.compile_boundary.deferred_source_ref_ids.length, 47);
  assert.deepEqual(
    [
      ...manifest.compile_boundary.current_mapped_provider_source_ref_ids,
      ...manifest.compile_boundary.deferred_source_ref_ids
    ].sort(compareText),
    manifest.cohort.all_source_ref_ids
  );
});

test("serializes and loads deterministically without raw vendor material", async () => {
  const sources = loadSources();
  const firstManifest = buildNormalizedSettingsParserCensusManifest(sources);
  const secondManifest = buildNormalizedSettingsParserCensusManifest({
    publicCatalog: structuredClone(sources.publicCatalog),
    inventory: structuredClone(sources.inventory)
  });
  const first = serializeNormalizedSettingsParserCensusManifest(
    firstManifest,
    sources.publicCatalog,
    sources.inventory
  );
  const second = serializeNormalizedSettingsParserCensusManifest(
    secondManifest,
    sources.publicCatalog,
    sources.inventory
  );
  assert.equal(first, second);
  assert.equal(first.endsWith("\n"), true);
  for (const forbidden of [
    '"normalized_schema_hash"',
    '"raw_source"',
    '"source_map"',
    '"module_url"',
    '"source_map_url"',
    '"sourcesContent"',
    '"defaults"',
    '"projections"',
    '"candidates"',
    PRIVATE_MARKER,
    '"source_verification_status": "VERIFIED"',
    '"compilation_status": "COMPILED"'
  ]) {
    assert.equal(first.includes(forbidden), false, forbidden);
  }
  assert.equal(
    first.includes(
      '"source_verification_status": "PINNED_IN_INVENTORY_NOT_REFETCHED"'
    ),
    true
  );
  assert.equal(
    first.includes('"compilation_status": "NOT_COMPILED"'),
    true
  );

  const directory = await mkdtemp(join(tmpdir(), "syntx-census-manifest-"));
  const path = join(directory, "manifest.json");
  try {
    await writeFile(path, first, "utf8");
    const loaded = loadNormalizedSettingsParserCensusManifest({
      path,
      ...sources
    });
    assert.deepEqual(loaded, firstManifest);
    assert.doesNotThrow(() =>
      assertNormalizedSettingsParserCensusManifestUnchanged(
        firstManifest,
        loaded
      )
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("strict schema rejects runtime, result, raw, and unknown-field promotion", () => {
  const manifest = buildNormalizedSettingsParserCensusManifest(loadSources());
  const mutations: unknown[] = [];

  const runtime = structuredClone(manifest) as unknown as Record<string, unknown>;
  runtime.runtime_usable = true;
  mutations.push(runtime);

  const version = structuredClone(manifest) as unknown as Record<string, unknown>;
  version.schema_version = "2.1.0";
  mutations.push(version);

  const verified = structuredClone(manifest) as unknown as Record<string, unknown>;
  verified.source_verification_status = "VERIFIED";
  mutations.push(verified);

  const compiled = structuredClone(manifest) as unknown as Record<string, unknown>;
  compiled.compilation_status = "COMPILED";
  mutations.push(compiled);

  const unknown = structuredClone(manifest) as unknown as Record<string, unknown>;
  unknown.compiler = { status: "VERIFIED" };
  mutations.push(unknown);

  const projections = structuredClone(manifest) as unknown as {
    models: Array<Record<string, unknown>>;
  };
  projections.models[0]!.projections = {};
  mutations.push(projections);

  const defaults = structuredClone(manifest) as unknown as {
    forms: Array<Record<string, unknown>>;
  };
  defaults.forms[0]!.defaults = { image_size: "2K" };
  mutations.push(defaults);

  const normalizedHash = structuredClone(manifest) as unknown as {
    models: Array<Record<string, unknown>>;
  };
  normalizedHash.models[0]!.normalized_schema_hash = DIFFERENT_SHA256;
  mutations.push(normalizedHash);

  for (const field of ["raw_source", "source_map", "sourcesContent"] as const) {
    const raw = structuredClone(manifest) as unknown as {
      source_identities: Array<Record<string, unknown>>;
    };
    raw.source_identities[0]![field] = PRIVATE_MARKER;
    mutations.push(raw);
  }

  for (const mutation of mutations) {
    assert.equal(
      normalizedSettingsParserCensusManifestSchema.safeParse(mutation).success,
      false
    );
  }
});

test("full cohort hash rejects a relationship-preserving dynamic-model move", () => {
  const manifest = buildNormalizedSettingsParserCensusManifest(loadSources());
  const moved = structuredClone(manifest);
  const model = moved.models.find((entry) => entry.model_id === "V3_5");
  const sourceForm = moved.forms.find((entry) => entry.form_id === "suno");
  const targetForm = moved.forms.find((entry) => entry.form_id === "chatgpt");
  assert.ok(model);
  assert.ok(sourceForm);
  assert.ok(targetForm);
  assert.equal(model.evidence_class, "DYNAMIC_FAMILY_FORM");
  assert.deepEqual(model.inventory_evidence, []);

  sourceForm.model_ids = sourceForm.model_ids.filter(
    (modelId) => modelId !== model.model_id
  );
  targetForm.model_ids = [...targetForm.model_ids, model.model_id].sort(
    compareText
  );
  model.form_id = targetForm.form_id;
  model.ai_name = targetForm.ai_name;

  const result = normalizedSettingsParserCensusManifestSchema.safeParse(moved);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(
      result.error.issues.map((issue) => issue.path),
      [["cohort", "canonical_sha256"]]
    );
  }
  assert.equal(
    moved.cohort.canonical_sha256,
    manifest.cohort.canonical_sha256
  );
});

test("safeParse rejects unsupported source extensions without throwing", () => {
  const manifest = buildNormalizedSettingsParserCensusManifest(loadSources());
  const unsupported = structuredClone(manifest);
  unsupported.source_identities[0]!.source_path = unsupported.source_identities[0]!
    .source_path.replace(/\.(?:vue|ts|js)$/u, ".json");

  let result: ReturnType<
    typeof normalizedSettingsParserCensusManifestSchema.safeParse
  > | undefined;
  assert.doesNotThrow(() => {
    result = normalizedSettingsParserCensusManifestSchema.safeParse(unsupported);
  });
  assert.equal(result?.success, false);
});

test("strict relationships reject order, identity, evidence, summary, and cohort drift", () => {
  const sources = loadSources();
  const manifest = buildNormalizedSettingsParserCensusManifest(sources);
  const mutations: NormalizedSettingsParserCensusManifest[] = [];

  const modelOrder = structuredClone(manifest);
  [modelOrder.models[0], modelOrder.models[1]] = [
    modelOrder.models[1]!,
    modelOrder.models[0]!
  ];
  mutations.push(modelOrder);

  const sourceOrder = structuredClone(manifest);
  [sourceOrder.source_identities[0], sourceOrder.source_identities[1]] = [
    sourceOrder.source_identities[1]!,
    sourceOrder.source_identities[0]!
  ];
  mutations.push(sourceOrder);

  const sourceIdentity = structuredClone(manifest);
  sourceIdentity.source_identities[0]!.module_javascript_sha256 =
    DIFFERENT_SHA256;
  mutations.push(sourceIdentity);

  const summary = structuredClone(manifest);
  summary.summary.source_refs += 1;
  mutations.push(summary);

  const cohortHash = structuredClone(manifest);
  cohortHash.cohort.canonical_sha256 = DIFFERENT_SHA256;
  mutations.push(cohortHash);

  const evidence = structuredClone(manifest);
  const evidenceModel = evidence.models.find(
    (model) => model.inventory_evidence.length > 0
  );
  const registrySource = evidence.source_identities.find(
    (source) => source.role === "SETTINGS_REGISTRY"
  );
  assert.ok(evidenceModel);
  assert.ok(registrySource);
  evidenceModel.inventory_evidence[0]!.source_ref_id =
    registrySource.source_ref_id;
  evidenceModel.inventory_evidence.sort((left, right) =>
    compareText(
      JSON.stringify([left.source_ref_id, left.line, left.column]),
      JSON.stringify([right.source_ref_id, right.line, right.column])
    )
  );
  mutations.push(evidence);

  for (const mutation of mutations) {
    assert.equal(
      normalizedSettingsParserCensusManifestSchema.safeParse(mutation).success,
      false
    );
  }

  const validButDifferent = structuredClone(manifest);
  validButDifferent.public_catalog.canonical_sha256 = DIFFERENT_SHA256;
  assert.equal(
    normalizedSettingsParserCensusManifestSchema.safeParse(validButDifferent)
      .success,
    true
  );
  assert.throws(
    () =>
      assertNormalizedSettingsParserCensusManifestUnchanged(
        manifest,
        validButDifferent
      ),
    hasCode("CENSUS_MANIFEST_DRIFT_DETECTED")
  );
  assert.throws(
    () =>
      assertNormalizedSettingsParserCensusManifestMatchesSources(
        validButDifferent,
        sources.publicCatalog,
        sources.inventory
      ),
    hasCode("SOURCE_RELATIONSHIP_INVALID")
  );
});

test("source failures use fixed safe errors and the module stays Gate B independent", async () => {
  const sources = loadSources();
  const invalidPublicCatalog = structuredClone(sources.publicCatalog);
  invalidPublicCatalog.sources.models.canonical_sha256 = DIFFERENT_SHA256;
  assert.throws(
    () =>
      buildNormalizedSettingsParserCensusManifest({
        publicCatalog: invalidPublicCatalog,
        inventory: sources.inventory
      }),
    fixedError("SOURCE_VALIDATION_FAILED")
  );

  const relationshipDrift = structuredClone(sources.inventory);
  relationshipDrift.public_catalog.models_sha256 = DIFFERENT_SHA256;
  assert.throws(
    () =>
      buildNormalizedSettingsParserCensusManifest({
        publicCatalog: sources.publicCatalog,
        inventory: relationshipDrift
      }),
    fixedError("SOURCE_RELATIONSHIP_INVALID")
  );

  const directory = await mkdtemp(join(tmpdir(), "syntx-census-invalid-"));
  const path = join(directory, "manifest.json");
  try {
    await writeFile(path, `{${PRIVATE_MARKER}`, "utf8");
    assert.throws(
      () => loadNormalizedSettingsParserCensusManifest({ path, ...sources }),
      fixedError("CENSUS_MANIFEST_INVALID")
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const moduleSource = await readFile(
    join("src", "catalog", "normalized-settings-parser-census-manifest.ts"),
    "utf8"
  );
  assert.equal(moduleSource.includes("./normalized-settings-ir"), false);
  assert.equal(moduleSource.includes("./normalized-settings-parser-canary"), false);
  assert.equal(moduleSource.includes("../tools"), false);
});

function loadSources(): {
  publicCatalog: SyntxPublicCatalogSnapshot;
  inventory: SettingsSourceInventory;
} {
  const publicCatalog = loadSyntxPublicCatalogSnapshot();
  const inventory = loadSettingsSourceInventory(undefined, publicCatalog);
  return { publicCatalog, inventory };
}

function countBy<T>(
  values: readonly T[],
  keyOf: (value: T) => string
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    const key = keyOf(value);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function hasCode(code: NormalizedSettingsParserCensusManifestErrorCode) {
  return (error: unknown): boolean =>
    error instanceof NormalizedSettingsParserCensusManifestError &&
    error.code === code;
}

function fixedError(code: NormalizedSettingsParserCensusManifestErrorCode) {
  return (error: unknown): boolean =>
    error instanceof NormalizedSettingsParserCensusManifestError &&
    error.code === code &&
    error.message ===
      "SYNTX normalized settings parser census manifest could not be processed safely." &&
    !error.message.includes(PRIVATE_MARKER);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
