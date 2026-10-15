import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const MODEL_IDS = ["wan_25_i2v_preview"] as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_CHAT_ID = /^\d{1,16}$/u;
const MAX_OBJECTS = 64;
const MAX_URL_LENGTH = 4096;

export type OwnerWan25I2vModelId = typeof MODEL_IDS[number];
export interface OwnerWan25I2vVideoResultContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly model_id: OwnerWan25I2vModelId;
}
export interface OwnerWan25I2vReadyVideo {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/webm" | null;
  readonly mime_source: "URL_EXTENSION_LOCAL_POLICY" | "UNKNOWN";
  readonly model_echo: "MATCHED" | "UNKNOWN";
}
export type OwnerWan25I2vResultGapCode =
  | "ENVELOPE_SHAPE_INVALID" | "OUTER_MESSAGE_ID_MISMATCH" | "NOT_BOT_MESSAGE" | "PROVIDER_CHAT_ID_MISMATCH"
  | "UNRECOGNIZED_MESSAGE_FIELDS" | "MESSAGE_OBJECT_ARRAY_INVALID" | "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT"
  | "MESSAGE_OBJECT_ARRAY_EMPTY" | "OBJECT_ENTRY_INVALID" | "UNRECOGNIZED_OBJECT_FIELDS" | "OBJECT_ID_UNAVAILABLE"
  | "OBJECT_ID_DUPLICATE" | "OBJECT_ID_UNEXPECTED" | "OBJECT_MESSAGE_ID_MISMATCH" | "OBJECT_TYPE_UNSUPPORTED"
  | "OBJECT_ORDER_MISMATCH" | "MODEL_ECHO_MISMATCH" | "MODEL_ECHO_UNAVAILABLE" | "OBJECT_NOT_COMPLETED" | "RESULT_COMPLETION_FLAG_INVALID"
  | "RESULT_URL_PENDING" | "RESULT_URL_UNSAFE" | "EXPECTED_OBJECT_ID_MISSING";
export interface OwnerWan25I2vVideoResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly result_status: "OBSERVED" | "PENDING" | "BACKEND_ERROR_OBSERVED" | "UNVERIFIED";
  readonly backend_error_observed: boolean;
  readonly ready_videos: readonly OwnerWan25I2vReadyVideo[];
  readonly pending_object_indices: readonly number[];
  readonly gaps: readonly Readonly<{ object_index: number | null; code: OwnerWan25I2vResultGapCode }>[];
  readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
}

