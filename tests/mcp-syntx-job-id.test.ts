import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SyntxUpstreamAdapter } from "../src/adapter/syntx/upstream-adapter.js";
import type { SyntxGenerationChatClient } from "../src/adapter/syntx/upstream-adapter.js";
import { ApplicationCore } from "../src/application/core.js";
import { CatalogRepository, loadCatalog } from "../src/catalog/catalog.js";
import { createMcpServer } from "../src/mcp/server.js";
import { InMemoryTestConfirmationStore } from "../src/policy/confirmation-store.js";
import { SqliteGenerationTransactionStore } from "../src/storage/sqlite-generation-transaction-store.js";
import { testPrincipal } from "./helpers.js";

test("all MCP job tools accept the durable id emitted by SyntxUpstreamAdapter", async () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  let cancelCalls = 0;
  let completed = false;
  const chatClient: SyntxGenerationChatClient = {
    async createChat() {
      return { chat_uuid: "chat_fixture_001" };
    },
    async startImage() {
      return {
        chat_uuid: "chat_fixture_001",
        message_id: "message_fixture_001",
      };
    },
    async startVideo() {
      throw new Error("unexpected fixture call");
    },
    async startAudio() {
      throw new Error("unexpected fixture call");
    },
    async getMessage() {
      return {
        chat_uuid: "chat_fixture_001",
        message_id: "message_fixture_001",
        artifacts: completed
          ? [{ url: "https://artifacts.example/fixture.png" }]
          : [],
      };
    },
    async cancelMessage() {
      cancelCalls++;
      return {
        chat_uuid: "chat_fixture_001",
        message_id: "message_fixture_001",
        accepted: true,
      };
    },
  };
  const adapter = new SyntxUpstreamAdapter({
    transactionStore: store,
    resolveChatClient: () => chatClient,
    resolveAiName: () => "banana",
    resolveModality: () => "image",
  });
  const confirmations = new InMemoryTestConfirmationStore();
  const core = new ApplicationCore(
    new CatalogRepository(loadCatalog()),
    adapter,
    confirmations,
    testPrincipal("tenant_fixture"),
    "TEST_ONLY_MOCK",
  );
  const server = createMcpServer(core);
  const client = new Client({
    name: "syntx-job-id-contract",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    const job = await adapter.startGeneration(
      {
        principal: testPrincipal("tenant_fixture"),
        idempotency_key: "start_fixture_001",
        confirmation_id: "confirm_fixture_001",
        approved_max_cost_tokens: 1,
      },
      {
        model_id: "nano-banana-pro",
        operation_id: "text-to-image",
        parameters: { prompt: "synthetic test" },
        catalog_version: "fixture-v1",
      },
    );
    assert.match(job.id, /^generation_/);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    for (const name of [
      "syntx_get_job",
      "syntx_cancel_job",
      "syntx_get_result",
    ]) {
      const schema = listed.tools.find(
        (tool) => tool.name === name,
      )?.inputSchema;
      const property = schema?.properties?.job_id as { pattern: string };
      const pattern = new RegExp(property.pattern);
      assert.equal(
        pattern.test(job.id),
        true,
        `${name} rejects adapter's public job id`,
      );
      assert.equal(pattern.test("job_mock_00000001"), true);
      for (const invalid of [
        "generation_not-a-uuid",
        "../job_test",
        "https://example.test/job",
        `${job.id}/other`,
      ]) {
        assert.equal(pattern.test(invalid), false);
      }
    }
    const polled = (await client.callTool({
      name: "syntx_get_job",
      arguments: { job_id: job.id },
    })) as CallToolResult;
    assert.notEqual(polled.isError, true);
    assert.equal(polled.structuredContent?.id, job.id);
    for (const [name, code, extra] of [
      ["syntx_get_result", "JOB_NOT_READY", {}],
      [
        "syntx_cancel_job",
        "CONFIRMATION_REQUIRED",
        { idempotency_key: "cancel_fixture_001" },
      ],
    ] as const) {
      const result = (await client.callTool({
        name,
        arguments: { job_id: job.id, ...extra },
      })) as CallToolResult;
      assert.equal(result.isError, true);
      const text = result.content.find((item) => item.type === "text");
      assert.equal(
        text?.type === "text" && JSON.parse(text.text).error.code,
        code,
      );
    }
    assert.equal(
      cancelCalls,
      0,
      "missing confirmation cannot send a cancellation",
    );
    confirmations.seedCancellation({
      principal: testPrincipal("tenant_fixture"),
      confirmation_id: "confirm_cancel_fixture_001",
      job_id: job.id,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const firstCancel = (await client.callTool({
      name: "syntx_cancel_job",
      arguments: {
        job_id: job.id,
        idempotency_key: "cancel_fixture_001",
        confirmation_id: "confirm_cancel_fixture_001",
      },
    })) as CallToolResult;
    assert.notEqual(firstCancel.isError, true);
    assert.equal(
      (firstCancel.structuredContent?.job as { status: string }).status,
      "queued",
    );
    completed = true;
    const finished = (await client.callTool({
      name: "syntx_get_job",
      arguments: { job_id: job.id },
    })) as CallToolResult;
    assert.equal(finished.structuredContent?.status, "succeeded");
    const retry = (await client.callTool({
      name: "syntx_cancel_job",
      arguments: {
        job_id: job.id,
        idempotency_key: "cancel_fixture_001",
      },
    })) as CallToolResult;
    assert.notEqual(retry.isError, true);
    assert.equal(
      (retry.structuredContent?.job as { status: string }).status,
      "succeeded",
      "settled cancellation must reconcile, not return a cached queued job",
    );
    assert.equal(retry.structuredContent?.replayed, true);
    assert.equal(cancelCalls, 1);
  } finally {
    await client.close();
    await server.close();
    store.close();
  }
});
