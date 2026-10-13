import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checker = await import("../scripts/installed-inpaint-foundation-check.mjs").catch(() => null);

test("installed Inpaint foundation checker exports its installed-package entrypoint", () => {
  assert.ok(checker?.assertInstalledInpaintFoundation, "MISSING_INSTALLED_INPAINT_FOUNDATION_CHECKER");
  assert.ok(checker.assertInpaintFoundationPackagePaths && checker.assertInpaintFoundationDeclarations &&
    checker.assertInpaintFoundationModuleSurface, "MISSING_INSTALLED_INPAINT_FOUNDATION_GUARDS");
});

test("installed Inpaint checker exposes the owned original service gate separately from native foundation", () => {
  assert.ok(checker.assertInpaintOwnedOriginalPackagePaths, "MISSING_INSTALLED_INPAINT_OWNED_PACKAGE_GUARD");
  assert.ok(checker.assertInstalledInpaintOwnedOriginalService, "MISSING_INSTALLED_INPAINT_OWNED_SERVICE_CHECK");
  assert.ok(checker.assertInpaintOwnedOriginalCatalogPair, "MISSING_INSTALLED_INPAINT_OWNED_CATALOG_PAIR_GUARD");
  assert.ok(checker.assertInpaintOwnedOriginalDeclarations, "MISSING_INSTALLED_INPAINT_OWNED_ORIGINAL_DECLARATION_GUARD");
  assert.ok(checker.assertInpaintOwnedOriginalPublicBarrelDoesNotExport, "MISSING_INSTALLED_INPAINT_OWNED_ORIGINAL_PUBLIC_BARREL_GUARD");
});

test("installed Inpaint checker exposes the painted-composite clean-package guards", () => {
  assert.ok(checker.assertInstalledInpaintPaintedCompositeService, "MISSING_INSTALLED_INPAINT_PAINTED_COMPOSITE_CHECK");
  assert.ok(checker.formatInpaintPaintedCompositePackageSummary, "MISSING_INSTALLED_INPAINT_PAINTED_COMPOSITE_SUMMARY_GUARD");
  assert.ok(checker.assertInpaintPaintedCompositePackagePaths, "MISSING_INSTALLED_INPAINT_PAINTED_COMPOSITE_PACKAGE_GUARD");
  assert.ok(checker.assertInpaintPaintedCompositeDeclarations, "MISSING_INSTALLED_INPAINT_PAINTED_COMPOSITE_DECLARATION_GUARD");
  assert.ok(checker.assertInpaintPaintedCompositePublicBarrelDoesNotExport,
    "MISSING_INSTALLED_INPAINT_PAINTED_COMPOSITE_PUBLIC_BARREL_GUARD");
});

test("package summary exposes the actual four-pair/12-POST proof and rejects incomplete counters", () => {
  const proof = { painted_composite: "INSTALLED_SYNTHETIC_PRIVATE_PAIR_PASS", painted_variants_checked: 4,
    painted_original_uploads: 6, painted_composite_uploads: 4, painted_composite_resolutions: 4,
    painted_pair_native_posts: 12, painted_geometry_mismatch: "REJECTED_BEFORE_POST",
    painted_foreign_handle: "DENIED_OWNER_PRESERVED", painted_invalidation_drain: "PASS",
    painted_close_drain: "PASS", painted_generation_permit: false, provider_acceptance: "UNPROVEN", generation: "NOT_CHECKED",
    painted_pair_original_upload_posts: 6, painted_pair_upload_attempt_posts: 6 };
  const summary = checker.formatInpaintPaintedCompositePackageSummary(proof);
  assert.match(summary, /painted_variants=4/u);
  assert.match(summary, /painted_pair_original_upload_posts=6/u);
  assert.match(summary, /painted_pair_upload_attempt_posts=6/u);
  assert.match(summary, /painted_pair_resolutions=4/u);
  assert.match(summary, /painted_pair_total_posts=12/u);
  assert.match(summary, /geometry_mismatch=REJECTED_BEFORE_POST/u);
  assert.match(summary, /foreign_handle=DENIED_OWNER_PRESERVED/u);
  assert.match(summary, /invalidate_drain=PASS/u);
  assert.match(summary, /close_drain=PASS/u);
  assert.match(summary, /generation_permit=false/u);
  assert.throws(() => checker.formatInpaintPaintedCompositePackageSummary({ ...proof, painted_pair_native_posts: 8 }),
    (error) => error.code === "INSTALLED_INPAINT_PAINTED_COMPOSITE_SUMMARY_INVALID");
});

