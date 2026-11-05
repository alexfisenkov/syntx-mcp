import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOwnerVideo2AudioCurrentControls as normalize, OWNER_VIDEO2AUDIO_CURRENT_CONTROLS as source } from "../src/application/owner-video2audio-current-controls.js";

test("Video2Audio current controls preserve historical omission and distinguish explicit random seed", () => {
  assert.deepEqual(normalize(undefined, undefined), { seed: 0, negative_prompt: "" });
  assert.deepEqual(normalize(0, undefined), { seed: 0, negative_prompt: "" });
  assert.deepEqual(normalize(null, ""), { seed: null, negative_prompt: "" });
  assert.deepEqual(normalize(1, " no noise 🌙 "), { seed: 1, negative_prompt: " no noise 🌙 " });
  assert.equal(normalize(2147483647, "x".repeat(5000)).seed, 2147483647);
});
test("Video2Audio current controls reject out-of-bound seeds and malformed/local-oversized negative text", () => {
  for (const seed of [-1, 1.1, NaN, Infinity, 2147483648, "1", {}, true]) assert.throws(() => normalize(seed, ""));
  for (const text of [null, {}, "x".repeat(5001), "\ud800", "bad\u0000value"]) assert.throws(() => normalize(1, text));
});
test("Video2Audio current controls identify current public source separately from provider/default claims", () => {
  assert.equal(source.build_id, "1793890358"); assert.equal(source.seed.omitted, "LEGACY_ZERO_COMPATIBILITY");
  assert.equal(source.negative_prompt.ui_maximum, "UNSPECIFIED"); assert.equal(source.negative_prompt.local_maximum_utf16, 5000);
  assert.equal(source.provider_acceptance, "UNPROVEN"); assert.equal(Object.isFrozen(source.seed), true);
});
