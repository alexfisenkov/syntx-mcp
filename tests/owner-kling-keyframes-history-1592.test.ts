import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/adapter/syntx/owner-kling-keyframes-history.js", import.meta.url).href;
const moduleApi = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const pageSize = 10;

function bind(pages: readonly unknown[], expected: { chat_uuid: string; owner_echo_message_id: string | null; prompt: string }): Record<string, unknown> {
  assert.ok(moduleApi, "MISSING_OWNER_KLING_KEYFRAMES_HISTORY_1592_MODULE");
  const bindHistory = moduleApi.bindOwnerKlingKeyframesHistory as ((input: unknown) => Record<string, unknown>) | undefined;
  assert.equal(typeof bindHistory, "function", "MISSING_OWNER_KLING_KEYFRAMES_HISTORY_1592_BINDER");
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

const expected = { chat_uuid: "owner-chat-1", owner_echo_message_id: "owner-ack-1", prompt: "private prompt" };
const textAck = (id = "ack-text") => object(id, "text", { model_type: "kling_keyframes", object_text: expected.prompt });
const readyVideo = (id: string) => object(id, "video", { model_type: "kling_keyframes", completed: true,
  object_url: "https://private.example/secret-output.mp4" });

test("known owner ACK binds by ACK id, separately from a bot result id and two input images", () => {
  const result = bind([page([row("owner-ack-1", 27, [textAck()]), row("bot-result-9", -1, [readyVideo("video-1"), readyVideo("video-2")])])], expected);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.owner_ack_status, "MATCHED");
  assert.equal(result.owner_echo_message_id, "owner-ack-1");
  assert.deepEqual(result.candidate_messages, [{ message_id: "bot-result-9", message_object_ids: ["video-1", "video-2"] }]);
  assert.equal(result.history_binding_status, "BOUND");
  assert.equal(result.history_page_status, "COMPLETE");
  assert.equal(result.backend_acceptance, "UNPROVEN");
});

test("unknown ACK is adopted only for a unique exact owner text/model match", () => {
  const unique = bind([page([row("owner-ack-2", 27, [textAck()])])], { ...expected, owner_echo_message_id: null });
  assert.equal(unique.owner_ack_status, "MATCHED");
  assert.equal(unique.owner_echo_message_id, "owner-ack-2");
  const ambiguous = bind([page([row("owner-a", 27, [textAck("ack-text-a")]), row("owner-b", 28, [textAck("ack-text-b")])])],
    { ...expected, owner_echo_message_id: null });
  assert.equal(ambiguous.owner_ack_status, "AMBIGUOUS");
  assert.equal(ambiguous.owner_echo_message_id, null);
  assert.equal(ambiguous.status, "PENDING");
  const mismatch = bind([page([row("owner-ack-1", 27, [object("ack-text", "text", { model_type: "other-model", object_text: expected.prompt })])])], expected);
  assert.equal(mismatch.owner_ack_status, "MISMATCH");
  assert.equal(mismatch.owner_echo_message_id, null);
});

test("complete multipage history binds exact totals and reports only bounded IDs", () => {
  const firstRows = [row("owner-ack-1", 27, [textAck()]), ...Array.from({ length: 9 }, (_, i) => row(`other-${i}`, 27, []))];
  const secondRows = [row("bot-result-9", -1, [readyVideo("video-1")])];
  const result = bind([page(firstRows, 1, 11, 2), page(secondRows, 2, 11, 2)], expected);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.history_page_status, "COMPLETE");
  assert.deepEqual(result.candidate_messages, [{ message_id: "bot-result-9", message_object_ids: ["video-1"] }]);
});

test("partial pages and drifting pagination never produce a bound history", () => {
  const firstRows = [row("owner-ack-1", 27, [textAck()]), ...Array.from({ length: 9 }, (_, i) => row(`first-${i}`, 2, []))];
  const partial = bind([page(firstRows, 1, 11, 2)], expected);
  assert.equal(partial.status, "INCOMPLETE");
  assert.notEqual(partial.history_binding_status, "BOUND");
  const drift = bind([page(firstRows, 1, 11, 2), page([row("second", 27, []), row("second-extra", 27, [])], 2, 12, 2)], expected);
  assert.equal(drift.history_page_status, "INCOMPLETE");
  assert.equal(drift.history_binding_status, "UNVERIFIED");
});

