import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { request as requestHttps } from "node:https";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { RequestOptions as HttpsRequestOptions } from "node:https";
import type { TLSSocket } from "node:tls";
import { types } from "node:util";

const SUPPORTED_HOST = "files.oaiusercontent.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_URL_LENGTH = 16_384;
const MAX_HEADER_BYTES = 32_768;
const MAX_DNS_ADDRESSES = 32;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);

export type ChatgptImageFileResolveErrorCode =
  | "UNSUPPORTED_HOST" | "INVALID_FILE" | "UNSAFE_ADDRESS" | "DOWNLOAD_FAILED"
  | "REQUEST_TIMEOUT" | "REQUEST_ABORTED" | "LIMIT_EXCEEDED";

export class ChatgptImageFileResolveError extends Error {
  constructor(readonly code: ChatgptImageFileResolveErrorCode) {
    super("The ChatGPT image attachment could not be resolved safely.");
    this.name = "ChatgptImageFileResolveError";
  }
}

export interface ChatgptImageFileMetadata {
  readonly download_url: string;
  readonly file_id: string;
  readonly mime_type?: string;
  readonly file_name?: string;
}

export interface ResolvedChatgptImageFile {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: string;
}

interface Address { readonly address: string; readonly family: 4 | 6; }
interface RawResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders | Readonly<Record<string, string | undefined>>;
  readonly remoteAddress: string | undefined;
  readonly authorized: boolean;
  readonly body: AsyncIterable<Uint8Array>;
  cancel(): void;
}
interface RequestOptions extends HttpsRequestOptions {
  readonly hostname: string;
  readonly port: 443;
  readonly path: string;
  readonly method: "GET";
  readonly agent: false;
  readonly servername: string;
  readonly rejectUnauthorized: true;
  readonly maxHeaderSize: number;
  readonly signal: AbortSignal;
  readonly lookup: LookupFunction;
}
export interface ChatgptImageFileResolverPorts {
  readonly dnsLookup?: (hostname: string) => Promise<readonly Address[]>;
  readonly request?: (options: RequestOptions) => Promise<RawResponse>;
}
export interface ChatgptImageFileResolverOptions { readonly ports?: ChatgptImageFileResolverPorts; readonly timeout_ms?: number; }

/** Download only the one explicitly supported ChatGPT attachment origin; redirects and credentials are never followed. */
export async function resolveChatgptImageFile(
  input: ChatgptImageFileMetadata | unknown,
  maxBytes: number,
  parentSignal?: AbortSignal,
  optionsInput?: ChatgptImageFileResolverOptions
): Promise<ResolvedChatgptImageFile> {
  const metadata = snapshotMetadata(input);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024) fail("INVALID_FILE");
  if (parentSignal !== undefined && (!(parentSignal instanceof AbortSignal) || types.isProxy(parentSignal))) fail("INVALID_FILE");
  const options = snapshotOptions(optionsInput);
  const url = approvedUrl(metadata.download_url);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs);
  const onAbort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener("abort", onAbort, { once: true });
  let response: RawResponse | undefined;
  let downloadedBytes: Uint8Array | undefined;
  try {
    throwIfAborted(controller.signal, timedOut);
    const addresses = await abortable(options.dnsLookup(url.hostname), controller.signal, () => timedOut);
    throwIfAborted(controller.signal, timedOut);
    const pinned = validateAddresses(addresses);
    response = await abortable(options.request(makeRequestOptions(url, controller.signal, pinned)), controller.signal, () => timedOut);
    throwIfAborted(controller.signal, timedOut);
    if (response.authorized !== true || !sameAddress(response.remoteAddress, pinned[0]!.address)) fail("UNSAFE_ADDRESS");
    if (response.status !== 200) fail("DOWNLOAD_FAILED");
    const headers = snapshotHeaders(response.headers);
    if (headers["content-encoding"] !== undefined && headers["content-encoding"].toLowerCase() !== "identity") fail("INVALID_FILE");
    const contentLength = headers["content-length"] === undefined ? undefined : Number(headers["content-length"]);
    if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maxBytes)) fail("LIMIT_EXCEEDED");
    const bytes = await readBounded(response, maxBytes, controller.signal, () => timedOut);
    downloadedBytes = bytes;
    const sniffed = sniffImageMime(bytes);
    const declared = metadata.mime_type;
    if (declared !== undefined && declared !== "application/octet-stream" &&
        (!IMAGE_MIME_TYPES.has(declared) || canonicalMime(declared) !== canonicalMime(sniffed))) {
      bytes.fill(0);
      fail("INVALID_FILE");
    }
    const headerMime = headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (headerMime !== undefined && headerMime !== "application/octet-stream" && headerMime !== "binary/octet-stream" &&
        (!IMAGE_MIME_TYPES.has(headerMime) || canonicalMime(headerMime) !== canonicalMime(sniffed))) {
      bytes.fill(0);
      fail("INVALID_FILE");
    }
    downloadedBytes = undefined;
    return Object.freeze({ bytes, filename: metadata.file_name ?? defaultFilename(sniffed),
      mime_type: declared === undefined || declared === "application/octet-stream" ? sniffed : declared });
  } catch (error) {
    downloadedBytes?.fill(0);
    response?.cancel();
    if (error instanceof ChatgptImageFileResolveError) throw error;
    if (controller.signal.aborted) fail(timedOut ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED");
    fail("DOWNLOAD_FAILED");
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
  }
  return fail("DOWNLOAD_FAILED");
}

