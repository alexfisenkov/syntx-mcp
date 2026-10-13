import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import test from "node:test";
import type { GenerationOperationRecord } from "../src/domain/generation-operation.js";
import type { GenerationCancelAttemptClaimInput } from "../src/storage/generation-cancel-attempt-store.js";
import {
  GenerationTransactionStoreError,
  type GenerationOperationOwnerRef,
  type GenerationTransactionStoreErrorCode,
} from "../src/storage/generation-transaction-store.js";
import { SqliteGenerationTransactionStore } from "../src/storage/sqlite-generation-transaction-store.js";

const OWNER = { tenant_id: "cancel_tenant", subject_id: "cancel_subject" };
const CREATED = "2026-09-04T09:00:00.000Z";
const CLAIMED = "2026-09-04T09:01:00.000Z";
const SETTLED = "2026-09-04T09:02:00.000Z";
const LATE = "2026-09-04T09:03:00.000Z";

test("claim is durable before return, a second connection replays without another event", () => {
  withPath((path) => {
    const first = new SqliteGenerationTransactionStore(path);
    const second = new SqliteGenerationTransactionStore(path);
    accepted(first);
    const claimed = first.claimCancelAttempt(claim());
    assert.equal(claimed.outcome, "claimed");
    assert.equal(claimed.record?.state, "DISPATCHING");
    const replay = second.claimCancelAttempt(
      claim({ confirmation_hash: hash("b") }),
    );
    assert.equal(replay.outcome, "replayed");
    assert.deepEqual(replay.record, claimed.record);
    assert.deepEqual(
      second.getCancelAttemptByIdempotencyKey(OWNER, "cancel_key"),
      claimed.record,
    );
    assert.equal(second.listCancelAttemptEvents(OWNER, "job").length, 1);
    assert.throws(
      () => second.claimCancelAttempt(claim({ idempotency_key: "new_key" })),
      code("CANCEL_ALREADY_ATTEMPTED"),
    );
    first.close();
    second.close();
  });
});

