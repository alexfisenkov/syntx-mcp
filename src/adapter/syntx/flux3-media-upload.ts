import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  isOwnerFlux3I2vImage,
  readOwnerFlux3I2vImageBytes,
  type OwnerFlux3I2vImageProbeResult
} from "../../application/owner-flux3-i2v-image-probe.js";
import {
  isOwnerFlux3V2vOriginalProbe,
  readOwnerFlux3V2vOriginalProbeBytes,
  type OwnerFlux3V2vOriginalProbeResult
} from "../../application/owner-flux3-v2v-original-probe.js";
import { OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION } from "../../application/owner-flux3-video-source-profile.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

export type OwnerFlux3UploadDestination = "uploaded" | "hidden";

export interface OwnerFlux3I2vImageUploadContext {
  readonly status: "OWNER_FLUX3_I2V_IMAGE_UPLOADED";
  readonly model_id: "flux3_i2v";
  readonly ai_name: "flux3_video";
  readonly source_catalog_version: typeof OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION;
  readonly destination: OwnerFlux3UploadDestination;
  readonly filename: string;
  readonly source_mime_type: "image/jpeg" | "image/png" | "image/webp";
  readonly mime_type: "image/jpeg" | "image/png" | "image/webp";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED";
}

export interface OwnerFlux3V2vOriginalUploadContext {
  readonly status: "OWNER_FLUX3_V2V_ORIGINAL_UPLOADED";
  readonly model_id: "flux3_v2v";
  readonly ai_name: "flux3_video";
  readonly source_catalog_version: typeof OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION;
  readonly destination: OwnerFlux3UploadDestination;
  readonly filename: string;
  readonly source_mime_type: "video/mp4";
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly metadata: OwnerFlux3V2vOriginalProbeResult["metadata"];
}

export type OwnerFlux3UploadContext = OwnerFlux3I2vImageUploadContext | OwnerFlux3V2vOriginalUploadContext;

export interface ValidatedOwnerFlux3I2vUploadInput {
  readonly model_id: "flux3_i2v";
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerFlux3I2vImageProbeResult["mime_type"];
  readonly source_mime_type: OwnerFlux3I2vImageProbeResult["source_mime_type"];
  readonly size: number;
  readonly sha256: string;
  readonly context_fields: Readonly<{
    width: number;
    height: number;
    metadata_confidence: OwnerFlux3I2vImageProbeResult["metadata_confidence"];
  }>;
}
export interface ValidatedOwnerFlux3V2vUploadInput {
  readonly model_id: "flux3_v2v";
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: "video/mp4";
  readonly source_mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly context_fields: Readonly<{ metadata: OwnerFlux3V2vOriginalProbeResult["metadata"] }>;
}
export type ValidatedOwnerFlux3UploadInput = ValidatedOwnerFlux3I2vUploadInput | ValidatedOwnerFlux3V2vUploadInput;

