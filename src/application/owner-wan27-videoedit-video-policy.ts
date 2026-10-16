import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, accessSync, lstatSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdtemp, open, readFile, realpath, rmdir, unlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { types } from "node:util";

const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const MIME_TYPES = Object.freeze(["video/mp4", "video/quicktime"] as const);
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const DEFAULT_LOCAL_MAX_BYTES = 64 * 1024 * 1024;
const MIN_LOCAL_MAX_BYTES = 1;
const MIN_SIDE = 240;
const MAX_SIDE = 4096;
const MIN_DURATION_SECONDS = 2;
const MAX_DURATION_SECONDS = 10;
const MAX_STREAMS = 32;
const MAX_STDOUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const ACCEPTED_FORMATS = new Set(["mov,mp4,m4a,3gp,3g2,mj2"]);
const MP4_MAJOR_BRAND = /^(?:isom|iso[2-9][a-z0-9]?|mp4[12]|avc1|M4V |MSNV|dash|cmfc|cmfs)$/u;
const QUICKTIME_MAJOR_BRAND = "qt  ";
const TEMP_PREFIX = "syntx-wan27-videoedit-";
const BUFFER_PROTOTYPE = Buffer.prototype;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_SET = Uint8Array.prototype.set;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const currentUid = (): number | null => typeof process.getuid === "function" ? process.getuid() : null;
const CANONICAL_TEMP_ROOT = realpathSync(tmpdir());

export const OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY = Object.freeze({
  policy_id: "OWNER_WAN27_VIDEOEDIT_VIDEO_INPUT_POLICY_C19_V1",
  model_id: "wan_27_videoedit",
  source_catalog_version: CATALOG_VERSION,
  source_mime_types: MIME_TYPES,
  source_max_file_size_bytes: MAX_SOURCE_BYTES,
  local_default_max_file_size_bytes: DEFAULT_LOCAL_MAX_BYTES,
  local_configurable_max_file_size_bytes: Object.freeze({ min: MIN_LOCAL_MAX_BYTES, max: MAX_SOURCE_BYTES }),
  min_width: MIN_SIDE,
  max_width: MAX_SIDE,
  min_height: MIN_SIDE,
  max_height: MAX_SIDE,
  min_duration_seconds: MIN_DURATION_SECONDS,
  max_duration_seconds: MAX_DURATION_SECONDS,
  duration_scope: "ALREADY_TRIMMED_SINGLE_VIDEO_INPUT",
  aspect_ratio_limit: null,
  hdr_restriction: false,
  crop_performed: false,
  aggregate_duration_enforced_here: false,
  metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED",
  pixel_decode: false,
  generation_permit: false,
  upload_binding: "NOT_ESTABLISHED",
  provider_acceptance: "UNPROVEN"
} as const);

export type OwnerWan27VideoEditVideoMimeType = typeof MIME_TYPES[number];

export interface ValidatedOwnerWan27VideoEditVideo {
  readonly status: "TRUSTED_LOCAL_MEDIA_PROBE";
  readonly policy_id: typeof OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.policy_id;
  readonly model_id: "wan_27_videoedit";
  readonly source_catalog_version: typeof CATALOG_VERSION;
  readonly filename: string;
  readonly mime_type: OwnerWan27VideoEditVideoMimeType;
  readonly size: number;
  readonly source_sha256: string;
  readonly bytes_copied: number;
  readonly local_file_limit_bytes: number;
  readonly local_limit_kind: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT";
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly duration_source: "MAX_FINITE_AUDIO_VIDEO_TRACK_END_SECONDS";
  readonly crop_performed: false;
  readonly metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED";
  readonly pixel_decode: false;
  readonly generation_permit: false;
  readonly upload_binding: "NOT_ESTABLISHED";
  readonly provider_acceptance: "UNPROVEN";
}

export interface OwnerWan27VideoEditVideoRead {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerWan27VideoEditVideoMimeType;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly sha256: string;
}

export class OwnerWan27VideoEditVideoPolicyError extends Error {
  constructor(readonly code:
    | "INVALID_INPUT"
    | "LOCAL_RESOURCE_LIMIT_EXCEEDED"
    | "SOURCE_LIMIT_EXCEEDED"
    | "UNSUPPORTED_MEDIA_METADATA"
    | "LOCAL_RESOURCE_BUSY"
    | "PROBE_FAILED"
    | "PROBE_ABORTED") {
    super("The WAN 2.7 Video Edit input video could not be safely validated.");
    this.name = "OwnerWan27VideoEditVideoPolicyError";
  }
}

