import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";

const LOCAL_RESOURCE_BOUND_BYTES = 50 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(LOCAL_RESOURCE_BOUND_BYTES / 3) * 4;
const MAX_FILENAME_UTF8_BYTES = 255;
const MAX_DIMENSION = 32_768;
const MAX_PIXELS = 100_000_000;
const POLICY = Object.freeze({
  accepted_mime_type: "image/png" as const,
  local_resource_bound_bytes: LOCAL_RESOURCE_BOUND_BYTES,
  size_policy: "LOCAL_RESOURCE_BOUND_ONLY" as const,
  max_dimension: MAX_DIMENSION,
  max_pixels: MAX_PIXELS,
  metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
  pixel_decode_verified: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const FILENAME_DELIMITERS = /[<>:"/\\|?*]/u;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export const OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_INPUT_POLICY = POLICY;

export interface ValidatedOwnerBananaInpaintPaintedComposite {
  /** Consumer-owned exact-sized snapshot. The consumer must wipe it after use. */
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: "image/png";
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly pixel_decode_verified: false;
  readonly confidence_scope: "BANANA_INPAINT_PAINTED_COMPOSITE_LOCAL_INPUT_ONLY";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerBananaInpaintPaintedCompositeInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The Banana Inpaint painted-composite input is invalid or exceeds the local resource bound.");
    this.name = "OwnerBananaInpaintPaintedCompositeInputError";
  }
}

/** Validates a strict base64 PNG composite and optional container-metadata geometry constraint. */
export function validateOwnerBananaInpaintPaintedCompositeInput(input: unknown): ValidatedOwnerBananaInpaintPaintedComposite {
  let decoded: Buffer | undefined;
  try {
    const fields = readInputFields(input, "content_base64");
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0) invalid();
    if (fields.content_base64.length > MAX_BASE64_CHARS) localLimit();
    if (!hasCanonicalBase64AlphabetAndPadding(fields.content_base64)) invalid();
    decoded = Buffer.from(fields.content_base64, "base64");
    if (decoded.byteLength > LOCAL_RESOURCE_BOUND_BYTES) localLimit();
    if (decoded.byteLength < 1 || decoded.toString("base64") !== fields.content_base64) invalid();
    const validated = validateOwnedBytes(decoded, fields.filename as string, fields.mime_type as string, fields.original_width, fields.original_height);
    decoded.fill(0);
    decoded = undefined;
    return validated;
  } catch (error) {
    decoded?.fill(0);
    if (error instanceof OwnerBananaInpaintPaintedCompositeInputError) throw error;
    return invalid();
  }
}

/** Validates raw bytes and snapshots the caller's exact view; the returned snapshot belongs to the caller. */
export function validateOwnerBananaInpaintPaintedCompositeUploadData(input: unknown): ValidatedOwnerBananaInpaintPaintedComposite {
  let privateBytes: Uint8Array | undefined;
  try {
    const fields = readInputFields(input, "bytes");
    if (!(fields.bytes instanceof Uint8Array) || types.isProxy(fields.bytes) ||
        (Object.getPrototypeOf(fields.bytes) !== Uint8Array.prototype && Object.getPrototypeOf(fields.bytes) !== Buffer.prototype) ||
        hasShadowedViewProperties(fields.bytes)) invalid();
    const source = fields.bytes;
    const backing = getBuffer(source);
    const offset = getOffset(source);
    const size = getLength(source);
    if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype ||
        Object.hasOwn(backing, "byteLength") || !Number.isSafeInteger(size) || offset < 0 ||
        offset + size > getArrayBufferLength(backing)) invalid();
    if (size < 1) invalid();
    if (size > LOCAL_RESOURCE_BOUND_BYTES) localLimit();
    privateBytes = new Uint8Array(size);
    privateBytes.set(new Uint8Array(backing, offset, size));
    const validated = validateOwnedBytes(privateBytes, fields.filename as string, fields.mime_type as string, fields.original_width, fields.original_height);
    privateBytes = undefined;
    return validated;
  } catch (error) {
    privateBytes?.fill(0);
    if (error instanceof OwnerBananaInpaintPaintedCompositeInputError) throw error;
    return invalid();
  }
}

