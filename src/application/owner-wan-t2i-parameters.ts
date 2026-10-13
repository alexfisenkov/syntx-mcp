import { isProxy } from "node:util/types";

export const OWNER_WAN_T2I_MODELS = Object.freeze(["wan_25_t2i_preview", "wan_26_t2i"] as const);
export type OwnerWanT2iModel = typeof OWNER_WAN_T2I_MODELS[number];
export type OwnerWanT2iAspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export type OwnerWanT2iResolution = "720P" | "1080P";

export interface OwnerWanT2iParameters {
  readonly aspect_ratio: OwnerWanT2iAspectRatio;
  readonly resolution: OwnerWanT2iResolution;
  readonly batch_size: 1 | 2 | 3 | 4;
  readonly prompt_extend: boolean;
  readonly seed: number | null;
  /** Required inactive UI state; the palette editor is not shown for either T2I model. */
  readonly color_palette: null;
  /** Required inactive UI state; bbox editing is limited to the two WAN 2.7 models. */
  readonly bbox_list: readonly [];
}

export interface OwnerWanT2iParametersInput {
  readonly model_id: OwnerWanT2iModel;
  readonly prompt: string;
  readonly parameters: OwnerWanT2iParameters;
}

export interface OwnerWanT2iModelSourceProfile {
  readonly model_id: OwnerWanT2iModel;
  readonly ai_name: "wan_image";
  readonly model_type: OwnerWanT2iModel;
  readonly model_type_binding: "EXACT_PUBLIC_MODEL_ID";
  readonly aspect_ratio: readonly OwnerWanT2iAspectRatio[];
  readonly resolution: readonly OwnerWanT2iResolution[];
  readonly reference_scope: "ZERO_REFERENCE_ONLY";
  readonly public_file_count: 0;
  readonly uploadable: false;
  readonly accepted_file_types: readonly [];
  readonly allowed_media_types: readonly [];
  readonly max_prompt_length: 1500;
}

