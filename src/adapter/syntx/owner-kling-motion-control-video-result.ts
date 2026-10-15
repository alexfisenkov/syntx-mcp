import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const MODEL_ID = "kling_motion_control" as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_CHAT_ID = /^[1-9]\d{0,15}$/u;
const MAX_RESULT_OBJECTS = 64;

export interface OwnerKlingMotionControlVideoResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
}

export interface OwnerKlingMotionControlReadyVideo {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/webm" | null;
  readonly mime_source: "URL_EXTENSION_LOCAL_POLICY" | "UNKNOWN";
}

export type OwnerKlingMotionControlVideoResultGapCode =
  | "ENVELOPE_SHAPE_INVALID" | "OUTER_MESSAGE_ID_MISMATCH" | "NOT_BOT_MESSAGE" | "PROVIDER_CHAT_ID_MISMATCH"
  | "UNRECOGNIZED_MESSAGE_FIELDS" | "MESSAGE_OBJECT_ARRAY_INVALID" | "MESSAGE_OBJECT_ARRAY_EMPTY" | "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT"
  | "UNRECOGNIZED_OBJECT_FIELDS" | "OBJECT_ENTRY_INVALID" | "OBJECT_ID_UNAVAILABLE" | "OBJECT_ID_DUPLICATE" | "OBJECT_ID_UNEXPECTED"
  | "EXPECTED_OBJECT_ID_MISSING" | "OBJECT_ID_ORDER_MISMATCH" | "CHILD_MESSAGE_ID_MISMATCH" | "OBJECT_TYPE_UNSUPPORTED" | "OBJECT_INCOMPLETE"
  | "OBJECT_COMPLETION_UNKNOWN" | "OBJECT_URL_MISSING" | "OBJECT_URL_UNSAFE" | "MODEL_ECHO_UNKNOWN" | "MODEL_ECHO_MISMATCH";

export interface OwnerKlingMotionControlVideoResultGap {
  readonly object_index: number | null;
  readonly code: OwnerKlingMotionControlVideoResultGapCode;
}

export interface OwnerKlingMotionControlVideoResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly result_status: "OBSERVED" | "PENDING" | "BACKEND_ERROR_OBSERVED" | "UNVERIFIED";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly backend_error_observed: boolean;
  readonly ready_videos: readonly Readonly<OwnerKlingMotionControlReadyVideo>[];
  readonly gaps: readonly Readonly<OwnerKlingMotionControlVideoResultGap>[];
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
}

interface DataRecord { readonly values: Readonly<Record<string, unknown>>; readonly unknownFieldCount: number }
type ArrayRead = Readonly<{ status: "OK"; values: readonly unknown[] }> | Readonly<{ status: "INVALID" }> | Readonly<{ status: "OVER_LIMIT" }>;

