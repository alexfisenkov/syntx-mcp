import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { types } from "node:util";

const WAN26_R2V_MODELS = ["wan_26_r2v", "wan_26_r2v_flash"] as const;
const CATALOG_MAX_BYTES = 1_048_576_000;
const CURRENT_PUBLIC_MAX_BYTES = 100 * 1024 * 1024;
const CURRENT_PUBLIC_MAX_SIDE = 4_096;
const MAX_STDOUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const INPUT_PREFIX = "syntx-wan26-r2v-probe-";
const ACCEPTED_FORMAT = "mov,mp4,m4a,3gp,3g2,mj2";
const UINT8_ARRAY_CONSTRUCTOR = Uint8Array;
const UINT8_ARRAY_PROTOTYPE = Uint8Array.prototype;
const BUFFER_PROTOTYPE = Buffer.prototype;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(UINT8_ARRAY_PROTOTYPE) as object;
const TYPED_ARRAY_SET = UINT8_ARRAY_PROTOTYPE.set;
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;
const ARRAY_BUFFER_PROTOTYPE = ArrayBuffer.prototype;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ARRAY_BUFFER_PROTOTYPE, "byteLength")?.get;
const BUFFER_ALLOC_UNSAFE = Buffer.allocUnsafe;
const BUFFER_ALLOC = Buffer.alloc;
const ABORT_SIGNAL_PROTOTYPE = AbortSignal.prototype;
const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(ABORT_SIGNAL_PROTOTYPE, "aborted")?.get;
const EVENT_TARGET_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const EVENT_TARGET_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
let activeProbe = false;

export const WAN26_R2V_ORIGINAL_VIDEO_POLICY = Object.freeze({
  policy_id: "OWNER_WAN26_R2V_ORIGINAL_VIDEO_POLICY_C396_LOCAL_GUARD_V1",
  public_catalog_version: "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json",
  public_catalog_fetched_at: "2026-10-15T07:17:24.901Z",
  catalog_build_id: "1791904852",
  catalog_model_data_sha256: "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a",
  model_ids: WAN26_R2V_MODELS,
  catalog_limits: Object.freeze({
    max_file_size_bytes: CATALOG_MAX_BYTES,
    min_side: 384,
    max_side: 5_000,
    min_duration_seconds: 1,
    max_duration_seconds: 30,
    accepted_video_mime_types: Object.freeze(["video/mp4", "video/mov"] as const),
    prohibited_codecs: Object.freeze([] as string[])
  }),
  current_public_observation: Object.freeze({ max_file_size_bytes: CURRENT_PUBLIC_MAX_BYTES,
    max_side: CURRENT_PUBLIC_MAX_SIDE, status: "FETCHED_2026_10_29_NOT_ARCHIVED" as const }),
  operator_limit_kind: "LOCAL_MEMORY_COPY_GUARD_NOT_VENDOR_LIMIT",
  default_operator_local_max_bytes: 104_857_600,
  max_operator_local_max_bytes: CURRENT_PUBLIC_MAX_BYTES,
  concurrency: "ONE_ACTIVE_PROBE_PER_PROCESS_FAIL_FAST"
} as const);

const DEFAULT_LOCAL_MAX_BYTES = WAN26_R2V_ORIGINAL_VIDEO_POLICY.default_operator_local_max_bytes;
const MAX_LOCAL_MAX_BYTES = CURRENT_PUBLIC_MAX_BYTES;

export interface OwnerWan26R2vOriginalProbeInput {
  readonly model_id: typeof WAN26_R2V_MODELS[number];
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/mov";
  readonly bytes: Uint8Array;
}

