import assert from "node:assert/strict";
import test from "node:test";
import { bindOwnerWan25I2vHistory, type OwnerWan25I2vModelId } from "../src/adapter/syntx/owner-wan25-i2v-history.js";
import { decodeOwnerWan25I2vVideoResult } from "../src/adapter/syntx/owner-wan25-i2v-video-result.js";

const MODEL = "wan_25_i2v_preview" as const;
const PROMPT = "A paper kite above a quiet shoreline.";
const EXPECTED = Object.freeze({ chat_uuid: "w25-chat", owner_echo_message_id: "w25-ack", prompt: PROMPT, model_id: MODEL });

function object(id: string, messageId: string, objectType: string, fields: Record<string, unknown> = {}) {
  return { id, message_id: messageId, object_type: objectType, ...fields };
}
function row(id: string, authorId: number, objects: readonly Record<string, unknown>[]) {
  return { id, chat_id: 527, author_id: authorId, message_object: objects };
}
function page(messages: readonly unknown[], totalCount = messages.length) {
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / 10);
  return { messages, pagination: { page: 1, page_size: 10, total_count: totalCount, total_pages: totalPages,
    has_next: false, has_previous: false } };
}
function ownerAck() { return row("w25-ack", 37, [object("w25-ack-text", "w25-ack", "text",
  { model_type: MODEL, object_text: PROMPT })]); }
function botVideo() { return row("w25-result", -1, [object("w25-video", "w25-result", "video",
  { model_type: MODEL, completed: true, object_url: "https://r2.syntx.ai/generated/w25-result.mp4" })]); }
function bindHistory(messages: readonly unknown[], modelId: unknown = MODEL) {
  return bindOwnerWan25I2vHistory({ pages: [page(messages)], expected: { ...EXPECTED, model_id: modelId } });
}
function resultContext(modelId: unknown = MODEL) {
  return { chat_uuid: "w25-chat", message_id: "w25-result", provider_chat_id: "527", message_object_ids: ["w25-video"], model_id: modelId };
}
function resultMessage(overrides: Record<string, unknown> = {}) {
  return { id: "w25-result", chat_id: 527, author_id: -1, message_object: [object("w25-video", "w25-result", "video",
    { model_type: MODEL, completed: true, object_url: "https://r2.syntx.ai/generated/w25-result.mp4" })], ...overrides };
}

test("binds a complete exact-preview owner ACK and matching bot video IDs", () => {
  const witness = bindHistory([ownerAck(), botVideo()]);
  assert.equal(witness.status, "COMPLETE");
  assert.equal(witness.owner_ack_status, "MATCHED");
  assert.equal(witness.owner_echo_message_id, "w25-ack");
  assert.deepEqual(witness.candidate_messages, [{ message_id: "w25-result", message_object_ids: ["w25-video"] }]);
  assert.equal(witness.backend_acceptance, "UNPROVEN");
});

test("rejects WAN26, Flash, and unrelated IDs instead of widening the preview codec", () => {
  for (const modelId of ["wan_26_i2v", "wan_26_i2v_flash", "wan_25_t2v_preview", "other"] as const) {
    const witness = bindHistory([ownerAck(), botVideo()], modelId);
    assert.equal(witness.status, "UNVERIFIED");
    assert.equal(witness.gaps[0], "HISTORY_INPUT_INVALID");
  }
  for (const modelId of ["wan_26_i2v", "wan_26_i2v_flash", "other"]) {
    assert.throws(() => decodeOwnerWan25I2vVideoResult(resultMessage(), resultContext(modelId)),
      /^TypeError: INVALID_OWNER_WAN25_I2V_VIDEO_RESULT_CONTEXT$/u);
  }
  const declared: OwnerWan25I2vModelId = MODEL;
  assert.equal(declared, MODEL);
});

