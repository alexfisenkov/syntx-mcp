import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import {
  createOwnerWan30ReferenceGenerationContext,
  releaseOwnerWan30ReferenceGenerationContext,
  validateOwnerWan30ReferenceImageInput
} from "../src/adapter/syntx/owner-wan30-reference-native-context.js";
import {
  normalizeOwnerWan30ReferenceGenerationIntent
} from "../src/application/owner-wan30-reference-generation-parameters.js";
import {
  createOwnerWan30OmniGenerationContext,
  releaseOwnerWan30OmniGenerationContext,
  validateOwnerWan30OmniImageInput
} from "../src/adapter/syntx/owner-wan30-omni-native-context.js";
import {
  normalizeOwnerWan30OmniGenerationIntent
} from "../src/application/owner-wan30-omni-generation-parameters.js";

type Model = "reference" | "omni";
type AckMode = "normal" | "reverse" | "duplicate_text" | "missing_image" | "wrong_model" | "wrong_text" | "wrong_url";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x01, 0x2c, 0x01, 0x01, 0x11, 0,
  0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
const MESSAGE_ID = "7204";

function parameters() {
  return { aspect_ratio: "16:9" as const, resolution: "480P" as const, video_duration: 2 as const,
    prompt_extend: true as const, shot_type: "single" as const, audio_setting: "auto" as const,
    seed: null, native_audio: false as const, duration: 0 as const, rendering_speed: "basic" as const };
}

function makeFixture(model: Model) {
  const modelId = model === "reference" ? "wan_30_reference" : "wan_30_omni";
  const chatUuid = model === "reference" ? "ack-order-reference-chat" : "ack-order-omni-chat";
  const plainPrompt = model === "reference" ? "A red paper boat on a quiet blue lake." : "A small amber lantern on still water.";
  const imageUrl = model === "reference" ? "https://r2.syntx.ai/uploads/ack-order-reference.jpg" :
    "https://r2.syntx.ai/uploads/ack-order-omni.jpg";
  const wirePrompt = `<<<${imageUrl}>>> ${plainPrompt} `;
  const observed: Array<{ method: string; path: string; body: unknown }> = [];
  let ackMode: AckMode = "normal";
  const client = new SyntxChatHttpClient({ credentialBroker: {
    async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-ack-order-token"); }
  }, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "POST" && init?.body instanceof FormData) {
      const form = init.body;
      observed.push({ method, path: url.pathname, body: { destination: form.get("destination"), check_duplicates: form.get("check_duplicates"),
        model_type: form.get("model_type"), filename: (form.get("files") as File | null)?.name } });
      return Response.json({ files: [{ id: `${model}-file-1`, url: imageUrl }] });
    }
    const body = method === "POST" && typeof init?.body === "string" ? JSON.parse(init.body) : null;
    observed.push({ method, path: url.pathname, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: chatUuid });
    if (url.pathname === "/api/v1/video/generate" && method === "POST") return Response.json({ id: Number(MESSAGE_ID) });
    if (url.pathname === `/api/v1/chats/${chatUuid}/${MESSAGE_ID}` && method === "GET") {
      const text = { id: `${model}-ack-text`, message_id: Number(MESSAGE_ID), object_type: "text",
        object_text: ackMode === "wrong_text" ? plainPrompt : wirePrompt, object_url: null,
        task_id: null, completed: true, model_type: ackMode === "wrong_model" ? "wan_30_t2v" : modelId,
        metadata: {}, created_at: "2026-10-16T10:00:00Z", updated_at: "2026-10-16T10:00:00Z" };
      const image = { id: `${model}-ack-image`, message_id: Number(MESSAGE_ID), object_type: ackMode === "duplicate_text" ? "text" : "image",
        object_text: null, object_url: ackMode === "wrong_url" ? "https://r2.syntx.ai/uploads/not-owned.png" : imageUrl,
        task_id: null, completed: true, model_type: modelId, metadata: {},
        created_at: "2026-10-16T10:00:00Z", updated_at: "2026-10-16T10:00:00Z" };
      const messageObject = ackMode === "missing_image" ? [text] : ackMode === "reverse" ? [image, text] : [text, image];
      return Response.json({ id: Number(MESSAGE_ID), chat_id: 732, author_id: 23,
        created_at: "2026-10-16T10:00:00Z", updated_at: "2026-10-16T10:00:00Z", is_favorite: false,
        message_object: messageObject });
    }
    throw new Error(`Unexpected synthetic ACK-order request: ${method} ${url.pathname}`);
  } });
  return { client, observed, chatUuid, plainPrompt, imageUrl, wirePrompt,
    setAckMode(value: AckMode) { ackMode = value; } };
}

