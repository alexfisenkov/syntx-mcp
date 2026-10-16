import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerVeoOmniGenerationParameterReport,
  normalizeOwnerVeoOmniGenerationParameters
} from "../src/application/owner-veo-omni-parameters.js";

const candidate = (type: "text" | "image" | "references", images: number, videos: number) => ({
  model_id: "veo_omni",
  parameters: {
    type,
    upscale: 3 as const,
    aspect_ratio: "9:16" as const,
    video_duration: 10 as const,
    reference_counts: { images, videos }
  }
});

test("source report binds joined modules and keeps shared store settings separate from dispatch payload", () => {
  const report = getOwnerVeoOmniGenerationParameterReport() as unknown as Record<string, unknown>;

  const sourcePins = report.source_pins as Record<string, unknown>;
  assert.equal(sourcePins.source_build_id, "1792156098");
  assert.deepEqual(sourcePins.modules, {
    veo_form: "sha256:75c37d86280482f13b12d5edd546c36c0314cac91c24984aae0a6e9c7ba925a1",
    constants: "sha256:f56c58e705e32b6a4ddfc7cc44e62fd6ca029e6c33a848621812428a365ef2c2",
    video_sender: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b",
    quality_helper: "sha256:7a38ef339db6700d1ccf7fe5a5be23e56722144f216e1db29bf7ff07b8849bf4",
    app: "sha256:eb1b2c82b9f62fbe378064bbd607cdb5cc875a4df1d2ae6f2d531d4baa59f042",
    settings_helper: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
    video_route: "sha256:8310cb1c9ac8221077220da873cfe785e35408b43b1cfba85d409272c9b44596"
  });
  assert.equal(report.settings_serializer, "SOURCE_JOINED_COMMON_SETTINGS_BRANCH_REFERENCES_UNBOUND");
  assert.deepEqual(report.settings_selection, {
    helper_effect: "GLOBAL_SETTINGS_STORE_NOT_PAYLOAD_RETURN",
    dispatch_owner: "VIDEO_ROUTE_NOT_OMNI_FORM",
    truthy_custom_payload: "REPLACE_SETTINGS_SHALLOW_SNAPSHOT",
    otherwise: "SHALLOW_SETTINGS_SNAPSHOT",
    custom_payload_reset: "NULL_ON_RESET_PAGE_SETTINGS",
    references: "OWNED_BINDING_REQUIRED"
  });
  assert.deepEqual(report.cost_projection, {
    caller_keys: ["upscale", "video_duration"],
    video_reference_extra: { mode: "video_ref" },
    mode_in_generation_settings: "NOT_ESTABLISHED_BY_COST_QUERY",
    amount_or_quote: "UNPROVEN"
  });
  assert.equal(report.runtime_usable, false);
  assert.equal(report.dispatch_allowed, false);
  assert.equal(report.backend_acceptance, "UNPROVEN");
});

test("all Omni source branches project cost mode only for the one-video reference branch", () => {
  const cases = [
    { input: candidate("text", 0, 0), wantCost: { upscale: 3, video_duration: 10 } },
    { input: candidate("image", 1, 0), wantCost: { upscale: 3, video_duration: 10 } },
    { input: candidate("references", 7, 0), wantCost: { upscale: 3, video_duration: 10 } },
    { input: candidate("references", 0, 1), wantCost: { upscale: 3, video_duration: 10, mode: "video_ref" } },
    { input: candidate("references", 5, 1), wantCost: { upscale: 3, video_duration: 10, mode: "video_ref" } }
  ] as const;

  for (const { input, wantCost } of cases) {
    const result = normalizeOwnerVeoOmniGenerationParameters(input) as unknown as Record<string, unknown>;
    assert.deepEqual(result.cost_parameters_candidate, wantCost);
    assert.equal(result.cost_projection_status, "SOURCE_DERIVED_READ_ONLY_CANDIDATE_NOT_A_QUOTE");
    assert.deepEqual(result.parameters, {
      type: input.parameters.type,
      upscale: 3,
      aspect_ratio: "9:16",
      video_duration: 10
    });
    assert.equal(Object.hasOwn(result.parameters as object, "mode"), false);
    assert.equal(Object.hasOwn(result.parameters as object, "reference_counts"), false);
    assert.equal(Object.isFrozen(result.cost_parameters_candidate), true);
  }
});

test("cost-only mode cannot be supplied as a generation parameter or as an unmodeled request field", () => {
  const valid = candidate("text", 0, 0);
  assert.throws(() => normalizeOwnerVeoOmniGenerationParameters({
    ...valid,
    parameters: { ...valid.parameters, mode: "video_ref" }
  }), /invalid/i);
  assert.throws(() => normalizeOwnerVeoOmniGenerationParameters({
    ...valid,
    cost_parameters: { mode: "text" }
  }), /invalid/i);
});
