import { isProxy } from "node:util/types";

const VARIANTS = Object.freeze([
  "gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"
] as const);
const RATIOS = Object.freeze(["1:1", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "21:9"] as const);
const LEGACY_RATIOS = Object.freeze(["3:2", "1:1", "2:3"] as const);
const QUALITIES = Object.freeze(["1K", "2K", "4K"] as const);
const GPT2_DETAILS = Object.freeze(["low", "medium", "high"] as const);
const GPT25_DETAILS = Object.freeze(["low", "medium", "high", "xhigh", "max"] as const);
const REFERENCE_LIMITS = Object.freeze({
  "gpt-image-1": 5, "gpt-image-1.5": 10, "gpt-image-2": 10,
  "gpt-image-2.5-flare": 16, "gpt-image-2.5-sunburst": 16
} as const);

const SOURCE_PARAMETERS = deepFreeze({
  ai_name: "sora-images" as const,
  variants: VARIANTS,
  parameters: {
    aspect_ratio: { kind: "string_enum" as const, legacy_variants: ["gpt-image-1", "gpt-image-1.5"] as const, legacy_values: LEGACY_RATIOS, mapped_variants: ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] as const, mapped_values: RATIOS },
    quality: { kind: "nullable_string_enum" as const, inactive_variants: ["gpt-image-1", "gpt-image-1.5"] as const, values: QUALITIES },
    details_quality: { kind: "nullable_string_enum" as const, inactive_variants: ["gpt-image-1", "gpt-image-1.5"] as const, gpt_image_2_values: GPT2_DETAILS, gpt_image_25_values: GPT25_DETAILS }
  },
  reference_limits: REFERENCE_LIMITS,
  reference_count_confidence: "PUBLIC_CATALOG_DECLARED_LIMIT_NOT_PROVIDER_ACCEPTANCE_OR_OWNED_REFERENCES" as const,
  cost_policy: {
    declared_keys: {
      "gpt-image-1": Object.freeze([]), "gpt-image-1.5": Object.freeze([]),
      "gpt-image-2": Object.freeze(["quality", "details_quality"]),
      "gpt-image-2.5-flare": Object.freeze(["quality", "details_quality", "ref_count"]),
      "gpt-image-2.5-sunburst": Object.freeze(["quality", "details_quality", "ref_count"])
    },
    controlled_inputs: {
      "gpt-image-1": Object.freeze([]), "gpt-image-1.5": Object.freeze([]),
      "gpt-image-2": Object.freeze(["quality", "details_quality"]),
      "gpt-image-2.5-flare": Object.freeze(["quality", "details_quality", "reference_count"]),
      "gpt-image-2.5-sunburst": Object.freeze(["quality", "details_quality", "reference_count"])
    },
    optional_reference_count_wire: "OMIT_WHEN_ZERO_SOURCE_SERIALIZER_USES_UNDEFINED" as const,
    confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" as const,
    amount_currency_actual_billing_hardcap: "UNPROVEN" as const
  },
  source_pins: {
    catalog: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    form_sha256: "sha256:b30879e1d8171abf2dcab0dd490fbf561fab85495f022c8215b414d17178a966",
    helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
    app_sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf"
  },
  defaults: "UNKNOWN" as const,
  dispatch_allowed: false as const,
  runtime_activation: false as const,
  backend_acceptance: "UNPROVEN" as const
});

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type OwnerGptImageVariant = typeof VARIANTS[number];
export type OwnerGptImageParameters = Readonly<{
  aspect_ratio: string;
  quality: string | null;
  details_quality: string | null;
}>;

