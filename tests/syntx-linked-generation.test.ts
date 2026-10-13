import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createLinkedGenerationAdapter } from "../src/adapter/syntx/linked-generation.js";
import { SyntxUpstreamAdapter } from "../src/adapter/syntx/upstream-adapter.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { ApplicationCore } from "../src/application/core.js";
import { hashGenerationRequest } from "../src/application/generation-request.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import { snapshotGenerationPrincipal, generationPrincipalKey } from "../src/domain/generation-principal.js";
import { SqliteGenerationTransactionStore } from "../src/storage/sqlite-generation-transaction-store.js";
import { createTestHarness, estimateAndConfirm } from "./helpers.js";

const BINDING = { tenant_id: "shared_test_tenant", subject: "first_test_subject" };
const INPUT = { model_id: "nano-banana-pro", operation_id: "text-to-image", parameters: { prompt: "Synthetic local identity test" } };
const hasCode = (code: string) => (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;

async function harness(t: TestContext) {
  const store = new SqliteGenerationTransactionStore(":memory:");
  t.after(() => store.close());
  const authStore = new InMemoryAuthLinkStore();
  let next = 0;
  let polls = 0;
  const service = new PerUserLinkService({
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic_upstream_attempt", approval_url: "https://t.me/syntxaibot" }; },
    async pollChallenge(_id, receive) { polls += 1; await receive({ scheme: "Bearer", value: "YOUR_SYNTHETIC_TEST_CREDENTIAL" }); return { state: "LINKED" }; }
  }, authStore, { attemptIdGenerator: () => `link_synthetic_attempt_${String(++next).padStart(8, "0")}` });
  async function link(binding: AuthBinding) {
    const attempt = await service.createAttempt(binding);
    await service.issueHandoff(binding, attempt.attempt_id);
    await service.checkAttempt(binding, attempt.attempt_id);
    return attempt.attempt_id;
  }
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    seen.push(`${init?.method ?? "GET"} ${String(url)}`);
    // Read only synthetic material; never retained in a log or returned.
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer YOUR_SYNTHETIC_TEST_CREDENTIAL");
    if (String(url).endsWith("/chats")) return Response.json({ uuid: "synthetic_chat" });
    if (String(url).includes("/design/generate?")) return Response.json({ id: 72 });
    if (String(url).endsWith("/cancel")) return new Response(null, { status: 204 });
    return Response.json({ id: 72, completed: false, message_object: [] });
  };
  const options = { transactionStore: store, linkService: service, resolveAiName: () => "banana", resolveModality: () => "image" as const, fetchImpl };
  const attemptId = await link(BINDING);
  const linked = await createLinkedGenerationAdapter({ ...options, binding: BINDING, attemptId });
  const fixture = createTestHarness({ principal: linked.principal });
  const approval = await estimateAndConfirm(fixture, INPUT);
  const core = new ApplicationCore(fixture.core.catalog, linked.adapter, fixture.confirmations, linked.principal, "TEST_ONLY_MOCK");
  const start = { ...INPUT, idempotency_key: "identity_start_key", confirmation_id: approval.confirmationId };
  const request = { ...INPUT, catalog_version: approval.estimate.catalog_version };
  const context = { principal: linked.principal, idempotency_key: start.idempotency_key, confirmation_id: approval.confirmationId, approved_max_cost_tokens: approval.estimate.cost.maximum };
  return { store, service, linked, options, link, core, fixture, start, request, context, seen, polls: () => polls };
}

test("exact link composition runs Core + approval + SQLite + HTTP and preserves local replay after revoke", async (t) => {
  const f = await harness(t);
  const result = await f.core.startGeneration(f.start);
  const record = f.store.getById(f.linked.principal, result.job.id)!;
  assert.deepEqual(record.principal, f.linked.principal);
  assert.equal(record.cost.cap_enforcement, "UNENFORCEABLE");
  assert.equal(f.seen.length, 2);
  await f.service.revoke(BINDING, f.linked.principal.connection_id);
  const reconstructed = await createLinkedGenerationAdapter({ ...f.options, binding: BINDING, attemptId: f.linked.principal.connection_id });
  const fresh = new ApplicationCore(f.fixture.core.catalog, reconstructed.adapter, f.fixture.confirmations, reconstructed.principal, "TEST_ONLY_MOCK");
  assert.equal((await fresh.startGeneration(f.start)).job.id, result.job.id);
  assert.equal(f.seen.length, 2, "durable replay must not resolve credentials or repeat POST");
  assert.equal(f.polls(), 1, "composition/replay never polls auth");
  await assert.rejects(reconstructed.adapter.getJob({ principal: reconstructed.principal, job_id: result.job.id }));
  assert.equal(f.seen.length, 2, "revoke prevents next upstream read");
});

