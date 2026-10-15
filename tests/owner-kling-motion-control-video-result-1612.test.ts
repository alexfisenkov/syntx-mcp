import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/adapter/syntx/owner-kling-motion-control-video-result.js", import.meta.url).href;
const codecModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const context = { chat_uuid: "mcv-chat", message_id: "bot-mcv-1", model_id: "kling_motion_control", provider_chat_id: "421",
  message_object_ids: ["mcv-video-1", "mcv-video-2"] } as const;

function decode(raw: unknown, readContext: unknown = context): Record<string, unknown> {
  assert.ok(codecModule, "MISSING_OWNER_KLING_MOTION_CONTROL_VIDEO_RESULT_CODEC_MODULE");
  const decoder = codecModule.decodeOwnerKlingMotionControlVideoResult as (message: unknown, ctx: unknown) => Record<string, unknown>;
  assert.equal(typeof decoder, "function", "MISSING_OWNER_KLING_MOTION_CONTROL_VIDEO_RESULT_CODEC");
  return decoder(raw, readContext);
}

function object(id: string, fields: Record<string, unknown> = {}) {
  return { id, message_id: "bot-mcv-1", object_type: "video", model_type: "kling_motion_control", completed: true,
    object_url: `https://r2.syntx.ai/mcv/${id}.mp4`, ...fields };
}
function message(objects: unknown[], fields: Record<string, unknown> = {}) {
  return { id: "bot-mcv-1", chat_id: 421, author_id: -1, message_object: objects, ...fields };
}

test("MCV exact result binds one or many expected video objects without claiming provider completion", () => {
  const result = decode(message([object("mcv-video-1"), object("mcv-video-2", { object_url: "https://r2.syntx.ai/mcv/two.webm" })]));
  assert.equal(result.message_binding, "BOUND");
  assert.equal(result.model_echo, "MATCHED");
  assert.equal(result.result_status, "OBSERVED");
  assert.equal(result.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
  assert.deepEqual((result.ready_videos as Array<Record<string, unknown>>).map((video) => [video.message_object_id, video.mime_type]),
    [["mcv-video-1", "video/mp4"], ["mcv-video-2", "video/webm"]]);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal(result.provider_terminal_status, "UNPROVEN");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.ready_videos), true);
  assert.equal("provider_terminal" in result, false);
  const one = decode(message([object("mcv-video-1")]), { ...context, message_object_ids: ["mcv-video-1"] });
  assert.equal((one.ready_videos as unknown[]).length, 1);
});

test("MCV result fails closed on missing, duplicate, unexpected, wrong-type, and wrong model echoes", () => {
  const missing = decode(message([object("mcv-video-1") ]));
  assert.ok((missing.gaps as Array<{code:string}>).some((gap) => gap.code === "EXPECTED_OBJECT_ID_MISSING"));
  const invalid = decode(message([object("mcv-video-1"), object("mcv-video-1"), object("other"),
    object("mcv-video-2", { object_type: "image" })]));
  const codes = (invalid.gaps as Array<{code:string}>).map((gap) => gap.code);
  assert.ok(codes.includes("OBJECT_ID_DUPLICATE"));
  assert.ok(codes.includes("OBJECT_ID_UNEXPECTED"));
  assert.ok(codes.includes("OBJECT_TYPE_UNSUPPORTED"));
  assert.equal(invalid.model_echo, "MATCHED", "the exact expected video echo survives unrelated invalid objects");
  assert.deepEqual(invalid.ready_videos, [], "duplicate identities must not leave an earlier copy in results");
  const swapped = decode(message([object("mcv-video-2"), object("mcv-video-1")]));
  assert.deepEqual(swapped.ready_videos, []);
  assert.ok((swapped.gaps as Array<{code:string}>).some((gap) => gap.code === "OBJECT_ID_ORDER_MISMATCH"));
  const mismatch = decode(message([object("mcv-video-1", { model_type: "kling_keyframes" })]), { ...context, message_object_ids: ["mcv-video-1"] });
  assert.equal(mismatch.model_echo, "MISMATCH");
  assert.deepEqual(mismatch.ready_videos, []);
  const noEcho = decode(message([object("mcv-video-1", { model_type: undefined })]), { ...context, message_object_ids: ["mcv-video-1"] });
  assert.equal(noEcho.model_echo, "UNKNOWN");
});

test("MCV distinguishes pending video objects from an explicitly typed backend error", () => {
  const pending = decode(message([object("mcv-video-1", { completed: false })]), { ...context, message_object_ids: ["mcv-video-1"] });
  assert.equal(pending.result_status, "PENDING");
  assert.equal(pending.backend_error_observed, false);
  const backendError = decode(message([{ id: "mcv-error-1", message_id: "bot-mcv-1", object_type: "error", model_type: "kling_motion_control" }]),
    { ...context, message_object_ids: ["mcv-error-1"] });
  assert.equal(backendError.result_status, "BACKEND_ERROR_OBSERVED");
  assert.equal(backendError.backend_error_observed, true);
  assert.equal(backendError.backend_acceptance, "UNPROVEN");
  assert.equal(backendError.provider_terminal_status, "UNPROVEN");
  assert.equal(JSON.stringify(backendError).includes("error_text"), false);
});

test("MCV does not classify an unexpected typed error as a backend error", () => {
  const result = decode(message([
    { id: "unexpected-error", message_id: "bot-mcv-1", object_type: "error", model_type: "kling_motion_control" },
    object("mcv-video-1", { completed: false })
  ]), { ...context, message_object_ids: ["mcv-video-1"] });
  assert.equal(result.result_status, "PENDING");
  assert.equal(result.backend_error_observed, false);
});

test("MCV refuses mismatched exact identities and unsafe artifact URLs", () => {
  const wrongModel = { ...context, model_id: "kling_keyframes" };
  assert.throws(() => decode(message([]), wrongModel), /INVALID_KLING_MOTION_CONTROL_VIDEO_RESULT_CONTEXT/u);
  const wrongMessage = decode(message([object("mcv-video-1")], { id: "other-message" }));
  assert.equal(wrongMessage.message_binding, "UNVERIFIED");
  assert.deepEqual(wrongMessage.ready_videos, []);
  const unsafe = decode(message([object("mcv-video-1", { object_url: "http://r2.syntx.ai/mcv/a.mp4" })]),
    { ...context, message_object_ids: ["mcv-video-1"] });
  assert.deepEqual(unsafe.ready_videos, []);
  assert.ok((unsafe.gaps as Array<{code:string}>).some((gap) => gap.code === "OBJECT_URL_UNSAFE"));
});
