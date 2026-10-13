import {
  closeSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  openSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  GenerationCancelAttemptClaimInput,
  GenerationCancelAttemptClaimResult,
  GenerationCancelAttemptRecoveryResult,
  GenerationCancelAttemptSettlementInput
} from "./generation-cancel-attempt-store.js";
import type {
  GenerationCancelAttemptEventRecord,
  GenerationCancelAttemptRecord
} from "../domain/generation-cancel-attempt.js";
import {
  SCHEMA_VERSION_FOUR_MIGRATION_SQL,
  SqliteGenerationCancelAttemptLedger
} from "./sqlite-generation-cancel-attempt-store.js";
import {
  assertGenerationStateTransition,
  GENERATION_OPERATION_STATES,
  OWNER_UNCAPPED_APPROVED_MAX_COST,
  recoveredGenerationState,
  type CostCapEnforcement,
  type GenerationOperationRecord,
  type GenerationOperationState,
  type ProviderGenerationReceipt
} from "../domain/generation-operation.js";
import {
  GENERATION_OPERATION_EVENT_TYPES,
  GENERATION_TRANSACTION_KIND,
  GenerationTransactionStoreError,
  type GenerationOperationCreateResult,
  type GenerationOperationEventListOptions,
  type GenerationOperationEventRecord,
  type GenerationOperationEventType,
  type GenerationOperationOwnerRef,
  type GenerationOperationRecoveryResult,
  type GenerationResultMessageBindingInput,
  type GenerationOperationTransitionInput,
  type GenerationTransactionStore
} from "./generation-transaction-store.js";

/**
 * `node:sqlite` first appeared in Node 22.5. This implementation requires
 * Node 22.13+ so extension loading can be explicitly and irreversibly disabled.
 */
export const SQLITE_GENERATION_STORE_MINIMUM_NODE = "22.13.0" as const;

const CURRENT_SCHEMA_VERSION = 5;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const SAFE_PARAMETER_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const SAFE_FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

const COST_CAP_ENFORCEMENTS = [
  "UPSTREAM_QUOTE_BOUND",
  "UPSTREAM_MAX_COST",
  "PRE_DISPATCH_ONLY",
  "UNENFORCEABLE"
] as const satisfies readonly CostCapEnforcement[];

interface SqliteGenerationTransactionStoreOptions {
  now?: () => Date;
}

interface OperationRow {
  id: string;
  kind: string;
  tenant_id: string;
  subject_id: string;
  connection_id: string;
  idempotency_key: string;
  request_hash: string;
  model_id: string;
  operation_id: string;
  modality: string;
  catalog_version: string;
  schema_hash: string;
  parameter_keys_json: string;
  estimate_id: string;
  approved_max_cost: string;
  cost_effective: string | null;
  cost_unit: string | null;
  cost_observed_at: string;
  cost_expires_at: string;
  cost_cap_enforcement: string;
  state: string;
  receipt_chat_uuid: string | null;
  receipt_provider_job_id: string | null;
  receipt_message_id: string | null;
  receipt_message_object_id: string | null;
  result_message_id: string | null;
  failure_code: string | null;
  dispatch_deadline: string;
  next_poll_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}

interface EventRow {
  sequence: number;
  generation_operation_id: string;
  operation_revision: number;
  event_type: string;
  from_state: string | null;
  to_state: string;
  reason_code: string | null;
  recorded_at: string;
}

const SELECT_COLUMNS = `
  id, kind, tenant_id, subject_id, connection_id, idempotency_key,
  request_hash, model_id, operation_id, modality, catalog_version,
  schema_hash, parameter_keys_json, estimate_id, approved_max_cost,
  cost_effective, cost_unit, cost_observed_at, cost_expires_at,
  cost_cap_enforcement, state, receipt_chat_uuid,
  receipt_provider_job_id, receipt_message_id, receipt_message_object_id,
  result_message_id,
  failure_code, dispatch_deadline, next_poll_at, created_at, updated_at,
  revision
`;

/**
 * Durable, append-preserving transaction journal. It stores only allowlisted
 * correlation metadata; request values and credentials never enter its schema.
 */
