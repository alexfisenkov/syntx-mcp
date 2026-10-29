import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getNpmCliCandidates,
  handoffPreparedUpdate,
  McpSelfUpdateService,
  resolveNpmCliPath,
  SELF_UPDATE_ORIGIN
} from "../dist/src/application/mcp-self-update-service.js";
import { registerMcpSelfUpdateTools } from "../dist/src/mcp/self-update-tools.js";

const shaA = "1111111111111111111111111111111111111111";
const shaB = "2222222222222222222222222222222222222222";
const entryRelative = "dist/src/transports/stdio-owner.js";

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "syntx-update-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let latest = shaB;
  const calls = [];
  let failNpm = false;
  let failBuild = false;
  let holdNpm;
  const runner = async (file, args, options = {}) => {
    calls.push({ file, args, options });
    if (file === "git") {
      if (args[0] === "ls-remote") return { stdout: `${latest}\trefs/heads/main\n` };
      if (args[0] === "remote") return { stdout: SELF_UPDATE_ORIGIN };
      if (args[0] === "clone") { await mkdir(path.join(args.at(-1), ".git"), { recursive: true }); return { stdout: "" }; }
      if (args[0] === "rev-parse") return { stdout: latest };
      return { stdout: "" };
    }
    if (args.includes("ci")) {
      if (holdNpm) await holdNpm;
      if (failNpm) throw new Error("fixture install failure");
    }
    if (args.includes("build") && options.cwd) {
      await mkdir(path.join(options.cwd, path.dirname(entryRelative)), { recursive: true });
      await writeFile(path.join(options.cwd, entryRelative), "fixture entry");
      if (failBuild) throw new Error("fixture build failure after partial emit");
    }
    return { stdout: "" };
  };
  const seam = { root, run: runner, sourceRoot: null };
  if (Object.hasOwn(options, "npmCliPath")) seam.npmCliPath = options.npmCliPath;
  else seam.npmCliPath = "/trusted-test/npm-cli.js";
  if (options.pathEnv !== undefined) seam.pathEnv = options.pathEnv;
  const service = new McpSelfUpdateService(seam);
  return { root, service, calls, runner, setLatest: (value) => { latest = value; }, failNpm: (value) => { failNpm = value; }, failBuild: (value) => { failBuild = value; }, setHold: (value) => { holdNpm = value; } };
}

async function installVersion(root, sha) {
  const version = path.join(root, "versions", sha);
  await mkdir(path.join(version, ".git"), { recursive: true });
  await mkdir(path.join(version, path.dirname(entryRelative)), { recursive: true });
  await writeFile(path.join(version, entryRelative), "fixture entry");
  return version;
}

test("check is read-only and uses the fixed public repository", async (t) => {
  const f = await fixture(t);
  await installVersion(f.root, shaA);
  const pointer = JSON.stringify({ current: shaA, previous: null });
  await writeFile(path.join(f.root, "pointer.json"), pointer);
  const result = await f.service.check();
  assert.equal(result.status, "UPDATE_AVAILABLE");
  assert.equal(result.current_sha, shaA);
  assert.equal(result.latest_sha, shaB);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].args, ["ls-remote", SELF_UPDATE_ORIGIN, "refs/heads/main"]);
  assert.equal(await readFile(path.join(f.root, "pointer.json"), "utf8"), pointer);
  assert.equal(f.calls.some(({ args }) => args.includes("clone") || args.includes("ci") || args.includes("build")), false);
});

test("an install with no verifiable source or managed version reports unknown as unsupported", async (t) => {
  const f = await fixture(t);
  const result = await f.service.check();
  assert.equal(result.status, "UNSUPPORTED_INSTALLATION");
  assert.equal(result.current_sha, null);
  assert.equal(result.latest_sha, null);
  assert.equal(f.calls.length, 0);
});

