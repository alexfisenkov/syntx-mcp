import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  createObservedRequestBinding,
  ObservedGenerationEstimateError,
  observedRequestBindingMatches,
  type CreateObservedGenerationEstimateInput,
  type ObservedGenerationRequestBindingInput
} from "../src/domain/observed-generation-estimate.js";
import {
  InMemoryGenerationEstimateStore,
  InMemoryGenerationEstimateStoreError
} from "../src/storage/in-memory-generation-estimate-store.js";

const SECRET = randomBytes(32);
const OTHER_SECRET = randomBytes(32);
const ESTIMATE_ID =
  "estimate_obs_0123456789abcdefghijklmnop";
const NOW = new Date("2026-09-02T10:00:00.000Z");

test("stores only immutable observation metadata and never grants start eligibility", () => {
  const store = createStore();
  const estimate = store.create(makeInput());

  assert.deepEqual(estimate, {
    estimate_id: ESTIMATE_ID,
    principal: {
      tenant_id: "tenant:workshop@example.com",
      subject_id: "auth0|user@example.com",
      connection_id: "connection_stable_001"
    },
    state: "OBSERVATION_ONLY",
    start_eligible: false,
    reason: "COST_CONTRACT_UNVERIFIED",
    model_id: "banana3_light",
    operation_id: "generate-image",
    catalog_version: "2026-09-02.frontend-1788368942",
    schema_hash: hashOf("a"),
    parameter_keys: ["auth_hint", "image_size", "prompt", "result_hint"],
    request_binding: estimate.request_binding,
    cost: "12.5",
    discount_cost: null,
    unit: null,
    expires_at: null,
    observed_at: "2026-09-02T10:00:00.000Z",
    local_retention_expires_at: "2026-09-02T10:15:00.000Z"
  });
  assert.match(estimate.request_binding, /^hmac-sha256:[a-f0-9]{64}$/);

  const serialized = JSON.stringify({ store, estimate });
  for (const forbidden of [
    "PRIVATE_PROMPT_SENTINEL_4f191d",
    "PROVIDER_TOKEN_SENTINEL_9808a1",
    "https://private.invalid/result?sig=URL_SENTINEL_45b57e",
    SECRET.toString("utf8")
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  store.close();
});

test("canonical request binding is stable across object key order", () => {
  const left = bindingInput({
    zeta: [{ beta: 2, alpha: 1 }],
    alpha: { second: true, first: "value" },
    count: -0
  });
  const right = bindingInput({
    count: 0,
    alpha: { first: "value", second: true },
    zeta: [{ alpha: 1, beta: 2 }]
  });

  const leftBinding = createObservedRequestBinding(left, SECRET);
  const rightBinding = createObservedRequestBinding(right, SECRET);
  assert.equal(leftBinding.request_binding, rightBinding.request_binding);
  assert.deepEqual(leftBinding.parameter_keys, ["alpha", "count", "zeta"]);
  assert.deepEqual(rightBinding.parameter_keys, ["alpha", "count", "zeta"]);
});

test("binding verification rejects another HMAC key or changed request", () => {
  const store = createStore();
  const input = makeInput();
  const estimate = store.create(input);

  assert.equal(
    observedRequestBindingMatches(
      estimate.request_binding,
      bindingInput(input.parameters),
      SECRET
    ),
    true
  );
  assert.equal(
    observedRequestBindingMatches(
      estimate.request_binding,
      bindingInput(input.parameters),
      OTHER_SECRET
    ),
    false
  );
  assert.throws(
    () =>
      store.assertRequestBinding(input.principal, estimate.estimate_id, {
        ...bindingInput(input.parameters),
        parameters: { ...input.parameters, image_size: "2K" }
      }),
    (error: unknown) =>
      error instanceof InMemoryGenerationEstimateStoreError &&
      error.code === "REQUEST_BINDING_MISMATCH"
  );
  assert.equal(
    store.assertRequestBinding(
      input.principal,
      estimate.estimate_id,
      bindingInput(input.parameters)
    ).request_binding,
    estimate.request_binding
  );
  store.close();
});

test("reads and binding checks are isolated by owner and stable connection", () => {
  const store = createStore();
  const input = makeInput();
  const estimate = store.create(input);

  assert.equal(
    store.get(
      { ...input.principal, subject_id: "another-user" },
      estimate.estimate_id
    ),
    null
  );
  assert.equal(
    store.get(
      { ...input.principal, tenant_id: "another-tenant" },
      estimate.estimate_id
    ),
    null
  );
  assert.equal(
    store.get(
      { ...input.principal, connection_id: "connection_other_002" },
      estimate.estimate_id
    ),
    null
  );
  assert.throws(
    () =>
      store.assertRequestBinding(
        { ...input.principal, connection_id: "connection_other_002" },
        estimate.estimate_id,
        bindingInput(input.parameters)
      ),
    (error: unknown) =>
      error instanceof InMemoryGenerationEstimateStoreError &&
      error.code === "ESTIMATE_NOT_FOUND"
  );
  store.close();
});

test("estimate ids reject both exact replay and conflicting reuse", () => {
  const store = createStore();
  const input = makeInput();
  const first = store.create(input);

  assert.throws(
    () => store.create(input),
    (error: unknown) =>
      error instanceof InMemoryGenerationEstimateStoreError &&
      error.code === "ESTIMATE_REPLAY_REJECTED"
  );
  assert.throws(
    () => store.create({ ...input, model_id: "banana3_pro" }),
    (error: unknown) =>
      error instanceof InMemoryGenerationEstimateStoreError &&
      error.code === "ESTIMATE_ID_CONFLICT"
  );

  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.principal), true);
  assert.equal(Object.isFrozen(first.parameter_keys), true);
  assert.throws(() => {
    (first as { estimate_id: string }).estimate_id = "changed";
  }, TypeError);
  const secondRead = store.get(
      input.principal,
    first.estimate_id
  );
  assert.notEqual(secondRead, first);
  assert.equal(secondRead?.estimate_id, ESTIMATE_ID);
  store.close();
});

