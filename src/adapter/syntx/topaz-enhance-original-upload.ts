import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  copyTrustedOwnerTopazEnhanceOriginalBytes,
  isTrustedOwnerTopazEnhanceOriginalProbeResult,
  type OwnerTopazEnhanceOriginalProbeResult
} from "../../application/owner-topaz-enhance-original-probe.js";
import {
  OWNER_TOPAZ_ENHANCE_MODEL_ID,
  OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION
} from "../../application/owner-topaz-enhance-source-profile.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const MAX_TOPAZ_ENHANCE_BYTES = 50 * 1024 * 1024;
export type OwnerTopazEnhanceUploadDestination = "uploaded" | "hidden";

export interface OwnerTopazEnhanceOriginalUploadContext {
  readonly status: "OWNER_TOPAZ_ENHANCE_ORIGINAL_UPLOADED";
  readonly model_id: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID;
  readonly ai_name: "topaz_ai";
  readonly source_catalog_version: typeof OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION;
  readonly destination: OwnerTopazEnhanceUploadDestination;
  readonly source_sha256: string;
  readonly source_size: number;
  readonly source_mime_type: "video/mp4";
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly frame_count: number;
}

export interface ValidatedOwnerTopazEnhanceProbe {
  readonly probe: OwnerTopazEnhanceOriginalProbeResult;
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly frame_count: number;
}

export function validateOwnerTopazEnhanceOriginalProbeForUpload(input: unknown): ValidatedOwnerTopazEnhanceProbe {
  if (!isTrustedOwnerTopazEnhanceOriginalProbeResult(input)) throw new Error("TOPAZ_ENHANCE_PROBE_UNTRUSTED");
  const probe = input as OwnerTopazEnhanceOriginalProbeResult;
  const video = probe.metadata?.video;
  if (probe.status !== "TRUSTED_LOCAL_MEDIA_PROBE" || probe.model_id !== OWNER_TOPAZ_ENHANCE_MODEL_ID ||
      probe.ai_name !== "topaz_ai" || probe.source_catalog_version !== OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION ||
      probe.dispatch_allowed !== false || probe.runtime_usable !== false ||
      probe.owner_upload_binding !== "NOT_ESTABLISHED" || probe.content_quality !== "NOT_ASSESSED" ||
      probe.local_supported_mime_types.length !== 1 || probe.local_supported_mime_types[0] !== "video/mp4" ||
      !safeFilename(probe.filename) || probe.mime_type !== "video/mp4" || !probe.filename.toLowerCase().endsWith(".mp4") ||
      !Number.isSafeInteger(probe.bytes_copied) || probe.bytes_copied < 16 || probe.bytes_copied > MAX_TOPAZ_ENHANCE_BYTES ||
      !/^[a-f0-9]{64}$/u.test(probe.source_sha256) || !isRecord(video) ||
      typeof video.codec_name !== "string" || !/^[a-z0-9_+-]{1,64}$/iu.test(video.codec_name) ||
      !positiveInteger(video.width) || !positiveInteger(video.height) || !finitePositive(video.duration_seconds) ||
      video.duration_seconds < 2 || video.duration_seconds > 26.25 || !positiveInteger(video.frame_count) ||
      video.frame_count > 10_000) {
    throw new Error("TOPAZ_ENHANCE_PROBE_INVALID");
  }
  const bytes = copyTrustedOwnerTopazEnhanceOriginalBytes(input);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== probe.bytes_copied || sha256 !== probe.source_sha256) {
    bytes.fill(0);
    throw new Error("TOPAZ_ENHANCE_PROBE_BYTES_MISMATCH");
  }
  return Object.freeze({ probe, bytes, filename: probe.filename, mime_type: "video/mp4", size: bytes.byteLength,
    sha256, width: video.width, height: video.height, duration_seconds: video.duration_seconds,
    frame_count: video.frame_count });
}

export function parseOwnerTopazEnhanceOriginalUploadReceipt(
  raw: unknown,
  expected: Pick<ValidatedOwnerTopazEnhanceProbe, "filename" | "mime_type" | "size" | "duration_seconds">
): Readonly<{ url: string }> {
  if (!isRecord(raw) || !Array.isArray(raw.files) || raw.files.length !== 1) throw new Error("TOPAZ_ENHANCE_UPLOAD_RECEIPT_INVALID");
  const file = raw.files[0];
  if (!isRecord(file) || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url) ||
      (file.filename !== undefined && file.filename !== expected.filename) ||
      (file.status !== undefined && file.status !== "success") ||
      (file.size !== undefined && file.size !== expected.size) ||
      (file.content_type !== undefined && file.content_type !== expected.mime_type) ||
      (file.duration !== undefined && (!finitePositive(file.duration) || file.duration < 2 || file.duration > 26.25 ||
        Math.round(file.duration) !== Math.round(expected.duration_seconds)))) {
    throw new Error("TOPAZ_ENHANCE_UPLOAD_RECEIPT_INVALID");
  }
  return Object.freeze({ url: file.url });
}

function safeFilename(value: string): boolean {
  return value.length > 0 && value.length <= 255 && value === value.trim() && value !== "." && value !== ".." &&
    !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !/[. ]$/u.test(value);
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
