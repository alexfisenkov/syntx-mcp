import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  assertNormalizedSettingsParserCanaryMatchesSources,
  assertNormalizedSettingsParserCanaryUnchanged,
  buildNormalizedSettingsParserCanary,
  loadNormalizedSettingsParserCanary,
  NormalizedSettingsParserCanaryError,
  normalizedSettingsParserCanarySchema,
  serializeNormalizedSettingsParserCanary,
  type NormalizedSettingsParserCompilerOutput,
  type StaticSettingsLocator,
  type StaticSettingsSourceRef
} from "../src/catalog/normalized-settings-parser-canary.js";
import {
  loadSettingsSourceInventory,
  type SettingsSourceInventory
} from "../src/catalog/settings-source-inventory.js";
import {
  loadSyntxPublicCatalogSnapshot,
  sha256CanonicalPayload,
  type SyntxPublicCatalogSnapshot
} from "../src/catalog/syntx-public-catalog.js";

const DIFFERENT_SHA256 = `sha256:${"f".repeat(64)}`;
const ENGINE_SHA256 = `sha256:${"1".repeat(64)}`;
const PRIVATE_MARKER = "PRIVATE_VENDOR_SOURCE_BODY_MUST_NOT_ESCAPE";
const PARSER_CANARY_PATH = join(
  "catalog",
  "runtime",
  "v1",
  "normalized-settings-parser-canary.json"
);

test("builds one exact partial Banana parser canary", () => {
  const sources = loadSources();
  const compilerOutput = makeCompilerOutput(sources.inventory);
  const canary = buildNormalizedSettingsParserCanary({
    ...sources,
    compilerOutput
  });

  assert.equal(canary.schema_version, "1.1.0");
  assert.equal(
    canary.catalog_kind,
    "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CANARY"
  );
  assert.equal(canary.runtime_usable, false);
  assert.deepEqual(canary.scope.model_ids, [
    "banana",
    "banana2",
    "banana3",
    "banana3_light"
  ]);
  assert.equal(canary.compiler.parser_profile, "STATIC_SETTINGS_V1");
  assert.equal(canary.compiler.compilation_status, "PARTIAL_COMPILED");
  assert.deepEqual(canary.compiler.engine, compilerOutput.engine);
  assert.equal(canary.compiler.vendor_code_executed, false);
  assert.equal(canary.compiler.vendor_source_persisted, false);
  assert.equal(canary.forms.length, 1);
  assert.equal(canary.forms[0].form_id, "banana");
  assert.equal(canary.forms[0].completeness, "PARTIAL");
  assert.equal(canary.forms[0].runtime_usable, false);
  assert.equal(canary.models.length, 4);
  assert.equal(canary.summary.compiled_forms, 1);
  assert.equal(canary.summary.partial_models, 4);
  assert.equal(canary.summary.proven_projections, 1);
  assert.equal(canary.summary.absent_proven_projections, 1);
  assert.equal(canary.summary.blocked_projections, 4);
  assert.equal(
    canary.summary.blocked_projections_with_static_candidates,
    1
  );
  assert.equal(canary.summary.form_blockers, 5);
  assert.equal(canary.summary.model_blockers, 4);
  assert.equal(canary.summary.runtime_usable_models, 0);

  assert.equal(canary.forms[0].projections.defaults.status, "PROVEN");
  assert.equal(
    canary.forms[0].projections.conditional_rules.status,
    "ABSENT_PROVEN"
  );
  assert.deepEqual(canary.forms[0].projections.watch_rules, {
    status: "BLOCKED"
  });
  assert.deepEqual(canary.forms[0].projections.controls, {
    status: "BLOCKED",
    proof_scope: "STATIC_CANDIDATES_ONLY_NOT_RUNTIME_SEMANTICS",
    static_candidates: [
      {
        path: ["image_size"],
        value: ["1K", "2K"],
        locator: makeLocator(canary.forms[0].source_ref, 20, 3, "ArrayLiteralExpression")
      }
    ]
  });

  for (const [index, model] of canary.models.entries()) {
    assert.equal(model.model_id, canary.scope.model_ids[index]);
    assert.equal(model.ai_name, "banana");
    assert.equal(model.active, true);
    assert.equal(model.evidence_class, "LITERAL_REFERENCE_EVIDENCE");
    assert.deepEqual(model.form_ref, { form_id: "banana" });
    assert.equal(model.completeness, "PARTIAL");
    assert.equal(model.runtime_usable, false);
    assert.equal(model.cost_projection.status, "PROVEN");
    assert.equal(
      model.cost_projection.proof_scope,
      "PARAMETER_OWNERSHIP_CLASSIFICATION_ONLY"
    );
    assert.deepEqual(model.cost_projection.server_derived, [
      "ai_name",
      "model_type"
    ]);
    assert.deepEqual(model.blockers, [
      {
        code: "BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED",
        projection: "cost_projection",
        locator: null
      }
    ]);
  }
  assert.deepEqual(
    canary.models[0].cost_projection.caller_supplied_candidates,
    []
  );
  for (const model of canary.models.slice(1)) {
    assert.deepEqual(model.cost_projection.caller_supplied_candidates, [
      "image_size"
    ]);
  }
});

