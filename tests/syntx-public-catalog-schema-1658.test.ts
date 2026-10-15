import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  buildSyntxPublicCatalogSnapshot,
  findForbiddenPublicCatalogKeyPaths,
  serializeSyntxPublicCatalogSnapshot,
  syntxPublicModelsEndpointSchema
} from "../src/catalog/syntx-public-catalog.js";

const B066_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const catalogDirectory = resolve(process.cwd(), "catalog");
const historical = loadPublicCatalogVersion(B066_VERSION, catalogDirectory);

function modelsWithSettings(fields: Record<string, unknown>): unknown[] {
  const models: unknown[] = structuredClone(historical.models);
  const firstModel = models[0] as { settings: Record<string, unknown> | null } | undefined;
  assert.ok(firstModel);
  firstModel.settings = { ...(firstModel.settings ?? {}), ...fields };
  return models;
}

function snapshotWithModels(modelsPayload: unknown) {
  return buildSyntxPublicCatalogSnapshot({
    aiPayload: historical.ai,
    llmModelsPayload: { count: historical.llm_models.length, models: historical.llm_models },
    modelsPayload,
    fetchedAt: historical.fetched_at
  });
}

test("optional public settings metadata survives strict snapshot serialization without changing B066", () => {
  const modelDescriptions = {
    en: "A short public description.",
    ru: "Короткое публичное описание."
  };
  const snapshot = snapshotWithModels(modelsWithSettings({
    default_model: "example-model-v2",
    model_descriptions: modelDescriptions
  }));
  const parsed = JSON.parse(serializeSyntxPublicCatalogSnapshot(snapshot)) as {
    models: Array<{ settings: Record<string, unknown> | null }>;
  };

  assert.equal(parsed.models[0]?.settings?.default_model, "example-model-v2");
  assert.deepEqual(parsed.models[0]?.settings?.model_descriptions, modelDescriptions);

  const historicalBytes = serializeSyntxPublicCatalogSnapshot(historical);
  const historicalVersion = `sha256-${createHash("sha256").update(historicalBytes).digest("hex")}.json`;
  assert.equal(historicalVersion, B066_VERSION);
});

test("new public settings fields reject wrong types and exceedance of local bounds", () => {
  const oversizedDescriptions = Object.fromEntries(
    Array.from({ length: 201 }, (_, index) => [`model_${index}`, "Description"])
  );
  const invalidSettings = [
    { default_model: 42 },
    { default_model: "model name with spaces" },
    { model_descriptions: [] },
    { model_descriptions: { en: 42 } },
    { model_descriptions: { en: "x".repeat(20_001) } },
    { model_descriptions: oversizedDescriptions }
  ];

  for (const fields of invalidSettings) {
    assert.equal(syntxPublicModelsEndpointSchema.safeParse(modelsWithSettings(fields)).success, false);
  }
});

test("strict settings reject an unobserved third field and nested forbidden credentials", () => {
  assert.equal(
    syntxPublicModelsEndpointSchema.safeParse(modelsWithSettings({ unobserved_field_1658: true })).success,
    false
  );

  const poisoned = modelsWithSettings({ model_descriptions: { api_key: "must-not-pass" } });
  assert.equal(syntxPublicModelsEndpointSchema.safeParse(poisoned).success, false);
  assert.ok(findForbiddenPublicCatalogKeyPaths(poisoned).some((path) => path.endsWith(".model_descriptions.api_key")));
});
