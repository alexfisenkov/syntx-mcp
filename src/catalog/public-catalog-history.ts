import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync
} from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  serializeSyntxPublicCatalogSnapshot,
  syntxPublicCatalogSnapshotSchema,
  type SyntxPublicCatalogSnapshot
} from "./syntx-public-catalog.js";

const MAX_SNAPSHOT_BYTES = 15 * 1024 * 1024;
const VERSION_PATTERN = /^sha256-([a-f0-9]{64})\.json$/u;

/**
 * These paths belong to the trusted local operator, never an MCP argument.
 * Symlink checks and O_NOFOLLOW reject static substitutions; Node's path-based
 * APIs do not isolate a directory from a malicious concurrent parent rename.
 */
export function getPublicCatalogDirectory(): string {
  const candidates = [
    fileURLToPath(new URL("../../catalog", import.meta.url)),
    fileURLToPath(new URL("../../../catalog", import.meta.url))
  ];
  for (const candidate of candidates) {
    try {
      assertDirectory(candidate);
      assertDirectory(join(candidate, "v1"));
      assertRegularFile(join(candidate, "v1", "official-public-api.json"));
      return candidate;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  throw new Error("PUBLIC_CATALOG_DIRECTORY_NOT_FOUND");
}

export async function archivePublicCatalogSnapshot(
  snapshot: SyntxPublicCatalogSnapshot,
  catalogDirectory?: string
): Promise<{ version: string; path: string; status: "created" | "existing" }> {
  // Validate before creating any directory, temporary file or published target.
  const bytes = Buffer.from(serializeSyntxPublicCatalogSnapshot(snapshot), "utf8");
  assertByteLimit(bytes.length);
  const version = `sha256-${digest(bytes)}.json`;
  const directory = resolveCatalogDirectory(catalogDirectory);
  const historyDirectory = join(directory, "public");
  try {
    await mkdir(historyDirectory, { mode: 0o755 });
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  }
  assertDirectory(historyDirectory);
  await syncDirectory(directory);
  const path = join(historyDirectory, version);
  const temporaryPath = join(historyDirectory, `.pending-${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    const temporary = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    temporaryCreated = true;
    try {
      await temporary.writeFile(bytes);
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    assertDirectory(directory);
    assertDirectory(historyDirectory);
    let status: "created" | "existing";
    try {
      // Unlike rename(), link() cannot overwrite an existing version.
      await link(temporaryPath, path);
      status = "created";
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      status = "existing";
    }
    if (!readBoundedRegularFile(path).equals(bytes)) {
      throw new Error("PUBLIC_CATALOG_VERSION_COLLISION");
    }
    await syncDirectory(historyDirectory);
    return { version, path, status };
  } finally {
    if (temporaryCreated) {
      // If publication or fsync failed, do not retry publication. The caller
      // must reconcile the immutable target before a new operator invocation.
      await unlink(temporaryPath);
      await syncDirectory(historyDirectory);
    }
  }
}

export function loadPublicCatalogVersion(
  version: string,
  catalogDirectory?: string
): SyntxPublicCatalogSnapshot {
  const match = VERSION_PATTERN.exec(version);
  if (!match || match[0] !== version) throw new Error("PUBLIC_CATALOG_VERSION_INVALID");
  const directory = resolveCatalogDirectory(catalogDirectory);
  const historyDirectory = join(directory, "public");
  assertDirectory(historyDirectory);
  const bytes = readBoundedRegularFile(join(historyDirectory, version));
  if (digest(bytes) !== match[1]) {
    throw new Error("PUBLIC_CATALOG_VERSION_HASH_MISMATCH");
  }
  return decodeSnapshot(bytes);
}

export function loadSelectedPublicCatalog(options: {
  version?: string;
  catalogDirectory?: string;
} = {}): {
  snapshot: SyntxPublicCatalogSnapshot;
  archived: boolean;
  version: string | null;
} {
  if (options.version !== undefined) {
    return {
      snapshot: loadPublicCatalogVersion(options.version, options.catalogDirectory),
      archived: true,
      version: options.version
    };
  }
  const directory = resolveCatalogDirectory(options.catalogDirectory);
  assertDirectory(join(directory, "v1"));
  return {
    snapshot: decodeSnapshot(
      readBoundedRegularFile(join(directory, "v1", "official-public-api.json"))
    ),
    archived: false,
    version: null
  };
}

function resolveCatalogDirectory(directory?: string): string {
  const resolved = directory === undefined ? getPublicCatalogDirectory() : resolve(directory);
  assertDirectory(resolved);
  return resolved;
}

function assertDirectory(path: string): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("PUBLIC_CATALOG_DIRECTORY_UNSAFE");
  }
}

function assertRegularFile(path: string): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("PUBLIC_CATALOG_FILE_UNSAFE");
  }
}

function readBoundedRegularFile(path: string): Buffer {
  assertRegularFile(path);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw new Error("PUBLIC_CATALOG_FILE_UNSAFE");
    assertByteLimit(before.size);
    const bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(descriptor, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    const after = fstatSync(descriptor);
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error("PUBLIC_CATALOG_FILE_CHANGED_DURING_READ");
    }
    return bytes.subarray(0, size);
  } finally {
    closeSync(descriptor);
  }
}

function decodeSnapshot(bytes: Buffer): SyntxPublicCatalogSnapshot {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const raw: unknown = JSON.parse(text);
  // The existing schema verifies summary, source hashes and runtime_usable=false.
  return syntxPublicCatalogSnapshotSchema.parse(raw);
}

function assertByteLimit(size: number): void {
  if (size < 1 || size > MAX_SNAPSHOT_BYTES) {
    throw new Error("PUBLIC_CATALOG_SNAPSHOT_SIZE_INVALID");
  }
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function syncDirectory(path: string): Promise<void> {
  assertDirectory(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isDirectory()) throw new Error("PUBLIC_CATALOG_DIRECTORY_UNSAFE");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
