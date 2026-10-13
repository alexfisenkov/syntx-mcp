import { readFile, realpath } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const VARIANTS = Object.freeze(["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"]);
const RATIOS = Object.freeze(["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"]);
const RESOLUTIONS = Object.freeze({
  "seedream-4": Object.freeze(["1K", "2K", "4K"]),
  "seedream-4.5": Object.freeze(["2K", "4K"]),
  "seedream-5": Object.freeze(["2K", "3K", "4K"]),
  "seedream-5.0-flash": Object.freeze(["1K", "1.5K", "2K"]),
  "seedream-5.0-pro": Object.freeze(["1K", "2K"])
});
const REQUIRED_PATHS = Object.freeze([
  "dist/src/index.js", "dist/src/index.d.ts",
  "dist/src/adapter/syntx/chat-http-client.js", "dist/src/adapter/syntx/chat-http-client.d.ts",
  "dist/src/application/owner-seedream-editor-original-validator.js", "dist/src/application/owner-seedream-editor-original-validator.d.ts",
  "dist/src/application/owner-seedream-editor-original-upload-source-profile.js", "dist/src/application/owner-seedream-editor-original-upload-source-profile.d.ts",
  "dist/src/application/owner-seedream-editor-generation-parameters.js", "dist/src/application/owner-seedream-editor-generation-parameters.d.ts",
  "dist/src/application/owner-seedream-editor-generation-source-profile.js", "dist/src/application/owner-seedream-editor-generation-source-profile.d.ts"
]);

export class SeedreamEditorFoundationInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "SeedreamEditorFoundationInstalledCheckError"; this.code = code; }
}

export function assertSeedreamEditorFoundationPackagePaths(paths) {
  if (!(paths instanceof Set) || REQUIRED_PATHS.some((path) => !paths.has(path))) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_PACKAGE_CONTENT_MISSING");
  if ([...paths].some((path) => path === "src" || path.startsWith("src/"))) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_SOURCE_FALLBACK_PRESENT");
  return true;
}

export function formatSeedreamEditorFoundationSummary(proof) {
  if (!isRecord(proof) || proof.original_upload_posts !== 5 || proof.source_profiles_checked !== 5 ||
      proof.generation_intents_checked !== 104 || proof.generation_calls !== 0 || proof.source_only !== true ||
      proof.provider_backend !== "UNPROVEN" || proof.owner_handle_flow !== "NOT_CHECKED" || proof.editor_mcp !== "NOT_ADDED") {
    fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_SUMMARY_INVALID");
  }
  return "seedream_editor_foundation=PASS original_upload_posts=5 source_profiles=5 generation_intents=104 " +
    "generation_calls=0 source_only=true provider_backend=UNPROVEN owner_handle_flow=NOT_CHECKED editor_mcp=NOT_ADDED";
}

