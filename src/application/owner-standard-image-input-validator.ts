import { createHash } from "node:crypto";
import { types } from "node:util";
import { OWNER_BANANA_IMAGE_VARIANTS, type OwnerBananaImageVariant } from "./owner-banana-image-parameters.js";
import { type OwnerGptImageVariant } from "./owner-gpt-image-parameters.js";
import { inspectBoundedOwnerImageBytes32MiB } from "./owner-image-reference-input-validator.js";
import { inspectBoundedOwnerClarityAvifBytes32MiB, UnsupportedOwnerClarityAvifCompositionError } from "./owner-clarity-upscale-input-validator.js";
import { inspectOwnerStandardHeifBytes, OwnerStandardHeifInspectorError } from "./owner-standard-heif-inspector.js";

export type OwnerStandardImageInputVariant = OwnerBananaImageVariant | OwnerGptImageVariant;
export interface OwnerStandardImageInput {
  readonly variant: OwnerStandardImageInputVariant;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
}
export interface ValidatedOwnerStandardImageInput {
  readonly variant: OwnerStandardImageInputVariant;
  readonly kind: "image";
  /** Consumer-owned mutable bytes; wipe when the upload/request lifecycle ends. */
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly original_mime_type: string;
  readonly mime_type: "image/jpeg" | "image/png" | "image/webp" | "image/avif" | "image/heic" | "image/heif";
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly validation_confidence: string;
}

const BANANA21_MAX_BYTES = 7 * 1024 * 1024;
const LOCAL_MAX_BYTES = 32 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(LOCAL_MAX_BYTES / 3) * 4;
const BANANA_VARIANTS = new Set<string>(OWNER_BANANA_IMAGE_VARIANTS);
const GPT_VARIANTS = new Set<string>(["gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
const BANANA21_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const STANDARD_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"]);
const SAFE_FILENAME = /^[^/\\\p{Cc}\p{Cf}\p{Cs}]{1,255}$/u;

export const OWNER_STANDARD_IMAGE_INPUT_POLICY = Object.freeze({
  banana_21: Object.freeze({ source_image_max_bytes: BANANA21_MAX_BYTES, max_dimension: 8_400, max_pixels: 52_500_000, provider_acceptance: "UNPROVEN" as const }),
  other_variants: Object.freeze({ local_process_max_bytes: LOCAL_MAX_BYTES, policy: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const }),
  dimensions: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const
});

export class OwnerStandardImageInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "UNSUPPORTED_IMAGE_COMPOSITION") {
    super("The owner standard image input is invalid or unsupported.");
    this.name = "OwnerStandardImageInputError";
  }
}

/** Validates only source-declared image inputs; dimensions are container metadata, not decoded pixels. */
export function validateOwnerStandardImageInput(input: OwnerStandardImageInput | unknown): ValidatedOwnerStandardImageInput {
  let decoded: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["variant", "content_base64", "filename", "mime_type"]);
    if (typeof fields.variant !== "string" || !isVariant(fields.variant) ||
        typeof fields.content_base64 !== "string" || fields.content_base64.length === 0 ||
        fields.content_base64.length > MAX_BASE64_CHARS || fields.content_base64.length % 4 !== 0 ||
        typeof fields.filename !== "string" || !isSafeFilename(fields.filename) || typeof fields.mime_type !== "string") invalid();
    const variant = fields.variant as OwnerStandardImageInputVariant;
    const mimeInput = fields.mime_type;
    const maxBytes = maxBytesForVariant(variant);
    if (!isAcceptedMime(variant, mimeInput)) invalid();
    const maxBase64Chars = Math.ceil(maxBytes / 3) * 4;
    if (fields.content_base64.length > maxBase64Chars) invalid();
    decoded = Buffer.from(fields.content_base64, "base64");
    if (decoded.byteLength < 1 || decoded.byteLength > maxBytes || decoded.toString("base64") !== fields.content_base64) invalid();
    const result = validatePrivateBytes(variant, decoded, fields.filename, mimeInput);
    decoded = undefined;
    return result;
  } catch (error) {
    decoded?.fill(0);
    if (error instanceof OwnerStandardImageInputError) throw error;
    invalid();
  }
}

/** Validates caller bytes without a base64 round trip and returns an owned copy. */
export function validateOwnerStandardImageUploadData(input: unknown): ValidatedOwnerStandardImageInput {
  let privateBytes: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["variant", "bytes", "filename", "mime_type"]);
    if (typeof fields.variant !== "string" || !isVariant(fields.variant) ||
        types.isProxy(fields.bytes) || !(fields.bytes instanceof Uint8Array) ||
        (Object.getPrototypeOf(fields.bytes) !== Uint8Array.prototype && Object.getPrototypeOf(fields.bytes) !== Buffer.prototype) ||
        hasShadowedTypedArrayFields(fields.bytes) ||
        typeof fields.filename !== "string" || !isSafeFilename(fields.filename) || typeof fields.mime_type !== "string") invalid();
    const variant = fields.variant as OwnerStandardImageInputVariant;
    const maxBytes = maxBytesForVariant(variant);
    const mimeInput = fields.mime_type;
    if (!isAcceptedMime(variant, mimeInput)) invalid();
    const sourceBuffer = typedArrayBuffer(fields.bytes);
    const sourceOffset = typedArrayOffset(fields.bytes);
    const sourceLength = typedArrayLength(fields.bytes);
    if (types.isProxy(sourceBuffer) || Object.getPrototypeOf(sourceBuffer) !== ArrayBuffer.prototype || Object.hasOwn(sourceBuffer, "byteLength") ||
        sourceLength < 1 || sourceLength > maxBytes || sourceOffset < 0 || sourceOffset + sourceLength > arrayBufferByteLength(sourceBuffer)) invalid();
    privateBytes = new Uint8Array(sourceBuffer, sourceOffset, sourceLength).slice();
    const result = validatePrivateBytes(variant, privateBytes, fields.filename, mimeInput);
    privateBytes = undefined;
    return result;
  } catch (error) {
    privateBytes?.fill(0);
    if (error instanceof OwnerStandardImageInputError) throw error;
    if ((error instanceof OwnerStandardHeifInspectorError && error.code === "UNSUPPORTED_HEIF_COMPOSITION") ||
        error instanceof UnsupportedOwnerClarityAvifCompositionError) {
      throw new OwnerStandardImageInputError("UNSUPPORTED_IMAGE_COMPOSITION");
    }
    invalid();
  }
}

