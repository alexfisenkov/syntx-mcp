import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { getPublicCatalogDirectory, loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  serializeSyntxPublicCatalogSnapshot
} from "../src/catalog/syntx-public-catalog.js";
import {
  DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
  loadSelectedDiscoveryCatalog
} from "../src/catalog/selected-discovery-catalog.js";

const C396 = "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json";
const E551 = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const B066 = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const catalogDirectory = getPublicCatalogDirectory();

function serializedVersion(version: string): string {
  const snapshot = loadPublicCatalogVersion(version, catalogDirectory);
  return `sha256-${createHash("sha256").update(serializeSyntxPublicCatalogSnapshot(snapshot)).digest("hex")}.json`;
}

function restoreEnvironment(value: string | undefined): void {
  if (value === undefined) delete process.env.SYNTX_PUBLIC_CATALOG_VERSION;
  else process.env.SYNTX_PUBLIC_CATALOG_VERSION = value;
}

test("default discovery remains E551 while C396 is explicitly selectable without archived runtime proof", () => {
  const previous = process.env.SYNTX_PUBLIC_CATALOG_VERSION;
  try {
    delete process.env.SYNTX_PUBLIC_CATALOG_VERSION;
    assert.equal(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, E551);
    const defaultSelection = loadSelectedDiscoveryCatalog();
    const defaultMetadata = defaultSelection.discoveryCatalog.catalog_metadata;

    assert.equal(defaultSelection.discoveryCatalog.fetched_at, "2026-10-08T13:18:39.393Z");
    assert.equal(defaultMetadata.summary.ai_total, 41);
    assert.equal(defaultMetadata.summary.model_total, 200);
    assert.equal(defaultMetadata.summary.model_active, 167);
    assert.equal(defaultMetadata.summary.model_inactive, 33);
    assert.equal(defaultMetadata.summary.llm_model_total, 44);
    assert.equal(defaultSelection.runtimeCapabilities, null);

    const currentArchive = loadSelectedDiscoveryCatalog(C396);
    const currentMetadata = currentArchive.discoveryCatalog.catalog_metadata;
    assert.equal(currentArchive.discoveryCatalog.fetched_at, "2026-10-15T07:17:24.901Z");
    assert.equal(currentMetadata.summary.ai_total, 41);
    assert.equal(currentMetadata.summary.model_total, 199);
    assert.equal(currentMetadata.summary.model_active, 165);
    assert.equal(currentMetadata.summary.model_inactive, 34);
    assert.equal(currentMetadata.summary.llm_model_total, 43);
    assert.equal(currentMetadata.source_hashes.models, "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a");
    assert.equal(currentArchive.runtimeCapabilities, null);
  } finally {
    restoreEnvironment(previous);
  }
});

test("operator override stays honored and old archive hashes remain exact without runtime overlays", () => {
  const previous = process.env.SYNTX_PUBLIC_CATALOG_VERSION;
  try {
    process.env.SYNTX_PUBLIC_CATALOG_VERSION = E551;
    const override = loadSelectedDiscoveryCatalog();
    assert.equal(override.discoveryCatalog.fetched_at, "2026-10-08T13:18:39.393Z");
    assert.equal(override.runtimeCapabilities, null);

    assert.equal(serializedVersion(C396), C396);
    assert.equal(serializedVersion(E551), E551);
    assert.equal(serializedVersion(B066), B066);
  } finally {
    restoreEnvironment(previous);
  }
});
