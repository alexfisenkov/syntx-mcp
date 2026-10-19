import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { inspectBoundedOwnerWanBmp } from "./owner-wan-bmp-inspector.js";
import { OWNER_WAN27_I2V_MODEL_ID } from "./owner-wan27-i2v-parameters.js";

const MAX_BYTES = 20 * 1024 * 1024, MIN_SIDE = 240, MAX_SIDE = 8_000;
const MIN_ASPECT = 0.125, MAX_ASPECT = 8, MAX_LOCAL_PIXELS = 52_500_000;
const SOURCE_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp"] as const);
const CANONICAL_MIMES = Object.freeze(["image/jpeg", "image/png", "image/bmp", "image/webp"] as const);
const VALIDATED = new WeakMap<object, ImageState>();
const TYPED_PROTO = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_PROTO, "buffer")!.get!;
const OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_PROTO, "byteOffset")!.get!;
const LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_PROTO, "byteLength")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export const OWNER_WAN27_I2V_IMAGE_POLICY = Object.freeze({
  model_id: OWNER_WAN27_I2V_MODEL_ID,
  source_mime_types: SOURCE_MIMES,
  canonical_mime_types: CANONICAL_MIMES,
  public_bounds: Object.freeze({ max_file_size: MAX_BYTES, min_side: MIN_SIDE, max_side: MAX_SIDE,
    min_aspect_ratio: MIN_ASPECT, max_aspect_ratio: MAX_ASPECT }),
  local_max_pixels: MAX_LOCAL_PIXELS,
  local_pixel_cap_confidence: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT",
  initial_cardinality: 1,
  initial_cardinality_confidence: "SOURCE_FORM_REQUIRES_FIRST_FRAME_LOCAL_POLICY_ONE_IMAGE_NOT_PROVIDER_ACCEPTANCE",
  metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED",
  generation_permit: false,
  provider_acceptance: "UNPROVEN"
});
export type OwnerWan27I2vImageSourceMimeType = typeof SOURCE_MIMES[number];
export type OwnerWan27I2vImageMimeType = typeof CANONICAL_MIMES[number];
export interface ValidatedOwnerWan27I2vImage {
  readonly status: "LOCAL_IMAGE_VALIDATED_NOT_UPLOAD_AUTHORITY"; readonly model_id: typeof OWNER_WAN27_I2V_MODEL_ID;
  readonly filename: string; readonly source_mime_type: OwnerWan27I2vImageSourceMimeType; readonly mime_type: OwnerWan27I2vImageMimeType;
  readonly size: number; readonly width: number; readonly height: number; readonly sha256: string;
  readonly metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED";
  readonly size_limit_confidence: "CURRENT_PUBLIC_POSITIVE_MAXIMUM";
  readonly upload_authority: false; readonly provider_acceptance: "UNPROVEN"; readonly owner_upload_binding: "NOT_ESTABLISHED";
}
interface ImageState { readonly bytes: Buffer; readonly filename: string; readonly sourceMime: OwnerWan27I2vImageSourceMimeType;
  readonly mime: OwnerWan27I2vImageMimeType; readonly size: number; readonly width: number; readonly height: number; readonly sha256: string; }