function validatePrivateBytes(variant: OwnerStandardImageInputVariant, ownedBytes: Uint8Array, filename: string, mimeInput: string): ValidatedOwnerStandardImageInput {
  let consumerBytes: Uint8Array | undefined;
  try {
    const parsed = inspectStandardImage(ownedBytes, mimeInput);
    if (parsed.width < 1 || parsed.height < 1 || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height)) invalid();
    if (mimeInput === "image/jpg" && parsed.mime !== "image/jpeg") invalid();
    if (parsed.mime !== (mimeInput === "image/jpg" ? "image/jpeg" : mimeInput)) invalid();
    if (variant === "banana-2.1" && (parsed.width > 8_400 || parsed.height > 8_400 || parsed.width * parsed.height > 52_500_000)) invalid();
    const digest = createHash("sha256").update(ownedBytes).digest("hex");
    consumerBytes = new Uint8Array(ownedBytes.byteLength);
    consumerBytes.set(ownedBytes);
    const size = consumerBytes.byteLength;
    ownedBytes.fill(0);
    return Object.freeze({
      variant, kind: "image", bytes: consumerBytes, filename, original_mime_type: mimeInput,
      mime_type: parsed.mime, width: parsed.width, height: parsed.height, size,
      sha256: `sha256:${digest}`, metadata_confidence: "CONTAINER_METADATA_ONLY",
      validation_confidence: `${parsed.validation_confidence};${variant === "banana-2.1" ? "BANANA_21_CATALOG_METADATA_CEILING_PROVIDER_UNPROVEN" : "LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT"}`
    });
  } catch (error) {
    consumerBytes?.fill(0);
    ownedBytes.fill(0);
    if (error instanceof OwnerStandardImageInputError) throw error;
    if ((error instanceof OwnerStandardHeifInspectorError && error.code === "UNSUPPORTED_HEIF_COMPOSITION") ||
        error instanceof UnsupportedOwnerClarityAvifCompositionError) {
      throw new OwnerStandardImageInputError("UNSUPPORTED_IMAGE_COMPOSITION");
    }
    invalid();
  }
}

function inspectStandardImage(bytes: Uint8Array, declaredMime: string): {
  mime: ValidatedOwnerStandardImageInput["mime_type"];
  width: number;
  height: number;
  validation_confidence: string;
} {
  if (declaredMime === "image/avif") return { ...inspectBoundedOwnerClarityAvifBytes32MiB(bytes, LOCAL_MAX_BYTES), validation_confidence: "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY" };
  if (declaredMime === "image/heic" || declaredMime === "image/heif") return inspectOwnerStandardHeifBytes(bytes, declaredMime);
  return { ...inspectBoundedOwnerImageBytes32MiB(bytes, LOCAL_MAX_BYTES), validation_confidence: "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY" };
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!))) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function isVariant(value: string): boolean { return BANANA_VARIANTS.has(value) || GPT_VARIANTS.has(value); }
function maxBytesForVariant(variant: OwnerStandardImageInputVariant): number { return variant === "banana-2.1" ? BANANA21_MAX_BYTES : LOCAL_MAX_BYTES; }
function isAcceptedMime(variant: OwnerStandardImageInputVariant, mime: string): boolean {
  return (variant === "banana-2.1" ? BANANA21_MIMES : STANDARD_MIMES).has(mime);
}
function hasShadowedTypedArrayFields(bytes: Uint8Array): boolean {
  return Object.hasOwn(bytes, "buffer") || Object.hasOwn(bytes, "byteLength") || Object.hasOwn(bytes, "byteOffset") || Object.hasOwn(bytes, "length");
}
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const typedArrayOffsetGetter = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
function typedArrayBuffer(bytes: Uint8Array): ArrayBuffer { return Reflect.apply(typedArrayBufferGetter, bytes, []) as ArrayBuffer; }
function typedArrayOffset(bytes: Uint8Array): number { return Reflect.apply(typedArrayOffsetGetter, bytes, []) as number; }
function typedArrayLength(bytes: Uint8Array): number { return Reflect.apply(typedArrayLengthGetter, bytes, []) as number; }
function arrayBufferByteLength(buffer: ArrayBuffer): number { return Reflect.apply(arrayBufferByteLengthGetter, buffer, []) as number; }
function isSafeFilename(value: string): boolean {
  return SAFE_FILENAME.test(value) && value !== "." && value !== ".." && Buffer.byteLength(value, "utf8") <= 255;
}
function invalid(): never { throw new OwnerStandardImageInputError("INVALID_IMAGE_INPUT"); }
