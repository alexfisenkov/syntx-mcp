import assert from "node:assert/strict";
import test from "node:test";
import {
  loadPublicCatalogVersion,
  loadSelectedPublicCatalog
} from "../src/catalog/public-catalog-history.js";
import {
  canonicalizeRuntimeCoverageModelId,
  getRuntimeCoverageProfile,
  RUNTIME_COVERAGE_PROFILES,
  assertRuntimeCoverageCatalogCompatible,
  findRuntimeCoverageCatalogDrift
} from "../src/catalog/runtime-coverage-registry.js";

const CURRENT_RUNTIME_CATALOG_VERSION =
  "sha256-5ae9b250f555f4f1c8a6ff49d909bf44a9d1c9c382fc06a46691606e3ac9f8e6.json";

test("runtime coverage drift guard is offline and reports the selected snapshot mismatch clearly", () => {
  const selected = loadSelectedPublicCatalog({ version: CURRENT_RUNTIME_CATALOG_VERSION });

  // The pinned September snapshot predates the new Banana 2.1 profile; keep
  // historical drift checks scoped to the profiles it can actually verify.
  const historicalProfiles = RUNTIME_COVERAGE_PROFILES.filter((profile) => profile.model_id !== "banana-2.1");
  assert.deepEqual(findRuntimeCoverageCatalogDrift(selected.snapshot, historicalProfiles), []);
  assert.doesNotThrow(() => assertRuntimeCoverageCatalogCompatible(selected.snapshot, historicalProfiles));
});

test("runtime coverage drift guard validates provider and modality for every profile", () => {
  const selected = loadPublicCatalogVersion(CURRENT_RUNTIME_CATALOG_VERSION);
  const profiles = RUNTIME_COVERAGE_PROFILES.filter((profile) => profile.model_id !== "banana-2.1");
  assert.doesNotThrow(() =>
    assertRuntimeCoverageCatalogCompatible(selected, profiles)
  );

  const first = profiles[0];
  assert.ok(first);
  const model = selected.models.find((entry) => entry.value === first.model_id);
  assert.ok(model);
  const ai = selected.ai.find((entry) => entry.value === first.ai_name);
  assert.ok(ai);

  const wrongProvider = structuredClone(selected);
  const wrongProviderModel = wrongProvider.models.find(
    (entry) => entry.value === first.model_id
  );
  assert.ok(wrongProviderModel);
  wrongProviderModel.ai_name = "sora-images";
  assert.deepEqual(
    findRuntimeCoverageCatalogDrift(wrongProvider, [first]),
    [
      {
        model_id: first.model_id,
        kind: "ai_name_mismatch",
        expected: first.ai_name,
        actual: "sora-images"
      }
    ]
  );

  const wrongModality = structuredClone(selected);
  const wrongModalityAi = wrongModality.ai.find(
    (entry) => entry.value === first.ai_name
  );
  assert.ok(wrongModalityAi);
  wrongModalityAi.scope = first.modality === "image" ? "video" : "image";
  assert.deepEqual(
    findRuntimeCoverageCatalogDrift(wrongModality, [first]),
    [
      {
        model_id: first.model_id,
        kind: "modality_mismatch",
        expected: first.modality,
        actual: wrongModalityAi.scope
      }
    ]
  );
  void model;
  void ai;
});

test("latest archived catalog keeps complete discovery counts and runtime identity clean", () => {
  const snapshot = loadPublicCatalogVersion(CURRENT_RUNTIME_CATALOG_VERSION);
  const video = snapshot.models.filter((model) => {
    if (!model.active) return false;
    const ai = snapshot.ai.find((entry) => entry.value === model.ai_name);
    return ai?.scope === "video" || ai?.scope === "tool_video_upscaler";
  });
  const image = snapshot.models.filter((model) => {
    if (!model.active) return false;
    const ai = snapshot.ai.find((entry) => entry.value === model.ai_name);
    return ai?.scope === "image" || ai?.scope === "tool_image_upscaler";
  });
  assert.equal(video.length, 65);
  assert.equal(image.length, 41);
  assert.deepEqual(findRuntimeCoverageCatalogDrift(snapshot, RUNTIME_COVERAGE_PROFILES.filter((profile) => profile.model_id !== "banana-2.1")), []);
});

