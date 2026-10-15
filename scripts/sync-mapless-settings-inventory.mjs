#!/usr/bin/env node

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadPublicCatalogVersion } from "../dist/src/catalog/public-catalog-history.js";
import {
  archiveMaplessSettingsInventory,
  buildMaplessSettingsInventory
} from "../dist/src/catalog/mapless-settings-inventory.js";
import {
  analyzeMaplessCompiledModule,
  extractGenericSettingsKeys,
  extractPayloadFieldKeys,
  parseMaplessRegistryForms
} from "../dist/tools/mapless-settings-ast.js";
import { isMainModule } from "../dist/src/transports/is-main.js";

const VERSION = /^sha256-[a-f0-9]{64}\.json$/u;
const SOURCE_ORIGIN = "https://syntx.ai";
const MAX_REQUESTS = 64;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_APP_BYTES = 5 * 1024 * 1024;
const MAX_JS_BYTES = 2 * 1024 * 1024;
const TOTAL_TIMEOUT_MS = 300_000;
const REQUEST_TIMEOUT_MS = 30_000;
const SOURCE_CATALOG_DIRECTORY = fileURLToPath(new URL("../catalog", import.meta.url));

async function main(args = process.argv.slice(2), options = {}) {
  const publicVersion = parseArguments(args);
  const catalogDirectory = options.catalogDirectory ?? SOURCE_CATALOG_DIRECTORY;
  const publicCatalog = loadPublicCatalogVersion(publicVersion, catalogDirectory);
  const fetcher = createBoundedFetcher(options.fetchImpl ?? fetch);
  const started = Date.now();
  try {
    const homepage = await fetcher.call(`${SOURCE_ORIGIN}/`, MAX_HTML_BYTES, ["text/html"]);
    const buildIds = [...new Set([...homepage.text.matchAll(/\/assets\/(\d{6,20})\//gu)].map((match) => match[1]))];
    if (buildIds.length !== 1 || buildIds[0] === undefined) throw new Error("MAPLESS_BUILD_ID_AMBIGUOUS");
    const buildId = buildIds[0];
    const baseUrl = `${SOURCE_ORIGIN}/assets/${buildId}/`;
    if (!homepage.text.includes(`/assets/${buildId}/app.js`)) throw new Error("MAPLESS_APP_REFERENCE_MISSING");
    const app = await fetcher.call(`${baseUrl}app.js`, MAX_APP_BYTES, ["application/javascript", "application/x-javascript", "text/javascript"]);
    for (const moduleName of ["Settings2.js", "settings3.js", "useSettingsParams.js"]) {
      if (!app.text.includes(`assets/${buildId}/${moduleName}`)) throw new Error("MAPLESS_REQUIRED_IMPORT_MISSING");
    }

    const registrySource = await fetcher.call(`${baseUrl}Settings2.js`, MAX_JS_BYTES, ["application/javascript", "application/x-javascript", "text/javascript"]);
    const registryForms = parseMaplessRegistryForms(registrySource.text);
    const settings3Source = await fetcher.call(`${baseUrl}settings3.js`, MAX_JS_BYTES, ["application/javascript", "application/x-javascript", "text/javascript"]);
    const useSettingsParamsSource = await fetcher.call(`${baseUrl}useSettingsParams.js`, MAX_JS_BYTES, ["application/javascript", "application/x-javascript", "text/javascript"]);
    const knownSettingsKeys = new Set(publicCatalog.models.flatMap((model) => model.settings === null ? [] : Object.keys(model.settings)));
    const genericSettingKeys = extractGenericSettingsKeys(settings3Source.text, knownSettingsKeys);
    const payloadFieldKeys = extractPayloadFieldKeys(useSettingsParamsSource.text);

    const queue = [...registryForms];
    const modules = [];
    const errors = [];
    async function worker() {
      while (queue.length > 0) {
        const form = queue.shift();
        if (form === undefined) return;
        try {
          const result = await fetcher.call(`${baseUrl}${form.module_name}`, MAX_JS_BYTES, ["application/javascript", "application/x-javascript", "text/javascript"]);
          const analysis = analyzeMaplessCompiledModule(result.text, knownSettingsKeys);
          modules.push({
            form_id: form.form_id,
            module_name: form.module_name,
            javascript: {
              url: result.url,
              bytes: result.bytes,
              sha256: result.sha256,
              parse_diagnostics: analysis.parse_diagnostics,
              model_value_settings_keys: analysis.model_value_settings_keys,
              static_setting_defaults: analysis.static_setting_defaults
            }
          });
        } catch (error) {
          errors.push({ form_id: form.form_id, module_name: form.module_name, code: safeErrorCode(error) });
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    if (errors.length > 0) throw new Error(`MAPLESS_FORM_MODULE_FETCH_FAILED:${errors.map((entry) => entry.form_id).sort().join(",")}`);
    modules.sort((left, right) => left.form_id.localeCompare(right.form_id));
    const inventory = buildMaplessSettingsInventory({
      publicCatalog,
      publicVersion,
      generatedAt: new Date(started).toISOString(),
      buildId,
      homepageSha256: homepage.sha256,
      appSha256: app.sha256,
      registry: { url: registrySource.url, bytes: registrySource.bytes, sha256: registrySource.sha256 },
      framework: {
        settings3: { url: settings3Source.url, bytes: settings3Source.bytes, sha256: settings3Source.sha256, generic_setting_keys: genericSettingKeys },
        useSettingsParams: { url: useSettingsParamsSource.url, bytes: useSettingsParamsSource.bytes, sha256: useSettingsParamsSource.sha256, payload_field_keys: payloadFieldKeys }
      },
      forms: modules
    });
    const archived = await archiveMaplessSettingsInventory(inventory, catalogDirectory);
    const stats = fetcher.stats();
    process.stdout.write(`Mapless settings inventory ${archived.status}: build=${buildId} models=${inventory.summary.total_models} structural_matches=${inventory.summary.structurally_mapped_models} unknown_form=${inventory.summary.unknown_form_models} public_settings=${inventory.summary.models_with_public_settings} requests=${stats.requests} bytes=${stats.bytes} runtime_usable=false.\nversion=${archived.version}\n`);
    return archived;
  } finally {
    fetcher.close();
  }
}

function parseArguments(args) {
  if (args.length === 3 && args[0] === "--public-version" && VERSION.test(args[1] ?? "") && args[2] === "--confirm-source-fetch") return args[1];
  throw new Error("Usage: sync-mapless-settings-inventory.mjs --public-version sha256-<64-lowercase-hex>.json --confirm-source-fetch");
}

function createBoundedFetcher(fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  let requests = 0;
  let bytes = 0;
  const seen = new Set();
  return {
    stats: () => ({ requests, bytes }),
    close: () => { clearTimeout(timer); controller.abort(); },
    async call(url, maxBytes, mediaTypes) {
      const parsed = new URL(url);
      if (parsed.origin !== SOURCE_ORIGIN || requests >= MAX_REQUESTS || seen.has(url)) throw new Error("MAPLESS_REQUEST_INVALID");
      requests += 1;
      seen.add(url);
      let response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          headers: { accept: mediaTypes.join(", "), "accept-encoding": "identity" },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        });
      } catch { throw new Error("MAPLESS_SOURCE_FETCH_FAILED"); }
      if (!response.ok || response.redirected || response.url !== url) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error(`MAPLESS_SOURCE_HTTP_${response.status}`);
      }
      const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!mediaType || !mediaTypes.includes(mediaType)) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error("MAPLESS_SOURCE_MEDIA_TYPE_INVALID");
      }
      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null && (!/^\d{1,12}$/u.test(declaredLength) || Number(declaredLength) > maxBytes)) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error("MAPLESS_SOURCE_SIZE_INVALID");
      }
      if (response.body === null) throw new Error("MAPLESS_SOURCE_BODY_MISSING");
      const reader = response.body.getReader();
      const chunks = [];
      let responseBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          responseBytes += value.byteLength;
          bytes += value.byteLength;
          if (responseBytes > maxBytes || bytes > MAX_TOTAL_BYTES) {
            controller.abort();
            void reader.cancel().catch(() => undefined);
            throw new Error("MAPLESS_SOURCE_SIZE_LIMIT");
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        try { reader.releaseLock(); } catch { /* Best effort; the bounded error wins. */ }
      }
      const data = Buffer.concat(chunks, responseBytes);
      if (controller.signal.aborted) throw new Error("MAPLESS_SOURCE_FETCH_CLOSED");
      return { url: response.url, bytes: data.length, sha256: `sha256:${createHash("sha256").update(data).digest("hex")}`, text: new TextDecoder("utf-8", { fatal: true }).decode(data) };
    }
  };
}

function safeErrorCode(error) {
  if (error instanceof Error && error.message.startsWith("Usage: sync-mapless-settings-inventory.mjs ")) return error.message;
  return error instanceof Error && /^MAPLESS_[A-Z0-9_:-]+$/u.test(error.message) ? error.message : "MAPLESS_SOURCE_FAILED";
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}

export { main };
