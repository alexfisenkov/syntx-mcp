import { TextDecoder } from "node:util";
import type { SyntxCredentialBroker } from "./http-client.js";
import { AbsoluteRequestDeadline } from "./request-deadline.js";

const V1_BASE_URL = new URL("https://api.syntx.ai/api/v1/");
const STYLES_ROUTE = "hf/lora/styles";
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_STYLE_RECORDS = 128;
const MAX_KEYS_PER_RECORD = 64;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_STYLE_ID_BYTES = 256;
const MAX_STYLE_NAME_BYTES = 256;
const MAX_STYLE_IMAGE_BYTES = 4096;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

/** Internal owner-scoped row. Do not serialize or return directly through MCP. */
export interface OwnerSoulStyleCatalogRecord {
  readonly style_id: string;
  readonly name: string;
  readonly image: string;
}

/** Safe aggregate metadata; contains no IDs, labels, URLs, or row values. */
export interface OwnerSoulStyleCatalogValidationSummary {
  readonly route: typeof STYLES_ROUTE;
  readonly response_bytes: number;
  readonly record_count: number;
  readonly total_matches: true;
  readonly unique_ids: true;
  readonly fields_valid: true;
  readonly unknown_top_level_key_count: number;
  readonly unknown_item_key_count: number;
  readonly style_id_utf8_bytes: { readonly min: number; readonly max: number };
  readonly name_utf8_bytes: { readonly min: number; readonly max: number };
}

/** Private typed data plus a safe summary for a later owner-bound capability layer. */
export interface OwnerSoulStyleCatalogSnapshot {
  readonly records: readonly OwnerSoulStyleCatalogRecord[];
  readonly summary: OwnerSoulStyleCatalogValidationSummary;
}

export interface OwnerSoulStyleCatalogHttpClientOptions {
  readonly credentialBroker: SyntxCredentialBroker;
  readonly fetchImpl?: typeof fetch;
}

export type OwnerSoulStyleCatalogHttpErrorCode =
  | "INVALID_REQUEST"
  | "AUTH_REQUIRED"
  | "AUTH_OR_ACCESS_DENIED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_REQUEST_ABORTED"
  | "UPSTREAM_PROTOCOL_ERROR";

export class OwnerSoulStyleCatalogHttpError extends Error {
  constructor(readonly code: OwnerSoulStyleCatalogHttpErrorCode) {
    super("The owner-scoped Soul style list could not be decoded safely.");
    this.name = "OwnerSoulStyleCatalogHttpError";
  }
}

/** Internal fixed-route reader. It makes one GET and never follows an image URL. */
export class OwnerSoulStyleCatalogHttpClient {
  readonly #credentialBroker: SyntxCredentialBroker;
  readonly #fetch: typeof fetch;

  constructor(options: OwnerSoulStyleCatalogHttpClientOptions) {
    this.#credentialBroker = options.credentialBroker;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  async listStyles(signal?: AbortSignal): Promise<OwnerSoulStyleCatalogSnapshot> {
    const url = new URL(STYLES_ROUTE, V1_BASE_URL);
    const deadline = new AbsoluteRequestDeadline(REQUEST_TIMEOUT_MS, signal,
      () => new OwnerSoulStyleCatalogHttpError("UPSTREAM_REQUEST_ABORTED"));
    let credentialCallbackEntered = false;
    try {
      deadline.throwIfAborted();
      const request = this.#credentialBroker.useCredential(async (credential) => {
        credentialCallbackEntered = true;
        if (typeof credential !== "string" || credential.trim().length < 8 || CONTROL_CHARACTERS.test(credential)) {
          throw new OwnerSoulStyleCatalogHttpError("AUTH_REQUIRED");
        }
        deadline.throwIfAborted();
        const response = await deadline.waitFor(this.#fetch(url, {
          method: "GET",
          headers: { accept: "application/json", authorization: `Bearer ${credential}` },
          cache: "no-store",
          redirect: "error",
          signal: deadline.signal
        }));
        if (response.redirected || response.type === "opaqueredirect" ||
            (response.url.length > 0 && response.url !== url.href)) {
          await cancelBody(response);
          throw new OwnerSoulStyleCatalogHttpError("UPSTREAM_PROTOCOL_ERROR");
        }
        if (!response.ok) {
          await cancelBody(response);
          throw new OwnerSoulStyleCatalogHttpError(response.status === 401 || response.status === 403
            ? "AUTH_OR_ACCESS_DENIED" : "UPSTREAM_UNAVAILABLE");
        }
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
          await cancelBody(response);
          throw new OwnerSoulStyleCatalogHttpError("UPSTREAM_PROTOCOL_ERROR");
        }
        const bytes = await deadline.waitFor(readBoundedJsonBytes(response, MAX_RESPONSE_BYTES, deadline.signal));
        let body: unknown;
        try {
          body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
        } catch {
          throw new OwnerSoulStyleCatalogHttpError("UPSTREAM_PROTOCOL_ERROR");
        }
        return decodeStyleList(body, bytes.byteLength);
      });
      return await deadline.waitFor(request);
    } catch (error) {
      if (error instanceof OwnerSoulStyleCatalogHttpError) throw error;
      if (!credentialCallbackEntered) throw new OwnerSoulStyleCatalogHttpError("AUTH_REQUIRED");
      if (deadline.abortSource === "timeout") throw new OwnerSoulStyleCatalogHttpError("UPSTREAM_TIMEOUT");
      if (deadline.abortSource !== null) throw new OwnerSoulStyleCatalogHttpError("UPSTREAM_REQUEST_ABORTED");
      throw new OwnerSoulStyleCatalogHttpError("UPSTREAM_UNAVAILABLE");
    } finally {
      deadline.close();
    }
  }
}

