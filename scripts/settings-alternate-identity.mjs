#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadNormalizedSettingsParserCensusManifest, serializeNormalizedSettingsParserCensusManifest } from "../dist/src/catalog/normalized-settings-parser-census-manifest.js";
import { loadPublicCatalogVersion } from "../dist/src/catalog/public-catalog-history.js";
import { loadSettingsSourceInventoryVersion } from "../dist/src/catalog/settings-source-history.js";
import { loadSettingsSourceInventory } from "../dist/src/catalog/settings-source-inventory.js";
import { loadSyntxPublicCatalogSnapshot } from "../dist/src/catalog/syntx-public-catalog.js";
import { isMainModule } from "../dist/src/transports/is-main.js";
import { loadHelperConstantsResult } from "../dist/tools/settings-ir/v6/helper-constants-result.js";
import {
  archiveAlternateIdentityBindingResult,
  existingAlternateIdentityBindingVersions,
  loadAlternateIdentityBindingResult,
  resolveAlternateIdentityBindings,
  CURATED_TABLE_FINGERPRINT,
  serializeAlternateIdentityBindingResult
} from "../dist/tools/settings-ir/v7/alternate-identity-binding.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const VERSION = /^sha256-[a-f0-9]{64}\.json$/u;
const USAGE = "Usage: settings-alternate-identity.mjs --archive --helper-version sha256-<64-lowercase-hex>.json --public-version sha256-<64-lowercase-hex>.json --settings-version sha256-<64-lowercase-hex>.json --confirm-archive | --inspect --helper-version sha256-<64-lowercase-hex>.json --public-version sha256-<64-lowercase-hex>.json --settings-version sha256-<64-lowercase-hex>.json --version sha256-<64-lowercase-hex>.json";

/**
 * Fully offline — no network, no --confirm-source-fetch: every input (the
 * D-064 v6 helper-constants archive and the Gate C0 census manifest) is
 * already committed. See tools/settings-ir/v7/alternate-identity-binding.ts
 * for what this actually proves (and does not prove) about DEBT-041.
 *
 * --helper-version/--public-version/--settings-version identify the v6
 * archive to read (catalog/runtime/v6/<helper-version>) and the D-062/D-063
 * catalog/public and catalog/settings versions it was itself archived
 * against — the SAME three values settings-helper-constants.mjs's own
 * --archive run for that file already printed. Passing a --public-version/
 * --settings-version that is any OTHER existing pair fails at
 * loadHelperConstantsResult's own binding check, not silently.
 *
 * No toolchain/staleness binding (unlike settings-helper-constants.mjs's 19
 * hashed files): this module's own logic is a lookup-and-compare over
 * already-validated inputs, not an AST evaluator whose behavior could
 * silently regress the way v6's static-esm-constants.ts could — a
 * deliberate scope decision (D-072), not an oversight.
 *
 * --archive requires a trailing --confirm-archive even though there is no
 * network to gate (round-2 critic-risk WARN): catalog/runtime/v7/ is
 * append-only by project convention (D-052) with no supported delete path,
 * so a casual "just try it" invocation of the one write mode deserves the
 * same explicit-intent friction the project's other write CLIs already
 * require for their own irreversible step (--confirm-source-fetch).
 */
export function parseArguments(args) {
  if (
    args[0] === "--archive" &&
    args.length === 8 &&
    args[1] === "--helper-version" && exactVersion(args[2]) &&
    args[3] === "--public-version" && exactVersion(args[4]) &&
    args[5] === "--settings-version" && exactVersion(args[6]) &&
    args[7] === "--confirm-archive"
  ) {
    return { mode: "archive", helperVersion: args[2], publicVersion: args[4], settingsVersion: args[6], resultVersion: null };
  }
  if (
    args[0] === "--inspect" &&
    args.length === 9 &&
    args[1] === "--helper-version" && exactVersion(args[2]) &&
    args[3] === "--public-version" && exactVersion(args[4]) &&
    args[5] === "--settings-version" && exactVersion(args[6]) &&
    args[7] === "--version" && exactVersion(args[8])
  ) {
    return { mode: "inspect", helperVersion: args[2], publicVersion: args[4], settingsVersion: args[6], resultVersion: args[8] };
  }
  throw new Error(USAGE);
}

