import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import {
  inspectBoundedOwnerClarityAvifBytesWithMax,
  UnsupportedOwnerClarityAvifCompositionError
} from "./owner-clarity-upscale-input-validator.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MIN_SIDE = 300;
const MAX_FILENAME_UTF8_BYTES = 255;
const PINNED_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/avif", "image/webp"] as const);
const MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/avif"] as const);
const DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const IMAGES = new WeakMap<object, ImageState>();

export const OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY = Object.freeze({
  policy_id: "OWNER_KLING_MOTION_CONTROL_IMAGE_INPUT_POLICY_B066_LOCAL_GUARD_V1",
  public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
  model_id: "kling_motion_control",
  source_mime_types: PINNED_MIME_TYPES,
  source_max_file_size_bytes: null,
  current_public_mime_types: MIME_TYPES,
  current_public_image_max_bytes: MAX_BYTES,
  max_file_size_bytes: MAX_BYTES,
  min_side: MIN_SIDE,
  size_limit_confidence: "CURRENT_PUBLIC_10MIB_IMAGE_MAXIMUM_LOCAL_GUARD" as const,
  metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const,
  generation_permit: false as const,
  frame_role_binding: "NOT_ESTABLISHED" as const,
  owner_upload_binding: "NOT_ESTABLISHED" as const
});

export type OwnerKlingMotionControlImageMimeType = typeof MIME_TYPES[number];

export interface ValidatedOwnerKlingMotionControlImage {
  readonly status: "LOCAL_SOURCE_VALIDATED";
  readonly model_id: "kling_motion_control";
  readonly source_policy_id: typeof OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.policy_id;
  readonly filename: string;
  readonly source_mime_type: OwnerKlingMotionControlImageMimeType;
  readonly mime_type: OwnerKlingMotionControlImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED";
  readonly size_limit_confidence: "CURRENT_PUBLIC_10MIB_IMAGE_MAXIMUM_LOCAL_GUARD";
  readonly generation_permit: false;
  readonly frame_role_binding: "NOT_ESTABLISHED";
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}

export class OwnerKlingMotionControlImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_AVIF_COMPOSITION") {
    super("The Kling Motion Control image input is invalid or exceeds the local resource guard.");
    this.name = "OwnerKlingMotionControlImagePolicyError";
  }
}

/** Validates owned MCV image bytes locally; it grants no role, upload, or generation authority. */
export function validateOwnerKlingMotionControlImage(input: unknown): Readonly<ValidatedOwnerKlingMotionControlImage> {
  let owned: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["filename", "mime_type", "bytes"]);
    if (typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
        !MIME_TYPES.includes(fields.mime_type as OwnerKlingMotionControlImageMimeType)) invalid();
    const source = readSourceBytes(fields.bytes);
    if (source.byteLength < 1) invalid();
    if (source.byteLength > MAX_BYTES) localLimit();
    owned = Buffer.allocUnsafe(source.byteLength);
    Uint8Array.prototype.set.call(owned, source);
    const mime = fields.mime_type as OwnerKlingMotionControlImageMimeType;
    let parsed: { readonly mime: string; readonly width: number; readonly height: number };
    try {
      parsed = mime === "image/avif"
        ? inspectBoundedOwnerClarityAvifBytesWithMax(owned, MAX_BYTES)
        : inspectBoundedOwnerImageBytesWithMax(owned, MAX_BYTES);
    } catch (error) {
      if (error instanceof UnsupportedOwnerClarityAvifCompositionError) unsupportedAvif();
      throw error;
    }
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < MIN_SIDE || parsed.height < MIN_SIDE) invalid();
    const filename = canonicalFilename(fields.filename, mime);
    const state: ImageState = { bytes: owned, filename, mime, width: parsed.width, height: parsed.height,
      size: owned.byteLength, sha256: createHash("sha256").update(owned).digest("hex") };
    const receipt = Object.freeze({ status: "LOCAL_SOURCE_VALIDATED" as const, model_id: "kling_motion_control" as const,
      source_policy_id: OWNER_KLING_MOTION_CONTROL_IMAGE_POLICY.policy_id, filename, source_mime_type: mime, mime_type: mime,
      width: state.width, height: state.height, size: state.size, sha256: state.sha256,
      metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const,
      size_limit_confidence: "CURRENT_PUBLIC_10MIB_IMAGE_MAXIMUM_LOCAL_GUARD" as const, generation_permit: false as const,
      frame_role_binding: "NOT_ESTABLISHED" as const, owner_upload_binding: "NOT_ESTABLISHED" as const });
    IMAGES.set(receipt, state);
    owned = undefined;
    return receipt;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerKlingMotionControlImagePolicyError) throw error;
    return invalid();
  }
}

/** Returns true only for a genuine receipt whose private snapshot still matches its hash. */
export function isValidatedOwnerKlingMotionControlImage(input: unknown): input is Readonly<ValidatedOwnerKlingMotionControlImage> {
  return getLiveState(input) !== null;
}

/** Returns a fresh byte copy from a live genuine receipt. */
export function readValidatedOwnerKlingMotionControlImage(input: unknown): Readonly<{
  bytes: Uint8Array; filename: string; mime_type: OwnerKlingMotionControlImageMimeType;
  width: number; height: number; size: number; sha256: string;
}> | null {
  const state = getLiveState(input);
  return state ? Object.freeze({ bytes: new Uint8Array(state.bytes), filename: state.filename, mime_type: state.mime,
    width: state.width, height: state.height, size: state.size, sha256: state.sha256 }) : null;
}

/** Wipes and revokes only this policy's private snapshot. */
export function releaseValidatedOwnerKlingMotionControlImage(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = IMAGES.get(input);
  if (!state) return false;
  state.bytes.fill(0);
  return IMAGES.delete(input);
}

interface ImageState {
  readonly bytes: Buffer; readonly filename: string; readonly mime: OwnerKlingMotionControlImageMimeType;
  readonly width: number; readonly height: number; readonly size: number; readonly sha256: string;
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
  const length = Reflect.apply(BYTE_LENGTH_GETTER, value, []) as number;
  const backing = Reflect.apply(BUFFER_GETTER, value, []) as ArrayBuffer;
  if (!Number.isSafeInteger(length) || types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype ||
      Object.hasOwn(backing, "byteLength") || Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []) < length) invalid();
  if (length > MAX_BYTES) localLimit();
  return new Uint8Array(backing, Reflect.apply(OFFSET_GETTER, value, []) as number, length);
}
function canonicalFilename(filename: string, mime: OwnerKlingMotionControlImageMimeType): string {
  if (!safeBasename(filename)) invalid();
  const dot = filename.lastIndexOf("."), stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" : mime === "image/avif" ? ".avif" : ".webp";
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
function invalid(): never { throw new OwnerKlingMotionControlImagePolicyError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerKlingMotionControlImagePolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
function unsupportedAvif(): never { throw new OwnerKlingMotionControlImagePolicyError("UNSUPPORTED_AVIF_COMPOSITION"); }