test("new Banana 2.1 profile binds to the current selected public catalog", () => {
  const selected = loadPublicCatalogVersion("sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json");
  const profile = getRuntimeCoverageProfile("banana-2.1");
  assert.ok(profile);
  assert.deepEqual(findRuntimeCoverageCatalogDrift(selected, [profile]), []);
  const model = selected.models.find((candidate) => candidate.value === profile.model_id);
  assert.equal(model?.active, true);
  assert.equal(model?.ai_name, "banana");
});

test("legacy nano-banana-pro is an explicit alias, not a current coverage profile", () => {
  assert.equal(RUNTIME_COVERAGE_PROFILES.some((profile) => profile.model_id === "nano-banana-pro"), false);
  assert.equal(canonicalizeRuntimeCoverageModelId("nano-banana-pro"), "banana");
  assert.equal(getRuntimeCoverageProfile("nano-banana-pro")?.model_id, "banana");
  assert.equal(getRuntimeCoverageProfile("banana")?.ai_name, "banana");
});

test("every live profile exposes an open cancellation contract and redacted output shape", () => {
  for (const profile of RUNTIME_COVERAGE_PROFILES) {
    assert.equal(profile.cancel_mode, "OPEN");
    assert.equal(profile.output_schema.type, "object");
    assert.equal(
      profile.output_schema.artifact_field,
      profile.modality === "image" ? "images" : "videos"
    );
    assert.deepEqual(profile.output_schema.artifact_mime_types, profile.result_mime_types);
    assert.deepEqual(profile.output_schema.required_fields.slice(1), [
      "requested_copies",
      "succeeded_copies",
      "notes"
    ]);
    assert.equal(profile.output_schema.additional_properties, false);
  }
});

test("Sunburst exposes its separately verified settings variant without enabling arbitrary settings", () => {
  const profile = getRuntimeCoverageProfile("gpt-image-2.5-sunburst");
  assert.ok(profile);
  assert.deepEqual(profile.settings_variants, [{
    id: "sunburst-2k-high-16x9",
    settings: {
      model_type: "gpt-image-2.5-sunburst",
      aspect_ratio: "16:9",
      details_quality: "high",
      quality: "2K"
    },
    runtime_verified: true
  }, {
    id: "sunburst-4k-max-21x9",
    settings: {
      model_type: "gpt-image-2.5-sunburst",
      aspect_ratio: "21:9",
      details_quality: "max",
      quality: "4K"
    },
    runtime_verified: true
  }]);
  assert.equal(getRuntimeCoverageProfile("gpt-image-1")?.settings_variants, undefined);
});

test("Flare exposes its separately verified settings variant without enabling arbitrary settings", () => {
  const profile = getRuntimeCoverageProfile("gpt-image-2.5-flare");
  assert.ok(profile);
  assert.deepEqual(profile.settings_variants, [{
    id: "flare-2k-high-16x9",
    settings: {
      model_type: "gpt-image-2.5-flare",
      aspect_ratio: "16:9",
      details_quality: "high",
      quality: "2K"
    },
    runtime_verified: true
  }]);
  assert.equal(
    getRuntimeCoverageProfile("gpt-image-2.5-sunburst")?.settings_variants?.some(
      (variant) => variant.id === "flare-2k-high-16x9"
    ),
    false
  );
});

test("Grok Imagine Quality exposes its exact live-verified defaults", () => {
  const profile = getRuntimeCoverageProfile("grok_imagine_quality");
  assert.ok(profile);
  assert.equal(profile.ai_name, "grok_image");
  assert.deepEqual(profile.settings, {
    model_type: "grok_imagine_quality",
    aspect_ratio: "1:1",
    resolution: "1k",
    batch_size: 1,
    details_quality: "low"
  });
  assert.deepEqual(profile.result_mime_types, ["image/jpeg"]);
});
