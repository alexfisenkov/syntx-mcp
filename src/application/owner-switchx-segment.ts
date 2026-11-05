import { prepareLocalMediaWindowsDirectory, assertLocalMediaWindowsFiles, localMediaTempRoot } from "./local-media-native-permissions.js";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { types } from "node:util";
import type { OwnerCurrentVideoMetadata } from "./owner-current-video-metadata.js";

export interface OwnerSwitchxSegment { readonly start_seconds: number; readonly end_seconds: number; }
/** Explicit local preparation, not a claim of browser-encoder byte equality or provider acceptance. */
export async function prepareOwnerSwitchxSegment(source: OwnerCurrentVideoMetadata, input: OwnerSwitchxSegment, ffmpegPath: string, signal?: AbortSignal): Promise<Buffer> {
  if (typeof ffmpegPath !== "string" || !isAbsolute(ffmpegPath) || ffmpegPath !== ffmpegPath.trim() || ffmpegPath.includes("\0") ||
      !input || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || keys.some(k => typeof k !== "string" || !["start_seconds", "end_seconds"].includes(k) || !Object.hasOwn(descriptors[k]!, "value"))) invalid();
  const start = descriptors.start_seconds!.value, end = descriptors.end_seconds!.value;
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > source.duration_seconds ||
      source.frame_rate === null || Math.ceil((end - start) * source.frame_rate) > 240 || Math.round(end - start) < 1) invalid();
  const directory = await mkdtemp(join(await localMediaTempRoot(), "syntx-switchx-segment-")); await chmod(directory, 0o700);
  const original = join(directory, "original.mp4"), selected = join(directory, "selected.mp4");
  let bytes: Buffer | undefined;
  try {
    await prepareLocalMediaWindowsDirectory(directory, [ffmpegPath], signal);
    const file = await open(original, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await file.chmod(0o600); await file.writeFile(source.bytes); await file.sync(); } finally { await file.close(); }
    const target = await open(selected, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    let identity: { dev: number; ino: number };
    try { await target.chmod(0o600); const stat = await target.stat(); identity = { dev: stat.dev, ino: stat.ino }; } finally { await target.close(); }
    await assertLocalMediaWindowsFiles([original, selected], signal);
    await new Promise<void>((resolve, reject) => execFile(ffmpegPath, ["-v", "error", "-nostdin", "-y", "-ss", String(start), "-i", original,
      "-t", String(end - start), "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
      "-c:a", "aac", "-movflags", "+faststart", "-fs", String(100 * 1024 * 1024 + 1), selected],
    { timeout: 60000, maxBuffer: 8192, killSignal: "SIGKILL", windowsHide: true, ...(signal === undefined ? {} : { signal }) }, error => error ? reject(new Error("SWITCHX_SEGMENT_PREPARATION_FAILED")) : resolve()));
    await assertLocalMediaWindowsFiles([selected], signal);
    const stat = await lstat(selected);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino || stat.size < 16 || stat.size > 100 * 1024 * 1024) invalid();
    const result = await open(selected, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { const before = await result.stat(); if (before.dev !== identity.dev || before.ino !== identity.ino || before.size !== stat.size) invalid(); bytes = await result.readFile(); if (bytes.length !== before.size) invalid(); }
    finally { await result.close(); }
    const returned = bytes; bytes = undefined; return returned;
  } catch { return invalid(); }
  finally { bytes?.fill(0); await rm(directory, { recursive: true, force: true }); }
}
function invalid(): never { throw new Error("SWITCHX_SEGMENT_PREPARATION_FAILED"); }
