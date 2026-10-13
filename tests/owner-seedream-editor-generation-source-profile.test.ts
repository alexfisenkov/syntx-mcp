import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { loadMaplessSettingsInventoryVersion, type MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { schemaHash } from "../src/domain/generation-contract.js";
import {
  getOwnerSeedreamEditorOriginalUploadSourceProfile,
  OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
  OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
  type OwnerSeedreamEditorOriginalUploadCatalogPort
} from "../src/application/owner-seedream-editor-original-upload-source-profile.js";
import {
  getOwnerSeedreamEditorGenerationSourceProfile,
  OwnerSeedreamEditorGenerationSourceProfileError
} from "../src/application/owner-seedream-editor-generation-source-profile.js";

const catalogDirectory = resolve("catalog");
const catalog = loadSelectedDiscoveryCatalog(OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
const settings = loadMaplessSettingsInventoryVersion(OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION, catalogDirectory);
const variants = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;
const sourcePins = {
  home_start: "sha256:a7a68e6ae96547333037962ab9bb3a40ddf7aeb912223d65a9962ab5ce6982da",
  editor_form: "sha256:2026192d5b0f086446873996ad20cf4691f665d4019621eef3241887ffb3ad7c",
  editor_parent: "sha256:87509acda1040d79927edc30d8ddd18d503a6e7ce9387d5d0a059b1eb5028e14",
  generic_sender: "sha256:de8396adca45a5ba79c9c52cdfa91b23f45285645bed5df120c0f337a192deb2",
  constants: "sha256:636b6f8e15c847f346395027bc83dc3fddf22199d8ab07a32f98d5f0985ccecf",
  settings_helper: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
  cost_query: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9",
  app_upload: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf",
  typed_url_serializer: "sha256:8a1c0d06d68b82d97ac6a58ed7caf8d2e759d31cc10f0b1ceb26d676fa664706"
} as const;

function originalProfile(variant: typeof variants[number]) {
  return getOwnerSeedreamEditorOriginalUploadSourceProfile(variant,
    catalog as OwnerSeedreamEditorOriginalUploadCatalogPort, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
    settings as MaplessSettingsInventory, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
}
function sourceProfile(variant: typeof variants[number], profile = originalProfile(variant)) {
  return getOwnerSeedreamEditorGenerationSourceProfile(variant, profile);
}
function rejects(action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof OwnerSeedreamEditorGenerationSourceProfileError &&
    ["INVALID_REQUEST", "PROFILE_BINDING_MISMATCH"].includes((error as OwnerSeedreamEditorGenerationSourceProfileError).code));
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) freezeDeep((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}
function rehashAndFreeze(value: Record<string, unknown>): void {
  delete value.profile_schema_hash;
  value.profile_schema_hash = schemaHash(value);
  freezeDeep(value);
}

test("pins the exact Editor parent and nested settings protocol as source-only for all five variants", () => {
  for (const variant of variants) {
    const profile = sourceProfile(variant);
    assert.equal(profile.profile_id, "seedream-editor-generation-source-profile-v1");
    assert.equal(profile.variant, variant);
    assert.equal(profile.model_id, variant);
    assert.equal(profile.navigation_id, "seedream-editor");
    assert.equal(profile.scope, "tool_image_inpaint");
    assert.equal(profile.source_binding.public_catalog_version, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION);
    assert.equal(profile.source_binding.settings_inventory_version, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
    assert.equal(profile.source_binding.home_sha256, sourcePins.home_start);
    assert.equal(profile.source_binding.form_sha256, sourcePins.editor_form);
    assert.equal(profile.source_binding.parent_sha256, sourcePins.editor_parent);
    assert.equal(profile.source_binding.generic_sender_sha256, sourcePins.generic_sender);
    assert.equal(profile.source_binding.constants_sha256, sourcePins.constants);
    assert.equal(profile.source_binding.settings_helper_sha256, sourcePins.settings_helper);
    assert.equal(profile.source_binding.cost_query_sha256, sourcePins.cost_query);
    assert.equal(profile.source_binding.app_upload_sha256, sourcePins.app_upload);
    assert.equal(profile.source_binding.typed_url_serializer_sha256, sourcePins.typed_url_serializer);
    assert.deepEqual(profile.protocol, {
      method: "POST",
      route: "design/generate",
      query: { ai_name: "seedream" },
      body_fields: ["chat_uuid", "prompt", "settings"],
      settings: {
        location: "nested_only",
        keys: ["n", "stream", "model_type", "aspect_ratio", "resolution", "file_urls"],
        confidence: "FIXED_CLIENT_JSON_PROTOCOL_CHOICE_NOT_CACHE_OR_OUTPUT_GUARANTEE",
        n: 1,
        stream: false,
        model_type: "EXPLICIT_UNDERLYING_VARIANT",
        file_urls: "ORIGINAL_THEN_OPTIONAL_DRAWING_IMAGE"
      },
      custom_payload_branch: "ABSENT_OR_NULL_USES_NORMAL_SETTINGS",
      file_roles: ["original_image", "optional_drawing_image"],
      original: { max_count: 1, role: "ORIGINAL_IMAGE", source_profile: "947" },
      drawing: { max_count: 1, role: "IMAGE_EXTRA_NOT_MASK", ownership: "UNBOUND" },
      mask: "NONE",
      duplicate_reference_policy: "TYPED_URL_STABLE_FIRST",
      output_count: "UNPROVEN"
    });
    assert.deepEqual(profile.cost_projection.declared_keys_by_variant[variant], variant === "seedream-5.0-pro"
      ? ["batch_size", "resolution"] : []);
    assert.equal(profile.runtime_usable, false);
    assert.equal(profile.generation_allowed, false);
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.protocol), true);
    assert.equal(Object.isFrozen(profile.protocol.settings.keys), true);
  }
});

test("rejects cross-variant, mutable, forged, stale-pin, and revoked 947 profile inputs", () => {
  const actual = originalProfile("seedream-5.0-pro");
  rejects(() => sourceProfile("seedream-4", actual));

  const mutableClone = structuredClone(actual);
  rejects(() => sourceProfile("seedream-5.0-pro", mutableClone));

  const forged = structuredClone(actual) as typeof actual;
  (forged as { generation_allowed: boolean }).generation_allowed = true;
  rehashAndFreeze(forged as unknown as Record<string, unknown>);
  rejects(() => sourceProfile("seedream-5.0-pro", forged));

  const stale = structuredClone(actual) as typeof actual;
  (stale as { public_catalog_version: string }).public_catalog_version = "sha256-stale.json";
  rehashAndFreeze(stale as unknown as Record<string, unknown>);
  rejects(() => sourceProfile("seedream-5.0-pro", stale));

  const alteredPin = structuredClone(actual) as typeof actual;
  (alteredPin.source_binding as { source_artifacts: { editor_form: { sha256: string } } })
    .source_artifacts.editor_form.sha256 = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  rehashAndFreeze(alteredPin as unknown as Record<string, unknown>);
  rejects(() => sourceProfile("seedream-5.0-pro", alteredPin));

  const revoked = Proxy.revocable(actual, {});
  revoked.revoke();
  rejects(() => sourceProfile("seedream-5.0-pro", revoked.proxy));
});

test("rejects rehashed forged Editor aspect-ratio source metadata for each underlying model", () => {
  for (const variant of variants) {
    const original = originalProfile(variant);
    const isFlashOrPro = variant === "seedream-5.0-flash" || variant === "seedream-5.0-pro";
    const forgedMinimum = structuredClone(original) as typeof original;
    (forgedMinimum.input_policy as { min_image_aspect_ratio: number | null }).min_image_aspect_ratio = isFlashOrPro ? null : 1 / 16;
    rehashAndFreeze(forgedMinimum as unknown as Record<string, unknown>);
    rejects(() => sourceProfile(variant, forgedMinimum));

    const forgedMaximum = structuredClone(original) as typeof original;
    (forgedMaximum.input_policy as { max_image_aspect_ratio: number | null }).max_image_aspect_ratio = isFlashOrPro ? 100 : 16;
    rehashAndFreeze(forgedMaximum as unknown as Record<string, unknown>);
    rejects(() => sourceProfile(variant, forgedMaximum));
  }
});
