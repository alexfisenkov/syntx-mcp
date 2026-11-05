import { schemaHash } from "../domain/generation-contract.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
export const KLING_MANUAL_DURATION_CURRENT_CATALOG = "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json" as const;
export const OWNER_KLING_MANUAL_DURATION_CURRENT_SOURCE = Object.freeze({ status: "SOURCE_UI_MANUAL", build: "1793890358",
  public_catalog_version: KLING_MANUAL_DURATION_CURRENT_CATALOG,
  settings_inventory_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json",
  form_sha256: "sha256:4763d9a9e3bdb5ee1361363764576e58c31000c15a899f48a21cd4fe84e1b46a",
  slider_sha256: "sha256:77bef1b40ab7d4bce97d12e360b17961467f7315c0d83d6290a2f0ee1d37ee46",
  manual_input: Object.freeze({ show_input_default: true, disabled_input_default: false, form_disabled_input_override: false, disabled_models: ["kling_o1_video2video", "kling_motion_control"] }),
  setter_semantics: "FINITE_NUMBER_AND_CLAMP_NO_ROUNDING_OR_STEP_QUANTIZATION", slider_step: 1,
  ranges: Object.freeze({ base3: [3, 15], keyframes3: [3, 15], kling4: [3, 30], elements3: [3, 15], o1_t2v_i2v: [3, 10] }),
  older_versions: "DROPDOWN5_OR10_UNCHANGED", o1_v2v: "MEASURED_ROUNDED_INTEGER_UNCHANGED",
  model_watchers: "RESET_OPTION_SETS_NOT_MANUAL_VALUES", kling4_duration_watcher: "FITS_FRAME_COUNT_NOT_DURATION",
  provider_acceptance: "UNPROVEN_FRACTIONAL_TUPLES", historical_integer_pins: "PRESERVED" } as const);
export function isKlingFractionalDuration(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value); }
export function isKlingFiniteDuration(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}
export function klingCurrentDurationProfileHash(legacyHash: string, modelId: string, version: string): string {
  return schemaHash({ legacy_profile_sha256: legacyHash, model_id: modelId, version, current_duration_source: OWNER_KLING_MANUAL_DURATION_CURRENT_SOURCE });
}
/** Lazy filesystem-only current selection; legacy constructors and observed integer branches stay on their own catalog. */
export function loadKlingManualDurationCurrentCatalog(catalogDirectory?: string) {
  const catalog = loadSelectedDiscoveryCatalog(KLING_MANUAL_DURATION_CURRENT_CATALOG, catalogDirectory).discoveryCatalog;
  if (catalog.source_hashes.models !== "sha256:11f085ad9b0dd97435d6ebece623fa85bce2870e714e876e6fbb041c562fb438") throw new Error("KLING_CURRENT_DURATION_SOURCE_INVALID");
  return catalog;
}