test("keeps incomplete pages and wrong or absent model echoes from becoming complete output", () => {
  const incomplete = bindOwnerWan25I2vHistory({ pages: [page([ownerAck()], 11)], expected: EXPECTED });
  assert.equal(incomplete.status, "INCOMPLETE");
  assert.ok(incomplete.gaps.includes("HISTORY_PAGE_INCONSISTENT"));

  const wrongEcho = decodeOwnerWan25I2vVideoResult(resultMessage({ message_object: [object("w25-video", "w25-result", "video",
    { model_type: "wan_26_i2v", completed: true, object_url: "https://r2.syntx.ai/generated/w25-result.mp4" })] }), resultContext());
  assert.equal(wrongEcho.model_echo, "MISMATCH");
  assert.deepEqual(wrongEcho.ready_videos, []);
  assert.ok(wrongEcho.gaps.some(({ code }) => code === "MODEL_ECHO_MISMATCH"));

  const missingEcho = decodeOwnerWan25I2vVideoResult(resultMessage({ message_object: [object("w25-video", "w25-result", "video",
    { completed: true, object_url: "https://r2.syntx.ai/generated/w25-result.mp4" })] }), resultContext());
  assert.equal(missingEcho.model_echo, "UNKNOWN");
  assert.equal(missingEcho.ready_videos[0]?.model_echo, "UNKNOWN");
});

test("does not accept duplicate result IDs or broken parents; distinguishes target errors and pending videos", () => {
  const duplicate = decodeOwnerWan25I2vVideoResult(resultMessage({ message_object: [
    object("w25-video", "w25-result", "video", { model_type: MODEL, completed: true,
      object_url: "https://r2.syntx.ai/generated/a.mp4" }),
    object("w25-video", "w25-result", "video", { model_type: MODEL, completed: true,
      object_url: "https://r2.syntx.ai/generated/b.mp4" })
  ] }), resultContext());
  assert.ok(duplicate.gaps.some(({ code }) => code === "OBJECT_ID_DUPLICATE"));

  const backendError = decodeOwnerWan25I2vVideoResult(resultMessage({ message_object: [object("w25-video", "w25-result", "error",
    { model_type: MODEL, object_text: "private error detail" })] }), resultContext());
  assert.equal(backendError.result_status, "BACKEND_ERROR_OBSERVED");
  assert.equal(backendError.backend_error_observed, true);
  assert.equal(JSON.stringify(backendError).includes("private error detail"), false);

  const pending = decodeOwnerWan25I2vVideoResult(resultMessage({ message_object: [object("w25-video", "w25-result", "video",
    { model_type: MODEL, completed: false, object_url: null })] }), resultContext());
  assert.equal(pending.result_status, "PENDING");
  assert.deepEqual(pending.pending_object_indices, [0]);

  const orderedContext = { ...resultContext(), message_object_ids: ["w25-video-a", "w25-video-b"] };
  const reversed = decodeOwnerWan25I2vVideoResult(resultMessage({ message_object: [
    object("w25-video-b", "w25-result", "video", { model_type: MODEL, completed: true, object_url: "https://r2.syntx.ai/generated/b.mp4" }),
    object("w25-video-a", "w25-result", "video", { model_type: MODEL, completed: true, object_url: "https://r2.syntx.ai/generated/a.mp4" })
  ] }), orderedContext);
  assert.deepEqual(reversed.ready_videos, []);
  assert.ok(reversed.gaps.some(({ code }) => code === "OBJECT_ORDER_MISMATCH"));
});

test("preserves hostile-graph, accessor, binding, and pagination protections", () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  const cycle = bindOwnerWan25I2vHistory({ pages: [page([ownerAck(), { ...botVideo(), extra: cyclic }])], expected: EXPECTED });
  assert.equal(cycle.status, "UNVERIFIED");
  assert.equal(cycle.gaps[0], "HISTORY_INPUT_INVALID");

  let getterCalls = 0;
  const accessor = Object.defineProperty({ ...resultMessage() }, "author_id", { enumerable: true,
    get() { getterCalls += 1; return -1; } });
  const invalid = decodeOwnerWan25I2vVideoResult(accessor, resultContext());
  assert.equal(invalid.result_status, "UNVERIFIED");
  assert.ok(invalid.gaps.some(({ code }) => code === "ENVELOPE_SHAPE_INVALID"));
  assert.equal(getterCalls, 0);

  const wrongJoin = decodeOwnerWan25I2vVideoResult(resultMessage({ message_object: [object("w25-video", "foreign-message", "video",
    { model_type: MODEL, completed: true, object_url: "https://r2.syntx.ai/generated/w25-result.mp4" })] }), resultContext());
  assert.equal(wrongJoin.result_status, "UNVERIFIED");
  assert.ok(wrongJoin.gaps.some(({ code }) => code === "OBJECT_MESSAGE_ID_MISMATCH"));

  const proxied = bindOwnerWan25I2vHistory(new Proxy({ pages: [page([ownerAck(), botVideo()])], expected: EXPECTED }, {}));
  assert.equal(proxied.gaps[0], "HISTORY_INPUT_INVALID");
});
