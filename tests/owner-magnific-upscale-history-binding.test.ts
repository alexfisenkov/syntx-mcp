import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient, type ChatMessageHistorySnapshot } from "../src/adapter/syntx/chat-http-client.js";
import type { OwnerMagnificUpscaleVariant } from "../src/application/owner-magnific-upscale-parameters.js";
import {
  correlateOwnerMagnificUpscaleHistoryBinding,
  OWNER_MAGNIFIC_HISTORY_BINDING_REASONS,
  type OwnerMagnificHistoryBindingInvalidReason
} from "../src/application/owner-magnific-upscale-history-binding.js";

const CHAT_UUID = "magnific-chat-uuid-01";
const PROVIDER_CHAT_ID = "7654321";
const OWNER_ECHO_ID = "owner-echo-01";
const BOT_MESSAGE_ID = "bot-message-02";
const OWNER_IMAGE_ID = "owner-image-11";
const OWNER_TEXT_ID = "owner-text-12";
const BOT_IMAGE_ID = "bot-image-21";
const VARIANTS = ["creative", "precision_v1", "precision_v2"] as const;

function row(
  message_id: string,
  author_role: "owner" | "bot" | "other",
  objects: readonly { message_object_id: string; object_type: string; model_type: string | null }[],
  provider_chat_id = PROVIDER_CHAT_ID
) {
  return { message_id, provider_chat_id, author_role, objects };
}

function snapshot(
  variant: OwnerMagnificUpscaleVariant,
  messages: readonly unknown[] = [
    row(OWNER_ECHO_ID, "owner", [
      { message_object_id: OWNER_IMAGE_ID, object_type: "image", model_type: null },
      { message_object_id: OWNER_TEXT_ID, object_type: "text", model_type: variant }
    ]),
    row(BOT_MESSAGE_ID, "bot", [{ message_object_id: BOT_IMAGE_ID, object_type: "image", model_type: variant }])
  ],
  overrides: Record<string, unknown> = {}
) {
  return {
    complete: true,
    page: 1,
    page_size: 10,
    total_count: messages.length,
    total_pages: 1,
    has_next: false,
    has_previous: false,
    requested_chat_uuid: CHAT_UUID,
    provider_chat_id: PROVIDER_CHAT_ID,
    messages,
    ...overrides
  };
}

function correlate(value: unknown, variant: unknown = "creative", chatUuid: unknown = CHAT_UUID, echoId: unknown = OWNER_ECHO_ID) {
  return correlateOwnerMagnificUpscaleHistoryBinding({
    snapshot: value, requested_chat_uuid: chatUuid, owner_echo_message_id: echoId, variant
  });
}

function invalid(value: unknown, reason: OwnerMagnificHistoryBindingInvalidReason, variant: unknown = "creative") {
  assert.deepEqual(correlate(value, variant), { kind: "INVALID", reason });
}

test("correlates one owner ACK to an exact variant image for all three Magnific model types", () => {
  for (const variant of VARIANTS) {
    const result = correlate(snapshot(variant), variant);
    assert.deepEqual(result, {
      kind: "READY", provider_chat_id: PROVIDER_CHAT_ID, bot_message_id: BOT_MESSAGE_ID, object_id: BOT_IMAGE_ID
    });
  }
});

test("owner echo permits empty, image, text, or one image plus one text in either order", () => {
  for (const ownerObjects of [
    [],
    [{ message_object_id: OWNER_IMAGE_ID, object_type: "image", model_type: null }],
    [{ message_object_id: OWNER_TEXT_ID, object_type: "text", model_type: "creative" }],
    [
      { message_object_id: OWNER_TEXT_ID, object_type: "text", model_type: null },
      { message_object_id: OWNER_IMAGE_ID, object_type: "image", model_type: "creative" }
    ]
  ]) {
    const value = snapshot("creative", [
      row(OWNER_ECHO_ID, "owner", ownerObjects),
      row(BOT_MESSAGE_ID, "bot", [{ message_object_id: BOT_IMAGE_ID, object_type: "image", model_type: "creative" }])
    ]);
    assert.deepEqual(correlate(value), {
      kind: "READY", provider_chat_id: PROVIDER_CHAT_ID, bot_message_id: BOT_MESSAGE_ID, object_id: BOT_IMAGE_ID
    });
  }
});

