import { createHash } from "node:crypto";
import type { GenerationOperationRecord, GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { snapshotGenerationPrincipal, sameGenerationPrincipal, generationPrincipalKey } from "../../domain/generation-principal.js";
import type { GenerationJob } from "../../domain/types.js";
import { isTerminalGenerationState } from "../../domain/generation-operation.js";
import { ApplicationError } from "../../errors.js";
import { GenerationTransactionStoreError } from "../../storage/generation-transaction-store.js";
import type { GenerationTransactionStore } from "../../storage/generation-transaction-store.js";
import type {
  CancelJobContext,
  ReconcileCancelContext,
} from "../upstream-adapter.js";

interface CancellationClient {
  cancelMessage(chatUuid: string, messageId: string): Promise<unknown>;
}

/** One-shot cancellation evidence, independent of the paid job's lifecycle. */
export class SyntxCancellationSaga {
  constructor(
    private readonly options: {
      store: GenerationTransactionStore;
      resolveClient: (principal: GenerationPrincipalRef) => CancellationClient;
      now: () => Date;
      toJob: (record: GenerationOperationRecord) => GenerationJob;
    },
  ) {}

  async cancel(context: CancelJobContext): Promise<GenerationJob> {
    context = { ...context, principal: snapshotGenerationPrincipal(context.principal) };
    const replayed = await this.reconcile(context);
    if (replayed) return replayed;
    if (
      typeof context.confirmation_id !== "string" ||
      context.confirmation_id.trim().length === 0 ||
      context.confirmation_id.length > 512
    ) {
      throw new ApplicationError(
        "CONFIRMATION_REQUIRED",
        "A consumed cancellation confirmation is required.",
      );
    }
    const owner = ownerOf(context);
    const record = this.requireOperation(context);
    const receipt = record.receipt;
    if (!receipt?.message_id) {
      throw new ApplicationError(
        "JOB_NOT_CANCELABLE",
        "The provider has not acknowledged this job.",
      );
    }
    // Resolve dependencies before claiming a one-shot dispatch. The caller must
    // supply only a server-resolved exact-connection client and consumed approval.
    let client: CancellationClient;
    try {
      client = this.options.resolveClient(context.principal);
    } catch {
      throw new ApplicationError(
        "UPSTREAM_START_FAILED",
        "The bound cancellation client is unavailable.",
      );
    }
    const confirmationHash = `sha256:${createHash("sha256")
      .update(
        JSON.stringify([
          "cancel_job",
          generationPrincipalKey(context.principal),
          context.confirmation_id,
        ]),
      )
      .digest("hex")}`;
    const claim = storageCall(() =>
      this.options.store.claimCancelAttempt({
        owner,
        generation_operation_id: record.id,
        idempotency_key: context.idempotency_key,
        confirmation_hash: confirmationHash,
        created_at: this.options.now().toISOString(),
      }),
    );
    if (claim.outcome !== "claimed") {
      const replay = await this.reconcile(context);
      if (replay) return replay;
      throw unknownCancellation();
    }

    // Only the durable claim winner sends. Even a crash before this call is
    // deliberately non-retryable: there is no provider idempotency contract.
    try {
      await client.cancelMessage(receipt.chat_uuid, receipt.message_id);
    } catch {
      storageCall(() =>
        this.options.store.settleCancelAttempt({
          owner,
          generation_operation_id: record.id,
          to_state: "OUTCOME_UNKNOWN",
          updated_at: this.options.now().toISOString(),
        }),
      );
      throw unknownCancellation();
    }
    storageCall(() =>
      this.options.store.settleCancelAttempt({
        owner,
        generation_operation_id: record.id,
        to_state: "ACKNOWLEDGED",
        updated_at: this.options.now().toISOString(),
      }),
    );
    // A HTTP ACK is not an observed provider cancellation status. Keep polling
    // the actual generation; do not turn a live paid job into CANCELED/FAILED.
    return this.options.toJob(this.requireOperation(context));
  }

  async reconcile(
    context: ReconcileCancelContext,
  ): Promise<GenerationJob | null> {
    context = { ...context, principal: snapshotGenerationPrincipal(context.principal) };
    const owner = ownerOf(context);
    // Check the exact connection BEFORE inspecting/replaying the cancel ledger.
    const record = this.requireOperation(context);
    const byKey = storageCall(() =>
      this.options.store.getCancelAttemptByIdempotencyKey(
        owner,
        context.idempotency_key,
      ),
    );
    if (byKey && byKey.generation_operation_id !== context.job_id) {
      throw new ApplicationError(
        "IDEMPOTENCY_CONFLICT",
        "The cancellation key belongs to another job.",
      );
    }
    if (isTerminalGenerationState(record.state))
      return this.options.toJob(record);
    const attempt =
      byKey ??
      storageCall(() => this.options.store.getCancelAttempt(owner, record.id));
    if (!attempt) return null;
    if (attempt.idempotency_key !== context.idempotency_key) {
      throw new ApplicationError(
        "JOB_NOT_CANCELABLE",
        "A cancellation was already attempted for this job; another key cannot authorize a repeat.",
      );
    }
    if (attempt.state !== "ACKNOWLEDGED") throw unknownCancellation();
    return this.options.toJob(record);
  }

  private requireOperation(
    context: ReconcileCancelContext,
  ): GenerationOperationRecord {
    const record = storageCall(() =>
      this.options.store.getById(ownerOf(context), context.job_id),
    );
    if (!record || !sameGenerationPrincipal(record.principal, context.principal))
      throw new ApplicationError(
        "JOB_NOT_FOUND",
        "The requested job was not found.",
      );
    return record;
  }
}

function ownerOf(context: ReconcileCancelContext) {
  return { tenant_id: context.principal.tenant_id, subject_id: context.principal.subject_id };
}

function unknownCancellation(): ApplicationError {
  return new ApplicationError(
    "UPSTREAM_OUTCOME_UNKNOWN",
    "The cancellation outcome is unknown. Poll the job; repeating the cancellation is blocked.",
  );
}

function storageCall<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof GenerationTransactionStoreError) {
      switch (error.code) {
        case "IDEMPOTENCY_CONFLICT":
          throw new ApplicationError(
            "IDEMPOTENCY_CONFLICT",
            "The cancellation key belongs to another job.",
          );
        case "OPERATION_NOT_FOUND":
          throw new ApplicationError(
            "JOB_NOT_FOUND",
            "The requested job was not found.",
          );
        case "CANCEL_ALREADY_ATTEMPTED":
        case "CANCEL_NOT_ALLOWED":
          throw new ApplicationError(
            "JOB_NOT_CANCELABLE",
            "The job cannot accept another cancellation attempt.",
          );
        case "CANCEL_CONFIRMATION_CONFLICT":
          throw new ApplicationError(
            "CONFIRMATION_ALREADY_USED",
            "The cancellation confirmation is already bound to another job.",
          );
        case "INVALID_RECORD":
          throw new ApplicationError(
            "INVALID_PARAMETERS",
            "The cancellation metadata is invalid.",
          );
      }
    }
    // Storage exceptions can contain paths or SQL values; none cross this port.
    throw unknownCancellation();
  }
}
