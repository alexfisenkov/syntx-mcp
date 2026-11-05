import type { OwnerHappyHorseModelId } from "./owner-happy-horse-parameters.js";
export const HAPPY_HORSE_CURRENT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export const HAPPY_HORSE_CURRENT_RESOLUTIONS = ["720P", "1080P"] as const;
export type OwnerHappyHorseAspectRatio = typeof HAPPY_HORSE_CURRENT_RATIOS[number];
export type OwnerHappyHorseResolution = typeof HAPPY_HORSE_CURRENT_RESOLUTIONS[number];
export const OWNER_HAPPY_HORSE_CURRENT_CONTROLS = Object.freeze({
  status: "FORM_SOURCE_REVIEWED", build_id: "1793890358",
  public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  form_sha256: "sha256:928a3d5a0f19b62cab13b8e85d5e4b7aabceab03db0dbb3d1f87e90c181d0c21",
  sender_sha256: "sha256:b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684",
  mapper_sha256: "sha256:e1eb14c2a51850296d8e6c0740c82d90467936b9bb4b37bc734a4be56d23edf5",
  resolution: HAPPY_HORSE_CURRENT_RESOLUTIONS, references_ratios: HAPPY_HORSE_CURRENT_RATIOS,
  image_duration: Object.freeze({ minimum: 3, maximum: 15, ui_step: 1, manual_fractions: true }),
  edit_duration: "CLAMP_ROUND_GENUINE_INPUT_DURATION_TO_3_15", edit_input_seconds: Object.freeze({ minimum: 3, maximum: 60 }),
  seed: Object.freeze({ nullable: true, integer_minimum: 0, integer_maximum: 2147483647, zero_wire: "PRESERVED" }),
  image_counts: Object.freeze({ first_frame: 1, references_minimum: 1, references_maximum: 9, edit_maximum: 5 }),
  edit_native_audio: "EXPLICIT_BOOLEAN_OR_LEGACY_OMISSION", prompt_maximum_utf16: 5000,
  compatibility_omissions: Object.freeze({ aspect_ratio: "16:9", resolution: "720P", video_duration: 5, seed: null }),
  effective_saved_ui_defaults: "NOT_INFERRED", provider_acceptance: "UNPROVEN_FOR_NEW_TUPLES"
} as const);
export function normalizeOwnerHappyHorseCurrentFields(model: OwnerHappyHorseModelId, fields: Record<string, unknown>) {
  const aspect = fields.aspect_ratio === undefined ? "16:9" : fields.aspect_ratio;
  const resolution = fields.resolution === undefined ? "720P" : fields.resolution;
  const duration = fields.video_duration === undefined ? 5 : fields.video_duration;
  const seed = fields.seed === undefined ? null : fields.seed;
  if (!(HAPPY_HORSE_CURRENT_RATIOS as readonly unknown[]).includes(aspect) || model !== "happy_horse_references" && aspect !== "16:9" ||
      !(HAPPY_HORSE_CURRENT_RESOLUTIONS as readonly unknown[]).includes(resolution) || typeof duration !== "number" || !Number.isFinite(duration) || duration < 3 || duration > 15 ||
      seed !== null && (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) ||
      fields.native_audio !== undefined && (model !== "happy_horse_edit" || typeof fields.native_audio !== "boolean")) throw new Error("HAPPY_HORSE_CURRENT_CONTROLS_INVALID");
  return Object.freeze({ aspect_ratio: aspect as OwnerHappyHorseAspectRatio, resolution: resolution as OwnerHappyHorseResolution,
    video_duration: duration, seed: seed as number | null, ...(fields.native_audio === undefined ? {} : { native_audio: fields.native_audio as boolean }) });
}
export function deriveOwnerHappyHorseEditDuration(measured: number): number {
  if (!Number.isFinite(measured) || measured < 3 || measured > 60) throw new Error("HAPPY_HORSE_EDIT_DURATION_INVALID");
  return Math.max(3, Math.min(Math.round(measured), 15));
}
