import { types } from "node:util";

const MODEL_ID = "wan_25_i2v_preview" as const;
const RESOLUTIONS = Object.freeze(["480P", "720P", "1080P"] as const);
const RATIOS_480P = Object.freeze(["16:9", "9:16", "1:1"] as const);
const RATIOS_OTHER = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"] as const);
const VIDEO_DURATIONS = Object.freeze([5, 10] as const);
const MAX_PROMPT_LENGTH = 1_500;
const MAX_SEED = 2_147_483_647;

export type OwnerWan25I2vGenerationModelId = typeof MODEL_ID;
export type OwnerWan25I2vGenerationResolution = typeof RESOLUTIONS[number];
export type OwnerWan25I2vGenerationAspectRatio = typeof RATIOS_OTHER[number];
export type OwnerWan25I2vGenerationDuration = typeof VIDEO_DURATIONS[number];
export type OwnerWan25I2vCostParameters = Readonly<{
  keys: typeof SOURCE_CONTRACT.cost_projection.keys;
  values: Readonly<{ resolution: OwnerWan25I2vGenerationResolution; video_duration: OwnerWan25I2vGenerationDuration }>;
  confidence: "PINNED_C396_METADATA_NOT_CURRENT_QUOTE";
}>;

export interface OwnerWan25I2vGenerationParametersInput {
  readonly model_id: OwnerWan25I2vGenerationModelId;
  readonly prompt: string;
  readonly parameters: Readonly<{
    resolution: OwnerWan25I2vGenerationResolution;
    aspect_ratio: OwnerWan25I2vGenerationAspectRatio;
    video_duration: OwnerWan25I2vGenerationDuration;
    prompt_extend: boolean;
    seed: number | null;
  }>;
}

export interface OwnerWan25I2vGenerationIntent {
  readonly model_id: OwnerWan25I2vGenerationModelId;
  readonly prompt: string;
  readonly parameters: Readonly<{
    resolution: OwnerWan25I2vGenerationResolution;
    aspect_ratio: OwnerWan25I2vGenerationAspectRatio;
    video_duration: OwnerWan25I2vGenerationDuration;
    prompt_extend: boolean;
    seed: number | null;
  }>;
}

const SOURCE_PINS = Object.freeze({
  public_catalog_version: "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json",
  public_catalog_fetched_at: "2026-10-15T07:17:24.901Z",
  public_models_sha256: "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a",
  form_build_id: "1791904852",
  form_module: "wan-video.js",
  form_bytes: 19_503,
  form_sha256: "sha256:f69db3d449d0051969def2229ed936d9835e0d65c8f257ec3ab289d6e9387737",
  seed_helper_module: "RandomSeed.js",
  seed_helper_bytes: 1_656,
  seed_helper_sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b",
  seed_helper_freshness: "PRIOR_PINNED_NOT_FRESH" as const,
  files_mention: false,
});

const REUSED_COMMON_EVIDENCE = Object.freeze({
  sender: Object.freeze({ module: "video.js", bytes: 8_689,
    sha256: "sha256:5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e",
    freshness: "PRIOR_SAME_BUILD_REUSED_NOT_REFETCHED" as const, scope: "COMMON_SENDER_SEAM_ONLY" as const }),
  typed_file_normalizer: Object.freeze({ module: "NewSessionButton.js", bytes: 1_906,
    sha256: "sha256:dda0cd67d1a152a5d341d3b816493cd7ed8fb5db0aad5c97fe76465940b0aadb",
    freshness: "PRIOR_SAME_BUILD_REUSED_NOT_REFETCHED" as const, scope: "COMMON_TYPED_NORMALIZER_SEAM_ONLY" as const }),
  cost_helper: Object.freeze({ module: "cost2.js", bytes: 1_660,
    sha256: "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa",
    freshness: "PRIOR_SAME_BUILD_REUSED_NOT_REFETCHED" as const, scope: "C396_KEYS_NOT_PREVIEW_CALLER_VALUES" as const }),
});

const COVERAGE_GAPS = Object.freeze([
  "CURRENT_CATALOG_NOT_LIVE_REFRESHED",
  "EFFECTIVE_UI_DEFAULTS_NOT_ESTABLISHED",
  "PREVIEW_FILE_URLS_AND_UPLOAD_COMPOSITION_NOT_ESTABLISHED",
  "CURRENT_QUOTE_NOT_ESTABLISHED",
  "PROVIDER_ACCEPTANCE_NOT_ESTABLISHED",
] as const);

