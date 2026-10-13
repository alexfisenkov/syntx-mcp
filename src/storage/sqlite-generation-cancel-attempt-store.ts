import type { DatabaseSync } from "node:sqlite";
import {
  GENERATION_CANCEL_ATTEMPT_STATES,
  type GenerationCancelAttemptEventRecord,
  type GenerationCancelAttemptRecord,
  type GenerationCancelAttemptState,
} from "../domain/generation-cancel-attempt.js";
import {
  isTerminalGenerationState,
  type GenerationOperationRecord,
} from "../domain/generation-operation.js";
import type {
  GenerationCancelAttemptClaimInput,
  GenerationCancelAttemptClaimResult,
  GenerationCancelAttemptRecoveryResult,
  GenerationCancelAttemptSettlementInput,
} from "./generation-cancel-attempt-store.js";
import {
  GenerationTransactionStoreError,
  type GenerationOperationEventListOptions,
  type GenerationOperationOwnerRef,
  type GenerationTransactionStoreErrorCode,
} from "./generation-transaction-store.js";

interface CancelRow {
  generation_operation_id: string;
  tenant_id: string;
  subject_id: string;
  idempotency_key: string;
  confirmation_hash: string;
  state: string;
  created_at: string;
  updated_at: string;
  revision: number;
}

const COLUMNS = `generation_operation_id, tenant_id, subject_id,
  idempotency_key, confirmation_hash, state, created_at, updated_at, revision`;

/**
 * Internal helper sharing the parent store's connection. It never starts a
 * transaction, closes the connection, recovers on construction, or touches
 * generation state. Its owner wraps every mutation in BEGIN IMMEDIATE.
 */
export class SqliteGenerationCancelAttemptLedger {
  constructor(
    readonly database: DatabaseSync,
    readonly getGeneration: (
      owner: GenerationOperationOwnerRef,
      id: string,
    ) => GenerationOperationRecord | null,
  ) {}

