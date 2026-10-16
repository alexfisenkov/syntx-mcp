import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, lstat, mkdtemp, open, realpath, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { types } from "node:util";

const MAX_BYTES = 30 * 1024 * 1024;
const MAX_STDOUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const INPUT_PREFIX = "syntx-wan30-edit-original-";
const MP4_FORMAT_NAMES = new Set(["mov,mp4,m4a,3gp,3g2,mj2", "mp4"]);
const UINT8_ARRAY_CONSTRUCTOR = Uint8Array;
const UINT8_ARRAY_PROTOTYPE = Uint8Array.prototype;
const BUFFER_PROTOTYPE = Buffer.prototype;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(UINT8_ARRAY_PROTOTYPE) as object;
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;
const ARRAY_BUFFER_PROTOTYPE = ArrayBuffer.prototype;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ARRAY_BUFFER_PROTOTYPE, "byteLength")?.get;
const TYPED_ARRAY_SET = UINT8_ARRAY_PROTOTYPE.set;
const ABORT_SIGNAL_PROTOTYPE = AbortSignal.prototype;
const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(ABORT_SIGNAL_PROTOTYPE, "aborted")?.get;
const EVENT_TARGET_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const EVENT_TARGET_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const BUFFER_ALLOC_UNSAFE = Buffer.allocUnsafe;
const BUFFER_ALLOC = Buffer.alloc;

export interface TrustedOwnerWan30EditOriginalProbeResult {
  readonly model_id: "wan_30_edit";
  readonly filename: string;
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly fps: number;
  readonly frame_count: number | null;
  readonly container_confidence: "LOCAL_FFPROBE_METADATA_ONLY";
  readonly generation_permit: false;
}

export class OwnerWan30EditOriginalProbeError extends Error {
  constructor(readonly code: "INVALID_ORIGINAL" | "ORIGINAL_LOCAL_LIMIT_EXCEEDED" | "PROBE_FAILED" | "PROBE_ABORTED") {
    super("WAN 3.0 Edit original video could not be safely probed.");
    this.name = "OwnerWan30EditOriginalProbeError";
  }
}

export interface OwnerWan30EditOriginalProbeRunner {
  probe(input: unknown): Promise<Readonly<TrustedOwnerWan30EditOriginalProbeResult>>;
}

interface RetainedReceipt { readonly bytes: Buffer; readonly sha256: string; }
const retainedReceipts = new WeakMap<object, RetainedReceipt>();
const resultDescriptors = new WeakMap<object, Readonly<Record<string, PropertyDescriptor>>>();

/** ffprobePath is absolute trusted operator configuration and is never accepted from the probe input. */
export function createOwnerWan30EditOriginalProbe(config: unknown): OwnerWan30EditOriginalProbeRunner {
  const { ffprobePath, timeoutMs } = exactConfig(config);
  return Object.freeze({ probe: (input: unknown) => probeOriginal(ffprobePath, timeoutMs, input) });
}

export function isTrustedOwnerWan30EditOriginalProbeResult(value: unknown): value is Readonly<TrustedOwnerWan30EditOriginalProbeResult> {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const retained = retainedReceipts.get(value), expected = resultDescriptors.get(value);
  if (!retained || !expected || !Object.isFrozen(value)) return false;
  const actual = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(actual), expectedKeys = Reflect.ownKeys(expected);
  return keys.length === expectedKeys.length && keys.every((key) => {
    const current = actual[key as keyof typeof actual], original = expected[key as keyof typeof expected];
    return expectedKeys.includes(key) && current !== undefined && original !== undefined && Object.hasOwn(current, "value") &&
      current.enumerable === original.enumerable && current.configurable === false && current.writable === false && current.value === original.value;
  }) && (value as TrustedOwnerWan30EditOriginalProbeResult).sha256 === retained.sha256;
}

export function copyTrustedOwnerWan30EditOriginalBytes(value: unknown): Uint8Array {
  if (!isTrustedOwnerWan30EditOriginalProbeResult(value)) invalid();
  const retained = retainedReceipts.get(value);
  if (!retained) invalid();
  const copy = Reflect.construct(UINT8_ARRAY_CONSTRUCTOR, [retained.bytes.byteLength]) as Uint8Array;
  Reflect.apply(TYPED_ARRAY_SET, copy, [retained.bytes]);
  return copy;
}

export function releaseTrustedOwnerWan30EditOriginalProbeResult(value: unknown): void {
  if (!isTrustedOwnerWan30EditOriginalProbeResult(value)) invalid();
  retainedReceipts.get(value)!.bytes.fill(0);
  retainedReceipts.delete(value);
  resultDescriptors.delete(value);
}

