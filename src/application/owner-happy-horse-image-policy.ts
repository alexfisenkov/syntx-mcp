import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { isOwnerHappyHorseImageModelId, type OwnerHappyHorseImageModelId } from "./owner-happy-horse-parameters.js";

const MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp"] as const);
const MAX_BYTES = 10 * 1024 * 1024;
const MIN_SIDE = 400;
const MAX_SIDE = 8_000;
const MAX_PIXELS = 52_500_000;
const MAX_FILENAME_BYTES = 255;
const VALIDATED = new WeakMap<object, State>();

export type OwnerHappyHorseImageMimeType = typeof MIME_TYPES[number];
export interface OwnerHappyHorseValidatedImage {
  readonly status: "LOCAL_IMAGE_VALIDATED_NOT_UPLOAD_AUTHORITY";
  readonly model_id: OwnerHappyHorseImageModelId;
  readonly filename: string;
  readonly mime_type: OwnerHappyHorseImageMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly confidence: "BOUNDED_CONTAINER_METADATA_NOT_DECODED_PIXELS";
  readonly size_limit_confidence: "CATALOG_METADATA_AND_LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
  readonly upload_authority: false;
}
export class OwnerHappyHorseImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE" | "LOCAL_LIMIT_EXCEEDED") {
    super("HappyHorse image input is invalid or exceeds local bounds.");
    this.name = "OwnerHappyHorseImagePolicyError";
  }
}

/** Copies and inspects one original image; it never crops, resizes, uploads, or grants generation authority. */
export function validateOwnerHappyHorseImage(input: unknown): Readonly<OwnerHappyHorseValidatedImage> {
  let owned: Buffer | undefined;
  try {
    const f = exact(input, ["model_id", "filename", "mime_type", "bytes"]);
    if (!isOwnerHappyHorseImageModelId(f.model_id) || typeof f.filename !== "string" || !safeFilename(f.filename) ||
        typeof f.mime_type !== "string" || !(MIME_TYPES as readonly string[]).includes(f.mime_type)) invalid();
    const source = sourceBytes(f.bytes);
    if (source.byteLength < 1) invalid();
    if (source.byteLength > MAX_BYTES) localLimit();
    owned = Buffer.allocUnsafe(source.byteLength);
    for (let i = 0; i < source.byteLength; i++) owned[i] = source[i]!;
    const parsed = inspectBoundedOwnerImageBytesWithMax(owned, MAX_BYTES);
    const mimeMatches = parsed.mime === f.mime_type || (f.mime_type === "image/jpg" && parsed.mime === "image/jpeg");
    if (!mimeMatches || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < MIN_SIDE || parsed.height < MIN_SIDE || parsed.width > MAX_SIDE || parsed.height > MAX_SIDE ||
        parsed.width * parsed.height > MAX_PIXELS) invalid();
    const state: State = { bytes: owned, model_id: f.model_id, filename: f.filename, mime_type: parsed.mime as OwnerHappyHorseImageMimeType,
      size: owned.byteLength, sha256: createHash("sha256").update(owned).digest("hex"), width: parsed.width, height: parsed.height };
    const receipt = Object.freeze({ status: "LOCAL_IMAGE_VALIDATED_NOT_UPLOAD_AUTHORITY" as const, model_id: state.model_id,
      filename: state.filename, mime_type: state.mime_type, size: state.size, sha256: state.sha256,
      width: state.width, height: state.height, confidence: "BOUNDED_CONTAINER_METADATA_NOT_DECODED_PIXELS" as const,
      size_limit_confidence: "CATALOG_METADATA_AND_LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const, upload_authority: false as const });
    VALIDATED.set(receipt, state); owned = undefined; return receipt;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerHappyHorseImagePolicyError) throw error;
    return invalid();
  }
}

export function readValidatedOwnerHappyHorseImage(input: unknown): Readonly<{
  bytes: Uint8Array; model_id: OwnerHappyHorseImageModelId; filename: string; mime_type: OwnerHappyHorseImageMimeType;
  size: number; sha256: string; width: number; height: number;
}> | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  const state = VALIDATED.get(input);
  if (!state || state.bytes.byteLength !== state.size || createHash("sha256").update(state.bytes).digest("hex") !== state.sha256) return null;
  return Object.freeze({ bytes: new Uint8Array(state.bytes), model_id: state.model_id, filename: state.filename,
    mime_type: state.mime_type, size: state.size, sha256: state.sha256, width: state.width, height: state.height });
}

export function releaseValidatedOwnerHappyHorseImage(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = VALIDATED.get(input);
  if (!state) return false;
  state.bytes.fill(0);
  return VALIDATED.delete(input);
}

interface State { readonly bytes: Buffer; readonly model_id: OwnerHappyHorseImageModelId; readonly filename: string;
  readonly mime_type: OwnerHappyHorseImageMimeType; readonly size: number; readonly sha256: string; readonly width: number; readonly height: number }
function exact(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const proto = Object.getPrototypeOf(value), ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds);
    if ((proto !== Object.prototype && proto !== null) || keys.length !== expected.length || keys.some(key => typeof key !== "string" ||
      !expected.includes(key) || !ds[key] || !Object.hasOwn(ds[key]!, "value") || ds[key]!.enumerable !== true)) invalid();
    const out = Object.create(null) as Record<string, unknown>; for (const key of expected) out[key] = ds[key]!.value; return out;
  } catch { return invalid(); }
}
function sourceBytes(value: unknown): Uint8Array {
  if (types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length")) invalid();
  return value;
}
function safeFilename(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value) &&
    wellFormed(value) && Buffer.byteLength(value, "utf8") <= MAX_FILENAME_BYTES;
}
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { if (i + 1 >= value.length) return false; const n = value.charCodeAt(++i); if (n < 0xdc00 || n > 0xdfff) return false; }
    else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
function invalid(): never { throw new OwnerHappyHorseImagePolicyError("INVALID_IMAGE"); }
function localLimit(): never { throw new OwnerHappyHorseImagePolicyError("LOCAL_LIMIT_EXCEEDED"); }
