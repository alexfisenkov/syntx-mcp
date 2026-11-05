import { prepareLocalMediaWindowsDirectory, assertLocalMediaWindowsFiles, localMediaTempRoot } from "./local-media-native-permissions.js";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { types } from "node:util";

const MAX_BYTES = 50 * 1024 * 1024, RATE = 48000, MAX_PCM_BYTES = 300 * RATE * 4;
export const OWNER_ELEVENLABS_STS_CURRENT_INPUTS = Object.freeze({
  status: "FORM_SOURCE_REVIEWED", build_id: "1793890358",
  public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  form_sha256: "sha256:1b918b6db434ef1c04e210c4bef61974182b3083d0fdb063f4785cca930a8a0f",
  uploader_helper_sha256: "sha256:5469e749f3d5a2ee619417d5086931e445fa4a9f336afec3efd0349eacfba944",
  source_mime_types: Object.freeze(["audio/mpeg", "audio/mp3", "audio/wav"]), maximum_bytes: MAX_BYTES,
  duration_seconds: Object.freeze({ minimum: 5, maximum: 300 }),
  wav_compatibility: "OPTIONAL_TRUSTED_FFMPEG_FULL_AUDIO_TO_MP3_48KHZ_MAX2CHANNELS; STREAM_DECODE_SAMPLE_DURATION; NEVER_TRIM",
  original_mp3: "PRESERVED_BYTE_FOR_BYTE", direct_wav_provider_acceptance: "NOT_CLAIMED", provider_acceptance: "UNPROVEN_FOR_PREPARED_INPUT"
} as const);
export interface PreparedOwnerElevenLabsStsAudio {
  readonly filename: "prepared-sts-source.mp3"; readonly mime_type: "audio/mpeg"; readonly size: number; readonly sha256: string;
  readonly preparation: Readonly<{ kind: "WAV_TO_MP3_LOCAL_FULL_AUDIO"; original_mime_type: "audio/wav"; original_sha256: string;
    original_size: number; original_duration_seconds: number; uploaded_duration_seconds: number; sample_rate: 48000; channels: number;
    duration_basis: "ACTUAL_DECODED_PRESENTATION_SAMPLES_NOT_MP3_CONTAINER_PADDING"; direct_wav_upload: false }>;
}
const states = new WeakMap<object, { bytes: Buffer; receipt: Readonly<PreparedOwnerElevenLabsStsAudio> }>();
export async function prepareOwnerElevenLabsStsWav(input: { readonly bytes: Uint8Array; readonly filename: string },
  config: { readonly ffmpegPath: string; readonly ffprobePath: string }, signal?: AbortSignal): Promise<Readonly<PreparedOwnerElevenLabsStsAudio>> {
  if (!cleanPath(config.ffmpegPath) || !cleanPath(config.ffprobePath) || !input || types.isProxy(input) ||
      typeof input.filename !== "string" || input.filename !== input.filename.trim() || Buffer.byteLength(input.filename) > 255 || !/^[^\\/\p{Cc}\p{Cf}\p{Cs}]+\.wav$/iu.test(input.filename) || !input.bytes || types.isProxy(input.bytes) ||
      !(input.bytes instanceof Uint8Array) || Object.getPrototypeOf(input.bytes) !== Uint8Array.prototype && Object.getPrototypeOf(input.bytes) !== Buffer.prototype ||
      ["buffer", "byteLength", "byteOffset", "length"].some(key => Object.hasOwn(input.bytes, key)) || input.bytes.byteLength < 44 || input.bytes.byteLength > MAX_BYTES) invalid();
  const source = Buffer.from(input.bytes);
  if (!["RIFF", "RIFX", "RF64"].includes(source.toString("ascii", 0, 4)) || source.toString("ascii", 8, 12) !== "WAVE") { source.fill(0); invalid(); }
  let directory: string | undefined, prepared: Buffer | undefined;
  try {
    directory = await mkdtemp(join(await localMediaTempRoot(), "syntx-sts-wav-")); await chmod(directory, 0o700); await prepareLocalMediaWindowsDirectory(directory, [config.ffprobePath, config.ffmpegPath], signal);
    const original = join(directory, "original.wav"), output = join(directory, "prepared.mp3");
    await privateWrite(original, source);
    await assertLocalMediaWindowsFiles([original], signal);
    const root = JSON.parse(await run(config.ffprobePath, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,sample_rate,channels,duration:format=format_name,duration", "-of", "json", original], signal, 15000));
    if (root.format?.format_name !== "wav" || !Array.isArray(root.streams) || root.streams.length !== 1 || root.streams[0]?.codec_type !== "audio") invalid();
    const stream = root.streams[0], duration = Number(stream.duration ?? root.format.duration), sampleRate = Number(stream.sample_rate), originalChannels = Number(stream.channels);
    if (!Number.isFinite(duration) || duration < 5 || duration > 300 || !Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000 ||
        !Number.isSafeInteger(originalChannels) || originalChannels < 1 || originalChannels > 32) invalid();
    const channels = Math.min(originalChannels, 2), created = await open(output, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    let identity: { dev: number; ino: number };
    try { await created.chmod(0o600); const stat = await created.stat(); identity = { dev: stat.dev, ino: stat.ino }; } finally { await created.close(); }
    await run(config.ffmpegPath, ["-v", "error", "-nostdin", "-y", "-i", original, "-map", "0:a:0", "-vn", "-ar", String(RATE), "-ac", String(channels),
      "-c:a", "libmp3lame", "-b:a", "192k", "-write_xing", "1", "-map_metadata", "-1", "-fs", String(MAX_BYTES + 1), output], signal, 60000);
    await assertLocalMediaWindowsFiles([output], signal);
    const stat = await lstat(output); if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino || stat.size < 16 || stat.size > MAX_BYTES) invalid();
    // Counting streamed mono float samples accounts for Xing delay/padding; it neither retains PCM nor trims the source.
    const presentationDuration = await decodedPresentationDuration(config.ffmpegPath, output, signal);
    if (presentationDuration < 5 || presentationDuration > 300 || Math.abs(presentationDuration - duration) > 1 / 8000 + 1 / RATE) invalid();
    const file = await open(output, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { const before = await file.stat(); if (before.dev !== identity.dev || before.ino !== identity.ino || before.size !== stat.size) invalid(); prepared = await file.readFile(); if (prepared.length !== before.size) invalid(); }
    finally { await file.close(); }
    const receipt: PreparedOwnerElevenLabsStsAudio = Object.freeze({ filename: "prepared-sts-source.mp3", mime_type: "audio/mpeg", size: prepared.length,
      sha256: hash(prepared), preparation: Object.freeze({ kind: "WAV_TO_MP3_LOCAL_FULL_AUDIO", original_mime_type: "audio/wav", original_sha256: hash(source),
        original_size: source.length, original_duration_seconds: duration, uploaded_duration_seconds: presentationDuration, sample_rate: RATE, channels,
        duration_basis: "ACTUAL_DECODED_PRESENTATION_SAMPLES_NOT_MP3_CONTAINER_PADDING", direct_wav_upload: false }) });
    states.set(receipt, { bytes: prepared, receipt }); prepared = undefined; return receipt;
  } catch { return invalid(); }
  finally { source.fill(0); prepared?.fill(0); if (directory) await rm(directory, { recursive: true, force: true }); }
}
export function copyPreparedOwnerElevenLabsStsAudio(value: unknown): Buffer {
  const state = stateFor(value); if (!state) invalid(); return Buffer.from(state.bytes);
}
export function readPreparedOwnerElevenLabsStsAudio(value: unknown, sha256: string): Readonly<PreparedOwnerElevenLabsStsAudio> | null {
  const state = stateFor(value); return state?.receipt.sha256 === sha256 ? state.receipt : null;
}
export function releasePreparedOwnerElevenLabsStsAudio(value: unknown): void { const state = stateFor(value); if (state) { state.bytes.fill(0); states.delete(value as object); } }
function stateFor(value: unknown) { if (!value || typeof value !== "object" || types.isProxy(value)) return undefined; const state = states.get(value); return state && Object.isFrozen(value) && hash(state.bytes) === state.receipt.sha256 ? state : undefined; }
async function privateWrite(path: string, bytes: Buffer) { const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600); try { await file.chmod(0o600); await file.writeFile(bytes); await file.sync(); } finally { await file.close(); } }
function run(binary: string, args: string[], signal: AbortSignal | undefined, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => execFile(binary, args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 65536, killSignal: "SIGKILL", ...(signal === undefined ? {} : { signal }) },
    (error, stdout) => error ? reject(new Error("STS_WAV_PREPARATION_FAILED")) : resolve(stdout)));
}
function decodedPresentationDuration(binary: string, path: string, signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["-v", "error", "-nostdin", "-i", path, "-map", "0:a:0", "-vn", "-ar", String(RATE), "-ac", "1", "-f", "f32le", "pipe:1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let bytes = 0, errors = 0, failed = false; const kill = () => { failed = true; child.kill("SIGKILL"); };
    const timer = setTimeout(kill, 60000); signal?.addEventListener("abort", kill, { once: true }); if (signal?.aborted) kill();
    child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; chunk.fill(0); if (bytes > MAX_PCM_BYTES) kill(); });
    child.stderr.on("data", (chunk: Buffer) => { errors += chunk.length; chunk.fill(0); if (errors > 8192) kill(); });
    child.once("error", () => { failed = true; }); child.once("close", code => { clearTimeout(timer); signal?.removeEventListener("abort", kill);
      if (failed || code !== 0 || bytes < 1 || bytes % 4 !== 0) reject(new Error("STS_WAV_PRESENTATION_DECODE_FAILED")); else resolve(bytes / 4 / RATE); });
  });
}
function cleanPath(value: unknown): value is string { return typeof value === "string" && isAbsolute(value) && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value); }
function hash(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function invalid(): never { throw new Error("STS_WAV_PREPARATION_FAILED"); }
