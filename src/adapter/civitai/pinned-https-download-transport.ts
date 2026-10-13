import { Resolver } from "node:dns/promises";
import type { IncomingHttpHeaders, IncomingMessage, ClientRequest } from "node:http";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { request as requestHttps } from "node:https";
import type { RequestOptions as HttpsRequestOptions } from "node:https";
import type { TLSSocket } from "node:tls";
import { types } from "node:util";

const FIRST_PARTY_CIVITAI_ORIGIN = "https://civitai.com";
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 900_000;
const DEFAULT_MAX_RESPONSE_HEADERS = 128;
const MAX_RESPONSE_HEADERS = 256;
const DEFAULT_MAX_RESPONSE_HEADER_BYTES = 32_768;
const MAX_RESPONSE_HEADER_BYTES = 262_144;
const MAX_APPROVED_ORIGINS = 16;
const MAX_URL_LENGTH = 16_384;
const MAX_AUTHORIZATION_LENGTH = 8_192;
const MAX_DNS_ADDRESSES = 64;
const RESPONSE_STREAM_HIGH_WATER_MARK = 16_384;
const NO_ADDRESS_CODES = new Set(["ENODATA", "ENOTFOUND"]);

export type CivitaiPinnedHttpsDownloadTransportErrorCode =
  | "INVALID_CONFIGURATION" | "INVALID_REQUEST" | "ORIGIN_NOT_APPROVED" | "DNS_LOOKUP_FAILED"
  | "DNS_ADDRESS_REJECTED" | "REQUEST_ABORTED" | "REQUEST_TIMEOUT" | "CREDENTIAL_PROVIDER_FAILED"
  | "CREDENTIAL_INVALID" | "REQUEST_FAILED" | "TLS_REJECTED" | "PEER_ADDRESS_MISMATCH"
  | "RESPONSE_HEADERS_REJECTED";

export class CivitaiPinnedHttpsDownloadTransportError extends Error {
  constructor(readonly code: CivitaiPinnedHttpsDownloadTransportErrorCode) {
    super("The approved Civitai HTTPS transfer could not be completed safely.");
    this.name = "CivitaiPinnedHttpsDownloadTransportError";
  }
}

export interface CivitaiPinnedHttpsAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Native request configuration is frozen and created only after origin and DNS policy checks. */
export interface CivitaiPinnedHttpsRequestOptions {
  readonly hostname: string;
  readonly port: 443;
  readonly path: string;
  readonly method: "GET";
  readonly headers: Readonly<Record<string, string>>;
  readonly agent: false;
  readonly servername: string;
  readonly rejectUnauthorized: true;
  readonly maxHeaderSize: number;
  readonly highWaterMark: number;
  readonly signal: AbortSignal;
  readonly lookup: LookupFunction;
}

/** Low-level injection seam for deterministic tests; production defaults to Node DNS and HTTPS. */
export interface CivitaiPinnedHttpsRawResponse {
  readonly statusCode: number;
  readonly headers: IncomingHttpHeaders | Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly rawHeaderCount?: number;
  readonly rawHeaderBytes?: number;
  readonly remoteAddress: string | undefined;
  readonly tlsAuthorized: boolean;
  readonly body: AsyncIterable<Uint8Array>;
  cancel(): Promise<void>;
}

export interface CivitaiPinnedHttpsDownloadTransportPorts {
  readonly dnsLookup?: (hostname: string, signal: AbortSignal) => Promise<readonly CivitaiPinnedHttpsAddress[]>;
  readonly request?: (options: CivitaiPinnedHttpsRequestOptions) => Promise<CivitaiPinnedHttpsRawResponse>;
}

export interface CivitaiPinnedHttpsDownloadTransportOptions {
  /** Operator-trusted HTTPS origins only. Must include https://civitai.com; no wildcards or inferred storage domains. */
  readonly approvedOrigins: readonly string[];
  readonly requestTimeoutMs?: number;
  readonly maxResponseHeaders?: number;
  readonly maxResponseHeaderBytes?: number;
  /** Trusted server-side token callback. Called only for the exact Civitai first-party origin. */
  readonly civitaiAuthorizationProvider?: () => string | undefined | Promise<string | undefined>;
  readonly ports?: CivitaiPinnedHttpsDownloadTransportPorts;
}

export interface CivitaiPinnedHttpsDownloadOpenInput {
  readonly url: URL;
  readonly signal?: AbortSignal;
}

