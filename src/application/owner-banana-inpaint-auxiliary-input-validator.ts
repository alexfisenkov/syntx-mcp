import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  inspectBoundedOwnerClarityAvifBytesWithMax,
  UnsupportedOwnerClarityAvifCompositionError
} from "./owner-clarity-upscale-input-validator.js";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { inspectOwnerStandardHeifBytes, OwnerStandardHeifInspectorError } from "./owner-standard-heif-inspector.js";
import { inspectOwnerSeedreamExtraImageBytes, OwnerSeedreamExtraImageInspectorError } from "./owner-seedream-extra-image-inspector.js";

const LOCAL_RESOURCE_BOUND_BYTES = 50 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(LOCAL_RESOURCE_BOUND_BYTES / 3) * 4;
const MAX_FILENAME_UTF8_BYTES = 255;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const VARIANTS = Object.freeze(["banana", "banana2", "banana3", "banana3_light"] as const);
const MIME_TYPES = Object.freeze([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif",
  "image/heic", "image/heif", "image/bmp", "image/gif", "image/tiff"
] as const);
const PARSER_LIMITS = Object.freeze({
  common: LOCAL_RESOURCE_BOUND_BYTES,
  avif: 25 * 1024 * 1024,
  seedream_extra: 32 * 1024 * 1024,
  heif: 32 * 1024 * 1024
} as const);
const FILENAME_DELIMITERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/u;
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export type OwnerBananaInpaintAuxiliaryOriginalMimeType = typeof MIME_TYPES[number];
export type OwnerBananaInpaintAuxiliaryCanonicalMimeType = Exclude<OwnerBananaInpaintAuxiliaryOriginalMimeType, "image/jpg">;
export type OwnerBananaInpaintAuxiliaryVariant = typeof VARIANTS[number];

export const OWNER_BANANA_INPAINT_AUXILIARY_INPUT_POLICY = Object.freeze({
  accepted_local_original_mime_types: MIME_TYPES,
  canonical_jpg_alias: "image/jpg -> image/jpeg" as const,
  local_resource_bound_bytes: LOCAL_RESOURCE_BOUND_BYTES,
  size_policy: "LOCAL_RESOURCE_BOUND_ONLY" as const,
  parser_limits: PARSER_LIMITS,
  source_picker_hint: "image/*" as const,
  source_picker_hint_is_backend_permission: false as const,
  source_upload_size_limit: "UNKNOWN" as const,
  source_or_provider_mime_acceptance: "UNPROVEN" as const,
  unsupported_picker_examples: Object.freeze(["image/svg+xml", "image/x-icon", "OTHER_UNIMPLEMENTED_IMAGE_WILDCARD_FORMATS"] as const),
  svg_execution: false as const,
  metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
  backend_acceptance: "UNPROVEN" as const
});

export interface ValidatedOwnerBananaInpaintAuxiliaryImage {
  readonly variant: OwnerBananaInpaintAuxiliaryVariant;
  readonly kind: "auxiliary_image";
  /** Owned exact-sized snapshot; the upload service must wipe it after the native call. */
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly original_mime_type: OwnerBananaInpaintAuxiliaryOriginalMimeType;
  readonly mime_type: OwnerBananaInpaintAuxiliaryCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly validation_confidence: string;
  readonly byte_limit_scope: "LOCAL_RESOURCE_BOUND_ONLY_NOT_SOURCE_UI_OR_PROVIDER_LIMIT";
  readonly pixel_decode_verified: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerBananaInpaintAuxiliaryInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_IMAGE_FORMAT" | "UNSUPPORTED_IMAGE_COMPOSITION") {
    super("The Banana Inpaint auxiliary image is invalid, unsupported, or exceeds a local resource bound.");
    this.name = "OwnerBananaInpaintAuxiliaryInputError";
  }
}

