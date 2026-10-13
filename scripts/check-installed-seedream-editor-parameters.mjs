import { readFile, realpath } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class SeedreamEditorParametersInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "SeedreamEditorParametersInstalledCheckError"; this.code = code; }
}

const REQUIRED_PACKAGE_PATHS = Object.freeze([
  "dist/src/index.js", "dist/src/index.d.ts",
  "dist/src/application/owner-seedream-editor-parameters.js",
  "dist/src/application/owner-seedream-editor-parameters.d.ts",
  "dist/src/application/owner-seedream-image-parameters.js",
  "dist/src/application/owner-seedream-image-parameters.d.ts"
]);
const VARIANTS = Object.freeze(["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"]);
const RATIOS = Object.freeze(["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"]);
const ALL_RESOLUTIONS = Object.freeze(["1K", "1.5K", "2K", "3K", "4K"]);
const RESOLUTIONS = Object.freeze({
  "seedream-4": Object.freeze(["1K", "2K", "4K"]),
  "seedream-4.5": Object.freeze(["2K", "4K"]),
  "seedream-5": Object.freeze(["2K", "3K", "4K"]),
  "seedream-5.0-flash": Object.freeze(["1K", "1.5K", "2K"]),
  "seedream-5.0-pro": Object.freeze(["1K", "2K"])
});
const PRO_COST_BATCH_SIZE = Object.freeze({ false: 1, true: 2 });
const EXPECTED_SOURCE_DESCRIPTOR = Object.freeze({
  profile_id: "seedream-editor-explicit-parameters-v1",
  navigation_id: "seedream-editor",
  family: "seedream",
  scope: "tool_image_inpaint",
  model_variants: VARIANTS,
  aspect_ratios: RATIOS,
  resolutions_by_variant: RESOLUTIONS,
  ui_declared_settings: Object.freeze({ model_type: "seedream-5.0-pro", resolution: "2K", aspect_ratio: "1:1", stream: false }),
  effective_defaults: "UNPROVEN",
  settings_cache_behavior: "UNPROVEN",
  settings_reset_behavior: "UNPROVEN",
  full_settings_store: "UNPROVEN",
  cost_projection: Object.freeze({
    status: "SOURCE_JOINED_COST_QUERY_INPUTS",
    declared_keys_by_variant: Object.freeze({
      "seedream-4": Object.freeze([]),
      "seedream-4.5": Object.freeze([]),
      "seedream-5": Object.freeze([]),
      "seedream-5.0-flash": Object.freeze([]),
      "seedream-5.0-pro": Object.freeze(["batch_size", "resolution"])
    }),
    pro_batch_size_input: "can_reset ? 2 : 1",
    pro_batch_size_confidence: "ROOT940_COST_UI_OVERRIDE_NOT_OUTPUT_COUNT",
    pro_resolution_input: "EXPLICIT_EDITOR_PARAMETERS",
    cost_query_only: true,
    generation_wire: "UNPROVEN",
    quote_amount: "UNPROVEN",
    billing_cap: "UNPROVEN",
    generation_output_count: "UNPROVEN",
    source_binding: Object.freeze({
      root: 940,
      form_module: "seedream-editor.js",
      form_sha256: "sha256:2026192d5b0f086446873996ad20cf4691f665d4019621eef3241887ffb3ad7c",
      cost_module: "cost2.js",
      cost_bytes: 1660,
      cost_sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9",
      public_catalog_version: "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json",
      settings_inventory_version: "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json"
    })
  }),
  drawing_role: "IMAGE_EXTRA_NOT_MASK",
  drawing_ownership: "UNBOUND",
  mask_policy: "UNPROVEN",
  result_history: "UNPROVEN",
  source_binding: Object.freeze({
    build_id: "1791467421",
    home_sha256: "a7a68e6ae96547333037962ab9bb3a40ddf7aeb912223d65a9962ab5ce6982da",
    form_module: "seedream-editor.js",
    form_sha256: "sha256:2026192d5b0f086446873996ad20cf4691f665d4019621eef3241887ffb3ad7c",
    parent_module: "InpaintEditor.js",
    parent_sha256: "sha256:87509acda1040d79927edc30d8ddd18d503a6e7ce9387d5d0a059b1eb5028e14",
    generic_helper_module: "useInpaintTool.js",
    generic_helper_sha256: "sha256:de8396adca45a5ba79c9c52cdfa91b23f45285645bed5df120c0f337a192deb2",
    constants_module: "constants2.js",
    constants_sha256: "sha256:636b6f8e15c847f346395027bc83dc3fddf22199d8ab07a32f98d5f0985ccecf",
    settings_helper_module: "settings3.js",
    settings_helper_sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe"
  }),
  runtime_usable: false,
  generation_allowed: false,
  dispatch_allowed: false,
  backend_acceptance: "UNPROVEN"
});
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

export function assertSeedreamEditorParameterPackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_SEEDREAM_EDITOR_PACKAGE_PATHS_INVALID");
  if (REQUIRED_PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) fail("INSTALLED_SEEDREAM_EDITOR_PACKAGE_CONTENT_MISSING");
  if ([...packagedPaths].some((path) => path === "src" || path.startsWith("src/"))) {
    fail("INSTALLED_SEEDREAM_EDITOR_SOURCE_FALLBACK_PRESENT");
  }
  return true;
}

export function assertSeedreamEditorParameterExports(api, parametersModule, indexDeclaration, moduleDeclaration) {
  const runtimeNames = [
    "getOwnerSeedreamEditorSourceParameters", "normalizeOwnerSeedreamEditorParameters",
    "projectOwnerSeedreamEditorCostParameters", "OwnerSeedreamEditorParametersError"
  ];
  if (!isRecord(api) || !isRecord(parametersModule) || runtimeNames.some((name) => api[name] === undefined ||
      api[name] !== parametersModule[name])) fail("INSTALLED_SEEDREAM_EDITOR_PUBLIC_EXPORT_MISMATCH");
  if (typeof api.getOwnerSeedreamEditorSourceParameters !== "function" ||
      typeof api.normalizeOwnerSeedreamEditorParameters !== "function" ||
      typeof api.projectOwnerSeedreamEditorCostParameters !== "function" ||
      typeof api.OwnerSeedreamEditorParametersError !== "function") fail("INSTALLED_SEEDREAM_EDITOR_PUBLIC_EXPORT_MISMATCH");
  const typeOnlyNames = ["OwnerSeedreamEditorVariant", "OwnerSeedreamEditorAspectRatio", "OwnerSeedreamEditorResolution",
    "OwnerSeedreamEditorParameters", "OwnerSeedreamEditorNormalizeInput", "OwnerSeedreamEditorNormalizedIntent",
    "OwnerSeedreamEditorSourceParameters", "ProjectOwnerSeedreamEditorCostParametersInput",
    "OwnerSeedreamEditorCostParameters"];
  if (typeOnlyNames.some((name) => Object.hasOwn(api, name) || Object.hasOwn(parametersModule, name))) {
    fail("INSTALLED_SEEDREAM_EDITOR_TYPE_EXPORTED_AS_RUNTIME_VALUE");
  }
  const requiredDeclarations = [...runtimeNames, ...typeOnlyNames];
  if (typeof indexDeclaration !== "string" || typeof moduleDeclaration !== "string" ||
      requiredDeclarations.some((name) => !indexDeclaration.includes(name)) ||
      requiredDeclarations.some((name) => !moduleDeclaration.includes(name)) ||
      !/export\s+declare\s+class\s+OwnerSeedreamEditorParametersError\b/u.test(moduleDeclaration) ||
      !/export\s+declare\s+function\s+projectOwnerSeedreamEditorCostParameters\s*\(\s*input:\s*unknown\s*\):\s*OwnerSeedreamEditorCostParameters;/u.test(moduleDeclaration)) {
    fail("INSTALLED_SEEDREAM_EDITOR_DECLARATIONS_INVALID");
  }
  for (const forbidden of ["OwnerSeedreamEditorPreparedCandidate", "OwnerSeedreamEditorOneShotPermit",
    "OwnerSeedreamEditorOwnedReferenceSet", "OwnerSeedreamEditorResolver"]) {
    if (Object.hasOwn(api, forbidden) || indexDeclaration.includes(forbidden)) fail("INSTALLED_SEEDREAM_EDITOR_PRIVATE_API_LEAK");
  }
  return true;
}

