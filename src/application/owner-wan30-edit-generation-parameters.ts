import { types } from "node:util";

export interface OwnerWan30EditGenerationParameters {
  readonly aspect_ratio: "16:9";
  readonly resolution: "480P";
  readonly video_duration: 2;
  readonly prompt_extend: true;
  readonly shot_type: "single";
  readonly audio_setting: "auto";
  readonly seed: null;
  readonly native_audio: true;
  readonly duration: 2;
  readonly rendering_speed: "basic";
}

export interface OwnerWan30EditGenerationIntent {
  readonly model_id: "wan_30_edit";
  readonly prompt: string;
  readonly parameters: OwnerWan30EditGenerationParameters;
}

const PROFILE_ID = "owner-wan30-edit-web-request-observed-1918" as const;
const MODEL_ID = "wan_30_edit" as const;
const AI_NAME = "wan_video" as const;
const PROMPT_LOCAL_MAX_UTF16 = 20_000;
const SOURCE_PINS = Object.freeze({
  public_catalog_version: "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json",
  model_source_sha256: "20b8c6482d72dbb4bf7e6500a0fbc0514eeac29bf5b7170559cd7665045583e3"
} as const);
const OBSERVED_SETTINGS_KEYS = Object.freeze([
  "model_type", "file_urls", "aspect_ratio", "resolution", "video_duration", "prompt_extend",
  "shot_type", "audio_setting", "seed", "native_audio", "duration", "rendering_speed"
] as const);
const OBSERVED_PARAMETERS = Object.freeze({
  aspect_ratio: "16:9" as const,
  resolution: "480P" as const,
  video_duration: 2 as const,
  prompt_extend: true as const,
  shot_type: "single" as const,
  audio_setting: "auto" as const,
  seed: null,
  native_audio: true as const,
  duration: 2 as const,
  rendering_speed: "basic" as const
});

