import assert from "node:assert/strict";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApplicationCore } from "../src/application/core.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer, TOOL_NAMES } from "../src/mcp/server.js";
import { MockAdapter } from "../src/adapter/mock-adapter.js";
import { ApplicationError } from "../src/errors.js";
import { createTestHarness, estimateAndConfirm } from "./helpers.js";

test("tools/list exposes the stable surface with titles and complete annotations", async () => {
  await withClient(createTestHarness().core, async (client) => {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      TOOL_NAMES
    );

    for (const tool of listed.tools) {
      assert.ok(tool.title);
      assert.ok(tool.annotations?.title);
      assert.equal(typeof tool.annotations?.readOnlyHint, "boolean");
      assert.equal(typeof tool.annotations?.destructiveHint, "boolean");
      assert.equal(typeof tool.annotations?.idempotentHint, "boolean");
      assert.equal(typeof tool.annotations?.openWorldHint, "boolean");
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal(tool.outputSchema?.type, "object");
    }

    const start = listed.tools.find(
      (tool) => tool.name === "syntx_start_generation"
    );
    const cancel = listed.tools.find((tool) => tool.name === "syntx_cancel_job");
    assert.deepEqual(start?.annotations, {
      title: "Start generation",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true
    });
    assert.equal(cancel?.annotations?.destructiveHint, true);
    assert.equal(cancel?.annotations?.idempotentHint, true);
    assert.deepEqual(cancel?.inputSchema.required, ["job_id", "idempotency_key"]);
    assert.deepEqual(Object.keys(cancel?.outputSchema?.properties ?? {}), [
      "job",
      "replayed"
    ]);
  });
});

test("estimate output redacts normalized values while preserving safe binding metadata", async () => {
  await withClient(createTestHarness().core, async (client) => {
    const secretPrompt = "private prompt that must not be echoed";
    const result = requireToolResult(
      await client.callTool({
        name: "syntx_estimate_generation",
        arguments: {
          model_id: "nano-banana-pro",
          operation_id: "text-to-image",
          parameters: { prompt: secretPrompt }
        }
      })
    );

    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.parameter_keys, ["prompt"]);
    assert.equal(result.structuredContent?.parameters_redacted, true);
    assert.equal("normalized_parameters" in (result.structuredContent ?? {}), false);
    assert.equal(JSON.stringify(result.structuredContent).includes(secretPrompt), false);
    assert.equal(
      result.content.some(
        (item) => item.type === "text" && item.text.includes(secretPrompt)
      ),
      false
    );
  });
});

test("result emits a signed HTTPS URL only as a resource link and replaces upstream summary", async () => {
  const signedUrl =
    "https://artifacts.example/output.png?signature=private-signed-value";
  const privatePrompt = "private result prompt";
  const harness = createTestHarness({
    adapter: new MockAdapter({
      artifactDownloadUrl: signedUrl,
      resultSummary: `Completed for prompt ${privatePrompt}; download ${signedUrl}`
    })
  });
  const approval = await estimateAndConfirm(
    harness,
    {
      model_id: "nano-banana-pro",
      operation_id: "text-to-image",
      parameters: { prompt: privatePrompt }
    },
    "confirm_result_link_start"
  );
  const started = await harness.core.startGeneration({
    model_id: "nano-banana-pro",
    operation_id: "text-to-image",
    parameters: { prompt: privatePrompt },
    idempotency_key: "request-result-link-01",
    confirmation_id: approval.confirmationId
  });
  await harness.core.getJob(started.job.id);
  await harness.core.getJob(started.job.id);

  await withClient(harness.core, async (client) => {
    const result = requireToolResult(
      await client.callTool({
        name: "syntx_get_result",
        arguments: { job_id: started.job.id }
      })
    );
    assert.equal(result.isError, undefined);
    assert.equal(JSON.stringify(result.structuredContent).includes(signedUrl), false);
    assert.equal(JSON.stringify(result.structuredContent).includes(privatePrompt), false);
    assert.equal(
      result.content.some(
        (item) => item.type === "text" && item.text.includes(signedUrl)
      ),
      false
    );
    const link = result.content.find((item) => item.type === "resource_link");
    assert.equal(link?.type === "resource_link" && link.uri, signedUrl);
    const artifacts = result.structuredContent?.artifacts as
      | Array<{ download_url: unknown }>
      | undefined;
    assert.equal(artifacts?.[0]?.download_url, null);
    assert.equal(
      typeof result.structuredContent?.summary === "string" &&
        result.structuredContent.summary.length <= 500,
      true
    );
    assert.equal(
      result.structuredContent?.summary,
      "Result metadata is available; inspect artifact metadata and resource links."
    );
  });
});

