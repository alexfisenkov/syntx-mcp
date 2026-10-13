import assert from "node:assert/strict";
import test from "node:test";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { normalizeOwnerSoulGenerationParameters } from "../src/application/owner-soul-generation-parameters.js";
import { projectOwnerSoulImageCostParameters } from "../src/application/owner-soul-image-cost-parameters.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const catalog = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;
const moduleUrl = new URL("../src/application/owner-soul-image-source-profile.js", import.meta.url).href;
const EXPECTED_PAIRS = {
  "720p": ["2048x1152", "1680x1120", "1536x1152", "1536x1536", "1152x1536", "1120x1680", "1152x2048"],
  "1080p": ["2048x1152", "2016x1344", "2048x1536", "1536x1536", "1536x2048", "1344x2016", "1152x2048"]
} as const;

test("binds the complete explicit Soul image intent to e551 and exact retained source identities without granting dispatch", async () => {
  let module: Record<string, unknown> | null = null;
  try { module = await import(moduleUrl) as Record<string, unknown>; } catch { /* expected first RED until profile module exists */ }
  assert.equal(typeof module?.getOwnerSoulImageSourceProfile, "function", "MISSING_OWNER_SOUL_IMAGE_SOURCE_PROFILE");
  const readProfile = module!.getOwnerSoulImageSourceProfile as (model: string, catalogInput: typeof catalog, version: string) => Record<string, any>;
  const profile = readProfile("higgsfield-soul", catalog, CATALOG_VERSION);

  assert.equal(profile.model_id, "higgsfield-soul");
  assert.equal(profile.ai_name, "higgsfield-soul");
  assert.equal(profile.model_type, "higgsfield-soul");
  assert.equal(profile.operation_id, "generate-image");
  assert.equal(profile.public_catalog_version, CATALOG_VERSION);
  assert.equal(profile.catalog_default_flag, true);
  assert.equal(profile.source_binding.full_public_record_sha256,
    "sha256:16da8ea2298f05143e9992197536d63830a9359428312e2c635287d8f152fa22");
  assert.deepEqual(profile.parameters_source.quality_resolution_pairs, EXPECTED_PAIRS);
  assert.deepEqual(profile.parameters_source.batch_size.values, [1, 4]);
  assert.equal(profile.parameters_source.enhance_prompt.type, "boolean");
  assert.equal(profile.parameters_source.seed.nullable, true);
  assert.equal(profile.parameters_source.seed.minimum, 0);
  assert.equal(profile.parameters_source.seed.maximum, 2_147_483_647);
  assert.deepEqual(profile.parameters_source.style.modes, ["none", "selected"]);
  assert.equal(profile.style_selection.maximum_selections, 1);
  assert.equal(profile.style_selection.identifier, "DYNAMIC_NOT_STATIC_ENUM");
  assert.deepEqual([profile.parameters_source.style_strength.minimum, profile.parameters_source.style_strength.maximum,
    profile.parameters_source.style_strength.step], [0, 1, 0.1]);
  assert.deepEqual(profile.parameters_source.character.modes, ["none", "selected"]);
  assert.equal(profile.character_selection.selected_value_source, "record.reference_id");
  assert.equal(profile.character_selection.selection_requires_status, "completed");
  assert.equal(profile.character_selection.server_reference_id_type, "UNOBSERVED_EMPTY_LIST");

  assert.equal(profile.reference_strength.initializer_value, 0.7);
  assert.equal(profile.reference_strength.visible_control, false);
  assert.equal(profile.reference_strength.removed_by_fixed_cache_prune, false);
  assert.equal(profile.reference_strength.effective_value, "UNPROVEN");
  assert.equal(profile.reference_strength.backend_acceptance, "UNPROVEN");
  assert.equal(profile.source_binding.sender.direct_soul_form_mount, "DYNAMIC_FORM_MOUNT_UNRESOLVED_UI");
  assert.equal(profile.source_binding.sender.custom_payload_branch, "TRUTHY_REPLACES_SETTINGS_NOT_MERGED");
  assert.equal(profile.source_binding.sender.reference_canonicalization, "APPENDS_MAPPED_FILES_TO_SETTINGS_FILE_URLS");
  assert.equal(profile.source_binding.sender.ordinary_branch, "IF_CUSTOM_SLOT_NULL_SPREADS_APP_STORE_SETTINGS");
  assert.equal(profile.source_binding.sender.reference_strength_wire_fate, "CONDITIONAL_NOT_RUNTIME_OBSERVED");
  assert.equal(profile.source_binding.files.form.sha256, "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391");
  assert.equal(profile.source_binding.files.app_store.sha256, "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf");
  assert.equal(profile.source_binding.files.settings_helper.sha256, "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe");
  assert.equal(profile.source_binding.files.sender_parent.sha256, "sha256:eb4fe700c7afae0756348aad3118c55ec8c9b5f5e5d18832045be07bbd368447");
  assert.equal(profile.source_binding.files.sender_module.sha256, "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae");
  assert.deepEqual(profile.cost_policy.declared_model_info_keys, ["quality", "resolution", "batch_size", "version"]);
  assert.equal(profile.cost_policy.generation_cost_inputs, null);
  assert.equal(profile.cost_policy.version_value, "UNRESOLVED_NOT_UI_CONTROL");
  assert.equal(profile.public_input_metadata.max_file_size, 0);
  assert.equal(profile.public_input_metadata.max_file_size_interpretation, "ZERO_UNRESOLVED_NOT_UNLIMITED_OR_PROVIDER_CAP");
  assert.equal(profile.public_input_metadata.max_prompt_length, 0);
  assert.equal(profile.public_input_metadata.file_count_limit, null);
  assert.equal(profile.direct_ui_mount_blocks_explicit_native_intent, false);
  assert.equal(profile.dispatch_allowed, false);
  assert.equal(profile.runtime_activation, false);
  assert.equal(profile.backend_acceptance, "UNPROVEN");
  assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.parameters_source.quality_resolution_pairs), true);
});

