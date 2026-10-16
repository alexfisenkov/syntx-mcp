import { types } from "node:util";

export interface OwnerWan30OmniGenerationParameters {
  readonly aspect_ratio: "16:9";
  readonly resolution: "480P";
  readonly video_duration: 2;
  readonly prompt_extend: true;
  readonly shot_type: "single";
  readonly audio_setting: "auto";
  readonly seed: null;
  readonly native_audio: false;
  readonly duration: 0;
  readonly rendering_speed: "basic";
}

export interface OwnerWan30OmniGenerationIntent {
  readonly model_id: "wan_30_omni";
  readonly prompt: string;
  readonly parameters: OwnerWan30OmniGenerationParameters;
}

const PROFILE_ID = "owner-wan30-omni-web-request-observed-1874" as const;
const MODEL_ID = "wan_30_omni" as const;
const AI_NAME = "wan_video" as const;
// This is a local input bound, not an observed Omni control maximum or provider limit.
const PROMPT_LOCAL_MAX_UTF16 = 20_000;
const SOURCE_PINS = Object.freeze({
  public_catalog_version: "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json",
  form_build_id: "1792069332",
  form_module: "wan-video.js",
  form_module_bytes: 25_801,
  form_module_sha256: "25e2fb226a57a9134541e26fee726d18f9075bc90f428610c3733950a58c7423",
  video_sender_module: "video.js",
  video_sender_module_bytes: 8_689,
  video_sender_module_sha256: "3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b"
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
  native_audio: false as const,
  duration: 0 as const,
  rendering_speed: "basic" as const
});

