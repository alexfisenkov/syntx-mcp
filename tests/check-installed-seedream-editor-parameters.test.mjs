import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertInstalledSeedreamEditorParameters,
  assertSeedreamEditorParameterPackagePaths,
  formatSeedreamEditorParameterSummary,
  SeedreamEditorParametersInstalledCheckError
} from "../scripts/check-installed-seedream-editor-parameters.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const DIST_ROOT = resolve(process.env.SYNTX_SEEDREAM_EDITOR_COMPILED_DIST_ROOT ?? join(PROJECT_ROOT, "dist"));

async function createCompiledInstalledPackage() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "seedream-editor-parameters-installed-"));
  const packageRoot = join(temporaryRoot, "syntx-mcp");
  await mkdir(packageRoot);
  await cp(DIST_ROOT, join(packageRoot, "dist"), { recursive: true });
  await cp(join(PROJECT_ROOT, "catalog"), join(packageRoot, "catalog"), { recursive: true });
  await cp(join(PROJECT_ROOT, "package.json"), join(packageRoot, "package.json"));
  await symlink(join(PROJECT_ROOT, "node_modules"), join(temporaryRoot, "node_modules"), "dir");
  const packagedPaths = new Set();
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else packagedPaths.add(relative(packageRoot, path).split(sep).join("/"));
    }
  }
  await walk(packageRoot);
  return { temporaryRoot, packageRoot, packagedPaths };
}

test("Seedream Editor package path gate requires compiled parameter JS and declarations", () => {
  const paths = new Set([
    "dist/src/index.js", "dist/src/index.d.ts",
    "dist/src/application/owner-seedream-editor-parameters.js",
    "dist/src/application/owner-seedream-editor-parameters.d.ts",
    "dist/src/application/owner-seedream-image-parameters.js",
    "dist/src/application/owner-seedream-image-parameters.d.ts"
  ]);
  assert.equal(assertSeedreamEditorParameterPackagePaths(paths), true);
  for (const missing of ["dist/src/index.d.ts", "dist/src/application/owner-seedream-editor-parameters.js",
    "dist/src/application/owner-seedream-editor-parameters.d.ts"]) {
    const incomplete = new Set(paths);
    incomplete.delete(missing);
    assert.throws(() => assertSeedreamEditorParameterPackagePaths(incomplete),
      (error) => error instanceof SeedreamEditorParametersInstalledCheckError &&
        error.code === "INSTALLED_SEEDREAM_EDITOR_PACKAGE_CONTENT_MISSING");
  }
  assert.throws(() => assertSeedreamEditorParameterPackagePaths(new Set([...paths, "src/application/fallback.ts"])),
    (error) => error instanceof SeedreamEditorParametersInstalledCheckError &&
      error.code === "INSTALLED_SEEDREAM_EDITOR_SOURCE_FALLBACK_PRESENT");
});

test("clean compiled package barrel exposes the real source-only API and normalizes all 104 pairs", async (t) => {
  const fixture = await createCompiledInstalledPackage();
  t.after(() => rm(fixture.temporaryRoot, { recursive: true, force: true }));
  const proof = await assertInstalledSeedreamEditorParameters(fixture.packageRoot, fixture.packagedPaths);
  assert.deepEqual(proof, {
    variants_checked: 5,
    combinations_checked: 104,
    cost_combinations_checked: 208,
    source_only: true,
    generation_calls: 0,
    status: "INSTALLED_SEEDREAM_EDITOR_PARAMETERS_PASS",
    node_version: "24.21.0",
    clean_installed_package: true,
    backend_acceptance: "UNPROVEN"
  });
  assert.equal(formatSeedreamEditorParameterSummary(proof),
    "seedream_editor_parameters=PASS variants=5 combinations=104 cost_combinations=208 source_only=true generation_calls=0 backend_acceptance=UNPROVEN");
});