export async function assertInstalledSeedreamEditorFoundation(installedPackagePath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertSeedreamEditorFoundationPackagePaths(packagedPaths);
    if (process.versions.node !== "24.21.0") fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_NODE24_21_REQUIRED");
    if (typeof installedPackagePath !== "string" || !isAbsolute(installedPackagePath)) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_INSTALLED_ROOT_INVALID");
    const packageRoot = await realpath(installedPackagePath);
    if (isPathWithin(PROJECT_ROOT, packageRoot)) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_NOT_CLEAN_PACKAGE");
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    if (manifest?.name !== "syntx-mcp" || manifest?.exports?.["."] !== "./dist/src/index.js" || manifest?.main !== "./dist/src/index.js") {
      fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_NOT_CLEAN_PACKAGE");
    }

    phase = "compiled-imports";
    const importPacked = (path) => import(pathToFileURL(join(packageRoot, path)).href);
    const [api, clientModule, originalModule, originalProfileModule, generationParametersModule, generationProfileModule,
      catalogModule, settingsModule] = await Promise.all([
      importPacked("dist/src/index.js"), importPacked("dist/src/adapter/syntx/chat-http-client.js"),
      importPacked("dist/src/application/owner-seedream-editor-original-validator.js"),
      importPacked("dist/src/application/owner-seedream-editor-original-upload-source-profile.js"),
      importPacked("dist/src/application/owner-seedream-editor-generation-parameters.js"),
      importPacked("dist/src/application/owner-seedream-editor-generation-source-profile.js"),
      importPacked("dist/src/catalog/selected-discovery-catalog.js"), importPacked("dist/src/catalog/mapless-settings-inventory.js")
    ]);
    phase = "public-api-and-declarations";
    const declarations = await Promise.all([
      readFile(join(packageRoot, "dist/src/index.d.ts"), "utf8"),
      readFile(join(packageRoot, "dist/src/adapter/syntx/chat-http-client.d.ts"), "utf8"),
      readFile(join(packageRoot, "dist/src/application/owner-seedream-editor-original-validator.d.ts"), "utf8"),
      readFile(join(packageRoot, "dist/src/application/owner-seedream-editor-original-upload-source-profile.d.ts"), "utf8"),
      readFile(join(packageRoot, "dist/src/application/owner-seedream-editor-generation-parameters.d.ts"), "utf8"),
      readFile(join(packageRoot, "dist/src/application/owner-seedream-editor-generation-source-profile.d.ts"), "utf8")
    ]);
    assertPublicApi(api, { clientModule, originalModule, originalProfileModule, generationParametersModule, generationProfileModule }, declarations);

    phase = "source-profile-and-intent-matrix";
    const sourceProof = assertSourceProfilesAndIntents({ api, originalProfileModule, generationProfileModule,
      generationParametersModule, catalogModule, settingsModule, packageRoot });
    phase = "native-upload-posts";
    const uploadPosts = await assertActualNativeUpload(api, clientModule, originalModule);
    if (uploadPosts !== 5) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_NATIVE_UPLOAD_INVALID");
    return Object.freeze({ original_upload_posts: uploadPosts, source_profiles_checked: sourceProof.profiles,
      generation_intents_checked: sourceProof.intents, generation_calls: 0, source_only: true,
      provider_backend: "UNPROVEN", owner_handle_flow: "NOT_CHECKED", editor_mcp: "NOT_ADDED",
      status: "INSTALLED_SEEDREAM_EDITOR_FOUNDATION_PASS", node_version: process.versions.node, clean_installed_package: true });
  } catch (error) {
    if (error instanceof SeedreamEditorFoundationInstalledCheckError) throw error;
    const name = error instanceof TypeError ? "TypeError" : error instanceof SyntaxError ? "SyntaxError" :
      error instanceof RangeError ? "RangeError" : error instanceof Error ? "Error" : "NonError";
    fail(`INSTALLED_SEEDREAM_EDITOR_FOUNDATION_UNEXPECTED_${phase}_${name}`);
  }
}

function assertPublicApi(api, modules, declarations) {
  const runtime = [
    ["OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY", modules.originalModule],
    ["OwnerSeedreamEditorOriginalInputError", modules.originalModule],
    ["validateOwnerSeedreamEditorOriginalInput", modules.originalModule],
    ["validateOwnerSeedreamEditorOriginalUploadData", modules.originalModule],
    ["OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION", modules.originalProfileModule],
    ["OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION", modules.originalProfileModule],
    ["OwnerSeedreamEditorOriginalUploadSourceProfileError", modules.originalProfileModule],
    ["getOwnerSeedreamEditorOriginalUploadSourceProfile", modules.originalProfileModule],
    ["OWNER_SEEDREAM_EDITOR_GENERATION_PROMPT_LOCAL_BOUND", modules.generationParametersModule],
    ["OwnerSeedreamEditorGenerationParametersError", modules.generationParametersModule],
    ["normalizeOwnerSeedreamEditorGenerationParameters", modules.generationParametersModule],
    ["OwnerSeedreamEditorGenerationSourceProfileError", modules.generationProfileModule],
    ["getOwnerSeedreamEditorGenerationSourceProfile", modules.generationProfileModule]
  ];
  for (const [name, module] of runtime) if (api[name] === undefined || api[name] !== module[name]) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_PUBLIC_EXPORT_MISMATCH");
  if (typeof modules.clientModule.SyntxChatHttpClient !== "function" ||
      typeof modules.clientModule.SyntxChatHttpClient.prototype.uploadSeedreamEditorOriginal !== "function" ||
      api.SyntxChatHttpClient !== modules.clientModule.SyntxChatHttpClient) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_NATIVE_METHOD_MISSING");
  const types = ["OwnerSeedreamEditorOriginalMimeType", "OwnerSeedreamEditorOriginalCanonicalMimeType",
    "OwnerSeedreamEditorOriginalValidationConfidence", "ValidatedOwnerSeedreamEditorOriginal",
    "OwnerSeedreamEditorOriginalUploadCatalogPort", "OwnerSeedreamEditorOriginalUploadSourceProfile",
    "OwnerSeedreamEditorGenerationParametersInput", "OwnerSeedreamEditorGenerationParameters",
    "OwnerSeedreamEditorGenerationSourceProfile"];
  for (const typeName of types) if (Object.hasOwn(api, typeName)) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_TYPE_EXPORTED_AS_VALUE");
  const indexDeclaration = declarations[0];
  const required = [...runtime.map(([name]) => name), ...types];
  if (required.some((name) => !indexDeclaration.includes(name))) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_DECLARATIONS_INVALID");
  const moduleRequirements = [
    [declarations[1], ["uploadSeedreamEditorOriginal(request: unknown, signal?: AbortSignal): Promise<InternalUploadReference>;"]],
    [declarations[2], ["ValidatedOwnerSeedreamEditorOriginal", "OwnerSeedreamEditorOriginalInputError", "validateOwnerSeedreamEditorOriginalInput(input: unknown)", "validateOwnerSeedreamEditorOriginalUploadData(input: unknown)"]],
    [declarations[3], ["OwnerSeedreamEditorOriginalUploadSourceProfile", "OwnerSeedreamEditorOriginalUploadSourceProfileError", "getOwnerSeedreamEditorOriginalUploadSourceProfile("]],
    [declarations[4], ["OwnerSeedreamEditorGenerationParameters", "OwnerSeedreamEditorGenerationParametersError", "normalizeOwnerSeedreamEditorGenerationParameters(input: unknown)"]],
    [declarations[5], ["OwnerSeedreamEditorGenerationSourceProfile", "OwnerSeedreamEditorGenerationSourceProfileError", "getOwnerSeedreamEditorGenerationSourceProfile("]]
  ];
  if (moduleRequirements.some(([declaration, names]) => names.some((name) => !declaration.includes(name)))) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_DECLARATIONS_INVALID");
  const forbidden = ["OwnerSeedreamEditorPreparedCandidate", "OwnerSeedreamEditorOneShotPermit", "OwnerSeedreamEditorOwnedReferenceSet",
    "OwnerSeedreamEditorResolver", "OwnerSeedreamEditorOwnerService", "OwnerSeedreamEditorGenerationService"];
  if (forbidden.some((name) => Object.hasOwn(api, name) || indexDeclaration.includes(name))) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_PRIVATE_API_LEAK");
}

