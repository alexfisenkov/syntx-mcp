import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  copyTrustedOwnerWan27R2vOriginalBytes,
  createOwnerWan27R2vOriginalProbe,
  isTrustedOwnerWan27R2vOriginalProbeResult,
  releaseTrustedOwnerWan27R2vOriginalProbeResult,
  type OwnerWan27R2vOriginalProbeResult
} from "./owner-wan27-r2v-original-probe.js";

const MODEL_ID = "switchx" as const;
const MAX_LOCAL_UPLOAD_BYTES = 10 * 1024 * 1024;
const PUBLIC_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MIN_PUBLIC_PIXELS = 100_000;
const MAX_PUBLIC_PIXELS = 2_770_000;
const INITIAL_SOURCE_WIDTH = 1_280;
const INITIAL_SOURCE_HEIGHT = 720;
const INITIAL_DURATION_SECONDS = 5;
const INITIAL_FRAME_RATE = 24;
const RECEIPTS = new WeakMap<object, Readonly<{ bytes: Buffer; descriptorHash: string }>>();

export const OWNER_SWITCHX_VIDEO_INPUT_POLICY = Object.freeze({
  policy_id: "OWNER_SWITCHX_MEASURED_VIDEO_INPUT_C19_V1",
  model_id: MODEL_ID,
  source_public_max_bytes: PUBLIC_MAX_UPLOAD_BYTES,
  effective_local_upload_max_bytes: MAX_LOCAL_UPLOAD_BYTES,
  local_upload_limit_kind: "EXISTING_NATIVE_UPLOAD_TRANSPORT_BOUND_NOT_PROVIDER_LIMIT",
  public_pixel_bounds: Object.freeze({ min: MIN_PUBLIC_PIXELS, max: MAX_PUBLIC_PIXELS }),
  initial_source_frame: Object.freeze({ width: INITIAL_SOURCE_WIDTH, height: INITIAL_SOURCE_HEIGHT }),
  initial_duration_seconds: INITIAL_DURATION_SECONDS,
  initial_frame_rate: INITIAL_FRAME_RATE,
  probe: "TRUSTED_LOCAL_FFPROBE_METADATA_ONLY_NO_PIXEL_DECODE",
  generation_permit: false,
  provider_acceptance: "UNPROVEN"
} as const);

export type OwnerSwitchxVideoMimeType = "video/mp4" | "video/quicktime";

export interface ValidatedOwnerSwitchxVideo {
  readonly status: "TRUSTED_LOCAL_SWITCHX_VIDEO_METADATA";
  readonly policy_id: typeof OWNER_SWITCHX_VIDEO_INPUT_POLICY.policy_id;
  readonly model_id: typeof MODEL_ID;
  readonly filename: string;
  readonly mime_type: OwnerSwitchxVideoMimeType;
  readonly size: number;
  readonly source_sha256: string;
  readonly width: number;
  readonly height: number;
  readonly pixel_count: number;
  readonly duration_seconds: 5;
  readonly frame_rate: 24;
  readonly probe_scope: "LOCAL_METADATA_ONLY_NO_PIXEL_DECODE";
  readonly generation_permit: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
  readonly provider_acceptance: "UNPROVEN";
}

export interface OwnerSwitchxVideoRead {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerSwitchxVideoMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: 5;
  readonly frame_rate: 24;
}

export class OwnerSwitchxVideoPolicyError extends Error {
  constructor(readonly code: "INVALID_VIDEO" | "LOCAL_LIMIT_EXCEEDED" | "VIDEO_METADATA_NOT_IN_INITIAL_SLICE") {
    super("The Switchx source video could not be validated for the initial measured-video slice.");
    this.name = "OwnerSwitchxVideoPolicyError";
  }
}

