import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import {
  createOwnerSeedance20T2vProfile,
  isAuthenticOwnerSeedance20T2vProfile
} from "../src/application/owner-seedance20-t2v-profile.js";

const ATTEMPT_ID = "link_seedance20_profile_test_00000001";
const CATALOG_DIRECTORY = resolve(process.cwd(), "catalog");
const BASE_REQUEST = {
  attemptId: ATTEMPT_ID,
  prompt: "A yellow duck on a quiet pond.",
  resolution: "720p",
  aspect_ratio: "16:9",
  video_duration: 5,
  generate_audio: true
} as const;

test("Seedance 2.0 profile pins the current source join and keeps defaults and backend proof unknown", () => {
  const profile = createOwnerSeedance20T2vProfile(CATALOG_DIRECTORY);
  assert.equal(isAuthenticOwnerSeedance20T2vProfile(profile), true);
  assert.equal(profile.source.identity.model_id, "seedance-2.0");
  assert.equal(profile.source.identity.ai_name, "seedance");
  assert.equal(profile.source.source_pins.source_build_id, "1791904852");
  assert.equal(profile.source.source_pins.form_sha256,
    "sha256:202056a41201e283af786383beb50d8fdb039eaad4859e26b7ad05c85d852df7");
  assert.deepEqual(profile.source.controls.resolution.values, ["480p", "720p"]);
  assert.deepEqual(profile.source.controls.aspect_ratio.values, ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
  assert.deepEqual(profile.source.cost_projection.public_row_keys, ["video_duration", "duration", "mode", "size", "resolution"]);
  assert.deepEqual(profile.source.cost_projection.caller_keys, ["duration", "mode", "resolution", "size", "video_duration"]);
  assert.deepEqual(profile.source.cost_projection.bindings, {
    video_duration: { kind: "parameter", parameter: "video_duration" },
    duration: { kind: "literal", value: 0 },
    mode: { kind: "literal", value: "mini" },
    size: { kind: "parameter", parameter: "aspect_ratio" },
    resolution: { kind: "parameter", parameter: "resolution" }
  });
  assert.deepEqual(profile.costParameterFields, ["duration", "mode", "resolution", "size", "video_duration"]);
  assert.equal(profile.source.controls.video_duration.min, 4);
  assert.equal(profile.source.controls.video_duration.max, 15);
  assert.equal("camera_fixed" in profile.source.controls, false);
  assert.deepEqual(profile.source.excluded_controls.camera_fixed, {
    visibility: "HIDDEN_FOR_SEEDANCE_2_0",
    visible_condition: "model_type===seedance-1.5-pro",
    model_selection_value: "UNDEFINED"
  });
  assert.equal(profile.source.defaults, "UNKNOWN");
  assert.equal(profile.source.runtime_usable, false);
  assert.equal(profile.source.dispatch_allowed, false);
  assert.equal(profile.source.backend_acceptance, "UNPROVEN");
});

test("Seedance 2.0 mini normalization accepts source choices and rejects references or unsupported controls", () => {
  const profile = createOwnerSeedance20T2vProfile(CATALOG_DIRECTORY);
  for (const candidate of [
    BASE_REQUEST,
    { ...BASE_REQUEST, resolution: "480p", aspect_ratio: "21:9", video_duration: 4, generate_audio: false },
    { ...BASE_REQUEST, aspect_ratio: "9:16", video_duration: 15 }
  ]) {
    const normalized = profile.normalizeGenerationInput(candidate);
    assert.deepEqual(normalized.parameters, {
      prompt: candidate.prompt,
      resolution: candidate.resolution,
      aspect_ratio: candidate.aspect_ratio,
      video_duration: candidate.video_duration,
      generate_audio: candidate.generate_audio,
      mode: "mini"
    });
  }
  for (const invalid of [
    { ...BASE_REQUEST, resolution: "1080p" },
    { ...BASE_REQUEST, video_duration: 3 },
    { ...BASE_REQUEST, video_duration: 16 },
    { ...BASE_REQUEST, mode: "pro" },
    { ...BASE_REQUEST, file_urls: ["https://example.invalid/ref.png"] },
    { ...BASE_REQUEST, generate_audio: undefined },
    { ...BASE_REQUEST, camera_fixed: false }
  ]) {
    assert.throws(() => profile.normalizeGenerationInput(invalid));
  }
});

test("reviewed Seedance 2.0 V2 contract fixes mini/no-reference transport and maps explicit controls", () => {
  const profile = createOwnerSeedance20T2vProfile(CATALOG_DIRECTORY);
  const executor = new GenerationContractExecutorV2(profile.registry, profile.catalog);
  const contract = executor.getContract(profile.modelId, profile.operationId, profile.variantId);
  assert.ok(contract);
  assert.equal(contract.status, "reviewed");
  const prepared = executor.prepare({
    model_id: profile.modelId,
    operation_id: profile.operationId,
    catalog_version: profile.registry.catalog_version,
    variant_id: profile.variantId,
    parameters: {
      prompt: BASE_REQUEST.prompt,
      resolution: BASE_REQUEST.resolution,
      aspect_ratio: BASE_REQUEST.aspect_ratio,
      video_duration: BASE_REQUEST.video_duration,
      generate_audio: BASE_REQUEST.generate_audio,
      mode: "mini"
    }
  });
  assert.equal(prepared.ai_name, "seedance");
  assert.deepEqual(prepared.settings, {
    file_urls: [],
    mode: "mini",
    model_type: "seedance-2.0",
    resolution: "720p",
    aspect_ratio: "16:9",
    video_duration: 5,
    generate_audio: true
  });
  assert.throws(() => executor.prepare({
    model_id: profile.modelId,
    operation_id: profile.operationId,
    catalog_version: profile.registry.catalog_version,
    variant_id: profile.variantId,
    parameters: { prompt: BASE_REQUEST.prompt, resolution: "1080p", aspect_ratio: "16:9", video_duration: 5,
      generate_audio: true }
  }));
});