test("MCP tools reject caller-controlled paths, commands and repository URLs", async (t) => {
  const f = await fixture(t);
  const tools = new Map();
  registerMcpSelfUpdateTools({ registerTool: (name, config, handler) => tools.set(name, { config, handler }) }, f.service, true);
  assert.deepEqual([...tools.keys()], ["syntx_update_check", "syntx_update_apply", "syntx_update_rollback"]);
  for (const name of tools.keys()) assert.throws(() => tools.get(name).config.inputSchema.parse({ path: "/tmp/pwn", url: "https://bad.invalid", command: "id" }));
  await tools.get("syntx_update_apply").handler({});
  assert.equal(f.calls.some(({ args }) => args.includes("https://bad.invalid") || args.includes("/tmp/pwn") || args.includes("id")), false);
  const readOnlyTools = new Map();
  registerMcpSelfUpdateTools({ registerTool: (name, config, handler) => readOnlyTools.set(name, { config, handler }) }, f.service, false);
  assert.deepEqual([...readOnlyTools.keys()], ["syntx_update_check"]);
});

test("a source checkout with a non-canonical origin is refused before cloning", async (t) => {
  const f = await fixture(t);
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "syntx-private-checkout-"));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  await mkdir(path.join(sourceRoot, ".git"));
  const run = async (file, args, options) => args[0] === "remote"
    ? { stdout: "https://example.invalid/private.git" }
    : f.runner(file, args, options);
  const service = new McpSelfUpdateService({ root: f.root, run, sourceRoot, npmCliPath: "/trusted-test/npm-cli.js" });
  const check = await service.check();
  assert.equal(check.status, "UNSUPPORTED_INSTALLATION");
  assert.equal(check.current_sha, null);
  assert.equal((await service.apply()).status, "UNSUPPORTED_INSTALLATION");
  assert.equal(f.calls.some(({ args }) => args[0] === "clone"), false);
});

test("a clean canonical source checkout reports its actual HEAD and can be up to date without a managed pointer", async (t) => {
  const f = await fixture(t);
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "syntx-public-checkout-"));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  await mkdir(path.join(sourceRoot, ".git"));
  const canonicalSourceRoot = await realpath(sourceRoot);
  const run = async (file, args, options = {}) => {
    if (args[0] === "remote") return { stdout: SELF_UPDATE_ORIGIN };
    if (args[0] === "status") return { stdout: "" };
    if (args[0] === "rev-parse" && options.cwd === canonicalSourceRoot) return { stdout: shaB };
    return f.runner(file, args, options);
  };
  const service = new McpSelfUpdateService({ root: f.root, run, sourceRoot });
  assert.deepEqual(await service.check(), { status: "UP_TO_DATE", current_sha: shaB, latest_sha: shaB, restart_required: false, rollback_sha: null });
});

test("first update preserves the canonical checkout as rollback target and bootstrap can select it", async (t) => {
  const f = await fixture(t);
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "syntx-original-checkout-"));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  await mkdir(path.join(sourceRoot, ".git"));
  await mkdir(path.join(sourceRoot, path.dirname(entryRelative)), { recursive: true });
  await writeFile(path.join(sourceRoot, entryRelative), "original working entry");
  const canonicalSourceRoot = await realpath(sourceRoot);
  const run = async (file, args, options = {}) => {
    if (args[0] === "remote") return { stdout: SELF_UPDATE_ORIGIN };
    if (args[0] === "status") return { stdout: "" };
    if (args[0] === "rev-parse" && options.cwd === canonicalSourceRoot) return { stdout: shaA };
    return f.runner(file, args, options);
  };
  const service = new McpSelfUpdateService({ root: f.root, run, sourceRoot, npmCliPath: "/trusted-test/npm-cli.js" });
  assert.equal((await service.apply()).status, "STAGED");
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, "pointer.json"), "utf8")), { current: shaB, previous: shaA, previous_path: canonicalSourceRoot });
  assert.equal((await service.rollback()).current_sha, shaA);
  let selected;
  assert.equal(await handoffPreparedUpdate({}, f.root, async (entry) => { selected = entry; return true; }, run), true);
  assert.equal(selected, path.join(canonicalSourceRoot, entryRelative));
  assert.equal(await readFile(path.join(sourceRoot, entryRelative), "utf8"), "original working entry");
});