test("binds one form to the exact recorded public, inventory, JS, map, and source hashes", () => {
  const sources = loadSources();
  const canary = buildNormalizedSettingsParserCanary({
    ...sources,
    compilerOutput: makeCompilerOutput(sources.inventory)
  });
  const form = sources.inventory.family_forms.find(
    (entry) => entry.ai_name === "banana" && entry.form_id === "banana"
  );
  const publicAi = sources.publicCatalog.ai.find(
    (entry) => entry.value === "banana"
  );
  assert.ok(form);
  assert.ok(publicAi);
  assert.equal(
    canary.forms[0].inventory_form_ref.canonical_sha256,
    sha256CanonicalPayload(form)
  );
  assert.equal(
    canary.forms[0].public_ai_ref.canonical_sha256,
    sha256CanonicalPayload(publicAi)
  );
  assert.equal(
    canary.source_inventory.canonical_sha256,
    sha256CanonicalPayload(sources.inventory)
  );

  const expectedSourceRef = sourceRefFromInventory(sources.inventory);
  assert.deepEqual(canary.forms[0].source_ref, expectedSourceRef);
  for (const model of canary.models) {
    const publicModel = sources.publicCatalog.models.find(
      (entry) => entry.value === model.model_id
    );
    assert.ok(publicModel);
    assert.equal(
      model.public_model_ref.canonical_sha256,
      sha256CanonicalPayload(publicModel)
    );
    assert.equal(
      model.public_model_ref.aggregate_models_sha256,
      sources.inventory.public_catalog.models_sha256
    );
  }
});

