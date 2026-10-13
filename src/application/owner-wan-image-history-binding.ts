import { types } from "node:util";
import type { ChatMessageHistorySnapshot } from "../adapter/syntx/chat-http-client.js";
import { getOwnerWanImageSourceParameters, type OwnerWanImageVariant } from "./owner-wan-image-parameters.js";

const VARIANTS = Object.freeze([
  "wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"
] as const);
const HISTORY_KEYS = Object.freeze([
  "complete", "page", "page_size", "total_count", "total_pages", "has_next", "has_previous",
  "requested_chat_uuid", "provider_chat_id", "messages"
] as const);
const MESSAGE_KEYS = Object.freeze(["message_id", "provider_chat_id", "author_role", "objects"] as const);
const OBJECT_KEYS = Object.freeze(["message_object_id", "object_type", "model_type"] as const);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;

export interface CorrelateOwnerWanImageHistoryBindingInput {
  readonly snapshot: ChatMessageHistorySnapshot | unknown;
  readonly requested_chat_uuid: string;
  readonly owner_echo_message_id: string;
  readonly scope: "image";
  readonly variant: OwnerWanImageVariant;
  readonly requested_reference_count: number;
  readonly requested_batch_size: number;
}

export type OwnerWanImageHistoryBindingReason =
  | "INVALID_INPUT"
  | "HISTORY_INCOMPLETE"
  | "HISTORY_SHAPE_INVALID"
  | "HISTORY_PAGE_INVALID"
  | "CHAT_SCOPE_MISMATCH"
  | "PROVIDER_CHAT_INVALID"
  | "HISTORY_EMPTY"
  | "HISTORY_MESSAGE_SET_INVALID"
  | "MESSAGE_ID_INVALID"
  | "MESSAGE_ID_DUPLICATE"
  | "MESSAGE_CHAT_MISMATCH"
  | "OBJECT_ID_INVALID"
  | "OBJECT_ID_DUPLICATE"
  | "OWNER_ACK_NOT_FOUND"
  | "OWNER_ACK_MISMATCH"
  | "OWNER_ACK_AMBIGUOUS"
  | "OWNER_OBJECTS_INVALID"
  | "BOT_MESSAGE_NOT_FOUND"
  | "BOT_MESSAGE_AMBIGUOUS"
  | "BOT_OBJECTS_INVALID"
  | "BOT_MODEL_MISMATCH"
  | "BOT_BATCH_EXCEEDS_REQUEST"
  | "BOT_BATCH_PENDING";

export type OwnerWanImageHistoryBinding =
  | Readonly<{
      status: "READY";
      chat_uuid: string;
      provider_chat_id: string;
      message_id: string;
      variant: OwnerWanImageVariant;
      requested_batch_size: number;
      requested_reference_count: number;
      message_object_ids: readonly string[];
    }>
  | Readonly<{ status: "PENDING"; reason: OwnerWanImageHistoryBindingReason }>
  | Readonly<{ status: "INVALID"; reason: OwnerWanImageHistoryBindingReason }>;

