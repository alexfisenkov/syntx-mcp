import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  ObservedGenerationEstimateService,
  ObservedGenerationEstimateServiceError,
  type AccountCostObservationRequest,
  type AccountCostObserver,
  type ObservedGenerationCodecDescriptor,
  type ObservedGenerationCodecRegistry
} from "../src/application/observed-generation-estimate.js";
import {
  type ObservedEstimatePrincipalRef
} from "../src/domain/observed-generation-estimate.js";
import { InMemoryGenerationEstimateStore } from "../src/storage/in-memory-generation-estimate-store.js";

const SECRET = randomBytes(32);
const ESTIMATE_ID = "estimate_obs_service_0123456789abcdefghijkl";
const ORIGINAL_PROMPT = "PRIVATE_PROMPT_ORIGINAL_82a90d";
const MUTATED_PROMPT = "PRIVATE_PROMPT_MUTATED_53c811";
const PRINCIPAL: ObservedEstimatePrincipalRef = {
  tenant_id: "tenant-workshop",
  subject_id: "subject-owner",
  connection_id: "connection-stable-001"
};
const CODEC: ObservedGenerationCodecDescriptor = Object.freeze({
  model_id: "banana3_light",
  operation_id: "generate-image",
  catalog_version: "2026-09-02.frontend-1788368942",
  schema_hash: hashOf("c"),
  allowed_parameter_keys: Object.freeze(["image_size", "prompt"]),
  cost_parameter_specs: Object.freeze([
    Object.freeze({
      key: "image_size",
      kind: "enum" as const,
      values: Object.freeze(["1K", "2K", "4K"])
    })
  ]),
  cost_ai_name: "banana",
  cost_model_type: "banana3_light"
});

test("server-derived service exposes no principal and sends only cost-driving parameters", async () => {
  let observedRequest: AccountCostObservationRequest | null = null;
  const { service, store } = createHarness({
    async observeAccountCost(request) {
      observedRequest = request;
      return { cost: "12.5", discount_cost: null };
    }
  });

  const result = await service.observe({
    model_id: CODEC.model_id,
    operation_id: CODEC.operation_id,
    parameters: { prompt: ORIGINAL_PROMPT, image_size: "1K" }
  });

  assert.equal("principal" in result, false);
  assert.equal(result.start_eligible, false);
  assert.equal(result.state, "OBSERVATION_ONLY");
  assert.deepEqual(observedRequest, {
    ai_name: "banana",
    model_type: "banana3_light",
    cost_parameters: { image_size: "1K" }
  });
  assert.equal(JSON.stringify(result).includes(ORIGINAL_PROMPT), false);
  const internal = store.get(PRINCIPAL, result.estimate_id);
  assert.deepEqual(internal?.principal, PRINCIPAL);
  store.close();
});

test("request snapshot cannot be changed while the account observation is in flight", async () => {
  let release: (() => void) | undefined;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { service, store } = createHarness({
    async observeAccountCost() {
      await paused;
      return { cost: "9", discount_cost: "8" };
    }
  });
  const parameters = { prompt: ORIGINAL_PROMPT, image_size: "1K" };
  const pending = service.observe({
    model_id: CODEC.model_id,
    operation_id: CODEC.operation_id,
    parameters
  });
  parameters.prompt = MUTATED_PROMPT;
  parameters.image_size = "4K";
  release?.();
  const result = await pending;

  assert.doesNotThrow(() =>
    store.assertRequestBinding(PRINCIPAL, result.estimate_id, {
      model_id: CODEC.model_id,
      operation_id: CODEC.operation_id,
      catalog_version: CODEC.catalog_version,
      schema_hash: CODEC.schema_hash,
      parameters: { prompt: ORIGINAL_PROMPT, image_size: "1K" }
    })
  );
  assert.throws(() =>
    store.assertRequestBinding(PRINCIPAL, result.estimate_id, {
      model_id: CODEC.model_id,
      operation_id: CODEC.operation_id,
      catalog_version: CODEC.catalog_version,
      schema_hash: CODEC.schema_hash,
      parameters
    })
  );
  store.close();
});

test("tool-shaped input cannot inject principal, cost, time or codec metadata", async () => {
  let calls = 0;
  const { service, store } = createHarness({
    async observeAccountCost() {
      calls += 1;
      return { cost: "1", discount_cost: null };
    }
  });
  for (const extra of [
    { principal: { tenant_id: "attacker" } },
    { cost: "0" },
    { observed_at: "2026-09-02T00:00:00.000Z" },
    { schema_hash: hashOf("f") }
  ]) {
    await assert.rejects(
      service.observe({
        model_id: CODEC.model_id,
        operation_id: CODEC.operation_id,
        parameters: { prompt: "safe", image_size: "1K" },
        ...extra
      } as never),
      hasServiceCode("INVALID_OBSERVATION_REQUEST")
    );
  }
  assert.equal(calls, 0);
  store.close();
});