/** Uses the existing bounded local ffprobe implementation, then applies Switchx's own public bounds. */
export function createOwnerSwitchxVideoValidator(ffprobePath: string) {
  if (typeof ffprobePath !== "string" || !ffprobePath.trim()) throw new OwnerSwitchxVideoPolicyError("INVALID_VIDEO");
  const probe = createOwnerWan27R2vOriginalProbe({ ffprobePath });
  return Object.freeze({
    async validate(input: unknown, signal?: AbortSignal): Promise<Readonly<ValidatedOwnerSwitchxVideo>> {
      const request = snapshotInput(input);
      if (request.bytes.byteLength < 16 || request.bytes.byteLength > MAX_LOCAL_UPLOAD_BYTES) {
        throw new OwnerSwitchxVideoPolicyError("LOCAL_LIMIT_EXCEEDED");
      }
      const source = Buffer.from(request.bytes);
      let measured: Readonly<OwnerWan27R2vOriginalProbeResult> | undefined;
      try {
        measured = await probe.probe({ filename: request.filename, mime_type: request.mime_type, bytes: source },
          signal === undefined ? undefined : { signal });
        if (!isTrustedOwnerWan27R2vOriginalProbeResult(measured) || measured.generation_permit !== false ||
            measured.owner_upload_binding !== "NOT_ESTABLISHED" || measured.selection_crop !== "NOT_PERFORMED" ||
            measured.filename !== request.filename || measured.mime_type !== request.mime_type || measured.bytes_copied !== source.byteLength) {
          throw new OwnerSwitchxVideoPolicyError("INVALID_VIDEO");
        }
        const metadata = measured.metadata;
        const pixels = metadata.width * metadata.height;
        const rate = metadata.frame_rate.denominator === 0 ? NaN : metadata.frame_rate.numerator / metadata.frame_rate.denominator;
        if (!Number.isSafeInteger(pixels) || pixels < MIN_PUBLIC_PIXELS || pixels > MAX_PUBLIC_PIXELS ||
            metadata.width !== INITIAL_SOURCE_WIDTH || metadata.height !== INITIAL_SOURCE_HEIGHT) {
          throw new OwnerSwitchxVideoPolicyError("INVALID_VIDEO");
        }
        if (metadata.duration_seconds !== INITIAL_DURATION_SECONDS || rate !== INITIAL_FRAME_RATE) {
          throw new OwnerSwitchxVideoPolicyError("VIDEO_METADATA_NOT_IN_INITIAL_SLICE");
        }
        const bytes = copyTrustedOwnerWan27R2vOriginalBytes(measured);
        try {
          if (bytes.byteLength !== source.byteLength || createHash("sha256").update(bytes).digest("hex") !== measured.source_sha256) {
            throw new OwnerSwitchxVideoPolicyError("INVALID_VIDEO");
          }
          const receipt: ValidatedOwnerSwitchxVideo = Object.freeze({
            status: "TRUSTED_LOCAL_SWITCHX_VIDEO_METADATA", policy_id: OWNER_SWITCHX_VIDEO_INPUT_POLICY.policy_id,
            model_id: MODEL_ID, filename: measured.filename, mime_type: measured.mime_type, size: bytes.byteLength,
            source_sha256: measured.source_sha256, width: metadata.width, height: metadata.height, pixel_count: pixels,
            duration_seconds: INITIAL_DURATION_SECONDS, frame_rate: INITIAL_FRAME_RATE,
            probe_scope: "LOCAL_METADATA_ONLY_NO_PIXEL_DECODE", generation_permit: false,
            owner_upload_binding: "NOT_ESTABLISHED", provider_acceptance: "UNPROVEN"
          });
          RECEIPTS.set(receipt, Object.freeze({ bytes: Buffer.from(bytes), descriptorHash: descriptorFingerprint(receipt) }));
          return receipt;
        } finally { bytes.fill(0); }
      } catch (error) {
        if (error instanceof OwnerSwitchxVideoPolicyError) throw error;
        throw new OwnerSwitchxVideoPolicyError("INVALID_VIDEO");
      } finally {
        source.fill(0);
        request.bytes.fill(0);
        if (measured && isTrustedOwnerWan27R2vOriginalProbeResult(measured)) releaseTrustedOwnerWan27R2vOriginalProbeResult(measured);
      }
    }
  });
}

export function isValidatedOwnerSwitchxVideo(value: unknown): value is Readonly<ValidatedOwnerSwitchxVideo> {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = RECEIPTS.get(value);
  return state !== undefined && Object.isFrozen(value) && state.descriptorHash === descriptorFingerprint(value);
}

export function readValidatedOwnerSwitchxVideo(value: unknown): Readonly<OwnerSwitchxVideoRead> | null {
  if (!isValidatedOwnerSwitchxVideo(value)) return null;
  const state = RECEIPTS.get(value);
  if (!state) return null;
  return Object.freeze({ bytes: new Uint8Array(state.bytes), filename: value.filename, mime_type: value.mime_type,
    size: value.size, sha256: value.source_sha256, width: value.width, height: value.height,
    duration_seconds: value.duration_seconds, frame_rate: value.frame_rate });
}

export function releaseValidatedOwnerSwitchxVideo(value: unknown): boolean {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = RECEIPTS.get(value);
  if (!state || !isValidatedOwnerSwitchxVideo(value)) return false;
  state.bytes.fill(0);
  return RECEIPTS.delete(value);
}

function snapshotInput(value: unknown): Readonly<{ filename: string; mime_type: OwnerSwitchxVideoMimeType; bytes: Uint8Array }> {
  const row = exact(value, ["filename", "mime_type", "bytes"]);
  if (typeof row.filename !== "string" || !safeFilename(row.filename) ||
      (row.mime_type !== "video/mp4" && row.mime_type !== "video/quicktime") ||
      !(row.bytes instanceof Uint8Array) || types.isProxy(row.bytes) ||
      (!Buffer.isBuffer(row.bytes) && Object.getPrototypeOf(row.bytes) !== Uint8Array.prototype) ||
      row.bytes.byteLength < 16 || row.bytes.byteLength > MAX_LOCAL_UPLOAD_BYTES) {
    throw new OwnerSwitchxVideoPolicyError(row.bytes instanceof Uint8Array && row.bytes.byteLength > MAX_LOCAL_UPLOAD_BYTES ? "LOCAL_LIMIT_EXCEEDED" : "INVALID_VIDEO");
  }
  return Object.freeze({ filename: row.filename, mime_type: row.mime_type, bytes: new Uint8Array(row.bytes) });
}

function safeFilename(value: string): boolean {
  return value === value.trim() && value.length > 0 && Buffer.byteLength(value, "utf8") <= 255 &&
    !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && value !== "." && value !== "..";
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new OwnerSwitchxVideoPolicyError("INVALID_VIDEO");
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { throw new OwnerSwitchxVideoPolicyError("INVALID_VIDEO"); }
  const actual = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) {
    throw new OwnerSwitchxVideoPolicyError("INVALID_VIDEO");
  }
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) out[key] = descriptors[key]!.value;
  return out;
}

function descriptorFingerprint(value: object): string {
  return createHash("sha256").update(Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return `${String(key)}:${descriptor.enumerable}:${descriptor.configurable}:${descriptor.writable}:${String(descriptor.value)}`;
  }).join("\n")).digest("hex");
}
