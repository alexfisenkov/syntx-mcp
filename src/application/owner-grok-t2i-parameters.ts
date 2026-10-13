import { isProxy } from "node:util/types";

export const OWNER_GROK_T2I_MODELS = Object.freeze([
  "grok_t2i", "grok_t2i_pro", "grok_imagine_2", "grok_imagine_quality"
] as const);
export type OwnerGrokT2iModel = typeof OWNER_GROK_T2I_MODELS[number];

const BASE_RATIOS = Object.freeze(["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"] as const);
const IMAGINE_RATIOS = Object.freeze(["1:1", "2:3", "3:2", "9:16", "16:9"] as const);
const RESOLUTIONS = Object.freeze(["1k", "2k"] as const);
const BATCH_SIZES = Object.freeze([1, 2, 3, 4, 5] as const);
const DETAILS_QUALITY = Object.freeze(["low", "medium"] as const);
const REFERENCE_COUNT_LIMITS = Object.freeze({
  grok_t2i: 0,
  grok_t2i_pro: 0,
  grok_imagine_2: 5,
  grok_imagine_quality: 3
} as const);

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const SOURCE_PARAMETERS = deepFreeze({
  profile_id: "grok-t2i-source-parameters-v1",
  models: OWNER_GROK_T2I_MODELS,
  controls: {
    resolution: { values: RESOLUTIONS, source_default: "1k" },
    batch_size: { values: BATCH_SIZES, source_default: 1 },
    aspect_ratio: { source_default: "1:1", base_values: BASE_RATIOS, imagine_values: IMAGINE_RATIOS,
      imagine_with_references: BASE_RATIOS },
    details_quality: { model: "grok_imagine_2" as const, values: DETAILS_QUALITY, source_default: "low" }
  },
  defaults: { aspect_ratio: "1:1", batch_size: 1, resolution: "1k", imagine_2_details_quality: "low" },
  defaults_confidence: "SOURCE_FORM_CANDIDATES_METADATA_ONLY_NOT_NORMALIZER_INJECTION" as const,
  models_by_id: {
    grok_t2i: { aspect_ratio_without_references: BASE_RATIOS, aspect_ratio_with_references: BASE_RATIOS,
      reference_count_selector_maximum: 0, reference_count_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_UPLOAD_PERMISSION" as const },
    grok_t2i_pro: { aspect_ratio_without_references: BASE_RATIOS, aspect_ratio_with_references: BASE_RATIOS,
      reference_count_selector_maximum: 0, reference_count_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_UPLOAD_PERMISSION" as const },
    grok_imagine_2: { aspect_ratio_without_references: IMAGINE_RATIOS, aspect_ratio_with_references: BASE_RATIOS,
      reference_count_selector_maximum: 5, reference_count_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_UPLOAD_PERMISSION" as const,
      details_quality: { values: DETAILS_QUALITY, source_default: "low" } },
    grok_imagine_quality: { aspect_ratio_without_references: IMAGINE_RATIOS, aspect_ratio_with_references: BASE_RATIOS,
      reference_count_selector_maximum: 3, reference_count_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_UPLOAD_PERMISSION" as const }
  },
  source_pins: {
    form_build_id: "1791467421",
    form_module: "grok-image.js",
    form_sha256: "sha256:1bbf68ba51172eeacaa936e66755236179d8595bde98b54f78414b30645b2f5d",
    form_freshness: "ROOT207_SAME_PIN_AS_TASK742" as const,
    source_execution: false as const
  },
  source_mapping_confidence: "PINNED_FORM_STATIC_CONTROL_CANDIDATES_NOT_WIRE_OR_RUNTIME_PROOF" as const,
  cost_inputs: null,
  cost_projection_status: "NOT_JOINED" as const,
  dispatch_allowed: false as const,
  runtime_activation: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export interface OwnerGrokT2iInputParameters {
  readonly aspect_ratio: string;
  readonly batch_size: number;
  readonly resolution: string;
  readonly details_quality?: "low" | "medium";
}

export interface OwnerGrokT2iNormalizedParameters {
  readonly variant: OwnerGrokT2iModel;
  readonly reference_count: number;
  readonly parameters: Readonly<OwnerGrokT2iInputParameters>;
  readonly controls: Readonly<{ aspect_ratio: readonly string[]; resolution: readonly string[]; batch_size: readonly number[]; details_quality?: readonly string[] }>;
  readonly reference_binding: Readonly<{
    reference_count: number;
    confidence: "SOURCE_UI_SELECTOR_ONLY_NOT_UPLOAD_PERMISSION";
    owned_references_bound: false;
  }>;
  readonly source_json_mapping: Readonly<Record<string, string | number>>;
  readonly source_mapping_confidence: "PINNED_FORM_STATIC_CONTROL_CANDIDATES_NOT_WIRE_OR_RUNTIME_PROOF";
  readonly cost_inputs: null;
  readonly cost_projection_status: "NOT_JOINED";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerGrokT2iParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Grok T2I parameters are invalid.");
    this.name = "OwnerGrokT2iParametersError";
  }
}

export function getOwnerGrokT2iSourceParameters(): DeepReadonly<typeof SOURCE_PARAMETERS> {
  return SOURCE_PARAMETERS;
}

/** Validates explicit local T2I controls; source candidates are metadata, not defaults or dispatch proof. */
export function normalizeOwnerGrokT2iParameters(input: unknown): OwnerGrokT2iNormalizedParameters {
  const request = readExactRecord(input, ["model_id", "reference_count", "parameters"]);
  if (!isModel(request.model_id)) invalid();
  const model = request.model_id;
  const referenceMaximum = REFERENCE_COUNT_LIMITS[model];
  if (!Number.isSafeInteger(request.reference_count) || (request.reference_count as number) < 0 ||
      (request.reference_count as number) > referenceMaximum) invalid();

  const allowedKeys = model === "grok_imagine_2"
    ? ["aspect_ratio", "batch_size", "resolution", "details_quality"]
    : ["aspect_ratio", "batch_size", "resolution"];
  const parameters = readExactRecord(request.parameters, allowedKeys);
  const aspectRatios = model === "grok_imagine_2" || model === "grok_imagine_quality"
    ? request.reference_count === 0 ? IMAGINE_RATIOS : BASE_RATIOS
    : BASE_RATIOS;
  if (!isOneOf(parameters.aspect_ratio, aspectRatios) || !isOneOf(parameters.resolution, RESOLUTIONS) ||
      !isOneOf(parameters.batch_size, BATCH_SIZES)) invalid();
  if (model === "grok_imagine_2" && !isOneOf(parameters.details_quality, DETAILS_QUALITY)) invalid();

  const normalizedParameters: OwnerGrokT2iInputParameters = Object.freeze({
    aspect_ratio: parameters.aspect_ratio as string,
    batch_size: parameters.batch_size as number,
    resolution: parameters.resolution as string,
    ...(model === "grok_imagine_2" ? { details_quality: parameters.details_quality as "low" | "medium" } : {})
  });
  const controls = Object.freeze({
    aspect_ratio: aspectRatios,
    resolution: RESOLUTIONS,
    batch_size: BATCH_SIZES,
    ...(model === "grok_imagine_2" ? { details_quality: DETAILS_QUALITY } : {})
  });
  const sourceJsonMapping: Record<string, string | number> = {
    model_type: model,
    aspect_ratio: normalizedParameters.aspect_ratio,
    batch_size: normalizedParameters.batch_size,
    resolution: normalizedParameters.resolution,
    ...(model === "grok_imagine_2" ? { details_quality: normalizedParameters.details_quality! } : {})
  };
  return deepFreeze({
    variant: model,
    reference_count: request.reference_count as number,
    parameters: normalizedParameters,
    controls,
    reference_binding: { reference_count: request.reference_count as number,
      confidence: "SOURCE_UI_SELECTOR_ONLY_NOT_UPLOAD_PERMISSION" as const, owned_references_bound: false as const },
    source_json_mapping: sourceJsonMapping,
    source_mapping_confidence: "PINNED_FORM_STATIC_CONTROL_CANDIDATES_NOT_WIRE_OR_RUNTIME_PROOF" as const,
    cost_inputs: null,
    cost_projection_status: "NOT_JOINED" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isModel(value: unknown): value is OwnerGrokT2iModel {
  return typeof value === "string" && (OWNER_GROK_T2I_MODELS as readonly string[]).includes(value);
}
function isOneOf<T>(value: unknown, values: readonly T[]): value is T {
  return values.includes(value as T);
}
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}
function invalid(): never { throw new OwnerGrokT2iParametersError("INVALID_PARAMETERS"); }
