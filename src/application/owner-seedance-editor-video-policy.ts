import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, accessSync, lstatSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdtemp, open, readFile, realpath, rmdir, unlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { types } from "node:util";

const MIME_TYPES = Object.freeze(["video/mp4", "video/quicktime"] as const);
const MODEL_ID = "seedance-2.5-editor" as const;
const MIN_DURATION_SECONDS = 4;
const MAX_DURATION_SECONDS = 30;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MIN_LOCAL_MAX_BYTES = 1;
const MAX_STREAMS = 32;
const MAX_STDOUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const TEMP_PREFIX = "syntx-seedance-editor-video-";
const MP4_MAJOR_BRAND = /^(?:isom|iso[2-9][a-z0-9]?|mp4[12]|avc1|M4V |MSNV|dash|cmfc|cmfs)$/u;
const QUICKTIME_MAJOR_BRAND = "qt  ";
const BUFFER_PROTOTYPE = Buffer.prototype;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_SET = Uint8Array.prototype.set;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const currentUid = (): number | null => typeof process.getuid === "function" ? process.getuid() : null;
const CANONICAL_TEMP_ROOT = realpathSync(tmpdir());

export const OWNER_SEEDANCE_EDITOR_VIDEO_POLICY = Object.freeze({
  policy_id: "OWNER_SEEDANCE_EDITOR_VIDEO_INPUT_POLICY_LOCAL_CONSERVATIVE_V1",
  model_id: MODEL_ID,
  source_mime_types: MIME_TYPES,
  local_max_file_size_bytes: MAX_FILE_BYTES,
  local_file_size_bound: "LOCAL_CONSERVATIVE_BOUND",
  min_duration_seconds: MIN_DURATION_SECONDS,
  max_duration_seconds: MAX_DURATION_SECONDS,
  duration_source: "BOUNDED_FFPROBE_METADATA_ONLY",
  metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED",
  pixel_decode: false,
  generation_permit: false,
  provider_acceptance: "UNPROVEN"
} as const);

export type OwnerSeedanceEditorVideoMimeType = typeof MIME_TYPES[number];

export interface ValidatedOwnerSeedanceEditorVideo {
  readonly status: "TRUSTED_LOCAL_MEDIA_PROBE";
  readonly policy_id: typeof OWNER_SEEDANCE_EDITOR_VIDEO_POLICY.policy_id;
  readonly model_id: typeof MODEL_ID;
  readonly filename: string;
  readonly mime_type: OwnerSeedanceEditorVideoMimeType;
  readonly size: number;
  readonly source_sha256: string;
  readonly local_file_limit_bytes: number;
  readonly local_limit_kind: "LOCAL_CONSERVATIVE_BOUND";
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly duration_source: "BOUNDED_FFPROBE_METADATA_ONLY";
  readonly metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED";
  readonly pixel_decode: false;
  readonly generation_permit: false;
  readonly provider_acceptance: "UNPROVEN";
}

export interface OwnerSeedanceEditorVideoRead {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerSeedanceEditorVideoMimeType;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly sha256: string;
}

export class OwnerSeedanceEditorVideoPolicyError extends Error {
  constructor(readonly code:
    | "INVALID_INPUT"
    | "LOCAL_RESOURCE_LIMIT_EXCEEDED"
    | "SOURCE_LIMIT_EXCEEDED"
    | "UNSUPPORTED_MEDIA_METADATA"
    | "LOCAL_RESOURCE_BUSY"
    | "PROBE_FAILED"
    | "PROBE_ABORTED") {
    super("The Seedance Editor input video could not be safely validated.");
    this.name = "OwnerSeedanceEditorVideoPolicyError";
  }
}

interface ParsedInput {
  readonly filename: string;
  readonly mime_type: OwnerSeedanceEditorVideoMimeType;
  readonly bytes: Uint8Array;
  readonly byte_length: number;
  readonly ffprobePath: string;
  readonly maxFileBytes: number;
}

