import { execFile as execFileCallback, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rmdir, unlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { types } from "node:util";

const MIME_TYPES = Object.freeze(["video/mp4", "video/quicktime"] as const);
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_STDOUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const ACCEPTED_FORMAT = "mov,mp4,m4a,3gp,3g2,mj2";
const SDR_TRANSFERS = new Set(["bt709", "smpte170m", "bt470bg", "iec61966-2-1", "gamma22", "gamma28"]);
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;
const BUFFER_GETTER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "buffer")!.get!;
const OFFSET_GETTER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteOffset")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

export const OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY = Object.freeze({
  policy_id: "OWNER_KLING_MOTION_CONTROL_VIDEO_INPUT_POLICY_B066_LOCAL_GUARD_V1",
  public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
  model_id: "kling_motion_control",
  source_mime_types: MIME_TYPES,
  source_max_file_size_bytes: null,
  max_file_size_bytes: MAX_BYTES,
  min_side: 300,
  max_side: null,
  min_duration_seconds: 3,
  max_duration_seconds: 30,
  allow_hdr: false,
  size_limit_confidence: "LOCAL100MIB_CATALOG_SIZE_UNKNOWN" as const,
  metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED" as const,
  generation_permit: false as const,
  owner_upload_binding: "NOT_ESTABLISHED" as const,
  parent_binding: "NOT_ESTABLISHED" as const
});

export type OwnerKlingMotionControlVideoMimeType = typeof MIME_TYPES[number];

export interface OwnerKlingMotionControlVideoProbeResult {
  readonly status: "TRUSTED_LOCAL_MEDIA_PROBE";
  readonly model_id: "kling_motion_control";
  readonly source_policy_id: typeof OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.policy_id;
  readonly source_sha256: string;
  readonly filename: string;
  readonly mime_type: OwnerKlingMotionControlVideoMimeType;
  readonly bytes_copied: number;
  readonly metadata: Readonly<{
    container: "ISO_BMFF_MOV_MP4";
    codec_streams: readonly Readonly<{ type: string; codec_name: string }>[];
    width: number;
    height: number;
    duration_seconds: number;
    transfer_characteristic: string;
  }>;
  readonly metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED";
  readonly generation_permit: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
  readonly parent_binding: "NOT_ESTABLISHED";
  readonly selection_crop: "NOT_PERFORMED";
}

export class OwnerKlingMotionControlVideoProbeError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "SOURCE_LIMIT_EXCEEDED" | "HDR_NOT_ALLOWED" | "UNSUPPORTED_MEDIA_METADATA" | "PROBE_FAILED" | "PROBE_ABORTED") {
    super("The Kling Motion Control original video could not be safely probed.");
    this.name = "OwnerKlingMotionControlVideoProbeError";
  }
}

