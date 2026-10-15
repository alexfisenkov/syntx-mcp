import { types } from "node:util";

export interface OwnerWan30FirstLastGenerationParameters {
  readonly aspect_ratio: "16:9";
  readonly resolution: "480P";
  readonly video_duration: 2;
  readonly prompt_extend: true;
  readonly seed: null;
  readonly native_audio: false;
  readonly rendering_speed: "basic";
}

export interface OwnerWan30FirstLastGenerationIntent {
  readonly model_id: "wan_30_first_last_frame";
  readonly prompt: string;
  readonly parameters: OwnerWan30FirstLastGenerationParameters;
}

const PROFILE_ID = "owner-wan30-first-last-web-request-observed-1823" as const;
const MODEL_ID = "wan_30_first_last_frame" as const;
const AI_NAME = "wan_video" as const;
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
const REFERENCE_ROLE_ORDER = Object.freeze(["first_frame", "last_frame"] as const);
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
    file_urls_shape: "TWO_ROLE_OBJECTS_TYPE_AND_URL_ONLY" as const,
    file_urls_role_order: REFERENCE_ROLE_ORDER,
    observed_tuple_only: true as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  }),
  controls: Object.freeze({
    status: "NOT_SOURCE_JOINED" as const,
    single_observed_tuple: Object.freeze({
      aspect_ratio: "16:9" as const,
      resolution: "480P" as const,
      video_duration: 2 as const,
      prompt_extend: true as const,
      seed: null,
      native_audio: false as const,
      rendering_speed: "basic" as const
    }),
    local_operator_allowlist_only: true as const
  }),
  prompt_limit: Object.freeze({ maximum_utf16_length: PROMPT_LOCAL_MAX_UTF16,
    source: "UI_COUNTER_LOCAL_OPERATOR_BOUND_NOT_PROVIDER_LIMIT" as const }),
  local_operator_reference_slots: REFERENCE_ROLE_ORDER,
  effective_defaults: "UNKNOWN" as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export interface OwnerWan30FirstLastGenerationSourceContract {
  readonly profile_id: typeof PROFILE_ID;
  readonly status: "WEB_REQUEST_OBSERVED_SINGLE_TUPLE";
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof AI_NAME;
  readonly source_pins: typeof SOURCE_PINS;
  readonly wire_observation: typeof SOURCE_CONTRACT.wire_observation;
  readonly controls: typeof SOURCE_CONTRACT.controls;
  readonly prompt_limit: typeof SOURCE_CONTRACT.prompt_limit;
  readonly local_operator_reference_slots: typeof REFERENCE_ROLE_ORDER;
  readonly effective_defaults: "UNKNOWN";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan30FirstLastNormalizedGeneration {
  readonly status: "WEB_REQUEST_OBSERVED_EXPLICIT_INTENT";
  readonly intent: OwnerWan30FirstLastGenerationIntent;
  readonly source_profile_id: typeof PROFILE_ID;
  readonly source_pins: typeof SOURCE_PINS;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan30FirstLastWireCandidate {
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
  readonly reference_shape: Readonly<{
    observed_settings_key: "file_urls";
    observed_role_order: typeof REFERENCE_ROLE_ORDER;
    local_operator_slots: typeof REFERENCE_ROLE_ORDER;
    file_urls_bound: false;
    url_source: "TRUSTED_OWNER_REFERENCE_LAYER_NOT_ACCEPTED_HERE";
  }>;
  readonly profile_id: typeof PROFILE_ID;
  readonly source_pins: typeof SOURCE_PINS;
  readonly status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED";
  readonly chat_id_bound: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerWan30FirstLastGenerationParametersError extends Error {
  readonly code = "INVALID_PARAMETERS" as const;
  constructor() {
    super("WAN 3.0 First/Last explicit parameters are invalid.");
    this.name = "OwnerWan30FirstLastGenerationParametersError";
  }
}

export function getOwnerWan30FirstLastGenerationSourceContract(): OwnerWan30FirstLastGenerationSourceContract {
  return SOURCE_CONTRACT;
}

/** Validates only the single captured settings tuple; it does not assert the provider's full controls/defaults. */
export function normalizeOwnerWan30FirstLastGenerationIntent(input: unknown): OwnerWan30FirstLastNormalizedGeneration {
  const fields = exactRecord(input, ["prompt", "parameters"]);
  if (typeof fields.prompt !== "string" || fields.prompt.length === 0 || fields.prompt.length > PROMPT_LOCAL_MAX_UTF16 ||
      !isWellFormedUnicode(fields.prompt) || fields.prompt.trim().length === 0) invalid();
  const raw = exactRecord(fields.parameters, [
    "aspect_ratio", "resolution", "video_duration", "prompt_extend", "seed", "native_audio", "rendering_speed"
  ]);
  if (raw.aspect_ratio !== "16:9" || raw.resolution !== "480P" || raw.video_duration !== 2 || raw.prompt_extend !== true ||
      raw.seed !== null || raw.native_audio !== false || raw.rendering_speed !== "basic") invalid();
  const parameters: OwnerWan30FirstLastGenerationParameters = Object.freeze({
    aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true,
    seed: null, native_audio: false, rendering_speed: "basic"
  });
  const intent: OwnerWan30FirstLastGenerationIntent = Object.freeze({ model_id: MODEL_ID, prompt: fields.prompt, parameters });
  return Object.freeze({ status: "WEB_REQUEST_OBSERVED_EXPLICIT_INTENT", intent, source_profile_id: PROFILE_ID,
    source_pins: SOURCE_PINS, effective_defaults: "UNKNOWN", runtime_usable: false,
    dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
}

/** Projects the observed scalar settings only; trusted role-bound URLs must be added by a separate owner layer. */
export function projectOwnerWan30FirstLastGenerationWireCandidate(intentInput: unknown): OwnerWan30FirstLastWireCandidate {
  const outer = exactRecord(intentInput, ["model_id", "prompt", "parameters"]);
  if (outer.model_id !== MODEL_ID) invalid();
  const normalized = normalizeOwnerWan30FirstLastGenerationIntent({ prompt: outer.prompt, parameters: outer.parameters });
  return Object.freeze({
    method: "POST", path: "video/generate", query_candidate: Object.freeze({ ai_name: AI_NAME }),
    prompt_candidate: normalized.intent.prompt,
    settings_candidate: Object.freeze({ model_type: MODEL_ID, aspect_ratio: "16:9", resolution: "480P",
      video_duration: 2, prompt_extend: true, shot_type: "single", audio_setting: "auto", seed: null,
      native_audio: false, duration: 0, rendering_speed: "basic" }),
    reference_shape: Object.freeze({ observed_settings_key: "file_urls", observed_role_order: REFERENCE_ROLE_ORDER,
      local_operator_slots: REFERENCE_ROLE_ORDER, file_urls_bound: false,
      url_source: "TRUSTED_OWNER_REFERENCE_LAYER_NOT_ACCEPTED_HERE" }),
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
  throw new OwnerWan30FirstLastGenerationParametersError();
}
