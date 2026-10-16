import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import {
  createOwnerWan30ReferenceGenerationContext,
  inspectOwnerWan30ReferenceGenerationContext,
  readOwnerWan30ReferencePrivateWireBinding,
  releaseOwnerWan30ReferenceGenerationContext,
  validateOwnerWan30ReferenceImageInput
} from "../src/adapter/syntx/owner-wan30-reference-native-context.js";
import type { OwnerWan30ReferenceUploadedImage } from "../src/adapter/syntx/owner-wan30-reference-native-context.js";
import {
  normalizeOwnerWan30ReferenceGenerationIntent
} from "../src/application/owner-wan30-reference-generation-parameters.js";

const native = await import("../src/adapter/syntx/owner-wan30-reference-native-context.js");
const image = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x01, 0x2c, 0x01, 0x01, 0x11, 0,
  0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
const IMAGE_URL = "https://r2.syntx.ai/uploads/reference.png";
const RESULT_URL = "https://r2.syntx.ai/result/reference.mp4";
const REFERENCE_WIRE_PROMPT = `<<<${IMAGE_URL}>>> A red paper boat on a quiet blue lake. `;
const MODEL_ID = "wan_30_reference" as const;

function parameters() {
  return { aspect_ratio: "16:9" as const, resolution: "480P" as const, video_duration: 2 as const,
    prompt_extend: true as const, shot_type: "single" as const, audio_setting: "auto" as const, seed: null,
    native_audio: false as const, duration: 0 as const, rendering_speed: "basic" as const };
}

function makeClient() {
  const observed: Array<{ method: string; path: string; body: unknown }> = [];
  let ackMode: "exact_wire_prompt" | "plain_prompt" | "wrong_image_url" = "exact_wire_prompt";
  const client = new SyntxChatHttpClient({ credentialBroker: {
    async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-reference-token"); }
  }, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "POST" && init?.body instanceof FormData) {
      const form = init.body;
      observed.push({ method, path: url.pathname, body: {
        destination: form.get("destination"), check_duplicates: form.get("check_duplicates"),
        model_type: form.get("model_type"), filename: (form.get("files") as File | null)?.name
      } });
      return Response.json({ files: [{ id: "reference-file-1", url: IMAGE_URL }] });
    }
    const body = method === "POST" && typeof init?.body === "string" ? JSON.parse(init.body) : null;
    observed.push({ method, path: url.pathname, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: "reference-chat-1" });
    if (url.pathname === "/api/v1/video/generate" && method === "POST") return Response.json({ id: 5001 });
    if (url.pathname === "/api/v1/chats/reference-chat-1/5001" && method === "GET") return Response.json({
      id: 5001, chat_id: 421, author_id: 17, created_at: "2026-10-16T10:00:00Z",
      updated_at: "2026-10-16T10:00:00Z", is_favorite: false,
      message_object: [
        { id: "reference-ack-text", message_id: 5001, object_type: "text",
          object_text: ackMode === "exact_wire_prompt" ? REFERENCE_WIRE_PROMPT : "A red paper boat on a quiet blue lake.",
          object_url: null, task_id: null, completed: true, model_type: MODEL_ID, metadata: {},
          created_at: "2026-10-16T10:00:00Z", updated_at: "2026-10-16T10:00:00Z" },
        { id: "reference-ack-image", message_id: 5001, object_type: "image",
          object_url: ackMode === "wrong_image_url" ? "https://r2.syntx.ai/uploads/other.png" : IMAGE_URL,
          object_text: null, completed: true, model_type: MODEL_ID, metadata: {},
          created_at: "2026-10-16T10:00:00Z", updated_at: "2026-10-16T10:00:00Z" }
      ]
    });
    if (url.pathname === "/api/v1/chats/reference-chat-1/reference-bot-1" && method === "GET") return Response.json({
      id: "reference-bot-1", chat_id: 421, author_id: -1,
      message_object: [{ id: "reference-video-1", object_type: "video", object_url: RESULT_URL,
        model_type: MODEL_ID, completed: true }]
    });
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  } });
  return { client, observed, setAckMode(mode: "exact_wire_prompt" | "plain_prompt" | "wrong_image_url") { ackMode = mode; } };
}

function imageReceipt() {
  return validateOwnerWan30ReferenceImageInput({ filename: "reference.jpg", mime_type: "image/jpeg", bytes: image });
}

function makeIntent(prompt = "A red paper boat on a quiet blue lake.") {
  return normalizeOwnerWan30ReferenceGenerationIntent({ prompt, parameters: parameters() }).intent;
}