test("loads, serializes, compares, and round-trips deterministically", async () => {
  const sources = loadSources();
  const publicCatalog = structuredClone(sources.publicCatalog);
  const inventory = structuredClone(sources.inventory);
  const publicAi = publicCatalog.ai.find((entry) => entry.value === "banana");
  const publicModel = publicCatalog.models.find(
    (entry) => entry.value === "banana"
  );
  assert.ok(publicAi);
  assert.ok(publicModel);
  publicAi.description = PRIVATE_MARKER;
  publicModel.description = PRIVATE_MARKER;
  publicCatalog.sources.ai.canonical_sha256 = sha256CanonicalPayload(
    publicCatalog.ai
  );
  publicCatalog.sources.models.canonical_sha256 = sha256CanonicalPayload(
    publicCatalog.models
  );
  inventory.public_catalog.ai_sha256 =
    publicCatalog.sources.ai.canonical_sha256;
  inventory.public_catalog.models_sha256 =
    publicCatalog.sources.models.canonical_sha256;
  const canary = buildNormalizedSettingsParserCanary({
    publicCatalog,
    inventory,
    compilerOutput: makeCompilerOutput(inventory)
  });
  const first = serializeNormalizedSettingsParserCanary(
    canary,
    publicCatalog,
    inventory
  );
  const second = serializeNormalizedSettingsParserCanary(
    structuredClone(canary),
    publicCatalog,
    inventory
  );
  assert.equal(first, second);
  assert.equal(first.endsWith("\n"), true);
  assert.equal(first.includes('"normalized_schema_hash"'), false);
  assert.equal(first.includes(PRIVATE_MARKER), false);
  assert.equal(first.includes('"module_url"'), false);
  assert.equal(first.includes('"source_map_url"'), false);
  assert.equal(first.includes('"sourcesContent"'), false);

  const directory = await mkdtemp(join(tmpdir(), "syntx-parser-canary-"));
  const path = join(directory, "canary.json");
  try {
    await writeFile(path, first, "utf8");
    const loaded = loadNormalizedSettingsParserCanary({
      path,
      publicCatalog,
      inventory
    });
    assert.deepEqual(loaded, canary);
    assert.doesNotThrow(() =>
      assertNormalizedSettingsParserCanaryUnchanged(canary, loaded)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects schema promotions and unknown raw or sensitive fields", () => {
  const sources = loadSources();
  const compilerOutput = makeCompilerOutput(sources.inventory);
  const canary = buildNormalizedSettingsParserCanary({
    ...sources,
    compilerOutput
  });

  const mutations: unknown[] = [];
  const version = structuredClone(canary) as unknown as Record<string, unknown>;
  version.schema_version = "1.0.0";
  mutations.push(version);
  const runtime = structuredClone(canary) as unknown as Record<string, unknown>;
  runtime.runtime_usable = true;
  mutations.push(runtime);
  const complete = structuredClone(canary) as unknown as {
    forms: Array<Record<string, unknown>>;
  };
  complete.forms[0]!.completeness = "COMPLETE";
  complete.forms[0]!.normalized_schema_hash = DIFFERENT_SHA256;
  mutations.push(complete);
  const schemaHash = structuredClone(canary) as unknown as {
    models: Array<Record<string, unknown>>;
  };
  schemaHash.models[0]!.normalized_schema_hash = DIFFERENT_SHA256;
  mutations.push(schemaHash);
  const rawSource = structuredClone(canary) as unknown as {
    forms: Array<Record<string, unknown>>;
  };
  rawSource.forms[0]!.raw_source = PRIVATE_MARKER;
  mutations.push(rawSource);
  const rawMap = structuredClone(canary) as unknown as {
    forms: Array<{ source_ref: Record<string, unknown> }>;
  };
  rawMap.forms[0]!.source_ref.sourcesContent = PRIVATE_MARKER;
  mutations.push(rawMap);

  for (const mutation of mutations) {
    assert.equal(
      normalizedSettingsParserCanarySchema.safeParse(mutation).success,
      false
    );
  }

  const sensitiveCompiler = structuredClone(compilerOutput) as unknown as {
    forms: Array<{
      projections: { defaults: { facts: Array<{ value: unknown }> } };
    }>;
  };
  sensitiveCompiler.forms[0]!.projections.defaults.facts[0]!.value =
    "api_key=PRIVATE_VENDOR_SOURCE_BODY_MUST_NOT_ESCAPE";
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput:
          sensitiveCompiler as unknown as NormalizedSettingsParserCompilerOutput
      }),
    fixedError("PARSER_OUTPUT_INVALID", PRIVATE_MARKER)
  );
});

