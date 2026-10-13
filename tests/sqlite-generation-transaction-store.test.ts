import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  GenerationStateTransitionError,
  type GenerationOperationRecord
} from "../src/domain/generation-operation.js";
import {
  GenerationTransactionStoreError,
  type GenerationOperationOwnerRef
} from "../src/storage/generation-transaction-store.js";
import { SqliteGenerationTransactionStore } from "../src/storage/sqlite-generation-transaction-store.js";

const CREATED_AT = "2026-09-02T09:00:00.000Z";
const LATER = "2026-09-02T09:01:00.000Z";
const RECOVERED_AT = "2026-09-02T09:02:00.000Z";
const OWNER: GenerationOperationOwnerRef = {
  tenant_id: "tenant_test_001",
  subject_id: "subject_test_001"
};

test("file-backed records survive close and reopen with private modes", () => {
  withDatabasePath((databasePath, root) => {
    const store = new SqliteGenerationTransactionStore(databasePath);
    const created = store.createOrReplay(makeRecord());
    assert.equal(created.outcome, "created");
    store.close();

    assert.equal(statSync(join(root, "private")).mode & 0o777, 0o700);
    assert.equal(statSync(databasePath).mode & 0o777, 0o600);

    const reopened = new SqliteGenerationTransactionStore(databasePath);
    assert.deepEqual(reopened.getById(OWNER, "generation_test_001"), created.record);
    assert.deepEqual(
      reopened.listEvents(OWNER, "generation_test_001").map((event) => ({
        event_type: event.event_type,
        operation_revision: event.operation_revision,
        to_state: event.to_state
      })),
      [{ event_type: "CREATED", operation_revision: 0, to_state: "PREPARED" }]
    );
    reopened.close();

    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    const migration = inspection
      .prepare("SELECT MAX(version) AS version FROM generation_store_migrations")
      .get() as { version: number };
    assert.equal(migration.version, 5);
    inspection.close();
  });
});

test("owner uncapped sentinel survives validation, SQLite restart, and event readback", () => {
  withDatabasePath((databasePath) => {
    const record = makeRecord({
      approved_max_cost: "OWNER_UNCAPPED",
      cost: {
        effective_cost: null,
        unit: null,
        observed_at: CREATED_AT,
        expires_at: CREATED_AT,
        cap_enforcement: "UNENFORCEABLE"
      }
    });
    const store = new SqliteGenerationTransactionStore(databasePath);
    const created = store.createOrReplay(record);
    assert.equal(created.record.approved_max_cost, "OWNER_UNCAPPED");
    assert.equal(created.record.cost.cap_enforcement, "UNENFORCEABLE");
    assert.equal(created.record.cost.effective_cost, null);
    assert.throws(() => store.createOrReplay(makeRecord({
      id: "generation_uncapped_wrong_enforcement_002",
      idempotency_key: "idempotency_uncapped_wrong_enforcement_002",
      approved_max_cost: "OWNER_UNCAPPED",
      cost: {
        effective_cost: null,
        unit: null,
        observed_at: CREATED_AT,
        expires_at: CREATED_AT,
        cap_enforcement: "UPSTREAM_QUOTE_BOUND"
      }
    })), (error: unknown) => error instanceof GenerationTransactionStoreError && error.code === "INVALID_RECORD");
    store.close();

    const reopened = new SqliteGenerationTransactionStore(databasePath);
    const restored = reopened.getById(OWNER, record.id);
    assert.equal(restored?.approved_max_cost, "OWNER_UNCAPPED");
    assert.equal(restored?.cost.cap_enforcement, "UNENFORCEABLE");
    const events = reopened.listEvents(OWNER, record.id);
    assert.deepEqual(events.map((event) => event.to_state), ["PREPARED"]);
    assert.equal(JSON.stringify(events).includes("OWNER_UNCAPPED"), false, "event log keeps cap semantics out of event payloads");
    reopened.close();

    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    const version = inspection.prepare("SELECT MAX(version) AS version FROM generation_store_migrations").get() as { version: number };
    assert.equal(version.version, 5, "the TEXT sentinel remains compatible with the additive result binding migration");
    inspection.close();
  });
});

test("result message binding is one-time, owner-scoped, audited, and survives restart", () => {
  withDatabasePath((databasePath) => {
    const store = new SqliteGenerationTransactionStore(databasePath);
    const created = store.createOrReplay(makeRecord()).record;
    advance(store, created.id, ["CHAT_CREATING", "CHAT_READY", "GENERATION_DISPATCHING"]);
    const accepted = store.transition({
      owner: OWNER, id: created.id, expected_revision: 3,
      to_state: "PROVIDER_ACCEPTED", updated_at: LATER,
      receipt: { chat_uuid: `chat_${created.id}`, provider_job_id: null,
        message_id: "message_test_001", message_object_id: null }
    });
    advance(store, created.id, ["QUEUED", "RUNNING"], accepted.revision);
    const running = store.getById(OWNER, created.id)!;
    const bound = store.bindResultMessage({
      owner: OWNER,
      id: created.id,
      expected_revision: running.revision,
      result_message_id: "message_bot_result_001",
      updated_at: RECOVERED_AT
    });
    assert.ok(bound);
    assert.equal(bound.receipt?.message_id, "message_test_001", "the original POST echo receipt remains immutable");
    assert.equal(bound.result_message_id, "message_bot_result_001");
    assert.equal(bound.revision, running.revision + 1);
    assert.equal(store.listEvents(OWNER, created.id).at(-1)?.reason_code, "DEDICATED_CHAT_UNIQUE_RESULT");
    assert.throws(() => store.bindResultMessage({
      owner: OWNER, id: created.id, expected_revision: bound.revision,
      result_message_id: "message_bot_result_002", updated_at: RECOVERED_AT
    }));
    assert.equal(store.bindResultMessage({
      owner: { tenant_id: "other", subject_id: "other" }, id: created.id,
      expected_revision: bound.revision, result_message_id: "message_bot_result_001",
      updated_at: RECOVERED_AT
    }), null);
    store.close();

    const reopened = new SqliteGenerationTransactionStore(databasePath);
    const recovered = reopened.getById(OWNER, created.id)!;
    assert.equal(recovered.receipt?.message_id, "message_test_001");
    assert.equal(recovered.result_message_id, "message_bot_result_001");
    assert.equal(reopened.listEvents(OWNER, created.id).at(-1)?.reason_code, "DEDICATED_CHAT_UNIQUE_RESULT");
    reopened.close();
  });
});