const IMAGE_MIME_TYPES = Object.freeze(["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"] as const);
const AUDIO_MIME_TYPES = Object.freeze(["audio/mp3", "audio/mpeg", "audio/wav", "audio/x-wav"] as const);
const SOURCE_CONTRACT = Object.freeze({
  status: "PINNED_SOURCE_LOCAL_PARAMETER_CONTRACT" as const,
  model_ids: Object.freeze([MODEL_ID]),
  source_pins: SOURCE_PINS,
  reused_common_evidence: REUSED_COMMON_EVIDENCE,
  source_controls: Object.freeze({
    occurrences: Object.freeze({ count: 3, offsets: Object.freeze([6063, 7198, 7283]) }),
    image_selection: Object.freeze({ exact_count: 1, evidence: "CURRENT_SOURCE_EXACT_VALIDATOR" as const }),
    resolution: RESOLUTIONS,
    aspect_ratio_by_resolution: Object.freeze({ "480P": RATIOS_480P, other: RATIOS_OTHER }),
    video_duration: Object.freeze({ values: VIDEO_DURATIONS, unit: "OUTPUT_SECONDS" as const }),
    prompt_extend: "EXPLICIT_BOOLEAN" as const,
    seed: Object.freeze({ nullable: true, minimum: 0, maximum: MAX_SEED, integer: true,
      bound_source: "PRIOR_PINNED_RANDOM_SEED_GUARD_NOT_FRESH" as const }),
    fixed_fields: Object.freeze({ native_audio: false as const, shot_type: "single" as const, audio_setting: "auto" as const }),
    reference_duration: "OMITTED_FROM_SETTINGS" as const,
    output_duration_field: "video_duration" as const,
    optional_audio_ui_reference: Object.freeze({ max_count: 1,
      evidence: "REFERENCE_COMPONENT_ONLY_NATIVE_APPLICABILITY_UNPROVEN" as const }),
    native_audio: "FIXED_FALSE" as const,
  }),
  catalog_hints: Object.freeze({
    source: "PINNED_C396_STATIC_METADATA_NOT_UPLOAD_AUTHORITY" as const,
    allowed_media_types: Object.freeze(["images"] as const),
    file_count_limit: Object.freeze({ images: 1, audios: 1 }),
    image_mime_types: IMAGE_MIME_TYPES,
    audio_mime_types: AUDIO_MIME_TYPES,
    max_file_size_bytes: 10_485_760,
    image_side: Object.freeze({ minimum: 384, maximum: 5_000 }),
    audio_duration_seconds: Object.freeze({ minimum: 3, maximum: 30 }),
    prompt_max_length: MAX_PROMPT_LENGTH,
    files_mention: false,
  }),
  prompt_limit: Object.freeze({
    maximum_length: MAX_PROMPT_LENGTH,
    measure: "UTF16_CODE_UNITS" as const,
    source: "PINNED_C396_STATIC_METADATA_NOT_CURRENT_UI_LIMIT" as const,
    empty_prompt: "PRESERVED_EXPLICITLY_NOT_PROVIDER_ACCEPTANCE" as const,
    policy: "LITERAL_PROMPT_NO_FILE_URL_PARSING" as const,
  }),
  wire_projection: Object.freeze({
    status: "LOCAL_CANDIDATE_NOT_DISPATCHABLE" as const,
    ai_name: "wan_video" as const,
    settings_keys: Object.freeze(["model_type", "resolution", "aspect_ratio", "video_duration", "prompt_extend", "seed",
      "native_audio", "shot_type", "audio_setting"] as const),
    file_urls: "OMITTED_NO_CALLER_URL_AUTHORITY" as const,
    reference_composition: "UNPROVEN" as const,
  }),
  cost_projection: Object.freeze({
    source: "PINNED_C396_METADATA_NOT_CURRENT_QUOTE" as const,
    keys: Object.freeze(["resolution", "video_duration"] as const),
    current_quote: "UNKNOWN" as const,
  }),
  effective_defaults: "UNKNOWN" as const,
  current_catalog_status: "C396_PINNED_NOT_LIVE_REFRESHED" as const,
  current_quote_status: "UNKNOWN" as const,
  provider_acceptance: "UNPROVEN" as const,
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  coverage_gaps: COVERAGE_GAPS,
});

export type OwnerWan25I2vGenerationParametersSource = typeof SOURCE_CONTRACT;
export type OwnerWan25I2vGenerationParametersNormalized = Readonly<{
  status: "EXPLICIT_LOCAL_PARAMETERS_NORMALIZED";
  intent: OwnerWan25I2vGenerationIntent;
  wire_candidate: Readonly<{
    ai_name: "wan_video";
    prompt: string;
    settings: Readonly<{
      model_type: OwnerWan25I2vGenerationModelId;
      resolution: OwnerWan25I2vGenerationResolution;
      aspect_ratio: OwnerWan25I2vGenerationAspectRatio;
      video_duration: OwnerWan25I2vGenerationDuration;
      prompt_extend: boolean;
      seed: number | null;
      native_audio: false;
      shot_type: "single";
      audio_setting: "auto";
    }>;
  }>;
  cost_projection: Readonly<{
    keys: typeof SOURCE_CONTRACT.cost_projection.keys;
    values: Readonly<{ resolution: OwnerWan25I2vGenerationResolution; video_duration: OwnerWan25I2vGenerationDuration }>;
    confidence: "PINNED_C396_METADATA_NOT_CURRENT_QUOTE";
  }>;
  source_pins: typeof SOURCE_PINS;
  effective_defaults: "UNKNOWN";
  runtime_usable: false;
  dispatch_allowed: false;
  provider_acceptance: "UNPROVEN";
  coverage_gaps: typeof COVERAGE_GAPS;
}>;