test("codec mismatches and non-scalar cost drivers fail before upstream I/O", async () => {
  let calls = 0;
  const observer: AccountCostObserver = {
    async observeAccountCost() {
      calls += 1;
      return { cost: "1", discount_cost: null };
    }
  };
  const invalidCodec = {
    ...CODEC,
    cost_parameter_specs: [
      { key: "not_allowlisted", kind: "boolean" as const }
    ]
  };
  const { service: invalidService, store: invalidStore } = createHarness(
    observer,
    invalidCodec
  );
  await assert.rejects(
    invalidService.observe({
      model_id: CODEC.model_id,
      operation_id: CODEC.operation_id,
      parameters: { prompt: "safe", image_size: "1K" }
    }),
    hasServiceCode("INVALID_OBSERVED_CODEC")
  );
  invalidStore.close();

  const { service, store } = createHarness(observer);
  await assert.rejects(
    service.observe({
      model_id: CODEC.model_id,
      operation_id: CODEC.operation_id,
      parameters: { prompt: "safe", image_size: { nested: true } }
    }),
    hasServiceCode("INVALID_COST_PARAMETER_VALUE")
  );
  assert.equal(calls, 0);
  store.close();
});

test("cost drivers are required, typed and cannot select prompt-like fields", async () => {
  let calls = 0;
  const observer: AccountCostObserver = {
    async observeAccountCost() {
      calls += 1;
      return { cost: "1", discount_cost: null };
    }
  };
  const { service, store } = createHarness(observer);
  await assert.rejects(
    service.observe({
      model_id: CODEC.model_id,
      operation_id: CODEC.operation_id,
      parameters: { prompt: "safe" }
    }),
    hasServiceCode("MISSING_COST_PARAMETER_VALUE")
  );
  await assert.rejects(
    service.observe({
      model_id: CODEC.model_id,
      operation_id: CODEC.operation_id,
      parameters: { prompt: "safe", image_size: "8K" }
    }),
    hasServiceCode("INVALID_COST_PARAMETER_VALUE")
  );
  store.close();

  const unsafeCodec: ObservedGenerationCodecDescriptor = {
    ...CODEC,
    cost_parameter_specs: [{
      key: "prompt",
      kind: "enum",
      values: ["safe"]
    }]
  };
  const { service: unsafeService, store: unsafeStore } = createHarness(
    observer,
    unsafeCodec
  );
  await assert.rejects(
    unsafeService.observe({
      model_id: CODEC.model_id,
      operation_id: CODEC.operation_id,
      parameters: { prompt: "safe", image_size: "1K" }
    }),
    hasServiceCode("INVALID_OBSERVED_CODEC")
  );
  assert.equal(calls, 0);
  unsafeStore.close();

  for (const unsafeKey of [
    "authCode",
    "promptText",
    "resultUrl",
    "fileHint"
  ]) {
    const camelCaseCodec: ObservedGenerationCodecDescriptor = {
      ...CODEC,
      allowed_parameter_keys: [...CODEC.allowed_parameter_keys, unsafeKey],
      cost_parameter_specs: [{
        key: unsafeKey,
        kind: "integer",
        minimum: 0,
        maximum: 999_999
      }]
    };
    const { service: unsafeCamelService, store: unsafeCamelStore } =
      createHarness(observer, camelCaseCodec);
    await assert.rejects(
      unsafeCamelService.observe({
        model_id: CODEC.model_id,
        operation_id: CODEC.operation_id,
        parameters: {
          prompt: "safe",
          image_size: "1K",
          [unsafeKey]: 123456
        }
      }),
      hasServiceCode("INVALID_OBSERVED_CODEC")
    );
    unsafeCamelStore.close();
  }
});

test("caller-controlled or malformed cost evidence is rejected before storage", async () => {
  const { service, store } = createHarness({
    async observeAccountCost() {
      return {
        cost: "1",
        discount_cost: null,
        observed_at: "caller-controlled"
      } as never;
    }
  });
  await assert.rejects(
    service.observe({
      model_id: CODEC.model_id,
      operation_id: CODEC.operation_id,
      parameters: { prompt: "safe", image_size: "1K" }
    }),
    hasServiceCode("COST_OBSERVATION_FAILED")
  );
  assert.equal(store.get(PRINCIPAL, ESTIMATE_ID), null);
  store.close();
});

