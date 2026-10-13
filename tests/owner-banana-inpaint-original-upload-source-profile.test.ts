import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { loadMaplessSettingsInventoryVersion, type MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  getOwnerBananaInpaintOriginalUploadSourceProfile,
  type OwnerBananaInpaintOriginalUploadCatalogPort,
  type OwnerBananaInpaintOriginalUploadSourceProfile,
  OwnerBananaInpaintOriginalUploadSourceProfileError
} from "../src/application/owner-banana-inpaint-original-upload-source-profile.js";

const C5_PUBLIC_VERSION = "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json";
const SETTINGS_62_VERSION = "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json";
const E551_PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const SETTINGS_00F_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const catalogDirectory = resolve("catalog");
const catalog = loadSelectedDiscoveryCatalog(C5_PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
const settings = loadMaplessSettingsInventoryVersion(SETTINGS_62_VERSION, catalogDirectory);
const e551Catalog = loadSelectedDiscoveryCatalog(E551_PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
const e551Settings = loadMaplessSettingsInventoryVersion(SETTINGS_00F_VERSION, catalogDirectory);

async function getProfileWithInputs(
  variant: string,
  inputCatalog: unknown,
  catalogVersion: unknown,
  inputSettings: unknown,
  settingsVersion: unknown
): Promise<Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>> {
  return getOwnerBananaInpaintOriginalUploadSourceProfile(
    variant, inputCatalog as OwnerBananaInpaintOriginalUploadCatalogPort, catalogVersion,
    inputSettings as MaplessSettingsInventory, settingsVersion
  );
}

async function getProfile(variant: string): Promise<Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>> {
  return getProfileWithInputs(variant, catalog, C5_PUBLIC_VERSION, settings, SETTINGS_62_VERSION);
}

test("banana original-upload profile binds exact c5/62 identity and only original UI upload authority", async () => {
  const profile = await getProfile("banana");
  assert.equal(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, E551_PUBLIC_VERSION);
  assert.deepEqual({
    profile_id: profile.profile_id,
    variant: profile.variant,
    model_id: profile.model_id,
    model_type: profile.model_type,
    family_ai_name: profile.family_ai_name,
    form_ai_name: profile.form_ai_name,
    form_id: profile.form_id,
    catalog_default_flag: profile.catalog_default_flag,
    catalog_default_confidence: profile.catalog_default_confidence,
    public_catalog_version: profile.public_catalog_version,
    settings_inventory_version: profile.settings_inventory_version,
    model_identity: profile.source_binding.model_identity,
    public_source_hashes: profile.source_binding.selected_public_source_hashes,
    settings_binding: profile.source_binding.settings_inventory,
    source_artifacts: profile.source_binding.source_artifacts,
    input_policy: profile.input_policy,
    runtime_usable: profile.runtime_usable,
    runtime_activation: profile.runtime_activation,
    dispatch_allowed: profile.dispatch_allowed,
    backend_acceptance: profile.backend_acceptance,
    has_cost_or_mask_authority: ["cost_policy", "cost_inputs", "reference_count", "mask_permission", "generation_permission"]
      .some((key) => Object.hasOwn(profile, key))
  }, {
    profile_id: "banana-inpaint-original-upload-source-profile-v1",
    variant: "banana",
    model_id: "banana",
    model_type: "banana",
    family_ai_name: "banana",
    form_ai_name: "banana_inpaint",
    form_id: "banana-inpaint",
    catalog_default_flag: false,
    catalog_default_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION",
    public_catalog_version: C5_PUBLIC_VERSION,
    settings_inventory_version: SETTINGS_62_VERSION,
    model_identity: {
      id: "banana", upstream_id: "banana", ai_name: "banana", active: true, default: false
    },
    public_source_hashes: {
      ai: "sha256:b99bb90d170acb5a3a06c5be0cbc51d2ab0d17902bee21303a44b32c5fcaef39",
      llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
      models: "sha256:16735c498e3743b67fb384ccee44de34ffd3ac8debaeb46033a5723938191a58"
    },
    settings_binding: {
      schema_version: "2.1.0",
      public_catalog_version: C5_PUBLIC_VERSION,
      build_id: "1791467421",
      runtime_usable: false,
      family_model_form: { form_id: "banana", form_binding_status: "STRUCTURAL_MATCH", settings_status: "PUBLIC_SETTINGS_KNOWN" },
      inpaint_form: {
        form_id: "banana-inpaint", module_name: "banana-inpaint.js", bytes: 8715,
        sha256: "sha256:4a22ce6da71d2b39c97614cdfcde3d38f201dad3015f2a59f018d8b7c8146172",
        parse_diagnostics: 0, model_value_settings_keys: ["image_size", "model_type"], static_setting_defaults: {}
      }
    },
    source_artifacts: {
      inpaint_form: {
        module: "banana-inpaint.js", bytes: 8715,
        sha256: "sha256:4a22ce6da71d2b39c97614cdfcde3d38f201dad3015f2a59f018d8b7c8146172"
      },
      original_upload_caller: {
        module: "useImageEditorTool.js", bytes: 12652,
        sha256: "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe"
      },
      settings_helper: {
        module: "settings3.js", bytes: 4123,
        sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe"
      },
      app_upload_store: {
        module: "app.js", bytes: 2445534,
        sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf"
      }
    },
    input_policy: {
      accepted_file_types: ["image/jpeg", "image/png"],
      max_file_bytes: 52_428_800,
      max_file_count: 1,
      size_scope: "SOURCE_UI_FILE_INPUT_LIMIT_NOT_PROVIDER_LIMIT",
      destination: "hidden",
      check_duplicates: true,
      model_type_source: "EXPLICIT_UNDERLYING_BANANA_VARIANT"
    },
    runtime_usable: false,
    runtime_activation: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN",
    has_cost_or_mask_authority: false
  });
  assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.source_binding), true);
  assert.equal(Object.isFrozen(profile.input_policy), true);
});

