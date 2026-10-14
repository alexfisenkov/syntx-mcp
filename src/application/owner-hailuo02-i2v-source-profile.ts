/** Current-build Hailuo-02 source facts; this profile grants no dispatch authority. */
export const OWNER_HAILUO02_I2V_SOURCE_PINS = Object.freeze({
  public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
  public_models_sha256: "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667",
  current_public_models_response_sha256: "sha256:323b585b24a0637466c3729553e14d506aa9427418977db6f201819d83b8a083",
  settings_inventory_version: "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
  source_build_id: "1791904852",
  settings_inventory_build_id: "1791811899",
  form_module: "hailuo-minimax.js",
  form_bytes: 13_501,
  form_sha256: "sha256:44470e6f7de725746c4fbbee0ddb61cf861629943299ce006f34d0120706d10c",
  chat_route_module: "index7.js",
  chat_route_bytes: 12_849,
  chat_route_sha256: "sha256:a78d9b5f3af2adbb567dd505ef4b301f7e5e383438f8f09ff42e9418a6a1670d",
  sender_module: "video.js",
  sender_bytes: 8_689,
  sender_sha256: "sha256:5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e",
  settings_helper_module: "settings3.js",
  settings_helper_bytes: 4_155,
  settings_helper_sha256: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
  cost_helper_module: "cost2.js",
  cost_helper_bytes: 1_660,
  cost_helper_sha256: "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa",
  cost_request_module: "cost.js",
  cost_request_bytes: 2_745,
  cost_request_sha256: "sha256:261d93d75b204703201d1d0c3cf0ce747832159ef44f818cdd44ebee27c07ada"
} as const);

export const OWNER_HAILUO02_I2V_MODEL = Object.freeze({
  model_id: "hailuo-02",
  model_type: "hailuo-02",
  ai_name: "hailuo-minimax",
  operation_id: "generate-video",
  modality: "video"
} as const);

export const OWNER_HAILUO02_I2V_SOURCE_PROFILE = Object.freeze({
  status: "CURRENT_FORM_SOURCE_WITH_PINNED_PUBLIC_MODEL_ROW",
  source_pins: OWNER_HAILUO02_I2V_SOURCE_PINS,
  model: OWNER_HAILUO02_I2V_MODEL,
  controls: Object.freeze({
    resolution_values: Object.freeze(["512p", "768p", "1080p"] as const),
    duration_values_seconds: Object.freeze([6, 10] as const),
    valid_pairs: Object.freeze([
      Object.freeze({ resolution: "512p", video_duration: 6 }),
      Object.freeze({ resolution: "512p", video_duration: 10 }),
      Object.freeze({ resolution: "768p", video_duration: 6 }),
      Object.freeze({ resolution: "768p", video_duration: 10 }),
      Object.freeze({ resolution: "1080p", video_duration: 6 })
    ] as const),
    image_reference: Object.freeze({ required_count: 1, accepted_file_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp"] as const) }),
    prompt: Object.freeze({ source_max_length: "UNKNOWN", local_bound_utf16: 5_000, bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" })
  }),
  wire: Object.freeze({
    method: "POST",
    path: "/api/v1/video/generate",
    query: Object.freeze({ ai_name: "hailuo-minimax" }),
    body_fields: Object.freeze(["chat_id", "prompt", "settings"] as const),
    settings_keys: Object.freeze(["model_type", "resolution", "video_duration", "file_urls"] as const),
    file_urls_record: Object.freeze({ type: "image", url_source: "selected_uploaded_file_url" }),
    excluded_settings_keys: Object.freeze(["mode", "aspect_ratio", "motion_id"] as const)
  }),
  upload_source: Object.freeze({
    model_type: "hailuo-02",
    destination: "uploaded",
    check_duplicates: true,
    reference_count_limit: 1
  }),
  cost_projection: Object.freeze({
    supported: true,
    path: "get_model_info",
    caller_keys: Object.freeze(["resolution", "video_duration"] as const),
    transport_owned_keys: Object.freeze(["ai_name", "model_type"] as const),
    reference_count_included: false,
    amount_or_quote: "UNPROVEN"
  }),
  defaults: "UNKNOWN",
  runtime_usable: false,
  dispatch_allowed: false,
  backend_acceptance: "UNPROVEN"
} as const);

