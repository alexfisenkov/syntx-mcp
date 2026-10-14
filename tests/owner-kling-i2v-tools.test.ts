import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer, type OwnerKlingI2vServiceComposition } from "../src/mcp/server.js";
import { OwnerKlingI2VImageReferenceServiceError } from "../src/application/owner-kling-i2v-reference-service.js";
import { OwnerKlingI2vGenerationServiceError } from "../src/application/owner-kling-i2v-generation-service.js";
import {
  OWNER_KLING_I2V_TOOL_NAMES,
  SYNTX_OWNER_GENERATE_KLING_I2V_VIDEO_TOOL_NAME,
  SYNTX_OWNER_GET_KLING_I2V_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_LIST_KLING_I2V_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_KLING_I2V_VIDEO_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_KLING_I2V_IMAGE_TOOL_NAME,
  registerSyntxOwnerKlingI2vTools
} from "../src/mcp/owner-kling-i2v-tools.js";
import { getOwnerKlingI2vParametersSource } from "../src/application/owner-kling-i2v-parameters.js";

const ATTEMPT = "link_kling_i2v_tools_000000000001";
const IMAGE_HANDLE = "kling_i2v_image_123e4567-e89b-42d3-a456-426614174000";
const RECOVERY_ID = "kling_i2v_generation_recovery_123e4567-e89b-42d3-a456-426614174000";
const ARTIFACT_URL = "https://r2.syntx.ai/kling-i2v-tools/result.mp4";

const SOURCE = getOwnerKlingI2vParametersSource();
const OUTPUT = Object.freeze({
  status: "completed" as const,
  status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY" as const,
  backend_acceptance: "UNPROVEN" as const,
  provider_terminal_status: "UNPROVEN" as const,
  model_id: "kling_image2video" as const,
  recovery_id: RECOVERY_ID,
  observed_artifact_count: 1,
  artifacts: Object.freeze([{ url: ARTIFACT_URL, mime_type: "video/mp4" as const }]),
  diagnostic: Object.freeze({ post_started: true, ack_known: true, history_get_calls: 1, result_get_calls: 1, gaps: Object.freeze([]) })
});

