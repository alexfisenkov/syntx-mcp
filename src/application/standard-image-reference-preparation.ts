import { access, chmod, mkdtemp, open, readFile, realpath, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { constants as fsConstants } from "node:fs";
import { types } from "node:util";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { OWNER_STANDARD_IMAGE_VARIANTS, type OwnerStandardImageVariant } from "./owner-standard-image-request-preparer.js";
import { validateOwnerStandardImageUploadData } from "./owner-standard-image-input-validator.js";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";

const HARD_INPUT_BYTES = 64 * 1024 * 1024;
const BANANA_SOURCE_BYTES = 20 * 1024 * 1024;
const BANANA_TARGET_BYTES = 5 * 1024 * 1024;
const PIXEL_BUDGET = 52_500_000;
const MAX_EDGE = 8_000;
const PREPARATION_DEADLINE_MS = 45_000;
const MAX_ENCODE_ATTEMPTS = 8;
const STDERR_LIMIT = 4_096;
const TARGET_MARGIN = 64 * 1024;
const SAFE_FILENAME = /^[^/\\\p{Cc}\p{Cf}\p{Cs}]{1,255}$/u;

const PREPARATION_CATALOG_VERSION = "sha256-5f3ae4812d79c993a4162f3289cc9083c04268112f3eac74322d89c6b122b3b0.json";
const PREPARATION_CATALOG_FETCHED_AT = "2026-11-04T16:43:54.097Z";
const PREPARATION_CATALOG = loadPublicCatalogVersion(PREPARATION_CATALOG_VERSION);
const LEGACY_VALIDATOR_LIMITS: Readonly<Record<OwnerStandardImageVariant, number>> = Object.freeze(Object.fromEntries(
  OWNER_STANDARD_IMAGE_VARIANTS.map((variant) => [variant, variant === "banana-2.1" ? 7 * 1024 * 1024 : 32 * 1024 * 1024])
) as Record<OwnerStandardImageVariant, number>);

export interface StandardImageReferencePreparationPolicy {
  readonly source_catalog_version: string;
  readonly source_catalog_fetched_at: string;
  readonly model_id: OwnerStandardImageVariant;
  readonly source_limit_bytes: number;
  readonly prepared_target_bytes: number;
  readonly legacy_validator_limit_bytes: number;
  readonly max_width: number;
  readonly max_height: number;
  readonly provider_acceptance: "NOT_PROVEN";
}

/** Dated public metadata guides local preparation only; it is not provider-acceptance proof. */
export function getStandardImageReferencePreparationPolicy(variant: OwnerStandardImageVariant): StandardImageReferencePreparationPolicy {
  const expectedAi = variant.startsWith("banana") ? "banana" : "sora-images";
  const row = PREPARATION_CATALOG.models.find((model) => model.value === variant && model.ai_name === expectedAi);
  const settings = row?.settings;
  if (!settings) fail("IMAGE_PREPARATION_UNAVAILABLE");
  const maxFileSize = settings.max_file_size;
  const fileSize = typeof maxFileSize === "number" ? maxFileSize : maxFileSize && typeof maxFileSize === "object" ? maxFileSize.images : undefined;
  const sourceLimit = positiveInt(fileSize);
  const target = positiveMin([sourceLimit, settings.max_image_file_size, settings.image_resize_limit, LEGACY_VALIDATOR_LIMITS[variant]]);
  const maxWidth = positiveInt(settings.max_image_width) ?? positiveInt(settings.max_image_dimension);
  const maxHeight = positiveInt(settings.max_image_height) ?? positiveInt(settings.max_image_dimension);
  if (!sourceLimit || !target || !maxWidth || !maxHeight || sourceLimit > HARD_INPUT_BYTES || target > LEGACY_VALIDATOR_LIMITS[variant]) fail("IMAGE_PREPARATION_UNAVAILABLE");
  return Object.freeze({ source_catalog_version: PREPARATION_CATALOG_VERSION, source_catalog_fetched_at: PREPARATION_CATALOG_FETCHED_AT,
    model_id: variant, source_limit_bytes: sourceLimit, prepared_target_bytes: target,
    legacy_validator_limit_bytes: LEGACY_VALIDATOR_LIMITS[variant], max_width: maxWidth, max_height: maxHeight,
    provider_acceptance: "NOT_PROVEN" });
}

/** Compatibility summary retained for the existing runtime caller; policy lookup is per variant. */
export const STANDARD_IMAGE_REFERENCE_PREPARATION_POLICY = Object.freeze({
  source_catalog_version: PREPARATION_CATALOG_VERSION,
  source_catalog_fetched_at: PREPARATION_CATALOG_FETCHED_AT,
  banana_21_source_limit_bytes: BANANA_SOURCE_BYTES,
  banana_21_target_bytes: BANANA_TARGET_BYTES,
  banana_21_legacy_validator_limit_bytes: 7 * 1024 * 1024,
  provider_acceptance: "NOT_PROVEN" as const
});

function positiveInt(value: unknown): number | undefined { return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined; }
function positiveMin(values: readonly unknown[]): number | undefined {
  const numbers = values.map(positiveInt).filter((value): value is number => value !== undefined);
  return numbers.length ? Math.min(...numbers) : undefined;
}

export interface StandardImageReferencePreparationInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: string;
  readonly variant: OwnerStandardImageVariant;
}
export interface StandardImageReferencePreparationOptions {
  readonly ffmpegPath?: string;
  readonly autoCompress?: boolean;
}
export interface StandardImageReferencePreparation {
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
  readonly preparation: StandardImageReferencePreparation;
}