function snapshotMetadata(value: unknown): Readonly<ChatgptImageFileMetadata> {
  const fields = exactRecord(value, ["download_url", "file_id", "mime_type", "file_name"], ["download_url", "file_id"]);
  if (typeof fields.download_url !== "string" || fields.download_url.length > MAX_URL_LENGTH ||
      typeof fields.file_id !== "string" || fields.file_id.length < 1 || fields.file_id.length > 512 ||
      (fields.mime_type !== undefined && (typeof fields.mime_type !== "string" || fields.mime_type.length > 128)) ||
      (fields.file_name !== undefined && (typeof fields.file_name !== "string" || fields.file_name.length < 1 ||
        fields.file_name === "." || fields.file_name === ".." || /[\/\\\p{Cc}\p{Cf}\p{Cs}]/u.test(fields.file_name) ||
        Buffer.byteLength(fields.file_name, "utf8") > 255))) fail("INVALID_FILE");
  return Object.freeze({ download_url: fields.download_url, file_id: fields.file_id,
    ...(fields.mime_type === undefined ? {} : { mime_type: fields.mime_type as string }),
    ...(fields.file_name === undefined ? {} : { file_name: fields.file_name as string }) });
}

function snapshotOptions(input: ChatgptImageFileResolverOptions | undefined): { dnsLookup: NonNullable<ChatgptImageFileResolverPorts["dnsLookup"]>; request: NonNullable<ChatgptImageFileResolverPorts["request"]>; timeoutMs: number } {
  const value = input ?? {};
  const fields = exactRecord(value, ["ports", "timeout_ms"], []);
  const ports = fields.ports === undefined ? Object.create(null) as Record<string, unknown> : exactRecord(fields.ports, ["dnsLookup", "request"], []);
  if ((ports.dnsLookup !== undefined && typeof ports.dnsLookup !== "function") || (ports.request !== undefined && typeof ports.request !== "function")) fail("INVALID_FILE");
  const timeoutMs = fields.timeout_ms === undefined ? DEFAULT_TIMEOUT_MS : fields.timeout_ms;
  if (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1 || (timeoutMs as number) > 60_000) fail("INVALID_FILE");
  return { dnsLookup: (ports.dnsLookup as ChatgptImageFileResolverPorts["dnsLookup"] | undefined) ?? defaultDnsLookup,
    request: (ports.request as ChatgptImageFileResolverPorts["request"] | undefined) ?? defaultHttpsRequest, timeoutMs: timeoutMs as number };
}

function approvedUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { fail("INVALID_FILE"); }
  const authority = /^https:\/\/([^/?#]*)/iu.exec(value)?.[1]?.toLowerCase();
  if (url.protocol !== "https:" || url.hostname !== SUPPORTED_HOST || url.port !== "" || url.username !== "" ||
      url.password !== "" || url.hash !== "" || authority !== SUPPORTED_HOST || url.href.length > MAX_URL_LENGTH) fail("UNSUPPORTED_HOST");
  return url;
}

async function defaultDnsLookup(hostname: string): Promise<readonly Address[]> {
  try { return (await lookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({ address, family: family as 4 | 6 })); }
  catch { return fail("DOWNLOAD_FAILED"); }
}

function makeRequestOptions(url: URL, signal: AbortSignal, addresses: readonly Address[]): RequestOptions {
  const lookupPinned: LookupFunction = (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, addresses.map(({ address, family }) => ({ address, family })));
    } else callback(null, addresses[0]!.address, addresses[0]!.family);
  };
  return Object.freeze({ hostname: url.hostname, port: 443, path: `${url.pathname}${url.search}`, method: "GET",
    headers: Object.freeze({ accept: "image/*", "accept-encoding": "identity", "user-agent": "SYNTX-MCP-ChatGPT-File/1" }),
    agent: false, servername: url.hostname, rejectUnauthorized: true, maxHeaderSize: MAX_HEADER_BYTES, signal, lookup: lookupPinned });
}

async function defaultHttpsRequest(options: RequestOptions): Promise<RawResponse> {
  return await new Promise((resolve, reject) => {
    const request = requestHttps(options, (response: IncomingMessage) => {
      const socket = response.socket as TLSSocket;
      resolve({ status: response.statusCode ?? 0, headers: response.headers, remoteAddress: socket.remoteAddress,
        authorized: socket.authorized, body: response, cancel: () => { response.destroy(); request.destroy(); } });
    });
    request.once("error", reject);
    request.end();
  });
}

function validateAddresses(addresses: readonly Address[]): readonly Address[] {
  if (!Array.isArray(addresses) || addresses.length < 1 || addresses.length > MAX_DNS_ADDRESSES ||
      addresses.some(({ address, family }) => isIP(address) !== family || !isPublicAddress(address))) fail("UNSAFE_ADDRESS");
  return Object.freeze(addresses.map(({ address, family }) => Object.freeze({ address, family })));
}