export async function main(args = process.argv.slice(2), options = {}) {
  const projectRoot = options.projectRoot ?? ROOT;
  const mode = parseArguments(args);
  const catalogDirectory = join(projectRoot, "catalog");
  const publicCatalog = loadPublicCatalogVersion(mode.publicVersion, catalogDirectory);
  const inventory = loadSettingsSourceInventoryVersion(mode.settingsVersion, publicCatalog, catalogDirectory);
  const helperResult = await loadHelperConstantsResult(mode.helperVersion, inventory, publicCatalog, projectRoot);

  const censusPublicCatalog = loadSyntxPublicCatalogSnapshot();
  const censusInventory = loadSettingsSourceInventory(undefined, censusPublicCatalog);
  const censusManifest = loadNormalizedSettingsParserCensusManifest({
    publicCatalog: censusPublicCatalog,
    inventory: censusInventory
  });
  const censusManifestSha256 = `sha256:${createHash("sha256")
    .update(serializeNormalizedSettingsParserCensusManifest(censusManifest, censusPublicCatalog, censusInventory))
    .digest("hex")}`;

  if (mode.mode === "inspect") {
    const result = await loadAlternateIdentityBindingResult(
      mode.resultVersion,
      mode.helperVersion,
      helperResult,
      censusManifest,
      censusPublicCatalog,
      censusInventory,
      projectRoot
    );
    printSummary("verified-offline", result, mode.resultVersion);
    return result;
  }

  if (existingAlternateIdentityBindingVersions(projectRoot, mode.helperVersion, censusManifestSha256).length > 0) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_ALREADY_EXISTS");
  }
  const entries = resolveAlternateIdentityBindings(helperResult, censusManifest);
  const result = {
    schema_version: 1,
    kind: "ALTERNATE_IDENTITY_BINDING",
    profile_fingerprint: CURATED_TABLE_FINGERPRINT,
    helper_result_version: mode.helperVersion,
    census_manifest_sha256: censusManifestSha256,
    observed_at: new Date().toISOString(),
    runtime_usable: false,
    entries
  };
  const archived = await archiveAlternateIdentityBindingResult(
    result,
    mode.helperVersion,
    helperResult,
    censusManifest,
    censusPublicCatalog,
    censusInventory,
    projectRoot
  );
  const reread = await loadAlternateIdentityBindingResult(
    archived.version,
    mode.helperVersion,
    helperResult,
    censusManifest,
    censusPublicCatalog,
    censusInventory,
    projectRoot
  );
  // Compared against the actual bytes just written, not against `result`
  // re-stringified — a key-order difference between the two would not be a
  // real discrepancy, and the file on disk is the fact that matters.
  const onDisk = await readFile(archived.path, "utf8");
  if (serializeAlternateIdentityBindingResult(reread) !== onDisk) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_READBACK_FAILED");
  }
  printSummary(archived.status, result, archived.version);
  return archived;
}

function printSummary(status, result, version) {
  process.stdout.write(
    `Alternate identity binding ${status}: forms=${result.entries.map((entry) => entry.form_id).join(",")} runtime_usable=false.\n` +
      (version !== null ? `version=${version}\n` : "")
  );
}

function exactVersion(value) {
  return typeof value === "string" && VERSION.exec(value)?.[0] === value;
}

// Round-2 critic-code: the original anchored regex only matched a bare
// ALTERNATE_IDENTITY_* code, so every detail-bearing error (the resolver's
// own "ALTERNATE_IDENTITY_VALUE_MISMATCH: expected X, held Y", or a
// same-layer HELPER_RESULT_*/PUBLIC_CATALOG_*/SETTINGS_SOURCE_* error from
// a dependency this CLI itself calls) collapsed to the same generic
// failure code — including the exact drift this module exists to report.
const KNOWN_CODE_PREFIX =
  /^((?:ALTERNATE_IDENTITY|HELPER_RESULT|PUBLIC_CATALOG|SETTINGS_SOURCE)_[A-Z_]+)(?::|$)/u;

export function safeErrorCode(error) {
  if (error instanceof Error && "code" in error && typeof error.code === "string" && /^IMMUTABLE_SNAPSHOT_[A-Z_]+$/u.test(error.code)) {
    return error.code;
  }
  if (error instanceof Error && error.message === USAGE) {
    return error.message;
  }
  const match = error instanceof Error ? KNOWN_CODE_PREFIX.exec(error.message) : null;
  return match ? match[1] : "ALTERNATE_IDENTITY_CLI_FAILED";
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}
