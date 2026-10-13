import { createHash } from "node:crypto";

const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_DIMENSION = 32_768;
const MAX_PIXELS = 100_000_000;
const RATIO_TOLERANCE = 0.02;
const OWNED_ORIGIN = "https://r2.syntx.ai";

interface SafeArtifactMetadata {
  readonly url: string;
  readonly mime_type: string;
  readonly byte_size?: number;
  readonly width?: number;
  readonly height?: number;
  readonly duration_seconds?: number;
}

export interface OwnedImageArtifactObservationInput {
  readonly artifacts: readonly unknown[];
  /** Omit only when the request did not declare an aspect ratio. */
  readonly requestedRatio?: string;
  readonly fetchImpl?: typeof fetch;
}

export type OwnedImageArtifactObservation = Readonly<{
  status: "OBSERVED" | "UNKNOWN";
  reason?: string;
  mime?: "image/jpeg" | "image/png";
  declared_mime?: string;
  response_mime_type?: string | null;
  byte_size?: number;
  width?: number;
  height?: number;
  sha256?: string;
  requested_ratio?: string;
  ratio_match?: boolean;
  ratio_status?: "NOT_REQUESTED";
  sdk_metadata?: Readonly<{ mime_type: string; byte_size?: number; width?: number; height?: number }>;
}>;

export async function observeOwnedImageArtifact(
  input: OwnedImageArtifactObservationInput
): Promise<OwnedImageArtifactObservation> {
  if (!Array.isArray(input?.artifacts) || input.artifacts.length !== 1) return unknown("ARTIFACT_COUNT_INVALID");
  const artifact = input.artifacts[0];
  if (!isPlainRecord(artifact) || typeof artifact.url !== "string" || typeof artifact.mime_type !== "string") {
    return unknown("ARTIFACT_METADATA_INVALID");
  }
  const safeArtifact: SafeArtifactMetadata = {
    url: artifact.url,
    mime_type: artifact.mime_type,
    ...(isSafeDimension(artifact.byte_size) ? { byte_size: artifact.byte_size } : {}),
    ...(isSafeDimension(artifact.width) ? { width: artifact.width } : {}),
    ...(isSafeDimension(artifact.height) ? { height: artifact.height } : {})
  };
  let url: URL;
  try { url = new URL(artifact.url); } catch { return unknown("UNSAFE_ARTIFACT_URL"); }
  if (url.origin !== OWNED_ORIGIN || url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      url.port !== "" || url.hash !== "") return unknown("UNSAFE_ARTIFACT_URL");
  const ratio = input.requestedRatio === undefined ? undefined : parseRatio(input.requestedRatio);
  if (input.requestedRatio !== undefined && ratio === null) return unknown("REQUESTED_RATIO_INVALID");
  const expectedRatio = ratio === null ? undefined : ratio;
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return unknown("FETCH_UNAVAILABLE");

  const controller = new AbortController();
  let didTimeout = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<OwnedImageArtifactObservation>((resolve) => {
    timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
      resolve(unknown("FETCH_TIMEOUT"));
    }, FETCH_TIMEOUT_MS);
  });
  const work = readArtifact(fetchImpl, url, controller.signal, safeArtifact, input.requestedRatio, expectedRatio);
  try {
    return await Promise.race([work, timeoutPromise]);
  } catch {
    return unknown(didTimeout ? "FETCH_TIMEOUT" : "FETCH_FAILED");
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (!controller.signal.aborted) controller.abort();
  }
}

