import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, accessSync, lstatSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { types } from "node:util";
import {
  getOwnerGrokV2vSourceProfile,
  OWNER_GROK_V2V_MODEL_ID,
  OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION,
  type OwnerGrokV2vSourceProfile
} from "./owner-grok-v2v-source-profile.js";

const MODEL_ID = OWNER_GROK_V2V_MODEL_ID;
const AI_NAME = "grok_video" as const;
const SOURCE_CATALOG_VERSION = OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION;
const MAX_INPUT_BYTES = 52_428_800;
const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 8.7;
const MAX_STREAMS = 32;
const MAX_STDOUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const INPUT_PREFIX = "syntx-grok-v2v-probe-";
const ACCEPTED_FFPROBE_FORMAT = "mov,mp4,m4a,3gp,3g2,mj2";
const MP4_BRANDS = /^(?:isom|iso[2-9][a-z0-9]?|mp4[12]|avc1|M4V |MSNV|dash|cmfc|cmfs)$/u;
const QUICKTIME_BRAND = "qt  ";
const FORBIDDEN_FILENAME = /[<>:"/\\|?*\u0000-\u001f\u007f]/u;
const WINDOWS_RESERVED_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const DURATION_CONFIDENCE = "CONTAINER_DURATION_SECONDS_LOCAL_POLICY" as const;
const INSPECTION_KIND = "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE" as const;
const UINT8_ARRAY_PROTOTYPE = Uint8Array.prototype;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(UINT8_ARRAY_PROTOTYPE) as object;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_SET = UINT8_ARRAY_PROTOTYPE.set;
const ARRAY_BUFFER_PROTOTYPE = ArrayBuffer.prototype;
const ARRAY_BUFFER_BYTE_LENGTH = Object.getOwnPropertyDescriptor(ARRAY_BUFFER_PROTOTYPE, "byteLength")?.get;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
let activeProbe = false;

export interface OwnerGrokV2vOriginalProbeInput {
  readonly model_id: typeof MODEL_ID;
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly bytes: Uint8Array;
  /** Trusted absolute operator path; never a caller-facing MCP argument. */
  readonly ffprobePath: string;
}

export interface OwnerGrokV2vOriginalProbeResult {
  readonly status: "TRUSTED_LOCAL_VIDEO_PROBE";
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof AI_NAME;
  readonly source_catalog_version: typeof SOURCE_CATALOG_VERSION;
  readonly source_pins: OwnerGrokV2vSourceProfile["source_pins"];
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly source_sha256: string;
  readonly source_size_bytes: number;
  readonly metadata: Readonly<{
    container: "ISO_BMFF_MP4" | "QUICKTIME_MOV";
    video: Readonly<{ codec_name: string; width: number; height: number; duration_seconds: number | null }>;
    container_duration_seconds: number | null;
    duration_seconds: number;
    audio_stream_count: number;
    duration_confidence: typeof DURATION_CONFIDENCE;
    inspection: typeof INSPECTION_KIND;
  }>;
  readonly dispatch_allowed: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}

export class OwnerGrokV2vOriginalProbeError extends Error {
  constructor(readonly code: "INVALID_ORIGINAL" | "ORIGINAL_LOCAL_LIMIT_EXCEEDED" | "LOCAL_RESOURCE_BUSY" |
    "UNSUPPORTED_LOCAL_INPUT" | "PROBE_FAILED" | "PROBE_ABORTED") {
    super("Grok V2V original could not be safely probed.");
    this.name = "OwnerGrokV2vOriginalProbeError";
  }
}

interface ProbeReceiptState {
  readonly bytes: Buffer;
  readonly sourceSha256: string;
}

interface ParsedFfprobe {
  readonly videoCodec: string;
  readonly width: number;
  readonly height: number;
  readonly videoDuration: number | null;
  readonly containerDuration: number | null;
  readonly audioStreamCount: number;
  readonly duration: number;
}

const trustedReceipts = new WeakMap<object, ProbeReceiptState>();
const trustedDescriptors = new WeakMap<object, Readonly<Record<string, PropertyDescriptor>>>();

/** One model-pinned metadata probe. The binary path is trusted configuration, not input data. */
export async function probeOwnerGrokV2vOriginal(
  input: unknown,
  signal?: AbortSignal
): Promise<Readonly<OwnerGrokV2vOriginalProbeResult>> {
  const request = exactInput(input), validatedSignal = exactSignal(signal);
  if (signalAborted(validatedSignal)) throw new OwnerGrokV2vOriginalProbeError("PROBE_ABORTED");
  const profile = getOwnerGrokV2vSourceProfile(MODEL_ID);
  if (!profile || profile.status !== "SOURCE_REVIEWED_STATIC_ONLY" || profile.model_id !== MODEL_ID ||
      profile.ai_name !== AI_NAME || profile.source_pins.public_catalog_version !== SOURCE_CATALOG_VERSION ||
      profile.input.role !== "video" || profile.input.file_count_limit !== 1 ||
      profile.input.accepted_file_types.length !== 2 || profile.input.accepted_file_types[0] !== "video/mp4" ||
      profile.input.accepted_file_types[1] !== "video/quicktime" || profile.input.max_file_size_bytes !== MAX_INPUT_BYTES ||
      profile.input.total_duration_seconds.minimum !== MIN_DURATION_SECONDS ||
      profile.input.total_duration_seconds.maximum !== MAX_DURATION_SECONDS ||
      profile.dispatch_allowed !== false || profile.runtime_usable !== false) invalid();
  if (request.model_id !== MODEL_ID || !validMimeAndFilename(request.mime_type, request.filename)) invalid();

  const byteLength = intrinsicByteLength(request.bytes);
  if (byteLength < 16) invalid();
  if (byteLength > MAX_INPUT_BYTES) localLimit();
  if (activeProbe) throw new OwnerGrokV2vOriginalProbeError("LOCAL_RESOURCE_BUSY");
  activeProbe = true;

  let source: Buffer | undefined;
  let privateCopy: Buffer | undefined;
  let directory: string | undefined;
  let inputPath: string | undefined;
  let createdFile = false;
  let result: Readonly<OwnerGrokV2vOriginalProbeResult> | undefined;
  try {
    verifyTrustedBinary(request.ffprobePath);
    const snapshot = new Uint8Array(byteLength);
    try {
      Reflect.apply(TYPED_ARRAY_SET, snapshot, [request.bytes]);
      if (snapshot.byteLength !== byteLength) invalid();
      source = Buffer.from(snapshot);
    } catch (error) {
      if (error instanceof OwnerGrokV2vOriginalProbeError) throw error;
      invalid();
    } finally { snapshot.fill(0); }

    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    const container = identifyContainer(source, request.mime_type);

    directory = await mkdtemp(join(tmpdir(), INPUT_PREFIX));
    await chmod(directory, 0o700);
    inputPath = join(directory, container === "ISO_BMFF_MP4" ? "source.mp4" : "source.mov");
    const file = await open(inputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    createdFile = true;
    try {
      await file.chmod(0o600);
      await file.writeFile(source);
      await file.sync();
      const info = await file.stat();
      if (!info.isFile() || info.size !== source.byteLength) invalid();
    } finally { await file.close(); }

    const metadata = parseFfprobe(await runFfprobe(request.ffprobePath, inputPath, validatedSignal));
    if (signalAborted(validatedSignal)) throw new OwnerGrokV2vOriginalProbeError("PROBE_ABORTED");
    const after = await lstat(inputPath);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== source.byteLength) invalid();

    privateCopy = Buffer.from(source);
    result = Object.freeze({
      status: "TRUSTED_LOCAL_VIDEO_PROBE" as const,
      model_id: MODEL_ID,
      ai_name: AI_NAME,
      source_catalog_version: SOURCE_CATALOG_VERSION,
      source_pins: profile.source_pins,
      filename: request.filename,
      mime_type: request.mime_type,
      source_sha256: sourceSha256,
      source_size_bytes: source.byteLength,
      metadata: Object.freeze({
        container,
        video: Object.freeze({ codec_name: metadata.videoCodec, width: metadata.width, height: metadata.height,
          duration_seconds: metadata.videoDuration }),
        container_duration_seconds: metadata.containerDuration,
        duration_seconds: metadata.duration,
        audio_stream_count: metadata.audioStreamCount,
        duration_confidence: DURATION_CONFIDENCE,
        inspection: INSPECTION_KIND
      }),
      dispatch_allowed: false as const,
      owner_upload_binding: "NOT_ESTABLISHED" as const
    });
  } catch (error) {
    privateCopy?.fill(0);
    if (error instanceof OwnerGrokV2vOriginalProbeError) throw error;
    if (signalAborted(validatedSignal)) throw new OwnerGrokV2vOriginalProbeError("PROBE_ABORTED");
    throw new OwnerGrokV2vOriginalProbeError("PROBE_FAILED");
  } finally {
    source?.fill(0);
    let cleanupFailed = false;
    if (createdFile && inputPath) {
      try { await wipeAndUnlink(inputPath); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    if (directory) {
      try { await rmdir(directory); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    activeProbe = false;
    if (cleanupFailed || signalAborted(validatedSignal)) {
      privateCopy?.fill(0);
      result = undefined;
      if (cleanupFailed) throw new OwnerGrokV2vOriginalProbeError("PROBE_FAILED");
      throw new OwnerGrokV2vOriginalProbeError("PROBE_ABORTED");
    }
  }

  if (!result || !privateCopy) throw new OwnerGrokV2vOriginalProbeError("PROBE_FAILED");
  trustedReceipts.set(result, { bytes: privateCopy, sourceSha256: result.source_sha256 });
  trustedDescriptors.set(result, Object.getOwnPropertyDescriptors(result));
  return result;
}

/** True only for this process's unchanged frozen Grok V2V receipt. */
export function isOwnerGrokV2vOriginalProbe(value: unknown): value is Readonly<OwnerGrokV2vOriginalProbeResult> {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const receipt = trustedReceipts.get(value), expected = trustedDescriptors.get(value);
  if (!receipt || !expected || !Object.isFrozen(value)) return false;
  const actual = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(actual), expectedKeys = Reflect.ownKeys(expected);
  return keys.length === expectedKeys.length && keys.every((key) => {
    const current = actual[key as keyof typeof actual], original = expected[key as keyof typeof expected];
    return expectedKeys.includes(key) && current !== undefined && original !== undefined && Object.hasOwn(current, "value") &&
      current.enumerable === original.enumerable && current.configurable === false && current.writable === false && current.value === original.value;
  }) && (value as OwnerGrokV2vOriginalProbeResult).model_id === MODEL_ID &&
    (value as OwnerGrokV2vOriginalProbeResult).ai_name === AI_NAME &&
    (value as OwnerGrokV2vOriginalProbeResult).source_catalog_version === SOURCE_CATALOG_VERSION &&
    (value as OwnerGrokV2vOriginalProbeResult).source_sha256 === receipt.sourceSha256;
}

/** Returns a fresh owned-byte copy; the reference service remains responsible for receipt release. */
export function readOwnerGrokV2vOriginalProbeBytes(value: unknown): Uint8Array {
  if (!isOwnerGrokV2vOriginalProbe(value)) invalid();
  const receipt = trustedReceipts.get(value);
  if (!receipt) invalid();
  const copy = new Uint8Array(receipt.bytes.byteLength);
  Reflect.apply(TYPED_ARRAY_SET, copy, [receipt.bytes]);
  return copy;
}

/** Wipes and revokes the retained private copy. */
export function releaseOwnerGrokV2vOriginalProbe(value: unknown): void {
  if (!isOwnerGrokV2vOriginalProbe(value)) invalid();
  const receipt = trustedReceipts.get(value);
  if (!receipt) invalid();
  receipt.bytes.fill(0);
  trustedReceipts.delete(value);
  trustedDescriptors.delete(value);
}

function runFfprobe(ffprobePath: string, inputPath: string, signal?: AbortSignal): Promise<string> {
  const args = ["-v", "error", "-protocol_whitelist", "file", "-show_entries",
    "stream=codec_type,codec_name,width,height,duration:stream_disposition=attached_pic:format=duration,format_name", "-of", "json", inputPath];
  const options: ExecFileOptionsWithStringEncoding = {
    encoding: "utf8", timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: MAX_STDOUT_BYTES,
    windowsHide: true, ...(signal ? { signal } : {}), env: { PATH: "", LANG: "C", LC_ALL: "C" }
  };
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
      const child = execFileCallback(ffprobePath, args, options, (error, output) => {
        callbackDone = true;
        callbackError = error;
        stdout = typeof output === "string" ? output : undefined;
        settle();
      });
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

function parseFfprobe(stdout: string): ParsedFfprobe {
  let root: unknown;
  try { root = JSON.parse(stdout); } catch { return unsupported(); }
  if (!isRecord(root) || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > MAX_STREAMS ||
      !isRecord(root.format) || root.format.format_name !== ACCEPTED_FFPROBE_FORMAT) return unsupported();
  const videos: Record<string, unknown>[] = [];
  const streamDurations: number[] = [];
  let audioStreamCount = 0;
  for (const stream of root.streams) {
    if (!isRecord(stream) || typeof stream.codec_type !== "string" || !/^[a-z0-9_+-]{1,24}$/iu.test(stream.codec_type) ||
        typeof stream.codec_name !== "string" || !/^[a-z0-9_+-]{1,64}$/iu.test(stream.codec_name)) return unsupported();
    if (stream.codec_type !== "video" && stream.codec_type !== "audio") return unsupported();
    const duration = optionalDuration(stream.duration);
    if (duration !== null) streamDurations.push(duration);
    if (stream.codec_type === "video") videos.push(stream);
    if (stream.codec_type === "audio") audioStreamCount += 1;
  }
  if (videos.length !== 1) unsupported();
  const video = videos[0]!;
  if (!isRecord(video.disposition) || video.disposition.attached_pic !== 0) unsupported();
  const width = positiveSafeInteger(video.width), height = positiveSafeInteger(video.height);
  const videoDuration = optionalDuration(video.duration), containerDuration = optionalDuration(root.format.duration);
  if (width === undefined || height === undefined || videoDuration === null && containerDuration === null) unsupported();
  const observedDurations = [...streamDurations, ...(containerDuration === null ? [] : [containerDuration])];
  const duration = Math.max(...observedDurations);
  if (!Number.isFinite(duration) || duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS) unsupported();
  return {
    videoCodec: video.codec_name as string,
    width,
    height,
    videoDuration,
    containerDuration,
    audioStreamCount,
    duration
  };
}

function optionalDuration(value: unknown): number | null {
  if (value === undefined || value === null || value === "N/A") return null;
  if (typeof value !== "string" && typeof value !== "number") return unsupported();
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return unsupported();
  return duration;
}

function positiveSafeInteger(value: unknown): number | undefined {
  if (typeof value === "string" && /^\d+$/u.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function identifyContainer(bytes: Buffer, mimeType: OwnerGrokV2vOriginalProbeInput["mime_type"]): OwnerGrokV2vOriginalProbeResult["metadata"]["container"] {
  const brands = readBrands(bytes);
  if (!brands) invalid();
  const major = brands[0]!;
  if (mimeType === "video/mp4" && major !== QUICKTIME_BRAND && brands.some((brand) => MP4_BRANDS.test(brand))) return "ISO_BMFF_MP4";
  if (mimeType === "video/quicktime" && major === QUICKTIME_BRAND) return "QUICKTIME_MOV";
  return invalid();
}

function readBrands(bytes: Buffer): string[] | undefined {
  if (bytes.byteLength < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return undefined;
  const boxSize = bytes.readUInt32BE(0);
  if (boxSize < 16 || boxSize > bytes.byteLength || (boxSize - 16) % 4 !== 0) return undefined;
  const brands = [bytes.toString("ascii", 8, 12)];
  for (let offset = 16; offset < boxSize; offset += 4) brands.push(bytes.toString("ascii", offset, offset + 4));
  return brands;
}

async function wipeAndUnlink(path: string): Promise<void> {
  const file = await open(path, fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_INPUT_BYTES) invalid();
    const zeros = Buffer.alloc(64 * 1024);
    for (let offset = 0; offset < info.size; offset += zeros.length) {
      await file.write(zeros, 0, Math.min(zeros.length, info.size - offset), offset);
    }
    zeros.fill(0);
    await file.sync();
  } finally { await file.close(); }
  await unlink(path);
}

function exactInput(input: unknown): OwnerGrokV2vOriginalProbeInput {
  if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  const required = ["model_id", "filename", "mime_type", "bytes", "ffprobePath"];
  if ((Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) || keys.length !== required.length ||
      keys.some((key) => typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
        descriptors[key]!.enumerable !== true)) invalid();
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) copy[key] = descriptors[key]!.value;
  if (typeof copy.model_id !== "string" || typeof copy.filename !== "string" || typeof copy.mime_type !== "string" ||
      typeof copy.ffprobePath !== "string" || !isSupportedBytes(copy.bytes)) invalid();
  return copy as unknown as OwnerGrokV2vOriginalProbeInput;
}

function isSupportedBytes(value: unknown): value is Uint8Array {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof Uint8Array)) return false;
  if (!Buffer.isBuffer(value) && Object.getPrototypeOf(value) !== UINT8_ARRAY_PROTOTYPE) return false;
  try {
    if (!TYPED_ARRAY_BYTE_LENGTH || !TYPED_ARRAY_BUFFER || !ARRAY_BUFFER_BYTE_LENGTH) return false;
    const backing = Reflect.apply(TYPED_ARRAY_BUFFER, value, []);
    return backing instanceof ArrayBuffer && Object.getPrototypeOf(backing) === ARRAY_BUFFER_PROTOTYPE &&
      Number.isSafeInteger(Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, value, [])) &&
      Number.isSafeInteger(Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH, backing, []));
  } catch { return false; }
}

function intrinsicByteLength(bytes: Uint8Array): number {
  try {
    if (!TYPED_ARRAY_BYTE_LENGTH) invalid();
    return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, bytes, []) as number;
  } catch { return invalid(); }
}

function exactSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || !(signal instanceof AbortSignal) ||
      Object.getPrototypeOf(signal) !== AbortSignal.prototype || !ABORTED_GETTER) invalid();
  try { Reflect.apply(ABORTED_GETTER, signal, []); } catch { invalid(); }
  return signal;
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  if (!signal) return false;
  try {
    if (!ABORTED_GETTER) invalid();
    return Reflect.apply(ABORTED_GETTER, signal, []) as boolean;
  } catch { return invalid(); }
}

