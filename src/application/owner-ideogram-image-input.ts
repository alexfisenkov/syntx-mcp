import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { inspectBoundedOwnerClarityAvifBytesWithMax, UnsupportedOwnerClarityAvifCompositionError } from "./owner-clarity-upscale-input-validator.js";

const MIB = 1024 * 1024;
const LOCAL_MAX_BYTES = 64 * MIB;
const MAX_FILENAME_UTF8_BYTES = 255;
const SOURCE_MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const);
const V4_MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp"] as const);
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const PORTABLE_FILENAME_DELIMITERS = /[<>:"/\\|?*]/u;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export type OwnerIdeogramImageModelId = "ideogram" | "ideogram_40" | "ideogram_45";
export type OwnerIdeogramSourceImageMimeType = typeof SOURCE_MIME_TYPES[number];
export type OwnerIdeogramCanonicalImageMimeType = Exclude<OwnerIdeogramSourceImageMimeType, "image/jpg">;

interface ModelPolicy {
  readonly accepted_mime_types: readonly OwnerIdeogramSourceImageMimeType[];
  readonly source_max_bytes: number;
  readonly local_max_bytes: number;
}

export const OWNER_IDEOGRAM_IMAGE_INPUT_POLICY: Readonly<{
  models: Readonly<Record<OwnerIdeogramImageModelId, ModelPolicy>>;
  local_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
  metadata_confidence: "CONTAINER_METADATA_ONLY";
}> = Object.freeze({
  models: Object.freeze({
    ideogram: Object.freeze({ accepted_mime_types: SOURCE_MIME_TYPES, source_max_bytes: 0, local_max_bytes: LOCAL_MAX_BYTES }),
    ideogram_40: Object.freeze({ accepted_mime_types: V4_MIME_TYPES, source_max_bytes: 50 * MIB, local_max_bytes: LOCAL_MAX_BYTES }),
    ideogram_45: Object.freeze({ accepted_mime_types: V4_MIME_TYPES, source_max_bytes: 25 * MIB, local_max_bytes: LOCAL_MAX_BYTES })
  }),
  local_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
  metadata_confidence: "CONTAINER_METADATA_ONLY"
});

export interface OwnerIdeogramImageInput {
  readonly model_id: OwnerIdeogramImageModelId;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: OwnerIdeogramSourceImageMimeType;
}

export interface ValidatedOwnerIdeogramImageInput {
  readonly model_id: OwnerIdeogramImageModelId;
  /** Consumer-owned mutable bytes. Wipe when the local upload lifecycle ends. */
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly original_mime_type: OwnerIdeogramSourceImageMimeType;
  readonly mime_type: OwnerIdeogramCanonicalImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly dimensions_proof: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly validation_scope: "LOCAL_INPUT_VALIDATION_ONLY_NOT_PROVIDER_ACCEPTANCE";
}

export class OwnerIdeogramImageInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The owner Ideogram image input is invalid or exceeds local processing limits.");
    this.name = "OwnerIdeogramImageInputError";
  }
}

/** Validates source-declared Ideogram inputs using bounded container metadata only. */
export function validateOwnerIdeogramImageInput(input: unknown): ValidatedOwnerIdeogramImageInput {
  let decoded: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "content_base64", "filename", "mime_type"]);
    const modelId = readModelId(fields.model_id);
    const policy = OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models[modelId];
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0 ||
        typeof fields.filename !== "string" || !isSafeFilename(fields.filename) ||
        typeof fields.mime_type !== "string" || !policy.accepted_mime_types.includes(fields.mime_type as OwnerIdeogramSourceImageMimeType)) invalid();
    const mimeType = fields.mime_type as OwnerIdeogramSourceImageMimeType;
    const maxBytes = effectiveMaxBytes(policy);
    const maxBase64Chars = Math.ceil(maxBytes / 3) * 4;
    if (fields.content_base64.length > maxBase64Chars) byteLimit(modelId, policy);
    if (fields.content_base64.length % 4 !== 0 || !CANONICAL_BASE64.test(fields.content_base64)) invalid();
    decoded = Buffer.from(fields.content_base64, "base64");
    if (decoded.byteLength < 1 || decoded.byteLength > maxBytes) byteLimit(modelId, policy);
    if (decoded.toString("base64") !== fields.content_base64) invalid();
    const result = validateOwnedBytes(modelId, decoded, fields.filename, mimeType);
    decoded.fill(0);
    decoded = undefined;
    return result;
  } catch (error) {
    decoded?.fill(0);
    if (error instanceof OwnerIdeogramImageInputError) throw error;
    if (error instanceof UnsupportedOwnerClarityAvifCompositionError) invalid();
    invalid();
  }
}

