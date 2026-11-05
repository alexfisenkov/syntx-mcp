import { prepareLocalMediaWindowsDirectory, assertLocalMediaWindowsFiles } from "./local-media-native-permissions.js";
import { types } from "node:util";
import { isOwnerActTwoCurrentDuration } from "./owner-actor-current-controls.js";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const MODEL_ID = "acttwo" as const;
const MIME_TYPE = "video/mp4" as const;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 8_400;
const MAX_PIXELS = 52_500_000;
const VALIDATED = new WeakMap<object, { readonly context: Readonly<ValidatedOwnerActTwoPerformanceVideo>; readonly bytes: Buffer }>();

export interface ValidatedOwnerActTwoPerformanceVideo {
  readonly status: "LOCALLY_PROBED_ACTTWO_PERFORMANCE_VIDEO_NOT_UPLOAD_AUTHORITY";
  readonly model_id: typeof MODEL_ID;
  readonly filename: string;
  readonly mime_type: typeof MIME_TYPE;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly measured_duration_seconds: number;
  readonly probe_confidence: "FFPROBE_METADATA_NOT_DECODED_PIXELS";
  readonly local_max_bytes: typeof MAX_BYTES;
  readonly local_duration_slice_seconds: number;
  readonly generation_permit: false;
}

export class OwnerActTwoVideoPolicyError extends Error {
  constructor(readonly code: "INVALID_VIDEO" | "LOCAL_LIMIT_EXCEEDED" | "DURATION_MISMATCH" | "VIDEO_PROBE_FAILED" | "REQUEST_ABORTED") {
    super("The ActTwo performance video is not valid under the local input policy.");
    this.name = "OwnerActTwoVideoPolicyError";
  }
}

export function createOwnerActTwoPerformanceVideoValidator(ffprobePath: string) {
  if (typeof ffprobePath !== "string" || !isAbsolute(ffprobePath) || ffprobePath !== ffprobePath.trim() || /[\u0000-\u001f\u007f]/u.test(ffprobePath)) invalid();
  return Object.freeze({ validate: (input: unknown, signal?: AbortSignal) => validateVideo(ffprobePath, input, signal) });
}

