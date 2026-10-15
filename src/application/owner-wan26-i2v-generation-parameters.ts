import { types } from "node:util";

const MODEL_IDS = Object.freeze(["wan_26_i2v", "wan_26_i2v_flash"] as const);
const RESOLUTIONS = Object.freeze(["720P", "1080P"] as const);
const ASPECT_RATIOS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"] as const);
const MAX_PROMPT_LENGTH = 1_500;
const MAX_SEED = 2_147_483_647;

export type OwnerWan26I2vGenerationModelId = typeof MODEL_IDS[number];
export type OwnerWan26I2vGenerationResolution = typeof RESOLUTIONS[number];
export type OwnerWan26I2vGenerationAspectRatio = typeof ASPECT_RATIOS[number];

export interface OwnerWan26I2vGenerationParametersCommon {
  readonly resolution: OwnerWan26I2vGenerationResolution;
  readonly aspect_ratio: OwnerWan26I2vGenerationAspectRatio;
  readonly video_duration: number;
  readonly prompt_extend: boolean;
  readonly seed: number | null;
}
export type OwnerWan26I2vGenerationIntent =
  | Readonly<{ model_id: "wan_26_i2v"; prompt: string; parameters: Readonly<OwnerWan26I2vGenerationParametersCommon & { native_audio: false }> }>
  | Readonly<{ model_id: "wan_26_i2v_flash"; prompt: string; parameters: Readonly<OwnerWan26I2vGenerationParametersCommon & { native_audio: boolean }> }>;
export interface OwnerWan26I2vGenerationParametersInput {
  readonly model_id: OwnerWan26I2vGenerationModelId;
  readonly prompt: string;
  readonly parameters: OwnerWan26I2vGenerationParametersCommon & { readonly native_audio: boolean };
}

const SOURCE_PINS = Object.freeze({
  public_catalog_version: "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json",
  public_catalog_fetched_at: "2026-10-15T07:17:24.901Z",
  public_models_sha256: "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a",
  files_mention: false,
  form_build_id: "1791904852",
  form_module: "wan-video.js",
  form_bytes: 19_503,
  form_sha256: "sha256:f69db3d449d0051969def2229ed936d9835e0d65c8f257ec3ab289d6e9387737",
  video_script_module: "video.js",
  video_script_bytes: 8_689,
  video_script_sha256: "sha256:5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e",
  new_session_helper_module: "NewSessionButton.js",
  new_session_helper_bytes: 1_906,
  new_session_helper_sha256: "sha256:dda0cd67d1a152a5d341d3b816493cd7ed8fb5db0aad5c97fe76465940b0aadb",
  seed_helper_bytes: 1_656,
  seed_helper_sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b",
  seed_helper_freshness: "PRIOR_PINNED_NOT_FRESH"
} as const);
const COVERAGE_GAPS = Object.freeze([
  "CURRENT_CATALOG_NOT_ESTABLISHED",
  "CURRENT_QUOTE_NOT_ESTABLISHED",
  "EFFECTIVE_UI_DEFAULTS_NOT_ESTABLISHED",
  "PROVIDER_ACCEPTANCE_NOT_ESTABLISHED"
] as const);
const SOURCE_CONTRACT = Object.freeze({
  status: "PINNED_SOURCE_LOCAL_PARAMETER_CONTRACT" as const,
  model_ids: MODEL_IDS,
  source_pins: SOURCE_PINS,
  models: Object.freeze([
    Object.freeze({ model_id: "wan_26_i2v" as const, native_audio: "FIXED_FALSE" as const }),
    Object.freeze({ model_id: "wan_26_i2v_flash" as const, native_audio: "EXPLICIT_BOOLEAN" as const })
  ]),
  controls: Object.freeze({
    resolution: RESOLUTIONS,
    aspect_ratio: ASPECT_RATIOS,
    video_duration: Object.freeze({ minimum: 2, maximum: 15, unit: "INTEGER_SECONDS" as const }),
    prompt_extend: "BOOLEAN" as const,
    seed: Object.freeze({ nullable: true, minimum: 0, maximum: MAX_SEED, precision: 0 })
  }),
  prompt_limit: Object.freeze({
    maximum_length: MAX_PROMPT_LENGTH,
    source: "HISTORICAL_B066_LOCAL_GUARD_NOT_CURRENT_UI_LIMIT" as const,
    empty_prompt: "PRESERVED_EXPLICITLY_NOT_PROVIDER_ACCEPTANCE" as const
  }),
  wire_facts: Object.freeze({
    fixed_fields: Object.freeze({ shot_type: "single" as const, audio_setting: "auto" as const }),
    fixed_fields_source: "PINNED_CONDITIONAL_VISIBILITY_RESET_METADATA_ONLY" as const,
    duration: "OMITTED_FROM_FINAL_SETTINGS" as const,
    video_duration: "EXPLICIT_OUTPUT_LENGTH_PRESERVED" as const
  }),
  cost_projection: Object.freeze({
    source: "PINNED_C396_METADATA_NOT_CURRENT_QUOTE" as const,
    keys_by_model: Object.freeze({
      wan_26_i2v: Object.freeze(["resolution", "video_duration"] as const),
      wan_26_i2v_flash: Object.freeze(["resolution", "video_duration", "native_audio"] as const)
    }),
    current_quote: "UNKNOWN" as const
  }),
  effective_defaults: "UNKNOWN" as const,
  current_catalog_status: "UNKNOWN" as const,
  current_quote_status: "UNKNOWN" as const,
  provider_acceptance: "UNPROVEN" as const,
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  coverage_gaps: COVERAGE_GAPS
});

