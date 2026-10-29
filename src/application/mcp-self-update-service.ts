import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { homedir } from "node:os";
import { access, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
export const SELF_UPDATE_ORIGIN = "https://github.com/alexfisenkov/syntx-mcp.git";
const SHA = /^[a-f0-9]{40}$/u;
function isWithin(root: string, candidate: string): boolean { const rel = relative(root, candidate); return rel !== "" && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel); }
type Pointer = { current: string; previous: string | null; current_path?: string | null; previous_path?: string | null };
export type SelfUpdateStatus = Readonly<{ status: string; current_sha: string | null; latest_sha: string | null; restart_required: boolean; rollback_sha: string | null }>;

function updateRoot(): string { return join(homedir(), ".syntx-mcp-updates"); }
function safeSha(value: string): string { if (!SHA.test(value)) throw new Error("Invalid update revision."); return value; }
export type UpdateCommandRunner = (file: string, args: string[], options: { cwd?: string | undefined; timeout: number; maxBuffer: number; windowsHide: boolean; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string }>;
export type SelfUpdateTestSeam = Readonly<{ root: string; run: UpdateCommandRunner; sourceRoot?: string | null; npmCliPath?: string; pathEnv?: string }>;
async function defaultRunner(file: string, args: string[], options: { cwd?: string | undefined; timeout: number; maxBuffer: number; windowsHide: boolean; env: NodeJS.ProcessEnv }): Promise<{ stdout: string }> { return execFile(file, args, options); }
async function git(run: UpdateCommandRunner, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run("git", args, { cwd, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true, env: { PATH: process.env.PATH ?? "", HOME: homedir(), USERPROFILE: homedir(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0" } });
  return stdout.trim();
}
async function readPointer(root = updateRoot()): Promise<Pointer | null> {
  try { const value = JSON.parse(await readFile(join(root, "pointer.json"), "utf8")) as Pointer; if (!SHA.test(value.current) || (value.previous !== null && !SHA.test(value.previous)) || (value.current_path !== undefined && value.current_path !== null && (typeof value.current_path !== "string" || value.current_path.includes("\0"))) || (value.previous_path !== undefined && value.previous_path !== null && (typeof value.previous_path !== "string" || value.previous_path.includes("\0")))) return null; return value; } catch { return null; }
}
async function atomicPointer(root: string, value: Pointer): Promise<void> {
  await mkdir(root, { recursive: true });
  const temporary = join(root, `.pointer-${process.pid}.tmp`);
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, join(root, "pointer.json"));
}
async function acquireMutationLock(root: string, operation: "apply" | "rollback"): Promise<boolean> {
  let handle: import("node:fs/promises").FileHandle | undefined;
  let created = false;
  const lockPath = join(root, "apply.lock");
  try {
    const { open } = await import("node:fs/promises");
    handle = await open(lockPath, "wx", 0o600);
    created = true;
    await handle.writeFile(JSON.stringify({ pid: process.pid, operation, started_at: new Date().toISOString() }));
    await handle.close();
    return true;
  } catch {
    await handle?.close().catch(() => undefined);
    if (created) await rm(lockPath, { force: true }).catch(() => undefined);
    return false;
  }
}
async function releaseMutationLock(root: string): Promise<void> {
  await rm(join(root, "apply.lock"), { force: true }).catch(() => undefined);
}
async function validatedPreparedVersion(root: string, sha: string, run: UpdateCommandRunner): Promise<string | null> {
  const versions = join(root, "versions");
  const target = join(versions, sha);
  try {
    const versionsInfo = await lstat(versions);
    const targetInfo = await lstat(target);
    if (versionsInfo.isSymbolicLink() || !versionsInfo.isDirectory() || targetInfo.isSymbolicLink() || !targetInfo.isDirectory()) return null;
    const versionsRoot = await realpath(versions);
    const actual = await realpath(target);
    if (actual !== join(versionsRoot, sha) || !isWithin(versionsRoot, actual)) return null;
    const identity = await sourceIdentity(actual, run);
    if (identity.status !== "SUPPORTED" || identity.sha !== sha || identity.path !== actual) return null;
    const entryPath = join(actual, "dist/src/transports/stdio-owner.js");
    const entryInfo = await lstat(entryPath);
    const entry = await realpath(entryPath);
    if (!entryInfo.isFile() || entryInfo.isSymbolicLink() || !isWithin(actual, entry)) return null;
    return actual;
  } catch {
    return null;
  }
}
async function latestSha(run: UpdateCommandRunner): Promise<string> { return safeSha(await git(run, ["ls-remote", SELF_UPDATE_ORIGIN, "refs/heads/main"]).then((line) => line.split("\t")[0] ?? "")); }
type SourceIdentity = { status: "SUPPORTED"; sha: string; path: string } | { status: "UNSUPPORTED"; sha: null; path: null } | { status: "NO_SOURCE"; sha: null; path: null };
async function sourceIdentity(sourceRoot: string | null, run: UpdateCommandRunner): Promise<SourceIdentity> {
  if (!sourceRoot) return { status: "NO_SOURCE", sha: null, path: null };
  let hasGitMetadata = true;
  try { await access(join(sourceRoot, ".git")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") hasGitMetadata = false; else return { status: "UNSUPPORTED", sha: null, path: null }; }
  if (!hasGitMetadata) return { status: "NO_SOURCE", sha: null, path: null };
  try {
    const actualRoot = await realpath(sourceRoot);
    const origin = await git(run, ["remote", "get-url", "origin"], actualRoot);
    if (origin !== SELF_UPDATE_ORIGIN && origin !== SELF_UPDATE_ORIGIN.replace(".git", "")) return { status: "UNSUPPORTED", sha: null, path: null };
    if ((await git(run, ["status", "--porcelain"], actualRoot)).length > 0) return { status: "UNSUPPORTED", sha: null, path: null };
    const sha = safeSha(await git(run, ["rev-parse", "HEAD"], actualRoot));
    return { status: "SUPPORTED", sha, path: actualRoot };
  } catch { return { status: "UNSUPPORTED", sha: null, path: null }; }
}

export class McpSelfUpdateService {
  private readonly root: string;
  private readonly runCommand: UpdateCommandRunner;
  constructor(private readonly seam?: SelfUpdateTestSeam) { this.root = seam?.root ?? updateRoot(); this.runCommand = seam?.run ?? defaultRunner; }
  async check(): Promise<SelfUpdateStatus> {
    const pointer = await readPointer(this.root);
    const sourceRoot = this.seam?.sourceRoot === undefined ? resolve(dirname(fileURLToPath(import.meta.url)), "../../..") : this.seam.sourceRoot;
    const identity = await sourceIdentity(sourceRoot, this.runCommand);
    if (identity.status === "UNSUPPORTED") return { status: "UNSUPPORTED_INSTALLATION", current_sha: null, latest_sha: null, restart_required: false, rollback_sha: pointer?.previous ?? null };
    const current = pointer?.current ?? identity.sha;
    if (identity.status === "NO_SOURCE" && current === null) return { status: "UNSUPPORTED_INSTALLATION", current_sha: null, latest_sha: null, restart_required: false, rollback_sha: null };
    try { const latest = await latestSha(this.runCommand); return { status: current === latest ? "UP_TO_DATE" : "UPDATE_AVAILABLE", current_sha: current, latest_sha: latest, restart_required: false, rollback_sha: pointer?.previous ?? null }; }
    catch { return { status: "UNAVAILABLE", current_sha: current, latest_sha: null, restart_required: false, rollback_sha: pointer?.previous ?? null }; }
  }
  async apply(): Promise<SelfUpdateStatus> {
    const root = this.root; await mkdir(root, { recursive: true });
    try { if ((await lstat(root)).isSymbolicLink()) return { ...(await this.check()), status: "UNSUPPORTED_INSTALLATION" }; } catch { return { ...(await this.check()), status: "UNSUPPORTED_INSTALLATION" }; }
    if (!(await acquireMutationLock(root, "apply"))) return { ...(await this.check()), status: "BUSY" };
    let stage: string | undefined;
    try {
      // Applying from a developer checkout can silently fork a private tree; only the canonical public source is allowed.
      const sourceRoot = this.seam?.sourceRoot === undefined ? resolve(dirname(fileURLToPath(import.meta.url)), "../../..") : this.seam.sourceRoot;
      const identity = await sourceIdentity(sourceRoot, this.runCommand);
      if (identity.status === "UNSUPPORTED") return { ...(await this.check()), status: "UNSUPPORTED_INSTALLATION", current_sha: null };
      const existing = await readPointer(root);
      if (identity.status === "NO_SOURCE" && existing === null) return { ...(await this.check()), status: "UNSUPPORTED_INSTALLATION", current_sha: null };
      const target = await latestSha(this.runCommand);
      const current = existing?.current ?? identity.sha;
      if (current === target) return { status: "UP_TO_DATE", current_sha: current, latest_sha: target, restart_required: false, rollback_sha: existing?.previous ?? null };
      const versions = join(root, "versions"); await mkdir(versions, { recursive: true });
      if ((await lstat(versions)).isSymbolicLink()) throw new Error("Invalid update directory.");
      const finalPath = join(versions, target);
      let finalExists = false;
      try { await lstat(finalPath); finalExists = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (finalExists) {
        stage = undefined;
        const prepared = await validatedPreparedVersion(root, target, this.runCommand);
        if (!prepared) throw new Error("Prepared version is invalid.");
        const previous = existing?.current ?? identity.sha;
        const previousPath = existing ? existing.current_path ?? null : identity.path;
        await atomicPointer(root, { current: target, previous, current_path: null, previous_path: previousPath });
        return { status: "STAGED", current_sha: target, latest_sha: target, restart_required: true, rollback_sha: previous };
      }
      stage = join(versions, `.staging-${process.pid}`);
      await rm(stage, { recursive: true, force: true });
      await git(this.runCommand, ["clone", "--depth", "1", SELF_UPDATE_ORIGIN, stage]);
      await git(this.runCommand, ["fetch", "--depth", "1", "origin", target], stage); await git(this.runCommand, ["checkout", "--detach", target], stage);
      if (await git(this.runCommand, ["rev-parse", "HEAD"], stage) !== target) throw new Error("Revision mismatch.");
      let npm: string | undefined = this.seam?.npmCliPath;
      if (!npm) npm = await resolveNpmCliPath(process.execPath, process.platform, this.seam?.pathEnv ?? process.env.PATH ?? "") ?? undefined;
      if (!npm) throw new Error("npm is unavailable in this Node installation.");
      const installEnv = { PATH: this.seam?.pathEnv ?? process.env.PATH ?? "", HOME: homedir(), USERPROFILE: homedir(), npm_config_ignore_scripts: "true", npm_config_userconfig: process.platform === "win32" ? "NUL" : "/dev/null", npm_config_registry: "https://registry.npmjs.org/", GIT_TERMINAL_PROMPT: "0" };
      await this.runCommand(process.execPath, [npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage, timeout: 240_000, maxBuffer: 1024 * 1024, windowsHide: true, env: installEnv });
      await this.runCommand(process.execPath, [npm, "run", "build"], { cwd: stage, timeout: 240_000, maxBuffer: 1024 * 1024, windowsHide: true, env: installEnv });
      await rename(stage, finalPath); stage = undefined;
      const previous = existing?.current ?? identity.sha;
      const previousPath = existing ? existing.current_path ?? null : identity.path;
      await atomicPointer(root, { current: target, previous, previous_path: previousPath });
      return { status: "STAGED", current_sha: target, latest_sha: target, restart_required: true, rollback_sha: previous };
    } catch {
      if (stage) await rm(stage, { recursive: true, force: true }).catch(() => undefined);
      return { ...(await this.check()), status: "UPDATE_FAILED" };
    } finally { await releaseMutationLock(root); }
  }
  async rollback(): Promise<SelfUpdateStatus> {
    const root = this.root;
    try { await mkdir(root, { recursive: true }); if ((await lstat(root)).isSymbolicLink()) return { ...(await this.check()), status: "UNSUPPORTED_INSTALLATION" }; }
    catch { return { ...(await this.check()), status: "UNSUPPORTED_INSTALLATION" }; }
    if (!(await acquireMutationLock(root, "rollback"))) {
      const pointer = await readPointer(root);
      return { status: "BUSY", current_sha: pointer?.current ?? null, latest_sha: null, restart_required: false, rollback_sha: pointer?.previous ?? null };
    }
    try {
      const pointer = await readPointer(root); if (!pointer?.previous) return { ...(await this.check()), status: "NO_ROLLBACK" };
      const candidate = join(root, "versions", pointer.previous);
      let currentPath: string | null = null;
      try {
        const actual = await realpath(candidate);
        if (!isWithin(await realpath(join(root, "versions")), actual) || !(await stat(join(actual, "dist/src/transports/stdio-owner.js"))).isFile()) throw new Error("Invalid version.");
      } catch {
        if (!pointer.previous_path) return { ...(await this.check()), status: "ROLLBACK_INVALID" };
        const identity = await sourceIdentity(pointer.previous_path, this.runCommand);
        if (identity.status !== "SUPPORTED" || identity.sha !== pointer.previous) return { ...(await this.check()), status: "ROLLBACK_INVALID" };
        currentPath = identity.path;
      }
      await atomicPointer(root, { current: pointer.previous, previous: pointer.current, current_path: currentPath, previous_path: pointer.current_path ?? null });
      return { status: "ROLLBACK_STAGED", current_sha: pointer.previous, latest_sha: null, restart_required: true, rollback_sha: pointer.current };
    } finally { await releaseMutationLock(root); }
  }
}

export function isSelfUpdateEnabled(env: NodeJS.ProcessEnv = process.env): boolean { return env.SYNTX_SELF_UPDATE === "1"; }

export function getNpmCliCandidates(execPath: string, platform = process.platform): string[] {
  const path = platform === "win32" ? win32 : { dirname, join };
  const base = path.dirname(execPath);
  return [path.join(base, "node_modules/npm/bin/npm-cli.js"), path.join(base, "../lib/node_modules/npm/bin/npm-cli.js")];
}

/** Resolve npm as a JavaScript CLI; never execute a PATH wrapper or shell script. */
export async function resolveNpmCliPath(execPath: string, platform = process.platform, pathEnv = process.env.PATH ?? ""): Promise<string | null> {
  for (const candidate of getNpmCliCandidates(execPath, platform)) {
    try {
      const actual = await realpath(candidate);
      if (basename(actual) === "npm-cli.js" && (await stat(actual)).isFile()) return actual;
    } catch { /* try the next trusted runtime location */ }
  }
  if (platform === "win32") return null;
  for (const directory of pathEnv.split(delimiter).filter(Boolean)) {
    try {
      const actual = await realpath(join(directory, "npm"));
      if (basename(actual) !== "npm-cli.js" || !(await stat(actual)).isFile()) continue;
      return actual;
    } catch { /* ignore missing or non-JavaScript PATH entries */ }
  }
  return null;
}

export type UpdateHandoff = (entry: string, env: NodeJS.ProcessEnv) => Promise<boolean>;
async function defaultHandoff(entry: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const child = spawn(process.execPath, [entry], { stdio: "inherit", env });
  const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
  process.exitCode = code ?? (signal ? 1 : 0);
  return true;
}

/** The installed launcher remains stable and hands off only at process startup. */
export async function handoffPreparedUpdate(env: NodeJS.ProcessEnv = process.env, root = updateRoot(), handoff: UpdateHandoff = defaultHandoff, run: UpdateCommandRunner = defaultRunner): Promise<boolean> {
  if (env.SYNTX_SELF_UPDATE_BOOTSTRAPPED === "1") return false;
  const pointer = await readPointer(root); if (!pointer) return false;
  if (pointer.current_path) {
    const identity = await sourceIdentity(pointer.current_path, run);
    if (identity.status !== "SUPPORTED" || identity.sha !== pointer.current) return false;
    try {
      const entry = await realpath(join(identity.path, "dist/src/transports/stdio-owner.js"));
      if (!isWithin(identity.path, entry)) return false;
      return await handoff(entry, { ...env, SYNTX_SELF_UPDATE_BOOTSTRAPPED: "1" });
    } catch { return false; }
  }
  const versionRoot = join(root, "versions", pointer.current);
  try {
    const actual = await realpath(versionRoot);
    if (!isWithin(await realpath(join(root, "versions")), actual) || !SHA.test(pointer.current)) return false;
    const entry = join(actual, "dist/src/transports/stdio-owner.js"); await access(entry);
    return await handoff(entry, { ...env, SYNTX_SELF_UPDATE_BOOTSTRAPPED: "1" });
  } catch { return false; }
}
