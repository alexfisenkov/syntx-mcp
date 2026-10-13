import { types } from "node:util";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../../catalog/selected-discovery-catalog.js";
import type { OwnerWanT2iModel } from "../../application/owner-wan-t2i-parameters.js";
import type { OwnerWanT2iResultReadContext } from "../../application/owner-wan-t2i-history-binding.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const PROFILE_ID = "owner-wan-t2i-source-profile-v1" as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_BATCH_SIZE = 4;
const MAX_URL_LENGTH = 4096;

export interface InternalOwnerWanT2iImageArtifact {
  readonly message_object_id: string;
  readonly message_id: string;
  readonly object_type: "image";
  readonly model_type: OwnerWanT2iModel;
  readonly completed: true;
  readonly url: string;
  readonly mime_type: "image/png" | "image/jpeg" | "image/webp" | "image/avif" | "image/gif" | "image/bmp" | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly width: null;
  readonly height: null;
  readonly geometry_verified: false;
}

export type OwnerWanT2iImageResultUnverifiedReason =
  | "RESPONSE_SHAPE_INVALID" | "OUTER_MESSAGE_MISMATCH" | "PROVIDER_CHAT_MISMATCH" | "NOT_BOT_MESSAGE"
  | "OBJECT_ID_MISMATCH" | "DUPLICATE_RESULT_OBJECT_ID" | "OBJECT_MESSAGE_MISMATCH" | "OBJECT_TYPE_MISMATCH"
  | "MODEL_TYPE_UNAVAILABLE" | "MODEL_TYPE_MISMATCH" | "RESULT_COMPLETED_FLAG_INVALID" | "RESULT_URL_UNSAFE"
  | "EXTRANEOUS_RESULT_OBJECTS";

type T2iResultCommon = Readonly<OwnerWanT2iResultReadContext & {
  readonly actual_result_count: number;
  readonly count_confidence: "CURRENT_MESSAGE_MATCHES_EXPLICIT_BATCH_NOT_PROVIDER_TERMINAL" | "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL";
  readonly provider_terminal_confidence: "UNPROVEN";
  readonly artifacts: readonly InternalOwnerWanT2iImageArtifact[];
}>;

export type InternalOwnerWanT2iImageResult =
  | (T2iResultCommon & Readonly<{ status: "COMPLETE" }>)
  | (T2iResultCommon & Readonly<{ status: "PENDING"; reason: "NO_RESULT_OBJECTS" | "NO_COMPLETED_RESULT_OBJECTS" }>)
  | (T2iResultCommon & Readonly<{ status: "PARTIAL"; reason: "OBSERVED_RESULTS_PARTIAL" | "RESULT_URI_PENDING" | "RESULT_OBJECTS_PENDING" }>)
  | (T2iResultCommon & Readonly<{ status: "UNVERIFIED"; reason: OwnerWanT2iImageResultUnverifiedReason }>);