test("simultaneous worker connections commit exactly one cancellation claim", async () => {
  const directory = mkdtempSync(join(tmpdir(), "syntx-cancel-race-test-"));
  const workers: Worker[] = [];
  try {
    const path = join(directory, "journal.sqlite");
    const store = new SqliteGenerationTransactionStore(path);
    accepted(store);
    store.close();
    const moduleUrl = new URL(
      "../src/storage/sqlite-generation-transaction-store.js",
      import.meta.url,
    ).href;
    const ready = [0, 1].map(() => {
      const worker = new Worker(
        `
        const { parentPort, workerData } = require('node:worker_threads');
        import(workerData.moduleUrl).then(({ SqliteGenerationTransactionStore }) => {
          const store = new SqliteGenerationTransactionStore(workerData.path);
          parentPort.once('message', () => {
            const result = store.claimCancelAttempt(workerData.input);
            store.close();
            parentPort.postMessage(result.outcome);
          });
          parentPort.postMessage('ready');
        });
      `,
        { eval: true, workerData: { path, moduleUrl, input: claim() } },
      );
      workers.push(worker);
      return new Promise<void>((resolve, reject) => {
        worker.once("error", reject);
        worker.once("message", (message) =>
          message === "ready"
            ? resolve()
            : reject(new Error("worker readiness failed")),
        );
      });
    });
    await Promise.all(ready);
    const results = workers.map(
      (worker) =>
        new Promise<string>((resolve, reject) => {
          worker.once("error", reject);
          worker.once("message", (message: string) => resolve(message));
        }),
    );
    for (const worker of workers) worker.postMessage("claim");
    assert.deepEqual((await Promise.all(results)).sort(), [
      "claimed",
      "replayed",
    ]);
    const inspect = new SqliteGenerationTransactionStore(path);
    assert.equal(inspect.listCancelAttemptEvents(OWNER, "job").length, 1);
    inspect.close();
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reopen does not recover; explicit startup recovery blocks new keys and retains generation", () => {
  withPath((path) => {
    const first = new SqliteGenerationTransactionStore(path);
    const generation = accepted(first);
    const events = first.listEvents(OWNER, "job");
    first.claimCancelAttempt(claim());
    first.close();
    const reopened = new SqliteGenerationTransactionStore(path);
    assert.equal(reopened.getCancelAttempt(OWNER, "job")?.state, "DISPATCHING");
    const recovery = reopened.recoverInterruptedCancelAttempts(SETTLED);
    assert.equal(recovery.recovered_count, 1);
    assert.equal(recovery.records[0]?.state, "OUTCOME_UNKNOWN");
    assert.equal(
      reopened.recoverInterruptedCancelAttempts(LATE).recovered_count,
      0,
    );
    assert.equal(reopened.claimCancelAttempt(claim()).outcome, "replayed");
    assert.throws(
      () =>
        reopened.claimCancelAttempt(claim({ idempotency_key: "fresh_key" })),
      code("CANCEL_ALREADY_ATTEMPTED"),
    );
    assert.deepEqual(reopened.getById(OWNER, "job"), generation);
    assert.deepEqual(reopened.listEvents(OWNER, "job"), events);
    reopened.close();
  });
});

test("settlement merges late ACK after recovery and never downgrades ACK or adds no-op events", () => {
  withPath((path) => {
    const first = new SqliteGenerationTransactionStore(path);
    const second = new SqliteGenerationTransactionStore(path);
    const generation = accepted(first);
    const events = first.listEvents(OWNER, "job");
    first.claimCancelAttempt(claim());
    second.recoverInterruptedCancelAttempts(SETTLED);
    const ack = first.settleCancelAttempt({
      owner: OWNER,
      generation_operation_id: "job",
      to_state: "ACKNOWLEDGED",
      updated_at: LATE,
    });
    assert.equal(ack.state, "ACKNOWLEDGED");
    assert.equal(ack.revision, 2);
    assert.deepEqual(
      second.settleCancelAttempt({
        owner: OWNER,
        generation_operation_id: "job",
        to_state: "OUTCOME_UNKNOWN",
        updated_at: SETTLED,
      }),
      ack,
    );
    assert.deepEqual(
      second.settleCancelAttempt({
        owner: OWNER,
        generation_operation_id: "job",
        to_state: "ACKNOWLEDGED",
        updated_at: LATE,
      }),
      ack,
    );
    assert.deepEqual(
      first
        .listCancelAttemptEvents(OWNER, "job")
        .map((event) => event.to_state),
      ["DISPATCHING", "OUTCOME_UNKNOWN", "ACKNOWLEDGED"],
    );
    assert.deepEqual(first.getById(OWNER, "job"), generation);
    assert.deepEqual(first.listEvents(OWNER, "job"), events);
    first.close();
    second.close();
  });
});

test("direct ACK advances only cancellation revision and duplicate unknown settlement is a no-op", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  const generation = accepted(store);
  store.claimCancelAttempt(claim());
  const ack = store.settleCancelAttempt({
    owner: OWNER,
    generation_operation_id: "job",
    to_state: "ACKNOWLEDGED",
    updated_at: SETTLED,
  });
  assert.equal(ack.revision, 1);
  assert.deepEqual(store.getById(OWNER, "job"), generation);
  accepted(store, "job2");
  store.claimCancelAttempt(
    claim({
      generation_operation_id: "job2",
      idempotency_key: "key2",
      confirmation_hash: hash("b"),
    }),
  );
  const unknownInput = {
    owner: OWNER,
    generation_operation_id: "job2",
    to_state: "OUTCOME_UNKNOWN" as const,
    updated_at: SETTLED,
  };
  const unknown = store.settleCancelAttempt(unknownInput);
  assert.deepEqual(store.settleCancelAttempt(unknownInput), unknown);
  assert.equal(store.listCancelAttemptEvents(OWNER, "job2").length, 2);
  store.close();
});

test("ACK survives restart and recovery time regression rolls back the whole batch", () => {
  withPath((path) => {
    const store = new SqliteGenerationTransactionStore(path);
    accepted(store);
    store.claimCancelAttempt(claim());
    const ack = store.settleCancelAttempt({
      owner: OWNER,
      generation_operation_id: "job",
      to_state: "ACKNOWLEDGED",
      updated_at: SETTLED,
    });
    accepted(store, "early");
    accepted(store, "late");
    store.claimCancelAttempt(
      claim({
        generation_operation_id: "early",
        idempotency_key: "early_key",
        confirmation_hash: hash("b"),
      }),
    );
    store.claimCancelAttempt(
      claim({
        generation_operation_id: "late",
        idempotency_key: "late_key",
        confirmation_hash: hash("c"),
        created_at: LATE,
      }),
    );
    assert.throws(
      () => store.recoverInterruptedCancelAttempts(SETTLED),
      code("INVALID_RECORD"),
    );
    for (const id of ["early", "late"]) {
      assert.equal(store.getCancelAttempt(OWNER, id)?.state, "DISPATCHING");
      assert.equal(store.listCancelAttemptEvents(OWNER, id).length, 1);
    }
    store.close();
    const reopened = new SqliteGenerationTransactionStore(path);
    assert.deepEqual(
      reopened.claimCancelAttempt(claim({ confirmation_hash: hash("f") }))
        .record,
      ack,
    );
    assert.equal(reopened.listCancelAttemptEvents(OWNER, "job").length, 2);
    assert.equal(
      reopened.recoverInterruptedCancelAttempts(LATE).recovered_count,
      2,
    );
    assert.deepEqual(reopened.getCancelAttempt(OWNER, "job"), ack);
    reopened.close();
  });
});

