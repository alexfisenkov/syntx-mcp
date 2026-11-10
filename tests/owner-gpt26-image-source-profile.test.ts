import assert from "node:assert/strict";
import test from "node:test";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { normalizeOwnerGpt26ImageParameters, OwnerGpt26ImageParametersError,
  OWNER_GPT26_IMAGE_VARIANTS } from "../src/application/owner-gpt26-image-parameters.js";
import { getOwnerGpt26ImageSourceProfile, OwnerGpt26ImageSourceProfileError,
  OWNER_GPT26_PUBLIC_CATALOG_VERSION } from "../src/application/owner-gpt26-image-source-profile.js";

const catalog = loadSelectedDiscoveryCatalog(OWNER_GPT26_PUBLIC_CATALOG_VERSION).discoveryCatalog;

test("2.6 profiles bind only exact active candidate rows and independent source pins", () => {
  for (const variant of OWNER_GPT26_IMAGE_VARIANTS) {
    const profile = getOwnerGpt26ImageSourceProfile(variant, catalog, OWNER_GPT26_PUBLIC_CATALOG_VERSION);
    assert.equal(profile.model_id, variant);
    assert.equal(profile.reference_count.maximum, 16);
    assert.equal(profile.max_total_file_size, 80 * 1024 * 1024);
    assert.deepEqual(profile.public_settings.get_cost_params, ["quality", "details_quality", "ref_count", "output_format"]);
    assert.equal(profile.source_binding.form_sha256, "sha256:00f3e94fc089ec27b935d1cbd7386fcc8ae9fa1f18237041969cd2d93b518354");
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
  }
  assert.throws(() => getOwnerGpt26ImageSourceProfile("gpt-image-2.5-flare", catalog, OWNER_GPT26_PUBLIC_CATALOG_VERSION),
    (e: unknown) => e instanceof OwnerGpt26ImageSourceProfileError && e.code === "INVALID_REQUEST");
  assert.throws(() => getOwnerGpt26ImageSourceProfile("gpt-image-2.6-flare", catalog, "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json"),
    (e: unknown) => e instanceof OwnerGpt26ImageSourceProfileError && e.code === "PROFILE_BINDING_MISMATCH");
  const row = catalog.getModel("gpt-image-2.6-flare")!;
  const altered = {
    getModel: () => ({ ...row, settings: { ...row.settings, max_total_file_size: 1 } }),
    fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes, catalog_metadata: catalog.catalog_metadata
  };
  assert.throws(() => getOwnerGpt26ImageSourceProfile("gpt-image-2.6-flare", altered, OWNER_GPT26_PUBLIC_CATALOG_VERSION),
    (e: unknown) => e instanceof OwnerGpt26ImageSourceProfileError && e.code === "PROFILE_BINDING_MISMATCH");
});

test("2.6 wire includes output format and cost inputs, with GIF restrictions and reference cardinality", () => {
  for (const variant of OWNER_GPT26_IMAGE_VARIANTS) {
    for (const format of ["png", "jpg", "webp", "gif"] as const) {
      const parameters = { aspect_ratio: format === "gif" ? "16:9" : "21:9", quality: format === "gif" ? "1K" : "4K", details_quality: "max", output_format: format };
      const result = normalizeOwnerGpt26ImageParameters({ variant, reference_count: 16, parameters });
      assert.deepEqual(result.source_wire_settings, parameters);
      assert.deepEqual(result.cost_inputs, { quality: parameters.quality, details_quality: "max", output_format: format, ref_count: 16 });
      assert.equal(result.dispatch_allowed, false);
    }
    const empty = normalizeOwnerGpt26ImageParameters({ variant, reference_count: 0,
      parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "medium", output_format: "png" } });
    assert.equal(Object.hasOwn(empty.cost_inputs, "ref_count"), false);
    for (const bad of [
      { aspect_ratio: "21:9", quality: "1K", details_quality: "high", output_format: "gif" },
      { aspect_ratio: "1:1", quality: "2K", details_quality: "high", output_format: "gif" },
      { aspect_ratio: "1:1", quality: "1K", details_quality: "high", output_format: "jpeg" },
      { aspect_ratio: "1:1", quality: "1K", details_quality: "high", output_format: "png", transparency: true }
    ]) assert.throws(() => normalizeOwnerGpt26ImageParameters({ variant, reference_count: 0, parameters: bad }), OwnerGpt26ImageParametersError);
    assert.throws(() => normalizeOwnerGpt26ImageParameters({ variant, reference_count: 17,
      parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "medium", output_format: "png" } }), OwnerGpt26ImageParametersError);
  }
});
