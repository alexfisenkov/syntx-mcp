import assert from "node:assert/strict";
import test from "node:test";
import { correlateOwnerWanImageHistoryBinding } from "../src/application/owner-wan-image-history-binding.js";
import type { ChatMessageHistorySnapshot } from "../src/adapter/syntx/chat-http-client.js";
import type { OwnerWanImageVariant } from "../src/application/owner-wan-image-parameters.js";

const VARIANTS: readonly OwnerWanImageVariant[] = [
  "wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"
];

type TestHistoryObject = { message_object_id: string; object_type: string; model_type: string | null };
type TestHistoryMessage = {
  message_id: string;
  provider_chat_id: string;
  author_role: "owner" | "bot" | "other";
  objects: TestHistoryObject[];
};
type TestHistorySnapshot = Omit<ChatMessageHistorySnapshot, "messages"> & { messages: TestHistoryMessage[] };

function snapshot(variant: OwnerWanImageVariant, referenceCount: number, resultCount: number): TestHistorySnapshot {
  const ownerObjects: TestHistoryObject[] = Array.from({ length: referenceCount }, (_, index) => ({
    message_object_id: `ref-${index + 1}`, object_type: "image", model_type: variant
  }));
  if (variant === "wan_27_image" || variant === "wan_27_image_pro") {
    ownerObjects.push({ message_object_id: "owner-prompt", object_type: "text", model_type: null });
  }
  return {
    complete: true, page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false,
    requested_chat_uuid: "wan-chat", provider_chat_id: "2048",
    messages: [
      { message_id: "owner-ack", provider_chat_id: "2048", author_role: "owner", objects: ownerObjects },
      { message_id: "bot-result", provider_chat_id: "2048", author_role: "bot", objects: Array.from({ length: resultCount }, (_, index) => ({
        message_object_id: `result-${index + 1}`, object_type: "image", model_type: variant
      })) }
    ]
  };
}

test("WAN history binding exposes its strict correlation function", async () => {
  const binding = await import("../src/application/owner-wan-image-history-binding.js").catch(() => null);
  assert.equal(typeof binding?.correlateOwnerWanImageHistoryBinding, "function");
});

test("WAN binding returns only the exact frozen owner-ACK/bot batch context", () => {
  const result = correlateOwnerWanImageHistoryBinding({
    snapshot: snapshot("wan_27_image", 2, 3), requested_chat_uuid: "wan-chat", owner_echo_message_id: "owner-ack",
    scope: "image", variant: "wan_27_image", requested_reference_count: 2, requested_batch_size: 3
  });
  assert.deepEqual(result, {
    status: "READY", chat_uuid: "wan-chat", provider_chat_id: "2048", message_id: "bot-result",
    variant: "wan_27_image", requested_batch_size: 3, requested_reference_count: 2,
    message_object_ids: ["result-1", "result-2", "result-3"]
  });
  assert.ok(Object.isFrozen(result));
  if (result.status === "READY") assert.ok(Object.isFrozen(result.message_object_ids));
  assert.equal(JSON.stringify(result).includes("owner-prompt"), false);
});

test("WAN binding preserves all four exact variants, batches 1-4, and source-valid reference counts", () => {
  const referenceCases: ReadonlyArray<readonly [OwnerWanImageVariant, readonly number[]]> = [
    ["wan_25_i2i_preview", [1, 2, 3]],
    ["wan_26_image", [1, 2, 3, 4]],
    ["wan_27_image", [0, 1, 2, 3, 4, 9]],
    ["wan_27_image_pro", [0, 1, 2, 3, 4, 9]]
  ];
  let checked = 0;
  for (const variant of VARIANTS) {
    const counts = referenceCases.find(([candidate]) => candidate === variant)![1];
    for (const referenceCount of counts) {
      for (let batchSize = 1; batchSize <= 4; batchSize += 1) {
        const result = correlateOwnerWanImageHistoryBinding({
          snapshot: snapshot(variant, referenceCount, batchSize), requested_chat_uuid: "wan-chat",
          owner_echo_message_id: "owner-ack", scope: "image", variant,
          requested_reference_count: referenceCount, requested_batch_size: batchSize
        });
        assert.equal(result.status, "READY", `${variant}, refs=${referenceCount}, batch=${batchSize}`);
        if (result.status === "READY") assert.equal(result.message_object_ids.length, batchSize);
        checked += 1;
      }
    }
  }
  assert.equal(checked, 76);
});

