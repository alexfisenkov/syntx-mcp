import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const SCRIPT_NAME = "sync-normalized-settings-parser-source-backed-result.mjs";
const SCRIPT_PATH = join("scripts", SCRIPT_NAME);
const LOCK_SIGNAL_CLEANUP_PATH = join("scripts", "lock-signal-cleanup.mjs");
const CENSUS_PATH = join(
  "catalog",
  "runtime",
  "v2",
  "normalized-settings-parser-census-manifest.json",
);
const PARSER_PATH = join(
  "catalog",
  "runtime",
  "v1",
  "normalized-settings-parser-canary.json",
);
const SOURCE_MARKERS = [
  "tsconfig.json",
  "tsconfig.source-backed-build.json",
  "src/catalog/normalized-settings-parser-source-backed-result.ts",
  "src/catalog/normalized-settings-parser-census-manifest.ts",
  "src/catalog/normalized-settings-parser-canary.ts",
  "src/catalog/settings-source-inventory.ts",
  "src/catalog/syntx-public-catalog.ts",
  "tools/settings-ir/source-backed-result-toolchain.ts",
  "tools/settings-ir/immutable-json-snapshot.ts",
  "tools/settings-ir/build-banana-parser-canary.ts",
  "tools/settings-ir/pinned-settings-source-loader.ts",
  "tools/settings-ir/static-settings-compiler.ts",
  "node_modules/typescript/bin/tsc",
  "node_modules/typescript/lib/typescript.js",
];
const ERROR_PREFIX = "Normalized settings source-backed C1a failed: ";

test("C1a CLI syntax is valid and only four explicit modes are accepted", () => {
  const syntax = spawnSync(process.execPath, ["--check", SCRIPT_PATH], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(syntax.status, 0, syntax.stderr);

  for (const argumentsValue of [
    [],
    ["--invalid"],
    ["--check", "extra"],
    ["--probe"],
    ["--sync"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, ...argumentsValue],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${ERROR_PREFIX}INVALID_ARGUMENT.\n`);
  }
});

test("real symlink execution resolves the CLI entrypoint before main", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-c1a-symlink-"));
  const linkPath = join(root, "syntx-settings-source-backed");
  try {
    await symlink(resolve(SCRIPT_PATH), linkPath);
    const result = spawnSync(process.execPath, [linkPath, "--invalid"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${ERROR_PREFIX}INVALID_ARGUMENT.\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed-like package rejects every source mode before import, build, lock, or network", async () => {
  await withFixture(async ({ root, scriptPath }) => {
    for (const mode of ["--probe-source", "--check-source", "--sync-source"]) {
      const result = spawnSync(
        process.execPath,
        [scriptPath, mode, "--confirm-source-fetch"],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(
        result.stderr,
        `${ERROR_PREFIX}SOURCE_MODE_REQUIRES_SOURCE_CHECKOUT.\n`,
      );
    }
    assert.equal(await pathExists(join(root, "catalog/runtime/v3")), false);
    assert.equal(await pathExists(join(root, ".черновики")), false);
  });
});

test("every network source mode without the confirm flag is rejected before any other check", async () => {
  await withFixture(async ({ root, scriptPath }) => {
    for (const mode of ["--probe-source", "--check-source", "--sync-source"]) {
      const result = spawnSync(process.execPath, [scriptPath, mode], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `${ERROR_PREFIX}INVALID_ARGUMENT.\n`);
    }
    for (const mode of ["--probe-source", "--check-source", "--sync-source"]) {
      const wrongOrder = spawnSync(
        process.execPath,
        [scriptPath, "--confirm-source-fetch", mode],
        { cwd: root, encoding: "utf8", timeout: 10_000 },
      );
      assert.equal(wrongOrder.status, 1);
      assert.equal(wrongOrder.stderr, `${ERROR_PREFIX}INVALID_ARGUMENT.\n`);
    }
    assert.equal(await pathExists(join(root, "catalog/runtime/v3")), false);
    assert.equal(await pathExists(join(root, ".черновики")), false);
  });
});

test("--check never requires or accepts the confirm-source-fetch flag", async () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--check", "--confirm-source-fetch"],
    { encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `${ERROR_PREFIX}INVALID_ARGUMENT.\n`);
});

test("probe refuses an existing immutable result before temporary build or network", async () => {
  await withFixture(async ({ root, scriptPath }) => {
    await createSourceMarkers(root);
    const targetPath = join(
      root,
      "catalog/runtime/v3/normalized-settings-parser-source-backed-result.json",
    );
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "preserve me\n", "utf8");

    const result = spawnSync(
      process.execPath,
      [scriptPath, "--probe-source", "--confirm-source-fetch"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      `${ERROR_PREFIX}SOURCE_RESULT_ALREADY_EXISTS.\n`,
    );
    assert.equal(await readFile(targetPath, "utf8"), "preserve me\n");
    assert.equal(await pathExists(join(root, ".черновики")), false);
  });
});

test("source check refuses a missing result before temporary build or network", async () => {
  await withFixture(async ({ root, scriptPath }) => {
    await createSourceMarkers(root);
    const result = spawnSync(
      process.execPath,
      [scriptPath, "--check-source", "--confirm-source-fetch"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${ERROR_PREFIX}SOURCE_RESULT_MISSING.\n`);
    assert.equal(await pathExists(join(root, ".черновики")), false);
  });
});