test("same key with another job conflicts, and confirmation reuse cannot authorize a second job", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  accepted(store);
  accepted(store, "job2");
  store.claimCancelAttempt(claim());
  assert.throws(
    () => store.claimCancelAttempt(claim({ generation_operation_id: "job2" })),
    code("IDEMPOTENCY_CONFLICT"),
  );
  assert.throws(
    () =>
      store.claimCancelAttempt(
        claim({
          generation_operation_id: "job2",
          idempotency_key: "second_key",
        }),
      ),
    code("CANCEL_CONFIRMATION_CONFLICT"),
  );
  assert.equal(store.getCancelAttempt(OWNER, "job2"), null);
  // Cancellation keys are a separate namespace from generation-start keys.
  assert.equal(
    store.claimCancelAttempt(
      claim({
        generation_operation_id: "job2",
        idempotency_key: "generation_key_job2",
        confirmation_hash: hash("b"),
      }),
    ).outcome,
    "claimed",
  );
  store.close();
});

test("terminal jobs are no-op only after resolving all prior bindings", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  accepted(store);
  store.claimCancelAttempt(claim());
  accepted(store, "job2");
  const running = store.getById(OWNER, "job2")!;
  const terminal = store.transition({
    owner: OWNER,
    id: "job2",
    expected_revision: running.revision,
    to_state: "SUCCEEDED",
    updated_at: CLAIMED,
  });
  assert.throws(
    () => store.claimCancelAttempt(claim({ generation_operation_id: "job2" })),
    code("IDEMPOTENCY_CONFLICT"),
  );
  assert.throws(
    () =>
      store.claimCancelAttempt(
        claim({ generation_operation_id: "job2", idempotency_key: "key2" }),
      ),
    code("CANCEL_CONFIRMATION_CONFLICT"),
  );
  assert.deepEqual(
    store.claimCancelAttempt(
      claim({
        generation_operation_id: "job2",
        idempotency_key: "key2",
        confirmation_hash: hash("b"),
      }),
    ),
    { outcome: "terminal", record: null },
  );
  assert.equal(store.getCancelAttempt(OWNER, "job2"), null);
  assert.deepEqual(store.listCancelAttemptEvents(OWNER, "job2"), []);
  assert.deepEqual(store.getById(OWNER, "job2"), terminal);
  const first = store.getById(OWNER, "job")!;
  store.transition({
    owner: OWNER,
    id: "job",
    expected_revision: first.revision,
    to_state: "CANCELED",
    updated_at: CLAIMED,
  });
  assert.equal(store.claimCancelAttempt(claim()).outcome, "replayed");
  assert.throws(
    () => store.claimCancelAttempt(claim({ idempotency_key: "new" })),
    code("CANCEL_ALREADY_ATTEMPTED"),
  );
  store.close();
});

test("every terminal generation state creates no cancellation attempt", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  for (const terminal of ["SUCCEEDED", "FAILED", "CANCELED"] as const) {
    const record = accepted(store, terminal);
    store.transition({
      owner: OWNER,
      id: terminal,
      expected_revision: record.revision,
      to_state: terminal,
      updated_at: CLAIMED,
      ...(terminal === "FAILED" ? { failure_code: "PROVIDER_FAILED" } : {}),
    });
    assert.equal(
      store.claimCancelAttempt(claim({ generation_operation_id: terminal }))
        .outcome,
      "terminal",
    );
  }
  const rejected = store.createOrReplay(prepared("rejected")).record;
  store.transition({
    owner: OWNER,
    id: rejected.id,
    expected_revision: rejected.revision,
    to_state: "REJECTED_NO_COMMIT",
    updated_at: CLAIMED,
    failure_code: "REJECTED",
  });
  assert.equal(
    store.claimCancelAttempt(claim({ generation_operation_id: rejected.id }))
      .outcome,
    "terminal",
  );
  let unresolved = store.createOrReplay(prepared("unresolved")).record;
  for (const toState of [
    "CHAT_CREATING",
    "CHAT_CREATE_OUTCOME_UNKNOWN",
    "TERMINAL_UNRESOLVED",
  ] as const) {
    unresolved = store.transition({
      owner: OWNER,
      id: unresolved.id,
      expected_revision: unresolved.revision,
      to_state: toState,
      updated_at: CLAIMED,
      ...(toState === "TERMINAL_UNRESOLVED" ? { failure_code: "UNKNOWN" } : {}),
    });
  }
  assert.equal(
    store.claimCancelAttempt(claim({ generation_operation_id: unresolved.id }))
      .outcome,
    "terminal",
  );
  store.close();
});

