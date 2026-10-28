import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, accessSync, lstatSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { types } from "node:util";
import {
  assertReviewedTopazVideoCodecAllowed,
  getReviewedTopazCodecPolicy,
  ReviewedTopazCodecPolicyError,
  type ReviewedTopazCodecPolicy
} from "./reviewed-topaz-codec-policy-20261028.js";

const MODEL_ID = "topaz_enhance" as const;
const AI_NAME = "topaz_ai" as const;
const SOURCE_CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const PUBLIC_MAX_BYTES = 50 * 1024 * 1024;
const PUBLIC_MIN_DURATION_SECONDS = 2;
const PUBLIC_MAX_DURATION_SECONDS = 26.25;
const LOCAL_MAX_FRAME_COUNT = 10_000;
const MAX_STDOUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const INPUT_PREFIX = "syntx-topaz-enhance-probe-";
const ACCEPTED_FFPROBE_FORMAT = "mov,mp4,m4a,3gp,3g2,mj2";
const MP4_BRANDS = /^(?:isom|iso[2-9][a-z0-9]?|mp4[12]|avc1|M4V |MSNV|dash|cmfc|cmfs)$/u;
const UINT8_ARRAY_PROTOTYPE = Uint8Array.prototype;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(UINT8_ARRAY_PROTOTYPE) as object;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const TYPED_ARRAY_SET = UINT8_ARRAY_PROTOTYPE.set;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const MAX_INPUT_LIMIT_KIND = "LOCAL_MP4_ONLY_LIMITATION_PUBLIC_ALSO_ACCEPTS_WEBM_QUICKTIME" as const;
const FRAME_LIMIT_KIND = "LOCAL_RESOURCE_GUARD_NOT_VENDOR_LIMIT" as const;
const INSPECTION_KIND = "LOCAL_FFPROBE_FRAME_COUNT_NOT_FULL_MEDIA_VALIDATION" as const;
let activeProbe = false;

export interface OwnerTopazEnhanceOriginalProbeInput {
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof AI_NAME;
  readonly source_catalog_version: typeof SOURCE_CATALOG_VERSION;
  readonly filename: string;
  readonly mime_type: "video/mp4";
  readonly bytes: Uint8Array;
}

export interface OwnerTopazEnhanceOriginalProbeResult {
  readonly status: "TRUSTED_LOCAL_MEDIA_PROBE";
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof AI_NAME;
  readonly source_catalog_version: typeof SOURCE_CATALOG_VERSION;
  readonly filename: string;
  readonly mime_type: "video/mp4";
  readonly source_sha256: string;
  readonly bytes_copied: number;
  readonly local_input_limit_kind: typeof MAX_INPUT_LIMIT_KIND;
  readonly public_input_limits: Readonly<{
    max_file_size_bytes: 52_428_800;
    min_duration_seconds: 2;
    max_duration_seconds: 26.25;
    accepted_mime_types: readonly ["video/mp4", "video/webm", "video/quicktime"];
  }>;
  readonly local_supported_mime_types: readonly ["video/mp4"];
  readonly public_duration_limits_seconds: Readonly<{ min: 2; max: 26.25 }>;
  readonly local_frame_count_guard: Readonly<{ max: 10_000; kind: typeof FRAME_LIMIT_KIND }>;
  readonly metadata: Readonly<{
    container: "ISO_BMFF_MP4";
    video: Readonly<{ codec_name: string; width: number; height: number; duration_seconds: number; frame_count: number }>;
    audio_codec_names: readonly string[];
    inspection: typeof INSPECTION_KIND;
  }>;
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
  readonly content_quality: "NOT_ASSESSED";
}

export class OwnerTopazEnhanceOriginalProbeError extends Error {
  constructor(readonly code: "INVALID_ORIGINAL" | "ORIGINAL_LOCAL_LIMIT_EXCEEDED" | "LOCAL_RESOURCE_BUSY" | "PROBE_FAILED" | "PROBE_ABORTED" |
    "CODEC_POLICY_UNAVAILABLE" | "VIDEO_CODEC_METADATA_UNAVAILABLE" | "PROHIBITED_VIDEO_CODEC") {
    super("Topaz Enhance original media could not be safely probed.");
    this.name = "OwnerTopazEnhanceOriginalProbeError";
  }
}

