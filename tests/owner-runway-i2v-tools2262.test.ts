import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  OWNER_RUNWAY_I2V_TOOL_NAMES,
  type OwnerRunwayI2vToolOptions
} from "../src/mcp/owner-runway-i2v-tools.js";

const ATTEMPT = "link_runway_tools_2262_0123456789abcdef";
const MODELS = ["4genfirstframeimage", "turbo4genfirstframeimage"] as const;
const HANDLE = "runway_i2v_reference_00000000-0000-4000-8000-000000000001";
const RECOVERY = "runway_i2v_recovery_00000000-0000-4000-8000-000000000002";
const URL = "https://r2.syntx.ai/runway2262/result.mp4";
const UPLOAD = Object.freeze({ status: "uploaded", reference_handle: HANDLE, model_id: MODELS[0], aspect_ratio: "1:1",
  media_type: "image", mime_type: "image/png", size: 3, sha256: "0123456789abcdef".repeat(4), width: 1, height: 1,
  expires_in_seconds: 900, metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
  provider_acceptance: "UNPROVEN", upload_authority: false, generation_permit: false });
const COMPLETED = Object.freeze({ status: "completed", recovery_id: RECOVERY, model_id: MODELS[0],
  status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", provider_terminal_status: "UNPROVEN", backend_acceptance: "UNPROVEN",
  cost_cap_enforced: false, durability: "PROCESS_LOCAL_ONLY", observed_artifact_count: 1,
  artifacts: [Object.freeze({ object_index: 0, message_object_id: "object2262", object_type: "video", object_url: URL,
    mime_type: "video/mp4", message_id: "message2262", chat_uuid: "chat2262", model_id: MODELS[0] })], gaps: [] });
const UNKNOWN = Object.freeze({ ...COMPLETED, status: "outcome_unknown", observed_artifact_count: 0, artifacts: [], gaps: ["GENERATION_OUTCOME_UNKNOWN"] });

function fixture(): { calls: { upload: number; generate: number; reconcile: number; list: number; bytes: string; generateInput: unknown };
  options: { ownerRunwayI2v: OwnerRunwayI2vToolOptions } } {
  const calls = { upload: 0, generate: 0, reconcile: 0, list: 0, bytes: "", generateInput: undefined as unknown };
  const referenceService = { async uploadReference(input: unknown) {
    const value = input as Record<string, unknown>;
    calls.upload += 1; calls.bytes = Buffer.from(value.bytes as Uint8Array).toString("hex");
    return { ...UPLOAD, model_id: value.model_id, aspect_ratio: value.aspect_ratio, mime_type: value.mime_type,
      size: (value.bytes as Uint8Array).byteLength, sha256: createHash("sha256").update(value.bytes as Uint8Array).digest("hex") };
  } };
  const generationService = {
    async generate(input: unknown) {
      const data = input as { model_id: string };
      calls.generate += 1; calls.generateInput = input;
      return { ...COMPLETED, model_id: data.model_id,
        artifacts: [Object.freeze({ ...COMPLETED.artifacts[0], model_id: data.model_id })] };
    },
    async reconcile(input: unknown) { calls.reconcile += 1; assert.deepEqual(input, { attemptId: ATTEMPT, recovery_id: RECOVERY }); return UNKNOWN; },
    async listRecoveries(input: unknown) { calls.list += 1; assert.deepEqual(input, { attemptId: ATTEMPT }); return [COMPLETED, UNKNOWN]; }
  };
  return { calls, options: { ownerRunwayI2v: { referenceService, generationService } } };
}

