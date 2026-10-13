import { TextDecoder } from "node:util";
import type { SyntxCredentialBroker } from "./http-client.js";
import { AbsoluteRequestDeadline } from "./request-deadline.js";

const V1_BASE_URL = new URL("https://api.syntx.ai/api/v1/");
const ROUTES = Object.freeze({
  styles: "hf/lora/styles",
  characters: "hf/lora/list"
} as const);
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_MAX_INSPECTED_ITEMS = 20 as const;
const MAX_INSPECTED_ITEMS = 128 as const;
const REQUEST_TIMEOUT_MS = 8_000;
const SAFE_SHAPE_KEYS = new Set([
  "items", "data", "styles", "characters", "list", "results",
  "value", "style_id", "lora_id", "reference_id", "id", "name", "image",
  "status", "model_type", "total", "page", "page_size", "has_more",
  "next", "count"
]);
const ARRAY_CONTAINER_KEYS = ["items", "data", "styles", "characters", "list", "results"] as const;

export type SoulCatalogShapeKind = keyof typeof ROUTES;
export type SoulCatalogJsonShapeType = "null" | "object" | "array" | "string" | "number" | "boolean";
export type SoulCatalogShapeOutcome = "SHAPE_OBSERVED" | "EMPTY_INCONCLUSIVE" | "UNRECOGNIZED_SHAPE";

export interface SoulCatalogShapeLevel {
  readonly fields: Readonly<Record<string, { readonly types: readonly SoulCatalogJsonShapeType[]; readonly occurrences: number }>>;
  readonly unknown_key_count: number;
}

export interface SoulCatalogShapeSummary {
  readonly kind: SoulCatalogShapeKind;
  readonly outcome: SoulCatalogShapeOutcome;
  readonly response_bytes: number;
  readonly top_level: SoulCatalogShapeLevel;
  readonly items: {
    readonly container_key: (typeof ARRAY_CONTAINER_KEYS)[number] | null;
    readonly item_count: number;
    readonly inspected_count: number;
    readonly truncated: boolean;
    readonly value_types: readonly SoulCatalogJsonShapeType[];
    readonly fields: SoulCatalogShapeLevel["fields"];
    readonly unknown_key_count: number;
  };
}

export interface OwnerSoulCatalogShapeHttpClientOptions {
  readonly credentialBroker: SyntxCredentialBroker;
  readonly fetchImpl?: typeof fetch;
  readonly maxInspectedItems?: typeof DEFAULT_MAX_INSPECTED_ITEMS | typeof MAX_INSPECTED_ITEMS;
}

export type OwnerSoulCatalogShapeHttpErrorCode =
  | "INVALID_REQUEST"
  | "AUTH_REQUIRED"
  | "AUTH_OR_ACCESS_DENIED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_REQUEST_ABORTED"
  | "UPSTREAM_PROTOCOL_ERROR";

export class OwnerSoulCatalogShapeHttpError extends Error {
  constructor(readonly code: OwnerSoulCatalogShapeHttpErrorCode) {
    super("The owner-scoped Soul catalog shape could not be read safely.");
    this.name = "OwnerSoulCatalogShapeHttpError";
  }
}

/** Fixed-route, bounded GET. It reports JSON structure only, never source values. */
export class OwnerSoulCatalogShapeHttpClient {
  readonly #credentialBroker: SyntxCredentialBroker;
  readonly #fetch: typeof fetch;
  readonly #maxInspectedItems: typeof DEFAULT_MAX_INSPECTED_ITEMS | typeof MAX_INSPECTED_ITEMS;

  constructor(options: OwnerSoulCatalogShapeHttpClientOptions) {
    const maxInspectedItems = options.maxInspectedItems ?? DEFAULT_MAX_INSPECTED_ITEMS;
    if (maxInspectedItems !== DEFAULT_MAX_INSPECTED_ITEMS && maxInspectedItems !== MAX_INSPECTED_ITEMS) {
      throw new OwnerSoulCatalogShapeHttpError("INVALID_REQUEST");
    }
    this.#credentialBroker = options.credentialBroker;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#maxInspectedItems = maxInspectedItems;
  }

