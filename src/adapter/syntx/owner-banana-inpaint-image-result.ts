import { isProxy } from "node:util/types";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const MAX_URL_LENGTH = 4096;
const MAX_RESULT_OBJECTS = 64;

export interface OwnerBananaInpaintImageResultReadContext {
  readonly chat_uuid: string;
  /** Exact result-message ID discovered from the owned chat history, not the start ACK. */
  readonly message_id: string;
  /** Optional provider-side chat ID copied from the same trusted history row. */
  readonly provider_chat_id?: string;
}

export interface OwnerBananaInpaintReadyImage {
  readonly object_index: number;
  readonly object_type: "image" | "image_url";
  readonly object_url: string;
  readonly message_object_id?: string;
}

export type OwnerBananaInpaintImageResultGapCode =
  | "ENVELOPE_SHAPE_INVALID" | "OUTER_MESSAGE_ID_MISMATCH" | "NOT_BOT_MESSAGE"
  | "UNRECOGNIZED_MESSAGE_FIELDS" | "PROVIDER_CHAT_ID_UNOBSERVED" | "PROVIDER_CHAT_ID_UNBOUND"
  | "PROVIDER_CHAT_ID_MISMATCH"
  | "MESSAGE_OBJECT_ARRAY_INVALID" | "MESSAGE_OBJECT_ARRAY_EMPTY" | "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT"
  | "UNRECOGNIZED_OBJECT_FIELDS" | "OBJECT_ENTRY_INVALID" | "OBJECT_TYPE_UNSUPPORTED"
  | "OBJECT_COMPLETION_UNKNOWN" | "OBJECT_INCOMPLETE" | "OBJECT_URL_MISSING" | "OBJECT_URL_UNSAFE"
  | "OBJECT_ID_UNAVAILABLE";

export interface OwnerBananaInpaintImageResultGap {
  readonly object_index: number | null;
  readonly code: OwnerBananaInpaintImageResultGapCode;
}

/**
 * Source observation only. `BOUND` means the expected message and bot author were
 * observed; it is not a terminal generation, output-count, model, or provider claim.
 */
export interface OwnerBananaInpaintImageResult {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly provider_chat_id?: string;
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly ready_images: readonly Readonly<OwnerBananaInpaintReadyImage>[];
  readonly gaps: readonly Readonly<OwnerBananaInpaintImageResultGap>[];
}

interface DataRecord {
  readonly values: Readonly<Record<string, unknown>>;
  readonly unknown_field_count: number;
}

type ArrayRead =
  | Readonly<{ status: "OK"; values: readonly unknown[] }>
  | Readonly<{ status: "INVALID" }>
  | Readonly<{ status: "OVER_LIMIT" }>;

/** Decodes only Root904's observed message/object fields; URLs remain internal result data. */
export function decodeOwnerBananaInpaintImageResult(
  rawInput: unknown,
  contextInput: OwnerBananaInpaintImageResultReadContext | unknown
): OwnerBananaInpaintImageResult {
  const context = snapshotContext(contextInput);
  const raw = readDataRecord(rawInput, ["id", "chat_id", "author_id", "message_object"]);
  if (!raw) return unverified(context, [gap(null, "ENVELOPE_SHAPE_INVALID")]);
  if (providerId(raw.values.id) !== context.message_id) return unverified(context, [gap(null, "OUTER_MESSAGE_ID_MISMATCH")]);
  if (raw.values.author_id !== -1) return unverified(context, [gap(null, "NOT_BOT_MESSAGE")]);

  const gaps: OwnerBananaInpaintImageResultGap[] = [];
  if (raw.unknown_field_count > 0) gaps.push(gap(null, "UNRECOGNIZED_MESSAGE_FIELDS"));
  if (!bindOptionalProviderChat(raw.values.chat_id, context, gaps)) {
    gaps.push(gap(null, "PROVIDER_CHAT_ID_MISMATCH"));
    return unverified(context, gaps);
  }

  const objects = readBoundedArray(raw.values.message_object, MAX_RESULT_OBJECTS);
  if (objects.status === "INVALID") {
    gaps.push(gap(null, "MESSAGE_OBJECT_ARRAY_INVALID"));
    return bound(context, [], gaps);
  }
  if (objects.status === "OVER_LIMIT") {
    gaps.push(gap(null, "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT"));
    return bound(context, [], gaps);
  }
  if (objects.values.length === 0) gaps.push(gap(null, "MESSAGE_OBJECT_ARRAY_EMPTY"));

  const images: OwnerBananaInpaintReadyImage[] = [];
  for (let index = 0; index < objects.values.length; index += 1) {
    const object = readDataRecord(objects.values[index], ["id", "object_type", "object_url", "completed"]);
    if (!object) { gaps.push(gap(index, "OBJECT_ENTRY_INVALID")); continue; }
    if (object.unknown_field_count > 0) gaps.push(gap(index, "UNRECOGNIZED_OBJECT_FIELDS"));
    const objectType = object.values.object_type;
    if (objectType !== "image" && objectType !== "image_url") { gaps.push(gap(index, "OBJECT_TYPE_UNSUPPORTED")); continue; }
    if (object.values.completed !== true) {
      gaps.push(gap(index, object.values.completed === false ? "OBJECT_INCOMPLETE" : "OBJECT_COMPLETION_UNKNOWN"));
      continue;
    }
    if (typeof object.values.object_url !== "string" || object.values.object_url.length === 0) {
      gaps.push(gap(index, "OBJECT_URL_MISSING"));
      continue;
    }
    if (object.values.object_url.length > MAX_URL_LENGTH || !isSafeUploadReferenceUrl(object.values.object_url)) {
      gaps.push(gap(index, "OBJECT_URL_UNSAFE"));
      continue;
    }
    const messageObjectId = providerId(object.values.id);
    if (messageObjectId === undefined) gaps.push(gap(index, "OBJECT_ID_UNAVAILABLE"));
    images.push(Object.freeze({
      object_index: index,
      object_type: objectType,
      object_url: object.values.object_url,
      ...(messageObjectId === undefined ? {} : { message_object_id: messageObjectId })
    }));
  }
  return bound(context, images, gaps);
}

