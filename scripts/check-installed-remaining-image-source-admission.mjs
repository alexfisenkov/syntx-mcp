import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CATALOG = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const RUNWAY = Object.freeze(["runway_frames"]);
const SEEDREAM = Object.freeze(["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"]);
const FLUX = Object.freeze(["flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"]);
const RESOLUTIONS = Object.freeze({
  runway: ["2112x912", "1920x1088", "1456x1088", "1088x1088", "1088x1456", "1088x1920"],
  seedream: {
    "seedream-4": ["1K", "2K", "4K"], "seedream-4.5": ["2K", "4K"], "seedream-5": ["2K", "3K", "4K"],
    "seedream-5.0-flash": ["1K", "1.5K", "2K"], "seedream-5.0-pro": ["1K", "2K"]
  },
  flux: {
    "flux-1": ["1344x768", "1216x832", "1152x896", "1280x1024", "1024x1024", "1024x1280", "896x1152", "832x1216", "768x1344"],
    "flux-pro-1.1": ["1152x896", "1280x1024"],
    "flux-pro-1.1-ultra": ["3136x1344", "2752x1536", "2368x1792", "2048x2048", "1792x2368", "1536x2752", "1344x3136"]
  }
});
const RATIOS = Object.freeze(["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"]);
const MODULES = Object.freeze([
  "owner-runway-image-parameters", "owner-runway-image-source-profile",
  "owner-seedream-image-parameters", "owner-seedream-image-source-profile",
  "owner-flux-image-parameters", "owner-flux-image-source-profile"
]);

export class RemainingImageSourceAdmissionError extends Error {
  constructor(code) { super(code); this.name = "RemainingImageSourceAdmissionError"; this.code = code; }
}

export function assertRemainingImageSourceAdmissionPackagePaths(paths) {
  if (!(paths instanceof Set)) fail("INSTALLED_REMAINING_IMAGE_PACKAGE_PATHS_INVALID");
  for (const module of MODULES) for (const ext of ["js", "d.ts"]) {
    if (!paths.has(`dist/src/application/${module}.${ext}`)) fail("INSTALLED_REMAINING_IMAGE_PACKAGE_CONTENT_MISSING");
  }
  if (!paths.has("dist/src/index.js") || !paths.has("dist/src/index.d.ts")) fail("INSTALLED_REMAINING_IMAGE_PACKAGE_CONTENT_MISSING");
  return true;
}

/** Reads only the extracted package's compiled entry points and selected pinned catalog. */
export async function assertInstalledRemainingImageSourceAdmission(installedPackagePath, packagedPaths) {
  assertRemainingImageSourceAdmissionPackagePaths(packagedPaths);
  const importPacked = (path) => import(pathToFileURL(join(installedPackagePath, path)).href);
  let api, selectedModule;
  try {
    [api, selectedModule] = await Promise.all([
      importPacked("dist/src/index.js"), importPacked("dist/src/catalog/selected-discovery-catalog.js")
    ]);
  } catch { fail("INSTALLED_REMAINING_IMAGE_MODULE_IMPORT_FAILED"); }
  const selected = selectedModule.loadSelectedDiscoveryCatalog(CATALOG, join(installedPackagePath, "catalog"));
  const snapshot = collectRemainingImageSourceAdmissionSnapshot(api, selected.discoveryCatalog);
  assertRemainingImageSourceAdmissionSnapshot(snapshot);
  return Object.freeze({
    runway_variants: 1, seedream_variants: 5, flux_variants: 3,
    profile_count: snapshot.profiles.length, normalizer_cases: snapshot.normalizer_cases,
    selected_catalog: CATALOG, dispatch_allowed: false, runtime_activation: false,
    provider_calls: 0, auth_calls: 0
  });
}

