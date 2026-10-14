import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { inspectBoundedOwnerWanBmp } from "./owner-wan-bmp-inspector.js";

const MAX_BYTES = 20 * 1024 * 1024;
const MIN_SIDE = 240;
const MAX_SIDE = 8_000;
const MAX_FILENAME_UTF8_BYTES = 255;
const MIME_TYPES = Object.freeze(["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"] as const);
const DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const IMAGES = new WeakMap<object, ImageState>();

export const OWNER_WAN27_R2V_IMAGE_POLICY = Object.freeze({
  policy_id: "OWNER_WAN27_R2V_IMAGE_INPUT_POLICY_B066_LOCAL_GUARD_V1",
  public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
  model_id: "wan_27_r2v",
  source_mime_types: MIME_TYPES,
  jpg_alias: "image/jpg -> image/jpeg" as const,
  max_file_size_bytes: MAX_BYTES,
  min_side: MIN_SIDE,
  max_side: MAX_SIDE,
  limits_policy: "CATALOG_METADATA_PLUS_LOCAL_RESOURCE_GUARD_NOT_PROVIDER_ACCEPTANCE" as const,
  metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const,
  generation_permit: false as const,
  owner_upload_binding: "NOT_ESTABLISHED" as const
});

export type OwnerWan27R2vImageSourceMimeType = typeof MIME_TYPES[number];
export type OwnerWan27R2vImageCanonicalMimeType = Exclude<OwnerWan27R2vImageSourceMimeType, "image/jpg">;

export interface ValidatedOwnerWan27R2vImage {
  readonly status: "LOCAL_SOURCE_VALIDATED";
  readonly model_id: "wan_27_r2v";
  readonly source_policy_id: typeof OWNER_WAN27_R2V_IMAGE_POLICY.policy_id;
  readonly filename: string;
  readonly source_mime_type: OwnerWan27R2vImageSourceMimeType;
  readonly mime_type: OwnerWan27R2vImageCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED";
  readonly size_limit_confidence: "CATALOG_METADATA_PLUS_LOCAL_RESOURCE_GUARD_NOT_PROVIDER_ACCEPTANCE";
  readonly generation_permit: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}

export class OwnerWan27R2vImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The WAN 2.7 R2V image input is invalid or exceeds the local resource guard.");
    this.name = "OwnerWan27R2vImagePolicyError";
  }
}

/** Validates one raw WAN 2.7 R2V image reference; count/cardinality belongs to a future manifest. */
export function validateOwnerWan27R2vImage(input: unknown): Readonly<ValidatedOwnerWan27R2vImage> {
  let owned: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["filename", "mime_type", "bytes"]);
    if (typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
        !MIME_TYPES.includes(fields.mime_type as OwnerWan27R2vImageSourceMimeType)) invalid();
    const source = readSourceBytes(fields.bytes);
    if (source.byteLength < 1) invalid();
    if (source.byteLength > MAX_BYTES) localLimit();
    owned = Buffer.allocUnsafe(source.byteLength);
    Uint8Array.prototype.set.call(owned, source);
    const sourceMime = fields.mime_type as OwnerWan27R2vImageSourceMimeType;
    const mime: OwnerWan27R2vImageCanonicalMimeType = sourceMime === "image/jpg" ? "image/jpeg" : sourceMime;
    const parsed = mime === "image/bmp"
      ? { mime: "image/bmp" as const, ...inspectBoundedOwnerWanBmp(owned) }
      : inspectBoundedOwnerImageBytesWithMax(owned, MAX_BYTES);
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < MIN_SIDE || parsed.height < MIN_SIDE || parsed.width > MAX_SIDE || parsed.height > MAX_SIDE) invalid();
    const filename = canonicalFilename(fields.filename, mime);
    const state: ImageState = { bytes: owned, filename, sourceMime, mime, width: parsed.width, height: parsed.height,
      size: owned.byteLength, sha256: createHash("sha256").update(owned).digest("hex") };
    const receipt = Object.freeze({ status: "LOCAL_SOURCE_VALIDATED" as const, model_id: "wan_27_r2v" as const,
      source_policy_id: OWNER_WAN27_R2V_IMAGE_POLICY.policy_id, filename, source_mime_type: sourceMime, mime_type: mime,
      width: state.width, height: state.height, size: state.size, sha256: state.sha256,
      metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const,
      size_limit_confidence: "CATALOG_METADATA_PLUS_LOCAL_RESOURCE_GUARD_NOT_PROVIDER_ACCEPTANCE" as const,
      generation_permit: false as const, owner_upload_binding: "NOT_ESTABLISHED" as const });
    IMAGES.set(receipt, state);
    owned = undefined;
    return receipt;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerWan27R2vImagePolicyError) throw error;
    return invalid();
  }
}

/** Rehashes the private snapshot and returns a new caller-owned byte copy for a future upload seam. */
export function readValidatedOwnerWan27R2vImage(input: unknown): Readonly<{
  bytes: Uint8Array; filename: string; mime_type: OwnerWan27R2vImageCanonicalMimeType;
  width: number; height: number; size: number; sha256: string;
}> | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  const state = IMAGES.get(input);
  if (!state || state.bytes.byteLength !== state.size || createHash("sha256").update(state.bytes).digest("hex") !== state.sha256) return null;
  return Object.freeze({ bytes: new Uint8Array(state.bytes), filename: state.filename, mime_type: state.mime,
    width: state.width, height: state.height, size: state.size, sha256: state.sha256 });
}

/** Wipes and revokes private source bytes; repeated and forged releases return false. */
export function releaseValidatedOwnerWan27R2vImage(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = IMAGES.get(input);
  if (!state) return false;
  state.bytes.fill(0);
  return IMAGES.delete(input);
}

interface ImageState {
  readonly bytes: Buffer; readonly filename: string; readonly sourceMime: OwnerWan27R2vImageSourceMimeType;
  readonly mime: OwnerWan27R2vImageCanonicalMimeType; readonly width: number; readonly height: number;
  readonly size: number; readonly sha256: string;
}

function readSourceBytes(value: unknown): Uint8Array {
  if (types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length")) invalid();
  const length = Reflect.apply(BYTE_LENGTH_GETTER, value, []) as number;
  const backing = Reflect.apply(BUFFER_GETTER, value, []) as ArrayBuffer;
  if (!Number.isSafeInteger(length) || types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype ||
      Object.hasOwn(backing, "byteLength") || Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []) < length) invalid();
  if (length > MAX_BYTES) localLimit();
  return new Uint8Array(backing, Reflect.apply(Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!, value, []) as number, length);
}

function canonicalFilename(filename: string, mime: OwnerWan27R2vImageCanonicalMimeType): string {
  if (!safeBasename(filename)) invalid();
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" : mime === "image/bmp" ? ".bmp" : ".webp";
  const canonical = `${stem}${extension}`;
  if (!safeBasename(canonical)) invalid();
  return canonical;
}

function safeBasename(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && value === value.trimEnd() && !value.endsWith(".") &&
    !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !DELIMITERS.test(value) && !RESERVED.test(value) && isWellFormedUnicode(value) &&
    Buffer.byteLength(value, "utf8") <= MAX_FILENAME_UTF8_BYTES;
}
function isWellFormedUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(i + 1); if (next < 0xdc00 || next > 0xdfff) return false; i += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) =>
    typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function invalid(): never { throw new OwnerWan27R2vImagePolicyError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerWan27R2vImagePolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
