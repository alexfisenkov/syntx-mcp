import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CatalogRepository,
  loadCatalog,
  modelCatalogSchema
} from "../src/catalog/catalog.js";

test("loads the versioned PARTIAL public sample catalog and verifies hashes", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.schema_version, "1.0.0");
  assert.equal(catalog.catalog_version, "2026-09-02.public-sample.1");
  assert.equal(catalog.catalog_kind, "PUBLIC_SAMPLE");
  assert.equal(catalog.runtime_usable, false);
  assert.equal(catalog.coverage_status, "PARTIAL");
  assert.deepEqual(
    catalog.models.map((model) => model.id),
    ["veo-omni-flash", "nano-banana-pro", "suno"]
  );

  for (const model of catalog.models) {
    assert.equal(model.coverage_status, "PARTIAL");
    assert.equal(model.upstream_id, null);
    assert.equal(model.upstream_id_status, "UNKNOWN");
    assert.equal(model.source.coverage_status, "PARTIAL");
    assert.equal(model.source.checked_at, "2026-09-02");
    assert.doesNotThrow(() => new URL(model.source.url));
    for (const operation of model.operations) {
      assert.equal(operation.runtime_status, "UNVERIFIED");
      assert.equal(operation.runtime_provenance_status, "UNKNOWN");
      assert.equal(operation.cost_status, "UNKNOWN");
      assert.equal(operation.plan_status, "UNKNOWN");
      assert.equal(
        operation.parameters_schema_profile,
        "PUBLIC_SAMPLE_STRING_ONLY"
      );
    }
  }
});

test("searches catalog by text, modality, and exact operation", () => {
  const repository = new CatalogRepository(loadCatalog());
  assert.deepEqual(
    repository.search({ query: "veo flash", limit: 20 }).models.map((model) =>
      model.id
    ),
    ["veo-omni-flash"]
  );
  assert.deepEqual(
    repository.search({ modality: "audio", limit: 20 }).models.map(
      (model) => model.id
    ),
    ["suno"]
  );
  assert.deepEqual(
    repository.search({ operation: "text-to-image", limit: 20 }).models.map(
      (model) => model.id
    ),
    ["nano-banana-pro"]
  );
});

test("sample schemas expose only settings supported by cited public docs", () => {
  const repository = new CatalogRepository(loadCatalog());
  assert.deepEqual(
    Object.keys(
      repository.getOperation("nano-banana-pro", "text-to-image")
        .parameters_schema.properties
    ),
    ["prompt"]
  );
  assert.deepEqual(
    repository.getOperation("veo-omni-flash", "text-to-video")
      .parameters_schema.properties.quality?.enum,
    ["720p", "1080p", "4K"]
  );
  assert.deepEqual(
    repository.getOperation("suno", "standard-text-to-music")
      .parameters_schema.properties.model_version?.enum,
    ["V3.5", "V4.0", "V4.5", "V4.5+", "V5", "V5.5"]
  );
});

test("rejects catalog drift when a schema changes without a new hash", () => {
  const raw = JSON.parse(
    readFileSync("catalog/v1/public-samples.json", "utf8")
  ) as Record<string, unknown>;
  const changed = structuredClone(raw) as {
    models: Array<{
      operations: Array<{
        parameters_schema: { properties: Record<string, unknown> };
      }>;
    }>;
  };
  const firstOperation = changed.models[0]?.operations[0];
  assert.ok(firstOperation);
  firstOperation.parameters_schema.properties.unverified = {
    type: "string",
    description: "Unverified"
  };

  const parsed = modelCatalogSchema.safeParse(changed);
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.match(parsed.error.message, /Schema hash mismatch/);
  }
});
