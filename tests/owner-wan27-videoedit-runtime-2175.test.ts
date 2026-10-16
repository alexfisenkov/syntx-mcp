import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createOwnerWan27VideoEditRuntime } from "../src/runtime/owner-wan27-videoedit-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_WAN27_VIDEOEDIT_TOOL_NAMES, registerSyntxOwnerWan27VideoEditTools } from "../src/mcp/owner-wan27-videoedit-tools.js";
import { runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";
import { createWan27VideoEditRuntimeFixture } from "./helpers/wan27-videoedit-runtime-fixture-2172.js";
import { minimalWan27Mp4Header } from "./helpers/wan27-videoedit-fixtures-2163.js";

test("2175 observed owner runtime exposes only the independent six WAN Edit tools when opted in", async () => {
  for (const enabled of [false, true]) {
    let network = 0;
    const runtime = createObservedOwnerRuntime({ ownerWan27VideoEditEnabled: enabled,
      ownerWan27VideoEditFfprobePath: process.execPath, ownerWan27VideoEditMaxVideoFileBytes: 2048,
      catalogDirectory: resolve("catalog"), fetchImpl: async () => { network++; throw new Error("Unexpected network in source-tool registration"); } });
    const server = createMcpServer(runtime.application, runtime.serverOptions);
    const client = new Client({ name: "wan27-edit-runtime2175", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(ct), server.connect(st)]);
      const names = (await client.listTools()).tools.map(row => row.name);
      assert.deepEqual(names.filter(name => (OWNER_WAN27_VIDEOEDIT_TOOL_NAMES as readonly string[]).includes(name)), enabled ? OWNER_WAN27_VIDEOEDIT_TOOL_NAMES : []);
      assert.equal(names.includes("syntx_owner_generate_kling4_video"), false);
      if (enabled) {
        const result = await client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[0], arguments: { model_id: "wan_27_videoedit" } });
        assert.notEqual(result.isError, true);
        assert.equal((result.structuredContent as { local_policy: { max_video_file_bytes: number } }).local_policy.max_video_file_bytes, 2048);
      }
      assert.equal(network, 0);
    } finally { await runtime.ownerWan27VideoEditLifecycle?.close(); await Promise.allSettled([client.close(), server.close()]); runtime.authStore.close?.(); }
  }
});

test("2175 stdio rejects invalid opt-in, absent operator probe and durable conflict before linking", async () => {
  const saved = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith("SYNTX_OWNER_")) delete process.env[key];
    process.env.SYNTX_OWNER_WAN27_VIDEOEDIT = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_WAN27_VIDEOEDIT configuration/u);
    process.env.SYNTX_OWNER_WAN27_VIDEOEDIT = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_WAN27_VIDEOEDIT operator configuration/u);
    process.env.SYNTX_OWNER_WAN27_VIDEOEDIT_FFPROBE_PATH = process.execPath;
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const key of Object.keys(process.env)) if (key.startsWith("SYNTX_OWNER_")) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("2175 genuine SDK and composed owned runtime upload once, dispatch once, then GET-only result after input TTL", async () => {
  const fixture = await createWan27VideoEditRuntimeFixture({ initiallyPending: true });
  const runtime = createOwnerWan27VideoEditRuntime(fixture);
  const server = new McpServer({ name: "wan27-edit-composed2175", version: "1" });
  registerSyntxOwnerWan27VideoEditTools(server, { referenceService: runtime.referenceService,
    generationService: runtime.generationService, maxVideoFileBytes: runtime.maxVideoFileBytes });
  const client = new Client({ name: "wan27-edit-sdk2175", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    const upload = await client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[1], arguments: {
      link_attempt_id: fixture.attemptId, model_id: "wan_27_videoedit", filename: "owned.mp4", mime_type: "video/mp4",
      content_base64: minimalWan27Mp4Header().toString("base64")
    } });
    assert.notEqual(upload.isError, true);
    const handle = (upload.structuredContent as { reference_handle: string }).reference_handle;
    assert.equal(JSON.stringify(upload).includes("r2.syntx.ai"), false);
    const generated = await client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[2], arguments: {
      link_attempt_id: fixture.attemptId, model_id: "wan_27_videoedit", prompt: "2175 own SDK recovery case",
      resolution: "720P", aspect_ratio: "16:9", audio_setting: "auto", prompt_extend: true, seed: 0,
      duration_mode: "preserve_input", reference_handles: [handle]
    } }) as CallToolResult;
    assert.equal(generated.isError, true);
    const firstText = generated.content.find(row => row.type === "text");
    assert.ok(firstText && firstText.type === "text");
    const error = JSON.parse(firstText.text) as { error: { code: string; recovery_id: string } };
    assert.equal(error.error.code, "OUTCOME_UNKNOWN");
    assert.match(error.error.recovery_id, /^wan27_videoedit_recovery_/u);
    fixture.advanceTime(16 * 60_000); fixture.setHistoryReady(true);
    const result = await client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[3], arguments: {
      link_attempt_id: fixture.attemptId, recovery_id: error.error.recovery_id
    } });
    assert.notEqual(result.isError, true);
    const value = result.structuredContent as { status: string; artifacts: { model_id: string; object_url: string }[] };
    assert.equal(value.status, "completed"); assert.equal(value.artifacts.length, 1);
    assert.equal(value.artifacts[0]?.model_id, "wan_27_videoedit");
    const page = await client.callTool({ name: OWNER_WAN27_VIDEOEDIT_TOOL_NAMES[5], arguments: {
      link_attempt_id: fixture.attemptId, recovery_id: error.error.recovery_id, offset: 0
    } });
    assert.notEqual(page.isError, true);
    assert.equal(fixture.stats.generationPosts, 1); assert.equal(fixture.stats.uploadPosts, 1); assert.equal(fixture.stats.chatPosts, 1);
  } finally { await runtime.lifecycle.close(); await Promise.allSettled([client.close(), server.close()]); await fixture.cleanup(); }
});
