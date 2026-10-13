import { isProxy } from "node:util/types";

const VARIANTS = Object.freeze([
  "flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"
] as const);
const RESOLUTIONS = Object.freeze([
  "1344x768", "1152x896", "1024x1024", "896x1152", "768x1344"
] as const);
const PARAMETER_KEYS = Object.freeze(["resolution", "cfg", "steps", "image_strength"] as const);
const SOURCE_PINS = Object.freeze({
  public_catalog_snapshot: "sha256-c6fdcc522def8f6f4ef2c172d23822164f0124b29bb5fe86e2b5dce5c54b9fbc.json",
  flux_form_sha256: "sha256:80307235518f6f0c80952ce4a5a0834ee373d7294f8dc90e58748d57389de664",
  image_caller_module_sha256: "sha256:eb4fe700c7afae0756348aad3118c55ec8c9b5f5e5d18832045be07bbd368447",
  image_sender_module_sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae",
  file_mapper_module_sha256: "sha256:8a1c0d06d68b82d97ac6a58ed7caf8d2e759d31cc10f0b1ceb26d676fa664706",
  slider_form_sha256: "sha256:406cd52179aa2ed1a526ab9ce5466d7a19f7653f7efd58bb91f7a1253fe061b6"
} as const);

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type OwnerKontextImageVariant = typeof VARIANTS[number];
export type OwnerKontextImageResolution = typeof RESOLUTIONS[number];

export interface OwnerKontextImageParameters {
  readonly resolution: OwnerKontextImageResolution;
  readonly cfg: number;
  readonly steps: number;
  readonly image_strength: number;
}

export interface OwnerKontextImageNormalizedParameters {
  readonly ai_name: "flux";
  readonly scope: "image";
  readonly model_id: OwnerKontextImageVariant;
  readonly variant: OwnerKontextImageVariant;
  readonly parameters: OwnerKontextImageParameters;
  readonly reference_count: Readonly<{ minimum: number; maximum: number; confidence: "CLIENT_FORM_ONLY_BACKEND_UNPROVEN" }>;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

const allVariantsVisible = Object.freeze({
  "flux-kontext-pro": true,
  "flux-kontext-max": true,
  "flux-kontext-multi": true
} as const);

const SOURCE_PARAMETERS = deepFreeze({
  ai_name: "flux" as const,
  scope: "image" as const,
  variants: VARIANTS,
  parameter_keys: PARAMETER_KEYS,
  controls: {
    resolution: {
      kind: "string_enum" as const,
      values: RESOLUTIONS,
      visible_by_variant: allVariantsVisible
    },
    cfg: {
      kind: "number" as const,
      range: { minimum: 1, maximum: 4, slider_step: 0.1, multiple_of_step_required: false },
      manual_input: "FINITE_NUMBER_CLAMPED_TO_MIN_MAX_WITHOUT_STEP_QUANTIZATION",
      visible_by_variant: allVariantsVisible
    },
    steps: {
      kind: "number" as const,
      range: { minimum: 10, maximum: 28, slider_step: 1, integer_only_proven: false },
      manual_input: "FINITE_NUMBER_CLAMPED_TO_MIN_MAX_WITHOUT_STEP_QUANTIZATION",
      visible_by_variant: allVariantsVisible
    },
    image_strength: {
      kind: "number" as const,
      range: { minimum: 0, maximum: 1, slider_step: 0.1, multiple_of_step_required: false },
      manual_input: "FINITE_NUMBER_CLAMPED_TO_MIN_MAX_WITHOUT_STEP_QUANTIZATION",
      visible_by_variant: allVariantsVisible
    }
  },
  reference_count: {
    "flux-kontext-pro": { minimum: 0, maximum: 1, confidence: "CLIENT_FORM_ONLY_BACKEND_UNPROVEN" as const },
    "flux-kontext-max": { minimum: 0, maximum: 1, confidence: "CLIENT_FORM_ONLY_BACKEND_UNPROVEN" as const },
    "flux-kontext-multi": { minimum: 1, maximum: 4, confidence: "CLIENT_FORM_ONLY_BACKEND_UNPROVEN" as const }
  },
  hidden_control_state: "WORKFLOW_TYPE_AND_CIVITAI_LORAS_EFFECTIVE_VALUES_UNPROVEN_NOT_INCLUDED",
  output_geometry: "UNPROVEN",
  source_pins: SOURCE_PINS,
  dispatch_allowed: false as const,
  runtime_activation: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export class OwnerKontextImageParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Kontext image parameters are invalid.");
    this.name = "OwnerKontextImageParametersError";
  }
}

/** Source observations only; this descriptor grants no upload or dispatch capability. */
export function getOwnerKontextImageSourceParameters(): DeepReadonly<typeof SOURCE_PARAMETERS> {
  return SOURCE_PARAMETERS;
}

/** Requires an explicit complete state and returns a frozen normalized value, not a wire request. */
export function normalizeOwnerKontextImageParameters(input: unknown): OwnerKontextImageNormalizedParameters {
  const request = readExactRecord(input, ["variant", "parameters"]);
  if (!isVariant(request.variant)) invalid();
  const raw = readExactRecord(request.parameters, PARAMETER_KEYS);
  if (!isResolution(raw.resolution) || !isFiniteInRange(raw.cfg, 1, 4) ||
      !isFiniteInRange(raw.steps, 10, 28) || !isFiniteInRange(raw.image_strength, 0, 1)) invalid();

  const variant = request.variant;
  const parameters = deepFreeze({
    resolution: raw.resolution,
    cfg: raw.cfg,
    steps: raw.steps,
    image_strength: raw.image_strength
  });
  const referenceCount = SOURCE_PARAMETERS.reference_count[variant];
  return deepFreeze({
    ai_name: "flux" as const,
    scope: "image" as const,
    model_id: variant,
    variant,
    parameters,
    reference_count: referenceCount,
    dispatch_allowed: false as const,
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

function isVariant(value: unknown): value is OwnerKontextImageVariant {
  return typeof value === "string" && VARIANTS.includes(value as OwnerKontextImageVariant);
}

function isResolution(value: unknown): value is OwnerKontextImageResolution {
  return typeof value === "string" && RESOLUTIONS.includes(value as OwnerKontextImageResolution);
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never {
  throw new OwnerKontextImageParametersError("INVALID_PARAMETERS");
}
