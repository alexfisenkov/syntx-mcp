import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { isOwnerHailuoInitialModelId, type OwnerHailuoInitialModelId } from "./owner-hailuo-media-parameters.js";

const MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"] as const);
const MAX_LOCAL_BYTES = 10 * 1024 * 1024;
const MAX_FILENAME_UTF8_BYTES = 255;
const MAX_PIXELS = 52_500_000;
const MAX_DIMENSION: Readonly<Record<OwnerHailuoInitialModelId, number>> = Object.freeze({
  "hailuo-01-live-character": 8_400,
  "hailuo-2.3-fast": 8_400,
  "hailuo-3.0": 5_760
});
const MIN_DIMENSION: Readonly<Record<OwnerHailuoInitialModelId, number>> = Object.freeze({
  "hailuo-01-live-character": 1,
  "hailuo-2.3-fast": 1,
  "hailuo-3.0": 256
});
const FILENAME_SEPARATORS = /[\\/]/u;
const FILENAME_CONTROLS = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const VALIDATED = new WeakMap<object, ValidatedState>();

/** Local subset and safety ceiling only; source MIME declarations are broader for Hailuo 3.0. */
export const OWNER_HAILUO_INITIAL_IMAGE_POLICY = Object.freeze({
  model_ids: Object.freeze(["hailuo-01-live-character", "hailuo-2.3-fast", "hailuo-3.0"] as const),
  local_supported_mime_types: MIME_TYPES,
  public_metadata_current_mime_types: Object.freeze({
    "hailuo-01-live-character": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp"] as const),
    "hailuo-2.3-fast": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp"] as const),
    "hailuo-3.0": Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/bmp", "image/gif"] as const)
  }),
  file_count_policy: "ONE_IMAGE_INITIAL_SLICE_WITHIN_PUBLIC_MAXIMUM_NOT_REQUIRED_MINIMUM" as const,
  local_max_bytes: MAX_LOCAL_BYTES,
  local_max_bytes_policy: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
  max_dimension: MAX_DIMENSION,
  min_dimension: MIN_DIMENSION,
  dimension_confidence: "PUBLIC_METADATA_BOUND_FOR_3_0_AND_LOCAL_CEILING_FOR_OTHERS_NOT_PROVIDER_ACCEPTANCE" as const,
  max_pixels: MAX_PIXELS,
  geometry_policy: "BOUNDED_CONTAINER_METADATA_NO_ASPECT_INFERENCE" as const,
  crop_resize_policy: "ORIGINAL_BYTES_NO_LOCAL_CROP_OR_RESIZE" as const,
  metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
  provider_acceptance: "UNPROVEN" as const,
  upload_authority: false as const,
  generation_authority: false as const
});

export type OwnerHailuoInitialImageMimeType = typeof MIME_TYPES[number];

export interface ValidatedOwnerHailuoInitialImage {
  readonly status: "LOCAL_IMAGE_VALIDATED_NOT_UPLOAD_AUTHORITY";
  readonly model_id: OwnerHailuoInitialModelId;
  readonly filename: string;
  readonly mime_type: OwnerHailuoInitialImageMimeType;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
  readonly upload_authority: false;
  readonly provider_acceptance: "UNPROVEN";
}

export class OwnerHailuoInitialImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The owner Hailuo initial image is invalid or exceeds the local resource ceiling.");
    this.name = "OwnerHailuoInitialImagePolicyError";
  }
}

