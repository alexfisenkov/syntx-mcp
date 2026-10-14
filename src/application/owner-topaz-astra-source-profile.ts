export const OWNER_TOPAZ_ASTRA_MODEL_IDS = Object.freeze(["slc-1", "slf-2", "slp-2", "slp-2.5"] as const);
export type OwnerTopazAstraModelId = (typeof OWNER_TOPAZ_ASTRA_MODEL_IDS)[number];

export const OWNER_TOPAZ_ASTRA_PUBLIC_CATALOG_VERSION =
  "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
export const OWNER_TOPAZ_ASTRA_SETTINGS_INVENTORY_VERSION =
  "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;
export const OWNER_TOPAZ_ASTRA_SOURCE_BUILD_ID = "1791904852" as const;

const SOURCE_PINS = Object.freeze({
  public_catalog_version: OWNER_TOPAZ_ASTRA_PUBLIC_CATALOG_VERSION,
  settings_inventory_version: OWNER_TOPAZ_ASTRA_SETTINGS_INVENTORY_VERSION,
  source_build_id: OWNER_TOPAZ_ASTRA_SOURCE_BUILD_ID,
  public_models_sha256: "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667",
  settings_inventory_build_id: "1791811899",
  modules: Object.freeze({
    topaz_astra: "sha256:1aecfac160b8512f77cef700edb30d9457cae2d20703f2727766a5f1947e3fac",
    topaz_models: "sha256:50bbd38a27592dd187e8b21349bfcb148c35b8ebdb60df373b578c419bc90e40",
    upscaler3: "sha256:406fbed9c59ffe38d9e02e8475de2e26706a3a8b4f09fe839b3a29c5a8a43d55",
    new_session_button: "sha256:dda0cd67d1a152a5d341d3b816493cd7ed8fb5db0aad5c97fe76465940b0aadb",
    file_uploader: "sha256:c58aacff512eaa1dae82061452ee2f2ecd613ee423a81f3d92f5d8a61bf16c36",
    app: "sha256:6479e7e48c5a3348c7f642203e0438e7d4fa776997959df4dc505b39bb922ac1",
    video: "sha256:5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e",
    text: "sha256:79a3cf43d041b5bf5a74fe954a289e63b38866089187cbd93841b762982189ae",
    video_playback: "sha256:12ce3e533e2ee5fe17bd9ef22640bf7f9c6e46b6a24f8ebfae0a35c3ceb521fd",
    settings_helper: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
    cost_helper: "sha256:261d93d75b204703201d1d0c3cf0ce747832159ef44f818cdd44ebee27c07ada",
    cost_projection_helper: "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa",
    duration_helper: "sha256:13d991c46f54bdfc9f0dad43ae792580a21a5754a5de1d42900c81e3134c7d6b",
    settings_registry: "sha256:edd1cb3411aca5877ab36153ae0e7bd236c53b531dcb4d98a2bc962f24017d10",
    ai_select: "sha256:5ab38f6a30069332d931e4fc86cfeec5761d70d3268b68f39783d991e235fc43"
  })
} as const);

const RESOLUTIONS = Object.freeze(["1920x1080", "3840x2160"] as const);
const FRAME_RATES = Object.freeze([24, 30, 60, 120] as const);
const SLOW_MOTION_VALUES = Object.freeze([null, 2, 3, 4, 6, 8, 10, 12, 16] as const);
const CREATIVITY_VALUES = Object.freeze(["low", "middle", "high"] as const);
const ACCEPTED_VIDEO_TYPES = Object.freeze(["video/mp4", "video/quicktime"] as const);

const MODEL_SOURCE_FACTS: Readonly<Record<OwnerTopazAstraModelId, Readonly<{
  catalog_default: boolean;
  max_frame_count: 450 | 9_000;
}>>> = Object.freeze({
  "slc-1": Object.freeze({ catalog_default: true, max_frame_count: 450 }),
  "slf-2": Object.freeze({ catalog_default: false, max_frame_count: 9_000 }),
  "slp-2": Object.freeze({ catalog_default: false, max_frame_count: 450 }),
  "slp-2.5": Object.freeze({ catalog_default: false, max_frame_count: 9_000 })
});

