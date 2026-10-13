import assert from "node:assert/strict";
import { open } from "node:fs/promises";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ATOMIC_JSON_SNAPSHOT_MAX_BYTES,
  AtomicJsonSnapshotError,
  writeAtomicJsonSnapshot,
  type AtomicJsonSnapshotTestIo
} from "../tools/settings-ir/atomic-json-snapshot.js";

const TEMPORARY_ID = "11111111-1111-4111-8111-111111111111";
const TEMPORARY_NAME = `.syntx-json-snapshot-${TEMPORARY_ID}.tmp`;

test("writes a snapshot through a same-directory temporary file and reads it back", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-atomic-json-"));
  const target = join(root, "nested", "snapshot.json");
  const contents = '{"schema_version":"1.0.0"}\n';
  try {
    await writeAtomicJsonSnapshot(target, contents);

    assert.equal(await readFile(target, "utf8"), contents);
    assert.deepEqual(await readdir(join(root, "nested")), ["snapshot.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomically replaces an existing target", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-atomic-replace-"));
  const target = join(root, "snapshot.json");
  try {
    await writeFile(target, "old snapshot\n", "utf8");
    await writeAtomicJsonSnapshot(target, "new snapshot\n");

    assert.equal(await readFile(target, "utf8"), "new snapshot\n");
    assert.deepEqual(await readdir(root), ["snapshot.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("supports target paths containing spaces and Unicode", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-atomic-unicode-"));
  const target = join(root, "каталог с пробелом", "снимок моделей.json");
  const contents = '{"title":"модели 🖼️"}\n';
  try {
    await writeAtomicJsonSnapshot(target, contents);
    assert.equal(await readFile(target, "utf8"), contents);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("write, sync, and rename failures preserve the old target and clean only the owned temporary file", async (t) => {
  for (const failure of ["write", "sync", "rename"] as const) {
    await t.test(failure, async () => {
      const root = await mkdtemp(join(tmpdir(), `syntx-atomic-${failure}-`));
      const target = join(root, "snapshot.json");
      const sentinel = join(root, "unrelated.keep.tmp");
      const temporaryPath = join(root, TEMPORARY_NAME);
      const unlinkedPaths: string[] = [];
      try {
        await writeFile(target, "old snapshot bytes\n", "utf8");
        await writeFile(sentinel, "do not remove\n", "utf8");
        const originalTarget = await readFile(target);
        const io = realIo({ failure, unlinkedPaths });

        await assert.rejects(
          writeAtomicJsonSnapshot(target, "new snapshot bytes\n", {
            testIo: io
          }),
          hasSafeError("SNAPSHOT_WRITE_FAILED")
        );

        assert.deepEqual(await readFile(target), originalTarget);
        assert.equal(await readFile(sentinel, "utf8"), "do not remove\n");
        await assert.rejects(stat(temporaryPath), hasFsCode("ENOENT"));
        assert.deepEqual(unlinkedPaths, [temporaryPath]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("an exclusive-create collision never deletes the preexisting temporary path", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-atomic-collision-"));
  const target = join(root, "snapshot.json");
  const temporaryPath = join(root, TEMPORARY_NAME);
  const unlinkedPaths: string[] = [];
  try {
    await writeFile(target, "old target\n", "utf8");
    await writeFile(temporaryPath, "preexisting temporary\n", "utf8");

    await assert.rejects(
      writeAtomicJsonSnapshot(target, "replacement\n", {
        testIo: realIo({ unlinkedPaths })
      }),
      hasSafeError("SNAPSHOT_TEMPORARY_COLLISION")
    );

    assert.equal(await readFile(target, "utf8"), "old target\n");
    assert.equal(
      await readFile(temporaryPath, "utf8"),
      "preexisting temporary\n"
    );
    assert.deepEqual(unlinkedPaths, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports an owned-temporary cleanup failure without hiding the remaining file", async (t) => {
  for (const failure of ["write", "sync", "rename"] as const) {
    await t.test(failure, async () => {
      const root = await mkdtemp(
        join(tmpdir(), `syntx-atomic-cleanup-${failure}-`)
      );
      const target = join(root, "snapshot.json");
      const temporaryPath = join(root, TEMPORARY_NAME);
      const sentinel = join(root, "unrelated.keep.tmp");
      const unlinkedPaths: string[] = [];
      try {
        await writeFile(target, "old target bytes\n", "utf8");
        await writeFile(sentinel, "unrelated bytes\n", "utf8");
        const originalTarget = await readFile(target);

        await assert.rejects(
          writeAtomicJsonSnapshot(target, "replacement bytes\n", {
            testIo: realIo({
              failure,
              unlinkFailure: true,
              unlinkedPaths
            })
          }),
          hasSafeError("SNAPSHOT_CLEANUP_FAILED")
        );

        assert.deepEqual(await readFile(target), originalTarget);
        assert.equal(await readFile(sentinel, "utf8"), "unrelated bytes\n");
        assert.equal((await stat(temporaryPath)).isFile(), true);
        assert.deepEqual(unlinkedPaths, [temporaryPath]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("invalid requests and UTF-8 bounds fail before filesystem effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-atomic-invalid-"));
  const absentParent = join(root, "must-not-exist");
  const target = join(absentParent, "snapshot.json");
  try {
    await assert.rejects(
      writeAtomicJsonSnapshot("relative/snapshot.json", "{}\n"),
      hasSafeError("SNAPSHOT_REQUEST_INVALID")
    );
    await assert.rejects(
      writeAtomicJsonSnapshot(
        target,
        null as unknown as string
      ),
      hasSafeError("SNAPSHOT_REQUEST_INVALID")
    );
    await assert.rejects(
      writeAtomicJsonSnapshot(target, "🧭", { maxBytes: 3 }),
      hasSafeError("SNAPSHOT_CONTENT_TOO_LARGE")
    );
    await assert.rejects(
      writeAtomicJsonSnapshot(target, "{}", {
        maxBytes: ATOMIC_JSON_SNAPSHOT_MAX_BYTES + 1
      }),
      hasSafeError("SNAPSHOT_REQUEST_INVALID")
    );

    await assert.rejects(stat(absentParent), hasFsCode("ENOENT"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function realIo(options: {
  failure?: "write" | "sync" | "rename";
  unlinkFailure?: boolean;
  unlinkedPaths?: string[];
}): AtomicJsonSnapshotTestIo {
  return {
    async makeDirectory(path): Promise<void> {
      await mkdir(path, { recursive: true });
    },
    async createExclusive(path) {
      const handle = await open(path, "wx", 0o644);
      return {
        async writeUtf8(contents): Promise<void> {
          if (options.failure === "write") {
            throw new Error("injected write failure");
          }
          await handle.writeFile(contents, "utf8");
        },
        async sync(): Promise<void> {
          if (options.failure === "sync") {
            throw new Error("injected sync failure");
          }
          await handle.sync();
        },
        async close(): Promise<void> {
          await handle.close();
        }
      };
    },
    async rename(sourcePath, targetPath): Promise<void> {
      if (options.failure === "rename") {
        throw new Error("injected rename failure");
      }
      const { rename } = await import("node:fs/promises");
      await rename(sourcePath, targetPath);
    },
    async unlink(path): Promise<void> {
      options.unlinkedPaths?.push(path);
      if (options.unlinkFailure === true) {
        throw new Error("injected unlink failure");
      }
      await unlink(path);
    },
    temporaryId(): string {
      return TEMPORARY_ID;
    }
  };
}

function hasSafeError(code: AtomicJsonSnapshotError["code"]) {
  return (error: unknown): boolean => {
    assert.equal(error instanceof AtomicJsonSnapshotError, true);
    const snapshotError = error as AtomicJsonSnapshotError;
    assert.equal(snapshotError.name, "AtomicJsonSnapshotError");
    assert.equal(snapshotError.code, code);
    assert.equal(
      snapshotError.message,
      "Atomic JSON snapshot write was rejected."
    );
    assert.equal(snapshotError.message.includes("snapshot.json"), false);
    return true;
  };
}

function hasFsCode(code: string) {
  return (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code;
}
