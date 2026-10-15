import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { inspectBoundedOwnerWanBmp } from "./owner-wan-bmp-inspector.js";

const MODEL_ID = "wan_25_i2v_preview" as const;
const MAX_BYTES = 10 * 1024 * 1024;
const MIN_SIDE = 384;
const MAX_SIDE = 5_000;
const MAX_FILENAME_UTF8_BYTES = 255;
const MIME_TYPES = Object.freeze(["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"] as const);
const DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const ARRAY_BUFFER_RESIZABLE_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const TYPED_ARRAY_SET = Uint8Array.prototype.set;
const IMAGES = new WeakMap<object, ImageState>();

/** C396 catalog values used as local input guards; they do not establish provider limits or acceptance. */
export const OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY = Object.freeze({
  policy_id: "OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY_C396_LOCAL_GUARD_V1",
  catalog_version: "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json",
  catalog_fetched_at: "2026-10-15T07:17:24.901Z",
  model_id: MODEL_ID,
  image_count_limit: 1,
  source_mime_types: MIME_TYPES,
  jpg_alias: "image/jpg -> image/jpeg" as const,
  max_file_size_bytes: MAX_BYTES,
  min_side: MIN_SIDE,
  max_side: MAX_SIDE,
  bounds_policy: "C396_CATALOG_LOCAL_GUARD_NOT_CURRENT_PROVIDER_LIMIT_OR_ACCEPTANCE" as const,
  metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const,
  dispatch_allowed: false as const,
  generation_permit: false as const,
  owner_upload_binding: "NOT_ESTABLISHED" as const
});

export type OwnerWan25I2vPreviewImageSourceMimeType = typeof MIME_TYPES[number];
export type OwnerWan25I2vPreviewImageCanonicalMimeType = Exclude<OwnerWan25I2vPreviewImageSourceMimeType, "image/jpg">;

export interface ValidatedOwnerWan25I2vPreviewImage {
  readonly status: "LOCAL_SOURCE_VALIDATED";
  readonly model_id: typeof MODEL_ID;
  readonly source_policy_id: typeof OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.policy_id;
  readonly filename: string;
  readonly source_mime_type: OwnerWan25I2vPreviewImageSourceMimeType;
  readonly mime_type: OwnerWan25I2vPreviewImageCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED";
  readonly size_limit_confidence: "C396_CATALOG_LOCAL_GUARD_NOT_CURRENT_PROVIDER_LIMIT_OR_ACCEPTANCE";
  readonly dispatch_allowed: false;
  readonly generation_permit: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}

export class OwnerWan25I2vPreviewImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The WAN 2.5 I2V preview image input is invalid or exceeds the local resource guard.");
    this.name = "OwnerWan25I2vPreviewImagePolicyError";
  }
}

/** Validates one local source image for this exact model; it grants no upload or generation authority. */
export function validateOwnerWan25I2vPreviewImage(input: unknown): Readonly<ValidatedOwnerWan25I2vPreviewImage> {
  let owned: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "filename", "mime_type", "bytes"]);
    if (fields.model_id !== MODEL_ID || typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
        !MIME_TYPES.includes(fields.mime_type as OwnerWan25I2vPreviewImageSourceMimeType)) invalid();
    const source = readSourceBytes(fields.bytes);
    if (source.byteLength < 1) invalid();
    if (source.byteLength > MAX_BYTES) localLimit();
    owned = Buffer.allocUnsafe(source.byteLength);
    Reflect.apply(TYPED_ARRAY_SET, owned, [source]);
    const sourceMime = fields.mime_type as OwnerWan25I2vPreviewImageSourceMimeType;
    const mime: OwnerWan25I2vPreviewImageCanonicalMimeType = sourceMime === "image/jpg" ? "image/jpeg" : sourceMime;
    const parsed = mime === "image/bmp"
      ? { mime: "image/bmp" as const, ...inspectBoundedOwnerWanBmp(owned) }
      : inspectBoundedOwnerImageBytesWithMax(owned, MAX_BYTES);
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < MIN_SIDE || parsed.height < MIN_SIDE || parsed.width > MAX_SIDE || parsed.height > MAX_SIDE) invalid();
    const filename = canonicalFilename(fields.filename, mime);
    const state: ImageState = { bytes: owned, filename, sourceMime, mime, width: parsed.width, height: parsed.height,
      size: owned.byteLength, sha256: createHash("sha256").update(owned).digest("hex") };
    const receipt: Readonly<ValidatedOwnerWan25I2vPreviewImage> = Object.freeze({ status: "LOCAL_SOURCE_VALIDATED",
      model_id: MODEL_ID, source_policy_id: OWNER_WAN25_I2V_PREVIEW_IMAGE_POLICY.policy_id, filename,
      source_mime_type: sourceMime, mime_type: mime, width: state.width, height: state.height, size: state.size,
      sha256: state.sha256, metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED",
      size_limit_confidence: "C396_CATALOG_LOCAL_GUARD_NOT_CURRENT_PROVIDER_LIMIT_OR_ACCEPTANCE",
      dispatch_allowed: false, generation_permit: false, owner_upload_binding: "NOT_ESTABLISHED" });
    IMAGES.set(receipt, state);
    owned = undefined;
    return receipt;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerWan25I2vPreviewImagePolicyError) throw error;
    return invalid();
  }
}