export interface OwnerTopazAstraSourceProfile {
  readonly status: "SOURCE_REVIEWED_STATIC_ONLY";
  readonly model_id: OwnerTopazAstraModelId;
  readonly ai_name: "topaz_astra";
  readonly modality: "video";
  readonly catalog_scope: "tool_video_upscaler";
  readonly source_pins: typeof SOURCE_PINS;
  readonly catalog_default: boolean;
  readonly form_fallback_model_type: "slp-2.5";
  readonly effective_default: "UNKNOWN";
  readonly controls: Readonly<{
    model_type: Readonly<{ field: "model_type"; candidate_values: typeof OWNER_TOPAZ_ASTRA_MODEL_IDS; literal_values_in_current_form: readonly ["slc-1", "slp-2.5"] }>;
    resolution: Readonly<{ field: "resolution"; values: typeof RESOLUTIONS }>;
    frame_rate: Readonly<{ field: "frame_rate"; values: typeof FRAME_RATES }>;
    slowmo: Readonly<{ field: "slowmo"; values: typeof SLOW_MOTION_VALUES }>;
    creativity: Readonly<{ field: "creativity"; values: typeof CREATIVITY_VALUES }>;
    static_seed: Readonly<{ video_duration: 1; effective: false }>;
    conditional_combinations: "UNRESOLVED";
  }>;
  readonly input: Readonly<{
    role: "video";
    file_count_limit: 1;
    accepted_file_types: typeof ACCEPTED_VIDEO_TYPES;
    max_file_size_bytes: 52_428_800;
    max_video_duration_seconds: 25;
    max_frame_count: 450 | 9_000;
    file_urls_field: "file_urls";
    file_url_item: Readonly<{ type: "video"; url_field: "url"; url_value_source: "uploaded_file_receipt" }>;
    new_files_precede_existing_file_urls: true;
  }>;
  readonly wire: Readonly<{
    method: "POST";
    path: "video/generate";
    query: Readonly<{ ai_name: "topaz_astra" }>;
    body_fields: readonly ["chat_id", "prompt", "settings"];
    fixed_settings_candidate: Readonly<{ n: 1 }>;
    observed_settings_fields: readonly ["model_type", "resolution", "frame_rate", "slowmo", "creativity", "file_urls"];
    prompt_caller_binding: "UNRESOLVED";
    settings_are_shallow_copy_of_current_model_settings: true;
  }>;
  readonly upload_wire: Readonly<{
    method: "POST";
    path: "/api/v1/chats/upload-files";
    content_type: "multipart/form-data";
    fields: readonly ["files", "destination", "check_duplicates", "model_type"];
    topaz_owner_binding: "MUST_BE_ESTABLISHED_BY_NATIVE_UPLOAD";
  }>;
  readonly cost: Readonly<{
    separate_from_generation_wire: true;
    public_cost_keys: readonly ["video_duration", "frame_rate", "resolution", "version"];
    amount_or_quote: "NOT_CHECKED";
    video_duration_source: "UNRESOLVED";
  }>;
  readonly result: Readonly<{
    generic_history_object_type: "video";
    generic_history_url_field: "object_url";
    generic_history_model_field: "model_type";
    generic_history_completed_field: "completed";
    conservative_local_gate: readonly ["completed=true", "object_type=video", "model_type=model_id", "validated_object_url"];
    topaz_terminal_predicate: "UNPROVEN";
    output_mime_type: "UNKNOWN";
    provider_acceptance: "UNPROVEN";
  }>;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export function getOwnerTopazAstraSourceProfile(
  modelId: string
): OwnerTopazAstraSourceProfile | undefined {
  if (!isOwnerTopazAstraModelId(modelId)) return undefined;
  const modelFacts = MODEL_SOURCE_FACTS[modelId];
  return Object.freeze({
    status: "SOURCE_REVIEWED_STATIC_ONLY",
    model_id: modelId,
    ai_name: "topaz_astra",
    modality: "video",
    catalog_scope: "tool_video_upscaler",
    source_pins: SOURCE_PINS,
    catalog_default: modelFacts.catalog_default,
    form_fallback_model_type: "slp-2.5",
    effective_default: "UNKNOWN",
    controls: Object.freeze({
      model_type: Object.freeze({
        field: "model_type",
        candidate_values: OWNER_TOPAZ_ASTRA_MODEL_IDS,
        literal_values_in_current_form: Object.freeze(["slc-1", "slp-2.5"] as const)
      }),
      resolution: Object.freeze({ field: "resolution", values: RESOLUTIONS }),
      frame_rate: Object.freeze({ field: "frame_rate", values: FRAME_RATES }),
      slowmo: Object.freeze({ field: "slowmo", values: SLOW_MOTION_VALUES }),
      creativity: Object.freeze({ field: "creativity", values: CREATIVITY_VALUES }),
      static_seed: Object.freeze({ video_duration: 1, effective: false }),
      conditional_combinations: "UNRESOLVED"
    }),
    input: Object.freeze({
      role: "video",
      file_count_limit: 1,
      accepted_file_types: ACCEPTED_VIDEO_TYPES,
      max_file_size_bytes: 52_428_800,
      max_video_duration_seconds: 25,
      max_frame_count: modelFacts.max_frame_count,
      file_urls_field: "file_urls",
      file_url_item: Object.freeze({ type: "video", url_field: "url", url_value_source: "uploaded_file_receipt" }),
      new_files_precede_existing_file_urls: true
    }),
    wire: Object.freeze({
      method: "POST",
      path: "video/generate",
      query: Object.freeze({ ai_name: "topaz_astra" }),
      body_fields: Object.freeze(["chat_id", "prompt", "settings"] as const),
      fixed_settings_candidate: Object.freeze({ n: 1 }),
      observed_settings_fields: Object.freeze(["model_type", "resolution", "frame_rate", "slowmo", "creativity", "file_urls"] as const),
      prompt_caller_binding: "UNRESOLVED",
      settings_are_shallow_copy_of_current_model_settings: true
    }),
    upload_wire: Object.freeze({
      method: "POST",
      path: "/api/v1/chats/upload-files",
      content_type: "multipart/form-data",
      fields: Object.freeze(["files", "destination", "check_duplicates", "model_type"] as const),
      topaz_owner_binding: "MUST_BE_ESTABLISHED_BY_NATIVE_UPLOAD"
    }),
    cost: Object.freeze({
      separate_from_generation_wire: true,
      public_cost_keys: Object.freeze(["video_duration", "frame_rate", "resolution", "version"] as const),
      amount_or_quote: "NOT_CHECKED",
      video_duration_source: "UNRESOLVED"
    }),
    result: Object.freeze({
      generic_history_object_type: "video",
      generic_history_url_field: "object_url",
      generic_history_model_field: "model_type",
      generic_history_completed_field: "completed",
      conservative_local_gate: Object.freeze(["completed=true", "object_type=video", "model_type=model_id", "validated_object_url"] as const),
      topaz_terminal_predicate: "UNPROVEN",
      output_mime_type: "UNKNOWN",
      provider_acceptance: "UNPROVEN"
    }),
    runtime_usable: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
}

function isOwnerTopazAstraModelId(value: string): value is OwnerTopazAstraModelId {
  return OWNER_TOPAZ_ASTRA_MODEL_IDS.includes(value as OwnerTopazAstraModelId);
}