/** Pure decoder for a caller-supplied chat/message read; context is correlation input, not GET authority. */
export function decodeOwnerWan25I2vVideoResult(rawInput: unknown, expectedInput: unknown): OwnerWan25I2vVideoResult {
  const expected = snapshotContext(expectedInput);
  const gaps: { object_index: number | null; code: OwnerWan25I2vResultGapCode }[] = [];
  const unverified = (code: OwnerWan25I2vResultGapCode): OwnerWan25I2vVideoResult =>
    result("UNVERIFIED", "UNKNOWN", "UNVERIFIED", false, [], [], [{ object_index: null, code }]);
  if (!hasSafeDataGraph(rawInput)) return unverified("ENVELOPE_SHAPE_INVALID");
  const raw = readRecord(rawInput, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
  if (!raw) return unverified("ENVELOPE_SHAPE_INVALID");
  if (providerId(raw.values.id) !== expected.message_id) return unverified("OUTER_MESSAGE_ID_MISMATCH");
  if (raw.values.author_id !== -1) return unverified("NOT_BOT_MESSAGE");
  if (providerChatId(raw.values.chat_id) !== expected.provider_chat_id) return unverified("PROVIDER_CHAT_ID_MISMATCH");
  if (raw.unknownFieldCount) gaps.push({ object_index: null, code: "UNRECOGNIZED_MESSAGE_FIELDS" });

  const array = readArray(raw.values.message_object, MAX_OBJECTS);
  if (array.status === "INVALID") return unverified("MESSAGE_OBJECT_ARRAY_INVALID");
  if (array.status === "OVER_LIMIT") return unverified("MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT");
  if (array.values.length === 0) gaps.push({ object_index: null, code: "MESSAGE_OBJECT_ARRAY_EMPTY" });

  const expectedIds = new Set(expected.message_object_ids);
  const seen = new Set<string>();
  const observedExpected = new Set<string>();
  const videos: OwnerWan25I2vReadyVideo[] = [];
  const pending: number[] = [];
  let sawTargetModelEcho = false;
  let unknownModelEcho = false;
  let mismatchedModelEcho = false;
  let backendErrorObserved = false;
  let nextExpectedIndex = 0;
  let orderMismatch = false;
  for (let index = 0; index < array.values.length; index += 1) {
    const object = readRecord(array.values[index], ["id", "message_id", "object_type"],
      ["model_type", "object_text", "completed", "object_url", "created_at", "updated_at", "task_id", "metadata"]);
    if (!object) { gaps.push({ object_index: index, code: "OBJECT_ENTRY_INVALID" }); continue; }
    if (object.unknownFieldCount) gaps.push({ object_index: index, code: "UNRECOGNIZED_OBJECT_FIELDS" });
    const id = providerId(object.values.id);
    if (!id) { gaps.push({ object_index: index, code: "OBJECT_ID_UNAVAILABLE" }); continue; }
    if (seen.has(id)) { gaps.push({ object_index: index, code: "OBJECT_ID_DUPLICATE" }); continue; }
    seen.add(id);
    if (!expectedIds.has(id)) { gaps.push({ object_index: index, code: "OBJECT_ID_UNEXPECTED" }); continue; }
    if (providerId(object.values.message_id) !== expected.message_id) {
      gaps.push({ object_index: index, code: "OBJECT_MESSAGE_ID_MISMATCH" }); continue;
    }
    observedExpected.add(id);
    const expectedIndex = expected.message_object_ids.indexOf(id);
    const inOrder = !orderMismatch && expectedIndex === nextExpectedIndex;
    if (!inOrder) { orderMismatch = true; gaps.push({ object_index: index, code: "OBJECT_ORDER_MISMATCH" }); }
    else nextExpectedIndex += 1;
    if (object.values.object_type === "error") {
      if (inOrder && object.values.model_type === expected.model_id) {
        backendErrorObserved = true;
        sawTargetModelEcho = true;
      }
      else if (object.values.model_type === undefined || object.values.model_type === null || object.values.model_type === "") {
        unknownModelEcho = true;
        gaps.push({ object_index: index, code: "MODEL_ECHO_UNAVAILABLE" });
      } else if (object.values.model_type !== expected.model_id) {
        mismatchedModelEcho = true;
        gaps.push({ object_index: index, code: "MODEL_ECHO_MISMATCH" });
      }
      continue;
    }
    if (object.values.object_type !== "video") { gaps.push({ object_index: index, code: "OBJECT_TYPE_UNSUPPORTED" }); continue; }
    const modelEcho = object.values.model_type;
    if (modelEcho === undefined || modelEcho === null || modelEcho === "") {
      unknownModelEcho = true;
      gaps.push({ object_index: index, code: "MODEL_ECHO_UNAVAILABLE" });
    } else if (modelEcho !== expected.model_id) {
      mismatchedModelEcho = true;
      gaps.push({ object_index: index, code: "MODEL_ECHO_MISMATCH" });
      continue;
    } else {
      sawTargetModelEcho = true;
    }
    if (!inOrder) continue;
    if (object.values.completed === false) {
      pending.push(index);
      gaps.push({ object_index: index, code: "OBJECT_NOT_COMPLETED" });
      continue;
    }
    if (object.values.completed !== true) { gaps.push({ object_index: index, code: "RESULT_COMPLETION_FLAG_INVALID" }); continue; }
    const url = object.values.object_url;
    if (url === null || url === undefined || url === "") {
      pending.push(index);
      gaps.push({ object_index: index, code: "RESULT_URL_PENDING" });
      continue;
    }
    if (typeof url !== "string" || url.length > MAX_URL_LENGTH || !isSafeUploadReferenceUrl(url)) {
      gaps.push({ object_index: index, code: "RESULT_URL_UNSAFE" });
      continue;
    }
    const mime = inferVideoMime(url);
    videos.push(Object.freeze({ object_index: index, message_object_id: id, object_type: "video", object_url: url,
      mime_type: mime, mime_source: mime ? "URL_EXTENSION_LOCAL_POLICY" : "UNKNOWN",
      model_echo: modelEcho === expected.model_id ? "MATCHED" : "UNKNOWN" }));
  }
  for (const id of expected.message_object_ids) {
    if (!observedExpected.has(id)) gaps.push({ object_index: null, code: "EXPECTED_OBJECT_ID_MISSING" });
  }
  const orderedVideos = orderMismatch ? [] : expected.message_object_ids.flatMap((id) => {
    const video = videos.find((item) => item.message_object_id === id);
    return video ? [video] : [];
  });
  const status = backendErrorObserved ? "BACKEND_ERROR_OBSERVED" : pending.length > 0 ? "PENDING" :
    orderedVideos.length > 0 ? "OBSERVED" : "UNVERIFIED";
  const echo = mismatchedModelEcho ? "MISMATCH" : unknownModelEcho || !sawTargetModelEcho ? "UNKNOWN" : "MATCHED";
  return result("BOUND", echo, status, backendErrorObserved, orderedVideos, pending, gaps);
}

function result(binding: OwnerWan25I2vVideoResult["message_binding"], echo: OwnerWan25I2vVideoResult["model_echo"],
  status: OwnerWan25I2vVideoResult["result_status"], backendErrorObserved: boolean,
  videos: readonly OwnerWan25I2vReadyVideo[], pending: readonly number[],
  gaps: readonly { object_index: number | null; code: OwnerWan25I2vResultGapCode }[]): OwnerWan25I2vVideoResult {
  return Object.freeze({ message_binding: binding, model_echo: echo, result_status: status, backend_error_observed: backendErrorObserved,
    ready_videos: Object.freeze([...videos]),
    pending_object_indices: Object.freeze([...pending]), gaps: Object.freeze(gaps.map((gap) => Object.freeze({ ...gap }))),
    provider_terminal_status: "UNPROVEN", backend_acceptance: "UNPROVEN", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY" });
}
function snapshotContext(input: unknown): Readonly<OwnerWan25I2vVideoResultContext> {
  if (!hasSafeDataGraph(input)) throw new TypeError("INVALID_OWNER_WAN25_I2V_VIDEO_RESULT_CONTEXT");
  const record = readRecord(input, ["chat_uuid", "message_id", "provider_chat_id", "message_object_ids", "model_id"]);
  if (!record || record.unknownFieldCount || !isSafeId(record.values.chat_uuid) || !isSafeId(record.values.message_id) ||
      !isSafeChatId(record.values.provider_chat_id) || !MODEL_IDS.includes(record.values.model_id as OwnerWan25I2vModelId)) {
    throw new TypeError("INVALID_OWNER_WAN25_I2V_VIDEO_RESULT_CONTEXT");
  }
  const ids = readArray(record.values.message_object_ids, MAX_OBJECTS);
  if (ids.status !== "OK" || ids.values.length === 0 || ids.values.length > MAX_OBJECTS ||
      ids.values.some((id) => !isSafeId(id)) || new Set(ids.values).size !== ids.values.length) {
    throw new TypeError("INVALID_OWNER_WAN25_I2V_VIDEO_RESULT_CONTEXT");
  }
  return Object.freeze({ chat_uuid: record.values.chat_uuid as string, message_id: record.values.message_id as string,
    provider_chat_id: record.values.provider_chat_id as string, message_object_ids: Object.freeze(ids.values as string[]),
    model_id: record.values.model_id as OwnerWan25I2vModelId });
}
function hasSafeDataGraph(root: unknown): boolean {
  const active = new Set<object>(); let count = 0;
  const visit = (value: unknown, depth: number): boolean => {
    if (value === null || typeof value !== "object") return true;
    if (depth > 8 || ++count > 512 || types.isProxy(value) || active.has(value)) return false;
    if (!Array.isArray(value)) { const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) return false; }
    else if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key as keyof typeof descriptors];
      if (Array.isArray(value) && key === "length") continue;
      if (typeof key !== "string" || !descriptor || !("value" in descriptor) || descriptor.enumerable !== true ||
          !visit(descriptor.value, depth + 1)) { active.delete(value); return false; }
    }
    active.delete(value); return true;
  };
  try { return visit(root, 0); } catch { return false; }
}
function readRecord(value: unknown, required: readonly string[], optional: readonly string[] = []):
  { values: Record<string, unknown>; unknownFieldCount: number } | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
    const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value); const values = Object.create(null) as Record<string, unknown>;
    let unknownFieldCount = 0;
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key as keyof typeof descriptors];
      if (typeof key !== "string" || !descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
      if (!required.includes(key) && !optional.includes(key)) { unknownFieldCount += 1; continue; }
      values[key] = descriptor.value;
    }
    if (required.some((key) => !Object.hasOwn(values, key))) return null;
    return { values, unknownFieldCount };
  } catch { return null; }
}
function readArray(value: unknown, maximum: number): { status: "OK"; values: unknown[] } | { status: "INVALID" | "OVER_LIMIT"; values: [] } {
  try {
    if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return { status: "INVALID", values: [] };
    if (value.length > maximum) return { status: "OVER_LIMIT", values: [] };
    const descriptors = Object.getOwnPropertyDescriptors(value); const own = Reflect.ownKeys(descriptors);
    if (own.length !== value.length + 1 || !own.includes("length") || own.some((key) => key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
          !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) return { status: "INVALID", values: [] };
    const values: unknown[] = []; for (let i = 0; i < value.length; i += 1) values.push(descriptors[String(i)]!.value);
    return { status: "OK", values };
  } catch { return { status: "INVALID", values: [] }; }
}
function providerId(value: unknown): string | undefined {
  if (typeof value === "string") return isSafeId(value) ? value : undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}
function providerChatId(value: unknown): string | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && String(value).length <= 16 ? String(value) : undefined;
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSafeChatId(value: unknown): value is string { return typeof value === "string" && SAFE_CHAT_ID.test(value); }
function inferVideoMime(value: string): "video/mp4" | "video/webm" | null {
  let pathname: string; try { pathname = new URL(value).pathname; } catch { return null; }
  const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(pathname)?.[1]?.toLowerCase();
  return extension === "mp4" ? "video/mp4" : extension === "webm" ? "video/webm" : null;
}
