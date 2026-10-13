import assert from "node:assert/strict";
import test from "node:test";
import {
  correlateOwnerIdeogramImageHistoryBinding
} from "../src/application/owner-ideogram-image-history-binding.js";

const CONTEXTS = [
  ["ideogram", "generate"], ["ideogram", "remix"], ["ideogram", "reframe"],
  ["ideogram", "replace_background"], ["ideogram", "character_reference"],
  ["ideogram_40", "generate"], ["ideogram_40", "transparent"],
  ["ideogram_45", "generate"], ["ideogram_45", "precise_edit"]
] as const;

function history(model_id: string, outputCount: number, options: {
  readonly chat?: string; readonly ack?: string; readonly bot?: string; readonly botObjects?: readonly Record<string, unknown>[];
  readonly ownerObjects?: readonly Record<string, unknown>[]; readonly messages?: readonly Record<string, unknown>[];
} = {}) {
  const chat = options.chat ?? "ideogram-chat-1";
  const ack = options.ack ?? "owner-ack-1";
  const bot = options.bot ?? "bot-message-1";
  const ownerObjects = options.ownerObjects ?? [{ message_object_id: "owner-file-1", object_type: "opaque-owner-object", model_type: null }];
  const botObjects = options.botObjects ?? Array.from({ length: outputCount }, (_, index) => ({
    message_object_id: `bot-image-${index + 1}`, object_type: "image", model_type: model_id
  }));
  const messages = options.messages ?? [
    { message_id: ack, provider_chat_id: "12345", author_role: "owner", objects: ownerObjects },
    { message_id: bot, provider_chat_id: "12345", author_role: "bot", objects: botObjects }
  ];
  return { complete: true, page: 1, page_size: 10, total_count: messages.length, total_pages: 1,
    has_next: false, has_previous: false, requested_chat_uuid: chat, provider_chat_id: "12345", messages };
}

test("binds all nine Ideogram model/mode contexts to one exact fresh-chat ACK and following bot message", () => {
  assert.equal(CONTEXTS.length, 9);
  for (const [model_id, mode] of CONTEXTS) {
    const binding = correlateOwnerIdeogramImageHistoryBinding({
      snapshot: history(model_id, 1), requested_chat_uuid: "ideogram-chat-1",
      owner_echo_message_id: "owner-ack-1", model_id, mode, requested_mask_present: false, output_count: 1
    });
    assert.equal(binding.status, "READY");
    if (binding.status !== "READY") continue;
    assert.equal(binding.chat_uuid, "ideogram-chat-1");
    assert.equal(binding.owner_echo_message_id, "owner-ack-1");
    assert.equal(binding.result_message_id, "bot-message-1");
    assert.equal(binding.provider_chat_id, "12345");
    assert.equal(binding.model_id, model_id);
    assert.equal(binding.mode, mode);
    assert.equal(binding.output_count, 1);
    assert.deepEqual(binding.message_object_ids, ["bot-image-1"]);
    assert.equal(binding.mask_acceptance, "NOT_REQUESTED");
    assert.equal(binding.mode_confidence, "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO");
    assert.equal(binding.namespace_confidence, "SOURCE_SHAPED_UNVERIFIED");
    assert.equal(binding.backend_acceptance, "UNPROVEN");
  }
});

test("accepts only literal output counts 1 through 8 and preserves bot object order", () => {
  for (const output_count of [1, 2, 8] as const) {
    const model_id = "ideogram_45";
    const mode = "generate";
    const ids = Array.from({ length: output_count }, (_, index) => `output-${output_count - index}`);
    const botObjects = ids.map((message_object_id) => ({ message_object_id, object_type: "image", model_type: model_id }));
    const binding = correlateOwnerIdeogramImageHistoryBinding({ snapshot: history(model_id, output_count, { botObjects }),
      requested_chat_uuid: "ideogram-chat-1", owner_echo_message_id: "owner-ack-1", model_id, mode, requested_mask_present: false, output_count });
    assert.equal(binding.status, "READY");
    if (binding.status === "READY") assert.deepEqual(binding.message_object_ids, ids);
  }
  for (const output_count of [0, 9, 1.5, Number.MAX_SAFE_INTEGER]) {
    const binding = correlateOwnerIdeogramImageHistoryBinding({ snapshot: history("ideogram", 1),
      requested_chat_uuid: "ideogram-chat-1", owner_echo_message_id: "owner-ack-1", model_id: "ideogram", mode: "generate", requested_mask_present: false, output_count });
    assert.equal(binding.status, "INVALID");
    if (binding.status === "INVALID") assert.equal(binding.reason, "INVALID_INPUT");
  }
  const illegalMask = correlateOwnerIdeogramImageHistoryBinding({ snapshot: history("ideogram", 1),
    requested_chat_uuid: "ideogram-chat-1", owner_echo_message_id: "owner-ack-1", model_id: "ideogram", mode: "generate",
    requested_mask_present: true, output_count: 1 });
  assert.equal(illegalMask.status, "INVALID");
  if (illegalMask.status === "INVALID") assert.equal(illegalMask.reason, "INVALID_INPUT");
});

