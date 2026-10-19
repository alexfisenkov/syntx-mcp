import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";

export const OWNER_WAN27_I2V_MODEL_ID = "wan_27_i2v" as const;
const AI_NAME = "wan_video" as const;
const SCOPE = "video" as const;
const ROUTE = "video/generate" as const;
const MAX_PROMPT_LENGTH = 1_500;

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
const SOURCE_FACTS = Object.freeze({
  profile_id: "owner-wan27-i2v-initial-source-contract-2334-v1",
  status: "CURRENT_PUBLIC_ROW_PLUS_CURRENT_FRONTEND_SOURCE_CANDIDATE",
  source_pins: Object.freeze({
    form_build_id: "1792363638",
    form_module: "wan-video.js",
    form_sha256: "sha256:308d9504b372088774bc543f1527a2b4413d5c8db078e00755088065b735bd8a",
    video_module: "video.js",
    video_sha256: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b",
    settings_module: "settings3.js",
    settings_sha256: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
    cost_ui_module: "cost2.js",
    cost_ui_sha256: "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa",
    reference_module: "Reference.js",
    reference_bytes: 21_300,
    reference_sha256: "sha256:dbfd0b6b245f6cba4e8388c64db208a5bcb03fa7fc252b58b979ea312b4c0854",
    first_slot_source_span: [7_841, 7_892],
    upload_helper_module: "NewSessionButton.js",
    upload_helper_bytes: 2_052,
    upload_helper_sha256: "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc",
    first_frame_role_predicate_span: [640, 907],
    role_serialization_span: [1_307, 1_482],
    public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json",
    public_models_fetched_at: "2026-10-19T13:02:22.274Z",
    public_models_sha256: "sha256:cb2581608a551f4bc783af85d2edd8cca6a926f8f84f41e3382885ba9a3cf054",
    normalized_source_receipt: "wan-source2304.jsonl",
    source_settings_span: [6867, 7112],
    source_i2v_predicate_span: [8069, 8079],
    source_pre_send_span: [13885, 14905]
  }),
  model_id: OWNER_WAN27_I2V_MODEL_ID,
  ai_name: AI_NAME,
  scope: SCOPE,
  route: ROUTE,
  model_selector: Object.freeze({
    id_field: "value",
    selected_value: OWNER_WAN27_I2V_MODEL_ID,
    family: "wan_27",
    mode: "i2v",
    other_modes_excluded: Object.freeze(["r2v", "videoedit", "t2v"])
  }),
  status_semantics: "CANDIDATE_NOT_PROVIDER_ACCEPTANCE",
  initial_settings: Object.freeze({
    resolution: "720P",
    aspect_ratio: "1:1",
    video_duration: 5,
    prompt_extend: false,
    shot_type: "single",
    audio_setting: "auto",
    seed: null,
    native_audio: false,
    rendering_speed: "basic"
  }),
  initial_input_policy: Object.freeze({
    image_count: 1,
    audio_count: 0,
    video_count: 0,
    image_slot: "first_frame",
    image_required_minimum: "SOURCE_VALIDATOR_REQUIRES_FIRST_FRAME",
    no_advanced_controls: true
  }),
  public_row: Object.freeze({
    active: true,
    ai_name: AI_NAME,
    accepted_file_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp"] as const),
    allowed_media_types: Object.freeze(["images", "videos", "audios"] as const),
    file_count_limit: Object.freeze({ images: 2, videos: 1, audios: 1 }),
    max_file_size_bytes: 20_971_520,
    min_side: 240,
    max_side: 8_000,
    min_image_aspect_ratio: 0.125,
    max_image_aspect_ratio: 8,
    max_prompt_length: MAX_PROMPT_LENGTH,
    cost_query_keys: Object.freeze(["resolution", "video_duration"] as const)
  }),
  exact_candidate_combinations: Object.freeze([Object.freeze({
    resolution: "720P", aspect_ratio: "1:1", video_duration: 5, prompt_extend: false, shot_type: "single",
    audio_setting: "auto", seed: null, native_audio: false, rendering_speed: "basic"
  })]),
  controls: Object.freeze({
    resolution: Object.freeze(["720P"] as const),
    aspect_ratio: Object.freeze(["1:1"] as const),
    video_duration: Object.freeze([5] as const),
    prompt_extend: Object.freeze([false] as const),
    shot_type: Object.freeze(["single"] as const),
    audio_setting: Object.freeze(["auto"] as const),
    seed: Object.freeze([null] as const),
    native_audio: Object.freeze([false] as const),
    rendering_speed: Object.freeze(["basic"] as const)
  }),
  wire: Object.freeze({
    body_fields: Object.freeze(["chat_id", "prompt", "settings"] as const),
    route: ROUTE,
    query: Object.freeze({ ai_name: AI_NAME }),
    settings_fields: Object.freeze(["model_type", "resolution", "aspect_ratio", "video_duration", "prompt_extend",
      "shot_type", "audio_setting", "seed", "native_audio", "rendering_speed", "file_urls"] as const),
    image_file_url: Object.freeze({ type: "first_frame" as const, slot: "firstSlot", source_validator: "REQUIRED" as const,
      cardinality: 1 as const,
      last_frame: "OPTIONAL_NOT_SUPPORTED_IN_INITIAL_SLICE" as const })
  }),
  cost_query_keys: Object.freeze(["resolution", "video_duration"] as const),
  cost_value_mapping_confidence: "EXACT_PUBLIC_KEYS_VALUES_FROM_EXPLICIT_CANDIDATE_NOT_TARIFF_OR_PROVIDER_PROOF",
  trusted_upload_destination: "RUNTIME_CONFIGURATION_NOT_TOOL_PARAMETER",
  source_gaps: Object.freeze(["ALTERNATIVE_VIDEO_AUDIO_AND_LAST_FRAME_ROLES_OUTSIDE_INITIAL_SLICE",
    "COST_QUOTE_NOT_OBSERVED", "PROVIDER_ACCEPTANCE_AND_RESULT_CODEC_UNPROVEN"] as const),
  result_acceptance: "UNPROVEN",
  provider_acceptance: "UNPROVEN",
  dispatch_allowed: false,
  upload_authority: false
});
const SOURCE_PROFILE = Object.freeze({ ...SOURCE_FACTS, source_sha256: schemaHash(SOURCE_FACTS) });

