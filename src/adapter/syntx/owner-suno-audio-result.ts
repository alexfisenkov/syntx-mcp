import { types } from "node:util";

const SUNO_MODELS = Object.freeze(["V6", "V6_wild"] as const);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const MAX_AUDIO_OBJECTS = 64;
const AUDIO_R2_HOST = "r2.syntx.ai";

export type OwnerSunoAudioModelId = typeof SUNO_MODELS[number];

/** Data-only result context minted by a future owner-bound history reader. */
export interface OwnerSunoAudioResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: OwnerSunoAudioModelId;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
}

export interface OwnerSunoReadyAudio {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "audio";
  readonly object_url: string;
  readonly mime_type: "audio/mpeg" | "audio/wav" | "audio/mp4" | null;
  readonly mime_source: "URL_EXTENSION_LOCAL_POLICY" | "UNKNOWN";
}

export type OwnerSunoAudioResultGapCode =
  | "ENVELOPE_SHAPE_INVALID" | "OUTER_MESSAGE_ID_MISMATCH" | "NOT_BOT_MESSAGE" | "PROVIDER_CHAT_ID_MISMATCH"
  | "UNRECOGNIZED_MESSAGE_FIELDS" | "MESSAGE_OBJECT_ARRAY_INVALID" | "MESSAGE_OBJECT_ARRAY_EMPTY"
  | "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT" | "UNRECOGNIZED_OBJECT_FIELDS" | "OBJECT_ENTRY_INVALID"
  | "OBJECT_ID_UNAVAILABLE" | "OBJECT_ID_DUPLICATE" | "OBJECT_ID_UNEXPECTED" | "EXPECTED_OBJECT_ID_MISSING"
  | "OBJECT_MESSAGE_ID_MISMATCH" | "OBJECT_TYPE_UNSUPPORTED" | "OBJECT_INCOMPLETE" | "OBJECT_COMPLETION_UNKNOWN"
  | "OBJECT_URL_MISSING" | "OBJECT_URL_INVALID" | "OBJECT_URL_UNSAFE" | "MIME_TYPE_UNKNOWN"
  | "MODEL_TYPE_UNAVAILABLE" | "MODEL_TYPE_MISMATCH";

export interface OwnerSunoAudioResultGap {
  readonly object_index: number | null;
  readonly code: OwnerSunoAudioResultGapCode;
}

export interface OwnerSunoAudioResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly ready_audio: readonly Readonly<OwnerSunoReadyAudio>[];
  readonly gaps: readonly Readonly<OwnerSunoAudioResultGap>[];
  readonly backend_acceptance: "UNPROVEN";
}

interface DataRecord {
  readonly values: Readonly<Record<string, unknown>>;
  readonly unknownFieldCount: number;
}

type ArrayRead =
  | Readonly<{ status: "OK"; values: readonly unknown[] }>
  | Readonly<{ status: "INVALID" }>
  | Readonly<{ status: "OVER_LIMIT" }>;