test("only accepted queued running jobs with message receipts may claim", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  store.createOrReplay(prepared("prepared"));
  assert.throws(
    () =>
      store.claimCancelAttempt(claim({ generation_operation_id: "prepared" })),
    code("CANCEL_NOT_ALLOWED"),
  );
  accepted(store, "no_message", OWNER, null);
  assert.throws(
    () =>
      store.claimCancelAttempt(
        claim({ generation_operation_id: "no_message" }),
      ),
    code("CANCEL_NOT_ALLOWED"),
  );
  for (const [index, state] of (
    ["PROVIDER_ACCEPTED", "QUEUED", "RUNNING"] as const
  ).entries()) {
    let generation = accepted(store, state);
    if (state !== "PROVIDER_ACCEPTED")
      generation = store.transition({
        owner: OWNER,
        id: state,
        expected_revision: generation.revision,
        to_state: state,
        updated_at: CLAIMED,
      });
    assert.equal(
      store.claimCancelAttempt(
        claim({
          generation_operation_id: state,
          idempotency_key: `key${index}`,
          confirmation_hash: hash(String(index)),
        }),
      ).outcome,
      "claimed",
    );
  }
  store.close();
});

test("all pre-dispatch and uncertain generation stages fail closed without consuming a cancel key", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  const paths = [
    [],
    ["CHAT_CREATING"],
    ["CHAT_CREATING", "CHAT_READY"],
    ["CHAT_CREATING", "CHAT_CREATE_OUTCOME_UNKNOWN"],
    ["CHAT_CREATING", "CHAT_CREATE_OUTCOME_UNKNOWN", "CHAT_RECONCILING"],
    ["CHAT_CREATING", "CHAT_READY", "GENERATION_DISPATCHING"],
    [
      "CHAT_CREATING",
      "CHAT_READY",
      "GENERATION_DISPATCHING",
      "GENERATION_OUTCOME_UNKNOWN",
    ],
    [
      "CHAT_CREATING",
      "CHAT_READY",
      "GENERATION_DISPATCHING",
      "GENERATION_OUTCOME_UNKNOWN",
      "GENERATION_RECONCILING",
    ],
  ] as const;
  for (const [index, states] of paths.entries()) {
    let generation = store.createOrReplay(prepared(`pending_${index}`)).record;
    for (const toState of states) {
      generation = store.transition({
        owner: OWNER,
        id: generation.id,
        expected_revision: generation.revision,
        to_state: toState,
        updated_at: CREATED,
        ...(toState === "CHAT_READY"
          ? {
              receipt: {
                chat_uuid: "chat",
                provider_job_id: null,
                message_id: null,
                message_object_id: null,
              },
            }
          : {}),
      });
    }
    assert.throws(
      () =>
        store.claimCancelAttempt(
          claim({ generation_operation_id: generation.id }),
        ),
      code("CANCEL_NOT_ALLOWED"),
    );
    assert.equal(
      store.getCancelAttemptByIdempotencyKey(OWNER, "cancel_key"),
      null,
    );
    assert.deepEqual(store.getById(OWNER, generation.id), generation);
  }
  store.close();
});

test("tenant and subject scope apply independently to claims, reads, events and settlement", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  accepted(store);
  store.claimCancelAttempt(claim());
  for (const other of [
    { ...OWNER, tenant_id: "other_tenant" },
    { ...OWNER, subject_id: "other_subject" },
  ]) {
    assert.equal(store.getCancelAttempt(other, "job"), null);
    assert.equal(
      store.getCancelAttemptByIdempotencyKey(other, "cancel_key"),
      null,
    );
    assert.deepEqual(store.listCancelAttemptEvents(other, "job"), []);
    assert.throws(
      () => store.claimCancelAttempt(claim({ owner: other })),
      code("OPERATION_NOT_FOUND"),
    );
    assert.throws(
      () =>
        store.settleCancelAttempt({
          owner: other,
          generation_operation_id: "job",
          to_state: "ACKNOWLEDGED",
          updated_at: SETTLED,
        }),
      code("CANCEL_ATTEMPT_NOT_FOUND"),
    );
    const id = `job_${other.tenant_id}_${other.subject_id}`;
    accepted(store, id, other);
    assert.equal(
      store.claimCancelAttempt(
        claim({ owner: other, generation_operation_id: id }),
      ).outcome,
      "claimed",
    );
  }
  store.close();
});

