import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createBananaLiteRequestPreparer } from "../src/adapter/syntx/banana-lite-request.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxUpstreamAdapter, type PreparedSyntxMediaRequest } from "../src/adapter/syntx/upstream-adapter.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { hashGenerationRequest } from "../src/application/generation-request.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import type { GenerationRequest } from "../src/domain/types.js";
import { ApplicationError } from "../src/errors.js";
import { SqliteGenerationTransactionStore } from "../src/storage/sqlite-generation-transaction-store.js";

const CATALOG_VERSION = "2026-09-02T19:59:39.979Z.4d79bae5266c";
// Explicit synthetic fixture identity, not a runtime account fallback.
const PRINCIPAL: GenerationPrincipalRef = Object.freeze({
  tenant_id: "local_banana_test_owner",
  subject_id: "local_banana_test_owner",
  connection_id: "connection_unscoped_single_owner_v1"
});
const CONTEXT = {
  principal: PRINCIPAL,
  idempotency_key: "banana_static_test_001",
  confirmation_id: "local_test_confirmation",
  approved_max_cost_tokens: 10
};
const OWNER = { tenant_id: PRINCIPAL.tenant_id, subject_id: PRINCIPAL.subject_id };
const EXPECTED_SETTINGS = {
  model_type: "banana3_light", image_size: "1K", aspect_ratio: "1:1", n: 1, image_url: []
};

function request(): GenerationRequest {
  return {
    model_id: "banana3_light", operation_id: "generate-image", catalog_version: CATALOG_VERSION,
    parameters: { prompt: "  Synthetic local canary: a blue ceramic cup.  ", image_size: "1K", aspect_ratio: "1:1" }
  };
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof ApplicationError && error.code === code;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(t: TestContext, options: {
  store?: SqliteGenerationTransactionStore;
  preparer?: (request: GenerationRequest) => PreparedSyntxMediaRequest;
  legacy?: boolean;
  onCreate?: () => Promise<void>;
  failGeneration?: boolean;
} = {}) {
  const store = options.store ?? new SqliteGenerationTransactionStore(":memory:");
  if (!options.store) t.after(() => store.close());
  const seen: { url: string; method: string; body: unknown }[] = [];
  let credentials = 0;
  let clients = 0;
  let preparations = 0;
  let legacyResolutions = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: {
      async useCredential(operation) { credentials += 1; return operation("synthetic-local-credential"); }
    },
    fetchImpl: async (input, init) => {
      const url = String(input);
      seen.push({ url, method: init?.method ?? "GET", body: JSON.parse(String(init?.body)) as unknown });
      if (url === "https://api.syntx.ai/api/v1/chats") {
        await options.onCreate?.();
        return new Response(JSON.stringify({ uuid: "local_banana_chat" }), { headers: { "content-type": "application/json" } });
      }
      assert.equal(url, "https://api.syntx.ai/api/v1/design/generate?ai_name=banana");
      if (options.failGeneration) throw new Error("synthetic lost generation response");
      return new Response(JSON.stringify({ id: 42 }), { headers: { "content-type": "application/json" } });
    }
  });
  const preparer = options.preparer ?? createBananaLiteRequestPreparer(new DiscoveryCatalogRepository());
  const adapter = new SyntxUpstreamAdapter({
    transactionStore: store,
    resolveChatClient: () => { clients += 1; return client; },
    resolveAiName: () => { legacyResolutions += 1; if (!options.legacy) assert.fail("unexpected legacy family resolver"); return "banana"; },
    resolveModality: () => { legacyResolutions += 1; if (!options.legacy) assert.fail("unexpected legacy modality resolver"); return "image"; },
    ...(options.legacy ? {} : { prepareMediaRequest: (snapshot: GenerationRequest) => {
      preparations += 1;
      return preparer(snapshot);
    } }),
    now: () => new Date("2026-09-04T12:00:00.000Z")
  });
  return { adapter, store, seen, counts: () => ({ credentials, clients, preparations, legacyResolutions }) };
}