test("owner-only ACK and known bot with empty objects remain pending without late selection", () => {
  assert.deepEqual(correlate(snapshot("precision_v1", [row(OWNER_ECHO_ID, "owner", [])]), "precision_v1"), {
    kind: "PENDING", provider_chat_id: PROVIDER_CHAT_ID, bot_message_id: null
  });
  assert.deepEqual(correlate(snapshot("precision_v2", [
    row(OWNER_ECHO_ID, "owner", []), row(BOT_MESSAGE_ID, "bot", [])
  ]), "precision_v2"), {
    kind: "PENDING", provider_chat_id: PROVIDER_CHAT_ID, bot_message_id: BOT_MESSAGE_ID
  });
});

test("rejects caller scope mismatch, cross-chat rows, and incomplete or inconsistent one-page envelopes", () => {
  invalid(snapshot("creative", undefined, { requested_chat_uuid: "another-chat" }), "REQUESTED_CHAT_MISMATCH");
  invalid(snapshot("creative", undefined, { complete: false }), "PAGE_INCOMPLETE");
  invalid(snapshot("creative", undefined, { page: 2 }), "PAGE_INCOMPLETE");
  invalid(snapshot("creative", undefined, { page_size: 9 }), "PAGE_INCOMPLETE");
  invalid(snapshot("creative", undefined, { has_next: true }), "PAGE_INCOMPLETE");
  invalid(snapshot("creative", undefined, { total_count: 1 }), "TOTAL_COUNT_MISMATCH");
  invalid(snapshot("creative", undefined, { total_pages: 2 }), "TOTAL_PAGES_MISMATCH");
  invalid(snapshot("creative", [row(OWNER_ECHO_ID, "owner", []), row(BOT_MESSAGE_ID, "bot", [], "123")]), "PROVIDER_CHAT_MISMATCH");
  invalid(snapshot("creative", undefined, { provider_chat_id: "not-numeric" }), "PROVIDER_CHAT_ID_INVALID");
  invalid(snapshot("creative"), "INPUT_SCOPE_INVALID", "magnific");
  assert.deepEqual(correlate(snapshot("creative"), "creative", CHAT_UUID, "https://example.invalid/owner-echo"), {
    kind: "INVALID", reason: "INPUT_SCOPE_INVALID"
  });
});

test("owner echo must be unique, exact, and have a nonbot owner role with bounded image/text objects", () => {
  invalid(snapshot("creative", []), "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID");
  const tenRows = [
    row(OWNER_ECHO_ID, "owner", []),
    ...Array.from({ length: 9 }, (_, index) => row(`extra-row-${index}`, "bot", []))
  ];
  invalid(snapshot("creative", tenRows), "MESSAGE_CARDINALITY_INVALID");
  invalid(snapshot("creative", [row(OWNER_ECHO_ID, "bot", []), row(BOT_MESSAGE_ID, "bot", [])]), "OWNER_ECHO_AUTHOR_MISMATCH");
  invalid(snapshot("creative", [
    row(OWNER_ECHO_ID, "owner", []), row(OWNER_ECHO_ID, "owner", [])
  ]), "DUPLICATE_MESSAGE_ID");
  invalid(snapshot("creative", [
    row(OWNER_ECHO_ID, "owner", []), row("second-owner-echo", "owner", [])
  ]), "OWNER_ECHO_AMBIGUOUS");
  invalid(snapshot("creative", [
    row("unexpected-owner", "owner", []), row(BOT_MESSAGE_ID, "bot", [])
  ]), "OWNER_ECHO_AUTHOR_MISMATCH");
  invalid(snapshot("creative", [
    row(OWNER_ECHO_ID, "owner", [
      { message_object_id: OWNER_IMAGE_ID, object_type: "image", model_type: "precision_v1" }
    ]), row(BOT_MESSAGE_ID, "bot", [])
  ]), "OWNER_ECHO_OBJECT_INVALID");
  invalid(snapshot("creative", [
    row(OWNER_ECHO_ID, "owner", [
      { message_object_id: OWNER_IMAGE_ID, object_type: "image", model_type: null },
      { message_object_id: OWNER_TEXT_ID, object_type: "text", model_type: null },
      { message_object_id: "third-object", object_type: "text", model_type: null }
    ]), row(BOT_MESSAGE_ID, "bot", [])
  ]), "OWNER_ECHO_OBJECT_INVALID");
  invalid(snapshot("creative", [row(OWNER_ECHO_ID, "owner", []), row(BOT_MESSAGE_ID, "other", [])]), "BOT_CANDIDATE_CARDINALITY_INVALID");
});

