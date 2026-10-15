#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePublicSourceManifest } from "./public-source-package-manifest.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const POLICY_SOURCE_PATH = "tools/publication/public-source-policy.json";
const OPAQUE_DESTINATION_DIRS = new Set([".критики", ".черновики", ".журналы"]);
const HEX_40 = /^[0-9a-f]{40}$/u;
const HEX_64 = /^[0-9a-f]{64}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const MAX_GIT_BUFFER = 256 * 1024 * 1024;
const BOOTSTRAP_MANIFEST_FIELD_ORDER = [
  "schema_version", "profile", "source_commit", "included_paths", "excluded_paths", "excluded_roots", "file_sha256"
];

export class PublicSnapshotExportError extends Error {
  constructor(code) {
    super(code);
    this.name = "PublicSnapshotExportError";
    this.code = code;
  }
}

function fail(code) {
  throw new PublicSnapshotExportError(code);
}

function readPolicy(bytes) {
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail("POLICY_INVALID"); }
  const expectedKeys = ["schema_version", "profile", "manifest_filename", "included_roots", "included_files",
    "bootstrap_paths", "excluded_roots", "excluded_prefixes", "excluded_paths", "mandatory_excluded_paths",
    "bootstrap_digest_algorithm", "source_files_digest_algorithm"];
  if (!isPlainObject(value) || !sameStringArray(Object.keys(value).sort(), [...expectedKeys].sort()) ||
      value.schema_version !== "1.0.0" || value.profile !== "public-source" ||
      value.manifest_filename !== "publication-manifest.json" ||
      value.bootstrap_digest_algorithm !== "sha256" || value.source_files_digest_algorithm !== "sha256") {
    fail("POLICY_INVALID");
  }
  for (const key of ["included_roots", "included_files", "bootstrap_paths", "excluded_roots", "excluded_prefixes",
    "excluded_paths", "mandatory_excluded_paths"]) {
    assertPolicyPathList(value[key]);
  }
  if (!sameStringArray(value.bootstrap_paths, [".github/workflows/verify.yml", ".gitignore", "AGENTS.md", "README.md",
    "SECURITY.md", "docs/интеграция/Inpaint-источники-и-границы.md", "docs/интеграция/Обновление-MCP.md",
    "docs/модели/WAN-image-источники-и-параметры.md", "docs/интеграция/WAN-2.5-Preview-MCP.md"]) ||
      !sameStringArray(value.excluded_roots, [".autopilot", ".журналы", "docs/контроль", "docs/проект"])) {
    fail("POLICY_INVALID");
  }
  return Object.freeze(value);
}

/** Pure policy validator exposed for focused export-policy checks. */
export function readPublicSourcePolicy(bytes) { return readPolicy(bytes); }

function assertPolicyPathList(value) {
  if (!Array.isArray(value) || value.some((path) => typeof path !== "string" || !isSafeRelativePath(path)) ||
      new Set(value).size !== value.length) fail("POLICY_INVALID");
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.startsWith("/") ||
      CONTROL_CHARACTERS.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) fail("INVALID_ARGUMENT");
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag !== "--source-commit" && flag !== "--destination") || parsed.has(flag) || typeof value !== "string" || value.length === 0) {
      fail("INVALID_ARGUMENT");
    }
    parsed.set(flag, value);
  }
  const sourceCommit = parsed.get("--source-commit");
  const destinationInput = parsed.get("--destination");
  if (!sourceCommit || !HEX_40.test(sourceCommit) || !destinationInput ||
      destinationInput.split(/[\\/]/u).includes("..") || CONTROL_CHARACTERS.test(destinationInput)) {
    fail("INVALID_ARGUMENT");
  }
  return Object.freeze({ sourceCommit, destinationInput });
}

function gitBuffer(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "buffer", maxBuffer: MAX_GIT_BUFFER, windowsHide: true });
  } catch { fail("SOURCE_REPOSITORY_INVALID"); }
}

function gitText(root, args) {
  const buffer = gitBuffer(root, args);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer).trim(); }
  catch { fail("SOURCE_REPOSITORY_INVALID"); }
}

function sourceRootFrom(cwd) {
  const root = gitText(cwd, ["rev-parse", "--show-toplevel"]);
  try { return realpathSync(root); }
  catch { fail("SOURCE_REPOSITORY_INVALID"); }
}

function validateCommit(root, sourceCommit) {
  const type = gitText(root, ["cat-file", "-t", sourceCommit]);
  if (type !== "commit") fail("SOURCE_COMMIT_INVALID");
}