async function validateVideo(ffprobePath: string, input: unknown,
  signalInput?: AbortSignal): Promise<Readonly<ValidatedOwnerActTwoPerformanceVideo>> {
  const fields = exactRecord(input), signal = exactSignal(signalInput);
  if (fields.model_id !== MODEL_ID || typeof fields.filename !== "string" || !safeFilename(fields.filename) ||
      !fields.filename.toLowerCase().endsWith(".mp4") || fields.mime_type !== MIME_TYPE ||
      !(fields.bytes instanceof Uint8Array) || types.isProxy(fields.bytes)) invalid();

  let copied: Buffer | undefined;
  try {
    copied = copyInputBytes(fields.bytes);
    if (copied.length < 24 || copied.toString("ascii", 4, 8) !== "ftyp" || copied.toString("ascii", 8, 12) === "qt  ") invalid();
    const metadata = await probeActTwoPerformanceVideo(ffprobePath, copied, signal);
    if (metadata.width < 300 || metadata.height < 300 ||
        metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION || metadata.width * metadata.height > MAX_PIXELS) localLimit();
    if (!isOwnerActTwoCurrentDuration(metadata.duration_seconds)) durationMismatch();
    const context = Object.freeze({ status: "LOCALLY_PROBED_ACTTWO_PERFORMANCE_VIDEO_NOT_UPLOAD_AUTHORITY" as const,
      model_id: MODEL_ID, filename: fields.filename, mime_type: MIME_TYPE, size: copied.byteLength, sha256: createHash("sha256").update(copied).digest("hex"),
      width: metadata.width, height: metadata.height, measured_duration_seconds: metadata.duration_seconds,
      probe_confidence: "FFPROBE_METADATA_NOT_DECODED_PIXELS" as const, local_max_bytes: MAX_BYTES as typeof MAX_BYTES,
      local_duration_slice_seconds: metadata.duration_seconds, generation_permit: false as const });
    VALIDATED.set(context, { context, bytes: Buffer.from(copied) });
    return context;
  } catch (error) {
    if (error instanceof OwnerActTwoVideoPolicyError) throw error;
    if (signal?.aborted || error instanceof Error && "code" in error && error.code === "PROBE_ABORTED") aborted();
    if (error instanceof Error && "code" in error &&
        (error.code === "SOURCE_LIMIT_EXCEEDED" || error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED")) localLimit();
    return probeFailed();
  } finally {
    copied?.fill(0);
  }
}

/** ActTwo-specific probe: no Kling minimum-duration policy is borrowed or relabeled as ActTwo evidence. */
async function probeActTwoPerformanceVideo(ffprobePath: string, bytes: Buffer, signal?: AbortSignal): Promise<{ width: number; height: number; duration_seconds: number }> {
  let directory: string | undefined, path: string | undefined, created = false;
  try {
    if (signal?.aborted) aborted();
    directory = await mkdtemp(join(tmpdir(), "syntx-acttwo-probe-")); await chmod(directory, 0o700); await prepareLocalMediaWindowsDirectory(directory, [ffprobePath], signal);
    path = join(directory, "original.mp4");
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    created = true;
    let identity: { dev: number; ino: number };
    try { await file.chmod(0o600); await file.writeFile(bytes); await file.sync(); const stat = await file.stat(); identity = { dev: stat.dev, ino: stat.ino }; }
    finally { await file.close(); }
    await assertLocalMediaWindowsFiles([path], signal);
    const args = ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,duration,color_transfer:stream_disposition=attached_pic:format=duration,format_name", "-of", "json", path];
    const text = await new Promise<string>((resolve, reject) => {
      execFile(ffprobePath, args, { encoding: "utf8", timeout: 15000, maxBuffer: 64 * 1024, killSignal: "SIGKILL", ...(signal === undefined ? {} : { signal }) },
        (error, stdout) => { if (error) reject(error); else resolve(stdout); });
    });
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino || stat.size !== bytes.length) invalid();
    let root: Record<string, any>;
    try { root = JSON.parse(text) as Record<string, any>; } catch { return invalid(); }
    if (!root || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > 16 || !root.format ||
        typeof root.format.format_name !== "string" || !root.format.format_name.split(",").includes("mp4")) invalid();
    const videos = root.streams.filter((stream: any) => stream && stream.codec_type === "video" && stream.disposition?.attached_pic !== 1);
    if (videos.length !== 1) invalid(); const video = videos[0];
    const width = Number(video.width), height = Number(video.height);
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || typeof video.codec_name !== "string" || !video.codec_name) invalid();
    const durations = [Number(video.duration), Number(root.format.duration)].filter((value) => Number.isFinite(value) && value > 0);
    if (!durations.length) durationMismatch();
    // Retain the pre-existing local SDR metadata guard; it is not a new provider/HDR support claim.
    const transfer = video.color_transfer ?? "";
    if (transfer && !["bt709", "smpte170m", "bt470bg", "iec61966-2-1", "gamma22", "gamma28"].includes(transfer)) localLimit();
    return { width, height, duration_seconds: Math.max(...durations) };
  } finally {
    if (path && created) { try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
    if (directory) await rmdir(directory);
  }
}

function copyInputBytes(value: Uint8Array): Buffer {
  if (types.isProxy(value) || (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype)) invalid();
  const proto = Object.getPrototypeOf(Uint8Array.prototype);
  let size: number, offset: number, backing: ArrayBuffer;
  try {
    size = Reflect.apply(Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!, value, []);
    offset = Reflect.apply(Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!, value, []);
    backing = Reflect.apply(Object.getOwnPropertyDescriptor(proto, "buffer")!.get!, value, []);
  } catch { return invalid(); }
  if (!Number.isSafeInteger(size) || size < 16 || size > MAX_BYTES) localLimit();
  if (!backing || types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || !Number.isSafeInteger(offset)) invalid();
  try { return Buffer.from(new Uint8Array(backing, offset, size)); } catch { return invalid(); }
}

export function readValidatedOwnerActTwoPerformanceVideo(value: unknown): Readonly<ValidatedOwnerActTwoPerformanceVideo & { readonly bytes: Buffer }> | null {
  const state = readState(value);
  if (!state) return null;
  return Object.freeze({ ...state.context, bytes: Buffer.from(state.bytes) });
}

export function isValidatedOwnerActTwoPerformanceVideo(value: unknown): value is Readonly<ValidatedOwnerActTwoPerformanceVideo> {
  return readState(value) !== null;
}

export function releaseValidatedOwnerActTwoPerformanceVideo(value: unknown): boolean {
  const state = readState(value);
  if (!state) return false;
  state.bytes.fill(0);
  return VALIDATED.delete(value as object);
}

function readState(value: unknown): { readonly context: Readonly<ValidatedOwnerActTwoPerformanceVideo>; readonly bytes: Buffer } | null {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return null;
    const state = VALIDATED.get(value);
    return state && state.context === value && state.bytes.byteLength === state.context.size && state.context.model_id === MODEL_ID &&
      state.context.generation_permit === false && isOwnerActTwoCurrentDuration(state.context.measured_duration_seconds) ? state : null;
  } catch { return null; }
}

function exactRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const required = ["model_id", "filename", "mime_type", "bytes"];
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== "string" || !required.includes(key) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalid(); }
}
function exactSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof AbortSignal) || types.isProxy(value)) invalid();
  return value;
}
function safeFilename(value: string): boolean { return value.length > 0 && value.length <= 128 && !/[\\/\u0000-\u001f\u007f]/u.test(value); }
function invalid(): never { throw new OwnerActTwoVideoPolicyError("INVALID_VIDEO"); }
function localLimit(): never { throw new OwnerActTwoVideoPolicyError("LOCAL_LIMIT_EXCEEDED"); }
function durationMismatch(): never { throw new OwnerActTwoVideoPolicyError("DURATION_MISMATCH"); }
function aborted(): never { throw new OwnerActTwoVideoPolicyError("REQUEST_ABORTED"); }
function probeFailed(): never { throw new OwnerActTwoVideoPolicyError("VIDEO_PROBE_FAILED"); }