export function assertSeedreamEditorParameterSource(parametersModule) {
  if (typeof parametersModule?.getOwnerSeedreamEditorSourceParameters !== "function" ||
      typeof parametersModule?.normalizeOwnerSeedreamEditorParameters !== "function" ||
      typeof parametersModule?.projectOwnerSeedreamEditorCostParameters !== "function") fail("INSTALLED_SEEDREAM_EDITOR_COMPILED_API_INVALID");
  let source;
  try { source = parametersModule.getOwnerSeedreamEditorSourceParameters(); }
  catch { fail("INSTALLED_SEEDREAM_EDITOR_SOURCE_DESCRIPTOR_INVALID"); }
  if (!isDeepStrictEqual(source, EXPECTED_SOURCE_DESCRIPTOR) || !isDeepFrozen(source) ||
      !sameArray(source.model_variants, VARIANTS) || !sameArray(source.aspect_ratios, RATIOS) ||
      source.navigation_id !== "seedream-editor" || source.family !== "seedream" || source.scope !== "tool_image_inpaint" ||
      source.runtime_usable !== false || source.generation_allowed !== false || source.dispatch_allowed !== false ||
      source.backend_acceptance !== "UNPROVEN") fail("INSTALLED_SEEDREAM_EDITOR_SOURCE_DESCRIPTOR_INVALID");
  const sourceBinding = source.source_binding;
  if (!/^[a-f0-9]{64}$/u.test(sourceBinding?.home_sha256 ?? "") ||
      [sourceBinding?.form_sha256, sourceBinding?.parent_sha256, sourceBinding?.generic_helper_sha256,
        sourceBinding?.constants_sha256, sourceBinding?.settings_helper_sha256]
        .some((value) => typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value))) {
    fail("INSTALLED_SEEDREAM_EDITOR_SOURCE_PINS_INVALID");
  }
  return true;
}