export interface OwnerKlingMotionControlVideoProbeRunner {
  probe(input: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerKlingMotionControlVideoProbeResult>>;
}

/** ffprobePath is absolute trusted operator configuration, never request data. */
export function createOwnerKlingMotionControlVideoProbe(config: unknown): OwnerKlingMotionControlVideoProbeRunner {
  const ffprobePath = exactConfig(config);
  return Object.freeze({ probe: (input: unknown, options?: Readonly<{ signal?: AbortSignal }>) => probeVideo(ffprobePath, input, options) });
}

interface VideoState { readonly bytes: Buffer; readonly descriptors: Readonly<Record<string, PropertyDescriptor>>; }
const RECEIPTS = new WeakMap<object, VideoState>();

export function isTrustedOwnerKlingMotionControlVideoProbeResult(value: unknown): value is Readonly<OwnerKlingMotionControlVideoProbeResult> {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = RECEIPTS.get(value);
  if (!state || !Object.isFrozen(value)) return false;
  const current = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(current), expectedKeys = Reflect.ownKeys(state.descriptors);
  return keys.length === expectedKeys.length && keys.every((key) => {
    const actual = current[key as keyof typeof current], expected = state.descriptors[key as keyof typeof state.descriptors];
    return expected !== undefined && actual !== undefined && Object.hasOwn(actual, "value") && actual.enumerable === expected.enumerable &&
      actual.configurable === false && actual.writable === false && actual.value === expected.value;
  });
}

/** Copies bytes only from a live, frozen receipt minted by this module. */
export function copyTrustedOwnerKlingMotionControlVideoBytes(value: unknown): Uint8Array {
  if (!isTrustedOwnerKlingMotionControlVideoProbeResult(value)) invalid();
  return new Uint8Array(RECEIPTS.get(value)!.bytes);
}

/** Wipes and revokes this receipt's private byte snapshot. */
export function releaseTrustedOwnerKlingMotionControlVideoProbeResult(value: unknown): boolean {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = RECEIPTS.get(value);
  if (!state || !isTrustedOwnerKlingMotionControlVideoProbeResult(value)) return false;
  state.bytes.fill(0);
  return RECEIPTS.delete(value);
}

async function probeVideo(ffprobePath: string, input: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OwnerKlingMotionControlVideoProbeResult>> {
  const request = exactInput(input), signal = exactOptions(options);
  const expectedExtension = request.mime_type === "video/mp4" ? ".mp4" : ".mov";
  if (!safeFilename(request.filename) || !MIME_TYPES.includes(request.mime_type) || extname(request.filename).toLowerCase() !== expectedExtension) invalid();
  const source = copyInputBytes(request.bytes);
  if (source.byteLength === 0) invalid();
  if (source.byteLength > MAX_BYTES) localLimit();
  const hash = createHash("sha256").update(source).digest("hex");
  let directory: string | undefined, path: string | undefined, created = false, retained: Buffer | undefined;
  try {
    if (!hasMatchingBmffBrand(source, request.mime_type)) invalid();
    if (signal?.aborted) aborted();
    directory = await mkdtemp(join(tmpdir(), "syntx-mcv-video-"));
    await chmod(directory, 0o700);
    path = join(directory, "original" + expectedExtension);
    const file = await open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    created = true;
    try { await file.chmod(0o600); await file.writeFile(source); await file.sync(); const info = await file.stat(); if (!info.isFile() || info.size !== source.byteLength) invalid(); }
    finally { await file.close(); }
    const metadata = parseFfprobe(await runFfprobe(ffprobePath, path, signal));
    if (metadata.transfer !== "" && !SDR_TRANSFERS.has(metadata.transfer)) hdr();
    if (metadata.width < 300 || metadata.height < 300 || metadata.duration < 3 || metadata.duration > 30) sourceLimit();
    const after = await lstat(path);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== source.byteLength) invalid();
    retained = Buffer.from(source);
    const result = Object.freeze({
      status: "TRUSTED_LOCAL_MEDIA_PROBE" as const, model_id: "kling_motion_control" as const,
      source_policy_id: OWNER_KLING_MOTION_CONTROL_VIDEO_POLICY.policy_id, source_sha256: hash,
      filename: request.filename, mime_type: request.mime_type, bytes_copied: source.byteLength,
      metadata: Object.freeze({ container: "ISO_BMFF_MOV_MP4" as const,
        codec_streams: Object.freeze(metadata.streams.map((item) => Object.freeze(item))), width: metadata.width, height: metadata.height,
        duration_seconds: metadata.duration, transfer_characteristic: metadata.transfer }),
      metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED" as const,
      generation_permit: false as const, owner_upload_binding: "NOT_ESTABLISHED" as const,
      parent_binding: "NOT_ESTABLISHED" as const, selection_crop: "NOT_PERFORMED" as const
    });
    RECEIPTS.set(result, { bytes: retained, descriptors: Object.getOwnPropertyDescriptors(result) });
    retained = undefined;
    return result;
  } catch (error) {
    retained?.fill(0);
    if (error instanceof OwnerKlingMotionControlVideoProbeError) throw error;
    if (signal?.aborted) aborted();
    throw new OwnerKlingMotionControlVideoProbeError("PROBE_FAILED");
  } finally {
    source.fill(0);
    let failed = false;
    if (created && path) { try { await wipeAndUnlink(path); } catch (error) { if (!isMissingFile(error)) failed = true; } }
    if (directory) { try { await rmdir(directory); } catch (error) { if (!isMissingFile(error)) failed = true; } }
    if (failed) throw new OwnerKlingMotionControlVideoProbeError("PROBE_FAILED");
  }
}

async function wipeAndUnlink(path: string): Promise<void> {
  let file: FileHandle;
  try { file = await open(path, fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    try { await unlink(path); } catch (cleanupError) { if (!isMissingFile(cleanupError)) throw cleanupError; }
    throw error;
  }
  let wipeError: unknown;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_BYTES) invalid();
    const zeros = Buffer.alloc(Math.min(64 * 1024, Math.max(1, info.size)));
    for (let offset = 0; offset < info.size; offset += zeros.length) await file.write(zeros, 0, Math.min(zeros.length, info.size - offset), offset);
    zeros.fill(0); await file.sync();
  } catch (error) { wipeError = error; }
  finally { await file.close(); }
  await unlink(path);
  if (wipeError !== undefined) throw wipeError;
}