test("relink is a new connection; no old replay, job/result/cancel access or reassociation", async (t) => {
  const f = await harness(t);
  const first = await f.core.startGeneration(f.start);
  const newAttempt = await f.link(BINDING);
  const newer = await createLinkedGenerationAdapter({ ...f.options, binding: BINDING, attemptId: newAttempt });
  assert.notEqual(newer.principal.connection_id, f.linked.principal.connection_id);
  const recordBefore = f.store.getById(f.linked.principal, first.job.id);
  await assert.rejects(newer.adapter.reconcileStart({ principal: newer.principal, idempotency_key: f.start.idempotency_key, request_hash: hashGenerationRequest(f.request) }), hasCode("IDEMPOTENCY_CONFLICT"));
  await assert.rejects(newer.adapter.startGeneration({ ...f.context, principal: newer.principal }, f.request), hasCode("IDEMPOTENCY_CONFLICT"));
  const jobContext = { principal: newer.principal, job_id: first.job.id };
  await assert.rejects(newer.adapter.getJob(jobContext), hasCode("JOB_NOT_FOUND"));
  await assert.rejects(newer.adapter.getResult(jobContext), hasCode("JOB_NOT_FOUND"));
  await assert.rejects(newer.adapter.cancelJob({ ...jobContext, idempotency_key: "cancel_key", confirmation_id: "cancel_approval" }), hasCode("JOB_NOT_FOUND"));
  await assert.rejects(newer.adapter.reconcileCancel({ ...jobContext, idempotency_key: "cancel_key" }), hasCode("JOB_NOT_FOUND"));
  assert.deepEqual(f.store.getById(f.linked.principal, first.job.id), recordBefore);
  assert.equal(f.seen.length, 2);
});

