import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getOwnerKling4SourceProfile } from "../src/application/owner-kling4-parameters.js";
import { registerSyntxOwnerKling4Tools, OWNER_KLING4_TOOL_NAMES } from "../src/mcp/owner-kling4-tools.js";

const ATTEMPT = "link_kling4_tools_2146_0123456789";
const HANDLE = "kling4_reference_11111111-1111-4111-8111-111111111111";
const RECOVERY = "kling4_recovery_11111111-1111-4111-8111-111111111111";
const SHA = `sha256:${"a".repeat(64)}`;
const MODEL = "kling_4_keyframes" as const;
const D = { phase: "RESULT_GET", post_started: true, ack_known: true, history_status: "COMPLETE", owner_ack_status: "MATCHED",
  request_echo_status: "PARTIAL_UNPROVEN", history_get_calls: 1, result_get_calls: 1, result_status: "COMPLETE", gaps: [] };
function result(model: "kling_4_keyframes" | "kling_4_omni" = MODEL) {
  const profile = getOwnerKling4SourceProfile(model);
  return { status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
    provider_terminal_status: "UNPROVEN", cost_cap_enforced: false, output_count: "UNKNOWN", recovery_id: RECOVERY, model_id: model,
    source_binding: { public_catalog_version: profile.source_catalog_version, profile_sha256: profile.source_sha256,
      request_fingerprint: SHA, intent_fingerprint: SHA }, observed_artifact_count: 1, offset: 0, page_size: 64,
    artifacts: [{ object_index: 0, message_object_id: "object2146", object_type: "video", object_url: "https://r2.syntx.ai/2146/result.mp4",
      mime_type: "video/mp4", mime_source: "URL_EXTENSION", message_id: "message2146", chat_uuid: "chat2146", model_id: model }],
    has_more: false, next_offset: null, diagnostic: D };
}
const INPUT = { link_attempt_id: ATTEMPT, model_id: MODEL, version: "4.0", mode: "standart", aspect_ratio: "16:9",
  video_duration: 3, native_audio: true, prompt: "Frame [[ref:1]]\nbecomes a video.", reference_handles: [HANDLE] };
