import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join } from "node:path";
import { promisify, types } from "node:util";
import { isCanonicalBase64 } from "./canonical-base64.js";

export const WAN_T2V_AUDIO_UPLOAD_SOURCE = Object.freeze({
  policy_id: "OWNER_WAN_T2V_AUDIO_20261105" as const,
  build_id: "1793890358" as const,
  public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json" as const,
  settings_inventory_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json" as const,
  form_sha256: "sha256:2b5d64f6a1f9614987f1ec5efd4bdffee916865f34d87ddd32901db658d9a6e3" as const,
  reference_sha256: "sha256:2bb79978fed089eb91581282043111ae33529e29407755f9e95453af8ee2cf8d" as const,
  sender_sha256: "sha256:b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684" as const,
  max_file_bytes: 15_728_640, max_duration_seconds: 30,
  min_duration_seconds: Object.freeze({wan_26_t2v:3,wan_27_t2v:2}),
  upload_destination: "uploaded" as const, convert_field: "OMITTED_AS_IS" as const,
  file_urls: "ONE_OWNED_AUDIO_UPLOAD" as const,
  provider_acceptance: "UNPROVEN" as const
});
export type WanT2vAudioModel = "wan_26_t2v" | "wan_27_t2v";
export interface WanT2vAudioProbeResult {
  readonly policy_id: typeof WAN_T2V_AUDIO_UPLOAD_SOURCE.policy_id;
  readonly model_id: WanT2vAudioModel;
  readonly filename: string;
  readonly mime_type: "audio/mpeg" | "audio/wav";
  readonly size: number;
  readonly sha256: string;
  readonly duration_seconds: number;
}
export interface WanT2vAudioProbeRunner { probe(input: unknown, signal?: AbortSignal): Promise<Readonly<WanT2vAudioProbeResult>>; }
export class OwnerWanT2vAudioUploadError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "INVALID_AUDIO" | "PROBE_FAILED" | "UPLOAD_DISABLED" |
    "UPLOAD_OUTCOME_UNKNOWN" | "UPLOAD_INTENT_ALREADY_CLAIMED" | "REFERENCE_UNAVAILABLE") {
    super("The owner WAN T2V audio upload could not be completed safely."); this.name = "OwnerWanT2vAudioUploadError";
  }
}
const run = promisify(execFile);
const BYTES = new WeakMap<object, Uint8Array>();
const RUNNERS = new WeakSet<object>();
export function isWanT2vAudioProbeRunner(value: unknown): value is WanT2vAudioProbeRunner {
  return !!value && typeof value === "object" && !types.isProxy(value) && RUNNERS.has(value);
}
export function consumeWanT2vAudioProbe(value: unknown): Uint8Array {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) invalid();
  const bytes = BYTES.get(value); if (!bytes) invalid();
  BYTES.delete(value); return bytes;
}
export function releaseWanT2vAudioProbe(value: unknown): void {
  if (!value || typeof value !== "object" || types.isProxy(value)) return;
  BYTES.get(value)?.fill(0); BYTES.delete(value);
}
export function createWanT2vAudioProbe(ffprobePath: string): WanT2vAudioProbeRunner {
  if (typeof ffprobePath !== "string" || !isAbsolute(ffprobePath) || ffprobePath.trim() !== ffprobePath || /[\u0000-\u001f]/u.test(ffprobePath)) invalid();
  const runner = Object.freeze({ probe: (input: unknown, signal?: AbortSignal) => probe(ffprobePath, input, signal) });
  RUNNERS.add(runner); return runner;
}
function invalid(): never { throw new OwnerWanT2vAudioUploadError("INVALID_AUDIO"); }
function fields(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) invalid();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = ["model_id", "filename", "mime_type", "content_base64"];
  if (Reflect.ownKeys(descriptors).length !== keys.length) invalid();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid();
    result[key] = descriptor.value;
  }
  return result;
}
async function probe(ffprobePath: string, input: unknown, signal?: AbortSignal): Promise<Readonly<WanT2vAudioProbeResult>> {
  const row = fields(input), mime = row.mime_type;
  if ((row.model_id !== "wan_26_t2v" && row.model_id !== "wan_27_t2v") || typeof row.filename !== "string" ||
      row.filename.length < 1 || row.filename.length > 255 || /[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(row.filename) ||
      row.filename.trim() !== row.filename || /[. ]$/u.test(row.filename) ||
      (mime !== "audio/mpeg" && mime !== "audio/mp3" && mime !== "audio/wav" && mime !== "audio/x-wav") ||
      extname(row.filename).toLowerCase() !== (mime === "audio/wav" || mime === "audio/x-wav" ? ".wav" : ".mp3") ||
      typeof row.content_base64 !== "string" || row.content_base64.length < 24 ||
      row.content_base64.length > Math.ceil(WAN_T2V_AUDIO_UPLOAD_SOURCE.max_file_bytes / 3) * 4 ||
      !isCanonicalBase64(row.content_base64, Math.ceil(WAN_T2V_AUDIO_UPLOAD_SOURCE.max_file_bytes / 3) * 4)) invalid();
  if (signal?.aborted) invalid();
  const bytes = Buffer.from(row.content_base64, "base64");
  if (bytes.length < 16 || bytes.length > WAN_T2V_AUDIO_UPLOAD_SOURCE.max_file_bytes || bytes.toString("base64") !== row.content_base64) { bytes.fill(0); invalid(); }
  let directory: string | undefined, path: string | undefined;
  let createdFile = false;
  try {
    directory = await mkdtemp(join(tmpdir(), "syntx-wan-t2v-audio-")); await chmod(directory, 0o700);
    path = join(directory, mime === "audio/wav" || mime === "audio/x-wav" ? "source.wav" : "source.mp3");
    const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    createdFile = true;
    try { await file.chmod(0o600); await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    const { stdout } = await run(ffprobePath, ["-v", "error", "-protocol_whitelist", "file,pipe", "-count_frames", "-show_entries",
      "stream=codec_type,codec_name,sample_rate,channels,nb_read_frames,duration:format=duration,format_name", "-of", "json", path],
    { encoding: "utf8", timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 65_536, windowsHide: true,
      ...(signal ? { signal } : {}), env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" } });
    const data = JSON.parse(stdout) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
    const stream = data.streams?.[0];
    const duration = Number(stream?.duration ?? data.format?.duration);
    const wavCodecs = ["pcm_u8", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_f64le"];
    if (!Array.isArray(data.streams) || data.streams.length !== 1 || !stream || stream.codec_type !== "audio" ||
        data.format?.format_name !== (mime === "audio/wav" || mime === "audio/x-wav" ? "wav" : "mp3") ||
        (mime === "audio/wav" || mime === "audio/x-wav" ? !wavCodecs.includes(String(stream.codec_name)) : stream.codec_name !== "mp3") ||
        !Number.isFinite(duration) || duration < (row.model_id === "wan_26_t2v" ? 3 : 2) || duration > WAN_T2V_AUDIO_UPLOAD_SOURCE.max_duration_seconds ||
        ![stream.sample_rate, stream.channels, stream.nb_read_frames].every((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0)) invalid();
    const result: WanT2vAudioProbeResult = Object.freeze({ policy_id: WAN_T2V_AUDIO_UPLOAD_SOURCE.policy_id,
      model_id: row.model_id, filename: row.filename, mime_type: mime === "audio/wav" || mime === "audio/x-wav" ? "audio/wav" : "audio/mpeg",
      size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), duration_seconds: duration });
    BYTES.set(result, new Uint8Array(bytes)); return result;
  } catch (error) {
    if (error instanceof OwnerWanT2vAudioUploadError) throw error;
    throw new OwnerWanT2vAudioUploadError("PROBE_FAILED");
  } finally {
    bytes.fill(0);
    let cleanupFailed = false;
    if (createdFile && path) { try { await unlink(path); } catch { cleanupFailed = true; } }
    if (directory) { try { await rmdir(directory); } catch { cleanupFailed = true; } }
    if (cleanupFailed) throw new OwnerWanT2vAudioUploadError("PROBE_FAILED");
  }
}
