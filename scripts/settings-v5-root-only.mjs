#!/usr/bin/env node
// Maintenance command for the first v5 root-only slice; never enables runtime.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acquireSyncLock, releaseSyncLock } from "./sync-normalized-settings-parser-generic-form-result.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_MARKERS = [
  "tsconfig.json", "node_modules/typescript/bin/tsc",
  "src/catalog/settings-root-only-result-v5.ts",
  "tools/settings-ir/v5/pinned-root-bundle.ts",
  "tools/settings-ir/v5/compile-root-only.ts",
  "tools/settings-ir/v5/root-only-result-toolchain.ts",
  "tools/settings-ir/v5/implementation-graph.ts"
];
const SAFE_CODES = new Set([
  "INVALID_ARGUMENT", "SETTINGS_V5_REQUIRES_SOURCE_CHECKOUT", "SETTINGS_V5_REQUIRES_BUILD",
  "SETTINGS_V5_BUILD_FAILED", "SETTINGS_V5_RESULT_EXISTS", "SETTINGS_V5_RESULT_MISSING",
  "SETTINGS_V5_BUILD_INPUT_DRIFT", "SETTINGS_V5_BUILD_INPUT_INVALID",
  "SETTINGS_V5_RESULT_INVALID", "SETTINGS_V5_SOURCE_INVALID", "SETTINGS_V5_SOURCE_DRIFT",
  "SETTINGS_V5_SOURCE_FETCH_NOT_CONFIRMED", "SETTINGS_V5_RELATIONSHIP_DRIFT",
  "SETTINGS_V5_TOOLCHAIN_INVALID", "SETTINGS_V5_IMPLEMENTATION_INVALID",
  "SETTINGS_V5_MATERIAL_INVALID", "SETTINGS_V5_ROOT_COMPILATION_FAILED", "SETTINGS_V5_SCOPE_DRIFT",
  "SETTINGS_V5_CLEANUP_FAILED", "SETTINGS_V5_READBACK_FAILED", "SETTINGS_V5_INTERRUPTED",
  "GENERIC_RESULT_LOCKED", "GENERIC_RESULT_LOCK_FAILED", "GENERIC_RESULT_LOCK_CLEANUP_FAILED",
  "IMMUTABLE_SNAPSHOT_TARGET_EXISTS", "IMMUTABLE_SNAPSHOT_CLEANUP_FAILED",
  "IMMUTABLE_SNAPSHOT_WRITE_FAILED", "IMMUTABLE_SNAPSHOT_REQUEST_INVALID",
  "IMMUTABLE_SNAPSHOT_CONTENT_TOO_LARGE", "IMMUTABLE_SNAPSHOT_TEMPORARY_COLLISION"
]);

export function parseRootOnlyV5Arguments(argv) {
  if (!Array.isArray(argv)) fail("INVALID_ARGUMENT");
  if (argv.length === 3 && argv[0] === "--check" && argv[1] === "--form-id" && argv[2] === "beeble") return "check";
  if (argv.length === 4 && ["--probe-source", "--sync-source"].includes(argv[0]) &&
      argv[1] === "--form-id" && argv[2] === "beeble" && argv[3] === "--confirm-source-fetch") {
    return argv[0].slice(2);
  }
  fail("INVALID_ARGUMENT");
}

