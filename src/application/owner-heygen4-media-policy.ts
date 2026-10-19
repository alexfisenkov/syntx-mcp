import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { inspectBoundedOwnerClarityAvifBytesWithMax } from "./owner-clarity-upscale-input-validator.js";

const MODEL_ID = "heygen4" as const;
const MAX_LOCAL_ASSET_BYTES = 10 * 1024 * 1024;
const PUBLIC_MAX_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8_400;
const MAX_IMAGE_PIXELS = 52_500_000;
const MIN_AUDIO_DURATION = 2;
const MAX_AUDIO_DURATION = 120;
const MAX_AUDIO_STREAMS = 8;
const MAX_STDOUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const TEMP_PREFIX = "syntx-heygen4-audio-";
const MIME_EXTENSIONS: Readonly<Record<Heygen4AudioMimeType, readonly string[]>> = Object.freeze({
  "audio/mp3": Object.freeze([".mp3"]), "audio/mpeg": Object.freeze([".mp3"]),
  "audio/wav": Object.freeze([".wav"]), "audio/x-wav": Object.freeze([".wav"]),
  "audio/m4a": Object.freeze([".m4a"]), "audio/mp4": Object.freeze([".m4a", ".mp4"])
});
const AUDIO_FORMAT_HINT: Readonly<Record<Heygen4AudioMimeType, string>> = Object.freeze({
  "audio/mp3": "mp3", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
  "audio/m4a": "m4a", "audio/mp4": "mp4"
});
const IMAGE_RECEIPTS = new WeakMap<object, Readonly<{ bytes: Buffer; fingerprint: string }>>();
const AUDIO_RECEIPTS = new WeakMap<object, Readonly<{ bytes: Buffer; fingerprint: string }>>();
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")?.get;

export const OWNER_HEYGEN4_MEDIA_POLICY = Object.freeze({
  policy_id: "OWNER_HEYGEN4_EXISTING_MEDIA_INPUT_C19_V1",
  model_id: MODEL_ID,
  public_max_file_bytes: PUBLIC_MAX_ASSET_BYTES,
  local_max_file_bytes: MAX_LOCAL_ASSET_BYTES,
  local_limit_kind: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT",
  accepted_image_mime_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const),
  accepted_audio_mime_types: Object.freeze(["audio/wav", "audio/mp3", "audio/mpeg", "audio/x-wav", "audio/m4a", "audio/mp4"] as const),
  min_image_dimension: 1,
  max_image_dimension: MAX_IMAGE_DIMENSION,
  max_image_pixels: MAX_IMAGE_PIXELS,
  min_audio_duration_seconds: MIN_AUDIO_DURATION,
  max_audio_duration_seconds: MAX_AUDIO_DURATION,
  metadata_confidence: "LOCAL_IMAGE_STRUCTURE_AND_FFPROBE_AUDIO_METADATA_NO_PIXEL_DECODE",
  import_provenance: "NOT_ESTABLISHED_BY_THIS_POLICY",
  generation_permit: false,
  provider_acceptance: "UNPROVEN"
} as const);

export type Heygen4ImageMimeType = "image/jpeg" | "image/jpg" | "image/png" | "image/avif" | "image/webp";
export type Heygen4AudioMimeType = "audio/wav" | "audio/mp3" | "audio/mpeg" | "audio/x-wav" | "audio/m4a" | "audio/mp4";

export interface ValidatedOwnerHeygen4Image {
  readonly status: "LOCAL_HEYGEN4_IMAGE_VALIDATED"; readonly model_id: typeof MODEL_ID;
  readonly filename: string; readonly mime_type: Heygen4ImageMimeType; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number; readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NO_PIXEL_DECODE" | "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY";
  readonly generation_permit: false; readonly owner_upload_binding: "NOT_ESTABLISHED"; readonly provider_acceptance: "UNPROVEN";
}

export interface ValidatedOwnerHeygen4Audio {
  readonly status: "LOCAL_HEYGEN4_AUDIO_VALIDATED"; readonly model_id: typeof MODEL_ID;
  readonly filename: string; readonly mime_type: Heygen4AudioMimeType; readonly size: number; readonly sha256: string;
  readonly container: "MP3" | "WAV" | "M4A"; readonly codec_name: string; readonly sample_rate: number;
  readonly channels: number; readonly duration_seconds: number; readonly metadata_confidence: "FFPROBE_METADATA_ONLY_NO_DECODE";
  readonly generation_permit: false; readonly owner_upload_binding: "NOT_ESTABLISHED"; readonly provider_acceptance: "UNPROVEN";
}

