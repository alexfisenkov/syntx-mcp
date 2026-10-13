import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync
} from "node:fs";
import type { Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthBinding } from "./types.js";
import { SqliteAuthLinkStore } from "./sqlite-auth-link-store.js";
import { NodeAeadAuthLinkSecretVault } from "./auth-link-secret-vault.js";
import type { AuthLinkSecretKeyResolver } from "./auth-link-secret-vault.js";
import { acquireLocalOwnerProfileLease } from "../runtime/durable-owner-generation-runtime.js";
import { createBorrowedOwnerProfileLease, type BorrowedOwnerProfileLease } from "../runtime/private-owner-generation-profile.js";

export const OWNER_AUTH_PROFILE_DIRECTORY_ENV = "SYNTX_OWNER_AUTH_PROFILE_DIRECTORY";
export const OWNER_AUTH_KEY_FILE_ENV = "SYNTX_OWNER_AUTH_KEY_FILE";

export interface PrivateOwnerAuthProfileConfig {
  /** Keep this exact canonical path: the profile principal is path-bound. */
  readonly profileDirectory: string;
  readonly keyFilePath: string;
}

export interface PrivateOwnerAuthProfile {
  readonly profileDirectory: string;
  readonly store: SqliteAuthLinkStore;
  readonly binding: AuthBinding;
  borrowGenerationLease(): BorrowedOwnerProfileLease;
  close(): void;
}

const DATABASE_FILENAME = "auth-links.sqlite";
const DATABASE_SIDECAR_SUFFIXES = ["-wal", "-shm"] as const;
const PROFILE_LOCK_FILENAME = ".syntx-owner-generation.lock";
const DATABASE_PATH_ENV = OWNER_AUTH_PROFILE_DIRECTORY_ENV;
const KEY_PATH_ENV = OWNER_AUTH_KEY_FILE_ENV;
const REPOSITORY = findVerifiedRepositoryRoot(fileURLToPath(import.meta.url));

/** Both paths absent keeps the existing memory-only owner profile. */
export function resolvePrivateOwnerAuthProfileConfig(
  environment: NodeJS.ProcessEnv = process.env
): PrivateOwnerAuthProfileConfig | null {
  const profileDirectory = environment[DATABASE_PATH_ENV];
  const keyFilePath = environment[KEY_PATH_ENV];
  if (profileDirectory === undefined && keyFilePath === undefined) return null;
  if (profileDirectory === undefined || keyFilePath === undefined) {
    throw new Error("OWNER_AUTH_PROFILE_CONFIGURATION_INCOMPLETE");
  }
  const canonicalProfile = validateCanonicalAbsolutePath(profileDirectory);
  const canonicalKey = validateCanonicalAbsolutePath(keyFilePath);
  assertOutsideRepository(canonicalProfile);
  assertOutsideRepository(canonicalKey);
  assertProfileDirectory(canonicalProfile);
  assertSecureAncestors(dirname(canonicalKey));
  assertKeyFileMetadata(canonicalKey);
  return Object.freeze({ profileDirectory: canonicalProfile, keyFilePath: canonicalKey });
}

