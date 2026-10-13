import { createHash, type Hash } from "node:crypto";
import { types } from "node:util";
import { CivitaiPinnedHttpsDownloadTransport, CivitaiPinnedHttpsDownloadTransportError,
  type CivitaiPinnedHttpsDownloadResponse } from "./pinned-https-download-transport.js";
import { CivitaiPublicModelFileClient, type CivitaiPublicModelFileMetadata } from "./public-model-file-client.js";

const API_ORIGIN = "https://civitai.com";
/** Finite local stream ceiling; not a Civitai, SYNTX, or provider file-size limit. */
const DEFAULT_MAX_ASSET_BYTES = 1_073_741_824;
const MAX_ASSET_BYTES = 1_073_741_824;
/** Local SafeTensors header cap, intentionally below the format implementation's larger ceiling. */
const DEFAULT_MAX_HEADER_BYTES = 8_388_608;
const MAX_HEADER_BYTES = 8_388_608;
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const MAX_REQUEST_TIMEOUT_MS = 900_000;
const MAX_STREAM_CHUNKS = 1_000_000;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 1_000_000;
const MAX_TENSOR_RANK = 64;
const MAX_REDIRECTS = 1;
const SHA256 = /^[a-f0-9]{64}$/u;
const ALLOWED_CONTENT_TYPES = new Set(["application/octet-stream", "binary/octet-stream", "application/x-safetensors"]);
const DTYPE_BITS: Readonly<Record<string, number>> = Object.freeze({
  BOOL: 8, U8: 8, I8: 8, F8_E5M2: 8, F8_E4M3: 8, F8_E8M0: 8, F8_E4M3FNUZ: 8, F8_E5M2FNUZ: 8,
  I16: 16, U16: 16, F16: 16, BF16: 16, I32: 32, U32: 32, F32: 32, C64: 64, F64: 64, I64: 64, U64: 64,
  F4: 4, F6_E2M3: 6, F6_E3M2: 6
});
const SUBBYTE_DTYPES = new Set(["F4", "F6_E2M3", "F6_E3M2"]);

declare const witnessBrand: unique symbol;
export interface CivitaiVerifiedModelFileWitness {
  readonly [witnessBrand]: true;
}

export interface CivitaiVerifiedModelFileSnapshot {
  readonly metadata_status: "VERIFIED";
  readonly source_kind: "MODEL_PAGE_VERSION_SELECTION" | "MODEL_VERSION_FILE_SELECTION";
  readonly model_id: number;
  readonly model_version_id: number;
  readonly file_id: number;
  readonly model_type: "LORA";
  readonly base_model: string | null;
  readonly version_status: "Published";
  readonly model_availability: "Public";
  readonly version_availability: "Public" | "NOT_REPORTED";
  readonly usage_control: "Download";
  readonly file_type: "Model";
  readonly format: "SafeTensor";
  readonly primary: boolean | null;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly canonical_download_url: string;
  readonly content_confidence: "STREAMED_SHA256_AND_SAFETENSORS_STRUCTURE";
  readonly license_flags: CivitaiPublicModelFileMetadata["license_flags"];
  readonly legal_approval: "NOT_ESTABLISHED";
  readonly license_compatibility: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN";
}

export type CivitaiPublicModelFileAttestorErrorCode =
  | "INVALID_INPUT" | "INVALID_WITNESS" | "REQUEST_ABORTED" | "REQUEST_TIMEOUT" | "METADATA_UNVERIFIED"
  | "TRANSPORT_UNAVAILABLE" | "TRANSPORT_ORIGIN_REJECTED" | "HTTP_REJECTED" | "AUTH_REQUIRED" | "GATED"
  | "REDIRECT_REJECTED" | "RESPONSE_HEADERS_INVALID" | "RESPONSE_TOO_LARGE" | "STREAM_INVALID"
  | "STREAM_TRUNCATED" | "SAFETENSORS_INVALID" | "SAFETENSORS_UNSUPPORTED_DTYPE" | "CONTENT_HASH_MISMATCH";

export class CivitaiPublicModelFileAttestorError extends Error {
  constructor(readonly code: CivitaiPublicModelFileAttestorErrorCode) {
    super("The selected public Civitai file could not be attested safely.");
    this.name = "CivitaiPublicModelFileAttestorError";
  }
}

