import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import {
  createOwnerWan30OmniGenerationContext,
  readOwnerWan30OmniPrivateWireBinding,
  releaseOwnerWan30OmniGenerationContext,
  releaseOwnerWan30OmniImageInput,
  validateOwnerWan30OmniImageInput
} from "../src/adapter/syntx/owner-wan30-omni-native-context.js";
import type { OwnerWan30OmniUploadedImage } from "../src/adapter/syntx/owner-wan30-omni-native-context.js";
import { normalizeOwnerWan30OmniGenerationIntent } from "../src/application/owner-wan30-omni-generation-parameters.js";

const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x01, 0x2c, 0x01, 0x01, 0x11, 0,
  0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
const IMAGE_URL = "https://r2.syntx.ai/uploads/omni.png";
const RESULT_URL = "https://r2.syntx.ai/result/omni.mp4";
const MODEL_ID = "wan_30_omni" as const;
const PROMPT = "A copper kite crossing a soft blue sky.";
const WIRE_PROMPT = `<<<${IMAGE_URL}>>> ${PROMPT} `;

function parameters() {
  return { aspect_ratio: "16:9" as const, resolution: "480P" as const, video_duration: 2 as const,
    prompt_extend: true as const, shot_type: "single" as const, audio_setting: "auto" as const, seed: null,
    native_audio: false as const, duration: 0 as const, rendering_speed: "basic" as const };
}

function makeClient(ackMode: "exact" | "plain" | "wrong_url" = "exact") {
  const observed: Array<{ method: string; path: string; body: unknown }> = [];
  let responseMode = ackMode;
  const client = new SyntxChatHttpClient({ credentialBroker: {
    async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-omni-token"); }
  }, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "POST" && init?.body instanceof FormData) {
      const form = init.body;
      observed.push({ method, path: url.pathname, body: {
        destination: form.get("destination"), check_duplicates: form.get("check_duplicates"),
        model_type: form.get("model_type"), filename: (form.get("files") as File | null)?.name
      } });
      return Response.json({ files: [{ id: "omni-file-1", url: IMAGE_URL }] });
    }
    const body = method === "POST" && typeof init?.body === "string" ? JSON.parse(init.body) : null;
    observed.push({ method, path: url.pathname, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: "omni-chat-1" });
    if (url.pathname === "/api/v1/video/generate" && method === "POST") return Response.json({ id: 5201 });
    if (url.pathname === "/api/v1/chats/omni-chat-1/5201" && method === "GET") return Response.json({
      id: 5201, chat_id: 422, author_id: 17, created_at: "2026-10-16T10:00:00Z",
      updated_at: "2026-10-16T10:00:00Z", is_favorite: false,
      message_object: [
        { id: "omni-ack-text", message_id: 5201, object_type: "text",
          object_text: responseMode === "plain" ? PROMPT : WIRE_PROMPT, object_url: null,
          task_id: null, completed: true, model_type: MODEL_ID, metadata: {},
          created_at: "2026-10-16T10:00:00Z", updated_at: "2026-10-16T10:00:00Z" },
        { id: "omni-ack-image", message_id: 5201, object_type: "image",
          object_url: responseMode === "wrong_url" ? "https://r2.syntx.ai/uploads/not-owned.png" : IMAGE_URL,
          object_text: null, completed: true, model_type: MODEL_ID, metadata: {},
          created_at: "2026-10-16T10:00:00Z", updated_at: "2026-10-16T10:00:00Z" }
      ]
    });
    if (url.pathname === "/api/v1/chats/omni-chat-1/omni-bot-1" && method === "GET") return Response.json({
      id: "omni-bot-1", chat_id: 422, author_id: -1,
      message_object: [{ id: "omni-video-1", object_type: "video", object_url: RESULT_URL,
        model_type: MODEL_ID, completed: true }]
    });
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  } });
  return { client, observed, setAckMode(mode: "exact" | "plain" | "wrong_url") { responseMode = mode; } };
}

function imageReceipt() {
  return validateOwnerWan30OmniImageInput({ filename: "omni.jpg", mime_type: "image/jpeg", bytes: IMAGE });
}

function intent(prompt = PROMPT) {
  return normalizeOwnerWan30OmniGenerationIntent({ prompt, parameters: parameters() }).intent;
}

function contextInput(chatId: string, referenceImage: OwnerWan30OmniUploadedImage) {
  return { attempt_id: "link_wan30_omni_native_1884", principal: {
    tenant_id: "tenant-omni", subject_id: "owner-omni", connection_id: "connection-omni"
  }, chat_id: chatId, intent: intent(), reference_image: referenceImage };
}

