#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNormalizedSettingsIrCanaryUnchanged,
  buildNormalizedSettingsIrCanary,
  loadNormalizedSettingsIrCanary,
  NormalizedSettingsIrError,
  serializeNormalizedSettingsIrCanary
} from "../dist/src/catalog/normalized-settings-ir.js";
import { loadSettingsSourceInventory } from "../dist/src/catalog/settings-source-inventory.js";
import { loadSyntxPublicCatalogSnapshot } from "../dist/src/catalog/syntx-public-catalog.js";

const CANARY_MODEL_IDS = ["banana", "banana2", "banana3", "banana3_light"];
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const targetPath = fileURLToPath(
  new URL(
    "../catalog/runtime/v1/normalized-settings-ir-canary.json",
    import.meta.url
  )
);

async function main() {
  const { mode } = parseArguments(process.argv.slice(2));
  if (
    mode === "sync" &&
    (!existsSync(`${projectRoot}tsconfig.json`) ||
      !existsSync(`${projectRoot}src/catalog/normalized-settings-ir.ts`))
  ) {
    throw new NormalizedSettingsIrCliError("SYNC_REQUIRES_SOURCE_CHECKOUT");
  }
  const publicCatalog = loadSyntxPublicCatalogSnapshot();
  const inventory = loadSettingsSourceInventory(undefined, publicCatalog);
  const observed = buildNormalizedSettingsIrCanary({
    publicCatalog,
    inventory,
    modelIds: CANARY_MODEL_IDS
  });
  const observedText = serializeNormalizedSettingsIrCanary(
    observed,
    publicCatalog,
    inventory
  );

  if (mode === "check") {
    const recordedText = await readFile(targetPath, "utf8");
    const recorded = loadNormalizedSettingsIrCanary({
      path: targetPath,
      publicCatalog,
      inventory
    });
    assertNormalizedSettingsIrCanaryUnchanged(recorded, observed);
    if (recordedText !== observedText) {
      throw new NormalizedSettingsIrError("CANARY_DRIFT_DETECTED");
    }
    printSafeSummary("unchanged", observed);
    return;
  }

  await atomicWriteFile(targetPath, observedText);
  printSafeSummary("updated", observed);
}

function parseArguments(argumentList) {
  if (argumentList.length === 1 && argumentList[0] === "--check") {
    return { mode: "check" };
  }
  if (argumentList.length === 1 && argumentList[0] === "--sync") {
    return { mode: "sync" };
  }
  throw new TypeError(
    "Usage: sync-normalized-settings-ir.mjs (--check|--sync)"
  );
}

class NormalizedSettingsIrCliError extends Error {
  constructor(code) {
    super("SYNTX normalized settings IR CLI request was rejected.");
    this.name = "NormalizedSettingsIrCliError";
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

function printSafeSummary(status, canary) {
  process.stdout.write(
    [
      `Normalized settings IR canary evidence shell ${status}.`,
      `models=${canary.summary.scoped_models}`,
      `partial=${canary.summary.partial_models}`,
      `locators=${canary.summary.field_locators}`,
      `compilation=${canary.source_scope.compilation_status}`,
      `runtime_usable=${String(canary.runtime_usable)}`
    ].join(" ") + "\n"
  );
}

main().catch((error) => {
  const code =
    error instanceof NormalizedSettingsIrError
      ? error.code
      : error instanceof NormalizedSettingsIrCliError
        ? error.code
        : error instanceof TypeError
          ? "INVALID_ARGUMENT"
          : "UNEXPECTED_ERROR";
  process.stderr.write(`Normalized settings IR canary failed: ${code}.\n`);
  process.exitCode = 1;
});
