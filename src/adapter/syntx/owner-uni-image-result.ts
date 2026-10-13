import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import type { OwnerUniImageModel } from "../../application/owner-uni-image-parameters.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const MAX_URL_LENGTH = 4096;
export const OWNER_UNI_IMAGE_RESULT_COUNT_CONFIDENCE = "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL" as const;

export interface OwnerUniImageResultReadContext {
  readonly chat_uuid: string;
  readonly provider_chat_id: string;
  readonly owner_echo_message_id: string;
  readonly message_id: string;
  readonly model_id: OwnerUniImageModel;
  readonly message_object_ids: readonly string[];
  readonly profile_id: "owner-uni-image-source-profile-v1";
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
}

export interface InternalOwnerUniImageResultArtifact {
  readonly message_object_id: string;
  readonly message_id: string;
  readonly object_type: "image";
  readonly model_type: OwnerUniImageModel;
  readonly completed: true;
  readonly url: string;
  readonly mime_type: "image/png" | "image/jpeg" | "image/webp" | "image/avif" | "image/gif" | "image/bmp" | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly width: null;
  readonly height: null;
  readonly geometry_verified: false;
}

export type OwnerUniImageResultPendingReason = "NO_RESULT_OBJECTS" | "NO_COMPLETED_RESULT_OBJECTS";
export type OwnerUniImageResultPartialReason = "OBSERVED_RESULT_OBJECTS_PARTIAL" | "SOME_RESULTS_NOT_COMPLETED";
export type OwnerUniImageResultUnverifiedReason =
  | "RESPONSE_SHAPE_INVALID" | "OUTER_MESSAGE_MISMATCH" | "PROVIDER_CHAT_MISMATCH" | "NOT_BOT_MESSAGE"
  | "RESULT_OBJECT_SHAPE_INVALID" | "OBJECT_ID_MISMATCH" | "OBJECT_MESSAGE_MISMATCH" | "OBJECT_TYPE_MISMATCH"
  | "MODEL_TYPE_UNAVAILABLE" | "MODEL_TYPE_MISMATCH" | "RESULT_URL_UNSAFE" | "EXTRANEOUS_RESULT_OBJECTS" | "DUPLICATE_RESULT_OBJECT_ID";

type Provenance = Readonly<{
  result_count_confidence: typeof OWNER_UNI_IMAGE_RESULT_COUNT_CONFIDENCE;
  model_confidence: "PRIVATE_PROFILE_CONTEXT_NOT_PROVIDER_PROOF";
  backend_acceptance: "UNPROVEN";
}>;
type Context = Readonly<OwnerUniImageResultReadContext>;
export type InternalOwnerUniImageResult =
  | (Context & Provenance & Readonly<{ status: "COMPLETE"; observed_history_object_count: number; actual_result_count: number; artifacts: readonly InternalOwnerUniImageResultArtifact[] }>)
  | (Context & Provenance & Readonly<{ status: "PENDING"; reason: OwnerUniImageResultPendingReason; observed_history_object_count: number; actual_result_count: number; artifacts: readonly InternalOwnerUniImageResultArtifact[] }>)
  | (Context & Provenance & Readonly<{ status: "PARTIAL"; reason: OwnerUniImageResultPartialReason; observed_history_object_count: number; actual_result_count: number; artifacts: readonly InternalOwnerUniImageResultArtifact[] }>)
  | (Context & Provenance & Readonly<{ status: "UNVERIFIED"; reason: OwnerUniImageResultUnverifiedReason; observed_history_object_count: number; actual_result_count: number; artifacts: readonly InternalOwnerUniImageResultArtifact[] }>);

