import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertImageFamilyAdmissionPackagePaths,
  assertImageFamilyAdmissionSnapshot,
  collectImageFamilyAdmissionSnapshot,
  ImageFamilyAdmissionError
} from "../scripts/package-install-image-family-admission.mjs";

const appNames = ["owner-banana-image-parameters", "owner-banana-image-source-profile", "owner-gpt-image-parameters", "owner-gpt-image-source-profile"];
const packagePaths = new Set(appNames.flatMap((name) => [`dist/src/application/${name}.js`, `dist/src/application/${name}.d.ts`]));
const bananaVariants = ["banana", "banana-2.1", "banana2", "banana3", "banana3_light"];
const gptVariants = ["gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];

function profile(variant, family) {
  const base = { variant, model_id: variant, ai_name: family === "banana" ? "banana" : "sora-images",
    public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    profile_id: family === "banana" ? "banana-image-source-reviewed-v1" : "gpt-image-family-source-reviewed-v1",
    reference_count: { minimum: 0, maximum: variant === "banana" ? 4 : family === "banana" ? 14 : ({ "gpt-image-1": 5, "gpt-image-1.5": 10, "gpt-image-2": 10, "gpt-image-2.5-flare": 16, "gpt-image-2.5-sunburst": 16 })[variant] },
    dispatch_allowed: false, runtime_activation: false, backend_acceptance: "UNPROVEN", effective_defaults: "UNKNOWN" };
  if (family === "banana") base.media_limits = { file_size_interpretation: variant === "banana-2.1" ? "PER_MEDIA_CATALOG_METADATA" : "ZERO_UNRESOLVED_NOT_UNLIMITED",
    prompt_interpretation: "PUBLIC_ZERO_UNRESOLVED_NOT_UNLIMITED", provider_acceptance: "UNPROVEN" };
  else base.file_size_metadata = { public_max_file_size: variant.startsWith("gpt-image-2.5") ? 33_554_432 : 0,
    interpretation: "PUBLIC_METADATA_ONLY_ZERO_SEMANTICS_UNRESOLVED_NOT_UNLIMITED" },
    base.prompt_metadata = { public_max_prompt_length: 0, backend_prompt_limit: "UNPROVEN" };
  return base;
}

function validSnapshot() {
  const ratios = [null, "21:9", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "1:1"];
  const bananaSizes = { banana: [null], "banana-2.1": ["1K", "2K", "4K"], banana2: ["1K", "2K", "4K"], banana3: ["0.5K", "1K", "2K", "4K"], banana3_light: ["1K"] };
  const thinking = { banana: [null], "banana-2.1": ["minimal", "medium", "high"], banana2: [null], banana3: [null], banana3_light: [null] };
  return {
    banana: { matrix_cases: 198, reference_cases: 65, profiles: bananaVariants.map((v) => profile(v, "banana")), descriptor: {
      variants: bananaVariants, dispatch_allowed: false, backend_acceptance: "UNPROVEN", controls: {
        aspect_ratio: { values: ratios }, image_size: { values_by_variant: bananaSizes, inactive_policy: "BASE_BANANA_NULL_IS_PRESERVED_IN_SOURCE_JSON_CANDIDATE" },
        thinking_level: { values_by_variant: thinking }
      }
    } },
    gpt: { matrix_cases: 396, reference_cases: 62, profiles: gptVariants.map((v) => profile(v, "gpt")), descriptor: {
      variants: gptVariants, dispatch_allowed: false, runtime_activation: false, backend_acceptance: "UNPROVEN", parameters: {
        aspect_ratio: { legacy_values: ["3:2", "1:1", "2:3"], mapped_values: ["1:1", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "21:9"] },
        quality: { values: ["1K", "2K", "4K"] }, details_quality: { gpt_image_2_values: ["low", "medium", "high"], gpt_image_25_values: ["low", "medium", "high", "xhigh", "max"] }
      }
    } }
  };
}

test("installed image-family checker requires all four compiled modules and declarations", () => {
  assert.equal(assertImageFamilyAdmissionPackagePaths(packagePaths), true);
  packagePaths.delete("dist/src/application/owner-gpt-image-source-profile.d.ts");
  assert.throws(() => assertImageFamilyAdmissionPackagePaths(packagePaths),
    (error) => error instanceof ImageFamilyAdmissionError && error.code === "INSTALLED_IMAGE_FAMILY_PACKAGE_CONTENT_MISSING");
});

test("installed image-family fixture admits all five variants and full reference-count ranges", () => {
  assert.equal(assertImageFamilyAdmissionSnapshot(validSnapshot()), true);
});

test("installed image-family fixture rejects a changed axis or upgraded proof claim", () => {
  const wrongAxis = validSnapshot();
  wrongAxis.gpt.descriptor.parameters.aspect_ratio.mapped_values.pop();
  assert.throws(() => assertImageFamilyAdmissionSnapshot(wrongAxis),
    (error) => error instanceof ImageFamilyAdmissionError && error.code === "INSTALLED_IMAGE_FAMILY_DESCRIPTOR_MISMATCH");
  const falseProof = validSnapshot();
  falseProof.banana.profiles[0].backend_acceptance = "ACCEPTED";
  assert.throws(() => assertImageFamilyAdmissionSnapshot(falseProof),
    (error) => error instanceof ImageFamilyAdmissionError && error.code === "INSTALLED_BANANA_PROFILE_MISMATCH");
});

test("compiled owner APIs pass all 127 admission reference-count cases and GPT 2.5 cost boundaries", async () => {
  const [api, selectedModule] = await Promise.all([
    import("../dist/src/index.js"),
    import("../dist/src/catalog/selected-discovery-catalog.js")
  ]);
  const version = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
  const selected = selectedModule.loadSelectedDiscoveryCatalog(version, fileURLToPath(new URL("../catalog/", import.meta.url)));
  const snapshot = collectImageFamilyAdmissionSnapshot(api, selected.discoveryCatalog);
  assert.equal(snapshot.banana.reference_cases, 65);
  assert.equal(snapshot.gpt.reference_cases, 62);

  for (const variant of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
    for (let reference_count = 0; reference_count <= 16; reference_count += 1) {
      const normalized = api.normalizeOwnerGptImageParameters({ variant, reference_count,
        parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "low" } });
      const expected = { quality: "1K", details_quality: "low", ...(reference_count === 0 ? {} : { ref_count: reference_count }) };
      assert.deepEqual(normalized.cost_inputs, expected, `${variant} reference_count=${reference_count}`);
    }
  }
});
