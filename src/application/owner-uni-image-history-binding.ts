import { types } from "node:util";
import type { ChatMessageHistorySnapshot } from "../adapter/syntx/chat-http-client.js";
import type { OwnerUniImageResultReadContext } from "../adapter/syntx/owner-uni-image-result.js";
import type { OwnerUniImageModel } from "./owner-uni-image-parameters.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const MAX_OBSERVED_OBJECTS = 64;

export interface OwnerUniImageHistoryProfileBinding {
  readonly profile_id: "owner-uni-image-source-profile-v1";
  readonly model_id: OwnerUniImageModel;
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
}

export type OwnerUniImageHistoryBindingReason =
  | "HISTORY_SHAPE_INVALID"
  | "CHAT_SCOPE_MISMATCH"
  | "OWNER_ACK_NOT_FOUND"
  | "OWNER_ACK_AMBIGUOUS"
  | "OWNER_INPUT_OBJECTS_MISMATCH"
  | "HISTORY_MESSAGE_SET_INVALID"
  | "RESULT_MESSAGE_NOT_FOUND"
  | "RESULT_MESSAGE_AMBIGUOUS"
  | "RESULT_OBJECTS_INVALID"
  | "RESULT_OBJECTS_OVER_LIMIT"
  | "PROFILE_BINDING_INVALID";

export type OwnerUniImageHistoryBinding =
  | Readonly<{ status: "READY"; read_context: OwnerUniImageResultReadContext }>
  | Readonly<{ status: "PENDING"; reason: "RESULT_MESSAGE_NOT_FOUND" }>
  | Readonly<{ status: "UNVERIFIED"; reason: Exclude<OwnerUniImageHistoryBindingReason, "RESULT_MESSAGE_NOT_FOUND"> }>;

export interface CorrelateOwnerUniImageHistoryBindingInput {
  readonly snapshot: ChatMessageHistorySnapshot;
  readonly requested_chat_uuid: string;
  readonly owner_echo_message_id: string;
  readonly model_id: OwnerUniImageModel;
  readonly expected_reference_count: number;
  readonly expected_reference_types: readonly string[];
  readonly profile_binding: OwnerUniImageHistoryProfileBinding;
}