test("invalid and backward-dated inputs cannot claim or change durable evidence", () => {
  const store = new SqliteGenerationTransactionStore(":memory:");
  accepted(store);
  for (const bad of [
    { confirmation_hash: "raw secret" },
    { confirmation_hash: `sha256:${"A".repeat(64)}` },
    { idempotency_key: "bad key" },
    { generation_operation_id: "../job" },
    { created_at: "2026-09-04" },
    { created_at: "2026-09-04T08:00:00.000Z" },
    { owner: { ...OWNER, subject_id: "secret\nvalue" } },
  ])
    assert.throws(
      () => store.claimCancelAttempt(claim(bad)),
      code("INVALID_RECORD"),
    );
  store.claimCancelAttempt(claim());
  assert.throws(
    () =>
      store.settleCancelAttempt({
        owner: OWNER,
        generation_operation_id: "job",
        to_state: "ACKNOWLEDGED",
        updated_at: CREATED,
      }),
    code("INVALID_RECORD"),
  );
  assert.throws(
    () => store.recoverInterruptedCancelAttempts(CREATED),
    code("INVALID_RECORD"),
  );
  assert.equal(store.getCancelAttempt(OWNER, "job")?.state, "DISPATCHING");
  assert.equal(store.listCancelAttemptEvents(OWNER, "job").length, 1);
  assert.throws(
    () => store.listCancelAttemptEvents(OWNER, "job", { limit: 1001 }),
    code("INVALID_RECORD"),
  );
  store.close();
  assert.throws(
    () => store.getCancelAttempt(OWNER, "job"),
    code("STORE_CLOSED"),
  );
});

test("event ledger is redacted, append-only, and direct SQL transitions are guarded and logged", () => {
  withPath((path) => {
    const store = new SqliteGenerationTransactionStore(path);
    const generation = accepted(store);
    store.claimCancelAttempt(claim());
    const inspection = new DatabaseSync(path);
    for (const sql of [
      "UPDATE generation_cancel_attempts SET idempotency_key = 'changed'",
      "UPDATE generation_cancel_attempts SET tenant_id = 'changed'",
      "UPDATE generation_cancel_attempts SET confirmation_hash = 'sha256:" +
        "b".repeat(64) +
        "'",
      "UPDATE generation_cancel_attempts SET state = 'ACKNOWLEDGED'",
      "DELETE FROM generation_cancel_attempts",
      "UPDATE generation_cancel_attempt_events SET event_type = 'SETTLED'",
      "DELETE FROM generation_cancel_attempt_events",
      "INSERT INTO generation_cancel_attempt_events(generation_operation_id,attempt_revision,event_type,from_state,to_state,recorded_at) VALUES ('job',1,'SETTLED','DISPATCHING','ACKNOWLEDGED','2026-09-04T09:02:00.000Z')",
    ])
      assert.throws(() => inspection.exec(sql));
    inspection
      .prepare(
        "UPDATE generation_cancel_attempts SET state = 'OUTCOME_UNKNOWN', revision = revision + 1, updated_at = ? WHERE generation_operation_id = 'job'",
      )
      .run(SETTLED);
    assert.equal(store.listCancelAttemptEvents(OWNER, "job").length, 2);
    assert.throws(() =>
      inspection
        .prepare(
          "UPDATE generation_cancel_attempts SET state = 'ACKNOWLEDGED', revision = revision + 1, updated_at = ? WHERE generation_operation_id = 'job'",
        )
        .run(CLAIMED),
    );
    store.settleCancelAttempt({
      owner: OWNER,
      generation_operation_id: "job",
      to_state: "ACKNOWLEDGED",
      updated_at: LATE,
    });
    assert.throws(() =>
      inspection
        .prepare(
          "UPDATE generation_cancel_attempts SET state = 'OUTCOME_UNKNOWN', revision = revision + 1, updated_at = ? WHERE generation_operation_id = 'job'",
        )
        .run(LATE),
    );
    const events = store.listCancelAttemptEvents(OWNER, "job");
    assert.deepEqual(Object.keys(events[0]!).sort(), [
      "attempt_revision",
      "event_type",
      "from_state",
      "generation_operation_id",
      "recorded_at",
      "sequence",
      "to_state",
    ]);
    const serialized = JSON.stringify(events);
    for (const forbidden of [
      "confirmation_hash",
      "tenant_id",
      "subject_id",
      "idempotency_key",
      "prompt",
      "credential",
      "receipt",
      "message_id",
    ])
      assert.equal(serialized.includes(forbidden), false);
    assert.deepEqual(
      store.listCancelAttemptEvents(OWNER, "job", {
        after_sequence: events[0]!.sequence,
        limit: 1,
      }),
      [events[1]],
    );
    assert.deepEqual(store.getById(OWNER, "job"), generation);
    inspection.close();
    store.close();
  });
});

