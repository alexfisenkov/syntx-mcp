import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, accessSync, lstatSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { types } from "node:util";

const MODEL_ID = "veo_omni" as const;
const SOURCE_CATALOG = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const SOURCE_BUILD = "1792156098" as const;
const POLICY_ID = "OWNER_VEO_OMNI_REFERENCE_INPUT_C19_V1" as const;
const PUBLIC_MAX_FILE_BYTES = 1_048_576_000;
const DEFAULT_LOCAL_MAX_FILE_BYTES = 67_108_864;
const MAX_DURATION_SECONDS = 10.2;
const MAX_STREAMS = 32;
const MAX_STDOUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const TEMP_PREFIX = "syntx-veo-omni-reference-2103-";
const ACCEPTED_FFPROBE_FORMAT = "mov,mp4,m4a,3gp,3g2,mj2";
const MP4_BRANDS = /^(?:isom|iso[2-9][a-z0-9]?|mp4[12]|avc1|M4V |MSNV|dash|cmfc|cmfs)$/u;
const QUICKTIME_BRAND = "qt  ";
const FORBIDDEN_FILENAME = /[<>:"/\\|?*\u0000-\u001f\u007f]/u;
const WINDOWS_RESERVED_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"]);
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime"]);
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_SET = Uint8Array.prototype.set;
const ARRAY_BUFFER_PROTOTYPE = ArrayBuffer.prototype;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ARRAY_BUFFER_PROTOTYPE, "byteLength")?.get;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const RECEIPTS = new WeakMap<object, Readonly<{ bytes: Buffer; fields: Readonly<OwnerVeoOmniValidatedReference> }>>();
const RECEIPT_DESCRIPTORS = new WeakMap<object, Readonly<Record<string, PropertyDescriptor>>>();
let activeVideoProbe = false;

export type OwnerVeoOmniReferenceMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/avif" | "video/mp4" | "video/quicktime";
export type OwnerVeoOmniReferenceSourceMimeType = OwnerVeoOmniReferenceMimeType | "image/jpg";

export interface OwnerVeoOmniReferenceInput {
  readonly filename: string;
  readonly mime_type: string;
  readonly bytes: Uint8Array;
  /** Trusted operator binary path, never an MCP argument. */
  readonly ffprobePath: string;
  /** Trusted operator cap, never an MCP argument. */
  readonly maxFileBytes?: number;
}

export interface OwnerVeoOmniValidatedReference {
  readonly status: "LOCAL_REFERENCE_VALIDATED";
  readonly model_id: typeof MODEL_ID;
  readonly kind: "image" | "video";
  readonly policy_id: typeof POLICY_ID;
  readonly source_catalog_version: typeof SOURCE_CATALOG;
  readonly source_build_id: typeof SOURCE_BUILD;
  readonly filename: string;
  readonly mime_type: OwnerVeoOmniReferenceMimeType;
  readonly source_mime_type: OwnerVeoOmniReferenceSourceMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number | null;
  readonly local_max_file_bytes: number;
  readonly public_max_file_bytes: typeof PUBLIC_MAX_FILE_BYTES;
  readonly dispatch_allowed: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}

export interface OwnerVeoOmniConsumedReference {
  readonly bytes: Buffer;
  readonly filename: string;
  readonly mime_type: OwnerVeoOmniReferenceMimeType;
  readonly source_mime_type: OwnerVeoOmniReferenceSourceMimeType;
  readonly kind: "image" | "video";
  readonly sha256: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number | null;
  readonly local_max_file_bytes: number;
}

export type OwnerVeoOmniReferenceInputErrorCode = "INVALID_INPUT" | "LOCAL_LIMIT_EXCEEDED" | "LOCAL_RESOURCE_BUSY" |
  "UNSUPPORTED_MEDIA" | "PROBE_FAILED" | "PROBE_ABORTED";

export class OwnerVeoOmniReferenceInputError extends Error {
  constructor(readonly code: OwnerVeoOmniReferenceInputErrorCode) {
    super("The owner Veo Omni reference input could not be validated safely.");
    this.name = "OwnerVeoOmniReferenceInputError";
  }
}