export class StandardImageReferencePreparationError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "UNSUPPORTED_IMAGE_FORMAT" | "IMAGE_PREPARATION_UNAVAILABLE" | "IMAGE_PREPARATION_FAILED" | "IMAGE_PREPARATION_ABORTED") {
    super(code === "IMAGE_PREPARATION_UNAVAILABLE"
      ? "Image exceeds the local size limit. Configure a trusted absolute FFmpeg path to prepare it before upload."
      : code === "UNSUPPORTED_IMAGE_FORMAT" ? "This image format cannot be prepared locally. Convert it to JPEG, PNG, or WebP before upload."
      : code === "IMAGE_PREPARATION_ABORTED" ? "Image preparation was cancelled."
        : "Image could not be safely validated or prepared for upload.");
    this.name = "StandardImageReferencePreparationError";
  }
}

/** Returns an owned byte copy; the caller remains responsible for wiping it after upload lifecycle ends. */
export async function prepareStandardImageReference(
  input: StandardImageReferencePreparationInput,
  options: StandardImageReferencePreparationOptions = {},
  signal?: AbortSignal
): Promise<PreparedStandardImageReference> {
  const deadline = Date.now() + PREPARATION_DEADLINE_MS;
  if (signal?.aborted) fail("IMAGE_PREPARATION_ABORTED");
  let source: Buffer;
  try {
    if (!input || types.isProxy(input) || types.isProxy(input.bytes) || (!(input.bytes instanceof Uint8Array)) ||
        (Object.getPrototypeOf(input.bytes) !== Uint8Array.prototype && Object.getPrototypeOf(input.bytes) !== Buffer.prototype) ||
        Object.hasOwn(input.bytes, "buffer") || Object.hasOwn(input.bytes, "byteLength") ||
        Object.hasOwn(input.bytes, "byteOffset") || Object.hasOwn(input.bytes, "length") ||
        input.bytes.byteLength < 1 || input.bytes.byteLength > HARD_INPUT_BYTES ||
        typeof input.filename !== "string" || !SAFE_FILENAME.test(input.filename) || input.filename === "." || input.filename === ".." ||
        Buffer.byteLength(input.filename, "utf8") > 255 || typeof input.mime_type !== "string") fail("INVALID_IMAGE_INPUT");
    source = Buffer.from(input.bytes);
  } catch (error) { if (error instanceof StandardImageReferencePreparationError) throw error; fail("INVALID_IMAGE_INPUT"); }
  try { return await prepareCopiedImage(input, source, options, deadline, signal); }
  finally { source.fill(0); }
}