test("SQL schema enforces unique intent and confirmation bindings and a parent-owner foreign key", () => {
  withPath((path) => {
    const store = new SqliteGenerationTransactionStore(path);
    accepted(store);
    store.claimCancelAttempt({
      ...claim(),
      ...{
        confirmation: "raw_confirmation_test",
        credentials: "raw_credentials_test",
        prompt: "private_prompt_test",
      },
    });
    const inspection = new DatabaseSync(path, { readOnly: true });
    const foreignKeys = inspection
      .prepare("PRAGMA foreign_key_list(generation_cancel_attempts)")
      .all();
    assert.deepEqual(
      foreignKeys.map((row) => [row.table, row.from, row.to]),
      [
        ["generation_operations", "generation_operation_id", "id"],
        ["generation_operations", "tenant_id", "tenant_id"],
        ["generation_operations", "subject_id", "subject_id"],
      ],
    );
    const indices = inspection
      .prepare("PRAGMA index_list(generation_cancel_attempts)")
      .all();
    const bindings = indices
      .filter((row) => row.unique === 1)
      .map((row) => {
        assert.match(
          String(row.name),
          /^sqlite_autoindex_generation_cancel_attempts_\d+$/,
        );
        return inspection
          .prepare(`PRAGMA index_info(${row.name})`)
          .all()
          .map((column) => column.name)
          .join(",");
      })
      .sort();
    assert.deepEqual(bindings, [
      "generation_operation_id",
      "tenant_id,subject_id,confirmation_hash",
      "tenant_id,subject_id,idempotency_key",
    ]);
    const serialized = JSON.stringify(
      inspection.prepare("SELECT * FROM generation_cancel_attempts").all(),
    );
    for (const forbidden of [
      "raw_confirmation_test",
      "raw_credentials_test",
      "private_prompt_test",
    ])
      assert.equal(serialized.includes(forbidden), false);
    inspection.close();
    store.close();
  });
});

test("corrupt cancellation snapshots and orphaned owner bindings fail closed", () => {
  for (const mutation of [
    "state = 'UNKNOWN_BAD'",
    "tenant_id = 'wrong_owner'",
    "confirmation_hash = 'raw_secret'",
  ]) {
    withPath((path) => {
      const store = new SqliteGenerationTransactionStore(path);
      accepted(store);
      store.claimCancelAttempt(claim());
      const inspection = new DatabaseSync(path);
      inspection.exec("PRAGMA foreign_keys = OFF");
      inspection.exec("PRAGMA ignore_check_constraints = ON");
      inspection.exec("DROP TRIGGER generation_cancel_attempt_update_guard");
      inspection.exec("DROP TRIGGER generation_cancel_attempt_update_event");
      inspection.exec(`UPDATE generation_cancel_attempts SET ${mutation}`);
      const owner = mutation.startsWith("tenant_id")
        ? { ...OWNER, tenant_id: "wrong_owner" }
        : OWNER;
      assert.throws(
        () => store.getCancelAttempt(owner, "job"),
        code("CORRUPT_RECORD"),
      );
      inspection.close();
      store.close();
    });
  }
});

