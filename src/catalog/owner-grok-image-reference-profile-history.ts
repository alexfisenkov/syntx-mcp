import { constants, lstatSync, mkdirSync, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import type { DiscoveryCatalogRepository } from "./discovery-catalog.js";
import {
  hydrateOwnerGrokImageReferenceProfileArtifact,
  serializeOwnerGrokImageReferenceProfileSet,
  type OwnerGrokImageReferenceProfileSet
} from "./owner-grok-image-reference-profiles.js";

const PROFILE_DIRECTORY = "owner-image-reference-profiles";
const SCHEMA_DIRECTORY = "v1";
const VERSION_PATTERN = /^sha256-([a-f0-9]{64})\.json$/u;
const MAX_PROFILE_BYTES = 64 * 1024;

export interface OwnerGrokImageReferenceProfileArchiveResult {
  readonly version: string;
  readonly path: string;
  readonly status: "created" | "existing";
}

/** Append-only create-once archive. Tests may pass an isolated temporary catalog directory. */
export async function archiveOwnerGrokImageReferenceProfileSetV1(
  set: OwnerGrokImageReferenceProfileSet,
  catalogDirectory?: string
): Promise<OwnerGrokImageReferenceProfileArchiveResult> {
  let bytes: Buffer;
  try { bytes = Buffer.from(serializeOwnerGrokImageReferenceProfileSet(set)); }
  catch { throw historyError("OWNER_GROK_REFERENCE_PROFILE_ARTIFACT_INVALID"); }
  assertSize(bytes.length);
  const version = "sha256-" + digest(bytes) + ".json";
  const root = resolveCatalogDirectory(catalogDirectory);
  const namespace = join(root, PROFILE_DIRECTORY);
  ensureDirectory(namespace);
  const directory = join(namespace, SCHEMA_DIRECTORY);
  ensureDirectory(directory);
  const target = join(directory, version);
  const temporaryPath = join(directory, ".pending-" + randomUUID() + ".tmp");
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
    if (!readBoundedRegularFile(target).equals(bytes)) {
      throw historyError("OWNER_GROK_REFERENCE_PROFILE_VERSION_COLLISION");
    }
    await syncDirectory(directory);
    return Object.freeze({ version, path: target, status });
  } finally {
    if (temporaryCreated) {
      await unlink(temporaryPath);
      await syncDirectory(directory);
    }
  }
}

/** Load one explicitly named content-addressed profile set; never scans/falls back. */
export function loadOwnerGrokImageReferenceProfileSetV1(
  version: string,
  publicCatalog: DiscoveryCatalogRepository,
  catalogDirectory?: string
): OwnerGrokImageReferenceProfileSet {
  const match = VERSION_PATTERN.exec(version);
  if (!match || match[0] !== version) throw historyError("OWNER_GROK_REFERENCE_PROFILE_VERSION_INVALID");
  const namespace = join(resolveCatalogDirectory(catalogDirectory), PROFILE_DIRECTORY);
  assertDirectory(namespace, "OWNER_GROK_REFERENCE_PROFILE_DIRECTORY_UNSAFE");
  const directory = join(namespace, SCHEMA_DIRECTORY);
  assertDirectory(directory, "OWNER_GROK_REFERENCE_PROFILE_DIRECTORY_UNSAFE");
  const bytes = readBoundedRegularFile(join(directory, version));
  if (digest(bytes) !== match[1]) throw historyError("OWNER_GROK_REFERENCE_PROFILE_HASH_MISMATCH");
  let artifact: unknown;
  try {
    artifact = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw historyError("OWNER_GROK_REFERENCE_PROFILE_ARTIFACT_INVALID");
  }
  try { return hydrateOwnerGrokImageReferenceProfileArtifact(artifact, publicCatalog); }
  catch { throw historyError("OWNER_GROK_REFERENCE_PROFILE_ARTIFACT_INVALID"); }
}

function resolveCatalogDirectory(directory?: string): string {
  if (directory !== undefined) {
    const selected = resolve(directory);
    assertDirectory(selected, "OWNER_GROK_REFERENCE_PROFILE_DIRECTORY_UNSAFE");
    return selected;
  }
  const candidates = [
    fileURLToPath(new URL("../../catalog", import.meta.url)),
    fileURLToPath(new URL("../../../catalog", import.meta.url))
  ];
  for (const candidate of candidates) {
    try {
      assertDirectory(candidate, "OWNER_GROK_REFERENCE_PROFILE_DIRECTORY_UNSAFE");
      assertDirectory(join(candidate, "public"), "OWNER_GROK_REFERENCE_PROFILE_DIRECTORY_UNSAFE");
      return candidate;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  throw historyError("OWNER_GROK_REFERENCE_PROFILE_DIRECTORY_NOT_FOUND");
}

function ensureDirectory(path: string): void {
  try { lstatSync(path); }
  catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
    try { mkdirSyncSafe(path); }
    catch (createError) { if (!hasCode(createError, "EEXIST")) throw createError; }
  }
  assertDirectory(path, "OWNER_GROK_REFERENCE_PROFILE_DIRECTORY_UNSAFE");
}

function mkdirSyncSafe(path: string): void {
  const parent = resolve(path, "..");
  assertDirectory(parent, "OWNER_GROK_REFERENCE_PROFILE_DIRECTORY_UNSAFE");
  mkdirSync(path, { mode: 0o755 });
}

function assertDirectory(path: string, code: string): void {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { throw error; }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw historyError(code);
}

function readBoundedRegularFile(path: string): Buffer {
  let pathStat;
  try { pathStat = lstatSync(path); }
  catch (error) { throw error; }
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
    throw historyError("OWNER_GROK_REFERENCE_PROFILE_FILE_UNSAFE");
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw historyError("OWNER_GROK_REFERENCE_PROFILE_FILE_UNSAFE");
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
      throw historyError("OWNER_GROK_REFERENCE_PROFILE_FILE_CHANGED_DURING_READ");
    }
    return bytes.subarray(0, size);
  } finally {
    closeSync(descriptor);
  }
}

function assertSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PROFILE_BYTES) {
    throw historyError("OWNER_GROK_REFERENCE_PROFILE_SIZE_INVALID");
  }
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function syncDirectory(path: string): Promise<void> {
  assertDirectory(path, "OWNER_GROK_REFERENCE_PROFILE_DIRECTORY_UNSAFE");
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isDirectory()) throw historyError("OWNER_GROK_REFERENCE_PROFILE_DIRECTORY_UNSAFE");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function historyError(code: string): Error {
  return new Error(code);
}