test("two stores converge on one idempotency record and reject a changed binding", () => {
  withDatabasePath((databasePath) => {
    const firstStore = new SqliteGenerationTransactionStore(databasePath);
    const secondStore = new SqliteGenerationTransactionStore(databasePath);
    const first = firstStore.createOrReplay(makeRecord());
    const replay = secondStore.createOrReplay(
      makeRecord({ id: "generation_retry_002" })
    );

    assert.equal(first.outcome, "created");
    assert.equal(replay.outcome, "replayed");
    assert.equal(replay.record.id, first.record.id);
    assert.equal(
      secondStore.getByIdempotencyKey(OWNER, "idempotency_test_001")?.id,
      first.record.id
    );
    assert.equal(secondStore.listEvents(OWNER, first.record.id).length, 1);

    const changedBindings: Partial<GenerationOperationRecord>[] = [
      { request_hash: hashOf("b") },
      {
        principal: {
          ...makeRecord().principal,
          connection_id: "connection_changed_003"
        }
      },
      { model_id: "banana3" },
      { schema_hash: hashOf("e") },
      { approved_max_cost: "13" },
      {
        cost: {
          ...makeRecord().cost,
          effective_cost: "11"
        }
      }
    ];
    for (const [index, changed] of changedBindings.entries()) {
      assert.throws(
        () =>
          secondStore.createOrReplay(
            makeRecord({
              ...changed,
              id: `generation_conflict_${index + 3}`
            })
          ),
        (error: unknown) =>
          error instanceof GenerationTransactionStoreError &&
          error.code === "IDEMPOTENCY_CONFLICT"
      );
    }

    firstStore.close();
    secondStore.close();
  });
});

test("owner reads are isolated and operation ids cannot alias another owner", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  store.createOrReplay(makeRecord());

  const opaqueOwner = {
    tenant_id: "tenant:workshop@example.com",
    subject_id: "auth0|user@example.com"
  };
  const opaqueIdentityRecord = makeRecord({
    id: "generation_opaque_owner_002",
    principal: {
      ...opaqueOwner,
      connection_id: "connection_opaque_002"
    },
    idempotency_key: "idempotency_opaque_002"
  });
  store.createOrReplay(opaqueIdentityRecord);
  assert.equal(
    store.getById(opaqueOwner, opaqueIdentityRecord.id)?.id,
    opaqueIdentityRecord.id
  );

  assert.equal(
    store.getById(
      { tenant_id: OWNER.tenant_id, subject_id: "subject_other_002" },
      "generation_test_001"
    ),
    null
  );
  assert.equal(
    store.getByIdempotencyKey(
      { tenant_id: OWNER.tenant_id, subject_id: "subject_other_002" },
      "idempotency_test_001"
    ),
    null
  );
  assert.deepEqual(
    store.listEvents(
      { tenant_id: "tenant_other_002", subject_id: OWNER.subject_id },
      "generation_test_001"
    ),
    []
  );
  assert.equal(
    store.getById(
      { tenant_id: "tenant_other_002", subject_id: OWNER.subject_id },
      "generation_test_001"
    ),
    null
  );
  assert.throws(
    () =>
      store.createOrReplay(
        makeRecord({
          principal: {
            tenant_id: "tenant_other_002",
            subject_id: "subject_other_002",
            connection_id: "connection_other_002"
          },
          idempotency_key: "idempotency_other_002"
        })
      ),
    (error: unknown) =>
      error instanceof GenerationTransactionStoreError &&
      error.code === "OPERATION_ID_CONFLICT"
  );
  store.close();
});

test("state changes use optimistic revisions and the domain transition graph", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  store.createOrReplay(makeRecord());

  const creating = store.transition({
    owner: OWNER,
    id: "generation_test_001",
    expected_revision: 0,
    to_state: "CHAT_CREATING",
    updated_at: LATER
  });
  assert.equal(creating.state, "CHAT_CREATING");
  assert.equal(creating.revision, 1);
  assert.equal(creating.receipt, null);

  const ready = store.transition({
    owner: OWNER,
    id: "generation_test_001",
    expected_revision: 1,
    to_state: "CHAT_READY",
    updated_at: LATER,
    receipt: {
      chat_uuid: "chat_test_001",
      provider_job_id: null,
      message_id: null,
      message_object_id: null
    }
  });
  assert.equal(ready.state, "CHAT_READY");
  assert.equal(ready.revision, 2);
  assert.equal(ready.receipt?.chat_uuid, "chat_test_001");

  assert.throws(
    () =>
      store.transition({
        owner: OWNER,
        id: "generation_test_001",
        expected_revision: 1,
        to_state: "GENERATION_DISPATCHING",
        updated_at: LATER
      }),
    (error: unknown) =>
      error instanceof GenerationTransactionStoreError &&
      error.code === "REVISION_CONFLICT"
  );

  const second = makeRecord({
    id: "generation_invalid_transition_002",
    idempotency_key: "idempotency_invalid_002"
  });
  store.createOrReplay(second);
  assert.throws(
    () =>
      store.transition({
        owner: OWNER,
        id: second.id,
        expected_revision: 0,
        to_state: "SUCCEEDED",
        updated_at: LATER
      }),
    GenerationStateTransitionError
  );

  store.close();
});

