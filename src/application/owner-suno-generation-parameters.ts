import { isDeepStrictEqual } from "node:util";
import { isProxy } from "node:util/types";
import { loadMaplessSettingsInventoryVersion } from "../catalog/mapless-settings-inventory.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";

export const OWNER_SUNO_GENERATION_PUBLIC_VERSION =
  "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
export const OWNER_SUNO_GENERATION_SETTINGS_VERSION =
  "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;

export const OWNER_SUNO_GENERATION_MODEL_IDS = Object.freeze(["V6", "V6_wild"] as const);
export type OwnerSunoGenerationModel = typeof OWNER_SUNO_GENERATION_MODEL_IDS[number];

export interface OwnerSunoGenerationRequest {
  readonly model_id: OwnerSunoGenerationModel;
  readonly mode: "generate";
  readonly prompt: string;
  readonly is_custom_mode: boolean;
  readonly is_instrumental: boolean;
  readonly negative_tags: string;
  readonly styles: string;
  readonly title: string;
}

export interface OwnerSunoGenerationSettingsCandidate {
  readonly model_type: OwnerSunoGenerationModel;
  readonly mode: "generate";
  readonly is_custom_mode: boolean;
  readonly is_instrumental: boolean;
  readonly negative_tags: string;
  readonly styles: string;
  readonly title: string;
}

export interface OwnerSunoGenerationSourcePins {
  readonly public_catalog_version: typeof OWNER_SUNO_GENERATION_PUBLIC_VERSION;
  readonly public_models_sha256: "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667";
  readonly settings_inventory_version: typeof OWNER_SUNO_GENERATION_SETTINGS_VERSION;
  readonly build_id: "1791811899";
  readonly form_module: "suno.js";
  readonly form_bytes: 44_975;
  readonly form_sha256: "sha256:3b4eb9ade783591aaf8087289e29f09c06ee8d54be827395e9d19613c62574b3";
}

export interface OwnerSunoGenerationSourceModel {
  readonly model_id: OwnerSunoGenerationModel;
  readonly ai_name: "suno";
  readonly active: true;
  readonly defaults_status: "UNKNOWN";
  readonly model_value_settings_keys: readonly [
    "is_custom_mode", "is_instrumental", "model_type", "negative_tags", "styles", "title"
  ];
  readonly payload_field_keys: readonly ["model_type"];
  readonly settings_limits: Readonly<{
    simple_mode_prompt_length: 500;
    custom_mode_prompt_length: 5_000;
    style_prompt_limit: 1_000;
    title_limit: 80;
  }>;
}

export interface OwnerSunoGenerationParameterSource {
  readonly profile_id: "owner-suno-generate-parameters-source-v1";
  readonly status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT";
  readonly source_pins: OwnerSunoGenerationSourcePins;
  readonly model_ids: readonly OwnerSunoGenerationModel[];
  readonly models: Readonly<Record<OwnerSunoGenerationModel, OwnerSunoGenerationSourceModel>>;
  readonly controls: Readonly<{
    mode: Readonly<{ supported_value: "generate" }>;
    prompt: Readonly<{
      measure: "UTF16_CODE_UNITS";
      simple_max: 500;
      custom_max: 5_000;
      nonblank: true;
      nonblank_policy: "LOCAL_VALIDATION_POLICY_NOT_UI_VALIDATOR";
      effective_default: "UNKNOWN";
    }>;
    is_custom_mode: Readonly<{ type: "boolean"; effective_default: "UNKNOWN" }>;
    is_instrumental: Readonly<{ type: "boolean"; effective_default: "UNKNOWN" }>;
    negative_tags: Readonly<{
      local_max: 5_000;
      measure: "UTF16_CODE_UNITS";
      bound_label: "LOCAL_RESOURCE_BOUND_NOT_UI_LIMIT";
      source_ui_limit: "UNKNOWN";
    }>;
    styles: Readonly<{ max: 1_000; effective_default: "UNKNOWN" }>;
    title: Readonly<{ max: 80; effective_default: "UNKNOWN" }>;
  }>;
  readonly cost_projection: Readonly<{
    declared_cost_query_keys: readonly ["version"];
    generation_value_mapping: "UNPROVEN_NOT_INCLUDED_IN_GENERATE_SETTINGS";
  }>;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerSunoNormalizedGenerationParameters {
  readonly profile_id: OwnerSunoGenerationParameterSource["profile_id"];
  readonly model_id: OwnerSunoGenerationModel;
  readonly mode: "generate";
  readonly prompt: string;
  readonly settings_candidate: OwnerSunoGenerationSettingsCandidate;
  readonly source_pins: OwnerSunoGenerationSourcePins;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const PUBLIC_MODELS_SHA256 =
  "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const FORM_SHA256 =
  "sha256:3b4eb9ade783591aaf8087289e29f09c06ee8d54be827395e9d19613c62574b3" as const;
const FORM_MODULE = "suno.js" as const;
const FORM_BYTES = 44_975 as const;
const SIMPLE_PROMPT_MAX = 500;
const CUSTOM_PROMPT_MAX = 5_000;
const STYLE_MAX = 1_000;
const TITLE_MAX = 80;
const NEGATIVE_TAGS_LOCAL_MAX = 5_000;
const REQUEST_KEYS = Object.freeze([
  "model_id", "mode", "prompt", "is_custom_mode", "is_instrumental", "negative_tags", "styles", "title"
] as const);
const MODEL_VALUE_SETTINGS_KEYS = Object.freeze([
  "is_custom_mode", "is_instrumental", "model_type", "negative_tags", "styles", "title"
] as const);
const MODEL_PAYLOAD_FIELD_KEYS = Object.freeze(["model_type"] as const);
const SOURCE_PINS: OwnerSunoGenerationSourcePins = Object.freeze({
  public_catalog_version: OWNER_SUNO_GENERATION_PUBLIC_VERSION,
  public_models_sha256: PUBLIC_MODELS_SHA256,
  settings_inventory_version: OWNER_SUNO_GENERATION_SETTINGS_VERSION,
  build_id: "1791811899",
  form_module: FORM_MODULE,
  form_bytes: FORM_BYTES,
  form_sha256: FORM_SHA256
});

export class OwnerSunoGenerationParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS" | "SOURCE_EVIDENCE_UNAVAILABLE") {
    super(code === "INVALID_PARAMETERS"
      ? "Suno generate parameters are invalid."
      : "Current Suno source evidence is unavailable.");
    this.name = "OwnerSunoGenerationParametersError";
  }
}

