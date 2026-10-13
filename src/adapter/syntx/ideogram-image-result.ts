import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import { OWNER_IDEOGRAM_IMAGE_CONTEXTS, type OwnerIdeogramImageMode, type OwnerIdeogramImageModelId } from "../../application/owner-ideogram-image-parameters.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const MAX_URL_LENGTH = 4096;

export interface OwnerIdeogramImageResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly requested_mask_present: boolean;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly output_count: number;
}
export type OwnerIdeogramImageResultPendingReason = "NO_RESULT_OBJECTS" | "RESULT_NOT_COMPLETED";
export type OwnerIdeogramImageResultPartialReason = "OUTPUT_BATCH_PARTIAL" | "SOME_RESULTS_NOT_COMPLETED";
export type OwnerIdeogramImageResultUnverifiedReason = "RESPONSE_SHAPE_INVALID" | "OUTER_MESSAGE_MISMATCH" | "PROVIDER_CHAT_MISMATCH" |
  "NOT_BOT_MESSAGE" | "OUTPUT_COUNT_INVALID" | "RESULT_OBJECT_SHAPE_INVALID" | "OBJECT_ID_MISMATCH" |
  "OBJECT_MESSAGE_MISMATCH" | "OBJECT_TYPE_MISMATCH" | "MODEL_TYPE_UNAVAILABLE" | "MODEL_TYPE_MISMATCH" | "RESULT_URL_UNSAFE";

export interface InternalOwnerIdeogramImageResultArtifact {
  readonly message_object_id: string;
  readonly message_id: string;
  readonly object_type: "image";
  readonly model_type: OwnerIdeogramImageModelId;
  readonly completed: true;
  readonly url: string;
  readonly mime_type: string | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly width: null;
  readonly height: null;
  readonly geometry_verified: false;
}
type Context = Readonly<OwnerIdeogramImageResultReadContext>;
type Provenance = Readonly<{
  mode_confidence: "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO";
  namespace_confidence: "SOURCE_SHAPED_UNVERIFIED";
  backend_acceptance: "UNPROVEN";
}>;
export type InternalOwnerIdeogramImageResult =
  | (Context & Provenance & Readonly<{ status: "COMPLETE"; artifacts: readonly InternalOwnerIdeogramImageResultArtifact[] }>)
  | (Context & Provenance & Readonly<{ status: "PENDING"; reason: OwnerIdeogramImageResultPendingReason }>)
  | (Context & Provenance & Readonly<{ status: "PARTIAL"; reason: OwnerIdeogramImageResultPartialReason; artifacts: readonly InternalOwnerIdeogramImageResultArtifact[] }>)
  | (Context & Provenance & Readonly<{ status: "UNVERIFIED"; reason: OwnerIdeogramImageResultUnverifiedReason }>);

/** Decodes only the exact ordered batch named by the read context; MIME is a URL hint, never geometry proof. */
export function decodeOwnerIdeogramImageResult(raw: unknown, contextInput: unknown): InternalOwnerIdeogramImageResult {
  const context = snapshotOwnerIdeogramImageResultReadContext(contextInput);
  const unverified = (reason: OwnerIdeogramImageResultUnverifiedReason): InternalOwnerIdeogramImageResult => Object.freeze({ ...context, ...provenance(), status: "UNVERIFIED", reason });
  const pending = (reason: OwnerIdeogramImageResultPendingReason): InternalOwnerIdeogramImageResult => Object.freeze({ ...context, ...provenance(), status: "PENDING", reason });
  const outer = readRecordLoose(raw);
  if (!outer) return unverified("RESPONSE_SHAPE_INVALID");
  if (providerId(outer.id) !== context.message_id) return unverified("OUTER_MESSAGE_MISMATCH");
  if (typeof outer.chat_id !== "number" || !Number.isSafeInteger(outer.chat_id) || outer.chat_id < 0 || String(outer.chat_id) !== context.provider_chat_id) return unverified("PROVIDER_CHAT_MISMATCH");
  if (outer.author_id !== -1) return unverified("NOT_BOT_MESSAGE");
  const rawObjects = readArrayLoose(outer.message_object);
  if (!rawObjects) return unverified("RESPONSE_SHAPE_INVALID");
  if (rawObjects.length === 0) return pending("NO_RESULT_OBJECTS");
  if (rawObjects.length > context.message_object_ids.length || rawObjects.length > context.output_count) return unverified("OUTPUT_COUNT_INVALID");

  const artifacts: InternalOwnerIdeogramImageResultArtifact[] = [];
  let completedCount = 0;
  for (let index = 0; index < rawObjects.length; index += 1) {
    const object = readRecordLoose(rawObjects[index]);
    if (!object) return unverified("RESULT_OBJECT_SHAPE_INVALID");
    if (providerId(object.id) !== context.message_object_ids[index]) return unverified("OBJECT_ID_MISMATCH");
    if (providerId(object.message_id) !== context.message_id) return unverified("OBJECT_MESSAGE_MISMATCH");
    if (object.object_type !== "image") return unverified("OBJECT_TYPE_MISMATCH");
    if (typeof object.model_type !== "string") return unverified("MODEL_TYPE_UNAVAILABLE");
    if (object.model_type !== context.model_id) return unverified("MODEL_TYPE_MISMATCH");
    if (typeof object.completed !== "boolean") return unverified("RESULT_OBJECT_SHAPE_INVALID");
    if (typeof object.object_url !== "string" || object.object_url.length > MAX_URL_LENGTH || !isSafeUploadReferenceUrl(object.object_url)) return unverified("RESULT_URL_UNSAFE");
    if (object.completed) completedCount += 1;
    else continue;
    const mimeType = inferImageMimeType(object.object_url);
    artifacts.push(Object.freeze({ message_object_id: context.message_object_ids[index]!, message_id: context.message_id,
      object_type: "image", model_type: context.model_id, completed: true, url: object.object_url,
      mime_type: mimeType, mime_source: mimeType === null ? "UNKNOWN" : "URL_EXTENSION", width: null, height: null, geometry_verified: false }));
  }
  if (completedCount === 0) return pending("RESULT_NOT_COMPLETED");
  const frozenArtifacts = Object.freeze(artifacts);
  if (rawObjects.length < context.output_count) return Object.freeze({ ...context, ...provenance(), status: "PARTIAL", reason: "OUTPUT_BATCH_PARTIAL", artifacts: frozenArtifacts });
  if (completedCount < rawObjects.length) return Object.freeze({ ...context, ...provenance(), status: "PARTIAL", reason: "SOME_RESULTS_NOT_COMPLETED", artifacts: frozenArtifacts });
  return Object.freeze({ ...context, ...provenance(), status: "COMPLETE", artifacts: frozenArtifacts });
}