export class SqliteGenerationTransactionStore
  implements GenerationTransactionStore
{
  readonly #database: DatabaseSync;
  readonly #cancelAttempts: SqliteGenerationCancelAttemptLedger;
  readonly #now: () => Date;
  #closed = false;

  constructor(
    databasePath: string,
    options: SqliteGenerationTransactionStoreOptions = {}
  ) {
    const safePath = prepareDatabasePath(databasePath);
    this.#now = options.now ?? (() => new Date());
    this.#database = new DatabaseSync(safePath, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false
    });
    this.#cancelAttempts = new SqliteGenerationCancelAttemptLedger(
      this.#database,
      (owner, id) => this.getById(owner, id)
    );

    try {
      this.#configureConnection(safePath !== ":memory:");
      this.#migrate();
      if (safePath !== ":memory:") {
        chmodSync(safePath, 0o600);
      }
    } catch (error) {
      this.#database.close();
      this.#closed = true;
      throw error;
    }
  }

  createOrReplay(
    candidate: GenerationOperationRecord
  ): GenerationOperationCreateResult {
    this.#assertOpen();
    const record = validateNewRecord(candidate);

    return this.#inImmediateTransaction(() => {
      const byKey = this.#selectByIdempotencyBinding(
        record.principal.tenant_id,
        record.principal.subject_id,
        record.idempotency_key
      );
      if (byKey) {
        const existing = rowToRecord(byKey);
        if (!hasSameImmutableBinding(existing, record)) {
          throw new GenerationTransactionStoreError(
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key is already bound to a different generation request."
          );
        }
        return { outcome: "replayed", record: cloneRecord(existing) };
      }

      const byId = this.#selectByRawId(record.id);
      if (byId) {
        throw new GenerationTransactionStoreError(
          "OPERATION_ID_CONFLICT",
          "The generation operation id is already in use."
        );
      }

      this.#insert(record);
      this.#insertEvent({
        generation_operation_id: record.id,
        operation_revision: record.revision,
        event_type: "CREATED",
        from_state: null,
        to_state: record.state,
        reason_code: null,
        recorded_at: record.created_at
      });
      return { outcome: "created", record: cloneRecord(record) };
    });
  }

  getById(
    owner: GenerationOperationOwnerRef,
    id: string
  ): GenerationOperationRecord | null {
    this.#assertOpen();
    const safeOwner = validateOwner(owner);
    const safeId = requireSafeId(id);
    const row = this.#database
      .prepare(
        `SELECT ${SELECT_COLUMNS}
           FROM generation_operations
          WHERE tenant_id = ? AND subject_id = ? AND kind = ? AND id = ?`
      )
      .get(
        safeOwner.tenant_id,
        safeOwner.subject_id,
        GENERATION_TRANSACTION_KIND,
        safeId
      );
    return row ? cloneRecord(rowToRecord(row as unknown as OperationRow)) : null;
  }

  getByIdempotencyKey(
    owner: GenerationOperationOwnerRef,
    idempotencyKey: string
  ): GenerationOperationRecord | null {
    this.#assertOpen();
    const safeOwner = validateOwner(owner);
    const safeKey = requireSafeId(idempotencyKey);
    const row = this.#selectByIdempotencyBinding(
      safeOwner.tenant_id,
      safeOwner.subject_id,
      safeKey
    );
    return row ? cloneRecord(rowToRecord(row)) : null;
  }

  listEvents(
    owner: GenerationOperationOwnerRef,
    id: string,
    options: GenerationOperationEventListOptions = {}
  ): GenerationOperationEventRecord[] {
    this.#assertOpen();
    const safeOwner = validateOwner(owner);
    const safeId = requireSafeId(id);
    const afterSequence = requireEventCursor(options.after_sequence ?? 0);
    const limit = requireEventLimit(options.limit ?? 100);
    const rows = this.#database
      .prepare(
        `SELECT e.sequence, e.generation_operation_id, e.operation_revision,
                e.event_type, e.from_state, e.to_state, e.reason_code,
                e.recorded_at
           FROM generation_operation_events AS e
           JOIN generation_operations AS o
             ON o.id = e.generation_operation_id
          WHERE o.tenant_id = ? AND o.subject_id = ? AND o.kind = ?
            AND o.id = ? AND e.sequence > ?
          ORDER BY e.sequence
          LIMIT ?`
      )
      .all(
        safeOwner.tenant_id,
        safeOwner.subject_id,
        GENERATION_TRANSACTION_KIND,
        safeId,
        afterSequence,
        limit
      ) as unknown as EventRow[];
    return rows.map(eventRowToRecord);
  }

  transition(
    input: GenerationOperationTransitionInput
  ): GenerationOperationRecord {
    this.#assertOpen();
    const safeOwner = validateOwner(input.owner);
    const safeId = requireSafeId(input.id);
    const expectedRevision = requireRevision(input.expected_revision);
    const updatedAt = requireTimestamp(input.updated_at);

    return this.#inImmediateTransaction(() => {
      const currentRow = this.#selectByOwnerAndId(safeOwner, safeId);
      if (!currentRow) {
        throw new GenerationTransactionStoreError(
          "OPERATION_NOT_FOUND",
          "The generation operation does not exist for this owner."
        );
      }
      const current = rowToRecord(currentRow);
      if (current.revision !== expectedRevision) {
        throw new GenerationTransactionStoreError(
          "REVISION_CONFLICT",
          "The generation operation was changed by another writer."
        );
      }

      assertGenerationStateTransition(current.state, input.to_state);
      if (Date.parse(updatedAt) < Date.parse(current.updated_at)) {
        throw invalidRecordError();
      }

      const receipt = mergeReceipt(current.receipt, input.receipt);
      const failureCode =
        input.failure_code === undefined
          ? current.failure_code
          : validateFailureCode(input.failure_code);
      const nextPollAt =
        input.next_poll_at === undefined
          ? current.next_poll_at
          : validateNullableTimestamp(input.next_poll_at);

      assertOperationSnapshotInvariants({
        state: input.to_state,
        receipt,
        failure_code: failureCode
      });

      this.#stageTransitionEvent({
        generation_operation_id: current.id,
        operation_revision: current.revision + 1,
        event_type: "TRANSITIONED",
        from_state: current.state,
        to_state: input.to_state,
        reason_code: null,
        recorded_at: updatedAt
      });

      const result = this.#database
        .prepare(
          `UPDATE generation_operations
              SET state = ?, receipt_chat_uuid = ?,
                  receipt_provider_job_id = ?, receipt_message_id = ?,
                  receipt_message_object_id = ?, failure_code = ?,
                  next_poll_at = ?, updated_at = ?, revision = revision + 1
            WHERE tenant_id = ? AND subject_id = ? AND kind = ? AND id = ?
              AND revision = ?`
        )
        .run(
          input.to_state,
          receipt?.chat_uuid ?? null,
          receipt?.provider_job_id ?? null,
          receipt?.message_id ?? null,
          receipt?.message_object_id ?? null,
          failureCode,
          nextPollAt,
          updatedAt,
          safeOwner.tenant_id,
          safeOwner.subject_id,
          GENERATION_TRANSACTION_KIND,
          safeId,
          expectedRevision
        );
      if (Number(result.changes) !== 1) {
        throw new GenerationTransactionStoreError(
          "REVISION_CONFLICT",
          "The generation operation was changed by another writer."
        );
      }

      const updated = this.#selectByOwnerAndId(safeOwner, safeId);
      if (!updated) {
        throw corruptRecordError();
      }
      return cloneRecord(rowToRecord(updated));
    });
  }

  recoverInterruptedOperations(
    recoveredAt = this.#now().toISOString()
  ): GenerationOperationRecoveryResult {
    this.#assertOpen();
    const safeRecoveredAt = requireTimestamp(recoveredAt);

    return this.#inImmediateTransaction(() => {
      const rows = this.#database
        .prepare(
          `SELECT ${SELECT_COLUMNS}
             FROM generation_operations
            WHERE kind = ?
              AND state IN (
                'CHAT_CREATING', 'CHAT_RECONCILING',
                'GENERATION_DISPATCHING', 'GENERATION_RECONCILING'
              )
            ORDER BY created_at, id`
        )
        .all(GENERATION_TRANSACTION_KIND) as unknown as OperationRow[];

      const update = this.#database.prepare(
        `UPDATE generation_operations
            SET state = ?, updated_at = ?, revision = revision + 1
          WHERE id = ? AND kind = ? AND revision = ? AND state = ?`
      );
      const recovered: GenerationOperationRecord[] = [];

      for (const row of rows) {
        const current = rowToRecord(row);
        if (Date.parse(safeRecoveredAt) < Date.parse(current.updated_at)) {
          throw invalidRecordError();
        }
        const nextState = recoveredGenerationState(current.state);
        assertGenerationStateTransition(current.state, nextState);
        assertOperationSnapshotInvariants({
          state: nextState,
          receipt: current.receipt,
          failure_code: current.failure_code
        });
        this.#stageTransitionEvent({
          generation_operation_id: current.id,
          operation_revision: current.revision + 1,
          event_type: "CRASH_RECOVERED",
          from_state: current.state,
          to_state: nextState,
          reason_code: "PROCESS_RESTART",
          recorded_at: safeRecoveredAt
        });
        const result = update.run(
          nextState,
          safeRecoveredAt,
          current.id,
          GENERATION_TRANSACTION_KIND,
          current.revision,
          current.state
        );
        if (Number(result.changes) !== 1) {
          throw new GenerationTransactionStoreError(
            "REVISION_CONFLICT",
            "Crash recovery encountered a concurrent operation update."
          );
        }
        recovered.push({
          ...cloneRecord(current),
          state: nextState,
          updated_at: safeRecoveredAt,
          revision: current.revision + 1
        });
      }

      return { recovered_count: recovered.length, records: recovered };
    });
  }

  bindResultMessage(
    input: GenerationResultMessageBindingInput
  ): GenerationOperationRecord | null {
    this.#assertOpen();
    const safeOwner = validateOwner(input.owner);
    const safeId = requireSafeId(input.id);
    const expectedRevision = requireRevision(input.expected_revision);
    const resultMessageId = requireSafeId(input.result_message_id);
    const updatedAt = requireTimestamp(input.updated_at);

    return this.#inImmediateTransaction(() => {
      const row = this.#selectByOwnerAndId(safeOwner, safeId);
      if (!row) return null;
      const current = rowToRecord(row);
      if (current.revision !== expectedRevision) {
        throw new GenerationTransactionStoreError(
          "REVISION_CONFLICT",
          "The generation operation was changed by another writer."
        );
      }
      if (current.result_message_id !== null) {
        if (current.result_message_id === resultMessageId) return cloneRecord(current);
        throw new GenerationTransactionStoreError(
          "RESULT_MESSAGE_ALREADY_BOUND",
          "A result message is already bound to this generation operation."
        );
      }
      if (
        current.receipt === null || current.receipt.message_id === null ||
        current.receipt.message_id === resultMessageId ||
        !["PROVIDER_ACCEPTED", "QUEUED", "RUNNING", "SUCCEEDED"].includes(current.state) ||
        Date.parse(updatedAt) < Date.parse(current.updated_at)
      ) {
        throw invalidRecordError();
      }

      this.#stageTransitionEvent({
        generation_operation_id: current.id,
        operation_revision: current.revision + 1,
        event_type: "RESULT_BOUND",
        from_state: current.state,
        to_state: current.state,
        reason_code: "DEDICATED_CHAT_UNIQUE_RESULT",
        recorded_at: updatedAt
      });
      const update = this.#database
        .prepare(`UPDATE generation_operations
                     SET result_message_id = ?, updated_at = ?, revision = revision + 1
                   WHERE tenant_id = ? AND subject_id = ? AND kind = ? AND id = ?
                     AND revision = ? AND result_message_id IS NULL`)
        .run(
          resultMessageId, updatedAt, safeOwner.tenant_id, safeOwner.subject_id,
          GENERATION_TRANSACTION_KIND, safeId, expectedRevision
        );
      if (Number(update.changes) !== 1) {
        throw new GenerationTransactionStoreError(
          "REVISION_CONFLICT",
          "The generation operation was changed by another writer."
        );
      }
      const updated = this.#selectByOwnerAndId(safeOwner, safeId);
      if (!updated) throw corruptRecordError();
      return cloneRecord(rowToRecord(updated));
    });
  }

  claimCancelAttempt(input: GenerationCancelAttemptClaimInput): GenerationCancelAttemptClaimResult {
    this.#assertOpen();
    return this.#inImmediateTransaction(() => this.#cancelAttempts.claim(input));
  }

  getCancelAttempt(owner: GenerationOperationOwnerRef, id: string): GenerationCancelAttemptRecord | null {
    this.#assertOpen();
    return this.#cancelAttempts.get(owner, id);
  }

  getCancelAttemptByIdempotencyKey(owner: GenerationOperationOwnerRef, key: string): GenerationCancelAttemptRecord | null {
    this.#assertOpen();
    return this.#cancelAttempts.getByKey(owner, key);
  }

  listCancelAttemptEvents(
    owner: GenerationOperationOwnerRef,
    id: string,
    options?: GenerationOperationEventListOptions
  ): GenerationCancelAttemptEventRecord[] {
    this.#assertOpen();
    return this.#cancelAttempts.listEvents(owner, id, options);
  }

  settleCancelAttempt(input: GenerationCancelAttemptSettlementInput): GenerationCancelAttemptRecord {
    this.#assertOpen();
    return this.#inImmediateTransaction(() => this.#cancelAttempts.settle(input));
  }

  recoverInterruptedCancelAttempts(recoveredAt = this.#now().toISOString()): GenerationCancelAttemptRecoveryResult {
    this.#assertOpen();
    return this.#inImmediateTransaction(() => this.#cancelAttempts.recover(recoveredAt));
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#database.close();
    this.#closed = true;
  }

  #configureConnection(fileBacked: boolean): void {
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA trusted_schema = OFF");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA synchronous = FULL");

    const foreignKeys = readNumericPragma(this.#database, "foreign_keys");
    const trustedSchema = readNumericPragma(this.#database, "trusted_schema");
    const synchronous = readNumericPragma(this.#database, "synchronous");
    const journalMode = readTextPragma(this.#database, "journal_mode");
    if (
      foreignKeys !== 1 ||
      trustedSchema !== 0 ||
      synchronous !== 2 ||
      (fileBacked && journalMode !== "wal")
    ) {
      throw new GenerationTransactionStoreError(
        "CORRUPT_RECORD",
        "SQLite safety pragmas could not be established."
      );
    }
  }

  #migrate(): void {
    this.#database.exec("BEGIN EXCLUSIVE");
    try {
      this.#database.exec(`
        CREATE TABLE IF NOT EXISTS generation_store_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        ) STRICT
      `);

      const versionRow = this.#database
        .prepare(
          "SELECT COALESCE(MAX(version), 0) AS version FROM generation_store_migrations"
        )
        .get() as { version?: number } | undefined;
      const version = versionRow?.version ?? 0;
      if (!Number.isSafeInteger(version) || version < 0) {
        throw corruptRecordError();
      }
      if (version > CURRENT_SCHEMA_VERSION) {
        throw new GenerationTransactionStoreError(
          "UNSUPPORTED_SCHEMA_VERSION",
          "The generation store schema is newer than this runtime supports."
        );
      }

      if (version < 1) {
        this.#database.exec(SCHEMA_VERSION_ONE_SQL);
        this.#database
          .prepare(
            "INSERT INTO generation_store_migrations(version, applied_at) VALUES (?, ?)"
          )
          .run(1, this.#now().toISOString());
      }

      if (version < 2) {
        const appliedAt = this.#now().toISOString();
        this.#database.exec(SCHEMA_VERSION_TWO_MIGRATION_SQL);
        this.#database
          .prepare(
            `INSERT INTO generation_operation_events (
               generation_operation_id, operation_revision, event_type,
               from_state, to_state, reason_code, recorded_at
             )
             SELECT current.id, current.revision, 'MIGRATED_V1', NULL,
                    current.state,
                    CASE
                      WHEN legacy.state = 'OUTCOME_UNKNOWN'
                        THEN 'LEGACY_OUTCOME_UNKNOWN'
                      WHEN legacy.state = 'RECONCILING'
                        THEN 'LEGACY_RECONCILING'
                      WHEN ${LEGACY_V1_INVALID_SNAPSHOT_ALIASED_SQL}
                        THEN 'LEGACY_STATE_INVARIANT_VIOLATION'
                      ELSE 'SCHEMA_V1_TO_V2'
                    END,
                    ?
               FROM generation_operations AS current
               JOIN generation_operations_v1 AS legacy
                 ON legacy.id = current.id
              ORDER BY current.created_at, current.id`
          )
          .run(appliedAt);
        this.#database.exec(SCHEMA_VERSION_TWO_FINALIZE_SQL);
        this.#database
          .prepare(
            "INSERT INTO generation_store_migrations(version, applied_at) VALUES (?, ?)"
          )
          .run(2, appliedAt);
      }

      if (version < 3) {
        const appliedAt = this.#now().toISOString();
        const contextTable = this.#database
          .prepare(
            `SELECT 1 AS present
               FROM sqlite_master
              WHERE type = 'table'
                AND name = 'generation_operation_transition_context'`
          )
          .get() as { present?: number } | undefined;
        if (contextTable) {
          const contextCount = this.#database
            .prepare(
              "SELECT COUNT(*) AS count FROM generation_operation_transition_context"
            )
            .get() as { count?: number } | undefined;
          if (contextCount?.count !== 0) {
            throw corruptRecordError();
          }
        }
        this.#database.exec(SCHEMA_VERSION_THREE_MIGRATION_SQL);
        this.#database
          .prepare(
            "INSERT INTO generation_store_migrations(version, applied_at) VALUES (?, ?)"
          )
          .run(3, appliedAt);
      }

      if (version < 4) {
        this.#database.exec(SCHEMA_VERSION_FOUR_MIGRATION_SQL);
        this.#database
          .prepare("INSERT INTO generation_store_migrations(version, applied_at) VALUES (?, ?)")
          .run(4, this.#now().toISOString());
      }

      if (version < 5) {
        const contextCount = this.#database
          .prepare("SELECT COUNT(*) AS count FROM generation_operation_transition_context")
          .get() as { count?: number } | undefined;
        if (contextCount?.count !== 0) throw corruptRecordError();
        this.#database.exec(SCHEMA_VERSION_FIVE_MIGRATION_SQL);
        this.#database
          .prepare("INSERT INTO generation_store_migrations(version, applied_at) VALUES (?, ?)")
          .run(5, this.#now().toISOString());
      }

      this.#database.exec("COMMIT");
    } catch (error) {
      rollbackQuietly(this.#database);
      throw error;
    }
  }

  #insert(record: GenerationOperationRecord): void {
    this.#database
      .prepare(
        `INSERT INTO generation_operations (
           id, kind, tenant_id, subject_id, connection_id, idempotency_key,
           request_hash, model_id, operation_id, modality, catalog_version,
           schema_hash, parameter_keys_json, estimate_id, approved_max_cost,
           cost_effective, cost_unit, cost_observed_at, cost_expires_at,
           cost_cap_enforcement, state, receipt_chat_uuid,
           receipt_provider_job_id, receipt_message_id,
           receipt_message_object_id, result_message_id, failure_code, dispatch_deadline,
           next_poll_at, created_at, updated_at, revision
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         )`
      )
      .run(
        record.id,
        GENERATION_TRANSACTION_KIND,
        record.principal.tenant_id,
        record.principal.subject_id,
        record.principal.connection_id,
        record.idempotency_key,
        record.request_hash,
        record.model_id,
        record.operation_id,
        record.modality,
        record.catalog_version,
        record.schema_hash,
        JSON.stringify(record.parameter_keys),
        record.estimate_id,
        record.approved_max_cost,
        record.cost.effective_cost,
        record.cost.unit,
        record.cost.observed_at,
        record.cost.expires_at,
        record.cost.cap_enforcement,
        record.state,
        record.receipt?.chat_uuid ?? null,
        record.receipt?.provider_job_id ?? null,
        record.receipt?.message_id ?? null,
        record.receipt?.message_object_id ?? null,
        record.result_message_id ?? null,
        record.failure_code,
        record.dispatch_deadline,
        record.next_poll_at,
        record.created_at,
        record.updated_at,
        record.revision
      );
  }

  #insertEvent(event: Omit<GenerationOperationEventRecord, "sequence">): void {
    const safeEvent = validateEventForInsert(event);
    this.#database
      .prepare(
        `INSERT INTO generation_operation_events (
           generation_operation_id, operation_revision, event_type,
           from_state, to_state, reason_code, recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        safeEvent.generation_operation_id,
        safeEvent.operation_revision,
        safeEvent.event_type,
        safeEvent.from_state,
        safeEvent.to_state,
        safeEvent.reason_code,
        safeEvent.recorded_at
      );
  }

  #stageTransitionEvent(
    event: Omit<GenerationOperationEventRecord, "sequence">
  ): void {
    const safeEvent = validateEventForInsert(event);
    if (
      safeEvent.event_type !== "TRANSITIONED" &&
      safeEvent.event_type !== "CRASH_RECOVERED" &&
      safeEvent.event_type !== "RESULT_BOUND" ||
      safeEvent.from_state === null
    ) {
      throw corruptRecordError();
    }
    this.#database
      .prepare(
        `INSERT INTO generation_operation_transition_context (
           generation_operation_id, expected_revision, next_revision,
           event_type, from_state, to_state, reason_code, recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        safeEvent.generation_operation_id,
        safeEvent.operation_revision - 1,
        safeEvent.operation_revision,
        safeEvent.event_type,
        safeEvent.from_state,
        safeEvent.to_state,
        safeEvent.reason_code,
        safeEvent.recorded_at
      );
  }

  #selectByIdempotencyBinding(
    tenantId: string,
    subjectId: string,
    idempotencyKey: string
  ): OperationRow | null {
    const row = this.#database
      .prepare(
        `SELECT ${SELECT_COLUMNS}
           FROM generation_operations
          WHERE tenant_id = ? AND subject_id = ? AND kind = ?
            AND idempotency_key = ?`
      )
      .get(
        tenantId,
        subjectId,
        GENERATION_TRANSACTION_KIND,
        idempotencyKey
      );
    return row ? (row as unknown as OperationRow) : null;
  }

  #selectByOwnerAndId(
    owner: GenerationOperationOwnerRef,
    id: string
  ): OperationRow | null {
    const row = this.#database
      .prepare(
        `SELECT ${SELECT_COLUMNS}
           FROM generation_operations
          WHERE tenant_id = ? AND subject_id = ? AND kind = ? AND id = ?`
      )
      .get(
        owner.tenant_id,
        owner.subject_id,
        GENERATION_TRANSACTION_KIND,
        id
      );
    return row ? (row as unknown as OperationRow) : null;
  }

  #selectByRawId(id: string): OperationRow | null {
    const row = this.#database
      .prepare(
        `SELECT ${SELECT_COLUMNS}
           FROM generation_operations
          WHERE id = ?`
      )
      .get(id);
    return row ? (row as unknown as OperationRow) : null;
  }

  #inImmediateTransaction<T>(work: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      rollbackQuietly(this.#database);
      throw error;
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new GenerationTransactionStoreError(
        "STORE_CLOSED",
        "The generation transaction store is closed."
      );
    }
  }
}

const SCHEMA_VERSION_ONE_SQL = `
  CREATE TABLE generation_operations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind = 'generation'),
    tenant_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    model_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    modality TEXT NOT NULL CHECK (modality IN ('text', 'image', 'video', 'audio')),
    catalog_version TEXT NOT NULL,
    schema_hash TEXT NOT NULL,
    parameter_keys_json TEXT NOT NULL,
    estimate_id TEXT NOT NULL,
    approved_max_cost TEXT NOT NULL,
    cost_effective TEXT,
    cost_unit TEXT,
    cost_observed_at TEXT NOT NULL,
    cost_expires_at TEXT NOT NULL,
    cost_cap_enforcement TEXT NOT NULL CHECK (
      cost_cap_enforcement IN (
        'UPSTREAM_QUOTE_BOUND', 'UPSTREAM_MAX_COST',
        'PRE_DISPATCH_ONLY', 'UNENFORCEABLE'
      )
    ),
    state TEXT NOT NULL CHECK (
      state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY',
        'GENERATION_DISPATCHING', 'PROVIDER_ACCEPTED', 'QUEUED',
        'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED',
        'REJECTED_NO_COMMIT', 'OUTCOME_UNKNOWN', 'RECONCILING',
        'TERMINAL_UNRESOLVED'
      )
    ),
    receipt_chat_uuid TEXT,
    receipt_provider_job_id TEXT,
    receipt_message_id TEXT,
    receipt_message_object_id TEXT,
    failure_code TEXT,
    dispatch_deadline TEXT NOT NULL,
    next_poll_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    UNIQUE (tenant_id, subject_id, kind, idempotency_key)
  ) STRICT;

  CREATE INDEX generation_operations_owner_id
    ON generation_operations (tenant_id, subject_id, id);

  CREATE TRIGGER generation_operations_no_delete
  BEFORE DELETE ON generation_operations
  BEGIN
    SELECT RAISE(ABORT, 'generation operation records cannot be deleted');
  END;

  CREATE TRIGGER generation_operations_immutable_binding
  BEFORE UPDATE OF
    id, kind, tenant_id, subject_id, connection_id, idempotency_key,
    request_hash, model_id, operation_id, modality, catalog_version,
    schema_hash, parameter_keys_json, estimate_id, approved_max_cost,
    cost_effective, cost_unit, cost_observed_at, cost_expires_at,
    cost_cap_enforcement, dispatch_deadline, created_at
  ON generation_operations
  BEGIN
    SELECT RAISE(ABORT, 'generation operation binding is immutable');
  END