test("a dirty canonical source checkout is refused before cloning", async (t) => {
  const f = await fixture(t);
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "syntx-dirty-checkout-"));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  await mkdir(path.join(sourceRoot, ".git"));
  const run = async (file, args, options) => {
    if (args[0] === "remote") return { stdout: SELF_UPDATE_ORIGIN };
    if (args[0] === "status") return { stdout: " M src/private-change.ts" };
    return f.runner(file, args, options);
  };
  const service = new McpSelfUpdateService({ root: f.root, run, sourceRoot, npmCliPath: "/trusted-test/npm-cli.js" });
  assert.equal((await service.apply()).status, "UNSUPPORTED_INSTALLATION");
  assert.equal(f.calls.some(({ args }) => args[0] === "clone"), false);
});

test("apply failure preserves the active pointer and prior working version", async (t) => {
  const f = await fixture(t);
  await installVersion(f.root, shaA);
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaA, previous: null }));
  f.failNpm(true);
  const result = await f.service.apply();
  assert.equal(result.status, "UPDATE_FAILED");
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, "pointer.json"), "utf8")), { current: shaA, previous: null });
  assert.equal((await readFile(path.join(f.root, "versions", shaA, entryRelative), "utf8")), "fixture entry");
  assert.equal(f.calls.find(({ args }) => args[0] === "clone").args[3], SELF_UPDATE_ORIGIN);
});

test("a failed partial build cannot be selected on a later handoff or apply retry", async (t) => {
  const f = await fixture(t);
  await installVersion(f.root, shaA);
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaA, previous: null }));
  f.failBuild(true);
  assert.equal((await f.service.apply()).status, "UPDATE_FAILED");
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, "pointer.json"), "utf8")), { current: shaA, previous: null });
  assert.equal(await accessMissing(path.join(f.root, "versions", shaB)), true);
  let selected;
  assert.equal(await handoffPreparedUpdate({}, f.root, async (entry) => { selected = entry; return true; }, f.runner), true);
  assert.equal(await realpath(selected), await realpath(path.join(f.root, "versions", shaA, entryRelative)));
  assert.equal((await f.service.apply()).status, "UPDATE_FAILED");
  assert.equal(await accessMissing(path.join(f.root, "versions", shaB)), true);
  assert.equal(await handoffPreparedUpdate({}, f.root, async (entry) => { selected = entry; return true; }, f.runner), true);
  assert.equal(await realpath(selected), await realpath(path.join(f.root, "versions", shaA, entryRelative)));
});

async function accessMissing(target) {
  try { await realpath(target); return false; } catch { return true; }
}

test("successful apply records exact SHA and rollback selects previous working SHA", async (t) => {
  const f = await fixture(t);
  await installVersion(f.root, shaA);
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaA, previous: null }));
  const applied = await f.service.apply();
  assert.equal(applied.status, "STAGED");
  assert.equal(applied.current_sha, shaB);
  assert.equal(applied.restart_required, true);
  const rolledBack = await f.service.rollback();
  assert.equal(rolledBack.status, "ROLLBACK_STAGED");
  assert.equal(rolledBack.current_sha, shaA);
  assert.equal(JSON.parse(await readFile(path.join(f.root, "pointer.json"), "utf8")).current, shaA);
});

test("apply reuses the exact prepared version after rollback without replacing its files", async (t) => {
  const f = await fixture(t);
  await installVersion(f.root, shaA);
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaA, previous: null }));
  assert.equal((await f.service.apply()).status, "STAGED");
  const preparedPath = path.join(f.root, "versions", shaB);
  const before = await readFile(path.join(preparedPath, entryRelative), "utf8");
  assert.equal((await f.service.rollback()).status, "ROLLBACK_STAGED");

  const cloneCallsBefore = f.calls.filter(({ args }) => args[0] === "clone").length;
  const reapplied = await f.service.apply();

  assert.equal(reapplied.status, "STAGED");
  assert.equal(reapplied.current_sha, shaB);
  assert.equal(reapplied.rollback_sha, shaA);
  assert.equal(f.calls.filter(({ args }) => args[0] === "clone").length, cloneCallsBefore);
  assert.equal(await readFile(path.join(preparedPath, entryRelative), "utf8"), before);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, "pointer.json"), "utf8")), { current: shaB, previous: shaA, current_path: null, previous_path: null });
});

