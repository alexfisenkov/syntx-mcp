import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { types } from "node:util";
import { StandardImageReferencePreparationError } from "./standard-image-reference-preparation.js";
import { OWNER_STANDARD_IMAGE_VARIANTS, type OwnerStandardImageVariant } from "./owner-standard-image-request-preparer.js";
import { OwnerStandardImageUploadServiceError, type OwnerStandardImageUploadReceipt, type OwnerStandardImageUploadService } from "./owner-standard-image-upload-service.js";

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const BANANA21_SOURCE_BYTES = 20 * 1024 * 1024;
const STANDARD_VARIANTS: ReadonlySet<string> = new Set(OWNER_STANDARD_IMAGE_VARIANTS);
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".avif": "image/avif", ".heic": "image/heic", ".heif": "image/heif"
});

export interface LocalImagePreparation {
  readonly applied: boolean;
  readonly original_bytes: number;
  readonly prepared_bytes: number;
  readonly original_width?: number;
  readonly original_height?: number;
  readonly prepared_width?: number;
  readonly prepared_height?: number;
  readonly original_mime_type?: string;
  readonly prepared_mime_type?: string;
}

export interface PreparedStandardImageReference {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: string;
  readonly preparation: LocalImagePreparation;
}

export type PrepareStandardImageReference = (
  input: { readonly bytes: Uint8Array; readonly filename: string; readonly mime_type: string; readonly variant: OwnerStandardImageVariant },
  options: { readonly ffmpegPath?: string; readonly autoCompress: boolean },
  signal?: AbortSignal
) => Promise<PreparedStandardImageReference>;

export interface OwnerLocalImageFileServiceOptions {
  readonly roots: readonly string[];
  readonly uploadService: Pick<OwnerStandardImageUploadService, "assertLinkedAttempt" | "upload">;
  readonly prepare: PrepareStandardImageReference;
  readonly ffmpegPath?: string;
  readonly max_source_bytes?: number;
}

export interface OwnerLocalImageFileUploadInput {
  readonly attemptId: string;
  readonly variant: OwnerStandardImageVariant;
  readonly absolute_path: string;
  readonly auto_compress?: boolean;
  readonly signal?: AbortSignal;
}

export interface OwnerLocalImageFileUploadResult {
  readonly receipt: OwnerStandardImageUploadReceipt;
  readonly preparation: LocalImagePreparation;
  readonly filename: string;
}

export type OwnerLocalImageFileErrorCode = "INVALID_REQUEST" | "PATH_NOT_ALLOWED" | "FILE_UNAVAILABLE" |
  "FILE_TOO_LARGE" | "FILE_CHANGED" | "REQUEST_ABORTED" | "PREPARATION_FAILED" | "PREPARATION_UNAVAILABLE";

export class OwnerLocalImageFileServiceError extends Error {
  constructor(readonly code: OwnerLocalImageFileErrorCode) {
    super("The local image file could not be uploaded safely.");
    this.name = "OwnerLocalImageFileServiceError";
  }
}

/** Owner-local filesystem bridge. Caller-supplied paths are constrained by operator-configured roots. */
export class OwnerLocalImageFileService {
  readonly #roots: readonly string[];
  readonly #uploadService: OwnerLocalImageFileServiceOptions["uploadService"];
  readonly #prepare: PrepareStandardImageReference;
  readonly #ffmpegPath: string | undefined;
  readonly #maxSourceBytes: number;

