import assert from "node:assert/strict";
import test from "node:test";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const SECRET = "uploaded-files-test-credential";
const broker: SyntxCredentialBroker = {
  async useCredential(operation) { return operation(SECRET); }
};

test("uploaded-files read uses fixed tenant-bound GET and redacts unconfirmed fields", async () => {
  const calls: Array<{ url: string; method: string | undefined }> = [];
  const client = new SyntxHttpClient({
    credentialBroker: broker,
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), method: init?.method });
      return new Response(JSON.stringify({
        page: 1,
        page_size: 2,
        has_more: false,
        total: 1,
        items: [{
          id: "file_123",
          filename: "reference.png",
          mime_type: "image/png",
          size: 42,
          created_at: "2026-09-13T10:00:00.000Z",
          url: "https://signed.example/private",
          object_url: "https://signed.example/private",
          secret: SECRET
        }]
      }), { headers: { "content-type": "application/json" } });
    }
  });

  assert.deepEqual(await client.listUploadedFiles({
    scope: "uploaded", page: 1, page_size: 2
  }), {
    page: 1,
    page_size: 2,
    has_more: false,
    total: 1,
    items: [{
      id: "file_123",
      filename: "reference.png",
      mime_type: "image/png",
      size: 42,
      created_at: "2026-09-13T10:00:00.000Z"
    }]
  });
  assert.deepEqual(calls, [{
    url: "https://api.syntx.ai/api/v1/files/uploaded?scope=uploaded&page=1&page_size=2",
    method: "GET"
  }]);
});

test("uploaded-files read fails closed when confirmed envelope shape is invalid", async () => {
  const client = new SyntxHttpClient({
    credentialBroker: broker,
    fetchImpl: async () => new Response(JSON.stringify({
      page: 1, page_size: 1, has_more: "false", items: []
    }), { headers: { "content-type": "application/json" } })
  });
  await assert.rejects(client.listUploadedFiles({ scope: "all", page: 1, page_size: 1 }));
});

test("uploaded-files diagnostic returns only bounded shape metadata", async () => {
  const client = new SyntxHttpClient({
    credentialBroker: broker,
    fetchImpl: async () => new Response(JSON.stringify({
      page: "1",
      items: [{ id: "secret-id", filename: "private.png", nested: { token: "secret" } }],
      unexpected: true
    }), { headers: { "content-type": "application/json" } })
  });

  const summary = await client.inspectUploadedFilesResponseShape({
    scope: "all", page: 1, page_size: 10
  });
  assert.deepEqual(summary, {
    decoder_status: "UPSTREAM_PROTOCOL_ERROR",
    top_level: {
      keys: ["items", "page", "unexpected"],
      types: { items: "array", page: "string", unexpected: "boolean" }
    },
    item: {
      keys: ["filename", "id", "nested"],
      types: { filename: "string", id: "string", nested: "object" }
    }
  });
  assert.equal(JSON.stringify(summary).includes("secret"), false);
  assert.equal(JSON.stringify(summary).includes("private"), false);
});

test("uploaded-files decoder accepts current numeric ids and strips observed extra fields", async () => {
  const client = new SyntxHttpClient({
    credentialBroker: broker,
    fetchImpl: async () => new Response(JSON.stringify({
      page: 1, page_size: 1, has_more: false, total: 1,
      items: [{ id: 42, hash: "private", metadata: {}, model_type: "uni-1", type: "image", updated_at: "now", url: "https://signed.invalid" }]
    }), { headers: { "content-type": "application/json" } })
  });
  assert.deepEqual(await client.listUploadedFiles({ scope: "all", page: 1, page_size: 1 }), {
    page: 1, page_size: 1, has_more: false, total: 1, items: [{ id: "42" }]
  });
});

test("upload-file uses fixed multipart route and returns only redacted metadata", async () => {
  let seen: { url: string; method: string | undefined; auth: string | null; contentType: string | null; form: Record<string, string> } | undefined;
  const client = new SyntxHttpClient({
    credentialBroker: broker,
    fetchImpl: async (input, init) => {
      const body = init?.body;
      assert.ok(body instanceof FormData);
      const form: Record<string, string> = {};
      for (const [key, value] of body.entries()) {
        if (typeof value === "string") form[key] = value;
        else form[key] = `${value.name}:${value.type}:${value.size}`;
      }
      seen = {
        url: String(input),
        method: init?.method,
        auth: new Headers(init?.headers).get("authorization"),
        contentType: new Headers(init?.headers).get("content-type"),
        form
      };
      return new Response(JSON.stringify({ id: 42, status: "accepted", mime_type: "image/png", size: 4, filename: "private.png", url: "https://signed.invalid", object_url: "https://signed.invalid", secret: SECRET }), {
        headers: { "content-type": "application/json" }
      });
    }
  });
  const result = await client.uploadFile({
    bytes: new Uint8Array([137, 80, 78, 71]),
    filename: "reference.png",
    mime_type: "image/png",
    model_type: "uni-1"
  });
  assert.deepEqual(result, { file_id: "42", mime_type: "image/png", size: 4, status: "accepted" });
  assert.deepEqual(seen, {
    url: "https://api.syntx.ai/api/v1/chats/upload-files",
    method: "POST",
    auth: `Bearer ${SECRET}`,
    contentType: null,
    form: { files: "reference.png:image/png:4", destination: "hidden", check_duplicates: "true", model_type: "uni-1" }
  });
  assert.equal(JSON.stringify(result).includes("signed.invalid"), false);
});

test("upload-file accepts frontend files response as an accepted receipt", async () => {
  const client = new SyntxHttpClient({
    credentialBroker: broker,
    fetchImpl: async () => new Response(JSON.stringify({ files: [{ url: "https://r2.syntx.ai/uploaded/reference.png" }] }), {
      headers: { "content-type": "application/json" }
    })
  });
  assert.deepEqual(await client.uploadFile({
    bytes: new Uint8Array([1, 2, 3]),
    filename: "reference.png",
    mime_type: "image/png",
    model_type: "uni-1"
  }), { file_id: null, mime_type: "image/png", size: 3, status: "accepted" });
});

test("upload-file rejects unsupported mime, oversized bytes, and malformed upstream response", async () => {
  const client = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () => new Response(JSON.stringify({ nope: true }), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(client.uploadFile({ bytes: new Uint8Array([1]), filename: "x.exe", mime_type: "application/octet-stream", model_type: "uni-1" }));
  await assert.rejects(client.uploadFile({ bytes: new Uint8Array(10 * 1024 * 1024 + 1), filename: "x.png", mime_type: "image/png", model_type: "uni-1" }));
  await assert.rejects(client.uploadFile({ bytes: new Uint8Array([1]), filename: "x.png", mime_type: "image/png", model_type: "uni-1" }));
});