test("receipt and failure invariants reject uncorrelated or contradictory states", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  const first = makeRecord();
  store.createOrReplay(first);
  advance(store, first.id, ["CHAT_CREATING"]);

  assert.throws(
    () =>
      store.transition({
        owner: OWNER,
        id: first.id,
        expected_revision: 1,
        to_state: "CHAT_READY",
        updated_at: LATER
      }),
    hasStoreCode("INVALID_RECORD")
  );
  assert.throws(
    () =>
      store.transition({
        owner: OWNER,
        id: first.id,
        expected_revision: 1,
        to_state: "CHAT_READY",
        updated_at: LATER,
        receipt: {
          chat_uuid: "chat_test_001",
          provider_job_id: "job_too_early_001",
          message_id: null,
          message_object_id: null
        }
      }),
    hasStoreCode("INVALID_RECORD")
  );

  advance(store, first.id, ["CHAT_READY", "GENERATION_DISPATCHING"], 1);
  assert.throws(
    () =>
      store.transition({
        owner: OWNER,
        id: first.id,
        expected_revision: 3,
        to_state: "PROVIDER_ACCEPTED",
        updated_at: LATER
      }),
    hasStoreCode("INVALID_RECORD")
  );

  const rejected = makeRecord({
    id: "generation_rejected_invariant_002",
    idempotency_key: "idempotency_rejected_invariant_002"
  });
  store.createOrReplay(rejected);
  assert.throws(
    () =>
      store.transition({
        owner: OWNER,
        id: rejected.id,
        expected_revision: 0,
        to_state: "REJECTED_NO_COMMIT",
        updated_at: LATER
      }),
    hasStoreCode("INVALID_RECORD")
  );
  store.close();
});

test("concurrent revisions create exactly one monotonic append-only event", () => {
  withDatabasePath((databasePath) => {
    const first = new SqliteGenerationTransactionStore(databasePath);
    const second = new SqliteGenerationTransactionStore(databasePath);
    first.createOrReplay(makeRecord());

    first.transition({
      owner: OWNER,
      id: "generation_test_001",
      expected_revision: 0,
      to_state: "CHAT_CREATING",
      updated_at: LATER
    });
    assert.throws(
      () =>
        second.transition({
          owner: OWNER,
          id: "generation_test_001",
          expected_revision: 0,
          to_state: "CHAT_CREATING",
          updated_at: LATER
        }),
      hasStoreCode("REVISION_CONFLICT")
    );

    const events = second.listEvents(OWNER, "generation_test_001");
    assert.deepEqual(
      events.map((event) => [event.operation_revision, event.event_type]),
      [
        [0, "CREATED"],
        [1, "TRANSITIONED"]
      ]
    );
    assert.ok(events[1]!.sequence > events[0]!.sequence);
    assert.equal(events[1]!.from_state, "PREPARED");
    assert.equal(events[1]!.to_state, "CHAT_CREATING");
    assert.equal(events[1]!.reason_code, null);
    assert.deepEqual(
      second.listEvents(OWNER, "generation_test_001", {
        after_sequence: events[0]!.sequence,
        limit: 1
      }),
      [events[1]]
    );
    first.close();
    second.close();
    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    const contexts = inspection
      .prepare(
        "SELECT COUNT(*) AS count FROM generation_operation_transition_context"
      )
      .get() as { count: number };
    assert.equal(contexts.count, 0);
    inspection.close();
  });
});

test("DEBT-047: atomic recovery acceptance requires a receipt bound to the recorded chat", () => {
  withDatabasePath((databasePath) => {
    const store = new SqliteGenerationTransactionStore(databasePath);
    const record = store.createOrReplay(makeRecord()).record;
    advance(store, record.id, ["CHAT_CREATING", "CHAT_READY", "GENERATION_DISPATCHING"]);
    const recovered = store.recoverInterruptedOperations(RECOVERED_AT).records[0]!;
    const input = {
      owner: OWNER, id: record.id, expected_revision: recovered.revision,
      to_state: "PROVIDER_ACCEPTED" as const, updated_at: RECOVERED_AT
    };
    const receipt = {
      chat_uuid: `chat_${record.id}`, provider_job_id: null,
      message_id: "message_recovered_001", message_object_id: null
    };
    const before = store.listEvents(OWNER, record.id);
    assert.throws(() => store.transition(input), hasStoreCode("INVALID_RECORD"));
    assert.throws(() => store.transition({ ...input, receipt: { ...receipt, chat_uuid: "chat_wrong_002" } }),
      hasStoreCode("INVALID_RECORD"));
    assert.equal(store.getById(OWNER, record.id)?.state, "GENERATION_OUTCOME_UNKNOWN");
    assert.deepEqual(store.listEvents(OWNER, record.id), before, "rejected receipts cannot append false acceptance evidence");
    const accepted = store.transition({ ...input, receipt });
    assert.equal(accepted.revision, recovered.revision + 1, "receipt and acceptance commit in one revision");
    assert.deepEqual(accepted.receipt, receipt);
    assert.deepEqual(store.listEvents(OWNER, record.id).slice(-1).map((event) => [event.from_state, event.to_state]),
      [["GENERATION_OUTCOME_UNKNOWN", "PROVIDER_ACCEPTED"]]);
    store.close();
    const reopened = new SqliteGenerationTransactionStore(databasePath);
    assert.deepEqual(reopened.getById(OWNER, record.id), accepted);
    assert.equal(reopened.recoverInterruptedOperations(RECOVERED_AT).recovered_count, 0);
    reopened.close();
  });
});