test("rejects duplicate and non-canonical fact, blocker, and model ordering", () => {
  const sources = loadSources();
  const compilerOutput = makeCompilerOutput(sources.inventory);

  const duplicateBlocker = structuredClone(compilerOutput);
  duplicateBlocker.forms[0].blockers.splice(
    1,
    0,
    structuredClone(duplicateBlocker.forms[0].blockers[0]!)
  );
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput: duplicateBlocker
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );

  const reversedBlockers = structuredClone(compilerOutput);
  reversedBlockers.forms[0].blockers.reverse();
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput: reversedBlockers
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );

  const unsortedFacts = structuredClone(compilerOutput);
  const defaults = unsortedFacts.forms[0].projections.defaults;
  assert.equal(defaults.status, "PROVEN");
  if (defaults.status !== "PROVEN") return;
  defaults.facts.push({
    path: ["aaa"],
    value: true,
    locator: makeLocator(
      compilerOutput.forms[0].source_ref,
      9,
      1,
      "TrueKeyword"
    )
  });
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput: unsortedFacts
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );

  const canary = buildNormalizedSettingsParserCanary({
    ...sources,
    compilerOutput
  });
  const movedModels = structuredClone(canary);
  [movedModels.models[0], movedModels.models[1]] = [
    movedModels.models[1],
    movedModels.models[0]
  ];
  assert.equal(
    normalizedSettingsParserCanarySchema.safeParse(movedModels).success,
    false
  );
});

test("keeps dotted static paths distinct from nested paths", () => {
  const sources = loadSources();
  const compilerOutput = makeCompilerOutput(sources.inventory);
  const sourceRef = compilerOutput.forms[0].source_ref;
  compilerOutput.forms[0].projections.defaults = {
    status: "PROVEN",
    proof_scope: "STATIC_LITERAL_TREE_ONLY",
    facts: [
      {
        path: ["a", "b"],
        value: 1,
        locator: makeLocator(sourceRef, 10, 3, "NumericLiteral")
      },
      {
        path: ["a.b"],
        value: 2,
        locator: makeLocator(sourceRef, 11, 3, "NumericLiteral")
      }
    ]
  };
  compilerOutput.forms[0].blockers =
    compilerOutput.forms[0].blockers.filter(
      (blocker) => blocker.projection !== "defaults"
    );

  assert.doesNotThrow(() =>
    buildNormalizedSettingsParserCanary({
      ...sources,
      compilerOutput
    })
  );
});

test("enforces blocker, locator, and blocked-candidate invariants", () => {
  const sources = loadSources();
  const compilerOutput = makeCompilerOutput(sources.inventory);

  const noMatchingBlocker = structuredClone(compilerOutput);
  noMatchingBlocker.forms[0].blockers =
    noMatchingBlocker.forms[0].blockers.filter(
      (blocker) => blocker.projection !== "watch_rules"
    );
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput: noMatchingBlocker
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );

  const contradictoryBlocker = structuredClone(compilerOutput);
  contradictoryBlocker.forms[0].blockers.unshift({
    code: "CALL_EXPRESSION_NOT_INTERPRETED",
    projection: "conditional_rules",
    locator: makeLocator(
      compilerOutput.forms[0].source_ref,
      5,
      1,
      "CallExpression"
    )
  });
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput: contradictoryBlocker
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );

  const localWithoutLocator = structuredClone(compilerOutput) as unknown as {
    forms: Array<{ blockers: Array<Record<string, unknown>> }>;
  };
  localWithoutLocator.forms[0]!.blockers[0]!.locator = null;
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput:
          localWithoutLocator as unknown as NormalizedSettingsParserCompilerOutput
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );

  const externalWithLocator = structuredClone(compilerOutput) as unknown as {
    forms: Array<{ blockers: Array<Record<string, unknown>> }>;
  };
  externalWithLocator.forms[0]!.blockers[2]!.locator = makeLocator(
    compilerOutput.forms[0].source_ref,
    1,
    1,
    "SourceFile"
  );
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput:
          externalWithLocator as unknown as NormalizedSettingsParserCompilerOutput
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );

  const movedLocator = structuredClone(compilerOutput);
  const movedDefaults = movedLocator.forms[0].projections.defaults;
  assert.equal(movedDefaults.status, "PROVEN");
  if (movedDefaults.status !== "PROVEN") return;
  movedDefaults.facts[0]!.locator.source_content_sha256 = DIFFERENT_SHA256;
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput: movedLocator
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );

  const falseBlockedCandidates = structuredClone(compilerOutput) as unknown as {
    forms: Array<{
      projections: { controls: Record<string, unknown> };
    }>;
  };
  falseBlockedCandidates.forms[0]!.projections.controls.proof_scope =
    "STATIC_LITERAL_TREE_ONLY";
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput:
          falseBlockedCandidates as unknown as NormalizedSettingsParserCompilerOutput
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );
});

