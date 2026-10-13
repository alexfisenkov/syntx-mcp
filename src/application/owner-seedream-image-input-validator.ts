import { createHash } from "node:crypto";
import { types } from "node:util";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { inspectBoundedOwnerImageBytes32MiB } from "./owner-image-reference-input-validator.js";
import { inspectBoundedOwnerClarityAvifBytes32MiB, UnsupportedOwnerClarityAvifCompositionError } from "./owner-clarity-upscale-input-validator.js";
import { inspectOwnerStandardHeifBytes, OwnerStandardHeifInspectorError } from "./owner-standard-heif-inspector.js";
import { inspectOwnerSeedreamExtraImageBytes, OwnerSeedreamExtraImageInspectorError } from "./owner-seedream-extra-image-inspector.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";
import { getOwnerSeedreamImageSourceProfile, type OwnerSeedreamImageSourceProfile } from "./owner-seedream-image-source-profile.js";

const BASIC_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"] as const);
const EXTRA_MIMES = Object.freeze(["image/bmp", "image/gif", "image/tiff", "image/heic", "image/heif"] as const);
const MAX_BASE64_CHARS = Math.ceil(27_525_120 / 3) * 4;
const MAX_FILENAME_BYTES = 255;
const SAFE_FILENAME = /^[^/\\\p{Cc}\p{Cf}\p{Cs}]{1,255}$/u;
const TYPED_ARRAY_PROTO = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTO, "buffer")!.get!;
const OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTO, "byteOffset")!.get!;
const LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTO, "byteLength")!.get!;
const ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export type OwnerSeedreamImageSourceMime = typeof BASIC_MIMES[number] | typeof EXTRA_MIMES[number];
export type OwnerSeedreamImageCanonicalMime = Exclude<OwnerSeedreamImageSourceMime, "image/jpg">;
export interface ValidatedOwnerSeedreamImageInput {
  readonly variant: OwnerSeedreamImageVariant;
  readonly kind: "image";
  /** Consumer-owned mutable byte copy. Wipe it when its upload/request lifecycle ends. */
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly source_mime_type: OwnerSeedreamImageSourceMime;
  readonly mime_type: OwnerSeedreamImageCanonicalMime;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly validation_confidence: string;
}
export const OWNER_SEEDREAM_IMAGE_INPUT_POLICY = Object.freeze({
  variants: OWNER_SEEDREAM_IMAGE_VARIANTS,
  basic_source_mime_types: BASIC_MIMES,
  flash_pro_extra_source_mime_types: EXTRA_MIMES,
  generic_byte_caps: Object.freeze({ legacy: 10_485_760, flash_pro: 31_457_280 }),
  image_byte_caps: Object.freeze({ legacy: 10_485_760, flash: 11_010_048, pro: 27_525_120 }),
  source_metadata_caps: Object.freeze({ min_dimension: 15, max_dimension: 6_000, max_dimension_redundant: 8_400,
    min_pixels: 196, max_pixels: 36_000_000, min_aspect_ratio: 1 / 16, max_aspect_ratio: 16 }),
  dimensions: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
  size_limit_confidence: "SOURCE_IMAGE_METADATA_SELECTED_LOCAL_CEILING_NOT_PROVIDER_LIMIT" as const
});
export class OwnerSeedreamImageInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_IMAGE_COMPOSITION") {
    super("The owner Seedream image input is invalid or exceeds the local source policy.");
    this.name = "OwnerSeedreamImageInputError";
  }
}

