import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  inspectBoundedOwnerClarityAvifBytesWithMax,
  UnsupportedOwnerClarityAvifCompositionError
} from "./owner-clarity-upscale-input-validator.js";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";

const MAX_BYTES = 30 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_BYTES / 3) * 4;
const MIN_SIDE = 300;
const MAX_FILENAME_UTF8_BYTES = 255;
const MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif"] as const);
const FILENAME_DELIMITERS = /[<>:"\/\\|?*]/u;
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const VALIDATED_IMAGES = new WeakMap<object, Readonly<ValidatedState>>();
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;

export const OWNER_KLING_I2V_IMAGE_INPUT_POLICY = Object.freeze({
  source_max_bytes: MAX_BYTES,
  local_max_bytes: MAX_BYTES,
  local_max_bytes_policy: "LOCAL_RESOURCE_CEILING_MATCHES_SOURCE_MAX_NOT_PROVIDER_ACCEPTANCE" as const,
  min_side: MIN_SIDE,
  filename_utf8_max_bytes: MAX_FILENAME_UTF8_BYTES,
  filename_policy: "LOCAL_PORTABLE_BASENAME_ONLY" as const,
  mime_types: MIME_TYPES,
  metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const
});

export type OwnerKlingI2VMimeType = typeof MIME_TYPES[number];
export type OwnerKlingI2VCanonicalMimeType = "image/jpeg" | "image/png" | "image/avif";

export interface ValidatedOwnerKlingI2VImageInput {
  readonly filename: string;
  readonly original_mime_type: OwnerKlingI2VMimeType;
  readonly mime_type: OwnerKlingI2VCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  /** Returns a fresh copy each time; mutating it cannot change the sealed validation snapshot. */
  readonly bytes: Uint8Array;
}

export class OwnerKlingI2VImageInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_AVIF_COMPOSITION") {
    super("The owner Kling I2V image input is invalid or locally unsupported.");
    this.name = "OwnerKlingI2VImageInputError";
  }
}

/** Validates actual image bytes; supplied MIME and filename are claims that must match the bytes. */
export function validateOwnerKlingI2VImageInput(input: unknown): ValidatedOwnerKlingI2VImageInput {
  let decoded: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["content_base64", "filename", "mime_type"]);
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0) invalid();
    if (fields.content_base64.length > MAX_BASE64_CHARS) resourceLimit();
    if (fields.content_base64.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(fields.content_base64) ||
        typeof fields.filename !== "string" || !isSafePortableBasename(fields.filename) ||
        typeof fields.mime_type !== "string" || !MIME_TYPES.includes(fields.mime_type as OwnerKlingI2VMimeType)) invalid();

    decoded = Buffer.from(fields.content_base64, "base64");
    if (decoded.byteLength > MAX_BYTES) resourceLimit();
    if (decoded.byteLength < 1 || decoded.toString("base64") !== fields.content_base64) invalid();
    const result = validateOwnerKlingI2VImageBytes({ bytes: decoded, filename: fields.filename, mime_type: fields.mime_type });
    decoded.fill(0);
    return result;
  } catch (error) {
    decoded?.fill(0);
    if (error instanceof OwnerKlingI2VImageInputError) throw error;
    if (error instanceof UnsupportedOwnerClarityAvifCompositionError) {
      throw new OwnerKlingI2VImageInputError("UNSUPPORTED_AVIF_COMPOSITION");
    }
    return invalid();
  }
}

/** Validates real bytes at the native upload boundary without trusting caller MIME or dimensions. */
export function validateOwnerKlingI2VImageBytes(input: unknown): ValidatedOwnerKlingI2VImageInput {
  try {
    const fields = exactRecord(input, ["bytes", "filename", "mime_type"]);
    if (typeof fields.filename !== "string" || !isSafePortableBasename(fields.filename) ||
        typeof fields.mime_type !== "string" || !MIME_TYPES.includes(fields.mime_type as OwnerKlingI2VMimeType) ||
        !isSafeImageByteView(fields.bytes)) invalid();
    const bytes = fields.bytes as Uint8Array;
    const size = typedArrayByteLength(bytes);
    if (size > MAX_BYTES) resourceLimit();
    if (size < 1) invalid();

    const originalMime = fields.mime_type as OwnerKlingI2VMimeType;
    const mime: OwnerKlingI2VCanonicalMimeType = originalMime === "image/jpg" ? "image/jpeg" : originalMime;
    const parsed = mime === "image/avif"
      ? inspectBoundedOwnerClarityAvifBytesWithMax(bytes, MAX_BYTES)
      : inspectBoundedOwnerImageBytesWithMax(bytes, MAX_BYTES);
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < MIN_SIDE || parsed.height < MIN_SIDE) invalid();

    const state: Readonly<ValidatedState> = Object.freeze({
      bytes: new Uint8Array(bytes), filename: fields.filename, originalMime, mime,
      width: parsed.width, height: parsed.height, size, sha256: createHash("sha256").update(bytes).digest("hex")
    });
    const result = Object.freeze({
      filename: state.filename,
      original_mime_type: state.originalMime,
      mime_type: state.mime,
      width: state.width,
      height: state.height,
      size: state.size,
      sha256: state.sha256,
      metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
      get bytes(): Uint8Array { return new Uint8Array(state.bytes); }
    });
    VALIDATED_IMAGES.set(result, state);
    return result;
  } catch (error) {
    if (error instanceof OwnerKlingI2VImageInputError) throw error;
    if (error instanceof UnsupportedOwnerClarityAvifCompositionError) {
      throw new OwnerKlingI2VImageInputError("UNSUPPORTED_AVIF_COMPOSITION");
    }
    return invalid();
  }
}

/** Internal adapter access: only an object returned by this module can be read as an owned snapshot. */
export function readValidatedOwnerKlingI2VImageInput(input: unknown): Readonly<{
  bytes: Uint8Array;
  filename: string;
  mime_type: OwnerKlingI2VCanonicalMimeType;
  width: number;
  height: number;
  size: number;
  sha256: string;
}> | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  const state = VALIDATED_IMAGES.get(input);
  if (!state) return null;
  return Object.freeze({ bytes: new Uint8Array(state.bytes), filename: state.filename, mime_type: state.mime,
    width: state.width, height: state.height, size: state.size, sha256: state.sha256 });
}

interface ValidatedState {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly originalMime: OwnerKlingI2VMimeType;
  readonly mime: OwnerKlingI2VCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
}

function isSafePortableBasename(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && value === value.trimEnd() && !value.endsWith(".") &&
    !/\p{Cc}/u.test(value) && !FILENAME_DELIMITERS.test(value) && !RESERVED_WINDOWS_BASENAME.test(value) &&
    isWellFormedUnicode(value) && Buffer.byteLength(value, "utf8") <= MAX_FILENAME_UTF8_BYTES;
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
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!))) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isSafeImageByteView(value: unknown): value is Uint8Array {
  if (!(value instanceof Uint8Array) || types.isProxy(value) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "length")) return false;
  const backing = typedArrayBuffer(value);
  return !types.isProxy(backing) && Object.getPrototypeOf(backing) === ArrayBuffer.prototype && !Object.hasOwn(backing, "byteLength");
}

function typedArrayByteLength(value: Uint8Array): number {
  return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
}

function typedArrayBuffer(value: Uint8Array): ArrayBuffer {
  return Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer;
}

function invalid(): never { throw new OwnerKlingI2VImageInputError("INVALID_IMAGE_INPUT"); }
function resourceLimit(): never { throw new OwnerKlingI2VImageInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
