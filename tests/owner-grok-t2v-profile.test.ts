import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import {
  OWNER_GROK_T2V_CONTRACT_REGISTRY_VERSION,
  createOwnerGrokT2vProfile,
  isAuthenticOwnerGrokT2vProfile
} from "../src/application/owner-grok-t2v-profile.js";

const CATALOG_DIRECTORY = resolve(process.cwd(), "catalog");
const ATTEMPT_ID = "link_grok_t2v_profile_test_00000001";
const RATIOS = ["16:9", "9:16", "3:2", "2:3", "1:1"] as const;
const RESOLUTIONS = ["480p", "720p"] as const;
const DURATIONS = [6, 7, 8, 9, 10] as const;
const EXPECTED_SCHEMA_HASH = "sha256:a79b1499a925c01b0bb64d8b633a3762a337b7128c98c66127a3e0a8f5e03c0d";

test("Grok T2V profile binds only the exact no-reference Grok model and source pins", () => {
  const profile = createOwnerGrokT2vProfile(CATALOG_DIRECTORY);
  assert.ok(isAuthenticOwnerGrokT2vProfile(profile));
  assert.equal(profile.modelId, "grok_t2v");
  assert.equal(profile.aiName, "grok_video");
  assert.equal(profile.modelType, "grok_t2v");
  assert.equal(profile.operationId, "generate-video");
  assert.equal(profile.registry.contracts.length, 1);
  assert.equal(OWNER_GROK_T2V_CONTRACT_REGISTRY_VERSION,
    "sha256-d43d1f06c4409444b66a6c937695b1047355333d4d0ccd3869ada4fd5fd73ec1.json");
  assert.equal(profile.source.source_pins.current_form_bytes, 10_083);
  assert.equal(profile.source.source_pins.current_form_sha256,
    "sha256:c742501d84b369e863d3275ee8b3412fd00007a8308e6119b3b90adae3685423");
  assert.equal(profile.source.source_pins.current_source_build_id, "1791904852");
  assert.equal(profile.source.source_pins.settings_inventory_build_id, "1791811899");
  assert.deepEqual(profile.source.source_pins.form_source_offsets, {
    aspect_ratio_options: 2_426,
    resolution_options: 5_062,
    duration_options: 3_036,
    video_duration_slider: 8_796
  });
  assert.equal(profile.source.source_pins.app_option_helper_export, "I");
  assert.deepEqual(profile.source.source_pins.app_option_helper_definition_offsets, [107_485, 53_785, 35_173]);
  assert.equal(profile.source.contract_schema_hash, EXPECTED_SCHEMA_HASH);
  assert.equal(profile.source.defaults, "UNKNOWN");
  assert.equal(profile.source.runtime_usable, false);
  assert.equal(profile.source.dispatch_allowed, false);
  assert.equal(profile.source.backend_acceptance, "UNPROVEN");
});

test("Grok T2V accepts the complete literal control matrix and no other combinations", () => {
  const profile = createOwnerGrokT2vProfile(CATALOG_DIRECTORY);
  let accepted = 0;
  for (const aspect_ratio of RATIOS) {
    for (const resolution of RESOLUTIONS) {
      for (const video_duration of DURATIONS) {
        const request = {
          attemptId: ATTEMPT_ID,
          prompt: "A luminous night train moving through a quiet mountain valley.",
          aspect_ratio,
          resolution,
          video_duration
        };
        const normalized = profile.normalizeGenerationInput(request);
        assert.deepEqual(normalized.parameters, {
          prompt: request.prompt,
          aspect_ratio,
          resolution,
          video_duration
        });
        accepted += 1;
      }
    }
  }
  assert.equal(accepted, 50);
  assert.deepEqual(profile.source.controls.aspect_ratio.values, RATIOS);
  assert.deepEqual(profile.source.controls.resolution.values, RESOLUTIONS);
  assert.deepEqual(profile.source.controls.video_duration.endpoints, [6, 10]);
  assert.equal(profile.source.controls.video_duration.step, 1);
  assert.deepEqual(profile.source.controls.video_duration.values, DURATIONS);
});

