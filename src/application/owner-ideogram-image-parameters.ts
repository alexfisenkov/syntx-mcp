import { isProxy } from "node:util/types";

export const OWNER_IDEOGRAM_IMAGE_CONTEXTS = Object.freeze([
  Object.freeze({ model_id: "ideogram", mode: "generate" }),
  Object.freeze({ model_id: "ideogram", mode: "remix" }),
  Object.freeze({ model_id: "ideogram", mode: "reframe" }),
  Object.freeze({ model_id: "ideogram", mode: "replace_background" }),
  Object.freeze({ model_id: "ideogram", mode: "character_reference" }),
  Object.freeze({ model_id: "ideogram_40", mode: "generate" }),
  Object.freeze({ model_id: "ideogram_40", mode: "transparent" }),
  Object.freeze({ model_id: "ideogram_45", mode: "generate" }),
  Object.freeze({ model_id: "ideogram_45", mode: "precise_edit" })
] as const);

export type OwnerIdeogramImageModelId = "ideogram" | "ideogram_40" | "ideogram_45";
export type OwnerIdeogramImageMode = typeof OWNER_IDEOGRAM_IMAGE_CONTEXTS[number]["mode"];
export type OwnerIdeogramImageContext = typeof OWNER_IDEOGRAM_IMAGE_CONTEXTS[number];
export type OwnerIdeogramImageParameterInput = OwnerIdeogramImageContext & Readonly<{
  reference_count: number;
  mask_present: boolean;
  prompt: string | null;
  parameters: Readonly<Record<string, unknown>>;
}>;

