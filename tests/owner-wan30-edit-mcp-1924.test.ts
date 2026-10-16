import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "node:path";
import {
  OwnerWan30EditGenerationService,
  OwnerWan30EditGenerationServiceError
} from "../src/application/owner-wan30-edit-generation-service.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  OWNER_WAN30_EDIT_TOOL_NAMES,
  SYNTX_GET_WAN30_EDIT_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_GENERATE_WAN30_EDIT_VIDEO_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN30_EDIT_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_WAN30_EDIT_VIDEO_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_WAN30_EDIT_VIDEO_TOOL_NAME,
  SYNTX_OWNER_GET_WAN30_EDIT_RESULT_PAGE_TOOL_NAME
} from "../src/mcp/owner-wan30-edit-video-tools.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  readOwnerWan30EditOperatorConfiguration,
  readOwnerWan30EditVideosFlag
} from "../src/transports/stdio-owner.js";

async function connected(ownerWan30EditVideosEnabled?: boolean) {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    throw new Error("No provider network is allowed in this local MCP fixture.");
  };
  const runtime = createObservedOwnerRuntime({
    ...(ownerWan30EditVideosEnabled === undefined ? {} : { ownerWan30EditVideosEnabled }),
    ...(ownerWan30EditVideosEnabled ? { ownerWan30EditFfprobePath: "/usr/bin/ffprobe" } : {}),
    catalogDirectory: resolve(process.cwd(), "catalog"),
    fetchImpl
  });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "wan30-edit-mcp-1924", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, runtime, fetchCalls: () => fetchCalls };
}

test("default runtime omits all WAN 3.0 Edit tools and does not probe or contact SYNTX", async () => {
  const fixture = await connected();
  try {
    const names = (await fixture.client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => (OWNER_WAN30_EDIT_TOOL_NAMES as readonly string[]).includes(name)), false);
    assert.equal(fixture.fetchCalls(), 0);
    assert.equal(readOwnerWan30EditVideosFlag(undefined), false);
    assert.equal(readOwnerWan30EditVideosFlag("0"), false);
    assert.equal(readOwnerWan30EditVideosFlag("1"), true);
    assert.throws(() => readOwnerWan30EditVideosFlag("true"), /SYNTX_OWNER_WAN30_EDIT_VIDEOS/u);
    assert.equal(readOwnerWan30EditOperatorConfiguration(false, undefined), undefined);
    assert.throws(() => readOwnerWan30EditOperatorConfiguration(true, undefined), /SYNTX_OWNER_WAN30_EDIT_FFPROBE_PATH/u);
    assert.throws(() => readOwnerWan30EditOperatorConfiguration(true, "relative/ffprobe"), /SYNTX_OWNER_WAN30_EDIT_FFPROBE_PATH/u);
  } finally {
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30EditVideosLifecycle?.close();
  }
});

test("explicit local opt-in registers six Edit tools and returns only the observed MP4 case", async () => {
  const fixture = await connected(true);
  try {
    const names = (await fixture.client.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (OWNER_WAN30_EDIT_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...OWNER_WAN30_EDIT_TOOL_NAMES].sort());
    const response = await fixture.client.callTool({ name: SYNTX_GET_WAN30_EDIT_PARAMETERS_TOOL_NAME, arguments: {} });
    assert.equal(response.isError, undefined);
    const source = response.structuredContent as { model_id?: unknown; current_form_source?: unknown; dispatch_allowed?: unknown;
      backend_acceptance?: unknown; wire_observation?: { settings_keys?: unknown; file_urls_entry?: { type?: unknown } };
      quote_observation?: { path?: unknown }; profile_scope?: { other_formats_and_durations?: unknown } };
    assert.equal(source.model_id, "wan_30_edit");
    assert.equal(source.current_form_source, "NOT_REOBSERVED");
    assert.equal(source.dispatch_allowed, false);
    assert.equal(source.backend_acceptance, "UNPROVEN");
    assert.equal(source.quote_observation?.path, "/api/v2/get_model_info");
    assert.equal((source.wire_observation?.settings_keys as unknown[])?.length, 12);
    assert.equal(source.wire_observation?.file_urls_entry?.type, "video");
    assert.equal(source.profile_scope?.other_formats_and_durations, "UNKNOWN");
    assert.equal(JSON.stringify(response).includes("https://"), false);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30EditVideosLifecycle?.close();
  }
});

