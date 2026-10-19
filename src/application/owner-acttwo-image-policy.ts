import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";

const MODEL_ID = "acttwo" as const;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 8_400;
const MAX_PIXELS = 52_500_000;
const MIME_TYPES = Object.freeze(["image/jpeg", "image/png"] as const);
const FILENAME = /^[^/\\\u0000-\u001f\u007f]{1,128}$/u;
const STATE = new WeakMap<object, { readonly context: Readonly<ValidatedOwnerActTwoCharacterImage>; readonly bytes: Buffer }>();
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;
const LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;

export type OwnerActTwoCharacterImageMimeType = typeof MIME_TYPES[number];

export interface ValidatedOwnerActTwoCharacterImage {
  readonly status: "LOCALLY_VALIDATED_ACTTWO_CHARACTER_IMAGE_NOT_UPLOAD_AUTHORITY";
  readonly model_id: typeof MODEL_ID;
  readonly filename: string;
  readonly mime_type: OwnerActTwoCharacterImageMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly local_max_bytes: typeof MAX_BYTES;
  readonly metadata_confidence: "STRUCTURAL_IMAGE_METADATA_NOT_DECODED_PIXELS";
  readonly generation_permit: false;
}

export class OwnerActTwoImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE" | "LOCAL_LIMIT_EXCEEDED") {
    super("The ActTwo character image is not valid under the local input policy.");
    this.name = "OwnerActTwoImagePolicyError";
  }
}

/** Checks the source-observed JPEG/PNG slot under conservative local size and geometry limits. */
export function validateOwnerActTwoCharacterImage(input: unknown): Readonly<ValidatedOwnerActTwoCharacterImage> {
  const fields = exactRecord(input);
  if (fields.model_id !== MODEL_ID || typeof fields.filename !== "string" || !FILENAME.test(fields.filename) ||
      typeof fields.mime_type !== "string" || !MIME_TYPES.includes(fields.mime_type as OwnerActTwoCharacterImageMimeType) ||
      !(fields.bytes instanceof Uint8Array) || types.isProxy(fields.bytes)) invalid();
  const filenameExtension = extension(fields.filename);
  if ((fields.mime_type === "image/jpeg" && filenameExtension !== ".jpg" && filenameExtension !== ".jpeg") ||
      (fields.mime_type === "image/png" && filenameExtension !== ".png")) invalid();
  const bytes = copyBytes(fields.bytes);
  try {
    if (bytes.byteLength < 1) invalid();
    if (bytes.byteLength > MAX_BYTES) localLimit();
    const parsed = inspectBoundedOwnerImageBytesWithMax(bytes, MAX_BYTES);
    if (parsed.mime !== fields.mime_type) invalid();
    if (parsed.width < 1 || parsed.height < 1 || parsed.width > MAX_DIMENSION || parsed.height > MAX_DIMENSION ||
        parsed.width * parsed.height > MAX_PIXELS) localLimit();
    const context = Object.freeze({ status: "LOCALLY_VALIDATED_ACTTWO_CHARACTER_IMAGE_NOT_UPLOAD_AUTHORITY" as const,
      model_id: MODEL_ID, filename: fields.filename, mime_type: fields.mime_type as OwnerActTwoCharacterImageMimeType,
      size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), width: parsed.width, height: parsed.height,
      local_max_bytes: MAX_BYTES as typeof MAX_BYTES, metadata_confidence: "STRUCTURAL_IMAGE_METADATA_NOT_DECODED_PIXELS" as const,
      generation_permit: false as const });
    STATE.set(context, { context, bytes });
    return context;
  } catch (error) {
    bytes.fill(0);
    if (error instanceof OwnerActTwoImagePolicyError) throw error;
    return invalid();
  }
}

export function readValidatedOwnerActTwoCharacterImage(value: unknown): Readonly<ValidatedOwnerActTwoCharacterImage & { readonly bytes: Buffer }> | null {
  const state = readState(value);
  if (!state) return null;
  return Object.freeze({ ...state.context, bytes: Buffer.from(state.bytes) });
}

export function isValidatedOwnerActTwoCharacterImage(value: unknown): value is Readonly<ValidatedOwnerActTwoCharacterImage> {
  return readState(value) !== null;
}

export function releaseValidatedOwnerActTwoCharacterImage(value: unknown): boolean {
  const state = readState(value);
  if (!state) return false;
  state.bytes.fill(0);
  return STATE.delete(value as object);
}

function readState(value: unknown): { readonly context: Readonly<ValidatedOwnerActTwoCharacterImage>; readonly bytes: Buffer } | null {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return null;
    const state = STATE.get(value);
    if (!state || state.context !== value || state.bytes.byteLength !== state.context.size ||
        state.context.model_id !== MODEL_ID || state.context.generation_permit !== false) return null;
    return state;
  } catch { return null; }
}

function exactRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const required = ["model_id", "filename", "mime_type", "bytes"];
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== "string" || !required.includes(key) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalid(); }
}

function copyBytes(value: Uint8Array): Buffer {
  try {
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) || ["buffer", "byteOffset", "byteLength", "length"].some(key => Object.hasOwn(value, key)) ||
        !BUFFER_GETTER || !OFFSET_GETTER || !LENGTH_GETTER || !ARRAY_BUFFER_LENGTH_GETTER) invalid();
    const backing = Reflect.apply(BUFFER_GETTER, value, []) as ArrayBuffer;
    const offset = Reflect.apply(OFFSET_GETTER, value, []) as number;
    const length = Reflect.apply(LENGTH_GETTER, value, []) as number;
    const backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []) as number;
    if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(length) || length < 1 || length > MAX_BYTES || offset + length > backingLength) invalid();
    const source = new Uint8Array(backing, offset, length), copy = Buffer.allocUnsafe(length);
    for (let index = 0; index < length; index += 1) copy[index] = source[index]!;
    return copy;
  } catch { return invalid(); }
}

function extension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot).toLowerCase();
}
function invalid(): never { throw new OwnerActTwoImagePolicyError("INVALID_IMAGE"); }
function localLimit(): never { throw new OwnerActTwoImagePolicyError("LOCAL_LIMIT_EXCEEDED"); }