/** GET-response decoder for one exact T2I history message; count confidence is local-message scoped, never job-terminal proof. */
export function decodeOwnerWanT2iImageResult(rawInput: unknown, contextInput: unknown): InternalOwnerWanT2iImageResult {
  const context = snapshotOwnerWanT2iResultReadContext(contextInput);
  const unverified = (reason: OwnerWanT2iImageResultUnverifiedReason): InternalOwnerWanT2iImageResult => Object.freeze({
    ...context, status: "UNVERIFIED", reason, actual_result_count: 0,
    count_confidence: "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL", provider_terminal_confidence: "UNPROVEN", artifacts: Object.freeze([])
  });
  const pending = (reason: "NO_RESULT_OBJECTS" | "NO_COMPLETED_RESULT_OBJECTS", count = 0): InternalOwnerWanT2iImageResult => Object.freeze({
    ...context, status: "PENDING", reason, actual_result_count: count,
    count_confidence: "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL", provider_terminal_confidence: "UNPROVEN", artifacts: Object.freeze([])
  });
  const raw = readRecordLoose(rawInput);
  if (!raw) return unverified("RESPONSE_SHAPE_INVALID");
  if (providerId(raw.id) !== context.message_id) return unverified("OUTER_MESSAGE_MISMATCH");
  if (typeof raw.chat_id !== "number" || !Number.isSafeInteger(raw.chat_id) || raw.chat_id < 0 ||
      String(raw.chat_id) !== context.provider_chat_id) return unverified("PROVIDER_CHAT_MISMATCH");
  if (raw.author_id !== -1) return unverified("NOT_BOT_MESSAGE");
  const objects = readArrayLoose(raw.message_object, MAX_BATCH_SIZE + 1);
  if (!objects) return unverified("RESPONSE_SHAPE_INVALID");
  if (objects.length > context.requested_batch_size || objects.length > MAX_BATCH_SIZE) return unverified("EXTRANEOUS_RESULT_OBJECTS");
  if (objects.length === 0) return pending("NO_RESULT_OBJECTS");

  const expectedIds = new Set(context.message_object_ids);
  const seenIds = new Set<string>();
  const artifactsById = new Map<string, InternalOwnerWanT2iImageArtifact>();
  let unfinishedCount = 0;
  let uriPendingCount = 0;
  for (const rawObject of objects) {
    const object = readRecordLoose(rawObject);
    if (!object) return unverified("RESPONSE_SHAPE_INVALID");
    const id = providerId(object.id);
    if (id === undefined || !expectedIds.has(id)) return unverified("OBJECT_ID_MISMATCH");
    if (seenIds.has(id)) return unverified("DUPLICATE_RESULT_OBJECT_ID");
    seenIds.add(id);
    if (providerId(object.message_id) !== context.message_id) return unverified("OBJECT_MESSAGE_MISMATCH");
    if (object.object_type !== "image") return unverified("OBJECT_TYPE_MISMATCH");
    if (typeof object.model_type !== "string") return unverified("MODEL_TYPE_UNAVAILABLE");
    if (object.model_type !== context.model_type) return unverified("MODEL_TYPE_MISMATCH");
    if (typeof object.completed !== "boolean") return unverified("RESULT_COMPLETED_FLAG_INVALID");
    if (!object.completed) { unfinishedCount += 1; continue; }
    if (object.object_url === null || object.object_url === undefined) { uriPendingCount += 1; continue; }
    if (typeof object.object_url !== "string" || object.object_url.length > MAX_URL_LENGTH ||
        !isSafeUploadReferenceUrl(object.object_url)) return unverified("RESULT_URL_UNSAFE");
    const mimeType = inferImageMimeType(object.object_url);
    artifactsById.set(id, Object.freeze({ message_object_id: id, message_id: context.message_id,
      object_type: "image", model_type: context.model_type, completed: true, url: object.object_url,
      mime_type: mimeType, mime_source: mimeType === null ? "UNKNOWN" : "URL_EXTENSION",
      width: null, height: null, geometry_verified: false }));
  }

  const artifacts = Object.freeze(context.message_object_ids.flatMap((id) => {
    const artifact = artifactsById.get(id);
    return artifact === undefined ? [] : [artifact];
  }));
  const common = { ...context, actual_result_count: objects.length,
    count_confidence: "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL" as const, provider_terminal_confidence: "UNPROVEN" as const, artifacts };
  if (artifacts.length === 0) return pending("NO_COMPLETED_RESULT_OBJECTS", objects.length);
  if (objects.length !== context.requested_batch_size || context.message_object_ids.length !== context.requested_batch_size) {
    return Object.freeze({ ...common, status: "PARTIAL", reason: "OBSERVED_RESULTS_PARTIAL" });
  }
  if (unfinishedCount > 0) return Object.freeze({ ...common, status: "PARTIAL", reason: "RESULT_OBJECTS_PENDING" });
  if (uriPendingCount > 0) return Object.freeze({ ...common, status: "PARTIAL", reason: "RESULT_URI_PENDING" });
  if (artifacts.length !== context.requested_batch_size) return Object.freeze({ ...common, status: "PARTIAL", reason: "OBSERVED_RESULTS_PARTIAL" });
  return Object.freeze({ ...common, status: "COMPLETE",
    count_confidence: "CURRENT_MESSAGE_MATCHES_EXPLICIT_BATCH_NOT_PROVIDER_TERMINAL" });
}

