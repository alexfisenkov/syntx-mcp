import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// scripts/*.mjs is plain JS, not compiled by tsc — resolved from the
// project root (the test process's cwd), matching the existing pattern in
// tests/normalized-settings-parser-{source-backed,generic-form-result}-cli.test.ts
// rather than a static relative import, which would resolve against this
// compiled test file's own location under dist/tests/ and fail to find it.
const { createLockSignalState, performLockSignalCleanup } = await import(
  pathToFileURL(resolve("scripts", "lock-signal-cleanup.mjs")).href
);

function fakeIo(overrides: Record<string, unknown> = {}) {
  return {
    unlinkPath: async () => undefined,
    removePath: async () => undefined,
    ...overrides
  };
}

test("acts on neither lock nor temp directory when this run never set either", async () => {
  const state = createLockSignalState();
  const unlinked: string[] = [];
  const removed: string[] = [];
  const outcome = await performLockSignalCleanup(
    state,
    fakeIo({
      unlinkPath: async (path: string) => {
        unlinked.push(path);
      },
      removePath: async (path: string) => {
        removed.push(path);
      }
    })
  );
  assert.deepEqual(unlinked, []);
  assert.deepEqual(removed, []);
  assert.equal(outcome.lockReleased, null);
  assert.equal(outcome.temporaryDirectoryRemoved, null);
});

test("removes exactly this run's own lock and temp directory, nothing else", async () => {
  const state = createLockSignalState();
  state.lockPath = "/tmp/example.lock";
  state.temporaryDirectory = "/tmp/c1b-generic-build-abc123";
  const unlinked: string[] = [];
  const removed: string[] = [];
  const outcome = await performLockSignalCleanup(
    state,
    fakeIo({
      unlinkPath: async (path: string) => {
        unlinked.push(path);
      },
      removePath: async (path: string) => {
        removed.push(path);
      }
    })
  );
  assert.deepEqual(unlinked, ["/tmp/example.lock"]);
  assert.deepEqual(removed, ["/tmp/c1b-generic-build-abc123"]);
  assert.equal(outcome.lockReleased, true);
  assert.equal(outcome.temporaryDirectoryRemoved, true);
});

test("never touches a sibling directory, even one with a similar name", async () => {
  // REGRESSION (round-2 critic review, 4 independent critics converged): an
  // earlier version swept every .черновики/ entry sharing a name prefix,
  // which would have destroyed a concurrent run's own isolated checkout for
  // a different --form-id, or a file a human deliberately set aside there.
  // This version never lists a directory or matches names at all — it can
  // only ever act on the one exact path this run itself recorded.
  const state = createLockSignalState();
  state.temporaryDirectory = "/tmp/c1b-generic-build-abc123";
  const removed: string[] = [];
  await performLockSignalCleanup(
    state,
    fakeIo({
      removePath: async (path: string) => {
        removed.push(path);
      }
    })
  );
  assert.deepEqual(removed, ["/tmp/c1b-generic-build-abc123"]);
});

test("does not unlink a lock this run never actually acquired", async () => {
  // REGRESSION (critic-risk): an earlier version's signal handler was
  // installed before the lock was acquired and unconditionally unlinked the
  // fixed lock path regardless of whether this process's own acquire ever
  // succeeded — capable of deleting a different, live process's lock.
  // state.lockPath being unset (this run never got that far) must mean no
  // unlink is attempted at all.
  const state = createLockSignalState();
  let unlinkCalled = false;
  await performLockSignalCleanup(
    state,
    fakeIo({
      unlinkPath: async () => {
        unlinkCalled = true;
      }
    })
  );
  assert.equal(unlinkCalled, false);
});

test("reports failure per component instead of a blanket success", async () => {
  const state = createLockSignalState();
  state.lockPath = "/tmp/example.lock";
  state.temporaryDirectory = "/tmp/c1b-generic-build-abc123";
  const outcome = await performLockSignalCleanup(
    state,
    fakeIo({
      unlinkPath: async () => {
        throw new Error("permission denied");
      },
      removePath: async () => undefined
    })
  );
  assert.equal(outcome.lockReleased, false);
  assert.equal(outcome.temporaryDirectoryRemoved, true);
});

test("a failed lock unlink does not prevent the temp-directory removal from being attempted", async () => {
  const state = createLockSignalState();
  state.lockPath = "/tmp/example.lock";
  state.temporaryDirectory = "/tmp/c1b-generic-build-abc123";
  const removed: string[] = [];
  await performLockSignalCleanup(
    state,
    fakeIo({
      unlinkPath: async () => {
        throw new Error("permission denied");
      },
      removePath: async (path: string) => {
        removed.push(path);
      }
    })
  );
  assert.deepEqual(removed, ["/tmp/c1b-generic-build-abc123"]);
});