const REQUIRED = [
  "dist/src/adapter/syntx/chat-http-client.js", "dist/src/adapter/syntx/chat-http-client.d.ts",
  "dist/src/adapter/syntx/http-client.js", "dist/src/adapter/syntx/upload-reference-bridge.js",
  "dist/src/application/owner-banana-inpaint-original-validator.js",
  "dist/src/application/owner-banana-inpaint-original-validator.d.ts",
  "dist/src/application/owner-image-reference-input-validator.js",
  "docs/интеграция/Inpaint-источники-и-границы.md"
];

const OWNED_REQUIRED = [
  ...REQUIRED,
  "dist/src/index.js", "dist/src/index.d.ts",
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
  "catalog/public/sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
  "catalog/public/sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json",
  "catalog/settings/v2/sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json"
];

const PAINTED_REQUIRED = [
  ...OWNED_REQUIRED,
  "dist/src/adapter/syntx/chat-http-client.d.ts",
  "dist/src/application/owner-banana-inpaint-painted-composite-input-validator.js",
  "dist/src/application/owner-banana-inpaint-painted-composite-input-validator.d.ts",
  "dist/src/application/owner-banana-inpaint-painted-composite-source-profile.js",
  "dist/src/application/owner-banana-inpaint-painted-composite-source-profile.d.ts",
  "dist/src/application/owner-banana-inpaint-painted-composite-reference-service.js",
  "dist/src/application/owner-banana-inpaint-painted-composite-reference-service.d.ts"
];

test("painted-composite package guard requires the actual validator, profile, service, and native artifacts", () => {
  assert.equal(checker.assertInpaintPaintedCompositePackagePaths(new Set(PAINTED_REQUIRED)), true);
  for (const missing of [
    "dist/src/adapter/syntx/chat-http-client.d.ts",
    "dist/src/application/owner-banana-inpaint-painted-composite-input-validator.js",
    "dist/src/application/owner-banana-inpaint-painted-composite-source-profile.d.ts",
    "dist/src/application/owner-banana-inpaint-painted-composite-reference-service.js"
  ]) {
    const paths = new Set(PAINTED_REQUIRED);
    paths.delete(missing);
    assert.throws(() => checker.assertInpaintPaintedCompositePackagePaths(paths),
      (error) => error.code === "INSTALLED_INPAINT_PAINTED_COMPOSITE_PACKAGE_CONTENT_MISSING", missing);
  }
});

test("painted-composite declarations bind the native upload, local input, source profile, and paired lifecycle", () => {
  const chat = `export declare class SyntxChatHttpClient {
    uploadBananaInpaintPaintedComposite(request: unknown, signal?: AbortSignal): Promise<InternalUploadReference>;
  }`;
  const validator = `export declare const OWNER_BANANA_INPAINT_PAINTED_COMPOSITE_INPUT_POLICY: Readonly<Policy>;
    export declare function validateOwnerBananaInpaintPaintedCompositeInput(input: unknown): ValidatedOwnerBananaInpaintPaintedComposite;
    export declare function validateOwnerBananaInpaintPaintedCompositeUploadData(input: unknown): ValidatedOwnerBananaInpaintPaintedComposite;`;
  const profile = `export declare function getOwnerBananaInpaintPaintedCompositeSourceProfile(
    variantInput: unknown, originalProfileInput: Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>
  ): Readonly<OwnerBananaInpaintPaintedCompositeSourceProfile>;`;
  const service = `export declare class OwnerBananaInpaintPaintedCompositeReferenceService {
    uploadPaintedComposite(input: OwnerBananaInpaintPaintedCompositeUploadInput | unknown): Promise<OwnerBananaInpaintPaintedCompositeUploadReceipt>;
    resolvePaintedComposite(input: OwnerBananaInpaintPaintedCompositeResolverContext | unknown): Promise<OwnerBananaInpaintPaintedCompositePrivateResolution>;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  }`;
  assert.equal(checker.assertInpaintPaintedCompositeDeclarations(chat, validator, profile, service), true);
  assert.throws(() => checker.assertInpaintPaintedCompositeDeclarations(chat.replace("uploadBananaInpaintPaintedComposite", "missing"), validator, profile, service),
    (error) => error.code === "INSTALLED_INPAINT_PAINTED_COMPOSITE_DECLARATIONS_INVALID");
  assert.throws(() => checker.assertInpaintPaintedCompositeDeclarations(chat, validator, profile, service.replace("resolvePaintedComposite", "missing")),
    (error) => error.code === "INSTALLED_INPAINT_PAINTED_COMPOSITE_DECLARATIONS_INVALID");
});