export interface OwnerWan26R2vOriginalProbeResult {
  readonly status: "TRUSTED_LOCAL_MEDIA_PROBE";
  readonly model_id: typeof WAN26_R2V_MODELS[number];
  readonly source_policy_id: typeof WAN26_R2V_ORIGINAL_VIDEO_POLICY.policy_id;
  readonly source_catalog_version: typeof WAN26_R2V_ORIGINAL_VIDEO_POLICY.public_catalog_version;
  readonly source_catalog_fetched_at: typeof WAN26_R2V_ORIGINAL_VIDEO_POLICY.public_catalog_fetched_at;
  readonly source_catalog_build_id: typeof WAN26_R2V_ORIGINAL_VIDEO_POLICY.catalog_build_id;
  readonly source_catalog_model_data_sha256: typeof WAN26_R2V_ORIGINAL_VIDEO_POLICY.catalog_model_data_sha256;
  readonly source_sha256: string;
  readonly filename: string;
  /** Preserves the catalog MIME spelling; `video/mov` is not rewritten to `video/quicktime`. */
  readonly mime_type: "video/mp4" | "video/mov";
  readonly bytes_copied: number;
  readonly operator_local_max_bytes: number;
  readonly local_guard_id: "LOCAL_MEMORY_COPY_GUARD_NOT_VENDOR_LIMIT";
  readonly metadata: Readonly<{
    container: "ISO_BMFF_MOV_MP4";
    codec_streams: readonly Readonly<{ type: string; codec_name: string }>[];
    width: number;
    height: number;
    duration_seconds: number;
    frame_rate: Readonly<{ numerator: number; denominator: number }>;
    decoded_frame_count: number;
  }>;
  readonly generation_permit: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
  readonly selection_crop: "NOT_PERFORMED";
}

export class OwnerWan26R2vOriginalProbeError extends Error {
  constructor(readonly code: "INVALID_ORIGINAL" | "ORIGINAL_LOCAL_LIMIT_EXCEEDED" | "LOCAL_RESOURCE_BUSY" | "PROBE_FAILED" | "PROBE_ABORTED") {
    super("WAN 2.6 R2V original video could not be safely probed.");
    this.name = "OwnerWan26R2vOriginalProbeError";
  }
}