test("all 14 literal quality-resolution pairs remain valid and cross-pair combinations are rejected", async () => {
  for (const [quality, resolutions] of Object.entries(EXPECTED_PAIRS)) {
    for (const resolution of resolutions) {
      const normalized = normalizeOwnerSoulGenerationParameters({ prompt: "explicit test prompt", quality, resolution,
        batch_size: 1, enhance_prompt: true, seed: null, style: { kind: "none" }, character: { kind: "none" } });
      assert.equal(normalized.intent.quality, quality);
      assert.equal(normalized.intent.resolution, resolution);
      assert.equal(normalized.dispatch_allowed, false);
    }
  }
  assert.throws(() => normalizeOwnerSoulGenerationParameters({ prompt: "explicit test prompt", quality: "720p", resolution: "2016x1344",
    batch_size: 1, enhance_prompt: true, seed: null, style: { kind: "none" }, character: { kind: "none" } }));
  assert.throws(() => normalizeOwnerSoulGenerationParameters({ prompt: "explicit test prompt", quality: "1080p", resolution: "1680x1120",
    batch_size: 4, enhance_prompt: false, seed: 0, style: { kind: "none" }, character: { kind: "none" } }));
});

test("source profile reflects the actual 794 cost projection definition without inventing per-intent values", async () => {
  const module = await import(moduleUrl) as Record<string, unknown>;
  const readProfile = module.getOwnerSoulImageSourceProfile as (model: string, catalogInput: typeof catalog, version: string) => Record<string, any>;
  const profile = readProfile("higgsfield-soul", catalog, CATALOG_VERSION);
  const actual = projectOwnerSoulImageCostParameters({ prompt: "explicit projection test", quality: "720p",
    resolution: "2048x1152", batch_size: 4, enhance_prompt: false, seed: null,
    style: { kind: "none" }, character: { kind: "none" } });
  assert.deepEqual(Object.keys(actual.cost_inputs), ["quality", "resolution", "batch_size"]);
  assert.deepEqual(actual.routing, { ai_name: "higgsfield-soul", model_type: "higgsfield-soul" });
  assert.deepEqual(profile.cost_policy.cost_input_keys, ["quality", "resolution", "batch_size"]);
  assert.equal(profile.cost_policy.projector, "projectOwnerSoulImageCostParameters");
  assert.equal(profile.cost_policy.cost_inputs_confidence, actual.cost_inputs_confidence);
  assert.equal(actual.cost_inputs_confidence, "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP");
  assert.equal(profile.cost_policy.projection_status, "JOINED_PARAMETER_DEFINITION_ONLY_NO_INTENT_VALUES");
  assert.equal(profile.cost_policy.generation_cost_inputs, null);
  assert.equal(profile.cost_policy.query_is_generation_wire, false);
  assert.equal(profile.cost_policy.version_value, "UNRESOLVED_NOT_UI_CONTROL");
  assert.equal(Object.isFrozen(profile.cost_policy.cost_input_keys), true);
  for (const [quality, resolutions] of Object.entries(EXPECTED_PAIRS)) {
    for (const resolution of resolutions) {
      for (const batch_size of [1, 4] as const) {
        for (const style of [{ kind: "none" } as const,
          { kind: "selected", style_handle: "soul_style_00000000-0000-4000-8000-000000000001", strength: 0.7 } as const]) {
          for (const character of [{ kind: "none" } as const,
            { kind: "selected", character_handle: "soul_character_00000000-0000-4000-8000-000000000001" } as const]) {
            const projection = projectOwnerSoulImageCostParameters({ prompt: "explicit projection test", quality, resolution,
              batch_size, enhance_prompt: true, seed: null, style, character });
            assert.deepEqual(projection.cost_inputs, { quality, resolution, batch_size });
            assert.deepEqual(Object.keys(projection.cost_inputs), ["quality", "resolution", "batch_size"]);
          }
        }
      }
    }
  }
  assert.throws(() => projectOwnerSoulImageCostParameters({ prompt: "bad cross-pair", quality: "720p",
    resolution: "2016x1344", batch_size: 1, enhance_prompt: true, seed: null,
    style: { kind: "none" }, character: { kind: "none" } }));
  let getterCalls = 0;
  const accessorIntent = { prompt: "explicit test", resolution: "2048x1152", batch_size: 1,
    enhance_prompt: true, seed: null, style: { kind: "none" }, character: { kind: "none" } };
  Object.defineProperty(accessorIntent, "quality", { enumerable: true, get() { getterCalls += 1; return "720p"; } });
  assert.throws(() => projectOwnerSoulImageCostParameters(accessorIntent));
  assert.equal(getterCalls, 0);
});

