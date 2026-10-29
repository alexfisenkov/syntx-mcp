import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validatePublicSourceManifest } from "../scripts/public-source-package-manifest.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/export-public-snapshot.mjs", import.meta.url));
const POLICY_PATH = fileURLToPath(new URL("../tools/publication/public-source-policy.json", import.meta.url));
const BOOTSTRAP_PATHS = ["README.md", "AGENTS.md", "SECURITY.md", ".gitignore", ".github/workflows/verify.yml",
  "docs/интеграция/Inpaint-источники-и-границы.md", "docs/интеграция/Обновление-MCP.md",
  "docs/модели/WAN-image-источники-и-параметры.md", "docs/интеграция/WAN-2.5-Preview-MCP.md"];
const REQUIRED_PRIVATE_CATALOG_PATHS = [
  "catalog/runtime/v12/owner-mcp-banana21-smoke.json",
  "catalog/runtime/v12/owner-mcp-seedance-pro-fast-smoke.json",
  "catalog/runtime/v12/owner-mcp-seedance-pro-fast-smoke-v2.json",
  "catalog/runtime/v12/owner-mcp-seedance-pro-fast-smoke-correction-note.json",
  "catalog/runtime/v12/owner-observed-banana-2.1-1k-minimal.json",
  "catalog/runtime/v12/result-dimensions.json",
  "catalog/runtime/v13/owner-stdio-contract-banana21-smoke.json",
  "catalog/runtime/v13/owner-stdio-contract-seedance-pro-fast-smoke.json",
  "catalog/runtime/v15/owner-stdio-v2-banana21-smoke.json",
  "catalog/runtime/v15/owner-stdio-v2-seedance-pro-fast-smoke.json",
  "catalog/runtime/v17/existing-profile-terminal-evidence.json",
  "catalog/runtime/v18/owner-stdio-persistent-auth-smoke.json",
  "catalog/runtime/v18/owner-stdio-persistent-auth-smoke-v2.json",
  "catalog/runtime/v20/owner-reviewed-seedream5-probe.json",
  "catalog/runtime/v21/owner-reviewed-wan27-recovery-probe.json"
];
const SOURCE_FACT_DEPENDENT_TESTS = [
  "tests/banana21-aspect-ratio-contract-v2.test.ts",
  "tests/existing-profile-generation-contracts-v2.test.ts",
  "tests/flux-pro-ultra-client-profile-v2.test.ts",
  "tests/flux-ultra-exact-live-profile-v2.test.ts",
  "tests/gpt-image2-source-profile-v2.test.ts",
  "tests/hailuo-resolution-duration-candidates.test.ts",
  "tests/ideogram-40-45-source-profile-v2.test.ts",
  "tests/ideogram-4045-live-profile-v2.test.ts",
  "tests/ideogram-image-ratio-profile-v2.test.ts",
  "tests/ideogram-two-ratio-proof-profile-v2.test.ts",
  "tests/image-family-generation-contracts-v2.test.ts",
  "tests/live-owner-reviewed-contract-probe.test.mjs",
  "tests/owner-grok-image-reference-lifecycle.test.ts",
  "tests/owner-grok-image-reference-one-shot-policy.test.ts",
  "tests/owner-grok-image-reference-profiles.test.ts",
  "tests/owner-grok-image-reference-request-preparer.test.ts",
  "tests/owner-grok-image-reference-service.test.ts",
  "tests/owner-grok-image-reference-upload-service.test.ts",
  "tests/owner-reviewed-contract-proof.test.ts",
  "tests/owner-reviewed-contract-recovery.test.ts",
  "tests/seedream-flash-live-profile-v2.test.ts",
  "tests/seedream-flash-source-profile-v2.test.ts",
  "tests/wan-resolution-ratio-candidates.test.ts",
  "tests/wan25-t2i-client-profile-v2.test.ts"
];
const PRIVATE_SENTINEL = ["SYNTHETIC", "PRIVATE", "BLOB", "MARKER", "1157"].join("_");
const DIRTY_SENTINEL = ["SYNTHETIC", "DIRTY", "TOKEN", "MARKER", "1157"].join("_");
const LOCAL_SERVICE_ROOTS = [".критики", ".черновики", ".журналы"];
const LOCAL_SERVICE_CONTENT = "local-only service scaffold\n";
const LOCAL_SERVICE_PRIVATE_CONTENT = "local-only private service file\n";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writePath(root, path, contents) {
  const target = join(root, ...path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), "syntx-public-export-1157-"));
}

