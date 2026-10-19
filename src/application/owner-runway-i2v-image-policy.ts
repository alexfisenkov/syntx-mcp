import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";

const MODEL_IDS = Object.freeze(["4genfirstframeimage", "turbo4genfirstframeimage", "gen4.5i2v"] as const);
const GEN45_MODEL_ID = "gen4.5i2v" as const;
const ASPECT_RATIOS = Object.freeze(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const);
const RATIO_PARTS: Readonly<Record<OwnerRunwayI2vImageAspectRatio, readonly [number, number]>> = Object.freeze({
  "21:9": [21, 9], "16:9": [16, 9], "4:3": [4, 3], "1:1": [1, 1], "3:4": [3, 4], "9:16": [9, 16]
});
const MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"] as const);
const MAX_LOCAL_BYTES = 10 * 1024 * 1024;
const MAX_FILENAME_UTF8_BYTES = 255;
const MAX_DIMENSION = 8_400;
const MAX_PIXELS = 52_500_000;
const FILENAME_SEPARATORS = /[\\/]/u;
const FILENAME_CONTROLS = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const VALIDATED = new WeakMap<object, ValidatedState>();

/** Local structural admission only; values here are not provider limits or upload authority. */
export const OWNER_RUNWAY_I2V_IMAGE_POLICY = Object.freeze({
  model_ids: MODEL_IDS,
  aspect_ratios: ASPECT_RATIOS,
  model_aspect_ratios: Object.freeze({ "gen4.5i2v": Object.freeze(["16:9"] as const), legacy: ASPECT_RATIOS }),
  supported_container_mime_types: MIME_TYPES,
  unsupported_catalog_format: "image/avif" as const,
  local_max_bytes: MAX_LOCAL_BYTES,
  local_max_bytes_policy: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
  max_dimension: MAX_DIMENSION,
  max_pixels: MAX_PIXELS,
  crop_geometry: Object.freeze({
    legacy: "INPUT_MUST_ALREADY_MATCH_SELECTED_ASPECT_RATIO_NO_IMPLICIT_CROP_OR_RESIZE" as const,
    "gen4.5i2v": "ONE_ALREADY_CROPPED_16_9_IMAGE_NO_IMPLICIT_CROP_OR_RESIZE" as const
  }),
  metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
  provider_acceptance: "UNPROVEN" as const,
  upload_authority: false as const,
  generation_authority: false as const
});

export type OwnerRunwayI2vImageModelId = typeof MODEL_IDS[number];
export type OwnerRunwayI2vImageAspectRatio = typeof ASPECT_RATIOS[number];
export type OwnerRunwayI2vImageMimeType = typeof MIME_TYPES[number];

export interface ValidatedOwnerRunwayI2vImageUpload {
  readonly status: "LOCAL_IMAGE_VALIDATED_NOT_UPLOAD_AUTHORITY";
  readonly model_id: OwnerRunwayI2vImageModelId;
  readonly aspect_ratio: OwnerRunwayI2vImageAspectRatio;
  readonly filename: string;
  readonly mime_type: OwnerRunwayI2vImageMimeType;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
  readonly provider_acceptance: "UNPROVEN";
  readonly upload_authority: false;
}

export class OwnerRunwayI2vImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The owner Runway I2V image is invalid or exceeds the local resource ceiling.");
    this.name = "OwnerRunwayI2vImagePolicyError";
  }
}