/** Decodes one exact native-chat result shape; local expected identities do not establish provider acceptance. */
export function decodeOwnerKlingMotionControlVideoResult(rawInput: unknown, contextInput: unknown): OwnerKlingMotionControlVideoResult {
  const context = snapshotContext(contextInput);
  const raw = readRecord(rawInput, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
  if (!raw) return unverified([gap(null, "ENVELOPE_SHAPE_INVALID")]);
  if (providerId(raw.values.id) !== context.message_id) return unverified([gap(null, "OUTER_MESSAGE_ID_MISMATCH")]);
  if (raw.values.author_id !== -1) return unverified([gap(null, "NOT_BOT_MESSAGE")]);
  if (providerChatId(raw.values.chat_id) !== context.provider_chat_id) return unverified([gap(null, "PROVIDER_CHAT_ID_MISMATCH")]);

  const gaps: OwnerKlingMotionControlVideoResultGap[] = [];
  if (raw.unknownFieldCount > 0) gaps.push(gap(null, "UNRECOGNIZED_MESSAGE_FIELDS"));
  const objects = readArray(raw.values.message_object, MAX_RESULT_OBJECTS);
  if (objects.status === "INVALID") return bound("UNKNOWN", "UNVERIFIED", false, [], [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_INVALID")]);
  if (objects.status === "OVER_LIMIT") return bound("UNKNOWN", "UNVERIFIED", false, [], [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT")]);
  if (objects.values.length === 0) gaps.push(gap(null, "MESSAGE_OBJECT_ARRAY_EMPTY"));

  const ready: OwnerKlingMotionControlReadyVideo[] = [];
  const observedIds = new Set<string>();
  const invalidIds = new Set<string>();
  let expectedVideoEcho = false;
  let unknownVideoEcho = false;
  let mismatchedVideoEcho = false;
  let pending = objects.values.length === 0;
  let backendErrorObserved = false;
  let nextExpectedIndex = 0;
  let orderInvalid = false;
  for (let index = 0; index < objects.values.length; index += 1) {
    const object = readRecord(objects.values[index], ["id", "message_id", "object_type", "object_url", "completed", "model_type"],
      ["object_text", "created_at", "updated_at", "task_id", "metadata"]);
    if (!object) { gaps.push(gap(index, "OBJECT_ENTRY_INVALID")); pending = true; continue; }
    if (object.unknownFieldCount > 0) gaps.push(gap(index, "UNRECOGNIZED_OBJECT_FIELDS"));
    const objectId = providerId(object.values.id);
    if (!objectId) { gaps.push(gap(index, "OBJECT_ID_UNAVAILABLE")); pending = true; continue; }
    if (observedIds.has(objectId)) {
      invalidIds.add(objectId);
      gaps.push(gap(index, "OBJECT_ID_DUPLICATE")); pending = true;
      continue;
    }
    observedIds.add(objectId);
    if (providerId(object.values.message_id) !== context.message_id) { gaps.push(gap(index, "CHILD_MESSAGE_ID_MISMATCH")); pending = true; continue; }
    if (!context.message_object_ids.includes(objectId)) { gaps.push(gap(index, "OBJECT_ID_UNEXPECTED")); pending = true; continue; }
    const expectedIndex = context.message_object_ids.indexOf(objectId);
    const inOrder = expectedIndex === nextExpectedIndex;
    if (!inOrder) { invalidIds.add(objectId); orderInvalid = true; gaps.push(gap(index, "OBJECT_ID_ORDER_MISMATCH")); pending = true; }
    else nextExpectedIndex += 1;

    if (object.values.object_type === "error") {
      // Count only an explicit error with the exact expected child ID and its
      // position; unexpected, duplicate, or reordered error objects are not evidence.
      if (inOrder && object.values.model_type === MODEL_ID) backendErrorObserved = true;
      if (object.values.model_type !== MODEL_ID && object.values.model_type !== undefined && object.values.model_type !== null) gaps.push(gap(index, "MODEL_ECHO_MISMATCH"));
      else gaps.push(gap(index, "MODEL_ECHO_UNKNOWN"));
      continue;
    }
    if (object.values.object_type !== "video") { gaps.push(gap(index, "OBJECT_TYPE_UNSUPPORTED")); pending = true; continue; }
    if (object.values.model_type === undefined || object.values.model_type === null) {
      unknownVideoEcho = true; gaps.push(gap(index, "MODEL_ECHO_UNKNOWN")); pending = true; continue;
    }
    if (object.values.model_type !== MODEL_ID) {
      mismatchedVideoEcho = true; gaps.push(gap(index, "MODEL_ECHO_MISMATCH")); pending = true; continue;
    }
    expectedVideoEcho = true;
    if (object.values.completed !== true) {
      gaps.push(gap(index, object.values.completed === false ? "OBJECT_INCOMPLETE" : "OBJECT_COMPLETION_UNKNOWN")); pending = true; continue;
    }
    if (typeof object.values.object_url !== "string" || object.values.object_url.length === 0) {
      gaps.push(gap(index, "OBJECT_URL_MISSING")); pending = true; continue;
    }
    if (!isSafeUploadReferenceUrl(object.values.object_url)) { gaps.push(gap(index, "OBJECT_URL_UNSAFE")); pending = true; continue; }
    if (invalidIds.has(objectId) || !inOrder) continue;
    const mimeType = inferVideoMimeType(object.values.object_url);
    ready.push(Object.freeze({ object_index: index, message_object_id: objectId, object_type: "video", object_url: object.values.object_url,
      mime_type: mimeType, mime_source: mimeType === null ? "UNKNOWN" : "URL_EXTENSION_LOCAL_POLICY" }));
  }

  for (const expectedId of context.message_object_ids) {
    if (!observedIds.has(expectedId)) { gaps.push(gap(null, "EXPECTED_OBJECT_ID_MISSING")); pending = true; }
  }
  for (let index = ready.length - 1; index >= 0; index -= 1) {
    if (orderInvalid || invalidIds.has(ready[index]!.message_object_id)) ready.splice(index, 1);
  }
  const modelEcho = mismatchedVideoEcho ? "MISMATCH" : unknownVideoEcho || !expectedVideoEcho ? "UNKNOWN" : "MATCHED";
  const status = backendErrorObserved ? "BACKEND_ERROR_OBSERVED" : pending ? "PENDING" : ready.length > 0 ? "OBSERVED" : "UNVERIFIED";
  return bound(modelEcho, status, backendErrorObserved, ready, gaps);
}

function snapshotContext(value: unknown): Readonly<OwnerKlingMotionControlVideoResultReadContext> {
  const record = readRecord(value, ["chat_uuid", "message_id", "model_id", "provider_chat_id", "message_object_ids"]);
  if (!record || record.unknownFieldCount !== 0 || !isSafeId(record.values.chat_uuid) || !isSafeId(record.values.message_id) ||
      record.values.model_id !== MODEL_ID || !isSafeChatId(record.values.provider_chat_id)) throw new TypeError("INVALID_KLING_MOTION_CONTROL_VIDEO_RESULT_CONTEXT");
  const ids = readArray(record.values.message_object_ids, MAX_RESULT_OBJECTS);
  if (ids.status !== "OK" || ids.values.length === 0 || ids.values.some((id) => !isSafeId(id)) || new Set(ids.values).size !== ids.values.length) {
    throw new TypeError("INVALID_KLING_MOTION_CONTROL_VIDEO_RESULT_CONTEXT");
  }
  return Object.freeze({ chat_uuid: record.values.chat_uuid, message_id: record.values.message_id, model_id: MODEL_ID,
    provider_chat_id: record.values.provider_chat_id, message_object_ids: Object.freeze([...ids.values]) as readonly string[] });
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
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}
function providerChatId(value: unknown): string | undefined { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : undefined; }
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSafeChatId(value: unknown): value is string { return typeof value === "string" && SAFE_CHAT_ID.test(value); }
function inferVideoMimeType(value: string): OwnerKlingMotionControlReadyVideo["mime_type"] {
  let pathname: string;
  try { pathname = new URL(value).pathname; } catch { return null; }
  const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(pathname)?.[1]?.toLowerCase();
  if (extension === "mp4") return "video/mp4";
  if (extension === "webm") return "video/webm";
  return null;
}
function gap(object_index: number | null, code: OwnerKlingMotionControlVideoResultGapCode): OwnerKlingMotionControlVideoResultGap {
  return Object.freeze({ object_index, code });
}
function bound(modelEcho: OwnerKlingMotionControlVideoResult["model_echo"], status: OwnerKlingMotionControlVideoResult["result_status"],
  backendErrorObserved: boolean, videos: readonly OwnerKlingMotionControlReadyVideo[], gaps: readonly OwnerKlingMotionControlVideoResultGap[]): OwnerKlingMotionControlVideoResult {
  return Object.freeze({ message_binding: "BOUND", model_echo: modelEcho, result_status: status, backend_error_observed: backendErrorObserved,
    status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", ready_videos: Object.freeze([...videos]), gaps: Object.freeze([...gaps]),
    backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN" });
}
function unverified(gaps: readonly OwnerKlingMotionControlVideoResultGap[]): OwnerKlingMotionControlVideoResult {
  return Object.freeze({ message_binding: "UNVERIFIED", model_echo: "UNKNOWN", result_status: "UNVERIFIED", backend_error_observed: false,
    status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", ready_videos: Object.freeze([]), gaps: Object.freeze([...gaps]),
    backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN" });
}