export function assertSeedreamEditorParameterMatrix(parametersModule) {
  const normalize = parametersModule?.normalizeOwnerSeedreamEditorParameters;
  const projectCost = parametersModule?.projectOwnerSeedreamEditorCostParameters;
  const ErrorType = parametersModule?.OwnerSeedreamEditorParametersError;
  if (typeof normalize !== "function" || typeof projectCost !== "function" || typeof ErrorType !== "function") {
    fail("INSTALLED_SEEDREAM_EDITOR_COMPILED_API_INVALID");
  }
  let combinations = 0;
  let costCombinations = 0;
  for (const variant of VARIANTS) {
    for (const aspect_ratio of RATIOS) {
      for (const resolution of RESOLUTIONS[variant]) {
        const intent = callNormalizer(normalize, ErrorType, { variant, parameters: { aspect_ratio, resolution } });
        if (!isDeepStrictEqual(intent, { variant, parameters: { aspect_ratio, resolution } }) ||
            !isDeepFrozen(intent) || Object.keys(intent).sort().join("|") !== "parameters|variant" ||
            Object.keys(intent.parameters ?? {}).sort().join("|") !== "aspect_ratio|resolution") {
          fail("INSTALLED_SEEDREAM_EDITOR_PARAMETER_MATRIX_INVALID");
        }
        for (const can_reset of [false, true]) {
          const projected = callCostProjector(projectCost, ErrorType,
            { variant, parameters: { aspect_ratio, resolution }, can_reset });
          const expected = variant === "seedream-5.0-pro"
            ? { batch_size: PRO_COST_BATCH_SIZE[String(can_reset)], resolution }
            : {};
          if (!isDeepStrictEqual(projected, expected) || !Object.isFrozen(projected) ||
              Object.keys(projected).sort().join("|") !== Object.keys(expected).sort().join("|")) {
            fail("INSTALLED_SEEDREAM_EDITOR_COST_MATRIX_INVALID");
          }
          costCombinations += 1;
        }
        combinations += 1;
      }
    }
  }
  if (combinations !== 104 || costCombinations !== 208) fail("INSTALLED_SEEDREAM_EDITOR_PARAMETER_MATRIX_INVALID");
  for (const variant of VARIANTS) for (const resolution of ALL_RESOLUTIONS) {
    if (RESOLUTIONS[variant].includes(resolution)) continue;
    if (!rejectsParameters(normalize, ErrorType, { variant, parameters: { aspect_ratio: "1:1", resolution } })) {
      fail("INSTALLED_SEEDREAM_EDITOR_PARAMETER_MATRIX_INVALID");
    }
  }
  for (const invalid of [
    { variant: "seedream-editor", parameters: { aspect_ratio: "1:1", resolution: "2K" } },
    { variant: "seedream-4", parameters: { aspect_ratio: "32:1", resolution: "1K" } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1" } },
    { variant: "seedream-5.0-pro", parameters: { resolution: "2K" } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K", stream: false } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K", model_type: "seedream-5.0-pro" } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K", output_format: "png" } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K", background: "transparent" } },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K" }, cost_inputs: { batch_size: 0 } }
  ]) {
    if (!rejectsParameters(normalize, ErrorType, invalid)) fail("INSTALLED_SEEDREAM_EDITOR_PARAMETER_NEGATIVE_CASE_ACCEPTED");
  }
  const hostileCostInputs = [
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K" }, can_reset: false, output_count: 2 },
    { variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K" }, can_reset: 1 },
    Object.defineProperty({ parameters: { aspect_ratio: "1:1", resolution: "2K" }, can_reset: false }, "variant", {
      enumerable: true, get() { throw new Error("accessor must not run"); }
    }),
    { variant: "seedream-5.0-pro", parameters: Object.defineProperty({}, "resolution", {
      enumerable: true, get() { throw new Error("nested accessor must not run"); }
    }), can_reset: false }
  ];
  for (const input of hostileCostInputs) {
    if (!rejectsCost(projectCost, ErrorType, input)) fail("INSTALLED_SEEDREAM_EDITOR_COST_NEGATIVE_CASE_ACCEPTED");
  }
  const revoked = Proxy.revocable({ variant: "seedream-5.0-pro", parameters: { aspect_ratio: "1:1", resolution: "2K" }, can_reset: false }, {});
  revoked.revoke();
  if (!rejectsCost(projectCost, ErrorType, revoked.proxy)) fail("INSTALLED_SEEDREAM_EDITOR_COST_NEGATIVE_CASE_ACCEPTED");
  return Object.freeze({ variants_checked: VARIANTS.length, combinations_checked: combinations,
    cost_combinations_checked: costCombinations,
    source_only: true, generation_calls: 0 });
}

export function formatSeedreamEditorParameterSummary(proof) {
  if (!isRecord(proof) || proof.variants_checked !== 5 || proof.combinations_checked !== 104 ||
      proof.cost_combinations_checked !== 208 ||
      proof.source_only !== true || proof.generation_calls !== 0) fail("INSTALLED_SEEDREAM_EDITOR_SUMMARY_INVALID");
  return `seedream_editor_parameters=PASS variants=${proof.variants_checked} combinations=${proof.combinations_checked} ` +
    `cost_combinations=${proof.cost_combinations_checked} ` +
    `source_only=${proof.source_only} generation_calls=${proof.generation_calls} backend_acceptance=UNPROVEN`;
}

