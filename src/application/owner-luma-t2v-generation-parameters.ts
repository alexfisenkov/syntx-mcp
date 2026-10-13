import { isProxy } from "node:util/types";
import { isDeepStrictEqual } from "node:util";
import { loadMaplessSettingsInventoryVersion } from "../catalog/mapless-settings-inventory.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";

export const OWNER_LUMA_T2V_GENERATION_MODEL_IDS = Object.freeze(["ray-3.14"] as const);

export type OwnerLumaT2vGenerationModel = typeof OWNER_LUMA_T2V_GENERATION_MODEL_IDS[number];
export type OwnerLumaT2vGenerationQuality = "360p" | "540p" | "720p" | "1080p";
export type OwnerLumaT2vGenerationAspectRatio = "9:16" | "3:4" | "1:1" | "4:3" | "16:9" | "21:9";
export type OwnerLumaT2vGenerationDuration = 5 | 10;

export interface OwnerLumaT2vGenerationParameters {
  readonly quality: OwnerLumaT2vGenerationQuality;
  readonly aspect_ratio: OwnerLumaT2vGenerationAspectRatio;
  readonly video_duration: OwnerLumaT2vGenerationDuration;
}

export interface OwnerLumaT2vGenerationIntent extends OwnerLumaT2vGenerationParameters {
  readonly model_id: OwnerLumaT2vGenerationModel;
  readonly mode: "text2video";
  readonly prompt: string;
}

