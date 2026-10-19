import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";

const MODEL_IDS = Object.freeze(["4genfirstframeimage", "turbo4genfirstframeimage", "gen4.5i2v"] as const);
const LEGACY_MODEL_IDS = Object.freeze(["4genfirstframeimage", "turbo4genfirstframeimage"] as const);
const GEN45_MODEL_ID = "gen4.5i2v" as const;
const ASPECT_RATIOS = Object.freeze(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const);
const ASPECT_SOURCE_CODES: Readonly<Record<OwnerRunwayI2vAspectRatio, string>> = Object.freeze({
  "21:9": "219", "16:9": "169", "4:3": "43", "1:1": "11", "3:4": "34", "9:16": "916"
});
const VIDEO_DURATIONS = Object.freeze([5, 10] as const);
const LEGACY_VIDEO_DURATIONS = Object.freeze([5, 10] as const);
const GEN45_ASPECT_RATIOS = Object.freeze(["16:9"] as const);
const GEN45_VIDEO_DURATIONS = Object.freeze([5, 8, 10] as const);
const MAX_PROMPT_UTF16 = 1_000;

const SOURCE_FACTS = Object.freeze({
  profile_id: "owner-runway-i2v-source2339-gen45-v1",
  status: "STATIC_SOURCE_CONTRACT_NOT_RUNTIME_OR_PROVIDER_ACCEPTANCE" as const,
  form_id: "runway" as const,
  form_category: "video" as const,
  ai_name: "runway" as const,
  scope: "video" as const,
  model_ids: MODEL_IDS,
  legacy_model_ids: LEGACY_MODEL_IDS,
  gen45_model_id: GEN45_MODEL_ID,
  aspect_ratio_values: ASPECT_RATIOS,
  aspect_ratio_source_codes: ASPECT_SOURCE_CODES,
  video_duration_values: VIDEO_DURATIONS,
  video_duration_source_values: Object.freeze(["5.0", "10.0"] as const),
  model_controls: Object.freeze({
    legacy: Object.freeze({ aspect_ratios: ASPECT_RATIOS, video_durations: LEGACY_VIDEO_DURATIONS }),
    "gen4.5i2v": Object.freeze({ aspect_ratios: GEN45_ASPECT_RATIOS, video_durations: GEN45_VIDEO_DURATIONS,
      aspect_ratio_source_code: "169" as const, video_duration_source_values: Object.freeze(["5.0", "8.0", "10.0"] as const),
      max_file_size_catalog_value: 0 as const, max_file_size_semantics: "UNKNOWN" as const, cost_keys: Object.freeze(["video_duration"] as const) })
  }),
  form_initializer: Object.freeze({ video_duration: "5.0" as const, aspect_ratio: "1" as const, seed: null }),
  effective_defaults: "UNKNOWN" as const,
  prompt_limit: Object.freeze({ maximum_utf16_length: MAX_PROMPT_UTF16, scope: "CONSERVATIVE_LOCAL_BOUND_PUBLIC_MAXIMUM_UNIT_UNPROVEN" as const }),
  seed_policy: "EXPLICIT_NULL_ONLY_INITIAL_RESTRICTED_SLICE_SEMANTICS_UNPROVEN" as const,
  crop_requirement: "EXACTLY_ONE_CROPPED_FILE" as const,
  file_urls_projection: "NOT_INCLUDED" as const,
  dispatch_allowed: false as const,
  runtime_usable: false as const,
  backend_acceptance: "UNPROVEN" as const,
  source_pins: Object.freeze({
    form_build_id: "1792363638" as const,
    historical_observed_build_id: "1792156098" as const,
    form_module: "runway.js" as const,
    form_bytes: 19_785 as const,
    form_sha256: "sha256:975b82daca30bf02e5b0591373fcf6a944b25661a42ffaa4d039c2c1ab36cb91" as const,
    public_models_snapshot_sha256: "sha256:cb2581608a551f4bc783af85d2edd8cca6a926f8f84f41e3382885ba9a3cf054" as const,
    gen45_model_id: "gen4.5i2v" as const,
    gen45_file_count: 1 as const,
    gen45_uploadable_catalog_value: true as const,
    gen45_prompt_max_catalog_value: 1_000 as const,
    gen45_cost_keys: Object.freeze(["video_duration"] as const),
    video_parent_sha256: "sha256:8310cb1c9ac8221077220da873cfe785e35408b43b1cfba85d409272c9b44596" as const,
    video_store_sha256: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b" as const,
    reference_serializer_sha256: "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc" as const
  })
});

const SOURCE_PROFILE = Object.freeze({ ...SOURCE_FACTS, source_sha256: schemaHash(SOURCE_FACTS) });

export type OwnerRunwayI2vModelId = typeof MODEL_IDS[number];
export type OwnerRunwayI2vAspectRatio = typeof ASPECT_RATIOS[number];
export type OwnerRunwayI2vVideoDuration = 5 | 8 | 10;