test("tool errors do not expose upstream messages or ApplicationError details", async () => {
  const privatePrompt = "private prompt that must not leave the adapter";
  const signedUrl = "https://artifacts.example/output.png?signature=private-value";
  class LeakyBalanceAdapter extends MockAdapter {
    override async getBalance(_principal: Readonly<GenerationPrincipalRef>): Promise<never> {
      throw new ApplicationError(
        "UPSTREAM_START_FAILED",
        `Upstream failure for ${privatePrompt}: ${signedUrl}`,
        { prompt: privatePrompt, download_url: signedUrl, diagnostic: "private" }
      );
    }
  }

  await withClient(
    createTestHarness({ adapter: new LeakyBalanceAdapter() }).core,
    async (client) => {
      const result = requireToolResult(
        await client.callTool({ name: "syntx_get_balance", arguments: {} })
      );
      assert.equal(result.isError, true);
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes(privatePrompt), false);
      assert.equal(serialized.includes(signedUrl), false);
      assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), {
        error: {
          code: "UPSTREAM_START_FAILED",
          message:
            "The upstream operation failed before a confirmed result; reconcile before retrying."
        }
      });
    }
  );
});

test("result fails closed when an adapter returns a non-HTTPS artifact URL", async () => {
  const harness = createTestHarness({
    adapter: new MockAdapter({
      artifactDownloadUrl: "http://artifacts.example/unsafe.png"
    })
  });
  const approval = await estimateAndConfirm(
    harness,
    {
      model_id: "nano-banana-pro",
      operation_id: "text-to-image",
      parameters: { prompt: "test" }
    },
    "confirm_result_unsafe_start"
  );
  const started = await harness.core.startGeneration({
    model_id: "nano-banana-pro",
    operation_id: "text-to-image",
    parameters: { prompt: "test" },
    idempotency_key: "request-result-unsafe",
    confirmation_id: approval.confirmationId
  });
  await harness.core.getJob(started.job.id);
  await harness.core.getJob(started.job.id);

  await withClient(harness.core, async (client) => {
    const result = requireToolResult(
      await client.callTool({
        name: "syntx_get_result",
        arguments: { job_id: started.job.id }
      })
    );
    assert.equal(result.isError, true);
    assert.equal(result.content.some((item) => item.type === "resource_link"), false);
    assert.equal(
      result.content.some(
        (item) =>
          item.type === "text" && item.text.includes("UNSAFE_ARTIFACT_URL")
      ),
      true
    );
  });
});

test("tools return compact text fallback and structured content", async () => {
  await withClient(createTestHarness().core, async (client) => {
    await client.listTools();
    const result = requireToolResult(
      await client.callTool({
        name: "syntx_search_models",
        arguments: { query: "Veo", limit: 5 }
      })
    );

    assert.equal(result.isError, undefined);
    assert.equal(result.content[0]?.type, "text");
    assert.equal(result.content[0]?.type === "text" && result.content[0].text.includes("veo-omni-flash"), true);
    assert.equal(result.structuredContent?.total, 1);
  });
});

test("strict tool input validation rejects unknown fields and invalid cancel evidence", async () => {
  await withClient(createTestHarness().core, async (client) => {
    await client.listTools();
    const unknown = requireToolResult(
      await client.callTool({
        name: "syntx_search_models",
        arguments: { limit: 5, unexpected: true }
      })
    );
    assert.equal(unknown.isError, true);

    const invalidConfirmation = requireToolResult(
      await client.callTool({
        name: "syntx_cancel_job",
        arguments: {
          job_id: "job_mock_00000001",
          confirmation_id: "not-a-confirmation"
        }
      })
    );
    assert.equal(invalidConfirmation.isError, true);
  });
});

test("default MCP upstream tools surface the compliance block as a tool error", async () => {
  await withClient(createDefaultApplication(), async (client) => {
    await client.listTools();
    const result = requireToolResult(
      await client.callTool({
        name: "syntx_get_balance",
        arguments: {}
      })
    );
    assert.equal(result.isError, true);
    assert.equal(
      result.content[0]?.type === "text" &&
        result.content[0].text.includes("COMPLIANCE_GATE_BLOCKED"),
      true
    );
  });
});

async function withClient(
  application: ApplicationCore,
  callback: (client: Client) => Promise<void>
): Promise<void> {
  const server: McpServer = createMcpServer(application);
  const client = new Client({ name: "contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await callback(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function requireToolResult(result: unknown): CallToolResult {
  assert.ok(result && typeof result === "object" && "content" in result);
  return result as CallToolResult;
}