test("local retention is explicit, upstream expiry remains null, and ids stay spent", () => {
  let nowMs = NOW.getTime();
  const store = new InMemoryGenerationEstimateStore(SECRET, {
    localRetentionMs: 1_000,
    now: () => new Date(nowMs),
    estimateIdGenerator: () => ESTIMATE_ID,
    resolveAllowedParameterKeys
  });
  const estimate = store.create(makeInput());
  assert.equal(estimate.expires_at, null);
  assert.equal(
    estimate.local_retention_expires_at,
    "2026-09-02T10:00:01.000Z"
  );

  nowMs += 1_000;
  assert.equal(
    store.get(
      estimate.principal,
      estimate.estimate_id
    ),
    null
  );
  assert.throws(
    () => store.create(makeInput()),
    (error: unknown) =>
      error instanceof InMemoryGenerationEstimateStoreError &&
      error.code === "ESTIMATE_ID_CONFLICT"
  );
  store.close();
});

test("canonicalization rejects prototypes, accessors, cycles, symbols and NaN", () => {
  let getterCalls = 0;
  const accessorParameters: Record<string, unknown> = {};
  Object.defineProperty(accessorParameters, "prompt", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "must-not-run";
    }
  });

  const customPrototype = Object.create({ inherited: "unsafe" }) as Record<
    string,
    unknown
  >;
  customPrototype.prompt = "value";
  const cyclic: Record<string, unknown> = { prompt: "value" };
  cyclic.self = cyclic;
  const symbolKeyed: Record<string | symbol, unknown> = { prompt: "value" };
  symbolKeyed[Symbol("hidden")] = "value";
  const proxied = new Proxy(
    { prompt: "value" },
    {
      ownKeys() {
        throw new Error("A rejected proxy must not execute reflection traps.");
      }
    }
  );

  for (const parameters of [
    accessorParameters,
    customPrototype,
    cyclic,
    symbolKeyed,
    proxied,
    { prompt: "value", strength: Number.NaN },
    { prompt: "value", strength: Number.POSITIVE_INFINITY }
  ]) {
    assert.throws(
      () => createObservedRequestBinding(bindingInput(parameters), SECRET),
      (error: unknown) =>
        error instanceof ObservedGenerationEstimateError
    );
  }
  assert.equal(getterCalls, 0);
});