async function probeOriginal(ffprobePath: string, timeoutMs: number, input: unknown): Promise<Readonly<TrustedOwnerWan30EditOriginalProbeResult>> {
  const request = exactInput(input);
  if (!safeFilename(request.filename) || request.mime_type !== "video/mp4") invalid();
  const sourceView = readSourceBytes(request.bytes);
  const length = sourceView.byteLength;
  if (length < 16) invalid();
  if (length > MAX_BYTES) limit();
  if (request.signal && signalIsAborted(request.signal)) throw new OwnerWan30EditOriginalProbeError("PROBE_ABORTED");

  let source: Buffer | undefined;
  let directory: string | undefined, inputPath: string | undefined, createdFile = false, ownedCopy: Buffer | undefined;
  let mintedReceipt: Readonly<TrustedOwnerWan30EditOriginalProbeResult> | undefined;
  try {
    const executablePath = await validateFfprobePath(ffprobePath);
    source = allocateBuffer(length);
    Reflect.apply(TYPED_ARRAY_SET, source, [sourceView.view]);
    const sha256 = createHash("sha256").update(source).digest("hex");
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
      if (!info.isFile() || info.size !== length) invalid();
    } finally { await file.close(); }

    const stdout = await runFfprobe(executablePath, inputPath, timeoutMs, request.signal);
    if (request.signal && signalIsAborted(request.signal)) throw new OwnerWan30EditOriginalProbeError("PROBE_ABORTED");
    const measured = parseFfprobe(stdout);
    if (Math.abs(measured.duration - 2) > 0.001 || measured.width < 240 || measured.height < 240 ||
        measured.width > 8_000 || measured.height > 8_000 || measured.width * measured.height > 52_500_000 ||
        measured.fps < 16 || measured.fps > 120) limit();
    const after = await lstat(inputPath);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== length) invalid();
    if (request.signal && signalIsAborted(request.signal)) throw new OwnerWan30EditOriginalProbeError("PROBE_ABORTED");

    ownedCopy = Buffer.from(source);
    const result = Object.freeze({
      model_id: "wan_30_edit" as const,
      filename: request.filename,
      mime_type: "video/mp4" as const,
      size: length,
      sha256,
      width: measured.width,
      height: measured.height,
      duration_seconds: measured.duration,
      fps: measured.fps,
      frame_count: measured.frameCount,
      container_confidence: "LOCAL_FFPROBE_METADATA_ONLY" as const,
      generation_permit: false as const
    });
    mintedReceipt = result;
    retainedReceipts.set(result, { bytes: ownedCopy, sha256 });
    resultDescriptors.set(result, Object.getOwnPropertyDescriptors(result));
    ownedCopy = undefined;
    return result;
  } catch (error) {
    ownedCopy?.fill(0);
    if (error instanceof OwnerWan30EditOriginalProbeError) throw error;
    if (request.signal && signalIsAborted(request.signal)) throw new OwnerWan30EditOriginalProbeError("PROBE_ABORTED");
    throw new OwnerWan30EditOriginalProbeError("PROBE_FAILED");
  } finally {
    source?.fill(0);
    let cleanupFailed = false;
    if (createdFile && inputPath) {
      try { await wipeAndUnlink(inputPath); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    if (directory) {
      try { await rmdir(directory); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    if (cleanupFailed) {
      if (mintedReceipt) {
        retainedReceipts.get(mintedReceipt)?.bytes.fill(0);
        retainedReceipts.delete(mintedReceipt);
        resultDescriptors.delete(mintedReceipt);
      }
      throw new OwnerWan30EditOriginalProbeError("PROBE_FAILED");
    }
    if (request.signal && signalIsAborted(request.signal)) {
      if (mintedReceipt) {
        retainedReceipts.get(mintedReceipt)?.bytes.fill(0);
        retainedReceipts.delete(mintedReceipt);
        resultDescriptors.delete(mintedReceipt);
      }
      throw new OwnerWan30EditOriginalProbeError("PROBE_ABORTED");
    }
  }
}

async function validateFfprobePath(path: string): Promise<string> {
  try {
    const info = await lstat(path);
    if (!info.isFile() && !info.isSymbolicLink()) invalid();
    const resolvedPath = await realpath(path);
    const resolvedInfo = await lstat(resolvedPath);
    if (!resolvedInfo.isFile() || resolvedInfo.isSymbolicLink()) invalid();
    if (process.platform === "win32") {
      if (!/\.exe$/i.test(resolvedPath)) invalid();
      await access(resolvedPath, fsConstants.R_OK);
    } else {
      const ownerUid = process.getuid?.();
      if (ownerUid === undefined || (resolvedInfo.uid !== 0 && resolvedInfo.uid !== ownerUid) || (resolvedInfo.mode & 0o022) !== 0) invalid();
      await access(resolvedPath, fsConstants.X_OK | fsConstants.R_OK);
    }
    return resolvedPath;
  } catch { invalid(); }
}

async function wipeAndUnlink(path: string): Promise<void> {
  const file = await open(path, fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_BYTES) invalid();
    const zeros = allocateBuffer(Math.min(64 * 1024, Math.max(1, info.size)), true);
    for (let offset = 0; offset < info.size; offset += zeros.length) await file.write(zeros, 0, Math.min(zeros.length, info.size - offset), offset);
    zeros.fill(0);
    await file.sync();
  } finally { await file.close(); }
  await unlink(path);
}

function runFfprobe(path: string, inputPath: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const args = ["-v", "error", "-protocol_whitelist", "file", "-show_entries",
    "stream=codec_type,width,height,avg_frame_rate,r_frame_rate,duration,nb_frames:format=duration,format_name", "-of", "json", inputPath];
  const options: ExecFileOptionsWithStringEncoding = {
    encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: MAX_STDOUT_BYTES,
    windowsHide: true, ...(signal ? { signal } : {}), env: { PATH: "", LANG: "C", LC_ALL: "C" }
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
    } catch { reject(new Error("ffprobe could not be started.")); }
  });
}

