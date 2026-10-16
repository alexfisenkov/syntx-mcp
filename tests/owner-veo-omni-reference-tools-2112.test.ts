import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerSyntxOwnerVeoOmniReferenceTools, OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES } from "../src/mcp/owner-veo-omni-reference-tools.js";
import { OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256 } from "../src/application/owner-veo-omni-reference-profile.js";

const ATTEMPT = "link_omni_reference_tools_2112_000001";
const HANDLE = "veo_omni_reference_11111111-1111-4111-8111-111111111111";
const RECOVERY = "veo_omni_reference_recovery_11111111-1111-4111-8111-111111111111";
const SHA = `sha256:${"a".repeat(64)}`;
const UPLOAD = Object.freeze({ status: "uploaded", reference_handle: HANDLE, model_id: "veo_omni", kind: "image",
  mime_type: "image/png", size: 3, sha256: "a".repeat(64), width: 1, height: 1, duration_seconds: null,
  expires_in_seconds: 900, input_confidence: "LOCAL_METADATA_ONLY_NO_DECODE" });
const DIAGNOSTIC = Object.freeze({ phase: "RESULT_GET", post_started: true, ack_known: true,
  history_status: "COMPLETE", owner_ack_status: "MATCHED", request_echo_status: "PARTIAL_UNPROVEN",
  history_get_calls: 1, result_get_calls: 1, result_status: "COMPLETE", gaps: [] });
const RESULT = Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
  provider_terminal_status: "UNPROVEN", cost_cap_enforced: false, output_count: "UNKNOWN", recovery_id: RECOVERY, model_id: "veo_omni",
  source_binding: { public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json",
    profile_sha256: OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256, request_fingerprint: SHA, intent_fingerprint: SHA }, observed_artifact_count: 1, offset: 0, page_size: 64,
  artifacts: [{ object_index: 0, message_object_id: "object-1", object_type: "video", object_url: "https://r2.syntx.ai/result.mp4",
    mime_type: "video/mp4", mime_source: "URL_EXTENSION", message_id: "message-1", chat_uuid: "chat-1", model_id: "veo_omni" }],
  has_more: false, next_offset: null, diagnostic: DIAGNOSTIC });

async function setup() {
  const calls: Array<{ method: string; input: unknown }> = [];
  let generationError: unknown, uploadOutput: unknown = UPLOAD, generationOutput: unknown = RESULT;
  let receivedBytes: Uint8Array | undefined;
  const server = new McpServer({ name: "omni-reference-tools", version: "1.0.0" });
  registerSyntxOwnerVeoOmniReferenceTools(server, {
    maxFileBytes: 64,
    referenceService: { async uploadReference(input: unknown) {
      const row = input as { bytes: Uint8Array };
      receivedBytes = row.bytes;
      calls.push({ method: "upload", input: { ...row, bytes: Buffer.from(row.bytes) } });
      return uploadOutput;
    } },
    generationService: {
      async generate(input: unknown) { calls.push({ method: "generate", input }); if (generationError) throw generationError; return generationOutput; },
      async reconcile(input: unknown) { calls.push({ method: "reconcile", input }); return RESULT; },
      async listRecoveries(input: unknown) { calls.push({ method: "list", input }); return [{ recovery_id: RECOVERY, model_id: "veo_omni",
        created_at: "2026-10-17T00:00:00.000Z", status: "completed", observed_artifact_count: 1, diagnostic: DIAGNOSTIC }]; },
      async getResultPage(input: unknown) { calls.push({ method: "page", input }); return RESULT; }
    }
  });
  const client = new Client({ name: "omni-reference-client", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, calls, setError(error: unknown) { generationError = error; }, setUpload(value: unknown) { uploadOutput = value; },
    setGeneration(value: unknown) { generationOutput = value; },
    receivedBytes: () => receivedBytes, close: async () => { await client.close(); await server.close(); } };
}
const BASE = { link_attempt_id: ATTEMPT, prompt: "Scene [[ref:1]]\nunder the stars.", input_type: "references", upscale: 3,
  aspect_ratio: "16:9", video_duration: 6, reference_handles: [HANDLE] };

test("Omni reference MCP lists six guarded tools and exposes static/local limits separately", async () => {
  const s = await setup();
  try {
    const tools = await s.client.listTools();
    assert.deepEqual(tools.tools.map((x) => x.name), OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES);
    assert.deepEqual(tools.tools.map((x) => x.annotations?.readOnlyHint), [true, false, false, true, true, true]);
    const r = await s.client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[0], arguments: {} }) as CallToolResult;
    assert.equal(r.isError, undefined, JSON.stringify(r));
    const source = r.structuredContent as { profile: { runtime_usable: boolean; public_limits: { max_file_size_bytes: number } }; local_policy: { max_file_bytes: number } };
    assert.equal(source.profile.runtime_usable, false);
    assert.equal(source.profile.public_limits.max_file_size_bytes, 1_048_576_000);
    assert.equal(source.local_policy.max_file_bytes, 64);
    assert.deepEqual(s.calls, []);
  } finally { await s.close(); }
});