interface ParsedInput {
  readonly filename: string;
  readonly mime_type: OwnerWan27VideoEditVideoMimeType;
  readonly bytes: Uint8Array;
  readonly byte_length: number;
  readonly ffprobePath: string;
  readonly maxFileBytes: number;
}

interface TrackEndMetadata {
  readonly videoCodec: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
}

interface ReceiptState {
  readonly bytes: Buffer;
  readonly sourceSha256: string;
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>;
}

const RECEIPTS = new WeakMap<object, ReceiptState>();
let activeProbe = false;

/** Validates fresh local bytes for the first, already-trimmed WAN 2.7 Video Edit video slice. */
export async function validateOwnerWan27VideoEditVideo(
  input: unknown,
  signal?: AbortSignal
): Promise<Readonly<ValidatedOwnerWan27VideoEditVideo>> {
  const request = exactInput(input);
  const actualSignal = exactSignal(signal);
  if (isAborted(actualSignal)) aborted();
  if (!safeFilename(request.filename) || !matchesMimeAndExtension(request.filename, request.mime_type) ||
      !isOwnerByteView(request.bytes) || !hasMatchingBmffBrand(request.bytes, request.mime_type)) invalid();
  if (request.byte_length > MAX_SOURCE_BYTES) sourceLimit();
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
  let receipt: Readonly<ValidatedOwnerWan27VideoEditVideo> | undefined;
  try {
    if (isAborted(actualSignal)) aborted();
    source = copyInputBytes(request.bytes, request.byte_length);
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
    if (metadata.width < MIN_SIDE || metadata.width > MAX_SIDE || metadata.height < MIN_SIDE || metadata.height > MAX_SIDE ||
        metadata.durationSeconds < MIN_DURATION_SECONDS || metadata.durationSeconds > MAX_DURATION_SECONDS) sourceLimit();

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
      policy_id: OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.policy_id,
      model_id: "wan_27_videoedit" as const,
      source_catalog_version: CATALOG_VERSION,
      filename: request.filename,
      mime_type: request.mime_type,
      size: source.byteLength,
      source_sha256: sourceSha256,
      bytes_copied: source.byteLength,
      local_file_limit_bytes: request.maxFileBytes,
      local_limit_kind: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT" as const,
      width: metadata.width,
      height: metadata.height,
      duration_seconds: metadata.durationSeconds,
      duration_source: "MAX_FINITE_AUDIO_VIDEO_TRACK_END_SECONDS" as const,
      crop_performed: false as const,
      metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED" as const,
      pixel_decode: false as const,
      generation_permit: false as const,
      upload_binding: "NOT_ESTABLISHED" as const,
      provider_acceptance: "UNPROVEN" as const
    });
  } catch (error) {
    retainedBytes?.fill(0);
    if (error instanceof OwnerWan27VideoEditVideoPolicyError) throw error;
    if (isAborted(actualSignal)) aborted();
    throw new OwnerWan27VideoEditVideoPolicyError("PROBE_FAILED");
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
      throw new OwnerWan27VideoEditVideoPolicyError("PROBE_FAILED");
    }
  }

  if (!receipt || !retainedBytes) throw new OwnerWan27VideoEditVideoPolicyError("PROBE_FAILED");
  RECEIPTS.set(receipt, { bytes: retainedBytes, sourceSha256: receipt.source_sha256,
    descriptors: Object.getOwnPropertyDescriptors(receipt) });
  retainedBytes = undefined;
  return receipt;
}

/** True only for an unchanged frozen receipt minted here and still backed by its private byte copy. */
export function isValidatedOwnerWan27VideoEditVideo(value: unknown): value is Readonly<ValidatedOwnerWan27VideoEditVideo> {
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
  }) && record.model_id === "wan_27_videoedit" && record.policy_id === OWNER_WAN27_VIDEOEDIT_VIDEO_POLICY.policy_id &&
    record.source_catalog_version === CATALOG_VERSION && record.source_sha256 === state.sourceSha256 &&
    record.size === state.bytes.byteLength && sha256(state.bytes) === state.sourceSha256;
}