test("short HMAC secrets and non-decimal observed costs fail closed", () => {
  assert.throws(
    () => createObservedRequestBinding(bindingInput({ prompt: "safe" }), Buffer.alloc(31)),
    (error: unknown) =>
      error instanceof ObservedGenerationEstimateError &&
      error.code === "INVALID_HMAC_SECRET"
  );
  const store = createStore();
  assert.throws(() => store.create({ ...makeInput(), cost: "NaN" }));
  assert.throws(() => store.create({ ...makeInput(), discount_cost: "1e3" }));
  assert.throws(() => store.create({ ...makeInput(), cost: `1${"0".repeat(32)}` }));
  assert.throws(() => store.create({ ...makeInput(), cost: `1.${"0".repeat(19)}` }));
  store.close();
});

test("store rejects getters, proxies and unknown fields before property reads", () => {
  let getterCalls = 0;
  const inputWithGetter = makeInput() as unknown as Record<string, unknown>;
  Object.defineProperty(inputWithGetter, "principal", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return makeInput().principal;
    }
  });
  const proxy = new Proxy(makeInput(), {
    ownKeys() {
      throw new Error("A rejected proxy must not execute traps.");
    }
  });
  const principalWithGetter = { ...makeInput().principal } as Record<string, unknown>;
  Object.defineProperty(principalWithGetter, "tenant_id", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "must-not-run";
    }
  });
  const metadataWithGetter = makeInput() as unknown as Record<string, unknown>;
  Object.defineProperty(metadataWithGetter, "cost", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "must-not-run";
    }
  });
  const bindingProxy = new Proxy(bindingInput({ prompt: "safe" }), {
    ownKeys() {
      throw new Error("A rejected proxy must not execute traps.");
    }
  });
  const store = createStore();
  for (const candidate of [
    inputWithGetter,
    proxy,
    { ...makeInput(), principal: principalWithGetter },
    metadataWithGetter
  ]) {
    assert.throws(
      () => store.create(candidate as CreateObservedGenerationEstimateInput),
      (error: unknown) => error instanceof ObservedGenerationEstimateError
    );
  }
  assert.throws(
    () =>
      store.create({
        ...(makeInput() as object),
        observed_at: "caller-controlled"
      } as unknown as CreateObservedGenerationEstimateInput),
    (error: unknown) => error instanceof ObservedGenerationEstimateError
  );
  assert.throws(
    () => createObservedRequestBinding(bindingProxy, SECRET),
    (error: unknown) => error instanceof ObservedGenerationEstimateError
  );
  assert.equal(getterCalls, 0);
  store.close();
});

test("parameter names are conservative and can be bound to a typed codec contract", () => {
  for (const key of ["result_url", "provider_token", "api_key", "bad-key"]) {
    assert.throws(
      () => createObservedRequestBinding(bindingInput({ [key]: "value" }), SECRET),
      (error: unknown) => error instanceof ObservedGenerationEstimateError
    );
  }
  assert.throws(
    () =>
      createObservedRequestBinding(bindingInput({ prompt: "safe", image_size: "1K" }), SECRET, {
        allowed_parameter_keys: ["prompt"]
      }),
    (error: unknown) => error instanceof ObservedGenerationEstimateError
  );
  assert.doesNotThrow(() =>
    createObservedRequestBinding(bindingInput({ prompt: "safe" }), SECRET, {
      allowed_parameter_keys: ["prompt"]
    })
  );
});

test("spent ids have an explicit finite process-local capacity", () => {
  const ids = [
    ESTIMATE_ID,
    "estimate_obs_abcdefghijklmnopqrstuvwx0123456789"
  ];
  const store = new InMemoryGenerationEstimateStore(SECRET, {
    now: () => new Date(NOW),
    estimateIdGenerator: () => ids.shift() ?? ESTIMATE_ID,
    maximumSeenEstimateIds: 1,
    resolveAllowedParameterKeys
  });
  store.create(makeInput());
  assert.throws(
    () =>
      store.create({
        ...makeInput(),
        principal: {
          ...makeInput().principal,
          connection_id: "connection_capacity_other_002"
        }
      }),
    (error: unknown) =>
      error instanceof InMemoryGenerationEstimateStoreError &&
      error.code === "STORE_CAPACITY_EXCEEDED"
  );
  assert.throws(
    () =>
      new InMemoryGenerationEstimateStore(SECRET, {
        maximumSeenEstimateIds: 0,
        resolveAllowedParameterKeys
      }),
    (error: unknown) =>
      error instanceof InMemoryGenerationEstimateStoreError &&
      error.code === "INVALID_CAPACITY"
  );
  store.close();
});