test("invalid retained target is not activated or deleted", async (t) => {
  const f = await fixture(t);
  await installVersion(f.root, shaA);
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaA, previous: null }));
  const target = path.join(f.root, "versions", shaB);
  await mkdir(path.join(target, ".git"), { recursive: true });
  await writeFile(path.join(target, "partial-build-marker"), "retain for diagnosis");
  const pointerBefore = await readFile(path.join(f.root, "pointer.json"), "utf8");

  assert.equal((await f.service.apply()).status, "UPDATE_FAILED");
  assert.equal(await readFile(path.join(f.root, "pointer.json"), "utf8"), pointerBefore);
  assert.equal(await readFile(path.join(target, "partial-build-marker"), "utf8"), "retain for diagnosis");
  assert.equal(f.calls.some(({ args }) => args[0] === "clone"), false);
});

test("symlinked retained target is not activated or deleted", async (t) => {
  const f = await fixture(t);
  await installVersion(f.root, shaA);
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaA, previous: null }));
  const outside = await mkdtemp(path.join(os.tmpdir(), "syntx-update-retained-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, "sentinel"), "retain");
  const target = path.join(f.root, "versions", shaB);
  await symlink(outside, target, "dir");
  const pointerBefore = await readFile(path.join(f.root, "pointer.json"), "utf8");

  assert.equal((await f.service.apply()).status, "UPDATE_FAILED");
  assert.equal(await readFile(path.join(f.root, "pointer.json"), "utf8"), pointerBefore);
  assert.equal(await readFile(path.join(outside, "sentinel"), "utf8"), "retain");
  assert.equal((await realpath(target)), await realpath(outside));
});

test("retained target with a non-canonical origin is rejected without deleting it", async (t) => {
  const f = await fixture(t);
  await installVersion(f.root, shaA);
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaA, previous: null }));
  const target = await installVersion(f.root, shaB);
  const runner = async (file, args, options) => args[0] === "remote"
    ? { stdout: "https://example.invalid/other.git" }
    : f.runner(file, args, options);
  const service = new McpSelfUpdateService({ root: f.root, run: runner, sourceRoot: null, npmCliPath: "/trusted-test/npm-cli.js" });

  assert.equal((await service.apply()).status, "UPDATE_FAILED");
  assert.equal(JSON.parse(await readFile(path.join(f.root, "pointer.json"), "utf8")).current, shaA);
  assert.equal(await readFile(path.join(target, entryRelative), "utf8"), "fixture entry");
});

test("a concurrent apply is rejected while the first owns the lock", { timeout: 8000 }, async (t) => {
  const f = await fixture(t);
  await installVersion(f.root, shaA);
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaA, previous: null }));
  let release;
  f.setHold(new Promise((resolve) => { release = resolve; }));
  const first = f.service.apply();
  const deadline = Date.now() + 3000;
  while (!f.calls.some(({ args }) => args.includes("ci"))) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the first updater to enter dependency install.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const second = await f.service.apply();
  assert.equal(second.status, "BUSY");
  release();
  assert.equal((await first).status, "STAGED");
});

test("rollback is rejected while apply owns the shared mutation lock", { timeout: 8000 }, async (t) => {
  const f = await fixture(t);
  await installVersion(f.root, shaA);
  await installVersion(f.root, "3333333333333333333333333333333333333333");
  const initialPointer = { current: shaA, previous: "3333333333333333333333333333333333333333" };
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify(initialPointer));
  let release;
  f.setHold(new Promise((resolve) => { release = resolve; }));
  const applying = f.service.apply();
  const deadline = Date.now() + 3000;
  while (!f.calls.some(({ args }) => args.includes("ci"))) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for apply to own the mutation lock.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const rolledBack = await f.service.rollback();
  assert.equal(rolledBack.status, "BUSY");
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root, "pointer.json"), "utf8")), initialPointer);
  release();
  assert.equal((await applying).status, "STAGED");
});

