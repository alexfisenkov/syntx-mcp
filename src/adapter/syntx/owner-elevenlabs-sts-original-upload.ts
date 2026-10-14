import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  copyTrustedOwnerElevenLabsStsOriginalBytes,
  isTrustedOwnerElevenLabsStsOriginalProbeResult,
  type OwnerElevenLabsStsOriginalProbeResult
} from "../../application/owner-elevenlabs-sts-original-probe.js";
import { isExactOwnerElevenLabsStsUploadClient } from "./chat-http-client.js";
import type { SyntxChatHttpClient } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const MAX_STS_UPLOAD_BYTES = 50 * 1024 * 1024;

export const OWNER_ELEVENLABS_STS_NATIVE_UPLOAD_ABI = Object.freeze({
  method: "uploadElevenLabsStsOriginal",
  input: "genuineProbeResult,destination:uploaded|hidden,signal?",
  output: "OWNER_ELEVENLABS_STS_ORIGINAL_UPLOADED{source_sha256,size,mime_type,duration_seconds}"
} as const);

export interface OwnerElevenLabsStsOriginalUploadReference {
  readonly status: "OWNER_ELEVENLABS_STS_ORIGINAL_UPLOADED";
  readonly source_sha256: string;
  readonly size: number;
  readonly mime_type: "audio/mpeg";
  readonly duration_seconds: number;
}

export interface ValidatedOwnerElevenLabsStsProbe {
  readonly probe: OwnerElevenLabsStsOriginalProbeResult;
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly size: number;
  readonly sha256: string;
  readonly duration_seconds: number;
}

export class OwnerElevenLabsStsOriginalUploadError extends Error {
  constructor(readonly code: "NATIVE_UPLOAD_METHOD_REQUIRED" | "PROBE_UNTRUSTED") {
    super("ElevenLabs STS upload requires its dedicated native same-client upload boundary.");
    this.name = "OwnerElevenLabsStsOriginalUploadError";
  }
}

/** Copies and rehashes only a genuine, unchanged STS probe result. */
export function validateOwnerElevenLabsStsOriginalProbeForUpload(input: unknown): ValidatedOwnerElevenLabsStsProbe {
  if (!isTrustedOwnerElevenLabsStsOriginalProbeResult(input)) throw new Error("STS_PROBE_UNTRUSTED");
  const probe = input as OwnerElevenLabsStsOriginalProbeResult;
  const metadata = probe.metadata;
  if (probe.status !== "TRUSTED_LOCAL_AUDIO_PROBE" || probe.source_profile !== "OWNER_ELEVENLABS_STS_SOURCE_UI_V1" ||
      probe.model_type !== "eleven_multilingual_sts_v2" || probe.dispatch_allowed !== false || probe.runtime_usable !== false ||
      probe.owner_upload_binding !== "NOT_ESTABLISHED" || !safeFilename(probe.filename) ||
      !probe.filename.toLowerCase().endsWith(".mp3") || probe.mime_type !== "audio/mpeg" ||
      !Number.isSafeInteger(probe.bytes_copied) || probe.bytes_copied < 16 || probe.bytes_copied > MAX_STS_UPLOAD_BYTES ||
      !/^[a-f0-9]{64}$/u.test(probe.source_sha256) || !isRecord(metadata) || metadata.container !== "MP3" ||
      metadata.codec_name !== "mp3" || !positiveInteger(metadata.sample_rate) || !positiveInteger(metadata.channels) ||
      !positiveInteger(metadata.decoded_frame_count) || !finitePositive(metadata.duration_seconds) ||
      metadata.duration_seconds < 5 || metadata.duration_seconds > 300) {
    throw new Error("STS_PROBE_INVALID");
  }
  const bytes = copyTrustedOwnerElevenLabsStsOriginalBytes(input);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== probe.bytes_copied || sha256 !== probe.source_sha256) {
    bytes.fill(0);
    throw new Error("STS_PROBE_BYTES_MISMATCH");
  }
  return Object.freeze({ probe, bytes, filename: probe.filename, size: bytes.byteLength, sha256,
    duration_seconds: metadata.duration_seconds });
}

export function parseOwnerElevenLabsStsOriginalUploadReceipt(
  raw: unknown,
  expected: Pick<ValidatedOwnerElevenLabsStsProbe, "filename" | "size" | "duration_seconds">
): Readonly<{ url: string }> {
  if (!isRecord(raw) || !Array.isArray(raw.files) || raw.files.length !== 1) throw new Error("STS_UPLOAD_RECEIPT_INVALID");
  const file = raw.files[0];
  if (!isRecord(file) || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url) ||
      (file.filename !== undefined && file.filename !== expected.filename) ||
      (file.status !== undefined && file.status !== "success") ||
      (file.size !== undefined && file.size !== expected.size) ||
      (file.content_type !== undefined && file.content_type !== "audio/mpeg") ||
      (file.duration !== undefined && (!finitePositive(file.duration) || file.duration > 300 ||
        Math.round(file.duration) !== Math.round(expected.duration_seconds)))) {
    throw new Error("STS_UPLOAD_RECEIPT_INVALID");
  }
  return Object.freeze({ url: file.url });
}

/** Refuses caller-provided upload functions and the generic 10 MiB path. */
export function createOwnerElevenLabsStsOriginalUploadAdapter(client: unknown) {
  return Object.freeze({
    async upload(probe: unknown, destination: "uploaded" | "hidden", signal?: AbortSignal): Promise<OwnerElevenLabsStsOriginalUploadReference> {
      if (!isTrustedOwnerElevenLabsStsOriginalProbeResult(probe)) {
        throw new OwnerElevenLabsStsOriginalUploadError("PROBE_UNTRUSTED");
      }
      if (destination !== "uploaded" && destination !== "hidden") {
        throw new OwnerElevenLabsStsOriginalUploadError("NATIVE_UPLOAD_METHOD_REQUIRED");
      }
      if (!isExactOwnerElevenLabsStsUploadClient(client)) throw new OwnerElevenLabsStsOriginalUploadError("NATIVE_UPLOAD_METHOD_REQUIRED");
      const nativeUpload = (client as SyntxChatHttpClient).uploadElevenLabsStsOriginal;
      return nativeUpload.call(client, probe, destination, signal);
    }
  });
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