test("sync respects a preexisting cooperative lock before temporary build or network", async () => {
  await withFixture(async ({ root, scriptPath }) => {
    await createSourceMarkers(root);
    const lockPath = join(
      root,
      "catalog/runtime/v3/normalized-settings-parser-source-backed-result.json.lock",
    );
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "held\n", { encoding: "utf8", mode: 0o600 });

    const result = spawnSync(
      process.execPath,
      [scriptPath, "--sync-source", "--confirm-source-fetch"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    // DEBT-015: the lock path is now named in this one error's stderr so a
    // human hitting a stuck lock knows where to look, without a general
    // free-text error-detail channel for every code.
    assert.equal(
      result.stderr,
      `${ERROR_PREFIX}SOURCE_RESULT_LOCKED.\nLock path: ${lockPath}\n` +
        "The lock file's first line is the PID that created it, the second its ISO start time. " +
        "If that PID is no longer running, the lock is stale and safe to remove by hand.\n",
    );
    assert.equal(await readFile(lockPath, "utf8"), "held\n");
    assert.equal(await pathExists(join(root, ".черновики")), false);
  });
});

test("an installed-like source guard preserves exact C0 and Gate B bytes", async () => {
  const censusBefore = await readFile(CENSUS_PATH);
  const parserBefore = await readFile(PARSER_PATH);
  await withFixture(async ({ root, scriptPath }) => {
    const guarded = spawnSync(
      process.execPath,
      [scriptPath, "--check-source", "--confirm-source-fetch"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.equal(guarded.status, 1);
    assert.equal(guarded.stdout, "");
    assert.equal(
      guarded.stderr,
      `${ERROR_PREFIX}SOURCE_MODE_REQUIRES_SOURCE_CHECKOUT.\n`,
    );
    assert.equal(await pathExists(join(root, ".черновики")), false);
  });
  assert.deepEqual(await readFile(CENSUS_PATH), censusBefore);
  assert.deepEqual(await readFile(PARSER_PATH), parserBefore);
});

const SOURCE_BACKED_RESULT_MODULE_DIR = join(
  "scripts",
  "source-backed-result",
);

// Discovered from disk, not hardcoded: a module added to this directory
// later is automatically pulled into both the fetch/retry-ban text scan
// below and the installed-like fixture copy in withFixture(). A hardcoded
// list would silently stop covering new files — exactly the risk this
// module split was reviewed against.
async function sourceBackedResultModulePaths(): Promise<string[]> {
  const entries = await readdir(SOURCE_BACKED_RESULT_MODULE_DIR);
  const modulePaths = entries
    .filter((entry) => entry.endsWith(".mjs"))
    .sort()
    .map((entry) => join(SOURCE_BACKED_RESULT_MODULE_DIR, entry));
  assert.ok(
    modulePaths.length >= 6,
    `expected at least 6 modules in ${SOURCE_BACKED_RESULT_MODULE_DIR}, found ${modulePaths.length}`,
  );
  return [SCRIPT_PATH, ...modulePaths];
}

test("source modes use a unique temporary outDir and contain no direct fetch or retry loop", async () => {
  const modulePaths = await sourceBackedResultModulePaths();
  const sources = await Promise.all(
    modulePaths.map((path) => readFile(path, "utf8")),
  );
  const combined = sources.join("\n");
  assert.equal(combined.includes("mkdtemp(sourceBuildPrefix)"), true);
  assert.equal(combined.includes('"--outDir"'), true);
  assert.equal(combined.includes("npm run build"), false);
  assert.equal(combined.includes("globalThis.fetch"), false);
  assert.equal(combined.includes("fetch("), false);
  assert.equal(combined.includes("Promise.all([\n      fetch"), false);
  assert.equal(combined.includes("retry"), false);
  assert.equal(
    combined.includes("buildBananaSourceBackedResultFromPinnedSource"),
    true,
  );
  assert.equal(combined.includes("createImmutableJsonSnapshot"), true);
});

test("test-only lock seam writes PID and ISO start time on the happy path (DEBT-015)", async () => {
  const lockModule = await import(
    `${pathToFileURL(resolve(SCRIPT_PATH)).href}?test-only`
  );
  let written: string | undefined;
  const fixedNow = new Date("2026-09-04T12:00:00.000Z");
  const handle = await lockModule.__testOnlyAcquireSyncLock({
    lockPath: "/tmp/syntx-c1a-test-happy.lock",
    makeDirectory: async () => undefined,
    openExclusive: async () => ({
      chmod: async () => undefined,
      writeFile: async (data: string) => {
        written = data;
      },
    }),
    unlinkPath: async () => undefined,
    pid: 4242,
    now: () => fixedNow,
  });
  assert.equal(written, "4242\n2026-09-04T12:00:00.000Z\n");
  assert.equal(handle.chmod !== undefined, true);
});

test("test-only lock seams clean chmod failures and report cleanup failures", async () => {
  const lockModule = await import(
    `${pathToFileURL(resolve(SCRIPT_PATH)).href}?test-only`
  );
  let closed = 0;
  let unlinked = 0;
  await assert.rejects(
    () =>
      lockModule.__testOnlyAcquireSyncLock({
        lockPath: "/tmp/syntx-c1a-test.lock",
        makeDirectory: async () => undefined,
        openExclusive: async () => ({
          chmod: async () => {
            throw Object.assign(new Error("chmod"), { code: "EIO" });
          },
          close: async () => {
            closed += 1;
          },
        }),
        unlinkPath: async () => {
          unlinked += 1;
        },
      }),
    (error: unknown) =>
      (error as { code?: unknown }).code === "SOURCE_RESULT_LOCK_FAILED",
  );
  assert.equal(
    lockModule.__testOnlyLockCleanupCode(true),
    "SOURCE_RESULT_OUTCOME_UNKNOWN_RECONCILE_TARGET_AND_LOCK",
  );
  assert.equal(closed, 1);
  assert.equal(unlinked, 1);

  await assert.rejects(
    () =>
      lockModule.__testOnlyAcquireSyncLock({
        lockPath: "/tmp/syntx-c1a-test.lock",
        makeDirectory: async () => {
          throw new Error("mkdir");
        },
        openExclusive: async () => {
          throw new Error("must not open");
        },
        unlinkPath: async () => undefined,
      }),
    (error: unknown) =>
      (error as { code?: unknown }).code === "SOURCE_RESULT_LOCK_FAILED",
  );

  for (const cleanup of ["close", "unlink"]) {
    await assert.rejects(
      () =>
        lockModule.__testOnlyAcquireSyncLock({
          lockPath: "/tmp/syntx-c1a-test.lock",
          makeDirectory: async () => undefined,
          openExclusive: async () => ({
            chmod: async () => {
              throw new Error("chmod");
            },
            close: async () => {
              if (cleanup === "close") throw new Error("close");
            },
          }),
          unlinkPath: async () => {
            if (cleanup === "unlink") throw new Error("unlink");
          },
        }),
      (error: unknown) =>
        (error as { code?: unknown }).code ===
        "SOURCE_RESULT_LOCK_CLEANUP_FAILED",
    );
  }

  await assert.rejects(
    () =>
      lockModule.__testOnlyReleaseSyncLock(
        { close: async () => undefined },
        async () => {
          throw new Error("unlink");
        },
        "/tmp/syntx-c1a-test.lock",
      ),
    (error: unknown) =>
      (error as { code?: unknown }).code ===
      "SOURCE_RESULT_LOCK_CLEANUP_FAILED",
  );
  await assert.rejects(
    () =>
      lockModule.__testOnlyReleaseSyncLock(
        {
          close: async () => {
            throw new Error("close");
          },
        },
        async () => undefined,
        "/tmp/syntx-c1a-test.lock",
      ),
    (error: unknown) =>
      (error as { code?: unknown }).code ===
      "SOURCE_RESULT_LOCK_CLEANUP_FAILED",
  );
  await assert.rejects(
    () =>
      lockModule.__testOnlyFinalizeSyncOperation(
        {},
        undefined,
        true,
        async () => {
          throw new Error("release");
        },
      ),
    (error: unknown) =>
      (error as { code?: unknown }).code ===
      "SOURCE_RESULT_OUTCOME_UNKNOWN_RECONCILE_TARGET_AND_LOCK",
  );
  assert.equal(
    lockModule.__testOnlyIsDirectExecution(
      SCRIPT_PATH,
      pathToFileURL(resolve(SCRIPT_PATH)).href,
    ),
    true,
  );
  assert.equal(
    lockModule.__testOnlyIsDirectExecution(
      undefined,
      pathToFileURL(resolve(SCRIPT_PATH)).href,
    ),
    false,
  );
});

test("onReleased fires the instant unlink succeeds, even when finalize still rethrows afterward (DEBT-015 round 2)", async () => {
  // REGRESSION: an earlier version cleared the caller's signalState.lockPath
  // reference only after the whole __testOnlyFinalizeSyncOperation call
  // returned without throwing — leaving it dangling (pointing at an
  // already-removed lock file) on exactly the path exercised here: release
  // succeeds, but finalize still rethrows the original operationError
  // afterward. A signal landing in that window would misreport a stale
  // reference as still needing cleanup.
  const lockModule = await import(
    `${pathToFileURL(resolve(SCRIPT_PATH)).href}?test-only`
  );
  let released = false;
  await assert.rejects(
    () =>
      lockModule.__testOnlyFinalizeSyncOperation(
        {},
        new Error("some unrelated operation failure"),
        false,
        async (_lock: unknown, onReleased?: () => void) => {
          onReleased?.();
        },
        () => {
          released = true;
        },
      ),
    /some unrelated operation failure/u,
  );
  assert.equal(released, true);
});

test("immutable snapshot cleanup uncertainty dominates every lock release outcome", async () => {
  const lockModule = await import(
    `${pathToFileURL(resolve(SCRIPT_PATH)).href}?test-only-finalization`
  );

  for (const releaseFails of [false, true]) {
    let releaseAttempts = 0;
    await assert.rejects(
      () =>
        lockModule.__testOnlyFinalizeSyncOperation(
          {},
          Object.assign(new Error("snapshot cleanup"), {
            code: "IMMUTABLE_SNAPSHOT_CLEANUP_FAILED",
          }),
          false,
          async () => {
            releaseAttempts += 1;
            if (releaseFails) throw new Error("release");
          },
        ),
      (error: unknown) =>
        (error as { code?: unknown }).code ===
        "SOURCE_RESULT_OUTCOME_UNKNOWN_RECONCILE_TARGET_AND_LOCK",
    );
    assert.equal(releaseAttempts, 1);
  }
});

test("withTemporarySourceRuntime refuses an unconfirmed or unknown-mode call before any I/O", async () => {
  const buildModule = await import(
    `${pathToFileURL(resolve(join("scripts", "source-backed-result", "build.mjs"))).href}?test-only`
  );
  const before = await readdir(SOURCE_BACKED_RESULT_MODULE_DIR);

  await assert.rejects(
    () => buildModule.withTemporarySourceRuntime("check-source"),
    (error: unknown) =>
      (error as { code?: unknown }).code === "SOURCE_FETCH_NOT_CONFIRMED",
  );
  await assert.rejects(
    () =>
      buildModule.withTemporarySourceRuntime("check-source", {
        confirmedSourceFetch: false,
      }),
    (error: unknown) =>
      (error as { code?: unknown }).code === "SOURCE_FETCH_NOT_CONFIRMED",
  );
  await assert.rejects(
    () =>
      buildModule.withTemporarySourceRuntime("not-a-real-mode", {
        confirmedSourceFetch: true,
      }),
    (error: unknown) =>
      (error as { code?: unknown }).code === "INVALID_ARGUMENT",
  );

  // Other test files may use .черновики/ concurrently for their own temp
  // builds, so only check that this call did not create its own
  // c1a-source-build-* directory — not that the whole folder is empty.
  if (await pathExists(join(".черновики"))) {
    const entries = await readdir(".черновики");
    assert.deepEqual(
      entries.filter((entry) => entry.startsWith("c1a-source-build-")),
      [],
    );
  }
  assert.deepEqual(await readdir(SOURCE_BACKED_RESULT_MODULE_DIR), before);
});

async function withFixture(
  callback: (fixture: { root: string; scriptPath: string }) => Promise<void>,
): Promise<void> {
  // Canonicalized once here so every path this test derives from root
  // (including the ones it compares against the spawned script's own
  // self-reported paths) agrees with what the script's import.meta.url ->
  // fileURLToPath(../../) resolves to. On macOS, tmpdir() returns a path
  // under /var, which is itself a symlink to /private/var — Node's ESM
  // loader reports the realpath-resolved form, so an uncanonicalized root
  // here would make any exact string comparison against the script's own
  // reported paths spuriously fail.
  const root = await realpath(await mkdtemp(join(tmpdir(), "syntx-c1a-cli-")));
  const scriptPath = join(root, "scripts", SCRIPT_NAME);
  await mkdir(dirname(scriptPath), { recursive: true });
  await copyFile(SCRIPT_PATH, scriptPath);
  // Sibling to SCRIPT_PATH, not under source-backed-result/ — a real
  // import the script needs, easy to miss in an installed-like fixture
  // copy that otherwise only knows about that one subdirectory (this is
  // exactly the gap that made this fixture briefly diverge from the real
  // npm package.json "files" allowlist when the file was first added).
  await copyFile(
    LOCK_SIGNAL_CLEANUP_PATH,
    join(root, LOCK_SIGNAL_CLEANUP_PATH),
  );
  const moduleDir = join(root, "scripts", "source-backed-result");
  await mkdir(moduleDir, { recursive: true });
  const modulePaths = await sourceBackedResultModulePaths();
  for (const modulePath of modulePaths) {
    if (modulePath === SCRIPT_PATH) continue;
    await copyFile(modulePath, join(root, modulePath));
  }
  try {
    await callback({ root, scriptPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createSourceMarkers(root: string): Promise<void> {
  for (const relativePath of SOURCE_MARKERS) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "marker\n", "utf8");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "EISDIR"
    ) {
      return true;
    }
    return false;
  }
}
