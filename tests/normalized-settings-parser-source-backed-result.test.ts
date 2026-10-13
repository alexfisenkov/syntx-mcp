import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as runtime from "../src/catalog/normalized-settings-parser-source-backed-result.js";
import { SOURCE_BACKED_C1A_CHECKPOINT } from "../src/catalog/normalized-settings-parser-source-backed-result.js";
import {
  loadNormalizedSettingsParserCensusManifest,
} from "../src/catalog/normalized-settings-parser-census-manifest.js";
import { loadSettingsSourceInventory } from "../src/catalog/settings-source-inventory.js";
import { loadSyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import {
  __testOnlyAssertFreshParserCanaryMatchesRecorded,
  buildBananaSourceBackedResultFromPinnedSource,
  collectSourceBackedImplementationComponents,
  SourceBackedResultToolchainError,
} from "../tools/settings-ir/source-backed-result-toolchain.js";
import { sha256CanonicalPayload } from "../src/catalog/syntx-public-catalog.js";
import {
  normalizedSettingsParserSourceBackedResultSchema,
  assertNormalizedSettingsParserSourceBackedResultMatchesImplementations,
  serializeNormalizedSettingsParserSourceBackedResult,
  loadNormalizedSettingsParserSourceBackedResult,
  SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES,
} from "../src/catalog/normalized-settings-parser-source-backed-result.js";

test("runtime snapshot module has no generic C1a builder or build input", () => {
  assert.equal(
    "buildNormalizedSettingsParserSourceBackedResult" in runtime,
    false,
  );
  assert.equal(
    "BuildNormalizedSettingsParserSourceBackedResultInput" in runtime,
    false,
  );
  assert.equal(
    typeof runtime.loadNormalizedSettingsParserSourceBackedResult,
    "function",
  );
  assert.equal(
    typeof runtime.serializeNormalizedSettingsParserSourceBackedResult,
    "function",
  );
});

test("runtime snapshot schema uses canonical UTC checks and ordered timestamps", async () => {
  const source = await readFile(
    "src/catalog/normalized-settings-parser-source-backed-result.ts",
    "utf8",
  );
  assert.match(source, /new Date\(epoch\)\.toISOString\(\) === value/u);
  assert.match(
    source,
    /Date\.parse\(result\.generated_at\) < Date\.parse\(result\.source_observed_at\)/u,
  );
  assert.match(source, /MAX_IMPLEMENTATION_SET_BYTES/u);
});

test("runtime snapshot does not expose a source-free C1a construction API", async () => {
  const source = await readFile(
    "src/catalog/normalized-settings-parser-source-backed-result.ts",
    "utf8",
  );
  assert.equal(source.includes("export function buildNormalized"), false);
  assert.equal(
    source.includes("BuildNormalizedSettingsParserSourceBackedResultInput"),
    false,
  );
  assert.equal(SOURCE_BACKED_C1A_CHECKPOINT.parserArtifactBytes, 16_600);
});

test("corrupt local C0 binding fails before the pinned loader is called", async () => {
  const publicCatalog = loadSyntxPublicCatalogSnapshot();
  const inventory = loadSettingsSourceInventory(undefined, publicCatalog);
  const censusManifest = loadNormalizedSettingsParserCensusManifest({
    publicCatalog,
    inventory,
  });
  const [censusArtifactText, parserArtifactText] = await Promise.all([
    readFile(
      join(
        "catalog",
        "runtime",
        "v2",
        "normalized-settings-parser-census-manifest.json",
      ),
      "utf8",
    ),
    readFile(
      join(
        "catalog",
        "runtime",
        "v1",
        "normalized-settings-parser-canary.json",
      ),
      "utf8",
    ),
  ]);
  let calls = 0;
  const fetchSpy = async (): Promise<Response> => {
    calls += 1;
    throw new Error("must not fetch");
  };
  await assert.rejects(
    () =>
      buildBananaSourceBackedResultFromPinnedSource({
        publicCatalog,
        inventory,
        censusManifest,
        censusArtifactText: `${censusArtifactText} `,
        parserArtifactText,
        fetchImpl: fetchSpy,
      }),
    (error: unknown) =>
      error instanceof SourceBackedResultToolchainError &&
      error.code === "SOURCE_BACKED_TOOLCHAIN_INVALID",
  );
  assert.equal(calls, 0);
});

test("parser and timestamp preflight failures make zero fetch calls", async () => {
  const publicCatalog = loadSyntxPublicCatalogSnapshot();
  const inventory = loadSettingsSourceInventory(undefined, publicCatalog);
  const censusManifest = loadNormalizedSettingsParserCensusManifest({
    publicCatalog,
    inventory,
  });
  const [censusArtifactText, parserArtifactText] = await Promise.all([
    readFile(
      join(
        "catalog",
        "runtime",
        "v2",
        "normalized-settings-parser-census-manifest.json",
      ),
      "utf8",
    ),
    readFile(
      join(
        "catalog",
        "runtime",
        "v1",
        "normalized-settings-parser-canary.json",
      ),
      "utf8",
    ),
  ]);
  for (const extra of [
    { parserArtifactText: `${parserArtifactText} ` },
    {
      sourceObservedAt: "2026-02-30T00:00:00.000Z",
      generatedAt: "2026-09-03T01:30:00.000Z",
    },
    {
      sourceObservedAt: "2026-09-03T01:30:01.000Z",
      generatedAt: "2026-09-03T01:30:00.000Z",
    },
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        buildBananaSourceBackedResultFromPinnedSource({
          publicCatalog,
          inventory,
          censusManifest,
          censusArtifactText,
          parserArtifactText,
          fetchImpl: async () => {
            calls += 1;
            throw new Error("must not fetch");
          },
          ...extra,
        }),
      (error: unknown) => error instanceof SourceBackedResultToolchainError,
    );
    assert.equal(calls, 0);
  }
});

test("fresh parser canary drift beyond an unchanged summary fails closed", async () => {
  const parserArtifactText = await readFile(
    join("catalog", "runtime", "v1", "normalized-settings-parser-canary.json"),
    "utf8",
  );
  const recorded = JSON.parse(parserArtifactText);
  const fresh = structuredClone(recorded);
  assert.doesNotThrow(() =>
    __testOnlyAssertFreshParserCanaryMatchesRecorded(recorded, fresh),
  );
  fresh.models[0].active = !fresh.models[0].active;

  assert.deepEqual(fresh.summary, recorded.summary);
  assert.throws(
    () =>
      __testOnlyAssertFreshParserCanaryMatchesRecorded(recorded, fresh),
    (error: unknown) =>
      error instanceof SourceBackedResultToolchainError &&
      error.code === "SOURCE_BACKED_TOOLCHAIN_INVALID",
  );
});

test("manual non-evidence fixture exercises schema, persistence, and promotion guards", async () => {
  const fixture = makeSchemaFixtureNotEvidence();
  assert.equal(
    normalizedSettingsParserSourceBackedResultSchema.safeParse(fixture).success,
    true,
  );
  for (const mutate of [
    (value: any) => {
      value.source_observed_at = "2026-02-30T00:00:00.000Z";
    },
    (value: any) => {
      value.generated_at = "2026-09-02T20:00:00.000Z";
    },
    (value: any) => {
      value.toolchain.implementation_components[0].bytes = 33 * 1024 * 1024;
    },
    (value: any) => {
      value.raw_source = "secret";
    },
    (value: any) => {
      value.source_url = "https://example.invalid";
    },
    (value: any) => {
      value.runtime_usable = true;
    },
    (value: any) => {
      value.scope.full_cohort = true;
    },
  ]) {
    const candidate = structuredClone(fixture);
    mutate(candidate);
    assert.equal(
      normalizedSettingsParserSourceBackedResultSchema.safeParse(candidate)
        .success,
      false,
    );
  }
  const text = JSON.stringify(fixture, null, 2) + "\n";
  assert.equal(text.includes("/Users/"), false);
  assert.equal(text.includes("sourcesContent"), false);
  const publicCatalog = loadSyntxPublicCatalogSnapshot();
  const inventory = loadSettingsSourceInventory(undefined, publicCatalog);
  const censusManifest = loadNormalizedSettingsParserCensusManifest({
    publicCatalog,
    inventory,
  });
  const parserArtifactText = await readFile(
    join("catalog", "runtime", "v1", "normalized-settings-parser-canary.json"),
    "utf8",
  );
  const censusArtifactText = await readFile(
    join(
      "catalog",
      "runtime",
      "v2",
      "normalized-settings-parser-census-manifest.json",
    ),
    "utf8",
  );
  const parserCanary = JSON.parse(parserArtifactText);
  const canonical = serializeNormalizedSettingsParserSourceBackedResult(
    fixture as any,
    {
      publicCatalog,
      inventory,
      censusManifest,
      censusArtifactText,
      parserCanary,
      parserArtifactText,
    },
  );
  const directory = await mkdtemp(join(tmpdir(), "syntx-c1a-fixture-"));
  try {
    const path = join(directory, "result.json");
    await writeFile(path, canonical, "utf8");
    assert.deepEqual(
      loadNormalizedSettingsParserSourceBackedResult({
        path,
        publicCatalog,
        inventory,
        censusManifest,
        censusArtifactText,
        parserCanary,
        parserArtifactText,
      }),
      fixture,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("aggregate limit and framed implementation mutation fail closed", () => {
  const aggregate = makeSchemaFixtureNotEvidence() as any;
  const components = aggregate.toolchain.implementation_components;
  components[0].bytes = 16 * 1024 * 1024;
  components[1].bytes = 16 * 1024 * 1024;
  components[2].bytes = 1;
  aggregate.toolchain.implementation_set_sha256 =
    sha256CanonicalPayload(components);
  assert.equal(
    normalizedSettingsParserSourceBackedResultSchema.safeParse(aggregate)
      .success,
    false,
  );

  const actual = collectSourceBackedImplementationComponents();
  const result = makeSchemaFixtureNotEvidence() as any;
  result.toolchain.implementation_components = actual.map((entry) => ({
    name: entry.name,
    bytes: entry.bytes.byteLength,
    sha256: `sha256:${createHash("sha256").update(entry.bytes).digest("hex")}`,
  }));
  result.toolchain.implementation_set_sha256 = sha256CanonicalPayload(
    result.toolchain.implementation_components,
  );
  assert.doesNotThrow(() =>
    assertNormalizedSettingsParserSourceBackedResultMatchesImplementations(
      result,
      actual,
    ),
  );
  const changed = actual.map((entry) => ({
    name: entry.name,
    bytes: Buffer.from(entry.bytes),
  }));
  const adapter = changed.find(
    (entry) => entry.name === "banana-parser-adapter",
  )!;
  adapter.bytes[0] = (adapter.bytes[0] ?? 0) ^ 1;
  assert.throws(
    () =>
      assertNormalizedSettingsParserSourceBackedResultMatchesImplementations(
        result,
        changed,
      ),
    (error: unknown) =>
      (error as { code?: unknown }).code ===
      "IMPLEMENTATION_RELATIONSHIP_INVALID",
  );
});

function makeSchemaFixtureNotEvidence(): Record<string, unknown> {
  const components = SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES.map(
    (name) => ({
      name,
      bytes: 1,
      sha256:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }),
  );
  const timestamp = "2026-09-03T01:30:00.000Z";
  return {
    schema_version: "3.0.0",
    catalog_kind: "OBSERVED_NORMALIZED_SETTINGS_IR_SOURCE_BACKED_RESULT",
    evidence_level: "STATIC_PINNED_SOURCE_COMPILATION",
    runtime_usable: false,
    source_observed_at: timestamp,
    generated_at: timestamp,
    bindings: {
      census_manifest: {
        schema_version: "2.0.0",
        catalog_kind: "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CENSUS_MANIFEST",
        artifact_bytes: 428390,
        artifact_sha256: SOURCE_BACKED_C1A_CHECKPOINT.censusArtifactSha256,
        generated_at: "2026-09-02T21:00:08.402Z",
        cohort_sha256: SOURCE_BACKED_C1A_CHECKPOINT.censusCohortSha256,
        public_catalog_sha256: SOURCE_BACKED_C1A_CHECKPOINT.publicCatalogSha256,
        source_inventory_sha256:
          SOURCE_BACKED_C1A_CHECKPOINT.sourceInventorySha256,
      },
      parser_result: {
        schema_version: "1.1.0",
        catalog_kind: "OBSERVED_NORMALIZED_SETTINGS_IR_PARSER_CANARY",
        artifact_bytes: 16600,
        artifact_sha256: SOURCE_BACKED_C1A_CHECKPOINT.parserArtifactSha256,
        generated_at: "2026-09-02T21:00:08.402Z",
        compilation_status: "PARTIAL_COMPILED",
      },
    },
    scope: {
      kind: "EXACT_C0_FORM_MODEL_SOURCE_SUBSET",
      closure_policy: "C0_FORM_ROOTS_WITH_NO_AUXILIARIES_V1",
      full_cohort: false,
      form_ids: ["banana"],
      model_ids: ["banana", "banana2", "banana3", "banana3_light"],
      source_ref_ids: [SOURCE_BACKED_C1A_CHECKPOINT.sourceRefId],
    },
    source_verification: {
      status: "PINNED_SOURCE_BYTES_REFETCHED_AND_MATCHED",
      sources: [
        {
          source_ref_id: SOURCE_BACKED_C1A_CHECKPOINT.sourceRefId,
          fetched_artifacts: 2,
          verification_status: "JS_MAP_AND_SOURCE_HASH_MATCHED",
          compilation_input: true,
        },
      ],
      vendor_source_persisted: false,
    },
    toolchain: {
      parser_profile: "STATIC_SETTINGS_V1",
      compilation_status: "PARTIAL_COMPILED",
      engine: {
        name: "typescript",
        version: SOURCE_BACKED_C1A_CHECKPOINT.typescriptVersion,
        normalized_compiler_sha256:
          SOURCE_BACKED_C1A_CHECKPOINT.normalizedCompilerSha256,
        execution_mode: "SYNTAX_ONLY_NO_VENDOR_EXECUTION",
        type_checking: false,
        emit: false,
        import_resolution: false,
      },
      implementation_hash_algorithm: "FRAMED_COMPONENT_BYTES_SHA256_V1",
      implementation_components: components,
      implementation_set_sha256: sha256CanonicalPayload(components),
      vendor_code_executed: false,
    },
    result: {
      verification_status: "EXACT_RECOMPILED_PARSER_ARTIFACT_MATCH",
      parser_artifact_sha256: SOURCE_BACKED_C1A_CHECKPOINT.parserArtifactSha256,
      summary: {
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
        runtime_usable_models: 0,
      },
    },
    coverage: {
      c0_forms: 42,
      declared_forms: 1,
      unscoped_c0_forms: 41,
      c0_models: 192,
      declared_models: 4,
      unscoped_c0_models: 188,
      c0_source_refs: 123,
      declared_source_refs: 1,
      verified_source_refs: 1,
      compiled_source_units: 1,
      unscoped_c0_source_refs: 122,
      c0_current_mapped_provider_source_refs: 76,
      declared_current_mapped_provider_source_refs: 1,
      c0_deferred_source_refs: 47,
      declared_deferred_source_refs: 0,
      compiled_forms: 1,
      partial_forms: 1,
      partial_models: 4,
      proven_projections: 0,
      absent_proven_projections: 0,
      blocked_projections: 6,
      blocked_projections_with_static_candidates: 2,
      form_blockers: 17,
      model_blockers: 4,
      runtime_usable_models: 0,
    },
    limitations: [
      "DECLARED_SUBSET_ONLY_NOT_FULL_COHORT",
      "FRONTEND_EVIDENCE_IS_NOT_A_BACKEND_CONTRACT",
      "PINNED_BUILD_MATCH_IS_NOT_ACTIVE_BUILD_DISCOVERY",
      "PAYLOAD_AND_BACKEND_EQUIVALENCE_UNVERIFIED",
      "NO_GENERATION_OR_AUTH_CALLS_PERFORMED",
    ],
  };
}

// DEBT-023: the published v3 artifact's exact byte count and hash were only
// ever repeated by hand across eight documents, with nothing pinning them to
// the committed file the way tests/normalized-settings-parser-census-manifest.test.ts
// and tests/gate-b-byte-integrity.test.ts already pin C0 (428390 bytes) and
// Gate B (16600 bytes). A silent edit to the committed file would otherwise
// only ever be caught by prose drifting from reality, not by a test.
test("the committed v3 artifact's exact byte count and hash are pinned, not only documented", async () => {
  const bytes = await readFile(
    new URL(
      "../../catalog/runtime/v3/normalized-settings-parser-source-backed-result.json",
      import.meta.url,
    ),
  );
  assert.equal(bytes.length, 5722);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "48d1ec27e31a60a55de4a58aaff2ca77c91fb6b6d5fdb9ff05ea96d573ca2146",
  );
});

// DEBT-016: scripts/source-backed-result/paths.mjs keeps its own copy of the
// same checksum constants as SOURCE_BACKED_C1A_CHECKPOINT (this hash-bound
// module), in a second format (bare hex vs "sha256:"-prefixed). paths.mjs
// deliberately does not import compiled dist/ output (it is documented as
// "Pure data — no I/O, no project imports", used before a build can exist),
// so the two copies cannot be unified into one import without breaking that
// property. This guard is the alternative: any accidental edit to either
// copy without the other now fails a test instead of silently diverging.
test("scripts/source-backed-result/paths.mjs's checkpoint constants never drift from SOURCE_BACKED_C1A_CHECKPOINT", async () => {
  const paths = await import(
    new URL("../../scripts/source-backed-result/paths.mjs", import.meta.url).href
  );
  assert.equal(paths.EXPECTED_CENSUS_BYTES, SOURCE_BACKED_C1A_CHECKPOINT.censusArtifactBytes);
  assert.equal(`sha256:${paths.EXPECTED_CENSUS_SHA256}`, SOURCE_BACKED_C1A_CHECKPOINT.censusArtifactSha256);
  assert.equal(paths.EXPECTED_COHORT_SHA256, SOURCE_BACKED_C1A_CHECKPOINT.censusCohortSha256);
  assert.equal(paths.EXPECTED_PARSER_BYTES, SOURCE_BACKED_C1A_CHECKPOINT.parserArtifactBytes);
  assert.equal(`sha256:${paths.EXPECTED_PARSER_SHA256}`, SOURCE_BACKED_C1A_CHECKPOINT.parserArtifactSha256);
});
