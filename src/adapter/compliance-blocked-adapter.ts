import { ComplianceBlockedError } from "../errors.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import type {
  Balance,
  GenerationJob,
  GenerationRequest,
  GenerationResult,
  UpstreamGenerationEstimate
} from "../domain/types.js";
import type {
  CancelJobContext,
  JobContext,
  ReconcileCancelContext,
  ReconcileStartContext,
  StartGenerationContext,
  UpstreamAdapter
} from "./upstream-adapter.js";

/**
 * Production-safe default. Every upstream operation fails closed and performs no I/O.
 */
export class ComplianceBlockedAdapter implements UpstreamAdapter {
  getBalance(_principal: Readonly<GenerationPrincipalRef>): Promise<Balance> {
    return Promise.reject(new ComplianceBlockedError("get_balance"));
  }

  estimateGeneration(
    _principal: Readonly<GenerationPrincipalRef>,
    _request: GenerationRequest
  ): Promise<UpstreamGenerationEstimate> {
    return Promise.reject(new ComplianceBlockedError("estimate_generation"));
  }

  reconcileStart(_context: ReconcileStartContext): Promise<GenerationJob | null> {
    return Promise.reject(new ComplianceBlockedError("reconcile_start"));
  }

  startGeneration(
    _context: StartGenerationContext,
    _request: GenerationRequest
  ): Promise<GenerationJob> {
    return Promise.reject(new ComplianceBlockedError("start_generation"));
  }

  getJob(_context: JobContext): Promise<GenerationJob> {
    return Promise.reject(new ComplianceBlockedError("get_job"));
  }

  reconcileCancel(
    _context: ReconcileCancelContext
  ): Promise<GenerationJob | null> {
    return Promise.reject(new ComplianceBlockedError("reconcile_cancel"));
  }

  cancelJob(_context: CancelJobContext): Promise<GenerationJob> {
    return Promise.reject(new ComplianceBlockedError("cancel_job"));
  }

  getResult(_context: JobContext): Promise<GenerationResult> {
    return Promise.reject(new ComplianceBlockedError("get_result"));
  }
}
