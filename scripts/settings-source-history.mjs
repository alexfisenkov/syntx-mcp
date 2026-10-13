#!/usr/bin/env node

import { lstatSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublicCatalogVersion } from "../dist/src/catalog/public-catalog-history.js";
import {
  archiveSettingsSourceInventory,
  loadSettingsSourceInventoryVersion
} from "../dist/src/catalog/settings-source-history.js";
import { refreshSettingsSourceInventory, SettingsSourceInventoryError } from "../dist/src/catalog/settings-source-inventory.js";
import { isMainModule } from "../dist/src/transports/is-main.js";

const VERSION = /^sha256-[a-f0-9]{64}\.json$/u;
const BUILD = /^\d{6,20}$/u;
const USAGE = "Usage: settings-source-history.mjs --archive --public-version sha256-<64-lowercase-hex>.json --build-id DIGITS --confirm-source-fetch | --inspect --public-version sha256-<64-lowercase-hex>.json --version sha256-<64-lowercase-hex>.json";

// Operator maintenance only. No latest pointer, MCP argument or runtime overlay.
export async function main(args = process.argv.slice(2), options = {}) {
  const mode = parseArguments(args);
  assertSourceCheckout();
  const catalog = loadPublicCatalogVersion(mode.publicVersion, options.catalogDirectory);
  if (mode.kind === "inspect") {
    const inventory = loadSettingsSourceInventoryVersion(mode.version, catalog, options.catalogDirectory);
    printSummary("verified-offline", inventory, mode.version, mode.publicVersion);
    return { status: "verified-offline", version: mode.version };
  }

  const requests = createBudgetedSettingsFetch(mode.buildId, options.fetchImpl ?? fetch);
  try {
    // generated_at is the start of observation, not an atomic frontend/API release.
    const inventory = await (options.refreshImpl ?? refreshSettingsSourceInventory)(catalog, {
      buildId: mode.buildId,
      generatedAt: (options.now ?? (() => new Date().toISOString()))(),
      fetchImpl: requests.fetchImpl,
      absoluteTimeoutMs: 300_000,
      maxJavaScriptBytes: 2 * 1024 * 1024,
      maxSourceMapBytes: 16 * 1024 * 1024,
      concurrency: 4,
      maxDirectDependencies: 128
    });
    // The refresher validates source pairs and mappings; the archive independently
    // validates the full inventory and its binding to this exact public snapshot.
    if (inventory.build.id !== mode.buildId) throw new Error("SETTINGS_HISTORY_BUILD_MISMATCH");
    const archived = await archiveSettingsSourceInventory(inventory, catalog, options.catalogDirectory);
    printSummary(archived.status, inventory, archived.version, mode.publicVersion);
    return archived;
  } catch (error) {
    // Only allowlisted module names and numeric HTTP/length metadata, never
    // response text. Keep failure diagnosis possible without repeating a batch.
    process.stderr.write(`Settings source observations=${JSON.stringify(requests.stats().observations)}\n`);
    throw error;
  } finally {
    requests.close();
    const stats = requests.stats();
    process.stdout.write(`Settings source requests=${stats.requests} consumed_bytes=${stats.bytes}.\n`);
  }
}

export function parseArguments(args) {
  if (args.length === 6 && args[0] === "--archive" && args[1] === "--public-version" && exact(VERSION, args[2]) && args[3] === "--build-id" && exact(BUILD, args[4]) && args[5] === "--confirm-source-fetch") {
    return { kind: "archive", publicVersion: args[2], buildId: args[4] };
  }
  if (args.length === 5 && args[0] === "--inspect" && args[1] === "--public-version" && exact(VERSION, args[2]) && args[3] === "--version" && exact(VERSION, args[4])) {
    return { kind: "inspect", publicVersion: args[2], version: args[4] };
  }
  throw new Error(USAGE);
}

