import { prepareLocalMediaWindowsDirectory, assertLocalMediaWindowsFiles, localMediaTempRoot } from "./local-media-native-permissions.js";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { types } from "node:util";

const typed = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(typed, "byteOffset")!.get!;
const backingBuffer = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
export interface OwnerCurrentVideoMetadata {
  readonly bytes: Buffer;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly frame_rate: number | null;
  readonly frame_count: number | null;
  readonly frame_count_source: "CONTAINER_METADATA" | "FFPROBE_COUNT_FRAMES" | "UNKNOWN";
  readonly codec_name: string;
  readonly codec_tag: string;
  readonly color_transfer: string;
  readonly generation_permit: false;
}
export class OwnerCurrentVideoMetadataError extends Error {
  constructor(readonly code: "INVALID_VIDEO" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "PROBE_ABORTED" | "PROBE_FAILED") {
    super("The selected video could not be measured safely."); this.name = "OwnerCurrentVideoMetadataError";
  }
}
/** Neutral measurement only: callers enforce their own model policy and mint their own branded authority. */
export async function probeOwnerCurrentVideoMetadata(input: {
  readonly bytes: Uint8Array; readonly mime_type: "video/mp4" | "video/quicktime";
}, config: { readonly ffprobePath: string; readonly maximumBytes: number; readonly requireFrameCount?: boolean }, signal?: AbortSignal): Promise<OwnerCurrentVideoMetadata> {
  if (!config || typeof config.ffprobePath !== "string" || !isAbsolute(config.ffprobePath) || config.ffprobePath !== config.ffprobePath.trim() || config.ffprobePath.includes("\0") ||
      !Number.isSafeInteger(config.maximumBytes) || config.maximumBytes < 16 || config.maximumBytes > 100 * 1024 * 1024 ||
      signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_VIDEO");
  const bytes = copyBytes(input.bytes, config.maximumBytes);
  let directory: string | undefined, path: string | undefined, created = false, returned = false;
  try {
    if (signal?.aborted) fail("PROBE_ABORTED");
    if (bytes.length < 24 || bytes.toString("ascii", 4, 8) !== "ftyp" ||
        input.mime_type !== "video/mp4" && input.mime_type !== "video/quicktime" ||
        input.mime_type === "video/mp4" && bytes.toString("ascii", 8, 12) === "qt  ") fail("INVALID_VIDEO");
    directory = await mkdtemp(join(await localMediaTempRoot(), "syntx-current-video-")); await chmod(directory, 0o700); await prepareLocalMediaWindowsDirectory(directory, [config.ffprobePath], signal);
    path = join(directory, input.mime_type === "video/quicktime" ? "original.mov" : "original.mp4");
    const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600); created = true;
    let identity: { dev: number; ino: number };
    try { await file.chmod(0o600); await file.writeFile(bytes); await file.sync(); const stat = await file.stat(); identity = { dev: stat.dev, ino: stat.ino }; }
    finally { await file.close(); }
    await assertLocalMediaWindowsFiles([path], signal);
    const inspect = async (countFrames: boolean) => {
      const args = ["-v", "error", ...(countFrames ? ["-count_frames"] : []), "-show_entries",
        "stream=codec_type,codec_name,codec_tag_string,width,height,duration,avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames,color_transfer:stream_disposition=attached_pic:format=duration,format_name", "-of", "json", path!];
      const output = await new Promise<string>((resolve, reject) => execFile(config.ffprobePath, args,
        { encoding: "utf8", timeout: 15000, maxBuffer: 64 * 1024, killSignal: "SIGKILL", ...(signal === undefined ? {} : { signal }) },
        (error, stdout) => error ? reject(error) : resolve(stdout)));
      return parse(output);
    };
    let metadata = await inspect(false);
    if (config.requireFrameCount && metadata.frame_count === null) metadata = await inspect(true);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino || stat.size !== bytes.length) fail("INVALID_VIDEO");
    const result = Object.freeze({ bytes, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), ...metadata, generation_permit: false as const });
    returned = true; return result;
  } catch (error) {
    if (error instanceof OwnerCurrentVideoMetadataError) throw error;
    if (signal?.aborted) fail("PROBE_ABORTED");
    return fail("PROBE_FAILED");
  } finally {
    if (!returned) bytes.fill(0);
    if (path && created) { try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
    if (directory) await rmdir(directory);
  }
}
function parse(text: string): Omit<OwnerCurrentVideoMetadata, "bytes" | "size" | "sha256" | "generation_permit"> {
  let root: Record<string, any>; try { root = JSON.parse(text); } catch { return fail("INVALID_VIDEO"); }
  if (!root || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > 32 || !root.format ||
      typeof root.format.format_name !== "string" || !root.format.format_name.split(",").some((v: string) => v === "mp4" || v === "mov")) fail("INVALID_VIDEO");
  const videos = root.streams.filter((v: any) => v && v.codec_type === "video" && v.disposition?.attached_pic !== 1);
  if (videos.length !== 1) fail("INVALID_VIDEO"); const video = videos[0];
  const width = Number(video.width), height = Number(video.height), durations = [Number(video.duration), Number(root.format.duration)].filter((v) => Number.isFinite(v) && v > 0);
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !durations.length || typeof video.codec_name !== "string") fail("INVALID_VIDEO");
  const frame_rate = rate(video.avg_frame_rate) ?? rate(video.r_frame_rate), counted = integer(video.nb_read_frames), container = integer(video.nb_frames);
  return { width, height, duration_seconds: Math.max(...durations), frame_rate, frame_count: counted ?? container,
    frame_count_source: counted !== null ? "FFPROBE_COUNT_FRAMES" : container !== null ? "CONTAINER_METADATA" : "UNKNOWN",
    codec_name: video.codec_name, codec_tag: typeof video.codec_tag_string === "string" ? video.codec_tag_string : "", color_transfer: typeof video.color_transfer === "string" ? video.color_transfer : "" };
}
function rate(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+\/\d+$/u.test(value)) return null;
  const [n, d] = value.split("/").map(Number), result = n! / d!; return Number.isFinite(result) && result > 0 ? result : null;
}
function integer(value: unknown): number | null { const result = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value; return typeof result === "number" && Number.isSafeInteger(result) && result > 0 ? result : null; }
function copyBytes(value: unknown, maximum: number): Buffer {
  if (!value || types.isProxy(value) || !(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) fail("INVALID_VIDEO");
  let length: number, offset: number, backing: ArrayBuffer;
  try { length = Reflect.apply(byteLength, value, []); offset = Reflect.apply(byteOffset, value, []); backing = Reflect.apply(backingBuffer, value, []); }
  catch { return fail("INVALID_VIDEO"); }
  if (!Number.isSafeInteger(length) || length < 16 || length > maximum) fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
  if (!backing || types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || !Number.isSafeInteger(offset)) fail("INVALID_VIDEO");
  try { return Buffer.from(new Uint8Array(backing, offset, length)); } catch { return fail("INVALID_VIDEO"); }
}
function fail(code: OwnerCurrentVideoMetadataError["code"]): never { throw new OwnerCurrentVideoMetadataError(code); }
