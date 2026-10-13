import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { loadMaplessSettingsInventoryVersion, type MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  getOwnerSeedreamEditorOriginalUploadSourceProfile,
  OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
  OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
  type OwnerSeedreamEditorOriginalUploadCatalogPort,
  OwnerSeedreamEditorOriginalUploadSourceProfileError
} from "../src/application/owner-seedream-editor-original-upload-source-profile.js";

const E551_PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const SETTINGS_00F_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const catalogDirectory = resolve("catalog");
const catalog = loadSelectedDiscoveryCatalog(OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
const settings = loadMaplessSettingsInventoryVersion(OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION, catalogDirectory);
const e551Catalog = loadSelectedDiscoveryCatalog(E551_PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
const settings00f = loadMaplessSettingsInventoryVersion(SETTINGS_00F_VERSION, catalogDirectory);
const VARIANTS = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;

function getProfile(variant: string, inputCatalog: unknown = catalog, catalogVersion: unknown = OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
  inputSettings: unknown = settings, settingsVersion: unknown = OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION) {
  return getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, inputCatalog as OwnerSeedreamEditorOriginalUploadCatalogPort,
    catalogVersion, inputSettings as MaplessSettingsInventory, settingsVersion);
}
function profileMismatch(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof OwnerSeedreamEditorOriginalUploadSourceProfileError && error.code === code);
}

test("source profile pins exact c5/62bc archives, Editor operation, uploader branch, and parent/helper source hashes", () => {
  assert.equal(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, E551_PUBLIC_VERSION);
  const profile = getProfile("seedream-5.0-pro");
  assert.deepEqual({
    profile_id: profile.profile_id, variant: profile.variant, model_id: profile.model_id, model_type: profile.model_type,
    navigation_id: profile.navigation_id, family_ai_name: profile.family_ai_name, form_ai_name: profile.form_ai_name, scope: profile.scope,
    public_catalog_version: profile.public_catalog_version, settings_inventory_version: profile.settings_inventory_version,
    model_identity: profile.source_binding.model_identity, source_hashes: profile.source_binding.selected_public_source_hashes,
    editor_form: profile.source_binding.settings_inventory.editor_form, source_artifacts: profile.source_binding.source_artifacts,
    input_policy: profile.input_policy, runtime_usable: profile.runtime_usable, runtime_activation: profile.runtime_activation,
    generation_allowed: profile.generation_allowed, dispatch_allowed: profile.dispatch_allowed, backend_acceptance: profile.backend_acceptance
  }, {
    profile_id: "seedream-editor-original-upload-source-profile-v1", variant: "seedream-5.0-pro", model_id: "seedream-5.0-pro", model_type: "seedream-5.0-pro",
    navigation_id: "seedream-editor", family_ai_name: "seedream", form_ai_name: "seedream-editor", scope: "tool_image_inpaint",
    public_catalog_version: OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, settings_inventory_version: OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
    model_identity: { id: "seedream-5.0-pro", upstream_id: "seedream-5.0-pro", ai_name: "seedream", active: true, default: false },
    source_hashes: {
      ai: "sha256:b99bb90d170acb5a3a06c5be0cbc51d2ab0d17902bee21303a44b32c5fcaef39",
      llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
      models: "sha256:16735c498e3743b67fb384ccee44de34ffd3ac8debaeb46033a5723938191a58"
    },
    editor_form: {
      form_id: "seedream-editor", module_name: "seedream-editor.js", bytes: 7628,
      sha256: "sha256:2026192d5b0f086446873996ad20cf4691f665d4019621eef3241887ffb3ad7c", parse_diagnostics: 0,
      model_value_settings_keys: ["aspect_ratio", "resolution"], static_setting_defaults: {}
    },
    source_artifacts: {
      editor_form: { module: "seedream-editor.js", bytes: 7628, sha256: "sha256:2026192d5b0f086446873996ad20cf4691f665d4019621eef3241887ffb3ad7c" },
      editor_parent: { module: "InpaintEditor.js", bytes: 24250, sha256: "sha256:87509acda1040d79927edc30d8ddd18d503a6e7ce9387d5d0a059b1eb5028e14" },
      generic_sender: { module: "useInpaintTool.js", bytes: 218328, sha256: "sha256:de8396adca45a5ba79c9c52cdfa91b23f45285645bed5df120c0f337a192deb2" },
      settings_helper: { module: "settings3.js", bytes: 4123, sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" },
      file_upload_component: { module: "FileUpload.js", bytes: 30206, sha256: "sha256:2eddb5ee7f0b41cd31f56a2345542d9b5d70da419d1c2b1d003afc36519869d5" },
      file_uploader: { module: "fileUploader.js", bytes: 362328, sha256: "sha256:b1e9af34daa830845c9712121ebb25c92801d22bbcec4f49d8b1748ecbc47786" },
      app_store_and_upload: { module: "app.js", bytes: 2445534, sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" }
    },
    input_policy: {
      accepted_file_types: ["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"],
      source_ui_max_file_bytes: 31_457_280, source_ui_limit_is_provider_limit: false,
      local_parser_max_bytes: 33_554_432, local_parser_policy: "BOUNDED_CONTAINER_INSPECTION_ONLY_NOT_SOURCE_OR_PROVIDER_LIMIT",
      max_file_count: 1, destination: "uploaded", check_duplicates: true, model_type_source: "EXPLICIT_UNDERLYING_VARIANT",
      min_image_aspect_ratio: 1 / 16, max_image_aspect_ratio: 16, side_limits: "NOT_SPECIFIED_BY_EDITOR_SOURCE",
      metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"
    },
    runtime_usable: false, runtime_activation: false, generation_allowed: false, dispatch_allowed: false, backend_acceptance: "UNPROVEN"
  });
  assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.source_binding.source_artifacts.editor_form), true);
  assert.equal(Object.isFrozen(profile.input_policy.accepted_file_types), true);
});

