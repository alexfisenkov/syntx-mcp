import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { types } from "node:util";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_STDOUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const INPUT_PREFIX = "syntx-eleven-sts-probe-";

export interface OwnerElevenLabsStsOriginalProbeInput {
  readonly filename: string;
  readonly mime_type: "audio/mpeg";
  readonly bytes: Uint8Array;
}

export interface OwnerElevenLabsStsOriginalProbeResult {
  readonly status: "TRUSTED_LOCAL_AUDIO_PROBE";
  readonly source_sha256: string;
  readonly source_profile: "OWNER_ELEVENLABS_STS_SOURCE_UI_V1";
  readonly model_type: "eleven_multilingual_sts_v2";
  readonly filename: string;
  readonly mime_type: "audio/mpeg";
  readonly bytes_copied: number;
  readonly metadata: Readonly<{
    container: "MP3";
    codec_name: "mp3";
    sample_rate: number;
    channels: number;
    duration_seconds: number;
    decoded_frame_count: number;
  }>;
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}

export class OwnerElevenLabsStsOriginalProbeError extends Error {
  constructor(readonly code: "INVALID_ORIGINAL" | "ORIGINAL_LOCAL_LIMIT_EXCEEDED" | "PROBE_FAILED" | "PROBE_ABORTED") {
    super("ElevenLabs STS original audio could not be safely probed.");
    this.name = "OwnerElevenLabsStsOriginalProbeError";
  }
}

export interface OwnerElevenLabsStsOriginalProbeRunner {
  probe(input: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerElevenLabsStsOriginalProbeResult>>;
}

/** ffprobePath is trusted absolute server configuration and never an MCP argument. */
export function createOwnerElevenLabsStsOriginalProbe(config: unknown): OwnerElevenLabsStsOriginalProbeRunner {
  const ffprobePath = exactConfig(config);
  return Object.freeze({
    probe: (input: unknown, options?: Readonly<{ signal?: AbortSignal }>) => probeOriginal(ffprobePath, input, options)
  });
}

const trustedBytes = new WeakMap<object, Buffer>();
const trustedDescriptors = new WeakMap<object, Readonly<Record<string, PropertyDescriptor>>>();
const typedArrayByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")?.get;

/** True only for an unchanged probe result minted by this module in this process. */
export function isTrustedOwnerElevenLabsStsOriginalProbeResult(
  value: unknown
): value is Readonly<OwnerElevenLabsStsOriginalProbeResult> {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const bytes = trustedBytes.get(value);
  const expected = trustedDescriptors.get(value);
  if (!bytes || !expected || !Object.isFrozen(value)) return false;
  const actual = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(actual);
  const expectedKeys = Reflect.ownKeys(expected);
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) return false;
  return keys.every((key) => {
    const descriptor = actual[key as keyof typeof actual];
    const original = expected[key as keyof typeof expected];
    return descriptor !== undefined && original !== undefined && Object.hasOwn(descriptor, "value") &&
      descriptor.enumerable === original.enumerable && descriptor.configurable === false && descriptor.writable === false &&
      descriptor.value === original.value;
  });
}

/** Internal future-upload seam: returns a fresh copy only for genuine evidence. */
export function copyTrustedOwnerElevenLabsStsOriginalBytes(value: unknown): Uint8Array {
  if (!isTrustedOwnerElevenLabsStsOriginalProbeResult(value)) invalid();
  const bytes = trustedBytes.get(value);
  if (!bytes) invalid();
  return new Uint8Array(bytes);
}

/** Wipes and invalidates the private source copy after its future upload consumer finishes. */
export function releaseTrustedOwnerElevenLabsStsOriginalProbeResult(value: unknown): void {
  if (!isTrustedOwnerElevenLabsStsOriginalProbeResult(value)) invalid();
  trustedBytes.get(value)!.fill(0);
  trustedBytes.delete(value);
  trustedDescriptors.delete(value);
}