/** Returns a fresh caller-owned byte copy only while the original receipt remains genuine and unchanged. */
export function readValidatedOwnerWan27VideoEditVideo(value: unknown): Readonly<OwnerWan27VideoEditVideoRead> | null {
  if (!isValidatedOwnerWan27VideoEditVideo(value)) return null;
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
export function releaseValidatedOwnerWan27VideoEditVideo(value: unknown): boolean {
  if (!isPlainReceiptObject(value)) return false;
  const state = RECEIPTS.get(value);
  if (!state || !isValidatedOwnerWan27VideoEditVideo(value)) return false;
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
  const maxFileBytes = fields.maxFileBytes === undefined ? DEFAULT_LOCAL_MAX_BYTES : fields.maxFileBytes;
  if (typeof maxFileBytes !== "number" || !Number.isSafeInteger(maxFileBytes) ||
      maxFileBytes < MIN_LOCAL_MAX_BYTES || maxFileBytes > MAX_SOURCE_BYTES) invalid();
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
    if (error instanceof OwnerWan27VideoEditVideoPolicyError) throw error;
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

function hasMatchingBmffBrand(bytes: Uint8Array, mimeType: OwnerWan27VideoEditVideoMimeType): boolean {
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

function parseFfprobe(stdout: string): TrackEndMetadata {
  let root: unknown;
  try { root = JSON.parse(stdout); } catch { return unsupported(); }
  if (!isRecord(root) || !Array.isArray(root.streams) || types.isProxy(root.streams) || root.streams.length < 1 ||
      root.streams.length > MAX_STREAMS || !isRecord(root.format) || typeof root.format.format_name !== "string" ||
      !ACCEPTED_FORMATS.has(root.format.format_name)) return unsupported();
  const videoStreams: Record<string, unknown>[] = [];
  const trackEnds: number[] = [];
  for (const candidate of root.streams) {
    if (!isRecord(candidate) || typeof candidate.codec_type !== "string" || !/^[a-z0-9_+-]{1,24}$/iu.test(candidate.codec_type) ||
        typeof candidate.codec_name !== "string" || !/^[a-z0-9_+.-]{1,64}$/iu.test(candidate.codec_name)) return unsupported();
    const isVideo = candidate.codec_type === "video";
    const isAudio = candidate.codec_type === "audio";
    if (isVideo && candidate.disposition !== undefined && (!isRecord(candidate.disposition) ||
        (candidate.disposition.attached_pic !== undefined && candidate.disposition.attached_pic !== 0 && candidate.disposition.attached_pic !== 1))) return unsupported();
    if (isVideo && isRecord(candidate.disposition) && candidate.disposition.attached_pic === 1) continue;
    if (isVideo) videoStreams.push(candidate);
    if (isVideo || isAudio) {
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
  return { videoCodec: video.codec_name as string, width, height, durationSeconds };
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
  return typeof value === "number" && Number.isSafeInteger(value) && (allowNegative ? true : value >= 0) ? value : undefined;
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
  if (typeof value === "string" && /^[1-9][0-9]{0,7}$/u.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function runFfprobe(ffprobePath: string, inputPath: string, signal?: AbortSignal): Promise<string> {
  const args = ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
    "stream=codec_type,codec_name,width,height,start_time,start_pts,duration,duration_ts,time_base:stream_disposition=attached_pic:format=format_name",
    "-of", "json", inputPath];
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
    if (!info.isFile() || info.size > MAX_SOURCE_BYTES) invalid();
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
function invalid(): never { throw new OwnerWan27VideoEditVideoPolicyError("INVALID_INPUT"); }
function localLimit(): never { throw new OwnerWan27VideoEditVideoPolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
function sourceLimit(): never { throw new OwnerWan27VideoEditVideoPolicyError("SOURCE_LIMIT_EXCEEDED"); }
function unsupported(): never { throw new OwnerWan27VideoEditVideoPolicyError("UNSUPPORTED_MEDIA_METADATA"); }
function busy(): never { throw new OwnerWan27VideoEditVideoPolicyError("LOCAL_RESOURCE_BUSY"); }
function aborted(): never { throw new OwnerWan27VideoEditVideoPolicyError("PROBE_ABORTED"); }