export interface OwnerWan26R2vOriginalProbeRunner {
  probe(input: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerWan26R2vOriginalProbeResult>>;
}

/** ffprobePath and the optional copy guard are trusted operator configuration, never request data. */
export function createOwnerWan26R2vOriginalProbe(config: unknown): OwnerWan26R2vOriginalProbeRunner {
  const { ffprobePath, operatorLocalMaxBytes } = exactConfig(config);
  return Object.freeze({ probe: (input: unknown, options?: Readonly<{ signal?: AbortSignal }>) =>
    probeOriginal(ffprobePath, operatorLocalMaxBytes, input, options) });
}

interface RetainedReceipt {
  readonly bytes: Buffer;
  readonly modelId: typeof WAN26_R2V_MODELS[number];
  readonly sourceSha256: string;
}

const retainedReceipts = new WeakMap<object, RetainedReceipt>();
const resultDescriptors = new WeakMap<object, Readonly<Record<string, PropertyDescriptor>>>();

export function isTrustedOwnerWan26R2vOriginalProbeResult(value: unknown): value is Readonly<OwnerWan26R2vOriginalProbeResult> {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const retained = retainedReceipts.get(value), expected = resultDescriptors.get(value);
  if (!retained || !expected || !Object.isFrozen(value)) return false;
  const actual = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(actual), expectedKeys = Reflect.ownKeys(expected);
  return keys.length === expectedKeys.length && keys.every((key) => {
    const current = actual[key as keyof typeof actual], original = expected[key as keyof typeof expected];
    return expectedKeys.includes(key) && current !== undefined && original !== undefined && Object.hasOwn(current, "value") &&
      current.enumerable === original.enumerable && current.configurable === false && current.writable === false && current.value === original.value;
  }) && (value as OwnerWan26R2vOriginalProbeResult).model_id === retained.modelId &&
    (value as OwnerWan26R2vOriginalProbeResult).source_sha256 === retained.sourceSha256;
}

/** A private-copy seam for a future owner-upload consumer; this alone grants no upload authority. */
export function copyTrustedOwnerWan26R2vOriginalBytes(value: unknown): Uint8Array {
  if (!isTrustedOwnerWan26R2vOriginalProbeResult(value)) invalid();
  const retained = retainedReceipts.get(value);
  if (!retained) invalid();
  const copy = Reflect.construct(UINT8_ARRAY_CONSTRUCTOR, [retained.bytes.byteLength]) as Uint8Array;
  Reflect.apply(TYPED_ARRAY_SET, copy, [retained.bytes]);
  return copy;
}

/** Wipes and revokes private retained bytes after a future owner-upload consumer finishes. */
export function releaseTrustedOwnerWan26R2vOriginalProbeResult(value: unknown): void {
  if (!isTrustedOwnerWan26R2vOriginalProbeResult(value)) invalid();
  retainedReceipts.get(value)!.bytes.fill(0);
  retainedReceipts.delete(value);
  resultDescriptors.delete(value);
}

async function probeOriginal(
  ffprobePath: string,
  operatorLocalMaxBytes: number,
  input: unknown,
  options?: Readonly<{ signal?: AbortSignal }>
): Promise<Readonly<OwnerWan26R2vOriginalProbeResult>> {
  const request = exactInput(input), signal = exactOptions(options);
  const extension = extname(request.filename).toLowerCase();
  if (!safeFilename(request.filename) || !WAN26_R2V_MODELS.includes(request.model_id) ||
      (request.mime_type !== "video/mp4" && request.mime_type !== "video/mov") ||
      (request.mime_type === "video/mp4" ? extension !== ".mp4" : extension !== ".mov")) invalid();
  if (signal && signalIsAborted(signal)) throw new OwnerWan26R2vOriginalProbeError("PROBE_ABORTED");

  const sourceView = readSourceBytes(request.bytes);
  const length = sourceView.byteLength;
  if (length < 16) invalid();
  if (length > operatorLocalMaxBytes) limit();
  if (activeProbe) throw new OwnerWan26R2vOriginalProbeError("LOCAL_RESOURCE_BUSY");
  activeProbe = true;

  let source: Buffer | undefined;
  let directory: string | undefined, inputPath: string | undefined, createdFile = false, ownedCopy: Buffer | undefined;
  let mintedReceipt: Readonly<OwnerWan26R2vOriginalProbeResult> | undefined;
  try {
    source = allocateBuffer(length);
    Reflect.apply(TYPED_ARRAY_SET, source, [sourceView.view]);
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    if (!hasMatchingBmffBrand(source, request.mime_type)) invalid();

    directory = await mkdtemp(join(tmpdir(), INPUT_PREFIX));
    await chmod(directory, 0o700);
    inputPath = join(directory, request.mime_type === "video/mp4" ? "source.mp4" : "source.mov");
    const file = await open(inputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    createdFile = true;
    try {
      await file.chmod(0o600);
      await file.writeFile(source);
      await file.sync();
      const info = await file.stat();
      if (!info.isFile() || info.size !== length) invalid();
    } finally { await file.close(); }

    const measured = parseFfprobe(await runFfprobe(ffprobePath, inputPath, signal));
    const pinnedBounds = WAN26_R2V_ORIGINAL_VIDEO_POLICY.catalog_limits;
    const currentBounds = WAN26_R2V_ORIGINAL_VIDEO_POLICY.current_public_observation;
    if (measured.duration < pinnedBounds.min_duration_seconds || measured.duration > pinnedBounds.max_duration_seconds ||
        measured.width < pinnedBounds.min_side || measured.height < pinnedBounds.min_side ||
        measured.width > currentBounds.max_side || measured.height > currentBounds.max_side) limit();
    const after = await lstat(inputPath);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== length) invalid();

    ownedCopy = Buffer.from(source);
    const metadata = Object.freeze({
      container: "ISO_BMFF_MOV_MP4" as const,
      codec_streams: Object.freeze(measured.codecStreams.map((stream) => Object.freeze(stream))),
      width: measured.width,
      height: measured.height,
      duration_seconds: measured.duration,
      frame_rate: Object.freeze(measured.frameRate),
      decoded_frame_count: measured.frames
    });
    const result = Object.freeze({
      status: "TRUSTED_LOCAL_MEDIA_PROBE" as const,
      model_id: request.model_id,
      source_policy_id: WAN26_R2V_ORIGINAL_VIDEO_POLICY.policy_id,
      source_catalog_version: WAN26_R2V_ORIGINAL_VIDEO_POLICY.public_catalog_version,
      source_catalog_fetched_at: WAN26_R2V_ORIGINAL_VIDEO_POLICY.public_catalog_fetched_at,
      source_catalog_build_id: WAN26_R2V_ORIGINAL_VIDEO_POLICY.catalog_build_id,
      source_catalog_model_data_sha256: WAN26_R2V_ORIGINAL_VIDEO_POLICY.catalog_model_data_sha256,
      source_sha256: sourceSha256,
      filename: request.filename,
      mime_type: request.mime_type,
      bytes_copied: length,
      operator_local_max_bytes: operatorLocalMaxBytes,
      local_guard_id: WAN26_R2V_ORIGINAL_VIDEO_POLICY.operator_limit_kind,
      metadata,
      generation_permit: false as const,
      owner_upload_binding: "NOT_ESTABLISHED" as const,
      selection_crop: "NOT_PERFORMED" as const
    });
    mintedReceipt = result;
    retainedReceipts.set(mintedReceipt, { bytes: ownedCopy, modelId: request.model_id, sourceSha256 });
    resultDescriptors.set(mintedReceipt, Object.getOwnPropertyDescriptors(mintedReceipt));
    ownedCopy = undefined;
    return result;
  } catch (error) {
    ownedCopy?.fill(0);
    if (error instanceof OwnerWan26R2vOriginalProbeError) throw error;
    if (signal && signalIsAborted(signal)) throw new OwnerWan26R2vOriginalProbeError("PROBE_ABORTED");
    throw new OwnerWan26R2vOriginalProbeError("PROBE_FAILED");
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
      if (mintedReceipt) {
        retainedReceipts.get(mintedReceipt)?.bytes.fill(0);
        retainedReceipts.delete(mintedReceipt);
        resultDescriptors.delete(mintedReceipt);
      }
      throw new OwnerWan26R2vOriginalProbeError("PROBE_FAILED");
    }
  }
}

