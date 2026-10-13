#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  assertSettingsSourceInventoryUnchanged,
  loadSettingsSourceInventory,
  refreshSettingsSourceInventory,
  serializeSettingsSourceInventory,
  SettingsSourceInventoryError
} from "../dist/src/catalog/settings-source-inventory.js";
import { loadSyntxPublicCatalogSnapshot } from "../dist/src/catalog/syntx-public-catalog.js";

const DEFAULT_BUILD_ID = "1788368942";
const targetPath = fileURLToPath(
  new URL(
    "../catalog/runtime/v1/settings-source-inventory.json",
    import.meta.url
  )
);

async function main() {
  const argumentsValue = parseArguments(process.argv.slice(2));
  if (!argumentsValue.checkOnly) {
    process.stderr.write("SETTINGS_HISTORY_OVERWRITE_REFUSED: use settings-source-history.mjs --archive with an explicit public version, build and --confirm-source-fetch.\n");
    process.exitCode = 1;
    return;
  }
  const publicCatalog = loadSyntxPublicCatalogSnapshot();
  let generatedAt = new Date().toISOString();
  let buildId = argumentsValue.buildId ?? DEFAULT_BUILD_ID;
  let existingText;

  if (argumentsValue.checkOnly) {
    existingText = await readFile(targetPath, "utf8");
    const existing = loadSettingsSourceInventory(targetPath);
    generatedAt = existing.generated_at;
    buildId = existing.build.id;
    if (
      argumentsValue.buildId !== undefined &&
      argumentsValue.buildId !== buildId
    ) {
      throw new TypeError(
        "--build-id cannot differ from the recorded build in --check mode."
      );
    }
  }

  const inventory = await refreshSettingsSourceInventory(publicCatalog, {
    buildId,
    generatedAt
  });
  const inventoryText = serializeSettingsSourceInventory(inventory);

  if (argumentsValue.checkOnly) {
    const existing = loadSettingsSourceInventory(targetPath);
    assertSettingsSourceInventoryUnchanged(existing, inventory);
    if (existingText !== inventoryText) {
      throw new SettingsSourceInventoryError("SOURCE_DRIFT_DETECTED");
    }
    printSafeSummary("unchanged", inventory);
    return;
  }

}

function parseArguments(argumentList) {
  let checkOnly = false;
  let buildId;
  for (let index = 0; index < argumentList.length; index += 1) {
    const argument = argumentList[index];
    if (argument === "--check" && !checkOnly) {
      checkOnly = true;
      continue;
    }
    if (argument === "--build-id" && buildId === undefined) {
      buildId = argumentList[index + 1];
      index += 1;
      if (buildId === undefined || !/^\d{6,20}$/u.test(buildId)) {
        throw new TypeError("--build-id requires a numeric build identifier.");
      }
      continue;
    }
    throw new TypeError(
      "Usage: sync-settings-source-inventory.mjs [--check] [--build-id DIGITS]"
    );
  }
  return { checkOnly, buildId };
}

function printSafeSummary(status, inventory) {
  process.stdout.write(
    [
      `Settings source inventory ${status}.`,
      `build=${inventory.build.id}`,
      `families=${inventory.summary.public_ai_families}`,
      `forms=${inventory.summary.registry_forms}`,
      `unbound_forms=${inventory.summary.unbound_registry_forms}`,
      `models=${inventory.summary.model_variants}`,
      `literal=${inventory.summary.literal_reference_evidence}`,
      `dynamic=${inventory.summary.dynamic_family_form}`,
      `legacy=${inventory.summary.legacy_inactive_no_form}`,
      `artifacts=${inventory.summary.source_artifacts}`
    ].join(" ") + "\n"
  );
}

main().catch((error) => {
  const code =
    error instanceof SettingsSourceInventoryError
      ? error.code
      : error instanceof TypeError
        ? "INVALID_ARGUMENT"
        : "UNEXPECTED_ERROR";
  process.stderr.write(`Settings source inventory failed: ${code}.\n`);
  process.exitCode = 1;
});
