import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { types } from "node:util";
import { copyTrustedOwnerWan26R2vOriginalBytes, isTrustedOwnerWan26R2vOriginalProbeResult } from "./owner-wan26-r2v-original-probe.js";
import { getOwnerWan26R2vVideoSelectionMetadata, OWNER_WAN26_R2V_VIDEO_SELECTION_POLICY } from "./owner-wan26-r2v-video-selection.js";

const MAX_BYTES = 100 * 1024 * 1024, MAX_TEXT = 64 * 1024, TIMEOUT_MS = 30_000;
const POLICY = "OWNER_WAN26_R2V_LOCAL_CFR_CROP_V1" as const;
const SIGNAL_PROTO = AbortSignal.prototype, ABORTED_GET = Object.getOwnPropertyDescriptor(SIGNAL_PROTO, "aborted")?.get;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
let active = false;
export interface OwnerWan26R2vVideoCropReceipt {
  readonly model_id: "wan_26_r2v" | "wan_26_r2v_flash"; readonly source_sha256: string; readonly source_policy_id: string;
  readonly selection_policy_id: string; readonly crop_policy_id: typeof POLICY; readonly crop_sha256: string;
  readonly mime_type: "video/mp4"; readonly bytes: number;
  readonly metadata: Readonly<{ width: number; height: number; frame_rate: Readonly<{ numerator: number; denominator: number }>; frame_count: number; video_duration_seconds: number; codec: "h264"; audio_stream_count: number }>;
  readonly encoding_policy: "CFR_LOCAL_ENCODING_NOT_PROVIDER_PROOF"; readonly generation_permit: false; readonly owner_upload_binding: "NOT_ESTABLISHED";
}
export class OwnerWan26R2vVideoCropError extends Error {
  constructor(readonly code: "INVALID_CROP" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "LOCAL_RESOURCE_BUSY" | "CROP_FAILED" | "CROP_ABORTED") {
    super("WAN 2.6 R2V selected-video crop could not be safely produced."); this.name = "OwnerWan26R2vVideoCropError";
  }
}
export interface OwnerWan26R2vVideoCropProcessor { crop(original: unknown, selection: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerWan26R2vVideoCropReceipt>> }
const receipts = new WeakMap<object, Buffer>(), descriptors = new WeakMap<object, PropertyDescriptorMap>();
export function createOwnerWan26R2vVideoCropProcessor(config: unknown): OwnerWan26R2vVideoCropProcessor {
  const paths = exactConfig(config); return Object.freeze({ crop: (o: unknown, s: unknown, p?: Readonly<{ signal?: AbortSignal }>) => crop(paths, o, s, p) });
}
export function isTrustedOwnerWan26R2vVideoCropReceipt(value: unknown): value is Readonly<OwnerWan26R2vVideoCropReceipt> {
  if (!value || typeof value !== "object" || types.isProxy(value) || !receipts.has(value) || !Object.isFrozen(value)) return false;
  const expected = descriptors.get(value), actual = Object.getOwnPropertyDescriptors(value);
  return !!expected && Reflect.ownKeys(actual).length === Reflect.ownKeys(expected).length && Reflect.ownKeys(actual).every((k) => {
    const a = actual[k as keyof typeof actual], e = expected[k as keyof typeof expected]; return !!a && !!e && Object.hasOwn(a, "value") && a.value === e.value && a.enumerable === e.enumerable && !a.configurable && !a.writable;
  });
}
export function copyTrustedOwnerWan26R2vVideoCropBytes(value: unknown): Uint8Array { if (!isTrustedOwnerWan26R2vVideoCropReceipt(value)) invalid(); return Uint8Array.from(receipts.get(value)!); }
export function releaseTrustedOwnerWan26R2vVideoCropReceipt(value: unknown): void { if (!isTrustedOwnerWan26R2vVideoCropReceipt(value)) invalid(); receipts.get(value)!.fill(0); receipts.delete(value); descriptors.delete(value); }

async function crop(paths: Readonly<{ ffmpegPath: string; ffprobePath: string }>, original: unknown, selection: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerWan26R2vVideoCropReceipt>> {
  const signal = exactOptions(options), metadata = getOwnerWan26R2vVideoSelectionMetadata(original, selection);
  if (!isTrustedOwnerWan26R2vOriginalProbeResult(original) || !metadata) return invalid();
  if (signal && signalAborted(signal)) return aborted();
  if (!Number.isFinite(metadata.effective_start_seconds) || !Number.isFinite(metadata.duration_seconds) || metadata.frame_count < 1 ||
      metadata.frame_rate.numerator / metadata.frame_rate.denominator > 240 || metadata.total_reference_count < 1 || metadata.total_reference_count > 5) limit();
  if (active) throw new OwnerWan26R2vVideoCropError("LOCAL_RESOURCE_BUSY"); active = true;
  let source: Buffer | undefined, dir: string | undefined, inputPath: string | undefined, outputPath: string | undefined;
  let inputCreated = false, outputCreated = false, owned: Buffer | undefined, minted: Readonly<OwnerWan26R2vVideoCropReceipt> | undefined;
  try {
    const bytes = copyTrustedOwnerWan26R2vOriginalBytes(original);
    try { source = Buffer.from(bytes); } finally { bytes.fill(0); }
    if (source.length > MAX_BYTES) limit();
    if (source.length !== original.bytes_copied || sha(source) !== original.source_sha256) return invalid();
    const audioCount = original.metadata.codec_streams.filter((s) => s.type === "audio").length; if (audioCount > 16) limit();
    dir = await mkdtemp(join(tmpdir(), "syntx-wan26-r2v-crop-")); await chmod(dir, 0o700);
    inputPath = join(dir, "source.mp4"); outputPath = join(dir, "crop.mp4"); inputCreated = true; await secureWrite(inputPath, source);
    outputCreated = true; await createPrivateOutput(outputPath);
    await run(paths.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(metadata.effective_start_seconds), "-i", inputPath,
      "-t", String(metadata.duration_seconds), "-map", "0:v:0", "-map", "0:a?", "-vf", `fps=${metadata.frame_rate.numerator}/${metadata.frame_rate.denominator}`,
      "-frames:v", String(metadata.frame_count), "-fps_mode", "cfr", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-movflags", "+faststart", "-fs", String(MAX_BYTES + 1), outputPath], signal, 8 * 1024);
    if (!isTrustedOwnerWan26R2vOriginalProbeResult(original) || getOwnerWan26R2vVideoSelectionMetadata(original, selection) !== metadata) return invalid();
    const info = await lstat(outputPath);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600 || info.size < 16) invalid(); if (info.size > MAX_BYTES) limit();
    const parsed = parseProbe(await run(paths.ffprobePath, ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,duration:format=format_name", "-of", "json", outputPath], signal, MAX_TEXT));
    const fn = BigInt(metadata.frame_rate.numerator), fd = BigInt(metadata.frame_rate.denominator), pn = BigInt(parsed.rate.numerator), pd = BigInt(parsed.rate.denominator);
    const frameSeconds = metadata.frame_rate.denominator / metadata.frame_rate.numerator;
    if (parsed.width !== original.metadata.width || parsed.height !== original.metadata.height || parsed.codec !== "h264" || pn * fd !== fn * pd ||
        parsed.frames !== metadata.frame_count || Math.abs(parsed.duration - metadata.duration_seconds) > frameSeconds + 0.000001 ||
        parsed.duration > 5 / metadata.total_reference_count + 0.000001 || parsed.audioCount !== audioCount) invalid();
    owned = await readOwnedFile(outputPath, info.size);
    if (!isTrustedOwnerWan26R2vOriginalProbeResult(original) || getOwnerWan26R2vVideoSelectionMetadata(original, selection) !== metadata) invalid();
    if (signal && signalAborted(signal)) return aborted();
    const receipt = Object.freeze({ model_id: original.model_id, source_sha256: original.source_sha256, source_policy_id: original.source_policy_id,
      selection_policy_id: OWNER_WAN26_R2V_VIDEO_SELECTION_POLICY.policy_id, crop_policy_id: POLICY, crop_sha256: sha(owned), mime_type: "video/mp4" as const, bytes: owned.length,
      metadata: Object.freeze({ width: parsed.width, height: parsed.height, frame_rate: Object.freeze(parsed.rate), frame_count: parsed.frames, video_duration_seconds: parsed.duration, codec: "h264" as const, audio_stream_count: parsed.audioCount }),
      encoding_policy: "CFR_LOCAL_ENCODING_NOT_PROVIDER_PROOF" as const, generation_permit: false as const, owner_upload_binding: "NOT_ESTABLISHED" as const });
    minted = receipt; receipts.set(receipt, owned); descriptors.set(receipt, Object.getOwnPropertyDescriptors(receipt)); owned = undefined; return receipt;
  } catch (error) {
    owned?.fill(0); if (error instanceof OwnerWan26R2vVideoCropError) throw error;
    if (signal && signalAborted(signal)) return aborted(); throw new OwnerWan26R2vVideoCropError("CROP_FAILED");
  } finally {
    source?.fill(0); let cleanupFailed = false;
    for (const [path, created] of [[inputPath, inputCreated], [outputPath, outputCreated]] as const) if (path && created) try { await wipe(path); } catch (e) { if (!missing(e)) cleanupFailed = true; }
    if (dir) try { await rmdir(dir); } catch (e) { if (!missing(e)) cleanupFailed = true; }
    active = false;
    if (cleanupFailed) { if (minted) revoke(minted); throw new OwnerWan26R2vVideoCropError("CROP_FAILED"); }
  }
}
function revoke(value: object): void { receipts.get(value)?.fill(0); receipts.delete(value); descriptors.delete(value); }
async function secureWrite(path: string, bytes: Buffer): Promise<void> { const f = await open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600); try { await f.chmod(0o600); await f.writeFile(bytes); await f.sync(); const s = await f.stat(); if (!s.isFile() || s.size !== bytes.length) invalid(); } finally { await f.close(); } }
async function createPrivateOutput(path: string): Promise<void> { const f = await open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600); try { await f.chmod(0o600); await f.sync(); const s = await f.stat(); if (!s.isFile() || (s.mode & 0o777) !== 0o600) invalid(); } finally { await f.close(); } }
async function readOwnedFile(path: string, size: number): Promise<Buffer> { const f = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)); try { const a = await f.stat(); if (!a.isFile() || a.size !== size || size > MAX_BYTES) invalid(); const b = await f.readFile(); if ((await f.stat()).size !== size || b.length !== size) { b.fill(0); invalid(); } return b; } finally { await f.close(); } }
async function wipe(path: string): Promise<void> { const s = await lstat(path); if (s.isSymbolicLink()) { await unlink(path); return; } if (!s.isFile()) invalid(); const f = await open(path, fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0)); try { const n = (await f.stat()).size; if (n > MAX_BYTES + 1) { await f.truncate(0); await f.sync(); } else { const zeros = Buffer.alloc(64 * 1024); try { for (let at = 0; at < n; at += zeros.length) await f.write(zeros, 0, Math.min(zeros.length, n - at), at); await f.sync(); } finally { zeros.fill(0); } } } finally { await f.close(); } await unlink(path); }
function run(path: string, args: string[], signal: AbortSignal | undefined, max: number): Promise<string> { return new Promise((resolve, reject) => {
  let child: ReturnType<typeof spawn>; try { child = spawn(path, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" } }); } catch (e) { reject(e); return; }
  let out = "", outBytes = 0, failed: Error | undefined, timer: NodeJS.Timeout; const kill = (e: Error) => { if (!failed) { failed = e; child.kill("SIGKILL"); } };
  timer = setTimeout(() => kill(new OwnerWan26R2vVideoCropError("CROP_FAILED")), TIMEOUT_MS);
  const onAbort = () => kill(new OwnerWan26R2vVideoCropError("CROP_ABORTED"));
  if (signal) { Reflect.apply(ADD, signal, ["abort", onAbort, { once: true }]); if (signalAborted(signal)) onAbort(); }
  child.stdout?.on("data", (chunk: Buffer) => { if (failed) return; outBytes += chunk.length; if (outBytes > max) kill(new OwnerWan26R2vVideoCropError("LOCAL_RESOURCE_LIMIT_EXCEEDED")); else out += chunk.toString("utf8"); });
  child.stderr?.on("data", () => undefined); child.once("error", () => kill(new OwnerWan26R2vVideoCropError("CROP_FAILED")));
  child.once("close", (code) => { clearTimeout(timer); if (signal) Reflect.apply(REMOVE, signal, ["abort", onAbort]); if (failed) reject(failed); else if (code === 0) resolve(out); else reject(new OwnerWan26R2vVideoCropError("CROP_FAILED")); });
}); }
function parseProbe(text: string): { width: number; height: number; frames: number; duration: number; rate: { numerator: number; denominator: number }; codec: string; audioCount: number } {
  let root: unknown; try { root = JSON.parse(text); } catch { return invalid(); }
  if (!isRecord(root) || !isRecord(root.format) || root.format.format_name !== "mov,mp4,m4a,3gp,3g2,mj2" || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > 32) return invalid();
  const videos = root.streams.filter((s) => isRecord(s) && s.codec_type === "video"), audios = root.streams.filter((s) => isRecord(s) && s.codec_type === "audio");
  if (videos.length !== 1 || audios.length > 16) return invalid(); const v = videos[0] as Record<string, unknown>, rate = parseRate(v.avg_frame_rate);
  const width = positive(v.width), height = positive(v.height), frames = positive(v.nb_read_frames), duration = number(v.duration);
  if (!rate || !width || !height || !frames || duration === undefined || typeof v.codec_name !== "string" || !/^[a-z0-9_+-]{1,64}$/i.test(v.codec_name)) return invalid();
  return { width, height, frames, duration, rate, codec: v.codec_name, audioCount: audios.length };
}
function exactConfig(v: unknown): Readonly<{ ffmpegPath: string; ffprobePath: string }> { if (!v || typeof v !== "object" || Array.isArray(v) || types.isProxy(v)) return invalid(); const d = Object.getOwnPropertyDescriptors(v), k = Reflect.ownKeys(d); if ((Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) || k.length !== 2 || !k.includes("ffmpegPath") || !k.includes("ffprobePath")) return invalid(); const get = (key: "ffmpegPath" | "ffprobePath") => { const x = d[key]; if (!x || !Object.hasOwn(x, "value") || !x.enumerable || typeof x.value !== "string" || !isAbsolute(x.value) || x.value !== x.value.trim() || x.value.includes("\0") || !basename(x.value)) return invalid(); return x.value; }; return Object.freeze({ ffmpegPath: get("ffmpegPath"), ffprobePath: get("ffprobePath") }); }
function exactOptions(v: unknown): AbortSignal | undefined { if (v === undefined) return; if (!v || typeof v !== "object" || Array.isArray(v) || types.isProxy(v)) return invalid(); const d = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(d); if ((Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) || keys.length > 1 || keys.some((k) => k !== "signal") || (d.signal && (!Object.hasOwn(d.signal, "value") || !d.signal.enumerable))) return invalid(); const s = d.signal?.value; if (s === undefined) return; if (!s || typeof s !== "object" || types.isProxy(s) || Object.getPrototypeOf(s) !== SIGNAL_PROTO || !ABORTED_GET) return invalid(); try { Reflect.apply(ABORTED_GET, s, []); const f = () => undefined; Reflect.apply(ADD, s, ["abort", f]); Reflect.apply(REMOVE, s, ["abort", f]); } catch { return invalid(); } return s as AbortSignal; }
function signalAborted(s: AbortSignal): boolean { try { return Reflect.apply(ABORTED_GET!, s, []) as boolean; } catch { return true; } }
function parseRate(v: unknown): { numerator: number; denominator: number } | undefined { if (typeof v !== "string") return; const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(v); if (!m) return; const numerator = Number(m[1]), denominator = Number(m[2]); return Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) ? { numerator, denominator } : undefined; }
function positive(v: unknown): number | undefined { if (typeof v === "string" && /^\d+$/.test(v)) v = Number(v); return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined; }
function number(v: unknown): number | undefined { if (typeof v === "string" && v.trim()) v = Number(v); return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined; }
function isRecord(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v) && !types.isProxy(v); }
function sha(b: Uint8Array): string { return createHash("sha256").update(b).digest("hex"); }
function missing(e: unknown): boolean { return !!e && typeof e === "object" && "code" in e && e.code === "ENOENT"; }
function invalid(): never { throw new OwnerWan26R2vVideoCropError("INVALID_CROP"); } function limit(): never { throw new OwnerWan26R2vVideoCropError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); } function aborted(): never { throw new OwnerWan26R2vVideoCropError("CROP_ABORTED"); }
