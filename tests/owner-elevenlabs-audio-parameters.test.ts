import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const MODULE_URL = new URL("../src/application/owner-elevenlabs-audio-parameters.js", import.meta.url).href;
const parameterModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const C5 = "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json";
const SETTINGS_62 = "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json";
const MODELS = ["eleven_multilingual_sts_v2", "eleven_multilingual_v2", "eleven_v3", "eleven_v4", "eleven_v4_turbo"] as const;

test("publishes a source-pinned current-C5 ElevenLabs audio parameter report", () => {
  assert.ok(parameterModule, "MISSING_OWNER_ELEVENLABS_AUDIO_PARAMETERS_MODULE");
  assert.equal(typeof parameterModule.getOwnerElevenLabsAudioSourceParameters, "function");
  const source = (parameterModule.getOwnerElevenLabsAudioSourceParameters as () => Record<string, any>)();
  const catalog = loadSelectedDiscoveryCatalog(C5, join(process.cwd(), "catalog")).discoveryCatalog;
  const settings = loadMaplessSettingsInventoryVersion(SETTINGS_62, join(process.cwd(), "catalog"));
  assert.equal(source.profile_id, "elevenlabs-audio-explicit-parameters-v1");
  assert.equal(source.source_binding.public_catalog_version, C5);
  assert.equal(source.source_binding.settings_inventory_version, SETTINGS_62);
  assert.equal(source.source_binding.form_module.bytes, 32647);
  assert.equal(source.source_binding.form_module.sha256,
    "sha256:d41d3df4c11078f92b6543c140522dc9b6ffa7b9361b46a7afd88982f300c64e");
  assert.deepEqual(source.model_ids, MODELS);
  for (const modelId of MODELS) {
    const model = source.models[modelId] as Record<string, any>;
    const catalogModel = catalog.getModel(modelId);
    const settingsModel = settings.models.find((row) => row.model_id === modelId);
    assert.ok(settingsModel);
    assert.equal(catalogModel.id, modelId);
    assert.equal(catalogModel.upstream_id, modelId);
    assert.equal(catalogModel.ai_name, "elevenlabs");
    assert.equal(catalogModel.active, true);
    assert.equal(model.form_id, "elevenlabs");
    assert.equal(model.active, true);
    assert.deepEqual(model.public_settings, settingsModel.settings);
    assert.deepEqual(model.public_settings, catalogModel.settings);
    assert.deepEqual(source.model_value_settings_keys, settingsModel.model_value_settings_keys);
    assert.deepEqual(source.payload_field_keys, settingsModel.payload_field_keys);
  }
  assert.equal(Object.hasOwn(source.models, "eleven_english_sts_v2"), false);
  assert.equal(source.runtime_usable, false);
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.effective_defaults, "UNPROVEN");
  assert.equal(source.payload_projection.status, "NOT_EMITTED_CALLER_BRIDGE_UNRESOLVED");
  assert.equal(Object.isFrozen(source), true);
  assert.equal(Object.isFrozen(source.models.eleven_v4.public_settings.allowed_modes), true);
});

test("normalizes only explicit model/mode selections from the paired public mode sets", () => {
  assert.ok(parameterModule, "MISSING_OWNER_ELEVENLABS_AUDIO_PARAMETERS_MODULE");
  const source = (parameterModule.getOwnerElevenLabsAudioSourceParameters as () => Record<string, any>)();
  const normalize = parameterModule.normalizeOwnerElevenLabsAudioParameters as (input: unknown) => Record<string, unknown>;
  for (const modelId of MODELS) {
    const model = source.models[modelId] as { public_settings: { allowed_modes: readonly string[] } };
    for (const mode of model.public_settings.allowed_modes) {
      const normalized = normalize({ model_id: modelId, mode });
      assert.deepEqual(normalized, {
        model_id: modelId,
        mode,
        source_scope: "MODEL_MODE_SELECTION_ONLY",
        generation_allowed: false,
        dispatch_allowed: false,
        backend_acceptance: "UNPROVEN"
      });
      assert.equal(Object.isFrozen(normalized), true);
    }
    assert.throws(() => normalize({ model_id: modelId, mode: "speech_to_speech" === model.public_settings.allowed_modes[0]
      ? "text_to_speech" : "speech_to_speech" }), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "INVALID_PARAMETERS");
  }
  for (const invalid of [
    { model_id: "eleven_english_sts_v2", mode: "speech_to_speech" },
    { model_id: "eleven_v4", mode: "speech_to_speech" },
    { model_id: "eleven_v4", mode: "text_to_speech", voice_id: "unbound" },
    { model_id: "eleven_v4", mode: "text_to_speech", prompt: "unjoined" },
    { model_id: "eleven_v4", mode: "text_to_speech", settings: {} },
    { model_id: "eleven_v4", mode: "text_to_speech", dispatch_allowed: true },
    { model_id: "eleven_v4", mode: "text_to_speech", model_type: "eleven_v4" }
  ]) {
    assert.throws(() => normalize(invalid), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "INVALID_PARAMETERS");
  }
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assert.throws(() => normalize(revoked.proxy), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "INVALID_PARAMETERS");
});

test("reports exact source-builder branches without projecting an unjoined wire payload", () => {
  assert.ok(parameterModule, "MISSING_OWNER_ELEVENLABS_AUDIO_PARAMETERS_MODULE");
  const source = (parameterModule.getOwnerElevenLabsAudioSourceParameters as () => Record<string, any>)();
  assert.deepEqual(source.form_controls, ["inputs", "mode", "similarity_boost", "stability"]);
  assert.deepEqual(source.builder.model_membership_branch.models, ["eleven_v4", "eleven_v4_turbo"]);
  assert.deepEqual(source.builder.dialogue_branch.projected_input_keys, ["name", "text", "voice_id"]);
  assert.equal(source.builder.dialogue_branch.condition, "mode === text_to_dialogue");
  assert.equal(source.builder.voice_fallback, "EMPTY_STRING_OUTSIDE_DIALOGUE_BRANCH");
  assert.equal(source.builder.duration_fallback, 0);
  assert.equal(source.builder.character_count_fallback, 0);
  assert.equal(source.builder.local_mode_fallback, "text_to_speech");
  assert.equal(source.builder.local_fallbacks_are_effective_defaults, false);
  assert.equal(source.voice_ownership, "UNRESOLVED_PUBLIC_VS_ACCOUNT_CUSTOM");
  assert.equal(source.caller_bridge, "UNRESOLVED");
  assert.equal(source.payload_projection.status, "NOT_EMITTED_CALLER_BRIDGE_UNRESOLVED");
});
