import assert from "node:assert/strict";
import test from "node:test";
import { correlateOwnerFluxImageHistoryBinding } from "../src/application/owner-flux-image-history-binding.js";

const VARIANTS = ["flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"] as const;
const CHAT = "flux-chat";
const PROVIDER_CHAT = "321654987";
const ECHO = "owner-flux-echo";

function snapshot(variant: typeof VARIANTS[number], references = 0) {
  return {
    complete: true as const, page: 1 as const, page_size: 10 as const, total_count: 2, total_pages: 1,
    has_next: false as const, has_previous: false, requested_chat_uuid: CHAT, provider_chat_id: PROVIDER_CHAT,
    messages: [
      { message_id: ECHO, provider_chat_id: PROVIDER_CHAT, author_role: "owner" as const, objects: [
        ...Array.from({ length: references }, (_, index) => ({ message_object_id: `flux-reference-${index + 1}`, object_type: "image", model_type: variant })),
        { message_object_id: "prompt-object", object_type: "text", model_type: variant }
      ] },
      { message_id: "flux-bot-result", provider_chat_id: PROVIDER_CHAT, author_role: "bot" as const,
        objects: [{ message_object_id: "flux-output", object_type: "image", model_type: variant }] }
    ]
  };
}

function input(variant: typeof VARIANTS[number], references = 0, history = snapshot(variant, references)) {
  return { snapshot: history, requested_chat_uuid: CHAT, owner_echo_message_id: ECHO, variant,
    requested_reference_count: references, requested_output_count: 1 as const };
}

test("Flux history binds all three exact models, Flux-1's single ordered ref, and one output", () => {
  for (const variant of VARIANTS) {
    for (const references of variant === "flux-1" ? [0, 1] : [0]) {
      const result = correlateOwnerFluxImageHistoryBinding(input(variant, references));
      assert.equal(result.status, "READY", `${variant}/${references}`);
      if (result.status !== "READY") continue;
      assert.equal(result.chat_uuid, CHAT);
      assert.equal(result.provider_chat_id, PROVIDER_CHAT);
      assert.equal(result.owner_echo_message_id, ECHO);
      assert.equal(result.result_message_id, "flux-bot-result");
      assert.equal(result.variant, variant);
      assert.equal(result.model_type, variant);
      assert.equal(result.ai_name, "flux");
      assert.equal(result.output_count, 1);
      assert.deepEqual(result.requested_reference_kinds, Array(references).fill("image"));
      assert.deepEqual(result.message_object_ids, ["flux-output"]);
      assert.equal(result.namespace_confidence, "SOURCE_SHAPED_UNVERIFIED");
      assert.equal(result.backend_acceptance, "UNPROVEN");
      assert.ok(Object.isFrozen(result) && Object.isFrozen(result.message_object_ids));
    }
  }
});

test("Flux history stays pending for incomplete rows and rejects ACK, producer, reference-count and row mismatches", () => {
  const incomplete = snapshot("flux-1");
  incomplete.complete = false as never;
  assert.deepEqual(correlateOwnerFluxImageHistoryBinding(input("flux-1", 0, incomplete)),
    { status: "PENDING", reason: "HISTORY_INCOMPLETE" });

  const noBot = snapshot("flux-1");
  noBot.messages.pop(); noBot.total_count = 1;
  assert.deepEqual(correlateOwnerFluxImageHistoryBinding(input("flux-1", 0, noBot)),
    { status: "PENDING", reason: "BOT_MESSAGE_NOT_FOUND" });

  const wrongAck = snapshot("flux-1");
  wrongAck.messages[0]!.message_id = "other-echo";
  assert.deepEqual(correlateOwnerFluxImageHistoryBinding(input("flux-1", 0, wrongAck)),
    { status: "INVALID", reason: "OWNER_ACK_MISMATCH" });

  const wrongProducer = snapshot("flux-1");
  wrongProducer.messages[1]!.objects[0]!.model_type = "flux-pro-1.1";
  assert.deepEqual(correlateOwnerFluxImageHistoryBinding(input("flux-1", 0, wrongProducer)),
    { status: "INVALID", reason: "BOT_MODEL_MISMATCH" });
  assert.deepEqual(correlateOwnerFluxImageHistoryBinding(input("flux-pro-1.1", 1)),
    { status: "INVALID", reason: "INVALID_INPUT" });
  assert.deepEqual(correlateOwnerFluxImageHistoryBinding(input("flux-pro-1.1-ultra", 0, snapshot("flux-pro-1.1"))),
    { status: "INVALID", reason: "OWNER_OBJECTS_INVALID" });
});

test("Flux history rejects duplicate identities, source-order drift, hostile shapes and foreign chat scope", () => {
  const duplicate = snapshot("flux-1", 1);
  duplicate.messages[0]!.objects[1]!.message_object_id = "flux-reference-1";
  assert.deepEqual(correlateOwnerFluxImageHistoryBinding(input("flux-1", 1, duplicate)),
    { status: "INVALID", reason: "OBJECT_ID_DUPLICATE" });

  const wrongOrder = snapshot("flux-1", 1);
  wrongOrder.messages[0]!.objects.reverse();
  assert.deepEqual(correlateOwnerFluxImageHistoryBinding(input("flux-1", 1, wrongOrder)),
    { status: "INVALID", reason: "OWNER_OBJECTS_INVALID" });

  const foreignChat = snapshot("flux-1");
  foreignChat.requested_chat_uuid = "another-chat";
  assert.deepEqual(correlateOwnerFluxImageHistoryBinding(input("flux-1", 0, foreignChat)),
    { status: "INVALID", reason: "CHAT_SCOPE_MISMATCH" });

  const accessor = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(accessor, "snapshot", { enumerable: true, get() { throw new Error("must not invoke"); } });
  assert.deepEqual(correlateOwnerFluxImageHistoryBinding(accessor), { status: "INVALID", reason: "INVALID_INPUT" });
});