test("static Banana Lite sends the exact HTTP contract, records a redacted receipt, and replays after SQLite reopen", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "syntx-banana-request-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "operations.sqlite");
  const firstStore = new SqliteGenerationTransactionStore(path);
  t.after(() => firstStore.close());
  const first = harness(t, { store: firstStore });
  const input = request();
  const job = await first.adapter.startGeneration(CONTEXT, input);
  assert.equal(job.status, "queued");
  assert.equal(job.model_id, "banana3_light");
  assert.deepEqual(first.seen, [
    { url: "https://api.syntx.ai/api/v1/chats", method: "POST", body: { scope: "image", title: `mcp-generation-${job.id}` } },
    { url: "https://api.syntx.ai/api/v1/design/generate?ai_name=banana", method: "POST", body: {
      chat_uuid: "local_banana_chat", prompt: input.parameters.prompt, settings: EXPECTED_SETTINGS
    } }
  ]);
  const record = firstStore.getById(OWNER, job.id);
  assert.ok(record);
  assert.equal(record.state, "PROVIDER_ACCEPTED");
  assert.deepEqual(record.receipt, { chat_uuid: "local_banana_chat", message_id: "42", provider_job_id: null, message_object_id: null });
  assert.equal(record.request_hash, hashGenerationRequest(input));
  assert.deepEqual(record.parameter_keys, ["aspect_ratio", "image_size", "prompt"]);
  assert.match(record.schema_hash, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(record.schema_hash, `sha256:${createHash("sha256").update("syntx-upstream-adapter:no-real-parameters-schema-yet:v1").digest("hex")}`);
  assert.equal(record.catalog_version, CATALOG_VERSION);
  assert.equal(record.cost.cap_enforcement, "UNENFORCEABLE");
  assert.equal(record.cost.effective_cost, null);
  const persisted = JSON.stringify([record, firstStore.listEvents(OWNER, job.id)]);
  assert.equal(persisted.includes(input.parameters.prompt as string), false);
  assert.equal(persisted.includes("synthetic-local-credential"), false);
  assert.deepEqual(first.counts(), { credentials: 2, clients: 1, preparations: 1, legacyResolutions: 0 });
  firstStore.close();

  const replayStore = new SqliteGenerationTransactionStore(path);
  t.after(() => replayStore.close());
  const replay = harness(t, { store: replayStore });
  assert.deepEqual(await replay.adapter.startGeneration(CONTEXT, request()), job);
  assert.equal(replay.counts().preparations, 1);
  assert.equal(replay.counts().credentials, 0);
  assert.deepEqual(replay.seen, []);
  assert.equal(replayStore.getById(OWNER, job.id)?.request_hash, record.request_hash);
});

const invalidRequests: [string, (input: GenerationRequest) => void][] = [
  ["model override", (input) => { input.parameters.model_type = "banana2"; }],
  ["n override", (input) => { input.parameters.n = 1; }],
  ["empty files", (input) => { input.parameters.files = []; }],
  ["image_url override", (input) => { input.parameters.image_url = []; }],
  ["image_urls override", (input) => { input.parameters.image_urls = ["https://example.invalid/input.png"]; }],
  ["URL override", (input) => { input.parameters.url = "https://example.invalid/input.png"; }],
  ["arbitrary settings", (input) => { input.parameters.seed = 1; }],
  ["extra envelope callback", (input) => { Object.assign(input, { prepareMediaRequest: () => assert.fail("untrusted callback") }); }],
  ["wrong exact model", (input) => { input.model_id = "banana2"; }],
  ["sample alias", (input) => { input.model_id = "nano-banana-pro"; }],
  ["wrong operation", (input) => { input.operation_id = "text-to-image"; }],
  ["wrong catalog", (input) => { input.catalog_version = "2026-09-02.frontend-1788368942"; }],
  ["missing prompt", (input) => { delete input.parameters.prompt; }],
  ["blank prompt", (input) => { input.parameters.prompt = " \n\t "; }],
  ["nonstring prompt", (input) => { input.parameters.prompt = 42; }],
  ["oversized UTF-8 prompt", (input) => { input.parameters.prompt = "🟦".repeat(1025); }],
  ["NUL prompt", (input) => { input.parameters.prompt = "local\u0000prompt"; }],
  ["control prompt", (input) => { input.parameters.prompt = "local\u000bprompt"; }],
  ["DEL prompt", (input) => { input.parameters.prompt = "local\u007fprompt"; }],
  ["2K", (input) => { input.parameters.image_size = "2K"; }],
  ["missing explicit image_size", (input) => { delete input.parameters.image_size; }],
  ["other aspect", (input) => { input.parameters.aspect_ratio = "16:9"; }],
  ["missing explicit aspect", (input) => { delete input.parameters.aspect_ratio; }]
];

