import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS, SYNTX_GET_WAN_T2V_PARAMETERS_TOOL_NAME } from "../src/mcp/owner-wan-t2v-video-tools.js";
import {
  normalizeOwnerWanT2vGenerationParameters,
  OwnerWanT2vGenerationParametersError,
  projectOwnerWanT2vGenerationWireCandidate
} from "../src/application/owner-wan-t2v-generation-parameters.js";
import { OWNER_WAN27_CURRENT_AUDIO_POLICY } from "../src/application/owner-wan27-current-audio-policy.js";

const BASE_27 = {
  model_id: "wan_27_t2v",
  prompt: "A paper kite crossing a quiet blue sky",
  parameters: {
    resolution: "1080P", aspect_ratio: "3:4", video_duration: 15,
    prompt_extend: false, seed: null, native_audio: false
  }
} as const;

test("current WAN27 T2V source override accepts false and reports its independent pin", () => {
  const normalized = normalizeOwnerWanT2vGenerationParameters(BASE_27);
  assert.deepEqual(normalized.intent, BASE_27);
  assert.deepEqual(normalized.current_audio_policy, OWNER_WAN27_CURRENT_AUDIO_POLICY);
  assert.equal(normalized.source_pins.build_id, "1791811899");
  assert.equal(normalized.current_audio_policy.source_pins.build_id, "1791904852");
  assert.equal(normalized.current_audio_policy.source_pins.form_sha256,
    "sha256:f69db3d449d0051969def2229ed936d9835e0d65c8f257ec3ab289d6e9387737");
  const wire = projectOwnerWanT2vGenerationWireCandidate(normalized);
  assert.equal(wire.settings_candidate.native_audio, false);
  assert.equal(Object.isFrozen(normalized.current_audio_policy), true);
});

test("current WAN27 T2V source override rejects explicit true as invalid parameters", () => {
  assert.throws(
    () => normalizeOwnerWanT2vGenerationParameters({
      ...BASE_27, parameters: { ...BASE_27.parameters, native_audio: true }
    }),
    (error: unknown) => error instanceof OwnerWanT2vGenerationParametersError && error.code === "INVALID_PARAMETERS"
  );
});

test("WAN26 T2V shot type and audio pins remain unchanged", () => {
  const input = {
    model_id: "wan_26_t2v", prompt: BASE_27.prompt,
    parameters: {
      resolution: "720P", aspect_ratio: "16:9", video_duration: 5,
      prompt_extend: true, seed: 0, shot_type: "single"
    }
  } as const;
  const normalized = normalizeOwnerWanT2vGenerationParameters(input);
  assert.deepEqual(normalized.intent, input);
  assert.equal("current_audio_policy" in normalized, false);
  assert.equal(normalized.source_pins.build_id, "1791811899");
  assert.equal(normalized.source_pins.form_sha256,
    "sha256:e169fbee16360e0fef359bb96b3498e7ad2db9f43f37e362af138f2787a62f68");
});

test("WAN27 T2V MCP input schema exposes only literal false while WAN26 remains unchanged", () => {
  const common = { link_attempt_id: "link_wan_audio_policy_1520_attempt_0001",
    prompt: "A paper kite crossing a quiet blue sky" };
  const parameters = { resolution: "720P", aspect_ratio: "16:9", video_duration: 5,
    prompt_extend: true, seed: null };
  assert.equal(OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS.generate.safeParse({ ...common, model_id: "wan_27_t2v",
    parameters: { ...parameters, native_audio: false } }).success, true);
  assert.equal(OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS.generate.safeParse({ ...common, model_id: "wan_27_t2v",
    parameters: { ...parameters, native_audio: true } }).success, false);
  assert.equal(OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS.generate.safeParse({ ...common, model_id: "wan_26_t2v",
    parameters: { ...parameters, shot_type: "single" } }).success, true);
});

test("official SDK source-read returns the current override and performs no upstream request", async () => {
  let fetchCalls = 0;
  const runtime = createObservedOwnerRuntime({ ownerWanT2vVideosEnabled: true, fetchImpl: async () => {
    fetchCalls += 1;
    throw new Error("Source-read must not fetch upstream.");
  } });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "wan27-current-audio-policy-1520", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: SYNTX_GET_WAN_T2V_PARAMETERS_TOOL_NAME, arguments: {} });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const report = result.structuredContent as { source_pins: { build_id: string }; current_audio_policy: typeof OWNER_WAN27_CURRENT_AUDIO_POLICY };
    assert.equal(report.source_pins.build_id, "1791811899");
    assert.deepEqual(report.current_audio_policy, OWNER_WAN27_CURRENT_AUDIO_POLICY);
    assert.equal(fetchCalls, 0);
  } finally {
    await Promise.all([client.close(), server.close(), runtime.ownerWanT2vVideosLifecycle?.close()]);
  }
});