function snapshotContext(value: unknown): Readonly<OwnerBananaInpaintImageResultReadContext> {
  const record = readDataRecord(value, ["chat_uuid", "message_id", "provider_chat_id"]);
  if (!record || record.unknown_field_count !== 0 ||
      !isSafeId(record.values.chat_uuid) || !isSafeId(record.values.message_id) ||
      !(record.values.provider_chat_id === undefined || isSafeProviderChatId(record.values.provider_chat_id))) {
    throw new TypeError("INVALID_OWNER_BANANA_INPAINT_IMAGE_RESULT_CONTEXT");
  }
  return Object.freeze({ chat_uuid: record.values.chat_uuid, message_id: record.values.message_id,
    ...(record.values.provider_chat_id === undefined ? {} : { provider_chat_id: record.values.provider_chat_id }) });
}

function bindOptionalProviderChat(rawChatId: unknown, context: Readonly<OwnerBananaInpaintImageResultReadContext>,
  gaps: OwnerBananaInpaintImageResultGap[]): boolean {
  if (context.provider_chat_id === undefined) {
    if (rawChatId !== undefined) gaps.push(gap(null, "PROVIDER_CHAT_ID_UNBOUND"));
    return true;
  }
  if (rawChatId === undefined) { gaps.push(gap(null, "PROVIDER_CHAT_ID_UNOBSERVED")); return true; }
  const observed = typeof rawChatId === "number" && Number.isSafeInteger(rawChatId) && rawChatId >= 0
    ? String(rawChatId)
    : undefined;
  return observed === context.provider_chat_id;
}

function readDataRecord(value: unknown, knownKeys: readonly string[]): DataRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return null;
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
    else unknownFieldCount += 1;
  }
  return Object.freeze({ values: Object.freeze(values), unknown_field_count: unknownFieldCount });
}

function readBoundedArray(value: unknown, maximum: number): ArrayRead {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return Object.freeze({ status: "INVALID" });
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
function gap(objectIndex: number | null, code: OwnerBananaInpaintImageResultGapCode): OwnerBananaInpaintImageResultGap {
  return Object.freeze({ object_index: objectIndex, code });
}
function bound(context: Readonly<OwnerBananaInpaintImageResultReadContext>, images: readonly OwnerBananaInpaintReadyImage[],
  gaps: readonly OwnerBananaInpaintImageResultGap[]): OwnerBananaInpaintImageResult {
  return Object.freeze({ ...context, message_binding: "BOUND", ready_images: Object.freeze(images), gaps: Object.freeze([...gaps]) });
}
function unverified(context: Readonly<OwnerBananaInpaintImageResultReadContext>,
  gaps: readonly OwnerBananaInpaintImageResultGap[]): OwnerBananaInpaintImageResult {
  return Object.freeze({ ...context, message_binding: "UNVERIFIED", ready_images: Object.freeze([]), gaps: Object.freeze([...gaps]) });
}
