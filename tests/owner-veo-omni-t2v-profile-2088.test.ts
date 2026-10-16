import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { resolve } from "node:path";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import {
  serializeGenerationContractRegistryV2
} from "../src/domain/generation-contract-v2.js";
import { getOwnerVeoOmniGenerationParameterReport } from "../src/application/owner-veo-omni-parameters.js";
import {
  OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID,
  OWNER_VEO_OMNI_T2V_PUBLIC_CATALOG_VERSION,
  buildOwnerVeoOmniT2vGenerationContractInput,
  createOwnerVeoOmniT2vGenerationRegistry,
  createOwnerVeoOmniT2vProfile,
  isAuthenticOwnerVeoOmniT2vProfile,
  normalizeOwnerVeoOmniT2vGenerationInput
} from "../src/application/owner-veo-omni-t2v-profile.js";

const CATALOG_DIRECTORY = resolve(process.cwd(), "catalog");
const REVIEWED_AT = "2026-10-16T16:42:12.000Z";
const ATTEMPT_ID = "link_veo_omni_t2v_2088_000001";
const BASE_INPUT = Object.freeze({
  attemptId: ATTEMPT_ID,
  prompt: "A quiet mountain village at sunrise.",
  upscale: 3,
  aspect_ratio: "9:16",
  video_duration: 4
});

test("Omni T2V profile binds the current source report and one deterministic reviewed contract", () => {
  const profile = createOwnerVeoOmniT2vProfile(CATALOG_DIRECTORY);
  const report = getOwnerVeoOmniGenerationParameterReport();

  assert.equal(isAuthenticOwnerVeoOmniT2vProfile(profile), true);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(profile.modelId, "veo_omni");
  assert.equal(profile.aiName, "veo3");
  assert.equal(profile.modelType, "veo_omni");
  assert.equal(profile.operationId, "generate-video");
  assert.equal(profile.variantId, "veo-omni-t2v-source-reviewed-no-reference");
  assert.equal(OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID, profile.variantId);
  assert.equal(OWNER_VEO_OMNI_T2V_PUBLIC_CATALOG_VERSION,
    "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json");
  assert.equal(profile.source.status, "CURRENT_1792156098_SOURCE_JOIN_OMNI_T2V");
  assert.equal(profile.source.source_pins.source_build_id, "1792156098");
  assert.deepEqual(profile.source.source_pins.modules, report.source_pins.modules);
  assert.equal(profile.source.runtime_usable, false);
  assert.equal(profile.source.dispatch_allowed, false);
  assert.equal(profile.source.backend_acceptance, "UNPROVEN");
  assert.equal(profile.registry.contracts.length, 1);
  assert.equal(profile.registry.contracts[0]?.variant_id, OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID);
  assert.equal(profile.registry.contracts[0]?.provenance.reviewed_at, REVIEWED_AT);

  const serialized = serializeGenerationContractRegistryV2(profile.registry);
  const expectedVersion = `sha256-${createHash("sha256").update(serialized).digest("hex")}.json`;
  assert.equal(profile.registryVersion, expectedVersion);
  assert.equal(profile.registryVersion, createOwnerVeoOmniT2vProfile(CATALOG_DIRECTORY).registryVersion);
});

test("Omni T2V contract prepares text mode, empty local references, all four source values, and cost without mode", () => {
  const catalog = createOwnerVeoOmniT2vProfile(CATALOG_DIRECTORY).catalog;
  const input = buildOwnerVeoOmniT2vGenerationContractInput(catalog, REVIEWED_AT);
  const registry = createOwnerVeoOmniT2vGenerationRegistry(catalog, REVIEWED_AT);
  const contract = registry.contracts[0]!;

  assert.equal(input.variant_id, "veo-omni-t2v-source-reviewed-no-reference");
  assert.deepEqual(contract.cost_parameter_bindings, {
    upscale: { kind: "parameter", parameter: "upscale" },
    video_duration: { kind: "parameter", parameter: "video_duration" }
  });
  assert.deepEqual(contract.wire.fixed_settings, { type: "text", file_urls: [] });
  assert.deepEqual(contract.wire.settings_fields, {
    upscale: "upscale",
    aspect_ratio: "aspect_ratio",
    video_duration: "video_duration"
  });

  const executor = new GenerationContractExecutorV2(registry, catalog);
  for (const upscale of [0, 1, 2, 3] as const) {
    for (const aspect_ratio of ["16:9", "9:16"] as const) {
      for (const video_duration of [4, 6, 8, 10] as const) {
        const prepared = executor.prepare({
          model_id: "veo_omni",
          operation_id: "generate-video",
          catalog_version: registry.catalog_version,
          variant_id: OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID,
          parameters: {
            prompt: BASE_INPUT.prompt,
            upscale,
            aspect_ratio,
            video_duration
          }
        });
        assert.equal(prepared.ai_name, "veo3");
        assert.deepEqual(prepared.settings, {
          type: "text",
          file_urls: [],
          upscale,
          aspect_ratio,
          video_duration,
          model_type: "veo_omni"
        });
      }
    }
  }
});

