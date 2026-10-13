import { types } from "node:util";
import type { ChatMessageHistorySnapshot } from "../adapter/syntx/chat-http-client.js";
import {
  DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
  loadSelectedDiscoveryCatalog
} from "../catalog/selected-discovery-catalog.js";
import {
  OWNER_STANDARD_IMAGE_VARIANTS,
  getOwnerStandardImageSourceProfile,
  type OwnerStandardImageReferenceMediaKind,
  type OwnerStandardImageVariant
} from "./owner-standard-image-request-preparer.js";

const INPUT_KEYS = Object.freeze([
  "snapshot", "requested_chat_uuid", "owner_echo_message_id", "variant", "profile_id",
  "profile_schema_hash", "requested_reference_kinds"
] as const);
const SNAPSHOT_KEYS = Object.freeze([
  "complete", "page", "page_size", "total_count", "total_pages", "has_next", "has_previous",
  "requested_chat_uuid", "provider_chat_id", "messages"
] as const);
const MESSAGE_KEYS = Object.freeze(["message_id", "provider_chat_id", "author_role", "objects"] as const);
const OBJECT_KEYS = Object.freeze(["message_object_id", "object_type", "model_type"] as const);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REFERENCE_KINDS = Object.freeze(["image", "video", "file"] as const);
const MAX_REFERENCES = 34;
const MAX_HISTORY_MESSAGES = 10;
const MAX_OBJECTS_PER_MESSAGE = 64;
const SELECTED_CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;

export interface CorrelateOwnerStandardImageHistoryBindingInput {
  readonly snapshot: ChatMessageHistorySnapshot | unknown;
  readonly requested_chat_uuid: string;
  readonly owner_echo_message_id: string;
  readonly variant: OwnerStandardImageVariant;
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly requested_reference_kinds: readonly OwnerStandardImageReferenceMediaKind[];
}

export type OwnerStandardImageHistoryBindingReason =
  | "INVALID_INPUT" | "HISTORY_INCOMPLETE" | "HISTORY_SHAPE_INVALID" | "HISTORY_PAGE_INVALID"
  | "CHAT_SCOPE_MISMATCH" | "PROVIDER_CHAT_INVALID" | "HISTORY_EMPTY" | "HISTORY_MESSAGE_SET_INVALID"
  | "MESSAGE_ID_INVALID" | "MESSAGE_ID_DUPLICATE" | "MESSAGE_CHAT_MISMATCH"
  | "OBJECT_ID_INVALID" | "OBJECT_ID_DUPLICATE" | "OWNER_ACK_NOT_FOUND" | "OWNER_ACK_MISMATCH"
  | "OWNER_ACK_AMBIGUOUS" | "OWNER_OBJECTS_INVALID" | "BOT_MESSAGE_NOT_FOUND" | "BOT_MESSAGE_AMBIGUOUS"
  | "BOT_MESSAGE_BEFORE_ACK" | "BOT_OBJECTS_INVALID" | "BOT_MODEL_MISMATCH";

export type OwnerStandardImageHistoryBinding =
  | Readonly<{
      status: "READY";
      chat_uuid: string;
      provider_chat_id: string;
      owner_echo_message_id: string;
      result_message_id: string;
      variant: OwnerStandardImageVariant;
      model_id: OwnerStandardImageVariant;
      ai_name: "banana" | "sora-images";
      model_type: OwnerStandardImageVariant;
      operation_id: "generate-image";
      profile_id: string;
      profile_schema_hash: string;
      requested_reference_kinds: readonly OwnerStandardImageReferenceMediaKind[];
      message_object_ids: readonly string[];
      namespace_confidence: "SOURCE_SHAPED_UNVERIFIED";
      backend_acceptance: "UNPROVEN";
      output_count: 1;
    }>
  | Readonly<{ status: "PENDING"; reason: OwnerStandardImageHistoryBindingReason }>
  | Readonly<{ status: "INVALID"; reason: OwnerStandardImageHistoryBindingReason }>;

interface NormalizedMessage {
  readonly message_id: string;
  readonly provider_chat_id: string;
  readonly author_role: "owner" | "bot" | "other";
  readonly objects: readonly Readonly<{ message_object_id: string; object_type: string; model_type: string | null }>[];
}

