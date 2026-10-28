#!/usr/bin/env node

import { lstatSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSyntxPublicCatalogSnapshot,
  serializeSyntxPublicCatalogSnapshot,
  SYNTX_PUBLIC_CATALOG_ENDPOINTS
} from "../dist/src/catalog/syntx-public-catalog.js";
import {
  archivePublicCatalogSnapshot,
  loadSelectedPublicCatalog
} from "../dist/src/catalog/public-catalog-history.js";
import { CURRENT_DISCOVERY_READ_VERSION } from "../dist/src/catalog/selected-discovery-catalog.js";
import { isMainModule } from "../dist/src/transports/is-main.js";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
class PublicCatalogResponseLimitError extends Error {
  constructor(url) {
    super(`RESPONSE_TOO_LARGE: Public catalog GET exceeded the response limit for ${url}.`);
  }
}
export async function main(argumentsList = process.argv.slice(2), options = {}) {
  const mode = parseArguments(argumentsList);
  if (mode.kind === "archive") assertSourceCheckout();
  const selectedVersion = mode.version ?? (options.catalogDirectory === undefined
    ? process.env.SYNTX_PUBLIC_CATALOG_VERSION ?? CURRENT_DISCOVERY_READ_VERSION
    : undefined);
  // Resolve/check the selected local input before any network request.
  const existing = mode.kind !== "archive"
    ? loadSelectedPublicCatalog({
        ...(selectedVersion === undefined ? {} : { version: selectedVersion }),
        ...(options.catalogDirectory === undefined ? {} : { catalogDirectory: options.catalogDirectory })
      }).snapshot
    : undefined;
  if (mode.kind === "inspect") {
    printSafeSummary("verified-offline", existing);
    process.stdout.write(`version=${mode.version}\n`);
    return { status: "verified-offline", version: mode.version };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  // Sequential and bounded. A failure does not continue to later endpoints.
  const aiPayload = await fetchPublicJson(SYNTX_PUBLIC_CATALOG_ENDPOINTS.ai, fetchImpl);
  const modelsPayload = await fetchPublicJson(SYNTX_PUBLIC_CATALOG_ENDPOINTS.models, fetchImpl);
  const llmModelsPayload = await fetchPublicJson(SYNTX_PUBLIC_CATALOG_ENDPOINTS.llm_models, fetchImpl);
  let snapshot;
  try {
    snapshot = buildSyntxPublicCatalogSnapshot({
      aiPayload,
      llmModelsPayload,
      modelsPayload,
      fetchedAt: existing?.fetched_at ?? (options.now ?? (() => new Date().toISOString()))()
    });
  } catch {
    throw new Error("Public catalog payload failed the supported snapshot schema.");
  }
  if (existing !== undefined) {
    if (serializeSyntxPublicCatalogSnapshot(existing) !== serializeSyntxPublicCatalogSnapshot(snapshot)) {
      throw new Error("Public catalog drift detected. Preserve history; review a new --archive --confirm-source-fetch snapshot.");
    }
    printSafeSummary("unchanged", snapshot);
    return { status: "unchanged", version: selectedVersion ?? null };
  }
  const archived = await archivePublicCatalogSnapshot(snapshot, options.catalogDirectory);
  printSafeSummary(archived.status, snapshot);
  process.stdout.write(`version=${archived.version}\n`);
  return archived;
}

export function parseArguments(argumentsList) {
  if (argumentsList.length === 2 && argumentsList[0] === "--archive" && argumentsList[1] === "--confirm-source-fetch") {
    return { kind: "archive" };
  }
  if (argumentsList.length === 1 && argumentsList[0] === "--check") {
    return { kind: "check" };
  }
  if (argumentsList.length === 3 && ["--check", "--inspect"].includes(argumentsList[0]) && argumentsList[1] === "--version" && /^sha256-[a-f0-9]{64}\.json$/.test(argumentsList[2])) {
    return { kind: argumentsList[0] === "--check" ? "check" : "inspect", version: argumentsList[2] };
  }
  throw new Error("Usage: sync-public-catalog.mjs --archive --confirm-source-fetch | --check [--version sha256-<64-lowercase-hex>.json] | --inspect --version sha256-<64-lowercase-hex>.json. Historical snapshots are never overwritten.");
}

// Installed node_modules is not durable history storage. This is a packaging
// boundary, not an authorization boundary against a hostile local operator.
export function assertSourceCheckout(projectRoot = fileURLToPath(new URL("../", import.meta.url))) {
  for (const relative of ["src/catalog/public-catalog-history.ts", "tsconfig.json"]) {
    try {
      const entry = lstatSync(join(projectRoot, relative));
      if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("unsafe marker");
    } catch {
      throw new Error("PUBLIC_CATALOG_ARCHIVE_REQUIRES_SOURCE_CHECKOUT.");
    }
  }
}

export async function fetchPublicJson(url, fetchImpl = fetch) {
  if (!Object.values(SYNTX_PUBLIC_CATALOG_ENDPOINTS).includes(url)) {
    throw new Error("Public catalog URL is not allowlisted.");
  }
  const deadline = new RequestDeadline(REQUEST_TIMEOUT_MS);
  try {
    const fetchPromise = fetchImpl(url, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      headers: {
        accept: "application/json"
      },
      signal: deadline.signal
    }).then((response) => {
      if (deadline.signal.aborted) cancelBody(response.body);
      return response;
    });
    let response;
    try {
      response = await deadline.waitFor(fetchPromise);
    } catch {
      throw new Error(`Public catalog GET did not complete for ${url}.`);
    }

    if (
      response.redirected ||
      response.type === "opaqueredirect" ||
      (response.url.length > 0 && response.url !== url)
    ) {
      cancelBody(response.body);
      throw new Error(`Public catalog endpoint changed URL unexpectedly: ${url}.`);
    }
    if (!response.ok) {
      cancelBody(response.body);
      throw new Error(`Public catalog GET failed for ${url}: HTTP ${response.status}.`);
    }

    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.split(";")[0].trim() !== "application/json") {
      cancelBody(response.body);
      throw new Error(`Public catalog GET returned a non-JSON content type for ${url}.`);
    }

    const declaredLengthHeader = response.headers.get("content-length");
    if (declaredLengthHeader !== null) {
      const declaredLength = Number(declaredLengthHeader);
      if (
        !Number.isSafeInteger(declaredLength) ||
        declaredLength < 0 ||
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        cancelBody(response.body);
        throw new PublicCatalogResponseLimitError(url);
      }
    }

    let bytes;
    try {
      bytes = await readBoundedResponseBody(response, url, deadline);
    } catch (error) {
      if (error instanceof PublicCatalogResponseLimitError) throw error;
      throw new Error(`Public catalog GET body did not complete for ${url}.`);
    }

    let decoded;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`Public catalog GET returned invalid UTF-8 for ${url}.`);
    }

    try {
      return JSON.parse(decoded);
    } catch {
      throw new Error(`Public catalog GET returned invalid JSON for ${url}.`);
    }
  } finally {
    deadline.close();
  }
}