export interface OwnerGptImageNormalizedParameters {
  readonly ai_name: "sora-images";
  readonly model_id: OwnerGptImageVariant;
  readonly variant: OwnerGptImageVariant;
  readonly parameters: OwnerGptImageParameters;
  readonly reference_count: number;
  readonly reference_count_confidence: "PUBLIC_CATALOG_DECLARED_LIMIT_NOT_PROVIDER_ACCEPTANCE_OR_OWNED_REFERENCES";
  readonly source_wire_settings: Readonly<{ aspect_ratio: string; quality?: string; details_quality?: string }>;
  readonly cost_inputs: Readonly<{ quality?: string; details_quality?: string; ref_count?: number }>;
  readonly cost_input_confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerGptImageParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("GPT Image parameters are invalid.");
    this.name = "OwnerGptImageParametersError";
  }
}

/** Selected source controls and pins; does not imply runtime activation or provider acceptance. */
export function getOwnerGptImageSourceParameters(): DeepReadonly<typeof SOURCE_PARAMETERS> {
  return SOURCE_PARAMETERS;
}

/** Requires a complete explicit three-field state and reference count; performs no coercion or dispatch. */
export function normalizeOwnerGptImageParameters(input: unknown): OwnerGptImageNormalizedParameters {
  const request = readExactRecord(input, ["variant", "reference_count", "parameters"]);
  if (!isVariant(request.variant)) invalid();
  const variant = request.variant;
  const maximum = REFERENCE_LIMITS[variant];
  if (!Number.isSafeInteger(request.reference_count) || (request.reference_count as number) < 0 ||
      (request.reference_count as number) > maximum) invalid();
  const referenceCount = request.reference_count as number;
  const raw = readExactRecord(request.parameters, ["aspect_ratio", "quality", "details_quality"]);
  const aspectOptions = isLegacy(variant) ? LEGACY_RATIOS : RATIOS;
  if (!isOneOf(raw.aspect_ratio, aspectOptions)) invalid();

  const mapped = !isLegacy(variant);
  if (!mapped) {
    if (raw.quality !== null || raw.details_quality !== null) invalid();
  } else {
    if (!isOneOf(raw.quality, QUALITIES)) invalid();
    const detailOptions = variant === "gpt-image-2" ? GPT2_DETAILS : GPT25_DETAILS;
    if (!isOneOf(raw.details_quality, detailOptions)) invalid();
  }

  const parameters = deepFreeze({
    aspect_ratio: raw.aspect_ratio as string,
    quality: raw.quality as string | null,
    details_quality: raw.details_quality as string | null
  });
  const sourceWireSettings = mapped
    ? { aspect_ratio: parameters.aspect_ratio, quality: parameters.quality!, details_quality: parameters.details_quality! }
    : { aspect_ratio: parameters.aspect_ratio };
  const costInputs: { quality?: string; details_quality?: string; ref_count?: number } = variant === "gpt-image-1" || variant === "gpt-image-1.5"
    ? {}
    : variant === "gpt-image-2"
      ? { quality: parameters.quality!, details_quality: parameters.details_quality! }
      : {
        quality: parameters.quality!, details_quality: parameters.details_quality!,
        ...(referenceCount === 0 ? {} : { ref_count: referenceCount })
      };

  return deepFreeze({
    ai_name: "sora-images" as const, model_id: variant, variant, parameters, reference_count: referenceCount,
    source_wire_settings: sourceWireSettings, cost_inputs: costInputs,
    reference_count_confidence: "PUBLIC_CATALOG_DECLARED_LIMIT_NOT_PROVIDER_ACCEPTANCE_OR_OWNED_REFERENCES" as const,
    cost_input_confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" as const,
    dispatch_allowed: false as const, runtime_activation: false as const, backend_acceptance: "UNPROVEN" as const
  });
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) snapshot[key] = descriptors[key]!.value;
  return snapshot;
}

function isVariant(value: unknown): value is OwnerGptImageVariant {
  return typeof value === "string" && VARIANTS.includes(value as OwnerGptImageVariant);
}

function isLegacy(variant: OwnerGptImageVariant): variant is "gpt-image-1" | "gpt-image-1.5" {
  return variant === "gpt-image-1" || variant === "gpt-image-1.5";
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
  throw new OwnerGptImageParametersError("INVALID_PARAMETERS");
}
