import { isProxy } from "node:util/types";

export const OWNER_UNI_IMAGE_MODELS = Object.freeze([
  "uni-1", "uni-1.1-modify-image", "uni-1.1-remove-background"
] as const);

export type OwnerUniImageModel = typeof OWNER_UNI_IMAGE_MODELS[number];
export type OwnerUniImageMode = "auto" | "manga";
export type OwnerUniImageAutoAspectRatio = "3:1" | "2:1" | "16:9" | "3:2" | "1:1" | "4:3" | "2:3" | "3:4" | "9:16" | "1:2" | "1:3";
export type OwnerUniImageMangaAspectRatio = "9:16" | "2:3" | "1:2" | "1:3";
export type OwnerUniImageAspectRatio = OwnerUniImageAutoAspectRatio;

const AUTO_ASPECT_RATIOS = Object.freeze(["3:1", "2:1", "16:9", "3:2", "1:1", "4:3", "2:3", "3:4", "9:16", "1:2", "1:3"] as const);
const MANGA_ASPECT_RATIOS = Object.freeze(["9:16", "2:3", "1:2", "1:3"] as const);
const MODES = Object.freeze(["auto", "manga"] as const);
const MAX_SEED = 2_147_483_647;
const MAX_PROMPT_UTF16_UNITS = 6_000;
const HANDLE_PATTERN = /^uni_image_[0-9a-f-]{36}$/u;
const SOURCE_PINS = Object.freeze({
  public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
  use_luma_module: "useLuma.js",
  use_luma_build_id: "1791467421",
  use_luma_bytes: 4_865,
  use_luma_sha256: "sha256:f884e576649f4663919a079ac910e733f2e09e909262ee9e75bdf049e828f1d6",
  seed_helper_name: "currentRandomSeed",
  seed_helper_sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b",
  seed_helper_executed: false
} as const);
const SOURCE_MODELS = Object.freeze({
  "uni-1": Object.freeze({ reference_count: Object.freeze({ minimum: 0, maximum: 9 }), prompt_policy: "required", controls: Object.freeze(["aspect_ratio", "seed", "mode"]) }),
  "uni-1.1-modify-image": Object.freeze({ reference_count: Object.freeze({ minimum: 1, maximum: 8 }), prompt_policy: "required", controls: Object.freeze(["seed", "mode"]) }),
  "uni-1.1-remove-background": Object.freeze({ reference_count: Object.freeze({ minimum: 1, maximum: 1 }), prompt_policy: "optional_with_reference", controls: Object.freeze(["invert_mask"]) })
} as const);

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const SOURCE_PARAMETERS = deepFreeze({
  profile_id: "owner-uni-image-source-parameters-v1",
  models: OWNER_UNI_IMAGE_MODELS,
  controls: {
    aspect_ratio: { values: AUTO_ASPECT_RATIOS, manga_values: MANGA_ASPECT_RATIOS, mode_values: MODES,
      manga_outside_policy: "EXPLICIT_INVALID_NOT_UI_RESET_NORMALIZATION" },
    seed: { type: "nullable_integer", minimum: 0, maximum: MAX_SEED,
      source: SOURCE_PINS.seed_helper_name, source_sha256: SOURCE_PINS.seed_helper_sha256,
      explicit_value_policy: "NULL_OR_INTEGER_PRESERVED_NO_COERCION_OR_RANDOM_SUBSTITUTION" },
    mode: { values: MODES },
    invert_mask: { type: "boolean" }
  },
  models_by_id: SOURCE_MODELS,
  reference_selection: {
    ordering: "SELECTED_MAIN_FIRST_THEN_REMAINING_INPUT_ORDER",
    duplicates: "DUPLICATE_HANDLES_REJECTED; CANONICAL_URL_DEDUPLICATION_REMAINS_ASSET_ISSUER_CHECK",
    authority: "SOURCE_SELECTION_ONLY_NOT_OWNERSHIP_OR_PROVIDER_ACCEPTANCE"
  },
  prompt_policy: {
    max_utf16_units: MAX_PROMPT_UTF16_UNITS,
    length_rule: "JAVASCRIPT_UTF16_LENGTH_PLUS_ONE_PER_LINEFEED",
    required_variants: Object.freeze(["uni-1", "uni-1.1-modify-image"] as const),
    optional_variant: "uni-1.1-remove-background",
    optional_requires_reference: true,
    preserve_original_string: true,
    confidence: "SOURCE_UI_LOCAL_INPUT_RULE_NOT_PROVIDER_LIMIT"
  },
  custom_settings_fields_by_model: {
    "uni-1": Object.freeze(["model_type", "aspect_ratio", "seed", "mode"] as const),
    "uni-1.1-modify-image": Object.freeze(["model_type", "seed", "mode"] as const),
    "uni-1.1-remove-background": Object.freeze(["model_type", "invert_mask"] as const)
  },
  cost_routing: {
    declared_parameter_keys: Object.freeze(["model_type"] as const),
    projection: "ROUTING_MODEL_TYPE_ONLY_RESERVED_NOT_PRICE_QUOTE_BILLING_OR_ADMISSION"
  },
  source_pins: SOURCE_PINS,
  defaults: "NOT_INJECTED",
  hidden_ui_cache_fields: "NOT_INCLUDED",
  source_mapping_confidence: "ROOT787_ROOT789_ROOT798_STATIC_SOURCE_JOIN_NOT_PROVIDER_ACCEPTANCE",
  dispatch_allowed: false,
  runtime_activation: false,
  backend_acceptance: "UNPROVEN"
});

