import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOwnerKlingMediaParameters } from "../src/application/owner-kling-media-parameters.js";
import { buildOwnerKlingMediaWire } from "../src/application/owner-kling-media-wire.js";

const PROMPT = "Move the subject gently and keep the framing steady.";
const IMAGE = Object.freeze({ type: "image" as const, url: "https://r2.syntx.ai/test/image", sha256: "a".repeat(64) });
const VIDEO = Object.freeze({ type: "video" as const, url: "https://r2.syntx.ai/test/video", sha256: "b".repeat(64) });

test("builds exact Elements settings with a single typed image and no inferred fields", () => {
  const p = normalizeOwnerKlingMediaParameters({ model_id: "kling_elements", prompt: PROMPT, version: "1.6", mode: "hd",
    aspect_ratio: "16:9", video_duration: 5, native_audio: false });
  const result = buildOwnerKlingMediaWire(p, { chat_uuid: "chat_2350", reference: IMAGE });
  assert.equal(result.ai_name, "kling"); assert.equal(result.scope, "video");
  assert.deepEqual(result.body, { chat_id: "chat_2350", prompt: PROMPT, settings: { model_type: "kling_elements",
    version: "1.6", mode: "hd", aspect_ratio: "16:9", video_duration: 5, native_audio: false,
    file_urls: [{ type: "image", url: IMAGE.url }] } });
});

test("builds exact O1 I2V settings using one typed image", () => {
  const p = normalizeOwnerKlingMediaParameters({ model_id: "kling_o1_image2video", prompt: PROMPT, version: "1.6", mode: "hd",
    aspect_ratio: "16:9", video_duration: 5, native_audio: false });
  const result = buildOwnerKlingMediaWire(p, { chat_uuid: "chat_2350", reference: IMAGE });
  assert.deepEqual(result.body.settings, { model_type: "kling_o1_image2video", version: "1.6", mode: "hd",
    aspect_ratio: "16:9", video_duration: 5, native_audio: false, file_urls: [{ type: "image", url: IMAGE.url }] });
});

test("builds exact O1 V2V settings with one typed video and omitted aspect_ratio", () => {
  const p = normalizeOwnerKlingMediaParameters({ model_id: "kling_o1_video2video", prompt: PROMPT, version: "1.6", mode: "hd",
    video_duration: 5, native_audio: false });
  const result = buildOwnerKlingMediaWire(p, { chat_uuid: "chat_2350", reference: VIDEO });
  assert.deepEqual(result.body.settings, { model_type: "kling_o1_video2video", version: "1.6", mode: "hd",
    video_duration: 5, native_audio: false, file_urls: [{ type: "video", url: VIDEO.url }] });
  assert.equal(Object.hasOwn(result.body.settings, "aspect_ratio"), false);
});

test("rejects a typed media role that does not match the exact model", () => {
  const p = normalizeOwnerKlingMediaParameters({ model_id: "kling_o1_video2video", prompt: PROMPT, version: "1.6", mode: "hd",
    video_duration: 5, native_audio: false });
  assert.throws(() => buildOwnerKlingMediaWire(p, { chat_uuid: "chat_2350", reference: IMAGE }));
});
