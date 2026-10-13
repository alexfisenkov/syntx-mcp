import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  inspectOwnerStandardImageAuxContainer,
  OwnerStandardImageAuxContainerError
} from "./owner-standard-image-aux-container-inspector.js";

const VIDEO_MIMES = Object.freeze([
  "video/mp4", "video/webm", "video/quicktime", "video/mpeg", "video/mov", "video/3gpp", "video/x-flv", "video/x-ms-wmv"
] as const);
const PDF_MIME = "application/pdf" as const;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_FILENAME_UTF8_BYTES = 255;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const TYPED_ARRAY_BYTE_OFFSET = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const ARRAY_BUFFER_BYTE_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;

export type OwnerStandardImageAuxVideoMimeType = typeof VIDEO_MIMES[number];
export type OwnerStandardImageAuxOriginalMimeType = OwnerStandardImageAuxVideoMimeType | typeof PDF_MIME;
export type OwnerStandardImageAuxCanonicalMimeType = Exclude<OwnerStandardImageAuxOriginalMimeType, "video/mov">;

export interface ValidatedOwnerStandardImageAuxInput {
  readonly variant: "banana-2.1";
  readonly kind: "video" | "file";
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly original_mime_type: OwnerStandardImageAuxOriginalMimeType;
  readonly mime_type: OwnerStandardImageAuxCanonicalMimeType;
  readonly width: null;
  readonly height: null;
  readonly duration: null;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "NOT_EXTRACTED";
  readonly validation_confidence: "STRUCTURAL_CONTAINER_VALIDATED_NOT_DECODED" | "PDF_HEADER_TAIL_GUARDS_ONLY_NOT_PARSED";
}

export class OwnerStandardImageAuxInputError extends Error {
  constructor(readonly code: "INVALID_MEDIA_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_MEDIA_CONTAINER" | "UNSUPPORTED_ENCRYPTED_PDF") {
    super("The owner media input is invalid or unsupported.");
    this.name = "OwnerStandardImageAuxInputError";
  }
}

/** Validates one Banana 2.1 video/PDF input using bounded container checks only. */
export function validateOwnerStandardImageAuxInput(input: unknown): ValidatedOwnerStandardImageAuxInput {
  let decoded: Buffer | undefined;
  let owned: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["variant", "content_base64", "filename", "mime_type"]);
    const metadata = validateMetadata(fields.variant, fields.filename, fields.mime_type);
    if (typeof fields.content_base64 !== "string") invalid();
    const maxBytes = metadata.max_bytes;
    const maxBase64Chars = Math.ceil(maxBytes / 3) * 4;
    if (fields.content_base64.length === 0) invalid();
    if (fields.content_base64.length > maxBase64Chars) localLimit();
    const padding = fields.content_base64.endsWith("==") ? 2 : fields.content_base64.endsWith("=") ? 1 : 0;
    if (fields.content_base64.length / 4 * 3 - padding > maxBytes) localLimit();
    if (fields.content_base64.length % 4 !== 0 || !BASE64_PATTERN.test(fields.content_base64)) invalid();

    decoded = Buffer.from(fields.content_base64, "base64");
    if (decoded.byteLength > maxBytes) localLimit();
    if (decoded.byteLength < 1 || decoded.toString("base64") !== fields.content_base64) invalid();

    owned = copyBytes(decoded, decoded.byteLength);
    const result = validateOwnedSnapshot(metadata, owned);
    decoded.fill(0);
    decoded = undefined;
    owned = undefined;
    return result;
  } catch (error) {
    decoded?.fill(0);
    owned?.fill(0);
    if (error instanceof OwnerStandardImageAuxInputError) throw error;
    if (error instanceof OwnerStandardImageAuxContainerError) throw new OwnerStandardImageAuxInputError(error.code);
    return invalid();
  }
}

