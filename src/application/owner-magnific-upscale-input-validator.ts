import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  inspectBoundedOwnerClarityAvifBytes,
  UnsupportedOwnerClarityAvifCompositionError
} from "./owner-clarity-upscale-input-validator.js";
import { inspectBoundedOwnerImageBytes } from "./owner-image-reference-input-validator.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_BYTES / 3) * 4;
const SAFE_FILENAME = /^[^/\\\u0000-\u001f\u007f]{1,128}$/u;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/avif", "image/webp"]);

export const OWNER_MAGNIFIC_UPSCALE_INPUT_POLICY = Object.freeze({
  local_max_bytes: MAX_BYTES,
  local_max_bytes_policy: "SOURCE_UI_FALLBACK_NOT_PROVIDER_LIMIT" as const,
  source_frontend_max_file_size: 0,
  source_frontend_size_check: "NO_POSITIVE_CHECK_FOR_ZERO" as const,
  source_file_uploader_fallback_bytes: MAX_BYTES,
  server_limit: "UNKNOWN" as const
});

export type OwnerMagnificUpscaleImageMimeType = "image/jpeg" | "image/png" | "image/avif" | "image/webp";

export interface ValidatedOwnerMagnificUpscaleInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerMagnificUpscaleImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export class OwnerMagnificUpscaleInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_AVIF_COMPOSITION") {
    super("The owner Magnific image input is invalid or unsupported.");
    this.name = "OwnerMagnificUpscaleInputError";
  }
}

/** Validates one bounded Magnific image without treating source or provider limits as known. */
export function validateOwnerMagnificUpscaleInput(input: unknown): ValidatedOwnerMagnificUpscaleInput {
  let decodedBytes: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["content_base64", "filename", "mime_type"]);
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0) invalid();
    if (fields.content_base64.length > MAX_BASE64_CHARS) localResourceLimitExceeded();
    if (fields.content_base64.length % 4 !== 0 ||
        typeof fields.filename !== "string" || !SAFE_FILENAME.test(fields.filename) ||
        typeof fields.mime_type !== "string" || !MIME_TYPES.has(fields.mime_type)) invalid();

    decodedBytes = Buffer.from(fields.content_base64, "base64");
    if (decodedBytes.byteLength > MAX_BYTES) localResourceLimitExceeded();
    if (decodedBytes.byteLength < 1 || decodedBytes.toString("base64") !== fields.content_base64) invalid();
    const mime = fields.mime_type as OwnerMagnificUpscaleImageMimeType;
    const parsed = mime === "image/avif"
      ? inspectBoundedOwnerClarityAvifBytes(decodedBytes, MAX_BYTES)
      : inspectBoundedOwnerImageBytes(decodedBytes, MAX_BYTES);
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || parsed.width < 1 ||
        !Number.isSafeInteger(parsed.height) || parsed.height < 1) invalid();

    const result = Object.freeze({
      bytes: new Uint8Array(decodedBytes),
      filename: fields.filename,
      mime_type: mime,
      width: parsed.width,
      height: parsed.height,
      sha256: createHash("sha256").update(decodedBytes).digest("hex"),
      metadata_confidence: "CONTAINER_METADATA_ONLY" as const
    });
    decodedBytes.fill(0);
    return result;
  } catch (error) {
    decodedBytes?.fill(0);
    if (error instanceof OwnerMagnificUpscaleInputError) throw error;
    if (error instanceof UnsupportedOwnerClarityAvifCompositionError) {
      throw new OwnerMagnificUpscaleInputError("UNSUPPORTED_AVIF_COMPOSITION");
    }
    return invalid();
  }
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

function invalid(): never { throw new OwnerMagnificUpscaleInputError("INVALID_IMAGE_INPUT"); }
function localResourceLimitExceeded(): never { throw new OwnerMagnificUpscaleInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
