import { types } from "node:util";

export type OwnerWan26R2vGenerationModelId = "wan_26_r2v" | "wan_26_r2v_flash";
export type OwnerWan26R2vGenerationResolution = "720P" | "1080P";
export type OwnerWan26R2vGenerationAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

interface OwnerWan26R2vGenerationParametersCommon {
  readonly resolution: OwnerWan26R2vGenerationResolution;
  readonly aspect_ratio: OwnerWan26R2vGenerationAspectRatio;
  readonly video_duration: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  readonly seed: number | null;
}

export type OwnerWan26R2vGenerationParameters =
  | (OwnerWan26R2vGenerationParametersCommon & Readonly<{ native_audio?: never }>)
  | (OwnerWan26R2vGenerationParametersCommon & Readonly<{ native_audio: boolean }>);

export type OwnerWan26R2vGenerationIntent =
  | Readonly<{
  model_id: "wan_26_r2v";
  prompt: string;
  parameters: OwnerWan26R2vGenerationParametersCommon & Readonly<{ native_audio?: never }>;
}>
  | Readonly<{
  model_id: "wan_26_r2v_flash";
  prompt: string;
  parameters: OwnerWan26R2vGenerationParametersCommon & Readonly<{ native_audio: boolean }>;
}>;

const MODEL_IDS = Object.freeze(["wan_26_r2v", "wan_26_r2v_flash"] as const);
const RESOLUTIONS = Object.freeze(["720P", "1080P"] as const);
const ASPECT_RATIOS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"] as const);
const VIDEO_DURATIONS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10] as const);
const MAX_SEED = 2_147_483_647;
const MAX_PROMPT_LENGTH = 1_500;

const SOURCE_PINS = Object.freeze({
  public_catalog_version: "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json",
  public_catalog_fetched_at: "2026-10-15T07:17:24.901Z",
  public_models_sha256: "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a",
  files_mention: true,
  form_build_id: "1791904852",
  form_module_bytes: 19_503,
  form_module_sha256: "sha256:f69db3d449d0051969def2229ed936d9835e0d65c8f257ec3ab289d6e9387737",
  video_script_module_bytes: 8_689,
  video_script_module_sha256: "sha256:5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e",
  new_session_helper_module_bytes: 1_906,
  new_session_helper_module_sha256: "sha256:dda0cd67d1a152a5d341d3b816493cd7ed8fb5db0aad5c97fe76465940b0aadb",
  seed_helper_module_bytes: 1_656,
  seed_helper_module_sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b",
  seed_helper_freshness: "PRIOR_PINNED_NOT_FRESH"
} as const);

const COVERAGE_GAPS = Object.freeze([
  "EFFECTIVE_UI_DEFAULTS_NOT_ESTABLISHED",
  "CURRENT_CATALOG_NOT_ESTABLISHED",
  "CURRENT_QUOTE_NOT_ESTABLISHED",
  "REGULAR_NATIVE_AUDIO_WIRE_BEHAVIOR_NOT_ESTABLISHED",
  "REFERENCE_ROLE_ORDER_AND_CARDINALITY_NOT_ESTABLISHED",
  "SELECTED_VIDEO_LIMIT_METRIC_NOT_ESTABLISHED",
  "SELECTED_DURATION_ROUNDING_NOT_ESTABLISHED",
  "COST_DURATION_WIRE_MAPPING_NOT_ESTABLISHED",
  "PROVIDER_ACCEPTANCE_NOT_ESTABLISHED"
] as const);

const SOURCE_CONTRACT = Object.freeze({
  status: "PINNED_SOURCE_LOCAL_PARAMETER_CONTRACT" as const,
  model_ids: MODEL_IDS,
  source_pins: SOURCE_PINS,
  controls: Object.freeze({
    resolution: RESOLUTIONS,
    aspect_ratio: ASPECT_RATIOS,
    video_duration: Object.freeze({ values: VIDEO_DURATIONS, unit: "INTEGER_SECONDS" as const }),
    seed: Object.freeze({ nullable: true, minimum: 0, maximum: MAX_SEED, precision: 0,
      source: "PRIOR_PINNED_HELPER_NOT_FRESH_UI_PROOF" as const }),
    native_audio: Object.freeze({
      wan_26_r2v: "NO_CURRENT_UI_CONTROL_OBSERVED_WIRE_BEHAVIOR_UNKNOWN" as const,
      wan_26_r2v_flash: "EXPLICIT_BOOLEAN_UI_SWITCH" as const
    })
  }),
  reference_input: Object.freeze({
    requirement: "AT_LEAST_ONE_IMAGE_OR_VIDEO" as const,
    audio_only: "NOT_SUFFICIENT" as const,
    upload_admission_and_typed_roles: "NOT_ESTABLISHED" as const
  }),
  prompt_limit: Object.freeze({
    maximum_length: MAX_PROMPT_LENGTH,
    source: "PINNED_C396_CATALOG_METADATA_NOT_CURRENT_UI_ACCEPTANCE" as const,
    empty_prompt: "PRESERVED_EXPLICITLY_NOT_PROVIDER_ACCEPTANCE" as const
  }),
  cost_projection: Object.freeze({
    source: "PINNED_C396_METADATA_NOT_CURRENT_QUOTE" as const,
    keys_by_model: Object.freeze({
      wan_26_r2v: Object.freeze(["resolution", "video_duration", "duration"] as const),
      wan_26_r2v_flash: Object.freeze(["resolution", "video_duration", "duration", "native_audio"] as const)
    }),
    values: "NOT_PROJECTED_PENDING_SOURCE_METRIC_AND_ROUNDING_PROOF" as const,
    current_quote: "UNKNOWN" as const
  }),
  effective_defaults: "UNKNOWN" as const,
  provider_acceptance: "UNPROVEN" as const,
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  coverage_gaps: COVERAGE_GAPS
});

