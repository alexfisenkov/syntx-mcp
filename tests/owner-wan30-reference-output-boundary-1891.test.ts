import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  OwnerWan30ReferenceGenerationService,
  OwnerWan30ReferenceGenerationServiceError
} from "../src/application/owner-wan30-reference-generation-service.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SYNTX_OWNER_GENERATE_WAN30_REFERENCE_VIDEO_TOOL_NAME } from "../src/mcp/owner-wan30-reference-video-tools.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";

const CATALOG_VERSION = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
const CATALOG_DIRECTORY = fileURLToPath(new URL("../../catalog/", import.meta.url));

test("Reference generation output drift and OUTCOME_UNKNOWN diagnostics stay content-only and redacted", async () => {
  let fetchCalls = 0;
  const runtime = createObservedOwnerRuntime({ ownerWan30ReferenceVideosEnabled: true,
    publicCatalogVersion: CATALOG_VERSION, catalogDirectory: CATALOG_DIRECTORY,
    fetchImpl: async () => { fetchCalls += 1; throw new Error("No provider network in this regression."); } });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "reference-output-boundary-1891", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const prototype = OwnerWan30ReferenceGenerationService.prototype;
  const methodDescriptor = Object.getOwnPropertyDescriptor(prototype, "generate");
  assert.ok(methodDescriptor && methodDescriptor.writable);
  const recoveryId = "wan_reference_recovery_00000000-0000-4000-8000-000000000001";
  const privateSentinel = "PRIVATE_REFERENCE_PAYLOAD_MUST_NOT_ESCAPE";
  const diagnostic = {
    phase: "GENERATION_POST" as const,
    post_started: true,
    ack_known: false,
    history_status: "UNVERIFIED" as const,
    history_reason: "HISTORY_INCOMPLETE" as const,
    history_get_calls: 1,
    result_get_calls: 0,
    inprogress_get_calls: 0,
    result_status: "UNVERIFIED" as const,
    result_reason: "NATIVE_RESULT_UNVERIFIED" as const
  };
  const args = {
    link_attempt_id: "link_reference_output_boundary_1891_000000000001",
    prompt: "A glass prism catches the morning light",
    parameters: { aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true,
      shot_type: "single", audio_setting: "auto", seed: null, native_audio: false, duration: 0, rendering_speed: "basic" },
    image_handle: "wan30_reference_image_00000000-0000-4000-8000-000000000001"
  };
  const readError = (result: Awaited<ReturnType<typeof client.callTool>>) => {
    assert.ok("content" in result);
    const toolResult = result as CallToolResult;
    assert.equal(toolResult.isError, true);
    assert.equal(toolResult.structuredContent, undefined);
    const text = toolResult.content.find((block) => block.type === "text")?.text;
    assert.equal(typeof text, "string");
    return JSON.parse(text!) as { error: Record<string, unknown> };
  };
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    Object.defineProperty(prototype, "generate", { ...methodDescriptor, value: async () => ({
      recovery_id: recoveryId,
      diagnostic,
      model_id: "wrong_model",
      private_payload: privateSentinel
    }) });
    const malformedOutput = await client.callTool({ name: SYNTX_OWNER_GENERATE_WAN30_REFERENCE_VIDEO_TOOL_NAME, arguments: args });
    const outputError = readError(malformedOutput).error;
    assert.equal(outputError.code, "OUTCOME_UNKNOWN");
    assert.equal(outputError.recovery_id, recoveryId);
    assert.deepEqual(outputError.diagnostic, diagnostic);
    assert.equal(JSON.stringify(malformedOutput).includes(privateSentinel), false);
    assert.equal(JSON.stringify(malformedOutput).includes("PRE_DISPATCH_FAILED"), false);

    Object.defineProperty(prototype, "generate", { ...methodDescriptor, value: async () => {
      const error = new OwnerWan30ReferenceGenerationServiceError("OUTCOME_UNKNOWN", recoveryId, diagnostic);
      Object.defineProperty(error, "private_payload", { value: privateSentinel, enumerable: true });
      throw error;
    } });
    const unknownOutcome = await client.callTool({ name: SYNTX_OWNER_GENERATE_WAN30_REFERENCE_VIDEO_TOOL_NAME, arguments: args });
    const serviceError = readError(unknownOutcome).error;
    assert.equal(serviceError.code, "OUTCOME_UNKNOWN");
    assert.equal(serviceError.recovery_id, recoveryId);
    assert.deepEqual(serviceError.diagnostic, diagnostic);
    assert.equal(JSON.stringify(unknownOutcome).includes(privateSentinel), false);
    assert.equal(fetchCalls, 0);
  } finally {
    Object.defineProperty(prototype, "generate", methodDescriptor);
    await client.close();
    await server.close();
    await runtime.ownerWan30ReferenceVideosLifecycle?.close();
  }
});
