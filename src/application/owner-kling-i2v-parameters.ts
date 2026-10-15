import { types } from "node:util";

const MODEL_ID = "kling_image2video" as const;
const VERSIONS = Object.freeze(["1.5", "1.6", "2.1-master", "2.5-turbo", "2.6", "3.0", "3.0-turbo"] as const);
const MODES = Object.freeze(["standart", "hd", "4K"] as const);
const STANDARD_DURATIONS = Object.freeze([5, 10] as const);
const LONG_DURATIONS = Object.freeze(Array.from({ length: 13 }, (_, index) => index + 3));
const AUDIO_VERSIONS = Object.freeze(["2.6", "3.0"] as const);
const PROMPT_OPTIONAL_VERSIONS = Object.freeze(["3.0-turbo"] as const);
const INPUT_KEYS = Object.freeze([
  "model_id", "prompt", "reference_count", "version", "mode", "video_duration", "native_audio"
] as const);
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export const OWNER_KLING_I2V_SOURCE_PINS = Object.freeze({
  public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
  public_models_sha256: "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667",
  settings_inventory_version: "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
  settings_build_id: "1791811899",
  form_module: "kling.js",
  form_build_id: "1791904852",
  form_bytes: 32_012,
  form_sha256: "sha256:cdd5e9db14f57c901484c1bef541ba0b3fdd4d13153b990bd1f0edce1b3a5614",
  sender_module: "video.js",
  sender_sha256: "sha256:5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e",
  file_urls_helper_module: "NewSessionButton.js",
  file_urls_helper_sha256: "sha256:dda0cd67d1a152a5d341d3b816493cd7ed8fb5db0aad5c97fe76465940b0aadb",
  cost_helper_module: "cost2.js",
  cost_helper_sha256: "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa",
  settings_helper_module: "settings3.js",
  settings_helper_bytes: 4_155,
  settings_helper_sha256: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
  video_route_module: "index7.js",
  video_route_bytes: 12_849,
  video_route_sha256: "sha256:a78d9b5f3af2adbb567dd505ef4b301f7e5e383438f8f09ff42e9418a6a1670d",
  app_client_module: "app.js",
  app_client_bytes: 2_434_959,
  app_client_sha256: "sha256:6479e7e48c5a3348c7f642203e0438e7d4fa776997959df4dc505b39bb922ac1"
} as const);

