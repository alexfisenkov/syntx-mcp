import { isProxy } from "node:util/types";

const VARIANTS = Object.freeze(["creative", "precision_v1", "precision_v2"] as const);
const SCALE_FACTORS = Object.freeze(["2x", "4x", "8x", "16x"] as const);
const SCALE_MULTIPLIERS = Object.freeze([1, 4, 16, 64] as const);
const OPTIMIZED_FOR = Object.freeze([
  "standard", "soft_portraits", "hard_portraits", "art_n_illustration", "videogame_assets",
  "nature_n_landscapes", "films_n_photography", "3d_renders", "science_fiction_n_horror"
] as const);
const ENGINES = Object.freeze(["automatic", "magnific_illusio", "magnific_sharpy", "magnific_sparkle"] as const);
const FLAVORS = Object.freeze(["sublime", "photo", "photo_denoiser"] as const);
const PARAMETER_KEYS = Object.freeze([
  "scale_factor", "optimized_for", "engine", "creativity", "hdr", "resemblance", "fractality",
  "sharpen", "smart_grain", "ultra_detail", "flavor"
] as const);
const UI_PIXEL_THRESHOLD = 25_300_000;
const SOURCE_PINS = Object.freeze({
  public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
  settings_inventory_sha256: "sha256:00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61",
  form_sha256: "sha256:0d3559b37f3ce20528638a45307e7ce30a9cf9a6aa2e446b059f30830aae14e8",
  settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
  upscaler_helper_sha256: "sha256:91f684d0675d788483698f2fa5c974be8d55ba925915a84449871e67b600487b",
  app_sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf",
  parent_sha256: "sha256:8b00e34ae7e8d848c3967255648ce8839853690643a68726cf3faee26b913587",
  submit_helper_sha256: "sha256:83fdb2ef6086fc92c8497abd6fbfb4cb4f673a8cc44b695e3d865fd6dc021aad",
  cost_helper_sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9"
} as const);

const SOURCE_PARAMETERS = deepFreeze({
  ai_name: "magnific" as const,
  variants: VARIANTS,
  parameter_keys: PARAMETER_KEYS,
  controls: {
    model_type: {
      kind: "variant_selector",
      values: VARIANTS,
      visible_by_variant: { creative: true, precision_v1: true, precision_v2: true }
    },
    scale_factor: {
      kind: "string_enum",
      values: SCALE_FACTORS,
      visible_by_variant: { creative: true, precision_v1: false, precision_v2: "NOT T.value" },
      precision_v2_visibility_source: "NOT T.value",
      conditional_locks: {
        precision_v1: "2x",
        precision_v2_flavors: Object.freeze(["photo", "photo_denoiser"] as const),
        precision_v2_locked_value: "2x"
      }
    },
    optimized_for: {
      kind: "string_enum", values: OPTIMIZED_FOR,
      visible_by_variant: { creative: true, precision_v1: false, precision_v2: false }
    },
    engine: {
      kind: "string_enum", values: ENGINES,
      visible_by_variant: { creative: true, precision_v1: false, precision_v2: false }
    },
    creativity: {
      kind: "integer", range: { minimum: -10, maximum: 10, step: 1 },
      visible_by_variant: { creative: true, precision_v1: false, precision_v2: false }
    },
    hdr: {
      kind: "integer", range: { minimum: -10, maximum: 10, step: 1 },
      visible_by_variant: { creative: true, precision_v1: false, precision_v2: false }
    },
    resemblance: {
      kind: "integer", range: { minimum: -10, maximum: 10, step: 1 },
      visible_by_variant: { creative: true, precision_v1: false, precision_v2: false }
    },
    fractality: {
      kind: "integer", range: { minimum: -10, maximum: 10, step: 1 },
      visible_by_variant: { creative: true, precision_v1: false, precision_v2: false }
    },
    sharpen: {
      kind: "integer", range: { minimum: 0, maximum: 100, step: 1 },
      visible_by_variant: { creative: false, precision_v1: true, precision_v2: true }
    },
    smart_grain: {
      kind: "integer", range: { minimum: 0, maximum: 100, step: 1 },
      visible_by_variant: { creative: false, precision_v1: true, precision_v2: true }
    },
    ultra_detail: {
      kind: "integer", range: { minimum: 0, maximum: 100, step: 1 },
      visible_by_variant: { creative: false, precision_v1: true, precision_v2: true }
    },
    flavor: {
      kind: "string_enum", values: FLAVORS,
      visible_by_variant: { creative: false, precision_v1: false, precision_v2: true }
    }
  },
  state_policy: "ALL_11_FIELDS_REQUIRED_AND_VALIDATED_INCLUDING_HIDDEN_FIELDS_NO_DEFAULT_OR_CACHE_FILL",
  scale_choices: {
    values: SCALE_FACTORS,
    index_multipliers: SCALE_MULTIPLIERS,
    threshold_pixels: UI_PIXEL_THRESHOLD,
    formula: "width*height*index_multiplier <= threshold_pixels",
    no_choices_fallback: Object.freeze(["2x"] as const),
    limit_confidence: "SOURCE_UI_GATING_ONLY_NOT_PROVIDER_LIMIT_OR_OUTPUT_GEOMETRY"
  },
  initializer_candidate: {
    status: "PROVENANCE_ONLY_NOT_DEFAULT",
    values: Object.freeze({
      scale_factor: "2x", optimized_for: "standard", engine: "automatic", creativity: 3,
      hdr: 3, resemblance: 3, fractality: 3, sharpen: 30, smart_grain: 30,
      ultra_detail: 30, flavor: "sublime"
    })
  },
  source_pins: SOURCE_PINS,
  upload_policy: "UNRESOLVED_SEPARATE_GATE",
  dispatch_allowed: false,
  runtime_activation: false,
  backend_acceptance: "UNPROVEN"
});

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type OwnerMagnificUpscaleVariant = typeof VARIANTS[number];
export type OwnerMagnificUpscaleScaleFactor = typeof SCALE_FACTORS[number];
export type OwnerMagnificUpscaleOptimizedFor = typeof OPTIMIZED_FOR[number];
export type OwnerMagnificUpscaleEngine = typeof ENGINES[number];
export type OwnerMagnificUpscaleFlavor = typeof FLAVORS[number];

