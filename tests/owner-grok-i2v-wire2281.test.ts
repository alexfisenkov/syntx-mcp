import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerGrokI2vWire } from "../src/application/owner-grok-i2v-wire.js";
import { normalizeOwnerGrokI2vParameters } from "../src/application/owner-grok-i2v-parameters.js";

const URL_A = "https://r2.syntx.ai/grok-i2v/private/frame-a.png";
const URL_B = "https://r2.syntx.ai/grok-i2v/private/frame-b.png";
const IMAGE = Object.freeze({ url: URL_A, sha256: "a".repeat(64), width: 160, height: 90 });
function parameters(overrides: Readonly<Record<string, unknown>> = {}) {
  return { model_id: "grok_i2v", prompt: "A slow cinematic move.", aspect_ratio: "16:9", video_duration: 6, resolution: "480p", ...overrides };
}
function candidate(input: unknown = parameters(), image: unknown = IMAGE) { return buildOwnerGrokI2vWire(input, image); }

test("2281 maps the explicit Grok I2V tuple and one captured image into the exact source-only wire", () => {
  const normalized = normalizeOwnerGrokI2vParameters(parameters());
  const built = candidate();
  assert.deepEqual(built.wire, {
    ai_name: "grok_video", prompt: "A slow cinematic move.",
    settings: {
      model_type: "grok_i2v", aspect_ratio: "16:9", video_duration: 6, resolution: "480p",
      file_urls: [{ type: "image", url: URL_A }]
    }
  });
  assert.equal(built.profile_sha256, normalized.profile_sha256);
  assert.equal(built.model_id, normalized.intent.model_id);
  assert.equal(built.dispatch_allowed, false); assert.equal(built.backend_acceptance, "UNPROVEN");
  assert.equal(built.reference_binding, "ONE_CAPTURED_IMAGE");
  assert.equal(Object.isFrozen(built), true); assert.equal(Object.isFrozen(built.wire.settings.file_urls), true);
  for (const forbidden of ["seed", "n", "root_files", "source_url"]) {
    assert.equal(forbidden in built.wire.settings, false); assert.equal(forbidden in built, false);
  }
});

test("2281 binds both model profiles and excludes signed URL from semantic intent", () => {
  const inputs = [parameters({ model_id: "grok_i2v", video_duration: 10, aspect_ratio: "16:9" }),
    parameters({ model_id: "grok_15_i2v", aspect_ratio: "1:1", video_duration: 15, resolution: "720p" })];
  const images = [IMAGE, { ...IMAGE, width: 90, height: 90 }];
  for (let index = 0; index < inputs.length; index += 1) {
    const first = candidate(inputs[index], { ...images[index]!, url: URL_A });
    const second = candidate(inputs[index], { ...images[index]!, url: URL_B });
    assert.equal(first.intent_fingerprint, second.intent_fingerprint);
    assert.notEqual(first.wire_fingerprint, second.wire_fingerprint);
    assert.equal(first.wire.settings.model_type, inputs[index]!.model_id);
  }
});

test("2281 rejects unsafe captured URLs, invalid source hashes, geometry, and malformed records", () => {
  for (const image of [
    { ...IMAGE, url: "https://example.invalid/private.png" },
    { ...IMAGE, url: "https://user@r2.syntx.ai/private.png" },
    { ...IMAGE, sha256: "not-a-digest" },
    { ...IMAGE, width: 90, height: 90 },
    { ...IMAGE, width: 8_401, height: 1 },
    { ...IMAGE, width: Number.POSITIVE_INFINITY },
    { ...IMAGE, extra: "unexpected" }
  ]) assert.throws(() => candidate(parameters(), image), { code: "INVALID_WIRE_CANDIDATE" });
  assert.throws(() => candidate(parameters({ aspect_ratio: "9:16" }), IMAGE), { code: "INVALID_WIRE_CANDIDATE" });
  const accessor = { ...IMAGE };
  Object.defineProperty(accessor, "sha256", { enumerable: true, get: () => { throw new Error("accessor must not run"); } });
  assert.throws(() => candidate(parameters(), accessor), { code: "INVALID_WIRE_CANDIDATE" });
});
