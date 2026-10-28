import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSyntxPublicCatalogSnapshot,
  serializeSyntxPublicCatalogSnapshot,
  syntxPublicLlmModelsEndpointSchema,
  syntxPublicModelsEndpointSchema
} from "../src/catalog/syntx-public-catalog.js";

const aiPayload = [
  {
    active: true,
    description: null,
    label: "Synthetic video",
    scope: "video",
    value: "synthetic-video"
  }
];

const llmRow = (id: string, defaults?: boolean) => ({
  ai_name: "synthetic-text",
  available_subscriptions: ["free"],
  capabilities: {
    deep_research: false,
    files: false,
    images: false,
    planning: false,
    streaming: false,
    system_message: false,
    thinking: false,
    web_explorer: false
  },
  context_window: 8_192,
  default_max_tokens: 1_024,
  description: null,
  enabled: true,
  free_from_sub: null,
  icon: null,
  id,
  is_free: true,
  label: id,
  max_images_count: 0,
  min_subscription: null,
  performance_level: 1,
  supported_tools: [],
  ...(defaults === undefined ? {} : { default: defaults })
});

const llmPayload = (models: unknown[]) => ({ count: models.length, models });

const videoModel = (settings: unknown) => ({
  active: true,
  ai_name: "synthetic-video",
  default: false,
  description: null,
  features: null,
  label: "Synthetic video model",
  settings,
  type: null,
  value: "banana-2.1"
});

test("builder and serializer preserve the added public settings and both LLM default values", () => {
  const models = [
    videoModel({ max_total_file_size_by_type: { videos: 26_214_400 } })
  ];
  const llmModels = [llmRow("llm-default-off", false), llmRow("llm-default-on", true), llmRow("llm-legacy")];

  const snapshot = buildSyntxPublicCatalogSnapshot({
    aiPayload,
    llmModelsPayload: llmPayload(llmModels),
    modelsPayload: models,
    fetchedAt: "2026-10-28T00:00:00.000Z"
  });
  const serialized = JSON.parse(serializeSyntxPublicCatalogSnapshot(snapshot)) as {
    models: Array<{ settings: Record<string, unknown> | null }>;
    llm_models: Array<Record<string, unknown>>;
  };

  assert.deepEqual(serialized.models[0]?.settings?.max_total_file_size_by_type, {
    videos: 26_214_400
  });
  assert.equal(serialized.llm_models[0]?.default, false);
  assert.equal(serialized.llm_models[1]?.default, true);
  assert.equal(Object.hasOwn(serialized.llm_models[2] ?? {}, "default"), false);
});

test("strict public settings validate only nonnegative supported media size limits", () => {
  for (const limit of ["26214400", -1, 1.5]) {
    assert.equal(
      syntxPublicModelsEndpointSchema.safeParse([
        videoModel({ max_total_file_size_by_type: { videos: limit } })
      ]).success,
      false
    );
  }

  assert.equal(
    syntxPublicModelsEndpointSchema.safeParse([
      videoModel({ max_total_file_size_by_type: { first_frame: 26_214_400 } })
    ]).success,
    false
  );
  assert.equal(
    syntxPublicModelsEndpointSchema.safeParse([
      videoModel({ max_total_file_size_by_type: { videos: 26_214_400, future_media: 1 } })
    ]).success,
    false
  );
  assert.equal(
    syntxPublicModelsEndpointSchema.safeParse([
      videoModel({ max_total_file_size_by_type: { videos: 26_214_400 }, future_setting: true })
    ]).success,
    false
  );
});

test("strict LLM entries accept optional boolean default while retaining unknown-key rejection", () => {
  assert.equal(syntxPublicLlmModelsEndpointSchema.safeParse(llmPayload([llmRow("legacy")])).success, true);
  assert.equal(syntxPublicLlmModelsEndpointSchema.safeParse(llmPayload([llmRow("off", false)])).success, true);
  assert.equal(syntxPublicLlmModelsEndpointSchema.safeParse(llmPayload([llmRow("on", true)])).success, true);

  assert.equal(
    syntxPublicLlmModelsEndpointSchema.safeParse(llmPayload([{ ...llmRow("bad-type"), default: "false" }])).success,
    false
  );
  assert.equal(
    syntxPublicLlmModelsEndpointSchema.safeParse(llmPayload([{ ...llmRow("unknown"), new_flag: true }])).success,
    false
  );
});