/** Local structural inspection only; video bytes are metadata-probed without decoding. */
export async function validateOwnerVeoOmniReferenceInput(
  input: unknown,
  signal?: AbortSignal
): Promise<Readonly<OwnerVeoOmniValidatedReference>> {
  const request = exactInput(input), validatedSignal = exactSignal(signal);
  if (signalAborted(validatedSignal)) fail("PROBE_ABORTED");
  const byteLength = intrinsicByteLength(request.bytes);
  if (byteLength < 1) fail("INVALID_INPUT");
  if (byteLength > request.maxFileBytes) fail("LOCAL_LIMIT_EXCEEDED");
  const kind = kindForSourceMime(request.mime_type);
  const mime = normalizedMime(request.mime_type);
  if (!safeFilename(request.filename) || !filenameMatchesMime(request.filename, request.mime_type) || !mime || !kind) fail("INVALID_INPUT");

  if (kind === "video") {
    if (activeVideoProbe) fail("LOCAL_RESOURCE_BUSY");
    activeVideoProbe = true;
  }
  let owned: Buffer | undefined;
  let probeTemp: ProbeTemp | undefined;
  let handedOff = false;
  try {
    owned = copyBytes(request.bytes, byteLength);
    if (signalAborted(validatedSignal)) fail("PROBE_ABORTED");
    let width: number, height: number, durationSeconds: number | null = null;
    if (kind === "image") {
      const image = inspectImage(owned, mime);
      width = image.width;
      height = image.height;
    } else {
      identifyVideoContainer(owned, mime);
      verifyTrustedBinary(request.ffprobePath);
      probeTemp = await writePrivateProbeFile(owned, mime);
      const output = await runFfprobe(request.ffprobePath, probeTemp.inputPath, validatedSignal);
      if (signalAborted(validatedSignal)) fail("PROBE_ABORTED");
      const afterProbe = await lstat(probeTemp.inputPath);
      if (!afterProbe.isFile() || afterProbe.isSymbolicLink() || afterProbe.size !== owned.byteLength) fail("PROBE_FAILED");
      const metadata = parseVideoFfprobe(output);
      if (metadata.durationSeconds > MAX_DURATION_SECONDS) fail("UNSUPPORTED_MEDIA");
      width = metadata.width;
      height = metadata.height;
      durationSeconds = metadata.durationSeconds;
    }
    if (signalAborted(validatedSignal)) fail("PROBE_ABORTED");
    const result: OwnerVeoOmniValidatedReference = Object.freeze({
      status: "LOCAL_REFERENCE_VALIDATED",
      model_id: MODEL_ID,
      kind,
      policy_id: POLICY_ID,
      source_catalog_version: SOURCE_CATALOG,
      source_build_id: SOURCE_BUILD,
      filename: request.filename,
      mime_type: mime,
      source_mime_type: request.mime_type,
      size: byteLength,
      sha256: createHash("sha256").update(owned).digest("hex"),
      width,
      height,
      duration_seconds: durationSeconds,
      local_max_file_bytes: request.maxFileBytes,
      public_max_file_bytes: PUBLIC_MAX_FILE_BYTES,
      dispatch_allowed: false,
      owner_upload_binding: "NOT_ESTABLISHED"
    });
    if (probeTemp) {
      await cleanupProbeTemp(probeTemp);
      probeTemp = undefined;
    }
    if (signalAborted(validatedSignal)) fail("PROBE_ABORTED");
    const state = Object.freeze({ bytes: owned, fields: result });
    RECEIPTS.set(result, state);
    RECEIPT_DESCRIPTORS.set(result, Object.getOwnPropertyDescriptors(result));
    handedOff = true;
    return result;
  } catch (error) {
    if (error instanceof OwnerVeoOmniReferenceInputError) throw error;
    if (signalAborted(validatedSignal)) throw new OwnerVeoOmniReferenceInputError("PROBE_ABORTED");
    if (kind === "video") throw new OwnerVeoOmniReferenceInputError("PROBE_FAILED");
    throw new OwnerVeoOmniReferenceInputError("INVALID_INPUT");
  } finally {
    if (!handedOff) owned?.fill(0);
    try { if (probeTemp) await cleanupProbeTemp(probeTemp); }
    finally { if (kind === "video") activeVideoProbe = false; }
  }
}

/** True only for the unchanged frozen receipt that owns a private byte copy. */
export function isOwnerVeoOmniValidatedReference(value: unknown): value is Readonly<OwnerVeoOmniValidatedReference> {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
  const state = RECEIPTS.get(value), expected = RECEIPT_DESCRIPTORS.get(value);
  if (!state || state.fields !== value || !expected) return false;
  const actual = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(actual), expectedKeys = Reflect.ownKeys(expected);
  if (keys.length !== expectedKeys.length) return false;
  return keys.every((key) => {
    const current = actual[key as keyof typeof actual], original = expected[key as keyof typeof expected];
    return expectedKeys.includes(key) && current !== undefined && original !== undefined && Object.hasOwn(current, "value") &&
      current.enumerable === original.enumerable && current.configurable === false && current.writable === false && current.value === original.value;
  }) && state.bytes.byteLength === state.fields.size && state.fields.model_id === MODEL_ID &&
    state.fields.policy_id === POLICY_ID && state.fields.source_catalog_version === SOURCE_CATALOG &&
    state.fields.source_build_id === SOURCE_BUILD && state.fields.dispatch_allowed === false &&
    state.fields.owner_upload_binding === "NOT_ESTABLISHED";
}

/** Transfers the one private byte copy to the next local stage and invalidates this receipt. */
export function consumeOwnerVeoOmniValidatedReference(value: unknown): Readonly<OwnerVeoOmniConsumedReference> {
  if (!isOwnerVeoOmniValidatedReference(value)) fail("INVALID_INPUT");
  const state = RECEIPTS.get(value);
  if (!state) fail("INVALID_INPUT");
  RECEIPTS.delete(value);
  RECEIPT_DESCRIPTORS.delete(value);
  return Object.freeze({
    bytes: state.bytes,
    filename: state.fields.filename,
    mime_type: state.fields.mime_type,
    source_mime_type: state.fields.source_mime_type,
    kind: state.fields.kind,
    sha256: state.fields.sha256,
    size: state.fields.size,
    width: state.fields.width,
    height: state.fields.height,
    duration_seconds: state.fields.duration_seconds,
    local_max_file_bytes: state.fields.local_max_file_bytes
  });
}