/** Correlates one n=1 source-shaped owner echo and result from a complete normalized page. */
export function correlateOwnerStandardImageHistoryBinding(
  input: CorrelateOwnerStandardImageHistoryBindingInput | unknown
): OwnerStandardImageHistoryBinding {
  let request: Record<string, unknown>;
  try { request = readRecord(input, INPUT_KEYS); }
  catch { return invalid("INVALID_INPUT"); }

  if (typeof request.requested_chat_uuid !== "string" || !SAFE_IDENTIFIER.test(request.requested_chat_uuid) ||
      typeof request.owner_echo_message_id !== "string" || !SAFE_IDENTIFIER.test(request.owner_echo_message_id) ||
      !isVariant(request.variant) || request.profile_id !== expectedProfileId(request.variant) ||
      typeof request.profile_schema_hash !== "string" || !SHA256.test(request.profile_schema_hash) ||
      !isKindArray(request.requested_reference_kinds, request.variant)) return invalid("INVALID_INPUT");
  let sourceProfile;
  try {
    sourceProfile = getOwnerStandardImageSourceProfile(
      request.variant, SELECTED_CATALOG, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION
    );
  } catch {
    return invalid("INVALID_INPUT");
  }
  if (request.profile_id !== sourceProfile.profile_id || request.profile_schema_hash !== sourceProfile.profile_schema_hash) {
    return invalid("INVALID_INPUT");
  }

  let snapshot: Record<string, unknown>;
  try { snapshot = readRecord(request.snapshot, SNAPSHOT_KEYS); }
  catch { return invalid("HISTORY_SHAPE_INVALID"); }
  if (snapshot.complete !== true) return pending("HISTORY_INCOMPLETE");
  let messages: Record<string, unknown>[];
  try { messages = readArray(snapshot.messages, MAX_HISTORY_MESSAGES).map((entry) => readRecord(entry, MESSAGE_KEYS)); }
  catch { return invalid("HISTORY_SHAPE_INVALID"); }
  if (snapshot.page !== 1 || snapshot.page_size !== 10 || snapshot.total_pages !== 1 ||
      snapshot.has_next !== false || snapshot.has_previous !== false || !Number.isSafeInteger(snapshot.total_count) ||
      snapshot.total_count !== messages.length) return invalid("HISTORY_PAGE_INVALID");
  if (snapshot.requested_chat_uuid !== request.requested_chat_uuid) return invalid("CHAT_SCOPE_MISMATCH");
  if (typeof snapshot.provider_chat_id !== "string" || !SAFE_PROVIDER_CHAT_ID.test(snapshot.provider_chat_id)) {
    return invalid("PROVIDER_CHAT_INVALID");
  }
  if (messages.length === 0) return pending("HISTORY_EMPTY");

  const normalized: NormalizedMessage[] = [];
  const messageIds = new Set<string>();
  const objectIds = new Set<string>();
  for (const message of messages) {
    if (typeof message.message_id !== "string" || !SAFE_IDENTIFIER.test(message.message_id)) return invalid("MESSAGE_ID_INVALID");
    if (messageIds.has(message.message_id)) return invalid("MESSAGE_ID_DUPLICATE");
    messageIds.add(message.message_id);
    if (message.provider_chat_id !== snapshot.provider_chat_id) return invalid("MESSAGE_CHAT_MISMATCH");
    if (message.author_role !== "owner" && message.author_role !== "bot" && message.author_role !== "other") {
      return invalid("HISTORY_SHAPE_INVALID");
    }
    let objects: Record<string, unknown>[];
    try { objects = readArray(message.objects, MAX_OBJECTS_PER_MESSAGE).map((entry) => readRecord(entry, OBJECT_KEYS)); }
    catch { return invalid("HISTORY_SHAPE_INVALID"); }
    const safeObjects: Array<{ message_object_id: string; object_type: string; model_type: string | null }> = [];
    for (const object of objects) {
      if (typeof object.message_object_id !== "string" || !SAFE_IDENTIFIER.test(object.message_object_id)) return invalid("OBJECT_ID_INVALID");
      if (objectIds.has(object.message_object_id)) return invalid("OBJECT_ID_DUPLICATE");
      objectIds.add(object.message_object_id);
      if (typeof object.object_type !== "string" ||
          !(object.model_type === null || typeof object.model_type === "string")) return invalid("HISTORY_SHAPE_INVALID");
      safeObjects.push({
        message_object_id: object.message_object_id,
        object_type: object.object_type,
        model_type: object.model_type as string | null
      });
    }
    normalized.push(Object.freeze({
      message_id: message.message_id, provider_chat_id: message.provider_chat_id as string,
      author_role: message.author_role, objects: Object.freeze(safeObjects.map((object) => Object.freeze(object)))
    }));
  }

  const owners = normalized.filter((message) => message.author_role === "owner");
  const ackRow = normalized.find((message) => message.message_id === request.owner_echo_message_id);
  if (ackRow && ackRow.author_role !== "owner") return invalid("OWNER_ACK_MISMATCH");
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

  if (!hasExpectedOwnerObjects(owner.objects, request.requested_reference_kinds as readonly OwnerStandardImageReferenceMediaKind[], request.variant)) {
    return invalid("OWNER_OBJECTS_INVALID");
  }
  if (bot.objects.length === 0) return pending("BOT_MESSAGE_NOT_FOUND");
  if (bot.objects.length !== 1) return invalid("BOT_OBJECTS_INVALID");
  const resultObject = bot.objects[0]!;
  if (resultObject.object_type !== "image") return invalid("BOT_OBJECTS_INVALID");
  if (resultObject.model_type !== request.variant) return invalid("BOT_MODEL_MISMATCH");

  const family = familyFor(request.variant);
  return Object.freeze({
    status: "READY",
    chat_uuid: request.requested_chat_uuid as string,
    provider_chat_id: snapshot.provider_chat_id as string,
    owner_echo_message_id: request.owner_echo_message_id as string,
    result_message_id: bot.message_id,
    variant: request.variant,
    model_id: request.variant,
    ai_name: family,
    model_type: request.variant,
    operation_id: "generate-image",
    profile_id: request.profile_id as string,
    profile_schema_hash: request.profile_schema_hash as string,
    requested_reference_kinds: Object.freeze([...(request.requested_reference_kinds as OwnerStandardImageReferenceMediaKind[])]),
    message_object_ids: Object.freeze([resultObject.message_object_id]),
    namespace_confidence: "SOURCE_SHAPED_UNVERIFIED",
    backend_acceptance: "UNPROVEN",
    output_count: 1
  });
}

