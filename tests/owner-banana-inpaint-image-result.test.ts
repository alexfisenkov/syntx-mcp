import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/adapter/syntx/owner-banana-inpaint-image-result.js", import.meta.url).href;
const decoderModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;

test("returns every ready image object observed in the exact trusted bot message", () => {
  assert.ok(decoderModule, "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER_MODULE");
  const decode = decoderModule.decodeOwnerBananaInpaintImageResult as (raw: unknown, context: unknown) => unknown;
  assert.equal(typeof decode, "function", "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER");
  const context = { chat_uuid: "inpaint-chat-123", message_id: "bot-message-17", provider_chat_id: "412" };
  const raw = {
    id: "bot-message-17", chat_id: 412, author_id: -1,
    message_object: [
      { id: "object-1", object_type: "image", object_url: "https://r2.syntx.ai/inpaint/result-a.png", completed: true },
      { id: "object-2", object_type: "image_url", object_url: "https://r2.syntx.ai/inpaint/result-b.webp", completed: true }
    ]
  };
  assert.deepEqual(decode(raw, context), {
    chat_uuid: "inpaint-chat-123", message_id: "bot-message-17", provider_chat_id: "412",
    message_binding: "BOUND",
    ready_images: [
      { object_index: 0, object_type: "image", object_url: "https://r2.syntx.ai/inpaint/result-a.png", message_object_id: "object-1" },
      { object_index: 1, object_type: "image_url", object_url: "https://r2.syntx.ai/inpaint/result-b.webp", message_object_id: "object-2" }
    ],
    gaps: []
  });
});

test("rejects a raw provider chat ID that conflicts with the trusted history context", () => {
  assert.ok(decoderModule, "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER_MODULE");
  const decode = decoderModule.decodeOwnerBananaInpaintImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  assert.equal(typeof decode, "function", "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER");
  const context = { chat_uuid: "inpaint-chat-123", message_id: "bot-message-17", provider_chat_id: "412" };
  const raw = {
    id: "bot-message-17", chat_id: 413, author_id: -1,
    message_object: [{ id: "object-1", object_type: "image", object_url: "https://r2.syntx.ai/inpaint/result-a.png", completed: true }]
  };
  const result = decode(raw, context);
  assert.equal(result.message_binding, "UNVERIFIED");
  assert.deepEqual(result.ready_images, []);
  assert.deepEqual(result.gaps, [{ object_index: null, code: "PROVIDER_CHAT_ID_MISMATCH" }]);
});

test("reports an explicit gap and withholds images when the raw message ID is wrong", () => {
  assert.ok(decoderModule, "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER_MODULE");
  const decode = decoderModule.decodeOwnerBananaInpaintImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  assert.equal(typeof decode, "function", "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER");
  const result = decode({ id: "foreign-message", author_id: -1, message_object: [
    { object_type: "image", object_url: "https://r2.syntx.ai/inpaint/foreign.png", completed: true }
  ] }, { chat_uuid: "inpaint-chat-123", message_id: "bot-message-17" });
  assert.equal(result.message_binding, "UNVERIFIED");
  assert.deepEqual(result.ready_images, []);
  assert.deepEqual(result.gaps, [{ object_index: null, code: "OUTER_MESSAGE_ID_MISMATCH" }]);
});

test("keeps valid ready images and reports sibling incomplete or unsupported objects", () => {
  assert.ok(decoderModule, "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER_MODULE");
  const decode = decoderModule.decodeOwnerBananaInpaintImageResult as (raw: unknown, context: unknown) => unknown;
  const result = decode({
    id: "bot-message-17", author_id: -1,
    message_object: [
      { id: "ready-1", object_type: "image", object_url: "https://r2.syntx.ai/inpaint/ready.png", completed: true },
      { id: "unfinished-2", object_type: "image", completed: false },
      { id: "video-3", object_type: "video", object_url: "https://r2.syntx.ai/inpaint/video.mp4", completed: true }
    ]
  }, { chat_uuid: "inpaint-chat-123", message_id: "bot-message-17" });
  assert.deepEqual(result, {
    chat_uuid: "inpaint-chat-123", message_id: "bot-message-17", message_binding: "BOUND",
    ready_images: [{ object_index: 0, object_type: "image", object_url: "https://r2.syntx.ai/inpaint/ready.png", message_object_id: "ready-1" }],
    gaps: [
      { object_index: 1, code: "OBJECT_INCOMPLETE" },
      { object_index: 2, code: "OBJECT_TYPE_UNSUPPORTED" }
    ]
  });
});