/** Zeroes private bytes and invalidates an unconsumed local receipt. */
export function releaseOwnerVeoOmniValidatedReference(value: unknown): boolean {
  if (!isOwnerVeoOmniValidatedReference(value)) return false;
  const state = RECEIPTS.get(value);
  if (!state) return false;
  state.bytes.fill(0);
  RECEIPTS.delete(value);
  RECEIPT_DESCRIPTORS.delete(value);
  return true;
}

interface ParsedInput {
  readonly filename: string;
  readonly mime_type: OwnerVeoOmniReferenceSourceMimeType;
  readonly bytes: Uint8Array;
  readonly ffprobePath: string;
  readonly maxFileBytes: number;
}
interface ImageDimensions { readonly width: number; readonly height: number; }
interface VideoProbe { readonly width: number; readonly height: number; readonly durationSeconds: number; }
interface ProbeTemp { readonly directory: string; readonly inputPath: string; readonly mime: OwnerVeoOmniReferenceMimeType; }
interface Box { readonly type: string; readonly start: number; readonly payloadStart: number; readonly end: number; }
interface BoxBudget { boxes: number; }

function exactInput(value: unknown): ParsedInput {
  const fields = exactRecord(value, ["filename", "mime_type", "bytes", "ffprobePath"], ["maxFileBytes"]);
  if (typeof fields.filename !== "string" || typeof fields.mime_type !== "string" || typeof fields.ffprobePath !== "string" ||
      (fields.maxFileBytes !== undefined && (!Number.isSafeInteger(fields.maxFileBytes) || (fields.maxFileBytes as number) < 1 ||
        (fields.maxFileBytes as number) > PUBLIC_MAX_FILE_BYTES)) || !isSafeAbsolutePath(fields.ffprobePath) || !isSupportedBytes(fields.bytes)) fail("INVALID_INPUT");
  if (!IMAGE_MIME_TYPES.has(fields.mime_type) && !VIDEO_MIME_TYPES.has(fields.mime_type)) fail("INVALID_INPUT");
  return Object.freeze({ filename: fields.filename, mime_type: fields.mime_type as OwnerVeoOmniReferenceSourceMimeType,
    bytes: fields.bytes, ffprobePath: fields.ffprobePath, maxFileBytes: (fields.maxFileBytes as number | undefined) ?? DEFAULT_LOCAL_MAX_FILE_BYTES });
}

function isSafeAbsolutePath(path: string): boolean {
  try { return path.length > 0 && path === path.trim() && !path.includes("\0") && isAbsolute(path) && resolve(path) === path; }
  catch { return false; }
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_INPUT");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length < required.length || keys.length > required.length + optional.length ||
        required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" ||
          (!required.includes(key) && !optional.includes(key)) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) fail("INVALID_INPUT");
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return fail("INVALID_INPUT"); }
}

function isSupportedBytes(value: unknown): value is Uint8Array {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof Uint8Array)) return false;
  if (!Buffer.isBuffer(value) && Object.getPrototypeOf(value) !== Uint8Array.prototype) return false;
  try {
    if (!TYPED_ARRAY_BYTE_LENGTH_GETTER || !TYPED_ARRAY_BUFFER_GETTER || !ARRAY_BUFFER_BYTE_LENGTH_GETTER ||
        Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "length")) return false;
    const backing = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer;
    return Object.getPrototypeOf(backing) === ARRAY_BUFFER_PROTOTYPE && !Object.hasOwn(backing, "byteLength") &&
      Number.isSafeInteger(Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, [])) &&
      Number.isSafeInteger(Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, backing, []));
  } catch { return false; }
}

function intrinsicByteLength(bytes: Uint8Array): number {
  try { if (!TYPED_ARRAY_BYTE_LENGTH_GETTER) fail("INVALID_INPUT"); return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, bytes, []) as number; }
  catch { return fail("INVALID_INPUT"); }
}

function copyBytes(input: Uint8Array, byteLength: number): Buffer {
  const copy = Buffer.allocUnsafe(byteLength);
  try {
    Reflect.apply(TYPED_ARRAY_SET, copy, [input]);
    if (copy.byteLength !== byteLength) fail("INVALID_INPUT");
    return copy;
  } catch (error) { copy.fill(0); if (error instanceof OwnerVeoOmniReferenceInputError) throw error; return fail("INVALID_INPUT"); }
}

function exactSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || !(signal instanceof AbortSignal) ||
      Object.getPrototypeOf(signal) !== AbortSignal.prototype || !ABORTED_GETTER) fail("INVALID_INPUT");
  try { Reflect.apply(ABORTED_GETTER, signal, []); } catch { fail("INVALID_INPUT"); }
  return signal;
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  if (!signal) return false;
  try { if (!ABORTED_GETTER) fail("INVALID_INPUT"); return Reflect.apply(ABORTED_GETTER, signal, []) as boolean; }
  catch { return fail("INVALID_INPUT"); }
}