/** Decodes one owner-scoped Suno audio message; it grants no ownership or provider-terminal authority. */
export function decodeOwnerSunoAudioResult(rawInput: unknown, contextInput: unknown): OwnerSunoAudioResult {
  let context: Readonly<OwnerSunoAudioResultReadContext>;
  try { context = snapshotContext(contextInput); }
  catch { throw new TypeError("INVALID_OWNER_SUNO_AUDIO_RESULT_CONTEXT"); }

  const raw = readRecord(rawInput, ["id", "chat_id", "author_id", "message_object"], [],
    ["created_at", "updated_at", "is_favorite"]);
  if (!raw) return unverified("UNKNOWN", [gap(null, "ENVELOPE_SHAPE_INVALID")]);
  if (providerId(raw.values.id) !== context.message_id) return unverified("UNKNOWN", [gap(null, "OUTER_MESSAGE_ID_MISMATCH")]);
  if (raw.values.author_id !== -1) return unverified("UNKNOWN", [gap(null, "NOT_BOT_MESSAGE")]);
  if (providerChatId(raw.values.chat_id) !== context.provider_chat_id) {
    return unverified("UNKNOWN", [gap(null, "PROVIDER_CHAT_ID_MISMATCH")]);
  }

  const gaps: OwnerSunoAudioResultGap[] = [];
  if (raw.unknownFieldCount > 0) gaps.push(gap(null, "UNRECOGNIZED_MESSAGE_FIELDS"));
  const objects = readArray(raw.values.message_object, MAX_AUDIO_OBJECTS);
  if (objects.status === "INVALID") return unverified("UNKNOWN", [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_INVALID")]);
  if (objects.status === "OVER_LIMIT") return unverified("UNKNOWN", [...gaps, gap(null, "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT")]);
  if (objects.values.length === 0) gaps.push(gap(null, "MESSAGE_OBJECT_ARRAY_EMPTY"));

  const seenObjectIds = new Set<string>();
  const observedExpectedIds = new Set<string>();
  const ready: OwnerSunoReadyAudio[] = [];
  let modelEcho: OwnerSunoAudioResult["model_echo"] = "MATCHED";
  let sawModelEcho = false;
  let modelMismatch = false;

  for (let index = 0; index < objects.values.length; index += 1) {
    const object = readRecord(objects.values[index], ["id", "message_id", "object_type"],
      ["object_text", "created_at", "updated_at", "metadata"], ["object_url", "completed", "model_type"]);
    if (!object) { gaps.push(gap(index, "OBJECT_ENTRY_INVALID")); continue; }
    if (object.unknownFieldCount > 0) gaps.push(gap(index, "UNRECOGNIZED_OBJECT_FIELDS"));

    const objectId = providerId(object.values.id);
    if (objectId === undefined) { gaps.push(gap(index, "OBJECT_ID_UNAVAILABLE")); continue; }
    if (seenObjectIds.has(objectId)) { gaps.push(gap(index, "OBJECT_ID_DUPLICATE")); continue; }
    seenObjectIds.add(objectId);
    if (!context.message_object_ids.includes(objectId)) { gaps.push(gap(index, "OBJECT_ID_UNEXPECTED")); continue; }
    if (providerId(object.values.message_id) !== context.message_id) {
      gaps.push(gap(index, "OBJECT_MESSAGE_ID_MISMATCH"));
      continue;
    }
    observedExpectedIds.add(objectId);

    const echoedModel = object.values.model_type;
    if (echoedModel === undefined || echoedModel === null) {
      sawModelEcho = true;
      modelEcho = modelEcho === "MISMATCH" ? modelEcho : "UNKNOWN";
      gaps.push(gap(index, "MODEL_TYPE_UNAVAILABLE"));
    } else if (typeof echoedModel !== "string") {
      gaps.push(gap(index, "OBJECT_ENTRY_INVALID"));
      continue;
    } else if (echoedModel !== context.model_id) {
      sawModelEcho = true;
      modelEcho = "MISMATCH";
      modelMismatch = true;
      gaps.push(gap(index, "MODEL_TYPE_MISMATCH"));
      continue;
    } else {
      sawModelEcho = true;
      if (modelEcho !== "UNKNOWN" && modelEcho !== "MISMATCH") modelEcho = "MATCHED";
    }

    if (object.values.object_type !== "audio") { gaps.push(gap(index, "OBJECT_TYPE_UNSUPPORTED")); continue; }
    if (object.values.completed !== true) {
      gaps.push(gap(index, object.values.completed === false ? "OBJECT_INCOMPLETE" : "OBJECT_COMPLETION_UNKNOWN"));
      continue;
    }
    if (object.values.object_url === undefined || object.values.object_url === null || object.values.object_url === "") {
      gaps.push(gap(index, "OBJECT_URL_MISSING"));
      continue;
    }
    if (typeof object.values.object_url !== "string") { gaps.push(gap(index, "OBJECT_URL_INVALID")); continue; }
    if (!isSafeAudioArtifactUrl(object.values.object_url)) { gaps.push(gap(index, "OBJECT_URL_UNSAFE")); continue; }

    const mimeType = inferAudioMimeType(object.values.object_url);
    if (mimeType === null) gaps.push(gap(index, "MIME_TYPE_UNKNOWN"));
    ready.push(Object.freeze({ object_index: index, message_object_id: objectId, object_type: "audio",
      object_url: object.values.object_url, mime_type: mimeType,
      mime_source: mimeType === null ? "UNKNOWN" : "URL_EXTENSION_LOCAL_POLICY" }));
  }

  for (const expectedId of context.message_object_ids) {
    if (!observedExpectedIds.has(expectedId)) gaps.push(gap(null, "EXPECTED_OBJECT_ID_MISSING"));
  }
  if (!sawModelEcho) modelEcho = "UNKNOWN";
  if (modelMismatch) return unverified("MISMATCH", gaps);
  return bound(modelEcho, ready, gaps);
}

function snapshotContext(value: unknown): Readonly<OwnerSunoAudioResultReadContext> {
  const record = readRecord(value, ["chat_uuid", "message_id", "model_id", "provider_chat_id", "message_object_ids"]);
  if (!record || record.unknownFieldCount !== 0 || !isSafeId(record.values.chat_uuid) ||
      !isSafeId(record.values.message_id) || !isModelId(record.values.model_id) ||
      !isSafeProviderChatId(record.values.provider_chat_id)) throw new TypeError("INVALID_OWNER_SUNO_AUDIO_RESULT_CONTEXT");
  const ids = readArray(record.values.message_object_ids, MAX_AUDIO_OBJECTS);
  if (ids.status !== "OK" || ids.values.length < 1 || ids.values.some((id) => !isSafeId(id)) ||
      new Set(ids.values).size !== ids.values.length) throw new TypeError("INVALID_OWNER_SUNO_AUDIO_RESULT_CONTEXT");
  return Object.freeze({ chat_uuid: record.values.chat_uuid, message_id: record.values.message_id,
    model_id: record.values.model_id, provider_chat_id: record.values.provider_chat_id,
    message_object_ids: Object.freeze([...ids.values]) as readonly string[] });
}

/** Only projected field names are inspected; unknown values and nested inert metadata are never traversed. */
function readRecord(value: unknown, requiredKeys: readonly string[], recognizedUnconsumedKeys: readonly string[] = [],
  optionalConsumedKeys: readonly string[] = []): DataRecord | null {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const consumedKeys = [...requiredKeys, ...optionalConsumedKeys];
    let unknownFieldCount = 0;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") { unknownFieldCount += 1; continue; }
      const descriptor = descriptors[key]!;
      if (consumedKeys.includes(key)) {
        if (!("value" in descriptor) || !descriptor.enumerable) return null;
        values[key] = descriptor.value;
      } else if (recognizedUnconsumedKeys.includes(key)) {
        // Known source metadata is deliberately inert and is not read or traversed.
        continue;
      } else {
        unknownFieldCount += 1;
      }
    }
    if (requiredKeys.some((key) => !Object.hasOwn(descriptors, key))) return null;
    return Object.freeze({ values: Object.freeze(values), unknownFieldCount });
  } catch { return null; }
}

