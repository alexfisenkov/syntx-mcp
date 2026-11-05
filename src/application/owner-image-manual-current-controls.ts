import { schemaHash } from "../domain/generation-contract.js";

export type OwnerImageManualFamily = "clarity" | "magnific" | "soul";
const pins = Object.freeze({ build_id: "1793890358",
  public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  settings_inventory_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json",
  slider_sha256: "sha256:77bef1b40ab7d4bce97d12e360b17961467f7315c0d83d6290a2f0ee1d37ee46" });
const sources = Object.freeze({
  clarity: Object.freeze({ ...pins, form_sha256: "sha256:9b9e719ac311a36347597cf4463ea874717ca3c42e1aae3e39e8faa7e27dc9b6",
    sender_sha256: "sha256:1dee7041ce62a2ebf4dc04b5f96c2ad0f3306dd3b309e21083e211271bfc6740",
    ranges: Object.freeze({ strength: [0.1, 1], cfg: [2, 9], denoise: [0.1, 0.7] }) }),
  magnific: Object.freeze({ ...pins, form_sha256: "sha256:ceca0c28dcfc3b223978f4bd8b70d6969ff18275619fb0d2c3b8e72651dc015f",
    sender_sha256: "sha256:1dee7041ce62a2ebf4dc04b5f96c2ad0f3306dd3b309e21083e211271bfc6740",
    ranges: Object.freeze({ creativity: [-10, 10], hdr: [-10, 10], resemblance: [-10, 10], fractality: [-10, 10], sharpen: [0, 100], smart_grain: [0, 100], ultra_detail: [0, 100] }) }),
  soul: Object.freeze({ ...pins, form_sha256: "sha256:ecfb700a6e452e5a7f29e69eb1dde8441c6317a44cda20c636bc59b0610de1cd",
    sender_sha256: "sha256:b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684",
    ranges: Object.freeze({ style_strength: [0, 1] }) })
});
for (const source of Object.values(sources)) for (const range of Object.values(source.ranges)) Object.freeze(range);
export function getOwnerImageManualCurrentControls(family: OwnerImageManualFamily) {
  return Object.freeze({ status: "FORM_SOURCE_REVIEWED", provider_acceptance: "UNPROVEN_NEW_TUPLES", family, source: sources[family],
    current_controls_source: sources[family],
    pricing_catalog_source: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    manual_input: "ENABLED_NO_DISABLED_INPUT_PROP", source_setter: "NUMBER_CLAMP_DIRECT_SETTINGS_NO_STEP_QUANTIZATION",
    saved_ui_defaults: "NOT_INFERRED", legacy_lattice_profile_hash: "PRESERVED", account_gate_catalog: "EXISTING_PINNED_MODEL_CATALOG" });
}
function step(value: number, quantum: number) { return Math.abs(value / quantum - Math.round(value / quantum)) < 1e-8; }
/** A current source overlay only for formerly rejected manual values; no generation or account authority. */
export function ownerImageManualCurrentProfileHash(family: OwnerImageManualFamily, legacyHash: string, values: Readonly<Record<string, unknown>>): string {
  const selected = family === "soul" ? values.style_strength ?? (values.style as { strength?: number } | undefined)?.strength : undefined;
  const legacy = family === "clarity" ? typeof values.strength === "number" && step(values.strength, 0.01) && Number.isInteger(values.cfg) &&
    typeof values.denoise === "number" && step(values.denoise, 0.01) : family === "magnific" ? Object.keys(sources.magnific.ranges).every(key => Number.isInteger(values[key])) :
      selected === undefined || typeof selected === "number" && step(selected, 0.1);
  return legacy ? legacyHash : schemaHash({ legacy_profile_schema_hash: legacyHash, current_controls: getOwnerImageManualCurrentControls(family) });
}
