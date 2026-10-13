import assert from "node:assert/strict";
import test from "node:test";
import { MockAdapter } from "../src/adapter/mock-adapter.js";
import type {
  GenerationJob,
  GenerationRequest
} from "../src/domain/types.js";
import { ApplicationError } from "../src/errors.js";
import type {
  CancelJobContext,
  StartGenerationContext
} from "../src/adapter/upstream-adapter.js";
import {
  DenyAllConfirmationStore,
  InMemoryTestConfirmationStore
} from "../src/policy/confirmation-store.js";
import {
  createTestHarness,
  estimateAndConfirm,
  seedCancellation,
  testPrincipal,
  TEST_TENANT_ID
} from "./helpers.js";

const nanoRequest = {
  model_id: "nano-banana-pro",
  operation_id: "text-to-image",
  parameters: { prompt: "A small yellow house" }
};

test("rejects missing, unknown, and unsupported dynamic parameters", async () => {
  const { core } = createTestHarness();

  await assert.rejects(
    core.estimateGeneration({ ...nanoRequest, parameters: {} }),
    hasCode("INVALID_PARAMETERS")
  );
  await assert.rejects(
    core.estimateGeneration({
      ...nanoRequest,
      parameters: { prompt: "ok", hidden_setting: true }
    }),
    hasCode("INVALID_PARAMETERS")
  );
  await assert.rejects(
    core.estimateGeneration({
      model_id: "veo-omni-flash",
      operation_id: "text-to-video",
      parameters: { prompt: "test", quality: "8K" }
    }),
    hasCode("INVALID_PARAMETERS")
  );
});

