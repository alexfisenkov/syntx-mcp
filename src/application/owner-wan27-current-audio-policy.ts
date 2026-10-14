/** Narrow current-source correction; the older WAN T2V profile pins remain historical and unchanged. */
export const OWNER_WAN27_CURRENT_AUDIO_POLICY = Object.freeze({
  status: "CURRENT_SOURCE_OVERRIDE_WAN27_T2V_NATIVE_AUDIO_FALSE_ONLY" as const,
  scope: "wan_27_t2v" as const,
  accepted_native_audio: false as const,
  source_pins: Object.freeze({
    build_id: "1791904852" as const,
    form_module: "wan-video.js" as const,
    form_bytes: 19_503 as const,
    form_sha256: "sha256:f69db3d449d0051969def2229ed936d9835e0d65c8f257ec3ab289d6e9387737" as const
  }),
  source_finding: "native_audio_hidden_and_forced_false_in_current_wan27_t2v_branch" as const,
  interpretation: "SOURCE_UI_POLICY_ONLY_PROVIDER_ACCEPTANCE_UNPROVEN" as const
});

export function isOwnerWan27CurrentAudioAllowed(value: unknown): value is false {
  return value === false;
}