export interface OwnerWan27I2vInput {
  readonly model_id: typeof OWNER_WAN27_I2V_MODEL_ID;
  readonly prompt: string;
  readonly resolution: "720P";
  readonly aspect_ratio: "1:1";
  readonly video_duration: 5;
  readonly prompt_extend: false;
  readonly shot_type: "single";
  readonly audio_setting: "auto";
  readonly seed: null;
  readonly native_audio: false;
  readonly rendering_speed: "basic";
}
export interface OwnerWan27I2vNormalizedParameters {
  readonly status: "EXPLICIT_INITIAL_CANDIDATE_NOT_DISPATCH_AUTHORITY";
  readonly intent: Readonly<OwnerWan27I2vInput>;
  readonly settings: Readonly<Omit<OwnerWan27I2vInput, "prompt" | "model_id"> & { readonly model_type: typeof OWNER_WAN27_I2V_MODEL_ID }>;
  readonly source_profile_sha256: string;
  readonly cost_parameters: Readonly<{ resolution: "720P"; video_duration: 5 }>;
  readonly cost_confidence: "EXPLICIT_CURRENT_MODEL_ACCESS_KEYS_NOT_TARIFF_OR_PROVIDER_ACCEPTANCE";
  readonly dispatch_allowed: false;
  readonly provider_acceptance: "UNPROVEN";
}
export class OwnerWan27I2vParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("The WAN 2.7 I2V initial candidate parameters are invalid."); this.name = "OwnerWan27I2vParametersError";
  }
}
export function getOwnerWan27I2vSourceProfile(): DeepReadonly<typeof SOURCE_PROFILE> { return SOURCE_PROFILE; }
export function normalizeOwnerWan27I2vParameters(input: unknown): Readonly<OwnerWan27I2vNormalizedParameters> {
  const fields = exact(input, ["model_id", "prompt", "resolution", "aspect_ratio", "video_duration", "prompt_extend",
    "shot_type", "audio_setting", "seed", "native_audio", "rendering_speed"]);
  if (fields.model_id !== OWNER_WAN27_I2V_MODEL_ID || typeof fields.prompt !== "string" || fields.prompt.trim().length === 0 ||
      fields.prompt.length > MAX_PROMPT_LENGTH || !wellFormed(fields.prompt) || fields.resolution !== "720P" ||
      fields.aspect_ratio !== "1:1" || fields.video_duration !== 5 || fields.prompt_extend !== false ||
      fields.shot_type !== "single" || fields.audio_setting !== "auto" || fields.seed !== null ||
      fields.native_audio !== false || fields.rendering_speed !== "basic") invalid();
  const intent = Object.freeze({ model_id: OWNER_WAN27_I2V_MODEL_ID, prompt: fields.prompt,
    resolution: "720P" as const, aspect_ratio: "1:1" as const, video_duration: 5 as const, prompt_extend: false as const,
    shot_type: "single" as const, audio_setting: "auto" as const, seed: null, native_audio: false as const,
    rendering_speed: "basic" as const });
  const settings = Object.freeze({ model_type: OWNER_WAN27_I2V_MODEL_ID, resolution: intent.resolution,
    aspect_ratio: intent.aspect_ratio, video_duration: intent.video_duration, prompt_extend: false as const,
    shot_type: "single" as const, audio_setting: "auto" as const, seed: null, native_audio: false as const,
    rendering_speed: "basic" as const });
  return Object.freeze({ status: "EXPLICIT_INITIAL_CANDIDATE_NOT_DISPATCH_AUTHORITY", intent, settings,
    source_profile_sha256: SOURCE_PROFILE.source_sha256,
    cost_parameters: Object.freeze({ resolution: "720P", video_duration: 5 }),
    cost_confidence: "EXPLICIT_CURRENT_MODEL_ACCESS_KEYS_NOT_TARIFF_OR_PROVIDER_ACCEPTANCE",
    dispatch_allowed: false, provider_acceptance: "UNPROVEN" });
}
function exact(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
      keys.some(key => typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
        descriptors[key]!.enumerable !== true)) invalid();
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) out[key] = descriptors[key]!.value; return out;
}
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(i + 1); if (next < 0xdc00 || next > 0xdfff) return false; i += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function invalid(): never { throw new OwnerWan27I2vParametersError("INVALID_PARAMETERS"); }