/** Validates one original image and owns a private copy; it cannot crop, upload, or dispatch. */
export function validateOwnerHailuoInitialImage(input: unknown): Readonly<ValidatedOwnerHailuoInitialImage> {
  let owned: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "filename", "mime_type", "bytes"]);
    if (!isOwnerHailuoInitialModelId(fields.model_id) || typeof fields.filename !== "string" || !safeFilename(fields.filename) ||
        typeof fields.mime_type !== "string" || !oneOf(fields.mime_type, MIME_TYPES)) invalidImage();

    const source = readSourceBytes(fields.bytes);
    if (source.byteLength < 1) invalidImage();
    if (source.byteLength > MAX_LOCAL_BYTES) localLimit();
    owned = Buffer.allocUnsafe(source.byteLength);
    for (let index = 0; index < source.byteLength; index += 1) owned[index] = source[index]!;

    const parsed = inspectBoundedOwnerImageBytesWithMax(owned, MAX_LOCAL_BYTES);
    const maxDimension = MAX_DIMENSION[fields.model_id];
    const minDimension = MIN_DIMENSION[fields.model_id];
    if (parsed.mime !== fields.mime_type || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < minDimension || parsed.height < minDimension || parsed.width > maxDimension || parsed.height > maxDimension ||
        parsed.width * parsed.height > MAX_PIXELS) invalidImage();

    const state: ValidatedState = {
      bytes: owned, model_id: fields.model_id, filename: fields.filename, mime_type: parsed.mime,
      size: owned.byteLength, width: parsed.width, height: parsed.height,
      sha256: createHash("sha256").update(owned).digest("hex")
    };
    const receipt = Object.freeze({
      status: "LOCAL_IMAGE_VALIDATED_NOT_UPLOAD_AUTHORITY" as const,
      model_id: state.model_id, filename: state.filename, mime_type: state.mime_type,
      size: state.size, width: state.width, height: state.height, sha256: state.sha256,
      metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
      size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
      upload_authority: false as const, provider_acceptance: "UNPROVEN" as const
    });
    VALIDATED.set(receipt, state);
    owned = undefined;
    return receipt;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerHailuoInitialImagePolicyError) throw error;
    return invalidImage();
  }
}

/** Returns a fresh caller-owned byte copy from a genuine live local-validation receipt. */
export function readValidatedOwnerHailuoInitialImage(input: unknown): Readonly<{
  bytes: Uint8Array;
  model_id: OwnerHailuoInitialModelId;
  filename: string;
  mime_type: OwnerHailuoInitialImageMimeType;
  size: number;
  width: number;
  height: number;
  sha256: string;
}> | null {
  const state = getLiveState(input);
  return state ? Object.freeze({ bytes: new Uint8Array(state.bytes), model_id: state.model_id, filename: state.filename,
    mime_type: state.mime_type, size: state.size, width: state.width, height: state.height, sha256: state.sha256 }) : null;
}

/** Zeroes and revokes only the private byte copy owned by this policy. */
export function releaseValidatedOwnerHailuoInitialImage(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = VALIDATED.get(input);
  if (!state) return false;
  state.bytes.fill(0);
  return VALIDATED.delete(input);
}

interface ValidatedState {
  readonly bytes: Buffer;
  readonly model_id: OwnerHailuoInitialModelId;
  readonly filename: string;
  readonly mime_type: OwnerHailuoInitialImageMimeType;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidImage();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length || keys.some((key) =>
      typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalidImage();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalidImage(); }
}

function readSourceBytes(value: unknown): Uint8Array {
  if (types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length")) invalidImage();
  const backing = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer;
  const offset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []) as number;
  const length = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
  const backingLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, backing, []) as number;
  if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || Object.hasOwn(backing, "byteLength") ||
      !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || offset + length > backingLength) invalidImage();
  return new Uint8Array(backing, offset, length);
}

function safeFilename(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !FILENAME_SEPARATORS.test(value) &&
    !FILENAME_CONTROLS.test(value) && isWellFormedUnicode(value) && Buffer.byteLength(value, "utf8") <= MAX_FILENAME_UTF8_BYTES;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function getLiveState(input: unknown): ValidatedState | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  const state = VALIDATED.get(input);
  return state && state.bytes.byteLength === state.size && createHash("sha256").update(state.bytes).digest("hex") === state.sha256 ? state : null;
}

function invalidImage(): never { throw new OwnerHailuoInitialImagePolicyError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerHailuoInitialImagePolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
