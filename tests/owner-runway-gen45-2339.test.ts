import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerRunwayI2vCostParameters, loadOwnerRunwayI2vRuntimeCatalog } from "../src/application/owner-runway-i2v-cost.js";
import { buildOwnerRunwayI2vWire } from "../src/application/owner-runway-i2v-wire.js";
import { getOwnerRunwayI2vSourceProfile, normalizeOwnerRunwayI2vParameters } from "../src/application/owner-runway-i2v-parameters.js";

const reference = Object.freeze({ url: "https://r2.syntx.ai/runway-gen45-2339/frame.png", sha256: "a".repeat(64), width: 1_280, height: 720 });
function selection(model_id: string, aspect_ratio: string, video_duration: number): unknown {
  return { model_id, prompt: "Animate one already-cropped frame.", aspect_ratio, video_duration, seed: null };
}

test("2339 Gen4.5 uses source-derived 16:9 and string durations while legacy IDs keep their prior tuples", () => {
  const profile = getOwnerRunwayI2vSourceProfile();
  assert.deepEqual(profile.model_ids, ["4genfirstframeimage", "turbo4genfirstframeimage", "gen4.5i2v"]);
  assert.deepEqual(profile.legacy_model_ids, ["4genfirstframeimage", "turbo4genfirstframeimage"]);
  assert.deepEqual(profile.model_controls["gen4.5i2v"].aspect_ratios, ["16:9"]);
  assert.deepEqual(profile.model_controls["gen4.5i2v"].video_duration_source_values, ["5.0", "8.0", "10.0"]);

  for (const [seconds, source] of [[5, "5.0"], [8, "8.0"], [10, "10.0"]] as const) {
    const normalized = normalizeOwnerRunwayI2vParameters(selection("gen4.5i2v", "16:9", seconds));
    assert.equal(normalized.source_parameters.model_type, "gen4.5i2v");
    assert.equal(normalized.source_parameters.aspect_ratio, "169");
    assert.equal(normalized.source_parameters.video_duration, source);
    assert.deepEqual(buildOwnerRunwayI2vCostParameters({ model_id: "gen4.5i2v", video_duration: seconds }), { video_duration: source });
    assert.deepEqual(buildOwnerRunwayI2vWire(selection("gen4.5i2v", "16:9", seconds), reference).wire.settings,
      { model_type: "gen4.5i2v", aspect_ratio: "169", video_duration: source, seed: null, file_urls: [{ type: "image", url: reference.url }] });
  }
  for (const ratio of ["21:9", "4:3", "1:1", "3:4", "9:16"]) assert.throws(() => normalizeOwnerRunwayI2vParameters(selection("gen4.5i2v", ratio, 5)));

  for (const model of ["4genfirstframeimage", "turbo4genfirstframeimage"]) {
    for (const ratio of ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]) {
      for (const seconds of [5, 10]) assert.doesNotThrow(() => normalizeOwnerRunwayI2vParameters(selection(model, ratio, seconds)));
    }
    assert.throws(() => normalizeOwnerRunwayI2vParameters(selection(model, "16:9", 8)));
    assert.throws(() => buildOwnerRunwayI2vCostParameters({ model_id: model as "4genfirstframeimage", video_duration: 8 }));
  }
  const catalog = loadOwnerRunwayI2vRuntimeCatalog();
  assert.deepEqual(catalog.cost_bindings.find(item => item.model_id === "gen4.5i2v")?.cost_keys, ["video_duration"]);
});