test("banana2 has its own active underlying model identity and catalog-only default metadata", async () => {
  const profile = await getProfile("banana2");
  assert.deepEqual({
    variant: profile.variant, model_id: profile.model_id, model_type: profile.model_type,
    family_ai_name: profile.family_ai_name, form_ai_name: profile.form_ai_name, form_id: profile.form_id,
    active: profile.source_binding.model_identity.active,
    catalog_default_flag: profile.catalog_default_flag,
    catalog_default_confidence: profile.catalog_default_confidence,
    public_catalog_version: profile.public_catalog_version,
    settings_inventory_version: profile.settings_inventory_version,
    dispatch_allowed: profile.dispatch_allowed, backend_acceptance: profile.backend_acceptance
  }, {
    variant: "banana2", model_id: "banana2", model_type: "banana2",
    family_ai_name: "banana", form_ai_name: "banana_inpaint", form_id: "banana-inpaint",
    active: true, catalog_default_flag: false,
    catalog_default_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION",
    public_catalog_version: C5_PUBLIC_VERSION, settings_inventory_version: SETTINGS_62_VERSION,
    dispatch_allowed: false, backend_acceptance: "UNPROVEN"
  });
});

test("banana3 has its own active underlying model identity without promoting its default", async () => {
  const profile = await getProfile("banana3");
  assert.deepEqual({
    variant: profile.variant, model_id: profile.model_id, model_type: profile.model_type,
    family_ai_name: profile.family_ai_name, active: profile.source_binding.model_identity.active,
    catalog_default_flag: profile.catalog_default_flag,
    catalog_default_confidence: profile.catalog_default_confidence,
    runtime_usable: profile.runtime_usable, runtime_activation: profile.runtime_activation,
    dispatch_allowed: profile.dispatch_allowed, backend_acceptance: profile.backend_acceptance
  }, {
    variant: "banana3", model_id: "banana3", model_type: "banana3",
    family_ai_name: "banana", active: true, catalog_default_flag: true,
    catalog_default_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION",
    runtime_usable: false, runtime_activation: false, dispatch_allowed: false, backend_acceptance: "UNPROVEN"
  });
});

