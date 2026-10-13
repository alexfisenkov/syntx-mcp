#!/usr/bin/env node
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { loadPublicCatalogVersion } from "../dist/src/catalog/public-catalog-history.js";
import { loadSettingsSourceInventoryVersion } from "../dist/src/catalog/settings-source-history.js";
import { isMainModule } from "../dist/src/transports/is-main.js";
import { derivePinnedHelperScope, fetchPinnedHelperBundle } from "../dist/tools/settings-ir/v6/pinned-helper-bundle.js";
import { compileStaticEsmConstants, StaticEsmConstantsError } from "../dist/tools/settings-ir/v6/static-esm-constants.js";
import { archiveHelperConstantsResult, loadHelperConstantsResult, validateHelperConstantsResult, HELPER_MODULES, HELPER_SOURCE_PATHS } from "../dist/tools/settings-ir/v6/helper-constants-result.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const VERSION = /^sha256-[a-f0-9]{64}\.json$/u;
const USAGE = "Usage: settings-helper-constants.mjs --probe --public-version sha256-<64-lowercase-hex>.json --settings-version sha256-<64-lowercase-hex>.json --confirm-source-fetch | --archive --public-version sha256-<64-lowercase-hex>.json --settings-version sha256-<64-lowercase-hex>.json --confirm-source-fetch | --inspect --public-version sha256-<64-lowercase-hex>.json --settings-version sha256-<64-lowercase-hex>.json --version sha256-<64-lowercase-hex>.json";
const TOOLCHAIN_PATHS = [
  "tools/settings-ir/v6/pinned-helper-bundle.ts",
  "tools/settings-ir/v6/static-esm-constants.ts",
  "tools/settings-ir/v6/helper-constants-result.ts",
  "tools/settings-ir/immutable-json-snapshot.ts",
  "src/catalog/settings-source-inventory.ts",
  "src/catalog/settings-source-history.ts",
  "src/catalog/public-catalog-history.ts",
  "src/catalog/syntx-public-catalog.ts",
  "src/transports/is-main.ts"
].flatMap((path) => [path, `dist/${path.replace(/\.ts$/u, ".js")}`]).concat("scripts/settings-helper-constants.mjs").sort();

export function parseArguments(args) {
  const mode = args[0];
  if ((mode === "--probe" || mode === "--archive") && args.length === 6 &&
      args[1] === "--public-version" && exactVersion(args[2]) &&
      args[3] === "--settings-version" && exactVersion(args[4]) && args[5] === "--confirm-source-fetch") {
    return { mode: mode.slice(2), publicVersion: args[2], settingsVersion: args[4], resultVersion: null };
  }
  if (mode === "--inspect" && args.length === 7 &&
      args[1] === "--public-version" && exactVersion(args[2]) &&
      args[3] === "--settings-version" && exactVersion(args[4]) &&
      args[5] === "--version" && exactVersion(args[6])) {
    return { mode: "inspect", publicVersion: args[2], settingsVersion: args[4], resultVersion: args[6] };
  }
  throw new Error(USAGE);
}

