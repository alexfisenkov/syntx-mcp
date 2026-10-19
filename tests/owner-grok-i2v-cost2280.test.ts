import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  OWNER_GROK_I2V_RUNTIME_CATALOG_VERSION,
  buildOwnerGrokI2vCostParameters,
  loadOwnerGrokI2vRuntimeCatalog
} from "../src/application/owner-grok-i2v-cost.js";

const CATALOG_DIRECTORY = join(process.cwd(), "catalog");
const MODEL_IDS = ["grok_i2v", "grok_15_i2v"] as const;

test("2280 loads the pinned offline catalog by model value and binds both exact cost-key sets", () => {
  const path = join(CATALOG_DIRECTORY, "public", OWNER_GROK_I2V_RUNTIME_CATALOG_VERSION);
  const before = statSync(path);
  const originalFetch = globalThis.fetch; let networkCalls = 0;
  globalThis.fetch = (async () => { networkCalls += 1; throw new Error("network forbidden"); }) as typeof fetch;
  try {
    const runtime = loadOwnerGrokI2vRuntimeCatalog(CATALOG_DIRECTORY);
    assert.ok(runtime.catalog instanceof DiscoveryCatalogRepository);
    assert.equal(runtime.catalog_version, OWNER_GROK_I2V_RUNTIME_CATALOG_VERSION);
    assert.deepEqual(runtime.cost_bindings, MODEL_IDS.map((model_id) => ({ model_id, model_type: model_id,
      ai_name: "grok_video", form_id: "grok-video", scope: "video", cost_keys: ["resolution", "video_duration"] })));
    for (const value of MODEL_IDS) {
      const model = runtime.catalog.get(value);
      assert.equal(model.id, value); assert.equal(model.upstream_id, value);
      assert.equal(model.active, true); assert.equal(model.ai_name, "grok_video");
      assert.deepEqual([...model.settings!.get_cost_params!].sort(), ["resolution", "video_duration"]);
    }
    const snapshot = loadPublicCatalogVersion(OWNER_GROK_I2V_RUNTIME_CATALOG_VERSION, CATALOG_DIRECTORY);
    assert.equal(snapshot.ai.find((entry) => entry.value === "grok_video")?.scope, "video");
    assert.equal(networkCalls, 0); assert.equal(Object.isFrozen(runtime), true);
    assert.equal(Object.isFrozen(runtime.cost_bindings), true);
  } finally { globalThis.fetch = originalFetch; }
  const after = statSync(path);
  assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
});

test("2280 projects only resolution and numeric model-specific video duration", () => {
  for (const resolution of ["480p", "720p"] as const) {
    for (const video_duration of [6, 10] as const) {
      const result = buildOwnerGrokI2vCostParameters({ model_id: "grok_i2v", video_duration, resolution });
      assert.deepEqual(result.cost_inputs, { resolution, video_duration });
      assert.deepEqual(Object.keys(result.cost_inputs), ["resolution", "video_duration"]);
      assert.deepEqual(result.routing, { ai_name: "grok_video", model_type: "grok_i2v" });
    }
    for (const video_duration of [1, 15] as const) {
      const result = buildOwnerGrokI2vCostParameters({ model_id: "grok_15_i2v", video_duration, resolution });
      assert.deepEqual(result.cost_inputs, { resolution, video_duration });
      assert.deepEqual(Object.keys(result.cost_inputs), ["resolution", "video_duration"]);
    }
  }
});

test("2280 rejects invalid model-specific durations and extra cost query keys", () => {
  for (const invalid of [
    { model_id: "grok_i2v", video_duration: 1, resolution: "480p" },
    { model_id: "grok_i2v", video_duration: 8, resolution: "480p" },
    { model_id: "grok_15_i2v", video_duration: 16, resolution: "480p" },
    { model_id: "grok_15_i2v", video_duration: 1.2, resolution: "480p" },
    { model_id: "grok_i2v", video_duration: 6, resolution: "1080p" },
    { model_id: "grok_i2v", video_duration: 6, resolution: "480p", prompt: "extra" },
    { model_id: "grok-video", video_duration: 6, resolution: "480p" },
    { model_id: "grok_i2v", video_duration: "6", resolution: "480p" }
  ]) assert.throws(() => buildOwnerGrokI2vCostParameters(invalid));
});
