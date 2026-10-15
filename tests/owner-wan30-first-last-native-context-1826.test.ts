import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import {
  createOwnerWan30FirstLastGenerationContext,
  inspectOwnerWan30FirstLastGenerationContext,
  releaseOwnerWan30FirstLastGenerationContext,
  releaseOwnerWan30FirstLastUploadedFrame
} from "../src/adapter/syntx/owner-wan30-first-last-native-context.js";

const native = await import("../src/adapter/syntx/owner-wan30-first-last-native-context.js");
const image = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x01, 0x2c, 0x01, 0x01, 0x11, 0,
  0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
const FIRST_URL = "https://r2.syntx.ai/uploads/first.png";
const LAST_URL = "https://r2.syntx.ai/uploads/last.png";

function makeClient() {
  const observed: Array<{ method: string; path: string; body: unknown }> = [];
  let uploadNumber = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: {
    async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-frame-token"); }
  }, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "POST" && init?.body instanceof FormData) {
      const body = init.body;
      observed.push({ method, path: url.pathname, body: {
        destination: body.get("destination"), check_duplicates: body.get("check_duplicates"),
        model_type: body.get("model_type"), filename: (body.get("files") as File | null)?.name
      } });
      uploadNumber += 1;
      return Response.json({ files: [{ id: `private-file-${uploadNumber}`, url: uploadNumber === 1 ? FIRST_URL : LAST_URL }] });
    }
    const body = method === "POST" && typeof init?.body === "string" ? JSON.parse(init.body) : null;
    observed.push({ method, path: url.pathname, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: "wan30-fl-chat-1" });
    if (url.pathname === "/api/v1/video/generate" && method === "POST") return Response.json({ id: "wan30-fl-message-1" });
    if (url.pathname === "/api/v1/chats/wan30-fl-chat-1/wan30-fl-message-1" && method === "GET") return Response.json({
      id: "wan30-fl-message-1", chat_id: 421, author_id: -1,
      message_object: [{ id: "wan30-fl-video-1", object_type: "video", object_url: "https://r2.syntx.ai/result.mp4",
        model_type: "wan_30_first_last_frame", completed: true }]
    });
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  } });
  return { client, observed };
}

function frameReceipt(filename: string) {
  return native.validateOwnerWan30FirstLastFrameInput({ filename, mime_type: "image/jpeg", bytes: image });
}
const intent = Object.freeze({ model_id: "wan_30_first_last_frame" as const, prompt: "Move from blue cube to red paper boat.",
  parameters: Object.freeze({ aspect_ratio: "16:9" as const, resolution: "480P" as const, video_duration: 2 as const,
    prompt_extend: true as const, seed: null, native_audio: false as const, rendering_speed: "basic" as const }) });

test("First/Last local receipt contains metadata only and release is idempotence-safe", () => {
  const receipt = native.validateOwnerWan30FirstLastFrameInput({ filename: "frame.jpg", mime_type: "image/jpeg", bytes: image });
  assert.equal(receipt.status, "LOCAL_SOURCE_VALIDATED");
  assert.equal(receipt.model_id, "wan_30_first_last_frame");
  assert.equal(receipt.mime_type, "image/jpeg");
  assert.equal(receipt.role_binding, "NOT_ESTABLISHED");
  assert.equal(receipt.owner_upload_binding, "NOT_ESTABLISHED");
  assert.equal(receipt.generation_permit, false);
  assert.equal("bytes" in receipt, false);
  assert.equal(JSON.stringify(receipt).includes("r2.syntx.ai"), false);
  assert.equal(native.releaseOwnerWan30FirstLastFrameInput(receipt), true);
  assert.equal(native.releaseOwnerWan30FirstLastFrameInput(receipt), false);
});