async function prepareCopiedImage(
  input: StandardImageReferencePreparationInput,
  source: Buffer,
  options: StandardImageReferencePreparationOptions,
  deadline: number,
  signal?: AbortSignal
): Promise<PreparedStandardImageReference> {
  if (Date.now() >= deadline) fail("IMAGE_PREPARATION_FAILED");
  const policy = getStandardImageReferencePreparationPolicy(input.variant);
  const targetLimit = policy.prepared_target_bytes;
  const sourceLimit = policy.source_limit_bytes;
  if (source.byteLength > sourceLimit) fail("INVALID_IMAGE_INPUT");
  if (source.byteLength <= targetLimit) {
    try {
      const valid = validateOwnerStandardImageUploadData({ variant: input.variant, bytes: source, filename: input.filename, mime_type: input.mime_type });
      return Object.freeze({ bytes: valid.bytes, filename: valid.filename, mime_type: valid.mime_type,
        preparation: Object.freeze({ applied: false, original_bytes: source.byteLength, prepared_bytes: source.byteLength,
          original_width: valid.width, original_height: valid.height, prepared_width: valid.width, prepared_height: valid.height,
          original_mime_type: valid.mime_type, prepared_mime_type: valid.mime_type }) });
    } catch { fail("INVALID_IMAGE_INPUT"); }
  }
  if (options.autoCompress === false) fail("IMAGE_PREPARATION_UNAVAILABLE");
  if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(input.mime_type)) fail("UNSUPPORTED_IMAGE_FORMAT");
  let dimensions: ReturnType<typeof inspectBoundedOwnerImageBytesWithMax>;
  try {
    dimensions = inspectBoundedOwnerImageBytesWithMax(source, HARD_INPUT_BYTES);
    const declaredMime = input.mime_type === "image/jpg" ? "image/jpeg" : input.mime_type;
    if (dimensions.width > Math.min(MAX_EDGE, policy.max_width) || dimensions.height > Math.min(MAX_EDGE, policy.max_height) || dimensions.width * dimensions.height > PIXEL_BUDGET || dimensions.mime !== declaredMime) fail("INVALID_IMAGE_INPUT");
  } catch (error) { if (error instanceof StandardImageReferencePreparationError) throw error; fail("INVALID_IMAGE_INPUT"); }
  const ffmpeg = options.ffmpegPath ?? process.env.SYNTX_MEDIA_FFMPEG_PATH;
  if (!ffmpeg || !isAbsolute(ffmpeg)) fail("IMAGE_PREPARATION_UNAVAILABLE");
  let resolvedFfmpeg: string;
  try { resolvedFfmpeg = await realpath(ffmpeg); const metadata = await stat(resolvedFfmpeg); if (!metadata.isFile()) fail("IMAGE_PREPARATION_UNAVAILABLE"); await access(resolvedFfmpeg, fsConstants.X_OK); }
  catch (error) { if (error instanceof StandardImageReferencePreparationError) throw error; fail("IMAGE_PREPARATION_UNAVAILABLE"); }
  const outputCap = targetLimit - TARGET_MARGIN;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "syntx-image-prepare-"));
    await chmod(directory, 0o700);
    const sourcePath = join(directory, `source.${dimensions.mime.slice(6) === "jpeg" ? "jpg" : dimensions.mime.slice(6)}`);
    const outputPath = join(directory, "prepared.jpg");
    const handle = await open(sourcePath, "wx", 0o600);
    try { await handle.writeFile(source); } finally { await handle.close(); }
    const firstEdge = Math.min(Math.max(dimensions.width, dimensions.height), MAX_EDGE);
    const edges = [...new Set([firstEdge, 3072, 2048, 1024])];
    let attempts = 0;
    for (const edge of edges) {
      for (const quality of [8, 16]) {
        const remaining = deadline - Date.now();
        if (signal?.aborted) fail("IMAGE_PREPARATION_ABORTED");
        if (remaining <= 0 || attempts >= MAX_ENCODE_ATTEMPTS) fail("IMAGE_PREPARATION_FAILED");
        attempts += 1;
        await rm(outputPath, { force: true });
        const scale = `scale='if(gt(iw,ih),min(iw,${edge}),-2)':'if(gt(iw,ih),-2,min(ih,${edge}))':force_original_aspect_ratio=decrease`;
        await runFfmpeg(resolvedFfmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", sourcePath, "-map", "0:v:0", "-frames:v", "1", "-map_metadata", "-1", "-vf", scale, "-q:v", String(quality), "-fs", String(outputCap), "-y", outputPath], Math.min(remaining, deadline - Date.now()), signal);
        const info = await stat(outputPath).catch(() => undefined);
        if (!info?.isFile() || info.size < 1 || info.size > outputCap) continue;
        const prepared = await readFile(outputPath);
        try {
          const valid = validateOwnerStandardImageUploadData({ variant: input.variant, bytes: prepared, filename: "prepared.jpg", mime_type: "image/jpeg" });
          return Object.freeze({ bytes: valid.bytes, filename: jpgName(input.filename), mime_type: "image/jpeg",
            preparation: Object.freeze({ applied: true, original_bytes: source.byteLength, prepared_bytes: valid.size,
              original_width: dimensions.width, original_height: dimensions.height, prepared_width: valid.width, prepared_height: valid.height,
              original_mime_type: dimensions.mime, prepared_mime_type: "image/jpeg" }) });
        } catch { /* try the next bounded quality/size pair */ }
      }
    }
    fail("IMAGE_PREPARATION_FAILED");
  } catch (error) {
    if (error instanceof StandardImageReferencePreparationError) throw error;
    fail(signal?.aborted ? "IMAGE_PREPARATION_ABORTED" : "IMAGE_PREPARATION_FAILED");
  } finally { if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined); }
  return fail("IMAGE_PREPARATION_FAILED");
}

function runFfmpeg(binary: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new StandardImageReferencePreparationError("IMAGE_PREPARATION_ABORTED")); return; }
    if (timeoutMs <= 0) { reject(new StandardImageReferencePreparationError("IMAGE_PREPARATION_FAILED")); return; }
    let child: ReturnType<typeof spawn>;
    try { child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" } }); }
    catch { reject(new StandardImageReferencePreparationError("IMAGE_PREPARATION_FAILED")); return; }
    let stderrBytes = 0;
    child.stderr?.on("data", (chunk: Buffer) => { stderrBytes = Math.min(STDERR_LIMIT, stderrBytes + Math.min(chunk.byteLength, STDERR_LIMIT)); });
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", () => done(false));
    child.once("close", (code) => done(code === 0));
    function done(ok: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(new StandardImageReferencePreparationError("IMAGE_PREPARATION_ABORTED"));
      else if (ok) resolve(); else reject(new StandardImageReferencePreparationError("IMAGE_PREPARATION_FAILED"));
    }
  });
}
function jpgName(filename: string): string { const stem = filename.replace(/\.[^.]*$/u, "").slice(0, 246) || "reference"; return `${stem}.jpg`; }
function fail(code: ConstructorParameters<typeof StandardImageReferencePreparationError>[0]): never { throw new StandardImageReferencePreparationError(code); }
