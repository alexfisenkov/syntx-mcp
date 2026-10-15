import { types } from "node:util";

export type OwnerWan30T2vGenerationResolution = "480P" | "720P" | "1080P";
export type OwnerWan30T2vGenerationAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
export type OwnerWan30T2vRenderingSpeed = "basic" | "prime";

export interface OwnerWan30T2vGenerationParameters {
  readonly aspect_ratio: OwnerWan30T2vGenerationAspectRatio;
  readonly resolution: OwnerWan30T2vGenerationResolution;
  readonly video_duration: number;
  readonly prompt_extend: boolean;
  readonly seed: number | null;
  readonly native_audio: boolean;
  readonly rendering_speed: OwnerWan30T2vRenderingSpeed;
}

export interface OwnerWan30T2vGenerationIntent {
  readonly model_id: "wan_30_t2v";
  readonly prompt: string;
  readonly parameters: OwnerWan30T2vGenerationParameters;
}

const PROFILE_ID = "owner-wan30-t2v-web-request-observed-1807" as const;
const MODEL_ID = "wan_30_t2v" as const;
const AI_NAME = "wan_video" as const;
const MAX_PROMPT_LENGTH = 1_500;
const MAX_SEED = 2_147_483_647;
const VIDEO_DURATION_MIN = 2;
const VIDEO_DURATION_MAX = 30;
const RESOLUTIONS = Object.freeze(["480P", "720P", "1080P"] as const);
const ASPECT_RATIOS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"] as const);
const RENDERING_SPEEDS = Object.freeze(["basic", "prime"] as const);
const COST_KEYS = Object.freeze(["resolution", "video_duration", "duration", "rendering_speed"] as const);
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
const SOURCE_CONTRACT = Object.freeze({
  profile_id: PROFILE_ID,
  status: "WEB_REQUEST_OBSERVED" as const,
  model_id: MODEL_ID,
  ai_name: AI_NAME,
  source_pins: SOURCE_PINS,
  wire_observation: Object.freeze({
    evidence: "SYNTHETIC_PROMPT_HTTP_200_NO_INPUT_UPLOAD" as const,
    prompt: "VERBATIM" as const,
    settings_keys: Object.freeze([
      "model_type", "file_urls", "aspect_ratio", "resolution", "video_duration", "prompt_extend",
      "shot_type", "audio_setting", "seed", "native_audio", "duration", "rendering_speed"
    ] as const),
    response: "STANDARD_NUMERIC_MESSAGE_OBJECT_NO_MEDIA_ARTIFACT" as const
  }),
  controls: Object.freeze({
    aspect_ratio: Object.freeze({ values: ASPECT_RATIOS, excluded_visible_option: "Adaptive" as const }),
    resolution: Object.freeze({ values: RESOLUTIONS }),
    video_duration: Object.freeze({ minimum: VIDEO_DURATION_MIN, maximum: VIDEO_DURATION_MAX, integer_seconds: true as const }),
    prompt_extend: "EXPLICIT_BOOLEAN" as const,
    native_audio: "EXPLICIT_BOOLEAN" as const,
    seed: Object.freeze({ nullable: true, minimum: 0, maximum: MAX_SEED, integer: true as const }),
    rendering_speed: Object.freeze({ values: RENDERING_SPEEDS })
  }),
  fixed_settings: Object.freeze({
    file_urls: Object.freeze([] as const),
    shot_type: "single" as const,
    audio_setting: "auto" as const,
    duration: 0 as const
  }),
  prompt_limit: Object.freeze({ maximum_utf16_length: MAX_PROMPT_LENGTH, source: "LOCAL_OPERATOR_LIMIT_NOT_PROVIDER_ACCEPTANCE" as const }),
  cost_query_candidate: Object.freeze({
    keys: COST_KEYS,
    values: "EXPLICIT_SETTINGS_CANDIDATE_NOT_QUOTE_CALLER_JOINED" as const,
    current_quote: "UNKNOWN" as const
  }),
  effective_defaults: "UNKNOWN" as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export interface OwnerWan30T2vGenerationSourceContract {
  readonly profile_id: typeof PROFILE_ID;
  readonly status: "WEB_REQUEST_OBSERVED";
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof AI_NAME;
  readonly source_pins: typeof SOURCE_PINS;
  readonly wire_observation: typeof SOURCE_CONTRACT.wire_observation;
  readonly controls: typeof SOURCE_CONTRACT.controls;
  readonly fixed_settings: typeof SOURCE_CONTRACT.fixed_settings;
  readonly prompt_limit: typeof SOURCE_CONTRACT.prompt_limit;
  readonly cost_query_candidate: typeof SOURCE_CONTRACT.cost_query_candidate;
  readonly effective_defaults: "UNKNOWN";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan30T2vCostQueryCandidate {
  readonly keys: typeof COST_KEYS;
  readonly values: Readonly<{
    resolution: OwnerWan30T2vGenerationResolution;
    video_duration: number;
    duration: 0;
    rendering_speed: OwnerWan30T2vRenderingSpeed;
  }>;
  readonly confidence: "OBSERVED_SETTINGS_NOT_QUOTE_CALLER_JOINED";
  readonly current_quote: "UNKNOWN";
}

export interface OwnerWan30T2vNormalizedGeneration {
  readonly status: "WEB_REQUEST_OBSERVED_EXPLICIT_INTENT";
  readonly intent: OwnerWan30T2vGenerationIntent;
  readonly cost_query_candidate: OwnerWan30T2vCostQueryCandidate;
  readonly source_profile_id: typeof PROFILE_ID;
  readonly source_pins: typeof SOURCE_PINS;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan30T2vGenerationWireCandidate {
  readonly method: "POST";
  readonly path: "video/generate";
  readonly query_candidate: Readonly<{ ai_name: typeof AI_NAME }>;
  readonly prompt_candidate: string;
  readonly settings_candidate: Readonly<{
    model_type: typeof MODEL_ID;
    file_urls: readonly [];
    aspect_ratio: OwnerWan30T2vGenerationAspectRatio;
    resolution: OwnerWan30T2vGenerationResolution;
    video_duration: number;
    prompt_extend: boolean;
    shot_type: "single";
    audio_setting: "auto";
    seed: number | null;
    native_audio: boolean;
    duration: 0;
    rendering_speed: OwnerWan30T2vRenderingSpeed;
  }>;
  readonly profile_id: typeof PROFILE_ID;
  readonly source_pins: typeof SOURCE_PINS;
  readonly status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED";
  readonly chat_id_bound: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerWan30T2vGenerationParametersError extends Error {
  readonly code = "INVALID_PARAMETERS" as const;
  constructor() {
    super("WAN 3.0 T2V explicit parameters are invalid.");
    this.name = "OwnerWan30T2vGenerationParametersError";
  }
}

/** Returns the exact observed profile while keeping defaults and provider acceptance unclaimed. */
export function getOwnerWan30T2vGenerationSourceContract(): OwnerWan30T2vGenerationSourceContract {
  return SOURCE_CONTRACT;
}

/** Normalizes explicit owner input only; the local prompt bound is not a provider limit. */
export function normalizeOwnerWan30T2vGenerationIntent(input: unknown): OwnerWan30T2vNormalizedGeneration {
  const fields = exactRecord(input, ["prompt", "parameters"]);
  if (typeof fields.prompt !== "string" || fields.prompt.length === 0 || fields.prompt.length > MAX_PROMPT_LENGTH ||
      !isWellFormedUnicode(fields.prompt) || fields.prompt.trim().length === 0) invalid();
  const raw = exactRecord(fields.parameters, [
    "aspect_ratio", "resolution", "video_duration", "prompt_extend", "seed", "native_audio", "rendering_speed"
  ]);
  if (!isOneOf(raw.aspect_ratio, ASPECT_RATIOS) || !isOneOf(raw.resolution, RESOLUTIONS) ||
      !Number.isSafeInteger(raw.video_duration) || (raw.video_duration as number) < VIDEO_DURATION_MIN ||
      (raw.video_duration as number) > VIDEO_DURATION_MAX || typeof raw.prompt_extend !== "boolean" ||
      typeof raw.native_audio !== "boolean" || !(raw.seed === null ||
        (Number.isSafeInteger(raw.seed) && (raw.seed as number) >= 0 && (raw.seed as number) <= MAX_SEED)) ||
      !isOneOf(raw.rendering_speed, RENDERING_SPEEDS)) invalid();

  const parameters: OwnerWan30T2vGenerationParameters = Object.freeze({
    aspect_ratio: raw.aspect_ratio as OwnerWan30T2vGenerationAspectRatio,
    resolution: raw.resolution as OwnerWan30T2vGenerationResolution,
    video_duration: raw.video_duration as number,
    prompt_extend: raw.prompt_extend as boolean,
    seed: raw.seed as number | null,
    native_audio: raw.native_audio as boolean,
    rendering_speed: raw.rendering_speed as OwnerWan30T2vRenderingSpeed
  });
  const intent: OwnerWan30T2vGenerationIntent = Object.freeze({ model_id: MODEL_ID, prompt: fields.prompt, parameters });
  const cost_query_candidate: OwnerWan30T2vCostQueryCandidate = Object.freeze({
    keys: COST_KEYS,
    values: Object.freeze({
      resolution: parameters.resolution,
      video_duration: parameters.video_duration,
      duration: 0,
      rendering_speed: parameters.rendering_speed
    }),
    confidence: "OBSERVED_SETTINGS_NOT_QUOTE_CALLER_JOINED",
    current_quote: "UNKNOWN"
  });
  return Object.freeze({
    status: "WEB_REQUEST_OBSERVED_EXPLICIT_INTENT",
    intent,
    cost_query_candidate,
    source_profile_id: PROFILE_ID,
    source_pins: SOURCE_PINS,
    effective_defaults: "UNKNOWN",
    runtime_usable: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
}

/** Produces only the observed POST shape; caller chat identity and all I/O stay outside this profile. */
export function prepareOwnerWan30T2vGenerationWireCandidate(intentInput: unknown): OwnerWan30T2vGenerationWireCandidate {
  const outer = exactRecord(intentInput, ["model_id", "prompt", "parameters"]);
  if (outer.model_id !== MODEL_ID) invalid();
  const normalized = normalizeOwnerWan30T2vGenerationIntent({ prompt: outer.prompt, parameters: outer.parameters });
  const intent = normalized.intent;
  return Object.freeze({
    method: "POST",
    path: "video/generate",
    query_candidate: Object.freeze({ ai_name: AI_NAME }),
    prompt_candidate: intent.prompt,
    settings_candidate: Object.freeze({
      model_type: MODEL_ID,
      file_urls: Object.freeze([] as const),
      aspect_ratio: intent.parameters.aspect_ratio,
      resolution: intent.parameters.resolution,
      video_duration: intent.parameters.video_duration,
      prompt_extend: intent.parameters.prompt_extend,
      shot_type: "single",
      audio_setting: "auto",
      seed: intent.parameters.seed,
      native_audio: intent.parameters.native_audio,
      duration: 0,
      rendering_speed: intent.parameters.rendering_speed
    }),
    profile_id: PROFILE_ID,
    source_pins: SOURCE_PINS,
    status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED",
    chat_id_bound: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
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

function isOneOf<T>(value: unknown, values: readonly T[]): value is T {
  return values.includes(value as T);
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
  throw new OwnerWan30T2vGenerationParametersError();
}
