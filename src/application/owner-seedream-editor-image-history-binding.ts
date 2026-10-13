import { types } from "node:util";
import type { ChatMessageHistorySnapshot } from "../adapter/syntx/chat-http-client.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";

const INPUT_KEYS = Object.freeze(["snapshot", "requested_chat_uuid", "owner_echo_message_id", "variant"] as const);
const SNAPSHOT_KEYS = Object.freeze(["complete", "page", "page_size", "total_count", "total_pages", "has_next", "has_previous",
  "requested_chat_uuid", "provider_chat_id", "messages"] as const);
const MESSAGE_KEYS = Object.freeze(["message_id", "provider_chat_id", "author_role", "objects"] as const);
const OBJECT_KEYS = Object.freeze(["message_object_id", "object_type", "model_type"] as const);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const MAX_HISTORY_MESSAGES = 64;
const MAX_OBJECTS_PER_MESSAGE = 64;

export interface CorrelateOwnerSeedreamEditorImageHistoryBindingInput {
  readonly snapshot: ChatMessageHistorySnapshot | unknown;
  readonly requested_chat_uuid: string;
  readonly owner_echo_message_id: string;
  readonly variant: OwnerSeedreamImageVariant;
}

export type OwnerSeedreamEditorImageHistoryBindingReason = "INVALID_INPUT" | "HISTORY_INCOMPLETE" | "HISTORY_SHAPE_INVALID" |
  "HISTORY_LOCAL_LIMIT" | "HISTORY_PAGE_INVALID" | "CHAT_SCOPE_MISMATCH" | "PROVIDER_CHAT_INVALID" | "HISTORY_EMPTY" | "MESSAGE_ID_INVALID" |
  "MESSAGE_ID_DUPLICATE" | "MESSAGE_CHAT_MISMATCH" | "OBJECT_ID_INVALID" | "OBJECT_ID_DUPLICATE" |
  "OWNER_ACK_NOT_FOUND" | "OWNER_ACK_MISMATCH" | "OWNER_ACK_AMBIGUOUS" | "BOT_MESSAGE_NOT_FOUND" |
  "BOT_MODEL_MISMATCH";

export interface OwnerSeedreamEditorObservedObject {
  readonly message_id: string;
  readonly message_object_id: string;
  readonly object_type: "image" | "image_url";
  readonly model_echo: "MATCHED" | "UNKNOWN";
}
export interface OwnerSeedreamEditorHistoryGap {
  readonly message_id: string | null;
  readonly object_index: number | null;
  readonly code: "UNRECOGNIZED_SNAPSHOT_FIELDS" | "UNRECOGNIZED_MESSAGE_FIELDS" | "UNRECOGNIZED_OBJECT_FIELDS" | "MODEL_TYPE_UNAVAILABLE";
}
export type OwnerSeedreamEditorImageHistoryBinding =
  | Readonly<{ status: "BOUND"; chat_uuid: string; provider_chat_id: string; owner_echo_message_id: string;
      variant: OwnerSeedreamImageVariant; candidate_message_ids: readonly string[];
      observed_objects: readonly Readonly<OwnerSeedreamEditorObservedObject>[]; gaps: readonly Readonly<OwnerSeedreamEditorHistoryGap>[];
      model_echo: "MATCHED" | "UNKNOWN"; namespace_confidence: "SOURCE_SHAPED_UNVERIFIED"; backend_acceptance: "UNPROVEN" }>
  | Readonly<{ status: "PENDING"; reason: OwnerSeedreamEditorImageHistoryBindingReason }>
  | Readonly<{ status: "INVALID"; reason: OwnerSeedreamEditorImageHistoryBindingReason }>;

interface DataRecord { readonly values: Readonly<Record<string, unknown>>; readonly unknownFieldCount: number }
interface NormalizedObject { readonly message_object_id: string; readonly object_type: string; readonly model_type: string | null; readonly unknown_field_count: number }
interface NormalizedMessage {
  readonly message_id: string; readonly provider_chat_id: string; readonly author_role: "owner" | "bot" | "other";
  readonly objects: readonly NormalizedObject[]; readonly unknown_field_count: number;
}

/**
 * Consumes a complete aggregate snapshot: page 1/page_size 10 metadata describes
 * the first server page, while messages contains every fetched page. A BOUND
 * observation is neither ownership authority nor generation permission.
 */