test("represents all-incomplete or URL-missing messages as gaps rather than a progress status", () => {
  assert.ok(decoderModule, "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER_MODULE");
  const decode = decoderModule.decodeOwnerBananaInpaintImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  const result = decode({ id: "bot-message-17", author_id: -1, message_object: [
    { object_type: "image", completed: false },
    { object_type: "image_url", completed: true, object_url: "" }
  ] }, { chat_uuid: "inpaint-chat-123", message_id: "bot-message-17" });
  assert.equal(result.message_binding, "BOUND");
  assert.equal("status" in result, false);
  assert.deepEqual(result.ready_images, []);
  assert.deepEqual(result.gaps, [
    { object_index: 0, code: "OBJECT_INCOMPLETE" },
    { object_index: 1, code: "OBJECT_URL_MISSING" }
  ]);
});

test("marks foreign bot authors and malformed envelopes unverified without returning URLs", () => {
  assert.ok(decoderModule, "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER_MODULE");
  const decode = decoderModule.decodeOwnerBananaInpaintImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  const context = { chat_uuid: "inpaint-chat-123", message_id: "bot-message-17" };
  const readyObject = { object_type: "image", object_url: "https://r2.syntx.ai/inpaint/secret.png", completed: true };
  const cases = [
    [{ id: "bot-message-17", author_id: 7, message_object: [readyObject] }, "UNVERIFIED", "NOT_BOT_MESSAGE"],
    [{ id: "bot-message-17", author_id: -1 }, "BOUND", "MESSAGE_OBJECT_ARRAY_INVALID"],
    [null, "UNVERIFIED", "ENVELOPE_SHAPE_INVALID"]
  ] as const;
  for (const [raw, binding, code] of cases) {
    const result = decode(raw, context);
    assert.equal(result.message_binding, binding);
    assert.deepEqual(result.ready_images, []);
    assert.deepEqual(result.gaps, [{ object_index: null, code }]);
    assert.equal(JSON.stringify(result).includes("secret.png"), false);
  }
});

test("retains safe ready objects but reports unknown fields without echoing their values", () => {
  assert.ok(decoderModule, "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER_MODULE");
  const decode = decoderModule.decodeOwnerBananaInpaintImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  const raw = {
    id: "bot-message-17", author_id: -1, private_prompt: "not-for-output",
    message_object: [{ id: "object-1", object_type: "image", object_url: "https://r2.syntx.ai/inpaint/ready.png",
      completed: true, model_type: "not-bound-by-this-decoder" }]
  };
  const result = decode(raw, { chat_uuid: "inpaint-chat-123", message_id: "bot-message-17" });
  assert.equal(result.message_binding, "BOUND");
  assert.deepEqual(result.ready_images, [{ object_index: 0, object_type: "image",
    object_url: "https://r2.syntx.ai/inpaint/ready.png", message_object_id: "object-1" }]);
  assert.deepEqual(result.gaps, [
    { object_index: null, code: "UNRECOGNIZED_MESSAGE_FIELDS" },
    { object_index: 0, code: "UNRECOGNIZED_OBJECT_FIELDS" }
  ]);
  assert.equal(JSON.stringify(result).includes("not-for-output"), false);
  assert.equal(JSON.stringify(result).includes("not-bound-by-this-decoder"), false);
});

test("unsafe output URLs produce an indexed gap and never escape the internal result", () => {
  assert.ok(decoderModule, "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER_MODULE");
  const decode = decoderModule.decodeOwnerBananaInpaintImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  const unsafe = "https://evil.invalid/inpaint/private.png";
  const result = decode({ id: "bot-message-17", author_id: -1, message_object: [
    { object_type: "image", object_url: unsafe, completed: true }
  ] }, { chat_uuid: "inpaint-chat-123", message_id: "bot-message-17" });
  assert.equal(result.message_binding, "BOUND");
  assert.deepEqual(result.ready_images, []);
  assert.deepEqual(result.gaps, [{ object_index: 0, code: "OBJECT_URL_UNSAFE" }]);
  assert.equal(JSON.stringify(result).includes("evil.invalid"), false);
});