test("Omni image input receipt is bounded, URL-free, and release is idempotent", () => {
  const receipt = imageReceipt();
  assert.equal(receipt.model_id, MODEL_ID);
  assert.equal(receipt.status, "LOCAL_SOURCE_VALIDATED");
  assert.equal(receipt.upload_binding, "NOT_ESTABLISHED");
  assert.equal(receipt.generation_permit, false);
  assert.equal("bytes" in receipt, false);
  assert.equal(releaseOwnerWan30OmniImageInput(receipt), true);
  assert.equal(releaseOwnerWan30OmniImageInput(receipt), false);
  assert.throws(() => validateOwnerWan30OmniImageInput({ filename: "omni.mp4", mime_type: "video/mp4", bytes: IMAGE }));
});

test("Omni native upload binds the fixed inferred tuple once and generation uses the owned image wire prompt", async () => {
  const { client, observed } = makeClient();
  const receipt = imageReceipt();
  const uploads = await Promise.allSettled([client.uploadWan30OmniImage(receipt), client.uploadWan30OmniImage(receipt)]);
  assert.equal(uploads.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(uploads.filter((entry) => entry.status === "rejected").length, 1);
  const uploaded = uploads.find((entry) => entry.status === "fulfilled");
  assert.ok(uploaded && uploaded.status === "fulfilled");
  assert.equal(uploaded.value.model_id, MODEL_ID);
  assert.equal(uploaded.value.upload_profile_confidence, "OWNER_IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED");
  assert.equal(JSON.stringify(uploaded.value).includes(IMAGE_URL), false);
  assert.deepEqual(observed.filter((entry) => entry.path === "/api/v1/chats/upload-files").map((entry) => entry.body), [
    { destination: "uploaded", check_duplicates: "true", model_type: MODEL_ID, filename: "omni.jpg" }
  ]);

  const chat = await client.createChat("video", "owner-wan30-omni-1884");
  const context = createOwnerWan30OmniGenerationContext(client, contextInput(chat.chat_uuid, uploaded.value));
  assert.equal(JSON.stringify(context).includes(IMAGE_URL), false);
  assert.deepEqual(readOwnerWan30OmniPrivateWireBinding(client, context), { prompt: WIRE_PROMPT, reference_url: IMAGE_URL });
  const receiptResult = await client.generateWan30OmniVideo(context);
  assert.equal(receiptResult.message_id, "5201");
  const post = observed.find((entry) => entry.path === "/api/v1/video/generate");
  assert.ok(post);
  const body = post.body as { chat_id: string; prompt: string; settings: Record<string, unknown> };
  assert.equal(body.prompt, WIRE_PROMPT);
  assert.deepEqual(body.settings.file_urls, [{ type: "image", url: IMAGE_URL }]);
  assert.equal(body.settings.model_type, MODEL_ID);
  assert.deepEqual(Object.keys(body.settings).sort(), ["model_type", "file_urls", ...Object.keys(parameters())].sort());
  await assert.rejects(client.generateWan30OmniVideo(context));
  assert.equal(observed.filter((entry) => entry.path === "/api/v1/video/generate").length, 1);
  assert.equal(releaseOwnerWan30OmniGenerationContext(client, context), true);
  assert.equal(readOwnerWan30OmniPrivateWireBinding(client, context), null);
});

test("Omni owner ACK requires exact same-client wire text and image URL and widens only the exact result model", async () => {
  const { client, observed, setAckMode } = makeClient();
  const uploaded = await client.uploadWan30OmniImage(imageReceipt());
  const chat = await client.createChat("video", "owner-wan30-omni-ack-1884");
  const context = createOwnerWan30OmniGenerationContext(client, contextInput(chat.chat_uuid, uploaded));
  const sent = await client.generateWan30OmniVideo(context);
  assert.equal(sent.message_id, "5201");
  const other = makeClient();
  assert.deepEqual(await other.client.getWan30OmniOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "CONTEXT_NOT_RESERVED" });
  assert.equal(other.observed.length, 0, "foreign-client ACK checks must not issue GET");
  assert.deepEqual(await client.getWan30OmniOwnerAckBinding(context, "not-numeric"),
    { status: "UNVERIFIED", reason: "MESSAGE_ID_INVALID" });
  assert.deepEqual(await client.getWan30OmniOwnerAckBinding(context, "5201"), { status: "BOUND" });
  setAckMode("plain");
  assert.deepEqual(await client.getWan30OmniOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" });
  setAckMode("wrong_url");
  assert.deepEqual(await client.getWan30OmniOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" });
  assert.equal(observed.filter((entry) => entry.path === "/api/v1/chats/omni-chat-1/5201" && entry.method === "GET").length, 3);
  const result = await client.getWanT2vVideoResultMessage({ chat_uuid: chat.chat_uuid, message_id: "omni-bot-1",
    model_id: MODEL_ID, provider_chat_id: "422", message_object_ids: ["omni-video-1"] });
  assert.equal(result.message_binding, "BOUND");
  assert.equal(result.model_echo, "MATCHED");
  assert.equal(result.ready_videos.length, 1);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal(releaseOwnerWan30OmniGenerationContext(client, context), true);
  const beforeCount = observed.length;
  assert.deepEqual(await client.getWan30OmniOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "CONTEXT_NOT_RESERVED" });
  assert.equal(observed.length, beforeCount);
});
