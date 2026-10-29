import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { archivePublicCatalogSnapshot } from "../src/catalog/public-catalog-history.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  buildSyntxPublicCatalogSnapshot,
  loadSyntxPublicCatalogSnapshot
} from "../src/catalog/syntx-public-catalog.js";
import { ApplicationError } from "../src/errors.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";

const MODEL_ID = "synthetic_catalog_variant_a";
const OTHER_MODEL_ID = "synthetic_catalog_variant_b";
const MODEL_LABEL = "Synthetic catalog selection A";
const UPSTREAM_UUID = "018f2f60-91c4-7c3d-8e52-0f7d0e21b581";
const FIXTURE = ["synthetic", "catalog", "selection", "credential"].join("-");

test("default discovery selects the immutable current public snapshot", () => {
  const previous = process.env.SYNTX_PUBLIC_CATALOG_VERSION;
  try {
    delete process.env.SYNTX_PUBLIC_CATALOG_VERSION;
    const selected = loadSelectedDiscoveryCatalog();
    const result = selected.discoveryCatalog.search({ include_inactive: true, limit: 100 });
    const second = selected.discoveryCatalog.search({ include_inactive: true, limit: 100, cursor: result.next_cursor! });
    const third = selected.discoveryCatalog.search({ include_inactive: true, limit: 100, cursor: second.next_cursor! });
    assert.equal(selected.discoveryCatalog.fetched_at, "2026-10-08T13:18:39.393Z");
    assert.equal(result.total, 205);
    assert.equal(result.items.length + second.items.length + third.items.length, 205);
    assert.equal([...result.items, ...second.items, ...third.items].filter((model) => model.active).length, 172);
    assert.equal(selected.runtimeCapabilities, null);
  } finally {
    restoreVersionEnvironment(previous);
  }
});

test("default MCP read catalog is current while owner-native catalog remains pinned", async () => {
  const previous = process.env.SYNTX_PUBLIC_CATALOG_VERSION;
  try {
    delete process.env.SYNTX_PUBLIC_CATALOG_VERSION;
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requests.push(input instanceof Request ? input.url : String(input));
      throw new Error("Catalog composition must not contact an upstream service.");
    };
    const runtime = createObservedOwnerRuntime({ fetchImpl });
    const app = runtime.application;
    const currentVersion = "2026-10-29T10:17:30.221Z.9ad757694b65";

    const kimi = app.searchModels({ query: "kimi-k3", include_inactive: true, limit: 10 });
    assert.equal(kimi.catalog_version, currentVersion);
    assert.deepEqual(kimi.models.map((model) => model.id), ["kimi-k3", "kimi-k3.1-pro"]);
    const terra = app.searchModels({ query: "gpt-6.1-terra", include_inactive: true, limit: 10 });
    assert.equal(terra.total, 1);
    assert.equal(terra.models[0]?.id, "gpt-6.1-terra");

    const gptImage = app.getModel("gpt-image-1");
    assert.ok("ai_name" in gptImage.model);
    const gptImageModel = gptImage.model;
    assert.equal(gptImage.catalog_version, currentVersion);
    assert.equal(gptImageModel.active, false);
    assert.equal(gptImageModel.default, false);
    assert.equal((gptImageModel.settings as Record<string, unknown>).uploadable, true);
    assert.equal(gptImage.runtime_usable, false);
    assert.equal("runtime_capability" in gptImageModel, false);

    assert.equal(runtime.catalog.fetched_at, "2026-10-08T13:18:39.393Z");
    assert.equal(runtime.catalog.getModel("gpt-image-1").active, true);
    assert.equal(runtime.serverOptions.modelAccess?.catalog.fetched_at, gptImageModel.fetched_at);
    assert.equal(runtime.serverOptions.modelAccess?.catalog.source_hashes.models, gptImageModel.source_hashes.models);
    assert.deepEqual(requests, []);

    await assert.rejects(
      app.estimateGeneration({ model_id: "gpt-image-1", operation_id: "generate-image", parameters: {} }),
      (error: unknown) => error instanceof ApplicationError && error.code === "COMPLIANCE_GATE_BLOCKED"
    );
    await assert.rejects(
      app.startGeneration({ model_id: "gpt-image-1", operation_id: "generate-image", parameters: {},
        idempotency_key: "current-discovery-read-only", confirmation_id: "current-discovery-read-only" }),
      (error: unknown) => error instanceof ApplicationError && error.code === "COMPLIANCE_GATE_BLOCKED"
    );
    assert.deepEqual(requests, []);
  } finally {
    restoreVersionEnvironment(previous);
  }
});

