import assert from "node:assert/strict";
import test from "node:test";

const sourceModuleUrl = new URL(import.meta.url.includes("/dist/tests/")
  ? "../src/application/owner-soul-reference-strength-source-profile.js"
  : "../src/application/owner-soul-reference-strength-source-profile.ts", import.meta.url);

const loadProjector = async () => {
  const module = await import(sourceModuleUrl.href) as Record<string, unknown>;
  return module.projectOwnerSoulReferenceStrengthWireField as (input: unknown) => unknown;
};

test("projects reference_strength from ordinary settings when the custom slot is null", async () => {
  const project = await loadProjector();
  assert.deepEqual(project({ app_store_settings: { reference_strength: 0.7 }, custom_setting_payload: null }),
    { status: "INCLUDED", source: "APP_STORE_SETTINGS", value: 0.7 });
});

test("custom payload replaces ordinary settings instead of merging reference_strength", async () => {
  const project = await loadProjector();
  assert.deepEqual(project({ app_store_settings: { reference_strength: 0.7 }, custom_setting_payload: {} }),
    { status: "OMITTED", reason: "CUSTOM_PAYLOAD_REPLACED_SETTINGS" });
  assert.deepEqual(project({ app_store_settings: { reference_strength: 0.7 }, custom_setting_payload: { quality: "720p" } }),
    { status: "OMITTED", reason: "CUSTOM_PAYLOAD_REPLACED_SETTINGS" });
});

test("projects reference_strength supplied by the replacing custom payload", async () => {
  const project = await loadProjector();
  assert.deepEqual(project({ app_store_settings: { reference_strength: 0.7 }, custom_setting_payload: { reference_strength: 0.4 } }),
    { status: "INCLUDED", source: "CUSTOM_PAYLOAD", value: 0.4 });
});

test("binds the projection contract to the current inspected source assets", async () => {
  const module = await import(sourceModuleUrl.href) as Record<string, unknown>;
  const readProfile = module.getOwnerSoulReferenceStrengthSourceProfile as () => Record<string, any>;
  const profile = readProfile();
  assert.equal(profile.profile_id, "owner-soul-reference-strength-source-profile-v1");
  assert.equal(profile.model_id, "higgsfield-soul");
  assert.equal(profile.build_id, "1791904852");
  assert.equal(profile.initializer_value, 0.7);
  assert.deepEqual(profile.request_control, {
    mode: "OPTIONAL_EXPLICIT_FIXED_INITIALIZER_ONLY", allowed_values: [0.7],
    omitted_behavior: "KEEP_EXISTING_SETTINGS_PAYLOAD_UNCHANGED", provider_acceptance: "UNPROVEN"
  });
  assert.deepEqual(profile.source_sha256, {
    app_route: "6479e7e48c5a3348c7f642203e0438e7d4fa776997959df4dc505b39bb922ac1",
    soul_form: "2a7dfc8eb1b9555b507a74a8d47f55cdfa5f77969d42fb5095ec6a2b3b42fe3d",
    settings_helper: "7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
    image_route: "b6f38c018a956113a9205092d99b5eedecaaa682e301053c686779eeea2f8447",
    image_sender: "5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e"
  });
  assert.equal(profile.provider_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(profile), true);
});
