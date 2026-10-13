import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { NodeAeadAuthLinkSecretVault } from "../src/auth/auth-link-secret-vault.js";
import { SqliteAuthLinkStore } from "../src/auth/sqlite-auth-link-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { createGenerationContractRegistry } from "../src/domain/generation-contract.js";
import { hashGenerationRequest } from "../src/application/generation-request.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { GenerationContractExecutionErrorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import { SqliteGenerationTransactionStore } from "../src/storage/sqlite-generation-transaction-store.js";
import { createDurableOwnerGenerationRuntime } from "../src/runtime/durable-owner-generation-runtime.js";

const binding = { tenant_id: "tenant_durable_owner", subject: "subject_durable_owner" } as const;
const attemptId = "link_durable_owner_attempt_000001";
const now = Date.parse("2026-10-08T13:00:00.000Z");
const fakeCredential = "synthetic-link-credential-not-for-output";
const key = new Uint8Array(32).fill(37);

function fakeAuthProvider(): AuthLinkProvider {
  return {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() {
      return { upstream_attempt_id: "synthetic-durable-owner-challenge", approval_url: "https://t.me/syntxaibot" };
    },
    async pollChallenge(_upstreamAttemptId, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: fakeCredential });
      return { state: "LINKED" };
    }
  };
}

function vault(): NodeAeadAuthLinkSecretVault {
  return new NodeAeadAuthLinkSecretVault({ resolveKey: async () => key }, "synthetic-test-key");
}

const GENERATION_TABLES = new Set([
  "generation_store_migrations",
  "generation_operations",
  "generation_operation_events",
  "generation_operation_transition_context",
  "generation_cancel_attempts",
  "generation_cancel_attempt_events"
]);
const GENERATION_TABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  generation_store_migrations: ["version", "applied_at"],
  generation_operations: [
    "id", "kind", "tenant_id", "subject_id", "connection_id", "idempotency_key", "request_hash",
    "model_id", "operation_id", "modality", "catalog_version", "schema_hash", "parameter_keys_json",
    "estimate_id", "approved_max_cost", "cost_effective", "cost_unit", "cost_observed_at", "cost_expires_at",
    "cost_cap_enforcement", "state", "receipt_chat_uuid", "receipt_provider_job_id", "receipt_message_id",
    "receipt_message_object_id", "failure_code", "dispatch_deadline", "next_poll_at", "created_at", "updated_at", "revision", "result_message_id"
  ],
  generation_operation_events: ["sequence", "generation_operation_id", "operation_revision", "event_type", "from_state", "to_state", "reason_code", "recorded_at"],
  generation_operation_transition_context: ["generation_operation_id", "expected_revision", "next_revision", "event_type", "from_state", "to_state", "reason_code", "recorded_at"],
  generation_cancel_attempts: ["generation_operation_id", "tenant_id", "subject_id", "idempotency_key", "confirmation_hash", "state", "created_at", "updated_at", "revision"],
  generation_cancel_attempt_events: ["sequence", "generation_operation_id", "attempt_revision", "event_type", "from_state", "to_state", "recorded_at"]
};
const PRIVATE_GENERATION_COLUMN = /(?:^|_)(?:prompt|settings|parameters|payload|request|body|credential|secret)(?:_|$)/iu;

function assertGenerationDatabaseHasNoPlaintextPrivacyData(
  database: DatabaseSync,
  privateMarkers: readonly string[],
  requireCompleteSchema = false
): void {
  const tables = database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string; sql: string | null }>;
  const names = new Set(tables.map((table) => table.name));
  for (const name of names) assert.equal(GENERATION_TABLES.has(name), true, `unexpected generation table ${name}`);
  if (requireCompleteSchema) {
    for (const name of ["generation_operations", "generation_operation_events", "generation_cancel_attempts", "generation_cancel_attempt_events"]) {
      assert.equal(names.has(name), true, `missing generation audit table ${name}`);
    }
  }

  for (const table of tables) {
    assert.equal(typeof table.sql, "string");
    const quotedName = `"${table.name.replaceAll('"', '""')}"`;
    const columns = database.prepare(`PRAGMA table_info(${quotedName})`).all() as Array<{ name: string }>;
    const allowedColumns = GENERATION_TABLE_COLUMNS[table.name];
    assert.ok(allowedColumns, `missing schema contract for ${table.name}`);
    for (const column of columns) assert.ok(allowedColumns.includes(column.name), `unexpected column ${table.name}.${column.name}`);
    if (requireCompleteSchema) assert.deepEqual(columns.map((column) => column.name), allowedColumns, `unexpected ${table.name} schema`);
    for (const column of columns) {
      if (column.name === "parameter_keys_json" || column.name === "request_hash") continue;
      assert.equal(PRIVATE_GENERATION_COLUMN.test(column.name), false, `private value column ${table.name}.${column.name}`);
    }
    const rows = database.prepare(`SELECT * FROM ${quotedName}`).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      for (const [field, value] of Object.entries(row)) {
        if (field === "parameter_keys_json") {
          const keys: unknown = JSON.parse(String(value));
          assert.ok(Array.isArray(keys), "parameter_keys_json must contain parameter names only");
          for (const entry of keys as unknown[]) {
            assert.equal(typeof entry, "string", "parameter_keys_json cannot contain request values or nested structures");
            assert.match(entry as string, /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u);
            assert.equal(["1K", "minimal", "1:1"].includes(entry as string), false, "parameter_keys_json cannot contain setting values");
          }
        }
        if (typeof value === "string") {
          for (const marker of privateMarkers) assert.equal(value.includes(marker), false, `plaintext marker in ${table.name}.${field}`);
        }
      }
    }
  }
}