/** Reads only the pinned static source pair; this report never enables dispatch. */
export function getOwnerSunoGenerationParameterSource(): DeepReadonly<OwnerSunoGenerationParameterSource> {
  return buildSourceProfile();
}

/** Validates one complete explicit generate intent without injecting effective defaults or enabling dispatch. */
export function normalizeOwnerSunoGenerationParameters(
  input: unknown
): DeepReadonly<OwnerSunoNormalizedGenerationParameters> {
  const request = readExactRecord(input, REQUEST_KEYS);
  if (!isModel(request.model_id) || request.mode !== "generate" ||
      typeof request.is_custom_mode !== "boolean" || typeof request.is_instrumental !== "boolean") invalid();
  const modelId = request.model_id;
  if (typeof request.prompt !== "string" || request.prompt.trim().length === 0 ||
      !isWellFormedUnicode(request.prompt)) invalid();
  const promptMax = request.is_custom_mode ? CUSTOM_PROMPT_MAX : SIMPLE_PROMPT_MAX;
  if (request.prompt.length > promptMax) invalid();
  if (typeof request.negative_tags !== "string" || !isWellFormedUnicode(request.negative_tags) ||
      request.negative_tags.length > NEGATIVE_TAGS_LOCAL_MAX) invalid();
  if (typeof request.styles !== "string" || !isWellFormedUnicode(request.styles) ||
      request.styles.length > STYLE_MAX) invalid();
  if (typeof request.title !== "string" || !isWellFormedUnicode(request.title) ||
      request.title.length > TITLE_MAX) invalid();

  const source = buildSourceProfile();
  if (!source.models[modelId]) unavailable();
  return deepFreeze({
    profile_id: source.profile_id,
    model_id: modelId,
    mode: "generate" as const,
    prompt: request.prompt,
    settings_candidate: {
      model_type: modelId,
      mode: "generate" as const,
      is_custom_mode: request.is_custom_mode,
      is_instrumental: request.is_instrumental,
      negative_tags: request.negative_tags,
      styles: request.styles,
      title: request.title
    },
    source_pins: source.source_pins,
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function buildSourceProfile(): DeepReadonly<OwnerSunoGenerationParameterSource> {
  try {
    const catalog = loadPublicCatalogVersion(OWNER_SUNO_GENERATION_PUBLIC_VERSION);
    const inventory = loadMaplessSettingsInventoryVersion(OWNER_SUNO_GENERATION_SETTINGS_VERSION);
    if (catalog.sources.models.canonical_sha256 !== PUBLIC_MODELS_SHA256 ||
        inventory.public_catalog.version !== OWNER_SUNO_GENERATION_PUBLIC_VERSION ||
        inventory.public_catalog.models_sha256 !== PUBLIC_MODELS_SHA256 ||
        inventory.build.id !== SOURCE_PINS.build_id) unavailable();

    const form = inventory.forms.find((entry) => entry.form_id === "suno");
    if (!form || form.module_name !== FORM_MODULE || form.javascript.bytes !== FORM_BYTES ||
        form.javascript.sha256 !== FORM_SHA256 || form.javascript.parse_diagnostics !== 0 ||
        !sameStrings(form.javascript.model_value_settings_keys, MODEL_VALUE_SETTINGS_KEYS)) unavailable();

    const models = {} as Record<OwnerSunoGenerationModel, OwnerSunoGenerationSourceModel>;
    for (const modelId of OWNER_SUNO_GENERATION_MODEL_IDS) {
      const publicModel = catalog.models.find((entry) => entry.value === modelId);
      const settingsModel = inventory.models.find((entry) => entry.model_id === modelId);
      if (!publicModel || !publicModel.active || publicModel.ai_name !== "suno" || publicModel.default ||
          !settingsModel || !settingsModel.active || settingsModel.ai_name !== "suno" ||
          settingsModel.form_id !== "suno" || settingsModel.settings_status !== "PUBLIC_SETTINGS_KNOWN" ||
          settingsModel.defaults_status !== "UNKNOWN" ||
          !sameStrings(settingsModel.model_value_settings_keys, MODEL_VALUE_SETTINGS_KEYS) ||
          !sameStrings(settingsModel.payload_field_keys, MODEL_PAYLOAD_FIELD_KEYS) ||
          !isPlainRecord(publicModel.settings) || !isPlainRecord(settingsModel.settings) ||
          !isDeepStrictEqual(publicModel.settings, settingsModel.settings)) unavailable();
      validatePublicSettings(publicModel.settings);
      models[modelId] = {
        model_id: modelId,
        ai_name: "suno",
        active: true,
        defaults_status: "UNKNOWN",
        model_value_settings_keys: MODEL_VALUE_SETTINGS_KEYS,
        payload_field_keys: MODEL_PAYLOAD_FIELD_KEYS,
        settings_limits: {
          simple_mode_prompt_length: SIMPLE_PROMPT_MAX,
          custom_mode_prompt_length: CUSTOM_PROMPT_MAX,
          style_prompt_limit: STYLE_MAX,
          title_limit: TITLE_MAX
        }
      };
    }

    return deepFreeze({
      profile_id: "owner-suno-generate-parameters-source-v1" as const,
      status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT" as const,
      source_pins: SOURCE_PINS,
      model_ids: OWNER_SUNO_GENERATION_MODEL_IDS,
      models,
      controls: {
        mode: { supported_value: "generate" as const },
        prompt: {
          measure: "UTF16_CODE_UNITS" as const,
          simple_max: SIMPLE_PROMPT_MAX as 500,
          custom_max: CUSTOM_PROMPT_MAX as 5_000,
          nonblank: true as const,
          nonblank_policy: "LOCAL_VALIDATION_POLICY_NOT_UI_VALIDATOR" as const,
          effective_default: "UNKNOWN" as const
        },
        is_custom_mode: { type: "boolean" as const, effective_default: "UNKNOWN" as const },
        is_instrumental: { type: "boolean" as const, effective_default: "UNKNOWN" as const },
        negative_tags: {
          local_max: NEGATIVE_TAGS_LOCAL_MAX as 5_000,
          measure: "UTF16_CODE_UNITS" as const,
          bound_label: "LOCAL_RESOURCE_BOUND_NOT_UI_LIMIT" as const,
          source_ui_limit: "UNKNOWN" as const
        },
        styles: { max: STYLE_MAX as 1_000, effective_default: "UNKNOWN" as const },
        title: { max: TITLE_MAX as 80, effective_default: "UNKNOWN" as const }
      },
      cost_projection: {
        declared_cost_query_keys: ["version"] as const,
        generation_value_mapping: "UNPROVEN_NOT_INCLUDED_IN_GENERATE_SETTINGS" as const
      },
      effective_defaults: "UNKNOWN" as const,
      runtime_usable: false as const,
      dispatch_allowed: false as const,
      backend_acceptance: "UNPROVEN" as const
    });
  } catch (error) {
    if (error instanceof OwnerSunoGenerationParametersError && error.code === "SOURCE_EVIDENCE_UNAVAILABLE") throw error;
    unavailable();
  }
}

function validatePublicSettings(settings: Record<string, unknown>): void {
  if (!Array.isArray(settings.allowed_modes) || !settings.allowed_modes.includes("generate") ||
      settings.simple_mode_prompt_length !== SIMPLE_PROMPT_MAX ||
      settings.custom_mode_prompt_length !== CUSTOM_PROMPT_MAX ||
      settings.style_prompt_limit !== STYLE_MAX || settings.title_limit !== TITLE_MAX ||
      !sameStrings(settings.get_cost_params, ["version"])) unavailable();
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value)) invalid();
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid(); }
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) record[key] = descriptors[key]!.value;
  return record;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || isProxy(value) || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch { return false; }
}

function isModel(value: unknown): value is OwnerSunoGenerationModel {
  return typeof value === "string" && (OWNER_SUNO_GENERATION_MODEL_IDS as readonly string[]).includes(value);
}

function sameStrings(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index]);
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

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never {
  throw new OwnerSunoGenerationParametersError("INVALID_PARAMETERS");
}

function unavailable(): never {
  throw new OwnerSunoGenerationParametersError("SOURCE_EVIDENCE_UNAVAILABLE");
}
