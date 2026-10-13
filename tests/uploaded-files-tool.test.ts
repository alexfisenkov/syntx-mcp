import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { registerSyntxListUploadedFilesTool, SYNTX_LIST_UPLOADED_FILES_TOOL_NAME } from "../src/mcp/uploaded-files-tool.js";
import {
  registerSyntxReconcileUploadedFileTool,
  SYNTX_RECONCILE_UPLOADED_FILE_TOOL_NAME
} from "../src/mcp/reconcile-uploaded-file-tool.js";

const SECRET = "uploaded-files-tool-secret";
const ATTEMPT = "link_uploaded_files_attempt_0001";
const broker: SyntxCredentialBroker = { async useCredential(operation) { return operation(SECRET); } };

test("uploaded-files MCP exposes only bounded redacted metadata", async () => {
  let resolved = "";
  const server = new McpServer({ name: "uploaded-files-tool-test", version: "1" });
  registerSyntxListUploadedFilesTool(server, {
    resolveClient: (attemptId) => {
      resolved = attemptId;
      return new SyntxHttpClient({
        credentialBroker: broker,
        fetchImpl: async (_input, init) => {
          assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SECRET}`);
          return new Response(JSON.stringify({
            page: 1, page_size: 1, has_more: false,
            items: [{ id: "file_1", filename: "a.png", url: "https://signed.invalid" }]
          }), { headers: { "content-type": "application/json" } });
        }
      });
    }
  });
  await withClient(server, async (client) => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === SYNTX_LIST_UPLOADED_FILES_TOOL_NAME);
    assert.ok(tool);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
    const result = await client.callTool({
      name: SYNTX_LIST_UPLOADED_FILES_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, scope: "uploaded", page: 1, page_size: 1 }
    }) as CallToolResult;
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      page: 1, page_size: 1, has_more: false, total: null,
      items: [{ id: "file_1", filename: "a.png" }]
    });
    assert.equal(JSON.stringify(result).includes("signed.invalid"), false);
    assert.equal(resolved, ATTEMPT);
  });
});

test("uploaded-files MCP validates bounds before resolving tenant client", async () => {
  let resolved = 0;
  const server = new McpServer({ name: "uploaded-files-input-test", version: "1" });
  registerSyntxListUploadedFilesTool(server, { resolveClient: () => { resolved += 1; throw new Error(SECRET); } });
  await withClient(server, async (client) => {
    for (const args of [
      { link_attempt_id: ATTEMPT, scope: "uploaded", page: 0, page_size: 1 },
      { link_attempt_id: ATTEMPT, scope: "uploaded", page: 1, page_size: 101 },
      { link_attempt_id: ATTEMPT, scope: "uploaded", page: 1, page_size: 1, url: "bad" }
    ]) {
      const result = await client.callTool({ name: SYNTX_LIST_UPLOADED_FILES_TOOL_NAME, arguments: args });
      assert.equal(result.isError, true);
    }
  });
  assert.equal(resolved, 0);
});

test("reconcile uploaded file projects metadata from the confirmed first page", async () => {
  const requestedPages: number[] = [];
  const server = new McpServer({ name: "uploaded-file-reconcile-test", version: "1" });
  registerSyntxReconcileUploadedFileTool(server, {
    resolveClient: () => new SyntxHttpClient({
      credentialBroker: broker,
      fetchImpl: async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const page = Number(url.searchParams.get("page"));
        requestedPages.push(page);
        assert.equal(url.searchParams.get("scope"), "all");
        assert.equal(url.searchParams.get("page_size"), "10");
        return new Response(JSON.stringify({
          page, page_size: 10, has_more: page < 2,
          items: page === 1 ? [{ id: "file_target", mime_type: "image/png", size: 4, created_at: "2026-09-13" , url: "https://signed.invalid" }] : []
        }), { headers: { "content-type": "application/json" } });
      }
    })
  });
  await withClient(server, async (client) => {
    const result = await client.callTool({
      name: SYNTX_RECONCILE_UPLOADED_FILE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, file_id: "file_target" }
    }) as CallToolResult;
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      status: "FOUND", file_id: "file_target",
      metadata: { mime_type: "image/png", size: 4, created_at: "2026-09-13" }
    });
    assert.equal(JSON.stringify(result).includes("signed.invalid"), false);
  });
  assert.deepEqual(requestedPages, [1]);
});

test("reconcile uploaded file reports incomplete search when the first page has more", async () => {
  let calls = 0;
  const server = new McpServer({ name: "uploaded-file-reconcile-incomplete-test", version: "1" });
  registerSyntxReconcileUploadedFileTool(server, {
    resolveClient: () => new SyntxHttpClient({
      credentialBroker: broker,
      fetchImpl: async (input) => {
        calls += 1;
        const page = Number(new URL(input instanceof Request ? input.url : String(input)).searchParams.get("page"));
        return new Response(JSON.stringify({ page, page_size: 10, has_more: true, items: [] }), { headers: { "content-type": "application/json" } });
      }
    })
  });
  await withClient(server, async (client) => {
    const result = await client.callTool({
      name: SYNTX_RECONCILE_UPLOADED_FILE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, file_id: "file_missing" }
    }) as CallToolResult;
    assert.deepEqual(result.structuredContent, {
      status: "SEARCH_INCOMPLETE", file_id: "file_missing", metadata: {}
    });
  });
  assert.equal(calls, 1);
});

test("reconcile uploaded file rejects malformed opaque ids before resolving client", async () => {
  let resolved = 0;
  const server = new McpServer({ name: "uploaded-file-reconcile-input-test", version: "1" });
  registerSyntxReconcileUploadedFileTool(server, { resolveClient: () => { resolved += 1; throw new Error(SECRET); } });
  await withClient(server, async (client) => {
    for (const file_id of ["", "../../secret", "file id", "x".repeat(257)]) {
      const result = await client.callTool({ name: SYNTX_RECONCILE_UPLOADED_FILE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, file_id } });
      assert.equal(result.isError, true);
    }
  });
  assert.equal(resolved, 0);
});

async function withClient(server: McpServer, work: (client: Client) => Promise<void>) {
  const client = new Client({ name: "uploaded-files-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await work(client); } finally { await client.close(); await server.close(); }
}