function readInputFields(input: unknown, byteKey: "bytes" | "content_base64"): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) invalid();
  const prototype = Object.getPrototypeOf(input);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const actual = Reflect.ownKeys(descriptors);
  const required = [byteKey, "filename", "mime_type"];
  const allowed = [...required, "original_width", "original_height"];
  if ((prototype !== Object.prototype && prototype !== null) || actual.length < required.length || actual.length > allowed.length ||
      required.some((key) => !actual.includes(key)) || actual.some((key) => typeof key !== "string" || !allowed.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) fields[key] = descriptors[key]!.value;
  if (typeof fields.filename !== "string" || !isSafePortableBasename(fields.filename) ||
      fields.mime_type !== "image/png" ||
      (Object.hasOwn(fields, "original_width") !== Object.hasOwn(fields, "original_height")) ||
      (Object.hasOwn(fields, "original_width") && (!isPositiveBoundedDimension(fields.original_width) || !isPositiveBoundedDimension(fields.original_height)))) invalid();
  return fields;
}

function validateOwnedBytes(bytes: Uint8Array, filename: string, mimeType: string, originalWidth: unknown, originalHeight: unknown): ValidatedOwnerBananaInpaintPaintedComposite {
  let consumerBytes: Uint8Array | undefined;
  try {
    if (mimeType !== "image/png") invalid();
    const inspected = inspectBoundedOwnerImageBytesWithMax(bytes, LOCAL_RESOURCE_BOUND_BYTES);
    if (inspected.mime !== "image/png" || !isPositiveBoundedDimension(inspected.width) || !isPositiveBoundedDimension(inspected.height) ||
        inspected.width * inspected.height > MAX_PIXELS ||
        (originalWidth !== undefined && (originalWidth !== inspected.width || originalHeight !== inspected.height))) invalid();
    const digest = createHash("sha256").update(bytes).digest("hex");
    consumerBytes = new Uint8Array(bytes.byteLength);
    consumerBytes.set(bytes);
    const result: ValidatedOwnerBananaInpaintPaintedComposite = {
      bytes: consumerBytes,
      filename,
      mime_type: "image/png",
      width: inspected.width,
      height: inspected.height,
      size: consumerBytes.byteLength,
      sha256: `sha256:${digest}`,
      metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
      pixel_decode_verified: false,
      confidence_scope: "BANANA_INPAINT_PAINTED_COMPOSITE_LOCAL_INPUT_ONLY",
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    };
    Object.defineProperty(result, "bytes", { value: consumerBytes, enumerable: false, writable: false, configurable: false });
    consumerBytes = undefined;
    return Object.freeze(result);
  } catch (error) {
    consumerBytes?.fill(0);
    if (error instanceof OwnerBananaInpaintPaintedCompositeInputError) throw error;
    return invalid();
  } finally {
    bytes.fill(0);
  }
}

function isPositiveBoundedDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAX_DIMENSION;
}
function hasShadowedViewProperties(value: Uint8Array): boolean {
  return Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length");
}
function getBuffer(value: Uint8Array): ArrayBuffer { return Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer; }
function getOffset(value: Uint8Array): number { return Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number; }
function getLength(value: Uint8Array): number { return Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number; }
function getArrayBufferLength(value: ArrayBuffer): number { return Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, value, []) as number; }
function hasCanonicalBase64AlphabetAndPadding(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  let padding = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x3d) {
      padding += 1;
      if (index < value.length - 2 || padding > 2) return false;
    } else if (padding !== 0 || !((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) ||
        (code >= 0x30 && code <= 0x39) || code === 0x2b || code === 0x2f)) return false;
  }
  return padding !== 2 || (value.charCodeAt(value.length - 1) === 0x3d && value.charCodeAt(value.length - 2) === 0x3d);
}
function isSafePortableBasename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || value !== value.trimEnd() || value.endsWith(".") ||
      /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) || FILENAME_DELIMITERS.test(value) || RESERVED_WINDOWS_BASENAME.test(value) || !isWellFormedUnicode(value)) return false;
  return Buffer.byteLength(value, "utf8") <= MAX_FILENAME_UTF8_BYTES;
}
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function invalid(): never { throw new OwnerBananaInpaintPaintedCompositeInputError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerBananaInpaintPaintedCompositeInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
