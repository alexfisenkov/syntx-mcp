import { schemaHash } from "../domain/generation-contract.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { loadMaplessSettingsInventoryVersion } from "../catalog/mapless-settings-inventory.js";
import type { MaplessSettingsInventory } from "../catalog/mapless-settings-inventory.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { getOwnerSeedream55ImageSourceProfile, SEEDREAM55_PUBLIC_CATALOG_VERSION,
  SEEDREAM55_SETTINGS_VERSION } from "./owner-seedream55-image-source-profile.js";

const BUILD_ID = "1794311734";
const EDITOR_FORM = Object.freeze({ module: "seedream-editor.js", bytes: 8_908,
  sha256: "sha256:0aa8fac751bda837778267174d98add1bc72d5ad29ab51df2c2b7df6e4f5bdc4" });
const SOURCE_HASHES = Object.freeze({
  parent: "sha256:e10de51f9fd3b3361ba1b5d14faf66cab2d836019966f9c72f75df5b4f341592",
  sender: "sha256:a525d39ccabe61aef5f727bcd6a7edca12a263d77d737f54557100eec05cd562",
  constants: "sha256:940ff49e7c5c1c4e28e8dcfb8fa4b1495f258c31219f0af4a1b9e28185953449",
  extras: "sha256:defce768fb2a3cf58707f6ed04982fb597e1d2daeec3d31567d886f42246f1e0",
  cost: "sha256:30ecd2694a05092e2d08dc73d0c903a1c6ca6242163f95dfc7e7901b26c9d648",
  settings: "sha256:b94302b1421ae8df47d1699f5aa0bf377b2ccaec4bb917a65daca0ac0cc586ce",
  typed_urls: "sha256:5aecf4a88f1ef25f4612d03163d64d5c46a6d2537c75936a667ff22668833512",
  upload_component: "sha256:db354d36c91287eb019928a445fa4858436d2bf9e324cf6b6209811eec5d69f0",
  file_uploader: "sha256:d7ee611f47ecf50f16d80800c9cff943688221f9a55011135ac37b7e049d895a",
  canvas: "sha256:fdf5914d87393752c39161412c1fadfe23e043b1751f7c506e5c662f8c8031d4",
  app: "sha256:ee9b82ef3997b7a9981aefc0e294870bf656c89c26ac904e46a4b4e4e5cbf323"
});
const RATIOS = Object.freeze(["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const);
const RESOLUTIONS = Object.freeze(["1K", "1.5K", "2K"] as const);
const MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"] as const);

export class OwnerSeedream55EditorSourceProfileError extends Error {
  constructor(readonly code: "PROFILE_BINDING_MISMATCH") {
    super("Seedream 5.5 Editor source binding is unavailable.");
    this.name = "OwnerSeedream55EditorSourceProfileError";
  }
}

/** Immutable static-source evidence. This does not grant account access or backend acceptance. */
export function getOwnerSeedream55EditorSourceProfile(
  catalog: DiscoveryCatalogRepository = loadSelectedDiscoveryCatalog(SEEDREAM55_PUBLIC_CATALOG_VERSION).discoveryCatalog,
  inventory: MaplessSettingsInventory = loadMaplessSettingsInventoryVersion(SEEDREAM55_SETTINGS_VERSION)
) {
  const fail = (): never => { throw new OwnerSeedream55EditorSourceProfileError("PROFILE_BINDING_MISMATCH"); };
  const normal = getOwnerSeedream55ImageSourceProfile(catalog, SEEDREAM55_PUBLIC_CATALOG_VERSION);
  const form = inventory.forms.find((entry) => entry.form_id === "seedream-editor");
  const model = inventory.models.find((entry) => entry.model_id === "seedream-5.5");
  if (inventory.schema_version !== "2.1.0" || inventory.build.id !== BUILD_ID || inventory.runtime_usable !== false ||
      inventory.public_catalog.version !== SEEDREAM55_PUBLIC_CATALOG_VERSION ||
      inventory.app_sha256 !== SOURCE_HASHES.app || form?.module_name !== EDITOR_FORM.module ||
      form.javascript.bytes !== EDITOR_FORM.bytes || form.javascript.sha256 !== EDITOR_FORM.sha256 ||
      JSON.stringify(form.javascript.model_value_settings_keys) !== JSON.stringify(["aspect_ratio", "model_type", "resolution"]) ||
      model?.active !== true || model.default !== true || model.ai_name !== "seedream" ||
      model.form_id !== "seedream" || model.form_binding_status !== "STRUCTURAL_MATCH" ||
      JSON.stringify(model.settings) !== JSON.stringify(normal.public_settings)) fail();
  const base = deepFreeze({
    profile_id: "seedream55-editor-source-profile-v1" as const,
    variant: "seedream-5.5" as const, model_id: "seedream-5.5" as const,
    family_ai_name: "seedream" as const, navigation_id: "seedream-editor" as const,
    scope: "tool_image_inpaint" as const,
    source_binding: {
      public_catalog_version: SEEDREAM55_PUBLIC_CATALOG_VERSION,
      settings_inventory_version: SEEDREAM55_SETTINGS_VERSION,
      build_id: BUILD_ID, normal_model_profile_hash: normal.profile_schema_hash,
      editor_form: EDITOR_FORM, source_hashes: SOURCE_HASHES,
      form_binding_note: "EDITOR_SELECTOR_55_STATIC_SOURCE; INVENTORY_MODEL_ROW_BINDS_NORMAL_FORM" as const
    },
    controls: {
      aspect_ratios: RATIOS, resolutions: RESOLUTIONS, output_formats: ["jpeg", "png"] as const,
      backgrounds: ["auto", "opaque", "transparent"] as const,
      defaults: { aspect_ratio: "1:1" as const, resolution: "2K" as const, output_format: "png" as const, background: "auto" as const },
      transparent_requires_png: true as const, alpha_reference_required: false as const
    },
    original_input: { accepted_file_types: MIMES, max_source_bytes: 27_525_120,
      generic_max_file_bytes: 31_457_280, max_count: 1 as const, geometry: "CONTAINER_METADATA_ONLY" as const },
    drawing_input: { mime_type: "image/png" as const, max_count: 1 as const,
      source_export: "CANVAS_WITHOUT_BASE_IMAGE_IF_CAN_RESET" as const },
    sender: { method: "POST" as const, route: "design/generate" as const, query_ai_name: "seedream" as const,
      scope: "tool_image_inpaint" as const, file_roles: ["original", "optional_drawing"] as const,
      file_url_type: "image" as const, frontend_omits_n: true as const, stream: false as const },
    cost: { keys: ["batch_size", "resolution"] as const, batch_size: "DRAWING_PRESENT_2_ELSE_1" as const,
      amount: "UNPROVEN" as const },
    rendered_ui: "NOT_CHECKED" as const, account_access: "NOT_CHECKED" as const,
    backend_acceptance: "UNPROVEN" as const, runtime_usable: false as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