export interface OwnerTopazEnhanceOriginalProbeRunner {
  probe(input: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerTopazEnhanceOriginalProbeResult>>;
}

interface RetainedReceipt {
  readonly bytes: Buffer;
  readonly sourceSha256: string;
}

const trustedReceipts = new WeakMap<object, RetainedReceipt>();
const trustedDescriptors = new WeakMap<object, Readonly<Record<string, PropertyDescriptor>>>();

/** ffprobePath is trusted absolute operator configuration; it never comes from source input. */
export function createOwnerTopazEnhanceOriginalProbe(config: unknown): OwnerTopazEnhanceOriginalProbeRunner {
  const ffprobePath = exactConfig(config);
  return Object.freeze({ probe: (input: unknown, options?: Readonly<{ signal?: AbortSignal }>) => probeOriginal(ffprobePath, input, options) });
}

/** True only for an unchanged probe object minted by this module in this process. */
export function isTrustedOwnerTopazEnhanceOriginalProbeResult(value: unknown): value is Readonly<OwnerTopazEnhanceOriginalProbeResult> {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const receipt = trustedReceipts.get(value), expected = trustedDescriptors.get(value);
  if (!receipt || !expected || !Object.isFrozen(value)) return false;
  const actual = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(actual), expectedKeys = Reflect.ownKeys(expected);
  return keys.length === expectedKeys.length && keys.every((key) => {
    const current = actual[key as keyof typeof actual], original = expected[key as keyof typeof expected];
    return expectedKeys.includes(key) && current !== undefined && original !== undefined && Object.hasOwn(current, "value") &&
      current.enumerable === original.enumerable && current.configurable === false && current.writable === false && current.value === original.value;
  }) && (value as OwnerTopazEnhanceOriginalProbeResult).model_id === MODEL_ID &&
    (value as OwnerTopazEnhanceOriginalProbeResult).ai_name === AI_NAME &&
    (value as OwnerTopazEnhanceOriginalProbeResult).source_catalog_version === SOURCE_CATALOG_VERSION &&
    (value as OwnerTopazEnhanceOriginalProbeResult).source_sha256 === receipt.sourceSha256;
}

/** Internal future-upload seam: a genuine result grants only a fresh byte copy, not upload authority. */
export function copyTrustedOwnerTopazEnhanceOriginalBytes(value: unknown): Uint8Array {
  if (!isTrustedOwnerTopazEnhanceOriginalProbeResult(value)) invalid();
  const receipt = trustedReceipts.get(value);
  if (!receipt) invalid();
  const copy = new Uint8Array(receipt.bytes.byteLength);
  Reflect.apply(TYPED_ARRAY_SET, copy, [receipt.bytes]);
  return copy;
}

/** Wipes and revokes the private retained copy after its future consumer finishes. */
export function releaseTrustedOwnerTopazEnhanceOriginalProbeResult(value: unknown): void {
  if (!isTrustedOwnerTopazEnhanceOriginalProbeResult(value)) invalid();
  const receipt = trustedReceipts.get(value);
  if (!receipt) invalid();
  receipt.bytes.fill(0);
  trustedReceipts.delete(value);
  trustedDescriptors.delete(value);
}

async function probeOriginal(ffprobePath: string, input: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerTopazEnhanceOriginalProbeResult>> {
  const request = exactInput(input);
  const signal = exactOptions(options);
  let codecPolicy: Readonly<ReviewedTopazCodecPolicy> | null;
  try { codecPolicy = getReviewedTopazCodecPolicy(MODEL_ID); }
  catch (error) {
    if (error instanceof ReviewedTopazCodecPolicyError) throw new OwnerTopazEnhanceOriginalProbeError(error.code);
    throw new OwnerTopazEnhanceOriginalProbeError("CODEC_POLICY_UNAVAILABLE");
  }
  if (signalAborted(signal)) throw new OwnerTopazEnhanceOriginalProbeError("PROBE_ABORTED");
  if (!safeFilename(request.filename) || extname(request.filename).toLowerCase() !== ".mp4" ||
      request.mime_type !== "video/mp4" || request.model_id !== MODEL_ID || request.ai_name !== AI_NAME ||
      request.source_catalog_version !== SOURCE_CATALOG_VERSION || !validBytes(request.bytes)) invalid();
  const inputLength = intrinsicByteLength(request.bytes);
  if (inputLength < 16) invalid();
  if (inputLength > PUBLIC_MAX_BYTES) limit();
  if (activeProbe) throw new OwnerTopazEnhanceOriginalProbeError("LOCAL_RESOURCE_BUSY");
  activeProbe = true;

  let source: Buffer | undefined;
  let privateCopy: Buffer | undefined;
  let directory: string | undefined;
  let inputPath: string | undefined;
  let createdFile = false;
  let result: Readonly<OwnerTopazEnhanceOriginalProbeResult> | undefined;
  try {
    verifyTrustedBinary(ffprobePath);
    const inputCopy = new Uint8Array(inputLength);
    try {
      Reflect.apply(TYPED_ARRAY_SET, inputCopy, [request.bytes]);
      if (inputCopy.byteLength !== inputLength) invalid();
      source = Buffer.from(inputCopy);
    } catch (error) {
      if (error instanceof OwnerTopazEnhanceOriginalProbeError) throw error;
      invalid();
    } finally { inputCopy.fill(0); }
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    if (!hasMp4Brand(source)) invalid();

    directory = await mkdtemp(join(tmpdir(), INPUT_PREFIX));
    await chmod(directory, 0o700);
    inputPath = join(directory, "source.mp4");
    const file = await open(inputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    createdFile = true;
    try {
      await file.chmod(0o600);
      await file.writeFile(source);
      await file.sync();
      const info = await file.stat();
      if (!info.isFile() || info.size !== source.byteLength) invalid();
    } finally { await file.close(); }

    const stdout = await runFfprobe(ffprobePath, inputPath, signal);
    if (signalAborted(signal)) throw new OwnerTopazEnhanceOriginalProbeError("PROBE_ABORTED");
    const measured = parseFfprobe(stdout);
    try { assertReviewedTopazVideoCodecAllowed(codecPolicy, measured.videoCodec, measured.videoCodecTagString); }
    catch (error) {
      if (error instanceof ReviewedTopazCodecPolicyError) throw new OwnerTopazEnhanceOriginalProbeError(error.code);
      throw new OwnerTopazEnhanceOriginalProbeError("CODEC_POLICY_UNAVAILABLE");
    }
    if (measured.durationSeconds < PUBLIC_MIN_DURATION_SECONDS || measured.durationSeconds > PUBLIC_MAX_DURATION_SECONDS ||
        measured.frameCount > LOCAL_MAX_FRAME_COUNT) limit();
    const after = await lstat(inputPath);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== source.byteLength) invalid();

    privateCopy = Buffer.from(source);
    const metadata = Object.freeze({
      container: "ISO_BMFF_MP4" as const,
      video: Object.freeze({ codec_name: measured.videoCodec, width: measured.width, height: measured.height,
        duration_seconds: measured.durationSeconds, frame_count: measured.frameCount }),
      audio_codec_names: Object.freeze(measured.audioCodecs),
      inspection: INSPECTION_KIND
    });
    result = Object.freeze({
      status: "TRUSTED_LOCAL_MEDIA_PROBE" as const,
      model_id: MODEL_ID,
      ai_name: AI_NAME,
      source_catalog_version: SOURCE_CATALOG_VERSION,
      filename: request.filename,
      mime_type: request.mime_type,
      source_sha256: sourceSha256,
      bytes_copied: source.byteLength,
      local_input_limit_kind: MAX_INPUT_LIMIT_KIND,
      public_input_limits: Object.freeze({ max_file_size_bytes: PUBLIC_MAX_BYTES as 52_428_800,
        min_duration_seconds: PUBLIC_MIN_DURATION_SECONDS as 2, max_duration_seconds: PUBLIC_MAX_DURATION_SECONDS as 26.25,
        accepted_mime_types: Object.freeze(["video/mp4", "video/webm", "video/quicktime"] as const) }),
      local_supported_mime_types: Object.freeze(["video/mp4"] as const),
      public_duration_limits_seconds: Object.freeze({ min: PUBLIC_MIN_DURATION_SECONDS as 2, max: PUBLIC_MAX_DURATION_SECONDS as 26.25 }),
      local_frame_count_guard: Object.freeze({ max: LOCAL_MAX_FRAME_COUNT as 10_000, kind: FRAME_LIMIT_KIND }),
      metadata,
      dispatch_allowed: false as const,
      runtime_usable: false as const,
      owner_upload_binding: "NOT_ESTABLISHED" as const,
      content_quality: "NOT_ASSESSED" as const
    });
  } catch (error) {
    privateCopy?.fill(0);
    if (error instanceof OwnerTopazEnhanceOriginalProbeError) throw error;
    if (signalAborted(signal)) throw new OwnerTopazEnhanceOriginalProbeError("PROBE_ABORTED");
    throw new OwnerTopazEnhanceOriginalProbeError("PROBE_FAILED");
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
    if (cleanupFailed) {
      privateCopy?.fill(0);
      throw new OwnerTopazEnhanceOriginalProbeError("PROBE_FAILED");
    }
  }

  if (!result || !privateCopy) throw new OwnerTopazEnhanceOriginalProbeError("PROBE_FAILED");
  trustedReceipts.set(result, { bytes: privateCopy, sourceSha256: result.source_sha256 });
  trustedDescriptors.set(result, Object.getOwnPropertyDescriptors(result));
  return result;
}

function runFfprobe(ffprobePath: string, inputPath: string, signal?: AbortSignal): Promise<string> {
  const args = ["-v", "error", "-protocol_whitelist", "file", "-count_frames", "-show_entries",
    "stream=codec_type,codec_name,codec_tag_string,width,height,nb_read_frames,duration:stream_disposition=attached_pic:format=duration,format_name", "-of", "json", inputPath];
  const options: ExecFileOptionsWithStringEncoding = { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL",
    maxBuffer: MAX_STDOUT_BYTES, windowsHide: true, signal, env: { PATH: "", LANG: "C", LC_ALL: "C" } };
  return new Promise((resolveOutput, rejectOutput) => {
    let spawned = false, spawnFailed = false, callbackDone = false, closed = false, settled = false;
    let callbackError: Error | null = null, stdout: string | undefined, closeCode: number | null = null, closeSignal: NodeJS.Signals | null = null;
    const settleIfClosed = () => {
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
        settleIfClosed();
      });
      child.once("spawn", () => { spawned = true; });
      child.once("error", (error) => {
        if (!spawned) { spawnFailed = true; callbackDone = true; }
        callbackError ??= error;
        settleIfClosed();
      });
      child.once("close", (code, reason) => { closed = true; closeCode = code; closeSignal = reason; settleIfClosed(); });
    } catch (error) { rejectOutput(error instanceof Error ? error : new Error("ffprobe could not start.")); }
  });
}