/** Correlates only the exact owner ACK and a unique later bot row in the complete current history page. */
export function correlateOwnerUniImageHistoryBinding(input: CorrelateOwnerUniImageHistoryBindingInput): OwnerUniImageHistoryBinding {
  try {
    input = readExactRecord(input, ["snapshot", "requested_chat_uuid", "owner_echo_message_id", "model_id",
      "expected_reference_count", "expected_reference_types", "profile_binding"]) as unknown as CorrelateOwnerUniImageHistoryBindingInput;
    const snapshot = readRecord(input.snapshot);
    const profile = readRecord(input.profile_binding);
    if (!isSafeId(input.requested_chat_uuid) || !isSafeId(input.owner_echo_message_id) || !isUniModel(input.model_id) ||
        !isValidProfile(profile, input.model_id)) return unverified("PROFILE_BINDING_INVALID");
    if (snapshot.requested_chat_uuid !== input.requested_chat_uuid) return unverified("CHAT_SCOPE_MISMATCH");
    if (snapshot.complete !== true || snapshot.page !== 1 || snapshot.page_size !== 10 || snapshot.total_pages !== 1 ||
        snapshot.has_next !== false || snapshot.has_previous !== false ||
        typeof snapshot.provider_chat_id !== "string" || !SAFE_PROVIDER_CHAT_ID.test(snapshot.provider_chat_id) ||
        !Number.isSafeInteger(Number(snapshot.provider_chat_id)) || !Number.isSafeInteger(snapshot.total_count)) return unverified("HISTORY_SHAPE_INVALID");
    const messages = readDenseArray(snapshot.messages, 10);
    if (messages.length !== snapshot.total_count || messages.length === 0) return unverified("HISTORY_SHAPE_INVALID");
    if (messages.length > 2) return unverified("HISTORY_MESSAGE_SET_INVALID");

    const parsed = messages.map((entry) => {
      const row = readRecord(entry);
      if (!isSafeId(row.message_id) || row.provider_chat_id !== snapshot.provider_chat_id ||
          typeof row.author_role !== "string" || !["owner", "bot", "other"].includes(row.author_role)) throw new TypeError();
      const objects = readDenseArray(row.objects, MAX_OBSERVED_OBJECTS);
      const safeObjects = objects.map((object) => {
        const fields = readRecord(object);
        if (!isSafeId(fields.message_object_id) || typeof fields.object_type !== "string" ||
            !(fields.model_type === null || typeof fields.model_type === "string")) throw new TypeError();
        return { message_object_id: fields.message_object_id, object_type: fields.object_type, model_type: fields.model_type };
      });
      return { message_id: row.message_id, provider_chat_id: row.provider_chat_id,
        author_role: row.author_role as "owner" | "bot" | "other", objects: safeObjects };
    });
    if (new Set(parsed.map((row) => row.message_id)).size !== parsed.length) return unverified("HISTORY_SHAPE_INVALID");
    const objectIds = parsed.flatMap((row) => row.objects.map((object) => object.message_object_id));
    if (new Set(objectIds).size !== objectIds.length) return unverified("HISTORY_SHAPE_INVALID");

    const ownerMatches = parsed.filter((row) => row.message_id === input.owner_echo_message_id && row.author_role === "owner");
    if (ownerMatches.length === 0) return unverified("OWNER_ACK_NOT_FOUND");
    if (ownerMatches.length !== 1) return unverified("OWNER_ACK_AMBIGUOUS");
    const ownerIndex = parsed.indexOf(ownerMatches[0]!);
    if (ownerIndex !== 0) return unverified("HISTORY_MESSAGE_SET_INVALID");
    if (parsed.length === 1) return Object.freeze({ status: "PENDING", reason: "RESULT_MESSAGE_NOT_FOUND" });
    if (parsed.length !== 2 || parsed[1]!.author_role !== "bot") return unverified("HISTORY_MESSAGE_SET_INVALID");
    const ownerObjects = ownerMatches[0]!.objects;
    const expectedTypes = readDenseArray(input.expected_reference_types, 64);
    const referenceCountAllowed = input.model_id === "uni-1"
      ? input.expected_reference_count >= 0 && input.expected_reference_count <= 9
      : input.model_id === "uni-1.1-modify-image"
        ? input.expected_reference_count >= 1 && input.expected_reference_count <= 8
        : input.expected_reference_count === 1;
    if (!Number.isSafeInteger(input.expected_reference_count) || input.expected_reference_count < 0 ||
        !referenceCountAllowed ||
        ownerObjects.length !== input.expected_reference_count || expectedTypes.length !== input.expected_reference_count ||
        expectedTypes.some((type) => type !== "image") || ownerObjects.some((object) => object.object_type !== "image")) {
      return unverified("OWNER_INPUT_OBJECTS_MISMATCH");
    }

    const resultRow = parsed[1]!;
    if (resultRow.objects.length === 0) return Object.freeze({ status: "PENDING", reason: "RESULT_MESSAGE_NOT_FOUND" });
    if (resultRow.objects.length === 0 || resultRow.objects.length > MAX_OBSERVED_OBJECTS) return unverified("RESULT_OBJECTS_OVER_LIMIT");
    if (resultRow.objects.some((object) => object.object_type !== "image" || object.model_type !== input.model_id)) return unverified("RESULT_OBJECTS_INVALID");

    const context: OwnerUniImageResultReadContext = Object.freeze({
      chat_uuid: input.requested_chat_uuid,
      provider_chat_id: snapshot.provider_chat_id,
      owner_echo_message_id: input.owner_echo_message_id,
      message_id: resultRow.message_id,
      model_id: input.model_id,
      message_object_ids: Object.freeze(resultRow.objects.map((object) => object.message_object_id)),
      profile_id: profile.profile_id as OwnerUniImageResultReadContext["profile_id"],
      catalog_version: profile.catalog_version as string,
      profile_schema_hash: profile.profile_schema_hash as string,
      request_fingerprint: profile.request_fingerprint as string,
      intent_fingerprint: profile.intent_fingerprint as string
    });
    return Object.freeze({ status: "READY", read_context: context });
  } catch (error) {
    if (error instanceof RangeError && error.message === "UNI_RESULT_OBJECT_CAP_EXCEEDED") return unverified("RESULT_OBJECTS_OVER_LIMIT");
    return unverified("HISTORY_SHAPE_INVALID");
  }
}

function isValidProfile(value: Record<string, unknown>, model: OwnerUniImageModel): boolean {
  return value.profile_id === "owner-uni-image-source-profile-v1" && value.model_id === model &&
    isSafeId(value.catalog_version) && isSha256(value.profile_schema_hash) &&
    isSha256(value.request_fingerprint) && isSha256(value.intent_fingerprint);
}
function isUniModel(value: unknown): value is OwnerUniImageModel {
  return value === "uni-1" || value === "uni-1.1-modify-image" || value === "uni-1.1-remove-background";
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSha256(value: unknown): value is string { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value); }
function unverified(reason: Exclude<OwnerUniImageHistoryBindingReason, "RESULT_MESSAGE_NOT_FOUND">): OwnerUniImageHistoryBinding {
  return Object.freeze({ status: "UNVERIFIED", reason });
}
function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!)) throw new TypeError();
    result[key] = descriptors[key]!.value;
  }
  return result;
}
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
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError();
  if (value.length > maximum) throw new RangeError("UNI_RESULT_OBJECT_CAP_EXCEEDED");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
       !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) throw new TypeError();
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]!.value);
}
