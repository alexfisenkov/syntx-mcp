import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytes32MiB } from "./owner-image-reference-input-validator.js";
import { inspectBoundedOwnerClarityAvifBytes32MiB } from "./owner-clarity-upscale-input-validator.js";

const VARIANTS = Object.freeze(["runway_frames", "flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"] as const);
const SOURCE_MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"] as const);
const MAX_LOCAL_BYTES = 32 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_LOCAL_BYTES / 3) * 4;
const MAX_FILENAME_UTF8_BYTES = 255;
const SAFE_FILENAME_DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export type OwnerRunwayFluxImageVariant = typeof VARIANTS[number];
export type OwnerRunwayFluxSourceImageMimeType = typeof SOURCE_MIME_TYPES[number];
export type OwnerRunwayFluxCanonicalImageMimeType = Exclude<OwnerRunwayFluxSourceImageMimeType, "image/jpg">;

export const OWNER_RUNWAY_FLUX_IMAGE_INPUT_POLICY = Object.freeze({
  variants: Object.freeze(["runway_frames", "flux-1"] as const),
  rejected_variants: Object.freeze(["flux-pro-1.1", "flux-pro-1.1-ultra"] as const),
  source_mime_types: SOURCE_MIME_TYPES,
  jpg_alias: "image/jpg -> image/jpeg" as const,
  max_local_bytes: MAX_LOCAL_BYTES,
  limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
  provider_size_limit: "UNKNOWN" as const,
  metadata_confidence: "CONTAINER_METADATA_ONLY" as const
});

export interface ValidatedOwnerRunwayFluxImageInput {
  readonly variant: OwnerRunwayFluxImageVariant;
  /** Consumer-owned mutable bytes; wipe when the upload/request lifecycle ends. */
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly source_mime_type: OwnerRunwayFluxSourceImageMimeType;
  readonly mime_type: OwnerRunwayFluxCanonicalImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export class OwnerRunwayFluxImageInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The owner Runway/Flux image input is invalid or exceeds the local resource ceiling.");
    this.name = "OwnerRunwayFluxImageInputError";
  }
}

/** Validates an exact base64 DTO for Runway Frames or Flux 1; no provider-size limit is inferred. */
export function validateOwnerRunwayFluxImageInput(input: unknown): ValidatedOwnerRunwayFluxImageInput {
  let decoded: Buffer | undefined;
  let ownedBytes: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["variant", "content_base64", "filename", "mime_type"]);
    const variant = readVariant(fields.variant);
    if (!isInputVariant(variant)) invalid();
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0) invalid();
    if (fields.content_base64.length > MAX_BASE64_CHARS) localLimit();
    if (fields.content_base64.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(fields.content_base64) ||
        typeof fields.filename !== "string" || !isSafeFilename(fields.filename) ||
        typeof fields.mime_type !== "string" || !SOURCE_MIME_TYPES.includes(fields.mime_type as OwnerRunwayFluxSourceImageMimeType)) invalid();

    decoded = Buffer.from(fields.content_base64, "base64");
    if (decoded.byteLength > MAX_LOCAL_BYTES) localLimit();
    if (decoded.byteLength === 0 || decoded.toString("base64") !== fields.content_base64) invalid();
    ownedBytes = new Uint8Array(decoded.byteLength);
    ownedBytes.set(decoded);
    decoded.fill(0);
    decoded = undefined;

    const result = validateOwnedBytes(variant, ownedBytes, fields.filename, fields.mime_type as OwnerRunwayFluxSourceImageMimeType);
    ownedBytes = undefined;
    return result;
  } catch (error) {
    decoded?.fill(0);
    ownedBytes?.fill(0);
    if (error instanceof OwnerRunwayFluxImageInputError) throw error;
    invalid();
  }
}