test("First/Last local receipt rejects MIME mismatch and unsupported image formats", () => {
  assert.throws(() => native.validateOwnerWan30FirstLastFrameInput({
    filename: "frame.png", mime_type: "image/png", bytes: image
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_INPUT");
  assert.throws(() => native.validateOwnerWan30FirstLastFrameInput({
    filename: "frame.webp", mime_type: "image/webp", bytes: image
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_INPUT");
});

test("First/Last frame model is allowed only as an expected model in the shared strict result reader", async () => {
  const resultModule = await import("../src/adapter/syntx/owner-wan-t2v-video-result.js");
  const result = resultModule.decodeOwnerWanT2vVideoResult({
    id: "bot-1", chat_id: 421, author_id: -1,
    message_object: [{ id: "video-1", object_type: "video", object_url: "https://r2.syntx.ai/result.mp4",
      model_type: "wan_30_first_last_frame", completed: true }]
  }, { chat_uuid: "frame-chat", message_id: "bot-1", model_id: "wan_30_first_last_frame",
    provider_chat_id: "421", message_object_ids: ["video-1"] });
  assert.equal(result.message_binding, "BOUND");
  assert.equal(result.model_echo, "MATCHED");
  assert.equal(result.ready_videos.length, 1);
  assert.equal(result.backend_acceptance, "UNPROVEN");
});

test("native First/Last path binds two roles to one client and makes one typed-reference POST", async () => {
  const { client, observed } = makeClient();
  const first = await client.uploadOwnerWan30FirstLastFrame(frameReceipt("first.jpg"), "first_frame");
  const last = await client.uploadOwnerWan30FirstLastFrame(frameReceipt("last.jpg"), "last_frame");
  assert.equal(first.role, "first_frame");
  assert.equal(last.role, "last_frame");
  assert.equal(JSON.stringify(first).includes("r2.syntx.ai"), false);
  const createChat = await client.createChat("video", "owner-wan30-first-last");
  const request = { attempt_id: "link_wan30_first_last_native_1826", principal: {
    tenant_id: "tenant-1", subject_id: "owner-1", connection_id: "connection-1"
  }, chat_id: createChat.chat_uuid, intent, first_frame: first, last_frame: last };
  assert.throws(() => createOwnerWan30FirstLastGenerationContext(client, { ...request,
    first_frame: last, last_frame: first }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_CONTEXT");
  const other = makeClient().client;
  assert.throws(() => createOwnerWan30FirstLastGenerationContext(other, request),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_CONTEXT");
  const context = createOwnerWan30FirstLastGenerationContext(client, request);
  assert.equal(JSON.stringify(context).includes(FIRST_URL), false);
  assert.equal(inspectOwnerWan30FirstLastGenerationContext(client, context)?.dispatch_state, "READY");
  const receipt = await client.startOwnerWan30FirstLastVideoWithContext(context);
  assert.equal(receipt.message_id, "wan30-fl-message-1");
  const uploadPosts = observed.filter((entry) => entry.path === "/api/v1/chats/upload-files");
  assert.equal(uploadPosts.length, 2);
  assert.deepEqual(uploadPosts.map((entry) => entry.body), [
    { destination: "uploaded", check_duplicates: "true", model_type: "wan_30_first_last_frame", filename: "first.jpg" },
    { destination: "uploaded", check_duplicates: "true", model_type: "wan_30_first_last_frame", filename: "last.jpg" }
  ]);
  const posts = observed.filter((entry) => entry.path === "/api/v1/video/generate");
  assert.equal(posts.length, 1);
  const body = posts[0]?.body as { chat_id: string; prompt: string; settings: Record<string, unknown> };
  assert.equal(body.chat_id, "wan30-fl-chat-1");
  assert.equal(typeof body.chat_id, "string");
  assert.deepEqual(Object.keys(body.settings).sort(), ["model_type", "file_urls", "aspect_ratio", "resolution", "video_duration",
    "prompt_extend", "shot_type", "audio_setting", "seed", "native_audio", "duration", "rendering_speed"].sort());
  assert.deepEqual(body.settings.file_urls, [{ type: "first_frame", url: FIRST_URL }, { type: "last_frame", url: LAST_URL }]);
  assert.equal(inspectOwnerWan30FirstLastGenerationContext(client, context)?.dispatch_state, "RESERVED");
  const result = await client.getWanT2vVideoResultMessage({ chat_uuid: "wan30-fl-chat-1", message_id: "wan30-fl-message-1",
    model_id: "wan_30_first_last_frame", provider_chat_id: "421", message_object_ids: ["wan30-fl-video-1"] });
  assert.equal(result.message_binding, "BOUND");
  assert.equal(result.model_echo, "MATCHED");
  assert.equal(result.ready_videos.length, 1);
  await assert.rejects(client.startOwnerWan30FirstLastVideoWithContext(context));
  assert.equal(observed.filter((entry) => entry.path === "/api/v1/video/generate").length, 1);
  assert.equal(releaseOwnerWan30FirstLastGenerationContext(client, context), true);
  assert.equal(inspectOwnerWan30FirstLastGenerationContext(client, context), null);
});

test("releases the remaining URL after one frame reference was already released", async () => {
  const { client } = makeClient();
  const first = await client.uploadOwnerWan30FirstLastFrame(frameReceipt("first.jpg"), "first_frame");
  const last = await client.uploadOwnerWan30FirstLastFrame(frameReceipt("last.jpg"), "last_frame");
  const chat = await client.createChat("video", "owner-wan30-first-last-release");
  const context = createOwnerWan30FirstLastGenerationContext(client, { attempt_id: "link_wan30_first_last_native_1826",
    principal: { tenant_id: "tenant-1", subject_id: "owner-1", connection_id: "connection-1" },
    chat_id: chat.chat_uuid, intent, first_frame: first, last_frame: last });
  assert.equal(releaseOwnerWan30FirstLastUploadedFrame(client, first), true);
  assert.equal(releaseOwnerWan30FirstLastGenerationContext(client, context), true);
  assert.equal(inspectOwnerWan30FirstLastGenerationContext(client, context), null);
  assert.equal(releaseOwnerWan30FirstLastUploadedFrame(client, last), false);
});
