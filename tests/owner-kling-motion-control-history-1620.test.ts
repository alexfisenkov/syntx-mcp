import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/adapter/syntx/owner-kling-motion-control-history.js", import.meta.url).href;
const moduleApi = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const pageSize = 10;

function bind(pages: readonly unknown[], expected: { chat_uuid: string; owner_echo_message_id: string | null; prompt: string }): Record<string, unknown> {
  assert.ok(moduleApi, "MISSING_OWNER_KLING_MOTION_CONTROL_HISTORY_1620_MODULE");
  const bindHistory = moduleApi.bindOwnerKlingMotionControlHistory as ((input: unknown) => Record<string, unknown>) | undefined;
  assert.equal(typeof bindHistory, "function", "MISSING_OWNER_KLING_MOTION_CONTROL_HISTORY_1620_BINDER");
  return bindHistory!({ pages, expected });
}

function object(id: string, type: string, fields: Record<string, unknown> = {}) {
  return { id, message_id: "unused", object_type: type, ...fields };
}

function row(id: string, author: number, objects: readonly Record<string, unknown>[], chatId = 421) {
  return { id, chat_id: chatId, author_id: author, message_object: objects.map((value) => ({ ...value, message_id: id })) };
}

function page(messages: readonly unknown[], number = 1, total = messages.length, pages = total === 0 ? 0 : Math.ceil(total / pageSize)) {
  return { messages, pagination: { page: number, page_size: pageSize, total_count: total, total_pages: pages,
    has_next: number < pages, has_previous: number > 1 } };
}

const nonemptyPrompt = "private motion prompt";
const expected = { chat_uuid: "owner-chat-1620", owner_echo_message_id: "owner-ack-1", prompt: "" };
const textAck = (prompt: string, id = "ack-text") => object(id, "text", { model_type: "kling_motion_control", object_text: prompt });
const readyVideo = (id: string) => object(id, "video", { model_type: "kling_motion_control", completed: true,
  object_url: "https://private.example/secret-output.mp4" });

test("empty raw prompt binds an exact known owner ACK and nonempty prompt remains exact", () => {
  const empty = bind([page([row("owner-ack-1", 27, [textAck("")]), row("bot-result-1", -1, [readyVideo("video-1")])])], expected);
  assert.equal(empty.status, "COMPLETE");
  assert.equal(empty.owner_ack_status, "MATCHED");
  assert.equal(empty.owner_echo_message_id, "owner-ack-1");
  assert.deepEqual(empty.candidate_messages, [{ message_id: "bot-result-1", message_object_ids: ["video-1"] }]);
  assert.equal(empty.backend_acceptance, "UNPROVEN");

  const nonempty = bind([page([row("owner-ack-2", 28, [textAck(nonemptyPrompt)])])],
    { ...expected, owner_echo_message_id: "owner-ack-2", prompt: nonemptyPrompt });
  assert.equal(nonempty.owner_ack_status, "MATCHED");

  const wrongOwner = bind([page([row("owner-ack-1", -1, [textAck("")])])], expected);
  assert.equal(wrongOwner.owner_ack_status, "MISMATCH");
  assert.equal(wrongOwner.owner_echo_message_id, null);
  const wrongPrompt = bind([page([row("owner-ack-1", 27, [textAck(nonemptyPrompt)])])], expected);
  assert.equal(wrongPrompt.owner_ack_status, "MISMATCH");
});

test("lost ACK adopts only one exact owner echo, including a present empty text value", () => {
  const unique = bind([page([row("owner-ack-lost", 27, [textAck("")])])], { ...expected, owner_echo_message_id: null });
  assert.equal(unique.owner_ack_status, "MATCHED");
  assert.equal(unique.owner_echo_message_id, "owner-ack-lost");

  const ambiguous = bind([page([row("owner-a", 27, [textAck("", "text-a")]), row("owner-b", 28, [textAck("", "text-b")])])],
    { ...expected, owner_echo_message_id: null });
  assert.equal(ambiguous.owner_ack_status, "AMBIGUOUS");
  assert.equal(ambiguous.owner_echo_message_id, null);
  assert.equal(ambiguous.status, "PENDING");

  const absentText = bind([page([row("owner-empty-unknown", 27, [object("text-missing", "text", { model_type: "kling_motion_control" })])])],
    { ...expected, owner_echo_message_id: null });
  assert.equal(absentText.owner_ack_status, "MISSING");
  assert.equal(absentText.owner_echo_message_id, null);
});