test("dependency failures are normalized without leaking their messages", async () => {
  const sentinel = "PRIVATE_DEPENDENCY_ERROR_MUST_NOT_ESCAPE";
  const registryFailure = new ObservedGenerationEstimateService({
    principal: PRINCIPAL,
    codecs: {
      resolve() {
        throw new Error(sentinel);
      }
    },
    costObserver: {
      async observeAccountCost() {
        return { cost: "1", discount_cost: null };
      }
    },
    writer: {
      createValidated() {
        throw new Error("must not run");
      }
    }
  });
  await assert.rejects(
    registryFailure.observe({
      model_id: CODEC.model_id,
      operation_id: CODEC.operation_id,
      parameters: { prompt: "safe", image_size: "1K" }
    }),
    fixedFailure("CODEC_REGISTRY_UNAVAILABLE", sentinel)
  );

  const { service: observerFailure, store: observerStore } = createHarness({
    async observeAccountCost() {
      throw new Error(sentinel);
    }
  });
  await assert.rejects(
    observerFailure.observe({
      model_id: CODEC.model_id,
      operation_id: CODEC.operation_id,
      parameters: { prompt: "safe", image_size: "1K" }
    }),
    fixedFailure("COST_OBSERVATION_FAILED", sentinel)
  );
  observerStore.close();

  const writerFailure = new ObservedGenerationEstimateService({
    principal: PRINCIPAL,
    codecs: registryFor(CODEC),
    costObserver: {
      async observeAccountCost() {
        return { cost: "1", discount_cost: null };
      }
    },
    writer: {
      createValidated() {
        throw new Error(sentinel);
      }
    }
  });
  await assert.rejects(
    writerFailure.observe({
      model_id: CODEC.model_id,
      operation_id: CODEC.operation_id,
      parameters: { prompt: "safe", image_size: "1K" }
    }),
    fixedFailure("OBSERVATION_STORE_FAILED", sentinel)
  );
});

test("a writer cannot forge start eligibility or add sensitive output fields", async () => {
  const store = new InMemoryGenerationEstimateStore(SECRET, {
    now: () => new Date("2026-09-02T12:00:00.000Z"),
    estimateIdGenerator: () => ESTIMATE_ID,
    resolveAllowedParameterKeys: () => CODEC.allowed_parameter_keys
  });
  const service = new ObservedGenerationEstimateService({
    principal: PRINCIPAL,
    codecs: registryFor(CODEC),
    costObserver: {
      async observeAccountCost() {
        return { cost: "1", discount_cost: null };
      }
    },
    writer: {
      createValidated(input, validateBeforeCommit) {
        store.createValidated(input, (candidate) => {
          validateBeforeCommit({
            ...candidate,
            start_eligible: true,
            prompt: ORIGINAL_PROMPT
          } as never);
        });
      }
    }
  });
  await assert.rejects(
    service.observe({
      model_id: CODEC.model_id,
      operation_id: CODEC.operation_id,
      parameters: { prompt: ORIGINAL_PROMPT, image_size: "1K" }
    }),
    (error: unknown) =>
      hasServiceCode("OBSERVATION_STORE_FAILED")(error) &&
      !String(error).includes(ORIGINAL_PROMPT)
  );
  assert.equal(store.get(PRINCIPAL, ESTIMATE_ID), null);
  store.close();
});

function createHarness(
  observer: AccountCostObserver,
  codec: ObservedGenerationCodecDescriptor = CODEC
) {
  const registry = registryFor(codec);
  const store = new InMemoryGenerationEstimateStore(SECRET, {
    now: () => new Date("2026-09-02T12:00:00.000Z"),
    estimateIdGenerator: () => ESTIMATE_ID,
    resolveAllowedParameterKeys(binding) {
      if (
        binding.model_id !== codec.model_id ||
        binding.operation_id !== codec.operation_id ||
        binding.catalog_version !== codec.catalog_version ||
        binding.schema_hash !== codec.schema_hash
      ) {
        throw new Error("Codec binding mismatch.");
      }
      return codec.allowed_parameter_keys;
    }
  });
  return {
    service: new ObservedGenerationEstimateService({
      principal: PRINCIPAL,
      codecs: registry,
      costObserver: observer,
      writer: store
    }),
    store
  };
}

function registryFor(
  codec: ObservedGenerationCodecDescriptor
): ObservedGenerationCodecRegistry {
  return {
    resolve(modelId, operationId) {
      return modelId === codec.model_id && operationId === codec.operation_id
        ? codec
        : null;
    }
  };
}

function hasServiceCode(code: string) {
  return (error: unknown): boolean =>
    error instanceof ObservedGenerationEstimateServiceError &&
    error.code === code;
}

function fixedFailure(code: string, forbiddenText: string) {
  return (error: unknown): boolean =>
    hasServiceCode(code)(error) && !String(error).includes(forbiddenText);
}

function hashOf(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
