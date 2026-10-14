import assert from "node:assert/strict";
import test from "node:test";
import {
  SyntxHttpClient,
  SyntxHttpError,
  type SyntxCredentialBroker
} from "../src/adapter/syntx/http-client.js";

const broker: SyntxCredentialBroker = {
  async useCredential(operation) { return operation("uploaded-files-test-credential"); }
};

function uploadedFilesBody(): string {
  return JSON.stringify({
    page: 1,
    page_size: 100,
    has_more: false,
    total: 100,
    items: Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      created_at: "2026-10-14T12:00:00Z",
      url: `https://storage.example/${"u".repeat(800)}`,
      hash: "a".repeat(64),
      upstream_metadata: { kind: "image" }
    }))
  });
}

function jsonResponse(body: string): Response {
  return new Response(body, { headers: { "content-type": "application/json" } });
}

test("uploaded-files page of 100 rows above the global 64 KiB budget is decoded and redacted", async () => {
  const body = uploadedFilesBody();
  assert.ok(Buffer.byteLength(body) > 64 * 1024);
  const client = new SyntxHttpClient({
    credentialBroker: broker,
    fetchImpl: async () => jsonResponse(body)
  });

  const result = await client.listUploadedFiles({ scope: "hidden", page: 1, page_size: 100 });
  assert.equal(result.items.length, 100);
  assert.deepEqual(result.items[0], { id: "1", created_at: "2026-10-14T12:00:00Z" });
  assert.equal(JSON.stringify(result).includes("storage.example"), false);
  assert.equal(JSON.stringify(result).includes("upstream_metadata"), false);
});

test("other JSON reads retain the global 64 KiB response limit", async () => {
  const body = JSON.stringify({
    access: true,
    cost: 1,
    discount_cost: 1,
    free_remaining_generations: 0,
    limit: 0,
    show_warning: false,
    padding: "x".repeat(70 * 1024)
  });
  const client = new SyntxHttpClient({
    credentialBroker: broker,
    fetchImpl: async () => jsonResponse(body)
  });

  await assert.rejects(
    client.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR"
  );
});

test("explicit maxResponseBytes override also limits uploaded-files responses", async () => {
  const body = uploadedFilesBody();
  const client = new SyntxHttpClient({
    credentialBroker: broker,
    maxResponseBytes: 32 * 1024,
    fetchImpl: async () => jsonResponse(body)
  });

  await assert.rejects(
    client.listUploadedFiles({ scope: "hidden", page: 1, page_size: 100 }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR"
  );
});