async function wipeAndUnlink(path: string): Promise<void> {
  const file = await open(path, fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > CURRENT_PUBLIC_MAX_BYTES) invalid();
    const zeros = allocateBuffer(Math.min(64 * 1024, Math.max(1, info.size)), true);
    for (let offset = 0; offset < info.size; offset += zeros.length) await file.write(zeros, 0, Math.min(zeros.length, info.size - offset), offset);
    zeros.fill(0);
    await file.sync();
  } finally { await file.close(); }
  await unlink(path);
}

function runFfprobe(path: string, input: string, signal?: AbortSignal): Promise<string> {
  const args = ["-v", "error", "-protocol_whitelist", "file", "-count_frames", "-show_entries",
    "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames,duration:format=duration,format_name", "-of", "json", input];
  const options: ExecFileOptionsWithStringEncoding = {
    encoding: "utf8", timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: MAX_STDOUT_BYTES,
    windowsHide: true, signal, env: { PATH: "", LANG: "C", LC_ALL: "C" }
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

function parseFfprobe(output: string): {
  codecStreams: { type: string; codec_name: string }[]; width: number; height: number; duration: number;
  frameRate: { numerator: number; denominator: number }; frames: number;
} {
  let root: unknown;
  try { root = JSON.parse(output); } catch { return invalid(); }
  if (!isRecord(root) || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > 32 || !isRecord(root.format) ||
      root.format.format_name !== ACCEPTED_FORMAT) return invalid();
  const streams: Record<string, unknown>[] = [];
  for (const entry of root.streams) {
    if (!isRecord(entry) || typeof entry.codec_type !== "string" || !/^[a-z0-9_+-]{1,24}$/i.test(entry.codec_type) ||
        typeof entry.codec_name !== "string" || !/^[a-z0-9_+-]{1,64}$/i.test(entry.codec_name)) return invalid();
    streams.push(entry);
  }
  const videos = streams.filter((stream) => stream.codec_type === "video");
  if (videos.length !== 1) return invalid();
  const video = videos[0]!;
  const width = positiveInteger(video.width), height = positiveInteger(video.height), frames = positiveInteger(video.nb_read_frames);
  const duration = finitePositive(video.duration === undefined ? root.format.duration : video.duration);
  const frameRate = parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate);
  if (width === undefined || height === undefined || frames === undefined || duration === undefined || !frameRate) return invalid();
  return {
    codecStreams: streams.map((stream) => ({ type: stream.codec_type as string, codec_name: stream.codec_name as string })),
    width, height, duration, frameRate, frames
  };
}

function hasMatchingBmffBrand(bytes: Buffer, mime: OwnerWan26R2vOriginalProbeInput["mime_type"]): boolean {
  if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;
  const size = bytes.readUInt32BE(0);
  if (size < 16 || size > bytes.length || (size - 16) % 4 !== 0) return false;
  const brands = [bytes.toString("ascii", 8, 12)];
  for (let offset = 16; offset < size; offset += 4) brands.push(bytes.toString("ascii", offset, offset + 4));
  const quickTime = brands.includes("qt  ");
  const mp4 = brands.some((brand) => /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash|cmfc|cmfs)$/.test(brand));
  return mime === "video/mov" ? quickTime : mp4 && !quickTime;
}