test("duplicate IDs, bad child joins, and provider chat inconsistency are rejected", () => {
  const duplicate = bind([page([row("owner-ack-1", 27, [textAck()]), row("owner-ack-1", -1, [readyVideo("video-1")])])], expected);
  assert.equal(duplicate.history_binding_status, "UNVERIFIED");
  const duplicateChild = bind([page([row("owner-ack-1", 27, [textAck()]), row("bot-result-9", -1, [readyVideo("ack-text")])])], expected);
  assert.equal(duplicateChild.history_binding_status, "UNVERIFIED");
  const childMismatch = bind([page([row("owner-ack-1", 27, [textAck()]),
    { ...row("bot-result-9", -1, [readyVideo("video-1")]), message_object: [{ ...readyVideo("video-1"), message_id: "other" }] }])], expected);
  assert.equal(childMismatch.history_binding_status, "UNVERIFIED");
  const wrongChat = bind([page([row("owner-ack-1", 27, [textAck()]), row("bot-result-9", -1, [readyVideo("video-1")], 422)])], expected);
  assert.equal(wrongChat.history_binding_status, "UNVERIFIED");
});

test("the seven-page and 64-message caps reject overflow without truncation", () => {
  const overflow = bind([page(Array.from({ length: 10 }, (_, i) => row(`message-${i}`, 2, [])), 1, 71, 8)], expected);
  assert.equal(overflow.history_page_status, "INCOMPLETE");
  assert.equal(overflow.status, "INCOMPLETE");
  const maxPages = Array.from({ length: 7 }, (_, index) => page(Array.from({ length: index === 6 ? 4 : 10 }, (_, offset) =>
    row(`message-${index * 10 + offset}`, 2, [])), index + 1, 64, 7));
  const bounded = bind(maxPages, { ...expected, owner_echo_message_id: null });
  assert.equal(bounded.history_page_status, "COMPLETE");
  assert.equal(bounded.status, "PENDING");
  const tooManyPages = bind([...maxPages, page([], 8, 64, 7)], { ...expected, owner_echo_message_id: null });
  assert.equal(tooManyPages.history_page_status, "INCOMPLETE");
  assert.equal((tooManyPages.gaps as string[])[0], "HISTORY_PAGE_LIMIT");
  const tooManyObjects = bind([page([row("owner-ack-1", 27, [textAck()]),
    row("bot-large", -1, Array.from({ length: 65 }, (_, i) => readyVideo(`large-${i}`)))])], expected);
  assert.equal(tooManyObjects.history_page_status, "INCOMPLETE");
  assert.equal(tooManyObjects.status, "INCOMPLETE");
});

test("pending videos and matching-model errors are observable but not terminal", () => {
  const incompleteVideo = row("bot-pending", -1, [object("pending-video", "video", { model_type: "kling_keyframes", completed: false })]);
  const error = row("bot-error", -1, [object("error-1", "error", { model_type: "kling_keyframes", object_text: "private error" })]);
  const result = bind([page([row("owner-ack-1", 27, [textAck()]), incompleteVideo, error])], expected);
  assert.equal(result.status, "PENDING");
  assert.equal(result.bot_error_observed, true);
  assert.deepEqual(result.candidate_messages, []);
  assert.equal(result.backend_acceptance, "UNPROVEN");
});

test("complete empty history is pending with a missing ACK, not a provider failure", () => {
  const result = bind([page([], 1, 0, 0)], expected);
  assert.equal(result.status, "PENDING");
  assert.equal(result.owner_ack_status, "MISSING");
  assert.equal(result.history_page_status, "COMPLETE");
  assert.equal(result.provider_chat_id, null);
  assert.equal((result.gaps as string[])[0], "OWNER_ACK_MISSING");
});

test("request model mismatch cannot create a candidate and output excludes prompts, URLs, and error text", () => {
  const result = bind([page([row("owner-ack-1", 27, [textAck()]), row("bot-result-9", -1,
    [object("video-1", "video", { model_type: "other-model", completed: true, object_url: "https://secret.invalid/raw" }),
      object("error-1", "error", { model_type: "kling_keyframes", object_text: "private error value" })])])], expected);
  assert.equal(result.status, "PENDING");
  const serialized = JSON.stringify(result);
  for (const hidden of [expected.prompt, "https://private.example/secret-output.mp4", "https://secret.invalid/raw", "private error value"])
    assert.equal(serialized.includes(hidden), false);
  assert.ok(Array.isArray(result.gaps));
});

test("closed-data validation does not execute getters or proxies", () => {
  let calls = 0;
  const expectedWithGetter = { chat_uuid: "owner-chat-1", owner_echo_message_id: null, get prompt() { calls += 1; return expected.prompt; } };
  const accessor = bind([page([])], expectedWithGetter);
  assert.equal(calls, 0);
  assert.equal(accessor.history_binding_status, "UNVERIFIED");
  const proxied = new Proxy([page([])], { get() { calls += 1; throw new Error("secret proxy failure"); } });
  const proxyResult = bind(proxied, { ...expected, owner_echo_message_id: null });
  assert.equal(calls, 0);
  assert.equal(proxyResult.history_binding_status, "UNVERIFIED");
  assert.equal(JSON.stringify(proxyResult).includes("secret proxy failure"), false);
});