test("a pre-existing mutation lock prevents rollback and is preserved", async (t) => {
  const f = await fixture(t);
  await installVersion(f.root, shaA);
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaB, previous: shaA }));
  const lock = path.join(f.root, "apply.lock");
  const owner = JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() });
  await writeFile(lock, owner, { flag: "wx" });
  assert.equal((await f.service.rollback()).status, "BUSY");
  assert.equal(await readFile(lock, "utf8"), owner);
  assert.equal(JSON.parse(await readFile(path.join(f.root, "pointer.json"), "utf8")).current, shaB);
});

test("concurrent rollbacks serialize on the shared mutation lock", { timeout: 8000 }, async (t) => {
  const f = await fixture(t);
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "syntx-update-rollback-source-"));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  await mkdir(path.join(sourceRoot, ".git"), { recursive: true });
  const canonicalSourceRoot = await realpath(sourceRoot);
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaB, previous: shaA, previous_path: canonicalSourceRoot }));
  let release;
  let signalRemote;
  const remoteEntered = new Promise((resolve) => { signalRemote = resolve; });
  const holdRemote = new Promise((resolve) => { release = resolve; });
  const runner = async (file, args, options = {}) => {
    if (args[0] === "remote" && options.cwd === canonicalSourceRoot) {
      signalRemote();
      await holdRemote;
      return { stdout: SELF_UPDATE_ORIGIN };
    }
    if (args[0] === "status" && options.cwd === canonicalSourceRoot) return { stdout: "" };
    if (args[0] === "rev-parse" && options.cwd === canonicalSourceRoot) return { stdout: shaA };
    return f.runner(file, args, options);
  };
  const service = new McpSelfUpdateService({ root: f.root, run: runner, sourceRoot: null, npmCliPath: "/trusted-test/npm-cli.js" });
  const first = service.rollback();
  const timeout = setTimeout(() => { throw new Error("Timed out waiting for the first rollback to validate its source."); }, 3000);
  await remoteEntered;
  clearTimeout(timeout);

  assert.equal((await service.rollback()).status, "BUSY");
  release();
  assert.equal((await first).status, "ROLLBACK_STAGED");
  assert.equal(JSON.parse(await readFile(path.join(f.root, "pointer.json"), "utf8")).current, shaA);
});

test("an existing process-global lock is preserved and prevents a second updater", async (t) => {
  const f = await fixture(t);
  const lock = path.join(f.root, "apply.lock");
  const owner = JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() });
  await writeFile(lock, owner, { flag: "wx" });
  assert.equal((await f.service.apply()).status, "BUSY");
  assert.equal(await readFile(lock, "utf8"), owner);
  assert.equal(f.calls.some(({ args }) => args[0] === "clone"), false);
});

test("symlinked update roots and rollback versions outside the version store are rejected", async (t) => {
  const f = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), "syntx-update-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const linkRoot = `${f.root}-link`;
  await symlink(outside, linkRoot, "dir");
  const linked = new McpSelfUpdateService({ root: linkRoot, run: f.runner, sourceRoot: null, npmCliPath: "/trusted-test/npm-cli.js" });
  assert.equal((await linked.apply()).status, "UNSUPPORTED_INSTALLATION");
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaB, previous: shaA }));
  await mkdir(path.join(f.root, "versions"), { recursive: true });
  await symlink(outside, path.join(f.root, "versions", shaA), "dir");
  assert.equal((await f.service.rollback()).status, "ROLLBACK_INVALID");
});

test("bootstrap hands off the selected SHA once and honors the loop sentinel", async (t) => {
  const f = await fixture(t);
  await installVersion(f.root, shaA);
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaA, previous: null }));
  let selected;
  const handoff = async (entry, env) => { selected = { entry, env }; return true; };
  assert.equal(await handoffPreparedUpdate({}, f.root, handoff), true);
  assert.equal(await realpath(selected.entry), await realpath(path.join(f.root, "versions", shaA, entryRelative)));
  assert.equal(selected.env.SYNTX_SELF_UPDATE_BOOTSTRAPPED, "1");
  assert.equal(await handoffPreparedUpdate(selected.env, f.root, handoff), false);
});

test("npm CLI discovery produces native Node-install paths on Windows", () => {
  assert.deepEqual(getNpmCliCandidates("C:\\Program Files\\nodejs\\node.exe", "win32"), [
    "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
    "C:\\Program Files\\lib\\node_modules\\npm\\bin\\npm-cli.js"
  ]);
});

