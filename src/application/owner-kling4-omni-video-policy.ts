import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, accessSync, lstatSync } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { types } from "node:util";

const SOURCE_CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const DEFAULT_LOCAL_MAX_FILE_BYTES = 64 * 1024 * 1024;
const MIN_LOCAL_MAX_FILE_BYTES = 1;
const MIN_SIDE = 700;
const MAX_SIDE = 10_000;
const MIN_DURATION_SECONDS = 3;
const MAX_DURATION_SECONDS = 30;
const MAX_STDOUT_BYTES = 64 * 1024;
const MAX_STREAMS = 32;
const PROBE_TIMEOUT_MS = 15_000;
const TEMP_PREFIX = "syntx-kling4-omni-video-";
const ACCEPTED_FFPROBE_FORMAT = "mov,mp4,m4a,3gp,3g2,mj2";
const MP4_MAJOR_BRAND = /^(?:isom|iso[2-9][a-z0-9]?|mp4[12]|avc1|M4V |MSNV|dash|cmfc|cmfs)$/u;
const QUICKTIME_MAJOR_BRAND = "qt  ";
const PQ_TRANSFERS = new Set(["pq", "smpte2084", "smpte-st-2084", "smpte_st_2084"]);
const HLG_TRANSFERS = new Set(["hlg", "arib-std-b67", "arib_std_b67"]);
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_SET = Uint8Array.prototype.set;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

export const OWNER_KLING4_OMNI_VIDEO_POLICY = Object.freeze({
  policy_id: "OWNER_KLING4_OMNI_VIDEO_POLICY_C19_V1",
  public_catalog_version: SOURCE_CATALOG_VERSION,
  model_id: "kling_4_omni",
  source_mime_types: Object.freeze(["video/mp4", "video/quicktime"] as const),
  source_max_file_size_bytes: MAX_FILE_BYTES,
  local_default_max_file_size_bytes: DEFAULT_LOCAL_MAX_FILE_BYTES,
  local_configurable_max_file_size_bytes: Object.freeze({ min: MIN_LOCAL_MAX_FILE_BYTES, max: MAX_FILE_BYTES }),
  min_width: MIN_SIDE,
  min_height: MIN_SIDE,
  max_width: MAX_SIDE,
  max_height: MAX_SIDE,
  min_duration_seconds: MIN_DURATION_SECONDS,
  max_duration_seconds: MAX_DURATION_SECONDS,
  hdr_flag: false,
  aggregate_video_duration_seconds: MAX_DURATION_SECONDS,
  aggregate_duration_enforced_here: false,
  pixel_decode: false,
  provider_acceptance: "UNPROVEN"
} as const);

export type OwnerKling4OmniVideoMimeType = typeof OWNER_KLING4_OMNI_VIDEO_POLICY.source_mime_types[number];

export interface OwnerKling4OmniVideoPolicyInput {
  readonly filename: string;
  readonly mime_type: OwnerKling4OmniVideoMimeType;
  readonly bytes: Uint8Array;
  readonly ffprobePath: string;
  readonly maxFileBytes?: number;
}

export interface ValidatedOwnerKling4OmniVideo {
  readonly status: "TRUSTED_LOCAL_MEDIA_PROBE";
  readonly policy_id: typeof OWNER_KLING4_OMNI_VIDEO_POLICY.policy_id;
  readonly model_id: typeof OWNER_KLING4_OMNI_VIDEO_POLICY.model_id;
  readonly source_catalog_version: typeof SOURCE_CATALOG_VERSION;
  readonly filename: string;
  readonly mime_type: OwnerKling4OmniVideoMimeType;
  readonly source_sha256: string;
  readonly bytes_copied: number;
  readonly local_file_limit_bytes: number;
  readonly local_limit_kind: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT";
  readonly metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED";
  readonly metadata: Readonly<{
    container: "ISO_BMFF_MP4" | "QUICKTIME_MOV";
    video_codec: string;
    width: number;
    height: number;
    duration_seconds: number;
    input_cost_duration_seconds: number;
    color_transfer: string | null;
    color_transfer_status: "REPORTED_NOT_KNOWN_HDR" | "UNKNOWN_NOT_ESTABLISHED";
  }>;
  readonly generation_permit: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
  readonly content_quality: "NOT_ASSESSED";
}

