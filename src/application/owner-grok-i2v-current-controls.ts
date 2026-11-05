import { schemaHash } from "../domain/generation-contract.js";

/** Current original-image intake; historical 16:9 wire/profile bytes stay unchanged. */
export const OWNER_GROK_I2V_CURRENT_CONTROLS = Object.freeze({
  status: "FORM_SOURCE_REVIEWED", provider_acceptance: "UNPROVEN", build_id: "1793890358",
  public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  settings_inventory_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json",
  form_sha256: "sha256:8da047e738d7dd5069c0263438927799a572a98915db2dc95da83de7207ab2e1",
  image_geometry: "BOUNDED_ORIGINAL_IMAGE_NO_16_9_SOURCE_REQUIREMENT",
  aspect_control: "HIDDEN_FOR_GROK_I2V_COMPATIBILITY_SETTING_PRESERVED",
  source_cardinality: 1
} as const);

export const OWNER_GROK15_CURRENT_DURATION = Object.freeze({ minimum: 1, maximum: 15, manual_fractions: true,
  slider_sha256: "sha256:77bef1b40ab7d4bce97d12e360b17961467f7315c0d83d6290a2f0ee1d37ee46",
  setter: "DIRECT_NUMBER_CLAMP_MODEL_CHANGE_ONLY_OPTION_RESET" });
export function ownerGrokI2vWireProfile(legacyHash: string, model: string, width: number, height: number, duration?: number): string {
  return model === "grok_i2v" && width * 9 !== height * 16 || model === "grok_15_i2v" && duration !== undefined && !Number.isInteger(duration)
    ? schemaHash({ legacy_profile_sha256: legacyHash, current_controls: OWNER_GROK_I2V_CURRENT_CONTROLS,
      current_duration: OWNER_GROK15_CURRENT_DURATION }) : legacyHash;
}