export interface CivitaiPinnedHttpsDownloadResponse {
  readonly status: number;
  /** Lowercase selected response headers; `location` may be signed and is for in-process use only. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array>;
  cancel(): Promise<void>;
}

/** Pinned, single-request HTTPS transport. Redirects are returned to the caller, never followed here. */
export class CivitaiPinnedHttpsDownloadTransport {
  readonly #approvedOrigins: ReadonlySet<string>;
  readonly #timeoutMs: number;
  readonly #maxHeaders: number;
  readonly #maxHeaderBytes: number;
  readonly #authorizationProvider: CivitaiPinnedHttpsDownloadTransportOptions["civitaiAuthorizationProvider"];
  readonly #dnsLookup: NonNullable<CivitaiPinnedHttpsDownloadTransportPorts["dnsLookup"]>;
  readonly #request: NonNullable<CivitaiPinnedHttpsDownloadTransportPorts["request"]>;

  constructor(optionsInput: CivitaiPinnedHttpsDownloadTransportOptions | unknown) {
    const options = exactRecord(optionsInput, ["approvedOrigins", "requestTimeoutMs", "maxResponseHeaders",
      "maxResponseHeaderBytes", "civitaiAuthorizationProvider", "ports"], ["approvedOrigins"]);
    this.#approvedOrigins = snapshotApprovedOrigins(options.approvedOrigins);
    this.#timeoutMs = boundedInteger(options.requestTimeoutMs, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);
    this.#maxHeaders = boundedInteger(options.maxResponseHeaders, DEFAULT_MAX_RESPONSE_HEADERS, 1, MAX_RESPONSE_HEADERS);
    this.#maxHeaderBytes = boundedInteger(options.maxResponseHeaderBytes, DEFAULT_MAX_RESPONSE_HEADER_BYTES,
      1_024, MAX_RESPONSE_HEADER_BYTES);
    if (options.civitaiAuthorizationProvider !== undefined &&
        (typeof options.civitaiAuthorizationProvider !== "function" || types.isProxy(options.civitaiAuthorizationProvider))) {
      fail("INVALID_CONFIGURATION");
    }
    const ports = options.ports === undefined ? Object.create(null) as Record<string, unknown> :
      exactRecord(options.ports, ["dnsLookup", "request"], []);
    if ((ports.dnsLookup !== undefined && (typeof ports.dnsLookup !== "function" || types.isProxy(ports.dnsLookup))) ||
        (ports.request !== undefined && (typeof ports.request !== "function" || types.isProxy(ports.request)))) {
      fail("INVALID_CONFIGURATION");
    }
    this.#authorizationProvider = options.civitaiAuthorizationProvider as
      CivitaiPinnedHttpsDownloadTransportOptions["civitaiAuthorizationProvider"];
    this.#dnsLookup = (ports.dnsLookup as CivitaiPinnedHttpsDownloadTransportPorts["dnsLookup"] | undefined) ??
      defaultDnsLookup;
    this.#request = (ports.request as CivitaiPinnedHttpsDownloadTransportPorts["request"] | undefined) ??
      defaultHttpsRequest;
  }

  /** Pure exact-origin membership check; open() independently enforces it again before DNS or I/O. */
  allowsOrigin(urlInput: URL): boolean {
    if (!(urlInput instanceof URL) || types.isProxy(urlInput)) return false;
    try {
      const url = new URL(urlInput.href);
      return isSafeRequestUrl(url) && this.#approvedOrigins.has(url.origin);
    } catch { return false; }
  }