/** Correlates only a complete, exact owner-ACK/bot pair from the normalized image-history seam. */
export function correlateOwnerWanImageHistoryBinding(
  input: CorrelateOwnerWanImageHistoryBindingInput | unknown
): OwnerWanImageHistoryBinding {
  let request: Record<string, unknown>;
  try {
    request = readRecord(input, [
      "snapshot", "requested_chat_uuid", "owner_echo_message_id", "scope", "variant",
      "requested_reference_count", "requested_batch_size"
    ]);
  } catch {
    return invalid("INVALID_INPUT");
  }

  if (request.scope !== "image" || typeof request.requested_chat_uuid !== "string" ||
      !SAFE_IDENTIFIER.test(request.requested_chat_uuid) || typeof request.owner_echo_message_id !== "string" ||
      !SAFE_IDENTIFIER.test(request.owner_echo_message_id) || !isVariant(request.variant) ||
      !isValidReferenceCount(request.variant, request.requested_reference_count) ||
      !Number.isSafeInteger(request.requested_batch_size) || (request.requested_batch_size as number) < 1 ||
      (request.requested_batch_size as number) > 4) return invalid("INVALID_INPUT");

  let snapshot: Record<string, unknown>;
  try {
    snapshot = readRecord(request.snapshot, HISTORY_KEYS, false);
  } catch {
    return invalid("HISTORY_SHAPE_INVALID");
  }
  if (snapshot.complete !== true) return pending("HISTORY_INCOMPLETE");
  try {
    snapshot = readRecord(request.snapshot, HISTORY_KEYS);
  } catch {
    return invalid("HISTORY_SHAPE_INVALID");
  }
  let rawMessages: unknown[];
  try {
    rawMessages = readArray(snapshot.messages, 10);
  } catch {
    return invalid("HISTORY_SHAPE_INVALID");
  }
  if (snapshot.page !== 1 || snapshot.page_size !== 10 || snapshot.total_pages !== 1 ||
      snapshot.has_next !== false || snapshot.has_previous !== false ||
      !Number.isSafeInteger(snapshot.total_count) || snapshot.total_count !== rawMessages.length) {
    return invalid("HISTORY_PAGE_INVALID");
  }
  if (snapshot.requested_chat_uuid !== request.requested_chat_uuid) return invalid("CHAT_SCOPE_MISMATCH");
  if (typeof snapshot.provider_chat_id !== "string" || !SAFE_PROVIDER_CHAT_ID.test(snapshot.provider_chat_id) ||
      !Number.isSafeInteger(Number(snapshot.provider_chat_id))) return invalid("PROVIDER_CHAT_INVALID");

  let messages: Record<string, unknown>[];
  try {
    messages = rawMessages.map((message) => readRecord(message, MESSAGE_KEYS));
  } catch {
    return invalid("HISTORY_SHAPE_INVALID");
  }
  if (messages.length === 0) return pending("HISTORY_EMPTY");
  const messageIds = new Set<string>();
  const objectIds = new Set<string>();
  const normalized: Array<{ message_id: string; author_role: string; objects: Array<Record<string, unknown>> }> = [];
  for (const message of messages) {
    if (typeof message.message_id !== "string" || !SAFE_IDENTIFIER.test(message.message_id)) return invalid("MESSAGE_ID_INVALID");
    if (messageIds.has(message.message_id)) return invalid("MESSAGE_ID_DUPLICATE");
    messageIds.add(message.message_id);
    if (message.provider_chat_id !== snapshot.provider_chat_id) return invalid("MESSAGE_CHAT_MISMATCH");
    if (message.author_role !== "owner" && message.author_role !== "bot" && message.author_role !== "other") {
      return invalid("HISTORY_SHAPE_INVALID");
    }
    let objects: Record<string, unknown>[];
    try {
      objects = readArray(message.objects, 64).map((object) => readRecord(object, OBJECT_KEYS));
    } catch {
      return invalid("HISTORY_SHAPE_INVALID");
    }
    for (const object of objects) {
      if (typeof object.message_object_id !== "string" || !SAFE_IDENTIFIER.test(object.message_object_id)) {
        return invalid("OBJECT_ID_INVALID");
      }
      if (objectIds.has(object.message_object_id)) return invalid("OBJECT_ID_DUPLICATE");
      objectIds.add(object.message_object_id);
    }
    normalized.push({ message_id: message.message_id, author_role: message.author_role, objects });
  }

  const owners = normalized.filter((message) => message.author_role === "owner");
  const ackMessage = normalized.find((message) => message.message_id === request.owner_echo_message_id);
  if (ackMessage && ackMessage.author_role !== "owner") return invalid("OWNER_ACK_MISMATCH");
  if (owners.length === 0) return pending("OWNER_ACK_NOT_FOUND");
  if (owners.length !== 1) return invalid("OWNER_ACK_AMBIGUOUS");
  const owner = owners[0]!;
  if (owner.message_id !== request.owner_echo_message_id) return invalid("OWNER_ACK_MISMATCH");
  const bots = normalized.filter((message) => message.author_role === "bot");
  if (bots.length === 0) return pending("BOT_MESSAGE_NOT_FOUND");
  if (bots.length !== 1) return invalid("BOT_MESSAGE_AMBIGUOUS");
  const bot = bots[0]!;
  if (normalized.length !== 2 || normalized[0] !== owner || normalized[1] !== bot) {
    return invalid("HISTORY_MESSAGE_SET_INVALID");
  }

  if (!hasExpectedOwnerObjects(owner.objects, request.requested_reference_count as number, request.variant)) {
    return invalid("OWNER_OBJECTS_INVALID");
  }
  if (bot.objects.length > 4) return invalid("BOT_BATCH_EXCEEDS_REQUEST");
  for (const object of bot.objects) {
    if (object.object_type !== "image") return invalid("BOT_OBJECTS_INVALID");
    if (object.model_type !== request.variant) return invalid("BOT_MODEL_MISMATCH");
  }
  if (bot.objects.length > (request.requested_batch_size as number)) return invalid("BOT_BATCH_EXCEEDS_REQUEST");
  if (bot.objects.length !== request.requested_batch_size) return pending("BOT_BATCH_PENDING");

  return Object.freeze({
    status: "READY",
    chat_uuid: request.requested_chat_uuid,
    provider_chat_id: snapshot.provider_chat_id as string,
    message_id: bot.message_id,
    variant: request.variant,
    requested_batch_size: request.requested_batch_size as number,
    requested_reference_count: request.requested_reference_count as number,
    message_object_ids: Object.freeze(bot.objects.map((object) => object.message_object_id as string))
  });
}

function hasExpectedOwnerObjects(
  objects: readonly Record<string, unknown>[], referenceCount: number, variant: OwnerWanImageVariant
): boolean {
  if (objects.length > 10) return false;
  let imageCount = 0;
  let textCount = 0;
  let sawText = false;
  for (const object of objects) {
    if (object.object_type === "image" && !sawText && (object.model_type === null || object.model_type === variant)) imageCount += 1;
    else if (object.object_type === "text" && !sawText && textCount === 0 &&
        (object.model_type === null || object.model_type === variant)) {
      textCount += 1;
      sawText = true;
    } else return false;
  }
  return imageCount === referenceCount;
}

function isValidReferenceCount(variant: OwnerWanImageVariant, value: unknown): boolean {
  if (!Number.isSafeInteger(value)) return false;
  const limits = getOwnerWanImageSourceParameters().reference_limits[variant];
  return (value as number) >= limits.minimum && (value as number) <= limits.maximum;
}

function isVariant(value: unknown): value is OwnerWanImageVariant {
  return typeof value === "string" && VARIANTS.includes(value as OwnerWanImageVariant);
}

function readRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requireAll = true
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key) ||
      !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
      (requireAll && allowedKeys.some((key) => !Object.hasOwn(descriptors, key)))) throw new TypeError();
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) record[key] = descriptors[key]!.value;
  return record;
}

function readArray(value: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maxLength) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) throw new TypeError();
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError();
    result.push(descriptor.value);
  }
  return result;
}

function pending(reason: OwnerWanImageHistoryBindingReason): OwnerWanImageHistoryBinding {
  return Object.freeze({ status: "PENDING", reason });
}

function invalid(reason: OwnerWanImageHistoryBindingReason): OwnerWanImageHistoryBinding {
  return Object.freeze({ status: "INVALID", reason });
}