function parseTreeEntries(root, sourceCommit) {
  const bytes = gitBuffer(root, ["ls-tree", "-r", "-z", "--full-tree", sourceCommit]);
  let decoded;
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("SOURCE_TREE_INVALID"); }
  const records = [];
  for (const record of decoded.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) fail("SOURCE_TREE_INVALID");
    const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40})$/u.exec(record.slice(0, tab));
    const path = record.slice(tab + 1);
    if (!match || !isSafeRelativePath(path)) fail("SOURCE_TREE_INVALID");
    records.push(Object.freeze({ mode: match[1], type: match[2], objectId: match[3], path }));
  }
  records.sort((left, right) => comparePaths(left.path, right.path));
  return records;
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathIsUnder(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function isSourceExcluded(path, policy) {
  if (policy.excluded_roots.some((root) => pathIsUnder(path, root))) return "root";
  if (policy.excluded_paths.includes(path)) return "path";
  if (policy.excluded_prefixes.some((prefix) => pathIsUnder(path, prefix))) return "prefix";
  if (path === ".env" || path === ".npmrc") return "path";
  if (path.startsWith(".env.") && path !== ".env.example") return "path";
  return null;
}

function isSourceIncluded(path, policy) {
  return policy.included_files.includes(path) || policy.included_roots.some((root) => pathIsUnder(path, root));
}

function readCommittedBlob(root, record) {
  try { return gitBuffer(root, ["cat-file", "blob", record.objectId]); }
  catch { fail("SOURCE_BLOB_UNAVAILABLE"); }
}

function readCommittedPolicy(root, tree) {
  const record = tree.find((entry) => entry.path === POLICY_SOURCE_PATH);
  if (!record || record.type !== "blob" || record.mode !== "100644") fail("SOURCE_POLICY_MISSING");
  const bytes = readCommittedBlob(root, record);
  if (!isTextBlob(bytes)) fail("SOURCE_POLICY_INVALID");
  try { return readPolicy(bytes); }
  catch (error) {
    if (error instanceof PublicSnapshotExportError) throw error;
    fail("SOURCE_POLICY_INVALID");
  }
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isTextBlob(bytes) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch { return false; }
}

function readCommittedSource(root, tree, policy) {
  const included = [];
  const excludedPaths = new Set();
  const bootstrapCollisions = new Set(policy.bootstrap_paths);
  const manifestName = policy.manifest_filename;
  for (const record of tree) {
    const excluded = isSourceExcluded(record.path, policy);
    if (excluded) {
      if (excluded === "path") excludedPaths.add(record.path);
      continue;
    }
    if (bootstrapCollisions.has(record.path) || record.path === manifestName) {
      continue;
    }
    if (!isSourceIncluded(record.path, policy)) fail("SOURCE_PATH_UNCLASSIFIED");
    if (record.type !== "blob" || record.mode === "120000" || record.mode === "160000") {
      fail("SOURCE_SYMLINK_UNSUPPORTED");
    }
    if (record.mode !== "100644" && record.mode !== "100755") fail("SOURCE_TREE_INVALID");
    const contents = readCommittedBlob(root, record);
    if (!isTextBlob(contents)) fail("SOURCE_BINARY_UNSUPPORTED");
    included.push(Object.freeze({ path: record.path, bytes: contents, mode: record.mode }));
  }

  for (const path of policy.mandatory_excluded_paths) excludedPaths.add(path);
  included.sort((left, right) => comparePaths(left.path, right.path));
  return Object.freeze({ included, excludedPaths: [...excludedPaths].sort(comparePaths) });
}

function safeDestinationPath(input, cwd, sourceRoot, policy) {
  const resolved = resolve(cwd, input);
  let root;
  try {
    const stats = lstatSync(resolved);
    if (stats.isSymbolicLink()) fail("DESTINATION_SYMLINK");
    if (!stats.isDirectory()) fail("DESTINATION_INVALID");
    root = realpathSync(resolved);
  } catch (error) {
    if (error instanceof PublicSnapshotExportError) throw error;
    fail("DESTINATION_MISSING");
  }
  let home;
  try { home = realpathSync(homedir()); }
  catch { fail("DESTINATION_UNSAFE"); }
  if (root === sourceRoot || root === parse(root).root || root === home || root.startsWith(`${sourceRoot}${sep}.git${sep}`)) {
    fail("DESTINATION_UNSAFE");
  }
  const sourceRelative = relative(sourceRoot, root).split(sep).join("/");
  if (sourceRelative && sourceRelative !== ".." && !sourceRelative.startsWith("../")) {
    if (pathIsUnder(sourceRelative, ".git") || !pathIsUnder(sourceRelative, ".публикация")) fail("DESTINATION_UNSAFE");
    if (policy.included_roots.some((includeRoot) => pathIsUnder(sourceRelative, includeRoot)) ||
        policy.included_files.includes(sourceRelative) || policy.excluded_roots.some((excludeRoot) => pathIsUnder(sourceRelative, excludeRoot))) {
      fail("DESTINATION_UNSAFE");
    }
    const ignored = spawnGitCheckIgnore(sourceRoot, sourceRelative);
    if (!ignored) fail("DESTINATION_NOT_GIT_IGNORED");
  }
  return root;
}

function spawnGitCheckIgnore(root, path) {
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--", path], { cwd: root, stdio: "ignore", windowsHide: true });
    return true;
  } catch { return false; }
}