`;

const LEGACY_V1_INVALID_SNAPSHOT_SQL = legacyV1InvalidSnapshotSql();
const LEGACY_V1_INVALID_SNAPSHOT_ALIASED_SQL =
  legacyV1InvalidSnapshotSql("legacy.");
const CURRENT_INVALID_SNAPSHOT_SQL = currentInvalidSnapshotSql();
const CURRENT_INVALID_SNAPSHOT_ALIASED_SQL =
  currentInvalidSnapshotSql("NEW.");

const SCHEMA_VERSION_TWO_MIGRATION_SQL = `
  DROP TRIGGER IF EXISTS generation_operations_no_delete;
  DROP TRIGGER IF EXISTS generation_operations_immutable_binding;
  DROP INDEX IF EXISTS generation_operations_owner_id;

  ALTER TABLE generation_operations RENAME TO generation_operations_v1;

  CREATE TABLE generation_operations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind = 'generation'),
    tenant_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    model_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    modality TEXT NOT NULL CHECK (modality IN ('text', 'image', 'video', 'audio')),
    catalog_version TEXT NOT NULL,
    schema_hash TEXT NOT NULL,
    parameter_keys_json TEXT NOT NULL,
    estimate_id TEXT NOT NULL,
    approved_max_cost TEXT NOT NULL,
    cost_effective TEXT,
    cost_unit TEXT,
    cost_observed_at TEXT NOT NULL,
    cost_expires_at TEXT NOT NULL,
    cost_cap_enforcement TEXT NOT NULL CHECK (
      cost_cap_enforcement IN (
        'UPSTREAM_QUOTE_BOUND', 'UPSTREAM_MAX_COST',
        'PRE_DISPATCH_ONLY', 'UNENFORCEABLE'
      )
    ),
    state TEXT NOT NULL CHECK (
      state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY',
        'CHAT_CREATE_OUTCOME_UNKNOWN', 'CHAT_RECONCILING',
        'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED',
        'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED',
        'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )
    ),
    receipt_chat_uuid TEXT,
    receipt_provider_job_id TEXT,
    receipt_message_id TEXT,
    receipt_message_object_id TEXT,
    failure_code TEXT,
    dispatch_deadline TEXT NOT NULL,
    next_poll_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    UNIQUE (tenant_id, subject_id, kind, idempotency_key),
    CHECK (NOT (${CURRENT_INVALID_SNAPSHOT_SQL}))
  ) STRICT;

  INSERT INTO generation_operations (
    id, kind, tenant_id, subject_id, connection_id, idempotency_key,
    request_hash, model_id, operation_id, modality, catalog_version,
    schema_hash, parameter_keys_json, estimate_id, approved_max_cost,
    cost_effective, cost_unit, cost_observed_at, cost_expires_at,
    cost_cap_enforcement, state, receipt_chat_uuid,
    receipt_provider_job_id, receipt_message_id, receipt_message_object_id,
    failure_code, dispatch_deadline, next_poll_at, created_at, updated_at,
    revision
  )
  SELECT
    id, kind, tenant_id, subject_id, connection_id, idempotency_key,
    request_hash, model_id, operation_id, modality, catalog_version,
    schema_hash, parameter_keys_json, estimate_id, approved_max_cost,
    cost_effective, cost_unit, cost_observed_at, cost_expires_at,
    cost_cap_enforcement,
    CASE
      WHEN state IN ('OUTCOME_UNKNOWN', 'RECONCILING')
        THEN 'TERMINAL_UNRESOLVED'
      WHEN ${LEGACY_V1_INVALID_SNAPSHOT_SQL}
        THEN 'TERMINAL_UNRESOLVED'
      ELSE state
    END,
    receipt_chat_uuid,
    CASE WHEN receipt_chat_uuid IS NULL THEN NULL ELSE receipt_provider_job_id END,
    CASE WHEN receipt_chat_uuid IS NULL THEN NULL ELSE receipt_message_id END,
    CASE WHEN receipt_chat_uuid IS NULL THEN NULL ELSE receipt_message_object_id END,
    CASE
      WHEN state IN ('OUTCOME_UNKNOWN', 'RECONCILING')
        THEN 'MIGRATED_AMBIGUOUS_STAGE'
      WHEN ${LEGACY_V1_INVALID_SNAPSHOT_SQL}
        THEN 'MIGRATED_STATE_INVARIANT_VIOLATION'
      ELSE failure_code
    END,
    dispatch_deadline, next_poll_at, created_at, updated_at, revision
  FROM generation_operations_v1;

  CREATE INDEX generation_operations_owner_id
    ON generation_operations (tenant_id, subject_id, id);

  CREATE TABLE generation_operation_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_operation_id TEXT NOT NULL
      REFERENCES generation_operations(id),
    operation_revision INTEGER NOT NULL CHECK (operation_revision >= 0),
    event_type TEXT NOT NULL CHECK (
      event_type IN ('CREATED', 'TRANSITIONED', 'CRASH_RECOVERED', 'MIGRATED_V1')
    ),
    from_state TEXT CHECK (
      from_state IS NULL OR from_state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY',
        'CHAT_CREATE_OUTCOME_UNKNOWN', 'CHAT_RECONCILING',
        'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED',
        'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED',
        'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )
    ),
    to_state TEXT NOT NULL CHECK (
      to_state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY',
        'CHAT_CREATE_OUTCOME_UNKNOWN', 'CHAT_RECONCILING',
        'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED',
        'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED',
        'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )
    ),
    reason_code TEXT,
    recorded_at TEXT NOT NULL,
    UNIQUE (generation_operation_id, operation_revision)
  ) STRICT;

  CREATE INDEX generation_operation_events_operation_sequence
    ON generation_operation_events (generation_operation_id, sequence);

  CREATE TABLE generation_operation_transition_context (
    generation_operation_id TEXT PRIMARY KEY
      REFERENCES generation_operations(id),
    expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
    next_revision INTEGER NOT NULL CHECK (next_revision = expected_revision + 1),
    event_type TEXT NOT NULL CHECK (
      event_type IN ('TRANSITIONED', 'CRASH_RECOVERED')
    ),
    from_state TEXT NOT NULL CHECK (
      from_state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY',
        'CHAT_CREATE_OUTCOME_UNKNOWN', 'CHAT_RECONCILING',
        'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED',
        'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED',
        'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )
    ),
    to_state TEXT NOT NULL CHECK (
      to_state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY',
        'CHAT_CREATE_OUTCOME_UNKNOWN', 'CHAT_RECONCILING',
        'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED',
        'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED',
        'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )
    ),
    reason_code TEXT,
    recorded_at TEXT NOT NULL,
    CHECK (
      (event_type = 'TRANSITIONED' AND reason_code IS NULL)
      OR (event_type = 'CRASH_RECOVERED' AND reason_code = 'PROCESS_RESTART')
    )
  ) STRICT;
