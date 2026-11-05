import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOwnerKlingMediaParameters, getOwnerKlingMediaSourceProfile } from "../src/application/owner-kling-media-parameters.js";
import { buildOwnerKlingMediaWire } from "../src/application/owner-kling-media-wire.js";
import { OWNER_KLING_MEDIA_CURRENT_CONTROLS } from "../src/application/owner-kling-media-current-controls.js";

const prompt = "A source-backed scene with owned references";
const elements = { model_id: "kling_elements", prompt, version: "3.0", mode: "4K", aspect_ratio: "9:16", video_duration: 15,
  native_audio: true, multi_shots: true };
const image = { model_id: "kling_o1_image2video", prompt, mode: "hd", aspect_ratio: "1:1", video_duration: 3 };
const video = { model_id: "kling_o1_video2video", prompt, mode: "hd", video_duration: 5 };
const ref = (index: number, type: "image" | "video" = "image") => ({ type, url: `https://r2.syntx.ai/current-kling/source-${type}-${index}`,
  sha256: index.toString(16).padStart(64, "0") });

test("current Kling Media source branches keep forced3.0 versus omitted O1 versions and preserve historical single-source pins", () => {
  assert.equal(getOwnerKlingMediaSourceProfile().source_pins.form_build_id, "1792363638");
  assert.equal(OWNER_KLING_MEDIA_CURRENT_CONTROLS.provider_acceptance, "UNPROVEN");
  for (const mode of ["standart", "hd", "4K"]) for (const duration of [3, 5.375, 15]) for (const audio of [false, true]) for (const shots of [false, true]) {
    const normalized = normalizeOwnerKlingMediaParameters({ ...elements, mode, video_duration: duration, native_audio: audio, multi_shots: shots });
    assert.equal(normalized.source_parameters.version, "3.0"); assert.equal(normalized.source_parameters.native_audio, audio);
    assert.equal(normalized.source_parameters.multi_shots, shots);
  }
  for (const input of [image, video]) {
    const normalized = normalizeOwnerKlingMediaParameters(input);
    assert.equal(Object.hasOwn(normalized.source_parameters, "version"), false);
    assert.deepEqual(normalized.cost_query_keys, ["mode", "video_duration"]);
    assert.notEqual(normalized.source_profile_sha256, getOwnerKlingMediaSourceProfile().source_sha256);
  }
  assert.equal(normalizeOwnerKlingMediaParameters({ model_id: "kling_elements", prompt, version: "1.6", mode: "hd", aspect_ratio: "16:9", video_duration: 5,
    native_audio: false }).source_profile_sha256, getOwnerKlingMediaSourceProfile().source_sha256);
  for (const invalid of [{ ...elements, video_duration: 2 }, { ...elements, video_duration: 16 }, { ...elements, video_duration: NaN },
    { ...elements, temperature: 0.5 }, { ...elements, version: "3.0-turbo" }, { ...image, version: "3.0" }, { ...image, video_duration: 11 },
    { ...video, aspect_ratio: "16:9" }, { ...video, native_audio: true }, { ...image, mode: "standart" }]) assert.throws(() => normalizeOwnerKlingMediaParameters(invalid));
});

test("current Kling Media wire binds the whole ordered source set, exact role counts and current profile hash", () => {
  const normalized = normalizeOwnerKlingMediaParameters(elements), references = Array.from({ length: 7 }, (_, i) => ref(i));
  const wire = buildOwnerKlingMediaWire(normalized, { chat_uuid: "current-kling-chat", references });
  assert.deepEqual(wire.body.settings.file_urls, references.map(({ type, url }) => ({ type, url })));
  const reversed = buildOwnerKlingMediaWire(normalized, { chat_uuid: "current-kling-chat", references: [...references].reverse() });
  assert.notEqual(wire.intent_fingerprint, reversed.intent_fingerprint);
  assert.notEqual(wire.reference_sha256, reversed.reference_sha256);
  assert.throws(() => buildOwnerKlingMediaWire(normalized, { chat_uuid: "chat", references: [references[0]!, references[0]!] }));
  assert.throws(() => buildOwnerKlingMediaWire(normalized, { chat_uuid: "chat", references: [ref(1, "video")] }));
  assert.throws(() => buildOwnerKlingMediaWire(normalizeOwnerKlingMediaParameters(image), { chat_uuid: "chat", references: references.slice(0, 5) }));
  const mixed = buildOwnerKlingMediaWire(normalizeOwnerKlingMediaParameters(video), { chat_uuid: "chat", references: [ref(10, "video"), ...references.slice(0, 4)] });
  assert.equal((mixed.body.settings.file_urls as unknown[]).length, 5);
  assert.throws(() => buildOwnerKlingMediaWire(normalizeOwnerKlingMediaParameters(video), { chat_uuid: "chat", references: references.slice(0, 4) }));
  assert.throws(() => buildOwnerKlingMediaWire({ ...normalized, source_profile_sha256: getOwnerKlingMediaSourceProfile().source_sha256 }, { chat_uuid: "chat", references }));
});
