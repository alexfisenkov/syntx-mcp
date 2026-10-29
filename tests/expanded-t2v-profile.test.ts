import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createOwnerExpandedT2vProfiles, OWNER_EXPANDED_T2V_MODEL_IDS } from "../src/application/owner-expanded-t2v-profile.js";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import { serializeGenerationContractRegistryV2 } from "../src/domain/generation-contract-v2.js";

const ATTEMPT = "link_expanded_t2v_profile_test_0123456789";
const profiles = createOwnerExpandedT2vProfiles(resolve(process.cwd(), "catalog"));

const validInputs: Record<string, Record<string, unknown>> = {
  flux3_t2v: { video_duration: 20, resolution: "fhd", aspect_ratio: "21:9", generate_audio: false },
  happy_horse_t2v: { video_duration: 15, resolution: "1080P", aspect_ratio: "3:4" },
  "seedance-1.5-pro": { video_duration: 12, resolution: "720p", aspect_ratio: "21:9", generate_audio: true, camera_fixed: true },
  seedance_pro: { video_duration: 10, resolution: "480p", aspect_ratio: "21:9" },
  "seedance_pro-fast": { video_duration: 12, resolution: "480p", aspect_ratio: "9:16" },
  "text2video-4.5": { video_duration: "8.0", aspect_ratio: "916" }
};

test("expanded T2V V2 registry exposes source-supported controls, wire fields, cost bindings, and explicit gaps", () => {
  assert.deepEqual([...profiles.keys()].sort(), [...OWNER_EXPANDED_T2V_MODEL_IDS].sort());
  for (const modelId of OWNER_EXPANDED_T2V_MODEL_IDS) {
    const profile = profiles.get(modelId)!;
    const contract = profile.registry.contracts.find((item) => item.model_id === modelId)!;
    const encoded = serializeGenerationContractRegistryV2(profile.registry);
    assert.match(encoded, new RegExp(`expanded-t2v-${modelId}-noref-controls-v2`, "u"));
    assert.deepEqual(Object.keys(contract.wire.settings_fields).sort(), Object.keys(validInputs[modelId]!).sort());
    for (const [costKey, binding] of Object.entries(contract.cost_parameter_bindings ?? {})) {
      assert.deepEqual(binding, { kind: "parameter", parameter: costKey });
      assert.ok(Object.hasOwn(validInputs[modelId]!, costKey));
    }
    const source = profile.source;
    assert.equal(source.dispatch_allowed, false);
    assert.equal(source.runtime_usable, false);
    assert.ok(source.controls.unresolved_controls.length > 0);
    assert.deepEqual(source.cost_projection.omitted_public_keys, source.cost_projection.public_keys.filter((key) => !source.cost_projection.caller_keys.includes(key)));
  }
});

test("expanded T2V normalization accepts reviewed enums/ranges and rejects unsupported values", () => {
  for (const modelId of OWNER_EXPANDED_T2V_MODEL_IDS) {
    const profile = profiles.get(modelId)!;
    const valid = { attemptId: ATTEMPT, model_id: modelId, prompt: "A copper-colored bird flying at dawn.", ...validInputs[modelId] };
    assert.equal(profile.normalizeGenerationInput(valid).parameters.prompt, valid.prompt);
    const invalid = { ...valid, ...("resolution" in valid ? { resolution: "__unknown__" } : { aspect_ratio: "__unknown__" }) };
    assert.throws(() => profile.normalizeGenerationInput(invalid), /INVALID_REQUEST/u);
  }
  assert.throws(() => profiles.get("happy_horse_t2v")!.normalizeGenerationInput({
    attemptId: ATTEMPT, model_id: "happy_horse_t2v", prompt: "out of range", video_duration: 16, resolution: "720P", aspect_ratio: "16:9"
  }), /INVALID_REQUEST/u);
  for (const duration of [4, 21]) assert.throws(() => profiles.get("flux3_t2v")!.normalizeGenerationInput({
    attemptId: ATTEMPT, model_id: "flux3_t2v", prompt: "out of range", video_duration: duration,
    resolution: "hd", aspect_ratio: "auto", generate_audio: true
  }), /INVALID_REQUEST/u);
});

test("expanded T2V V2 executor serializes only reviewed settings and source-bound cost inputs", () => {
  for (const modelId of OWNER_EXPANDED_T2V_MODEL_IDS) {
    const profile = profiles.get(modelId)!;
    const executor = new GenerationContractExecutorV2(profile.registry, profile.catalog);
    const prepared = executor.prepare({ model_id: modelId, operation_id: "generate-video",
      catalog_version: profile.registry.catalog_version, variant_id: profile.variantId,
      parameters: { prompt: "A copper-colored bird flying at dawn.", ...validInputs[modelId] } });
    assert.equal(prepared.ai_name, profile.aiName);
    assert.equal(prepared.settings.model_type, modelId);
    for (const [name, value] of Object.entries(validInputs[modelId]!)) assert.equal(prepared.settings[name], value);
    assert.deepEqual(Object.keys(prepared.settings).sort(), ["file_urls", "model_type", ...Object.keys(validInputs[modelId]!)].sort());
    if (modelId === "flux3_t2v") assert.equal(Object.hasOwn(prepared.settings, "draft"), false);
  }
});
