import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getOwnerSeedream55EditorSourceProfile } from "../src/application/owner-seedream55-editor-source-profile.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { SEEDREAM55_PUBLIC_CATALOG_VERSION, SEEDREAM55_SETTINGS_VERSION } from "../src/application/owner-seedream55-image-source-profile.js";

test("Seedream 5.5 Editor source binds the paired current archives and distinct editor selector", () => {
  const profile = getOwnerSeedream55EditorSourceProfile();
  const facts = JSON.parse(readFileSync(new URL("../../catalog/seedream55/editor-source-v1.json", import.meta.url), "utf8"));
  assert.equal(profile.profile_id, "seedream55-editor-source-profile-v1");
  assert.equal(profile.source_binding.public_catalog_version, facts.public_catalog_version);
  assert.equal(profile.source_binding.settings_inventory_version, facts.settings_inventory_version);
  assert.equal(profile.source_binding.editor_form.sha256, facts.source_hashes["seedream-editor.js"]);
  assert.deepEqual(profile.controls.resolutions, facts.controls.resolutions);
  assert.deepEqual(profile.controls.backgrounds, facts.controls.backgrounds);
  assert.equal(profile.controls.defaults.output_format, "png");
  assert.equal(profile.sender.frontend_omits_n, true);
  assert.equal(profile.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(profile), true);
});

test("55 Editor profile rejects paired settings drift despite unchanged public model", () => {
  const catalog = loadSelectedDiscoveryCatalog(SEEDREAM55_PUBLIC_CATALOG_VERSION).discoveryCatalog;
  const inventory = structuredClone(loadMaplessSettingsInventoryVersion(SEEDREAM55_SETTINGS_VERSION));
  const row = inventory.models.find((item) => item.model_id === "seedream-5.5");
  assert.ok(row);
  (row.settings as Record<string, unknown>).file_count_limit = 11;
  assert.throws(() => getOwnerSeedream55EditorSourceProfile(catalog, inventory), /PROFILE_BINDING_MISMATCH|source binding is unavailable/u);
});