/** Validates explicit image bytes against bounded local container inspectors, not source/backend MIME authority. */
export function validateOwnerBananaInpaintAuxiliaryInput(input: unknown): Readonly<ValidatedOwnerBananaInpaintAuxiliaryImage> {
  let decoded: Buffer | undefined;
  let owned: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, "content_base64");
    const metadata = validateMetadata(fields.variant, fields.filename, fields.mime_type);
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0) invalid();
    if (fields.content_base64.length > MAX_BASE64_CHARS) localLimit();
    if (fields.content_base64.length % 4 !== 0 || !BASE64_PATTERN.test(fields.content_base64)) invalid();
    decoded = Buffer.from(fields.content_base64, "base64");
    if (decoded.byteLength < 1 || decoded.toString("base64") !== fields.content_base64) invalid();
    if (decoded.byteLength > LOCAL_RESOURCE_BOUND_BYTES) localLimit();
    owned = copyBytes(decoded, decoded.byteLength);
    decoded.fill(0); decoded = undefined;
    const result = validateOwnedBytes(metadata, owned);
    owned = undefined;
    return result;
  } catch (error) {
    decoded?.fill(0); owned?.fill(0);
    if (error instanceof OwnerBananaInpaintAuxiliaryInputError) throw error;
    if (error instanceof UnsupportedOwnerClarityAvifCompositionError ||
        error instanceof OwnerStandardHeifInspectorError && error.code === "UNSUPPORTED_HEIF_COMPOSITION" ||
        error instanceof OwnerSeedreamExtraImageInspectorError && error.code === "UNSUPPORTED_IMAGE_COMPOSITION") unsupportedComposition();
    return invalid();
  }
}

/** Validates and snapshots the caller's raw bytes without mutating their buffer. */
export function validateOwnerBananaInpaintAuxiliaryUploadData(input: unknown): Readonly<ValidatedOwnerBananaInpaintAuxiliaryImage> {
  let owned: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, "bytes");
    const metadata = validateMetadata(fields.variant, fields.filename, fields.mime_type);
    const sourceLength = getUint8ArrayLength(fields.bytes);
    if (sourceLength < 1) invalid();
    if (sourceLength > LOCAL_RESOURCE_BOUND_BYTES) localLimit();
    owned = copyBytes(fields.bytes as Uint8Array, sourceLength);
    const result = validateOwnedBytes(metadata, owned);
    owned = undefined;
    return result;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerBananaInpaintAuxiliaryInputError) throw error;
    if (error instanceof UnsupportedOwnerClarityAvifCompositionError ||
        error instanceof OwnerStandardHeifInspectorError && error.code === "UNSUPPORTED_HEIF_COMPOSITION" ||
        error instanceof OwnerSeedreamExtraImageInspectorError && error.code === "UNSUPPORTED_IMAGE_COMPOSITION") unsupportedComposition();
    return invalid();
  }
}

interface ImageMetadata {
  readonly variant: OwnerBananaInpaintAuxiliaryVariant;
  readonly filename: string;
  readonly originalMime: OwnerBananaInpaintAuxiliaryOriginalMimeType;
  readonly canonicalMime: OwnerBananaInpaintAuxiliaryCanonicalMimeType;
}

function validateMetadata(variant: unknown, filename: unknown, mimeType: unknown): ImageMetadata {
  if (typeof variant !== "string" || !(VARIANTS as readonly string[]).includes(variant)) invalid();
  if (typeof filename !== "string" || !isSafeFilename(filename)) invalid();
  if (typeof mimeType !== "string" || !(MIME_TYPES as readonly string[]).includes(mimeType)) {
    if (typeof mimeType === "string" && mimeType.startsWith("image/")) unsupportedFormat();
    invalid();
  }
  const originalMime = mimeType as OwnerBananaInpaintAuxiliaryOriginalMimeType;
  return Object.freeze({
    variant: variant as OwnerBananaInpaintAuxiliaryVariant,
    filename,
    originalMime,
    canonicalMime: (originalMime === "image/jpg" ? "image/jpeg" : originalMime) as OwnerBananaInpaintAuxiliaryCanonicalMimeType
  });
}

