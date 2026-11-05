import { schemaHash } from "../domain/generation-contract.js";

export const OWNER_RUNWAY_CURRENT_CONTROLS = Object.freeze({
  status: "FORM_SOURCE_REVIEWED", build: 1793890358,
  form_sha256: "sha256:82ea97e101804712f960f40933573911fb3bba028973ba6ec2431149c4691951",
  random_seed_sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b",
  sender_sha256: "sha256:b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684",
  seed: Object.freeze({ nullable: true, minimum: 0, maximum: 2147483647, integer: true, random_toggle_value: null }),
  gen45_aspect_ratios: Object.freeze(["16:9", "4:3", "1:1", "3:4", "9:16"]),
  provider_acceptance: "UNPROVEN"
});
export function isOwnerRunwayCurrentSeed(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647);
}
export function ownerRunwayCurrentProfileHash(legacy: string): string {
  return schemaHash({ legacy_profile_sha256: legacy, current_controls: OWNER_RUNWAY_CURRENT_CONTROLS });
}
