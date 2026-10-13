import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_FILE_SIZE_BYTES / 3) * 4;
const ACCEPTED_MIME_TYPES = Object.freeze(["image/jpeg", "image/png"] as const);
const MAX_FILENAME_UTF8_BYTES = 255;
const FILENAME_DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const SOURCE_POLICY = Object.freeze({
  form_id: "banana-inpaint",
  ai_name: "banana_inpaint",
  module: "useImageEditorTool.js",
  source_bytes: 12_652,
  source_sha256: "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe",
  accepted_mime_types: ACCEPTED_MIME_TYPES,
  max_file_size_bytes: MAX_FILE_SIZE_BYTES,
  max_files: 1,
  size_policy: "SOURCE_UI_FILE_INPUT_LIMIT_NOT_PROVIDER_LIMIT_OR_DISPATCH_GRANT",
  metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
  runtime_usable: false as const
});

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export const OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY = SOURCE_POLICY;
export type OwnerBananaInpaintOriginalMimeType = typeof ACCEPTED_MIME_TYPES[number];

export interface ValidatedOwnerBananaInpaintOriginal {
  /** Consumer-owned exact-sized snapshot; this does not grant upload or generation authority. */
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly original_mime_type: OwnerBananaInpaintOriginalMimeType;
  readonly mime_type: OwnerBananaInpaintOriginalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly pixel_decode_verified: false;
  readonly confidence_scope: "BANANA_INPAINT_ORIGINAL_UI_FILE_INPUT_ONLY";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerBananaInpaintOriginalInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The Banana Inpaint original image input is invalid or exceeds the local UI-derived byte ceiling.");
    this.name = "OwnerBananaInpaintOriginalInputError";
  }
}

/** Validates one explicit base64 original image against Banana Inpaint's source UI file-input policy only. */
export function validateOwnerBananaInpaintOriginalInput(input: unknown): ValidatedOwnerBananaInpaintOriginal {
  let decoded: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["content_base64", "filename", "mime_type"]);
    if (typeof fields.content_base64 !== "string" || fields.content_base64.length === 0 ||
        typeof fields.filename !== "string" || !isSafePortableBasename(fields.filename) ||
        typeof fields.mime_type !== "string" || !isAcceptedMime(fields.mime_type)) invalid();
    if (fields.content_base64.length > MAX_BASE64_CHARS) localLimit();
    // Scan alphabet/padding linearly; the decoded round trip below also verifies unused padding bits.
    if (!hasCanonicalBase64AlphabetAndPadding(fields.content_base64)) invalid();
    decoded = Buffer.from(fields.content_base64, "base64");
    if (decoded.byteLength > MAX_FILE_SIZE_BYTES) localLimit();
    if (decoded.byteLength < 1 || decoded.toString("base64") !== fields.content_base64) invalid();
    const result = validateOwnedBytes(decoded, fields.filename, fields.mime_type);
    decoded.fill(0);
    decoded = undefined;
    return result;
  } catch (error) {
    decoded?.fill(0);
    if (error instanceof OwnerBananaInpaintOriginalInputError) throw error;
    return invalid();
  }
}

/** Validates raw bytes and snapshots only the caller's supplied view into an exact-sized owned copy. */
export function validateOwnerBananaInpaintOriginalUploadData(input: unknown): ValidatedOwnerBananaInpaintOriginal {
  let privateBytes: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["bytes", "filename", "mime_type"]);
    if (!(fields.bytes instanceof Uint8Array) || types.isProxy(fields.bytes) ||
        (Object.getPrototypeOf(fields.bytes) !== Uint8Array.prototype && Object.getPrototypeOf(fields.bytes) !== Buffer.prototype) ||
        hasShadowedViewProperties(fields.bytes) || typeof fields.filename !== "string" || !isSafePortableBasename(fields.filename) ||
        typeof fields.mime_type !== "string" || !isAcceptedMime(fields.mime_type)) invalid();
    const source = fields.bytes;
    const backing = getBuffer(source);
    const offset = getOffset(source);
    const size = getLength(source);
    if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype ||
        Object.hasOwn(backing, "byteLength") || !Number.isSafeInteger(size) || offset < 0 ||
        offset + size > getArrayBufferLength(backing)) invalid();
    if (size < 1) invalid();
    if (size > MAX_FILE_SIZE_BYTES) localLimit();
    privateBytes = new Uint8Array(size);
    privateBytes.set(new Uint8Array(backing, offset, size));
    const result = validateOwnedBytes(privateBytes, fields.filename, fields.mime_type);
    privateBytes.fill(0);
    privateBytes = undefined;
    return result;
  } catch (error) {
    privateBytes?.fill(0);
    if (error instanceof OwnerBananaInpaintOriginalInputError) throw error;
    return invalid();
  }
}

