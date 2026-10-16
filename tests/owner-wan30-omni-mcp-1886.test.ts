import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  OwnerWan30OmniGenerationService,
  OwnerWan30OmniGenerationServiceError
} from "../src/application/owner-wan30-omni-generation-service.js";
import {
  OWNER_WAN30_OMNI_TOOL_NAMES,
  SYNTX_GET_WAN30_OMNI_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_WAN30_OMNI_IMAGE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_WAN30_OMNI_VIDEO_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_WAN30_OMNI_VIDEO_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN30_OMNI_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_WAN30_OMNI_RESULT_PAGE_TOOL_NAME
} from "../src/mcp/owner-wan30-omni-video-tools.js";
import { readOwnerWan30OmniVideosFlag } from "../src/transports/stdio-owner.js";

async function connected(ownerWan30OmniVideosEnabled?: boolean) {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    throw new Error("No provider network is allowed in this local MCP fixture.");
  };
  const runtime = createObservedOwnerRuntime({
    ...(ownerWan30OmniVideosEnabled === undefined ? {} : { ownerWan30OmniVideosEnabled }),
    fetchImpl
  });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "wan30-omni-mcp-1886", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, runtime, fetchCalls: () => fetchCalls };
}

test("default runtime omits every WAN 3.0 Omni tool", async () => {
  const fixture = await connected();
  try {
    const names = (await fixture.client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => (OWNER_WAN30_OMNI_TOOL_NAMES as readonly string[]).includes(name)), false);
    assert.equal(fixture.fetchCalls(), 0);
    assert.equal(readOwnerWan30OmniVideosFlag(undefined), false);
    assert.equal(readOwnerWan30OmniVideosFlag("0"), false);
    assert.equal(readOwnerWan30OmniVideosFlag("1"), true);
    assert.throws(() => readOwnerWan30OmniVideosFlag("true"), /SYNTX_OWNER_WAN30_OMNI_VIDEOS/u);
  } finally {
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30OmniVideosLifecycle?.close();
  }
});

test("explicit owner opt-in registers six tools and returns only the pinned Omni image case", async () => {
  const fixture = await connected(true);
  try {
    const names = (await fixture.client.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (OWNER_WAN30_OMNI_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...OWNER_WAN30_OMNI_TOOL_NAMES].sort());
    const source = await fixture.client.callTool({ name: SYNTX_GET_WAN30_OMNI_PARAMETERS_TOOL_NAME, arguments: {} });
    assert.equal(source.isError, undefined);
    const value = source.structuredContent as { model_id?: unknown; effective_defaults?: unknown; dispatch_allowed?: unknown;
      backend_acceptance?: unknown; wire_observation?: { settings_keys?: unknown; file_urls_entry_types?: unknown };
      quote_observation?: { path?: unknown }; profile_scope?: { other_omni_input_variants?: unknown } };
    assert.equal(value.model_id, "wan_30_omni");
    assert.equal(value.effective_defaults, "UNKNOWN");
    assert.equal(value.dispatch_allowed, false);
    assert.equal(value.backend_acceptance, "UNPROVEN");
    assert.equal(value.quote_observation?.path, "/api/v2/get_model_info");
    assert.equal((value.wire_observation?.settings_keys as unknown[])?.length, 12);
    assert.deepEqual(value.wire_observation?.file_urls_entry_types, ["image"]);
    assert.equal(value.profile_scope?.other_omni_input_variants, "NOT_COVERED");
    assert.equal(JSON.stringify(source).includes("https://"), false);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30OmniVideosLifecycle?.close();
  }
});

test("invalid upload and out-of-profile generation fail without dispatch or structured error", async () => {
  const fixture = await connected(true);
  try {
    const badUpload = await fixture.client.callTool({ name: SYNTX_OWNER_UPLOAD_WAN30_OMNI_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_omni_1886_000000000001", content_base64: "aGVsbG8=",
      filename: "image.png", mime_type: "image/gif"
    } });
    const badGeneration = await fixture.client.callTool({ name: SYNTX_OWNER_GENERATE_WAN30_OMNI_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_omni_1886_000000000001", prompt: "synthetic local validation only",
      parameters: { aspect_ratio: "16:9", resolution: "720P", video_duration: 2, prompt_extend: true,
        shot_type: "single", audio_setting: "auto", seed: null, native_audio: false, duration: 0, rendering_speed: "basic" },
      image_handle: "wan30_omni_image_00000000-0000-4000-8000-000000000001"
    } });
    for (const result of [badUpload, badGeneration]) {
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
    }
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30OmniVideosLifecycle?.close();
  }
});

