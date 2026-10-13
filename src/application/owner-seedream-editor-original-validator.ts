import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  inspectBoundedOwnerClarityAvifBytesWithMax,
  UnsupportedOwnerClarityAvifCompositionError
} from "./owner-clarity-upscale-input-validator.js";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { inspectOwnerSeedreamExtraImageBytes, OwnerSeedreamExtraImageInspectorError } from "./owner-seedream-extra-image-inspector.js";
import { inspectOwnerStandardHeifBytes, OwnerStandardHeifInspectorError } from "./owner-standard-heif-inspector.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";

const MIB = 1024 * 1024;
const LOCAL_PARSER_MAX_BYTES = 32 * MIB;
const MAX_FILENAME_UTF8_BYTES = 255;
const FILENAME_DELIMITERS = /[<>:"\/\\|?*]/u;
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const ACCEPTED_MIMES = Object.freeze({
  "seedream-4": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const),
  "seedream-4.5": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const),
  "seedream-5": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const),
  "seedream-5.0-flash": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/heic", "image/heif", "image/tiff", "image/gif", "image/webp"] as const),
  "seedream-5.0-pro": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"] as const)
} satisfies Readonly<Record<OwnerSeedreamImageVariant, readonly string[]>>);
const SOURCE_CAPS = Object.freeze({
  "seedream-4": 10 * MIB,
  "seedream-4.5": 10 * MIB,
  "seedream-5": 10 * MIB,
  "seedream-5.0-flash": 30 * MIB,
  "seedream-5.0-pro": 30 * MIB
} satisfies Readonly<Record<OwnerSeedreamImageVariant, number>>);
const BASE64_MAX_CHARS = Math.ceil(LOCAL_PARSER_MAX_BYTES / 3) * 4;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export const OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY = Object.freeze({
  variants: OWNER_SEEDREAM_IMAGE_VARIANTS,
  source_max_file_bytes_by_variant: SOURCE_CAPS,
  accepted_file_types_by_variant: ACCEPTED_MIMES,
  local_parser_max_bytes: LOCAL_PARSER_MAX_BYTES,
  local_parser_policy: "BOUNDED_CONTAINER_INSPECTION_ONLY_NOT_SOURCE_OR_PROVIDER_LIMIT" as const,
  source_limit_policy: "EDITOR_NUMERIC_UPLOADER_LIMIT_NOT_PROVIDER_LIMIT" as const,
  max_file_count: 1 as const,
  dimensions: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
  dispatch_allowed: false as const,
  runtime_usable: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export type OwnerSeedreamEditorOriginalMimeType = (typeof ACCEPTED_MIMES)[OwnerSeedreamImageVariant][number];
export type OwnerSeedreamEditorOriginalCanonicalMimeType = Exclude<OwnerSeedreamEditorOriginalMimeType, "image/jpg">;
export type OwnerSeedreamEditorOriginalValidationConfidence =
  | "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY"
  | "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY"
  | "HEIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY"
  | "BMP_HEADER_AND_PIXEL_EXTENT"
  | "GIF_BLOCK_FRAMING_BOUNDED_FRAMES"
  | "TIFF_IFD_AND_STRIP_EXTENTS_BOUNDED_PAGES";

export interface ValidatedOwnerSeedreamEditorOriginal {
  /** Exact-sized consumer-owned mutable snapshot; wipe after its local use. */
  readonly bytes: Uint8Array;
  readonly variant: OwnerSeedreamImageVariant;
  readonly kind: "image";
  readonly filename: string;
  readonly source_mime_type: OwnerSeedreamEditorOriginalMimeType;
  readonly mime_type: OwnerSeedreamEditorOriginalCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly validation_confidence: OwnerSeedreamEditorOriginalValidationConfidence;
  readonly source_ui_limit_applied: true;
  readonly source_ui_limit_is_provider_limit: false;
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerSeedreamEditorOriginalInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_IMAGE_COMPOSITION") {
    super("The Seedream Editor original input is invalid or outside the bounded local/source UI policy.");
    this.name = "OwnerSeedreamEditorOriginalInputError";
  }
}

export function validateOwnerSeedreamEditorOriginalInput(input: unknown): ValidatedOwnerSeedreamEditorOriginal {
  let decoded: Buffer | undefined;
  let owned: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["variant", "content_base64", "filename", "mime_type"]);
    const variant = readVariant(fields.variant);
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0) invalid();
    const cap = SOURCE_CAPS[variant];
    if (fields.content_base64.length > Math.ceil(cap / 3) * 4) localLimit();
    if (fields.content_base64.length > BASE64_MAX_CHARS || !hasCanonicalBase64(fields.content_base64) ||
        typeof fields.filename !== "string" || !isSafeFilename(fields.filename) || typeof fields.mime_type !== "string") invalid();
    const mime = readMime(fields.mime_type, variant);
    decoded = Buffer.from(fields.content_base64, "base64");
    if (decoded.byteLength > cap) localLimit();
    if (decoded.byteLength < 1 || decoded.toString("base64") !== fields.content_base64) invalid();
    owned = new Uint8Array(decoded.byteLength);
    owned.set(decoded);
    decoded.fill(0); decoded = undefined;
    const result = validateOwned(variant, owned, fields.filename, mime);
    owned = undefined;
    return result;
  } catch (error) {
    decoded?.fill(0); owned?.fill(0);
    mapError(error);
  }
}

