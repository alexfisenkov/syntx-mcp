import assert from "node:assert/strict";
import { testPrincipal } from "./helpers.js";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ApplicationCore,
  type ExecutionProfile
} from "../src/application/core.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { MockAdapter } from "../src/adapter/mock-adapter.js";
import { CatalogRepository, loadCatalog } from "../src/catalog/catalog.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { RuntimeCapabilityCatalog } from "../src/catalog/runtime-capability-catalog.js";
import { ApplicationError } from "../src/errors.js";
import { createMcpServer } from "../src/mcp/server.js";
import { InMemoryTestConfirmationStore } from "../src/policy/confirmation-store.js";
import { createTestHarness, estimateAndConfirm } from "./helpers.js";

test("discovered model and operation stay recognized without sample, approval, or upstream fallback", async (t) => {
  const { core, catalog, adapter, confirmations } = discoveryHarness();
  const sampleLookup = t.mock.method(catalog, "getOperation");
  const estimate = t.mock.method(adapter, "estimateGeneration");
  const start = t.mock.method(adapter, "startGeneration");
  const reconcile = t.mock.method(adapter, "reconcileStart");
  const consume = t.mock.method(confirmations, "consumeGeneration");
  const describe = t.mock.method(confirmations, "describeGenerationApproval");
  const found = core.searchModels({ query: "banana2", limit: 10 });
  const model = found.models.find((candidate) => candidate.id === "banana2");
  assert.ok(model);
  assert.equal(model.operations[0]?.id, "generate-image");
  assert.equal(core.getModel(model.id, "generate-image").model.id, model.id);

  await assertGenerationError(
    core,
    { model_id: model.id, operation_id: "generate-image", parameters: {} },
    "GENERATION_CONTRACT_UNAVAILABLE"
  );
  for (const spy of [sampleLookup, estimate, start, reconcile, consume, describe]) {
    assert.equal(spy.mock.callCount(), 0);
  }
});

for (const [modelId, operationId] of [
  ["veo_omni", "generate-video"],
  ["V5_5", "generate-audio"],
  ["gpt-5-nano-2025-08-07", "generate-text"]
] as const) {
  test(`discovery identity is preserved exactly for ${modelId}`, async () => {
    const { core } = discoveryHarness();
    const found = core.searchModels({ query: modelId, limit: 100 });
    assert.ok(found.models.some((model) => model.id === modelId));
    const details = core.getModel(modelId, operationId);
    assert.equal(details.model.id, modelId);
    assert.equal(details.model.operations[0]?.id, operationId);
    await assertGenerationError(
      core,
      { model_id: modelId, operation_id: operationId, parameters: {} },
      "GENERATION_CONTRACT_UNAVAILABLE"
    );
  });
}

test("LLM-only identities remain discoverable but have no executable generation contract", async () => {
  const { discoveryCatalog: discovery } = loadSelectedDiscoveryCatalog();
  const core = new ApplicationCore(
    new CatalogRepository(loadCatalog()),
    new MockAdapter(),
    new InMemoryTestConfirmationStore(),
    testPrincipal("tenant_current_llm_discovery"),
    "TEST_ONLY_MOCK",
    discovery,
    undefined
  );
  for (const modelId of [
    "claude-haiku-5-5",
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "gpt-6.1-sol",
    "grok-4.7"
  ]) {
    const record = discovery.get(modelId);
    assert.equal(record.runtime_usable, false);
    assert.deepEqual(
      record.operations.map((operation) => operation.id),
      ["generate-text"]
    );
    assert.equal(
      core.searchModels({ query: modelId, limit: 100 }).models.some(
        (model) => model.id === modelId
      ),
      true
    );
    await assertGenerationError(
      core,
      { model_id: modelId, operation_id: "generate-text", parameters: {} },
      "GENERATION_CONTRACT_UNAVAILABLE"
    );
  }
});

test("discovery operations are exact and sample operation aliases are not accepted", async () => {
  const { core } = discoveryHarness();
  for (const operationId of ["text-to-image", "generate-video", ""]) {
    assert.throws(
      () => core.getModel("banana2", operationId),
      hasCode("OPERATION_NOT_FOUND")
    );
    await assertGenerationError(
      core,
      { model_id: "banana2", operation_id: operationId, parameters: {} },
      "OPERATION_NOT_FOUND"
    );
  }
});

test("sample and unknown model ids never fall through the active discovery catalog", async () => {
  const { core } = discoveryHarness();
  for (const modelId of ["nano-banana-pro", "not-a-known-model", "BANANA2"]) {
    assert.throws(() => core.getModel(modelId), hasCode("MODEL_NOT_FOUND"));
    await assertGenerationError(
      core,
      {
        model_id: modelId,
        operation_id: "text-to-image",
        parameters: { prompt: "A valid sample prompt cannot enable fallback" }
      },
      "MODEL_NOT_FOUND"
    );
  }
});

