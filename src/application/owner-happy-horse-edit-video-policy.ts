import { types } from "node:util";
import { copyTrustedOwnerKlingMotionControlVideoBytes, createOwnerKlingMotionControlVideoProbe,
  isTrustedOwnerKlingMotionControlVideoProbeResult, releaseTrustedOwnerKlingMotionControlVideoProbeResult,
  type OwnerKlingMotionControlVideoMimeType } from "./owner-kling-motion-control-video-probe.js";

const LOCAL_MAX_BYTES = 100 * 1024 * 1024;
const MIN_DIMENSION = 400;
const MAX_DIMENSION = 2_160;
const MAX_PIXELS = 52_500_000;
const VALIDATED = new WeakMap<object, State>();
export type OwnerHappyHorseEditVideoMimeType = OwnerKlingMotionControlVideoMimeType;
export interface ValidatedOwnerHappyHorseEditVideo {
  readonly status: "LOCALLY_PROBED_SOURCE_VIDEO_NOT_UPLOAD_AUTHORITY";
  readonly model_id: "happy_horse_edit";
  readonly filename: string;
  readonly mime_type: OwnerHappyHorseEditVideoMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly measured_duration_seconds: number;
  readonly probe_confidence: "FFPROBE_METADATA_NOT_DECODED_PIXELS";
  readonly local_video_duration_ceiling_seconds: 30;
  readonly local_limit_confidence: "CONSERVATIVE_LOCAL_PROBE_CEILING_NOT_PROVIDER_LIMIT";
  readonly generation_permit: false;
}
export class OwnerHappyHorseEditVideoPolicyError extends Error {
  constructor(readonly code: "INVALID_VIDEO" | "LOCAL_LIMIT_EXCEEDED" | "VIDEO_PROBE_FAILED") {
    super("HappyHorse edit video could not be safely measured."); this.name = "OwnerHappyHorseEditVideoPolicyError";
  }
}

export function createOwnerHappyHorseEditVideoValidator(ffprobePath: string) {
  const probe = createOwnerKlingMotionControlVideoProbe({ ffprobePath });
  return Object.freeze({ validate: async (input: unknown, signal?: AbortSignal) => {
    let raw: Readonly<import("./owner-kling-motion-control-video-probe.js").OwnerKlingMotionControlVideoProbeResult> | undefined;
    let bytes: Uint8Array | undefined;
    try {
      const fields = exact(input);
      if (fields.mime_type !== "video/mp4" && fields.mime_type !== "video/quicktime") invalid();
      raw = await probe.probe({ filename: fields.filename, mime_type: fields.mime_type, bytes: fields.bytes }, { ...(signal ? { signal } : {}) });
      if (!isTrustedOwnerKlingMotionControlVideoProbeResult(raw)) invalid();
      const metadata = raw.metadata;
      if (raw.bytes_copied < 16 || raw.bytes_copied > LOCAL_MAX_BYTES || metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION ||
          metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION || metadata.width * metadata.height > MAX_PIXELS ||
          metadata.duration_seconds < 3 || metadata.duration_seconds > 30) localLimit();
      bytes = copyTrustedOwnerKlingMotionControlVideoBytes(raw);
      if (bytes.byteLength !== raw.bytes_copied) invalid();
      const context = Object.freeze({ status: "LOCALLY_PROBED_SOURCE_VIDEO_NOT_UPLOAD_AUTHORITY" as const,
        model_id: "happy_horse_edit" as const, filename: raw.filename, mime_type: raw.mime_type, size: raw.bytes_copied,
        sha256: raw.source_sha256, width: metadata.width, height: metadata.height, measured_duration_seconds: metadata.duration_seconds,
        probe_confidence: "FFPROBE_METADATA_NOT_DECODED_PIXELS" as const, local_video_duration_ceiling_seconds: 30 as const,
        local_limit_confidence: "CONSERVATIVE_LOCAL_PROBE_CEILING_NOT_PROVIDER_LIMIT" as const, generation_permit: false as const });
      VALIDATED.set(context, { bytes: Buffer.from(bytes), context });
      return context;
    } catch (error) {
      if (error instanceof OwnerHappyHorseEditVideoPolicyError) throw error;
      if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") localLimit();
      if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "SOURCE_LIMIT_EXCEEDED") localLimit();
      fail("VIDEO_PROBE_FAILED");
    } finally {
      bytes?.fill(0);
      if (raw) { try { releaseTrustedOwnerKlingMotionControlVideoProbeResult(raw); } catch { /* receipt copy is already isolated */ } }
    }
  } });
}

export function readValidatedOwnerHappyHorseEditVideo(value: unknown): Readonly<ValidatedOwnerHappyHorseEditVideo & { bytes: Uint8Array }> | null {
  if (!isValidatedOwnerHappyHorseEditVideo(value)) return null;
  const state = VALIDATED.get(value as object); if (!state) return null;
  return Object.freeze({ ...state.context, bytes: new Uint8Array(state.bytes) });
}
export function isValidatedOwnerHappyHorseEditVideo(value: unknown): value is Readonly<ValidatedOwnerHappyHorseEditVideo> {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
  const state = VALIDATED.get(value); return !!state && state.context === value && state.bytes.byteLength === state.context.size;
}
export function releaseValidatedOwnerHappyHorseEditVideo(value: unknown): boolean {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = VALIDATED.get(value); if (!state) return false; state.bytes.fill(0); return VALIDATED.delete(value);
}
interface State { readonly bytes: Buffer; readonly context: Readonly<ValidatedOwnerHappyHorseEditVideo> }
function exact(value: unknown): { filename: string; mime_type: string; bytes: Uint8Array } {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try { const p = Object.getPrototypeOf(value), d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d), expected = ["filename", "mime_type", "bytes"];
    if ((p !== Object.prototype && p !== null) || keys.length !== 3 || keys.some(k => typeof k !== "string" || !expected.includes(k) || !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true)) invalid();
    const f = Object.create(null) as Record<string, unknown>; for (const k of expected) f[k] = d[k]!.value;
    if (typeof f.filename !== "string" || typeof f.mime_type !== "string" || !(f.bytes instanceof Uint8Array) || types.isProxy(f.bytes)) invalid();
    return { filename: f.filename, mime_type: f.mime_type, bytes: f.bytes };
  } catch { return invalid(); }
}
function invalid(): never { throw new OwnerHappyHorseEditVideoPolicyError("INVALID_VIDEO"); }
function localLimit(): never { throw new OwnerHappyHorseEditVideoPolicyError("LOCAL_LIMIT_EXCEEDED"); }
function fail(code: "VIDEO_PROBE_FAILED"): never { throw new OwnerHappyHorseEditVideoPolicyError(code); }
