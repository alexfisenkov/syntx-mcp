import assert from "node:assert/strict";
import test from "node:test";
import { GenerationContractExecutor } from "../src/adapter/syntx/generation-contract-executor.js";
import { createReviewedContractPreflight } from "../src/application/reviewed-contract-preflight.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { loadGenerationContractRegistry } from "../src/catalog/generation-contract-history.js";

test("reviewed contract preflight returns the exact prepared media request after subscription verification", async () => {
  const registry = loadGenerationContractRegistry(
    "sha256-0a82b91685746f4aeec1b0ba4e24fccdc21532d4e3feac85969e55302b463d45.json"
  );
  const executor = new GenerationContractExecutor(registry, loadSelectedDiscoveryCatalog().discoveryCatalog);
  const subscriptionAttempts: string[] = [];
  const preflight = createReviewedContractPreflight({
    executor,
    resolveSubscription: async (attemptId) => {
      subscriptionAttempts.push(attemptId);
      return { active: true, plan_type: "Elite", end_date: null, end_date_kind: null };
    }
  });
  const request = {
    model_id: "banana-2.1",
    operation_id: "generate-image",
    catalog_version: registry.catalog_version,
    parameters: { prompt: "synthetic prepared helper test", file_urls: [] }
  } as const;

  const prepared = await preflight("link_exact_preflight_attempt_0001", request);

  assert.deepEqual(subscriptionAttempts, ["link_exact_preflight_attempt_0001"]);
  assert.deepEqual(prepared, {
    prompt: "synthetic prepared helper test",
    settings: {
      aspect_ratio: "1:1",
      image_size: "1K",
      n: 1,
      thinking_level: "minimal",
      file_urls: [],
      model_type: "banana-2.1"
    },
    ai_name: "banana",
    modality: "image",
    schema_hash: "sha256:169b5e8a1f5c6222c00a402a9d0ef68d600623f399521aaa2039318f0ad2f12a"
  });
});
