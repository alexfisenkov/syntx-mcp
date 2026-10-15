import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  OWNER_WAN30_FIRST_LAST_TOOL_NAMES,
  SYNTX_GET_WAN30_FIRST_LAST_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_GENERATE_WAN30_FIRST_LAST_VIDEO_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_WAN30_FIRST_LAST_FRAME_TOOL_NAME
} from "../src/mcp/owner-wan30-first-last-video-tools.js";

test("default runtime omits all Wan30 First/Last tools; explicit opt-in exposes exactly six", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    throw new Error("No provider network is allowed in this local MCP registration fixture.");
  };
  const disabled = createObservedOwnerRuntime({ fetchImpl });
  const disabledServer = createMcpServer(disabled.application, disabled.serverOptions);
  const disabledClient = new Client({ name: "wan30-first-last-default-1829", version: "1.0.0" });
  const [disabledClientTransport, disabledServerTransport] = InMemoryTransport.createLinkedPair();
  try {
    await disabledServer.connect(disabledServerTransport);
    await disabledClient.connect(disabledClientTransport);
    const names = (await disabledClient.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => (OWNER_WAN30_FIRST_LAST_TOOL_NAMES as readonly string[]).includes(name)), false);
  } finally {
    await disabledClient.close();
    await disabledServer.close();
    await disabled.ownerWan30FirstLastVideosLifecycle?.close();
  }

  const enabled = createObservedOwnerRuntime({ ownerWan30FirstLastVideosEnabled: true, fetchImpl });
  const enabledServer = createMcpServer(enabled.application, enabled.serverOptions);
  const enabledClient = new Client({ name: "wan30-first-last-opt-in-1829", version: "1.0.0" });
  const [enabledClientTransport, enabledServerTransport] = InMemoryTransport.createLinkedPair();
  try {
    await enabledServer.connect(enabledServerTransport);
    await enabledClient.connect(enabledClientTransport);
    const names = (await enabledClient.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (OWNER_WAN30_FIRST_LAST_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...OWNER_WAN30_FIRST_LAST_TOOL_NAMES].sort());

    const source = await enabledClient.callTool({ name: SYNTX_GET_WAN30_FIRST_LAST_PARAMETERS_TOOL_NAME, arguments: {} });
    assert.equal(source.isError, undefined, JSON.stringify(source));
    assert.equal((source.structuredContent as { model_id?: unknown }).model_id, "wan_30_first_last_frame");
    assert.equal((source.structuredContent as { effective_defaults?: unknown }).effective_defaults, "UNKNOWN");
    assert.equal((source.structuredContent as { dispatch_allowed?: unknown }).dispatch_allowed, false);

    const badUpload = await enabledClient.callTool({ name: SYNTX_OWNER_UPLOAD_WAN30_FIRST_LAST_FRAME_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_first_last_1829_000000000001", role: "first_frame",
      content_base64: "aGVsbG8=", filename: "frame.png", mime_type: "image/gif"
    } });
    assert.equal(badUpload.isError, true, "unsupported MIME is rejected before service/upload dispatch");

    const badGeneration = await enabledClient.callTool({ name: SYNTX_OWNER_GENERATE_WAN30_FIRST_LAST_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_first_last_1829_000000000001", prompt: "synthetic local validation only",
      parameters: { aspect_ratio: "16:9", resolution: "720P", video_duration: 2, prompt_extend: true,
        seed: null, native_audio: false, rendering_speed: "basic" },
      first_frame_handle: "wan30_frame_00000000-0000-4000-8000-000000000001",
      last_frame_handle: "wan30_frame_00000000-0000-4000-8000-000000000002"
    } });
    assert.equal(badGeneration.isError, true, "out-of-profile settings are rejected before account/preflight/dispatch");
    assert.equal(fetchCalls, 0, "source read and invalid inputs never use provider transport");
  } finally {
    await enabledClient.close();
    await enabledServer.close();
    await enabled.ownerWan30FirstLastVideosLifecycle?.close();
  }
});
