import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import type { OwnerSeedreamImageVariant } from "../../application/owner-seedream-image-parameters.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const MAX_URL_LENGTH = 4096;
const MAX_RESULT_OBJECTS = 64;
const VARIANTS: readonly string[] = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"];

export interface OwnerSeedreamEditorImageResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly variant: OwnerSeedreamImageVariant;
  readonly provider_chat_id?: string;
}

export interface OwnerSeedreamEditorReadyImage {
  readonly object_index: number;
  readonly object_type: "image" | "image_url";
  readonly object_url: string;
  readonly message_object_id?: string;
  readonly model_echo: "MATCHED" | "UNKNOWN";
  readonly model_type: OwnerSeedreamImageVariant | null;
  readonly mime_type: string | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly width: null;
  readonly height: null;
  readonly geometry_verified: false;
}

export type OwnerSeedreamEditorImageResultGapCode =
  | "ENVELOPE_SHAPE_INVALID" | "OUTER_MESSAGE_ID_MISMATCH" | "NOT_BOT_MESSAGE" | "PROVIDER_CHAT_ID_UNOBSERVED"
  | "PROVIDER_CHAT_ID_UNBOUND" | "PROVIDER_CHAT_ID_MISMATCH" | "UNRECOGNIZED_MESSAGE_FIELDS"
  | "MESSAGE_OBJECT_ARRAY_INVALID" | "MESSAGE_OBJECT_ARRAY_EMPTY" | "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT"
  | "UNRECOGNIZED_OBJECT_FIELDS" | "OBJECT_ENTRY_INVALID" | "OBJECT_TYPE_UNSUPPORTED" | "OBJECT_COMPLETION_UNKNOWN"
  | "OBJECT_INCOMPLETE" | "OBJECT_URL_MISSING" | "OBJECT_URL_UNSAFE" | "OBJECT_ID_UNAVAILABLE"
  | "MODEL_TYPE_UNAVAILABLE" | "MODEL_TYPE_MISMATCH" | "OBJECT_ID_DUPLICATE";

export interface OwnerSeedreamEditorImageResultGap {
  readonly object_index: number | null;
  readonly code: OwnerSeedreamEditorImageResultGapCode;
}

export interface OwnerSeedreamEditorImageResult {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly variant: OwnerSeedreamImageVariant;
  readonly provider_chat_id?: string;
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly ready_images: readonly Readonly<OwnerSeedreamEditorReadyImage>[];
  readonly gaps: readonly Readonly<OwnerSeedreamEditorImageResultGap>[];
  readonly backend_acceptance: "UNPROVEN";
}

interface DataRecord { readonly values: Readonly<Record<string, unknown>>; readonly unknownFieldCount: number }
type ArrayRead = Readonly<{ status: "OK"; values: readonly unknown[] }> | Readonly<{ status: "INVALID" }> | Readonly<{ status: "OVER_LIMIT" }>;