function decodeStyleList(value: unknown, responseBytes: number): OwnerSoulStyleCatalogSnapshot {
  if (!isPlainRecord(value)) throw protocolError();
  const topKeys = Object.keys(value);
  if (topKeys.length > MAX_KEYS_PER_RECORD) throw protocolError();
  const unknownTopLevelKeyCount = topKeys.filter((key) => key !== "items" && key !== "total").length;
  const items = value.items;
  const total = value.total;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_STYLE_RECORDS ||
      typeof total !== "number" || !Number.isSafeInteger(total) || total !== items.length) {
    throw protocolError();
  }

  const ids = new Set<string>();
  const records: OwnerSoulStyleCatalogRecord[] = [];
  let unknownItemKeyCount = 0;
  const idByteLengths: number[] = [];
  const nameByteLengths: number[] = [];
  for (const item of items) {
    if (!isPlainRecord(item)) throw protocolError();
    const keys = Object.keys(item);
    if (keys.length > MAX_KEYS_PER_RECORD) throw protocolError();
    unknownItemKeyCount += keys.filter((key) => key !== "style_id" && key !== "name" && key !== "image").length;
    const styleId = boundedText(item.style_id, MAX_STYLE_ID_BYTES);
    const name = boundedText(item.name, MAX_STYLE_NAME_BYTES);
    const image = boundedText(item.image, MAX_STYLE_IMAGE_BYTES);
    if (styleId === null || name === null || image === null || ids.has(styleId)) throw protocolError();
    ids.add(styleId);
    idByteLengths.push(Buffer.byteLength(styleId, "utf8"));
    nameByteLengths.push(Buffer.byteLength(name, "utf8"));
    records.push(Object.freeze({ style_id: styleId, name, image }));
  }

  const summary: OwnerSoulStyleCatalogValidationSummary = Object.freeze({
    route: STYLES_ROUTE,
    response_bytes: responseBytes,
    record_count: records.length,
    total_matches: true,
    unique_ids: true,
    fields_valid: true,
    unknown_top_level_key_count: unknownTopLevelKeyCount,
    unknown_item_key_count: unknownItemKeyCount,
    style_id_utf8_bytes: Object.freeze({ min: Math.min(...idByteLengths), max: Math.max(...idByteLengths) }),
    name_utf8_bytes: Object.freeze({ min: Math.min(...nameByteLengths), max: Math.max(...nameByteLengths) })
  });
  return Object.freeze({ records: Object.freeze(records), summary });
}

function boundedText(value: unknown, maxBytes: number): string | null {
  if (typeof value !== "string" || value.length === 0 || CONTROL_CHARACTERS.test(value)) return null;
  const byteLength = Buffer.byteLength(value, "utf8");
  return byteLength > 0 && byteLength <= maxBytes ? value : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function protocolError(): OwnerSoulStyleCatalogHttpError {
  return new OwnerSoulStyleCatalogHttpError("UPSTREAM_PROTOCOL_ERROR");
}

async function readBoundedJsonBytes(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      await cancelBody(response);
      throw protocolError();
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new OwnerSoulStyleCatalogHttpError("UPSTREAM_REQUEST_ABORTED");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw protocolError();
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* best-effort cancellation */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

async function cancelBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* best-effort cancellation */ }
}
