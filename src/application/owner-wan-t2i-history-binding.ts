import { types } from "node:util";
import type { ChatMessageHistorySnapshot } from "../adapter/syntx/chat-http-client.js";
import type { OwnerWanT2iModel } from "./owner-wan-t2i-parameters.js";

const MODEL_IDS = Object.freeze(["wan_25_t2i_preview", "wan_26_t2i"] as const);
const PROFILE_ID = "owner-wan-t2i-source-profile-v1" as const;
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_RESULTS = 4;

export interface OwnerWanT2iHistoryProfileBinding {
  readonly profile_id: typeof PROFILE_ID;
  readonly model_id: OwnerWanT2iModel;
  readonly ai_name: "wan_image";
  readonly model_type: OwnerWanT2iModel;
  readonly catalog_version: typeof CATALOG_VERSION;
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
}

export interface OwnerWanT2iResultReadContext extends OwnerWanT2iHistoryProfileBinding {
  readonly chat_uuid: string;
  readonly provider_chat_id: string;
  readonly owner_echo_message_id: string;
  readonly message_id: string;
  readonly requested_batch_size: 1 | 2 | 3 | 4;
  readonly message_object_ids: readonly string[];
}

export type OwnerWanT2iHistoryBindingReason =
  | "INVALID_INPUT" | "PROFILE_BINDING_INVALID" | "HISTORY_SHAPE_INVALID" | "HISTORY_INCOMPLETE"
  | "CHAT_SCOPE_MISMATCH" | "PROVIDER_CHAT_INVALID" | "HISTORY_MESSAGE_SET_INVALID" | "MESSAGE_ID_INVALID"
  | "MESSAGE_ID_DUPLICATE" | "MESSAGE_CHAT_MISMATCH" | "OBJECT_ID_INVALID" | "OBJECT_ID_DUPLICATE"
  | "OWNER_ACK_NOT_FOUND" | "OWNER_ACK_AMBIGUOUS" | "OWNER_MEDIA_REFERENCES_NOT_SUPPORTED"
  | "RESULT_OBJECTS_INVALID" | "RESULT_OBJECTS_OVER_LIMIT" | "REQUESTED_BATCH_INVALID";

export const OWNER_WAN_T2I_HISTORY_BINDING_REASONS = Object.freeze([
  "INVALID_INPUT", "PROFILE_BINDING_INVALID", "HISTORY_SHAPE_INVALID", "HISTORY_INCOMPLETE", "CHAT_SCOPE_MISMATCH",
  "PROVIDER_CHAT_INVALID", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE",
  "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_AMBIGUOUS",
  "OWNER_MEDIA_REFERENCES_NOT_SUPPORTED", "RESULT_OBJECTS_INVALID", "RESULT_OBJECTS_OVER_LIMIT", "REQUESTED_BATCH_INVALID"
] as const satisfies readonly OwnerWanT2iHistoryBindingReason[]);
type MissingReason = Exclude<OwnerWanT2iHistoryBindingReason, typeof OWNER_WAN_T2I_HISTORY_BINDING_REASONS[number]>;
const ALL_REASONS_PRESENT: MissingReason extends never ? true : false = true;
void ALL_REASONS_PRESENT;

export type OwnerWanT2iHistoryBinding =
  | Readonly<{ status: "READY"; read_context: OwnerWanT2iResultReadContext }>
  | Readonly<{ status: "PENDING"; reason: "HISTORY_INCOMPLETE" | "RESULT_MESSAGE_NOT_FOUND" | "RESULT_OBJECT_IDS_NOT_OBSERVED" }>
  | Readonly<{ status: "UNVERIFIED"; reason: OwnerWanT2iHistoryBindingReason }>;

export interface CorrelateOwnerWanT2iHistoryBindingInput {
  readonly snapshot: ChatMessageHistorySnapshot;
  readonly requested_chat_uuid: string;
  readonly owner_echo_message_id: string;
  readonly requested_batch_size: 1 | 2 | 3 | 4;
  readonly profile_binding: OwnerWanT2iHistoryProfileBinding;
}