test("painted-composite profile and private service stay out of the public barrel", () => {
  assert.equal(checker.assertInpaintPaintedCompositePublicBarrelDoesNotExport("export declare const createMcpServer: unknown;"), true);
  assert.throws(() => checker.assertInpaintPaintedCompositePublicBarrelDoesNotExport(
    'export { OwnerBananaInpaintPaintedCompositeReferenceService } from "./application/owner-banana-inpaint-painted-composite-reference-service.js";'),
  (error) => error.code === "INSTALLED_INPAINT_PAINTED_COMPOSITE_PRIVATE_BARREL_EXPORT");
});

test("owned-original package guard requires c5/62 archives, profile and service modules", () => {
  assert.equal(checker.assertInpaintOwnedOriginalPackagePaths(new Set(OWNED_REQUIRED)), true);
  assert.throws(() => checker.assertInpaintOwnedOriginalPackagePaths(new Set(OWNED_REQUIRED.slice(1))),
    (error) => error.code === "INSTALLED_INPAINT_OWNED_ORIGINAL_PACKAGE_CONTENT_MISSING");
});

test("owned-original pair guard keeps global e551 separate from the explicit c5/62 pair", () => {
  assert.equal(checker.assertInpaintOwnedOriginalCatalogPair({
    selected_default_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    public_catalog_version: "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json",
    settings_inventory_version: "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json"
  }), true);
  assert.throws(() => checker.assertInpaintOwnedOriginalCatalogPair({
    selected_default_version: "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json",
    public_catalog_version: "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json",
    settings_inventory_version: "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json"
  }), (error) => error.code === "INSTALLED_INPAINT_OWNED_ORIGINAL_SOURCE_PAIR_INVALID");
});

test("owned-original declarations require source profile and upload/resolve/revoke lifecycle methods", () => {
  const profile = `export declare function getOwnerBananaInpaintOriginalUploadSourceProfile(
    variantInput: unknown, catalogInput: OwnerBananaInpaintOriginalUploadCatalogPort, catalogVersionInput: unknown,
    settingsInventoryInput: MaplessSettingsInventory, settingsVersionInput: unknown
  ): Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>;`;
  const service = `export declare class OwnerBananaInpaintOriginalReferenceService {
    upload(input: OwnerBananaInpaintOriginalUploadInput | unknown): Promise<OwnerBananaInpaintOriginalUploadReceipt>;
    resolveOriginal(input: OwnerBananaInpaintOriginalResolverContext | unknown): Promise<OwnerBananaInpaintOriginalPrivateResolution>;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  }`;
  assert.equal(checker.assertInpaintOwnedOriginalDeclarations(profile, service), true);
  assert.throws(() => checker.assertInpaintOwnedOriginalDeclarations(profile, service.replace("invalidateAttempt", "missing")),
    (error) => error.code === "INSTALLED_INPAINT_OWNED_ORIGINAL_DECLARATIONS_INVALID");
});

test("owned-original internal resolver and service are not exposed from the public index barrel", () => {
  assert.equal(checker.assertInpaintOwnedOriginalPublicBarrelDoesNotExport("export declare const createMcpServer: unknown;"), true);
  assert.throws(() => checker.assertInpaintOwnedOriginalPublicBarrelDoesNotExport(
    'export { OwnerBananaInpaintOriginalReferenceService } from "./application/owner-banana-inpaint-original-reference-service.js";'),
  (error) => error.code === "INSTALLED_INPAINT_OWNED_ORIGINAL_PRIVATE_BARREL_EXPORT");
});

test("owned-original declaration guard requires profile, upload, resolver, invalidation, and close methods", () => {
  const profile = "export declare function getOwnerBananaInpaintOriginalUploadSourceProfile(): Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>;";
  const service = `export declare class OwnerBananaInpaintOriginalReferenceService {
    upload(input: OwnerBananaInpaintOriginalUploadInput | unknown): Promise<OwnerBananaInpaintOriginalUploadReceipt>;
    resolveOriginal(input: OwnerBananaInpaintOriginalResolverContext | unknown): Promise<OwnerBananaInpaintOriginalPrivateResolution>;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  }`;
  assert.equal(checker.assertInpaintOwnedOriginalDeclarations(profile, service), true);
  assert.throws(() => checker.assertInpaintOwnedOriginalDeclarations(profile, service.replace("resolveOriginal", "missing")),
    (error) => error.code === "INSTALLED_INPAINT_OWNED_ORIGINAL_DECLARATIONS_INVALID");
});

