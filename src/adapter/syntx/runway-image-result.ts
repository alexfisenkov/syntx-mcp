import { types } from "node:util";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const MAX_URL_LENGTH = 4096;

export interface RunwayImageResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly variant: "runway_frames";
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly [string];
}

export type RunwayImageResultPendingReason = "NO_RESULT_OBJECTS" | "RESULT_NOT_COMPLETED";
export type RunwayImageResultUnverifiedReason =
  | "RESPONSE_SHAPE_INVALID" | "OUTER_MESSAGE_MISMATCH" | "PROVIDER_CHAT_MISMATCH"
  | "NOT_BOT_MESSAGE" | "RESULT_OBJECT_CARDINALITY_INVALID" | "RESULT_OBJECT_SHAPE_INVALID"
  | "OBJECT_ID_MISMATCH" | "OBJECT_MESSAGE_MISMATCH" | "OBJECT_TYPE_MISMATCH" | "MODEL_TYPE_UNAVAILABLE"
  | "MODEL_TYPE_MISMATCH" | "RESULT_URL_UNSAFE";

export interface InternalRunwayImageResultArtifact {
  readonly message_object_id: string;
  readonly message_id: string;
  readonly object_type: "image";
  readonly model_type: "runway_frames";
  readonly completed: true;
  readonly url: string;
  readonly mime_type: string | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly width: null;
  readonly height: null;
  readonly geometry_verified: false;
}

export type InternalRunwayImageResult =
  | (RunwayImageResultReadContext & Readonly<{ status: "COMPLETE"; model_type: "runway_frames"; completed: true; artifact: InternalRunwayImageResultArtifact }>)
  | (RunwayImageResultReadContext & Readonly<{ status: "PENDING"; reason: RunwayImageResultPendingReason }>)
  | (RunwayImageResultReadContext & Readonly<{ status: "UNVERIFIED"; reason: RunwayImageResultUnverifiedReason }>);

/** Snapshots only the exact route and history binding needed for one result GET. */
export function snapshotRunwayImageResultReadContext(value: unknown): Readonly<RunwayImageResultReadContext> {
  const fields = readRecord(value, ["chat_uuid", "message_id", "variant", "provider_chat_id", "message_object_ids"]);
  if (typeof fields.chat_uuid !== "string" || !SAFE_IDENTIFIER.test(fields.chat_uuid) ||
      typeof fields.message_id !== "string" || !SAFE_IDENTIFIER.test(fields.message_id) || fields.variant !== "runway_frames" ||
      typeof fields.provider_chat_id !== "string" || !SAFE_PROVIDER_CHAT_ID.test(fields.provider_chat_id) ||
      !Number.isSafeInteger(Number(fields.provider_chat_id))) throw new TypeError("INVALID_RUNWAY_RESULT_CONTEXT");
  const ids = readArray(fields.message_object_ids, 1);
  if (ids.length !== 1 || typeof ids[0] !== "string" || !SAFE_IDENTIFIER.test(ids[0])) throw new TypeError("INVALID_RUNWAY_RESULT_CONTEXT");
  return Object.freeze({ chat_uuid: fields.chat_uuid, message_id: fields.message_id, variant: "runway_frames",
    provider_chat_id: fields.provider_chat_id, message_object_ids: Object.freeze([ids[0]]) as readonly [string] });
}

/** Decodes one provider message without returning raw response fields or claiming backend acceptance. */
export function decodeRunwayImageResult(raw: unknown, contextInput: unknown): InternalRunwayImageResult {
  const context = snapshotRunwayImageResultReadContext(contextInput);
  const unverified = (reason: RunwayImageResultUnverifiedReason): InternalRunwayImageResult => Object.freeze({ ...context, status: "UNVERIFIED", reason });
  const pending = (reason: RunwayImageResultPendingReason): InternalRunwayImageResult => Object.freeze({ ...context, status: "PENDING", reason });
  const outer = readRecordLoose(raw);
  if (!outer) return unverified("RESPONSE_SHAPE_INVALID");
  if (providerId(outer.id) !== context.message_id) return unverified("OUTER_MESSAGE_MISMATCH");
  if (typeof outer.chat_id !== "number" || !Number.isSafeInteger(outer.chat_id) || outer.chat_id < 0 ||
      String(outer.chat_id) !== context.provider_chat_id) return unverified("PROVIDER_CHAT_MISMATCH");
  if (outer.author_id !== -1) return unverified("NOT_BOT_MESSAGE");
  const objects = readArrayLoose(outer.message_object);
  if (!objects) return unverified("RESPONSE_SHAPE_INVALID");
  if (objects.length === 0) return pending("NO_RESULT_OBJECTS");
  if (objects.length !== 1) return unverified("RESULT_OBJECT_CARDINALITY_INVALID");
  const object = readRecordLoose(objects[0]);
  if (!object) return unverified("RESULT_OBJECT_SHAPE_INVALID");
  if (providerId(object.id) !== context.message_object_ids[0]) return unverified("OBJECT_ID_MISMATCH");
  if (providerId(object.message_id) !== context.message_id) return unverified("OBJECT_MESSAGE_MISMATCH");
  if (object.object_type !== "image") return unverified("OBJECT_TYPE_MISMATCH");
  if (typeof object.model_type !== "string") return unverified("MODEL_TYPE_UNAVAILABLE");
  if (object.model_type !== "runway_frames") return unverified("MODEL_TYPE_MISMATCH");
  if (typeof object.completed !== "boolean") return unverified("RESULT_OBJECT_SHAPE_INVALID");
  if (!object.completed) return pending("RESULT_NOT_COMPLETED");
  if (typeof object.object_url !== "string" || !isSafeArtifactUrl(object.object_url)) return unverified("RESULT_URL_UNSAFE");
  const mimeType = inferImageMimeType(object.object_url);
  const artifact: InternalRunwayImageResultArtifact = Object.freeze({
    message_object_id: context.message_object_ids[0], message_id: context.message_id, object_type: "image",
    model_type: "runway_frames", completed: true, url: object.object_url, mime_type: mimeType,
    mime_source: mimeType === null ? "UNKNOWN" : "URL_EXTENSION", width: null, height: null, geometry_verified: false
  });
  return Object.freeze({ ...context, status: "COMPLETE", model_type: "runway_frames", completed: true, artifact });
}

function readRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) throw new TypeError();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of own as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function readRecordLoose(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!)) return null;
    result[key] = descriptors[key]!.value;
  }
  return result;
}

function readArray(value: unknown, maximum: number): unknown[] {
  const values = readArrayLoose(value);
  if (!values || values.length > maximum) throw new TypeError();
  return values;
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

function providerId(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value) ? value : undefined;
}

function isSafeArtifactUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "r2.syntx.ai" && url.port === "" &&
      url.username === "" && url.password === "" && url.hash === "" && url.pathname !== "/";
  } catch { return false; }
}

function inferImageMimeType(url: string): string | null {
  let pathname: string;
  try { pathname = new URL(url).pathname; } catch { return null; }
  const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(pathname)?.[1]?.toLowerCase();
  switch (extension) {
    case "jpg": case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "avif": return "image/avif";
    case "bmp": return "image/bmp";
    case "gif": return "image/gif";
    default: return null;
  }
}