export interface OwnerHeygen4ImageRead { readonly bytes: Uint8Array; readonly filename: string; readonly mime_type: Heygen4ImageMimeType;
  readonly size: number; readonly sha256: string; readonly width: number; readonly height: number; }
export interface OwnerHeygen4AudioRead { readonly bytes: Uint8Array; readonly filename: string; readonly mime_type: Heygen4AudioMimeType;
  readonly size: number; readonly sha256: string; readonly duration_seconds: number; readonly container: "MP3" | "WAV" | "M4A"; }

export class OwnerHeygen4MediaPolicyError extends Error {
  constructor(readonly code: "INVALID_IMAGE" | "INVALID_AUDIO" | "LOCAL_LIMIT_EXCEEDED" | "AUDIO_DURATION_OUTSIDE_PUBLIC_BOUNDS" |
    "PROBE_FAILED" | "PROBE_ABORTED") {
    super("The HeyGen 4 image or audio input could not be safely validated."); this.name = "OwnerHeygen4MediaPolicyError";
  }
}

export function validateOwnerHeygen4Image(input: unknown): Readonly<ValidatedOwnerHeygen4Image> {
  const row = exact(input, ["filename", "mime_type", "bytes"]);
  if (typeof row.filename !== "string" || !safeFilename(row.filename) || typeof row.mime_type !== "string" ||
      !OWNER_HEYGEN4_MEDIA_POLICY.accepted_image_mime_types.includes(row.mime_type as Heygen4ImageMimeType) ||
      !isByteView(row.bytes)) invalidImage();
  const bytes = copyBytes(row.bytes);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_LOCAL_ASSET_BYTES) { bytes.fill(0); localLimit(); }
  try {
    const parsed = row.mime_type === "image/avif"
      ? inspectBoundedOwnerClarityAvifBytesWithMax(bytes, MAX_LOCAL_ASSET_BYTES)
      : inspectBoundedOwnerImageBytesWithMax(bytes, MAX_LOCAL_ASSET_BYTES);
    const mime = parsed.mime === "image/jpeg" && row.mime_type === "image/jpg" ? "image/jpg" : parsed.mime;
    if (mime !== row.mime_type || parsed.width < 1 || parsed.height < 1 || parsed.width > MAX_IMAGE_DIMENSION ||
        parsed.height > MAX_IMAGE_DIMENSION || parsed.width * parsed.height > MAX_IMAGE_PIXELS) invalidImage();
    const receipt: ValidatedOwnerHeygen4Image = Object.freeze({ status: "LOCAL_HEYGEN4_IMAGE_VALIDATED", model_id: MODEL_ID,
      filename: row.filename, mime_type: row.mime_type as Heygen4ImageMimeType, size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"), width: parsed.width, height: parsed.height,
      metadata_confidence: row.mime_type === "image/avif" ? "AVIF_PRIMARY_ITEM_PROPERTY_ASSOCIATION_ONLY" : "CONTAINER_METADATA_ONLY_NO_PIXEL_DECODE",
      generation_permit: false, owner_upload_binding: "NOT_ESTABLISHED", provider_acceptance: "UNPROVEN" });
    IMAGE_RECEIPTS.set(receipt, Object.freeze({ bytes: Buffer.from(bytes), fingerprint: fingerprint(receipt) }));
    return receipt;
  } catch (error) {
    if (error instanceof OwnerHeygen4MediaPolicyError) throw error;
    invalidImage();
  } finally { bytes.fill(0); }
}

export function createOwnerHeygen4AudioProbe(ffprobePath: string) {
  if (typeof ffprobePath !== "string" || !isAbsoluteCleanPath(ffprobePath)) throw new OwnerHeygen4MediaPolicyError("PROBE_FAILED");
  return Object.freeze({ validate: (input: unknown, signal?: AbortSignal) => validateAudio(ffprobePath, input, signal) });
}