function parseFfprobe(stdout: string): { videoCodec: string; videoCodecTagString: unknown; width: number; height: number; durationSeconds: number; frameCount: number; audioCodecs: string[] } {
  let root: unknown;
  try { root = JSON.parse(stdout); } catch { return invalid(); }
  if (!isRecord(root) || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > 32 || !isRecord(root.format) ||
      root.format.format_name !== ACCEPTED_FFPROBE_FORMAT) return invalid();
  const videos: Record<string, unknown>[] = [];
  const audioCodecs: string[] = [];
  for (const candidate of root.streams) {
    if (!isRecord(candidate) || typeof candidate.codec_type !== "string" || !/^[a-z0-9_+-]{1,24}$/iu.test(candidate.codec_type) ||
        typeof candidate.codec_name !== "string" || !/^[a-z0-9_+-]{1,64}$/iu.test(candidate.codec_name)) return invalid();
    if (candidate.codec_type === "video") {
      if (!isRecord(candidate.disposition) || candidate.disposition.attached_pic !== 0) return invalid();
      videos.push(candidate);
    } else if (candidate.codec_type === "audio") audioCodecs.push(candidate.codec_name);
  }
  if (videos.length !== 1) return invalid();
  const video = videos[0]!;
  const width = positiveInteger(video.width), height = positiveInteger(video.height), frameCount = positiveInteger(video.nb_read_frames);
  const streamDuration = video.duration === undefined ? undefined : finitePositive(video.duration);
  const containerDuration = root.format.duration === undefined ? undefined : finitePositive(root.format.duration);
  if (video.duration !== undefined && streamDuration === undefined || root.format.duration !== undefined && containerDuration === undefined) return invalid();
  if (streamDuration === undefined && containerDuration === undefined) return invalid();
  if (streamDuration !== undefined && containerDuration !== undefined && Math.round(streamDuration) !== Math.round(containerDuration)) return invalid();
  // If both are measurable, reject a quote-second mismatch and retain the longer same-second measurement.
  // If only one is reported, use that one; duration includes the video stream/container audio relationship only as ffprobe reports it.
  const measuredDurations = [streamDuration, containerDuration].filter((value): value is number => value !== undefined);
  if (measuredDurations.some((duration) => duration < PUBLIC_MIN_DURATION_SECONDS || duration > PUBLIC_MAX_DURATION_SECONDS)) limit();
  const durationSeconds = Math.max(...measuredDurations);
  if (width === undefined || height === undefined || frameCount === undefined) return invalid();
  return { videoCodec: video.codec_name as string, videoCodecTagString: video.codec_tag_string, width, height, durationSeconds, frameCount, audioCodecs };
}