test("banana3_light is independently bound and does not alias the banana3 profile", async () => {
  const profile = await getProfile("banana3_light");
  assert.deepEqual({
    variant: profile.variant, model_id: profile.model_id, model_type: profile.model_type,
    family_ai_name: profile.family_ai_name, form_ai_name: profile.form_ai_name,
    active: profile.source_binding.model_identity.active,
    catalog_default_flag: profile.catalog_default_flag,
    public_catalog_version: profile.public_catalog_version,
    settings_inventory_version: profile.settings_inventory_version,
    inpaint_form_sha256: profile.source_binding.settings_inventory.inpaint_form.sha256
  }, {
    variant: "banana3_light", model_id: "banana3_light", model_type: "banana3_light",
    family_ai_name: "banana", form_ai_name: "banana_inpaint", active: true,
    catalog_default_flag: true, public_catalog_version: C5_PUBLIC_VERSION,
    settings_inventory_version: SETTINGS_62_VERSION,
    inpaint_form_sha256: "sha256:4a22ce6da71d2b39c97614cdfcde3d38f201dad3015f2a59f018d8b7c8146172"
  });
  assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
});

test("rejects the excluded banana-2.1 row and banana_inpaint navigation alias as upload variants", async () => {
  await assert.rejects(getProfile("banana-2.1"), (error: unknown) =>
    error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "INVALID_REQUEST");
  await assert.rejects(getProfile("banana_inpaint"), (error: unknown) =>
    error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "INVALID_REQUEST");
});

