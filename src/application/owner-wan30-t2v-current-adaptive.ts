/** Separate static evidence for Adaptive; does not alter the historical observed request. */
export const WAN30_CURRENT_ADAPTIVE_SOURCE = Object.freeze({
  profile_id: "owner-wan30-t2v-adaptive-current-source-v1" as const,
  status: "FORM_SOURCE_REVIEWED_NOT_UI_OR_PROVIDER_OBSERVED" as const,
  source_pins: Object.freeze({
    public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json" as const,
    form_build_id: "1793890358" as const,
    form_module: "wan-video.js" as const,
    form_module_bytes: 26108,
    form_module_sha256: "2b5d64f6a1f9614987f1ec5efd4bdffee916865f34d87ddd32901db658d9a6e3" as const,
    video_sender_module: "video.js" as const,
    video_sender_module_bytes: 9343,
    video_sender_module_sha256: "b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684" as const
  }),
  setting: "aspect_ratio" as const, value: "adaptive" as const,
  sender_mapping: "LITERAL_SETTING_COPIED_TO_VIDEO_GENERATE" as const,
  model_id: "wan_30_t2v" as const, effective_default: "UNKNOWN" as const,
  runtime_usable: false as const, dispatch_allowed: false as const, backend_acceptance: "UNPROVEN" as const
});
