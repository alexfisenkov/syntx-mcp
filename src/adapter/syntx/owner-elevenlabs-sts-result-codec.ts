import { types } from "node:util";
import type { OwnerElevenLabsStsOriginalHandle } from "../../application/owner-elevenlabs-sts-parameters.js";

const MODEL_ID = "eleven_multilingual_sts_v2" as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_CHAT_ID = /^\d{1,16}$/u;
const R2_HOST = "r2.syntx.ai";

export interface OwnerElevenLabsStsResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly [string];
  readonly audio_original_handle?: OwnerElevenLabsStsOriginalHandle;
}

export interface OwnerElevenLabsStsReadyAudio {
  readonly object_index: 0;
  readonly message_object_id: string;
  readonly object_type: "audio";
  readonly object_url: string;
  readonly mime_type: "audio/mpeg";
  readonly mime_source: "URL_EXTENSION_LOCAL_POLICY";
}

export type OwnerElevenLabsStsResultGapCode =
  | "ENVELOPE_SHAPE_INVALID" | "OUTER_MESSAGE_ID_MISMATCH" | "NOT_BOT_MESSAGE" | "PROVIDER_CHAT_ID_MISMATCH"
  | "UNRECOGNIZED_MESSAGE_FIELDS" | "MESSAGE_OBJECT_ARRAY_INVALID" | "MESSAGE_OBJECT_ARRAY_EMPTY"
  | "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT" | "UNRECOGNIZED_OBJECT_FIELDS" | "OBJECT_ENTRY_INVALID"
  | "OBJECT_ID_UNAVAILABLE" | "OBJECT_ID_MISMATCH" | "OBJECT_TYPE_UNSUPPORTED" | "MODEL_TYPE_UNAVAILABLE"
  | "MODEL_TYPE_MISMATCH" | "OBJECT_INCOMPLETE" | "OBJECT_COMPLETION_UNKNOWN" | "OBJECT_URL_MISSING"
  | "OBJECT_URL_UNSAFE" | "OBJECT_MIME_UNSUPPORTED";

export interface OwnerElevenLabsStsResultGap {
  readonly object_index: 0 | null;
  readonly code: OwnerElevenLabsStsResultGapCode;
}

export interface OwnerElevenLabsStsResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly ready_audio: readonly Readonly<OwnerElevenLabsStsReadyAudio>[];
  readonly gaps: readonly Readonly<OwnerElevenLabsStsResultGap>[];
  readonly backend_acceptance: "UNPROVEN";
}

interface RecordRead { readonly values: Readonly<Record<string, unknown>>; readonly unknownFields: number }
type ArrayRead = { readonly status: "OK"; readonly values: readonly unknown[] } | { readonly status: "INVALID" };

