import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import {
  OWNER_VEO_T2V_CONTRACT_REGISTRY_VERSION,
  createOwnerVeoT2vProfile,
  isAuthenticOwnerVeoT2vProfile,
  type OwnerVeoT2vModelId
} from "../src/application/owner-veo-t2v-profile.js";

const CATALOG_DIRECTORY = resolve(process.cwd(), "catalog");
const ATTEMPT_ID = "link_veo_profile_test_00000001";
const MODEL_IDS: readonly OwnerVeoT2vModelId[] = ["veo3", "veo3fast", "veo3fast_r"];
const QUALITY_OPTIONS = [
  { value: 0, label: "720p" },
  { value: 1, label: "1080p" },
  { value: 2, label: "4K" }
] as const;
const RATIOS = ["16:9", "9:16"] as const;
const CONTRACT_SCHEMA_HASHES = {
  veo3: "sha256:391a4954cd404a94add5a8a695197f228fa4d6bdf5d19cea5b30a54fc6f2a456",
  veo3fast: "sha256:d4daf9667124f861fd5c64a9d1ce813c09f35c93062bc8596e8b27cc65e0f9c6",
  veo3fast_r: "sha256:579a8d3102e075b38932cf664119dcf14375db47922ebf8e42d4b27df15881a7"
} as const;

test("Veo T2V profiles bind exactly the three source-pinned no-reference models", () => {
  const profiles = MODEL_IDS.map((modelId) => createOwnerVeoT2vProfile(modelId, CATALOG_DIRECTORY));
  assert.ok(profiles.every(isAuthenticOwnerVeoT2vProfile));
  assert.deepEqual(profiles.map((profile) => profile.modelId), MODEL_IDS);
  assert.ok(profiles.every((profile) => profile.registry.contracts.length === 3));
  assert.equal(OWNER_VEO_T2V_CONTRACT_REGISTRY_VERSION,
    "sha256-3724dec65b7b423dee9a18285271aa7b1aa54d56c221ba66453fd18030de2af6.json");
  assert.ok(profiles.every((profile) => profile.source.identity.ai_name === "veo3"));
  assert.ok(profiles.every((profile) => profile.source.identity.model_type === profile.modelId));
  assert.ok(profiles.every((profile) => profile.source.source_pins.current_form_sha256 ===
    "sha256:e626d6b87290f49282bac0523c0896d254c2871a48288917c8f1fbc54a82ea9f"));
  assert.ok(profiles.every((profile) => profile.source.source_pins.public_catalog_version ===
    "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json"));
  assert.ok(profiles.every((profile) => profile.source.source_pins.settings_inventory_version ===
    "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json"));
  assert.ok(profiles.every((profile) => profile.source.source_pins.inventory_form_sha256 ===
    "sha256:df95c89b8d161ce370fdf91fa00e9fa6aaae040c8b3aa543112ebb5d239c83cc"));
  for (const profile of profiles) assert.equal(profile.source.contract_schema_hash, CONTRACT_SCHEMA_HASHES[profile.modelId as OwnerVeoT2vModelId]);
  assert.ok(profiles.every((profile) => profile.source.defaults === "UNKNOWN"));
  assert.ok(profiles.every((profile) => profile.source.runtime_usable === false));
  assert.ok(profiles.every((profile) => profile.source.dispatch_allowed === false));
  assert.ok(profiles.every((profile) => profile.source.backend_acceptance === "UNPROVEN"));
});

