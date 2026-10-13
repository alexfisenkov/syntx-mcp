import assert from "node:assert/strict";
import test from "node:test";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { getOwnerWanImageSourceParameters } from "../src/application/owner-wan-image-parameters.js";
import {
  getOwnerWanImageSourceProfile,
  OwnerWanImageSourceProfileError
} from "../src/application/owner-wan-image-source-profile.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const VARIANTS = [
  { id: "wan_25_i2i_preview", count: 3, file_count_limit: 3, bytes: 10_485_760, minimum: 384, maximum: 5_000, prompt: 1_500 },
  { id: "wan_26_image", count: 4, file_count_limit: 4, bytes: 10_485_760, minimum: 384, maximum: 5_000, prompt: 1_500 },
  { id: "wan_27_image", count: 9, file_count_limit: { images: 9 }, bytes: 20_971_520, minimum: 240, maximum: 8_000, prompt: 5_000 },
  { id: "wan_27_image_pro", count: 9, file_count_limit: { images: 9 }, bytes: 20_971_520, minimum: 240, maximum: 8_000, prompt: 5_000 }
] as const;
const MIME_TYPES = ["image/png", "image/jpg", "image/jpeg", "image/bmp", "image/webp"];
const catalog = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;

test("WAN source profiles bind each exact e551 model and its complete public settings", () => {
  for (const expected of VARIANTS) {
    const profile = getOwnerWanImageSourceProfile(expected.id, catalog, CATALOG_VERSION);
    assert.equal(profile.model_id, expected.id);
    assert.equal(profile.ai_name, "wan_image");
    assert.equal(profile.public_catalog_version, CATALOG_VERSION);
    assert.equal(profile.parameters_source, getOwnerWanImageSourceParameters());
    assert.deepEqual(profile.public_settings.accepted_file_types, MIME_TYPES);
    assert.deepEqual(profile.public_settings.allowed_media_types, ["images"]);
    assert.equal(profile.public_settings.uploadable, true);
    assert.equal(profile.public_settings.max_file_size, expected.bytes);
    assert.deepEqual(profile.public_settings.file_count_limit, expected.file_count_limit);
    assert.deepEqual(profile.reference_count, { minimum: expected.id.startsWith("wan_25") ? 1 : expected.id.startsWith("wan_26") ? 1 : 0, maximum: expected.count });
    assert.equal(profile.public_settings.min_dimension, expected.minimum);
    assert.equal(profile.public_settings.max_dimension, expected.maximum);
    assert.equal(profile.public_settings.min_side, expected.minimum);
    assert.equal(profile.public_settings.max_side, expected.maximum);
    assert.equal(profile.public_settings.max_prompt_length, expected.prompt);
    assert.deepEqual(profile.public_settings.get_cost_params, ["size", "batch_size"]);
    assert.deepEqual(profile.cost_policy.controlled_inputs, ["batch_size"]);
    assert.equal(profile.cost_policy.size_policy, "OMITTED_NO_RESOLUTION_ALIAS");
    assert.equal(profile.cost_policy.confidence, "SOURCE_JOINED_CONTROLLED_STATE_NOT_QUOTE");
    assert.equal(profile.prompt_policy.maximum_units, expected.prompt);
    assert.equal(profile.prompt_policy.unit, "JS_UTF16_CODE_UNITS_PLUS_LF_COUNT");
    assert.equal(profile.prompt_policy.local_character_guard,
      "REJECT_MALFORMED_UNICODE_AND_C0_C1_CONTROLS_EXCEPT_TAB_LF_CR");
    assert.equal(profile.prompt_policy.character_guard_confidence, "LOCAL_INPUT_SAFETY_GUARD_NOT_PROVIDER_CONTRACT");
    assert.equal(JSON.stringify(profile.source_binding).includes("c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9"), true);
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.runtime_activation, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.equal(profile.effective_defaults, "UNKNOWN");
    assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.public_settings.accepted_file_types), true);
    assert.equal(Object.isFrozen(profile.source_binding), true);
  }
});

test("WAN source profile rejects non-default epochs and changed public source fields", () => {
  assert.throws(() => getOwnerWanImageSourceProfile("wan_27_image", catalog, "other"),
    (error: unknown) => error instanceof OwnerWanImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.throws(() => getOwnerWanImageSourceProfile("unknown", catalog, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerWanImageSourceProfileError && error.code === "INVALID_REQUEST");

  const original = catalog.getModel("wan_27_image");
  const badRecord = { ...original, settings: { ...original.settings, max_file_size: 123 } };
  const changed = {
    fetched_at: catalog.fetched_at,
    source_hashes: catalog.source_hashes,
    catalog_metadata: catalog.catalog_metadata,
    getModel: (id: string) => id === "wan_27_image" ? badRecord : catalog.getModel(id)
  };
  assert.throws(() => getOwnerWanImageSourceProfile("wan_27_image", changed, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerWanImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");

  const alteredHashes = { ...catalog.source_hashes, models: "sha256:" + "0".repeat(64) };
  const drifted = {
    fetched_at: catalog.fetched_at,
    source_hashes: alteredHashes,
    catalog_metadata: { ...catalog.catalog_metadata, source_hashes: alteredHashes },
    getModel: catalog.getModel.bind(catalog)
  };
  assert.throws(() => getOwnerWanImageSourceProfile("wan_27_image", drifted, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerWanImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
});