export type OwnerUniImageSourceParameters = DeepReadonly<typeof SOURCE_PARAMETERS>;

export interface OwnerUniImageParametersInput {
  readonly variant: OwnerUniImageModel;
  readonly prompt: string;
  readonly parameters: OwnerUniImageInputParameters;
  readonly image_reference_handles: readonly string[];
  readonly main_image_reference_handle: string | null;
}

export interface OwnerUni1ImageInputParameters {
  readonly aspect_ratio: OwnerUniImageAutoAspectRatio;
  readonly seed: number | null;
  readonly mode: OwnerUniImageMode;
}
export interface OwnerUniModifyImageInputParameters {
  readonly seed: number | null;
  readonly mode: OwnerUniImageMode;
}
export interface OwnerUniRemoveBackgroundInputParameters {
  readonly invert_mask: boolean;
}
export type OwnerUniImageInputParameters = OwnerUni1ImageInputParameters | OwnerUniModifyImageInputParameters | OwnerUniRemoveBackgroundInputParameters;

export type OwnerUniImageCustomSettings =
  | Readonly<{ model_type: "uni-1" } & OwnerUni1ImageInputParameters>
  | Readonly<{ model_type: "uni-1.1-modify-image" } & OwnerUniModifyImageInputParameters>
  | Readonly<{ model_type: "uni-1.1-remove-background" } & OwnerUniRemoveBackgroundInputParameters>;