  async inspect(kind: SoulCatalogShapeKind, signal?: AbortSignal): Promise<SoulCatalogShapeSummary> {
    if (kind !== "styles" && kind !== "characters") throw new OwnerSoulCatalogShapeHttpError("INVALID_REQUEST");
    const url = new URL(ROUTES[kind], V1_BASE_URL);
    const deadline = new AbsoluteRequestDeadline(REQUEST_TIMEOUT_MS, signal, () => new OwnerSoulCatalogShapeHttpError("UPSTREAM_REQUEST_ABORTED"));
    let callbackEntered = false;
    try {
      deadline.throwIfAborted();
      const operation = this.#credentialBroker.useCredential(async (credential) => {
        callbackEntered = true;
        if (typeof credential !== "string" || credential.trim().length < 8 || /[\u0000-\u001f\u007f]/u.test(credential)) {
          throw new OwnerSoulCatalogShapeHttpError("AUTH_REQUIRED");
        }
        deadline.throwIfAborted();
        const response = await deadline.waitFor(this.#fetch(url, {
          method: "GET",
          headers: { accept: "application/json", authorization: `Bearer ${credential}` },
          cache: "no-store",
          redirect: "error",
          signal: deadline.signal
        }));
        if (response.redirected || response.type === "opaqueredirect" || (response.url.length > 0 && response.url !== url.href)) {
          await cancelBody(response);
          throw new OwnerSoulCatalogShapeHttpError("UPSTREAM_PROTOCOL_ERROR");
        }
        if (!response.ok) {
          await cancelBody(response);
          throw new OwnerSoulCatalogShapeHttpError(response.status === 401 || response.status === 403
            ? "AUTH_OR_ACCESS_DENIED" : "UPSTREAM_UNAVAILABLE");
        }
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
          await cancelBody(response);
          throw new OwnerSoulCatalogShapeHttpError("UPSTREAM_PROTOCOL_ERROR");
        }
        const bytes = await deadline.waitFor(readBoundedJsonBytes(response, MAX_RESPONSE_BYTES, deadline.signal));
        let body: unknown;
        try {
          body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
        } catch {
          throw new OwnerSoulCatalogShapeHttpError("UPSTREAM_PROTOCOL_ERROR");
        }
        return summarizeShape(kind, body, bytes.byteLength, this.#maxInspectedItems);
      });
      return await deadline.waitFor(operation);
    } catch (error) {
      if (error instanceof OwnerSoulCatalogShapeHttpError) throw error;
      if (!callbackEntered) throw new OwnerSoulCatalogShapeHttpError("AUTH_REQUIRED");
      if (deadline.abortSource === "timeout") throw new OwnerSoulCatalogShapeHttpError("UPSTREAM_TIMEOUT");
      if (deadline.abortSource !== null) throw new OwnerSoulCatalogShapeHttpError("UPSTREAM_REQUEST_ABORTED");
      throw new OwnerSoulCatalogShapeHttpError("UPSTREAM_UNAVAILABLE");
    } finally {
      deadline.close();
    }
  }
}

