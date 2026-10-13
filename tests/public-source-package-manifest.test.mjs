import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS,
  assertPublicSourcePackagePaths,
  assertInstalledPublicSourceFileHashes,
  evaluateHistoricalOwnerProofGate,
  isInertPublicStaticRuntimeArtifact,
  mayTreatPublicStaticRuntimeDirectoryAsEmpty,
  loadAndVerifyPublicSourceManifest,
  validatePublicSourceManifest
} from "../scripts/public-source-package-manifest.mjs";

const digest = "a".repeat(64);
const catalogFixturePath = `catalog/public/sha256-${digest}.json`;
const baseManifest = (overrides = {}) => ({
  schema_version: "1.0.0",
  profile: "public-source",
  source_commit: "b".repeat(40),
  included_paths: ["README.md", catalogFixturePath, "package.json", "src/index.ts"],
  excluded_paths: [...PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS].sort(),
  excluded_roots: [".autopilot", ".журналы", "docs/контроль", "docs/проект"],
  file_sha256: { "README.md": digest, [catalogFixturePath]: digest, "package.json": digest, "src/index.ts": digest },
  ...overrides
});

test("public static-runtime scope accepts actual v11 source evidence but rejects runtime or unknown shapes", async () => {
  const versionDirectory = new URL("../catalog/runtime/v11/", import.meta.url);
  const names = (await readdir(versionDirectory)).filter((name) => name.endsWith(".json")).sort();
  assert.equal(names.length, 10);
  for (const name of names) {
    const path = `catalog/runtime/v11/${name}`;
    const artifact = JSON.parse(await readFile(new URL(name, versionDirectory), "utf8"));
    assert.equal(isInertPublicStaticRuntimeArtifact(path, artifact), true, path);
  }

  const rejectedPath = "catalog/runtime/v11/rejected-intermediate-status.json";
  const rejected = JSON.parse(await readFile(new URL("../catalog/runtime/v11/rejected-intermediate-status.json", import.meta.url), "utf8"));
  assert.equal(isInertPublicStaticRuntimeArtifact(rejectedPath, { ...rejected, production_consumable: true }), false);

  const analysisPath = "catalog/runtime/v11/static-form-control-analysis-v1.6-e5517ee5-87e96b78-097959987e8cb737.json";
  const analysis = JSON.parse(await readFile(new URL("../catalog/runtime/v11/static-form-control-analysis-v1.6-e5517ee5-87e96b78-097959987e8cb737.json", import.meta.url), "utf8"));
  assert.equal(isInertPublicStaticRuntimeArtifact(analysisPath, { ...analysis, runtime_usable: true }), false);
  assert.equal(isInertPublicStaticRuntimeArtifact(analysisPath, { ...analysis, catalog_kind: "UNREVIEWED_KIND" }), false);
  const projectionPath = "catalog/runtime/v11/static-generation-parameter-schema-v1.2-e5517ee5-87e96b78-7cfe38ace55eadde.json";
  const projection = JSON.parse(await readFile(new URL("../catalog/runtime/v11/static-generation-parameter-schema-v1.2-e5517ee5-87e96b78-7cfe38ace55eadde.json", import.meta.url), "utf8"));
  assert.equal(isInertPublicStaticRuntimeArtifact(projectionPath, { ...projection, runtime_usable: true }), false);
  assert.equal(isInertPublicStaticRuntimeArtifact(projectionPath, { ...projection, status: "PRODUCTION_READY" }), false);
  assert.equal(isInertPublicStaticRuntimeArtifact("catalog/runtime/v11/unreviewed.json", {
    artifact_kind: "SOME_KIND", runtime_usable: false
  }), false);
});

