import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOwnerHailuo3CurrentInput as hailuo, compileOwnerHailuo3CurrentIntent as compileHailuo, inspectOwnerHailuo3CurrentIntent as inspectHailuo, OWNER_HAILUO3_CURRENT_SOURCE } from "../src/application/owner-hailuo3-current-intent.js";
import { normalizeOwnerLumaCurrentInput as luma, compileOwnerLumaCurrentIntent as compileLuma, inspectOwnerLumaCurrentIntent as inspectLuma } from "../src/application/owner-luma-current-intent.js";
import { normalizeOwnerVeo3CurrentInput as veo, compileOwnerVeo3CurrentIntent as compileVeo, inspectOwnerVeo3CurrentIntent as inspectVeo } from "../src/application/owner-veo3-current-intent.js";
import { inspectOwnerCurrentVideoIntent } from "../src/application/owner-current-video-generation-service.js";
import type { OwnerCurrentVideoReferenceMetadata as Meta } from "../src/application/owner-current-video-reference-types.js";

const image = (index = 0, role: Meta["role"] = "image"): Meta => ({ role, kind: "image", mime_type: "image/png", size: 100,
  sha256: `sha256:${index.toString(16).padStart(64, "0")}`, width: 640, height: 640 });
const moving = (kind: "audio" | "video", duration: number, index: number): Meta => ({ role: kind, kind, mime_type: kind === "video" ? "video/mp4" : "audio/wav", size: 100,
  sha256: `sha256:${index.toString(16).padStart(64, "0")}`, duration_seconds: duration, ...(kind === "video" ? { width: 160, height: 120 } : {}) });