test("MCP discovery includes public snapshot provenance, counts, and full observed limits", async () => {
  const previous = process.env.SYNTX_PUBLIC_CATALOG_VERSION;
  try {
    delete process.env.SYNTX_PUBLIC_CATALOG_VERSION;
    await withClient(createMcpServer(createDefaultApplication()), async (client) => {
      const search = await call(client, "syntx_search_models", { include_inactive: true, limit: 100 });
      const metadata = search.structuredContent?.catalog_metadata as Record<string, unknown>;
      assert.equal(metadata.fetched_at, "2026-10-29T10:17:30.221Z");
      const summary = metadata.summary as Record<string, unknown>;
      assert.equal(summary.model_total, 211);
      assert.equal(summary.model_active, 173);
      assert.equal(summary.model_inactive, 38);
      assert.equal(summary.llm_model_total, 46);
      assert.equal(metadata.public_settings_coverage, "ALLOWLISTED_PUBLIC_API_FIELDS");
      const sources = metadata.sources as Record<string, { url: string; canonical_sha256: string }>;
      assert.match(sources.models?.url ?? "", /^https:\/\/api\.syntx\.ai\/api\/v1\/ai\/models/u);
      assert.match(sources.models?.canonical_sha256 ?? "", /^sha256:[a-f0-9]{64}$/u);
      const firstPage = search.structuredContent?.models as Array<Record<string, unknown>>;
      const nextCursor = search.structuredContent?.next_cursor;
      assert.equal(typeof nextCursor, "string");
      const next = await call(client, "syntx_search_models", { include_inactive: true, limit: 100, cursor: nextCursor as string });
      const secondPage = next.structuredContent?.models as Array<Record<string, unknown>>;
      const finalCursor = next.structuredContent?.next_cursor;
      assert.equal(typeof finalCursor, "string");
      const final = await call(client, "syntx_search_models", { include_inactive: true, limit: 100, cursor: finalCursor as string });
      const thirdPage = final.structuredContent?.models as Array<Record<string, unknown>>;
      assert.equal(firstPage.length + secondPage.length + thirdPage.length, 217);
      assert.equal([...firstPage, ...secondPage, ...thirdPage].filter((model) => model.active === true).length, 179);

      const kimi = await call(client, "syntx_search_models", { query: "kimi-k3", include_inactive: true, limit: 10 });
      assert.deepEqual((kimi.structuredContent?.models as Array<Record<string, unknown>>).map((model) => model.id),
        ["kimi-k3", "kimi-k3.1-pro"]);
      const terra = await call(client, "syntx_search_models", { query: "gpt-6.1-terra", limit: 10 });
      assert.equal(terra.structuredContent?.total, 1);
      assert.equal((terra.structuredContent?.models as Array<Record<string, unknown>>)[0]?.id, "gpt-6.1-terra");

      const detail = await call(client, "syntx_get_model", { model_id: "gemini-3.8-flash" });
      assert.deepEqual(detail.structuredContent?.catalog_metadata, metadata);
      const model = detail.structuredContent?.model as Record<string, unknown>;
      const settings = model.settings as Record<string, unknown>;
      assert.deepEqual(settings.allowed_media_types, ["images", "audios", "videos", "documents"]);
      assert.deepEqual(settings.accepted_file_types instanceof Array, true);
      assert.equal(settings.max_file_size, 5_242_880);
      assert.equal(detail.structuredContent?.runtime_usable, false);

      const retired = await call(client, "syntx_get_model", { model_id: "gpt-image-1" });
      const retiredModel = retired.structuredContent?.model as Record<string, unknown>;
      assert.equal(retired.structuredContent?.catalog_version, "2026-10-29T10:17:30.221Z.9ad757694b65");
      assert.equal(retiredModel.active, false);
      assert.equal(retiredModel.default, false);
      assert.equal((retiredModel.settings as Record<string, unknown>).uploadable, true);
      assert.equal(retiredModel.runtime_usable, false);
      assert.equal("runtime_capability" in retiredModel, false);

      const schema = await call(client, "syntx_get_generation_schema", {
        model_id: "gpt-image-1", operation_id: "generate-image"
      });
      assert.equal(schema.structuredContent?.catalog_version, "2026-10-29T10:17:30.221Z.9ad757694b65");
      assert.equal(schema.structuredContent?.schema_status, "BLOCKED");
      assert.deepEqual(schema.structuredContent?.blocked_reasons, ["MODEL_INACTIVE"]);
      assert.equal(schema.structuredContent?.runtime_usable, false);
      assert.equal(schema.structuredContent?.contract_evidence, null);

      const coverage = await call(client, "syntx_get_runtime_coverage", {});
      const profiles = coverage.structuredContent?.profiles as Array<Record<string, unknown>>;
      const historicalGptImage = profiles.find((profile) => profile.model_id === "gpt-image-1");
      assert.equal(historicalGptImage?.current_catalog_status, "INACTIVE");
      assert.equal(historicalGptImage?.runtime_verified, true);
      assert.equal(historicalGptImage?.verification_scope, "HISTORICAL_OWNER_GENERATION_AND_TERMINAL_RESULT");
    });
  } finally {
    restoreVersionEnvironment(previous);
  }
});