export interface OwnerUniImageNormalizedParameters {
  readonly profile_id: typeof SOURCE_PARAMETERS.profile_id;
  readonly variant: OwnerUniImageModel;
  readonly model_id: OwnerUniImageModel;
  readonly ai_name: "luma_image";
  readonly model_type: OwnerUniImageModel;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly prompt: string;
  readonly prompt_local_max_utf16_units: 6_000;
  readonly prompt_limit_confidence: "SOURCE_UI_LOCAL_INPUT_RULE_NOT_PROVIDER_LIMIT";
  readonly parameters: OwnerUniImageInputParameters;
  readonly custom_settings: OwnerUniImageCustomSettings;
  readonly image_reference_handles: readonly string[];
  readonly ordered_image_reference_handles: readonly string[];
  readonly main_image_reference_handle: string | null;
  readonly reference_selection: Readonly<{
    requested_count: number;
    ordered_handles: readonly string[];
    main_handle: string | null;
    confidence: "SOURCE_SELECTION_ONLY_NOT_OWNERSHIP_OR_PROVIDER_ACCEPTANCE";
    owned_references_bound: false;
  }>;
  readonly cost_routing: Readonly<{
    ai_name: "luma_image";
    model_type: OwnerUniImageModel;
    declared_parameter_keys: readonly ["model_type"];
    confidence: "RESERVED_ROUTING_ONLY_NOT_QUOTE_OR_ADMISSION";
  }>;
  readonly cost_inputs: Readonly<Record<never, never>>;
  readonly source_binding: typeof SOURCE_PINS;
  readonly source_mapping_confidence: "ROOT787_ROOT789_ROOT798_STATIC_SOURCE_JOIN_NOT_PROVIDER_ACCEPTANCE";
  readonly defaults_injected: false;
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerUniImageParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("The owner Uni image parameters are invalid.");
    this.name = "OwnerUniImageParametersError";
  }
}

export function getOwnerUniImageSourceParameters(): OwnerUniImageSourceParameters {
  return SOURCE_PARAMETERS;
}

