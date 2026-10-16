import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import {
  inspectBoundedOwnerClarityAvifBytesWithMax,
  UnsupportedOwnerClarityAvifCompositionError
} from "./owner-clarity-upscale-input-validator.js";

const MAX_BYTES = 30 * 1024 * 1024;
const MIN_DIMENSION = 300;
const MAX_DIMENSION = 10_000;
const MIN_ASPECT_RATIO = 0.4;
const MAX_ASPECT_RATIO = 2.5;
const MAX_FILENAME_UTF8_BYTES = 255;
const MODEL_IDS = Object.freeze(["kling_4_keyframes", "kling_4_omni"] as const);
const MIME_TYPES = Object.freeze(["image/jpg", "image/jpeg", "image/png", "image/avif"] as const);
const DELIMITERS = /[<>:"/\\|?*]/u;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const IMAGES = new WeakMap<object, ImageState>();

export type OwnerKling4ModelId = typeof MODEL_IDS[number];
export type OwnerKling4ImageSourceMimeType = typeof MIME_TYPES[number];
export type OwnerKling4ImageCanonicalMimeType = Exclude<OwnerKling4ImageSourceMimeType, "image/jpg">;

export const OWNER_KLING4_IMAGE_POLICY = Object.freeze({
  policy_id: "OWNER_KLING4_IMAGE_INPUT_POLICY_C19_LOCAL_GUARD_V1",
  public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json",
  model_ids: MODEL_IDS,
  source_mime_types: MIME_TYPES,
  jpg_alias: "image/jpg -> image/jpeg" as const,
  max_file_size_bytes: MAX_BYTES,
  min_dimension: MIN_DIMENSION,
  max_dimension: MAX_DIMENSION,
  aspect_ratio: Object.freeze({ min: MIN_ASPECT_RATIO, max: MAX_ASPECT_RATIO }),
  limits_confidence: "C19_METADATA_PLUS_LOCAL_RESOURCE_GUARD_NOT_PROVIDER_ACCEPTANCE" as const,
  metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" as const,
  avif_supported_subset: "CONSERVATIVE_PRIMARY_ITEM_STRUCTURE_ONLY" as const,
  generation_permit: false as const,
  reference_role_binding: "NOT_ESTABLISHED" as const,
  owner_upload_binding: "NOT_ESTABLISHED" as const
});

export interface ValidatedOwnerKling4Image {
  readonly status: "LOCAL_SOURCE_VALIDATED";
  readonly model_id: OwnerKling4ModelId;
  readonly source_policy_id: typeof OWNER_KLING4_IMAGE_POLICY.policy_id;
  readonly filename: string;
  readonly source_mime_type: OwnerKling4ImageSourceMimeType;
  readonly mime_type: OwnerKling4ImageCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly limits_confidence: typeof OWNER_KLING4_IMAGE_POLICY.limits_confidence;
  readonly metadata_confidence: typeof OWNER_KLING4_IMAGE_POLICY.metadata_confidence;
  readonly avif_confidence: typeof OWNER_KLING4_IMAGE_POLICY.avif_supported_subset | "NOT_APPLICABLE";
  readonly generation_permit: false;
  readonly reference_role_binding: "NOT_ESTABLISHED";
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}

export class OwnerKling4ImagePolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_AVIF_COMPOSITION") {
    super("The Kling 4 image input is invalid or exceeds the local resource guard.");
    this.name = "OwnerKling4ImagePolicyError";
  }
}

interface ImageState {
  readonly bytes: Buffer;
  readonly modelId: OwnerKling4ModelId;
  readonly filename: string;
  readonly sourceMime: OwnerKling4ImageSourceMimeType;
  readonly mime: OwnerKling4ImageCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
}

