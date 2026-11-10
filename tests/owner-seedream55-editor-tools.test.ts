import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSyntxOwnerSeedream55EditorTools, OWNER_SEEDREAM55_EDITOR_TOOL_NAMES,
  SYNTX_GET_SEEDREAM55_EDITOR_PARAMETERS, SYNTX_OWNER_GENERATE_SEEDREAM55_EDITOR_IMAGE,
  SYNTX_OWNER_RECONCILE_SEEDREAM55_EDITOR_IMAGE } from "../src/mcp/owner-seedream55-editor-tools.js";
import { getOwnerSeedream55EditorSourceProfile } from "../src/application/owner-seedream55-editor-source-profile.js";

const ATTEMPT = "link_seedream55_editor_sdk_0123456789";
const ORIGINAL = "seedream55_editor_original_00000000-0000-4000-8000-000000000001";
const RESULT = "seedream55_editor_result_00000000-0000-4000-8000-000000000001";
const SOURCE = getOwnerSeedream55EditorSourceProfile();

test("55 Editor SDK advertises seven isolated tools, exact controls and rejects bad generation before service", async () => {
  let generated = 0, reconciled = 0;
  const service = {
    async uploadOriginal() { throw new Error("unused"); }, async uploadDrawing() { throw new Error("unused"); },
    async generate(input: unknown) { generated += 1; const request = input as { parameters: Record<string, unknown> };
      return { status: "completed", variant: "seedream-5.5", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY",
        backend_acceptance: "UNPROVEN", profile_id: SOURCE.profile_id, profile_schema_hash: SOURCE.profile_schema_hash,
        request_fingerprint: `sha256:${"a".repeat(64)}`, cost_inputs: { batch_size: 1, resolution: request.parameters.resolution },
        result_id: RESULT, offset: 0, limit: 64, observed_total: 1,
        artifacts: [{ url: "https://r2.syntx.ai/editor/result.png", mime_type: "image/png", width: null, height: null,
          geometry_verified: false }], next_offset: null, has_more: false }; },
    async reconcile() { reconciled += 1; throw new Error("unused"); },
    async listRecoveries() { return []; }, async getResultPage() { throw new Error("unused"); }
  };
  const server = new McpServer({ name: "seedream55-editor-sdk-test", version: "1.0.0" });
  registerSyntxOwnerSeedream55EditorTools(server, { service } as never);
  const client = new Client({ name: "seedream55-editor-sdk-client", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  try {
    const advertised = (await client.listTools()).tools;
    assert.deepEqual(advertised.map((tool) => tool.name).sort(), [...OWNER_SEEDREAM55_EDITOR_TOOL_NAMES].sort());
    const source = await client.callTool({ name: SYNTX_GET_SEEDREAM55_EDITOR_PARAMETERS, arguments: {} });
    assert.equal(source.isError, undefined, JSON.stringify(source));
    assert.equal((source.structuredContent as { profile_schema_hash: string }).profile_schema_hash, SOURCE.profile_schema_hash);
    const invalidSource = await client.callTool({ name: SYNTX_GET_SEEDREAM55_EDITOR_PARAMETERS, arguments: { extra: true } });
    assert.equal(invalidSource.isError, true);
    const parameters = { aspect_ratio: "1:1", resolution: "2K", output_format: "png", background: "auto" };
    const args = { link_attempt_id: ATTEMPT, variant: "seedream-5.5", prompt: "synthetic edit", parameters,
      original_handle: ORIGINAL, drawing_handle: null };
    const good = await client.callTool({ name: SYNTX_OWNER_GENERATE_SEEDREAM55_EDITOR_IMAGE, arguments: args });
    assert.equal(good.isError, undefined, JSON.stringify(good));
    assert.equal(generated, 1);
    for (const bad of [
      { ...args, variant: "seedream-5.0-pro" },
      { ...args, parameters: { ...parameters, resolution: "3K" } },
      { ...args, parameters: { ...parameters, background: "transparent", output_format: "jpeg" } },
      { ...args, parameters: { ...parameters, n: 1 } },
      { ...args, file_url: "https://evil.invalid/image.png" }
    ]) {
      const rejected = await client.callTool({ name: SYNTX_OWNER_GENERATE_SEEDREAM55_EDITOR_IMAGE, arguments: bad });
      assert.equal(rejected.isError, true);
    }
    assert.equal(generated, 1);
    const wrongRecovery = await client.callTool({ name: SYNTX_OWNER_RECONCILE_SEEDREAM55_EDITOR_IMAGE,
      arguments: { link_attempt_id: ATTEMPT, recovery_id: "not-an-owned-handle" } });
    assert.equal(wrongRecovery.isError, true); assert.equal(reconciled, 0);
  } finally { await client.close(); await server.close(); }
});
