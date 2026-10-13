import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { schemaHash } from "../src/domain/generation-contract.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  getOwnerSeedreamEditorDrawingSourceProfile, OwnerSeedreamEditorDrawingSourceProfileError
} from "../src/application/owner-seedream-editor-drawing-source-profile.js";
import {
  getOwnerSeedreamEditorOriginalUploadSourceProfile, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
  OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION
} from "../src/application/owner-seedream-editor-original-upload-source-profile.js";

const directory = resolve("catalog");
const catalog = loadSelectedDiscoveryCatalog(OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, directory).discoveryCatalog;
const settings = loadMaplessSettingsInventoryVersion(OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION, directory);
const variants = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;

function original(variant: typeof variants[number]) {
  return getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, catalog, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
    settings, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
}
function drawing(variant: string, profile: unknown) {
  return getOwnerSeedreamEditorDrawingSourceProfile(variant, profile as never);
}

function rehashAndFreeze(value: Record<string, unknown>): void {
  delete value.profile_schema_hash;
  value.profile_schema_hash = schemaHash(value);
  freezeDeep(value);
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) freezeDeep((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

test("drawing profile pins the actual 883 source and the actual 947 profile for all five models", () => {
  for (const variant of variants) {
    const source = getOwnerSeedreamEditorDrawingSourceProfile(variant, original(variant));
    assert.equal(source.variant, variant); assert.equal(source.model_type, variant);
    assert.equal(source.source_role, "editor_drawing"); assert.equal(source.wire_role, "image");
    assert.equal(source.source_binding.public_catalog_version, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION);
    assert.equal(source.source_binding.settings_inventory_version, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
    assert.equal(source.source_binding.source_artifacts.canvas_editor.sha256,
      "sha256:859a2906da81c354e9e7838d0d0e12fd8aa81de48246ba9fe30510f8aefde592");
    assert.equal(source.source_binding.source_artifacts.drawing_exporter.sha256,
      "sha256:de8396adca45a5ba79c9c52cdfa91b23f45285645bed5df120c0f337a192deb2");
    assert.equal("image_canvas" in source.source_binding.source_artifacts, false);
    assert.equal(source.source_binding.export.with_image, false);
    assert.equal(source.source_binding.export.hidden_upload, true);
    assert.equal(source.source_binding.export.extra_role, "image");
    assert.equal(source.input_policy.local_resource_bound_bytes, 32 * 1024 * 1024);
    assert.equal(source.input_policy.source_bytes_limit, "UNPROVEN");
    assert.equal(source.generation_allowed, false); assert.equal(source.dispatch_allowed, false);
    assert.equal(source.backend_acceptance, "UNPROVEN");
    assert.match(source.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
    assert.ok(Object.isFrozen(source) && Object.isFrozen(source.source_binding.source_artifacts));
  }
});

test("drawing profile rejects altered original profile pins, a forged ratio with a fresh hash, and aliases", () => {
  const mismatch = (action: () => unknown) => assert.throws(action,
    (error: unknown) => error instanceof OwnerSeedreamEditorDrawingSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  const profile = original("seedream-5.0-flash");
  const altered = structuredClone(profile) as unknown as Record<string, unknown>;
  const policy = altered.input_policy as Record<string, unknown>;
  policy.min_image_aspect_ratio = 1 / 32;
  const forgedBase = { ...altered }; delete forgedBase.profile_schema_hash;
  altered.profile_schema_hash = schemaHash(forgedBase);
  mismatch(() => drawing("seedream-5.0-flash", altered));
  const wrongPin = structuredClone(profile) as unknown as Record<string, unknown>;
  const binding = wrongPin.source_binding as Record<string, unknown>;
  const artifacts = binding.source_artifacts as Record<string, Record<string, unknown>>;
  artifacts.generic_sender!.sha256 = "sha256:" + "0".repeat(64);
  const wrongPinBase = { ...wrongPin }; delete wrongPinBase.profile_schema_hash;
  wrongPin.profile_schema_hash = schemaHash(wrongPinBase);
  mismatch(() => drawing("seedream-5.0-flash", wrongPin));
  const hostile = structuredClone(profile) as unknown as Record<string, unknown>;
  const hostilePolicy = hostile.input_policy as Record<string, unknown>;
  Object.defineProperty(hostilePolicy, "accepted_file_types", { enumerable: true, get() { throw new Error("getter must not run"); } });
  mismatch(() => drawing("seedream-5.0-flash", hostile));
  assert.throws(() => getOwnerSeedreamEditorDrawingSourceProfile("seedream-editor", profile),
    (error: unknown) => error instanceof OwnerSeedreamEditorDrawingSourceProfileError && error.code === "INVALID_REQUEST");
});

test("drawing profile rejects a rehashed original default or settings-helper source pin", () => {
  const profile = original("seedream-5.0-flash");
  const alteredDefault = structuredClone(profile) as unknown as Record<string, unknown>;
  const defaultBinding = alteredDefault.source_binding as Record<string, unknown>;
  const identity = defaultBinding.model_identity as Record<string, unknown>;
  identity.default = true;
  rehashAndFreeze(alteredDefault);
  assert.throws(() => drawing("seedream-5.0-flash", alteredDefault),
    (error: unknown) => error instanceof OwnerSeedreamEditorDrawingSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");

  const alteredHelper = structuredClone(profile) as unknown as Record<string, unknown>;
  const helperBinding = alteredHelper.source_binding as Record<string, unknown>;
  const artifacts = helperBinding.source_artifacts as Record<string, Record<string, unknown>>;
  artifacts.settings_helper!.sha256 = `sha256:${createHash("sha256").update("forged helper pin").digest("hex")}`;
  rehashAndFreeze(alteredHelper);
  assert.throws(() => drawing("seedream-5.0-flash", alteredHelper),
    (error: unknown) => error instanceof OwnerSeedreamEditorDrawingSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
});