export function openPrivateOwnerAuthProfile(
  config: PrivateOwnerAuthProfileConfig
): PrivateOwnerAuthProfile {
  const profileDirectory = validateCanonicalAbsolutePath(config.profileDirectory);
  const keyFilePath = validateCanonicalAbsolutePath(config.keyFilePath);
  assertOutsideRepository(profileDirectory);
  assertOutsideRepository(keyFilePath);
  assertProfileDirectory(profileDirectory);
  assertSecureAncestors(dirname(keyFilePath));
  assertKeyFileMetadata(keyFilePath);

  const databasePath = join(profileDirectory, DATABASE_FILENAME);
  if (keyFilePath === databasePath || keyFilePath === join(profileDirectory, PROFILE_LOCK_FILENAME)) {
    throw new Error("OWNER_AUTH_PROFILE_KEY_PATH_INVALID");
  }
  assertExistingDatabaseSafe(databasePath);
  for (const suffix of DATABASE_SIDECAR_SUFFIXES) assertExistingDatabaseSafe(`${databasePath}${suffix}`);

  const lease = acquireLocalOwnerProfileLease(profileDirectory);
  let resolver: ProfileFileAuthLinkKeyResolver | undefined;
  let store: SqliteAuthLinkStore | undefined;
  try {
    lease.assertHeld();
    assertRepositoryRootStable();
    assertOutsideRepository(profileDirectory);
    assertOutsideRepository(keyFilePath);
    assertProfileDirectory(profileDirectory);
    assertSecureAncestors(dirname(keyFilePath));
    const loadedKey = readKeyFile(keyFilePath);
    const profileId = createHash("sha256").update(profileDirectory, "utf8").digest("hex");
    resolver = new ProfileFileAuthLinkKeyResolver(loadedKey.key, `owner-profile-${profileId.slice(0, 48)}`, keyFilePath, loadedKey.identity);
    loadedKey.key.fill(0);
    const vault = new NodeAeadAuthLinkSecretVault(resolver, `owner-profile-${profileId.slice(0, 48)}`);
    store = new SqliteAuthLinkStore(databasePath, { vault });
    resolver.assertCurrent();
    assertProfileDirectory(profileDirectory);
    assertSecureAncestors(dirname(keyFilePath));
    assertExistingDatabaseSafe(databasePath);
    for (const suffix of DATABASE_SIDECAR_SUFFIXES) assertExistingDatabaseSafe(`${databasePath}${suffix}`);
    lease.assertHeld();
    const suffix = profileId.slice(0, 40);
    const binding: AuthBinding = Object.freeze({
      tenant_id: `tenant-owner-${suffix}`,
      subject: `subject-owner-${suffix}`
    });
    let closed = false;
    return Object.freeze({
      profileDirectory,
      store,
      binding,
      borrowGenerationLease() {
        if (closed) throw new Error("OWNER_AUTH_PROFILE_CLOSED");
        return createBorrowedOwnerProfileLease(profileDirectory, lease, store!, binding);
      },
      close() {
        if (closed) return;
        closed = true;
        try { store!.close(); }
        finally {
          try { resolver!.close(); }
          finally { lease.release(); }
        }
      }
    });
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try { store?.close(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    try { resolver?.close(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    try { lease.release(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], "Private owner auth profile startup cleanup failed.");
    }
    throw error;
  }
}

export function createPrivateOwnerAuthProfileFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): PrivateOwnerAuthProfile | null {
  const config = resolvePrivateOwnerAuthProfileConfig(environment);
  return config === null ? null : openPrivateOwnerAuthProfile(config);
}

class ProfileFileAuthLinkKeyResolver implements AuthLinkSecretKeyResolver {
  readonly #keyHandle: string;
  readonly #key: Buffer;
  readonly #keyFilePath: string;
  readonly #identity: KeyFileIdentity;
  #closed = false;

  constructor(key: Buffer, keyHandle: string, keyFilePath: string, identity: KeyFileIdentity) {
    this.#key = Buffer.from(key);
    this.#keyHandle = keyHandle;
    this.#keyFilePath = keyFilePath;
    this.#identity = identity;
  }

  async resolveKey(keyHandle: string): Promise<Uint8Array> {
    if (this.#closed || keyHandle !== this.#keyHandle) throw new Error("OWNER_AUTH_KEY_UNAVAILABLE");
    this.assertCurrent();
    return Uint8Array.from(this.#key);
  }

  assertCurrent(): void {
    try {
      assertOutsideRepository(this.#keyFilePath);
      assertNoSymlinkAncestors(this.#keyFilePath);
      if (realpathSync(this.#keyFilePath) !== this.#keyFilePath) throw new Error();
      const stat = lstatSync(this.#keyFilePath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== currentUid() || stat.nlink !== 1 ||
          stat.size !== 32 || (stat.mode & 0o777) !== 0o600 || !sameKeyIdentity(stat, this.#identity)) throw new Error();
    } catch { throw new Error("OWNER_AUTH_KEY_FILE_CHANGED"); }
  }

  close(): void {
    if (this.#closed) return;
    this.#key.fill(0);
    this.#closed = true;
  }
}

function validateCanonicalAbsolutePath(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || /[\r\n\u0000-\u001f\u007f]/u.test(value) ||
      !isAbsolute(value) || resolve(value) !== value) {
    throw new Error("OWNER_AUTH_PROFILE_PATH_INVALID");
  }
  let canonical: string;
  try { canonical = realpathSync(value); }
  catch { throw new Error("OWNER_AUTH_PROFILE_PATH_UNAVAILABLE"); }
  if (canonical !== value) throw new Error("OWNER_AUTH_PROFILE_PATH_SYMLINK");
  assertNoSymlinkAncestors(canonical);
  return canonical;
}

function assertOutsideRepository(path: string): void {
  assertRepositoryRootStable();
  const relativePath = relative(REPOSITORY.path, path);
  if (relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`)) || isAbsolute(relativePath)) {
    throw new Error("OWNER_AUTH_PROFILE_PATH_SCOPE_INVALID");
  }
}

function findVerifiedRepositoryRoot(moduleFilePath: string): { path: string; dev: number; ino: number } {
  let candidate = dirname(realpathSync(moduleFilePath));
  for (let depth = 0; depth < 8; depth += 1) {
    if (isVerifiedPackageRoot(candidate)) {
      const stat = lstatSync(candidate);
      return { path: candidate, dev: stat.dev, ino: stat.ino };
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error("OWNER_AUTH_PROJECT_BOUNDARY_UNAVAILABLE");
}

function isVerifiedPackageRoot(path: string): boolean {
  try {
    const rootStat = lstatSync(path);
    const packagePath = join(path, "package.json");
    const packageStat = lstatSync(packagePath);
    const catalogPath = join(path, "catalog");
    const catalogStat = lstatSync(catalogPath);
    const publicVersionPath = join(catalogPath, "v1");
    const publicVersionStat = lstatSync(publicVersionPath);
    const publicSnapshot = lstatSync(join(publicVersionPath, "official-public-api.json"));
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || packageStat.isSymbolicLink() || !packageStat.isFile() ||
        catalogStat.isSymbolicLink() || !catalogStat.isDirectory() || publicVersionStat.isSymbolicLink() || !publicVersionStat.isDirectory() ||
        publicSnapshot.isSymbolicLink() || !publicSnapshot.isFile()) return false;
    const parsed: unknown = JSON.parse(readFileSync(packagePath, "utf8"));
    return parsed !== null && typeof parsed === "object" && "name" in parsed && parsed.name === "syntx-mcp";
  } catch { return false; }
}

function assertRepositoryRootStable(): void {
  const stat = lstatSync(REPOSITORY.path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev !== REPOSITORY.dev || stat.ino !== REPOSITORY.ino ||
      realpathSync(REPOSITORY.path) !== REPOSITORY.path || !isVerifiedPackageRoot(REPOSITORY.path)) {
    throw new Error("OWNER_AUTH_PROJECT_BOUNDARY_CHANGED");
  }
}

function assertProfileDirectory(path: string): void {
  assertSecureAncestors(dirname(path));
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== currentUid() || (stat.mode & 0o777) !== 0o700) {
    throw new Error("OWNER_AUTH_PROFILE_DIRECTORY_UNSAFE");
  }
}

function assertSecureAncestors(path: string): void {
  let current = path;
  while (true) {
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.uid !== currentUid() && stat.uid !== 0) || (stat.mode & 0o022) !== 0) {
      throw new Error("OWNER_AUTH_PROFILE_PATH_ANCESTOR_UNSAFE");
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function assertNoSymlinkAncestors(path: string): void {
  let current = path;
  while (true) {
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("OWNER_AUTH_PROFILE_PATH_SYMLINK");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function assertKeyFileMetadata(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== currentUid() || stat.nlink !== 1 ||
      stat.size !== 32 || (stat.mode & 0o777) !== 0o600) {
    throw new Error("OWNER_AUTH_KEY_FILE_UNSAFE");
  }
}

interface KeyFileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
  readonly nlink: number;
  readonly size: number;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

function readKeyFile(path: string): { key: Buffer; identity: KeyFileIdentity } {
  assertKeyFileMetadata(path);
  assertNoSymlinkAncestors(path);
  if (realpathSync(path) !== path) throw new Error("OWNER_AUTH_KEY_FILE_CHANGED_DURING_READ");
  let descriptor: number;
  try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { throw new Error("OWNER_AUTH_KEY_FILE_UNAVAILABLE"); }
  try {
    const before = fstatSync(descriptor) as Stats;
    if (!before.isFile() || before.uid !== currentUid() || before.nlink !== 1 || before.size !== 32 || (before.mode & 0o777) !== 0o600) {
      throw new Error("OWNER_AUTH_KEY_FILE_UNSAFE");
    }
    const bytes = Buffer.alloc(33);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(descriptor, bytes, count, bytes.length - count, null);
      if (read === 0) break;
      count += read;
    }
    const after = fstatSync(descriptor) as Stats;
    const finalPathStat = lstatSync(path) as Stats;
    if (count !== 32 || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || finalPathStat.isSymbolicLink() ||
        finalPathStat.dev !== before.dev || finalPathStat.ino !== before.ino || finalPathStat.nlink !== 1 || realpathSync(path) !== path) {
      bytes.fill(0);
      throw new Error("OWNER_AUTH_KEY_FILE_CHANGED_DURING_READ");
    }
    return { key: bytes.subarray(0, 32), identity: snapshotKeyIdentity(before) };
  } finally { closeSync(descriptor); }
}

function snapshotKeyIdentity(stats: Stats): KeyFileIdentity {
  return {
    dev: stats.dev, ino: stats.ino, uid: stats.uid, nlink: stats.nlink, size: stats.size,
    mode: stats.mode, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs
  };
}

function sameKeyIdentity(stats: Stats, identity: KeyFileIdentity): boolean {
  return stats.dev === identity.dev && stats.ino === identity.ino && stats.uid === identity.uid &&
    stats.nlink === identity.nlink && stats.size === identity.size && stats.mode === identity.mode &&
    stats.mtimeMs === identity.mtimeMs && stats.ctimeMs === identity.ctimeMs;
}

function assertExistingDatabaseSafe(path: string): void {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== currentUid() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) {
      throw new Error("OWNER_AUTH_DATABASE_UNSAFE");
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

function currentUid(): number {
  if (typeof process.getuid !== "function") throw new Error("OWNER_AUTH_PROFILE_UID_UNAVAILABLE");
  return process.getuid();
}