const SOURCE_CONTRACT = Object.freeze({
  profile_id: PROFILE_ID,
  status: "WEB_REQUEST_OBSERVED_SINGLE_TUPLE" as const,
  model_id: MODEL_ID,
  ai_name: AI_NAME,
  source_pins: SOURCE_PINS,
  wire_observation: Object.freeze({
    evidence: "ONE_ORDINARY_UI_POST_HTTP_200" as const,
    method: "POST" as const,
    path: "video/generate" as const,
    query_candidate: Object.freeze({ ai_name: AI_NAME }),
    request_body_keys: Object.freeze(["chat_id", "prompt", "settings"] as const),
    settings_keys: OBSERVED_SETTINGS_KEYS,
    file_urls_shape: "ONE_OBJECT_TYPE_AND_URL_ONLY" as const,
    file_urls_entry_types: Object.freeze(["image"] as const),
    reference_count: 1 as const,
    prompt_serialization: Object.freeze({
      form: "<<<[OWN_REFERENCE_URL]>>> [PROMPT] " as const,
      trusted_reference_url_required: true as const,
      caller_url_accepted_here: false as const,
      caller_delimiter_injection_rejected: true as const
    }),
    observed_tuple_only: true as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  }),
  owner_ack_observation: Object.freeze({
    evidence: "ONE_UI_ACK_EXACT_TWO_OBJECTS" as const,
    object_types_in_order: Object.freeze(["text", "image"] as const),
    model_id: MODEL_ID,
    text_object_matches: "EXACT_WIRE_PROMPT" as const,
    image_object_url_matches: "EXACT_FILE_URL" as const
  }),
  quote_observation: Object.freeze({
    evidence: "SELECTED_MODE_GET_MODEL_INFO_UI_OBSERVED" as const,
    path: "/api/v2/get_model_info" as const,
    query_candidate: Object.freeze({ model_type: MODEL_ID, ai_name: AI_NAME }),
    observed_keys: Object.freeze(["resolution", "video_duration", "duration", "rendering_speed"] as const),
    observed_values: Object.freeze({
      resolution: "480P" as const,
      video_duration: 2 as const,
      duration: 0 as const,
      rendering_speed: "basic" as const
    }),
    billing_semantics: "UNPROVEN" as const,
    full_constraints: "UNPROVEN" as const
  }),
  controls: Object.freeze({
    status: "CURRENT_UI_VALUES_SINGLE_OBSERVED_CASE" as const,
    observed_values: OBSERVED_PARAMETERS,
    valid_combinations: "UNPROVEN" as const,
    local_operator_allowlist_only: true as const
  }),
  profile_scope: Object.freeze({
    supported_input_case: "ONE_TRUSTED_IMAGE_ONLY" as const,
    other_omni_input_variants: "NOT_COVERED" as const
  }),
  prompt_limit: Object.freeze({
    maximum_utf16_length: PROMPT_LOCAL_MAX_UTF16,
    source: "LOCAL_SAFETY_BOUND_NOT_OMNI_UI_OR_PROVIDER_LIMIT" as const
  }),
  effective_defaults: "UNKNOWN" as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export interface OwnerWan30OmniGenerationSourceContract {
  readonly profile_id: typeof PROFILE_ID;
  readonly status: "WEB_REQUEST_OBSERVED_SINGLE_TUPLE";
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof AI_NAME;
  readonly source_pins: typeof SOURCE_PINS;
  readonly wire_observation: typeof SOURCE_CONTRACT.wire_observation;
  readonly owner_ack_observation: typeof SOURCE_CONTRACT.owner_ack_observation;
  readonly quote_observation: typeof SOURCE_CONTRACT.quote_observation;
  readonly controls: typeof SOURCE_CONTRACT.controls;
  readonly profile_scope: typeof SOURCE_CONTRACT.profile_scope;
  readonly prompt_limit: typeof SOURCE_CONTRACT.prompt_limit;
  readonly effective_defaults: "UNKNOWN";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan30OmniNormalizedGeneration {
  readonly status: "WEB_REQUEST_OBSERVED_EXPLICIT_INTENT";
  readonly intent: OwnerWan30OmniGenerationIntent;
  readonly source_profile_id: typeof PROFILE_ID;
  readonly source_pins: typeof SOURCE_PINS;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan30OmniWireCandidate {
  readonly method: "POST";
  readonly path: "video/generate";
  readonly query_candidate: Readonly<{ ai_name: typeof AI_NAME }>;
  readonly prompt_candidate: string;
  readonly settings_candidate: Readonly<{
    model_type: typeof MODEL_ID;
    aspect_ratio: "16:9";
    resolution: "480P";
    video_duration: 2;
    prompt_extend: true;
    shot_type: "single";
    audio_setting: "auto";
    seed: null;
    native_audio: false;
    duration: 0;
    rendering_speed: "basic";
  }>;
  readonly required_reference_slots: readonly ["image"];
  readonly reference_prompt_plan: Readonly<{
    form: "<<<[OWN_REFERENCE_URL]>>> [PROMPT] ";
    reference_prefix: "<<<";
    reference_suffix: ">>>";
    prompt_separator: " ";
    trailing_space: true;
    file_urls_entry_type: "image";
    file_urls_bound: false;
    trusted_reference_url_required: true;
    url_source: "TRUSTED_OWNER_OMNI_IMAGE_LAYER_NOT_ACCEPTED_HERE";
  }>;
  readonly profile_id: typeof PROFILE_ID;
  readonly source_pins: typeof SOURCE_PINS;
  readonly status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED";
  readonly chat_id_bound: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerWan30OmniGenerationParametersError extends Error {
  readonly code = "INVALID_PARAMETERS" as const;
  constructor() {
    super("WAN 3.0 Omni explicit parameters are invalid.");
    this.name = "OwnerWan30OmniGenerationParametersError";
  }
}

export function getOwnerWan30OmniGenerationSourceContract(): OwnerWan30OmniGenerationSourceContract {
  return SOURCE_CONTRACT;
}

/** Accepts only the one observed Omni image tuple; it does not imply defaults or other Omni inputs. */
export function normalizeOwnerWan30OmniGenerationIntent(input: unknown): OwnerWan30OmniNormalizedGeneration {
  const fields = exactRecord(input, ["prompt", "parameters"]);
  if (typeof fields.prompt !== "string" || fields.prompt.length === 0 || fields.prompt.length > PROMPT_LOCAL_MAX_UTF16 ||
      !isWellFormedUnicode(fields.prompt) || fields.prompt.trim().length === 0 ||
      fields.prompt.includes("<<<") || fields.prompt.includes(">>>")) invalid();
  const raw = exactRecord(fields.parameters, [
    "aspect_ratio", "resolution", "video_duration", "prompt_extend", "shot_type", "audio_setting", "seed",
    "native_audio", "duration", "rendering_speed"
  ]);
  if (raw.aspect_ratio !== OBSERVED_PARAMETERS.aspect_ratio || raw.resolution !== OBSERVED_PARAMETERS.resolution ||
      raw.video_duration !== OBSERVED_PARAMETERS.video_duration || raw.prompt_extend !== OBSERVED_PARAMETERS.prompt_extend ||
      raw.shot_type !== OBSERVED_PARAMETERS.shot_type || raw.audio_setting !== OBSERVED_PARAMETERS.audio_setting ||
      raw.seed !== OBSERVED_PARAMETERS.seed || raw.native_audio !== OBSERVED_PARAMETERS.native_audio ||
      raw.duration !== OBSERVED_PARAMETERS.duration || raw.rendering_speed !== OBSERVED_PARAMETERS.rendering_speed) invalid();
  const parameters: OwnerWan30OmniGenerationParameters = Object.freeze({ ...OBSERVED_PARAMETERS });
  const intent: OwnerWan30OmniGenerationIntent = Object.freeze({ model_id: MODEL_ID, prompt: fields.prompt, parameters });
  return Object.freeze({ status: "WEB_REQUEST_OBSERVED_EXPLICIT_INTENT", intent, source_profile_id: PROFILE_ID,
    source_pins: SOURCE_PINS, effective_defaults: "UNKNOWN", runtime_usable: false,
    dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
}

/** Projects scalar settings only; trusted reference URL and chat ID remain outside this module. */
export function projectOwnerWan30OmniGenerationWireCandidate(intentInput: unknown): OwnerWan30OmniWireCandidate {
  const outer = exactRecord(intentInput, ["model_id", "prompt", "parameters"]);
  if (outer.model_id !== MODEL_ID) invalid();
  const normalized = normalizeOwnerWan30OmniGenerationIntent({ prompt: outer.prompt, parameters: outer.parameters });
  return Object.freeze({
    method: "POST", path: "video/generate", query_candidate: Object.freeze({ ai_name: AI_NAME }),
    prompt_candidate: normalized.intent.prompt,
    settings_candidate: Object.freeze({ model_type: MODEL_ID, ...OBSERVED_PARAMETERS }),
    required_reference_slots: Object.freeze(["image"] as const),
    reference_prompt_plan: Object.freeze({ form: "<<<[OWN_REFERENCE_URL]>>> [PROMPT] ", reference_prefix: "<<<", reference_suffix: ">>>",
      prompt_separator: " ", trailing_space: true, file_urls_entry_type: "image", file_urls_bound: false,
      trusted_reference_url_required: true, url_source: "TRUSTED_OWNER_OMNI_IMAGE_LAYER_NOT_ACCEPTED_HERE" }),
    profile_id: PROFILE_ID, source_pins: SOURCE_PINS, status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED",
    chat_id_bound: false, dispatch_allowed: false, backend_acceptance: "UNPROVEN"
  });
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
  throw new OwnerWan30OmniGenerationParametersError();
}