function assertAuthDatabaseHasNoPlaintextSecrets(databasePath: string, privateMarkers: readonly string[]): void {
  const database = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false });
  try {
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
    assert.deepEqual(new Set(tables.map((table) => table.name)), new Set(["auth_link_store_migrations", "auth_link_attempts"]));
    const columns = database.prepare("PRAGMA table_info(auth_link_attempts)").all() as Array<{ name: string }>;
    assert.deepEqual(columns.map((column) => column.name), [
      "attempt_id", "tenant_id", "subject", "status", "expires_at_ms", "upstream_attempt_id",
      "credential_envelope_json", "handoff_in_flight", "poll_in_flight", "lease_expires_at_ms", "revision",
      "upstream_attempt_envelope_json", "cleanup_envelope_json"
    ]);
    const rows = database.prepare("SELECT * FROM auth_link_attempts").all() as Array<Record<string, unknown>>;
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(row.upstream_attempt_id, null, "upstream challenge identifiers must use the encrypted envelope");
      for (const [field, value] of Object.entries(row)) {
        if (field.endsWith("_envelope_json")) {
          if (value === null) continue;
          assertAuthEnvelopeIsOpaque(String(value), privateMarkers);
          continue;
        }
        if (typeof value !== "string") continue;
        for (const marker of privateMarkers) assert.equal(value.includes(marker), false, `plaintext marker in auth_link_attempts.${field}`);
      }
    }
  } finally {
    database.close();
  }
}

function assertAuthEnvelopeIsOpaque(serialized: string, privateMarkers: readonly string[]): void {
  for (const marker of privateMarkers) assert.equal(serialized.includes(marker), false, "plaintext marker in encrypted auth envelope");
  const envelope = JSON.parse(serialized) as Record<string, unknown>;
  assert.deepEqual(Object.keys(envelope).sort(), [
    "algorithm", "auth_tag_b64", "ciphertext_b64", "key_handle", "nonce_b64", "schema_version"
  ].sort(), "auth envelopes cannot carry undeclared plaintext fields");
  assert.equal(envelope.algorithm, "aes-256-gcm");
  assert.equal(typeof envelope.ciphertext_b64, "string");
}

function assertSqliteFilesDoNotContainLongPlaintextMarkers(databasePath: string, privateMarkers: readonly string[]): void {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path, "latin1");
    for (const marker of privateMarkers) assert.equal(bytes.includes(marker), false, `long plaintext marker in SQLite file ${path}`);
  }
}

function reviewedRegistry(
  catalog: ReturnType<typeof loadSelectedDiscoveryCatalog>["discoveryCatalog"],
  modelId = "banana",
  staleSourceHashes = false
) {
  const model = catalog.getModel(modelId);
  assert.equal(model.active, true);
  assert.equal(model.operations.some((operation) => operation.id === "generate-image"), true);
  const schemaHash = `sha256:${"b".repeat(64)}`;
  const sourceHashes = staleSourceHashes
    ? { ...catalog.source_hashes, ai: `sha256:${"c".repeat(64)}` }
    : catalog.source_hashes;
  return createGenerationContractRegistry({
    schema_version: "1.0.0",
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: sourceHashes,
    contracts: [{
      model_id: model.id,
      operation_id: "generate-image",
      modality: "image",
      route: "design",
      ai_name: model.ai_name,
      model_type: model.upstream_id,
      status: "reviewed",
      provenance: {
        settings_source_sha256: schemaHash,
        references: [
          { kind: "public_catalog", reference: "selected public test snapshot", sha256: sourceHashes.models },
          { kind: "frontend_static", reference: "synthetic test evidence", sha256: schemaHash },
          { kind: "manual_review", reference: "synthetic offline fixture" }
        ],
        reviewed_at: "2026-10-08T00:00:00.000Z"
      },
      parameters: {
        type: "object",
        additional_properties: false,
        required: ["prompt"],
        properties: {
          prompt: { type: "string", min_length: 1, max_length: 256 },
          aspect_ratio: { type: "string", enum: ["1:1"] }
        },
        conditions: []
      },
      wire: { prompt_field: "prompt", settings_fields: { aspect_ratio: "aspect_ratio" }, fixed_settings: {} },
      output: { decoder_profile: "synthetic-image-v1", mime_types: ["image/png"] },
      limits: { max_parameters: 8, max_value_depth: 3, max_serialized_bytes: 4096 }
    }]
  });
}

async function linkAccount(authDatabasePath: string): Promise<void> {
  const store = new SqliteAuthLinkStore(authDatabasePath, { vault: vault(), now: () => now });
  const service = new PerUserLinkService(fakeAuthProvider(), store, {
    now: () => now,
    attemptIdGenerator: () => attemptId
  });
  try {
    await service.createAttempt(binding);
    await service.issueHandoff(binding, attemptId);
    const linked = await service.checkAttempt(binding, attemptId);
    assert.equal(linked.linked, true);
    assert.equal(linked.status, "LINKED");
  } finally {
    store.close();
  }
}

