import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { inspectBoundedOwnerWanBmp } from "./owner-wan-bmp-inspector.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MIN_SIDE = 384;
const PINNED_MAX_SIDE = 5_000;
const MAX_SIDE = 8_000;
const MAX_PROMPT_LENGTH = 1_500;
const MAX_FILENAME_UTF8_BYTES = 255;
const MODEL_IDS = Object.freeze(["wan_26_i2v", "wan_26_i2v_flash"] as const);
const MIME_TYPES = Object.freeze(["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"] as const);
const DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const IMAGES = new WeakMap<object, ImageState>();

/** Historical B066 facts pinned as local guards, not current metadata or provider acceptance. */
export const OWNER_WAN26_I2V_IMAGE_POLICY = Object.freeze({
  policy_id: "OWNER_WAN26_I2V_IMAGE_INPUT_POLICY_B066_LOCAL_GUARD_V1",
  public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
  public_catalog_fetched_at: "2026-10-12T17:09:37.867Z",
  model_ids: MODEL_IDS,
  source_mime_types: MIME_TYPES,
  jpg_alias: "image/jpg -> image/jpeg" as const,
  max_file_size_bytes: MAX_BYTES,
  min_side: MIN_SIDE,
  max_side: PINNED_MAX_SIDE,
  current_public_max_side: MAX_SIDE,
  max_prompt_length: MAX_PROMPT_LENGTH,
  limits_policy: "PINNED_B066_CATALOG_LOCAL_GUARD_NOT_CURRENT_METADATA_OR_PROVIDER_ACCEPTANCE" as const,
  metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const,
  generation_permit: false as const,
  owner_upload_binding: "NOT_ESTABLISHED" as const
});

export type OwnerWan26I2vModelId = typeof MODEL_IDS[number];
export type OwnerWan26I2vImageSourceMimeType = typeof MIME_TYPES[number];
export type OwnerWan26I2vImageCanonicalMimeType = Exclude<OwnerWan26I2vImageSourceMimeType, "image/jpg">;

export interface ValidatedOwnerWan26I2vImage {
  readonly status: "LOCAL_SOURCE_VALIDATED";
  readonly model_id: OwnerWan26I2vModelId;
  readonly source_policy_id: typeof OWNER_WAN26_I2V_IMAGE_POLICY.policy_id;
  readonly filename: string;
  readonly source_mime_type: OwnerWan26I2vImageSourceMimeType;
  readonly mime_type: OwnerWan26I2vImageCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED";
  readonly size_limit_confidence: "PINNED_B066_CATALOG_LOCAL_GUARD_NOT_CURRENT_METADATA_OR_PROVIDER_ACCEPTANCE";
  readonly generation_permit: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}

export class OwnerWan26I2vImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The WAN 2.6 I2V image input is invalid or exceeds the local resource guard.");
    this.name = "OwnerWan26I2vImagePolicyError";
  }
}

/** Validates one raw WAN 2.6 I2V image; image cardinality belongs to a future manifest. */
export function validateOwnerWan26I2vImage(input: unknown): Readonly<ValidatedOwnerWan26I2vImage> {
  let owned: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "filename", "mime_type", "bytes"]);
    if (typeof fields.model_id !== "string" || !MODEL_IDS.includes(fields.model_id as OwnerWan26I2vModelId) ||
        typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
        !MIME_TYPES.includes(fields.mime_type as OwnerWan26I2vImageSourceMimeType)) invalid();
    const source = readSourceBytes(fields.bytes);
    if (source.byteLength < 1) invalid();
    if (source.byteLength > MAX_BYTES) localLimit();
    owned = Buffer.allocUnsafe(source.byteLength);
    Uint8Array.prototype.set.call(owned, source);
    const modelId = fields.model_id as OwnerWan26I2vModelId;
    const sourceMime = fields.mime_type as OwnerWan26I2vImageSourceMimeType;
    const mime: OwnerWan26I2vImageCanonicalMimeType = sourceMime === "image/jpg" ? "image/jpeg" : sourceMime;
    const parsed = mime === "image/bmp"
      ? { mime: "image/bmp" as const, ...inspectBoundedOwnerWanBmp(owned) }
      : inspectBoundedOwnerImageBytesWithMax(owned, MAX_BYTES);
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < MIN_SIDE || parsed.height < MIN_SIDE || parsed.width > MAX_SIDE || parsed.height > MAX_SIDE) invalid();
    const filename = canonicalFilename(fields.filename, mime);
    const state: ImageState = { bytes: owned, modelId, filename, sourceMime, mime, width: parsed.width, height: parsed.height,
      size: owned.byteLength, sha256: createHash("sha256").update(owned).digest("hex") };
    const receipt = Object.freeze({ status: "LOCAL_SOURCE_VALIDATED" as const, model_id: modelId,
      source_policy_id: OWNER_WAN26_I2V_IMAGE_POLICY.policy_id, filename, source_mime_type: sourceMime, mime_type: mime,
      width: state.width, height: state.height, size: state.size, sha256: state.sha256,
      metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const,
      size_limit_confidence: "PINNED_B066_CATALOG_LOCAL_GUARD_NOT_CURRENT_METADATA_OR_PROVIDER_ACCEPTANCE" as const,
      generation_permit: false as const, owner_upload_binding: "NOT_ESTABLISHED" as const });
    IMAGES.set(receipt, state);
    owned = undefined;
    return receipt;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerWan26I2vImagePolicyError) throw error;
    return invalid();
  }
}

/** Returns a fresh owned copy only while the genuine private snapshot still matches its digest. */
export function readValidatedOwnerWan26I2vImage(input: unknown): Readonly<{
  bytes: Uint8Array; model_id: OwnerWan26I2vModelId; filename: string; mime_type: OwnerWan26I2vImageCanonicalMimeType;
  width: number; height: number; size: number; sha256: string;
}> | null {
  const state = getLiveState(input);
  return state ? Object.freeze({ bytes: new Uint8Array(state.bytes), model_id: state.modelId, filename: state.filename,
    mime_type: state.mime, width: state.width, height: state.height, size: state.size, sha256: state.sha256 }) : null;
}

/** Wipes and revokes this policy's private snapshot. */
export function releaseValidatedOwnerWan26I2vImage(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = IMAGES.get(input);
  if (!state) return false;
  state.bytes.fill(0);
  return IMAGES.delete(input);
}

export function isValidatedOwnerWan26I2vImage(input: unknown): input is Readonly<ValidatedOwnerWan26I2vImage> {
  return getLiveState(input) !== null;
}

interface ImageState {
  readonly bytes: Buffer; readonly modelId: OwnerWan26I2vModelId; readonly filename: string;
  readonly sourceMime: OwnerWan26I2vImageSourceMimeType; readonly mime: OwnerWan26I2vImageCanonicalMimeType;
  readonly width: number; readonly height: number; readonly size: number; readonly sha256: string;
}

function getLiveState(input: unknown): ImageState | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  const state = IMAGES.get(input);
  return state && state.bytes.byteLength === state.size && createHash("sha256").update(state.bytes).digest("hex") === state.sha256 ? state : null;
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
  return new Uint8Array(backing, Reflect.apply(OFFSET_GETTER, value, []) as number, length);
}

function canonicalFilename(filename: string, mime: OwnerWan26I2vImageCanonicalMimeType): string {
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
function invalid(): never { throw new OwnerWan26I2vImagePolicyError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerWan26I2vImagePolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