interface Metadata { readonly width: number; readonly height: number; readonly durationSeconds: number }
interface ReceiptState {
  readonly bytes: Buffer;
  readonly sourceSha256: string;
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>;
}

const RECEIPTS = new WeakMap<object, ReceiptState>();
let activeProbe = false;

/** Validates fresh local bytes for the no-frame Seedance Editor source-video path. */
export async function validateOwnerSeedanceEditorVideo(
  input: unknown,
  signal?: AbortSignal
): Promise<Readonly<ValidatedOwnerSeedanceEditorVideo>> {
  const request = exactInput(input);
  const actualSignal = exactSignal(signal);
  if (isAborted(actualSignal)) aborted();
  if (!safeFilename(request.filename) || !matchesMimeAndExtension(request.filename, request.mime_type) ||
      !isOwnerByteView(request.bytes)) invalid();
  if (request.byte_length > MAX_FILE_BYTES) sourceLimit();
  if (request.byte_length > request.maxFileBytes) localLimit();
  if (!isSafeAbsoluteExecutable(request.ffprobePath)) invalid();
  if (activeProbe) busy();
  activeProbe = true;

  let source: Buffer | undefined;
  let retainedBytes: Buffer | undefined;
  let directory: string | undefined;
  let inputPath: string | undefined;
  let createdFile = false;
  let cleanupFailed = false;
  let receipt: Readonly<ValidatedOwnerSeedanceEditorVideo> | undefined;
  try {
    if (isAborted(actualSignal)) aborted();
    source = copyInputBytes(request.bytes, request.byte_length);
    if (!hasMatchingBmffBrand(source, request.mime_type)) invalid();
    const sourceSha256 = sha256(source);
    directory = await mkdtemp(join(CANONICAL_TEMP_ROOT, TEMP_PREFIX));
    await chmod(directory, 0o700);
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o777) !== 0o700 ||
        await realpath(directory) !== directory || (currentUid() !== null && directoryInfo.uid !== currentUid())) invalid();

    inputPath = join(directory, `input${request.mime_type === "video/mp4" ? ".mp4" : ".mov"}`);
    const file = await open(inputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    createdFile = true;
    try {
      await file.chmod(0o600);
      await file.writeFile(source);
      await file.sync();
      const info = await file.stat();
      if (!info.isFile() || info.size !== source.byteLength || (info.mode & 0o777) !== 0o600 ||
          info.nlink !== 1 || (currentUid() !== null && info.uid !== currentUid())) invalid();
    } finally { await file.close(); }

    const probeOutput = await runFfprobe(request.ffprobePath, inputPath, actualSignal);
    if (isAborted(actualSignal)) aborted();
    const metadata = parseFfprobe(probeOutput);
    if (metadata.durationSeconds < MIN_DURATION_SECONDS || metadata.durationSeconds > MAX_DURATION_SECONDS) sourceLimit();

    const afterProbe = await lstat(inputPath);
    if (!afterProbe.isFile() || afterProbe.isSymbolicLink() || afterProbe.size !== source.byteLength ||
        (afterProbe.mode & 0o777) !== 0o600 || afterProbe.nlink !== 1 ||
        (currentUid() !== null && afterProbe.uid !== currentUid()) || await realpath(inputPath) !== inputPath) invalid();
    const afterBytes = await readFile(inputPath);
    try { if (sha256(afterBytes) !== sourceSha256) invalid(); }
    finally { afterBytes.fill(0); }

    retainedBytes = Buffer.from(source);
    receipt = Object.freeze({
      status: "TRUSTED_LOCAL_MEDIA_PROBE" as const,
      policy_id: OWNER_SEEDANCE_EDITOR_VIDEO_POLICY.policy_id,
      model_id: MODEL_ID,
      filename: request.filename,
      mime_type: request.mime_type,
      size: source.byteLength,
      source_sha256: sourceSha256,
      local_file_limit_bytes: request.maxFileBytes,
      local_limit_kind: "LOCAL_CONSERVATIVE_BOUND" as const,
      width: metadata.width,
      height: metadata.height,
      duration_seconds: metadata.durationSeconds,
      duration_source: "BOUNDED_FFPROBE_METADATA_ONLY" as const,
      metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED" as const,
      pixel_decode: false as const,
      generation_permit: false as const,
      provider_acceptance: "UNPROVEN" as const
    });
  } catch (error) {
    retainedBytes?.fill(0);
    if (error instanceof OwnerSeedanceEditorVideoPolicyError) throw error;
    if (isAborted(actualSignal)) aborted();
    throw new OwnerSeedanceEditorVideoPolicyError("PROBE_FAILED");
  } finally {
    source?.fill(0);
    if (createdFile && inputPath) {
      try { await wipeAndUnlink(inputPath); }
      catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    if (directory) {
      try { await rmdir(directory); }
      catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    activeProbe = false;
    if (cleanupFailed) {
      retainedBytes?.fill(0);
      throw new OwnerSeedanceEditorVideoPolicyError("PROBE_FAILED");
    }
  }

  if (!receipt || !retainedBytes) throw new OwnerSeedanceEditorVideoPolicyError("PROBE_FAILED");
  RECEIPTS.set(receipt, { bytes: retainedBytes, sourceSha256: receipt.source_sha256,
    descriptors: Object.getOwnPropertyDescriptors(receipt) });
  retainedBytes = undefined;
  return receipt;
}

/** True only for a frozen receipt minted here and still backed by its private byte copy. */
export function isValidatedOwnerSeedanceEditorVideo(value: unknown): value is Readonly<ValidatedOwnerSeedanceEditorVideo> {
  if (!isPlainReceiptObject(value) || !Object.isFrozen(value)) return false;
  const state = RECEIPTS.get(value);
  if (!state) return false;
  const actual = Object.getOwnPropertyDescriptors(value);
  const actualKeys = Reflect.ownKeys(actual);
  const expectedKeys = Reflect.ownKeys(state.descriptors);
  const record = value as Record<string, unknown>;
  return actualKeys.length === expectedKeys.length && actualKeys.every((key) => {
    const current = actual[key as keyof typeof actual];
    const original = state.descriptors[key as keyof typeof state.descriptors];
    return current !== undefined && original !== undefined && Object.hasOwn(current, "value") &&
      current.enumerable === original.enumerable && current.configurable === false && current.writable === false &&
      current.value === original.value;
  }) && record.model_id === MODEL_ID && record.policy_id === OWNER_SEEDANCE_EDITOR_VIDEO_POLICY.policy_id &&
    record.source_sha256 === state.sourceSha256 && record.size === state.bytes.byteLength && sha256(state.bytes) === state.sourceSha256;
}

/** Returns a fresh caller-owned byte copy while the original receipt remains genuine and unchanged. */
export function readValidatedOwnerSeedanceEditorVideo(value: unknown): Readonly<OwnerSeedanceEditorVideoRead> | null {
  if (!isValidatedOwnerSeedanceEditorVideo(value)) return null;
  const state = RECEIPTS.get(value);
  if (!state) return null;
  return Object.freeze({
    bytes: new Uint8Array(state.bytes),
    filename: value.filename,
    mime_type: value.mime_type,
    size: value.size,
    width: value.width,
    height: value.height,
    duration_seconds: value.duration_seconds,
    sha256: state.sourceSha256
  });
}

/** Wipes and revokes only this policy's private owned-byte snapshot. */
export function releaseValidatedOwnerSeedanceEditorVideo(value: unknown): boolean {
  if (!isPlainReceiptObject(value)) return false;
  const state = RECEIPTS.get(value);
  if (!state || !isValidatedOwnerSeedanceEditorVideo(value)) return false;
  state.bytes.fill(0);
  return RECEIPTS.delete(value);
}

function exactInput(value: unknown): ParsedInput {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  const required = ["filename", "mime_type", "bytes", "ffprobePath"];
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || keys.length < required.length ||
      keys.length > required.length + 1 || keys.some((key) => typeof key !== "string" ||
        (!required.includes(key) && key !== "maxFileBytes") || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) invalid();
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) fields[key] = descriptors[key]!.value;
  if (typeof fields.filename !== "string" || typeof fields.mime_type !== "string" || typeof fields.ffprobePath !== "string" ||
      !isOwnerByteView(fields.bytes)) invalid();
  if (fields.mime_type !== "video/mp4" && fields.mime_type !== "video/quicktime") invalid();
  const byteLength = intrinsicByteLength(fields.bytes);
  const maxFileBytes = fields.maxFileBytes === undefined ? MAX_FILE_BYTES : fields.maxFileBytes;
  if (typeof maxFileBytes !== "number" || !Number.isSafeInteger(maxFileBytes) ||
      maxFileBytes < MIN_LOCAL_MAX_BYTES || maxFileBytes > MAX_FILE_BYTES) invalid();
  if (!isSafeAbsoluteExecutable(fields.ffprobePath)) invalid();
  return { filename: fields.filename, mime_type: fields.mime_type, bytes: fields.bytes, byte_length: byteLength,
    ffprobePath: fields.ffprobePath, maxFileBytes };
}

function exactSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || Object.getPrototypeOf(signal) !== AbortSignal.prototype) invalid();
  return signal;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  if (!signal) return false;
  if (!ABORTED_GETTER) invalid();
  try { return Reflect.apply(ABORTED_GETTER, signal, []) as boolean; }
  catch { return invalid(); }
}

function isOwnerByteView(value: unknown): value is Uint8Array {
  if (!value || typeof value !== "object" || types.isProxy(value) || !ArrayBuffer.isView(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (Buffer.isBuffer(value) ? prototype !== BUFFER_PROTOTYPE : prototype !== Uint8Array.prototype) return false;
  if (Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") ||
      Object.hasOwn(value, "length") || !TYPED_ARRAY_BUFFER || !TYPED_ARRAY_BYTE_LENGTH) return false;
  try {
    const backing = Reflect.apply(TYPED_ARRAY_BUFFER, value, []) as ArrayBufferLike;
    return !types.isSharedArrayBuffer(backing) && intrinsicByteLength(value) >= 0;
  } catch { return false; }
}

function intrinsicByteLength(value: object): number {
  if (!TYPED_ARRAY_BYTE_LENGTH) invalid();
  try {
    const length = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, value, []) as number;
    if (!Number.isSafeInteger(length) || length < 0) invalid();
    return length;
  } catch { return invalid(); }
}

function copyInputBytes(value: Uint8Array, length: number): Buffer {
  const copy = Buffer.alloc(length);
  try {
    Reflect.apply(TYPED_ARRAY_SET, copy, [value]);
    if (copy.byteLength !== length) invalid();
    return copy;
  } catch (error) {
    copy.fill(0);
    if (error instanceof OwnerSeedanceEditorVideoPolicyError) throw error;
    invalid();
  }
}

function matchesMimeAndExtension(filename: string, mimeType: string): boolean {
  const extension = extname(filename).toLowerCase();
  return mimeType === "video/mp4" ? extension === ".mp4" : mimeType === "video/quicktime" && extension === ".mov";
}

function safeFilename(filename: string): boolean {
  return filename.length > 0 && Buffer.byteLength(filename, "utf8") <= 255 && filename === basename(filename) &&
    filename !== "." && filename !== ".." && !filename.includes("/") && !filename.includes("\\") &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(filename) && !/[. ]$/u.test(filename) && isWellFormedUnicode(filename);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function hasMatchingBmffBrand(bytes: Uint8Array, mimeType: OwnerSeedanceEditorVideoMimeType): boolean {
  if (bytes.byteLength < 16 || ascii(bytes, 4, 4) !== "ftyp") return false;
  const boxSize = readU32(bytes, 0);
  if (boxSize < 16 || boxSize > bytes.byteLength || (boxSize - 16) % 4 !== 0) return false;
  const majorBrand = ascii(bytes, 8, 4);
  return mimeType === "video/quicktime" ? majorBrand === QUICKTIME_MAJOR_BRAND : MP4_MAJOR_BRAND.test(majorBrand);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x1000000 + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]!);
  return value;
}