test("accepts every stable local blocker code only with a sanitized locator", () => {
  const sources = loadSources();
  const localCodes = [
    ["CALL_EXPRESSION_NOT_INTERPRETED", "computed_rules"],
    ["COMPUTED_RULE_NOT_INTERPRETED", "computed_rules"],
    ["DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED", "computed_rules"],
    ["SOURCE_PATTERN_NOT_RECOGNIZED", "computed_rules"],
    ["TEMPLATE_CONTROL_FLOW_NOT_COMPILED", "controls"],
    ["WATCH_RULE_NOT_INTERPRETED", "watch_rules"]
  ] as const;

  for (const [index, [code, projection]] of localCodes.entries()) {
    const compilerOutput = makeCompilerOutput(sources.inventory);
    const selectedBlocker = compilerOutput.forms[0].blockers.find(
      (blocker) => blocker.projection === projection && blocker.locator !== null
    );
    assert.ok(selectedBlocker);
    assert.notEqual(selectedBlocker.locator, null);
    if (selectedBlocker.locator === null) return;
    selectedBlocker.code = code;
    selectedBlocker.locator = makeLocator(
      compilerOutput.forms[0].source_ref,
      50 + index,
      1,
      code === "TEMPLATE_CONTROL_FLOW_NOT_COMPILED"
        ? "IfDirective"
        : "CallExpression"
    );
    assert.doesNotThrow(() =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput
      })
    );
  }

  const mismatched = makeCompilerOutput(sources.inventory);
  const computedBlocker = mismatched.forms[0].blockers.find(
    (blocker) => blocker.projection === "computed_rules"
  );
  assert.ok(computedBlocker);
  computedBlocker.code = "WATCH_RULE_NOT_INTERPRETED";
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput: mismatched
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );
});

test("rejects source, public-reference, inventory-reference, and snapshot drift", () => {
  const sources = loadSources();
  const compilerOutput = makeCompilerOutput(sources.inventory);
  const canary = buildNormalizedSettingsParserCanary({
    ...sources,
    compilerOutput
  });

  const wrongCompilerSource = structuredClone(compilerOutput);
  wrongCompilerSource.forms[0].source_ref.provider_javascript_sha256 =
    DIFFERENT_SHA256;
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput: wrongCompilerSource
      }),
    hasCode("SOURCE_RELATIONSHIP_INVALID")
  );

  const sourceDrift = structuredClone(canary);
  sourceDrift.forms[0].source_ref.provider_source_map_sha256 = DIFFERENT_SHA256;
  assert.equal(
    normalizedSettingsParserCanarySchema.safeParse(sourceDrift).success,
    true
  );
  assert.throws(
    () =>
      assertNormalizedSettingsParserCanaryMatchesSources(
        sourceDrift,
        sources.publicCatalog,
        sources.inventory
      ),
    hasCode("SOURCE_RELATIONSHIP_INVALID")
  );

  const publicRefDrift = structuredClone(canary);
  publicRefDrift.models[0].public_model_ref.canonical_sha256 = DIFFERENT_SHA256;
  assert.throws(
    () =>
      assertNormalizedSettingsParserCanaryMatchesSources(
        publicRefDrift,
        sources.publicCatalog,
        sources.inventory
      ),
    hasCode("SOURCE_RELATIONSHIP_INVALID")
  );

  const formRefDrift = structuredClone(canary);
  formRefDrift.forms[0].inventory_form_ref.canonical_sha256 = DIFFERENT_SHA256;
  assert.throws(
    () =>
      assertNormalizedSettingsParserCanaryMatchesSources(
        formRefDrift,
        sources.publicCatalog,
        sources.inventory
      ),
    hasCode("SOURCE_RELATIONSHIP_INVALID")
  );

  const snapshotDrift = structuredClone(canary);
  snapshotDrift.compiler.engine.implementation_sha256 = DIFFERENT_SHA256;
  assert.throws(
    () => assertNormalizedSettingsParserCanaryUnchanged(canary, snapshotDrift),
    hasCode("PARSER_CANARY_DRIFT_DETECTED")
  );
});