/** Binds one owned-history result to exact STS v2 model/message/chat/object context. */
export function decodeOwnerElevenLabsStsResult(rawInput: unknown, contextInput: unknown): OwnerElevenLabsStsResult {
  const context = snapshotContext(contextInput);
  const raw = readRecord(rawInput, ["id", "chat_id", "author_id", "message_object"], ["created_at", "updated_at", "is_favorite"]);
  if (!raw) return unverified("UNKNOWN", [gap(null, "ENVELOPE_SHAPE_INVALID")]);
  if (providerId(raw.values.id) !== context.message_id) return unverified("UNKNOWN", [gap(null, "OUTER_MESSAGE_ID_MISMATCH")]);
  if (raw.values.author_id !== -1) return unverified("UNKNOWN", [gap(null, "NOT_BOT_MESSAGE")]);
  if (providerChatId(raw.values.chat_id) !== context.provider_chat_id) return unverified("UNKNOWN", [gap(null, "PROVIDER_CHAT_ID_MISMATCH")]);

  const gaps: OwnerElevenLabsStsResultGap[] = [];
  if (raw.unknownFields > 0) gaps.push(gap(null, "UNRECOGNIZED_MESSAGE_FIELDS"));
  const objects = readArray(raw.values.message_object);
  if (objects.status === "INVALID") return bound("UNKNOWN", [], [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_INVALID")]);
  if (objects.values.length === 0) return bound("UNKNOWN", [], [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_EMPTY")]);
  if (objects.values.length !== 1) return bound("UNKNOWN", [], [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT")]);

  const object = readRecord(objects.values[0], ["id", "object_type", "object_url", "completed"],
    ["message_id", "object_text", "created_at", "updated_at", "metadata"], ["model_type"]);
  if (!object) return bound("UNKNOWN", [], [...gaps, gap(0, "OBJECT_ENTRY_INVALID")]);
  if (object.unknownFields > 0) gaps.push(gap(0, "UNRECOGNIZED_OBJECT_FIELDS"));
  const objectId = providerId(object.values.id);
  if (objectId === undefined) return bound("UNKNOWN", [], [...gaps, gap(0, "OBJECT_ID_UNAVAILABLE")]);
  if (objectId !== context.message_object_ids[0]) return unverified("UNKNOWN", [...gaps, gap(0, "OBJECT_ID_MISMATCH")]);
  if (object.values.object_type !== "audio") return bound("UNKNOWN", [], [...gaps, gap(0, "OBJECT_TYPE_UNSUPPORTED")]);

  const model = object.values.model_type;
  if (model === undefined || model === null) return bound("UNKNOWN", [], [...gaps, gap(0, "MODEL_TYPE_UNAVAILABLE")]);
  if (model !== MODEL_ID) return unverified("MISMATCH", [...gaps, gap(0, "MODEL_TYPE_MISMATCH")]);
  if (object.values.completed !== true) {
    return bound("MATCHED", [], [...gaps, gap(0, object.values.completed === false ? "OBJECT_INCOMPLETE" : "OBJECT_COMPLETION_UNKNOWN")]);
  }
  if (typeof object.values.object_url !== "string" || object.values.object_url.length === 0) {
    return bound("MATCHED", [], [...gaps, gap(0, "OBJECT_URL_MISSING")]);
  }
  if (!isSafeR2Url(object.values.object_url)) return bound("MATCHED", [], [...gaps, gap(0, "OBJECT_URL_UNSAFE")]);
  if (!isMp3Url(object.values.object_url)) return bound("MATCHED", [], [...gaps, gap(0, "OBJECT_MIME_UNSUPPORTED")]);
  return bound("MATCHED", [Object.freeze({ object_index: 0, message_object_id: objectId, object_type: "audio",
    object_url: object.values.object_url, mime_type: "audio/mpeg", mime_source: "URL_EXTENSION_LOCAL_POLICY" })], gaps);
}

function snapshotContext(value: unknown): Readonly<OwnerElevenLabsStsResultReadContext> {
  const row = readRecord(value, ["chat_uuid", "message_id", "model_id", "provider_chat_id", "message_object_ids"], ["audio_original_handle"]);
  if (!row || row.unknownFields !== 0 || !isSafeId(row.values.chat_uuid) || !isSafeId(row.values.message_id) ||
      row.values.model_id !== MODEL_ID || !isSafeChatId(row.values.provider_chat_id) ||
      (row.values.audio_original_handle !== undefined && !isOriginalHandle(row.values.audio_original_handle))) {
    throw new TypeError("INVALID_OWNER_ELEVENLABS_STS_RESULT_CONTEXT");
  }
  const ids = readArray(row.values.message_object_ids);
  if (ids.status !== "OK" || ids.values.length !== 1 || !isSafeId(ids.values[0])) {
    throw new TypeError("INVALID_OWNER_ELEVENLABS_STS_RESULT_CONTEXT");
  }
  return Object.freeze({ chat_uuid: row.values.chat_uuid, message_id: row.values.message_id, model_id: MODEL_ID,
    provider_chat_id: row.values.provider_chat_id, message_object_ids: Object.freeze([ids.values[0]]) as readonly [string],
    ...(row.values.audio_original_handle === undefined ? {} : { audio_original_handle: row.values.audio_original_handle as OwnerElevenLabsStsOriginalHandle }) });
}

/** Reads only own data descriptors; unknown values and metadata are not traversed. */
function readRecord(value: unknown, required: readonly string[], recognized: readonly string[] = [], optional: readonly string[] = []): RecordRead | null {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const consumed = [...required, ...optional];
    let unknownFields = 0;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") { unknownFields += 1; continue; }
      const descriptor = descriptors[key]!;
      if (consumed.includes(key)) {
        if (!("value" in descriptor) || descriptor.enumerable !== true) return null;
        values[key] = descriptor.value;
      } else if (recognized.includes(key)) {
        // Known inert fields are intentionally not read.
      } else unknownFields += 1;
    }
    if (required.some((key) => !Object.hasOwn(values, key))) return null;
    return Object.freeze({ values: Object.freeze(values), unknownFields });
  } catch { return null; }
}

function readArray(value: unknown): ArrayRead {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return { status: "INVALID" };
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, "length")) return { status: "INVALID" };
    const values: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return { status: "INVALID" };
      values.push(descriptor.value);
    }
    if (keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length))) return { status: "INVALID" };
    return Object.freeze({ status: "OK", values: Object.freeze(values) });
  } catch { return { status: "INVALID" }; }
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
function isSafeChatId(value: unknown): value is string { return typeof value === "string" && SAFE_CHAT_ID.test(value) && Number.isSafeInteger(Number(value)); }
function isOriginalHandle(value: unknown): boolean {
  return typeof value === "string" && /^elevenlabs_sts_original_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}
function isSafeR2Url(value: string): boolean {
  if (value.length === 0 || value.length > 4096) return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === R2_HOST && url.port.length === 0 &&
    url.username.length === 0 && url.password.length === 0 && url.hash.length === 0; } catch { return false; }
}
function isMp3Url(value: string): boolean { try { return /\.mp3$/iu.test(new URL(value).pathname); } catch { return false; } }
function gap(object_index: 0 | null, code: OwnerElevenLabsStsResultGapCode): OwnerElevenLabsStsResultGap { return Object.freeze({ object_index, code }); }
function bound(modelEcho: OwnerElevenLabsStsResult["model_echo"], ready: readonly OwnerElevenLabsStsReadyAudio[],
  gaps: readonly OwnerElevenLabsStsResultGap[]): OwnerElevenLabsStsResult {
  return Object.freeze({ message_binding: "BOUND", model_echo: modelEcho, ready_audio: Object.freeze([...ready]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
function unverified(modelEcho: OwnerElevenLabsStsResult["model_echo"], gaps: readonly OwnerElevenLabsStsResultGap[]): OwnerElevenLabsStsResult {
  return Object.freeze({ message_binding: "UNVERIFIED", model_echo: modelEcho, ready_audio: Object.freeze([]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