/** Strict local decoder for observed Seedream Editor result messages; it grants no generation authority. */
export function decodeOwnerSeedreamEditorImageResult(rawInput: unknown, contextInput: unknown): OwnerSeedreamEditorImageResult {
  const context = snapshotOwnerSeedreamEditorImageResultReadContext(contextInput);
  const raw = readRecord(rawInput, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
  if (!raw) return unverified(context, "MISMATCH", [gap(null, "ENVELOPE_SHAPE_INVALID")]);
  if (providerId(raw.values.id) !== context.message_id) return unverified(context, "MISMATCH", [gap(null, "OUTER_MESSAGE_ID_MISMATCH")]);
  if (raw.values.author_id !== -1) return unverified(context, "MISMATCH", [gap(null, "NOT_BOT_MESSAGE")]);

  const gaps: OwnerSeedreamEditorImageResultGap[] = [];
  if (raw.unknownFieldCount > 0) gaps.push(gap(null, "UNRECOGNIZED_MESSAGE_FIELDS"));
  if (!bindProviderChat(raw.values.chat_id, context, gaps)) {
    gaps.push(gap(null, "PROVIDER_CHAT_ID_MISMATCH"));
    return unverified(context, "MISMATCH", gaps);
  }
  const objects = readArray(raw.values.message_object, MAX_RESULT_OBJECTS);
  if (objects.status === "INVALID") return bound(context, "UNKNOWN", [], [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_INVALID")]);
  if (objects.status === "OVER_LIMIT") return bound(context, "UNKNOWN", [], [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT")]);
  if (objects.values.length === 0) gaps.push(gap(null, "MESSAGE_OBJECT_ARRAY_EMPTY"));

  const ready: OwnerSeedreamEditorReadyImage[] = [];
  const objectIds = new Set<string>();
  let modelEcho: OwnerSeedreamEditorImageResult["model_echo"] = "MATCHED";
  for (let index = 0; index < objects.values.length; index += 1) {
    const object = readRecord(objects.values[index], ["id", "object_type", "object_url", "completed", "model_type"],
      ["message_id", "object_text", "created_at", "updated_at", "task_id", "metadata"]);
    if (!object) { gaps.push(gap(index, "OBJECT_ENTRY_INVALID")); continue; }
    if (object.unknownFieldCount > 0) gaps.push(gap(index, "UNRECOGNIZED_OBJECT_FIELDS"));
    const messageObjectId = providerId(object.values.id);
    if (messageObjectId === undefined) gaps.push(gap(index, "OBJECT_ID_UNAVAILABLE"));
    else if (objectIds.has(messageObjectId)) { gaps.push(gap(index, "OBJECT_ID_DUPLICATE")); continue; }
    else objectIds.add(messageObjectId);
    const objectType = object.values.object_type;
    if (objectType !== "image" && objectType !== "image_url") { gaps.push(gap(index, "OBJECT_TYPE_UNSUPPORTED")); continue; }
    if (object.values.completed !== true) {
      gaps.push(gap(index, object.values.completed === false ? "OBJECT_INCOMPLETE" : "OBJECT_COMPLETION_UNKNOWN"));
      continue;
    }
    const echoedModel = object.values.model_type;
    if (echoedModel === undefined || echoedModel === null) {
      modelEcho = modelEcho === "MISMATCH" ? modelEcho : "UNKNOWN";
      gaps.push(gap(index, "MODEL_TYPE_UNAVAILABLE"));
    } else if (echoedModel !== context.variant) {
      modelEcho = "MISMATCH";
      gaps.push(gap(index, "MODEL_TYPE_MISMATCH"));
      continue;
    }
    if (typeof object.values.object_url !== "string" || object.values.object_url.length === 0) {
      gaps.push(gap(index, "OBJECT_URL_MISSING")); continue;
    }
    if (object.values.object_url.length > MAX_URL_LENGTH || !isSafeUploadReferenceUrl(object.values.object_url)) {
      gaps.push(gap(index, "OBJECT_URL_UNSAFE")); continue;
    }
    const mimeType = inferImageMimeType(object.values.object_url);
    ready.push(Object.freeze({ object_index: index, object_type: objectType, object_url: object.values.object_url,
      ...(messageObjectId === undefined ? {} : { message_object_id: messageObjectId }),
      model_echo: echoedModel === context.variant ? "MATCHED" : "UNKNOWN",
      model_type: echoedModel === context.variant ? context.variant : null,
      mime_type: mimeType, mime_source: mimeType === null ? "UNKNOWN" : "URL_EXTENSION",
      width: null, height: null, geometry_verified: false }));
  }
  if (modelEcho === "MISMATCH") return unverified(context, modelEcho, gaps);
  return bound(context, modelEcho, ready, gaps);
}

export function snapshotOwnerSeedreamEditorImageResultReadContext(value: unknown): Readonly<OwnerSeedreamEditorImageResultReadContext> {
  const record = readRecord(value, ["chat_uuid", "message_id", "variant", "provider_chat_id"]);
  if (!record || record.unknownFieldCount !== 0 || !isSafeId(record.values.chat_uuid) || !isSafeId(record.values.message_id) ||
      !isVariant(record.values.variant) || !(record.values.provider_chat_id === undefined || isSafeProviderChatId(record.values.provider_chat_id))) {
    throw new TypeError("INVALID_SEEDREAM_EDITOR_RESULT_CONTEXT");
  }
  return Object.freeze({ chat_uuid: record.values.chat_uuid, message_id: record.values.message_id, variant: record.values.variant,
    ...(record.values.provider_chat_id === undefined ? {} : { provider_chat_id: record.values.provider_chat_id }) });
}

function bindProviderChat(rawChatId: unknown, context: Readonly<OwnerSeedreamEditorImageResultReadContext>, gaps: OwnerSeedreamEditorImageResultGap[]): boolean {
  if (context.provider_chat_id === undefined) {
    if (rawChatId !== undefined) gaps.push(gap(null, "PROVIDER_CHAT_ID_UNBOUND"));
    return true;
  }
  if (rawChatId === undefined) { gaps.push(gap(null, "PROVIDER_CHAT_ID_UNOBSERVED")); return true; }
  const observed = typeof rawChatId === "number" && Number.isSafeInteger(rawChatId) && rawChatId >= 0 ? String(rawChatId) : undefined;
  return observed === context.provider_chat_id;
}
function readRecord(value: unknown, knownKeys: readonly string[], recognizedUnconsumedKeys: readonly string[] = []): DataRecord | null {
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
    else if (!recognizedUnconsumedKeys.includes(key)) unknownFieldCount += 1;
  }
  return Object.freeze({ values: Object.freeze(values), unknownFieldCount });
}
function readArray(value: unknown, maximum: number): ArrayRead {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return Object.freeze({ status: "INVALID" });
  if (value.length > maximum) return Object.freeze({ status: "OVER_LIMIT" });
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) return Object.freeze({ status: "INVALID" });
  const values: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return Object.freeze({ status: "INVALID" });
    values.push(descriptor.value);
  }
  return Object.freeze({ status: "OK", values: Object.freeze(values) });
}
function providerId(value: unknown): string | undefined {
  if (typeof value === "string") return isSafeId(value) ? value : undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSafeProviderChatId(value: unknown): value is string { return typeof value === "string" && SAFE_PROVIDER_CHAT_ID.test(value); }
function isVariant(value: unknown): value is OwnerSeedreamImageVariant { return typeof value === "string" && VARIANTS.includes(value); }
function inferImageMimeType(value: string): string | null {
  let pathname: string;
  try { pathname = new URL(value).pathname; } catch { return null; }
  const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(pathname)?.[1]?.toLowerCase();
  switch (extension) {
    case "jpg": case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "avif": return "image/avif";
    case "bmp": return "image/bmp";
    case "gif": return "image/gif";
    case "tif": case "tiff": return "image/tiff";
    case "heic": return "image/heic";
    case "heif": return "image/heif";
    default: return null;
  }
}
function gap(objectIndex: number | null, code: OwnerSeedreamEditorImageResultGapCode): OwnerSeedreamEditorImageResultGap {
  return Object.freeze({ object_index: objectIndex, code });
}
function bound(context: Readonly<OwnerSeedreamEditorImageResultReadContext>, modelEcho: OwnerSeedreamEditorImageResult["model_echo"],
  images: readonly OwnerSeedreamEditorReadyImage[], gaps: readonly OwnerSeedreamEditorImageResultGap[]): OwnerSeedreamEditorImageResult {
  return Object.freeze({ ...context, message_binding: "BOUND", model_echo: modelEcho, ready_images: Object.freeze([...images]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
function unverified(context: Readonly<OwnerSeedreamEditorImageResultReadContext>, modelEcho: OwnerSeedreamEditorImageResult["model_echo"],
  gaps: readonly OwnerSeedreamEditorImageResultGap[]): OwnerSeedreamEditorImageResult {
  return Object.freeze({ ...context, message_binding: "UNVERIFIED", model_echo: modelEcho, ready_images: Object.freeze([]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