test("v3 to v5 migration preserves legacy rows/events, initializes result binding empty, reopens, and refuses downgrade", () => {
  withPath((path) => {
    const store = new SqliteGenerationTransactionStore(path, {
      now: () => new Date(CREATED),
    });
    accepted(store);
    store.createOrReplay(prepared("other"));
    store.close();
    // Reconstitute a v3 database from this disposable v5 fixture.
    const fixture = new DatabaseSync(path);
    const beforeRows = (fixture
      .prepare("SELECT * FROM generation_operations ORDER BY id")
      .all() as Array<Record<string, unknown>>).map(({ result_message_id: _resultMessageId, ...legacy }) => legacy);
    const beforeEvents = fixture
      .prepare("SELECT * FROM generation_operation_events ORDER BY sequence")
      .all();
    const triggers = fixture.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND (tbl_name = 'generation_operations' OR tbl_name = 'generation_operation_events' OR name LIKE 'generation_cancel_attempt_%')",
    ).all() as { name: string }[];
    for (const trigger of triggers) fixture.exec(`DROP TRIGGER ${trigger.name}`);
    fixture.exec("DROP TABLE generation_cancel_attempt_events");
    fixture.exec("DROP TABLE generation_cancel_attempts");
    fixture.exec("DROP INDEX generation_operations_cancel_owner");
    fixture.exec("DROP INDEX generation_operation_events_operation_sequence");
    fixture.exec("ALTER TABLE generation_operations DROP COLUMN result_message_id");
    fixture.exec("ALTER TABLE generation_operation_events RENAME TO generation_operation_events_v5");
    fixture.exec(`CREATE TABLE generation_operation_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_operation_id TEXT NOT NULL REFERENCES generation_operations(id),
      operation_revision INTEGER NOT NULL CHECK (operation_revision >= 0),
      event_type TEXT NOT NULL CHECK (event_type IN ('CREATED', 'TRANSITIONED', 'CRASH_RECOVERED', 'MIGRATED_V1')),
      from_state TEXT CHECK (from_state IS NULL OR from_state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY', 'CHAT_CREATE_OUTCOME_UNKNOWN',
        'CHAT_RECONCILING', 'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED', 'RUNNING',
        'SUCCEEDED', 'FAILED', 'CANCELED', 'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )),
      to_state TEXT NOT NULL CHECK (to_state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY', 'CHAT_CREATE_OUTCOME_UNKNOWN',
        'CHAT_RECONCILING', 'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED', 'RUNNING',
        'SUCCEEDED', 'FAILED', 'CANCELED', 'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )),
      reason_code TEXT,
      recorded_at TEXT NOT NULL,
      UNIQUE (generation_operation_id, operation_revision)
    ) STRICT`);
    fixture.prepare(
      `INSERT INTO generation_operation_events (
         sequence, generation_operation_id, operation_revision, event_type,
         from_state, to_state, reason_code, recorded_at
       ) SELECT sequence, generation_operation_id, operation_revision, event_type,
                from_state, to_state, reason_code, recorded_at
           FROM generation_operation_events_v5 ORDER BY sequence`,
    ).run();
    fixture.exec("DROP TABLE generation_operation_events_v5");
    fixture.exec("CREATE INDEX generation_operation_events_operation_sequence ON generation_operation_events (generation_operation_id, sequence)");
    fixture.exec("DROP TABLE generation_operation_transition_context");
    fixture.exec(`CREATE TABLE generation_operation_transition_context (
      generation_operation_id TEXT PRIMARY KEY REFERENCES generation_operations(id),
      expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
      next_revision INTEGER NOT NULL CHECK (next_revision = expected_revision + 1),
      event_type TEXT NOT NULL CHECK (event_type IN ('TRANSITIONED', 'CRASH_RECOVERED')),
      from_state TEXT NOT NULL CHECK (from_state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY', 'CHAT_CREATE_OUTCOME_UNKNOWN',
        'CHAT_RECONCILING', 'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED', 'RUNNING',
        'SUCCEEDED', 'FAILED', 'CANCELED', 'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )),
      to_state TEXT NOT NULL CHECK (to_state IN (
        'PREPARED', 'CHAT_CREATING', 'CHAT_READY', 'CHAT_CREATE_OUTCOME_UNKNOWN',
        'CHAT_RECONCILING', 'GENERATION_DISPATCHING', 'GENERATION_OUTCOME_UNKNOWN',
        'GENERATION_RECONCILING', 'PROVIDER_ACCEPTED', 'QUEUED', 'RUNNING',
        'SUCCEEDED', 'FAILED', 'CANCELED', 'REJECTED_NO_COMMIT', 'TERMINAL_UNRESOLVED'
      )),
      reason_code TEXT,
      recorded_at TEXT NOT NULL,
      CHECK ((event_type = 'TRANSITIONED' AND reason_code IS NULL)
          OR (event_type = 'CRASH_RECOVERED' AND reason_code = 'PROCESS_RESTART'))
    ) STRICT`);
    const oldTriggerNames = [
      "generation_operations_no_delete",
      "generation_operations_immutable_binding",
      "generation_operations_mutation_guard",
      "generation_operations_transition_context_required",
      "generation_operations_append_transition_event",
    ];
    for (const name of oldTriggerNames) {
      const timing = name === "generation_operations_no_delete" ? "DELETE" : "UPDATE";
      fixture.exec(`CREATE TRIGGER ${name} BEFORE ${timing} ON generation_operations BEGIN SELECT 1; END`);
    }
    for (const [name, timing] of [
      ["generation_operation_events_no_update", "UPDATE"],
      ["generation_operation_events_insert_guard", "INSERT"],
      ["generation_operation_events_no_delete", "DELETE"],
    ]) {
      fixture.exec(`CREATE TRIGGER ${name} BEFORE ${timing} ON generation_operation_events BEGIN SELECT 1; END`);
    }
    fixture.exec("DELETE FROM generation_store_migrations WHERE version >= 4");
    assert.equal(
      (
        fixture
          .prepare("SELECT MAX(version) AS v FROM generation_store_migrations")
          .get() as { v: number }
      ).v,
      3,
    );
    fixture.close();
    const upgraded = new SqliteGenerationTransactionStore(path, {
      now: () => new Date(SETTLED),
    });
    const inspection = new DatabaseSync(path, { readOnly: true });
    assert.deepEqual(
      inspection
        .prepare("SELECT * FROM generation_operations ORDER BY id")
        .all()
        .map(({ result_message_id: _resultMessageId, ...legacy }) => legacy),
      beforeRows,
    );
    assert.deepEqual(
      inspection
        .prepare("SELECT * FROM generation_operation_events ORDER BY sequence")
        .all(),
      beforeEvents,
    );
    assert.deepEqual(
      inspection
        .prepare(
          "SELECT version FROM generation_store_migrations ORDER BY version",
        )
        .all()
        .map((row) => row.version),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      inspection.prepare("SELECT result_message_id FROM generation_operations ORDER BY id").all()
        .map((row) => ({ result_message_id: row.result_message_id })),
      [{ result_message_id: null }, { result_message_id: null }],
    );
    assert.deepEqual(inspection.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(upgraded.claimCancelAttempt(claim()).outcome, "claimed");
    assert.equal(upgraded.getCancelAttempt(OWNER, "job")?.state, "DISPATCHING");
    inspection.close();
    upgraded.close();

    const reopened = new SqliteGenerationTransactionStore(path);
    assert.equal(reopened.getById(OWNER, "job")?.result_message_id, null);
    reopened.close();

    const downgrade = new DatabaseSync(path);
    downgrade.prepare("INSERT INTO generation_store_migrations(version, applied_at) VALUES (6, ?)").run(CREATED);
    downgrade.close();
    assert.throws(() => new SqliteGenerationTransactionStore(path), code("UNSUPPORTED_SCHEMA_VERSION"));
  });
});

