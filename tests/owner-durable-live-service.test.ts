import assert from "node:assert/strict";
import test from "node:test";
import { OwnerDurableLiveGenerationService } from "../src/application/owner-durable-live-generation-service.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import type { OwnerDurableSessionManager } from "../src/runtime/owner-durable-session-manager.js";

test("live service snapshots JSON arrays with canonical own indices", async () => {
  const registry = loadGenerationContractRegistryV2(
    "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json",
    `${process.cwd()}/catalog`
  );
  let captured: unknown;
  let contextRequests = 0;
  const manager = {
    async getContext() {
      contextRequests += 1;
      return {
        mode: "OWNER_LIVE" as const,
        async readJob() { throw new Error("unused"); },
        async readResult() { throw new Error("unused"); },
        async startGeneration(request: unknown) {
          captured = request;
          return { id: "job-1", model_id: "banana-2.1", operation_id: "generate-image", catalog_version: "catalog-v", status: "queued", created_at: "2026-10-09T00:00:00.000Z", updated_at: "2026-10-09T00:00:00.000Z" };
        }
      };
    },
    async readJob() { throw new Error("unused"); },
    async readResult() { throw new Error("unused"); }
  } as unknown as OwnerDurableSessionManager;
  const service = new OwnerDurableLiveGenerationService(manager, registry, registry.catalog_version);

  await service.start({
    link_attempt_id: "link_owner_durable_live_attempt01",
    model_id: "banana-2.1",
    operation_id: "generate-image",
    variant_id: "banana21-image-1k-minimal-square",
    parameters: { prompt: "array snapshot", references: ["opaque-1", "opaque-2"] },
    idempotency_key: "array-snapshot-1"
  });

  assert.deepEqual((captured as { parameters: unknown }).parameters, { prompt: "array snapshot", references: ["opaque-1", "opaque-2"] });

  const deep: Record<string, unknown> = {};
  let cursor = deep;
  for (let index = 0; index < 12; index++) { const child: Record<string, unknown> = {}; cursor.child = child; cursor = child; }
  await assert.rejects(service.start({
    link_attempt_id: "link_owner_durable_live_attempt01", model_id: "banana-2.1", operation_id: "generate-image",
    variant_id: "banana21-image-1k-minimal-square", parameters: deep, idempotency_key: "too-deep-1"
  }), (error: unknown) => (error as { code?: string }).code === "OWNER_LIVE_UNAVAILABLE");
  assert.equal(contextRequests, 1, "iterative bounds reject deep JSON before manager context creation");

  const repeatedStrings = Array.from({ length: 20 }, () => "y".repeat(7_000));
  const defineProperty = Object.defineProperty;
  let copyStarted = false;
  Object.defineProperty = ((target: object, key: PropertyKey, descriptor: PropertyDescriptor) => {
    if (key === "prompt" && descriptor.value === "aggregate-byte-bound") copyStarted = true;
    return defineProperty(target, key, descriptor);
  }) as typeof Object.defineProperty;
  try {
    await assert.rejects(service.start({
      link_attempt_id: "link_owner_durable_live_attempt01", model_id: "banana-2.1", operation_id: "generate-image",
      variant_id: "banana21-image-1k-minimal-square", parameters: { prompt: "aggregate-byte-bound", refs: repeatedStrings },
      idempotency_key: "aggregate-byte-bound-1"
    }), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "OWNER_LIVE_UNAVAILABLE");
      assert.equal((error as Error).message.includes("aggregate-byte-bound"), false);
      return true;
    });
  } finally { Object.defineProperty = defineProperty; }
  assert.equal(copyStarted, false, "aggregate byte limit rejects before snapshot allocation");
  assert.equal(contextRequests, 1, "aggregate byte limit rejects before manager context creation");
});

test("live service rejects accessors in closed start fields without invoking them or awaiting the manager", async () => {
  const registry = loadGenerationContractRegistryV2(
    "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json",
    `${process.cwd()}/catalog`
  );
  let contextRequests = 0;
  let getterCalls = 0;
  const manager = {
    async getContext() { contextRequests += 1; throw new Error("must not await"); },
    async readJob() { throw new Error("unused"); },
    async readResult() { throw new Error("unused"); }
  } as unknown as OwnerDurableSessionManager;
  const service = new OwnerDurableLiveGenerationService(manager, registry, registry.catalog_version);
  const input = {
    link_attempt_id: "link_owner_durable_live_attempt01", model_id: "banana-2.1", operation_id: "generate-image",
    variant_id: "banana21-image-1k-minimal-square", parameters: { prompt: "safe" }, idempotency_key: "accessor-key"
  };
  Object.defineProperty(input, "idempotency_key", { enumerable: true, get() { getterCalls += 1; return "accessor-key"; } });

  await assert.rejects(service.start(input), (error: unknown) => (error as { code?: string }).code === "OWNER_LIVE_UNAVAILABLE");
  assert.equal(getterCalls, 0);
  assert.equal(contextRequests, 0);
});
