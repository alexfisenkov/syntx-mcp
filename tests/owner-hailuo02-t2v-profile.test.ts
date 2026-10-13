import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import {
  createOwnerHailuo02T2vProfile,
  isAuthenticOwnerHailuo02T2vProfile
} from "../src/application/owner-hailuo02-t2v-profile.js";

const ATTEMPT_ID = "link_hailuo02_profile_test_00000001";
const CATALOG_DIRECTORY = resolve(process.cwd(), "catalog");
const EXPECTED_PAIRS = [
  { resolution: "768p", video_duration: 6 },
  { resolution: "768p", video_duration: 10 },
  { resolution: "1080p", video_duration: 6 }
] as const;

test("Hailuo 02 profile binds the current source and only no-reference pairs", () => {
  const profile = createOwnerHailuo02T2vProfile(CATALOG_DIRECTORY);
  assert.equal(isAuthenticOwnerHailuo02T2vProfile(profile), true);
  assert.equal(profile.source.identity.model_id, "hailuo-02");
  assert.equal(profile.source.identity.ai_name, "hailuo-minimax");
  assert.equal(profile.source.source_pins.source_build_id, "1791904852");
  assert.deepEqual(profile.source.controls.valid_pairs, EXPECTED_PAIRS);
  assert.deepEqual(profile.source.cost_projection.caller_keys, ["resolution", "video_duration"]);
  assert.deepEqual(profile.source.cost_projection.transport_owned_keys, ["model_type"]);
  assert.equal(profile.source.controls.prompt.source_max_length, "UNKNOWN");
  assert.equal(profile.source.defaults, "UNKNOWN");
  assert.equal(profile.source.runtime_usable, false);
  assert.equal(profile.source.dispatch_allowed, false);
  assert.equal(profile.source.backend_acceptance, "UNPROVEN");
});

test("Hailuo 02 normalizer admits only the three source-closed no-reference pairs", () => {
  const profile = createOwnerHailuo02T2vProfile(CATALOG_DIRECTORY);
  for (const pair of EXPECTED_PAIRS) {
    const prompt = "A yellow duck on a quiet pond.";
    const normalized = profile.normalizeGenerationInput({ attemptId: ATTEMPT_ID, prompt, ...pair });
    assert.deepEqual(normalized.parameters, { prompt, ...pair });
    assert.deepEqual(normalized.semanticIntent, { prompt, ...pair });
  }
  for (const invalid of [
    { resolution: "512p", video_duration: 6 },
    { resolution: "512p", video_duration: 10 },
    { resolution: "1080p", video_duration: 10 },
    { resolution: "768p", video_duration: 5 },
    { resolution: "768p", video_duration: 6, mode: "standard" }
  ]) {
    assert.throws(() => profile.normalizeGenerationInput({
      attemptId: ATTEMPT_ID, prompt: "A yellow duck on a quiet pond.", ...invalid
    }));
  }
});

test("Hailuo 02 reviewed V2 contract preserves exact no-reference payload fields", () => {
  const profile = createOwnerHailuo02T2vProfile(CATALOG_DIRECTORY);
  const executor = new GenerationContractExecutorV2(profile.registry, profile.catalog);
  const contract = executor.getContract(profile.modelId, profile.operationId, profile.variantId);
  assert.ok(contract);
  assert.equal(contract.status, "reviewed");
  for (const pair of EXPECTED_PAIRS) {
    const prepared = executor.prepare({
      model_id: "hailuo-02",
      operation_id: "generate-video",
      catalog_version: profile.registry.catalog_version,
      variant_id: profile.variantId,
      parameters: { prompt: "A yellow duck on a quiet pond.", ...pair }
    });
    assert.equal(prepared.ai_name, "hailuo-minimax");
    assert.deepEqual(prepared.settings, {
      file_urls: [], model_type: "hailuo-02", resolution: pair.resolution, video_duration: pair.video_duration
    });
  }
  assert.throws(() => executor.prepare({
    model_id: "hailuo-02",
    operation_id: "generate-video",
    catalog_version: profile.registry.catalog_version,
    variant_id: profile.variantId,
    parameters: { prompt: "A yellow duck on a quiet pond.", resolution: "512p", video_duration: 6 }
  }));
});
