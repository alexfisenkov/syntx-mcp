export const OWNER_TOPAZ_ENHANCE_MODEL_ID = "topaz_enhance" as const;

export const OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION =
  "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;

export const OWNER_TOPAZ_ENHANCE_MODEL_IDS = Object.freeze([OWNER_TOPAZ_ENHANCE_MODEL_ID] as const);
export type OwnerTopazEnhanceModelId = (typeof OWNER_TOPAZ_ENHANCE_MODEL_IDS)[number];
export const OWNER_TOPAZ_ENHANCE_ALGORITHM_IDS = Object.freeze(["ghq-5", "rhea-1", "prob-4", "iris-3", "gcg-5"] as const);
export type OwnerTopazEnhanceAlgorithmId = (typeof OWNER_TOPAZ_ENHANCE_ALGORITHM_IDS)[number];

const UPSCALE_VALUES = Object.freeze([1, 2, 4] as const);
const INTERPOLATION_VALUES = Object.freeze([24, 25, 30, 45, 50, 60] as const);
const FOCUS_VALUES = Object.freeze(["off", "normal", "strong"] as const);
const GRAIN_VALUES = Object.freeze(["off", "on"] as const);

const SOURCE_PINS = Object.freeze({
  public_catalog_version: OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION,
  source_build_id: "1792133067",
  public_models_sha256: "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1",
  modules: Object.freeze({
    topaz_enhance: "sha256:de4f0e844a1c41d8b2dfad185bf360974543ca162daf6c4d3604c19e3379ad2a",
    topaz_models: "sha256:50bbd38a27592dd187e8b21349bfcb148c35b8ebdb60df373b578c419bc90e40",
    upscaler3: "sha256:406fbed9c59ffe38d9e02e8475de2e26706a3a8b4f09fe839b3a29c5a8a43d55",
    use_upscaler_tool: "sha256:bcdd047929542224ea0289fbc495a00ef22f53f5ca98be6b489b2c47885e8561",
    app: "sha256:5488b33ac6de23e559932a485c7cf2f7d034151f3d735005dfb0a334ee21a175",
    upscaler_page: "sha256:31d71db2e4f1b96517b2a4d34158290568a9e0253c87d8541ad492dcd2cf1c7b",
    new_session_button: "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc"
  })
} as const);

