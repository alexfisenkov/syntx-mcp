import { isProxy } from "node:util/types";
import { isDeepStrictEqual } from "node:util";
import { loadMaplessSettingsInventoryVersion } from "../catalog/mapless-settings-inventory.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { isOwnerWan27CurrentAudioAllowed, OWNER_WAN27_CURRENT_AUDIO_POLICY } from "./owner-wan27-current-audio-policy.js";

export const OWNER_WAN_T2V_GENERATION_MODEL_IDS = Object.freeze([
  "wan_26_t2v", "wan_27_t2v"
] as const);

export type OwnerWanT2vGenerationModel = typeof OWNER_WAN_T2V_GENERATION_MODEL_IDS[number];
export type OwnerWanT2vGenerationResolution = "720P" | "1080P";
export type OwnerWanT2vGenerationAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

export interface OwnerWan26T2vGenerationParameters {
  readonly resolution: OwnerWanT2vGenerationResolution;
  readonly aspect_ratio: OwnerWanT2vGenerationAspectRatio;
  readonly video_duration: number;
  readonly prompt_extend: boolean;
  readonly seed: number | null;
  readonly shot_type: "single" | "multi";
}

export interface OwnerWan27T2vGenerationParameters {
  readonly resolution: OwnerWanT2vGenerationResolution;
  readonly aspect_ratio: OwnerWanT2vGenerationAspectRatio;
  readonly video_duration: number;
  readonly prompt_extend: boolean;
  readonly seed: number | null;
  readonly native_audio: boolean;
}

export type OwnerWanT2vGenerationParameters =
  | OwnerWan26T2vGenerationParameters
  | OwnerWan27T2vGenerationParameters;

export type OwnerWanT2vGenerationIntent =
  | Readonly<{ model_id: "wan_26_t2v"; prompt: string; parameters: OwnerWan26T2vGenerationParameters }>
  | Readonly<{ model_id: "wan_27_t2v"; prompt: string; parameters: OwnerWan27T2vGenerationParameters }>;

export interface OwnerWanT2vGenerationModelSource {
  readonly model_id: OwnerWanT2vGenerationModel;
  readonly ai_name: "wan_video";
  readonly model_type_binding: "EXACT_PUBLIC_MODEL_ID";
  readonly settings_keys: readonly string[];
  readonly cost_query_keys: readonly ["video_duration", "resolution"];
  readonly branch_control: "shot_type:single|multi" | "native_audio:boolean";
  readonly static_status: "CURRENT_STATIC_SOURCE_METADATA_ONLY";
}

