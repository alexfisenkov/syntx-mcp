import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { inspectBoundedOwnerWanBmp } from "./owner-wan-bmp-inspector.js";

const CATALOG_MAX_FILE_BYTES = 1_048_576_000;
const MAX_LOCAL_RESOURCE_BYTES = 64 * 1024 * 1024;
const MAX_BMP_INSPECTOR_BYTES = 20 * 1024 * 1024;
const MIN_SIDE = 384;
const MAX_SIDE = 5_000;
const MAX_FILENAME_UTF8_BYTES = 255;
const MODEL_IDS = Object.freeze(["wan_26_r2v", "wan_26_r2v_flash"] as const);
const SOURCE_MIME_TYPES = Object.freeze(["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"] as const);
const DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const IMAGES = new WeakMap<object, ImageState>();

/** C396 metadata and bounded inspector limits are separate: this local policy does not claim vendor admission. */
export const OWNER_WAN26_R2V_IMAGE_POLICY = Object.freeze({
  policy_id: "OWNER_WAN26_R2V_IMAGE_INPUT_POLICY_C396_LOCAL_V1",
  public_catalog_version: "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json",
  public_catalog_fetched_at: "2026-10-15T07:17:24.901Z",
  public_models_sha256: "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a",
  model_ids: MODEL_IDS,
  source_mime_types: SOURCE_MIME_TYPES,
  jpg_alias: "image/jpg -> image/jpeg" as const,
  catalog_max_file_size_bytes: CATALOG_MAX_FILE_BYTES,
  max_local_resource_bytes: MAX_LOCAL_RESOURCE_BYTES,
  bmp_local_resource_bytes: MAX_BMP_INSPECTOR_BYTES,
  local_resource_guard_reason: "EXISTING_BOUNDED_INSPECTOR_MAXIMUMS" as const,
  local_resource_guard_configurable: false as const,
  policy_readonly: true as const,
  min_side: MIN_SIDE,
  max_side: MAX_SIDE,
  size_policy: "C396_CATALOG_METADATA_SEPARATE_FROM_LOCAL_RESOURCE_GUARDS" as const,
  metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const,
  generation_permit: false as const,
  owner_upload_binding: "NOT_ESTABLISHED" as const
});

export type OwnerWan26R2vModelId = typeof MODEL_IDS[number];
export type OwnerWan26R2vImageSourceMimeType = typeof SOURCE_MIME_TYPES[number];
export type OwnerWan26R2vImageCanonicalMimeType = Exclude<OwnerWan26R2vImageSourceMimeType, "image/jpg">;

export interface ValidatedOwnerWan26R2vImage {
  readonly status: "LOCAL_SOURCE_VALIDATED";
  readonly model_id: OwnerWan26R2vModelId;
  readonly source_policy_id: typeof OWNER_WAN26_R2V_IMAGE_POLICY.policy_id;
  readonly filename: string;
  readonly source_mime_type: OwnerWan26R2vImageSourceMimeType;
  readonly mime_type: OwnerWan26R2vImageCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED";
  readonly catalog_max_file_size_bytes: typeof CATALOG_MAX_FILE_BYTES;
  readonly max_local_resource_bytes: typeof MAX_LOCAL_RESOURCE_BYTES;
  readonly generation_permit: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}

export class OwnerWan26R2vImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The WAN 2.6 R2V image input is invalid or exceeds the local resource guard.");
    this.name = "OwnerWan26R2vImagePolicyError";
  }
}

