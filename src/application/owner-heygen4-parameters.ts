import { createHash } from "node:crypto";
import { types } from "node:util";
import { isValidatedOwnerHeygen4Image, isValidatedOwnerHeygen4Audio,
  type ValidatedOwnerHeygen4Image, type ValidatedOwnerHeygen4Audio } from "./owner-heygen4-media-policy.js";

export const OWNER_HEYGEN4_MODEL_ID = "heygen4" as const;
export const OWNER_HEYGEN4_AI_NAME = "heygen" as const;
export const OWNER_HEYGEN4_SOURCE_PROFILE = Object.freeze({
  status: "CURRENT_1792363638_FORM_AND_PUBLIC_ROW_SOURCE_BOUNDED_PROVIDER_UNPROVEN",
  source_pins: Object.freeze({ build_id: "1792363638", form_module: "heygen.js",
    form_sha256: "sha256:efe3831bea06d174db9f79ee19ec5031bc4a578d8a217ba57f24b9c940d69e6c",
    reference_component_module: "Reference.js",
    reference_component_sha256: "sha256:f78035275dee0e2fceb234fc33e85ccd7591b41851308cd9935382edc867a49a",
    file_type_helper_module: "fileUploader.js",
    file_type_helper_sha256: "sha256:45f3174473d1ae4c9e57fbee47c7bf0c7e75773e9f3b36dbb8c3e5cc7ec3863a",
    public_models_response_sha256: "sha256:cb2581608a551f4bc783af85d2edd8cca6a926f8f84f41e3382885ba9a3cf054",
    public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json",
    catalog_models_canonical_sha256: "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1",
    shared_video_sender_sha256: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b",
    new_session_file_mapper_sha256: "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc" }),
  model_id: OWNER_HEYGEN4_MODEL_ID, ai_name: OWNER_HEYGEN4_AI_NAME, scope: "video",
  selector: Object.freeze({ field: "model_type", exact_value: OWNER_HEYGEN4_MODEL_ID, aliases: false }),
  initial_tuple: Object.freeze({ aspect_ratio: "16:9", image_count: 1, audio_count: 1,
    image_role: "image", audio_role: "audio", audio_duration_source: "TRUSTED_LOCAL_FFPROBE_OF_SELECTED_AUDIO" }),
  cost_parameter_keys: Object.freeze(["duration"] as const),
  cost_parameter_sources: Object.freeze({ duration: "SOURCE_AUDIO_DURATION_CALLBACK", aspect_ratio: "NOT_A_COST_FIELD" }),
  controls: Object.freeze({ aspect_ratio: Object.freeze(["16:9", "9:16"] as const), initial_aspect_ratio: "16:9",
    source_default_duration_seconds: 2, source_default_is_fallback_only: true }),
  media: Object.freeze({ image_max_count: 1, audio_max_count: 1, image_weight_active: false, audio_weight_active: false,
    new_uploadable: false, existing_owned_file_import: "READ_ONLY_ID_PLUS_EXACT_LOCAL_BYTES_MATCH" }),
  public_bounds: Object.freeze({ allowed_media_types: Object.freeze(["images", "audios"] as const),
    max_audio_duration_seconds: 120, min_audio_duration_seconds: 2, max_file_size_bytes: 52_428_800,
    accepted_image_mime_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const),
    accepted_audio_mime_types: Object.freeze(["audio/wav", "audio/mp3", "audio/mpeg", "audio/x-wav", "audio/m4a", "audio/mp4"] as const) }),
  prompt: Object.freeze({ public_max_length: "UNKNOWN", local_utf16_max_length: 2_000, local_bound_kind: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT" }),
  settings: Object.freeze({ model_type: OWNER_HEYGEN4_MODEL_ID, aspect_ratio: "16:9", duration: "MEASURED_AUDIO_SECONDS",
    file_urls: Object.freeze([{ type: "image" as const }, { type: "audio" as const }]) }),
  source_gaps: Object.freeze(["UPLOAD_DROPDOWN_IMPLEMENTATION_NOT_CAPTURED", "UI_ASSET_SELECTION_STORE_JOIN_UNVERIFIED",
    "DIRECT_UPLOAD_PATH_UNSUPPORTED_BY_PUBLIC_ROW", "BACKEND_ACCEPTANCE_UNPROVEN", "RESULT_TERMINAL_SEMANTICS_UNPROVEN"]),
  avatar_voice_training: "OUT_OF_SCOPE_AND_NOT_IMPLEMENTED",
  provider_acceptance: "UNPROVEN"
} as const);

export function getOwnerHeygen4Parameters() {
  return Object.freeze({ model_id: OWNER_HEYGEN4_MODEL_ID, ai_name: OWNER_HEYGEN4_AI_NAME, aspect_ratios: OWNER_HEYGEN4_SOURCE_PROFILE.controls.aspect_ratio,
    initial_aspect_ratio: OWNER_HEYGEN4_SOURCE_PROFILE.controls.initial_aspect_ratio,
    image_count: OWNER_HEYGEN4_SOURCE_PROFILE.initial_tuple.image_count, audio_count: OWNER_HEYGEN4_SOURCE_PROFILE.initial_tuple.audio_count,
    accepted_image_mime_types: OWNER_HEYGEN4_SOURCE_PROFILE.public_bounds.accepted_image_mime_types,
    accepted_audio_mime_types: OWNER_HEYGEN4_SOURCE_PROFILE.public_bounds.accepted_audio_mime_types,
    max_file_size_bytes: OWNER_HEYGEN4_SOURCE_PROFILE.public_bounds.max_file_size_bytes,
    audio_duration_seconds: Object.freeze({ minimum: OWNER_HEYGEN4_SOURCE_PROFILE.public_bounds.min_audio_duration_seconds,
      maximum: OWNER_HEYGEN4_SOURCE_PROFILE.public_bounds.max_audio_duration_seconds,
      source: "TRUSTED_LOCAL_FFPROBE_OF_SELECTED_AUDIO" as const }),
    cost_parameter_keys: OWNER_HEYGEN4_SOURCE_PROFILE.cost_parameter_keys,
    cost_parameter_sources: OWNER_HEYGEN4_SOURCE_PROFILE.cost_parameter_sources,
    prompt: OWNER_HEYGEN4_SOURCE_PROFILE.prompt });
}

export interface OwnerHeygen4Input {
  readonly attemptId: string;
  readonly prompt: string;
  readonly image: Readonly<ValidatedOwnerHeygen4Image>;
  readonly image_file_id: string;
  readonly audio: Readonly<ValidatedOwnerHeygen4Audio>;
  readonly audio_file_id: string;
}

export interface OwnerHeygen4NormalizedInput extends OwnerHeygen4Input {
  readonly intent_fingerprint: string;
  readonly duration: number;
  readonly cost_parameters: Readonly<{ duration: number }>;
  readonly aspect_ratio: "16:9";
}
export interface OwnerHeygen4IntentInput { readonly attemptId: string; readonly prompt: string; readonly image_sha256: string;
  readonly image_file_id: string; readonly audio_sha256: string; readonly audio_file_id: string; readonly duration: number; }

export class OwnerHeygen4ParametersError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "IMAGE_NOT_VALIDATED" | "AUDIO_NOT_VALIDATED") {
    super("The HeyGen 4 request is outside its source-bounded image-plus-audio slice.");
    this.name = "OwnerHeygen4ParametersError";
  }
}