export class OwnerWan27I2vImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The WAN 2.7 I2V image input is invalid or exceeds a local safety limit."); this.name = "OwnerWan27I2vImagePolicyError";
  }
}
export function validateOwnerWan27I2vImage(input: unknown): Readonly<ValidatedOwnerWan27I2vImage> {
  let owned: Buffer | undefined;
  try {
    const f = exact(input, ["model_id", "filename", "mime_type", "bytes"]);
    if (f.model_id !== OWNER_WAN27_I2V_MODEL_ID || typeof f.filename !== "string" || !safeFilename(f.filename) ||
        typeof f.mime_type !== "string" || !SOURCE_MIMES.includes(f.mime_type as OwnerWan27I2vImageSourceMimeType)) invalid();
    const source = safeBytes(f.bytes);
    if (source.byteLength < 1) invalid();
    if (source.byteLength > MAX_BYTES) localLimit();
    owned = Buffer.allocUnsafe(source.byteLength); owned.set(source);
    const sourceMime = f.mime_type as OwnerWan27I2vImageSourceMimeType;
    const mime: OwnerWan27I2vImageMimeType = sourceMime === "image/jpg" ? "image/jpeg" : sourceMime;
    const parsed = mime === "image/bmp"
      ? { mime: "image/bmp" as const, ...inspectBoundedOwnerWanBmp(owned) }
      : inspectBoundedOwnerImageBytesWithMax(owned, MAX_BYTES);
    const aspect = parsed.width / parsed.height;
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < MIN_SIDE || parsed.height < MIN_SIDE || parsed.width > MAX_SIDE || parsed.height > MAX_SIDE ||
        aspect < MIN_ASPECT || aspect > MAX_ASPECT || parsed.width * parsed.height > MAX_LOCAL_PIXELS) invalid();
    const state: ImageState = Object.freeze({ bytes: owned, filename: f.filename, sourceMime, mime,
      size: owned.byteLength, width: parsed.width, height: parsed.height, sha256: createHash("sha256").update(owned).digest("hex") });
    const receipt = Object.freeze({ status: "LOCAL_IMAGE_VALIDATED_NOT_UPLOAD_AUTHORITY" as const, model_id: OWNER_WAN27_I2V_MODEL_ID,
      filename: state.filename, source_mime_type: state.sourceMime, mime_type: state.mime, size: state.size, width: state.width,
      height: state.height, sha256: state.sha256, metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const,
      size_limit_confidence: "CURRENT_PUBLIC_POSITIVE_MAXIMUM" as const, upload_authority: false as const,
      provider_acceptance: "UNPROVEN" as const, owner_upload_binding: "NOT_ESTABLISHED" as const });
    VALIDATED.set(receipt, state); owned = undefined; return receipt;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerWan27I2vImagePolicyError) throw error;
    return invalid();
  }
}
export function readValidatedOwnerWan27I2vImage(input: unknown): Readonly<{
  bytes: Uint8Array; model_id: typeof OWNER_WAN27_I2V_MODEL_ID; filename: string; source_mime_type: OwnerWan27I2vImageSourceMimeType;
  mime_type: OwnerWan27I2vImageMimeType; size: number; width: number; height: number; sha256: string;
}> | null {
  const state = live(input);
  return state ? Object.freeze({ bytes: new Uint8Array(state.bytes), model_id: OWNER_WAN27_I2V_MODEL_ID,
    filename: state.filename, source_mime_type: state.sourceMime, mime_type: state.mime, size: state.size,
    width: state.width, height: state.height, sha256: state.sha256 }) : null;
}
export function releaseValidatedOwnerWan27I2vImage(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = VALIDATED.get(input); if (!state) return false;
  state.bytes.fill(0); return VALIDATED.delete(input);
}
export function isValidatedOwnerWan27I2vImage(input: unknown): input is Readonly<ValidatedOwnerWan27I2vImage> {
  return live(input) !== null;
}
function live(input: unknown): ImageState | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  const state = VALIDATED.get(input);
  return state && state.bytes.byteLength === state.size && createHash("sha256").update(state.bytes).digest("hex") === state.sha256 ? state : null;
}
function safeBytes(value: unknown): Uint8Array {
  if (types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") ||
      Object.hasOwn(value, "length")) invalid();
  const backing = Reflect.apply(BUFFER_GETTER, value, []) as ArrayBuffer;
  const offset = Reflect.apply(OFFSET_GETTER, value, []) as number, length = Reflect.apply(LENGTH_GETTER, value, []) as number;
  const backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []) as number;
  if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || Object.hasOwn(backing, "byteLength") ||
      !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || offset + length > backingLength) invalid();
  return new Uint8Array(backing, offset, length);
}
function safeFilename(value: string): boolean {
  return !!value && value !== "." && value !== ".." && value === value.trimEnd() && !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value) &&
    Buffer.byteLength(value, "utf8") <= 255 && wellFormed(value);
}
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = value.charCodeAt(i + 1); if (n < 0xdc00 || n > 0xdfff) return false; i += 1; }
    else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
function exact(input: unknown, required: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) invalid();
  const prototype = Object.getPrototypeOf(input), d = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(d);
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
      keys.some(k => typeof k !== "string" || !required.includes(k) || !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true)) invalid();
  const out = Object.create(null) as Record<string, unknown>; for (const k of keys as string[]) out[k] = d[k]!.value; return out;
}
function localLimit(): never { throw new OwnerWan27I2vImagePolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
function invalid(): never { throw new OwnerWan27I2vImagePolicyError("INVALID_IMAGE_INPUT"); }
