// Loads the compiled runtime modules (dist/ or a temporary source-checkout
// build) and the four validated local input files (public catalog,
// inventory, census, Gate B parser), checking their bytes/hashes against the
// checkpoint constants in paths.mjs. Used both by the offline --check path
// and by the network source-checkout path.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SourceBackedResultCliError } from "./errors.mjs";
import {
  censusPath,
  EXPECTED_CENSUS_BYTES,
  EXPECTED_CENSUS_SHA256,
  EXPECTED_COHORT_SHA256,
  EXPECTED_PARSER_BYTES,
  EXPECTED_PARSER_SHA256,
  inventoryPath,
  parserPath,
  publicCatalogPath,
} from "./paths.mjs";

export function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function loadRuntimeModules(baseUrl) {
  const moduleUrl = (path) => new URL(path, baseUrl).href;
  const [result, census, parser, inventory, publicCatalog] = await Promise.all([
    import(
      moduleUrl(
        "src/catalog/normalized-settings-parser-source-backed-result.js",
      )
    ),
    import(
      moduleUrl("src/catalog/normalized-settings-parser-census-manifest.js")
    ),
    import(moduleUrl("src/catalog/normalized-settings-parser-canary.js")),
    import(moduleUrl("src/catalog/settings-source-inventory.js")),
    import(moduleUrl("src/catalog/syntx-public-catalog.js")),
  ]);
  return {
    assertUnchanged:
      result.assertNormalizedSettingsParserSourceBackedResultUnchanged,
    assertImplementations:
      result.assertNormalizedSettingsParserSourceBackedResultMatchesImplementations,
    loadResult: result.loadNormalizedSettingsParserSourceBackedResult,
    serializeResult: result.serializeNormalizedSettingsParserSourceBackedResult,
    loadCensus: census.loadNormalizedSettingsParserCensusManifest,
    serializeCensus: census.serializeNormalizedSettingsParserCensusManifest,
    loadParser: parser.loadNormalizedSettingsParserCanary,
    serializeParser: parser.serializeNormalizedSettingsParserCanary,
    loadInventory: inventory.loadSettingsSourceInventory,
    loadPublicCatalog: publicCatalog.loadSyntxPublicCatalogSnapshot,
  };
}

export async function loadSourceModules(temporaryDirectory) {
  const moduleUrl = (path) =>
    pathToFileURL(join(temporaryDirectory, path)).href;
  const [toolchain, immutable] = await Promise.all([
    import(moduleUrl("tools/settings-ir/source-backed-result-toolchain.js")),
    import(moduleUrl("tools/settings-ir/immutable-json-snapshot.js")),
  ]);
  return {
    buildBananaSourceBackedResultFromPinnedSource:
      toolchain.buildBananaSourceBackedResultFromPinnedSource,
    assertSourceBackedLocalPreflight:
      toolchain.assertSourceBackedLocalPreflight,
    collectSourceBackedImplementationComponents:
      toolchain.collectSourceBackedImplementationComponents,
    createImmutableJsonSnapshot: immutable.createImmutableJsonSnapshot,
  };
}

export async function loadExactInputs(runtime) {
  const publicCatalog = runtime.loadPublicCatalog(publicCatalogPath);
  const inventory = runtime.loadInventory(inventoryPath, publicCatalog);
  const censusArtifactText = await readFile(censusPath, "utf8");
  const parserArtifactText = await readFile(parserPath, "utf8");
  const censusManifest = runtime.loadCensus({
    path: censusPath,
    publicCatalog,
    inventory,
  });
  const parserCanary = runtime.loadParser({
    path: parserPath,
    publicCatalog,
    inventory,
  });

  if (
    Buffer.byteLength(censusArtifactText, "utf8") !== EXPECTED_CENSUS_BYTES ||
    sha256Text(censusArtifactText) !== EXPECTED_CENSUS_SHA256 ||
    censusManifest.cohort.canonical_sha256 !== EXPECTED_COHORT_SHA256 ||
    Buffer.byteLength(parserArtifactText, "utf8") !== EXPECTED_PARSER_BYTES ||
    sha256Text(parserArtifactText) !== EXPECTED_PARSER_SHA256
  ) {
    throw new SourceBackedResultCliError("CHECKPOINT_DRIFT_DETECTED");
  }

  const validationSources = {
    publicCatalog,
    inventory,
    censusManifest,
    censusArtifactText,
    parserCanary,
    parserArtifactText,
  };
  if (
    runtime.serializeCensus(censusManifest, publicCatalog, inventory) !==
      censusArtifactText ||
    runtime.serializeParser(parserCanary, publicCatalog, inventory) !==
      parserArtifactText
  ) {
    throw new SourceBackedResultCliError("CHECKPOINT_DRIFT_DETECTED");
  }
  return { validationSources };
}