  constructor(optionsInput: OwnerLocalImageFileServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["roots", "uploadService", "prepare", "ffmpegPath", "max_source_bytes"]);
    const uploadService = fields.uploadService as Record<string, unknown> | undefined;
    if (!Array.isArray(fields.roots) || fields.roots.length < 1 || fields.roots.length > 16 ||
        fields.roots.some((root) => typeof root !== "string" || !isAbsolute(root) || root.includes("\0")) ||
        !uploadService || typeof uploadService !== "object" || types.isProxy(uploadService) ||
        typeof uploadService.assertLinkedAttempt !== "function" || typeof uploadService.upload !== "function" ||
        typeof fields.prepare !== "function" ||
        (fields.ffmpegPath !== undefined && (typeof fields.ffmpegPath !== "string" || !isAbsolute(fields.ffmpegPath))) ||
        (fields.max_source_bytes !== undefined && (!Number.isSafeInteger(fields.max_source_bytes) ||
          (fields.max_source_bytes as number) < 1 || (fields.max_source_bytes as number) > MAX_SOURCE_BYTES))) invalid();
    this.#roots = Object.freeze((fields.roots as string[]).map((root) => resolve(root)));
    this.#uploadService = fields.uploadService as OwnerLocalImageFileServiceOptions["uploadService"];
    this.#prepare = fields.prepare as PrepareStandardImageReference;
    this.#ffmpegPath = fields.ffmpegPath as string | undefined;
    this.#maxSourceBytes = fields.max_source_bytes as number | undefined ?? MAX_SOURCE_BYTES;
  }

  async upload(input: OwnerLocalImageFileUploadInput | unknown): Promise<OwnerLocalImageFileUploadResult> {
    const request = snapshotInput(input);
    // Authorization is deliberately first: failed attempts must not probe or resolve filesystem paths.
    try { await this.#uploadService.assertLinkedAttempt(request.attemptId, request.signal); }
    catch (error) {
      if (error instanceof OwnerStandardImageUploadServiceError) throw error;
      fail(request.signal?.aborted ? "REQUEST_ABORTED" : "FILE_UNAVAILABLE");
    }
    throwIfAborted(request.signal);

    let bytes: Uint8Array | undefined;
    let prepared: PreparedStandardImageReference | undefined;
    try {
      const { canonicalPath, filename } = await this.#resolveAllowedFile(request.absolute_path);
      const variantLimit = request.variant === "banana-2.1" ? BANANA21_SOURCE_BYTES : this.#maxSourceBytes;
      bytes = await readStableFile(canonicalPath, variantLimit, request.signal);
      const mime_type = MIME_BY_EXTENSION[extname(filename).toLowerCase()];
      if (mime_type === undefined) fail("PREPARATION_FAILED");
      try {
        prepared = await this.#prepare({ bytes, filename, mime_type, variant: request.variant },
          { ...(this.#ffmpegPath === undefined ? {} : { ffmpegPath: this.#ffmpegPath }), autoCompress: request.auto_compress }, request.signal);
      } catch (error) {
        if (request.signal?.aborted || (error instanceof StandardImageReferencePreparationError && error.code === "IMAGE_PREPARATION_ABORTED")) fail("REQUEST_ABORTED");
        if (error instanceof StandardImageReferencePreparationError && error.code === "IMAGE_PREPARATION_UNAVAILABLE") fail("PREPARATION_UNAVAILABLE");
        fail("PREPARATION_FAILED");
      }
      throwIfAborted(request.signal);
      const validPrepared = validatePrepared(prepared, bytes.byteLength);
      const receipt = await this.#uploadService.upload({ attemptId: request.attemptId, variant: request.variant,
        content_base64: Buffer.from(validPrepared.bytes).toString("base64"), filename: validPrepared.filename,
        mime_type: validPrepared.mime_type, ...(request.signal === undefined ? {} : { signal: request.signal }) });
      return Object.freeze({ receipt, preparation: validPrepared.preparation, filename: validPrepared.filename });
    } finally {
      bytes?.fill(0);
      if (prepared?.bytes instanceof Uint8Array && !types.isProxy(prepared.bytes)) prepared.bytes.fill(0);
    }
  }

  async #resolveAllowedFile(inputPath: string): Promise<{ canonicalPath: string; filename: string }> {
    const normalizedInput = resolve(inputPath);
    if (!this.#roots.some((root) => isWithin(root, normalizedInput))) fail("PATH_NOT_ALLOWED");
    let canonicalPath: string;
    let roots: string[];
    try {
      canonicalPath = await realpath(normalizedInput);
      roots = await Promise.all(this.#roots.map((root) => realpath(root)));
    } catch { fail("FILE_UNAVAILABLE"); }
    if (!roots.some((root) => isWithin(root, canonicalPath))) fail("PATH_NOT_ALLOWED");
    try { if ((await lstat(normalizedInput)).isSymbolicLink()) fail("PATH_NOT_ALLOWED"); }
    catch (error) { if (error instanceof OwnerLocalImageFileServiceError) throw error; fail("FILE_UNAVAILABLE"); }
    return { canonicalPath, filename: basename(canonicalPath) };
  }
}

async function readStableFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let output: Buffer | undefined;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n) fail("FILE_UNAVAILABLE");
    if (before.size > BigInt(maxBytes)) fail("FILE_TOO_LARGE");
    output = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < output.byteLength) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(output, offset, output.byteLength - offset, offset);
      if (bytesRead < 1) fail("FILE_CHANGED");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) fail("FILE_CHANGED");
    throwIfAborted(signal);
    const result = new Uint8Array(output);
    output.fill(0);
    output = undefined;
    return result;
  } catch (error) {
    output?.fill(0);
    if (error instanceof OwnerLocalImageFileServiceError) throw error;
    if (signal?.aborted) fail("REQUEST_ABORTED");
    fail("FILE_UNAVAILABLE");
  } finally { await handle?.close().catch(() => undefined); }
  fail("FILE_UNAVAILABLE");
}

