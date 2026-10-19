import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";

const MODEL_IDS = Object.freeze(["grok_i2v", "grok_15_i2v"] as const);
const MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"] as const);
const MAX_BYTES: Readonly<Record<OwnerGrokI2vImageModelId, number>> = Object.freeze({
  grok_i2v: 20 * 1024 * 1024,
  grok_15_i2v: 10 * 1024 * 1024
});
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

/** Local structural admission only; catalog bytes/dimensions do not prove decoder or provider acceptance. */
export const OWNER_GROK_I2V_IMAGE_POLICY = Object.freeze({
  model_ids: MODEL_IDS,
  supported_container_mime_types: MIME_TYPES,
  jpeg_wire_mime_type: "image/jpeg" as const,
  local_max_bytes: MAX_BYTES,
  local_max_bytes_policy: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
  max_dimension: MAX_DIMENSION,
  max_pixels: MAX_PIXELS,
  legacy_grok_i2v_input_geometry: "EXACT_16_9_LOCAL_INITIAL_SLICE_ONLY" as const,
  grok_15_i2v_input_geometry: "ANY_BOUNDED_GEOMETRY_OUTPUT_ASPECT_IS_EXPLICIT" as const,
  crop_resize_policy: "ORIGINAL_BYTES_NO_LOCAL_CROP_OR_RESIZE" as const,
  metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
  provider_acceptance: "UNPROVEN" as const,
  upload_authority: false as const,
  generation_authority: false as const
});

export type OwnerGrokI2vImageModelId = typeof MODEL_IDS[number];
export type OwnerGrokI2vImageMimeType = typeof MIME_TYPES[number];

export interface ValidatedOwnerGrokI2vImageUpload {
  readonly status: "LOCAL_IMAGE_VALIDATED_NOT_UPLOAD_AUTHORITY";
  readonly model_id: OwnerGrokI2vImageModelId;
  readonly filename: string;
  readonly mime_type: OwnerGrokI2vImageMimeType;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
  readonly provider_acceptance: "UNPROVEN";
  readonly upload_authority: false;
}

export class OwnerGrokI2vImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The owner Grok I2V image is invalid or exceeds the local resource ceiling.");
    this.name = "OwnerGrokI2vImagePolicyError";
  }
}

/** Validates the original bounded image bytes; it does not crop, upload, or grant generation authority. */
export function validateOwnerGrokI2vImageUpload(input: unknown): Readonly<ValidatedOwnerGrokI2vImageUpload> {
  let owned: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "filename", "mime_type", "bytes"]);
    if (!oneOf(fields.model_id, MODEL_IDS) || typeof fields.filename !== "string" || !safeFilename(fields.filename) ||
        typeof fields.mime_type !== "string" || !oneOf(fields.mime_type, MIME_TYPES)) invalid();

    const source = readSourceBytes(fields.bytes);
    if (source.byteLength < 1) invalid();
    const maxBytes = MAX_BYTES[fields.model_id];
    if (source.byteLength > maxBytes) localLimit();
    owned = Buffer.allocUnsafe(source.byteLength);
    for (let index = 0; index < source.byteLength; index += 1) owned[index] = source[index]!;

    const parsed = inspectBoundedOwnerImageBytesWithMax(owned, maxBytes);
    if (parsed.mime !== fields.mime_type || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < 1 || parsed.height < 1 || parsed.width > MAX_DIMENSION || parsed.height > MAX_DIMENSION ||
        parsed.width * parsed.height > MAX_PIXELS ||
        (fields.model_id === "grok_i2v" && parsed.width * 9 !== parsed.height * 16)) invalid();

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
      provider_acceptance: "UNPROVEN" as const, upload_authority: false as const
    });
    VALIDATED.set(receipt, state);
    owned = undefined;
    return receipt;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerGrokI2vImagePolicyError) throw error;
    return invalid();
  }
}

/** Returns a fresh caller-owned byte copy only for a genuine, live receipt. */
export function readValidatedOwnerGrokI2vImageUpload(input: unknown): Readonly<{
  bytes: Uint8Array;
  model_id: OwnerGrokI2vImageModelId;
  filename: string;
  mime_type: OwnerGrokI2vImageMimeType;
  size: number;
  width: number;
  height: number;
  sha256: string;
}> | null {
  const state = getLiveState(input);
  return state ? Object.freeze({ bytes: new Uint8Array(state.bytes), model_id: state.model_id,
    filename: state.filename, mime_type: state.mime_type, size: state.size,
    width: state.width, height: state.height, sha256: state.sha256 }) : null;
}

/** Zeroes and revokes only the private copy owned by this policy. */
export function releaseValidatedOwnerGrokI2vImageUpload(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = VALIDATED.get(input);
  if (!state) return false;
  state.bytes.fill(0);
  return VALIDATED.delete(input);
}

interface ValidatedState {
  readonly bytes: Buffer;
  readonly model_id: OwnerGrokI2vImageModelId;
  readonly filename: string;
  readonly mime_type: OwnerGrokI2vImageMimeType;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || actual.length !== required.length || actual.some((key) =>
      typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of actual as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalid(); }
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
  return new Uint8Array(backing, offset, length);
}

function safeFilename(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !FILENAME_SEPARATORS.test(value) &&
    !FILENAME_CONTROLS.test(value) && isWellFormedUnicode(value) && Buffer.byteLength(value, "utf8") <= MAX_FILENAME_UTF8_BYTES;
}
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(index + 1); if (next < 0xdc00 || next > 0xdfff) return false; index += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T { return typeof value === "string" && values.includes(value as T); }
function getLiveState(input: unknown): ValidatedState | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  const state = VALIDATED.get(input);
  return state && state.bytes.byteLength === state.size && createHash("sha256").update(state.bytes).digest("hex") === state.sha256 ? state : null;
}
function invalid(): never { throw new OwnerGrokI2vImagePolicyError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerGrokI2vImagePolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