test("source-bound serializer rejects a schema-valid projection relationship mutation", () => {
  const sources = loadSources();
  const canary = buildNormalizedSettingsParserCanary({
    ...sources,
    compilerOutput: makeCompilerOutput(sources.inventory)
  });
  const changed = structuredClone(canary);
  changed.forms[0].source_ref.source_content_sha256 = DIFFERENT_SHA256;
  const defaults = changed.forms[0].projections.defaults;
  if (defaults.status === "PROVEN") {
    for (const fact of defaults.facts) {
      fact.locator.source_content_sha256 = DIFFERENT_SHA256;
    }
  }
  const controls = changed.forms[0].projections.controls;
  if (controls.status === "BLOCKED" && "static_candidates" in controls) {
    for (const fact of controls.static_candidates) {
      fact.locator.source_content_sha256 = DIFFERENT_SHA256;
    }
  }
  for (const blocker of changed.forms[0].blockers) {
    if (blocker.locator !== null) {
      blocker.locator.source_content_sha256 = DIFFERENT_SHA256;
    }
  }
  assert.equal(
    normalizedSettingsParserCanarySchema.safeParse(changed).success,
    true
  );
  assert.throws(
    () =>
      serializeNormalizedSettingsParserCanary(
        changed,
        sources.publicCatalog,
        sources.inventory
      ),
    hasCode("SOURCE_RELATIONSHIP_INVALID")
  );
});

test("fixed errors do not echo model ids, source text, or parser details", () => {
  const sources = loadSources();
  const invalid = makeCompilerOutput(sources.inventory) as unknown as {
    parser_profile: string;
  };
  invalid.parser_profile = PRIVATE_MARKER;
  assert.throws(
    () =>
      buildNormalizedSettingsParserCanary({
        ...sources,
        compilerOutput:
          invalid as unknown as NormalizedSettingsParserCompilerOutput
      }),
    fixedError("PARSER_OUTPUT_INVALID", PRIVATE_MARKER)
  );

  assert.throws(
    () => loadNormalizedSettingsParserCanary({ path: "/definitely/missing" }),
    (error: unknown) =>
      error instanceof NormalizedSettingsParserCanaryError &&
      error.code === "PARSER_CANARY_INVALID" &&
      !error.message.includes("/definitely/missing")
  );
});

test("loads the saved source-backed partial parser canary", async () => {
  const sources = loadSources();
  const canary = loadNormalizedSettingsParserCanary(sources);
  assert.equal(canary.schema_version, "1.1.0");
  assert.equal(canary.compiler.compilation_status, "PARTIAL_COMPILED");
  assert.equal(canary.runtime_usable, false);
  assert.deepEqual(canary.summary, {
    scoped_models: 4,
    compiled_forms: 1,
    partial_forms: 1,
    partial_models: 4,
    proven_projections: 0,
    absent_proven_projections: 0,
    blocked_projections: 6,
    blocked_projections_with_static_candidates: 2,
    form_blockers: 17,
    model_blockers: 4,
    runtime_usable_models: 0
  });
  const recorded = await readFile(PARSER_CANARY_PATH, "utf8");
  assert.equal(
    serializeNormalizedSettingsParserCanary(
      canary,
      sources.publicCatalog,
      sources.inventory
    ),
    recorded
  );
  assert.equal(recorded.includes("sourcesContent"), false);
  assert.equal(recorded.includes("PRIVATE_VENDOR"), false);
});