export interface CivitaiPublicModelFileAttestorInput {
  readonly model_id?: number;
  readonly model_version_id: number;
  readonly file_id: number;
}

type CivitaiPinnedDownloadResponse = CivitaiPinnedHttpsDownloadResponse;

/** Trusted application composition only; never accept this options object from a request/tool payload. */
export interface CivitaiPublicModelFileAttestorOptions {
  readonly metadataClient?: CivitaiPublicModelFileClient;
  readonly transport?: CivitaiPinnedHttpsDownloadTransport;
  /** Exact operator-approved HTTPS origins; defaults to Civitai only. */
  readonly approvedOrigins?: readonly string[];
  readonly maxAssetBytes?: number;
  readonly maxHeaderBytes?: number;
  readonly requestTimeoutMs?: number;
}

interface MetadataBinding {
  readonly snapshot: CivitaiVerifiedModelFileSnapshot;
  readonly expectedHash: string;
  readonly initialUrl: URL;
}

const witnesses = new WeakMap<object, CivitaiVerifiedModelFileSnapshot>();

/** Streams one exact, selected file; the bytes are never buffered as a complete model. */
export class CivitaiPublicModelFileAttestor {
  readonly #metadataClient: CivitaiPublicModelFileClient;
  readonly #readMetadata: CivitaiPublicModelFileClient["getPublicLoraFileMetadata"];
  readonly #transport: CivitaiPinnedHttpsDownloadTransport;
  readonly #open: CivitaiPinnedHttpsDownloadTransport["open"];
  readonly #allowsOrigin: CivitaiPinnedHttpsDownloadTransport["allowsOrigin"];
  readonly #maxAssetBytes: number;
  readonly #maxHeaderBytes: number;
  readonly #requestTimeoutMs: number;

