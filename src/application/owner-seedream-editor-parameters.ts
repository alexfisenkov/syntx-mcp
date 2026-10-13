import { isProxy } from "node:util/types";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";

const ASPECT_RATIOS = Object.freeze(["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const);
const RESOLUTIONS = Object.freeze({
  "seedream-4": Object.freeze(["1K", "2K", "4K"] as const),
  "seedream-4.5": Object.freeze(["2K", "4K"] as const),
  "seedream-5": Object.freeze(["2K", "3K", "4K"] as const),
  "seedream-5.0-flash": Object.freeze(["1K", "1.5K", "2K"] as const),
  "seedream-5.0-pro": Object.freeze(["1K", "2K"] as const)
} as const satisfies Readonly<Record<OwnerSeedreamImageVariant, readonly string[]>>);

export type OwnerSeedreamEditorVariant = OwnerSeedreamImageVariant;
export type OwnerSeedreamEditorAspectRatio = typeof ASPECT_RATIOS[number];
export type OwnerSeedreamEditorResolution = (typeof RESOLUTIONS)[OwnerSeedreamEditorVariant][number];

export interface OwnerSeedreamEditorParameters {
  readonly aspect_ratio: OwnerSeedreamEditorAspectRatio;
  readonly resolution: OwnerSeedreamEditorResolution;
}

export interface OwnerSeedreamEditorNormalizeInput {
  readonly variant: OwnerSeedreamEditorVariant;
  readonly parameters: OwnerSeedreamEditorParameters;
}

export interface OwnerSeedreamEditorNormalizedIntent {
  readonly variant: OwnerSeedreamEditorVariant;
  readonly parameters: Readonly<OwnerSeedreamEditorParameters>;
}

export interface ProjectOwnerSeedreamEditorCostParametersInput {
  readonly variant: OwnerSeedreamEditorVariant;
  readonly parameters: OwnerSeedreamEditorParameters;
  readonly can_reset: boolean;
}

export type OwnerSeedreamEditorCostParameters = Readonly<Record<string, never>> | Readonly<{
  batch_size: 1 | 2;
  resolution: OwnerSeedreamEditorResolution;
}>;

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const SOURCE_PARAMETERS = deepFreeze({
  profile_id: "seedream-editor-explicit-parameters-v1",
  navigation_id: "seedream-editor" as const,
  family: "seedream" as const,
  scope: "tool_image_inpaint" as const,
  model_variants: OWNER_SEEDREAM_IMAGE_VARIANTS,
  aspect_ratios: ASPECT_RATIOS,
  resolutions_by_variant: RESOLUTIONS,
  ui_declared_settings: {
    model_type: "seedream-5.0-pro" as const,
    resolution: "2K" as const,
    aspect_ratio: "1:1" as const,
    stream: false as const
  },
  effective_defaults: "UNPROVEN" as const,
  settings_cache_behavior: "UNPROVEN" as const,
  settings_reset_behavior: "UNPROVEN" as const,
  full_settings_store: "UNPROVEN" as const,
  cost_projection: {
    status: "SOURCE_JOINED_COST_QUERY_INPUTS" as const,
    declared_keys_by_variant: {
      "seedream-4": [] as const,
      "seedream-4.5": [] as const,
      "seedream-5": [] as const,
      "seedream-5.0-flash": [] as const,
      "seedream-5.0-pro": ["batch_size", "resolution"] as const
    },
    pro_batch_size_input: "can_reset ? 2 : 1" as const,
    pro_batch_size_confidence: "ROOT940_COST_UI_OVERRIDE_NOT_OUTPUT_COUNT" as const,
    pro_resolution_input: "EXPLICIT_EDITOR_PARAMETERS" as const,
    cost_query_only: true as const,
    generation_wire: "UNPROVEN" as const,
    quote_amount: "UNPROVEN" as const,
    billing_cap: "UNPROVEN" as const,
    generation_output_count: "UNPROVEN" as const,
    source_binding: {
      root: 940 as const,
      form_module: "seedream-editor.js" as const,
      form_sha256: "sha256:2026192d5b0f086446873996ad20cf4691f665d4019621eef3241887ffb3ad7c" as const,
      cost_module: "cost2.js" as const,
      cost_bytes: 1_660 as const,
      cost_sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9" as const,
      public_catalog_version: "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json" as const,
      settings_inventory_version: "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json" as const
    }
  },
  drawing_role: "IMAGE_EXTRA_NOT_MASK" as const,
  drawing_ownership: "UNBOUND" as const,
  mask_policy: "UNPROVEN" as const,
  result_history: "UNPROVEN" as const,
  source_binding: {
    build_id: "1791467421" as const,
    home_sha256: "a7a68e6ae96547333037962ab9bb3a40ddf7aeb912223d65a9962ab5ce6982da" as const,
    form_module: "seedream-editor.js" as const,
    form_sha256: "sha256:2026192d5b0f086446873996ad20cf4691f665d4019621eef3241887ffb3ad7c" as const,
    parent_module: "InpaintEditor.js" as const,
    parent_sha256: "sha256:87509acda1040d79927edc30d8ddd18d503a6e7ce9387d5d0a059b1eb5028e14" as const,
    generic_helper_module: "useInpaintTool.js" as const,
    generic_helper_sha256: "sha256:de8396adca45a5ba79c9c52cdfa91b23f45285645bed5df120c0f337a192deb2" as const,
    constants_module: "constants2.js" as const,
    constants_sha256: "sha256:636b6f8e15c847f346395027bc83dc3fddf22199d8ab07a32f98d5f0985ccecf" as const,
    settings_helper_module: "settings3.js" as const,
    settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" as const
  },
  runtime_usable: false as const,
  generation_allowed: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export type OwnerSeedreamEditorSourceParameters = typeof SOURCE_PARAMETERS;

export class OwnerSeedreamEditorParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Seedream Editor parameters are invalid.");
    this.name = "OwnerSeedreamEditorParametersError";
  }
}

/** Returns the pinned UI declaration only; local UI values are not effective defaults. */
export function getOwnerSeedreamEditorSourceParameters() {
  return SOURCE_PARAMETERS;
}

/** Validates and copies the two explicit editor controls without producing wire or generation authority. */
export function normalizeOwnerSeedreamEditorParameters(input: unknown): OwnerSeedreamEditorNormalizedIntent {
  const request = readExactRecord(input, ["variant", "parameters"]);
  if (!isVariant(request.variant)) invalid();
  const parameters = readExactRecord(request.parameters, ["aspect_ratio", "resolution"]);
  if (!isOneOf(parameters.aspect_ratio, ASPECT_RATIOS) || !isOneOf(parameters.resolution, RESOLUTIONS[request.variant])) invalid();
  return deepFreeze({
    variant: request.variant,
    parameters: { aspect_ratio: parameters.aspect_ratio, resolution: parameters.resolution }
  }) as OwnerSeedreamEditorNormalizedIntent;
}

/** Projects cost-query inputs only; can_reset is not generation count, spend authority, or a generation setting. */
export function projectOwnerSeedreamEditorCostParameters(input: unknown): OwnerSeedreamEditorCostParameters {
  const request = readExactRecord(input, ["variant", "parameters", "can_reset"]);
  if (typeof request.can_reset !== "boolean") invalid();
  const intent = normalizeOwnerSeedreamEditorParameters({ variant: request.variant, parameters: request.parameters });
  if (intent.variant !== "seedream-5.0-pro") return Object.freeze({});
  const batchSize: 1 | 2 = request.can_reset ? 2 : 1;
  return Object.freeze({ batch_size: batchSize, resolution: intent.parameters.resolution });
}

function readExactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== required.length || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !required.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isVariant(value: unknown): value is OwnerSeedreamEditorVariant {
  return typeof value === "string" && OWNER_SEEDREAM_IMAGE_VARIANTS.includes(value as OwnerSeedreamImageVariant);
}

function isOneOf<T>(value: unknown, values: readonly T[]): value is T {
  return values.includes(value as T);
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never {
  throw new OwnerSeedreamEditorParametersError("INVALID_PARAMETERS");
}