async function wipeAndUnlink(path: string): Promise<void> {
  const file = await open(path, fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > PUBLIC_MAX_BYTES) invalid();
    const zeros = Buffer.alloc(64 * 1024);
    for (let offset = 0; offset < info.size; offset += zeros.length) await file.write(zeros, 0, Math.min(zeros.length, info.size - offset), offset);
    zeros.fill(0);
    await file.sync();
  } finally { await file.close(); }
  await unlink(path);
}

function exactConfig(config: unknown): string {
  if (!config || typeof config !== "object" || types.isProxy(config) || Array.isArray(config)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(config), keys = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(config) !== Object.prototype && Object.getPrototypeOf(config) !== null) || keys.length !== 1 || keys[0] !== "ffprobePath" ||
      !Object.hasOwn(descriptors.ffprobePath!, "value") || descriptors.ffprobePath!.enumerable !== true) invalid();
  const path = descriptors.ffprobePath!.value;
  if (typeof path !== "string" || !isAbsolute(path) || path !== path.trim() || path.includes("\0") || resolve(path) !== path || basename(path) === "") invalid();
  verifyTrustedBinary(path);
  return path;
}

function verifyTrustedBinary(path: string): void {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || realpathSync(path) !== path) invalid();
    accessSync(path, fsConstants.X_OK);
  } catch { invalid(); }
}

