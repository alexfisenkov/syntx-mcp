import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/application/owner-seedream-editor-image-history-binding.js", import.meta.url).href;
const bindingModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const VARIANTS = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;
const CHAT = "editor-chat";
const PROVIDER_CHAT = "412";
const ACK = "owner-ack";

function message(messageId: string, author: "owner" | "bot" | "other", objects: readonly Record<string, unknown>[] = []) {
  return { message_id: messageId, provider_chat_id: PROVIDER_CHAT, author_role: author, objects };
}
function snapshot(messages: readonly ReturnType<typeof message>[], _variant: string, overrides: Record<string, unknown> = {}) {
  return { complete: true, page: 1, page_size: 10, total_count: messages.length, total_pages: Math.ceil(messages.length / 10), has_next: false,
    has_previous: false, requested_chat_uuid: CHAT, provider_chat_id: PROVIDER_CHAT, messages, ...overrides };
}
function input(variant: typeof VARIANTS[number], history = snapshot([
  message(ACK, "owner", [{ message_object_id: "prompt-text", object_type: "text", model_type: variant }]),
  message("bot-1", "bot", [{ message_object_id: "output-1", object_type: "image", model_type: variant }])
], variant)) {
  return { snapshot: history, requested_chat_uuid: CHAT, owner_echo_message_id: ACK, variant };
}

test("Editor history binds the exact owner ACK and returns all five-variant bot candidates without count claims", () => {
  assert.ok(bindingModule, "MISSING_SEEDREAM_EDITOR_HISTORY_BINDER_MODULE");
  const correlate = bindingModule.correlateOwnerSeedreamEditorImageHistoryBinding as (input: unknown) => Record<string, unknown>;
  assert.equal(typeof correlate, "function", "MISSING_SEEDREAM_EDITOR_HISTORY_BINDER");
  for (const variant of VARIANTS) {
    const result = correlate(input(variant));
    assert.equal(result.status, "BOUND", variant);
    assert.equal(result.chat_uuid, CHAT);
    assert.equal(result.owner_echo_message_id, ACK);
    assert.equal(result.variant, variant);
    assert.equal(result.namespace_confidence, "SOURCE_SHAPED_UNVERIFIED");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal("output_count" in result, false);
    assert.equal("requested_output_count" in result, false);
    assert.deepEqual(result.candidate_message_ids, ["bot-1"]);
    assert.deepEqual(result.observed_objects, [{ message_id: "bot-1", message_object_id: "output-1",
      object_type: "image", model_echo: "MATCHED" }]);
  }
});

test("Editor history preserves 80 observed image objects across two bot messages and includes image_url", () => {
  assert.ok(bindingModule, "MISSING_SEEDREAM_EDITOR_HISTORY_BINDER_MODULE");
  const correlate = bindingModule.correlateOwnerSeedreamEditorImageHistoryBinding as (input: unknown) => Record<string, unknown>;
  const variant = "seedream-5.0-pro";
  const outputs = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({
    message_object_id: `out-${start + index}`, object_type: index === 0 ? "image_url" : "image", model_type: variant
  }));
  const result = correlate(input(variant, snapshot([
    message(ACK, "owner"), message("bot-a", "bot", outputs(1, 40)), message("bot-b", "bot", outputs(41, 40))
  ], variant)));
  assert.equal(result.status, "BOUND");
  assert.deepEqual(result.candidate_message_ids, ["bot-a", "bot-b"]);
  assert.equal((result.observed_objects as unknown[]).length, 80);
  assert.equal((result.observed_objects as Array<Record<string, unknown>>)[0]?.object_type, "image_url");
});

test("Editor history accepts a complete multi-page aggregate without treating page one as the full history", () => {
  assert.ok(bindingModule, "MISSING_SEEDREAM_EDITOR_HISTORY_BINDER_MODULE");
  const correlate = bindingModule.correlateOwnerSeedreamEditorImageHistoryBinding as (input: unknown) => Record<string, unknown>;
  const rows = [message(ACK, "owner"), ...Array.from({ length: 9 }, (_, index) => message(`context-${index}`, "other")),
    message("bot-result", "bot", [{ message_object_id: "out-1", object_type: "image", model_type: "seedream-5" }])];
  const aggregate = snapshot(rows, "seedream-5", { total_pages: 2, has_previous: false, has_next: false });
  const result = correlate(input("seedream-5", aggregate));
  assert.equal(result.status, "BOUND");
  assert.deepEqual(result.candidate_message_ids, ["bot-result"]);
  assert.deepEqual(correlate(input("seedream-5", snapshot(rows, "seedream-5", { page: -1 }))),
    { status: "INVALID", reason: "HISTORY_PAGE_INVALID" });
  assert.deepEqual(correlate(input("seedream-5", snapshot(rows, "seedream-5", { total_pages: 1 }))),
    { status: "INVALID", reason: "HISTORY_PAGE_INVALID" });
});

test("Editor history reports incomplete history and model absence explicitly", () => {
  assert.ok(bindingModule, "MISSING_SEEDREAM_EDITOR_HISTORY_BINDER_MODULE");
  const correlate = bindingModule.correlateOwnerSeedreamEditorImageHistoryBinding as (input: unknown) => Record<string, unknown>;
  const incomplete = correlate(input("seedream-5", snapshot([], "seedream-5", { complete: false })));
  assert.deepEqual(incomplete, { status: "PENDING", reason: "HISTORY_INCOMPLETE" });
  const unknownModel = correlate(input("seedream-5", snapshot([
    message(ACK, "owner"), message("bot-1", "bot", [{ message_object_id: "output-1", object_type: "image_url", model_type: null }])
  ], "seedream-5")));
  assert.equal(unknownModel.status, "BOUND");
  assert.deepEqual(unknownModel.observed_objects, [{ message_id: "bot-1", message_object_id: "output-1",
    object_type: "image_url", model_echo: "UNKNOWN" }]);
  assert.deepEqual(unknownModel.gaps, [{ message_id: "bot-1", object_index: 0, code: "MODEL_TYPE_UNAVAILABLE" }]);
});