test("only explicitly excluded private static-runtime receipt directories may be empty in public mode", () => {
  const manifest = validatePublicSourceManifest(baseManifest());
  assert.equal(mayTreatPublicStaticRuntimeDirectoryAsEmpty("catalog/runtime/v12", true, manifest), true);
  assert.equal(mayTreatPublicStaticRuntimeDirectoryAsEmpty("catalog/runtime/v12", false, manifest), false);
  assert.equal(mayTreatPublicStaticRuntimeDirectoryAsEmpty("catalog/runtime/v999", true, manifest), false);

  const includedPath = "catalog/runtime/v12/selected.json";
  const manifestWithIncludedRuntimeFile = validatePublicSourceManifest(baseManifest({
    included_paths: ["README.md", catalogFixturePath, "package.json", "src/index.ts", includedPath].sort(),
    file_sha256: { "README.md": digest, [catalogFixturePath]: digest, "package.json": digest, "src/index.ts": digest, [includedPath]: digest }
  }));
  assert.equal(mayTreatPublicStaticRuntimeDirectoryAsEmpty("catalog/runtime/v12", true, manifestWithIncludedRuntimeFile), false);

  const unexpectedOmission = "catalog/runtime/v12/unclassified.json";
  const manifestWithUnexpectedOmission = validatePublicSourceManifest(baseManifest({
    excluded_paths: [...PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS, unexpectedOmission].sort()
  }));
  assert.equal(mayTreatPublicStaticRuntimeDirectoryAsEmpty("catalog/runtime/v12", true, manifestWithUnexpectedOmission), false);
});

test("public mode requires the exact explicit manifest profile and reports historical owner proof as not distributed", () => {
  const result = validatePublicSourceManifest(baseManifest());
  assert.equal(result.profile, "public-source");
  assert.equal(result.historical_owner_proofs, "NOT_DISTRIBUTED");
  assert.equal(result.private_receipt_paths.length, 15);
});

test("public manifest rejects missing, malformed, or unexpected top-level data", () => {
  assert.throws(() => validatePublicSourceManifest(undefined), /PUBLIC_MANIFEST_REQUIRED/u);
  assert.throws(() => validatePublicSourceManifest({ ...baseManifest(), schema_version: "2.0.0" }), /PUBLIC_MANIFEST_INVALID/u);
  assert.throws(() => validatePublicSourceManifest({ ...baseManifest(), unexpected: true }), /PUBLIC_MANIFEST_INVALID/u);
});

test("manifest rejects unsorted/duplicate paths, noncanonical or unhashed included paths", () => {
  assert.throws(() => validatePublicSourceManifest(baseManifest({ included_paths: ["src/index.ts", "README.md"] })), /PUBLIC_MANIFEST_INVALID/u);
  assert.throws(() => validatePublicSourceManifest(baseManifest({ included_paths: ["README.md", "README.md"] })), /PUBLIC_MANIFEST_INVALID/u);
  const caseAliasPaths = ["README.md", "readme.md"];
  assert.throws(() => validatePublicSourceManifest(baseManifest({
    included_paths: caseAliasPaths,
    file_sha256: Object.fromEntries(caseAliasPaths.map((path) => [path, digest]))
  })), /PUBLIC_MANIFEST_INVALID/u);
  assert.throws(() => validatePublicSourceManifest(baseManifest({ included_paths: ["README.md", "../secret"] })), /PUBLIC_MANIFEST_INVALID/u);
  assert.throws(() => validatePublicSourceManifest(baseManifest({ included_paths: ["x".repeat(1025)] })), /PUBLIC_MANIFEST_INVALID/u);
  assert.throws(() => validatePublicSourceManifest(baseManifest({ included_paths: ["README.md\nforged"] })), /PUBLIC_MANIFEST_INVALID/u);
  const tooManyPaths = Array.from({ length: 10_001 }, (_, index) => `src/file-${String(index).padStart(5, "0")}.ts`);
  assert.throws(() => validatePublicSourceManifest(baseManifest({
    included_paths: tooManyPaths,
    file_sha256: Object.fromEntries(tooManyPaths.map((path) => [path, digest]))
  })), /PUBLIC_MANIFEST_INVALID/u);
  assert.throws(() => validatePublicSourceManifest(baseManifest({ file_sha256: { "README.md": digest } })), /PUBLIC_MANIFEST_INVALID/u);
});

