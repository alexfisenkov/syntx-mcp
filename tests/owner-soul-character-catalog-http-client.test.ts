import assert from "node:assert/strict";
import test from "node:test";
import {
  OwnerSoulCharacterCatalogHttpClient,
  OwnerSoulCharacterCatalogHttpError
} from "../src/adapter/syntx/owner-soul-character-catalog-http-client.js";

function broker(onUse?: () => void) {
  return {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      onUse?.();
      return operation("synthetic-soul-character-credential");
    }
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("character list uses one fixed GET and keeps record id separate from selectable reference_id", async () => {
  const body = {
    items: [
      { id: "record-delete-a", reference_id: "selection-a", title: "Completed portrait", status: "completed", ignored_secret: "hidden" },
      { id: "record-b", reference_id: 17, title: "Processing", status: "in-progress" },
      { id: 3, reference_id: null, title: "Not ready", status: "not-ready" },
      { id: 4, title: "Unknown state", status: "future-status" }
    ],
    total: 4,
    private_top_secret: "hidden"
  };
  const bodyJson = JSON.stringify(body);
  let calls = 0;
  const client = new OwnerSoulCharacterCatalogHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/list");
      assert.equal(new URL(String(input)).search, "");
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      return new Response(bodyJson, { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const result = await client.listCharacters();
  assert.equal(calls, 1);
  assert.deepEqual(result.records.map((record) => ({
    record_id: record.record_id,
    reference_id: record.reference_id,
    title: record.title,
    status: record.status,
    selectable: record.selectable
  })), [
    { record_id: "record-delete-a", reference_id: "selection-a", title: "Completed portrait", status: "completed", selectable: true },
    { record_id: "record-b", reference_id: 17, title: "Processing", status: "in-progress", selectable: false },
    { record_id: 3, reference_id: null, title: "Not ready", status: "not-ready", selectable: false },
    { record_id: 4, reference_id: null, title: "Unknown state", status: "future-status", selectable: false }
  ]);
  assert.deepEqual(result.summary, {
    route: "hf/lora/list",
    response_bytes: Buffer.byteLength(bodyJson, "utf8"),
    outcome: "SHAPE_OBSERVED",
    record_count: 4,
    total_matches: true,
    selectable_count: 1,
    status_counts: { "not-ready": 1, "in-progress": 1, queue: 0, error: 0, completed: 1, unknown: 1 },
    record_id_type_counts: { string: 2, number: 2 },
    reference_id_type_counts: { string: 1, number: 1, null: 1, missing: 1 },
    title_utf8_bytes: { min: 9, max: 18 },
    unknown_top_level_key_count: 1,
    unknown_item_key_count: 1
  });
  const summaryJson = JSON.stringify(result.summary);
  for (const privateValue of ["record-delete-a", "selection-a", "Completed portrait", "future-status", "ignored_secret", "private_top_secret"]) {
    assert.equal(summaryJson.includes(privateValue), false);
  }
});

test("empty character list is inconclusive and not proof that no Characters exist", async () => {
  const client = new OwnerSoulCharacterCatalogHttpClient({
    credentialBroker: broker(), fetchImpl: async () => jsonResponse({ items: [], total: 0 })
  });
  const result = await client.listCharacters();
  assert.deepEqual(result.records, []);
  assert.equal(result.summary.outcome, "EMPTY_INCONCLUSIVE");
  assert.equal(result.summary.total_matches, true);
  assert.equal(result.summary.selectable_count, 0);
});

test("string and numeric IDs remain separate identities; duplicate record and selectable IDs fail", async () => {
  const distinct = new OwnerSoulCharacterCatalogHttpClient({
    credentialBroker: broker(), fetchImpl: async () => jsonResponse({ items: [
      { id: 1, reference_id: "1", title: "String reference", status: "completed" },
      { id: "1", reference_id: 1, title: "Numeric reference", status: "completed" }
    ], total: 2 })
  });
  const result = await distinct.listCharacters();
  assert.deepEqual(result.records.map((record) => [typeof record.record_id, typeof record.reference_id]), [
    ["number", "string"], ["string", "number"]
  ]);
  assert.equal(result.summary.selectable_count, 2);

  const duplicateBodies = [
    { items: [
      { id: "same-record", reference_id: "ref-a", title: "A", status: "completed" },
      { id: "same-record", reference_id: "ref-b", title: "B", status: "completed" }
    ], total: 2 },
    { items: [
      { id: "record-a", reference_id: 5, title: "A", status: "completed" },
      { id: "record-b", reference_id: 5, title: "B", status: "completed" }
    ], total: 2 }
  ];
  for (const body of duplicateBodies) {
    const client = new OwnerSoulCharacterCatalogHttpClient({ credentialBroker: broker(), fetchImpl: async () => jsonResponse(body) });
    await assert.rejects(() => client.listCharacters(), (error: unknown) =>
      error instanceof OwnerSoulCharacterCatalogHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  }
});

test("completed Character rows require a selectable bounded reference_id", async () => {
  const invalidBodies: unknown[] = [
    { items: [{ id: "a", title: "A", status: "completed" }], total: 1 },
    { items: [{ id: "a", reference_id: null, title: "A", status: "completed" }], total: 1 },
    { items: [{ id: "a", reference_id: -1, title: "A", status: "completed" }], total: 1 },
    { items: [{ id: "a", reference_id: 1.5, title: "A", status: "completed" }], total: 1 },
    { items: [{ id: "a", reference_id: "", title: "A", status: "completed" }], total: 1 },
    { items: [{ id: "a", reference_id: "x".repeat(257), title: "A", status: "completed" }], total: 1 }
  ];
  for (const body of invalidBodies) {
    const client = new OwnerSoulCharacterCatalogHttpClient({ credentialBroker: broker(), fetchImpl: async () => jsonResponse(body) });
    await assert.rejects(() => client.listCharacters(), (error: unknown) =>
      error instanceof OwnerSoulCharacterCatalogHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  }
});

test("character decoder rejects count/shape/text violations and bounds UTF-8 fields", async () => {
  const invalidBodies: unknown[] = [
    { items: [{ id: "id", reference_id: "ref", title: "Title", status: "completed" }], total: 2 },
    { items: [{ id: "id", reference_id: "ref", title: "Title\nsecret", status: "completed" }], total: 1 },
    { items: [{ id: "id", reference_id: "ref", title: "t".repeat(257), status: "completed" }], total: 1 },
    { items: [{ id: "id", reference_id: "ref", title: "é".repeat(129), status: "completed" }], total: 1 },
    { items: [{ id: "id", reference_id: "ref", title: "Title", status: 3 }], total: 1 },
    { items: Array.from({ length: 129 }, (_, index) => ({ id: `id-${index}`, reference_id: `ref-${index}`, title: "A", status: "completed" })), total: 129 }
  ];
  for (const body of invalidBodies) {
    const client = new OwnerSoulCharacterCatalogHttpClient({ credentialBroker: broker(), fetchImpl: async () => jsonResponse(body) });
    await assert.rejects(() => client.listCharacters(), (error: unknown) =>
      error instanceof OwnerSoulCharacterCatalogHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  }
});

test("character list retains fixed route, strict UTF-8, body cap and cancellation/no-retry", async () => {
  const oversized = new OwnerSoulCharacterCatalogHttpClient({
    credentialBroker: broker(),
    fetchImpl: async () => new Response("x".repeat(65537), { status: 200, headers: { "content-type": "application/json", "content-length": "65537" } })
  });
  await assert.rejects(() => oversized.listCharacters(), (error: unknown) =>
    error instanceof OwnerSoulCharacterCatalogHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");

  const invalidUtf8 = new OwnerSoulCharacterCatalogHttpClient({
    credentialBroker: broker(),
    fetchImpl: async () => new Response(Uint8Array.from([0xc3, 0x28]), { status: 200, headers: { "content-type": "application/json" } })
  });
  await assert.rejects(() => invalidUtf8.listCharacters(), (error: unknown) =>
    error instanceof OwnerSoulCharacterCatalogHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");

  let credentials = 0;
  let fetches = 0;
  const controller = new AbortController();
  controller.abort();
  const aborted = new OwnerSoulCharacterCatalogHttpClient({
    credentialBroker: broker(() => { credentials += 1; }),
    fetchImpl: async () => { fetches += 1; return jsonResponse({ items: [], total: 0 }); }
  });
  await assert.rejects(() => aborted.listCharacters(controller.signal), (error: unknown) =>
    error instanceof OwnerSoulCharacterCatalogHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(credentials, 0);
  assert.equal(fetches, 0);
});

test("in-flight Character list abort reaches the single GET without retry", async () => {
  const controller = new AbortController();
  let fetches = 0;
  let started!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { started = resolve; });
  const client = new OwnerSoulCharacterCatalogHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_input, init) => {
      fetches += 1;
      started();
      return await new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
  });
  const operation = client.listCharacters(controller.signal);
  await fetchStarted;
  controller.abort();
  await assert.rejects(operation, (error: unknown) =>
    error instanceof OwnerSoulCharacterCatalogHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(fetches, 1);
});
