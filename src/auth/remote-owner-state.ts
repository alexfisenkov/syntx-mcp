import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync, linkSync, unlinkSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

function packageRoot(): string {
  let path = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    try { if (JSON.parse(readFileSync(join(path, "package.json"), "utf8")).name === "syntx-mcp") return realpathSync(path); } catch { /* continue upwards */ }
    path = dirname(path);
  }
  throw new Error("REMOTE_OWNER_PACKAGE_BOUNDARY_UNAVAILABLE");
}
const repository = packageRoot();

export function assertRemoteOwnerPrivateDirectory(path: string): void {
  assertRemoteOwnerOutsideRepository(path);
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) {
    throw new Error("REMOTE_OWNER_STATE_DIRECTORY_UNSAFE");
  }
}

export function assertRemoteOwnerOutsideRepository(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path || /[\x00-\x1f\x7f]/u.test(path)) {
    throw new Error("REMOTE_OWNER_PATH_INVALID");
  }
  const child = relative(repository, path);
  if (child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child))) {
    throw new Error("REMOTE_OWNER_STATE_INSIDE_REPOSITORY");
  }
}

export function initializeRemoteOwnerDirectory(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(dirname(path)) !== dirname(path)) throw new Error("REMOTE_OWNER_PATH_INVALID");
  try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  assertRemoteOwnerPrivateDirectory(path);
}

/** Read through O_NOFOLLOW, with metadata checked on the opened descriptor. */
export function readRemoteOwnerPrivateJson(path: string, maxBytes = 64 * 1024): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > maxBytes) {
      throw new Error("REMOTE_OWNER_PRIVATE_FILE_UNSAFE");
    }
    return JSON.parse(readFileSync(fd, "utf8")) as unknown;
  } finally { closeSync(fd); }
}

/** Atomic, no-overwrite publication. All paths are fixed children of a checked 0700 directory. */
export function writeRemoteOwnerPrivateJson(directory: string, name: string, value: unknown): void {
  assertRemoteOwnerPrivateDirectory(directory);
  if (!/^[a-z0-9_-]+\.json$/u.test(name)) throw new Error("REMOTE_OWNER_FILENAME_INVALID");
  const temporary = join(directory, `.write-${randomBytes(16).toString("hex")}`);
  writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
  try { linkSync(temporary, join(directory, name)); }
  finally { unlinkSync(temporary); }
}

export function removeRemoteOwnerStateFile(directory: string, name: string): void {
  if (!/^(?:pending|approved)_[a-f0-9]{32}\.json$/u.test(name)) throw new Error("REMOTE_OWNER_FILENAME_INVALID");
  try { unlinkSync(join(directory, name)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

export function pendingRemoteOwnerFiles(directory: string): string[] {
  assertRemoteOwnerPrivateDirectory(directory);
  return readdirSync(directory).filter((name) => /^pending_[a-f0-9]{32}\.json$/u.test(name));
}

/** Only hashes of OAuth codes/tokens enter this store. Client metadata contains no client secrets. */
export class RemoteOwnerOAuthStore {
  readonly #database: DatabaseSync;
  constructor(readonly directory: string, identity: string) {
    assertRemoteOwnerPrivateDirectory(directory);
    const path = join(directory, "oauth.sqlite");
    try { const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); closeSync(fd); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    // Check before SQLite opens anything; reject unsafe sidecars as well.
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      try {
        const stat = lstatSync(`${path}${suffix}`);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) throw new Error("REMOTE_OWNER_DATABASE_UNSAFE");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS oauth_records (bucket TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(bucket,key));");
    const existing = this.get<string>("meta", "identity", 0);
    if (existing !== undefined && existing !== identity) { this.#database.close(); throw new Error("REMOTE_OWNER_IDENTITY_MISMATCH"); }
    this.put("meta", "identity", identity, 0);
  }
  get<T>(bucket: string, key: string, now: number): T | undefined {
    const row = this.#database.prepare("SELECT value,expires FROM oauth_records WHERE bucket=? AND key=?").get(bucket, key);
    if (!row || (Number(row.expires) !== 0 && Number(row.expires) <= now)) return undefined;
    return JSON.parse(String(row.value)) as T;
  }
  put(bucket: string, key: string, value: unknown, expires: number): void {
    this.#database.prepare("INSERT OR REPLACE INTO oauth_records VALUES(?,?,?,?)").run(bucket, key, JSON.stringify(value), expires);
  }
  delete(bucket: string, key: string): void { this.#database.prepare("DELETE FROM oauth_records WHERE bucket=? AND key=?").run(bucket, key); }
  take<T>(bucket: string, key: string, now: number): T | undefined {
    const row = this.#database.prepare("DELETE FROM oauth_records WHERE bucket=? AND key=? AND (expires=0 OR expires>?) RETURNING value").get(bucket, key, now);
    return row ? JSON.parse(String(row.value)) as T : undefined;
  }
  count(bucket: string): number { return Number(this.#database.prepare("SELECT count(*) AS total FROM oauth_records WHERE bucket=?").get(bucket)?.total); }
  prune(now: number): void { this.#database.prepare("DELETE FROM oauth_records WHERE expires != 0 AND expires <= ?").run(now); }
  deleteFamily(family: string): void {
    this.#database.prepare("DELETE FROM oauth_records WHERE bucket='token' AND json_extract(value,'$.family')=?").run(family);
  }
  close(): void { this.#database.close(); }
}
