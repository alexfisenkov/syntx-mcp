export const OWNER_GROK_V2V_MODEL_ID = "grok_v2v" as const;
export const OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION =
  "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;

const PROFILE_ID = "owner-grok-v2v-static-source-profile-2057" as const;
const MODEL_ID = OWNER_GROK_V2V_MODEL_ID;
const AI_NAME = "grok_video" as const;

const SOURCE_PINS: OwnerGrokV2vSourcePins = deepFreeze({
  public_catalog_version: OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION,
  public_models_sha256: "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1",
  source_build_id: "1792133067",
  modules: {
    grok_form: "sha256:cc36221a4c696fb91b43166558800e2b1df18e49dcb3c06997b7cfeafb3c5159",
    file_uploader: "sha256:45f3174473d1ae4c9e57fbee47c7bf0c7e75773e9f3b36dbb8c3e5cc7ec3863a",
    chat_input: "sha256:4b6139e2115b651af482800684f569f27dfa46e9154486814d1a8d376701a464",
    app: "sha256:5488b33ac6de23e559932a485c7cf2f7d034151f3d735005dfb0a334ee21a175",
    duration_enricher: "sha256:09611977302662f75f1076cefed631360c1734ba07f7795fe289f562dee49ba6",
    duration_reader: "sha256:13d991c46f54bdfc9f0dad43ae792580a21a5754a5de1d42900c81e3134c7d6b",
    video_sender: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b"
  }
} as const);

const PROFILE: OwnerGrokV2vSourceProfile = deepFreeze({
  profile_id: PROFILE_ID,
  status: "SOURCE_REVIEWED_STATIC_ONLY",
  model_id: MODEL_ID,
  ai_name: AI_NAME,
  source_pins: SOURCE_PINS,
  input: {
    role: "video",
    file_count_limit: 1,
    accepted_file_types: ["video/mp4", "video/quicktime"],
    max_file_size_bytes: 52_428_800,
    total_duration_seconds: { minimum: 1, maximum: 8.7 },
    bounds_source: "PUBLIC_CATALOG_METADATA_NOT_UPLOAD_OR_DECODER_AUTHORITY"
  },
  prompt: {
    max_length_utf16: 2_000,
    source: "PUBLIC_CATALOG_MAX_PROMPT_LENGTH"
  },
  settings_projection: {
    model_type: MODEL_ID,
    aspect_ratio: null,
    video_duration: {
      input: "TRUSTED_MEASURED_SOURCE_DURATION_REQUIRED",
      normalization: "Number(Number(duration_seconds).toFixed(2))",
      effective_default: "UNKNOWN"
    },
    resolution: {
      input: "TRUSTED_MEASURED_SOURCE_DIMENSIONS_REQUIRED",
      threshold_pixels_inclusive: 409_920,
      at_or_above: "720p",
      below: "480p",
      effective_default: "UNKNOWN"
    },
    user_controls_for_resolution_or_duration: false
  },
  cost_projection: {
    keys: ["video_duration", "resolution"],
    evidence: "PUBLIC_CATALOG_KEYS_ONLY_NOT_QUOTE_OR_BILLING_PROOF",
    amount: "UNPROVEN"
  },
  effective_defaults: "UNKNOWN",
  runtime_usable: false,
  dispatch_allowed: false,
  backend_acceptance: "UNPROVEN"
});

export interface OwnerGrokV2vSourcePins {
  readonly public_catalog_version: typeof OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION;
  readonly public_models_sha256: string;
  readonly source_build_id: "1792133067";
  readonly modules: Readonly<{
    grok_form: string;
    file_uploader: string;
    chat_input: string;
    app: string;
    duration_enricher: string;
    duration_reader: string;
    video_sender: string;
  }>;
}

export interface OwnerGrokV2vSourceProfile {
  readonly profile_id: typeof PROFILE_ID;
  readonly status: "SOURCE_REVIEWED_STATIC_ONLY";
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof AI_NAME;
  readonly source_pins: OwnerGrokV2vSourcePins;
  readonly input: Readonly<{
    role: "video";
    file_count_limit: 1;
    accepted_file_types: readonly ["video/mp4", "video/quicktime"];
    max_file_size_bytes: 52_428_800;
    total_duration_seconds: Readonly<{ minimum: 1; maximum: 8.7 }>;
    bounds_source: "PUBLIC_CATALOG_METADATA_NOT_UPLOAD_OR_DECODER_AUTHORITY";
  }>;
  readonly prompt: Readonly<{ max_length_utf16: 2_000; source: "PUBLIC_CATALOG_MAX_PROMPT_LENGTH" }>;
  readonly settings_projection: Readonly<{
    model_type: typeof MODEL_ID;
    aspect_ratio: null;
    video_duration: Readonly<{
      input: "TRUSTED_MEASURED_SOURCE_DURATION_REQUIRED";
      normalization: "Number(Number(duration_seconds).toFixed(2))";
      effective_default: "UNKNOWN";
    }>;
    resolution: Readonly<{
      input: "TRUSTED_MEASURED_SOURCE_DIMENSIONS_REQUIRED";
      threshold_pixels_inclusive: 409_920;
      at_or_above: "720p";
      below: "480p";
      effective_default: "UNKNOWN";
    }>;
    user_controls_for_resolution_or_duration: false;
  }>;
  readonly cost_projection: Readonly<{
    keys: readonly ["video_duration", "resolution"];
    evidence: "PUBLIC_CATALOG_KEYS_ONLY_NOT_QUOTE_OR_BILLING_PROOF";
    amount: "UNPROVEN";
  }>;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export function getOwnerGrokV2vSourceProfile(modelId: string): OwnerGrokV2vSourceProfile | undefined {
  return modelId === MODEL_ID ? PROFILE : undefined;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
