import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  getOwnerWan25I2vGenerationParametersSource,
  normalizeOwnerWan25I2vCostParameters,
  normalizeOwnerWan25I2vGenerationParameters,
  OwnerWan25I2vGenerationParametersError,
} from "../src/application/owner-wan25-i2v-generation-parameters.js";

const MODEL_ID = "wan_25_i2v_preview" as const;
const RESOLUTIONS = ["480P", "720P", "1080P"] as const;
const RATIOS_480P = ["16:9", "9:16", "1:1"] as const;
const RATIOS_OTHER = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
const DURATIONS = [5, 10] as const;
const C396_VERSION = "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json";
type Resolution = typeof RESOLUTIONS[number];
type Ratio = typeof RATIOS_OTHER[number];

function input(values: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model_id: MODEL_ID,
    prompt: "explicit literal prompt",
    parameters: {
      resolution: "720P",
      aspect_ratio: "16:9",
      video_duration: 5,
      prompt_extend: false,
      seed: null,
      ...values,
    },
  };
}
function rejectsInvalid(value: unknown): void {
  assert.throws(() => normalizeOwnerWan25I2vGenerationParameters(value), (error: unknown) =>
    error instanceof OwnerWan25I2vGenerationParametersError && error.code === "INVALID_PARAMETERS");
}
function ratiosFor(resolution: Resolution): readonly Ratio[] { return resolution === "480P" ? RATIOS_480P : RATIOS_OTHER; }

test("exact preview controls normalize without defaults, URLs, file_urls, or dispatch authority", () => {
  for (const resolution of RESOLUTIONS) for (const aspect_ratio of ratiosFor(resolution)) {
    for (const video_duration of DURATIONS) for (const prompt_extend of [false, true]) for (const seed of [null, 0, 2_147_483_647]) {
      const normalized = normalizeOwnerWan25I2vGenerationParameters(input({ resolution, aspect_ratio, video_duration, prompt_extend, seed }));
      assert.equal(normalized.status, "EXPLICIT_LOCAL_PARAMETERS_NORMALIZED");
      assert.deepEqual(normalized.intent, { model_id: MODEL_ID, prompt: "explicit literal prompt",
        parameters: { resolution, aspect_ratio, video_duration, prompt_extend, seed } });
      assert.deepEqual(normalized.wire_candidate, {
        ai_name: "wan_video", prompt: "explicit literal prompt", settings: {
          model_type: MODEL_ID, resolution, aspect_ratio, video_duration, prompt_extend, seed,
          native_audio: false, shot_type: "single", audio_setting: "auto",
        },
      });
      assert.equal("file_urls" in normalized.wire_candidate, false);
      assert.equal("duration" in normalized.wire_candidate.settings, false);
      assert.equal(normalized.runtime_usable, false);
      assert.equal(normalized.dispatch_allowed, false);
      assert.equal(normalized.provider_acceptance, "UNPROVEN");
      assert.equal(normalized.effective_defaults, "UNKNOWN");
      assert.ok(Object.isFrozen(normalized) && Object.isFrozen(normalized.intent));
      assert.ok(Object.isFrozen(normalized.intent.parameters) && Object.isFrozen(normalized.wire_candidate.settings));
    }
  }
});

test("480P allows only three ratios; 720P and 1080P allow five", () => {
  for (const aspect_ratio of ["4:3", "3:4"] as const) rejectsInvalid(input({ resolution: "480P", aspect_ratio }));
  for (const resolution of ["720P", "1080P"] as const) for (const aspect_ratio of RATIOS_OTHER) {
    assert.equal(normalizeOwnerWan25I2vGenerationParameters(input({ resolution, aspect_ratio })).intent.parameters.aspect_ratio, aspect_ratio);
  }
  rejectsInvalid(input({ resolution: "360P", aspect_ratio: "16:9" }));
  rejectsInvalid(input({ resolution: "480P", aspect_ratio: "2:1" }));
});

test("preview output duration is only 5 or 10 and remains distinct from omitted reference duration", () => {
  for (const duration of [4, 2, 15, 0, 11, "5", Number.NaN, 5.5]) rejectsInvalid(input({ video_duration: duration }));
  for (const duration of DURATIONS) assert.equal(normalizeOwnerWan25I2vGenerationParameters(input({ video_duration: duration })).wire_candidate.settings.video_duration, duration);
  for (const extra of [{ duration: 5 }, { output_duration: 5 }]) rejectsInvalid(input(extra));
});

test("prompt is preserved literally and follows the pinned 1500-unit guard", () => {
  const empty = normalizeOwnerWan25I2vGenerationParameters({ ...input(), prompt: "" });
  assert.equal(empty.intent.prompt, "");
  const literalURLText = "Keep this URL as literal prompt text: https://example.invalid/audio.wav";
  const literal = normalizeOwnerWan25I2vGenerationParameters({ ...input(), prompt: literalURLText });
  assert.equal(literal.intent.prompt, literalURLText);
  assert.equal(literal.wire_candidate.prompt, literalURLText);
  assert.equal("file_urls" in literal.wire_candidate.settings, false);
  assert.equal(normalizeOwnerWan25I2vGenerationParameters({ ...input(), prompt: "x".repeat(1_500) }).intent.prompt.length, 1_500);
  rejectsInvalid({ ...input(), prompt: "x".repeat(1_501) });
  rejectsInvalid({ ...input(), prompt: "\uD800" });
  rejectsInvalid({ ...input(), prompt: undefined });
});

test("seed accepts null and inclusive integer guard only", () => {
  for (const seed of [null, 0, 2_147_483_647]) assert.equal(normalizeOwnerWan25I2vGenerationParameters(input({ seed })).intent.parameters.seed, seed);
  for (const seed of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 2_147_483_648, "0", false, undefined]) rejectsInvalid(input({ seed }));
});

