import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  SyntxHttpClient,
  type SyntxCredentialBroker
} from "../src/adapter/syntx/http-client.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import {
  registerSyntxModelAccessTool,
  SYNTX_MODEL_ACCESS_TOOL_NAME
} from "../src/mcp/model-access-tool.js";

const SECRET = ["test", "credential", "never", "serialized"].join("-");

function broker(): SyntxCredentialBroker {
  return {
    async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation(SECRET);
    }
  };
}

test("model access binds public model and allowlisted cost parameters", async () => {
  const catalog = new DiscoveryCatalogRepository();
  let observedUrl: URL | undefined;
  const server = new McpServer({ name: "model-access-test", version: "1" });
  registerSyntxModelAccessTool(server, {
    catalog,
    now: () => Date.parse("2026-09-02T12:00:00.000Z"),
    resolveClient: () =>
      new SyntxHttpClient({
        credentialBroker: broker(),
        fetchImpl: async (input, init) => {
          observedUrl = new URL(String(input));
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            `Bearer ${SECRET}`
          );
          return jsonResponse();
        }
      })
  });

  await withClient(server, async (client) => {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      SYNTX_MODEL_ACCESS_TOOL_NAME
    ]);
    const result = requireResult(
      await client.callTool({
        name: SYNTX_MODEL_ACCESS_TOOL_NAME,
        arguments: {
          link_attempt_id: "link_model_access_attempt_000001",
          model_id: "banana2",
          cost_parameters: { image_size: "2K" }
        }
      })
    );
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent?.model_id, "banana2");
    assert.deepEqual(result.structuredContent?.parameter_keys, ["image_size"]);
    assert.equal(result.structuredContent?.parameters_redacted, true);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(observedUrl?.searchParams.get("ai_name"), "banana");
    assert.equal(observedUrl?.searchParams.get("model_type"), "banana2");
    assert.equal(observedUrl?.searchParams.get("image_size"), "2K");
  });
});

test("model access rejects non-catalog cost keys before network", async () => {
  let calls = 0;
  const server = new McpServer({ name: "model-access-test", version: "1" });
  registerSyntxModelAccessTool(server, {
    catalog: new DiscoveryCatalogRepository(),
    resolveClient: () =>
      new SyntxHttpClient({
        credentialBroker: broker(),
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse();
        }
      })
  });
  await withClient(server, async (client) => {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_MODEL_ACCESS_TOOL_NAME,
        arguments: {
          link_attempt_id: "link_model_access_attempt_000001",
          model_id: "banana2",
          cost_parameters: { arbitrary_secret_parameter: "x" }
        }
      })
    );
    assert.equal(result.isError, true);
    assert.equal(calls, 0);
    assert.equal(
      JSON.stringify(result).includes("INVALID_COST_PARAMETERS"),
      true
    );
  });
});

test("model access derives model_type even when the public cost list names it", async () => {
  let calls = 0;
  let observedUrl: URL | undefined;
  const server = new McpServer({ name: "model-access-test", version: "1" });
  registerSyntxModelAccessTool(server, {
    catalog: new DiscoveryCatalogRepository(),
    resolveClient: () =>
      new SyntxHttpClient({
        credentialBroker: broker(),
        fetchImpl: async (input) => {
          calls += 1;
          observedUrl = new URL(String(input));
          return jsonResponse();
        }
      })
  });

  await withClient(server, async (client) => {
    const sameValueRejected = requireResult(
      await client.callTool({
        name: SYNTX_MODEL_ACCESS_TOOL_NAME,
        arguments: {
          link_attempt_id: "link_model_access_attempt_000001",
          model_id: "grok_t2i",
          cost_parameters: { model_type: "grok_t2i" }
        }
      })
    );
    assert.equal(sameValueRejected.isError, true);
    assert.equal(calls, 0);

    const rejected = requireResult(
      await client.callTool({
        name: SYNTX_MODEL_ACCESS_TOOL_NAME,
        arguments: {
          link_attempt_id: "link_model_access_attempt_000001",
          model_id: "grok_t2i",
          cost_parameters: { model_type: "grok_i2i", batch_size: 1 }
        }
      })
    );
    assert.equal(rejected.isError, true);
    assert.equal(calls, 0);
    assert.equal(
      JSON.stringify(rejected).includes("INVALID_COST_PARAMETERS"),
      true
    );

    const accepted = requireResult(
      await client.callTool({
        name: SYNTX_MODEL_ACCESS_TOOL_NAME,
        arguments: {
          link_attempt_id: "link_model_access_attempt_000001",
          model_id: "grok_t2i",
          cost_parameters: { batch_size: 1 }
        }
      })
    );
    assert.equal(accepted.isError, undefined);
    assert.equal(calls, 1);
    assert.deepEqual(observedUrl?.searchParams.getAll("model_type"), [
      "grok_t2i"
    ]);
    assert.equal(observedUrl?.searchParams.get("batch_size"), "1");
  });
});

test("model access errors never include upstream response bodies", async () => {
  const privateBody = `private-${SECRET}`;
  const server = new McpServer({ name: "model-access-test", version: "1" });
  registerSyntxModelAccessTool(server, {
    catalog: new DiscoveryCatalogRepository(),
    resolveClient: () =>
      new SyntxHttpClient({
        credentialBroker: broker(),
        fetchImpl: async () =>
          new Response(JSON.stringify({ detail: privateBody }), {
            status: 403,
            headers: { "content-type": "application/json" }
          })
      })
  });
  await withClient(server, async (client) => {
    const result = requireResult(
      await client.callTool({
        name: SYNTX_MODEL_ACCESS_TOOL_NAME,
        arguments: {
          link_attempt_id: "link_model_access_attempt_000001",
          model_id: "banana2",
          cost_parameters: {}
        }
      })
    );
    assert.equal(result.isError, true);
    assert.equal(JSON.stringify(result).includes(privateBody), false);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  });
});

function jsonResponse(): Response {
  return new Response(
    JSON.stringify({
      access: true,
      cost: 3,
      discount_cost: null,
      free_remaining_generations: 0,
      limit: 10,
      show_warning: false
    }),
    { headers: { "content-type": "application/json" } }
  );
}

async function withClient(
  server: McpServer,
  callback: (client: Client) => Promise<void>
): Promise<void> {
  const client = new Client({ name: "model-access-client", version: "1" });
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

function requireResult(value: unknown): CallToolResult {
  assert.ok(value && typeof value === "object" && "content" in value);
  return value as CallToolResult;
}
