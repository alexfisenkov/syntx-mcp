import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getOwnerWan27VideoEditSourceProfile } from "../src/application/owner-wan27-videoedit-parameters.js";
import { OWNER_WAN27_VIDEOEDIT_IMAGE_POLICY } from "../src/application/owner-wan27-videoedit-image-policy.js";
import { OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY } from "../src/application/owner-wan27-videoedit-video-policy.js";
import { OWNER_WAN27_VIDEOEDIT_TOOL_NAMES, registerSyntxOwnerWan27VideoEditTools } from "../src/mcp/owner-wan27-videoedit-tools.js";

const ATTEMPT = "link_wan27_videoedit_tools_2173_0123456789";
const HANDLE = "wan27_videoedit_reference_11111111-1111-4111-8111-111111111111";
const RECOVERY = "wan27_videoedit_recovery_22222222-2222-4222-8222-222222222222";
const HEX = "a".repeat(64);
const SHA = `sha256:${HEX}`;
const D = { phase: "RESULT_GET", post_started: true, ack_known: true, history_status: "COMPLETE", owner_ack_status: "MATCHED",
  request_echo_status: "PARTIAL_UNPROVEN", history_get_calls: 1, result_get_calls: 1, result_status: "COMPLETE", gaps: [] };

function result() {
  const profile = getOwnerWan27VideoEditSourceProfile();
  return { status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", backend_acceptance: "UNPROVEN",
    provider_terminal_status: "UNPROVEN", cost_cap_enforced: false, output_count: "UNKNOWN", recovery_id: RECOVERY,
    model_id: "wan_27_videoedit", source_binding: { public_catalog_version: profile.source_pins.public_catalog_version,
      profile_sha256: profile.source_sha256, request_fingerprint: SHA, intent_fingerprint: SHA }, observed_artifact_count: 1,
    offset: 0, page_size: 64, artifacts: [{ object_index: 0, message_object_id: "wanobj2173", object_type: "video",
      object_url: "https://r2.syntx.ai/2173/output.mp4", mime_type: "video/mp4", mime_source: "URL_EXTENSION",
      message_id: "wanmsg2173", chat_uuid: "wanchat2173", model_id: "wan_27_videoedit" }], has_more: false,
    next_offset: null, diagnostic: D };
}

const PRESERVE = { link_attempt_id: ATTEMPT, model_id: "wan_27_videoedit", prompt: "A calm coastal scene.", resolution: "720P",
  aspect_ratio: "16:9", audio_setting: "auto", prompt_extend: false, seed: 0, duration_mode: "preserve_input", reference_handles: [HANDLE] };

async function setup(options: { readonly maxVideoFileBytes?: number } = {}) {
  const calls: Array<{ method: string; input: unknown }> = [];
  let uploaded: unknown;
  let generated: unknown = result();
  let generationError: unknown;
  let forwardedBytes: Uint8Array | undefined;
  const server = new McpServer({ name: "wan27-videoedit-2173", version: "1.0.0" });
  registerSyntxOwnerWan27VideoEditTools(server, { ...options,
    referenceService: { async uploadReference(input: unknown) {
      const row = input as { readonly bytes: Uint8Array; readonly model_id: string; readonly mime_type: string; readonly filename: string };
      forwardedBytes = row.bytes;
      calls.push({ method: "upload", input: { ...row, bytes: Buffer.from(row.bytes) } });
      return uploaded ?? { status: "uploaded", reference_handle: HANDLE, model_id: row.model_id,
        kind: row.mime_type.startsWith("video/") ? "video" : "image",
        mime_type: row.mime_type === "image/jpg" ? "image/jpeg" : row.mime_type, size: row.bytes.byteLength, sha256: HEX,
        width: row.mime_type.startsWith("video/") ? 320 : 300, height: 240,
        duration_seconds: row.mime_type.startsWith("video/") ? 4.25 : null,
        input_cost_duration_seconds: row.mime_type.startsWith("video/") ? 4.25 : null,
        expires_in_seconds: 900, input_confidence: "LOCAL_METADATA_ONLY_NO_DECODE" };
    } },
    generationService: {
      async generate(input: unknown) { calls.push({ method: "generate", input }); if (generationError) throw generationError; return generated; },
      async reconcile(input: unknown) { calls.push({ method: "reconcile", input }); return generated; },
      async listRecoveries(input: unknown) { calls.push({ method: "list", input }); return [{ recovery_id: RECOVERY, model_id: "wan_27_videoedit",
        created_at: "2026-10-17T00:00:00.000Z", status: "completed", observed_artifact_count: 1, diagnostic: D }]; },
      async getResultPage(input: unknown) { calls.push({ method: "page", input }); return generated; }
    } });
  const client = new Client({ name: "wan27-videoedit-2173-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, calls, forwardedBytes: () => forwardedBytes, setUploaded(value: unknown) { uploaded = value; }, setGenerated(value: unknown) { generated = value; },
    setGenerationError(value: unknown) { generationError = value; }, async close() { await client.close(); await server.close(); } };
}

test("registers exactly six WAN tools and returns the pinned source profile with honest local limits", async () => {
  const state = await setup({ maxVideoFileBytes: 80 * 1024 * 1024 });
  try {
    assert.deepEqual((await state.client.listTools()).tools.map(tool => tool.name), OWNER_WAN27_VIDEOEDIT_TOOL_NAMES);
    const response = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[0], arguments: { model_id: "wan_27_videoedit" } }) as CallToolResult;
    assert.equal(response.isError, undefined, JSON.stringify(response));
    const value = response.structuredContent as Record<string, any>;
    const profile = getOwnerWan27VideoEditSourceProfile();
    assert.equal(value.profile.model_id, "wan_27_videoedit");
    assert.equal(value.profile.source_sha256, profile.source_sha256);
    assert.equal(value.profile.runtime_usable, false);
    assert.equal(value.profile.backend_acceptance, "UNPROVEN");
    assert.equal(value.local_policy.max_image_file_bytes, OWNER_WAN27_VIDEOEDIT_IMAGE_POLICY.max_file_size_bytes);
    assert.equal(value.local_policy.max_video_file_bytes, 80 * 1024 * 1024);
    assert.equal(value.local_policy.video_duration_max_seconds, OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.max_duration_seconds);
    assert.equal(value.local_policy.video_duration_min_seconds, 2);
    assert.equal(value.local_policy.min_video_count, 1);
    assert.equal(value.local_policy.max_video_count, 1);
    assert.equal(value.local_policy.max_image_count, 4);
    assert.equal(value.local_policy.crop_performed, false);
    assert.equal(value.local_policy.pixel_decode, false);
    assert.deepEqual(state.calls, []);
  } finally { await state.close(); }
});

