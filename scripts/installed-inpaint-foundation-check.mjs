import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class InpaintFoundationInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "InpaintFoundationInstalledCheckError"; this.code = code; }
}

const VARIANTS = Object.freeze(["banana", "banana2", "banana3", "banana3_light"]);
const INPAINT_C5_PUBLIC_VERSION = "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json";
const INPAINT_62BC_SETTINGS_VERSION = "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json";
const GLOBAL_E551_PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const REQUIRED_PACKAGE_PATHS = Object.freeze([
  "dist/src/adapter/syntx/chat-http-client.js",
  "dist/src/adapter/syntx/chat-http-client.d.ts",
  "dist/src/adapter/syntx/http-client.js",
  "dist/src/adapter/syntx/upload-reference-bridge.js",
  "dist/src/application/owner-banana-inpaint-original-validator.js",
  "dist/src/application/owner-banana-inpaint-original-validator.d.ts",
  "dist/src/application/owner-image-reference-input-validator.js",
  "docs/интеграция/Inpaint-источники-и-границы.md"
]);
const OWNED_ORIGINAL_PACKAGE_PATHS = Object.freeze([
  ...REQUIRED_PACKAGE_PATHS,
  "dist/src/index.js",
  "dist/src/index.d.ts",
  "dist/src/application/owner-banana-inpaint-original-upload-source-profile.js",
  "dist/src/application/owner-banana-inpaint-original-upload-source-profile.d.ts",
  "dist/src/application/owner-banana-inpaint-original-reference-service.js",
  "dist/src/application/owner-banana-inpaint-original-reference-service.d.ts",
  "dist/src/catalog/public-catalog-history.js",
  "dist/src/catalog/selected-discovery-catalog.js",
  "dist/src/catalog/selected-discovery-catalog.d.ts",
  "dist/src/catalog/mapless-settings-inventory.js",
  "dist/src/catalog/mapless-settings-inventory.d.ts",
  "dist/src/catalog/discovery-catalog.js",
  "dist/src/catalog/discovery-catalog.d.ts",
  "dist/src/catalog/syntx-public-catalog.js",
  "dist/src/catalog/syntx-public-catalog.d.ts",
  "dist/src/domain/generation-contract.js",
  "dist/src/domain/generation-contract.d.ts",
  "dist/src/domain/generation-principal.js",
  "dist/src/domain/generation-principal.d.ts",
  "dist/src/auth/owner-reference-principal.js",
  "dist/src/auth/owner-reference-principal.d.ts",
  `catalog/public/${GLOBAL_E551_PUBLIC_VERSION}`,
  `catalog/public/${INPAINT_C5_PUBLIC_VERSION}`,
  `catalog/settings/v2/${INPAINT_62BC_SETTINGS_VERSION}`
]);
const PAINTED_COMPOSITE_PACKAGE_PATHS = Object.freeze([
  ...OWNED_ORIGINAL_PACKAGE_PATHS,
  "dist/src/adapter/syntx/chat-http-client.d.ts",
  "dist/src/application/owner-banana-inpaint-painted-composite-input-validator.js",
  "dist/src/application/owner-banana-inpaint-painted-composite-input-validator.d.ts",
  "dist/src/application/owner-banana-inpaint-painted-composite-source-profile.js",
  "dist/src/application/owner-banana-inpaint-painted-composite-source-profile.d.ts",
  "dist/src/application/owner-banana-inpaint-painted-composite-reference-service.js",
  "dist/src/application/owner-banana-inpaint-painted-composite-reference-service.d.ts"
]);
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const SYNTHETIC_CREDENTIAL = "synthetic-installed-inpaint-credential";

export function assertInpaintFoundationPackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_INPAINT_FOUNDATION_PACKAGE_PATHS_INVALID");
  if (REQUIRED_PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) {
    fail("INSTALLED_INPAINT_FOUNDATION_PACKAGE_CONTENT_MISSING");
  }
  return true;
}

export function assertInpaintFoundationDeclarations(chatDeclaration, validatorDeclaration) {
  if (typeof chatDeclaration !== "string" || typeof validatorDeclaration !== "string" ||
      !chatDeclaration.includes("export declare class SyntxChatHttpClient") ||
      !/createImageInpaintChat\(title: string, signal\?: AbortSignal\): Promise<CreateChatReceipt>/u.test(chatDeclaration) ||
      !/uploadBananaInpaintOriginal\(request: unknown, signal\?: AbortSignal\): Promise<InternalUploadReference>/u.test(chatDeclaration) ||
      !validatorDeclaration.includes("OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY") ||
      !/validateOwnerBananaInpaintOriginalUploadData\(input: unknown\): ValidatedOwnerBananaInpaintOriginal/u.test(validatorDeclaration)) {
    fail("INSTALLED_INPAINT_FOUNDATION_DECLARATIONS_INVALID");
  }
  return true;
}

export function assertInpaintFoundationModuleSurface(clientModule, validatorModule) {
  const clientPrototype = clientModule?.SyntxChatHttpClient?.prototype;
  if (typeof clientPrototype?.createImageInpaintChat !== "function" ||
      typeof clientPrototype?.uploadBananaInpaintOriginal !== "function" ||
      typeof validatorModule?.validateOwnerBananaInpaintOriginalUploadData !== "function" ||
      typeof validatorModule?.validateOwnerBananaInpaintOriginalInput !== "function") {
    fail("INSTALLED_INPAINT_FOUNDATION_METHOD_MISSING");
  }
  const policy = validatorModule.OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY;
  if (policy?.form_id !== "banana-inpaint" || policy?.ai_name !== "banana_inpaint" ||
      policy?.max_file_size_bytes !== 50 * 1024 * 1024 || policy?.max_files !== 1 ||
      policy?.runtime_usable !== false || policy?.size_policy !== "SOURCE_UI_FILE_INPUT_LIMIT_NOT_PROVIDER_LIMIT_OR_DISPATCH_GRANT" ||
      !sameArray(policy.accepted_mime_types, ["image/jpeg", "image/png"])) {
    fail("INSTALLED_INPAINT_FOUNDATION_VALIDATOR_BINDING_INVALID");
  }
  return true;
}

export function assertInpaintGuideBoundary(guideText) {
  if (typeof guideText !== "string") fail("INSTALLED_INPAINT_FOUNDATION_GUIDE_BOUNDARY_INVALID");
  const normalized = guideText.toLowerCase().replace(/\s+/gu, " ");
  if (!normalized.includes("50 mib ui-derived file ceiling is not a provider limit") ||
      !normalized.includes("it creates no reference handle") ||
      !normalized.includes("mask policy") || !normalized.includes("generation permission") ||
      !normalized.includes("original-only reference service") || !normalized.includes("owned painted-composite pair") ||
      !normalized.includes("synthetic installed-package check") ||
      !normalized.includes("does not prove provider acceptance or generation permission")) {
    fail("INSTALLED_INPAINT_FOUNDATION_GUIDE_BOUNDARY_INVALID");
  }
  return true;
}

export function assertInpaintFixedUpstreamUrl(value, routeKind) {
  const expectedPath = routeKind === "chat" ? "/api/v1/chats" :
    routeKind === "upload" ? "/api/v1/chats/upload-files" : undefined;
  if (typeof value !== "string" && !(value instanceof URL)) fail("INSTALLED_INPAINT_FOUNDATION_FIXED_ROUTE_INVALID");
  let url;
  try { url = new URL(String(value)); } catch { fail("INSTALLED_INPAINT_FOUNDATION_FIXED_ROUTE_INVALID"); }
  if (!expectedPath || url.origin !== "https://api.syntx.ai" || url.pathname !== expectedPath || url.search !== "" ||
      url.hash !== "" || url.username !== "" || url.password !== "") {
    fail("INSTALLED_INPAINT_FOUNDATION_FIXED_ROUTE_INVALID");
  }
  return true;
}

export function assertInpaintOwnedOriginalPackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_INPAINT_OWNED_ORIGINAL_PACKAGE_PATHS_INVALID");
  if (OWNED_ORIGINAL_PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) {
    fail("INSTALLED_INPAINT_OWNED_ORIGINAL_PACKAGE_CONTENT_MISSING");
  }
  return true;
}

export function assertInpaintOwnedOriginalCatalogPair({ selected_default_version, public_catalog_version, settings_inventory_version }) {
  if (selected_default_version !== GLOBAL_E551_PUBLIC_VERSION || public_catalog_version !== INPAINT_C5_PUBLIC_VERSION ||
      settings_inventory_version !== INPAINT_62BC_SETTINGS_VERSION) {
    fail("INSTALLED_INPAINT_OWNED_ORIGINAL_SOURCE_PAIR_INVALID");
  }
  return true;
}

