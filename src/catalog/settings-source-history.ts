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
import { getPublicCatalogDirectory } from "./public-catalog-history.js";
import {
  assertSettingsSourceInventoryMatchesPublicCatalog,
  serializeSettingsSourceInventory,
  settingsSourceInventorySchema,
  type SettingsSourceInventory
} from "./settings-source-inventory.js";
import { type SyntxPublicCatalogSnapshot } from "./syntx-public-catalog.js";

const MAX_INVENTORY_BYTES = 15 * 1024 * 1024;
const VERSION_PATTERN = /^sha256-([a-f0-9]{64})\.json$/u;

/**
 * Evidence-only history in trusted operator-owned directories, never paths
 * supplied as MCP arguments. Static symlinks are rejected, but Node's path APIs
 * do not isolate the directory from a malicious concurrent parent rename.
 */
export async function archiveSettingsSourceInventory(
  inventory: SettingsSourceInventory,
  publicCatalog: SyntxPublicCatalogSnapshot,
  catalogDirectory?: string
): Promise<{ version: string; path: string; status: "created" | "existing" }> {
  // Bind a validated copy before any directory or file is created. A caller
  // cannot change the bytes through its original object after the first await.
  const validated = settingsSourceInventorySchema.parse(inventory);
  assertSettingsSourceInventoryMatchesPublicCatalog(validated, publicCatalog);
  const bytes = Buffer.from(serializeSettingsSourceInventory(validated), "utf8");
  assertByteLimit(bytes.length);
  const version = `sha256-${digest(bytes)}.json`;
  const directory = resolveCatalogDirectory(catalogDirectory);
  const historyDirectory = join(directory, "settings");
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
      // Hard-link publication cannot replace an existing immutable version.
      await link(temporaryPath, path);
      status = "created";
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      status = "existing";
    }
    if (!readBoundedRegularFile(path).equals(bytes)) {
      throw new Error("SETTINGS_SOURCE_VERSION_COLLISION");
    }
    await syncDirectory(historyDirectory);
    return { version, path, status };
  } finally {
    if (temporaryCreated) {
      // Never remove a published or foreign target. If publication/fsync failed,
      // reconcile that immutable target before another operator invocation.
      await unlink(temporaryPath);
      await syncDirectory(historyDirectory);
    }
  }
}

export function loadSettingsSourceInventoryVersion(
  version: string,
  publicCatalog: SyntxPublicCatalogSnapshot,
  catalogDirectory?: string
): SettingsSourceInventory {
  const match = VERSION_PATTERN.exec(version);
  if (!match || match[0] !== version) throw new Error("SETTINGS_SOURCE_VERSION_INVALID");
  const directory = resolveCatalogDirectory(catalogDirectory);
  const historyDirectory = join(directory, "settings");
  assertDirectory(historyDirectory);
  const bytes = readBoundedRegularFile(join(historyDirectory, version));
  if (digest(bytes) !== match[1]) {
    throw new Error("SETTINGS_SOURCE_VERSION_HASH_MISMATCH");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const raw: unknown = JSON.parse(text);
  const inventory = settingsSourceInventorySchema.parse(raw);
  assertSettingsSourceInventoryMatchesPublicCatalog(inventory, publicCatalog);
  return inventory;
}

function resolveCatalogDirectory(directory?: string): string {
  const resolved = directory === undefined ? getPublicCatalogDirectory() : resolve(directory);
  assertDirectory(resolved);
  return resolved;
}

function assertDirectory(path: string): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("SETTINGS_SOURCE_DIRECTORY_UNSAFE");
  }
}

function assertRegularFile(path: string): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("SETTINGS_SOURCE_FILE_UNSAFE");
  }
}

function readBoundedRegularFile(path: string): Buffer {
  assertRegularFile(path);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw new Error("SETTINGS_SOURCE_FILE_UNSAFE");
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
      throw new Error("SETTINGS_SOURCE_FILE_CHANGED_DURING_READ");
    }
    return bytes.subarray(0, size);
  } finally {
    closeSync(descriptor);
  }
}

function assertByteLimit(size: number): void {
  if (size < 1 || size > MAX_INVENTORY_BYTES) {
    throw new Error("SETTINGS_SOURCE_INVENTORY_SIZE_INVALID");
  }
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function syncDirectory(path: string): Promise<void> {
  assertDirectory(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isDirectory()) throw new Error("SETTINGS_SOURCE_DIRECTORY_UNSAFE");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