function snapshotInput(input: unknown): Required<Pick<OwnerLocalImageFileUploadInput, "attemptId" | "variant" | "absolute_path" | "auto_compress">> &
  Pick<OwnerLocalImageFileUploadInput, "signal"> {
  const fields = exactRecord(input, ["attemptId", "variant", "absolute_path", "auto_compress", "signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.variant !== "string" || !STANDARD_VARIANTS.has(fields.variant) ||
      typeof fields.absolute_path !== "string" || !isAbsolute(fields.absolute_path) ||
      fields.absolute_path.length > 4096 || fields.absolute_path.includes("\0") || fields.absolute_path.split(sep).includes("..") ||
      (fields.auto_compress !== undefined && typeof fields.auto_compress !== "boolean") ||
      (fields.signal !== undefined && (!(fields.signal instanceof AbortSignal) || types.isProxy(fields.signal)))) invalid();
  return { attemptId: fields.attemptId, variant: fields.variant as OwnerStandardImageVariant,
    absolute_path: fields.absolute_path, auto_compress: fields.auto_compress !== false,
    ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }) };
}

function validatePrepared(value: unknown, originalBytes: number): PreparedStandardImageReference {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("PREPARATION_FAILED");
  const fields = exactRecord(value, ["bytes", "filename", "mime_type", "preparation"]);
  if (!(fields.bytes instanceof Uint8Array) || types.isProxy(fields.bytes) || fields.bytes.byteLength < 1 ||
      fields.bytes.byteLength > MAX_SOURCE_BYTES || typeof fields.filename !== "string" ||
      fields.filename.length < 1 || /[\/\\\p{Cc}\p{Cf}\p{Cs}]/u.test(fields.filename) ||
      Buffer.byteLength(fields.filename, "utf8") > 255 || typeof fields.mime_type !== "string" ||
      !fields.preparation || typeof fields.preparation !== "object" || types.isProxy(fields.preparation)) fail("PREPARATION_FAILED");
  const prep = exactRecord(fields.preparation, ["applied", "original_bytes", "prepared_bytes", "original_width", "original_height",
    "prepared_width", "prepared_height", "original_mime_type", "prepared_mime_type"]);
  if (typeof prep.applied !== "boolean" || prep.original_bytes !== originalBytes || prep.prepared_bytes !== fields.bytes.byteLength ||
      (prep.original_width !== undefined && !positiveInt(prep.original_width)) ||
      (prep.original_height !== undefined && !positiveInt(prep.original_height)) ||
      (prep.prepared_width !== undefined && !positiveInt(prep.prepared_width)) ||
      (prep.prepared_height !== undefined && !positiveInt(prep.prepared_height)) ||
      (prep.original_mime_type !== undefined && typeof prep.original_mime_type !== "string") ||
      (prep.prepared_mime_type !== undefined && typeof prep.prepared_mime_type !== "string")) fail("PREPARATION_FAILED");
  return Object.freeze({ bytes: fields.bytes, filename: fields.filename, mime_type: fields.mime_type,
    preparation: Object.freeze({ applied: prep.applied, original_bytes: prep.original_bytes, prepared_bytes: prep.prepared_bytes,
      ...(prep.original_width === undefined ? {} : { original_width: prep.original_width }),
      ...(prep.original_height === undefined ? {} : { original_height: prep.original_height }),
      ...(prep.prepared_width === undefined ? {} : { prepared_width: prep.prepared_width }),
      ...(prep.prepared_height === undefined ? {} : { prepared_height: prep.prepared_height }),
      ...(prep.original_mime_type === undefined ? {} : { original_mime_type: prep.original_mime_type }),
      ...(prep.prepared_mime_type === undefined ? {} : { prepared_mime_type: prep.prepared_mime_type }) }) });
}

function exactRecord(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!))) invalid();
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function isWithin(root: string, path: string): boolean { const rel = relative(root, path); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); }
function positiveInt(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) fail("REQUEST_ABORTED"); }
function invalid(): never { return fail("INVALID_REQUEST"); }
function fail(code: OwnerLocalImageFileErrorCode): never { throw new OwnerLocalImageFileServiceError(code); }