  claim(
    input: GenerationCancelAttemptClaimInput,
  ): GenerationCancelAttemptClaimResult {
    if (!input || typeof input !== "object") fail("INVALID_RECORD");
    const owner = validateOwner(input.owner);
    const id = safeId(input.generation_operation_id);
    const key = safeId(input.idempotency_key);
    const confirmationHash = hash(input.confirmation_hash);
    const createdAt = timestamp(input.created_at);
    const existing = this.getByKey(owner, key);
    if (existing) {
      if (existing.generation_operation_id !== id) fail("IDEMPOTENCY_CONFLICT");
      // A replay is the original intent, not a new use of fresh confirmation.
      return { outcome: "replayed", record: existing };
    }
    const generation = this.getGeneration(owner, id);
    if (!generation) fail("OPERATION_NOT_FOUND");
    if (this.get(owner, id)) fail("CANCEL_ALREADY_ATTEMPTED");
    const priorConfirmation = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM generation_cancel_attempts
        WHERE tenant_id = ? AND subject_id = ? AND confirmation_hash = ?`,
      )
      .get(owner.tenant_id, owner.subject_id, confirmationHash);
    if (priorConfirmation) {
      rowToRecord(priorConfirmation as unknown as CancelRow);
      fail("CANCEL_CONFIRMATION_CONFLICT");
    }
    if (isTerminalGenerationState(generation.state)) {
      return { outcome: "terminal", record: null };
    }
    if (
      !["PROVIDER_ACCEPTED", "QUEUED", "RUNNING"].includes(generation.state) ||
      generation.receipt?.message_id == null
    )
      fail("CANCEL_NOT_ALLOWED");
    if (Date.parse(createdAt) < Date.parse(generation.updated_at)) {
      fail("INVALID_RECORD");
    }
    this.database
      .prepare(
        `INSERT INTO generation_cancel_attempts (
         ${COLUMNS}
       ) VALUES (?, ?, ?, ?, ?, 'DISPATCHING', ?, ?, 0)`,
      )
      .run(
        id,
        owner.tenant_id,
        owner.subject_id,
        key,
        confirmationHash,
        createdAt,
        createdAt,
      );
    const record = this.get(owner, id);
    if (!record) fail("CORRUPT_RECORD");
    return { outcome: "claimed", record };
  }

  get(
    ownerInput: GenerationOperationOwnerRef,
    idInput: string,
  ): GenerationCancelAttemptRecord | null {
    const owner = validateOwner(ownerInput);
    const id = safeId(idInput);
    const row = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM generation_cancel_attempts
        WHERE tenant_id = ? AND subject_id = ? AND generation_operation_id = ?`,
      )
      .get(owner.tenant_id, owner.subject_id, id);
    return row
      ? this.validateParent(rowToRecord(row as unknown as CancelRow))
      : null;
  }

  getByKey(
    ownerInput: GenerationOperationOwnerRef,
    keyInput: string,
  ): GenerationCancelAttemptRecord | null {
    const owner = validateOwner(ownerInput);
    const key = safeId(keyInput);
    const row = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM generation_cancel_attempts
        WHERE tenant_id = ? AND subject_id = ? AND idempotency_key = ?`,
      )
      .get(owner.tenant_id, owner.subject_id, key);
    return row
      ? this.validateParent(rowToRecord(row as unknown as CancelRow))
      : null;
  }

  listEvents(
    owner: GenerationOperationOwnerRef,
    id: string,
    options: GenerationOperationEventListOptions = {},
  ): GenerationCancelAttemptEventRecord[] {
    const after = integer(options.after_sequence ?? 0, 0);
    const limit = integer(options.limit ?? 100, 1, 1_000);
    if (!this.get(owner, id)) return [];
    const rows = this.database
      .prepare(
        `SELECT sequence, generation_operation_id, attempt_revision,
              event_type, from_state, to_state, recorded_at
         FROM generation_cancel_attempt_events
        WHERE generation_operation_id = ? AND sequence > ?
        ORDER BY sequence LIMIT ?`,
      )
      .all(id, after, limit);
    return rows.map((row) => eventToRecord(row));
  }

  settle(
    input: GenerationCancelAttemptSettlementInput,
  ): GenerationCancelAttemptRecord {
    if (!input || typeof input !== "object") fail("INVALID_RECORD");
    const owner = validateOwner(input.owner);
    const id = safeId(input.generation_operation_id);
    const updatedAt = timestamp(input.updated_at);
    if (
      input.to_state !== "ACKNOWLEDGED" &&
      input.to_state !== "OUTCOME_UNKNOWN"
    ) {
      fail("INVALID_RECORD");
    }
    const current = this.get(owner, id);
    if (!current) fail("CANCEL_ATTEMPT_NOT_FOUND");
    // Idempotent settlement and late competing uncertainty never erase an ACK.
    if (current.state === input.to_state || current.state === "ACKNOWLEDGED")
      return current;
    if (Date.parse(updatedAt) < Date.parse(current.updated_at))
      fail("INVALID_RECORD");
    const result = this.database
      .prepare(
        `UPDATE generation_cancel_attempts
          SET state = ?, updated_at = ?, revision = revision + 1
        WHERE generation_operation_id = ? AND tenant_id = ? AND subject_id = ?
          AND revision = ? AND state = ?`,
      )
      .run(
        input.to_state,
        updatedAt,
        id,
        owner.tenant_id,
        owner.subject_id,
        current.revision,
        current.state,
      );
    if (Number(result.changes) !== 1) fail("REVISION_CONFLICT");
    const updated = this.get(owner, id);
    if (!updated) fail("CORRUPT_RECORD");
    return updated;
  }

  recover(recoveredAt: string): GenerationCancelAttemptRecoveryResult {
    const updatedAt = timestamp(recoveredAt);
    const rows = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM generation_cancel_attempts
        WHERE state = 'DISPATCHING' ORDER BY created_at, generation_operation_id`,
      )
      .all();
    const records = rows.map((row) => {
      const current = this.validateParent(
        rowToRecord(row as unknown as CancelRow),
      );
      return this.settle({
        owner: current.owner,
        generation_operation_id: current.generation_operation_id,
        to_state: "OUTCOME_UNKNOWN",
        updated_at: updatedAt,
      });
    });
    return { recovered_count: records.length, records };
  }

  private validateParent(
    record: GenerationCancelAttemptRecord,
  ): GenerationCancelAttemptRecord {
    const generation = this.getGeneration(
      record.owner,
      record.generation_operation_id,
    );
    if (
      !generation ||
      generation.receipt?.message_id == null ||
      ![
        "PROVIDER_ACCEPTED",
        "QUEUED",
        "RUNNING",
        "SUCCEEDED",
        "FAILED",
        "CANCELED",
      ].includes(generation.state) ||
      Date.parse(record.created_at) < Date.parse(generation.created_at)
    )
      fail("CORRUPT_RECORD");
    return record;
  }
}