async function readArtifact(
  fetchImpl: typeof fetch,
  url: URL,
  signal: AbortSignal,
  artifact: SafeArtifactMetadata,
  requestedRatio: string | undefined,
  expectedRatio: number | undefined
): Promise<OwnedImageArtifactObservation> {
  let response: Response;
  try {
    response = await fetchImpl(url.href, { method: "GET", redirect: "manual", credentials: "omit", signal });
  } catch {
    return unknown(signal.aborted ? "FETCH_TIMEOUT" : "FETCH_FAILED");
  }
  if (response.redirected || response.type === "opaqueredirect" || [301, 302, 303, 307, 308].includes(response.status)) {
    return unknown("REDIRECT_REJECTED");
  }
  if (!response.ok || response.status !== 200) return unknown("HTTP_STATUS_REJECTED");
  const announcedSize = response.headers.get("content-length");
  if (announcedSize !== null && /^\d+$/u.test(announcedSize) && Number(announcedSize) > MAX_ARTIFACT_BYTES) {
    return unknown("ARTIFACT_TOO_LARGE");
  }
  if (response.body === null) return unknown("ARTIFACT_BODY_MISSING");
  const bytes = await readBoundedBody(response.body, signal);
  if (bytes === null) return unknown(signal.aborted ? "FETCH_TIMEOUT" : "ARTIFACT_TOO_LARGE");
  const parsed = parseImageDimensions(bytes);
  if (parsed === null) return unknown("IMAGE_BYTES_INVALID");
  if (artifact.mime_type !== parsed.mime) return unknown("DECLARED_MIME_MISMATCH");
  const ratioMatch = expectedRatio === undefined ? undefined :
    Math.abs((parsed.width / parsed.height) - expectedRatio) / expectedRatio <= RATIO_TOLERANCE;
  const responseMime = safeMime(response.headers.get("content-type"));
  return Object.freeze({
    status: "OBSERVED",
    mime: parsed.mime,
    declared_mime: artifact.mime_type,
    response_mime_type: responseMime,
    byte_size: bytes.byteLength,
    width: parsed.width,
    height: parsed.height,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    ...(requestedRatio === undefined ? { ratio_status: "NOT_REQUESTED" as const } : {
      requested_ratio: requestedRatio,
      ratio_match: ratioMatch as boolean
    }),
    sdk_metadata: Object.freeze({
      mime_type: artifact.mime_type,
      ...(isSafeDimension(artifact.byte_size) ? { byte_size: artifact.byte_size } : {}),
      ...(isSafePositiveDimension(artifact.width) ? { width: artifact.width } : {}),
      ...(isSafePositiveDimension(artifact.height) ? { height: artifact.height } : {})
    })
  });
}

async function readBoundedBody(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) return null;
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ARTIFACT_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function parseImageDimensions(bytes: Uint8Array): { readonly mime: "image/jpeg" | "image/png"; readonly width: number; readonly height: number } | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    if (bytes.length < 45 || readU32(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR" || ascii(bytes, bytes.length - 8, 4) !== "IEND") return null;
    const width = readU32(bytes, 16);
    const height = readU32(bytes, 20);
    return validDimensions(width, height) ? { mime: "image/png", width, height } : null;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let dimensions: { width: number; height: number } | null = null;
  let sawScan = false;
  while (offset + 1 < bytes.length && offset < MAX_ARTIFACT_BYTES) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++]!;
    if (marker === 0xd9) return sawScan && dimensions !== null ? jpegResult(dimensions) : null;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) return null;
    if (isSofMarker(marker)) {
      if (length < 8) return null;
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (!validDimensions(width, height)) return null;
      dimensions = { width, height };
    }
    offset += length;
    if (marker === 0xda) {
      sawScan = true;
      for (let scan = offset; scan + 1 < bytes.length; scan += 1) {
        if (bytes[scan] === 0xff && bytes[scan + 1] === 0xd9) {
          return dimensions === null ? null : jpegResult(dimensions);
        }
      }
      return null;
    }
  }
  return null;
}

function jpegResult(dimensions: { readonly width: number; readonly height: number }) {
  return { mime: "image/jpeg" as const, ...dimensions };
}

function isSofMarker(marker: number): boolean {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
}

function validDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
    width <= MAX_DIMENSION && height <= MAX_DIMENSION && width * height <= MAX_PIXELS;
}

function parseRatio(value: string): number | null {
  const match = /^(\d{1,3}):(\d{1,3})$/u.exec(value);
  if (match === null) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

function safeMime(value: string | null): string | null {
  if (value === null) return null;
  const mime = value.split(";", 1)[0]?.trim().toLowerCase();
  return mime !== undefined && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(mime) ? mime : null;
}

function isSafeDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function isSafePositiveDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every((key) => {
    const descriptor = typeof key === "string" ? Object.getOwnPropertyDescriptor(value, key) : undefined;
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! * 0x1000000) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function unknown(reason: string): OwnedImageArtifactObservation {
  return Object.freeze({ status: "UNKNOWN", reason });
}
