import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_SEEDANCE_EDITOR_TOOL_NAMES, type OwnerSeedanceEditorToolOptions } from "../src/mcp/owner-seedance-editor-tools.js";
import { SYNTX_SEEDANCE_EDITOR_SOURCE_TOOL_NAME } from "../src/mcp/seedance-editor-source-tool.js";

const ATTEMPT = "link_seedance_mcp_owner_0123456789abcdef";
const HANDLE = "seedance_editor_reference_00000000-0000-4000-8000-000000000001";
const RECOVERY = "seedance_editor_recovery_00000000-0000-4000-8000-000000000002";
const URL = "https://r2.syntx.ai/seedance-editor/hidden/result.mp4";
const COMPLETED = Object.freeze({
  status: "completed", recovery_id: RECOVERY, model_id: "seedance-2.5-editor",
  status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", provider_terminal_status: "UNPROVEN",
  backend_acceptance: "UNPROVEN", cost_cap_enforced: false, durability: "PROCESS_LOCAL_ONLY",
  observed_artifact_count: 1,
  artifacts: [Object.freeze({ object_index: 0, message_object_id: "object_001", object_type: "video", object_url: URL,
    mime_type: "video/mp4", message_id: "message_001", chat_uuid: "chat_001", model_id: "seedance-2.5-editor" })],
  gaps: []
});
const UNKNOWN = Object.freeze({ ...COMPLETED, status: "outcome_unknown", observed_artifact_count: 0, artifacts: [] });

function fixture(): { readonly calls: { upload: number; generate: number; reconcile: number; list: number; uploadBytes: string };
  readonly options: { readonly ownerSeedanceEditor: OwnerSeedanceEditorToolOptions } } {
  const calls = { upload: 0, generate: 0, reconcile: 0, list: 0, uploadBytes: "" };
  const referenceService = {
    async uploadReference(input: unknown) {
      assert.ok(input && typeof input === "object");
      const fields = input as Record<string, unknown>;
      calls.upload++; calls.uploadBytes = Buffer.from(fields.bytes as Uint8Array).toString("hex");
      return { status: "uploaded", reference_handle: HANDLE, model_id: "seedance-2.5-editor", kind: "video",
        mime_type: fields.mime_type, size: 3, sha256: "0123456789abcdef".repeat(4), width: 320, height: 240,
        duration_seconds: 4.25, expires_in_seconds: 900, input_confidence: "LOCAL_METADATA_ONLY_NO_DECODE" };
    }
  };
  const generationService = {
    async generate(input: unknown) {
      calls.generate++;
      assert.deepEqual(input, { attemptId: ATTEMPT, model_id: "seedance-2.5-editor", prompt: "move gently",
        resolution: "720p", reference_handle: HANDLE });
      return COMPLETED as unknown;
    },
    async reconcile(input: unknown) {
      calls.reconcile++; assert.deepEqual(input, { attemptId: ATTEMPT, recovery_id: RECOVERY }); return UNKNOWN as unknown;
    },
    async listRecoveries(input: unknown) {
      calls.list++; assert.deepEqual(input, { attemptId: ATTEMPT }); return [COMPLETED, UNKNOWN] as unknown as readonly unknown[];
    }
  };
  return { calls, options: { ownerSeedanceEditor: { referenceService, generationService } } };
}

