import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^[1-9]\d{0,15}$/u;
const MAX_RESULT_OBJECTS = 64;

export interface OwnerKlingKeyframesVideoResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
}

export interface OwnerKlingKeyframesReadyVideo {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/webm" | null;
  readonly mime_source: "URL_EXTENSION_LOCAL_POLICY" | "UNKNOWN";
}

export type OwnerKlingKeyframesVideoResultGapCode =
  | "ENVELOPE_SHAPE_INVALID" | "OUTER_MESSAGE_ID_MISMATCH" | "NOT_BOT_MESSAGE" | "PROVIDER_CHAT_ID_MISMATCH"
  | "UNRECOGNIZED_MESSAGE_FIELDS" | "MESSAGE_OBJECT_ARRAY_INVALID" | "MESSAGE_OBJECT_ARRAY_EMPTY" | "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT"
  | "UNRECOGNIZED_OBJECT_FIELDS" | "OBJECT_ENTRY_INVALID" | "OBJECT_ID_UNAVAILABLE" | "OBJECT_ID_DUPLICATE" | "OBJECT_ID_UNEXPECTED"
  | "EXPECTED_OBJECT_ID_MISSING" | "CHILD_MESSAGE_ID_MISMATCH" | "OBJECT_TYPE_UNSUPPORTED" | "OBJECT_INCOMPLETE"
  | "OBJECT_COMPLETION_UNKNOWN" | "OBJECT_URL_MISSING" | "OBJECT_URL_UNSAFE" | "MODEL_ECHO_UNKNOWN" | "MODEL_ECHO_MISMATCH";

export interface OwnerKlingKeyframesVideoResultGap {
  readonly object_index: number | null;
  readonly code: OwnerKlingKeyframesVideoResultGapCode;
}

export interface OwnerKlingKeyframesVideoResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly ready_videos: readonly Readonly<OwnerKlingKeyframesReadyVideo>[];
  readonly gaps: readonly Readonly<OwnerKlingKeyframesVideoResultGap>[];
  readonly backend_acceptance: "UNPROVEN";
}

interface DataRecord { readonly values: Readonly<Record<string, unknown>>; readonly unknownFieldCount: number }
type ArrayRead = Readonly<{ status: "OK"; values: readonly unknown[] }> | Readonly<{ status: "INVALID" }> | Readonly<{ status: "OVER_LIMIT" }>;