function claim(
  overrides: Partial<GenerationCancelAttemptClaimInput> = {},
): GenerationCancelAttemptClaimInput {
  return {
    owner: OWNER,
    generation_operation_id: "job",
    idempotency_key: "cancel_key",
    confirmation_hash: hash("a"),
    created_at: CLAIMED,
    ...overrides,
  };
}

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function prepared(
  id: string,
  owner: GenerationOperationOwnerRef = OWNER,
): GenerationOperationRecord {
  return {
    id,
    principal: { ...owner, connection_id: "connection" },
    idempotency_key: `generation_key_${id}`,
    request_hash: hash("c"),
    model_id: "banana2",
    operation_id: "image.generate",
    modality: "image",
    catalog_version: "catalog-v1",
    schema_hash: hash("d"),
    parameter_keys: ["prompt"],
    estimate_id: "estimate",
    approved_max_cost: "12",
    cost: {
      effective_cost: "10",
      unit: "tokens",
      observed_at: CREATED,
      expires_at: LATE,
      cap_enforcement: "UPSTREAM_QUOTE_BOUND",
    },
    state: "PREPARED",
    receipt: null,
    failure_code: null,
    dispatch_deadline: LATE,
    next_poll_at: null,
    created_at: CREATED,
    updated_at: CREATED,
    revision: 0,
  };
}

function accepted(
  store: SqliteGenerationTransactionStore,
  id = "job",
  owner: GenerationOperationOwnerRef = OWNER,
  messageId: string | null = "message",
): GenerationOperationRecord {
  let record = store.createOrReplay(prepared(id, owner)).record;
  for (const toState of [
    "CHAT_CREATING",
    "CHAT_READY",
    "GENERATION_DISPATCHING",
    "PROVIDER_ACCEPTED",
  ] as const) {
    record = store.transition({
      owner,
      id,
      expected_revision: record.revision,
      to_state: toState,
      updated_at: CREATED,
      ...(toState === "CHAT_READY"
        ? {
            receipt: {
              chat_uuid: "chat",
              provider_job_id: null,
              message_id: null,
              message_object_id: null,
            },
          }
        : {}),
      ...(toState === "PROVIDER_ACCEPTED"
        ? {
            receipt: {
              chat_uuid: "chat",
              provider_job_id: "provider_job",
              message_id: messageId,
              message_object_id: null,
            },
          }
        : {}),
    });
  }
  return record;
}

function code(
  expected: GenerationTransactionStoreErrorCode,
): (error: unknown) => boolean {
  return (error) =>
    error instanceof GenerationTransactionStoreError && error.code === expected;
}

function withPath(work: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "syntx-cancel-ledger-test-"));
  try {
    work(join(directory, "journal.sqlite"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