export async function runRootOnlyV5Cli(argv, options = {}) {
  const root = options.projectRoot ?? ROOT;
  const output = options.writeStdout ?? ((value) => process.stdout.write(value));
  const errorOutput = options.writeStderr ?? ((value) => process.stderr.write(value));
  let temporaryDirectory;
  let lock;
  let lockPath;
  let child;
  let interrupted = false;
  let primaryError;
  let summary;
  let buildInputs;
  const sourceAbort = new AbortController();
  const onSignal = () => { interrupted = true; sourceAbort.abort(); child?.kill("SIGTERM"); };
  const assertNotInterrupted = () => { if (interrupted) fail("SETTINGS_V5_INTERRUPTED"); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const mode = parseRootOnlyV5Arguments(argv);
    if (!SOURCE_MARKERS.every((path) => existsSync(join(root, path)))) fail("SETTINGS_V5_REQUIRES_SOURCE_CHECKOUT");
    const target = join(root, "catalog/runtime/v5/beeble-root-only-result.json");
    if (mode === "check" && !existsSync(target)) fail("SETTINGS_V5_RESULT_MISSING");
    if (mode !== "check" && existsSync(target)) fail("SETTINGS_V5_RESULT_EXISTS");
    let buildRoot = join(root, "dist");
    if (mode !== "check") {
      buildInputs = await fingerprintBuildInputs(root);
      await mkdir(join(root, ".черновики"), { recursive: true });
      if (mode === "sync-source") {
        lockPath = join(root, ".черновики/settings-v5-beeble-sync.lock");
        lock = await acquireSyncLock(lockPath);
        if (existsSync(target)) fail("SETTINGS_V5_RESULT_EXISTS");
      }
      assertNotInterrupted();
      temporaryDirectory = await mkdtemp(join(root, ".черновики/v5-root-build-"));
      buildRoot = temporaryDirectory;
      await new Promise((resolve, reject) => {
        child = execFile(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(root, "tsconfig.json"), "--outDir", buildRoot],
          { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
          (error) => { child = undefined; error ? reject({ code: "SETTINGS_V5_BUILD_FAILED" }) : resolve(); });
      });
      if (await fingerprintBuildInputs(root) !== buildInputs) fail("SETTINGS_V5_BUILD_INPUT_DRIFT");
    }
    assertNotInterrupted();
    if (!existsSync(join(buildRoot, "tools/settings-ir/v5/root-only-result-toolchain.js"))) fail("SETTINGS_V5_REQUIRES_BUILD");
    const moduleUrl = (path) => pathToFileURL(join(buildRoot, path)).href;
    const resultModule = await import(moduleUrl("src/catalog/settings-root-only-result-v5.js"));
    const toolchain = await import(moduleUrl("tools/settings-ir/v5/root-only-result-toolchain.js"));
    let result;
    if (mode === "check") {
      const text = await readFile(target, "utf8");
      result = resultModule.loadRootOnlyResultV5(text);
      if (text !== resultModule.serializeRootOnlyResultV5(result)) fail("SETTINGS_V5_RESULT_INVALID");
      toolchain.assertRootOnlyResultV5MatchesCurrentCheckout(result, root);
    } else {
      result = await toolchain.buildRootOnlyResultV5FromPinnedSource({ projectRoot: root, formId: "beeble", confirmedSourceFetch: true, signal: sourceAbort.signal });
      assertNotInterrupted();
      if (await fingerprintBuildInputs(root) !== buildInputs) fail("SETTINGS_V5_BUILD_INPUT_DRIFT");
      if (mode === "sync-source") {
        const text = resultModule.serializeRootOnlyResultV5(result);
        const { createImmutableJsonSnapshot } = await import(moduleUrl("tools/settings-ir/immutable-json-snapshot.js"));
        await createImmutableJsonSnapshot(target, text, { maxBytes: 1024 * 1024 });
        if (await readFile(target, "utf8") !== text) fail("SETTINGS_V5_READBACK_FAILED");
      }
    }
    assertNotInterrupted();
    summary = `${JSON.stringify({ mode, form_id: "beeble", runtime_usable: result.runtime_usable,
      compilation_status: result.compilation_status, coverage: result.coverage,
      closure: result.closure.status, root_binding_statuses: result.root_results.map((entry) => ({
        model_id: entry.model_id,
        bindings: Object.fromEntries(Object.entries(entry.bindings).map(([name, binding]) => [name, binding.status]))
      })) })}\n`;
  } catch (error) {
    primaryError = interrupted ? "SETTINGS_V5_INTERRUPTED" : safeCode(error);
  } finally {
    // Only paths actually owned by this invocation are released. A canceled
    // tsc has exited before this finally block; no background writer survives.
    if (lock !== undefined) {
      try { await releaseSyncLock(lock, lockPath); } catch { primaryError = "SETTINGS_V5_CLEANUP_FAILED"; }
    }
    if (temporaryDirectory !== undefined) {
      try { await rm(temporaryDirectory, { recursive: true, force: true }); } catch { primaryError = "SETTINGS_V5_CLEANUP_FAILED"; }
    }
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
  if (primaryError) {
    errorOutput(`Settings v5 failed: ${primaryError}. Reconcile any target before retrying a sync.\n`);
    return 1;
  }
  output(summary);
  return 0;
}

// Source-checkout maintenance only. Pair isolated output with the same bounded
// input bytes before/after tsc and again before publication. This detects normal
// concurrent edits, not a malicious writer that changes and restores bytes (ABA).
async function fingerprintBuildInputs(root) {
  try {
    const paths = ["package.json", "package-lock.json", "tsconfig.json",
      "scripts/settings-v5-root-only.mjs", "scripts/sync-normalized-settings-parser-generic-form-result.mjs",
      "scripts/lock-signal-cleanup.mjs"];
    let visited = 0;
    async function visit(relative, depth = 0) {
      if (++visited > 4096 || depth > 16) fail("SETTINGS_V5_BUILD_INPUT_INVALID");
      const path = join(root, relative);
      const info = await lstat(path);
      if (info.isSymbolicLink()) fail("SETTINGS_V5_BUILD_INPUT_INVALID");
      if (info.isDirectory()) {
        for (const name of (await readdir(path)).sort()) await visit(`${relative}/${name}`, depth + 1);
      } else if (info.isFile() && relative.endsWith(".ts")) paths.push(relative);
    }
    for (const directory of ["src", "tools", "tests"]) await visit(directory);
    const hash = createHash("sha256");
    let total = 0;
    for (const relative of paths.sort()) {
      const path = join(root, relative);
      const info = await lstat(path);
      if (!info.isFile() || info.size > 12 * 1024 * 1024) fail("SETTINGS_V5_BUILD_INPUT_INVALID");
      const bytes = await readFile(path);
      total += bytes.byteLength;
      if (total > 32 * 1024 * 1024) fail("SETTINGS_V5_BUILD_INPUT_INVALID");
      hash.update(JSON.stringify([relative, bytes.byteLength]));
      hash.update(bytes);
    }
    return hash.digest("hex");
  } catch { fail("SETTINGS_V5_BUILD_INPUT_INVALID"); }
}

function safeCode(error) { return SAFE_CODES.has(error?.code) ? error.code : "SETTINGS_V5_TOOLCHAIN_INVALID"; }
function fail(code) { throw { code }; }
function isDirect(path) {
  try { return Boolean(path) && realpathSync(path) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isDirect(process.argv[1])) process.exitCode = await runRootOnlyV5Cli(process.argv.slice(2));
