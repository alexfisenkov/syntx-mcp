import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  isAuthenticOwnerVideo2AudioSourceProfile,
  type OwnerVideo2AudioSourceProfile
} from "./owner-video2audio-source-profile.js";

const INPUT_KEYS = Object.freeze(["prompt", "filename", "mime_type", "bytes"] as const);
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}\.mp4$/iu;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export interface OwnerVideo2AudioNormalizedInput {
  readonly status: "SOURCE_REVIEWED_EXPLICIT_INPUT";
  readonly profile_id: OwnerVideo2AudioSourceProfile["profileId"];
  readonly profile_schema_hash: string;
  readonly model_id: "video2audio";
  readonly prompt: string;
  readonly original: Readonly<{
    filename: string;
    mime_type: "video/mp4";
    size: number;
    sha256: string;
    container: "ISO_BMFF_MP4_FTYP";
    bytes: Uint8Array;
  }>;
  readonly fixed_settings: Readonly<{
    model_type: "video2audio";
    mode: "generate";
    negative_prompt: "";
    seed: 0;
  }>;
  readonly duration_binding: Readonly<{
    status: "TRUSTED_UPLOAD_RECEIPT_REQUIRED";
    duration_seconds: null;
    ui_hint_max_seconds: 20;
    max_semantics: "UI_HINT_ONLY_NOT_BACKEND_LIMIT";
    caller_supplied: false;
  }>;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export type OwnerVideo2AudioInputParametersErrorCode =
  | "SOURCE_PROFILE_INVALID"
  | "INVALID_REQUEST"
  | "PROMPT_INVALID"
  | "ORIGINAL_VIDEO_INVALID"
  | "TRUSTED_UPLOAD_DURATION_INVALID";

export class OwnerVideo2AudioInputParametersError extends Error {
  constructor(readonly code: OwnerVideo2AudioInputParametersErrorCode) {
    super("The source-only Video2Audio input could not be normalized safely.");
    this.name = "OwnerVideo2AudioInputParametersError";
  }
}

/** Pure input validation only: no upload, owner lookup, permit, or generation authority. */
export function normalizeOwnerVideo2AudioInput(
  input: unknown,
  profile: OwnerVideo2AudioSourceProfile
): OwnerVideo2AudioNormalizedInput {
  if (!isAuthenticOwnerVideo2AudioSourceProfile(profile)) fail("SOURCE_PROFILE_INVALID");
  const fields = readExactInput(input);
  const prompt = normalizeOwnerVideo2AudioPrompt(fields.prompt, profile);
  const original = normalizeOriginalVideo(fields.filename, fields.mime_type, fields.bytes, profile);
  return Object.freeze({
    status: "SOURCE_REVIEWED_EXPLICIT_INPUT",
    profile_id: profile.profileId,
    profile_schema_hash: profile.profileSchemaHash,
    model_id: "video2audio",
    prompt,
    original,
    fixed_settings: Object.freeze({ model_type: "video2audio", mode: "generate", negative_prompt: "", seed: 0 }),
    duration_binding: Object.freeze({
      status: "TRUSTED_UPLOAD_RECEIPT_REQUIRED",
      duration_seconds: null,
      ui_hint_max_seconds: profile.source.controls.duration.ui_hint_max_inclusive_seconds,
      max_semantics: "UI_HINT_ONLY_NOT_BACKEND_LIMIT",
      caller_supplied: false
    }),
    runtime_usable: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
}

/** Pure source-bounded prompt normalization shared by upload preparation and generation preparation. */
export function normalizeOwnerVideo2AudioPrompt(value: unknown, profile: OwnerVideo2AudioSourceProfile): string {
  if (!isAuthenticOwnerVideo2AudioSourceProfile(profile)) fail("SOURCE_PROFILE_INVALID");
  return normalizePrompt(value, profile);
}

/** Internal-only check for trusted upload metadata; never accept this field from an MCP argument. */
export function validateOwnerVideo2AudioTrustedUploadDuration(
  trustedMetadata: unknown,
  profile: OwnerVideo2AudioSourceProfile
): number {
  if (!isAuthenticOwnerVideo2AudioSourceProfile(profile)) fail("SOURCE_PROFILE_INVALID");
  if (typeof trustedMetadata !== "number" || !Number.isFinite(trustedMetadata) || trustedMetadata <= 0 ||
      trustedMetadata > profile.source.controls.duration.ui_hint_max_inclusive_seconds) {
    fail("TRUSTED_UPLOAD_DURATION_INVALID");
  }
  return trustedMetadata;
}

function readExactInput(value: unknown): Record<(typeof INPUT_KEYS)[number], unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null;
  try { prototype = Object.getPrototypeOf(value); }
  catch { fail("INVALID_REQUEST"); }
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== INPUT_KEYS.length || keys.some((key) => typeof key !== "string" || !INPUT_KEYS.includes(key as (typeof INPUT_KEYS)[number]))) {
    fail("INVALID_REQUEST");
  }
  const result = Object.create(null) as Record<(typeof INPUT_KEYS)[number], unknown>;
  for (const key of INPUT_KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail("INVALID_REQUEST");
    result[key] = descriptor.value;
  }
  return result;
}

function normalizePrompt(value: unknown, profile: OwnerVideo2AudioSourceProfile): string {
  if (typeof value !== "string" || !isWellFormedUnicode(value)) fail("PROMPT_INVALID");
  const prompt = value.trim();
  if (prompt.length === 0 || prompt.length > profile.source.controls.prompt.local_bound_utf16 || PROMPT_CONTROL.test(prompt)) {
    fail("PROMPT_INVALID");
  }
  return prompt;
}

function normalizeOriginalVideo(
  filename: unknown,
  mimeType: unknown,
  rawBytes: unknown,
  profile: OwnerVideo2AudioSourceProfile
): OwnerVideo2AudioNormalizedInput["original"] {
  if (typeof filename !== "string" || !SAFE_FILENAME.test(filename) || filename.includes("/") || filename.includes("\\") ||
      mimeType !== "video/mp4" || !profile.source.controls.original_video.profile_accepts.includes(mimeType)) {
    fail("ORIGINAL_VIDEO_INVALID");
  }
  if (types.isProxy(rawBytes) || !(rawBytes instanceof Uint8Array)) fail("ORIGINAL_VIDEO_INVALID");
  try {
    if (!Buffer.isBuffer(rawBytes) && Object.getPrototypeOf(rawBytes) !== Uint8Array.prototype) fail("ORIGINAL_VIDEO_INVALID");
  } catch {
    fail("ORIGINAL_VIDEO_INVALID");
  }
  if (rawBytes.byteLength < 16 || rawBytes.byteLength > profile.source.controls.original_video.local_size_bound_bytes) fail("ORIGINAL_VIDEO_INVALID");
  const bytes = new Uint8Array(rawBytes.byteLength);
  bytes.set(rawBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxSize = view.getUint32(0, false);
  const fileType = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
  if (boxSize < 16 || boxSize > bytes.byteLength || fileType !== "ftyp") fail("ORIGINAL_VIDEO_INVALID");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const original = {
    filename,
    mime_type: "video/mp4" as const,
    size: bytes.byteLength,
    sha256: digest,
    container: "ISO_BMFF_MP4_FTYP" as const
  } as {
    filename: string;
    mime_type: "video/mp4";
    size: number;
    sha256: string;
    container: "ISO_BMFF_MP4_FTYP";
    bytes: Uint8Array;
  };
  Object.defineProperty(original, "bytes", { enumerable: false, configurable: false, get: () => new Uint8Array(bytes) });
  return Object.freeze(original);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function fail(code: OwnerVideo2AudioInputParametersErrorCode): never {
  throw new OwnerVideo2AudioInputParametersError(code);
}
