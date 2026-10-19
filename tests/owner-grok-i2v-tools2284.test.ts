import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  OWNER_GROK_I2V_TOOL_NAMES,
  registerSyntxOwnerGrokI2vTools
} from "../src/mcp/owner-grok-i2v-tools.js";

const ATTEMPT = "link_grok_i2v_owner_0123456789abcdef";
const HANDLE = "grok_i2v_reference_11111111-2222-4333-8444-555555555555";
const RECOVERY = "grok_i2v_recovery_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function outcome(model_id: "grok_i2v" | "grok_15_i2v" = "grok_15_i2v") {
  return { status: "outcome_unknown", recovery_id: RECOVERY, model_id,
    status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", provider_terminal_status: "UNPROVEN",
    backend_acceptance: "UNPROVEN", cost_cap_enforced: false, durability: "PROCESS_LOCAL_ONLY",
    observed_artifact_count: 0, artifacts: [], gaps: ["GENERATION_OUTCOME_UNKNOWN"] };
}
async function connect() {
  const calls: { uploads: unknown[]; generations: unknown[]; reconciles: unknown[]; lists: unknown[] } = {
    uploads: [], generations: [], reconciles: [], lists: []
  };
  const options = {
    referenceService: {
      async uploadReference(input: unknown) {
        const data = input as { attemptId: string; model_id: "grok_i2v" | "grok_15_i2v"; filename: string; mime_type: string; bytes: Uint8Array };
        calls.uploads.push({ ...data, bytes: Buffer.from(data.bytes) });
        return { status: "uploaded", reference_handle: HANDLE, model_id: data.model_id, media_type: "image",
          mime_type: data.mime_type, size: data.bytes.byteLength, sha256: createHash("sha256").update(data.bytes).digest("hex"), width: 16, height: 9,
          expires_in_seconds: 900, metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
          size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT", provider_acceptance: "UNPROVEN",
          upload_authority: false, generation_permit: false };
      }
    },
    generationService: {
      async generate(input: unknown) { calls.generations.push(input); return outcome(); },
      async reconcile(input: unknown) { calls.reconciles.push(input); return outcome(); },
      async listRecoveries(input: unknown) { calls.lists.push(input); return [outcome()]; }
    }
  };
  const server = new McpServer({ name: "grok-i2v-tools-test", version: "1" });
  registerSyntxOwnerGrokI2vTools(server, options);
  const client = new Client({ name: "grok-i2v-tools-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client, server, calls, close: async () => { await client.close(); await server.close(); } };
}

test("2284 registers exactly four owner-local Grok I2V tools", async () => {
  const env = await connect();
  try {
    const listed = await env.client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), OWNER_GROK_I2V_TOOL_NAMES);
    assert.equal(listed.tools.find((tool) => tool.name === OWNER_GROK_I2V_TOOL_NAMES[2])?.annotations?.readOnlyHint, true);
  } finally { await env.close(); }
});

test("2284 uploads a model-bound image without an aspect-ratio request field or URL output", async () => {
  const env = await connect();
  try {
    const result = await env.client.callTool({ name: OWNER_GROK_I2V_TOOL_NAMES[0], arguments: {
      link_attempt_id: ATTEMPT, model_id: "grok_i2v", filename: "frame.png", mime_type: "image/png", content_base64: "aGVsbG8="
    } });
    assert.equal(result.isError, undefined);
    const uploadContent = result.structuredContent as Record<string, unknown> | undefined;
    assert.equal(uploadContent?.reference_handle, HANDLE);
    assert.deepEqual(Object.keys(uploadContent ?? {}).sort(), ["status", "reference_handle", "model_id", "media_type", "mime_type",
      "size", "sha256", "width", "height", "expires_in_seconds", "metadata_confidence", "size_limit_confidence",
      "provider_acceptance", "upload_authority", "generation_permit"].sort());
    const call = env.calls.uploads[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(call).sort(), ["attemptId", "bytes", "filename", "mime_type", "model_id"].sort());
    assert.equal(call.model_id, "grok_i2v");
    assert.equal(call.aspect_ratio, undefined);
    assert.deepEqual(Buffer.from(call.bytes as Uint8Array), Buffer.from("hello"));

    const invalid = await env.client.callTool({ name: OWNER_GROK_I2V_TOOL_NAMES[0], arguments: {
      link_attempt_id: ATTEMPT, model_id: "grok_15_i2v", filename: "frame.png", mime_type: "image/png",
      content_base64: "aGVsbG8=", aspect_ratio: "1:1"
    } });
    assert.equal(invalid.isError, true);
    assert.equal(env.calls.uploads.length, 1);
  } finally { await env.close(); }
});

test("2284 generation validates the selected model matrix, rejects seed, and calls the owned service", async () => {
  const env = await connect();
  try {
    const generated = await env.client.callTool({ name: OWNER_GROK_I2V_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, model_id: "grok_15_i2v", prompt: "A slow camera move.", aspect_ratio: "4:3",
      video_duration: 15, resolution: "720p", reference_handle: HANDLE
    } });
    assert.equal(generated.isError, undefined);
    assert.equal((generated.structuredContent as Record<string, unknown> | undefined)?.status, "outcome_unknown");
    const request = env.calls.generations[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(request).sort(), ["attemptId", "model_id", "prompt", "aspect_ratio", "video_duration", "resolution", "reference_handle"].sort());
    assert.equal(request.attemptId, ATTEMPT); assert.equal(request.model_id, "grok_15_i2v");
    assert.equal("seed" in request, false);

    const invalidInputs = [
      { model_id: "grok_i2v", aspect_ratio: "9:16", video_duration: 6 },
      { model_id: "grok_i2v", aspect_ratio: "16:9", video_duration: 8 },
      { model_id: "grok_15_i2v", aspect_ratio: "4:3", video_duration: 16 },
      { model_id: "grok_15_i2v", aspect_ratio: "4:3", video_duration: 10, prompt: "x".repeat(2_001) },
      { model_id: "grok_i2v", aspect_ratio: "16:9", video_duration: 6, seed: null }
    ];
    for (const invalid of invalidInputs) {
      const result = await env.client.callTool({ name: OWNER_GROK_I2V_TOOL_NAMES[1], arguments: {
        link_attempt_id: ATTEMPT, prompt: "A valid prompt.", resolution: "480p", reference_handle: HANDLE, ...invalid
      } });
      assert.equal(result.isError, true);
    }
    assert.equal(env.calls.generations.length, 1);
  } finally { await env.close(); }
});

test("2284 result and recovery-list tools only call their read/reconcile service methods", async () => {
  const env = await connect();
  try {
    const result = await env.client.callTool({ name: OWNER_GROK_I2V_TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, recovery_id: RECOVERY } });
    const list = await env.client.callTool({ name: OWNER_GROK_I2V_TOOL_NAMES[3], arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(result.isError, undefined); assert.equal(list.isError, undefined);
    assert.deepEqual(env.calls.reconciles, [{ attemptId: ATTEMPT, recovery_id: RECOVERY }]);
    assert.deepEqual(env.calls.lists, [{ attemptId: ATTEMPT }]);
    assert.equal(env.calls.generations.length, 0);
  } finally { await env.close(); }
});