export function snapshotOwnerIdeogramImageResultReadContext(value: unknown): Context {
  const fields = readExactRecord(value, ["chat_uuid", "message_id", "model_id", "mode", "requested_mask_present", "provider_chat_id", "message_object_ids", "output_count"]);
  if (!isSafeId(fields.chat_uuid) || !isSafeId(fields.message_id) || !isContext(fields.model_id, fields.mode) || typeof fields.requested_mask_present !== "boolean" ||
      (fields.requested_mask_present === true && !(fields.model_id === "ideogram_45" && fields.mode === "precise_edit")) ||
      typeof fields.provider_chat_id !== "string" || !SAFE_PROVIDER_CHAT_ID.test(fields.provider_chat_id) || !Number.isSafeInteger(Number(fields.provider_chat_id)) ||
      !Number.isSafeInteger(fields.output_count) || (fields.output_count as number) < 1 || (fields.output_count as number) > 8) throw new TypeError("INVALID_OWNER_IDEOGRAM_RESULT_CONTEXT");
  const ids = readArray(fields.message_object_ids, 8);
  if (ids.length > (fields.output_count as number) || ids.some((id) => !isSafeId(id)) || new Set(ids).size !== ids.length) throw new TypeError("INVALID_OWNER_IDEOGRAM_RESULT_CONTEXT");
  return Object.freeze({ chat_uuid: fields.chat_uuid, message_id: fields.message_id, model_id: fields.model_id as OwnerIdeogramImageModelId,
    mode: fields.mode as OwnerIdeogramImageMode, requested_mask_present: fields.requested_mask_present as boolean,
    provider_chat_id: fields.provider_chat_id, message_object_ids: Object.freeze([...ids]) as readonly string[],
    output_count: fields.output_count as number });
}

function isContext(model: unknown, mode: unknown): boolean {
  return typeof model === "string" && OWNER_IDEOGRAM_IMAGE_CONTEXTS.some((context) => context.model_id === model && context.mode === mode);
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_IDENTIFIER.test(value); }
function providerId(value: unknown): string | undefined { return typeof value === "string" && SAFE_IDENTIFIER.test(value) ? value : undefined; }
function provenance(): Provenance {
  return Object.freeze({ mode_confidence: "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO", namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN" });
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
function readArray(value: unknown, maximum: number): unknown[] {
  const result = readArrayLoose(value);
  if (!result || result.length > maximum) throw new TypeError();
  return result;
}
function readArrayLoose(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 64) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) return null;
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]?.value);
}
function inferImageMimeType(value: string): string | null {
  let pathname: string;
  try { pathname = new URL(value).pathname; } catch { return null; }
  const extension = /\.([A-Za-z0-9]{1,8})$/u.exec(pathname)?.[1]?.toLowerCase();
  switch (extension) {
    case "jpg": case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "avif": return "image/avif";
    default: return null;
  }
}
