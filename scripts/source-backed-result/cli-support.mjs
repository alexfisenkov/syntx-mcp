// Argument parsing (including the --confirm-source-fetch gate),
// source-checkout detection, safe stdout summary, and the direct-execution
// guard used at the bottom of the main script. Stateless module-level —
// keep it that way: the main file imports this same module under multiple
// ?test-only query strings, which give separate module instances only for
// the main file itself, not for shared submodules like this one.

import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SourceBackedResultCliError } from "./errors.mjs";
import { sourceCheckoutMarkers } from "./paths.mjs";

const CONFIRM_SOURCE_FETCH_FLAG = "--confirm-source-fetch";
const NETWORK_MODE_FLAGS = new Map([
  ["--probe-source", "probe-source"],
  ["--check-source", "check-source"],
  ["--sync-source", "sync-source"],
]);

export function parseArguments(argumentList) {
  if (argumentList.length === 1 && argumentList[0] === "--check") {
    return "check";
  }
  if (
    argumentList.length === 2 &&
    argumentList[1] === CONFIRM_SOURCE_FETCH_FLAG
  ) {
    const mode = NETWORK_MODE_FLAGS.get(argumentList[0]);
    if (mode !== undefined) return mode;
  }
  throw new SourceBackedResultCliError("INVALID_ARGUMENT");
}

export function hasSourceCheckout() {
  return sourceCheckoutMarkers.every((path) => existsSync(path));
}

export function printSafeSummary(status, verification, result) {
  process.stdout.write(
    [
      `Normalized settings source-backed C1a result ${status}.`,
      `verification=${verification}`,
      `forms=${result.coverage.declared_forms}/${result.coverage.c0_forms}`,
      `models=${result.coverage.declared_models}/${result.coverage.c0_models}`,
      `sources=${result.coverage.verified_source_refs}/${result.coverage.c0_source_refs}`,
      `unscoped_sources=${result.coverage.unscoped_c0_source_refs}`,
      `proven=${result.coverage.proven_projections}`,
      `absent=${result.coverage.absent_proven_projections}`,
      `blocked=${result.coverage.blocked_projections}`,
      `runtime_usable=${String(result.runtime_usable)}`,
    ].join(" ") + "\n",
  );
}

export function __testOnlyIsDirectExecution(argvPath, moduleUrl) {
  if (
    typeof argvPath !== "string" ||
    argvPath.length === 0 ||
    moduleUrl.includes("?test-only")
  )
    return false;
  try {
    return (
      realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(moduleUrl))
    );
  } catch {
    return false;
  }
}