test("invalid local MP4, out-of-profile settings, and malformed recovery IDs return content-only errors", async () => {
  const fixture = await connected(true);
  try {
    const badUpload = await fixture.client.callTool({ name: SYNTX_OWNER_UPLOAD_WAN30_EDIT_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_edit_1924_000000000001", content_base64: "aGVsbG8=", filename: "video.mov", mime_type: "video/mp4"
    } });
    const badGeneration = await fixture.client.callTool({ name: SYNTX_OWNER_GENERATE_WAN30_EDIT_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_edit_1924_000000000001", prompt: "synthetic local validation only",
      parameters: { aspect_ratio: "16:9", resolution: "720P", video_duration: 2, prompt_extend: true,
        shot_type: "single", audio_setting: "auto", seed: null, native_audio: true, duration: 2, rendering_speed: "basic" },
      video_handle: "wan30_edit_video_00000000-0000-4000-8000-000000000001"
    } });
    const badReconcile = await fixture.client.callTool({ name: SYNTX_OWNER_RECONCILE_WAN30_EDIT_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: "not-linked", recovery_id: "not-a-recovery"
    } });
    const badList = await fixture.client.callTool({ name: SYNTX_OWNER_LIST_WAN30_EDIT_RECOVERIES_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_edit_1924_000000000001", limit: 129
    } });
    const badPage = await fixture.client.callTool({ name: SYNTX_OWNER_GET_WAN30_EDIT_RESULT_PAGE_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_edit_1924_000000000001", recovery_id: "not-a-recovery", offset: 0
    } });
    for (const result of [badUpload, badGeneration, badReconcile, badList, badPage]) {
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
    }
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30EditVideosLifecycle?.close();
  }
});

test("serialization drift after generation becomes safe OUTCOME_UNKNOWN", async () => {
  const fixture = await connected(true);
  const prototype = OwnerWan30EditGenerationService.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "generate");
  assert.ok(descriptor && descriptor.writable);
  const recoveryId = "wan_edit_recovery_00000000-0000-4000-8000-000000000001";
  const privateSentinel = "PRIVATE_EDIT_PAYLOAD_MUST_NOT_ESCAPE";
  const diagnostic = {
    phase: "GENERATION_POST" as const, post_started: true, ack_known: false,
    history_status: "NOT_READ" as const, history_reason: null, history_get_calls: 0, result_get_calls: 0,
    inprogress_get_calls: 0, result_status: "NOT_READ" as const, result_reason: null
  };
  const args = {
    link_attempt_id: "link_wan30_edit_1924_000000000001", prompt: "A quiet lantern crosses a lake",
    parameters: { aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true,
      shot_type: "single", audio_setting: "auto", seed: null, native_audio: true, duration: 2, rendering_speed: "basic" },
    video_handle: "wan30_edit_video_00000000-0000-4000-8000-000000000001"
  };
  const readError = (result: Awaited<ReturnType<typeof fixture.client.callTool>>) => {
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    const text = (result as CallToolResult).content.find((block) => block.type === "text")?.text;
    assert.equal(typeof text, "string");
    return JSON.parse(text!) as { error: Record<string, unknown> };
  };
  try {
    Object.defineProperty(prototype, "generate", { ...descriptor, value: async () => ({ recovery_id: recoveryId, diagnostic,
      model_id: "wrong_model", private_payload: privateSentinel }) });
    const malformed = await fixture.client.callTool({ name: SYNTX_OWNER_GENERATE_WAN30_EDIT_VIDEO_TOOL_NAME, arguments: args });
    const error = readError(malformed).error;
    assert.equal(error.code, "OUTCOME_UNKNOWN");
    assert.equal(error.recovery_id, recoveryId);
    assert.deepEqual(error.diagnostic, diagnostic);
    assert.equal(JSON.stringify(malformed).includes(privateSentinel), false);
    assert.equal(JSON.stringify(malformed).includes("PRE_DISPATCH_FAILED"), false);

    Object.defineProperty(prototype, "generate", { ...descriptor, value: async () => {
      const failure = new OwnerWan30EditGenerationServiceError("OUTCOME_UNKNOWN", recoveryId, diagnostic);
      Object.defineProperty(failure, "private_payload", { value: privateSentinel, enumerable: true });
      throw failure;
    } });
    const unknown = await fixture.client.callTool({ name: SYNTX_OWNER_GENERATE_WAN30_EDIT_VIDEO_TOOL_NAME, arguments: args });
    const thrown = readError(unknown).error;
    assert.equal(thrown.code, "OUTCOME_UNKNOWN");
    assert.equal(thrown.recovery_id, recoveryId);
    assert.deepEqual(thrown.diagnostic, diagnostic);
    assert.equal(JSON.stringify(unknown).includes(privateSentinel), false);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    Object.defineProperty(prototype, "generate", descriptor);
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30EditVideosLifecycle?.close();
  }
});

