import { randomUUID } from "node:crypto";
import { link, mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, sep } from "node:path";

/**
 * Immutable source-backed results accept at most 64 MiB of serialized UTF-8.
 * Callers may lower this limit, but they cannot raise the process boundary.
 */
export const IMMUTABLE_JSON_SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024;

const SAFE_ERROR_MESSAGE = "Immutable JSON snapshot creation was rejected.";
const TEMPORARY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type ImmutableJsonSnapshotErrorCode =
  | "IMMUTABLE_SNAPSHOT_REQUEST_INVALID"
  | "IMMUTABLE_SNAPSHOT_CONTENT_TOO_LARGE"
  | "IMMUTABLE_SNAPSHOT_TEMPORARY_COLLISION"
  | "IMMUTABLE_SNAPSHOT_TARGET_EXISTS"
  | "IMMUTABLE_SNAPSHOT_CLEANUP_FAILED"
  | "IMMUTABLE_SNAPSHOT_WRITE_FAILED";

export class ImmutableJsonSnapshotError extends Error {
  readonly code: ImmutableJsonSnapshotErrorCode;

  constructor(code: ImmutableJsonSnapshotErrorCode) {
    super(SAFE_ERROR_MESSAGE);
    this.name = "ImmutableJsonSnapshotError";
    this.code = code;
  }
}