test("WAN history distinguishes pending from closed mismatches without leaking snapshot values", () => {
  const base = snapshot("wan_27_image", 1, 2);
  const input = (value: unknown = base, overrides: Record<string, unknown> = {}) => ({
    snapshot: value, requested_chat_uuid: "wan-chat", owner_echo_message_id: "owner-ack", scope: "image",
    variant: "wan_27_image", requested_reference_count: 1, requested_batch_size: 3, ...overrides
  });
  assert.deepEqual(correlateOwnerWanImageHistoryBinding(input(snapshot("wan_27_image", 1, 0))), {
    status: "PENDING", reason: "BOT_BATCH_PENDING"
  });
  assert.deepEqual(correlateOwnerWanImageHistoryBinding(input(snapshot("wan_27_image", 1, 2))), {
    status: "PENDING", reason: "BOT_BATCH_PENDING"
  });
  assert.deepEqual(correlateOwnerWanImageHistoryBinding(input({ ...base, complete: false })), {
    status: "PENDING", reason: "HISTORY_INCOMPLETE"
  });

  const cases: Array<[unknown, Record<string, unknown>, string]> = [
    [base, { owner_echo_message_id: "wrong-ack" }, "OWNER_ACK_MISMATCH"],
    [{ ...base, requested_chat_uuid: "other-chat" }, {}, "CHAT_SCOPE_MISMATCH"],
    [{ ...base, provider_chat_id: "not-numeric" }, {}, "PROVIDER_CHAT_INVALID"],
    [{ ...base, total_pages: 2 }, {}, "HISTORY_PAGE_INVALID"],
    [snapshot("wan_27_image", 1, 5), {}, "BOT_BATCH_EXCEEDS_REQUEST"],
    [snapshot("wan_27_image", 1, 1), { variant: "wan_27_image_alias" }, "INVALID_INPUT"]
  ];
  for (const [history, overrides, expectedReason] of cases) {
    const result = correlateOwnerWanImageHistoryBinding(input(history, overrides));
    assert.equal(result.status, "INVALID");
    if (result.status === "INVALID") assert.equal(result.reason, expectedReason);
    assert.equal(JSON.stringify(result).includes("owner-prompt"), false);
    assert.equal(JSON.stringify(result).includes("result-1"), false);
  }

  const multipleBots = structuredClone(base);
  multipleBots.total_count = 3;
  multipleBots.messages.push({
    message_id: "bot-result-2", provider_chat_id: "2048", author_role: "bot", objects: []
  });
  assert.deepEqual(correlateOwnerWanImageHistoryBinding(input(multipleBots)), {
    status: "INVALID", reason: "BOT_MESSAGE_AMBIGUOUS"
  });
  const noBot = structuredClone(base);
  noBot.total_count = 1;
  noBot.messages = [noBot.messages[0]!];
  assert.deepEqual(correlateOwnerWanImageHistoryBinding(input(noBot)), {
    status: "PENDING", reason: "BOT_MESSAGE_NOT_FOUND"
  });
});

test("WAN owner history accepts source-shaped nullable reference metadata but rejects role, order, and descriptor ambiguity", () => {
  const nullableReference = structuredClone(snapshot("wan_27_image", 1, 1));
  (nullableReference.messages[0]!.objects[0] as { model_type: string | null }).model_type = null;
  const accepted = correlateOwnerWanImageHistoryBinding({
    snapshot: nullableReference, requested_chat_uuid: "wan-chat", owner_echo_message_id: "owner-ack",
    scope: "image", variant: "wan_27_image", requested_reference_count: 1, requested_batch_size: 1
  });
  assert.equal(accepted.status, "READY");

  const wrongAckRole = structuredClone(snapshot("wan_27_image", 1, 1));
  wrongAckRole.messages[0] = { ...wrongAckRole.messages[0]!, author_role: "other" };
  const wrongAck = correlateOwnerWanImageHistoryBinding({
    snapshot: wrongAckRole, requested_chat_uuid: "wan-chat", owner_echo_message_id: "owner-ack",
    scope: "image", variant: "wan_27_image", requested_reference_count: 1, requested_batch_size: 1
  });
  assert.deepEqual(wrongAck, { status: "INVALID", reason: "OWNER_ACK_MISMATCH" });

  const duplicateObjects = structuredClone(snapshot("wan_27_image", 1, 1));
  duplicateObjects.messages[1]!.objects[0] = { ...duplicateObjects.messages[1]!.objects[0]!, message_object_id: "ref-1" };
  const duplicateResult = correlateOwnerWanImageHistoryBinding({
    snapshot: duplicateObjects, requested_chat_uuid: "wan-chat", owner_echo_message_id: "owner-ack",
    scope: "image", variant: "wan_27_image", requested_reference_count: 1, requested_batch_size: 1
  });
  assert.deepEqual(duplicateResult, { status: "INVALID", reason: "OBJECT_ID_DUPLICATE" });

  let getterCalls = 0;
  const malformed = structuredClone(snapshot("wan_27_image", 1, 1));
  Object.defineProperty(malformed.messages[0]!, "author_role", {
    enumerable: true, get() { getterCalls += 1; throw new Error("must not execute"); }
  });
  const rejectedAccessor = correlateOwnerWanImageHistoryBinding({
    snapshot: malformed, requested_chat_uuid: "wan-chat", owner_echo_message_id: "owner-ack",
    scope: "image", variant: "wan_27_image", requested_reference_count: 1, requested_batch_size: 1
  });
  assert.deepEqual(rejectedAccessor, { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" });
  assert.equal(getterCalls, 0);

  const proxied = new Proxy(snapshot("wan_27_image", 1, 1), {});
  assert.deepEqual(correlateOwnerWanImageHistoryBinding({
    snapshot: proxied, requested_chat_uuid: "wan-chat", owner_echo_message_id: "owner-ack",
    scope: "image", variant: "wan_27_image", requested_reference_count: 1, requested_batch_size: 1
  }), { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" });
});
