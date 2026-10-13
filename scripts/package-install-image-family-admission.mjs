import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const BANANA = Object.freeze(["banana", "banana-2.1", "banana2", "banana3", "banana3_light"]);
const GPT = Object.freeze(["gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
const RATIOS = Object.freeze([null, "21:9", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "1:1"]);
const BANANA_SIZES = Object.freeze({ banana: [null], "banana-2.1": ["1K", "2K", "4K"], banana2: ["1K", "2K", "4K"], banana3: ["0.5K", "1K", "2K", "4K"], banana3_light: ["1K"] });
const BANANA_THINKING = Object.freeze({ banana: [null], "banana-2.1": ["minimal", "medium", "high"], banana2: [null], banana3: [null], banana3_light: [null] });
const GPT_LEGACY_RATIOS = Object.freeze(["3:2", "1:1", "2:3"]);
const GPT_RATIOS = Object.freeze(["1:1", "16:9", "9:16", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "21:9"]);
const GPT_QUALITIES = Object.freeze(["1K", "2K", "4K"]);
const GPT_DETAILS = Object.freeze({ "gpt-image-2": ["low", "medium", "high"], "gpt-image-2.5-flare": ["low", "medium", "high", "xhigh", "max"], "gpt-image-2.5-sunburst": ["low", "medium", "high", "xhigh", "max"] });
const GPT_LIMITS = Object.freeze({ "gpt-image-1": 5, "gpt-image-1.5": 10, "gpt-image-2": 10, "gpt-image-2.5-flare": 16, "gpt-image-2.5-sunburst": 16 });
const PACKAGE_PATHS = Object.freeze([...[
  "owner-banana-image-parameters", "owner-banana-image-source-profile", "owner-gpt-image-parameters", "owner-gpt-image-source-profile"
].flatMap((name) => [`dist/src/application/${name}.js`, `dist/src/application/${name}.d.ts`])]);

export class ImageFamilyAdmissionError extends Error {
  constructor(code) { super(code); this.name = "ImageFamilyAdmissionError"; this.code = code; }
}

export function assertImageFamilyAdmissionPackagePaths(paths) {
  if (!(paths instanceof Set)) fail("INSTALLED_IMAGE_FAMILY_PACKAGE_PATHS_INVALID");
  if (PACKAGE_PATHS.some((path) => !paths.has(path))) fail("INSTALLED_IMAGE_FAMILY_PACKAGE_CONTENT_MISSING");
  return true;
}

/** Imports only from the extracted, installed package and performs no MCP/provider/auth calls. */
export async function assertInstalledImageFamilyAdmission(installedPackagePath, packagedPaths) {
  assertImageFamilyAdmissionPackagePaths(packagedPaths);
  const importPacked = (path) => import(pathToFileURL(join(installedPackagePath, path)).href);
  let api, selectedModule;
  try {
    [api, selectedModule] = await Promise.all([
      importPacked("dist/src/index.js"),
      importPacked("dist/src/catalog/selected-discovery-catalog.js")
    ]);
  } catch { fail("INSTALLED_IMAGE_FAMILY_MODULE_IMPORT_FAILED"); }
  const requiredExports = ["getOwnerBananaImageSourceParameters", "normalizeOwnerBananaImageParameters", "getOwnerBananaImageSourceProfile",
    "getOwnerGptImageSourceParameters", "normalizeOwnerGptImageParameters", "getOwnerGptImageSourceProfile"];
  if (requiredExports.some((name) => typeof api[name] !== "function")) fail("INSTALLED_IMAGE_FAMILY_ROOT_EXPORT_MISSING");
  const selected = selectedModule.loadSelectedDiscoveryCatalog(CATALOG_VERSION, join(installedPackagePath, "catalog"));
  const actual = collectImageFamilyAdmissionSnapshot(api, selected.discoveryCatalog);
  assertImageFamilyAdmissionSnapshot(actual);
  return Object.freeze({ banana_variants: 5, banana_parameter_cases: actual.banana.matrix_cases, banana_reference_counts: actual.banana.reference_cases,
    gpt_variants: 5, gpt_parameter_cases: actual.gpt.matrix_cases, gpt_reference_counts: actual.gpt.reference_cases,
    profile_count: 10, selected_catalog: CATALOG_VERSION, dispatch_allowed: false, runtime_activation: false,
    provider_calls: 0, auth_calls: 0 });
}

/** The fixture axes below are literals independent from the imported production descriptors. */
export function assertImageFamilyAdmissionSnapshot(value) {
  const { banana, gpt } = value ?? {};
  if (!banana || !gpt || banana.matrix_cases !== 198 || banana.reference_cases !== 65 ||
      gpt.matrix_cases !== 396 || gpt.reference_cases !== 62 || banana.profiles?.length !== 5 || gpt.profiles?.length !== 5 ||
      banana.descriptor?.dispatch_allowed !== false || banana.descriptor?.backend_acceptance !== "UNPROVEN" ||
      gpt.descriptor?.dispatch_allowed !== false || gpt.descriptor?.runtime_activation !== false || gpt.descriptor?.backend_acceptance !== "UNPROVEN") fail("INSTALLED_IMAGE_FAMILY_COVERAGE_MISMATCH");
  if (JSON.stringify(banana.descriptor.variants) !== JSON.stringify(BANANA) ||
      JSON.stringify(gpt.descriptor.variants) !== JSON.stringify(GPT)) fail("INSTALLED_IMAGE_FAMILY_VARIANTS_MISMATCH");
  if (JSON.stringify(banana.descriptor.controls?.aspect_ratio?.values) !== JSON.stringify(RATIOS) ||
      JSON.stringify(banana.descriptor.controls?.image_size?.values_by_variant) !== JSON.stringify(BANANA_SIZES) ||
      JSON.stringify(banana.descriptor.controls?.thinking_level?.values_by_variant) !== JSON.stringify(BANANA_THINKING) ||
      banana.descriptor.controls?.image_size?.inactive_policy !== "BASE_BANANA_NULL_IS_PRESERVED_IN_SOURCE_JSON_CANDIDATE" ||
      JSON.stringify(gpt.descriptor.parameters?.aspect_ratio?.legacy_values) !== JSON.stringify(GPT_LEGACY_RATIOS) ||
      JSON.stringify(gpt.descriptor.parameters?.aspect_ratio?.mapped_values) !== JSON.stringify(GPT_RATIOS) ||
      JSON.stringify(gpt.descriptor.parameters?.quality?.values) !== JSON.stringify(GPT_QUALITIES) ||
      JSON.stringify(gpt.descriptor.parameters?.details_quality?.gpt_image_2_values) !== JSON.stringify(GPT_DETAILS["gpt-image-2"]) ||
      JSON.stringify(gpt.descriptor.parameters?.details_quality?.gpt_image_25_values) !== JSON.stringify(GPT_DETAILS["gpt-image-2.5-flare"])) fail("INSTALLED_IMAGE_FAMILY_DESCRIPTOR_MISMATCH");
  for (const variant of BANANA) {
    const profile = banana.profiles[BANANA.indexOf(variant)];
    const max = variant === "banana" ? 4 : 14;
    if (!profile || profile.variant !== variant || profile.model_id !== variant || profile.ai_name !== "banana" ||
        profile.public_catalog_version !== CATALOG_VERSION || profile.profile_id !== "banana-image-source-reviewed-v1" ||
        profile.reference_count?.minimum !== 0 || profile.reference_count?.maximum !== max ||
        profile.media_limits?.file_size_interpretation !== (variant === "banana-2.1" ? "PER_MEDIA_CATALOG_METADATA" : "ZERO_UNRESOLVED_NOT_UNLIMITED") ||
        profile.media_limits?.prompt_interpretation !== "PUBLIC_ZERO_UNRESOLVED_NOT_UNLIMITED" ||
        profile.media_limits?.provider_acceptance !== "UNPROVEN" || profile.dispatch_allowed !== false ||
        profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN" || profile.effective_defaults !== "UNKNOWN") fail("INSTALLED_BANANA_PROFILE_MISMATCH");
  }
  for (const variant of GPT) {
    const profile = gpt.profiles[GPT.indexOf(variant)];
    const limit = GPT_LIMITS[variant];
    if (!profile || profile.variant !== variant || profile.model_id !== variant || profile.ai_name !== "sora-images" ||
        profile.public_catalog_version !== CATALOG_VERSION || profile.profile_id !== "gpt-image-family-source-reviewed-v1" ||
        profile.reference_count?.minimum !== 0 || profile.reference_count?.maximum !== limit ||
        profile.file_size_metadata?.public_max_file_size !== (variant.startsWith("gpt-image-2.5") ? 33_554_432 : 0) ||
        profile.file_size_metadata?.interpretation !== "PUBLIC_METADATA_ONLY_ZERO_SEMANTICS_UNRESOLVED_NOT_UNLIMITED" ||
        profile.prompt_metadata?.public_max_prompt_length !== 0 || profile.prompt_metadata?.backend_prompt_limit !== "UNPROVEN" ||
        profile.dispatch_allowed !== false || profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN") fail("INSTALLED_GPT_IMAGE_PROFILE_MISMATCH");
  }
  return true;
}

export function collectImageFamilyAdmissionSnapshot(api, catalog) {
  const bananaProfiles = BANANA.map((v) => api.getOwnerBananaImageSourceProfile(v, catalog, CATALOG_VERSION));
  const gptProfiles = GPT.map((v) => api.getOwnerGptImageSourceProfile(v, catalog, CATALOG_VERSION));
  for (const [variant, profile] of [...BANANA.map((v, i) => [v, bananaProfiles[i]]), ...GPT.map((v, i) => [v, gptProfiles[i]])]) {
    const row = catalog.getModel(variant);
    if (!row || row.active !== true || row.runtime_usable !== false || row.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
        profile.source_binding?.selected_public_catalog_version !== CATALOG_VERSION ||
        profile.source_binding?.normalized_public_model?.id !== variant ||
        JSON.stringify(profile.public_settings) !== JSON.stringify(row.settings) ||
        profile.dispatch_allowed !== false || profile.backend_acceptance !== "UNPROVEN") fail("INSTALLED_IMAGE_FAMILY_CATALOG_JOIN_MISMATCH");
  }
  let bananaCases = 0, bananaReferences = 0, gptCases = 0, gptReferences = 0;
  for (const variant of BANANA) {
    for (const aspect_ratio of RATIOS) for (const image_size of BANANA_SIZES[variant]) for (const thinking_level of BANANA_THINKING[variant]) {
      const parameters = { aspect_ratio, image_size, thinking_level };
      const result = api.normalizeOwnerBananaImageParameters({ variant, reference_count: 0, parameters });
      const mapping = { model_type: variant, aspect_ratio, image_size };
      if (variant === "banana-2.1") mapping.thinking_level = thinking_level;
      const cost = variant === "banana" ? {} : { image_size };
      if (JSON.stringify(result.parameters) !== JSON.stringify(parameters) || JSON.stringify(result.source_json_mapping) !== JSON.stringify(mapping) ||
          JSON.stringify(result.cost_inputs) !== JSON.stringify(cost) || result.dispatch_allowed !== false || result.backend_acceptance !== "UNPROVEN") fail("INSTALLED_BANANA_NORMALIZER_MISMATCH");
      bananaCases += 1;
    }
    for (let n = 0; n <= (variant === "banana" ? 4 : 14); n += 1) {
      const parameters = { aspect_ratio: null, image_size: BANANA_SIZES[variant][0], thinking_level: BANANA_THINKING[variant][0] };
      const result = api.normalizeOwnerBananaImageParameters({ variant, reference_count: n, parameters });
      if (result.reference_count !== n || result.reference_binding?.owned_references_bound !== false || result.reference_binding?.provider_acceptance !== "UNPROVEN") fail("INSTALLED_BANANA_REFERENCE_COUNT_MISMATCH");
      bananaReferences += 1;
    }
  }
  for (const variant of GPT) {
    const ratios = variant === "gpt-image-1" || variant === "gpt-image-1.5" ? GPT_LEGACY_RATIOS : GPT_RATIOS;
    const qualities = variant.startsWith("gpt-image-1") ? [null] : GPT_QUALITIES;
    const details = variant.startsWith("gpt-image-1") ? [null] : GPT_DETAILS[variant];
    for (const aspect_ratio of ratios) for (const quality of qualities) for (const details_quality of details) {
      const parameters = { aspect_ratio, quality, details_quality };
      const result = api.normalizeOwnerGptImageParameters({ variant, reference_count: 0, parameters });
      const mapped = !variant.startsWith("gpt-image-1");
      const wire = mapped ? parameters : { aspect_ratio };
      let cost = {};
      if (variant === "gpt-image-2") cost = { quality, details_quality };
      if (variant.startsWith("gpt-image-2.5")) cost = { quality, details_quality };
      if (JSON.stringify(result.parameters) !== JSON.stringify(parameters) || JSON.stringify(result.source_wire_settings) !== JSON.stringify(wire) ||
          JSON.stringify(result.cost_inputs) !== JSON.stringify(cost) || result.dispatch_allowed !== false || result.runtime_activation !== false ||
          result.backend_acceptance !== "UNPROVEN") fail("INSTALLED_GPT_IMAGE_NORMALIZER_MISMATCH");
      gptCases += 1;
    }
    for (let n = 0; n <= GPT_LIMITS[variant]; n += 1) {
      const legacy = variant === "gpt-image-1" || variant === "gpt-image-1.5";
      const result = api.normalizeOwnerGptImageParameters({ variant, reference_count: n,
        parameters: { aspect_ratio: legacy ? "3:2" : "1:1", quality: legacy ? null : "1K", details_quality: legacy ? null : (variant === "gpt-image-2" ? "low" : "low") } });
      // ref_count is conditional; quality and details_quality remain active at zero.
      const expectedCost = variant.startsWith("gpt-image-2.5")
        ? { quality: "1K", details_quality: "low", ...(n === 0 ? {} : { ref_count: n }) }
        : variant === "gpt-image-2" ? { quality: "1K", details_quality: "low" } : {};
      if (JSON.stringify(result.cost_inputs) !== JSON.stringify(expectedCost) || result.reference_count !== n) fail("INSTALLED_GPT_IMAGE_REFERENCE_COST_MISMATCH");
      gptReferences += 1;
    }
  }
  return { banana: { descriptor: api.getOwnerBananaImageSourceParameters(), profiles: bananaProfiles, matrix_cases: bananaCases, reference_cases: bananaReferences },
    gpt: { descriptor: api.getOwnerGptImageSourceParameters(), profiles: gptProfiles, matrix_cases: gptCases, reference_cases: gptReferences } };
}

function fail(code) { throw new ImageFamilyAdmissionError(code); }