export function assertInpaintOwnedOriginalDeclarations(profileDeclaration, serviceDeclaration) {
  if (typeof profileDeclaration !== "string" || typeof serviceDeclaration !== "string" ||
      !profileDeclaration.includes("export declare function getOwnerBananaInpaintOriginalUploadSourceProfile") ||
      !profileDeclaration.includes("OwnerBananaInpaintOriginalUploadSourceProfile") ||
      !serviceDeclaration.includes("export declare class OwnerBananaInpaintOriginalReferenceService") ||
      !serviceDeclaration.includes("upload(input: OwnerBananaInpaintOriginalUploadInput") ||
      !serviceDeclaration.includes("resolveOriginal(input: OwnerBananaInpaintOriginalResolverContext") ||
      !serviceDeclaration.includes("invalidateAttempt(attemptId: string): Promise<void>") ||
      !serviceDeclaration.includes("close(): Promise<void>")) {
    fail("INSTALLED_INPAINT_OWNED_ORIGINAL_DECLARATIONS_INVALID");
  }
  return true;
}

export function assertInpaintOwnedOriginalPublicBarrelDoesNotExport(indexDeclaration) {
  if (typeof indexDeclaration !== "string") fail("INSTALLED_INPAINT_OWNED_ORIGINAL_PUBLIC_BARREL_INVALID");
  const forbidden = ["OwnerBananaInpaintOriginalReferenceService", "OwnerBananaInpaintOriginalPrivateResolution",
    "OwnerBananaInpaintOriginalResolverContext", "OwnerBananaInpaintOriginalUploadSourceProfile"];
  const namedExport = /export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']+["']/gu;
  for (const match of indexDeclaration.matchAll(namedExport)) {
    const names = match[1] ?? "";
    if (forbidden.some((name) => new RegExp(`\\b${name}\\b`, "u").test(names))) {
      fail("INSTALLED_INPAINT_OWNED_ORIGINAL_PRIVATE_BARREL_EXPORT");
    }
  }
  if (/export\s+\*\s+from\s+["'][^"']*owner-banana-inpaint-original-(?:reference-service|upload-source-profile)[^"']*["']/u.test(indexDeclaration)) {
    fail("INSTALLED_INPAINT_OWNED_ORIGINAL_PRIVATE_BARREL_EXPORT");
  }
  return true;
}

export function assertInpaintPaintedCompositePackagePaths(packagedPaths) {
  if (!(packagedPaths instanceof Set)) fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_PACKAGE_PATHS_INVALID");
  if (PAINTED_COMPOSITE_PACKAGE_PATHS.some((path) => !packagedPaths.has(path))) {
    fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_PACKAGE_CONTENT_MISSING");
  }
  return true;
}

export function assertInpaintPaintedCompositeDeclarations(chatDeclaration, validatorDeclaration, profileDeclaration, serviceDeclaration) {
  if (typeof chatDeclaration !== "string" || typeof validatorDeclaration !== "string" ||
      typeof profileDeclaration !== "string" || typeof serviceDeclaration !== "string" ||
      !chatDeclaration.includes("export declare class SyntxChatHttpClient") ||
      !/uploadBananaInpaintPaintedComposite\(request: unknown, signal\?: AbortSignal\): Promise<InternalUploadReference>/u.test(chatDeclaration) ||
      !validatorDeclaration.includes("OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_INPUT_POLICY") ||
      !/validateOwnerBananaInpaintPaintedCompositeInput\(input: unknown\): ValidatedOwnerBananaInpaintPaintedComposite/u.test(validatorDeclaration) ||
      !/validateOwnerBananaInpaintPaintedCompositeUploadData\(input: unknown\): ValidatedOwnerBananaInpaintPaintedComposite/u.test(validatorDeclaration) ||
      !profileDeclaration.includes("export declare function getOwnerBananaInpaintPaintedCompositeSourceProfile") ||
      !profileDeclaration.includes("OwnerBananaInpaintPaintedCompositeSourceProfile") ||
      !serviceDeclaration.includes("export declare class OwnerBananaInpaintPaintedCompositeReferenceService") ||
      !serviceDeclaration.includes("uploadPaintedComposite(input: OwnerBananaInpaintPaintedCompositeUploadInput") ||
      !serviceDeclaration.includes("resolvePaintedComposite(input: OwnerBananaInpaintPaintedCompositeResolverContext") ||
      !serviceDeclaration.includes("invalidateAttempt(attemptId: string): Promise<void>") ||
      !serviceDeclaration.includes("close(): Promise<void>")) {
    fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_DECLARATIONS_INVALID");
  }
  return true;
}

export function assertInpaintPaintedCompositePublicBarrelDoesNotExport(indexDeclaration) {
  if (typeof indexDeclaration !== "string") fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_PUBLIC_BARREL_INVALID");
  const forbidden = ["OwnerBananaInpaintPaintedCompositeReferenceService", "OwnerBananaInpaintPaintedCompositePrivateResolution",
    "OwnerBananaInpaintPaintedCompositeResolverContext", "OwnerBananaInpaintPaintedCompositeSourceProfile"];
  const namedExport = /export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']+["']/gu;
  for (const match of indexDeclaration.matchAll(namedExport)) {
    const names = match[1] ?? "";
    if (forbidden.some((name) => new RegExp(`\\b${name}\\b`, "u").test(names))) {
      fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_PRIVATE_BARREL_EXPORT");
    }
  }
  if (/export\s+\*\s+from\s+["'][^"']*owner-banana-inpaint-painted-composite-(?:reference-service|source-profile)[^"']*["']/u.test(indexDeclaration)) {
    fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_PRIVATE_BARREL_EXPORT");
  }
  return true;
}

export function formatInpaintPaintedCompositePackageSummary(proof) {
  if (proof?.painted_composite !== "INSTALLED_SYNTHETIC_PRIVATE_PAIR_PASS" || proof?.painted_variants_checked !== 4 ||
      proof?.painted_pair_original_upload_posts !== 6 || proof?.painted_pair_upload_attempt_posts !== 6 ||
      proof?.painted_composite_uploads !== 4 || proof?.painted_composite_resolutions !== 4 || proof?.painted_pair_native_posts !== 12 ||
      proof?.painted_geometry_mismatch !== "REJECTED_BEFORE_POST" || proof?.painted_foreign_handle !== "DENIED_OWNER_PRESERVED" ||
      proof?.painted_invalidation_drain !== "PASS" || proof?.painted_close_drain !== "PASS" ||
      proof?.painted_generation_permit !== false || proof?.provider_acceptance !== "UNPROVEN" || proof?.generation !== "NOT_CHECKED") {
    fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_SUMMARY_INVALID");
  }
  return `banana_inpaint_painted_composite=${proof.painted_composite} painted_variants=${proof.painted_variants_checked} ` +
    `painted_pair_original_upload_posts=${proof.painted_pair_original_upload_posts} ` +
    `painted_pair_upload_attempt_posts=${proof.painted_pair_upload_attempt_posts} ` +
    `painted_pair_successful_uploads=${proof.painted_composite_uploads} painted_pair_resolutions=${proof.painted_composite_resolutions} ` +
    `painted_pair_total_posts=${proof.painted_pair_native_posts} geometry_mismatch=${proof.painted_geometry_mismatch} ` +
    `foreign_handle=${proof.painted_foreign_handle} invalidate_drain=${proof.painted_invalidation_drain} ` +
    `close_drain=${proof.painted_close_drain} generation_permit=false provider_acceptance=${proof.provider_acceptance} ` +
    `generation=${proof.generation}`;
}