test("crash recovery preserves the exact mutation stage and appends evidence", () => {
  withDatabasePath((databasePath) => {
    const store = new SqliteGenerationTransactionStore(databasePath);
    const chatCreating = makeRecord({
      id: "generation_recover_chat_001",
      idempotency_key: "idempotency_recover_chat_001"
    });
    const dispatching = makeRecord({
      id: "generation_recover_dispatch_002",
      idempotency_key: "idempotency_recover_dispatch_002"
    });
    const chatReconciling = makeRecord({
      id: "generation_recover_chat_reconcile_003",
      idempotency_key: "idempotency_recover_chat_reconcile_003"
    });
    const generationReconciling = makeRecord({
      id: "generation_recover_dispatch_reconcile_004",
      idempotency_key: "idempotency_recover_dispatch_reconcile_004"
    });
    const stable = makeRecord({
      id: "generation_stable_005",
      idempotency_key: "idempotency_stable_005"
    });
    for (const record of [
      chatCreating,
      dispatching,
      chatReconciling,
      generationReconciling,
      stable
    ]) {
      store.createOrReplay(record);
    }

    advance(store, chatCreating.id, ["CHAT_CREATING"]);
    advance(store, dispatching.id, [
      "CHAT_CREATING",
      "CHAT_READY",
      "GENERATION_DISPATCHING"
    ]);
    advance(store, chatReconciling.id, [
      "CHAT_CREATING",
      "CHAT_CREATE_OUTCOME_UNKNOWN",
      "CHAT_RECONCILING"
    ]);
    advance(store, generationReconciling.id, [
      "CHAT_CREATING",
      "CHAT_READY",
      "GENERATION_DISPATCHING",
      "GENERATION_OUTCOME_UNKNOWN",
      "GENERATION_RECONCILING"
    ]);
    advance(store, stable.id, ["CHAT_CREATING", "CHAT_READY"]);
    store.close();

    const reopened = new SqliteGenerationTransactionStore(databasePath);
    const recovery = reopened.recoverInterruptedOperations(RECOVERED_AT);
    assert.equal(recovery.recovered_count, 4);
    assert.deepEqual(
      recovery.records.map((record) => record.id).sort(),
      [
        chatCreating.id,
        dispatching.id,
        chatReconciling.id,
        generationReconciling.id
      ].sort()
    );
    assert.equal(
      reopened.getById(OWNER, chatCreating.id)?.state,
      "CHAT_CREATE_OUTCOME_UNKNOWN"
    );
    assert.equal(
      reopened.getById(OWNER, chatReconciling.id)?.state,
      "CHAT_CREATE_OUTCOME_UNKNOWN"
    );
    assert.equal(
      reopened.getById(OWNER, dispatching.id)?.state,
      "GENERATION_OUTCOME_UNKNOWN"
    );
    assert.equal(
      reopened.getById(OWNER, generationReconciling.id)?.state,
      "GENERATION_OUTCOME_UNKNOWN"
    );
    for (const record of recovery.records) {
      assert.equal(record.updated_at, RECOVERED_AT);
      const lastEvent = reopened.listEvents(OWNER, record.id).at(-1);
      assert.equal(lastEvent?.event_type, "CRASH_RECOVERED");
      assert.equal(lastEvent?.to_state, record.state);
      assert.equal(lastEvent?.operation_revision, record.revision);
      assert.equal(lastEvent?.reason_code, "PROCESS_RESTART");
    }
    assert.equal(reopened.getById(OWNER, stable.id)?.state, "CHAT_READY");
    assert.equal(
      reopened.recoverInterruptedOperations(RECOVERED_AT).recovered_count,
      0
    );
    reopened.close();
  });
});

test("crash recovery rejects a time regression without partial events", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  const first = makeRecord();
  const second = makeRecord({
    id: "generation_recovery_atomic_002",
    idempotency_key: "idempotency_recovery_atomic_002"
  });
  store.createOrReplay(first);
  store.createOrReplay(second);
  advance(store, first.id, ["CHAT_CREATING"]);
  advance(store, second.id, ["CHAT_CREATING"]);

  assert.throws(
    () => store.recoverInterruptedOperations(CREATED_AT),
    hasStoreCode("INVALID_RECORD")
  );
  assert.equal(store.getById(OWNER, first.id)?.state, "CHAT_CREATING");
  assert.equal(store.getById(OWNER, second.id)?.state, "CHAT_CREATING");
  assert.equal(store.listEvents(OWNER, first.id).length, 2);
  assert.equal(store.listEvents(OWNER, second.id).length, 2);
  store.close();
});