  constructor(optionsInput: CivitaiPublicModelFileAttestorOptions | unknown = {}) {
    const options = exactRecord(optionsInput, ["metadataClient", "transport", "approvedOrigins", "maxAssetBytes", "maxHeaderBytes", "requestTimeoutMs"], []);
    const metadataClientValue = options.metadataClient ?? new CivitaiPublicModelFileClient();
    if (options.transport !== undefined && options.approvedOrigins !== undefined) fail("INVALID_INPUT");
    const approvedOrigins = snapshotApprovedOrigins(options.approvedOrigins);
    const requestTimeoutMs = boundedOption(options.requestTimeoutMs, 1, MAX_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
    let transportValue = options.transport;
    if (transportValue === undefined) {
      try { transportValue = new CivitaiPinnedHttpsDownloadTransport({ approvedOrigins, requestTimeoutMs }); }
      catch { fail("INVALID_INPUT"); }
    }
    if (!isExactNativeInstance(metadataClientValue, CivitaiPublicModelFileClient.prototype, ["getPublicLoraFileMetadata"]) ||
        !isExactNativeInstance(transportValue, CivitaiPinnedHttpsDownloadTransport.prototype, ["open", "allowsOrigin"])) fail("INVALID_INPUT");
    const metadataClient = metadataClientValue as CivitaiPublicModelFileClient;
    const transport = transportValue as CivitaiPinnedHttpsDownloadTransport;
    this.#metadataClient = metadataClient;
    this.#readMetadata = metadataClient.getPublicLoraFileMetadata;
    this.#transport = transport;
    this.#open = transport.open;
    this.#allowsOrigin = transport.allowsOrigin;
    this.#maxAssetBytes = boundedOption(options.maxAssetBytes, 1, MAX_ASSET_BYTES, DEFAULT_MAX_ASSET_BYTES);
    this.#maxHeaderBytes = boundedOption(options.maxHeaderBytes, 2, MAX_HEADER_BYTES, DEFAULT_MAX_HEADER_BYTES);
    this.#requestTimeoutMs = requestTimeoutMs;
    Object.freeze(this);
  }

  async attest(input: CivitaiPublicModelFileAttestorInput | unknown, parentSignal?: AbortSignal): Promise<CivitaiVerifiedModelFileWitness> {
    const selection = snapshotSelection(input);
    if (parentSignal !== undefined && (!(parentSignal instanceof AbortSignal) || types.isProxy(parentSignal))) fail("INVALID_INPUT");
    const timeoutSignal = AbortSignal.timeout(this.#requestTimeoutMs);
    const signal = parentSignal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, parentSignal]);
    try {
      const metadataValue = await waitForSignal(
        Promise.resolve(Reflect.apply(this.#readMetadata, this.#metadataClient, [selection, signal])), signal);
      const binding = bindMetadata(metadataValue, selection);
      assertSignal(signal);
      const body = await this.#downloadAndVerify(binding, signal);
      const snapshot = Object.freeze({ ...binding.snapshot, size: body.size,
        sha256: `sha256:${body.sha256}` as const,
        content_confidence: "STREAMED_SHA256_AND_SAFETENSORS_STRUCTURE" as const,
        legal_approval: "NOT_ESTABLISHED" as const, license_compatibility: "UNPROVEN" as const,
        backend_acceptance: "UNPROVEN" as const });
      const witness = Object.freeze(Object.create(null)) as CivitaiVerifiedModelFileWitness;
      witnesses.set(witness, snapshot);
      return witness;
    } catch (error) {
      if (error instanceof CivitaiPublicModelFileAttestorError) throw error;
      if (parentSignal?.aborted) fail("REQUEST_ABORTED");
      if (timeoutSignal.aborted) fail("REQUEST_TIMEOUT");
      fail("METADATA_UNVERIFIED");
    }
  }

  async #downloadAndVerify(binding: MetadataBinding, signal: AbortSignal): Promise<{ size: number; sha256: string }> {
    let url = binding.initialUrl;
    let redirects = 0;
    for (;;) {
      assertSignal(signal);
      if (!this.#isApproved(url)) fail("TRANSPORT_ORIGIN_REJECTED");
      const response = await this.#openResponse(url, signal);
      if (response.status >= 300 && response.status < 400) {
        const location = header(response.headers, "location");
        const canceled = await cancelResponse(response);
        if (!canceled) fail("REDIRECT_REJECTED");
        if (redirects >= MAX_REDIRECTS || location === undefined) fail("REDIRECT_REJECTED");
        url = resolveApprovedRedirect(location, url, (candidate) => this.#isApproved(candidate));
        redirects += 1;
        continue;
      }
      if (response.status === 401) { await cancelResponse(response); fail("AUTH_REQUIRED"); }
      if (response.status === 403) { await cancelResponse(response); fail("GATED"); }
      if (response.status !== 200) { await cancelResponse(response); fail("HTTP_REJECTED"); }
      try {
        const length = validateResponseHeaders(response.headers, this.#maxAssetBytes);
        return await streamAndVerify(response, binding.expectedHash, this.#maxAssetBytes, this.#maxHeaderBytes,
          length, signal);
      } catch (error) {
        await cancelResponse(response);
        if (error instanceof CivitaiPublicModelFileAttestorError) throw error;
        throw error;
      }
    }
  }

  async #openResponse(url: URL, signal: AbortSignal): Promise<CivitaiPinnedDownloadResponse> {
    try {
      const opened = await waitForSignal(Promise.resolve(Reflect.apply(this.#open, this.#transport,
        [{ url, signal }])), signal);
      if (!isResponsePort(opened)) fail("STREAM_INVALID");
      return opened;
    } catch (error) {
      if (error instanceof CivitaiPublicModelFileAttestorError) throw error;
      if (error instanceof CivitaiPinnedHttpsDownloadTransportError && error.code === "REQUEST_TIMEOUT") fail("REQUEST_TIMEOUT");
      if (error instanceof CivitaiPinnedHttpsDownloadTransportError && error.code === "REQUEST_ABORTED") fail("REQUEST_ABORTED");
      if (error instanceof CivitaiPinnedHttpsDownloadTransportError && error.code === "ORIGIN_NOT_APPROVED") fail("TRANSPORT_ORIGIN_REJECTED");
      assertSignal(signal);
      fail("TRANSPORT_UNAVAILABLE");
    }
  }

  #isApproved(url: URL): boolean {
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port !== "" ||
        !isSafeHostname(url.hostname)) return false;
    try { return Reflect.apply(this.#allowsOrigin, this.#transport, [url]) === true; }
    catch { return false; }
  }
}

/** Returns safe source metadata only for the exact frozen token issued after EOF/hash/structure checks. */
export function snapshotCivitaiVerifiedModelFileWitness(value: unknown): Readonly<CivitaiVerifiedModelFileSnapshot> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_WITNESS");
  const snapshot = witnesses.get(value as object);
  if (!snapshot) fail("INVALID_WITNESS");
  return snapshot;
}

async function streamAndVerify(response: CivitaiPinnedDownloadResponse, expectedHash: string, maxBytes: number,
  maxHeaderBytes: number, contentLength: number | null, signal: AbortSignal): Promise<{ size: number; sha256: string }> {
  let iterator: AsyncIterator<Uint8Array> | undefined;
  let complete = false;
  const hash: Hash = createHash("sha256");
  const prefixParts: Buffer[] = [];
  let prefixLength = 0;
  let targetPrefixLength = 8;
    let headerLength: number | undefined;
    let expectedDataLength: number | undefined;
  let chunks = 0;
  let size = 0;
  try {
    iterator = response.body[Symbol.asyncIterator]();
    if (!iterator || typeof iterator.next !== "function") fail("STREAM_INVALID");
    for (;;) {
      assertSignal(signal);
      const next = await waitForSignal(Promise.resolve(iterator.next()), signal);
      if (!next || typeof next !== "object" || typeof next.done !== "boolean") fail("STREAM_INVALID");
      if (next.done) { complete = true; break; }
      if (!(next.value instanceof Uint8Array) || types.isProxy(next.value)) fail("STREAM_INVALID");
      if (++chunks > MAX_STREAM_CHUNKS) fail("RESPONSE_TOO_LARGE");
      const chunk = next.value;
      if (chunk.byteLength > maxBytes - size) fail("RESPONSE_TOO_LARGE");
      size += chunk.byteLength;
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength && prefixLength < targetPrefixLength) {
        const take = Math.min(targetPrefixLength - prefixLength, chunk.byteLength - offset);
        prefixParts.push(Buffer.from(chunk.subarray(offset, offset + take)));
        prefixLength += take;
        offset += take;
        if (headerLength === undefined && prefixLength === 8) {
          const prefix = Buffer.concat(prefixParts, prefixLength);
          const declared = prefix.readBigUInt64LE(0);
          if (declared < 2n || declared > BigInt(maxHeaderBytes)) fail("RESPONSE_TOO_LARGE");
          headerLength = Number(declared);
          targetPrefixLength = 8 + headerLength;
        }
        if (headerLength !== undefined && prefixLength === targetPrefixLength) {
          const prefix = Buffer.concat(prefixParts, prefixLength);
          try { expectedDataLength = validateSafeTensorsHeader(prefix.subarray(8)); }
          finally {
            prefix.fill(0);
            for (const part of prefixParts) part.fill(0);
            prefixParts.length = 0;
          }
        }
      }
    }
    assertSignal(signal);
    if (!complete || size < 10 || headerLength === undefined || prefixLength < targetPrefixLength) fail("STREAM_TRUNCATED");
    if (contentLength !== null && contentLength !== size) fail("RESPONSE_HEADERS_INVALID");
    const dataLength = size - 8 - headerLength;
    if (dataLength < 0) fail("STREAM_TRUNCATED");
    if (expectedDataLength === undefined) {
      const prefix = Buffer.concat(prefixParts, prefixLength);
      try { expectedDataLength = validateSafeTensorsHeader(prefix.subarray(8)); }
      finally { prefix.fill(0); for (const part of prefixParts) part.fill(0); }
    }
    if (expectedDataLength > dataLength) fail("STREAM_TRUNCATED");
    if (expectedDataLength < dataLength) fail("SAFETENSORS_INVALID");
    const actualHash = hash.digest("hex");
    if (actualHash !== expectedHash) fail("CONTENT_HASH_MISMATCH");
    return Object.freeze({ size, sha256: actualHash });
  } catch (error) {
    if (error instanceof CivitaiPublicModelFileAttestorError) throw error;
    if (error instanceof CivitaiPinnedHttpsDownloadTransportError && error.code === "REQUEST_TIMEOUT") fail("REQUEST_TIMEOUT");
    if (error instanceof CivitaiPinnedHttpsDownloadTransportError && error.code === "REQUEST_ABORTED") fail("REQUEST_ABORTED");
    assertSignal(signal);
    return fail("STREAM_INVALID");
  } finally {
    for (const part of prefixParts) part.fill(0);
    prefixParts.length = 0;
    if (!complete) {
      try { void Promise.resolve(iterator?.return?.()).catch(() => undefined); } catch { /* private stream cleanup */ }
    }
  }
}

function validateResponseHeaders(headers: Readonly<Record<string, string>>, maximumBytes: number): number | null {
  if (!headers || typeof headers !== "object" || Array.isArray(headers) || types.isProxy(headers)) fail("RESPONSE_HEADERS_INVALID");
  let lengthValue: string | undefined;
  let typeValue: string | undefined;
  let encodingValue: string | undefined;
  const keys = Reflect.ownKeys(headers);
  if (keys.length > 128) fail("RESPONSE_HEADERS_INVALID");
  for (const key of keys) {
    if (typeof key !== "string") fail("RESPONSE_HEADERS_INVALID");
    const descriptor = Object.getOwnPropertyDescriptor(headers, key);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") fail("RESPONSE_HEADERS_INVALID");
    const name = key.toLowerCase();
    if (name === "content-length") lengthValue = descriptor.value;
    else if (name === "content-type") typeValue = descriptor.value;
    else if (name === "content-encoding") encodingValue = descriptor.value;
  }
  if (encodingValue !== undefined && encodingValue.toLowerCase() !== "identity") fail("RESPONSE_HEADERS_INVALID");
  if (typeValue !== undefined) {
    const mediaType = typeValue.split(";", 1)[0]?.trim().toLowerCase();
    if (!mediaType || !ALLOWED_CONTENT_TYPES.has(mediaType)) fail("RESPONSE_HEADERS_INVALID");
  }
  if (lengthValue === undefined) return null;
  if (!/^(?:0|[1-9]\d{0,15})$/u.test(lengthValue)) fail("RESPONSE_HEADERS_INVALID");
  const length = Number(lengthValue);
  if (!Number.isSafeInteger(length)) fail("RESPONSE_HEADERS_INVALID");
  if (length < 1 || length > maximumBytes) fail("RESPONSE_TOO_LARGE");
  return length;
}

function validateSafeTensorsHeader(bytes: Uint8Array): number {
  if (bytes.byteLength < 2 || bytes[0] !== 0x7b) fail("SAFETENSORS_INVALID");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("SAFETENSORS_INVALID"); }
  let parsed: unknown;
  try { parsed = parseStrictJson(text); }
  catch { fail("SAFETENSORS_INVALID"); }
  if (!isPlainRecord(parsed)) fail("SAFETENSORS_INVALID");
  const root = parsed as Record<string, unknown>;
  const intervals: Array<readonly [number, number]> = [];
  for (const name of Object.keys(root)) {
    if (name === "__metadata__") {
      const metadata = root[name];
      if (!isPlainRecord(metadata) || Object.values(metadata).some((value) => typeof value !== "string")) fail("SAFETENSORS_INVALID");
      continue;
    }
    const descriptor = root[name];
    if (!isPlainRecord(descriptor) || !sameKeys(descriptor, ["dtype", "shape", "data_offsets"])) fail("SAFETENSORS_INVALID");
    if (typeof descriptor.dtype !== "string") fail("SAFETENSORS_INVALID");
    const bitsPerElement = DTYPE_BITS[descriptor.dtype];
    if (bitsPerElement === undefined) fail("SAFETENSORS_UNSUPPORTED_DTYPE");
    if (SUBBYTE_DTYPES.has(descriptor.dtype)) fail("SAFETENSORS_UNSUPPORTED_DTYPE");
    if (!Array.isArray(descriptor.shape) || descriptor.shape.length > MAX_TENSOR_RANK ||
        descriptor.shape.some((dimension) => !Number.isSafeInteger(dimension) || (dimension as number) < 0)) fail("SAFETENSORS_INVALID");
    if (!Array.isArray(descriptor.data_offsets) || descriptor.data_offsets.length !== 2 ||
        !Number.isSafeInteger(descriptor.data_offsets[0]) || !Number.isSafeInteger(descriptor.data_offsets[1]) ||
        (descriptor.data_offsets[0] as number) < 0 || (descriptor.data_offsets[1] as number) < (descriptor.data_offsets[0] as number)) {
      fail("SAFETENSORS_INVALID");
    }
    let elementCount = 1n;
    for (const dimension of descriptor.shape as number[]) elementCount *= BigInt(dimension);
    const expectedBytes = (elementCount * BigInt(bitsPerElement)) / 8n;
    if ((elementCount * BigInt(bitsPerElement)) % 8n !== 0n) fail("SAFETENSORS_INVALID");
    const [start, end] = descriptor.data_offsets as [number, number];
    if (BigInt(end - start) !== expectedBytes) fail("SAFETENSORS_INVALID");
    intervals.push(Object.freeze([start, end] as const));
  }
  intervals.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let cursor = 0;
  for (const [start, end] of intervals) {
    if (start !== cursor || end < start) fail("SAFETENSORS_INVALID");
    cursor = end;
  }
  return cursor;
}

function parseStrictJson(text: string): unknown {
  let cursor = 0;
  let nodes = 0;
  const whitespace = (): void => { while (cursor < text.length && /[\u0009\u000a\u000d\u0020]/u.test(text[cursor]!)) cursor += 1; };
  const string = (): string => {
    const start = cursor;
    if (text[cursor] !== "\"") throw new SyntaxError();
    cursor += 1;
    let escaped = false;
    while (cursor < text.length) {
      const char = text[cursor]!;
      if (!escaped && char === "\"") {
        cursor += 1;
        return JSON.parse(text.slice(start, cursor)) as string;
      }
      if (!escaped && char.charCodeAt(0) < 0x20) throw new SyntaxError();
      if (!escaped && char === "\\") escaped = true;
      else escaped = false;
      cursor += 1;
    }
    throw new SyntaxError();
  };
  const value = (depth: number): unknown => {
    if (depth > MAX_JSON_DEPTH || ++nodes > MAX_JSON_NODES) throw new SyntaxError();
    whitespace();
    const char = text[cursor];
    if (char === "{") {
      cursor += 1; whitespace();
      const record = Object.create(null) as Record<string, unknown>;
      const seen = new Set<string>();
      if (text[cursor] === "}") { cursor += 1; return record; }
      for (;;) {
        whitespace();
        const key = string();
        if (seen.has(key)) throw new SyntaxError();
        seen.add(key); whitespace();
        if (text[cursor] !== ":") throw new SyntaxError();
        cursor += 1;
        record[key] = value(depth + 1);
        whitespace();
        if (text[cursor] === "}") { cursor += 1; return record; }
        if (text[cursor] !== ",") throw new SyntaxError();
        cursor += 1;
      }
    }
    if (char === "[") {
      cursor += 1; whitespace();
      const result: unknown[] = [];
      if (text[cursor] === "]") { cursor += 1; return result; }
      for (;;) {
        result.push(value(depth + 1)); whitespace();
        if (text[cursor] === "]") { cursor += 1; return result; }
        if (text[cursor] !== ",") throw new SyntaxError();
        cursor += 1;
      }
    }
    if (char === "\"") return string();
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(literal, cursor)) { cursor += literal.length; return result; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(cursor));
    if (!match) throw new SyntaxError();
    cursor += match[0].length;
    return Number(match[0]);
  };
  const result = value(0);
  whitespace();
  if (cursor !== text.length) throw new SyntaxError();
  return result;
}

