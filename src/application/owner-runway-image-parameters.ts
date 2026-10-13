import { isProxy } from "node:util/types";

const VARIANTS = Object.freeze(["runway_frames"] as const);
const RESOLUTIONS = Object.freeze(["2112x912", "1920x1088", "1456x1088", "1088x1088", "1088x1456", "1088x1920"] as const);
const REFERENCE_LIMITS = Object.freeze({ minimum: 0, maximum: 3 } as const);
const SOURCE_PARAMETERS = deepFreeze({
  ai_name: "runway-frames" as const,
  variants: VARIANTS,
  parameters: {
    resolution: { kind: "string_enum" as const, values: RESOLUTIONS },
    temperature: {
      kind: "finite_number" as const, minimum: 1, maximum: 5, slider_step: 1,
      manual_input_policy: "PRESERVE_FINITE_IN_RANGE_FRACTIONS_NO_QUANTIZATION" as const
    }
  },
  reference_limits: REFERENCE_LIMITS,
  reference_count_confidence: "PUBLIC_CATALOG_DECLARED_IMAGE_COUNT_ONLY_OWNED_REFERENCES_UNBOUND" as const,
  fixed_wire: { n: 1, confidence: "STATIC_SOURCE_MAPPING_NOT_BACKEND_ACCEPTANCE" as const },
  local_safety_bounds: {
    maximum_image_file_bytes: 33_554_432,
    image_file_confidence: "LOCAL_PROCESS_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
    maximum_prompt_utf8_bytes: 65_536,
    prompt_confidence: "LOCAL_INPUT_RESOURCE_GUARD_NOT_PROVIDER_LIMIT" as const,
    dimensions: "SOURCE_LIMIT_UNKNOWN; PROFILE_DOES_NOT_CLAIM_UNBOUNDED_DIMENSIONS" as const
  },
  source_pins: {
    public_catalog: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    settings_inventory: "sha256-87e96b78b145338af1a666c92ab8a9811f46eb82b8f377331a103b0b409aec38.json",
    form_build_id: "1791467421",
    form_module: "runway-frames.js",
    form_sha256: "sha256:1017f19b07dc888fa40ad9bc2d36121975d8c233ef0673bd7a7261b056c25447",
    settings_helper_module: "settings3.js",
    settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
    app_store_sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf",
    source_facts_path: ".autopilot/2026-10-08-syntx-completion--wip/root-590-remaining-image-source-facts.json",
    source_execution: false as const
  },
  effective_defaults: "UNKNOWN" as const,
  dispatch_allowed: false as const,
  runtime_activation: false as const,
  backend_acceptance: "UNPROVEN" as const
});

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export type OwnerRunwayImageVariant = typeof VARIANTS[number];
export type OwnerRunwayImageParameters = Readonly<{ resolution: typeof RESOLUTIONS[number]; temperature: number }>;

export interface OwnerRunwayImageNormalizedParameters {
  readonly ai_name: "runway-frames";
  readonly model_id: OwnerRunwayImageVariant;
  readonly variant: OwnerRunwayImageVariant;
  readonly parameters: OwnerRunwayImageParameters;
  readonly reference_count: number;
  readonly reference_binding: Readonly<{
    reference_count: number;
    owned_references_bound: false;
    provider_acceptance: "UNPROVEN";
  }>;
  readonly source_wire_settings: Readonly<{ resolution: typeof RESOLUTIONS[number]; temperature: number; n: 1 }>;
  readonly cost_inputs: Readonly<Record<string, never>>;
  readonly cost_input_confidence: "SOURCE_JOINED_METADATA_KEYS_NONE_NOT_FREE_PRICE";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerRunwayImageParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Runway Frames image parameters are invalid.");
    this.name = "OwnerRunwayImageParametersError";
  }
}

/** Exact source controls only; effective defaults and provider acceptance remain unproven. */
export function getOwnerRunwayImageSourceParameters(): DeepReadonly<typeof SOURCE_PARAMETERS> {
  return SOURCE_PARAMETERS;
}

/** Validates a complete explicit state and image-count context; creates no owned reference or dispatch capability. */
export function normalizeOwnerRunwayImageParameters(input: unknown): OwnerRunwayImageNormalizedParameters {
  const request = readExactRecord(input, ["variant", "reference_count", "parameters"]);
  if (request.variant !== "runway_frames" || !Number.isSafeInteger(request.reference_count) ||
      (request.reference_count as number) < REFERENCE_LIMITS.minimum || (request.reference_count as number) > REFERENCE_LIMITS.maximum) invalid();
  const raw = readExactRecord(request.parameters, ["resolution", "temperature"]);
  if (!RESOLUTIONS.includes(raw.resolution as typeof RESOLUTIONS[number]) ||
      typeof raw.temperature !== "number" || !Number.isFinite(raw.temperature) || raw.temperature < 1 || raw.temperature > 5) invalid();
  const referenceCount = request.reference_count as number;
  const parameters = deepFreeze({ resolution: raw.resolution as typeof RESOLUTIONS[number], temperature: raw.temperature });
  return deepFreeze({
    ai_name: "runway-frames" as const,
    model_id: "runway_frames" as const,
    variant: "runway_frames" as const,
    parameters,
    reference_count: referenceCount,
    reference_binding: {
      reference_count: referenceCount,
      owned_references_bound: false as const,
      provider_acceptance: "UNPROVEN" as const
    },
    source_wire_settings: { resolution: parameters.resolution, temperature: parameters.temperature, n: 1 as const },
    cost_inputs: Object.freeze({}),
    cost_input_confidence: "SOURCE_JOINED_METADATA_KEYS_NONE_NOT_FREE_PRICE" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) snapshot[key] = descriptors[key]!.value;
  return snapshot;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never { throw new OwnerRunwayImageParametersError("INVALID_PARAMETERS"); }
