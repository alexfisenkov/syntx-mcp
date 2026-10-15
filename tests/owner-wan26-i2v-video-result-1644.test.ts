import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/adapter/syntx/owner-wan26-i2v-video-result.js", import.meta.url).href;
const codecModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
function decode(raw: unknown, model_id: "wan_26_i2v" | "wan_26_i2v_flash", ids = ["i2v-video-a", "i2v-video-b"]): Record<string, unknown> {
  assert.ok(codecModule, "MISSING_OWNER_WAN26_I2V_VIDEO_RESULT_CODEC");
  const decoder = codecModule.decodeOwnerWan26I2vVideoResult as (message: unknown, context: unknown) => Record<string, unknown>;
  assert.equal(typeof decoder, "function", "MISSING_OWNER_WAN26_I2V_VIDEO_RESULT_DECODER");
  return decoder(raw, { chat_uuid: "i2v-chat", message_id: "i2v-result", provider_chat_id: "41356",
    message_object_ids: ids, model_id });
}

const i2vMessage = {
  id: "i2v-result", chat_id: 41356, author_id: -1,
  message_object: [
    { id: "i2v-video-a", message_id: "i2v-result", object_type: "video", model_type: "wan_26_i2v",
      completed: true, object_url: "https://r2.syntx.ai/generated/wan26-a.mp4" },
    { id: "i2v-video-b", message_id: "i2v-result", object_type: "video", model_type: "wan_26_i2v",
      completed: true, object_url: "https://r2.syntx.ai/generated/wan26-b.webm" }
  ]
};
const flashMessage = {
  id: "i2v-result", chat_id: 41356, author_id: -1,
  message_object: [{ id: "i2v-video-a", message_id: "i2v-result", object_type: "video", model_type: "wan_26_i2v_flash",
    completed: true, object_url: "https://r2.syntx.ai/generated/wan26-flash.mp4" }]
};

test("binds ordered video objects for each literal 26 I2V model id", () => {
  const standard = decode(i2vMessage, "wan_26_i2v") as { message_binding: string; model_echo: string;
    ready_videos: readonly Record<string, unknown>[]; gaps: readonly unknown[]; provider_terminal_status: string };
  assert.equal(standard.message_binding, "BOUND");
  assert.equal(standard.model_echo, "MATCHED");
  assert.deepEqual(standard.ready_videos.map((video) => [video.message_object_id, video.mime_type]), [
    ["i2v-video-a", "video/mp4"], ["i2v-video-b", "video/webm"]
  ]);
  assert.deepEqual(standard.gaps, []);
  assert.equal(standard.provider_terminal_status, "UNPROVEN");
  const flash = decode(flashMessage, "wan_26_i2v_flash", ["i2v-video-a"]) as {
    ready_videos: unknown[]; gaps: readonly unknown[]; result_status: string;
  };
  assert.equal(flash.ready_videos.length, 1);
  assert.deepEqual(flash.gaps, []);
  assert.equal(flash.result_status, "OBSERVED");
  const reordered = decode({ ...i2vMessage, message_object: [...i2vMessage.message_object].reverse() }, "wan_26_i2v") as {
    gaps: Array<{ code: string }>; ready_videos: unknown[];
  };
  assert.ok(reordered.gaps.some(({ code }) => code === "OBJECT_ORDER_MISMATCH"));
  assert.deepEqual(reordered.ready_videos, []);
});

test("keeps missing echo UNKNOWN, wrong echo MISMATCH, and pending distinct from ready", () => {
  const objects = [
    { id: "i2v-video-a", message_id: "i2v-result", object_type: "video", completed: true,
      object_url: "https://r2.syntx.ai/generated/no-echo.mp4" },
    { id: "i2v-video-b", message_id: "i2v-result", object_type: "video", model_type: "wan_26_i2v",
      completed: false, object_url: null }
  ];
  const result = decode({ ...i2vMessage, message_object: objects }, "wan_26_i2v") as {
    model_echo: string; ready_videos: unknown[]; pending_object_indices: number[]; gaps: Array<{ code: string }>;
  };
  assert.equal(result.model_echo, "UNKNOWN");
  assert.equal(result.ready_videos.length, 1);
  assert.deepEqual(result.pending_object_indices, [1]);
  assert.deepEqual(result.gaps.map(({ code }) => code), ["MODEL_ECHO_UNAVAILABLE", "OBJECT_NOT_COMPLETED"]);

  const mismatch = decode({ ...i2vMessage, message_object: [{ ...i2vMessage.message_object[0], model_type: "wan_27_r2v" }] },
    "wan_26_i2v", ["i2v-video-a"]) as { model_echo: string; ready_videos: unknown[]; gaps: Array<{ code: string }> };
  assert.equal(mismatch.model_echo, "MISMATCH");
  assert.deepEqual(mismatch.ready_videos, []);
  assert.deepEqual(mismatch.gaps.map(({ code }) => code), ["MODEL_ECHO_MISMATCH"]);
});