for (const [label, mutate] of invalidRequests) {
  test(`invalid ${label} is refused before store, client, credential or HTTP I/O`, async (t) => {
    const fixture = harness(t);
    const spies = ["createOrReplay", "getById", "getByIdempotencyKey", "transition", "listEvents"]
      .map((method) => t.mock.method(fixture.store, method as "createOrReplay"));
    const input = request();
    mutate(input);
    await assert.rejects(fixture.adapter.startGeneration(CONTEXT, input), hasCode("INVALID_PARAMETERS"));
    for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
    assert.equal(fixture.counts().clients, 0);
    assert.equal(fixture.counts().credentials, 0);
    assert.deepEqual(fixture.seen, []);
  });
}

test("factory rejects catalog drift and an unavailable exact model/operation/family", (t) => {
  const drift = new DiscoveryCatalogRepository();
  Object.defineProperty(drift, "fetched_at", { value: "2026-09-03T19:59:39.979Z" });
  assert.throws(() => createBananaLiteRequestPreparer(drift), hasCode("INVALID_PARAMETERS"));
  for (const field of ["active", "ai_name", "operations", "upstream_id", "scope"] as const) {
    const catalog = new DiscoveryCatalogRepository();
    const model = catalog.getModel("banana3_light");
    const invalid = { ...model, [field]: field === "active" ? false : field === "operations" ? [] : "mismatch" };
    t.mock.method(catalog, "getModel", () => invalid);
    assert.throws(() => createBananaLiteRequestPreparer(catalog), hasCode("INVALID_PARAMETERS"));
  }
});

test("preparation is immutable, bounded in UTF-8, and its schema hash is prompt-independent", () => {
  const prepare = createBananaLiteRequestPreparer(new DiscoveryCatalogRepository());
  const first = prepare(request());
  const input = request();
  input.parameters.prompt = "🟦".repeat(1024);
  const second = prepare(input);
  assert.equal(first.schema_hash, second.schema_hash);
  input.parameters.prompt = "local\ncanary\twith\rwhitespace";
  assert.equal(prepare(input).prompt, input.parameters.prompt);
  assert.equal(first.ai_name, "banana");
  assert.equal(first.modality, "image");
  assert.deepEqual(first.settings, EXPECTED_SETTINGS);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.settings));
  assert.ok(Object.isFrozen(first.settings.image_url));
});

test("original request and retained callback result cannot mutate a delayed createChat dispatch", async (t) => {
  const entered = deferred();
  const release = deferred();
  const prepare = createBananaLiteRequestPreparer(new DiscoveryCatalogRepository());
  let retained!: { prompt: string; settings: Record<string, unknown>; ai_name: string; modality: "image"; schema_hash: string };
  const fixture = harness(t, {
    preparer: (snapshot) => {
      assert.ok(Object.isFrozen(snapshot));
      assert.ok(Object.isFrozen(snapshot.parameters));
      assert.equal(fixture.counts().clients, 0);
      assert.equal(fixture.store.getByIdempotencyKey(OWNER, CONTEXT.idempotency_key), null);
      retained = structuredClone(prepare(snapshot)) as typeof retained;
      return retained;
    },
    onCreate: async () => { entered.resolve(); await release.promise; }
  });
  const input = request();
  const original = structuredClone(input);
  const pending = fixture.adapter.startGeneration(CONTEXT, input);
  await entered.promise;
  input.parameters.prompt = "mutated caller prompt";
  input.parameters.image_size = "2K";
  input.model_id = "banana2";
  input.operation_id = "generate-video";
  input.catalog_version = "changed";
  retained.prompt = "mutated callback prompt";
  retained.ai_name = "other";
  retained.settings.model_type = "banana2";
  retained.settings.n = 9;
  (retained.settings.image_url as string[]).push("https://example.invalid/input.png");
  retained.schema_hash = `sha256:${"b".repeat(64)}`;
  release.resolve();
  const job = await pending;
  assert.deepEqual(fixture.seen[1]?.body, {
    chat_uuid: "local_banana_chat", prompt: original.parameters.prompt, settings: EXPECTED_SETTINGS
  });
  const record = fixture.store.getById(OWNER, job.id);
  assert.equal(record?.request_hash, hashGenerationRequest(original));
  assert.equal(record?.schema_hash, prepare(original).schema_hash);
  assert.equal(record?.model_id, original.model_id);
  assert.equal(record?.operation_id, original.operation_id);
  assert.equal(record?.catalog_version, original.catalog_version);
  assert.equal(fixture.counts().preparations, 1);
});