test("estimate exposes only safe parameter metadata while binding the full request internally", async () => {
  const harness = createTestHarness();
  const { core } = harness;
  const estimate = await core.estimateGeneration({
    model_id: "veo-omni-flash",
    operation_id: "text-to-video",
    parameters: { quality: "720p", prompt: "A quiet lake" }
  });

  assert.match(estimate.estimate_id, /^estimate_mock_/);
  assert.match(estimate.request_hash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(estimate.parameter_keys, ["prompt", "quality"]);
  assert.equal(estimate.parameters_redacted, true);
  assert.equal("normalized_parameters" in estimate, false);
  assert.equal(estimate.cost.maximum, 1);
  assert.ok(Date.parse(estimate.expires_at) > Date.now());
  assert.equal(estimate.approval.status, "test_only");
  assert.equal(estimate.approval.approval_url, null);
  assert.match(estimate.approval.reference, /^urn:syntx-mcp:test-approval:/);
  assert.match(estimate.approval.binding_hash, /^sha256:[a-f0-9]{64}$/);

  const internalEstimate = await harness.adapter.estimateGeneration(
    harness.principal,
    {
      model_id: "veo-omni-flash",
      operation_id: "text-to-video",
      parameters: { prompt: "A quiet lake", quality: "720p" },
      catalog_version: estimate.catalog_version
    }
  );
  const deniedReference =
    new DenyAllConfirmationStore().describeGenerationApproval(
      harness.principal,
      internalEstimate
    );
  assert.equal(deniedReference.status, "unavailable");
  assert.equal(deniedReference.approval_url, null);
  assert.match(deniedReference.binding_hash, /^sha256:[a-f0-9]{64}$/);
});

test("start rejects missing, expired, mismatched, and reused confirmations", async () => {
  const missing = createTestHarness();
  await assert.rejects(
    missing.core.startGeneration({
      ...nanoRequest,
      idempotency_key: "request-0001",
      confirmation_id: "confirm_missing_0001"
    }),
    hasCode("CONFIRMATION_REQUIRED")
  );

  const expiryClock = () => new Date("2999-01-01T00:00:00.000Z");
  const expired = createTestHarness({
    confirmations: new InMemoryTestConfirmationStore(expiryClock)
  });
  const expiredApproval = await estimateAndConfirm(
    expired,
    nanoRequest,
    "confirm_expired_0001"
  );
  await assert.rejects(
    expired.core.startGeneration({
      ...nanoRequest,
      idempotency_key: "request-0002",
      confirmation_id: expiredApproval.confirmationId
    }),
    hasCode("CONFIRMATION_EXPIRED")
  );

  const mismatch = createTestHarness();
  const mismatchApproval = await estimateAndConfirm(
    mismatch,
    nanoRequest,
    "confirm_mismatch_0001"
  );
  await assert.rejects(
    mismatch.core.startGeneration({
      ...nanoRequest,
      parameters: { prompt: "A different request" },
      idempotency_key: "request-0003",
      confirmation_id: mismatchApproval.confirmationId
    }),
    hasCode("CONFIRMATION_MISMATCH")
  );

  const reused = createTestHarness();
  const reusedApproval = await estimateAndConfirm(
    reused,
    nanoRequest,
    "confirm_reused_000001"
  );
  await reused.core.startGeneration({
    ...nanoRequest,
    idempotency_key: "request-0004",
    confirmation_id: reusedApproval.confirmationId
  });
  await assert.rejects(
    reused.core.startGeneration({
      ...nanoRequest,
      idempotency_key: "request-0005",
      confirmation_id: reusedApproval.confirmationId
    }),
    hasCode("CONFIRMATION_ALREADY_USED")
  );
});

test("idempotent concurrent retries call the adapter only once", async () => {
  class CountingMockAdapter extends MockAdapter {
    startCalls = 0;

    override async startGeneration(
      context: StartGenerationContext,
      request: GenerationRequest
    ): Promise<GenerationJob> {
      this.startCalls += 1;
      return super.startGeneration(context, request);
    }
  }

  const adapter = new CountingMockAdapter();
  const harness = createTestHarness({ adapter });
  const approval = await estimateAndConfirm(
    harness,
    nanoRequest,
    "confirm_idempotent_01"
  );
  const input = {
    ...nanoRequest,
    idempotency_key: "request-same-0001",
    confirmation_id: approval.confirmationId
  };

  const [first, second] = await Promise.all([
    harness.core.startGeneration(input),
    harness.core.startGeneration(input)
  ]);
  assert.equal(first.job.id, second.job.id);
  assert.deepEqual(new Set([first.replayed, second.replayed]), new Set([false, true]));
  assert.equal(adapter.startCalls, 1);

  await assert.rejects(
    harness.core.startGeneration({
      ...input,
      parameters: { prompt: "different" }
    }),
    hasCode("IDEMPOTENCY_CONFLICT")
  );
});

test("unknown committed start is reconciled by idempotency key without double spend", async () => {
  const adapter = new MockAdapter({ unknownAfterCommitOnce: true });
  const harness = createTestHarness({ adapter });
  const approval = await estimateAndConfirm(
    harness,
    nanoRequest,
    "confirm_unknown_00001"
  );
  const input = {
    ...nanoRequest,
    idempotency_key: "request-unknown-001",
    confirmation_id: approval.confirmationId
  };

  await assert.rejects(
    harness.core.startGeneration(input),
    hasCode("UPSTREAM_OUTCOME_UNKNOWN")
  );
  const reconciled = await harness.core.startGeneration(input);
  assert.equal(reconciled.replayed, true);
  assert.equal(reconciled.job.id, "job_mock_00000001");
});

test("pre-commit start failure needs fresh approval but can safely reuse idempotency key", async () => {
  const adapter = new MockAdapter({ failBeforeCommitOnce: true });
  const harness = createTestHarness({ adapter });
  const firstApproval = await estimateAndConfirm(
    harness,
    nanoRequest,
    "confirm_failure_00001"
  );
  const baseInput = {
    ...nanoRequest,
    idempotency_key: "request-failure-001"
  };

  await assert.rejects(
    harness.core.startGeneration({
      ...baseInput,
      confirmation_id: firstApproval.confirmationId
    }),
    hasCode("UPSTREAM_START_FAILED")
  );
  await assert.rejects(
    harness.core.startGeneration({
      ...baseInput,
      confirmation_id: firstApproval.confirmationId
    }),
    hasCode("CONFIRMATION_ALREADY_USED")
  );

  const secondApproval = await estimateAndConfirm(
    harness,
    nanoRequest,
    "confirm_failure_00002"
  );
  const recovered = await harness.core.startGeneration({
    ...baseInput,
    confirmation_id: secondApproval.confirmationId
  });
  assert.equal(recovered.replayed, false);
  assert.equal(recovered.job.id, "job_mock_00000001");
});

test("portable polling, result, and explicit cancellation flows work in mock", async () => {
  const completed = createTestHarness();
  const completedApproval = await estimateAndConfirm(
    completed,
    nanoRequest,
    "confirm_complete_0001"
  );
  const started = await completed.core.startGeneration({
    ...nanoRequest,
    idempotency_key: "request-complete-01",
    confirmation_id: completedApproval.confirmationId
  });
  await assert.rejects(
    completed.core.getResult(started.job.id),
    hasCode("JOB_NOT_READY")
  );
  assert.equal((await completed.core.getJob(started.job.id)).status, "running");
  assert.equal((await completed.core.getJob(started.job.id)).status, "succeeded");
  const result = await completed.core.getResult(started.job.id);
  assert.equal(result.job_id, started.job.id);
  assert.equal(result.artifacts[0]?.download_url, null);

  const canceled = createTestHarness();
  const canceledApproval = await estimateAndConfirm(
    canceled,
    nanoRequest,
    "confirm_cancel_000001"
  );
  const cancelJob = await canceled.core.startGeneration({
    ...nanoRequest,
    idempotency_key: "request-cancel-0001",
    confirmation_id: canceledApproval.confirmationId
  });
  await assert.rejects(
    canceled.core.cancelJob({
      job_id: cancelJob.job.id,
      idempotency_key: "cancel-missing-0001",
      confirmation_id: "confirm_missing_cancel"
    }),
    hasCode("CONFIRMATION_REQUIRED")
  );
  const wrongJobConfirmation = seedCancellation(
    canceled,
    "job_mock_99999999",
    "confirm_cancel_wrong_01"
  );
  await assert.rejects(
    canceled.core.cancelJob({
      job_id: cancelJob.job.id,
      idempotency_key: "cancel-wrong-000001",
      confirmation_id: wrongJobConfirmation
    }),
    hasCode("CONFIRMATION_MISMATCH")
  );
  const cancelConfirmation = seedCancellation(
    canceled,
    cancelJob.job.id,
    "confirm_cancel_valid_01"
  );
  const firstCancel = await canceled.core.cancelJob({
    job_id: cancelJob.job.id,
    idempotency_key: "cancel-valid-000001",
    confirmation_id: cancelConfirmation
  });
  assert.equal(firstCancel.job.status, "canceled");
  assert.equal(firstCancel.replayed, false);
  const replayedCancel = await canceled.core.cancelJob({
    job_id: cancelJob.job.id,
    idempotency_key: "cancel-valid-000001"
  });
  assert.equal(replayedCancel.job.status, "canceled");
  assert.equal(replayedCancel.replayed, true);

  const wrongPurposeApproval = await canceled.core.estimateGeneration(nanoRequest);
  canceled.confirmations.seedFromEstimate({
    principal: canceled.principal,
    confirmation_id: "confirm_cancel_purpose_1",
    estimate: wrongPurposeApproval
  });
  await assert.rejects(
    canceled.core.cancelJob({
      job_id: cancelJob.job.id,
      idempotency_key: "cancel-purpose-0001",
      confirmation_id: "confirm_cancel_purpose_1"
    }),
    hasCode("CONFIRMATION_MISMATCH")
  );
});

test("concurrent cancel retries share one in-flight attempt and conflict across jobs", async () => {
  class CountingMockAdapter extends MockAdapter {
    cancelCalls = 0;

    override async cancelJob(context: CancelJobContext): Promise<GenerationJob> {
      this.cancelCalls += 1;
      return super.cancelJob(context);
    }
  }

  const adapter = new CountingMockAdapter();
  const harness = createTestHarness({ adapter });
  const approval = await estimateAndConfirm(
    harness,
    nanoRequest,
    "confirm_cancel_concurrent_start"
  );
  const started = await harness.core.startGeneration({
    ...nanoRequest,
    idempotency_key: "request-cancel-concurrent",
    confirmation_id: approval.confirmationId
  });
  const confirmationId = seedCancellation(
    harness,
    started.job.id,
    "confirm_cancel_concurrent"
  );
  const input = {
    job_id: started.job.id,
    idempotency_key: "cancel-concurrent-0001",
    confirmation_id: confirmationId
  };

  const [first, second] = await Promise.all([
    harness.core.cancelJob(input),
    harness.core.cancelJob(input)
  ]);
  assert.equal(first.job.id, second.job.id);
  assert.deepEqual(new Set([first.replayed, second.replayed]), new Set([false, true]));
  assert.equal(adapter.cancelCalls, 1);

  await assert.rejects(
    harness.core.cancelJob({
      job_id: "job_mock_99999999",
      idempotency_key: input.idempotency_key
    }),
    hasCode("IDEMPOTENCY_CONFLICT")
  );
});

test("unknown committed cancel reconciles without a second confirmation or duplicate action", async () => {
  const adapter = new MockAdapter({ cancelUnknownAfterCommitOnce: true });
  const harness = createTestHarness({ adapter });
  const approval = await estimateAndConfirm(
    harness,
    nanoRequest,
    "confirm_cancel_unknown_start"
  );
  const started = await harness.core.startGeneration({
    ...nanoRequest,
    idempotency_key: "request-cancel-unknown",
    confirmation_id: approval.confirmationId
  });
  const confirmationId = seedCancellation(
    harness,
    started.job.id,
    "confirm_cancel_unknown"
  );

  await assert.rejects(
    harness.core.cancelJob({
      job_id: started.job.id,
      idempotency_key: "cancel-unknown-00001",
      confirmation_id: confirmationId
    }),
    hasCode("UPSTREAM_OUTCOME_UNKNOWN")
  );
  const recovered = await harness.core.cancelJob({
    job_id: started.job.id,
    idempotency_key: "cancel-unknown-00001"
  });
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.job.status, "canceled");
});

