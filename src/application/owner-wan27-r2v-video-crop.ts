import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { types } from "node:util";
import { copyTrustedOwnerWan27R2vOriginalBytes, isTrustedOwnerWan27R2vOriginalProbeResult } from "./owner-wan27-r2v-original-probe.js";
import { getOwnerWan27R2vVideoSelectionMetadata, OWNER_WAN27_R2V_VIDEO_SELECTION_POLICY } from "./owner-wan27-r2v-video-selection.js";

const MAX_BYTES = 100 * 1024 * 1024, MAX_TEXT = 64 * 1024, TIMEOUT_MS = 30_000;
const POLICY = "OWNER_WAN27_R2V_LOCAL_CFR_CROP_V1" as const;

export interface OwnerWan27R2vVideoCropReceipt {
  readonly model_id: "wan_27_r2v";
  readonly source_sha256: string;
  readonly source_policy_id: string;
  readonly selection_policy_id: string;
  readonly crop_policy_id: typeof POLICY;
  readonly crop_sha256: string;
  readonly mime_type: "video/mp4";
  readonly bytes: number;
  readonly metadata: Readonly<{ width: number; height: number; frame_rate: Readonly<{ numerator: number; denominator: number }>; frame_count: number; video_duration_seconds: number; codec: "h264"; audio_stream_count: number }>;
  readonly encoding_policy: "CFR_LOCAL_ENCODING_NOT_PROVIDER_PROOF";
  readonly generation_permit: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
}

export class OwnerWan27R2vVideoCropError extends Error {
  constructor(readonly code: "INVALID_CROP" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "CROP_FAILED" | "CROP_ABORTED") {
    super("WAN 2.7 R2V selected-video crop could not be safely produced."); this.name = "OwnerWan27R2vVideoCropError";
  }
}