export class OwnerKling4OmniVideoPolicyError extends Error {
  constructor(readonly code:
    | "INVALID_INPUT"
    | "LOCAL_RESOURCE_LIMIT_EXCEEDED"
    | "SOURCE_LIMIT_EXCEEDED"
    | "HDR_METADATA_REJECTED"
    | "UNSUPPORTED_MEDIA_METADATA"
    | "LOCAL_RESOURCE_BUSY"
    | "PROBE_FAILED"
    | "PROBE_ABORTED") {
    super("The Kling 4 Omni input video could not be safely validated.");
    this.name = "OwnerKling4OmniVideoPolicyError";
  }
}

interface ParsedInput {
  readonly filename: string;
  readonly mime_type: OwnerKling4OmniVideoMimeType;
  readonly bytes: Uint8Array;
  readonly byte_length: number;
  readonly ffprobePath: string;
  readonly maxFileBytes: number;
}

interface ProbeMetadata {
  readonly videoCodec: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly inputCostDurationSeconds: number;
  readonly colorTransfer: string | null;
  readonly colorTransferStatus: "REPORTED_NOT_KNOWN_HDR" | "UNKNOWN_NOT_ESTABLISHED";
}

interface ReceiptState {
  readonly bytes: Buffer;
  readonly sourceSha256: string;
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>;
}

const RECEIPTS = new WeakMap<object, ReceiptState>();
let activeProbe = false;

