import type {
  Balance,
  GenerationJob,
  GenerationRequest,
  GenerationResult,
  UpstreamGenerationEstimate
} from "../domain/types.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";

export interface StartGenerationContext {
  principal: Readonly<GenerationPrincipalRef>;
  idempotency_key: string;
  confirmation_id: string;
  approved_max_cost_tokens: number;
}

export interface JobContext {
  principal: Readonly<GenerationPrincipalRef>;
  job_id: string;
}

export interface ReconcileStartContext {
  principal: Readonly<GenerationPrincipalRef>;
  idempotency_key: string;
  request_hash: string;
}

export interface ReconcileCancelContext extends JobContext {
  idempotency_key: string;
}

export interface CancelJobContext extends ReconcileCancelContext {
  confirmation_id: string;
}

/** Port for a future, explicitly authorized upstream implementation. */
export interface UpstreamAdapter {
  getBalance(principal: Readonly<GenerationPrincipalRef>): Promise<Balance>;
  estimateGeneration(
    principal: Readonly<GenerationPrincipalRef>,
    request: GenerationRequest
  ): Promise<UpstreamGenerationEstimate>;
  /**
   * The adapter must check approved_max_cost_tokens atomically with committing
   * the upstream job/idempotency record. A cap rejection must commit neither.
   */
  startGeneration(
    context: StartGenerationContext,
    request: GenerationRequest
  ): Promise<GenerationJob>;
  reconcileStart(context: ReconcileStartContext): Promise<GenerationJob | null>;
  getJob(context: JobContext): Promise<GenerationJob>;
  reconcileCancel(
    context: ReconcileCancelContext
  ): Promise<GenerationJob | null>;
  cancelJob(context: CancelJobContext): Promise<GenerationJob>;
  getResult(context: JobContext): Promise<GenerationResult>;
}