function rowToRecord(row: CancelRow): GenerationCancelAttemptRecord {
  try {
    const record: GenerationCancelAttemptRecord = {
      generation_operation_id: safeId(row.generation_operation_id),
      owner: validateOwner({
        tenant_id: row.tenant_id,
        subject_id: row.subject_id,
      }),
      idempotency_key: safeId(row.idempotency_key),
      confirmation_hash: hash(row.confirmation_hash),
      state: state(row.state),
      created_at: timestamp(row.created_at),
      updated_at: timestamp(row.updated_at),
      revision: integer(row.revision, 0, 2),
    };
    if (
      Date.parse(record.updated_at) < Date.parse(record.created_at) ||
      (record.state === "DISPATCHING" &&
        (record.revision !== 0 || record.updated_at !== record.created_at)) ||
      (record.state === "OUTCOME_UNKNOWN" && record.revision !== 1) ||
      (record.state === "ACKNOWLEDGED" && record.revision < 1)
    )
      fail("CORRUPT_RECORD");
    return record;
  } catch {
    return fail("CORRUPT_RECORD");
  }
}

function eventToRecord(
  row: Record<string, unknown>,
): GenerationCancelAttemptEventRecord {
  try {
    const revision = integer(row.attempt_revision, 0, 2);
    const from = row.from_state === null ? null : state(row.from_state);
    const to = state(row.to_state);
    if (
      !(
        row.event_type === "CLAIMED" &&
        revision === 0 &&
        from === null &&
        to === "DISPATCHING"
      ) &&
      !(
        row.event_type === "SETTLED" &&
        ((revision === 1 &&
          from === "DISPATCHING" &&
          (to === "ACKNOWLEDGED" || to === "OUTCOME_UNKNOWN")) ||
          (revision === 2 &&
            from === "OUTCOME_UNKNOWN" &&
            to === "ACKNOWLEDGED"))
      )
    )
      fail("CORRUPT_RECORD");
    return {
      sequence: integer(row.sequence, 1),
      generation_operation_id: safeId(row.generation_operation_id),
      attempt_revision: revision,
      event_type: row.event_type as "CLAIMED" | "SETTLED",
      from_state: from,
      to_state: to,
      recorded_at: timestamp(row.recorded_at),
    };
  } catch {
    return fail("CORRUPT_RECORD");
  }
}

function validateOwner(
  owner: GenerationOperationOwnerRef,
): GenerationOperationOwnerRef {
  if (!owner || typeof owner !== "object") fail("INVALID_RECORD");
  const identity = (value: unknown, maximum: number): string => {
    if (
      typeof value !== "string" ||
      value.length < 1 ||
      value.length > maximum ||
      /[\u0000-\u001f\u007f]/u.test(value)
    )
      fail("INVALID_RECORD");
    return value;
  };
  return {
    tenant_id: identity(owner.tenant_id, 256),
    subject_id: identity(owner.subject_id, 512),
  };
}

function safeId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value)
  )
    fail("INVALID_RECORD");
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value))
    fail("INVALID_RECORD");
  return value;
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 35 ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail("INVALID_RECORD");
  return value;
}

function state(value: unknown): GenerationCancelAttemptState {
  if (
    typeof value !== "string" ||
    !(GENERATION_CANCEL_ATTEMPT_STATES as readonly string[]).includes(value)
  )
    fail("INVALID_RECORD");
  return value as GenerationCancelAttemptState;
}

function integer(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  )
    fail("INVALID_RECORD");
  return value as number;
}

function fail(code: GenerationTransactionStoreErrorCode): never {
  throw new GenerationTransactionStoreError(
    code,
    "The durable cancellation attempt could not be processed.",
  );
}

