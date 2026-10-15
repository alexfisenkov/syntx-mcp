import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  buildSyntxPublicCatalogSnapshot,
  serializeSyntxPublicCatalogSnapshot,
  syntxPublicModelsEndpointSchema
} from "../src/catalog/syntx-public-catalog.js";

const C396_VERSION = "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json";
const CATALOG_DIR = resolve(process.cwd(), "catalog");
const C396 = loadPublicCatalogVersion(C396_VERSION, CATALOG_DIR);

function modelsWithSettings(fields: Record<string, unknown>): unknown[] {
  const models: unknown[] = structuredClone(C396.models);
  const first = models[0] as { settings: Record<string, unknown> | null } | undefined;
  assert.ok(first);
  first.settings = { ...(first.settings ?? {}), ...fields };
  return models;
}

function snapshotWithModels(modelsPayload: unknown) {
  return buildSyntxPublicCatalogSnapshot({
    aiPayload: C396.ai,
    llmModelsPayload: { count: C396.llm_models.length, models: C396.llm_models },
    modelsPayload,
    fetchedAt: C396.fetched_at
  });
}

test("C396 seed bounds are optional finite numeric metadata and survive snapshot round-trip", () => {
  const models = modelsWithSettings({ max_seed: 0.5, min_seed: -1.25 });
  assert.equal(syntxPublicModelsEndpointSchema.safeParse(models).success, true);
  const snapshot = snapshotWithModels(models);
  const serialized = serializeSyntxPublicCatalogSnapshot(snapshot);
  const reparsed = JSON.parse(serialized) as { models: Array<{ settings: Record<string, unknown> | null }> };
  assert.equal(reparsed.models[0]?.settings?.max_seed, 0.5);
  assert.equal(reparsed.models[0]?.settings?.min_seed, -1.25);
});

test("legacy C396 rows without seed bounds remain valid and byte-identical", () => {
  assert.equal(syntxPublicModelsEndpointSchema.safeParse(C396.models).success, true);
  assert.equal(Object.hasOwn(C396.models[0]?.settings ?? {}, "max_seed"), false);
  assert.equal(Object.hasOwn(C396.models[0]?.settings ?? {}, "min_seed"), false);
  const serialized = serializeSyntxPublicCatalogSnapshot(C396);
  const version = `sha256-${createHash("sha256").update(serialized).digest("hex")}.json`;
  assert.equal(version, C396_VERSION);
});

test("seed bounds reject non-numbers and non-finite numbers without relaxing strict settings", () => {
  for (const field of ["max_seed", "min_seed"] as const) {
    for (const value of ["7", {}, null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(syntxPublicModelsEndpointSchema.safeParse(modelsWithSettings({ [field]: value })).success, false);
    }
  }
  assert.equal(syntxPublicModelsEndpointSchema.safeParse(modelsWithSettings({
    max_seed: 10.5, min_seed: -2.25, seed_bounds_extra: 1
  })).success, false);
});
