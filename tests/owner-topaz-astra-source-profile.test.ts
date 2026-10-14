import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerTopazAstraSourceProfile,
  OWNER_TOPAZ_ASTRA_MODEL_IDS
} from "../src/application/owner-topaz-astra-source-profile.js";

test("Topaz Astra source profile pins the four B066 IDs to the current video wire", () => {
  assert.deepEqual(OWNER_TOPAZ_ASTRA_MODEL_IDS, ["slc-1", "slf-2", "slp-2", "slp-2.5"]);
  for (const modelId of OWNER_TOPAZ_ASTRA_MODEL_IDS) {
    const profile = getOwnerTopazAstraSourceProfile(modelId);
    assert.ok(profile);
    assert.equal(profile.model_id, modelId);
    assert.equal(profile.ai_name, "topaz_astra");
    assert.equal(profile.source_pins.source_build_id, "1791904852");
    assert.equal(profile.wire.method, "POST");
    assert.equal(profile.wire.path, "video/generate");
    assert.deepEqual(profile.wire.query, { ai_name: "topaz_astra" });
    assert.deepEqual(profile.wire.body_fields, ["chat_id", "prompt", "settings"]);
    assert.equal(profile.runtime_usable, false);
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
  }
  assert.equal(getOwnerTopazAstraSourceProfile("topaz_enhance"), undefined);
});

test("Topaz Astra profile keeps observed controls and per-model file bounds explicit", () => {
  const slc = getOwnerTopazAstraSourceProfile("slc-1");
  const slf = getOwnerTopazAstraSourceProfile("slf-2");
  const slp2 = getOwnerTopazAstraSourceProfile("slp-2");
  const slp25 = getOwnerTopazAstraSourceProfile("slp-2.5");
  assert.ok(slc && slf && slp2 && slp25);
  assert.deepEqual(slc.controls.resolution.values, ["1920x1080", "3840x2160"]);
  assert.deepEqual(slc.controls.frame_rate.values, [24, 30, 60, 120]);
  assert.deepEqual(slc.controls.slowmo.values, [null, 2, 3, 4, 6, 8, 10, 12, 16]);
  assert.deepEqual(slc.controls.creativity.values, ["low", "middle", "high"]);
  for (const profile of [slc, slf, slp2, slp25]) {
    assert.deepEqual(profile.input.accepted_file_types, ["video/mp4", "video/quicktime"]);
    assert.equal(profile.input.file_count_limit, 1);
    assert.equal(profile.input.max_file_size_bytes, 52_428_800);
    assert.equal(profile.input.max_video_duration_seconds, 25);
    assert.equal(profile.controls.conditional_combinations, "UNRESOLVED");
  }
  assert.equal(slc.input.max_frame_count, 450);
  assert.equal(slp2.input.max_frame_count, 450);
  assert.equal(slf.input.max_frame_count, 9_000);
  assert.equal(slp25.input.max_frame_count, 9_000);
});

test("Topaz Astra source profile returns a deeply frozen source-evidence graph", () => {
  const profile = getOwnerTopazAstraSourceProfile("slc-1");
  assert.ok(profile);
  for (const value of [
    OWNER_TOPAZ_ASTRA_MODEL_IDS,
    profile,
    profile.source_pins,
    profile.source_pins.modules,
    profile.controls,
    profile.controls.model_type,
    profile.controls.model_type.candidate_values,
    profile.controls.model_type.literal_values_in_current_form,
    profile.controls.resolution,
    profile.controls.resolution.values,
    profile.controls.frame_rate,
    profile.controls.frame_rate.values,
    profile.controls.slowmo,
    profile.controls.slowmo.values,
    profile.controls.creativity,
    profile.controls.creativity.values,
    profile.input,
    profile.input.accepted_file_types,
    profile.input.file_url_item,
    profile.wire,
    profile.wire.query,
    profile.wire.body_fields,
    profile.wire.fixed_settings_candidate,
    profile.wire.observed_settings_fields,
    profile.upload_wire,
    profile.upload_wire.fields,
    profile.cost,
    profile.cost.public_cost_keys,
    profile.result,
    profile.result.conservative_local_gate
  ]) assert.equal(Object.isFrozen(value), true);
  assert.equal(Reflect.set(profile.controls.resolution.values, "0", "999x999"), false);
  assert.equal(Reflect.set(profile.source_pins.modules, "topaz_astra", "changed"), false);
});
