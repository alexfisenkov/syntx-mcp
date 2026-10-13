import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, openSync, closeSync, fstatSync, readSync, readdirSync } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import {
  generationContractRegistrySchema,
  serializeGenerationContractRegistry,
  type GenerationContractRegistry
} from "../domain/generation-contract.js";

const MAX_REGISTRY_BYTES = 16 * 1024 * 1024;
const VERSION_PATTERN = /^sha256-([a-f0-9]{64})\.json$/u;

/** Create-once archive. The optional root is trusted local configuration, never user/tool input. */
export async function archiveGenerationContractRegistry(
  registry: GenerationContractRegistry,
  catalogDirectory?: string
): Promise<{ version: string; path: string; status: "created" | "existing" }> {
  const bytes = Buffer.from(serializeGenerationContractRegistry(registry), "utf8");
  assertSize(bytes.length);
  const version = `sha256-${digest(bytes)}.json`;
  const root = resolveCatalogDirectory(catalogDirectory);
  const directory = join(root, "generation-contracts");
  try { await mkdir(directory, { mode: 0o755 }); } catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
  assertDirectory(directory);
  const target = join(directory, version);
  const temporaryPath = join(directory, `.pending-${randomUUID()}.tmp`);
  let created = false;
  try {
    const temporary = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try { await temporary.writeFile(bytes); await temporary.sync(); } finally { await temporary.close(); }
    let status: "created" | "existing";
    try { await link(temporaryPath, target); status = "created"; }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; status = "existing"; }
    if (!readBoundedRegularFile(target).equals(bytes)) throw new Error("GENERATION_CONTRACT_VERSION_COLLISION");
    await syncDirectory(directory);
    return { version, path: target, status };
  } finally {
    if (created) { await unlink(temporaryPath); await syncDirectory(directory); }
  }
}

export function loadGenerationContractRegistry(
  version: string,
  catalogDirectory?: string
): GenerationContractRegistry {
  const match = VERSION_PATTERN.exec(version);
  if (!match || match[0] !== version) throw new Error("GENERATION_CONTRACT_VERSION_INVALID");
  const directory = join(resolveCatalogDirectory(catalogDirectory), "generation-contracts");
  assertDirectory(directory);
  const bytes = readBoundedRegularFile(join(directory, version));
  if (digest(bytes) !== match[1]) throw new Error("GENERATION_CONTRACT_HASH_MISMATCH");
  const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return generationContractRegistrySchema.parse(raw);
}

export function listGenerationContractVersions(catalogDirectory?: string): string[] {
  const directory = join(resolveCatalogDirectory(catalogDirectory), "generation-contracts");
  assertDirectory(directory);
  // Read directory entries as names only; each candidate is validated by the loader.
  return readdirSync(directory).filter((name) => VERSION_PATTERN.test(name)).sort();
}

function resolveCatalogDirectory(directory?: string): string {
  if (directory !== undefined) {
    const resolved = resolve(directory);
    assertDirectory(resolved);
    return resolved;
  }
  const candidates = [
    fileURLToPath(new URL("../../catalog", import.meta.url)),
    fileURLToPath(new URL("../../../catalog", import.meta.url))
  ];
  for (const candidate of candidates) {
    try {
      assertDirectory(candidate);
      assertDirectory(join(candidate, "v1"));
      const publicCatalog = lstatSync(join(candidate, "v1", "official-public-api.json"));
      if (publicCatalog.isSymbolicLink() || !publicCatalog.isFile()) throw new Error("GENERATION_CONTRACT_DIRECTORY_UNSAFE");
      return candidate;
    }
    catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  }
  throw new Error("GENERATION_CONTRACT_DIRECTORY_NOT_FOUND");
}

function assertDirectory(path: string): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("GENERATION_CONTRACT_DIRECTORY_UNSAFE");
}

function readBoundedRegularFile(path: string): Buffer {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("GENERATION_CONTRACT_FILE_UNSAFE");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw new Error("GENERATION_CONTRACT_FILE_UNSAFE");
    assertSize(before.size);
    const bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(descriptor, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    const after = fstatSync(descriptor);
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("GENERATION_CONTRACT_FILE_CHANGED_DURING_READ");
    return bytes.subarray(0, size);
  } finally { closeSync(descriptor); }
}

function assertSize(size: number): void {
  if (size < 1 || size > MAX_REGISTRY_BYTES) throw new Error("GENERATION_CONTRACT_REGISTRY_SIZE_INVALID");
}

function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

async function syncDirectory(path: string): Promise<void> {
  assertDirectory(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { if (!(await handle.stat()).isDirectory()) throw new Error("GENERATION_CONTRACT_DIRECTORY_UNSAFE"); await handle.sync(); }
  finally { await handle.close(); }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
