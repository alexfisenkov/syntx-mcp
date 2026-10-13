import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MockAdapter } from "../src/adapter/mock-adapter.js";
import type { Balance } from "../src/domain/types.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import { TOOL_NAMES } from "../src/mcp/server.js";
import type { CreateMcpServerOptions } from "../src/mcp/server.js";
import {
  createHttpServer,
  isOriginAllowed
} from "../src/transports/http.js";
import { createTestHarness } from "./helpers.js";

test("Origin validation allows non-browser clients and exact configured origins", () => {
  const allowed = new Set(["https://trusted.example"]);
  assert.equal(isOriginAllowed(undefined, allowed), true);
  assert.equal(isOriginAllowed("https://trusted.example", allowed), true);
  assert.equal(isOriginAllowed("https://evil.example", allowed), false);
});

test("HTTP resolves a tenant-scoped application from every authenticated request", async () => {
  class TenantBalanceAdapter extends MockAdapter {
    override async getBalance(principal: Readonly<GenerationPrincipalRef>): Promise<Balance> {
      return {
        unit: "tokens",
        available: principal.tenant_id === "tenant-alpha" ? 101 : 202,
        as_of: "2026-09-02T00:00:00.000Z"
      };
    }
  }

  const server = createHttpServer({
    resolveApplication: (request) => {
      const tenantId = request.headers["x-test-tenant"];
      if (typeof tenantId !== "string") {
        throw new Error("Missing test tenant header.");
      }
      return createTestHarness({
        adapter: new TenantBalanceAdapter(),
        tenantId
      }).core;
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address() as AddressInfo;
  const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);

  try {
    assert.equal(await readBalance(endpoint, "tenant-alpha"), 101);
    assert.equal(await readBalance(endpoint, "tenant-beta"), 202);
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
  }
});

async function readBalance(endpoint: URL, tenantId: string): Promise<number> {
  const client = new Client({ name: `http-${tenantId}`, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { "x-test-tenant": tenantId } }
  });
  await client.connect(transport as unknown as Transport);
  try {
    const result = await client.callTool({
      name: "syntx_get_balance",
      arguments: {}
    });
    assert.ok(result.structuredContent);
    return (result.structuredContent as Record<string, unknown>)[
      "available"
    ] as number;
  } finally {
    await client.close();
  }
}

test("HTTP health, Origin rejection, initialize, and tools/list work", async () => {
  const server = createHttpServer({
    resolveApplication: () => createTestHarness().core,
    allowedOrigins: ["https://trusted.example"]
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: "http-contract-test", version: "1.0.0" });
  let connected = false;

  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ok",
      version: "0.2.0"
    });

    const forbidden = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "bad-origin", version: "1.0.0" }
        }
      })
    });
    assert.equal(forbidden.status, 403);

    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`${baseUrl}/mcp`)
      ) as unknown as Transport
    );
    connected = true;
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      TOOL_NAMES
    );
  } finally {
    if (connected) await client.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("HTTP normalizes omitted auth arguments before tool validation", async () => {
  const auth: NonNullable<CreateMcpServerOptions["auth"]> = {
    binding: {
      tenant_id: "tenant-http-auth-test",
      subject: "subject-http-auth-test"
    },
    linkService: {
      async createAttempt() {
        throw new Error("unexpected auth provider call");
      },
      async issueHandoff() {
        throw new Error("unexpected auth provider call");
      },
      async checkAttempt() {
        throw new Error("unexpected auth provider call");
      },
      async revoke() {
        throw new Error("unexpected auth provider call");
      }
    }
  };
  const server = createHttpServer({
    resolveApplication: () => createTestHarness().core,
    resolveMcpServerOptions: () => ({ auth })
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "http-auth-test", version: "1.0.0" });
  let connected = false;

  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${address.port}/mcp`)
      ) as unknown as Transport
    );
    connected = true;
    for (const name of ["syntx_check_login", "syntx_unlink"] as const) {
      assertSafeInvalidAuthInput(
        (await client.callTool({ name })) as CallToolResult
      );
    }
  } finally {
    if (connected) await client.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

function assertSafeInvalidAuthInput(result: CallToolResult): void {
  assert.equal(result.isError, true);
  const text = result.content.find((item) => item.type === "text");
  assert.equal(text?.type, "text");
  assert.deepEqual(JSON.parse(text.text) as unknown, {
    error: {
      code: "INVALID_TOOL_INPUT",
      message: "Tool input does not match the declared login schema."
    }
  });
  assert.equal(JSON.stringify(result).includes("Input validation error"), false);
}