test("archived fresh discovery is shared by MCP model reads and linked model access without enabling generation", async () => {
  await withCatalogDirectory(async (catalogDirectory) => {
    const archived = await archivePublicCatalogSnapshot(freshSnapshot(), catalogDirectory);
    const requests: string[] = [];
    const runtime = createObservedOwnerRuntime({
      publicCatalogVersion: archived.version,
      catalogDirectory,
      fetchImpl: mockAccountFetch(requests, MODEL_ID),
      now: () => Date.parse("2026-09-04T12:00:00.000Z")
    });

    await withClient(createMcpServer(runtime.application, runtime.serverOptions), async (client) => {
      const search = await call(client, "syntx_search_models", { query: MODEL_ID, limit: 10 });
      assert.equal(search.isError, undefined);
      assert.equal(search.structuredContent?.total, 1);
      const models = search.structuredContent?.models as Array<Record<string, unknown>>;
      assert.equal(models[0]?.id, MODEL_ID);
      assert.equal(models[0]?.display_name, MODEL_LABEL);

      const found = await call(client, "syntx_get_model", {
        model_id: MODEL_ID,
        operation_id: "generate-image"
      });
      assert.equal(found.isError, undefined);
      const model = found.structuredContent?.model as Record<string, unknown>;
      assert.equal(model.id, MODEL_ID);
      assert.equal(model.runtime_usable, false);
      assert.equal("runtime_capability" in model, false);
      assert.deepEqual((model.settings as Record<string, unknown>).get_cost_params, ["image_size"]);
      assert.deepEqual(requests, []);

      const attemptId = await linkMockAccount(client);
      const access = await call(client, "syntx_get_model_access", {
        link_attempt_id: attemptId,
        model_id: MODEL_ID,
        cost_parameters: { image_size: "2K" }
      });
      assert.equal(access.isError, undefined);
      assert.equal(access.structuredContent?.model_id, MODEL_ID);
      assert.equal(access.structuredContent?.model_type, MODEL_ID);
      assert.equal(access.structuredContent?.ai_name, "banana");
      assert.equal(access.structuredContent?.catalog_version, found.structuredContent?.catalog_version);
      assert.equal(access.structuredContent?.access, true);
      assert.deepEqual(access.structuredContent?.parameter_keys, ["image_size"]);
      assert.equal(JSON.stringify(access).includes(FIXTURE), false);

      const beforeRejectedCalls = [...requests];
      const rejectedCost = await call(client, "syntx_get_model_access", {
        link_attempt_id: attemptId,
        model_id: MODEL_ID,
        cost_parameters: { duration: 5 }
      });
      assertErrorCode(rejectedCost, "INVALID_COST_PARAMETERS");

      const generation = { model_id: MODEL_ID, operation_id: "generate-image", parameters: {} };
      assertErrorCode(await call(client, "syntx_estimate_generation", generation), "COMPLIANCE_GATE_BLOCKED");
      assertErrorCode(await call(client, "syntx_start_generation", {
        ...generation,
        idempotency_key: "synthetic-catalog-generation-1",
        confirmation_id: "confirm_synthetic_catalog_1"
      }), "COMPLIANCE_GATE_BLOCKED");
      assert.deepEqual(requests, beforeRejectedCalls);
      assert.deepEqual(requests, [
        "POST /api/v1/auth/startauth",
        `GET /api/v1/auth/token/${UPSTREAM_UUID}`,
        "GET /api/v2/get_model_info"
      ]);
    });
  });
});