  async open(inputInput: CivitaiPinnedHttpsDownloadOpenInput | unknown): Promise<Readonly<CivitaiPinnedHttpsDownloadResponse>> {
    const input = snapshotOpenInput(inputInput);
    if (!this.allowsOrigin(input.url)) fail("ORIGIN_NOT_APPROVED");
    const scope = new RequestScope(input.signal, this.#timeoutMs);
    let raw: CivitaiPinnedHttpsRawResponse | undefined;
    try {
      scope.throwIfAborted();
      const addresses = await scope.wait(this.#dnsLookup(input.url.hostname, scope.signal), "DNS_LOOKUP_FAILED");
      scope.throwIfAborted();
      const pinned = validateAndChooseAddress(addresses);
      const authorization = await this.#firstPartyAuthorization(input.url, scope);
      scope.throwIfAborted();
      const headers: Record<string, string> = {
        accept: "*/*",
        "accept-encoding": "identity",
        ...(authorization === undefined ? {} : { authorization: `Bearer ${authorization}` })
      };
      const requestOptions = Object.freeze({
        hostname: input.url.hostname,
        port: 443 as const,
        path: `${input.url.pathname}${input.url.search}`,
        method: "GET" as const,
        headers: Object.freeze(headers),
        agent: false as const,
        servername: input.url.hostname,
        rejectUnauthorized: true as const,
        maxHeaderSize: this.#maxHeaderBytes,
        highWaterMark: RESPONSE_STREAM_HIGH_WATER_MARK,
        signal: scope.signal,
        lookup: createPinnedLookup(input.url.hostname, pinned)
      });
      raw = await scope.wait(this.#request(requestOptions), "REQUEST_FAILED");
      scope.throwIfAborted();
      if (raw.tlsAuthorized !== true) fail("TLS_REJECTED");
      if (!sameAddress(raw.remoteAddress, pinned.address)) fail("PEER_ADDRESS_MISMATCH");
      const safeHeaders = snapshotResponseHeaders(raw, this.#maxHeaders, this.#maxHeaderBytes);
      let closed = false;
      const cancel = async (): Promise<void> => {
        if (closed) return;
        closed = true;
        scope.abort("REQUEST_ABORTED");
        try { await raw!.cancel(); } finally { scope.close(); }
      };
      const body = streamResponseBody(raw.body, scope, cancel);
      return Object.freeze({ status: raw.statusCode, headers: safeHeaders, body, cancel });
    } catch (error) {
      if (raw !== undefined) await raw.cancel().catch(() => undefined);
      scope.close();
      if (error instanceof CivitaiPinnedHttpsDownloadTransportError) throw error;
      if (scope.signal.aborted) fail(scope.errorCode());
      fail("REQUEST_FAILED");
    }
  }

  async #firstPartyAuthorization(url: URL, scope: RequestScope): Promise<string | undefined> {
    if (url.origin !== FIRST_PARTY_CIVITAI_ORIGIN || this.#authorizationProvider === undefined) return undefined;
    let authorization: string | undefined;
    try {
      authorization = await scope.wait(Promise.resolve(this.#authorizationProvider()), "CREDENTIAL_PROVIDER_FAILED");
    } catch (error) {
      if (error instanceof CivitaiPinnedHttpsDownloadTransportError) throw error;
      fail("CREDENTIAL_PROVIDER_FAILED");
    }
    if (authorization === undefined) return undefined;
    if (typeof authorization !== "string" || authorization.length === 0 || authorization.length > MAX_AUTHORIZATION_LENGTH ||
        /[\u0000-\u001f\u007f]/u.test(authorization) || /\s/u.test(authorization)) fail("CREDENTIAL_INVALID");
    return authorization;
  }
}

class RequestScope {
  readonly #controller = new AbortController();
  readonly #parentSignal: AbortSignal | undefined;
  readonly #onParentAbort: (() => void) | undefined;
  readonly signal = this.#controller.signal;
  #timeout = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(parentSignal: AbortSignal | undefined, timeoutMs: number) {
    this.#parentSignal = parentSignal;
    if (parentSignal?.aborted) {
      this.#controller.abort();
    } else if (parentSignal !== undefined) {
      this.#onParentAbort = () => {
        this.#controller.abort();
      };
      parentSignal.addEventListener("abort", this.#onParentAbort, { once: true });
    }
    this.#timer = setTimeout(() => {
      this.#timeout = true;
      this.#controller.abort();
    }, timeoutMs);
  }

  errorCode(): CivitaiPinnedHttpsDownloadTransportErrorCode {
    return this.#timeout ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED";
  }

  throwIfAborted(): void {
    if (this.signal.aborted) fail(this.errorCode());
  }

  abort(code: "REQUEST_ABORTED" | "REQUEST_TIMEOUT"): void {
    if (this.signal.aborted) return;
    this.#timeout = code === "REQUEST_TIMEOUT";
    this.#controller.abort();
  }

  async wait<T>(promise: Promise<T>, failureCode: CivitaiPinnedHttpsDownloadTransportErrorCode): Promise<T> {
    if (this.signal.aborted) fail(this.errorCode());
    return await new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new CivitaiPinnedHttpsDownloadTransportError(this.errorCode()));
      this.signal.addEventListener("abort", onAbort, { once: true });
      promise.then((value) => {
        this.signal.removeEventListener("abort", onAbort);
        resolve(value);
      }, (error: unknown) => {
        this.signal.removeEventListener("abort", onAbort);
        if (error instanceof CivitaiPinnedHttpsDownloadTransportError) { reject(error); return; }
        reject(new CivitaiPinnedHttpsDownloadTransportError(failureCode));
      });
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    if (this.#parentSignal !== undefined && this.#onParentAbort !== undefined) {
      this.#parentSignal.removeEventListener("abort", this.#onParentAbort);
    }
  }
}

async function* streamResponseBody(
  body: AsyncIterable<Uint8Array>,
  scope: RequestScope,
  cancel: () => Promise<void>
): AsyncIterable<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  let ended = false;
  try {
    for (;;) {
      scope.throwIfAborted();
      const next = await scope.wait(Promise.resolve(iterator.next()), "REQUEST_FAILED");
      if (next.done) { ended = true; return; }
      if (!(next.value instanceof Uint8Array)) fail("REQUEST_FAILED");
      yield next.value;
    }
  } catch (error) {
    await cancel().catch(() => undefined);
    if (error instanceof CivitaiPinnedHttpsDownloadTransportError) throw error;
    if (scope.signal.aborted) fail(scope.errorCode());
    fail("REQUEST_FAILED");
  } finally {
    if (ended) scope.close();
    else await cancel().catch(() => undefined);
  }
}

async function defaultDnsLookup(hostname: string, signal: AbortSignal): Promise<readonly CivitaiPinnedHttpsAddress[]> {
  const resolver = new Resolver({ timeout: 5_000, tries: 1 });
  const onAbort = (): void => resolver.cancel();
  signal.addEventListener("abort", onAbort, { once: true });
  const familyLookup = async (family: 4 | 6): Promise<readonly CivitaiPinnedHttpsAddress[]> => {
    try {
      const addresses = family === 4 ? await resolver.resolve4(hostname) : await resolver.resolve6(hostname);
      return addresses.map((address) => ({ address, family }));
    } catch (error) {
      const code = readErrorCode(error);
      if (NO_ADDRESS_CODES.has(code ?? "")) return [];
      throw error;
    }
  };
  try {
    return Object.freeze((await Promise.all([familyLookup(4), familyLookup(6)])).flat());
  } finally {
    signal.removeEventListener("abort", onAbort);
    resolver.cancel();
  }
}

async function defaultHttpsRequest(options: CivitaiPinnedHttpsRequestOptions): Promise<CivitaiPinnedHttpsRawResponse> {
  return await new Promise<CivitaiPinnedHttpsRawResponse>((resolve, reject) => {
    let responseObserved = false;
    let request: ClientRequest;
    try {
      request = requestHttps(options as HttpsRequestOptions, (response: IncomingMessage) => {
        responseObserved = true;
        const socket = response.socket as TLSSocket;
        const headers = response.headers;
        const rawHeaders = response.rawHeaders;
        const headerBytes = rawHeaders.reduce((total, value) => total + Buffer.byteLength(value, "utf8"), 0);
        resolve({
          statusCode: response.statusCode ?? 0,
          headers,
          rawHeaderCount: rawHeaders.length / 2,
          rawHeaderBytes: headerBytes,
          remoteAddress: socket.remoteAddress,
          tlsAuthorized: socket.authorized === true,
          body: response as AsyncIterable<Uint8Array>,
          cancel: () => cancelNodeRequest(request, response)
        });
      });
    } catch { reject(new CivitaiPinnedHttpsDownloadTransportError("REQUEST_FAILED")); return; }
    request.once("error", (error) => {
      if (!responseObserved) reject(new CivitaiPinnedHttpsDownloadTransportError(classifyHttpsError(error)));
    });
    request.end();
  });
}

async function cancelNodeRequest(request: ClientRequest, response: IncomingMessage): Promise<void> {
  const closePromises: Promise<void>[] = [];
  if (!response.destroyed) closePromises.push(waitForClose(response));
  if (!request.destroyed) closePromises.push(waitForClose(request));
  response.destroy();
  request.destroy();
  await Promise.all(closePromises);
}

function waitForClose(stream: IncomingMessage | ClientRequest): Promise<void> {
  if (stream.destroyed) return Promise.resolve();
  return new Promise((resolve) => stream.once("close", () => resolve()));
}

function createPinnedLookup(hostname: string, pinned: CivitaiPinnedHttpsAddress): LookupFunction {
  return (requestedHostname, options, callback) => {
    if (requestedHostname.toLowerCase() !== hostname.toLowerCase()) {
      callback(Object.assign(new Error("Pinned host mismatch."), { code: "ERR_INVALID_IP_ADDRESS" }), "", 0);
      return;
    }
    if (typeof options === "object" && options !== null && "all" in options && options.all === true) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
    } else callback(null, pinned.address, pinned.family);
  };
}