test("complete two-page MCV history keeps every ordered video ID and rejects broken joins or truncation", () => {
  const firstRows = [row("owner-ack-1", 27, [textAck("")]), ...Array.from({ length: 9 }, (_, index) => row(`other-${index}`, 2, []))];
  const second = row("bot-result-1", -1, [readyVideo("video-1"), readyVideo("video-2"), readyVideo("video-3")]);
  const complete = bind([page(firstRows, 1, 11, 2), page([second], 2, 11, 2)], expected);
  assert.equal(complete.status, "COMPLETE");
  assert.equal(complete.provider_chat_id, "421");
  assert.deepEqual(complete.candidate_messages, [{ message_id: "bot-result-1", message_object_ids: ["video-1", "video-2", "video-3"] }]);

  const wrongVideoEcho = bind([page([row("owner-ack-1", 27, [textAck("")]), row("bot-wrong-model", -1,
    [object("wrong-model-video", "video", { model_type: "kling_keyframes", completed: true })])])], expected);
  assert.equal(wrongVideoEcho.status, "PENDING");
  assert.notEqual(wrongVideoEcho.history_binding_status, "BOUND");
  assert.ok((wrongVideoEcho.gaps as string[]).includes("BOT_VIDEO_MODEL_MISMATCH"));

  const duplicateMessage = bind([page([row("owner-ack-1", 27, [textAck("")]), row("owner-ack-1", -1, [readyVideo("video-1")])])], expected);
  assert.equal(duplicateMessage.history_binding_status, "UNVERIFIED");
  const duplicateObject = bind([page([row("owner-ack-1", 27, [textAck("")]),
    row("bot-duplicate-object", -1, [readyVideo("video-1"), readyVideo("video-1")])])], expected);
  assert.equal(duplicateObject.history_binding_status, "UNVERIFIED");
  const childMismatch = bind([page([row("owner-ack-1", 27, [textAck("")]),
    { ...row("bot-child-mismatch", -1, [readyVideo("video-1")]),
      message_object: [{ ...readyVideo("video-1"), message_id: "another-message" }] }])], expected);
  assert.equal(childMismatch.history_binding_status, "UNVERIFIED");

  const foreignChat = bind([page([row("owner-ack-1", 27, [textAck("")]), row("bot-result-1", -1, [readyVideo("video-1")], 422)])], expected);
  assert.equal(foreignChat.history_binding_status, "UNVERIFIED");
  assert.ok((foreignChat.gaps as string[]).includes("HISTORY_CHAT_ID_INCONSISTENT"));

  const truncated = bind([page(firstRows, 1, 11, 2)], expected);
  assert.equal(truncated.status, "INCOMPLETE");
  assert.equal(truncated.history_page_status, "INCOMPLETE");
});

test("only an exact MCV error object is observed as an error and neither error nor pending is terminal", () => {
  const pending = bind([page([row("owner-ack-1", 27, [textAck("")]), row("bot-pending", -1,
    [object("pending-video", "video", { model_type: "kling_motion_control", completed: false })])])], expected);
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.bot_error_observed, false);

  const exactError = bind([page([row("owner-ack-1", 27, [textAck("")]), row("bot-error", -1,
    [object("error-1", "error", { model_type: "kling_motion_control", object_text: "private provider error" })])])], expected);
  assert.equal(exactError.status, "PENDING");
  assert.equal(exactError.bot_error_observed, true);
  assert.ok((exactError.gaps as string[]).includes("BOT_ERROR_OBSERVED"));
  assert.equal(exactError.backend_acceptance, "UNPROVEN");

  const genericError = bind([page([row("owner-ack-1", 27, [textAck("")]), row("bot-generic-error", -1,
    [object("other-error", "error", { model_type: "some_other_model", object_text: "private generic error" })])])], expected);
  assert.equal(genericError.bot_error_observed, false);
  assert.equal(genericError.status, "PENDING");
  const serialized = JSON.stringify(exactError);
  assert.equal(serialized.includes("private provider error"), false);
  assert.equal(serialized.includes("private generic error"), false);
});
