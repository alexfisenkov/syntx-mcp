import { types } from "node:util";

export const OWNER_SUNO_TRACK_OPERATION_PUBLIC_VERSION =
  "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
export const OWNER_SUNO_TRACK_OPERATION_SETTINGS_VERSION =
  "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;

export const OWNER_SUNO_TRACK_OPERATION_MODEL_IDS = Object.freeze(["V6", "V6_wild"] as const);
export const OWNER_SUNO_TRACK_OPERATION_MODES = Object.freeze(["cover", "extend"] as const);
export type OwnerSunoTrackOperationModel = typeof OWNER_SUNO_TRACK_OPERATION_MODEL_IDS[number];
export type OwnerSunoTrackOperationMode = typeof OWNER_SUNO_TRACK_OPERATION_MODES[number];

const PUBLIC_MODELS_SHA256 =
  "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const FORM_SHA256 = "sha256:23d8a074cb2a4579f52671a0dc4fe8a99ec7bbae925bfd5f5f0e8d4db5e6effa" as const;
const SETTINGS_HELPER_SHA256 = "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6" as const;
const COST_HELPER_SHA256 = "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa" as const;
const COST_SERVICE_SHA256 = "sha256:261d93d75b204703201d1d0c3cf0ce747832159ef44f818cdd44ebee27c07ada" as const;
const FORM_MODULE = "suno.js" as const;
const FORM_BUILD_ID = "1791904852" as const;
const SIMPLE_PROMPT_MAX = 500;
const CUSTOM_PROMPT_MAX = 5_000;
const STYLE_MAX = 1_000;
const TITLE_MAX = 80;
const NEGATIVE_TAGS_LOCAL_MAX = 5_000;
const TRACK_HANDLE = /^track_[0-9a-f-]{36}$/u;
const BASE_KEYS = Object.freeze([
  "model_id", "mode", "track_handle", "prompt", "is_custom_mode", "is_instrumental", "negative_tags", "styles", "title"
] as const);

export interface OwnerSunoTrackOperationSourcePins {
  readonly public_catalog_version: typeof OWNER_SUNO_TRACK_OPERATION_PUBLIC_VERSION;
  readonly public_models_sha256: typeof PUBLIC_MODELS_SHA256;
  readonly settings_inventory_version: typeof OWNER_SUNO_TRACK_OPERATION_SETTINGS_VERSION;
  readonly form: Readonly<{
    build_id: typeof FORM_BUILD_ID;
    module: typeof FORM_MODULE;
    bytes: 44_975;
    sha256: typeof FORM_SHA256;
  }>;
  readonly settings_helper: Readonly<{ module: "settings3.js"; bytes: 4_155; sha256: typeof SETTINGS_HELPER_SHA256 }>;
  readonly cost_helper: Readonly<{ module: "cost2.js"; bytes: 1_660; sha256: typeof COST_HELPER_SHA256 }>;
  readonly cost_service: Readonly<{ module: "cost.js"; bytes: 2_745; sha256: typeof COST_SERVICE_SHA256 }>;
}

export interface OwnerSunoTrackOperationModelSource {
  readonly model_id: OwnerSunoTrackOperationModel;
  readonly ai_name: "suno";
  readonly active: true;
  readonly defaults_status: "UNKNOWN";
  readonly settings_limits: Readonly<{
    simple_mode_prompt_length: 500;
    custom_mode_prompt_length: 5_000;
    style_prompt_limit: 1_000;
    title_limit: 80;
  }>;
}

