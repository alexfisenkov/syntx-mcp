import { types } from "node:util";
import type { ChatMessageHistorySnapshot } from "../adapter/syntx/chat-http-client.js";
import {
  DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
  loadSelectedDiscoveryCatalog
} from "../catalog/selected-discovery-catalog.js";
import { getOwnerRunwayImageSourceProfile } from "./owner-runway-image-source-profile.js";
import { getOwnerRunwayImageSourceParameters } from "./owner-runway-image-parameters.js";

const INPUT_KEYS = Object.freeze([
  "snapshot", "requested_chat_uuid", "owner_echo_message_id", "variant", "requested_reference_count", "requested_output_count"
] as const);
const SNAPSHOT_KEYS = Object.freeze([
  "complete", "page", "page_size", "total_count", "total_pages", "has_next", "has_previous",
  "requested_chat_uuid", "provider_chat_id", "messages"
] as const);
const MESSAGE_KEYS = Object.freeze(["message_id", "provider_chat_id", "author_role", "objects"] as const);
const OBJECT_KEYS = Object.freeze(["message_object_id", "object_type", "model_type"] as const);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const MAX_HISTORY_MESSAGES = 10;
const MAX_OBJECTS_PER_MESSAGE = 64;
const SELECTED_CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;

export interface CorrelateOwnerRunwayImageHistoryBindingInput {
  readonly snapshot: ChatMessageHistorySnapshot | unknown;
  readonly requested_chat_uuid: string;
  readonly owner_echo_message_id: string;
  readonly variant: "runway_frames";
  readonly requested_reference_count: number;
  readonly requested_output_count: 1;
}

export type OwnerRunwayImageHistoryBindingReason =
  | "INVALID_INPUT" | "HISTORY_INCOMPLETE" | "HISTORY_SHAPE_INVALID" | "HISTORY_PAGE_INVALID"
  | "CHAT_SCOPE_MISMATCH" | "PROVIDER_CHAT_INVALID" | "HISTORY_EMPTY" | "HISTORY_MESSAGE_SET_INVALID"
  | "MESSAGE_ID_INVALID" | "MESSAGE_ID_DUPLICATE" | "MESSAGE_CHAT_MISMATCH"
  | "OBJECT_ID_INVALID" | "OBJECT_ID_DUPLICATE" | "OWNER_ACK_NOT_FOUND" | "OWNER_ACK_MISMATCH"
  | "OWNER_ACK_AMBIGUOUS" | "OWNER_OBJECTS_INVALID" | "BOT_MESSAGE_NOT_FOUND" | "BOT_MESSAGE_AMBIGUOUS"
  | "BOT_MESSAGE_BEFORE_ACK" | "BOT_OBJECTS_INVALID" | "BOT_MODEL_MISMATCH";

export type OwnerRunwayImageHistoryBinding =
  | Readonly<{
      status: "READY";
      chat_uuid: string;
      provider_chat_id: string;
      owner_echo_message_id: string;
      result_message_id: string;
      variant: "runway_frames";
      model_id: "runway_frames";
      ai_name: "runway-frames";
      model_type: "runway_frames";
      operation_id: "generate-image";
      profile_id: string;
      profile_schema_hash: string;
      requested_reference_kinds: readonly "image"[];
      message_object_ids: readonly [string];
      namespace_confidence: "SOURCE_SHAPED_UNVERIFIED";
      backend_acceptance: "UNPROVEN";
      output_count: 1;
    }>
  | Readonly<{ status: "PENDING"; reason: OwnerRunwayImageHistoryBindingReason }>
  | Readonly<{ status: "INVALID"; reason: OwnerRunwayImageHistoryBindingReason }>;

interface NormalizedMessage {
  readonly message_id: string;
  readonly provider_chat_id: string;
  readonly author_role: "owner" | "bot" | "other";
  readonly objects: readonly Readonly<{ message_object_id: string; object_type: string; model_type: string | null }>[];
}

