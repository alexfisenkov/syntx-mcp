import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";

const MODEL_IDS = Object.freeze(["grok_imagine_2", "grok_imagine_quality"] as const);
const SOURCE_MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp"] as const);
const MAX_LOCAL_BYTES = 64 * 1024 * 1024;
const SAFE_FILENAME = /^[^/\\\p{Cc}\p{Cf}\p{Cs}]{1,255}$/u;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export type OwnerGrokT2iImageModelId = (typeof MODEL_IDS)[number];
export type OwnerGrokT2iImageSourceMimeType = (typeof SOURCE_MIME_TYPES)[number];
export type OwnerGrokT2iImageCanonicalMimeType = Exclude<OwnerGrokT2iImageSourceMimeType, "image/jpg">;

export const OWNER_GROK_T2I_IMAGE_INPUT_POLICY = Object.freeze({
  model_ids: MODEL_IDS,
  uploadable_models: MODEL_IDS,
  non_uploadable_models: Object.freeze(["grok_t2i", "grok_t2i_pro"] as const),
  accepted_source_mime_types: SOURCE_MIME_TYPES,
  mime_source_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_PROVIDER_ACCEPTANCE" as const,
  public_max_file_size: 0,
  public_size_confidence: "CATALOG_ZERO_NOT_UNLIMITED_OR_PROVIDER_CAP" as const,
  local_max_bytes: MAX_LOCAL_BYTES,
  local_size_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
  dimensions: "POSITIVE_CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const,
  validation_confidence: "CONTAINER_METADATA_ONLY_NOT_PROVIDER_ACCEPTANCE" as const
});

export interface ValidatedOwnerGrokT2iImageUploadData {
  readonly model_id: OwnerGrokT2iImageModelId;
  /** Consumer-owned exact byte copy; wipe at the end of its upload lifecycle. */
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly source_mime_type: OwnerGrokT2iImageSourceMimeType;
  readonly mime_type: OwnerGrokT2iImageCanonicalMimeType;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
  readonly provider_acceptance: "UNPROVEN";
}

export class OwnerGrokT2iImageInputError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The Grok Imagine image input is invalid or exceeds the local resource ceiling.");
    this.name = "OwnerGrokT2iImageInputError";
  }
}

/** Validates a source-uploadable Imagine image and returns a private, structurally inspected copy. */
export function validateOwnerGrokT2iImageUploadData(input: unknown): ValidatedOwnerGrokT2iImageUploadData {
  let ownedBytes: Uint8Array | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "bytes", "filename", "mime_type"]);
    const modelId = readModelId(fields.model_id);
    const sourceMime = readMime(fields.mime_type);
    if (typeof fields.filename !== "string" || !isSafeFilename(fields.filename)) invalid();

    const sourceBytes = readSourceBytes(fields.bytes);
    if (sourceBytes.byteLength > MAX_LOCAL_BYTES) localLimit();
    ownedBytes = sourceBytes.slice();

    const canonicalMime: OwnerGrokT2iImageCanonicalMimeType = sourceMime === "image/jpg" ? "image/jpeg" : sourceMime;
    const image = inspectBoundedOwnerImageBytesWithMax(ownedBytes, MAX_LOCAL_BYTES);
    if (image.mime !== canonicalMime || !Number.isSafeInteger(image.width) || image.width < 1 ||
        !Number.isSafeInteger(image.height) || image.height < 1) invalid();

    const result: ValidatedOwnerGrokT2iImageUploadData = Object.freeze({
      model_id: modelId,
      bytes: ownedBytes,
      filename: fields.filename,
      source_mime_type: sourceMime,
      mime_type: canonicalMime,
      size: ownedBytes.byteLength,
      width: image.width,
      height: image.height,
      sha256: `sha256:${createHash("sha256").update(ownedBytes).digest("hex")}`,
      metadata_confidence: "CONTAINER_METADATA_ONLY",
      size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT",
      provider_acceptance: "UNPROVEN"
    });
    ownedBytes = undefined;
    return result;
  } catch (error) {
    ownedBytes?.fill(0);
    if (error instanceof OwnerGrokT2iImageInputError) throw error;
    invalid();
  }
}

function exactRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key) || !("value" in descriptors[key]!) ||
        descriptors[key]!.enumerable !== true)) return invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function readModelId(value: unknown): OwnerGrokT2iImageModelId {
  if (typeof value !== "string" || !(MODEL_IDS as readonly string[]).includes(value)) return invalid();
  return value as OwnerGrokT2iImageModelId;
}

function readMime(value: unknown): OwnerGrokT2iImageSourceMimeType {
  if (typeof value !== "string" || !(SOURCE_MIME_TYPES as readonly string[]).includes(value)) return invalid();
  return value as OwnerGrokT2iImageSourceMimeType;
}

function isSafeFilename(value: string): boolean {
  return value !== "." && value !== ".." && value === value.trimEnd() && SAFE_FILENAME.test(value) &&
    Buffer.byteLength(value, "utf8") <= 255;
}

function readSourceBytes(value: unknown): Uint8Array {
  if (types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "byteOffset") ||
      Object.hasOwn(value, "length")) return invalid();
  const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer;
  const offset = Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number;
  const byteLength = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number;
  if (types.isProxy(buffer) || Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || Object.hasOwn(buffer, "byteLength") ||
      !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(byteLength) || byteLength < 1 ||
      offset + byteLength > Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, buffer, [])) return invalid();
  if (byteLength > MAX_LOCAL_BYTES) localLimit();
  return new Uint8Array(buffer, offset, byteLength);
}

function invalid(): never { throw new OwnerGrokT2iImageInputError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerGrokT2iImageInputError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
