import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  assertNormalizedSettingsIrCanaryMatchesSources,
  assertNormalizedSettingsIrCanaryUnchanged,
  buildNormalizedSettingsIrCanary,
  loadNormalizedSettingsIrCanary,
  NormalizedSettingsIrError,
  normalizedSettingsIrCanarySchema,
  serializeNormalizedSettingsIrCanary
} from "../src/catalog/normalized-settings-ir.js";
import { loadSettingsSourceInventory } from "../src/catalog/settings-source-inventory.js";
import {
  loadSyntxPublicCatalogSnapshot,
  sha256CanonicalPayload,
  type SyntxPublicCatalogSnapshot
} from "../src/catalog/syntx-public-catalog.js";

const CANARY_IDS = ["banana", "banana2", "banana3", "banana3_light"];
const PRIVATE_MARKER = "PRIVATE_VENDOR_SOURCE_BODY_MUST_NOT_ESCAPE";
const DIFFERENT_SHA256 = `sha256:${"0".repeat(64)}`;
const DIFFERENT_REGISTRY_SHA256 = `sha256:${"f".repeat(64)}`;
const CANARY_PATH = join(
  "catalog",
  "runtime",
  "v1",
  "normalized-settings-ir-canary.json"
);

test("builds a deterministic exact four-model evidence canary", () => {
  const sources = loadSources();
  const forward = buildNormalizedSettingsIrCanary({
    ...sources,
    modelIds: CANARY_IDS
  });
  const reverse = buildNormalizedSettingsIrCanary({
    ...sources,
    modelIds: [...CANARY_IDS].reverse()
  });

  assert.deepEqual(forward.scope, {
    kind: "EXACT_MODEL_SET",
    model_ids: CANARY_IDS
  });
  assert.equal(forward.generated_at, sources.inventory.generated_at);
  assert.equal(
    forward.source_inventory.canonical_sha256,
    sha256CanonicalPayload(sources.inventory)
  );
  assert.equal(
    forward.source_inventory.build_id,
    sources.inventory.build.id
  );
  assert.deepEqual(forward.source_inventory.public_catalog_hashes, {
    ai: sources.inventory.public_catalog.ai_sha256,
    models: sources.inventory.public_catalog.models_sha256,
    llm_models: sources.inventory.public_catalog.llm_models_sha256
  });
  assert.equal(forward.models.length, 4);
  assert.equal(forward.summary.partial_models, 4);
  assert.equal(forward.summary.runtime_usable_models, 0);
  assert.equal(forward.runtime_usable, false);
  assert.equal(
    serializeNormalizedSettingsIrCanary(
      forward,
      sources.publicCatalog,
      sources.inventory
    ),
    serializeNormalizedSettingsIrCanary(
      reverse,
      sources.publicCatalog,
      sources.inventory
    )
  );

  for (const record of forward.models) {
    const publicModel = sources.publicCatalog.models.find(
      (model) => model.value === record.model_id
    );
    const inventoryModel = sources.inventory.models.find(
      (model) => model.model_id === record.model_id
    );
    assert.ok(publicModel);
    assert.ok(inventoryModel);
    assert.equal(record.ai_name, publicModel.ai_name);
    assert.equal(record.active, publicModel.active);
    assert.equal(record.form_id, inventoryModel.form_id);
    assert.equal(record.evidence_class, inventoryModel.evidence_class);
    assert.equal(record.completeness, "PARTIAL");
    assert.equal(record.defaults.status, "BLOCKED");
    assert.equal(record.controls.status, "BLOCKED");
    assert.equal(record.conditional_rules.status, "BLOCKED");
    assert.equal(record.watch_rules.status, "BLOCKED");
    assert.equal(record.computed_rules.status, "BLOCKED");
    assert.equal(record.payload_projection.status, "BLOCKED");
    assert.deepEqual(record.cost_projection.server_derived, [
      "ai_name",
      "model_type"
    ]);
    assert.equal(
      record.public_model_ref.canonical_sha256,
      sha256CanonicalPayload(publicModel)
    );
    assert.equal(
      record.public_model_ref.aggregate_models_sha256,
      sources.publicCatalog.sources.models.canonical_sha256
    );
    assert.equal(record.public_model_ref.key, "value");
    assert.equal(record.public_model_ref.model_id, record.model_id);
  }
  assert.deepEqual(
    forward.models.find((model) => model.model_id === "banana")
      ?.cost_projection.caller_supplied_candidates,
    []
  );
  assert.deepEqual(
    forward.models.find((model) => model.model_id === "banana2")
      ?.cost_projection.caller_supplied_candidates,
    ["image_size"]
  );

  const reservedParameterCanary = buildNormalizedSettingsIrCanary({
    ...sources,
    modelIds: ["grok_imagine_2"]
  });
  assert.deepEqual(
    reservedParameterCanary.models[0]?.cost_projection,
    {
      status: "PROVEN",
      proof_scope: "PARAMETER_OWNERSHIP_CLASSIFICATION_ONLY",
      server_derived: ["ai_name", "model_type"],
      caller_supplied_candidates: [
        "batch_size",
        "resolution",
        "details_quality",
        "ref_count"
      ]
    }
  );
});