function validateOwnedBytes(bytes: Uint8Array, filename: string, originalMime: string): ValidatedOwnerBananaInpaintOriginal {
  let consumerBytes: Uint8Array | undefined;
  try {
    const inspected = inspectBoundedOwnerImageBytesWithMax(bytes, MAX_FILE_SIZE_BYTES);
    if (inspected.mime !== originalMime || !Number.isSafeInteger(inspected.width) || inspected.width < 1 ||
        !Number.isSafeInteger(inspected.height) || inspected.height < 1) invalid();
    const digest = createHash("sha256").update(bytes).digest("hex");
    consumerBytes = new Uint8Array(bytes.byteLength);
    consumerBytes.set(bytes);
    const result: ValidatedOwnerBananaInpaintOriginal = {
      bytes: consumerBytes,
      filename,
      original_mime_type: originalMime as OwnerBananaInpaintOriginalMimeType,
      mime_type: inspected.mime as OwnerBananaInpaintOriginalMimeType,
      width: inspected.width,
      height: inspected.height,
      size: consumerBytes.byteLength,
      sha256: `sha256:${digest}`,
      metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
      pixel_decode_verified: false,
      confidence_scope: "BANANA_INPAINT_ORIGINAL_UI_FILE_INPUT_ONLY",
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    };
    Object.defineProperty(result, "bytes", { value: consumerBytes, enumerable: false, writable: false, configurable: false });
    consumerBytes = undefined;
    return Object.freeze(result);
  } catch (error) {
    consumerBytes?.fill(0);
    if (error instanceof OwnerBananaInpaintOriginalInputError) throw error;
    return invalid();
  } finally {
    bytes.fill(0);
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) ||
        descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isAcceptedMime(value: string): value is OwnerBananaInpaintOriginalMimeType {
  return ACCEPTED_MIME_TYPES.includes(value as OwnerBananaInpaintOriginalMimeType);
}
function hasShadowedViewProperties(value: Uint8Array): boolean {
  return Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length");
}
function getBuffer(value: Uint8Array): ArrayBuffer { return Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer; }
function getOffset(value: Uint8Array): number { return Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number; }
function getLength(value: Uint8Array): number { return Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number; }
function getArrayBufferLength(value: ArrayBuffer): number { return Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, value, []) as number; }
function hasCanonicalBase64AlphabetAndPadding(value: string): boolean {
  const length = value.length;
  if (length === 0 || length % 4 !== 0) return false;
  let padding = 0;
  for (let index = 0; index < length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x3d) {
      padding += 1;
      if (index < length - 2 || padding > 2) return false;
      continue;
    }
    if (padding !== 0 || !((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) ||
        (code >= 0x30 && code <= 0x39) || code === 0x2b || code === 0x2f)) return false;
  }
  return padding !== 2 || (value.charCodeAt(length - 1) === 0x3d && value.charCodeAt(length - 2) === 0x3d);
}
function isSafePortableBasename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || value !== value.trimEnd() || value.endsWith(".") ||
      /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) || FILENAME_DELIMITERS.test(value) || RESERVED_WINDOWS_BASENAME.test(value) ||
      !isWellFormedUnicode(value)) return false;
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
function localLimit(): never { throw new OwnerBananaInpaintOriginalInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
function invalid(): never { throw new OwnerBananaInpaintOriginalInputError("INVALID_IMAGE_INPUT"); }