export function snapshotOwnerWanT2iResultReadContext(value: unknown): Readonly<OwnerWanT2iResultReadContext> {
  const fields = readExactRecord(value, ["profile_id", "model_id", "ai_name", "model_type", "catalog_version",
    "profile_schema_hash", "request_fingerprint", "intent_fingerprint", "chat_uuid", "provider_chat_id",
    "owner_echo_message_id", "message_id", "requested_batch_size", "message_object_ids"]);
  if (fields.profile_id !== PROFILE_ID || !isT2iModel(fields.model_id) || fields.model_type !== fields.model_id ||
      fields.ai_name !== "wan_image" || fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION ||
      !isSha256(fields.profile_schema_hash) || !isSha256(fields.request_fingerprint) || !isSha256(fields.intent_fingerprint) ||
      !isSafeId(fields.chat_uuid) || !isSafeProviderChatId(fields.provider_chat_id) || !isSafeId(fields.owner_echo_message_id) ||
      !isSafeId(fields.message_id) || !isBatch(fields.requested_batch_size)) throw new TypeError("INVALID_OWNER_WAN_T2I_RESULT_CONTEXT");
  const ids = readDenseArray(fields.message_object_ids, MAX_BATCH_SIZE);
  if (ids.length === 0 || ids.length > fields.requested_batch_size || ids.some((id) => !isSafeId(id)) || new Set(ids).size !== ids.length) {
    throw new TypeError("INVALID_OWNER_WAN_T2I_RESULT_CONTEXT");
  }
  return Object.freeze({
    profile_id: PROFILE_ID, model_id: fields.model_id, ai_name: "wan_image", model_type: fields.model_id,
    catalog_version: fields.catalog_version, profile_schema_hash: fields.profile_schema_hash,
    request_fingerprint: fields.request_fingerprint, intent_fingerprint: fields.intent_fingerprint,
    chat_uuid: fields.chat_uuid, provider_chat_id: fields.provider_chat_id, owner_echo_message_id: fields.owner_echo_message_id,
    message_id: fields.message_id, requested_batch_size: fields.requested_batch_size,
    message_object_ids: Object.freeze([...ids]) as readonly string[]
  });
}

function isT2iModel(value: unknown): value is OwnerWanT2iModel {
  return value === "wan_25_t2i_preview" || value === "wan_26_t2i";
}
function isBatch(value: unknown): value is 1 | 2 | 3 | 4 {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_BATCH_SIZE;
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSafeProviderChatId(value: unknown): value is string {
  return typeof value === "string" && SAFE_PROVIDER_CHAT_ID.test(value) && Number.isSafeInteger(Number(value));
}
function isSha256(value: unknown): value is string { return typeof value === "string" && SHA256.test(value); }
function providerId(value: unknown): string | undefined {
  if (typeof value === "string") return isSafeId(value) ? value : undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
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
function readRecordLoose(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) return null;
    result[key] = descriptors[key]!.value;
  }
  return result;
}
function readArrayLoose(value: unknown, maximum: number): unknown[] | null {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== value.length + 1 || !own.includes("length") || own.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) return null;
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) output.push(descriptors[String(index)]!.value);
  return output;
}
function readDenseArray(value: unknown, maximum: number): unknown[] {
  const items = readArrayLoose(value, maximum);
  if (!items) throw new TypeError();
  return items;
}
function inferImageMimeType(value: string): InternalOwnerWanT2iImageArtifact["mime_type"] {
  let pathname: string;
  try { pathname = new URL(value).pathname; } catch { return null; }
  const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(pathname)?.[1]?.toLowerCase();
  switch (extension) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "avif": return "image/avif";
    case "gif": return "image/gif";
    case "bmp": return "image/bmp";
    default: return null;
  }
}