function validateAndChooseAddress(input: unknown): CivitaiPinnedHttpsAddress {
  if (!Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype ||
      input.length < 1 || input.length > MAX_DNS_ADDRESSES) fail("DNS_LOOKUP_FAILED");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== input.length + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= input.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) fail("DNS_LOOKUP_FAILED");
  const addresses = Array.from({ length: input.length }, (_, index) => descriptors[String(index)]!.value as unknown);
  const validated = addresses.map(snapshotAddress);
  if (validated.some(({ address, family }) => !isPublicAddress(address, family))) fail("DNS_ADDRESS_REJECTED");
  return validated[0]!;
}

function snapshotAddress(value: unknown): CivitaiPinnedHttpsAddress {
  const fields = exactRecord(value, ["address", "family"]);
  if (typeof fields.address !== "string" || (fields.family !== 4 && fields.family !== 6) ||
      isIP(fields.address) !== fields.family) fail("DNS_LOOKUP_FAILED");
  return Object.freeze({ address: fields.address, family: fields.family });
}

function isPublicAddress(address: string, family: 4 | 6): boolean {
  if (family === 4) {
    const value = ipv4Number(address);
    if (value === null) return false;
    return ![
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
      ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4]
    ].some(([prefix, bits]) => inIpv4Range(value, ipv4Number(prefix as string)!, bits as number));
  }
  const value = ipv6Number(address);
  if (value === null || !hasIpv6Prefix(value, ipv6Number("2000::")!, 3)) return false;
  return ![
    ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3ffe::", 16], ["3fff::", 20]
  ].some(([prefix, bits]) => hasIpv6Prefix(value, ipv6Number(prefix as string)!, bits as number));
}