const SOURCE_CONTRACT = Object.freeze({
  profile_id: PROFILE_ID,
  status: "LIVE_UI_SINGLE_REQUEST_OBSERVED" as const,
  model_id: MODEL_ID,
  ai_name: AI_NAME,
  source_pins: SOURCE_PINS,
  current_form_source: "NOT_REOBSERVED" as const,
  wire_observation: Object.freeze({
    evidence: "ONE_ORDINARY_UI_POST_HTTP_200" as const,
    method: "POST" as const,
    path: "/api/v1/video/generate" as const,
    query: "ai_name=wan_video" as const,
    request_body_keys: Object.freeze(["chat_id", "prompt", "settings"] as const),
    settings_keys: OBSERVED_SETTINGS_KEYS,
    file_urls_shape: "ONE_OBJECT_TYPE_AND_URL_ONLY" as const,
    file_urls_entry: Object.freeze({ type: "video" as const, url_source: "TRUSTED_NATIVE_OWN_UPLOAD_WITNESS" as const }),
    reference_count: 1 as const,
    prompt_serialization: "EXACT_PLAIN_CALLER_PROMPT_NO_REFERENCE_MARKERS_NO_ADDED_SPACE" as const,
    observed_tuple_only: true as const
  }),
  owner_ack_observation: Object.freeze({
    evidence: "ONE_UI_ACK_EXACT_TEXT_AND_VIDEO" as const,
    object_types_in_order: Object.freeze(["text", "video"] as const),
    matching_policy: "EXACT_SET_ANY_ORDER_NOT_ORDER_PROOF" as const,
    model_id: MODEL_ID,
    text_object_matches: "EXACT_PLAIN_WIRE_PROMPT" as const,
    video_object_url_matches: "EXACT_UPLOADED_URL" as const
  }),
  quote_observation: Object.freeze({
    evidence: "GET_MODEL_INFO_AFTER_OWN_TWO_SECOND_MP4_UPLOAD" as const,
    method: "GET" as const,
    path: "/api/v2/get_model_info" as const,
    query: Object.freeze({ model_type: MODEL_ID, ai_name: AI_NAME }),
    observed_keys: Object.freeze(["resolution", "video_duration", "duration", "rendering_speed"] as const),
    observed_values: Object.freeze({
      resolution: "480P" as const,
      video_duration: 2 as const,
      duration: 2 as const,
      rendering_speed: "basic" as const
    }),
    billing_semantics: "UNPROVEN" as const
  }),
  controls: Object.freeze({
    observed_values: OBSERVED_PARAMETERS,
    valid_combinations: "UNPROVEN" as const,
    effective_defaults: "UNKNOWN" as const
  }),
  historical_pre_upload_ui_state: Object.freeze({
    evidence: "BEFORE_OWN_VIDEO_UPLOAD" as const,
    native_audio: false as const,
    duration: 0 as const,
    default_semantics: "NOT_ESTABLISHED" as const
  }),
  profile_scope: Object.freeze({
    supported_input_case: "ONE_TRUSTED_OWN_UPLOADED_MP4_OBSERVED_AT_TWO_SECONDS" as const,
    accepted_input_source: "NATIVE_OWN_UPLOAD_WITNESS_ONLY" as const,
    other_formats_and_durations: "UNKNOWN" as const,
    other_settings: "UNKNOWN" as const
  }),
  prompt_limit: Object.freeze({
    maximum_utf16_length: PROMPT_LOCAL_MAX_UTF16,
    source: "LOCAL_SAFETY_BOUND_NOT_OBSERVED_UI_OR_PROVIDER_LIMIT" as const
  }),
  dispatch_allowed: false as const,
  runtime_usable: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export interface OwnerWan30EditGenerationSourceContract {
  readonly profile_id: typeof PROFILE_ID;
  readonly status: "LIVE_UI_SINGLE_REQUEST_OBSERVED";
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof AI_NAME;
  readonly source_pins: typeof SOURCE_PINS;
  readonly current_form_source: "NOT_REOBSERVED";
  readonly wire_observation: typeof SOURCE_CONTRACT.wire_observation;
  readonly owner_ack_observation: typeof SOURCE_CONTRACT.owner_ack_observation;
  readonly quote_observation: typeof SOURCE_CONTRACT.quote_observation;
  readonly controls: typeof SOURCE_CONTRACT.controls;
  readonly historical_pre_upload_ui_state: typeof SOURCE_CONTRACT.historical_pre_upload_ui_state;
  readonly profile_scope: typeof SOURCE_CONTRACT.profile_scope;
  readonly prompt_limit: typeof SOURCE_CONTRACT.prompt_limit;
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan30EditNormalizedGeneration {
  readonly status: "LIVE_UI_SINGLE_REQUEST_EXPLICIT_INTENT";
  readonly intent: OwnerWan30EditGenerationIntent;
  readonly source_profile_id: typeof PROFILE_ID;
  readonly source_pins: typeof SOURCE_PINS;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerWan30EditGenerationParametersError extends Error {
  readonly code = "INVALID_PARAMETERS" as const;
  constructor() {
    super("WAN 3.0 Edit explicit parameters are invalid.");
    this.name = "OwnerWan30EditGenerationParametersError";
  }
}

export function getOwnerWan30EditGenerationSourceContract(): OwnerWan30EditGenerationSourceContract {
  return SOURCE_CONTRACT;
}

/** Accepts the one observed Edit tuple; uploaded media and chat binding stay outside this pure intent. */
export function normalizeOwnerWan30EditGenerationIntent(input: unknown): OwnerWan30EditNormalizedGeneration {
  const fields = exactRecord(input, ["prompt", "parameters"]);
  if (typeof fields.prompt !== "string" || fields.prompt.length === 0 || fields.prompt.length > PROMPT_LOCAL_MAX_UTF16 ||
      !isWellFormedUnicode(fields.prompt) || fields.prompt.trim().length === 0) invalid();
  const raw = exactRecord(fields.parameters, [
    "aspect_ratio", "resolution", "video_duration", "prompt_extend", "shot_type", "audio_setting", "seed",
    "native_audio", "duration", "rendering_speed"
  ]);
  if (raw.aspect_ratio !== OBSERVED_PARAMETERS.aspect_ratio || raw.resolution !== OBSERVED_PARAMETERS.resolution ||
      raw.video_duration !== OBSERVED_PARAMETERS.video_duration || raw.prompt_extend !== OBSERVED_PARAMETERS.prompt_extend ||
      raw.shot_type !== OBSERVED_PARAMETERS.shot_type || raw.audio_setting !== OBSERVED_PARAMETERS.audio_setting ||
      raw.seed !== OBSERVED_PARAMETERS.seed || raw.native_audio !== OBSERVED_PARAMETERS.native_audio ||
      raw.duration !== OBSERVED_PARAMETERS.duration || raw.rendering_speed !== OBSERVED_PARAMETERS.rendering_speed) invalid();
  const parameters: OwnerWan30EditGenerationParameters = Object.freeze({ ...OBSERVED_PARAMETERS });
  const intent: OwnerWan30EditGenerationIntent = Object.freeze({ model_id: MODEL_ID, prompt: fields.prompt, parameters });
  return Object.freeze({ status: "LIVE_UI_SINGLE_REQUEST_EXPLICIT_INTENT", intent, source_profile_id: PROFILE_ID,
    source_pins: SOURCE_PINS, effective_defaults: "UNKNOWN", runtime_usable: false,
    dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
}

function exactRecord(value: unknown, requiredKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value)) invalid();
  try {
    if (Array.isArray(value)) invalid();
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== requiredKeys.length ||
        keys.some((key) => typeof key !== "string" || !requiredKeys.includes(key) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalid(); }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function invalid(): never {
  throw new OwnerWan30EditGenerationParametersError();
}