export interface OwnerTopazEnhanceSourceProfile {
  readonly status: "SOURCE_REVIEWED_STATIC_ONLY";
  readonly model_id: OwnerTopazEnhanceModelId;
  readonly ai_name: "topaz_ai";
  readonly modality: "video";
  readonly catalog_scope: "tool_video_upscaler";
  readonly source_pins: typeof SOURCE_PINS;
  readonly catalog_default_model: "rhea-1";
  readonly form_fallback_model: "prob-4";
  readonly effective_defaults: "UNKNOWN";
  readonly controls: Readonly<{
    model: Readonly<{ field: "model"; values: typeof OWNER_TOPAZ_ENHANCE_ALGORITHM_IDS }>;
    upscale: Readonly<{ field: "upscale"; values: typeof UPSCALE_VALUES }>;
    interpolation: Readonly<{ field: "interpolation"; values: typeof INTERPOLATION_VALUES }>;
    numeric: Readonly<{
      fields: readonly ["prenoise", "compression", "details", "blur", "noise", "halo", "preblur"];
      values: Readonly<{ prenoise: readonly [0, 100]; compression: readonly [-100, 100]; details: readonly [-100, 100]; blur: readonly [-100, 100]; noise: readonly [-100, 100]; halo: readonly [-100, 100]; preblur: readonly [-100, 100] }>;
    }>;
    focus: Readonly<{ field: "focus"; values: typeof FOCUS_VALUES }>;
    grain: Readonly<{ field: "grain"; values: typeof GRAIN_VALUES }>;
    conditional_combinations: "UNPROVEN";
  }>;
  readonly input: Readonly<{
    role: "video";
    file_count_limit: 1;
    accepted_file_types: readonly ["video/mp4", "video/webm", "video/quicktime"];
    max_file_size_bytes: 52_428_800;
    duration_seconds: readonly [2, 26.25];
  }>;
  readonly wire: Readonly<{
    method: "POST";
    path: "video/generate";
    query: Readonly<{ ai_name: "topaz_ai" }>;
    body_fields: readonly ["chat_id", "prompt", "settings"];
    prompt_optional: true;
    settings_projection: "PURE_SETTINGS_ONLY_NO_FILE_URLS";
    file_url_binding: "NOT_PROJECTED_HERE";
  }>;
  readonly ui_defaults: Readonly<{ upscale: 1; interpolation: 60; numeric_controls: 0; focus: "off"; grain: "off"; effective: false }>;
  readonly fixed_settings: Readonly<{ promode: 0; blend: 0 }>;
  readonly upscale_four_predicate: "REJECT_IF_WIDTH_GTE_1280_OR_HEIGHT_GTE_720";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

const PROFILE: OwnerTopazEnhanceSourceProfile = Object.freeze({
  status: "SOURCE_REVIEWED_STATIC_ONLY",
  model_id: OWNER_TOPAZ_ENHANCE_MODEL_ID,
  ai_name: "topaz_ai",
  modality: "video",
  catalog_scope: "tool_video_upscaler",
  source_pins: SOURCE_PINS,
  catalog_default_model: "rhea-1",
  form_fallback_model: "prob-4",
  effective_defaults: "UNKNOWN",
  controls: Object.freeze({
    model: Object.freeze({ field: "model", values: OWNER_TOPAZ_ENHANCE_ALGORITHM_IDS }),
    upscale: Object.freeze({ field: "upscale", values: UPSCALE_VALUES }),
    interpolation: Object.freeze({ field: "interpolation", values: INTERPOLATION_VALUES }),
    numeric: Object.freeze({
      fields: Object.freeze(["prenoise", "compression", "details", "blur", "noise", "halo", "preblur"] as const),
      values: Object.freeze({ prenoise: Object.freeze([0, 100] as const), compression: Object.freeze([-100, 100] as const), details: Object.freeze([-100, 100] as const), blur: Object.freeze([-100, 100] as const), noise: Object.freeze([-100, 100] as const), halo: Object.freeze([-100, 100] as const), preblur: Object.freeze([-100, 100] as const) })
    }),
    focus: Object.freeze({ field: "focus", values: FOCUS_VALUES }),
    grain: Object.freeze({ field: "grain", values: GRAIN_VALUES }),
    conditional_combinations: "UNPROVEN"
  }),
  input: Object.freeze({
    role: "video",
    file_count_limit: 1,
    accepted_file_types: Object.freeze(["video/mp4", "video/webm", "video/quicktime"] as const),
    max_file_size_bytes: 52_428_800,
    duration_seconds: Object.freeze([2, 26.25] as const)
  }),
  wire: Object.freeze({
    method: "POST",
    path: "video/generate",
    query: Object.freeze({ ai_name: "topaz_ai" }),
    body_fields: Object.freeze(["chat_id", "prompt", "settings"] as const),
    prompt_optional: true,
    settings_projection: "PURE_SETTINGS_ONLY_NO_FILE_URLS",
    file_url_binding: "NOT_PROJECTED_HERE"
  }),
  ui_defaults: Object.freeze({ upscale: 1, interpolation: 60, numeric_controls: 0, focus: "off", grain: "off", effective: false }),
  fixed_settings: Object.freeze({ promode: 0, blend: 0 }),
  upscale_four_predicate: "REJECT_IF_WIDTH_GTE_1280_OR_HEIGHT_GTE_720",
  runtime_usable: false,
  dispatch_allowed: false,
  backend_acceptance: "UNPROVEN"
});

export function getOwnerTopazEnhanceSourceProfile(modelId: string): OwnerTopazEnhanceSourceProfile | undefined {
  return modelId === OWNER_TOPAZ_ENHANCE_MODEL_ID ? PROFILE : undefined;
}
