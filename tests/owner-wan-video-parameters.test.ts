import test from "node:test";
import assert from "node:assert/strict";
import {
  getOwnerWanVideoSourceParameters,
  normalizeOwnerWanVideoParameters,
  OwnerWanVideoParametersError,
  projectOwnerWanVideoWireSettings
} from "../src/application/owner-wan-video-parameters.js";

const MODEL_IDS = [
  "wan_25_i2v_preview", "wan_25_t2v_preview", "wan_26_i2v", "wan_26_i2v_flash",
  "wan_26_r2v", "wan_26_r2v_flash", "wan_26_t2v", "wan_27_i2v", "wan_27_r2v",
  "wan_27_t2v", "wan_27_videoedit"
] as const;

test("source report keeps all active C5 WAN IDs and cost-key declarations separate from cost claims", () => {
  const report = getOwnerWanVideoSourceParameters();
  assert.deepEqual(report.models.map((model) => model.model_id), MODEL_IDS);
  assert.equal(report.source_pins.public_catalog_version,
    "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json");
  assert.equal(report.source_pins.settings_inventory_version,
    "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json");
  assert.equal(report.source_pins.form_sha256,
    "sha256:aae2be04ca8a814db7dfb93717a234f55922b4b9f0ebc3eccd517c9d82f46119");
  assert.equal(report.source_pins.ratio_candidate_public_catalog_version,
    "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json");
  assert.equal(report.source_pins.ratio_candidate_settings_inventory_version,
    "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json");
  assert.deepEqual(report.models.find((model) => model.model_id === "wan_26_r2v")?.cost_input_keys,
    ["resolution", "video_duration", "duration"]);
  assert.deepEqual(report.models.find((model) => model.model_id === "wan_26_r2v_flash")?.cost_input_keys,
    ["resolution", "video_duration", "native_audio", "duration"]);
  assert.equal(report.models.find((model) => model.model_id === "wan_25_t2v_preview")?.operation_family_candidate,
    "audio_conditioned_t2v_candidate");
  assert.equal(report.models.find((model) => model.model_id === "wan_26_t2v")?.operation_family_candidate, "t2v");
  assert.equal(report.models.find((model) => model.model_id === "wan_27_videoedit")?.operation_family_candidate, "videoedit");
  assert.equal(report.effective_defaults, "UNKNOWN");
  assert.equal(report.dispatch_allowed, false);
  assert.equal(report.backend_acceptance, "UNPROVEN");
  assert.ok(report.unproven_controls.includes("video_duration"));
  assert.ok(report.unproven_controls.includes("file_urls"));
  assert.ok(Object.isFrozen(report) && Object.isFrozen(report.models));
});

test("strictly validates only the source-backed resolution and conditional ratio pair", () => {
  const normalized = normalizeOwnerWanVideoParameters({
    model_id: "wan_25_i2v_preview",
    parameters: { resolution: "480P", aspect_ratio: "9:16" }
  });
  assert.deepEqual(normalized.parameters, { resolution: "480P", aspect_ratio: "9:16" });
  assert.equal(normalized.operation_family_candidate, "i2v");
  assert.deepEqual(normalized.cost_input_keys, ["resolution", "video_duration"]);
  assert.deepEqual(projectOwnerWanVideoWireSettings(normalized), {
    settings_candidate: { resolution: "480P", aspect_ratio: "9:16" },
    mapping_status: "PARTIAL_STATIC_SOURCE_CANDIDATE",
    runtime_usable: false,
    backend_acceptance: "UNPROVEN"
  });
  assert.equal("prompt" in normalized, false);
  assert.equal("model_type" in normalized, false);
  assert.equal(normalized.dispatch_allowed, false);
  assert.equal(normalized.runtime_usable, false);
  assert.equal(normalized.backend_acceptance, "UNPROVEN");
});

test("ratio branch rejects an unsupported 480P ratio and 480P outside preview models", () => {
  const error = (input: unknown) => assert.throws(() => normalizeOwnerWanVideoParameters(input), OwnerWanVideoParametersError);
  error({ model_id: "wan_25_t2v_preview", parameters: { resolution: "480P", aspect_ratio: "4:3" } });
  error({ model_id: "wan_26_i2v", parameters: { resolution: "480P", aspect_ratio: "16:9" } });
  error({ model_id: "wan_27_t2v", parameters: { resolution: "720P", aspect_ratio: "2:3" } });
  error({ model_id: "wan_27_videoedit", parameters: { resolution: "720P", aspect_ratio: "16:9", seed: 5 } });
  error({ model_id: "wan_24_t2v", parameters: { resolution: "720P", aspect_ratio: "16:9" } });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  error(revoked.proxy);
});

test("all model families remain distinct candidate labels without importing runtime presets", () => {
  const input = (model_id: string) => ({ model_id, parameters: { resolution: "720P", aspect_ratio: "16:9" } });
  const family = (model_id: string) => normalizeOwnerWanVideoParameters(input(model_id)).operation_family_candidate;
  assert.equal(family("wan_26_t2v"), "t2v");
  assert.equal(family("wan_27_t2v"), "t2v");
  assert.equal(family("wan_25_t2v_preview"), "audio_conditioned_t2v_candidate");
  assert.equal(family("wan_26_i2v"), "i2v");
  assert.equal(family("wan_26_r2v"), "r2v");
  assert.equal(family("wan_27_videoedit"), "videoedit");
});