function initializeRepo(root) {
  mkdirSync(root, { recursive: true });
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Snapshot Fixture");
  git(root, "config", "user.email", "snapshot-fixture@example.invalid");
}

function seedCommit(root) {
  const included = [
    ["src/native.mjs", "export const policy = 'committed-source';\n"],
    ["tools/check.mjs", "export const synthetic = true;\n"],
    ["scripts/helper.mjs", "#!/usr/bin/env node\n"],
    ["tests/synthetic.test.mjs", "import test from 'node:test';\n"],
    ["tests/owner-flux-image-parameters.test.ts", "sanitized synthetic request fixture\n"],
    ["tests/live-owner-soul-shape-stdio-acceptance.test.mjs", "synthetic in-memory harness fixture\n"],
    ["catalog/public/snapshot.json", "{\"status\":\"source-only\"}\n"],
    ["catalog/runtime/v1/public-source.json", "{\"source\":\"synthetic\"}\n"],
    ["skills/syntx-mcp-update/SKILL.md", "# Synthetic public skill\n"],
    ["package.json", "{\"private\":true}\n"],
    ["package-lock.json", "{\"lockfileVersion\":3}\n"],
    ["tsconfig.json", "{}\n"],
    ["tsconfig.source-backed-build.json", "{}\n"],
    ["LICENSE", "MIT fixture text\n"]
  ];
  for (const [path, contents] of included) writePath(root, path, contents);

  writePath(root, REQUIRED_PRIVATE_CATALOG_PATHS[0], `${PRIVATE_SENTINEL}\n`);
  for (const path of SOURCE_FACT_DEPENDENT_TESTS) writePath(root, path, `${PRIVATE_SENTINEL}\n`);
  writePath(root, ".env.example", `${PRIVATE_SENTINEL}\n`);
  writePath(root, "scripts/export-public-snapshot.mjs", readFileSync(SCRIPT));
  writePath(root, "scripts/public-source-package-manifest.mjs",
    readFileSync(fileURLToPath(new URL("../scripts/public-source-package-manifest.mjs", import.meta.url))));
  writePath(root, "tests/export-public-snapshot.test.mjs", readFileSync(fileURLToPath(import.meta.url)));
  writePath(root, "tools/publication/public-source-policy.json", readFileSync(POLICY_PATH));
  for (const [path, contents] of [
    ["README.md", "old internal README sentinel\n"],
    ["AGENTS.md", "internal instructions sentinel\n"],
    ["CLAUDE.md", "internal assistant notes sentinel\n"],
    [".gitignore", "internal ignores\n"],
    ["SECURITY.md", "old source security file\n"],
    [".github/workflows/verify.yml", "old internal workflow\n"],
    ["docs/интеграция/Обновление-MCP.md", "old internal updater history\n"],
    ["docs/интеграция/old-proof.md", `${PRIVATE_SENTINEL}\n`],
    ["docs/проект/private.md", `${PRIVATE_SENTINEL}\n`],
    ["docs/контроль/private.md", `${PRIVATE_SENTINEL}\n`],
    [".autopilot/private.md", `${PRIVATE_SENTINEL}\n`],
    [".журналы/private.log", `${PRIVATE_SENTINEL}\n`]
  ]) writePath(root, path, contents);

  git(root, "add", "--all");
  git(root, "commit", "--quiet", "-m", "synthetic source fixture");
  return git(root, "rev-parse", "HEAD");
}

function makeBootstrap(destination) {
  for (const path of BOOTSTRAP_PATHS) writePath(destination, path, `BOOTSTRAP_${path}\n`);
  for (const path of LOCAL_SERVICE_ROOTS) {
    writePath(destination, `${path}/.gitkeep`, LOCAL_SERVICE_CONTENT);
    writePath(destination, `${path}/private-local.txt`, LOCAL_SERVICE_PRIVATE_CONTENT);
  }
}

function runExporter(source, destination, sourceCommit, extraArgs = []) {
  const result = spawnSync(process.execPath, [SCRIPT, "--source-commit", sourceCommit, "--destination", destination, ...extraArgs], {
    cwd: source,
    encoding: "utf8",
    timeout: 20_000,
    env: { PATH: process.env.PATH ?? "" }
  });
  return result;
}