async function setup(options: { uploadError?: Error; generationError?: Error } = {}) {
  const calls: Array<{ method: string; input: unknown; signal?: AbortSignal }> = [];
  const referenceService = {
    async upload(input: unknown, signal?: AbortSignal) {
      calls.push({ method: "upload", input, ...(signal ? { signal } : {}) });
      if (options.uploadError) throw options.uploadError;
      return { status: "uploaded", image_handle: IMAGE_HANDLE, model_id: "kling_image2video", mime_type: "image/png",
        size: 321, sha256: "a".repeat(64), width: 300, height: 300, expires_in_seconds: 900,
        input_acceptance: "SOURCE_FORMAT_DECLARED_PROVIDER_ACCEPTANCE_UNVERIFIED" } as const;
    }
  };
  const generationService = {
    getParametersSource() { calls.push({ method: "source", input: {} }); return SOURCE; },
    async generate(input: unknown, signal?: AbortSignal) {
      calls.push({ method: "generate", input, ...(signal ? { signal } : {}) });
      if (options.generationError) throw options.generationError;
      return OUTPUT;
    },
    async reconcile(input: unknown, signal?: AbortSignal) {
      calls.push({ method: "reconcile", input, ...(signal ? { signal } : {}) }); return OUTPUT;
    },
    async list(input: unknown, signal?: AbortSignal) {
      calls.push({ method: "list", input, ...(signal ? { signal } : {}) });
      return [{ recovery_id: RECOVERY_ID, created_at: "2026-10-14T12:00:00.000Z", status: "completed" as const, observed_artifact_count: 1 }];
    }
  };
  const server = new McpServer({ name: "kling-i2v-sdk-test", version: "1.0.0" });
  registerSyntxOwnerKlingI2vTools(server, { referenceService, generationService });
  const client = new Client({ name: "kling-i2v-sdk-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { calls, client, referenceService, generationService,
    close: async () => { await client.close(); await server.close(); } };
}

test("Kling I2V tools expose source, opaque upload, and generation lifecycle through the SDK", async () => {
  const state = await setup();
  try {
    const listed = await state.client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...OWNER_KLING_I2V_TOOL_NAMES].sort());

    const source = await state.client.callTool({ name: SYNTX_OWNER_GET_KLING_I2V_PARAMETERS_TOOL_NAME, arguments: {} });
    assert.equal(source.isError, undefined);
    assert.equal((source.structuredContent as { model_id: string }).model_id, "kling_image2video");
    assert.equal((source.structuredContent as { dispatch_allowed: boolean }).dispatch_allowed, false);

    const uploaded = await state.client.callTool({ name: SYNTX_OWNER_UPLOAD_KLING_I2V_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, content_base64: "AQID", filename: "source.png", mime_type: "image/png"
    } });
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
    assert.equal((uploaded.structuredContent as { image_handle: string }).image_handle, IMAGE_HANDLE);
    assert.doesNotMatch(JSON.stringify(uploaded.structuredContent), /https?:\/\/|upload_context|provider_id/iu);

    const generated = await state.client.callTool({ name: SYNTX_OWNER_GENERATE_KLING_I2V_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, image_handle: IMAGE_HANDLE, model_id: "kling_image2video", prompt: "A red kite in the wind.",
      version: "3.0", mode: "hd", video_duration: 5, native_audio: false, temperature: 0.6, multi_shots: false
    } });
    assert.equal(generated.isError, undefined, JSON.stringify(generated));
    assert.deepEqual(state.calls.find((call) => call.method === "generate")?.input, {
      attemptId: ATTEMPT, image_handle: IMAGE_HANDLE,
      parameters: { model_id: "kling_image2video", prompt: "A red kite in the wind.", reference_count: 1,
        version: "3.0", mode: "hd", video_duration: 5, native_audio: false },
      controls: { temperature: 0.6, multi_shots: false }
    });
    assert.doesNotMatch(JSON.stringify(generated.structuredContent), /chat_id|tenant_id|subject_id|provider_id/iu);

    const reconciled = await state.client.callTool({ name: SYNTX_OWNER_RECONCILE_KLING_I2V_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, recovery_id: RECOVERY_ID
    } });
    assert.equal(reconciled.isError, undefined);
    assert.deepEqual(state.calls.find((call) => call.method === "reconcile")?.input,
      { attemptId: ATTEMPT, recovery_id: RECOVERY_ID });

    const listedRecoveries = await state.client.callTool({ name: SYNTX_OWNER_LIST_KLING_I2V_RECOVERIES_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, limit: 4
    } });
    assert.equal(listedRecoveries.isError, undefined);
    assert.deepEqual(state.calls.find((call) => call.method === "list")?.input, { attemptId: ATTEMPT, limit: 4 });
  } finally { await state.close(); }
});

