import { types } from "node:util";
import { OWNER_SWITCHX_VIDEO_INPUT_POLICY, isValidatedOwnerSwitchxVideo, type ValidatedOwnerSwitchxVideo } from "./owner-switchx-video-policy.js";

export const OWNER_SWITCHX_VIDEO_MODEL_ID = "switchx" as const;
export const OWNER_SWITCHX_VIDEO_AI_NAME = "beeble" as const;
export const OWNER_SWITCHX_VIDEO_SOURCE_PROFILE = Object.freeze({
  status: "CURRENT_1792363638_FORM_AND_PUBLIC_ROW_SOURCE_BOUNDED_PROVIDER_UNPROVEN",
  source_pins: Object.freeze({ build_id: "1792363638", form_module: "beeble.js",
    form_sha256: "sha256:4a7bfd2c4a16ade9717248a7ac5fb57b684e32ec8f116789416e8ad409329a7a",
    public_model_response_sha256: "sha256:cb2581608a551f4bc783af85d2edd8cca6a926f8f84f41e3382885ba9a3cf054",
    public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json",
    catalog_models_canonical_sha256: "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1",
    shared_video_sender_sha256: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b",
    new_session_file_mapper_sha256: "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc" }),
  model_id: OWNER_SWITCHX_VIDEO_MODEL_ID, ai_name: OWNER_SWITCHX_VIDEO_AI_NAME, scope: "video",
  selector: Object.freeze({ field: "model_type", exact_value: OWNER_SWITCHX_VIDEO_MODEL_ID, aliases: false }),
  initial_tuple: Object.freeze({ resolution: "720P", mask_mode: "auto", video_duration_seconds: 5, frame_rate: 24,
    source_frame: Object.freeze({ width: 1_280, height: 720 }),
    files: Object.freeze([{ type: "video" as const, count: 1 }]) }),
  cost_parameter_keys: Object.freeze(["resolution", "video_duration", "frame_rate"] as const),
  cost_parameter_sources: Object.freeze({ resolution: "caller-fixed-initial-tuple", video_duration: "trusted-local-ffprobe",
    frame_rate: "trusted-local-ffprobe" }),
  prompt: Object.freeze({ public_max_length: 2_000, local_utf16_max_length: 1_000, local_bound_kind: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT" }),
  public_video_bounds: Object.freeze({ accepted_mime_types: Object.freeze(["video/mp4", "video/quicktime"] as const),
    max_file_size_bytes: 104_857_600, min_pixels: 100_000, max_pixels: 2_770_000,
    max_video_count: 1, max_image_count: 1 }),
  input_binding: "CALLER_SUPPLIES_EXACT_VIDEO_BYTES; LOCAL_PROBE_HASH_BINDS_MEASURED_METADATA_TO_UPLOAD_BYTES",
  settings: Object.freeze({ model_type: OWNER_SWITCHX_VIDEO_MODEL_ID, resolution: "720P", mask_mode: "auto",
    video_duration: 5, frame_rate: 24, file_urls: Object.freeze([{ type: "video" as const }]) }),
  upload_transport: Object.freeze({ route: "/api/v1/chats/upload-files", destination: "OPERATOR_RUNTIME_CONFIGURATION",
    local_generic_transport_limit_bytes: 10_485_760, duplicate_check: true }),
  source_gaps: Object.freeze(["UI_SELECTED_VIDEO_STORE_JOIN_UNVERIFIED", "BACKEND_ACCEPTANCE_UNPROVEN", "OUTPUT_AND_PROVIDER_TERMINAL_SEMANTICS_UNPROVEN"]),
  local_probe_scope: OWNER_SWITCHX_VIDEO_INPUT_POLICY.probe,
  provider_acceptance: "UNPROVEN"
} as const);

export interface OwnerSwitchxVideoInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly video: Readonly<ValidatedOwnerSwitchxVideo>;
}

export interface OwnerSwitchxNormalizedVideoInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly video: Readonly<ValidatedOwnerSwitchxVideo>;
  readonly source_sha256: string;
  readonly source_size: number;
  readonly source_width: number;
  readonly source_height: number;
  readonly video_duration: 5;
  readonly frame_rate: 24;
  readonly cost_parameters: Readonly<{ resolution: "720P"; video_duration: 5; frame_rate: 24 }>;
  readonly settings: Readonly<{ model_type: "switchx"; resolution: "720P"; mask_mode: "auto";
    video_duration: 5; frame_rate: 24; file_urls: readonly [{ readonly type: "video" }] }>;
}

export class OwnerSwitchxVideoParametersError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "VIDEO_NOT_VALIDATED") {
    super("The Switchx request is outside its source-bounded initial video slice.");
    this.name = "OwnerSwitchxVideoParametersError";
  }
}

export function normalizeOwnerSwitchxVideoInput(value: unknown): Readonly<OwnerSwitchxNormalizedVideoInput> {
  const row = exact(value, ["attemptId", "prompt", "video"]);
  if (typeof row.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(row.attemptId) ||
      typeof row.prompt !== "string" || row.prompt.trim().length === 0 || row.prompt.length > 1_000 || !wellFormed(row.prompt) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(row.prompt)) {
    throw new OwnerSwitchxVideoParametersError("INVALID_REQUEST");
  }
  if (!isValidatedOwnerSwitchxVideo(row.video) || row.video.model_id !== OWNER_SWITCHX_VIDEO_MODEL_ID ||
      row.video.policy_id !== OWNER_SWITCHX_VIDEO_INPUT_POLICY.policy_id || row.video.generation_permit !== false ||
      row.video.owner_upload_binding !== "NOT_ESTABLISHED" || row.video.provider_acceptance !== "UNPROVEN") {
    throw new OwnerSwitchxVideoParametersError("VIDEO_NOT_VALIDATED");
  }
  const video = row.video;
  return Object.freeze({ attemptId: row.attemptId, prompt: row.prompt, video, source_sha256: video.source_sha256,
    source_size: video.size, source_width: video.width, source_height: video.height, video_duration: 5, frame_rate: 24,
    cost_parameters: Object.freeze({ resolution: "720P", video_duration: 5, frame_rate: 24 }),
    settings: Object.freeze({ model_type: OWNER_SWITCHX_VIDEO_MODEL_ID, resolution: "720P", mask_mode: "auto",
      video_duration: 5, frame_rate: 24, file_urls: Object.freeze([{ type: "video" as const }] as const) }) });
}

function exact(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new OwnerSwitchxVideoParametersError("INVALID_REQUEST");
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { throw new OwnerSwitchxVideoParametersError("INVALID_REQUEST"); }
  const actual = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) {
    throw new OwnerSwitchxVideoParametersError("INVALID_REQUEST");
  }
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) out[key] = descriptors[key]!.value;
  return out;
}

function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(index + 1); if (next < 0xdc00 || next > 0xdfff) return false; index++; }
    else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
