#!/usr/bin/env node

// Thin CLI entry point for Gate C1a's source-backed settings result.
// Logic lives in ./source-backed-result/{errors,paths,lock,runtime-loader,
// build,cli-support}.mjs — this file only wires them together in main(),
// re-exports the __testOnly* seams those modules need for direct testing,
// and guards the auto-run-on-direct-execution entry point at the bottom.
// See docs/проект/решения.md, D-036, for why this file was split up.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createLockSignalState, installLockSignalCleanup } from "./lock-signal-cleanup.mjs";
import { safeErrorCode, SourceBackedResultCliError } from "./source-backed-result/errors.mjs";
import { buildDiagnosticsPath, lockPath, targetPath } from "./source-backed-result/paths.mjs";
import {
  __testOnlyAcquireSyncLock,
  __testOnlyFinalizeSyncOperation,
  __testOnlyLockCleanupCode,
  __testOnlyReleaseSyncLock,
  acquireSyncLock,
  releaseSyncLock,
} from "./source-backed-result/lock.mjs";
import {
  runOfflineCheck,
  withTemporarySourceRuntime,
} from "./source-backed-result/build.mjs";
import {
  __testOnlyIsDirectExecution,
  hasSourceCheckout,
  parseArguments,
  printSafeSummary,
} from "./source-backed-result/cli-support.mjs";

// Re-exported so `import(new URL(import.meta.url) + "?test-only")` on this
// file keeps working for tests that exercise the lock/execution-guard seams
// directly — see tests/normalized-settings-parser-source-backed-cli.test.ts.
export {
  __testOnlyAcquireSyncLock,
  __testOnlyFinalizeSyncOperation,
  __testOnlyLockCleanupCode,
  __testOnlyReleaseSyncLock,
  __testOnlyIsDirectExecution,
};

async function main() {
  const mode = parseArguments(process.argv.slice(2));

  // Installed packages may validate the reviewed result offline. Every mode
  // that can build, fetch, lock, or write fails before project imports and
  // before network when the full source checkout is absent.
  if (mode !== "check" && !hasSourceCheckout()) {
    throw new SourceBackedResultCliError(
      "SOURCE_MODE_REQUIRES_SOURCE_CHECKOUT",
    );
  }

  if (mode === "check") {
    await runOfflineCheck();
    return;
  }
  if (mode === "probe-source" && existsSync(targetPath)) {
    throw new SourceBackedResultCliError("SOURCE_RESULT_ALREADY_EXISTS");
  }
  if (mode === "check-source" && !existsSync(targetPath)) {
    throw new SourceBackedResultCliError("SOURCE_RESULT_MISSING");
  }
  if (mode === "sync-source" && existsSync(targetPath)) {
    throw new SourceBackedResultCliError("SOURCE_RESULT_ALREADY_EXISTS");
  }

  // Installed before any lock/temp-directory work, for every network mode
  // (not just sync-source — probe-source and check-source also build a
  // temporary checkout via withTemporarySourceRuntime below): a
  // SIGINT/SIGTERM any time from here on now cleans up exactly what THIS
  // run itself created, tracked via signalState as it happens, rather than
  // leaving it behind for a human to find and remove by hand (DEBT-015).
  // signalState.lockPath is set below only once this run's own
  // acquireSyncLock() call actually succeeds — never unconditionally
  // (round-2 critic-risk: an earlier version could unlink a DIFFERENT,
  // live process's lock).
  const signalState = createLockSignalState();
  installLockSignalCleanup(signalState);

  let lock;
  let operationError;
  let targetCreated = false;
  try {
    if (mode === "sync-source") {
      lock = await acquireSyncLock();
      signalState.lockPath = lockPath;
      if (existsSync(targetPath)) {
        throw new SourceBackedResultCliError("SOURCE_RESULT_ALREADY_EXISTS");
      }
    }

    // parseArguments() above already required --confirm-source-fetch for
    // every mode that reaches this line; confirmedSourceFetch here is a
    // second, function-level gate in withTemporarySourceRuntime itself, not
    // a redundant duplicate of this one.
    const sourceRun = await withTemporarySourceRuntime(mode, {
      confirmedSourceFetch: true,
      signalState,
    });
    if (mode === "sync-source") {
      if (existsSync(targetPath)) {
        throw new SourceBackedResultCliError("SOURCE_RESULT_ALREADY_EXISTS");
      }
      await sourceRun.createImmutableJsonSnapshot(
        targetPath,
        sourceRun.candidateText,
        { maxBytes: 4 * 1024 * 1024 },
      );
      targetCreated = true;
      const recordedText = await readFile(targetPath, "utf8");
      if (recordedText !== sourceRun.candidateText) {
        throw new SourceBackedResultCliError("SOURCE_RESULT_READBACK_FAILED");
      }
      printSafeSummary("created", "PINNED_SOURCE", sourceRun.candidate);
    } else if (mode === "probe-source") {
      printSafeSummary("verified", "PINNED_SOURCE_PROBE", sourceRun.candidate);
    } else {
      printSafeSummary("unchanged", "PINNED_SOURCE", sourceRun.candidate);
    }
  } catch (error) {
    operationError = error;
  }

  if (lock !== undefined) {
    await __testOnlyFinalizeSyncOperation(
      lock,
      operationError,
      targetCreated,
      releaseSyncLock,
      () => {
        signalState.lockPath = undefined;
      },
    );
  } else if (operationError !== undefined) {
    throw operationError;
  }
}

const LOCK_RELATED_CODES = new Set([
  "SOURCE_RESULT_LOCKED",
  "SOURCE_RESULT_LOCK_CLEANUP_FAILED",
  "SOURCE_RESULT_OUTCOME_UNKNOWN_RECONCILE_TARGET_AND_LOCK",
]);

if (__testOnlyIsDirectExecution(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    const code = safeErrorCode(error);
    process.stderr.write(
      `Normalized settings source-backed C1a failed: ${code}.\n`,
    );
    // The lock path is a fixed, public, in-repo path — naming it for every
    // code where a lock might be the thing to go look at (not only the
    // simple "already locked" case, but also the two lock-adjacent
    // uncertainty codes), without adding a general free-text error-detail
    // channel that could leak more than a safe code was meant to (DEBT-015).
    // The lock file's first two lines are PID and ISO start time — if that
    // PID is no longer running (`ps -p <pid>`), the lock is stale and safe
    // to remove by hand.
    if (LOCK_RELATED_CODES.has(code)) {
      process.stderr.write(
        `Lock path: ${lockPath}\n` +
          "The lock file's first line is the PID that created it, the second its ISO start time. " +
          "If that PID is no longer running, the lock is stale and safe to remove by hand.\n",
      );
    }
    // DEBT-017: SOURCE_BUILD_FAILED is specifically the "tsc actually
    // rejected the source" case (timeout/output-too-large get their own
    // codes and carry no useful tsc output). The path is fixed and
    // always-overwritten; only named here if the best-effort write in
    // build.mjs actually left something to read.
    if (code === "SOURCE_BUILD_FAILED" && existsSync(buildDiagnosticsPath)) {
      process.stderr.write(`tsc output saved to: ${buildDiagnosticsPath}\n`);
    }
    process.exitCode = 1;
  });
}
