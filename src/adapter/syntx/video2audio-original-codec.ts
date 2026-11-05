import { types } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  isAuthenticOwnerVideo2AudioSourceProfile,
  isCurrentOwnerVideo2AudioSourceProfile,
  type OwnerVideo2AudioSourceProfile
} from "../../application/owner-video2audio-source-profile.js";
import {
  normalizeOwnerVideo2AudioInput,
  validateOwnerVideo2AudioTrustedUploadDuration
} from "../../application/owner-video2audio-input-parameters.js";
import { readOwnerVideo2AudioCurrentOriginal } from "../../application/owner-video2audio-current-original-probe.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const REQUEST_KEYS = Object.freeze(["bytes", "filename", "mime_type", "current_probe"] as const);
const uploadReceiptSchema = z.object({
  files: z.array(z.object({
    filename: z.string().max(256).optional(),
    url: z.string().min(1).max(4096),
    status: z.literal("success"),
    content_type: z.enum(["video/mp4", "video/webm", "video/quicktime"]),
    size: z.number().int().positive().max(100 * 1024 * 1024),
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
  readonly mime_type: "video/mp4" | "video/webm" | "video/quicktime";
  readonly size: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly duration_seconds?: number;
}

export interface ParsedOwnerVideo2AudioOriginalUploadReceipt {
  readonly filename: string;
  readonly url: string;
  readonly mime_type: "video/mp4" | "video/webm" | "video/quicktime";
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
  if (isCurrentOwnerVideo2AudioSourceProfile(profile)) {
    const measured=readOwnerVideo2AudioCurrentOriginal(fields.current_probe);
    if(!measured)throw new Error("VIDEO2AUDIO_UPLOAD_REQUEST_INVALID");
    try {
      const bytes=fields.bytes;
      if(!bytes || typeof bytes!=="object" || types.isProxy(bytes) || !(bytes instanceof Uint8Array) ||
        (Object.getPrototypeOf(bytes)!==Uint8Array.prototype && Object.getPrototypeOf(bytes)!==Buffer.prototype) ||
        ["buffer","byteOffset","byteLength","length"].some(key=>Object.hasOwn(bytes,key)) ||
        bytes.byteLength!==measured.size || `sha256:${createHash("sha256").update(bytes).digest("hex")}`!==measured.sha256 ||
        (measured.mime_type!=="video/mp4" && measured.mime_type!=="video/webm" && measured.mime_type!=="video/quicktime") ||
        measured.filename!==fields.filename || measured.mime_type!==fields.mime_type || measured.profile_schema_hash!==profile.profileSchemaHash ||
        measured.size<1 || measured.size>100*1024*1024 || !Number.isFinite(measured.duration_seconds) || measured.duration_seconds<=0) throw new Error("VIDEO2AUDIO_UPLOAD_REQUEST_INVALID");
      const snapshot=new Uint8Array(measured.bytes);
      const value={profile_schema_hash:measured.profile_schema_hash,filename:measured.filename,mime_type:measured.mime_type,
        size:measured.size,sha256:measured.sha256,duration_seconds:measured.duration_seconds} as ValidatedOwnerVideo2AudioOriginalUpload;
      Object.defineProperty(value,"bytes",{enumerable:false,configurable:false,get:()=>new Uint8Array(snapshot)});
      return Object.freeze(value);
    } finally {measured.bytes.fill(0);}
  }
  if(fields.current_probe!==undefined)throw new Error("VIDEO2AUDIO_UPLOAD_REQUEST_INVALID");
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
  expected: Pick<ValidatedOwnerVideo2AudioOriginalUpload, "filename" | "mime_type" | "size" | "duration_seconds">,
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
  let duration: number;
  if(isCurrentOwnerVideo2AudioSourceProfile(profile)) {
    if(typeof expected.duration_seconds!=="number" || !Number.isFinite(expected.duration_seconds) || expected.duration_seconds<=0)throw new Error("VIDEO2AUDIO_UPLOAD_RECEIPT_INVALID");
    const [mantissa, exponentText]=String(file.duration).toLowerCase().split("e"), digits=mantissa!.split(".")[1]?.length??0;
    const exponent=exponentText===undefined?0:Number(exponentText);
    const tolerance=Math.max(0.001,Math.min(0.5,0.5*10**(exponent-digits)));
    if(Math.abs(file.duration-expected.duration_seconds)>tolerance+Number.EPSILON)throw new Error("VIDEO2AUDIO_UPLOAD_RECEIPT_INVALID");
    duration=expected.duration_seconds;
  } else {
    if(expected.mime_type!=="video/mp4" || expected.size>10*1024*1024)throw new Error("VIDEO2AUDIO_UPLOAD_RECEIPT_INVALID");
    duration=validateOwnerVideo2AudioTrustedUploadDuration(file.duration, profile);
  }
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
  if (keys.length < 3 || keys.length > REQUEST_KEYS.length || keys.some((key) => typeof key !== "string" || !REQUEST_KEYS.includes(key as (typeof REQUEST_KEYS)[number]))) {
    throw new Error("VIDEO2AUDIO_UPLOAD_REQUEST_INVALID");
  }
  const result = Object.create(null) as Record<(typeof REQUEST_KEYS)[number], unknown>;
  for (const key of REQUEST_KEYS) {
    const descriptor = descriptors[key];
    if(key==="current_probe" && descriptor===undefined)continue;
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("VIDEO2AUDIO_UPLOAD_REQUEST_INVALID");
    result[key] = descriptor.value;
  }
  return result;
}