async function withClient<T>(options: Record<string, unknown> | undefined, run: (client: Client) => Promise<T>): Promise<T> {
  const server = createMcpServer(createDefaultApplication(), options as never);
  const client = new Client({ name: "runway-i2v-tools-2262", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try { await server.connect(serverTransport); await client.connect(clientTransport); return await run(client); }
  finally { await client.close(); await server.close(); }
}

test("default MCP omits Runway I2V tools; explicit owner composition exposes only the four scoped tools", async () => {
  await withClient(undefined, async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.equal(names.some(name => (OWNER_RUNWAY_I2V_TOOL_NAMES as readonly string[]).includes(name)), false);
  });
  const value = fixture();
  await withClient(value.options as unknown as Record<string, unknown>, async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.deepEqual(names.filter(name => (OWNER_RUNWAY_I2V_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...OWNER_RUNWAY_I2V_TOOL_NAMES].sort());

    for (const model_id of MODELS) {
      const upload = await client.callTool({ name: OWNER_RUNWAY_I2V_TOOL_NAMES[0], arguments: {
        link_attempt_id: ATTEMPT, model_id, aspect_ratio: "1:1", filename: "first.png", mime_type: "image/png",
        content_base64: Buffer.from([1, 2, 3]).toString("base64")
      } });
      assert.equal(upload.isError, undefined, JSON.stringify(upload));
      assert.equal((upload.structuredContent as { model_id: string }).model_id, model_id);
      assert.equal((upload.structuredContent as { aspect_ratio: string }).aspect_ratio, "1:1");
      assert.equal("url" in (upload.structuredContent as object), false);

      const generated = await client.callTool({ name: OWNER_RUNWAY_I2V_TOOL_NAMES[1], arguments: {
        link_attempt_id: ATTEMPT, model_id, prompt: "A still frame begins to move.", aspect_ratio: "1:1",
        video_duration: 5, seed: null, reference_handle: HANDLE
      } });
      assert.equal(generated.isError, undefined, JSON.stringify(generated));
      assert.deepEqual(generated.structuredContent, { ...COMPLETED, model_id,
        artifacts: [Object.freeze({ ...COMPLETED.artifacts[0], model_id })] });
      assert.deepEqual(value.calls.generateInput, { attemptId: ATTEMPT, model_id, prompt: "A still frame begins to move.",
        aspect_ratio: "1:1", video_duration: 5, seed: null, reference_handle: HANDLE });
    }

    const recovered = await client.callTool({ name: OWNER_RUNWAY_I2V_TOOL_NAMES[2], arguments: {
      link_attempt_id: ATTEMPT, recovery_id: RECOVERY
    } });
    assert.equal(recovered.isError, undefined); assert.equal((recovered.structuredContent as {status:string})?.status, "outcome_unknown");
    const listed = await client.callTool({ name: OWNER_RUNWAY_I2V_TOOL_NAMES[3], arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(listed.isError, undefined); assert.deepEqual(listed.structuredContent, { recoveries: [COMPLETED, UNKNOWN] });
  });
  assert.equal(value.calls.upload, 2);
  assert.equal(value.calls.generate, 2);
  assert.equal(value.calls.reconcile, 1);
  assert.equal(value.calls.list, 1);
  assert.equal(value.calls.bytes, "010203");
});

test("strict upload and generation schemas reject wrong model/format/ratio/duration/seed before service calls", async () => {
  const value = fixture();
  await withClient(value.options as unknown as Record<string, unknown>, async client => {
    for (const arguments_ of [
      { link_attempt_id: ATTEMPT, model_id: "runway_frames", aspect_ratio: "1:1", filename: "first.png", mime_type: "image/png", content_base64: "AQID" },
      { link_attempt_id: ATTEMPT, model_id: MODELS[0], aspect_ratio: "2:1", filename: "first.png", mime_type: "image/png", content_base64: "AQID" },
      { link_attempt_id: ATTEMPT, model_id: MODELS[0], aspect_ratio: "1:1", filename: "../first.png", mime_type: "image/png", content_base64: "AQID" },
      { link_attempt_id: ATTEMPT, model_id: MODELS[0], aspect_ratio: "1:1", filename: "first.avif", mime_type: "image/avif", content_base64: "AQID" },
      { link_attempt_id: ATTEMPT, model_id: MODELS[0], aspect_ratio: "1:1", filename: "first.png", mime_type: "image/png", content_base64: "AQI" }
    ]) {
      const result = await client.callTool({ name: OWNER_RUNWAY_I2V_TOOL_NAMES[0], arguments: arguments_ });
      assert.equal(result.isError, true);
    }
    for (const overrides of [
      { model_id: "runway_frames" }, { aspect_ratio: "2:1" }, { video_duration: 8 }, { seed: 0 }, { url: URL }
    ]) {
      const result = await client.callTool({ name: OWNER_RUNWAY_I2V_TOOL_NAMES[1], arguments: {
        link_attempt_id: ATTEMPT, model_id: MODELS[0], prompt: "move", aspect_ratio: "1:1", video_duration: 5,
        seed: null, reference_handle: HANDLE, ...overrides
      } });
      assert.equal(result.isError, true);
    }
  });
  assert.deepEqual(value.calls, { upload: 0, generate: 0, reconcile: 0, list: 0, bytes: "", generateInput: undefined });
});

test("MCP response schemas suppress unsafe or inconsistent result URLs", async () => {
  const value = fixture();
  value.options.ownerRunwayI2v.generationService.generate = async () => ({ ...COMPLETED,
    artifacts: [Object.freeze({ ...COMPLETED.artifacts[0], object_url: "https://evil.example/secret.mp4" })] });
  await withClient(value.options as unknown as Record<string, unknown>, async client => {
    const result = await client.callTool({ name: OWNER_RUNWAY_I2V_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, model_id: MODELS[0], prompt: "move", aspect_ratio: "1:1", video_duration: 5,
      seed: null, reference_handle: HANDLE
    } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    assert.equal(JSON.stringify(result).includes("evil.example"), false);
  });
});

test("generation response for a different allowed model is rejected against the selected model", async () => {
  const value = fixture();
  value.options.ownerRunwayI2v.generationService.generate = async () => { value.calls.generate++; return COMPLETED; };
  await withClient(value.options as unknown as Record<string, unknown>, async client => {
    const result = await client.callTool({ name: OWNER_RUNWAY_I2V_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, model_id: MODELS[1], prompt: "move", aspect_ratio: "1:1", video_duration: 5,
      seed: null, reference_handle: HANDLE
    } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    assert.equal(JSON.stringify(result).includes(URL), false);
  });
  assert.equal(value.calls.generate, 1);
});

test("upload response with another model/aspect tuple is rejected", async () => {
  const value = fixture();
  value.options.ownerRunwayI2v.referenceService.uploadReference = async () => ({ ...UPLOAD, model_id: MODELS[1], aspect_ratio: "16:9" });
  await withClient(value.options as unknown as Record<string, unknown>, async client => {
    const result = await client.callTool({ name: OWNER_RUNWAY_I2V_TOOL_NAMES[0], arguments: {
      link_attempt_id: ATTEMPT, model_id: MODELS[0], aspect_ratio: "1:1", filename: "frame.png", mime_type: "image/png",
      content_base64: Buffer.from([1, 2, 3]).toString("base64")
    } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    assert.equal(JSON.stringify(result).includes(HANDLE), false);
  });
});
