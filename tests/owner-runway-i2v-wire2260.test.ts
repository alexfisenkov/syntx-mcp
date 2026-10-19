import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerRunwayI2vWire } from "../src/application/owner-runway-i2v-wire.js";
import { normalizeOwnerRunwayI2vParameters } from "../src/application/owner-runway-i2v-parameters.js";

const URL_A = "https://r2.syntx.ai/runway-i2v/private/frame-a.png";
const URL_B = "https://r2.syntx.ai/runway-i2v/private/frame-b.png";
const IMAGE = Object.freeze({ url: URL_A, sha256: "a".repeat(64), width: 384, height: 384 });
function parameters(overrides: Readonly<Record<string, unknown>> = {}) {
  return { model_id: "4genfirstframeimage", prompt: "A quiet cinematic shot.", aspect_ratio: "1:1", video_duration: 5, seed: null, ...overrides };
}
function wire(input: unknown = parameters(), image: unknown = IMAGE) { return buildOwnerRunwayI2vWire(input, image); }

test("2260 maps explicit Runway intent and one captured image to exact video wire", () => {
  const normalized = normalizeOwnerRunwayI2vParameters(parameters({ aspect_ratio: "16:9", video_duration: 10 }));
  const candidate = wire(parameters({ aspect_ratio: "16:9", video_duration: 10 }), { ...IMAGE, width: 384, height: 216 });
  assert.deepEqual(candidate.wire, {
    ai_name: "runway",
    prompt: "A quiet cinematic shot.",
    settings: {
      model_type: "4genfirstframeimage", aspect_ratio: "169", video_duration: "10.0", seed: null,
      file_urls: [{ type: "image", url: URL_A }]
    }
  });
  assert.equal(candidate.model_id, normalized.intent.model_id);
  assert.equal(candidate.profile_sha256, normalized.profile_sha256);
  assert.equal(candidate.dispatch_allowed, false);
  assert.equal(candidate.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(candidate), true); assert.equal(Object.isFrozen(candidate.wire), true);
  assert.equal(Object.isFrozen(candidate.wire.settings.file_urls), true);
  assert.equal("n" in candidate.wire.settings, false);
  assert.equal("expression" in candidate.wire.settings, false);
  assert.equal("source_url" in candidate, false);
});

test("2260 binds both explicit models and all supported ratios without leaking URL into intent fingerprint", () => {
  for (const model_id of ["4genfirstframeimage", "turbo4genfirstframeimage"]) {
    for (const [aspect_ratio, width, height] of [["21:9", 420, 180], ["16:9", 384, 216], ["4:3", 384, 288],
      ["1:1", 384, 384], ["3:4", 288, 384], ["9:16", 216, 384]] as const) {
      const controls = parameters({ model_id, aspect_ratio, video_duration: 5 });
      const first = wire(controls, { ...IMAGE, url: URL_A, width, height });
      const second = wire(controls, { ...IMAGE, url: URL_B, width, height });
      assert.equal(first.intent_fingerprint, second.intent_fingerprint);
      assert.notEqual(first.wire_fingerprint, second.wire_fingerprint);
      assert.equal(first.wire.settings.model_type, model_id);
    }
  }
});

test("2260 rejects unsafe or mismatched captured image data and malformed records", () => {
  for (const image of [
    { ...IMAGE, url: "https://example.invalid/private.png" },
    { ...IMAGE, sha256: "not-a-digest" },
    { ...IMAGE, width: 384, height: 216 },
    { ...IMAGE, width: Number.POSITIVE_INFINITY },
    { ...IMAGE, extra: "unexpected" }
  ]) assert.throws(() => wire(parameters(), image), { code: "INVALID_WIRE_CANDIDATE" });
  const accessor = { ...IMAGE };
  Object.defineProperty(accessor, "sha256", { enumerable: true, get: () => { throw new Error("must not run"); } });
  assert.throws(() => wire(parameters(), accessor), { code: "INVALID_WIRE_CANDIDATE" });
  assert.throws(() => wire(parameters({ model_id: "runway_frames" })), { code: "INVALID_WIRE_CANDIDATE" });
});
