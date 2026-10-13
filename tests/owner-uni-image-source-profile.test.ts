import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { getOwnerUniImageUploadProfile } from "../src/catalog/owner-uni-image-upload-profile.js";
import { getOwnerUniImageSourceParameters } from "../src/application/owner-uni-image-parameters.js";

const PROFILE_URL = new URL("../src/application/owner-uni-image-source-profile.js", import.meta.url).href;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const catalog = loadSelectedDiscoveryCatalog(CATALOG_VERSION,
  resolvePhysicalCatalogDirectory()).discoveryCatalog;

function resolvePhysicalCatalogDirectory(): string {
  for (const candidate of [new URL("../catalog", import.meta.url), new URL("../../catalog", import.meta.url)]) {
    const path = fileURLToPath(candidate);
    try {
      const metadata = lstatSync(path);
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) return path;
    } catch (error) {
      if (error === null || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("UNI_TEST_PHYSICAL_CATALOG_NOT_FOUND");
}

test("binds all three generation source profiles to exact full e551 rows and independent GEN schema fingerprints", async () => {
  let module: Record<string, unknown> | null = null;
  try { module = await import(PROFILE_URL) as Record<string, unknown>; } catch { /* expected RED before implementation */ }
  assert.equal(typeof module?.getOwnerUniImageSourceProfile, "function", "MISSING_OWNER_UNI_IMAGE_SOURCE_PROFILE");
  const getProfile = module!.getOwnerUniImageSourceProfile as (model: string, catalogInput: unknown, version: string) => Record<string, any>;
  const parameters = getOwnerUniImageSourceParameters();
  const expected = [
    { id: "uni-1", record: "sha256:9c095d9bc71d214d8005b55038a4212f7b19fb3fb9255fe3b8c0e8d24ab7b02d", operation: "generate-image",
      minimum: 0, maximum: 9, controls: ["aspect_ratio", "seed", "mode"], payload: ["model_type", "aspect_ratio", "seed", "mode"] },
    { id: "uni-1.1-modify-image", record: "sha256:61fab99d9e121bc9e29742a071e328dc4ee2a9c5140472f2d2025fb4ce538796", operation: "generate-image",
      minimum: 1, maximum: 8, controls: ["seed", "mode"], payload: ["model_type", "seed", "mode"] },
    { id: "uni-1.1-remove-background", record: "sha256:88ac8c582d2ebbb3c65866c38b9638eaef1d1c1df1855ecf096b5c61575fd96c", operation: "generate-image",
      minimum: 1, maximum: 1, controls: ["invert_mask"], payload: ["model_type", "invert_mask"] }
  ] as const;
  for (const row of expected) {
    const profile = getProfile(row.id, catalog, CATALOG_VERSION);
    const uploadProfile = getOwnerUniImageUploadProfile(row.id, catalog, CATALOG_VERSION);
    assert.equal(profile.model_id, row.id);
    assert.equal(profile.ai_name, "luma_image");
    assert.equal(profile.model_type, row.id);
    assert.equal(profile.scope, "image");
    assert.equal(profile.operation_id, row.operation);
    assert.equal(profile.public_catalog_version, CATALOG_VERSION);
    assert.equal(profile.source_binding.full_public_record_sha256, row.record);
    assert.equal(profile.source_binding.full_public_record_sha256, uploadProfile.full_public_record_sha256);
    assert.equal(profile.upload_profile_schema_hash, undefined);
    assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
    assert.notEqual(profile.profile_schema_hash, uploadProfile.upload_profile_schema_hash);
    assert.deepEqual(profile.parameters_source, parameters);
    assert.deepEqual(profile.model_controls, parameters.models_by_id[row.id]);
    assert.deepEqual(profile.model_controls.controls, row.controls);
    assert.deepEqual(profile.reference_selection, { minimum: row.minimum, maximum: row.maximum,
      confidence: "SOURCE_UI_SELECTION_RULE_NOT_OWNERSHIP_OR_PROVIDER_PERMISSION", owned_references_bound: false,
      canonical_url_deduplication: "ASSET_ISSUER_CHECK_NOT_THIS_SOURCE_PROFILE" });
    assert.deepEqual(parameters.custom_settings_fields_by_model[row.id], row.payload);
    assert.deepEqual(profile.style_options, [{ label: "Auto", value: "auto" }, { label: "Manga", value: "manga" }]);
    assert.equal(profile.defaults, "NOT_INJECTED");
    assert.equal(profile.effective_defaults, "UNKNOWN_SOURCE_INITIALIZERS_NOT_RUNTIME_DEFAULTS");
    assert.equal(profile.cost_routing.model_type, row.id);
    assert.equal(profile.cost_routing.ai_name, "luma_image");
    assert.deepEqual(profile.cost_routing.declared_parameter_keys, ["model_type"]);
    assert.deepEqual(profile.cost_routing.cost_inputs, {});
    assert.equal(profile.cost_projection_status, "NOT_JOINED");
    assert.equal(profile.source_binding.source_execution, false);
    assert.equal(profile.source_binding.source_artifacts.luma_image_form.bytes, 5_158);
    assert.equal(profile.source_binding.source_artifacts.luma_image_form.sha256,
      "sha256:97ab44c766c09ead21cdcedd3255b817c18582d60264ebe753da7a61c8e1182e");
    assert.equal(profile.source_binding.source_artifacts.uni_source_helper.bytes, 4_865);
    assert.equal(profile.source_binding.source_artifacts.sender_module.module, "video.js");
    assert.equal(profile.source_binding.source_artifacts.sender_module.sha256,
      "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae");
    assert.equal(profile.source_binding.source_artifacts.sender_parent.module, "index6.js");
    assert.equal(profile.source_binding.source_artifacts.sender_parent.sha256,
      "sha256:eb4fe700c7afae0756348aad3118c55ec8c9b5f5e5d18832045be07bbd368447");
    assert.equal(profile.generation_readiness, "SOURCE_PROFILE_ONLY_NOT_GENERATION_ADMISSION");
    assert.deepEqual(profile.cost_routing.cost_inputs, {});
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.runtime_activation, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.parameters_source), true);
  }
});