test("v1 migration preserves rows but quarantines ambiguous legacy states", () => {
  withDatabasePath((databasePath) => {
    createLegacyV1Database(databasePath, [
      makeLegacyRecord(
        "generation_legacy_unknown_001",
        "idempotency_legacy_unknown_001",
        "OUTCOME_UNKNOWN",
        4
      ),
      makeLegacyRecord(
        "generation_legacy_reconciling_002",
        "idempotency_legacy_reconciling_002",
        "RECONCILING",
        7
      ),
      makeLegacyRecord(
        "generation_legacy_prepared_003",
        "idempotency_legacy_prepared_003",
        "PREPARED",
        0
      ),
      makeLegacyRecord(
        "generation_legacy_chat_creating_004",
        "idempotency_legacy_chat_creating_004",
        "CHAT_CREATING",
        2
      ),
      {
        ...makeLegacyRecord(
          "generation_legacy_dispatching_005",
          "idempotency_legacy_dispatching_005",
          "GENERATION_DISPATCHING",
          3
        ),
        receipt: {
          chat_uuid: "chat_legacy_dispatching_005",
          provider_job_id: null,
          message_id: null,
          message_object_id: null
        }
      },
      {
        ...makeLegacyRecord(
          "generation_legacy_invalid_prepared_006",
          "idempotency_legacy_invalid_prepared_006",
          "PREPARED",
          0
        ),
        receipt: chatOnlyReceipt("invalid_prepared_006")
      },
      {
        ...makeLegacyRecord(
          "generation_legacy_invalid_chat_creating_007",
          "idempotency_legacy_invalid_chat_creating_007",
          "CHAT_CREATING",
          1
        ),
        receipt: chatOnlyReceipt("invalid_chat_creating_007")
      },
      {
        ...makeLegacyRecord(
          "generation_legacy_invalid_chat_ready_008",
          "idempotency_legacy_invalid_chat_ready_008",
          "CHAT_READY",
          2
        ),
        receipt: providerReceipt("invalid_chat_ready_008")
      },
      makeLegacyRecord(
        "generation_legacy_invalid_rejected_009",
        "idempotency_legacy_invalid_rejected_009",
        "REJECTED_NO_COMMIT",
        1
      ),
      {
        ...makeLegacyRecord(
          "generation_legacy_invalid_provider_010",
          "idempotency_legacy_invalid_provider_010",
          "PROVIDER_ACCEPTED",
          4
        ),
        receipt: chatOnlyReceipt("invalid_provider_010")
      }
    ]);

    const store = new SqliteGenerationTransactionStore(databasePath, {
      now: () => new Date(RECOVERED_AT)
    });
    for (const id of [
      "generation_legacy_unknown_001",
      "generation_legacy_reconciling_002"
    ]) {
      const record = store.getById(OWNER, id);
      assert.equal(record?.state, "TERMINAL_UNRESOLVED");
      assert.equal(record?.failure_code, "MIGRATED_AMBIGUOUS_STAGE");
      assert.equal(record?.idempotency_key.includes("legacy"), true);
      assert.equal(record?.request_hash, hashOf("a"));
      assert.equal(record?.created_at, CREATED_AT);
      const event = store.listEvents(OWNER, id)[0];
      assert.equal(event?.event_type, "MIGRATED_V1");
      assert.equal(event?.from_state, null);
      assert.equal(event?.to_state, "TERMINAL_UNRESOLVED");
      assert.match(event?.reason_code ?? "", /^LEGACY_(OUTCOME_UNKNOWN|RECONCILING)$/);
      assert.equal(event?.operation_revision, record?.revision);
    }
    assert.equal(
      store.getById(OWNER, "generation_legacy_prepared_003")?.state,
      "PREPARED"
    );
    assert.equal(
      store.listEvents(OWNER, "generation_legacy_prepared_003")[0]?.reason_code,
      "SCHEMA_V1_TO_V2"
    );
    for (const id of [
      "generation_legacy_invalid_prepared_006",
      "generation_legacy_invalid_chat_creating_007",
      "generation_legacy_invalid_chat_ready_008",
      "generation_legacy_invalid_rejected_009",
      "generation_legacy_invalid_provider_010"
    ]) {
      const record = store.getById(OWNER, id);
      assert.equal(record?.state, "TERMINAL_UNRESOLVED");
      assert.equal(
        record?.failure_code,
        "MIGRATED_STATE_INVARIANT_VIOLATION"
      );
      assert.equal(
        store.listEvents(OWNER, id)[0]?.reason_code,
        "LEGACY_STATE_INVARIANT_VIOLATION"
      );
    }
    const recovery = store.recoverInterruptedOperations(RECOVERED_AT);
    assert.equal(recovery.recovered_count, 2);
    assert.equal(
      store.getById(OWNER, "generation_legacy_chat_creating_004")?.state,
      "CHAT_CREATE_OUTCOME_UNKNOWN"
    );
    assert.equal(
      store.getById(OWNER, "generation_legacy_dispatching_005")?.state,
      "GENERATION_OUTCOME_UNKNOWN"
    );
    store.close();

    const reopened = new SqliteGenerationTransactionStore(databasePath);
    assert.equal(
      reopened.listEvents(OWNER, "generation_legacy_unknown_001").length,
      1
    );
    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    const rows = inspection
      .prepare("SELECT COUNT(*) AS count FROM generation_operations")
      .get() as { count: number };
    const version = inspection
      .prepare("SELECT MAX(version) AS version FROM generation_store_migrations")
      .get() as { version: number };
    assert.equal(rows.count, 10);
    assert.equal(version.version, 5);
    const appliedVersions = inspection
      .prepare(
        "SELECT version FROM generation_store_migrations ORDER BY version"
      )
      .all() as { version: number }[];
    assert.deepEqual(
      appliedVersions.map((row) => row.version),
      [1, 2, 3, 4, 5]
    );
    inspection.close();
    reopened.close();
  });
});