export function normalizeOwnerHeygen4Input(value: unknown): Readonly<OwnerHeygen4NormalizedInput> {
  const row = exact(value, ["attemptId", "prompt", "image", "image_file_id", "audio", "audio_file_id"]);
  if (typeof row.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(row.attemptId) ||
      typeof row.prompt !== "string" || !row.prompt.trim() || row.prompt.length > 2_000 || !wellFormed(row.prompt) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(row.prompt) ||
      typeof row.image_file_id !== "string" || !safeFileId(row.image_file_id) ||
      typeof row.audio_file_id !== "string" || !safeFileId(row.audio_file_id) || row.image_file_id === row.audio_file_id) {
    throw new OwnerHeygen4ParametersError("INVALID_REQUEST");
  }
  if (!isValidatedOwnerHeygen4Image(row.image) || row.image.model_id !== OWNER_HEYGEN4_MODEL_ID ||
      row.image.generation_permit !== false || row.image.owner_upload_binding !== "NOT_ESTABLISHED") {
    throw new OwnerHeygen4ParametersError("IMAGE_NOT_VALIDATED");
  }
  if (!isValidatedOwnerHeygen4Audio(row.audio) || row.audio.model_id !== OWNER_HEYGEN4_MODEL_ID ||
      row.audio.generation_permit !== false || row.audio.owner_upload_binding !== "NOT_ESTABLISHED") {
    throw new OwnerHeygen4ParametersError("AUDIO_NOT_VALIDATED");
  }
  const intent = normalizeOwnerHeygen4Intent({ attemptId: row.attemptId, prompt: row.prompt, image_sha256: row.image.sha256,
    image_file_id: row.image_file_id, audio_sha256: row.audio.sha256, audio_file_id: row.audio_file_id, duration: row.audio.duration_seconds });
  return Object.freeze({ attemptId: row.attemptId, prompt: row.prompt, image: row.image, image_file_id: row.image_file_id,
    audio: row.audio, audio_file_id: row.audio_file_id, intent_fingerprint: intent.intent_fingerprint,
    duration: intent.duration, cost_parameters: intent.cost_parameters, aspect_ratio: "16:9" });
}

