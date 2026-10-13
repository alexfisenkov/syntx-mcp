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
import { getOwnerBananaInpaintPaintedCompositeSourceProfile } from "../src/application/owner-banana-inpaint-painted-composite-source-profile.js";
import {
  getOwnerBananaInpaintSourceParameters,
  normalizeOwnerBananaInpaintParameters
} from "../src/application/owner-banana-inpaint-parameters.js";
import {
  getOwnerBananaInpaintImageSourceProfile,
  OwnerBananaInpaintImageSourceProfileError,
  normalizeOwnerBananaInpaintPrompt,
  OwnerBananaInpaintPromptError,
  OWNER_BANANA_INPAINT_IMAGE_VARIANTS
} from "../src/application/owner-banana-inpaint-image-source-profile.js";

const catalogDirectory = "catalog";
const catalog = loadSelectedDiscoveryCatalog(OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
const settings = loadMaplessSettingsInventoryVersion(OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, catalogDirectory);
const variants = ["banana", "banana2", "banana3", "banana3_light"] as const;

function sourceProfile(variant: OwnerBananaInpaintOriginalUploadVariant) {
  const original = getOwnerBananaInpaintOriginalUploadSourceProfile(
    variant, catalog, OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION
  );
  const painted = getOwnerBananaInpaintPaintedCompositeSourceProfile(variant, original);
  const controls = getOwnerBananaInpaintSourceParameters(variant, original);
  return getOwnerBananaInpaintImageSourceProfile(variant, original, painted, controls);
}

test("generation source profile binds the exact four model identities and source-only wire contract", () => {
  assert.deepEqual(OWNER_BANANA_INPAINT_IMAGE_VARIANTS, variants);
  for (const variant of variants) {
    const profile = sourceProfile(variant);
    assert.equal(profile.profile_id, "banana-inpaint-image-source-profile-v1");
    assert.deepEqual(profile.model_identity, {
      model_id: variant, model_type: variant, ai_name: "banana", form_ai_name: "banana_inpaint",
      form_id: "banana-inpaint", scope: "tool_image_inpaint"
    });
    assert.deepEqual(profile.operation, {
      method: "POST", route: "design/generate", ai_name: "banana", scope: "tool_image_inpaint"
    });
    assert.deepEqual(profile.wire_contract.body_fields, ["chat_uuid", "prompt", "settings"]);
    assert.deepEqual(profile.wire_contract.settings_fields, ["editor", "model_type", "image_size", "file_urls"]);
    assert.deepEqual(profile.wire_contract.file_urls_order, ["original_image", "painted_composite_mask", "optional_auxiliary_image"]);
    assert.equal(profile.wire_contract.ordinary_n1_included, false);
    assert.equal(profile.wire_contract.caller_urls_allowed, false);
    assert.equal(profile.wire_contract.arbitrary_context_allowed, false);
    assert.deepEqual(profile.auxiliary_reference, {
      minimum_count: 0, maximum_count: 1, media_types: ["images"], weight_active: false,
      source_role: "image", position: "AFTER_ORIGINAL_AND_PAINTED_COMPOSITE",
      upload_authority: "SOURCE_JOINED_UPLOAD_PATH_ONLY_NOT_GENERATION_PERMISSION",
      destination: "uploaded", hidden_default: false, check_duplicates: true,
      model_type_binding: "EXPLICIT_UNDERLYING_VARIANT_FROM_CURRENT_SETTINGS",
      input_mapper: "UPLOADED_URI_STRING_TO_IMAGE_REFERENCE", picker_accept_hint: "image/*",
      source_byte_cap: "UNKNOWN", source_mime_acceptance: "UNPROVEN", provider_acceptance: "UNPROVEN",
      mime_and_size_policy: "SOURCE_MIME_AND_BYTE_CAP_UNPROVEN"
    });
    assert.equal(profile.prompt_policy.source_maximum, "UNKNOWN");
    assert.equal(profile.prompt_policy.local_max_utf16_code_units, 65_536);
    assert.equal(profile.prompt_policy.local_limit_scope, "LOCAL_RESOURCE_BOUND_ONLY_NOT_SOURCE_UI_OR_PROVIDER");
    assert.equal(profile.acknowledgement.poller_internals, "NOT_JOINED");
    assert.deepEqual(profile.result_contract.output_cardinality_mime_dimensions, "UNPROVEN");
    assert.equal(profile.result_contract.latest_bot_selector, "AUTHOR_ID_MINUS_ONE_REVERSE_MESSAGE_SCAN");
    assert.equal(profile.result_contract.ready_predicate, "completed===true AND truthy object_url");
    assert.equal(profile.runtime_activation, false);
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.generation_permission, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.deepEqual(profile.source_binding.direct_source_artifacts, {
      form: { module: "banana-inpaint.js", bytes: 8_715, sha256: "sha256:4a22ce6da71d2b39c97614cdfcde3d38f201dad3015f2a59f018d8b7c8146172" },
      parent_editor: { module: "InpaintEditor.js", bytes: 24_250, sha256: "sha256:87509acda1040d79927edc30d8ddd18d503a6e7ce9387d5d0a059b1eb5028e14" },
      sender_helper: { module: "useImageEditorTool.js", bytes: 12_652, sha256: "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe" },
      wire_sender: { module: "video.js", bytes: 8_689, sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae" }
    });
    assert.equal(profile.source_binding.original_upload_profile_id, "banana-inpaint-original-upload-source-profile-v1");
    assert.equal(profile.source_binding.painted_composite_profile_id, "banana-inpaint-painted-composite-source-profile-v1");
    assert.equal(profile.source_binding.controls_profile_id, "banana-inpaint-controls-source-v1");
    assert.equal(profile.source_binding.controls_source_freshness, "UNVERIFIED_END_FINGERPRINT_MISSING");
    for (const upstreamHash of [profile.source_binding.original_upload_profile_schema_hash,
      profile.source_binding.painted_composite_profile_schema_hash, profile.source_binding.controls_profile_schema_hash]) {
      assert.notEqual(profile.profile_schema_hash, upstreamHash);
    }
    assert.match(profile.profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
    const base = { ...profile } as Record<string, unknown>;
    delete base.profile_schema_hash;
    assert.equal(profile.profile_schema_hash, schemaHash(base));
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.source_binding), true);
    assert.equal(Object.isFrozen(profile.source_binding.direct_source_artifacts), true);
  }
});

test("reconciles confirmed auxiliary uploaded path while retaining MIME, size, and provider gaps", () => {
  const profile = sourceProfile("banana");
  const auxiliary = profile.auxiliary_reference as unknown as Record<string, unknown>;
  const sourceBinding = profile.source_binding as unknown as Record<string, unknown>;
  assert.equal(auxiliary.upload_authority, "SOURCE_JOINED_UPLOAD_PATH_ONLY_NOT_GENERATION_PERMISSION");
  assert.equal(auxiliary.destination, "uploaded");
  assert.equal(auxiliary.hidden_default, false);
  assert.equal(auxiliary.check_duplicates, true);
  assert.equal(auxiliary.model_type_binding, "EXPLICIT_UNDERLYING_VARIANT_FROM_CURRENT_SETTINGS");
  assert.equal(auxiliary.input_mapper, "UPLOADED_URI_STRING_TO_IMAGE_REFERENCE");
  assert.equal(auxiliary.picker_accept_hint, "image/*");
  assert.equal(auxiliary.mime_and_size_policy, "SOURCE_MIME_AND_BYTE_CAP_UNPROVEN");
  assert.equal(auxiliary.provider_acceptance, "UNPROVEN");
  assert.equal(sourceBinding.auxiliary_upload_source_profile_id, "banana-inpaint-auxiliary-image-source-profile-v1");
  const expectedArtifacts = {
    reference: { module: "Reference.js", bytes: 5_956, sha256: "sha256:99979b585bb47bb5547e28ca927f9a4b5cbe12af56b9a0bfd481e07f91fcea4a" },
    upload_dropdown: { module: "UploadDropdown.js", bytes: 42_832, sha256: "sha256:b399a8a1d5fede3a16dd444abcfb4b8ddc89cd89e03ab493c5f9b5eff0f9d783" },
    file_uploader: { module: "fileUploader.js", bytes: 362_328, sha256: "sha256:b1e9af34daa830845c9712121ebb25c92801d22bbcec4f49d8b1748ecbc47786" },
    inpaint_caller: { module: "useImageEditorTool.js", bytes: 12_652, sha256: "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe" },
    app_uploader: { module: "app.js", bytes: 2_445_534, sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" }
  };
  assert.deepEqual(sourceBinding.auxiliary_upload_source_artifacts, expectedArtifacts);
  const expectedEvidence = {
    source_profile_id: "banana-inpaint-auxiliary-image-source-profile-v1",
    direct_source_artifacts: expectedArtifacts,
    root_facts: {
      root909: "image_wildcard_max1_weight_inactive",
      root912: "app_upload_uploaded_default_duplicate_check_true_current_model_type_uri_to_image",
      root914: "file_uploader_bridge_passes_files_only_and_maps_uploaded_uri_to_image"
    }
  };
  assert.equal(sourceBinding.auxiliary_upload_source_evidence_hash, schemaHash(expectedEvidence));
  assert.equal(typeof sourceBinding.auxiliary_upload_source_evidence_hash, "string");
  assert.equal(sourceBinding.auxiliary_upload_source_profile_id, "banana-inpaint-auxiliary-image-source-profile-v1");
  const changedArtifacts = { ...expectedArtifacts,
    file_uploader: { ...expectedArtifacts.file_uploader, sha256: `sha256:${"f".repeat(64)}` } };
  const changedSourceBinding = { ...sourceBinding, auxiliary_upload_source_artifacts: changedArtifacts };
  const changedProfile = { ...profile, source_binding: changedSourceBinding } as Record<string, unknown>;
  delete changedProfile.profile_schema_hash;
  assert.notEqual(schemaHash(changedProfile), profile.profile_schema_hash, "profile hash binds all confirmed auxiliary upload pins");
  assert.equal(auxiliary.source_byte_cap, "UNKNOWN");
  assert.equal(auxiliary.source_mime_acceptance, "UNPROVEN");
  assert.equal(profile.runtime_activation, false);
  assert.equal(profile.generation_permission, false);
  assert.equal(profile.backend_acceptance, "UNPROVEN");
});

test("prompt normalization preserves raw Unicode and line endings with a local UTF-16-only cap", () => {
  const prompt = "  café e\u0301\n🚀\r\n  ";
  const result = normalizeOwnerBananaInpaintPrompt({ variant: "banana3", prompt });
  assert.deepEqual(result, {
    variant: "banana3",
    prompt,
    length_utf16_code_units: prompt.length,
    maximum_utf16_code_units: 65_536,
    admission: "TRIMMED_NONEMPTY_PRESERVE_ORIGINAL",
    source_maximum: "UNKNOWN",
    local_limit_scope: "LOCAL_RESOURCE_BOUND_ONLY_NOT_SOURCE_UI_OR_PROVIDER",
    wire_transformation: "UNCHANGED",
    dispatch_allowed: false,
    runtime_activation: false,
    backend_acceptance: "UNPROVEN"
  });
  assert.equal(Object.isFrozen(result), true);
});

test("prompt normalization accepts the exact local cap and rejects one UTF-16 code unit over", () => {
  const accepted = normalizeOwnerBananaInpaintPrompt({ variant: "banana", prompt: "x".repeat(65_536) });
  assert.equal(accepted.length_utf16_code_units, 65_536);
  assert.throws(() => normalizeOwnerBananaInpaintPrompt({ variant: "banana", prompt: "x".repeat(65_537) }),
    (error: unknown) => error instanceof OwnerBananaInpaintPromptError && error.code === "PROMPT_TOO_LONG");
});

test("prompt input is closed, variant-bound, and rejects trim-empty intent without rewriting it", () => {
  for (const invalid of [
    { variant: "banana_inpaint", prompt: "write" },
    { variant: "banana2", prompt: " \n\t " },
    { variant: "banana3", prompt: "ok", source_profile: {} },
    { variant: "banana3", prompt: 4 }
  ]) {
    assert.throws(() => normalizeOwnerBananaInpaintPrompt(invalid), (error: unknown) =>
      error instanceof OwnerBananaInpaintPromptError && error.code === "INVALID_PROMPT");
  }
  const prompt = "  keep both ends  ";
  assert.equal(normalizeOwnerBananaInpaintPrompt({ variant: "banana2", prompt }).prompt, prompt);
  assert.equal(OWNER_BANANA_INPAINT_IMAGE_VARIANTS.includes("banana3"), true);
});

test("all nine explicit image-size selections remain represented and defaults are not filled", () => {
  const expected = {
    banana: [null], banana2: ["1K", "2K", "4K"], banana3: ["0.5K", "1K", "2K", "4K"], banana3_light: ["1K"]
  } as const;
  for (const variant of variants) {
    const profile = sourceProfile(variant);
    assert.deepEqual(profile.image_size_values[variant], expected[variant]);
    assert.equal(profile.wire_contract.image_size_binding, "EXPLICIT_898_NORMALIZED_VALUE_NO_DEFAULT");
    for (const image_size of expected[variant]) {
      const normalized = normalizeOwnerBananaInpaintParameters({ variant, image_size });
      assert.equal(normalized.variant, variant);
      assert.equal(normalized.image_size, image_size);
      assert.equal(normalized.effective_default_applied, false);
    }
  }
  assert.equal(Object.values(expected).reduce((count, values) => count + values.length, 0), 9);
});

test("source profile rejects cross-variant and drifted upstream source profiles", () => {
  const original = getOwnerBananaInpaintOriginalUploadSourceProfile(
    "banana", catalog, OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION
  );
  const painted = getOwnerBananaInpaintPaintedCompositeSourceProfile("banana", original);
  const controls = getOwnerBananaInpaintSourceParameters("banana", original);
  const banana2Original = getOwnerBananaInpaintOriginalUploadSourceProfile(
    "banana2", catalog, OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION
  );
  assert.throws(() => getOwnerBananaInpaintImageSourceProfile("banana2", original, painted, controls), OwnerBananaInpaintImageSourceProfileError);
  const altered = structuredClone(painted) as Record<string, unknown>;
  const binding = altered.source_binding as Record<string, unknown>;
  const artifacts = binding.source_artifacts as Record<string, Record<string, unknown>>;
  artifacts.painted_composite_caller = { module: "useImageEditorTool.js", bytes: 12_652, sha256: `sha256:${"f".repeat(64)}` };
  delete altered.profile_schema_hash;
  altered.profile_schema_hash = schemaHash(altered);
  deepFreezeForTest(altered);
  assert.throws(() => getOwnerBananaInpaintImageSourceProfile("banana", original, altered as never, controls),
    (error: unknown) => error instanceof OwnerBananaInpaintImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.throws(() => getOwnerBananaInpaintImageSourceProfile("banana", banana2Original, painted, controls),
    (error: unknown) => error instanceof OwnerBananaInpaintImageSourceProfileError && error.code === "PROFILE_BINDING_MISMATCH");
});

test("prompt snapshots reject accessors and proxies without invoking traps", () => {
  let getterCalls = 0;
  const accessor = Object.defineProperties({}, {
    variant: { enumerable: true, get() { getterCalls += 1; return "banana"; } },
    prompt: { enumerable: true, get() { getterCalls += 1; return "text"; } }
  });
  assert.throws(() => normalizeOwnerBananaInpaintPrompt(accessor), (error: unknown) =>
    error instanceof OwnerBananaInpaintPromptError && error.code === "INVALID_PROMPT");
  assert.equal(getterCalls, 0);

  let proxyTraps = 0;
  const proxy = new Proxy({ variant: "banana", prompt: "text" }, {
    ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); }
  });
  assert.throws(() => normalizeOwnerBananaInpaintPrompt(proxy), (error: unknown) =>
    error instanceof OwnerBananaInpaintPromptError && error.code === "INVALID_PROMPT");
  assert.equal(proxyTraps, 0);
});

function deepFreezeForTest<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeForTest(child);
    Object.freeze(value);
  }
  return value;
}