async function probeOriginal(
  ffprobePath: string,
  input: unknown,
  options?: Readonly<{ signal?: AbortSignal }>
): Promise<Readonly<OwnerElevenLabsStsOriginalProbeResult>> {
  const request = exactInput(input);
  const signal = exactOptions(options);
  if (!safeFilename(request.filename) || request.mime_type !== "audio/mpeg" || extname(request.filename).toLowerCase() !== ".mp3" ||
      types.isProxy(request.bytes) || !(request.bytes instanceof Uint8Array) ||
      (!Buffer.isBuffer(request.bytes) && Object.getPrototypeOf(request.bytes) !== Uint8Array.prototype)) invalid();
  if (signal?.aborted) throw new OwnerElevenLabsStsOriginalProbeError("PROBE_ABORTED");

  let inputByteLength: number;
  try {
    if (!typedArrayByteLength) invalid();
    inputByteLength = typedArrayByteLength.call(request.bytes) as number;
  } catch { invalid(); }
  if (inputByteLength < 16) invalid();
  if (inputByteLength > MAX_BYTES) limit();

  let inputBytes: Uint8Array;
  try { inputBytes = Uint8Array.prototype.slice.call(request.bytes) as Uint8Array; }
  catch { invalid(); }
  if (inputBytes.byteLength !== inputByteLength) { inputBytes.fill(0); invalid(); }
  let source: Buffer;
  try { source = Buffer.from(inputBytes); }
  catch { inputBytes.fill(0); invalid(); }
  inputBytes.fill(0);

  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  let directory: string | undefined;
  let inputPath: string | undefined;
  let createdFile = false;
  let retainedBytes: Buffer | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), INPUT_PREFIX));
    await chmod(directory, 0o700);
    inputPath = join(directory, "source.mp3");
    const file = await open(inputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    createdFile = true;
    try {
      await file.chmod(0o600);
      await file.writeFile(source);
      await file.sync();
      const info = await file.stat();
      if (!info.isFile() || info.size !== source.byteLength) invalid();
    } finally {
      await file.close();
    }

    const stdout = await runFfprobe(ffprobePath, inputPath, signal);
    const metadata = parseProbe(stdout);
    if (metadata.durationSeconds < 5 || metadata.durationSeconds > 300) limit();
    const after = await lstat(inputPath);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== source.byteLength) invalid();

    retainedBytes = Buffer.from(source);
    const result = Object.freeze({
      status: "TRUSTED_LOCAL_AUDIO_PROBE" as const,
      source_sha256: sourceSha256,
      source_profile: "OWNER_ELEVENLABS_STS_SOURCE_UI_V1" as const,
      model_type: "eleven_multilingual_sts_v2" as const,
      filename: request.filename,
      mime_type: "audio/mpeg" as const,
      bytes_copied: source.byteLength,
      metadata: Object.freeze({
        container: "MP3" as const, codec_name: "mp3" as const, sample_rate: metadata.sampleRate,
        channels: metadata.channels, duration_seconds: metadata.durationSeconds, decoded_frame_count: metadata.frameCount
      }),
      dispatch_allowed: false as const,
      runtime_usable: false as const,
      owner_upload_binding: "NOT_ESTABLISHED" as const
    });
    trustedBytes.set(result, retainedBytes);
    trustedDescriptors.set(result, Object.getOwnPropertyDescriptors(result));
    retainedBytes = undefined;
    return result;
  } catch (error) {
    retainedBytes?.fill(0);
    if (error instanceof OwnerElevenLabsStsOriginalProbeError) throw error;
    if (signal?.aborted) throw new OwnerElevenLabsStsOriginalProbeError("PROBE_ABORTED");
    throw new OwnerElevenLabsStsOriginalProbeError("PROBE_FAILED");
  } finally {
    source.fill(0);
    let cleanupFailed = false;
    if (createdFile && inputPath) {
      try { await unlink(inputPath); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    if (directory) {
      try { await rmdir(directory); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    if (cleanupFailed) throw new OwnerElevenLabsStsOriginalProbeError("PROBE_FAILED");
  }
}

function runFfprobe(ffprobePath: string, inputPath: string, signal?: AbortSignal): Promise<string> {
  const args = ["-v", "error", "-count_frames", "-select_streams", "a:0", "-show_entries",
    "stream=codec_type,codec_name,sample_rate,channels,nb_read_frames,duration:format=duration,format_name", "-of", "json", inputPath];
  const childOptions: ExecFileOptionsWithStringEncoding = {
    encoding: "utf8", timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: MAX_STDOUT_BYTES,
    windowsHide: true, signal, env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" }
  };
  return new Promise((resolve, reject) => {
    let spawned = false;
    let spawnFailed = false;
    let callbackDone = false;
    let childClosed = false;
    let settled = false;
    let callbackError: Error | null = null;
    let callbackStdout: string | undefined;
    let closeCode: number | null = null;
    let closeSignal: NodeJS.Signals | null = null;
    const settleIfClosed = () => {
      if (settled || !callbackDone || (!childClosed && !spawnFailed)) return;
      settled = true;
      if (callbackError) { reject(callbackError); return; }
      if (closeCode !== 0 || closeSignal !== null || callbackStdout === undefined) {
        reject(new Error("ffprobe did not exit successfully."));
        return;
      }
      resolve(callbackStdout);
    };
    try {
      const child = execFileCallback(ffprobePath, args, childOptions, (error, stdout) => {
        callbackDone = true;
        callbackError = error;
        callbackStdout = typeof stdout === "string" ? stdout : undefined;
        settleIfClosed();
      });
      child.once("spawn", () => { spawned = true; });
      child.once("error", (error) => {
        if (!spawned) { spawnFailed = true; callbackDone = true; }
        callbackError ??= error;
        settleIfClosed();
      });
      child.once("close", (code, closeReason) => {
        childClosed = true;
        closeCode = code;
        closeSignal = closeReason;
        settleIfClosed();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("ffprobe could not be started."));
    }
  });
}

function parseProbe(stdout: string): { sampleRate: number; channels: number; durationSeconds: number; frameCount: number } {
  let root: unknown;
  try { root = JSON.parse(stdout); } catch { return invalid(); }
  if (!isRecord(root) || !Array.isArray(root.streams) || root.streams.length !== 1 || !isRecord(root.format) ||
      root.format.format_name !== "mp3") return invalid();
  const stream = root.streams[0];
  if (!isRecord(stream) || stream.codec_type !== "audio" || stream.codec_name !== "mp3") return invalid();
  const sampleRate = positiveInteger(stream.sample_rate);
  const channels = positiveInteger(stream.channels);
  const frameCount = positiveInteger(stream.nb_read_frames);
  const durationSeconds = finitePositive(stream.duration === undefined ? root.format.duration : stream.duration);
  if (sampleRate === undefined || channels === undefined || frameCount === undefined || durationSeconds === undefined) return invalid();
  return { sampleRate, channels, durationSeconds, frameCount };
}

function exactConfig(config: unknown): string {
  if (!config || typeof config !== "object" || types.isProxy(config) || Array.isArray(config)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(config);
  const keys = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(config) !== Object.prototype && Object.getPrototypeOf(config) !== null) ||
      keys.length !== 1 || keys[0] !== "ffprobePath" || !Object.hasOwn(descriptors.ffprobePath!, "value") ||
      descriptors.ffprobePath!.enumerable !== true) invalid();
  const path = descriptors.ffprobePath!.value;
  if (typeof path !== "string" || !isAbsolute(path) || path !== path.trim() || path.includes("\0") || basename(path) === "") invalid();
  return path;
}

function exactInput(input: unknown): OwnerElevenLabsStsOriginalProbeInput {
  if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  const required = ["filename", "mime_type", "bytes"];
  if ((Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) || keys.length !== required.length ||
      keys.some((key) => typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
        descriptors[key]!.enumerable !== true)) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  if (typeof result.filename !== "string" || typeof result.mime_type !== "string") invalid();
  return result as unknown as OwnerElevenLabsStsOriginalProbeInput;
}

function exactOptions(options: Readonly<{ signal?: AbortSignal }> | undefined): AbortSignal | undefined {
  if (options === undefined) return undefined;
  if (!options || typeof options !== "object" || types.isProxy(options) || Array.isArray(options)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const keys = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null) || keys.length > 1 ||
      keys.some((key) => key !== "signal" || !Object.hasOwn(descriptors.signal!, "value") || descriptors.signal!.enumerable !== true)) invalid();
  const signal = descriptors.signal?.value;
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function") invalid();
  return signal as AbortSignal;
}

function safeFilename(value: string): boolean {
  return value.length > 0 && value.length <= 255 && value === value.trim() && value !== "." && value !== ".." &&
    !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !/[. ]$/u.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function positiveInteger(value: unknown): number | undefined {
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
function finitePositive(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim() !== "") value = Number(value);
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
function isMissingFile(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"); }
function invalid(): never { throw new OwnerElevenLabsStsOriginalProbeError("INVALID_ORIGINAL"); }
function limit(): never { throw new OwnerElevenLabsStsOriginalProbeError("ORIGINAL_LOCAL_LIMIT_EXCEEDED"); }