export async function assertInstalledSeedreamEditorParameters(installedPackagePath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertSeedreamEditorParameterPackagePaths(packagedPaths);
    if (process.versions.node !== "24.21.0") fail("INSTALLED_SEEDREAM_EDITOR_NODE24_21_REQUIRED");
    if (typeof installedPackagePath !== "string" || !isAbsolute(installedPackagePath)) fail("INSTALLED_SEEDREAM_EDITOR_INSTALLED_ROOT_INVALID");
    const packageRoot = await realpath(installedPackagePath);
    if (isPathWithin(PROJECT_ROOT, packageRoot)) fail("INSTALLED_SEEDREAM_EDITOR_NOT_CLEAN_PACKAGE");
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    if (manifest?.name !== "syntx-mcp" || manifest?.exports?.["."] !== "./dist/src/index.js" ||
        manifest?.main !== "./dist/src/index.js") fail("INSTALLED_SEEDREAM_EDITOR_NOT_CLEAN_PACKAGE");
    phase = "compiled-module-import";
    const importPacked = (path) => import(pathToFileURL(join(packageRoot, path)).href);
    const [api, parametersModule] = await Promise.all([
      importPacked("dist/src/index.js"), importPacked("dist/src/application/owner-seedream-editor-parameters.js")
    ]);
    phase = "public-exports";
    assertSeedreamEditorParameterExports(api, parametersModule,
      await readFile(join(packageRoot, "dist/src/index.d.ts"), "utf8"),
      await readFile(join(packageRoot, "dist/src/application/owner-seedream-editor-parameters.d.ts"), "utf8"));
    phase = "source-descriptor";
    assertSeedreamEditorParameterSource(parametersModule);
    phase = "parameter-matrix";
    const proof = assertSeedreamEditorParameterMatrix(parametersModule);
    return Object.freeze({ ...proof, status: "INSTALLED_SEEDREAM_EDITOR_PARAMETERS_PASS", node_version: process.versions.node,
      clean_installed_package: true, backend_acceptance: "UNPROVEN" });
  } catch (error) {
    if (error instanceof SeedreamEditorParametersInstalledCheckError) throw error;
    fail(unexpectedCode(phase, error));
  }
}

function callNormalizer(normalize, ErrorType, input) {
  try { return normalize(input); }
  catch (error) { if (error instanceof ErrorType) fail("INSTALLED_SEEDREAM_EDITOR_PARAMETER_MATRIX_INVALID"); throw error; }
}
function callCostProjector(projectCost, ErrorType, input) {
  try { return projectCost(input); }
  catch (error) { if (error instanceof ErrorType) fail("INSTALLED_SEEDREAM_EDITOR_COST_MATRIX_INVALID"); throw error; }
}
function rejectsParameters(normalize, ErrorType, input) {
  try { normalize(input); return false; }
  catch (error) { return error instanceof ErrorType && error.code === "INVALID_PARAMETERS"; }
}
function rejectsCost(projectCost, ErrorType, input) {
  try { projectCost(input); return false; }
  catch (error) { return error instanceof ErrorType && error.code === "INVALID_PARAMETERS"; }
}
function isDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every((key) => isDeepFrozen(value[key], seen));
}
function sameArray(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isPathWithin(root, candidate) {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}
function unexpectedCode(phase, error) {
  const name = error instanceof TypeError ? "TypeError" : error instanceof SyntaxError ? "SyntaxError" :
    error instanceof RangeError ? "RangeError" : error instanceof Error ? "Error" : "NonError";
  return `INSTALLED_SEEDREAM_EDITOR_UNEXPECTED_${phase}_${name}`;
}
function fail(code) { throw new SeedreamEditorParametersInstalledCheckError(code); }