function validMimeAndFilename(mimeType: string, filename: string): boolean {
  if (!safeFilename(filename)) return false;
  const extension = extname(filename).toLowerCase();
  return mimeType === "video/mp4" && extension === ".mp4" || mimeType === "video/quicktime" && extension === ".mov";
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

function verifyTrustedBinary(path: string): void {
  if (!isAbsolute(path) || path !== path.trim() || path.includes("\0") || resolve(path) !== path || basename(path) === "") invalid();
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || realpathSync(path) !== path) invalid();
    if (process.platform === "win32") {
      if (!/\.exe$/iu.test(path)) invalid();
      accessSync(path, fsConstants.R_OK);
    } else {
      const uid = process.getuid?.();
      if (uid === undefined || (info.uid !== 0 && info.uid !== uid) || (info.mode & 0o022) !== 0) invalid();
      accessSync(path, fsConstants.X_OK | fsConstants.R_OK);
    }
  } catch { invalid(); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value));
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function invalid(): never { throw new OwnerGrokV2vOriginalProbeError("INVALID_ORIGINAL"); }
function localLimit(): never { throw new OwnerGrokV2vOriginalProbeError("ORIGINAL_LOCAL_LIMIT_EXCEEDED"); }
function unsupported(): never { throw new OwnerGrokV2vOriginalProbeError("UNSUPPORTED_LOCAL_INPUT"); }