export interface OwnerSunoTrackOperationParameterSource {
  readonly profile_id: "owner-suno-track-operation-parameters-source-v1";
  readonly status: "CURRENT_FORM_WITH_PINNED_PUBLIC_CATALOG_RESOURCE_LIMITS";
  readonly source_pins: OwnerSunoTrackOperationSourcePins;
  readonly model_ids: readonly OwnerSunoTrackOperationModel[];
  readonly modes: readonly OwnerSunoTrackOperationMode[];
  readonly models: Readonly<Record<OwnerSunoTrackOperationModel, OwnerSunoTrackOperationModelSource>>;
  readonly controls: Readonly<{
    prompt: Readonly<{
      measure: "UTF16_CODE_UNITS";
      simple_max: 500;
      custom_max: 5_000;
      nonblank: true;
      bound_label: "PINNED_PUBLIC_CATALOG_RESOURCE_LIMIT_NOT_CURRENT_UI_QUOTE";
    }>;
    negative_tags: Readonly<{
      local_max: 5_000;
      measure: "UTF16_CODE_UNITS";
      bound_label: "LOCAL_RESOURCE_BOUND_NOT_UI_LIMIT";
      source_ui_limit: "UNKNOWN";
    }>;
    styles: Readonly<{ max: 1_000; bound_label: "PINNED_PUBLIC_CATALOG_RESOURCE_LIMIT_NOT_CURRENT_UI_QUOTE" }>;
    title: Readonly<{ max: 80; bound_label: "PINNED_PUBLIC_CATALOG_RESOURCE_LIMIT_NOT_CURRENT_UI_QUOTE" }>;
    continue_at: Readonly<{
      measure: "SECONDS";
      minimum: 0;
      step: 0.1;
      maximum: "SOURCE_DURATION_NOT_AVAILABLE_TO_SERVICE";
      ui_default: 0;
    }>;
  }>;
  readonly track_binding: Readonly<{
    public_input: "OPAQUE_TRACK_HANDLE_ONLY";
    resolved_model_policy: "MUST_MATCH_REQUEST_MODEL_ID";
    default_ttl_seconds: 900;
    maximum_ttl_seconds: 1_800;
  }>;
  readonly cost_projection: Readonly<{
    query_keys: readonly ["ai_name", "model_type"];
    ai_name: "suno";
    model_type_source: "settings_candidate.model_type";
    confidence: "FORM_COST_INPUT_PROJECTION_NOT_QUOTE_OR_CAP";
  }>;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

interface OwnerSunoTrackOperationRequestBase {
  readonly model_id: OwnerSunoTrackOperationModel;
  readonly track_handle: string;
  readonly prompt: string;
  readonly is_custom_mode: boolean;
  readonly is_instrumental: boolean;
  readonly negative_tags: string;
  readonly styles: string;
  readonly title: string;
}

export type OwnerSunoTrackOperationRequest = OwnerSunoTrackOperationRequestBase &
  ({ readonly mode: "cover"; readonly continue_at?: never } | { readonly mode: "extend"; readonly continue_at: number });

interface OwnerSunoTrackOperationSettingsCandidateBase {
  readonly model_type: OwnerSunoTrackOperationModel;
  readonly is_custom_mode: boolean;
  readonly is_instrumental: boolean;
  readonly negative_tags: string;
  readonly styles: string;
  readonly title: string;
}

export type OwnerSunoTrackOperationSettingsCandidate = OwnerSunoTrackOperationSettingsCandidateBase &
  ({ readonly mode: "cover"; readonly continue_at?: never } | { readonly mode: "extend"; readonly continue_at: number });

interface OwnerSunoNormalizedTrackOperationParametersBase {
  readonly profile_id: OwnerSunoTrackOperationParameterSource["profile_id"];
  readonly model_id: OwnerSunoTrackOperationModel;
  readonly track_handle: string;
  readonly prompt: string;
  readonly cost_parameters: Readonly<Record<string, never>>;
  readonly source_pins: OwnerSunoTrackOperationSourcePins;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export type OwnerSunoNormalizedTrackOperationParameters = OwnerSunoNormalizedTrackOperationParametersBase &
  ({ readonly mode: "cover"; readonly settings_candidate: Extract<OwnerSunoTrackOperationSettingsCandidate, { mode: "cover" }>; readonly continuation_measure?: never }
    | { readonly mode: "extend"; readonly settings_candidate: Extract<OwnerSunoTrackOperationSettingsCandidate, { mode: "extend" }>; readonly continuation_measure: "SECONDS" });

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const SOURCE_PINS: OwnerSunoTrackOperationSourcePins = Object.freeze({
  public_catalog_version: OWNER_SUNO_TRACK_OPERATION_PUBLIC_VERSION,
  public_models_sha256: PUBLIC_MODELS_SHA256,
  settings_inventory_version: OWNER_SUNO_TRACK_OPERATION_SETTINGS_VERSION,
  form: Object.freeze({ build_id: FORM_BUILD_ID, module: FORM_MODULE, bytes: 44_975 as const, sha256: FORM_SHA256 }),
  settings_helper: Object.freeze({ module: "settings3.js" as const, bytes: 4_155 as const, sha256: SETTINGS_HELPER_SHA256 }),
  cost_helper: Object.freeze({ module: "cost2.js" as const, bytes: 1_660 as const, sha256: COST_HELPER_SHA256 }),
  cost_service: Object.freeze({ module: "cost.js" as const, bytes: 2_745 as const, sha256: COST_SERVICE_SHA256 })
});

export class OwnerSunoTrackOperationParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Suno track-operation parameters are invalid.");
    this.name = "OwnerSunoTrackOperationParametersError";
  }
}

