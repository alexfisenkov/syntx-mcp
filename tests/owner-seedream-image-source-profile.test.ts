import assert from "node:assert/strict";
import test from "node:test";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  getOwnerSeedreamImageSourceProfile,
  OwnerSeedreamImageSourceProfileError
} from "../src/application/owner-seedream-image-source-profile.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const catalog = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;
const CASES = [
  { id: "seedream-4", count: 4, generic: 10_485_760, image: 10_485_760, cost: [] },
  { id: "seedream-4.5", count: 4, generic: 10_485_760, image: 10_485_760, cost: [] },
  { id: "seedream-5", count: 14, generic: 10_485_760, image: 10_485_760, cost: [] },
  { id: "seedream-5.0-flash", count: 10, generic: 31_457_280, image: 11_010_048, cost: [] },
  { id: "seedream-5.0-pro", count: 10, generic: 31_457_280, image: 27_525_120, cost: ["batch_size", "resolution"] }
] as const;

test("all Seedream profiles bind exact e551 rows and keep generic and image byte limits distinct", () => {
  for (const expected of CASES) {
    const profile = getOwnerSeedreamImageSourceProfile(expected.id, catalog, CATALOG_VERSION);
    assert.equal(profile.model_id, expected.id);
    assert.equal(profile.ai_name, "seedream");
    assert.equal(profile.catalog_default_flag, expected.id === "seedream-5");
    assert.equal(profile.reference_count.maximum, expected.count);
    assert.equal(profile.input_policy.generic_max_file_bytes, expected.generic);
    assert.equal(profile.input_policy.image_max_file_bytes, expected.image);
    assert.equal(profile.input_policy.local_structural_max_bytes, expected.image);
    assert.deepEqual(profile.cost_policy.declared_metadata_keys, expected.cost);
    assert.deepEqual(profile.cost_policy.controlled_inputs, expected.cost);
    assert.deepEqual(profile.source_controller_markers.fixed_wire, { n: 1, stream: false });
    assert.equal(profile.source_controller_markers.inactive_fields, "NON_FLASH_FIELDS_NULL_IN_LOCAL_STATE_AND_OMITTED_FROM_WIRE");
    assert.equal(profile.runtime_activation, false);
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.equal(profile.effective_defaults, "UNKNOWN");
    assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(Object.isFrozen(profile), true);
  }
});

test("Seedream profiles reject catalog version, row settings, and source identity drift", () => {
  assert.throws(() => getOwnerSeedreamImageSourceProfile("seedream-5", catalog, "other"),
    (error: unknown) => error instanceof OwnerSeedreamImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.throws(() => getOwnerSeedreamImageSourceProfile("unknown", catalog, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerSeedreamImageSourceProfileError && error.code === "INVALID_REQUEST");
  const row = catalog.getModel("seedream-5.0-pro");
  const changedRow = { ...row, settings: { ...row.settings, max_image_file_size: 30_000_000 } };
  const changedCatalog = {
    fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes, catalog_metadata: catalog.catalog_metadata,
    getModel: (id: string) => id === "seedream-5.0-pro" ? changedRow : catalog.getModel(id)
  };
  assert.throws(() => getOwnerSeedreamImageSourceProfile("seedream-5.0-pro", changedCatalog, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerSeedreamImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  const alteredHashes = { ...catalog.source_hashes, models: `sha256:${"0".repeat(64)}` };
  const driftedCatalog = {
    fetched_at: catalog.fetched_at, source_hashes: alteredHashes,
    catalog_metadata: { ...catalog.catalog_metadata, source_hashes: alteredHashes },
    getModel: catalog.getModel.bind(catalog)
  };
  assert.throws(() => getOwnerSeedreamImageSourceProfile("seedream-5", driftedCatalog, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerSeedreamImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  const getterCatalog = Object.defineProperties({}, {
    fetched_at: { enumerable: true, get() { throw new Error("must not invoke"); } },
    source_hashes: { value: catalog.source_hashes, enumerable: true },
    catalog_metadata: { value: catalog.catalog_metadata, enumerable: true },
    getModel: { value: catalog.getModel.bind(catalog), enumerable: true }
  });
  assert.throws(() => getOwnerSeedreamImageSourceProfile("seedream-5", getterCatalog as never, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerSeedreamImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.throws(() => getOwnerSeedreamImageSourceProfile("seedream-5", new Proxy(catalog, {}), CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerSeedreamImageSourceProfileError && error.code === "INVALID_REQUEST");
});
