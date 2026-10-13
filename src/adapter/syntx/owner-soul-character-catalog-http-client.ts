import { TextDecoder } from "node:util";
import type { SyntxCredentialBroker } from "./http-client.js";
import { AbsoluteRequestDeadline } from "./request-deadline.js";

const V1_BASE_URL = new URL("https://api.syntx.ai/api/v1/");
const CHARACTERS_ROUTE = "hf/lora/list";
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_CHARACTER_RECORDS = 128;
const MAX_KEYS_PER_RECORD = 64;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ID_BYTES = 256;
const MAX_TITLE_BYTES = 256;
const MAX_STATUS_BYTES = 64;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const CHARACTER_STATUSES = ["not-ready", "in-progress", "queue", "error", "completed"] as const;

export type SoulCharacterReferenceId = string | number;
export type SoulCharacterStatus = (typeof CHARACTER_STATUSES)[number] | "unknown";

/** Private decoded row. `record_id` is the UI key/delete namespace; `reference_id` is the selectable value. */
export interface OwnerSoulCharacterCatalogRecord {
  readonly record_id: SoulCharacterReferenceId;
  readonly reference_id: SoulCharacterReferenceId | null;
  readonly title: string;
  readonly status: string;
  readonly selectable: boolean;
}

export interface OwnerSoulCharacterCatalogValidationSummary {
  readonly route: typeof CHARACTERS_ROUTE;
  readonly response_bytes: number;
  readonly outcome: "SHAPE_OBSERVED" | "EMPTY_INCONCLUSIVE";
  readonly record_count: number;
  readonly total_matches: true;
  readonly selectable_count: number;
  readonly status_counts: Readonly<Record<SoulCharacterStatus, number>>;
  readonly record_id_type_counts: { readonly string: number; readonly number: number };
  readonly reference_id_type_counts: { readonly string: number; readonly number: number; readonly null: number; readonly missing: number };
  readonly title_utf8_bytes: { readonly min: number; readonly max: number };
  readonly unknown_top_level_key_count: number;
  readonly unknown_item_key_count: number;
}

/** Private typed data plus a value-free summary for a later owner-bound capability layer. */
export interface OwnerSoulCharacterCatalogSnapshot {
  readonly records: readonly OwnerSoulCharacterCatalogRecord[];
  readonly summary: OwnerSoulCharacterCatalogValidationSummary;
}

export interface OwnerSoulCharacterCatalogHttpClientOptions {
  readonly credentialBroker: SyntxCredentialBroker;
  readonly fetchImpl?: typeof fetch;
}

export type OwnerSoulCharacterCatalogHttpErrorCode =
  | "INVALID_REQUEST"
  | "AUTH_REQUIRED"
  | "AUTH_OR_ACCESS_DENIED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_REQUEST_ABORTED"
  | "UPSTREAM_PROTOCOL_ERROR";

export class OwnerSoulCharacterCatalogHttpError extends Error {
  constructor(readonly code: OwnerSoulCharacterCatalogHttpErrorCode) {
    super("The owner-scoped Soul Character list could not be decoded safely.");
    this.name = "OwnerSoulCharacterCatalogHttpError";
  }
}

/** Internal fixed-route reader. It does not train, delete, upload, or generate. */
export class OwnerSoulCharacterCatalogHttpClient {
  readonly #credentialBroker: SyntxCredentialBroker;
  readonly #fetch: typeof fetch;

  constructor(options: OwnerSoulCharacterCatalogHttpClientOptions) {
    this.#credentialBroker = options.credentialBroker;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  async listCharacters(signal?: AbortSignal): Promise<OwnerSoulCharacterCatalogSnapshot> {
    const url = new URL(CHARACTERS_ROUTE, V1_BASE_URL);
    const deadline = new AbsoluteRequestDeadline(REQUEST_TIMEOUT_MS, signal,
      () => new OwnerSoulCharacterCatalogHttpError("UPSTREAM_REQUEST_ABORTED"));
    let credentialCallbackEntered = false;
    try {
      deadline.throwIfAborted();
      const request = this.#credentialBroker.useCredential(async (credential) => {
        credentialCallbackEntered = true;
        if (typeof credential !== "string" || credential.trim().length < 8 || CONTROL_CHARACTERS.test(credential)) {
          throw new OwnerSoulCharacterCatalogHttpError("AUTH_REQUIRED");
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
          throw protocolError();
        }
        if (!response.ok) {
          await cancelBody(response);
          throw new OwnerSoulCharacterCatalogHttpError(response.status === 401 || response.status === 403
            ? "AUTH_OR_ACCESS_DENIED" : "UPSTREAM_UNAVAILABLE");
        }
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
          await cancelBody(response);
          throw protocolError();
        }
        const bytes = await deadline.waitFor(readBoundedJsonBytes(response, MAX_RESPONSE_BYTES, deadline.signal));
        let body: unknown;
        try {
          body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
        } catch {
          throw protocolError();
        }
        return decodeCharacterList(body, bytes.byteLength);
      });
      return await deadline.waitFor(request);
    } catch (error) {
      if (error instanceof OwnerSoulCharacterCatalogHttpError) throw error;
      if (!credentialCallbackEntered) throw new OwnerSoulCharacterCatalogHttpError("AUTH_REQUIRED");
      if (deadline.abortSource === "timeout") throw new OwnerSoulCharacterCatalogHttpError("UPSTREAM_TIMEOUT");
      if (deadline.abortSource !== null) throw new OwnerSoulCharacterCatalogHttpError("UPSTREAM_REQUEST_ABORTED");
      throw new OwnerSoulCharacterCatalogHttpError("UPSTREAM_UNAVAILABLE");
    } finally {
      deadline.close();
    }
  }
}