export type OwnerWan26R2vGenerationParametersSource = typeof SOURCE_CONTRACT;
export type OwnerWan26R2vGenerationParametersNormalized = Readonly<{
  status: "EXPLICIT_LOCAL_PARAMETERS_NORMALIZED";
  intent: OwnerWan26R2vGenerationIntent;
  source_pins: typeof SOURCE_PINS;
  effective_defaults: "UNKNOWN";
  coverage_gaps: typeof COVERAGE_GAPS;
  runtime_usable: false;
  dispatch_allowed: false;
}>;
export type OwnerWan26R2vCostParameters = Readonly<{
  keys: readonly ("resolution" | "video_duration" | "duration" | "native_audio")[];
  values: "NOT_PROJECTED_PENDING_SOURCE_METRIC_AND_ROUNDING_PROOF";
  current_quote: "UNKNOWN";
  confidence: "PINNED_C396_METADATA_NOT_CURRENT_QUOTE";
}>;

export class OwnerWan26R2vGenerationParametersError extends Error {
  readonly code = "INVALID_PARAMETERS" as const;
  constructor() {
    super("WAN 2.6 R2V explicit parameters are invalid.");
    this.name = "OwnerWan26R2vGenerationParametersError";
  }
}

/** Returns pinned UI/catalog observations and remaining gaps; this source contract is not dispatch authority. */
export function getOwnerWan26R2vGenerationParametersSource(): OwnerWan26R2vGenerationParametersSource {
  return SOURCE_CONTRACT;
}

/** Normalizes only explicit local parameters; it does not validate reference uploads or authorize generation. */
export function normalizeOwnerWan26R2vGenerationParameters(input: unknown): OwnerWan26R2vGenerationParametersNormalized {
  const request = exactRecord(input, ["model_id", "prompt", "parameters"]);
  if (!isModelId(request.model_id) || typeof request.prompt !== "string" ||
      request.prompt.length > MAX_PROMPT_LENGTH || !isWellFormedUnicode(request.prompt)) invalid();

  const parameterKeys = request.model_id === "wan_26_r2v"
    ? ["resolution", "aspect_ratio", "video_duration", "seed"]
    : ["resolution", "aspect_ratio", "video_duration", "seed", "native_audio"];
  const raw = exactRecord(request.parameters, parameterKeys);
  if (!isOneOf(raw.resolution, RESOLUTIONS) || !isOneOf(raw.aspect_ratio, ASPECT_RATIOS) ||
      !isOneOf(raw.video_duration, VIDEO_DURATIONS) ||
      !(raw.seed === null || (Number.isSafeInteger(raw.seed) && (raw.seed as number) >= 0 && (raw.seed as number) <= MAX_SEED)) ||
      (request.model_id === "wan_26_r2v_flash" && typeof raw.native_audio !== "boolean")) invalid();

  const common = {
    resolution: raw.resolution as OwnerWan26R2vGenerationResolution,
    aspect_ratio: raw.aspect_ratio as OwnerWan26R2vGenerationAspectRatio,
    video_duration: raw.video_duration as OwnerWan26R2vGenerationParameters["video_duration"],
    seed: raw.seed as number | null
  };
  const intent: OwnerWan26R2vGenerationIntent = request.model_id === "wan_26_r2v"
    ? Object.freeze({ model_id: "wan_26_r2v", prompt: request.prompt, parameters: Object.freeze(common) })
    : Object.freeze({ model_id: "wan_26_r2v_flash", prompt: request.prompt,
      parameters: Object.freeze({ ...common, native_audio: raw.native_audio as boolean }) });
  return Object.freeze({
    status: "EXPLICIT_LOCAL_PARAMETERS_NORMALIZED" as const,
    intent,
    source_pins: SOURCE_PINS,
    effective_defaults: "UNKNOWN" as const,
    coverage_gaps: COVERAGE_GAPS,
    runtime_usable: false as const,
    dispatch_allowed: false as const
  });
}

/** Returns pinned catalog cost-key metadata only; duration values and live quote amounts are not inferred. */
export function normalizeOwnerWan26R2vCostParameters(input: unknown): OwnerWan26R2vCostParameters {
  const { intent } = normalizeOwnerWan26R2vGenerationParameters(input);
  return Object.freeze({
    keys: intent.model_id === "wan_26_r2v"
      ? SOURCE_CONTRACT.cost_projection.keys_by_model.wan_26_r2v
      : SOURCE_CONTRACT.cost_projection.keys_by_model.wan_26_r2v_flash,
    values: "NOT_PROJECTED_PENDING_SOURCE_METRIC_AND_ROUNDING_PROOF" as const,
    current_quote: "UNKNOWN" as const,
    confidence: "PINNED_C396_METADATA_NOT_CURRENT_QUOTE" as const
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

function isModelId(value: unknown): value is OwnerWan26R2vGenerationModelId {
  return typeof value === "string" && MODEL_IDS.includes(value as OwnerWan26R2vGenerationModelId);
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
function invalid(): never { throw new OwnerWan26R2vGenerationParametersError(); }