export function isValidatedOwnerHeygen4Image(value: unknown): value is Readonly<ValidatedOwnerHeygen4Image> {
  return trustedReceipt(value, IMAGE_RECEIPTS);
}
export function isValidatedOwnerHeygen4Audio(value: unknown): value is Readonly<ValidatedOwnerHeygen4Audio> {
  return trustedReceipt(value, AUDIO_RECEIPTS);
}
export function readValidatedOwnerHeygen4Image(value: unknown): Readonly<OwnerHeygen4ImageRead> | null {
  if (!isValidatedOwnerHeygen4Image(value)) return null;
  const state = IMAGE_RECEIPTS.get(value); if (!state) return null;
  return Object.freeze({ bytes: new Uint8Array(state.bytes), filename: value.filename, mime_type: value.mime_type,
    size: value.size, sha256: value.sha256, width: value.width, height: value.height });
}
export function readValidatedOwnerHeygen4Audio(value: unknown): Readonly<OwnerHeygen4AudioRead> | null {
  if (!isValidatedOwnerHeygen4Audio(value)) return null;
  const state = AUDIO_RECEIPTS.get(value); if (!state) return null;
  return Object.freeze({ bytes: new Uint8Array(state.bytes), filename: value.filename, mime_type: value.mime_type,
    size: value.size, sha256: value.sha256, duration_seconds: value.duration_seconds, container: value.container });
}
export function releaseValidatedOwnerHeygen4Image(value: unknown): boolean { return release(value, IMAGE_RECEIPTS); }
export function releaseValidatedOwnerHeygen4Audio(value: unknown): boolean { return release(value, AUDIO_RECEIPTS); }

async function validateAudio(ffprobePath: string, input: unknown, signal?: AbortSignal): Promise<Readonly<ValidatedOwnerHeygen4Audio>> {
  const row = exact(input, ["filename", "mime_type", "bytes"]);
  if (typeof row.filename !== "string" || !safeFilename(row.filename) || typeof row.mime_type !== "string" ||
      !Object.hasOwn(MIME_EXTENSIONS, row.mime_type) || !MIME_EXTENSIONS[row.mime_type as Heygen4AudioMimeType].includes(extname(row.filename).toLowerCase()) ||
      !isByteView(row.bytes)) invalidAudio();
  const bytes = copyBytes(row.bytes);
  if (bytes.byteLength < 16 || bytes.byteLength > MAX_LOCAL_ASSET_BYTES) { bytes.fill(0); localLimit(); }
  if (signal !== undefined && !isAbortSignal(signal)) { bytes.fill(0); invalidAudio(); }
  const container = AUDIO_FORMAT_HINT[row.mime_type as Heygen4AudioMimeType];
  const detectedContainer = detectAudioContainer(bytes);
  const containerMatches = container === "mp3" ? detectedContainer === "MP3" : container === "wav" ? detectedContainer === "WAV" :
    container === "m4a" ? detectedContainer === "M4A" : container === "mp4" && detectedContainer === "M4A";
  if (!containerMatches || !detectedContainer) { bytes.fill(0); invalidAudio(); }
  const digest = createHash("sha256").update(bytes).digest("hex");
  let directory: string | undefined, inputPath: string | undefined, created = false;
  try {
    if (signal?.aborted) throw new OwnerHeygen4MediaPolicyError("PROBE_ABORTED");
    directory = await mkdtemp(join(tmpdir(), TEMP_PREFIX)); await chmod(directory, 0o700);
    inputPath = join(directory, `source${extname(row.filename).toLowerCase()}`);
    const file = await open(inputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    created = true;
    try { await file.chmod(0o600); await file.writeFile(bytes); await file.sync(); const info = await file.stat();
      if (!info.isFile() || info.size !== bytes.byteLength) invalidAudio(); }
    finally { await file.close(); }
    const metadata = parseAudioProbe(await runFfprobe(ffprobePath, inputPath, signal), detectedContainer);
    if (metadata.duration_seconds < MIN_AUDIO_DURATION || metadata.duration_seconds > MAX_AUDIO_DURATION) {
      throw new OwnerHeygen4MediaPolicyError("AUDIO_DURATION_OUTSIDE_PUBLIC_BOUNDS");
    }
    const after = await lstat(inputPath);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== bytes.byteLength) invalidAudio();
    const receipt: ValidatedOwnerHeygen4Audio = Object.freeze({ status: "LOCAL_HEYGEN4_AUDIO_VALIDATED", model_id: MODEL_ID,
      filename: row.filename, mime_type: row.mime_type as Heygen4AudioMimeType, size: bytes.byteLength, sha256: digest,
      container: detectedContainer, codec_name: metadata.codec_name, sample_rate: metadata.sample_rate, channels: metadata.channels,
      duration_seconds: metadata.duration_seconds, metadata_confidence: "FFPROBE_METADATA_ONLY_NO_DECODE",
      generation_permit: false, owner_upload_binding: "NOT_ESTABLISHED", provider_acceptance: "UNPROVEN" });
    AUDIO_RECEIPTS.set(receipt, Object.freeze({ bytes: Buffer.from(bytes), fingerprint: fingerprint(receipt) }));
    return receipt;
  } catch (error) {
    if (error instanceof OwnerHeygen4MediaPolicyError) throw error;
    if (signal?.aborted) throw new OwnerHeygen4MediaPolicyError("PROBE_ABORTED");
    throw new OwnerHeygen4MediaPolicyError("PROBE_FAILED");
  } finally {
    bytes.fill(0);
    let cleanupFailed = false;
    if (created && inputPath) { try { await wipeAndUnlink(inputPath); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; } }
    if (directory) { try { await rmdir(directory); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; } }
    if (cleanupFailed) throw new OwnerHeygen4MediaPolicyError("PROBE_FAILED");
  }
}