test("an exact previous-v2 database upgrades with rows and events intact", () => {
  withDatabasePath((databasePath) => {
    const prepared = makeRecord({
      id: "generation_v2_a_prepared_001",
      idempotency_key: "idempotency_v2_a_prepared_001"
    });
    const interrupted: GenerationOperationRecord = {
      ...makeRecord({
        id: "generation_v2_b_interrupted_002",
        idempotency_key: "idempotency_v2_b_interrupted_002"
      }),
      state: "CHAT_CREATING",
      updated_at: LATER,
      revision: 1
    };
    createPreviousV2Database(databasePath, prepared, interrupted);

    const beforeUpgrade = new DatabaseSync(databasePath, { readOnly: true });
    const beforeVersion = beforeUpgrade
      .prepare("SELECT MAX(version) AS version FROM generation_store_migrations")
      .get() as { version: number };
    const oldContextArtifacts = beforeUpgrade
      .prepare(
        `SELECT name
           FROM sqlite_master
          WHERE name IN (
            'generation_operation_transition_context',
            'generation_operations_transition_context_required',
            'generation_operations_append_transition_event'
          )`
      )
      .all();
    assert.equal(beforeVersion.version, 2);
    assert.deepEqual(oldContextArtifacts, []);
    beforeUpgrade.close();

    const store = new SqliteGenerationTransactionStore(databasePath, {
      now: () => new Date(RECOVERED_AT)
    });
    const transitioned = store.transition({
      owner: OWNER,
      id: prepared.id,
      expected_revision: 0,
      to_state: "CHAT_CREATING",
      updated_at: LATER
    });
    assert.equal(transitioned.state, "CHAT_CREATING");
    assert.equal(transitioned.revision, 1);
    assert.deepEqual(store.listEvents(OWNER, prepared.id), [
      {
        sequence: 10,
        generation_operation_id: prepared.id,
        operation_revision: 0,
        event_type: "CREATED",
        from_state: null,
        to_state: "PREPARED",
        reason_code: null,
        recorded_at: CREATED_AT
      },
      {
        sequence: 22,
        generation_operation_id: prepared.id,
        operation_revision: 1,
        event_type: "TRANSITIONED",
        from_state: "PREPARED",
        to_state: "CHAT_CREATING",
        reason_code: null,
        recorded_at: LATER
      }
    ]);

    const recovery = store.recoverInterruptedOperations(RECOVERED_AT);
    assert.deepEqual(
      recovery.records.map((record) => [
        record.id,
        record.state,
        record.revision
      ]),
      [
        [prepared.id, "CHAT_CREATE_OUTCOME_UNKNOWN", 2],
        [interrupted.id, "CHAT_CREATE_OUTCOME_UNKNOWN", 2]
      ]
    );
    const expectedPreparedEvents = [
      {
        sequence: 10,
        generation_operation_id: prepared.id,
        operation_revision: 0,
        event_type: "CREATED" as const,
        from_state: null,
        to_state: "PREPARED" as const,
        reason_code: null,
        recorded_at: CREATED_AT
      },
      {
        sequence: 22,
        generation_operation_id: prepared.id,
        operation_revision: 1,
        event_type: "TRANSITIONED" as const,
        from_state: "PREPARED" as const,
        to_state: "CHAT_CREATING" as const,
        reason_code: null,
        recorded_at: LATER
      },
      {
        sequence: 23,
        generation_operation_id: prepared.id,
        operation_revision: 2,
        event_type: "CRASH_RECOVERED" as const,
        from_state: "CHAT_CREATING" as const,
        to_state: "CHAT_CREATE_OUTCOME_UNKNOWN" as const,
        reason_code: "PROCESS_RESTART",
        recorded_at: RECOVERED_AT
      }
    ];
    const expectedInterruptedEvents = [
      {
        sequence: 20,
        generation_operation_id: interrupted.id,
        operation_revision: 0,
        event_type: "CREATED" as const,
        from_state: null,
        to_state: "PREPARED" as const,
        reason_code: null,
        recorded_at: CREATED_AT
      },
      {
        sequence: 21,
        generation_operation_id: interrupted.id,
        operation_revision: 1,
        event_type: "TRANSITIONED" as const,
        from_state: "PREPARED" as const,
        to_state: "CHAT_CREATING" as const,
        reason_code: null,
        recorded_at: LATER
      },
      {
        sequence: 24,
        generation_operation_id: interrupted.id,
        operation_revision: 2,
        event_type: "CRASH_RECOVERED" as const,
        from_state: "CHAT_CREATING" as const,
        to_state: "CHAT_CREATE_OUTCOME_UNKNOWN" as const,
        reason_code: "PROCESS_RESTART",
        recorded_at: RECOVERED_AT
      }
    ];
    assert.deepEqual(
      store.listEvents(OWNER, prepared.id),
      expectedPreparedEvents
    );
    assert.deepEqual(
      store.listEvents(OWNER, interrupted.id),
      expectedInterruptedEvents
    );
    store.close();

    const reopened = new SqliteGenerationTransactionStore(databasePath);
    assert.deepEqual(
      reopened.listEvents(OWNER, prepared.id),
      expectedPreparedEvents
    );
    assert.deepEqual(
      reopened.listEvents(OWNER, interrupted.id),
      expectedInterruptedEvents
    );
    assert.equal(
      reopened.getById(OWNER, prepared.id)?.state,
      "CHAT_CREATE_OUTCOME_UNKNOWN"
    );
    assert.equal(
      reopened.getById(OWNER, interrupted.id)?.state,
      "CHAT_CREATE_OUTCOME_UNKNOWN"
    );
    reopened.close();

    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    const versions = inspection
      .prepare(
        "SELECT version, applied_at FROM generation_store_migrations ORDER BY version"
      )
      .all() as { version: number; applied_at: string }[];
    const operationCount = inspection
      .prepare("SELECT COUNT(*) AS count FROM generation_operations")
      .get() as { count: number };
    const eventSequences = inspection
      .prepare("SELECT sequence FROM generation_operation_events ORDER BY sequence")
      .all() as { sequence: number }[];
    const contextCount = inspection
      .prepare(
        "SELECT COUNT(*) AS count FROM generation_operation_transition_context"
      )
      .get() as { count: number };
    assert.deepEqual(versions.map((row) => ({ ...row })), [
      { version: 1, applied_at: CREATED_AT },
      { version: 2, applied_at: LATER },
      { version: 3, applied_at: RECOVERED_AT },
      { version: 4, applied_at: RECOVERED_AT },
      { version: 5, applied_at: RECOVERED_AT }
    ]);
    assert.equal(operationCount.count, 2);
    assert.deepEqual(
      eventSequences.map((row) => row.sequence),
      [10, 20, 21, 22, 23, 24]
    );
    assert.equal(contextCount.count, 0);
    inspection.close();
  });
});

test("reads reject an existing v2 snapshot that violates state invariants", () => {
  withDatabasePath((databasePath) => {
    const store = new SqliteGenerationTransactionStore(databasePath);
    store.createOrReplay(makeRecord());
    store.close();

    const tamper = new DatabaseSync(databasePath);
    tamper.exec("PRAGMA ignore_check_constraints = ON");
    tamper.exec("DROP TRIGGER generation_operations_mutation_guard");
    tamper.exec("DROP TRIGGER generation_operations_transition_context_required");
    tamper
      .prepare(
        `UPDATE generation_operations
            SET receipt_chat_uuid = ?
          WHERE id = ?`
      )
      .run("chat_invalid_prepared_snapshot", "generation_test_001");
    tamper.close();

    const reopened = new SqliteGenerationTransactionStore(databasePath);
    assert.throws(
      () => reopened.getById(OWNER, "generation_test_001"),
      hasStoreCode("CORRUPT_RECORD")
    );
    assert.throws(
      () => reopened.getByIdempotencyKey(OWNER, "idempotency_test_001"),
      hasStoreCode("CORRUPT_RECORD")
    );
    reopened.close();
  });
});

