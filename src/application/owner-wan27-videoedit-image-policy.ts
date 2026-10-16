import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { OwnerWanBmpInspectionError, inspectBoundedOwnerWanBmp } from "./owner-wan-bmp-inspector.js";

const MODEL_ID = "wan_27_videoedit" as const;
const AI_NAME = "wan_video" as const;
const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_SIDE = 240;
const MAX_SIDE = 4_096;
const MIME_TYPES = Object.freeze(["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"] as const);
const DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const RECEIPTS = new WeakMap<object, ImageState>();

export type OwnerWan27VideoEditImageSourceMimeType = typeof MIME_TYPES[number];
export type OwnerWan27VideoEditImageCanonicalMimeType = Exclude<OwnerWan27VideoEditImageSourceMimeType, "image/jpg">;

export const OWNER_WAN27_VIDEOEDIT_IMAGE_POLICY = Object.freeze({
  policy_id: "OWNER_WAN27_VIDEOEDIT_IMAGE_INPUT_POLICY_C19_LOCAL_GUARD_V1",
  public_catalog_version: CATALOG_VERSION,
  model_id: MODEL_ID,
  ai_name: AI_NAME,
  source_mime_types: MIME_TYPES,
  jpg_alias: "image/jpg -> image/jpeg" as const,
  max_file_size_bytes: MAX_BYTES,
  min_side: MIN_SIDE,
  max_side: MAX_SIDE,
  limits_confidence: "C19_METADATA_PLUS_LOCAL_RESOURCE_GUARD_NOT_PROVIDER_ACCEPTANCE" as const,
  metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const,
  generation_permit: false as const,
  reference_role_binding: "NOT_ESTABLISHED" as const,
  owner_upload_binding: "NOT_ESTABLISHED" as const
});

export interface ValidatedOwnerWan27VideoEditImage {
  readonly status: "LOCAL_SOURCE_VALIDATED";
  readonly model_id: typeof MODEL_ID;
  readonly source_policy_id: typeof OWNER_WAN27_VIDEOEDIT_IMAGE_POLICY.policy_id;
  readonly filename: string;
  readonly source_mime_type: OwnerWan27VideoEditImageSourceMimeType;
  readonly mime_type: OwnerWan27VideoEditImageCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly limits_confidence: typeof OWNER_WAN27_VIDEOEDIT_IMAGE_POLICY.limits_confidence;
  readonly metadata_confidence: typeof OWNER_WAN27_VIDEOEDIT_IMAGE_POLICY.metadata_confidence;
  readonly generation_permit: false;
  readonly reference_role_binding: "NOT_ESTABLISHED";
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}

export class OwnerWan27VideoEditImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_BMP_COMPOSITION") {
    super("The owner WAN 2.7 Video Edit image input is invalid or exceeds the local resource guard.");
    this.name = "OwnerWan27VideoEditImagePolicyError";
  }
}

interface ImageState {
  readonly bytes: Buffer;
  readonly filename: string;
  readonly sourceMime: OwnerWan27VideoEditImageSourceMimeType;
  readonly mime: OwnerWan27VideoEditImageCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
}

