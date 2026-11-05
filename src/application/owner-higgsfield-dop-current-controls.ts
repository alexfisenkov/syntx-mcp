import { schemaHash } from "../domain/generation-contract.js";

const FACTS = Object.freeze({
  schema_version: "1.0.0", kind: "CURRENT_SOURCE_DOP_CONTROLS_NOT_PROVIDER_PROOF",
  source: Object.freeze({ build_id: "1793890358", module: "higgsfield.js",
    sha256: "sha256:d1a5daa8744846533aa52268595330be20815167ce57927860ef137de16db3e7",
    slider_module: "SliderForm.js", slider_sha256: "sha256:77bef1b40ab7d4bce97d12e360b17961467f7315c0d83d6290a2f0ee1d37ee46" }),
  enhance_prompt: Object.freeze({ values: Object.freeze([false, true]), default_injected: false }),
  motion_strength: Object.freeze({ minimum: 0, maximum: 1, slider_step: 0.01,
    manual_input: "FINITE_IN_RANGE_NO_QUANTIZATION", default_picker_suggestion: 1 }),
  legacy: "FALSE_AND_STRENGTH_ONE_KEEP_ORIGINAL_PROFILE_AND_FINGERPRINT",
  provider_acceptance: "UNPROVEN", source_execution: false
});

export const OWNER_HIGGSFIELD_DOP_CURRENT_CONTROLS = Object.freeze({ ...FACTS, source_sha256: schemaHash(FACTS) });

export function isOwnerHiggsfieldDopMotionStrength(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function ownerHiggsfieldDopCurrentProfileHash(legacyProfileHash: string): string {
  return schemaHash({ legacy_profile_sha256: legacyProfileHash,
    current_controls_sha256: OWNER_HIGGSFIELD_DOP_CURRENT_CONTROLS.source_sha256 });
}