/** Static source report for cover/extend form inputs; it never enables dispatch. */
export function getOwnerSunoTrackOperationParameterSource(): DeepReadonly<OwnerSunoTrackOperationParameterSource> {
  const models = {} as Record<OwnerSunoTrackOperationModel, OwnerSunoTrackOperationModelSource>;
  for (const modelId of OWNER_SUNO_TRACK_OPERATION_MODEL_IDS) {
    models[modelId] = Object.freeze({
      model_id: modelId,
      ai_name: "suno",
      active: true,
      defaults_status: "UNKNOWN",
      settings_limits: Object.freeze({
        simple_mode_prompt_length: SIMPLE_PROMPT_MAX as 500,
        custom_mode_prompt_length: CUSTOM_PROMPT_MAX as 5_000,
        style_prompt_limit: STYLE_MAX as 1_000,
        title_limit: TITLE_MAX as 80
      })
    });
  }

  return deepFreeze({
    profile_id: "owner-suno-track-operation-parameters-source-v1" as const,
    status: "CURRENT_FORM_WITH_PINNED_PUBLIC_CATALOG_RESOURCE_LIMITS" as const,
    source_pins: SOURCE_PINS,
    model_ids: OWNER_SUNO_TRACK_OPERATION_MODEL_IDS,
    modes: OWNER_SUNO_TRACK_OPERATION_MODES,
    models,
    controls: {
      prompt: {
        measure: "UTF16_CODE_UNITS" as const,
        simple_max: SIMPLE_PROMPT_MAX as 500,
        custom_max: CUSTOM_PROMPT_MAX as 5_000,
        nonblank: true as const,
        bound_label: "PINNED_PUBLIC_CATALOG_RESOURCE_LIMIT_NOT_CURRENT_UI_QUOTE" as const
      },
      negative_tags: {
        local_max: NEGATIVE_TAGS_LOCAL_MAX,
        measure: "UTF16_CODE_UNITS" as const,
        bound_label: "LOCAL_RESOURCE_BOUND_NOT_UI_LIMIT" as const,
        source_ui_limit: "UNKNOWN" as const
      },
      styles: { max: STYLE_MAX as 1_000, bound_label: "PINNED_PUBLIC_CATALOG_RESOURCE_LIMIT_NOT_CURRENT_UI_QUOTE" as const },
      title: { max: TITLE_MAX as 80, bound_label: "PINNED_PUBLIC_CATALOG_RESOURCE_LIMIT_NOT_CURRENT_UI_QUOTE" as const },
      continue_at: {
        measure: "SECONDS" as const,
        minimum: 0 as const,
        step: 0.1 as const,
        maximum: "SOURCE_DURATION_NOT_AVAILABLE_TO_SERVICE" as const,
        ui_default: 0 as const
      }
    },
    track_binding: {
      public_input: "OPAQUE_TRACK_HANDLE_ONLY" as const,
      resolved_model_policy: "MUST_MATCH_REQUEST_MODEL_ID" as const,
      default_ttl_seconds: 900 as const,
      maximum_ttl_seconds: 1_800 as const
    },
    cost_projection: {
      query_keys: ["ai_name", "model_type"] as const,
      ai_name: "suno" as const,
      model_type_source: "settings_candidate.model_type" as const,
      confidence: "FORM_COST_INPUT_PROJECTION_NOT_QUOTE_OR_CAP" as const
    },
    effective_defaults: "UNKNOWN" as const,
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

/** Validates explicit cover/extend intent and keeps provider IDs behind the track handle. */
export function normalizeOwnerSunoTrackOperationParameters(
  input: unknown
): DeepReadonly<OwnerSunoNormalizedTrackOperationParameters> {
  const fields = readRequest(input);
  if (!isModel(fields.model_id) || (fields.mode !== "cover" && fields.mode !== "extend") ||
      typeof fields.is_custom_mode !== "boolean" || typeof fields.is_instrumental !== "boolean") invalid();

  const modelId = fields.model_id;
  const mode = fields.mode;
  const handle = fields.track_handle;
  if (typeof handle !== "string" || !TRACK_HANDLE.test(handle)) invalid();
  const prompt = readBoundedText(fields.prompt, fields.is_custom_mode ? CUSTOM_PROMPT_MAX : SIMPLE_PROMPT_MAX, true);
  const negativeTags = readBoundedText(fields.negative_tags, NEGATIVE_TAGS_LOCAL_MAX, false);
  const styles = readBoundedText(fields.styles, STYLE_MAX, false);
  const title = readBoundedText(fields.title, TITLE_MAX, false);
  const source = getOwnerSunoTrackOperationParameterSource();
  if (!source.models[modelId]) invalid();

  const common = {
    profile_id: source.profile_id,
    model_id: modelId,
    track_handle: handle,
    prompt,
    cost_parameters: Object.freeze({}),
    source_pins: source.source_pins,
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  };
  const settingsBase = {
    model_type: modelId,
    is_custom_mode: fields.is_custom_mode,
    is_instrumental: fields.is_instrumental,
    negative_tags: negativeTags,
    styles,
    title
  };
  if (mode === "extend") {
    return deepFreeze({
      ...common,
      mode,
      settings_candidate: { ...settingsBase, mode, continue_at: readContinueAt(fields.continue_at) },
      continuation_measure: "SECONDS" as const
    });
  }
  return deepFreeze({
    ...common,
    mode,
    settings_candidate: { ...settingsBase, mode }
  });
}

function readRequest(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) invalid();
  let prototype: object | null;
  let keys: (string | symbol)[];
  try {
    prototype = Object.getPrototypeOf(input);
    keys = Reflect.ownKeys(input);
  } catch { return invalid(); }
  if (prototype !== Object.prototype && prototype !== null || keys.some((key) => typeof key !== "string")) invalid();

  let modeDescriptor: PropertyDescriptor | undefined;
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    let descriptor: PropertyDescriptor | undefined;
    try { descriptor = Object.getOwnPropertyDescriptor(input, key); } catch { return invalid(); }
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) invalid();
    values[key] = descriptor.value;
    if (key === "mode") modeDescriptor = descriptor;
  }

  const mode = modeDescriptor?.value;
  const expected = mode === "extend" ? [...BASE_KEYS, "continue_at"] : [...BASE_KEYS];
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(values, key))) invalid();
  if (mode !== "cover" && mode !== "extend") invalid();
  return values;
}

function readContinueAt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalid();
  const tenths = Math.round(value * 10);
  if (!Number.isSafeInteger(tenths) || Math.abs(value * 10 - tenths) > 1e-9) invalid();
  return tenths / 10;
}

function readBoundedText(value: unknown, max: number, nonblank: boolean): string {
  if (typeof value !== "string" || !isWellFormedUnicode(value) || value.length > max ||
      (nonblank && value.trim().length === 0)) invalid();
  return value;
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

function isModel(value: unknown): value is OwnerSunoTrackOperationModel {
  return value === "V6" || value === "V6_wild";
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && Object.hasOwn(descriptor, "value")) deepFreeze(descriptor.value);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function invalid(): never {
  throw new OwnerSunoTrackOperationParametersError("INVALID_PARAMETERS");
}
