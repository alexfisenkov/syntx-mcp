import assert from "node:assert/strict";
import test from "node:test";
import {
  correlateOwnerStandardImageHistoryBinding,
  type OwnerStandardImageHistoryBindingReason
} from "../src/application/owner-standard-image-history-binding.js";
import {
  OWNER_STANDARD_IMAGE_VARIANTS,
  getOwnerStandardImageSourceProfile,
  type OwnerStandardImageReferenceMediaKind,
  type OwnerStandardImageVariant
} from "../src/application/owner-standard-image-request-preparer.js";
import {
  DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
  loadSelectedDiscoveryCatalog
} from "../src/catalog/selected-discovery-catalog.js";

const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const VARIANT = "banana-2.1" as const;
const REQUESTED_CHAT = "chat_standard_001";
const PROVIDER_CHAT = "987654321";
const ECHO_ID = "owner_echo_001";
const RESULT_ID = "bot_result_001";
const PROFILE = getOwnerStandardImageSourceProfile(VARIANT, catalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);

function makeSnapshot(
  variant: OwnerStandardImageVariant,
  referenceKinds: readonly OwnerStandardImageReferenceMediaKind[] = [],
  overrides: Record<string, unknown> = {}
) {
  const references = referenceKinds.map((kind, index) => ({
    message_object_id: `owner_ref_${String(index + 1).padStart(2, "0")}`,
    object_type: kind,
    model_type: variant
  }));
  const ownerObjects = [...references, {
    message_object_id: "owner_prompt_01", object_type: "text", model_type: null
  }];
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
        objects: ownerObjects
      },
      {
        message_id: RESULT_ID,
        provider_chat_id: PROVIDER_CHAT,
        author_role: "bot",
        objects: [{ message_object_id: "bot_image_001", object_type: "image", model_type: variant }]
      }
    ],
    ...overrides
  };
}

function input(
  variant: OwnerStandardImageVariant = VARIANT,
  kinds: readonly OwnerStandardImageReferenceMediaKind[] = [],
  snapshot = makeSnapshot(variant, kinds)
) {
  const profile = getOwnerStandardImageSourceProfile(variant, catalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
  return {
    snapshot,
    requested_chat_uuid: REQUESTED_CHAT,
    owner_echo_message_id: ECHO_ID,
    variant,
    profile_id: profile.profile_id,
    profile_schema_hash: profile.profile_schema_hash,
    requested_reference_kinds: kinds
  };
}

function expectReason(value: unknown, status: "PENDING" | "INVALID", reason: OwnerStandardImageHistoryBindingReason) {
  const result = correlateOwnerStandardImageHistoryBinding(value);
  assert.deepEqual(result, { status, reason });
}

test("all ten exact model IDs bind one source-shaped bot image after the owner ACK", () => {
  assert.equal(OWNER_STANDARD_IMAGE_VARIANTS.length, 10);
  for (const variant of OWNER_STANDARD_IMAGE_VARIANTS) {
    const result = correlateOwnerStandardImageHistoryBinding(input(variant));
    assert.equal(result.status, "READY");
    if (result.status !== "READY") continue;
    assert.equal(result.chat_uuid, REQUESTED_CHAT);
    assert.equal(result.provider_chat_id, PROVIDER_CHAT);
    assert.equal(result.owner_echo_message_id, ECHO_ID);
    assert.equal(result.result_message_id, RESULT_ID);
    assert.equal(result.variant, variant);
    assert.equal(result.model_id, variant);
    assert.equal(result.model_type, variant);
    assert.equal(result.ai_name, variant.startsWith("banana") ? "banana" : "sora-images");
    assert.equal(result.output_count, 1);
    assert.deepEqual(result.message_object_ids, ["bot_image_001"]);
    assert.equal(result.namespace_confidence, "SOURCE_SHAPED_UNVERIFIED");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.message_object_ids));
  }
});

test("Banana 2.1 binds 34 ordered mixed references plus exactly one text echo", () => {
  const kinds = Array.from({ length: 34 }, (_, index) =>
    index < 14 ? "image" : index < 24 ? "video" : "file") as OwnerStandardImageReferenceMediaKind[];
  const snapshot = makeSnapshot(VARIANT, kinds);
  const result = correlateOwnerStandardImageHistoryBinding(input(VARIANT, kinds, snapshot));
  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.deepEqual(result.requested_reference_kinds, kinds);
  assert.equal(result.message_object_ids.length, 1);
  assert.equal(result.output_count, 1);
});