const BASE_RATIOS = Object.freeze([
  "1:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "10:16", "16:10", "CUSTOM"
] as const);
const EXPANDED_RATIOS = Object.freeze([
  "1:1", "1:3", "1:2", "3:1", "2:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "10:16", "16:10"
] as const);
const IDEOGRAM_RESOLUTIONS = Object.freeze([
  "512x1536", "576x1408", "576x1472", "576x1536", "640x1344", "640x1408", "640x1472", "640x1536",
  "704x1152", "704x1216", "704x1280", "704x1344", "704x1408", "704x1472", "736x1312", "768x1088",
  "768x1216", "768x1280", "768x1344", "800x1280", "832x960", "832x1024", "832x1088", "832x1152",
  "832x1216", "832x1248", "864x1152", "896x960", "896x1024", "896x1088", "896x1120", "896x1152",
  "960x832", "960x896", "960x1024", "960x1088", "1024x832", "1024x896", "1024x960", "1024x1024",
  "1088x768", "1088x832", "1088x896", "1088x960", "1120x896", "1152x704", "1152x832", "1152x864",
  "1152x896", "1216x704", "1216x768", "1216x832", "1248x832", "1280x704", "1280x768", "1280x800",
  "1312x736", "1344x640", "1344x704", "1344x768", "1408x576", "1408x640", "1408x704", "1472x576",
  "1472x640", "1472x704", "1536x512", "1536x576", "1536x640"
] as const);
const SPEEDS = Object.freeze(["TURBO", "DEFAULT", "QUALITY"] as const);
const V45_SPEEDS = Object.freeze(["TURBO", "DEFAULT", "QUALITY", "FLASH"] as const);
const STYLE_TYPES = Object.freeze(["AUTO", "GENERAL", "REALISTIC", "DESIGN", "FICTION"] as const);
const MAGIC_PROMPTS = Object.freeze(["AUTO", "ON", "OFF"] as const);
const SOURCE_PROFILE = deepFreeze({
  profile_id: "ideogram-image-source-parameters-v1",
  contexts: OWNER_IDEOGRAM_IMAGE_CONTEXTS,
  ratios: {
    ideogram: BASE_RATIOS,
    ideogram_40_generate: Object.freeze([null, ...EXPANDED_RATIOS] as const),
    ideogram_40_transparent: EXPANDED_RATIOS,
    ideogram_45_generate: EXPANDED_RATIOS
  },
  resolutions: {
    ideogram_generate_remix_character_reference_reframe: IDEOGRAM_RESOLUTIONS,
    ideogram_40_generate: Object.freeze(["1K", "2K"] as const),
    ideogram_40_transparent: Object.freeze(["1K", "2K", "4K", "8K"] as const),
    ideogram_45_generate: Object.freeze(["1K", "2K"] as const)
  },
  speed_options: { base_and_40: SPEEDS, ideogram_45: V45_SPEEDS, flash_requires_image: true },
  num_images: { minimum: 1, maximum: 8, integer_only: true, no_default_or_clamp: true },
  seed: { minimum: 0, maximum: 2_147_483_647, integer_only: true, nullable: true, confidence: "SOURCE_UI_CANDIDATE_NOT_BACKEND_LIMIT" as const },
  reference_count: {
    ideogram_generate: { minimum: 0, maximum: 5, source_validation_discourages_exactly: 1 },
    ideogram_remix_reframe_replace_background_character_reference: { exact: 1 },
    ideogram_40_generate: { minimum: 0, maximum: 1 },
    ideogram_40_transparent: { exact: 0 },
    ideogram_45_generate: { minimum: 0, maximum: 5 },
    ideogram_45_precise_edit: {
      minimum: 1, maximum_unmasked_references: 5, maximum_masked_references: 4, maximum_upload_slots: 5,
      mask_optional: true, mask_takes_slot: true,
      reference_cap_confidence: "SOURCE_FORM_AND_PUBLIC_SETTINGS_METADATA_NOT_PROVIDER_ACCEPTANCE" as const
    }
  },
  prompt_policy: { required_in_all_contexts_except: "ideogram/reframe" as const, reframe: "disabled" as const },
  style_type: STYLE_TYPES,
  magic_prompt: MAGIC_PROMPTS,
  image_weight: { minimum: 1, maximum: 100, fractional_values_allowed: true },
  color_palette: {
    shapes: Object.freeze(["named_preset", "custom_members"] as const),
    custom_local_limits: { members_minimum: 1, members_maximum: 32, hex_characters_maximum: 32, weight_minimum: 0, weight_maximum: 100 },
    preset_name_maximum: 200
  },
  cost_declared_keys: {
    ideogram: Object.freeze(["rendering_speed", "batch_size"] as const),
    ideogram_40: Object.freeze(["rendering_speed", "mode", "resolution", "batch_size"] as const),
    ideogram_45: Object.freeze(["rendering_speed", "ref_count", "batch_size"] as const)
  },
  cost_callback_projection: {
    batch_size: "EXPLICIT_NUM_IMAGES",
    ideogram_45_ref_count: "ORIGINAL_IMAGE_REFERENCE_COUNT_IF_NONZERO_MASK_EXCLUDED",
    ideogram_40_mode: "TRANSPARENT_BRANCH_ONLY_GENERATE_UNDEFINED_OMITTED",
    quote_or_billing: "UNPROVEN"
  },
  custom_source_bounds: { prompt_maximum: 10_000, negative_prompt_maximum: 5_000, style_preset_name_maximum: 200 },
  source_pins: {
    public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    form_build_id: "1791467421",
    form_module_sha256: "sha256:fb8f93597c1dc69fa811e48f5d3218ef5724d9f2f1dd175a3a63f320f930274a",
    helper_module_sha256: "sha256:d4ad75ddd2336d24cba03e1b32dc162d18ff8d7ff4b15b91ab4fd83175dcc5ac",
    source_execution: false
  },
  effective_defaults: "UNKNOWN_NOT_FILLED_FROM_UI_INITIALIZER_CANDIDATES" as const,
  cost_input_mapping: "SOURCE_CALLBACK_FIELDS_MAPPED_PRICE_AND_BACKEND_UNPROVEN" as const,
  dispatch_allowed: false as const,
  runtime_activation: false as const,
  backend_acceptance: "UNPROVEN" as const,
  source_mapping_confidence: "STATIC_SOURCE_POLICY_NOT_RENDERED_UI_OR_PROVIDER_ACCEPTANCE" as const
});

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerIdeogramImageNormalizedParameters {
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly prompt_policy: "required" | "disabled";
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly reference_intent: Readonly<{ reference_count: number; mask_present: boolean; ownership_bound: false; generation_permit: false }>;
  readonly source_json_mapping: Readonly<Record<string, unknown>>;
  readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly cost_input_confidence: "SOURCE_CALLBACK_INPUTS_ONLY_PRICE_AND_BILLING_UNPROVEN";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly source_mapping_confidence: "STATIC_SOURCE_POLICY_NOT_RENDERED_UI_OR_PROVIDER_ACCEPTANCE";
}

