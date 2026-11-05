import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOwnerHappyHorseParameters } from "../src/application/owner-happy-horse-parameters.js";
import { buildOwnerHappyHorseWire, buildOwnerHappyHorseEditWire } from "../src/application/owner-happy-horse-wire.js";
import { deriveOwnerHappyHorseEditDuration, OWNER_HAPPY_HORSE_CURRENT_CONTROLS } from "../src/application/owner-happy-horse-current-controls.js";

const image = (i: number) => ({ url: `https://r2.syntx.ai/happy-current/image-${i}.png`, sha256: i.toString(16).padStart(64, "0"), width: 640, height: 640 });
const video = { url: "https://r2.syntx.ai/happy-current/video.mp4", sha256: "a".repeat(64), width: 640, height: 480, mime_type: "video/mp4", measured_duration_seconds: 55 };
test("HappyHorse current visible controls preserve defaults and admit manual fractions/explicit zero without cross-model widgets", () => {
  const base = { model_id: "happy_horse_references", prompt: "Use selected references" };
  assert.deepEqual(normalizeOwnerHappyHorseParameters(base).source_parameters, { model_type: "happy_horse_references", aspect_ratio: "16:9", resolution: "720P", video_duration: 5, seed: null });
  for (const aspect_ratio of ["16:9", "9:16", "1:1", "4:3", "3:4"]) {
    const selected = normalizeOwnerHappyHorseParameters({ ...base, aspect_ratio, resolution: "1080P", video_duration: 6.5, seed: 0 });
    assert.equal(selected.source_parameters.aspect_ratio, aspect_ratio); assert.equal(selected.source_parameters.seed, 0); assert.equal(selected.source_parameters.video_duration, 6.5);
  }
  for (const value of [{ video_duration: 2.9 }, { video_duration: 15.1 }, { seed: 2147483648 }, { seed: -1 }, { seed: 1.5 }, { native_audio: true }, { aspect_ratio: "21:9" }]) assert.throws(() => normalizeOwnerHappyHorseParameters({ ...base, ...value }));
  assert.throws(() => normalizeOwnerHappyHorseParameters({ ...base, model_id: "happy_horse_first_frame", aspect_ratio: "9:16" }));
});
test("HappyHorse references keep ordered1..9 image roles and single-image alias has the legacy semantic fingerprint", () => {
  const input = { model_id: "happy_horse_references", prompt: "Use selected references" };
  const one = buildOwnerHappyHorseWire(input, image(1)), oneArray = buildOwnerHappyHorseWire(input, [image(1)]);
  assert.equal(one.intent_fingerprint, oneArray.intent_fingerprint);
  const nine = buildOwnerHappyHorseWire({ ...input, resolution: "1080P", video_duration: 6.5, seed: 42, aspect_ratio: "3:4" }, Array.from({ length: 9 }, (_, i) => image(i + 1)));
  assert.equal(nine.wire.settings.file_urls.length, 9); assert.equal(nine.wire.settings.file_urls[8]!.url, image(9).url);
  assert.equal(nine.wire.settings.file_urls.every((file) => file.type === "image"), true);
  assert.notEqual(one.intent_fingerprint, nine.intent_fingerprint);
  assert.throws(() => buildOwnerHappyHorseWire(input, Array.from({ length: 10 }, (_, i) => image(i + 1))));
  assert.throws(() => buildOwnerHappyHorseWire({ ...input, model_id: "happy_horse_first_frame" }, [image(1), image(2)]));
});
test("HappyHorse edit derives clamped rounded duration and accepts0..5 auxiliary images plus explicit native audio", () => {
  assert.deepEqual([3, 6.6, 15, 55, 60].map(deriveOwnerHappyHorseEditDuration), [3, 7, 15, 15, 15]);
  const result = buildOwnerHappyHorseEditWire({ model_id: "happy_horse_edit", prompt: "Edit supplied video", resolution: "1080P", seed: 123, native_audio: true },
    { ...video, images: [image(1), image(2)] });
  assert.equal(result.wire.settings.video_duration, 15); assert.equal(result.wire.settings.native_audio, true);
  assert.deepEqual(result.wire.settings.file_urls.map((file) => file.type), ["video", "image", "image"]);
  assert.equal(result.source_media.duration_seconds, 55);
  assert.throws(() => buildOwnerHappyHorseEditWire({ model_id: "happy_horse_edit", prompt: "Edit supplied video", video_duration: 5 }, video));
  assert.throws(() => buildOwnerHappyHorseEditWire({ model_id: "happy_horse_edit", prompt: "Edit supplied video" }, { ...video, images: Array.from({ length: 6 }, (_, i) => image(i + 1)) }));
  assert.equal(OWNER_HAPPY_HORSE_CURRENT_CONTROLS.status, "FORM_SOURCE_REVIEWED");
});