function readBootstrapBytes(destination, policy) {
  const results = [];
  for (const path of policy.bootstrap_paths) {
    const fullPath = join(destination, ...path.split("/"));
    let stats;
    try { stats = lstatSync(fullPath); }
    catch { fail("BOOTSTRAP_FILE_MISSING"); }
    if (stats.isSymbolicLink()) fail("DESTINATION_SYMLINK");
    if (!stats.isFile()) fail("BOOTSTRAP_FILE_INVALID");
    let bytes;
    try { bytes = readFileSync(fullPath); }
    catch { fail("BOOTSTRAP_FILE_INVALID"); }
    if (!isTextBlob(bytes)) fail("BOOTSTRAP_FILE_INVALID");
    results.push(Object.freeze({ path, bytes, mode: (stats.mode & 0o111) !== 0 ? "100755" : "100644", bootstrap: true }));
  }
  return results;
}

function createManifest(sourceCommit, included, excludedPaths, policy) {
  const paths = included.map((record) => record.path).sort(comparePaths);
  const byPath = new Map(included.map((record) => [record.path, record]));
  const fileHashes = {};
  for (const path of paths) {
    const record = byPath.get(path);
    if (!record) fail("MANIFEST_INVALID");
    fileHashes[path] = hashBytes(record.bytes);
  }
  if (Object.keys(fileHashes).length !== paths.length || Object.values(fileHashes).some((hash) => !HEX_64.test(hash))) {
    fail("MANIFEST_INVALID");
  }
  const manifest = Object.freeze({
    schema_version: "1.0.0",
    profile: "public-source",
    source_commit: sourceCommit,
    included_paths: Object.freeze(paths),
    excluded_paths: Object.freeze([...excludedPaths].sort(comparePaths)),
    excluded_roots: Object.freeze([...policy.excluded_roots]),
    file_sha256: Object.freeze(fileHashes)
  });
  if (!sameStringArray(Object.keys(manifest), BOOTSTRAP_MANIFEST_FIELD_ORDER)) fail("MANIFEST_INVALID");
  try { validatePublicSourceManifest(manifest); }
  catch { fail("MANIFEST_VALIDATION_FAILED"); }
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return Object.freeze({ manifest, bytes, sha256: hashBytes(bytes) });
}

function directoryPrefixes(path) {
  const segments = path.split("/");
  const result = [];
  for (let index = 1; index < segments.length; index += 1) result.push(segments.slice(0, index).join("/"));
  return result;
}

function auditDestinationTree(destination, expectedPaths) {
  const expectedDirs = new Set();
  for (const path of expectedPaths) for (const dir of directoryPrefixes(path)) expectedDirs.add(dir);
  function visit(relativePath = "") {
    let entries;
    try { entries = readdirSync(join(destination, ...relativePath.split("/").filter(Boolean)), { withFileTypes: true }); }
    catch { fail("DESTINATION_INVALID"); }
    for (const entry of entries) {
      const child = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const fullPath = join(destination, ...child.split("/"));
      let stats;
      try { stats = lstatSync(fullPath); }
      catch { fail("DESTINATION_INVALID"); }
      if (stats.isSymbolicLink()) fail("DESTINATION_SYMLINK");
      if (child === ".git") {
        if (!stats.isDirectory()) fail("DESTINATION_SYMLINK");
        continue;
      }
      if (relativePath === "" && OPAQUE_DESTINATION_DIRS.has(entry.name)) {
        if (!stats.isDirectory()) fail("DESTINATION_LOCAL_SERVICE_ROOT_INVALID");
        continue;
      }
      if (stats.isDirectory()) {
        if (!expectedDirs.has(child)) fail("DESTINATION_UNMANAGED_CONTENT");
        visit(child);
        continue;
      }
      if (!stats.isFile() || !expectedPaths.has(child)) fail("DESTINATION_UNMANAGED_CONTENT");
    }
  }
  visit();
}