test("rejects unknown models, archive/pin drift, full-row mutation, proxies, and accessors without invoking getters", async () => {
  const module = await import(moduleUrl) as Record<string, unknown>;
  const readProfile = module.getOwnerSoulImageSourceProfile as (model: string, catalogInput: unknown, version: string) => unknown;
  const ProfileError = module.OwnerSoulImageSourceProfileError as new (...args: never[]) => Error & { code: string };
  const mismatch = (error: unknown) => error instanceof ProfileError && error.code === "PROFILE_BINDING_MISMATCH";
  const invalid = (error: unknown) => error instanceof ProfileError && error.code === "INVALID_REQUEST";

  assert.throws(() => readProfile("unknown-soul-model", catalog, CATALOG_VERSION), invalid);
  assert.throws(() => readProfile("higgsfield-soul", catalog, "sha256-foreign.json"), mismatch);

  const original = catalog.getModel("higgsfield-soul");
  const changedDisplay = { ...structuredClone(original), display_name: "Changed Soul label" };
  const changedRowCatalog = {
    fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes, catalog_metadata: catalog.catalog_metadata,
    catalog_kind: catalog.catalog_kind, runtime_usable: catalog.runtime_usable,
    getModel: (model: string) => model === "higgsfield-soul" ? changedDisplay : catalog.getModel(model)
  };
  assert.throws(() => readProfile("higgsfield-soul", changedRowCatalog, CATALOG_VERSION), mismatch);

  const changedSettings = structuredClone(original);
  assert.ok(changedSettings.settings);
  changedSettings.settings.max_file_size = 1;
  const changedSettingsCatalog = { ...changedRowCatalog,
    getModel: (model: string) => model === "higgsfield-soul" ? changedSettings : catalog.getModel(model) };
  assert.throws(() => readProfile("higgsfield-soul", changedSettingsCatalog, CATALOG_VERSION), mismatch);

  const alteredHashes = { ...catalog.source_hashes, models: `sha256:${"0".repeat(64)}` };
  const alteredHashCatalog = {
    fetched_at: catalog.fetched_at, source_hashes: alteredHashes,
    catalog_metadata: { ...catalog.catalog_metadata, source_hashes: alteredHashes },
    catalog_kind: catalog.catalog_kind, runtime_usable: catalog.runtime_usable, getModel: catalog.getModel.bind(catalog)
  };
  assert.throws(() => readProfile("higgsfield-soul", alteredHashCatalog, CATALOG_VERSION), mismatch);

  let catalogGetterCalls = 0;
  const catalogGetter = Object.defineProperties({}, {
    fetched_at: { enumerable: true, get() { catalogGetterCalls += 1; throw new Error("must not read getter"); } },
    source_hashes: { value: catalog.source_hashes, enumerable: true },
    catalog_metadata: { value: catalog.catalog_metadata, enumerable: true },
    catalog_kind: { value: catalog.catalog_kind, enumerable: true },
    runtime_usable: { value: catalog.runtime_usable, enumerable: true },
    getModel: { value: catalog.getModel.bind(catalog), enumerable: true }
  });
  assert.throws(() => readProfile("higgsfield-soul", catalogGetter, CATALOG_VERSION), mismatch);
  assert.equal(catalogGetterCalls, 0);

  let catalogProxyTraps = 0;
  const catalogProxy = new Proxy(catalog, { get(target, key, receiver) { catalogProxyTraps += 1; return Reflect.get(target, key, receiver); } });
  assert.throws(() => readProfile("higgsfield-soul", catalogProxy, CATALOG_VERSION), invalid);
  assert.equal(catalogProxyTraps, 0);

  const accessorRow = structuredClone(original);
  let rowGetterCalls = 0;
  Object.defineProperty(accessorRow.settings, "max_prompt_length", { enumerable: true, get() {
    rowGetterCalls += 1; throw new Error("must not read row getter");
  } });
  const accessorRowCatalog = { ...changedRowCatalog,
    getModel: (model: string) => model === "higgsfield-soul" ? accessorRow : catalog.getModel(model) };
  assert.throws(() => readProfile("higgsfield-soul", accessorRowCatalog, CATALOG_VERSION), mismatch);
  assert.equal(rowGetterCalls, 0);
});