function assertSourceProfilesAndIntents({ api, originalProfileModule, generationProfileModule, generationParametersModule,
  catalogModule, settingsModule, packageRoot }) {
  const catalogDirectory = join(packageRoot, "catalog");
  const catalog = catalogModule.loadSelectedDiscoveryCatalog(api.OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
  const settings = settingsModule.loadMaplessSettingsInventoryVersion(api.OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION, catalogDirectory);
  const policy = api.OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY;
  if (!Object.isFrozen(policy) || policy.max_file_count !== 1 || policy.dispatch_allowed !== false || policy.runtime_usable !== false ||
      policy.backend_acceptance !== "UNPROVEN" || !isDeepStrictEqual(policy.source_max_file_bytes_by_variant,
        { "seedream-4": 10_485_760, "seedream-4.5": 10_485_760, "seedream-5": 10_485_760, "seedream-5.0-flash": 31_457_280, "seedream-5.0-pro": 31_457_280 })) {
    fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_ORIGINAL_POLICY_INVALID");
  }
  let profiles = 0;
  let intents = 0;
  for (const variant of VARIANTS) {
    const original = api.getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, catalog,
      api.OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, settings, api.OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
    const source = api.getOwnerSeedreamEditorGenerationSourceProfile(variant, original);
    if (!isDeepStrictEqual(source, generationProfileModule.getOwnerSeedreamEditorGenerationSourceProfile(variant, original)) ||
        source.variant !== variant || source.navigation_id !== "seedream-editor" || source.scope !== "tool_image_inpaint" ||
        source.source_binding.public_catalog_version !== api.OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION ||
        source.source_binding.settings_inventory_version !== api.OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION ||
        source.runtime_usable !== false || source.generation_allowed !== false || source.dispatch_allowed !== false ||
        source.backend_acceptance !== "UNPROVEN" || source.protocol.settings.stream !== false || source.protocol.settings.n !== 1 ||
        source.protocol.drawing.ownership !== "UNBOUND" || source.protocol.output_count !== "UNPROVEN" || !isDeepFrozen(source)) {
      fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_SOURCE_PROFILE_INVALID");
    }
    if (!isDeepStrictEqual(original, originalProfileModule.getOwnerSeedreamEditorOriginalUploadSourceProfile(variant,
      catalog, api.OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, settings, api.OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION))) {
      fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_SOURCE_PROFILE_INVALID");
    }
    profiles += 1;
    for (const aspect_ratio of RATIOS) for (const resolution of RESOLUTIONS[variant]) {
      const prompt = "installed synthetic intent";
      const actual = api.normalizeOwnerSeedreamEditorGenerationParameters({ variant, prompt, parameters: { aspect_ratio, resolution } });
      const expected = { variant, prompt, parameters: { aspect_ratio, resolution } };
      if (!isDeepStrictEqual(actual, expected) || !isDeepFrozen(actual) ||
          Object.keys(actual).sort().join("|") !== "parameters|prompt|variant" ||
          Object.keys(actual.parameters).sort().join("|") !== "aspect_ratio|resolution") fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_INTENT_MATRIX_INVALID");
      intents += 1;
    }
  }
  if (profiles !== 5 || intents !== 104) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_INTENT_MATRIX_INVALID");
  const paramError = api.OwnerSeedreamEditorGenerationParametersError;
  for (const hostile of [
    { variant: "seedream-5", prompt: "x", parameters: { aspect_ratio: "1:1", resolution: "2K" }, file_urls: ["https://synthetic.invalid/a"] },
    { variant: "seedream-5", prompt: "\ud800", parameters: { aspect_ratio: "1:1", resolution: "2K" } },
    { variant: "seedream-5", prompt: " ", parameters: { aspect_ratio: "1:1", resolution: "2K" } },
    { variant: "seedream-5", prompt: "x", parameters: { aspect_ratio: "1:1", resolution: "8K" } },
    Object.defineProperty({ prompt: "x", parameters: { aspect_ratio: "1:1", resolution: "2K" } }, "variant", { enumerable: true, get() { throw new Error("getter"); } })
  ]) if (!rejectsGeneration(api.normalizeOwnerSeedreamEditorGenerationParameters, paramError, hostile)) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_INTENT_NEGATIVE_CASE_ACCEPTED");
  const tooLong = "x".repeat(32 * 1024 + 1);
  if (!rejectsGeneration(api.normalizeOwnerSeedreamEditorGenerationParameters, paramError,
    { variant: "seedream-5", prompt: tooLong, parameters: { aspect_ratio: "1:1", resolution: "2K" } })) {
    fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_INTENT_NEGATIVE_CASE_ACCEPTED");
  }
  return Object.freeze({ profiles, intents });
}

async function assertActualNativeUpload(api, clientModule, originalModule) {
  const policy = api.OWNER_SEEDREAM_EDITOR_ORIGINAL_INPUT_POLICY;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
  let posts = 0;
  const client = new clientModule.SyntxChatHttpClient({
    credentialBroker: { async useCredential(operation) { return operation("synthetic-installed-editor-credential"); } },
    fetchImpl: async (input, init) => {
      posts += 1;
      const variant = VARIANTS[posts - 1];
      if (String(input) !== "https://api.syntx.ai/api/v1/chats/upload-files" || init?.method !== "POST" || init?.redirect !== "error") {
        fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_NATIVE_UPLOAD_INVALID");
      }
      const form = init.body;
      if (!(form instanceof FormData) || !isDeepStrictEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]) ||
          form.get("destination") !== "uploaded" || form.get("check_duplicates") !== "true" || form.get("model_type") !== variant) {
        fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_NATIVE_UPLOAD_INVALID");
      }
      const file = form.get("files");
      if (!(file instanceof File) || file.type !== "image/jpeg" || file.name !== "original.jpg" || !Buffer.from(await file.arrayBuffer()).equals(jpeg)) {
        fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_NATIVE_UPLOAD_INVALID");
      }
      return new Response(JSON.stringify({ files: [{ id: `synthetic-${posts}`, url: `https://r2.syntx.ai/editor/${posts}.jpg`, mime_type: "image/jpeg", size: jpeg.length }] }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  for (const variant of VARIANTS) {
    const callerBytes = Buffer.from(jpeg);
    const before = Buffer.from(callerBytes);
    const receipt = await client.uploadSeedreamEditorOriginal({ variant, bytes: callerBytes, filename: "original.jpg", mime_type: "image/jpg" });
    if (!isDeepStrictEqual(receipt, { file_id: `synthetic-${posts}`, url: `https://r2.syntx.ai/editor/${posts}.jpg` }) ||
        !callerBytes.equals(before) || posts !== VARIANTS.indexOf(variant) + 1) fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_NATIVE_UPLOAD_INVALID");
  }
  if (posts !== 5 || policy.max_file_count !== 1 || typeof originalModule.validateOwnerSeedreamEditorOriginalInput !== "function") {
    fail("INSTALLED_SEEDREAM_EDITOR_FOUNDATION_NATIVE_UPLOAD_INVALID");
  }
  return posts;
}

function rejectsGeneration(normalize, ErrorType, input) {
  try { normalize(input); return false; }
  catch (error) { return error instanceof ErrorType && error.code === "INVALID_PARAMETERS"; }
}
function isDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every((key) => isDeepFrozen(value[key], seen));
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isPathWithin(root, candidate) {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}
function fail(code) { throw new SeedreamEditorFoundationInstalledCheckError(code); }