/** Runs only against the caller-supplied clean npm-installed package path; it never falls back to project dist. */
export async function assertInstalledInpaintFoundation(installedPackagePath, packagedPaths) {
  let phase = "package-paths";
  try {
    assertInpaintFoundationPackagePaths(packagedPaths);
    if (process.versions.node !== "24.21.0") fail("INSTALLED_INPAINT_FOUNDATION_NODE24_21_REQUIRED");
    if (typeof installedPackagePath !== "string" || !isAbsolute(installedPackagePath)) {
      fail("INSTALLED_INPAINT_FOUNDATION_INSTALLED_ROOT_INVALID");
    }
    phase = "installed-root";
    let packageRoot;
    try { packageRoot = await realpath(installedPackagePath); } catch { fail("INSTALLED_INPAINT_FOUNDATION_INSTALLED_ROOT_INVALID"); }
    if (!isAbsolute(packageRoot) || isWithin(PROJECT_ROOT, packageRoot)) {
      fail("INSTALLED_INPAINT_FOUNDATION_NOT_CLEAN_INSTALLED_PACKAGE");
    }
    const packageMeta = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    if (packageMeta?.name !== "syntx-mcp") fail("INSTALLED_INPAINT_FOUNDATION_NOT_CLEAN_INSTALLED_PACKAGE");

    phase = "package-content";
    for (const path of REQUIRED_PACKAGE_PATHS) {
      const target = join(packageRoot, path);
      const targetRealpath = await realpath(target).catch(() => "");
      if (!targetRealpath || !isWithin(packageRoot, targetRealpath) || !(await stat(targetRealpath)).isFile()) {
        fail("INSTALLED_INPAINT_FOUNDATION_PACKAGE_CONTENT_MISSING");
      }
    }
    const guide = await readFile(join(packageRoot, "docs/интеграция/Inpaint-источники-и-границы.md"), "utf8");
    assertInpaintGuideBoundary(guide);
    const chatDeclaration = await readFile(join(packageRoot, "dist/src/adapter/syntx/chat-http-client.d.ts"), "utf8");
    const validatorDeclaration = await readFile(join(packageRoot, "dist/src/application/owner-banana-inpaint-original-validator.d.ts"), "utf8");
    assertInpaintFoundationDeclarations(chatDeclaration, validatorDeclaration);

    phase = "module-import";
    const importPacked = async (path) => {
      const resolved = await realpath(join(packageRoot, path));
      if (!isWithin(packageRoot, resolved)) fail("INSTALLED_INPAINT_FOUNDATION_MODULE_IMPORT_FAILED");
      return import(pathToFileURL(resolved).href);
    };
    let clientModule, validatorModule, httpModule;
    try {
      [clientModule, validatorModule, httpModule] = await Promise.all([
        importPacked("dist/src/adapter/syntx/chat-http-client.js"),
        importPacked("dist/src/application/owner-banana-inpaint-original-validator.js"),
        importPacked("dist/src/adapter/syntx/http-client.js")
      ]);
    } catch { fail("INSTALLED_INPAINT_FOUNDATION_MODULE_IMPORT_FAILED"); }
    assertInpaintFoundationModuleSurface(clientModule, validatorModule);

    phase = "installed-validator";
    const checked = validatorModule.validateOwnerBananaInpaintOriginalUploadData({
      bytes: PNG_1X1, filename: "installed.png", mime_type: "image/png"
    });
    if (checked.size !== PNG_1X1.byteLength || checked.mime_type !== "image/png" ||
        checked.dispatch_allowed !== false || checked.backend_acceptance !== "UNPROVEN" || checked.pixel_decode_verified !== false ||
        Object.hasOwn(checked, "reference_handle") || Object.hasOwn(checked, "url") ||
        Object.getOwnPropertyDescriptor(checked, "bytes")?.enumerable !== false) {
      checked.bytes.fill(0);
      fail("INSTALLED_INPAINT_FOUNDATION_VALIDATOR_BEHAVIOR_INVALID");
    }
    checked.bytes.fill(0);

    phase = "synthetic-native-requests";
    let credentialCalls = 0;
    const calls = [];
    const client = new clientModule.SyntxChatHttpClient({
      credentialBroker: { async useCredential(operation) { credentialCalls += 1; return operation(SYNTHETIC_CREDENTIAL); } },
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        const common = { method: init?.method, redirect: init?.redirect,
          credential_ok: headers.get("authorization") === `Bearer ${SYNTHETIC_CREDENTIAL}` };
        if (url.pathname === "/api/v1/chats") {
          try { assertInpaintFixedUpstreamUrl(url, "chat"); }
          catch { calls.push({ route: "unexpected" }); return jsonResponse({ detail: "synthetic route mismatch" }, 404); }
          let body;
          try { body = JSON.parse(String(init?.body)); } catch { body = null; }
          calls.push({ route: "chat", ...common, body });
          return jsonResponse({ uuid: "installed-inpaint-chat" });
        }
        if (url.pathname === "/api/v1/chats/upload-files" && init?.body instanceof FormData) {
          try { assertInpaintFixedUpstreamUrl(url, "upload"); }
          catch { calls.push({ route: "unexpected" }); return jsonResponse({ detail: "synthetic route mismatch" }, 404); }
          const form = init.body;
          const file = form.get("files");
          const fileBytes = file instanceof File ? Buffer.from(await file.arrayBuffer()) : Buffer.alloc(0);
          const expected = VARIANTS[calls.filter((call) => call.route === "upload").length];
          calls.push({ route: "upload", ...common, keys: Array.from(form.keys()), destination: form.get("destination"),
            check_duplicates: form.get("check_duplicates"), model_type: form.get("model_type"), file_count: form.getAll("files").length,
            filename: file instanceof File ? file.name : null, mime_type: file instanceof File ? file.type : null,
            bytes_match: fileBytes.equals(PNG_1X1), expected_variant: expected });
          fileBytes.fill(0);
          const ordinal = calls.filter((call) => call.route === "upload").length;
          return jsonResponse({ files: [{ id: ordinal, file_id: String(ordinal),
            url: `https://r2.syntx.ai/installed/inpaint-${ordinal}.png`, mime_type: "image/png", size: PNG_1X1.byteLength,
            status: "accepted" }] });
        }
        calls.push({ route: "unexpected" });
        return jsonResponse({ detail: "synthetic route mismatch" }, 404);
      }
    });

    const chatReceipt = await client.createImageInpaintChat("installed-inpaint-foundation");
    if (chatReceipt?.chat_uuid !== "installed-inpaint-chat") fail("INSTALLED_INPAINT_FOUNDATION_CHAT_BEHAVIOR_INVALID");
    const uploadResults = [];
    for (const variant of VARIANTS) {
      const reference = await client.uploadBananaInpaintOriginal({
        variant, bytes: PNG_1X1, filename: "installed.png", mime_type: "image/png"
      });
      uploadResults.push(reference);
    }
    const chats = calls.filter((call) => call.route === "chat");
    const uploads = calls.filter((call) => call.route === "upload");
    if (calls.some((call) => call.route === "unexpected") || chats.length !== 1 || uploads.length !== VARIANTS.length ||
        chats[0]?.method !== "POST" || chats[0]?.redirect !== "error" || chats[0]?.credential_ok !== true ||
        !sameJson(chats[0]?.body, { title: "installed-inpaint-foundation", scope: "tool_image_inpaint" }) ||
        uploads.some((call, index) => call.method !== "POST" || call.redirect !== "error" || call.credential_ok !== true ||
          !sameArray(call.keys, ["files", "destination", "check_duplicates", "model_type"]) || call.destination !== "hidden" ||
          call.check_duplicates !== "true" || call.model_type !== VARIANTS[index] || call.expected_variant !== VARIANTS[index] ||
          call.file_count !== 1 || call.filename !== "installed.png" || call.mime_type !== "image/png" || call.bytes_match !== true) ||
        credentialCalls !== 1 + VARIANTS.length || uploadResults.some((item, index) =>
          item?.file_id !== String(index + 1) || item?.url !== `https://r2.syntx.ai/installed/inpaint-${index + 1}.png` ||
          Object.hasOwn(item, "reference_handle"))) {
      fail("INSTALLED_INPAINT_FOUNDATION_NATIVE_BEHAVIOR_INVALID");
    }

    phase = "negative-input-and-receipt";
    const callsBeforeInvalid = calls.length, credentialsBeforeInvalid = credentialCalls;
    let invalidRejected = false;
    try { await client.uploadBananaInpaintOriginal({ variant: "banana-2.1", bytes: PNG_1X1, filename: "installed.png", mime_type: "image/png" }); }
    catch (error) { invalidRejected = error?.code === "INVALID_REQUEST"; }
    if (!invalidRejected || calls.length !== callsBeforeInvalid || credentialCalls !== credentialsBeforeInvalid) {
      fail("INSTALLED_INPAINT_FOUNDATION_INPUT_GUARD_INVALID");
    }
    const badReceiptClient = new clientModule.SyntxChatHttpClient({
      credentialBroker: { async useCredential(operation) { return operation(SYNTHETIC_CREDENTIAL); } },
      fetchImpl: async () => jsonResponse({ files: [{ url: "https://r2.syntx.ai/installed/rejected.png", mime_type: "image/jpeg" }] })
    });
    let malformedRejected = false;
    try { await badReceiptClient.uploadBananaInpaintOriginal({ variant: "banana", bytes: PNG_1X1,
      filename: "installed.png", mime_type: "image/png" }); }
    catch (error) { malformedRejected = error instanceof httpModule.SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR"; }
    if (!malformedRejected) fail("INSTALLED_INPAINT_FOUNDATION_RECEIPT_GUARD_INVALID");

    phase = "owned-original-service";
    const ownedOriginal = await assertInstalledInpaintOwnedOriginalService(installedPackagePath, packagedPaths);
    phase = "painted-composite-service";
    const paintedComposite = await assertInstalledInpaintPaintedCompositeService(installedPackagePath, packagedPaths);
    return Object.freeze({ package: "CLEAN_INSTALLED_TARBALL", runtime: "PASS", chat_posts: 1,
      hidden_upload_posts: uploads.length, variants_checked: VARIANTS.length, strict_receipts: "PASS",
      invalid_input_before_auth: "PASS", provider_acceptance: "UNPROVEN", owner_generation: "NOT_CHECKED",
      ...ownedOriginal, ...paintedComposite });
  } catch (error) {
    if (error instanceof InpaintFoundationInstalledCheckError) throw error;
    fail(unexpectedCode(phase, error));
  }
}