export class OwnerWan25I2vGenerationParametersError extends Error {
  readonly code = "INVALID_PARAMETERS" as const;
  constructor() {
    super("WAN 2.5 I2V preview explicit parameters are invalid.");
    this.name = "OwnerWan25I2vGenerationParametersError";
  }
}

/** Returns pinned static evidence and explicit gaps; no defaults or dispatch permission are implied. */
export function getOwnerWan25I2vGenerationParametersSource(): OwnerWan25I2vGenerationParametersSource {
  return SOURCE_CONTRACT;
}

/** Normalizes one fully explicit preview intent; fixed fields remain local and no URL/reference input is accepted. */
export function normalizeOwnerWan25I2vGenerationParameters(input: unknown): OwnerWan25I2vGenerationParametersNormalized {
  const request = exactRecord(input, ["model_id", "prompt", "parameters"]);
  if (request.model_id !== MODEL_ID || typeof request.prompt !== "string" || request.prompt.length > MAX_PROMPT_LENGTH ||
      !isWellFormedUnicode(request.prompt)) invalid();
  const raw = exactRecord(request.parameters, ["resolution", "aspect_ratio", "video_duration", "prompt_extend", "seed"]);
  if (!isOneOf(raw.resolution, RESOLUTIONS) || !isAspectRatio(raw.resolution, raw.aspect_ratio) ||
      !isOneOf(raw.video_duration, VIDEO_DURATIONS) || typeof raw.prompt_extend !== "boolean" || !isSeed(raw.seed)) invalid();

  const parameters = Object.freeze({
    resolution: raw.resolution,
    aspect_ratio: raw.aspect_ratio,
    video_duration: raw.video_duration,
    prompt_extend: raw.prompt_extend,
    seed: raw.seed,
  }) as OwnerWan25I2vGenerationIntent["parameters"];
  const prompt = request.prompt;
  const intent = Object.freeze({ model_id: MODEL_ID, prompt, parameters });
  const settings = Object.freeze({
    model_type: MODEL_ID,
    resolution: parameters.resolution,
    aspect_ratio: parameters.aspect_ratio,
    video_duration: parameters.video_duration,
    prompt_extend: parameters.prompt_extend,
    seed: parameters.seed,
    native_audio: false as const,
    shot_type: "single" as const,
    audio_setting: "auto" as const,
  });
  const wireCandidate = Object.freeze({ ai_name: "wan_video" as const, prompt, settings });
  const costProjection = Object.freeze({
    keys: SOURCE_CONTRACT.cost_projection.keys,
    values: Object.freeze({ resolution: parameters.resolution, video_duration: parameters.video_duration }),
    confidence: "PINNED_C396_METADATA_NOT_CURRENT_QUOTE" as const,
  });
  return Object.freeze({
    status: "EXPLICIT_LOCAL_PARAMETERS_NORMALIZED" as const,
    intent,
    wire_candidate: wireCandidate,
    cost_projection: costProjection,
    source_pins: SOURCE_PINS,
    effective_defaults: "UNKNOWN" as const,
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    provider_acceptance: "UNPROVEN" as const,
    coverage_gaps: COVERAGE_GAPS,
  });
}

/** Returns the two pinned C396 cost keys only; this is not a live quote or dispatch payload. */
export function normalizeOwnerWan25I2vCostParameters(input: unknown): OwnerWan25I2vCostParameters {
  const { intent } = normalizeOwnerWan25I2vGenerationParameters(input);
  return Object.freeze({
    keys: SOURCE_CONTRACT.cost_projection.keys,
    values: Object.freeze({ resolution: intent.parameters.resolution, video_duration: intent.parameters.video_duration }),
    confidence: "PINNED_C396_METADATA_NOT_CURRENT_QUOTE" as const,
  });
}

function exactRecord(value: unknown, requiredKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
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
function isOneOf<T extends string | number>(value: unknown, values: readonly T[]): value is T {
  return (typeof value === "string" || typeof value === "number") && values.includes(value as T);
}
function isAspectRatio(resolution: unknown, aspectRatio: unknown): aspectRatio is OwnerWan25I2vGenerationAspectRatio {
  if (resolution === "480P") return isOneOf(aspectRatio, RATIOS_480P);
  if (resolution === "720P" || resolution === "1080P") return isOneOf(aspectRatio, RATIOS_OTHER);
  return false;
}
function isSeed(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SEED);
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
function invalid(): never { throw new OwnerWan25I2vGenerationParametersError(); }
