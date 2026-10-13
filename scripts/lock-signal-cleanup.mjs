// Best-effort SIGINT/SIGTERM cleanup for THIS run's own cooperative lock and
// temporary source checkout — never anyone else's. An earlier version swept
// every entry under .черновики/ matching a shared name prefix; round-2
// critic review (4 independent critics: code/practice/skeptic/risk, all
// converged) found that BLOCK: the generic-form-result CLI's lock is
// per-form (two different --form-id syncs legitimately run at once, each
// with its own mkdtemp checkout, exactly the isolation this file's own
// header used to promise and the sweep silently broke), .черновики/ is a
// human working directory (AGENTS.md — "рабочее и отложенное") that can
// hold unrelated files a person set aside, and a malformed/relative prefix
// argument could in principle sweep an entire parent directory (critic-risk
// BLOCK-severity latent bug in the old prefix-slicing logic). critic-risk
// separately found the lock itself was released unconditionally, even by a
// process that never actually acquired it — capable of destroying a
// DIFFERENT, live process's lock.
//
// This version tracks mutable state the caller updates as it actually
// acquires/creates things, and only ever acts on exactly what THIS run
// owns: state.lockPath is set only after this run's own acquireSyncLock()
// call succeeds; state.temporaryDirectory is set to the exact mkdtemp()
// result, never a pattern. Nothing here reads a directory listing or
// matches names.
//
// Known residual (documented, not fixed here — see docs/проект/незакрыто.md
// DEBT-015): the temporary checkout's own `tsc` child process (spawned via
// execFileAsync in build.mjs / this CLI's buildTemporaryCheckout) is not
// tracked or killed on interrupt. A SIGTERM specifically (not a terminal
// Ctrl-C, which signals the whole process group) could let it keep writing
// to --outDir after this cleanup removes it, recreating a small, harmless,
// but not-swept-up leftover. Tracking that child's handle requires
// restructuring the promisified execFileAsync call in two files; deferred
// as a separate, smaller task rather than folded into this fix.

import { rm, unlink } from "node:fs/promises";

export function createLockSignalState() {
  return {
    lockPath: undefined,
    temporaryDirectory: undefined
  };
}

export async function performLockSignalCleanup(state, io = {}) {
  const unlinkPath = io.unlinkPath ?? unlink;
  const removePath =
    io.removePath ?? ((path) => rm(path, { recursive: true, force: true }));

  const outcome = { lockReleased: null, temporaryDirectoryRemoved: null };

  if (state.lockPath !== undefined) {
    try {
      await unlinkPath(state.lockPath);
      outcome.lockReleased = true;
    } catch {
      outcome.lockReleased = false;
    }
  }
  if (state.temporaryDirectory !== undefined) {
    try {
      await removePath(state.temporaryDirectory);
      outcome.temporaryDirectoryRemoved = true;
    } catch {
      outcome.temporaryDirectoryRemoved = false;
    }
  }
  return outcome;
}

/**
 * Registers the actual process signal handlers. Call once per CLI
 * invocation, before this run's own lock/temp-directory work begins, with a
 * `state` object (createLockSignalState()) that the caller mutates in place
 * as it actually acquires the lock and creates the temp checkout — the
 * handler reads whatever `state` holds at the moment a signal arrives, not
 * a snapshot taken at install time. Not itself unit-tested (a thin,
 * untestable-by-design wrapper around process.on/process.exit) —
 * performLockSignalCleanup above carries all the real logic and is tested
 * directly with injected fs functions.
 */
export function installLockSignalCleanup(state) {
  const handleSignal = (signal) => {
    // Written and its callback awaited before cleanup starts: on some
    // platforms stderr writes to a pipe are asynchronous, and a
    // process.exit() issued too soon can drop a message that was never
    // actually flushed (round-2 critic-code WARN).
    process.stderr.write(
      `Interrupted (${signal}) — cleaning up (do not interrupt again until this finishes)...\n`,
      () => {
        performLockSignalCleanup(state)
          .catch(() => ({ lockReleased: false, temporaryDirectoryRemoved: false }))
          .then((outcome) => {
            const lockLine =
              state.lockPath === undefined
                ? "No lock was held."
                : outcome.lockReleased
                  ? "Lock released."
                  : `Lock release FAILED — remove by hand: ${state.lockPath}`;
            const tempLine =
              state.temporaryDirectory === undefined
                ? "No temporary checkout existed."
                : outcome.temporaryDirectoryRemoved
                  ? "Temporary checkout removed."
                  : `Temporary checkout cleanup FAILED — remove by hand: ${state.temporaryDirectory}`;
            process.stderr.write(`${lockLine} ${tempLine}\n`, () => {
              process.exit(1);
            });
          });
      }
    );
  };
  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
}
