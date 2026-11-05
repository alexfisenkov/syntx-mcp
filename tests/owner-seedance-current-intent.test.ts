import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOwnerSeedanceCurrentInput as normalize, compileOwnerSeedanceCurrentIntent as compile,
  inspectOwnerSeedanceCurrentIntent as inspect, getOwnerSeedanceCurrentFamilyDefinition, OWNER_SEEDANCE_CURRENT_SOURCE } from "../src/application/owner-seedance-current-intent.js";
import type { OwnerCurrentVideoReferenceMetadata as Metadata } from "../src/application/owner-current-video-reference-types.js";
const image = (role: Metadata["role"] = "image", hash = "1"): Metadata => ({ role, kind: "image", mime_type: "image/png", size: 1234,
  sha256: `sha256:${hash.repeat(64)}`, width: 640, height: 640 });
const video: Metadata = { role: "video", kind: "video", mime_type: "video/mp4", size: 10000, sha256: `sha256:${"2".repeat(64)}`,
  width: 1280, height: 720, duration_seconds: 4.25 };
const audio: Metadata = { role: "audio", kind: "audio", mime_type: "audio/wav", size: 2000, sha256: `sha256:${"3".repeat(64)}`, duration_seconds: 2.5 };
const base20 = { model_id: "seedance-2.0", mode: "omni-references", prompt: "A current source scene", version: "mini", resolution: "720p", aspect_ratio: "16:9",
  video_duration: 5, generate_audio: true };
const base25 = { model_id: "seedance-2.5", mode: "omni-references", prompt: "", resolution: "720p", aspect_ratio: "adaptive", video_duration: 0, generate_audio: true };
const describe = (input: unknown, refs: readonly Metadata[]) => inspect(compile(normalize(input, refs.length), refs))!;

test("Seedance current source compiles closed model/version/mode choices, exact costs and source-fixed frame/edit fields", () => {
  assert.equal(getOwnerSeedanceCurrentFamilyDefinition(), getOwnerSeedanceCurrentFamilyDefinition());
  assert.equal(Object.isFrozen(OWNER_SEEDANCE_CURRENT_SOURCE.controls.versions20), true);
  for (const version of ["mini", "fast", "pro"]) for (const resolution of version === "pro" ? ["480p", "720p", "1080p", "4K"] : ["480p", "720p"]) {
    const result = describe({ ...base20, version, resolution }, [image(), video, audio]);
    assert.equal(result.settings.version, version); assert.equal(result.settings.input_video_duration, 4);
    assert.deepEqual(result.cost_parameters, { video_duration: 5, resolution, duration: 4.25, mode: "omni-references", size: "16:9", version });
    assert.equal(result.reference_prompt_mode, "ENABLED_ALIASES");
  }
  const { aspect_ratio: _ratio20, ...frame20 } = { ...base20, mode: "frames" };
  const frame = describe(frame20, [image("first_frame"), image("last_frame")]);
  assert.equal(frame.settings.aspect_ratio, "adaptive"); assert.equal(frame.reference_prompt_mode, "DISABLED_LITERAL");
  assert.equal(frame.reference_metadata.length, 2, "the same actual image can occupy distinct first/last slots");
  for (const mode of ["frames", "extend", "edit", "omni-references"]) {
    const input: Record<string, unknown> = { ...base25, mode, ...(mode === "frames" ? { prompt: "A frame scene", video_duration: 30 } : {}) };
    if (mode !== "omni-references") delete input.aspect_ratio;
    if (mode === "edit") delete input.video_duration;
    const result = describe(input, mode === "frames" ? [image("first_frame")] : [video, image(), audio]);
    assert.equal(result.settings.aspect_ratio, "adaptive"); assert.equal(Object.hasOwn(result.settings, "version"), false);
    assert.equal(result.settings.video_duration, mode === "frames" ? 30 : 0); assert.equal(Object.keys(result.cost_parameters).length, 5);
  }
});

test("Seedance current older image modes keep aliases disabled and omit unsupported mode/version/audio controls", () => {
  for (const model_id of ["seedance_pro", "seedance_pro-fast", "seedance-1.5-pro"]) {
    const input = { model_id, prompt: "A source image scene", resolution: model_id === "seedance-1.5-pro" ? "720p" : "1080p",
      aspect_ratio: "16:9", video_duration: 5, ...(model_id === "seedance-1.5-pro" ? { generate_audio: false, camera_fixed: true } : {}) };
    const result = describe(input, [image()]);
    assert.equal(result.mode, "images"); assert.equal(Object.hasOwn(result.settings, "mode"), false);
    assert.equal(Object.hasOwn(result.settings, "version"), false); assert.equal(result.reference_prompt_mode, "DISABLED_LITERAL");
    assert.deepEqual(Object.keys(result.cost_parameters).sort(), model_id === "seedance-1.5-pro" ? ["generate_audio", "resolution", "video_duration"] : ["resolution", "video_duration"]);
  }
});

test("Seedance current compiler rejects hidden controls, unsupported tuples, unowned protocol markers and wrong media selections", () => {
  assert.equal(describe({ ...base20, prompt: "<<<literal text>>> and @image1" }, [image()]).prompt, "<<<literal text>>> and @image1");
  for (const invalid of [{ ...base20, version: "turbo" }, { ...base20, version: "mini", resolution: "4K" }, { ...base20, video_duration: 3 },
    { ...base20, video_duration: 16 }, { ...base20, seed: 1 }, { ...base20, camera_fixed: true }, { ...base20, prompt: "<<<https://r2.syntx.ai/foreign>>>" },
    { ...base25, mode: "frames" }, { ...base25, mode: "edit", video_duration: 5 }, { ...base25, mode: "extend", aspect_ratio: "16:9" }]) assert.throws(() => normalize(invalid, 1));
  assert.throws(() => describe(base20, [audio]));
  assert.throws(() => describe({ ...base25, mode: "edit", aspect_ratio: undefined, video_duration: undefined }, [image()]));
  const { aspect_ratio: _ratio, ...frames } = { ...base20, mode: "frames" };
  assert.throws(() => describe(frames, [image("last_frame")]));
  assert.throws(() => describe(frames, [image("first_frame"), video]));
  assert.throws(() => describe(base20, [{ ...video, duration_seconds: 16 }]));
  const intent = compile(normalize(base20, 1), [image()]);
  assert.equal(inspect(JSON.parse(JSON.stringify(intent))), null);
  assert.equal(inspect(new Proxy(intent, {})), null);
  let calls = 0; const controls = { ...base20 }; Object.defineProperty(controls, "prompt", { enumerable: true, get() { calls++; return "x"; } });
  assert.throws(() => normalize(controls, 1)); assert.equal(calls, 0);
  const refs = [image()]; Object.defineProperty(refs, "0", { enumerable: true, get() { calls++; return image(); } });
  assert.throws(() => compile(normalize(base20, 1), refs)); assert.equal(calls, 0);
});

test("Seedance intent fingerprints bind all ordered actual metadata while remaining independent of handles and expiry", () => {
  const first = describe(base25, [image(), video, audio]), second = describe(base25, [audio, video, image()]);
  assert.notEqual(first.intent_fingerprint, second.intent_fingerprint);
  assert.equal(Object.hasOwn(first.settings, "file_urls"), false);
  assert.equal(JSON.stringify(first).includes("reference_handle"), false); assert.equal(JSON.stringify(first).includes("expires"), false);
});
