import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { types } from "node:util";

export const OWNER_WAN26_I2V_AUDIO_PROBE_POLICY = Object.freeze({
  policy_id: "OWNER_WAN26_I2V_AUDIO_PROBE_B066_LOCAL_GUARD_V1",
  catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
  model_ids: Object.freeze(["wan_26_i2v", "wan_26_i2v_flash"] as const),
  limits: Object.freeze({ max_file_size_bytes: 10_485_760, min_duration_seconds: 3, max_duration_seconds: 30 }),
  kind: "HISTORICAL_CATALOG_LOCAL_GUARD_NOT_PROVIDER_PROOF"
} as const);

const MAX_BYTES = OWNER_WAN26_I2V_AUDIO_PROBE_POLICY.limits.max_file_size_bytes;
const MAX_STDOUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const INPUT_PREFIX = "syntx-wan26-i2v-audio-probe-";
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const ARRAY_BUFFER_RESIZABLE_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const ARRAY_BUFFER_DETACHED_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "detached")?.get;
const MIME_TO_CONTAINER = Object.freeze({ "audio/mp3": "MP3", "audio/mpeg": "MP3", "audio/wav": "WAV", "audio/x-wav": "WAV" } as const);
const WAV_PCM_CODECS = new Set(["pcm_u8", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_f64le"]);

export type OwnerWan26I2vAudioModelId = typeof OWNER_WAN26_I2V_AUDIO_PROBE_POLICY.model_ids[number];
export type OwnerWan26I2vAudioMime = keyof typeof MIME_TO_CONTAINER;
export interface OwnerWan26I2vAudioProbeInput {
  readonly model_id: OwnerWan26I2vAudioModelId;
  readonly filename: string;
  readonly mime_type: OwnerWan26I2vAudioMime;
  readonly bytes: Uint8Array;
}
export interface OwnerWan26I2vAudioProbeMetadata {
  readonly container: "MP3" | "WAV";
  readonly codec_name: string;
  readonly sample_rate: number;
  readonly channels: number;
  readonly duration_seconds: number;
  readonly decoded_frame_count: number;
}
export interface OwnerWan26I2vAudioProbeResult {
  readonly status: "TRUSTED_LOCAL_AUDIO_PROBE";
  readonly model_id: OwnerWan26I2vAudioModelId;
  readonly filename: string;
  readonly source_mime_type: OwnerWan26I2vAudioMime;
  readonly mime_type: "audio/mpeg" | "audio/wav";
  readonly bytes_copied: number;
  readonly source_sha256: string;
  readonly metadata: Readonly<OwnerWan26I2vAudioProbeMetadata>;
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}
export class OwnerWan26I2vAudioProbeError extends Error {
  constructor(readonly code: "INVALID_ORIGINAL" | "ORIGINAL_LOCAL_LIMIT_EXCEEDED" | "PROBE_FAILED" | "PROBE_ABORTED") {
    super("WAN 2.6 I2V original audio could not be safely probed.");
    this.name = "OwnerWan26I2vAudioProbeError";
  }
}
export interface OwnerWan26I2vAudioProbeRunner {
  probe(input: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerWan26I2vAudioProbeResult>>;
}

/** ffprobePath is trusted absolute server configuration, never request data. */
export function createOwnerWan26I2vAudioProbe(config: unknown): OwnerWan26I2vAudioProbeRunner {
  const ffprobePath = exactConfig(config);
  return Object.freeze({ probe: (input: unknown, options?: Readonly<{ signal?: AbortSignal }>) => probeOriginal(ffprobePath, input, options) });
}

const retainedBytes = new WeakMap<object, Buffer>();
const resultDescriptors = new WeakMap<object, Readonly<Record<string, PropertyDescriptor>>>();

export function isTrustedOwnerWan26I2vAudioProbeResult(value: unknown): value is Readonly<OwnerWan26I2vAudioProbeResult> {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const bytes = retainedBytes.get(value), expected = resultDescriptors.get(value);
  if (!bytes || !expected || !Object.isFrozen(value)) return false;
  const actual = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(actual), expectedKeys = Reflect.ownKeys(expected);
  return keys.length === expectedKeys.length && keys.every((key) => {
    const current = actual[key as keyof typeof actual], original = expected[key as keyof typeof expected];
    return expectedKeys.includes(key) && current !== undefined && original !== undefined && Object.hasOwn(current, "value") &&
      current.enumerable === original.enumerable && current.configurable === false && current.writable === false && current.value === original.value;
  });
}

/** Returns a fresh byte copy only for genuine, unchanged local probe evidence. */
export function copyTrustedOwnerWan26I2vAudioBytes(value: unknown): Uint8Array {
  if (!isTrustedOwnerWan26I2vAudioProbeResult(value)) invalid();
  const bytes = retainedBytes.get(value);
  if (!bytes) invalid();
  return new Uint8Array(bytes);
}

/** Wipes and revokes the private bytes after their future upload consumer finishes. */
export function releaseTrustedOwnerWan26I2vAudioProbeResult(value: unknown): void {
  if (!isTrustedOwnerWan26I2vAudioProbeResult(value)) invalid();
  retainedBytes.get(value)!.fill(0);
  retainedBytes.delete(value);
  resultDescriptors.delete(value);
}

async function probeOriginal(ffprobePath: string, input: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerWan26I2vAudioProbeResult>> {
  const request = exactInput(input), signal = exactOptions(options);
  if (!Object.hasOwn(MIME_TO_CONTAINER, request.mime_type)) invalid();
  const expectedContainer = MIME_TO_CONTAINER[request.mime_type];
  const extension = extname(request.filename).toLowerCase();
  if (!OWNER_WAN26_I2V_AUDIO_PROBE_POLICY.model_ids.includes(request.model_id) || !expectedContainer || !safeFilename(request.filename) ||
      (expectedContainer === "MP3" ? extension !== ".mp3" : extension !== ".wav") ||
      types.isProxy(request.bytes) || !(request.bytes instanceof Uint8Array) ||
      (!Buffer.isBuffer(request.bytes) && Object.getPrototypeOf(request.bytes) !== Uint8Array.prototype)) invalid();
  if (signal?.aborted) throw new OwnerWan26I2vAudioProbeError("PROBE_ABORTED");

  const source = readSourceBytes(request.bytes);
  const length = source.byteLength;
  if (length < 16) invalid();
  if (length > MAX_BYTES) limit();

  const sourceCopy = Buffer.allocUnsafe(length);
  try { Uint8Array.prototype.set.call(sourceCopy, source); }
  catch { sourceCopy.fill(0); invalid(); }
  const sourceSha256 = createHash("sha256").update(sourceCopy).digest("hex");

  let directory: string | undefined, inputPath: string | undefined, createdFile = false, ownedCopy: Buffer | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), INPUT_PREFIX));
    await chmod(directory, 0o700);
    inputPath = join(directory, expectedContainer === "MP3" ? "source.mp3" : "source.wav");
    const file = await open(inputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    createdFile = true;
    try {
      await file.chmod(0o600);
      await file.writeFile(sourceCopy);
      await file.sync();
      const info = await file.stat();
      if (!info.isFile() || info.size !== sourceCopy.byteLength) invalid();
    } finally { await file.close(); }

    const metadata = parseProbe(await runFfprobe(ffprobePath, inputPath, signal), expectedContainer);
    if (metadata.durationSeconds < OWNER_WAN26_I2V_AUDIO_PROBE_POLICY.limits.min_duration_seconds ||
        metadata.durationSeconds > OWNER_WAN26_I2V_AUDIO_PROBE_POLICY.limits.max_duration_seconds) limit();
    const after = await lstat(inputPath);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== sourceCopy.byteLength) invalid();
    ownedCopy = Buffer.from(sourceCopy);
    const result = Object.freeze({
      status: "TRUSTED_LOCAL_AUDIO_PROBE" as const, model_id: request.model_id,
      filename: request.filename, source_mime_type: request.mime_type,
      mime_type: expectedContainer === "MP3" ? "audio/mpeg" as const : "audio/wav" as const,
      bytes_copied: sourceCopy.byteLength, source_sha256: sourceSha256,
      metadata: Object.freeze({ container: expectedContainer, codec_name: metadata.codecName, sample_rate: metadata.sampleRate,
        channels: metadata.channels, duration_seconds: metadata.durationSeconds, decoded_frame_count: metadata.frameCount }),
      dispatch_allowed: false as const, runtime_usable: false as const, owner_upload_binding: "NOT_ESTABLISHED" as const
    });
    retainedBytes.set(result, ownedCopy);
    resultDescriptors.set(result, Object.getOwnPropertyDescriptors(result));
    ownedCopy = undefined;
    return result;
  } catch (error) {
    ownedCopy?.fill(0);
    if (error instanceof OwnerWan26I2vAudioProbeError) throw error;
    if (signal?.aborted) throw new OwnerWan26I2vAudioProbeError("PROBE_ABORTED");
    throw new OwnerWan26I2vAudioProbeError("PROBE_FAILED");
  } finally {
    sourceCopy.fill(0);
    let cleanupFailed = false;
    if (createdFile && inputPath) {
      try { await unlink(inputPath); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    if (directory) {
      try { await rmdir(directory); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    if (cleanupFailed) throw new OwnerWan26I2vAudioProbeError("PROBE_FAILED");
  }
}

function runFfprobe(path: string, input: string, signal?: AbortSignal): Promise<string> {
  const args = ["-v", "error", "-protocol_whitelist", "file,pipe", "-count_frames", "-show_entries",
    "stream=codec_type,codec_name,sample_rate,channels,nb_read_frames,duration:format=duration,format_name", "-of", "json", input];
  const options: ExecFileOptionsWithStringEncoding = {
    encoding: "utf8", timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: MAX_STDOUT_BYTES,
    windowsHide: true, signal, env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" }
  };
  return new Promise((resolve, reject) => {
    let spawned = false, spawnFailed = false, callbackDone = false, closed = false, settled = false;
    let callbackError: Error | null = null, output: string | undefined, closeCode: number | null = null, closeSignal: NodeJS.Signals | null = null;
    const settle = () => {
      if (settled || !callbackDone || (!closed && !spawnFailed)) return;
      settled = true;
      if (callbackError) { reject(callbackError); return; }
      if (closeCode !== 0 || closeSignal !== null || output === undefined) { reject(new Error("ffprobe did not exit successfully.")); return; }
      resolve(output);
    };
    try {
      const child = execFileCallback(path, args, options, (error, stdout) => {
        callbackDone = true; callbackError = error; output = typeof stdout === "string" ? stdout : undefined; settle();
      });
      child.once("spawn", () => { spawned = true; });
      child.once("error", (error) => { if (!spawned) { spawnFailed = true; callbackDone = true; } callbackError ??= error; settle(); });
      child.once("close", (code, reason) => { closed = true; closeCode = code; closeSignal = reason; settle(); });
    } catch (error) { reject(error instanceof Error ? error : new Error("ffprobe could not be started.")); }
  });
}

function parseProbe(output: string, container: "MP3" | "WAV"): { codecName: string; sampleRate: number; channels: number; durationSeconds: number; frameCount: number } {
  let root: unknown;
  try { root = JSON.parse(output); } catch { return invalid(); }
  const expectedFormat = container === "MP3" ? "mp3" : "wav";
  if (!isRecord(root) || !Array.isArray(root.streams) || root.streams.length !== 1 || !isRecord(root.format) || root.format.format_name !== expectedFormat) return invalid();
  const stream = root.streams[0];
  if (!isRecord(stream) || stream.codec_type !== "audio" || typeof stream.codec_name !== "string" ||
      (container === "MP3" ? stream.codec_name !== "mp3" : !WAV_PCM_CODECS.has(stream.codec_name))) return invalid();
  const sampleRate = positiveInteger(stream.sample_rate), channels = positiveInteger(stream.channels), frameCount = positiveInteger(stream.nb_read_frames);
  const durationSeconds = finitePositive(stream.duration === undefined ? root.format.duration : stream.duration);
  if (sampleRate === undefined || channels === undefined || frameCount === undefined || durationSeconds === undefined) return invalid();
  return { codecName: stream.codec_name, sampleRate, channels, durationSeconds, frameCount };
}

function exactConfig(config: unknown): string {
  if (!config || typeof config !== "object" || types.isProxy(config) || Array.isArray(config)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(config), keys = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(config) !== Object.prototype && Object.getPrototypeOf(config) !== null) || keys.length !== 1 || keys[0] !== "ffprobePath" ||
      !Object.hasOwn(descriptors.ffprobePath!, "value") || descriptors.ffprobePath!.enumerable !== true) invalid();
  const path = descriptors.ffprobePath!.value;
  if (typeof path !== "string" || !isAbsolute(path) || path !== path.trim() || path.includes("\0") || basename(path) === "") invalid();
  return path;
}
function exactInput(input: unknown): OwnerWan26I2vAudioProbeInput {
  if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors), required = ["model_id", "filename", "mime_type", "bytes"];
  if ((Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) || keys.length !== required.length ||
      keys.some((key) => typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  if (typeof result.filename !== "string" || typeof result.mime_type !== "string" || typeof result.model_id !== "string") invalid();
  return result as unknown as OwnerWan26I2vAudioProbeInput;
}
function exactOptions(options: Readonly<{ signal?: AbortSignal }> | undefined): AbortSignal | undefined {
  if (options === undefined) return undefined;
  if (!options || typeof options !== "object" || types.isProxy(options) || Array.isArray(options)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(options), keys = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null) || keys.length > 1 ||
      keys.some((key) => key !== "signal" || !Object.hasOwn(descriptors.signal!, "value") || descriptors.signal!.enumerable !== true)) invalid();
  const signal = descriptors.signal?.value;
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function") invalid();
  return signal as AbortSignal;
}
function readSourceBytes(value: unknown): Uint8Array {
  if (types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") ||
      Object.hasOwn(value, "length") || Object.hasOwn(value, "constructor") || Object.getOwnPropertySymbols(value).length > 0) invalid();
  let length: number, backing: ArrayBuffer, offset: number;
  try {
    length = Reflect.apply(BYTE_LENGTH_GETTER, value, []) as number;
    backing = Reflect.apply(BUFFER_GETTER, value, []) as ArrayBuffer;
    offset = Reflect.apply(OFFSET_GETTER, value, []) as number;
  } catch { return invalid(); }
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset) || offset < 0 || types.isProxy(backing) ||
      Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || Object.hasOwn(backing, "byteLength")) invalid();
  let backingLength: number;
  try {
    backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []) as number;
    if (ARRAY_BUFFER_RESIZABLE_GETTER && Reflect.apply(ARRAY_BUFFER_RESIZABLE_GETTER, backing, []) === true) invalid();
    if (ARRAY_BUFFER_DETACHED_GETTER && Reflect.apply(ARRAY_BUFFER_DETACHED_GETTER, backing, []) === true) invalid();
  } catch { return invalid(); }
  if (!Number.isSafeInteger(backingLength) || offset + length > backingLength) invalid();
  if (length > MAX_BYTES) limit();
  try { return new Uint8Array(backing, offset, length); }
  catch { return invalid(); }
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
function invalid(): never { throw new OwnerWan26I2vAudioProbeError("INVALID_ORIGINAL"); }
function limit(): never { throw new OwnerWan26I2vAudioProbeError("ORIGINAL_LOCAL_LIMIT_EXCEEDED"); }
