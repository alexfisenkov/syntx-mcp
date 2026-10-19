import assert from "node:assert/strict";
import test from "node:test";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const broker: SyntxCredentialBroker = { async useCredential(operation) { return operation("synthetic-test-credential"); } };
function clientFor(payload: unknown): SyntxHttpClient {
  return new SyntxHttpClient({ credentialBroker: broker,
    fetchImpl: async () => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }) });
}

test("uploaded-files decoder projects only allowlisted nested metadata into public fields", async () => {
  const client = clientFor({ page: 1, page_size: 10, has_more: false, total: 1, items: [{ id: 42,
    created_at: "2026-10-19T00:00:00.000Z", metadata: { name: "reference.png", mime_type: "image/png", size: 3_523,
      width: 768, height: 768, private_path: "synthetic-private-path", preview: "synthetic-preview-value", hash: "synthetic-private-hash" },
    url: "https://synthetic.invalid/private-url", hash: "synthetic-private-hash" }] });
  const result = await client.listUploadedFiles({ scope: "all", page: 1, page_size: 10 });
  assert.deepEqual(result.items, [{ id: "42", filename: "reference.png", mime_type: "image/png", size: 3_523,
    created_at: "2026-10-19T00:00:00.000Z" }]);
  const serialized = JSON.stringify(result);
  for (const privateValue of ["private_path", "synthetic-private-path", "preview", "synthetic-preview-value", "synthetic-private-hash", "synthetic.invalid"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("uploaded-files decoder preserves the legacy root-level metadata shape", async () => {
  const client = clientFor({ page: 1, page_size: 10, has_more: false, items: [{ id: "legacy-1", filename: "legacy.png",
    mime_type: "image/jpeg", size: 12, created_at: "2026-10-18T00:00:00.000Z" }] });
  assert.deepEqual((await client.listUploadedFiles({ scope: "all", page: 1, page_size: 10 })).items,
    [{ id: "legacy-1", filename: "legacy.png", mime_type: "image/jpeg", size: 12, created_at: "2026-10-18T00:00:00.000Z" }]);
});

test("uploaded-files decoder fails closed on conflicting or malformed nested metadata", async () => {
  const conflict = clientFor({ page: 1, page_size: 10, has_more: false, items: [{ filename: "root.png",
    mime_type: "image/png", size: 10, metadata: { name: "nested.png", mime_type: "image/png", size: 10 } }] });
  await assert.rejects(conflict.listUploadedFiles({ scope: "all", page: 1, page_size: 10 }));

  const malformed = clientFor({ page: 1, page_size: 10, has_more: false, items: [{ metadata: { name: "nested.png",
    mime_type: "image/png", size: "10" } }] });
  await assert.rejects(malformed.listUploadedFiles({ scope: "all", page: 1, page_size: 10 }));
});