function parseFfprobe(stdout: string): Metadata {
  let root: unknown;
  try { root = JSON.parse(stdout); } catch { return unsupported(); }
  if (!isRecord(root) || !Array.isArray(root.streams) || types.isProxy(root.streams) || root.streams.length < 1 ||
      root.streams.length > MAX_STREAMS) return unsupported();
  const videoStreams: Record<string, unknown>[] = [];
  const trackEnds: number[] = [];
  for (const candidate of root.streams) {
    if (!isRecord(candidate) || typeof candidate.codec_type !== "string" || !/^[a-z0-9_+-]{1,24}$/iu.test(candidate.codec_type)) return unsupported();
    if (candidate.codec_type === "video") {
      if (candidate.disposition !== undefined && (!isRecord(candidate.disposition) ||
          (candidate.disposition.attached_pic !== undefined && candidate.disposition.attached_pic !== 0 && candidate.disposition.attached_pic !== 1))) return unsupported();
      if (isRecord(candidate.disposition) && candidate.disposition.attached_pic === 1) continue;
      videoStreams.push(candidate);
    }
    if (candidate.codec_type === "video" || candidate.codec_type === "audio") {
      const end = finalTrackEndSeconds(candidate);
      if (end === undefined) return unsupported();
      trackEnds.push(end);
    }
  }
  if (videoStreams.length !== 1 || trackEnds.length === 0) return unsupported();
  const video = videoStreams[0]!;
  const width = positiveInteger(video.width), height = positiveInteger(video.height);
  if (width === undefined || height === undefined) return unsupported();
  const durationSeconds = Math.max(...trackEnds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return unsupported();
  return { width, height, durationSeconds };
}

function finalTrackEndSeconds(stream: Record<string, unknown>): number | undefined {
  const timeBase = parseTimeBase(stream.time_base);
  if (!timeBase) return undefined;
  const startFromPts = integerValue(stream.start_pts, true);
  const startFromSeconds = finiteNumber(stream.start_time);
  if (startFromPts === undefined && startFromSeconds === undefined) return undefined;
  const start = startFromPts === undefined ? startFromSeconds! : startFromPts * timeBase;
  if (!Number.isFinite(start)) return undefined;
  if (startFromSeconds !== undefined && Math.abs(startFromSeconds - start) > timeBase + 0.000001) return undefined;

  const durationFromTicks = integerValue(stream.duration_ts, false);
  const durationFromSeconds = finitePositive(stream.duration);
  if (durationFromTicks === undefined && durationFromSeconds === undefined) return undefined;
  const duration = durationFromTicks === undefined ? durationFromSeconds! : durationFromTicks * timeBase;
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  if (durationFromSeconds !== undefined && Math.abs(durationFromSeconds - duration) > timeBase + 0.000001) return undefined;
  const end = start + duration;
  return Number.isFinite(end) && end > 0 ? end : undefined;
}

function parseTimeBase(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^([1-9][0-9]{0,15})\/([1-9][0-9]{0,15})$/u.exec(value);
  if (!match) return undefined;
  const numerator = Number(match[1]), denominator = Number(match[2]);
  const result = numerator / denominator;
  return Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && Number.isFinite(result) && result > 0 ? result : undefined;
}

function integerValue(value: unknown, allowNegative: boolean): number | undefined {
  if (typeof value === "string" && (allowNegative ? /^-?(?:0|[1-9][0-9]{0,15})$/u : /^(?:0|[1-9][0-9]{0,15})$/u).test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && (allowNegative || value >= 0) ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finitePositive(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function runFfprobe(ffprobePath: string, inputPath: string, signal?: AbortSignal): Promise<string> {
  const args = ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
    "stream=codec_type,width,height,start_time,start_pts,duration,duration_ts,time_base:stream_disposition=attached_pic", "-of", "json", inputPath];
  const options: ExecFileOptionsWithStringEncoding = {
    encoding: "utf8", timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: MAX_STDOUT_BYTES,
    windowsHide: true, shell: false, ...(signal === undefined ? {} : { signal }),
    env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" }
  };
  return new Promise((resolveOutput, rejectOutput) => {
    let callbackDone = false, closed = false, spawnFailed = false, settled = false;
    let callbackError: Error | null = null, stdout: string | undefined;
    let closeCode: number | null = null, closeSignal: NodeJS.Signals | null = null;
    const settle = () => {
      if (settled || !callbackDone || (!closed && !spawnFailed)) return;
      settled = true;
      if (callbackError) { rejectOutput(callbackError); return; }
      if (closeCode !== 0 || closeSignal !== null || stdout === undefined) { rejectOutput(new Error("ffprobe did not exit successfully.")); return; }
      resolveOutput(stdout);
    };
    try {
      const child = execFileCallback(ffprobePath, args, options, (error, output) => {
        callbackDone = true;
        callbackError = error;
        stdout = typeof output === "string" ? output : undefined;
        settle();
      });
      let spawned = false;
      child.once("spawn", () => { spawned = true; });
      child.once("error", (error) => {
        if (!spawned) { spawnFailed = true; callbackDone = true; }
        callbackError ??= error;
        settle();
      });
      child.once("close", (code, reason) => { closed = true; closeCode = code; closeSignal = reason; settle(); });
    } catch (error) { rejectOutput(error instanceof Error ? error : new Error("ffprobe could not start.")); }
  });
}

async function wipeAndUnlink(path: string): Promise<void> {
  let file: FileHandle;
  try { file = await open(path, fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    try { await unlink(path); } catch (cleanupError) { if (!isMissingFile(cleanupError)) throw cleanupError; }
    throw error;
  }
  let wipeError: unknown;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES) invalid();
    const zeros = Buffer.alloc(64 * 1024);
    for (let offset = 0; offset < info.size; offset += zeros.byteLength) {
      await file.write(zeros, 0, Math.min(zeros.byteLength, info.size - offset), offset);
    }
    zeros.fill(0);
    await file.sync();
  } catch (error) { wipeError = error; }
  finally { await file.close(); }
  await unlink(path);
  if (wipeError !== undefined) throw wipeError;
}

function isSafeAbsoluteExecutable(path: string): boolean {
  if (!isAbsolute(path) || path !== path.trim() || path.includes("\0") || resolve(path) !== path || basename(path) === "") return false;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0 || realpathSync(path) !== path) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch { return false; }
}

function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function isPlainReceiptObject(value: unknown): value is object {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isMissingFile(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"); }
function invalid(): never { throw new OwnerSeedanceEditorVideoPolicyError("INVALID_INPUT"); }
function localLimit(): never { throw new OwnerSeedanceEditorVideoPolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
function sourceLimit(): never { throw new OwnerSeedanceEditorVideoPolicyError("SOURCE_LIMIT_EXCEEDED"); }
function unsupported(): never { throw new OwnerSeedanceEditorVideoPolicyError("UNSUPPORTED_MEDIA_METADATA"); }
function busy(): never { throw new OwnerSeedanceEditorVideoPolicyError("LOCAL_RESOURCE_BUSY"); }
function aborted(): never { throw new OwnerSeedanceEditorVideoPolicyError("PROBE_ABORTED"); }