async function setup() {
  const calls: Array<{ method: string; input: unknown }> = [];
  let output: unknown = result(), failure: unknown, uploadOutput: unknown, bytes: Uint8Array | undefined;
  const server = new McpServer({ name: "k4-2146", version: "1.0.0" });
  registerSyntxOwnerKling4Tools(server, { maxVideoFileBytes: 64,
    referenceService: { async uploadReference(input: unknown) {
      const row = input as { bytes: Uint8Array; model_id: string; mime_type: string };
      calls.push({ method: "upload", input: { ...row, bytes: Buffer.from(row.bytes) } }); bytes = row.bytes;
      return uploadOutput ?? { status: "uploaded", reference_handle: HANDLE, model_id: row.model_id, kind: "image",
        mime_type: "image/png", size: row.bytes.byteLength, sha256: "a".repeat(64), width: 300, height: 300,
        duration_seconds: null, input_cost_duration_seconds: null, expires_in_seconds: 900, input_confidence: "LOCAL_METADATA_ONLY_NO_DECODE" };
    } }, generationService: {
      async generate(input: unknown) { calls.push({ method: "generate", input }); if (failure) throw failure; return output; },
      async reconcile(input: unknown) { calls.push({ method: "reconcile", input }); return output; },
      async listRecoveries(input: unknown) { calls.push({ method: "list", input }); return [{ recovery_id: RECOVERY, model_id: MODEL,
        created_at: "2026-10-17T00:00:00.000Z", status: "completed", observed_artifact_count: 1, diagnostic: D }]; },
      async getResultPage(input: unknown) { calls.push({ method: "page", input }); return output; }
    } });
  const client = new Client({ name: "k4-2146-client", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, calls, bytes: () => bytes, setOutput(value: unknown) { output = value; }, setError(value: unknown) { failure = value; },
    setUpload(value: unknown) { uploadOutput = value; }, async close() { await client.close(); await server.close(); } };
}

test("K4 MCP exposes six tools and both pinned models with separate local resource policy", async () => {
  const s = await setup();
  try {
    assert.deepEqual((await s.client.listTools()).tools.map(x => x.name), OWNER_KLING4_TOOL_NAMES);
    for (const model_id of [MODEL, "kling_4_omni"] as const) {
      const response = await s.client.callTool({ name: OWNER_KLING4_TOOL_NAMES[0], arguments: { model_id } }) as CallToolResult;
      assert.equal(response.isError, undefined, JSON.stringify(response));
      const data = response.structuredContent as { profile: { model_id: string; runtime_usable: boolean }; local_policy: { max_image_file_bytes: number; max_video_file_bytes: number } };
      assert.equal(data.profile.model_id, model_id); assert.equal(data.profile.runtime_usable, false);
      assert.equal(data.local_policy.max_image_file_bytes, 30 * 1024 * 1024); assert.equal(data.local_policy.max_video_file_bytes, 64);
    }
    assert.deepEqual(s.calls, []);
  } finally { await s.close(); }
});

test("K4 MCP upload copies canonical base64, enforces branches and wipes received bytes", async () => {
  const s = await setup();
  try {
    const args = { link_attempt_id: ATTEMPT, model_id: MODEL, filename: "source.png", mime_type: "image/png", content_base64: "AQID" };
    const good = await s.client.callTool({ name: OWNER_KLING4_TOOL_NAMES[1], arguments: args });
    assert.equal(good.isError, undefined, JSON.stringify(good)); assert.deepEqual(s.bytes(), Buffer.alloc(3));
    for (const patch of [{ content_base64: "AB==" }, { url: "https://private.invalid" }, { ffprobePath: "/operator-only" },
      { mime_type: "image/webp" }, { mime_type: "video/mp4" }, { maxVideoFileBytes: 999 }]) {
      assert.equal((await s.client.callTool({ name: OWNER_KLING4_TOOL_NAMES[1], arguments: { ...args, ...patch } })).isError, true);
    }
    assert.equal(s.calls.length, 1);
    s.setUpload({ status: "uploaded", url: "https://private.invalid/upload" });
    const invalid = await s.client.callTool({ name: OWNER_KLING4_TOOL_NAMES[1], arguments: args });
    assert.match(JSON.stringify(invalid), /UPLOAD_OUTCOME_UNKNOWN/u); assert.doesNotMatch(JSON.stringify(invalid), /private\.invalid/u);
  } finally { await s.close(); }
});

test("K4 MCP forwards explicit controls, rejects stale settings and binds output model/profile", async () => {
  const s = await setup();
  try {
    const good = await s.client.callTool({ name: OWNER_KLING4_TOOL_NAMES[2], arguments: INPUT }) as CallToolResult;
    assert.equal(good.isError, undefined, JSON.stringify(good)); assert.deepEqual(good.structuredContent, result());
    const { link_attempt_id, ...fields } = INPUT;
    assert.deepEqual(s.calls[0], { method: "generate", input: { ...fields, attemptId: link_attempt_id } });
    for (const patch of [{ native_audio: false }, { version: "3.0" }, { temperature: 0.5 }, { file_urls: [] },
      { duration: 1 }, { reference_handles: [HANDLE, HANDLE] }, { prompt: "[[ref:2]]" }]) {
      assert.equal((await s.client.callTool({ name: OWNER_KLING4_TOOL_NAMES[2], arguments: { ...INPUT, ...patch } })).isError, true);
    }
    assert.equal(s.calls.length, 1);
    s.setOutput(result("kling_4_omni"));
    assert.match(JSON.stringify(await s.client.callTool({ name: OWNER_KLING4_TOOL_NAMES[2], arguments: INPUT })), /OUTCOME_UNKNOWN/u);
    const omni = { ...INPUT, model_id: "kling_4_omni", native_audio: false };
    assert.equal((await s.client.callTool({ name: OWNER_KLING4_TOOL_NAMES[2], arguments: omni })).isError, undefined);
    const wrongPin = result(); wrongPin.source_binding.profile_sha256 = SHA; s.setOutput(wrongPin);
    assert.match(JSON.stringify(await s.client.callTool({ name: OWNER_KLING4_TOOL_NAMES[2], arguments: INPUT })), /OUTCOME_UNKNOWN/u);
  } finally { await s.close(); }
});

test("K4 MCP preserves unknown recovery and only GET paths are used for reconciliation", async () => {
  const s = await setup();
  try {
    s.setError(Object.assign(new Error("private token secret"), { code: "OUTCOME_UNKNOWN", recovery_id: RECOVERY }));
    const unknown = await s.client.callTool({ name: OWNER_KLING4_TOOL_NAMES[2], arguments: INPUT });
    assert.match(JSON.stringify(unknown), /do not retry/u); assert.match(JSON.stringify(unknown), /kling4_recovery_/u);
    assert.doesNotMatch(JSON.stringify(unknown), /private token|secret/u);
    for (const index of [3, 4, 5] as const) {
      const args = index === 4 ? { link_attempt_id: ATTEMPT } : { link_attempt_id: ATTEMPT, recovery_id: RECOVERY };
      assert.equal((await s.client.callTool({ name: OWNER_KLING4_TOOL_NAMES[index], arguments: args })).isError, undefined);
    }
    assert.deepEqual(s.calls.map(x => x.method), ["generate", "reconcile", "list", "page"]);
  } finally { await s.close(); }
});