function kindForSourceMime(mime: string): "image" | "video" | undefined {
  if (IMAGE_MIME_TYPES.has(mime)) return "image";
  if (VIDEO_MIME_TYPES.has(mime)) return "video";
  return undefined;
}

function normalizedMime(mime: string): OwnerVeoOmniReferenceMimeType | undefined {
  if (mime === "image/jpg") return "image/jpeg";
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || mime === "image/avif" ||
      mime === "video/mp4" || mime === "video/quicktime") return mime;
  return undefined;
}

function filenameMatchesMime(filename: string, sourceMime: string): boolean {
  const extension = extname(filename).toLowerCase();
  switch (sourceMime) {
    case "image/jpeg": return extension === ".jpg" || extension === ".jpeg";
    case "image/jpg": return extension === ".jpg";
    case "image/png": return extension === ".png";
    case "image/webp": return extension === ".webp";
    case "image/avif": return extension === ".avif";
    case "video/mp4": return extension === ".mp4";
    case "video/quicktime": return extension === ".mov";
    default: return false;
  }
}

function safeFilename(value: string): boolean {
  return value.length > 0 && value === value.trimEnd() && value !== "." && value !== ".." && !value.endsWith(".") &&
    !FORBIDDEN_FILENAME.test(value) && !WINDOWS_RESERVED_FILENAME.test(value) && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) &&
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

function inspectImage(bytes: Buffer, mime: OwnerVeoOmniReferenceMimeType): ImageDimensions {
  let parsed: ImageDimensions, actualMime: OwnerVeoOmniReferenceMimeType;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) { actualMime = "image/jpeg"; parsed = parseJpeg(bytes); }
  else if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { actualMime = "image/png"; parsed = parsePng(bytes); }
  else if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") { actualMime = "image/webp"; parsed = parseWebp(bytes); }
  else if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") { actualMime = "image/avif"; parsed = parseAvif(bytes); }
  else return fail("INVALID_INPUT");
  if (actualMime !== mime) return fail("INVALID_INPUT");
  if (parsed.width < 1 || parsed.height < 1 || !Number.isSafeInteger(parsed.width) || !Number.isSafeInteger(parsed.height)) fail("UNSUPPORTED_MEDIA");
  return parsed;
}

function parseJpeg(bytes: Buffer): ImageDimensions {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return fail("UNSUPPORTED_MEDIA");
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return fail("UNSUPPORTED_MEDIA");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) return fail("UNSUPPORTED_MEDIA");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return fail("UNSUPPORTED_MEDIA");
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) return fail("UNSUPPORTED_MEDIA");
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return fail("UNSUPPORTED_MEDIA");
}

function parsePng(bytes: Buffer): ImageDimensions {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return fail("UNSUPPORTED_MEDIA");
  let offset = 8, chunks = 0, sawHeader = false, sawImageData = false;
  let dimensions: ImageDimensions | undefined;
  while (offset < bytes.length) {
    if (++chunks > 100_000 || offset + 12 > bytes.length) return fail("UNSUPPORTED_MEDIA");
    const size = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    if (size > bytes.length - offset - 12 || !/^[A-Za-z]{4}$/u.test(type)) return fail("UNSUPPORTED_MEDIA");
    if (!sawHeader) {
      if (type !== "IHDR" || size !== 13) return fail("UNSUPPORTED_MEDIA");
      dimensions = { width: bytes.readUInt32BE(offset + 8), height: bytes.readUInt32BE(offset + 12) };
      sawHeader = true;
    } else if (type === "IHDR") return fail("UNSUPPORTED_MEDIA");
    if (type === "IDAT") sawImageData = true;
    offset += size + 12;
    if (type === "IEND") {
      if (size !== 0 || offset !== bytes.length || !sawImageData || !dimensions) return fail("UNSUPPORTED_MEDIA");
      return dimensions;
    }
  }
  return fail("UNSUPPORTED_MEDIA");
}

function parseWebp(bytes: Buffer): ImageDimensions {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" ||
      bytes.readUInt32LE(4) !== bytes.length - 8) return fail("UNSUPPORTED_MEDIA");
  let offset = 12, extended: ImageDimensions | undefined, image: ImageDimensions | undefined, chunks = 0;
  while (offset < bytes.length) {
    chunks += 1;
    if (chunks > 100_000 || offset + 8 > bytes.length) return fail("UNSUPPORTED_MEDIA");
    const kind = bytes.toString("ascii", offset, offset + 4), length = bytes.readUInt32LE(offset + 4), data = offset + 8;
    const end = data + length + (length % 2);
    if (end > bytes.length || end <= offset || (length % 2 === 1 && bytes[data + length] !== 0) || kind === "ANIM" || kind === "ANMF") return fail("UNSUPPORTED_MEDIA");
    if (kind === "VP8X") {
      if (extended || length !== 10 || (bytes[data]! & 0x02) !== 0) return fail("UNSUPPORTED_MEDIA");
      extended = { width: bytes.readUIntLE(data + 4, 3) + 1, height: bytes.readUIntLE(data + 7, 3) + 1 };
    } else if (kind === "VP8 ") {
      if (image || length < 10 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return fail("UNSUPPORTED_MEDIA");
      image = { width: bytes.readUInt16LE(data + 6) & 0x3fff, height: bytes.readUInt16LE(data + 8) & 0x3fff };
    } else if (kind === "VP8L") {
      if (image || length < 5 || bytes[data] !== 0x2f) return fail("UNSUPPORTED_MEDIA");
      const b1 = bytes[data + 1]!, b2 = bytes[data + 2]!, b3 = bytes[data + 3]!, b4 = bytes[data + 4]!;
      image = { width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) };
    }
    offset = end;
  }
  if (!image || offset !== bytes.length || (extended && (extended.width !== image.width || extended.height !== image.height))) return fail("UNSUPPORTED_MEDIA");
  return image;
}