test("legacy no-callback path captures nested settings once before awaiting createChat", async (t) => {
  const entered = deferred();
  const release = deferred();
  const fixture = harness(t, { legacy: true, onCreate: async () => { entered.resolve(); await release.promise; } });
  const input = request();
  input.parameters = { prompt: "original legacy prompt", options: { seed: 1 }, samples: [1, 2] };
  const original = structuredClone(input);
  const pending = fixture.adapter.startGeneration(CONTEXT, input);
  await entered.promise;
  (input.parameters.options as { seed: number }).seed = 9;
  (input.parameters.samples as number[]).push(3);
  input.parameters.prompt = "changed legacy prompt";
  release.resolve();
  const job = await pending;
  assert.deepEqual(fixture.seen[1]?.body, {
    chat_uuid: "local_banana_chat", prompt: original.parameters.prompt, settings: { options: { seed: 1 }, samples: [1, 2] }
  });
  assert.equal(fixture.store.getById(OWNER, job.id)?.request_hash, hashGenerationRequest(original));
  assert.equal(fixture.counts().preparations, 0);
  assert.equal(fixture.counts().legacyResolutions, 2);
});

test("accessors, proxies, custom callbacks, cycles and non-JSON inputs are rejected without executing them", async (t) => {
  let invoked = 0;
  const getter = () => { invoked += 1; throw new Error("private untrusted value"); };
  const getterRequest = request();
  Object.defineProperty(getterRequest, "parameters", { enumerable: true, get: getter });
  const getterParameters = request();
  Object.defineProperty(getterParameters.parameters, "prompt", { enumerable: true, get: getter });
  const proxy = new Proxy(request(), { ownKeys: () => { invoked += 1; throw new Error("proxy invoked"); } });
  const functionInput = request();
  functionInput.parameters.prompt = getter;
  const toJsonInput = request();
  toJsonInput.parameters.toJSON = getter;
  const cyclic = request();
  cyclic.parameters.cycle = cyclic;
  const nonfinite = request();
  nonfinite.parameters.number = NaN;
  const symbol = request();
  Object.defineProperty(symbol.parameters, Symbol("extra"), { value: 1 });
  const inherited = Object.assign(Object.create({ prompt: getter }) as object, request());
  for (const input of [getterRequest, getterParameters, proxy, functionInput, toJsonInput, cyclic, nonfinite, symbol, inherited]) {
    const fixture = harness(t);
    const create = t.mock.method(fixture.store, "createOrReplay");
    await assert.rejects(fixture.adapter.startGeneration(CONTEXT, input as GenerationRequest), hasCode("INVALID_PARAMETERS"));
    assert.equal(create.mock.callCount(), 0);
    assert.equal(fixture.counts().preparations, 0);
    assert.equal(fixture.counts().clients, 0);
  }
  assert.equal(invoked, 0);
});

