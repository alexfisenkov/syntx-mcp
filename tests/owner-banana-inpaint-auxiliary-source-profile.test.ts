import assert from "node:assert/strict";
import test from "node:test";
import { schemaHash } from "../src/domain/generation-contract.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  getOwnerBananaInpaintOriginalUploadSourceProfile,
  OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
  OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
  type OwnerBananaInpaintOriginalUploadVariant
} from "../src/application/owner-banana-inpaint-original-upload-source-profile.js";
import {
  getOwnerBananaInpaintAuxiliarySourceProfile,
  OwnerBananaInpaintAuxiliarySourceProfileError
} from "../src/application/owner-banana-inpaint-auxiliary-source-profile.js";

const catalogDirectory = "catalog";
const catalog = loadSelectedDiscoveryCatalog(OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
const settings = loadMaplessSettingsInventoryVersion(OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, catalogDirectory);
const variants = ["banana", "banana2", "banana3", "banana3_light"] as const;

function originalProfile(variant: OwnerBananaInpaintOriginalUploadVariant) {
  return getOwnerBananaInpaintOriginalUploadSourceProfile(
    variant, catalog, OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION
  );
}

test("auxiliary profile binds exact source pins, source upload mapping, and local-only format coverage", () => {
  for (const variant of variants) {
    const original = originalProfile(variant);
    const profile = getOwnerBananaInpaintAuxiliarySourceProfile(variant, original);
    assert.equal(profile.profile_id, "banana-inpaint-auxiliary-image-source-profile-v1");
    assert.equal(profile.variant, variant);
    assert.equal(profile.model_type, variant);
    assert.equal(profile.source_role, "auxiliary_image");
    assert.equal(profile.wire_role, "image");
    assert.equal(profile.source_binding.original_upload_profile_schema_hash, original.profile_schema_hash);
    assert.deepEqual(profile.source_binding.direct_source_artifacts, {
      reference: { module: "Reference.js", bytes: 5_956, sha256: "sha256:99979b585bb47bb5547e28ca927f9a4b5cbe12af56b9a0bfd481e07f91fcea4a" },
      upload_dropdown: { module: "UploadDropdown.js", bytes: 42_832, sha256: "sha256:b399a8a1d5fede3a16dd444abcfb4b8ddc89cd89e03ab493c5f9b5eff0f9d783" },
      file_uploader: { module: "fileUploader.js", bytes: 362_328, sha256: "sha256:b1e9af34daa830845c9712121ebb25c92801d22bbcec4f49d8b1748ecbc47786" },
      inpaint_caller: { module: "useImageEditorTool.js", bytes: 12_652, sha256: "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe" },
      app_uploader: { module: "app.js", bytes: 2_445_534, sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" }
    });
    assert.deepEqual(profile.source_reference, {
      max_count: 1, minimum_count: 0, media_type: "images", weight_active: false,
      picker_accept_hint: "image/*", picker_hint_is_backend_permission: false,
      uploaded_destination: "uploaded", duplicate_check: true, model_type_source: "CURRENT_EXPLICIT_BANANA_INPAINT_VARIANT",
      uri_mapping: "UPLOADED_URI_STRING_TO_IMAGE_REFERENCE", catalog_max_file_size_metadata: 0,
      source_size_limit: "UNKNOWN_ZERO_METADATA_NOT_UNLIMITED", mime_acceptance: "UNPROVEN"
    });
    assert.deepEqual(profile.local_input_policy.accepted_mime_types, [
      "image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif", "image/bmp", "image/gif", "image/tiff"
    ]);
    assert.equal(profile.local_input_policy.local_resource_bound_bytes, 50 * 1024 * 1024);
    assert.deepEqual(profile.local_input_policy.parser_format_limits.avif, {
      mime_types: ["image/avif"], max_bytes: 25 * 1024 * 1024, scope: "LOCAL_PARSER_CEILING_ONLY"
    });
    assert.deepEqual(profile.local_input_policy.parser_format_limits.bmp_gif_tiff, {
      mime_types: ["image/bmp", "image/gif", "image/tiff"], max_bytes: 32 * 1024 * 1024, scope: "LOCAL_PARSER_CEILING_ONLY"
    });
    assert.deepEqual(profile.local_input_policy.parser_format_limits.heic_heif, {
      mime_types: ["image/heic", "image/heif"], max_bytes: 32 * 1024 * 1024, scope: "LOCAL_PARSER_CEILING_ONLY"
    });
    assert.deepEqual(profile.local_input_policy.unsupported_source_classifier_mimes, ["image/svg+xml", "image/x-icon"]);
    assert.equal(profile.local_input_policy.svg_execution, false);
    assert.equal(profile.local_input_policy.unknown_image_wildcard, "REJECT_NO_LOCAL_CONTAINER_INSPECTOR");
    assert.equal(profile.runtime_activation, false);
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.generation_permission, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.notEqual(profile.profile_schema_hash, original.profile_schema_hash);
    const base = { ...profile } as Record<string, unknown>;
    delete base.profile_schema_hash;
    assert.equal(profile.profile_schema_hash, schemaHash(base));
  }
});

test("auxiliary profile rejects cross-variant and source-pin-drifted original profiles", () => {
  const original = originalProfile("banana");
  assert.throws(() => getOwnerBananaInpaintAuxiliarySourceProfile("banana2", original), (error: unknown) =>
    error instanceof OwnerBananaInpaintAuxiliarySourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  const mutated = structuredClone(original) as Record<string, unknown>;
  const binding = mutated.source_binding as Record<string, unknown>;
  const artifacts = binding.source_artifacts as Record<string, Record<string, unknown>>;
  artifacts.inpaint_form!.sha256 = `sha256:${"f".repeat(64)}`;
  delete mutated.profile_schema_hash;
  mutated.profile_schema_hash = schemaHash(mutated);
  deepFreezeForTest(mutated);
  assert.throws(() => getOwnerBananaInpaintAuxiliarySourceProfile("banana", mutated as never), (error: unknown) =>
    error instanceof OwnerBananaInpaintAuxiliarySourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
});

function deepFreezeForTest<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeForTest(child);
    Object.freeze(value);
  }
  return value;
}