for (const state of ["PROVIDER_ACCEPTED", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED", "TERMINAL_UNRESOLVED"] as const) {
  test(`unbound shared adapter guards ${state} receipts against another connection before every replay`, async (t) => {
    const f = await harness(t);
    const started = await f.core.startGeneration(f.start);
    const original = f.store.getById(f.linked.principal, started.job.id)!;
    if (state === "TERMINAL_UNRESOLVED") {
      // Use a distinct locally prepared unknown record, never forge a provider result.
      const candidate = { ...original, id: "synthetic_unknown_operation", idempotency_key: "unknown_key", state: "PREPARED" as const, receipt: null, revision: 0 };
      f.store.createOrReplay(candidate);
      for (const nextState of ["CHAT_CREATING", "CHAT_CREATE_OUTCOME_UNKNOWN", "TERMINAL_UNRESOLVED"] as const) {
        const current = f.store.getById(candidate.principal, candidate.id)!;
        f.store.transition({ owner: candidate.principal, id: candidate.id, expected_revision: current.revision, to_state: nextState, updated_at: current.updated_at,
          ...(nextState === "TERMINAL_UNRESOLVED" ? { failure_code: "SYNTHETIC_UNRESOLVED" } : {}) });
      }
      original.id = candidate.id;
      original.idempotency_key = candidate.idempotency_key;
    } else if (state !== "PROVIDER_ACCEPTED") {
      f.store.transition({ owner: original.principal, id: original.id, expected_revision: original.revision, to_state: state, updated_at: original.updated_at,
        ...(state === "FAILED" ? { failure_code: "SYNTHETIC_FAILURE" } : {}) });
    }
    let resolutions = 0;
    const adapter = new SyntxUpstreamAdapter({ transactionStore: f.store, resolveChatClient: () => { resolutions += 1; throw new Error("must not resolve a different connection"); }, resolveAiName: () => "banana", resolveModality: () => "image" });
    const other = { ...f.linked.principal, connection_id: "link_different_connection_0001" };
    const ctx = { principal: other, job_id: original.id, idempotency_key: "cancel_key", confirmation_id: "cancel_approval" };
    await assert.rejects(adapter.reconcileStart({ principal: other, idempotency_key: original.idempotency_key, request_hash: original.request_hash }), hasCode("IDEMPOTENCY_CONFLICT"));
    await assert.rejects(adapter.getJob(ctx), hasCode("JOB_NOT_FOUND"));
    await assert.rejects(adapter.getResult(ctx), hasCode("JOB_NOT_FOUND"));
    await assert.rejects(adapter.reconcileCancel(ctx), hasCode("JOB_NOT_FOUND"));
    await assert.rejects(adapter.cancelJob(ctx), hasCode("JOB_NOT_FOUND"));
    assert.equal(resolutions, 0);
  });
}

test("another subject cannot use a link, ledger job or acknowledged cancellation in the same tenant", async (t) => {
  const f = await harness(t);
  await assert.rejects(createLinkedGenerationAdapter({ ...f.options, binding: { ...BINDING, subject: "other_subject" }, attemptId: f.linked.principal.connection_id }), hasCode("AUTH_LINK_NOT_FOUND"));
  const result = await f.core.startGeneration(f.start);
  const ctx = { principal: f.linked.principal, job_id: result.job.id, idempotency_key: "cancel_scope_key", confirmation_id: "synthetic_cancel_confirmation" };
  await f.linked.adapter.cancelJob(ctx);
  assert.equal(f.store.getCancelAttempt(f.linked.principal, result.job.id)?.state, "ACKNOWLEDGED");
  let resolutions = 0;
  const adapter = new SyntxUpstreamAdapter({ transactionStore: f.store, resolveChatClient: () => { resolutions += 1; throw new Error("unexpected resolution"); }, resolveAiName: () => "banana", resolveModality: () => "image" });
  for (const principal of [
    { ...f.linked.principal, subject_id: "other_subject" },
    { ...f.linked.principal, connection_id: "link_other_connection_0001" }
  ]) {
    const foreign = { ...ctx, principal };
    await assert.rejects(adapter.getJob(foreign), hasCode("JOB_NOT_FOUND"));
    await assert.rejects(adapter.getResult(foreign), hasCode("JOB_NOT_FOUND"));
    await assert.rejects(adapter.reconcileCancel(foreign), hasCode("JOB_NOT_FOUND"));
    await assert.rejects(adapter.cancelJob(foreign), hasCode("JOB_NOT_FOUND"));
  }
  assert.equal(resolutions, 0);
  assert.equal(f.seen.length, 3);
});

test("composer snapshots caller binding and enforces its principal before journal writes", async (t) => {
  const f = await harness(t);
  const binding = { ...BINDING };
  const pending = createLinkedGenerationAdapter({ ...f.options, binding, attemptId: f.linked.principal.connection_id });
  binding.subject = "mutated_subject";
  const scoped = await pending;
  assert.deepEqual(scoped.principal, f.linked.principal);
  assert.ok(Object.isFrozen(scoped.principal));
  const wrong = { ...scoped.principal, subject_id: "wrong_subject" };
  await assert.rejects(scoped.adapter.startGeneration({ ...f.context, principal: wrong }, f.request), hasCode("INVALID_PARAMETERS"));
  assert.equal(f.store.getByIdempotencyKey(wrong, f.start.idempotency_key), null);
  assert.equal(f.seen.length, 0);
});

test("principal validation rejects missing, extra, proxy and accessor identities without invoking accessors", () => {
  let reads = 0;
  const good = { tenant_id: "t", subject_id: "s", connection_id: "c" };
  const accessor = { ...good, get subject_id() { reads += 1; return "s"; } };
  const proxy = new Proxy(good, { ownKeys() { reads += 1; return Reflect.ownKeys(good); } });
  for (const input of [undefined, "tenant", {}, { ...good, extra: true }, { ...good, connection_id: "bad/id" }, { ...good, subject_id: "bad\u0000id" }, accessor, proxy]) {
    assert.throws(() => snapshotGenerationPrincipal(input as GenerationPrincipalRef), hasCode("INVALID_PARAMETERS"));
  }
  assert.equal(reads, 0);
  assert.notEqual(generationPrincipalKey({ ...good, tenant_id: "a:b", subject_id: "c" }), generationPrincipalKey({ ...good, tenant_id: "a", subject_id: "b:c" }));
});

for (const status of ["CHALLENGE_CREATED", "HANDOFF_ISSUED", "POLLING", "EXPIRED", "FAILED_RETRYABLE", "FAILED_TERMINAL"] as const) {
  test(`composer rejects ${status} before journal, approval or upstream I/O`, async (t) => {
    const f = await harness(t);
    const original = await f.service.getStatus(BINDING, f.linked.principal.connection_id);
    t.mock.method(f.service, "getStatus", async () => ({ ...original, status, linked: false }));
    const journal = t.mock.method(f.store, "createOrReplay");
    const approval = t.mock.method(f.fixture.confirmations, "consumeGeneration");
    await assert.rejects(createLinkedGenerationAdapter({ ...f.options, binding: BINDING, attemptId: f.linked.principal.connection_id }), hasCode("AUTH_LINK_INVALID_STATE"));
    assert.equal(journal.mock.callCount(), 0);
    assert.equal(approval.mock.callCount(), 0);
    assert.equal(f.seen.length, 0);
    assert.equal(f.polls(), 1, "composer does not poll authentication");
  });
}