/** Returns an independent byte copy while the genuine private digest still matches. */
export function readValidatedOwnerWan25I2vPreviewImage(input: unknown): Readonly<{
  bytes: Uint8Array; model_id: typeof MODEL_ID; filename: string; mime_type: OwnerWan25I2vPreviewImageCanonicalMimeType;
  width: number; height: number; size: number; sha256: string;
}> | null {
  const state = getLiveState(input);
  return state ? Object.freeze({ bytes: new Uint8Array(state.bytes), model_id: MODEL_ID, filename: state.filename,
    mime_type: state.mime, width: state.width, height: state.height, size: state.size, sha256: state.sha256 }) : null;
}

/** Wipes and revokes this policy's private snapshot. */
export function releaseValidatedOwnerWan25I2vPreviewImage(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = IMAGES.get(input);
  if (!state) return false;
  state.bytes.fill(0);
  return IMAGES.delete(input);
}

export function isValidatedOwnerWan25I2vPreviewImage(input: unknown): input is Readonly<ValidatedOwnerWan25I2vPreviewImage> {
  return getLiveState(input) !== null;
}

interface ImageState {
  readonly bytes: Buffer;
  readonly filename: string;
  readonly sourceMime: OwnerWan25I2vPreviewImageSourceMimeType;
  readonly mime: OwnerWan25I2vPreviewImageCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
}

function getLiveState(input: unknown): ImageState | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  const state = IMAGES.get(input);
  return state && state.bytes.byteLength === state.size && createHash("sha256").update(state.bytes).digest("hex") === state.sha256 ? state : null;
}

function readSourceBytes(value: unknown): Uint8Array {
  if (types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length")) invalid();
  const length = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
  const offset = Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number;
  const backing = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer;
  if (!Number.isSafeInteger(length) || !Number.isSafeInteger(offset) || length < 0 || offset < 0 || types.isProxy(backing) ||
      Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || Object.hasOwn(backing, "byteLength") ||
      (ARRAY_BUFFER_RESIZABLE_GETTER && Reflect.apply(ARRAY_BUFFER_RESIZABLE_GETTER, backing, []) === true)) invalid();
  const backingLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, backing, []) as number;
  if (!Number.isSafeInteger(backingLength) || offset + length > backingLength) invalid();
  if (length > MAX_BYTES) localLimit();
  return new Uint8Array(backing, offset, length);
}

function canonicalFilename(filename: string, mime: OwnerWan25I2vPreviewImageCanonicalMimeType): string {
  if (!safeBasename(filename)) invalid();
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" : mime === "image/bmp" ? ".bmp" : ".webp";
  const canonical = `${stem}${extension}`;
  if (!safeBasename(canonical)) invalid();
  return canonical;
}

function safeBasename(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && value === value.trimEnd() && !value.endsWith(".") &&
    !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !DELIMITERS.test(value) && !RESERVED.test(value) && isWellFormedUnicode(value) &&
    Buffer.byteLength(value, "utf8") <= MAX_FILENAME_UTF8_BYTES;
}

function isWellFormedUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(i + 1); if (next < 0xdc00 || next > 0xdfff) return false; i += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) =>
    typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function invalid(): never { throw new OwnerWan25I2vPreviewImagePolicyError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerWan25I2vPreviewImagePolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
