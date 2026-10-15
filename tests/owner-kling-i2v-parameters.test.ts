import test from "node:test";
import assert from "node:assert/strict";
import {
  getOwnerKlingI2vParametersSource,
  normalizeOwnerKlingI2vParameters,
  OwnerKlingI2vParametersError
} from "../src/application/owner-kling-i2v-parameters.js";

const VALID = {
  model_id: "kling_image2video",
  prompt: "A small boat leaving the harbor",
  reference_count: 1,
  version: "3.0",
  mode: "hd",
  video_duration: 5,
  native_audio: false
} as const;

test("source descriptor pins the current form and keeps I2V source-only", () => {
  const source = getOwnerKlingI2vParametersSource();
  assert.equal(source.model_id, "kling_image2video");
  assert.equal(source.source_pins.form_module, "kling.js");
  assert.equal(source.source_pins.form_build_id, "1791904852");
  assert.equal(source.source_pins.form_sha256,
    "sha256:cdd5e9db14f57c901484c1bef541ba0b3fdd4d13153b990bd1f0edce1b3a5614");
  assert.equal(source.source_pins.settings_helper_sha256,
    "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6");
  assert.equal(source.source_pins.video_route_sha256,
    "sha256:a78d9b5f3af2adbb567dd505ef4b301f7e5e383438f8f09ff42e9418a6a1670d");
  assert.equal(source.source_pins.app_client_sha256,
    "sha256:6479e7e48c5a3348c7f642203e0438e7d4fa776997959df4dc505b39bb922ac1");
  assert.equal(source.settings.custom_payload_replacement_to_video_sender,
    "GENERIC_SENDER_USES_TRUTHY_CUSTOM_PAYLOAD_ELSE_CURRENT_SETTINGS");
  assert.equal(source.settings.current_form_custom_payload_read_or_write_occurrences, 0);
  assert.deepEqual(source.settings.current_form_initializer_keys,
    ["model_type", "temperature", "camera_movement", "aspect_ratio", "mode", "version", "native_audio", "gen_type", "motion", "video_duration", "multi_shots"]);
  assert.deepEqual(source.settings.settings_helper_overlay_semantics, {
    route_model_and_version_overlay: "ONLY_WHEN_ACTIVE_SETTINGS_ALREADY_HAS_KEY",
    staged_overlay: "ONLY_EXISTING_ACTIVE_SETTINGS_KEYS",
    staged_precedence: "AFTER_ROUTE_QUERY_OVERLAY",
    base_app_store_cache_method_definition: "UNRESOLVED_APP_GETSETTINGS_AND_GETSTAGEDSETTINGS_IMPLEMENTATIONS"
  });
  assert.equal(source.settings.current_form_settings_field_fates.aspect_ratio,
    "RESET_TO_UNDEFINED_FOR_I2V_THEN_OMITTED_BY_JSON");
  assert.equal(source.settings.current_form_effective_settings_and_getter_join,
    "STATIC_FORM_KEYS_CLOSED_EFFECTIVE_CACHE_VALUES_OPEN");
  assert.equal(source.references.required_count, 1);
  assert.deepEqual(source.controls.reference_image.accepted_file_types,
    ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]);
  assert.ok(source.controls.mode.four_k_enabled_model_ids.includes("kling_image2video"));
  assert.deepEqual(source.controls.native_audio.true_forces_hd_versions, ["2.6"]);
  assert.equal(source.cost_projection.value_binding, "MODEL_SETTINGS_ACCESSOR_OR_STORE_PROPERTY");
  assert.deepEqual(source.cost_projection.declared_keys, ["version", "mode", "video_duration", "native_audio"]);
  assert.deepEqual(Object.values(source.cost_projection.bindings).map((binding) => binding.property),
    ["version", "mode", "video_duration", "native_audio"]);
  assert.deepEqual(source.wire.file_urls_record, {
    type: "image", url_source: "selected_uploaded_file_resolved_by_video_store", caller_url_input_accepted: false
  });
  assert.equal(source.wire.file_urls_confidence, "CURRENT_HASH_PINNED_SENDER_AND_SERIALIZER_STATIC_JOIN");
  assert.equal(source.wire.frontend_to_native_chat_field_join, "CLOSED_SESSION_UUID_TO_NATIVE_CHAT_ID");
  assert.equal(source.wire.application_transport_chat_field_renaming, "NO_RENAME_SOURCE_BODY_ALREADY_CHAT_ID");
  assert.equal(source.wire.http_serialized_i2v_settings_mapping, "UNRESOLVED");
  assert.equal(source.runtime_usable, false);
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.backend_acceptance, "UNPROVEN");
});