export interface OwnerWan27R2vVideoCropProcessor { crop(original: unknown, selection: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerWan27R2vVideoCropReceipt>> }

const receipts = new WeakMap<object, Buffer>(), descriptors = new WeakMap<object, PropertyDescriptorMap>();

/** ffmpegPath and ffprobePath are trusted absolute operator configuration, never request data. */
export function createOwnerWan27R2vVideoCropProcessor(config: unknown): OwnerWan27R2vVideoCropProcessor {
  const paths = exactConfig(config);
  return Object.freeze({ crop: (original: unknown, selection: unknown, options?: Readonly<{ signal?: AbortSignal }>) => crop(paths, original, selection, options) });
}

export function isTrustedOwnerWan27R2vVideoCropReceipt(value: unknown): value is Readonly<OwnerWan27R2vVideoCropReceipt> {
  if (!value || typeof value !== "object" || types.isProxy(value) || !receipts.has(value) || !Object.isFrozen(value)) return false;
  const expected = descriptors.get(value), actual = Object.getOwnPropertyDescriptors(value);
  return !!expected && Reflect.ownKeys(actual).length === Reflect.ownKeys(expected).length && Reflect.ownKeys(actual).every((key) => {
    const a = actual[key as keyof typeof actual], e = expected[key as keyof typeof expected];
    return !!a && !!e && Object.hasOwn(a, "value") && a.value === e.value && a.enumerable === e.enumerable && !a.configurable && !a.writable;
  });
}

/** Copies owned crop bytes only while the frozen receipt remains genuine. */
export function copyTrustedOwnerWan27R2vVideoCropBytes(value: unknown): Uint8Array {
  if (!isTrustedOwnerWan27R2vVideoCropReceipt(value)) invalid();
  return new Uint8Array(receipts.get(value)!);
}

/** Wipes and revokes bytes after a future upload consumer finishes. */
export function releaseTrustedOwnerWan27R2vVideoCropReceipt(value: unknown): void {
  if (!isTrustedOwnerWan27R2vVideoCropReceipt(value)) invalid();
  receipts.get(value)!.fill(0); receipts.delete(value); descriptors.delete(value);
}

async function crop(paths: Readonly<{ ffmpegPath: string; ffprobePath: string }>, original: unknown, selection: unknown,
  options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerWan27R2vVideoCropReceipt>> {
  const signal = exactOptions(options), metadata = getOwnerWan27R2vVideoSelectionMetadata(original, selection);
  if (!isTrustedOwnerWan27R2vOriginalProbeResult(original) || !metadata || signal?.aborted) return signal?.aborted ? aborted() : invalid();
  if (!Number.isFinite(metadata.effective_start_seconds) || !Number.isFinite(metadata.duration_seconds) || metadata.frame_count < 1 ||
      metadata.frame_rate.numerator / metadata.frame_rate.denominator > 240) limit();
  const copied = copyTrustedOwnerWan27R2vOriginalBytes(original);
  let source: Buffer;
  try { source = Buffer.from(copied); } finally { copied.fill(0); }
  if (source.length !== original.bytes_copied || sha(source) !== original.source_sha256) { source.fill(0); return invalid(); }
  const audioCount = original.metadata.codec_streams.filter((s) => s.type === "audio").length;
  if (audioCount > 16) { source.fill(0); return limit(); }
  let dir: string | undefined, inputPath: string | undefined, outputPath: string | undefined, inCreated = false, outCreated = false, owned: Buffer | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "syntx-wan27-r2v-crop-")); await chmod(dir, 0o700);
    inputPath = join(dir, "source.mp4"); outputPath = join(dir, "crop.mp4");
    inCreated = true; await secureWrite(inputPath, source);
    outCreated = true; await createPrivateOutput(outputPath);
    await run(paths.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(metadata.effective_start_seconds), "-i", inputPath,
      "-t", String(metadata.duration_seconds), "-map", "0:v:0", "-map", "0:a?", "-vf", `fps=${metadata.frame_rate.numerator}/${metadata.frame_rate.denominator}`,
      "-frames:v", String(metadata.frame_count), "-fps_mode", "cfr", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-movflags", "+faststart", "-fs", String(MAX_BYTES + 1), outputPath], signal, 8 * 1024);
    if (!isTrustedOwnerWan27R2vOriginalProbeResult(original) || getOwnerWan27R2vVideoSelectionMetadata(original, selection) !== metadata) invalid();
    const info = await lstat(outputPath);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600 || info.size < 16) invalid(); if (info.size > MAX_BYTES) limit();
    const parsed = parseProbe(await run(paths.ffprobePath, ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,duration:format=format_name", "-of", "json", outputPath], signal, MAX_TEXT));
    const frameSeconds = metadata.frame_rate.denominator / metadata.frame_rate.numerator;
    if (parsed.width !== original.metadata.width || parsed.height !== original.metadata.height || parsed.codec !== "h264" ||
        BigInt(parsed.rate.numerator) * BigInt(metadata.frame_rate.denominator) !== BigInt(metadata.frame_rate.numerator) * BigInt(parsed.rate.denominator) || parsed.frames !== metadata.frame_count ||
        Math.abs(parsed.duration - metadata.duration_seconds) > frameSeconds + 0.000001 ||
        parsed.duration > 5 / metadata.video_reference_count + 0.000001 || parsed.audioCount !== audioCount) invalid();
    owned = await readOwnedFile(outputPath, info.size);
    const receipt = Object.freeze({ model_id: "wan_27_r2v" as const, source_sha256: original.source_sha256, source_policy_id: original.source_policy_id,
      selection_policy_id: OWNER_WAN27_R2V_VIDEO_SELECTION_POLICY.policy_id, crop_policy_id: POLICY,
      crop_sha256: sha(owned), mime_type: "video/mp4" as const, bytes: owned.length,
      metadata: Object.freeze({ width: parsed.width, height: parsed.height, frame_rate: Object.freeze(parsed.rate), frame_count: parsed.frames,
        video_duration_seconds: parsed.duration, codec: "h264" as const, audio_stream_count: parsed.audioCount }),
      encoding_policy: "CFR_LOCAL_ENCODING_NOT_PROVIDER_PROOF" as const, generation_permit: false as const, owner_upload_binding: "NOT_ESTABLISHED" as const });
    receipts.set(receipt, owned); descriptors.set(receipt, Object.getOwnPropertyDescriptors(receipt)); owned = undefined; return receipt;
  } catch (error) {
    owned?.fill(0); if (error instanceof OwnerWan27R2vVideoCropError) throw error;
    if (signal?.aborted) return aborted(); throw new OwnerWan27R2vVideoCropError("CROP_FAILED");
  } finally {
    source.fill(0); let failed = false;
    for (const [path, created] of [[inputPath, inCreated], [outputPath, outCreated]] as const) if (path && created) try { await wipe(path, path === outputPath); } catch (error) { if (!isMissing(error)) failed = true; }
    if (dir) try { await rmdir(dir); } catch { failed = true; }
    if (failed) throw new OwnerWan27R2vVideoCropError("CROP_FAILED");
  }
}

async function secureWrite(path: string, bytes: Buffer): Promise<void> {
  const file = await open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
  try { await file.chmod(0o600); await file.writeFile(bytes); await file.sync(); if (!(await file.stat()).isFile()) invalid(); } finally { await file.close(); }
}
async function createPrivateOutput(path: string): Promise<void> {
  const file = await open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
  try { await file.chmod(0o600); await file.sync(); const stat = await file.stat(); if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) invalid(); } finally { await file.close(); }
}
async function readOwnedFile(path: string, expectedSize: number): Promise<Buffer> {
  const file = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try { const before = await file.stat(); if (!before.isFile() || before.size !== expectedSize) invalid(); const bytes = await file.readFile();
    const after = await file.stat(); if (after.size !== before.size || bytes.length !== before.size) { bytes.fill(0); invalid(); } return bytes;
  } finally { await file.close(); }
}
async function wipe(path: string, allowOversize = false): Promise<void> {
  const pathInfo = await lstat(path);
  if (pathInfo.isSymbolicLink()) { await unlink(path); return; }
  if (!pathInfo.isFile()) invalid();
  const file = await open(path, fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const s = await file.stat(); if (!s.isFile()) invalid();
    try {
      if (s.size > MAX_BYTES) { if (!allowOversize) invalid(); await file.truncate(0); }
      else { const zeros = Buffer.alloc(64 * 1024); try { for (let at = 0; at < s.size; at += zeros.length) await file.write(zeros, 0, Math.min(zeros.length, s.size - at), at); } finally { zeros.fill(0); } }
      await file.sync();
    } catch { /* unlink below is still required for this private temporary file */ }
  } finally { await file.close(); }
  await unlink(path);
}
function run(path: string, args: string[], signal: AbortSignal | undefined, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>; try { child = spawn(path, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" } }); }
    catch (e) { reject(e); return; }
    let out = "", err = "", failed = false, failure: Error | undefined, timer: NodeJS.Timeout;
    const kill = (reason: Error) => { if (!failed) { failed = true; failure = reason; child.kill("SIGKILL"); } };
    timer = setTimeout(() => kill(new OwnerWan27R2vVideoCropError("CROP_FAILED")), TIMEOUT_MS);
    const onAbort = () => kill(new OwnerWan27R2vVideoCropError("CROP_ABORTED")); signal?.addEventListener("abort", onAbort, { once: true }); if (signal?.aborted) onAbort();
    const collect = (which: "out" | "err") => (chunk: Buffer) => { if (failed) return; const next = which === "out" ? out + chunk.toString("utf8") : err + chunk.toString("utf8"); if (Buffer.byteLength(next) > max) kill(new OwnerWan27R2vVideoCropError("LOCAL_RESOURCE_LIMIT_EXCEEDED")); else if (which === "out") out = next; else err = next; };
    child.stdout?.on("data", collect("out")); child.stderr?.on("data", collect("err")); child.once("error", (e) => kill(e));
    child.once("close", (code) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); if (failure) reject(failure); else if (code === 0) resolve(out); else reject(new Error(`media process exited ${code}`)); });
  });
}
function parseProbe(text: string): { width: number; height: number; frames: number; duration: number; rate: { numerator: number; denominator: number }; codec: string; audioCount: number } {
  let root: any; try { root = JSON.parse(text); } catch { return invalid(); }
  if (!root || root.format?.format_name !== "mov,mp4,m4a,3gp,3g2,mj2" || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > 32) return invalid();
  const videos = root.streams.filter((s: any) => s?.codec_type === "video"), audios = root.streams.filter((s: any) => s?.codec_type === "audio");
  if (videos.length !== 1 || audios.length > 16) return invalid(); const v = videos[0], rate = parseRate(v.avg_frame_rate);
  const width = positive(v.width), height = positive(v.height), frames = positive(v.nb_read_frames), duration = Number(v.duration);
  if (!rate || !width || !height || !frames || !Number.isFinite(duration) || duration <= 0 || typeof v.codec_name !== "string") return invalid();
  return { width, height, frames, duration, rate, codec: v.codec_name, audioCount: audios.length };
}
function parseRate(v: unknown): { numerator: number; denominator: number } | undefined { if (typeof v !== "string") return; const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(v); if (!m) return; const numerator = Number(m[1]), denominator = Number(m[2]); return Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) ? { numerator, denominator } : undefined; }
function positive(v: unknown): number | undefined { const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v; return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : undefined; }
function exactConfig(value: unknown): Readonly<{ ffmpegPath: string; ffprobePath: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalid(); const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || keys.length !== 2 || !keys.includes("ffmpegPath") || !keys.includes("ffprobePath")) return invalid();
  const p = (k: "ffmpegPath" | "ffprobePath") => { const x = d[k]; if (!x || !Object.hasOwn(x, "value") || !x.enumerable || typeof x.value !== "string" || !isAbsolute(x.value) || x.value !== x.value.trim() || x.value.includes("\0") || !basename(x.value)) return invalid(); return x.value; };
  return Object.freeze({ ffmpegPath: p("ffmpegPath"), ffprobePath: p("ffprobePath") });
}
function exactOptions(value: unknown): AbortSignal | undefined { if (value === undefined) return; if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalid(); const d = Object.getOwnPropertyDescriptors(value); if (Reflect.ownKeys(d).length !== 1 || !d.signal || !Object.hasOwn(d.signal, "value") || !d.signal.enumerable) return invalid(); const s = d.signal.value; if (!s || typeof s.aborted !== "boolean" || typeof s.addEventListener !== "function") return invalid(); return s as AbortSignal; }
function sha(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function isMissing(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"); }
function invalid(): never { throw new OwnerWan27R2vVideoCropError("INVALID_CROP"); }
function limit(): never { throw new OwnerWan27R2vVideoCropError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
function aborted(): never { throw new OwnerWan27R2vVideoCropError("CROP_ABORTED"); }