test("rejects catalog-version and full-record source drift without invoking an accessor", async () => {
  const module = await import(PROFILE_URL) as Record<string, any>;
  const getProfile = module.getOwnerUniImageSourceProfile as (model: string, catalogInput: unknown, version: string) => unknown;
  const ProfileError = module.OwnerUniImageSourceProfileError as new (...args: never[]) => Error & { code: string };
  const isMismatch = (error: unknown) => error instanceof ProfileError && error.code === "PROFILE_BINDING_MISMATCH";
  assert.throws(() => getProfile("uni-1", catalog, "sha256-foreign.json"), isMismatch);

  const original = catalog.getModel("uni-1");
  const changed = { ...original, display_name: "Changed row" };
  const port = {
    getModel: (id: string) => id === "uni-1" ? changed : catalog.getModel(id),
    catalog_kind: catalog.catalog_kind, runtime_usable: catalog.runtime_usable, fetched_at: catalog.fetched_at,
    source_hashes: catalog.source_hashes, catalog_metadata: catalog.catalog_metadata
  };
  assert.throws(() => getProfile("uni-1", port, CATALOG_VERSION), isMismatch);

  let getterCalls = 0;
  const accessorRecord = { ...original };
  Object.defineProperty(accessorRecord, "display_name", { enumerable: true,
    get() { getterCalls += 1; return original.display_name; } });
  const accessorPort = { ...port, getModel: (id: string) => id === "uni-1" ? accessorRecord : catalog.getModel(id) };
  assert.throws(() => getProfile("uni-1", accessorPort, CATALOG_VERSION), isMismatch);
  assert.equal(getterCalls, 0);
});