/** Validates a strict base64 DTO against the current reviewed Seedream source profile. */
export function validateOwnerSeedreamImageInput(input: unknown): ValidatedOwnerSeedreamImageInput {
  let decoded: Buffer | undefined;
  let owned: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["variant", "content_base64", "filename", "mime_type"]);
    const variant = readVariant(fields.variant), profile = profileFor(variant);
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0) invalid();
    if (fields.content_base64.length > Math.ceil(profile.input_policy.image_max_file_bytes / 3) * 4) limit();
    if (fields.content_base64.length > MAX_BASE64_CHARS || fields.content_base64.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(fields.content_base64) ||
        typeof fields.filename !== "string" || !safeFilename(fields.filename) || typeof fields.mime_type !== "string") invalid();
    const mime = readMime(fields.mime_type, profile.mime_policy.accepted_file_types);
    decoded = Buffer.from(fields.content_base64, "base64");
    if (decoded.byteLength > profile.input_policy.image_max_file_bytes) limit();
    if (!decoded.byteLength || decoded.toString("base64") !== fields.content_base64) invalid();
    owned = new Uint8Array(decoded.byteLength); owned.set(decoded); decoded.fill(0); decoded = undefined;
    const result = validateOwned(variant, owned, fields.filename, mime, profile);
    owned = undefined;
    return result;
  } catch (error) {
    decoded?.fill(0); owned?.fill(0);
    mapError(error);
  }
}

/** Snapshots only the supplied view bytes into an exact-sized consumer-owned Uint8Array. */
export function validateOwnerSeedreamImageUploadData(input: unknown): ValidatedOwnerSeedreamImageInput {
  let owned: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["variant", "bytes", "filename", "mime_type"]);
    const variant = readVariant(fields.variant), profile = profileFor(variant);
    const source = fields.bytes;
    if (types.isProxy(source) || !(source instanceof Uint8Array) ||
        (Object.getPrototypeOf(source) !== Uint8Array.prototype && Object.getPrototypeOf(source) !== Buffer.prototype) || shadowed(source) ||
        typeof fields.filename !== "string" || !safeFilename(fields.filename) || typeof fields.mime_type !== "string") invalid();
    const mime = readMime(fields.mime_type, profile.mime_policy.accepted_file_types);
    const buffer = getBuffer(source), offset = getOffset(source), size = getLength(source);
    if (types.isProxy(buffer) || Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || Object.hasOwn(buffer, "byteLength") ||
        !Number.isSafeInteger(size) || size < 1 || size > profile.input_policy.image_max_file_bytes || offset < 0 || offset + size > getArrayLength(buffer)) {
      if (size > profile.input_policy.image_max_file_bytes) limit();
      invalid();
    }
    owned = new Uint8Array(size); owned.set(new Uint8Array(buffer, offset, size));
    const result = validateOwned(variant, owned, fields.filename, mime, profile);
    owned = undefined;
    return result;
  } catch (error) {
    owned?.fill(0); mapError(error);
  }
}

function validateOwned(variant: OwnerSeedreamImageVariant, bytes: Uint8Array, filename: string, sourceMime: OwnerSeedreamImageSourceMime, profile: Readonly<OwnerSeedreamImageSourceProfile>): ValidatedOwnerSeedreamImageInput {
  try {
    const parsed = inspect(bytes, sourceMime, profile.input_policy.image_max_file_bytes);
    if (parsed.mime !== (sourceMime === "image/jpg" ? "image/jpeg" : sourceMime) ||
        !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) || parsed.width < 1 || parsed.height < 1) invalid();
    const policy = profile.input_policy;
    if (policy.max_image_width !== null && (parsed.width > policy.max_image_width || parsed.height > policy.max_image_height! ||
        parsed.width < policy.min_image_width! || parsed.height < policy.min_image_height! ||
        parsed.width * parsed.height < policy.min_image_pixel_count! || parsed.width * parsed.height > policy.max_image_pixel_count!)) invalid();
    if (policy.max_image_dimension !== null && (parsed.width > policy.max_image_dimension || parsed.height > policy.max_image_dimension)) invalid();
    if (policy.max_image_aspect_ratio !== null || policy.min_image_aspect_ratio !== null) {
      const ratio = parsed.width / parsed.height;
      if ((policy.min_image_aspect_ratio !== null && ratio < policy.min_image_aspect_ratio) ||
          (policy.max_image_aspect_ratio !== null && ratio > policy.max_image_aspect_ratio)) invalid();
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    return Object.freeze({ variant, kind: "image", bytes, filename, source_mime_type: sourceMime,
      mime_type: parsed.mime, width: parsed.width, height: parsed.height, size: bytes.byteLength,
      sha256: `sha256:${digest}`, metadata_confidence: "CONTAINER_METADATA_ONLY",
      validation_confidence: `${parsed.validation_confidence};SOURCE_CONTAINER_METADATA_ONLY_NOT_PROVIDER_ACCEPTANCE` });
  } catch (error) {
    bytes.fill(0); mapError(error);
  }
}