test("reports missing and short history as pending or partial without inventing owner asset roles", () => {
  const ownerOnly = history("ideogram", 1, { messages: [
    { message_id: "owner-ack-1", provider_chat_id: "12345", author_role: "owner", objects: [] }
  ] });
  const pending = correlateOwnerIdeogramImageHistoryBinding({ snapshot: ownerOnly,
    requested_chat_uuid: "ideogram-chat-1", owner_echo_message_id: "owner-ack-1", model_id: "ideogram", mode: "generate", requested_mask_present: false, output_count: 1 });
  assert.equal(pending.status, "PENDING");
  if (pending.status === "PENDING") assert.equal(pending.reason, "BOT_MESSAGE_NOT_FOUND");

  const partial = correlateOwnerIdeogramImageHistoryBinding({ snapshot: history("ideogram", 1, {
    botObjects: [{ message_object_id: "partial-image-1", object_type: "image", model_type: "ideogram" }]
  }), requested_chat_uuid: "ideogram-chat-1", owner_echo_message_id: "owner-ack-1",
  model_id: "ideogram", mode: "generate", requested_mask_present: false, output_count: 2 });
  assert.equal(partial.status, "PARTIAL");
  if (partial.status === "PARTIAL") {
    assert.equal(partial.reason, "OUTPUT_BATCH_PARTIAL");
    assert.deepEqual(partial.message_object_ids, ["partial-image-1"]);
  }

  const maskAmbiguous = correlateOwnerIdeogramImageHistoryBinding({ snapshot: history("ideogram_45", 1, {
    ownerObjects: [{ message_object_id: "owner-object-1", object_type: "opaque-owner-object", model_type: null }]
  }), requested_chat_uuid: "ideogram-chat-1", owner_echo_message_id: "owner-ack-1",
  model_id: "ideogram_45", mode: "precise_edit", requested_mask_present: true, output_count: 1 });
  assert.equal(maskAmbiguous.status, "READY");
  if (maskAmbiguous.status === "READY") {
    assert.equal(maskAmbiguous.requested_mask_present, true);
    assert.equal((maskAmbiguous as { readonly mask_acceptance?: string }).mask_acceptance, "UNPROVEN");
    assert.equal(maskAmbiguous.mode_confidence, "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO");
    assert.equal(maskAmbiguous.namespace_confidence, "SOURCE_SHAPED_UNVERIFIED");
    assert.equal(maskAmbiguous.backend_acceptance, "UNPROVEN");
    assert.deepEqual(maskAmbiguous.message_object_ids, ["bot-image-1"]);
  }
  assert.equal(JSON.stringify(maskAmbiguous).includes('"type":"mask"'), false);

  const noMaskPreciseEdit = correlateOwnerIdeogramImageHistoryBinding({ snapshot: history("ideogram_45", 1),
    requested_chat_uuid: "ideogram-chat-1", owner_echo_message_id: "owner-ack-1", model_id: "ideogram_45",
    mode: "precise_edit", requested_mask_present: false, output_count: 1 });
  assert.equal(noMaskPreciseEdit.status, "READY");
  if (noMaskPreciseEdit.status === "READY") assert.equal((noMaskPreciseEdit as { readonly mask_acceptance?: string }).mask_acceptance, "NOT_REQUESTED");

  const maskedPartial = correlateOwnerIdeogramImageHistoryBinding({ snapshot: history("ideogram_45", 2, {
    botObjects: [{ message_object_id: "partial-image-1", object_type: "image", model_type: "ideogram_45" }]
  }), requested_chat_uuid: "ideogram-chat-1", owner_echo_message_id: "owner-ack-1", model_id: "ideogram_45",
  mode: "precise_edit", requested_mask_present: true, output_count: 2 });
  assert.equal(maskedPartial.status, "PARTIAL");
  if (maskedPartial.status === "PARTIAL") assert.equal((maskedPartial as { readonly mask_acceptance?: string }).mask_acceptance, "UNPROVEN");
});

test("rejects wrong ACK/chat/chronology, duplicate IDs, wrong model, and unsafe object namespaces", () => {
  const cases = [
    { snapshot: history("ideogram", 1), requested_chat_uuid: "other-chat", owner_echo_message_id: "owner-ack-1", reason: "CHAT_SCOPE_MISMATCH" },
    { snapshot: history("ideogram", 1), requested_chat_uuid: "ideogram-chat-1", owner_echo_message_id: "other-ack", reason: "OWNER_ACK_MISMATCH" },
    { snapshot: history("ideogram", 1, { messages: [
      { message_id: "bot-message-1", provider_chat_id: "12345", author_role: "bot", objects: [{ message_object_id: "out", object_type: "image", model_type: "ideogram" }] },
      { message_id: "owner-ack-1", provider_chat_id: "12345", author_role: "owner", objects: [] }
    ] }), requested_chat_uuid: "ideogram-chat-1", owner_echo_message_id: "owner-ack-1", reason: "BOT_MESSAGE_BEFORE_ACK" },
    { snapshot: history("ideogram", 1, { botObjects: [
      { message_object_id: "same-id", object_type: "image", model_type: "ideogram" },
      { message_object_id: "same-id", object_type: "image", model_type: "ideogram" }
    ] }), requested_chat_uuid: "ideogram-chat-1", owner_echo_message_id: "owner-ack-1", reason: "OBJECT_ID_DUPLICATE" },
    { snapshot: history("ideogram_40", 1), requested_chat_uuid: "ideogram-chat-1", owner_echo_message_id: "owner-ack-1", reason: "BOT_MODEL_MISMATCH" }
  ] as const;
  for (const entry of cases) {
    const binding = correlateOwnerIdeogramImageHistoryBinding({ snapshot: entry.snapshot,
      requested_chat_uuid: entry.requested_chat_uuid, owner_echo_message_id: entry.owner_echo_message_id,
      model_id: "ideogram", mode: "generate", requested_mask_present: false, output_count: 1 });
    assert.equal(binding.status, "INVALID");
    if (binding.status === "INVALID") assert.equal(binding.reason, entry.reason);
  }
});