test("manifest rejects dotenv, git metadata, database, private-key, and media source paths without banning auth modules", () => {
  const protectedPaths = [".env", ".env.production", ".git/config", "src/state/cache.sqlite", "data/session.db", "data/session.db-wal", "keys/signing.pem", "assets/sample.mp4", "assets/logo.png"];
  for (const path of protectedPaths) {
    assert.throws(() => validatePublicSourceManifest(baseManifest({
      included_paths: [path], file_sha256: { [path]: digest }
    })), /PUBLIC_MANIFEST_PROTECTED_PATH/u);
  }
  const authSource = "src/auth/in-memory-auth-store.ts";
  assert.equal(validatePublicSourceManifest(baseManifest({
    included_paths: [authSource], file_sha256: { [authSource]: digest }
  })).profile, "public-source");
});

test("manifest rejects owner receipts and private documentation in public inclusion", () => {
  for (const path of [PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS[0], ".autopilot/result.md", ".AUTOPILOT/result.md", ".журналы/live.md", "docs/проект/plan.md", "docs/контроль/audit.md", "docs/private-account.json", "skills/scripts/foo-private.json"]) {
    const included = ["README.md", path].sort();
    assert.throws(() => validatePublicSourceManifest(baseManifest({
      included_paths: included,
      file_sha256: Object.fromEntries(included.map((entry) => [entry, digest]))
    })), /PUBLIC_MANIFEST_PRIVATE_PATH/u);
  }
});

test("exact fifteen private receipt exclusions are mandatory and may not be included", () => {
  const missingOne = PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS.slice(1).sort();
  assert.throws(() => validatePublicSourceManifest(baseManifest({ excluded_paths: missingOne })), /PUBLIC_MANIFEST_INVALID/u);
});

test("file hashes cover exactly the included paths and use lowercase SHA-256", () => {
  assert.throws(() => validatePublicSourceManifest(baseManifest({ file_sha256: { "README.md": digest.toUpperCase(), "src/index.ts": digest } })), /PUBLIC_MANIFEST_INVALID/u);
  assert.throws(() => validatePublicSourceManifest(baseManifest({ file_sha256: { "README.md": digest, "src/index.ts": digest, "extra": digest } })), /PUBLIC_MANIFEST_INVALID/u);
});

test("public package paths must contain manifest and all listed files while excluding private receipts and roots", () => {
  const manifest = validatePublicSourceManifest(baseManifest());
  assert.equal(assertPublicSourcePackagePaths(manifest, new Set([
    "publication-manifest.json", "README.md", catalogFixturePath, "dist/src/index.js", "package.json"
  ])).historical_owner_proofs, "NOT_DISTRIBUTED");
  for (const forbidden of [PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS[0], ".autopilot/result.md", "docs/проект/private.md"]) {
    assert.throws(() => assertPublicSourcePackagePaths(manifest, ["publication-manifest.json", "README.md", catalogFixturePath, "dist/src/index.js", forbidden]), /PUBLIC_PACKAGE_CONTENT_MISMATCH/u);
  }
  assert.throws(() => assertPublicSourcePackagePaths(manifest, ["README.md", catalogFixturePath, "dist/src/index.js"]), /PUBLIC_PACKAGE_CONTENT_MISMATCH/u);
  assert.throws(() => assertPublicSourcePackagePaths(validatePublicSourceManifest(baseManifest({ included_paths: ["README.md", "src/index.ts"], file_sha256: { "README.md": digest, "src/index.ts": digest } })),
    ["publication-manifest.json", catalogFixturePath]), /PUBLIC_PACKAGE_CONTENT_MISMATCH/u);
  for (const forbidden of [".env", ".env.local", ".env.example", ".git/config", "state/cache.sqlite", "data/session.db", "assets/clip.mp4", "assets/photo.png"]) {
    assert.throws(() => assertPublicSourcePackagePaths(manifest, ["publication-manifest.json", catalogFixturePath, forbidden]), /PUBLIC_PACKAGE_CONTENT_MISMATCH/u);
  }
  for (const unlisted of ["docs/private-account.json", "skills/scripts/foo-private.json", "dist/src/secret.txt", "dist/src/stale.js"]) {
    assert.throws(() => assertPublicSourcePackagePaths(manifest,
      ["publication-manifest.json", "README.md", "package.json", catalogFixturePath, "dist/src/index.js", unlisted]), /PUBLIC_PACKAGE_CONTENT_MISMATCH/u);
  }
  assert.equal(assertPublicSourcePackagePaths(validatePublicSourceManifest(baseManifest({
    included_paths: ["src/auth/in-memory-auth-store.ts"], file_sha256: { "src/auth/in-memory-auth-store.ts": digest }
  })), ["publication-manifest.json", "dist/src/auth/in-memory-auth-store.js"]).historical_owner_proofs, "NOT_DISTRIBUTED");
});