`;

const CURRENT_SCHEMA_TRIGGERS_SQL = `
  CREATE TRIGGER generation_operations_no_delete
  BEFORE DELETE ON generation_operations
  BEGIN
    SELECT RAISE(ABORT, 'generation operation records cannot be deleted');
  END;

  CREATE TRIGGER generation_operations_immutable_binding
  BEFORE UPDATE OF
    id, kind, tenant_id, subject_id, connection_id, idempotency_key,
    request_hash, model_id, operation_id, modality, catalog_version,
    schema_hash, parameter_keys_json, estimate_id, approved_max_cost,
    cost_effective, cost_unit, cost_observed_at, cost_expires_at,
    cost_cap_enforcement, dispatch_deadline, created_at
  ON generation_operations
  BEGIN
    SELECT RAISE(ABORT, 'generation operation binding is immutable');
  END;

  CREATE TRIGGER generation_operations_mutation_guard
  BEFORE UPDATE ON generation_operations
  WHEN
    ${CURRENT_INVALID_SNAPSHOT_ALIASED_SQL}
    OR NEW.revision <> OLD.revision + 1
    OR NEW.updated_at < OLD.updated_at
    OR (OLD.receipt_chat_uuid IS NOT NULL
        AND NEW.receipt_chat_uuid IS NOT OLD.receipt_chat_uuid)
    OR (OLD.receipt_provider_job_id IS NOT NULL
        AND NEW.receipt_provider_job_id IS NOT OLD.receipt_provider_job_id)
    OR (OLD.receipt_message_id IS NOT NULL
        AND NEW.receipt_message_id IS NOT OLD.receipt_message_id)
    OR (OLD.receipt_message_object_id IS NOT NULL
        AND NEW.receipt_message_object_id IS NOT OLD.receipt_message_object_id)
    OR (OLD.result_message_id IS NOT NULL
        AND NEW.result_message_id IS NOT OLD.result_message_id)
    OR (NEW.result_message_id IS NOT NULL AND (
      NEW.receipt_message_id IS NULL
      OR NEW.result_message_id = NEW.receipt_message_id
    ))
    OR (OLD.result_message_id IS NULL AND NEW.result_message_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM generation_operation_transition_context
           WHERE generation_operation_id = OLD.id
             AND expected_revision = OLD.revision
             AND next_revision = NEW.revision
             AND event_type = 'RESULT_BOUND'
             AND reason_code = 'DEDICATED_CHAT_UNIQUE_RESULT'
             AND from_state = OLD.state AND to_state = OLD.state
        ))
    OR (NEW.receipt_chat_uuid IS NULL AND (
      NEW.receipt_provider_job_id IS NOT NULL
      OR NEW.receipt_message_id IS NOT NULL
      OR NEW.receipt_message_object_id IS NOT NULL
    ))
    OR (NEW.state IN (
      'CHAT_READY', 'GENERATION_DISPATCHING',
      'GENERATION_OUTCOME_UNKNOWN', 'GENERATION_RECONCILING',
      'PROVIDER_ACCEPTED', 'QUEUED', 'RUNNING',
      'SUCCEEDED', 'FAILED', 'CANCELED'
    ) AND NEW.receipt_chat_uuid IS NULL)
    OR (NEW.state IN (
      'PROVIDER_ACCEPTED', 'QUEUED', 'RUNNING',
      'SUCCEEDED', 'FAILED', 'CANCELED'
    ) AND NEW.receipt_provider_job_id IS NULL
      AND NEW.receipt_message_id IS NULL
      AND NEW.receipt_message_object_id IS NULL)
    OR (NEW.state IN (
      'PREPARED', 'CHAT_CREATING', 'CHAT_CREATE_OUTCOME_UNKNOWN',
      'CHAT_RECONCILING', 'CHAT_READY', 'REJECTED_NO_COMMIT'
    ) AND (
      NEW.receipt_provider_job_id IS NOT NULL
      OR NEW.receipt_message_id IS NOT NULL
      OR NEW.receipt_message_object_id IS NOT NULL
    ))
    OR (NEW.state IN (
      'FAILED', 'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
    ) AND NEW.failure_code IS NULL)
    OR (NEW.state IN (
      'PREPARED', 'CHAT_CREATING', 'CHAT_READY',
      'GENERATION_DISPATCHING', 'PROVIDER_ACCEPTED', 'QUEUED',
      'RUNNING', 'SUCCEEDED', 'CANCELED'
    ) AND NEW.failure_code IS NOT NULL)
  BEGIN
    SELECT RAISE(ABORT, 'generation operation mutation violates invariants');
  END;

  CREATE TRIGGER generation_operations_transition_context_required
  BEFORE UPDATE ON generation_operations
  WHEN NOT EXISTS (
    SELECT 1
      FROM generation_operation_transition_context
     WHERE generation_operation_id = OLD.id
       AND expected_revision = OLD.revision
       AND next_revision = NEW.revision
       AND from_state = OLD.state
       AND to_state = NEW.state
       AND recorded_at = NEW.updated_at
  )
  BEGIN
    SELECT RAISE(ABORT, 'generation operation transition context is required');
  END;

  CREATE TRIGGER generation_operations_append_transition_event
  AFTER UPDATE ON generation_operations
  BEGIN
    INSERT INTO generation_operation_events (
      generation_operation_id, operation_revision, event_type,
      from_state, to_state, reason_code, recorded_at
    )
    SELECT generation_operation_id, next_revision, event_type,
           from_state, to_state, reason_code, recorded_at
      FROM generation_operation_transition_context
     WHERE generation_operation_id = NEW.id
       AND expected_revision = OLD.revision
       AND next_revision = NEW.revision;

    DELETE FROM generation_operation_transition_context
     WHERE generation_operation_id = NEW.id
       AND expected_revision = OLD.revision
       AND next_revision = NEW.revision;
  END;

  CREATE TRIGGER generation_operation_events_no_update
  BEFORE UPDATE ON generation_operation_events
  BEGIN
    SELECT RAISE(ABORT, 'generation operation events cannot be updated');
  END;

  CREATE TRIGGER generation_operation_events_insert_guard
  BEFORE INSERT ON generation_operation_events
  WHEN NOT EXISTS (
    SELECT 1
      FROM generation_operations
     WHERE id = NEW.generation_operation_id
       AND revision = NEW.operation_revision
       AND state = NEW.to_state
  ) OR COALESCE((
    SELECT MAX(operation_revision)
      FROM generation_operation_events
     WHERE generation_operation_id = NEW.generation_operation_id
  ), -1) <> NEW.operation_revision - 1
  BEGIN
    SELECT RAISE(ABORT, 'generation operation event revision is not monotonic');
  END;

  CREATE TRIGGER generation_operation_events_no_delete
  BEFORE DELETE ON generation_operation_events
  BEGIN
    SELECT RAISE(ABORT, 'generation operation events cannot be deleted');
  END;