function runFfprobe(ffprobePath: string, inputPath: string, signal?: AbortSignal): Promise<string> {
  const args = ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,duration,color_transfer:stream_disposition=attached_pic:format=duration,format_name", "-of", "json", inputPath];
  const options: ExecFileOptionsWithStringEncoding = { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: MAX_STDOUT_BYTES,
    windowsHide: true, ...(signal ? { signal } : {}), env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" } };
  return new Promise((resolve, reject) => {
    let callbackDone = false, closed = false, spawnFailed = false, settled = false;
    let callbackError: Error | null = null, output: string | undefined, closeCode: number | null = null, closeSignal: NodeJS.Signals | null = null;
    const settle = () => {
      if (settled || !callbackDone || (!closed && !spawnFailed)) return;
      settled = true;
      if (callbackError) { reject(callbackError); return; }
      if (closeCode !== 0 || closeSignal !== null || output === undefined) { reject(new Error("ffprobe failed.")); return; }
      resolve(output);
    };
    try {
      const child = execFileCallback(ffprobePath, args, options, (error, stdout) => { callbackDone = true; callbackError = error; output = typeof stdout === "string" ? stdout : undefined; settle(); });
      child.once("error", (error) => { if (child.pid === undefined) { spawnFailed = true; callbackDone = true; } callbackError ??= error; settle(); });
      child.once("close", (code, reason) => { closed = true; closeCode = code; closeSignal = reason; settle(); });
    } catch (error) { reject(error instanceof Error ? error : new Error("ffprobe failed.")); }
  });
}

interface ProbedMetadata { streams: { type: string; codec_name: string }[]; width: number; height: number; duration: number; transfer: string; }
function parseFfprobe(output: string): ProbedMetadata {
  let root: unknown;
  try { root = JSON.parse(output); } catch { return unsupportedMetadata(); }
  if (!isRecord(root) || !Array.isArray(root.streams) || root.streams.length < 1 || root.streams.length > 32 || !isRecord(root.format) ||
      root.format.format_name !== ACCEPTED_FORMAT) return unsupportedMetadata();
  const streams: Record<string, unknown>[] = [];
  for (const entry of root.streams) {
    if (!isRecord(entry) || typeof entry.codec_type !== "string" || !/^[a-z0-9_+-]{1,24}$/i.test(entry.codec_type) ||
        typeof entry.codec_name !== "string" || !/^[a-z0-9_+-]{1,64}$/i.test(entry.codec_name)) return unsupportedMetadata();
    streams.push(entry);
  }
  const videos = streams.filter((stream) => stream.codec_type === "video");
  if (videos.length !== 1) return unsupportedMetadata();
  const video = videos[0]!;
  if (!isRecord(video.disposition) || (video.disposition.attached_pic !== 0 && video.disposition.attached_pic !== "0")) return unsupportedMetadata();
  const width = positiveInteger(video.width), height = positiveInteger(video.height), duration = finitePositive(video.duration);
  if (width === undefined || height === undefined || duration === undefined || typeof video.color_transfer !== "string" || !/^[a-z0-9_-]{1,32}$/i.test(video.color_transfer)) return unsupportedMetadata();
  const formatDuration = duration;
  if (formatDuration < 0.001) return invalid();
  return { streams: streams.map((stream) => ({ type: stream.codec_type as string, codec_name: stream.codec_name as string })), width, height,
    duration: formatDuration, transfer: video.color_transfer };
}

function hasMatchingBmffBrand(bytes: Buffer, mime: OwnerKlingMotionControlVideoMimeType): boolean {
  if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;
  const size = bytes.readUInt32BE(0);
  if (size < 16 || size > bytes.length || (size - 16) % 4 !== 0) return false;
  const brands = [bytes.toString("ascii", 8, 12)];
  for (let offset = 16; offset < size; offset += 4) brands.push(bytes.toString("ascii", offset, offset + 4));
  const quickTime = brands.includes("qt  ");
  const mp4 = brands.some((brand) => /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash|cmfc|cmfs|M4A )$/.test(brand));
  return mime === "video/quicktime" ? quickTime : mp4 && !quickTime;
}

