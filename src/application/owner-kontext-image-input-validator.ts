import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  inspectBoundedOwnerClarityAvifBytes,
  UnsupportedOwnerClarityAvifCompositionError
} from "./owner-clarity-upscale-input-validator.js";
import { inspectBoundedOwnerImageBytes } from "./owner-image-reference-input-validator.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_BYTES / 3) * 4;
const MAX_FILENAME_UTF8_BYTES = 255;
const INPUT_MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const);
const FILENAME_DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export const OWNER_KONTEXT_IMAGE_INPUT_POLICY = Object.freeze({
  local_max_bytes: MAX_BYTES,
  local_max_bytes_policy: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT" as const,
  source_max_bytes: "UNKNOWN" as const,
  provider_max_bytes: "UNKNOWN" as const,
  filename_utf8_max_bytes: MAX_FILENAME_UTF8_BYTES,
  filename_policy: "LOCAL_PORTABLE_BASENAME_ONLY" as const
});

export type OwnerKontextOriginalImageMimeType = typeof INPUT_MIME_TYPES[number];
export type OwnerKontextCanonicalImageMimeType = "image/jpeg" | "image/png" | "image/avif" | "image/webp";

/**
 * `bytes` is a fresh caller-owned copy. The caller should zero it after its
 * upload/copy operation has completed; the validator has already wiped its
 * private decode buffer before returning.
 */
export interface ValidatedOwnerKontextImageInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly original_mime_type: OwnerKontextOriginalImageMimeType;
  readonly mime_type: OwnerKontextCanonicalImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export class OwnerKontextImageInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_AVIF_COMPOSITION") {
    super("The owner Kontext image input is invalid or unsupported.");
    this.name = "OwnerKontextImageInputError";
  }
}

/** Validates one portable image using local structural and memory-safety rules only. */
export function validateOwnerKontextImageInput(input: unknown): ValidatedOwnerKontextImageInput {
  let decodedBytes: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["content_base64", "filename", "mime_type"]);
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0) invalid();
    if (fields.content_base64.length > MAX_BASE64_CHARS) localResourceLimitExceeded();
    if (fields.content_base64.length % 4 !== 0 || typeof fields.filename !== "string" ||
        !isSafePortableBasename(fields.filename) || typeof fields.mime_type !== "string" ||
        !INPUT_MIME_TYPES.includes(fields.mime_type as OwnerKontextOriginalImageMimeType)) invalid();

    decodedBytes = Buffer.from(fields.content_base64, "base64");
    if (decodedBytes.byteLength > MAX_BYTES) localResourceLimitExceeded();
    if (decodedBytes.byteLength < 1 || decodedBytes.toString("base64") !== fields.content_base64) invalid();

    const originalMime = fields.mime_type as OwnerKontextOriginalImageMimeType;
    const canonicalMime: OwnerKontextCanonicalImageMimeType = originalMime === "image/jpg" ? "image/jpeg" : originalMime;
    const parsed = canonicalMime === "image/avif"
      ? inspectBoundedOwnerClarityAvifBytes(decodedBytes, MAX_BYTES)
      : inspectBoundedOwnerImageBytes(decodedBytes, MAX_BYTES);
    if (parsed.mime !== canonicalMime || !Number.isSafeInteger(parsed.width) || parsed.width < 1 ||
        !Number.isSafeInteger(parsed.height) || parsed.height < 1) invalid();

    const result: ValidatedOwnerKontextImageInput = Object.freeze({
      bytes: new Uint8Array(decodedBytes),
      filename: fields.filename,
      original_mime_type: originalMime,
      mime_type: canonicalMime,
      width: parsed.width,
      height: parsed.height,
      size: decodedBytes.byteLength,
      sha256: createHash("sha256").update(decodedBytes).digest("hex"),
      metadata_confidence: "CONTAINER_METADATA_ONLY"
    });
    decodedBytes.fill(0);
    return result;
  } catch (error) {
    decodedBytes?.fill(0);
    if (error instanceof OwnerKontextImageInputError) throw error;
    if (error instanceof UnsupportedOwnerClarityAvifCompositionError) {
      throw new OwnerKontextImageInputError("UNSUPPORTED_AVIF_COMPOSITION");
    }
    return invalid();
  }
}

function isSafePortableBasename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || value !== value.trimEnd() || value.endsWith(".") ||
      /\p{Cc}/u.test(value) || FILENAME_DELIMITERS.test(value) || RESERVED_WINDOWS_BASENAME.test(value) ||
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

function invalid(): never { throw new OwnerKontextImageInputError("INVALID_IMAGE_INPUT"); }
function localResourceLimitExceeded(): never { throw new OwnerKontextImageInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