export class OwnerIdeogramImageParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Ideogram image parameters are invalid.");
    this.name = "OwnerIdeogramImageParametersError";
  }
}

type ContextSpec = {
  readonly prompt: "required" | "disabled";
  readonly minimumReferences: number;
  readonly maximumReferences: number;
  readonly maximumUploadSlots?: number;
  readonly mask: "forbidden" | "optional-slot";
  readonly format?: { readonly ratios: readonly (string | null)[]; readonly resolutions: readonly string[]; readonly ratioRequired: boolean };
  readonly supported: readonly string[];
  readonly required: readonly string[];
  readonly apiMode?: "transparent" | "precise_edit";
  readonly settingFlag?: "reframe_mode" | "replace_background_mode" | "character_reference_mode";
  readonly validationOnly?: readonly string[];
};

const CORE = ["rendering_speed", "num_images", "seed"] as const;
const BASE_GENERATE_SUPPORT = Object.freeze([
  ...CORE, "aspect_ratio", "resolution", "magic_prompt", "negative_prompt", "style_type", "style_preset", "color_palette"
] as const);

function getContextSpec(model: string, mode: string, referenceCount: number): ContextSpec | undefined {
  if (model === "ideogram") {
    if (mode === "generate") return {
      prompt: "required", minimumReferences: 0, maximumReferences: 5, mask: "forbidden",
      format: { ratios: BASE_RATIOS, resolutions: IDEOGRAM_RESOLUTIONS, ratioRequired: true },
      supported: [...BASE_GENERATE_SUPPORT], required: ["rendering_speed", "num_images", "aspect_ratio", "resolution"]
    };
    if (mode === "remix") return {
      prompt: "required", minimumReferences: 1, maximumReferences: 1, mask: "forbidden",
      format: { ratios: BASE_RATIOS, resolutions: IDEOGRAM_RESOLUTIONS, ratioRequired: true },
      supported: [...BASE_GENERATE_SUPPORT, "image_weight"],
      required: ["rendering_speed", "num_images", "aspect_ratio", "resolution", "image_weight"]
    };
    if (mode === "reframe") return {
      prompt: "disabled", minimumReferences: 1, maximumReferences: 1, mask: "forbidden",
      format: { ratios: [], resolutions: IDEOGRAM_RESOLUTIONS, ratioRequired: false },
      supported: ["rendering_speed", "num_images", "seed", "resolution", "style_preset", "color_palette"],
      required: ["rendering_speed", "num_images", "resolution"], settingFlag: "reframe_mode", validationOnly: ["style_type"]
    };
    if (mode === "replace_background") return {
      prompt: "required", minimumReferences: 1, maximumReferences: 1, mask: "forbidden",
      supported: ["rendering_speed", "num_images", "seed", "magic_prompt", "style_preset", "color_palette"],
      required: ["rendering_speed", "num_images"], settingFlag: "replace_background_mode", validationOnly: ["style_type"]
    };
    if (mode === "character_reference") return {
      prompt: "required", minimumReferences: 1, maximumReferences: 1, mask: "forbidden",
      format: { ratios: BASE_RATIOS, resolutions: IDEOGRAM_RESOLUTIONS, ratioRequired: true },
      supported: ["rendering_speed", "num_images", "seed", "aspect_ratio", "resolution", "negative_prompt", "style_type", "magic_prompt"],
      required: ["rendering_speed", "num_images", "aspect_ratio", "resolution"], settingFlag: "character_reference_mode"
    };
    return undefined;
  }
  if (model === "ideogram_40") {
    if (mode === "generate") {
      const withImage = referenceCount > 0;
      const supported = ["rendering_speed", "num_images", "seed", "aspect_ratio", "resolution", "magic_prompt"];
      if (withImage) supported.push("image_weight_auto", "image_weight");
      return {
        prompt: "required", minimumReferences: 0, maximumReferences: 1, mask: "forbidden",
        format: { ratios: [null, ...EXPANDED_RATIOS], resolutions: ["1K", "2K"], ratioRequired: true },
        supported: withImage ? supported.filter(key => key !== "magic_prompt") : supported,
        required: ["rendering_speed", "num_images", "aspect_ratio", "resolution"]
      };
    }
    if (mode === "transparent") return {
      prompt: "required", minimumReferences: 0, maximumReferences: 0, mask: "forbidden",
      format: { ratios: EXPANDED_RATIOS, resolutions: ["1K", "2K", "4K", "8K"], ratioRequired: true },
      supported: ["rendering_speed", "num_images", "seed", "aspect_ratio", "resolution", "magic_prompt"],
      required: ["rendering_speed", "num_images", "aspect_ratio", "resolution"], apiMode: "transparent"
    };
    return undefined;
  }
  if (model === "ideogram_45") {
    if (mode === "generate") return {
      prompt: "required", minimumReferences: 0, maximumReferences: 5, mask: "forbidden",
      format: { ratios: EXPANDED_RATIOS, resolutions: ["1K", "2K"], ratioRequired: true },
      supported: ["rendering_speed", "num_images", "seed", "aspect_ratio", "resolution", "magic_prompt"],
      required: ["rendering_speed", "num_images", "aspect_ratio", "resolution"]
    };
    if (mode === "precise_edit") return {
      prompt: "required", minimumReferences: 1, maximumReferences: 5, maximumUploadSlots: 5, mask: "optional-slot",
      supported: ["rendering_speed", "num_images", "seed"], required: ["rendering_speed", "num_images"], apiMode: "precise_edit"
    };
  }
  return undefined;
}