function bindMetadata(value: unknown, selection: Readonly<CivitaiPublicModelFileAttestorInput>): MetadataBinding {
  const keys = ["metadata_status", "source_kind", "model_id", "model_version_id", "file_id", "model_type", "base_model",
    "version_status", "model_availability", "version_availability", "usage_control", "file_type", "format", "primary",
    "size_kb", "sha256", "virus_scan_result", "pickle_scan_result", "license_flags", "download_path",
    "download_selection", "content_attestation", "content_gap"];
  if (!isPlainRecord(value) || !sameKeys(value, keys)) fail("METADATA_UNVERIFIED");
  const metadata = value as unknown as CivitaiPublicModelFileMetadata;
  if (metadata.metadata_status !== "VERIFIED" ||
      metadata.source_kind !== (selection.model_id === undefined ? "MODEL_VERSION_FILE_SELECTION" : "MODEL_PAGE_VERSION_SELECTION") ||
      !positiveInteger(metadata.model_id) ||
      metadata.model_id !== (selection.model_id ?? metadata.model_id) ||
      metadata.model_version_id !== selection.model_version_id || metadata.file_id !== selection.file_id ||
      metadata.model_type !== "LORA" || metadata.version_status !== "Published" || metadata.model_availability !== "Public" ||
      !(metadata.version_availability === "Public" || metadata.version_availability === "NOT_REPORTED") ||
      metadata.usage_control !== "Download" || metadata.file_type !== "Model" || metadata.format !== "SafeTensor" ||
      !(metadata.primary === null || typeof metadata.primary === "boolean") ||
      typeof metadata.size_kb !== "number" || !Number.isFinite(metadata.size_kb) || metadata.size_kb <= 0 ||
      !SHA256.test(metadata.sha256) || metadata.sha256 !== metadata.sha256.toLowerCase() ||
      metadata.virus_scan_result !== "Success" || metadata.pickle_scan_result !== "Success" ||
      metadata.content_attestation !== "NOT_CHECKED" || metadata.content_gap !== "DYNAMIC_DOWNLOAD_REDIRECT_UNVERIFIED" ||
      !validLicenseFlags(metadata.license_flags) ||
      (metadata.base_model !== null && (typeof metadata.base_model !== "string" || metadata.base_model.length > 256 || /[\u0000-\u001f\u007f]/u.test(metadata.base_model))) ||
      metadata.download_selection !== "VERIFIED_SOURCE_SELECTOR") fail("METADATA_UNVERIFIED");
  const expectedPath = `/api/download/models/${selection.model_version_id}?fileId=${selection.file_id}`;
  if (metadata.download_path !== expectedPath) fail("METADATA_UNVERIFIED");
  const initialUrl = new URL(expectedPath, API_ORIGIN);
  const snapshot: CivitaiVerifiedModelFileSnapshot = Object.freeze({ metadata_status: "VERIFIED", source_kind: metadata.source_kind,
    model_id: metadata.model_id, model_version_id: metadata.model_version_id, file_id: metadata.file_id,
    model_type: "LORA", base_model: metadata.base_model, version_status: "Published", model_availability: "Public",
    version_availability: metadata.version_availability, usage_control: "Download", file_type: "Model", format: "SafeTensor",
    primary: metadata.primary, size: 0, sha256: `sha256:${metadata.sha256}`,
    canonical_download_url: `${API_ORIGIN}${expectedPath}`, content_confidence: "STREAMED_SHA256_AND_SAFETENSORS_STRUCTURE",
    license_flags: snapshotLicenseFlags(metadata.license_flags), legal_approval: "NOT_ESTABLISHED",
    license_compatibility: "UNPROVEN", backend_acceptance: "UNPROVEN" });
  return Object.freeze({ snapshot, expectedHash: metadata.sha256, initialUrl });
}