/** Validates owned image bytes for WAN 2.7 Video Edit; grants no upload or generation authority. */
export function validateOwnerWan27VideoEditImage(input: unknown): Readonly<ValidatedOwnerWan27VideoEditImage> {
  let owned: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "filename", "mime_type", "bytes"]);
    if (fields.model_id !== MODEL_ID || typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
        !MIME_TYPES.includes(fields.mime_type as OwnerWan27VideoEditImageSourceMimeType)) invalid();
    const source = readSourceBytes(fields.bytes);
    if (source.byteLength < 1) invalid();
    if (source.byteLength > MAX_BYTES) localLimit();

    owned = Buffer.allocUnsafe(source.byteLength);
    Uint8Array.prototype.set.call(owned, source);
    const sourceMime = fields.mime_type as OwnerWan27VideoEditImageSourceMimeType;
    const mime: OwnerWan27VideoEditImageCanonicalMimeType = sourceMime === "image/jpg" ? "image/jpeg" : sourceMime;
    let parsed: Readonly<{ mime: OwnerWan27VideoEditImageCanonicalMimeType; width: number; height: number }>;
    try {
      parsed = mime === "image/bmp"
        ? Object.freeze({ mime: "image/bmp" as const, ...inspectBoundedOwnerWanBmp(owned) })
        : inspectBoundedOwnerImageBytesWithMax(owned, MAX_BYTES);
    } catch (error) {
      if (error instanceof OwnerWanBmpInspectionError && error.code === "UNSUPPORTED_BMP_COMPOSITION") unsupportedBmp();
      invalid();
    }
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < MIN_SIDE || parsed.height < MIN_SIDE || parsed.width > MAX_SIDE || parsed.height > MAX_SIDE) invalid();

    const filename = canonicalFilename(fields.filename, mime);
    const state: ImageState = { bytes: owned, filename, sourceMime, mime, width: parsed.width, height: parsed.height,
      size: owned.byteLength, sha256: createHash("sha256").update(owned).digest("hex") };
    const receipt = Object.freeze({ status: "LOCAL_SOURCE_VALIDATED" as const, model_id: MODEL_ID,
      source_policy_id: OWNER_WAN27_VIDEOEDIT_IMAGE_POLICY.policy_id, filename, source_mime_type: sourceMime,
      mime_type: mime, width: state.width, height: state.height, size: state.size, sha256: state.sha256,
      limits_confidence: OWNER_WAN27_VIDEOEDIT_IMAGE_POLICY.limits_confidence,
      metadata_confidence: OWNER_WAN27_VIDEOEDIT_IMAGE_POLICY.metadata_confidence,
      generation_permit: false as const, reference_role_binding: "NOT_ESTABLISHED" as const,
      owner_upload_binding: "NOT_ESTABLISHED" as const });
    RECEIPTS.set(receipt, state);
    owned = undefined;
    return receipt;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerWan27VideoEditImagePolicyError) throw error;
    return invalid();
  }
}

/** True only while the private model-specific receipt snapshot remains live and intact. */
export function isValidatedOwnerWan27VideoEditImage(input: unknown): input is Readonly<ValidatedOwnerWan27VideoEditImage> {
  return getLiveState(input) !== null;
}

/** Rehashes the private snapshot and returns fresh consumer-owned bytes. */
export function readValidatedOwnerWan27VideoEditImage(input: unknown): Readonly<{
  bytes: Uint8Array;
  filename: string;
  mime_type: OwnerWan27VideoEditImageCanonicalMimeType;
  width: number;
  height: number;
  size: number;
  sha256: string;
}> | null {
  const state = getLiveState(input);
  return state ? Object.freeze({ bytes: new Uint8Array(state.bytes), filename: state.filename, mime_type: state.mime,
    width: state.width, height: state.height, size: state.size, sha256: state.sha256 }) : null;
}

/** Wipes only the private snapshot and revokes this nominal receipt. */
export function releaseValidatedOwnerWan27VideoEditImage(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = RECEIPTS.get(input);
  if (!state) return false;
  state.bytes.fill(0);
  return RECEIPTS.delete(input);
}

function getLiveState(input: unknown): ImageState | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  const state = RECEIPTS.get(input);
  return state && state.bytes.byteLength === state.size && createHash("sha256").update(state.bytes).digest("hex") === state.sha256
    ? state : null;
}

function readSourceBytes(value: unknown): Uint8Array {
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
  if (length > MAX_BYTES) localLimit();
  return new Uint8Array(backing, offset, length);
}

function canonicalFilename(filename: string, mime: OwnerWan27VideoEditImageCanonicalMimeType): string {
  if (!safeBasename(filename)) invalid();
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" :
    mime === "image/bmp" ? ".bmp" : ".webp";
  const canonical = `${stem}${extension}`;
  if (!safeBasename(canonical)) invalid();
  return canonical;
}

function safeBasename(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && value === value.trimEnd() && !value.endsWith(".") &&
    !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !DELIMITERS.test(value) && !RESERVED.test(value) && isWellFormedUnicode(value) &&
    Buffer.byteLength(value, "utf8") <= 255;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) =>
      typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of actual as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalid(); }
}

function invalid(): never { throw new OwnerWan27VideoEditImagePolicyError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerWan27VideoEditImagePolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
function unsupportedBmp(): never { throw new OwnerWan27VideoEditImagePolicyError("UNSUPPORTED_BMP_COMPOSITION"); }