`;

const SCHEMA_VERSION_TWO_FINALIZE_SQL = `
  DROP TABLE generation_operations_v1;
  ${CURRENT_SCHEMA_TRIGGERS_SQL}
`;

const SCHEMA_VERSION_FIVE_MIGRATION_SQL = `
  DROP TRIGGER generation_operations_no_delete;
  DROP TRIGGER generation_operations_immutable_binding;
  DROP TRIGGER generation_operations_mutation_guard;
  DROP TRIGGER generation_operations_transition_context_required;
  DROP TRIGGER generation_operations_append_transition_event;
  DROP TRIGGER generation_operation_events_no_update;
  DROP TRIGGER generation_operation_events_insert_guard;
  DROP TRIGGER generation_operation_events_no_delete;

  ALTER TABLE generation_operations ADD COLUMN result_message_id TEXT;

  ALTER TABLE generation_operation_events RENAME TO generation_operation_events_v4;
  CREATE TABLE generation_operation_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_operation_id TEXT NOT NULL REFERENCES generation_operations(id),
    operation_revision INTEGER NOT NULL CHECK (operation_revision >= 0),
    event_type TEXT NOT NULL CHECK (
      event_type IN ('CREATED', 'TRANSITIONED', 'CRASH_RECOVERED', 'MIGRATED_V1', 'RESULT_BOUND')
    ),
    from_state TEXT,
    to_state TEXT NOT NULL,
    reason_code TEXT,
    recorded_at TEXT NOT NULL,
    UNIQUE (generation_operation_id, operation_revision)
  ) STRICT;
  INSERT INTO generation_operation_events (
    sequence, generation_operation_id, operation_revision, event_type,
    from_state, to_state, reason_code, recorded_at
  ) SELECT sequence, generation_operation_id, operation_revision, event_type,
           from_state, to_state, reason_code, recorded_at
      FROM generation_operation_events_v4 ORDER BY sequence;
  DROP TABLE generation_operation_events_v4;

  ALTER TABLE generation_operation_transition_context RENAME TO generation_operation_transition_context_v4;
  CREATE TABLE generation_operation_transition_context (
    generation_operation_id TEXT PRIMARY KEY REFERENCES generation_operations(id),
    expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
    next_revision INTEGER NOT NULL CHECK (next_revision = expected_revision + 1),
    event_type TEXT NOT NULL CHECK (event_type IN ('TRANSITIONED', 'CRASH_RECOVERED', 'RESULT_BOUND')),
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    reason_code TEXT,
    recorded_at TEXT NOT NULL,
    CHECK (
      (event_type = 'TRANSITIONED' AND reason_code IS NULL AND from_state <> to_state)
      OR (event_type = 'CRASH_RECOVERED' AND reason_code = 'PROCESS_RESTART' AND from_state <> to_state)
      OR (event_type = 'RESULT_BOUND' AND reason_code = 'DEDICATED_CHAT_UNIQUE_RESULT'
          AND from_state = to_state AND from_state IN ('PROVIDER_ACCEPTED', 'QUEUED', 'RUNNING', 'SUCCEEDED'))
    )
  ) STRICT;
  DROP TABLE generation_operation_transition_context_v4;

  CREATE INDEX generation_operation_events_operation_sequence
    ON generation_operation_events (generation_operation_id, sequence);
  ${CURRENT_SCHEMA_TRIGGERS_SQL}
