export const OWNER_SWITCHX_CURRENT_CONTROLS = Object.freeze({
  status: "FORM_SOURCE_REVIEWED", build_id: "1793890358",
  public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  form_sha256: "sha256:df641191aa92f464d59c82665d9ab211881a58f14f063d7d5aa86fb825de74ab",
  mask_helper_sha256: "sha256:b29975d8052437ae985dc8d6a01cb5ba917676aa25d27ba4bdff6590644c0779",
  segment_helper_sha256: "sha256:9cff850706d2d321ef43dadc3ec126cb84870d76fa9fe5a8640693c5ad7d4824",
  sender_sha256: "sha256:b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684",
  mapper_sha256: "sha256:e1eb14c2a51850296d8e6c0740c82d90467936b9bb4b37bc734a4be56d23edf5",
  mask_modes: Object.freeze(["auto", "fill", "image", "video"] as const),
  masks: "IMAGE_MODE_PREPARED_PNG_BINARY_MASK_OR_VIDEO_MODE_MASK_VIDEO; NOT_BACKGROUNDS",
  optional_style_image: true, prompt_maximum_utf16: 2000, prompt_optional_only_with_style_image: true,
  resolution: Object.freeze({ values: ["720P", "1080P"], higher_minimum_foreground_side: 1080 }),
  duration_and_frame_rate: "ROUND_GENUINE_SELECTED_MEDIA_METADATA_NOT_CALLER_SETTINGS",
  foreground_maximum_seconds: 10, foreground_frame_budget: 240, foreground_maximum_bytes: 104857600,
  segment: "EXPLICIT_USER_WINDOW_LOCAL_TRANSCODE_THEN_REMEASURE; ORIGINAL_BYTES_UNCHANGED_WITHOUT_WINDOW",
  compatibility_omissions: Object.freeze({ resolution: "720P", mask_mode: "auto" }),
  saved_ui_defaults: "NOT_INFERRED", provider_acceptance: "UNPROVEN_FOR_NEW_TUPLES"
} as const);