test("post-service Edit upload and recovery serialization drift stays outcome-unknown", async () => {
  const fixture = await connected(true);
  const prototype = OwnerWan30EditGenerationService.prototype;
  const methodNames = ["uploadEditVideo", "reconcile", "getResultPage"] as const;
  const descriptors = methodNames.map((name) => Object.getOwnPropertyDescriptor(prototype, name));
  assert.ok(descriptors.every((descriptor) => descriptor?.writable));
  const recoveryId = "wan_edit_recovery_00000000-0000-4000-8000-000000000001";
  const privateSentinel = "PRIVATE_EDIT_SERIALIZATION_SENTINEL";
  const readError = (result: Awaited<ReturnType<typeof fixture.client.callTool>>) => {
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    const text = (result as CallToolResult).content.find((block) => block.type === "text")?.text;
    assert.equal(typeof text, "string");
    return JSON.parse(text!) as { error: Record<string, unknown> };
  };
  try {
    Object.defineProperty(prototype, "uploadEditVideo", { ...descriptors[0], value: async () => ({
      status: "uploaded", private_payload: privateSentinel
    }) });
    const upload = await fixture.client.callTool({ name: SYNTX_OWNER_UPLOAD_WAN30_EDIT_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_edit_1924_000000000001", content_base64: "AAAA", filename: "input.mp4", mime_type: "video/mp4"
    } });
    const uploadError = readError(upload).error;
    assert.equal(uploadError.code, "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(JSON.stringify(upload).includes(privateSentinel), false);
    assert.equal(JSON.stringify(upload).includes("UPLOAD_REJECTED"), false);

    Object.defineProperty(prototype, "reconcile", { ...descriptors[1], value: async () => ({
      model_id: "wrong_model", private_payload: privateSentinel
    }) });
    const reconcile = await fixture.client.callTool({ name: SYNTX_OWNER_RECONCILE_WAN30_EDIT_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_edit_1924_000000000001", recovery_id: recoveryId
    } });
    const reconcileError = readError(reconcile).error;
    assert.equal(reconcileError.code, "OUTCOME_UNKNOWN");
    assert.equal(reconcileError.recovery_id, recoveryId);
    assert.equal(JSON.stringify(reconcile).includes(privateSentinel), false);
    assert.equal(JSON.stringify(reconcile).includes("PRE_DISPATCH_FAILED"), false);

    Object.defineProperty(prototype, "getResultPage", { ...descriptors[2], value: async () => ({
      model_id: "wrong_model", private_payload: privateSentinel
    }) });
    const page = await fixture.client.callTool({ name: SYNTX_OWNER_GET_WAN30_EDIT_RESULT_PAGE_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_edit_1924_000000000001", recovery_id: recoveryId
    } });
    const pageError = readError(page).error;
    assert.equal(pageError.code, "OUTCOME_UNKNOWN");
    assert.equal(pageError.recovery_id, recoveryId);
    assert.equal(JSON.stringify(page).includes(privateSentinel), false);
    assert.equal(JSON.stringify(page).includes("PRE_DISPATCH_FAILED"), false);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    methodNames.forEach((name, index) => Object.defineProperty(prototype, name, descriptors[index]!));
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30EditVideosLifecycle?.close();
  }
});

test("owner auth onRevoked invalidates the WAN 3.0 Edit attempt without provider access", async () => {
  const fixture = await connected(true);
  const prototype = OwnerWan30EditGenerationService.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "invalidateAttempt");
  assert.ok(descriptor && descriptor.writable);
  const attemptId = "link_wan30_edit_revoke_1924_0001";
  const invalidated: string[] = [];
  try {
    Object.defineProperty(prototype, "invalidateAttempt", { ...descriptor, value: async function(this: OwnerWan30EditGenerationService, value: string) {
      invalidated.push(value);
      return await descriptor.value!.apply(this, [value]);
    } });
    const onRevoked = fixture.runtime.serverOptions.auth?.onRevoked;
    assert.equal(typeof onRevoked, "function");
    await onRevoked?.(attemptId);
    assert.deepEqual(invalidated, [attemptId]);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    Object.defineProperty(prototype, "invalidateAttempt", descriptor);
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30EditVideosLifecycle?.close();
  }
});
