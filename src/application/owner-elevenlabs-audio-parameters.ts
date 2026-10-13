import { isProxy } from "node:util/types";

export const OWNER_ELEVENLABS_AUDIO_C5_PUBLIC_VERSION =
  "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json" as const;
export const OWNER_ELEVENLABS_AUDIO_62BC_SETTINGS_VERSION =
  "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json" as const;

export const OWNER_ELEVENLABS_AUDIO_MODELS = Object.freeze([
  "eleven_multilingual_sts_v2",
  "eleven_multilingual_v2",
  "eleven_v3",
  "eleven_v4",
  "eleven_v4_turbo"
] as const);

export type OwnerElevenLabsAudioModel = typeof OWNER_ELEVENLABS_AUDIO_MODELS[number];
export type OwnerElevenLabsAudioMode = "speech_to_speech" | "text_to_speech" | "text_to_dialogue";

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const FORM_CONTROLS = Object.freeze(["inputs", "mode", "similarity_boost", "stability"] as const);
const MODEL_SETTINGS = deepFreeze({
  eleven_multilingual_sts_v2: {
    form_id: "elevenlabs" as const,
    active: true as const,
    allowed_modes: ["speech_to_speech"] as const,
    public_settings: {
      accepted_file_types: ["audio/mpeg", "audio/wav", "audio/mp3"],
      allowed_media_types: ["audios"],
      allowed_modes: ["speech_to_speech"],
      attach_info_text: null,
      file_count_limit: 1,
      get_cost_params: ["mode", "duration"],
      max_audio_duration: 300,
      max_file_size: 52_428_800,
      max_prompt_length: 0,
      min_audio_duration: 5,
      uploadable: true
    }
  },
  eleven_multilingual_v2: {
    form_id: "elevenlabs" as const,
    active: true as const,
    allowed_modes: ["text_to_speech"] as const,
    public_settings: {
      accepted_file_types: [],
      allowed_media_types: [],
      allowed_modes: ["text_to_speech"],
      attach_info_text: null,
      file_count_limit: 0,
      get_cost_params: ["chars_count", "mode"],
      max_file_size: 0,
      max_prompt_length: 5_000,
      uploadable: false
    }
  },
  eleven_v3: {
    form_id: "elevenlabs" as const,
    active: true as const,
    allowed_modes: ["text_to_speech", "text_to_dialogue"] as const,
    public_settings: {
      accepted_file_types: [],
      allowed_media_types: [],
      allowed_modes: ["text_to_speech", "text_to_dialogue"],
      attach_info_text: null,
      dialogue_max_inputs: 100,
      dialogue_prompt_limit: 4_000,
      file_count_limit: 0,
      get_cost_params: ["chars_count", "mode"],
      max_file_size: 0,
      max_prompt_length: 5_000,
      uploadable: false
    }
  },
  eleven_v4: {
    form_id: "elevenlabs" as const,
    active: true as const,
    allowed_modes: ["text_to_speech", "text_to_dialogue"] as const,
    public_settings: {
      accepted_file_types: [],
      allowed_media_types: [],
      allowed_modes: ["text_to_speech", "text_to_dialogue"],
      attach_info_text: null,
      dialogue_max_inputs: 100,
      dialogue_prompt_limit: 10_000,
      file_count_limit: 0,
      get_cost_params: ["chars_count", "mode"],
      max_file_size: 0,
      max_prompt_length: 10_000,
      uploadable: false
    }
  },
  eleven_v4_turbo: {
    form_id: "elevenlabs" as const,
    active: true as const,
    allowed_modes: ["text_to_speech", "text_to_dialogue"] as const,
    public_settings: {
      accepted_file_types: [],
      allowed_media_types: [],
      allowed_modes: ["text_to_speech", "text_to_dialogue"],
      attach_info_text: null,
      dialogue_max_inputs: 100,
      dialogue_prompt_limit: 10_000,
      file_count_limit: 0,
      get_cost_params: ["chars_count", "mode"],
      max_file_size: 0,
      max_prompt_length: 10_000,
      uploadable: false
    }
  }
} as const satisfies Readonly<Record<OwnerElevenLabsAudioModel, object>>);