test("no production source imports the parser canary or compiler tools", async () => {
  const parserPath = join(
    "src",
    "catalog",
    "normalized-settings-parser-canary.ts"
  );
  const sourceBackedResultPath = join(
    "src",
    "catalog",
    "normalized-settings-parser-source-backed-result.ts"
  );
  for (const path of await listTypeScriptFiles("src")) {
    if (path === parserPath || path === sourceBackedResultPath) continue;
    const source = await readFile(path, "utf8");
    const imports = collectModuleSpecifiers(path, source);
    assert.equal(
      imports.some(
        (specifier) =>
          specifier.includes("normalized-settings-parser-canary") ||
          specifier.includes("tools/settings-ir")
      ),
      false,
      `${path} must not import parser-canary tooling`
    );
  }
});

test("parser CLI offline check is read-only and invalid arguments are fixed", async () => {
  const before = await readFile(PARSER_CANARY_PATH, "utf8");
  const success = spawnSync(
    process.execPath,
    ["scripts/sync-normalized-settings-parser-canary.mjs", "--check"],
    { encoding: "utf8", timeout: 10_000 }
  );
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, "");
  assert.match(
    success.stdout,
    /^Normalized settings parser canary unchanged\. verification=OFFLINE models=4 forms=1 proven=0 absent=0 blocked=6 candidates=2 form_blockers=17 model_blockers=4 compilation=PARTIAL_COMPILED runtime_usable=false\n$/u
  );

  for (const argumentsValue of [[], ["--invalid"], ["--check", "extra"]]) {
    const rejected = spawnSync(
      process.execPath,
      ["scripts/sync-normalized-settings-parser-canary.mjs", ...argumentsValue],
      { encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, "");
    assert.equal(
      rejected.stderr,
      "Normalized settings parser canary failed: INVALID_ARGUMENT.\n"
    );
  }
  assert.equal(await readFile(PARSER_CANARY_PATH, "utf8"), before);
});