/** Validates one exact Kling 4 Omni input using a trusted, absolute local ffprobe executable. */
export async function validateOwnerKling4OmniVideo(
  input: unknown,
  signal?: AbortSignal
): Promise<Readonly<ValidatedOwnerKling4OmniVideo>> {
  const request = exactInput(input);
  const actualSignal = exactSignal(signal);
  if (isAborted(actualSignal)) aborted();
  if (!safeFilename(request.filename) || !matchesMimeAndExtension(request.filename, request.mime_type) ||
      !validByteType(request.bytes) || request.byte_length < 16) invalid();
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
  let receipt: Readonly<ValidatedOwnerKling4OmniVideo> | undefined;
  try {
    if (isAborted(actualSignal)) aborted();
    source = copyInputBytes(request.bytes, request.byte_length);
    const container = identifyVideoContainer(source, request.mime_type);
    const sourceSha256 = sha256(source);

    directory = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
    await chmod(directory, 0o700);
    inputPath = join(directory, `input${extname(request.filename).toLowerCase()}`);
    const file = await open(inputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    createdFile = true;
    try {
      await file.chmod(0o600);
      await file.writeFile(source);
      await file.sync();
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== source.byteLength) invalid();
    } finally { await file.close(); }

    const output = await runFfprobe(request.ffprobePath, inputPath, actualSignal);
    if (isAborted(actualSignal)) aborted();
    const metadata = parseFfprobe(output);
    if (metadata.colorTransfer !== null && isKnownHdrTransfer(metadata.colorTransfer)) hdr();
    if (metadata.width < MIN_SIDE || metadata.width > MAX_SIDE || metadata.height < MIN_SIDE || metadata.height > MAX_SIDE ||
        metadata.durationSeconds < MIN_DURATION_SECONDS || metadata.durationSeconds > MAX_DURATION_SECONDS) sourceLimit();
    const postProbeStat = await lstat(inputPath);
    if (!postProbeStat.isFile() || postProbeStat.isSymbolicLink() || postProbeStat.size !== source.byteLength) invalid();

    retainedBytes = Buffer.from(source);
    const frozenMetadata = Object.freeze({
      container,
      video_codec: metadata.videoCodec,
      width: metadata.width,
      height: metadata.height,
      duration_seconds: metadata.durationSeconds,
      input_cost_duration_seconds: metadata.inputCostDurationSeconds,
      color_transfer: metadata.colorTransfer,
      color_transfer_status: metadata.colorTransferStatus
    });
    receipt = Object.freeze({
      status: "TRUSTED_LOCAL_MEDIA_PROBE" as const,
      policy_id: OWNER_KLING4_OMNI_VIDEO_POLICY.policy_id,
      model_id: OWNER_KLING4_OMNI_VIDEO_POLICY.model_id,
      source_catalog_version: SOURCE_CATALOG_VERSION,
      filename: request.filename,
      mime_type: request.mime_type,
      source_sha256: sourceSha256,
      bytes_copied: source.byteLength,
      local_file_limit_bytes: request.maxFileBytes,
      local_limit_kind: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT" as const,
      metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED" as const,
      metadata: frozenMetadata,
      generation_permit: false as const,
      owner_upload_binding: "NOT_ESTABLISHED" as const,
      content_quality: "NOT_ASSESSED" as const
    });
  } catch (error) {
    retainedBytes?.fill(0);
    if (error instanceof OwnerKling4OmniVideoPolicyError) throw error;
    if (isAborted(actualSignal)) aborted();
    throw new OwnerKling4OmniVideoPolicyError("PROBE_FAILED");
  } finally {
    source?.fill(0);
    if (createdFile && inputPath) {
      try { await wipeAndUnlink(inputPath, request.maxFileBytes); }
      catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    if (directory) {
      try { await rmdir(directory); }
      catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    activeProbe = false;
    if (cleanupFailed) {
      retainedBytes?.fill(0);
      throw new OwnerKling4OmniVideoPolicyError("PROBE_FAILED");
    }
  }

  if (!receipt || !retainedBytes) throw new OwnerKling4OmniVideoPolicyError("PROBE_FAILED");
  RECEIPTS.set(receipt, { bytes: retainedBytes, sourceSha256: receipt.source_sha256, descriptors: Object.getOwnPropertyDescriptors(receipt) });
  retainedBytes = undefined;
  return receipt;
}

/** True only for an unchanged frozen receipt minted by this policy in this process. */
export function isValidatedOwnerKling4OmniVideo(value: unknown): value is Readonly<ValidatedOwnerKling4OmniVideo> {
  if (!isPlainReceiptObject(value) || !Object.isFrozen(value)) return false;
  const state = RECEIPTS.get(value);
  if (!state) return false;
  const receipt = value as Readonly<ValidatedOwnerKling4OmniVideo>;
  const actual = Object.getOwnPropertyDescriptors(value);
  const actualKeys = Reflect.ownKeys(actual);
  const expectedKeys = Reflect.ownKeys(state.descriptors);
  return actualKeys.length === expectedKeys.length && actualKeys.every((key) => {
    const current = actual[key as keyof typeof actual];
    const original = state.descriptors[key as keyof typeof state.descriptors];
    return current !== undefined && original !== undefined && Object.hasOwn(current, "value") &&
      current.enumerable === original.enumerable && current.configurable === false && current.writable === false &&
      current.value === original.value;
  }) && receipt.model_id === "kling_4_omni" && receipt.policy_id === OWNER_KLING4_OMNI_VIDEO_POLICY.policy_id &&
    receipt.source_catalog_version === SOURCE_CATALOG_VERSION && receipt.source_sha256 === state.sourceSha256 &&
    Object.isFrozen(receipt.metadata);
}

/** Returns a fresh consumer-owned byte copy only while the original receipt and private hash remain valid. */
export function readValidatedOwnerKling4OmniVideo(value: unknown): Uint8Array | null {
  if (!isValidatedOwnerKling4OmniVideo(value)) return null;
  const state = RECEIPTS.get(value);
  if (!state || sha256(state.bytes) !== state.sourceSha256) return null;
  const copy = new Uint8Array(state.bytes.byteLength);
  Reflect.apply(TYPED_ARRAY_SET, copy, [state.bytes]);
  return copy;
}

/** Wipes and revokes the private bytes retained for this receipt. */
export function releaseValidatedOwnerKling4OmniVideo(value: unknown): boolean {
  if (!isPlainReceiptObject(value)) return false;
  const state = RECEIPTS.get(value);
  if (!state || !isValidatedOwnerKling4OmniVideo(value)) return false;
  state.bytes.fill(0);
  return RECEIPTS.delete(value);
}

function exactInput(value: unknown): ParsedInput {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const required = ["filename", "mime_type", "bytes", "ffprobePath"];
  if (keys.length < required.length || keys.length > required.length + 1 ||
      keys.some((key) => typeof key !== "string" || (!required.includes(key) && key !== "maxFileBytes") ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) invalid();
  const values = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) values[key] = descriptors[key]!.value;
  if (typeof values.filename !== "string" || typeof values.mime_type !== "string" || typeof values.ffprobePath !== "string" ||
      !isOwnerByteView(values.bytes)) invalid();
  const byteLength = intrinsicByteLength(values.bytes);
  const maxFileBytes = values.maxFileBytes === undefined ? DEFAULT_LOCAL_MAX_FILE_BYTES : values.maxFileBytes;
  if (typeof maxFileBytes !== "number" || !Number.isSafeInteger(maxFileBytes) ||
      maxFileBytes < MIN_LOCAL_MAX_FILE_BYTES || maxFileBytes > MAX_FILE_BYTES) invalid();
  if (values.mime_type !== "video/mp4" && values.mime_type !== "video/quicktime") invalid();
  if (!isSafeAbsoluteExecutable(values.ffprobePath)) invalid();
  return {
    filename: values.filename,
    mime_type: values.mime_type,
    bytes: values.bytes,
    byte_length: byteLength,
    ffprobePath: values.ffprobePath,
    maxFileBytes
  };
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
  if (!Buffer.isBuffer(value) && prototype !== Uint8Array.prototype) return false;
  if (!TYPED_ARRAY_BYTE_LENGTH || !TYPED_ARRAY_BUFFER) return false;
  try {
    const backing = Reflect.apply(TYPED_ARRAY_BUFFER, value, []) as ArrayBufferLike;
    return !types.isSharedArrayBuffer(backing) && intrinsicByteLength(value) >= 0;
  } catch { return false; }
}

function validByteType(value: Uint8Array): boolean {
  return isOwnerByteView(value);
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
  const copy = Buffer.allocUnsafe(length);
  try {
    Reflect.apply(TYPED_ARRAY_SET, copy, [value]);
    if (copy.byteLength !== length) invalid();
    return copy;
  } catch (error) {
    copy.fill(0);
    if (error instanceof OwnerKling4OmniVideoPolicyError) throw error;
    invalid();
  }
}

function matchesMimeAndExtension(filename: string, mimeType: string): boolean {
  const extension = extname(filename).toLowerCase();
  return mimeType === "video/mp4" ? extension === ".mp4" : mimeType === "video/quicktime" && extension === ".mov";
}

function safeFilename(filename: string): boolean {
  return filename.length >= 1 && filename.length <= 255 && filename === basename(filename) &&
    !filename.includes("/") && !filename.includes("\\") && !/[\u0000-\u001f\u007f]/u.test(filename);
}

function isSafeAbsoluteExecutable(path: string): boolean {
  if (!isAbsolute(path) || path !== path.trim() || path.includes("\0") || resolve(path) !== path || basename(path) === "") return false;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch { return false; }
}

function identifyVideoContainer(bytes: Uint8Array, mimeType: OwnerKling4OmniVideoMimeType): "ISO_BMFF_MP4" | "QUICKTIME_MOV" {
  if (bytes.byteLength < 16 || ascii(bytes, 4, 4) !== "ftyp") return invalid();
  const size = readU32(bytes, 0);
  if (size < 16 || size > bytes.byteLength || (size - 16) % 4 !== 0) return invalid();
  const majorBrand = ascii(bytes, 8, 4);
  if (mimeType === "video/quicktime" && majorBrand === QUICKTIME_MAJOR_BRAND) return "QUICKTIME_MOV";
  if (mimeType === "video/mp4" && MP4_MAJOR_BRAND.test(majorBrand)) return "ISO_BMFF_MP4";
  return invalid();
}

function readU32(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x1000000 + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let result = "";
  for (let index = 0; index < length; index += 1) result += String.fromCharCode(bytes[offset + index]!);
  return result;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value);
}

function parseFfprobe(stdout: string): ProbeMetadata {
  let root: unknown;
  try { root = JSON.parse(stdout); } catch { return unsupported(); }
  if (!isRecord(root) || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > MAX_STREAMS || !isRecord(root.format) ||
      root.format.format_name !== ACCEPTED_FFPROBE_FORMAT) return unsupported();
  const videos: Record<string, unknown>[] = [];
  const inputCostTrackEnds: number[] = [];
  for (const candidate of root.streams) {
    if (!isRecord(candidate) || typeof candidate.codec_type !== "string" || !/^[a-z0-9_+-]{1,24}$/iu.test(candidate.codec_type) ||
        typeof candidate.codec_name !== "string" || !/^[a-z0-9_+.-]{1,64}$/iu.test(candidate.codec_name)) return unsupported();
    if (candidate.codec_type === "video" && candidate.disposition !== undefined && (!isRecord(candidate.disposition) ||
        (candidate.disposition.attached_pic !== undefined && candidate.disposition.attached_pic !== 0 && candidate.disposition.attached_pic !== 1))) return unsupported();
    if (candidate.codec_type === "video" && isRecord(candidate.disposition) && candidate.disposition.attached_pic === 1) continue;
    if (candidate.codec_type === "video") videos.push(candidate);
    if (candidate.codec_type === "video" || candidate.codec_type === "audio") {
      const startSeconds = finiteNumber(candidate.start_time);
      const trackDurationSeconds = finitePositive(candidate.duration);
      if (startSeconds === undefined || trackDurationSeconds === undefined) return unsupported();
      const trackEndSeconds = startSeconds + trackDurationSeconds;
      if (!Number.isFinite(trackEndSeconds)) return unsupported();
      inputCostTrackEnds.push(trackEndSeconds);
    }
  }
  if (videos.length !== 1 || inputCostTrackEnds.length === 0) return unsupported();
  const video = videos[0]!;
  const width = positiveInteger(video.width);
  const height = positiveInteger(video.height);
  const durations = [video.duration, root.format.duration].filter((value) => value !== undefined).map(finitePositive);
  if (width === undefined || height === undefined || durations.length === 0 || durations.some((value) => value === undefined)) return unsupported();
  const durationSeconds = Math.max(...durations as number[]);
  const inputCostDurationSeconds = Math.max(...inputCostTrackEnds);
  if (!Number.isFinite(inputCostDurationSeconds) || inputCostDurationSeconds <= 0) return unsupported();
  const colorTransfer = parseColorTransfer(video.color_transfer);
  return {
    videoCodec: video.codec_name as string,
    width,
    height,
    durationSeconds,
    inputCostDurationSeconds,
    colorTransfer,
    colorTransferStatus: colorTransfer === null ? "UNKNOWN_NOT_ESTABLISHED" : "REPORTED_NOT_KNOWN_HDR"
  };
}

function parseColorTransfer(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 64 || !/^[a-z0-9_-]+$/iu.test(value)) return unsupported();
  const normalized = value.toLowerCase();
  if (normalized === "" || normalized === "unknown" || normalized === "unspecified" || normalized === "reserved") return null;
  return normalized;
}

