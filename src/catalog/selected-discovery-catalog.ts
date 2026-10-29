import { DiscoveryCatalogRepository } from "./discovery-catalog.js";
import { loadSelectedPublicCatalog } from "./public-catalog-history.js";
import { RuntimeCapabilityCatalog } from "./runtime-capability-catalog.js";

export const DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION =
  "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";

/** Current read-only public metadata; independent from the historical native-profile pin above. */
export const CURRENT_DISCOVERY_READ_VERSION =
  "sha256-d1f43b4274fceb50c229711f093edb36c88e60e123da448a71ed256574f02009.json";

/** Trusted, immutable read snapshot for ordinary model discovery. It ignores operator/native profile selection. */
export function loadCurrentDiscoveryReadCatalog() {
  return loadSelectedDiscoveryCatalog(CURRENT_DISCOVERY_READ_VERSION);
}

/** Trusted process configuration; never accept a path/version from an MCP call. */
export function loadSelectedDiscoveryCatalog(
  version: string | undefined = process.env.SYNTX_PUBLIC_CATALOG_VERSION,
  catalogDirectory?: string
) {
  // A caller-provided catalog directory is a test/isolated archive boundary;
  // leave its no-version behavior on the historical v1 path. The application
  // default selects the current immutable snapshot, while an explicit version
  // remains an operator override.
  const selectedVersion = version === undefined && catalogDirectory === undefined
    ? DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION
    : version;
  const selected = loadSelectedPublicCatalog({
    ...(selectedVersion === undefined ? {} : { version: selectedVersion }),
    ...(catalogDirectory === undefined ? {} : { catalogDirectory })
  });
  const discoveryCatalog = new DiscoveryCatalogRepository(selected.snapshot);
  // An archived snapshot has no reviewed overlay, even if some model IDs or
  // source hashes happen to match history. Never re-label historical proof.
  const runtimeCapabilities = selected.archived
    ? null
    : new RuntimeCapabilityCatalog(discoveryCatalog);
  return { discoveryCatalog, runtimeCapabilities };
}
