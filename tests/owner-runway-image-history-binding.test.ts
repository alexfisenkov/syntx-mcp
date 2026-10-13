import assert from "node:assert/strict";
import test from "node:test";
import { correlateOwnerRunwayImageHistoryBinding } from "../src/application/owner-runway-image-history-binding.js";

const REQUESTED_CHAT = "chat_runway_001";
const PROVIDER_CHAT = "987654321";
const ECHO_ID = "owner_echo_001";

function snapshot(referenceCount = 0) {
  return {
    complete: true,
    page: 1,
    page_size: 10,
    total_count: 2,
    total_pages: 1,
    has_next: false,
    has_previous: false,
    requested_chat_uuid: REQUESTED_CHAT,
    provider_chat_id: PROVIDER_CHAT,
    messages: [
      {
        message_id: ECHO_ID,
        provider_chat_id: PROVIDER_CHAT,
        author_role: "owner",
        objects: [
          ...Array.from({ length: referenceCount }, (_, index) => ({
            message_object_id: `owner_ref_${index + 1}`,
            object_type: "image",
            model_type: "runway_frames"
          })),
          { message_object_id: "owner_prompt_01", object_type: "text", model_type: "runway_frames" }
        ]
      },
      {
        message_id: "bot_result_001",
        provider_chat_id: PROVIDER_CHAT,
        author_role: "bot",
        objects: [{ message_object_id: "bot_image_001", object_type: "image", model_type: "runway_frames" }]
      }
    ]
  };
}

function input(referenceCount = 0, value = snapshot(referenceCount)) {
  return {
    snapshot: value,
    requested_chat_uuid: REQUESTED_CHAT,
    owner_echo_message_id: ECHO_ID,
    variant: "runway_frames",
    requested_reference_count: referenceCount,
    requested_output_count: 1
  };
}

test("Runway binds one exact owner ACK and ordered image references to one bot output", () => {
  for (let referenceCount = 0; referenceCount <= 3; referenceCount += 1) {
    const result = correlateOwnerRunwayImageHistoryBinding(input(referenceCount));
    assert.equal(result.status, "READY");
    if (result.status !== "READY") continue;
    assert.equal(result.chat_uuid, REQUESTED_CHAT);
    assert.equal(result.provider_chat_id, PROVIDER_CHAT);
    assert.equal(result.owner_echo_message_id, ECHO_ID);
    assert.equal(result.result_message_id, "bot_result_001");
    assert.equal(result.variant, "runway_frames");
    assert.equal(result.output_count, 1);
    assert.deepEqual(result.requested_reference_kinds, Array(referenceCount).fill("image"));
    assert.deepEqual(result.message_object_ids, ["bot_image_001"]);
    assert.equal(result.namespace_confidence, "SOURCE_SHAPED_UNVERIFIED");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.message_object_ids));
  }
});

test("Runway history remains pending until the complete owner ACK and bot result are present", () => {
  const incomplete = snapshot();
  incomplete.complete = false;
  assert.deepEqual(correlateOwnerRunwayImageHistoryBinding(input(0, incomplete)), { status: "PENDING", reason: "HISTORY_INCOMPLETE" });
  const missingOwner = snapshot();
  missingOwner.messages.shift();
  missingOwner.total_count = 1;
  assert.deepEqual(correlateOwnerRunwayImageHistoryBinding(input(0, missingOwner)), { status: "PENDING", reason: "OWNER_ACK_NOT_FOUND" });
  const missingBot = snapshot();
  missingBot.messages.pop();
  missingBot.total_count = 1;
  assert.deepEqual(correlateOwnerRunwayImageHistoryBinding(input(0, missingBot)), { status: "PENDING", reason: "BOT_MESSAGE_NOT_FOUND" });
});

test("Runway history rejects wrong ACK, ordering, references, model, IDs, and extra rows", () => {
  const wrongAck = snapshot();
  wrongAck.messages[0]!.message_id = "other_owner_echo";
  assert.deepEqual(correlateOwnerRunwayImageHistoryBinding(input(0, wrongAck)), { status: "INVALID", reason: "OWNER_ACK_MISMATCH" });

  const wrongOrder = snapshot(2);
  wrongOrder.messages[0]!.objects[0]!.object_type = "text";
  assert.deepEqual(correlateOwnerRunwayImageHistoryBinding(input(2, wrongOrder)), { status: "INVALID", reason: "OWNER_OBJECTS_INVALID" });

  const wrongModel = snapshot();
  wrongModel.messages[1]!.objects[0]!.model_type = "banana";
  assert.deepEqual(correlateOwnerRunwayImageHistoryBinding(input(0, wrongModel)), { status: "INVALID", reason: "BOT_MODEL_MISMATCH" });

  const duplicateObject = snapshot();
  duplicateObject.messages[1]!.objects[0]!.message_object_id = "owner_prompt_01";
  assert.deepEqual(correlateOwnerRunwayImageHistoryBinding(input(0, duplicateObject)), { status: "INVALID", reason: "OBJECT_ID_DUPLICATE" });

  const extraRow = snapshot();
  extraRow.total_count = 3;
  extraRow.messages.push({ message_id: "unrelated_message", provider_chat_id: PROVIDER_CHAT, author_role: "other", objects: [] });
  assert.deepEqual(correlateOwnerRunwayImageHistoryBinding(input(0, extraRow)), { status: "INVALID", reason: "HISTORY_MESSAGE_SET_INVALID" });
});

test("Runway history refuses nonnumeric provider chat IDs and accessor-bearing shapes", () => {
  const wrongProvider = snapshot();
  wrongProvider.provider_chat_id = "not-numeric";
  assert.deepEqual(correlateOwnerRunwayImageHistoryBinding(input(0, wrongProvider)), { status: "INVALID", reason: "PROVIDER_CHAT_INVALID" });

  let getterCalls = 0;
  const hostile = input();
  Object.defineProperty(hostile, "requested_chat_uuid", { enumerable: true, get() { getterCalls += 1; return REQUESTED_CHAT; } });
  assert.deepEqual(correlateOwnerRunwayImageHistoryBinding(hostile), { status: "INVALID", reason: "INVALID_INPUT" });
  assert.equal(getterCalls, 0);
});