test("Omni MCP upload decodes canonical base64, zeroes buffer and returns URL-free handle only", async () => {
  const s = await setup();
  try {
    const args = { link_attempt_id: ATTEMPT, filename: "source.png", mime_type: "image/png", content_base64: "AQID" };
    const r = await s.client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[1], arguments: args }) as CallToolResult;
    assert.equal(r.isError, undefined, JSON.stringify(r)); assert.deepEqual(r.structuredContent, UPLOAD);
    assert.deepEqual(s.calls[0], { method: "upload", input: { attemptId: ATTEMPT, filename: "source.png", mime_type: "image/png", bytes: Buffer.from([1, 2, 3]) } });
    assert.deepEqual(s.receivedBytes(), Buffer.alloc(3));
    for (const invalid of [{ ...args, content_base64: "AB==" }, { ...args, content_base64: "AQID\n" },
      { ...args, content_base64: Buffer.alloc(65).toString("base64") }, { ...args, maxFileBytes: 100 },
      { ...args, url: "https://r2.syntx.ai/input.png" }, { ...args, ffprobePath: "/operator-only" }]) {
      assert.equal((await s.client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[1], arguments: invalid })).isError, true);
    }
    assert.equal(s.calls.length, 1);
    s.setUpload({ ...UPLOAD, url: "https://r2.syntx.ai/private-upload.png" });
    const bad = await s.client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[1], arguments: args });
    assert.equal(bad.isError, true); assert.doesNotMatch(JSON.stringify(bad), /private-upload|https:/u);
  } finally { await s.close(); }
});

test("Omni MCP maps explicit ordered handles and rejects raw wire, defaults and invalid mentions before dispatch", async () => {
  const s = await setup();
  try {
    const r = await s.client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[2], arguments: BASE }) as CallToolResult;
    assert.equal(r.isError, undefined, JSON.stringify(r)); assert.deepEqual(r.structuredContent, RESULT);
    const { link_attempt_id, ...fields } = BASE;
    assert.deepEqual(s.calls[0], { method: "generate", input: { ...fields, attemptId: link_attempt_id } });
    for (const invalid of [{ ...BASE, mode: "video_ref" }, { ...BASE, file_urls: [] }, { ...BASE, model_id: "veo_omni" },
      { ...BASE, upscale: undefined }, { ...BASE, input_type: "text" }, { ...BASE, reference_handles: [HANDLE, HANDLE] },
      { ...BASE, prompt: "Look at [[ref:2]]" }, { ...BASE, prompt: "Look at <<<https://r2.syntx.ai/source.png>>>" }]) {
      assert.equal((await s.client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[2], arguments: invalid })).isError, true);
    }
    assert.equal(s.calls.length, 1);
  } finally { await s.close(); }
});

test("Omni MCP preserves unknown recovery without leaking errors and GET-only calls never generate", async () => {
  const s = await setup();
  try {
    s.setError(Object.assign(new Error("secret token at https://private.invalid"), { code: "OUTCOME_UNKNOWN", recovery_id: RECOVERY }));
    const unknown = await s.client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[2], arguments: BASE });
    assert.equal(unknown.isError, true); assert.match(JSON.stringify(unknown), /do not retry/u);
    assert.match(JSON.stringify(unknown), new RegExp(RECOVERY, "u")); assert.doesNotMatch(JSON.stringify(unknown), /secret|private\.invalid/u);
    for (const [idx, args] of [[3, { link_attempt_id: ATTEMPT, recovery_id: RECOVERY }], [4, { link_attempt_id: ATTEMPT, limit: 1 }],
      [5, { link_attempt_id: ATTEMPT, recovery_id: RECOVERY, offset: 0 }]] as const) {
      assert.equal((await s.client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[idx], arguments: args })).isError, undefined);
    }
    assert.deepEqual(s.calls.map((x) => x.method), ["generate", "reconcile", "list", "page"]);
    s.setError(Object.assign(new Error("secret"), { code: "evil-code-secret", recovery_id: RECOVERY }));
    const bad = await s.client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[2], arguments: BASE });
    assert.doesNotMatch(JSON.stringify(bad), /evil-code|secret|veo_omni_reference_recovery/u);
  } finally { await s.close(); }
});

test("Omni MCP malformed post-operation outputs retain uncertainty and reject source identity drift", async () => {
  const s = await setup();
  try {
    s.setGeneration({ ...RESULT, source_binding: { ...RESULT.source_binding, profile_sha256: SHA } });
    const bad = await s.client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[2], arguments: BASE });
    assert.equal(bad.isError, true); assert.match(JSON.stringify(bad), /OUTCOME_UNKNOWN/u);
    assert.match(JSON.stringify(bad), /do not retry/u); assert.match(JSON.stringify(bad), new RegExp(RECOVERY, "u"));
    s.setUpload({ ...UPLOAD, url: "https://r2.syntx.ai/private.png" });
    const upload = await s.client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, filename: "source.png", mime_type: "image/png", content_base64: "AQID"
    } });
    assert.match(JSON.stringify(upload), /UPLOAD_OUTCOME_UNKNOWN/u); assert.doesNotMatch(JSON.stringify(upload), /private\.png/u);
    s.setError(Object.assign(new Error("private raw error"), { code: "VALIDATION_REJECTED" }));
    const validation = await s.client.callTool({ name: OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[2], arguments: BASE });
    assert.match(JSON.stringify(validation), /VALIDATION_REJECTED/u); assert.doesNotMatch(JSON.stringify(validation), /private raw/u);
  } finally { await s.close(); }
});
