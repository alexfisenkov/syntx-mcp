import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytes } from "./owner-image-reference-input-validator.js";
import { inspectBoundedOwnerWanBmp, OwnerWanBmpInspectionError } from "./owner-wan-bmp-inspector.js";

const VARIANTS = Object.freeze(["wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"] as const);
const MIME_TYPES = Object.freeze(["image/png", "image/jpeg", "image/jpg", "image/bmp", "image/webp"] as const);
const MAX_FILENAME_UTF8_BYTES = 255;
const PORTABLE_FILENAME_DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export type OwnerWanImageVariant = typeof VARIANTS[number];
export type OwnerWanOriginalImageMimeType = typeof MIME_TYPES[number];
export type OwnerWanCanonicalImageMimeType = Exclude<OwnerWanOriginalImageMimeType, "image/jpg">;

const VARIANT_LIMITS: Readonly<Record<OwnerWanImageVariant, Readonly<{ max_bytes: number; min_dimension: number; max_dimension: number }>>> = Object.freeze({
  wan_25_i2i_preview: Object.freeze({ max_bytes: 10_485_760, min_dimension: 384, max_dimension: 5_000 }),
  wan_26_image: Object.freeze({ max_bytes: 10_485_760, min_dimension: 384, max_dimension: 5_000 }),
  wan_27_image: Object.freeze({ max_bytes: 20_971_520, min_dimension: 240, max_dimension: 8_000 }),
  wan_27_image_pro: Object.freeze({ max_bytes: 20_971_520, min_dimension: 240, max_dimension: 8_000 })
});

export const OWNER_WAN_IMAGE_INPUT_POLICY = Object.freeze({
  variants: Object.freeze(Object.fromEntries(VARIANTS.map((variant) => [variant, VARIANT_LIMITS[variant]])) as Record<OwnerWanImageVariant, typeof VARIANT_LIMITS[OwnerWanImageVariant]>),
  source_mime_types: MIME_TYPES,
  jpg_alias: "image/jpg -> image/jpeg" as const,
  max_filename_utf8_bytes: MAX_FILENAME_UTF8_BYTES,
  filename_policy: "LOCAL_PORTABLE_BASENAME_ONLY" as const,
  limits_policy: "LOCAL_GUARD_FROM_SELECTED_CATALOG_NOT_PROVIDER_ACCEPTANCE" as const,
  metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const
});

export interface ValidatedOwnerWanImageInput {
  readonly variant: OwnerWanImageVariant;
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly original_mime_type: OwnerWanOriginalImageMimeType;
  readonly mime_type: OwnerWanCanonicalImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED";
  readonly dimensions_proof: "CONTAINER_METADATA_ONLY_NOT_BROWSER_NATURAL_DIMENSIONS";
}

export class OwnerWanImageInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_BMP_COMPOSITION") {
    super("The owner WAN image input is invalid or unsupported.");
    this.name = "OwnerWanImageInputError";
  }
}

/** Validates an explicitly selected WAN image input using local structural bounds only. */
export function validateOwnerWanImageInput(input: unknown): ValidatedOwnerWanImageInput {
  let decodedBytes: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["variant", "content_base64", "filename", "mime_type"]);
    if (typeof fields.variant !== "string" || !VARIANTS.includes(fields.variant as OwnerWanImageVariant)) invalid();
    const variant = fields.variant as OwnerWanImageVariant;
    const limits = VARIANT_LIMITS[variant];
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0) invalid();
    if (fields.content_base64.length > Math.ceil(limits.max_bytes / 3) * 4) localResourceLimitExceeded();
    if (fields.content_base64.length % 4 !== 0 || typeof fields.filename !== "string" ||
        !isSafePortableBasename(fields.filename) || typeof fields.mime_type !== "string" ||
        !MIME_TYPES.includes(fields.mime_type as OwnerWanOriginalImageMimeType)) invalid();

    decodedBytes = Buffer.from(fields.content_base64, "base64");
    if (decodedBytes.byteLength > limits.max_bytes) localResourceLimitExceeded();
    if (decodedBytes.byteLength < 1 || decodedBytes.toString("base64") !== fields.content_base64) invalid();

    const originalMime = fields.mime_type as OwnerWanOriginalImageMimeType;
    const canonicalMime: OwnerWanCanonicalImageMimeType = originalMime === "image/jpg" ? "image/jpeg" : originalMime;
    const parsed = canonicalMime === "image/bmp"
      ? { mime: "image/bmp" as const, ...inspectBoundedOwnerWanBmp(decodedBytes) }
      : inspectBoundedOwnerImageBytes(decodedBytes, limits.max_bytes);
    if (parsed.mime !== canonicalMime || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < limits.min_dimension || parsed.width > limits.max_dimension ||
        parsed.height < limits.min_dimension || parsed.height > limits.max_dimension) invalid();

    const result: ValidatedOwnerWanImageInput = Object.freeze({
      variant,
      bytes: new Uint8Array(decodedBytes),
      filename: fields.filename,
      original_mime_type: originalMime,
      mime_type: canonicalMime,
      width: parsed.width,
      height: parsed.height,
      size: decodedBytes.byteLength,
      sha256: createHash("sha256").update(decodedBytes).digest("hex"),
      metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED",
      dimensions_proof: "CONTAINER_METADATA_ONLY_NOT_BROWSER_NATURAL_DIMENSIONS"
    });
    decodedBytes.fill(0);
    return result;
  } catch (error) {
    decodedBytes?.fill(0);
    if (error instanceof OwnerWanImageInputError) throw error;
    if (error instanceof OwnerWanBmpInspectionError && error.code === "UNSUPPORTED_BMP_COMPOSITION") {
      throw new OwnerWanImageInputError("UNSUPPORTED_BMP_COMPOSITION");
    }
    return invalid();
  }
}

function isSafePortableBasename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || value !== value.trimEnd() || value.endsWith(".") ||
      /\p{Cc}/u.test(value) || PORTABLE_FILENAME_DELIMITERS.test(value) || RESERVED_WINDOWS_BASENAME.test(value) ||
      !isWellFormedUnicode(value)) return false;
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

function invalid(): never { throw new OwnerWanImageInputError("INVALID_IMAGE_INPUT"); }
function localResourceLimitExceeded(): never { throw new OwnerWanImageInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
