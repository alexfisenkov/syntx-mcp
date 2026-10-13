#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const targetPath = join(
  projectRoot,
  "catalog/runtime/v2/normalized-settings-parser-census-manifest.json"
);
const sourceCheckoutMarkers = [
  "tsconfig.json",
  "src/catalog/normalized-settings-parser-census-manifest.ts",
  "src/catalog/settings-source-inventory.ts",
  "src/catalog/syntx-public-catalog.ts",
  "tools/settings-ir/atomic-json-snapshot.ts",
  "node_modules/typescript/bin/tsc"
].map((path) => join(projectRoot, path));
const compiledSourceModeModules = [
  "dist/src/catalog/normalized-settings-parser-census-manifest.js",
  "dist/src/catalog/settings-source-inventory.js",
  "dist/src/catalog/syntx-public-catalog.js",
  "dist/tools/settings-ir/atomic-json-snapshot.js"
].map((path) => join(projectRoot, path));

const SAFE_MANIFEST_ERROR_CODES = new Set([
  "CENSUS_MANIFEST_DRIFT_DETECTED",
  "CENSUS_MANIFEST_INVALID",
  "SOURCE_RELATIONSHIP_INVALID",
  "SOURCE_VALIDATION_FAILED"
]);
const SAFE_SNAPSHOT_ERROR_CODES = new Set([
  "SNAPSHOT_REQUEST_INVALID",
  "SNAPSHOT_CONTENT_TOO_LARGE",
  "SNAPSHOT_TEMPORARY_COLLISION",
  "SNAPSHOT_CLEANUP_FAILED",
  "SNAPSHOT_WRITE_FAILED"
]);

async function main() {
  const mode = parseArguments(process.argv.slice(2));

  // This source-checkout guard intentionally precedes every project-module
  // dynamic import and every write. Installed packages can only validate the
  // recorded manifest offline; they cannot derive or replace it.
  if (mode !== "check" && !hasSourceCheckout()) {
    throw new NormalizedSettingsParserCensusCliError(
      "LOCAL_MODE_REQUIRES_SOURCE_CHECKOUT"
    );
  }
  if (mode !== "check") await rebuildSourceCheckout();

  const runtime = await loadRuntimeModules();
  const publicCatalog = runtime.loadSyntxPublicCatalogSnapshot();
  const inventory = runtime.loadSettingsSourceInventory(
    undefined,
    publicCatalog
  );

  if (mode === "check") {
    const recorded = runtime.loadNormalizedSettingsParserCensusManifest({
      path: targetPath,
      publicCatalog,
      inventory
    });
    const recordedText = await readFile(targetPath, "utf8");
    const canonicalText =
      runtime.serializeNormalizedSettingsParserCensusManifest(
        recorded,
        publicCatalog,
        inventory
      );
    if (recordedText !== canonicalText) {
      throw new NormalizedSettingsParserCensusCliError(
        "CENSUS_MANIFEST_DRIFT_DETECTED"
      );
    }
    printSafeSummary("unchanged", "OFFLINE", recorded);
    return;
  }

  const observed = runtime.buildNormalizedSettingsParserCensusManifest({
    publicCatalog,
    inventory
  });
  const observedText = runtime.serializeNormalizedSettingsParserCensusManifest(
    observed,
    publicCatalog,
    inventory
  );

  if (mode === "check-local") {
    const recorded = runtime.loadNormalizedSettingsParserCensusManifest({
      path: targetPath,
      publicCatalog,
      inventory
    });
    const recordedText = await readFile(targetPath, "utf8");
    runtime.assertNormalizedSettingsParserCensusManifestUnchanged(
      recorded,
      observed
    );
    if (recordedText !== observedText) {
      throw new NormalizedSettingsParserCensusCliError(
        "CENSUS_MANIFEST_DRIFT_DETECTED"
      );
    }
    printSafeSummary("unchanged", "LOCAL_INVENTORY", observed);
    return;
  }

  const sourceRuntime = await loadSourceModeModules();
  await sourceRuntime.writeAtomicJsonSnapshot(targetPath, observedText);
  printSafeSummary("updated", "LOCAL_INVENTORY", observed);
}

function parseArguments(argumentList) {
  if (argumentList.length !== 1) {
    throw new NormalizedSettingsParserCensusCliError("INVALID_ARGUMENT");
  }
  if (argumentList[0] === "--check") return "check";
  if (argumentList[0] === "--check-local") return "check-local";
  if (argumentList[0] === "--sync-local") return "sync-local";
  throw new NormalizedSettingsParserCensusCliError("INVALID_ARGUMENT");
}