/** Validates one image byte input for either exact R2V model; no count, upload, or generation authority is issued. */
export function validateOwnerWan26R2vImage(input: unknown): Readonly<ValidatedOwnerWan26R2vImage> {
  let owned: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "filename", "mime_type", "bytes"]);
    if (typeof fields.model_id !== "string" || !MODEL_IDS.includes(fields.model_id as OwnerWan26R2vModelId) ||
        typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
        !SOURCE_MIME_TYPES.includes(fields.mime_type as OwnerWan26R2vImageSourceMimeType)) invalid();
    const source = readSourceBytes(fields.bytes, fields.mime_type as OwnerWan26R2vImageSourceMimeType);
    const sourceMime = fields.mime_type as OwnerWan26R2vImageSourceMimeType;
    const mime: OwnerWan26R2vImageCanonicalMimeType = sourceMime === "image/jpg" ? "image/jpeg" : sourceMime;
    owned = Buffer.allocUnsafe(source.byteLength);
    Uint8Array.prototype.set.call(owned, source);

    const parsed = mime === "image/bmp"
      ? { mime: "image/bmp" as const, ...inspectBoundedOwnerWanBmp(owned) }
      : inspectBoundedOwnerImageBytesWithMax(owned, MAX_LOCAL_RESOURCE_BYTES);
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < MIN_SIDE || parsed.height < MIN_SIDE || parsed.width > MAX_SIDE || parsed.height > MAX_SIDE) invalid();

    const modelId = fields.model_id as OwnerWan26R2vModelId;
    const filename = canonicalFilename(fields.filename, mime);
    const state: ImageState = { bytes: owned, modelId, filename, sourceMime, mime,
      width: parsed.width, height: parsed.height, size: owned.byteLength,
      sha256: createHash("sha256").update(owned).digest("hex") };
    const receipt = Object.freeze({
      status: "LOCAL_SOURCE_VALIDATED" as const,
      model_id: modelId,
      source_policy_id: OWNER_WAN26_R2V_IMAGE_POLICY.policy_id,
      filename,
      source_mime_type: sourceMime,
      mime_type: mime,
      width: state.width,
      height: state.height,
      size: state.size,
      sha256: state.sha256,
      metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const,
      catalog_max_file_size_bytes: CATALOG_MAX_FILE_BYTES,
      max_local_resource_bytes: MAX_LOCAL_RESOURCE_BYTES,
      generation_permit: false as const,
      owner_upload_binding: "NOT_ESTABLISHED" as const
    });
    IMAGES.set(receipt, state);
    owned = undefined;
    return receipt;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerWan26R2vImagePolicyError) throw error;
    return invalid();
  }
}

/** Revalidates the private snapshot digest and returns a fresh caller-owned byte copy. */
export function readValidatedOwnerWan26R2vImage(input: unknown): Readonly<{
  bytes: Uint8Array;
  model_id: OwnerWan26R2vModelId;
  filename: string;
  mime_type: OwnerWan26R2vImageCanonicalMimeType;
  width: number;
  height: number;
  size: number;
  sha256: string;
}> | null {
  const state = getLiveState(input);
  return state ? Object.freeze({ bytes: new Uint8Array(state.bytes), model_id: state.modelId,
    filename: state.filename, mime_type: state.mime, width: state.width, height: state.height,
    size: state.size, sha256: state.sha256 }) : null;
}

/** Wipes the policy-owned snapshot and revokes its receipt. */
export function releaseValidatedOwnerWan26R2vImage(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = IMAGES.get(input);
  if (!state) return false;
  state.bytes.fill(0);
  return IMAGES.delete(input);
}

export function isValidatedOwnerWan26R2vImage(input: unknown): input is Readonly<ValidatedOwnerWan26R2vImage> {
  return getLiveState(input) !== null;
}

interface ImageState {
  readonly bytes: Buffer;
  readonly modelId: OwnerWan26R2vModelId;
  readonly filename: string;
  readonly sourceMime: OwnerWan26R2vImageSourceMimeType;
  readonly mime: OwnerWan26R2vImageCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
}

function getLiveState(input: unknown): ImageState | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  const state = IMAGES.get(input);
  return state && state.bytes.byteLength === state.size &&
    createHash("sha256").update(state.bytes).digest("hex") === state.sha256 ? state : null;
}

function readSourceBytes(value: unknown, mime: OwnerWan26R2vImageSourceMimeType): Uint8Array {
  if (types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length")) invalid();
  const length = Reflect.apply(BYTE_LENGTH_GETTER, value, []) as number;
  const backing = Reflect.apply(BUFFER_GETTER, value, []) as ArrayBuffer;
  const offset = Reflect.apply(OFFSET_GETTER, value, []) as number;
  const backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []) as number;
  if (!Number.isSafeInteger(length) || length < 1 || types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype ||
      Object.hasOwn(backing, "byteLength") || !Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(backingLength) || offset + length > backingLength) invalid();
  if (length > MAX_LOCAL_RESOURCE_BYTES || (mime === "image/bmp" && length > MAX_BMP_INSPECTOR_BYTES)) localLimit();
  return new Uint8Array(backing, offset, length);
}

function canonicalFilename(filename: string, mime: OwnerWan26R2vImageCanonicalMimeType): string {
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

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) =>
      typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of actual as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalid(); }
}

function isWellFormedUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(i + 1); if (next < 0xdc00 || next > 0xdfff) return false; i += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function invalid(): never { throw new OwnerWan26R2vImagePolicyError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerWan26R2vImagePolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
