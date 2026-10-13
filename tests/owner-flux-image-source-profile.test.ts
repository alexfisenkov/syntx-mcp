import assert from "node:assert/strict";
import test from "node:test";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  getOwnerFluxImageSourceProfile,
  OwnerFluxImageSourceProfileError
} from "../src/application/owner-flux-image-source-profile.js";

const VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const MODELS = ["flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"] as const;
const DEFAULTS = { "flux-1": true, "flux-pro-1.1": false, "flux-pro-1.1-ultra": false } as const;
const catalog = loadSelectedDiscoveryCatalog(VERSION).discoveryCatalog;

test("binds all three Flux profiles to the exact e551 public rows and source pins", () => {
  for (const modelId of MODELS) {
    const profile = getOwnerFluxImageSourceProfile(modelId, catalog, VERSION);
    assert.equal(profile.model_id, modelId);
    assert.equal(profile.ai_name, "flux");
    assert.equal(profile.operation_id, "generate-image");
    assert.equal(profile.public_catalog_version, VERSION);
    assert.equal(profile.catalog_default_flag, DEFAULTS[modelId]);
    assert.equal(profile.catalog_default_confidence, "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION");
    assert.equal(profile.reference_count.maximum, modelId === "flux-1" ? 1 : 0);
    assert.deepEqual(profile.public_settings.get_cost_params, []);
    assert.deepEqual(profile.cost_policy.controlled_inputs, []);
    assert.equal(profile.cost_policy.quote_or_amount, "UNPROVEN");
    assert.equal(profile.effective_defaults, "UNKNOWN_CALLBACK_ORDER_AND_CACHED_UI_NOT_PROVEN");
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.runtime_activation, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.source_binding), true);
  }
});

test("rejects a foreign epoch, tampered Flux public settings, and hostile catalog getters", () => {
  assert.throws(() => getOwnerFluxImageSourceProfile("flux-1", catalog, "other"),
    (error: unknown) => error instanceof OwnerFluxImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  const original = catalog.getModel("flux-1");
  const changed = {
    fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes,
    catalog_kind: catalog.catalog_kind, runtime_usable: false as const,
    catalog_metadata: catalog.catalog_metadata,
    getModel: (id: string) => id === "flux-1" ? { ...original, settings: { ...original.settings, file_count_limit: 9 } } : catalog.getModel(id)
  };
  assert.throws(() => getOwnerFluxImageSourceProfile("flux-1", changed, VERSION),
    (error: unknown) => error instanceof OwnerFluxImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  let reads = 0;
  const hostileSettings = Object.defineProperty({}, "get_cost_params", { enumerable: true, get() { reads += 1; return []; } });
  const hostile = {
    fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes,
    catalog_kind: catalog.catalog_kind, runtime_usable: false as const,
    catalog_metadata: catalog.catalog_metadata,
    getModel: (id: string) => id === "flux-1" ? { ...original, settings: hostileSettings } : catalog.getModel(id)
  };
  assert.throws(() => getOwnerFluxImageSourceProfile("flux-1", hostile, VERSION));
  assert.equal(reads, 0);
});