export interface OwnerMagnificUpscaleParameters {
  readonly scale_factor: OwnerMagnificUpscaleScaleFactor;
  readonly optimized_for: OwnerMagnificUpscaleOptimizedFor;
  readonly engine: OwnerMagnificUpscaleEngine;
  readonly creativity: number;
  readonly hdr: number;
  readonly resemblance: number;
  readonly fractality: number;
  readonly sharpen: number;
  readonly smart_grain: number;
  readonly ultra_detail: number;
  readonly flavor: OwnerMagnificUpscaleFlavor;
}

export interface OwnerMagnificUpscaleDimensions {
  readonly width: number;
  readonly height: number;
}

export interface OwnerMagnificUpscaleNormalizedParameters {
  readonly ai_name: "magnific";
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly model_type: OwnerMagnificUpscaleVariant;
  readonly parameters: OwnerMagnificUpscaleParameters;
  readonly dimensions: OwnerMagnificUpscaleDimensions;
  readonly cost_inputs: Readonly<{ width: number; height: number; scale_factor: OwnerMagnificUpscaleScaleFactor }>;
  readonly ui_scale_choices: readonly OwnerMagnificUpscaleScaleFactor[];
  readonly scale_lock: "PRECISION_V1_FIXED_2X" | "PRECISION_V2_PHOTO_FIXED_2X" | null;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerMagnificUpscaleParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Magnific upscaler parameters are invalid.");
    this.name = "OwnerMagnificUpscaleParametersError";
  }
}

/** Source/UI observations only. This descriptor grants no runtime or dispatch capability. */
export function getOwnerMagnificUpscaleSourceParameters(): DeepReadonly<typeof SOURCE_PARAMETERS> {
  return SOURCE_PARAMETERS;
}

