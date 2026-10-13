import assert from "node:assert/strict";
import test from "node:test";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { getOwnerRunwayImageSourceParameters } from "../src/application/owner-runway-image-parameters.js";
import {
  getOwnerRunwayImageSourceProfile,
  OwnerRunwayImageSourceProfileError
} from "../src/application/owner-runway-image-source-profile.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const catalog = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;

test("Runway Frames source profile binds the exact e551 row, image metadata, and current source pins", () => {
  const profile = getOwnerRunwayImageSourceProfile("runway_frames", catalog, CATALOG_VERSION);
  assert.equal(profile.model_id, "runway_frames");
  assert.equal(profile.ai_name, "runway-frames");
  assert.equal(profile.public_default, true);
  assert.equal(profile.public_catalog_version, CATALOG_VERSION);
  assert.equal(profile.parameters_source, getOwnerRunwayImageSourceParameters());
  assert.deepEqual(profile.public_settings.accepted_file_types, ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]);
  assert.deepEqual(profile.public_settings.allowed_media_types, ["images"]);
  assert.equal(profile.public_settings.file_count_limit, 3);
  assert.equal(profile.public_settings.max_file_size, 0);
  assert.equal(profile.public_settings.max_prompt_length, 0);
  assert.deepEqual(profile.public_settings.get_cost_params, []);
  assert.deepEqual(profile.reference_count, { minimum: 0, maximum: 3 });
  assert.deepEqual(profile.fixed_wire, { n: 1, confidence: "STATIC_SOURCE_MAPPING_NOT_BACKEND_ACCEPTANCE" });
  assert.equal(profile.local_safety_bounds.maximum_image_file_bytes, 33_554_432);
  assert.equal(profile.local_safety_bounds.maximum_prompt_utf8_bytes, 65_536);
  assert.equal(profile.local_safety_bounds.image_file_confidence, "LOCAL_PROCESS_RESOURCE_CEILING_NOT_PROVIDER_LIMIT");
  assert.equal(profile.local_safety_bounds.dimensions, "SOURCE_LIMIT_UNKNOWN; PROFILE_DOES_NOT_CLAIM_UNBOUNDED_DIMENSIONS");
  assert.equal(profile.file_size_metadata.interpretation, "PUBLIC_METADATA_ONLY_ZERO_SEMANTICS_UNRESOLVED_NOT_UNLIMITED");
  assert.equal(profile.prompt_metadata.interpretation, "PUBLIC_ZERO_UNRESOLVED_NOT_UNLIMITED");
  assert.equal(profile.cost_policy.quote_or_amount, "UNPROVEN");
  assert.deepEqual(profile.cost_policy.controlled_inputs, []);
  assert.equal(profile.public_default_interpretation, "CATALOG_FLAG_ONLY_NOT_APPLIED_AS_RUNTIME_DEFAULT");
  assert.equal(profile.dispatch_allowed, false);
  assert.equal(profile.runtime_activation, false);
  assert.equal(profile.backend_acceptance, "UNPROVEN");
  assert.equal(profile.source_binding.source_artifacts.runway_form.sha256,
    "sha256:1017f19b07dc888fa40ad9bc2d36121975d8c233ef0673bd7a7261b056c25447");
  assert.equal(profile.source_binding.source_artifacts.settings_helper.sha256,
    "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe");
  assert.equal(profile.source_binding.source_artifacts.app_store.sha256,
    "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf");
  assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.public_settings.accepted_file_types), true);
  assert.equal(Object.isFrozen(profile.source_binding), true);
});

test("Runway Frames source profile rejects a wrong epoch and drifted catalog row or unsafe objects", () => {
  assert.throws(() => getOwnerRunwayImageSourceProfile("runway_frames", catalog, "other"),
    (error: unknown) => error instanceof OwnerRunwayImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.throws(() => getOwnerRunwayImageSourceProfile("unknown", catalog, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerRunwayImageSourceProfileError && error.code === "INVALID_REQUEST");
  let callbackCalled = false;
  const changed = {
    fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes, catalog_metadata: catalog.catalog_metadata,
    getModel: (_id: string) => { callbackCalled = true; return catalog.getModel("runway_frames"); }
  };
  assert.throws(() => getOwnerRunwayImageSourceProfile("runway_frames", changed, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerRunwayImageSourceProfileError && error.code === "INVALID_REQUEST");
  assert.equal(callbackCalled, false);
  assert.throws(() => getOwnerRunwayImageSourceProfile("runway_frames", new Proxy(catalog, {}), CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerRunwayImageSourceProfileError && error.code === "INVALID_REQUEST");
});