test("READY requires exactly one attributable bot row and one image object of the requested variant", () => {
  assert.deepEqual(correlate(snapshot("creative", [row(OWNER_ECHO_ID, "owner", [])])), {
    kind: "PENDING", provider_chat_id: PROVIDER_CHAT_ID, bot_message_id: null
  });
  invalid(snapshot("creative", [row(OWNER_ECHO_ID, "owner", []), row(BOT_MESSAGE_ID, "bot", [
    { message_object_id: BOT_IMAGE_ID, object_type: "image", model_type: "magnific" }
  ])]), "BOT_OBJECT_INVALID", "creative");
  invalid(snapshot("creative", [row(OWNER_ECHO_ID, "owner", []), row(BOT_MESSAGE_ID, "bot", [
    { message_object_id: BOT_IMAGE_ID, object_type: "image", model_type: "precision_v2" }
  ])]), "BOT_OBJECT_INVALID", "creative");
  invalid(snapshot("creative", [row(OWNER_ECHO_ID, "owner", []), row(BOT_MESSAGE_ID, "bot", [
    { message_object_id: BOT_IMAGE_ID, object_type: "text", model_type: "creative" }
  ])]), "BOT_OBJECT_INVALID", "creative");
  invalid(snapshot("creative", [
    row(OWNER_ECHO_ID, "owner", []),
    row(BOT_MESSAGE_ID, "bot", [{ message_object_id: BOT_IMAGE_ID, object_type: "image", model_type: "creative" }]),
    row("late-bot-message", "bot", [])
  ]), "MESSAGE_CARDINALITY_INVALID", "creative");
  invalid(snapshot("creative", [
    row(OWNER_ECHO_ID, "owner", []),
    row(BOT_MESSAGE_ID, "bot", [{ message_object_id: BOT_IMAGE_ID, object_type: "image", model_type: "creative" }]),
    row("late-other-message", "other", [])
  ]), "MESSAGE_CARDINALITY_INVALID", "creative");
});

test("rejects duplicate object IDs, invalid IDs, row/object shape limits, and proto/accessor traps", () => {
  invalid(snapshot("creative", [row(OWNER_ECHO_ID, "owner", []), row(BOT_MESSAGE_ID, "bot", [
    { message_object_id: BOT_IMAGE_ID, object_type: "image", model_type: "creative" },
    { message_object_id: BOT_IMAGE_ID, object_type: "image", model_type: "creative" }
  ])]), "DUPLICATE_OBJECT_ID");
  invalid(snapshot("creative", [row("bad/id", "owner", []), row(BOT_MESSAGE_ID, "bot", [])]), "MESSAGE_ID_INVALID");
  invalid(snapshot("creative", new Array(11).fill(row("row", "other", []))), "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID");
  invalid(snapshot("creative", [row(OWNER_ECHO_ID, "owner", new Array(65).fill({
    message_object_id: "obj", object_type: "text", model_type: null
  }))]), "ROW_OBJECTS_SHAPE_OR_LIMIT_INVALID");

  let getterCalls = 0;
  const accessor = snapshot("creative") as Record<string, unknown>;
  Object.defineProperty(accessor, "provider_chat_id", { enumerable: true, get() { getterCalls += 1; return PROVIDER_CHAT_ID; } });
  invalid(accessor, "SNAPSHOT_SHAPE_INVALID");
  invalid(new Proxy(snapshot("creative"), {}), "SNAPSHOT_SHAPE_INVALID");
  const symbolRow = { ...row(OWNER_ECHO_ID, "owner", []), [Symbol("hidden")]: true };
  invalid(snapshot("creative", [symbolRow, row(BOT_MESSAGE_ID, "bot", [])]), "ROW_SHAPE_INVALID");
  assert.equal(getterCalls, 0);
});

