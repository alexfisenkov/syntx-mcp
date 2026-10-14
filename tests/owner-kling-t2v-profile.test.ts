import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import {
  createOwnerKlingT2vProfile,
  isAuthenticOwnerKlingT2vProfile
} from "../src/application/owner-kling-t2v-profile.js";

const CATALOG_DIRECTORY = resolve(process.cwd(), "catalog");
const ATTEMPT_ID = "link_kling_profile_test_00000001";
const STANDARD_VERSIONS = ["1.5", "1.6", "2.1-master", "2.5-turbo", "2.6"] as const;
const LONG_VERSIONS = ["3.0", "3.0-turbo"] as const;
const RATIOS = ["16:9", "1:1", "9:16"] as const;

test("Kling T2V profiles bind both current no-reference model branches and current source pins", () => {
  const base = createOwnerKlingT2vProfile("kling_text2video", CATALOG_DIRECTORY);
  const o1 = createOwnerKlingT2vProfile("kling_o1_text2video", CATALOG_DIRECTORY);
  assert.equal(isAuthenticOwnerKlingT2vProfile(base), true);
  assert.equal(isAuthenticOwnerKlingT2vProfile(o1), true);
  assert.equal(base.source.identity.model_id, "kling_text2video");
  assert.equal(o1.source.identity.model_id, "kling_o1_text2video");
  assert.equal(base.source.source_pins.source_build_id, "1791904852");
  assert.equal(base.source.source_pins.form_sha256, "sha256:cdd5e9db14f57c901484c1bef541ba0b3fdd4d13153b990bd1f0edce1b3a5614");
  assert.deepEqual(base.source.controls.version.values, [...STANDARD_VERSIONS, ...LONG_VERSIONS]);
  assert.deepEqual(base.source.controls.aspect_ratio.values, RATIOS);
  assert.deepEqual(base.source.controls.video_duration.values_by_version.standard, [5, 10]);
  assert.deepEqual(base.source.controls.video_duration.values_by_version.long, Array.from({ length: 15 }, (_, index) => index + 1));
  assert.deepEqual(base.source.controls.mode_values_by_version.master_2_1, ["hd"]);
  assert.deepEqual(base.source.controls.native_audio_true_versions, ["2.6", "3.0"]);
  assert.deepEqual(base.source.cost_projection.caller_keys, ["version", "mode", "video_duration", "native_audio"]);
  assert.deepEqual(o1.source.controls.version.values, []);
  assert.deepEqual(o1.source.controls.mode.values, ["hd"]);
  assert.deepEqual(o1.source.cost_projection.caller_keys, ["version", "mode", "video_duration"]);
  assert.equal(base.source.no_reference_source.validator, "EXACT_ZERO_FILES");
  assert.equal(o1.source.no_reference_source.validator, "NO_REQUIRED_FILE_VALIDATOR");
  assert.equal(base.source.defaults, "UNKNOWN");
  assert.equal(base.source.runtime_usable, false);
  assert.equal(base.source.dispatch_allowed, false);
  assert.equal(base.source.backend_acceptance, "UNPROVEN");
  assert.equal(base.registry.contracts.length, 2);
});

test("base Kling T2V normalizer admits all source-derived control combinations", () => {
  const profile = createOwnerKlingT2vProfile("kling_text2video", CATALOG_DIRECTORY);
  for (const version of STANDARD_VERSIONS) {
    for (const duration of [5, 10]) {
      const modes = version === "2.1-master" ? ["hd"] as const : ["standart", "hd"] as const;
      const audioValues = version === "2.6" ? [false, true] as const : [false] as const;
      for (const mode of modes) {
        for (const aspect_ratio of RATIOS) {
          for (const native_audio of audioValues) {
            const request = { attemptId: ATTEMPT_ID, prompt: "A cinematic mountain landscape.", version, mode, aspect_ratio, video_duration: duration, native_audio };
            assert.deepEqual(profile.normalizeGenerationInput(request).parameters, {
              prompt: request.prompt, version, mode, aspect_ratio, video_duration: duration, native_audio
            });
          }
        }
      }
    }
  }
  for (const version of LONG_VERSIONS) {
    const audioValues = version === "3.0" ? [false, true] as const : [false] as const;
    for (let video_duration = 1; video_duration <= 15; video_duration += 1) {
      for (const mode of ["standart", "hd"] as const) {
        for (const aspect_ratio of RATIOS) {
          for (const native_audio of audioValues) {
            assert.doesNotThrow(() => profile.normalizeGenerationInput({
              attemptId: ATTEMPT_ID, prompt: "A cinematic mountain landscape.", version, mode, aspect_ratio, video_duration, native_audio
            }));
          }
        }
      }
    }
  }
});

