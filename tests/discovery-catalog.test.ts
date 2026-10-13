import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../src/errors.js";
import {
  DiscoveryCatalogRepository,
  type DiscoverySearchInput,
  type DiscoverySearchItem
} from "../src/catalog/discovery-catalog.js";
import {
  buildSyntxPublicCatalogSnapshot,
  loadSyntxPublicCatalogSnapshot,
  type SyntxPublicCatalogSnapshot
} from "../src/catalog/syntx-public-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";

test("paginates every active discoverable identity without gaps or duplicates", () => {
  const snapshot = loadSyntxPublicCatalogSnapshot();
  const repository = new DiscoveryCatalogRepository(snapshot);
  const collected = collectAll(repository, { limit: 37 });
  const publicModelIds = new Set(snapshot.models.map((model) => model.value));
  const aiByName = new Map(snapshot.ai.map((ai) => [ai.value, ai] as const));
  const expected = [
    ...snapshot.models
      .filter((model) => model.active)
      .map((model) => model.value),
    ...snapshot.llm_models
      .filter((llm) =>
        !publicModelIds.has(llm.id) &&
        llm.enabled &&
        aiByName.get(llm.ai_name)?.active === true
      )
      .map((llm) => llm.id)
  ].sort(compareCodeUnits);

  assert.ok(expected.length > 50);
  assert.ok(collected.pageCount > 2);
  assert.equal(collected.total, expected.length);
  assert.equal(new Set(collected.items.map((item) => item.id)).size, expected.length);
  assert.deepEqual(
    collected.items.map((item) => item.id),
    expected
  );
  assert.equal(collected.items.every((item) => item.active), true);
});

test("include_inactive exposes every stable public variant id", () => {
  const snapshot = loadSyntxPublicCatalogSnapshot();
  const repository = new DiscoveryCatalogRepository(snapshot);
  const collected = collectAll(repository, {
    include_inactive: true,
    limit: 100
  });
  const expected = [
    ...new Set([
      ...snapshot.models.map((model) => model.value),
      ...snapshot.llm_models.map((model) => model.id)
    ])
  ].sort(compareCodeUnits);

  assert.equal(snapshot.models.length, 192);
  assert.equal(collected.total, expected.length);
  assert.equal(collected.items.length, expected.length);
  assert.equal(
    new Set(collected.items.map((item) => item.id)).size,
    expected.length
  );
  assert.deepEqual(
    collected.items.map((item) => item.id),
    expected
  );
  assert.equal(collected.items.some((item) => !item.active), true);
});

