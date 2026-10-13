import { types } from "node:util";
import { z } from "zod/v4";
import {
  isAuthenticOwnerVideo2AudioSourceProfile,
  type OwnerVideo2AudioSourceProfile
} from "../../application/owner-video2audio-source-profile.js";
import {
  normalizeOwnerVideo2AudioInput,
  validateOwnerVideo2AudioTrustedUploadDuration
} from "../../application/owner-video2audio-input-parameters.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const REQUEST_KEYS = Object.freeze(["bytes", "filename", "mime_type"] as const);
const uploadReceiptSchema = z.object({
  files: z.array(z.object({
    filename: z.string().max(256).optional(),
    url: z.string().min(1).max(4096),
    status: z.literal("success"),
    content_type: z.literal("video/mp4"),
    size: z.number().int().positive().max(10 * 1024 * 1024),
    duration: z.number().finite().positive()
  }).strip()).length(1),
  total: z.literal(1),
  successful: z.literal(1),
  failed: z.literal(0),
  duplicates: z.literal(0)
}).strip();

export interface ValidatedOwnerVideo2AudioOriginalUpload {
  readonly profile_schema_hash: string;
  readonly filename: string;
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface ParsedOwnerVideo2AudioOriginalUploadReceipt {
  readonly filename: string;
  readonly url: string;
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly duration_seconds: number;
}

/** Closed local upload admission. The prompt is an internal placeholder, never uploaded here. */
export function validateOwnerVideo2AudioOriginalUploadRequest(
  input: unknown,
  profile: OwnerVideo2AudioSourceProfile
): ValidatedOwnerVideo2AudioOriginalUpload {
  if (!isAuthenticOwnerVideo2AudioSourceProfile(profile)) throw new Error("VIDEO2AUDIO_SOURCE_PROFILE_INVALID");
  const fields = readExactRecord(input);
  const normalized = normalizeOwnerVideo2AudioInput({
    prompt: "internal upload validation",
    filename: fields.filename,
    mime_type: fields.mime_type,
    bytes: fields.bytes
  }, profile);
  const snapshot = normalized.original.bytes;
  const validated = {
    profile_schema_hash: normalized.profile_schema_hash,
    filename: normalized.original.filename,
    mime_type: normalized.original.mime_type,
    size: normalized.original.size,
    sha256: normalized.original.sha256
  } as {
    profile_schema_hash: string;
    filename: string;
    mime_type: "video/mp4";
    size: number;
    sha256: string;
    bytes: Uint8Array;
  };
  Object.defineProperty(validated, "bytes", { enumerable: false, configurable: false, get: () => new Uint8Array(snapshot) });
  return Object.freeze(validated);
}

/** Validates only observed upload receipt fields; unknown metadata stays inert. */
export function parseOwnerVideo2AudioOriginalUploadReceipt(
  raw: unknown,
  expected: Pick<ValidatedOwnerVideo2AudioOriginalUpload, "filename" | "mime_type" | "size">,
  profile: OwnerVideo2AudioSourceProfile
): ParsedOwnerVideo2AudioOriginalUploadReceipt {
  if (!isAuthenticOwnerVideo2AudioSourceProfile(profile)) throw new Error("VIDEO2AUDIO_SOURCE_PROFILE_INVALID");
  const parsed = uploadReceiptSchema.safeParse(raw);
  if (!parsed.success) throw new Error("VIDEO2AUDIO_UPLOAD_RECEIPT_INVALID");
  const [file] = parsed.data.files;
  if (!file || (file.filename !== undefined && file.filename !== expected.filename) ||
      file.content_type !== expected.mime_type || file.size !== expected.size || !isSafeUploadReferenceUrl(file.url)) {
    throw new Error("VIDEO2AUDIO_UPLOAD_RECEIPT_INVALID");
  }
  const duration = validateOwnerVideo2AudioTrustedUploadDuration(file.duration, profile);
  return Object.freeze({
    filename: expected.filename,
    url: file.url,
    mime_type: expected.mime_type,
    size: expected.size,
    duration_seconds: duration
  });
}

function readExactRecord(value: unknown): Record<(typeof REQUEST_KEYS)[number], unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("VIDEO2AUDIO_UPLOAD_REQUEST_INVALID");
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error("VIDEO2AUDIO_UPLOAD_REQUEST_INVALID");
  }
  if (prototype !== Object.prototype && prototype !== null) throw new Error("VIDEO2AUDIO_UPLOAD_REQUEST_INVALID");
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== REQUEST_KEYS.length || keys.some((key) => typeof key !== "string" || !REQUEST_KEYS.includes(key as (typeof REQUEST_KEYS)[number]))) {
    throw new Error("VIDEO2AUDIO_UPLOAD_REQUEST_INVALID");
  }
  const result = Object.create(null) as Record<(typeof REQUEST_KEYS)[number], unknown>;
  for (const key of REQUEST_KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("VIDEO2AUDIO_UPLOAD_REQUEST_INVALID");
    result[key] = descriptor.value;
  }
  return result;
}
