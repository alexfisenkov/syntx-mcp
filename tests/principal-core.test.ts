import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockAdapter } from "../src/adapter/mock-adapter.js";
import { ApplicationCore } from "../src/application/core.js";
import { CatalogRepository, loadCatalog } from "../src/catalog/catalog.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import {
  generationPrincipalKey,
  snapshotGenerationPrincipal
} from "../src/domain/generation-principal.js";
import { ApplicationError } from "../src/errors.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  DenyAllConfirmationStore,
  InMemoryTestConfirmationStore
} from "../src/policy/confirmation-store.js";
import {
  createTestHarness,
  estimateAndConfirm,
  seedCancellation,
  testPrincipal
} from "./helpers.js";

const REQUEST = {
  model_id: "nano-banana-pro",
  operation_id: "text-to-image",
  parameters: { prompt: "A synthetic blue cube" }
};
const START = {
  ...REQUEST,
  idempotency_key: "principal_start_0001",
  confirmation_id: "confirm_principal_0001"
};

test("constructor snapshots principal and every adapter port receives its immutable full tuple", async (t) => {
  const input = testPrincipal("tenant_snapshot", "subject_original", "connection_original");
  const expected = { ...input };
  const adapter = new MockAdapter();
  const confirmations = new InMemoryTestConfirmationStore();
  const core = new ApplicationCore(
    new CatalogRepository(loadCatalog()), adapter, confirmations, input, "TEST_ONLY_MOCK"
  );
  const calls: Array<Readonly<GenerationPrincipalRef>> = [];
  const verifyCalls: Array<() => void> = [];
  for (const method of ["getBalance", "estimateGeneration"] as const) {
    const spy = t.mock.method(adapter, method);
    verifyCalls.push(() => {
      assert.ok(spy.mock.callCount() > 0, method);
      calls.push(...spy.mock.calls.map((call) => call.arguments[0]));
    });
  }
  for (const method of [
    "startGeneration", "reconcileStart", "getJob", "getResult", "cancelJob", "reconcileCancel"
  ] as const) {
    const spy = t.mock.method(adapter, method);
    verifyCalls.push(() => {
      assert.ok(spy.mock.callCount() > 0, method);
      calls.push(...spy.mock.calls.map((call) => call.arguments[0].principal));
    });
  }
  input.tenant_id = "tenant_mutated";
  input.subject_id = "subject_mutated";
  input.connection_id = "connection_mutated";
  await core.getBalance();
  const estimate = await core.estimateGeneration(REQUEST);
  confirmations.seedFromEstimate({ principal: expected, confirmation_id: START.confirmation_id, estimate });
  const first = await core.startGeneration(START);
  await core.getJob(first.job.id);
  await core.getJob(first.job.id);
  await core.getResult(first.job.id);
  confirmations.seedFromEstimate({ principal: expected, confirmation_id: "confirm_second", estimate });
  const second = await core.startGeneration({ ...START, idempotency_key: "second_start", confirmation_id: "confirm_second" });
  confirmations.seedCancellation({
    principal: expected, confirmation_id: "confirm_cancel", job_id: second.job.id,
    expires_at: new Date(Date.now() + 60_000).toISOString()
  });
  await core.cancelJob({ job_id: second.job.id, idempotency_key: "cancel_second", confirmation_id: "confirm_cancel" });
  for (const verify of verifyCalls) verify();
  for (const principal of calls) {
    assert.deepEqual(principal, expected);
    assert.notEqual(principal, input);
    assert.equal(Object.isFrozen(principal), true);
  }
});

