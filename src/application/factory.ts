import { ComplianceBlockedAdapter } from "../adapter/compliance-blocked-adapter.js";
import { CatalogRepository, loadCatalog } from "../catalog/catalog.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { RuntimeCapabilityCatalog } from "../catalog/runtime-capability-catalog.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { DenyAllConfirmationStore } from "../policy/confirmation-store.js";
import { ApplicationCore } from "./core.js";

/**
 * The only production/default factory. It performs no upstream I/O and cannot
 * approve generation requests.
 */
export function createDefaultApplication(options: {
  discoveryCatalog?: DiscoveryCatalogRepository;
  /** null explicitly selects discovery-only, without historical runtime proof. */
  runtimeCapabilities?: RuntimeCapabilityCatalog | null;
} = {}): ApplicationCore {
  const selected = options.discoveryCatalog === undefined
    ? loadSelectedDiscoveryCatalog()
    : {
        discoveryCatalog: options.discoveryCatalog,
        runtimeCapabilities: options.runtimeCapabilities === undefined
          ? new RuntimeCapabilityCatalog(options.discoveryCatalog)
          : options.runtimeCapabilities
      };
  return new ApplicationCore(
    new CatalogRepository(loadCatalog()),
    new ComplianceBlockedAdapter(),
    new DenyAllConfirmationStore(),
    {
      tenant_id: "unlinked-local-tenant",
      subject_id: "unlinked-local-subject",
      connection_id: "unlinked-local-connection"
    },
    "COMPLIANCE_BLOCKED",
    selected.discoveryCatalog,
    selected.runtimeCapabilities ?? undefined
  );
}