interface AudioMetadata { readonly duration_seconds: number; readonly codec_name: string; readonly sample_rate: number; readonly channels: number; }
function parseAudioProbe(text: string, container: "MP3" | "WAV" | "M4A"): AudioMetadata {
  let root: unknown; try { root = JSON.parse(text); } catch { return invalidAudio(); }
  if (!isRecord(root) || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > MAX_AUDIO_STREAMS || !isRecord(root.format)) invalidAudio();
  const streams = root.streams as unknown[];
  const audio = streams.filter((stream) => isRecord(stream) && stream.codec_type === "audio");
  if (audio.length !== 1 || streams.some((stream) => !isRecord(stream) || stream.codec_type !== "audio")) invalidAudio();
  const stream = audio[0] as Record<string, unknown>;
  if (typeof stream.codec_name !== "string" || !/^[a-z0-9_+-]{1,64}$/iu.test(stream.codec_name)) invalidAudio();
  const sampleRate = positiveInteger(stream.sample_rate), channels = positiveInteger(stream.channels);
  const duration = finitePositive(stream.duration) ?? finitePositive(root.format.duration);
  const formatName = typeof root.format.format_name === "string" ? root.format.format_name.split(",") : [];
  const allowedFormats = container === "MP3" ? ["mp3"] : container === "WAV" ? ["wav"] : ["m4a", "mov", "mp4"];
  if (!sampleRate || !channels || duration === undefined || !formatName.some((name) => allowedFormats.includes(name))) invalidAudio();
  return Object.freeze({ duration_seconds: duration, codec_name: stream.codec_name, sample_rate: sampleRate, channels });
}

