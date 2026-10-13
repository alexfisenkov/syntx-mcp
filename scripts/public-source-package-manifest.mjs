import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

export const PUBLIC_SOURCE_MANIFEST_NAME = "publication-manifest.json";
export const PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS = Object.freeze([
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
].sort());

export const PUBLIC_SOURCE_EXCLUDED_ROOTS = Object.freeze([
  ".autopilot",
  ".журналы",
  "docs/контроль",
  "docs/проект"
]);

const MANIFEST_KEYS = Object.freeze([
  "schema_version", "profile", "source_commit", "included_paths", "excluded_paths", "excluded_roots", "file_sha256"
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_PATHS = 10_000;
const MAX_PATH_LENGTH = 1_024;
const PROTECTED_BINARY_EXTENSIONS = new Set([
  ".aac", ".aiff", ".avif", ".bmp", ".crt", ".der", ".doc", ".docx", ".flac", ".gif", ".heic", ".heif",
  ".ico", ".icns", ".jpeg", ".jpg", ".key", ".log", ".m4a", ".m4v", ".mkv", ".mov", ".mp3", ".mp4",
  ".mpeg", ".mpg", ".ogg", ".ogv", ".pdf", ".pem", ".p12", ".pfx", ".png", ".raw", ".sqlite", ".sqlite3",
  ".db", ".shm", ".wal", ".wav", ".webm", ".webp", ".svg", ".xls", ".xlsx", ".zip", ".gz", ".tgz",
  ".7z", ".tar", ".tmp", ".bak", ".dump"
]);

function invalid() {
  throw new Error("PUBLIC_MANIFEST_INVALID");
}

function canonicalPath(path) {
  return typeof path === "string" && path.length > 0 && path.length <= MAX_PATH_LENGTH && !/\p{Cc}/u.test(path) && !path.startsWith("/") &&
    !path.includes("\\") && !path.includes("\0") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[<>:"|?*]/u.test(part) &&
      !/[. ]$/u.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)) &&
    !/^[A-Za-z]:/u.test(path);
}

function sortedUniquePaths(value) {
  if (!Array.isArray(value) || value.length > MAX_MANIFEST_PATHS || !value.every(canonicalPath) ||
      JSON.stringify(value) !== JSON.stringify([...new Set(value)].sort())) return false;
  return new Set(value.map((path) => path.toLowerCase())).size === value.length;
}

function isPrivatePath(path) {
  const normalized = path.toLowerCase();
  return PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS.some((receipt) => receipt.toLowerCase() === normalized) ||
    PUBLIC_SOURCE_EXCLUDED_ROOTS.some((root) => normalized === root.toLowerCase() || normalized.startsWith(`${root.toLowerCase()}/`)) ||
    normalized === "docs/private-account.json" ||
    /^skills\/scripts\/[^/]*(?:private|secret|credential|account)[^/]*\.json$/u.test(normalized);
}

function isProtectedPath(path) {
  const normalized = path.toLowerCase();
  if (normalized === ".env.example") return false;
  if (normalized === ".env" || normalized.startsWith(".env.") || normalized === ".git" || normalized.startsWith(".git/")) return true;
  const filename = normalized.split("/").at(-1) ?? "";
  const extension = filename.includes(".") ? `.${filename.split(".").at(-1)}` : "";
  return PROTECTED_BINARY_EXTENSIONS.has(extension) || /\.(?:sqlite|db)-(?:wal|shm)$/u.test(filename) ||
    ["id_rsa", "id_ed25519", "credentials", "credentials.json", "secrets.json", "auth.json", "token.json"].includes(filename);
}

function compiledSourcePath(path) {
  if (!path.startsWith("dist/src/")) return undefined;
  const suffixes = [".d.ts.map", ".js.map", ".d.ts", ".js"];
  const suffix = suffixes.find((candidate) => path.endsWith(candidate));
  if (suffix === undefined) return undefined;
  return `src/${path.slice("dist/src/".length, -suffix.length)}.ts`;
}

async function readBoundedRegularFile(path, maxBytes, expectedPath, missingCode = "PUBLIC_MANIFEST_PATH_INVALID") {
  let before;
  let actual;
  try {
    before = await lstat(path);
    actual = await realpath(path);
  } catch (error) {
    if (error?.code === "ENOENT" && missingCode !== undefined) throw new Error(missingCode);
    throw new Error("PUBLIC_MANIFEST_PATH_INVALID");
  }
  if (!before.isFile() || before.isSymbolicLink() || actual !== expectedPath || before.size > maxBytes) {
    throw new Error(before.size > maxBytes ? "PUBLIC_MANIFEST_TOO_LARGE" : "PUBLIC_MANIFEST_PATH_INVALID");
  }
  let handle;
  try {
    handle = await open(path, "r");
    const after = await handle.stat();
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.size > maxBytes) {
      throw new Error("PUBLIC_MANIFEST_PATH_INVALID");
    }
    return await handle.readFile();
  } catch (error) {
    if (error?.message === "PUBLIC_MANIFEST_PATH_INVALID") throw error;
    throw new Error("PUBLIC_MANIFEST_PATH_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function validatePublicSourceManifest(manifest) {
  if (manifest === undefined || manifest === null) throw new Error("PUBLIC_MANIFEST_REQUIRED");
  if (typeof manifest !== "object" || Array.isArray(manifest) ||
      JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify([...MANIFEST_KEYS].sort()) ||
      manifest.schema_version !== "1.0.0" || manifest.profile !== "public-source" ||
      typeof manifest.source_commit !== "string" || !COMMIT.test(manifest.source_commit) ||
      !sortedUniquePaths(manifest.included_paths) || !sortedUniquePaths(manifest.excluded_paths) ||
      !Array.isArray(manifest.excluded_roots) ||
      JSON.stringify(manifest.excluded_roots) !== JSON.stringify([...PUBLIC_SOURCE_EXCLUDED_ROOTS].sort()) ||
      manifest.included_paths.includes(PUBLIC_SOURCE_MANIFEST_NAME) ||
      !PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS.every((path) => manifest.excluded_paths.includes(path)) ||
      typeof manifest.file_sha256 !== "object" || manifest.file_sha256 === null || Array.isArray(manifest.file_sha256)) {
    invalid();
  }
  if (manifest.included_paths.some(isPrivatePath)) throw new Error("PUBLIC_MANIFEST_PRIVATE_PATH");
  if (manifest.included_paths.some(isProtectedPath)) throw new Error("PUBLIC_MANIFEST_PROTECTED_PATH");
  if (!manifest.excluded_paths.every((path) => !manifest.included_paths.includes(path))) invalid();
  const hashKeys = Object.keys(manifest.file_sha256).sort();
  if (JSON.stringify(hashKeys) !== JSON.stringify(manifest.included_paths) ||
      hashKeys.some((path) => !SHA256.test(manifest.file_sha256[path]))) {
    invalid();
  }
  return Object.freeze({
    profile: "public-source",
    source_commit: manifest.source_commit,
    included_paths: Object.freeze([...manifest.included_paths]),
    excluded_paths: Object.freeze([...manifest.excluded_paths]),
    private_receipt_paths: PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS,
    historical_owner_proofs: "NOT_DISTRIBUTED"
  });
}

export async function loadAndVerifyPublicSourceManifest(sourceRoot) {
  let manifest;
  const manifestPath = join(sourceRoot, PUBLIC_SOURCE_MANIFEST_NAME);
  const realRoot = await realpath(sourceRoot);
  const expectedManifestPath = resolve(realRoot, PUBLIC_SOURCE_MANIFEST_NAME);
  let manifestBytes;
  try {
    manifestBytes = await readBoundedRegularFile(manifestPath, MAX_MANIFEST_BYTES, expectedManifestPath, "PUBLIC_MANIFEST_REQUIRED");
    if (manifestBytes.length >= 3 && manifestBytes[0] === 0xef && manifestBytes[1] === 0xbb && manifestBytes[2] === 0xbf) {
      throw new Error("PUBLIC_MANIFEST_INVALID");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes);
    manifest = JSON.parse(text);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("PUBLIC_MANIFEST_REQUIRED");
    if (error?.message?.startsWith("PUBLIC_MANIFEST_")) throw error;
    throw new Error("PUBLIC_MANIFEST_INVALID");
  }
  const result = validatePublicSourceManifest(manifest);
  for (const path of result.included_paths) {
    const bytes = await readBoundedRegularFile(join(sourceRoot, path), Number.MAX_SAFE_INTEGER,
      resolve(realRoot, ...path.split("/")));
    if (path === ".env.example" && bytes.length !== 0) throw new Error("PUBLIC_MANIFEST_PROTECTED_PATH");
    if (createHash("sha256").update(bytes).digest("hex") !== manifest.file_sha256[path]) {
      throw new Error("PUBLIC_MANIFEST_FILE_HASH_MISMATCH");
    }
  }
  return Object.freeze({ ...result, file_sha256: Object.freeze({ ...manifest.file_sha256 }), bytes: manifestBytes });
}

export function assertPublicSourcePackagePaths(manifest, packagedPaths) {
  const paths = packagedPaths instanceof Set ? packagedPaths : new Set(packagedPaths);
  const packagedCatalogPaths = [...paths].filter((path) => path.startsWith("catalog/"));
  const sourceHashes = new Set(manifest.included_paths);
  const uncoveredPackagedPaths = [...paths].filter((path) => {
    if (path === PUBLIC_SOURCE_MANIFEST_NAME) return false;
    const sourcePath = compiledSourcePath(path);
    if (sourcePath !== undefined) return !sourceHashes.has(sourcePath);
    if (path.startsWith("dist/src/")) return true;
    return !sourceHashes.has(path);
  });
  if ([...paths].some((path) => !canonicalPath(path) || isProtectedPath(path) || (path.toLowerCase() === ".env.example" && !sourceHashes.has(path))) || !paths.has(PUBLIC_SOURCE_MANIFEST_NAME) ||
      uncoveredPackagedPaths.length > 0 ||
      packagedCatalogPaths.some((path) => !sourceHashes.has(path)) ||
      manifest.excluded_paths.some((path) => paths.has(path)) ||
      [...paths].some(isPrivatePath)) {
    throw new Error("PUBLIC_PACKAGE_CONTENT_MISMATCH");
  }
  return Object.freeze({ historical_owner_proofs: "NOT_DISTRIBUTED" });
}

function hasExactKeys(value, expectedKeys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort());
}

export function isInertPublicStaticRuntimeArtifact(path, artifact) {
  if (typeof path !== "string" || artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) {
    return false;
  }
  if (path === "catalog/runtime/v11/rejected-intermediate-status.json") {
    return hasExactKeys(artifact, ["production_consumable", "record_kind", "recorded_at_utc", "records", "schema_version"]) &&
      artifact.schema_version === "1.0.0" && artifact.record_kind === "REJECTED_INTERMEDIATE_EVIDENCE_ARTIFACTS" &&
      artifact.production_consumable === false && typeof artifact.recorded_at_utc === "string" &&
      Number.isFinite(Date.parse(artifact.recorded_at_utc)) && Array.isArray(artifact.records);
  }
  if (path.startsWith("catalog/runtime/v11/")) {
    if (artifact.catalog_kind === "STATIC_FORM_CONTROL_AST_EVIDENCE") {
      return hasExactKeys(artifact, ["build_id", "catalog_kind", "evidence_level", "forms", "limitations",
        "public_catalog_version", "runtime_usable", "schema_version", "settings_inventory_version", "unbound_model_ids"]) &&
        ["1.0.0", "1.3.0", "1.4.0", "1.6.0"].includes(artifact.schema_version) &&
        artifact.evidence_level === "HASH_PINNED_COMPILED_JS_AST" && artifact.runtime_usable === false &&
        typeof artifact.build_id === "string" && /^\d{6,20}$/u.test(artifact.build_id) &&
        typeof artifact.public_catalog_version === "string" && typeof artifact.settings_inventory_version === "string" &&
        Array.isArray(artifact.forms) && artifact.forms.length > 0 && Array.isArray(artifact.unbound_model_ids) &&
        Array.isArray(artifact.limitations) && artifact.limitations.length > 0;
    }
    if (artifact.catalog_kind === "STATIC_GENERATION_PARAMETER_SCHEMA_PROJECTION") {
      return hasExactKeys(artifact, ["catalog_kind", "models", "public_catalog", "runtime_usable", "schema_version",
        "settings_inventory", "status", "summary"]) && ["1.1.0", "1.2.0"].includes(artifact.schema_version) &&
        ["STATIC_PARTIAL", "STATIC_COMPLETE"].includes(artifact.status) && artifact.runtime_usable === false &&
        Array.isArray(artifact.models) && artifact.public_catalog !== null && typeof artifact.public_catalog === "object" &&
        artifact.settings_inventory !== null && typeof artifact.settings_inventory === "object" &&
        artifact.summary !== null && typeof artifact.summary === "object";
    }
    return false;
  }
  return typeof artifact.artifact_kind === "string" &&
    (artifact.runtime_usable === undefined || artifact.runtime_usable === false);
}

export function mayTreatPublicStaticRuntimeDirectoryAsEmpty(directory, publicSource, manifest) {
  if (publicSource !== true || manifest?.profile !== "public-source" ||
      !Array.isArray(manifest.included_paths) || !Array.isArray(manifest.excluded_paths) ||
      typeof directory !== "string" || !directory.startsWith("catalog/runtime/")) {
    return false;
  }
  const prefix = `${directory}/`;
  const expectedPrivateReceipts = PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS.filter((path) => path.startsWith(prefix));
  if (expectedPrivateReceipts.length === 0 || manifest.included_paths.some((path) => path.startsWith(prefix))) {
    return false;
  }
  const excluded = manifest.excluded_paths.filter((path) => path.startsWith(prefix)).sort();
  return JSON.stringify(excluded) === JSON.stringify(expectedPrivateReceipts);
}

export async function assertInstalledPublicSourceFileHashes(installedPackageRoot, manifest, packagedPaths) {
  const realRoot = await realpath(installedPackageRoot);
  for (const path of packagedPaths) {
    if (!Object.hasOwn(manifest.file_sha256, path)) continue;
    const bytes = await readBoundedRegularFile(join(installedPackageRoot, path), Number.MAX_SAFE_INTEGER,
      resolve(realRoot, ...path.split("/")));
    if (createHash("sha256").update(bytes).digest("hex") !== manifest.file_sha256[path]) {
      throw new Error("PUBLIC_PACKAGE_SOURCE_HASH_MISMATCH");
    }
  }
  return "PASS";
}

export async function evaluateHistoricalOwnerProofGate(publicSource, verifier) {
  if (publicSource === true) return "NOT_DISTRIBUTED";
  await verifier();
  return "PASS";
}

