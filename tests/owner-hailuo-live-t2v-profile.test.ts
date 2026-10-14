import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import {
  createOwnerHailuoLiveT2vProfile,
  isAuthenticOwnerHailuoLiveT2vProfile
} from "../src/application/owner-hailuo-live-t2v-profile.js";

const CATALOG_DIRECTORY = resolve(process.cwd(), "catalog");
const ATTEMPT_ID = "link_hailuo_live_profile_test_000001";
const PROMPT = "A sunlit forest path at dawn.";

test("Hailuo-01 Live profile binds the exact current no-reference source and metadata row", () => {
  const profile = createOwnerHailuoLiveT2vProfile(CATALOG_DIRECTORY);
  assert.equal(isAuthenticOwnerHailuoLiveT2vProfile(profile), true);
  assert.equal(profile.modelId, "hailuo-01-live");
  assert.equal(profile.aiName, "hailuo-minimax");
  assert.equal(profile.source.source_pins.source_build_id, "1791904852");
  assert.equal(profile.source.source_pins.form_bytes, 13_501);
  assert.equal(profile.source.source_pins.form_sha256, "sha256:44470e6f7de725746c4fbbee0ddb61cf861629943299ce006f34d0120706d10c");
  assert.deepEqual(profile.source.controls.resolution.values, ["720p"]);
  assert.deepEqual(profile.source.controls.video_duration.values, [6]);
  assert.equal(profile.source.no_reference_source.zero_file_guard_status, "NO_LIVE_VALIDATOR_REQUIRES_FILES");
  assert.equal(profile.source.no_reference_source.public_uploadable, true);
  assert.equal(profile.source.no_reference_source.public_file_count_limit, 1);
  assert.deepEqual(profile.source.cost_projection.caller_keys, ["resolution", "video_duration"]);
  assert.equal(profile.source.defaults, "UNKNOWN");
  assert.equal(profile.source.runtime_usable, false);
  assert.equal(profile.source.dispatch_allowed, false);
  assert.equal(profile.source.backend_acceptance, "UNPROVEN");
});

test("Hailuo-01 Live normalizer accepts only the source-mapped empty-file pair", () => {
  const profile = createOwnerHailuoLiveT2vProfile(CATALOG_DIRECTORY);
  const normalized = profile.normalizeGenerationInput({ attemptId: ATTEMPT_ID, prompt: PROMPT, resolution: "720p", video_duration: 6 });
  assert.deepEqual(normalized.parameters, { prompt: PROMPT, resolution: "720p", video_duration: 6 });
  assert.deepEqual(normalized.semanticIntent, { prompt: PROMPT, resolution: "720p", video_duration: 6 });
  for (const invalid of [
    { resolution: "768p", video_duration: 6 },
    { resolution: "720p", video_duration: 10 },
    { resolution: "512p", video_duration: 6 },
    { resolution: "720p", video_duration: 6, file_urls: [] },
    { resolution: "720p", video_duration: 6, aspect_ratio: "16:9" }
  ]) {
    assert.throws(() => profile.normalizeGenerationInput({ attemptId: ATTEMPT_ID, prompt: PROMPT, ...invalid }));
  }
});

test("Hailuo-01 Live reviewed contract sends only prompt, model settings, and empty file_urls", () => {
  const profile = createOwnerHailuoLiveT2vProfile(CATALOG_DIRECTORY);
  const executor = new GenerationContractExecutorV2(profile.registry, profile.catalog);
  const prepared = executor.prepare({
    model_id: profile.modelId,
    operation_id: profile.operationId,
    catalog_version: profile.registry.catalog_version,
    variant_id: profile.variantId,
    parameters: { prompt: PROMPT, resolution: "720p", video_duration: 6 }
  });
  assert.equal(prepared.ai_name, "hailuo-minimax");
  assert.deepEqual(prepared.settings, {
    file_urls: [], model_type: "hailuo-01-live", resolution: "720p", video_duration: 6
  });
});