`;

const SCHEMA_VERSION_THREE_MIGRATION_SQL = `
  DROP TRIGGER IF EXISTS generation_operations_no_delete;
  DROP TRIGGER IF EXISTS generation_operations_immutable_binding;
  DROP TRIGGER IF EXISTS generation_operations_mutation_guard;
  DROP TRIGGER IF EXISTS generation_operations_transition_context_required;
  DROP TRIGGER IF EXISTS generation_operations_append_transition_event;
  DROP TRIGGER IF EXISTS generation_operation_events_no_update;
  DROP TRIGGER IF EXISTS generation_operation_events_insert_guard;
  DROP TRIGGER IF EXISTS generation_operation_events_no_delete;
  DROP INDEX IF EXISTS generation_operations_owner_id;
  DROP INDEX IF EXISTS generation_operation_events_operation_sequence;
  DROP TABLE IF EXISTS generation_operation_transition_context;

  ALTER TABLE generation_operation_events
    RENAME TO generation_operation_events_v2;
  ALTER TABLE generation_operations RENAME TO generation_operations_v2;

  CREATE TABLE generation_operations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind = 'generation'),
    tenant_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    model_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    modality TEXT NOT NULL CHECK (modality IN ('text', 'image', 'video', 'audio')),
    catalog_version TEXT NOT NULL,
    schema_hash TEXT NOT NULL,
    parameter_keys_json TEXT NOT NULL,
    estimate_id TEXT NOT NULL,
    approved_max_cost TEXT NOT NULL,
    cost_effective TEXT,
    cost_unit TEXT,
    cost_observed_at TEXT NOT NULL,
    cost_expires_at TEXT NOT NULL,
    cost_cap_enforcement TEXT NOT NULL CHECK (
      cost_cap_enforcement IN (
        'UPSTREAM_QUOTE_BOUND', 'UPSTREAM_MAX_COST',
        'PRE_DISPATCH_ONLY', 'UNENFORCEABLE'
      )
    ),
    state TEXT NOT NULL CHECK (
      state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY',
        'CHAT_CREATE_OUTCOME_UNKNOWN', 'CHAT_RECONCILING',
        'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED',
        'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED',
        'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )
    ),
    receipt_chat_uuid TEXT,
    receipt_provider_job_id TEXT,
    receipt_message_id TEXT,
    receipt_message_object_id TEXT,
    failure_code TEXT,
    dispatch_deadline TEXT NOT NULL,
    next_poll_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    UNIQUE (tenant_id, subject_id, kind, idempotency_key),
    CHECK (NOT (${CURRENT_INVALID_SNAPSHOT_SQL}))
  ) STRICT;

  INSERT INTO generation_operations (
    id, kind, tenant_id, subject_id, connection_id, idempotency_key,
    request_hash, model_id, operation_id, modality, catalog_version,
    schema_hash, parameter_keys_json, estimate_id, approved_max_cost,
    cost_effective, cost_unit, cost_observed_at, cost_expires_at,
    cost_cap_enforcement, state, receipt_chat_uuid,
    receipt_provider_job_id, receipt_message_id, receipt_message_object_id,
    failure_code, dispatch_deadline, next_poll_at, created_at, updated_at,
    revision
  )
  SELECT
    id, kind, tenant_id, subject_id, connection_id, idempotency_key,
    request_hash, model_id, operation_id, modality, catalog_version,
    schema_hash, parameter_keys_json, estimate_id, approved_max_cost,
    cost_effective, cost_unit, cost_observed_at, cost_expires_at,
    cost_cap_enforcement, state, receipt_chat_uuid,
    receipt_provider_job_id, receipt_message_id, receipt_message_object_id,
    failure_code, dispatch_deadline, next_poll_at, created_at, updated_at,
    revision
  FROM generation_operations_v2;

  CREATE TABLE generation_operation_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_operation_id TEXT NOT NULL
      REFERENCES generation_operations(id),
    operation_revision INTEGER NOT NULL CHECK (operation_revision >= 0),
    event_type TEXT NOT NULL CHECK (
      event_type IN ('CREATED', 'TRANSITIONED', 'CRASH_RECOVERED', 'MIGRATED_V1')
    ),
    from_state TEXT CHECK (
      from_state IS NULL OR from_state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY',
        'CHAT_CREATE_OUTCOME_UNKNOWN', 'CHAT_RECONCILING',
        'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED',
        'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED',
        'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )
    ),
    to_state TEXT NOT NULL CHECK (
      to_state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY',
        'CHAT_CREATE_OUTCOME_UNKNOWN', 'CHAT_RECONCILING',
        'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED',
        'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED',
        'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )
    ),
    reason_code TEXT,
    recorded_at TEXT NOT NULL,
    UNIQUE (generation_operation_id, operation_revision)
  ) STRICT;

  INSERT INTO generation_operation_events (
    sequence, generation_operation_id, operation_revision, event_type,
    from_state, to_state, reason_code, recorded_at
  )
  SELECT sequence, generation_operation_id, operation_revision, event_type,
         from_state, to_state, reason_code, recorded_at
    FROM generation_operation_events_v2
   ORDER BY sequence;

  CREATE INDEX generation_operations_owner_id
    ON generation_operations (tenant_id, subject_id, id);
  CREATE INDEX generation_operation_events_operation_sequence
    ON generation_operation_events (generation_operation_id, sequence);

  CREATE TABLE generation_operation_transition_context (
    generation_operation_id TEXT PRIMARY KEY
      REFERENCES generation_operations(id),
    expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
    next_revision INTEGER NOT NULL CHECK (next_revision = expected_revision + 1),
    event_type TEXT NOT NULL CHECK (
      event_type IN ('TRANSITIONED', 'CRASH_RECOVERED')
    ),
    from_state TEXT NOT NULL CHECK (
      from_state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY',
        'CHAT_CREATE_OUTCOME_UNKNOWN', 'CHAT_RECONCILING',
        'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED',
        'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED',
        'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )
    ),
    to_state TEXT NOT NULL CHECK (
      to_state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY',
        'CHAT_CREATE_OUTCOME_UNKNOWN', 'CHAT_RECONCILING',
        'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED',
        'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED',
        'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )
    ),
    reason_code TEXT,
    recorded_at TEXT NOT NULL,
    CHECK (
      (event_type = 'TRANSITIONED' AND reason_code IS NULL)
      OR (event_type = 'CRASH_RECOVERED' AND reason_code = 'PROCESS_RESTART')
    )
  ) STRICT;

  DROP TABLE generation_operation_events_v2;
  DROP TABLE generation_operations_v2;

  ${CURRENT_SCHEMA_TRIGGERS_SQL}
