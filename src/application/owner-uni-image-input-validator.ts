import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import {
  inspectBoundedOwnerClarityAvifBytesWithMax,
  UnsupportedOwnerClarityAvifCompositionError
} from "./owner-clarity-upscale-input-validator.js";

const MAX_BYTES = 26_214_400;
const MAX_BASE64_CHARS = Math.ceil(MAX_BYTES / 3) * 4;
const MAX_FILENAME_UTF8_BYTES = 255;
const INPUT_MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"] as const);
const FILENAME_DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export const OWNER_UNI_IMAGE_INPUT_POLICY = Object.freeze({
  local_max_bytes: MAX_BYTES,
  local_max_bytes_policy: "SELECTED_PUBLIC_METADATA_LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
  source_max_bytes: "UNKNOWN" as const,
  provider_max_bytes: "UNKNOWN" as const,
  accepted_mime_types: INPUT_MIME_TYPES,
  filename_utf8_max_bytes: MAX_FILENAME_UTF8_BYTES,
  filename_policy: "LOCAL_PORTABLE_BASENAME_ONLY" as const
});

export type OwnerUniImageOriginalMimeType = typeof INPUT_MIME_TYPES[number];
export type OwnerUniImageCanonicalMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/avif";
export type OwnerUniImageValidationConfidence =
  | "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY"
  | "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY";

export interface ValidatedOwnerUniImageInput {
  /** Exact-sized consumer-owned mutable copy; callers must wipe it after use. */
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly original_mime_type: OwnerUniImageOriginalMimeType;
  readonly mime_type: OwnerUniImageCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly validation_confidence: OwnerUniImageValidationConfidence;
}

export class OwnerUniImageInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_AVIF_COMPOSITION") {
    super("The owner Uni image input is invalid or unsupported.");
    this.name = "OwnerUniImageInputError";
  }
}

/** Validates a strict base64 request and returns a private, bounded image-byte snapshot. */
export function validateOwnerUniImageInput(input: unknown): ValidatedOwnerUniImageInput {
  let decoded: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["content_base64", "filename", "mime_type"]);
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0) invalid();
    if (fields.content_base64.length > MAX_BASE64_CHARS) limit();
    if (!hasCanonicalBase64AlphabetAndPadding(fields.content_base64) ||
        typeof fields.filename !== "string" || !isSafePortableBasename(fields.filename) ||
        typeof fields.mime_type !== "string" || !INPUT_MIME_TYPES.includes(fields.mime_type as OwnerUniImageOriginalMimeType)) invalid();

    decoded = Buffer.from(fields.content_base64, "base64");
    if (decoded.byteLength > MAX_BYTES) limit();
    if (decoded.byteLength < 1 || decoded.toString("base64") !== fields.content_base64) invalid();
    const result = validateOwned(decoded, fields.filename, fields.mime_type as OwnerUniImageOriginalMimeType);
    decoded.fill(0);
    decoded = undefined;
    return result;
  } catch (error) {
    decoded?.fill(0);
    mapError(error);
  }
}

/** Validates raw bytes and snapshots only the supplied view into an exact-sized owned buffer. */
export function validateOwnerUniImageUploadData(input: unknown): ValidatedOwnerUniImageInput {
  let owned: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["bytes", "filename", "mime_type"]);
    const source = fields.bytes;
    if (typeof fields.filename !== "string" || !isSafePortableBasename(fields.filename) ||
        typeof fields.mime_type !== "string" || !INPUT_MIME_TYPES.includes(fields.mime_type as OwnerUniImageOriginalMimeType) ||
        types.isProxy(source) || !(source instanceof Uint8Array) ||
        (Object.getPrototypeOf(source) !== Uint8Array.prototype && Object.getPrototypeOf(source) !== Buffer.prototype) || hasShadowedViewProperties(source)) invalid();

    const backing = getBuffer(source);
    const offset = getOffset(source);
    const size = getLength(source);
    const backingLength = getArrayBufferLength(backing);
    if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || Object.hasOwn(backing, "byteLength") ||
        !Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES || offset < 0 || offset + size > backingLength) {
      if (Number.isSafeInteger(size) && size > MAX_BYTES) limit();
      invalid();
    }
    owned = new Uint8Array(size);
    owned.set(new Uint8Array(backing, offset, size));
    const result = validateOwned(owned, fields.filename, fields.mime_type as OwnerUniImageOriginalMimeType);
    owned = undefined;
    return result;
  } catch (error) {
    owned?.fill(0);
    mapError(error);
  }
}

function validateOwned(bytes: Uint8Array, filename: string, originalMime: OwnerUniImageOriginalMimeType): ValidatedOwnerUniImageInput {
  try {
    const mime = originalMime === "image/jpg" ? "image/jpeg" : originalMime;
    const parsed = mime === "image/avif"
      ? inspectBoundedOwnerClarityAvifBytesWithMax(bytes, MAX_BYTES)
      : inspectBoundedOwnerImageBytesWithMax(bytes, MAX_BYTES);
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || parsed.width < 1 ||
        !Number.isSafeInteger(parsed.height) || parsed.height < 1) invalid();
    const snapshot = new Uint8Array(bytes);
    const result = Object.freeze({
      bytes: snapshot,
      filename,
      original_mime_type: originalMime,
      mime_type: mime,
      width: parsed.width,
      height: parsed.height,
      size: bytes.byteLength,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      metadata_confidence: "CONTAINER_METADATA_ONLY",
      validation_confidence: mime === "image/avif" ? "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY" : "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY"
    });
    bytes.fill(0);
    return result;
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) =>
    typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true
  )) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isSafePortableBasename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || value !== value.trimEnd() || value.endsWith(".") ||
      /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) || FILENAME_DELIMITERS.test(value) || RESERVED_WINDOWS_BASENAME.test(value) || !isWellFormedUnicode(value)) return false;
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
function hasShadowedViewProperties(value: Uint8Array): boolean {
  return Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length");
}
function hasCanonicalBase64AlphabetAndPadding(value: string): boolean {
  const length = value.length;
  if (length === 0 || length % 4 !== 0) return false;
  let padding = 0;
  for (let index = 0; index < length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x3d) {
      padding += 1;
      if (index < length - 2 || padding > 2) return false;
      continue;
    }
    if (padding !== 0 || !((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) ||
        (code >= 0x30 && code <= 0x39) || code === 0x2b || code === 0x2f)) return false;
  }
  return padding !== 2 || (value.charCodeAt(length - 1) === 0x3d && value.charCodeAt(length - 2) === 0x3d);
}
function getBuffer(value: Uint8Array): ArrayBuffer { return Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer; }
function getOffset(value: Uint8Array): number { return Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number; }
function getLength(value: Uint8Array): number { return Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number; }
function getArrayBufferLength(value: ArrayBuffer): number { return Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, value, []) as number; }

function mapError(error: unknown): never {
  if (error instanceof OwnerUniImageInputError) throw error;
  if (error instanceof UnsupportedOwnerClarityAvifCompositionError) throw new OwnerUniImageInputError("UNSUPPORTED_AVIF_COMPOSITION");
  invalid();
}
function invalid(): never { throw new OwnerUniImageInputError("INVALID_IMAGE_INPUT"); }
function limit(): never { throw new OwnerUniImageInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