/** Verifies named source facts and representative independent parameter cases. */
export function collectRemainingImageSourceAdmissionSnapshot(api, catalog) {
  const required = [
    "getOwnerRunwayImageSourceParameters", "normalizeOwnerRunwayImageParameters", "getOwnerRunwayImageSourceProfile",
    "OWNER_SEEDREAM_IMAGE_VARIANTS", "getOwnerSeedreamImageSourceParameters", "normalizeOwnerSeedreamImageParameters", "getOwnerSeedreamImageSourceProfile",
    "OWNER_FLUX_IMAGE_MODELS", "getOwnerFluxImageSourceParameters", "normalizeOwnerFluxImageParameters", "getOwnerFluxImageSourceProfile"
  ];
  if (!api || required.some((name) => !(name in api))) fail("INSTALLED_REMAINING_IMAGE_ROOT_EXPORT_MISSING");
  if (!same(api.OWNER_SEEDREAM_IMAGE_VARIANTS, SEEDREAM) || !same(api.OWNER_FLUX_IMAGE_MODELS, FLUX)) fail("INSTALLED_REMAINING_IMAGE_VARIANTS_MISMATCH");

  const runwayDescriptor = api.getOwnerRunwayImageSourceParameters();
  const seedreamDescriptor = api.getOwnerSeedreamImageSourceParameters();
  const fluxDescriptor = api.getOwnerFluxImageSourceParameters();
  assertDescriptors(runwayDescriptor, seedreamDescriptor, fluxDescriptor);

  const profiles = [];
  const rowFor = (id) => catalog?.getModel?.(id);
  for (const id of RUNWAY) profiles.push(checkProfile(api.getOwnerRunwayImageSourceProfile(id, catalog, CATALOG), rowFor(id), id, "runway", catalog));
  for (const id of SEEDREAM) profiles.push(checkProfile(api.getOwnerSeedreamImageSourceProfile(id, catalog, CATALOG), rowFor(id), id, "seedream", catalog));
  for (const id of FLUX) profiles.push(checkProfile(api.getOwnerFluxImageSourceProfile(id, catalog, CATALOG), rowFor(id), id, "flux", catalog));

  let normalizerCases = 0;
  const runwayTemps = [1, 1.25, 3.5, 5];
  for (const resolution of RESOLUTIONS.runway) for (const temperature of runwayTemps) {
    const result = api.normalizeOwnerRunwayImageParameters({ variant: "runway_frames", reference_count: 3, parameters: { resolution, temperature } });
    if (result.parameters.resolution !== resolution || result.parameters.temperature !== temperature || result.source_wire_settings?.n !== 1 ||
        Object.keys(result.cost_inputs ?? {}).length !== 0 || result.reference_binding?.owned_references_bound !== false) fail("INSTALLED_RUNWAY_NORMALIZER_MISMATCH");
    assertNonActivation(result); normalizerCases++;
  }
  const runwayCounts = [0, 1, 2, 3].map((reference_count) => api.normalizeOwnerRunwayImageParameters({ variant: "runway_frames", reference_count,
    parameters: { resolution: "1088x1088", temperature: 2.5 } }));
  for (let i = 0; i < runwayCounts.length; i++) if (runwayCounts[i].reference_count !== i) fail("INSTALLED_RUNWAY_COUNT_MISMATCH");
  normalizerCases += runwayCounts.length;

  const seedreamSizes = { "seedream-4": 4, "seedream-4.5": 4, "seedream-5": 14, "seedream-5.0-flash": 10, "seedream-5.0-pro": 10 };
  for (const variant of SEEDREAM) {
    for (const resolution of RESOLUTIONS.seedream[variant]) {
      const isFlash = variant === "seedream-5.0-flash";
      const formats = isFlash ? [["jpeg", "opaque"], ["png", "opaque"], ["png", "transparent"]] : [[null, null]];
      for (const [output_format, background] of formats) {
        const reference_count = background === "transparent" ? 1 : 0;
        const input = { variant, reference_count, parameters: { aspect_ratio: "1:1", resolution, output_format, background } };
        if (background === "transparent") input.transparency_context = { reference_count: 1, source_mime_types: ["image/png"], pixel_alpha_eligible: true };
        const result = api.normalizeOwnerSeedreamImageParameters(input);
        const isPro = variant === "seedream-5.0-pro";
        const expectedCost = isPro ? { batch_size: reference_count, resolution } : {};
        if (!same(result.cost_inputs, expectedCost) || result.reference_count !== reference_count || result.wire_settings?.n !== 1 ||
            result.wire_settings?.stream !== false || (isFlash && result.wire_settings.background !== background) ||
            (!isFlash && ("background" in result.wire_settings || "output_format" in result.wire_settings)) ||
            (background === "transparent" && (result.transparency_eligibility?.pixel_alpha_proven !== false ||
              result.transparency_eligibility?.owned_references_bound !== false))) fail("INSTALLED_SEEDREAM_NORMALIZER_MISMATCH");
        assertNonActivation(result); normalizerCases++;
      }
    }
    for (const reference_count of [0, seedreamSizes[variant]]) {
      const result = api.normalizeOwnerSeedreamImageParameters({ variant, reference_count,
        parameters: { aspect_ratio: "1:1", resolution: RESOLUTIONS.seedream[variant][0], output_format: variant === "seedream-5.0-flash" ? "jpeg" : null,
          background: variant === "seedream-5.0-flash" ? "opaque" : null } });
      if (result.reference_count !== reference_count) fail("INSTALLED_SEEDREAM_COUNT_MISMATCH");
      if (variant === "seedream-5.0-pro" && result.cost_inputs.batch_size !== reference_count) fail("INSTALLED_SEEDREAM_PRO_ZERO_COST_MISMATCH");
      normalizerCases++;
    }
  }

  const fluxValues = { cfg: [1, 1.25, 4], steps: [10, 10.5, 28], image_strength: [0, 0.37, 1] };
  const fluxNumericCases = [[1, 10, 0], [1.25, 10.5, 0.37], [4, 28, 1]];
  for (const variant of FLUX) for (const resolution of RESOLUTIONS.flux[variant]) {
    for (const [cfg, steps, image_strength] of fluxNumericCases) {
      const result = api.normalizeOwnerFluxImageParameters({ variant, reference_count: 0, parameters: { resolution, cfg, steps,
        image_strength, workflow_type: "default", raw: variant === "flux-pro-1.1-ultra" ? false : null, civitai_loras: [] } });
      if (result.parameters.cfg !== cfg || result.parameters.steps !== steps || result.parameters.image_strength !== image_strength ||
          result.source_json_mapping?.resolution !== resolution || result.source_json_mapping?.n !== 1 ||
          (variant === "flux-pro-1.1-ultra" && result.source_json_mapping.raw !== false) ||
          (variant !== "flux-pro-1.1-ultra" && "raw" in result.source_json_mapping)) fail("INSTALLED_FLUX_NORMALIZER_MISMATCH");
      assertNonActivation(result); normalizerCases++;
    }
  }
  for (const reference_count of [0, 1]) {
    const loras = reference_count === 0 ? [] : [
      { id: "123", url: "https://civitai.com/api/download/models/123?modelVersionId=456", strength_model: 0.35, strength_clip: 0.35 },
      { id: "456", url: "https://r2.syntx.ai/models/456.safetensors", strength_model: 1, strength_clip: 1 },
      { id: "789", url: "https://civitai.com/models/789/test-model", strength_model: 1.25, strength_clip: 1.25 }
    ];
    const result = api.normalizeOwnerFluxImageParameters({ variant: "flux-1", reference_count,
      parameters: { resolution: "1024x1024", cfg: 2.35, steps: 17.5, image_strength: 0.45,
        workflow_type: reference_count ? "civitai" : "default", raw: null, civitai_loras: loras } });
    if (result.parameters.civitai_loras.length !== loras.length || result.reference_binding?.owned_references_bound !== false ||
        result.source_json_mapping.civitai_loras?.length !== loras.length ||
        (reference_count === 1 && result.parameters.civitai_loras[0]?.url !== loras[0].url)) fail("INSTALLED_FLUX_LORA_METADATA_MISMATCH");
    assertNonActivation(result); normalizerCases++;
  }
  const emptyPro = api.normalizeOwnerFluxImageParameters({ variant: "flux-pro-1.1", reference_count: 0,
    parameters: { resolution: "1152x896", cfg: 2.35, steps: 17.5, image_strength: 0.45, workflow_type: "default", raw: null, civitai_loras: [] } });
  if (Object.keys(emptyPro.cost_inputs ?? {}).length !== 0) fail("INSTALLED_FLUX_EMPTY_COST_MISMATCH");
  assertNonActivation(emptyPro); normalizerCases++;
  return { profiles, normalizer_cases: normalizerCases };
}

