import assert from "node:assert/strict";
import test from "node:test";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  getOwnerGptImageSourceProfile,
  OwnerGptImageSourceProfileError
} from "../src/application/owner-gpt-image-source-profile.js";
import { getOwnerGptImageSourceParameters } from "../src/application/owner-gpt-image-parameters.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const VARIANTS = [
  { id: "gpt-image-1", count: 5, cost: [], bytes: 0, public_default: false },
  { id: "gpt-image-1.5", count: 10, cost: [], bytes: 0, public_default: true },
  { id: "gpt-image-2", count: 10, cost: ["quality", "details_quality"], bytes: 0, public_default: true },
  { id: "gpt-image-2.5-flare", count: 16, cost: ["quality", "details_quality", "ref_count"], bytes: 33_554_432, public_default: false },
  { id: "gpt-image-2.5-sunburst", count: 16, cost: ["quality", "details_quality", "ref_count"], bytes: 33_554_432, public_default: false }
] as const;
const catalog = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;

test("GPT Image profiles bind each exact e551 row, complete public settings, and family evidence boundary", () => {
  for (const expected of VARIANTS) {
    const profile = getOwnerGptImageSourceProfile(expected.id, catalog, CATALOG_VERSION);
    assert.equal(profile.model_id, expected.id);
    assert.equal(profile.public_default, expected.public_default);
    assert.equal(profile.ai_name, "sora-images");
    assert.equal(profile.public_catalog_version, CATALOG_VERSION);
    assert.equal(profile.parameters_source, getOwnerGptImageSourceParameters());
    assert.deepEqual(profile.public_settings.accepted_file_types, ["image/jpeg", "image/jpg", "image/avif", "image/webp", "image/png"]);
    assert.deepEqual(profile.public_settings.allowed_media_types, ["images"]);
    assert.deepEqual(profile.public_settings.get_cost_params, expected.cost);
    assert.equal(profile.public_settings.file_count_limit, expected.count);
    assert.equal(profile.public_settings.max_file_size, expected.bytes);
    assert.equal(profile.public_settings.max_prompt_length, 0);
    assert.equal(profile.prompt_metadata.interpretation, "METADATA_ONLY_NOT_PROVIDER_LIMIT");
    assert.equal(profile.prompt_metadata.shared_ui_max_length_behavior, "MAX_LENGTH_ZERO_DISABLES_SHARED_CLIPPER");
    assert.equal(profile.cost_input_confidence, "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP");
    assert.deepEqual(profile.cost_boundary, {
      reference_count_zero: "OMIT_REF_COUNT_AS_UNDEFINED",
      reference_count_positive: "USE_EXPLICIT_LOCAL_IMAGE_REFERENCE_COUNT",
      quote_amount_currency_actual_billing_hardcap: "UNPROVEN"
    });
    assert.deepEqual(profile.reference_count, { minimum: 0, maximum: expected.count });
    assert.equal(profile.reference_count_confidence, "PUBLIC_CATALOG_DECLARED_LIMIT_NOT_PROVIDER_ACCEPTANCE_OR_OWNED_REFERENCES");
    assert.equal(profile.file_size_metadata.interpretation, "PUBLIC_METADATA_ONLY_ZERO_SEMANTICS_UNRESOLVED_NOT_UNLIMITED");
    assert.equal(profile.public_default_interpretation, "CATALOG_FLAG_ONLY_NOT_APPLIED_AS_RUNTIME_DEFAULT");
    assert.equal(profile.family_wire_join, "GPT_IMAGE_2_ONLY_POSITIVE_JOIN; OTHER_VARIANTS_NOT_JOINED");
    assert.equal(profile.effective_defaults, "UNKNOWN");
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.runtime_activation, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(profile.source_binding.selected_public_source_hashes, {
      ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
      llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
      models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
    });
    assert.equal(JSON.stringify(profile.source_binding).includes("b30879e1d8171abf2dcab0dd490fbf561fab85495f022c8215b414d17178a966"), true);
    assert.equal(JSON.stringify(profile.source_binding).includes("cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe"), true);
    assert.equal(JSON.stringify(profile.source_binding).includes("0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf"), true);
    assert.equal(JSON.stringify(profile.source_binding).includes("c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9"), true);
    assert.equal(JSON.stringify(profile.source_binding).includes("12db4cc4e9cce28d915b6a7179f26be03967122edc791a393bfbc485b201c223"), true);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.public_settings.accepted_file_types), true);
    assert.equal(Object.isFrozen(profile.source_binding), true);
  }
});

test("source profile rejects wrong epoch, unknown model, public settings drift, source-hash drift, and unsafe catalog objects", () => {
  assert.throws(() => getOwnerGptImageSourceProfile("gpt-image-2", catalog, "other"),
    (error: unknown) => error instanceof OwnerGptImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.throws(() => getOwnerGptImageSourceProfile("gpt-image-3", catalog, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerGptImageSourceProfileError && error.code === "INVALID_REQUEST");

  const original = catalog.getModel("gpt-image-2.5-flare");
  const changedRow = { ...original, settings: { ...original.settings, file_count_limit: 15 } };
  const changedSettings = {
    fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes, catalog_metadata: catalog.catalog_metadata,
    getModel: (id: string) => id === "gpt-image-2.5-flare" ? changedRow : catalog.getModel(id)
  };
  assert.throws(() => getOwnerGptImageSourceProfile("gpt-image-2.5-flare", changedSettings, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerGptImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");

  const alteredHashes = { ...catalog.source_hashes, models: `sha256:${"0".repeat(64)}` };
  const drifted = {
    fetched_at: catalog.fetched_at, source_hashes: alteredHashes,
    catalog_metadata: { ...catalog.catalog_metadata, source_hashes: alteredHashes },
    getModel: catalog.getModel.bind(catalog)
  };
  assert.throws(() => getOwnerGptImageSourceProfile("gpt-image-2", drifted, CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerGptImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.throws(() => getOwnerGptImageSourceProfile("gpt-image-2", new Proxy(catalog, {}), CATALOG_VERSION),
    (error: unknown) => error instanceof OwnerGptImageSourceProfileError && error.code === "INVALID_REQUEST");
});
