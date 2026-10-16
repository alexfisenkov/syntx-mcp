import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";

const PUBLIC_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const CATALOG_VERSION = "2026-10-16T08:51:59.507Z.92c31dba26eb";
const MODELS_SOURCE_HASH = "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1";

test("explicit 1d8 public snapshot is discoverable through the real MCP SDK without inheriting runtime proof", async () => {
  assert.equal(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json");

  const networkRequests: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    networkRequests.push(input instanceof Request ? input.url : String(input));
    throw new Error("Catalog discovery test must not contact an upstream service.");
  };
  const runtime = createObservedOwnerRuntime({
    publicCatalogVersion: PUBLIC_VERSION,
    catalogDirectory: `${process.cwd()}/catalog`,
    fetchImpl
  });

  await withClient(createMcpServer(runtime.application, runtime.serverOptions), async (client) => {
    const listed = await client.listTools();
    const searchTool = listed.tools.find((tool) => tool.name === "syntx_search_models");
    const getModelTool = listed.tools.find((tool) => tool.name === "syntx_get_model");
    assert.ok(searchTool);
    assert.ok(getModelTool);
    const searchProperties = searchTool.inputSchema.properties as Record<string, unknown>;
    const getModelProperties = getModelTool.inputSchema.properties as Record<string, unknown>;
    assert.ok("query" in searchProperties && "include_inactive" in searchProperties);
    assert.ok("model_id" in getModelProperties && "operation_id" in getModelProperties);
    assert.deepEqual(getModelTool.inputSchema.required, ["model_id"]);

    const keyframesSearch = await call(client, "syntx_search_models", {
      query: "kling_4_keyframes", include_inactive: true, limit: 10
    });
    const omniSearch = await call(client, "syntx_search_models", {
      query: "kling_4_omni", include_inactive: true, limit: 10
    });
    for (const result of [keyframesSearch, omniSearch]) {
      assert.equal(result.isError, undefined);
      assert.equal(result.structuredContent?.catalog_version, CATALOG_VERSION);
      assert.equal(result.structuredContent?.catalog_kind, "OFFICIAL_PUBLIC_API_SNAPSHOT");
      assert.equal(result.structuredContent?.runtime_usable, false);
      const metadata = result.structuredContent?.catalog_metadata as Record<string, unknown>;
      const sources = metadata.sources as Record<string, { canonical_sha256: string }>;
      assert.equal(sources.models?.canonical_sha256, MODELS_SOURCE_HASH);
      const summary = metadata.summary as Record<string, unknown>;
      assert.equal(summary.model_total, 210);
      assert.equal(summary.model_active, 174);
      assert.equal(summary.model_inactive, 36);
      assert.equal(summary.ai_total, 41);
      assert.equal(summary.llm_model_total, 43);
      const models = result.structuredContent?.models as Array<Record<string, unknown>>;
      assert.equal(models.length, 1);
      assert.equal(models[0]?.active, true);
      assert.equal(models[0]?.family, "kling");
      assert.equal(models[0]?.scope, "video");
    }

    for (const modelId of ["kling_4_keyframes", "kling_4_omni"]) {
      const detail = await call(client, "syntx_get_model", { model_id: modelId });
      assert.equal(detail.isError, undefined);
      assert.equal(detail.structuredContent?.catalog_version, CATALOG_VERSION);
      assert.equal(detail.structuredContent?.runtime_usable, false);
      const model = detail.structuredContent?.model as Record<string, unknown>;
      assert.equal(model.id, modelId);
      assert.equal(model.ai_name, "kling");
      assert.equal(model.scope, "video");
      assert.equal(model.active, true);
      assert.equal(model.runtime_usable, false);
      assert.equal(Object.hasOwn(model, "runtime_capability"), false);
    }

    const uniDetail = await call(client, "syntx_get_model", { model_id: "uni-1.1-remove-background" });
    assert.equal(uniDetail.structuredContent?.catalog_version, CATALOG_VERSION);
    assert.equal(uniDetail.structuredContent?.runtime_usable, false);
    const uniModel = uniDetail.structuredContent?.model as Record<string, unknown>;
    const uniSettings = uniModel.settings as Record<string, unknown>;
    assert.equal(uniSettings.file_count_limit, 1);

    const veoDetail = await call(client, "syntx_get_model", { model_id: "veo_omni" });
    assert.equal(veoDetail.structuredContent?.catalog_version, CATALOG_VERSION);
    assert.equal(veoDetail.structuredContent?.runtime_usable, false);
    const veoModel = veoDetail.structuredContent?.model as Record<string, unknown>;
    const veoSettings = veoModel.settings as Record<string, unknown>;
    assert.equal(veoSettings.files_mention, true);
    assert.equal(Object.hasOwn(veoSettings, "file_mentions"), false);
    assert.equal(veoModel.runtime_usable, false);
    assert.equal(Object.hasOwn(veoModel, "runtime_capability"), false);

    assert.deepEqual(networkRequests, []);
  });
});

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(result && typeof result === "object" && "content" in result);
  return result as CallToolResult;
}

async function withClient(server: McpServer, operation: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ name: "public-catalog-1d8-mcp1957", version: "1" });
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