function validLicenseFlags(value: unknown): value is CivitaiPublicModelFileMetadata["license_flags"] {
  if (!isPlainRecord(value) || !sameKeys(value, ["allow_commercial_use", "allow_no_credit", "allow_derivatives", "allow_different_license", "legal_approval"]) ||
      value.legal_approval !== "NOT_ESTABLISHED") return false;
  const commercial = value.allow_commercial_use;
  if (!(commercial === null || typeof commercial === "string" && safeMetadataString(commercial, 128) ||
      Array.isArray(commercial) && commercial.length <= 8 && commercial.every((item) => typeof item === "string" && safeMetadataString(item, 32)))) return false;
  return ["allow_no_credit", "allow_derivatives", "allow_different_license"].every((key) => value[key] === null || typeof value[key] === "boolean");
}
function snapshotLicenseFlags(value: CivitaiPublicModelFileMetadata["license_flags"]): CivitaiPublicModelFileMetadata["license_flags"] {
  const commercial = Array.isArray(value.allow_commercial_use) ? Object.freeze([...value.allow_commercial_use]) : value.allow_commercial_use;
  return Object.freeze({ ...value, allow_commercial_use: commercial });
}
function safeMetadataString(value: string, maximum: number): boolean { return value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value); }

function resolveApprovedRedirect(location: string, base: URL, isApproved: (url: URL) => boolean): URL {
  if (location.length < 1 || location.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(location)) fail("REDIRECT_REJECTED");
  let url: URL;
  try { url = new URL(location, base); } catch { fail("REDIRECT_REJECTED"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port !== "" || !isApproved(url)) fail("REDIRECT_REJECTED");
  return url;
}

function header(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const normalized = name.toLowerCase();
  for (const key of Reflect.ownKeys(headers)) if (typeof key === "string" && key.toLowerCase() === normalized) {
    const descriptor = Object.getOwnPropertyDescriptor(headers, key);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") fail("RESPONSE_HEADERS_INVALID");
    return descriptor.value;
  }
  return undefined;
}

async function cancelResponse(response: CivitaiPinnedDownloadResponse): Promise<boolean> {
  try { return await withShortDeadline(Promise.resolve(response.cancel())); } catch { return false; }
}

function withShortDeadline(promise: Promise<void>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 2_000); timer.unref?.(); });
  return Promise.race([promise.then(() => true), timeout]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("ABORTED"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason ?? new Error("ABORTED")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
  });
}

