/** Current public controls supplement historical initial-tuple proofs; they do not transfer provider acceptance. */
export const OWNER_HEYGEN4_CURRENT_CONTROLS = Object.freeze({
  build_id: "1793890358", public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  form_module: "heygen.js", form_sha256: "sha256:e30d4826f7284f08a51b9cd3395e8cd39c0c1abc15b52806528f729cd5dbf2e5",
  aspect_ratio: Object.freeze(["16:9", "9:16"] as const), omitted_aspect_ratio: "16:9",
  duration: "GENUINE_SELECTED_AUDIO_METADATA_2_TO_120_SECONDS", provider_acceptance: "UNPROVEN_FOR_NEW_VALUES"
} as const);
export type OwnerHeygen4AspectRatio = typeof OWNER_HEYGEN4_CURRENT_CONTROLS.aspect_ratio[number];
export function ownerHeygen4AspectRatio(value: unknown): OwnerHeygen4AspectRatio {
  if (value === undefined) return "16:9";
  if (value !== "16:9" && value !== "9:16") throw new Error("INVALID_HEYGEN4_ASPECT_RATIO");
  return value;
}
export const OWNER_ACTTWO_CURRENT_CONTROLS = Object.freeze({
  build_id: "1793890358", public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  form_module: "runway.js", form_sha256: "sha256:82ea97e101804712f960f40933573911fb3bba028973ba6ec2431149c4691951",
  slider_module_sha256: "sha256:77bef1b40ab7d4bce97d12e360b17961467f7315c0d83d6290a2f0ee1d37ee46",
  expression: Object.freeze({ minimum: 1, maximum: 5, ui_step: 1, finite_fractional_manual_input: true, omitted_compatibility_value: 3 }),
  seed: Object.freeze({ minimum: 0, maximum: 2147483647, nullable: true, omitted_compatibility_value: null, zero_wire: "PRESERVED",
    source_module_sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b" }),
  performance_duration: Object.freeze({ minimum_exclusive: 0, maximum_seconds: 30, source: "GENUINE_PROBED_PERFORMANCE_VIDEO", caller_override: false, historical_initial_tuple_seconds: 5 }),
  provider_acceptance: "UNPROVEN_FOR_NEW_VALUES"
} as const);
export function isOwnerActTwoCurrentDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 30;
}
export function ownerActTwoCurrentExpression(value: unknown): number {
  if (value === undefined) return 3;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 5) throw new Error("INVALID_ACTTWO_EXPRESSION");
  return value;
}
export function ownerActTwoCurrentSeed(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new Error("INVALID_ACTTWO_SEED");
  return value;
}
