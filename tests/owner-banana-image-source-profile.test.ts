import assert from "node:assert/strict";
import test from "node:test";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  getOwnerBananaImageSourceProfile,
  OwnerBananaImageSourceProfileError
} from "../src/application/owner-banana-image-source-profile.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const VARIANTS = ["banana", "banana-2.1", "banana2", "banana3", "banana3_light"] as const;
const CATALOG_DEFAULTS = { banana: false, "banana-2.1": false, banana2: false, banana3: true, banana3_light: true } as const;
const catalog = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;

test("frozen source profiles bind exact selected e551 records and fresh form/helper pins", () => {
  for (const variant of VARIANTS) {
    const profile = getOwnerBananaImageSourceProfile(variant, catalog, CATALOG_VERSION);
    assert.equal(profile.model_id, variant);
    assert.equal(profile.ai_name, "banana");
    assert.equal(profile.variant, variant);
    assert.equal(profile.public_catalog_version, CATALOG_VERSION);
    assert.equal(profile.catalog_default_flag, CATALOG_DEFAULTS[variant]);
    assert.equal(profile.catalog_default_confidence, "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION");
    assert.equal(profile.source_binding.selected_public_catalog_fetched_at, "2026-10-08T13:18:39.393Z");
    assert.deepEqual(profile.source_binding.selected_public_source_hashes, {
      ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
      llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
      models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
    });
    assert.equal(profile.source_binding.source_artifacts.form.sha256,
      "sha256:b66e233dc1ad667fc128b25c19255458ce51fe4bf6e4648d3848b27b402c1c1e");
    assert.equal(profile.source_binding.source_artifacts.form.freshness, "ROOT546_ANONYMOUS_GET_MATCHED_PIN");
    assert.equal(profile.source_binding.source_artifacts.app_store.evidence, "RETAINED_NOT_REFETCHED");
    assert.equal(profile.public_settings.get_cost_params.includes("image_size"), variant !== "banana");
    assert.equal(profile.cost_policy.controlled_inputs.length, variant === "banana" ? 0 : 1);
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.equal(profile.runtime_activation, false);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.public_settings), true);
    assert.equal(Object.isFrozen(profile.source_binding), true);
  }
});

test("preserves provider-neutral media metadata and leaves zero size and prompt limits unresolved", () => {
  const base = getOwnerBananaImageSourceProfile("banana", catalog, CATALOG_VERSION);
  assert.deepEqual(base.reference_count, { minimum: 0, maximum: 4 });
  assert.deepEqual(base.public_settings.get_cost_params, []);
  assert.equal(base.public_settings.max_file_size, 0);
  assert.equal(base.media_limits.file_size_interpretation, "ZERO_UNRESOLVED_NOT_UNLIMITED");
  assert.equal(base.media_limits.prompt_interpretation, "PUBLIC_ZERO_UNRESOLVED_NOT_UNLIMITED");
  const two = getOwnerBananaImageSourceProfile("banana-2.1", catalog, CATALOG_VERSION);
  assert.deepEqual(two.reference_count, { minimum: 0, maximum: 14 });
  assert.equal(Object.getPrototypeOf(two.media_limits.file_count_by_media), null);
  assert.deepEqual(two.media_limits.file_count_by_media,
    Object.assign(Object.create(null) as Record<string, number>, { documents: 10, images: 14, videos: 10 }));
  assert.equal(Object.getPrototypeOf(two.media_limits.max_file_bytes_by_media), null);
  assert.deepEqual(two.media_limits.max_file_bytes_by_media,
    Object.assign(Object.create(null) as Record<string, number>, { documents: 5_242_880, images: 7_340_032, videos: 20_971_520 }));
  assert.equal(two.media_limits.max_image_dimension, 8_400);
  assert.equal(two.media_limits.max_image_pixel_count, 52_500_000);
  assert.equal(two.media_limits.provider_acceptance, "UNPROVEN");
  const others = ["banana2", "banana3", "banana3_light"] as const;
  for (const variant of others) {
    const profile = getOwnerBananaImageSourceProfile(variant, catalog, CATALOG_VERSION);
    assert.deepEqual(profile.reference_count, { minimum: 0, maximum: 14 });
    assert.equal(profile.public_settings.max_file_size, 0);
    assert.equal(profile.media_limits.file_size_interpretation, "ZERO_UNRESOLVED_NOT_UNLIMITED");
  }
});

test("rejects foreign epoch, variant, tampered source fields, hostile getters, and unrelated catalog settings", () => {
  assert.throws(() => getOwnerBananaImageSourceProfile("banana", catalog, "other"),
    (error: unknown) => error instanceof OwnerBananaImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.throws(() => getOwnerBananaImageSourceProfile("not-banana", catalog, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerBananaImageSourceProfileError && error.code === "INVALID_REQUEST");
  const original = catalog.getModel("banana");
  const altered = {
    fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes, catalog_metadata: catalog.catalog_metadata,
    getModel: (id: string) => id === "banana" ? { ...original, settings: { ...original.settings, max_prompt_length: 5000 } } : catalog.getModel(id)
  };
  assert.throws(() => getOwnerBananaImageSourceProfile("banana", altered, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerBananaImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  const alteredDefault = {
    fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes, catalog_metadata: catalog.catalog_metadata,
    getModel: (id: string) => id === "banana3" ? { ...catalog.getModel(id), default: false } : catalog.getModel(id)
  };
  assert.throws(() => getOwnerBananaImageSourceProfile("banana3", alteredDefault, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerBananaImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  let reads = 0;
  const hostileSettings = Object.defineProperty({}, "accepted_file_types", { enumerable: true, get() { reads += 1; return []; } });
  const hostile = {
    fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes, catalog_metadata: catalog.catalog_metadata,
    getModel: (id: string) => id === "banana" ? { ...original, settings: hostileSettings } : catalog.getModel(id)
  };
  assert.throws(() => getOwnerBananaImageSourceProfile("banana", hostile, CATALOG_VERSION));
  assert.equal(reads, 0);
});