interface ImmutableJsonSnapshotHandle {
  setMode(mode: number): Promise<void>;
  writeUtf8(contents: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** @internal Narrow deterministic seam for filesystem failure tests only. */
export interface ImmutableJsonSnapshotTestIo {
  makeDirectory(path: string): Promise<void>;
  createExclusive(
    path: string,
    mode: number,
  ): Promise<ImmutableJsonSnapshotHandle>;
  createHardLink(sourcePath: string, targetPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  temporaryId(): string;
}

export interface CreateImmutableJsonSnapshotOptions {
  /** UTF-8 byte limit; defaults to and cannot exceed 64 MiB. */
  maxBytes?: number;
  /** @internal Tests only. Production callers must use the default I/O. */
  testIo?: ImmutableJsonSnapshotTestIo;
}

const DEFAULT_IO: ImmutableJsonSnapshotTestIo = {
  async makeDirectory(path): Promise<void> {
    await mkdir(path, { recursive: true });
  },
  async createExclusive(path, mode): Promise<ImmutableJsonSnapshotHandle> {
    const handle = await open(path, "wx", mode);
    return fileHandleAdapter(handle);
  },
  async createHardLink(sourcePath, targetPath): Promise<void> {
    await link(sourcePath, targetPath);
  },
  async unlink(path): Promise<void> {
    await unlink(path);
  },
  temporaryId(): string {
    return randomUUID();
  },
};

/**
 * Creates a JSON snapshot exactly once without replacing an existing target.
 *
 * The payload is written to an exclusive same-directory temporary file, its
 * mode is fixed to 0644, and the file is synced before an atomic hard-link
 * create publishes the final pathname. The owned temporary pathname is then
 * removed. The containing directory is not synced, so this helper does not
 * claim full durability across a host crash or sudden power loss.
 * `IMMUTABLE_SNAPSHOT_CLEANUP_FAILED` can mean that the final target was
 * created but its temporary hard-link pathname could not be removed; callers
 * must reconcile the target before deciding whether another operation is safe.
 *
 * This is create-once coordination for cooperative processes, not a security
 * boundary against an actor that can rename or replace entries in the target
 * directory. Callers must select a trusted directory that is not writable by
 * a different security principal.
 */
export async function createImmutableJsonSnapshot(
  targetPath: string,
  contents: string,
  options: CreateImmutableJsonSnapshotOptions = {},
): Promise<void> {
  const validated = safelyValidateRequest(targetPath, contents, options);
  const io = validated.io;
  let temporaryId: string;
  try {
    temporaryId = io.temporaryId();
  } catch {
    throw new ImmutableJsonSnapshotError("IMMUTABLE_SNAPSHOT_WRITE_FAILED");
  }
  if (
    typeof temporaryId !== "string" ||
    !TEMPORARY_ID_PATTERN.test(temporaryId)
  ) {
    throw new ImmutableJsonSnapshotError("IMMUTABLE_SNAPSHOT_WRITE_FAILED");
  }

  const targetDirectory = dirname(targetPath);
  const temporaryPath = join(
    targetDirectory,
    `.syntx-immutable-json-snapshot-${temporaryId}.tmp`,
  );
  let handle: ImmutableJsonSnapshotHandle | undefined;
  let ownsTemporaryPath = false;

  try {
    await io.makeDirectory(targetDirectory);
    try {
      handle = await io.createExclusive(temporaryPath, 0o644);
      ownsTemporaryPath = true;
    } catch (error) {
      throw new ImmutableJsonSnapshotError(
        hasErrorCode(error, "EEXIST")
          ? "IMMUTABLE_SNAPSHOT_TEMPORARY_COLLISION"
          : "IMMUTABLE_SNAPSHOT_WRITE_FAILED",
      );
    }

    await handle.setMode(0o644);
    await handle.writeUtf8(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;

    try {
      await io.createHardLink(temporaryPath, targetPath);
    } catch (error) {
      throw new ImmutableJsonSnapshotError(
        hasErrorCode(error, "EEXIST")
          ? "IMMUTABLE_SNAPSHOT_TARGET_EXISTS"
          : "IMMUTABLE_SNAPSHOT_WRITE_FAILED",
      );
    }
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
      handle = undefined;
    }
    if (ownsTemporaryPath) {
      try {
        await io.unlink(temporaryPath);
      } catch {
        throw new ImmutableJsonSnapshotError(
          "IMMUTABLE_SNAPSHOT_CLEANUP_FAILED",
        );
      }
    }
    if (error instanceof ImmutableJsonSnapshotError) {
      throw error;
    }
    throw new ImmutableJsonSnapshotError("IMMUTABLE_SNAPSHOT_WRITE_FAILED");
  }

  try {
    await io.unlink(temporaryPath);
  } catch {
    throw new ImmutableJsonSnapshotError("IMMUTABLE_SNAPSHOT_CLEANUP_FAILED");
  }
}

function safelyValidateRequest(
  targetPath: unknown,
  contents: unknown,
  options: unknown,
): { io: ImmutableJsonSnapshotTestIo } {
  try {
    return validateRequest(targetPath, contents, options);
  } catch (error) {
    if (error instanceof ImmutableJsonSnapshotError) {
      throw error;
    }
    throw new ImmutableJsonSnapshotError("IMMUTABLE_SNAPSHOT_REQUEST_INVALID");
  }
}

function validateRequest(
  targetPath: unknown,
  contents: unknown,
  options: unknown,
): { io: ImmutableJsonSnapshotTestIo } {
  if (
    typeof targetPath !== "string" ||
    targetPath.length === 0 ||
    targetPath.includes("\0") ||
    !isAbsolute(targetPath) ||
    !isFileTarget(targetPath) ||
    typeof contents !== "string" ||
    !isOptions(options)
  ) {
    throw new ImmutableJsonSnapshotError("IMMUTABLE_SNAPSHOT_REQUEST_INVALID");
  }

  const maxBytes = options.maxBytes ?? IMMUTABLE_JSON_SNAPSHOT_MAX_BYTES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > IMMUTABLE_JSON_SNAPSHOT_MAX_BYTES
  ) {
    throw new ImmutableJsonSnapshotError("IMMUTABLE_SNAPSHOT_REQUEST_INVALID");
  }
  if (Buffer.byteLength(contents, "utf8") > maxBytes) {
    throw new ImmutableJsonSnapshotError(
      "IMMUTABLE_SNAPSHOT_CONTENT_TOO_LARGE",
    );
  }

  const io = options.testIo ?? DEFAULT_IO;
  if (!isIo(io)) {
    throw new ImmutableJsonSnapshotError("IMMUTABLE_SNAPSHOT_REQUEST_INVALID");
  }
  return { io };
}

function isFileTarget(path: string): boolean {
  if (path.endsWith(sep)) {
    return false;
  }
  const segments = path.split(sep);
  const name = segments[segments.length - 1];
  return name !== undefined && name.length > 0 && name !== "." && name !== "..";
}

function isOptions(
  value: unknown,
): value is CreateImmutableJsonSnapshotOptions {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIo(value: unknown): value is ImmutableJsonSnapshotTestIo {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ImmutableJsonSnapshotTestIo>;
  return (
    typeof candidate.makeDirectory === "function" &&
    typeof candidate.createExclusive === "function" &&
    typeof candidate.createHardLink === "function" &&
    typeof candidate.unlink === "function" &&
    typeof candidate.temporaryId === "function"
  );
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  try {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === expectedCode
    );
  } catch {
    return false;
  }
}

function fileHandleAdapter(handle: FileHandle): ImmutableJsonSnapshotHandle {
  return {
    async setMode(mode): Promise<void> {
      await handle.chmod(mode);
    },
    async writeUtf8(contents): Promise<void> {
      await handle.writeFile(contents, "utf8");
    },
    async sync(): Promise<void> {
      await handle.sync();
    },
    async close(): Promise<void> {
      await handle.close();
    },
  };
}
