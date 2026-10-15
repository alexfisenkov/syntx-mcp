import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const MAX_RESULT_OBJECTS = 64;
// First/Last Frame reuses only this strict native result reader. Its write
// lifecycle and MCP model policy remain in a separate owner-bound service.
const WAN_T2V_MODELS = ["wan_26_t2v", "wan_27_t2v", "wan_30_t2v", "wan_30_first_last_frame"] as const;

export type OwnerWanT2vModelId = typeof WAN_T2V_MODELS[number];

export interface OwnerWanT2vVideoResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: OwnerWanT2vModelId;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
}

export interface OwnerWanT2vReadyVideo {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/quicktime" | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
}

export type OwnerWanT2vVideoResultGapCode =
  | "ENVELOPE_SHAPE_INVALID" | "OUTER_MESSAGE_ID_MISMATCH" | "NOT_BOT_MESSAGE" | "PROVIDER_CHAT_ID_MISMATCH"
  | "UNRECOGNIZED_MESSAGE_FIELDS" | "MESSAGE_OBJECT_ARRAY_INVALID" | "MESSAGE_OBJECT_ARRAY_EMPTY"
  | "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT" | "UNRECOGNIZED_OBJECT_FIELDS" | "OBJECT_ENTRY_INVALID"
  | "OBJECT_ID_UNAVAILABLE" | "OBJECT_ID_DUPLICATE" | "OBJECT_ID_UNEXPECTED" | "EXPECTED_OBJECT_ID_MISSING"
  | "CHILD_MESSAGE_ID_MISMATCH" | "OBJECT_TYPE_UNSUPPORTED" | "OBJECT_INCOMPLETE" | "OBJECT_COMPLETION_UNKNOWN"
  | "OBJECT_URL_MISSING" | "OBJECT_URL_UNSAFE" | "MODEL_TYPE_UNAVAILABLE" | "MODEL_TYPE_MISMATCH";