test("the durable database never serializes extra prompt or bearer fields", () => {
  withDatabasePath((databasePath, root) => {
    const privatePrompt = "PRIVATE_PROMPT_8f43c91a_do_not_store";
    const bearerToken = ["BEARER", "SECRET", "61ae7335", "do", "not", "store"].join("_");
    const signedResultUrl = `https://example.invalid/result?token=${bearerToken}`;
    const recordWithForbiddenExtras = {
      ...makeRecord(),
      prompt: privatePrompt,
      parameters: { private_value: privatePrompt },
      bearer_token: bearerToken,
      signed_result_url: signedResultUrl
    } as GenerationOperationRecord;

    const store = new SqliteGenerationTransactionStore(databasePath);
    store.createOrReplay(recordWithForbiddenExtras);
    store.close();

    const bytes = readdirSync(join(root, "private"))
      .map((name) => readFileSync(join(root, "private", name)))
      .map((content) => content.toString("latin1"))
      .join("\n");
    assert.equal(bytes.includes(privatePrompt), false);
    assert.equal(bytes.includes(bearerToken), false);
    assert.equal(bytes.includes(signedResultUrl), false);

    const inspection = new DatabaseSync(databasePath);
    assert.throws(() =>
      inspection.prepare("DELETE FROM generation_operations").run()
    );
    assert.throws(() =>
      inspection
        .prepare(
          "UPDATE generation_operations SET request_hash = ? WHERE id = ?"
        )
        .run(hashOf("c"), "generation_test_001")
    );
    assert.throws(() =>
      inspection
        .prepare(
          `UPDATE generation_operations
              SET state = 'CHAT_CREATING', updated_at = ?, revision = 1
            WHERE id = ?`
        )
        .run(LATER, "generation_test_001")
    );
    const unchanged = inspection
      .prepare(
        "SELECT state, revision FROM generation_operations WHERE id = ?"
      )
      .get("generation_test_001") as { state: string; revision: number };
    const eventCount = inspection
      .prepare(
        "SELECT COUNT(*) AS count FROM generation_operation_events WHERE generation_operation_id = ?"
      )
      .get("generation_test_001") as { count: number };
    assert.equal(unchanged.state, "PREPARED");
    assert.equal(unchanged.revision, 0);
    assert.equal(eventCount.count, 1);
    assert.throws(() =>
      inspection
        .prepare(
          `UPDATE generation_operations
              SET state = 'CHAT_CREATING', updated_at = ?, revision = 2
            WHERE id = ?`
        )
        .run(LATER, "generation_test_001")
    );
    assert.throws(() =>
      inspection
        .prepare(
          `INSERT INTO generation_operation_events (
             generation_operation_id, operation_revision, event_type,
             from_state, to_state, reason_code, recorded_at
           ) VALUES (?, 2, 'TRANSITIONED', 'PREPARED', 'CHAT_CREATING',
                     NULL, ?)`
        )
        .run("generation_test_001", LATER)
    );
    assert.throws(() =>
      inspection
        .prepare(
          "UPDATE generation_operation_events SET reason_code = 'TAMPERED'"
        )
        .run()
    );
    assert.throws(() =>
      inspection.prepare("DELETE FROM generation_operation_events").run()
    );
    inspection.close();
  });
});

test("close is explicit, idempotent, and all later use fails closed", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  store.close();
  store.close();
  assert.throws(
    () => store.getById(OWNER, "generation_test_001"),
    (error: unknown) =>
      error instanceof GenerationTransactionStoreError &&
      error.code === "STORE_CLOSED"
  );
});

function makeRecord(
  overrides: Partial<GenerationOperationRecord> = {}
): GenerationOperationRecord {
  const base: GenerationOperationRecord = {
    id: "generation_test_001",
    principal: {
      ...OWNER,
      connection_id: "connection_test_001"
    },
    idempotency_key: "idempotency_test_001",
    request_hash: hashOf("a"),
    model_id: "banana2",
    operation_id: "image.generate",
    modality: "image",
    catalog_version: "official-public-api-v1",
    schema_hash: hashOf("d"),
    parameter_keys: ["image_size", "prompt"],
    estimate_id: "estimate_test_001",
    approved_max_cost: "12.5",
    cost: {
      effective_cost: "10",
      unit: "tokens",
      observed_at: CREATED_AT,
      expires_at: "2026-09-02T09:05:00.000Z",
      cap_enforcement: "UPSTREAM_QUOTE_BOUND"
    },
    state: "PREPARED",
    receipt: null,
    result_message_id: null,
    failure_code: null,
    dispatch_deadline: "2026-09-02T09:03:00.000Z",
    next_poll_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    revision: 0
  };
  return {
    ...base,
    ...overrides,
    principal: overrides.principal ?? base.principal,
    cost: overrides.cost ?? base.cost,
    parameter_keys: overrides.parameter_keys ?? base.parameter_keys
  };
}

