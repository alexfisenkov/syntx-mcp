import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOwnerHeygen4Intent } from "../src/application/owner-heygen4-parameters.js";
import { normalizeOwnerActTwoParameters } from "../src/application/owner-acttwo-parameters.js";
import { buildOwnerActTwoWire } from "../src/application/owner-acttwo-wire.js";
import { OWNER_ACTTWO_CURRENT_CONTROLS, OWNER_HEYGEN4_CURRENT_CONTROLS } from "../src/application/owner-actor-current-controls.js";

test("HeyGen current ratio changes semantic fingerprint while omitted/explicit16:9 keep compatibility", () => {
  const input = { attemptId: "link_actor_current_owner_0123456789", prompt: "Preserve supplied subject", image_sha256: "a".repeat(64), image_file_id: "image_1",
    audio_sha256: "b".repeat(64), audio_file_id: "audio_1", duration: 5 };
  const old = normalizeOwnerHeygen4Intent(input), horizontal = normalizeOwnerHeygen4Intent({ ...input, aspect_ratio: "16:9" }), vertical = normalizeOwnerHeygen4Intent({ ...input, aspect_ratio: "9:16" });
  assert.equal(old.aspect_ratio, "16:9"); assert.equal(old.intent_fingerprint, horizontal.intent_fingerprint);
  assert.notEqual(old.intent_fingerprint, vertical.intent_fingerprint); assert.equal(vertical.aspect_ratio, "9:16");
  assert.throws(() => normalizeOwnerHeygen4Intent({ ...input, aspect_ratio: "4:3" }));
  assert.equal(OWNER_HEYGEN4_CURRENT_CONTROLS.build_id, "1793890358");
});
test("ActTwo current expression allows finite manual fractions1..5 and keeps compatibility3", () => {
  const base = { model_id: "acttwo", aspect_ratio: "1:1", video_duration: 10, seed: null };
  assert.equal(normalizeOwnerActTwoParameters(base).source_parameters.expression, 3);
  for (const expression of [1, 2.5, 3, 5]) assert.equal(normalizeOwnerActTwoParameters({ ...base, expression }).source_parameters.expression, expression);
  for (const expression of [0, 6, NaN, Infinity, "3", null]) assert.throws(() => normalizeOwnerActTwoParameters({ ...base, expression }));
  for (const video_duration of [0, -1, 30.001, NaN, Infinity]) assert.throws(() => normalizeOwnerActTwoParameters({ ...base, video_duration }));
  assert.equal(OWNER_ACTTWO_CURRENT_CONTROLS.expression.ui_step, 1); assert.equal(OWNER_ACTTWO_CURRENT_CONTROLS.expression.finite_fractional_manual_input, true);
});
test("ActTwo wire cannot substitute caller duration for captured video measurement and fingerprints expression", () => {
  const input = { model_id: "acttwo", aspect_ratio: "1:1", video_duration: 10, seed: null, expression: 2.5 };
  const captured = { character_image: { url: "https://r2.syntx.ai/current/character.png", sha256: "a".repeat(64), size: 1000, width: 640, height: 640, mime_type: "image/png" },
    performance_video: { url: "https://r2.syntx.ai/current/performance.mp4", sha256: "b".repeat(64), size: 10000, width: 640, height: 480, mime_type: "video/mp4", measured_duration_seconds: 10 } };
  const one = buildOwnerActTwoWire(input, captured), two = buildOwnerActTwoWire({ ...input, expression: 4 }, captured);
  assert.equal(one.wire.settings.video_duration, 10); assert.equal(one.wire.settings.expression, 2.5); assert.notEqual(one.intent_fingerprint, two.intent_fingerprint);
  assert.throws(() => buildOwnerActTwoWire({ ...input, video_duration: 5 }, captured));
  assert.equal(buildOwnerActTwoWire({ ...input, seed: 0 }, captured).wire.settings.seed, 0);
  assert.equal(buildOwnerActTwoWire({ ...input, seed: 2147483647 }, captured).wire.settings.seed, 2147483647);
  assert.notEqual(one.intent_fingerprint, buildOwnerActTwoWire({ ...input, seed: 123 }, captured).intent_fingerprint);
  for (const seed of [-1, 1.5, 2147483648, "3", NaN, Infinity]) assert.throws(() => buildOwnerActTwoWire({ ...input, seed }, captured));
});