export interface OwnerWanT2iSourceParameters {
  readonly model_ids: readonly OwnerWanT2iModel[];
  readonly models: readonly OwnerWanT2iModelSourceProfile[];
  readonly prompt: Readonly<{
    required: true;
    trimmed_nonempty: true;
    max_ui_units: 1500;
    unit: "JAVASCRIPT_UTF16_LENGTH_PLUS_ONE_PER_LINE_FEED";
    preserve_input_text: true;
    reject_malformed_unicode: true;
  }>;
  readonly controls: Readonly<{
    batch_size: Readonly<{ values: readonly [1, 2, 3, 4]; per_model_guard: false }>;
    prompt_extend: Readonly<{ type: "boolean"; effective_default: "UNKNOWN" }>;
    seed: Readonly<{ nullable_integer_min: 0; nullable_integer_max: 2_147_483_647; null_or_zero_semantics: "UNPROVEN" }>;
    color_palette: Readonly<{ required_explicit_value: null; meaning: "INACTIVE_UI_STATE_NOT_A_CALLER_CONTROL_OR_DEFAULT" }>;
    bbox_list: Readonly<{ required_explicit_value: readonly []; meaning: "INACTIVE_UI_STATE_NOT_A_CALLER_CONTROL_OR_DEFAULT" }>;
  }>;
  readonly cost: Readonly<{
    declared_get_cost_params: readonly ["size", "batch_size"];
    cost_inputs: readonly ["batch_size"];
    size: "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS";
    quote_billing_units_hard_cap: "UNPROVEN";
  }>;
  readonly source_pins: Readonly<{
    public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
    public_models_sha256: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444";
    form_build_id: "1791467421";
    form_sha256: "sha256:c1190674e29d4b943eaa3bfb3571a8716f4a9901de433fc423840aed393f11a3";
    settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe";
    cost_source_sha256: "sha256:12db4cc4e9cce28d915b6a7179f26be03967122edc791a393bfbc485b201c223";
    cost_helper_sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9";
    model_row_hash_codec: "SHA256_JSON_STRINGIFY_EXACT_RAW_PUBLIC_RECORD";
    model_row_sha256: Readonly<Record<OwnerWanT2iModel, string>>;
  }>;
  readonly effective_defaults: "UNKNOWN";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWanT2iNormalizedParameters {
  readonly status: "SOURCE_REVIEWED_CLIENT_INTENT";
  readonly source_bound_intent: OwnerWanT2iParametersInput;
  readonly source_projection_confidence: "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY";
  readonly cost_routing: Readonly<{ ai_name: "wan_image"; model_type: OwnerWanT2iModel }>;
  readonly cost_inputs: Readonly<{ batch_size: OwnerWanT2iParameters["batch_size"] }>;
  readonly cost_projection: "SOURCE_COST_KEYS_SIZE_BATCH_SIZE_SIZE_OMITTED";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

const RATIOS = Object.freeze(["1:1", "3:4", "4:3", "9:16", "16:9"] as const);
const RESOLUTIONS = Object.freeze(["720P", "1080P"] as const);
const MAX_PROMPT_UI_UNITS = 1_500;
const FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const MODEL_ROWS: Readonly<Record<OwnerWanT2iModel, string>> = Object.freeze({
  wan_25_t2i_preview: "85dd8513cc1fb51429fef15454ec7959935284734cbb4d0f58c7feb7e046883a",
  wan_26_t2i: "44ab97682526f0564452a190742c059754a16427e5b09ce5c4736d79e2000f6e"
});

const SOURCE_PARAMETERS = deepFreeze<OwnerWanT2iSourceParameters>({
  model_ids: [...OWNER_WAN_T2I_MODELS],
  models: [
    { model_id: "wan_25_t2i_preview", ai_name: "wan_image", model_type: "wan_25_t2i_preview",
      model_type_binding: "EXACT_PUBLIC_MODEL_ID", aspect_ratio: [...RATIOS], resolution: [...RESOLUTIONS],
      reference_scope: "ZERO_REFERENCE_ONLY", public_file_count: 0, uploadable: false,
      accepted_file_types: [], allowed_media_types: [], max_prompt_length: 1_500 },
    { model_id: "wan_26_t2i", ai_name: "wan_image", model_type: "wan_26_t2i",
      model_type_binding: "EXACT_PUBLIC_MODEL_ID", aspect_ratio: [...RATIOS], resolution: [...RESOLUTIONS],
      reference_scope: "ZERO_REFERENCE_ONLY", public_file_count: 0, uploadable: false,
      accepted_file_types: [], allowed_media_types: [], max_prompt_length: 1_500 }
  ],
  prompt: { required: true, trimmed_nonempty: true, max_ui_units: MAX_PROMPT_UI_UNITS,
    unit: "JAVASCRIPT_UTF16_LENGTH_PLUS_ONE_PER_LINE_FEED", preserve_input_text: true, reject_malformed_unicode: true },
  controls: {
    batch_size: { values: [1, 2, 3, 4], per_model_guard: false },
    prompt_extend: { type: "boolean", effective_default: "UNKNOWN" },
    seed: { nullable_integer_min: 0, nullable_integer_max: 2_147_483_647, null_or_zero_semantics: "UNPROVEN" },
    color_palette: { required_explicit_value: null, meaning: "INACTIVE_UI_STATE_NOT_A_CALLER_CONTROL_OR_DEFAULT" },
    bbox_list: { required_explicit_value: [], meaning: "INACTIVE_UI_STATE_NOT_A_CALLER_CONTROL_OR_DEFAULT" }
  },
  cost: {
    declared_get_cost_params: ["size", "batch_size"], cost_inputs: ["batch_size"],
    size: "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS", quote_billing_units_hard_cap: "UNPROVEN"
  },
  source_pins: {
    public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    public_models_sha256: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444",
    form_build_id: "1791467421", form_sha256: "sha256:c1190674e29d4b943eaa3bfb3571a8716f4a9901de433fc423840aed393f11a3",
    settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
    cost_source_sha256: "sha256:12db4cc4e9cce28d915b6a7179f26be03967122edc791a393bfbc485b201c223",
    cost_helper_sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9",
    model_row_hash_codec: "SHA256_JSON_STRINGIFY_EXACT_RAW_PUBLIC_RECORD",
    model_row_sha256: MODEL_ROWS
  },
  effective_defaults: "UNKNOWN", dispatch_allowed: false, runtime_activation: false, backend_acceptance: "UNPROVEN"
});

const INPUT_KEYS = Object.freeze(["model_id", "prompt", "parameters"]);
const PARAMETER_KEYS = Object.freeze([
  "aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "color_palette", "bbox_list"
]);

export class OwnerWanT2iParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS" = "INVALID_PARAMETERS") {
    super("WAN T2I explicit parameters are invalid.");
    this.name = "OwnerWanT2iParametersError";
  }
}

