import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApplicationCore } from "../src/application/core.js";
import { CatalogRepository, loadCatalog } from "../src/catalog/catalog.js";
import { ComplianceBlockedAdapter } from "../src/adapter/compliance-blocked-adapter.js";
import { DenyAllConfirmationStore } from "../src/policy/confirmation-store.js";
import { createMcpServer } from "../src/mcp/server.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  registerSyntxOwnerDurableGenerationTools,
  SYNTX_OWNER_GET_DURABLE_JOB_TOOL_NAME,
  SYNTX_OWNER_GET_DURABLE_RESULT_TOOL_NAME,
  SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME
} from "../src/mcp/owner-durable-live-generation-tools.js";

test("explicit owner durable tools expose only bounded start and exact-attempt GET operations", async () => {
  const calls: unknown[] = [];
  const server = new McpServer({ name: "owner-durable-live-test", version: "1.0.0" });
  registerSyntxOwnerDurableGenerationTools(server, {
    start: async (input) => { calls.push(input); return { id: "generation_opaque-1", model_id: "banana-2.1", operation_id: "generate-image", catalog_version: "catalog-v", status: "queued", created_at: "2026-10-09T00:00:00.000Z", updated_at: "2026-10-09T00:00:00.000Z" }; },
    getJob: async (attemptId, jobId) => { calls.push([attemptId, jobId]); return { id: jobId, model_id: "banana-2.1", operation_id: "generate-image", catalog_version: "catalog-v", status: "queued", created_at: "2026-10-09T00:00:00.000Z", updated_at: "2026-10-09T00:00:00.000Z" }; },
    getResult: async (attemptId, jobId) => { calls.push([attemptId, jobId]); return { id: "result-1", job_id: jobId, model_id: "banana-2.1", operation_id: "generate-image", catalog_version: "catalog-v", completed_at: "2026-10-09T00:00:00.000Z", summary: "done", artifacts: [] }; }
  });
  const client = new Client({ name: "owner-durable-live-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [SYNTX_OWNER_GET_DURABLE_JOB_TOOL_NAME, SYNTX_OWNER_GET_DURABLE_RESULT_TOOL_NAME, SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME].sort());
    const longPrompt = "x".repeat(5_000);
    const started = await client.callTool({ name: SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME, arguments: {
      link_attempt_id: "link_owner_durable_live_attempt01", model_id: "banana-2.1", operation_id: "generate-image", variant_id: "banana21-image-1k-minimal-square", parameters: { prompt: longPrompt, references: ["opaque-a", "opaque-b"] }, idempotency_key: "request-key-1"
    } });
    assert.equal((started.structuredContent as { status: string }).status, "queued");
    assert.equal(JSON.stringify(started).includes(longPrompt), false);
    assert.deepEqual(calls[0], { link_attempt_id: "link_owner_durable_live_attempt01", model_id: "banana-2.1", operation_id: "generate-image", variant_id: "banana21-image-1k-minimal-square", parameters: { prompt: longPrompt, references: ["opaque-a", "opaque-b"] }, idempotency_key: "request-key-1" });
    const job = await client.callTool({ name: SYNTX_OWNER_GET_DURABLE_JOB_TOOL_NAME, arguments: { link_attempt_id: "link_owner_durable_live_attempt01", job_id: "generation_opaque-1" } });
    assert.equal((job.structuredContent as { id: string }).id, "generation_opaque-1");
    const result = await client.callTool({ name: SYNTX_OWNER_GET_DURABLE_RESULT_TOOL_NAME, arguments: { link_attempt_id: "link_owner_durable_live_attempt01", job_id: "generation_opaque-1" } });
    assert.equal((result.structuredContent as { job_id: string }).job_id, "generation_opaque-1");
  } finally {
    await client.close();
    await server.close();
  }
});

test("default MCP composition does not register the owner durable mutation or recovery tools", async () => {
  const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, process.cwd() + "/catalog").discoveryCatalog;
  const core = new ApplicationCore(
    new CatalogRepository(loadCatalog(process.cwd() + "/catalog/v1/public-samples.json")),
    new ComplianceBlockedAdapter(), new DenyAllConfirmationStore(),
    { tenant_id: "test-default-tenant", subject_id: "test-default-subject", connection_id: "test-default-connection" },
    "COMPLIANCE_BLOCKED", catalog
  );
  const server = createMcpServer(core, { maplessSettingsInventory: null, staticParameterProjection: null });
  const client = new Client({ name: "owner-durable-default-surface-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.includes(SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME), false);
    assert.equal(names.includes(SYNTX_OWNER_GET_DURABLE_JOB_TOOL_NAME), false);
    assert.equal(names.includes(SYNTX_OWNER_GET_DURABLE_RESULT_TOOL_NAME), false);
  } finally { await client.close(); await server.close(); }
});
