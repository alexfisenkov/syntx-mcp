import assert from "node:assert/strict";
import test from "node:test";
import { correlateOwnerSeedreamImageHistoryBinding } from "../src/application/owner-seedream-image-history-binding.js";

const VARIANTS = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;
const LIMITS = [4, 4, 14, 10, 10] as const;
const CHAT = "seedream-chat";
const PROVIDER_CHAT = "321654987";
const ECHO = "owner-seedream-echo";

function snapshot(variant: typeof VARIANTS[number], references = 0) {
  return {
    complete: true as const, page: 1 as const, page_size: 10 as const, total_count: 2, total_pages: 1,
    has_next: false as const, has_previous: false, requested_chat_uuid: CHAT, provider_chat_id: PROVIDER_CHAT,
    messages: [
      { message_id: ECHO, provider_chat_id: PROVIDER_CHAT, author_role: "owner" as const, objects: [
        ...Array.from({ length: references }, (_, index) => ({ message_object_id: `reference-${index + 1}`, object_type: "image", model_type: variant })),
        { message_object_id: "prompt-object", object_type: "text", model_type: variant }
      ] },
      { message_id: "seedream-bot-result", provider_chat_id: PROVIDER_CHAT, author_role: "bot" as const,
        objects: [{ message_object_id: "seedream-output", object_type: "image", model_type: variant }] }
    ]
  };
}
function input(variant: typeof VARIANTS[number], references = 0, history = snapshot(variant, references)) {
  return { snapshot: history, requested_chat_uuid: CHAT, owner_echo_message_id: ECHO, variant,
    requested_reference_count: references, requested_output_count: 1 as const };
}

test("Seedream history binds every exact variant, its source ref limit, and one ordered output", () => {
  for (let index = 0; index < VARIANTS.length; index += 1) {
    const variant = VARIANTS[index]!;
    const referenceCount = LIMITS[index]!;
    const result = correlateOwnerSeedreamImageHistoryBinding(input(variant, referenceCount));
    assert.equal(result.status, "READY", variant);
    if (result.status !== "READY") continue;
    assert.equal(result.chat_uuid, CHAT);
    assert.equal(result.provider_chat_id, PROVIDER_CHAT);
    assert.equal(result.owner_echo_message_id, ECHO);
    assert.equal(result.result_message_id, "seedream-bot-result");
    assert.equal(result.variant, variant);
    assert.equal(result.model_type, variant);
    assert.equal(result.ai_name, "seedream");
    assert.equal(result.output_count, 1);
    assert.deepEqual(result.requested_reference_kinds, Array(referenceCount).fill("image"));
    assert.deepEqual(result.message_object_ids, ["seedream-output"]);
    assert.equal(result.namespace_confidence, "SOURCE_SHAPED_UNVERIFIED");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.message_object_ids));
  }
});

test("Seedream history reports pending only for incomplete or missing exact rows", () => {
  const incomplete = snapshot("seedream-5");
  incomplete.complete = false as never;
  assert.deepEqual(correlateOwnerSeedreamImageHistoryBinding(input("seedream-5", 0, incomplete)),
    { status: "PENDING", reason: "HISTORY_INCOMPLETE" });
  const noBot = snapshot("seedream-5");
  noBot.messages.pop(); noBot.total_count = 1;
  assert.deepEqual(correlateOwnerSeedreamImageHistoryBinding(input("seedream-5", 0, noBot)),
    { status: "PENDING", reason: "BOT_MESSAGE_NOT_FOUND" });
});

test("Seedream history rejects wrong ACK/model, duplicate IDs, extra rows, and references beyond source limits", () => {
  const wrongAck = snapshot("seedream-5");
  wrongAck.messages[0]!.message_id = "other-echo";
  assert.deepEqual(correlateOwnerSeedreamImageHistoryBinding(input("seedream-5", 0, wrongAck)),
    { status: "INVALID", reason: "OWNER_ACK_MISMATCH" });

  const wrongModel = snapshot("seedream-5");
  wrongModel.messages[1]!.objects[0]!.model_type = "seedream-4";
  assert.deepEqual(correlateOwnerSeedreamImageHistoryBinding(input("seedream-5", 0, wrongModel)),
    { status: "INVALID", reason: "BOT_MODEL_MISMATCH" });

  const duplicate = snapshot("seedream-5", 1);
  duplicate.messages[0]!.objects[1]!.message_object_id = "reference-1";
  assert.deepEqual(correlateOwnerSeedreamImageHistoryBinding(input("seedream-5", 1, duplicate)),
    { status: "INVALID", reason: "OBJECT_ID_DUPLICATE" });

  const extra = snapshot("seedream-5");
  extra.messages.push({ message_id: "other-row", provider_chat_id: PROVIDER_CHAT, author_role: "other", objects: [] } as never);
  extra.total_count = 3;
  assert.deepEqual(correlateOwnerSeedreamImageHistoryBinding(input("seedream-5", 0, extra)),
    { status: "INVALID", reason: "HISTORY_MESSAGE_SET_INVALID" });
  assert.deepEqual(correlateOwnerSeedreamImageHistoryBinding(input("seedream-4", 5)),
    { status: "INVALID", reason: "INVALID_INPUT" });
});

test("Seedream history requires one exact ordered image result and rejects ACK/model/provider drift", () => {
  const reversed = snapshot("seedream-5", 2);
  reversed.messages[0]!.objects.reverse();
  assert.deepEqual(correlateOwnerSeedreamImageHistoryBinding(input("seedream-5", 2, reversed)),
    { status: "INVALID", reason: "OWNER_OBJECTS_INVALID" });

  const ownerDrift = snapshot("seedream-5", 1);
  ownerDrift.messages[0]!.objects[0]!.model_type = "seedream-4";
  assert.deepEqual(correlateOwnerSeedreamImageHistoryBinding(input("seedream-5", 1, ownerDrift)),
    { status: "INVALID", reason: "OWNER_OBJECTS_INVALID" });

  const duplicateMessages = snapshot("seedream-5");
  duplicateMessages.messages[1]!.message_id = ECHO;
  assert.deepEqual(correlateOwnerSeedreamImageHistoryBinding(input("seedream-5", 0, duplicateMessages)),
    { status: "INVALID", reason: "MESSAGE_ID_DUPLICATE" });

  const chatDrift = snapshot("seedream-5");
  chatDrift.requested_chat_uuid = "different-chat";
  assert.deepEqual(correlateOwnerSeedreamImageHistoryBinding(input("seedream-5", 0, chatDrift)),
    { status: "INVALID", reason: "CHAT_SCOPE_MISMATCH" });
  assert.deepEqual(correlateOwnerSeedreamImageHistoryBinding({ ...input("seedream-5"), requested_output_count: 2 }),
    { status: "INVALID", reason: "INVALID_INPUT" });
});