function nativePayload(variant: OwnerMagnificUpscaleVariant, overrides: Record<string, unknown> = {}) {
  return {
    messages: [
      {
        id: 20_001, chat_id: 7_654_321, author_id: 42,
        message_object: [
          { id: 30_011, message_id: 20_001, object_type: "image", model_type: null },
          { id: 30_012, message_id: 20_001, object_type: "text", model_type: variant }
        ]
      },
      {
        id: 20_002, chat_id: 7_654_321, author_id: -1,
        message_object: [{ id: 30_021, message_id: 20_002, object_type: "image", model_type: variant }]
      }
    ],
    pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false },
    ...overrides
  };
}

async function nativeSnapshot(payload: unknown, chatUuid = CHAT_UUID, echoId = "20001") {
  const calls: string[] = [];
  const client = new SyntxChatHttpClient({
    credentialBroker: { useCredential: (operation) => operation("synthetic-native-history-credential") },
    fetchImpl: (async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch
  });
  const result = await client.listMessageCandidates(chatUuid, echoId);
  return { result, calls };
}

test("native fakefetch history client derives owner role from exact echo plus positive source author_id", async () => {
  for (const variant of VARIANTS) {
    const { result, calls } = await nativeSnapshot(nativePayload(variant));
    assert.deepEqual(calls, [`https://api.syntx.ai/api/v1/chats/${CHAT_UUID}/messages?page=1&page_size=10`]);
    assert.equal(result.requested_chat_uuid, CHAT_UUID);
    assert.equal(result.provider_chat_id, PROVIDER_CHAT_ID);
    assert.equal("author_id" in result.messages[0]!, false);
    assert.deepEqual(correlate(result satisfies ChatMessageHistorySnapshot, variant, CHAT_UUID, "20001"), {
      kind: "READY", provider_chat_id: PROVIDER_CHAT_ID, bot_message_id: "20002", object_id: "30021"
    });
  }
  const rawNonBot = nativePayload("creative");
  (rawNonBot.messages[1] as { author_id: number }).author_id = 0;
  const { result } = await nativeSnapshot(rawNonBot);
  assert.equal(result.messages[1]!.author_role, "other");
  assert.deepEqual(correlate(result, "creative", CHAT_UUID, "20001"), {
    kind: "INVALID", reason: "BOT_CANDIDATE_CARDINALITY_INVALID"
  });
});

test("native producer rejects mixed provider chats before the pure correlator can select a late row", async () => {
  const payload = nativePayload("precision_v1");
  (payload.messages[1] as { chat_id: number }).chat_id = 7_654_322;
  await assert.rejects(() => nativeSnapshot(payload));
});

test("reason surface is closed and invalid outcomes carry no raw message data", () => {
  assert.equal(OWNER_MAGNIFIC_HISTORY_BINDING_REASONS.includes("BOT_OBJECT_INVALID"), true);
  const result = correlate(snapshot("precision_v2", [row(OWNER_ECHO_ID, "owner", []), row(BOT_MESSAGE_ID, "bot", [
    { message_object_id: BOT_IMAGE_ID, object_type: "image", model_type: "creative" }
  ])]), "precision_v2");
  assert.deepEqual(result, { kind: "INVALID", reason: "BOT_OBJECT_INVALID" });
  assert.equal(JSON.stringify(result).includes(BOT_MESSAGE_ID), false);
  assert.equal(JSON.stringify(result).includes(BOT_IMAGE_ID), false);
});
