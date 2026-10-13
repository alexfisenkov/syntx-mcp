import assert from "node:assert/strict";
import { open } from "node:fs/promises";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  IMMUTABLE_JSON_SNAPSHOT_MAX_BYTES,
  ImmutableJsonSnapshotError,
  createImmutableJsonSnapshot,
  type ImmutableJsonSnapshotTestIo,
} from "../tools/settings-ir/immutable-json-snapshot.js";

const TEMPORARY_ID = "22222222-2222-4222-8222-222222222222";
const TEMPORARY_NAME = `.syntx-immutable-json-snapshot-${TEMPORARY_ID}.tmp`;

test("creates an immutable snapshot with 0644 mode and reads Unicode back", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-immutable-json-"));
  const target = join(root, "каталог с пробелом", "результат 🧭.json");
  const contents = '{"title":"модели 🖼️"}\n';
  try {
    await createImmutableJsonSnapshot(target, contents);

    assert.equal(await readFile(target, "utf8"), contents);
    assert.equal((await stat(target)).mode & 0o777, 0o644);
    assert.deepEqual(await readdir(join(root, "каталог с пробелом")), [
      "результат 🧭.json",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves a preexisting target byte-for-byte", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-immutable-existing-"));
  const target = join(root, "snapshot.json");
  const original = Buffer.from([0x00, 0x01, 0xfe, 0xff]);
  try {
    await writeFile(target, original);

    await assert.rejects(
      createImmutableJsonSnapshot(target, "replacement\n"),
      hasSafeError("IMMUTABLE_SNAPSHOT_TARGET_EXISTS"),
    );

    assert.deepEqual(await readFile(target), original);
    assert.deepEqual(await readdir(root), ["snapshot.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("two concurrent creators publish exactly one immutable target", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-immutable-concurrent-"));
  const target = join(root, "snapshot.json");
  const candidates = ["first payload\n", "second payload\n"] as const;
  try {
    const results = await Promise.allSettled(
      candidates.map((contents) =>
        createImmutableJsonSnapshot(target, contents),
      ),
    );
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const rejection = rejected[0];
    assert.equal(rejection?.status, "rejected");
    if (rejection?.status === "rejected") {
      assert.equal(
        hasSafeError("IMMUTABLE_SNAPSHOT_TARGET_EXISTS")(rejection.reason),
        true,
      );
    }
    const published = await readFile(target, "utf8");
    assert.equal(
      candidates.some((candidate) => candidate === published),
      true,
    );
    assert.deepEqual(await readdir(root), ["snapshot.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("I/O failures return safe codes and clean only an owned temporary path", async (t) => {
  for (const failure of [
    "mkdir",
    "create",
    "mode",
    "write",
    "sync",
    "close",
    "link",
  ] as const) {
    await t.test(failure, async () => {
      const root = await mkdtemp(join(tmpdir(), `syntx-immutable-${failure}-`));
      const target = join(root, "snapshot.json");
      const sentinel = join(root, "unrelated.keep.tmp");
      const temporaryPath = join(root, TEMPORARY_NAME);
      const unlinkedPaths: string[] = [];
      try {
        await writeFile(sentinel, "do not remove\n", "utf8");

        await assert.rejects(
          createImmutableJsonSnapshot(target, "payload\n", {
            testIo: realIo({ failure, unlinkedPaths }),
          }),
          hasSafeError("IMMUTABLE_SNAPSHOT_WRITE_FAILED"),
        );

        await assert.rejects(stat(target), hasFsCode("ENOENT"));
        await assert.rejects(stat(temporaryPath), hasFsCode("ENOENT"));
        assert.equal(await readFile(sentinel, "utf8"), "do not remove\n");
        assert.deepEqual(
          unlinkedPaths,
          failure === "mkdir" || failure === "create" ? [] : [temporaryPath],
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("an unlink failure reports cleanup failure and leaves the created target intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-immutable-unlink-"));
  const target = join(root, "snapshot.json");
  const temporaryPath = join(root, TEMPORARY_NAME);
  const unlinkedPaths: string[] = [];
  try {
    await assert.rejects(
      createImmutableJsonSnapshot(target, "created bytes\n", {
        testIo: realIo({ failure: "unlink", unlinkedPaths }),
      }),
      hasSafeError("IMMUTABLE_SNAPSHOT_CLEANUP_FAILED"),
    );

    assert.equal(await readFile(target, "utf8"), "created bytes\n");
    assert.equal(await readFile(temporaryPath, "utf8"), "created bytes\n");
    assert.deepEqual(unlinkedPaths, [temporaryPath]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanup failure takes precedence while recovering from a write failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-immutable-cleanup-"));
  const target = join(root, "snapshot.json");
  const temporaryPath = join(root, TEMPORARY_NAME);
  try {
    await assert.rejects(
      createImmutableJsonSnapshot(target, "payload\n", {
        testIo: realIo({ failure: "write", unlinkFailure: true }),
      }),
      hasSafeError("IMMUTABLE_SNAPSHOT_CLEANUP_FAILED"),
    );

    await assert.rejects(stat(target), hasFsCode("ENOENT"));
    assert.equal((await stat(temporaryPath)).isFile(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exclusive temporary collision never deletes a path it does not own", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-immutable-collision-"));
  const target = join(root, "snapshot.json");
  const temporaryPath = join(root, TEMPORARY_NAME);
  const unlinkedPaths: string[] = [];
  try {
    await writeFile(temporaryPath, "preexisting temporary\n", "utf8");

    await assert.rejects(
      createImmutableJsonSnapshot(target, "payload\n", {
        testIo: realIo({ unlinkedPaths }),
      }),
      hasSafeError("IMMUTABLE_SNAPSHOT_TEMPORARY_COLLISION"),
    );

    await assert.rejects(stat(target), hasFsCode("ENOENT"));
    assert.equal(
      await readFile(temporaryPath, "utf8"),
      "preexisting temporary\n",
    );
    assert.deepEqual(unlinkedPaths, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed temporary IDs and hostile error-code getters stay redacted", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-immutable-redaction-"));
  const target = join(root, "snapshot.json");
  const hostileError = Object.defineProperty({}, "code", {
    get(): never {
      throw new Error("private /path and payload bytes");
    },
  });
  try {
    await assert.rejects(
      createImmutableJsonSnapshot(target, "payload\n", {
        testIo: {
          ...realIo({}),
          temporaryId(): string {
            return "../../not-an-id";
          },
        },
      }),
      hasSafeError("IMMUTABLE_SNAPSHOT_WRITE_FAILED"),
    );
    await assert.rejects(
      createImmutableJsonSnapshot(target, "payload\n", {
        testIo: {
          ...realIo({}),
          async createExclusive(): Promise<never> {
            throw hostileError;
          },
        },
      }),
      hasSafeError("IMMUTABLE_SNAPSHOT_WRITE_FAILED"),
    );

    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("UTF-8 byte bounds and invalid requests fail before filesystem effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "syntx-immutable-bounds-"));
  const absentParent = join(root, "must-not-exist");
  const target = join(absentParent, "snapshot.json");
  try {
    await createImmutableJsonSnapshot(target, "🧭", { maxBytes: 4 });
    assert.equal(await readFile(target, "utf8"), "🧭");

    const secondAbsentParent = join(root, "still-must-not-exist");
    const secondTarget = join(secondAbsentParent, "snapshot.json");
    await assert.rejects(
      createImmutableJsonSnapshot(secondTarget, "🧭", { maxBytes: 3 }),
      hasSafeError("IMMUTABLE_SNAPSHOT_CONTENT_TOO_LARGE"),
    );
    await assert.rejects(
      createImmutableJsonSnapshot("relative/snapshot.json", "{}\n"),
      hasSafeError("IMMUTABLE_SNAPSHOT_REQUEST_INVALID"),
    );
    await assert.rejects(
      createImmutableJsonSnapshot(secondTarget, "{}", {
        maxBytes: IMMUTABLE_JSON_SNAPSHOT_MAX_BYTES + 1,
      }),
      hasSafeError("IMMUTABLE_SNAPSHOT_REQUEST_INVALID"),
    );
    await assert.rejects(
      createImmutableJsonSnapshot(secondTarget, null as unknown as string),
      hasSafeError("IMMUTABLE_SNAPSHOT_REQUEST_INVALID"),
    );

    await assert.rejects(stat(secondAbsentParent), hasFsCode("ENOENT"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function realIo(options: {
  failure?:
    | "mkdir"
    | "create"
    | "mode"
    | "write"
    | "sync"
    | "close"
    | "link"
    | "unlink";
  unlinkFailure?: boolean;
  unlinkedPaths?: string[];
}): ImmutableJsonSnapshotTestIo {
  return {
    async makeDirectory(path): Promise<void> {
      if (options.failure === "mkdir") {
        throw new Error("injected mkdir failure with private detail");
      }
      await mkdir(path, { recursive: true });
    },
    async createExclusive(path, mode) {
      if (options.failure === "create") {
        throw new Error("injected create failure with private detail");
      }
      const handle = await open(path, "wx", mode);
      return {
        async setMode(requestedMode): Promise<void> {
          if (options.failure === "mode") {
            throw new Error("injected mode failure with private detail");
          }
          await handle.chmod(requestedMode);
        },
        async writeUtf8(contents): Promise<void> {
          if (options.failure === "write") {
            throw new Error("injected write failure with private detail");
          }
          await handle.writeFile(contents, "utf8");
        },
        async sync(): Promise<void> {
          if (options.failure === "sync") {
            throw new Error("injected sync failure with private detail");
          }
          await handle.sync();
        },
        async close(): Promise<void> {
          await handle.close();
          if (options.failure === "close") {
            throw new Error("injected close failure with private detail");
          }
        },
      };
    },
    async createHardLink(sourcePath, targetPath): Promise<void> {
      if (options.failure === "link") {
        throw new Error("injected link failure with private detail");
      }
      await link(sourcePath, targetPath);
    },
    async unlink(path): Promise<void> {
      options.unlinkedPaths?.push(path);
      if (options.failure === "unlink" || options.unlinkFailure === true) {
        throw new Error("injected unlink failure with private detail");
      }
      await unlink(path);
    },
    temporaryId(): string {
      return TEMPORARY_ID;
    },
  };
}

function hasSafeError(code: ImmutableJsonSnapshotError["code"]) {
  return (error: unknown): boolean => {
    assert.equal(error instanceof ImmutableJsonSnapshotError, true);
    const snapshotError = error as ImmutableJsonSnapshotError;
    assert.equal(snapshotError.name, "ImmutableJsonSnapshotError");
    assert.equal(snapshotError.code, code);
    assert.equal(
      snapshotError.message,
      "Immutable JSON snapshot creation was rejected.",
    );
    assert.equal(snapshotError.message.includes("snapshot.json"), false);
    assert.equal(snapshotError.message.includes("payload"), false);
    assert.equal(snapshotError.message.includes("injected"), false);
    assert.equal("cause" in snapshotError, false);
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
