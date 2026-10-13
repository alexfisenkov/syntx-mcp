import { ApplicationCore, type ExecutionProfile } from "../application/core.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import type { PrivateOwnerGenerationProfile } from "./private-owner-generation-profile.js";
import type {
  Balance,
  GenerationJob,
  GenerationRequest,
  GenerationResult,
  UpstreamGenerationEstimate
} from "../domain/types.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import type {
  CancelJobContext,
  JobContext,
  ReconcileCancelContext,
  ReconcileStartContext,
  StartGenerationContext,
  UpstreamAdapter
} from "../adapter/upstream-adapter.js";
import { DenyAllConfirmationStore } from "../policy/confirmation-store.js";
import { ApplicationError } from "../errors.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { createMcpServer } from "../mcp/server.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface DurableOwnerReadOnlyMcpOptions {
  readonly profile: PrivateOwnerGenerationProfile;
  readonly baseApplication: ApplicationCore;
  readonly selectedCatalog: DiscoveryCatalogRepository;
}

export interface DurableOwnerReadOnlyMcp {
  readonly application: ApplicationCore;
  readonly server: McpServer;
  readonly adapter: UpstreamAdapter;
}

export function createDurableOwnerReadOnlyMcp(
  options: DurableOwnerReadOnlyMcpOptions
): DurableOwnerReadOnlyMcp {
  const { profile, baseApplication, selectedCatalog } = options;
  const adapter = createDurableOwnerReadOnlyAdapter(profile);
  const application = new ApplicationCore(
    baseApplication.catalog,
    adapter,
    new DenyAllConfirmationStore(),
    profile.generationRuntime.principal,
    "COMPLIANCE_BLOCKED" satisfies ExecutionProfile,
    selectedCatalog
  );
  const server = createMcpServer(application);
  return Object.freeze({ application, server, adapter });
}

/** A narrow adapter facade for the persisted owner ledger; it owns no resources. */
export function createDurableOwnerReadOnlyAdapter(
  profile: PrivateOwnerGenerationProfile
): UpstreamAdapter {
  const runtime = profile.generationRuntime;
  const boundPrincipal = snapshotGenerationPrincipal(runtime.principal);
  const deny = <T>(operation: string): Promise<T> => Promise.reject(new ApplicationError(
    "UPSTREAM_CAPABILITY_NOT_RESEARCHED",
    "This durable owner MCP composition permits only persisted job and result reads.",
    { operation }
  ));
  const assertReadContext = (context: JobContext): JobContext => {
    runtime.assertLeaseHeld();
    const callerPrincipal = snapshotGenerationPrincipal(context.principal);
    if (!sameGenerationPrincipal(boundPrincipal, callerPrincipal)) {
      throw new ApplicationError("JOB_NOT_FOUND", "The requested generation job was not found.");
    }
    return Object.freeze({ principal: boundPrincipal, job_id: context.job_id });
  };

  return Object.freeze({
    getBalance(_principal: Readonly<GenerationPrincipalRef>): Promise<Balance> {
      return deny("get_balance");
    },
    estimateGeneration(_principal: Readonly<GenerationPrincipalRef>, _request: GenerationRequest): Promise<UpstreamGenerationEstimate> {
      return deny("estimate_generation");
    },
    startGeneration(_context: StartGenerationContext, _request: GenerationRequest): Promise<GenerationJob> {
      return deny("start_generation");
    },
    reconcileStart(_context: ReconcileStartContext): Promise<GenerationJob | null> {
      return deny("reconcile_start");
    },
    async getJob(context: JobContext): Promise<GenerationJob> {
      return runtime.adapter.getJob(assertReadContext(context));
    },
    reconcileCancel(_context: ReconcileCancelContext): Promise<GenerationJob | null> {
      return deny("reconcile_cancel");
    },
    cancelJob(_context: CancelJobContext): Promise<GenerationJob> {
      return deny("cancel_job");
    },
    async getResult(context: JobContext): Promise<GenerationResult> {
      return runtime.adapter.getResult(assertReadContext(context));
    }
  });
}
