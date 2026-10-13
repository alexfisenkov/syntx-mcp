import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSyntxPublicCatalogSnapshot,
  findForbiddenPublicCatalogKeyPaths,
  loadSyntxPublicCatalogSnapshot,
  serializeSyntxPublicCatalogSnapshot,
  sha256CanonicalPayload,
  summarizePublicCatalog,
  syntxPublicAiEndpointSchema,
  syntxPublicCatalogSnapshotSchema,
  syntxPublicLlmModelsEndpointSchema,
  syntxPublicModelsEndpointSchema,
  SYNTX_PUBLIC_CATALOG_ENDPOINTS
} from "../src/catalog/syntx-public-catalog.js";

test("official public API snapshot totals match its allowlisted records", () => {
  const snapshot = loadSyntxPublicCatalogSnapshot();
  const expectedSummary = summarizePublicCatalog(
    snapshot.ai,
    snapshot.models,
    snapshot.llm_models
  );

  assert.equal(snapshot.catalog_kind, "OFFICIAL_PUBLIC_API_SNAPSHOT");
  assert.equal(snapshot.runtime_usable, false);
  assert.equal(snapshot.language, "ru");
  assert.ok(snapshot.summary.ai_total > 0);
  assert.ok(snapshot.summary.llm_model_total > 0);
  assert.ok(snapshot.summary.model_total > 0);
  assert.deepEqual(snapshot.summary, expectedSummary);
  assert.equal(
    snapshot.summary.ai_active + snapshot.summary.ai_inactive,
    snapshot.summary.ai_total
  );
  assert.equal(
    snapshot.summary.model_active + snapshot.summary.model_inactive,
    snapshot.summary.model_total
  );
  assert.equal(
    snapshot.summary.llm_model_enabled + snapshot.summary.llm_model_disabled,
    snapshot.summary.llm_model_total
  );
  assert.equal(snapshot.sources.ai.url, SYNTX_PUBLIC_CATALOG_ENDPOINTS.ai);
  assert.equal(
    snapshot.sources.models.url,
    SYNTX_PUBLIC_CATALOG_ENDPOINTS.models
  );
  assert.equal(
    snapshot.sources.llm_models.url,
    SYNTX_PUBLIC_CATALOG_ENDPOINTS.llm_models
  );
  assert.equal(
    snapshot.sources.ai.canonical_sha256,
    sha256CanonicalPayload(snapshot.ai)
  );
  assert.equal(
    snapshot.sources.models.canonical_sha256,
    sha256CanonicalPayload(snapshot.models)
  );
  assert.equal(
    snapshot.sources.llm_models.canonical_sha256,
    sha256CanonicalPayload({
      count: snapshot.llm_models.length,
      models: snapshot.llm_models
    })
  );
  assert.deepEqual(Object.values(SYNTX_PUBLIC_CATALOG_ENDPOINTS), [
    "https://api.syntx.ai/api/v1/ai?lang=ru",
    "https://api.syntx.ai/api/v1/llm/models?lang=ru",
    "https://api.syntx.ai/api/v1/ai/models?lang=ru"
  ]);
  assert.equal(
    Object.values(SYNTX_PUBLIC_CATALOG_ENDPOINTS).some((url) =>
      url.includes("/settings")
    ),
    false
  );
});

test("official public API snapshot preserves identifier and relationship invariants", () => {
  const snapshot = loadSyntxPublicCatalogSnapshot();
  const aiValues = snapshot.ai.map((entry) => entry.value);
  const modelValues = snapshot.models.map((entry) => entry.value);
  const llmModelIds = snapshot.llm_models.map((entry) => entry.id);
  const modelAiNames = new Set(snapshot.models.map((entry) => entry.ai_name));
  const aiValueSet = new Set(aiValues);

  assert.equal(new Set(aiValues).size, aiValues.length);
  assert.equal(new Set(modelValues).size, modelValues.length);
  assert.equal(new Set(llmModelIds).size, llmModelIds.length);
  assert.equal(modelAiNames.size, snapshot.summary.unique_model_ai_names);
  assert.equal(
    [...modelAiNames].filter((aiName) => !aiValueSet.has(aiName)).length,
    snapshot.summary.model_ai_names_without_ai
  );
});

test("official public API snapshot contains no forbidden sensitive keys", () => {
  const snapshot = loadSyntxPublicCatalogSnapshot();
  assert.deepEqual(findForbiddenPublicCatalogKeyPaths(snapshot), []);

  const poisoned = structuredClone(snapshot) as unknown as {
    ai: Array<Record<string, unknown>>;
  };
  const firstAi = poisoned.ai[0];
  assert.ok(firstAi);
  firstAi.client_ip = "198.51.100.1";
  assert.equal(syntxPublicCatalogSnapshotSchema.safeParse(poisoned).success, false);
});