test("upload accepts canonical bytes, maps image/jpg to jpeg, and wipes the forwarded byte buffer", async () => {
  const state = await setup();
  try {
    const args = { link_attempt_id: ATTEMPT, model_id: "wan_27_videoedit", filename: "reference.jpg", mime_type: "image/jpg", content_base64: "AQID" };
    const response = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[1], arguments: args }) as CallToolResult;
    assert.equal(response.isError, undefined, JSON.stringify(response));
    assert.equal((response.structuredContent as Record<string, unknown>).mime_type, "image/jpeg");
    assert.deepEqual((state.calls[0]!.input as { bytes: Buffer }).bytes, Buffer.from([1, 2, 3]));
    assert.deepEqual(state.forwardedBytes(), Buffer.alloc(3));
    for (const patch of [{ content_base64: "AB==" }, { url: "https://private.invalid/u" }, { source_input_duration_seconds: 4.25 },
      { mime_type: "image/avif" }, { maxVideoFileBytes: 80 }, { model_id: "wan_27_r2v" }]) {
      const rejected = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[1], arguments: { ...args, ...patch } });
      assert.equal(rejected.isError, true, JSON.stringify(patch));
    }
    assert.equal(state.calls.length, 1);
  } finally { await state.close(); }
});

test("upload validates and preserves the trusted video duration for cost alias without exposing URLs", async () => {
  const state = await setup({ maxVideoFileBytes: 64 });
  try {
    const content = Buffer.from("owned-local-video").toString("base64");
    const response = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT,
      model_id: "wan_27_videoedit", filename: "trimmed.mp4", mime_type: "video/mp4", content_base64: content } }) as CallToolResult;
    assert.equal(response.isError, undefined, JSON.stringify(response));
    const data = response.structuredContent as Record<string, unknown>;
    assert.equal(data.kind, "video");
    assert.equal(data.duration_seconds, 4.25);
    assert.equal(data.input_cost_duration_seconds, 4.25);
    assert.equal(data.duration_seconds, data.input_cost_duration_seconds);
    assert.doesNotMatch(JSON.stringify(response), /https?:\/\//u);
    assert.equal((state.calls[0]!.input as { bytes: Uint8Array }).bytes.byteLength, Buffer.byteLength("owned-local-video"));
    state.setUploaded({ status: "uploaded", url: "https://private.invalid/secret", model_id: "wan_27_videoedit" });
    const invalid = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[1], arguments: { link_attempt_id: ATTEMPT,
      model_id: "wan_27_videoedit", filename: "trimmed.mp4", mime_type: "video/mp4", content_base64: content } });
    assert.match(JSON.stringify(invalid), /UPLOAD_OUTCOME_UNKNOWN/u);
    assert.doesNotMatch(JSON.stringify(invalid), /private\.invalid|secret/u);
    assert.equal(state.calls.length, 2);
  } finally { await state.close(); }
});

