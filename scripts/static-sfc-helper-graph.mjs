#!/usr/bin/env node
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublicCatalogVersion } from "../dist/src/catalog/public-catalog-history.js";
import { loadSettingsSourceInventoryVersion } from "../dist/src/catalog/settings-source-history.js";
import { fetchProviderSourceBundleV10, makeStaticSfcHelperGraphResultV10, archiveStaticSfcHelperGraphResult, loadStaticSfcHelperGraphResult } from "../dist/tools/settings-ir/v10/static-sfc-helper-graph-result.js";
import { isMainModule } from "../dist/src/transports/is-main.js";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const VERSION = /^sha256-[a-f0-9]{64}\.json$/u;
const FORM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const USAGE = "Usage: static-sfc-helper-graph.mjs --probe|--archive --public-version sha256-<64-lowercase-hex>.json --settings-version sha256-<64-lowercase-hex>.json --form-id FORM_ID --confirm-source-fetch | --inspect --public-version VERSION --settings-version VERSION --form-id FORM_ID --version VERSION";
export function parseArguments(args) {
  if ((args[0] === "--probe" || args[0] === "--archive") && args.length === 8 && args[1] === "--public-version" && VERSION.test(args[2]) && args[3] === "--settings-version" && VERSION.test(args[4]) && args[5] === "--form-id" && FORM.test(args[6]) && args[7] === "--confirm-source-fetch") return { mode: args[0].slice(2), publicVersion: args[2], settingsVersion: args[4], formId: args[6] };
  if (args[0] === "--inspect" && args.length === 9 && args[1] === "--public-version" && VERSION.test(args[2]) && args[3] === "--settings-version" && VERSION.test(args[4]) && args[5] === "--form-id" && FORM.test(args[6]) && args[7] === "--version" && VERSION.test(args[8])) return { mode: "inspect", publicVersion: args[2], settingsVersion: args[4], formId: args[6], resultVersion: args[8] };
  throw new Error(USAGE);
}
export async function main(args = process.argv.slice(2), options = {}) {
  const mode = parseArguments(args); const root = options.projectRoot ?? ROOT; const catalog = join(root, "catalog"); const pub = loadPublicCatalogVersion(mode.publicVersion, catalog); const inv = loadSettingsSourceInventoryVersion(mode.settingsVersion, pub, catalog);
  if (mode.mode === "inspect") { const result = loadStaticSfcHelperGraphResult(mode.resultVersion, inv, pub, root); if (result.form_id !== mode.formId) throw new Error("STATIC_SFC_GRAPH_FORM_MISMATCH"); process.stdout.write(`Static SFC helper graph verified offline: form=${mode.formId} nodes=${result.graph.nodes.length} unresolved=${result.graph.unresolved_imports.length} runtime_usable=false.\n`); return result; }
  const bundle = await fetchProviderSourceBundleV10(mode.formId, inv, { confirmedSourceFetch: true, fetchImpl: options.fetchImpl }); const result = makeStaticSfcHelperGraphResultV10(mode.formId, bundle.providerSource, inv, pub, bundle); if (mode.mode === "probe") { process.stdout.write(`Static SFC helper graph probed: form=${mode.formId} nodes=${result.graph.nodes.length} unresolved=${result.graph.unresolved_imports.length} runtime_usable=false.\n`); return { status: "probed", result }; }
  const archived = await archiveStaticSfcHelperGraphResult(result, inv, pub, root); const reread = loadStaticSfcHelperGraphResult(archived.version, inv, pub, root); if (JSON.stringify(reread) !== JSON.stringify(result)) throw new Error("STATIC_SFC_GRAPH_READBACK_FAILED"); process.stdout.write(`Static SFC helper graph ${archived.status}: form=${mode.formId} version=${archived.version} runtime_usable=false.\n`); return archived;
}
export function safeErrorCode(error) { return error instanceof Error && (/^STATIC_SFC_GRAPH_[A-Z_]+$/u.test(error.message) || error.message === USAGE) ? error.message : "STATIC_SFC_GRAPH_FAILED"; }
if (isMainModule(import.meta.url)) main().catch((error) => { process.stderr.write(`${safeErrorCode(error)}\n`); process.exitCode = 1; });