test("Omni T2V normalizer requires explicit values and returns a closed immutable request", () => {
  const normalized = normalizeOwnerVeoOmniT2vGenerationInput(BASE_INPUT);
  assert.equal(normalized.attemptId, ATTEMPT_ID);
  assert.equal(normalized.prompt, BASE_INPUT.prompt);
  assert.deepEqual(normalized.parameters, {
    prompt: BASE_INPUT.prompt,
    upscale: 3,
    aspect_ratio: "9:16",
    video_duration: 4
  });
  assert.deepEqual(normalized.semanticIntent, normalized.parameters);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.parameters), true);
  assert.equal(Object.hasOwn(normalized.parameters, "mode"), false);
  assert.equal(Object.hasOwn(normalized.parameters, "file_urls"), false);

  for (const extra of [
    { model_id: "veo_omni" }, { model_type: "veo_omni" }, { type: "text" },
    { file_urls: [] }, { references: [] }, { n: 1 }, { mode: "video_ref" }
  ]) {
    assert.throws(() => normalizeOwnerVeoOmniT2vGenerationInput({ ...BASE_INPUT, ...extra }), /INVALID_REQUEST/u);
  }
  for (const bad of [
    { ...BASE_INPUT, upscale: "720p" }, { ...BASE_INPUT, upscale: 4 },
    { ...BASE_INPUT, aspect_ratio: "1:1" }, { ...BASE_INPUT, video_duration: 5 },
    { ...BASE_INPUT, prompt: "short" }, { ...BASE_INPUT, prompt: "bad\u0000text" },
    { ...BASE_INPUT, prompt: "bad\ud800" }
  ]) {
    assert.throws(() => normalizeOwnerVeoOmniT2vGenerationInput(bad), /INVALID_REQUEST/u);
  }
});

test("Omni T2V prompt follows catalog code-point bounds and rejects proxies or accessor inputs", () => {
  const lowerBound = { ...BASE_INPUT, prompt: "12345678" };
  const maxCodePoints = { ...BASE_INPUT, prompt: "🙂".repeat(50_000) };
  assert.equal(normalizeOwnerVeoOmniT2vGenerationInput(lowerBound).parameters.prompt, "12345678");
  assert.equal([...normalizeOwnerVeoOmniT2vGenerationInput(maxCodePoints).prompt].length, 50_000);
  assert.throws(() => normalizeOwnerVeoOmniT2vGenerationInput({ ...BASE_INPUT, prompt: "🙂".repeat(50_001) }), /INVALID_REQUEST/u);

  let getterCalls = 0;
  const accessor = Object.defineProperty({ ...BASE_INPUT }, "prompt", {
    enumerable: true,
    get() { getterCalls += 1; return BASE_INPUT.prompt; }
  });
  assert.throws(() => normalizeOwnerVeoOmniT2vGenerationInput(accessor), /INVALID_REQUEST/u);
  assert.equal(getterCalls, 0);
  assert.throws(() => normalizeOwnerVeoOmniT2vGenerationInput(new Proxy({ ...BASE_INPUT }, {})), /INVALID_REQUEST/u);
});

test("Omni T2V attempt ID requires an exact end with no terminal line break", () => {
  assert.equal(normalizeOwnerVeoOmniT2vGenerationInput(BASE_INPUT).attemptId, ATTEMPT_ID);
  for (const lineBreak of ["\n", "\r\n"]) {
    assert.throws(() => normalizeOwnerVeoOmniT2vGenerationInput({
      ...BASE_INPUT,
      attemptId: `${ATTEMPT_ID}${lineBreak}`
    }), /INVALID_REQUEST/u);
  }
});
