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
  getOwnerBananaInpaintSourceParameters,
  normalizeOwnerBananaInpaintParameters,
  projectOwnerBananaInpaintCostParameters,
  OwnerBananaInpaintParametersError,
  OwnerBananaInpaintSourceParametersError
} from "../src/application/owner-banana-inpaint-parameters.js";

const catalogDirectory = "catalog";
const catalog = loadSelectedDiscoveryCatalog(OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
const settings = loadMaplessSettingsInventoryVersion(OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, catalogDirectory);
const variants = ["banana", "banana2", "banana3", "banana3_light"] as const;

function originalProfile(variant: OwnerBananaInpaintOriginalUploadVariant) {
  return getOwnerBananaInpaintOriginalUploadSourceProfile(
    variant, catalog, OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION
  );
}

test("source controls bind all four original profiles and preserve source initializer uncertainty", () => {
  const expected = [
    { variant: "banana", visible: false, options: [], initial: null, initializer: "SOURCE_NULL_NO_VISIBLE_SIZE_CONTROL" },
    { variant: "banana2", visible: true, options: ["1K", "2K", "4K"], initial: "2K", initializer: "SOURCE_INITIALIZER_VALUE_NOT_RUNTIME_DEFAULT" },
    { variant: "banana3", visible: true, options: ["0.5K", "1K", "2K", "4K"], initial: null, initializer: "SOURCE_NULL_BRANCH_EFFECTIVE_DEFAULT_UNPROVEN" },
    { variant: "banana3_light", visible: false, options: ["1K"], initial: "1K", initializer: "SOURCE_INITIALIZER_VALUE_NOT_RUNTIME_DEFAULT" }
  ] as const;
  assert.deepEqual(variants, expected.map((entry) => entry.variant));
  for (const entry of expected) {
    const source = getOwnerBananaInpaintSourceParameters(entry.variant, originalProfile(entry.variant));
    assert.deepEqual(source.image_size, {
      visible: entry.visible,
      options: entry.options,
      initial_source_value: entry.initial,
      initial_value_semantics: entry.initializer
    });
    assert.equal(source.variant, entry.variant);
    assert.equal(source.public_catalog_version, OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION);
    assert.equal(source.settings_inventory_version, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION);
    assert.equal(source.source_binding.source_pass.source_pass_freshness, "UNVERIFIED_END_FINGERPRINT_MISSING");
    assert.equal(source.effective_defaults, "UNKNOWN");
    assert.equal(source.runtime_activation, false);
    assert.equal(source.dispatch_allowed, false);
    assert.equal(source.backend_acceptance, "UNPROVEN");
    assert.match(source.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
    const sourceWithoutHash = { ...source } as Record<string, unknown>;
    delete sourceWithoutHash.profile_schema_hash;
    assert.equal(source.profile_schema_hash, schemaHash(sourceWithoutHash));
    assert.equal(Object.isFrozen(source), true);
    assert.equal(Object.isFrozen(source.image_size.options), true);
  }
});

test("normalizer accepts only the literal explicit image-size matrix and never applies source initializers", () => {
  const cases = [
    { variant: "banana", image_size: null },
    { variant: "banana2", image_size: "1K" },
    { variant: "banana2", image_size: "2K" },
    { variant: "banana2", image_size: "4K" },
    { variant: "banana3", image_size: "0.5K" },
    { variant: "banana3", image_size: "1K" },
    { variant: "banana3", image_size: "2K" },
    { variant: "banana3", image_size: "4K" },
    { variant: "banana3_light", image_size: "1K" }
  ] as const;
  for (const entry of cases) {
    const normalized = normalizeOwnerBananaInpaintParameters(entry);
    assert.deepEqual(normalized, {
      variant: entry.variant,
      image_size: entry.image_size,
      effective_default_applied: false,
      dispatch_allowed: false,
      runtime_activation: false,
      backend_acceptance: "UNPROVEN"
    });
  }
  assert.equal(cases.length, 9);
});

test("source getter rejects aliases, cross-variant profiles, and altered original source pins", () => {
  const banana = originalProfile("banana");
  assert.throws(() => getOwnerBananaInpaintSourceParameters("banana-2.1", banana), (error: unknown) =>
    error instanceof OwnerBananaInpaintSourceParametersError && error.code === "INVALID_REQUEST");
  assert.throws(() => getOwnerBananaInpaintSourceParameters("banana2", banana), (error: unknown) =>
    error instanceof OwnerBananaInpaintSourceParametersError && error.code === "PROFILE_BINDING_MISMATCH");

  const altered = structuredClone(banana) as Record<string, unknown>;
  const sourceBinding = altered.source_binding as Record<string, unknown>;
  const sourceArtifacts = sourceBinding.source_artifacts as Record<string, Record<string, unknown>>;
  sourceArtifacts.inpaint_form!.sha256 = `sha256:${"a".repeat(64)}`;
  delete altered.profile_schema_hash;
  altered.profile_schema_hash = schemaHash(altered);
  Object.freeze(altered);
  assert.throws(() => getOwnerBananaInpaintSourceParameters("banana", altered as never), (error: unknown) =>
    error instanceof OwnerBananaInpaintSourceParametersError && error.code === "PROFILE_BINDING_MISMATCH");

  const alteredPolicy = structuredClone(banana) as Record<string, unknown>;
  const inputPolicy = alteredPolicy.input_policy as Record<string, unknown>;
  inputPolicy.destination = "public";
  delete alteredPolicy.profile_schema_hash;
  alteredPolicy.profile_schema_hash = schemaHash(alteredPolicy);
  Object.freeze(alteredPolicy);
  assert.throws(() => getOwnerBananaInpaintSourceParameters("banana", alteredPolicy as never), (error: unknown) =>
    error instanceof OwnerBananaInpaintSourceParametersError && error.code === "PROFILE_BINDING_MISMATCH");
});

test("cost projection follows the exact nine-case size matrix and separates routing from caller keys", () => {
  const cases = [
    { variant: "banana", image_size: null, cost_inputs: {} },
    { variant: "banana2", image_size: "1K", cost_inputs: { image_size: "1K" } },
    { variant: "banana2", image_size: "2K", cost_inputs: { image_size: "2K" } },
    { variant: "banana2", image_size: "4K", cost_inputs: { image_size: "4K" } },
    { variant: "banana3", image_size: "0.5K", cost_inputs: { image_size: "0.5K" } },
    { variant: "banana3", image_size: "1K", cost_inputs: { image_size: "1K" } },
    { variant: "banana3", image_size: "2K", cost_inputs: { image_size: "2K" } },
    { variant: "banana3", image_size: "4K", cost_inputs: { image_size: "4K" } },
    { variant: "banana3_light", image_size: "1K", cost_inputs: { image_size: "1K" } }
  ] as const;
  for (const entry of cases) {
    const result = projectOwnerBananaInpaintCostParameters({ variant: entry.variant, image_size: entry.image_size });
    assert.deepEqual(result.routing, { ai_name: "banana", model_type: entry.variant });
    assert.deepEqual(result.cost_inputs, entry.cost_inputs);
    assert.equal(Object.hasOwn(result.cost_inputs, "ai_name"), false);
    assert.equal(Object.hasOwn(result.cost_inputs, "model_type"), false);
    assert.equal(Object.hasOwn(result.cost_inputs, "n"), false);
    assert.equal(Object.hasOwn(result.cost_inputs, "prompt"), false);
    assert.equal(result.quote_or_amount, "UNPROVEN");
    assert.deepEqual(result.source_binding, {
      public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
      settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
      source_artifacts: {
        inpaint_form: { module: "banana-inpaint.js", bytes: 8_715, sha256: "sha256:4a22ce6da71d2b39c97614cdfcde3d38f201dad3015f2a59f018d8b7c8146172" },
        settings_helper: { module: "settings3.js", bytes: 4_123, sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" },
        app_store: { module: "app.js", bytes: 2_445_534, sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" },
        caller: { module: "useImageEditorTool.js", bytes: 12_652, sha256: "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe" },
        cost2: { module: "cost2.js", bytes: 1_660, sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9" },
        cost_service: { module: "cost.js", bytes: 2_745, sha256: "sha256:12db4cc4e9cce28d915b6a7179f26be03967122edc791a393bfbc485b201c223" }
      },
      source_pass: {
        root: 897, started_at: "2026-10-11T16:18:09.096Z", ended_at: "2026-10-11T16:24:31.095Z",
        requests: 5, bytes: 135_762,
        start_homepage_sha256: "a7a68e6ae96547333037962ab9bb3a40ddf7aeb912223d65a9962ab5ce6982da",
        end_homepage_sha256: null, source_pass_freshness: "UNVERIFIED_END_FINGERPRINT_MISSING",
        vendor_executed: false, raw_body_saved: false
      },
      caller_cost_call: "banana-inpaint.js Ae(k)@4621 with k=banana",
      cost2_forwarding: "getCost(ai_name,model_type,projected_cost_keys)",
      caller_ai_name: "banana",
      cost_keys_by_variant: { banana: [], banana2: ["image_size"], banana3: ["image_size"], banana3_light: ["image_size"] }
    });
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.runtime_activation, false);
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.routing), true);
    assert.equal(Object.isFrozen(result.cost_inputs), true);
  }
  assert.equal(cases.length, 9);
});

test("normalizer rejects implicit defaults, aliases, incomplete selections, and extra or active inputs", () => {
  const accessor = { variant: "banana2", image_size: "2K" };
  Object.defineProperty(accessor, "image_size", { enumerable: true, get: () => "2K" });
  const withSymbol = { variant: "banana2", image_size: "2K", [Symbol("extra")]: true };
  const invalid: unknown[] = [
    { variant: "banana" },
    { variant: "banana", image_size: "1K" },
    { variant: "banana2", image_size: null },
    { variant: "banana3", image_size: null },
    { variant: "banana3_light", image_size: "2K" },
    { variant: "banana-2.1", image_size: "1K" },
    { variant: "banana3", image_size: "1k" },
    { variant: "banana3", image_size: 2 },
    { variant: "banana2", image_size: "2K", prompt: "extra" },
    { variant: "banana2", image_size: "2K", cost_inputs: { image_size: "4K" } },
    { variant: "banana2", image_size: "2K", ai_name: "banana_inpaint" },
    withSymbol, accessor, new Proxy({ variant: "banana", image_size: null }, {})
  ];
  for (const input of invalid) assert.throws(() => normalizeOwnerBananaInpaintParameters(input), OwnerBananaInpaintParametersError);
});