async function withClient<T>(options: Record<string, unknown> | undefined, run: (client: Client) => Promise<T>): Promise<T> {
  const server = createMcpServer(createDefaultApplication(), options as never);
  const client = new Client({ name: "seedance-editor-mcp-2231", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try { await server.connect(serverTransport); await client.connect(clientTransport); return await run(client); }
  finally { await client.close(); await server.close(); }
}

test("source getter keeps historical static pins separate from the current UI wire observation", async () => {
  await withClient(undefined, async client => {
    const result = await client.callTool({ name: SYNTX_SEEDANCE_EDITOR_SOURCE_TOOL_NAME, arguments: {} });
    assert.equal(result.isError, undefined);
    const content = result.structuredContent as {
      network_access: boolean; paid_operations: boolean; dispatch_allowed: boolean;
      profile: { source_pins: { source_build_id: string }; form_initializer: { generate_audio: boolean } };
      current_ui_observation: { source: { build_id: string; form_sha256: string }; request: { settings: { generate_audio: boolean } };
        response: { http_status: number; accepted: string } };
    };
    assert.deepEqual([content.network_access, content.paid_operations, content.dispatch_allowed], [false, false, false]);
    assert.equal(content.profile.source_pins.source_build_id, "1792156098");
    assert.equal(content.profile.form_initializer.generate_audio, false);
    assert.equal(content.current_ui_observation.source.build_id, "1793202992");
    assert.equal(content.current_ui_observation.source.form_sha256,
      "sha256:118844ecf40ae5735cbabb0fc52f2d40531a29ebd1c11431ab3e97638fe938cd");
    assert.equal(content.current_ui_observation.request.settings.generate_audio, true);
    assert.equal(content.current_ui_observation.response.http_status, 400);
    assert.equal(content.current_ui_observation.response.accepted, "UNPROVEN");
  });
});

test("2231 default MCP omits Seedance Editor owner tools; explicit registration exposes exactly four", async () => {
  await withClient(undefined, async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.equal(names.some(name => (OWNER_SEEDANCE_EDITOR_TOOL_NAMES as readonly string[]).includes(name)), false);
  });
  const e = fixture();
  await withClient(e.options, async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.deepEqual(names.filter(name => (OWNER_SEEDANCE_EDITOR_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...OWNER_SEEDANCE_EDITOR_TOOL_NAMES].sort());

    const upload = await client.callTool({ name: OWNER_SEEDANCE_EDITOR_TOOL_NAMES[0], arguments: {
      link_attempt_id: ATTEMPT, model_id: "seedance-2.5-editor", filename: "source.mp4", mime_type: "video/mp4",
      content_base64: Buffer.from([1, 2, 3]).toString("base64")
    } });
    assert.equal(upload.isError, undefined, JSON.stringify(upload));
    assert.equal((upload.structuredContent as { reference_handle: string }).reference_handle, HANDLE);
    assert.equal("url" in (upload.structuredContent as object), false);
    assert.equal(e.calls.uploadBytes, "010203", "decoded bytes are passed to the local reference service");

    const generate = await client.callTool({ name: OWNER_SEEDANCE_EDITOR_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, model_id: "seedance-2.5-editor", prompt: "move gently", resolution: "720p", reference_handle: HANDLE
    } });
    assert.equal(generate.isError, undefined, JSON.stringify(generate));
    assert.deepEqual(generate.structuredContent, COMPLETED);
    const reconcile = await client.callTool({ name: OWNER_SEEDANCE_EDITOR_TOOL_NAMES[2], arguments: {
      link_attempt_id: ATTEMPT, recovery_id: RECOVERY
    } });
    assert.equal(reconcile.isError, undefined); assert.deepEqual(reconcile.structuredContent, UNKNOWN);
    const listed = await client.callTool({ name: OWNER_SEEDANCE_EDITOR_TOOL_NAMES[3], arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listed.isError, undefined); assert.deepEqual(listed.structuredContent, { recoveries: [COMPLETED, UNKNOWN] });
  });
  assert.deepEqual(e.calls, { upload: 1, generate: 1, reconcile: 1, list: 1, uploadBytes: "010203" });
});

test("2231 untrusted model IDs, handles, fields, and unsafe artifacts are rejected before service invocation", async () => {
  const e = fixture();
  await withClient(e.options, async client => {
    const badUpload = await client.callTool({ name: OWNER_SEEDANCE_EDITOR_TOOL_NAMES[0], arguments: {
      link_attempt_id: ATTEMPT, model_id: "seedance-2.5", filename: "source.mp4", mime_type: "video/mp4", content_base64: "AQID"
    } });
    assert.equal(badUpload.isError, true);
    const badGeneration = await client.callTool({ name: OWNER_SEEDANCE_EDITOR_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, model_id: "seedance-2.5-editor", prompt: "generate", resolution: "720p",
      reference_handle: "https://r2.syntx.ai/forged.mp4", url: URL
    } });
    assert.equal(badGeneration.isError, true);
  });
  assert.deepEqual(e.calls, { upload: 0, generate: 0, reconcile: 0, list: 0, uploadBytes: "" });

  const bad = fixture();
  bad.options.ownerSeedanceEditor.generationService.generate = async () => ({ ...COMPLETED,
    artifacts: [Object.freeze({ ...(COMPLETED.artifacts[0]!), object_url: "https://evil.example/video.mp4" })] });
  await withClient(bad.options, async client => {
    const result = await client.callTool({ name: OWNER_SEEDANCE_EDITOR_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, model_id: "seedance-2.5-editor", prompt: "generate", resolution: "720p", reference_handle: HANDLE
    } });
    assert.equal(result.isError, true); assert.equal(result.structuredContent, undefined);
    assert.equal(JSON.stringify(result).includes("evil.example"), false);
  });
});

test("2231 inconsistent completed and outcome_unknown snapshots are rejected without exposing artifact URLs", async () => {
  const invalidSnapshots = [
    Object.freeze({ ...COMPLETED, observed_artifact_count: 0, artifacts: [], gaps: [] }),
    Object.freeze({ ...COMPLETED, status: "outcome_unknown", gaps: ["GENERATION_OUTCOME_UNKNOWN"] })
  ];
  for (const snapshot of invalidSnapshots) {
    const e = fixture();
    e.options.ownerSeedanceEditor.generationService.generate = async () => snapshot;
    await withClient(e.options, async client => {
      const result = await client.callTool({ name: OWNER_SEEDANCE_EDITOR_TOOL_NAMES[1], arguments: {
        link_attempt_id: ATTEMPT, model_id: "seedance-2.5-editor", prompt: "generate", resolution: "720p", reference_handle: HANDLE
      } });
      assert.equal(result.isError, true); assert.equal(result.structuredContent, undefined);
      assert.equal(JSON.stringify(result).includes(URL), false);
    });
  }
});