test("invalid expiry fails closed instead of consuming confirmation", async () => {
  const harness = createTestHarness();
  const approval = await estimateAndConfirm(
    harness,
    nanoRequest,
    "confirm_invalid_expiry_start"
  );
  const started = await harness.core.startGeneration({
    ...nanoRequest,
    idempotency_key: "request-invalid-expiry",
    confirmation_id: approval.confirmationId
  });
  const confirmationId = seedCancellation(
    harness,
    started.job.id,
    "confirm_invalid_expiry_cancel",
    "not-a-date"
  );

  await assert.rejects(
    harness.core.cancelJob({
      job_id: started.job.id,
      idempotency_key: "cancel-invalid-expiry",
      confirmation_id: confirmationId
    }),
    hasCode("CONFIRMATION_EXPIRED")
  );
});

test("mock adapter rejects a start above the approved hard cap before committing", async () => {
  const harness = createTestHarness();
  const estimate = await harness.core.estimateGeneration(nanoRequest);
  harness.confirmations.seedFromEstimate({
    principal: harness.principal,
    confirmation_id: "confirm_cost_cap_zero",
    estimate: {
      ...estimate,
      cost: { ...estimate.cost, maximum: 0 }
    }
  });

  await assert.rejects(
    harness.core.startGeneration({
      ...nanoRequest,
      idempotency_key: "request-cost-cap-0001",
      confirmation_id: "confirm_cost_cap_zero"
    }),
    hasCode("COST_CAP_EXCEEDED")
  );

  const retryApproval = await estimateAndConfirm(
    harness,
    nanoRequest,
    "confirm_cost_cap_retry"
  );
  const started = await harness.core.startGeneration({
    ...nanoRequest,
    idempotency_key: "request-cost-cap-0001",
    confirmation_id: retryApproval.confirmationId
  });
  assert.equal(started.job.id, "job_mock_00000001");
});

test("confirmation cannot cross tenant boundaries", async () => {
  const harness = createTestHarness();
  const approval = await estimateAndConfirm(
    harness,
    nanoRequest,
    "confirm_tenant_000001"
  );
  await assert.rejects(
    harness.confirmations.consumeGeneration({
      principal: testPrincipal(`${TEST_TENANT_ID}_other`),
      confirmation_id: approval.confirmationId,
      request_hash: approval.estimate.request_hash
    }),
    hasCode("CONFIRMATION_REQUIRED")
  );
});

function hasCode(code: ApplicationError["code"]) {
  return (error: unknown): boolean =>
    error instanceof ApplicationError && error.code === code;
}