export function validateOwnerFlux3I2vImageForUpload(input: unknown): ValidatedOwnerFlux3I2vUploadInput {
  if (!isOwnerFlux3I2vImage(input)) throw new Error("FLUX3_I2V_PROBE_UNTRUSTED");
  const receipt = input as OwnerFlux3I2vImageProbeResult;
  const copied = readOwnerFlux3I2vImageBytes(input);
  if (!copied) throw new Error("FLUX3_I2V_PROBE_UNTRUSTED");
  const { bytes } = copied;
  try {
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (receipt.status !== "LOCAL_SOURCE_VALIDATED" || receipt.model_id !== "flux3_i2v" ||
        receipt.source_policy_id !== "OWNER_FLUX3_I2V_IMAGE_INPUT_POLICY_1D8_V1" ||
        receipt.source_catalog_version !== OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION ||
        receipt.generation_permit !== false || receipt.dispatch_allowed !== false ||
        receipt.owner_upload_binding !== "NOT_ESTABLISHED" ||
        receipt.metadata_confidence !== "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED" ||
        receipt.source_mime_type !== copied.mime_type || receipt.mime_type !== copied.mime_type ||
        receipt.filename !== copied.filename || receipt.sha256 !== copied.sha256 || receipt.size !== copied.size ||
        receipt.width !== copied.width || receipt.height !== copied.height || bytes.byteLength !== copied.size ||
        !/^[a-f0-9]{64}$/u.test(copied.sha256) || hash !== copied.sha256) {
      throw new Error("FLUX3_I2V_PROBE_INVALID");
    }
    return Object.freeze({ model_id: "flux3_i2v", bytes, filename: copied.filename, mime_type: copied.mime_type,
      source_mime_type: receipt.source_mime_type, size: copied.size, sha256: copied.sha256,
      context_fields: Object.freeze({ width: copied.width, height: copied.height,
        metadata_confidence: receipt.metadata_confidence }) });
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

export function validateOwnerFlux3V2vOriginalForUpload(input: unknown): ValidatedOwnerFlux3V2vUploadInput {
  if (!isOwnerFlux3V2vOriginalProbe(input)) throw new Error("FLUX3_V2V_PROBE_UNTRUSTED");
  const receipt = input as OwnerFlux3V2vOriginalProbeResult;
  let bytes: Uint8Array;
  try { bytes = readOwnerFlux3V2vOriginalProbeBytes(input); }
  catch { throw new Error("FLUX3_V2V_PROBE_UNTRUSTED"); }
  try {
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (receipt.status !== "TRUSTED_LOCAL_VIDEO_PROBE" || receipt.model_id !== "flux3_v2v" ||
        receipt.ai_name !== "flux3_video" || receipt.source_catalog_version !== OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION ||
        receipt.mime_type !== "video/mp4" || receipt.dispatch_allowed !== false ||
        receipt.owner_upload_binding !== "NOT_ESTABLISHED" || !safeFilename(receipt.filename) ||
        !isRecord(receipt.metadata) || receipt.metadata.container !== "ISO_BMFF_MP4" ||
        !positiveInteger(receipt.metadata.video?.width) || !positiveInteger(receipt.metadata.video?.height) ||
        !Number.isFinite(receipt.metadata.video?.duration_seconds) || receipt.metadata.video!.duration_seconds <= 0 ||
        !Number.isSafeInteger(receipt.metadata.audio_stream_count) || receipt.metadata.audio_stream_count < 0 ||
        receipt.metadata.local_supported_input_limitation !== "LOCAL_ONE_NON_ATTACHED_VIDEO_STREAM_METADATA_ONLY" ||
        !Number.isSafeInteger(receipt.bytes_copied) || receipt.bytes_copied !== bytes.byteLength ||
        !/^[a-f0-9]{64}$/u.test(receipt.source_sha256) || hash !== receipt.source_sha256) {
      throw new Error("FLUX3_V2V_PROBE_INVALID");
    }
    return Object.freeze({ model_id: "flux3_v2v", bytes, filename: receipt.filename, mime_type: "video/mp4",
      source_mime_type: "video/mp4", size: bytes.byteLength, sha256: receipt.source_sha256,
      context_fields: Object.freeze({ metadata: receipt.metadata }) });
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

export function parseOwnerFlux3UploadReceipt(
  raw: unknown,
  expected: Pick<ValidatedOwnerFlux3UploadInput, "filename" | "mime_type" | "size">
): Readonly<{ url: string }> {
  if (!isRecord(raw) || !Array.isArray(raw.files) || raw.files.length !== 1) throw new Error("FLUX3_UPLOAD_RECEIPT_INVALID");
  const file = raw.files[0];
  if (!isRecord(file) || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url) ||
      (file.filename !== undefined && file.filename !== expected.filename) ||
      (file.status !== undefined && file.status !== "success") ||
      (file.size !== undefined && file.size !== expected.size) ||
      (file.mime_type !== undefined && file.mime_type !== expected.mime_type) ||
      (file.content_type !== undefined && file.content_type !== expected.mime_type)) {
    throw new Error("FLUX3_UPLOAD_RECEIPT_INVALID");
  }
  return Object.freeze({ url: file.url });
}

export function createOwnerFlux3UploadContext(
  validated: ValidatedOwnerFlux3I2vUploadInput,
  destination: OwnerFlux3UploadDestination
): OwnerFlux3I2vImageUploadContext;
export function createOwnerFlux3UploadContext(
  validated: ValidatedOwnerFlux3V2vUploadInput,
  destination: OwnerFlux3UploadDestination
): OwnerFlux3V2vOriginalUploadContext;
export function createOwnerFlux3UploadContext(
  validated: ValidatedOwnerFlux3UploadInput,
  destination: OwnerFlux3UploadDestination
): OwnerFlux3UploadContext {
  if (validated.model_id === "flux3_i2v") {
    return Object.freeze({ status: "OWNER_FLUX3_I2V_IMAGE_UPLOADED", model_id: "flux3_i2v", ai_name: "flux3_video",
      source_catalog_version: OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION, destination, filename: validated.filename,
      source_mime_type: validated.source_mime_type, mime_type: validated.mime_type, size: validated.size,
      sha256: validated.sha256, width: validated.context_fields.width, height: validated.context_fields.height,
      metadata_confidence: validated.context_fields.metadata_confidence });
  }
  return Object.freeze({ status: "OWNER_FLUX3_V2V_ORIGINAL_UPLOADED", model_id: "flux3_v2v", ai_name: "flux3_video",
    source_catalog_version: OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION, destination, filename: validated.filename,
    source_mime_type: "video/mp4", mime_type: "video/mp4", size: validated.size,
    sha256: validated.sha256, metadata: validated.context_fields.metadata });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value);
}
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function safeFilename(value: string): boolean {
  return value.length > 0 && value.length <= 255 && value === value.trim() && value !== "." && value !== ".." &&
    !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !/[. ]$/u.test(value);
}