export interface OwnerWanT2vGenerationSourceContract {
  readonly status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT";
  readonly source_pins: Readonly<{
    public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
    public_models_sha256: "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667";
    settings_inventory_version: "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json";
    build_id: "1791811899";
    form_module: "wan-video.js";
    form_bytes: 19503;
    form_sha256: "sha256:e169fbee16360e0fef359bb96b3498e7ad2db9f43f37e362af138f2787a62f68";
    sender_module: "video.js";
    sender_sha256: "sha256:b5df2329cf5fbc9e1b1289d146695954fd8576aed04818baffa6fbaaff1f73de";
    runtime_catalog_not_promoted: "e551";
  }>;
  readonly current_audio_policy: typeof OWNER_WAN27_CURRENT_AUDIO_POLICY;
  readonly models: readonly OwnerWanT2vGenerationModelSource[];
  readonly controls: Readonly<{
    resolution: Readonly<{ values: readonly OwnerWanT2vGenerationResolution[]; effective_default: "UNKNOWN" }>;
    aspect_ratio: Readonly<{
      values: readonly OwnerWanT2vGenerationAspectRatio[];
      visibility: "ALL_ACTIVE_WAN_IDS_EXCEPT_wan_27_i2v";
      effective_default: "UNKNOWN";
    }>;
    video_duration: Readonly<{ minimum: 2; maximum: 15; unit: "INTEGER_SECONDS"; effective_default: "UNKNOWN" }>;
    prompt_extend: Readonly<{ type: "boolean"; effective_default: "UNKNOWN" }>;
    seed: Readonly<{ nullable: true; minimum: 0; maximum: 2_147_483_647; precision: 0; effective_default: "UNKNOWN" }>;
    initializer_candidates_only: Readonly<{
      aspect_ratio: "1:1";
      resolution: "1080P";
      video_duration: 5;
      prompt_extend: true;
      seed: null;
      shot_type: "single";
      native_audio: false;
    }>;
  }>;
  readonly cost_projection: Readonly<{
    declared_keys: readonly ["video_duration", "resolution"];
    value_mapping: "FORM_FIELD_VALUE_CANDIDATE_ONLY_COST_CALLER_NOT_JOINED";
    amount_or_quote: "UNPROVEN";
  }>;
  readonly caller_gaps: readonly [
    "CUSTOM_PAYLOAD_TO_VIDEO_SENDER_ARGUMENT_NOT_JOINED",
    "PROMPT_STRING_REPLACE_TRANSFORM_NOT_JOINED",
    "CHAT_ID_IS_BOUND_ONLY_BY_A_FUTURE_PRIVATE_OWNER_CONTEXT"
  ];
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWanT2vGenerationNormalizedIntent {
  readonly status: "SOURCE_REVIEWED_EXPLICIT_INTENT";
  readonly intent: OwnerWanT2vGenerationIntent;
  readonly cost_query_candidate: Readonly<{
    keys: readonly ["video_duration", "resolution"];
    values: Readonly<{ video_duration: number; resolution: OwnerWanT2vGenerationResolution }>;
    confidence: "DECLARED_KEYS_WITH_FORM_FIELD_VALUE_CANDIDATE_NOT_COST_CALLER_JOINED";
  }>;
  readonly source_pins: OwnerWanT2vGenerationSourceContract["source_pins"];
  readonly current_audio_policy?: typeof OWNER_WAN27_CURRENT_AUDIO_POLICY;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWanT2vGenerationWireCandidate {
  readonly method: "POST";
  readonly path: "video/generate";
  readonly query_candidate: Readonly<{ ai_name: "wan_video" }>;
  readonly settings_candidate: Readonly<{
    model_type: OwnerWanT2vGenerationModel;
    resolution: OwnerWanT2vGenerationResolution;
    aspect_ratio: OwnerWanT2vGenerationAspectRatio;
    video_duration: number;
    prompt_extend: boolean;
    seed: number | null;
    shot_type?: "single" | "multi";
    native_audio?: boolean;
    file_urls: readonly [];
  }>;
  readonly prompt_projection: "SOURCE_SENDER_APPLIES_UNJOINED_STRING_REPLACE";
  readonly status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED";
  readonly chat_id_bound: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

const PUBLIC_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
const PUBLIC_MODELS_SHA256 = "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const SETTINGS_INVENTORY_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;
const FORM_SHA256 = "sha256:e169fbee16360e0fef359bb96b3498e7ad2db9f43f37e362af138f2787a62f68" as const;
const SENDER_SHA256 = "sha256:b5df2329cf5fbc9e1b1289d146695954fd8576aed04818baffa6fbaaff1f73de" as const;
const RESOLUTIONS = Object.freeze(["720P", "1080P"] as const);
const ASPECT_RATIOS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"] as const);
const COMMON_INPUT_KEYS = Object.freeze([
  "resolution", "aspect_ratio", "video_duration", "prompt_extend", "seed"
] as const);
const COMMON_MODEL_SETTINGS_KEYS = Object.freeze([
  "aspect_ratio", "model_type", "prompt_extend", "resolution", "seed", "video_duration"
] as const);
const INVENTORY_MODEL_VALUE_KEYS = Object.freeze([
  "aspect_ratio", "audio_setting", "model_type", "native_audio", "prompt_extend", "resolution", "seed", "shot_type", "video_duration"
] as const);
const COST_QUERY_KEYS = Object.freeze(["video_duration", "resolution"] as const);
const MODEL_BRANCH_CONTROLS = Object.freeze({
  wan_26_t2v: "shot_type:single|multi",
  wan_27_t2v: "native_audio:boolean"
} as const);
const SOURCE_PINS = Object.freeze({
  public_catalog_version: PUBLIC_CATALOG_VERSION,
  public_models_sha256: PUBLIC_MODELS_SHA256,
  settings_inventory_version: SETTINGS_INVENTORY_VERSION,
  build_id: "1791811899",
  form_module: "wan-video.js",
  form_bytes: 19_503,
  form_sha256: FORM_SHA256,
  sender_module: "video.js",
  sender_sha256: SENDER_SHA256,
  runtime_catalog_not_promoted: "e551"
} as const);
const MODEL_SETTINGS_KEYS_26 = Object.freeze([
  ...COMMON_MODEL_SETTINGS_KEYS, "shot_type"
] as const);
const MODEL_SETTINGS_KEYS_27 = Object.freeze([
  ...COMMON_MODEL_SETTINGS_KEYS, "native_audio"
] as const);

export class OwnerWanT2vGenerationParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS" | "SOURCE_EVIDENCE_UNAVAILABLE") {
    super(code === "INVALID_PARAMETERS"
      ? "WAN T2V explicit parameters are invalid."
      : "Current WAN T2V source evidence is unavailable.");
    this.name = "OwnerWanT2vGenerationParametersError";
  }
}

/** Validates the local B066/1b48 archive and reports source controls; never enables runtime dispatch. */
export function getOwnerWanT2vGenerationParametersSource(): DeepReadonly<OwnerWanT2vGenerationSourceContract> {
  return buildSourceContract();
}

/** Validates a complete explicit 26/27 T2V intent without injecting cached or initializer defaults. */
export function normalizeOwnerWanT2vGenerationParameters(input: unknown): OwnerWanT2vGenerationNormalizedIntent {
  const request = readExactRecord(input, ["model_id", "prompt", "parameters"]);
  if (!isModel(request.model_id)) invalid();
  if (typeof request.prompt !== "string" || request.prompt.trim().length === 0 || !isWellFormedUnicode(request.prompt)) invalid();
  const modelId = request.model_id;
  const keys = modelId === "wan_26_t2v"
    ? [...COMMON_INPUT_KEYS, "shot_type"]
    : [...COMMON_INPUT_KEYS, "native_audio"];
  const raw = readExactRecord(request.parameters, keys);
  if (!isOneOf(raw.resolution, RESOLUTIONS) || !isOneOf(raw.aspect_ratio, ASPECT_RATIOS) ||
      !Number.isSafeInteger(raw.video_duration) || (raw.video_duration as number) < 2 ||
      (raw.video_duration as number) > 15 || typeof raw.prompt_extend !== "boolean" ||
      !(raw.seed === null || (Number.isSafeInteger(raw.seed) && (raw.seed as number) >= 0 &&
        (raw.seed as number) <= 2_147_483_647))) invalid();

  let intent: OwnerWanT2vGenerationIntent;
  if (modelId === "wan_26_t2v") {
    if (!isOneOf(raw.shot_type, ["single", "multi"] as const)) invalid();
    intent = deepFreeze({
      model_id: modelId,
      prompt: request.prompt,
      parameters: {
        resolution: raw.resolution,
        aspect_ratio: raw.aspect_ratio,
        video_duration: raw.video_duration as number,
        prompt_extend: raw.prompt_extend,
        seed: raw.seed as number | null,
        shot_type: raw.shot_type
      }
    });
  } else {
    if (!isOwnerWan27CurrentAudioAllowed(raw.native_audio)) invalid();
    intent = deepFreeze({
      model_id: modelId,
      prompt: request.prompt,
      parameters: {
        resolution: raw.resolution,
        aspect_ratio: raw.aspect_ratio,
        video_duration: raw.video_duration as number,
        prompt_extend: raw.prompt_extend,
        seed: raw.seed as number | null,
        native_audio: raw.native_audio
      }
    });
  }

  const source = buildSourceContract();
  const model = source.models.find((entry) => entry.model_id === modelId);
  if (!model) unavailable();
  return deepFreeze({
    status: "SOURCE_REVIEWED_EXPLICIT_INTENT" as const,
    intent,
    cost_query_candidate: {
      keys: COST_QUERY_KEYS,
      values: { video_duration: intent.parameters.video_duration, resolution: intent.parameters.resolution },
      confidence: "DECLARED_KEYS_WITH_FORM_FIELD_VALUE_CANDIDATE_NOT_COST_CALLER_JOINED" as const
    },
    source_pins: source.source_pins,
    ...(modelId === "wan_27_t2v" ? { current_audio_policy: OWNER_WAN27_CURRENT_AUDIO_POLICY } : {}),
    effective_defaults: "UNKNOWN" as const,
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

/** Produces only a non-dispatching source wire-shape candidate; chat identity and prompt transform remain unbound. */
export function projectOwnerWanT2vGenerationWireCandidate(input: unknown): DeepReadonly<OwnerWanT2vGenerationWireCandidate> {
  const candidate = readExactRecordWithOptional(input, [
    "status", "intent", "cost_query_candidate", "source_pins", "effective_defaults",
    "runtime_usable", "dispatch_allowed", "backend_acceptance"
  ], ["current_audio_policy"]);
  if (candidate.status !== "SOURCE_REVIEWED_EXPLICIT_INTENT" || candidate.effective_defaults !== "UNKNOWN" ||
      candidate.runtime_usable !== false || candidate.dispatch_allowed !== false ||
      candidate.backend_acceptance !== "UNPROVEN" || !isPlainRecord(candidate.intent)) invalid();
  const normalized = normalizeOwnerWanT2vGenerationParameters(candidate.intent);
  if (!isDeepStrictEqual(candidate.intent, normalized.intent)) invalid();
  if (normalized.intent.model_id === "wan_27_t2v") {
    if (!isDeepStrictEqual(candidate.current_audio_policy, OWNER_WAN27_CURRENT_AUDIO_POLICY)) invalid();
  } else if (candidate.current_audio_policy !== undefined) invalid();
  const cost = readExactRecord(candidate.cost_query_candidate, ["keys", "values", "confidence"]);
  const costValues = readExactRecord(cost.values, ["video_duration", "resolution"]);
  if (!sameStrings(cost.keys, COST_QUERY_KEYS) || cost.confidence !==
      "DECLARED_KEYS_WITH_FORM_FIELD_VALUE_CANDIDATE_NOT_COST_CALLER_JOINED" ||
      costValues.video_duration !== normalized.cost_query_candidate.values.video_duration ||
      costValues.resolution !== normalized.cost_query_candidate.values.resolution) invalid();
  const sourcePins = readExactRecord(candidate.source_pins, Object.keys(SOURCE_PINS));
  if (Object.keys(SOURCE_PINS).some((key) => sourcePins[key] !== SOURCE_PINS[key as keyof typeof SOURCE_PINS])) invalid();
  const { model_id: modelId, prompt: _prompt, parameters } = normalized.intent;
  const settings = {
    model_type: modelId,
    resolution: parameters.resolution,
    aspect_ratio: parameters.aspect_ratio,
    video_duration: parameters.video_duration,
    prompt_extend: parameters.prompt_extend,
    seed: parameters.seed,
    ...(modelId === "wan_26_t2v" ? { shot_type: parameters.shot_type } : { native_audio: parameters.native_audio }),
    file_urls: [] as const
  };
  return deepFreeze({
    method: "POST" as const,
    path: "video/generate" as const,
    query_candidate: { ai_name: "wan_video" as const },
    settings_candidate: settings,
    prompt_projection: "SOURCE_SENDER_APPLIES_UNJOINED_STRING_REPLACE" as const,
    status: "WIRE_SHAPE_CANDIDATE_NOT_DISPATCHED" as const,
    chat_id_bound: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function buildSourceContract(): DeepReadonly<OwnerWanT2vGenerationSourceContract> {
  try {
    const catalog = loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION);
    const inventory = loadMaplessSettingsInventoryVersion(SETTINGS_INVENTORY_VERSION);
    if (catalog.sources.models.canonical_sha256 !== PUBLIC_MODELS_SHA256 ||
        inventory.public_catalog.version !== PUBLIC_CATALOG_VERSION ||
        inventory.public_catalog.models_sha256 !== PUBLIC_MODELS_SHA256 ||
        inventory.build.id !== SOURCE_PINS.build_id) unavailable();
    const form = inventory.forms.find((entry) => entry.form_id === "wan-video");
    if (!form || form.module_name !== SOURCE_PINS.form_module || form.javascript.bytes !== SOURCE_PINS.form_bytes ||
        form.javascript.sha256 !== FORM_SHA256) unavailable();

    const models = OWNER_WAN_T2V_GENERATION_MODEL_IDS.map((modelId) => {
      const publicModel = catalog.models.find((entry) => entry.value === modelId);
      const row = inventory.models.find((entry) => entry.model_id === modelId);
      const expectedKeys = modelId === "wan_26_t2v" ? MODEL_SETTINGS_KEYS_26 : MODEL_SETTINGS_KEYS_27;
      if (!publicModel || !publicModel.active || publicModel.ai_name !== "wan_video" || !row || !row.active ||
          row.ai_name !== "wan_video" || row.form_id !== "wan-video" || row.settings_status !== "PUBLIC_SETTINGS_KNOWN" ||
          row.defaults_status !== "UNKNOWN" || !sameStringSet(row.model_value_settings_keys, INVENTORY_MODEL_VALUE_KEYS) ||
          !sameStringSet(row.payload_field_keys, ["model_type"]) || !Array.isArray(row.settings?.get_cost_params) ||
          !sameStrings(row.settings.get_cost_params, COST_QUERY_KEYS)) unavailable();
      return {
        model_id: modelId,
        ai_name: "wan_video" as const,
        model_type_binding: "EXACT_PUBLIC_MODEL_ID" as const,
        settings_keys: expectedKeys,
        cost_query_keys: COST_QUERY_KEYS,
        branch_control: MODEL_BRANCH_CONTROLS[modelId],
        static_status: "CURRENT_STATIC_SOURCE_METADATA_ONLY" as const
      };
    });
    return deepFreeze({
      status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT" as const,
      source_pins: SOURCE_PINS,
      current_audio_policy: OWNER_WAN27_CURRENT_AUDIO_POLICY,
      models,
      controls: {
        resolution: { values: RESOLUTIONS, effective_default: "UNKNOWN" as const },
        aspect_ratio: {
          values: ASPECT_RATIOS,
          visibility: "ALL_ACTIVE_WAN_IDS_EXCEPT_wan_27_i2v" as const,
          effective_default: "UNKNOWN" as const
        },
        video_duration: { minimum: 2 as const, maximum: 15 as const, unit: "INTEGER_SECONDS" as const, effective_default: "UNKNOWN" as const },
        prompt_extend: { type: "boolean" as const, effective_default: "UNKNOWN" as const },
        seed: { nullable: true as const, minimum: 0 as const, maximum: 2_147_483_647 as const, precision: 0 as const, effective_default: "UNKNOWN" as const },
        initializer_candidates_only: {
          aspect_ratio: "1:1" as const,
          resolution: "1080P" as const,
          video_duration: 5 as const,
          prompt_extend: true as const,
          seed: null,
          shot_type: "single" as const,
          native_audio: false as const
        }
      },
      cost_projection: {
        declared_keys: COST_QUERY_KEYS,
        value_mapping: "FORM_FIELD_VALUE_CANDIDATE_ONLY_COST_CALLER_NOT_JOINED" as const,
        amount_or_quote: "UNPROVEN" as const
      },
      caller_gaps: [
        "CUSTOM_PAYLOAD_TO_VIDEO_SENDER_ARGUMENT_NOT_JOINED",
        "PROMPT_STRING_REPLACE_TRANSFORM_NOT_JOINED",
        "CHAT_ID_IS_BOUND_ONLY_BY_A_FUTURE_PRIVATE_OWNER_CONTEXT"
      ] as const,
      effective_defaults: "UNKNOWN" as const,
      runtime_usable: false as const,
      dispatch_allowed: false as const,
      backend_acceptance: "UNPROVEN" as const
    });
  } catch (error) {
    if (error instanceof OwnerWanT2vGenerationParametersError && error.code === "SOURCE_EVIDENCE_UNAVAILABLE") throw error;
    unavailable();
  }
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

function readExactRecordWithOptional(value: unknown, required: readonly string[], optional: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value)) invalid();
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid(); }
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length < required.length || actual.length > required.length + optional.length ||
      required.some((key) => !actual.includes(key)) || actual.some((key) => typeof key !== "string" ||
        (!required.includes(key) && !optional.includes(key)) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
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

function isModel(value: unknown): value is OwnerWanT2vGenerationModel {
  return typeof value === "string" && (OWNER_WAN_T2V_GENERATION_MODEL_IDS as readonly string[]).includes(value);
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

function sameStrings(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function sameStringSet(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    expected.every((value) => actual.includes(value)) && new Set(actual).size === expected.length;
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

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never { throw new OwnerWanT2vGenerationParametersError("INVALID_PARAMETERS"); }
function unavailable(): never { throw new OwnerWanT2vGenerationParametersError("SOURCE_EVIDENCE_UNAVAILABLE"); }