export function getOwnerIdeogramImageParameterProfile(): DeepReadonly<typeof SOURCE_PROFILE> { return SOURCE_PROFILE; }

/** Validates explicit source-shaped intent only; references are counts, not owned assets or generation permission. */
export function normalizeOwnerIdeogramImageParameters(input: unknown): OwnerIdeogramImageNormalizedParameters {
  const request = readExactRecord(input, ["model_id", "mode", "reference_count", "mask_present", "prompt", "parameters"]);
  if (!isModelId(request.model_id) || typeof request.mode !== "string" || typeof request.mask_present !== "boolean") invalid();
  if (!Number.isSafeInteger(request.reference_count) || (request.reference_count as number) < 0 || (request.reference_count as number) > 5) invalid();
  const referenceCount = request.reference_count as number;
  const context = getContextSpec(request.model_id, request.mode, referenceCount);
  if (!context || referenceCount < context.minimumReferences || referenceCount > context.maximumReferences) invalid();
  if (context.mask === "forbidden" && request.mask_present !== false) invalid();
  if (context.mask === "optional-slot" && request.mask_present === true && referenceCount + 1 > (context.maximumUploadSlots ?? context.maximumReferences)) invalid();
  const promptPolicy = context.prompt;
  if (promptPolicy === "required") {
    if (typeof request.prompt !== "string" || request.prompt.trim().length === 0 || request.prompt.length > 10_000) invalid();
  } else if (request.prompt !== null) invalid();

  const allowed = [...context.supported];
  if (context.validationOnly) allowed.push(...context.validationOnly);
  if (context.format?.ratioRequired) allowed.push("aspect_ratio");
  if (context.format && context.format.resolutions.length > 0) allowed.push("resolution");
  const parameters = readExactRecord(request.parameters, context.required, allowed);
  validateParameters(request.model_id, request.mode, referenceCount, context, parameters);

  const parameterSnapshot = deepFreeze(cloneParameters(parameters));
  const sourceJsonMapping = mapSourceSettings(request.model_id, parameters, context);
  const costInputs = projectCostInputs(request.model_id, parameters, context, referenceCount);
  return deepFreeze({
    model_id: request.model_id, mode: request.mode as OwnerIdeogramImageMode, prompt_policy: promptPolicy,
    parameters: parameterSnapshot,
    reference_intent: { reference_count: referenceCount, mask_present: request.mask_present, ownership_bound: false as const, generation_permit: false as const },
    source_json_mapping: sourceJsonMapping, cost_inputs: costInputs,
    cost_input_confidence: "SOURCE_CALLBACK_INPUTS_ONLY_PRICE_AND_BILLING_UNPROVEN" as const,
    dispatch_allowed: false as const, runtime_activation: false as const, backend_acceptance: "UNPROVEN" as const,
    source_mapping_confidence: "STATIC_SOURCE_POLICY_NOT_RENDERED_UI_OR_PROVIDER_ACCEPTANCE" as const
  });
}