export function assertRemainingImageSourceAdmissionSnapshot(snapshot) {
  if (!snapshot || snapshot.profiles?.length !== 9 || snapshot.normalizer_cases < 100) fail("INSTALLED_REMAINING_IMAGE_COVERAGE_MISMATCH");
  for (const profile of snapshot.profiles) {
    if (profile.dispatch_allowed !== false || profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN" ||
        profile.public_catalog_version !== CATALOG || profile.effective_defaults === true) fail("INSTALLED_REMAINING_IMAGE_PROFILE_PROOF_UPGRADE");
  }
  return true;
}

function assertDescriptors(runway, seedream, flux) {
  if (!same(runway.variants, RUNWAY) || runway.parameters?.resolution?.values?.join(",") !== RESOLUTIONS.runway.join(",") ||
      runway.parameters?.temperature?.minimum !== 1 || runway.parameters?.temperature?.maximum !== 5 ||
      runway.parameters?.temperature?.manual_input_policy !== "PRESERVE_FINITE_IN_RANGE_FRACTIONS_NO_QUANTIZATION" ||
      runway.source_pins?.public_catalog !== CATALOG || runway.source_pins?.form_module !== "runway-frames.js" ||
      runway.source_pins?.form_sha256 !== "sha256:1017f19b07dc888fa40ad9bc2d36121975d8c233ef0673bd7a7261b056c25447") fail("INSTALLED_RUNWAY_DESCRIPTOR_MISMATCH");
  if (!same(seedream.variants, SEEDREAM) || !same(seedream.controls?.aspect_ratio?.values, RATIOS) ||
      !same(seedream.controls?.resolution?.values_by_variant, RESOLUTIONS.seedream) ||
      !same(seedream.controls?.output_format?.values, ["jpeg", "png"]) ||
      !same(seedream.controls?.background?.values, ["opaque", "transparent"]) ||
      !same(seedream.controls?.output_format?.active_by_variant, {
        "seedream-4": false, "seedream-4.5": false, "seedream-5": false, "seedream-5.0-flash": true, "seedream-5.0-pro": false
      }) || seedream.inactive_control_policy !== "EXPLICIT_NULL_IN_LOCAL_STATE_OMITTED_FROM_WIRE" ||
      seedream.transparency?.pixel_proof_in_this_layer !== false || seedream.transparency?.owned_reference_binding_in_this_layer !== false ||
      seedream.cost_boundary?.effective_inputs !== "PRO_BATCH_SIZE_EQUALS_EXPLICIT_REFERENCE_COUNT_INCLUDING_ZERO; RESOLUTION_EXPLICIT; OTHERS_EMPTY" ||
      seedream.source_pins?.public_catalog !== CATALOG || seedream.source_pins?.form_module !== "seedream.js" ||
      seedream.source_pins?.form_sha256 !== "sha256:3e762f2725970438f392c18f1d4153e93d4aee1165597e28207a8853a0a5b1d1") fail("INSTALLED_SEEDREAM_DESCRIPTOR_MISMATCH");
  if (!same(flux.models, FLUX) || !same(flux.resolutions, RESOLUTIONS.flux) || flux.numeric_controls?.cfg?.minimum !== 1 ||
      flux.numeric_controls?.cfg?.maximum !== 4 || flux.numeric_controls?.steps?.minimum !== 10 || flux.numeric_controls?.steps?.maximum !== 28 ||
      flux.numeric_controls?.image_strength?.minimum !== 0 || flux.numeric_controls?.image_strength?.maximum !== 1 ||
      flux.numeric_controls?.lora_strength?.maximum !== 1.5 || flux.lora_policy?.maximum !== 3 || flux.lora_policy?.ownership !== "SOURCE_URL_METADATA_ONLY_NATIVE_OWNED_ISSUER_REQUIRED" ||
      flux.lora_policy?.url_query_policy !== "BOUNDED_OPAQUE_NONCREDENTIAL_CIVITAI_QUERY_PRESERVED_R2_QUERY_REJECTED_NO_SECRET_ECHO" ||
      flux.source_pins?.public_catalog_version !== CATALOG || flux.source_pins?.form_module !== "flux.js" ||
      flux.source_pins?.form_sha256 !== "sha256:80307235518f6f0c80952ce4a5a0834ee373d7294f8dc90e58748d57389de664") fail("INSTALLED_FLUX_DESCRIPTOR_MISMATCH");
  for (const descriptor of [runway, seedream, flux]) {
    if (descriptor.dispatch_allowed !== false || descriptor.runtime_activation !== false || descriptor.backend_acceptance !== "UNPROVEN" ||
        ((descriptor.source_execution ?? descriptor.source_pins?.source_execution) !== undefined &&
          (descriptor.source_execution ?? descriptor.source_pins?.source_execution) !== false)) {
      fail("INSTALLED_REMAINING_IMAGE_DESCRIPTOR_PROOF_UPGRADE");
    }
  }
  if (runway.effective_defaults !== "UNKNOWN" || seedream.effective_defaults !== "UNKNOWN" ||
      flux.defaults !== "UNKNOWN_CALLBACK_ORDER_AND_CACHED_UI_NOT_PROVEN") fail("INSTALLED_REMAINING_IMAGE_DESCRIPTOR_DEFAULTS_MISMATCH");
}

