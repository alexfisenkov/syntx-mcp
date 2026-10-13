import type {
  GenerationCancelAttemptEventRecord,
  GenerationCancelAttemptRecord,
} from "../domain/generation-cancel-attempt.js";
import type {
  GenerationOperationEventListOptions,
  GenerationOperationOwnerRef,
} from "./generation-transaction-store.js";

export interface GenerationCancelAttemptClaimInput {
  owner: GenerationOperationOwnerRef;
  generation_operation_id: string;
  idempotency_key: string;
  confirmation_hash: string;
  created_at: string;
}

export type GenerationCancelAttemptClaimResult =
  | { outcome: "claimed" | "replayed"; record: GenerationCancelAttemptRecord }
  | { outcome: "terminal"; record: null };

export interface GenerationCancelAttemptSettlementInput {
  owner: GenerationOperationOwnerRef;
  generation_operation_id: string;
  to_state: "ACKNOWLEDGED" | "OUTCOME_UNKNOWN";
  updated_at: string;
}

export interface GenerationCancelAttemptRecoveryResult {
  recovered_count: number;
  records: GenerationCancelAttemptRecord[];
}

export interface GenerationCancelAttemptStore {
  /** Claim and commit once, before any cancellation network request. */
  claimCancelAttempt(
    input: GenerationCancelAttemptClaimInput,
  ): GenerationCancelAttemptClaimResult;
  getCancelAttempt(
    owner: GenerationOperationOwnerRef,
    generationOperationId: string,
  ): GenerationCancelAttemptRecord | null;
  getCancelAttemptByIdempotencyKey(
    owner: GenerationOperationOwnerRef,
    idempotencyKey: string,
  ): GenerationCancelAttemptRecord | null;
  listCancelAttemptEvents(
    owner: GenerationOperationOwnerRef,
    generationOperationId: string,
    options?: GenerationOperationEventListOptions,
  ): GenerationCancelAttemptEventRecord[];
  /**
   * Atomically merge one attempt's outcome; an ACK is never downgraded.
   * A late ACK can upgrade OUTCOME_UNKNOWN after explicit crash recovery.
   */
  settleCancelAttempt(
    input: GenerationCancelAttemptSettlementInput,
  ): GenerationCancelAttemptRecord;
  /** Exclusive startup ownership is required; opening a connection is not recovery. */
  recoverInterruptedCancelAttempts(
    recoveredAt?: string,
  ): GenerationCancelAttemptRecoveryResult;
}
