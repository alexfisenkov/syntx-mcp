import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";

export const OWNER_GROK_I2V_MODEL_IDS = Object.freeze(["grok_i2v", "grok_15_i2v"] as const);
export type OwnerGrokI2vModelId = typeof OWNER_GROK_I2V_MODEL_IDS[number];
const GROK_I2V_ASPECT_RATIOS = Object.freeze(["16:9"] as const);
const GROK_15_I2V_ASPECT_RATIOS = Object.freeze(["16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "1:1"] as const);
export type OwnerGrokI2vAspectRatio = typeof GROK_15_I2V_ASPECT_RATIOS[number];
const RESOLUTIONS = Object.freeze(["480p", "720p"] as const);
export type OwnerGrokI2vResolution = typeof RESOLUTIONS[number];
export type OwnerGrokI2vVideoDuration = number;
const PROMPT_UTF16_LIMITS: Readonly<Record<OwnerGrokI2vModelId, number>> = Object.freeze({
  grok_i2v: 5_000,
  grok_15_i2v: 2_000
});
const SOURCE_ASPECT_VALUES: Readonly<Record<OwnerGrokI2vModelId, readonly OwnerGrokI2vAspectRatio[]>> = Object.freeze({
  grok_i2v: GROK_I2V_ASPECT_RATIOS,
  grok_15_i2v: GROK_15_I2V_ASPECT_RATIOS
});

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const SOURCE_FACTS = deepFreeze({
  profile_id: "owner-grok-i2v-source-parameters-2280-v1",
  status: "STATIC_FORM_AND_PINNED_CATALOG_METADATA_ONLY" as const,
  source_pins: {
    form_build_id: "1792363638" as const,
    form_module: "grok-video.js" as const,
    form_sha256: "sha256:cc36221a4c696fb91b43166558800e2b1df18e49dcb3c06997b7cfeafb3c5159" as const,
    cost_module: "cost2.js" as const,
    cost_sha256: "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa" as const
  },
  public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const,
  form_id: "grok-video" as const,
  ai_name: "grok_video" as const,
  scope: "video" as const,
  model_ids: OWNER_GROK_I2V_MODEL_IDS,
  catalog_default_model_id: "grok_15_i2v" as const,
  controls: {
    aspect_ratio: {
      grok_i2v: { accepted_initial_slice: GROK_I2V_ASPECT_RATIOS, control_visibility: "HIDDEN_IN_SOURCE_FORM" as const,
        basis: "INITIAL_LOCAL_16_9_IMAGE_ONLY" as const },
      grok_15_i2v: { source_values: GROK_15_I2V_ASPECT_RATIOS }
    },
    video_duration: {
      grok_i2v: { values: Object.freeze([6, 10] as const) },
      grok_15_i2v: { minimum: 1 as const, maximum: 15 as const, integer_only: true as const }
    },
    resolution: { values: RESOLUTIONS, source_span: Object.freeze([5070, 5127] as const) },
    prompt: {
      maximum_utf16_length: PROMPT_UTF16_LIMITS,
      unit_confidence: "CONSERVATIVE_LOCAL_UTF16_BOUND_PUBLIC_MAXIMUM_PROVIDER_UNIT_UNPROVEN" as const
    },
    seed: "NOT_IN_EXPLICIT_REQUEST_SCHEMA" as const
  },
  initial_image_geometry_policy: {
    grok_i2v: { aspect_ratio: "16:9" as const, confidence: "RESTRICTED_INITIAL_LOCAL_SLICE_NOT_VISIBLE_CONTROL_OR_PROVIDER_PROOF" as const },
    grok_15_i2v: { aspect_ratio: "UNKNOWN" as const, confidence: "NOT_VALIDATED_BY_PARAMETER_NORMALIZER" as const }
  },
  initializer_candidates: { aspect_ratio: "16:9" as const, video_duration: 5 as const, resolution: "480p" as const },
  defaults_confidence: "INITIALIZER_CANDIDATES_NOT_EFFECTIVE_DEFAULTS" as const,
  effective_defaults: "UNKNOWN" as const,
  image_input_metadata: {
    grok_i2v: { public_file_count_limit: 1 as const, public_media_type: "images" as const, upload_permission: false as const },
    grok_15_i2v: { public_file_count_limit: 1 as const, public_media_type: "images" as const, upload_permission: false as const }
  },
  input_binding_confidence: "PUBLIC_IMAGE_CARDINALITY_METADATA_ONLY_NOT_NATIVE_UPLOAD_OR_ROLE_PROOF" as const,
  cost_query_keys: Object.freeze(["resolution", "video_duration"] as const),
  source_mapping_confidence: "STATIC_SOURCE_PARAMETERS_NOT_WIRE_OR_RUNTIME_PROOF" as const,
  dispatch_allowed: false as const,
  runtime_usable: false as const,
  backend_acceptance: "UNPROVEN" as const
});
const SOURCE_PROFILE = deepFreeze({ ...SOURCE_FACTS, source_sha256: schemaHash(SOURCE_FACTS) });

export interface OwnerGrokI2vParametersInput {
  readonly model_id: OwnerGrokI2vModelId;
  readonly prompt: string;
  readonly aspect_ratio: OwnerGrokI2vAspectRatio;
  readonly video_duration: OwnerGrokI2vVideoDuration;
  readonly resolution: OwnerGrokI2vResolution;
}
export interface OwnerGrokI2vNormalizedParameters {
  readonly status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY";
  readonly intent: Readonly<OwnerGrokI2vParametersInput>;
  readonly source_parameters: Readonly<{
    model_type: OwnerGrokI2vModelId;
    aspect_ratio: OwnerGrokI2vAspectRatio;
    video_duration: number;
    resolution: OwnerGrokI2vResolution;
  }>;
  readonly profile_sha256: string;
  readonly prompt_bound: "LOCAL_UTF16_BOUND_PUBLIC_MAXIMUM_PROVIDER_UNIT_UNPROVEN";
  readonly prompt_maximum_utf16_length: number;
  readonly effective_defaults: "UNKNOWN";
  readonly input_binding_confidence: "PUBLIC_IMAGE_CARDINALITY_METADATA_ONLY_NOT_NATIVE_UPLOAD_OR_ROLE_PROOF";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerGrokI2vParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Grok I2V parameters are invalid.");
    this.name = "OwnerGrokI2vParametersError";
  }
}

export function getOwnerGrokI2vSourceProfile(): DeepReadonly<typeof SOURCE_PROFILE> {
  return SOURCE_PROFILE;
}

/** Normalizes only explicit controls; initializer candidates are never injected as defaults. */
export function normalizeOwnerGrokI2vParameters(input: unknown): Readonly<OwnerGrokI2vNormalizedParameters> {
  const fields = exactRecord(input, ["model_id", "prompt", "aspect_ratio", "video_duration", "resolution"]);
  if (!isModelId(fields.model_id)) invalid();
  const modelId = fields.model_id;
  if (typeof fields.prompt !== "string" || fields.prompt.trim().length === 0 ||
      !isWellFormedUnicode(fields.prompt) || fields.prompt.length > PROMPT_UTF16_LIMITS[modelId] ||
      !oneOf(fields.aspect_ratio, SOURCE_ASPECT_VALUES[modelId]) ||
      !isDuration(modelId, fields.video_duration) || !oneOf(fields.resolution, RESOLUTIONS)) invalid();

  const intent = Object.freeze({
    model_id: modelId,
    prompt: fields.prompt,
    aspect_ratio: fields.aspect_ratio,
    video_duration: fields.video_duration as number,
    resolution: fields.resolution
  });
  const source_parameters = Object.freeze({
    model_type: modelId,
    aspect_ratio: fields.aspect_ratio,
    video_duration: fields.video_duration as number,
    resolution: fields.resolution
  });
  return Object.freeze({
    status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY" as const,
    intent,
    source_parameters,
    profile_sha256: SOURCE_PROFILE.source_sha256,
    prompt_bound: "LOCAL_UTF16_BOUND_PUBLIC_MAXIMUM_PROVIDER_UNIT_UNPROVEN" as const,
    prompt_maximum_utf16_length: PROMPT_UTF16_LIMITS[fields.model_id],
    effective_defaults: "UNKNOWN" as const,
    input_binding_confidence: "PUBLIC_IMAGE_CARDINALITY_METADATA_ONLY_NOT_NATIVE_UPLOAD_OR_ROLE_PROOF" as const,
    dispatch_allowed: false as const,
    runtime_usable: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

export function isOwnerGrokI2vModelId(value: unknown): value is OwnerGrokI2vModelId {
  return isModelId(value);
}
export function isOwnerGrokI2vVideoDuration(model_id: unknown, value: unknown): value is number {
  return isModelId(model_id) && isDuration(model_id, value);
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) =>
          typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch { return invalid(); }
}
function isModelId(value: unknown): value is OwnerGrokI2vModelId {
  return typeof value === "string" && (OWNER_GROK_I2V_MODEL_IDS as readonly string[]).includes(value);
}
function isDuration(model_id: OwnerGrokI2vModelId, value: unknown): value is number {
  if (!Number.isSafeInteger(value)) return false;
  return model_id === "grok_i2v" ? value === 6 || value === 10 : (value as number) >= 1 && (value as number) <= 15;
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
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
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}
function invalid(): never { throw new OwnerGrokI2vParametersError("INVALID_PARAMETERS"); }
