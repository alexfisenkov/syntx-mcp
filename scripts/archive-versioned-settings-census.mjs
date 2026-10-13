#!/usr/bin/env node

/** Create an immutable census manifest for an explicit public/settings pair. */
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const VERSION = /^sha256-[a-f0-9]{64}\.json$/u;

function parse(args) {
  if (args.length !== 4 || args[0] !== "--public-version" || args[2] !== "--settings-version" || !VERSION.test(args[1]) || !VERSION.test(args[3])) throw new Error("INVALID_ARGUMENT");
  return { publicVersion: args[1], settingsVersion: args[3] };
}

async function main() {
  const { publicVersion, settingsVersion } = parse(process.argv.slice(2));
  const [history, census, writer, settingsHistory] = await Promise.all([
    import("../dist/src/catalog/public-catalog-history.js"),
    import("../dist/src/catalog/normalized-settings-parser-census-manifest.js"),
    import("../dist/tools/settings-ir/atomic-json-snapshot.js"),
    import("../dist/src/catalog/settings-source-history.js")
  ]);
  const catalog = history.loadPublicCatalogVersion(publicVersion);
  const inventory = settingsHistory.loadSettingsSourceInventoryVersion(settingsVersion, catalog);
  const manifest = census.buildNormalizedSettingsParserCensusManifest({ publicCatalog: catalog, inventory });
  const text = census.serializeNormalizedSettingsParserCensusManifest(manifest, catalog, inventory);
  const digest = createHash("sha256").update(text, "utf8").digest("hex");
  const output = join(ROOT, "catalog/runtime/v8", `sha256-${digest}.json`);
  if (existsSync(output)) throw new Error("CENSUS_VERSION_ALREADY_EXISTS");
  await writer.writeAtomicJsonSnapshot(output, text);
  process.stdout.write(`Versioned census created. forms=${manifest.summary.current_forms} models=${manifest.summary.model_variants} sources=${manifest.summary.source_refs}\npublic_version=${publicVersion}\nsettings_version=${settingsVersion}\npath=${output}\n`);
}

main().catch((error) => {
  process.stderr.write(`Versioned settings census failed: ${error instanceof Error ? error.message : "UNEXPECTED_ERROR"}.\n`);
  process.exitCode = 1;
});