test("GPT and non-Banana 2.1 variants reject video and file references", () => {
  for (const variant of ["banana", "gpt-image-2", "gpt-image-2.5-flare"] as const) {
    for (const kind of ["video", "file"] as const) {
      const profile = getOwnerStandardImageSourceProfile(variant, catalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
      const value = { ...input(variant, [kind]), profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash };
      expectReason(value, "INVALID", "INVALID_INPUT");
    }
  }
});

test("missing ACK or bot is pending; bot before ACK, duplicate objects, and extra message rows are invalid", () => {
  const noOwner = makeSnapshot(VARIANT);
  noOwner.messages[0] = { ...noOwner.messages[0]!, message_id: "unrelated_message", author_role: "other" };
  expectReason(input(VARIANT, [], noOwner), "PENDING", "OWNER_ACK_NOT_FOUND");

  const noBot = makeSnapshot(VARIANT);
  noBot.messages.pop();
  noBot.total_count = 1;
  noBot.total_pages = 1;
  expectReason(input(VARIANT, [], noBot), "PENDING", "BOT_MESSAGE_NOT_FOUND");

  const botFirst = makeSnapshot(VARIANT);
  botFirst.messages.reverse();
  expectReason(input(VARIANT, [], botFirst), "INVALID", "BOT_MESSAGE_BEFORE_ACK");

  const duplicateObject = makeSnapshot(VARIANT);
  duplicateObject.messages[1]!.objects[0]!.message_object_id = "owner_prompt_01";
  expectReason(input(VARIANT, [], duplicateObject), "INVALID", "OBJECT_ID_DUPLICATE");

  const extraRow = makeSnapshot(VARIANT);
  extraRow.total_count = 3;
  extraRow.messages.push({ message_id: "other_message", provider_chat_id: PROVIDER_CHAT, author_role: "other", objects: [] });
  expectReason(input(VARIANT, [], extraRow), "INVALID", "HISTORY_MESSAGE_SET_INVALID");
});

test("wrong scope/provider chat/ACK/model and malformed history do not bind", () => {
  const wrongScope = makeSnapshot(VARIANT, [], { requested_chat_uuid: "other_chat" });
  expectReason(input(VARIANT, [], wrongScope), "INVALID", "CHAT_SCOPE_MISMATCH");

  const wrongProviderChat = makeSnapshot(VARIANT);
  wrongProviderChat.messages[1]!.provider_chat_id = "different";
  expectReason(input(VARIANT, [], wrongProviderChat), "INVALID", "MESSAGE_CHAT_MISMATCH");

  expectReason({ ...input(), owner_echo_message_id: "not_the_echo" }, "INVALID", "OWNER_ACK_MISMATCH");

  const wrongBotModel = makeSnapshot(VARIANT);
  wrongBotModel.messages[1]!.objects[0]!.model_type = "banana";
  expectReason(input(VARIANT, [], wrongBotModel), "INVALID", "BOT_MODEL_MISMATCH");

  expectReason({ ...input(), profile_schema_hash: "not-a-hash" }, "INVALID", "INVALID_INPUT");
  expectReason({ ...input(), profile_schema_hash: `sha256:${"0".repeat(64)}` }, "INVALID", "INVALID_INPUT");
  expectReason({ ...input(), variant: "banana-alias" }, "INVALID", "INVALID_INPUT");
  expectReason({ ...input(), snapshot: { ...makeSnapshot(VARIANT), complete: false } }, "PENDING", "HISTORY_INCOMPLETE");
});

test("source-shaped owner attachment order must match the requested reference kinds", () => {
  const snapshot = makeSnapshot(VARIANT, ["image", "video"]);
  const ownerObjects = snapshot.messages[0]!.objects;
  ownerObjects[0]!.object_type = "video";
  ownerObjects[1]!.object_type = "image";
  expectReason(input(VARIANT, ["image", "video"], snapshot), "INVALID", "OWNER_OBJECTS_INVALID");
  expectReason(input(VARIANT, ["image", "file"], makeSnapshot(VARIANT, ["image", "video"])),
    "INVALID", "OWNER_OBJECTS_INVALID");
});

test("non-array IDs, accessors, proxies and unknown source fields reject without getter calls", () => {
  let getterCalls = 0;
  const base = input();
  const accessor = { ...base };
  Object.defineProperty(accessor, "profile_id", { enumerable: true, get() { getterCalls += 1; return PROFILE.profile_id; } });
  expectReason(accessor, "INVALID", "INVALID_INPUT");
  const proxy = new Proxy(base, { getPrototypeOf() { getterCalls += 1; throw new Error("trap"); } });
  expectReason(proxy, "INVALID", "INVALID_INPUT");
  assert.equal(getterCalls, 0);
  expectReason({ ...base, unexpected: true }, "INVALID", "INVALID_INPUT");
  expectReason({ ...base, requested_reference_kinds: Array(1) }, "INVALID", "INVALID_INPUT");
});