function parseRate(value: unknown): { numerator: number; denominator: number } | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value);
  if (!match) return undefined;
  const numerator = Number(match[1]), denominator = Number(match[2]);
  return Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) ? { numerator, denominator } : undefined;
}

function exactConfig(config: unknown): { ffprobePath: string; operatorLocalMaxBytes: number } {
  if (!config || typeof config !== "object" || types.isProxy(config) || Array.isArray(config)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(config), keys = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(config) !== Object.prototype && Object.getPrototypeOf(config) !== null) ||
      keys.length < 1 || keys.length > 2 || !keys.includes("ffprobePath") ||
      keys.some((key) => typeof key !== "string" || !["ffprobePath", "operatorLocalMaxBytes"].includes(key) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
  const path = descriptors.ffprobePath!.value;
  if (typeof path !== "string" || !isAbsolute(path) || path !== path.trim() || path.includes("\0") || basename(path) === "") invalid();
  const localMax = descriptors.operatorLocalMaxBytes?.value ?? DEFAULT_LOCAL_MAX_BYTES;
  if (typeof localMax !== "number" || !Number.isSafeInteger(localMax) || localMax < 16 || localMax > MAX_LOCAL_MAX_BYTES) invalid();
  return { ffprobePath: path, operatorLocalMaxBytes: localMax };
}

function exactInput(input: unknown): OwnerWan26R2vOriginalProbeInput {
  if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  const required = ["model_id", "filename", "mime_type", "bytes"];
  if ((Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) || keys.length !== required.length ||
      keys.some((key) => typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  if (typeof result.filename !== "string" || typeof result.mime_type !== "string" || typeof result.model_id !== "string") invalid();
  return result as unknown as OwnerWan26R2vOriginalProbeInput;
}

function exactOptions(options: Readonly<{ signal?: AbortSignal }> | undefined): AbortSignal | undefined {
  if (options === undefined) return undefined;
  if (!options || typeof options !== "object" || types.isProxy(options) || Array.isArray(options)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(options), keys = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null) || keys.length > 1 ||
      keys.some((key) => key !== "signal" || !Object.hasOwn(descriptors.signal!, "value") || descriptors.signal!.enumerable !== true)) invalid();
  const signal = descriptors.signal?.value;
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal)) invalid();
  try {
    if (Object.getPrototypeOf(signal) !== ABORT_SIGNAL_PROTOTYPE || !ABORT_SIGNAL_ABORTED_GETTER ||
        typeof Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) !== "boolean") invalid();
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
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") ||
      Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length")) invalid();
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
  try {
    return { view: Reflect.construct(UINT8_ARRAY_CONSTRUCTOR, [backing, byteOffset, byteLength]) as Uint8Array, byteLength };
  } catch { invalid(); }
}

function allocateBuffer(length: number, zeroed = false): Buffer {
  const allocate = zeroed ? BUFFER_ALLOC : BUFFER_ALLOC_UNSAFE;
  return Reflect.apply(allocate, Buffer, [length]) as Buffer;
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
function invalid(): never { throw new OwnerWan26R2vOriginalProbeError("INVALID_ORIGINAL"); }
function limit(): never { throw new OwnerWan26R2vOriginalProbeError("ORIGINAL_LOCAL_LIMIT_EXCEEDED"); }
