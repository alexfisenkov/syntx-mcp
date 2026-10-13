#!/usr/bin/env node

/** Build one immutable generic settings result against explicit versioned inputs. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const VERSION = /^sha256-[a-f0-9]{64}\.json$/u;
const FORM = /^[a-z0-9][a-z0-9-]{0,63}$/u;

function parse(args) {
  if (args.length !== 6 || args[0] !== "--public-version" || args[2] !== "--settings-version" || args[4] !== "--census-version" || !VERSION.test(args[1]) || !VERSION.test(args[3]) || !VERSION.test(args[5])) throw new Error("INVALID_ARGUMENT");
  const formId = process.env.SYNTX_VERSIONED_FORM_ID;
  if (formId === undefined || !FORM.test(formId)) throw new Error("FORM_ID_REQUIRED");
  return { publicVersion: args[1], settingsVersion: args[3], censusVersion: args[5], formId };
}

async function main() {
  const { publicVersion, settingsVersion, censusVersion, formId } = parse(process.argv.slice(2));
  const [publicHistory, settingsHistory, census, toolchain, writer] = await Promise.all([
    import("../dist/src/catalog/public-catalog-history.js"),
    import("../dist/src/catalog/settings-source-history.js"),
    import("../dist/src/catalog/normalized-settings-parser-census-manifest.js"),
    import("../dist/tools/settings-ir/generic-form-result-toolchain.js"),
    import("../dist/tools/settings-ir/atomic-json-snapshot.js")
  ]);
  const catalog = publicHistory.loadPublicCatalogVersion(publicVersion);
  const inventory = settingsHistory.loadSettingsSourceInventoryVersion(settingsVersion, catalog);
  const censusPath = join(ROOT, "catalog/runtime/v8", censusVersion);
  const censusManifest = census.loadNormalizedSettingsParserCensusManifest({ path: censusPath, publicCatalog: catalog, inventory });
  const censusText = readFileSync(censusPath, "utf8");
  const result = formId === "seedance"
    ? await buildNumberedBundleResult({ toolchain, census, formId, catalog, inventory, censusManifest, censusText })
    : await toolchain.buildGenericFormResultFromPinnedSource({ formId, confirmedSourceFetch: true, publicCatalog: catalog, inventory, censusManifest, censusArtifactText: censusText });
  const serialized = (await import("../dist/src/catalog/normalized-settings-parser-generic-form-result.js")).serializeNormalizedSettingsParserGenericFormResult(result);
  // The public/settings pair, not generated_at, defines the create-once
  // identity. The full input hashes make a second run of the same pair collide
  // deterministically despite generated_at/sourceObservedAt timestamps.
  const output = join(ROOT, "catalog/runtime/v8/generic", `${formId}-${publicVersion.slice(7, 71)}-${settingsVersion.slice(7, 71)}.json`);
  if (existsSync(output)) throw new Error("GENERIC_RESULT_VERSION_ALREADY_EXISTS");
  await writer.writeAtomicJsonSnapshot(output, serialized);
  process.stdout.write(`Versioned generic result created. form=${formId} models=${result.scope.model_ids.length} runtime_usable=${String(result.runtime_usable)}\npath=${output}\npublic_version=${publicVersion}\nsettings_version=${settingsVersion}\ncensus_version=${censusVersion}\n`);
}

async function buildNumberedBundleResult({ toolchain, census, formId, catalog, inventory, censusManifest, censusText }) {
  const derived = (await import("../dist/tools/settings-ir/generic-form-adapter-input-from-manifest.js")).deriveGenericFormAdapterInputFromManifest(censusManifest, formId);
  const artifacts = inventory.source_artifacts.filter((a) => a.role === "PROVIDER_FORM" && a.form_id === formId);
  const javascript = artifacts.find((a) => a.kind === "JAVASCRIPT");
  const sourceMap = artifacts.find((a) => a.kind === "SOURCE_MAP_V3");
  if (!javascript || !sourceMap || !sourceMap.source_map) throw new Error("SEEDANCE_PAIRED_SOURCE_MISSING");
  const [jsBytes, mapBytes] = await Promise.all([fetchBounded(javascript.url, 16 * 1024 * 1024), fetchBounded(sourceMap.url, 32 * 1024 * 1024)]);
  if (sha256(jsBytes) !== javascript.sha256 || sha256(mapBytes) !== sourceMap.sha256) throw new Error("SEEDANCE_SOURCE_HASH_MISMATCH");
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(mapBytes));
  const expectedPath = `/src/components/chat/forms/settings/${formId}.vue`;
  const index = (parsed.sources ?? []).findIndex((value) => normalizeSourcePath(value) === expectedPath);
  const content = index >= 0 ? parsed.sourcesContent?.[index] : undefined;
  const expected = sourceMap.source_map.settings_sources.find((s) => s.source_path === expectedPath);
  if (typeof content !== "string" || !expected || sha256Text(content) !== expected.source_content_sha256) throw new Error("SEEDANCE_SOURCE_CONTENT_MISMATCH");
  const sourceRef = { provider_javascript_sha256: javascript.sha256, provider_source_map_sha256: sourceMap.sha256, source_index: expected.source_index, source_path: expected.source_path, source_content_sha256: expected.source_content_sha256 };
  const compiled = (await import("../dist/tools/settings-ir/build-generic-form-parser-canary.js")).buildGenericFormParserCanaryCompilerOutput({ source: content, sourceRef, formId, expectedAiName: derived.adapterInput.expectedAiName, modelIds: derived.adapterInput.modelIds, auxiliarySourceRefIds: derived.adapterInput.auxiliarySourceRefIds });
  return toolchain.assembleGenericFormResult({ compiled, derived, censusManifest, censusArtifactText: censusText, publicCatalog: catalog, inventory, sourceObservedAt: new Date().toISOString(), generatedAt: new Date().toISOString(), implementationComponents: toolchain.buildImplementationComponentRecords() });
}

async function fetchBounded(url, maxBytes) {
  const parsed = new URL(url);
  if (parsed.origin !== "https://syntx.ai" || !parsed.pathname.startsWith("/assets/")) throw new Error("SOURCE_URL_UNSAFE");
  const response = await fetch(url, { method: "GET", credentials: "omit", redirect: "manual", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || response.redirected) throw new Error("SOURCE_FETCH_FAILED");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("SOURCE_TOO_LARGE");
  return bytes;
}

function sha256(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function sha256Text(text) { return sha256(new TextEncoder().encode(text)); }
function normalizeSourcePath(value) {
  if (typeof value !== "string") return "";
  if (value.startsWith("/src/")) return value;
  return value.replace(/^.*?(\/src\/)/u, "/src/");
}

main().catch((error) => {
  process.stderr.write(`Versioned generic result failed: ${error instanceof Error ? error.message : "UNEXPECTED_ERROR"}.\n`);
  process.exitCode = 1;
});