/** Binds a no-reference T2I owner ACK to the unique following bot message and only its observed object IDs. */
export function correlateOwnerWanT2iHistoryBinding(input: CorrelateOwnerWanT2iHistoryBindingInput | unknown): OwnerWanT2iHistoryBinding {
  try {
    const fields = readExactRecord(input, ["snapshot", "requested_chat_uuid", "owner_echo_message_id", "requested_batch_size", "profile_binding"]);
    if (!isSafeId(fields.requested_chat_uuid) || !isSafeId(fields.owner_echo_message_id)) return unverified("INVALID_INPUT");
    if (!isBatchSize(fields.requested_batch_size)) return unverified("REQUESTED_BATCH_INVALID");
    const profile = readProfileBinding(fields.profile_binding);
    if (!profile) return unverified("PROFILE_BINDING_INVALID");
    const snapshot = readExactRecord(fields.snapshot, ["complete", "page", "page_size", "total_count", "total_pages", "has_next",
      "has_previous", "requested_chat_uuid", "provider_chat_id", "messages"]);
    if (snapshot.requested_chat_uuid !== fields.requested_chat_uuid) return unverified("CHAT_SCOPE_MISMATCH");
    if (snapshot.complete !== true) return pending("HISTORY_INCOMPLETE");
    if (snapshot.page !== 1 || snapshot.page_size !== 10 || snapshot.total_pages !== 1 || snapshot.has_next !== false ||
        snapshot.has_previous !== false || !Number.isSafeInteger(snapshot.total_count)) return unverified("HISTORY_SHAPE_INVALID");
    if (!isSafeProviderChatId(snapshot.provider_chat_id)) return unverified("PROVIDER_CHAT_INVALID");

    const messages = readDenseArray(snapshot.messages, MAX_RESULTS + 6);
    if (messages.length === 0) return unverified("OWNER_ACK_NOT_FOUND");
    if (messages.length > 2 || snapshot.total_count !== messages.length) return unverified("HISTORY_MESSAGE_SET_INVALID");
    const rows = messages.map((message) => {
      const row = readExactRecord(message, ["message_id", "provider_chat_id", "author_role", "objects"]);
      if (!isSafeId(row.message_id)) throw new TypeError();
      if (row.provider_chat_id !== snapshot.provider_chat_id) throw new T2iHistoryFailure("MESSAGE_CHAT_MISMATCH");
      if (row.author_role !== "owner" && row.author_role !== "bot" && row.author_role !== "other") throw new TypeError();
      const objects = readDenseArray(row.objects, MAX_RESULTS);
      const normalizedObjects = objects.map((objectInput) => {
        const object = readExactRecord(objectInput, ["message_object_id", "object_type", "model_type"]);
        if (!isSafeId(object.message_object_id)) throw new T2iHistoryFailure("OBJECT_ID_INVALID");
        if (typeof object.object_type !== "string" || !(object.model_type === null || typeof object.model_type === "string")) {
          throw new T2iHistoryFailure("RESULT_OBJECTS_INVALID");
        }
        return Object.freeze({ message_object_id: object.message_object_id, object_type: object.object_type, model_type: object.model_type });
      });
      return Object.freeze({ message_id: row.message_id, provider_chat_id: row.provider_chat_id,
        author_role: row.author_role, objects: Object.freeze(normalizedObjects) });
    });
    if (rows.some((row) => row.message_id === fields.owner_echo_message_id && row.author_role !== "owner")) {
      return unverified("OWNER_ACK_AMBIGUOUS");
    }
    if (rows[0]!.message_id !== fields.owner_echo_message_id || rows[0]!.author_role !== "owner") {
      return unverified(rows.some((row) => row.message_id === fields.owner_echo_message_id) ? "OWNER_ACK_AMBIGUOUS" : "OWNER_ACK_NOT_FOUND");
    }
    if (rows[0]!.objects.length !== 0) return unverified("OWNER_MEDIA_REFERENCES_NOT_SUPPORTED");
    if (new Set(rows.map((row) => row.message_id)).size !== rows.length) return unverified("MESSAGE_ID_DUPLICATE");
    const objectIds = rows.flatMap((row) => row.objects.map((object) => object.message_object_id));
    if (new Set(objectIds).size !== objectIds.length) return unverified("OBJECT_ID_DUPLICATE");
    if (rows.length === 1) return pending("RESULT_MESSAGE_NOT_FOUND");
    const resultRow = rows[1]!;
    if (resultRow.author_role !== "bot") return unverified("HISTORY_MESSAGE_SET_INVALID");
    if (resultRow.objects.length > fields.requested_batch_size || resultRow.objects.length > MAX_RESULTS) {
      return unverified("RESULT_OBJECTS_OVER_LIMIT");
    }
    if (resultRow.objects.some((object) => object.object_type !== "image" || object.model_type !== profile.model_type)) {
      return unverified("RESULT_OBJECTS_INVALID");
    }
    if (resultRow.objects.length === 0) return pending("RESULT_OBJECT_IDS_NOT_OBSERVED");
    const readContext: OwnerWanT2iResultReadContext = Object.freeze({
      ...profile,
      chat_uuid: fields.requested_chat_uuid,
      provider_chat_id: snapshot.provider_chat_id,
      owner_echo_message_id: fields.owner_echo_message_id,
      message_id: resultRow.message_id,
      requested_batch_size: fields.requested_batch_size,
      message_object_ids: Object.freeze(resultRow.objects.map((object) => object.message_object_id))
    });
    return Object.freeze({ status: "READY", read_context: readContext });
  } catch (error) {
    return unverified(error instanceof T2iHistoryFailure ? error.reason : "HISTORY_SHAPE_INVALID");
  }
}