function isKnownHdrTransfer(transfer: string): boolean {
  return PQ_TRANSFERS.has(transfer) || HLG_TRANSFERS.has(transfer);
}

async function runFfprobe(path: string, inputPath: string, signal?: AbortSignal): Promise<string> {
  const args = ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
    "stream=codec_type,codec_name,width,height,start_time,duration,color_transfer:stream_disposition=attached_pic:format=duration,format_name",
    "-of", "json", inputPath];
  const options: ExecFileOptionsWithStringEncoding = {
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: MAX_STDOUT_BYTES,
    windowsHide: true,
    shell: false,
    ...(signal === undefined ? {} : { signal }),
    env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" }
  };
  return new Promise((resolveOutput, rejectOutput) => {
    let spawned = false;
    let spawnFailed = false;
    let callbackDone = false;
    let closed = false;
    let settled = false;
    let callbackError: Error | null = null;
    let stdout: string | undefined;
    let closeCode: number | null = null;
    let closeSignal: NodeJS.Signals | null = null;
    const settleIfClosed = () => {
      if (settled || !callbackDone || (!closed && !spawnFailed)) return;
      settled = true;
      if (callbackError) { rejectOutput(callbackError); return; }
      if (closeCode !== 0 || closeSignal !== null || stdout === undefined) { rejectOutput(new Error("ffprobe did not exit successfully.")); return; }
      resolveOutput(stdout);
    };
    try {
      const child = execFileCallback(path, args, options, (error, output) => {
        callbackDone = true;
        callbackError = error;
        stdout = typeof output === "string" ? output : undefined;
        settleIfClosed();
      });
      child.once("spawn", () => { spawned = true; });
      child.once("error", (error) => {
        if (!spawned) { spawnFailed = true; callbackDone = true; }
        callbackError ??= error;
        settleIfClosed();
      });
      child.once("close", (code, reason) => {
        closed = true;
        closeCode = code;
        closeSignal = reason;
        settleIfClosed();
      });
    } catch (error) { rejectOutput(error instanceof Error ? error : new Error("ffprobe could not start.")); }
  });
}