test("discovery includes all enabled LLM identities without activating inactive public rows", () => {
  const snapshot = loadPublicCatalogVersion(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
  const repository = new DiscoveryCatalogRepository(snapshot);
  const collected = collectAll(repository, {
    include_inactive: true,
    limit: 100
  });
  const expectedLlmIds = snapshot.llm_models
    .map((model) => model.id)
    .sort(compareCodeUnits);
  const expectedDiscoveryIds = [
    ...new Set([
      ...snapshot.models.map((model) => model.value),
      ...expectedLlmIds
    ])
  ].sort(compareCodeUnits);
  const inactiveConflicts = ["gemini-3.7-flash", "grok-4.6"];
  const llmOnlyIds = [
    "claude-haiku-5-5",
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "gpt-6.1-sol",
    "grok-4.7"
  ];

  assert.equal(snapshot.llm_models.length, 44);
  assert.equal(snapshot.models.length, 200);
  assert.equal(snapshot.models.filter((model) => model.active).length, 167);
  assert.equal(snapshot.models.filter((model) => !model.active).length, 33);
  const publicModelsById = new Map(
    snapshot.models.map((model) => [model.value, model] as const)
  );
  assert.equal(
    snapshot.llm_models.filter(
      (llm) => publicModelsById.get(llm.id)?.active === true
    ).length,
    37
  );
  assert.equal(
    snapshot.llm_models.filter(
      (llm) =>
        publicModelsById.has(llm.id) &&
        publicModelsById.get(llm.id)?.active === false
    ).length,
    2
  );
  assert.equal(
    snapshot.llm_models.filter((llm) => !publicModelsById.has(llm.id)).length,
    5
  );
  assert.equal(collected.total, 205);
  assert.equal(new Set(collected.items.map((item) => item.id)).size, 205);
  assert.deepEqual(collected.items.map((item) => item.id), expectedDiscoveryIds);
  assert.equal(expectedLlmIds.length, 44);
  const active = collectAll(repository, { limit: 100 });
  assert.equal(active.total, 172);
  assert.equal(active.items.every((item) => item.active), true);

  for (const llm of snapshot.llm_models) {
    const record = repository.get(llm.id);
    assert.deepEqual(record.llm_enrichment, llm);
    const search = repository.search({
      query: llm.id,
      include_inactive: true,
      limit: 100
    });
    assert.ok(search.items.some((item) => item.id === llm.id));
  }
  for (const id of inactiveConflicts) {
    assert.equal(repository.get(id).active, false);
    assert.ok(repository.get(id).llm_enrichment?.enabled);
  }
  for (const id of llmOnlyIds) {
    const record = repository.get(id);
    assert.equal(record.active, true);
    assert.equal(record.default, false);
    assert.equal(record.scope, "text");
    assert.deepEqual(record.modalities, ["text"]);
    assert.deepEqual(
      record.operations.map((operation) => operation.id),
      ["generate-text"]
    );
    assert.equal(record.llm_enrichment?.id, id);
  }
  const geminiConflict = repository.search({ query: "gemini-3.7-flash", limit: 100 });
  assert.equal(geminiConflict.items.some((item) => item.id === "gemini-3.7-flash"), false);
});

test("an LLM-only record without an exact AI binding gets no family scope or operation", () => {
  const snapshot = loadPublicCatalogVersion(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
  const llmOnly = snapshot.llm_models.find((model) => model.id === "gpt-6.1-sol");
  assert.ok(llmOnly);
  const withoutBinding = buildSyntxPublicCatalogSnapshot({
    aiPayload: snapshot.ai.filter((ai) => ai.value !== llmOnly.ai_name),
    llmModelsPayload: {
      count: snapshot.llm_models.length,
      models: snapshot.llm_models
    },
    modelsPayload: snapshot.models,
    fetchedAt: snapshot.fetched_at
  });
  const repository = new DiscoveryCatalogRepository(withoutBinding);
  const record = repository.get(llmOnly.id);

  assert.equal(record.active, false);
  assert.equal(record.ai_name, llmOnly.ai_name);
  assert.equal(record.scope, null);
  assert.deepEqual(record.modalities, []);
  assert.deepEqual(record.operations, []);
  assert.equal(
    repository.search({ include_inactive: true, query: llmOnly.id }).items[0]?.id,
    llmOnly.id
  );
});

test("cursor is bound to filters, offset, version, and snapshot hashes", () => {
  const snapshot = loadSyntxPublicCatalogSnapshot();
  const repository = new DiscoveryCatalogRepository(snapshot);
  const firstPage = repository.search({ include_inactive: true, limit: 10 });
  assert.ok(firstPage.next_cursor);

  assertInvalidSearch(() =>
    repository.search({
      include_inactive: true,
      limit: 11,
      cursor: firstPage.next_cursor ?? undefined
    })
  );
  assertInvalidSearch(() =>
    repository.search({
      include_inactive: false,
      limit: 10,
      cursor: firstPage.next_cursor ?? undefined
    })
  );
  assertInvalidSearch(() =>
    repository.search({
      include_inactive: true,
      limit: 10,
      modality: "video",
      cursor: firstPage.next_cursor ?? undefined
    })
  );

  const tamperedOffset = mutateCursor(firstPage.next_cursor, (payload) => {
    payload.offset = Number(payload.offset) + 1;
  });
  assertInvalidSearch(() =>
    repository.search({
      include_inactive: true,
      limit: 10,
      cursor: tamperedOffset
    })
  );

  const changedVersion = mutateCursor(firstPage.next_cursor, (payload) => {
    payload.version = 2;
  });
  assertInvalidSearch(() =>
    repository.search({
      include_inactive: true,
      limit: 10,
      cursor: changedVersion
    })
  );

  assertInvalidSearch(() =>
    repository.search({
      include_inactive: true,
      limit: 10,
      cursor: "a".repeat(1_025)
    })
  );

  const changedModels = structuredClone(snapshot.models);
  const changedModel = changedModels[0];
  assert.ok(changedModel);
  changedModel.label = `${changedModel.label} updated`;
  const changedSnapshot = buildSyntxPublicCatalogSnapshot({
    aiPayload: snapshot.ai,
    llmModelsPayload: {
      count: snapshot.llm_models.length,
      models: snapshot.llm_models
    },
    modelsPayload: changedModels,
    fetchedAt: snapshot.fetched_at
  });
  const changedRepository = new DiscoveryCatalogRepository(changedSnapshot);
  assertInvalidSearch(() =>
    changedRepository.search({
      include_inactive: true,
      limit: 10,
      cursor: firstPage.next_cursor ?? undefined
    })
  );
});

test("get preserves public settings and adds only matching public LLM enrichment", () => {
  const snapshot = loadSyntxPublicCatalogSnapshot();
  const repository = new DiscoveryCatalogRepository(snapshot);
  const publicTopaz = snapshot.models.find(
    (model) => model.value === "topaz_enhance"
  );
  assert.ok(publicTopaz);

  const topaz = repository.get("topaz_enhance");
  assert.equal(topaz.id, "topaz_enhance");
  assert.equal(topaz.upstream_id, "topaz_enhance");
  assert.equal(topaz.catalog_kind, "OFFICIAL_PUBLIC_API_SNAPSHOT");
  assert.equal(topaz.runtime_usable, false);
  assert.equal(topaz.scope, "tool_video_upscaler");
  assert.deepEqual(topaz.modalities, ["video"]);
  assert.deepEqual(
    topaz.operations.map((operation) => operation.id),
    ["upscale-video"]
  );
  assert.deepEqual(topaz.features, publicTopaz.features);
  assert.deepEqual(topaz.settings, publicTopaz.settings);
  assert.equal(topaz.llm_enrichment, null);
  assert.equal(topaz.fetched_at, snapshot.fetched_at);
  assert.deepEqual(topaz.source_hashes, {
    ai: snapshot.sources.ai.canonical_sha256,
    llm_models: snapshot.sources.llm_models.canonical_sha256,
    models: snapshot.sources.models.canonical_sha256
  });
  assert.equal("parameters_schema" in topaz, false);
  assert.equal(
    topaz.operations.some((operation) => "parameters_schema" in operation),
    false
  );

  const llm = repository.get("glm-5.2");
  assert.equal(llm.llm_enrichment?.id, "glm-5.2");
  assert.equal(llm.llm_enrichment?.ai_name, llm.ai_name);

  const inactiveOrphan = repository.get("kling-kolors");
  assert.equal(inactiveOrphan.active, false);
  assert.equal(inactiveOrphan.scope, null);
  assert.deepEqual(inactiveOrphan.modalities, []);
  assert.deepEqual(inactiveOrphan.operations, []);
});

test("scope projection is exact and unknown scope stays non-runtime", () => {
  const expected = new Map<string, { operation: string; modality: string }>([
    ["text", { operation: "generate-text", modality: "text" }],
    ["image", { operation: "generate-image", modality: "image" }],
    ["video", { operation: "generate-video", modality: "video" }],
    ["audio", { operation: "generate-audio", modality: "audio" }],
    ["tool_image_inpaint", { operation: "inpaint-image", modality: "image" }],
    ["tool_image_upscaler", { operation: "upscale-image", modality: "image" }],
    ["tool_video_inpaint", { operation: "inpaint-video", modality: "video" }],
    ["tool_video_upscaler", { operation: "upscale-video", modality: "video" }]
  ]);
  const base = loadSyntxPublicCatalogSnapshot();
  const model = base.models.find((candidate) =>
    base.ai.some((ai) => ai.value === candidate.ai_name)
  );
  assert.ok(model);

  for (const [scope, profile] of expected) {
    const repository = repositoryWithScope(base, model.ai_name, scope);
    const projected = repository.get(model.value);
    assert.equal(projected.scope, scope);
    assert.deepEqual(projected.modalities, [profile.modality]);
    assert.deepEqual(
      projected.operations.map((operation) => operation.id),
      [profile.operation]
    );
    assert.equal(projected.runtime_usable, false);
  }

  const futureRepository = repositoryWithScope(
    base,
    model.ai_name,
    "future_public_scope"
  );
  const future = futureRepository.get(model.value);
  assert.equal(future.scope, "future_public_scope");
  assert.deepEqual(future.modalities, []);
  assert.deepEqual(future.operations, []);
  assert.equal(future.runtime_usable, false);
});

test("search filters exact operation and unknown get returns a fixed safe error", () => {
  const repository = new DiscoveryCatalogRepository();
  const result = repository.search({
    operation: "upscale-video",
    include_inactive: true,
    limit: 100
  });
  assert.ok(result.total > 0);
  assert.equal(
    result.items.every((item) =>
      item.operations.some((operation) => operation.id === "upscale-video")
    ),
    true
  );

  const missingId = "not-a-real-public-model";
  assert.throws(
    () => repository.get(missingId),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationError);
      assert.equal(error.code, "MODEL_NOT_FOUND");
      assert.equal(error.message.includes(missingId), false);
      assert.equal(
        error.message,
        "The requested public catalog model was not found."
      );
      return true;
    }
  );
});

