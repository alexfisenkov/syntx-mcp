// Cooperative filesystem lock for --sync-source: create-once acquire/release
// plus the five __testOnly* seams that
// tests/normalized-settings-parser-source-backed-cli.test.ts drives directly
// via `import(mainScriptUrl + "?test-only")` (the main file re-exports all
// five — see its own header).

import { mkdir, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { hasErrorCode, SourceBackedResultCliError } from "./errors.mjs";
import { lockPath } from "./paths.mjs";

export async function acquireSyncLock() {
  return __testOnlyAcquireSyncLock({
    lockPath,
    makeDirectory: (path) => mkdir(path, { recursive: true }),
    openExclusive: (path) => open(path, "wx", 0o600),
    unlinkPath: unlink,
  });
}

// pid/now are on the io seam (with real defaults) rather than hardcoded so
// tests/normalized-settings-parser-source-backed-cli.test.ts's existing
// __testOnlyAcquireSyncLock error-path calls keep working unchanged — they
// exercise chmod/mkdir failures, never reach this write, and never pass
// pid/now themselves.
export async function __testOnlyAcquireSyncLock(io) {
  const pid = io.pid ?? process.pid;
  const now = io.now ?? (() => new Date());
  let handle;
  try {
    await io.makeDirectory(dirname(io.lockPath));
    handle = await io.openExclusive(io.lockPath);
    await handle.chmod(0o600);
    // DEBT-015: an empty lock file gives a stuck SOURCE_RESULT_LOCKED no way
    // to tell a live run from a crash leftover. PID + ISO start time let
    // whoever hits the lock decide whether to wait or investigate.
    await handle.writeFile(`${pid}\n${now().toISOString()}\n`, "utf8");
    return handle;
  } catch (error) {
    if (handle !== undefined) {
      let cleanupFailed = false;
      try {
        await handle.close();
      } catch {
        cleanupFailed = true;
      }
      try {
        await io.unlinkPath(io.lockPath);
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) {
        throw new SourceBackedResultCliError(
          "SOURCE_RESULT_LOCK_CLEANUP_FAILED",
        );
      }
    }
    if (hasErrorCode(error, "EEXIST")) {
      throw new SourceBackedResultCliError("SOURCE_RESULT_LOCKED");
    }
    throw new SourceBackedResultCliError("SOURCE_RESULT_LOCK_FAILED");
  }
}

export async function releaseSyncLock(handle, onReleased) {
  return __testOnlyReleaseSyncLock(handle, unlink, lockPath, onReleased);
}

export async function __testOnlyReleaseSyncLock(handle, unlinkPath, path, onReleased) {
  let closeFailed = false;
  try {
    await handle.close();
  } catch {
    closeFailed = true;
  }
  try {
    await unlinkPath(path);
    // Fired the instant the lock file is actually gone, not after this
    // function (or its caller __testOnlyFinalizeSyncOperation) fully
    // returns — round-2 critic-code found that clearing a
    // signalState.lockPath reference only after the whole finalize call
    // returned left it dangling (pointing at an already-removed file) on
    // the code path where finalize succeeds at releasing but then still
    // rethrows the original operationError. A signal landing in that
    // window would either report a false cleanup failure or, worse, unlink
    // whatever a different, faster concurrent process had since created at
    // the same path.
    onReleased?.();
  } catch {
    throw new SourceBackedResultCliError("SOURCE_RESULT_LOCK_CLEANUP_FAILED");
  }
  if (closeFailed) {
    throw new SourceBackedResultCliError("SOURCE_RESULT_LOCK_CLEANUP_FAILED");
  }
}

export function __testOnlyLockCleanupCode(targetCreated) {
  return targetCreated
    ? "SOURCE_RESULT_OUTCOME_UNKNOWN_RECONCILE_TARGET_AND_LOCK"
    : "SOURCE_RESULT_LOCK_CLEANUP_FAILED";
}

export async function __testOnlyFinalizeSyncOperation(
  lock,
  operationError,
  targetCreated,
  release,
  onReleased,
) {
  let releaseFailed = false;
  try {
    await release(lock, onReleased);
  } catch {
    releaseFailed = true;
  }
  if (hasErrorCode(operationError, "IMMUTABLE_SNAPSHOT_CLEANUP_FAILED")) {
    throw new SourceBackedResultCliError(
      "SOURCE_RESULT_OUTCOME_UNKNOWN_RECONCILE_TARGET_AND_LOCK",
    );
  }
  if (releaseFailed) {
    throw new SourceBackedResultCliError(
      __testOnlyLockCleanupCode(targetCreated),
    );
  }
  if (operationError !== undefined) throw operationError;
}
