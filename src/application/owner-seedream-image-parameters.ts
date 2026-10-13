import { isProxy } from "node:util/types";

export const OWNER_SEEDREAM_IMAGE_VARIANTS = Object.freeze([
  "seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"
] as const);
export type OwnerSeedreamImageVariant = typeof OWNER_SEEDREAM_IMAGE_VARIANTS[number];
export type OwnerSeedreamImageResolution = "1K" | "1.5K" | "2K" | "3K" | "4K";
export type OwnerSeedreamImageRatio = "21:9" | "16:9" | "3:2" | "4:3" | "1:1" | "3:4" | "2:3" | "9:16";

const RATIOS = Object.freeze(["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const);
const RESOLUTIONS = Object.freeze({
  "seedream-4": Object.freeze(["1K", "2K", "4K"] as const),
  "seedream-4.5": Object.freeze(["2K", "4K"] as const),
  "seedream-5": Object.freeze(["2K", "3K", "4K"] as const),
  "seedream-5.0-flash": Object.freeze(["1K", "1.5K", "2K"] as const),
  "seedream-5.0-pro": Object.freeze(["1K", "2K"] as const)
} as const);
const LIMITS = Object.freeze({
  "seedream-4": 4,
  "seedream-4.5": 4,
  "seedream-5": 14,
  "seedream-5.0-flash": 10,
  "seedream-5.0-pro": 10
} as const);
const FORMATS = Object.freeze(["jpeg", "png"] as const);
const BACKGROUNDS = Object.freeze(["opaque", "transparent"] as const);
const SOURCE_PARAMETERS = deepFreeze({
  profile_id: "seedream-image-source-parameters-v1",
  ai_name: "seedream" as const,
  variants: OWNER_SEEDREAM_IMAGE_VARIANTS,
  parameter_keys: Object.freeze(["aspect_ratio", "resolution", "output_format", "background"] as const),
  controls: {
    aspect_ratio: { kind: "string_enum" as const, values: RATIOS },
    resolution: { kind: "string_enum_by_variant" as const, values_by_variant: RESOLUTIONS },
    output_format: { kind: "nullable_string_enum" as const, values: FORMATS, active_by_variant: flashOnly() },
    background: { kind: "nullable_string_enum" as const, values: BACKGROUNDS, active_by_variant: flashOnly() }
  },
  inactive_control_policy: "EXPLICIT_NULL_IN_LOCAL_STATE_OMITTED_FROM_WIRE" as const,
  reference_count: { minimum: 0, maximum_by_variant: LIMITS, confidence: "PUBLIC_FILE_COUNT_METADATA_NOT_PROVIDER_ACCEPTANCE" as const },
  transparency: {
    allowed_only_for: "seedream-5.0-flash" as const,
    requirements: "EXACTLY_ONE_SOURCE_PNG_AND_PIXEL_ALPHA_ELIGIBILITY_DECLARED_BY_CALLER" as const,
    source_mime_is_sufficient: false as const,
    pixel_proof_in_this_layer: false as const,
    owned_reference_binding_in_this_layer: false as const,
    browser_geometry_proof_in_this_layer: false as const
  },
  fixed_wire: { n: 1, stream: false },
  cost_boundary: {
    declared_cost_metadata_keys_by_variant: {
      "seedream-4": Object.freeze([] as const), "seedream-4.5": Object.freeze([] as const),
      "seedream-5": Object.freeze([] as const), "seedream-5.0-flash": Object.freeze([] as const),
      "seedream-5.0-pro": Object.freeze(["batch_size", "resolution"] as const)
    },
    effective_inputs: "PRO_BATCH_SIZE_EQUALS_EXPLICIT_REFERENCE_COUNT_INCLUDING_ZERO; RESOLUTION_EXPLICIT; OTHERS_EMPTY" as const,
    quote_or_cost_amount: "UNPROVEN" as const
  },
  source_pins: {
    public_catalog: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    settings_inventory: "sha256:00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61",
    form_build_id: "1791467421",
    form_module: "seedream.js",
    form_bytes: 9_142,
    form_sha256: "sha256:3e762f2725970438f392c18f1d4153e93d4aee1165597e28207a8853a0a5b1d1",
    app_store_sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf",
    fixed_sender_source: "Root591_STATIC_AST_JOIN; NOT_RUNTIME_VERIFIED" as const
  },
  effective_defaults: "UNKNOWN" as const,
  dispatch_allowed: false as const,
  runtime_activation: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export interface OwnerSeedreamImageParameters {
  readonly aspect_ratio: OwnerSeedreamImageRatio;
  readonly resolution: OwnerSeedreamImageResolution;
  readonly output_format: "jpeg" | "png" | null;
  readonly background: "opaque" | "transparent" | null;
}
export interface OwnerSeedreamImageTransparencyContext {
  readonly reference_count: 1;
  readonly source_mime_types: readonly ["image/png"];
  readonly pixel_alpha_eligible: true;
}
export interface OwnerSeedreamImageNormalizedParameters {
  readonly ai_name: "seedream";
  readonly model_id: OwnerSeedreamImageVariant;
  readonly variant: OwnerSeedreamImageVariant;
  readonly parameters: OwnerSeedreamImageParameters;
  readonly reference_count: number;
  readonly wire_settings: Readonly<Record<string, string | number | boolean>>;
  readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly transparency_eligibility: Readonly<{
    declared_context_consumed: boolean;
    source_png_declared: boolean;
    pixel_alpha_proven: false;
    owned_references_bound: false;
    browser_geometry_proven: false;
  }>;
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerSeedreamImageParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Seedream image parameters are invalid.");
    this.name = "OwnerSeedreamImageParametersError";
  }
}

export function getOwnerSeedreamImageSourceParameters() { return SOURCE_PARAMETERS; }

/** Normalizes explicit local state only; the descriptor creates no owned-reference or dispatch proof. */
export function normalizeOwnerSeedreamImageParameters(input: unknown): OwnerSeedreamImageNormalizedParameters {
  const request = readExactRecord(input, ["variant", "reference_count", "parameters"], ["transparency_context"]);
  if (!isVariant(request.variant)) invalid();
  const variant = request.variant;
  const maxReferences = LIMITS[variant];
  if (!Number.isSafeInteger(request.reference_count) || (request.reference_count as number) < 0 || (request.reference_count as number) > maxReferences) invalid();
  const referenceCount = request.reference_count as number;
  const raw = readExactRecord(request.parameters, ["aspect_ratio", "resolution", "output_format", "background"]);
  if (!isOneOf(raw.aspect_ratio, RATIOS) || !isOneOf(raw.resolution, RESOLUTIONS[variant])) invalid();
  const isFlash = variant === "seedream-5.0-flash";
  if (isFlash) {
    if (!isOneOf(raw.output_format, FORMATS) || !isOneOf(raw.background, BACKGROUNDS)) invalid();
  } else if (raw.output_format !== null || raw.background !== null) invalid();

  const transparent = isFlash && raw.background === "transparent";
  let context: OwnerSeedreamImageTransparencyContext | undefined;
  if (request.transparency_context !== undefined) context = snapshotTransparencyContext(request.transparency_context);
  if (transparent && (raw.output_format !== "png" || referenceCount !== 1 || !context ||
      context.reference_count !== 1 || context.source_mime_types.length !== 1 || context.source_mime_types[0] !== "image/png" ||
      context.pixel_alpha_eligible !== true)) invalid();
  if (!transparent && request.transparency_context !== undefined && referenceCount !== context?.reference_count) invalid();

  const parameters = deepFreeze({
    aspect_ratio: raw.aspect_ratio as OwnerSeedreamImageRatio,
    resolution: raw.resolution as OwnerSeedreamImageResolution,
    output_format: raw.output_format as OwnerSeedreamImageParameters["output_format"],
    background: raw.background as OwnerSeedreamImageParameters["background"]
  });
  const wireSettings: Record<string, string | number | boolean> = {
    aspect_ratio: parameters.aspect_ratio, resolution: parameters.resolution, stream: false, n: 1
  };
  if (isFlash) {
    wireSettings.output_format = parameters.output_format!;
    wireSettings.background = parameters.background!;
  }
  const costInputs: Readonly<Record<string, string | number>> = variant === "seedream-5.0-pro"
    ? { batch_size: referenceCount, resolution: parameters.resolution }
    : {};
  return deepFreeze({
    ai_name: "seedream" as const, model_id: variant, variant, parameters,
    reference_count: referenceCount,
    wire_settings: wireSettings,
    cost_inputs: costInputs,
    transparency_eligibility: {
      declared_context_consumed: transparent,
      source_png_declared: transparent,
      pixel_alpha_proven: false as const,
      owned_references_bound: false as const,
      browser_geometry_proven: false as const
    },
    dispatch_allowed: false as const, runtime_activation: false as const, backend_acceptance: "UNPROVEN" as const
  });
}

function snapshotTransparencyContext(value: unknown): OwnerSeedreamImageTransparencyContext {
  const raw = readExactRecord(value, ["reference_count", "source_mime_types", "pixel_alpha_eligible"]);
  if (raw.reference_count !== 1 || raw.pixel_alpha_eligible !== true) invalid();
  const mimes = readExactArray(raw.source_mime_types, 1, 1);
  if (mimes[0] !== "image/png") invalid();
  return deepFreeze({ reference_count: 1 as const, source_mime_types: ["image/png"] as const, pixel_alpha_eligible: true as const });
}

function readExactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function readExactArray(value: unknown, minimum: number, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== value.length + 1 || !actual.includes("length") || actual.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) invalid();
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) invalid();
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}
function isVariant(value: unknown): value is OwnerSeedreamImageVariant { return typeof value === "string" && OWNER_SEEDREAM_IMAGE_VARIANTS.includes(value as OwnerSeedreamImageVariant); }
function isOneOf<T>(value: unknown, values: readonly T[]): value is T { return values.includes(value as T); }
function flashOnly() { return Object.freeze({ "seedream-4": false, "seedream-4.5": false, "seedream-5": false, "seedream-5.0-flash": true, "seedream-5.0-pro": false } as const); }
type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}
function invalid(): never { throw new OwnerSeedreamImageParametersError("INVALID_PARAMETERS"); }
