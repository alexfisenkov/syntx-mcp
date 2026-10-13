import type {
  GenerationOperationRecord,
  GenerationOperationState,
  ProviderGenerationReceipt
} from "../domain/generation-operation.js";
import type { GenerationCancelAttemptStore } from "./generation-cancel-attempt-store.js";

/**
 * The kind is part of the idempotency namespace. A future cancellation ledger
 * can therefore reuse a caller key without colliding with generation starts.
 */
export const GENERATION_TRANSACTION_KIND = "generation" as const;

export interface GenerationOperationOwnerRef {
  tenant_id: string;
  subject_id: string;
}

export interface GenerationOperationCreateResult {
  outcome: "created" | "replayed";
  record: GenerationOperationRecord;
}

export interface GenerationOperationTransitionInput {
  owner: GenerationOperationOwnerRef;
  id: string;
  expected_revision: number;
  to_state: GenerationOperationState;
  updated_at: string;
  receipt?: ProviderGenerationReceipt | null;
  failure_code?: string | null;
  next_poll_at?: string | null;
}

export interface GenerationResultMessageBindingInput {
  owner: GenerationOperationOwnerRef;
  id: string;
  expected_revision: number;
  result_message_id: string;
  updated_at: string;
}

export interface GenerationOperationRecoveryResult {
  recovered_count: number;
  records: GenerationOperationRecord[];
}

export const GENERATION_OPERATION_EVENT_TYPES = [
  "CREATED",
  "TRANSITIONED",
  "CRASH_RECOVERED",
  "MIGRATED_V1",
  "RESULT_BOUND"
] as const;

export type GenerationOperationEventType =
  (typeof GENERATION_OPERATION_EVENT_TYPES)[number];

/**
 * Append-only, redacted lifecycle evidence. It intentionally contains no
 * prompt, parameter values, credentials, receipts, or artifact locations.
 */
export interface GenerationOperationEventRecord {
  sequence: number;
  generation_operation_id: string;
  operation_revision: number;
  event_type: GenerationOperationEventType;
  from_state: GenerationOperationState | null;
  to_state: GenerationOperationState;
  reason_code: string | null;
  recorded_at: string;
}

export interface GenerationOperationEventListOptions {
  after_sequence?: number;
  limit?: number;
}

export interface GenerationTransactionStore extends GenerationCancelAttemptStore {
  createOrReplay(
    record: GenerationOperationRecord
  ): GenerationOperationCreateResult;
  getById(
    owner: GenerationOperationOwnerRef,
    id: string
  ): GenerationOperationRecord | null;
  getByIdempotencyKey(
    owner: GenerationOperationOwnerRef,
    idempotencyKey: string
  ): GenerationOperationRecord | null;
  listEvents(
    owner: GenerationOperationOwnerRef,
    id: string,
    options?: GenerationOperationEventListOptions
  ): GenerationOperationEventRecord[];
  transition(
    input: GenerationOperationTransitionInput
  ): GenerationOperationRecord;
  bindResultMessage(
    input: GenerationResultMessageBindingInput
  ): GenerationOperationRecord | null;
  /**
   * Call once after the runtime has acquired exclusive startup ownership.
   * Opening an additional reader/writer connection does not itself imply that
   * another process crashed, so construction intentionally does not recover.
   */
  recoverInterruptedOperations(
    recoveredAt?: string
  ): GenerationOperationRecoveryResult;
  close(): void;
}

export type GenerationTransactionStoreErrorCode =
  | "STORE_CLOSED"
  | "INVALID_RECORD"
  | "IDEMPOTENCY_CONFLICT"
  | "OPERATION_ID_CONFLICT"
  | "OPERATION_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "CANCEL_ALREADY_ATTEMPTED"
  | "CANCEL_CONFIRMATION_CONFLICT"
  | "CANCEL_NOT_ALLOWED"
  | "CANCEL_ATTEMPT_NOT_FOUND"
  | "RESULT_MESSAGE_ALREADY_BOUND"
  | "CORRUPT_RECORD"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "UNSAFE_STORAGE_PATH";

export class GenerationTransactionStoreError extends Error {
  constructor(
    readonly code: GenerationTransactionStoreErrorCode,
    message: string
  ) {
    super(message);
    this.name = "GenerationTransactionStoreError";
  }
}