/** Decodes one exact future message read; a local model echo is not provider-format evidence or generation authority. */
export function decodeOwnerKlingKeyframesVideoResult(rawInput: unknown, contextInput: unknown): OwnerKlingKeyframesVideoResult {
  const context = snapshotContext(contextInput);
  const raw = readRecord(rawInput, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
  if (!raw) return unverified([gap(null, "ENVELOPE_SHAPE_INVALID")]);
  if (providerId(raw.values.id) !== context.message_id) return unverified([gap(null, "OUTER_MESSAGE_ID_MISMATCH")]);
  if (raw.values.author_id !== -1) return unverified([gap(null, "NOT_BOT_MESSAGE")]);
  if (providerChatId(raw.values.chat_id) !== context.provider_chat_id) return unverified([gap(null, "PROVIDER_CHAT_ID_MISMATCH")]);

  const gaps: OwnerKlingKeyframesVideoResultGap[] = [];
  if (raw.unknownFieldCount > 0) gaps.push(gap(null, "UNRECOGNIZED_MESSAGE_FIELDS"));
  const objects = readArray(raw.values.message_object, MAX_RESULT_OBJECTS);
  if (objects.status === "INVALID") return bound("UNKNOWN", [], [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_INVALID")]);
  if (objects.status === "OVER_LIMIT") return bound("UNKNOWN", [], [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT")]);
  if (objects.values.length === 0) gaps.push(gap(null, "MESSAGE_OBJECT_ARRAY_EMPTY"));

  const ready: OwnerKlingKeyframesReadyVideo[] = [];
  const observedIds = new Set<string>();
  let sawExpectedModelEcho = false;
  let sawUnknownModelEcho = false;
  let sawMismatchedModelEcho = false;
  for (let index = 0; index < objects.values.length; index += 1) {
    const object = readRecord(objects.values[index], ["id", "message_id", "object_type", "object_url", "completed", "model_type"],
      ["object_text", "created_at", "updated_at", "task_id", "metadata"]);
    if (!object) { gaps.push(gap(index, "OBJECT_ENTRY_INVALID")); continue; }
    if (object.unknownFieldCount > 0) gaps.push(gap(index, "UNRECOGNIZED_OBJECT_FIELDS"));
    const objectId = providerId(object.values.id);
    if (!objectId) { gaps.push(gap(index, "OBJECT_ID_UNAVAILABLE")); continue; }
    if (observedIds.has(objectId)) { gaps.push(gap(index, "OBJECT_ID_DUPLICATE")); continue; }
    observedIds.add(objectId);
    if (!context.message_object_ids.includes(objectId)) { gaps.push(gap(index, "OBJECT_ID_UNEXPECTED")); continue; }
    if (providerId(object.values.message_id) !== context.message_id) { gaps.push(gap(index, "CHILD_MESSAGE_ID_MISMATCH")); continue; }
    if (object.values.object_type !== "video") { gaps.push(gap(index, "OBJECT_TYPE_UNSUPPORTED")); continue; }
    if (object.values.model_type === undefined || object.values.model_type === null) {
      sawUnknownModelEcho = true;
      gaps.push(gap(index, "MODEL_ECHO_UNKNOWN")); continue;
    }
    if (object.values.model_type !== "kling_keyframes") {
      sawMismatchedModelEcho = true; gaps.push(gap(index, "MODEL_ECHO_MISMATCH")); continue;
    }
    sawExpectedModelEcho = true;
    if (object.values.completed !== true) { gaps.push(gap(index, object.values.completed === false ? "OBJECT_INCOMPLETE" : "OBJECT_COMPLETION_UNKNOWN")); continue; }
    if (typeof object.values.object_url !== "string" || object.values.object_url.length === 0) { gaps.push(gap(index, "OBJECT_URL_MISSING")); continue; }
    if (!isSafeUploadReferenceUrl(object.values.object_url)) { gaps.push(gap(index, "OBJECT_URL_UNSAFE")); continue; }
    const mimeType = inferVideoMimeType(object.values.object_url);
    ready.push(Object.freeze({ object_index: index, message_object_id: objectId, object_type: "video", object_url: object.values.object_url,
      mime_type: mimeType, mime_source: mimeType === null ? "UNKNOWN" : "URL_EXTENSION_LOCAL_POLICY" }));
  }
  for (const expectedId of context.message_object_ids) if (!observedIds.has(expectedId)) gaps.push(gap(null, "EXPECTED_OBJECT_ID_MISSING"));
  const modelEcho = sawMismatchedModelEcho ? "MISMATCH" : sawUnknownModelEcho || !sawExpectedModelEcho ? "UNKNOWN" : "MATCHED";
  return bound(modelEcho, ready, gaps);
}

function snapshotContext(value: unknown): Readonly<OwnerKlingKeyframesVideoResultReadContext> {
  const record = readRecord(value, ["chat_uuid", "message_id", "provider_chat_id", "message_object_ids"]);
  if (!record || record.unknownFieldCount !== 0 || !isSafeId(record.values.chat_uuid) || !isSafeId(record.values.message_id) ||
      !isSafeProviderChatId(record.values.provider_chat_id)) throw new TypeError("INVALID_KLING_KEYFRAMES_VIDEO_RESULT_CONTEXT");
  const ids = readArray(record.values.message_object_ids, MAX_RESULT_OBJECTS);
  if (ids.status !== "OK" || ids.values.length === 0 || ids.values.some((id) => !isSafeId(id)) || new Set(ids.values).size !== ids.values.length) {
    throw new TypeError("INVALID_KLING_KEYFRAMES_VIDEO_RESULT_CONTEXT");
  }
  return Object.freeze({ chat_uuid: record.values.chat_uuid, message_id: record.values.message_id, provider_chat_id: record.values.provider_chat_id,
    message_object_ids: Object.freeze([...ids.values]) as readonly string[] });
}

function readRecord(value: unknown, knownKeys: readonly string[], recognizedUnconsumedKeys: readonly string[] = []): DataRecord | null {
  try {
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
  } catch { return null; }
}

function readArray(value: unknown, maximum: number): ArrayRead {
  try {
    if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return Object.freeze({ status: "INVALID" });
    if (value.length > maximum) return Object.freeze({ status: "OVER_LIMIT" });
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
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
  } catch { return Object.freeze({ status: "INVALID" }); }
}

function providerId(value: unknown): string | undefined {
  if (typeof value === "string") return isSafeId(value) ? value : undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return undefined;
}
function providerChatId(value: unknown): string | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSafeProviderChatId(value: unknown): value is string { return typeof value === "string" && SAFE_PROVIDER_CHAT_ID.test(value); }
function inferVideoMimeType(value: string): OwnerKlingKeyframesReadyVideo["mime_type"] {
  let pathname: string;
  try { pathname = new URL(value).pathname; } catch { return null; }
  const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(pathname)?.[1]?.toLowerCase();
  if (extension === "mp4") return "video/mp4";
  if (extension === "webm") return "video/webm";
  return null;
}
function gap(object_index: number | null, code: OwnerKlingKeyframesVideoResultGapCode): OwnerKlingKeyframesVideoResultGap {
  return Object.freeze({ object_index, code });
}
function bound(modelEcho: OwnerKlingKeyframesVideoResult["model_echo"], videos: readonly OwnerKlingKeyframesReadyVideo[],
  gaps: readonly OwnerKlingKeyframesVideoResultGap[]): OwnerKlingKeyframesVideoResult {
  return Object.freeze({ message_binding: "BOUND", model_echo: modelEcho, ready_videos: Object.freeze([...videos]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
function unverified(gaps: readonly OwnerKlingKeyframesVideoResultGap[]): OwnerKlingKeyframesVideoResult {
  return Object.freeze({ message_binding: "UNVERIFIED", model_echo: "UNKNOWN", ready_videos: Object.freeze([]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