/** Normalizes trusted process-local import metadata after the native client has matched the account object's exact bytes. */
export function normalizeOwnerHeygen4Intent(value: OwnerHeygen4IntentInput | unknown): Readonly<Pick<OwnerHeygen4NormalizedInput,
  "attemptId" | "prompt" | "image_file_id" | "audio_file_id" | "intent_fingerprint" | "duration" | "cost_parameters" | "aspect_ratio">> {
  const row = exact(value, ["attemptId", "prompt", "image_sha256", "image_file_id", "audio_sha256", "audio_file_id", "duration"]);
  if (typeof row.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(row.attemptId) || typeof row.prompt !== "string" ||
      !row.prompt.trim() || row.prompt.length > 2_000 || !wellFormed(row.prompt) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(row.prompt) ||
      typeof row.image_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(row.image_sha256) || typeof row.audio_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(row.audio_sha256) || typeof row.image_file_id !== "string" || !safeFileId(row.image_file_id) ||
      typeof row.audio_file_id !== "string" || !safeFileId(row.audio_file_id) || row.image_file_id === row.audio_file_id ||
      typeof row.duration !== "number" || !Number.isFinite(row.duration) || row.duration < 2 || row.duration > 120) {
    throw new OwnerHeygen4ParametersError("INVALID_REQUEST");
  }
  return Object.freeze({ attemptId: row.attemptId, prompt: row.prompt, image_file_id: row.image_file_id, audio_file_id: row.audio_file_id,
    intent_fingerprint: fingerprint({ prompt: row.prompt, image_sha256: row.image_sha256, image_file_id: row.image_file_id,
      audio_sha256: row.audio_sha256, audio_file_id: row.audio_file_id, aspect_ratio: "16:9", duration: row.duration }),
    duration: row.duration, cost_parameters: Object.freeze({ duration: row.duration }), aspect_ratio: "16:9" });
}

function exact(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new OwnerHeygen4ParametersError("INVALID_REQUEST");
  let descriptors: PropertyDescriptorMap; try { descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { throw new OwnerHeygen4ParametersError("INVALID_REQUEST"); }
  const names = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || names.length !== keys.length ||
      names.some((key) => typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) {
    throw new OwnerHeygen4ParametersError("INVALID_REQUEST");
  }
  const result = Object.create(null) as Record<string, unknown>; for (const key of names as string[]) result[key] = descriptors[key]!.value; return result;
}
function safeFileId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value); }
function fingerprint(value: unknown): string { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
}
function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index++) { const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(index + 1); if (next < 0xdc00 || next > 0xdfff) return false; index++; }
    else if (unit >= 0xdc00 && unit <= 0xdfff) return false; }
  return true;
}
