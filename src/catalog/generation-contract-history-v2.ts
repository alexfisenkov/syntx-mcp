import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, openSync, closeSync, fstatSync, readSync, readdirSync } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import type { GenerationContractRegistry as GenerationContractRegistryV1 } from "../domain/generation-contract.js";
import {
  parseGenerationContractRegistryV2,
  serializeGenerationContractRegistryV2,
  type GenerationContractRegistryV2
} from "../domain/generation-contract-v2.js";
import { loadGenerationContractRegistry as loadGenerationContractRegistryV1 } from "./generation-contract-history.js";

const MAX_REGISTRY_BYTES = 16 * 1024 * 1024;
const VERSION_PATTERN = /^sha256-([a-f0-9]{64})\.json$/u;
const V2_DIRECTORY = "generation-contracts-v2";

/** Create-once archive in a separate schema-generation namespace. */
export async function archiveGenerationContractRegistryV2(
  registry: GenerationContractRegistryV2,
  catalogDirectory?: string
): Promise<{ version: string; path: string; status: "created" | "existing" }> {
  let serialized: string;
  try { serialized = serializeGenerationContractRegistryV2(registry); }
  catch { throw v2Error("GENERATION_CONTRACT_V2_ARTIFACT_INVALID"); }
  const bytes = Buffer.from(serialized, "utf8");
  assertSize(bytes.length);
  const version = `sha256-${digest(bytes)}.json`;
  const root = resolveCatalogDirectory(catalogDirectory);
  const directory = join(root, V2_DIRECTORY);
  try { await mkdir(directory, { mode: 0o755 }); }
  catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
  assertDirectory(directory);

  const target = join(directory, version);
  const temporaryPath = join(directory, `.pending-${randomUUID()}.tmp`);
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

    let status: "created" | "existing";
    try {
      await link(temporaryPath, target);
      status = "created";
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      status = "existing";
    }
    if (!readBoundedRegularFile(target).equals(bytes)) throw v2Error("GENERATION_CONTRACT_V2_VERSION_COLLISION");
    await syncDirectory(directory);
    return { version, path: target, status };
  } finally {
    if (temporaryCreated) {
      await unlink(temporaryPath);
      await syncDirectory(directory);
    }
  }
}

/** Hash-check bounded bytes before UTF-8 decoding, JSON parsing, or schema validation. */
export function loadGenerationContractRegistryV2(
  version: string,
  catalogDirectory?: string
): GenerationContractRegistryV2 {
  const match = VERSION_PATTERN.exec(version);
  if (!match || match[0] !== version) throw v2Error("GENERATION_CONTRACT_V2_VERSION_INVALID");
  const directory = join(resolveCatalogDirectory(catalogDirectory), V2_DIRECTORY);
  assertDirectory(directory);
  const bytes = readBoundedRegularFile(join(directory, version));
  if (digest(bytes) !== match[1]) throw v2Error("GENERATION_CONTRACT_V2_HASH_MISMATCH");

  let serialized: string;
  try { serialized = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw v2Error("GENERATION_CONTRACT_V2_ARTIFACT_INVALID"); }
  try { return parseGenerationContractRegistryV2(serialized, `sha256:${match[1]}`); }
  catch { throw v2Error("GENERATION_CONTRACT_V2_ARTIFACT_INVALID"); }
}

/** Returns only content-addressed v2 filenames; v1 history has a separate listing API. */
export function listGenerationContractRegistryV2(catalogDirectory?: string): string[] {
  const directory = join(resolveCatalogDirectory(catalogDirectory), V2_DIRECTORY);
  assertDirectory(directory);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && VERSION_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** Trusted local schema-version selector; versions never scan or fall back across namespaces. */
export function loadGenerationContractRegistryBySchemaVersion(
  schemaVersion: string,
  version: string,
  catalogDirectory?: string
): GenerationContractRegistryV1 | GenerationContractRegistryV2 {
  if (schemaVersion === "1.0.0") return loadGenerationContractRegistryV1(version, catalogDirectory);
  if (schemaVersion === "2.0.0") return loadGenerationContractRegistryV2(version, catalogDirectory);
  throw v2Error("GENERATION_CONTRACT_SCHEMA_VERSION_UNSUPPORTED");
}

/** Trusted explicit selector used by future config wiring; it never scans for a newer archive. */
export function loadSelectedGenerationContractRegistry(
  version: string,
  schemaVersion: string,
  catalogDirectory?: string
): GenerationContractRegistryV1 | GenerationContractRegistryV2 {
  return loadGenerationContractRegistryBySchemaVersion(schemaVersion, version, catalogDirectory);
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
      if (publicCatalog.isSymbolicLink() || !publicCatalog.isFile()) throw v2Error("GENERATION_CONTRACT_V2_DIRECTORY_UNSAFE");
      return candidate;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  throw v2Error("GENERATION_CONTRACT_V2_DIRECTORY_NOT_FOUND");
}

function assertDirectory(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw v2Error("GENERATION_CONTRACT_V2_DIRECTORY_UNSAFE");
}

function readBoundedRegularFile(path: string): Buffer {
  const pathStat = lstatSync(path);
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) throw v2Error("GENERATION_CONTRACT_V2_FILE_UNSAFE");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw v2Error("GENERATION_CONTRACT_V2_FILE_UNSAFE");
    assertSize(before.size);
    const bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(descriptor, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    const after = fstatSync(descriptor);
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw v2Error("GENERATION_CONTRACT_V2_FILE_CHANGED_DURING_READ");
    }
    return bytes.subarray(0, size);
  } finally {
    closeSync(descriptor);
  }
}

function assertSize(size: number): void {
  if (size < 1 || size > MAX_REGISTRY_BYTES) throw v2Error("GENERATION_CONTRACT_V2_SIZE_INVALID");
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function syncDirectory(path: string): Promise<void> {
  assertDirectory(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isDirectory()) throw v2Error("GENERATION_CONTRACT_V2_DIRECTORY_UNSAFE");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function v2Error(code: string): Error {
  return new Error(code);
}