async function readBoundedResponseBody(response, url, deadline) {
  if (!response.body) {
    throw new Error(`Public catalog GET returned an empty body for ${url}.`);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await deadline.waitFor(reader.read());
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        cancelReader(reader);
        throw new PublicCatalogResponseLimitError(url);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A hostile stream may retain a pending read after the deadline.
    }
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

class RequestDeadline {
  #controller = new AbortController();
  #timer;
  #expired;

  constructor(milliseconds) {
    let expire = () => undefined;
    this.#expired = new Promise((_, reject) => {
      expire = reject;
    });
    this.#timer = setTimeout(() => {
      this.#controller.abort();
      expire(new Error("deadline"));
    }, milliseconds);
  }

  get signal() {
    return this.#controller.signal;
  }

  async waitFor(operation) {
    void operation.catch(() => undefined);
    return Promise.race([operation, this.#expired]);
  }

  close() {
    clearTimeout(this.#timer);
    this.#controller.abort();
  }
}

function cancelBody(body) {
  if (body === null) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // Best effort only: the safe sync error must win over cleanup failures.
  }
}

function cancelReader(reader) {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Best effort only: the safe sync error must win over cleanup failures.
  }
}

function printSafeSummary(status, snapshot) {
  process.stdout.write(
    [
      `Official public catalog ${status}.`,
      `fetched_at=${snapshot.fetched_at}`,
      `ai=${snapshot.summary.ai_total}`,
      `models=${snapshot.summary.model_total}`,
      `llm_models=${snapshot.summary.llm_model_total}`,
      `active_models=${snapshot.summary.model_active}`,
      `ai_sha256=${snapshot.sources.ai.canonical_sha256}`,
      `models_sha256=${snapshot.sources.models.canonical_sha256}`,
      `llm_models_sha256=${snapshot.sources.llm_models.canonical_sha256}`
    ].join(" ") + "\n"
  );
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown sync error.";
    process.stderr.write(`Public catalog sync failed: ${message}\n`);
    process.exitCode = 1;
  });
}