export async function assertInstalledInpaintOwnedOriginalService(installedPackagePath, packagedPaths) {
  let phase = "owned-package-paths";
  try {
    assertInpaintOwnedOriginalPackagePaths(packagedPaths);
    if (process.versions.node !== "24.21.0") fail("INSTALLED_INPAINT_OWNED_ORIGINAL_NODE24_21_REQUIRED");
    if (typeof installedPackagePath !== "string" || !isAbsolute(installedPackagePath)) {
      fail("INSTALLED_INPAINT_OWNED_ORIGINAL_INSTALLED_ROOT_INVALID");
    }
    phase = "owned-installed-root";
    let packageRoot;
    try { packageRoot = await realpath(installedPackagePath); } catch { fail("INSTALLED_INPAINT_OWNED_ORIGINAL_INSTALLED_ROOT_INVALID"); }
    if (!isAbsolute(packageRoot) || isWithin(PROJECT_ROOT, packageRoot)) {
      fail("INSTALLED_INPAINT_OWNED_ORIGINAL_NOT_CLEAN_INSTALLED_PACKAGE");
    }
    const packageMeta = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    if (packageMeta?.name !== "syntx-mcp") fail("INSTALLED_INPAINT_OWNED_ORIGINAL_NOT_CLEAN_INSTALLED_PACKAGE");
    for (const path of OWNED_ORIGINAL_PACKAGE_PATHS) {
      const targetRealpath = await realpath(join(packageRoot, path)).catch(() => "");
      if (!targetRealpath || !isWithin(packageRoot, targetRealpath) || !(await stat(targetRealpath)).isFile()) {
        fail("INSTALLED_INPAINT_OWNED_ORIGINAL_PACKAGE_CONTENT_MISSING");
      }
    }

    phase = "owned-declarations";
    const profileDeclaration = await readFile(join(packageRoot,
      "dist/src/application/owner-banana-inpaint-original-upload-source-profile.d.ts"), "utf8");
    const serviceDeclaration = await readFile(join(packageRoot,
      "dist/src/application/owner-banana-inpaint-original-reference-service.d.ts"), "utf8");
    assertInpaintOwnedOriginalDeclarations(profileDeclaration, serviceDeclaration);
    const indexDeclaration = await readFile(join(packageRoot, "dist/src/index.d.ts"), "utf8");
    assertInpaintOwnedOriginalPublicBarrelDoesNotExport(indexDeclaration);
    const publicDeclaration = await readFile(join(packageRoot, "dist/src/index.d.ts"), "utf8");
    assertInpaintOwnedOriginalPublicBarrelDoesNotExport(publicDeclaration);

    phase = "owned-module-import";
    const importPacked = async (path) => {
      const resolved = await realpath(join(packageRoot, path));
      if (!isWithin(packageRoot, resolved)) fail("INSTALLED_INPAINT_OWNED_ORIGINAL_MODULE_IMPORT_FAILED");
      return import(pathToFileURL(resolved).href);
    };
    let profileModule, serviceModule, selectedModule, settingsModule, clientModule;
    try {
      [profileModule, serviceModule, selectedModule, settingsModule, clientModule] = await Promise.all([
        importPacked("dist/src/application/owner-banana-inpaint-original-upload-source-profile.js"),
        importPacked("dist/src/application/owner-banana-inpaint-original-reference-service.js"),
        importPacked("dist/src/catalog/selected-discovery-catalog.js"),
        importPacked("dist/src/catalog/mapless-settings-inventory.js"),
        importPacked("dist/src/adapter/syntx/chat-http-client.js")
      ]);
    } catch { fail("INSTALLED_INPAINT_OWNED_ORIGINAL_MODULE_IMPORT_FAILED"); }
    if (typeof profileModule.getOwnerBananaInpaintOriginalUploadSourceProfile !== "function" ||
        typeof serviceModule.OwnerBananaInpaintOriginalReferenceService !== "function" ||
        typeof clientModule.SyntxChatHttpClient !== "function" ||
        typeof selectedModule.loadSelectedDiscoveryCatalog !== "function" ||
        typeof settingsModule.loadMaplessSettingsInventoryVersion !== "function") {
      fail("INSTALLED_INPAINT_OWNED_ORIGINAL_MODULE_EXPORTS_INVALID");
    }
    const profileApi = profileModule;
    const profileVersions = {
      public_catalog_version: profileApi.OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
      settings_inventory_version: profileApi.OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION
    };
    assertInpaintOwnedOriginalCatalogPair({
      selected_default_version: selectedModule.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
      ...profileVersions
    });
    if (!sameArray(profileApi.OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS, VARIANTS)) {
      fail("INSTALLED_INPAINT_OWNED_ORIGINAL_VARIANT_SET_INVALID");
    }

    phase = "owned-c5-62-profile";
    const catalogDirectory = join(packageRoot, "catalog");
    const selectedC5 = selectedModule.loadSelectedDiscoveryCatalog(profileVersions.public_catalog_version, catalogDirectory);
    if (selectedC5.runtimeCapabilities !== null) fail("INSTALLED_INPAINT_OWNED_ORIGINAL_C5_RUNTIME_PROMOTED");
    const settings62 = settingsModule.loadMaplessSettingsInventoryVersion(profileVersions.settings_inventory_version, catalogDirectory);
    const selectedE551 = selectedModule.loadSelectedDiscoveryCatalog(GLOBAL_E551_PUBLIC_VERSION, catalogDirectory);
    let legacyCatalogRejected = false;
    try {
      profileApi.getOwnerBananaInpaintOriginalUploadSourceProfile("banana", selectedE551.discoveryCatalog,
        profileVersions.public_catalog_version, settings62, profileVersions.settings_inventory_version);
    } catch (error) { legacyCatalogRejected = error?.code === "PROFILE_BINDING_MISMATCH"; }
    if (!legacyCatalogRejected) fail("INSTALLED_INPAINT_OWNED_ORIGINAL_LEGACY_CATALOG_ACCEPTED");
    const profiles = VARIANTS.map((variant) => profileApi.getOwnerBananaInpaintOriginalUploadSourceProfile(
      variant, selectedC5.discoveryCatalog, profileVersions.public_catalog_version,
      settings62, profileVersions.settings_inventory_version));
    if (profiles.some((profile, index) => profile.profile_id !== "banana-inpaint-original-upload-source-profile-v1" ||
        profile.variant !== VARIANTS[index] || profile.model_id !== VARIANTS[index] || profile.model_type !== VARIANTS[index] ||
        profile.family_ai_name !== "banana" || profile.form_ai_name !== "banana_inpaint" || profile.form_id !== "banana-inpaint" ||
        profile.public_catalog_version !== profileVersions.public_catalog_version ||
        profile.settings_inventory_version !== profileVersions.settings_inventory_version ||
        profile.input_policy?.size_scope !== "SOURCE_UI_FILE_INPUT_LIMIT_NOT_PROVIDER_LIMIT" ||
        profile.input_policy?.max_file_bytes !== 50 * 1024 * 1024 || profile.input_policy?.max_file_count !== 1 ||
        profile.input_policy?.destination !== "hidden" || profile.input_policy?.check_duplicates !== true ||
        profile.input_policy?.model_type_source !== "EXPLICIT_UNDERLYING_BANANA_VARIANT" ||
        profile.runtime_usable !== false || profile.runtime_activation !== false || profile.dispatch_allowed !== false ||
        profile.backend_acceptance !== "UNPROVEN" || !/^sha256:[a-f0-9]{64}$/u.test(profile.profile_schema_hash) ||
        ["cost_policy", "cost_inputs", "reference_count", "mask_permission", "generation_permission"]
          .some((key) => Object.hasOwn(profile, key)))) {
      fail("INSTALLED_INPAINT_OWNED_ORIGINAL_SOURCE_PROFILE_INVALID");
    }

    phase = "owned-service-execution";
    const attemptId = "link_installed_inpaint_owned_original_0123456789";
    const binding = Object.freeze({ tenant_id: "installed-inpaint-owned-tenant", subject: "installed-inpaint-owned-subject" });
    const syntheticCredential = "synthetic-installed-owned-inpaint-credential";
    let credentialCalls = 0, linkStatusReads = 0, fetchCalls = 0, routeMismatch = false;
    const uploadRecords = [];
    const fetchImpl = async (input, init) => {
      fetchCalls += 1;
      const url = new URL(String(input));
      try { assertInpaintFixedUpstreamUrl(url, "upload"); }
      catch { routeMismatch = true; return jsonResponse({ detail: "synthetic route mismatch" }, 404); }
      const authorization = new Headers(init?.headers).get("authorization");
      const form = init?.body instanceof FormData ? init.body : undefined;
      const file = form?.get("files");
      const bytes = file instanceof File ? Buffer.from(await file.arrayBuffer()) : Buffer.alloc(0);
      const modelType = form?.get("model_type");
      const ordinal = uploadRecords.length + 1;
      uploadRecords.push({ method: init?.method, redirect: init?.redirect, authorization_ok: authorization === `Bearer ${syntheticCredential}`,
        keys: form ? Array.from(form.keys()) : [], destination: form?.get("destination"), check_duplicates: form?.get("check_duplicates"),
        model_type: modelType, bytes_match: bytes.equals(PNG_1X1), filename: file instanceof File ? file.name : null,
        mime_type: file instanceof File ? file.type : null, file_count: form?.getAll("files").length ?? 0,
        expected_model_type: VARIANTS[ordinal - 1] ?? "banana" });
      bytes.fill(0);
      return jsonResponse({ files: [{ id: `owned-${ordinal}`, file_id: `owned-${ordinal}`,
        url: `https://r2.syntx.ai/installed/inpaint-owned-${ordinal}.png`, mime_type: "image/png", size: PNG_1X1.byteLength,
        status: "accepted" }] });
    };
    const client = new clientModule.SyntxChatHttpClient({
      credentialBroker: { async useCredential(operation) { credentialCalls += 1; return operation(syntheticCredential); } },
      fetchImpl
    });
    const linkedAttempt = (id) => ({ attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
      status: "LINKED", expires_at: null, linked: true });
    const linkService = { async getStatus(_binding, id) { linkStatusReads += 1; return linkedAttempt(id); } };
    const Service = serviceModule.OwnerBananaInpaintOriginalReferenceService;
    const service = new Service({ binding, linkService, catalog: selectedC5.discoveryCatalog,
      public_catalog_version: profileVersions.public_catalog_version, settings_inventory: settings62,
      settings_inventory_version: profileVersions.settings_inventory_version, resolveClient: () => client });
    const receipts = [];
    try {
      for (const variant of VARIANTS) receipts.push(await service.upload({ attemptId, variant,
        content_base64: PNG_1X1.toString("base64"), filename: "installed-original.png", mime_type: "image/png" }));
      if (routeMismatch || fetchCalls !== VARIANTS.length || credentialCalls !== VARIANTS.length ||
          uploadRecords.length !== VARIANTS.length || uploadRecords.some((entry, index) => entry.method !== "POST" ||
            entry.redirect !== "error" || entry.authorization_ok !== true ||
            !sameArray(entry.keys, ["files", "destination", "check_duplicates", "model_type"]) ||
            entry.destination !== "hidden" || entry.check_duplicates !== "true" || entry.model_type !== VARIANTS[index] ||
            entry.expected_model_type !== VARIANTS[index] || entry.bytes_match !== true ||
            entry.filename !== "installed-original.png" || entry.mime_type !== "image/png" || entry.file_count !== 1) ||
          receipts.some((receipt, index) => receipt.status !== "uploaded" || receipt.variant !== VARIANTS[index] ||
            typeof receipt.reference_handle !== "string" || receipt.mime_type !== "image/png" ||
            Object.hasOwn(receipt, "file_url") || Object.hasOwn(receipt, "url") || Object.hasOwn(receipt, "file_id") ||
            Object.hasOwn(receipt, "principal") || Object.hasOwn(receipt, "mask_permission") || Object.hasOwn(receipt, "generation_permit")) ||
          linkStatusReads !== VARIANTS.length * 2) {
        fail("INSTALLED_INPAINT_OWNED_ORIGINAL_UPLOAD_BEHAVIOR_INVALID");
      }

      let successfulResolutions = 0;
      const contextFor = (receipt, variant) => ({ principal: { tenant_id: binding.tenant_id, subject_id: binding.subject,
        connection_id: attemptId }, attempt_id: attemptId, variant, form_id: "banana-inpaint", source_role: "inpaint_original",
        public_catalog_version: profileVersions.public_catalog_version,
        settings_inventory_version: profileVersions.settings_inventory_version,
        profile_schema_hash: profiles[VARIANTS.indexOf(variant)].profile_schema_hash,
        reference_handle: receipt.reference_handle });
      const firstContext = contextFor(receipts[0], VARIANTS[0]);
      const foreignContext = { ...firstContext, principal: { ...firstContext.principal, subject_id: "foreign-subject" } };
      let foreignDenied = false;
      try { await service.resolveOriginal(foreignContext); }
      catch (error) { foreignDenied = error?.code === "PRINCIPAL_NOT_LINKED"; }
      if (!foreignDenied) fail("INSTALLED_INPAINT_OWNED_ORIGINAL_FOREIGN_CONTEXT_ACCEPTED");
      for (let index = 0; index < VARIANTS.length; index += 1) {
        const resolved = await service.resolveOriginal(contextFor(receipts[index], VARIANTS[index]));
        if (resolved.role !== "inpaint_original" || resolved.wire_type !== "image" || resolved.variant !== VARIANTS[index] ||
            resolved.file_url !== `https://r2.syntx.ai/installed/inpaint-owned-${index + 1}.png` ||
            resolved.generation_permit !== false || Object.hasOwn(resolved, "mask_permission")) {
          fail("INSTALLED_INPAINT_OWNED_ORIGINAL_RESOLUTION_INVALID");
        }
        successfulResolutions += 1;
      }
      // A rejected foreign principal must not destroy the rightful owner's handle.
      const afterForeign = await service.resolveOriginal(firstContext);
      if (afterForeign.file_url !== "https://r2.syntx.ai/installed/inpaint-owned-1.png") {
        fail("INSTALLED_INPAINT_OWNED_ORIGINAL_FOREIGN_CONTEXT_DESTROYED_OWNER");
      }
      successfulResolutions += 1;
      await service.invalidateAttempt(attemptId);
      let invalidatedDenied = false;
      try { await service.resolveOriginal(firstContext); }
      catch (error) { invalidatedDenied = error?.code === "REFERENCE_UNAVAILABLE" || error?.code === "REQUEST_ABORTED"; }
      if (!invalidatedDenied) fail("INSTALLED_INPAINT_OWNED_ORIGINAL_INVALIDATION_FAILED");
      await service.close();
      let closedDenied = false;
      try { await service.resolveOriginal(firstContext); }
      catch (error) { closedDenied = error?.code === "SERVICE_CLOSED"; }
      if (!closedDenied) fail("INSTALLED_INPAINT_OWNED_ORIGINAL_CLOSE_FAILED");

      // Separate close probe proves close alone denies an extant handle.
      const closeAttempt = "link_installed_inpaint_owned_close_0123456789";
      const closeService = new Service({ binding, linkService, catalog: selectedC5.discoveryCatalog,
        public_catalog_version: profileVersions.public_catalog_version, settings_inventory: settings62,
        settings_inventory_version: profileVersions.settings_inventory_version, resolveClient: () => client });
      const closeReceipt = await closeService.upload({ attemptId: closeAttempt, variant: "banana",
        content_base64: PNG_1X1.toString("base64"), filename: "close-probe.png", mime_type: "image/png" });
      const closeContext = { ...contextFor(closeReceipt, "banana"), attempt_id: closeAttempt,
        principal: { tenant_id: binding.tenant_id, subject_id: binding.subject, connection_id: closeAttempt } };
      await closeService.close();
      let closeProbeDenied = false;
      try { await closeService.resolveOriginal(closeContext); }
      catch (error) { closeProbeDenied = error?.code === "SERVICE_CLOSED"; }
      if (!closeProbeDenied) fail("INSTALLED_INPAINT_OWNED_ORIGINAL_CLOSE_DID_NOT_REVOKE_HANDLE");
      if (fetchCalls !== VARIANTS.length + 1 || credentialCalls !== VARIANTS.length + 1 || routeMismatch || linkStatusReads !== 22) {
        fail("INSTALLED_INPAINT_OWNED_ORIGINAL_REQUEST_COUNT_INVALID");
      }
      return Object.freeze({ source_profile_pair: "c5+62bc", variants_checked: VARIANTS.length,
        variant_uploads: VARIANTS.length, variant_resolutions: VARIANTS.length, successful_resolutions: successfulResolutions,
        foreign_principal: "DENIED_WITH_VALID_OWNER_PRESERVED", invalidation: "PASS", close: "PASS",
        lifecycle_close_probe_uploads: 1, provider_acceptance: "UNPROVEN", mcp_tools: "NOT_CHECKED", generation: "NOT_CHECKED" });
    } finally { await service.close(); }
  } catch (error) {
    if (error instanceof InpaintFoundationInstalledCheckError) throw error;
    throw new InpaintFoundationInstalledCheckError(`INSTALLED_INPAINT_OWNED_ORIGINAL_${phase.toUpperCase().replace(/-/gu, "_")}_FAILED`);
  }
}