const SOURCE = Object.freeze({
  status: "CURRENT_1791904852_STATIC_I2V_SOURCE_PARAMETERS_ONLY" as const,
  model_id: MODEL_ID,
  operation_id: "generate-video" as const,
  ai_name: "kling" as const,
  source_pins: OWNER_KLING_I2V_SOURCE_PINS,
  controls: Object.freeze({
    form_initializer_values: Object.freeze({
      mode: "standart" as const,
      version: "3.0-turbo" as const,
      video_duration: 5 as const,
      native_audio: false as const,
      aspect_ratio: "16:9" as const,
      effective_defaults: "UNKNOWN" as const
    }),
    prompt: Object.freeze({
      required_versions: Object.freeze(VERSIONS.filter((version) => !PROMPT_OPTIONAL_VERSIONS.includes(version as typeof PROMPT_OPTIONAL_VERSIONS[number]))),
      optional_versions: PROMPT_OPTIONAL_VERSIONS,
      source_max_length: "UNKNOWN" as const
    }),
    version: Object.freeze({ values: VERSIONS, effective_default: "UNKNOWN" as const }),
    mode: Object.freeze({
      values: MODES,
      standart_disabled_versions: Object.freeze(["2.1-master"] as const),
      four_k_enabled_versions: Object.freeze(["3.0"] as const),
      four_k_enabled_model_ids: Object.freeze([
        "kling_text2video", "kling_image2video", "kling_keyframes", "kling_elements"
      ] as const),
      model_validator_hd_only_ids: Object.freeze([
        "kling_o1_text2video", "kling_o1_image2video", "kling_o1_video2video"
      ] as const),
      effective_default: "UNKNOWN" as const
    }),
    video_duration: Object.freeze({
      standard_version_values: STANDARD_DURATIONS,
      long_versions: Object.freeze(["3.0", "3.0-turbo"] as const),
      long_version_values: LONG_DURATIONS,
      unit: "INTEGER_SECONDS" as const,
      effective_default: "UNKNOWN" as const
    }),
    native_audio: Object.freeze({
      values: Object.freeze([false, true] as const),
      enabled_versions: AUDIO_VERSIONS,
      true_forces_hd_versions: Object.freeze(["2.6"] as const),
      other_versions_forced_false: true as const,
      effective_default: "UNKNOWN" as const
    }),
    multi_shots: Object.freeze({
      enabled_versions: Object.freeze(["3.0"] as const),
      accepted_values: Object.freeze([false, true] as const),
      requirement: "EXPLICIT_BOOLEAN" as const,
      prompt: "REQUIRED_NONBLANK_RAW_PROMPT_PASSED_UNCHANGED" as const,
      scene_prompt_builder: "NOT_IMPLEMENTED" as const
    }),
    aspect_ratio: Object.freeze({
      ui_options: Object.freeze(["16:9", "1:1", "9:16"] as const),
      i2v_value_state: "RESET_TO_UNDEFINED_BY_MODEL_TYPE_WATCHER" as const,
      normalized: false as const
    }),
    reference_image: Object.freeze({
      required_count: 1 as const,
      allowed_media_types: Object.freeze(["images"] as const),
      accepted_file_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const),
      max_file_size_bytes: 31_457_280,
      min_side: 300,
      role_type: "image" as const,
      start_end_roles: "NOT_OBSERVED_IN_SOURCE" as const,
      sender_file_urls_type: "image" as const
    })
  }),
  settings: Object.freeze({
    paired_inventory_model_value_keys: Object.freeze([
      "aspect_ratio", "gen_type", "mode", "model_type", "multi_shots", "temperature", "version", "video_duration"
    ] as const),
    paired_inventory_payload_field_keys: Object.freeze(["mode", "model_type"] as const),
    current_form_initializer_keys: Object.freeze([
      "model_type", "temperature", "camera_movement", "aspect_ratio", "mode", "version", "native_audio", "gen_type", "motion", "video_duration", "multi_shots"
    ] as const),
    current_form_custom_payload_read_or_write_occurrences: 0 as const,
    current_form_settings_field_fates: Object.freeze({
      sender_preserves_defined_keys: Object.freeze([
        "model_type", "mode", "version", "native_audio", "gen_type", "motion", "video_duration", "multi_shots", "temperature", "camera_movement"
      ] as const),
      aspect_ratio: "RESET_TO_UNDEFINED_FOR_I2V_THEN_OMITTED_BY_JSON" as const,
      other_conditional_values: "PRESERVED_WHEN_DEFINED_OMITTED_WHEN_UNDEFINED" as const
    }),
    current_form_call_shape: "settings3.u with four arguments" as const,
    settings_helper_getter_call_shape: "getSettings with three arguments" as const,
    settings_helper_cache_calls: Object.freeze(["getSettings", "getStagedSettings"] as const),
    settings_helper_overlay_semantics: Object.freeze({
      route_model_and_version_overlay: "ONLY_WHEN_ACTIVE_SETTINGS_ALREADY_HAS_KEY" as const,
      staged_overlay: "ONLY_EXISTING_ACTIVE_SETTINGS_KEYS" as const,
      staged_precedence: "AFTER_ROUTE_QUERY_OVERLAY" as const,
      base_app_store_cache_method_definition: "UNRESOLVED_APP_GETSETTINGS_AND_GETSTAGEDSETTINGS_IMPLEMENTATIONS" as const
    }),
    settings_helper_overlay_order: "BASE_GETSETTINGS_THEN_ROUTE_QUERY_OVERLAY_THEN_STAGED_OVERLAY" as const,
    effective_settings_cache_state: "UNKNOWN" as const,
    custom_payload_replacement_to_video_sender: "GENERIC_SENDER_USES_TRUTHY_CUSTOM_PAYLOAD_ELSE_CURRENT_SETTINGS" as const,
    current_form_custom_payload_path: "NO_KLING_FORM_PRODUCER; GLOBAL_SLOT_RESET_UNRESOLVED" as const,
    sender_settings_projection: "SHALLOW_COPY_OF_SELECTED_SETTINGS_OBJECT_NO_PER_KEY_FILTER" as const,
    current_form_effective_settings_and_getter_join: "STATIC_FORM_KEYS_CLOSED_EFFECTIVE_CACHE_VALUES_OPEN" as const,
    unknown_or_not_normalized: Object.freeze(["gen_type", "multi_shots", "temperature", "camera_movement", "motion"] as const),
    unknown_or_not_normalized_scope: "SOURCE_FORM_FIELDS_NOT_NORMALIZED_BY_BARE_PARAMETERS_NORMALIZER; VERSIONED_MULTI_SHOTS_HAS_WIRE_SUPPORT" as const
  }),
  references: Object.freeze({
    required_count: 1 as const,
    role_type: "image" as const,
    sender_file_urls_type: "image" as const,
    owned_reference_binding: "NOT_IMPLEMENTED" as const,
    caller_url_accepted: false as const
  }),
  cost_projection: Object.freeze({
    declared_keys: Object.freeze(["version", "mode", "video_duration", "native_audio"] as const),
    bindings: Object.freeze({
      version: Object.freeze({ kind: "settings_accessor_or_store_property", property: "version" }),
      mode: Object.freeze({ kind: "settings_accessor_or_store_property", property: "mode" }),
      video_duration: Object.freeze({ kind: "settings_accessor_or_store_property", property: "video_duration" }),
      native_audio: Object.freeze({ kind: "settings_accessor_or_store_property", property: "native_audio" })
    }),
    value_lookup: "CURRENT cost2 HELPER READS EACH MODEL get_cost_params KEY FROM SETTINGS ACCESSOR OR STORE" as const,
    value_binding: "MODEL_SETTINGS_ACCESSOR_OR_STORE_PROPERTY" as const,
    quote_or_amount: "UNPROVEN" as const
  }),
  wire: Object.freeze({
    shared_sender_observation: "POST /api/v1/video/generate; query ai_name; body keys chat_id, prompt, settings" as const,
    frontend_chat_argument: "index7 passes the newly-created session uuid to video.sendMessage; the selected video sendMessage body field is chat_id" as const,
    application_transport_chat_field_renaming: "NO_RENAME_SOURCE_BODY_ALREADY_CHAT_ID" as const,
    native_client_contract: "SyntxChatHttpClient.startVideo POSTs chat_id, prompt, settings; chat_id is validated as a path identifier" as const,
    frontend_to_native_chat_field_join: "CLOSED_SESSION_UUID_TO_NATIVE_CHAT_ID" as const,
    http_serialized_i2v_settings_mapping: "UNRESOLVED" as const,
    file_urls_serializer: "NewSessionButton export n deduplicates typed URL records; sender handles file role then image media type" as const,
    file_urls_record: Object.freeze({
      type: "image" as const,
      url_source: "selected_uploaded_file_resolved_by_video_store" as const,
      caller_url_input_accepted: false as const
    }),
    file_urls_confidence: "CURRENT_HASH_PINNED_SENDER_AND_SERIALIZER_STATIC_JOIN" as const,
    i2v_settings_mapping: "UNRESOLVED" as const,
    file_urls_projection: "NOT_IMPLEMENTED" as const
  }),
  effective_defaults: "UNKNOWN" as const,
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export type OwnerKlingI2vVersion = typeof VERSIONS[number];
export type OwnerKlingI2vMode = typeof MODES[number];

export interface OwnerKlingI2vParametersSource {
  readonly status: typeof SOURCE.status;
  readonly model_id: typeof MODEL_ID;
  readonly operation_id: typeof SOURCE.operation_id;
  readonly ai_name: typeof SOURCE.ai_name;
  readonly source_pins: typeof OWNER_KLING_I2V_SOURCE_PINS;
  readonly controls: typeof SOURCE.controls;
  readonly settings: typeof SOURCE.settings;
  readonly references: typeof SOURCE.references;
  readonly cost_projection: typeof SOURCE.cost_projection;
  readonly wire: typeof SOURCE.wire;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerKlingI2vNormalizedParameters {
  readonly status: "SOURCE_REVIEWED_EXPLICIT_INTENT";
  readonly source_pins: typeof OWNER_KLING_I2V_SOURCE_PINS;
  readonly intent: Readonly<{
    model_id: typeof MODEL_ID;
    prompt: string;
    version: OwnerKlingI2vVersion;
    mode: OwnerKlingI2vMode;
    video_duration: number;
    native_audio: boolean;
  }>;
  readonly reference_binding: Readonly<{
    required_count: 1;
    caller_asserted_count: 1;
    role_type: "image";
    owned_references_bound: false;
    file_urls_projected: false;
  }>;
  readonly cost_query_candidate: Readonly<{
    keys: typeof SOURCE.cost_projection.declared_keys;
    values: Readonly<{
      version: OwnerKlingI2vVersion;
      mode: OwnerKlingI2vMode;
      video_duration: number;
      native_audio: boolean;
    }>;
    amount_or_quote: "UNPROVEN";
  }>;
  readonly cost_projection: typeof SOURCE.cost_projection;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export type OwnerKlingI2vParametersErrorCode = "INVALID_PARAMETERS";

export class OwnerKlingI2vParametersError extends Error {
  constructor(readonly code: OwnerKlingI2vParametersErrorCode) {
    super("Kling I2V parameters are invalid.");
    this.name = "OwnerKlingI2vParametersError";
  }
}

/** Immutable frontend/public-source facts; no provider or dispatch authority is created. */
export function getOwnerKlingI2vParametersSource(): OwnerKlingI2vParametersSource {
  return SOURCE;
}

/** Normalizes only closed Kling Image-to-Video intent; uploaded references remain unbound. */
export function normalizeOwnerKlingI2vParameters(input: unknown): OwnerKlingI2vNormalizedParameters {
  const fields = exactRecord(input);
  if (fields.model_id !== MODEL_ID || fields.reference_count !== 1 || typeof fields.prompt !== "string" ||
      !isWellFormedUnicode(fields.prompt) || PROMPT_CONTROL.test(fields.prompt) ||
      typeof fields.version !== "string" || !VERSIONS.includes(fields.version as OwnerKlingI2vVersion) ||
      typeof fields.mode !== "string" || !MODES.includes(fields.mode as OwnerKlingI2vMode) ||
      !Number.isSafeInteger(fields.video_duration) || typeof fields.native_audio !== "boolean") invalid();

  const version = fields.version as OwnerKlingI2vVersion;
  const mode = fields.mode as OwnerKlingI2vMode;
  const videoDuration = fields.video_duration as number;
  const prompt = fields.prompt.trim();
  const promptOptional = PROMPT_OPTIONAL_VERSIONS.includes(version as typeof PROMPT_OPTIONAL_VERSIONS[number]);
  if ((!promptOptional && prompt.length === 0) ||
      (version === "2.1-master" && mode === "standart") ||
      (mode === "4K" && version !== "3.0") ||
      (version === "3.0" || version === "3.0-turbo"
        ? !LONG_DURATIONS.includes(videoDuration)
        : !STANDARD_DURATIONS.some((value) => value === videoDuration)) ||
      (fields.native_audio === true && !AUDIO_VERSIONS.includes(version as typeof AUDIO_VERSIONS[number])) ||
      (fields.native_audio === true && version === "2.6" && mode !== "hd")) invalid();

  return Object.freeze({
    status: "SOURCE_REVIEWED_EXPLICIT_INTENT" as const,
    source_pins: OWNER_KLING_I2V_SOURCE_PINS,
    intent: Object.freeze({
      model_id: MODEL_ID,
      prompt: promptOptional ? prompt : fields.prompt,
      version,
      mode,
      video_duration: videoDuration,
      native_audio: fields.native_audio
    }),
    reference_binding: Object.freeze({
      required_count: 1 as const,
      caller_asserted_count: 1 as const,
      role_type: "image" as const,
      owned_references_bound: false as const,
      file_urls_projected: false as const
    }),
    cost_query_candidate: Object.freeze({
      keys: SOURCE.cost_projection.declared_keys,
      values: Object.freeze({
        version,
        mode,
        video_duration: videoDuration,
        native_audio: fields.native_audio
      }),
      amount_or_quote: "UNPROVEN" as const
    }),
    cost_projection: SOURCE.cost_projection,
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function exactRecord(value: unknown): Record<(typeof INPUT_KEYS)[number], unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    invalid();
  }
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== INPUT_KEYS.length ||
      keys.some((key) => typeof key !== "string" || !INPUT_KEYS.includes(key as (typeof INPUT_KEYS)[number]))) invalid();
  const result = Object.create(null) as Record<(typeof INPUT_KEYS)[number], unknown>;
  for (const key of INPUT_KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) invalid();
    result[key] = descriptor.value;
  }
  return result;
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

function invalid(): never {
  throw new OwnerKlingI2vParametersError("INVALID_PARAMETERS");
}