test("installed Inpaint package guard requires actual chat, validator, and guide artifacts", () => {
  assert.equal(checker.assertInpaintFoundationPackagePaths(new Set(REQUIRED)), true);
  assert.throws(() => checker.assertInpaintFoundationPackagePaths(new Set(REQUIRED.slice(1))),
    (error) => error.code === "INSTALLED_INPAINT_FOUNDATION_PACKAGE_CONTENT_MISSING");
  assert.throws(() => checker.assertInpaintFoundationPackagePaths([]),
    (error) => error.code === "INSTALLED_INPAINT_FOUNDATION_PACKAGE_PATHS_INVALID");
});

test("installed Inpaint declaration guard rejects missing native method declarations", () => {
  const chat = `export declare class SyntxChatHttpClient {
    createImageInpaintChat(title: string, signal?: AbortSignal): Promise<CreateChatReceipt>;
    uploadBananaInpaintOriginal(request: unknown, signal?: AbortSignal): Promise<InternalUploadReference>;
  }`;
  const validator = `export declare const OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY: Readonly<Policy>;
    export declare function validateOwnerBananaInpaintOriginalUploadData(input: unknown): ValidatedOwnerBananaInpaintOriginal;`;
  assert.equal(checker.assertInpaintFoundationDeclarations(chat, validator), true);
  assert.throws(() => checker.assertInpaintFoundationDeclarations(chat.replace("uploadBananaInpaintOriginal", "missing"), validator),
    (error) => error.code === "INSTALLED_INPAINT_FOUNDATION_DECLARATIONS_INVALID");
});

test("installed Inpaint module guard rejects missing constructor and validator behavior", () => {
  assert.throws(() => checker.assertInpaintFoundationModuleSurface({}, {}),
    (error) => error.code === "INSTALLED_INPAINT_FOUNDATION_METHOD_MISSING");
  const badValidator = {
    validateOwnerBananaInpaintOriginalUploadData() {},
    validateOwnerBananaInpaintOriginalInput() {},
    OWNER_BANANA_INPAINT_ORIGINAL_INPUT_POLICY: { max_file_size_bytes: 50 * 1024 * 1024 }
  };
  const badClient = { SyntxChatHttpClient: class { createImageInpaintChat() {} uploadBananaInpaintOriginal() {} } };
  assert.throws(() => checker.assertInpaintFoundationModuleSurface(badClient, badValidator),
    (error) => error.code === "INSTALLED_INPAINT_FOUNDATION_VALIDATOR_BINDING_INVALID");
});

test("installed checker rejects the source checkout instead of treating it as installed evidence", async () => {
  await assert.rejects(() => checker.assertInstalledInpaintFoundation(process.cwd(), new Set(REQUIRED)),
    (error) => error.code === "INSTALLED_INPAINT_FOUNDATION_NOT_CLEAN_INSTALLED_PACKAGE");
});

test("current Inpaint guide satisfies the installed checker’s source-limit and no-handle boundary", () => {
  const guide = readFileSync(new URL("../docs/интеграция/Inpaint-источники-и-границы.md", import.meta.url), "utf8");
  assert.equal(checker.assertInpaintGuideBoundary(guide), true);
});

test("installed synthetic HTTP fixture accepts only the fixed API origin and exact route without query", () => {
  assert.equal(checker.assertInpaintFixedUpstreamUrl("https://api.syntx.ai/api/v1/chats", "chat"), true);
  assert.equal(checker.assertInpaintFixedUpstreamUrl("https://api.syntx.ai/api/v1/chats/upload-files", "upload"), true);
  for (const [url, kind] of [
    ["https://evil.invalid/api/v1/chats/upload-files", "upload"],
    ["https://api.syntx.ai/api/v1/chats/upload-files?ai_name=banana", "upload"],
    ["https://api.syntx.ai/api/v1/chats?folder_uuid=private", "chat"]
  ]) {
    assert.throws(() => checker.assertInpaintFixedUpstreamUrl(url, kind),
      (error) => error.code === "INSTALLED_INPAINT_FOUNDATION_FIXED_ROUTE_INVALID");
  }
});