export interface OwnerRunwayI2vParametersInput {
  readonly model_id: OwnerRunwayI2vModelId;
  readonly prompt: string;
  readonly aspect_ratio: OwnerRunwayI2vAspectRatio;
  readonly video_duration: OwnerRunwayI2vVideoDuration;
  readonly seed: null;
}

export interface OwnerRunwayI2vNormalizedParameters {
  readonly status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY";
  readonly intent: Readonly<OwnerRunwayI2vParametersInput>;
  readonly source_parameters: Readonly<{
    model_type: OwnerRunwayI2vModelId;
    aspect_ratio: string;
    video_duration: "5.0" | "8.0" | "10.0";
    seed: null;
  }>;
  readonly profile_sha256: string;
  readonly prompt_bound: "LOCAL_UTF16_BOUND_PUBLIC_MAXIMUM_PROVIDER_UNIT_UNPROVEN";
  readonly effective_defaults: "UNKNOWN";
  readonly crop_requirement: "EXACTLY_ONE_CROPPED_FILE";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerRunwayI2vParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("The owner Runway first-frame parameter selection is invalid.");
    this.name = "OwnerRunwayI2vParametersError";
  }
}

export function getOwnerRunwayI2vSourceProfile(): Readonly<typeof SOURCE_PROFILE> {
  return SOURCE_PROFILE;
}

/** Normalizes explicit UI choices to source values; it grants no dispatch authority. */
export function normalizeOwnerRunwayI2vParameters(input: unknown): Readonly<OwnerRunwayI2vNormalizedParameters> {
  const fields = exactRecord(input, ["model_id", "prompt", "aspect_ratio", "video_duration", "seed"]);
  if (!oneOf(fields.model_id, MODEL_IDS) || typeof fields.prompt !== "string" || fields.prompt.trim().length === 0 ||
      fields.prompt.length > MAX_PROMPT_UTF16 || !isWellFormedUnicode(fields.prompt) ||
      !isSupportedAspect(fields.model_id, fields.aspect_ratio) || !isSupportedDuration(fields.model_id, fields.video_duration) || fields.seed !== null) {
    invalidParameters();
  }
  const intent = Object.freeze({
    model_id: fields.model_id,
    prompt: fields.prompt,
    aspect_ratio: fields.aspect_ratio,
    video_duration: fields.video_duration,
    seed: null
  });
  const source_parameters = Object.freeze({
    model_type: fields.model_id,
    aspect_ratio: fields.model_id === GEN45_MODEL_ID ? "169" : ASPECT_SOURCE_CODES[fields.aspect_ratio],
    video_duration: sourceDuration(fields.video_duration),
    seed: null
  });
  return Object.freeze({
    status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY" as const,
    intent,
    source_parameters,
    profile_sha256: SOURCE_PROFILE.source_sha256,
    prompt_bound: "LOCAL_UTF16_BOUND_PUBLIC_MAXIMUM_PROVIDER_UNIT_UNPROVEN" as const,
    effective_defaults: "UNKNOWN" as const,
    crop_requirement: "EXACTLY_ONE_CROPPED_FILE" as const,
    dispatch_allowed: false as const,
    runtime_usable: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidParameters();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) =>
          typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) {
      invalidParameters();
    }
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch { return invalidParameters(); }
}

function oneOf<T extends string | number>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" || typeof value === "number" ? values.includes(value as T) : false;
}

export function isOwnerRunwayI2vAspectRatio(modelId: unknown, value: unknown): value is OwnerRunwayI2vAspectRatio {
  return isModelId(modelId) && isSupportedAspect(modelId, value);
}
export function isOwnerRunwayI2vVideoDuration(modelId: unknown, value: unknown): value is OwnerRunwayI2vVideoDuration {
  return isModelId(modelId) && isSupportedDuration(modelId, value);
}
function isSupportedAspect(modelId: OwnerRunwayI2vModelId, value: unknown): value is OwnerRunwayI2vAspectRatio {
  return modelId === GEN45_MODEL_ID ? value === "16:9" : oneOf(value, ASPECT_RATIOS);
}
function isSupportedDuration(modelId: OwnerRunwayI2vModelId, value: unknown): value is OwnerRunwayI2vVideoDuration {
  return modelId === GEN45_MODEL_ID ? oneOf(value, GEN45_VIDEO_DURATIONS) : oneOf(value, LEGACY_VIDEO_DURATIONS);
}
function isModelId(value: unknown): value is OwnerRunwayI2vModelId { return oneOf(value, MODEL_IDS); }
function sourceDuration(value: OwnerRunwayI2vVideoDuration): "5.0" | "8.0" | "10.0" {
  return value === 5 ? "5.0" : value === 8 ? "8.0" : "10.0";
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

function invalidParameters(): never {
  throw new OwnerRunwayI2vParametersError("INVALID_PARAMETERS");
}