function summarizeShape(kind: SoulCatalogShapeKind, value: unknown, responseBytes: number, maxInspectedItems: number): SoulCatalogShapeSummary {
  const rootArray = Array.isArray(value) ? value : null;
  const rootRecord = isRecord(value) ? value : null;
  const top = summarizeRecord(rootRecord);
  let containerKey: SoulCatalogShapeSummary["items"]["container_key"] = null;
  let items: unknown[] | null = rootArray;
  if (rootRecord !== null) {
    const candidates = ARRAY_CONTAINER_KEYS.filter((key) => Array.isArray(rootRecord[key]));
    if (candidates.length === 1) {
      containerKey = candidates[0]!;
      items = rootRecord[containerKey] as unknown[];
    } else {
      items = null;
    }
  }
  const inspected = (items ?? []).slice(0, maxInspectedItems);
  const itemFields = summarizeItems(inspected);
  const itemCount = items?.length ?? 0;
  const outcome: SoulCatalogShapeOutcome = items === null
    ? "UNRECOGNIZED_SHAPE"
    : itemCount === 0 ? "EMPTY_INCONCLUSIVE" : "SHAPE_OBSERVED";
  return Object.freeze({
    kind,
    outcome,
    response_bytes: responseBytes,
    top_level: top,
    items: Object.freeze({
      container_key: containerKey,
      item_count: itemCount,
      inspected_count: inspected.length,
      truncated: itemCount > inspected.length,
      value_types: uniqueTypes(inspected.map(jsonType)),
      fields: itemFields.fields,
      unknown_key_count: itemFields.unknown_key_count
    })
  });
}

function summarizeRecord(value: Record<string, unknown> | null): SoulCatalogShapeLevel {
  const fields: Record<string, { types: SoulCatalogJsonShapeType[]; occurrences: number }> = Object.create(null) as Record<string, { types: SoulCatalogJsonShapeType[]; occurrences: number }>;
  let unknown = 0;
  if (value !== null) {
    for (const key of Object.keys(value)) {
      if (!SAFE_SHAPE_KEYS.has(key)) { unknown += 1; continue; }
      const entry = fields[key] ??= { types: [], occurrences: 0 };
      entry.occurrences += 1;
      entry.types.push(jsonType(value[key]));
    }
  }
  return freezeLevel(fields, unknown);
}

function summarizeItems(items: readonly unknown[]): SoulCatalogShapeLevel {
  const fields: Record<string, { types: SoulCatalogJsonShapeType[]; occurrences: number }> = Object.create(null) as Record<string, { types: SoulCatalogJsonShapeType[]; occurrences: number }>;
  let unknown = 0;
  for (const item of items) {
    if (!isRecord(item)) continue;
    for (const key of Object.keys(item)) {
      if (!SAFE_SHAPE_KEYS.has(key)) { unknown += 1; continue; }
      const entry = fields[key] ??= { types: [], occurrences: 0 };
      entry.occurrences += 1;
      entry.types.push(jsonType(item[key]));
    }
  }
  return freezeLevel(fields, unknown);
}

function freezeLevel(fields: Record<string, { types: SoulCatalogJsonShapeType[]; occurrences: number }>, unknownCount: number): SoulCatalogShapeLevel {
  const frozen: Record<string, { types: readonly SoulCatalogJsonShapeType[]; occurrences: number }> = Object.create(null) as Record<string, { types: readonly SoulCatalogJsonShapeType[]; occurrences: number }>;
  for (const [key, summary] of Object.entries(fields)) {
    frozen[key] = Object.freeze({ types: uniqueTypes(summary.types), occurrences: summary.occurrences });
  }
  return Object.freeze({ fields: Object.freeze(frozen), unknown_key_count: unknownCount });
}

function uniqueTypes(types: readonly SoulCatalogJsonShapeType[]): readonly SoulCatalogJsonShapeType[] {
  return Object.freeze([...new Set(types)].sort());
}

function jsonType(value: unknown): SoulCatalogJsonShapeType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "object": return "object";
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "null";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedJsonBytes(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      await cancelBody(response);
      throw new OwnerSoulCatalogShapeHttpError("UPSTREAM_PROTOCOL_ERROR");
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new OwnerSoulCatalogShapeHttpError("UPSTREAM_REQUEST_ABORTED");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new OwnerSoulCatalogShapeHttpError("UPSTREAM_PROTOCOL_ERROR");
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* best-effort body cancellation */ }
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
  try { await response.body?.cancel(); } catch { /* best-effort body cancellation */ }
}