export function validateOwnerSeedreamEditorOriginalUploadData(input: unknown): ValidatedOwnerSeedreamEditorOriginal {
  let owned: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["variant", "bytes", "filename", "mime_type"]);
    const variant = readVariant(fields.variant), source = fields.bytes;
    if (types.isProxy(source) || !(source instanceof Uint8Array) ||
        (Object.getPrototypeOf(source) !== Uint8Array.prototype && Object.getPrototypeOf(source) !== Buffer.prototype) ||
        hasShadowedViewProperties(source) || typeof fields.filename !== "string" || !isSafeFilename(fields.filename) ||
        typeof fields.mime_type !== "string") invalid();
    const mime = readMime(fields.mime_type, variant);
    const backing = getBuffer(source), offset = getOffset(source), size = getLength(source);
    if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || Object.hasOwn(backing, "byteLength") ||
        !Number.isSafeInteger(size) || size < 1 || offset < 0 || offset + size > getArrayBufferLength(backing)) invalid();
    if (size > SOURCE_CAPS[variant]) localLimit();
    owned = new Uint8Array(size);
    owned.set(new Uint8Array(backing, offset, size));
    const result = validateOwned(variant, owned, fields.filename, mime);
    owned = undefined;
    return result;
  } catch (error) {
    owned?.fill(0);
    mapError(error);
  }
}

function validateOwned(variant: OwnerSeedreamImageVariant, bytes: Uint8Array, filename: string,
  sourceMime: OwnerSeedreamEditorOriginalMimeType): ValidatedOwnerSeedreamEditorOriginal {
  try {
    if (bytes.byteLength > LOCAL_PARSER_MAX_BYTES) localLimit();
    const parsed = inspect(bytes, sourceMime);
    const canonicalMime = sourceMime === "image/jpg" ? "image/jpeg" : sourceMime;
    if (parsed.mime !== canonicalMime || !Number.isSafeInteger(parsed.width) || parsed.width < 1 ||
        !Number.isSafeInteger(parsed.height) || parsed.height < 1) invalid();
    if ((variant === "seedream-5.0-flash" || variant === "seedream-5.0-pro") &&
        (parsed.width / parsed.height < 1 / 16 || parsed.width / parsed.height > 16)) invalid();
    const result: ValidatedOwnerSeedreamEditorOriginal = {
      bytes, variant, kind: "image", filename, source_mime_type: sourceMime, mime_type: canonicalMime,
      width: parsed.width, height: parsed.height, size: bytes.byteLength,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
      validation_confidence: parsed.validation_confidence,
      source_ui_limit_applied: true, source_ui_limit_is_provider_limit: false,
      dispatch_allowed: false, runtime_usable: false, backend_acceptance: "UNPROVEN"
    };
    Object.defineProperty(result, "bytes", { value: bytes, enumerable: false, writable: false, configurable: false });
    return Object.freeze(result);
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

function inspect(bytes: Uint8Array, mime: OwnerSeedreamEditorOriginalMimeType): {
  mime: OwnerSeedreamEditorOriginalCanonicalMimeType; width: number; height: number;
  validation_confidence: OwnerSeedreamEditorOriginalValidationConfidence;
} {
  if (mime === "image/avif") return { ...inspectBoundedOwnerClarityAvifBytesWithMax(bytes, LOCAL_PARSER_MAX_BYTES), validation_confidence: "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY" };
  if (mime === "image/heic" || mime === "image/heif") return { ...inspectOwnerStandardHeifBytes(bytes, mime), validation_confidence: "HEIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY" };
  if (mime === "image/bmp" || mime === "image/gif" || mime === "image/tiff") return inspectOwnerSeedreamExtraImageBytes(bytes, mime);
  return { ...inspectBoundedOwnerImageBytesWithMax(bytes, LOCAL_PARSER_MAX_BYTES), validation_confidence: "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY" };
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) =>
    typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function readVariant(value: unknown): OwnerSeedreamImageVariant {
  if (typeof value !== "string" || !(OWNER_SEEDREAM_IMAGE_VARIANTS as readonly string[]).includes(value)) invalid();
  return value as OwnerSeedreamImageVariant;
}
function readMime(value: string, variant: OwnerSeedreamImageVariant): OwnerSeedreamEditorOriginalMimeType {
  if (!(ACCEPTED_MIMES[variant] as readonly string[]).includes(value)) invalid();
  return value as OwnerSeedreamEditorOriginalMimeType;
}
function isSafeFilename(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && value === value.trimEnd() && !value.endsWith(".") &&
    !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !FILENAME_DELIMITERS.test(value) && !RESERVED_WINDOWS_BASENAME.test(value) &&
    isWellFormedUnicode(value) && Buffer.byteLength(value, "utf8") <= MAX_FILENAME_UTF8_BYTES;
}
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(index + 1); if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return false; index += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function hasShadowedViewProperties(value: Uint8Array): boolean {
  return Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length");
}
function getBuffer(value: Uint8Array): ArrayBuffer { return Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer; }
function getOffset(value: Uint8Array): number { return Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number; }
function getLength(value: Uint8Array): number { return Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number; }
function getArrayBufferLength(value: ArrayBuffer): number { return Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, value, []) as number; }
function hasCanonicalBase64(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return false;
  return true;
}
function mapError(error: unknown): never {
  if (error instanceof OwnerSeedreamEditorOriginalInputError) throw error;
  if (error instanceof UnsupportedOwnerClarityAvifCompositionError ||
      (error instanceof OwnerStandardHeifInspectorError && error.code === "UNSUPPORTED_HEIF_COMPOSITION") ||
      (error instanceof OwnerSeedreamExtraImageInspectorError && error.code === "UNSUPPORTED_IMAGE_COMPOSITION")) {
    throw new OwnerSeedreamEditorOriginalInputError("UNSUPPORTED_IMAGE_COMPOSITION");
  }
  invalid();
}
function invalid(): never { throw new OwnerSeedreamEditorOriginalInputError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerSeedreamEditorOriginalInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