/** Static selected-source controls and identities only; it does not grant runtime dispatch. */
export function getOwnerWanT2iSourceParameters(): OwnerWanT2iSourceParameters {
  return SOURCE_PARAMETERS;
}

/** Normalize a full explicit source-reviewed intent; this is not a dispatch permit or provider contract. */
export function normalizeOwnerWanT2iParameters(input: unknown): OwnerWanT2iNormalizedParameters {
  const request = readExactRecord(input, INPUT_KEYS);
  if (!isWanT2iModel(request.model_id)) invalid();
  const modelId = request.model_id;
  const prompt = readPrompt(request.prompt);
  const raw = readExactRecord(request.parameters, PARAMETER_KEYS);
  const parameters = snapshotParameters(raw);
  const sourceBoundIntent = deepFreeze({ model_id: modelId, prompt, parameters });
  return deepFreeze({
    status: "SOURCE_REVIEWED_CLIENT_INTENT" as const,
    source_bound_intent: sourceBoundIntent,
    source_projection_confidence: "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY" as const,
    cost_routing: { ai_name: "wan_image" as const, model_type: modelId },
    cost_inputs: { batch_size: parameters.batch_size },
    cost_projection: "SOURCE_COST_KEYS_SIZE_BATCH_SIZE_SIZE_OMITTED" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function snapshotParameters(raw: Record<string, unknown>): OwnerWanT2iParameters {
  if (!isOneOf(raw.aspect_ratio, RATIOS) || !isOneOf(raw.resolution, RESOLUTIONS) ||
      !Number.isSafeInteger(raw.batch_size) || (raw.batch_size as number) < 1 || (raw.batch_size as number) > 4 ||
      typeof raw.prompt_extend !== "boolean" ||
      !(raw.seed === null || (Number.isSafeInteger(raw.seed) && (raw.seed as number) >= 0 && (raw.seed as number) <= 2_147_483_647)) ||
      raw.color_palette !== null) invalid();
  readExactArray(raw.bbox_list, 0);
  return deepFreeze({ aspect_ratio: raw.aspect_ratio, resolution: raw.resolution,
    batch_size: raw.batch_size as 1 | 2 | 3 | 4, prompt_extend: raw.prompt_extend,
    seed: raw.seed as number | null, color_palette: null, bbox_list: [] as const });
}

function readPrompt(value: unknown): string {
  if (typeof value !== "string" || !isWellFormedUnicode(value) || FORBIDDEN_CONTROLS.test(value) || value.trim().length === 0) invalid();
  const uiUnits = value.length + countLineFeeds(value);
  if (uiUnits > MAX_PROMPT_UI_UNITS) invalid();
  return value;
}

function countLineFeeds(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) === 0x0a) count += 1;
  return count;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function readExactArray(value: unknown, expectedLength: number): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== expectedLength) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== expectedLength + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= expectedLength ||
        !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) invalid();
  for (let index = 0; index < expectedLength; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
  }
  return [];
}

function isWanT2iModel(value: unknown): value is OwnerWanT2iModel {
  return typeof value === "string" && (OWNER_WAN_T2I_MODELS as readonly string[]).includes(value);
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function invalid(): never { throw new OwnerWanT2iParametersError(); }