test("fixed and unresolved fields cannot be caller supplied or turned into URL authority", () => {
  for (const extra of [
    { native_audio: false }, { native_audio: true }, { shot_type: "multi" }, { audio_setting: "origin" },
    { file_urls: [] }, { url: "https://example.invalid/image.png" }, { files: [] }, { audio: "owned-audio-handle" },
  ]) rejectsInvalid(input(extra));
  rejectsInvalid({ ...input(), file_urls: [] });
  rejectsInvalid({ ...input(), extra: true });
  rejectsInvalid({ ...input(), model_id: "wan_26_i2v" });
});

test("source report pins C396 and current form evidence while keeping quotes/defaults and runtime unproven", () => {
  const source = getOwnerWan25I2vGenerationParametersSource();
  assert.equal(Object.isFrozen(source), true);
  assert.equal(Object.isFrozen(source.source_pins), true);
  assert.equal(source.source_pins.public_catalog_version,
    "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json");
  assert.equal(source.source_pins.public_models_sha256, "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a");
  assert.equal(source.source_pins.form_build_id, "1791904852");
  assert.equal(source.source_pins.form_module, "wan-video.js");
  assert.equal(source.source_pins.form_bytes, 19_503);
  assert.equal(source.source_pins.form_sha256, "sha256:f69db3d449d0051969def2229ed936d9835e0d65c8f257ec3ab289d6e9387737");
  assert.deepEqual(source.source_controls.aspect_ratio_by_resolution, {
    "480P": ["16:9", "9:16", "1:1"], other: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  });
  assert.deepEqual(source.source_controls.video_duration.values, [5, 10]);
  assert.deepEqual(source.source_controls.fixed_fields, { native_audio: false, shot_type: "single", audio_setting: "auto" });
  assert.equal(source.source_controls.reference_duration, "OMITTED_FROM_SETTINGS");
  assert.equal(source.catalog_hints.source, "PINNED_C396_STATIC_METADATA_NOT_UPLOAD_AUTHORITY");
  assert.deepEqual(source.catalog_hints.allowed_media_types, ["images"]);
  assert.deepEqual(source.catalog_hints.file_count_limit, { images: 1, audios: 1 });
  assert.equal(source.source_controls.optional_audio_ui_reference.evidence,
    "REFERENCE_COMPONENT_ONLY_NATIVE_APPLICABILITY_UNPROVEN");
  assert.equal(source.source_controls.seed.bound_source, "PRIOR_PINNED_RANDOM_SEED_GUARD_NOT_FRESH");
  assert.deepEqual(source.model_ids, [MODEL_ID]);
  assert.deepEqual(source.cost_projection.keys, ["resolution", "video_duration"]);
  assert.equal(source.cost_projection.current_quote, "UNKNOWN");
  assert.equal(source.effective_defaults, "UNKNOWN");
  assert.equal(source.runtime_usable, false);
  assert.equal(source.dispatch_allowed, false);
  assert.equal(source.provider_acceptance, "UNPROVEN");
  const normalized = normalizeOwnerWan25I2vGenerationParameters(input({ resolution: "480P", video_duration: 10 }));
  assert.deepEqual(normalized.cost_projection.keys, ["resolution", "video_duration"]);
  assert.deepEqual(normalized.cost_projection.values, { resolution: "480P", video_duration: 10 });
  assert.equal(normalizeOwnerWan25I2vCostParameters(input({ resolution: "480P", video_duration: 10 })).confidence,
    "PINNED_C396_METADATA_NOT_CURRENT_QUOTE");
});

test("preview image MIME hint exactly matches the image-filtered accepted types in pinned C396", () => {
  const c396 = loadPublicCatalogVersion(C396_VERSION, join(process.cwd(), "catalog"));
  const model = c396.models.find((entry) => entry.value === MODEL_ID);
  assert.ok(model?.settings?.accepted_file_types, "pinned C396 preview row must include accepted_file_types");
  const imageFilter = model.settings.accepted_file_types.filter((mime) => mime.startsWith("image/"));
  const hint = getOwnerWan25I2vGenerationParametersSource().catalog_hints.image_mime_types;
  assert.deepEqual(imageFilter, ["image/jpg", "image/jpeg", "image/png", "image/bmp", "image/webp"]);
  assert.deepEqual(hint, imageFilter);
  assert.equal((hint as readonly string[]).includes("image/avif"), false);
});

test("descriptor-only parsing rejects getters, proxies, symbols, sparse and forged records without invoking getters", () => {
  let getterCalls = 0;
  const top = input();
  Object.defineProperty(top, "prompt", { get() { getterCalls += 1; return "unsafe"; }, enumerable: true });
  rejectsInvalid(top);
  const nested = input();
  Object.defineProperty(nested.parameters as object, "resolution", { get() { getterCalls += 1; return "720P"; }, enumerable: true });
  rejectsInvalid(nested);
  rejectsInvalid(new Proxy(input(), {}));
  rejectsInvalid({ ...input(), parameters: new Proxy((input().parameters as object), {}) });
  const symbolExtra = input(); Object.defineProperty(symbolExtra, Symbol("extra"), { value: true }); rejectsInvalid(symbolExtra);
  const nonEnumerableExtra = input(); Object.defineProperty(nonEnumerableExtra.parameters as object, "extra", { value: true }); rejectsInvalid(nonEnumerableExtra);
  rejectsInvalid({ ...input(), parameters: Object.create({ forged: true, ...((input().parameters) as object) }) });
  const sparse = input(); delete (sparse.parameters as Record<string, unknown>).seed; rejectsInvalid(sparse);
  assert.equal(getterCalls, 0);
});