test("rejects e551 and mismatched public/settings source pairs instead of inheriting the global selector", async () => {
  await assert.rejects(getProfileWithInputs("banana", e551Catalog, E551_PUBLIC_VERSION, e551Settings, SETTINGS_00F_VERSION),
    (error: unknown) => error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  await assert.rejects(getProfileWithInputs("banana", catalog, C5_PUBLIC_VERSION, settings, SETTINGS_00F_VERSION),
    (error: unknown) => error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  await assert.rejects(getProfileWithInputs("banana", catalog, C5_PUBLIC_VERSION, e551Settings, SETTINGS_00F_VERSION),
    (error: unknown) => error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
});

test("rejects changed catalog default metadata even when the archived source hashes are copied", async () => {
  const alteredCatalog = {
    catalog_kind: catalog.catalog_kind,
    runtime_usable: catalog.runtime_usable,
    fetched_at: catalog.fetched_at,
    source_hashes: catalog.source_hashes,
    catalog_metadata: catalog.catalog_metadata,
    getModel(modelId: string) {
      const model = catalog.getModel(modelId);
      return modelId === "banana" ? { ...model, default: true } : model;
    }
  };
  await assert.rejects(getProfileWithInputs("banana", alteredCatalog, C5_PUBLIC_VERSION, settings, SETTINGS_62_VERSION),
    (error: unknown) => error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
});

test("rejects inactive or wrong-family underlying model rows", async () => {
  for (const mutation of [{ active: false }, { ai_name: "banana_inpaint" }]) {
    const alteredCatalog = {
      catalog_kind: catalog.catalog_kind,
      runtime_usable: catalog.runtime_usable,
      fetched_at: catalog.fetched_at,
      source_hashes: catalog.source_hashes,
      catalog_metadata: catalog.catalog_metadata,
      getModel(modelId: string) {
        const model = catalog.getModel(modelId);
        return modelId === "banana" ? { ...model, ...mutation } : model;
      }
    };
    await assert.rejects(getProfileWithInputs("banana", alteredCatalog, C5_PUBLIC_VERSION, settings, SETTINGS_62_VERSION),
      (error: unknown) => error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  }
});

test("rejects a source-hash or embedded settings-pair mutation", async () => {
  const changedHashes = { ...catalog.source_hashes, models: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
  const changedHashCatalog = {
    catalog_kind: catalog.catalog_kind,
    runtime_usable: catalog.runtime_usable,
    fetched_at: catalog.fetched_at,
    source_hashes: changedHashes,
    catalog_metadata: { ...catalog.catalog_metadata, source_hashes: changedHashes },
    getModel: (modelId: string) => catalog.getModel(modelId)
  };
  await assert.rejects(getProfileWithInputs("banana", changedHashCatalog, C5_PUBLIC_VERSION, settings, SETTINGS_62_VERSION),
    (error: unknown) => error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");

  const changedPair = structuredClone(settings) as typeof settings & { public_catalog: { version: string } };
  changedPair.public_catalog.version = E551_PUBLIC_VERSION;
  await assert.rejects(getProfileWithInputs("banana", catalog, C5_PUBLIC_VERSION, changedPair, SETTINGS_62_VERSION),
    (error: unknown) => error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
});

test("rejects c5/62 model-row identity drift between the paired archives", async () => {
  const changedSettings = structuredClone(settings);
  changedSettings.models.find((model) => model.model_id === "banana")!.default = true;
  await assert.rejects(getProfileWithInputs("banana", catalog, C5_PUBLIC_VERSION, changedSettings, SETTINGS_62_VERSION),
    (error: unknown) => error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
});

test("rejects changed inpaint-form, settings-helper, or app uploader source pins", async () => {
  const changedForm = structuredClone(settings);
  changedForm.forms.find((form) => form.form_id === "banana-inpaint")!.javascript.sha256 =
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const changedHelper = structuredClone(settings);
  changedHelper.framework.settings3.sha256 = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const changedApp = structuredClone(settings);
  changedApp.app_sha256 = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  for (const changed of [changedForm, changedHelper, changedApp]) {
    await assert.rejects(getProfileWithInputs("banana", catalog, C5_PUBLIC_VERSION, changed, SETTINGS_62_VERSION),
      (error: unknown) => error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  }
});

test("rejects proxy and accessor metadata without invoking getters", async () => {
  let settingsGetterReads = 0;
  const getterSettings = Object.defineProperty({ ...settings }, "app_sha256", {
    enumerable: true,
    get() { settingsGetterReads += 1; return settings.app_sha256; }
  });
  await assert.rejects(getProfileWithInputs("banana", catalog, C5_PUBLIC_VERSION, getterSettings, SETTINGS_62_VERSION),
    (error: unknown) => error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.equal(settingsGetterReads, 0);

  let catalogGetterReads = 0;
  const getterCatalog = Object.defineProperty({
    catalog_kind: catalog.catalog_kind,
    runtime_usable: catalog.runtime_usable,
    fetched_at: catalog.fetched_at,
    source_hashes: catalog.source_hashes,
    catalog_metadata: catalog.catalog_metadata
  }, "getModel", {
    enumerable: true,
    get() { catalogGetterReads += 1; return catalog.getModel.bind(catalog); }
  });
  await assert.rejects(getProfileWithInputs("banana", getterCatalog, C5_PUBLIC_VERSION, settings, SETTINGS_62_VERSION),
    (error: unknown) => error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.equal(catalogGetterReads, 0);

  let proxyReads = 0;
  const proxySettings = new Proxy(settings, { get() { proxyReads += 1; throw new Error("unexpected getter trap"); } });
  await assert.rejects(getProfileWithInputs("banana", catalog, C5_PUBLIC_VERSION, proxySettings, SETTINGS_62_VERSION),
    (error: unknown) => error instanceof OwnerBananaInpaintOriginalUploadSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.equal(proxyReads, 0);
});
