import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SYNTX_OWNER_GENERATE_KLING_I2V_VIDEO_TOOL_NAME, SYNTX_OWNER_UPLOAD_KLING_I2V_IMAGE_TOOL_NAME } from "../src/mcp/owner-kling-i2v-tools.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";

const ATTEMPT = "link_kling_multi_shots_1574_000000000001";
const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x01, 0x2c, 0x01, 0x01, 0x11, 0,
  0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
const PROMPT = "First, a red kite rises above the harbor. Then it glides toward the distant lighthouse.";
const IMAGE_URL = "https://r2.syntx.ai/hidden/kling-1574-frame.jpg";
const VIDEO_URL = "https://r2.syntx.ai/kling/1574-result.mp4";

test("runtime composition carries multi_shots true and raw prompt through official SDK", async () => {
  let now = Date.parse("2026-10-14T00:00:00.000Z");
  let generationPosts = 0;
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const runtime = createObservedOwnerRuntime({ ownerKlingI2vEnabled: true, now: () => now, fetchImpl: async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    requests.push({ method, path: url.pathname, ...(body === undefined ? {} : { body }) });
    if (url.origin !== "https://api.syntx.ai") throw new Error("Unexpected synthetic origin");
    if (url.pathname === "/api/v1/user/balance" && method === "GET") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") return Response.json({ access: true, cost: 12,
      discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      const form = init.body as FormData;
      assert.equal(form.get("destination"), "uploaded");
      assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), "kling_image2video");
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), IMAGE);
      return Response.json({ files: [{ id: "private-1574-upload", url: IMAGE_URL }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: "kling-i2v-1574-chat" });
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      generationPosts += 1;
      const request = body as { prompt: string; settings: Record<string, unknown> };
      assert.equal(request.prompt, PROMPT);
      assert.equal(request.settings.multi_shots, true);
      assert.equal("scenes" in request.settings, false);
      assert.equal("multi_prompt" in request.settings, false);
      return Response.json({ id: "kling-i2v-1574-ack" });
    }
    if (url.pathname === "/api/v1/chats/kling-i2v-1574-chat/messages" && method === "GET") return Response.json({
      messages: [
        { id: "kling-i2v-1574-ack", chat_id: 79301, author_id: 4812, message_object: [] },
        { id: "kling-i2v-1574-result", chat_id: 79301, author_id: -1, message_object: [{ id: "video-object", message_id: "kling-i2v-1574-result",
          object_type: "video", model_type: "kling_image2video" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
    });
    if (url.pathname === "/api/v1/chats/kling-i2v-1574-chat/kling-i2v-1574-result" && method === "GET") return Response.json({
      id: "kling-i2v-1574-result", chat_id: 79301, author_id: -1, message_object: [{ id: "video-object", message_id: "kling-i2v-1574-result",
        object_type: "video", model_type: "kling_image2video", completed: true, object_url: VIDEO_URL }]
    });
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  } });
  const composition = runtime.serverOptions.ownerKlingI2v;
  assert.ok(composition);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "kling-1574-sdk", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const authStore = runtime.authStore;
    await authStore.createAttempt({ attempt_id: ATTEMPT, binding: runtime.authBinding, expires_at_ms: now + 60_000 });
    await authStore.beginHandoff(runtime.authBinding, ATTEMPT);
    await authStore.attachChallenge(runtime.authBinding, ATTEMPT, "synthetic-kling-1574");
    await authStore.beginPoll(runtime.authBinding, ATTEMPT);
    await authStore.markLinked(runtime.authBinding, ATTEMPT, { scheme: "Bearer", value: "synthetic-kling-1574-credential" });

    const source = await client.callTool({ name: "syntx_owner_get_kling_i2v_parameters", arguments: {} });
    assert.equal(source.isError, undefined);
    assert.equal((source.structuredContent as { backend_acceptance: string }).backend_acceptance, "UNPROVEN");
    assert.equal((source.structuredContent as { runtime_usable: boolean }).runtime_usable, false);
    assert.equal((source.structuredContent as { dispatch_allowed: boolean }).dispatch_allowed, false);
    const controls = (source.structuredContent as { controls: { multi_shots: { enabled_versions: string[]; accepted_values: boolean[];
      requirement: string; prompt: string; scene_prompt_builder: string } } }).controls;
    assert.deepEqual(controls.multi_shots.enabled_versions, ["3.0"]);
    assert.deepEqual(controls.multi_shots.accepted_values, [false, true]);
    assert.equal(controls.multi_shots.requirement, "EXPLICIT_BOOLEAN");
    assert.equal(controls.multi_shots.prompt, "REQUIRED_NONBLANK_RAW_PROMPT_PASSED_UNCHANGED");
    assert.equal(controls.multi_shots.scene_prompt_builder, "NOT_IMPLEMENTED");

    const uploaded = await client.callTool({ name: SYNTX_OWNER_UPLOAD_KLING_I2V_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, content_base64: IMAGE.toString("base64"), filename: "frame.jpg", mime_type: "image/jpeg"
    } });
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
    const imageHandle = (uploaded.structuredContent as { image_handle: string }).image_handle;
    const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_KLING_I2V_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT, image_handle: imageHandle, model_id: "kling_image2video", prompt: PROMPT,
      version: "3.0", mode: "hd", video_duration: 5, native_audio: false, temperature: 0.6, multi_shots: true
    } });
    assert.equal(generated.isError, undefined, JSON.stringify(generated));
    assert.equal(generationPosts, 1);
    const post = requests.find((request) => request.path === "/api/v1/video/generate")?.body as { prompt: string; settings: Record<string, unknown> };
    assert.equal(post.prompt, PROMPT);
    assert.equal(post.settings.multi_shots, true);
    assert.equal("scenes" in post.settings, false);
    assert.equal("multi_prompt" in post.settings, false);
    assert.deepEqual((generated.structuredContent as { artifacts: unknown[] }).artifacts, [{ url: VIDEO_URL, mime_type: "video/mp4" }]);
    assert.equal((generated.structuredContent as { backend_acceptance: string }).backend_acceptance, "UNPROVEN");
    for (const invalid of [
      { version: "2.6", multi_shots: true, mode: "hd", native_audio: true, prompt: PROMPT },
      { version: "3.0", multi_shots: true, mode: "hd", native_audio: false, prompt: "  " }
    ]) {
      const rejected = await client.callTool({ name: SYNTX_OWNER_GENERATE_KLING_I2V_VIDEO_TOOL_NAME, arguments: {
        link_attempt_id: ATTEMPT, image_handle: imageHandle, model_id: "kling_image2video", prompt: invalid.prompt,
        version: invalid.version, mode: invalid.mode, video_duration: 5, native_audio: invalid.native_audio,
        temperature: 0.6, multi_shots: invalid.multi_shots
      } });
      assert.equal(rejected.isError, true);
    }
    assert.equal(generationPosts, 1, "invalid requests are rejected before generation dispatch");
  } finally {
    await Promise.all([client.close(), server.close(), runtime.ownerKlingI2vLifecycle?.close()]);
    runtime.authStore.close?.();
  }
});