async function wipeAndUnlink(path: string, maximumBytes: number): Promise<void> {
  let file: FileHandle;
  try { file = await open(path, fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    try { await unlink(path); } catch (cleanupError) { if (!isMissingFile(cleanupError)) throw cleanupError; }
    throw error;
  }
  let wipeError: unknown;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximumBytes) invalid();
    const zeros = Buffer.alloc(64 * 1024);
    for (let offset = 0; offset < stat.size; offset += zeros.byteLength) {
      await file.write(zeros, 0, Math.min(zeros.byteLength, stat.size - offset), offset);
    }
    zeros.fill(0);
    await file.sync();
  } catch (error) { wipeError = error; }
  finally { await file.close(); }
  await unlink(path);
  if (wipeError !== undefined) throw wipeError;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9][0-9]{0,7}$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function finitePositive(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:e[+-]?[0-9]+)?$/iu.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isPlainReceiptObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !types.isProxy(value) && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function invalid(): never { throw new OwnerKling4OmniVideoPolicyError("INVALID_INPUT"); }
function localLimit(): never { throw new OwnerKling4OmniVideoPolicyError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
function sourceLimit(): never { throw new OwnerKling4OmniVideoPolicyError("SOURCE_LIMIT_EXCEEDED"); }
function unsupported(): never { throw new OwnerKling4OmniVideoPolicyError("UNSUPPORTED_MEDIA_METADATA"); }
function hdr(): never { throw new OwnerKling4OmniVideoPolicyError("HDR_METADATA_REJECTED"); }
function busy(): never { throw new OwnerKling4OmniVideoPolicyError("LOCAL_RESOURCE_BUSY"); }
function aborted(): never { throw new OwnerKling4OmniVideoPolicyError("PROBE_ABORTED"); }