test("malformed Omni recovery identifiers and list bounds fail with content-only errors", async () => {
  const fixture = await connected(true);
  try {
    const badReconcile = await fixture.client.callTool({ name: SYNTX_OWNER_RECONCILE_WAN30_OMNI_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: "not-a-linked-attempt", recovery_id: "not-a-recovery"
    } });
    const badList = await fixture.client.callTool({ name: SYNTX_OWNER_LIST_WAN30_OMNI_RECOVERIES_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_omni_1886_000000000001", limit: 129
    } });
    const badPage = await fixture.client.callTool({ name: SYNTX_OWNER_GET_WAN30_OMNI_RESULT_PAGE_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_omni_1886_000000000001", recovery_id: "not-a-recovery", offset: 0
    } });
    for (const result of [badReconcile, badList, badPage]) {
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
    }
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30OmniVideosLifecycle?.close();
  }
});

test("post-generate output drift becomes OUTCOME_UNKNOWN and safe diagnostics never expose private payload", async () => {
  const fixture = await connected(true);
  const prototype = OwnerWan30OmniGenerationService.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "generate");
  assert.ok(descriptor && descriptor.writable);
  const recoveryId = "wan_omni_recovery_00000000-0000-4000-8000-000000000001";
  const privateSentinel = "PRIVATE_OMNI_PAYLOAD_MUST_NOT_ESCAPE";
  const diagnostic = {
    phase: "GENERATION_POST" as const,
    post_started: true,
    ack_known: false,
    history_status: "NOT_READ" as const,
    history_reason: null,
    history_get_calls: 0,
    result_get_calls: 0,
    inprogress_get_calls: 0,
    result_status: "NOT_READ" as const,
    result_reason: null
  };
  const args = {
    link_attempt_id: "link_wan30_omni_1886_000000000001",
    prompt: "A quiet lantern crosses a lake",
    parameters: { aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true,
      shot_type: "single", audio_setting: "auto", seed: null, native_audio: false, duration: 0, rendering_speed: "basic" },
    image_handle: "wan30_omni_image_00000000-0000-4000-8000-000000000001"
  };
  const readError = (result: Awaited<ReturnType<typeof fixture.client.callTool>>) => {
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    const text = (result as CallToolResult).content.find((block) => block.type === "text")?.text;
    assert.equal(typeof text, "string");
    return JSON.parse(text!) as { error: Record<string, unknown> };
  };
  try {
    Object.defineProperty(prototype, "generate", { ...descriptor, value: async () => ({
      recovery_id: recoveryId,
      diagnostic,
      model_id: "wrong_model",
      private_payload: privateSentinel
    }) });
    const malformedOutput = await fixture.client.callTool({ name: SYNTX_OWNER_GENERATE_WAN30_OMNI_VIDEO_TOOL_NAME, arguments: args });
    const outputError = readError(malformedOutput).error;
    assert.equal(outputError.code, "OUTCOME_UNKNOWN");
    assert.equal(outputError.recovery_id, recoveryId);
    assert.deepEqual(outputError.diagnostic, diagnostic);
    assert.equal(JSON.stringify(malformedOutput).includes(privateSentinel), false);
    assert.equal(JSON.stringify(malformedOutput).includes("PRE_DISPATCH_FAILED"), false);

    Object.defineProperty(prototype, "generate", { ...descriptor, value: async () => {
      const error = new OwnerWan30OmniGenerationServiceError("OUTCOME_UNKNOWN", recoveryId, diagnostic);
      Object.defineProperty(error, "private_payload", { value: privateSentinel, enumerable: true });
      throw error;
    } });
    const thrownOutcome = await fixture.client.callTool({ name: SYNTX_OWNER_GENERATE_WAN30_OMNI_VIDEO_TOOL_NAME, arguments: args });
    const thrownError = readError(thrownOutcome).error;
    assert.equal(thrownError.code, "OUTCOME_UNKNOWN");
    assert.equal(thrownError.recovery_id, recoveryId);
    assert.deepEqual(thrownError.diagnostic, diagnostic);
    assert.equal(JSON.stringify(thrownOutcome).includes(privateSentinel), false);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    Object.defineProperty(prototype, "generate", descriptor);
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30OmniVideosLifecycle?.close();
  }
});