function parseAvif(bytes: Buffer): ImageDimensions {
  const budget = { boxes: 0 };
  let ftyp: Box | undefined, meta: Box | undefined, hasAvifBrand = false, hasImageData = false, first = true;
  for (const box of readBoxes(bytes, 0, bytes.length, budget)) {
    if (first && box.type !== "ftyp") return fail("UNSUPPORTED_MEDIA");
    first = false;
    if (box.type === "ftyp") {
      if (ftyp) return fail("UNSUPPORTED_MEDIA");
      ftyp = box;
      const brands = parseAvifBrands(bytes, box);
      if (brands.hasAvis || !brands.hasAvif) return fail("UNSUPPORTED_MEDIA");
      hasAvifBrand = true;
    } else if (box.type === "meta") {
      if (meta) return fail("UNSUPPORTED_MEDIA");
      meta = box;
    } else if (box.type === "mdat") {
      hasImageData ||= box.end > box.payloadStart;
    } else if (box.type === "moov" || box.type === "moof") return fail("UNSUPPORTED_MEDIA");
  }
  if (!ftyp || !meta || !hasAvifBrand) return fail("UNSUPPORTED_MEDIA");
  const metaStart = meta.payloadStart;
  if (meta.end - metaStart < 4 || bytes[metaStart] !== 0 || readU24(bytes, metaStart + 1) !== 0) return fail("UNSUPPORTED_MEDIA");
  let handler: Box | undefined, primaryItem: number | undefined, itemInfo: Box | undefined, itemProperties: Box | undefined;
  for (const child of readBoxes(bytes, metaStart + 4, meta.end, budget)) {
    if (child.type === "hdlr") { if (handler) return fail("UNSUPPORTED_MEDIA"); handler = child; }
    else if (child.type === "pitm") { if (primaryItem !== undefined) return fail("UNSUPPORTED_MEDIA"); primaryItem = parseAvifPrimaryId(bytes, child); }
    else if (child.type === "iinf") { if (itemInfo) return fail("UNSUPPORTED_MEDIA"); itemInfo = child; }
    else if (child.type === "iprp") { if (itemProperties) return fail("UNSUPPORTED_MEDIA"); itemProperties = child; }
    else if (child.type === "idat" && child.end > child.payloadStart) hasImageData = true;
    else if (child.type === "iref" || child.type === "grpl") return fail("UNSUPPORTED_MEDIA");
  }
  if (!hasImageData || !handler || !isPictureHandler(bytes, handler) || primaryItem === undefined || !itemInfo || !itemProperties ||
      parseAvifPrimaryType(bytes, itemInfo, primaryItem, budget) !== "av01") return fail("UNSUPPORTED_MEDIA");
  return parseAvifPrimaryDimensions(bytes, itemProperties, primaryItem, budget);
}

function parseAvifBrands(bytes: Buffer, box: Box): { readonly hasAvif: boolean; readonly hasAvis: boolean } {
  const length = box.end - box.payloadStart;
  if (length < 8 || (length - 8) % 4 !== 0 || (length - 8) / 4 > 64) return fail("UNSUPPORTED_MEDIA");
  let hasAvif = bytes.toString("ascii", box.payloadStart, box.payloadStart + 4) === "avif";
  let hasAvis = bytes.toString("ascii", box.payloadStart, box.payloadStart + 4) === "avis";
  for (let offset = box.payloadStart + 8; offset < box.end; offset += 4) {
    const brand = bytes.toString("ascii", offset, offset + 4);
    hasAvif ||= brand === "avif"; hasAvis ||= brand === "avis";
  }
  return { hasAvif, hasAvis };
}

function parseAvifPrimaryId(bytes: Buffer, box: Box): number {
  const length = box.end - box.payloadStart, version = bytes[box.payloadStart]!;
  if (length < 6 || readU24(bytes, box.payloadStart + 1) !== 0) return fail("UNSUPPORTED_MEDIA");
  if (version === 0 && length === 6) return bytes.readUInt16BE(box.payloadStart + 4);
  if (version === 1 && length === 8) return bytes.readUInt32BE(box.payloadStart + 4);
  return fail("UNSUPPORTED_MEDIA");
}