function validateOwnedBytes(metadata: ImageMetadata, bytes: Uint8Array): Readonly<ValidatedOwnerBananaInpaintAuxiliaryImage> {
  try {
    const maxBytes = maxBytesForMime(metadata.canonicalMime);
    if (bytes.byteLength > maxBytes) localLimit();
    const parsed = inspectImage(bytes, metadata.canonicalMime, maxBytes);
    if (parsed.mime !== metadata.canonicalMime || !Number.isSafeInteger(parsed.width) || parsed.width < 1 ||
        !Number.isSafeInteger(parsed.height) || parsed.height < 1) invalid();
    const digest = createHash("sha256").update(bytes).digest("hex");
    return Object.freeze({
      variant: metadata.variant, kind: "auxiliary_image", bytes, filename: metadata.filename,
      original_mime_type: metadata.originalMime, mime_type: metadata.canonicalMime,
      width: parsed.width, height: parsed.height, size: bytes.byteLength, sha256: `sha256:${digest}`,
      metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
      validation_confidence: parsed.validationConfidence,
      byte_limit_scope: "LOCAL_RESOURCE_BOUND_ONLY_NOT_SOURCE_UI_OR_PROVIDER_LIMIT",
      pixel_decode_verified: false, backend_acceptance: "UNPROVEN"
    });
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

function inspectImage(bytes: Uint8Array, mime: OwnerBananaInpaintAuxiliaryCanonicalMimeType, maxBytes: number): {
  readonly mime: OwnerBananaInpaintAuxiliaryCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly validationConfidence: string;
} {
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") {
    const parsed = inspectBoundedOwnerImageBytesWithMax(bytes, maxBytes);
    return { ...parsed, validationConfidence: "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY" };
  }
  if (mime === "image/avif") return {
    ...inspectBoundedOwnerClarityAvifBytesWithMax(bytes, maxBytes),
    validationConfidence: "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY"
  };
  if (mime === "image/heic" || mime === "image/heif") {
    const parsed = inspectOwnerStandardHeifBytes(bytes, mime);
    return { ...parsed, validationConfidence: parsed.validation_confidence };
  }
  if (mime === "image/bmp" || mime === "image/gif" || mime === "image/tiff") {
    const parsed = inspectOwnerSeedreamExtraImageBytes(bytes, mime);
    return { ...parsed, validationConfidence: parsed.validation_confidence };
  }
  return unsupportedFormat();
}

function maxBytesForMime(mime: OwnerBananaInpaintAuxiliaryCanonicalMimeType): number {
  if (mime === "image/avif") return PARSER_LIMITS.avif;
  if (mime === "image/heic" || mime === "image/heif") return PARSER_LIMITS.heif;
  if (mime === "image/bmp" || mime === "image/gif" || mime === "image/tiff") return PARSER_LIMITS.seedream_extra;
  return LOCAL_RESOURCE_BOUND_BYTES;
}

function exactRecord(input: unknown, byteKey: "bytes" | "content_base64"): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) invalid();
  const prototype = Object.getPrototypeOf(input);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  const allowed = ["variant", byteKey, "filename", "mime_type"];
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== allowed.length ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) ||
        descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function getUint8ArrayLength(value: unknown): number {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !types.isUint8Array(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "length")) invalid();
  let buffer: ArrayBufferLike, offset: number, length: number;
  try {
    buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBufferLike;
    offset = Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number;
    length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number;
  } catch { return invalid(); }
  if (!types.isArrayBuffer(buffer) || types.isProxy(buffer) || Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || Object.hasOwn(buffer, "byteLength")) invalid();
  let backingLength: number;
  try { backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, buffer, []) as number; }
  catch { return invalid(); }
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset) || offset < 0 ||
      offset > backingLength || length > backingLength - offset) invalid();
  return length;
}

function copyBytes(source: Uint8Array, length: number): Uint8Array {
  const copy = new Uint8Array(length);
  try { Uint8Array.prototype.set.call(copy, source); return copy; }
  catch (error) { copy.fill(0); throw error; }
}

function isSafeFilename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || FILENAME_DELIMITERS.test(value) ||
      RESERVED_WINDOWS_BASENAME.test(value)) return false;
  const encoded = Buffer.from(value, "utf8");
  return encoded.toString("utf8") === value && encoded.byteLength <= MAX_FILENAME_UTF8_BYTES;
}

function invalid(): never { throw new OwnerBananaInpaintAuxiliaryInputError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerBananaInpaintAuxiliaryInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
function unsupportedFormat(): never { throw new OwnerBananaInpaintAuxiliaryInputError("UNSUPPORTED_IMAGE_FORMAT"); }
function unsupportedComposition(): never { throw new OwnerBananaInpaintAuxiliaryInputError("UNSUPPORTED_IMAGE_COMPOSITION"); }
