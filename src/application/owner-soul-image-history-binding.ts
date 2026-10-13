import { types } from "node:util";
import type { ChatMessageHistorySnapshot } from "../adapter/syntx/chat-http-client.js";
import type { OwnerSoulImageResultReadContext } from "../adapter/syntx/owner-soul-image-result.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";

const MODEL_ID = "higgsfield-soul" as const;
const PROFILE_ID = "owner-soul-image-source-profile-v1" as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_BATCH_SIZE = 4;

export interface OwnerSoulImageHistoryProfileBinding {
  readonly profile_id: typeof PROFILE_ID;
  readonly model_id: typeof MODEL_ID;
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
}

export type OwnerSoulImageHistoryBindingReason =
  | "HISTORY_SHAPE_INVALID"
  | "CHAT_SCOPE_MISMATCH"
  | "OWNER_ACK_NOT_FOUND"
  | "OWNER_ACK_AMBIGUOUS"
  | "OWNER_MEDIA_REFERENCES_NOT_SUPPORTED"
  | "HISTORY_MESSAGE_SET_INVALID"
  | "RESULT_OBJECTS_INVALID"
  | "RESULT_OBJECTS_OVER_LIMIT"
  | "PROFILE_BINDING_INVALID"
  | "REQUESTED_BATCH_INVALID";

export type OwnerSoulImageHistoryBinding =
  | Readonly<{ status: "READY"; read_context: OwnerSoulImageResultReadContext }>
  | Readonly<{ status: "PENDING"; reason: "RESULT_MESSAGE_NOT_FOUND" | "RESULT_OBJECT_IDS_NOT_OBSERVED" }>
  | Readonly<{ status: "UNVERIFIED"; reason: OwnerSoulImageHistoryBindingReason }>;

export interface CorrelateOwnerSoulImageHistoryBindingInput {
  readonly snapshot: ChatMessageHistorySnapshot;
  readonly requested_chat_uuid: string;
  readonly owner_echo_message_id: string;
  readonly requested_batch_size: 1 | 4;
  readonly profile_binding: OwnerSoulImageHistoryProfileBinding;
}

