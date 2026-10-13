import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SYNTX_VIDEO_EVIDENCE_TOOL_NAME } from "../src/mcp/video-evidence-tool.js";

const evidence = {
  schema_version: 1 as const,
  kind: "VIDEO_EVIDENCE" as const,
  public_version: `sha256-${"a".repeat(64)}.json`,
  settings_version: `sha256-${"b".repeat(64)}.json`,
  build_id: "1789134564",
  runtime_usable: false as const,
  form_id: "veo-3",
  module_name: "useLuma.js",
  evidence_records: [{ scope: "module", name: "MODEL", exported: true, locator: { line: 1, column: 1 }, status: "STATIC_VALUE" as const, value: "veo-3" }],
  nodes: [{ module_name: "useLuma.js", source_path: "/src/components/chat/forms/settings/veo-3.vue", source_content_sha256: `sha256:${"c".repeat(64)}`, relation: "PROVIDER_ROOT" as const }],
  blockers: ["DYNAMIC_IMPORT_NOT_STATIC"]
};

async function withClient(server: ReturnType<typeof createMcpServer>, run: (client: Client) => Promise<void>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "video-evidence-test", version: "1.0.0" });
  await client.connect(clientTransport);
  try { await run(client); } finally { await client.close(); await server.close(); }
}

test("video evidence is opt-in and default server surface is unchanged", async () => {
  await withClient(createMcpServer(createDefaultApplication()), async (client) => {
    assert.equal((await client.listTools()).tools.some((tool) => tool.name === SYNTX_VIDEO_EVIDENCE_TOOL_NAME), false);
  });
  await withClient(createMcpServer(createDefaultApplication(), { videoEvidence: { resolveEvidence: () => evidence } }), async (client) => {
    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === SYNTX_VIDEO_EVIDENCE_TOOL_NAME));
    const tool = listed.tools.find((item) => item.name === SYNTX_VIDEO_EVIDENCE_TOOL_NAME)!;
    assert.equal(tool.inputSchema.required, undefined);
    assert.equal(tool.annotations?.readOnlyHint, true);
  });
});

test("video evidence resolver receives bounded selectors and returns redacted schema", async () => {
  let query: unknown;
  await withClient(createMcpServer(createDefaultApplication(), { videoEvidence: { resolveEvidence: (input) => { query = input; return evidence; } } }), async (client) => {
    const result = await client.callTool({ name: SYNTX_VIDEO_EVIDENCE_TOOL_NAME, arguments: { form_id: "veo-3", module_name: "useLuma.js" } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(query, { form_id: "veo-3", module_name: "useLuma.js" });
    assert.equal((result.structuredContent as Record<string, unknown>).runtime_usable, false);
    assert.equal("source" in (result.structuredContent as Record<string, unknown>), false);
    assert.equal("prompt" in (result.structuredContent as Record<string, unknown>), false);
    assert.equal("credentials" in (result.structuredContent as Record<string, unknown>), false);
  });
});

test("invalid selectors are rejected before resolver and malformed resolver output is an error", async () => {
  let called = false;
  await withClient(createMcpServer(createDefaultApplication(), { videoEvidence: { resolveEvidence: () => { called = true; return evidence; } } }), async (client) => {
    const result = await client.callTool({ name: SYNTX_VIDEO_EVIDENCE_TOOL_NAME, arguments: { form_id: "../unsafe" } });
    assert.equal(result.isError, true);
    assert.equal(called, false);
  });
  await withClient(createMcpServer(createDefaultApplication(), { videoEvidence: { resolveEvidence: () => ({ ...evidence, runtime_usable: true }) as never } }), async (client) => {
    const result = await client.callTool({ name: SYNTX_VIDEO_EVIDENCE_TOOL_NAME, arguments: {} });
    assert.equal(result.isError, true);
  });
});
