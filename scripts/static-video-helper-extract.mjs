#!/usr/bin/env node
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublicCatalogVersion } from "../dist/src/catalog/public-catalog-history.js";
import { loadSettingsSourceInventoryVersion } from "../dist/src/catalog/settings-source-history.js";
import { derivePinnedHelperScopeFromInventory, fetchPinnedGenericHelperBundle } from "../dist/tools/settings-ir/v6/pinned-helper-bundle.js";
import { compileStaticEsmConstants, StaticEsmConstantsError } from "../dist/tools/settings-ir/v6/static-esm-constants.js";
import { archiveStaticVideoHelperResult, loadStaticVideoHelperResult, validateStaticVideoHelperResult } from "../dist/tools/settings-ir/v8/static-video-helper-result.js";
import { isMainModule } from "../dist/src/transports/is-main.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const VERSION = /^sha256-[a-f0-9]{64}\.json$/u;
const MODULE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u;
const USAGE = "Usage: static-video-helper-extract.mjs --probe|--archive --public-version sha256-<64-lowercase-hex>.json --settings-version sha256-<64-lowercase-hex>.json --modules constants.js,quality.js --confirm-source-fetch | --inspect --public-version sha256-<64-lowercase-hex>.json --settings-version sha256-<64-lowercase-hex>.json --version sha256-<64-lowercase-hex>.json";

export function parseArguments(args) {
  const mode = args[0];
  const common = args[1] === "--public-version" && exact(args[2]) && args[3] === "--settings-version" && exact(args[4]) && args[5] === "--modules" && modules(args[6]);
  if ((mode === "--probe" || mode === "--archive") && common && args.length === 8 && args[7] === "--confirm-source-fetch") return { mode: mode.slice(2), publicVersion: args[2], settingsVersion: args[4], modules: modules(args[6]), resultVersion: null };
  if (mode === "--inspect" && common && args.length === 9 && args[7] === "--version" && exact(args[8])) return { mode: "inspect", publicVersion: args[2], settingsVersion: args[4], modules: modules(args[6]), resultVersion: args[8] };
  throw new Error(USAGE);
}
export async function main(args = process.argv.slice(2), options = {}) {
  const projectRoot = options.projectRoot ?? ROOT;
  const mode = parseArguments(args);
  const catalog = join(projectRoot, "catalog");
  const publicCatalog = loadPublicCatalogVersion(mode.publicVersion, catalog);
  const inventory = loadSettingsSourceInventoryVersion(mode.settingsVersion, publicCatalog, catalog);
  const scopes = mode.modules.map((name) => derivePinnedHelperScopeFromInventory(inventory, name));
  if (mode.mode === "inspect") {
    const result = loadStaticVideoHelperResult(mode.resultVersion, inventory, publicCatalog, projectRoot);
    if (JSON.stringify(result.modules.map((item) => item.module_name)) !== JSON.stringify(mode.modules)) throw new Error("VIDEO_HELPER_RESULT_MODULES_MISMATCH");
    print("verified-offline", result, mode.resultVersion); return result;
  }
  const observedAt = new Date().toISOString(); const modulesOut = []; let requests = 0;
  for (const scope of scopes) {
    const bundle = await fetchPinnedGenericHelperBundle(scope, { confirmedSourceFetch: true, fetchImpl: async (url, init) => { requests += 1; if (requests > mode.modules.length * 2) throw new Error("VIDEO_HELPER_REQUEST_LIMIT"); return (options.fetchImpl ?? fetch)(url, init); } });
    modulesOut.push({ module_name: scope.module_name, scope: bundle.scope, sources: bundle.sources.map(({ content, ...identity }) => { const compiled = compileSource(content, identity.source_path); return { ...identity, local_function_scopes: compiled.scope, constants: compiled.result }; }) });
  }
  const result = validateStaticVideoHelperResult({ schema_version: 1, kind: "VIDEO_HELPER_STATIC_EXTRACTION", public_version: mode.publicVersion, settings_version: mode.settingsVersion, observed_at: observedAt, build_id: inventory.build.id, runtime_usable: false, closure: "OPEN", model_binding: "NOT_PROVEN", proof_scope: "DECLARATION_INITIALIZERS_ONLY", modules: modulesOut }, inventory, publicCatalog);
  if (mode.mode === "probe") { print("probed", result, null); return { status: "probed", result }; }
  const archived = await archiveStaticVideoHelperResult(result, inventory, publicCatalog, projectRoot);
  const reread = loadStaticVideoHelperResult(archived.version, inventory, publicCatalog, projectRoot);
  if (JSON.stringify(reread) !== JSON.stringify(result)) throw new Error("VIDEO_HELPER_RESULT_READBACK_FAILED");
  print(archived.status, result, archived.version); return archived;
}
function compileSource(content, sourcePath) {
  const composable = sourcePath.endsWith("/useLuma.js");
  try { return { scope: composable ? "COMPILED" : "NOT_REQUESTED", result: compileStaticEsmConstants({ source: content, sourcePath, localFunctionNames: composable ? ["useLumaSettings"] : [] }) }; }
  catch (error) { if (composable && error instanceof StaticEsmConstantsError && error.code === "LOCAL_FUNCTION_NOT_FOUND") return { scope: "SKIPPED_NOT_A_FUNCTION_DECLARATION", result: compileStaticEsmConstants({ source: content, sourcePath, localFunctionNames: [] }) }; throw error; }
}
function modules(value) { if (typeof value !== "string" || value.length === 0) return null; const list = value.split(","); if (list.some((item) => !MODULE.test(item)) || new Set(list).size !== list.length) return null; return list; }
function exact(value) { return typeof value === "string" && VERSION.test(value); }
function print(status, result, version) { const records = result.modules.flatMap((m) => m.sources.flatMap((s) => s.constants.records)); process.stdout.write(`Static video helper ${status}: modules=${result.modules.length} sources=${result.modules.reduce((n,m)=>n+m.sources.length,0)} static_values=${records.filter((r)=>r.status === "STATIC_VALUE").length} blocked=${records.filter((r)=>r.status === "BLOCKED").length} runtime_usable=false closure=OPEN model_binding=NOT_PROVEN.\n${version ? `version=${version}\n` : ""}`); }
export function safeErrorCode(error) { if (error instanceof StaticEsmConstantsError) return `STATIC_ESM_${error.code}`; return error instanceof Error && (/^VIDEO_HELPER_[A-Z_]+$/u.test(error.message) || error.message === USAGE) ? error.message : "VIDEO_HELPER_EXTRACT_FAILED"; }
if (isMainModule(import.meta.url)) main().catch((error) => { process.stderr.write(`${safeErrorCode(error)}\n`); process.exitCode = 1; });
