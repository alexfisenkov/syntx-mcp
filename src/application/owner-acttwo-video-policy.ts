import { types } from "node:util";
import { copyTrustedOwnerKlingMotionControlVideoBytes, createOwnerKlingMotionControlVideoProbe,
  isTrustedOwnerKlingMotionControlVideoProbeResult, releaseTrustedOwnerKlingMotionControlVideoProbeResult,
  type OwnerKlingMotionControlVideoProbeResult } from "./owner-kling-motion-control-video-probe.js";

const MODEL_ID = "acttwo" as const;
const MIME_TYPE = "video/mp4" as const;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 8_400;
const MAX_PIXELS = 52_500_000;
const REQUIRED_DURATION_SECONDS = 5 as const;
const VALIDATED = new WeakMap<object, { readonly context: Readonly<ValidatedOwnerActTwoPerformanceVideo>; readonly bytes: Buffer }>();

export interface ValidatedOwnerActTwoPerformanceVideo {
  readonly status: "LOCALLY_PROBED_ACTTWO_PERFORMANCE_VIDEO_NOT_UPLOAD_AUTHORITY";
  readonly model_id: typeof MODEL_ID;
  readonly filename: string;
  readonly mime_type: typeof MIME_TYPE;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly measured_duration_seconds: typeof REQUIRED_DURATION_SECONDS;
  readonly probe_confidence: "FFPROBE_METADATA_NOT_DECODED_PIXELS";
  readonly local_max_bytes: typeof MAX_BYTES;
  readonly local_duration_slice_seconds: typeof REQUIRED_DURATION_SECONDS;
  readonly generation_permit: false;
}

export class OwnerActTwoVideoPolicyError extends Error {
  constructor(readonly code: "INVALID_VIDEO" | "LOCAL_LIMIT_EXCEEDED" | "DURATION_MISMATCH" | "VIDEO_PROBE_FAILED" | "REQUEST_ABORTED") {
    super("The ActTwo performance video is not valid under the local input policy.");
    this.name = "OwnerActTwoVideoPolicyError";
  }
}

export function createOwnerActTwoPerformanceVideoValidator(ffprobePath: string) {
  const probe = createOwnerKlingMotionControlVideoProbe({ ffprobePath });
  return Object.freeze({ validate: (input: unknown, signal?: AbortSignal) => validateVideo(probe, input, signal) });
}

async function validateVideo(probe: ReturnType<typeof createOwnerKlingMotionControlVideoProbe>, input: unknown,
  signalInput?: AbortSignal): Promise<Readonly<ValidatedOwnerActTwoPerformanceVideo>> {
  const fields = exactRecord(input), signal = exactSignal(signalInput);
  if (fields.model_id !== MODEL_ID || typeof fields.filename !== "string" || !safeFilename(fields.filename) ||
      !fields.filename.toLowerCase().endsWith(".mp4") || fields.mime_type !== MIME_TYPE ||
      !(fields.bytes instanceof Uint8Array) || types.isProxy(fields.bytes)) invalid();

  let raw: Readonly<OwnerKlingMotionControlVideoProbeResult> | undefined;
  let copied: Uint8Array | undefined;
  try {
    raw = await probe.probe({ filename: fields.filename, mime_type: MIME_TYPE, bytes: fields.bytes }, signal ? { signal } : undefined);
    if (!isTrustedOwnerKlingMotionControlVideoProbeResult(raw)) invalid();
    const metadata = raw.metadata;
    if (raw.bytes_copied < 16 || raw.bytes_copied > MAX_BYTES || metadata.width < 300 || metadata.height < 300 ||
        metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION || metadata.width * metadata.height > MAX_PIXELS) localLimit();
    if (metadata.duration_seconds !== REQUIRED_DURATION_SECONDS) durationMismatch();
    copied = copyTrustedOwnerKlingMotionControlVideoBytes(raw);
    if (copied.byteLength !== raw.bytes_copied) invalid();
    const context = Object.freeze({ status: "LOCALLY_PROBED_ACTTWO_PERFORMANCE_VIDEO_NOT_UPLOAD_AUTHORITY" as const,
      model_id: MODEL_ID, filename: raw.filename, mime_type: MIME_TYPE, size: raw.bytes_copied, sha256: raw.source_sha256,
      width: metadata.width, height: metadata.height, measured_duration_seconds: REQUIRED_DURATION_SECONDS,
      probe_confidence: "FFPROBE_METADATA_NOT_DECODED_PIXELS" as const, local_max_bytes: MAX_BYTES as typeof MAX_BYTES,
      local_duration_slice_seconds: REQUIRED_DURATION_SECONDS, generation_permit: false as const });
    VALIDATED.set(context, { context, bytes: Buffer.from(copied) });
    return context;
  } catch (error) {
    if (error instanceof OwnerActTwoVideoPolicyError) throw error;
    if (signal?.aborted || error instanceof Error && "code" in error && error.code === "PROBE_ABORTED") aborted();
    if (error instanceof Error && "code" in error &&
        (error.code === "SOURCE_LIMIT_EXCEEDED" || error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED")) localLimit();
    return probeFailed();
  } finally {
    copied?.fill(0);
    if (raw) { try { releaseTrustedOwnerKlingMotionControlVideoProbeResult(raw); } catch { /* copied bytes are separately owned */ } }
  }
}

export function readValidatedOwnerActTwoPerformanceVideo(value: unknown): Readonly<ValidatedOwnerActTwoPerformanceVideo & { readonly bytes: Buffer }> | null {
  const state = readState(value);
  if (!state) return null;
  return Object.freeze({ ...state.context, bytes: Buffer.from(state.bytes) });
}

export function isValidatedOwnerActTwoPerformanceVideo(value: unknown): value is Readonly<ValidatedOwnerActTwoPerformanceVideo> {
  return readState(value) !== null;
}

export function releaseValidatedOwnerActTwoPerformanceVideo(value: unknown): boolean {
  const state = readState(value);
  if (!state) return false;
  state.bytes.fill(0);
  return VALIDATED.delete(value as object);
}

function readState(value: unknown): { readonly context: Readonly<ValidatedOwnerActTwoPerformanceVideo>; readonly bytes: Buffer } | null {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return null;
    const state = VALIDATED.get(value);
    return state && state.context === value && state.bytes.byteLength === state.context.size && state.context.model_id === MODEL_ID &&
      state.context.generation_permit === false && state.context.measured_duration_seconds === REQUIRED_DURATION_SECONDS ? state : null;
  } catch { return null; }
}

function exactRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const required = ["model_id", "filename", "mime_type", "bytes"];
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== "string" || !required.includes(key) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalid(); }
}
function exactSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof AbortSignal) || types.isProxy(value)) invalid();
  return value;
}
function safeFilename(value: string): boolean { return value.length > 0 && value.length <= 128 && !/[\\/\u0000-\u001f\u007f]/u.test(value); }
function invalid(): never { throw new OwnerActTwoVideoPolicyError("INVALID_VIDEO"); }
function localLimit(): never { throw new OwnerActTwoVideoPolicyError("LOCAL_LIMIT_EXCEEDED"); }
function durationMismatch(): never { throw new OwnerActTwoVideoPolicyError("DURATION_MISMATCH"); }
function aborted(): never { throw new OwnerActTwoVideoPolicyError("REQUEST_ABORTED"); }
function probeFailed(): never { throw new OwnerActTwoVideoPolicyError("VIDEO_PROBE_FAILED"); }