test("callback errors and malformed callback outputs are fixed/redacted before I/O", async (t) => {
  const prepare = createBananaLiteRequestPreparer(new DiscoveryCatalogRepository());
  let accessors = 0;
  const hostile = Object.defineProperty({}, "prompt", { enumerable: true, get: () => { accessors += 1; throw new Error("private-prompt"); } });
  const candidates: unknown[] = [
    null, hostile, { ...prepare(request()), schema_hash: "invalid" },
    { ...prepare(request()), modality: "text" }, { ...prepare(request()), ai_name: "https://other.invalid" },
    { ...prepare(request()), prompt: "invalid\u0000prompt" },
    { ...prepare(request()), settings: { then: () => { accessors += 1; } } },
    { ...prepare(request()), extra: 1 }
  ];
  for (const output of candidates) {
    const fixture = harness(t, { preparer: () => output as PreparedSyntxMediaRequest });
    const create = t.mock.method(fixture.store, "createOrReplay");
    await assert.rejects(fixture.adapter.startGeneration(CONTEXT, request()), hasCode("INVALID_PARAMETERS"));
    assert.equal(create.mock.callCount(), 0);
    assert.equal(fixture.counts().clients, 0);
    assert.equal(fixture.counts().preparations, 1);
  }
  const fixture = harness(t, { preparer: () => { throw new Error("private-prompt private-token https://private.invalid"); } });
  await assert.rejects(fixture.adapter.startGeneration(CONTEXT, request()), (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.code, "INVALID_PARAMETERS");
    assert.equal(error.message, "The media generation request could not be safely prepared.");
    assert.equal(JSON.stringify(error).includes("private"), false);
    return true;
  });
  assert.equal(accessors, 0);
});

test("changed input or schema binding cannot replay an existing durable operation", async (t) => {
  const first = harness(t);
  await first.adapter.startGeneration(CONTEXT, request());
  const changed = request();
  changed.parameters.prompt = "different valid local prompt";
  await assert.rejects(first.adapter.startGeneration(CONTEXT, changed), hasCode("IDEMPOTENCY_CONFLICT"));
  const prepare = createBananaLiteRequestPreparer(new DiscoveryCatalogRepository());
  const second = harness(t, { store: first.store, preparer: (input) => ({ ...prepare(input), schema_hash: `sha256:${"a".repeat(64)}` }) });
  await assert.rejects(second.adapter.startGeneration(CONTEXT, request()), hasCode("IDEMPOTENCY_CONFLICT"));
  assert.deepEqual(second.seen, []);
  assert.equal(second.counts().clients, 0);
  assert.equal(first.seen.length, 2);
});

test("lost Banana Lite HTTP response stays outcome-unknown without a repeated paid POST", async (t) => {
  const fixture = harness(t, { failGeneration: true });
  await assert.rejects(fixture.adapter.startGeneration(CONTEXT, request()), hasCode("UPSTREAM_OUTCOME_UNKNOWN"));
  const record = fixture.store.getByIdempotencyKey(OWNER, CONTEXT.idempotency_key);
  assert.ok(record);
  assert.equal(record.state, "GENERATION_OUTCOME_UNKNOWN");
  assert.equal(record.receipt?.chat_uuid, "local_banana_chat");
  assert.equal(record.receipt?.message_id, null);
  await assert.rejects(fixture.adapter.startGeneration(CONTEXT, request()), hasCode("UPSTREAM_OUTCOME_UNKNOWN"));
  assert.equal(fixture.store.getById(OWNER, record.id)?.state, "GENERATION_OUTCOME_UNKNOWN");
  await assert.rejects(fixture.adapter.reconcileStart({
    principal: PRINCIPAL, idempotency_key: CONTEXT.idempotency_key,
    request_hash: hashGenerationRequest(request())
  }), hasCode("UPSTREAM_OUTCOME_UNKNOWN"));
  assert.equal(fixture.store.getById(OWNER, record.id)?.state, "TERMINAL_UNRESOLVED");
  assert.equal(fixture.seen.length, 2);
  assert.equal(fixture.seen.filter((entry) => entry.url.includes("/design/generate")).length, 1);
});

test("the default factory still blocks the candidate and cost/result gates are unchanged", async (t) => {
  const input = request();
  await assert.rejects(createDefaultApplication().startGeneration({
    model_id: input.model_id, operation_id: input.operation_id, parameters: input.parameters,
    idempotency_key: CONTEXT.idempotency_key, confirmation_id: CONTEXT.confirmation_id
  }), hasCode("COMPLIANCE_GATE_BLOCKED"));
  const fixture = harness(t);
  await assert.rejects(fixture.adapter.estimateGeneration(PRINCIPAL, input), hasCode("UPSTREAM_CAPABILITY_NOT_RESEARCHED"));
  const job = await fixture.adapter.startGeneration(CONTEXT, input);
  await assert.rejects(fixture.adapter.getResult({ principal: PRINCIPAL, job_id: job.id }), hasCode("JOB_NOT_READY"));
  assert.equal(fixture.seen.length, 2);
});
