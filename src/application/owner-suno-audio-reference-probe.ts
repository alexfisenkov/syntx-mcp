import { prepareLocalMediaWindowsDirectory, assertLocalMediaWindowsFiles } from "./local-media-native-permissions.js";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join } from "node:path";
import { promisify, types } from "node:util";

export const SUNO_AUDIO_UPLOAD_SOURCE = Object.freeze({
  policy_id: "OWNER_SUNO_UPLOADED_AUDIO_20261105" as const,
  build_id: "1793711938" as const,
  public_catalog_version: "sha256-bca24244ca2a2ffc79e6788621993335181f0a44958d3b0ff0fac724326fd41b.json" as const,
  settings_inventory_version: "sha256-f8012eea6e0f7017604df399f6d5e1e5dc1f41dec5e813ec353588de746866b2.json" as const,
  form_sha256: "sha256:ca2c8ab95884e991fe5f2569e49ff996713f4d2c642415852e32ddf5da25e7ec" as const,
  max_file_bytes: 26_214_400, max_duration_seconds: 480,
  upload_destination: "uploaded" as const, convert_field: "OMITTED_AS_IS" as const,
  source_ids: "EMPTY_STRINGS" as const, file_urls: "ONE_OWNED_AUDIO_UPLOAD" as const,
  provider_acceptance: "UNPROVEN" as const
});
export type SunoAudioModel = "V6" | "V6_wild";
export interface SunoAudioProbeResult {
  readonly policy_id: typeof SUNO_AUDIO_UPLOAD_SOURCE.policy_id;
  readonly model_id: SunoAudioModel;
  readonly filename: string;
  readonly mime_type: "audio/mpeg" | "audio/wav";
  readonly size: number;
  readonly sha256: string;
  readonly duration_seconds: number;
}
export interface SunoAudioProbeRunner { probe(input: unknown, signal?: AbortSignal): Promise<Readonly<SunoAudioProbeResult>>; }
export class OwnerSunoAudioUploadError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "INVALID_AUDIO" | "PROBE_FAILED" | "UPLOAD_DISABLED" |
    "UPLOAD_OUTCOME_UNKNOWN" | "UPLOAD_INTENT_ALREADY_CLAIMED" | "REFERENCE_UNAVAILABLE") {
    super("The owner Suno audio upload could not be completed safely."); this.name = "OwnerSunoAudioUploadError";
  }
}
const run = promisify(execFile);
const BYTES = new WeakMap<object, Uint8Array>();
const RUNNERS = new WeakSet<object>();
export function isSunoAudioProbeRunner(value: unknown): value is SunoAudioProbeRunner {
  return !!value && typeof value === "object" && !types.isProxy(value) && RUNNERS.has(value);
}
export function consumeSunoAudioProbe(value: unknown): Uint8Array {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) invalid();
  const bytes = BYTES.get(value); if (!bytes) invalid();
  BYTES.delete(value); return bytes;
}
export function releaseSunoAudioProbe(value: unknown): void {
  if (!value || typeof value !== "object" || types.isProxy(value)) return;
  BYTES.get(value)?.fill(0); BYTES.delete(value);
}
export function createSunoAudioProbe(ffprobePath: string): SunoAudioProbeRunner {
  if (typeof ffprobePath !== "string" || !isAbsolute(ffprobePath) || ffprobePath.trim() !== ffprobePath || /[\u0000-\u001f]/u.test(ffprobePath)) invalid();
  const runner = Object.freeze({ probe: (input: unknown, signal?: AbortSignal) => probe(ffprobePath, input, signal) });
  RUNNERS.add(runner); return runner;
}
function invalid(): never { throw new OwnerSunoAudioUploadError("INVALID_AUDIO"); }
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
async function probe(ffprobePath: string, input: unknown, signal?: AbortSignal): Promise<Readonly<SunoAudioProbeResult>> {
  const row = fields(input), mime = row.mime_type;
  if ((row.model_id !== "V6" && row.model_id !== "V6_wild") || typeof row.filename !== "string" ||
      row.filename.length < 1 || row.filename.length > 255 || /[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(row.filename) ||
      row.filename.trim() !== row.filename || /[. ]$/u.test(row.filename) ||
      (mime !== "audio/mpeg" && mime !== "audio/mp3" && mime !== "audio/wav") ||
      extname(row.filename).toLowerCase() !== (mime === "audio/wav" ? ".wav" : ".mp3") ||
      typeof row.content_base64 !== "string" || row.content_base64.length < 24 ||
      row.content_base64.length > Math.ceil(SUNO_AUDIO_UPLOAD_SOURCE.max_file_bytes / 3) * 4 ||
      row.content_base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(row.content_base64)) invalid();
  if (signal?.aborted) invalid();
  const bytes = Buffer.from(row.content_base64, "base64");
  if (bytes.length < 16 || bytes.length > SUNO_AUDIO_UPLOAD_SOURCE.max_file_bytes || bytes.toString("base64") !== row.content_base64) { bytes.fill(0); invalid(); }
  let directory: string | undefined, path: string | undefined;
  let createdFile = false;
  try {
    directory = await mkdtemp(join(tmpdir(), "syntx-suno-audio-")); await chmod(directory, 0o700); await prepareLocalMediaWindowsDirectory(directory, [ffprobePath], signal);
    path = join(directory, mime === "audio/wav" ? "source.wav" : "source.mp3");
    const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    createdFile = true;
    try { await file.chmod(0o600); await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await assertLocalMediaWindowsFiles([path], signal);
    const { stdout } = await run(ffprobePath, ["-v", "error", "-protocol_whitelist", "file,pipe", "-count_frames", "-show_entries",
      "stream=codec_type,codec_name,sample_rate,channels,nb_read_frames,duration:format=duration,format_name", "-of", "json", path],
    { encoding: "utf8", timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 65_536, windowsHide: true,
      ...(signal ? { signal } : {}), env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C", ...(process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) } });
    const data = JSON.parse(stdout) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
    const stream = data.streams?.[0];
    const duration = Number(stream?.duration ?? data.format?.duration);
    const wavCodecs = ["pcm_u8", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_f64le"];
    if (!Array.isArray(data.streams) || data.streams.length !== 1 || !stream || stream.codec_type !== "audio" ||
        data.format?.format_name !== (mime === "audio/wav" ? "wav" : "mp3") ||
        (mime === "audio/wav" ? !wavCodecs.includes(String(stream.codec_name)) : stream.codec_name !== "mp3") ||
        !Number.isFinite(duration) || duration <= 0 || duration > SUNO_AUDIO_UPLOAD_SOURCE.max_duration_seconds ||
        ![stream.sample_rate, stream.channels, stream.nb_read_frames].every((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0)) invalid();
    const result: SunoAudioProbeResult = Object.freeze({ policy_id: SUNO_AUDIO_UPLOAD_SOURCE.policy_id,
      model_id: row.model_id, filename: row.filename, mime_type: mime === "audio/wav" ? "audio/wav" : "audio/mpeg",
      size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), duration_seconds: duration });
    BYTES.set(result, new Uint8Array(bytes)); return result;
  } catch (error) {
    if (error instanceof OwnerSunoAudioUploadError) throw error;
    throw new OwnerSunoAudioUploadError("PROBE_FAILED");
  } finally {
    bytes.fill(0);
    let cleanupFailed = false;
    if (createdFile && path) { try { await unlink(path); } catch { cleanupFailed = true; } }
    if (directory) { try { await rmdir(directory); } catch { cleanupFailed = true; } }
    if (cleanupFailed) throw new OwnerSunoAudioUploadError("PROBE_FAILED");
  }
}