/** Reads only one exact history-bound bot message. COMPLETE is message-local; no requested output total exists. */
export function decodeOwnerUniImageResult(raw: unknown, contextInput: unknown): InternalOwnerUniImageResult {
  const context = snapshotOwnerUniImageResultReadContext(contextInput);
  const unverified = (reason: OwnerUniImageResultUnverifiedReason): InternalOwnerUniImageResult =>
    Object.freeze({ ...context, ...provenance(), status: "UNVERIFIED", reason,
      observed_history_object_count: context.message_object_ids.length, actual_result_count: 0, artifacts: Object.freeze([]) });
  const pending = (reason: OwnerUniImageResultPendingReason): InternalOwnerUniImageResult =>
    Object.freeze({ ...context, ...provenance(), status: "PENDING", reason,
      observed_history_object_count: context.message_object_ids.length, actual_result_count: 0, artifacts: Object.freeze([]) });
  const outer = readRecordLoose(raw);
  if (!outer) return unverified("RESPONSE_SHAPE_INVALID");
  if (providerId(outer.id) !== context.message_id) return unverified("OUTER_MESSAGE_MISMATCH");
  if (typeof outer.chat_id !== "number" || !Number.isSafeInteger(outer.chat_id) || outer.chat_id < 0 || String(outer.chat_id) !== context.provider_chat_id) return unverified("PROVIDER_CHAT_MISMATCH");
  if (outer.author_id !== -1) return unverified("NOT_BOT_MESSAGE");
  const rawObjects = readArrayLoose(outer.message_object);
  if (!rawObjects) return unverified("RESPONSE_SHAPE_INVALID");
  if (rawObjects.length === 0) return pending("NO_RESULT_OBJECTS");
  if (rawObjects.length > context.message_object_ids.length) return unverified("EXTRANEOUS_RESULT_OBJECTS");

  const artifactsById = new Map<string, InternalOwnerUniImageResultArtifact>();
  const seenIds = new Set<string>();
  let completedCount = 0;
  for (const rawObject of rawObjects) {
    const object = readRecordLoose(rawObject);
    if (!object) return unverified("RESULT_OBJECT_SHAPE_INVALID");
    const objectId = providerId(object.id);
    if (!objectId || !context.message_object_ids.includes(objectId)) return unverified("OBJECT_ID_MISMATCH");
    if (seenIds.has(objectId)) return unverified("DUPLICATE_RESULT_OBJECT_ID");
    seenIds.add(objectId);
    if (providerId(object.message_id) !== context.message_id) return unverified("OBJECT_MESSAGE_MISMATCH");
    if (object.object_type !== "image") return unverified("OBJECT_TYPE_MISMATCH");
    if (typeof object.model_type !== "string") return unverified("MODEL_TYPE_UNAVAILABLE");
    if (object.model_type !== context.model_id) return unverified("MODEL_TYPE_MISMATCH");
    if (typeof object.completed !== "boolean") return unverified("RESULT_OBJECT_SHAPE_INVALID");
    if (!object.completed) continue;
    if (typeof object.object_url !== "string" || object.object_url.length > MAX_URL_LENGTH || !isSafeUploadReferenceUrl(object.object_url)) return unverified("RESULT_URL_UNSAFE");
    completedCount += 1;
    const mimeType = inferImageMimeType(object.object_url);
    artifactsById.set(objectId, Object.freeze({
      message_object_id: objectId, message_id: context.message_id,
      object_type: "image", model_type: context.model_id, completed: true, url: object.object_url,
      mime_type: mimeType, mime_source: mimeType === null ? "UNKNOWN" : "URL_EXTENSION",
      width: null, height: null, geometry_verified: false
    }));
  }
  if (completedCount === 0) return Object.freeze({ ...context, ...provenance(), status: "PENDING", reason: "NO_COMPLETED_RESULT_OBJECTS",
    observed_history_object_count: context.message_object_ids.length, actual_result_count: rawObjects.length, artifacts: Object.freeze([]) });
  const artifacts = context.message_object_ids.flatMap((id) => {
    const artifact = artifactsById.get(id);
    return artifact ? [artifact] : [];
  });
  const frozenArtifacts = Object.freeze(artifacts);
  if (seenIds.size < context.message_object_ids.length) {
    return Object.freeze({ ...context, ...provenance(), status: "PARTIAL", reason: "OBSERVED_RESULT_OBJECTS_PARTIAL",
      observed_history_object_count: context.message_object_ids.length, actual_result_count: rawObjects.length, artifacts: frozenArtifacts });
  }
  if (completedCount < rawObjects.length) {
    return Object.freeze({ ...context, ...provenance(), status: "PARTIAL", reason: "SOME_RESULTS_NOT_COMPLETED",
      observed_history_object_count: context.message_object_ids.length, actual_result_count: rawObjects.length, artifacts: frozenArtifacts });
  }
  return Object.freeze({ ...context, ...provenance(), status: "COMPLETE", observed_history_object_count: context.message_object_ids.length,
    actual_result_count: rawObjects.length, artifacts: frozenArtifacts });
}