test("an archived historical snapshot never inherits historical runtime proof even when all source hashes match", async () => {
  await withCatalogDirectory(async (catalogDirectory) => {
    const snapshot = loadSyntxPublicCatalogSnapshot();
    const archived = await archivePublicCatalogSnapshot(snapshot, catalogDirectory);
    const selected = loadSelectedDiscoveryCatalog(archived.version, catalogDirectory);
    assert.equal(selected.runtimeCapabilities, null);
    assert.deepEqual(selected.discoveryCatalog.source_hashes, new DiscoveryCatalogRepository(snapshot).source_hashes);

    const archivedModel = createDefaultApplication(selected).getModel("banana3_light").model;
    assert.equal("runtime_capability" in archivedModel, false);
    const historicalModel = createDefaultApplication({
      discoveryCatalog: new DiscoveryCatalogRepository(snapshot)
    }).getModel("banana3_light").model;
    assert.equal("runtime_capability" in historicalModel, true);
  });
});

test("changed injected discovery fails historical overlay validation unless explicitly composed as discovery-only", () => {
  const discoveryCatalog = new DiscoveryCatalogRepository(freshSnapshot());
  assert.throws(() => createDefaultApplication({ discoveryCatalog }), /Runtime capability overlay drifted/u);
  const application = createDefaultApplication({ discoveryCatalog, runtimeCapabilities: null });
  const model = application.getModel(MODEL_ID).model;
  assert.equal(model.id, MODEL_ID);
  assert.equal("runtime_capability" in model, false);
});

test("invalid environment selection rejects default and owner runtime startup before upstream I/O", async () => {
  await withCatalogDirectory(async (catalogDirectory) => {
    const previous = process.env.SYNTX_PUBLIC_CATALOG_VERSION;
    let fetches = 0;
    try {
      for (const invalid of ["", "../v1/official-public-api.json", "sha256-not-a-hash.json", "https://example.invalid/catalog.json"]) {
        process.env.SYNTX_PUBLIC_CATALOG_VERSION = invalid;
        assert.throws(() => createDefaultApplication(), /PUBLIC_CATALOG_VERSION_INVALID/u);
        assert.throws(() => createObservedOwnerRuntime({
          catalogDirectory,
          fetchImpl: async () => {
            fetches += 1;
            throw new Error("Invalid selection must not perform I/O.");
          }
        }), /PUBLIC_CATALOG_VERSION_INVALID/u);
      }
      assert.equal(fetches, 0);
    } finally {
      restoreVersionEnvironment(previous);
    }
  });
});

test("owner runtime freezes one selected snapshot while later environment and archive-file changes affect only new loads", async () => {
  await withCatalogDirectory(async (catalogDirectory) => {
    const first = await archivePublicCatalogSnapshot(freshSnapshot(), catalogDirectory);
    const second = await archivePublicCatalogSnapshot(freshSnapshot(OTHER_MODEL_ID, "Synthetic catalog selection B"), catalogDirectory);
    const previous = process.env.SYNTX_PUBLIC_CATALOG_VERSION;
    const requests: string[] = [];
    try {
      process.env.SYNTX_PUBLIC_CATALOG_VERSION = first.version;
      const runtime = createObservedOwnerRuntime({ catalogDirectory, fetchImpl: mockAccountFetch(requests, MODEL_ID) });
      const catalogVersion = runtime.application.getModel(MODEL_ID).catalog_version;
      const catalog = runtime.serverOptions.modelAccess?.catalog;
      assert.ok(catalog);

      process.env.SYNTX_PUBLIC_CATALOG_VERSION = second.version;
      // Deliberately corrupt only this disposable fixture after construction.
      await writeFile(first.path, "invalidated disposable snapshot\n", "utf8");
      assert.equal(runtime.application.getModel(MODEL_ID).catalog_version, catalogVersion);
      assert.equal(catalog.getModel(MODEL_ID).display_name, MODEL_LABEL);
      assert.throws(() => catalog.getModel(OTHER_MODEL_ID), isMissingModel);
      assert.throws(() => loadSelectedDiscoveryCatalog(first.version, catalogDirectory), /PUBLIC_CATALOG_VERSION_HASH_MISMATCH/u);

      const newlySelected = loadSelectedDiscoveryCatalog(undefined, catalogDirectory);
      assert.equal(newlySelected.discoveryCatalog.getModel(OTHER_MODEL_ID).id, OTHER_MODEL_ID);
      assert.throws(() => newlySelected.discoveryCatalog.getModel(MODEL_ID), isMissingModel);

      await withClient(createMcpServer(runtime.application, runtime.serverOptions), async (client) => {
        const attemptId = await linkMockAccount(client);
        const access = await call(client, "syntx_get_model_access", {
          link_attempt_id: attemptId,
          model_id: MODEL_ID,
          cost_parameters: { image_size: "2K" }
        });
        assert.equal(access.isError, undefined);
        assert.equal(access.structuredContent?.catalog_version, catalogVersion);
        const missing = await call(client, "syntx_get_model_access", {
          link_attempt_id: attemptId,
          model_id: OTHER_MODEL_ID
        });
        assertErrorCode(missing, "MODEL_NOT_FOUND");
        assert.equal(requests.filter((request) => request === "GET /api/v2/get_model_info").length, 1);
      });
    } finally {
      restoreVersionEnvironment(previous);
    }
  });
});

