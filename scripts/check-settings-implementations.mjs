#!/usr/bin/env node
// Source-checkout only. No build, compiler execution, fetch, sync, or writes.
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_MARKERS = [
  "tsconfig.json",
  "tools/settings-ir/audit-stored-settings-implementations.ts",
  "tools/settings-ir/source-backed-result-toolchain.ts",
  "tools/settings-ir/generic-form-result-toolchain.ts",
  "src/catalog/normalized-settings-parser-source-backed-result.ts",
  "src/catalog/normalized-settings-parser-generic-form-result.ts"
];
const COMPILED_MARKERS = [
  "tools/settings-ir/audit-stored-settings-implementations.js",
  "tools/settings-ir/source-backed-result-toolchain.js",
  "tools/settings-ir/generic-form-result-toolchain.js"
];
const SAFE_ERRORS = new Set([
  "INVALID_ARGUMENT",
  "IMPLEMENTATION_AUDIT_REQUIRES_SOURCE_CHECKOUT",
  "IMPLEMENTATION_AUDIT_REQUIRES_PREBUILT_DIST",
  "SETTINGS_IMPLEMENTATION_AUDIT_INVALID"
]);

export async function runSettingsImplementationAuditCli(argv, options = {}) {
  const root = options.projectRoot ?? DEFAULT_ROOT;
  const writeOut = options.writeStdout ?? ((text) => process.stdout.write(text));
  const writeError = options.writeStderr ?? ((text) => process.stderr.write(text));
  try {
    if (!Array.isArray(argv) || argv.length !== 0) throw { code: "INVALID_ARGUMENT" };
    // Before project imports: installed packages intentionally omit tools/.
    if (!SOURCE_MARKERS.every((path) => existsSync(join(root, path)))) {
      throw { code: "IMPLEMENTATION_AUDIT_REQUIRES_SOURCE_CHECKOUT" };
    }
    if (!COMPILED_MARKERS.every((path) => existsSync(join(root, "dist", path)))) {
      throw { code: "IMPLEMENTATION_AUDIT_REQUIRES_PREBUILT_DIST" };
    }
    const load = options.importAudit ?? ((url) => import(url));
    const audit = await load(pathToFileURL(join(root, "dist/tools/settings-ir/audit-stored-settings-implementations.js")).href);
    const report = audit.auditStoredSettingsImplementations(root);
    writeOut(`${JSON.stringify(report)}\n`);
    return report.summary.drifted > 0 ? 2 : 0;
  } catch (error) {
    const code = SAFE_ERRORS.has(error?.code) ? error.code : "SETTINGS_IMPLEMENTATION_AUDIT_INVALID";
    writeError(`Settings implementation audit failed: ${code}.\n`);
    return 1;
  }
}

function isDirectExecution(argvPath) {
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution(process.argv[1])) {
  process.exitCode = await runSettingsImplementationAuditCli(process.argv.slice(2));
}