test("parser CLI network source modes require the confirm-source-fetch flag", async () => {
  const before = await readFile(PARSER_CANARY_PATH, "utf8");
  for (const mode of ["--check-source", "--sync-source"]) {
    const withoutFlag = spawnSync(
      process.execPath,
      ["scripts/sync-normalized-settings-parser-canary.mjs", mode],
      { encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(withoutFlag.status, 1);
    assert.equal(withoutFlag.stdout, "");
    assert.equal(
      withoutFlag.stderr,
      "Normalized settings parser canary failed: INVALID_ARGUMENT.\n"
    );

    const wrongOrder = spawnSync(
      process.execPath,
      [
        "scripts/sync-normalized-settings-parser-canary.mjs",
        "--confirm-source-fetch",
        mode,
      ],
      { encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(wrongOrder.status, 1);
    assert.equal(
      wrongOrder.stderr,
      "Normalized settings parser canary failed: INVALID_ARGUMENT.\n"
    );
  }
  assert.equal(await readFile(PARSER_CANARY_PATH, "utf8"), before);
});

function loadSources(): {
  publicCatalog: SyntxPublicCatalogSnapshot;
  inventory: SettingsSourceInventory;
} {
  const publicCatalog = loadSyntxPublicCatalogSnapshot();
  const inventory = loadSettingsSourceInventory(undefined, publicCatalog);
  return { publicCatalog, inventory };
}

function makeCompilerOutput(
  inventory: SettingsSourceInventory
): NormalizedSettingsParserCompilerOutput {
  const sourceRef = sourceRefFromInventory(inventory);
  return {
    parser_profile: "STATIC_SETTINGS_V1",
    engine: {
      name: "syntx-static-settings-compiler",
      version: "1.0.0",
      implementation_sha256: ENGINE_SHA256,
      execution_mode: "SYNTAX_ONLY_NO_VENDOR_EXECUTION",
      type_checking: false,
      emit: false,
      import_resolution: false
    },
    forms: [
      {
        form_id: "banana",
        source_ref: sourceRef,
        projections: {
          defaults: {
            status: "PROVEN",
            proof_scope: "STATIC_LITERAL_TREE_ONLY",
            facts: [
              {
                path: ["quality"],
                value: "standard",
                locator: makeLocator(
                  sourceRef,
                  10,
                  5,
                  "StringLiteral"
                )
              }
            ]
          },
          controls: {
            status: "BLOCKED",
            proof_scope:
              "STATIC_CANDIDATES_ONLY_NOT_RUNTIME_SEMANTICS",
            static_candidates: [
              {
                path: ["image_size"],
                value: ["1K", "2K"],
                locator: makeLocator(
                  sourceRef,
                  20,
                  3,
                  "ArrayLiteralExpression"
                )
              }
            ]
          },
          conditional_rules: {
            status: "ABSENT_PROVEN",
            proof_scope:
              "NO_RELEVANT_STATIC_CONSTRUCT_WITHIN_COMPILER_PROFILE"
          },
          watch_rules: { status: "BLOCKED" },
          computed_rules: { status: "BLOCKED" },
          payload_projection: { status: "BLOCKED" }
        },
        blockers: [
          {
            code: "COMPUTED_RULE_NOT_INTERPRETED",
            projection: "computed_rules",
            locator: makeLocator(
              sourceRef,
              30,
              7,
              "CallExpression"
            )
          },
          {
            code: "TEMPLATE_CONTROL_FLOW_NOT_COMPILED",
            projection: "controls",
            locator: makeLocator(sourceRef, 80, 4, "IfDirective")
          },
          {
            code: "BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED",
            projection: "payload_projection",
            locator: null
          },
          {
            code: "PAYLOAD_PROJECTION_UNVERIFIED",
            projection: "payload_projection",
            locator: null
          },
          {
            code: "WATCH_RULE_NOT_INTERPRETED",
            projection: "watch_rules",
            locator: makeLocator(
              sourceRef,
              40,
              9,
              "CallExpression"
            )
          }
        ]
      }
    ]
  };
}

function sourceRefFromInventory(
  inventory: SettingsSourceInventory
): StaticSettingsSourceRef {
  const javascript = inventory.source_artifacts.find(
    (artifact) =>
      artifact.role === "PROVIDER_FORM" &&
      artifact.kind === "JAVASCRIPT" &&
      artifact.form_id === "banana" &&
      artifact.module_name === "banana.js"
  );
  const sourceMap = inventory.source_artifacts.find(
    (artifact) =>
      artifact.role === "PROVIDER_FORM" &&
      artifact.kind === "SOURCE_MAP_V3" &&
      artifact.form_id === "banana" &&
      artifact.module_name === "banana.js"
  );
  const source = sourceMap?.source_map?.settings_sources[0];
  assert.ok(javascript);
  assert.ok(sourceMap);
  assert.ok(source);
  return {
    provider_javascript_sha256: javascript.sha256,
    provider_source_map_sha256: sourceMap.sha256,
    source_index: source.source_index,
    source_path: source.source_path,
    source_content_sha256: source.source_content_sha256
  };
}

function makeLocator(
  sourceRef: StaticSettingsSourceRef,
  line: number,
  column: number,
  nodeKind: string
): StaticSettingsLocator {
  return {
    source_index: sourceRef.source_index,
    source_path: sourceRef.source_path,
    source_content_sha256: sourceRef.source_content_sha256,
    line,
    column,
    node_kind: nodeKind
  };
}

function hasCode(code: NormalizedSettingsParserCanaryError["code"]) {
  return (error: unknown): boolean =>
    error instanceof NormalizedSettingsParserCanaryError && error.code === code;
}

function fixedError(
  code: NormalizedSettingsParserCanaryError["code"],
  forbiddenText: string
) {
  return (error: unknown): boolean =>
    error instanceof NormalizedSettingsParserCanaryError &&
    error.code === code &&
    error.message ===
      "SYNTX normalized settings parser canary could not be processed safely." &&
    !error.message.includes(forbiddenText);
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
  const imports: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}