test("rejects accessor and proxy inputs without invoking getters or proxy traps", () => {
  assert.ok(decoderModule, "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER_MODULE");
  const decode = decoderModule.decodeOwnerBananaInpaintImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  let getterReads = 0;
  let proxyTraps = 0;
  const accessorRaw: Record<string, unknown> = { author_id: -1, message_object: [] };
  Object.defineProperty(accessorRaw, "id", { enumerable: true, get() { getterReads += 1; return "bot-message-17"; } });
  const accessorResult = decode(accessorRaw, { chat_uuid: "inpaint-chat-123", message_id: "bot-message-17" });
  assert.equal(accessorResult.message_binding, "UNVERIFIED");
  assert.equal(getterReads, 0);
  const proxiedRaw = new Proxy({ id: "bot-message-17", author_id: -1, message_object: [] }, {
    getPrototypeOf() { proxyTraps += 1; throw new Error("must not run"); }
  });
  const proxyResult = decode(proxiedRaw, { chat_uuid: "inpaint-chat-123", message_id: "bot-message-17" });
  assert.equal(proxyResult.message_binding, "UNVERIFIED");
  assert.equal(proxyTraps, 0);
  const badContext: Record<string, unknown> = { chat_uuid: "inpaint-chat-123" };
  Object.defineProperty(badContext, "message_id", { enumerable: true, get() { getterReads += 1; return "bot-message-17"; } });
  assert.throws(() => decode({ id: "bot-message-17", author_id: -1, message_object: [] }, badContext), TypeError);
  assert.equal(getterReads, 0);
});

test("a malformed or accessor-backed message object entry becomes an indexed gap", () => {
  assert.ok(decoderModule, "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER_MODULE");
  const decode = decoderModule.decodeOwnerBananaInpaintImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  let getterReads = 0;
  const entry: Record<string, unknown> = { id: "object-1", object_type: "image", completed: true };
  Object.defineProperty(entry, "object_url", { enumerable: true, get() { getterReads += 1; return "https://r2.syntx.ai/x.png"; } });
  const result = decode({ id: "bot-message-17", author_id: -1, message_object: [entry, null] },
    { chat_uuid: "inpaint-chat-123", message_id: "bot-message-17" });
  assert.equal(result.message_binding, "BOUND");
  assert.deepEqual(result.ready_images, []);
  assert.deepEqual(result.gaps, [
    { object_index: 0, code: "OBJECT_ENTRY_INVALID" },
    { object_index: 1, code: "OBJECT_ENTRY_INVALID" }
  ]);
  assert.equal(getterReads, 0);
});

test("invalid sparse arrays and arrays above the local ceiling are never truncated into ready output", () => {
  assert.ok(decoderModule, "MISSING_BANANA_INPAINT_IMAGE_RESULT_DECODER_MODULE");
  const decode = decoderModule.decodeOwnerBananaInpaintImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  const context = { chat_uuid: "inpaint-chat-123", message_id: "bot-message-17" };
  const sparse = Array(2);
  sparse[1] = { object_type: "image", object_url: "https://r2.syntx.ai/inpaint/late.png", completed: true };
  const sparseResult = decode({ id: "bot-message-17", author_id: -1, message_object: sparse }, context);
  assert.equal(sparseResult.message_binding, "BOUND");
  assert.deepEqual(sparseResult.ready_images, []);
  assert.deepEqual(sparseResult.gaps, [{ object_index: null, code: "MESSAGE_OBJECT_ARRAY_INVALID" }]);

  const tooMany = Array.from({ length: 65 }, (_, index) => ({ object_type: "image", object_url: `https://r2.syntx.ai/inpaint/${index}.png`, completed: true }));
  const limitedResult = decode({ id: "bot-message-17", author_id: -1, message_object: tooMany }, context);
  assert.equal(limitedResult.message_binding, "BOUND");
  assert.deepEqual(limitedResult.ready_images, []);
  assert.deepEqual(limitedResult.gaps, [{ object_index: null, code: "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT" }]);
});
