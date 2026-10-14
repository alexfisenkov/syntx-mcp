import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  copyTrustedOwnerTopazAstraOriginalBytes,
  isTrustedOwnerTopazAstraOriginalProbeResult,
  type OwnerTopazAstraOriginalProbeResult
} from "../../application/owner-topaz-astra-original-probe.js";
import { getOwnerTopazAstraSourceProfile, type OwnerTopazAstraModelId } from "../../application/owner-topaz-astra-source-profile.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const MAX_TOPAZ_UPLOAD_BYTES = 50 * 1024 * 1024;
type SyntxUploadDestination = "uploaded" | "hidden";
export interface OwnerTopazAstraOriginalUploadContext {
  readonly status: "OWNER_TOPAZ_ASTRA_ORIGINAL_UPLOADED";
  readonly model_id: OwnerTopazAstraModelId;
  readonly destination: SyntxUploadDestination;
  readonly source_sha256: string;
  readonly source_size: number;
  readonly source_mime_type: "video/mp4" | "video/quicktime";
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly decoded_frame_count: number;
}

export interface ValidatedOwnerTopazAstraProbe {
  readonly probe: OwnerTopazAstraOriginalProbeResult;
  readonly bytes: Uint8Array;
  readonly model_id: OwnerTopazAstraModelId;
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly decoded_frame_count: number;
}

export function validateOwnerTopazAstraOriginalProbeForUpload(input: unknown): ValidatedOwnerTopazAstraProbe {
  if (!isTrustedOwnerTopazAstraOriginalProbeResult(input)) throw new Error("TOPAZ_PROBE_UNTRUSTED");
  const probe = input as OwnerTopazAstraOriginalProbeResult;
  const profile = getOwnerTopazAstraSourceProfile(probe.model_id);
  if (!profile || probe.source_profile !== "OWNER_TOPAZ_ASTRA_SOURCE_UI_V1" ||
      probe.status !== "TRUSTED_LOCAL_MEDIA_PROBE" || probe.dispatch_allowed !== false ||
      probe.runtime_usable !== false || probe.owner_upload_binding !== "NOT_ESTABLISHED" ||
      probe.content_quality !== "NOT_ASSESSED" || !safeFilename(probe.filename) ||
      (probe.mime_type !== "video/mp4" && probe.mime_type !== "video/quicktime") ||
      !(profile.input.accepted_file_types as readonly string[]).includes(probe.mime_type) ||
      !matchesMimeExtension(probe.filename, probe.mime_type) ||
      !Number.isSafeInteger(probe.bytes_copied) || probe.bytes_copied < 16 ||
      probe.bytes_copied > Math.min(MAX_TOPAZ_UPLOAD_BYTES, profile.input.max_file_size_bytes) ||
      !/^[a-f0-9]{64}$/u.test(probe.source_sha256) ||
      !isRecord(probe.metadata) || probe.metadata.container !== "ISO_BMFF_MOV_MP4" ||
      typeof probe.metadata.codec_name !== "string" || !/^[a-z0-9_+-]{1,64}$/iu.test(probe.metadata.codec_name) ||
      !positiveInteger(probe.metadata.width) || !positiveInteger(probe.metadata.height) ||
      !finitePositive(probe.metadata.duration_seconds) ||
      probe.metadata.duration_seconds > profile.input.max_video_duration_seconds ||
      !positiveInteger(probe.metadata.decoded_frame_count) ||
      probe.metadata.decoded_frame_count > profile.input.max_frame_count) {
    throw new Error("TOPAZ_PROBE_INVALID");
  }
  const bytes = copyTrustedOwnerTopazAstraOriginalBytes(input);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== probe.bytes_copied || sha256 !== probe.source_sha256) {
    bytes.fill(0);
    throw new Error("TOPAZ_PROBE_BYTES_MISMATCH");
  }
  return Object.freeze({
    probe,
    bytes,
    model_id: probe.model_id,
    filename: probe.filename,
    mime_type: probe.mime_type,
    size: bytes.byteLength,
    sha256,
    width: probe.metadata.width,
    height: probe.metadata.height,
    duration_seconds: probe.metadata.duration_seconds,
    decoded_frame_count: probe.metadata.decoded_frame_count
  });
}

export function parseOwnerTopazAstraOriginalUploadReceipt(
  raw: unknown,
  expected: Pick<ValidatedOwnerTopazAstraProbe, "filename" | "mime_type" | "size" | "duration_seconds">
): Readonly<{ url: string }> {
  if (!isRecord(raw) || !Array.isArray(raw.files) || raw.files.length !== 1) throw new Error("TOPAZ_UPLOAD_RECEIPT_INVALID");
  const file = raw.files[0];
  if (!isRecord(file) || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url) ||
      (file.filename !== undefined && file.filename !== expected.filename) ||
      (file.status !== undefined && file.status !== "success") ||
      (file.size !== undefined && file.size !== expected.size) ||
      (file.content_type !== undefined && file.content_type !== expected.mime_type) ||
      (file.duration !== undefined && (!finitePositive(file.duration) || file.duration > 25 ||
        Math.round(file.duration) !== Math.round(expected.duration_seconds)))) {
    throw new Error("TOPAZ_UPLOAD_RECEIPT_INVALID");
  }
  return Object.freeze({ url: file.url });
}

function safeFilename(value: string): boolean {
  return value.length > 0 && value.length <= 255 && value === value.trim() && value !== "." && value !== ".." &&
    !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !/[. ]$/u.test(value);
}
function matchesMimeExtension(filename: string, mime: string): boolean {
  return mime === "video/mp4" ? filename.toLowerCase().endsWith(".mp4") : filename.toLowerCase().endsWith(".mov");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value);
}
function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