function validateParameters(model: OwnerIdeogramImageModelId, mode: string, referenceCount: number, context: ContextSpec, params: Record<string, unknown>): void {
  const speeds = model === "ideogram_45" ? V45_SPEEDS : SPEEDS;
  if (!oneOf(params.rendering_speed, speeds) || (params.rendering_speed === "FLASH" && referenceCount < 1)) invalid();
  if (!Number.isInteger(params.num_images) || (params.num_images as number) < 1 || (params.num_images as number) > 8) invalid();
  if (Object.hasOwn(params, "seed")) {
    if (params.seed !== null && (!Number.isSafeInteger(params.seed) || (params.seed as number) < 0 || (params.seed as number) > 2_147_483_647)) invalid();
    if (model === "ideogram_40" && mode === "generate" && referenceCount > 0 && params.seed !== null) invalid();
  }
  if (context.format) {
    if (context.format.ratioRequired ? !context.format.ratios.includes(params.aspect_ratio as string | null) : Object.hasOwn(params, "aspect_ratio")) invalid();
    if (context.format.resolutions.length > 0 && !context.format.resolutions.includes(params.resolution as string)) invalid();
    if (model === "ideogram_45" && mode === "generate" && params.resolution === "1K" && ["1:3", "3:1"].includes(params.aspect_ratio as string)) invalid();
  }
  if (model === "ideogram" && mode === "generate" && referenceCount === 1) invalid();
  if (mode === "remix" && (!inRange(params.image_weight, 1, 100) || !Number.isFinite(params.image_weight))) invalid();
  if (model === "ideogram_40" && mode === "generate" && referenceCount > 0) {
    if (params.image_weight_auto !== undefined && typeof params.image_weight_auto !== "boolean") invalid();
    if (params.image_weight_auto === false) {
      if (params.aspect_ratio !== null || !inRange(params.image_weight, 1, 100)) invalid();
    } else if (params.image_weight !== undefined && params.image_weight !== null) invalid();
  }
  if (Object.hasOwn(params, "magic_prompt") && params.magic_prompt !== null && !oneOf(params.magic_prompt, MAGIC_PROMPTS)) invalid();
  if (Object.hasOwn(params, "style_type")) {
    if (params.style_type !== null && !oneOf(params.style_type, STYLE_TYPES)) invalid();
    if (mode === "character_reference" && ["GENERAL", "DESIGN"].includes(params.style_type as string)) invalid();
    if (mode !== "character_reference" && params.style_type === "FICTION") invalid();
  }
  if (Object.hasOwn(params, "style_preset")) {
    if (params.style_preset !== null && (typeof params.style_preset !== "string" || params.style_preset.trim().length === 0 || params.style_preset.length > 200)) invalid();
    if (params.style_preset !== null && mode === "generate" && referenceCount > 0) invalid();
    if (params.style_preset !== null && (!Object.hasOwn(params, "style_type") || !["AUTO", "GENERAL"].includes(params.style_type as string))) invalid();
  }
  if (context.validationOnly?.includes("style_type") && Object.hasOwn(params, "style_type") &&
      (!Object.hasOwn(params, "style_preset") || params.style_preset === null)) invalid();
  if (Object.hasOwn(params, "negative_prompt") && params.negative_prompt !== null &&
      (typeof params.negative_prompt !== "string" || params.negative_prompt.length > 5_000)) invalid();
  if (Object.hasOwn(params, "color_palette") && params.color_palette !== null) snapshotPalette(params.color_palette);
}

