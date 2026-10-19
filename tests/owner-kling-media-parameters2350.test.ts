import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOwnerKlingMediaParameters } from "../src/application/owner-kling-media-parameters.js";

test("normalizes the explicitly selected Kling Elements tuple and cost keys", () => {
  const result = normalizeOwnerKlingMediaParameters({ model_id: "kling_elements", prompt: "Move gently.",
    version: "1.6", mode: "hd", aspect_ratio: "16:9", video_duration: 5, native_audio: false });
  assert.deepEqual(result.source_parameters, { model_type: "kling_elements", version: "1.6", mode: "hd",
    aspect_ratio: "16:9", video_duration: 5, native_audio: false });
  assert.deepEqual(result.cost_query_keys, ["version", "mode", "video_duration", "native_audio"]);
  assert.equal(result.dispatch_allowed, false);
});

test("normalizes O1 I2V only with its explicit source-selected tuple", () => {
  const result = normalizeOwnerKlingMediaParameters({ model_id: "kling_o1_image2video", prompt: "Move gently.",
    version: "1.6", mode: "hd", aspect_ratio: "16:9", video_duration: 5, native_audio: false });
  assert.deepEqual(result.source_parameters, { model_type: "kling_o1_image2video", version: "1.6", mode: "hd",
    aspect_ratio: "16:9", video_duration: 5, native_audio: false });
  assert.deepEqual(result.cost_query_keys, ["version", "mode", "video_duration"]);
});

test("normalizes O1 V2V with aspect_ratio omitted, not null", () => {
  const result = normalizeOwnerKlingMediaParameters({ model_id: "kling_o1_video2video", prompt: "Continue motion.",
    version: "1.6", mode: "hd", video_duration: 5, native_audio: false });
  assert.deepEqual(result.source_parameters, { model_type: "kling_o1_video2video", version: "1.6", mode: "hd",
    video_duration: 5, native_audio: false });
  assert.equal(Object.hasOwn(result.source_parameters, "aspect_ratio"), false);
  assert.deepEqual(result.cost_query_keys, ["version", "mode", "video_duration"]);
});

test("rejects O1 V2V aspect-ratio aliases and unsupported tuples", () => {
  assert.throws(() => normalizeOwnerKlingMediaParameters({ model_id: "kling_o1_video2video", prompt: "Continue.",
    version: "1.6", mode: "hd", aspect_ratio: null, video_duration: 5, native_audio: false }));
  assert.throws(() => normalizeOwnerKlingMediaParameters({ model_id: "kling_elements", prompt: "Move.",
    version: "3.0", mode: "hd", aspect_ratio: "16:9", video_duration: 5, native_audio: false }));
});
