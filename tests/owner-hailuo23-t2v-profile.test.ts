import assert from "node:assert/strict";
import test from "node:test";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import {
  createOwnerHailuo23T2vProfile,
  isAuthenticOwnerHailuo23T2vProfile
} from "../src/application/owner-hailuo23-t2v-profile.js";

const ATTEMPT_ID = "link_hailuo23_profile_test_00000001";
const EXPECTED_PAIRS = [
  { resolution: "768p", video_duration: 6 },
  { resolution: "768p", video_duration: 10 },
  { resolution: "1080p", video_duration: 6 }
] as const;

test("Hailuo 2.3 profile pins B066/1b48 and distinguishes the one UI-observed pair from reviewed choices", () => {
  const profile = createOwnerHailuo23T2vProfile();
  assert.equal(isAuthenticOwnerHailuo23T2vProfile(profile), true);
  assert.equal(profile.source.identity.model_id, "hailuo-2.3");
  assert.equal(profile.source.identity.ai_name, "hailuo-minimax");
  assert.deepEqual(profile.source.controls.valid_pairs, EXPECTED_PAIRS);
  assert.deepEqual(profile.source.ui_observation.provider_verified_pair, { resolution: "768p", video_duration: 6 });
  assert.equal(profile.source.ui_observation.other_pairs_status, "SOURCE_REVIEWED_NOT_PROVIDER_VERIFIED");
  assert.equal(profile.source.controls.prompt.source_max_length, "UNKNOWN");
  assert.equal(profile.source.defaults, "UNKNOWN");
  assert.equal(profile.source.runtime_usable, false);
  assert.equal(profile.source.dispatch_allowed, false);
  assert.equal(profile.source.backend_acceptance, "UNPROVEN");
});

test("Hailuo 2.3 input normalization admits exactly three source-reviewed resolution-duration pairs", () => {
  const profile = createOwnerHailuo23T2vProfile();
  for (const pair of EXPECTED_PAIRS) {
    const normalized = profile.normalizeGenerationInput({ attemptId: ATTEMPT_ID, prompt: "A yellow duck on a quiet pond.", ...pair });
    assert.deepEqual(normalized.parameters, { prompt: "A yellow duck on a quiet pond.", ...pair });
    assert.deepEqual(normalized.semanticIntent, { prompt: "A yellow duck on a quiet pond.", ...pair });
  }
  for (const invalid of [
    { resolution: "1080p", video_duration: 10 },
    { resolution: "512p", video_duration: 6 },
    { resolution: "768p", video_duration: 5 },
    { resolution: "768p", video_duration: 12 },
    { resolution: "768p", video_duration: 6, mode: "standard" }
  ]) {
    assert.throws(() => profile.normalizeGenerationInput({
      attemptId: ATTEMPT_ID, prompt: "A yellow duck on a quiet pond.", ...invalid
    }));
  }
});

test("reviewed Hailuo 2.3 V2 contract enforces the same pair relation and exact wire settings", () => {
  const profile = createOwnerHailuo23T2vProfile();
  const executor = new GenerationContractExecutorV2(profile.registry, profile.catalog);
  const contract = executor.getContract(profile.modelId, profile.operationId, profile.variantId);
  assert.ok(contract);
  assert.equal(contract.status, "reviewed");
  for (const pair of EXPECTED_PAIRS) {
    const prepared = executor.prepare({ model_id: "hailuo-2.3", operation_id: "generate-video",
      catalog_version: profile.registry.catalog_version, variant_id: profile.variantId,
      parameters: { prompt: "A yellow duck on a quiet pond.", ...pair } });
    assert.equal(prepared.ai_name, "hailuo-minimax");
    assert.deepEqual(prepared.settings, { file_urls: [], resolution: pair.resolution,
      video_duration: pair.video_duration, model_type: "hailuo-2.3" });
  }
  assert.throws(() => executor.prepare({ model_id: "hailuo-2.3", operation_id: "generate-video",
    catalog_version: profile.registry.catalog_version, variant_id: profile.variantId,
    parameters: { prompt: "A yellow duck on a quiet pond.", resolution: "1080p", video_duration: 10 } }));
});
