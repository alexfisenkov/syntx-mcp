import assert from "node:assert/strict";
import test from "node:test";
import { bindOwnerWan26I2vHistory, type OwnerWan26I2vModelId } from "../src/adapter/syntx/owner-wan26-i2v-history.js";

type Expected = { chat_uuid: string; owner_echo_message_id: string | null; prompt: string; model_id: OwnerWan26I2vModelId };
const expected: Expected = { chat_uuid: "wan-chat-1", owner_echo_message_id: "owner-ack-1", prompt: "a red boat", model_id: "wan_26_i2v" };
function object(id: string, type: string, model: string, fields: Record<string, unknown> = {}) {
  return { id, message_id: "unused", object_type: type, model_type: model, ...fields };
}
function row(id: string, author: number, objects: readonly Record<string, unknown>[]) {
  return { id, chat_id: 421, author_id: author, message_object: objects.map((item) => ({ ...item, message_id: id })) };
}
function page(messages: readonly unknown[], number = 1, count = messages.length, pages = count === 0 ? 0 : Math.ceil(count / 10)) {
  return { messages, pagination: { page: number, page_size: 10, total_count: count, total_pages: pages,
    has_next: number < pages, has_previous: number > 1 } };
}
const ack = (id = "ack-text", prompt = expected.prompt, model: string = expected.model_id) =>
  object(id, "text", model, { object_text: prompt });
const video = (id: string, model: string = expected.model_id) => object(id, "video", model, { completed: true });
function bind(pages: readonly unknown[], values: Expected = expected) {
  return bindOwnerWan26I2vHistory({ pages, expected: values });
}

test("binds exact known owner ACK and typed video object IDs for both WAN I2V model IDs", () => {
  for (const model_id of ["wan_26_i2v", "wan_26_i2v_flash"] as const) {
    const result = bind([page([row("owner-ack-1", 27, [ack("ack-text", expected.prompt, model_id)]),
      row("bot-result-1", -1, [video("video-1", model_id), video("video-2", model_id)])])], { ...expected, model_id });
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.owner_ack_status, "MATCHED");
    assert.equal(result.owner_echo_message_id, "owner-ack-1");
    assert.deepEqual(result.candidate_messages, [{ message_id: "bot-result-1", message_object_ids: ["video-1", "video-2"] }]);
    assert.equal(result.backend_acceptance, "UNPROVEN");
  }
});

test("allows a present empty prompt and distinguishes it from a missing object_text field", () => {
  const empty = bind([page([row("owner-ack-1", 27, [ack("ack-text", "")]), row("bot-result", -1, [video("video-1")])])],
    { ...expected, prompt: "" });
  assert.equal(empty.owner_ack_status, "MATCHED");
  assert.equal(empty.status, "COMPLETE");
  const missing = bind([page([row("owner-ack-1", 27, [object("ack-text", "text", expected.model_id)]),
    row("bot-result", -1, [video("video-1")])])]);
  assert.equal(missing.owner_ack_status, "MISMATCH");
  assert.equal(missing.status, "PENDING");
});

test("recovers only a unique exact owner prompt echo when ACK ID is lost", () => {
  const unique = bind([page([row("owner-ack-2", 27, [ack("ack-text")]), row("bot-result", -1, [video("video-1")])])],
    { ...expected, owner_echo_message_id: null });
  assert.equal(unique.owner_ack_status, "MATCHED");
  assert.equal(unique.owner_echo_message_id, "owner-ack-2");
  const ambiguous = bind([page([row("owner-ack-2", 27, [ack("ack-a")]), row("owner-ack-3", 28, [ack("ack-b")])])],
    { ...expected, owner_echo_message_id: null });
  assert.equal(ambiguous.owner_ack_status, "AMBIGUOUS");
  assert.equal(ambiguous.owner_echo_message_id, null);
});

test("incomplete pagination and typed target-model errors never become complete results", () => {
  const first = [row("owner-ack-1", 27, [ack()]), ...Array.from({ length: 9 }, (_, i) => row(`other-${i}`, 2, []))];
  const incomplete = bind([page(first, 1, 11, 2)]);
  assert.equal(incomplete.status, "INCOMPLETE");
  assert.equal(incomplete.history_binding_status, "UNVERIFIED");
  const error = bind([page([row("owner-ack-1", 27, [ack()]), row("bot-error", -1,
    [object("error-id", "error", expected.model_id, { object_text: "private error" })])])]);
  assert.equal(error.status, "PENDING");
  assert.equal(error.bot_error_observed, true);
  assert.equal(JSON.stringify(error).includes("private error"), false);
  const foreignError = bind([page([row("owner-ack-1", 27, [ack()]), row("bot-error", -1,
    [object("error-id", "error", "unrelated_model", { object_text: "private error" })])])]);
  assert.equal(foreignError.bot_error_observed, false);
});

test("complete empty history means missing ACK, while duplicate IDs and wrong-model video are not candidates", () => {
  const emptyHistory = bind([page([], 1, 0, 0)]);
  assert.equal(emptyHistory.history_page_status, "COMPLETE");
  assert.equal(emptyHistory.owner_ack_status, "MISSING");
  const wrongModel = bind([page([row("owner-ack-1", 27, [ack()]), row("bot-result", -1, [video("video-1", "wan_27_r2v")])])]);
  assert.equal(wrongModel.candidate_messages.length, 0);
  assert.ok(wrongModel.gaps.includes("BOT_VIDEO_MODEL_MISMATCH"));
  const duplicate = bind([page([row("owner-ack-1", 27, [ack()]), row("owner-ack-1", -1, [video("video-1")])])]);
  assert.equal(duplicate.history_binding_status, "UNVERIFIED");
});

test("rejects cycles, nested proxies, and nested accessors in inert metadata without invoking getters", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const cyclicPages = [page([row("owner-ack-1", 27, [object("ack-text", "text", expected.model_id,
    { object_text: expected.prompt, metadata: cycle })])])];
  const cyclic = bind(cyclicPages);
  assert.equal(cyclic.status, "UNVERIFIED");
  assert.equal(cyclic.gaps[0], "HISTORY_INPUT_INVALID");

  let getterCalls = 0;
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get() { getterCalls += 1; return "ignored"; } });
  const accessed = bind([page([row("owner-ack-1", 27, [object("ack-text", "text", expected.model_id,
    { object_text: expected.prompt, metadata: accessor })])])]);
  assert.equal(accessed.status, "UNVERIFIED");
  assert.equal(accessed.gaps[0], "HISTORY_INPUT_INVALID");

  const proxiedMetadata = new Proxy({}, { get() { getterCalls += 1; return null; } });
  const proxied = bind([page([row("owner-ack-1", 27, [object("ack-text", "text", expected.model_id,
    { object_text: expected.prompt, metadata: proxiedMetadata })])])]);
  assert.equal(proxied.status, "UNVERIFIED");
  assert.equal(proxied.gaps[0], "HISTORY_INPUT_INVALID");
  assert.equal(getterCalls, 0);
});