export interface OwnerLumaT2vGenerationSourceContract {
  readonly status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_UI_ENUM_OBSERVATION";
  readonly source_pins: Readonly<{
    public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
    public_models_sha256: "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667";
    settings_inventory_version: "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json";
    build_id: "1791811899";
    form_module: "luma.js";
    form_bytes: 5847;
    form_sha256: "sha256:6581a04b6a9c2707070a9994f0fef31be7f5da366202ae65c3286cf09df8e588";
    sender_module: "video.js";
    sender_bytes: 8689;
    sender_sha256: "sha256:b5df2329cf5fbc9e1b1289d146695954fd8576aed04818baffa6fbaaff1f73de";
    runtime_catalog_not_promoted: "e551";
  }>;
  readonly models: readonly Readonly<{
    model_id: OwnerLumaT2vGenerationModel;
    ai_name: "luma";
    model_type_binding: "EXACT_PUBLIC_MODEL_ID";
    form_settings_keys: readonly ["aspect_ratio", "model_type", "quality", "video_duration"];
    payload_field_keys: readonly ["model_type", "quality"];
    cost_query_keys: readonly ["model_type", "quality", "video_duration"];
    static_status: "CURRENT_STATIC_SOURCE_METADATA_ONLY";
  }>[];
  readonly controls: Readonly<{
    quality: Readonly<{ values: readonly OwnerLumaT2vGenerationQuality[]; effective_default: "UNKNOWN" }>;
    aspect_ratio: Readonly<{ values: readonly OwnerLumaT2vGenerationAspectRatio[]; effective_default: "UNKNOWN" }>;
    video_duration: Readonly<{ values: readonly OwnerLumaT2vGenerationDuration[]; unit: "INTEGER_SECONDS"; effective_default: "UNKNOWN" }>;
    prompt: Readonly<{ source_max_length: 5000; local_bound: "LOCAL_RESOURCE_BOUND_UTF16" }>;
  }>;
  readonly ui_observation: Readonly<{
    source: "CURRENT_CHROME_UI_OWNER_OBSERVATION";
    combination_count: 48;
    count_method: "CARTESIAN_PRODUCT_DERIVED_FROM_INDEPENDENT_ENUMS";
    duration_values: readonly [5, 10];
    controls_enumerated_independently: true;
  }>;
  readonly cost_projection: Readonly<{
    declared_keys: readonly ["model_type", "quality", "video_duration"];
    caller_keys: readonly ["quality", "video_duration"];
    transport_owned_keys: readonly ["model_type"];
    value_mapping: "UI_OBSERVED_RUNTIME_REQUEST";
    amount_or_quote: "UNPROVEN";
  }>;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerLumaT2vGenerationNormalizedIntent {
  readonly status: "SOURCE_REVIEWED_EXPLICIT_INTENT";
  readonly intent: OwnerLumaT2vGenerationIntent;
  readonly cost_query_candidate: Readonly<{
    keys: readonly ["quality", "video_duration"];
    values: Readonly<{ quality: OwnerLumaT2vGenerationQuality; video_duration: OwnerLumaT2vGenerationDuration }>;
    confidence: "UI_OBSERVED_RUNTIME_REQUEST";
  }>;
  readonly prompt_bound: "LOCAL_RESOURCE_BOUND_UTF16";
  readonly source_pins: OwnerLumaT2vGenerationSourceContract["source_pins"];
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerLumaT2vGenerationWireCandidate {
  readonly method: "POST";
  readonly path: "video/generate";
  readonly query_candidate: Readonly<{ ai_name: "luma" }>;
  readonly body_candidate: Readonly<{
    prompt: string;
    settings: Readonly<{
      model_type: "ray-3.14";
      video_duration: OwnerLumaT2vGenerationDuration;
      quality: OwnerLumaT2vGenerationQuality;
      aspect_ratio: OwnerLumaT2vGenerationAspectRatio;
      gen_type: "text2video";
      file_urls: readonly [];
    }>;
  }>;
  readonly chat_id_bound: false;
  readonly status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

const PUBLIC_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
const PUBLIC_MODELS_SHA256 = "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const SETTINGS_INVENTORY_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;
const FORM_SHA256 = "sha256:6581a04b6a9c2707070a9994f0fef31be7f5da366202ae65c3286cf09df8e588" as const;
const SENDER_SHA256 = "sha256:b5df2329cf5fbc9e1b1289d146695954fd8576aed04818baffa6fbaaff1f73de" as const;
const QUALITIES = Object.freeze(["360p", "540p", "720p", "1080p"] as const);
const ASPECT_RATIOS = Object.freeze(["9:16", "3:4", "1:1", "4:3", "16:9", "21:9"] as const);
const VIDEO_DURATIONS = Object.freeze([5, 10] as const);
const FORM_SETTINGS_KEYS = Object.freeze(["aspect_ratio", "model_type", "quality", "video_duration"] as const);
const PAYLOAD_KEYS = Object.freeze(["model_type", "quality"] as const);
const COST_QUERY_KEYS = Object.freeze(["model_type", "quality", "video_duration"] as const);
const COST_CALLER_KEYS = Object.freeze(["quality", "video_duration"] as const);
const COST_TRANSPORT_OWNED_KEYS = Object.freeze(["model_type"] as const);
const SOURCE_PINS = Object.freeze({
  public_catalog_version: PUBLIC_CATALOG_VERSION,
  public_models_sha256: PUBLIC_MODELS_SHA256,
  settings_inventory_version: SETTINGS_INVENTORY_VERSION,
  build_id: "1791811899",
  form_module: "luma.js",
  form_bytes: 5847,
  form_sha256: FORM_SHA256,
  sender_module: "video.js",
  sender_bytes: 8689,
  sender_sha256: SENDER_SHA256,
  runtime_catalog_not_promoted: "e551"
} as const);
const PROMPT_SOURCE_MAX_LENGTH = 5000;

export class OwnerLumaT2vGenerationParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS" | "SOURCE_EVIDENCE_UNAVAILABLE") {
    super(code === "INVALID_PARAMETERS"
      ? "Luma T2V explicit parameters are invalid."
      : "Current Luma T2V source evidence is unavailable.");
    this.name = "OwnerLumaT2vGenerationParametersError";
  }
}

/** Validates the archived current catalog pair and reports the separately observed UI enum coverage. */
export function getOwnerLumaT2vGenerationParametersSource(): DeepReadonly<OwnerLumaT2vGenerationSourceContract> {
  return buildSourceContract();
}

/** Validates a complete explicit T2V request; no form initializer is promoted to a default. */
export function normalizeOwnerLumaT2vGenerationParameters(input: unknown): OwnerLumaT2vGenerationNormalizedIntent {
  const request = readExactRecord(input, ["model_id", "mode", "prompt", "quality", "aspect_ratio", "video_duration"]);
  if (request.model_id !== "ray-3.14" || request.mode !== "text2video" ||
      typeof request.prompt !== "string" || request.prompt.trim().length === 0 ||
      !isWellFormedUnicode(request.prompt) || hasForbiddenPromptControls(request.prompt) ||
      request.prompt.length > PROMPT_SOURCE_MAX_LENGTH ||
      !isOneOf(request.quality, QUALITIES) || !isOneOf(request.aspect_ratio, ASPECT_RATIOS) ||
      !isOneOf(request.video_duration, VIDEO_DURATIONS)) invalid();

  const source = buildSourceContract();
  const intent = deepFreeze({
    model_id: "ray-3.14" as const,
    mode: "text2video" as const,
    prompt: request.prompt,
    quality: request.quality,
    aspect_ratio: request.aspect_ratio,
    video_duration: request.video_duration
  });
  return deepFreeze({
    status: "SOURCE_REVIEWED_EXPLICIT_INTENT" as const,
    intent,
    cost_query_candidate: {
      keys: COST_CALLER_KEYS,
      values: { quality: intent.quality, video_duration: intent.video_duration },
      confidence: "UI_OBSERVED_RUNTIME_REQUEST" as const
    },
    prompt_bound: "LOCAL_RESOURCE_BOUND_UTF16" as const,
    source_pins: source.source_pins,
    effective_defaults: "UNKNOWN" as const,
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

/** Projects the observed pilot body shape for review; it does not bind chat identity or authorize dispatch. */
export function projectOwnerLumaT2vGenerationWireCandidate(input: unknown): DeepReadonly<OwnerLumaT2vGenerationWireCandidate> {
  const candidate = readExactRecord(input, [
    "status", "intent", "cost_query_candidate", "prompt_bound", "source_pins", "effective_defaults",
    "runtime_usable", "dispatch_allowed", "backend_acceptance"
  ]);
  if (candidate.status !== "SOURCE_REVIEWED_EXPLICIT_INTENT" || candidate.prompt_bound !== "LOCAL_RESOURCE_BOUND_UTF16" ||
      candidate.effective_defaults !== "UNKNOWN" || candidate.runtime_usable !== false ||
      candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN") invalid();
  const normalized = normalizeOwnerLumaT2vGenerationParameters(candidate.intent);
  if (!isDeepStrictEqual(candidate.intent, normalized.intent)) invalid();
  const cost = readExactRecord(candidate.cost_query_candidate, ["keys", "values", "confidence"]);
  const costValues = readExactRecord(cost.values, COST_CALLER_KEYS);
  if (!sameStrings(cost.keys, COST_CALLER_KEYS) || cost.confidence !== "UI_OBSERVED_RUNTIME_REQUEST" ||
      costValues.quality !== normalized.intent.quality ||
      costValues.video_duration !== normalized.intent.video_duration) invalid();
  const sourcePins = readExactRecord(candidate.source_pins, Object.keys(SOURCE_PINS));
  if (Object.keys(SOURCE_PINS).some((key) => sourcePins[key] !== SOURCE_PINS[key as keyof typeof SOURCE_PINS])) invalid();
  const { intent } = normalized;
  return deepFreeze({
    method: "POST" as const,
    path: "video/generate" as const,
    query_candidate: { ai_name: "luma" as const },
    body_candidate: {
      prompt: intent.prompt,
      settings: {
        model_type: intent.model_id,
        video_duration: intent.video_duration,
        quality: intent.quality,
        aspect_ratio: intent.aspect_ratio,
        gen_type: "text2video" as const,
        file_urls: [] as const
      }
    },
    chat_id_bound: false as const,
    status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function buildSourceContract(): DeepReadonly<OwnerLumaT2vGenerationSourceContract> {
  try {
    const catalog = loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION);
    const inventory = loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION);
    if (catalog.sources.models.canonical_sha256 !== PUBLIC_MODELS_SHA256 ||
        inventory.public_catalog.version !== PUBLIC_CATALOG_VERSION ||
        inventory.public_catalog.models_sha256 !== PUBLIC_MODELS_SHA256 || inventory.build.id !== SOURCE_PINS.build_id) unavailable();
    const form = inventory.forms.find((entry) => entry.form_id === "luma");
    const model = catalog.models.find((entry) => entry.value === "ray-3.14");
    const row = inventory.models.find((entry) => entry.model_id === "ray-3.14");
    if (!form || form.module_name !== SOURCE_PINS.form_module || form.javascript.bytes !== SOURCE_PINS.form_bytes ||
        form.javascript.sha256 !== FORM_SHA256 || form.javascript.parse_diagnostics !== 0 ||
        !sameStringSet(form.javascript.model_value_settings_keys, FORM_SETTINGS_KEYS) ||
        !model || !model.active || model.ai_name !== "luma" || !model.default ||
        !row || !row.active || !row.default || row.ai_name !== "luma" || row.form_id !== "luma" ||
        row.settings_status !== "PUBLIC_SETTINGS_KNOWN" || row.defaults_status !== "UNKNOWN" ||
        !sameStringSet(row.model_value_settings_keys, FORM_SETTINGS_KEYS) || !sameStrings(row.payload_field_keys, PAYLOAD_KEYS) ||
        !row.settings || !sameStrings(row.settings.get_cost_params, COST_QUERY_KEYS) ||
        row.settings.min_video_duration !== 5 || row.settings.max_video_duration !== 10 ||
        !sameStrings(enumValues(row.settings.quality), QUALITIES) || !sameStrings(enumValues(row.settings.aspect_ratio), ASPECT_RATIOS)) unavailable();
    return deepFreeze({
      status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_UI_ENUM_OBSERVATION" as const,
      source_pins: SOURCE_PINS,
      models: [{
        model_id: "ray-3.14" as const,
        ai_name: "luma" as const,
        model_type_binding: "EXACT_PUBLIC_MODEL_ID" as const,
        form_settings_keys: FORM_SETTINGS_KEYS,
        payload_field_keys: PAYLOAD_KEYS,
        cost_query_keys: COST_QUERY_KEYS,
        static_status: "CURRENT_STATIC_SOURCE_METADATA_ONLY" as const
      }],
      controls: {
        quality: { values: QUALITIES, effective_default: "UNKNOWN" as const },
        aspect_ratio: { values: ASPECT_RATIOS, effective_default: "UNKNOWN" as const },
        video_duration: { values: VIDEO_DURATIONS, unit: "INTEGER_SECONDS" as const, effective_default: "UNKNOWN" as const },
        prompt: { source_max_length: PROMPT_SOURCE_MAX_LENGTH as 5000, local_bound: "LOCAL_RESOURCE_BOUND_UTF16" as const }
      },
      ui_observation: {
        source: "CURRENT_CHROME_UI_OWNER_OBSERVATION" as const,
        combination_count: 48 as const,
        count_method: "CARTESIAN_PRODUCT_DERIVED_FROM_INDEPENDENT_ENUMS" as const,
        duration_values: VIDEO_DURATIONS,
        controls_enumerated_independently: true as const
      },
      cost_projection: {
        declared_keys: COST_QUERY_KEYS,
        caller_keys: COST_CALLER_KEYS,
        transport_owned_keys: COST_TRANSPORT_OWNED_KEYS,
        value_mapping: "UI_OBSERVED_RUNTIME_REQUEST" as const,
        amount_or_quote: "UNPROVEN" as const
      },
      effective_defaults: "UNKNOWN" as const,
      runtime_usable: false as const,
      dispatch_allowed: false as const,
      backend_acceptance: "UNPROVEN" as const
    });
  } catch (error) {
    if (error instanceof OwnerLumaT2vGenerationParametersError && error.code === "SOURCE_EVIDENCE_UNAVAILABLE") throw error;
    unavailable();
  }
}

function enumValues(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => isPlainRecord(item) && typeof item.value === "string" ? item.value : "");
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

function isOneOf<T extends string | number>(value: unknown, choices: readonly T[]): value is T {
  return choices.includes(value as T);
}

function sameStrings(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function sameStringSet(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && expected.every((value) => actual.includes(value)) && new Set(actual).size === expected.length;
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

function hasForbiddenPromptControls(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never { throw new OwnerLumaT2vGenerationParametersError("INVALID_PARAMETERS"); }
function unavailable(): never { throw new OwnerLumaT2vGenerationParametersError("SOURCE_EVIDENCE_UNAVAILABLE"); }