export type OwnerWan26I2vGenerationParametersSource = typeof SOURCE_CONTRACT;
export type OwnerWan26I2vGenerationParametersNormalized = Readonly<{
  status: "EXPLICIT_LOCAL_PARAMETERS_NORMALIZED";
  intent: OwnerWan26I2vGenerationIntent;
  source_pins: typeof SOURCE_PINS;
  effective_defaults: "UNKNOWN";
  coverage_gaps: typeof COVERAGE_GAPS;
}>;
export type OwnerWan26I2vCostParameters = Readonly<{
  keys: readonly ("resolution" | "video_duration" | "native_audio")[];
  values: Readonly<{ resolution: OwnerWan26I2vGenerationResolution; video_duration: number; native_audio?: boolean }>;
  confidence: "PINNED_C396_METADATA_NOT_CURRENT_QUOTE";
}>;

export class OwnerWan26I2vGenerationParametersError extends Error {
  readonly code = "INVALID_PARAMETERS" as const;
  constructor() {
    super("WAN 2.6 I2V explicit parameters are invalid.");
    this.name = "OwnerWan26I2vGenerationParametersError";
  }
}

/** Returns the pinned static control contract and explicit evidence gaps; it does not establish effective defaults or dispatch authority. */
export function getOwnerWan26I2vGenerationParametersSource(): OwnerWan26I2vGenerationParametersSource {
  return SOURCE_CONTRACT;
}

/** Normalizes only a complete explicit local intent; it creates no provider settings, URLs, or generation authority. */
export function normalizeOwnerWan26I2vGenerationParameters(input: unknown): OwnerWan26I2vGenerationParametersNormalized {
  const request = exactRecord(input, ["model_id", "prompt", "parameters"]);
  if (!isModelId(request.model_id) || typeof request.prompt !== "string" ||
      request.prompt.length > MAX_PROMPT_LENGTH || !isWellFormedUnicode(request.prompt)) invalid();
  const raw = exactRecord(request.parameters, ["resolution", "aspect_ratio", "video_duration", "prompt_extend", "seed", "native_audio"]);
  if (!isOneOf(raw.resolution, RESOLUTIONS) || !isOneOf(raw.aspect_ratio, ASPECT_RATIOS) ||
      !Number.isSafeInteger(raw.video_duration) || (raw.video_duration as number) < 2 || (raw.video_duration as number) > 15 ||
      typeof raw.prompt_extend !== "boolean" || !(raw.seed === null || (Number.isSafeInteger(raw.seed) &&
        (raw.seed as number) >= 0 && (raw.seed as number) <= MAX_SEED))) invalid();
  if (request.model_id === "wan_26_i2v" ? raw.native_audio !== false : typeof raw.native_audio !== "boolean") invalid();
  const parameters = Object.freeze({
    resolution: raw.resolution as OwnerWan26I2vGenerationResolution,
    aspect_ratio: raw.aspect_ratio as OwnerWan26I2vGenerationAspectRatio,
    video_duration: raw.video_duration as number,
    prompt_extend: raw.prompt_extend,
    seed: raw.seed as number | null,
    native_audio: raw.native_audio as boolean
  });
  const intent = Object.freeze({
    model_id: request.model_id,
    prompt: request.prompt,
    parameters
  }) as OwnerWan26I2vGenerationIntent;
  return Object.freeze({
    status: "EXPLICIT_LOCAL_PARAMETERS_NORMALIZED" as const,
    intent,
    source_pins: SOURCE_PINS,
    effective_defaults: "UNKNOWN" as const,
    coverage_gaps: COVERAGE_GAPS
  });
}

/** Returns only historical cost-key/value metadata; it is not a live quote or dispatch payload. */
export function normalizeOwnerWan26I2vCostParameters(input: unknown): OwnerWan26I2vCostParameters {
  const { intent } = normalizeOwnerWan26I2vGenerationParameters(input);
  if (intent.model_id === "wan_26_i2v") {
    return Object.freeze({
      keys: SOURCE_CONTRACT.cost_projection.keys_by_model.wan_26_i2v,
      values: Object.freeze({ resolution: intent.parameters.resolution, video_duration: intent.parameters.video_duration }),
      confidence: "PINNED_C396_METADATA_NOT_CURRENT_QUOTE" as const
    });
  }
  return Object.freeze({
    keys: SOURCE_CONTRACT.cost_projection.keys_by_model.wan_26_i2v_flash,
    values: Object.freeze({ resolution: intent.parameters.resolution, video_duration: intent.parameters.video_duration,
      native_audio: intent.parameters.native_audio }),
    confidence: "PINNED_C396_METADATA_NOT_CURRENT_QUOTE" as const
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
function isModelId(value: unknown): value is OwnerWan26I2vGenerationModelId {
  return typeof value === "string" && MODEL_IDS.includes(value as OwnerWan26I2vGenerationModelId);
}
function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
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
function invalid(): never { throw new OwnerWan26I2vGenerationParametersError(); }