function isPublicAddress(value: string): boolean {
  const family = isIP(value);
  if (family === 4) {
    const parts = value.split(".").map(Number);
    const [a, b] = parts;
    return a! !== 0 && a! !== 10 && a! !== 127 && a! < 224 && !(a === 100 && b! >= 64 && b! <= 127) &&
      !(a === 169 && b === 254) && !(a === 172 && b! >= 16 && b! <= 31) && !(a === 192 && (b === 0 || b === 168)) &&
      !(a === 198 && (b === 18 || b === 19 || b === 51)) && !(a === 203 && b === 0 && parts[2] === 113);
  }
  const normalized = value.toLowerCase();
  if (family !== 6 || normalized.startsWith("::ffff:") || normalized.startsWith("64:ff9b:") || normalized.startsWith("2001:db8:")) return false;
  const first = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
  return (first & 0xe000) === 0x2000;
}

function snapshotHeaders(input: RawResponse["headers"]): Readonly<Record<string, string>> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("INVALID_FILE");
  const entries = Object.entries(input);
  const size = entries.reduce((sum, [name, value]) => sum + Buffer.byteLength(name) + Buffer.byteLength(String(value ?? "")), 0);
  if (entries.length > 128 || size > MAX_HEADER_BYTES) fail("INVALID_FILE");
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of ["content-length", "content-type", "content-encoding"]) {
    const value = input[key];
    if (Array.isArray(value) || (value !== undefined && (typeof value !== "string" || /[\r\n\u0000]/u.test(value)))) fail("INVALID_FILE");
    if (typeof value === "string") result[key] = value;
  }
  return Object.freeze(result);
}

async function readBounded(response: RawResponse, limit: number, signal: AbortSignal, isTimedOut: () => boolean): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of response.body) {
      throwIfAborted(signal, isTimedOut());
      const copy = new Uint8Array(chunk);
      total += copy.byteLength;
      if (total > limit) { copy.fill(0); fail("LIMIT_EXCEEDED"); }
      chunks.push(copy);
    }
    if (total < 1) fail("INVALID_FILE");
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; chunk.fill(0); }
    return result;
  } catch (error) {
    for (const chunk of chunks) chunk.fill(0);
    if (error instanceof ChatgptImageFileResolveError) throw error;
    throwIfAborted(signal, isTimedOut());
    fail("DOWNLOAD_FAILED");
  }
}

function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.byteLength >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG" && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return "image/png";
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.byteLength >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (bytes.byteLength >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brands = ascii(bytes, 8, Math.min(56, bytes.byteLength - 8));
    if (/\b(?:avif|avis)\b/u.test(brands)) return "image/avif";
    if (/\b(?:heic|heix|hevc|hevx)\b/u.test(brands)) return "image/heic";
    if (/\b(?:mif1|msf1)\b/u.test(brands)) return "image/heif";
  }
  fail("INVALID_FILE");
}

function defaultFilename(mime: string): string {
  const ext: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/avif": "avif", "image/heic": "heic", "image/heif": "heif" };
  return `attachment.${ext[mime] ?? "img"}`;
}
function canonicalMime(value: string): string { return value === "image/jpg" ? "image/jpeg" : value; }
function ascii(bytes: Uint8Array, start: number, length: number): string { return String.fromCharCode(...bytes.subarray(start, start + length)); }
function ipv4Number(address: string): number { return address.split(".").map(Number).reduce((value, part) => value * 256 + part, 0); }
function ipv6Number(address: string): bigint | null {
  if (isIP(address) !== 6) return null;
  const halves = address.split("::");
  const left = halves[0] ? halves[0]!.split(":") : [];
  const right = halves[1] ? halves[1]!.split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/iu.test(part))) return null;
  return groups.reduce((sum, part) => (sum << 16n) | BigInt(`0x${part}`), 0n);
}
function sameAddress(left: string | undefined, right: string): boolean {
  if (left === undefined || isIP(left) === 0 || isIP(right) === 0) return false;
  return isIP(left) === 4 && isIP(right) === 4 ? ipv4Number(left) === ipv4Number(right) : ipv6Number(left) === ipv6Number(right);
}
function exactRecord(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_FILE");
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!)) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_FILE");
  return Object.fromEntries((keys as string[]).map((key) => [key, descriptors[key]!.value]));
}
async function abortable<T>(promise: Promise<T>, signal: AbortSignal, isTimedOut: () => boolean): Promise<T> {
  if (signal.aborted) throw new ChatgptImageFileResolveError(isTimedOut() ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED");
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ChatgptImageFileResolveError(isTimedOut() ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => { signal.removeEventListener("abort", onAbort); resolve(value); }, (error) => {
      signal.removeEventListener("abort", onAbort); reject(error);
    });
  });
}
function throwIfAborted(signal: AbortSignal, timedOut: boolean): void { if (signal.aborted) fail(timedOut ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED"); }
function fail(code: ChatgptImageFileResolveErrorCode): never { throw new ChatgptImageFileResolveError(code); }