function checkProfile(profile, row, id, family, catalog) {
  const profileIds = { runway: "runway-frames-source-reviewed-v1", seedream: "seedream-image-source-reviewed-v1", flux: "flux-image-source-reviewed-v1" };
  const source = profile?.source_binding;
  const model = source?.normalized_public_model;
  if (!row || profile?.profile_id !== profileIds[family] || profile.variant !== id || profile.model_id !== id ||
      profile.ai_name !== row.ai_name || profile.model_type !== id || profile.operation_id !== "generate-image" ||
      profile.public_catalog_version !== CATALOG || source?.selected_public_catalog_version !== CATALOG ||
      source?.selected_public_catalog_fetched_at !== catalog.fetched_at || !same(source?.selected_public_source_hashes, catalog.source_hashes) ||
      !model || model.id !== id || model.upstream_id !== id || model.active !== true || model.scope !== "image" ||
      model.ai_name !== row.ai_name || model.default !== row.default || !same(model.settings, row.settings) ||
      !same(profile.public_settings, row.settings) || profile.dispatch_allowed !== false || profile.runtime_activation !== false ||
      profile.backend_acceptance !== "UNPROVEN" || !profile.profile_schema_hash) fail("INSTALLED_REMAINING_IMAGE_CATALOG_JOIN_MISMATCH");
  if (("catalog_default_flag" in profile && profile.catalog_default_flag !== row.default) ||
      ("public_default" in profile && profile.public_default !== row.default)) fail("INSTALLED_REMAINING_IMAGE_DEFAULT_METADATA_MISMATCH");
  const settings = profile.public_settings;
  if (settings.max_file_size === 0 && profile.file_size_metadata?.interpretation !== "PUBLIC_METADATA_ONLY_ZERO_SEMANTICS_UNRESOLVED_NOT_UNLIMITED" &&
      profile.media_limits?.file_size_interpretation !== "ZERO_UNRESOLVED_NOT_UNLIMITED") fail("INSTALLED_REMAINING_IMAGE_ZERO_SIZE_SEMANTICS_MISMATCH");
  const promptInterpretation = profile.prompt_metadata?.interpretation ?? profile.media_limits?.prompt_interpretation;
  if (settings.max_prompt_length === 0 && promptInterpretation !== undefined &&
      promptInterpretation !== "PUBLIC_ZERO_UNRESOLVED_NOT_UNLIMITED") fail("INSTALLED_REMAINING_IMAGE_ZERO_PROMPT_SEMANTICS_MISMATCH");
  return profile;
}

function assertNonActivation(result) {
  if (result.dispatch_allowed !== false || result.runtime_activation !== false || result.backend_acceptance !== "UNPROVEN") {
    fail("INSTALLED_REMAINING_IMAGE_NORMALIZER_PROOF_UPGRADE");
  }
}
function same(a, b) { return canonical(a) === canonical(b); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function fail(code) { throw new RemainingImageSourceAdmissionError(code); }
