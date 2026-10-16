import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerVeoOmniGenerationParameterReport,
  normalizeOwnerVeoOmniGenerationParameters,
  OwnerVeoOmniParametersError
} from "../src/application/owner-veo-omni-parameters.js";

const input = (type: "text" | "image" | "references", images: number, videos: number,
  upscale: 0 | 1 | 2 | 3 = 0, video_duration: 4 | 6 | 8 | 10 = 4) => ({
  model_id: "veo_omni",
  parameters: { type, upscale, aspect_ratio: "16:9", video_duration, reference_counts: { images, videos } }
});
const rejects = (value: unknown) => assert.throws(
  () => normalizeOwnerVeoOmniGenerationParameters(value),
  (error: unknown) => error instanceof OwnerVeoOmniParametersError && error.code === "INVALID_PARAMETERS"
);

test("Veo Omni static report binds current source and keeps defaults, compatibility, and dispatch unknown", () => {
  const report = getOwnerVeoOmniGenerationParameterReport();
  assert.equal(report.status, "SOURCE_REVIEWED_STATIC_ONLY");
  assert.equal(report.model_id, "veo_omni");
  assert.equal(report.ai_name, "veo3");
  assert.equal(report.source_pins.public_catalog_version,
    "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json");
  assert.equal(report.source_pins.public_models_sha256,
    "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1");
  assert.deepEqual(report.controls.type, ["text", "image", "references"]);
  assert.deepEqual(report.controls.upscale.values, [0, 1, 2, 3]);
  assert.deepEqual(report.controls.upscale.labels, { 0: "720p", 1: "1080p", 2: "4K", 3: "360p Draft" });
  assert.deepEqual(report.controls.aspect_ratio, ["16:9", "9:16"]);
  assert.deepEqual(report.controls.video_duration, [4, 6, 8, 10]);
  assert.deepEqual(report.controls.reference_counts, {
    text: { images: [0, 0], videos: [0, 0] },
    image: { images: [1, 2], videos: [0, 0] },
    references: {
      images_only: { images: [1, 7], videos: [0, 0] },
      one_video_with_images: { images: [0, 5], videos: [1, 1] }
    }
  });
  assert.deepEqual(report.controls.initializer_candidate, {
    type: "text", aspect_ratio: "16:9", video_duration: 8, upscale: 0,
    semantics: "FORM_INITIALIZER_ONLY_NOT_EFFECTIVE_DEFAULT"
  });
  assert.equal(report.effective_defaults, "UNKNOWN");
  assert.equal(report.duration_upscale_compatibility, "UNKNOWN_NOT_ENFORCED");
  assert.equal(report.settings_serializer, "PARTIALLY_JOINED_CALLER_ONLY_NOT_WIRE_CONTRACT");
  assert.equal(report.runtime_usable, false);
  assert.equal(report.dispatch_allowed, false);
  assert.equal(report.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.source_pins.modules), true);
});

test("normalizer validates each source-backed reference-count branch without emitting counts or guessed wire keys", () => {
  const cases = [
    input("text", 0, 0),
    input("image", 1, 0), input("image", 2, 0),
    input("references", 1, 0), input("references", 7, 0),
    input("references", 0, 1), input("references", 5, 1)
  ] as const;
  for (const value of cases) {
    const result = normalizeOwnerVeoOmniGenerationParameters(value);
    assert.deepEqual(result.parameters, {
      type: value.parameters.type,
      upscale: value.parameters.upscale,
      aspect_ratio: value.parameters.aspect_ratio,
      video_duration: value.parameters.video_duration
    });
    assert.equal(Object.hasOwn(result.parameters, "reference_counts"), false);
    for (const guessed of ["mode", "video_ref", "file_urls", "prompt", "chat_id", "n"]) {
      assert.equal(Object.hasOwn(result.parameters, guessed), false);
    }
    assert.equal(result.runtime_usable, false);
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.parameters), true);
  }
});

test("normalizer does not invent a duration-by-upscale restriction and requires explicit values", () => {
  for (const upscale of [0, 1, 2, 3] as const) {
    const value = input("text", 0, 0, upscale, 10);
    assert.equal(normalizeOwnerVeoOmniGenerationParameters(value).parameters.video_duration, 10);
  }
  assert.equal(normalizeOwnerVeoOmniGenerationParameters(input("text", 0, 0, 3, 4)).parameters.video_duration, 4);
  for (const aspect_ratio of ["16:9", "9:16"] as const) {
    assert.equal(normalizeOwnerVeoOmniGenerationParameters({
      model_id: "veo_omni", parameters: { ...input("text", 0, 0).parameters, aspect_ratio }
    }).parameters.aspect_ratio, aspect_ratio);
  }
  for (const duration of [4, 6, 8, 10] as const) {
    assert.equal(normalizeOwnerVeoOmniGenerationParameters(input("text", 0, 0, 0, duration)).parameters.video_duration, duration);
  }
  rejects({ model_id: "veo_omni", parameters: { type: "text", upscale: 0, aspect_ratio: "16:9", reference_counts: { images: 0, videos: 0 } } });
});

test("normalizer rejects invalid combinations, model substitution, and unmodeled fields", () => {
  for (const bad of [
    input("text", 1, 0), input("text", 0, 1), input("image", 0, 0), input("image", 3, 0),
    input("image", 1, 1), input("references", 0, 0), input("references", 8, 0),
    input("references", 6, 1), input("references", 0, 2), input("references", -1, 1),
    { ...input("text", 0, 0), model_id: "veo" },
    { ...input("text", 0, 0), extra: true },
    { ...input("text", 0, 0), url: "caller-url" },
    { ...input("text", 0, 0), parameters: { ...input("text", 0, 0).parameters, type: "audio" } },
    { ...input("text", 0, 0), parameters: { ...input("text", 0, 0).parameters, upscale: 4 } },
    { ...input("text", 0, 0), parameters: { ...input("text", 0, 0).parameters, aspect_ratio: "1:1" } },
    { ...input("text", 0, 0), parameters: { ...input("text", 0, 0).parameters, video_duration: 5 } },
    { ...input("text", 0, 0), parameters: { ...input("text", 0, 0).parameters, video_ref: true } },
    { ...input("text", 0, 0), parameters: { ...input("text", 0, 0).parameters, mode: "video_ref" } }
  ]) rejects(bad);
});

test("normalizer rejects accessors and proxies without evaluating getters", () => {
  let calls = 0;
  const parameters = Object.create(null) as Record<string, unknown>;
  const values = input("text", 0, 0).parameters;
  for (const [key, value] of Object.entries(values)) {
    if (key === "reference_counts") {
      Object.defineProperty(parameters, key, { enumerable: true, get: () => { calls++; return value; } });
    } else Object.defineProperty(parameters, key, { enumerable: true, value });
  }
  rejects({ model_id: "veo_omni", parameters });
  assert.equal(calls, 0);
  rejects(new Proxy(input("text", 0, 0), {}));
});