test("store requires a server-owned codec resolver and enforces it before storage", () => {
  assert.throws(
    () =>
      new InMemoryGenerationEstimateStore(
        SECRET,
        {} as never
      ),
    (error: unknown) =>
      error instanceof InMemoryGenerationEstimateStoreError &&
      error.code === "INVALID_CODEC_RESOLVER"
  );
  const store = new InMemoryGenerationEstimateStore(SECRET, {
    now: () => new Date(NOW),
    estimateIdGenerator: () => ESTIMATE_ID,
    resolveAllowedParameterKeys: () => ["prompt"]
  });
  assert.throws(
    () => store.create(makeInput()),
    (error: unknown) => error instanceof ObservedGenerationEstimateError
  );
  assert.equal(store.get(makeInput().principal, ESTIMATE_ID), null);
  store.close();
});

test("pre-commit validation failure leaves no record or spent id", () => {
  const store = createStore();
  assert.throws(
    () =>
      store.createValidated(makeInput(), () => {
        throw new Error("candidate rejected");
      }),
    /candidate rejected/u
  );
  assert.equal(store.get(makeInput().principal, ESTIMATE_ID), null);
  assert.equal(store.create(makeInput()).estimate_id, ESTIMATE_ID);
  store.close();
});

test("one principal cannot exhaust the entire process-local observation capacity", () => {
  const ids = [
    ESTIMATE_ID,
    "estimate_obs_abcdefghijklmnopqrstuvwx0123456789",
    "estimate_obs_zyxwvutsrqponmlkjihgfedcba9876543210"
  ];
  const store = new InMemoryGenerationEstimateStore(SECRET, {
    now: () => new Date(NOW),
    estimateIdGenerator: () => ids.shift() ?? ESTIMATE_ID,
    maximumSeenEstimateIds: 3,
    maximumSeenEstimateIdsPerPrincipal: 1,
    resolveAllowedParameterKeys
  });
  const first = makeInput();
  store.create(first);
  assert.throws(
    () => store.create(first),
    (error: unknown) =>
      error instanceof InMemoryGenerationEstimateStoreError &&
      error.code === "PRINCIPAL_CAPACITY_EXCEEDED"
  );
  assert.doesNotThrow(() =>
    store.create({
      ...makeInput(),
      principal: {
        ...makeInput().principal,
        connection_id: "connection_stable_002"
      }
    })
  );
  store.close();
});

function createStore(): InMemoryGenerationEstimateStore {
  return new InMemoryGenerationEstimateStore(SECRET, {
    now: () => new Date(NOW),
    estimateIdGenerator: () => ESTIMATE_ID,
    resolveAllowedParameterKeys
  });
}

function resolveAllowedParameterKeys(): readonly string[] {
  return ["auth_hint", "image_size", "prompt", "result_hint"];
}

function makeInput(): CreateObservedGenerationEstimateInput {
  return {
    principal: {
      tenant_id: "tenant:workshop@example.com",
      subject_id: "auth0|user@example.com",
      connection_id: "connection_stable_001"
    },
    ...bindingInput({
      prompt: "PRIVATE_PROMPT_SENTINEL_4f191d",
      image_size: "1K",
      auth_hint: "PROVIDER_TOKEN_SENTINEL_9808a1",
      result_hint:
        "https://private.invalid/result?sig=URL_SENTINEL_45b57e"
    }),
    cost: "12.5",
    discount_cost: null,
  };
}

function bindingInput(
  parameters: Readonly<Record<string, unknown>>
): ObservedGenerationRequestBindingInput {
  return {
    model_id: "banana3_light",
    operation_id: "generate-image",
    catalog_version: "2026-09-02.frontend-1788368942",
    schema_hash: hashOf("a"),
    parameters
  };
}

function hashOf(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