for (const principal of [
  testPrincipal("shared_tenant", "subject_other", "connection_one"),
  testPrincipal("shared_tenant", "subject_one", "connection_other")
]) {
  test(`shared mock and approval store isolate ${principal.subject_id}/${principal.connection_id}`, async () => {
    const adapter = new MockAdapter();
    const confirmations = new InMemoryTestConfirmationStore();
    const first = createTestHarness({ adapter, confirmations, principal: testPrincipal("shared_tenant", "subject_one", "connection_one") });
    const other = createTestHarness({ adapter, confirmations, principal });
    await estimateAndConfirm(first, REQUEST, START.confirmation_id);
    await estimateAndConfirm(other, REQUEST, START.confirmation_id);
    const [a, b] = await Promise.all([first.core.startGeneration(START), other.core.startGeneration(START)]);
    assert.notEqual(a.job.id, b.job.id);
    assert.equal(a.replayed, false);
    assert.equal(b.replayed, false);
    assert.equal((await first.core.startGeneration(START)).job.id, a.job.id);
    assert.equal((await other.core.startGeneration(START)).job.id, b.job.id);
    await assert.rejects(other.core.getJob(a.job.id), hasCode("JOB_NOT_FOUND"));
    await assert.rejects(other.core.getResult(a.job.id), hasCode("JOB_NOT_FOUND"));
    const cancelId = seedCancellation(first, a.job.id, "confirm_shared_cancel");
    await assert.rejects(other.core.cancelJob({ job_id: a.job.id, idempotency_key: "shared_cancel", confirmation_id: cancelId }), hasCode("CONFIRMATION_REQUIRED"));
    assert.equal((await first.core.cancelJob({ job_id: a.job.id, idempotency_key: "shared_cancel", confirmation_id: cancelId })).job.status, "canceled");
    seedCancellation(other, b.job.id, "confirm_shared_cancel");
    assert.equal((await other.core.cancelJob({ job_id: b.job.id, idempotency_key: "shared_cancel", confirmation_id: cancelId })).job.status, "canceled");
    await assert.rejects(other.core.cancelJob({ job_id: a.job.id, idempotency_key: "shared_cancel" }), hasCode("IDEMPOTENCY_CONFLICT"));
  });
}

test("fresh-core replay needs no new approval but never inherits another connection", async (t) => {
  const adapter = new MockAdapter();
  const confirmations = new InMemoryTestConfirmationStore();
  const first = createTestHarness({ adapter, confirmations });
  await estimateAndConfirm(first, REQUEST, START.confirmation_id);
  const started = await first.core.startGeneration(START);
  const consume = t.mock.method(confirmations, "consumeGeneration");
  const dispatch = t.mock.method(adapter, "startGeneration");
  const replay = createTestHarness({ adapter, confirmations, principal: first.principal });
  const accepted = await replay.core.startGeneration(START);
  assert.equal(accepted.replayed, true);
  assert.equal(accepted.job.id, started.job.id);
  assert.equal(consume.mock.callCount(), 0);
  assert.equal(dispatch.mock.callCount(), 0);
  const relinked = createTestHarness({ adapter, confirmations, principal: { ...first.principal, connection_id: "connection_relinked" } });
  await assert.rejects(relinked.core.startGeneration(START), hasCode("CONFIRMATION_REQUIRED"));
  assert.equal(dispatch.mock.callCount(), 0);
});

test("approval hashes bind every principal field and delimiter-containing tuples stay distinct", async () => {
  const adapter = new MockAdapter();
  const base = testPrincipal("tenant:segment", "subject", "connection");
  const estimate = await adapter.estimateGeneration(base, { ...REQUEST, catalog_version: "fixture-v1" });
  const principals = [base, { ...base, tenant_id: "tenant" }, { ...base, subject_id: "other" }, { ...base, connection_id: "other" }];
  for (const store of [new DenyAllConfirmationStore(), new InMemoryTestConfirmationStore()]) {
    const hashes = principals.map((principal) => store.describeGenerationApproval(principal, estimate).binding_hash);
    assert.equal(new Set(hashes).size, principals.length);
    assert.equal(store.describeGenerationApproval({ ...base }, estimate).binding_hash, hashes[0]);
  }
  assert.notEqual(
    generationPrincipalKey(testPrincipal("a:b", "c", "d")),
    generationPrincipalKey(testPrincipal("a", "b:c", "d"))
  );
  const confirmations = new InMemoryTestConfirmationStore();
  const a = createTestHarness({ adapter, confirmations, principal: testPrincipal("a:b", "c", "d") });
  const b = createTestHarness({ adapter, confirmations, principal: testPrincipal("a", "b:c", "d") });
  await estimateAndConfirm(a, REQUEST, START.confirmation_id);
  await estimateAndConfirm(b, REQUEST, START.confirmation_id);
  const results = await Promise.all([a.core.startGeneration(START), b.core.startGeneration(START)]);
  assert.notEqual(results[0].job.id, results[1].job.id);
});

