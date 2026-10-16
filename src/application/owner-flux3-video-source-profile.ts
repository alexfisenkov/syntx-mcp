export const OWNER_FLUX3_VIDEO_MODEL_IDS = Object.freeze(["flux3_i2v", "flux3_v2v"] as const);
export type OwnerFlux3VideoModelId = (typeof OWNER_FLUX3_VIDEO_MODEL_IDS)[number];

export const OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION =
  "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;

const SOURCE_PINS = Object.freeze({
  public_catalog_version: OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION,
  public_models_sha256: "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1",
  source_build_id: "1792133067",
  modules: Object.freeze({
    app: "sha256:5488b33ac6de23e559932a485c7cf2f7d034151f3d735005dfb0a334ee21a175",
    settings_registry: "sha256:93034f474531d78df3bfd87a6c5fe48acc06cc64878f5ba6c00208812c5d80be",
    form: "sha256:99ae773a62862763308d289b572ec312902d6c82a6056be70cb985f2ce2c5d31",
    video_page: "sha256:8310cb1c9ac8221077220da873cfe785e35408b43b1cfba85d409272c9b44596",
    video_store: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b",
    settings_helper: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
    cost_helper: "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa",
    cost_api: "sha256:261d93d75b204703201d1d0c3cf0ce747832159ef44f818cdd44ebee27c07ada",
    new_session_button: "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc"
  })
} as const);

export interface OwnerFlux3VideoSourceProfile {
  readonly status: "SOURCE_REVIEWED_STATIC_ONLY";
  readonly model_id: OwnerFlux3VideoModelId;
  readonly ai_name: "flux3_video";
  readonly modality: "video";
  readonly catalog_scope: "video";
  readonly source_pins: typeof SOURCE_PINS;
  readonly effective_defaults: "UNKNOWN";
  readonly upstream_n: "OMITTED_FROM_EXPLICIT_VIDEO_SETTINGS";
  readonly draft_cost_parameter: "UNSET_OMITTED_FROM_QUERY";
  readonly controls: Readonly<{
    resolution: readonly ["hd", "fhd"];
    video_duration: readonly [5, 20] | readonly [5, 15];
    generate_audio: "BOOLEAN";
    aspect_ratio: Readonly<{ mode: "SOURCE_FORCED"; value: "auto"; caller_control: false }>;
    conditional_combinations: "UNPROVEN";
  }>;
  readonly input: Readonly<{
    role: "image" | "video";
    file_count_limit: 10 | 1;
    accepted_file_types: readonly ["image/jpeg", "image/png", "image/webp"] | readonly ["video/mp4"];
    max_file_size_bytes: 10_485_760 | 52_428_800;
    duration_seconds: "UNKNOWN";
  }>;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

const I2V_PROFILE: OwnerFlux3VideoSourceProfile = Object.freeze({
  status: "SOURCE_REVIEWED_STATIC_ONLY",
  model_id: "flux3_i2v",
  ai_name: "flux3_video",
  modality: "video",
  catalog_scope: "video",
  source_pins: SOURCE_PINS,
  effective_defaults: "UNKNOWN",
  upstream_n: "OMITTED_FROM_EXPLICIT_VIDEO_SETTINGS",
  draft_cost_parameter: "UNSET_OMITTED_FROM_QUERY",
  controls: Object.freeze({
    resolution: Object.freeze(["hd", "fhd"] as const),
    video_duration: Object.freeze([5, 20] as const),
    generate_audio: "BOOLEAN",
    aspect_ratio: Object.freeze({ mode: "SOURCE_FORCED", value: "auto", caller_control: false }),
    conditional_combinations: "UNPROVEN"
  }),
  input: Object.freeze({
    role: "image",
    file_count_limit: 10,
    accepted_file_types: Object.freeze(["image/jpeg", "image/png", "image/webp"] as const),
    max_file_size_bytes: 10_485_760,
    duration_seconds: "UNKNOWN"
  }),
  runtime_usable: false,
  dispatch_allowed: false,
  backend_acceptance: "UNPROVEN"
});

const V2V_PROFILE: OwnerFlux3VideoSourceProfile = Object.freeze({
  ...I2V_PROFILE,
  model_id: "flux3_v2v",
  controls: Object.freeze({ ...I2V_PROFILE.controls, video_duration: Object.freeze([5, 15] as const) }),
  input: Object.freeze({
    role: "video",
    file_count_limit: 1,
    accepted_file_types: Object.freeze(["video/mp4"] as const),
    max_file_size_bytes: 52_428_800,
    duration_seconds: "UNKNOWN"
  })
});

export function getOwnerFlux3VideoSourceProfile(modelId: string): OwnerFlux3VideoSourceProfile | undefined {
  if (modelId === "flux3_i2v") return I2V_PROFILE;
  if (modelId === "flux3_v2v") return V2V_PROFILE;
  return undefined;
}