function runFfprobe(ffprobePath: string, path: string, signal?: AbortSignal): Promise<string> {
  const options: ExecFileOptionsWithStringEncoding = { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL",
    maxBuffer: MAX_STDOUT_BYTES, windowsHide: true, ...(signal ? { signal } : {}),
    env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" } };
  const args = ["-v", "error", "-show_entries",
    "stream=codec_type,codec_name,sample_rate,channels,duration:format=duration,format_name", "-of", "json", path];
  return new Promise((resolve, reject) => {
    let callbackDone = false, closed = false, spawnFailed = false, settled = false;
    let callbackError: Error | null = null, output: string | undefined, closeCode: number | null = null, closeSignal: NodeJS.Signals | null = null;
    const settle = () => {
      if (settled || !callbackDone || (!closed && !spawnFailed)) return;
      settled = true;
      if (callbackError) { reject(callbackError); return; }
      if (closeCode !== 0 || closeSignal !== null || output === undefined) { reject(new Error("ffprobe failed")); return; }
      resolve(output);
    };
    try {
      const child = execFileCallback(ffprobePath, args, options, (error, stdout) => {
        callbackDone = true; callbackError = error; output = typeof stdout === "string" ? stdout : undefined; settle();
      });
      child.once("error", (error) => { if (child.pid === undefined) { spawnFailed = true; callbackDone = true; } callbackError ??= error; settle(); });
      child.once("close", (code, reason) => { closed = true; closeCode = code; closeSignal = reason; settle(); });
    } catch (error) { reject(error instanceof Error ? error : new Error("ffprobe failed")); }
  });
}

function detectAudioContainer(bytes: Uint8Array): "MP3" | "WAV" | "M4A" | undefined {
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return "WAV";
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === "ID3") return "MP3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "MP3";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") return "M4A";
  return undefined;
}
function isByteView(value: unknown): value is Uint8Array {
  return !!value && typeof value === "object" && !types.isProxy(value) && value instanceof Uint8Array &&
    (Buffer.isBuffer(value) || Object.getPrototypeOf(value) === Uint8Array.prototype) &&
    !Object.hasOwn(value, "buffer") && !Object.hasOwn(value, "byteLength") && !Object.hasOwn(value, "byteOffset") && !Object.hasOwn(value, "length");
}
function copyBytes(value: Uint8Array): Buffer {
  let length: number; try { if (!BYTE_LENGTH_GETTER) invalidAudio(); length = BYTE_LENGTH_GETTER.call(value) as number; } catch { return invalidAudio(); }
  const result = Buffer.allocUnsafe(length); try { Uint8Array.prototype.set.call(result, value); return result; } catch { result.fill(0); return invalidAudio(); }
}
function exact(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalidAudio();
  let descriptors: PropertyDescriptorMap; try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return invalidAudio(); }
  const actual = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) return invalidAudio();
  const result = Object.create(null) as Record<string, unknown>; for (const key of actual as string[]) result[key] = descriptors[key]!.value; return result;
}
function safeFilename(value: string): boolean { return value === value.trim() && value.length > 0 && value !== "." && value !== ".." &&
  Buffer.byteLength(value, "utf8") <= 255 && !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value); }
function isAbsoluteCleanPath(value: string): boolean { return value === value.trim() && value.startsWith("/") && !value.includes("\0"); }
function positiveInteger(value: unknown): number | undefined { if (typeof value === "string" && /^\d+$/u.test(value)) value = Number(value); return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined; }
function finitePositive(value: unknown): number | undefined { if (typeof value === "string" && value.trim()) value = Number(value); return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined; }
function ascii(bytes: Uint8Array, offset: number, length: number): string { return Buffer.from(bytes.buffer, bytes.byteOffset + offset, length).toString("ascii"); }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function fingerprint(value: object): string { return createHash("sha256").update(Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).map((key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)!; return `${String(key)}:${descriptor.enumerable}:${descriptor.configurable}:${descriptor.writable}:${String(descriptor.value)}`;
}).join("\n")).digest("hex"); }
function trustedReceipt<T extends object>(value: unknown, records: WeakMap<object, Readonly<{ bytes: Buffer; fingerprint: string }>>): value is Readonly<T> {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
  const state = records.get(value); return !!state && fingerprint(value) === state.fingerprint;
}
function release<T extends object>(value: unknown, records: WeakMap<object, Readonly<{ bytes: Buffer; fingerprint: string }>>): boolean {
  if (!trustedReceipt<T>(value, records)) return false; const state = records.get(value as object)!; state.bytes.fill(0); return records.delete(value as object);
}
async function wipeAndUnlink(path: string): Promise<void> {
  const file = await open(path, fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat(); if (!info.isFile() || info.size > MAX_LOCAL_ASSET_BYTES) invalidAudio();
    const zeros = Buffer.alloc(Math.min(64 * 1024, Math.max(1, info.size)));
    for (let offset = 0; offset < info.size; offset += zeros.length) await file.write(zeros, 0, Math.min(zeros.length, info.size - offset), offset);
    zeros.fill(0); await file.sync();
  } finally { await file.close(); }
  await unlink(path);
}
function isMissingFile(error: unknown): boolean { return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT"; }
function isAbortSignal(value: unknown): value is AbortSignal { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === AbortSignal.prototype; }
function invalidImage(): never { throw new OwnerHeygen4MediaPolicyError("INVALID_IMAGE"); }
function invalidAudio(): never { throw new OwnerHeygen4MediaPolicyError("INVALID_AUDIO"); }
function localLimit(): never { throw new OwnerHeygen4MediaPolicyError("LOCAL_LIMIT_EXCEEDED"); }