async function prepareReservedContext(model: Model) {
  const fixture = makeFixture(model);
  const chat = await fixture.client.createChat("video", `owner-wan30-${model}-ack-order-1904`);
  if (model === "reference") {
    const imageReceipt = validateOwnerWan30ReferenceImageInput({ filename: "ack-order.jpg", mime_type: "image/jpeg", bytes: JPEG });
    const uploaded = await fixture.client.uploadWan30ReferenceImage(imageReceipt);
    const context = createOwnerWan30ReferenceGenerationContext(fixture.client, {
      attempt_id: "link_wan30_reference_ack_order_1904", principal: {
        tenant_id: "tenant-ack-order", subject_id: "owner-ack-order", connection_id: "connection-ack-order"
      }, chat_id: chat.chat_uuid,
      intent: normalizeOwnerWan30ReferenceGenerationIntent({ prompt: fixture.plainPrompt, parameters: parameters() }).intent,
      reference_image: uploaded
    });
    const dispatched = await fixture.client.generateWan30ReferenceVideo(context);
    assert.equal(dispatched.message_id, MESSAGE_ID);
    return { fixture, context };
  }
  const imageReceipt = validateOwnerWan30OmniImageInput({ filename: "ack-order.jpg", mime_type: "image/jpeg", bytes: JPEG });
  const uploaded = await fixture.client.uploadWan30OmniImage(imageReceipt);
  const context = createOwnerWan30OmniGenerationContext(fixture.client, {
    attempt_id: "link_wan30_omni_ack_order_1904", principal: {
      tenant_id: "tenant-ack-order", subject_id: "owner-ack-order", connection_id: "connection-ack-order"
    }, chat_id: chat.chat_uuid,
    intent: normalizeOwnerWan30OmniGenerationIntent({ prompt: fixture.plainPrompt, parameters: parameters() }).intent,
    reference_image: uploaded
  });
  const dispatched = await fixture.client.generateWan30OmniVideo(context);
  assert.equal(dispatched.message_id, MESSAGE_ID);
  return { fixture, context };
}

async function getBinding(model: Model, fixture: ReturnType<typeof makeFixture>, context: unknown) {
  return model === "reference"
    ? fixture.client.getWan30ReferenceOwnerAckBinding(context as never, MESSAGE_ID)
    : fixture.client.getWan30OmniOwnerAckBinding(context as never, MESSAGE_ID);
}
function releaseContext(model: Model, fixture: ReturnType<typeof makeFixture>, context: unknown) {
  return model === "reference"
    ? releaseOwnerWan30ReferenceGenerationContext(fixture.client, context)
    : releaseOwnerWan30OmniGenerationContext(fixture.client, context);
}

test("Reference ACK binds the reversed image/text response order and retains strict negatives", async () => {
  const { fixture, context } = await prepareReservedContext("reference");
  try {
    fixture.setAckMode("reverse");
    assert.deepEqual(await getBinding("reference", fixture, context), { status: "BOUND" });
    for (const [mode, expected] of [
      ["normal", { status: "BOUND" }],
      ["duplicate_text", { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" }],
      ["missing_image", { status: "UNVERIFIED", reason: "ACK_SHAPE_INVALID" }],
      ["wrong_model", { status: "UNVERIFIED", reason: "ACK_MODEL_MISMATCH" }],
      ["wrong_text", { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" }],
      ["wrong_url", { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" }]
    ] as const) {
      fixture.setAckMode(mode);
      assert.deepEqual(await getBinding("reference", fixture, context), expected, `Reference ACK case: ${mode}`);
    }
    assert.equal(fixture.observed.filter((request) => request.path.endsWith(`/${MESSAGE_ID}`) && request.method === "GET").length, 7);
  } finally { assert.equal(releaseContext("reference", fixture, context), true); }
});

test("Reference ACK binds the ordinary text/image response order", async () => {
  const { fixture, context } = await prepareReservedContext("reference");
  try {
    fixture.setAckMode("normal");
    assert.deepEqual(await getBinding("reference", fixture, context), { status: "BOUND" });
  } finally { assert.equal(releaseContext("reference", fixture, context), true); }
});

test("Omni ACK binds the reversed image/text response order and retains strict negatives", async () => {
  const { fixture, context } = await prepareReservedContext("omni");
  try {
    fixture.setAckMode("reverse");
    assert.deepEqual(await getBinding("omni", fixture, context), { status: "BOUND" });
    for (const [mode, expected] of [
      ["normal", { status: "BOUND" }],
      ["duplicate_text", { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" }],
      ["missing_image", { status: "UNVERIFIED", reason: "ACK_SHAPE_INVALID" }],
      ["wrong_model", { status: "UNVERIFIED", reason: "ACK_MODEL_MISMATCH" }],
      ["wrong_text", { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" }],
      ["wrong_url", { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" }]
    ] as const) {
      fixture.setAckMode(mode);
      assert.deepEqual(await getBinding("omni", fixture, context), expected, `Omni ACK case: ${mode}`);
    }
    assert.equal(fixture.observed.filter((request) => request.path.endsWith(`/${MESSAGE_ID}`) && request.method === "GET").length, 7);
  } finally { assert.equal(releaseContext("omni", fixture, context), true); }
});

test("Omni ACK binds the ordinary text/image response order", async () => {
  const { fixture, context } = await prepareReservedContext("omni");
  try {
    fixture.setAckMode("normal");
    assert.deepEqual(await getBinding("omni", fixture, context), { status: "BOUND" });
  } finally { assert.equal(releaseContext("omni", fixture, context), true); }
});