/** Binds one exact current owner echo and the only following bot row; no media references are inferred. */
export function correlateOwnerSoulImageHistoryBinding(input: CorrelateOwnerSoulImageHistoryBindingInput | unknown): OwnerSoulImageHistoryBinding {
  try {
    const fields = readExactRecord(input, ["snapshot", "requested_chat_uuid", "owner_echo_message_id", "requested_batch_size", "profile_binding"]);
    if (!isSafeId(fields.requested_chat_uuid) || !isSafeId(fields.owner_echo_message_id)) return unverified("HISTORY_SHAPE_INVALID");
    if (fields.requested_batch_size !== 1 && fields.requested_batch_size !== 4) return unverified("REQUESTED_BATCH_INVALID");
    const profile = readExactRecord(fields.profile_binding, ["profile_id", "model_id", "catalog_version", "profile_schema_hash",
      "request_fingerprint", "intent_fingerprint"]);
    if (profile.profile_id !== PROFILE_ID || profile.model_id !== MODEL_ID ||
        profile.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || !isSha256(profile.profile_schema_hash) ||
        !isSha256(profile.request_fingerprint) || !isSha256(profile.intent_fingerprint)) return unverified("PROFILE_BINDING_INVALID");
    const snapshot = readExactRecord(fields.snapshot, ["complete", "page", "page_size", "total_count", "total_pages", "has_next",
      "has_previous", "requested_chat_uuid", "provider_chat_id", "messages"]);
    if (snapshot.requested_chat_uuid !== fields.requested_chat_uuid) return unverified("CHAT_SCOPE_MISMATCH");
    if (snapshot.complete !== true || snapshot.page !== 1 || snapshot.page_size !== 10 || snapshot.total_pages !== 1 ||
        snapshot.has_next !== false || snapshot.has_previous !== false || !isSafeProviderChatId(snapshot.provider_chat_id) ||
        !Number.isSafeInteger(snapshot.total_count)) return unverified("HISTORY_SHAPE_INVALID");
    const messages = readDenseArray(snapshot.messages, 10);
    if (messages.length < 1 || messages.length > 2 || snapshot.total_count !== messages.length) return unverified("HISTORY_MESSAGE_SET_INVALID");
    const rows = messages.map((value) => {
      const row = readExactRecord(value, ["message_id", "provider_chat_id", "author_role", "objects"]);
      if (!isSafeId(row.message_id) || row.provider_chat_id !== snapshot.provider_chat_id ||
          (row.author_role !== "owner" && row.author_role !== "bot" && row.author_role !== "other")) throw new TypeError();
      const objects = readDenseArray(row.objects, MAX_BATCH_SIZE);
      return { message_id: row.message_id, provider_chat_id: row.provider_chat_id, author_role: row.author_role,
        objects: objects.map((item) => {
          const object = readExactRecord(item, ["message_object_id", "object_type", "model_type"]);
          if (!isSafeId(object.message_object_id) || typeof object.object_type !== "string" ||
              !(object.model_type === null || typeof object.model_type === "string")) throw new TypeError();
          return { message_object_id: object.message_object_id, object_type: object.object_type, model_type: object.model_type };
        }) };
    });
    if (rows[0]!.message_id !== fields.owner_echo_message_id || rows[0]!.author_role !== "owner") {
      return unverified(rows.some((row) => row.message_id === fields.owner_echo_message_id) ? "OWNER_ACK_AMBIGUOUS" : "OWNER_ACK_NOT_FOUND");
    }
    if (rows[0]!.objects.length !== 0) return unverified("OWNER_MEDIA_REFERENCES_NOT_SUPPORTED");
    if (rows.length === 1) return Object.freeze({ status: "PENDING", reason: "RESULT_MESSAGE_NOT_FOUND" });
    if (rows[1]!.author_role !== "bot" || rows[1]!.message_id === fields.owner_echo_message_id) return unverified("HISTORY_MESSAGE_SET_INVALID");
    const objectIds = rows.flatMap((row) => row.objects.map((object) => object.message_object_id));
    if (new Set(rows.map((row) => row.message_id)).size !== 2 || new Set(objectIds).size !== objectIds.length) {
      return unverified("HISTORY_SHAPE_INVALID");
    }
    const resultObjects = rows[1]!.objects;
    if (resultObjects.length > fields.requested_batch_size || resultObjects.length > MAX_BATCH_SIZE) return unverified("RESULT_OBJECTS_OVER_LIMIT");
    if (resultObjects.some((object) => object.object_type !== "image" || object.model_type !== MODEL_ID)) {
      return unverified("RESULT_OBJECTS_INVALID");
    }
    if (resultObjects.length === 0) return Object.freeze({ status: "PENDING", reason: "RESULT_OBJECT_IDS_NOT_OBSERVED" });
    const readContext: OwnerSoulImageResultReadContext = Object.freeze({
      chat_uuid: fields.requested_chat_uuid,
      provider_chat_id: snapshot.provider_chat_id,
      owner_echo_message_id: fields.owner_echo_message_id,
      message_id: rows[1]!.message_id,
      model_id: MODEL_ID,
      requested_batch_size: fields.requested_batch_size,
      message_object_ids: Object.freeze(resultObjects.map((object) => object.message_object_id)),
      profile_id: PROFILE_ID,
      catalog_version: profile.catalog_version,
      profile_schema_hash: profile.profile_schema_hash,
      request_fingerprint: profile.request_fingerprint,
      intent_fingerprint: profile.intent_fingerprint
    });
    return Object.freeze({ status: "READY", read_context: readContext });
  } catch {
    return unverified("HISTORY_SHAPE_INVALID");
  }
}

function unverified(reason: OwnerSoulImageHistoryBindingReason): OwnerSoulImageHistoryBinding {
  return Object.freeze({ status: "UNVERIFIED", reason });
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSafeProviderChatId(value: unknown): value is string {
  return typeof value === "string" && SAFE_PROVIDER_CHAT_ID.test(value) && Number.isSafeInteger(Number(value));
}
function isSha256(value: unknown): value is string { return typeof value === "string" && SHA256.test(value); }
function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) throw new TypeError();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of own as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function readDenseArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== value.length + 1 || !own.includes("length") || own.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
       !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) throw new TypeError();
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]!.value);
}
