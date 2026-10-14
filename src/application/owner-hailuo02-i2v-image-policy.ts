import { createHash } from "node:crypto";
import { types } from "node:util";
import { OWNER_HAILUO02_I2V_MODEL, OWNER_HAILUO02_I2V_SOURCE_PROFILE } from "./owner-hailuo02-i2v-source-profile.js";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";

const MAX_LOCAL_BYTES = 10 * 1024 * 1024;
const MAX_FILENAME_UTF8_BYTES = 255;
const SOURCE_MIME_TYPES = OWNER_HAILUO02_I2V_SOURCE_PROFILE.controls.image_reference.accepted_file_types;
const FILENAME_DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED_WINDOWS_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const VALIDATED_IMAGES = new WeakMap<object, ValidatedState>();
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export const OWNER_HAILUO02_I2V_IMAGE_INPUT_POLICY = Object.freeze({
  model_id: OWNER_HAILUO02_I2V_MODEL.model_id,
  upload_source: OWNER_HAILUO02_I2V_SOURCE_PROFILE.upload_source,
  source_mime_types: SOURCE_MIME_TYPES,
  source_max_bytes: "UNKNOWN" as const,
  local_max_bytes: MAX_LOCAL_BYTES,
  local_max_bytes_policy: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
  filename_utf8_max_bytes: MAX_FILENAME_UTF8_BYTES,
  filename_policy: "SAFE_UNICODE_BASENAME_WITH_CANONICAL_EXTENSION" as const,
  metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
  provider_acceptance: "UNPROVEN" as const
});

export type OwnerHailuo02I2vSourceMimeType = typeof SOURCE_MIME_TYPES[number];
export type OwnerHailuo02I2vCanonicalMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface ValidatedOwnerHailuo02I2vImageUpload {
  readonly status: "LOCAL_SOURCE_VALIDATED";
  readonly model_id: "hailuo-02";
  readonly upload_source: typeof OWNER_HAILUO02_I2V_SOURCE_PROFILE.upload_source;
  readonly filename: string;
  readonly source_mime_type: OwnerHailuo02I2vSourceMimeType;
  readonly mime_type: OwnerHailuo02I2vCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  /** Lowercase SHA-256 hex of the exact admitted bytes. */
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
  readonly provider_acceptance: "UNPROVEN";
}

export class OwnerHailuo02I2vImageUploadError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The Hailuo-02 I2V image input is invalid or exceeds the local resource ceiling.");
    this.name = "OwnerHailuo02I2vImageUploadError";
  }
}

/** Validates source bytes for one Hailuo-02 image reference; it does not upload or grant dispatch authority. */
export function validateOwnerHailuo02I2vImageUpload(input: unknown): ValidatedOwnerHailuo02I2vImageUpload {
  let ownedBytes: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["filename", "mime_type", "bytes"]);
    if (typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
        !SOURCE_MIME_TYPES.includes(fields.mime_type as OwnerHailuo02I2vSourceMimeType)) invalid();

    const source = readSourceBytes(fields.bytes);
    if (source.byteLength > MAX_LOCAL_BYTES) localLimit();
    ownedBytes = new Uint8Array(source.byteLength);
    Uint8Array.prototype.set.call(ownedBytes, source);

    const sourceMime = fields.mime_type as OwnerHailuo02I2vSourceMimeType;
    const mime: OwnerHailuo02I2vCanonicalMimeType = sourceMime === "image/jpg" ? "image/jpeg" : sourceMime;
    const parsed = inspectBoundedOwnerImageBytesWithMax(ownedBytes, MAX_LOCAL_BYTES);
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || parsed.width <= 0 ||
        !Number.isSafeInteger(parsed.height) || parsed.height <= 0) invalid();

    const filename = canonicalFilename(fields.filename, mime);
    const state: ValidatedState = {
      bytes: ownedBytes,
      filename,
      sourceMime,
      mime,
      width: parsed.width,
      height: parsed.height,
      size: ownedBytes.byteLength,
      sha256: createHash("sha256").update(ownedBytes).digest("hex")
    };
    const receipt = Object.freeze({
      status: "LOCAL_SOURCE_VALIDATED" as const,
      model_id: OWNER_HAILUO02_I2V_MODEL.model_id,
      upload_source: OWNER_HAILUO02_I2V_SOURCE_PROFILE.upload_source,
      filename: state.filename,
      source_mime_type: state.sourceMime,
      mime_type: state.mime,
      width: state.width,
      height: state.height,
      size: state.size,
      sha256: state.sha256,
      metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
      size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
      provider_acceptance: "UNPROVEN" as const
    });
    VALIDATED_IMAGES.set(receipt, state);
    ownedBytes = undefined;
    return receipt;
  } catch (error) {
    ownedBytes?.fill(0);
    if (error instanceof OwnerHailuo02I2vImageUploadError) throw error;
    return invalid();
  }
}

/** Reads a fresh consumer-owned byte copy only from a genuine receipt minted above. */
export function readValidatedOwnerHailuo02I2vImageUpload(input: unknown): Readonly<{
  bytes: Uint8Array;
  filename: string;
  mime_type: OwnerHailuo02I2vCanonicalMimeType;
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

/** Wipes and revokes a genuine receipt's private snapshot; repeated or forged releases return false. */
export function releaseValidatedOwnerHailuo02I2vImageUpload(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = VALIDATED_IMAGES.get(input);
  if (!state) return false;
  state.bytes.fill(0);
  return VALIDATED_IMAGES.delete(input);
}

interface ValidatedState {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly sourceMime: OwnerHailuo02I2vSourceMimeType;
  readonly mime: OwnerHailuo02I2vCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) =>
    typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true
  )) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function readSourceBytes(value: unknown): Uint8Array {
  if (types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length")) invalid();
  const backing = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer;
  const offset = Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number;
  const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number;
  const backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []) as number;
  if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || Object.hasOwn(backing, "byteLength") ||
      !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || offset + length > backingLength) invalid();
  if (length > MAX_LOCAL_BYTES) localLimit();
  return new Uint8Array(backing, offset, length);
}

function canonicalFilename(filename: string, mime: OwnerHailuo02I2vCanonicalMimeType): string {
  if (!isSafeBasename(filename)) invalid();
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" : ".webp";
  const canonical = `${stem}${extension}`;
  if (!isSafeBasename(canonical)) invalid();
  return canonical;
}

function isSafeBasename(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && value === value.trimEnd() && !value.endsWith(".") &&
    !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !FILENAME_DELIMITERS.test(value) &&
    !RESERVED_WINDOWS_BASENAME.test(value) && isWellFormedUnicode(value) &&
    Buffer.byteLength(value, "utf8") <= MAX_FILENAME_UTF8_BYTES;
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

function invalid(): never { throw new OwnerHailuo02I2vImageUploadError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerHailuo02I2vImageUploadError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