test("Editor history blocks model mismatch and binds ACK separately from bot message IDs", () => {
  assert.ok(bindingModule, "MISSING_SEEDREAM_EDITOR_HISTORY_BINDER_MODULE");
  const correlate = bindingModule.correlateOwnerSeedreamEditorImageHistoryBinding as (input: unknown) => Record<string, unknown>;
  const wrongModel = correlate(input("seedream-5", snapshot([
    message(ACK, "owner"), message("bot-1", "bot", [{ message_object_id: "output-1", object_type: "image", model_type: "seedream-4" }])
  ], "seedream-5")));
  assert.deepEqual(wrongModel, { status: "INVALID", reason: "BOT_MODEL_MISMATCH" });
  const wrongAck = correlate({ ...input("seedream-5"), owner_echo_message_id: "wrong-ack" });
  assert.deepEqual(wrongAck, { status: "INVALID", reason: "OWNER_ACK_MISMATCH" });
  const nonbot = correlate(input("seedream-5", snapshot([
    message(ACK, "owner"), message("bot-1", "other", [{ message_object_id: "output-1", object_type: "image", model_type: "seedream-5" }])
  ], "seedream-5")));
  assert.deepEqual(nonbot, { status: "PENDING", reason: "BOT_MESSAGE_NOT_FOUND" });
});

test("Editor history rejects foreign chats, duplicate IDs, and additional owner ACKs", () => {
  assert.ok(bindingModule, "MISSING_SEEDREAM_EDITOR_HISTORY_BINDER_MODULE");
  const correlate = bindingModule.correlateOwnerSeedreamEditorImageHistoryBinding as (input: unknown) => Record<string, unknown>;
  assert.deepEqual(correlate(input("seedream-5", snapshot([
    message(ACK, "owner"), message("bot-1", "bot")
  ], "seedream-5", { requested_chat_uuid: "foreign-chat" }))), { status: "INVALID", reason: "CHAT_SCOPE_MISMATCH" });
  const duplicate = correlate(input("seedream-5", snapshot([
    message(ACK, "owner"), message("bot-1", "bot", [
      { message_object_id: "dup", object_type: "image", model_type: "seedream-5" },
      { message_object_id: "dup", object_type: "image_url", model_type: "seedream-5" }
    ])
  ], "seedream-5")));
  assert.deepEqual(duplicate, { status: "INVALID", reason: "OBJECT_ID_DUPLICATE" });
  assert.deepEqual(correlate(input("seedream-5", snapshot([
    message(ACK, "owner"), message("owner-2", "owner"), message("bot-1", "bot")
  ], "seedream-5"))), { status: "INVALID", reason: "OWNER_ACK_AMBIGUOUS" });
});

test("Editor history sanitizes unknown fields and rejects sparse, accessor, proxy, revoked, and oversized records", () => {
  assert.ok(bindingModule, "MISSING_SEEDREAM_EDITOR_HISTORY_BINDER_MODULE");
  const correlate = bindingModule.correlateOwnerSeedreamEditorImageHistoryBinding as (input: unknown) => Record<string, unknown>;
  const withUnknown = snapshot([
    { ...message(ACK, "owner"), private_prompt: "never-return" } as never,
    message("bot-1", "bot", [{ message_object_id: "output-1", object_type: "image", model_type: "seedream-5", private_value: "never-return" }])
  ], "seedream-5");
  const sanitized = correlate(input("seedream-5", withUnknown));
  assert.equal(JSON.stringify(sanitized).includes("never-return"), false);
  assert.ok((sanitized.gaps as unknown[]).length >= 2);
  const sparse = new Array(1);
  assert.deepEqual(correlate(input("seedream-5", snapshot(sparse as never, "seedream-5"))),
    { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" });
  let getterReads = 0;
  const accessor: Record<string, unknown> = { ...input("seedream-5") };
  Object.defineProperty(accessor, "variant", { enumerable: true, get() { getterReads += 1; return "seedream-5"; } });
  assert.deepEqual(correlate(accessor), { status: "INVALID", reason: "INVALID_INPUT" });
  const proxy = new Proxy(input("seedream-5"), { getPrototypeOf() { throw new Error("trap"); } });
  assert.deepEqual(correlate(proxy), { status: "INVALID", reason: "INVALID_INPUT" });
  const revoked = Proxy.revocable(input("seedream-5"), {}); revoked.revoke();
  assert.deepEqual(correlate(revoked.proxy), { status: "INVALID", reason: "INVALID_INPUT" });
  assert.equal(getterReads, 0);
  const oversizedMessages = Array.from({ length: 65 }, (_, index) => message(`m-${index}`, "other"));
  assert.deepEqual(correlate(input("seedream-5", snapshot(oversizedMessages, "seedream-5"))),
    { status: "INVALID", reason: "HISTORY_LOCAL_LIMIT" });
  const oversizedObjects = Array.from({ length: 65 }, (_, index) => ({ message_object_id: `out-${index}`, object_type: "image", model_type: "seedream-5" }));
  assert.deepEqual(correlate(input("seedream-5", snapshot([message(ACK, "owner"), message("bot-1", "bot", oversizedObjects)], "seedream-5"))),
    { status: "INVALID", reason: "HISTORY_LOCAL_LIMIT" });
});
