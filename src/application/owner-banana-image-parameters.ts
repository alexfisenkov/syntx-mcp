import { isProxy } from "node:util/types";

export const OWNER_BANANA_IMAGE_VARIANTS = Object.freeze([
  "banana", "banana-2.1", "banana2", "banana3", "banana3_light"
] as const);
export type OwnerBananaImageVariant = typeof OWNER_BANANA_IMAGE_VARIANTS[number];
export type OwnerBananaImageParameterAxis = string | null;

const ASPECT_RATIOS = Object.freeze([null, "21:9", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "1:1"] as const);
const IMAGE_SIZES = Object.freeze({
  banana: Object.freeze([null] as const),
  "banana-2.1": Object.freeze(["1K", "2K", "4K"] as const),
  banana2: Object.freeze(["1K", "2K", "4K"] as const),
  banana3: Object.freeze(["0.5K", "1K", "2K", "4K"] as const),
  banana3_light: Object.freeze(["1K"] as const)
} as const);
const THINKING_LEVELS = Object.freeze({
  banana: Object.freeze([null] as const),
  "banana-2.1": Object.freeze(["minimal", "medium", "high"] as const),
  banana2: Object.freeze([null] as const),
  banana3: Object.freeze([null] as const),
  banana3_light: Object.freeze([null] as const)
} as const);
const REFERENCE_LIMITS = Object.freeze({
  banana: Object.freeze({ minimum: 0, maximum: 4 }),
  "banana-2.1": Object.freeze({ minimum: 0, maximum: 14 }),
  banana2: Object.freeze({ minimum: 0, maximum: 14 }),
  banana3: Object.freeze({ minimum: 0, maximum: 14 }),
  banana3_light: Object.freeze({ minimum: 0, maximum: 14 })
} as const);
const COST_POLICY = Object.freeze({
  banana: Object.freeze({ controlled_inputs: Object.freeze([] as const), quote_or_amount: "UNPROVEN" as const }),
  "banana-2.1": Object.freeze({ controlled_inputs: Object.freeze(["image_size"] as const), quote_or_amount: "UNPROVEN" as const }),
  banana2: Object.freeze({ controlled_inputs: Object.freeze(["image_size"] as const), quote_or_amount: "UNPROVEN" as const }),
  banana3: Object.freeze({ controlled_inputs: Object.freeze(["image_size"] as const), quote_or_amount: "UNPROVEN" as const }),
  banana3_light: Object.freeze({ controlled_inputs: Object.freeze(["image_size"] as const), quote_or_amount: "UNPROVEN" as const })
} as const);
const SOURCE_PARAMETERS = deepFreeze({
  profile_id: "banana-image-source-parameters-v1",
  variants: OWNER_BANANA_IMAGE_VARIANTS,
  controls: {
    aspect_ratio: { kind: "nullable_string_enum" as const, values: ASPECT_RATIOS, mapping: "PRESERVE_EXPLICIT_VALUE_IN_SOURCE_JSON_CANDIDATE" as const },
    image_size: {
      kind: "string_or_null_by_variant" as const, values_by_variant: IMAGE_SIZES,
      inactive_policy: "BASE_BANANA_NULL_IS_PRESERVED_IN_SOURCE_JSON_CANDIDATE" as const
    },
    thinking_level: {
      kind: "string_or_null_by_variant" as const, values_by_variant: THINKING_LEVELS,
      inactive_policy: "NULL_CALLER_VALUE_OMITTED_FROM_SOURCE_JSON_CANDIDATE" as const
    }
  },
  reference_limits: REFERENCE_LIMITS,
  reference_count_semantics: "CATALOG_IMAGE_COUNT_ADMISSION_ONLY_OWNED_REFERENCES_UNBOUND" as const,
  cost_policy: COST_POLICY,
  source_pins: {
    public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    public_catalog_fetched_at: "2026-10-08T13:18:39.393Z",
    public_models_sha256: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444",
    settings_inventory_version: "sha256:00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61",
    settings_candidate_artifact: "banana-conditional-settings-v1.0.0.json",
    settings_candidate_sha256: "sha256:9458bd83ce4091fc7a1bac333e45012ef1951ff0aaa5524788865c0ea8d12f1b",
    form_build_id: "1791467421",
    form_module: "banana.js",
    form_sha256: "sha256:b66e233dc1ad667fc128b25c19255458ce51fe4bf6e4648d3848b27b402c1c1e",
    settings_helper_module: "settings3.js",
    settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
    app_store_sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf",
    app_store_evidence: "RETAINED_NOT_REFETCHED" as const,
    ratio_source_sha256: "sha256:26627f87a943cc9a2a40ca159217f3e2e7f26232d58a9d5d5b9469d05d43ec50",
    source_execution: false as const
  },
  effective_defaults: "UNKNOWN_WATCHER_DEFAULTS_NOT_UI_VERIFIED" as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export interface OwnerBananaImageParametersInput {
  readonly variant: OwnerBananaImageVariant;
  readonly reference_count: number;
  readonly parameters: Readonly<{
    aspect_ratio: string | null;
    image_size: string | null;
    thinking_level: string | null;
  }>;
}

export interface OwnerBananaImageNormalizedParameters {
  readonly variant: OwnerBananaImageVariant;
  readonly parameters: Readonly<OwnerBananaImageParametersInput["parameters"]>;
  readonly reference_count: number;
  readonly reference_binding: Readonly<{
    reference_count: number;
    owned_references_bound: false;
    provider_acceptance: "UNPROVEN";
  }>;
  readonly cost_inputs: Readonly<{ image_size?: string }>;
  readonly cost_input_confidence: "SOURCE_JOINED_METADATA_KEYS_NOT_QUOTE";
  readonly source_json_mapping: Readonly<Record<string, string | null>>;
  readonly source_mapping_confidence: "STATIC_UI_STATE_CANDIDATE_NOT_WIRE_VERIFIED";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerBananaImageParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Banana image parameters are invalid.");
    this.name = "OwnerBananaImageParametersError";
  }
}

export function getOwnerBananaImageSourceParameters() {
  return SOURCE_PARAMETERS;
}

/** Validates a complete explicit local intent; this does not create upload or dispatch capability. */
export function normalizeOwnerBananaImageParameters(input: unknown): OwnerBananaImageNormalizedParameters {
  const request = readExactRecord(input, ["variant", "reference_count", "parameters"]);
  if (!isVariant(request.variant)) invalid();
  const variant = request.variant;
  const limit = REFERENCE_LIMITS[variant];
  if (!Number.isSafeInteger(request.reference_count) ||
      (request.reference_count as number) < limit.minimum || (request.reference_count as number) > limit.maximum) invalid();
  const raw = readExactRecord(request.parameters, ["aspect_ratio", "image_size", "thinking_level"]);
  if (!isOneOf(raw.aspect_ratio, ASPECT_RATIOS) ||
      !isOneOf(raw.image_size, IMAGE_SIZES[variant]) ||
      !isOneOf(raw.thinking_level, THINKING_LEVELS[variant])) invalid();
  const parameters = deepFreeze({
    aspect_ratio: raw.aspect_ratio as string | null,
    image_size: raw.image_size as string | null,
    thinking_level: raw.thinking_level as string | null
  });
  const sourceJsonMapping: Record<string, string | null> = {
    model_type: variant,
    aspect_ratio: parameters.aspect_ratio,
    image_size: parameters.image_size
  };
  if (variant === "banana-2.1") sourceJsonMapping.thinking_level = parameters.thinking_level;
  return deepFreeze({
    variant,
    parameters,
    reference_count: request.reference_count as number,
    reference_binding: {
      reference_count: request.reference_count as number,
      owned_references_bound: false as const,
      provider_acceptance: "UNPROVEN" as const
    },
    cost_inputs: variant === "banana" ? {} : { image_size: parameters.image_size as string },
    cost_input_confidence: "SOURCE_JOINED_METADATA_KEYS_NOT_QUOTE" as const,
    source_json_mapping: sourceJsonMapping,
    source_mapping_confidence: "STATIC_UI_STATE_CANDIDATE_NOT_WIRE_VERIFIED" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isVariant(value: unknown): value is OwnerBananaImageVariant {
  return typeof value === "string" && (OWNER_BANANA_IMAGE_VARIANTS as readonly string[]).includes(value);
}

function isOneOf(value: unknown, options: readonly unknown[]): boolean {
  return options.includes(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function invalid(): never { throw new OwnerBananaImageParametersError("INVALID_PARAMETERS"); }