/** Operator-only maintenance. These records never enable runtime settings. */
export async function main(args = process.argv.slice(2), options = {}) {
  const projectRoot = options.projectRoot ?? ROOT;
  // The toolchain integrity binding always reads this checkout's real source in production;
  // only a test may redirect it, and only together with a matching projectRoot.
  const sourceRoot = options.sourceRoot ?? ROOT;
  const catalogDirectory = join(projectRoot, "catalog");
  const mode = parseArguments(args);
  for (const path of TOOLCHAIN_PATHS) readToolchainFile(join(sourceRoot, path));
  assertToolchainFresh(sourceRoot);
  const publicCatalog = loadPublicCatalogVersion(mode.publicVersion, catalogDirectory);
  const inventory = loadSettingsSourceInventoryVersion(mode.settingsVersion, publicCatalog, catalogDirectory);
  const toolchain = getToolchain(sourceRoot);
  if (mode.mode === "inspect") {
    const result = await loadHelperConstantsResult(mode.resultVersion, inventory, publicCatalog, projectRoot);
    if (result.public_version !== mode.publicVersion || result.settings_version !== mode.settingsVersion) throw new Error("HELPER_RESULT_BINDING_MISMATCH");
    if (JSON.stringify(result.toolchain) !== JSON.stringify(toolchain)) throw new Error("HELPER_RESULT_IMPLEMENTATION_DRIFT");
    printSummary("verified-offline", result, mode.resultVersion);
    return result;
  }
  // Create-once per (public_version, settings_version) pair, not per whole directory: a later
  // catalog/inventory version must still get its own archive alongside older ones (D-052).
  // Refuse before any network spend rather than accumulate undated duplicates for the same pair
  // (observed_at makes every run content-address to a different file, so a name collision alone
  // can never be relied on to catch a repeat).
  if (mode.mode === "archive" && existingArchiveVersions(projectRoot, mode.publicVersion, mode.settingsVersion).length > 0) {
    throw new Error("HELPER_RESULT_ALREADY_EXISTS");
  }
  // Validate every scope before any request; a new unknown source requires review.
  const scopes = HELPER_MODULES.map((name) => derivePinnedHelperScope(inventory, name));
  for (const scope of scopes) {
    const paths = scope.source_map.source_map.settings_sources.map((source) => source.source_path);
    if (JSON.stringify(paths) !== JSON.stringify(HELPER_SOURCE_PATHS[scope.module_name])) throw new Error("HELPER_RESULT_SCOPE_CHANGED");
  }
  const observedAt = new Date().toISOString();
  const modules = [];
  let requests = 0;
  const budget = new AbortController();
  const deadline = setTimeout(() => budget.abort(),120_000);
  try {
    for (const scope of scopes) {
      const bundle = await fetchPinnedHelperBundle(scope, {
        confirmedSourceFetch:true, signal:budget.signal,
        fetchImpl: async (url,init) => {
          if (++requests > 4) throw new Error("HELPER_RESULT_REQUEST_LIMIT");
          return (options.fetchImpl ?? fetch)(url,init);
        }
      });
      modules.push({module_name:scope.module_name,scope:bundle.scope,sources:bundle.sources.map(({content,...identity}) => {
        const compiled = compileSourceConstants(identity,content);
        return {...identity,local_function_scopes:compiled.local_function_scopes,constants:compiled.constants};
      })});
    }
    // Check the recorded files again: concurrent changes require reconciliation.
    if (JSON.stringify(toolchain) !== JSON.stringify(getToolchain(sourceRoot))) throw new Error("HELPER_RESULT_IMPLEMENTATION_DRIFT");
    const result = validateHelperConstantsResult({
      schema_version:1,kind:"HELPER_CONSTANT_INITIALIZERS",public_version:mode.publicVersion,
      settings_version:mode.settingsVersion,observed_at:observedAt,build_id:inventory.build.id,
      runtime_usable:false,closure:"OPEN",model_binding:"NOT_PROVEN",root_forms_compiled:false,
      toolchain,modules
    },inventory,publicCatalog);
    if (mode.mode === "probe") { printSummary("probed",result,null); return {status:"probed",result}; }
    if (existingArchiveVersions(projectRoot, mode.publicVersion, mode.settingsVersion).length > 0) throw new Error("HELPER_RESULT_ALREADY_EXISTS");
    const archived = await archiveHelperConstantsResult(result,inventory,publicCatalog,projectRoot);
    const reread = await loadHelperConstantsResult(archived.version,inventory,publicCatalog,projectRoot);
    if (JSON.stringify(reread) !== JSON.stringify(result)) throw new Error("HELPER_RESULT_READBACK_FAILED");
    printSummary(archived.status,result,archived.version);
    return archived;
  } finally {
    clearTimeout(deadline);
    budget.abort();
    process.stdout.write(`Helper source requests=${requests}.\n`);
  }
}

/** LOCAL_FUNCTION_NOT_FOUND means the requested scope is not a plain function declaration
 * (e.g. an arrow assigned to a const) in the real vendor source; module-scope constants
 * are still worth recording rather than losing the whole source over one missing scope.
 * `local_function_scopes` records which of the three outcomes actually happened, so a
 * degraded result is never silently indistinguishable from "nothing to compile there". */