export function snapshotOwnerUniImageResultReadContext(value: unknown): Context {
  const fields = readExactRecord(value, ["chat_uuid", "provider_chat_id", "owner_echo_message_id", "message_id", "model_id", "message_object_ids",
    "profile_id", "catalog_version", "profile_schema_hash", "request_fingerprint", "intent_fingerprint"]);
  if (!isSafeId(fields.chat_uuid) || !isSafeId(fields.owner_echo_message_id) || !isSafeId(fields.message_id) || !isUniModel(fields.model_id) ||
      typeof fields.provider_chat_id !== "string" || !SAFE_PROVIDER_CHAT_ID.test(fields.provider_chat_id) || !Number.isSafeInteger(Number(fields.provider_chat_id)) ||
      fields.profile_id !== "owner-uni-image-source-profile-v1" || !isSafeId(fields.catalog_version) || !isSha256(fields.profile_schema_hash) ||
      !isSha256(fields.request_fingerprint) || !isSha256(fields.intent_fingerprint)) throw new TypeError("INVALID_OWNER_UNI_IMAGE_RESULT_CONTEXT");
  const ids = readDenseArray(fields.message_object_ids, 64);
  if (ids.length === 0 || ids.some((id) => !isSafeId(id)) || new Set(ids).size !== ids.length) throw new TypeError("INVALID_OWNER_UNI_IMAGE_RESULT_CONTEXT");
  return Object.freeze({
    chat_uuid: fields.chat_uuid, provider_chat_id: fields.provider_chat_id, owner_echo_message_id: fields.owner_echo_message_id,
    message_id: fields.message_id, model_id: fields.model_id as OwnerUniImageModel, message_object_ids: Object.freeze([...ids]) as readonly string[],
    profile_id: "owner-uni-image-source-profile-v1", catalog_version: fields.catalog_version,
    profile_schema_hash: fields.profile_schema_hash, request_fingerprint: fields.request_fingerprint, intent_fingerprint: fields.intent_fingerprint
  });
}

function isUniModel(value: unknown): value is OwnerUniImageModel {
  return value === "uni-1" || value === "uni-1.1-modify-image" || value === "uni-1.1-remove-background";
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_IDENTIFIER.test(value); }
function isSha256(value: unknown): value is string { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value); }
function providerId(value: unknown): string | undefined {
  if (typeof value === "string") return SAFE_IDENTIFIER.test(value) ? value : undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}
function provenance(): Provenance {
  return Object.freeze({ result_count_confidence: OWNER_UNI_IMAGE_RESULT_COUNT_CONFIDENCE,
    model_confidence: "PRIVATE_PROFILE_CONTEXT_NOT_PROVIDER_PROOF", backend_acceptance: "UNPROVEN" });
}
function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) throw new TypeError();
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
    if (typeof key !== "string" || !("value" in descriptors[key]!)) return null;
    result[key] = descriptors[key]!.value;
  }
  return result;
}
function readDenseArray(value: unknown, maximum: number): unknown[] {
  const result = readArrayLoose(value);
  if (!result || result.length > maximum) throw new TypeError();
  return result;
}
function readArrayLoose(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 64) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
       !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) return null;
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]?.value);
}
function inferImageMimeType(value: string): InternalOwnerUniImageResultArtifact["mime_type"] {
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