test("raw endpoint validators fail closed on unknown and sensitive fields", () => {
  const validAi = [
    {
      active: true,
      description: null,
      label: "Example AI",
      scope: "example",
      value: "example"
    }
  ];
  const validModels = [
    {
      active: true,
      ai_name: "example",
      default: true,
      description: null,
      features: null,
      label: "Example model",
      settings: {
        file_count_limit: { images: 2, videos: 1, documents: 3 },
        max_file_size: { images: 8_000_000, videos: 20_000_000, documents: 1_000_000 },
        image_resize_limit: 4096,
        max_total_file_size: 30_000_000,
        max_image_dimension: 8192,
        max_image_file_size: 8_000_000,
        max_image_pixel_count: 33_554_432,
        min_image_pixel_count: 1,
        models: {
          Public: {
            example_v1: "Example v1"
          }
        }
      },
      type: null,
      value: "example-v1"
    }
  ];
  const validLlmModels = {
    count: 1,
    models: [
      {
        ai_name: "example",
        available_subscriptions: ["pro"],
        capabilities: {
          deep_research: false,
          files: true,
          images: false,
          planning: false,
          streaming: true,
          system_message: true,
          thinking: false,
          web_explorer: false
        },
        context_window: 128_000,
        default_max_tokens: 8_192,
        description: null,
        enabled: true,
        free_from_sub: null,
        icon: null,
        id: "example-llm",
        is_free: false,
        label: "Example LLM",
        max_images_count: 0,
        min_subscription: "pro",
        performance_level: 1,
        supported_tools: ["search_web"]
      }
    ]
  };

  assert.equal(syntxPublicAiEndpointSchema.safeParse(validAi).success, true);
  assert.equal(syntxPublicModelsEndpointSchema.safeParse(validModels).success, true);
  assert.equal(
    syntxPublicLlmModelsEndpointSchema.safeParse(validLlmModels).success,
    true
  );

  const unknownField = structuredClone(validAi) as Array<Record<string, unknown>>;
  const unknownAi = unknownField[0];
  assert.ok(unknownAi);
  unknownAi.new_public_field = true;
  assert.equal(syntxPublicAiEndpointSchema.safeParse(unknownField).success, false);

  for (const forbiddenKey of [
    "access_token",
    "api_key",
    "authorization_header",
    "credentials",
    "x_api_key"
  ]) {
    const sensitiveNestedKey = structuredClone(validModels) as unknown as Array<{
      settings: { models: Record<string, Record<string, string>> };
    }>;
    const firstModel = sensitiveNestedKey[0];
    assert.ok(firstModel);
    firstModel.settings.models.Public = { [forbiddenKey]: "x" };
    assert.equal(
      syntxPublicModelsEndpointSchema.safeParse(sensitiveNestedKey).success,
      false,
      `${forbiddenKey} must be rejected inside a dynamic map`
    );
  }

  const invalidLlmCount = structuredClone(validLlmModels);
  invalidLlmCount.count = 2;
  assert.equal(
    syntxPublicLlmModelsEndpointSchema.safeParse(invalidLlmCount).success,
    false
  );

  const sensitiveLlm = structuredClone(validLlmModels) as unknown as {
    models: Array<Record<string, unknown>>;
  };
  const firstLlm = sensitiveLlm.models[0];
  assert.ok(firstLlm);
  firstLlm.refresh_token = "x";
  assert.equal(
    syntxPublicLlmModelsEndpointSchema.safeParse(sensitiveLlm).success,
    false
  );
});

test("snapshot serialization round-trips through the strict schema", () => {
  const snapshot = loadSyntxPublicCatalogSnapshot();
  const serialized = serializeSyntxPublicCatalogSnapshot(snapshot);
  const reparsed: unknown = JSON.parse(serialized);

  assert.deepEqual(syntxPublicCatalogSnapshotSchema.parse(reparsed), snapshot);

  const rebuilt = buildSyntxPublicCatalogSnapshot({
    aiPayload: snapshot.ai,
    llmModelsPayload: {
      count: snapshot.llm_models.length,
      models: snapshot.llm_models
    },
    modelsPayload: snapshot.models,
    fetchedAt: snapshot.fetched_at
  });
  assert.deepEqual(rebuilt, snapshot);
});