function parseExistingManifest(path) {
  let bytes;
  try { bytes = readFileSync(path); }
  catch { return null; }
  let manifest;
  try { manifest = JSON.parse(bytes.toString("utf8")); }
  catch { fail("DESTINATION_MANIFEST_INVALID"); }
  if (!isPlainObject(manifest) || !sameStringArray(Object.keys(manifest), BOOTSTRAP_MANIFEST_FIELD_ORDER) ||
      manifest.schema_version !== "1.0.0" || manifest.profile !== "public-source" || !HEX_40.test(manifest.source_commit) ||
      !Array.isArray(manifest.included_paths) || !Array.isArray(manifest.excluded_paths) || !Array.isArray(manifest.excluded_roots) ||
      !isPlainObject(manifest.file_sha256)) fail("DESTINATION_MANIFEST_INVALID");
  return Object.freeze({ manifest, bytes });
}

function readPlannedFile(destination, path) {
  const fullPath = join(destination, ...path.split("/"));
  let stats;
  try { stats = lstatSync(fullPath); }
  catch { fail("DESTINATION_INCOMPLETE"); }
  if (stats.isSymbolicLink()) fail("DESTINATION_SYMLINK");
  if (!stats.isFile()) fail("DESTINATION_INCOMPLETE");
  try { return readFileSync(fullPath); }
  catch { fail("DESTINATION_INCOMPLETE"); }
}

function ensureExistingExportMatches(destination, plannedFiles, manifestRecord, sourceCommit) {
  const manifestPath = join(destination, manifestRecord.path);
  const existing = parseExistingManifest(manifestPath);
  if (!existing) return false;
  if (existing.manifest.source_commit !== sourceCommit) fail("SOURCE_COMMIT_UPDATE_UNSUPPORTED");
  if (!existing.bytes.equals(manifestRecord.bytes)) fail("DESTINATION_MANIFEST_MISMATCH");
  const expectedPaths = new Set(plannedFiles.map((record) => record.path));
  expectedPaths.add(manifestRecord.path);
  auditDestinationTree(destination, expectedPaths);
  for (const record of plannedFiles) {
    const bytes = readPlannedFile(destination, record.path);
    if (hashBytes(bytes) !== hashBytes(record.bytes)) fail("DESTINATION_CONTENT_MISMATCH");
  }
  if (!readPlannedFile(destination, manifestRecord.path).equals(manifestRecord.bytes)) fail("DESTINATION_MANIFEST_MISMATCH");
  return true;
}

function createDirectorySafe(destination, relativePath, createdDirectories) {
  const fullPath = join(destination, ...relativePath.split("/"));
  try {
    const stats = lstatSync(fullPath);
    if (stats.isSymbolicLink()) fail("DESTINATION_SYMLINK");
    if (!stats.isDirectory()) fail("DESTINATION_COLLISION");
    return;
  } catch (error) {
    if (error instanceof PublicSnapshotExportError) throw error;
    if (error?.code !== "ENOENT") fail("DESTINATION_INVALID");
  }
  createDirectorySafe(destination, dirname(relativePath).split(sep).join("/"), createdDirectories);
  try { mkdirSync(fullPath); }
  catch { fail("DESTINATION_COLLISION"); }
  createdDirectories.push(fullPath);
}