test("discovery cursors from one archived source snapshot are rejected by a different selected snapshot", async () => {
  await withCatalogDirectory(async (catalogDirectory) => {
    const first = await archivePublicCatalogSnapshot(freshSnapshot(), catalogDirectory);
    const second = await archivePublicCatalogSnapshot(freshSnapshot(OTHER_MODEL_ID, "Synthetic catalog selection B"), catalogDirectory);
    const original = loadSelectedDiscoveryCatalog(first.version, catalogDirectory).discoveryCatalog;
    const changed = loadSelectedDiscoveryCatalog(second.version, catalogDirectory).discoveryCatalog;
    const input = { limit: 10, include_inactive: true };
    const firstPage = original.search(input);
    assert.ok(firstPage.next_cursor);
    assert.doesNotThrow(() => original.search({ ...input, cursor: firstPage.next_cursor! }));
    assert.throws(() => changed.search({ ...input, cursor: firstPage.next_cursor! }), (error: unknown) =>
      error instanceof ApplicationError && error.code === "INVALID_PARAMETERS"
    );
  });
});

function freshSnapshot(modelId = MODEL_ID, label = MODEL_LABEL) {
  const historical = loadSyntxPublicCatalogSnapshot();
  const models = structuredClone(historical.models);
  const banana = models.find((model) => model.value === "banana2");
  assert.ok(banana);
  models.push({
    ...structuredClone(banana),
    active: true,
    default: false,
    value: modelId,
    label,
    settings: { ...banana.settings, get_cost_params: ["image_size"] }
  });
  return buildSyntxPublicCatalogSnapshot({
    aiPayload: historical.ai,
    modelsPayload: models,
    llmModelsPayload: { count: historical.llm_models.length, models: historical.llm_models },
    fetchedAt: "2026-09-04T12:00:00.000Z"
  });
}

function mockAccountFetch(requests: string[], modelId: string): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname === "/api/v1/auth/startauth") return json({ uuid: UPSTREAM_UUID });
    if (url.pathname === `/api/v1/auth/token/${UPSTREAM_UUID}`) {
      return json({ valid: true, complete: true, token: FIXTURE, is_new_user: false });
    }
    assert.equal(url.pathname, "/api/v2/get_model_info");
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${FIXTURE}`);
    assert.equal(url.searchParams.get("ai_name"), "banana");
    assert.equal(url.searchParams.get("model_type"), modelId);
    assert.equal(url.searchParams.get("image_size"), "2K");
    return json({ access: true, cost: 2, discount_cost: null, free_remaining_generations: 0, limit: 1, show_warning: false });
  };
}

async function linkMockAccount(client: Client): Promise<string> {
  const begun = await call(client, "syntx_begin_login", {});
  assert.equal(begun.isError, undefined);
  const attemptId = begun.structuredContent?.attempt_id;
  assert.ok(typeof attemptId === "string");
  const linked = await call(client, "syntx_check_login", { attempt_id: attemptId });
  assert.equal(linked.isError, undefined);
  assert.equal(linked.structuredContent?.linked, true);
  return attemptId;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(result && typeof result === "object" && "content" in result);
  return result as CallToolResult;
}

function assertErrorCode(result: CallToolResult, code: string): void {
  assert.equal(result.isError, true);
  const text = result.content.find((item) => item.type === "text");
  assert.ok(text?.type === "text");
  assert.equal((JSON.parse(text.text) as { error: { code: string } }).error.code, code);
}

function isMissingModel(error: unknown): boolean {
  return error instanceof ApplicationError && error.code === "MODEL_NOT_FOUND";
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function restoreVersionEnvironment(value: string | undefined): void {
  if (value === undefined) delete process.env.SYNTX_PUBLIC_CATALOG_VERSION;
  else process.env.SYNTX_PUBLIC_CATALOG_VERSION = value;
}

async function withCatalogDirectory(operation: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-catalog-selection-"));
  try {
    await operation(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function withClient(server: McpServer, operation: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ name: "synthetic-catalog-selection-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await operation(client);
  } finally {
    await client.close();
    await server.close();
  }
}
