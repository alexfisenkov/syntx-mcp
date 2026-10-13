import assert from "node:assert/strict";
import test from "node:test";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  getOwnerIdeogramImageSourceProfile
} from "../src/application/owner-ideogram-image-source-profile.js";

const VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const catalog = loadSelectedDiscoveryCatalog(VERSION).discoveryCatalog;
const CONTEXTS = [
  ["ideogram", "generate", true, 5, 0, 0, ["rendering_speed", "batch_size"]],
  ["ideogram", "remix", true, 5, 0, 0, ["rendering_speed", "batch_size"]],
  ["ideogram", "reframe", true, 5, 0, 0, ["rendering_speed", "batch_size"]],
  ["ideogram", "replace_background", true, 5, 0, 0, ["rendering_speed", "batch_size"]],
  ["ideogram", "character_reference", true, 5, 0, 0, ["rendering_speed", "batch_size"]],
  ["ideogram_40", "generate", false, 1, 52_428_800, 10_000, ["rendering_speed", "mode", "resolution", "batch_size"]],
  ["ideogram_40", "transparent", false, 1, 52_428_800, 10_000, ["rendering_speed", "mode", "resolution", "batch_size"]],
  ["ideogram_45", "generate", true, 5, 26_214_400, 10_000, ["rendering_speed", "ref_count", "batch_size"]],
  ["ideogram_45", "precise_edit", true, 5, 26_214_400, 10_000, ["rendering_speed", "ref_count", "batch_size"]]
] as const;
const BASE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const;
const V4_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
const COST_INPUTS = {
  ideogram: ["rendering_speed←selected_setting", "batch_size←num_images"],
  ideogram_40: ["rendering_speed←selected_setting", "mode←transparent_apiMode_only", "resolution←selected_setting", "batch_size←num_images"],
  ideogram_45: ["rendering_speed←selected_setting", "ref_count←original_image_references_mask_excluded", "batch_size←num_images"]
} as const;

test("binds each of the nine exact model/mode contexts to the selected e551 and 00f rows", () => {
  assert.equal(CONTEXTS.length, 9);
  for (const [modelId, mode, defaultFlag, fileCount, sourceMaxBytes, promptMax, costKeys] of CONTEXTS) {
    const profile = getOwnerIdeogramImageSourceProfile(modelId, mode, catalog, VERSION);
    assert.equal(profile.profile_id, "ideogram-image-source-profile-v1");
    assert.equal(profile.model_id, modelId);
    assert.equal(profile.mode, mode);
    assert.deepEqual(profile.source_context, { model_id: modelId, mode });
    assert.equal(profile.catalog_default_flag, defaultFlag);
    assert.equal(profile.operation_id, "generate-image");
    assert.equal(profile.public_catalog_version, VERSION);
    assert.equal(profile.source_binding.selected_public_catalog_fetched_at, "2026-10-08T13:18:39.393Z");
    assert.equal(profile.source_binding.settings_inventory.version,
      "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json");
    assert.equal(profile.source_binding.settings_inventory.form_id, "ideogram");
    assert.equal(profile.source_binding.settings_inventory.form_binding_status, "STRUCTURAL_MATCH");
    assert.equal(profile.source_binding.settings_inventory.runtime_usable, false);
    assert.equal(profile.public_settings.file_count_limit.images, fileCount);
    assert.deepEqual(Object.keys(profile.public_settings.file_count_limit), ["images"]);
    assert.equal(profile.public_settings.max_file_size, sourceMaxBytes);
    assert.equal(profile.public_settings.max_prompt_length, promptMax);
    assert.deepEqual(profile.public_settings.get_cost_params, costKeys);
    assert.deepEqual(profile.parameters_source.cost_declared_keys[modelId], costKeys);
    assert.equal(profile.parameters_source.custom_source_bounds.prompt_maximum, 10_000);
    assert.equal(profile.parameters_source.cost_callback_projection.batch_size, "EXPLICIT_NUM_IMAGES");
    assert.equal(profile.input_policy.local_max_bytes, 67_108_864);
    assert.equal(profile.input_policy.catalog_source_max_bytes, sourceMaxBytes);
    assert.equal(profile.input_policy.effective_local_max_bytes, sourceMaxBytes === 0 ? 67_108_864 : sourceMaxBytes);
    assert.deepEqual(profile.input_policy.accepted_file_types, modelId === "ideogram" ? BASE_MIMES : V4_MIMES);
    assert.equal(profile.input_policy.source_size_scope, "PUBLIC_CATALOG_METADATA_NOT_PROVIDER_ACCEPTANCE");
    assert.equal(profile.input_policy.local_size_scope, "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT");
    assert.equal(profile.input_policy.prompt_metadata_scope, "PUBLIC_CATALOG_METADATA_NOT_EFFECTIVE_PROVIDER_LIMIT");
    assert.deepEqual(profile.cost_policy.controlled_inputs, COST_INPUTS[modelId]);
    assert.equal(profile.input_policy.provider_acceptance, "UNPROVEN");
    assert.deepEqual(profile.cost_policy.declared_metadata_keys, costKeys);
    assert.equal(profile.cost_policy.quote_or_amount, "UNPROVEN");
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.runtime_activation, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.equal(profile.parameters_source.source_pins.source_execution, false);
    assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.source_binding), true);
  }
});