`;

function legacyV1InvalidSnapshotSql(alias = ""): string {
  const column = (name: string): string => `${alias}${name}`;
  const state = column("state");
  const chat = column("receipt_chat_uuid");
  const providerJob = column("receipt_provider_job_id");
  const message = column("receipt_message_id");
  const messageObject = column("receipt_message_object_id");
  const failure = column("failure_code");
  const noReceipt = `(${chat} IS NULL AND ${providerJob} IS NULL AND ${message} IS NULL AND ${messageObject} IS NULL)`;
  const chatOnly = `(${chat} IS NOT NULL AND ${providerJob} IS NULL AND ${message} IS NULL AND ${messageObject} IS NULL)`;
  const providerCorrelation = `(${chat} IS NOT NULL AND (${providerJob} IS NOT NULL OR ${message} IS NOT NULL OR ${messageObject} IS NOT NULL))`;
  const structurallyValidReceipt = `(${chat} IS NOT NULL OR (${providerJob} IS NULL AND ${message} IS NULL AND ${messageObject} IS NULL))`;
  const safeFailure = `(${failure} IS NOT NULL AND length(${failure}) BETWEEN 1 AND 128 AND substr(${failure}, 1, 1) GLOB '[A-Z]' AND ${failure} NOT GLOB '*[^A-Z0-9_]*')`;

  return `NOT (
    (${state} = 'PREPARED' AND ${noReceipt} AND ${failure} IS NULL)
    OR (${state} = 'CHAT_CREATING' AND ${noReceipt} AND ${failure} IS NULL)
    OR (${state} = 'CHAT_READY' AND ${chatOnly} AND ${failure} IS NULL)
    OR (${state} = 'GENERATION_DISPATCHING' AND ${chatOnly} AND ${failure} IS NULL)
    OR (${state} IN (
      'PROVIDER_ACCEPTED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'CANCELED'
    ) AND ${providerCorrelation} AND ${failure} IS NULL)
    OR (${state} = 'FAILED' AND ${providerCorrelation} AND ${safeFailure})
    OR (${state} = 'REJECTED_NO_COMMIT'
      AND ${providerJob} IS NULL AND ${message} IS NULL
      AND ${messageObject} IS NULL AND ${safeFailure})
    OR (${state} = 'TERMINAL_UNRESOLVED'
      AND ${structurallyValidReceipt} AND ${safeFailure})
  )`;
}

function currentInvalidSnapshotSql(alias = ""): string {
  const column = (name: string): string => `${alias}${name}`;
  const state = column("state");
  const chat = column("receipt_chat_uuid");
  const providerJob = column("receipt_provider_job_id");
  const message = column("receipt_message_id");
  const messageObject = column("receipt_message_object_id");
  const failure = column("failure_code");
  const noReceipt = `(${chat} IS NULL AND ${providerJob} IS NULL AND ${message} IS NULL AND ${messageObject} IS NULL)`;
  const chatOnly = `(${chat} IS NOT NULL AND ${providerJob} IS NULL AND ${message} IS NULL AND ${messageObject} IS NULL)`;
  const providerCorrelation = `(${chat} IS NOT NULL AND (${providerJob} IS NOT NULL OR ${message} IS NOT NULL OR ${messageObject} IS NOT NULL))`;
  const structurallyValidReceipt = `(${chat} IS NOT NULL OR (${providerJob} IS NULL AND ${message} IS NULL AND ${messageObject} IS NULL))`;
  const safeFailure = `(${failure} IS NOT NULL AND length(${failure}) BETWEEN 1 AND 128 AND substr(${failure}, 1, 1) GLOB '[A-Z]' AND ${failure} NOT GLOB '*[^A-Z0-9_]*')`;
  const optionalSafeFailure = `(${failure} IS NULL OR ${safeFailure})`;

  return `NOT (
    (${state} = 'PREPARED' AND ${noReceipt} AND ${failure} IS NULL)
    OR (${state} = 'CHAT_CREATING' AND ${noReceipt} AND ${failure} IS NULL)
    OR (${state} IN ('CHAT_CREATE_OUTCOME_UNKNOWN', 'CHAT_RECONCILING')
      AND ${noReceipt} AND ${optionalSafeFailure})
    OR (${state} IN ('CHAT_READY', 'GENERATION_DISPATCHING')
      AND ${chatOnly} AND ${failure} IS NULL)
    OR (${state} IN ('GENERATION_OUTCOME_UNKNOWN', 'GENERATION_RECONCILING')
      AND ${chatOnly} AND ${optionalSafeFailure})
    OR (${state} IN (
      'PROVIDER_ACCEPTED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'CANCELED'
    ) AND ${providerCorrelation} AND ${failure} IS NULL)
    OR (${state} = 'FAILED' AND ${providerCorrelation} AND ${safeFailure})
    OR (${state} = 'REJECTED_NO_COMMIT'
      AND ${providerJob} IS NULL AND ${message} IS NULL
      AND ${messageObject} IS NULL AND ${safeFailure})
    OR (${state} = 'TERMINAL_UNRESOLVED'
      AND ${structurallyValidReceipt} AND ${safeFailure})
  )`;
}

function prepareDatabasePath(databasePath: string): string {
  if (databasePath === ":memory:") {
    return databasePath;
  }
  if (databasePath.length === 0 || databasePath.includes("\0")) {
    throw unsafePathError();
  }

  const absolutePath = resolve(databasePath);
  const parent = dirname(absolutePath);
  try {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const parentStat = lstatSync(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw unsafePathError();
    }
    if ((parentStat.mode & 0o077) !== 0) {
      throw unsafePathError();
    }

    try {
      const descriptor = openSync(absolutePath, "wx", 0o600);
      closeSync(descriptor);
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }

    const databaseStat = lstatSync(absolutePath);
    if (
      !databaseStat.isFile() ||
      databaseStat.isSymbolicLink() ||
      databaseStat.nlink !== 1
    ) {
      throw unsafePathError();
    }
    chmodSync(absolutePath, 0o600);
    return absolutePath;
  } catch (error) {
    if (error instanceof GenerationTransactionStoreError) {
      throw error;
    }
    throw unsafePathError();
  }
}

function validateNewRecord(
  candidate: GenerationOperationRecord
): GenerationOperationRecord {
  if (!candidate || typeof candidate !== "object") {
    throw invalidRecordError();
  }
  const parameterKeys = validateParameterKeys(candidate.parameter_keys);
  const createdAt = requireTimestamp(candidate.created_at);
  const updatedAt = requireTimestamp(candidate.updated_at);
  if (
    candidate.state !== "PREPARED" ||
    candidate.revision !== 0 ||
    candidate.receipt !== null ||
    candidate.failure_code !== null ||
    candidate.next_poll_at !== null ||
    Date.parse(updatedAt) < Date.parse(createdAt)
  ) {
    throw invalidRecordError();
  }

  const modality = candidate.modality;
  if (!(["text", "image", "video", "audio"] as const).includes(modality)) {
    throw invalidRecordError();
  }
  if (!COST_CAP_ENFORCEMENTS.includes(candidate.cost.cap_enforcement)) {
    throw invalidRecordError();
  }

  const effectiveCost =
    candidate.cost.effective_cost === null
      ? null
      : requireDecimal(candidate.cost.effective_cost);
  const costUnit =
    candidate.cost.unit === null ? null : requireSafeId(candidate.cost.unit);
  if ((effectiveCost === null) !== (costUnit === null)) {
    throw invalidRecordError();
  }

  return {
    id: requireSafeId(candidate.id),
    principal: {
      tenant_id: requireTenantId(candidate.principal.tenant_id),
      subject_id: requireSubjectId(candidate.principal.subject_id),
      connection_id: requireSafeId(candidate.principal.connection_id)
    },
    idempotency_key: requireSafeId(candidate.idempotency_key),
    request_hash: requireHash(candidate.request_hash),
    model_id: requireSafeId(candidate.model_id),
    operation_id: requireSafeId(candidate.operation_id),
    modality,
    catalog_version: requireSafeId(candidate.catalog_version),
    schema_hash: requireHash(candidate.schema_hash),
    parameter_keys: parameterKeys,
    estimate_id: requireSafeId(candidate.estimate_id),
    approved_max_cost: requireApprovedMaxCost(candidate.approved_max_cost, candidate.cost.cap_enforcement),
    cost: {
      effective_cost: effectiveCost,
      unit: costUnit,
      observed_at: requireTimestamp(candidate.cost.observed_at),
      expires_at: requireTimestamp(candidate.cost.expires_at),
      cap_enforcement: candidate.cost.cap_enforcement
    },
    state: candidate.state,
    receipt: null,
    result_message_id: null,
    failure_code: null,
    dispatch_deadline: requireTimestamp(candidate.dispatch_deadline),
    next_poll_at: null,
    created_at: createdAt,
    updated_at: updatedAt,
    revision: 0
  };
}

function rowToRecord(row: OperationRow): GenerationOperationRecord {
  try {
    if (row.kind !== GENERATION_TRANSACTION_KIND) {
      throw corruptRecordError();
    }
    const parameterKeys = JSON.parse(row.parameter_keys_json) as unknown;
    const state = requireState(row.state);
    const costEnforcement = requireCostCapEnforcement(
      row.cost_cap_enforcement
    );
    const receipt = row.receipt_chat_uuid
      ? {
          chat_uuid: requireSafeId(row.receipt_chat_uuid),
          provider_job_id: validateNullableSafeId(row.receipt_provider_job_id),
          message_id: validateNullableSafeId(row.receipt_message_id),
          message_object_id: validateNullableSafeId(
            row.receipt_message_object_id
          )
        }
      : requireAbsentReceiptColumns(row);
    const resultMessageId = validateNullableSafeId(row.result_message_id);
    if (resultMessageId !== null && (receipt === null || receipt.message_id === null || receipt.message_id === resultMessageId)) {
      throw corruptRecordError();
    }

    const effectiveCost = validateNullableDecimal(row.cost_effective);
    const costUnit = validateNullableSafeId(row.cost_unit);
    if ((effectiveCost === null) !== (costUnit === null)) {
      throw corruptRecordError();
    }

    const record: GenerationOperationRecord = {
      id: requireSafeId(row.id),
      principal: {
        tenant_id: requireTenantId(row.tenant_id),
        subject_id: requireSubjectId(row.subject_id),
        connection_id: requireSafeId(row.connection_id)
      },
      idempotency_key: requireSafeId(row.idempotency_key),
      request_hash: requireHash(row.request_hash),
      model_id: requireSafeId(row.model_id),
      operation_id: requireSafeId(row.operation_id),
      modality: requireModality(row.modality),
      catalog_version: requireSafeId(row.catalog_version),
      schema_hash: requireHash(row.schema_hash),
      parameter_keys: validateParameterKeys(parameterKeys),
      estimate_id: requireSafeId(row.estimate_id),
      approved_max_cost: requireApprovedMaxCost(row.approved_max_cost, costEnforcement),
      cost: {
        effective_cost: effectiveCost,
        unit: costUnit,
        observed_at: requireTimestamp(row.cost_observed_at),
        expires_at: requireTimestamp(row.cost_expires_at),
        cap_enforcement: costEnforcement
      },
      state,
      receipt,
      result_message_id: resultMessageId,
      failure_code: validateFailureCode(row.failure_code),
      dispatch_deadline: requireTimestamp(row.dispatch_deadline),
      next_poll_at: validateNullableTimestamp(row.next_poll_at),
      created_at: requireTimestamp(row.created_at),
      updated_at: requireTimestamp(row.updated_at),
      revision: requireRevision(row.revision)
    };
    assertOperationSnapshotInvariants(record);
    return record;
  } catch (error) {
    if (
      error instanceof GenerationTransactionStoreError &&
      error.code === "CORRUPT_RECORD"
    ) {
      throw error;
    }
    throw corruptRecordError();
  }
}

function eventRowToRecord(row: EventRow): GenerationOperationEventRecord {
  try {
    return {
      sequence: requirePositiveSequence(row.sequence),
      generation_operation_id: requireSafeId(row.generation_operation_id),
      operation_revision: requireRevision(row.operation_revision),
      event_type: requireEventType(row.event_type),
      from_state: row.from_state === null ? null : requireState(row.from_state),
      to_state: requireState(row.to_state),
      reason_code: validateReasonCode(row.reason_code),
      recorded_at: requireTimestamp(row.recorded_at)
    };
  } catch (error) {
    if (
      error instanceof GenerationTransactionStoreError &&
      error.code === "CORRUPT_RECORD"
    ) {
      throw error;
    }
    throw corruptRecordError();
  }
}

function validateEventForInsert(
  event: Omit<GenerationOperationEventRecord, "sequence">
): Omit<GenerationOperationEventRecord, "sequence"> {
  return {
    generation_operation_id: requireSafeId(event.generation_operation_id),
    operation_revision: requireRevision(event.operation_revision),
    event_type: requireEventType(event.event_type),
    from_state:
      event.from_state === null ? null : requireState(event.from_state),
    to_state: requireState(event.to_state),
    reason_code: validateReasonCode(event.reason_code),
    recorded_at: requireTimestamp(event.recorded_at)
  };
}

function assertOperationSnapshotInvariants(snapshot: {
  state: GenerationOperationState;
  receipt: ProviderGenerationReceipt | null;
  failure_code: string | null;
}): void {
  const receipt = snapshot.receipt;
  const hasReceipt = receipt !== null;
  const hasProviderCorrelation =
    receipt !== null &&
    (receipt.provider_job_id !== null ||
      receipt.message_id !== null ||
      receipt.message_object_id !== null);

  switch (snapshot.state) {
    case "PREPARED":
    case "CHAT_CREATING":
      if (hasReceipt || snapshot.failure_code !== null) {
        throw invalidRecordError();
      }
      return;
    case "CHAT_CREATE_OUTCOME_UNKNOWN":
    case "CHAT_RECONCILING":
      if (hasReceipt) {
        throw invalidRecordError();
      }
      return;
    case "CHAT_READY":
    case "GENERATION_DISPATCHING":
      if (!hasReceipt || hasProviderCorrelation || snapshot.failure_code !== null) {
        throw invalidRecordError();
      }
      return;
    case "GENERATION_OUTCOME_UNKNOWN":
    case "GENERATION_RECONCILING":
      if (!hasReceipt || hasProviderCorrelation) {
        throw invalidRecordError();
      }
      return;
    case "PROVIDER_ACCEPTED":
    case "QUEUED":
    case "RUNNING":
    case "SUCCEEDED":
    case "CANCELED":
      if (!hasProviderCorrelation || snapshot.failure_code !== null) {
        throw invalidRecordError();
      }
      return;
    case "FAILED":
      if (!hasProviderCorrelation || snapshot.failure_code === null) {
        throw invalidRecordError();
      }
      return;
    case "REJECTED_NO_COMMIT":
      if (hasProviderCorrelation || snapshot.failure_code === null) {
        throw invalidRecordError();
      }
      return;
    case "TERMINAL_UNRESOLVED":
      if (snapshot.failure_code === null) {
        throw invalidRecordError();
      }
      return;
  }
}

function hasSameImmutableBinding(
  left: GenerationOperationRecord,
  right: GenerationOperationRecord
): boolean {
  return (
    left.principal.tenant_id === right.principal.tenant_id &&
    left.principal.subject_id === right.principal.subject_id &&
    left.principal.connection_id === right.principal.connection_id &&
    left.idempotency_key === right.idempotency_key &&
    left.request_hash === right.request_hash &&
    left.model_id === right.model_id &&
    left.operation_id === right.operation_id &&
    left.modality === right.modality &&
    left.catalog_version === right.catalog_version &&
    left.schema_hash === right.schema_hash &&
    JSON.stringify(left.parameter_keys) === JSON.stringify(right.parameter_keys) &&
    left.estimate_id === right.estimate_id &&
    left.approved_max_cost === right.approved_max_cost &&
    left.cost.effective_cost === right.cost.effective_cost &&
    left.cost.unit === right.cost.unit &&
    left.cost.observed_at === right.cost.observed_at &&
    left.cost.expires_at === right.cost.expires_at &&
    left.cost.cap_enforcement === right.cost.cap_enforcement &&
    left.dispatch_deadline === right.dispatch_deadline
  );
}

function mergeReceipt(
  current: ProviderGenerationReceipt | null,
  candidate: ProviderGenerationReceipt | null | undefined
): ProviderGenerationReceipt | null {
  if (candidate === undefined) {
    return current ? { ...current } : null;
  }
  if (candidate === null) {
    if (current !== null) {
      throw invalidRecordError();
    }
    return null;
  }

  const next: ProviderGenerationReceipt = {
    chat_uuid: requireSafeId(candidate.chat_uuid),
    provider_job_id: validateNullableSafeId(candidate.provider_job_id),
    message_id: validateNullableSafeId(candidate.message_id),
    message_object_id: validateNullableSafeId(candidate.message_object_id)
  };
  if (!current) {
    return next;
  }
  if (
    current.chat_uuid !== next.chat_uuid ||
    changedKnownValue(current.provider_job_id, next.provider_job_id) ||
    changedKnownValue(current.message_id, next.message_id) ||
    changedKnownValue(current.message_object_id, next.message_object_id)
  ) {
    throw invalidRecordError();
  }
  return next;
}

function changedKnownValue(
  current: string | null,
  next: string | null
): boolean {
  return current !== null && current !== next;
}

function cloneRecord(record: GenerationOperationRecord): GenerationOperationRecord {
  return {
    ...record,
    principal: { ...record.principal },
    parameter_keys: [...record.parameter_keys],
    cost: { ...record.cost },
    receipt: record.receipt ? { ...record.receipt } : null
  };
}

function validateOwner(
  owner: GenerationOperationOwnerRef
): GenerationOperationOwnerRef {
  if (!owner || typeof owner !== "object") {
    throw invalidRecordError();
  }
  return {
    tenant_id: requireTenantId(owner.tenant_id),
    subject_id: requireSubjectId(owner.subject_id)
  };
}

function validateParameterKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw invalidRecordError();
  }
  const keys = value.map((entry) => {
    if (typeof entry !== "string" || !SAFE_PARAMETER_KEY_PATTERN.test(entry)) {
      throw invalidRecordError();
    }
    return entry;
  });
  const normalized = [...new Set(keys)].sort((left, right) =>
    left.localeCompare(right)
  );
  if (normalized.length !== keys.length) {
    throw invalidRecordError();
  }
  return normalized;
}

function requireSafeId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw invalidRecordError();
  }
  return value;
}

function requireTenantId(value: unknown): string {
  return requireIdentityText(value, 256);
}

function requireSubjectId(value: unknown): string {
  return requireIdentityText(value, 512);
}

function requireIdentityText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw invalidRecordError();
  }
  return value;
}

function validateNullableSafeId(value: unknown): string | null {
  return value === null ? null : requireSafeId(value);
}

function requireHash(value: unknown): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw invalidRecordError();
  }
  return value;
}

function requireDecimal(value: unknown): string {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw invalidRecordError();
  }
  return value;
}

function requireApprovedMaxCost(value: unknown, enforcement: CostCapEnforcement): string {
  if (value === OWNER_UNCAPPED_APPROVED_MAX_COST) {
    if (enforcement !== "UNENFORCEABLE") throw invalidRecordError();
    return OWNER_UNCAPPED_APPROVED_MAX_COST;
  }
  return requireDecimal(value);
}

function validateNullableDecimal(value: unknown): string | null {
  return value === null ? null : requireDecimal(value);
}

function requireTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 35 ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw invalidRecordError();
  }
  return value;
}

function validateNullableTimestamp(value: unknown): string | null {
  return value === null ? null : requireTimestamp(value);
}

function validateFailureCode(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !SAFE_FAILURE_CODE_PATTERN.test(value)) {
    throw invalidRecordError();
  }
  return value;
}

function validateReasonCode(value: unknown): string | null {
  return validateFailureCode(value);
}

function requireEventType(value: unknown): GenerationOperationEventType {
  if (
    typeof value !== "string" ||
    !(GENERATION_OPERATION_EVENT_TYPES as readonly string[]).includes(value)
  ) {
    throw corruptRecordError();
  }
  return value as GenerationOperationEventType;
}

function requireEventCursor(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidRecordError();
  }
  return value as number;
}

function requireEventLimit(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 1_000
  ) {
    throw invalidRecordError();
  }
  return value as number;
}

function requirePositiveSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw corruptRecordError();
  }
  return value as number;
}

function requireRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidRecordError();
  }
  return value as number;
}

function requireState(value: string): GenerationOperationState {
  if (!(GENERATION_OPERATION_STATES as readonly string[]).includes(value)) {
    throw corruptRecordError();
  }
  return value as GenerationOperationState;
}

function requireCostCapEnforcement(value: string): CostCapEnforcement {
  if (!(COST_CAP_ENFORCEMENTS as readonly string[]).includes(value)) {
    throw corruptRecordError();
  }
  return value as CostCapEnforcement;
}

function requireModality(
  value: string
): GenerationOperationRecord["modality"] {
  if (!("text image video audio".split(" ") as string[]).includes(value)) {
    throw corruptRecordError();
  }
  return value as GenerationOperationRecord["modality"];
}

function requireAbsentReceiptColumns(row: OperationRow): null {
  if (
    row.receipt_provider_job_id !== null ||
    row.receipt_message_id !== null ||
    row.receipt_message_object_id !== null
  ) {
    throw corruptRecordError();
  }
  return null;
}

function readNumericPragma(database: DatabaseSync, name: string): number {
  // `name` comes only from static literals inside this module.
  const row = database.prepare(`PRAGMA ${name}`).get() as
    | Record<string, unknown>
    | undefined;
  const value = row ? Object.values(row)[0] : undefined;
  return typeof value === "number" ? value : Number.NaN;
}

function readTextPragma(database: DatabaseSync, name: string): string | null {
  // `name` comes only from static literals inside this module.
  const row = database.prepare(`PRAGMA ${name}`).get() as
    | Record<string, unknown>
    | undefined;
  const value = row ? Object.values(row)[0] : undefined;
  return typeof value === "string" ? value.toLowerCase() : null;
}

function rollbackQuietly(database: DatabaseSync): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Preserve the original error. A failed rollback leaves this connection
    // unusable, but does not justify hiding the triggering failure.
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function invalidRecordError(): GenerationTransactionStoreError {
  return new GenerationTransactionStoreError(
    "INVALID_RECORD",
    "The generation operation record is invalid."
  );
}

function corruptRecordError(): GenerationTransactionStoreError {
  return new GenerationTransactionStoreError(
    "CORRUPT_RECORD",
    "The durable generation operation record is invalid."
  );
}

function unsafePathError(): GenerationTransactionStoreError {
  return new GenerationTransactionStoreError(
    "UNSAFE_STORAGE_PATH",
    "The SQLite generation store path is not private and safe."
  );
}