test("does not treat foreign-model error objects as target video evidence", () => {
  const foreign = { id: "i2v-result", chat_id: 41356, author_id: -1, message_object: [
    { id: "foreign-error", message_id: "i2v-result", object_type: "error", model_type: "wan_25_t2v",
      completed: true, object_url: "https://r2.syntx.ai/generated/foreign.mp4", object_text: "private error text" }
  ] };
  const result = decode(foreign, "wan_26_i2v", ["foreign-error"]) as {
    model_echo: string; ready_videos: unknown[]; gaps: Array<{ code: string }>; result_status: string; backend_error_observed: boolean;
  };
  assert.equal(result.model_echo, "MISMATCH");
  assert.deepEqual(result.ready_videos, []);
  assert.deepEqual(result.gaps.map(({ code }) => code), ["MODEL_ECHO_MISMATCH"]);
  assert.equal(result.result_status, "UNVERIFIED");
  assert.equal(result.backend_error_observed, false);
  assert.equal(JSON.stringify(result).includes("private error text"), false);

  const targetError = { id: "i2v-result", chat_id: 41356, author_id: -1, message_object: [
    { id: "i2v-error", message_id: "i2v-result", object_type: "error", model_type: "wan_26_i2v_flash",
      object_text: "private backend error details" }
  ] };
  const observedError = decode(targetError, "wan_26_i2v_flash", ["i2v-error"]) as {
    result_status: string; model_echo: string; backend_error_observed: boolean; ready_videos: unknown[]; gaps: readonly unknown[];
    provider_terminal_status: string; backend_acceptance: string;
  };
  assert.equal(observedError.result_status, "BACKEND_ERROR_OBSERVED");
  assert.equal(observedError.backend_error_observed, true);
  assert.equal(observedError.model_echo, "MATCHED");
  assert.deepEqual(observedError.ready_videos, []);
  assert.deepEqual(observedError.gaps, []);
  assert.equal(observedError.provider_terminal_status, "UNPROVEN");
  assert.equal(observedError.backend_acceptance, "UNPROVEN");
  assert.equal(JSON.stringify(observedError).includes("private backend error details"), false);

  const unknownModelError = { ...targetError, message_object: [{ id: "i2v-error", message_id: "i2v-result",
    object_type: "error", object_text: "private unknown-model error" }] };
  const unknownError = decode(unknownModelError, "wan_26_i2v_flash", ["i2v-error"]) as {
    model_echo: string; backend_error_observed: boolean; gaps: Array<{ code: string }>;
  };
  assert.equal(unknownError.model_echo, "UNKNOWN");
  assert.equal(unknownError.backend_error_observed, false);
  assert.deepEqual(unknownError.gaps.map(({ code }) => code), ["MODEL_ECHO_UNAVAILABLE"]);

  const wrongMessageError = { ...targetError, message_object: [{ ...targetError.message_object[0], message_id: "other-message" }] };
  const unboundError = decode(wrongMessageError, "wan_26_i2v_flash", ["i2v-error"]) as {
    result_status: string; backend_error_observed: boolean; gaps: Array<{ code: string }>;
  };
  assert.equal(unboundError.backend_error_observed, false);
  assert.equal(unboundError.result_status, "UNVERIFIED");
  assert.deepEqual(unboundError.gaps.map(({ code }) => code), ["OBJECT_MESSAGE_ID_MISMATCH", "EXPECTED_OBJECT_ID_MISSING"]);
  const reorderedError = { ...targetError, message_object: [{ ...targetError.message_object[0], id: "i2v-error-b" }] };
  const orderUnbound = decode(reorderedError, "wan_26_i2v_flash", ["i2v-error-a", "i2v-error-b"]) as {
    result_status: string; backend_error_observed: boolean; gaps: Array<{ code: string }>;
  };
  assert.equal(orderUnbound.backend_error_observed, false);
  assert.equal(orderUnbound.result_status, "UNVERIFIED");
  assert.ok(orderUnbound.gaps.some(({ code }) => code === "OBJECT_ORDER_MISMATCH"));
});

test("fails closed on malformed structures, unsafe URLs, cycles, and accessor input", () => {
  const malformed = decode({ id: "i2v-result", chat_id: 41356, author_id: -1, message_object: [undefined] }, "wan_26_i2v");
  assert.deepEqual((malformed.gaps as Array<{ code: string }>).map(({ code }) => code),
    ["OBJECT_ENTRY_INVALID", "EXPECTED_OBJECT_ID_MISSING", "EXPECTED_OBJECT_ID_MISSING"]);
  const unsafe = decode({ ...i2vMessage, message_object: [{ ...i2vMessage.message_object[0],
    object_url: "https://example.com/private.mp4" }] }, "wan_26_i2v", ["i2v-video-a"]);
  assert.deepEqual((unsafe.gaps as Array<{ code: string }>).map(({ code }) => code), ["RESULT_URL_UNSAFE"]);
  const cyclic: Record<string, unknown> = { ...i2vMessage }; cyclic.self = cyclic;
  assert.deepEqual((decode(cyclic, "wan_26_i2v").gaps as Array<{ code: string }>).map(({ code }) => code), ["ENVELOPE_SHAPE_INVALID"]);
  const accessor = Object.defineProperty({ ...i2vMessage }, "author_id", { enumerable: true, get: () => -1 });
  assert.deepEqual((decode(accessor, "wan_26_i2v").gaps as Array<{ code: string }>).map(({ code }) => code), ["ENVELOPE_SHAPE_INVALID"]);
});
