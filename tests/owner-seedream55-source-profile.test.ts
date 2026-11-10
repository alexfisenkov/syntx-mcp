import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { getOwnerSeedream55ImageSourceProfile, OwnerSeedream55ImageSourceProfileError,
  SEEDREAM55_PUBLIC_CATALOG_VERSION } from "../src/application/owner-seedream55-image-source-profile.js";
import { normalizeOwnerSeedreamImageParameters, OwnerSeedreamImageParametersError } from "../src/application/owner-seedream-image-parameters.js";

const catalog = loadSelectedDiscoveryCatalog(SEEDREAM55_PUBLIC_CATALOG_VERSION).discoveryCatalog;

test("new Seedream 5.5 source record matches the independently pinned profile", () => {
  const record = JSON.parse(readFileSync(new URL("../../catalog/seedream55/2026-11-10-source-v1.json", import.meta.url), "utf8")) as Record<string, unknown>;
  const profile = getOwnerSeedream55ImageSourceProfile(catalog, SEEDREAM55_PUBLIC_CATALOG_VERSION);
  assert.equal(record.model_id, profile.model_id);
  assert.equal(record.public_catalog, profile.public_catalog_version);
  assert.equal(record.settings_inventory, profile.source_binding.settings_inventory);
  assert.equal((record.static_form as { defaults: { background: string } }).defaults.background, profile.source_controller_markers.defaults.background);
  assert.equal((record.static_form as { defaults: { output_format: string } }).defaults.output_format, profile.source_controller_markers.defaults.output_format);
  assert.equal(record.provider_acceptance, profile.backend_acceptance);
});

test("Seedream 5.5 profile binds only the new public archive and exact source facts", () => {
  const profile = getOwnerSeedream55ImageSourceProfile(catalog, SEEDREAM55_PUBLIC_CATALOG_VERSION);
  assert.equal(profile.model_id, "seedream-5.5");
  assert.equal(profile.catalog_default_flag, true);
  assert.equal(profile.reference_count.maximum, 10);
  assert.equal(profile.input_policy.image_max_file_bytes, 27_525_120);
  assert.deepEqual(profile.cost_policy.controlled_inputs, ["batch_size", "resolution"]);
  assert.equal(profile.source_controller_markers.defaults.background, "auto");
  assert.equal(profile.source_controller_markers.defaults.output_format, "png");
  assert.equal(profile.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(profile), true);
  assert.throws(() => getOwnerSeedream55ImageSourceProfile(catalog, "other"), OwnerSeedream55ImageSourceProfileError);
  const drift = { fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes, catalog_metadata: catalog.catalog_metadata,
    catalog_kind: catalog.catalog_kind, runtime_usable: catalog.runtime_usable,
    getModel: (id: string) => ({ ...catalog.getModel(id), settings: { ...catalog.getModel(id).settings, file_count_limit: 11 } }) };
  assert.throws(() => getOwnerSeedream55ImageSourceProfile(drift, SEEDREAM55_PUBLIC_CATALOG_VERSION), OwnerSeedream55ImageSourceProfileError);
});

test("Seedream 5.5 parameters accept exact static controls and omit no extras", () => {
  const normalized = normalizeOwnerSeedreamImageParameters({ variant: "seedream-5.5", reference_count: 0,
    parameters: { aspect_ratio: "1:1", resolution: "1.5K", output_format: "png", background: "transparent" } });
  assert.deepEqual(normalized.wire_settings, { aspect_ratio: "1:1", resolution: "1.5K", stream: false, n: 1,
    output_format: "png", background: "transparent" });
  assert.deepEqual(normalized.cost_inputs, { batch_size: 0, resolution: "1.5K" });
  assert.equal(normalized.transparency_eligibility.declared_context_consumed, false);
  for (const parameters of [
    { aspect_ratio: "1:1", resolution: "3K", output_format: "png", background: "auto" },
    { aspect_ratio: "1:1", resolution: "2K", output_format: "jpeg", background: "transparent" },
    { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: "auto" }
  ]) assert.throws(() => normalizeOwnerSeedreamImageParameters({ variant: "seedream-5.5", reference_count: 0, parameters }), OwnerSeedreamImageParametersError);
});
