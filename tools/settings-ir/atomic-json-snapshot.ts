import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  rename,
  unlink,
  type FileHandle
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

/**
 * The source-only census writer accepts snapshots up to 64 MiB by default.
 * Callers may choose a smaller limit, but cannot raise this process boundary.
 */
export const ATOMIC_JSON_SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024;

const SAFE_ERROR_MESSAGE = "Atomic JSON snapshot write was rejected.";
const TEMPORARY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type AtomicJsonSnapshotErrorCode =
  | "SNAPSHOT_REQUEST_INVALID"
  | "SNAPSHOT_CONTENT_TOO_LARGE"
  | "SNAPSHOT_TEMPORARY_COLLISION"
  | "SNAPSHOT_CLEANUP_FAILED"
  | "SNAPSHOT_WRITE_FAILED";

export class AtomicJsonSnapshotError extends Error {
  readonly code: AtomicJsonSnapshotErrorCode;

  constructor(code: AtomicJsonSnapshotErrorCode) {
    super(SAFE_ERROR_MESSAGE);
    this.name = "AtomicJsonSnapshotError";
    this.code = code;
  }
}

interface AtomicJsonSnapshotHandle {
  writeUtf8(contents: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** @internal Narrow deterministic seam for filesystem failure tests only. */
export interface AtomicJsonSnapshotTestIo {
  makeDirectory(path: string): Promise<void>;
  createExclusive(path: string): Promise<AtomicJsonSnapshotHandle>;
  rename(sourcePath: string, targetPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  temporaryId(): string;
}

export interface WriteAtomicJsonSnapshotOptions {
  /** UTF-8 byte limit; defaults to and cannot exceed 64 MiB. */
  maxBytes?: number;
  /** @internal Tests only. Production callers must use the default I/O. */
  testIo?: AtomicJsonSnapshotTestIo;
}

const DEFAULT_IO: AtomicJsonSnapshotTestIo = {
  async makeDirectory(path): Promise<void> {
    await mkdir(path, { recursive: true });
  },
  async createExclusive(path): Promise<AtomicJsonSnapshotHandle> {
    const handle = await open(path, "wx", 0o644);
    return fileHandleAdapter(handle);
  },
  async rename(sourcePath, targetPath): Promise<void> {
    await rename(sourcePath, targetPath);
  },
  async unlink(path): Promise<void> {
    await unlink(path);
  },
  temporaryId(): string {
    return randomUUID();
  }
};

/**
 * Replaces one JSON snapshot through an exclusive, same-directory temporary
 * file and an atomic rename. The file itself is synced before rename. The
 * containing directory is not synced, so this does not claim full durability
 * across a host crash or sudden power loss.
 */
export async function writeAtomicJsonSnapshot(
  targetPath: string,
  contents: string,
  options: WriteAtomicJsonSnapshotOptions = {}
): Promise<void> {
  const validated = validateRequest(targetPath, contents, options);
  const io = validated.io;
  let temporaryId: string;
  try {
    temporaryId = io.temporaryId();
  } catch {
    throw new AtomicJsonSnapshotError("SNAPSHOT_WRITE_FAILED");
  }
  if (!TEMPORARY_ID_PATTERN.test(temporaryId)) {
    throw new AtomicJsonSnapshotError("SNAPSHOT_WRITE_FAILED");
  }

  const targetDirectory = dirname(targetPath);
  const temporaryPath = join(
    targetDirectory,
    `.syntx-json-snapshot-${temporaryId}.tmp`
  );
  let handle: AtomicJsonSnapshotHandle | undefined;
  let ownsTemporaryPath = false;
  let renameCompleted = false;
  let failureCode: AtomicJsonSnapshotErrorCode = "SNAPSHOT_WRITE_FAILED";

  try {
    await io.makeDirectory(targetDirectory);
    try {
      handle = await io.createExclusive(temporaryPath);
      ownsTemporaryPath = true;
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        failureCode = "SNAPSHOT_TEMPORARY_COLLISION";
      }
      throw error;
    }

    await handle.writeUtf8(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await io.rename(temporaryPath, targetPath);
    renameCompleted = true;
  } catch {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
      handle = undefined;
    }
    let cleanupFailed = false;
    if (ownsTemporaryPath && !renameCompleted) {
      try {
        await io.unlink(temporaryPath);
      } catch {
        cleanupFailed = true;
      }
    }
    throw new AtomicJsonSnapshotError(
      cleanupFailed ? "SNAPSHOT_CLEANUP_FAILED" : failureCode
    );
  }
}

function validateRequest(
  targetPath: unknown,
  contents: unknown,
  options: unknown
): { io: AtomicJsonSnapshotTestIo } {
  if (
    typeof targetPath !== "string" ||
    targetPath.length === 0 ||
    targetPath.includes("\0") ||
    !isAbsolute(targetPath) ||
    !isFileTarget(targetPath) ||
    typeof contents !== "string" ||
    !isOptions(options)
  ) {
    throw new AtomicJsonSnapshotError("SNAPSHOT_REQUEST_INVALID");
  }

  const maxBytes = options.maxBytes ?? ATOMIC_JSON_SNAPSHOT_MAX_BYTES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > ATOMIC_JSON_SNAPSHOT_MAX_BYTES
  ) {
    throw new AtomicJsonSnapshotError("SNAPSHOT_REQUEST_INVALID");
  }
  if (Buffer.byteLength(contents, "utf8") > maxBytes) {
    throw new AtomicJsonSnapshotError("SNAPSHOT_CONTENT_TOO_LARGE");
  }

  const io = options.testIo ?? DEFAULT_IO;
  if (!isIo(io)) {
    throw new AtomicJsonSnapshotError("SNAPSHOT_REQUEST_INVALID");
  }
  return { io };
}

function isFileTarget(path: string): boolean {
  const name = basename(path);
  return name.length > 0 && name !== "." && name !== "..";
}

function isOptions(value: unknown): value is WriteAtomicJsonSnapshotOptions {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIo(value: unknown): value is AtomicJsonSnapshotTestIo {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AtomicJsonSnapshotTestIo>;
  return (
    typeof candidate.makeDirectory === "function" &&
    typeof candidate.createExclusive === "function" &&
    typeof candidate.rename === "function" &&
    typeof candidate.unlink === "function" &&
    typeof candidate.temporaryId === "function"
  );
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === expectedCode
  );
}

function fileHandleAdapter(handle: FileHandle): AtomicJsonSnapshotHandle {
  return {
    async writeUtf8(contents): Promise<void> {
      await handle.writeFile(contents, "utf8");
    },
    async sync(): Promise<void> {
      await handle.sync();
    },
    async close(): Promise<void> {
      await handle.close();
    }
  };
}
