import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadNormalizedSettingsParserCensusManifest, serializeNormalizedSettingsParserCensusManifest, type NormalizedSettingsParserCensusManifest } from "../src/catalog/normalized-settings-parser-census-manifest.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { loadSettingsSourceInventory } from "../src/catalog/settings-source-inventory.js";
import { loadSettingsSourceInventoryVersion } from "../src/catalog/settings-source-history.js";
import { loadSyntxPublicCatalogSnapshot, type SyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { loadHelperConstantsResult, type HelperConstantsResult } from "../tools/settings-ir/v6/helper-constants-result.js";
import {
  archiveAlternateIdentityBindingResult,
  CURATED_TABLE_FINGERPRINT,
  existingAlternateIdentityBindingVersions,
  loadAlternateIdentityBindingResult,
  resolveAlternateIdentityBindings,
  serializeAlternateIdentityBindingResult,
  validateAlternateIdentityBindingResult,
  type AlternateIdentityBindingResult
} from "../tools/settings-ir/v7/alternate-identity-binding.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HELPER_RESULT_VERSION =
  "sha256-c579821472e481f2c1050f3ce2340e0b6d8c8fe8d499685ae03bc337101ed31a.json";

async function loadRealMaterial() {
  const censusPublicCatalog = loadSyntxPublicCatalogSnapshot();
  const censusInventory = loadSettingsSourceInventory(undefined, censusPublicCatalog);
  const censusManifest = loadNormalizedSettingsParserCensusManifest({
    publicCatalog: censusPublicCatalog,
    inventory: censusInventory
  });
  const helperPublicCatalog = loadPublicCatalogVersion(
    "sha256-75fa89113113cd83447e36064aa871f91dda43d9c3c16fc5c1e96364f974d7b8.json"
  );
  const helperInventory = loadSettingsSourceInventoryVersion(
    "sha256-89e53b19ffe9af02c902e59be481b8c7245555c6f45aeaa3d56222e2ed539f62.json",
    helperPublicCatalog
  );
  const helperResult = await loadHelperConstantsResult(
    HELPER_RESULT_VERSION,
    helperInventory,
    helperPublicCatalog,
    PROJECT_ROOT
  );
  return { censusManifest, censusPublicCatalog, censusInventory, helperResult };
}

function makeResult(
  helperResult: HelperConstantsResult,
  censusManifest: NormalizedSettingsParserCensusManifest,
  censusManifestSha256: string
): AlternateIdentityBindingResult {
  return {
    schema_version: 1,
    kind: "ALTERNATE_IDENTITY_BINDING",
    profile_fingerprint: CURATED_TABLE_FINGERPRINT,
    helper_result_version: HELPER_RESULT_VERSION,
    census_manifest_sha256: censusManifestSha256,
    observed_at: "2026-09-05T12:00:00.000Z",
    runtime_usable: false,
    entries: resolveAlternateIdentityBindings(helperResult, censusManifest)
  } as AlternateIdentityBindingResult;
}

test("real Hailuo/Luma helper constants resolve to exactly the census-expected ai_name", async () => {
  const { helperResult, censusManifest } = await loadRealMaterial();
  const entries = resolveAlternateIdentityBindings(helperResult, censusManifest);
  assert.equal(entries.length, 2);
  const byForm = new Map(entries.map((entry) => [entry.form_id, entry] as const));
  assert.equal(byForm.get("hailuo-minimax")?.ai_name, "hailuo-minimax");
  assert.equal(byForm.get("hailuo-minimax")?.evidence.constant_name, "MINIMAX_MODEL_NAME");
  assert.equal(byForm.get("luma-image")?.ai_name, "luma_image");
  assert.equal(byForm.get("luma-image")?.evidence.constant_name, "LUMA_AI_NAME");
  for (const entry of entries) {
    assert.equal(entry.identity_source, "CURATED_ALTERNATE_CONSTANT_NAME");
  }
});

test("a form the census manifest marks inactive is refused, not silently skipped", async () => {
  const { helperResult, censusManifest } = await loadRealMaterial();
  const mutated = structuredClone(censusManifest);
  const form = mutated.forms.find((entry) => entry.form_id === "hailuo-minimax");
  assert.ok(form);
  (form as { ai_active: boolean }).ai_active = false;
  assert.throws(
    () => resolveAlternateIdentityBindings(helperResult, mutated),
    /ALTERNATE_IDENTITY_FORM_NOT_ACTIVE/
  );
});

test("a drifted constant value is refused rather than trusted", async () => {
  const { helperResult, censusManifest } = await loadRealMaterial();
  const mutated = structuredClone(helperResult);
  const video = mutated.modules.find((module) => module.module_name === "video.js");
  assert.ok(video);
  const record = video.sources[0]!.constants.records.find(
    (candidate) => candidate.name === "MINIMAX_MODEL_NAME"
  ) as { value: string } | undefined;
  assert.ok(record);
  record.value = "hailuo-tampered";
  assert.throws(
    () => resolveAlternateIdentityBindings(mutated, censusManifest),
    /ALTERNATE_IDENTITY_VALUE_MISMATCH/
  );
});

test("a BLOCKED constant status is refused even if the name matches", async () => {
  const { helperResult, censusManifest } = await loadRealMaterial();
  const mutated = structuredClone(helperResult);
  const video = mutated.modules.find((module) => module.module_name === "video.js");
  assert.ok(video);
  const records = video.sources[0]!.constants.records as unknown as {
    scope: string;
    name: string;
    status: string;
    value?: unknown;
    blocker?: string;
  }[];
  const index = records.findIndex((candidate) => candidate.name === "MINIMAX_MODEL_NAME");
  assert.ok(index >= 0);
  records[index] = { scope: "module", name: "MINIMAX_MODEL_NAME", status: "BLOCKED", blocker: "SYNTHETIC" };
  assert.throws(
    () => resolveAlternateIdentityBindings(mutated, censusManifest),
    /ALTERNATE_IDENTITY_CONSTANT_NOT_STATIC_STRING/
  );
});

test("removing the curated module makes resolution fail closed, not silently drop the entry", async () => {
  const { helperResult, censusManifest } = await loadRealMaterial();
  const mutated = structuredClone(helperResult);
  mutated.modules = mutated.modules.filter((module) => module.module_name !== "video.js");
  assert.throws(
    () => resolveAlternateIdentityBindings(mutated, censusManifest),
    /ALTERNATE_IDENTITY_MODULE_MISSING/
  );
});

test("archive/load round-trips byte-identically and refuses a second archive of the same result", async (t) => {
  const { helperResult, censusManifest, censusPublicCatalog, censusInventory } = await loadRealMaterial();
  const censusManifestSha256 = validateAlternateIdentityBindingResultInputHash(
    censusManifest,
    censusPublicCatalog,
    censusInventory
  );
  const result = makeResult(helperResult, censusManifest, censusManifestSha256);
  const directory = await mkdtemp(join(tmpdir(), "syntx-v7-alt-identity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = await archiveAlternateIdentityBindingResult(
    result,
    HELPER_RESULT_VERSION,
    helperResult,
    censusManifest,
    censusPublicCatalog,
    censusInventory,
    directory
  );
  assert.equal(first.status, "created");

  const second = await archiveAlternateIdentityBindingResult(
    result,
    HELPER_RESULT_VERSION,
    helperResult,
    censusManifest,
    censusPublicCatalog,
    censusInventory,
    directory
  );
  assert.equal(second.status, "existing");
  assert.equal(second.version, first.version);

  const reloaded = await loadAlternateIdentityBindingResult(
    first.version,
    HELPER_RESULT_VERSION,
    helperResult,
    censusManifest,
    censusPublicCatalog,
    censusInventory,
    directory
  );
  const bytes = await readFile(first.path, "utf8");
  assert.equal(bytes, serializeAlternateIdentityBindingResult(reloaded));
  assert.equal(first.version, `sha256-${createSha256(Buffer.from(bytes))}.json`);
});

test("existingAlternateIdentityBindingVersions keys the create-once gate on the (helper_result_version, census_manifest_sha256) pair, not on the directory being non-empty", async (t) => {
  const { helperResult, censusManifest, censusPublicCatalog, censusInventory } = await loadRealMaterial();
  const censusManifestSha256 = validateAlternateIdentityBindingResultInputHash(
    censusManifest,
    censusPublicCatalog,
    censusInventory
  );
  const result = makeResult(helperResult, censusManifest, censusManifestSha256);
  const directory = await mkdtemp(join(tmpdir(), "syntx-v7-alt-identity-gate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  assert.deepEqual(
    existingAlternateIdentityBindingVersions(directory, HELPER_RESULT_VERSION, censusManifestSha256),
    []
  );

  const archived = await archiveAlternateIdentityBindingResult(
    result, HELPER_RESULT_VERSION, helperResult, censusManifest, censusPublicCatalog, censusInventory, directory
  );

  assert.deepEqual(
    existingAlternateIdentityBindingVersions(directory, HELPER_RESULT_VERSION, censusManifestSha256),
    [archived.version]
  );
  assert.deepEqual(
    existingAlternateIdentityBindingVersions(directory, `sha256-${"0".repeat(64)}.json`, censusManifestSha256),
    []
  );
  assert.deepEqual(
    existingAlternateIdentityBindingVersions(directory, HELPER_RESULT_VERSION, `sha256:${"0".repeat(64)}`),
    []
  );

  // A stray non-JSON or malformed file in the directory must be skipped, not thrown on.
  await writeFile(join(directory, "catalog", "runtime", "v7", `sha256-${"1".repeat(64)}.json`), "not json");
  assert.deepEqual(
    existingAlternateIdentityBindingVersions(directory, HELPER_RESULT_VERSION, censusManifestSha256),
    [archived.version]
  );
});

test("loading with the wrong helper_result_version binding is refused", async () => {
  const { helperResult, censusManifest, censusPublicCatalog, censusInventory } = await loadRealMaterial();
  const censusManifestSha256 = validateAlternateIdentityBindingResultInputHash(
    censusManifest,
    censusPublicCatalog,
    censusInventory
  );
  const result = makeResult(helperResult, censusManifest, censusManifestSha256);
  assert.throws(
    () =>
      validateAlternateIdentityBindingResult(
        result,
        `sha256-${"0".repeat(64)}.json`,
        helperResult,
        censusManifest,
        censusPublicCatalog,
        censusInventory
      ),
    /ALTERNATE_IDENTITY_RESULT_BINDING_MISMATCH/
  );
});

test("a tampered census_manifest_sha256 is refused", async () => {
  const { helperResult, censusManifest, censusPublicCatalog, censusInventory } = await loadRealMaterial();
  const result = makeResult(helperResult, censusManifest, `sha256:${"0".repeat(64)}`);
  assert.throws(
    () =>
      validateAlternateIdentityBindingResult(
        result,
        HELPER_RESULT_VERSION,
        helperResult,
        censusManifest,
        censusPublicCatalog,
        censusInventory
      ),
    /ALTERNATE_IDENTITY_RESULT_BINDING_MISMATCH/
  );
});

test("an entry whose evidence no longer matches the curated table is refused", async () => {
  const { helperResult, censusManifest, censusPublicCatalog, censusInventory } = await loadRealMaterial();
  const censusManifestSha256 = validateAlternateIdentityBindingResultInputHash(
    censusManifest,
    censusPublicCatalog,
    censusInventory
  );
  const result = structuredClone(makeResult(helperResult, censusManifest, censusManifestSha256));
  (result.entries[0] as { evidence: { constant_name: string } }).evidence.constant_name = "SOMETHING_ELSE";
  assert.throws(
    () =>
      validateAlternateIdentityBindingResult(
        result,
        HELPER_RESULT_VERSION,
        helperResult,
        censusManifest,
        censusPublicCatalog,
        censusInventory
      ),
    /ALTERNATE_IDENTITY_RESULT_ENTRY_INVALID/
  );
});

test("a stored ai_name that no longer matches what the cited v6 evidence proves is refused, not silently accepted (round-1 critic-code BLOCK)", async () => {
  const { helperResult, censusManifest, censusPublicCatalog, censusInventory } = await loadRealMaterial();
  const censusManifestSha256 = validateAlternateIdentityBindingResultInputHash(
    censusManifest,
    censusPublicCatalog,
    censusInventory
  );
  const result = structuredClone(makeResult(helperResult, censusManifest, censusManifestSha256));
  // Evidence fields (module/source/constant name) are untouched — only the
  // stored ai_name is fabricated. Without re-deriving from helperResult,
  // this looks exactly like a legitimately archived result.
  (result.entries[0] as { ai_name: string }).ai_name = "fabricated-name";
  assert.throws(
    () =>
      validateAlternateIdentityBindingResult(
        result,
        HELPER_RESULT_VERSION,
        helperResult,
        censusManifest,
        censusPublicCatalog,
        censusInventory
      ),
    /ALTERNATE_IDENTITY_RESULT_EVIDENCE_DRIFT/
  );
});

function validateAlternateIdentityBindingResultInputHash(
  censusManifest: NormalizedSettingsParserCensusManifest,
  censusPublicCatalog: SyntxPublicCatalogSnapshot,
  censusInventory: ReturnType<typeof loadSettingsSourceInventory>
): string {
  const text = serializeNormalizedSettingsParserCensusManifest(censusManifest, censusPublicCatalog, censusInventory);
  return `sha256:${createSha256(Buffer.from(text))}`;
}

function createSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
