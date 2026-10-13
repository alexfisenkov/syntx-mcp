import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const SCRIPT_PATH = join("scripts", "sync-normalized-settings-parser-generic-form-result.mjs");
const ERROR_PREFIX = "Normalized settings generic form result failed: ";
// Not a real census form_id — used only so ALREADY_EXISTS/MISSING tests
// below can safely create and delete a fixture file at the real target
// path without touching or colliding with any real form's artifact.
const FIXTURE_FORM_ID = "zzz-test-fixture-only";
const FIXTURE_TARGET_PATH = join(
  "catalog",
  "runtime",
  "v4",
  `${FIXTURE_FORM_ID}-generic-form-result.json`
);

// Imported dynamically with a runtime string URL, not a static `import …
// from "….mjs"` — TypeScript has no declaration file for this plain-JS
// script and a static import fails typecheck (TS7016). The `?test-only`
// query string is load-bearing, not cosmetic: the script's own
// isDirectExecution() guard checks for it specifically (mirroring
// source-backed-result's __testOnlyIsDirectExecution) — importing without
// it would still correctly skip main() here (process.argv[1] is this test
// runner's own path, not the script's), but relying on that path
// inequality instead of the explicit marker is exactly the fragile
// coincidence this convention exists to avoid.
async function loadCliModule() {
  return import(`${pathToFileURL(resolve(SCRIPT_PATH)).href}?test-only`);
}

// This CLI has no exact-checkpoint pinning (the toolchain already does its
// own full cross-validation, D-043) but DOES build an isolated temporary
// tsc checkout for every network mode (mirroring source-backed-result's
// own pattern — round 1 critic-code found that rebuilding the shared
// dist/ in place was not exclusive against a concurrent `npm test`/`npm
// run build`, which could hash a truncated file into a create-once
// artifact with no error at all). This suite covers: argument parsing
// (order-independent --form-id, every gate before any I/O), the offline
// --check path, the cheap pre-build gates for network modes (ALREADY_EXISTS/
// MISSING/DEBT_036_UNRESOLVED — all reachable without a network fetch or
// even a temporary build), and the create-once lock/finalize primitives in
// isolation. It deliberately does NOT attempt a real network fetch: that
// requires an actual gated intent, a separate, deliberate, logged step per
// this project's own convention (D-035), not something to fake here.