test("durable owner composition reopens SQLite and replays accepted generation without a second POST", async (t) => {
  const profileDirectory = mkdtempSync(join(tmpdir(), "syntx-durable-owner-"));
  chmodSync(profileDirectory, 0o700);
  t.after(() => rmSync(profileDirectory, { recursive: true, force: true }));
  const authDatabasePath = join(profileDirectory, "auth.sqlite");
  const generationDatabasePath = join(profileDirectory, "generation.sqlite");
  await linkAccount(authDatabasePath);

  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  const registry = reviewedRegistry(catalog);
  const requests: string[] = [];
  let subscriptionReads = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url.pathname}${url.search}`);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${fakeCredential}`);
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        title: "mcp-generation-generation_durable_owner_test_0001",
        scope: "image"
      });
      return json({ uuid: "synthetic-durable-owner-chat" });
    }
    if (url.pathname === "/api/v1/design/generate" && method === "POST") {
      assert.equal(url.searchParams.get("ai_name"), "banana");
      const body = JSON.parse(String(init?.body)) as { settings: Record<string, unknown>; prompt: string };
      assert.equal(body.prompt, "synthetic restart test");
      assert.equal(body.settings.model_type, "banana");
      assert.equal(body.settings.aspect_ratio, "1:1");
      return json({ id: 72 });
    }
    throw new Error("Unexpected synthetic upstream request.");
  };

  const makeRuntime = () => createDurableOwnerGenerationRuntime({
    profileDirectory,
    createAuthContext: () => {
      const authStore = new SqliteAuthLinkStore(authDatabasePath, { vault: vault(), now: () => now });
      return {
        store: authStore,
        linkService: new PerUserLinkService(fakeAuthProvider(), authStore, { now: () => now }),
        binding,
        attemptId
      };
    },
    createTransactionStore: () => new SqliteGenerationTransactionStore(generationDatabasePath, { now: () => new Date(now) }),
    catalog,
    registry,
    offlineSubscriptionReader: async (requestedAttemptId) => {
      subscriptionReads += 1;
      assert.equal(requestedAttemptId, attemptId);
      return { active: true, plan_type: "Elite", end_date: null, end_date_kind: null };
    },
    offlineFetchImpl: fetchImpl,
    now: () => new Date(now),
    createOperationId: () => "generation_durable_owner_test_0001"
  });

  const runtime = await makeRuntime();
  assert.equal(runtime.mode, "OFFLINE_VALIDATION_ONLY");
  assert.equal(runtime.contract_status, "REGISTRY_VALIDATED");
  assert.equal(runtime.principal.connection_id, attemptId);

  const request = {
    model_id: "banana",
    operation_id: "generate-image",
    parameters: { prompt: "synthetic restart test", aspect_ratio: "1:1" },
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`
  };
  const context = {
    principal: runtime.principal,
    idempotency_key: "durable-owner-restart-key",
    confirmation_id: "synthetic-test-confirmation",
    approved_max_cost_tokens: 8
  };
  const started = await runtime.adapter.startGeneration(context, request);
  assert.equal(subscriptionReads, 1, "the adapter boundary must run the exact-attempt preflight automatically");
  const stored = runtime.transactionStore.getById(
    { tenant_id: runtime.principal.tenant_id, subject_id: runtime.principal.subject_id },
    started.id
  );
  assert.equal(stored?.principal.connection_id, attemptId);
  assert.equal(stored?.cost.cap_enforcement, "UNENFORCEABLE");
  assert.equal(requests.length, 2);
  assert.equal(JSON.stringify(stored).includes(fakeCredential), false);
  await runtime.close();
  assertAuthDatabaseHasNoPlaintextSecrets(authDatabasePath, [fakeCredential]);

  const reopened = await makeRuntime();
  const replay = await reopened.adapter.reconcileStart({
    principal: reopened.principal,
    idempotency_key: context.idempotency_key,
    request_hash: hashGenerationRequest(request)
  });
  assert.equal(replay?.id, started.id);
  assert.equal(requests.length, 2, "recovery/replay must not repeat either POST");
  await reopened.close();
  await assert.rejects(
    reopened.adapter.startGeneration({
      principal: reopened.principal,
      idempotency_key: "after-close-must-not-dispatch",
      confirmation_id: "synthetic-test-confirmation",
      approved_max_cost_tokens: 8
    }, request),
    /OWNER_GENERATION_PROFILE_LEASE_LOST/u
  );
  assert.equal(requests.length, 2, "a closed profile must not dispatch to even an injected fake gateway");
});

test("durable V2 owner generation reopens the exact receipt for GET-only result recovery", async (t) => {
  const profileDirectory = mkdtempSync(join(tmpdir(), "syntx-durable-owner-v2-restart-"));
  chmodSync(profileDirectory, 0o700);
  t.after(() => rmSync(profileDirectory, { recursive: true, force: true }));
  const authDatabasePath = join(profileDirectory, "auth.sqlite");
  const generationDatabasePath = join(profileDirectory, "generation.sqlite");
  await linkAccount(authDatabasePath);
  const privatePrompt = "synthetic-v2-private-prompt-marker-6cda2c11d3804b57a18a";

  const registry = loadGenerationContractRegistryV2(
    "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json",
    join(process.cwd(), "catalog")
  );
  const catalog = loadSelectedDiscoveryCatalog(
    DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    join(process.cwd(), "catalog")
  ).discoveryCatalog;
  const variants = registry.contracts.filter((contract) =>
    contract.model_id === "banana-2.1" && contract.operation_id === "generate-image" && contract.status === "live_verified"
  );
  const firstVariant = variants.find((contract) => contract.variant_id === "banana21-image-1k-minimal-square");
  const secondVariant = variants.find((contract) => contract.variant_id === "banana21-image-2k-medium-landscape");
  assert.ok(firstVariant);
  assert.ok(secondVariant);
  assert.notEqual(firstVariant.schema_hash, secondVariant.schema_hash);

  const requests: Array<{ method: string; path: string }> = [];
  let subscriptionReads = 0;
  let modelLookups = 0;
  const observableCatalog = new Proxy(catalog, {
    get(target, property) {
      if (property === "getModel") {
        return (modelId: string) => {
          modelLookups += 1;
          return target.getModel(modelId);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const chatUuid = "synthetic_v2_restart_chat";
  const messageId = "synthetic_v2_restart_message";
  const artifactUrl = "https://r2.syntx.ai/synthetic-v2-restart.jpg";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    requests.push({ method, path: url.pathname });
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${fakeCredential}`);
    if (method === "POST" && url.pathname === "/api/v1/chats") {
      return json({ uuid: chatUuid });
    }
    if (method === "POST" && url.pathname === "/api/v1/design/generate") {
      assert.equal(url.searchParams.get("ai_name"), "banana");
      const body = JSON.parse(String(init?.body)) as { prompt: string; settings: Record<string, unknown> };
      assert.equal(body.prompt, privatePrompt);
      assert.deepEqual(body.settings, {
        model_type: "banana-2.1", aspect_ratio: "1:1", image_size: "1K", thinking_level: "minimal", n: 1, file_urls: []
      });
      return json({ id: messageId });
    }
    if (method === "GET" && url.pathname === `/api/v1/chats/${chatUuid}/${messageId}`) {
      return json({
        id: messageId,
        author_id: -1,
        message_object: [{
          id: "synthetic_v2_restart_object",
          object_type: "image",
          model_type: "banana-2.1",
          completed: true,
          object_url: artifactUrl
        }]
      });
    }
    throw new Error("Unexpected synthetic V2 restart request.");
  };
  const makeRuntime = (
    variantId: string | undefined,
    selectedCatalog: typeof catalog = observableCatalog,
    operationId = "generation_public_metadata_1K_0001"
  ) => createDurableOwnerGenerationRuntime({
    profileDirectory,
    createAuthContext: () => {
      const authStore = new SqliteAuthLinkStore(authDatabasePath, { vault: vault(), now: () => now });
      return {
        store: authStore,
        linkService: new PerUserLinkService(fakeAuthProvider(), authStore, { now: () => now }),
        binding,
        attemptId
      };
    },
    createTransactionStore: () => new SqliteGenerationTransactionStore(generationDatabasePath, { now: () => new Date(now) }),
    catalog: selectedCatalog,
    registry,
    v2VariantSelections: variantId === undefined ? [] : [{
      model_id: "banana-2.1", operation_id: "generate-image", variant_id: variantId
    }],
    offlineSubscriptionReader: async (requestedAttemptId) => {
      subscriptionReads += 1;
      assert.equal(requestedAttemptId, attemptId);
      return { active: true, plan_type: "Elite", end_date: null, end_date_kind: null };
    },
    offlineFetchImpl: fetchImpl,
    now: () => new Date(now),
    createOperationId: () => operationId
  });
  const request = {
    model_id: "banana-2.1",
    operation_id: "generate-image",
    parameters: { prompt: privatePrompt },
    catalog_version: registry.catalog_version
  };
  const context = {
    idempotency_key: "durable-owner-v2-restart-key",
    confirmation_id: "synthetic-v2-owner-confirmation",
    approved_max_cost_tokens: 8
  };

  const first = await makeRuntime(firstVariant.variant_id);
  assert.equal(first.mode, "OFFLINE_VALIDATION_ONLY");
  const started = await first.adapter.startGeneration({ ...context, principal: first.principal }, request);
  assert.equal(started.status, "queued");
  assert.equal(started.id, "generation_public_metadata_1K_0001");
  assert.equal(subscriptionReads, 1);
  assert.equal(requests.filter((call) => call.method === "POST").length, 2);
  const stored = first.transactionStore.getById({ tenant_id: binding.tenant_id, subject_id: binding.subject }, started.id);
  assert.equal(stored?.schema_hash, firstVariant.schema_hash, "the selected V2 schema hash is persisted in the existing ledger");
  assert.deepEqual(stored?.parameter_keys, ["prompt"]);
  assert.deepEqual(stored?.receipt, {
    chat_uuid: chatUuid, provider_job_id: null, message_id: messageId, message_object_id: null
  });
  await first.close();
  const privateMarkers = [privatePrompt, fakeCredential, artifactUrl];
  assertSqliteFilesDoNotContainLongPlaintextMarkers(generationDatabasePath, privateMarkers);
  assertSqliteFilesDoNotContainLongPlaintextMarkers(authDatabasePath, privateMarkers);
  const generationInspection = new DatabaseSync(generationDatabasePath, { readOnly: true, allowExtension: false });
  try {
    assertGenerationDatabaseHasNoPlaintextPrivacyData(generationInspection, privateMarkers, true);
  } finally {
    generationInspection.close();
  }
  assertAuthDatabaseHasNoPlaintextSecrets(authDatabasePath, privateMarkers);

  const negativeFixture = new DatabaseSync(":memory:", { allowExtension: false });
  try {
    negativeFixture.exec("CREATE TABLE generation_operations (id TEXT, parameter_keys_json TEXT)");
    negativeFixture.prepare("INSERT INTO generation_operations VALUES (?, ?)").run("generation_public_metadata_1K_fixture", '["prompt"]');
    assert.doesNotThrow(() => assertGenerationDatabaseHasNoPlaintextPrivacyData(negativeFixture, privateMarkers));
    negativeFixture.prepare("UPDATE generation_operations SET parameter_keys_json = ? WHERE id = ?")
      .run(JSON.stringify({ prompt: privatePrompt, settings: { image_size: "1K", thinking_level: "minimal", aspect_ratio: "1:1" } }), "generation_public_metadata_1K_fixture");
    assert.throws(
      () => assertGenerationDatabaseHasNoPlaintextPrivacyData(negativeFixture, privateMarkers),
      /parameter_keys_json must contain parameter names only/u
    );
  } finally {
    negativeFixture.close();
  }

  const negativeAuthEnvelope = JSON.stringify({
    schema_version: "1.0.0", algorithm: "aes-256-gcm", key_handle: "synthetic-test-key",
    nonce_b64: "opaque", ciphertext_b64: "opaque", auth_tag_b64: "opaque", plaintext_credential: fakeCredential
  });
  assert.throws(
    () => assertAuthEnvelopeIsOpaque(negativeAuthEnvelope, privateMarkers),
    /plaintext marker in encrypted auth envelope/u
  );

  const reopened = await makeRuntime(undefined, observableCatalog);
  await assert.rejects(reopened.assertGenerationAllowed(request),
    (error: unknown) => error instanceof GenerationContractExecutionErrorV2 && error.code === "GENERATION_CONTRACT_VARIANT_AMBIGUOUS");
  const catalogLookupsBeforeGet = modelLookups;
  const job = await reopened.adapter.getJob({ principal: reopened.principal, job_id: started.id });
  assert.equal(job.status, "succeeded");
  const result = await reopened.adapter.getResult({ principal: reopened.principal, job_id: started.id });
  assert.equal(result.artifacts[0]?.mime_type, "image/jpeg");
  assert.equal(result.artifacts[0]?.download_url, artifactUrl);
  assert.equal(subscriptionReads, 1, "only the first dispatch checked entitlement");
  assert.equal(modelLookups, catalogLookupsBeforeGet, "readback does not consult the current model catalog or selector");
  assert.equal(requests.filter((call) => call.method === "POST").length, 2, "restart performs no chat or generation POST");
  const getsAfterRecovery = requests.filter((call) => call.method === "GET").length;
  assert.ok(getsAfterRecovery >= 2);
  await assert.rejects(reopened.adapter.getJob({
    principal: { ...reopened.principal, connection_id: "link_different_attempt_000000001" },
    job_id: started.id
  }));
  assert.equal(requests.filter((call) => call.method === "GET").length, getsAfterRecovery, "cross-attempt reads do not reach upstream");

  await reopened.close();
  const changedVariant = await makeRuntime(secondVariant.variant_id);
  await assert.rejects(
    changedVariant.adapter.startGeneration({ ...context, principal: changedVariant.principal }, request),
    (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "IDEMPOTENCY_CONFLICT"
  );
  assert.equal(requests.filter((call) => call.method === "POST").length, 2, "same key and payload with another V2 variant conflicts before dispatch");
  await changedVariant.close();
});

