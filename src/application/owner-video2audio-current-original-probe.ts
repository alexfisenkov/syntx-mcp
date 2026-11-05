import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { types } from "node:util";
import { createHash } from "node:crypto";
import { normalizeOwnerVideo2AudioInput } from "./owner-video2audio-input-parameters.js";
import { isCurrentOwnerVideo2AudioSourceProfile, type OwnerVideo2AudioSourceProfile, type OwnerVideo2AudioMimeType } from "./owner-video2audio-source-profile.js";

export interface OwnerVideo2AudioCurrentOriginalProbe {
  readonly status: "TRUSTED_CURRENT_VIDEO2AUDIO_ORIGINAL_METADATA";
  readonly filename: string; readonly mime_type: OwnerVideo2AudioMimeType; readonly size: number; readonly sha256: string;
  readonly duration_seconds: number; readonly width: number; readonly height: number; readonly profile_schema_hash: string;
  readonly generation_permit: false; readonly provider_acceptance: "UNPROVEN";
}
const states = new WeakMap<object, { bytes: Buffer; receipt: Readonly<OwnerVideo2AudioCurrentOriginalProbe> }>();
/** Current-only metadata probe: byte/CPU/time bounded, without an invented UI/provider duration maximum. */
export async function probeOwnerVideo2AudioCurrentOriginal(input: { readonly filename: string; readonly mime_type: OwnerVideo2AudioMimeType; readonly bytes: Uint8Array },
  profile: OwnerVideo2AudioSourceProfile, ffprobePath: string, signal?: AbortSignal): Promise<Readonly<OwnerVideo2AudioCurrentOriginalProbe>> {
  if (!isCurrentOwnerVideo2AudioSourceProfile(profile) || typeof ffprobePath !== "string" || !isAbsolute(ffprobePath) || ffprobePath !== ffprobePath.trim() ||
      /[\u0000-\u001f\u007f]/u.test(ffprobePath) || signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) invalid();
  const original = normalizeOwnerVideo2AudioInput({ ...input, prompt: "internal current metadata validation" }, profile).original;
  const copied = original.bytes, bytes = Buffer.from(copied); copied.fill(0);
  let directory: string | undefined, returned = false;
  try {
    if (signal?.aborted) invalid(); directory = await mkdtemp(join(tmpdir(), "syntx-current-video2audio-")); await chmod(directory, 0o700);
    const path = join(directory, original.mime_type === "video/webm" ? "original.webm" : original.mime_type === "video/quicktime" ? "original.mov" : "original.mp4");
    const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600); let identity: { dev: number; ino: number };
    try { await file.chmod(0o600); await file.writeFile(bytes); await file.sync(); const stat = await file.stat(); identity = { dev: stat.dev, ino: stat.ino }; }
    finally { await file.close(); }
    const output = await new Promise<string>((resolve, reject) => execFile(ffprobePath, ["-v", "error", "-show_entries",
      "stream=codec_type,codec_name,width,height,duration:stream_disposition=attached_pic:format=format_name,duration", "-of", "json", path],
    { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 65536, killSignal: "SIGKILL", ...(signal === undefined ? {} : { signal }) },
    (error, stdout) => error ? reject(new Error("VIDEO2AUDIO_CURRENT_PROBE_FAILED")) : resolve(stdout)));
    const root = JSON.parse(output); if (!root || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > 32 || typeof root.format?.format_name !== "string") invalid();
    const formats: string[] = root.format.format_name.split(",");
    if (original.mime_type === "video/webm" ? !formats.includes("webm") : !formats.includes("mp4") && !formats.includes("mov")) invalid();
    const video = root.streams.find((stream: any) => stream?.codec_type === "video" && stream.disposition?.attached_pic !== 1);
    const width = Number(video?.width), height = Number(video?.height), durations = [Number(video?.duration), Number(root.format.duration)].filter(value => Number.isFinite(value) && value > 0);
    if (!video || typeof video.codec_name !== "string" || !Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1 || !durations.length) invalid();
    const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino || stat.size !== bytes.length ||
      hash(bytes) !== original.sha256) invalid();
    const receipt: OwnerVideo2AudioCurrentOriginalProbe = Object.freeze({ status: "TRUSTED_CURRENT_VIDEO2AUDIO_ORIGINAL_METADATA", filename: original.filename,
      mime_type: original.mime_type, size: bytes.length, sha256: original.sha256, duration_seconds: Math.max(...durations), width, height,
      profile_schema_hash: profile.profileSchemaHash, generation_permit: false, provider_acceptance: "UNPROVEN" });
    states.set(receipt, { bytes, receipt }); returned = true; return receipt;
  } catch { return invalid(); }
  finally { if (!returned) bytes.fill(0); if (directory) await rm(directory, { recursive: true, force: true }); }
}
export function isOwnerVideo2AudioCurrentOriginalProbe(value: unknown): value is Readonly<OwnerVideo2AudioCurrentOriginalProbe> { return stateFor(value) !== undefined; }
export function readOwnerVideo2AudioCurrentOriginal(value: unknown): (OwnerVideo2AudioCurrentOriginalProbe & { readonly bytes: Uint8Array }) | null {
  const state = stateFor(value); return state ? Object.freeze({ ...state.receipt, bytes: new Uint8Array(state.bytes) }) : null;
}
export function releaseOwnerVideo2AudioCurrentOriginal(value: unknown): boolean { const state = stateFor(value); if (!state) return false; state.bytes.fill(0); return states.delete(value as object); }
function stateFor(value: unknown) { if (!value || typeof value !== "object" || types.isProxy(value)) return undefined; const state = states.get(value); return state && Object.isFrozen(value) && hash(state.bytes) === state.receipt.sha256 ? state : undefined; }
function hash(bytes: Uint8Array) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function invalid(): never { throw new Error("VIDEO2AUDIO_CURRENT_PROBE_FAILED"); }