function parseFfprobe(output: string): { width: number; height: number; duration: number; fps: number; frameCount: number | null } {
  let root: unknown;
  try { root = JSON.parse(output); } catch { return invalid(); }
  if (!isRecord(root) || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > 32 || !isRecord(root.format) ||
      typeof root.format.format_name !== "string" || !MP4_FORMAT_NAMES.has(root.format.format_name)) return invalid();
  const streams: Record<string, unknown>[] = [];
  for (const item of root.streams) {
    if (!isRecord(item) || typeof item.codec_type !== "string" || !/^[a-z0-9_+-]{1,24}$/i.test(item.codec_type)) return invalid();
    streams.push(item);
  }
  const videos = streams.filter((stream) => stream.codec_type === "video");
  if (videos.length !== 1 || streams.some((stream) => stream.codec_type === "audio")) return invalid();
  const video = videos[0]!;
  const width = positiveInteger(video.width), height = positiveInteger(video.height);
  const formatDuration = finitePositive(root.format.duration), streamDuration = finitePositive(video.duration);
  const averageRate = parseRate(video.avg_frame_rate), nominalRate = parseRate(video.r_frame_rate);
  if (!width || !height || formatDuration === undefined || streamDuration === undefined ||
      Math.abs(formatDuration - streamDuration) > 0.001 || !averageRate || !nominalRate) return invalid();
  const fps = averageRate.numerator / averageRate.denominator;
  const nominalFps = nominalRate.numerator / nominalRate.denominator;
  if (!Number.isFinite(fps) || !Number.isFinite(nominalFps) || Math.abs(fps - nominalFps) > 0.001) return invalid();
  return { width, height, duration: formatDuration, fps, frameCount: positiveInteger(video.nb_frames) ?? null };
}

function hasMp4Brand(bytes: Buffer): boolean {
  if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;
  const size = bytes.readUInt32BE(0);
  if (size < 16 || size > 1_024 || size > bytes.length || (size - 16) % 4 !== 0) return false;
  const brands = [bytes.toString("ascii", 8, 12)];
  for (let offset = 16; offset < size; offset += 4) brands.push(bytes.toString("ascii", offset, offset + 4));
  return !brands.includes("qt  ") && (brands.includes("isom") || brands.some((brand) => /^(?:iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash|cmfc|cmfs)$/.test(brand)));
}

function parseRate(value: unknown): { numerator: number; denominator: number } | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) return undefined;
  const numerator = Number(match[1]), denominator = Number(match[2]);
  return Number.isSafeInteger(numerator) && numerator > 0 && Number.isSafeInteger(denominator) && denominator > 0
    ? { numerator, denominator } : undefined;
}