const SOURCE_PARAMETERS = deepFreeze({
  profile_id: "elevenlabs-audio-explicit-parameters-v1",
  source_binding: {
    build_id: "1791467421",
    homepage_start_end: {
      status: "MATCHED_START_END_BEFORE_AST" as const,
      bytes: 92_317,
      sha256: "sha256:7a21687b4d216cbe66fbc0bd724947d20533ff3eafab00f6fdbad42fac4cc464"
    },
    form_module: {
      name: "elevenlabs.js",
      bytes: 32_647,
      sha256: "sha256:d41d3df4c11078f92b6543c140522dc9b6ffa7b9361b46a7afd88982f300c64e",
      ast_parse_diagnostics: 0,
      builder_offset_1based: 11_573,
      membership_offset_1based: 11_512,
      guard_offset_1based: 11_547
    },
    public_catalog_version: OWNER_ELEVENLABS_AUDIO_C5_PUBLIC_VERSION,
    settings_inventory_version: OWNER_ELEVENLABS_AUDIO_62BC_SETTINGS_VERSION,
    source_catalog_is_runtime_usable: false,
    selector_or_archive_changed: false
  },
  model_ids: OWNER_ELEVENLABS_AUDIO_MODELS,
  models: MODEL_SETTINGS,
  form_controls: FORM_CONTROLS,
  model_value_settings_keys: FORM_CONTROLS,
  payload_field_keys: ["mode"] as const,
  builder: {
    function_name: "Wa",
    membership_function: "ze",
    membership_array: "Ja",
    model_membership_branch: {
      models: ["eleven_v4", "eleven_v4_turbo"] as const,
      condition: "truthy model_type and exact Ja membership"
    },
    dialogue_branch: {
      condition: "mode === text_to_dialogue",
      projected_input_keys: ["name", "text", "voice_id"] as const
    },
    voice_fallback: "EMPTY_STRING_OUTSIDE_DIALOGUE_BRANCH" as const,
    speech_to_speech_branch: "mode === speech_to_speech" as const,
    duration_fallback: 0,
    character_count_fallback: 0,
    local_mode_fallback: "text_to_speech" as const,
    membership_fields: ["language_code", "stability", "similarity_boost"] as const,
    membership_field_local_fallbacks: {
      language_code: "auto",
      stability: 0.5,
      similarity_boost: 0.5
    },
    local_fallbacks_are_effective_defaults: false
  },
  effective_defaults: "UNPROVEN" as const,
  voice_ownership: "UNRESOLVED_PUBLIC_VS_ACCOUNT_CUSTOM" as const,
  caller_bridge: "UNRESOLVED" as const,
  payload_projection: {
    status: "NOT_EMITTED_CALLER_BRIDGE_UNRESOLVED" as const,
    missing_edges: ["form-to-audio-sender caller", "voice source and ownership", "provider wire acceptance"] as const
  },
  source_scope: "PINNED_PUBLIC_MODEL_MODE_AND_SETTINGS_REPORT_ONLY" as const,
  runtime_usable: false as const,
  generation_allowed: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export type OwnerElevenLabsAudioSourceParameters = typeof SOURCE_PARAMETERS;

export interface OwnerElevenLabsAudioNormalizedParameters {
  readonly model_id: OwnerElevenLabsAudioModel;
  readonly mode: OwnerElevenLabsAudioMode;
  readonly source_scope: "MODEL_MODE_SELECTION_ONLY";
  readonly generation_allowed: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerElevenLabsAudioParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("ElevenLabs audio parameters are invalid.");
    this.name = "OwnerElevenLabsAudioParametersError";
  }
}

/** Returns only the C5/62BC source report; it is not runtime or dispatch authority. */
export function getOwnerElevenLabsAudioSourceParameters(): DeepReadonly<OwnerElevenLabsAudioSourceParameters> {
  return SOURCE_PARAMETERS;
}

/** Validates an explicit supported model/mode selection without inventing a wire payload. */
export function normalizeOwnerElevenLabsAudioParameters(input: unknown): OwnerElevenLabsAudioNormalizedParameters {
  const request = readExactRecord(input, ["model_id", "mode"]);
  if (typeof request.model_id !== "string" || !Object.hasOwn(MODEL_SETTINGS, request.model_id)) invalid();
  const modelId = request.model_id as OwnerElevenLabsAudioModel;
  const modes: readonly string[] = MODEL_SETTINGS[modelId].allowed_modes;
  if (typeof request.mode !== "string" || !modes.includes(request.mode)) invalid();
  return deepFreeze({
    model_id: modelId,
    mode: request.mode as OwnerElevenLabsAudioMode,
    source_scope: "MODEL_MODE_SELECTION_ONLY" as const,
    generation_allowed: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  }) as OwnerElevenLabsAudioNormalizedParameters;
}

function readExactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== required.length || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !required.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never {
  throw new OwnerElevenLabsAudioParametersError("INVALID_PARAMETERS");
}