/** Validates owned-upload bytes without a base64 round trip or mutation of caller bytes. */
export function validateOwnerStandardImageAuxUploadData(input: unknown): ValidatedOwnerStandardImageAuxInput {
  let owned: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["variant", "bytes", "filename", "mime_type"]);
    const metadata = validateMetadata(fields.variant, fields.filename, fields.mime_type);
    const length = getUint8ArrayLength(fields.bytes);
    if (length > metadata.max_bytes) localLimit();
    if (length < 1) invalid();
    owned = copyBytes(fields.bytes as Uint8Array, length);
    const result = validateOwnedSnapshot(metadata, owned);
    owned = undefined;
    return result;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerStandardImageAuxInputError) throw error;
    if (error instanceof OwnerStandardImageAuxContainerError) throw new OwnerStandardImageAuxInputError(error.code);
    return invalid();
  }
}

interface ValidatedMetadata {
  readonly variant: "banana-2.1";
  readonly filename: string;
  readonly original_mime_type: OwnerStandardImageAuxOriginalMimeType;
  readonly max_bytes: number;
}

function validateMetadata(variant: unknown, filename: unknown, mimeType: unknown): ValidatedMetadata {
  if (variant !== "banana-2.1" || typeof filename !== "string" || !isSafePortableBasename(filename) ||
      typeof mimeType !== "string" || !isSupportedMime(mimeType)) invalid();
  return {
    variant,
    filename,
    original_mime_type: mimeType,
    max_bytes: mimeType === PDF_MIME ? MAX_PDF_BYTES : MAX_VIDEO_BYTES
  };
}

function validateOwnedSnapshot(metadata: ValidatedMetadata, bytes: Uint8Array): ValidatedOwnerStandardImageAuxInput {
  try {
    const inspection = inspectOwnerStandardImageAuxContainer(bytes, metadata.original_mime_type);
    return Object.freeze({
      variant: metadata.variant,
      kind: inspection.kind,
      bytes,
      filename: metadata.filename,
      original_mime_type: metadata.original_mime_type,
      mime_type: inspection.mime_type,
      width: null,
      height: null,
      duration: null,
      size: bytes.byteLength,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      metadata_confidence: "NOT_EXTRACTED",
      validation_confidence: inspection.confidence
    });
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

function getUint8ArrayLength(value: unknown): number {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !types.isUint8Array(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) invalid();
  if (!TYPED_ARRAY_BYTE_LENGTH || !TYPED_ARRAY_BYTE_OFFSET || !TYPED_ARRAY_BUFFER || !ARRAY_BUFFER_BYTE_LENGTH) invalid();
  let length: number;
  let offset: number;
  let backing: ArrayBufferLike;
  try {
    length = TYPED_ARRAY_BYTE_LENGTH.call(value) as number;
    offset = TYPED_ARRAY_BYTE_OFFSET.call(value) as number;
    backing = TYPED_ARRAY_BUFFER.call(value) as ArrayBufferLike;
  } catch { return invalid(); }
  if (!types.isArrayBuffer(backing)) invalid();
  let backingLength: number;
  try { backingLength = ARRAY_BUFFER_BYTE_LENGTH.call(backing) as number; }
  catch { return invalid(); }
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset) || offset < 0 ||
      offset > backingLength || length > backingLength - offset) invalid();
  return length;
}

function copyBytes(source: Uint8Array, length: number): Uint8Array {
  const copy = new Uint8Array(length);
  try {
    Uint8Array.prototype.set.call(copy, source);
    if (copy.byteLength !== length) invalid();
    return copy;
  } catch (error) {
    copy.fill(0);
    throw error;
  }
}

function exactRecord(input: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || types.isProxy(input)) invalid();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function isSupportedMime(value: string): value is OwnerStandardImageAuxOriginalMimeType {
  return value === PDF_MIME || VIDEO_MIMES.includes(value as OwnerStandardImageAuxVideoMimeType);
}

function isSafePortableBasename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || /[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(value)) return false;
  const encoded = Buffer.from(value, "utf8");
  return encoded.toString("utf8") === value && encoded.byteLength <= MAX_FILENAME_UTF8_BYTES;
}

function invalid(): never {
  throw new OwnerStandardImageAuxInputError("INVALID_MEDIA_INPUT");
}

function localLimit(): never {
  throw new OwnerStandardImageAuxInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED");
}
