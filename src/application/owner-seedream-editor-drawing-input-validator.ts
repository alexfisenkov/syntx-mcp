import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";

const LOCAL_RESOURCE_BOUND_BYTES = 32 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(LOCAL_RESOURCE_BOUND_BYTES / 3) * 4;
const MAX_FILENAME_UTF8_BYTES = 255;
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const FILENAME_DELIMITERS = /[<>:"/\\|?*]/u;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export const OWNER_SEEDREAM_EDITOR_DRAWING_INPUT_POLICY = Object.freeze({
  mime_type: "image/png" as const,
  local_resource_bound_bytes: LOCAL_RESOURCE_BOUND_BYTES,
  local_resource_policy: "BOUNDED_CONTAINER_INSPECTION_ONLY_NOT_SOURCE_OR_PROVIDER_LIMIT" as const,
  metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
  pixel_decode_verified: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export interface ValidatedOwnerSeedreamEditorDrawing {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: "image/png";
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly pixel_decode_verified: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerSeedreamEditorDrawingInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The Seedream Editor drawing input is invalid or exceeds the local resource bound.");
    this.name = "OwnerSeedreamEditorDrawingInputError";
  }
}

export function validateOwnerSeedreamEditorDrawingInput(input: unknown): ValidatedOwnerSeedreamEditorDrawing {
  let decoded: Buffer | undefined;
  try {
    const fields = readFields(input, "content_base64");
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0) invalid();
    if (fields.content_base64.length > MAX_BASE64_CHARS) limit();
    if (!hasCanonicalBase64(fields.content_base64)) invalid();
    decoded = Buffer.from(fields.content_base64, "base64");
    if (decoded.byteLength > LOCAL_RESOURCE_BOUND_BYTES) limit();
    if (decoded.byteLength < 1 || decoded.toString("base64") !== fields.content_base64) invalid();
    const result = validateOwned(decoded, fields.filename as string, fields.original_width, fields.original_height);
    decoded.fill(0); decoded = undefined;
    return result;
  } catch (error) {
    decoded?.fill(0);
    if (error instanceof OwnerSeedreamEditorDrawingInputError) throw error;
    return invalid();
  }
}

export function validateOwnerSeedreamEditorDrawingUploadData(input: unknown): ValidatedOwnerSeedreamEditorDrawing {
  let owned: Uint8Array | undefined;
  try {
    const fields = readFields(input, "bytes"), source = fields.bytes;
    if (types.isProxy(source) || !(source instanceof Uint8Array) ||
        (Object.getPrototypeOf(source) !== Uint8Array.prototype && Object.getPrototypeOf(source) !== Buffer.prototype) ||
        hasShadowedViewProperties(source)) invalid();
    const backing = getBuffer(source), offset = getOffset(source), size = getLength(source);
    if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || Object.hasOwn(backing, "byteLength") ||
        !Number.isSafeInteger(size) || offset < 0 || offset + size > getArrayBufferLength(backing)) invalid();
    if (size < 1) invalid();
    if (size > LOCAL_RESOURCE_BOUND_BYTES) limit();
    owned = new Uint8Array(size);
    owned.set(new Uint8Array(backing, offset, size));
    const result = validateOwned(owned, fields.filename as string, fields.original_width, fields.original_height);
    owned = undefined;
    return result;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerSeedreamEditorDrawingInputError) throw error;
    return invalid();
  }
}

function readFields(input: unknown, bytesKey: "bytes" | "content_base64"): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) invalid();
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(input); descriptors = Object.getOwnPropertyDescriptors(input); } catch { return invalid(); }
  const keys = Reflect.ownKeys(descriptors), required = [bytesKey, "filename", "mime_type"], allowed = [...required, "original_width", "original_height"];
  if ((prototype !== Object.prototype && prototype !== null) || keys.length < 3 || keys.length > 5 ||
      required.some((key) => !keys.includes(key)) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) fields[key] = descriptors[key]!.value;
  if (typeof fields.filename !== "string" || !isSafeFilename(fields.filename) || fields.mime_type !== "image/png" ||
      (Object.hasOwn(fields, "original_width") !== Object.hasOwn(fields, "original_height")) ||
      (Object.hasOwn(fields, "original_width") && (!isDimension(fields.original_width) || !isDimension(fields.original_height)))) invalid();
  return fields;
}

function validateOwned(bytes: Uint8Array, filename: string, originalWidth: unknown, originalHeight: unknown): ValidatedOwnerSeedreamEditorDrawing {
  let consumerBytes: Uint8Array | undefined;
  try {
    const parsed = inspectBoundedOwnerImageBytesWithMax(bytes, LOCAL_RESOURCE_BOUND_BYTES);
    if (parsed.mime !== "image/png" || !isDimension(parsed.width) || !isDimension(parsed.height) ||
        (originalWidth !== undefined && (originalWidth !== parsed.width || originalHeight !== parsed.height))) invalid();
    consumerBytes = new Uint8Array(bytes.byteLength); consumerBytes.set(bytes);
    const result: ValidatedOwnerSeedreamEditorDrawing = {
      bytes: consumerBytes, filename, mime_type: "image/png", width: parsed.width, height: parsed.height,
      size: consumerBytes.byteLength, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS", pixel_decode_verified: false,
      dispatch_allowed: false, backend_acceptance: "UNPROVEN"
    };
    Object.defineProperty(result, "bytes", { value: consumerBytes, enumerable: false, writable: false, configurable: false });
    consumerBytes = undefined;
    return Object.freeze(result);
  } catch (error) {
    consumerBytes?.fill(0);
    if (error instanceof OwnerSeedreamEditorDrawingInputError) throw error;
    return invalid();
  } finally { bytes.fill(0); }
}

function isDimension(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function hasShadowedViewProperties(value: Uint8Array): boolean {
  return Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length");
}
function getBuffer(value: Uint8Array): ArrayBuffer { return Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer; }
function getOffset(value: Uint8Array): number { return Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number; }
function getLength(value: Uint8Array): number { return Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number; }
function getArrayBufferLength(value: ArrayBuffer): number { return Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, value, []) as number; }
function hasCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  let padding = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x3d) { padding += 1; if (i < value.length - 2 || padding > 2) return false; }
    else if (padding !== 0 || !((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47)) return false;
  }
  return padding !== 2 || (value.at(-1) === "=" && value.at(-2) === "=");
}
function isSafeFilename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || value !== value.trimEnd() || value.endsWith(".") ||
      /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) || FILENAME_DELIMITERS.test(value) || RESERVED_WINDOWS_BASENAME.test(value)) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(i + 1); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; i += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return Buffer.byteLength(value, "utf8") <= MAX_FILENAME_UTF8_BYTES;
}
function invalid(): never { throw new OwnerSeedreamEditorDrawingInputError("INVALID_IMAGE_INPUT"); }
function limit(): never { throw new OwnerSeedreamEditorDrawingInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