test("generation forwards only the explicit closed flat contract and rejects role, native, duration, and URL overrides", async () => {
  const state = await setup();
  try {
    const good = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[2], arguments: PRESERVE }) as CallToolResult;
    assert.equal(good.isError, undefined, JSON.stringify(good));
    assert.deepEqual(good.structuredContent, result());
    assert.deepEqual(state.calls[0], { method: "generate", input: {
      attemptId: ATTEMPT, model_id: "wan_27_videoedit", prompt: PRESERVE.prompt, resolution: "720P", aspect_ratio: "16:9",
      audio_setting: "auto", prompt_extend: false, seed: 0, duration_mode: "preserve_input", reference_handles: [HANDLE]
    } });
    for (const patch of [{ native_audio: true }, { source_input_duration_seconds: 4.25 }, { duration: 4.25 }, { cost_parameters: {} },
      { file_urls: [] }, { role: "video" }, { url: "https://private.invalid/u" }, { custom_video_duration: 3 },
      { duration_mode: "custom" }, { duration_mode: "custom", custom_video_duration: 11 },
      { duration_mode: "custom", custom_video_duration: 1 }, { audio_setting: "native" }, { prompt: "   " }]) {
      const rejected = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[2], arguments: { ...PRESERVE, ...patch } });
      assert.equal(rejected.isError, true, JSON.stringify(patch));
    }
    assert.equal(state.calls.length, 1);
  } finally { await state.close(); }
});

test("custom duration is present only for custom mode and an uncertain generation keeps its recovery handle", async () => {
  const state = await setup();
  try {
    const custom = { ...PRESERVE, duration_mode: "custom", custom_video_duration: 3 };
    const good = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[2], arguments: custom });
    assert.equal(good.isError, undefined, JSON.stringify(good));
    assert.deepEqual(state.calls[0]!.input, { attemptId: ATTEMPT, model_id: "wan_27_videoedit", prompt: PRESERVE.prompt,
      resolution: "720P", aspect_ratio: "16:9", audio_setting: "auto", prompt_extend: false, seed: 0,
      duration_mode: "custom", custom_video_duration: 3, reference_handles: [HANDLE] });
    state.setGenerationError(Object.assign(new Error("private authorization token"), { code: "OUTCOME_UNKNOWN", recovery_id: RECOVERY }));
    const unknown = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[2], arguments: PRESERVE });
    assert.match(JSON.stringify(unknown), /OUTCOME_UNKNOWN/u);
    assert.match(JSON.stringify(unknown), /wan27_videoedit_recovery_/u);
    assert.doesNotMatch(JSON.stringify(unknown), /authorization|token/u);
    const reconciled = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[3], arguments: { link_attempt_id: ATTEMPT, recovery_id: RECOVERY } });
    const listed = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[4], arguments: { link_attempt_id: ATTEMPT, limit: 5 } });
    const page = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[5], arguments: { link_attempt_id: ATTEMPT, recovery_id: RECOVERY, offset: 0 } });
    assert.equal(reconciled.isError, undefined); assert.equal(listed.isError, undefined); assert.equal(page.isError, undefined);
    assert.deepEqual(state.calls.map(call => call.method), ["generate", "generate", "reconcile", "list", "page"]);
    assert.deepEqual(state.calls[2]!.input, { attemptId: ATTEMPT, recovery_id: RECOVERY });
    assert.deepEqual(state.calls[3]!.input, { attemptId: ATTEMPT, limit: 5 });
    assert.deepEqual(state.calls[4]!.input, { attemptId: ATTEMPT, recovery_id: RECOVERY, offset: 0 });
    for (const args of [{ link_attempt_id: ATTEMPT, recovery_id: "bad" }, { link_attempt_id: ATTEMPT, recovery_id: RECOVERY, offset: 4097 }]) {
      assert.equal((await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[5], arguments: args })).isError, true);
    }
    assert.equal(state.calls.length, 5);
  } finally { await state.close(); }
});

test("rejects result pages with a different model or profile pin as unknown rather than exposing them", async () => {
  const state = await setup();
  try {
    const profileMismatch = result();
    profileMismatch.source_binding.profile_sha256 = SHA;
    state.setGenerated(profileMismatch);
    const args = { link_attempt_id: ATTEMPT, recovery_id: RECOVERY };
    const wrongProfile = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[5], arguments: args });
    assert.equal(wrongProfile.isError, true);
    assert.match(JSON.stringify(wrongProfile), /OUTCOME_UNKNOWN/u);
    assert.doesNotMatch(JSON.stringify(wrongProfile), /r2\.syntx\.ai/u);

    const modelMismatch = { ...result(), model_id: "wan_27_r2v" };
    state.setGenerated(modelMismatch);
    const wrongModel = await state.client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[5], arguments: args });
    assert.equal(wrongModel.isError, true);
    assert.match(JSON.stringify(wrongModel), /OUTCOME_UNKNOWN/u);
    assert.doesNotMatch(JSON.stringify(wrongModel), /r2\.syntx\.ai/u);
  } finally { await state.close(); }
});