test("seeded generation and cancellation approvals retain copied principal identity", async () => {
  const harness = createTestHarness();
  const estimate = await harness.core.estimateGeneration(REQUEST);
  const mutable = { ...harness.principal };
  harness.confirmations.seedFromEstimate({ principal: mutable, confirmation_id: "confirm_copied_generation", estimate });
  harness.confirmations.seedCancellation({
    principal: mutable, confirmation_id: "confirm_copied_cancel", job_id: "job_mock_00000001",
    expires_at: new Date(Date.now() + 60_000).toISOString()
  });
  mutable.subject_id = "changed_subject";
  mutable.connection_id = "changed_connection";
  await assert.rejects(harness.confirmations.consumeGeneration({ principal: mutable, confirmation_id: "confirm_copied_generation", request_hash: estimate.request_hash }), hasCode("CONFIRMATION_REQUIRED"));
  await assert.rejects(harness.confirmations.consumeCancellation({ principal: mutable, confirmation_id: "confirm_copied_cancel", job_id: "job_mock_00000001" }), hasCode("CONFIRMATION_REQUIRED"));
  await harness.confirmations.consumeGeneration({ principal: harness.principal, confirmation_id: "confirm_copied_generation", request_hash: estimate.request_hash });
  await harness.confirmations.consumeCancellation({ principal: harness.principal, confirmation_id: "confirm_copied_cancel", job_id: "job_mock_00000001" });
});

test("same cancellation confirmation id can coexist in different principal scopes", async () => {
  const store = new InMemoryTestConfirmationStore();
  const first = testPrincipal("shared_tenant", "subject_one", "connection_one");
  const second = testPrincipal("shared_tenant", "subject_one", "connection_two");
  const common = {
    confirmation_id: "confirm_same_cancel",
    expires_at: new Date(Date.now() + 60_000).toISOString()
  };
  store.seedCancellation({ ...common, principal: first, job_id: "job_first" });
  store.seedCancellation({ ...common, principal: second, job_id: "job_second" });
  assert.equal((await store.consumeCancellation({
    principal: first, confirmation_id: common.confirmation_id, job_id: "job_first"
  })).job_id, "job_first");
  assert.equal((await store.consumeCancellation({
    principal: second, confirmation_id: common.confirmation_id, job_id: "job_second"
  })).job_id, "job_second");
});

test("invalid or accessor-based principal is rejected without reading attacker getters", () => {
  let getterCalls = 0;
  const accessor = { ...testPrincipal(), get subject_id() { getterCalls += 1; return "getter_subject"; } };
  for (const value of [
    null, "tenant_only", { tenant_id: "tenant" }, { ...testPrincipal(), connection_id: "bad/id" },
    { ...testPrincipal(), subject_id: "bad\u0000subject" }, { ...testPrincipal(), extra: true }, accessor,
    new Proxy(testPrincipal(), { get() { throw new Error("untrusted details"); } })
  ]) {
    assert.throws(() => new ApplicationCore(
      new CatalogRepository(loadCatalog()), new MockAdapter(), new DenyAllConfirmationStore(),
      value as GenerationPrincipalRef, "TEST_ONLY_MOCK"
    ), hasCode("INVALID_PARAMETERS"));
  }
  assert.equal(getterCalls, 0);
  assert.deepEqual(snapshotGenerationPrincipal(testPrincipal("tenant@example.test", "subject:alpha", "link_valid")), {
    tenant_id: "tenant@example.test", subject_id: "subject:alpha", connection_id: "link_valid"
  });
});

test("model-callable tools reject forged principal and scope fields before entering core", async (t) => {
  const harness = createTestHarness();
  const balance = t.mock.method(harness.core, "getBalance");
  const start = t.mock.method(harness.core, "startGeneration");
  const result = t.mock.method(harness.core, "getResult");
  const server = createMcpServer(harness.core);
  const client = new Client({ name: "principal-input-contract", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    for (const extra of [
      { principal: testPrincipal("attacker") }, { tenant_id: "attacker" },
      { subject_id: "attacker" }, { connection_id: "attacker" }, { attempt_id: "link_attacker" }
    ]) {
      for (const [name, arguments_] of [
        ["syntx_get_balance", {}], ["syntx_start_generation", START],
        ["syntx_get_result", { job_id: "job_mock_00000001" }]
      ] as const) {
        const response = await client.callTool({ name, arguments: { ...arguments_, ...extra } });
        assert.equal(response.isError, true, `${name}: forged scope must be rejected`);
      }
    }
    assert.equal(balance.mock.callCount(), 0);
    assert.equal(start.mock.callCount(), 0);
    assert.equal(result.mock.callCount(), 0);
  } finally {
    await client.close();
    await server.close();
  }
});

function hasCode(code: ApplicationError["code"]) {
  return (error: unknown): boolean => error instanceof ApplicationError && error.code === code;
}