function generationInput(chatId: string, referenceImage: OwnerWan30ReferenceUploadedImage, prompt = "A red paper boat on a quiet blue lake.") {
  return { attempt_id: "link_wan30_reference_native_1868", principal: {
    tenant_id: "tenant-reference", subject_id: "owner-reference", connection_id: "connection-reference"
  }, chat_id: chatId, intent: makeIntent(prompt), reference_image: referenceImage };
}

test("Reference local receipt exposes bounded image metadata only and releases idempotently", () => {
  const receipt = imageReceipt();
  assert.equal(receipt.model_id, MODEL_ID);
  assert.equal(receipt.status, "LOCAL_SOURCE_VALIDATED");
  assert.equal(receipt.upload_binding, "NOT_ESTABLISHED");
  assert.equal(receipt.generation_permit, false);
  assert.equal("bytes" in receipt, false);
  assert.equal(JSON.stringify(receipt).includes("r2.syntx.ai"), false);
  assert.equal(native.releaseOwnerWan30ReferenceImageInput(receipt), true);
  assert.equal(native.releaseOwnerWan30ReferenceImageInput(receipt), false);
});

test("Reference local validator rejects unsupported media and declared-MIME mismatch", () => {
  assert.throws(() => validateOwnerWan30ReferenceImageInput({ filename: "reference.png", mime_type: "image/png", bytes: image }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_INPUT");
  assert.throws(() => validateOwnerWan30ReferenceImageInput({ filename: "reference.mp4", mime_type: "video/mp4", bytes: image }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_INPUT");
  assert.throws(() => validateOwnerWan30ReferenceImageInput({ filename: "oversize.jpg", mime_type: "image/jpeg",
    bytes: new Uint8Array(7 * 1024 * 1024 + 1) }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_INPUT");
});

test("Reference native upload uses fixed single-model tuple and keeps returned URL private", async () => {
  const { client, observed } = makeClient();
  const receipt = imageReceipt();
  const concurrent = await Promise.allSettled([
    client.uploadWan30ReferenceImage(receipt),
    client.uploadWan30ReferenceImage(receipt)
  ]);
  const successful = concurrent.filter((entry) => entry.status === "fulfilled");
  const failed = concurrent.filter((entry) => entry.status === "rejected");
  assert.equal(successful.length, 1);
  assert.equal(failed.length, 1);
  assert.ok(failed[0]?.status === "rejected" && failed[0].reason instanceof Error &&
    "code" in failed[0].reason && failed[0].reason.code === "INVALID_INPUT");
  const uploaded = successful[0]?.status === "fulfilled" ? successful[0].value : null;
  assert.ok(uploaded);
  assert.equal(uploaded.model_id, MODEL_ID);
  assert.equal(uploaded.reference_type, "image");
  assert.equal(uploaded.upload_profile_confidence, "OWNER_IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED");
  assert.equal(JSON.stringify(uploaded).includes("r2.syntx.ai"), false);
  assert.deepEqual(observed.filter((entry) => entry.path === "/api/v1/chats/upload-files").map((entry) => entry.body), [
    { destination: "uploaded", check_duplicates: "true", model_type: MODEL_ID, filename: "reference.jpg" }
  ]);
});

test("Reference context binds same-client uploaded image and reserves the observed prompt/wire tuple once", async () => {
  const { client, observed } = makeClient();
  const uploaded = await client.uploadWan30ReferenceImage(imageReceipt());
  const chat = await client.createChat("video", "owner-wan30-reference-1868");
  const context = createOwnerWan30ReferenceGenerationContext(client, generationInput(chat.chat_uuid, uploaded));
  assert.equal(JSON.stringify(context).includes(IMAGE_URL), false);
  assert.equal(inspectOwnerWan30ReferenceGenerationContext(client, context)?.dispatch_state, "READY");
  const wireBefore = readOwnerWan30ReferencePrivateWireBinding(client, context);
  assert.deepEqual(wireBefore, { prompt: `<<<${IMAGE_URL}>>> A red paper boat on a quiet blue lake. `, reference_url: IMAGE_URL });
  assert.equal(readOwnerWan30ReferencePrivateWireBinding(makeClient().client, context), null);
  const receipt = await client.generateWan30ReferenceVideo(context);
  assert.equal(receipt.message_id, "5001");
  const post = observed.find((entry) => entry.path === "/api/v1/video/generate");
  assert.ok(post);
  const body = post.body as { chat_id: string; prompt: string; settings: Record<string, unknown> };
  assert.equal(body.prompt, `<<<${IMAGE_URL}>>> A red paper boat on a quiet blue lake. `);
  assert.deepEqual(body.settings.file_urls, [{ type: "image", url: IMAGE_URL }]);
  assert.equal(body.settings.model_type, MODEL_ID);
  assert.equal(body.settings.aspect_ratio, "16:9");
  assert.deepEqual(Object.keys(body.settings).sort(), ["model_type", "file_urls", ...Object.keys(parameters())].sort());
  assert.equal(inspectOwnerWan30ReferenceGenerationContext(client, context)?.dispatch_state, "RESERVED");
  assert.deepEqual(readOwnerWan30ReferencePrivateWireBinding(client, context), wireBefore);
  await assert.rejects(client.generateWan30ReferenceVideo(context));
  assert.equal(observed.filter((entry) => entry.path === "/api/v1/video/generate").length, 1);
  assert.equal(releaseOwnerWan30ReferenceGenerationContext(client, context), true);
  assert.equal(inspectOwnerWan30ReferenceGenerationContext(client, context), null);
  assert.equal(readOwnerWan30ReferencePrivateWireBinding(client, context), null);
});

test("Reference context rejects other clients, swapped model and caller prompt delimiters", async () => {
  const { client } = makeClient();
  const uploaded = await client.uploadWan30ReferenceImage(imageReceipt());
  const chat = await client.createChat("video", "owner-wan30-reference-negative");
  const request = generationInput(chat.chat_uuid, uploaded);
  const other = makeClient().client;
  assert.throws(() => createOwnerWan30ReferenceGenerationContext(other, request),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_CONTEXT");
  const swappedModel = { ...request, intent: { ...request.intent, model_id: "wan_30_t2v" } } as unknown;
  assert.throws(() => createOwnerWan30ReferenceGenerationContext(client, swappedModel as never),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_CONTEXT");
  assert.throws(() => makeIntent("user <<< injected reference >>>"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_PARAMETERS");
});

test("Reference image can be reconciled through the strict model-bound WAN result reader", async () => {
  const { client, observed, setAckMode } = makeClient();
  const uploaded = await client.uploadWan30ReferenceImage(imageReceipt());
  const chat = await client.createChat("video", "owner-wan30-reference-result");
  const context = createOwnerWan30ReferenceGenerationContext(client, generationInput(chat.chat_uuid, uploaded));
  const sent = await client.generateWan30ReferenceVideo(context);
  assert.equal(sent.message_id, "5001");
  const other = makeClient();
  const foreignBinding = await other.client.getWan30ReferenceOwnerAckBinding(context, sent.message_id);
  assert.deepEqual(foreignBinding, { status: "UNVERIFIED", reason: "CONTEXT_NOT_RESERVED" });
  assert.equal(other.observed.filter((entry) => entry.path.endsWith("/5001")).length, 0);
  const ack = await client.getWan30ReferenceOwnerAckBinding(context, sent.message_id);
  assert.deepEqual(ack, { status: "BOUND" });
  setAckMode("plain_prompt");
  const plainPromptOnly = await client.getWan30ReferenceOwnerAckBinding(context, sent.message_id);
  assert.deepEqual(plainPromptOnly, { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" });
  setAckMode("wrong_image_url");
  const wrongImage = await client.getWan30ReferenceOwnerAckBinding(context, sent.message_id);
  assert.deepEqual(wrongImage, { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" });
  assert.equal(observed.filter((entry) => entry.path === "/api/v1/chats/reference-chat-1/5001" && entry.method === "GET").length, 3);
  const result = await client.getWanT2vVideoResultMessage({ chat_uuid: chat.chat_uuid, message_id: "reference-bot-1",
    model_id: MODEL_ID, provider_chat_id: "421", message_object_ids: ["reference-video-1"] });
  assert.equal(result.message_binding, "BOUND");
  assert.equal(result.model_echo, "MATCHED");
  assert.equal(result.ready_videos.length, 1);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal(observed.filter((entry) => entry.path === "/api/v1/chats/reference-chat-1/reference-bot-1").length, 1);
  assert.equal(releaseOwnerWan30ReferenceGenerationContext(client, context), true);
  const afterRelease = await client.getWan30ReferenceOwnerAckBinding(context, sent.message_id);
  assert.deepEqual(afterRelease, { status: "UNVERIFIED", reason: "CONTEXT_NOT_RESERVED" });
  assert.equal(observed.filter((entry) => entry.path === "/api/v1/chats/reference-chat-1/5001" && entry.method === "GET").length, 3);
});
