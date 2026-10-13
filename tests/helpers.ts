import { ApplicationCore } from "../src/application/core.js";
import { MockAdapter } from "../src/adapter/mock-adapter.js";
import { CatalogRepository, loadCatalog } from "../src/catalog/catalog.js";
import { InMemoryTestConfirmationStore } from "../src/policy/confirmation-store.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import { snapshotGenerationPrincipal } from "../src/domain/generation-principal.js";

export const TEST_TENANT_ID = "tenant_test_001";

export function testPrincipal(
  tenantId = TEST_TENANT_ID,
  subjectId = "subject_test_001",
  connectionId = "connection_test_001"
): GenerationPrincipalRef {
  return { tenant_id: tenantId, subject_id: subjectId, connection_id: connectionId };
}

export function createTestHarness(options?: {
  adapter?: MockAdapter;
  confirmations?: InMemoryTestConfirmationStore;
  tenantId?: string;
  principal?: GenerationPrincipalRef;
}) {
  const adapter = options?.adapter ?? new MockAdapter();
  const confirmations =
    options?.confirmations ?? new InMemoryTestConfirmationStore();
  const principal = snapshotGenerationPrincipal(
    options?.principal ?? testPrincipal(options?.tenantId)
  );
  const tenantId = principal.tenant_id;
  const core = new ApplicationCore(
    new CatalogRepository(loadCatalog()),
    adapter,
    confirmations,
    principal,
    "TEST_ONLY_MOCK"
  );
  return { adapter, confirmations, core, tenantId, principal };
}

export async function estimateAndConfirm(
  harness: ReturnType<typeof createTestHarness>,
  input: {
    model_id: string;
    operation_id: string;
    parameters: Record<string, unknown>;
  },
  confirmationId = "confirm_test_00000001"
) {
  const estimate = await harness.core.estimateGeneration(input);
  harness.confirmations.seedFromEstimate({
    principal: harness.principal,
    confirmation_id: confirmationId,
    estimate
  });
  return { estimate, confirmationId };
}

export function seedCancellation(
  harness: ReturnType<typeof createTestHarness>,
  jobId: string,
  confirmationId = "confirm_cancel_00000001",
  expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
): string {
  harness.confirmations.seedCancellation({
    principal: harness.principal,
    confirmation_id: confirmationId,
    job_id: jobId,
    expires_at: expiresAt
  });
  return confirmationId;
}
