#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const FORM_ID = "banana";
const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const targetPath = join(
  projectRoot,
  "catalog/runtime/v1/normalized-settings-parser-canary.json"
);
const sourceCheckoutMarkers = [
  "tsconfig.json",
  "src/catalog/normalized-settings-parser-canary.ts",
  "src/catalog/settings-source-inventory.ts",
  "tools/settings-ir/build-banana-parser-canary.ts",
  "tools/settings-ir/pinned-settings-source-loader.ts",
  "tools/settings-ir/static-settings-compiler.ts",
  "node_modules/typescript/bin/tsc"
].map((path) => join(projectRoot, path));
const compiledSourceModeModules = [
  "dist/src/catalog/normalized-settings-parser-canary.js",
  "dist/src/catalog/settings-source-inventory.js",
  "dist/src/catalog/syntx-public-catalog.js",
  "dist/tools/settings-ir/build-banana-parser-canary.js",
  "dist/tools/settings-ir/pinned-settings-source-loader.js",
  "dist/tools/settings-ir/static-settings-compiler.js"
].map((path) => join(projectRoot, path));

const SAFE_CANARY_ERROR_CODES = new Set([
  "PARSER_CANARY_DRIFT_DETECTED",
  "PARSER_CANARY_INVALID",
  "PARSER_OUTPUT_INVALID",
  "SOURCE_RELATIONSHIP_INVALID",
  "SOURCE_VALIDATION_FAILED"
]);

async function main() {
  const mode = parseArguments(process.argv.slice(2));

  // This guard intentionally precedes every project-module dynamic import and
  // every possible network call. Installed packages can validate the recorded
  // artifact offline, but cannot refresh or overwrite it.
  if (mode !== "check" && !hasSourceCheckout()) {
    throw new NormalizedSettingsParserCliError(
      "SOURCE_MODE_REQUIRES_SOURCE_CHECKOUT"
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
    const recordedText = await readFile(targetPath, "utf8");
    const recorded = runtime.loadNormalizedSettingsParserCanary({
      path: targetPath,
      publicCatalog,
      inventory
    });
    const canonicalText = runtime.serializeNormalizedSettingsParserCanary(
      recorded,
      publicCatalog,
      inventory
    );
    if (recordedText !== canonicalText) {
      throw new NormalizedSettingsParserCliError(
        "PARSER_CANARY_DRIFT_DETECTED"
      );
    }
    printSafeSummary("unchanged", "OFFLINE", recorded);
    return;
  }

  const sourceRuntime = await loadSourceModeModules();
  const material = await sourceRuntime.fetchPinnedSettingsFormSourceMaterial(
    inventory,
    FORM_ID
  );
  const compilerOutput =
    sourceRuntime.buildBananaParserCanaryCompilerOutput({
      source: material.source.content,
      sourceRef: {
        provider_javascript_sha256: material.artifacts.javascript.sha256,
        provider_source_map_sha256: material.artifacts.source_map.sha256,
        source_index: material.source.source_index,
        source_path: material.source.source_path,
        source_content_sha256: material.source.source_content_sha256
      }
    });
  const observed = runtime.buildNormalizedSettingsParserCanary({
    publicCatalog,
    inventory,
    compilerOutput
  });
  const observedText = runtime.serializeNormalizedSettingsParserCanary(
    observed,
    publicCatalog,
    inventory
  );

  if (mode === "check-source") {
    const recordedText = await readFile(targetPath, "utf8");
    const recorded = runtime.loadNormalizedSettingsParserCanary({
      path: targetPath,
      publicCatalog,
      inventory
    });
    runtime.assertNormalizedSettingsParserCanaryUnchanged(recorded, observed);
    if (recordedText !== observedText) {
      throw new NormalizedSettingsParserCliError(
        "PARSER_CANARY_DRIFT_DETECTED"
      );
    }
    printSafeSummary("unchanged", "PINNED_SOURCE", observed);
    return;
  }

  await atomicWriteFile(targetPath, observedText);
  printSafeSummary("updated", "PINNED_SOURCE", observed);
}

const CONFIRM_SOURCE_FETCH_FLAG = "--confirm-source-fetch";
const NETWORK_MODE_FLAGS = new Map([
  ["--check-source", "check-source"],
  ["--sync-source", "sync-source"],
]);

function parseArguments(argumentList) {
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
  throw new NormalizedSettingsParserCliError("INVALID_ARGUMENT");
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
    throw new NormalizedSettingsParserCliError("SOURCE_BUILD_FAILED");
  }
  if (!compiledSourceModeModules.every((path) => existsSync(path))) {
    throw new NormalizedSettingsParserCliError("SOURCE_BUILD_FAILED");
  }
}