/** Binds one source-shaped Runway owner echo and exact bot result from a complete page. */
export function correlateOwnerRunwayImageHistoryBinding(
  input: CorrelateOwnerRunwayImageHistoryBindingInput | unknown
): OwnerRunwayImageHistoryBinding {
  let request: Record<string, unknown>;
  try { request = readRecord(input, INPUT_KEYS); }
  catch { return invalid("INVALID_INPUT"); }
  const sourceParameters = getOwnerRunwayImageSourceParameters();
  const profile = (() => {
    try { return getOwnerRunwayImageSourceProfile("runway_frames", SELECTED_CATALOG, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION); }
    catch { return null; }
  })();
  if (!profile || request.variant !== "runway_frames" || typeof request.requested_chat_uuid !== "string" ||
      !SAFE_IDENTIFIER.test(request.requested_chat_uuid) || typeof request.owner_echo_message_id !== "string" ||
      !SAFE_IDENTIFIER.test(request.owner_echo_message_id) || !Number.isSafeInteger(request.requested_reference_count) ||
      (request.requested_reference_count as number) < sourceParameters.reference_limits.minimum ||
      (request.requested_reference_count as number) > sourceParameters.reference_limits.maximum || request.requested_output_count !== 1) {
    return invalid("INVALID_INPUT");
  }

  let snapshot: Record<string, unknown>;
  try { snapshot = readRecord(request.snapshot, SNAPSHOT_KEYS); }
  catch { return invalid("HISTORY_SHAPE_INVALID"); }
  if (snapshot.complete !== true) return pending("HISTORY_INCOMPLETE");
  let messages: Record<string, unknown>[];
  try { messages = readArray(snapshot.messages, MAX_HISTORY_MESSAGES).map((entry) => readRecord(entry, MESSAGE_KEYS)); }
  catch { return invalid("HISTORY_SHAPE_INVALID"); }
  if (snapshot.page !== 1 || snapshot.page_size !== 10 || snapshot.total_pages !== 1 || snapshot.has_next !== false ||
      snapshot.has_previous !== false || !Number.isSafeInteger(snapshot.total_count) || snapshot.total_count !== messages.length) {
    return invalid("HISTORY_PAGE_INVALID");
  }
  if (snapshot.requested_chat_uuid !== request.requested_chat_uuid) return invalid("CHAT_SCOPE_MISMATCH");
  if (typeof snapshot.provider_chat_id !== "string" || !SAFE_PROVIDER_CHAT_ID.test(snapshot.provider_chat_id) ||
      !Number.isSafeInteger(Number(snapshot.provider_chat_id))) return invalid("PROVIDER_CHAT_INVALID");
  if (messages.length === 0) return pending("HISTORY_EMPTY");

  const normalized: NormalizedMessage[] = [];
  const messageIds = new Set<string>();
  const objectIds = new Set<string>();
  for (const message of messages) {
    if (typeof message.message_id !== "string" || !SAFE_IDENTIFIER.test(message.message_id)) return invalid("MESSAGE_ID_INVALID");
    if (messageIds.has(message.message_id)) return invalid("MESSAGE_ID_DUPLICATE");
    messageIds.add(message.message_id);
    if (message.provider_chat_id !== snapshot.provider_chat_id) return invalid("MESSAGE_CHAT_MISMATCH");
    if (message.author_role !== "owner" && message.author_role !== "bot" && message.author_role !== "other") return invalid("HISTORY_SHAPE_INVALID");
    let objects: Record<string, unknown>[];
    try { objects = readArray(message.objects, MAX_OBJECTS_PER_MESSAGE).map((entry) => readRecord(entry, OBJECT_KEYS)); }
    catch { return invalid("HISTORY_SHAPE_INVALID"); }
    const safeObjects: Array<{ message_object_id: string; object_type: string; model_type: string | null }> = [];
    for (const object of objects) {
      if (typeof object.message_object_id !== "string" || !SAFE_IDENTIFIER.test(object.message_object_id)) return invalid("OBJECT_ID_INVALID");
      if (objectIds.has(object.message_object_id)) return invalid("OBJECT_ID_DUPLICATE");
      objectIds.add(object.message_object_id);
      if (typeof object.object_type !== "string" || !(object.model_type === null || typeof object.model_type === "string")) return invalid("HISTORY_SHAPE_INVALID");
      safeObjects.push({ message_object_id: object.message_object_id, object_type: object.object_type, model_type: object.model_type as string | null });
    }
    normalized.push(Object.freeze({ message_id: message.message_id, provider_chat_id: message.provider_chat_id as string,
      author_role: message.author_role, objects: Object.freeze(safeObjects.map((object) => Object.freeze(object))) }));
  }

  const owners = normalized.filter((message) => message.author_role === "owner");
  const ack = normalized.find((message) => message.message_id === request.owner_echo_message_id);
  if (ack && ack.author_role !== "owner") return invalid("OWNER_ACK_MISMATCH");
  if (owners.length === 0) return pending("OWNER_ACK_NOT_FOUND");
  if (owners.length !== 1) return invalid("OWNER_ACK_AMBIGUOUS");
  const owner = owners[0]!;
  if (owner.message_id !== request.owner_echo_message_id) return invalid("OWNER_ACK_MISMATCH");
  const bots = normalized.filter((message) => message.author_role === "bot");
  if (bots.length === 0) return pending("BOT_MESSAGE_NOT_FOUND");
  if (bots.length !== 1) return invalid("BOT_MESSAGE_AMBIGUOUS");
  const bot = bots[0]!;
  if (normalized.indexOf(bot) < normalized.indexOf(owner)) return invalid("BOT_MESSAGE_BEFORE_ACK");
  if (normalized.length !== 2 || normalized[0] !== owner || normalized[1] !== bot) return invalid("HISTORY_MESSAGE_SET_INVALID");

  if (!hasExpectedOwnerObjects(owner.objects, request.requested_reference_count as number)) return invalid("OWNER_OBJECTS_INVALID");
  if (bot.objects.length === 0) return pending("BOT_MESSAGE_NOT_FOUND");
  if (bot.objects.length !== 1) return invalid("BOT_OBJECTS_INVALID");
  const result = bot.objects[0]!;
  if (result.object_type !== "image") return invalid("BOT_OBJECTS_INVALID");
  if (result.model_type !== "runway_frames") return invalid("BOT_MODEL_MISMATCH");

  return Object.freeze({
    status: "READY", chat_uuid: request.requested_chat_uuid as string, provider_chat_id: snapshot.provider_chat_id as string,
    owner_echo_message_id: request.owner_echo_message_id as string, result_message_id: bot.message_id,
    variant: "runway_frames", model_id: "runway_frames", ai_name: "runway-frames", model_type: "runway_frames",
    operation_id: "generate-image", profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash,
    requested_reference_kinds: Object.freeze(Array.from({ length: request.requested_reference_count as number }, () => "image" as const)),
    message_object_ids: Object.freeze([result.message_object_id]) as readonly [string],
    namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN", output_count: 1
  });
}

function hasExpectedOwnerObjects(objects: readonly NormalizedMessage["objects"][number][], count: number): boolean {
  if (objects.length !== count + 1) return false;
  for (let index = 0; index < count; index += 1) {
    const object = objects[index]!;
    if (object.object_type !== "image" || !(object.model_type === null || object.model_type === "runway_frames")) return false;
  }
  const text = objects[count]!;
  return text.object_type === "text" && (text.model_type === null || text.model_type === "runway_frames");
}

function readRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== allowedKeys.length || keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) throw new TypeError();
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) record[key] = descriptors[key]!.value;
  return record;
}

function readArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) throw new TypeError();
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]!.value);
}

function pending(reason: OwnerRunwayImageHistoryBindingReason): OwnerRunwayImageHistoryBinding {
  return Object.freeze({ status: "PENDING", reason });
}
function invalid(reason: OwnerRunwayImageHistoryBindingReason): OwnerRunwayImageHistoryBinding {
  return Object.freeze({ status: "INVALID", reason });
}