function walkFiles(root, relativePath = "") {
  const results = [];
  for (const entry of readdirSync(join(root, relativePath), { withFileTypes: true })) {
    const child = relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
    if (child === ".git") continue;
    if (relativePath === "" && LOCAL_SERVICE_ROOTS.includes(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error("fixture contains unexpected symlink");
    if (entry.isDirectory()) results.push(...walkFiles(root, child));
    else results.push(child);
  }
  return results.sort();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("exports only the exact committed source tree, preserves bootstrap, hashes files, and repeats idempotently", () => {
  const temp = fixtureRoot();
  const source = join(temp, "source");
  const destination = join(temp, "public-checkout");
  try {
    initializeRepo(source);
    const sourceCommit = seedCommit(source);
    initializeRepo(destination);
    makeBootstrap(destination);

    const first = runExporter(source, destination, sourceCommit);
    assert.equal(first.status, 0, first.stderr);
    const manifestBytes = readFileSync(join(destination, "publication-manifest.json"));
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    assert.deepEqual(Object.keys(manifest), ["schema_version", "profile", "source_commit", "included_paths", "excluded_paths", "excluded_roots", "file_sha256"]);
    assert.equal(manifest.schema_version, "1.0.0");
    assert.equal(manifest.profile, "public-source");
    assert.equal(manifest.source_commit, sourceCommit);
    assert.deepEqual(manifest.included_paths, [...manifest.included_paths].sort());
    assert.deepEqual(manifest.excluded_paths, [...manifest.excluded_paths].sort());
    assert.deepEqual(manifest.excluded_roots, [".aispa-work", ".autopilot", ".журналы", "docs/контроль", "docs/проект"]);
    assert.equal(manifest.excluded_paths.some((path) => path.startsWith("docs/")), false,
      "excluded docs filenames are represented by a root, not leaked into the manifest");
    assert.deepEqual(Object.keys(manifest.file_sha256), manifest.included_paths);
    assert.equal(manifest.included_paths.includes("publication-manifest.json"), false);
    assert.equal(manifest.included_paths.includes(".git/config"), false);
    assert.equal(manifest.included_paths.includes("src/native.mjs"), true);
    assert.equal(manifest.included_paths.includes("LICENSE"), true);
    assert.equal(manifest.included_paths.includes(".env.example"), false);
    assert.equal(manifest.excluded_paths.includes(".env.example"), true);
    assert.equal(manifest.included_paths.includes("docs/интеграция/Обновление-MCP.md"), true);
    assert.equal(manifest.excluded_paths.includes("docs/интеграция/Обновление-MCP.md"), false);
    assert.doesNotThrow(() => validatePublicSourceManifest(manifest), "manifest must pass the shipped 1156 public-source validator");
    assert.throws(() => validatePublicSourceManifest({ ...manifest,
      excluded_paths: [...manifest.excluded_paths, "README.md"].sort() }), /PUBLIC_MANIFEST_INVALID/u,
    "the shipped validator rejects bootstrap path duplication in exclusions");
    assert.throws(() => validatePublicSourceManifest({ ...manifest,
      excluded_roots: [...manifest.excluded_roots].reverse() }), /PUBLIC_MANIFEST_INVALID/u,
    "the shipped validator requires its exact sorted protected roots");
    for (const path of BOOTSTRAP_PATHS) {
      assert.equal(readFileSync(join(destination, ...path.split("/")), "utf8"), `BOOTSTRAP_${path}\n`);
      assert.equal(manifest.included_paths.includes(path), true);
    }
    for (const path of REQUIRED_PRIVATE_CATALOG_PATHS.concat(SOURCE_FACT_DEPENDENT_TESTS)) {
      assert.equal(manifest.included_paths.includes(path), false, `private path exported: ${path}`);
      assert.equal(manifest.excluded_paths.includes(path), true, `private path not recorded: ${path}`);
    }
    for (const path of ["tests/owner-flux-image-parameters.test.ts", "tests/live-owner-soul-shape-stdio-acceptance.test.mjs",
      "scripts/export-public-snapshot.mjs", "scripts/public-source-package-manifest.mjs",
      "tests/export-public-snapshot.test.mjs", "tools/publication/public-source-policy.json"]) {
      assert.equal(manifest.included_paths.includes(path), true, `sanitized/public maintenance source missing: ${path}`);
      assert.equal(manifest.excluded_paths.includes(path), false, `included path also excluded: ${path}`);
    }
    const files = walkFiles(destination);
    for (const path of files) {
      const bytes = readFileSync(join(destination, ...path.split("/")));
      assert.equal(bytes.includes(Buffer.from(PRIVATE_SENTINEL)), false, `private marker leaked in ${path}`);
      if (Object.hasOwn(manifest.file_sha256, path)) assert.equal(sha256(bytes), manifest.file_sha256[path]);
    }
    for (const path of LOCAL_SERVICE_ROOTS) {
      assert.equal(readFileSync(join(destination, path, ".gitkeep"), "utf8"), LOCAL_SERVICE_CONTENT);
      assert.equal(readFileSync(join(destination, path, "private-local.txt"), "utf8"), LOCAL_SERVICE_PRIVATE_CONTENT,
        "opaque local service contents are preserved without being copied or rewritten");
      assert.equal(manifest.included_paths.includes(`${path}/.gitkeep`), false);
      assert.equal(Object.hasOwn(manifest.file_sha256, `${path}/.gitkeep`), false);
      assert.equal(manifest.included_paths.includes(`${path}/private-local.txt`), false);
      assert.equal(Object.hasOwn(manifest.file_sha256, `${path}/private-local.txt`), false);
    }

    const before = manifestBytes.toString("hex");
    const second = runExporter(source, destination, sourceCommit);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(join(destination, "publication-manifest.json")).toString("hex"), before);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("exports only the allowlisted media guides through broad docs exclusion while private roots and receipts stay excluded", () => {
  const temp = fixtureRoot();
  const source = join(temp, "source");
  const destination = join(temp, "public-checkout");
  const guide = "docs/интеграция/Runway-Gen4-I2V-MCP.md";
  const grokGuide = "docs/интеграция/Grok-I2V-MCP.md";
  const privateDoc = "docs/интеграция/private-runway-note.md";
  const protectedRootFile = "docs/контроль/private.md";
  const aispaRecord = ".aispa-work/private-run.md";
  const privateReceipt = ".публикация/receipt.json";
  const bookkeeping = ".публикация/editor2238-ci.json";
  const envFile = ".env.secret";
  const guideBytes = Buffer.from("# Runway MCP guide\nSanitized public integration instructions.\n");
  const grokGuideBytes = Buffer.from("# Grok I2V MCP guide\nSanitized public integration instructions.\n");
  try {
    initializeRepo(source);
    seedCommit(source);
    const policy = JSON.parse(readFileSync(join(source, "tools/publication/public-source-policy.json"), "utf8"));
    policy.included_files = [...new Set([...policy.included_files, guide, grokGuide, protectedRootFile, envFile, aispaRecord])];
    policy.excluded_prefixes = [...new Set([...policy.excluded_prefixes, ".публикация"])];
    writePath(source, "tools/publication/public-source-policy.json", `${JSON.stringify(policy, null, 2)}\n`);
    writePath(source, guide, guideBytes);
    writePath(source, grokGuide, grokGuideBytes);
    writePath(source, privateDoc, `${PRIVATE_SENTINEL}\n`);
    writePath(source, protectedRootFile, `${PRIVATE_SENTINEL}\n`);
    writePath(source, aispaRecord, `${PRIVATE_SENTINEL}\n`);
    writePath(source, privateReceipt, `${PRIVATE_SENTINEL}\n`);
    writePath(source, bookkeeping, `${PRIVATE_SENTINEL}\n`);
    writePath(source, envFile, `${PRIVATE_SENTINEL}\n`);
    git(source, "add", "--all");
    git(source, "commit", "--quiet", "-m", "synthetic Runway export policy fixture");
    const sourceCommit = git(source, "rev-parse", "HEAD");
    initializeRepo(destination);
    makeBootstrap(destination);

    const result = runExporter(source, destination, sourceCommit);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(join(destination, "publication-manifest.json"), "utf8"));
    assert.equal(manifest.included_paths.includes(guide), true);
    assert.equal(manifest.file_sha256[guide], sha256(guideBytes));
    assert.deepEqual(readFileSync(join(destination, ...guide.split("/"))), guideBytes);
    assert.equal(manifest.included_paths.includes(grokGuide), true);
    assert.equal(manifest.file_sha256[grokGuide], sha256(grokGuideBytes));
    assert.deepEqual(readFileSync(join(destination, ...grokGuide.split("/"))), grokGuideBytes);

    for (const path of [privateDoc, protectedRootFile, privateReceipt, bookkeeping, envFile, aispaRecord]) {
      assert.equal(manifest.included_paths.includes(path), false, `private path exported: ${path}`);
      assert.equal(walkFiles(destination).includes(path), false, `private filename leaked: ${path}`);
    }
    assert.equal(manifest.excluded_paths.includes(protectedRootFile), false,
      "a private-root exclusion remains opaque even when included_files maliciously names it");
    assert.deepEqual(manifest.excluded_roots, [".aispa-work", ".autopilot", ".журналы", "docs/контроль", "docs/проект"]);
    assert.equal(manifest.excluded_paths.includes(aispaRecord), false,
      "AISpa work-root contents stay opaque and filenames are not recorded");
    assert.equal(manifest.excluded_paths.includes(envFile), true,
      "environment-file protections remain active before exact-file allowlisting");
    for (const path of walkFiles(destination)) {
      const bytes = readFileSync(join(destination, ...path.split("/")));
      assert.equal(bytes.includes(Buffer.from(PRIVATE_SENTINEL)), false, `private marker leaked in ${path}`);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("exports only committed blobs and excludes dirty working-tree marker content", () => {
  const temp = fixtureRoot();
  const source = join(temp, "source");
  const destination = join(temp, "public-checkout");
  try {
    initializeRepo(source);
    const sourceCommit = seedCommit(source);
    makeBootstrap(destination);
    const committedPolicy = readFileSync(join(source, "tools/publication/public-source-policy.json"));
    writePath(source, "src/native.mjs", `${DIRTY_SENTINEL}\n`);
    writePath(source, "tools/publication/public-source-policy.json", `${DIRTY_SENTINEL}\n`);
    writePath(source, "tests/untracked-dirty-marker.txt", `${DIRTY_SENTINEL}\n`);
    const result = runExporter(source, destination, sourceCommit);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes(DIRTY_SENTINEL), false);
    assert.equal(readFileSync(join(destination, "src/native.mjs"), "utf8"), "export const policy = 'committed-source';\n");
    assert.deepEqual(readFileSync(join(destination, "tools/publication/public-source-policy.json")), committedPolicy,
      "a dirty working-tree policy cannot change the export decisions");
    assert.equal(walkFiles(destination).some((path) => readFileSync(join(destination, ...path.split("/"))).includes(Buffer.from(DIRTY_SENTINEL))), false);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("rejects unclassified source files and path traversal arguments", () => {
  const temp = fixtureRoot();
  const source = join(temp, "source");
  const destination = join(temp, "public-checkout");
  try {
    initializeRepo(source);
    const sourceCommit = seedCommit(source);
    writePath(source, "unreviewed.bin", "synthetic unclassified data\n");
    git(source, "add", "unreviewed.bin");
    git(source, "commit", "--quiet", "-m", "unreviewed file fixture");
    const unclassifiedCommit = git(source, "rev-parse", "HEAD");
    makeBootstrap(destination);
    const unclassified = runExporter(source, destination, unclassifiedCommit);
    assert.equal(unclassified.status, 2);
    assert.match(unclassified.stderr, /SOURCE_PATH_UNCLASSIFIED/u);
    assert.equal(walkFiles(destination).some((path) => !BOOTSTRAP_PATHS.includes(path)), false,
    "source classification completes before any source file is installed");

    const gitDestination = runExporter(source, join(source, ".git"), unclassifiedCommit);
    assert.equal(gitDestination.status, 2);
    assert.match(gitDestination.stderr, /DESTINATION_UNSAFE/u);

    const traversal = spawnSync(process.execPath, [SCRIPT, "--source-commit", sourceCommit, "--destination", "../outside"], {
      cwd: source, encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH ?? "" }
    });
    assert.equal(traversal.status, 2);
    assert.match(traversal.stderr, /INVALID_ARGUMENT/u);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("rejects binary media blobs from otherwise included source roots", () => {
  const temp = fixtureRoot();
  const source = join(temp, "source");
  const destination = join(temp, "public-checkout");
  try {
    initializeRepo(source);
    seedCommit(source);
    writePath(source, "src/fixtures/sample.mp4", Buffer.from([0, 1, 2, 3, 0xff]));
    git(source, "add", "src/fixtures/sample.mp4");
    git(source, "commit", "--quiet", "-m", "binary media fixture");
    const sourceCommit = git(source, "rev-parse", "HEAD");
    makeBootstrap(destination);
    const result = runExporter(source, destination, sourceCommit);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /SOURCE_BINARY_UNSUPPORTED/u);
    assert.equal(walkFiles(destination).some((path) => path.includes("sample.mp4")), false);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("fails closed for source symlinks, destination symlinks, and unknown destination content", () => {
  const temp = fixtureRoot();
  const source = join(temp, "source");
  const destination = join(temp, "public-checkout");
  const linkedDestination = join(temp, "linked-checkout");
  const external = join(temp, "external");
  try {
    initializeRepo(source);
    const sourceCommit = seedCommit(source);
    writePath(source, "src/target.mjs", "safe\n");
    symlinkSync("target.mjs", join(source, "src/link.mjs"));
    git(source, "add", "src/target.mjs", "src/link.mjs");
    git(source, "commit", "--quiet", "-m", "symlink source fixture");
    const symlinkCommit = git(source, "rev-parse", "HEAD");
    makeBootstrap(destination);
    const sourceLink = runExporter(source, destination, symlinkCommit);
    assert.equal(sourceLink.status, 2);
    assert.match(sourceLink.stderr, /SOURCE_SYMLINK_UNSUPPORTED/u);

    mkdirSync(external, { recursive: true });
    symlinkSync(external, linkedDestination, "dir");
    const destinationLink = runExporter(source, linkedDestination, sourceCommit);
    assert.equal(destinationLink.status, 2);
    assert.match(destinationLink.stderr, /DESTINATION_SYMLINK/u);

    const localServiceLink = join(destination, ".критики");
    rmSync(localServiceLink, { recursive: true, force: true });
    symlinkSync(external, localServiceLink, "dir");
    const linkedServiceRoot = runExporter(source, destination, sourceCommit);
    assert.equal(linkedServiceRoot.status, 2);
    assert.match(linkedServiceRoot.stderr, /DESTINATION_SYMLINK/u);
    rmSync(localServiceLink, { force: true });
    writePath(destination, ".критики/.gitkeep", LOCAL_SERVICE_CONTENT);

    writePath(destination, "unreviewed.txt", "stale file\n");
    const stale = runExporter(source, destination, sourceCommit);
    assert.equal(stale.status, 2);
    assert.match(stale.stderr, /DESTINATION_UNMANAGED_CONTENT/u);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("does not overwrite collisions or replace an existing export from a different commit", () => {
  const temp = fixtureRoot();
  const source = join(temp, "source");
  const destination = join(temp, "public-checkout");
  try {
    initializeRepo(source);
    const firstCommit = seedCommit(source);
    makeBootstrap(destination);
    const first = runExporter(source, destination, firstCommit);
    assert.equal(first.status, 0, first.stderr);
    const initialManifest = readFileSync(join(destination, "publication-manifest.json"));

    const exportedSourcePath = join(destination, "src/native.mjs");
    writeFileSync(exportedSourcePath, "destination collision\n");
    const collision = runExporter(source, destination, firstCommit);
    assert.equal(collision.status, 2);
    assert.match(collision.stderr, /DESTINATION_CONTENT_MISMATCH/u);
    assert.equal(readFileSync(exportedSourcePath, "utf8"), "destination collision\n", "collision content is never overwritten");
    writeFileSync(exportedSourcePath, "export const policy = 'committed-source';\n");

    writePath(source, "src/native.mjs", "committed second source\n");
    git(source, "add", "src/native.mjs");
    git(source, "commit", "--quiet", "-m", "second source fixture");
    const secondCommit = git(source, "rev-parse", "HEAD");
    const update = runExporter(source, destination, secondCommit);
    assert.equal(update.status, 2);
    assert.match(update.stderr, /SOURCE_COMMIT_UPDATE_UNSUPPORTED/u);
    assert.deepEqual(readFileSync(join(destination, "publication-manifest.json")), initialManifest);
    assert.equal(readFileSync(join(destination, "src/native.mjs"), "utf8"), "export const policy = 'committed-source';\n");
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