function hasSourceCheckout() {
  return sourceCheckoutMarkers.every((path) => existsSync(path));
}

async function rebuildSourceCheckout() {
  try {
    await execFileAsync(
      process.execPath,
      [
        join(projectRoot, "node_modules/typescript/bin/tsc"),
        "-p",
        join(projectRoot, "tsconfig.json")
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 120_000
      }
    );
  } catch {
    throw new NormalizedSettingsParserCensusCliError("SOURCE_BUILD_FAILED");
  }
  if (!compiledSourceModeModules.every((path) => existsSync(path))) {
    throw new NormalizedSettingsParserCensusCliError("SOURCE_BUILD_FAILED");
  }
}

async function loadRuntimeModules() {
  const [census, inventory, publicCatalog] = await Promise.all([
    import(
      "../dist/src/catalog/normalized-settings-parser-census-manifest.js"
    ),
    import("../dist/src/catalog/settings-source-inventory.js"),
    import("../dist/src/catalog/syntx-public-catalog.js")
  ]);
  return {
    assertNormalizedSettingsParserCensusManifestUnchanged:
      census.assertNormalizedSettingsParserCensusManifestUnchanged,
    buildNormalizedSettingsParserCensusManifest:
      census.buildNormalizedSettingsParserCensusManifest,
    loadNormalizedSettingsParserCensusManifest:
      census.loadNormalizedSettingsParserCensusManifest,
    serializeNormalizedSettingsParserCensusManifest:
      census.serializeNormalizedSettingsParserCensusManifest,
    loadSettingsSourceInventory: inventory.loadSettingsSourceInventory,
    loadSyntxPublicCatalogSnapshot:
      publicCatalog.loadSyntxPublicCatalogSnapshot
  };
}

async function loadSourceModeModules() {
  const snapshot = await import(
    "../dist/tools/settings-ir/atomic-json-snapshot.js"
  );
  return { writeAtomicJsonSnapshot: snapshot.writeAtomicJsonSnapshot };
}

class NormalizedSettingsParserCensusCliError extends Error {
  constructor(code) {
    super("SYNTX normalized settings parser census CLI request was rejected.");
    this.name = "NormalizedSettingsParserCensusCliError";
    this.code = code;
  }
}

function printSafeSummary(status, verification, manifest) {
  process.stdout.write(
    [
      `Normalized settings parser census manifest ${status}.`,
      `verification=${verification}`,
      `forms=${manifest.summary.current_forms}`,
      `model_bearing_forms=${manifest.summary.current_model_bearing_forms}`,
      `zero_model_forms=${manifest.summary.current_zero_model_forms}`,
      `models=${manifest.summary.model_variants}`,
      `current_models=${manifest.summary.current_model_contexts}`,
      `legacy_models=${manifest.summary.legacy_no_form_models}`,
      `literal_models=${manifest.summary.literal_evidence_models}`,
      `dynamic_models=${manifest.summary.dynamic_current_models}`,
      `unbound_forms=${manifest.summary.unbound_provider_forms}`,
      `sources=${manifest.summary.source_refs}`,
      `compile_boundary=${manifest.summary.current_mapped_provider_source_refs}`,
      `deferred=${manifest.summary.deferred_source_refs}`,
      `locators=${manifest.summary.inventory_evidence_locators}`,
      `runtime_usable=${String(manifest.runtime_usable)}`
    ].join(" ") + "\n"
  );
}

function safeErrorCode(error) {
  if (error instanceof NormalizedSettingsParserCensusCliError) {
    return error.code;
  }
  if (
    error !== null &&
    typeof error === "object" &&
    typeof error.code === "string"
  ) {
    if (SAFE_MANIFEST_ERROR_CODES.has(error.code)) return error.code;
    if (SAFE_SNAPSHOT_ERROR_CODES.has(error.code)) return error.code;
    if (error.name === "SettingsSourceInventoryError") {
      return "SOURCE_VALIDATION_FAILED";
    }
  }
  return "UNEXPECTED_ERROR";
}

main().catch((error) => {
  process.stderr.write(
    `Normalized settings parser census failed: ${safeErrorCode(error)}.\n`
  );
  process.exitCode = 1;
});