export function correlateOwnerSeedreamEditorImageHistoryBinding(
  input: CorrelateOwnerSeedreamEditorImageHistoryBindingInput | unknown
): OwnerSeedreamEditorImageHistoryBinding {
  const request = readRecord(input, INPUT_KEYS);
  if (!request || request.unknownFieldCount !== 0 || !isVariant(request.values.variant) ||
      !isSafeId(request.values.requested_chat_uuid) || !isSafeId(request.values.owner_echo_message_id)) return invalid("INVALID_INPUT");
  const snapshot = readRecord(request.values.snapshot, SNAPSHOT_KEYS);
  if (!snapshot) return invalid("HISTORY_SHAPE_INVALID");
  if (snapshot.values.complete !== true || snapshot.values.has_next !== false) return pending("HISTORY_INCOMPLETE");
  if (!isSafeId(snapshot.values.requested_chat_uuid ?? request.values.requested_chat_uuid) ||
      (snapshot.values.requested_chat_uuid !== undefined && snapshot.values.requested_chat_uuid !== request.values.requested_chat_uuid)) {
    return invalid("CHAT_SCOPE_MISMATCH");
  }
  if (!isProviderChatId(snapshot.values.provider_chat_id)) return invalid("PROVIDER_CHAT_INVALID");
  const rawMessages = readArray(snapshot.values.messages, MAX_HISTORY_MESSAGES);
  if (!rawMessages) return invalid(!types.isProxy(snapshot.values.messages) && Array.isArray(snapshot.values.messages) &&
    snapshot.values.messages.length > MAX_HISTORY_MESSAGES ? "HISTORY_LOCAL_LIMIT" : "HISTORY_SHAPE_INVALID");
  if (!Number.isSafeInteger(snapshot.values.page) || snapshot.values.page !== 1 ||
      !Number.isSafeInteger(snapshot.values.page_size) || snapshot.values.page_size !== 10 ||
      !Number.isSafeInteger(snapshot.values.total_count) || snapshot.values.total_count !== rawMessages.length ||
      !Number.isSafeInteger(snapshot.values.total_pages) || snapshot.values.total_pages !== (rawMessages.length === 0 ? 0 : Math.ceil(rawMessages.length / 10)) ||
      snapshot.values.has_previous !== false || snapshot.values.has_next !== false) return invalid("HISTORY_PAGE_INVALID");
  if (rawMessages.length === 0) return pending("HISTORY_EMPTY");

  const normalized: NormalizedMessage[] = [];
  const messageIds = new Set<string>();
  const objectIds = new Set<string>();
  for (const rawMessage of rawMessages) {
    const message = readRecord(rawMessage, MESSAGE_KEYS);
    if (!message || !isSafeId(message.values.message_id)) return invalid("HISTORY_SHAPE_INVALID");
    const messageId = message.values.message_id;
    if (messageIds.has(messageId)) return invalid("MESSAGE_ID_DUPLICATE");
    messageIds.add(messageId);
    if (message.values.provider_chat_id !== snapshot.values.provider_chat_id) return invalid("MESSAGE_CHAT_MISMATCH");
    if (message.values.author_role !== "owner" && message.values.author_role !== "bot" && message.values.author_role !== "other") {
      return invalid("HISTORY_SHAPE_INVALID");
    }
    const rawObjects = readArray(message.values.objects, MAX_OBJECTS_PER_MESSAGE);
    if (!rawObjects) return invalid(isOverLimitArray(message.values.objects, MAX_OBJECTS_PER_MESSAGE) ? "HISTORY_LOCAL_LIMIT" : "HISTORY_SHAPE_INVALID");
    const objects: NormalizedObject[] = [];
    for (const rawObject of rawObjects) {
      const object = readRecord(rawObject, OBJECT_KEYS);
      if (!object || !isSafeId(object.values.message_object_id) || typeof object.values.object_type !== "string" ||
          !(object.values.model_type === undefined || object.values.model_type === null || typeof object.values.model_type === "string")) {
        return invalid("HISTORY_SHAPE_INVALID");
      }
      if (objectIds.has(object.values.message_object_id)) return invalid("OBJECT_ID_DUPLICATE");
      objectIds.add(object.values.message_object_id);
      objects.push(Object.freeze({ message_object_id: object.values.message_object_id, object_type: object.values.object_type,
        model_type: typeof object.values.model_type === "string" ? object.values.model_type : null,
        unknown_field_count: object.unknownFieldCount }));
    }
    normalized.push(Object.freeze({ message_id: messageId, provider_chat_id: message.values.provider_chat_id as string,
      author_role: message.values.author_role, objects: Object.freeze(objects), unknown_field_count: message.unknownFieldCount }));
  }

  const owners = normalized.filter((message) => message.author_role === "owner");
  if (owners.length === 0) return pending("OWNER_ACK_NOT_FOUND");
  if (owners.length > 1) return invalid("OWNER_ACK_AMBIGUOUS");
  const ack = owners[0]!;
  if (ack.message_id !== request.values.owner_echo_message_id) return invalid("OWNER_ACK_MISMATCH");
  const ackIndex = normalized.indexOf(ack);
  const bots = normalized.slice(ackIndex + 1).filter((message) => message.author_role === "bot");
  if (bots.length === 0) return pending("BOT_MESSAGE_NOT_FOUND");

  const observed: OwnerSeedreamEditorObservedObject[] = [];
  const gaps: OwnerSeedreamEditorHistoryGap[] = [];
  if (snapshot.unknownFieldCount > 0) gaps.push(gap(null, null, "UNRECOGNIZED_SNAPSHOT_FIELDS"));
  for (const message of normalized) {
    if (message.unknown_field_count > 0) gaps.push(gap(message.message_id, null, "UNRECOGNIZED_MESSAGE_FIELDS"));
    for (let index = 0; index < message.objects.length; index += 1) {
      if (message.objects[index]!.unknown_field_count > 0) gaps.push(gap(message.message_id, index, "UNRECOGNIZED_OBJECT_FIELDS"));
    }
  }
  let modelEcho: "MATCHED" | "UNKNOWN" = "MATCHED";
  for (const bot of bots) {
    for (let index = 0; index < bot.objects.length; index += 1) {
      const object = bot.objects[index]!;
      if (object.object_type !== "image" && object.object_type !== "image_url") continue;
      if (object.model_type !== null && object.model_type !== request.values.variant) return invalid("BOT_MODEL_MISMATCH");
      const echo = object.model_type === null ? "UNKNOWN" : "MATCHED";
      if (echo === "UNKNOWN") {
        modelEcho = "UNKNOWN";
        gaps.push(gap(bot.message_id, index, "MODEL_TYPE_UNAVAILABLE"));
      }
      observed.push(Object.freeze({ message_id: bot.message_id, message_object_id: object.message_object_id,
        object_type: object.object_type, model_echo: echo }));
    }
  }
  return Object.freeze({ status: "BOUND", chat_uuid: request.values.requested_chat_uuid as string,
    provider_chat_id: snapshot.values.provider_chat_id as string, owner_echo_message_id: ack.message_id,
    variant: request.values.variant, candidate_message_ids: Object.freeze(bots.map((message) => message.message_id)),
    observed_objects: Object.freeze(observed), gaps: Object.freeze(gaps), model_echo: modelEcho,
    namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN" });
}

function readRecord(value: unknown, knownKeys: readonly string[]): DataRecord | null {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let unknownFieldCount = 0;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") { unknownFieldCount += 1; continue; }
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || !descriptor.enumerable) return null;
    if (knownKeys.includes(key)) values[key] = descriptor.value;
    else unknownFieldCount += 1;
  }
  return Object.freeze({ values: Object.freeze(values), unknownFieldCount });
}
function readArray(value: unknown, maximum: number): readonly unknown[] | null {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) return null;
  const values: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    values.push(descriptor.value);
  }
  return Object.freeze(values);
}
function isOverLimitArray(value: unknown, maximum: number): boolean {
  return !types.isProxy(value) && Array.isArray(value) && value.length > maximum;
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isProviderChatId(value: unknown): value is string { return typeof value === "string" && SAFE_PROVIDER_CHAT_ID.test(value); }
function isVariant(value: unknown): value is OwnerSeedreamImageVariant {
  return typeof value === "string" && (OWNER_SEEDREAM_IMAGE_VARIANTS as readonly string[]).includes(value);
}
function gap(messageId: string | null, objectIndex: number | null,
  code: OwnerSeedreamEditorHistoryGap["code"]): OwnerSeedreamEditorHistoryGap {
  return Object.freeze({ message_id: messageId, object_index: objectIndex, code });
}
function pending(reason: OwnerSeedreamEditorImageHistoryBindingReason): OwnerSeedreamEditorImageHistoryBinding {
  return Object.freeze({ status: "PENDING", reason });
}
function invalid(reason: OwnerSeedreamEditorImageHistoryBindingReason): OwnerSeedreamEditorImageHistoryBinding {
  return Object.freeze({ status: "INVALID", reason });
}