function readProfileBinding(value: unknown): Readonly<OwnerWanT2iHistoryProfileBinding> | null {
  let profile: Record<string, unknown>;
  try {
    profile = readExactRecord(value, ["profile_id", "model_id", "ai_name", "model_type", "catalog_version",
      "profile_schema_hash", "request_fingerprint", "intent_fingerprint"]);
  } catch { return null; }
  if (profile.profile_id !== PROFILE_ID || !isT2iModel(profile.model_id) || profile.ai_name !== "wan_image" ||
      profile.model_type !== profile.model_id || profile.catalog_version !== CATALOG_VERSION ||
      !isSha256(profile.profile_schema_hash) || !isSha256(profile.request_fingerprint) || !isSha256(profile.intent_fingerprint)) return null;
  return Object.freeze({ profile_id: PROFILE_ID, model_id: profile.model_id, ai_name: "wan_image", model_type: profile.model_id,
    catalog_version: CATALOG_VERSION, profile_schema_hash: profile.profile_schema_hash,
    request_fingerprint: profile.request_fingerprint, intent_fingerprint: profile.intent_fingerprint });
}

class T2iHistoryFailure extends Error {
  constructor(readonly reason: OwnerWanT2iHistoryBindingReason) { super(reason); }
}

function pending(reason: "HISTORY_INCOMPLETE" | "RESULT_MESSAGE_NOT_FOUND" | "RESULT_OBJECT_IDS_NOT_OBSERVED"): OwnerWanT2iHistoryBinding {
  return Object.freeze({ status: "PENDING", reason });
}
function unverified(reason: OwnerWanT2iHistoryBindingReason): OwnerWanT2iHistoryBinding {
  return Object.freeze({ status: "UNVERIFIED", reason });
}
function isT2iModel(value: unknown): value is OwnerWanT2iModel {
  return typeof value === "string" && (MODEL_IDS as readonly string[]).includes(value);
}
function isBatchSize(value: unknown): value is 1 | 2 | 3 | 4 {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 1 && value <= 4;
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
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) output.push(descriptors[String(index)]!.value);
  return output;
}