test("all five profiles bind one underlying active public row and the one shared structural form", () => {
  const expectedCaps = [10_485_760, 10_485_760, 10_485_760, 31_457_280, 31_457_280];
  for (const [index, variant] of VARIANTS.entries()) {
    const profile = getProfile(variant);
    assert.equal(profile.variant, variant);
    assert.equal(profile.model_id, variant);
    assert.equal(profile.model_type, variant);
    assert.equal(profile.source_binding.model_identity.id, variant);
    assert.equal(profile.source_binding.model_identity.active, true);
    assert.equal(profile.input_policy.source_ui_max_file_bytes, expectedCaps[index]);
    assert.equal(profile.input_policy.max_file_count, 1);
    assert.equal(profile.input_policy.destination, "uploaded");
    assert.equal(profile.input_policy.check_duplicates, true);
    assert.equal(profile.input_policy.model_type_source, "EXPLICIT_UNDERLYING_VARIANT");
    assert.equal(profile.source_binding.settings_inventory.editor_form.sha256,
      "sha256:2026192d5b0f086446873996ad20cf4691f665d4019621eef3241887ffb3ad7c");
  }
  for (const variant of VARIANTS.slice(0, 3)) {
    const profile = getProfile(variant);
    assert.equal(profile.input_policy.min_image_aspect_ratio, null);
    assert.equal(profile.input_policy.max_image_aspect_ratio, null);
    assert.equal("max_image_dimension" in profile.input_policy, false);
    assert.equal("max_image_file_size" in profile.input_policy, false);
  }
  for (const variant of VARIANTS.slice(3)) {
    const profile = getProfile(variant);
    assert.equal(profile.input_policy.min_image_aspect_ratio, 1 / 16);
    assert.equal(profile.input_policy.max_image_aspect_ratio, 16);
    assert.equal("min_image_width" in profile.input_policy, false);
    assert.equal("max_image_width" in profile.input_policy, false);
  }
});

test("rejects global e551, mismatched settings pairs, variant aliases, spoofed rows, and changed mapped metadata", () => {
  profileMismatch(() => getProfile("seedream-4", e551Catalog, E551_PUBLIC_VERSION, settings00f, SETTINGS_00F_VERSION), "PROFILE_BINDING_MISMATCH");
  profileMismatch(() => getProfile("seedream-4", catalog, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, settings, SETTINGS_00F_VERSION), "PROFILE_BINDING_MISMATCH");
  profileMismatch(() => getProfile("seedream-editor"), "INVALID_REQUEST");
  profileMismatch(() => getProfile("seedream-4", {
    catalog_kind: catalog.catalog_kind, runtime_usable: catalog.runtime_usable, fetched_at: catalog.fetched_at,
    source_hashes: catalog.source_hashes, catalog_metadata: catalog.catalog_metadata,
    getModel(modelId: string) { const model = catalog.getModel(modelId); return modelId === "seedream-4" ? { ...model, active: false } : model; }
  }, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION), "PROFILE_BINDING_MISMATCH");
  const alteredSettings = structuredClone(settings) as MaplessSettingsInventory;
  const row = alteredSettings.models.find((item) => item.model_id === "seedream-5.0-flash")!;
  (row.settings as Record<string, unknown>).max_file_size = 10_485_760;
  profileMismatch(() => getProfile("seedream-5.0-flash", catalog, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, alteredSettings), "PROFILE_BINDING_MISMATCH");
});