/** Validates a caller-supplied, already-cropped image without granting upload or generation authority. */
export function validateOwnerRunwayI2vImageUpload(input: unknown): Readonly<ValidatedOwnerRunwayI2vImageUpload> {
  let owned: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "aspect_ratio", "filename", "mime_type", "bytes"]);
    if (!oneOf(fields.model_id, MODEL_IDS) || !isSupportedAspect(fields.model_id, fields.aspect_ratio) ||
        typeof fields.filename !== "string" || !safeFilename(fields.filename) ||
        typeof fields.mime_type !== "string" || !oneOf(fields.mime_type, MIME_TYPES)) invalid();

    const source = readSourceBytes(fields.bytes);
    if (source.byteLength < 1) invalid();
    if (source.byteLength > MAX_LOCAL_BYTES) localLimit();
    owned = Buffer.allocUnsafe(source.byteLength);
    for (let index = 0; index < source.byteLength; index += 1) owned[index] = source[index]!;

    const parsed = inspectBoundedOwnerImageBytesWithMax(owned, MAX_LOCAL_BYTES);
    if (parsed.mime !== fields.mime_type || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < 1 || parsed.height < 1 || parsed.width > MAX_DIMENSION || parsed.height > MAX_DIMENSION ||
        parsed.width * parsed.height > MAX_PIXELS || !matchesAspect(parsed.width, parsed.height, fields.aspect_ratio)) invalid();

    const state: ValidatedState = {
      bytes: owned,
      model_id: fields.model_id,
      aspect_ratio: fields.aspect_ratio,
      filename: fields.filename,
      mime_type: parsed.mime,
      size: owned.byteLength,
      width: parsed.width,
      height: parsed.height,
      sha256: createHash("sha256").update(owned).digest("hex")
    };
    const receipt = Object.freeze({
      status: "LOCAL_IMAGE_VALIDATED_NOT_UPLOAD_AUTHORITY" as const,
      model_id: state.model_id,
      aspect_ratio: state.aspect_ratio,
      filename: state.filename,
      mime_type: state.mime_type,
      size: state.size,
      width: state.width,
      height: state.height,
      sha256: state.sha256,
      metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
      size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
      provider_acceptance: "UNPROVEN" as const,
      upload_authority: false as const
    });
    VALIDATED.set(receipt, state);
    owned = undefined;
    return receipt;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerRunwayI2vImagePolicyError) throw error;
    return invalid();
  }
}

/** The native Runway upload client may consume a fresh copy only from this genuine live receipt. */
export function readValidatedOwnerRunwayI2vImageUpload(input: unknown): Readonly<{
  bytes: Uint8Array;
  model_id: OwnerRunwayI2vImageModelId;
  aspect_ratio: OwnerRunwayI2vImageAspectRatio;
  filename: string;
  mime_type: OwnerRunwayI2vImageMimeType;
  size: number;
  width: number;
  height: number;
  sha256: string;
}> | null {
  const state = getLiveState(input);
  return state ? Object.freeze({
    bytes: new Uint8Array(state.bytes), model_id: state.model_id, aspect_ratio: state.aspect_ratio,
    filename: state.filename, mime_type: state.mime_type, size: state.size,
    width: state.width, height: state.height, sha256: state.sha256
  }) : null;
}

/** Wipes and revokes only this policy's held copy; it never mutates the caller's original bytes. */
export function releaseValidatedOwnerRunwayI2vImageUpload(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = VALIDATED.get(input);
  if (!state) return false;
  state.bytes.fill(0);
  return VALIDATED.delete(input);
}

interface ValidatedState {
  readonly bytes: Buffer;
  readonly model_id: OwnerRunwayI2vImageModelId;
  readonly aspect_ratio: OwnerRunwayI2vImageAspectRatio;
  readonly filename: string;
  readonly mime_type: OwnerRunwayI2vImageMimeType;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== required.length || actual.some((key) =>
    typeof key !== "string" || !required.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function readSourceBytes(value: unknown): Uint8Array {
  if (types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length")) invalid();
  const backing = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer;
  const offset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []) as number;
  const length = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
  const backingLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, backing, []) as number;
  if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || Object.hasOwn(backing, "byteLength") ||
      !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || offset + length > backingLength) invalid();
  if (length > MAX_LOCAL_BYTES) localLimit();
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
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function matchesAspect(width: number, height: number, aspect: OwnerRunwayI2vImageAspectRatio): boolean {
  const [numerator, denominator] = RATIO_PARTS[aspect];
  return width * denominator === height * numerator;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isSupportedAspect(model: unknown, aspect: unknown): aspect is OwnerRunwayI2vImageAspectRatio {
  return model === GEN45_MODEL_ID ? aspect === "16:9" :
    (model === "4genfirstframeimage" || model === "turbo4genfirstframeimage") && oneOf(aspect, ASPECT_RATIOS);
}

function getLiveState(input: unknown): ValidatedState | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  const state = VALIDATED.get(input);
  return state && state.bytes.byteLength === state.size && createHash("sha256").update(state.bytes).digest("hex") === state.sha256 ? state : null;
}

function invalid(): never { throw new OwnerRunwayI2vImagePolicyError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerRunwayI2vImagePolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