function parseAvifPrimaryType(bytes: Buffer, box: Box, primary: number, budget: BoxBudget): string | undefined {
  const start = box.payloadStart, length = box.end - start, version = bytes[start]!;
  if (length < 6 || readU24(bytes, start + 1) !== 0 || (version !== 0 && version !== 1)) return fail("UNSUPPORTED_MEDIA");
  const countBytes = version === 0 ? 2 : 4, count = countBytes === 2 ? bytes.readUInt16BE(start + 4) : bytes.readUInt32BE(start + 4);
  if (count > 4096) return fail("UNSUPPORTED_MEDIA");
  let parsed = 0, primaryType: string | undefined;
  const ids = new Set<number>();
  for (const entry of readBoxes(bytes, start + 4 + countBytes, box.end, budget)) {
    if (++parsed > count || entry.type !== "infe") return fail("UNSUPPORTED_MEDIA");
    const item = parseAvifItemInfo(bytes, entry);
    if (ids.has(item.id)) return fail("UNSUPPORTED_MEDIA");
    ids.add(item.id);
    if (item.id === primary) { if (primaryType !== undefined) return fail("UNSUPPORTED_MEDIA"); primaryType = item.type; }
  }
  if (parsed !== count || primaryType === undefined) return fail("UNSUPPORTED_MEDIA");
  return primaryType;
}

function parseAvifItemInfo(bytes: Buffer, box: Box): { readonly id: number; readonly type: string } {
  const start = box.payloadStart, length = box.end - start, version = bytes[start]!;
  if (length < 12 || readU24(bytes, start + 1) !== 0 || (version !== 2 && version !== 3)) return fail("UNSUPPORTED_MEDIA");
  const idOffset = start + 4, protectionOffset = idOffset + (version === 2 ? 2 : 4), typeOffset = protectionOffset + 2;
  if (typeOffset + 5 > box.end || bytes.readUInt16BE(protectionOffset) !== 0) return fail("UNSUPPORTED_MEDIA");
  const type = bytes.toString("ascii", typeOffset, typeOffset + 4);
  let end = typeOffset + 4;
  while (end < box.end && bytes[end] !== 0) end += 1;
  if (end === box.end) return fail("UNSUPPORTED_MEDIA");
  return { id: version === 2 ? bytes.readUInt16BE(idOffset) : bytes.readUInt32BE(idOffset), type };
}

function parseAvifPrimaryDimensions(bytes: Buffer, box: Box, primary: number, budget: BoxBudget): ImageDimensions {
  let ipco: Box | undefined, ipma: Box | undefined;
  for (const child of readBoxes(bytes, box.payloadStart, box.end, budget)) {
    if (child.type === "ipco") { if (ipco) return fail("UNSUPPORTED_MEDIA"); ipco = child; }
    else if (child.type === "ipma") { if (ipma) return fail("UNSUPPORTED_MEDIA"); ipma = child; }
  }
  if (!ipco || !ipma) return fail("UNSUPPORTED_MEDIA");
  const properties: Array<{ readonly type: string; readonly dimensions?: ImageDimensions }> = [];
  for (const property of readBoxes(bytes, ipco.payloadStart, ipco.end, budget)) {
    if (properties.length >= 4096) return fail("UNSUPPORTED_MEDIA");
    if (property.type === "ispe") {
      if (property.end - property.payloadStart !== 12 || bytes[property.payloadStart] !== 0 || readU24(bytes, property.payloadStart + 1) !== 0) return fail("UNSUPPORTED_MEDIA");
      properties.push({ type: "ispe", dimensions: { width: bytes.readUInt32BE(property.payloadStart + 4), height: bytes.readUInt32BE(property.payloadStart + 8) } });
    } else properties.push({ type: property.type });
  }
  const associated = parseAvifAssociations(bytes, ipma, primary);
  const ispes = associated.filter((index) => properties[index - 1]?.type === "ispe");
  if (ispes.length !== 1 || associated.some((index) => !properties[index - 1]) ||
      associated.some((index) => !["ispe", "pixi", "av1C", "colr"].includes(properties[index - 1]!.type))) return fail("UNSUPPORTED_MEDIA");
  const dimensions = properties[ispes[0]! - 1]!.dimensions!;
  if (dimensions.width < 1 || dimensions.height < 1) return fail("UNSUPPORTED_MEDIA");
  return dimensions;
}