function copyInputBytes(value: unknown): Buffer {
  if (types.isProxy(value) || !(value instanceof Uint8Array) || (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length")) invalid();
  let length: number, backing: unknown, offset: number;
  try { length = Reflect.apply(BYTE_LENGTH_GETTER, value, []) as number; backing = Reflect.apply(BUFFER_GETTER, value, []); offset = Reflect.apply(OFFSET_GETTER, value, []) as number; }
  catch { return invalid(); }
  if (!Number.isSafeInteger(length) || !Number.isSafeInteger(offset) || types.isProxy(backing) || !backing || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype ||
      Object.hasOwn(backing, "byteLength") || Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []) < offset + length) invalid();
  if (length > MAX_BYTES) localLimit();
  const copy = Buffer.allocUnsafe(length);
  try { Uint8Array.prototype.set.call(copy, new Uint8Array(backing as ArrayBuffer, offset, length)); return copy; }
  catch { copy.fill(0); return invalid(); }
}

function exactConfig(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || keys.length !== 1 || keys[0] !== "ffprobePath" ||
      !Object.hasOwn(descriptors.ffprobePath!, "value") || descriptors.ffprobePath!.enumerable !== true) invalid();
  const path = descriptors.ffprobePath!.value;
  if (typeof path !== "string" || !isAbsolute(path) || path !== path.trim() || path.includes("\0") || basename(path) === "") invalid();
  return path;
}
function exactInput(value: unknown): { filename: string; mime_type: OwnerKlingMotionControlVideoMimeType; bytes: unknown } {
  const fields = exactRecord(value, ["filename", "mime_type", "bytes"]);
  if (typeof fields.filename !== "string" || typeof fields.mime_type !== "string" || !MIME_TYPES.includes(fields.mime_type as OwnerKlingMotionControlVideoMimeType)) invalid();
  return { filename: fields.filename, mime_type: fields.mime_type as OwnerKlingMotionControlVideoMimeType, bytes: fields.bytes };
}
function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || actual.length !== keys.length || actual.some((key) =>
      typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function exactOptions(value: Readonly<{ signal?: AbortSignal }> | undefined): AbortSignal | undefined {
  if (value === undefined) return undefined;
  const fields = exactRecord(value, ["signal"]);
  const signal = fields.signal;
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || Object.getPrototypeOf(signal) !== AbortSignal.prototype) invalid();
  if (Reflect.ownKeys(signal).some((key) => typeof key !== "symbol" || !Object.hasOwn(Object.getOwnPropertyDescriptor(signal, key)!, "value"))) invalid();
  return signal as AbortSignal;
}
function safeFilename(value: string): boolean {
  return value.length > 0 && Buffer.byteLength(value, "utf8") <= 255 && value === value.trim() && value !== "." && value !== ".." &&
    !/[<>:"/\\|?*\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !/[. ]$/u.test(value) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value) && isWellFormedUnicode(value);
}
function isWellFormedUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) { const code = value.charCodeAt(i); if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(i + 1); if (next < 0xdc00 || next > 0xdfff) return false; i++; } else if (code >= 0xdc00 && code <= 0xdfff) return false; }
  return true;
}
function positiveInteger(value: unknown): number | undefined { if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value); return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined; }
function finitePositive(value: unknown): number | undefined { if (typeof value === "string" && value.trim() !== "") value = Number(value); return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isMissingFile(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"); }
function invalid(): never { throw new OwnerKlingMotionControlVideoProbeError("INVALID_INPUT"); }
function localLimit(): never { throw new OwnerKlingMotionControlVideoProbeError("LOCAL_RESOURCE_LIMIT_EXCEEDED"); }
function sourceLimit(): never { throw new OwnerKlingMotionControlVideoProbeError("SOURCE_LIMIT_EXCEEDED"); }
function hdr(): never { throw new OwnerKlingMotionControlVideoProbeError("HDR_NOT_ALLOWED"); }
function unsupportedMetadata(): never { throw new OwnerKlingMotionControlVideoProbeError("UNSUPPORTED_MEDIA_METADATA"); }
function aborted(): never { throw new OwnerKlingMotionControlVideoProbeError("PROBE_ABORTED"); }