function advance(
  store: SqliteGenerationTransactionStore,
  id: string,
  states: GenerationOperationRecord["state"][],
  startingRevision = 0
): void {
  let revision = startingRevision;
  for (const state of states) {
    const receipt =
      state === "CHAT_READY"
        ? {
            chat_uuid: `chat_${id}`,
            provider_job_id: null,
            message_id: null,
            message_object_id: null
          }
        : state === "PROVIDER_ACCEPTED"
          ? {
              chat_uuid: `chat_${id}`,
              provider_job_id: `job_${id}`,
              message_id: null,
              message_object_id: null
            }
          : undefined;
    const failureCode = (
      ["FAILED", "REJECTED_NO_COMMIT", "TERMINAL_UNRESOLVED"] as const
    ).includes(
      state as "FAILED" | "REJECTED_NO_COMMIT" | "TERMINAL_UNRESOLVED"
    )
      ? "TEST_TERMINAL_STATE"
      : undefined;
    const result = store.transition({
      owner: OWNER,
      id,
      expected_revision: revision,
      to_state: state,
      updated_at: LATER,
      ...(receipt === undefined ? {} : { receipt }),
      ...(failureCode === undefined ? {} : { failure_code: failureCode })
    });
    revision = result.revision;
  }
}

type LegacyGenerationOperationRecord = Omit<
  GenerationOperationRecord,
  "state"
> & { state: string };

function chatOnlyReceipt(suffix: string): NonNullable<GenerationOperationRecord["receipt"]> {
  return {
    chat_uuid: `chat_${suffix}`,
    provider_job_id: null,
    message_id: null,
    message_object_id: null
  };
}

function providerReceipt(suffix: string): NonNullable<GenerationOperationRecord["receipt"]> {
  return {
    ...chatOnlyReceipt(suffix),
    provider_job_id: `job_${suffix}`
  };
}

function makeLegacyRecord(
  id: string,
  idempotencyKey: string,
  state: string,
  revision: number
): LegacyGenerationOperationRecord {
  return {
    ...makeRecord({ id, idempotency_key: idempotencyKey }),
    state,
    revision,
    updated_at: revision === 0 ? CREATED_AT : LATER
  };
}

function createLegacyV1Database(
  databasePath: string,
  records: LegacyGenerationOperationRecord[]
): void {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(databasePath);
  database.exec(LEGACY_VERSION_ONE_SCHEMA_SQL);
  insertOperationRows(database, records);
  database.close();
}

function createPreviousV2Database(
  databasePath: string,
  prepared: GenerationOperationRecord,
  interrupted: GenerationOperationRecord
): void {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(PREVIOUS_VERSION_TWO_SCHEMA_SQL);
  insertOperationRows(database, [prepared, interrupted]);

  const insertEvent = database.prepare(`
    INSERT INTO generation_operation_events (
      sequence, generation_operation_id, operation_revision, event_type,
      from_state, to_state, reason_code, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertEvent.run(
    10,
    prepared.id,
    0,
    "CREATED",
    null,
    "PREPARED",
    null,
    CREATED_AT
  );
  insertEvent.run(
    20,
    interrupted.id,
    0,
    "CREATED",
    null,
    "PREPARED",
    null,
    CREATED_AT
  );
  insertEvent.run(
    21,
    interrupted.id,
    1,
    "TRANSITIONED",
    "PREPARED",
    "CHAT_CREATING",
    null,
    LATER
  );
  database.exec(PREVIOUS_VERSION_TWO_TRIGGER_SQL);
  database.close();
}

function insertOperationRows(
  database: DatabaseSync,
  records: readonly LegacyGenerationOperationRecord[]
): void {
  const insert = database.prepare(`
    INSERT INTO generation_operations (
      id, kind, tenant_id, subject_id, connection_id, idempotency_key,
      request_hash, model_id, operation_id, modality, catalog_version,
      schema_hash, parameter_keys_json, estimate_id, approved_max_cost,
      cost_effective, cost_unit, cost_observed_at, cost_expires_at,
      cost_cap_enforcement, state, receipt_chat_uuid,
      receipt_provider_job_id, receipt_message_id, receipt_message_object_id,
      failure_code, dispatch_deadline, next_poll_at, created_at, updated_at,
      revision
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  for (const record of records) {
    insert.run(
      record.id,
      "generation",
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
      record.failure_code,
      record.dispatch_deadline,
      record.next_poll_at,
      record.created_at,
      record.updated_at,
      record.revision
    );
  }
}

const LEGACY_VERSION_ONE_SCHEMA_SQL = `
  CREATE TABLE generation_store_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT;
  INSERT INTO generation_store_migrations(version, applied_at)
  VALUES (1, '${CREATED_AT}');

  CREATE TABLE generation_operations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    model_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    modality TEXT NOT NULL,
    catalog_version TEXT NOT NULL,
    schema_hash TEXT NOT NULL,
    parameter_keys_json TEXT NOT NULL,
    estimate_id TEXT NOT NULL,
    approved_max_cost TEXT NOT NULL,
    cost_effective TEXT,
    cost_unit TEXT,
    cost_observed_at TEXT NOT NULL,
    cost_expires_at TEXT NOT NULL,
    cost_cap_enforcement TEXT NOT NULL,
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
    revision INTEGER NOT NULL,
    UNIQUE (tenant_id, subject_id, kind, idempotency_key)
  ) STRICT;
`;

const PREVIOUS_VERSION_TWO_SCHEMA_SQL = `
  CREATE TABLE generation_store_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT;
  INSERT INTO generation_store_migrations(version, applied_at)
  VALUES (1, '${CREATED_AT}'), (2, '${LATER}');

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
    UNIQUE (tenant_id, subject_id, kind, idempotency_key)
  ) STRICT;

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
`;

const PREVIOUS_VERSION_TWO_TRIGGER_SQL = `
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
  WHEN NEW.revision <> OLD.revision + 1 OR NEW.updated_at < OLD.updated_at
  BEGIN
    SELECT RAISE(ABORT, 'generation operation mutation violates invariants');
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

function hasStoreCode(code: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof GenerationTransactionStoreError && error.code === code;
}

function hashOf(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function withDatabasePath(
  run: (databasePath: string, root: string) => void
): void {
  const root = mkdtempSync(join(tmpdir(), "syntx-generation-store-"));
  const databasePath = join(root, "private", "generation.sqlite");
  try {
    run(databasePath, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