function parseAvifAssociations(bytes: Buffer, box: Box, primary: number): number[] {
  const start = box.payloadStart, length = box.end - start, version = bytes[start]!, flags = readU24(bytes, start + 1);
  if (length < 8 || (version !== 0 && version !== 1) || (flags & ~1) !== 0) return fail("UNSUPPORTED_MEDIA");
  const wide = (flags & 1) !== 0, count = bytes.readUInt32BE(start + 4);
  if (count > 4096) return fail("UNSUPPORTED_MEDIA");
  let offset = start + 8, primaryCount = 0, found: number[] | undefined;
  const ids = new Set<number>();
  for (let entry = 0; entry < count; entry += 1) {
    const idBytes = version === 0 ? 2 : 4;
    if (offset + idBytes + 1 > box.end) return fail("UNSUPPORTED_MEDIA");
    const id = idBytes === 2 ? bytes.readUInt16BE(offset) : bytes.readUInt32BE(offset);
    offset += idBytes;
    if (ids.has(id)) return fail("UNSUPPORTED_MEDIA");
    ids.add(id);
    const associationCount = bytes[offset++]!;
    if (id === primary) { primaryCount += 1; if (primaryCount > 1) return fail("UNSUPPORTED_MEDIA"); found = []; }
    for (let index = 0; index < associationCount; index += 1) {
      const bytesPer = wide ? 2 : 1;
      if (offset + bytesPer > box.end) return fail("UNSUPPORTED_MEDIA");
      const raw = wide ? bytes.readUInt16BE(offset) : bytes[offset]!;
      offset += bytesPer;
      const propertyIndex = wide ? raw & 0x7fff : raw & 0x7f;
      if (propertyIndex === 0) return fail("UNSUPPORTED_MEDIA");
      if (id === primary) found!.push(propertyIndex);
    }
  }
  if (offset !== box.end || primaryCount !== 1 || !found || found.length > 127 || new Set(found).size !== found.length) return fail("UNSUPPORTED_MEDIA");
  return found;
}

function isPictureHandler(bytes: Buffer, box: Box): boolean {
  return box.end - box.payloadStart >= 12 && bytes[box.payloadStart] === 0 && readU24(bytes, box.payloadStart + 1) === 0 &&
    bytes.toString("ascii", box.payloadStart + 8, box.payloadStart + 12) === "pict";
}

function* readBoxes(bytes: Buffer, start: number, end: number, budget: BoxBudget): Generator<Box> {
  let offset = start;
  while (offset < end) {
    if (++budget.boxes > 100_000 || offset + 8 > end) return fail("UNSUPPORTED_MEDIA");
    const size32 = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    let header = 8, size: number;
    if (size32 === 1) {
      if (offset + 16 > end) return fail("UNSUPPORTED_MEDIA");
      const extended = BigInt(bytes.readUInt32BE(offset + 8)) * 0x1_0000_0000n + BigInt(bytes.readUInt32BE(offset + 12));
      if (extended > BigInt(end - offset) || extended > BigInt(Number.MAX_SAFE_INTEGER)) return fail("UNSUPPORTED_MEDIA");
      size = Number(extended); header = 16;
    } else {
      if (size32 === 0) return fail("UNSUPPORTED_MEDIA");
      size = size32;
    }
    if (size < header || size > end - offset) return fail("UNSUPPORTED_MEDIA");
    const box = { type, start: offset, payloadStart: offset + header, end: offset + size };
    yield box;
    offset = box.end;
  }
  if (offset !== end) return fail("UNSUPPORTED_MEDIA");
}

function readU24(bytes: Buffer, offset: number): number { return (bytes[offset]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset + 2]!; }

function identifyVideoContainer(bytes: Buffer, mime: OwnerVeoOmniReferenceMimeType): "ISO_BMFF_MP4" | "QUICKTIME_MOV" {
  if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return fail("UNSUPPORTED_MEDIA");
  const size = bytes.readUInt32BE(0);
  if (size < 16 || size > bytes.length || (size - 16) % 4 !== 0) return fail("UNSUPPORTED_MEDIA");
  const brands: string[] = [bytes.toString("ascii", 8, 12)];
  for (let offset = 16; offset < size; offset += 4) brands.push(bytes.toString("ascii", offset, offset + 4));
  const major = brands[0]!;
  if (mime === "video/quicktime" && major === QUICKTIME_BRAND) return "QUICKTIME_MOV";
  if (mime === "video/mp4" && major !== QUICKTIME_BRAND && brands.some((brand) => MP4_BRANDS.test(brand))) return "ISO_BMFF_MP4";
  return fail("UNSUPPORTED_MEDIA");
}

async function writePrivateProbeFile(bytes: Buffer, mime: OwnerVeoOmniReferenceMimeType): Promise<ProbeTemp> {
  const directory = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  let inputPath: string | undefined, created = false;
  try {
    await chmod(directory, 0o700);
    const suffix = mime === "video/quicktime" ? ".mov" : ".mp4";
    inputPath = join(directory, `source${suffix}`);
    const file = await open(inputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    created = true;
    try {
      await file.chmod(0o600);
      await file.writeFile(bytes);
      await file.sync();
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== bytes.byteLength) fail("PROBE_FAILED");
    } finally { await file.close(); }
    return Object.freeze({ directory, inputPath, mime });
  } catch (error) {
    if (created && inputPath) { try { await wipeAndUnlink(inputPath); } catch { /* preserve the original safe error */ } }
    try { await rmdir(directory); } catch { /* preserve the original safe error */ }
    if (error instanceof OwnerVeoOmniReferenceInputError) throw error;
    throw new OwnerVeoOmniReferenceInputError("PROBE_FAILED");
  }
}