test("Veo quality options preserve numeric values and all reviewed ratio-duration choices", () => {
  for (const modelId of MODEL_IDS) {
    const profile = createOwnerVeoT2vProfile(modelId, CATALOG_DIRECTORY);
    assert.deepEqual(profile.source.controls.upscale.options, QUALITY_OPTIONS);
    assert.deepEqual(profile.source.controls.upscale.excluded_options, [
      { value: 3, label: "360p Draft", reason: "NON_OMNI_BRANCH_EXCLUDED" }
    ]);
    assert.deepEqual(profile.source.controls.aspect_ratio.values, RATIOS);
    assert.deepEqual(profile.source.controls.video_duration.values, [8]);
    assert.deepEqual(profile.source.controls.prompt, {
      min_length_from_catalog: 8,
      min_length_basis: "PINNED_PUBLIC_MODEL_CATALOG_MIN_PROMPT_LENGTH",
      source_max_length: "UNKNOWN"
    });
    assert.deepEqual(profile.costParameterFields, ["upscale"]);

    for (const { value: upscale } of QUALITY_OPTIONS) {
      for (const aspect_ratio of RATIOS) {
        const prompt = "A quiet mountain village at sunrise.";
        const normalized = profile.normalizeGenerationInput({
          attemptId: ATTEMPT_ID,
          prompt,
          upscale,
          aspect_ratio,
          video_duration: 8
        });
        assert.deepEqual(normalized.parameters, { prompt, upscale, aspect_ratio, video_duration: 8 });
      }
    }
  }
});

test("Veo contracts seal model type, text mode, and empty references while cost binds only upscale", () => {
  for (const modelId of MODEL_IDS) {
    const profile = createOwnerVeoT2vProfile(modelId, CATALOG_DIRECTORY);
    const contract = profile.registry.contracts.find((entry) => entry.model_id === modelId);
    assert.ok(contract);
    assert.deepEqual(contract.cost_parameter_bindings, {
      upscale: { kind: "parameter", parameter: "upscale" }
    });

    const executor = new GenerationContractExecutorV2(profile.registry, profile.catalog);
    const prepared = executor.prepare({
      model_id: modelId,
      operation_id: "generate-video",
      catalog_version: profile.registry.catalog_version,
      variant_id: profile.variantId,
      parameters: { prompt: "A quiet mountain village at sunrise.", upscale: 2, aspect_ratio: "9:16", video_duration: 8 }
    });
    assert.equal(prepared.ai_name, "veo3");
    assert.deepEqual(prepared.settings, {
      type: "text",
      file_urls: [],
      upscale: 2,
      aspect_ratio: "9:16",
      video_duration: 8,
      model_type: modelId
    });
  }
});

test("Veo input rejects resolution labels, draft quality, and unsupported scalar values", () => {
  const profile = createOwnerVeoT2vProfile("veo3", CATALOG_DIRECTORY);
  const base = { attemptId: ATTEMPT_ID, prompt: "A quiet mountain village at sunrise.", aspect_ratio: "16:9", video_duration: 8 };
  for (const upscale of ["720p", "1080p", "4K", 3, -1, 4, 1.5, null]) {
    assert.throws(() => profile.normalizeGenerationInput({ ...base, upscale }));
  }
  assert.throws(() => profile.normalizeGenerationInput({ ...base, upscale: 0, aspect_ratio: "1:1" }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, upscale: 0, video_duration: 6 }));
  assert.throws(() => profile.normalizeGenerationInput({ ...base, upscale: 0, prompt: "short" }));
});

test("Veo no-reference input is closed to extra type, model, file, or reference fields", () => {
  const profile = createOwnerVeoT2vProfile("veo3fast", CATALOG_DIRECTORY);
  const base = { attemptId: ATTEMPT_ID, prompt: "A quiet mountain village at sunrise.", upscale: 1, aspect_ratio: "9:16", video_duration: 8 };
  for (const extra of [
    { type: "text" },
    { model_type: "veo3fast" },
    { file_urls: [] },
    { reference_image: "local-handle" },
    { references: [] }
  ]) {
    assert.throws(() => profile.normalizeGenerationInput({ ...base, ...extra }));
  }
});

test("Veo profile factory rejects IDs outside the reviewed T2V set", () => {
  assert.throws(() => createOwnerVeoT2vProfile("veo_omni" as OwnerVeoT2vModelId, CATALOG_DIRECTORY),
    /OWNER_VEO_T2V_MODEL_UNSUPPORTED/u);
});
