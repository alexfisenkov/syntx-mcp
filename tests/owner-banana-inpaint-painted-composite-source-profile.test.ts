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
  getOwnerBananaInpaintPaintedCompositeSourceProfile,
  OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_VARIANTS,
  OwnerBananaInpaintPaintedCompositeSourceProfileError,
  type OwnerBananaInpaintPaintedCompositeSourceProfile
} from "../src/application/owner-banana-inpaint-painted-composite-source-profile.js";

const catalogDirectory = "catalog";
const catalog = loadSelectedDiscoveryCatalog(OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
const settings = loadMaplessSettingsInventoryVersion(OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, catalogDirectory);
const variants = ["banana", "banana2", "banana3", "banana3_light"] as const;

type MutableOriginalProfile = Record<string, unknown> & {
  source_binding: {
    source_artifacts: {
      original_upload_caller: { sha256: string };
      settings_helper: { sha256: string };
      app_upload_store: { sha256: string };
    };
  };
  profile_schema_hash?: string;
};

function getProfile(variant: OwnerBananaInpaintOriginalUploadVariant): Readonly<OwnerBananaInpaintPaintedCompositeSourceProfile> {
  const originalProfile = getOwnerBananaInpaintOriginalUploadSourceProfile(
    variant, catalog, OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION
  );
  return getOwnerBananaInpaintPaintedCompositeSourceProfile(variant, originalProfile);
}

test("painted-composite source profile binds each exact original variant and source-only mask relation", () => {
  assert.deepEqual(OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_VARIANTS, variants);
  for (const variant of variants) {
    const profile = getProfile(variant);
    assert.deepEqual({
      profile_id: profile.profile_id,
      variant: profile.variant,
      model_id: profile.model_id,
      model_type: profile.model_type,
      source_role: profile.source_role,
      wire_role: profile.wire_role,
      original_upload_profile_schema_hash: profile.source_binding.original_upload_profile_schema_hash,
      artifacts: profile.source_binding.source_artifacts,
      producer: profile.producer,
      geometry: profile.geometry,
      runtime_usable: profile.runtime_usable,
      runtime_activation: profile.runtime_activation,
      dispatch_allowed: profile.dispatch_allowed,
      backend_acceptance: profile.backend_acceptance,
      forbidden_authority: ["cost_inputs", "cost_policy", "mask_byte_cap", "generation_permission"]
        .some((key) => Object.hasOwn(profile, key))
    }, {
      profile_id: "banana-inpaint-painted-composite-source-profile-v1",
      variant,
      model_id: variant,
      model_type: variant,
      source_role: "painted_composite",
      wire_role: "mask",
      original_upload_profile_schema_hash: getOwnerBananaInpaintOriginalUploadSourceProfile(
        variant, catalog, OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION
      ).profile_schema_hash,
      artifacts: {
        inpaint_editor: { module: "InpaintEditor.js", bytes: 24_250, sha256: "sha256:87509acda1040d79927edc30d8ddd18d503a6e7ce9387d5d0a059b1eb5028e14" },
        image_canvas: { module: "ImageCanvas.js", bytes: 15_226, sha256: "sha256:510f00b01ae9deadd6a265f6733adbd383c785cfa10c15a907d835c810c7a9b2" },
        painted_composite_caller: { module: "useImageEditorTool.js", bytes: 12_652, sha256: "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe" },
        settings_helper: { module: "settings3.js", bytes: 4_123, sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" },
        app_upload_store: { module: "app.js", bytes: 2_445_534, sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" }
      },
      producer: {
        encoding: "ORIGINAL_IMAGE_PLUS_COLORED_PAINT_OVERLAY_PNG_NOT_BINARY_MASK_PLANE",
        producer_mime_type: "image/png",
        output_dimensions: "LOADED_IMAGE_NATURAL_WIDTH_HEIGHT",
        paint_layer_alpha: 191,
        pixel_role: "SOURCE_PAINT_LAYER_ALPHA_GREATER_THAN_ZERO",
        initial_paint_rgb: { r: 99, g: 102, b: 241 },
        paint_rgb_is_mutable: true,
        local_file_mime: "DATA_URL_HEADER_MIME_WITH_IMAGE_PNG_FALLBACK_NOT_HARDCODED_PNG",
        local_filename: "inpaint-mask"
      },
      geometry: {
        scope: "CONTAINER_GEOMETRY_ONLY",
        dimensions_source: "LOADED_IMAGE_NATURAL_WIDTH_HEIGHT",
        decoded_pixel_geometry: false,
        browser_exif_rendering: false,
        provider_crop_or_resize: false
      },
      runtime_usable: false,
      runtime_activation: false,
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN",
      forbidden_authority: false
    });
    assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.source_binding), true);
    assert.equal(Object.isFrozen(profile.producer), true);
  }
});

test("rejects unsupported aliases, cross-variant original profiles, and mutated direct helper identities", () => {
  const originalProfile = getOwnerBananaInpaintOriginalUploadSourceProfile(
    "banana", catalog, OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION
  );
  for (const invalidVariant of ["banana-2.1", "banana_inpaint", "banana_3"] as const) {
    assert.throws(() => getOwnerBananaInpaintPaintedCompositeSourceProfile(invalidVariant, originalProfile), (error: unknown) =>
      error instanceof OwnerBananaInpaintPaintedCompositeSourceProfileError && error.code === "INVALID_REQUEST");
  }
  const banana2Profile = getOwnerBananaInpaintOriginalUploadSourceProfile(
    "banana2", catalog, OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION
  );
  assert.throws(() => getOwnerBananaInpaintPaintedCompositeSourceProfile("banana", banana2Profile), (error: unknown) =>
    error instanceof OwnerBananaInpaintPaintedCompositeSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");

  for (const mutation of [
    (profile: MutableOriginalProfile) => { profile.source_binding.source_artifacts.original_upload_caller.sha256 = `sha256:${"a".repeat(64)}`; },
    (profile: MutableOriginalProfile) => { profile.source_binding.source_artifacts.settings_helper.sha256 = `sha256:${"b".repeat(64)}`; },
    (profile: MutableOriginalProfile) => { profile.source_binding.source_artifacts.app_upload_store.sha256 = `sha256:${"c".repeat(64)}`; }
  ]) {
    const altered = structuredClone(originalProfile) as MutableOriginalProfile;
    delete altered.profile_schema_hash;
    mutation(altered);
    altered.profile_schema_hash = schemaHash(altered);
    Object.freeze(altered);
    assert.throws(() => getOwnerBananaInpaintPaintedCompositeSourceProfile("banana", altered as never), (error: unknown) =>
      error instanceof OwnerBananaInpaintPaintedCompositeSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  }
});
