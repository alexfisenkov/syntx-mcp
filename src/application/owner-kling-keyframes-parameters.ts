import { types } from "node:util";

const MODEL_ID = "kling_keyframes" as const;
const VERSIONS = Object.freeze(["1.5", "1.6", "2.1", "2.5", "2.6", "3.0"] as const);
const MODES = Object.freeze(["standart", "hd", "4K"] as const);
const STANDARD_DURATIONS = Object.freeze([5, 10] as const);
const LONG_DURATIONS = Object.freeze(Array.from({ length: 13 }, (_, index) => index + 3));
const ASPECT_RATIOS = Object.freeze(["16:9", "1:1", "9:16"] as const);
const INPUT_KEYS = Object.freeze([
  "model_id", "version", "mode", "video_duration", "native_audio", "aspect_ratio"
] as const);

export const OWNER_KLING_KEYFRAMES_SOURCE_PINS = Object.freeze({
  form_module: "kling.js",
  form_build_id: "1791904852",
  form_bytes: 32_012,
  form_sha256: "sha256:cdd5e9db14f57c901484c1bef541ba0b3fdd4d13153b990bd1f0edce1b3a5614"
} as const);

const SOURCE = Object.freeze({
  status: "CURRENT_1791904852_STATIC_KEYFRAMES_SOURCE_PARAMETERS_ONLY" as const,
  model_id: MODEL_ID,
  operation_id: "generate-video" as const,
  ai_name: "kling" as const,
  source_pins: OWNER_KLING_KEYFRAMES_SOURCE_PINS,
  controls: Object.freeze({
    version: Object.freeze({
      values: VERSIONS,
      current_option_2_5: "ENABLED" as const,
      cached_2_5_turbo: "DISTINCT_UNPROVEN_ALIAS" as const,
      cached_2_5_turbo_rejected: true as const,
      effective_default: "UNKNOWN" as const
    }),
    mode: Object.freeze({
      values: MODES,
      standart_versions: Object.freeze(["3.0"] as const),
      hd_versions: VERSIONS,
      four_k_versions: Object.freeze(["3.0"] as const),
      effective_default: "UNKNOWN" as const
    }),
    video_duration: Object.freeze({
      standard_values: STANDARD_DURATIONS,
      standard_versions: Object.freeze(["1.5", "1.6", "2.1", "2.5", "2.6"] as const),
      version_3_values: LONG_DURATIONS,
      version_3: "3.0" as const,
      unit: "INTEGER_SECONDS" as const,
      effective_default: "UNKNOWN" as const
    }),
    native_audio: Object.freeze({
      values: Object.freeze([false, true] as const),
      true_versions: Object.freeze(["3.0"] as const),
      hidden_stored_old_value: "NOT_NORMALIZED_OR_ASSUMED_ABSENT" as const,
      effective_default: "UNKNOWN" as const
    }),
    temperature: Object.freeze({
      required: true as const,
      min: 0 as const,
      max: 1 as const,
      step: 0.1 as const,
      hidden_versions: Object.freeze(["3.0"] as const),
      hidden_explicit_value: "PRESERVE" as const,
      effective_default: "UNKNOWN" as const
    }),
    multi_shots: Object.freeze({
      required_version: "3.0" as const,
      accepted_values: Object.freeze([false, true] as const),
      other_versions: "MUST_BE_ABSENT" as const,
      prompt: "SEPARATE_FUTURE_RESPONSIBILITY" as const
    }),
    aspect_ratio: Object.freeze({
      local_projection_values: Object.freeze([...ASPECT_RATIOS, null] as const),
      requirement: "EXPLICIT_CALLER_CHOICE" as const,
      null_projection: "OMIT" as const,
      visible_control: "HIDDEN" as const,
      effective_cache: "UNKNOWN" as const,
      provider_compatibility: "UNPROVEN" as const,
      initializer_value: "16:9" as const,
      initializer_is_default: false as const
    }),
    camera_movement: Object.freeze({
      applicable_versions: Object.freeze(["1.5"] as const),
      applicable_modes: Object.freeze(["hd"] as const),
      representation: "FLAT_SIX_AXIS_OBJECT" as const,
      axes: Object.freeze(["horizontal", "vertical", "zoom", "tilt", "pan", "roll"] as const),
      single_axis_types: Object.freeze(["horizontal", "vertical", "zoom", "tilt", "pan", "roll"] as const),
      preset_values: Object.freeze({
        down_back: Object.freeze({ vertical: -10, zoom: -10 }),
        forward_up: Object.freeze({ vertical: 10, zoom: 10 }),
        right_turn_forward: Object.freeze({ zoom: 10, pan: -10 }),
        left_turn_forward: Object.freeze({ zoom: 10, pan: 10 })
      }),
      active_axis_min: -10 as const,
      active_axis_max: 10 as const,
      active_axis_step: 0.1 as const,
      omission: "UI_RANDOM_OMITS_CAMERA_MOVEMENT" as const
    })
  }),
  settings: Object.freeze({
    template_keys: Object.freeze([
      "model_type", "version", "mode", "video_duration", "native_audio", "temperature",
      "aspect_ratio", "camera_movement", "multi_shots"
    ] as const),
    aspect_ratio_projection: "EXPLICIT_LOCAL_POLICY_NOT_UI_CACHE_OR_PROVIDER_PROOF" as const,
    cache_state: "UNKNOWN" as const,
    unknown_values: Object.freeze(["effective_defaults", "effective_cached_aspect_ratio"] as const)
  }),
  references: Object.freeze({
    requirement: "SEPARATE_FUTURE_REFERENCE_PREPARER" as const,
    caller_urls_accepted: false as const,
    file_urls_projected: false as const
  }),
  cost_projection: Object.freeze({
    source: "B066_CURRENT_COST_HELPER_SETTINGS_KEYS_ONLY" as const,
    declared_keys: Object.freeze(["version", "mode", "video_duration", "native_audio"] as const),
    value_binding: "EXPLICIT_NORMALIZED_SETTINGS_VALUES" as const,
    quote_or_amount: "UNPROVEN" as const
  }),
  effective_defaults: "UNKNOWN" as const,
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export type OwnerKlingKeyframesVersion = typeof VERSIONS[number];
export type OwnerKlingKeyframesMode = typeof MODES[number];
export type OwnerKlingKeyframesAspectRatio = typeof ASPECT_RATIOS[number] | null;

export interface OwnerKlingKeyframesParametersSource {
  readonly status: typeof SOURCE.status;
  readonly model_id: typeof MODEL_ID;
  readonly operation_id: typeof SOURCE.operation_id;
  readonly ai_name: typeof SOURCE.ai_name;
  readonly source_pins: typeof OWNER_KLING_KEYFRAMES_SOURCE_PINS;
  readonly controls: typeof SOURCE.controls;
  readonly settings: typeof SOURCE.settings;
  readonly references: typeof SOURCE.references;
  readonly cost_projection: typeof SOURCE.cost_projection;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerKlingKeyframesNormalizedParameters {
  readonly status: "SOURCE_REVIEWED_EXPLICIT_INTENT";
  readonly source_pins: typeof OWNER_KLING_KEYFRAMES_SOURCE_PINS;
  readonly intent: Readonly<{
    model_id: typeof MODEL_ID;
    version: OwnerKlingKeyframesVersion;
    mode: OwnerKlingKeyframesMode;
    video_duration: number;
    native_audio: boolean;
    aspect_ratio: OwnerKlingKeyframesAspectRatio;
  }>;
  readonly cost_query_candidate: Readonly<{
    keys: typeof SOURCE.cost_projection.declared_keys;
    values: Readonly<{
      version: OwnerKlingKeyframesVersion;
      mode: OwnerKlingKeyframesMode;
      video_duration: number;
      native_audio: boolean;
    }>;
    amount_or_quote: "UNPROVEN";
  }>;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export type OwnerKlingKeyframesParametersErrorCode = "INVALID_PARAMETERS";

export class OwnerKlingKeyframesParametersError extends Error {
  constructor(readonly code: OwnerKlingKeyframesParametersErrorCode) {
    super("Kling Keyframes parameters are invalid.");
    this.name = "OwnerKlingKeyframesParametersError";
  }
}

/** Immutable source facts and explicit local intent policy; no provider or dispatch authority. */
export function getOwnerKlingKeyframesParametersSource(): OwnerKlingKeyframesParametersSource {
  return SOURCE;
}

/** Accepts only explicit, closed Keyframes intent. It does not resolve references or prompts. */
export function normalizeOwnerKlingKeyframesParameters(input: unknown): OwnerKlingKeyframesNormalizedParameters {
  const fields = exactRecord(input, INPUT_KEYS);
  if (fields.model_id !== MODEL_ID || typeof fields.version !== "string" ||
      !VERSIONS.includes(fields.version as OwnerKlingKeyframesVersion) || typeof fields.mode !== "string" ||
      !MODES.includes(fields.mode as OwnerKlingKeyframesMode) || !Number.isSafeInteger(fields.video_duration) ||
      typeof fields.native_audio !== "boolean" ||
      !(fields.aspect_ratio === null || (typeof fields.aspect_ratio === "string" &&
        ASPECT_RATIOS.includes(fields.aspect_ratio as typeof ASPECT_RATIOS[number])))) invalid();

  const version = fields.version as OwnerKlingKeyframesVersion;
  const mode = fields.mode as OwnerKlingKeyframesMode;
  const videoDuration = fields.video_duration as number;
  if ((mode === "standart" && version !== "3.0") || (mode === "4K" && version !== "3.0") ||
      (version === "3.0" ? !LONG_DURATIONS.includes(videoDuration) : !STANDARD_DURATIONS.some((duration) => duration === videoDuration)) ||
      (fields.native_audio === true && version !== "3.0")) invalid();

  return Object.freeze({
    status: "SOURCE_REVIEWED_EXPLICIT_INTENT" as const,
    source_pins: OWNER_KLING_KEYFRAMES_SOURCE_PINS,
    intent: Object.freeze({
      model_id: MODEL_ID,
      version,
      mode,
      video_duration: videoDuration,
      native_audio: fields.native_audio,
      aspect_ratio: fields.aspect_ratio as OwnerKlingKeyframesAspectRatio
    }),
    cost_query_candidate: Object.freeze({
      keys: SOURCE.cost_projection.declared_keys,
      values: Object.freeze({ version, mode, video_duration: videoDuration, native_audio: fields.native_audio }),
      amount_or_quote: "UNPROVEN" as const
    }),
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return invalid();
  }
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
        descriptors[key as string]?.enumerable !== true || !Object.hasOwn(descriptors[key as string]!, "value"))) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}

function invalid(): never { throw new OwnerKlingKeyframesParametersError("INVALID_PARAMETERS"); }