test("rejects every malformed argument combination before any I/O", () => {
  for (const argumentsValue of [
    [],
    ["--check"],
    ["--form-id", "banana"],
    ["--check", "--form-id"],
    ["--invalid", "--form-id", "banana"],
    ["--probe", "--form-id", "banana"],
    ["--sync", "--form-id", "banana"],
    ["--check", "--confirm-source-fetch", "--form-id", "banana"]
  ]) {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, ...argumentsValue], {
      encoding: "utf8",
      timeout: 10_000
    });
    assert.equal(result.status, 1, JSON.stringify(argumentsValue));
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${ERROR_PREFIX}INVALID_ARGUMENT.\n`);
  }
});

test("every network mode without the confirm flag is rejected before any other check", () => {
  for (const mode of ["--probe-source", "--check-source", "--sync-source"]) {
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, mode, "--form-id", "banana"],
      { encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(result.status, 1);
    assert.equal(result.stderr, `${ERROR_PREFIX}INVALID_ARGUMENT.\n`);
  }
});

test("--form-id may appear before or after the mode flag, with identical observable behavior", () => {
  // FIXTURE_FORM_ID, not "banana" — see the identical reasoning on the
  // NOT_FOUND test above (round 1 critic-code WARN, Gate C1b step 7).
  const expected = `${ERROR_PREFIX}GENERIC_FORM_RESULT_NOT_FOUND.\n`;
  const before = spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--form-id", FIXTURE_FORM_ID, "--check"],
    { encoding: "utf8", timeout: 10_000 }
  );
  const after = spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--check", "--form-id", FIXTURE_FORM_ID],
    { encoding: "utf8", timeout: 10_000 }
  );
  // Both assert the SPECIFIC expected error, not just "both failed the same
  // way" — a regression that required --form-id to be last (the exact bug
  // class this test exists to catch) would still make both invocations
  // fail with the same INVALID_ARGUMENT, which the weaker "before.stderr
  // === after.stderr" version of this test would not have caught (round 1
  // critic-code WARN).
  assert.equal(before.status, 1);
  assert.equal(after.status, 1);
  assert.equal(before.stderr, expected);
  assert.equal(after.stderr, expected);
});

test("offline --check rejects an invalid form_id shape before touching the filesystem for it", () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--check", "--form-id", "../../etc/passwd"],
    { encoding: "utf8", timeout: 10_000 }
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, `${ERROR_PREFIX}GENERIC_FORM_ID_INVALID.\n`);
});

test("offline --check on a well-formed but not-yet-published form_id reports NOT_FOUND, not a raw filesystem error", () => {
  // FIXTURE_FORM_ID, not a real census form_id like "banana": D-045
  // published this project's first real v4 artifact (wan-video), and
  // "banana" — the project's own canonical example form — is a natural
  // candidate to be synced next. findGenericFormResultPath/
  // loadNormalizedSettingsParserGenericFormResult only validate the
  // form_id's SHAPE (formIdSchema, a plain regex), never look it up
  // against the census, so any well-formed id that will never actually
  // be published works here — and FIXTURE_FORM_ID (not a real census
  // form, never will be) can't go stale the way "banana" eventually
  // would (round 1 critic-code WARN, Gate C1b step 7).
  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--check", "--form-id", FIXTURE_FORM_ID],
    { encoding: "utf8", timeout: 10_000 }
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, `${ERROR_PREFIX}GENERIC_FORM_RESULT_NOT_FOUND.\n`);
});

test("network modes reject an invalid form_id shape before hasSourceCheckout, build, lock, or network", () => {
  for (const mode of ["--probe-source", "--check-source", "--sync-source"]) {
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, mode, "--confirm-source-fetch", "--form-id", "Not-Valid!"],
      { encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(result.status, 1, mode);
    assert.equal(result.stderr, `${ERROR_PREFIX}GENERIC_FORM_ID_INVALID.\n`, mode);
  }
});

// DEBT-036 was resolved by D-045 (docs/проект/решения.md) — the CLI's
// DEBT_036_RESOLVED constant is now permanently true, so there is no
// longer a safe way to black-box-test "the gate blocks while unresolved"
// via spawnSync: doing so for any real, eligible form_id (e.g. "banana")
// would now proceed straight through to a real network fetch attempt
// during `npm test`, which must never happen. A test that once lived here
// did exactly that by accident when this constant flipped — caught before
// ever running, not after. The gate's own logic (a single boolean check
// before throwing, positioned before any build/lock) is simple enough not
// to need dedicated coverage now that it is inert; its value going forward
// is as a mechanical pattern for the next module that shapes the artifact
// without being hash-bound, not as tested behavior today.

test("probe-source and check-source reject/require an existing target before any build or network", async () => {
  await mkdir(join("catalog", "runtime", "v4"), { recursive: true });
  await writeFile(FIXTURE_TARGET_PATH, "{}", "utf8");
  try {
    const probeResult = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--probe-source", "--confirm-source-fetch", "--form-id", FIXTURE_FORM_ID],
      { encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(probeResult.status, 1);
    assert.equal(probeResult.stderr, `${ERROR_PREFIX}GENERIC_RESULT_ALREADY_EXISTS.\n`);
  } finally {
    await unlink(FIXTURE_TARGET_PATH).catch(() => undefined);
  }

  const checkSourceResult = spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--check-source", "--confirm-source-fetch", "--form-id", FIXTURE_FORM_ID],
    { encoding: "utf8", timeout: 10_000 }
  );
  assert.equal(checkSourceResult.status, 1);
  assert.equal(checkSourceResult.stderr, `${ERROR_PREFIX}GENERIC_RESULT_MISSING.\n`);
});

test("parseArguments accepts the four documented modes and rejects everything else", async () => {
  const cli = await loadCliModule();
  assert.deepEqual(cli.parseArguments(["--check", "--form-id", "banana"]), {
    mode: "check",
    formId: "banana"
  });
  assert.deepEqual(
    cli.parseArguments(["--form-id", "banana", "--check"]),
    { mode: "check", formId: "banana" }
  );
  assert.deepEqual(
    cli.parseArguments(["--probe-source", "--confirm-source-fetch", "--form-id", "banana"]),
    { mode: "probe-source", formId: "banana" }
  );
  assert.deepEqual(
    cli.parseArguments(["--check-source", "--confirm-source-fetch", "--form-id", "banana"]),
    { mode: "check-source", formId: "banana" }
  );
  assert.deepEqual(
    cli.parseArguments(["--sync-source", "--confirm-source-fetch", "--form-id", "banana"]),
    { mode: "sync-source", formId: "banana" }
  );
  for (const badArgs of [
    ["--check", "--form-id", ""],
    ["--sync-source", "--form-id", "banana"],
    ["--sync-source", "--confirm-source-fetch", "--confirm-source-fetch", "--form-id", "banana"],
    ["--form-id", "--check"],
    ["--form-id", "banana", "--form-id", "banana", "--check"]
  ]) {
    assert.throws(() => cli.parseArguments(badArgs), (error: unknown) => {
      return (
        error instanceof Error &&
        (error as { code?: unknown }).code === "INVALID_ARGUMENT"
      );
    });
  }
});

test("safeErrorCode maps derive-layer and toolchain errors to their own codes, and never leaks a raw message", async () => {
  const cli = await loadCliModule();
  const deriveError = Object.assign(new Error("some raw internal detail"), {
    name: "GenericFormAdapterManifestDeriveError",
    code: "FORM_NOT_FOUND"
  });
  assert.equal(cli.safeErrorCode(deriveError), "FORM_NOT_FOUND");

  const unmappedDeriveError = Object.assign(new Error("raw detail"), {
    name: "GenericFormAdapterManifestDeriveError",
    code: "SOME_FUTURE_CODE_NOT_YET_ALLOWLISTED"
  });
  assert.equal(cli.safeErrorCode(unmappedDeriveError), "PINNED_SOURCE_VERIFICATION_FAILED");

  const compilerError = Object.assign(new Error("raw detail"), {
    name: "StaticSettingsCompilerError",
    code: "TYPESCRIPT_PARSE_FAILED"
  });
  assert.equal(cli.safeErrorCode(compilerError), "PINNED_SOURCE_VERIFICATION_FAILED");

  assert.equal(cli.safeErrorCode(new Error("totally unrelated failure")), "UNEXPECTED_ERROR");
  assert.equal(cli.safeErrorCode("not even an error object"), "UNEXPECTED_ERROR");
});

test("the create-once lock round-trips and rejects a second concurrent acquire", async () => {
  const cli = await loadCliModule();
  const directory = await mkdtemp(join(tmpdir(), "syntx-generic-lock-"));
  const lockPath = join(directory, "example-generic-form-result.json.lock");
  try {
    const handle = await cli.acquireSyncLock(lockPath);
    // DEBT-015: the lock file now records who is holding it, not just that
    // someone is — an empty lock file gives a stuck GENERIC_RESULT_LOCKED
    // no way to tell a live run from a crash leftover.
    const [pidLine, isoLine] = (await readFile(lockPath, "utf8")).split("\n");
    assert.equal(pidLine, String(process.pid));
    assert.doesNotThrow(() => {
      if (Number.isNaN(Date.parse(isoLine ?? ""))) throw new Error("not an ISO timestamp");
    });
    await assert.rejects(
      () => cli.acquireSyncLock(lockPath),
      (error: unknown) =>
        error instanceof Error &&
        (error as { code?: unknown; detail?: unknown }).code === "GENERIC_RESULT_LOCKED" &&
        (error as { detail?: unknown }).detail === lockPath
    );
    await cli.releaseSyncLock(handle, lockPath);
    // Released, so a fresh acquire now succeeds and must itself be released.
    const secondHandle = await cli.acquireSyncLock(lockPath);
    await cli.releaseSyncLock(secondHandle, lockPath);
    await assert.rejects(() => readFile(lockPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("finalizeSyncOperation reports reconcile-target-and-lock when a created target's lock release fails", async () => {
  const cli = await loadCliModule();
  const failingRelease = async () => {
    throw new Error("simulated release failure");
  };
  await assert.rejects(
    () => cli.finalizeSyncOperation({}, "/tmp/does-not-matter.lock", undefined, true, failingRelease),
    (error: unknown) =>
      error instanceof Error &&
      (error as { code?: unknown }).code ===
        "GENERIC_RESULT_OUTCOME_UNKNOWN_RECONCILE_TARGET_AND_LOCK"
  );
});

test("finalizeSyncOperation reports plain lock-cleanup-failed when nothing was created", async () => {
  const cli = await loadCliModule();
  const failingRelease = async () => {
    throw new Error("simulated release failure");
  };
  await assert.rejects(
    () => cli.finalizeSyncOperation({}, "/tmp/does-not-matter.lock", undefined, false, failingRelease),
    (error: unknown) =>
      error instanceof Error &&
      (error as { code?: unknown }).code === "GENERIC_RESULT_LOCK_CLEANUP_FAILED"
  );
});

test("finalizeSyncOperation still releases the lock and rethrows the original operation error on the happy path", async () => {
  const cli = await loadCliModule();
  let released = false;
  const release = async () => {
    released = true;
  };
  const operationError = new Error("the real failure the operation hit");
  await assert.rejects(
    () => cli.finalizeSyncOperation({}, "/tmp/does-not-matter.lock", operationError, false, release),
    (error: unknown) => error === operationError
  );
  assert.equal(released, true);
});

test("onReleased fires the instant unlink succeeds, even when finalize still rethrows afterward (DEBT-015 round 2)", async () => {
  // REGRESSION: an earlier version cleared the caller's signalState.lockPath
  // reference only after the whole finalizeSyncOperation call returned
  // without throwing — leaving it dangling (pointing at an already-removed
  // lock file) on exactly the path exercised here: release succeeds, but
  // finalize still rethrows the original operationError afterward.
  const cli = await loadCliModule();
  let onReleasedCalled = false;
  const release = async (
    _lock: unknown,
    _lockPath: unknown,
    onReleased?: () => void
  ) => {
    onReleased?.();
  };
  const operationError = new Error("some unrelated operation failure");
  await assert.rejects(
    () =>
      cli.finalizeSyncOperation(
        {},
        "/tmp/does-not-matter.lock",
        operationError,
        false,
        release,
        () => {
          onReleasedCalled = true;
        }
      ),
    (error: unknown) => error === operationError
  );
  assert.equal(onReleasedCalled, true);
});