test("normalizes only explicit I2V settings and never projects an owned reference or wire", () => {
  const normalized = normalizeOwnerKlingI2vParameters(VALID);
  assert.deepEqual(normalized.intent, {
    model_id: "kling_image2video", prompt: "A small boat leaving the harbor",
    version: "3.0", mode: "hd", video_duration: 5, native_audio: false
  });
  assert.deepEqual(normalized.reference_binding, {
    required_count: 1, caller_asserted_count: 1, role_type: "image",
    owned_references_bound: false, file_urls_projected: false
  });
  assert.deepEqual(normalized.cost_query_candidate, {
    keys: ["version", "mode", "video_duration", "native_audio"],
    values: { version: "3.0", mode: "hd", video_duration: 5, native_audio: false },
    amount_or_quote: "UNPROVEN"
  });
  assert.equal(normalized.dispatch_allowed, false);
  assert.equal("wire_candidate" in normalized, false);
});

test("applies only the current I2V version, resolution, duration, and audio bounds", () => {
  const accepts = (patch: Record<string, unknown>) => normalizeOwnerKlingI2vParameters({ ...VALID, ...patch });
  for (const version of ["1.5", "1.6", "2.1-master", "2.5-turbo", "2.6"]) {
    for (const video_duration of [5, 10]) accepts({ version, video_duration, mode: version === "2.1-master" ? "hd" : "standart" });
  }
  for (const version of ["3.0", "3.0-turbo"]) {
    accepts({ version, video_duration: 3, mode: version === "3.0" ? "4K" : "hd" });
    accepts({ version, video_duration: 15 });
  }
  accepts({ version: "2.6", native_audio: true });
  accepts({ version: "3.0", native_audio: true });
  accepts({ version: "3.0", mode: "4K" });
  accepts({ version: "3.0", mode: "standart", native_audio: true });
  const reject = (patch: Record<string, unknown>) => assert.throws(
    () => accepts(patch),
    (error: unknown) => error instanceof OwnerKlingI2vParametersError && error.code === "INVALID_PARAMETERS"
  );
  reject({ version: "1.4" });
  reject({ version: "2.1-master", mode: "standart" });
  reject({ version: "2.5-turbo", mode: "4K" });
  reject({ version: "3.0-turbo", mode: "4K" });
  reject({ version: "1.6", video_duration: 3 });
  reject({ version: "3.0", video_duration: 16 });
  reject({ version: "1.6", native_audio: true });
  reject({ version: "3.0-turbo", native_audio: true });
  reject({ version: "2.6", mode: "standart", native_audio: true });
});

test("keeps the source's prompt-optional variant narrow", () => {
  assert.equal(normalizeOwnerKlingI2vParameters({ ...VALID, version: "3.0-turbo", prompt: "" }).intent.prompt, "");
  assert.equal(normalizeOwnerKlingI2vParameters({ ...VALID, version: "3.0-turbo", prompt: " \t " }).intent.prompt, "");
  assert.throws(() => normalizeOwnerKlingI2vParameters({ ...VALID, prompt: "" }), OwnerKlingI2vParametersError);
  assert.throws(() => normalizeOwnerKlingI2vParameters({ ...VALID, version: "3.0-turbo", prompt: "\uD800" }), OwnerKlingI2vParametersError);
});

test("rejects unknown model, reference count, settings aliases, and unsafe records", () => {
  const reject = (input: unknown) => assert.throws(
    () => normalizeOwnerKlingI2vParameters(input),
    (error: unknown) => error instanceof OwnerKlingI2vParametersError && error.code === "INVALID_PARAMETERS"
  );
  reject({ ...VALID, model_id: "kling_o1_image2video" });
  reject({ ...VALID, reference_count: 0 });
  reject({ ...VALID, reference_count: 2 });
  reject({ ...VALID, aspect_ratio: "16:9" });
  reject({ ...VALID, file_urls: ["https://caller.example/image"] });
  reject({ ...VALID, model_type: "kling_text2video" });
  const getter = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(VALID)) Object.defineProperty(getter, key, {
    enumerable: true, get: () => value
  });
  reject(getter);
});

test("freezes source metadata and detaches normalized intent from caller mutation", () => {
  const source = getOwnerKlingI2vParametersSource();
  const input: Record<string, unknown> = { ...VALID };
  const normalized = normalizeOwnerKlingI2vParameters(input);
  input.prompt = "changed";
  assert.equal(normalized.intent.prompt, VALID.prompt);
  assert.ok(Object.isFrozen(source));
  assert.ok(Object.isFrozen(source.controls));
  assert.ok(Object.isFrozen(source.source_pins));
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(normalized.intent));
  assert.ok(Object.isFrozen(normalized.reference_binding));
});