test("a static-client overlay remains non-executable at the identity gate", async () => {
  const { core } = discoveryHarness();
  const details = core.getModel("banana3_light", "generate-image");
  assert.equal(details.runtime_usable, false);
  assert.ok("runtime_capability" in details.model);
  assert.equal(details.model.runtime_capability?.evidence, "STATIC_CLIENT");
  assert.equal(details.model.runtime_capability?.runtime_usable, false);
  assert.ok(details.model.runtime_capability?.request_schema);
  await assertGenerationError(
    core,
    {
      model_id: "banana3_light",
      operation_id: "generate-image",
      parameters: { prompt: "Local test only", n: 1 }
    },
    "GENERATION_CONTRACT_UNAVAILABLE"
  );
});

test("compliance stays ahead of catalog lookup and generation dependencies", async (t) => {
  const { core, discovery, catalog, adapter, confirmations } =
    discoveryHarness("COMPLIANCE_BLOCKED");
  const lookup = t.mock.method(discovery, "getModel");
  const sampleLookup = t.mock.method(catalog, "getOperation");
  const estimate = t.mock.method(adapter, "estimateGeneration");
  const start = t.mock.method(adapter, "startGeneration");
  const consume = t.mock.method(confirmations, "consumeGeneration");
  const input = {
    model_id: "not-a-known-model",
    operation_id: "not-an-operation",
    parameters: {}
  };
  await assertGenerationError(core, input, "COMPLIANCE_GATE_BLOCKED");
  await assertGenerationError(
    createDefaultApplication(),
    input,
    "COMPLIANCE_GATE_BLOCKED"
  );
  for (const spy of [lookup, sampleLookup, estimate, start, consume]) {
    assert.equal(spy.mock.callCount(), 0);
  }
});

test("sample-only mock search, get, estimate and start keep one unchanged identity", async () => {
  const harness = createTestHarness();
  const found = harness.core.searchModels({ query: "nano-banana-pro", limit: 10 });
  const model = found.models[0];
  assert.ok(model);
  assert.equal(model.id, "nano-banana-pro");
  assert.equal(model.operations[0]?.id, "text-to-image");
  const input = {
    model_id: model.id,
    operation_id: "text-to-image",
    parameters: { prompt: "A local mock only" }
  };
  assert.equal(harness.core.getModel(model.id).model.id, model.id);
  const approval = await estimateAndConfirm(harness, input);
  const started = await harness.core.startGeneration({
    ...input,
    idempotency_key: "request_sample_identity",
    confirmation_id: approval.confirmationId
  });
  assert.equal(approval.estimate.model_id, model.id);
  assert.equal(started.job.model_id, model.id);
  assert.equal(started.job.operation_id, input.operation_id);
  assert.equal(started.job.catalog_version, found.catalog_version);
});

test("MCP discovery ids reach a sanitized unavailable-contract error without private input", async () => {
  const { core } = discoveryHarness();
  const server = createMcpServer(core);
  const client = new Client({ name: "discovery-identity-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const privatePrompt = "private identity regression prompt";
    for (const name of ["syntx_estimate_generation", "syntx_start_generation"]) {
      const result = (await client.callTool({
        name,
        arguments: {
          model_id: "banana2",
          operation_id: "generate-image",
          parameters: { prompt: privatePrompt },
          ...(name === "syntx_start_generation"
            ? {
                idempotency_key: "request_discovery_identity",
                confirmation_id: "confirm_discovery_identity"
              }
            : {})
        }
      })) as CallToolResult;
      assert.equal(result.isError, true);
      const content = result.content[0];
      assert.equal(content?.type, "text");
      if (content?.type !== "text") assert.fail("Expected an MCP text error");
      const payload = JSON.parse(content.text) as {
        error: { code: string; message: string };
      };
      assert.equal(payload.error.code, "GENERATION_CONTRACT_UNAVAILABLE");
      assert.match(payload.error.message, /no executable generation contract/i);
      assert.deepEqual(Object.keys(payload.error).sort(), ["code", "message"]);
      assert.equal(JSON.stringify(result).includes(privatePrompt), false);
      assert.equal(JSON.stringify(result).includes("confirm_discovery_identity"), false);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

function discoveryHarness(executionProfile: ExecutionProfile = "TEST_ONLY_MOCK") {
  const catalog = new CatalogRepository(loadCatalog());
  const discovery = new DiscoveryCatalogRepository();
  const adapter = new MockAdapter();
  const confirmations = new InMemoryTestConfirmationStore();
  const core = new ApplicationCore(
    catalog,
    adapter,
    confirmations,
    testPrincipal("tenant_discovery_identity"),
    executionProfile,
    discovery,
    new RuntimeCapabilityCatalog(discovery)
  );
  return { core, catalog, discovery, adapter, confirmations };
}

async function assertGenerationError(
  core: ApplicationCore,
  input: {
    model_id: string;
    operation_id: string;
    parameters: Record<string, unknown>;
  },
  code: string
): Promise<void> {
  await assert.rejects(core.estimateGeneration(input), hasCode(code));
  await assert.rejects(
    core.startGeneration({
      ...input,
      idempotency_key: "request_discovery_identity",
      confirmation_id: "confirm_discovery_identity"
    }),
    hasCode(code)
  );
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.code, code);
    return true;
  };
}