function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0]! * 256 + parts[1]!) * 256 + parts[2]!) * 256 + parts[3]!);
}

function inIpv4Range(address: number, network: number, prefixBits: number): boolean {
  const mask = prefixBits === 0 ? 0 : (0xffff_ffff << (32 - prefixBits)) >>> 0;
  return (address & mask) === (network & mask);
}

function ipv6Number(address: string): bigint | null {
  if (isIP(address) !== 6 || address.includes("%")) return null;
  let input = address.toLowerCase();
  if (input.includes(".")) {
    const splitAt = input.lastIndexOf(":");
    const ipv4 = ipv4Number(input.slice(splitAt + 1));
    if (splitAt < 0 || ipv4 === null) return null;
    const high = ((ipv4 >>> 16) & 0xffff).toString(16);
    const low = (ipv4 & 0xffff).toString(16);
    input = `${input.slice(0, splitAt)}:${high}:${low}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] === "" ? [] : halves[0]!.split(":");
  const right = halves.length === 1 || halves[1] === "" ? [] : halves[1]!.split(":");
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
  return groups.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
}

function hasIpv6Prefix(address: bigint, network: bigint, prefixBits: number): boolean {
  return (address >> BigInt(128 - prefixBits)) === (network >> BigInt(128 - prefixBits));
}

function sameAddress(left: string | undefined, right: string): boolean {
  if (left === undefined) return false;
  const leftFamily = isIP(left);
  const rightFamily = isIP(right);
  if (leftFamily === 0 || rightFamily === 0) return false;
  const leftV4 = leftFamily === 4 ? ipv4Number(left) : mappedIpv4(ipv6Number(left));
  const rightV4 = rightFamily === 4 ? ipv4Number(right) : mappedIpv4(ipv6Number(right));
  if (leftV4 !== null || rightV4 !== null) return leftV4 !== null && rightV4 !== null && leftV4 === rightV4;
  return ipv6Number(left) === ipv6Number(right);
}

function mappedIpv4(value: bigint | null): number | null {
  if (value === null || (value >> 32n) !== 0xffffn) return null;
  return Number(value & 0xffff_ffffn);
}

function snapshotApprovedOrigins(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < 1 || value.length > MAX_APPROVED_ORIGINS) fail("INVALID_CONFIGURATION");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) fail("INVALID_CONFIGURATION");
  const origins = Array.from({ length: value.length }, (_, index) => {
    const origin = descriptors[String(index)]!.value;
    if (typeof origin !== "string" || origin.includes("*") || origin.length > 512) fail("INVALID_CONFIGURATION");
    let parsed: URL;
    try { parsed = new URL(origin); } catch { fail("INVALID_CONFIGURATION"); }
    if (parsed.protocol !== "https:" || parsed.port !== "" || parsed.username || parsed.password ||
        parsed.pathname !== "/" || parsed.search || parsed.hash || isIP(parsed.hostname) !== 0 || origin !== parsed.origin) {
      fail("INVALID_CONFIGURATION");
    }
    return parsed.origin;
  });
  if (!origins.includes(FIRST_PARTY_CIVITAI_ORIGIN) || new Set(origins).size !== origins.length) fail("INVALID_CONFIGURATION");
  return new Set(origins);
}

function snapshotOpenInput(value: unknown): Readonly<CivitaiPinnedHttpsDownloadOpenInput> {
  const fields = exactRecord(value, ["url", "signal"], ["url"]);
  if (!(fields.url instanceof URL) || types.isProxy(fields.url) ||
      (fields.signal !== undefined && (!(fields.signal instanceof AbortSignal) || types.isProxy(fields.signal)))) fail("INVALID_REQUEST");
  let url: URL;
  try { url = new URL((fields.url as URL).href); } catch { fail("INVALID_REQUEST"); }
  if (!isSafeRequestUrl(url)) fail("INVALID_REQUEST");
  return Object.freeze({ url, ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }) });
}

function isSafeRequestUrl(url: URL): boolean {
  return url.protocol === "https:" && url.port === "" && !url.username && !url.password && !url.hash &&
    url.href.length <= MAX_URL_LENGTH && isIP(url.hostname) === 0;
}

function snapshotResponseHeaders(
  response: CivitaiPinnedHttpsRawResponse,
  maximumCount: number,
  maximumBytes: number
): Readonly<Record<string, string>> {
  const headers = response.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers) || types.isProxy(headers)) fail("RESPONSE_HEADERS_REJECTED");
  const entries = Object.entries(headers);
  const count = response.rawHeaderCount ?? entries.length;
  const bytes = response.rawHeaderBytes ?? entries.reduce((sum, [name, value]) => {
    if (value === undefined) return sum + Buffer.byteLength(name, "utf8");
    const values = Array.isArray(value) ? value : [value];
    return sum + values.reduce((partSum, part) => partSum + Buffer.byteLength(name, "utf8") + Buffer.byteLength(part, "utf8"), 0);
  }, 0);
  if (!Number.isSafeInteger(count) || count < 0 || count > maximumCount ||
      !Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumBytes) fail("RESPONSE_HEADERS_REJECTED");
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const name of ["location", "content-length", "content-type", "content-encoding", "accept-ranges"]) {
    const value = headers[name];
    if (value === undefined) continue;
    if (typeof value !== "string" || /[\r\n\u0000]/u.test(value)) fail("RESPONSE_HEADERS_REJECTED");
    result[name] = value;
  }
  return Object.freeze(result);
}

function exactRecord(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_CONFIGURATION");
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const own = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) ||
        own.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) ||
          !descriptors[key]!.enumerable) || required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_CONFIGURATION");
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of own as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch (error) {
    if (error instanceof CivitaiPinnedHttpsDownloadTransportError) throw error;
    fail("INVALID_CONFIGURATION");
  }
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail("INVALID_CONFIGURATION");
  return value as number;
}

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined;
}

function classifyHttpsError(error: unknown): CivitaiPinnedHttpsDownloadTransportErrorCode {
  const code = readErrorCode(error);
  if (code?.startsWith("ERR_TLS_") || code?.startsWith("CERT_") || code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
      code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "SELF_SIGNED_CERT_IN_CHAIN") return "TLS_REJECTED";
  return "REQUEST_FAILED";
}

function fail(code: CivitaiPinnedHttpsDownloadTransportErrorCode): never {
  throw new CivitaiPinnedHttpsDownloadTransportError(code);
}