/** Validates a full caller-supplied state against the selected branch; it creates no wire request or permit. */
export function normalizeOwnerMagnificUpscaleParameters(input: unknown): OwnerMagnificUpscaleNormalizedParameters {
  const request = readExactRecord(input, ["variant", "parameters", "dimensions"]);
  if (!isVariant(request.variant)) invalid();
  const variant = request.variant;
  const rawParameters = readExactRecord(request.parameters, PARAMETER_KEYS);
  const parameters = snapshotParameters(rawParameters);
  const dimensions = snapshotDimensions(readExactRecord(request.dimensions, ["width", "height"]));
  const sourceChoices = sourceScaleChoices(dimensions);
  const lockedByV1 = variant === "precision_v1";
  const lockedByFlavor = variant === "precision_v2" && (parameters.flavor === "photo" || parameters.flavor === "photo_denoiser");
  const scaleLock = lockedByV1 ? "PRECISION_V1_FIXED_2X" : lockedByFlavor ? "PRECISION_V2_PHOTO_FIXED_2X" : null;
  const uiScaleChoices = scaleLock === null ? sourceChoices : Object.freeze(["2x"] as const);
  if (scaleLock !== null) {
    if (parameters.scale_factor !== "2x") invalid();
  } else if (!uiScaleChoices.includes(parameters.scale_factor)) {
    invalid();
  }
  const fullParameters = deepFreeze(parameters);
  const frozenDimensions = deepFreeze(dimensions);
  const costInputs = deepFreeze({
    width: dimensions.width,
    height: dimensions.height,
    scale_factor: parameters.scale_factor
  });
  return deepFreeze({
    ai_name: "magnific" as const,
    variant,
    model_type: variant,
    parameters: fullParameters,
    dimensions: frozenDimensions,
    cost_inputs: costInputs,
    ui_scale_choices: uiScaleChoices,
    scale_lock: scaleLock,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function snapshotParameters(raw: Record<string, unknown>): OwnerMagnificUpscaleParameters {
  if (!isOneOf(raw.scale_factor, SCALE_FACTORS) || !isOneOf(raw.optimized_for, OPTIMIZED_FOR) ||
      !isOneOf(raw.engine, ENGINES) || !isOneOf(raw.flavor, FLAVORS)) invalid();
  for (const key of ["creativity", "hdr", "resemblance", "fractality"] as const) {
    if (!Number.isInteger(raw[key]) || (raw[key] as number) < -10 || (raw[key] as number) > 10) invalid();
  }
  for (const key of ["sharpen", "smart_grain", "ultra_detail"] as const) {
    if (!Number.isInteger(raw[key]) || (raw[key] as number) < 0 || (raw[key] as number) > 100) invalid();
  }
  return {
    scale_factor: raw.scale_factor,
    optimized_for: raw.optimized_for,
    engine: raw.engine,
    creativity: raw.creativity as number,
    hdr: raw.hdr as number,
    resemblance: raw.resemblance as number,
    fractality: raw.fractality as number,
    sharpen: raw.sharpen as number,
    smart_grain: raw.smart_grain as number,
    ultra_detail: raw.ultra_detail as number,
    flavor: raw.flavor
  };
}

function snapshotDimensions(raw: Record<string, unknown>): OwnerMagnificUpscaleDimensions {
  if (!Number.isSafeInteger(raw.width) || (raw.width as number) <= 0 ||
      !Number.isSafeInteger(raw.height) || (raw.height as number) <= 0) invalid();
  const width = raw.width as number;
  const height = raw.height as number;
  if (!Number.isSafeInteger(width * height)) invalid();
  return { width, height };
}

function sourceScaleChoices(dimensions: OwnerMagnificUpscaleDimensions): readonly OwnerMagnificUpscaleScaleFactor[] {
  const area = dimensions.width * dimensions.height;
  const choices: OwnerMagnificUpscaleScaleFactor[] = [];
  for (let index = 0; index < SCALE_FACTORS.length; index += 1) {
    const scaledArea = area * SCALE_MULTIPLIERS[index]!;
    if (!Number.isSafeInteger(scaledArea)) invalid();
    if (scaledArea <= UI_PIXEL_THRESHOLD) choices.push(SCALE_FACTORS[index]!);
  }
  return Object.freeze(choices.length === 0 ? ["2x"] : choices);
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isVariant(value: unknown): value is OwnerMagnificUpscaleVariant {
  return isOneOf(value, VARIANTS);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never {
  throw new OwnerMagnificUpscaleParametersError("INVALID_PARAMETERS");
}
