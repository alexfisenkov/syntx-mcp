import { join } from "node:path";
import { fileURLToPath } from "node:url";

// All path constants, checkpoint hashes/byte-counts, and the source-checkout
// marker lists for the source-backed-result CLI. Pure data — no I/O, no
// project imports. Everything else in this directory reads paths from here.
//
// This module lives one directory below scripts/, so the project root is
// two levels up from here (unlike sibling scripts/*.mjs files, which are
// one level up from their own import.meta.url).
export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

export const publicCatalogPath = join(
  projectRoot,
  "catalog/v1/official-public-api.json",
);
export const inventoryPath = join(
  projectRoot,
  "catalog/runtime/v1/settings-source-inventory.json",
);
export const parserPath = join(
  projectRoot,
  "catalog/runtime/v1/normalized-settings-parser-canary.json",
);
export const censusPath = join(
  projectRoot,
  "catalog/runtime/v2/normalized-settings-parser-census-manifest.json",
);
export const targetPath = join(
  projectRoot,
  "catalog/runtime/v3/normalized-settings-parser-source-backed-result.json",
);
export const lockPath = `${targetPath}.lock`;
export const sourceBuildParent = join(projectRoot, ".черновики");
export const sourceBuildPrefix = join(sourceBuildParent, "c1a-source-build-");
// DEBT-017: one fixed, always-overwritten path — not a growing set of
// per-run files — so a real tsc compile failure's output is inspectable
// without adding directory-sweep risk (D-050/DEBT-015).
export const buildDiagnosticsPath = join(
  sourceBuildParent,
  "c1a-source-build-tsc-output.txt",
);

export const EXPECTED_CENSUS_BYTES = 428_390;
export const EXPECTED_CENSUS_SHA256 =
  "611196c4245adf1a4d7860cc1ad183192dc074ececd538bdbf99b65efe5bad06";
export const EXPECTED_COHORT_SHA256 =
  "sha256:8c8b4bc02272e3fddd3d11dcc24cb903b66a3ff13848c2ea4085b852d7b8e959";
export const EXPECTED_PARSER_BYTES = 16_600;
export const EXPECTED_PARSER_SHA256 =
  "018cda7ac6a4baf31988a62e18020a24b9055baa2c5d67298218794d7c2ffdda";

export const sourceCheckoutMarkers = [
  "tsconfig.json",
  "tsconfig.source-backed-build.json",
  "src/catalog/normalized-settings-parser-source-backed-result.ts",
  "src/catalog/normalized-settings-parser-census-manifest.ts",
  "src/catalog/normalized-settings-parser-canary.ts",
  "src/catalog/settings-source-inventory.ts",
  "src/catalog/syntx-public-catalog.ts",
  "tools/settings-ir/source-backed-result-toolchain.ts",
  "tools/settings-ir/immutable-json-snapshot.ts",
  "tools/settings-ir/build-banana-parser-canary.ts",
  "tools/settings-ir/pinned-settings-source-loader.ts",
  "tools/settings-ir/static-settings-compiler.ts",
  "node_modules/typescript/bin/tsc",
  "node_modules/typescript/lib/typescript.js",
].map((path) => join(projectRoot, path));

export const compiledSourceModePaths = [
  "src/catalog/normalized-settings-parser-source-backed-result.js",
  "src/catalog/normalized-settings-parser-census-manifest.js",
  "src/catalog/normalized-settings-parser-canary.js",
  "src/catalog/settings-source-inventory.js",
  "src/catalog/syntx-public-catalog.js",
  "tools/settings-ir/source-backed-result-toolchain.js",
  "tools/settings-ir/immutable-json-snapshot.js",
  "tools/settings-ir/build-banana-parser-canary.js",
  "tools/settings-ir/pinned-settings-source-loader.js",
  "tools/settings-ir/static-settings-compiler.js",
];