test("pins the source modules and distinguishes source metadata from local limits", () => {
  const profile = getOwnerIdeogramImageSourceProfile("ideogram_40", "transparent", catalog, VERSION);
  assert.equal(profile.source_binding.source_artifacts.form.bytes, 28_373);
  assert.equal(profile.source_binding.source_artifacts.form.sha256,
    "sha256:fb8f93597c1dc69fa811e48f5d3218ef5724d9f2f1dd175a3a63f320f930274a");
  assert.equal(profile.source_binding.source_artifacts.mode_registry.sha256,
    "sha256:d4ad75ddd2336d24cba03e1b32dc162d18ff8d7ff4b15b91ab4fd83175dcc5ac");
  assert.equal(profile.source_binding.source_artifacts.random_seed.sha256,
    "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b");
  assert.equal(profile.source_binding.source_artifacts.mask_field.sha256,
    "sha256:939eb943acae4f98ac4204c24c8fbd07b9fcb472fd9f33e2087703175a80e665");
  assert.equal(profile.source_binding.source_execution, false);
  assert.equal(profile.input_policy.source_size_scope, "PUBLIC_CATALOG_METADATA_NOT_PROVIDER_ACCEPTANCE");
  assert.equal(profile.input_policy.local_size_scope, "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT");
  assert.equal(profile.source_binding.mode_join_status, "ALL_NINE_STATIC_SOURCE_CONTEXTS_NOT_RUNTIME_VERIFIED");
});

test("rejects unsupported model/mode, foreign epochs, and catalog/source metadata drift", () => {
  assert.throws(() => getOwnerIdeogramImageSourceProfile("ideogram_4", "generate", catalog, VERSION),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  assert.throws(() => getOwnerIdeogramImageSourceProfile("ideogram", "transparent", catalog, VERSION),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  assert.throws(() => getOwnerIdeogramImageSourceProfile("ideogram", "generate", catalog, "other"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PROFILE_BINDING_MISMATCH");

  const original = catalog.getModel("ideogram_45");
  const mismatchedSettings = withModel("ideogram_45", { ...original, settings: { ...original.settings, max_file_size: 1 } });
  assert.throws(() => getOwnerIdeogramImageSourceProfile("ideogram_45", "generate", mismatchedSettings, VERSION),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PROFILE_BINDING_MISMATCH");
  const mismatchedHashes = {
    ...catalog, getModel: catalog.getModel.bind(catalog),
    source_hashes: { ...catalog.source_hashes, models: "sha256:" + "0".repeat(64) }
  };
  assert.throws(() => getOwnerIdeogramImageSourceProfile("ideogram", "generate", mismatchedHashes, VERSION),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PROFILE_BINDING_MISMATCH");
});

test("rejects inactive or misbound rows and never invokes catalog model getters", () => {
  const original = catalog.getModel("ideogram");
  for (const changed of [
    { ...original, active: false },
    { ...original, id: "ideogram_40" },
    { ...original, ai_name: "other" },
    { ...original, operations: [] }
  ]) {
    assert.throws(() => getOwnerIdeogramImageSourceProfile("ideogram", "generate", withModel("ideogram", changed), VERSION),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PROFILE_BINDING_MISMATCH");
  }
  let getterReads = 0;
  const settings = { ...original.settings };
  Object.defineProperty(settings, "max_file_size", { enumerable: true, get() { getterReads += 1; return 0; } });
  assert.throws(() => getOwnerIdeogramImageSourceProfile("ideogram", "generate", withModel("ideogram", { ...original, settings }), VERSION),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PROFILE_BINDING_MISMATCH");
  assert.equal(getterReads, 0);
});

test("allows the actual catalog class but rejects accessor-backed and proxied catalog ports without invoking traps", () => {
  const accessorPort = Object.create(Object.getPrototypeOf(catalog)) as object;
  let getterReads = 0;
  for (const [key, value] of Object.entries({
    getModel: catalog.getModel.bind(catalog), fetched_at: catalog.fetched_at,
    source_hashes: catalog.source_hashes, catalog_kind: catalog.catalog_kind,
    runtime_usable: catalog.runtime_usable, catalog_metadata: catalog.catalog_metadata
  })) {
    Object.defineProperty(accessorPort, key, {
      enumerable: true, get() { getterReads += 1; return value; }
    });
  }
  assert.throws(() => getOwnerIdeogramImageSourceProfile("ideogram", "generate", accessorPort as Parameters<typeof getOwnerIdeogramImageSourceProfile>[2], VERSION),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PROFILE_BINDING_MISMATCH");
  let proxyReads = 0;
  const proxy = new Proxy(catalog, { get() { proxyReads += 1; throw new Error("must not invoke catalog proxy traps"); } });
  assert.throws(() => getOwnerIdeogramImageSourceProfile("ideogram", "generate", proxy, VERSION),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  assert.equal(getterReads, 0);
  assert.equal(proxyReads, 0);
  assert.equal(getOwnerIdeogramImageSourceProfile("ideogram", "generate", catalog, VERSION).mode, "generate");
});

function withModel(id: string, model: unknown) {
  return { ...catalog, getModel: (modelId: string) => modelId === id ? model as ReturnType<typeof catalog.getModel> : catalog.getModel(modelId) };
}