export function assertSourceCheckout(root = fileURLToPath(new URL("../", import.meta.url))) {
  // A packaging boundary, not authentication against a hostile local operator.
  for (const name of ["src/catalog/settings-source-history.ts", "tsconfig.json"]) {
    try {
      const entry = lstatSync(join(root, name));
      if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("unsafe marker");
    } catch {
      throw new Error("SETTINGS_HISTORY_REQUIRES_SOURCE_CHECKOUT");
    }
  }
}

export function createBudgetedSettingsFetch(buildId, fetchImpl = fetch, limits = {}) {
  if (!exact(BUILD, buildId)) throw new Error("SETTINGS_HISTORY_BUILD_INVALID");
  const maxRequests = limits.maxRequests ?? 256;
  const maxBytes = limits.maxBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 256 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) {
    throw new Error("SETTINGS_HISTORY_BOUNDS_INVALID");
  }
  const prefix = `https://syntx.ai/assets/${buildId}/`;
  const seen = new Set();
  const abort = new AbortController();
  let bytes = 0;
  let requests = 0;
  const observations = [];
  return {
    stats: () => ({ requests, bytes, observations: observations.map((item) => ({ ...item })) }),
    close: () => abort.abort(),
    fetchImpl: async (url, init) => {
      if (abort.signal.aborted) throw new Error("SETTINGS_HISTORY_FETCH_CLOSED");
      if (typeof url !== "string" || !url.startsWith(prefix) || !exact(/^[A-Za-z0-9][A-Za-z0-9._-]*\.js(?:\.map)?$/u, url.slice(prefix.length)) || init?.method !== "GET" || init.credentials !== "omit" || init.redirect !== "manual" || init.signal == null) {
        throw new Error("SETTINGS_HISTORY_REQUEST_INVALID");
      }
      if (seen.has(url)) throw new Error("SETTINGS_HISTORY_REPEAT_REFUSED");
      if (requests >= maxRequests) throw new Error("SETTINGS_HISTORY_REQUEST_LIMIT");
      seen.add(url);
      requests++;
      const observation = { module: url.slice(prefix.length), status: null, declared_bytes: null, bytes: 0 };
      observations.push(observation);
      if (requests % 20 === 0) process.stdout.write(`Settings source progress: requests=${requests}.\n`);
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.any([init.signal, abort.signal]) });
      observation.status = response.status;
      const declared = response.headers.get("content-length");
      if (declared !== null && /^\d{1,12}$/u.test(declared)) observation.declared_bytes = Number(declared);
      if (abort.signal.aborted || init.signal.aborted) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error("SETTINGS_HISTORY_FETCH_CLOSED");
      }
      if (response.body === null) return response;
      const body = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          observation.bytes += chunk.byteLength;
          if (bytes > maxBytes) {
            abort.abort();
            controller.error(new Error("SETTINGS_HISTORY_BYTE_LIMIT"));
            return;
          }
          controller.enqueue(chunk);
        }
      }));
      const counted = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      // A new Response lacks network URL metadata. Preserve the actual value,
      // never the requested URL: the existing loader checks redirects strictly.
      Object.defineProperty(counted, "url", { value: response.url });
      return counted;
    }
  };
}

function exact(pattern, value) {
  return typeof value === "string" && pattern.exec(value)?.[0] === value;
}

function printSummary(status, inventory, version, publicVersion) {
  process.stdout.write(`Settings history ${status}: build=${inventory.build.id} families=${inventory.summary.public_ai_families} models=${inventory.summary.model_variants} forms=${inventory.summary.registry_forms} artifacts=${inventory.summary.source_artifacts} runtime_usable=false.\nversion=${version}\npublic_version=${publicVersion}\n`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    // Never print arbitrary provider bodies or schema values.
    const code = safeErrorCode(error);
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}

export function safeErrorCode(error) {
  if (error instanceof SettingsSourceInventoryError) return error.code;
  return error instanceof Error && (/^SETTINGS_[A-Z_]+$/u.test(error.message) || error.message === USAGE)
    ? error.message : "SETTINGS_HISTORY_FAILED";
}