test("Unix PATH discovery resolves only a symlink to npm-cli.js and rejects shell wrappers", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "syntx-npm-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const cli = path.join(root, "npm-install", "node_modules", "npm", "bin", "npm-cli.js");
  await mkdir(bin, { recursive: true });
  await mkdir(path.dirname(cli), { recursive: true });
  await writeFile(cli, "process.exit(0);\n");
  await symlink(cli, path.join(bin, "npm"));
  assert.equal(await resolveNpmCliPath(path.join(root, "node", "node"), "darwin", bin), await realpath(cli));
  await rm(path.join(bin, "npm"));
  await writeFile(path.join(bin, "npm"), "#!/bin/sh\necho unsafe-wrapper\n", { mode: 0o755 });
  assert.equal(await resolveNpmCliPath(path.join(root, "node", "node"), "darwin", bin), null);
});

test("npm discovery prefers adjacent JavaScript CLIs before PATH candidates", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "syntx-npm-adjacent-priority-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fakeNode = path.join(root, "runtime", "bin", "node");
  const [firstCandidate, secondCandidate] = getNpmCliCandidates(fakeNode, process.platform);
  const pathBin = path.join(root, "path-bin");
  const pathCli = path.join(root, "path-install", "node_modules", "npm", "bin", "npm-cli.js");
  for (const candidate of [firstCandidate, secondCandidate, pathCli]) {
    await mkdir(path.dirname(candidate), { recursive: true });
    await writeFile(candidate, "process.exit(0);\n");
  }
  if (process.platform !== "win32") {
    await mkdir(pathBin, { recursive: true });
    await symlink(pathCli, path.join(pathBin, "npm"));
  }
  const resolved = await resolveNpmCliPath(fakeNode, process.platform, pathBin);
  assert.equal(resolved, await realpath(firstCandidate));
  assert.equal(path.basename(resolved), "npm-cli.js");
  assert.equal((await stat(resolved)).isFile(), true);
});

test("apply runs the selected adjacent-or-PATH npm-cli.js through trusted Node and preserves PATH", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "syntx-npm-apply-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const cli = path.join(root, "npm-install", "node_modules", "npm", "bin", "npm-cli.js");
  await mkdir(bin, { recursive: true });
  await mkdir(path.dirname(cli), { recursive: true });
  await writeFile(cli, "process.exit(0);\n");
  await symlink(cli, path.join(bin, "npm"));
  const adjacentCli = await firstExistingNpmCli(getNpmCliCandidates(process.execPath, process.platform));
  const expectedCli = adjacentCli ?? await realpath(cli);
  assert.equal(await resolveNpmCliPath(process.execPath, process.platform, bin), expectedCli);
  const f = await fixture(t, { npmCliPath: undefined, pathEnv: bin });
  await installVersion(f.root, shaA);
  await writeFile(path.join(f.root, "pointer.json"), JSON.stringify({ current: shaA, previous: null }));
  assert.equal((await f.service.apply()).status, "STAGED");
  const npmCalls = f.calls.filter(({ file }) => file === process.execPath);
  assert.equal(npmCalls.length, 2);
  assert.deepEqual(npmCalls.map(({ args }) => args[0]), [expectedCli, expectedCli]);
  assert.equal(npmCalls.every(({ file, args, options }) => file === process.execPath && path.basename(args[0]) === "npm-cli.js" &&
    options.env.PATH === bin), true);
});

async function firstExistingNpmCli(candidates) {
  for (const candidate of candidates) {
    try {
      const resolved = await realpath(candidate);
      if (path.basename(resolved) === "npm-cli.js" && (await stat(resolved)).isFile()) return resolved;
    } catch { /* absent adjacent CLI: test the injected PATH fallback */ }
  }
  return null;
}

test("host npm discovery is a read-only filesystem probe", async () => {
  const result = await resolveNpmCliPath(process.execPath);
  assert.equal(result === null || path.basename(result) === "npm-cli.js", true);
  if (result) assert.equal(await realpath(result), result);
});
