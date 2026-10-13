import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const PUBLIC_CATALOG_HASH = PUBLIC_CATALOG_VERSION.slice("sha256-".length, -".json".length);
const PUBLIC_CATALOG_RELATIVE_PATH = join("catalog", "public", PUBLIC_CATALOG_VERSION);
const GITATTRIBUTES_RELATIVE_PATH = ".gitattributes";

function runGit(cwd, args) {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore", windowsHide: true });
  } catch {
    throw new Error("PUBLIC_LINE_ENDING_GIT_FIXTURE_FAILED");
  }
}

function countLineEndings(bytes) {
  const text = bytes.toString("latin1");
  return Object.freeze({
    crlf: (text.match(/\r\n/g) ?? []).length,
    loneLf: (text.match(/(?<!\r)\n/g) ?? []).length
  });
}

function makeAutocrlfCheckout(root, { withGitattributes, gitattributesBytes }) {
  const checkout = join(root, withGitattributes ? "with-attributes" : "without-attributes");
  const archivePath = join(checkout, PUBLIC_CATALOG_RELATIVE_PATH);
  mkdirSync(dirname(archivePath), { recursive: true });
  copyFileSync(join(projectRoot, PUBLIC_CATALOG_RELATIVE_PATH), archivePath);
  if (withGitattributes) writeFileSync(join(checkout, GITATTRIBUTES_RELATIVE_PATH), gitattributesBytes);

  runGit(checkout, ["init", "--quiet"]);
  runGit(checkout, ["config", "core.autocrlf", "true"]);
  runGit(checkout, withGitattributes
    ? ["add", "--", GITATTRIBUTES_RELATIVE_PATH, PUBLIC_CATALOG_RELATIVE_PATH]
    : ["add", "--", PUBLIC_CATALOG_RELATIVE_PATH]);
  runGit(checkout, ["-c", "user.name=Public portability test", "-c", "user.email=public-portability@example.invalid",
    "commit", "--quiet", "-m", "temporary line-ending fixture"]);

  unlinkSync(archivePath);
  runGit(checkout, ["checkout", "--force", "HEAD", "--", PUBLIC_CATALOG_RELATIVE_PATH]);
  return Object.freeze({ checkout, archivePath, catalogDirectory: join(checkout, "catalog") });
}

async function publicCatalogLoader() {
  const modulePath = join(projectRoot, "dist", "src", "catalog", "public-catalog-history.js");
  if (!existsSync(modulePath)) throw new Error("PUBLIC_LINE_ENDING_BUILT_LOADER_MISSING");
  return import(pathToFileURL(modulePath).href);
}

test("core.autocrlf=true reproduces a hash mismatch without the repository attributes", async () => {
  const sourceBytes = readFileSync(join(projectRoot, PUBLIC_CATALOG_RELATIVE_PATH));
  assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), PUBLIC_CATALOG_HASH);
  const fixtureRoot = mkdtempSync(join(tmpdir(), "syntx-public-lf-negative-"));
  try {
    const { archivePath, catalogDirectory } = makeAutocrlfCheckout(fixtureRoot,
      { withGitattributes: false, gitattributesBytes: Buffer.alloc(0) });
    const checkedOutBytes = readFileSync(archivePath);
    const endings = countLineEndings(checkedOutBytes);
    assert.ok(endings.crlf > 0, "fixture should contain Git's CRLF checkout conversion");
    assert.equal(endings.loneLf, 0);
    assert.notDeepEqual(checkedOutBytes, sourceBytes);

    const loader = await publicCatalogLoader();
    assert.throws(
      () => loader.loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION, catalogDirectory),
      (error) => error?.message === "PUBLIC_CATALOG_VERSION_HASH_MISMATCH"
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("repository attributes preserve the pinned catalog bytes and loader under core.autocrlf=true", async () => {
  const sourceBytes = readFileSync(join(projectRoot, PUBLIC_CATALOG_RELATIVE_PATH));
  const gitattributesBytes = readFileSync(join(projectRoot, GITATTRIBUTES_RELATIVE_PATH));
  assert.match(gitattributesBytes.toString("utf8"), /^\* text=auto eol=lf$/mu);
  assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), PUBLIC_CATALOG_HASH);
  const fixtureRoot = mkdtempSync(join(tmpdir(), "syntx-public-lf-positive-"));
  try {
    const { archivePath, catalogDirectory } = makeAutocrlfCheckout(fixtureRoot,
      { withGitattributes: true, gitattributesBytes });
    const checkedOutBytes = readFileSync(archivePath);
    const endings = countLineEndings(checkedOutBytes);
    assert.equal(endings.crlf, 0);
    assert.equal(endings.loneLf, countLineEndings(sourceBytes).loneLf);
    assert.deepEqual(checkedOutBytes, sourceBytes);

    const loader = await publicCatalogLoader();
    const snapshot = loader.loadPublicCatalogVersion(PUBLIC_CATALOG_VERSION, catalogDirectory);
    assert.equal(snapshot.runtime_usable, false);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