function readArray(value: unknown, maximum: number): ArrayRead {
  try {
    if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return Object.freeze({ status: "INVALID" });
    }
    if (value.length > maximum) return Object.freeze({ status: "OVER_LIMIT" });
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
          !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) {
      return Object.freeze({ status: "INVALID" });
    }
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
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === "string" && isSafeProviderChatId(value) ? value : undefined;
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isSafeProviderChatId(value: unknown): value is string {
  return typeof value === "string" && SAFE_PROVIDER_CHAT_ID.test(value) && Number.isSafeInteger(Number(value));
}
function isModelId(value: unknown): value is OwnerSunoAudioModelId {
  return typeof value === "string" && SUNO_MODELS.includes(value as OwnerSunoAudioModelId);
}
function isSafeAudioArtifactUrl(value: string): boolean {
  if (value.length === 0 || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === AUDIO_R2_HOST && url.port.length === 0 &&
      url.username.length === 0 && url.password.length === 0 && url.hash.length === 0;
  } catch { return false; }
}
function inferAudioMimeType(value: string): OwnerSunoReadyAudio["mime_type"] {
  let pathname: string;
  try { pathname = new URL(value).pathname; } catch { return null; }
  const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(pathname)?.[1]?.toLowerCase();
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  if (extension === "m4a") return "audio/mp4";
  return null;
}
function gap(object_index: number | null, code: OwnerSunoAudioResultGapCode): OwnerSunoAudioResultGap {
  return Object.freeze({ object_index, code });
}
function bound(modelEcho: OwnerSunoAudioResult["model_echo"], audio: readonly OwnerSunoReadyAudio[],
  gaps: readonly OwnerSunoAudioResultGap[]): OwnerSunoAudioResult {
  return Object.freeze({ message_binding: "BOUND", model_echo: modelEcho, ready_audio: Object.freeze([...audio]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
function unverified(modelEcho: OwnerSunoAudioResult["model_echo"], gaps: readonly OwnerSunoAudioResultGap[]): OwnerSunoAudioResult {
  return Object.freeze({ message_binding: "UNVERIFIED", model_echo: modelEcho, ready_audio: Object.freeze([]),
    gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}