export async function assertInstalledInpaintPaintedCompositeService(installedPackagePath, packagedPaths) {
  let phase = "painted-package-paths";
  try {
    assertInpaintPaintedCompositePackagePaths(packagedPaths);
    if (process.versions.node !== "24.21.0") fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_NODE24_21_REQUIRED");
    if (typeof installedPackagePath !== "string" || !isAbsolute(installedPackagePath)) {
      fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_INSTALLED_ROOT_INVALID");
    }
    phase = "painted-installed-root";
    let packageRoot;
    try { packageRoot = await realpath(installedPackagePath); } catch { fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_INSTALLED_ROOT_INVALID"); }
    if (!isAbsolute(packageRoot) || isWithin(PROJECT_ROOT, packageRoot)) {
      fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_NOT_CLEAN_INSTALLED_PACKAGE");
    }
    const packageMeta = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    if (packageMeta?.name !== "syntx-mcp") fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_NOT_CLEAN_INSTALLED_PACKAGE");
    for (const path of PAINTED_COMPOSITE_PACKAGE_PATHS) {
      const targetRealpath = await realpath(join(packageRoot, path)).catch(() => "");
      if (!targetRealpath || !isWithin(packageRoot, targetRealpath) || !(await stat(targetRealpath)).isFile()) {
        fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_PACKAGE_CONTENT_MISSING");
      }
    }

    phase = "painted-declarations";
    const chatDeclaration = await readFile(join(packageRoot, "dist/src/adapter/syntx/chat-http-client.d.ts"), "utf8");
    const validatorDeclaration = await readFile(join(packageRoot,
      "dist/src/application/owner-banana-inpaint-painted-composite-input-validator.d.ts"), "utf8");
    const profileDeclaration = await readFile(join(packageRoot,
      "dist/src/application/owner-banana-inpaint-painted-composite-source-profile.d.ts"), "utf8");
    const serviceDeclaration = await readFile(join(packageRoot,
      "dist/src/application/owner-banana-inpaint-painted-composite-reference-service.d.ts"), "utf8");
    assertInpaintPaintedCompositeDeclarations(chatDeclaration, validatorDeclaration, profileDeclaration, serviceDeclaration);
    const indexDeclaration = await readFile(join(packageRoot, "dist/src/index.d.ts"), "utf8");
    assertInpaintOwnedOriginalPublicBarrelDoesNotExport(indexDeclaration);
    assertInpaintPaintedCompositePublicBarrelDoesNotExport(indexDeclaration);

    phase = "painted-module-import";
    const importPacked = async (path) => {
      const resolved = await realpath(join(packageRoot, path));
      if (!isWithin(packageRoot, resolved)) fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_MODULE_IMPORT_FAILED");
      return import(pathToFileURL(resolved).href);
    };
    let originalProfileModule, originalServiceModule, paintedValidatorModule, paintedProfileModule,
      paintedServiceModule, selectedModule, settingsModule, clientModule;
    try {
      [originalProfileModule, originalServiceModule, paintedValidatorModule, paintedProfileModule,
        paintedServiceModule, selectedModule, settingsModule, clientModule] = await Promise.all([
        importPacked("dist/src/application/owner-banana-inpaint-original-upload-source-profile.js"),
        importPacked("dist/src/application/owner-banana-inpaint-original-reference-service.js"),
        importPacked("dist/src/application/owner-banana-inpaint-painted-composite-input-validator.js"),
        importPacked("dist/src/application/owner-banana-inpaint-painted-composite-source-profile.js"),
        importPacked("dist/src/application/owner-banana-inpaint-painted-composite-reference-service.js"),
        importPacked("dist/src/catalog/selected-discovery-catalog.js"),
        importPacked("dist/src/catalog/mapless-settings-inventory.js"),
        importPacked("dist/src/adapter/syntx/chat-http-client.js")
      ]);
    } catch { fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_MODULE_IMPORT_FAILED"); }
    if (typeof originalProfileModule.getOwnerBananaInpaintOriginalUploadSourceProfile !== "function" ||
        typeof originalServiceModule.OwnerBananaInpaintOriginalReferenceService !== "function" ||
        typeof paintedValidatorModule.validateOwnerBananaInpaintPaintedCompositeInput !== "function" ||
        typeof paintedValidatorModule.validateOwnerBananaInpaintPaintedCompositeUploadData !== "function" ||
        typeof paintedProfileModule.getOwnerBananaInpaintPaintedCompositeSourceProfile !== "function" ||
        typeof paintedServiceModule.OwnerBananaInpaintPaintedCompositeReferenceService !== "function" ||
        typeof clientModule.SyntxChatHttpClient !== "function" ||
        typeof selectedModule.loadSelectedDiscoveryCatalog !== "function" ||
        typeof settingsModule.loadMaplessSettingsInventoryVersion !== "function") {
      fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_MODULE_EXPORTS_INVALID");
    }

    phase = "painted-c5-62-profile";
    const profileVersions = {
      public_catalog_version: originalProfileModule.OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
      settings_inventory_version: originalProfileModule.OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION
    };
    assertInpaintOwnedOriginalCatalogPair({
      selected_default_version: selectedModule.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
      ...profileVersions
    });
    if (!sameArray(paintedProfileModule.OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_VARIANTS, VARIANTS) ||
        paintedValidatorModule.OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_INPUT_POLICY?.dispatch_allowed !== false ||
        paintedValidatorModule.OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_INPUT_POLICY?.backend_acceptance !== "UNPROVEN" ||
        paintedValidatorModule.OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_INPUT_POLICY?.pixel_decode_verified !== false ||
        paintedValidatorModule.OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_INPUT_POLICY?.size_policy !== "LOCAL_RESOURCE_BOUND_ONLY") {
      fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_POLICY_INVALID");
    }
    const catalogDirectory = join(packageRoot, "catalog");
    const selectedC5 = selectedModule.loadSelectedDiscoveryCatalog(profileVersions.public_catalog_version, catalogDirectory);
    if (selectedC5.runtimeCapabilities !== null) fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_C5_RUNTIME_PROMOTED");
    const settings62 = settingsModule.loadMaplessSettingsInventoryVersion(profileVersions.settings_inventory_version, catalogDirectory);
    const originalProfiles = VARIANTS.map((variant) => originalProfileModule.getOwnerBananaInpaintOriginalUploadSourceProfile(
      variant, selectedC5.discoveryCatalog, profileVersions.public_catalog_version, settings62, profileVersions.settings_inventory_version));
    const paintedProfiles = VARIANTS.map((variant, index) =>
      paintedProfileModule.getOwnerBananaInpaintPaintedCompositeSourceProfile(variant, originalProfiles[index]));
    if (paintedProfiles.some((profile, index) => profile.variant !== VARIANTS[index] || profile.model_id !== VARIANTS[index] ||
        profile.model_type !== VARIANTS[index] || profile.source_role !== "painted_composite" || profile.wire_role !== "mask" ||
        profile.public_catalog_version !== profileVersions.public_catalog_version ||
        profile.settings_inventory_version !== profileVersions.settings_inventory_version ||
        profile.source_binding?.original_upload_profile_schema_hash !== originalProfiles[index].profile_schema_hash ||
        profile.source_mask_byte_limit !== "UNPROVEN" || profile.runtime_usable !== false || profile.dispatch_allowed !== false ||
        profile.backend_acceptance !== "UNPROVEN" || !/^sha256:[a-f0-9]{64}$/u.test(profile.profile_schema_hash))) {
      fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_SOURCE_PROFILE_INVALID");
    }

    phase = "painted-pair-synthetic-http";
    const attemptId = "link_installed_inpaint_painted_pair_0123456789";
    const binding = Object.freeze({ tenant_id: "installed-inpaint-pair-tenant", subject: "installed-inpaint-pair-subject" });
    const syntheticCredential = "synthetic-installed-painted-pair-credential";
    let credentialCalls = 0, fetchCalls = 0, routeMismatch = false, nextId = 0;
    const uploadRecords = [];
    const pendingStarts = new Map();
    const fetchImpl = async (input, init) => {
      fetchCalls += 1;
      const url = new URL(String(input));
      try { assertInpaintFixedUpstreamUrl(url, "upload"); }
      catch { routeMismatch = true; return jsonResponse({ detail: "synthetic route mismatch" }, 404); }
      const authorization = new Headers(init?.headers).get("authorization");
      const form = init?.body instanceof FormData ? init.body : undefined;
      const file = form?.get("files");
      const bytes = file instanceof File ? Buffer.from(await file.arrayBuffer()) : Buffer.alloc(0);
      const filename = file instanceof File ? file.name : "";
      const kind = filename === "inpaint-mask.png" || filename.startsWith("pending-") ? "painted" : "original";
      const ordinal = ++nextId;
      const modelType = form?.get("model_type");
      uploadRecords.push({ kind, filename, method: init?.method, redirect: init?.redirect,
        authorization_ok: authorization === `Bearer ${syntheticCredential}`,
        keys: form ? Array.from(form.keys()) : [], destination: form?.get("destination"),
        check_duplicates: form?.get("check_duplicates"), model_type: modelType,
        bytes_match: bytes.equals(PNG_1X1), file_count: form?.getAll("files").length ?? 0,
        mime_type: file instanceof File ? file.type : null });
      bytes.fill(0);
      if (filename.startsWith("pending-")) {
        pendingStarts.get(filename)?.();
        return await new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) { reject(new Error("synthetic upload signal missing")); return; }
          if (signal.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      return jsonResponse({ files: [{ id: `painted-pair-${ordinal}`, file_id: `painted-pair-${ordinal}`,
        url: `https://r2.syntx.ai/installed/painted-pair-${ordinal}.png`, mime_type: "image/png",
        size: PNG_1X1.byteLength, status: "accepted" }] });
    };
    const client = new clientModule.SyntxChatHttpClient({
      credentialBroker: { async useCredential(operation) { credentialCalls += 1; return operation(syntheticCredential); } }, fetchImpl
    });
    const linkedAttempt = (id) => ({ attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
      status: "LINKED", expires_at: null, linked: true });
    const linkService = { async getStatus(_binding, id) { return linkedAttempt(id); } };
    const OriginalService = originalServiceModule.OwnerBananaInpaintOriginalReferenceService;
    const PaintedService = paintedServiceModule.OwnerBananaInpaintPaintedCompositeReferenceService;
    const original = new OriginalService({ binding, linkService, catalog: selectedC5.discoveryCatalog,
      public_catalog_version: profileVersions.public_catalog_version, settings_inventory: settings62,
      settings_inventory_version: profileVersions.settings_inventory_version, resolveClient: () => client });
    const service = new PaintedService({ originalReferenceService: original, binding, linkService,
      catalog: selectedC5.discoveryCatalog, public_catalog_version: profileVersions.public_catalog_version,
      settings_inventory: settings62, settings_inventory_version: profileVersions.settings_inventory_version,
      resolveClient: () => client });
    const originalContext = (receipt, variant) => ({ principal: { tenant_id: binding.tenant_id, subject_id: binding.subject,
      connection_id: attemptId }, attempt_id: attemptId, variant, form_id: "banana-inpaint", source_role: "inpaint_original",
      public_catalog_version: profileVersions.public_catalog_version,
      settings_inventory_version: profileVersions.settings_inventory_version,
      profile_schema_hash: originalProfiles[VARIANTS.indexOf(variant)].profile_schema_hash,
      reference_handle: receipt.reference_handle });
    let originalsUploaded = 0, paintedUploaded = 0, paintedResolved = 0;
    try {
      const originals = [];
      for (const variant of VARIANTS) {
        const receipt = await original.upload({ attemptId, variant, content_base64: PNG_1X1.toString("base64"),
          filename: "installed-original.png", mime_type: "image/png" });
        originals.push(receipt);
        originalsUploaded += 1;
        if (receipt.status !== "uploaded" || receipt.variant !== variant || typeof receipt.reference_handle !== "string" ||
            !Number.isSafeInteger(receipt.expires_in_seconds) || receipt.expires_in_seconds < 1 || receipt.expires_in_seconds > 900 ||
            Object.hasOwn(receipt, "file_url") || Object.hasOwn(receipt, "url") || Object.hasOwn(receipt, "file_id")) {
          fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_ORIGINAL_RECEIPT_INVALID");
        }
        const originalResolution = await original.resolveOriginal(originalContext(receipt, variant));
        if (originalResolution.role !== "inpaint_original" || originalResolution.wire_type !== "image" ||
            originalResolution.variant !== variant || originalResolution.generation_permit !== false ||
            !Number.isFinite(originalResolution.expires_at) || Object.hasOwn(originalResolution, "mask_permission")) {
          fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_ORIGINAL_RESOLUTION_INVALID");
        }
        const paintedReceipt = await service.uploadPaintedComposite({ attemptId, variant, original_handle: receipt.reference_handle,
          content_base64: PNG_1X1.toString("base64"), filename: "inpaint-mask.png", mime_type: "image/png" });
        paintedUploaded += 1;
        if (paintedReceipt.status !== "uploaded" || paintedReceipt.variant !== variant ||
            paintedReceipt.original_handle !== receipt.reference_handle || typeof paintedReceipt.painted_handle !== "string" ||
            !Number.isSafeInteger(paintedReceipt.expires_in_seconds) || paintedReceipt.expires_in_seconds < 1 || paintedReceipt.expires_in_seconds > 900 ||
            Object.hasOwn(paintedReceipt, "file_url") ||
            Object.hasOwn(paintedReceipt, "url") || Object.hasOwn(paintedReceipt, "file_id")) {
          fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_PUBLIC_RECEIPT_INVALID");
        }
        const privateResolution = await service.resolvePaintedComposite({ attempt_id: attemptId, variant,
          original_handle: receipt.reference_handle, painted_handle: paintedReceipt.painted_handle });
        const expectedPrivateUrl = `https://r2.syntx.ai/installed/painted-pair-${(VARIANTS.indexOf(variant) * 2) + 2}.png`;
        if (privateResolution.role !== "painted_composite" || privateResolution.wire_type !== "mask" ||
            privateResolution.principal?.tenant_id !== binding.tenant_id || privateResolution.principal?.subject_id !== binding.subject ||
            privateResolution.attempt_id !== attemptId || privateResolution.variant !== variant ||
            privateResolution.source_role !== "painted_composite" || privateResolution.form_id !== "banana-inpaint" ||
            privateResolution.original_handle !== receipt.reference_handle || privateResolution.painted_handle !== paintedReceipt.painted_handle ||
            privateResolution.original_sha256 !== originalResolution.sha256 || privateResolution.painted_sha256 !== paintedReceipt.sha256 ||
            privateResolution.original_profile_schema_hash !== originalResolution.profile_schema_hash ||
            privateResolution.profile_schema_hash !== paintedProfiles[VARIANTS.indexOf(variant)].profile_schema_hash ||
            privateResolution.public_catalog_version !== profileVersions.public_catalog_version ||
            privateResolution.settings_inventory_version !== profileVersions.settings_inventory_version ||
            privateResolution.original_width !== originalResolution.width || privateResolution.original_height !== originalResolution.height ||
            privateResolution.width !== originalResolution.width || privateResolution.height !== originalResolution.height ||
            privateResolution.expires_at !== originalResolution.expires_at || privateResolution.original_epoch !== originalResolution.epoch ||
            privateResolution.generation_permit !== false || privateResolution.file_url !== expectedPrivateUrl ||
            Object.hasOwn(privateResolution, "generation_permission")) {
          fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_PRIVATE_RESOLUTION_INVALID");
        }
        paintedResolved += 1;

        if (variant === VARIANTS[0]) {
          const beforeGeometryReject = fetchCalls;
          let geometryRejected = false;
          try { await service.uploadPaintedComposite({ attemptId, variant, original_handle: receipt.reference_handle,
            content_base64: pngWithWidth(2).toString("base64"), filename: "geometry-mismatch.png", mime_type: "image/png" }); }
          catch (error) { geometryRejected = error?.code === "INVALID_IMAGE_INPUT" || error?.code === "GEOMETRY_MISMATCH"; }
          if (!geometryRejected || fetchCalls !== beforeGeometryReject) fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_GEOMETRY_GUARD_INVALID");

          let foreignDenied = false;
          try { await service.resolvePaintedComposite({ attempt_id: attemptId, variant,
            original_handle: "banana_inpaint_original_00000000-0000-0000-0000-000000000000",
            painted_handle: paintedReceipt.painted_handle }); }
          catch (error) { foreignDenied = error?.code === "PAINTED_REFERENCE_UNAVAILABLE"; }
          if (!foreignDenied) fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_FOREIGN_HANDLE_ACCEPTED");
          const ownerAfterForeign = await service.resolvePaintedComposite({ attempt_id: attemptId, variant,
            original_handle: receipt.reference_handle, painted_handle: paintedReceipt.painted_handle });
          if (ownerAfterForeign.painted_handle !== paintedReceipt.painted_handle) {
            fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_FOREIGN_HANDLE_DESTROYED_OWNER");
          }
        }
      }
      if (fetchCalls !== 8 || credentialCalls !== 8 || originalsUploaded !== 4 || paintedUploaded !== 4 || paintedResolved !== 4) {
        fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_REQUEST_COUNTS_INVALID");
      }
      const normalUploads = uploadRecords.slice(0, 8);
      if (normalUploads.some((entry, index) => entry.kind !== (index % 2 === 0 ? "original" : "painted") ||
          entry.filename !== (index % 2 === 0 ? "installed-original.png" : "inpaint-mask.png") ||
          entry.model_type !== VARIANTS[Math.floor(index / 2)] || entry.bytes_match !== true || entry.mime_type !== "image/png" ||
          entry.method !== "POST" || entry.redirect !== "error" || entry.authorization_ok !== true ||
          !sameArray(entry.keys, ["files", "destination", "check_duplicates", "model_type"]) ||
          entry.destination !== "hidden" || entry.check_duplicates !== "true" || entry.file_count !== 1)) {
        fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_NATIVE_UPLOAD_INVALID");
      }
      await service.invalidateAttempt(attemptId);
      let invalidatedDenied = false;
      try { await service.resolvePaintedComposite({ attempt_id: attemptId, variant: VARIANTS[0],
        original_handle: originals[0].reference_handle, painted_handle: "banana_inpaint_painted_00000000-0000-0000-0000-000000000000" }); }
      catch (error) { invalidatedDenied = error?.code === "PAINTED_REFERENCE_UNAVAILABLE" || error?.code === "ORIGINAL_REFERENCE_UNAVAILABLE"; }
      if (!invalidatedDenied) fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_INVALIDATION_FAILED");
    } finally { await service.close(); }

    const exerciseDrain = async (attempt, filename, action) => {
      const drainOriginal = new OriginalService({ binding, linkService, catalog: selectedC5.discoveryCatalog,
        public_catalog_version: profileVersions.public_catalog_version, settings_inventory: settings62,
        settings_inventory_version: profileVersions.settings_inventory_version, resolveClient: () => client });
      const drainService = new PaintedService({ originalReferenceService: drainOriginal, binding, linkService,
        catalog: selectedC5.discoveryCatalog, public_catalog_version: profileVersions.public_catalog_version,
        settings_inventory: settings62, settings_inventory_version: profileVersions.settings_inventory_version,
        resolveClient: () => client });
      try {
        const originalReceipt = await drainOriginal.upload({ attemptId: attempt, variant: "banana",
          content_base64: PNG_1X1.toString("base64"), filename: "installed-original.png", mime_type: "image/png" });
        originalsUploaded += 1;
        let started;
        const entered = new Promise((resolveStarted) => { started = resolveStarted; });
        pendingStarts.set(filename, () => started());
        const upload = drainService.uploadPaintedComposite({ attemptId: attempt, variant: "banana",
          original_handle: originalReceipt.reference_handle, content_base64: PNG_1X1.toString("base64"), filename, mime_type: "image/png" });
        const uploadOutcome = upload.then(() => "RESOLVED", (error) => error?.code);
        await entered;
        const barrier = action === "invalidate" ? drainService.invalidateAttempt(attempt) : drainService.close();
        await barrier;
        const outcome = await uploadOutcome;
        if (outcome !== "UPLOAD_OUTCOME_UNKNOWN" && outcome !== "REQUEST_ABORTED") {
          fail(`INSTALLED_INPAINT_PAINTED_COMPOSITE_${action.toUpperCase()}_DRAIN_FAILED`);
        }
      } finally {
        pendingStarts.delete(filename);
        await drainService.close();
      }
    };
    await exerciseDrain("link_installed_inpaint_pair_invalidate_0123456789", "pending-invalidate.png", "invalidate");
    await exerciseDrain("link_installed_inpaint_pair_close_0123456789", "pending-close.png", "close");
    if (fetchCalls !== 12 || credentialCalls !== 12 || uploadRecords.length !== 12 || routeMismatch ||
        !sameArray(uploadRecords.slice(8).map((entry) => entry.kind), ["original", "painted", "original", "painted"]) ||
        !sameArray(uploadRecords.slice(8).map((entry) => entry.filename),
          ["installed-original.png", "pending-invalidate.png", "installed-original.png", "pending-close.png"]) ||
        uploadRecords.slice(8).some((entry) => entry.method !== "POST" || entry.redirect !== "error" ||
          entry.authorization_ok !== true || entry.model_type !== "banana" || entry.bytes_match !== true ||
          !sameArray(entry.keys, ["files", "destination", "check_duplicates", "model_type"]))) {
      fail("INSTALLED_INPAINT_PAINTED_COMPOSITE_SYNTHETIC_CALLS_INVALID");
    }
    return Object.freeze({ painted_composite: "INSTALLED_SYNTHETIC_PRIVATE_PAIR_PASS", painted_variants_checked: VARIANTS.length,
      painted_original_uploads: originalsUploaded, painted_composite_uploads: paintedUploaded,
      painted_composite_resolutions: paintedResolved, painted_pair_native_posts: fetchCalls,
      painted_pair_original_upload_posts: uploadRecords.filter((entry) => entry.kind === "original").length,
      painted_pair_upload_attempt_posts: uploadRecords.filter((entry) => entry.kind === "painted").length,
      painted_geometry_mismatch: "REJECTED_BEFORE_POST", painted_foreign_handle: "DENIED_OWNER_PRESERVED",
      painted_invalidation_drain: "PASS", painted_close_drain: "PASS", painted_generation_permit: false,
      provider_acceptance: "UNPROVEN", generation: "NOT_CHECKED" });
  } catch (error) {
    if (error instanceof InpaintFoundationInstalledCheckError) throw error;
    throw new InpaintFoundationInstalledCheckError(`INSTALLED_INPAINT_PAINTED_COMPOSITE_${phase.toUpperCase().replace(/-/gu, "_")}_FAILED`);
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngWithWidth(width) {
  const result = Buffer.from(PNG_1X1);
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(crc32(result.subarray(12, 29)), 29);
  return result;
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}
function sameJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function isWithin(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}
function unexpectedCode(phase, _error) { return `INSTALLED_INPAINT_FOUNDATION_${phase.toUpperCase().replace(/-/gu, "_")}_FAILED`; }
function fail(code) { throw new InpaintFoundationInstalledCheckError(code); }

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