test("durable reviewed-contract start does not depend on the legacy owner profile list", async (t) => {
  const profileDirectory = mkdtempSync(join(tmpdir(), "syntx-durable-owner-general-contract-"));
  chmodSync(profileDirectory, 0o700);
  t.after(() => rmSync(profileDirectory, { recursive: true, force: true }));
  const authDatabasePath = join(profileDirectory, "auth.sqlite");
  const generationDatabasePath = join(profileDirectory, "generation.sqlite");
  await linkAccount(authDatabasePath);

  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  const model = catalog.getModel("banana-2.1");
  assert.equal(model.active, true);
  assert.equal(model.operations.some((operation) => operation.id === "generate-image"), true);
  const requests: string[] = [];
  const runtime = await createDurableOwnerGenerationRuntime({
    profileDirectory,
    createAuthContext: () => {
      const authStore = new SqliteAuthLinkStore(authDatabasePath, { vault: vault(), now: () => now });
      return { store: authStore, linkService: new PerUserLinkService(fakeAuthProvider(), authStore), binding, attemptId };
    },
    createTransactionStore: () => new SqliteGenerationTransactionStore(generationDatabasePath, { now: () => new Date(now) }),
    catalog,
    registry: reviewedRegistry(catalog, "banana-2.1"),
    offlineSubscriptionReader: async (requestedAttemptId) => {
      assert.equal(requestedAttemptId, attemptId);
      return { active: true, plan_type: "Elite", end_date: null, end_date_kind: null };
    },
    offlineFetchImpl: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      requests.push(`${method} ${url.pathname}`);
      if (url.pathname === "/api/v1/chats" && method === "POST") return json({ uuid: "synthetic-general-contract-chat" });
      if (url.pathname === "/api/v1/design/generate" && method === "POST") return json({ id: 73 });
      throw new Error("Unexpected synthetic upstream request.");
    },
    now: () => new Date(now),
    createOperationId: () => "generation_durable_owner_general_contract_0001"
  });

  const request = {
    model_id: "banana-2.1",
    operation_id: "generate-image",
    parameters: { prompt: "synthetic general contract test", aspect_ratio: "1:1" },
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`
  };
  const started = await runtime.adapter.startGeneration({
    principal: runtime.principal,
    idempotency_key: "general-reviewed-contract",
    confirmation_id: "synthetic-test-confirmation",
    approved_max_cost_tokens: 8
  }, request);
  assert.equal(started.model_id, "banana-2.1");
  assert.deepEqual(requests, ["POST /api/v1/chats", "POST /api/v1/design/generate"]);
  await runtime.close();
});

test("durable V2 dispatch with a lost receipt remains unresolved and is never repeated", async (t) => {
  const profileDirectory = mkdtempSync(join(tmpdir(), "syntx-durable-owner-v2-unknown-"));
  chmodSync(profileDirectory, 0o700);
  t.after(() => rmSync(profileDirectory, { recursive: true, force: true }));
  const authDatabasePath = join(profileDirectory, "auth.sqlite");
  const generationDatabasePath = join(profileDirectory, "generation.sqlite");
  await linkAccount(authDatabasePath);
  const registry = loadGenerationContractRegistryV2(
    "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json",
    join(process.cwd(), "catalog")
  );
  const catalog = loadSelectedDiscoveryCatalog(
    DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    join(process.cwd(), "catalog")
  ).discoveryCatalog;
  const modelLookups: string[] = [];
  const noCurrentModelCatalog = new Proxy(catalog, {
    get(target, property) {
      if (property === "getModel") return (modelId: string) => {
        modelLookups.push(modelId);
        throw new Error("current model lookup must not be needed for recovery");
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const requests: Array<{ method: string; path: string }> = [];
  let generationDispatches = 0;
  let subscriptionReads = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    requests.push({ method, path: url.pathname });
    if (method === "POST" && url.pathname === "/api/v1/chats") return json({ uuid: "synthetic_v2_unknown_chat" });
    if (method === "POST" && url.pathname === "/api/v1/design/generate") {
      generationDispatches += 1;
      throw new Error("synthetic response lost after upstream may have accepted the one dispatch");
    }
    throw new Error("No recovery GET is permitted without a correlated message receipt.");
  };
  const makeRuntime = (
    selections: readonly { model_id: string; operation_id: string; variant_id: string }[],
    selectedCatalog: typeof catalog,
    operationId: string
  ) => createDurableOwnerGenerationRuntime({
    profileDirectory,
    createAuthContext: () => {
      const authStore = new SqliteAuthLinkStore(authDatabasePath, { vault: vault(), now: () => now });
      return { store: authStore, linkService: new PerUserLinkService(fakeAuthProvider(), authStore, { now: () => now }), binding, attemptId };
    },
    createTransactionStore: () => new SqliteGenerationTransactionStore(generationDatabasePath, { now: () => new Date(now) }),
    catalog: selectedCatalog,
    registry,
    v2VariantSelections: selections,
    offlineSubscriptionReader: async (requestedAttemptId) => {
      subscriptionReads += 1;
      assert.equal(requestedAttemptId, attemptId);
      return { active: true, plan_type: "Elite", end_date: null, end_date_kind: null };
    },
    offlineFetchImpl: fetchImpl,
    now: () => new Date(now),
    createOperationId: () => operationId
  });
  const request = {
    model_id: "banana-2.1",
    operation_id: "generate-image",
    parameters: { prompt: "synthetic V2 uncertain dispatch" },
    catalog_version: registry.catalog_version
  };
  const selected = [{ model_id: "banana-2.1", operation_id: "generate-image", variant_id: "banana21-image-1k-minimal-square" }];
  const first = await makeRuntime(selected, catalog, "generation_durable_owner_v2_unknown_0001");
  await assert.rejects(first.adapter.startGeneration({
    principal: first.principal, idempotency_key: "durable-owner-v2-unknown-key",
    confirmation_id: "synthetic-v2-owner-confirmation", approved_max_cost_tokens: 8
  }, request), (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "UPSTREAM_OUTCOME_UNKNOWN");
  assert.equal(generationDispatches, 1);
  const owner = { tenant_id: binding.tenant_id, subject_id: binding.subject };
  const uncertain = first.transactionStore.getByIdempotencyKey(owner, "durable-owner-v2-unknown-key");
  assert.equal(uncertain?.state, "GENERATION_OUTCOME_UNKNOWN");
  assert.equal(uncertain?.receipt?.chat_uuid, "synthetic_v2_unknown_chat");
  assert.equal(uncertain?.receipt?.message_id, null);
  await first.close();

  const reopened = await makeRuntime([], noCurrentModelCatalog, "generation_durable_owner_v2_unknown_0002");
  await assert.rejects(reopened.adapter.reconcileStart({
    principal: reopened.principal,
    idempotency_key: "durable-owner-v2-unknown-key",
    request_hash: hashGenerationRequest(request)
  }), (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "UPSTREAM_OUTCOME_UNKNOWN");
  const terminal = reopened.transactionStore.getByIdempotencyKey(owner, "durable-owner-v2-unknown-key");
  assert.equal(terminal?.state, "TERMINAL_UNRESOLVED");
  assert.equal(generationDispatches, 1);
  assert.equal(requests.filter((entry) => entry.method === "GET").length, 0);
  assert.equal(subscriptionReads, 1, "recovery does not re-run entitlement preflight");
  assert.deepEqual(modelLookups, [], "recovery does not re-run current model discovery");
  await reopened.close();
});

test("foreign generation principals are rejected before owner subscription, journal, or gateway access", async (t) => {
  const profileDirectory = mkdtempSync(join(tmpdir(), "syntx-durable-owner-foreign-principal-"));
  chmodSync(profileDirectory, 0o700);
  t.after(() => rmSync(profileDirectory, { recursive: true, force: true }));
  const authDatabasePath = join(profileDirectory, "auth.sqlite");
  const generationDatabasePath = join(profileDirectory, "generation.sqlite");
  await linkAccount(authDatabasePath);

  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  let subscriptionReads = 0;
  let gatewayRequests = 0;
  const runtime = await createDurableOwnerGenerationRuntime({
    profileDirectory,
    createAuthContext: () => {
      const authStore = new SqliteAuthLinkStore(authDatabasePath, { vault: vault(), now: () => now });
      return { store: authStore, linkService: new PerUserLinkService(fakeAuthProvider(), authStore), binding, attemptId };
    },
    createTransactionStore: () => new SqliteGenerationTransactionStore(generationDatabasePath, { now: () => new Date(now) }),
    catalog,
    registry: reviewedRegistry(catalog),
    offlineSubscriptionReader: async () => {
      subscriptionReads += 1;
      return { active: true, plan_type: "Elite", end_date: null, end_date_kind: null };
    },
    offlineFetchImpl: async () => {
      gatewayRequests += 1;
      throw new Error("foreign principal must be rejected before fake transport");
    },
    now: () => new Date(now),
    createOperationId: () => "generation_durable_owner_foreign_principal_0001"
  });
  const request = {
    model_id: "banana",
    operation_id: "generate-image",
    parameters: { prompt: "synthetic foreign principal test", aspect_ratio: "1:1" },
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`
  };
  const ownerPrincipal = runtime.principal;
  const foreignPrincipals = [
    { ...ownerPrincipal, tenant_id: "tenant_other" },
    { ...ownerPrincipal, subject_id: "subject_other" },
    { ...ownerPrincipal, connection_id: "link_other_attempt_000001" }
  ];
  for (const [index, principal] of foreignPrincipals.entries()) {
    const idempotencyKey = `foreign-principal-${index}`;
    await assert.rejects(
      runtime.adapter.startGeneration({
        principal,
        idempotency_key: idempotencyKey,
        confirmation_id: "synthetic-test-confirmation",
        approved_max_cost_tokens: 8
      }, request),
      (error: unknown) => error && typeof error === "object" && "code" in error && error.code === "INVALID_PARAMETERS"
    );
    assert.equal(runtime.transactionStore.getByIdempotencyKey(
      { tenant_id: ownerPrincipal.tenant_id, subject_id: ownerPrincipal.subject_id },
      idempotencyKey
    ), null);
  }
  assert.equal(subscriptionReads, 0);
  assert.equal(gatewayRequests, 0);
  await runtime.close();
});