/** Validates owned source bytes locally; it grants no upload, role, or generation authority. */
export function validateOwnerKling4Image(input: unknown): Readonly<ValidatedOwnerKling4Image> {
  let owned: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "filename", "mime_type", "bytes"]);
    if (!isModelId(fields.model_id) || typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
        !MIME_TYPES.includes(fields.mime_type as OwnerKling4ImageSourceMimeType)) invalid();
    const source = readSourceBytes(fields.bytes);
    if (source.byteLength < 1) invalid();
    if (source.byteLength > MAX_BYTES) localLimit();

    owned = Buffer.allocUnsafe(source.byteLength);
    Uint8Array.prototype.set.call(owned, source);
    const modelId = fields.model_id;
    const sourceMime = fields.mime_type as OwnerKling4ImageSourceMimeType;
    const mime: OwnerKling4ImageCanonicalMimeType = sourceMime === "image/jpg" ? "image/jpeg" : sourceMime;
    let parsed: { readonly mime: string; readonly width: number; readonly height: number };
    try {
      parsed = mime === "image/avif"
        ? inspectBoundedOwnerClarityAvifBytesWithMax(owned, MAX_BYTES)
        : inspectBoundedOwnerImageBytesWithMax(owned, MAX_BYTES);
    } catch (error) {
      if (error instanceof UnsupportedOwnerClarityAvifCompositionError) unsupportedAvif();
      invalid();
    }
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height) ||
        parsed.width < MIN_DIMENSION || parsed.height < MIN_DIMENSION ||
        parsed.width > MAX_DIMENSION || parsed.height > MAX_DIMENSION ||
        parsed.width / parsed.height < MIN_ASPECT_RATIO || parsed.width / parsed.height > MAX_ASPECT_RATIO) invalid();

    const filename = canonicalFilename(fields.filename, mime);
    const state: ImageState = { bytes: owned, modelId, filename, sourceMime, mime, width: parsed.width, height: parsed.height,
      size: owned.byteLength, sha256: createHash("sha256").update(owned).digest("hex") };
    const receipt = Object.freeze({ status: "LOCAL_SOURCE_VALIDATED" as const, model_id: modelId,
      source_policy_id: OWNER_KLING4_IMAGE_POLICY.policy_id, filename, source_mime_type: sourceMime, mime_type: mime,
      width: state.width, height: state.height, size: state.size, sha256: state.sha256,
      limits_confidence: OWNER_KLING4_IMAGE_POLICY.limits_confidence,
      metadata_confidence: OWNER_KLING4_IMAGE_POLICY.metadata_confidence,
      avif_confidence: mime === "image/avif" ? OWNER_KLING4_IMAGE_POLICY.avif_supported_subset : "NOT_APPLICABLE" as const,
      generation_permit: false as const, reference_role_binding: "NOT_ESTABLISHED" as const,
      owner_upload_binding: "NOT_ESTABLISHED" as const });
    IMAGES.set(receipt, state);
    owned = undefined;
    return receipt;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerKling4ImagePolicyError) throw error;
    return invalid();
  }
}

/** True only for an authentic live receipt scoped to the requested Kling 4 model. */
export function isValidatedOwnerKling4Image(
  receipt: unknown,
  modelId: OwnerKling4ModelId
): receipt is Readonly<ValidatedOwnerKling4Image> {
  return isModelId(modelId) && getLiveState(receipt, modelId) !== null;
}

/** Rehashes the private snapshot and returns a fresh consumer-owned byte copy. */
export function readValidatedOwnerKling4Image(
  receipt: unknown,
  modelId: OwnerKling4ModelId
): Readonly<{
  bytes: Uint8Array;
  filename: string;
  mime_type: OwnerKling4ImageCanonicalMimeType;
  width: number;
  height: number;
  size: number;
  sha256: string;
}> | null {
  if (!isModelId(modelId)) return null;
  const state = getLiveState(receipt, modelId);
  if (!state) return null;
  return Object.freeze({ bytes: new Uint8Array(state.bytes), filename: state.filename, mime_type: state.mime,
    width: state.width, height: state.height, size: state.size, sha256: state.sha256 });
}

/** Wipes and revokes only this policy's private snapshot; caller-owned bytes are never wiped. */
export function releaseValidatedOwnerKling4Image(receipt: unknown): boolean {
  if (!receipt || typeof receipt !== "object" || types.isProxy(receipt)) return false;
  const state = IMAGES.get(receipt);
  if (!state) return false;
  state.bytes.fill(0);
  return IMAGES.delete(receipt);
}

function getLiveState(receipt: unknown, modelId: OwnerKling4ModelId): ImageState | null {
  if (!receipt || typeof receipt !== "object" || types.isProxy(receipt)) return null;
  const state = IMAGES.get(receipt);
  return state && state.modelId === modelId && state.bytes.byteLength === state.size &&
    createHash("sha256").update(state.bytes).digest("hex") === state.sha256 ? state : null;
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

function canonicalFilename(filename: string, mime: OwnerKling4ImageCanonicalMimeType): string {
  if (!safeBasename(filename)) invalid();
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" : ".avif";
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

function isModelId(value: unknown): value is OwnerKling4ModelId {
  return typeof value === "string" && MODEL_IDS.includes(value as OwnerKling4ModelId);
}

function invalid(): never { throw new OwnerKling4ImagePolicyError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerKling4ImagePolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
function unsupportedAvif(): never { throw new OwnerKling4ImagePolicyError("UNSUPPORTED_AVIF_COMPOSITION"); }