function exactInput(input: unknown): OwnerTopazEnhanceOriginalProbeInput {
  if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  const required = ["model_id", "ai_name", "source_catalog_version", "filename", "mime_type", "bytes"];
  if ((Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) || keys.length !== required.length ||
      keys.some((key) => typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  if (typeof result.model_id !== "string" || typeof result.ai_name !== "string" || typeof result.source_catalog_version !== "string" ||
      typeof result.filename !== "string" || typeof result.mime_type !== "string") invalid();
  return result as unknown as OwnerTopazEnhanceOriginalProbeInput;
}

function exactOptions(options: Readonly<{ signal?: AbortSignal }> | undefined): AbortSignal | undefined {
  if (options === undefined) return undefined;
  if (!options || typeof options !== "object" || types.isProxy(options) || Array.isArray(options)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(options), keys = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null) || keys.length > 1 ||
      keys.some((key) => key !== "signal" || !Object.hasOwn(descriptors.signal!, "value") || descriptors.signal!.enumerable !== true)) invalid();
  const signal = descriptors.signal?.value;
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || !(signal instanceof AbortSignal) || !ABORTED_GETTER) invalid();
  return signal as AbortSignal;
}

function validBytes(bytes: unknown): bytes is Uint8Array {
  return Boolean(bytes && typeof bytes === "object" && !types.isProxy(bytes) && bytes instanceof Uint8Array &&
    (Buffer.isBuffer(bytes) || Object.getPrototypeOf(bytes) === UINT8_ARRAY_PROTOTYPE));
}
function intrinsicByteLength(bytes: Uint8Array): number {
  try { if (!TYPED_ARRAY_BYTE_LENGTH) invalid(); return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, bytes, []) as number; }
  catch { return invalid(); }
}
function signalAborted(signal: AbortSignal | undefined): boolean {
  if (!signal) return false;
  try { if (!ABORTED_GETTER) invalid(); return Reflect.apply(ABORTED_GETTER, signal, []) as boolean; }
  catch { return invalid(); }
}
function safeFilename(value: string): boolean {
  return value.length > 0 && value.length <= 255 && value === value.trim() && value !== "." && value !== ".." &&
    !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !/[. ]$/u.test(value);
}
function hasMp4Brand(bytes: Buffer): boolean {
  if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;
  const boxSize = bytes.readUInt32BE(0);
  if (boxSize < 16 || boxSize > bytes.length || (boxSize - 16) % 4 !== 0) return false;
  const brands = [bytes.toString("ascii", 8, 12)];
  for (let offset = 16; offset < boxSize; offset += 4) brands.push(bytes.toString("ascii", offset, offset + 4));
  return brands.some((brand) => MP4_BRANDS.test(brand)) && !brands.includes("qt  ");
}
function positiveInteger(value: unknown): number | undefined {
  if (typeof value === "string" && /^\d+$/u.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
function finitePositive(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim() !== "") value = Number(value);
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
function invalid(): never { throw new OwnerTopazEnhanceOriginalProbeError("INVALID_ORIGINAL"); }
function limit(): never { throw new OwnerTopazEnhanceOriginalProbeError("ORIGINAL_LOCAL_LIMIT_EXCEEDED"); }