test("durable reviewed-contract gate rejects inactive or stale catalog bindings before traffic", async (t) => {
  const sourceCatalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  const snapshot = loadPublicCatalogVersion(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
  class InactiveDiscoveryCatalog extends DiscoveryCatalogRepository {
    override getModel(modelId: string) {
      const model = super.getModel(modelId);
      return modelId === "banana-2.1" ? { ...model, active: false } : model;
    }
  }
  const inactiveCatalog = new InactiveDiscoveryCatalog(snapshot);
  const cases = [
    { label: "inactive model", catalog: inactiveCatalog, registry: reviewedRegistry(sourceCatalog, "banana-2.1") },
    { label: "stale source hashes", catalog: sourceCatalog, registry: reviewedRegistry(sourceCatalog, "banana-2.1", true) }
  ];
  for (const scenario of cases) {
    const profileDirectory = mkdtempSync(join(tmpdir(), `syntx-durable-owner-${scenario.label.replaceAll(" ", "-")}-`));
    chmodSync(profileDirectory, 0o700);
    t.after(() => rmSync(profileDirectory, { recursive: true, force: true }));
    const authDatabasePath = join(profileDirectory, "auth.sqlite");
    const generationDatabasePath = join(profileDirectory, "generation.sqlite");
    await linkAccount(authDatabasePath);
    let upstreamRequests = 0;
    const runtime = await createDurableOwnerGenerationRuntime({
      profileDirectory,
      createAuthContext: () => {
        const authStore = new SqliteAuthLinkStore(authDatabasePath, { vault: vault(), now: () => now });
        return { store: authStore, linkService: new PerUserLinkService(fakeAuthProvider(), authStore), binding, attemptId };
      },
      createTransactionStore: () => new SqliteGenerationTransactionStore(generationDatabasePath, { now: () => new Date(now) }),
      catalog: scenario.catalog,
      registry: scenario.registry,
      offlineSubscriptionReader: async () => ({ active: true, plan_type: "Elite", end_date: null, end_date_kind: null }),
      offlineFetchImpl: async () => { upstreamRequests += 1; throw new Error("blocked preflight must not reach fake transport"); },
      now: () => new Date(now),
      createOperationId: () => `generation_durable_owner_block_${upstreamRequests}`
    });
    const request = {
      model_id: "banana-2.1",
      operation_id: "generate-image",
      parameters: { prompt: "synthetic blocked contract test", aspect_ratio: "1:1" },
      catalog_version: `${scenario.catalog.fetched_at}.${scenario.catalog.source_hashes.models.slice(7, 19)}`
    };
    await assert.rejects(() => runtime.adapter.startGeneration({
      principal: runtime.principal,
      idempotency_key: `blocked-${scenario.label.replaceAll(" ", "-")}`,
      confirmation_id: "synthetic-test-confirmation",
      approved_max_cost_tokens: 8
    }, request));
    assert.equal(upstreamRequests, 0, `${scenario.label} must fail before any fake upstream request`);
    assert.equal(runtime.transactionStore.getByIdempotencyKey(
      { tenant_id: runtime.principal.tenant_id, subject_id: runtime.principal.subject_id },
      `blocked-${scenario.label.replaceAll(" ", "-")}`
    ), null, `${scenario.label} must fail before journal intent`);
    await runtime.close();
  }
});

test("durable owner profile lock prevents a second runtime from recovering an active profile", async (t) => {
  const profileDirectory = mkdtempSync(join(tmpdir(), "syntx-durable-owner-lock-"));
  chmodSync(profileDirectory, 0o700);
  t.after(() => rmSync(profileDirectory, { recursive: true, force: true }));
  const authDatabasePath = join(profileDirectory, "auth.sqlite");
  const generationDatabasePath = join(profileDirectory, "generation.sqlite");
  await linkAccount(authDatabasePath);
  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  let transactionStoreCreations = 0;
  let upstreamRequests = 0;
  const options = {
    profileDirectory,
    createAuthContext: () => {
      const authStore = new SqliteAuthLinkStore(authDatabasePath, { vault: vault(), now: () => now });
      return { store: authStore, linkService: new PerUserLinkService(fakeAuthProvider(), authStore), binding, attemptId };
    },
    createTransactionStore: () => {
      transactionStoreCreations += 1;
      return new SqliteGenerationTransactionStore(generationDatabasePath, { now: () => new Date(now) });
    },
    catalog,
    registry: null,
    offlineSubscriptionReader: async () => ({ active: true, plan_type: "Elite", end_date: null, end_date_kind: null }),
    offlineFetchImpl: async () => {
      upstreamRequests += 1;
      throw new Error("Offline-only composition must not dispatch.");
    }
  };
  const first = await createDurableOwnerGenerationRuntime(options);
  assert.equal(first.contract_status, "REGISTRY_NOT_SUPPLIED");
  const version = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  await assert.rejects(
    first.adapter.startGeneration({
      principal: first.principal,
      idempotency_key: "offline-only-key",
      confirmation_id: "synthetic-confirmation",
      approved_max_cost_tokens: 1
    }, { model_id: "banana", operation_id: "generate-image", parameters: { prompt: "offline" }, catalog_version: version }),
    /GENERATION_CONTRACT_NOT_AVAILABLE/u
  );
  assert.equal(first.transactionStore.getByIdempotencyKey({ tenant_id: first.principal.tenant_id, subject_id: first.principal.subject_id }, "offline-only-key"), null);
  assert.equal(upstreamRequests, 0);
  await assert.rejects(
    () => createDurableOwnerGenerationRuntime(options),
    /OWNER_GENERATION_PROFILE_ALREADY_RUNNING/u
  );
  assert.equal(transactionStoreCreations, 1, "second owner must fail before opening/recovering stores");
  assert.equal(upstreamRequests, 0);
  await first.close();
});

test("default offline transport never calls ambient fetch and records the uncertain chat outcome", async (t) => {
  const profileDirectory = mkdtempSync(join(tmpdir(), "syntx-durable-owner-no-network-"));
  chmodSync(profileDirectory, 0o700);
  t.after(() => rmSync(profileDirectory, { recursive: true, force: true }));
  const authDatabasePath = join(profileDirectory, "auth.sqlite");
  const generationDatabasePath = join(profileDirectory, "generation.sqlite");
  await linkAccount(authDatabasePath);

  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  let ambientFetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    ambientFetchCalls += 1;
    throw new Error("ambient fetch must never be used by offline owner composition");
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const runtime = await createDurableOwnerGenerationRuntime({
    profileDirectory,
    createAuthContext: () => {
      const authStore = new SqliteAuthLinkStore(authDatabasePath, { vault: vault(), now: () => now });
      return { store: authStore, linkService: new PerUserLinkService(fakeAuthProvider(), authStore), binding, attemptId };
    },
    createTransactionStore: () => new SqliteGenerationTransactionStore(generationDatabasePath, { now: () => new Date(now) }),
    catalog,
    registry: reviewedRegistry(catalog),
    offlineSubscriptionReader: async (requestedAttemptId) => {
      assert.equal(requestedAttemptId, attemptId);
      return { active: true, plan_type: "Elite", end_date: null, end_date_kind: null };
    },
    now: () => new Date(now),
    createOperationId: () => "generation_durable_owner_no_network_0001"
  });

  const version = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  await assert.rejects(
    runtime.adapter.startGeneration({
      principal: runtime.principal,
      idempotency_key: "offline-default-denies-network",
      confirmation_id: "synthetic-test-confirmation",
      approved_max_cost_tokens: 8
    }, {
      model_id: "banana",
      operation_id: "generate-image",
      parameters: { prompt: "synthetic no-network test", aspect_ratio: "1:1" },
      catalog_version: version
    }),
    (error: unknown) => error && typeof error === "object" && "code" in error && error.code === "UPSTREAM_OUTCOME_UNKNOWN"
  );
  assert.equal(ambientFetchCalls, 0);
  const record = runtime.transactionStore.getByIdempotencyKey(
    { tenant_id: runtime.principal.tenant_id, subject_id: runtime.principal.subject_id },
    "offline-default-denies-network"
  );
  assert.equal(record?.state, "CHAT_CREATE_OUTCOME_UNKNOWN");
  assert.equal(record?.receipt, null);
  await runtime.close();
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