/** Validates raw bytes without a base64 round trip and returns an exact-sized consumer-owned copy. */
export function validateOwnerRunwayFluxImageUploadData(input: unknown): ValidatedOwnerRunwayFluxImageInput {
  let ownedBytes: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["variant", "bytes", "filename", "mime_type"]);
    const variant = readVariant(fields.variant);
    if (!isInputVariant(variant) || types.isProxy(fields.bytes) || !(fields.bytes instanceof Uint8Array) ||
        (Object.getPrototypeOf(fields.bytes) !== Uint8Array.prototype && Object.getPrototypeOf(fields.bytes) !== Buffer.prototype) ||
        hasShadowedTypedArrayFields(fields.bytes) || typeof fields.filename !== "string" || !isSafeFilename(fields.filename) ||
        typeof fields.mime_type !== "string" || !SOURCE_MIME_TYPES.includes(fields.mime_type as OwnerRunwayFluxSourceImageMimeType)) invalid();

    const sourceBuffer = typedArrayBuffer(fields.bytes);
    const sourceOffset = typedArrayByteOffset(fields.bytes);
    const sourceLength = typedArrayByteLength(fields.bytes);
    if (types.isProxy(sourceBuffer) || Object.getPrototypeOf(sourceBuffer) !== ArrayBuffer.prototype ||
        Object.hasOwn(sourceBuffer, "byteLength") || sourceLength < 1 || sourceLength > MAX_LOCAL_BYTES ||
        sourceOffset < 0 || sourceOffset + sourceLength > arrayBufferByteLength(sourceBuffer)) {
      if (sourceLength > MAX_LOCAL_BYTES) localLimit();
      invalid();
    }
    ownedBytes = new Uint8Array(sourceLength);
    ownedBytes.set(new Uint8Array(sourceBuffer, sourceOffset, sourceLength));
    const result = validateOwnedBytes(variant, ownedBytes, fields.filename, fields.mime_type as OwnerRunwayFluxSourceImageMimeType);
    ownedBytes = undefined;
    return result;
  } catch (error) {
    ownedBytes?.fill(0);
    if (error instanceof OwnerRunwayFluxImageInputError) throw error;
    invalid();
  }
}

function validateOwnedBytes(
  variant: OwnerRunwayFluxImageVariant,
  bytes: Uint8Array,
  filename: string,
  sourceMime: OwnerRunwayFluxSourceImageMimeType
): ValidatedOwnerRunwayFluxImageInput {
  try {
    const canonicalMime: OwnerRunwayFluxCanonicalImageMimeType = sourceMime === "image/jpg" ? "image/jpeg" : sourceMime;
    const parsed = canonicalMime === "image/avif"
      ? inspectBoundedOwnerClarityAvifBytes32MiB(bytes, MAX_LOCAL_BYTES)
      : inspectBoundedOwnerImageBytes32MiB(bytes, MAX_LOCAL_BYTES);
    if (parsed.mime !== canonicalMime || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < 1 || parsed.height < 1) invalid();
    const digest = createHash("sha256").update(bytes).digest("hex");
    return Object.freeze({
      variant, bytes, filename, source_mime_type: sourceMime, mime_type: canonicalMime,
      width: parsed.width, height: parsed.height, size: bytes.byteLength,
      sha256: `sha256:${digest}`, metadata_confidence: "CONTAINER_METADATA_ONLY"
    });
  } catch (error) {
    bytes.fill(0);
    if (error instanceof OwnerRunwayFluxImageInputError) throw error;
    invalid();
  }
}

function readVariant(value: unknown): OwnerRunwayFluxImageVariant {
  if (typeof value !== "string" || !VARIANTS.includes(value as OwnerRunwayFluxImageVariant)) invalid();
  return value as OwnerRunwayFluxImageVariant;
}

function isInputVariant(variant: OwnerRunwayFluxImageVariant): variant is "runway_frames" | "flux-1" {
  return variant === "runway_frames" || variant === "flux-1";
}

function isSafeFilename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || value !== value.trimEnd() || value.endsWith(".") ||
      /\p{Cc}/u.test(value) || SAFE_FILENAME_DELIMITERS.test(value) || RESERVED_WINDOWS_BASENAME.test(value) ||
      !isWellFormedUnicode(value)) return false;
  return Buffer.byteLength(value, "utf8") <= MAX_FILENAME_UTF8_BYTES;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
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

function invalid(): never { throw new OwnerRunwayFluxImageInputError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerRunwayFluxImageInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