const hbase = { model_id: "hailuo-3.0", mode: "omni-references", resolution: "2K", video_duration: 5, aspect_ratio: "16:9", prompt: "A quiet scene 🌙" };
test("Hailuo3 source controls allow finite manual durations and both resolutions/six omni ratios but frames only auto", () => {
  for (const resolution of ["768p", "2K"]) for (let video_duration = 4; video_duration <= 15; video_duration++) {
    const intent = compileHailuo(hailuo({ ...hbase, resolution, video_duration }), []), descriptor = inspectHailuo(intent)!;
    assert.equal(descriptor.settings.video_duration, video_duration); assert.equal(descriptor.settings.resolution, resolution); assert.equal(descriptor.cost_parameters.duration, 0);
    assert.equal(inspectOwnerCurrentVideoIntent(intent), descriptor); assert.equal(inspectHailuo({ ...intent }), null);
  }
  assert.equal(inspectHailuo(compileHailuo(hailuo({ ...hbase, video_duration: 5.375 }), []))!.settings.video_duration, 5.375);
  for (const aspect_ratio of ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]) assert.equal(hailuo({ ...hbase, aspect_ratio }).aspect_ratio, aspect_ratio);
  for (const fields of [{ aspect_ratio: "auto" }, { video_duration: 15.1 }, { video_duration: 3 }, { mode: "frames", aspect_ratio: "16:9" }, { model_id: "hailuo-2.3" }, { seed: 1 }]) assert.throws(() => hailuo({ ...hbase, ...fields }));
});
test("Hailuo3 frames accepts first-only last-only both and rejects ordinary/audio/reversed roles", () => {
  const input = hailuo({ ...hbase, mode: "frames", aspect_ratio: "auto" });
  for (const refs of [[image(1, "first_frame")], [image(1, "last_frame")], [image(1, "first_frame"), image(2, "last_frame")]]) {
    const descriptor = inspectHailuo(compileHailuo(input, refs))!; assert.equal(descriptor.settings.aspect_ratio, "auto"); assert.equal(descriptor.cost_parameters.ref_count, refs.length);
  }
  for (const refs of [[], [image()], [moving("audio", 2, 1)], [image(1, "last_frame"), image(2, "first_frame")], [image(1, "first_frame"), image(2, "first_frame")]]) assert.throws(() => compileHailuo(input, refs));
});
test("Hailuo3 full mixed cardinality, audio-only and exact rounded input-duration quote are independently bound", () => {
  const input = hailuo(hbase), refs = [...Array.from({ length: 6 }, (_, i) => image(i)), ...[1, 2, 3].map(i => moving("video", i === 1 ? 2.125 : 2, 10 + i)),
    ...[1, 2, 3].map(i => moving("audio", 2, 20 + i))];
  const descriptor = inspectHailuo(compileHailuo(input, refs))!; assert.equal(descriptor.reference_metadata.length, 12); assert.equal(descriptor.cost_parameters.ref_count, 6);
  assert.equal(descriptor.cost_parameters.duration, "6.13");
  assert.equal(inspectHailuo(compileHailuo(input, [moving("audio", 2, 1)]))!.cost_parameters.duration, 0);
  for (const invalidRefs of [[...refs, image(99)], Array.from({ length: 10 }, (_, i) => image(i)), [moving("video", 8, 1), moving("video", 8, 2)],
    [moving("audio", 1.9, 1)], [{ ...image(), size: 27_525_121 }], [{ ...image(), width: 5761 }]]) assert.throws(() => compileHailuo(input, invalidRefs));
  const changed = inspectHailuo(compileHailuo(input, [...refs.slice(0, -1), moving("audio", 2.5, 23)]))!; assert.notEqual(changed.intent_fingerprint, descriptor.intent_fingerprint);
});
test("ordinary send preserves manually typed Hailuo/Veo aliases literally while Luma enables substitution", () => {
  assert.equal(hailuo({ ...hbase, prompt: "Scene @image1 @video2 @audio3 ending" }).prompt, "Scene @image1 @video2 @audio3 ending");
  assert.equal(hailuo({ ...hbase, prompt: "@image1" }).prompt, "@image1");
  assert.equal(veo({ model_id: "veo3fast", type: "image", prompt: "Scene @image1 literal", aspect_ratio: "16:9", video_duration: 8, upscale: 0 }).prompt, "Scene @image1 literal");
  assert.equal(luma({ model_id: "ray-3.14", quality: "720p", video_duration: 5, aspect_ratio: "auto", prompt: "Use @image1" }, 1).prompt, "Use @image1");
});
test("Luma derives input-dependent mode, auto ratio and fixed5s; only two images permit empty prompt", () => {
  const base = { model_id: "ray-3.14", prompt: "A quiet lake", quality: "1080p", video_duration: 10, aspect_ratio: "21:9" };
  assert.equal(inspectLuma(compileLuma(luma(base, 0), []))!.settings.gen_type, "text2video");
  const selected = luma({ ...base, prompt: "", aspect_ratio: "auto", video_duration: 5 }, 2), description = inspectLuma(compileLuma(selected, [image(1), image(2)]))!;
  assert.equal(description.mode, "keyframes"); assert.equal(description.prompt, ""); assert.deepEqual(description.cost_parameters, { quality: "1080p", video_duration: 5 });
  for (const [value, count] of [[{ ...base, aspect_ratio: "auto" }, 0], [{ ...base }, 1], [{ ...base, video_duration: 5, aspect_ratio: "auto", prompt: "" }, 1]] as const) assert.throws(() => luma(value, count));
  assert.throws(() => compileLuma(selected, [image(1, "first_frame"), image(2)])); assert.throws(() => compileLuma(selected, [image(1)]));
  assert.throws(() => compileLuma(selected, [image(1), moving("video", 5, 2)]));
});
test("Veo all3 models support1..2image mode; references onlyfast/r up3 and both ratios remain selectable", () => {
  for (const model_id of ["veo3", "veo3fast", "veo3fast_r"]) for (const aspect_ratio of ["16:9", "9:16"]) for (const upscale of [0, 1, 2]) {
    const base = { model_id, type: "image", aspect_ratio, upscale, video_duration: 8, prompt: "A detailed quiet scene" };
    for (const refs of [[image(1)], [image(1), image(2)]]) assert.equal(inspectVeo(compileVeo(veo(base), refs))!.settings.type, "image");
    const refInput = { ...base, type: "references" };
    if (model_id === "veo3") assert.throws(() => veo(refInput));
    else assert.equal(inspectVeo(compileVeo(veo(refInput), [image(1), image(2), image(3)]))!.settings.aspect_ratio, aspect_ratio);
    assert.throws(() => compileVeo(veo(base), [])); assert.throws(() => compileVeo(veo(base), [image(1), image(2), image(3)]));
    assert.throws(() => veo({ ...base, video_duration: 6 })); assert.throws(() => veo({ ...base, upscale: 3 }));
  }
});
test("family normalizers reject accessors, malformed Unicode and injected provider fields", () => {
  let reads = 0; const accessor = Object.defineProperty({ ...hbase }, "prompt", { enumerable: true, get() { reads++; return "unsafe"; } });
  assert.throws(() => hailuo(accessor)); assert.equal(reads, 0); assert.throws(() => hailuo({ ...hbase, prompt: "bad\ud800" }));
  assert.throws(() => luma({ model_id: "ray-3.14", quality: "720p", video_duration: 5, aspect_ratio: "16:9", prompt: "valid", file_urls: [] }, 0));
});
test("current image canonical bounds use8400dimension and both byte guards; metadata getters cannot mint authority", () => {
  const wide = { ...image(1), width: 8400, height: 6000 };
  const lumaInput = luma({ model_id: "ray-3.14", prompt: "A wide reference", quality: "720p", video_duration: 5, aspect_ratio: "auto" }, 1);
  assert.equal(inspectLuma(compileLuma(lumaInput, [wide]))!.reference_metadata[0]!.width, 8400);
  assert.throws(() => compileLuma(lumaInput, [{ ...wide, width: 8401 }]));
  assert.throws(() => compileLuma(lumaInput, [{ ...wide, size: 26_214_401 }]));
  const veoInput = veo({ model_id: "veo3fast", type: "image", prompt: "A wide reference", aspect_ratio: "16:9", video_duration: 8, upscale: 0 });
  assert.equal(inspectVeo(compileVeo(veoInput, [wide]))!.reference_metadata[0]!.width, 8400);
  assert.throws(() => compileVeo(veoInput, [{ ...wide, size: 20_971_521 }]));
  let reads = 0; const refs = Object.defineProperty([image()], "0", { enumerable: true, get() { reads++; return image(); } });
  assert.throws(() => compileHailuo(hailuo(hbase), refs)); assert.throws(() => compileLuma(lumaInput, refs)); assert.throws(() => compileVeo(veoInput, refs)); assert.equal(reads, 0);
  assert.equal(Object.isFrozen(OWNER_HAILUO3_CURRENT_SOURCE.references.omni), true);
});
