import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION } from "./owner-flux3-video-source-profile.js";

const MODEL_ID = "flux3_i2v" as const;
const SOURCE_POLICY_ID = "OWNER_FLUX3_I2V_IMAGE_INPUT_POLICY_1D8_V1" as const;
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"] as const);
const MIME_SET = new Set<string>(MIME_TYPES);
const FORBIDDEN_FILENAME = /[<>:"/\\|?*\u0000-\u001f\u007f]/u;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const IMAGES = new WeakMap<object, ImageState>();

export interface OwnerFlux3I2vImageProbeResult {
  readonly status: "LOCAL_SOURCE_VALIDATED";
  readonly model_id: typeof MODEL_ID;
  readonly source_policy_id: typeof SOURCE_POLICY_ID;
  readonly source_catalog_version: typeof OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION;
  readonly filename: string;
  readonly source_mime_type: typeof MIME_TYPES[number];
  readonly mime_type: typeof MIME_TYPES[number];
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED";
  readonly dispatch_allowed: false;
  readonly generation_permit: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}

interface ImageState {
  readonly receipt: OwnerFlux3I2vImageProbeResult;
  readonly bytes: Buffer;
}

export class OwnerFlux3I2vImageProbeError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    super("The Flux3 I2V image input could not be structurally validated.");
    this.name = "OwnerFlux3I2vImageProbeError";
  }
}

/** Validates one Flux3 I2V image and retains an opaque, revocable byte snapshot. */
export function validateOwnerFlux3I2vImage(input: unknown): Readonly<OwnerFlux3I2vImageProbeResult> {
  let owned: Buffer | undefined;
  try {
    const fields = exactRecord(input, ["model_id", "filename", "mime_type", "bytes"]);
    if (fields.model_id !== MODEL_ID || typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
        !MIME_SET.has(fields.mime_type)) invalid();
    const source = sourceBytes(fields.bytes);
    if (source.byteLength < 1) invalid();
    if (source.byteLength > MAX_BYTES) localLimit();
    owned = Buffer.allocUnsafe(source.byteLength);
    Uint8Array.prototype.set.call(owned, source);
    const inspected = inspectBoundedOwnerImageBytesWithMax(owned, MAX_BYTES);
    if (inspected.mime !== fields.mime_type || !positiveSafeInteger(inspected.width) || !positiveSafeInteger(inspected.height)) invalid();
    const filename = canonicalFilename(fields.filename, inspected.mime);
    const receipt: OwnerFlux3I2vImageProbeResult = Object.freeze({
      status: "LOCAL_SOURCE_VALIDATED",
      model_id: MODEL_ID,
      source_policy_id: SOURCE_POLICY_ID,
      source_catalog_version: OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION,
      filename,
      source_mime_type: fields.mime_type as typeof MIME_TYPES[number],
      mime_type: inspected.mime,
      size: owned.byteLength,
      sha256: createHash("sha256").update(owned).digest("hex"),
      width: inspected.width,
      height: inspected.height,
      metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED",
      dispatch_allowed: false,
      generation_permit: false,
      owner_upload_binding: "NOT_ESTABLISHED"
    });
    IMAGES.set(receipt, { receipt, bytes: owned });
    owned = undefined;
    return receipt;
  } catch (error) {
    if (error instanceof OwnerFlux3I2vImageProbeError) throw error;
    return invalid();
  } finally {
    owned?.fill(0);
  }
}

export function isOwnerFlux3I2vImage(value: unknown): value is Readonly<OwnerFlux3I2vImageProbeResult> {
  return stateFor(value) !== null;
}

/** Returns a caller-owned byte copy only while the genuine probe receipt remains live. */
export function readOwnerFlux3I2vImageBytes(value: unknown): Readonly<{
  bytes: Uint8Array;
  filename: string;
  mime_type: typeof MIME_TYPES[number];
  width: number;
  height: number;
  size: number;
  sha256: string;
}> | null {
  const state = stateFor(value);
  if (!state) return null;
  return Object.freeze({
    bytes: new Uint8Array(state.bytes),
    filename: state.receipt.filename,
    mime_type: state.receipt.mime_type,
    width: state.receipt.width,
    height: state.receipt.height,
    size: state.receipt.size,
    sha256: state.receipt.sha256
  });
}

/** Wipes and revokes the private snapshot for one genuine receipt. */
export function releaseOwnerFlux3I2vImage(value: unknown): boolean {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = IMAGES.get(value as object);
  if (!state || state.receipt !== value) return false;
  state.bytes.fill(0);
  return IMAGES.delete(value as object);
}

function stateFor(value: unknown): ImageState | null {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return null;
    const state = IMAGES.get(value as object);
    if (!state || state.receipt !== value || state.bytes.byteLength !== state.receipt.size ||
        createHash("sha256").update(state.bytes).digest("hex") !== state.receipt.sha256) return null;
    const r = state.receipt;
    if (r.status !== "LOCAL_SOURCE_VALIDATED" || r.model_id !== MODEL_ID || r.source_policy_id !== SOURCE_POLICY_ID ||
        r.source_catalog_version !== OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION || !MIME_SET.has(r.mime_type) ||
        r.source_mime_type !== r.mime_type || r.size < 1 || r.size > MAX_BYTES || !/^[a-f0-9]{64}$/u.test(r.sha256) ||
        !positiveSafeInteger(r.width) || !positiveSafeInteger(r.height) ||
        r.metadata_confidence !== "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" || r.dispatch_allowed !== false ||
        r.generation_permit !== false || r.owner_upload_binding !== "NOT_ESTABLISHED") return null;
    return state;
  } catch { return null; }
}

function sourceBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || types.isProxy(value) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "length")) invalid();
  const length = Reflect.apply(BYTE_LENGTH_GETTER, value, []) as number;
  const backing = Reflect.apply(BUFFER_GETTER, value, []) as ArrayBuffer;
  if (!Number.isSafeInteger(length) || types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype ||
      Object.hasOwn(backing, "byteLength") || Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []) < length) invalid();
  if (length > MAX_BYTES) localLimit();
  const offset = Reflect.apply(BYTE_OFFSET_GETTER, value, []) as number;
  return new Uint8Array(backing, offset, length);
}

function canonicalFilename(value: string, mime: typeof MIME_TYPES[number]): string {
  if (!safeBasename(value)) invalid();
  const dot = value.lastIndexOf("."), stem = dot > 0 ? value.slice(0, dot) : value;
  const extension = mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" : ".webp";
  const result = `${stem}${extension}`;
  if (!safeBasename(result)) invalid();
  return result;
}

function safeBasename(value: string): boolean {
  return value.length > 0 && value === value.trimEnd() && !value.endsWith(".") && value !== "." && value !== ".." &&
    !FORBIDDEN_FILENAME.test(value) && !WINDOWS_RESERVED.test(value) && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) &&
    isWellFormedUnicode(value) && Buffer.byteLength(value, "utf8") <= 255;
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
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) =>
    typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) output[key] = descriptors[key]!.value;
  return output;
}

function positiveSafeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function invalid(): never { throw new OwnerFlux3I2vImageProbeError("INVALID_IMAGE_INPUT"); }
function localLimit(): never { throw new OwnerFlux3I2vImageProbeError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