test("Grok T2V source initializer is kept separate from effective settings defaults", () => {
  const profile = createOwnerGrokT2vProfile(CATALOG_DIRECTORY);
  assert.deepEqual(profile.source.initializer_candidates.values, {
    aspect_ratio: "16:9",
    video_duration: 5,
    resolution: "480p"
  });
  assert.equal(profile.source.initializer_candidates.effective_defaults, "UNKNOWN");
  assert.equal(profile.source.initializer_candidates.video_duration_is_within_exposed_slider_range, false);
  assert.throws(() => profile.normalizeGenerationInput({
    attemptId: ATTEMPT_ID,
    prompt: "A scene.",
    aspect_ratio: "16:9",
    resolution: "480p",
    video_duration: 5
  }));
});

test("Grok T2V rejects references, unknown fields, and values outside source controls", () => {
  const profile = createOwnerGrokT2vProfile(CATALOG_DIRECTORY);
  const base = {
    attemptId: ATTEMPT_ID,
    prompt: "A cinematic scene.",
    aspect_ratio: "16:9",
    resolution: "480p",
    video_duration: 6
  };
  assert.throws(() => profile.normalizeGenerationInput({ ...base, file_urls: [] }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, image_reference: "file_123" }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, model_type: "grok_t2v" }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, aspect_ratio: "4:3" }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, resolution: "1080p" }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, video_duration: 5 }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, video_duration: 10.5 }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, video_duration: 11 }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, prompt: "   " }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, prompt: "x".repeat(5_001) }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, attemptId: "foreign_attempt" }));
});

test("Grok cost fields stay in source-bound preflight bindings, outside video POST settings", () => {
  const profile = createOwnerGrokT2vProfile(CATALOG_DIRECTORY);
  const contract = profile.registry.contracts[0];
  assert.ok(contract);
  assert.deepEqual(profile.source.cost_projection.public_fields, ["video_duration", "resolution"]);
  assert.equal(profile.source.cost_projection.helper_form_call_arity, 1);
  assert.equal(profile.source.cost_projection.helper_formal_count, 6);
  assert.equal(profile.source.cost_projection.fifth_argument_override_supplied_by_form, false);
  assert.equal(profile.source.cost_projection.preflight_only, true);
  assert.deepEqual(contract.cost_parameter_bindings, {
    video_duration: { kind: "parameter", parameter: "video_duration" },
    resolution: { kind: "parameter", parameter: "resolution" }
  });
  assert.deepEqual(contract.wire.settings_fields, {
    aspect_ratio: "aspect_ratio",
    resolution: "resolution",
    video_duration: "video_duration"
  });
  assert.deepEqual(contract.wire.fixed_settings, { file_urls: [] });
  assert.equal(Object.values(contract.wire.settings_fields).includes("size"), false);
  assert.equal(Object.values(contract.wire.settings_fields).includes("duration"), false);
});

test("Grok T2V archive reloads and seals the no-reference sender projection", () => {
  const profile = createOwnerGrokT2vProfile(CATALOG_DIRECTORY);
  const executor = new GenerationContractExecutorV2(profile.registry, profile.catalog);
  const prepared = executor.prepare({
    model_id: profile.modelId,
    operation_id: profile.operationId,
    catalog_version: profile.registry.catalog_version,
    variant_id: profile.variantId,
    parameters: {
      prompt: "A cinematic scene.",
      aspect_ratio: "9:16",
      resolution: "720p",
      video_duration: 8
    }
  });
  assert.equal(prepared.ai_name, "grok_video");
  assert.deepEqual(prepared.settings, {
    model_type: "grok_t2v",
    file_urls: [],
    aspect_ratio: "9:16",
    resolution: "720p",
    video_duration: 8
  });
  assert.equal("cost_parameter_bindings" in prepared.settings, false);
  assert.equal(profile.source.no_reference_source.form_validator_present, false);
  assert.deepEqual(profile.source.no_reference_source.reference_validator_model_ids, ["grok_i2v", "grok_v2v", "grok_15_i2v"]);
  assert.equal(profile.source.no_reference_source.references_in_caller_input, false);
  assert.equal(profile.source.wire_observation.path, "/api/v1/video/generate");
  assert.equal(profile.source.wire_observation.query.ai_name, "grok_video");
});