function exactConfig(config: unknown): { ffprobePath: string; timeoutMs: number } {
  if (!config || typeof config !== "object" || types.isProxy(config) || Array.isArray(config)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(config), keys = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(config) !== Object.prototype && Object.getPrototypeOf(config) !== null) ||
      keys.length < 1 || keys.length > 2 || !keys.includes("ffprobePath") ||
      keys.some((key) => typeof key !== "string" || !["ffprobePath", "timeoutMs"].includes(key) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
  const path = descriptors.ffprobePath!.value;
  const timeoutMs = descriptors.timeoutMs?.value ?? DEFAULT_TIMEOUT_MS;
  if (typeof path !== "string" || !isAbsolute(path) || path !== path.trim() || path.includes("\0") || basename(path) === "" ||
      typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) invalid();
  return { ffprobePath: path, timeoutMs };
}

interface ProbeInput { readonly filename: string; readonly mime_type: "video/mp4"; readonly bytes: Uint8Array; readonly signal?: AbortSignal; }
function exactInput(input: unknown): ProbeInput {
  if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors), required = ["filename", "mime_type", "bytes"];
  if ((Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) || keys.length < 3 || keys.length > 4 ||
      keys.some((key) => typeof key !== "string" || (![...required, "signal"].includes(key)) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) ||
      required.some((key) => !keys.includes(key))) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  if (typeof result.filename !== "string" || typeof result.mime_type !== "string") invalid();
  const signal = result.signal === undefined ? undefined : exactSignal(result.signal);
  return { filename: result.filename, mime_type: result.mime_type as "video/mp4", bytes: result.bytes as Uint8Array, ...(signal ? { signal } : {}) };
}

function exactSignal(signal: unknown): AbortSignal {
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || Object.getPrototypeOf(signal) !== ABORT_SIGNAL_PROTOTYPE || !ABORT_SIGNAL_ABORTED_GETTER) invalid();
  try {
    if (typeof Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) !== "boolean") invalid();
    for (const key of Reflect.ownKeys(signal)) {
      if (typeof key !== "symbol") invalid();
      const descriptor = Object.getOwnPropertyDescriptor(signal, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) invalid();
    }
    const listener = () => undefined;
    Reflect.apply(EVENT_TARGET_ADD_EVENT_LISTENER, signal, ["abort", listener]);
    Reflect.apply(EVENT_TARGET_REMOVE_EVENT_LISTENER, signal, ["abort", listener]);
  } catch { invalid(); }
  return signal as AbortSignal;
}

function signalIsAborted(signal: AbortSignal): boolean {
  if (!ABORT_SIGNAL_ABORTED_GETTER) invalid();
  try { return Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) as boolean; }
  catch { invalid(); }
}

function readSourceBytes(value: unknown): { view: Uint8Array; byteLength: number } {
  if (!value || typeof value !== "object" || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== UINT8_ARRAY_PROTOTYPE && prototype !== BUFFER_PROTOTYPE) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length")) invalid();
  if (!BYTE_LENGTH_GETTER || !BUFFER_GETTER || !BYTE_OFFSET_GETTER || !ARRAY_BUFFER_BYTE_LENGTH_GETTER) invalid();
  let byteLength: number, backing: ArrayBuffer, byteOffset: number, backingByteLength: number;
  try {
    byteLength = Reflect.apply(BYTE_LENGTH_GETTER, value, []) as number;
    backing = Reflect.apply(BUFFER_GETTER, value, []) as ArrayBuffer;
    byteOffset = Reflect.apply(BYTE_OFFSET_GETTER, value, []) as number;
    if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ARRAY_BUFFER_PROTOTYPE || Object.hasOwn(backing, "byteLength")) invalid();
    backingByteLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, backing, []) as number;
  } catch { invalid(); }
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || !Number.isSafeInteger(byteOffset) || byteOffset < 0 ||
      !Number.isSafeInteger(backingByteLength) || byteOffset + byteLength > backingByteLength) invalid();
  try { return { view: Reflect.construct(UINT8_ARRAY_CONSTRUCTOR, [backing, byteOffset, byteLength]) as Uint8Array, byteLength }; }
  catch { invalid(); }
}

function allocateBuffer(length: number, zeroed = false): Buffer {
  return Reflect.apply(zeroed ? BUFFER_ALLOC : BUFFER_ALLOC_UNSAFE, Buffer, [length]) as Buffer;
}
function safeFilename(value: string): boolean {
  return value.length > 0 && value.length <= 255 && value === value.trim() && value !== "." && value !== ".." &&
    !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !/[. ]$/u.test(value) && value.toLowerCase().endsWith(".mp4");
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
function invalid(): never { throw new OwnerWan30EditOriginalProbeError("INVALID_ORIGINAL"); }
function limit(): never { throw new OwnerWan30EditOriginalProbeError("ORIGINAL_LOCAL_LIMIT_EXCEEDED"); }