function hasExpectedOwnerObjects(
  objects: readonly NormalizedMessage["objects"][number][],
  expectedKinds: readonly OwnerStandardImageReferenceMediaKind[],
  variant: OwnerStandardImageVariant
): boolean {
  if (objects.length !== expectedKinds.length + 1 || objects.length > MAX_REFERENCES + 1) return false;
  const textObjects = objects.filter((object) => object.object_type === "text");
  if (textObjects.length !== 1 || !modelTypeIsSourceShaped(textObjects[0]!.model_type, variant)) return false;
  const references = objects.filter((object) => object.object_type !== "text");
  return references.length === expectedKinds.length && references.every((object, index) =>
    object.object_type === expectedKinds[index] && modelTypeIsSourceShaped(object.model_type, variant));
}

function modelTypeIsSourceShaped(value: string | null, variant: OwnerStandardImageVariant): boolean {
  return value === null || value === variant;
}

function isKindArray(value: unknown, variant: OwnerStandardImageVariant): value is readonly OwnerStandardImageReferenceMediaKind[] {
  let kinds: unknown[];
  try { kinds = readArray(value, MAX_REFERENCES); }
  catch { return false; }
  if (!isBanana21(variant) && kinds.some((kind) => kind !== "image")) return false;
  return kinds.every((kind) => REFERENCE_KINDS.includes(kind as OwnerStandardImageReferenceMediaKind));
}

function readArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > maximum) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length !== 0 || Reflect.ownKeys(descriptors).length !== value.length + 1 ||
      !("length" in descriptors) || Array.from({ length: value.length }, (_, index) => descriptors[String(index)]).some((descriptor) =>
        !descriptor || !("value" in descriptor) || descriptor.enumerable !== true)) throw new TypeError();
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]!.value);
}

function readRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== allowedKeys.length || keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key) ||
      !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) throw new TypeError();
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) record[key] = descriptors[key]!.value;
  return record;
}

function isVariant(value: unknown): value is OwnerStandardImageVariant {
  return typeof value === "string" && (OWNER_STANDARD_IMAGE_VARIANTS as readonly string[]).includes(value);
}

function isBanana21(variant: OwnerStandardImageVariant): boolean {
  return variant === "banana-2.1";
}

function familyFor(variant: OwnerStandardImageVariant): "banana" | "sora-images" {
  return variant.startsWith("banana") ? "banana" : "sora-images";
}

function expectedProfileId(variant: OwnerStandardImageVariant): string {
  return variant.startsWith("banana") ? "banana-image-source-reviewed-v1" : "gpt-image-family-source-reviewed-v1";
}

function pending(reason: OwnerStandardImageHistoryBindingReason): OwnerStandardImageHistoryBinding {
  return Object.freeze({ status: "PENDING", reason });
}

function invalid(reason: OwnerStandardImageHistoryBindingReason): OwnerStandardImageHistoryBinding {
  return Object.freeze({ status: "INVALID", reason });
}