export interface OwnerWanT2vVideoResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly ready_videos: readonly Readonly<OwnerWanT2vReadyVideo>[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

interface DataRecord { readonly values: Readonly<Record<string, unknown>>; readonly unknownFieldCount: number }
type ArrayRead = Readonly<{ status: "OK"; values: readonly unknown[] }> | Readonly<{ status: "INVALID" }> | Readonly<{ status: "OVER_LIMIT" }>;

/** Strict result-only decoder; binding an observed message grants no generation authority or provider-completion claim. */
export function decodeOwnerWanT2vVideoResult(rawInput: unknown, contextInput: unknown): OwnerWanT2vVideoResult {
  const context = snapshotContext(contextInput);
  const raw = readRecord(rawInput, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
  if (!raw) return unverified("MISMATCH", [gap(null, "ENVELOPE_SHAPE_INVALID")]);
  if (providerId(raw.values.id) !== context.message_id) return unverified("MISMATCH", [gap(null, "OUTER_MESSAGE_ID_MISMATCH")]);
  if (raw.values.author_id !== -1) return unverified("MISMATCH", [gap(null, "NOT_BOT_MESSAGE")]);
  if (providerChatId(raw.values.chat_id) !== context.provider_chat_id) return unverified("MISMATCH", [gap(null, "PROVIDER_CHAT_ID_MISMATCH")]);

  const gaps: string[] = [];
  if (raw.unknownFieldCount > 0) gaps.push(gap(null, "UNRECOGNIZED_MESSAGE_FIELDS"));
  const objects = readArray(raw.values.message_object, MAX_RESULT_OBJECTS);
  if (objects.status === "INVALID") return bound("UNKNOWN", [], [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_INVALID")]);
  if (objects.status === "OVER_LIMIT") return bound("UNKNOWN", [], [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT")]);
  if (objects.values.length === 0) gaps.push(gap(null, "MESSAGE_OBJECT_ARRAY_EMPTY"));

  const ready: OwnerWanT2vReadyVideo[] = [];
  const objectIds = new Set<string>();
  const observedExpectedIds = new Set<string>();
  let modelEcho: OwnerWanT2vVideoResult["model_echo"] = "MATCHED";
  let modelMismatch = false;
  let childMessageMismatch = false;
  for (let index = 0; index < objects.values.length; index += 1) {
    const object = readRecord(objects.values[index], ["id", "object_type", "object_url", "completed", "model_type", "message_id"],
      ["object_text", "created_at", "updated_at", "task_id", "metadata"]);
    if (!object) { gaps.push(gap(index, "OBJECT_ENTRY_INVALID")); continue; }
    if (object.unknownFieldCount > 0) gaps.push(gap(index, "UNRECOGNIZED_OBJECT_FIELDS"));
    const objectId = providerId(object.values.id);
    if (objectId === undefined) { gaps.push(gap(index, "OBJECT_ID_UNAVAILABLE")); continue; }
    if (objectIds.has(objectId)) { gaps.push(gap(index, "OBJECT_ID_DUPLICATE")); continue; }
    objectIds.add(objectId);
    if (!context.message_object_ids.includes(objectId)) { gaps.push(gap(index, "OBJECT_ID_UNEXPECTED")); continue; }
    observedExpectedIds.add(objectId);
    if (Object.hasOwn(object.values, "message_id") && providerId(object.values.message_id) !== context.message_id) {
      gaps.push(gap(index, "CHILD_MESSAGE_ID_MISMATCH")); childMessageMismatch = true; continue;
    }
    if (object.values.object_type !== "video") { gaps.push(gap(index, "OBJECT_TYPE_UNSUPPORTED")); continue; }
    const echoedModel = object.values.model_type;
    if (echoedModel === undefined || echoedModel === null) {
      modelEcho = modelEcho === "MISMATCH" ? modelEcho : "UNKNOWN";
      gaps.push(gap(index, "MODEL_TYPE_UNAVAILABLE"));
    } else if (echoedModel !== context.model_id) {
      modelEcho = "MISMATCH"; modelMismatch = true; gaps.push(gap(index, "MODEL_TYPE_MISMATCH")); continue;
    }
    if (object.values.completed !== true) {
      gaps.push(gap(index, object.values.completed === false ? "OBJECT_INCOMPLETE" : "OBJECT_COMPLETION_UNKNOWN"));
      continue;
    }
    if (typeof object.values.object_url !== "string" || object.values.object_url.length === 0) {
      gaps.push(gap(index, "OBJECT_URL_MISSING")); continue;
    }
    if (!isSafeUploadReferenceUrl(object.values.object_url)) { gaps.push(gap(index, "OBJECT_URL_UNSAFE")); continue; }
    const mimeType = inferVideoMimeType(object.values.object_url);
    ready.push(Object.freeze({ object_index: index, message_object_id: objectId, object_type: "video", object_url: object.values.object_url,
      mime_type: mimeType, mime_source: mimeType === null ? "UNKNOWN" : "URL_EXTENSION" }));
  }
  for (const expectedId of context.message_object_ids) {
    if (!observedExpectedIds.has(expectedId)) gaps.push(gap(null, "EXPECTED_OBJECT_ID_MISSING"));
  }
  if (modelMismatch || childMessageMismatch) return unverified(modelEcho, gaps);
  return bound(modelEcho, ready, gaps);
}

function snapshotContext(value: unknown): Readonly<OwnerWanT2vVideoResultReadContext> {
  const record = readRecord(value, ["chat_uuid", "message_id", "model_id", "provider_chat_id", "message_object_ids"]);
  if (!record || record.unknownFieldCount !== 0 || !isSafeId(record.values.chat_uuid) || !isSafeId(record.values.message_id) ||
      !isModelId(record.values.model_id) || !isSafeProviderChatId(record.values.provider_chat_id)) throw new TypeError("INVALID_WAN_T2V_VIDEO_RESULT_CONTEXT");
  const ids = readArray(record.values.message_object_ids, MAX_RESULT_OBJECTS);
  if (ids.status !== "OK" || ids.values.length === 0 || ids.values.some((id) => !isSafeId(id)) || new Set(ids.values).size !== ids.values.length) {
    throw new TypeError("INVALID_WAN_T2V_VIDEO_RESULT_CONTEXT");
  }
  return Object.freeze({ chat_uuid: record.values.chat_uuid, message_id: record.values.message_id, model_id: record.values.model_id,
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
  } catch { return Object.freeze({ status: "INVALID" }); }
}

function providerId(value: unknown): string | undefined {
  if (typeof value === "string") return isSafeId(value) ? value : undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}
function providerChatId(value: unknown): string | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSafeProviderChatId(value: unknown): value is string { return typeof value === "string" && SAFE_PROVIDER_CHAT_ID.test(value); }
function isModelId(value: unknown): value is OwnerWanT2vModelId { return typeof value === "string" && WAN_T2V_MODELS.includes(value as OwnerWanT2vModelId); }
function inferVideoMimeType(value: string): OwnerWanT2vReadyVideo["mime_type"] {
  let pathname: string;
  try { pathname = new URL(value).pathname; } catch { return null; }
  const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(pathname)?.[1]?.toLowerCase();
  if (extension === "mp4") return "video/mp4";
  if (extension === "mov") return "video/quicktime";
  return null;
}
function gap(_objectIndex: number | null, code: OwnerWanT2vVideoResultGapCode): string {
  return code;
}
function bound(modelEcho: OwnerWanT2vVideoResult["model_echo"], videos: readonly OwnerWanT2vReadyVideo[], gaps: readonly string[]): OwnerWanT2vVideoResult {
  return Object.freeze({ message_binding: "BOUND", model_echo: modelEcho, ready_videos: Object.freeze([...videos]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
function unverified(modelEcho: OwnerWanT2vVideoResult["model_echo"], gaps: readonly string[]): OwnerWanT2vVideoResult {
  return Object.freeze({ message_binding: "UNVERIFIED", model_echo: modelEcho, ready_videos: Object.freeze([]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