function writeNewFile(destination, record, createdFiles, createdDirectories) {
  for (const dir of directoryPrefixes(record.path)) createDirectorySafe(destination, dir, createdDirectories);
  const fullPath = join(destination, ...record.path.split("/"));
  let descriptor;
  try {
    descriptor = openSync(fullPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, record.mode === "100755" ? 0o755 : 0o644);
    createdFiles.push(fullPath);
    writeFileSync(descriptor, record.bytes);
    fsyncSync(descriptor);
  } catch (error) {
    if (error?.code === "EEXIST") fail("DESTINATION_COLLISION");
    fail("DESTINATION_WRITE_FAILED");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function rollbackCreatedFiles(createdFiles, createdDirectories) {
  for (const path of [...createdFiles].reverse()) {
    try { unlinkSync(path); } catch { /* Preserve the original export failure. */ }
  }
  for (const path of [...createdDirectories].reverse()) {
    try { rmdirSync(path); } catch { /* Preserve the original export failure. */ }
  }
}

export function exportPublicSnapshot(options = {}) {
  if (!isPlainObject(options) || typeof options.sourceCommit !== "string" || typeof options.destination !== "string" ||
      typeof options.cwd !== "string") fail("INVALID_ARGUMENT");
  if (!HEX_40.test(options.sourceCommit) || options.destination.split(/[\\/]/u).includes("..")) fail("INVALID_ARGUMENT");

  let cwd;
  try { cwd = realpathSync(options.cwd); }
  catch { fail("SOURCE_REPOSITORY_INVALID"); }
  const sourceRoot = sourceRootFrom(cwd);
  validateCommit(sourceRoot, options.sourceCommit);
  const sourceTree = parseTreeEntries(sourceRoot, options.sourceCommit);
  const policy = readCommittedPolicy(sourceRoot, sourceTree);
  const destination = safeDestinationPath(options.destination, cwd, sourceRoot, policy);
  const { included: sourceFiles, excludedPaths } = readCommittedSource(sourceRoot, sourceTree, policy);
  const bootstrapFiles = readBootstrapBytes(destination, policy);
  const plannedFiles = [...sourceFiles, ...bootstrapFiles].sort((left, right) => comparePaths(left.path, right.path));
  const pathSet = new Set(plannedFiles.map((record) => record.path));
  if (pathSet.size !== plannedFiles.length || pathSet.has(policy.manifest_filename)) fail("SOURCE_PATH_COLLISION");

  const manifestRecord = createManifest(options.sourceCommit, plannedFiles, excludedPaths, policy);
  const manifestFile = Object.freeze({ path: policy.manifest_filename, bytes: manifestRecord.bytes, mode: "100644" });
  const expectedPaths = new Set([...pathSet, manifestFile.path]);
  auditDestinationTree(destination, expectedPaths);
  const existingManifest = parseExistingManifest(join(destination, manifestFile.path));
  if (existingManifest) {
    if (existingManifest.manifest.source_commit !== options.sourceCommit) fail("SOURCE_COMMIT_UPDATE_UNSUPPORTED");
    if (!ensureExistingExportMatches(destination, plannedFiles, manifestFile, options.sourceCommit)) fail("DESTINATION_INCOMPLETE");
    return Object.freeze({ status: "unchanged", sourceCommit: options.sourceCommit, includedFiles: plannedFiles.length,
      manifestSha256: manifestRecord.sha256 });
  }

  for (const record of sourceFiles) {
    try { lstatSync(join(destination, ...record.path.split("/"))); fail("DESTINATION_COLLISION"); }
    catch (error) {
      if (error instanceof PublicSnapshotExportError) throw error;
      if (error?.code !== "ENOENT") fail("DESTINATION_INVALID");
    }
  }
  try { lstatSync(join(destination, manifestFile.path)); fail("DESTINATION_COLLISION"); }
  catch (error) {
    if (error instanceof PublicSnapshotExportError) throw error;
    if (error?.code !== "ENOENT") fail("DESTINATION_INVALID");
  }

  const createdFiles = [];
  const createdDirectories = [];
  try {
    for (const record of sourceFiles) writeNewFile(destination, record, createdFiles, createdDirectories);
    writeNewFile(destination, manifestFile, createdFiles, createdDirectories);
  } catch (error) {
    rollbackCreatedFiles(createdFiles, createdDirectories);
    if (error instanceof PublicSnapshotExportError) throw error;
    fail("DESTINATION_WRITE_FAILED");
  }
  return Object.freeze({ status: "exported", sourceCommit: options.sourceCommit, includedFiles: plannedFiles.length,
    manifestSha256: manifestRecord.sha256 });
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  try {
    const args = parseArguments(argv);
    const result = exportPublicSnapshot({ sourceCommit: args.sourceCommit, destination: args.destinationInput, cwd });
    process.stdout.write(`${JSON.stringify({ status: result.status, source_commit: result.sourceCommit,
      included_files: result.includedFiles, manifest_sha256: result.manifestSha256 })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof PublicSnapshotExportError ? error.code : "PUBLIC_SOURCE_EXPORT_FAILED";
    process.stderr.write(`PUBLIC_SOURCE_EXPORT_FAILED:${code}\n`);
    return 2;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined) {
  try {
    if (realpathSync(entryPath) === realpathSync(SCRIPT_PATH)) process.exitCode = main();
  } catch {
    process.exitCode = 2;
  }
}
