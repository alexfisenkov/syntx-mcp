import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { validateOwnerCurrentVideoReferenceSelection } from "../src/application/owner-current-video-reference-policy.js";
import { releaseOwnerCurrentValidatedVideoReference, validateOwnerCurrentVideoReference } from "../src/application/owner-current-video-reference-validation.js";
import { compileOwnerVeoOmni12CurrentIntent, getOwnerVeoOmni12CurrentFamilyDefinition,
  inspectOwnerVeoOmni12CurrentIntent, normalizeOwnerVeoOmni12CurrentInput,
  OWNER_VEO_OMNI12_CURRENT_SOURCE } from "../src/application/owner-veo-omni12-current-intent.js";

const base = { model_id: "omni1.2", type: "text", prompt: "A quiet mountain lake at dawn.",
  aspect_ratio: "16:9", video_duration: 3, upscale: 3 } as const;
const image = (index: number, role: "image" | "first_frame" | "last_frame" = "image") => ({
  role, kind: "image" as const, mime_type: "image/jpeg", size: 1024, width: 1024, height: 1024,
  sha256: `sha256:${String(index).padStart(64, "0")}`
});
const video = (duration_seconds: number, role: "video" | "first_clip" = "video") => ({
  role, kind: "video" as const, mime_type: "video/mp4", size: 4096, width: 1280, height: 720,
  sha256: `sha256:${"a".repeat(64)}`, duration_seconds
});
const compile = (input: Record<string, unknown>, refs: unknown[]) =>
  inspectOwnerVeoOmni12CurrentIntent(compileOwnerVeoOmni12CurrentIntent(normalizeOwnerVeoOmni12CurrentInput(input), refs as never))!;

test("new Omni 1.2 text profile binds exact public model and new form", () => {
  const pins = OWNER_VEO_OMNI12_CURRENT_SOURCE.source_pins;
  const directory = join(process.cwd(), "catalog");
  const catalog = loadSelectedDiscoveryCatalog(pins.public_catalog_version, directory).discoveryCatalog;
  const inventory = loadMaplessSettingsInventoryVersion(pins.settings_inventory_version, directory);
  const model = catalog.getModel("omni1.2");
  assert.equal(model.active, true);
  assert.equal(model.ai_name, "veo3");
  assert.equal(inventory.public_catalog.version, pins.public_catalog_version);
  assert.equal(inventory.models.find(row => row.model_id === "omni1.2")?.form_id, pins.form_id);
  assert.equal(inventory.forms.find(row => row.form_id === pins.form_id)?.javascript.sha256, pins.form_sha256);
  assert.equal(getOwnerVeoOmni12CurrentFamilyDefinition().model_ids[0], "omni1.2");
});

test("text intent carries exact new model wire and conditional quote projection", () => {
  for (const video_duration of [3, 8, 15]) {
    const normalized = normalizeOwnerVeoOmni12CurrentInput({ ...base, video_duration });
    const description = inspectOwnerVeoOmni12CurrentIntent(compileOwnerVeoOmni12CurrentIntent(normalized, []));
    assert.ok(description);
    assert.equal(description.model_id, "omni1.2");
    assert.deepEqual(description.settings, { model_type: "omni1.2", type: "text", aspect_ratio: "16:9", video_duration, upscale: 3 });
    assert.deepEqual(description.cost_parameters, { upscale: 3, video_duration });
    assert.deepEqual(description.reference_metadata, []);
  }
});

test("frames and first clip preserve source roles and their distinct quote fields", () => {
  const frames = compile({ ...base, type: "image", video_duration: 10 }, [image(1, "first_frame"), image(2, "last_frame")]);
  assert.deepEqual(frames.reference_metadata.map(ref => ref.role), ["first_frame", "last_frame"]);
  assert.equal(frames.settings.type, "image");
  assert.deepEqual(frames.cost_parameters, { upscale: 3, video_duration: 10 });
  assert.equal(frames.reference_prompt_mode, "DISABLED_LITERAL");
  const extended = compile({ ...base, type: "image", video_duration: 10 }, [video(8.5, "first_clip")]);
  assert.deepEqual(extended.cost_parameters, { upscale: 3, video_duration: 10, veo3_type: "extend" });
  for (const refs of [[video(8.5, "first_clip"), image(1, "last_frame")],
    [image(1, "last_frame")], [image(1, "first_frame"), video(8.5, "first_clip")]])
    assert.throws(() => compile({ ...base, type: "image" }, refs));
  assert.throws(() => compile({ ...base, type: "image", video_duration: 11 }, [image(1, "first_frame"), image(2, "last_frame")]));
  assert.throws(() => compile({ ...base, type: "image", video_duration: 10 }, [video(21, "first_clip")]));
});

test("mixed references allow five images plus one video and quote full mode", () => {
  const mixed = compile({ ...base, type: "references", video_duration: 15 }, [video(5), ...[1, 2, 3, 4, 5].map(i => image(i))]);
  assert.equal(mixed.reference_metadata.length, 6);
  assert.deepEqual(mixed.cost_parameters, { upscale: 3, video_duration: 15, mode: "full" });
  assert.equal(mixed.reference_prompt_mode, "ENABLED_ALIASES");
  const imagesOnly = compile({ ...base, type: "references" }, [1, 2, 3, 4, 5, 6, 7].map(i => image(i)));
  assert.deepEqual(imagesOnly.cost_parameters, { upscale: 3, video_duration: 3 });
  for (const refs of [[video(5), ...[1, 2, 3, 4, 5, 6].map(i => image(i))],
    [video(5), video(4)], [video(2.8)], [image(1, "first_frame")]])
    assert.throws(() => compile({ ...base, type: "references" }, refs));
});

test("new image upload admission accepts a measured PNG but rejects unlisted media", async () => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  const input = { model_id: "omni1.2" as const, filename: "frame.png", mime_type: "image/png", bytes };
  const checked = await validateOwnerCurrentVideoReference(input, join(process.cwd(), "ffprobe"));
  assert.equal(checked.model_id, "omni1.2");
  assert.equal(checked.kind, "image");
  assert.equal(checked.width, 1);
  releaseOwnerCurrentValidatedVideoReference(checked);
  await assert.rejects(validateOwnerCurrentVideoReference({ ...input, mime_type: "image/bmp" }, join(process.cwd(), "ffprobe")));
});

test("new text profile refuses legacy identity, reference modes, invalid durations and forged intent", () => {
  for (const invalid of [
    { ...base, model_id: "veo_omni" }, { ...base, type: "video_ref" }, { ...base, video_duration: 2 },
    { ...base, video_duration: 16 }, { ...base, video_duration: 3.5 }, { ...base, upscale: 4 },
    { ...base, prompt: "short" }, { ...base, mode: "text" }
  ]) assert.throws(() => normalizeOwnerVeoOmni12CurrentInput(invalid));
  const normalized = normalizeOwnerVeoOmni12CurrentInput(base);
  assert.throws(() => compileOwnerVeoOmni12CurrentIntent(normalized, [{ kind: "image" }] as never));
  assert.doesNotThrow(() => validateOwnerCurrentVideoReferenceSelection("omni1.2", "text", []));
  assert.equal(inspectOwnerVeoOmni12CurrentIntent(Object.freeze({ model_id: "omni1.2" })), null);
});