export const SCHEMA_VERSION_FOUR_MIGRATION_SQL = `
  CREATE UNIQUE INDEX generation_operations_cancel_owner
    ON generation_operations(id, tenant_id, subject_id);
  CREATE TABLE generation_cancel_attempts (
    generation_operation_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    confirmation_hash TEXT NOT NULL CHECK (
      length(confirmation_hash) = 71 AND substr(confirmation_hash, 1, 7) = 'sha256:'
      AND substr(confirmation_hash, 8) NOT GLOB '*[^a-f0-9]*'
    ),
    state TEXT NOT NULL CHECK (state IN ('DISPATCHING', 'ACKNOWLEDGED', 'OUTCOME_UNKNOWN')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL AND julianday(updated_at) >= julianday(created_at)),
    revision INTEGER NOT NULL CHECK (
      (state = 'DISPATCHING' AND revision = 0 AND created_at = updated_at)
      OR (state = 'OUTCOME_UNKNOWN' AND revision = 1)
      OR (state = 'ACKNOWLEDGED' AND revision IN (1, 2))
    ),
    UNIQUE(tenant_id, subject_id, idempotency_key),
    UNIQUE(tenant_id, subject_id, confirmation_hash),
    FOREIGN KEY(generation_operation_id, tenant_id, subject_id)
      REFERENCES generation_operations(id, tenant_id, subject_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  ) STRICT;
  CREATE TABLE generation_cancel_attempt_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_operation_id TEXT NOT NULL REFERENCES generation_cancel_attempts(generation_operation_id) ON DELETE RESTRICT,
    attempt_revision INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE(generation_operation_id, attempt_revision),
    CHECK (
      (event_type = 'CLAIMED' AND attempt_revision = 0 AND from_state IS NULL AND to_state = 'DISPATCHING')
      OR (event_type = 'SETTLED' AND from_state IS NOT NULL AND (
        (attempt_revision = 1 AND from_state = 'DISPATCHING' AND to_state IN ('ACKNOWLEDGED', 'OUTCOME_UNKNOWN'))
        OR (attempt_revision = 2 AND from_state = 'OUTCOME_UNKNOWN' AND to_state = 'ACKNOWLEDGED')
      ))
    )
  ) STRICT;
  CREATE TRIGGER generation_cancel_attempt_insert_guard BEFORE INSERT ON generation_cancel_attempts
  WHEN NEW.state <> 'DISPATCHING' OR NEW.revision <> 0 OR NOT EXISTS (
    SELECT 1 FROM generation_operations AS o
      WHERE o.id = NEW.generation_operation_id AND o.tenant_id = NEW.tenant_id AND o.subject_id = NEW.subject_id
        AND o.state IN ('PROVIDER_ACCEPTED', 'QUEUED', 'RUNNING')
        AND o.receipt_message_id IS NOT NULL
        AND julianday(NEW.created_at) >= julianday(o.updated_at)
  ) BEGIN SELECT RAISE(ABORT, 'invalid cancellation claim'); END;
  CREATE TRIGGER generation_cancel_attempt_update_guard BEFORE UPDATE ON generation_cancel_attempts
  WHEN NEW.generation_operation_id IS NOT OLD.generation_operation_id
    OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.subject_id IS NOT OLD.subject_id
    OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.confirmation_hash IS NOT OLD.confirmation_hash
    OR NEW.created_at IS NOT OLD.created_at OR NEW.revision <> OLD.revision + 1
    OR julianday(NEW.updated_at) < julianday(OLD.updated_at)
    OR NOT (
      (OLD.state = 'DISPATCHING' AND NEW.state IN ('ACKNOWLEDGED', 'OUTCOME_UNKNOWN'))
      OR (OLD.state = 'OUTCOME_UNKNOWN' AND NEW.state = 'ACKNOWLEDGED')
    )
  BEGIN SELECT RAISE(ABORT, 'invalid cancellation transition'); END;
  CREATE TRIGGER generation_cancel_attempt_delete_guard BEFORE DELETE ON generation_cancel_attempts
  BEGIN SELECT RAISE(ABORT, 'cancellation attempts are append preserving'); END;
  CREATE TRIGGER generation_cancel_attempt_event_insert_guard BEFORE INSERT ON generation_cancel_attempt_events
  WHEN NOT EXISTS (
    SELECT 1 FROM generation_cancel_attempts AS a
     WHERE a.generation_operation_id = NEW.generation_operation_id
       AND a.revision = NEW.attempt_revision AND a.state = NEW.to_state AND a.updated_at = NEW.recorded_at
  ) BEGIN SELECT RAISE(ABORT, 'invalid cancellation event'); END;
  CREATE TRIGGER generation_cancel_attempt_event_update_guard BEFORE UPDATE ON generation_cancel_attempt_events
  BEGIN SELECT RAISE(ABORT, 'cancellation events are append only'); END;
  CREATE TRIGGER generation_cancel_attempt_event_delete_guard BEFORE DELETE ON generation_cancel_attempt_events
  BEGIN SELECT RAISE(ABORT, 'cancellation events are append only'); END;
  CREATE TRIGGER generation_cancel_attempt_insert_event AFTER INSERT ON generation_cancel_attempts
  BEGIN
    INSERT INTO generation_cancel_attempt_events(generation_operation_id, attempt_revision, event_type, from_state, to_state, recorded_at)
      VALUES(NEW.generation_operation_id, NEW.revision, 'CLAIMED', NULL, NEW.state, NEW.updated_at);
  END;
  CREATE TRIGGER generation_cancel_attempt_update_event AFTER UPDATE ON generation_cancel_attempts
  BEGIN
    INSERT INTO generation_cancel_attempt_events(generation_operation_id, attempt_revision, event_type, from_state, to_state, recorded_at)
      VALUES(NEW.generation_operation_id, NEW.revision, 'SETTLED', OLD.state, NEW.state, NEW.updated_at);
  END;
`;
