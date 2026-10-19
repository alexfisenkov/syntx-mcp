import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { isOwnerHiggsfieldDopModelId, type OwnerHiggsfieldDopModelId } from "./owner-higgsfield-dop-parameters.js";

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

/** Local input bounds only. No aspect or crop policy is inferred for either DOP model. */
export const OWNER_HIGGSFIELD_DOP_IMAGE_POLICY = Object.freeze({
  model_ids: Object.freeze(["dop-lite", "dop-turbo"] as const),
  supported_container_mime_types: MIME_TYPES,
  local_max_bytes: MAX_LOCAL_BYTES,
  local_max_bytes_policy: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
  max_dimension: MAX_DIMENSION,
  max_pixels: MAX_PIXELS,
  geometry_policy: "BOUNDED_GEOMETRY_NO_ASPECT_INFERENCE" as const,
  crop_resize_policy: "ORIGINAL_BYTES_NO_LOCAL_CROP_OR_RESIZE" as const,
  metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
  provider_acceptance: "UNPROVEN" as const,
  upload_authority: false as const,
  generation_authority: false as const
});

export type OwnerHiggsfieldDopImageMimeType = typeof MIME_TYPES[number];

export interface ValidatedOwnerHiggsfieldDopImageUpload {
  readonly status: "LOCAL_IMAGE_VALIDATED_NOT_UPLOAD_AUTHORITY";
  readonly model_id: OwnerHiggsfieldDopModelId;
  readonly filename: string;
  readonly mime_type: OwnerHiggsfieldDopImageMimeType;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
  readonly provider_acceptance: "UNPROVEN";
  readonly upload_authority: false;
}

export class OwnerHiggsfieldDopImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The owner Higgsfield DOP image is invalid or exceeds the local resource ceiling.");
    this.name = "OwnerHiggsfieldDopImagePolicyError";
  }
}

/** Validates one bounded original image; it does not crop, upload, or grant generation authority. */
export function validateOwnerHiggsfieldDopImageUpload(input: unknown): Readonly<ValidatedOwnerHiggsfieldDopImageUpload> {
  let owned: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "filename", "mime_type", "bytes"]);
    if (!isOwnerHiggsfieldDopModelId(fields.model_id) || typeof fields.filename !== "string" || !safeFilename(fields.filename) ||
        typeof fields.mime_type !== "string" || !oneOf(fields.mime_type, MIME_TYPES)) invalid();

    const source = readSourceBytes(fields.bytes);
    if (source.byteLength < 1) invalid();
    if (source.byteLength > MAX_LOCAL_BYTES) localLimit();
    owned = Buffer.allocUnsafe(source.byteLength);
    for (let index = 0; index < source.byteLength; index += 1) owned[index] = source[index]!;

    const parsed = inspectBoundedOwnerImageBytesWithMax(owned, MAX_LOCAL_BYTES);
    if (parsed.mime !== fields.mime_type || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < 1 || parsed.height < 1 || parsed.width > MAX_DIMENSION || parsed.height > MAX_DIMENSION ||
        parsed.width * parsed.height > MAX_PIXELS) invalid();

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
    if (error instanceof OwnerHiggsfieldDopImagePolicyError) throw error;
    return invalid();
  }
}

/** Returns a fresh caller-owned image byte copy only from a genuine live policy receipt. */
export function readValidatedOwnerHiggsfieldDopImageUpload(input: unknown): Readonly<{
  bytes: Uint8Array;
  model_id: OwnerHiggsfieldDopModelId;
  filename: string;
  mime_type: OwnerHiggsfieldDopImageMimeType;
  size: number;
  width: number;
  height: number;
  sha256: string;
}> | null {
  const state = getLiveState(input);
  return state ? Object.freeze({ bytes: new Uint8Array(state.bytes), model_id: state.model_id, filename: state.filename,
    mime_type: state.mime_type, size: state.size, width: state.width, height: state.height, sha256: state.sha256 }) : null;
}

/** Zeroes and revokes only the copy held by this policy. */
export function releaseValidatedOwnerHiggsfieldDopImageUpload(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = VALIDATED.get(input);
  if (!state) return false;
  state.bytes.fill(0);
  return VALIDATED.delete(input);
}

interface ValidatedState {
  readonly bytes: Buffer;
  readonly model_id: OwnerHiggsfieldDopModelId;
  readonly filename: string;
  readonly mime_type: OwnerHiggsfieldDopImageMimeType;
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
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length || keys.some((key) =>
      typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
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

function invalid(): never { throw new OwnerHiggsfieldDopImagePolicyError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerHiggsfieldDopImagePolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