function mapSourceSettings(model: OwnerIdeogramImageModelId, params: Record<string, unknown>, context: ContextSpec): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  result.model_type = model;
  for (const key of context.supported) {
    if (key === "image_weight_auto" || key === "color_palette") continue;
    if (!Object.hasOwn(params, key) || params[key] === null || params[key] === "") continue;
    if (key === "aspect_ratio" && params.aspect_ratio === "CUSTOM") continue;
    if (key === "style_preset" && Object.hasOwn(params, "style_type") && !["AUTO", "GENERAL"].includes(params.style_type as string)) continue;
    result[key] = params[key];
  }
  if (Object.hasOwn(params, "color_palette") && params.color_palette !== null) result.color_palette = mapPalette(params.color_palette);
  if (context.settingFlag) result[context.settingFlag] = true;
  if (context.apiMode) result.mode = context.apiMode;
  return deepFreeze(result);
}

function projectCostInputs(model: OwnerIdeogramImageModelId, params: Record<string, unknown>, context: ContextSpec, referenceCount: number): Readonly<Record<string, string | number>> {
  const result: Record<string, string | number> = {};
  result.rendering_speed = params.rendering_speed as string;
  if (model === "ideogram") {
    result.batch_size = params.num_images as number;
  } else if (model === "ideogram_40") {
    if (context.apiMode) result.mode = context.apiMode;
    if (Object.hasOwn(params, "resolution")) result.resolution = params.resolution as string;
    result.batch_size = params.num_images as number;
  } else {
    if (referenceCount > 0) result.ref_count = referenceCount;
    result.batch_size = params.num_images as number;
  }
  return deepFreeze(result);
}

function snapshotPalette(value: unknown): Readonly<Record<string, unknown>> {
  const palette = readExactRecord(value, ["kind"], ["kind", "name", "colors"]);
  if (palette.kind === "preset") {
    const preset = readExactRecord(value, ["kind", "name"]);
    if (typeof preset.name !== "string" || preset.name.trim().length === 0 || preset.name.length > 200) invalid();
    return deepFreeze({ kind: "preset", name: preset.name });
  }
  if (palette.kind === "custom") {
    const custom = readExactRecord(value, ["kind", "colors"]);
    const colors = readExactArray(custom.colors, 1, 32);
    const snapshot = colors.map((item) => {
      const color = readExactRecord(item, ["color_hex", "color_weight"]);
      if (typeof color.color_hex !== "string" || color.color_hex.length === 0 || color.color_hex.length > 32 ||
          !inRange(color.color_weight, 0, 100) || !Number.isFinite(color.color_weight)) invalid();
      return Object.freeze({ color_hex: color.color_hex, color_weight: color.color_weight as number });
    });
    return deepFreeze({ kind: "custom", colors: snapshot });
  }
  return invalid();
}

function mapPalette(value: unknown): Readonly<{ name: string } | { members: readonly Readonly<{ color_hex: string; color_weight: number }>[] }> {
  const palette = snapshotPalette(value);
  if (palette.kind === "preset") return deepFreeze({ name: palette.name as string });
  return deepFreeze({ members: (palette.colors as readonly Readonly<{ color_hex: string; color_weight: number }>[]) ?? invalid() });
}

function cloneParameters(params: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(params)) copy[key] = key === "color_palette" && params[key] !== null ? snapshotPalette(params[key]) : params[key];
  return copy;
}

function readExactRecord(value: unknown, required: readonly string[], allowed: readonly string[] = required): Record<string, unknown> {
  if (!isPlainRecord(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.some(key => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) ||
      required.some(key => !Object.hasOwn(descriptors, key))) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function readExactArray(value: unknown, min: number, max: number): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !keys.includes("length") || keys.some(key => key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) invalid();
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) result.push(descriptors[String(index)]!.value);
  return Object.freeze(result);
}
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isModelId(value: unknown): value is OwnerIdeogramImageModelId { return value === "ideogram" || value === "ideogram_40" || value === "ideogram_45"; }
function oneOf<T>(value: unknown, values: readonly T[]): value is T { return values.includes(value as T); }
function inRange(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum; }
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}
function invalid(): never { throw new OwnerIdeogramImageParametersError("INVALID_PARAMETERS"); }
