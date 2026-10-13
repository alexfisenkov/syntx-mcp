import assert from "node:assert/strict";
import test from "node:test";
import { ComplianceBlockedAdapter } from "../src/adapter/compliance-blocked-adapter.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { ApplicationError } from "../src/errors.js";
import { testPrincipal } from "./helpers.js";

const request = {
  model_id: "nano-banana-pro",
  operation_id: "text-to-image",
  parameters: { prompt: "test" },
  catalog_version: "2026-09-02.public-sample.1"
};

test("production adapter fails every upstream method closed", async () => {
  const adapter = new ComplianceBlockedAdapter();
  const operations = [
    adapter.getBalance(testPrincipal("tenant")),
    adapter.estimateGeneration(testPrincipal("tenant"), request),
    adapter.startGeneration(
      {
        principal: testPrincipal("tenant"),
        idempotency_key: "request-0001",
        confirmation_id: "confirm_test_00000001",
        approved_max_cost_tokens: 1
      },
      request
    ),
    adapter.reconcileStart({
      principal: testPrincipal("tenant"),
      idempotency_key: "request-0001",
      request_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    }),
    adapter.getJob({ principal: testPrincipal("tenant"), job_id: "job_test_00000001" }),
    adapter.cancelJob({
      principal: testPrincipal("tenant"),
      job_id: "job_test_00000001",
      idempotency_key: "cancel-0001",
      confirmation_id: "confirm_cancel_00000001"
    }),
    adapter.reconcileCancel({
      principal: testPrincipal("tenant"),
      job_id: "job_test_00000001",
      idempotency_key: "cancel-0001"
    }),
    adapter.getResult({ principal: testPrincipal("tenant"), job_id: "job_test_00000001" })
  ];

  for (const operation of operations) {
    await assert.rejects(operation, (error: unknown) => {
      return (
        error instanceof ApplicationError &&
        error.code === "COMPLIANCE_GATE_BLOCKED"
      );
    });
  }
});

test("default application can read local catalog but cannot use upstream", async () => {
  const application = createDefaultApplication();
  const discovery = application.searchModels({ limit: 20 });
  assert.equal(discovery.catalog_kind, "OFFICIAL_PUBLIC_API_SNAPSHOT");
  assert.equal(discovery.runtime_usable, false);
  assert.equal(discovery.total, 172);
  assert.equal(discovery.models.length, 20);
  assert.ok(discovery.next_cursor);
  const officialModel = application.getModel("banana3_light");
  assert.equal(officialModel.catalog_kind, "OFFICIAL_PUBLIC_API_SNAPSHOT");
  assert.equal(officialModel.model.id, "banana3_light");
  await assert.rejects(
    application.estimateGeneration({
      model_id: "banana3_light",
      operation_id: "generate-image",
      parameters: { prompt: "test" }
    }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "COMPLIANCE_GATE_BLOCKED"
  );
  await assert.rejects(application.getBalance(), (error: unknown) => {
    return (
      error instanceof ApplicationError &&
      error.code === "COMPLIANCE_GATE_BLOCKED"
    );
  });
  await assert.rejects(
    application.startGeneration({
      model_id: "nano-banana-pro",
      operation_id: "text-to-image",
      parameters: { prompt: "test" },
      idempotency_key: "request-0001",
      confirmation_id: "confirm_test_00000001"
    }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "COMPLIANCE_GATE_BLOCKED"
  );
});
