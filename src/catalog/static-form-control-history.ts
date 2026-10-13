import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync
} from "node:fs";
import { join, resolve } from "node:path";
import { getPublicCatalogDirectory } from "./public-catalog-history.js";
import {
  parseStaticGenerationParameterSchemaArtifact,
  type StaticGenerationParameterSchemaCatalog
} from "./static-generation-parameter-schema.js";

export const DEFAULT_STATIC_PARAMETER_PROJECTION_VERSION =
  "static-generation-parameter-schema-v1.2-e5517ee5-87e96b78-7cfe38ace55eadde.json";
export const DEFAULT_STATIC_PARAMETER_PROJECTION_SHA256 =
  "sha256:7cfe38ace55eadde73f5e14716b5263b8da41d122eaba3d914c15c7d7ca13d26";

const MAX_PROJECTION_BYTES = 16 * 1024 * 1024;

export interface LoadedStaticParameterProjection {
  readonly version: string;
  readonly sha256: string;
  readonly source_schema_version: "1.1.0" | "1.2.0" | null;
  readonly migration_status: "CURRENT" | "LEGACY_V1_1_DEFAULTED_UNKNOWN" | "SCHEMA_MIGRATION_REQUIRED";
  readonly projection: StaticGenerationParameterSchemaCatalog | null;
}

/** Load only the reviewed, immutable runtime-safe projection; never scans or imports parser tooling. */
export function loadPinnedStaticParameterProjection(catalogDirectory?: string): LoadedStaticParameterProjection {
  const root = catalogDirectory === undefined ? getPublicCatalogDirectory() : resolve(catalogDirectory);
  assertDirectory(root, "STATIC_PARAMETER_CATALOG_DIRECTORY_UNSAFE");
  const runtimeDirectory = join(root, "runtime");
  assertDirectory(runtimeDirectory, "STATIC_PARAMETER_RUNTIME_DIRECTORY_UNSAFE");
  const versionDirectory = join(runtimeDirectory, "v11");
  assertDirectory(versionDirectory, "STATIC_PARAMETER_VERSION_DIRECTORY_UNSAFE");
  const bytes = readBoundedRegularFile(join(versionDirectory, DEFAULT_STATIC_PARAMETER_PROJECTION_VERSION));
  const actualSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actualSha256 !== DEFAULT_STATIC_PARAMETER_PROJECTION_SHA256) throw new Error("STATIC_PARAMETER_PROJECTION_HASH_MISMATCH");
  const serializedArtifact = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const sourceSchemaVersion = readSourceSchemaVersion(serializedArtifact);
  try {
    const parsed = parseStaticGenerationParameterSchemaArtifact(serializedArtifact, DEFAULT_STATIC_PARAMETER_PROJECTION_SHA256);
    const projection = deepFreeze(parsed.catalog);
    if (projection.runtime_usable !== false || projection.status !== "STATIC_PARTIAL") {
      throw new Error("STATIC_PARAMETER_PROJECTION_STATUS_INVALID");
    }
    return Object.freeze({
      version: DEFAULT_STATIC_PARAMETER_PROJECTION_VERSION,
      sha256: parsed.sha256,
      source_schema_version: parsed.source_schema_version,
      migration_status: parsed.migration_status,
      projection
    });
  } catch (error) {
    if (!hasCode(error, "STATIC_SCHEMA_ARTIFACT_INVALID")) throw error;
    return Object.freeze({
      version: DEFAULT_STATIC_PARAMETER_PROJECTION_VERSION,
      sha256: actualSha256,
      source_schema_version: sourceSchemaVersion,
      migration_status: "SCHEMA_MIGRATION_REQUIRED" as const,
      projection: null
    });
  }
}

function readSourceSchemaVersion(serialized: string): "1.1.0" | "1.2.0" | null {
  try {
    const raw: unknown = JSON.parse(serialized);
    if (raw && typeof raw === "object" && !Array.isArray(raw) &&
        ((raw as Record<string, unknown>).schema_version === "1.1.0" || (raw as Record<string, unknown>).schema_version === "1.2.0")) {
      return (raw as Record<string, unknown>).schema_version as "1.1.0" | "1.2.0";
    }
  } catch { /* A hash-pinned but unparseable optional artifact degrades to unavailable UI evidence. */ }
  return null;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function assertDirectory(path: string, code: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(code);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function readBoundedRegularFile(path: string): Buffer {
  const pathStat = lstatSync(path);
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) throw new Error("STATIC_PARAMETER_PROJECTION_FILE_UNSAFE");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > MAX_PROJECTION_BYTES) {
      throw new Error("STATIC_PARAMETER_PROJECTION_SIZE_INVALID");
    }
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error("STATIC_PARAMETER_PROJECTION_FILE_CHANGED_DURING_READ");
    }
    return bytes.subarray(0, offset);
  } finally {
    closeSync(descriptor);
  }
}