test("Kling I2V remains absent by default and appears only when explicitly composed", async () => {
  const state = await setup();
  const defaultServer = createMcpServer(createDefaultApplication());
  const defaultClient = new Client({ name: "kling-i2v-default-client", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  await defaultServer.connect(defaultServerTransport);
  await defaultClient.connect(defaultClientTransport);

  const optedServer = createMcpServer(createDefaultApplication(), {
    ownerKlingI2v: { referenceService: state.referenceService as OwnerKlingI2vServiceComposition["referenceService"],
      generationService: state.generationService as unknown as OwnerKlingI2vServiceComposition["generationService"] }
  });
  const optedClient = new Client({ name: "kling-i2v-opted-client", version: "1.0.0" });
  const [optedClientTransport, optedServerTransport] = InMemoryTransport.createLinkedPair();
  await optedServer.connect(optedServerTransport);
  await optedClient.connect(optedClientTransport);
  try {
    const defaults = await defaultClient.listTools();
    assert.equal(defaults.tools.some((tool) => OWNER_KLING_I2V_TOOL_NAMES.includes(tool.name as typeof OWNER_KLING_I2V_TOOL_NAMES[number])), false);
    const optedIn = await optedClient.listTools();
    assert.ok(OWNER_KLING_I2V_TOOL_NAMES.every((name) => optedIn.tools.some((tool) => tool.name === name)));
  } finally {
    await Promise.all([defaultClient.close(), defaultServer.close(), optedClient.close(), optedServer.close(), state.close()]);
  }
});

test("Kling I2V SDK schemas reject unsafe extra fields and unsupported settings", async () => {
  const state = await setup();
  try {
    const invalid = [
      { link_attempt_id: ATTEMPT, image_handle: IMAGE_HANDLE, model_id: "kling_image2video", prompt: "x", version: "1.5", mode: "standart", video_duration: 5, native_audio: true, temperature: 0.5 },
      { link_attempt_id: ATTEMPT, image_handle: IMAGE_HANDLE, model_id: "kling_image2video", prompt: "x", version: "2.1-master", mode: "standart", video_duration: 5, native_audio: false, temperature: 0.5 },
      { link_attempt_id: ATTEMPT, image_handle: IMAGE_HANDLE, model_id: "kling_image2video", prompt: "x", version: "3.0", mode: "hd", video_duration: 5, native_audio: false, temperature: 0.55, multi_shots: false },
      { link_attempt_id: ATTEMPT, image_handle: IMAGE_HANDLE, model_id: "kling_image2video", prompt: "x", version: "3.0", mode: "hd", video_duration: 5, native_audio: false, temperature: 0.5, multi_shots: true },
      { link_attempt_id: ATTEMPT, image_handle: IMAGE_HANDLE, model_id: "kling_image2video", prompt: "x", version: "3.0-turbo", mode: "hd", video_duration: 5, native_audio: false, temperature: 0.5, reference_url: ARTIFACT_URL },
      { link_attempt_id: ATTEMPT, image_handle: IMAGE_HANDLE, model_id: "kling_image2video", prompt: "x", version: "1.5", mode: "hd", video_duration: 5, native_audio: false, temperature: 0.5, provider_id: "secret" }
    ];
    for (const arguments_ of invalid) {
      const result = await state.client.callTool({ name: SYNTX_OWNER_GENERATE_KLING_I2V_VIDEO_TOOL_NAME, arguments: arguments_ });
      assert.equal(result.isError, true);
    }
    const badUpload = await state.client.callTool({ name: SYNTX_OWNER_UPLOAD_KLING_I2V_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, content_base64: "AQID", filename: "source.png", mime_type: "image/png", image_url: ARTIFACT_URL
    } });
    assert.equal(badUpload.isError, true);
    assert.equal(state.calls.length, 0);
  } finally { await state.close(); }
});

test("Kling I2V SDK errors expose only allowlisted codes and safe outcome recovery identifiers", async () => {
  const state = await setup({ generationError: new OwnerKlingI2vGenerationServiceError("OUTCOME_UNKNOWN", RECOVERY_ID) });
  try {
    const result = await state.client.callTool({ name: SYNTX_OWNER_GENERATE_KLING_I2V_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, image_handle: IMAGE_HANDLE, model_id: "kling_image2video", prompt: "x", version: "1.5",
      mode: "hd", video_duration: 5, native_audio: false, temperature: 0.5
    } });
    assert.equal(result.isError, true);
    const text = (result as CallToolResult).content.filter((item) => item.type === "text").map((item) => item.text).join(" ");
    assert.match(text, /OUTCOME_UNKNOWN/u);
    assert.match(text, new RegExp(RECOVERY_ID, "u"));
    assert.match(text, /do not retry/u);
    assert.doesNotMatch(text, /tenant_id|subject_id|provider_id|chat_id|secret/iu);
  } finally { await state.close(); }
});

test("Kling I2V unknown exceptions are generic and upload ambiguity is not retryable", async () => {
  const generation = await setup({ generationError: new Error("credential=must-not-escape") });
  try {
    const result = await generation.client.callTool({ name: SYNTX_OWNER_GENERATE_KLING_I2V_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, image_handle: IMAGE_HANDLE, model_id: "kling_image2video", prompt: "x", version: "1.5",
      mode: "hd", video_duration: 5, native_audio: false, temperature: 0.5
    } });
    assert.equal(result.isError, true);
    const text = JSON.stringify(result.content);
    assert.match(text, /KLING_I2V_UNAVAILABLE/u);
    assert.doesNotMatch(text, /credential=|must-not-escape/iu);
  } finally { await generation.close(); }

  const upload = await setup({ uploadError: new OwnerKlingI2VImageReferenceServiceError("UPLOAD_OUTCOME_UNKNOWN") });
  try {
    const result = await upload.client.callTool({ name: SYNTX_OWNER_UPLOAD_KLING_I2V_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, content_base64: "AQID", filename: "source.png", mime_type: "image/png"
    } });
    assert.equal(result.isError, true);
    const text = JSON.stringify(result.content);
    assert.match(text, /UPLOAD_OUTCOME_UNKNOWN/u);
    assert.match(text, /do not retry/u);
    assert.doesNotMatch(text, /credential=|upload_context|https?:\/\//iu);
  } finally { await upload.close(); }
});