function assertSignal(signal: AbortSignal): void { if (signal.aborted) throw signal.reason ?? new Error("ABORTED"); }
function snapshotSelection(value: unknown): Readonly<CivitaiPublicModelFileAttestorInput> {
  const fields = exactRecord(value, ["model_id", "model_version_id", "file_id"], ["model_version_id", "file_id"]);
  if ((fields.model_id !== undefined && !positiveInteger(fields.model_id)) ||
      !positiveInteger(fields.model_version_id) || !positiveInteger(fields.file_id)) fail("INVALID_INPUT");
  return Object.freeze({ ...(fields.model_id === undefined ? {} : { model_id: fields.model_id as number }),
    model_version_id: fields.model_version_id as number, file_id: fields.file_id as number });
}
function snapshotApprovedOrigins(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([API_ORIGIN]);
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < 1 || value.length > 16) fail("INVALID_INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) fail("INVALID_INPUT");
  const origins: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") fail("INVALID_INPUT");
    let parsed: URL;
    try { parsed = new URL(descriptor.value); } catch { fail("INVALID_INPUT"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port !== "" ||
        parsed.pathname !== "/" || parsed.search || parsed.hash || descriptor.value !== parsed.origin ||
        !isSafeHostname(parsed.hostname) || origins.includes(parsed.origin)) fail("INVALID_INPUT");
    origins.push(parsed.origin);
  }
  if (!origins.includes(API_ORIGIN)) fail("INVALID_INPUT");
  return Object.freeze(origins);
}
function exactRecord(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (!isPlainRecord(value) || types.isProxy(value)) fail("INVALID_INPUT");
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap; }
  catch { fail("INVALID_INPUT"); }
  const own = Reflect.ownKeys(descriptors);
  if (own.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_INPUT");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of own as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every((key) => typeof key === "string" && expected.includes(key));
}
function isExactNativeInstance(value: unknown, prototype: object, methods: readonly string[]): value is object {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== prototype) return false;
    for (const method of methods) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
      if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function" || types.isProxy(descriptor.value)) return false;
      const own = Object.getOwnPropertyDescriptor(value, method);
      if (own && (!("value" in own) || own.value !== descriptor.value)) return false;
    }
    return true;
  } catch { return false; }
}
function isResponsePort(value: unknown): value is CivitaiPinnedDownloadResponse {
  if (!isPlainRecord(value) || typeof value.status !== "number" || !Number.isSafeInteger(value.status) ||
      !isPlainRecord(value.headers) || !value.body || typeof value.body !== "object" || typeof value.cancel !== "function") return false;
  const iterator = (value.body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator];
  return typeof iterator === "function";
}
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function boundedOption(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail("INVALID_INPUT");
  return value;
}
function isSafeHostname(hostname: string): boolean {
  if (hostname.length < 3 || hostname.length > 253 || hostname !== hostname.toLowerCase() || hostname.endsWith(".") ||
      /^\d+(?:\.\d+){3}$/u.test(hostname) || hostname.includes(":") || hostname === "localhost" ||
      hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;
  return hostname.split(".").every((label) => label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}
function fail(code: CivitaiPublicModelFileAttestorErrorCode): never { throw new CivitaiPublicModelFileAttestorError(code); }