/** Validates explicit Uni source controls and opaque handle selection only; it grants no ownership or dispatch authority. */
export function normalizeOwnerUniImageParameters(input: OwnerUniImageParametersInput | unknown): OwnerUniImageNormalizedParameters {
  const request = readExactRecord(input, ["variant", "prompt", "parameters", "image_reference_handles", "main_image_reference_handle"]);
  if (!isModel(request.variant)) invalid();
  const variant = request.variant;
  const sourceModel = SOURCE_MODELS[variant];
  const handles = readExactArray(request.image_reference_handles, sourceModel.reference_count.minimum, sourceModel.reference_count.maximum);
  const checkedHandles = handles.map((handle) => readHandle(handle));
  if (new Set(checkedHandles).size !== checkedHandles.length) invalid();
  const mainHandle = request.main_image_reference_handle;
  if (!(mainHandle === null || (typeof mainHandle === "string" && HANDLE_PATTERN.test(mainHandle)))) invalid();

  let orderedHandles: readonly string[];
  if (variant === "uni-1.1-modify-image") {
    if (typeof mainHandle !== "string" || !checkedHandles.includes(mainHandle)) invalid();
    orderedHandles = Object.freeze([mainHandle, ...checkedHandles.filter((handle) => handle !== mainHandle)]);
  } else {
    if (mainHandle !== null) invalid();
    orderedHandles = Object.freeze([...checkedHandles]);
  }

  const prompt = readPrompt(request.prompt, sourceModel.prompt_policy, checkedHandles.length);
  const parameters = normalizeModelParameters(variant, request.parameters);
  const customSettings = buildCustomSettings(variant, parameters);
  return deepFreeze({
    profile_id: SOURCE_PARAMETERS.profile_id,
    variant,
    model_id: variant,
    ai_name: "luma_image" as const,
    model_type: variant,
    scope: "image" as const,
    operation_id: "generate-image" as const,
    prompt,
    prompt_local_max_utf16_units: MAX_PROMPT_UTF16_UNITS as 6_000,
    prompt_limit_confidence: "SOURCE_UI_LOCAL_INPUT_RULE_NOT_PROVIDER_LIMIT" as const,
    parameters,
    custom_settings: customSettings,
    image_reference_handles: Object.freeze(checkedHandles),
    ordered_image_reference_handles: orderedHandles,
    main_image_reference_handle: mainHandle as string | null,
    reference_selection: {
      requested_count: checkedHandles.length,
      ordered_handles: orderedHandles,
      main_handle: mainHandle as string | null,
      confidence: "SOURCE_SELECTION_ONLY_NOT_OWNERSHIP_OR_PROVIDER_ACCEPTANCE" as const,
      owned_references_bound: false as const
    },
    cost_routing: {
      ai_name: "luma_image" as const,
      model_type: variant,
      declared_parameter_keys: ["model_type"] as const,
      confidence: "RESERVED_ROUTING_ONLY_NOT_QUOTE_OR_ADMISSION" as const
    },
    cost_inputs: Object.freeze({}),
    source_binding: SOURCE_PINS,
    source_mapping_confidence: "ROOT787_ROOT789_ROOT798_STATIC_SOURCE_JOIN_NOT_PROVIDER_ACCEPTANCE" as const,
    defaults_injected: false as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function normalizeModelParameters(variant: OwnerUniImageModel, value: unknown): OwnerUniImageInputParameters {
  if (variant === "uni-1") {
    const fields = readExactRecord(value, ["aspect_ratio", "seed", "mode"]);
    if (!isMode(fields.mode) || !isSeed(fields.seed) || !isAutoAspectRatio(fields.aspect_ratio) ||
        (fields.mode === "manga" && !isMangaAspectRatio(fields.aspect_ratio))) invalid();
    return deepFreeze({ aspect_ratio: fields.aspect_ratio, seed: fields.seed, mode: fields.mode });
  }
  if (variant === "uni-1.1-modify-image") {
    const fields = readExactRecord(value, ["seed", "mode"]);
    if (!isMode(fields.mode) || !isSeed(fields.seed)) invalid();
    return deepFreeze({ seed: fields.seed, mode: fields.mode });
  }
  const fields = readExactRecord(value, ["invert_mask"]);
  if (typeof fields.invert_mask !== "boolean") invalid();
  return deepFreeze({ invert_mask: fields.invert_mask });
}

function buildCustomSettings(variant: OwnerUniImageModel, parameters: OwnerUniImageInputParameters): OwnerUniImageCustomSettings {
  if (variant === "uni-1") return deepFreeze({ model_type: variant, ...(parameters as OwnerUni1ImageInputParameters) });
  if (variant === "uni-1.1-modify-image") return deepFreeze({ model_type: variant, ...(parameters as OwnerUniModifyImageInputParameters) });
  return deepFreeze({ model_type: variant, ...(parameters as OwnerUniRemoveBackgroundInputParameters) });
}

function readPrompt(value: unknown, policy: "required" | "optional_with_reference", referenceCount: number): string {
  if (typeof value !== "string" || !isWellFormedUnicode(value) || PROMPT_CONTROL.test(value) ||
      value.length + (value.match(/\n/gu)?.length ?? 0) > MAX_PROMPT_UTF16_UNITS ||
      (policy === "required" && value.trim().length === 0) || (policy === "optional_with_reference" && referenceCount < 1)) invalid();
  return value;
}

const PROMPT_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/u;
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function readHandle(value: unknown): string {
  if (typeof value !== "string" || !HANDLE_PATTERN.test(value)) invalid();
  return value;
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
function readExactArray(value: unknown, minimum: number, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < minimum || value.length > maximum) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) invalid();
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) invalid();
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}
function isModel(value: unknown): value is OwnerUniImageModel { return typeof value === "string" && OWNER_UNI_IMAGE_MODELS.includes(value as OwnerUniImageModel); }
function isMode(value: unknown): value is OwnerUniImageMode { return typeof value === "string" && MODES.includes(value as OwnerUniImageMode); }
function isSeed(value: unknown): value is number | null { return value === null || (Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_SEED); }
function isAutoAspectRatio(value: unknown): value is OwnerUniImageAutoAspectRatio { return typeof value === "string" && AUTO_ASPECT_RATIOS.includes(value as OwnerUniImageAutoAspectRatio); }
function isMangaAspectRatio(value: unknown): value is OwnerUniImageMangaAspectRatio { return typeof value === "string" && MANGA_ASPECT_RATIOS.includes(value as OwnerUniImageMangaAspectRatio); }
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}
function invalid(): never { throw new OwnerUniImageParametersError("INVALID_PARAMETERS"); }