async function cleanupProbeTemp(temp: ProbeTemp): Promise<void> {
  let cleanupFailed = false;
  try { await wipeAndUnlink(temp.inputPath); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
  try { await rmdir(temp.directory); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
  if (cleanupFailed) fail("PROBE_FAILED");
}

async function wipeAndUnlink(path: string): Promise<void> {
  const file = await open(path, fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > PUBLIC_MAX_FILE_BYTES) fail("PROBE_FAILED");
    const zeros = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (position < stat.size) {
      const requested = Math.min(zeros.byteLength, stat.size - position);
      const result = await file.write(zeros, 0, requested, position);
      if (result.bytesWritten < 1) fail("PROBE_FAILED");
      position += result.bytesWritten;
    }
    zeros.fill(0);
    await file.sync();
  } finally { await file.close(); }
  await unlink(path);
}

function verifyTrustedBinary(path: string): void {
  if (!isAbsolute(path) || path !== path.trim() || path.includes("\0") || resolve(path) !== path || basename(path) === "") fail("INVALID_INPUT");
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || realpathSync(path) !== path) fail("INVALID_INPUT");
    if (process.platform === "win32") {
      if (!/\.exe$/iu.test(path)) fail("INVALID_INPUT");
      accessSync(path, fsConstants.R_OK);
    } else {
      const uid = process.getuid?.();
      if (uid === undefined || (info.uid !== 0 && info.uid !== uid) || (info.mode & 0o022) !== 0) fail("INVALID_INPUT");
      accessSync(path, fsConstants.X_OK | fsConstants.R_OK);
    }
  } catch { fail("INVALID_INPUT"); }
}

function runFfprobe(path: string, inputPath: string, signal?: AbortSignal): Promise<string> {
  const args = ["-v", "error", "-protocol_whitelist", "file", "-show_entries",
    "stream=codec_type,codec_name,width,height,duration:stream_disposition=attached_pic:format=duration,format_name", "-of", "json", inputPath];
  const options: ExecFileOptionsWithStringEncoding = { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL",
    maxBuffer: MAX_STDOUT_BYTES, windowsHide: true, ...(signal === undefined ? {} : { signal }), env: { PATH: "", LANG: "C", LC_ALL: "C" } };
  return new Promise((resolveOutput, rejectOutput) => {
    let spawned = false, spawnFailed = false, callbackDone = false, closed = false, settled = false;
    let callbackError: Error | null = null, stdout: string | undefined, closeCode: number | null = null, closeSignal: NodeJS.Signals | null = null;
    const settle = () => {
      if (settled || !callbackDone || (!closed && !spawnFailed)) return;
      settled = true;
      if (callbackError) { rejectOutput(callbackError); return; }
      if (closeCode !== 0 || closeSignal !== null || stdout === undefined) { rejectOutput(new Error("ffprobe did not exit successfully.")); return; }
      resolveOutput(stdout);
    };
    try {
      const child = execFileCallback(path, args, options, (error, output) => {
        callbackDone = true; callbackError = error; stdout = typeof output === "string" ? output : undefined; settle();
      });
      child.once("spawn", () => { spawned = true; });
      child.once("error", (error) => { if (!spawned) { spawnFailed = true; callbackDone = true; } callbackError ??= error; settle(); });
      child.once("close", (code, reason) => { closed = true; closeCode = code; closeSignal = reason; settle(); });
    } catch (error) { rejectOutput(error instanceof Error ? error : new Error("ffprobe could not start.")); }
  });
}

function parseVideoFfprobe(stdout: string): VideoProbe {
  let root: unknown;
  try { root = JSON.parse(stdout); } catch { return fail("UNSUPPORTED_MEDIA"); }
  if (!isRecord(root) || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > MAX_STREAMS ||
      !isRecord(root.format) || root.format.format_name !== ACCEPTED_FFPROBE_FORMAT) return fail("UNSUPPORTED_MEDIA");
  const primary: Record<string, unknown>[] = [];
  for (const stream of root.streams) {
    if (!isRecord(stream) || typeof stream.codec_type !== "string") return fail("UNSUPPORTED_MEDIA");
    if (stream.codec_type === "audio") continue;
    if (stream.codec_type !== "video" || !isRecord(stream.disposition)) return fail("UNSUPPORTED_MEDIA");
    if (stream.disposition.attached_pic === 0) primary.push(stream);
    else if (stream.disposition.attached_pic !== 1) return fail("UNSUPPORTED_MEDIA");
  }
  if (primary.length !== 1) return fail("UNSUPPORTED_MEDIA");
  const video = primary[0]!;
  const width = positiveSafeInteger(video.width), height = positiveSafeInteger(video.height);
  const containerDuration = optionalDuration(root.format.duration), streamDuration = optionalDuration(video.duration);
  const durationSeconds = containerDuration ?? streamDuration;
  if (width === undefined || height === undefined || durationSeconds === null || durationSeconds > MAX_DURATION_SECONDS) return fail("UNSUPPORTED_MEDIA");
  return { width, height, durationSeconds };
}

function optionalDuration(value: unknown): number | null {
  if (value === undefined || value === null || value === "N/A") return null;
  if (typeof value !== "string" && typeof value !== "number") return fail("UNSUPPORTED_MEDIA");
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function positiveSafeInteger(value: unknown): number | undefined {
  if (typeof value === "string" && /^\d+$/u.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value)); }
function isMissingFile(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"); }
function fail(code: OwnerVeoOmniReferenceInputErrorCode): never { throw new OwnerVeoOmniReferenceInputError(code); }