test("base Kling T2V normalizer rejects unsupported or mismatched duration and mode values", () => {
  const profile = createOwnerKlingT2vProfile("kling_text2video", CATALOG_DIRECTORY);
  const base = { attemptId: ATTEMPT_ID, prompt: "A cinematic mountain landscape.", mode: "hd", aspect_ratio: "16:9", native_audio: false };
  assert.throws(() => profile.normalizeGenerationInput({ ...base, version: "1.5", video_duration: 1 }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, version: "2.1", video_duration: 5 }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, version: "3.0", video_duration: 16 }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, version: "1.5", mode: "4K", video_duration: 5 }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, version: "2.1-master", mode: "standart", video_duration: 5 }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, version: "1.5", video_duration: 5, native_audio: true }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, version: "1.5", video_duration: 5, file_urls: [] }));
});

test("base Kling T2V conditional control cases are exact for 2.1-master and native audio", () => {
  const profile = createOwnerKlingT2vProfile("kling_text2video", CATALOG_DIRECTORY);
  const common = { attemptId: ATTEMPT_ID, prompt: "A cinematic mountain landscape.", aspect_ratio: "16:9", video_duration: 5 };
  assert.doesNotThrow(() => profile.normalizeGenerationInput({ ...common, version: "2.1-master", mode: "hd", native_audio: false }));
  assert.throws(() => profile.normalizeGenerationInput({ ...common, version: "2.1-master", mode: "standart", native_audio: false }));
  assert.doesNotThrow(() => profile.normalizeGenerationInput({ ...common, version: "2.6", mode: "standart", native_audio: true }));
  assert.doesNotThrow(() => profile.normalizeGenerationInput({ ...common, version: "3.0", mode: "hd", native_audio: true }));
  assert.throws(() => profile.normalizeGenerationInput({ ...common, version: "3.0-turbo", mode: "hd", native_audio: true }));
});

test("O1 Kling T2V stays source-bound to HD, no version parameter, and no required file", () => {
  const profile = createOwnerKlingT2vProfile("kling_o1_text2video", CATALOG_DIRECTORY);
  for (const video_duration of [5, 10]) {
    for (const aspect_ratio of RATIOS) {
      const prompt = "A cinematic mountain landscape.";
      const normalized = profile.normalizeGenerationInput({ attemptId: ATTEMPT_ID, prompt, mode: "hd", aspect_ratio, video_duration });
      assert.deepEqual(normalized.parameters, { prompt, mode: "hd", aspect_ratio, video_duration });
    }
  }
  assert.throws(() => profile.normalizeGenerationInput({ attemptId: ATTEMPT_ID, prompt: "A scene.", mode: "standart", aspect_ratio: "16:9", video_duration: 5 }));
  assert.throws(() => profile.normalizeGenerationInput({ attemptId: ATTEMPT_ID, prompt: "A scene.", mode: "hd", aspect_ratio: "16:9", video_duration: 7 }));
  assert.throws(() => profile.normalizeGenerationInput({ attemptId: ATTEMPT_ID, prompt: "A scene.", mode: "hd", aspect_ratio: "16:9", video_duration: 5, version: "3.0" }));
});

test("Kling generation contracts keep cost aliases out of POST settings", () => {
  const base = createOwnerKlingT2vProfile("kling_text2video", CATALOG_DIRECTORY);
  const executor = new GenerationContractExecutorV2(base.registry, base.catalog);
  const prepared = executor.prepare({
    model_id: base.modelId,
    operation_id: base.operationId,
    catalog_version: base.registry.catalog_version,
    variant_id: base.variantId,
    parameters: {
      prompt: "A cinematic mountain landscape.", version: "3.0", mode: "hd", aspect_ratio: "1:1", video_duration: 8, native_audio: true
    }
  });
  assert.equal(prepared.ai_name, "kling");
  assert.deepEqual(prepared.settings, {
    file_urls: [], model_type: "kling_text2video", version: "3.0", mode: "hd", aspect_ratio: "1:1", video_duration: 8, native_audio: true
  });
  assert.equal("cost_parameter_bindings" in prepared.settings, false);
});

test("O1 Kling T2V POST schema omits its cleared version and native-audio fields", () => {
  const profile = createOwnerKlingT2vProfile("kling_o1_text2video", CATALOG_DIRECTORY);
  const executor = new GenerationContractExecutorV2(profile.registry, profile.catalog);
  const prepared = executor.prepare({
    model_id: profile.modelId,
    operation_id: profile.operationId,
    catalog_version: profile.registry.catalog_version,
    variant_id: profile.variantId,
    parameters: { prompt: "A cinematic mountain landscape.", mode: "hd", aspect_ratio: "9:16", video_duration: 10 }
  });
  assert.deepEqual(prepared.settings, {
    file_urls: [], model_type: "kling_o1_text2video", mode: "hd", aspect_ratio: "9:16", video_duration: 10
  });
  assert.equal("version" in prepared.settings, false);
  assert.equal("native_audio" in prepared.settings, false);
});
