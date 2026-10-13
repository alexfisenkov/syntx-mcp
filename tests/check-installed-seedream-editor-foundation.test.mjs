import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertInstalledSeedreamEditorFoundation,
  formatSeedreamEditorFoundationSummary,
  SeedreamEditorFoundationInstalledCheckError
} from "../scripts/check-installed-seedream-editor-foundation.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const DIST_ROOT = resolve(process.env.SYNTX_SEEDREAM_EDITOR_COMPILED_DIST_ROOT ?? join(PROJECT_ROOT, "dist"));

async function createCompiledInstalledPackage() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "seedream-editor-foundation-installed-"));
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

test("installed Editor foundation uses the compiled public barrel and module declarations", async (t) => {
  const fixture = await createCompiledInstalledPackage();
  t.after(() => rm(fixture.temporaryRoot, { recursive: true, force: true }));
  const proof = await assertInstalledSeedreamEditorFoundation(fixture.packageRoot, fixture.packagedPaths);
  assert.deepEqual(proof, {
    original_upload_posts: 5,
    source_profiles_checked: 5,
    generation_intents_checked: 104,
    generation_calls: 0,
    source_only: true,
    provider_backend: "UNPROVEN",
    owner_handle_flow: "NOT_CHECKED",
    editor_mcp: "NOT_ADDED",
    status: "INSTALLED_SEEDREAM_EDITOR_FOUNDATION_PASS",
    node_version: "24.21.0",
    clean_installed_package: true
  });
  assert.equal(formatSeedreamEditorFoundationSummary(proof),
    "seedream_editor_foundation=PASS original_upload_posts=5 source_profiles=5 generation_intents=104 generation_calls=0 source_only=true provider_backend=UNPROVEN owner_handle_flow=NOT_CHECKED editor_mcp=NOT_ADDED");
  assert.match(formatSeedreamEditorFoundationSummary(proof), /owner_handle_flow=NOT_CHECKED/u);
  assert.match(formatSeedreamEditorFoundationSummary(proof), /editor_mcp=NOT_ADDED/u);

  assert.throws(() => formatSeedreamEditorFoundationSummary({ ...proof, original_upload_posts: 4 }),
    (error) => error instanceof SeedreamEditorFoundationInstalledCheckError);
});

test("foundation summary preserves source-only and no-generation boundaries", () => {
  const invalidProofs = [
    { original_upload_posts: 4, source_profiles_checked: 5, generation_intents_checked: 104, generation_calls: 0, source_only: true, provider_backend: "UNPROVEN", owner_handle_flow: "NOT_CHECKED", editor_mcp: "NOT_ADDED" },
    { original_upload_posts: 5, source_profiles_checked: 5, generation_intents_checked: 104, generation_calls: 1, source_only: true, provider_backend: "UNPROVEN", owner_handle_flow: "NOT_CHECKED", editor_mcp: "NOT_ADDED" },
    { original_upload_posts: 5, source_profiles_checked: 5, generation_intents_checked: 104, generation_calls: 0, source_only: false, provider_backend: "ACCEPTED", owner_handle_flow: "NOT_CHECKED", editor_mcp: "NOT_ADDED" },
    { original_upload_posts: 5, source_profiles_checked: 5, generation_intents_checked: 104, generation_calls: 0, source_only: true, provider_backend: "UNPROVEN", owner_handle_flow: "NONE", editor_mcp: "NOT_ADDED" },
    { original_upload_posts: 5, source_profiles_checked: 5, generation_intents_checked: 104, generation_calls: 0, source_only: true, provider_backend: "UNPROVEN", owner_handle_flow: "NOT_CHECKED", editor_mcp: "NONE" }
  ];
  for (const proof of invalidProofs) assert.throws(() => formatSeedreamEditorFoundationSummary(proof),
    (error) => error instanceof SeedreamEditorFoundationInstalledCheckError);
});