function collectAll(
  repository: DiscoveryCatalogRepository,
  baseInput: Omit<DiscoverySearchInput, "cursor">
): { total: number; items: DiscoverySearchItem[]; pageCount: number } {
  const items: DiscoverySearchItem[] = [];
  let cursor: string | null = null;
  let expectedTotal: number | undefined;
  let pageCount = 0;

  do {
    const page = repository.search(
      cursor === null ? baseInput : { ...baseInput, cursor }
    );
    expectedTotal ??= page.total;
    assert.equal(page.total, expectedTotal);
    items.push(...page.items);
    cursor = page.next_cursor;
    pageCount += 1;
    assert.ok(pageCount < 100, "pagination must terminate");
  } while (cursor !== null);

  return { total: expectedTotal ?? 0, items, pageCount };
}

function mutateCursor(
  cursor: string | null,
  mutate: (payload: Record<string, unknown>) => void
): string {
  assert.ok(cursor);
  const payload = JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8")
  ) as Record<string, unknown>;
  mutate(payload);
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function assertInvalidSearch(operation: () => unknown): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.code, "INVALID_PARAMETERS");
    assert.equal(
      error.message,
      "The discovery catalog search input or cursor is invalid."
    );
    return true;
  });
}

function repositoryWithScope(
  base: SyntxPublicCatalogSnapshot,
  aiName: string,
  scope: string
): DiscoveryCatalogRepository {
  const aiPayload = structuredClone(base.ai);
  const ai = aiPayload.find((entry) => entry.value === aiName);
  assert.ok(ai);
  ai.scope = scope;
  const snapshot = buildSyntxPublicCatalogSnapshot({
    aiPayload,
    llmModelsPayload: {
      count: base.llm_models.length,
      models: base.llm_models
    },
    modelsPayload: base.models,
    fetchedAt: base.fetched_at
  });
  return new DiscoveryCatalogRepository(snapshot);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