function inspect(bytes: Uint8Array, mime: OwnerSeedreamImageSourceMime, maxBytes: number): { mime: OwnerSeedreamImageCanonicalMime; width: number; height: number; validation_confidence: string } {
  if (mime === "image/avif") return { ...inspectBoundedOwnerClarityAvifBytes32MiB(bytes, maxBytes), validation_confidence: "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY" };
  if (mime === "image/heic" || mime === "image/heif") return inspectOwnerStandardHeifBytes(bytes, mime);
  if (mime === "image/bmp" || mime === "image/gif" || mime === "image/tiff") return inspectOwnerSeedreamExtraImageBytes(bytes, mime);
  return { ...inspectBoundedOwnerImageBytes32MiB(bytes, maxBytes), validation_confidence: "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY" };
}
function profileFor(variant: OwnerSeedreamImageVariant) {
  const { discoveryCatalog } = loadSelectedDiscoveryCatalog();
  return getOwnerSeedreamImageSourceProfile(variant, discoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
}
function readVariant(value: unknown): OwnerSeedreamImageVariant {
  if (typeof value !== "string" || !OWNER_SEEDREAM_IMAGE_VARIANTS.includes(value as OwnerSeedreamImageVariant)) invalid();
  return value as OwnerSeedreamImageVariant;
}
function readMime(value: string, accepted: readonly string[]): OwnerSeedreamImageSourceMime {
  if (!accepted.includes(value)) invalid();
  return value as OwnerSeedreamImageSourceMime;
}
function safeFilename(value: string): boolean { return value !== "." && value !== ".." && SAFE_FILENAME.test(value) && Buffer.byteLength(value, "utf8") <= MAX_FILENAME_BYTES; }
function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const proto = Object.getPrototypeOf(value), desc = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(desc);
  if ((proto !== Object.prototype && proto !== null) || actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in desc[key]!) || desc[key]!.enumerable !== true)) invalid();
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) out[key] = desc[key]!.value;
  return out;
}
function shadowed(value: Uint8Array): boolean { return Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "length"); }
function getBuffer(value: Uint8Array): ArrayBuffer { return Reflect.apply(BUFFER_GETTER, value, []) as ArrayBuffer; }
function getOffset(value: Uint8Array): number { return Reflect.apply(OFFSET_GETTER, value, []) as number; }
function getLength(value: Uint8Array): number { return Reflect.apply(LENGTH_GETTER, value, []) as number; }
function getArrayLength(value: ArrayBuffer): number { return Reflect.apply(ARRAY_LENGTH_GETTER, value, []) as number; }
function mapError(error: unknown): never {
  if (error instanceof OwnerSeedreamImageInputError) throw error;
  if ((error instanceof OwnerStandardHeifInspectorError && error.code === "UNSUPPORTED_HEIF_COMPOSITION") ||
      error instanceof UnsupportedOwnerClarityAvifCompositionError ||
      (error instanceof OwnerSeedreamExtraImageInspectorError && error.code === "UNSUPPORTED_IMAGE_COMPOSITION")) {
    throw new OwnerSeedreamImageInputError("UNSUPPORTED_IMAGE_COMPOSITION");
  }
  invalid();
}
function invalid(): never { throw new OwnerSeedreamImageInputError("INVALID_IMAGE_INPUT"); }
function limit(): never { throw new OwnerSeedreamImageInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
