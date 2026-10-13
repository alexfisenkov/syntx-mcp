import assert from "node:assert/strict";
import test from "node:test";
import {
  OwnerSoulStyleCatalogHttpClient,
  OwnerSoulStyleCatalogHttpError
} from "../src/adapter/syntx/owner-soul-style-catalog-http-client.js";

function broker(onUse?: () => void) {
  return {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      onUse?.();
      return operation("synthetic-soul-style-credential");
    }
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function row(index: number) {
  return {
    style_id: `style-token-${index}`,
    name: `Style label ${index}`,
    image: `https://image.invalid/${index}.png`,
    ignored_extra: `private-extra-${index}`
  };
}

test("style list uses one fixed GET and returns typed private rows with a value-free summary", async () => {
  let calls = 0;
  const fixtureBody = { items: [row(1), row(2)], total: 2, private_top_field: "hidden" };
  const fixtureJson = JSON.stringify(fixtureBody);
  const client = new OwnerSoulStyleCatalogHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/styles");
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      assert.equal(new URL(String(input)).search, "");
      return new Response(fixtureJson, { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const result = await client.listStyles();
  assert.equal(calls, 1);
  assert.deepEqual(result.records, [
    { style_id: "style-token-1", name: "Style label 1", image: "https://image.invalid/1.png" },
    { style_id: "style-token-2", name: "Style label 2", image: "https://image.invalid/2.png" }
  ]);
  assert.deepEqual(result.summary, {
    route: "hf/lora/styles", record_count: 2, total_matches: true, unique_ids: true, fields_valid: true,
    response_bytes: Buffer.byteLength(fixtureJson, "utf8"),
    unknown_top_level_key_count: 1, unknown_item_key_count: 2,
    style_id_utf8_bytes: { min: 13, max: 13 }, name_utf8_bytes: { min: 13, max: 13 }
  });
  const serialized = JSON.stringify(result.summary);
  for (const privateValue of ["style-token-1", "Style label 1", "https://image.invalid", "private_top_field", "ignored_extra", "private-extra"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("style decoder rejects empty, inconsistent, duplicate, malformed, and oversized records", async () => {
  const cases: unknown[] = [
    { items: [], total: 0 },
    { items: [row(1)], total: 2 },
    { items: [row(1), row(1)], total: 2 },
    { items: [{ ...row(1), style_id: 7 }], total: 1 },
    { items: [{ ...row(1), name: "" }], total: 1 },
    { items: [{ ...row(1), image: "bad\nurl" }], total: 1 },
    { items: [{ ...row(1), style_id: "x".repeat(257) }], total: 1 },
    { items: [{ ...row(1), style_id: "é".repeat(129) }], total: 1 },
    { items: [{ ...row(1), name: "n".repeat(257) }], total: 1 },
    { items: [{ ...row(1), image: "i".repeat(4097) }], total: 1 }
  ];
  for (const body of cases) {
    const client = new OwnerSoulStyleCatalogHttpClient({
      credentialBroker: broker(), fetchImpl: async () => jsonResponse(body)
    });
    await assert.rejects(() => client.listStyles(), (error: unknown) =>
      error instanceof OwnerSoulStyleCatalogHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  }
});

test("style decoder enforces the 128 record ceiling and 64 KiB body cap", async () => {
  const overCount = new OwnerSoulStyleCatalogHttpClient({
    credentialBroker: broker(), fetchImpl: async () => jsonResponse({ items: Array.from({ length: 129 }, (_, i) => row(i)), total: 129 })
  });
  await assert.rejects(() => overCount.listStyles(), (error: unknown) =>
    error instanceof OwnerSoulStyleCatalogHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");

  const overBytes = new OwnerSoulStyleCatalogHttpClient({
    credentialBroker: broker(),
    fetchImpl: async () => new Response("x".repeat(65537), {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "65537" }
    })
  });
  await assert.rejects(() => overBytes.listStyles(), (error: unknown) =>
    error instanceof OwnerSoulStyleCatalogHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
});

test("style decoder requires strict UTF-8 and JSON and never follows redirects", async () => {
  const malformed = new OwnerSoulStyleCatalogHttpClient({
    credentialBroker: broker(),
    fetchImpl: async () => new Response(Uint8Array.from([0xc3, 0x28]), {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  await assert.rejects(() => malformed.listStyles(), (error: unknown) =>
    error instanceof OwnerSoulStyleCatalogHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");

  const redirect = new OwnerSoulStyleCatalogHttpClient({
    credentialBroker: broker(), fetchImpl: async () => new Response("{}", { status: 200, headers: { "content-type": "text/html" } })
  });
  await assert.rejects(() => redirect.listStyles(), (error: unknown) =>
    error instanceof OwnerSoulStyleCatalogHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
});

test("aborted style read performs no credential lookup or fetch", async () => {
  let credentials = 0;
  let fetches = 0;
  const controller = new AbortController();
  controller.abort();
  const client = new OwnerSoulStyleCatalogHttpClient({
    credentialBroker: broker(() => { credentials += 1; }),
    fetchImpl: async () => { fetches += 1; return jsonResponse({ items: [row(1)], total: 1 }); }
  });
  await assert.rejects(() => client.listStyles(controller.signal), (error: unknown) =>
    error instanceof OwnerSoulStyleCatalogHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(credentials, 0);
  assert.equal(fetches, 0);
});

test("aborting an in-flight style GET propagates its signal and never retries", async () => {
  const controller = new AbortController();
  let fetches = 0;
  let started!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { started = resolve; });
  const client = new OwnerSoulStyleCatalogHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_input, init) => {
      fetches += 1;
      started();
      assert.ok(init?.signal);
      return await new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
  });
  const operation = client.listStyles(controller.signal);
  await fetchStarted;
  controller.abort();
  await assert.rejects(operation, (error: unknown) =>
    error instanceof OwnerSoulStyleCatalogHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(fetches, 1);
});