/** Copies caller bytes first, then validates and returns only the exact consumer-owned copy. */
export function validateOwnerIdeogramImageUploadData(input: unknown): ValidatedOwnerIdeogramImageInput {
  let ownedBytes: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "bytes", "filename", "mime_type"]);
    const modelId = readModelId(fields.model_id);
    const policy = OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models[modelId];
    if (types.isProxy(fields.bytes) || !(fields.bytes instanceof Uint8Array) ||
        (Object.getPrototypeOf(fields.bytes) !== Uint8Array.prototype && Object.getPrototypeOf(fields.bytes) !== Buffer.prototype) ||
        hasShadowedTypedArrayFields(fields.bytes) || typeof fields.filename !== "string" || !isSafeFilename(fields.filename) ||
        typeof fields.mime_type !== "string" || !policy.accepted_mime_types.includes(fields.mime_type as OwnerIdeogramSourceImageMimeType)) invalid();

    const sourceBuffer = typedArrayBuffer(fields.bytes);
    const sourceOffset = typedArrayByteOffset(fields.bytes);
    const sourceLength = typedArrayByteLength(fields.bytes);
    const maxBytes = effectiveMaxBytes(policy);
    if (types.isProxy(sourceBuffer) || Object.getPrototypeOf(sourceBuffer) !== ArrayBuffer.prototype ||
        Object.hasOwn(sourceBuffer, "byteLength") || sourceLength < 1 || sourceOffset < 0 ||
        sourceOffset + sourceLength > arrayBufferByteLength(sourceBuffer)) invalid();
    if (sourceLength > maxBytes) byteLimit(modelId, policy);
    ownedBytes = new Uint8Array(sourceLength);
    ownedBytes.set(new Uint8Array(sourceBuffer, sourceOffset, sourceLength));
    const result = validateOwnedBytes(modelId, ownedBytes, fields.filename, fields.mime_type as OwnerIdeogramSourceImageMimeType);
    ownedBytes = undefined;
    return result;
  } catch (error) {
    ownedBytes?.fill(0);
    if (error instanceof OwnerIdeogramImageInputError) throw error;
    if (error instanceof UnsupportedOwnerClarityAvifCompositionError) invalid();
    invalid();
  }
}

const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function validateOwnedBytes(
  modelId: OwnerIdeogramImageModelId,
  bytes: Uint8Array,
  filename: string,
  sourceMime: OwnerIdeogramSourceImageMimeType
): ValidatedOwnerIdeogramImageInput {
  let consumerBytes: Uint8Array | undefined;
  try {
    const maxBytes = effectiveMaxBytes(OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models[modelId]);
    const canonicalMime: OwnerIdeogramCanonicalImageMimeType = sourceMime === "image/jpg" ? "image/jpeg" : sourceMime;
    const parsed = canonicalMime === "image/avif"
      ? inspectBoundedOwnerClarityAvifBytesWithMax(bytes, maxBytes)
      : inspectBoundedOwnerImageBytesWithMax(bytes, maxBytes);
    if (parsed.mime !== canonicalMime || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < 1 || parsed.height < 1) invalid();
    const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
    consumerBytes = new Uint8Array(bytes.byteLength);
    consumerBytes.set(bytes);
    const result: ValidatedOwnerIdeogramImageInput = Object.freeze({
      model_id: modelId, bytes: consumerBytes, filename, original_mime_type: sourceMime, mime_type: parsed.mime,
      width: parsed.width, height: parsed.height, size: consumerBytes.byteLength, sha256,
      metadata_confidence: "CONTAINER_METADATA_ONLY",
      dimensions_proof: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
      validation_scope: "LOCAL_INPUT_VALIDATION_ONLY_NOT_PROVIDER_ACCEPTANCE"
    });
    bytes.fill(0);
    return result;
  } catch (error) {
    consumerBytes?.fill(0);
    bytes.fill(0);
    if (error instanceof OwnerIdeogramImageInputError) throw error;
    if (error instanceof UnsupportedOwnerClarityAvifCompositionError) invalid();
    invalid();
  }
}

function effectiveMaxBytes(policy: ModelPolicy): number {
  return policy.source_max_bytes === 0 ? policy.local_max_bytes : Math.min(policy.source_max_bytes, policy.local_max_bytes);
}

function byteLimit(modelId: OwnerIdeogramImageModelId, policy: ModelPolicy): never {
  if (modelId === "ideogram" && policy.source_max_bytes === 0) {
    throw new OwnerIdeogramImageInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED");
  }
  throw new OwnerIdeogramImageInputError("INVALID_IMAGE_INPUT");
}

function readModelId(value: unknown): OwnerIdeogramImageModelId {
  if (typeof value !== "string" || !Object.hasOwn(OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models, value)) invalid();
  return value as OwnerIdeogramImageModelId;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!))) invalid();
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) snapshot[key] = descriptors[key]!.value;
  return snapshot;
}

function hasShadowedTypedArrayFields(bytes: Uint8Array): boolean {
  return Object.hasOwn(bytes, "buffer") || Object.hasOwn(bytes, "byteLength") ||
    Object.hasOwn(bytes, "byteOffset") || Object.hasOwn(bytes, "length");
}

function typedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, bytes, []) as ArrayBuffer;
}
function typedArrayByteOffset(bytes: Uint8Array): number {
  return Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, bytes, []) as number;
}
function typedArrayByteLength(bytes: Uint8Array): number {
  return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, bytes, []) as number;
}
function arrayBufferByteLength(buffer: ArrayBuffer): number {
  return Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []) as number;
}

function isSafeFilename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || value !== value.trimEnd() || value.endsWith(".") ||
      /\p{Cc}/u.test(value) || PORTABLE_FILENAME_DELIMITERS.test(value) || RESERVED_WINDOWS_BASENAME.test(value) || !isWellFormedUnicode(value)) return false;
  return Buffer.byteLength(value, "utf8") <= MAX_FILENAME_UTF8_BYTES;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function invalid(): never { throw new OwnerIdeogramImageInputError("INVALID_IMAGE_INPUT"); }