function compileSourceConstants(identity,content) {
  const wantsComposable = identity.source_path.endsWith("/composables/useLuma.js");
  if (!wantsComposable) {
    return {local_function_scopes:"NOT_REQUESTED",constants:compileStaticEsmConstants({source:content,sourcePath:identity.source_path,localFunctionNames:[]})};
  }
  try {
    return {local_function_scopes:"COMPILED",constants:compileStaticEsmConstants({source:content,sourcePath:identity.source_path,localFunctionNames:["useLumaSettings"]})};
  } catch (error) {
    if (error instanceof StaticEsmConstantsError && error.code === "LOCAL_FUNCTION_NOT_FOUND") {
      return {local_function_scopes:"SKIPPED_NOT_A_FUNCTION_DECLARATION",constants:compileStaticEsmConstants({source:content,sourcePath:identity.source_path,localFunctionNames:[]})};
    }
    throw error;
  }
}

function existingArchiveVersions(projectRoot, publicVersion, settingsVersion) {
  const directory = join(projectRoot,"catalog","runtime","v6");
  let entries;
  try { entries = readdirSync(directory,{withFileTypes:true}); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !VERSION.test(entry.name)) continue;
    let parsed;
    try { parsed = JSON.parse(readFileSync(join(directory,entry.name),"utf8")); }
    catch { continue; }
    if (parsed && typeof parsed === "object" && parsed.public_version === publicVersion && parsed.settings_version === settingsVersion) {
      matches.push(entry.name);
    }
  }
  return matches;
}

/** Best-effort staleness heuristic: an edited .ts newer than its own dist/*.js almost
 * always means a forgotten "npm run build", not a legitimately stale checkout. This does
 * not replace an isolated build (unlike the generic/v5/source-backed CLIs) and can be
 * fooled by clock skew or a manually touched file. */
function assertToolchainFresh(sourceRoot) {
  for (const path of TOOLCHAIN_PATHS) {
    if (!path.endsWith(".ts")) continue;
    const distPath = `dist/${path.slice(0,-3)}.js`;
    if (!TOOLCHAIN_PATHS.includes(distPath)) continue;
    if (statSync(join(sourceRoot,distPath)).mtimeMs < statSync(join(sourceRoot,path)).mtimeMs) throw new Error("HELPER_CLI_STALE_BUILD");
  }
}

function getToolchain(sourceRoot) {
  return {scope:"RECORDED_FILES_ONLY",typescript_version:ts.version,files:TOOLCHAIN_PATHS.map((path) => ({path,sha256:`sha256:${createHash("sha256").update(readToolchainFile(join(sourceRoot,path))).digest("hex")}`}))};
}
function readToolchainFile(path) {
  let symlink;
  try { symlink = lstatSync(path); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error("HELPER_CLI_REQUIRES_SOURCE_CHECKOUT");
    throw error;
  }
  if (symlink.isSymbolicLink()) throw new Error("HELPER_CLI_REQUIRES_SOURCE_CHECKOUT");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 4*1024*1024) throw new Error("HELPER_CLI_REQUIRES_SOURCE_CHECKOUT");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("HELPER_RESULT_IMPLEMENTATION_DRIFT");
    return bytes;
  } finally { closeSync(fd); }
}
function exactVersion(value) { return typeof value === "string" && VERSION.exec(value)?.[0] === value; }
function printSummary(status,result,version) {
  const records = result.modules.flatMap((module) => module.sources.flatMap((source) => source.constants.records));
  process.stdout.write(`Helper constants ${status}: modules=${result.modules.length} sources=${result.modules.reduce((n,module) => n+module.sources.length,0)} static_values=${records.filter((record) => record.status === "STATIC_VALUE").length} blocked=${records.filter((record) => record.status === "BLOCKED").length} runtime_usable=false closure=OPEN model_binding=NOT_PROVEN.\n${version !== null ? `version=${version}\n` : ""}`);
}
export function safeErrorCode(error) {
  if (error instanceof StaticEsmConstantsError) return `STATIC_ESM_${error.code}`;
  if (error instanceof Error && "code" in error && typeof error.code === "string" && /^(?:SETTINGS_V6_HELPER|HELPER|STATIC_ESM|IMMUTABLE_SNAPSHOT)_[A-Z_]+$/u.test(error.code)) return error.code;
  return error instanceof Error && (/^HELPER_[A-Z_]+$/u.test(error.message) || error.message === USAGE) ? error.message : "HELPER_CLI_FAILED";
}
if (isMainModule(import.meta.url)) main().catch((error) => { process.stderr.write(`${safeErrorCode(error)}\n`); process.exitCode = 1; });