async function loadRuntimeModules() {
  const [canary, inventory, publicCatalog] = await Promise.all([
    import("../dist/src/catalog/normalized-settings-parser-canary.js"),
    import("../dist/src/catalog/settings-source-inventory.js"),
    import("../dist/src/catalog/syntx-public-catalog.js")
  ]);
  return {
    assertNormalizedSettingsParserCanaryUnchanged:
      canary.assertNormalizedSettingsParserCanaryUnchanged,
    buildNormalizedSettingsParserCanary:
      canary.buildNormalizedSettingsParserCanary,
    loadNormalizedSettingsParserCanary:
      canary.loadNormalizedSettingsParserCanary,
    serializeNormalizedSettingsParserCanary:
      canary.serializeNormalizedSettingsParserCanary,
    loadSettingsSourceInventory: inventory.loadSettingsSourceInventory,
    loadSyntxPublicCatalogSnapshot:
      publicCatalog.loadSyntxPublicCatalogSnapshot
  };
}

async function loadSourceModeModules() {
  const [builder, sourceLoader] = await Promise.all([
    import("../dist/tools/settings-ir/build-banana-parser-canary.js"),
    import("../dist/tools/settings-ir/pinned-settings-source-loader.js")
  ]);
  return {
    buildBananaParserCanaryCompilerOutput:
      builder.buildBananaParserCanaryCompilerOutput,
    fetchPinnedSettingsFormSourceMaterial:
      sourceLoader.fetchPinnedSettingsFormSourceMaterial
  };
}

class NormalizedSettingsParserCliError extends Error {
  constructor(code) {
    super("SYNTX normalized settings parser CLI request was rejected.");
    this.name = "NormalizedSettingsParserCliError";
    this.code = code;
  }
}

async function atomicWriteFile(path, contents) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${directory}/.${basename(path)}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o644);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
    await unlink(temporaryPath).catch((error) => {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) {
        throw error;
      }
    });
  }
}

function printSafeSummary(status, verification, canary) {
  process.stdout.write(
    [
      `Normalized settings parser canary ${status}.`,
      `verification=${verification}`,
      `models=${canary.summary.scoped_models}`,
      `forms=${canary.summary.compiled_forms}`,
      `proven=${canary.summary.proven_projections}`,
      `absent=${canary.summary.absent_proven_projections}`,
      `blocked=${canary.summary.blocked_projections}`,
      `candidates=${canary.summary.blocked_projections_with_static_candidates}`,
      `form_blockers=${canary.summary.form_blockers}`,
      `model_blockers=${canary.summary.model_blockers}`,
      `compilation=${canary.compiler.compilation_status}`,
      `runtime_usable=${String(canary.runtime_usable)}`
    ].join(" ") + "\n"
  );
}

function safeErrorCode(error) {
  if (error instanceof NormalizedSettingsParserCliError) return error.code;
  if (
    error !== null &&
    typeof error === "object" &&
    typeof error.code === "string"
  ) {
    if (SAFE_CANARY_ERROR_CODES.has(error.code)) return error.code;
    if (
      error.name === "SettingsSourceInventoryError" ||
      error.name === "BananaParserCanaryCompilerError"
    ) {
      return "PINNED_SOURCE_VERIFICATION_FAILED";
    }
  }
  return "UNEXPECTED_ERROR";
}

main().catch((error) => {
  process.stderr.write(
    `Normalized settings parser canary failed: ${safeErrorCode(error)}.\n`
  );
  process.exitCode = 1;
});