test("historical owner proof gate is skipped only in public mode and is never reported as public PASS", async () => {
  let calls = 0;
  assert.equal(await evaluateHistoricalOwnerProofGate(true, async () => { calls += 1; }), "NOT_DISTRIBUTED");
  assert.equal(calls, 0);
  assert.equal(await evaluateHistoricalOwnerProofGate(false, async () => { calls += 1; }), "PASS");
  assert.equal(calls, 1);
  await assert.rejects(evaluateHistoricalOwnerProofGate(false, async () => { throw new Error("STRICT_GATE_FAILED"); }), /STRICT_GATE_FAILED/u);
});

test("source verification detects missing manifest, missing file, and changed file bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-public-manifest-test-"));
  try {
    await assert.rejects(loadAndVerifyPublicSourceManifest(root), /PUBLIC_MANIFEST_REQUIRED/u);
    await mkdir(join(root, "src"));
    await mkdir(join(root, "catalog/public"), { recursive: true });
    const readme = Buffer.from("synthetic public fixture\n");
    const code = Buffer.from("export const fixture = true;\n");
    const catalog = Buffer.from("{\"fixture\":true}\n");
    const packageJson = Buffer.from("{\"name\":\"synthetic-fixture\"}\n");
    await writeFile(join(root, "README.md"), readme);
    await writeFile(join(root, "src/index.ts"), code);
    await writeFile(join(root, "package.json"), packageJson);
    await writeFile(join(root, catalogFixturePath), catalog);
    const manifest = baseManifest({ file_sha256: {
      "README.md": createHash("sha256").update(readme).digest("hex"),
      [catalogFixturePath]: createHash("sha256").update(catalog).digest("hex"),
      "package.json": createHash("sha256").update(packageJson).digest("hex"),
      "src/index.ts": createHash("sha256").update(code).digest("hex")
    } });
    await writeFile(join(root, "publication-manifest.json"), JSON.stringify(manifest));
    assert.equal((await loadAndVerifyPublicSourceManifest(root)).profile, "public-source");
    assert.equal(await assertInstalledPublicSourceFileHashes(root, await loadAndVerifyPublicSourceManifest(root),
      ["README.md", catalogFixturePath]), "PASS");
    await writeFile(join(root, "README.md"), "changed\n");
    await assert.rejects(loadAndVerifyPublicSourceManifest(root), /PUBLIC_MANIFEST_FILE_HASH_MISMATCH/u);
    await assert.rejects(assertInstalledPublicSourceFileHashes(root, await loadAndVerifyPublicSourceManifest(root).catch(() => manifest),
      ["README.md", catalogFixturePath]), /PUBLIC_PACKAGE_SOURCE_HASH_MISMATCH/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest is bounded, regular, non-symlink, and read from one immutable byte snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-public-manifest-symlink-test-"));
  try {
    await mkdir(join(root, "catalog/public"), { recursive: true });
    const readme = Buffer.from("fixture\n"), catalog = Buffer.from("{}\n"), code = Buffer.from("export {};\n");
    await writeFile(join(root, "README.md"), readme);
    await writeFile(join(root, catalogFixturePath), catalog);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/index.ts"), code);
    const manifest = baseManifest({ file_sha256: {
      "README.md": createHash("sha256").update(readme).digest("hex"),
      [catalogFixturePath]: createHash("sha256").update(catalog).digest("hex"),
      "src/index.ts": createHash("sha256").update(code).digest("hex")
    } });
    const raw = Buffer.from(JSON.stringify(manifest));
    await writeFile(join(root, "target.json"), raw);
    const { symlink } = await import("node:fs/promises");
    await symlink("target.json", join(root, "publication-manifest.json"));
    await assert.rejects(loadAndVerifyPublicSourceManifest(root), /PUBLIC_MANIFEST_PATH_INVALID/u);
    await rm(join(root, "publication-manifest.json"));
    await writeFile(join(root, "publication-manifest.json"), Buffer.alloc(4 * 1024 * 1024 + 1, 0x20));
    await assert.rejects(loadAndVerifyPublicSourceManifest(root), /PUBLIC_MANIFEST_TOO_LARGE/u);
    await writeFile(join(root, "publication-manifest.json"), Buffer.from([0xff, 0xfe, 0xfd]));
    await assert.rejects(loadAndVerifyPublicSourceManifest(root), /PUBLIC_MANIFEST_INVALID/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("only an empty .env.example is allowed as a dotenv example", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-public-env-example-test-"));
  try {
    const path = ".env.example";
    const manifest = baseManifest({ included_paths: [path], file_sha256: { [path]: createHash("sha256").update(Buffer.alloc(0)).digest("hex") } });
    await writeFile(join(root, path), Buffer.alloc(0));
    await writeFile(join(root, "publication-manifest.json"), JSON.stringify(manifest));
    assert.equal((await loadAndVerifyPublicSourceManifest(root)).profile, "public-source");
    await writeFile(join(root, path), "SYNTHETIC=example\n");
    const nonemptyHash = createHash("sha256").update("SYNTHETIC=example\n").digest("hex");
    manifest.file_sha256[path] = nonemptyHash;
    await writeFile(join(root, "publication-manifest.json"), JSON.stringify(manifest));
    await assert.rejects(loadAndVerifyPublicSourceManifest(root), /PUBLIC_MANIFEST_PROTECTED_PATH/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("package smoke resolves the canonical Seedance coverage ID and exact inert profile from the registry", async () => {
  const [{ getExpectedSeedanceProFastCoverageProfile }, { getRuntimeCoverageProfile }] = await Promise.all([
    import("../scripts/check-package-install.mjs"),
    import("../dist/src/catalog/runtime-coverage-registry.js")
  ]);
  assert.equal(typeof getExpectedSeedanceProFastCoverageProfile, "function");
  const profile = getExpectedSeedanceProFastCoverageProfile(getRuntimeCoverageProfile);
  assert.ok(profile);
  assert.equal(profile.model_id, "seedance_pro-fast");
  assert.equal(profile.ai_name, "seedance");
  assert.equal(profile.modality, "video");
  assert.equal(profile.runtime_verified, true);
  assert.equal(profile.one_copy_only, true);
  assert.deepEqual(profile.settings, {
    model_type: "seedance_pro-fast", resolution: "720p", mode: "mini", aspect_ratio: "16:9",
    video_duration: 5, generate_audio: true
  });
  assert.equal(getRuntimeCoverageProfile("seedance-pro-fast"), undefined);
});
