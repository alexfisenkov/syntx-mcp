import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { types } from "node:util";

export const WAN27R2V_ORIGINAL_VIDEO_POLICY = Object.freeze({
  policy_id: "OWNER_WAN27_R2V_ORIGINAL_VIDEO_POLICY_B066_LOCAL_GUARD_V1",
  public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
  model_id: "wan_27_r2v",
  limits: Object.freeze({ max_file_size_bytes: 104_857_600, min_side: 240, max_side: 8_000, min_duration_seconds: 1, max_duration_seconds: 30 }),
  kind: "CATALOG_METADATA_PLUS_LOCAL_RESOURCE_GUARD_NOT_PROVIDER_PROOF",
  selection_crop: "NOT_PERFORMED"
} as const);

const MAX_BYTES = WAN27R2V_ORIGINAL_VIDEO_POLICY.limits.max_file_size_bytes;
const MAX_STDOUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const INPUT_PREFIX = "syntx-wan27-r2v-probe-";
const ACCEPTED_FORMAT = "mov,mp4,m4a,3gp,3g2,mj2";
const byteLengthGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")?.get;

export interface OwnerWan27R2vOriginalProbeInput {
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly bytes: Uint8Array;
}

export interface OwnerWan27R2vOriginalProbeResult {
  readonly status: "TRUSTED_LOCAL_MEDIA_PROBE";
  readonly model_id: "wan_27_r2v";
  readonly source_policy_id: typeof WAN27R2V_ORIGINAL_VIDEO_POLICY.policy_id;
  readonly source_sha256: string;
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly bytes_copied: number;
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

export class OwnerWan27R2vOriginalProbeError extends Error {
  constructor(readonly code: "INVALID_ORIGINAL" | "ORIGINAL_LOCAL_LIMIT_EXCEEDED" | "PROBE_FAILED" | "PROBE_ABORTED") {
    super("WAN 2.7 R2V original video could not be safely probed.");
    this.name = "OwnerWan27R2vOriginalProbeError";
  }
}

export interface OwnerWan27R2vOriginalProbeRunner {
  probe(input: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerWan27R2vOriginalProbeResult>>;
}

/** ffprobePath is trusted absolute operator configuration and never request data. */
export function createOwnerWan27R2vOriginalProbe(config: unknown): OwnerWan27R2vOriginalProbeRunner {
  const ffprobePath = exactConfig(config);
  return Object.freeze({ probe: (input: unknown, options?: Readonly<{ signal?: AbortSignal }>) => probeOriginal(ffprobePath, input, options) });
}

const retainedBytes = new WeakMap<object, Buffer>();
const resultDescriptors = new WeakMap<object, Readonly<Record<string, PropertyDescriptor>>>();

export function isTrustedOwnerWan27R2vOriginalProbeResult(value: unknown): value is Readonly<OwnerWan27R2vOriginalProbeResult> {
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

/** Future upload seam returns a fresh copy only for a genuine, unchanged probe result. */
export function copyTrustedOwnerWan27R2vOriginalBytes(value: unknown): Uint8Array {
  if (!isTrustedOwnerWan27R2vOriginalProbeResult(value)) invalid();
  const bytes = retainedBytes.get(value);
  if (!bytes) invalid();
  return new Uint8Array(bytes);
}

/** Wipes and revokes the private retained bytes after a future owner-upload consumer finishes. */
export function releaseTrustedOwnerWan27R2vOriginalProbeResult(value: unknown): void {
  if (!isTrustedOwnerWan27R2vOriginalProbeResult(value)) invalid();
  retainedBytes.get(value)!.fill(0);
  retainedBytes.delete(value);
  resultDescriptors.delete(value);
}

async function probeOriginal(ffprobePath: string, input: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerWan27R2vOriginalProbeResult>> {
  const request = exactInput(input), signal = exactOptions(options);
  const extension = typeof request.filename === "string" ? extname(request.filename).toLowerCase() : "";
  if (!safeFilename(request.filename) || (request.mime_type !== "video/mp4" && request.mime_type !== "video/quicktime") ||
      (request.mime_type === "video/mp4" ? extension !== ".mp4" : extension !== ".mov") ||
      types.isProxy(request.bytes) || !(request.bytes instanceof Uint8Array) ||
      (!Buffer.isBuffer(request.bytes) && Object.getPrototypeOf(request.bytes) !== Uint8Array.prototype)) invalid();
  if (signal?.aborted) throw new OwnerWan27R2vOriginalProbeError("PROBE_ABORTED");

  let length: number;
  try { if (!byteLengthGetter) invalid(); length = byteLengthGetter.call(request.bytes) as number; }
  catch { invalid(); }
  if (length < 16) invalid();
  if (length > MAX_BYTES) limit();

  let firstCopy: Uint8Array;
  try { firstCopy = Uint8Array.prototype.slice.call(request.bytes) as Uint8Array; }
  catch { invalid(); }
  if (firstCopy.byteLength !== length) { firstCopy.fill(0); invalid(); }
  let source: Buffer;
  try { source = Buffer.from(firstCopy); }
  catch { firstCopy.fill(0); invalid(); }
  firstCopy.fill(0);
  const sourceSha256 = createHash("sha256").update(source).digest("hex");

  let directory: string | undefined, inputPath: string | undefined, createdFile = false, ownedCopy: Buffer | undefined;
  try {
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
      if (!info.isFile() || info.size !== source.byteLength) invalid();
    } finally { await file.close(); }

    const probe = parseFfprobe(await runFfprobe(ffprobePath, inputPath, signal));
    const { min_duration_seconds, max_duration_seconds, min_side, max_side } = WAN27R2V_ORIGINAL_VIDEO_POLICY.limits;
    if (probe.duration < min_duration_seconds || probe.duration > max_duration_seconds || probe.width < min_side || probe.height < min_side ||
        probe.width > max_side || probe.height > max_side) limit();
    const after = await lstat(inputPath);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== source.byteLength) invalid();
    ownedCopy = Buffer.from(source);
    const metadata = Object.freeze({
      container: "ISO_BMFF_MOV_MP4" as const,
      codec_streams: Object.freeze(probe.codecStreams.map((stream) => Object.freeze(stream))),
      width: probe.width, height: probe.height, duration_seconds: probe.duration,
      frame_rate: Object.freeze(probe.frameRate), decoded_frame_count: probe.frames
    });
    const result = Object.freeze({
      status: "TRUSTED_LOCAL_MEDIA_PROBE" as const, model_id: "wan_27_r2v" as const,
      source_policy_id: WAN27R2V_ORIGINAL_VIDEO_POLICY.policy_id,
      source_sha256: sourceSha256, filename: request.filename, mime_type: request.mime_type,
      bytes_copied: source.byteLength, metadata, generation_permit: false as const,
      owner_upload_binding: "NOT_ESTABLISHED" as const, selection_crop: "NOT_PERFORMED" as const
    });
    retainedBytes.set(result, ownedCopy);
    resultDescriptors.set(result, Object.getOwnPropertyDescriptors(result));
    ownedCopy = undefined;
    return result;
  } catch (error) {
    ownedCopy?.fill(0);
    if (error instanceof OwnerWan27R2vOriginalProbeError) throw error;
    if (signal?.aborted) throw new OwnerWan27R2vOriginalProbeError("PROBE_ABORTED");
    throw new OwnerWan27R2vOriginalProbeError("PROBE_FAILED");
  } finally {
    source.fill(0);
    let cleanupFailed = false;
    if (createdFile && inputPath) {
      try { await wipeAndUnlink(inputPath); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    if (directory) {
      try { await rmdir(directory); } catch (error) { if (!isMissingFile(error)) cleanupFailed = true; }
    }
    if (cleanupFailed) throw new OwnerWan27R2vOriginalProbeError("PROBE_FAILED");
  }
}

async function wipeAndUnlink(path: string): Promise<void> {
  const file = await open(path, fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_BYTES) invalid();
    const zeros = Buffer.alloc(Math.min(64 * 1024, Math.max(1, info.size)));
    for (let offset = 0; offset < info.size; offset += zeros.length) await file.write(zeros, 0, Math.min(zeros.length, info.size - offset), offset);
    zeros.fill(0);
    await file.sync();
  } finally { await file.close(); }
  await unlink(path);
}

function runFfprobe(path: string, input: string, signal?: AbortSignal): Promise<string> {
  const args = ["-v", "error", "-count_frames", "-show_entries",
    "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames,duration:format=duration,format_name", "-of", "json", input];
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

function hasMatchingBmffBrand(bytes: Buffer, mime: OwnerWan27R2vOriginalProbeInput["mime_type"]): boolean {
  if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;
  const size = bytes.readUInt32BE(0);
  if (size < 16 || size > bytes.length || (size - 16) % 4 !== 0) return false;
  const brands = [bytes.toString("ascii", 8, 12)];
  for (let offset = 16; offset < size; offset += 4) brands.push(bytes.toString("ascii", offset, offset + 4));
  const quickTime = brands.includes("qt  ");
  const mp4 = brands.some((brand) => /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash|cmfc|cmfs)$/.test(brand));
  return mime === "video/quicktime" ? quickTime : mp4 && !quickTime;
}

function parseRate(value: unknown): { numerator: number; denominator: number } | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value);
  if (!match) return undefined;
  const numerator = Number(match[1]), denominator = Number(match[2]);
  return Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) ? { numerator, denominator } : undefined;
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

function exactInput(input: unknown): OwnerWan27R2vOriginalProbeInput {
  if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors), required = ["filename", "mime_type", "bytes"];
  if ((Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) || keys.length !== required.length ||
      keys.some((key) => typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  if (typeof result.filename !== "string" || typeof result.mime_type !== "string") invalid();
  return result as unknown as OwnerWan27R2vOriginalProbeInput;
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
function invalid(): never { throw new OwnerWan27R2vOriginalProbeError("INVALID_ORIGINAL"); }
function limit(): never { throw new OwnerWan27R2vOriginalProbeError("ORIGINAL_LOCAL_LIMIT_EXCEEDED"); }