function decodeCharacterList(value: unknown, responseBytes: number): OwnerSoulCharacterCatalogSnapshot {
  if (!isPlainRecord(value)) throw protocolError();
  const topKeys = Object.keys(value);
  if (topKeys.length > MAX_KEYS_PER_RECORD) throw protocolError();
  const unknownTopLevelKeyCount = topKeys.filter((key) => key !== "items" && key !== "total").length;
  const items = value.items;
  const total = value.total;
  if (!Array.isArray(items) || items.length > MAX_CHARACTER_RECORDS ||
      typeof total !== "number" || !Number.isSafeInteger(total) || total !== items.length) {
    throw protocolError();
  }

  const recordIds = new Set<string>();
  const selectableReferenceIds = new Set<string>();
  const records: OwnerSoulCharacterCatalogRecord[] = [];
  const statusCounts: Record<SoulCharacterStatus, number> = {
    "not-ready": 0, "in-progress": 0, queue: 0, error: 0, completed: 0, unknown: 0
  };
  const recordIdTypeCounts = { string: 0, number: 0 };
  const referenceIdTypeCounts = { string: 0, number: 0, null: 0, missing: 0 };
  let selectableCount = 0;
  let unknownItemKeyCount = 0;
  const titleByteLengths: number[] = [];

  for (const item of items) {
    if (!isPlainRecord(item)) throw protocolError();
    const keys = Object.keys(item);
    if (keys.length > MAX_KEYS_PER_RECORD) throw protocolError();
    unknownItemKeyCount += keys.filter((key) => !["id", "reference_id", "title", "status"].includes(key)).length;

    const recordId = parseCharacterId(item.id);
    const title = boundedText(item.title, MAX_TITLE_BYTES);
    const rawStatus = boundedText(item.status, MAX_STATUS_BYTES);
    if (recordId === null || title === null || rawStatus === null) throw protocolError();
    const recordIdentity = typedIdentity(recordId);
    if (recordIds.has(recordIdentity)) throw protocolError();
    recordIds.add(recordIdentity);
    if (typeof recordId === "number") recordIdTypeCounts.number += 1;
    else recordIdTypeCounts.string += 1;
    titleByteLengths.push(Buffer.byteLength(title, "utf8"));

    const status: SoulCharacterStatus = (CHARACTER_STATUSES as readonly string[]).includes(rawStatus)
      ? rawStatus as SoulCharacterStatus : "unknown";
    statusCounts[status] += 1;
    const hasReferenceId = Object.hasOwn(item, "reference_id");
    const rawReferenceId = item.reference_id;
    let referenceId: SoulCharacterReferenceId | null = null;
    if (!hasReferenceId || rawReferenceId === null) {
      if (status === "completed") throw protocolError();
      referenceIdTypeCounts[hasReferenceId ? "null" : "missing"] += 1;
    } else {
      const parsedReferenceId = parseCharacterId(rawReferenceId);
      if (parsedReferenceId === null) throw protocolError();
      referenceId = parsedReferenceId;
      if (typeof parsedReferenceId === "number") referenceIdTypeCounts.number += 1;
      else referenceIdTypeCounts.string += 1;
    }

    const selectable = status === "completed" && referenceId !== null;
    if (status === "completed" && referenceId !== null) {
      const referenceIdentity = typedIdentity(referenceId);
      if (selectableReferenceIds.has(referenceIdentity)) throw protocolError();
      selectableReferenceIds.add(referenceIdentity);
      selectableCount += 1;
    }
    records.push(Object.freeze({ record_id: recordId, reference_id: referenceId, title, status: rawStatus, selectable }));
  }

  const summary: OwnerSoulCharacterCatalogValidationSummary = Object.freeze({
    route: CHARACTERS_ROUTE,
    response_bytes: responseBytes,
    outcome: records.length === 0 ? "EMPTY_INCONCLUSIVE" : "SHAPE_OBSERVED",
    record_count: records.length,
    total_matches: true,
    selectable_count: selectableCount,
    status_counts: Object.freeze({ ...statusCounts }),
    record_id_type_counts: Object.freeze({ ...recordIdTypeCounts }),
    reference_id_type_counts: Object.freeze({ ...referenceIdTypeCounts }),
    title_utf8_bytes: Object.freeze({
      min: titleByteLengths.length === 0 ? 0 : Math.min(...titleByteLengths),
      max: titleByteLengths.length === 0 ? 0 : Math.max(...titleByteLengths)
    }),
    unknown_top_level_key_count: unknownTopLevelKeyCount,
    unknown_item_key_count: unknownItemKeyCount
  });
  return Object.freeze({ records: Object.freeze(records), summary });
}

function parseCharacterId(value: unknown): SoulCharacterReferenceId | null {
  if (typeof value === "string") return boundedText(value, MAX_ID_BYTES);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  return null;
}

function typedIdentity(value: SoulCharacterReferenceId): string {
  return `${typeof value}:${typeof value === "string" ? value : value.toString(10)}`;
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

function protocolError(): OwnerSoulCharacterCatalogHttpError {
  return new OwnerSoulCharacterCatalogHttpError("UPSTREAM_PROTOCOL_ERROR");
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
      if (signal.aborted) throw new OwnerSoulCharacterCatalogHttpError("UPSTREAM_REQUEST_ABORTED");
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