test("loads, serializes, and compares a source-bound canary", async () => {
  const sources = loadSources();
  const canary = buildNormalizedSettingsIrCanary({
    ...sources,
    modelIds: CANARY_IDS
  });
  const directory = await mkdtemp(join(tmpdir(), "syntx-settings-ir-"));
  const path = join(directory, "canary.json");
  try {
    await writeFile(
      path,
      serializeNormalizedSettingsIrCanary(
        canary,
        sources.publicCatalog,
        sources.inventory
      ),
      "utf8"
    );
    const loaded = loadNormalizedSettingsIrCanary({ path, ...sources });
    assert.deepEqual(loaded, canary);
    assert.doesNotThrow(() =>
      assertNormalizedSettingsIrCanaryUnchanged(canary, loaded)
    );
    assert.doesNotThrow(() =>
      assertNormalizedSettingsIrCanaryMatchesSources(
        loaded,
        sources.publicCatalog,
        sources.inventory
      )
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects duplicate, missing, and moved model relationships", () => {
  const sources = loadSources();
  assert.throws(
    () =>
      buildNormalizedSettingsIrCanary({
        ...sources,
        modelIds: ["banana", "banana"]
      }),
    hasCanaryCode("SCOPE_INVALID")
  );

  const missingId = "private_missing_model";
  assert.throws(
    () =>
      buildNormalizedSettingsIrCanary({
        ...sources,
        modelIds: [missingId]
      }),
    (error: unknown) =>
      error instanceof NormalizedSettingsIrError &&
      error.code === "SOURCE_RELATIONSHIP_INVALID" &&
      !error.message.includes(missingId)
  );

  const canary = buildNormalizedSettingsIrCanary({
    ...sources,
    modelIds: CANARY_IDS
  });
  const duplicate = structuredClone(canary);
  duplicate.models[1] = structuredClone(duplicate.models[0]!);
  assert.equal(normalizedSettingsIrCanarySchema.safeParse(duplicate).success, false);

  const missing = structuredClone(canary);
  missing.models.pop();
  assert.equal(normalizedSettingsIrCanarySchema.safeParse(missing).success, false);

  const moved = structuredClone(canary);
  moved.models[0]!.ai_name = "grok_image";
  assert.throws(
    () =>
      assertNormalizedSettingsIrCanaryMatchesSources(
        moved,
        sources.publicCatalog,
        sources.inventory
      ),
    hasCanaryCode("SOURCE_RELATIONSHIP_INVALID")
  );
});

test("source-bound serializer rejects schema-valid relationship mutations", () => {
  const sources = loadSources();
  const canary = buildNormalizedSettingsIrCanary({
    ...sources,
    modelIds: CANARY_IDS
  });

  const movedFamily = structuredClone(canary);
  movedFamily.models[0]!.ai_name = "grok_image";

  const movedForm = structuredClone(canary);
  movedForm.models[0]!.form_id = "grok-image";

  const changedEvidenceClass = structuredClone(canary);
  changedEvidenceClass.models[0]!.evidence_class = "DYNAMIC_FAMILY_FORM";
  changedEvidenceClass.summary.literal_reference_evidence_models -= 1;
  changedEvidenceClass.summary.dynamic_family_form_models += 1;

  const changedLocator = structuredClone(canary);
  changedLocator.models[0]!.field_locators[0]!.line += 1;

  for (const changed of [
    movedFamily,
    movedForm,
    changedEvidenceClass,
    changedLocator
  ]) {
    assert.equal(normalizedSettingsIrCanarySchema.safeParse(changed).success, true);
    assert.throws(
      () =>
        serializeNormalizedSettingsIrCanary(
          changed,
          sources.publicCatalog,
          sources.inventory
        ),
      hasCanaryCode("SOURCE_RELATIONSHIP_INVALID")
    );
  }

  const reorderedCostCandidates = buildNormalizedSettingsIrCanary({
    ...sources,
    modelIds: ["grok_imagine_2"]
  });
  reorderedCostCandidates.models[0]!.cost_projection.caller_supplied_candidates.reverse();
  assert.equal(
    normalizedSettingsIrCanarySchema.safeParse(reorderedCostCandidates).success,
    true
  );
  assert.throws(
    () =>
      serializeNormalizedSettingsIrCanary(
        reorderedCostCandidates,
        sources.publicCatalog,
        sources.inventory
      ),
    hasCanaryCode("SOURCE_RELATIONSHIP_INVALID")
  );
});

test("rejects public, inventory, model-reference, and snapshot drift", () => {
  const sources = loadSources();
  const canary = buildNormalizedSettingsIrCanary({
    ...sources,
    modelIds: CANARY_IDS
  });

  const publicDrift = structuredClone(sources.publicCatalog);
  publicDrift.sources.models.canonical_sha256 = DIFFERENT_SHA256;
  assert.throws(
    () =>
      buildNormalizedSettingsIrCanary({
        publicCatalog: publicDrift,
        inventory: sources.inventory,
        modelIds: CANARY_IDS
      }),
    hasCanaryCode("SOURCE_VALIDATION_FAILED")
  );

  const inventoryDrift = structuredClone(sources.inventory);
  inventoryDrift.public_catalog.models_sha256 = DIFFERENT_SHA256;
  assert.throws(
    () =>
      buildNormalizedSettingsIrCanary({
        publicCatalog: sources.publicCatalog,
        inventory: inventoryDrift,
        modelIds: CANARY_IDS
      }),
    hasCanaryCode("SOURCE_RELATIONSHIP_INVALID")
  );

  const registryDrift = structuredClone(sources.inventory);
  const registryArtifact = registryDrift.source_artifacts.find(
    (artifact) =>
      artifact.role === "SETTINGS_REGISTRY" &&
      artifact.kind === "JAVASCRIPT"
  );
  assert.ok(registryArtifact);
  registryArtifact.sha256 = DIFFERENT_REGISTRY_SHA256;
  for (const entry of [
    ...registryDrift.family_forms,
    ...registryDrift.unbound_registry_forms
  ]) {
    entry.evidence.module_sha256 = DIFFERENT_REGISTRY_SHA256;
  }
  assert.throws(
    () =>
      buildNormalizedSettingsIrCanary({
        publicCatalog: sources.publicCatalog,
        inventory: registryDrift,
        modelIds: CANARY_IDS
      }),
    hasCanaryCode("SOURCE_RELATIONSHIP_INVALID")
  );

  const sourceBindingDrift = structuredClone(canary);
  sourceBindingDrift.source_inventory.canonical_sha256 = DIFFERENT_SHA256;
  assert.throws(
    () =>
      assertNormalizedSettingsIrCanaryMatchesSources(
        sourceBindingDrift,
        sources.publicCatalog,
        sources.inventory
      ),
    hasCanaryCode("SOURCE_RELATIONSHIP_INVALID")
  );

  const modelReferenceDrift = structuredClone(canary);
  modelReferenceDrift.models[0]!.public_model_ref.canonical_sha256 =
    DIFFERENT_SHA256;
  assert.throws(
    () =>
      assertNormalizedSettingsIrCanaryMatchesSources(
        modelReferenceDrift,
        sources.publicCatalog,
        sources.inventory
      ),
    hasCanaryCode("SOURCE_RELATIONSHIP_INVALID")
  );

  assert.throws(
    () =>
      assertNormalizedSettingsIrCanaryUnchanged(
        canary,
        sourceBindingDrift
      ),
    hasCanaryCode("CANARY_DRIFT_DETECTED")
  );
});

test("strict schema cannot promote partial records or persist raw source", () => {
  const sources = loadSources();
  const canary = buildNormalizedSettingsIrCanary({
    ...sources,
    modelIds: CANARY_IDS
  });

  const runtimeEnabled = structuredClone(canary) as unknown as Record<
    string,
    unknown
  >;
  runtimeEnabled.runtime_usable = true;
  assert.equal(
    normalizedSettingsIrCanarySchema.safeParse(runtimeEnabled).success,
    false
  );

  const falseProven = structuredClone(canary) as unknown as {
    models: Array<{ defaults: { status: string } }>;
  };
  falseProven.models[0]!.defaults.status = "PROVEN";
  assert.equal(
    normalizedSettingsIrCanarySchema.safeParse(falseProven).success,
    false
  );

  const falseComplete = structuredClone(canary) as unknown as {
    models: Array<Record<string, unknown>>;
  };
  falseComplete.models[0]!.completeness = "COMPLETE";
  falseComplete.models[0]!.normalized_schema_hash = DIFFERENT_SHA256;
  assert.equal(
    normalizedSettingsIrCanarySchema.safeParse(falseComplete).success,
    false
  );

  const schemaHashOnPartial = structuredClone(canary) as unknown as {
    models: Array<Record<string, unknown>>;
  };
  schemaHashOnPartial.models[0]!.normalized_schema_hash = DIFFERENT_SHA256;
  assert.equal(
    normalizedSettingsIrCanarySchema.safeParse(schemaHashOnPartial).success,
    false
  );

  const rawSource = structuredClone(canary) as unknown as Record<
    string,
    unknown
  >;
  rawSource.source = PRIVATE_MARKER;
  assert.equal(normalizedSettingsIrCanarySchema.safeParse(rawSource).success, false);
});

test("serialization carries hashes and locators but excludes source bodies and maps", () => {
  const sources = loadSources();
  const publicCatalog = structuredClone(sources.publicCatalog);
  const inventory = structuredClone(sources.inventory);
  const publicModel = publicCatalog.models.find(
    (model) => model.value === "banana"
  );
  assert.ok(publicModel);
  publicModel.label = PRIVATE_MARKER;
  publicModel.description = `sourcesContent ${PRIVATE_MARKER}`;
  const modelsHash = sha256CanonicalPayload(publicCatalog.models);
  publicCatalog.sources.models.canonical_sha256 = modelsHash;
  inventory.public_catalog.models_sha256 = modelsHash;

  const canary = buildNormalizedSettingsIrCanary({
    publicCatalog,
    inventory,
    modelIds: CANARY_IDS
  });
  const serialized = serializeNormalizedSettingsIrCanary(
    canary,
    publicCatalog,
    inventory
  );
  assert.equal(serialized.includes(PRIVATE_MARKER), false);
  assert.equal(serialized.includes("sourcesContent"), false);
  assert.equal(serialized.includes('"module_url"'), false);
  assert.equal(serialized.includes('"source_map_url"'), false);
  assert.equal(serialized.includes('"source":'), false);
  assert.equal(serialized.includes('"map":'), false);
  assert.equal(serialized.includes('"settings"'), false);
  assert.equal(serialized.includes('"source_path"'), true);
  assert.equal(serialized.includes('"source_content_sha256"'), true);
});

test("no production source imports the offline IR module", async () => {
  const irPath = join("src", "catalog", "normalized-settings-ir.ts");
  for (const path of await listTypeScriptFiles("src")) {
    if (path === irPath) continue;
    const source = await readFile(path, "utf8");
    const imports = collectModuleSpecifiers(path, source);
    assert.equal(
      imports.some((specifier) => specifier.includes("normalized-settings-ir")),
      false,
      `${path} must not import the offline IR canary`
    );
  }

  const irSource = await readFile(
    irPath,
    "utf8"
  );
  const irImports = collectModuleSpecifiers(
    irPath,
    irSource
  );
  for (const forbiddenLayer of ["adapter", "application", "mcp", "runtime"]) {
    assert.equal(
      irImports.some((specifier) =>
        specifier.includes(`/${forbiddenLayer}/`)
      ),
      false,
      `offline IR must not import the ${forbiddenLayer} layer`
    );
  }
});

test("packaged IR check is read-only and CLI failures are fixed", async () => {
  const before = await readFile(CANARY_PATH, "utf8");
  const success = spawnSync(
    process.execPath,
    ["scripts/sync-normalized-settings-ir.mjs", "--check"],
    { encoding: "utf8", timeout: 10_000 }
  );
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, "");
  assert.match(
    success.stdout,
    /^Normalized settings IR canary evidence shell unchanged\. models=4 partial=4 locators=11 compilation=NOT_COMPILED runtime_usable=false\n$/u
  );

  const invalid = spawnSync(
    process.execPath,
    ["scripts/sync-normalized-settings-ir.mjs", "--invalid"],
    { encoding: "utf8", timeout: 10_000 }
  );
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, "");
  assert.equal(
    invalid.stderr,
    "Normalized settings IR canary failed: INVALID_ARGUMENT.\n"
  );
  const noArgument = spawnSync(
    process.execPath,
    ["scripts/sync-normalized-settings-ir.mjs"],
    { encoding: "utf8", timeout: 10_000 }
  );
  assert.equal(noArgument.status, 1);
  assert.equal(noArgument.stdout, "");
  assert.equal(
    noArgument.stderr,
    "Normalized settings IR canary failed: INVALID_ARGUMENT.\n"
  );
  assert.equal(await readFile(CANARY_PATH, "utf8"), before);
});

function loadSources(): {
  publicCatalog: SyntxPublicCatalogSnapshot;
  inventory: ReturnType<typeof loadSettingsSourceInventory>;
} {
  const publicCatalog = loadSyntxPublicCatalogSnapshot();
  const inventory = loadSettingsSourceInventory(undefined, publicCatalog);
  return { publicCatalog, inventory };
}

function hasCanaryCode(code: NormalizedSettingsIrError["code"]) {
  return (error: unknown): boolean =>
    error instanceof NormalizedSettingsIrError && error.code === code;
}

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTypeScriptFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files.sort();
}

function collectModuleSpecifiers(path: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const specifiers: string[] = [];
  const addStringLiteral = (node: ts.Expression | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addStringLiteral(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      addStringLiteral(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}
