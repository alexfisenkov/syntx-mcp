import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../dist/src/adapter/syntx/chat-http-client.js";

const TOKEN = "synthetic-upload-view-token";

test("uploadFile serializes only a Buffer view's visible byte range", async () => {
  const source = Buffer.from([0xfa, 0x11, 0x22, 0x33, 0x44, 0xfb]);
  const original = Buffer.from(source);
  const view = source.subarray(1, 4);
  let observed;
  let markFetchStarted;
  let allowFileRead;
  const fetchStarted = new Promise(resolve => { markFetchStarted = resolve; });
  const fileReadGate = new Promise(resolve => { allowFileRead = resolve; });
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential(operation) { return operation(TOKEN); } },
    fetchImpl: async (_input, init) => {
      const form = init.body;
      const file = form.get("files");
      assert.ok(file instanceof File);
      markFetchStarted();
      await fileReadGate;
      observed = { size: file.size, bytes: Buffer.from(await file.arrayBuffer()) };
      return new Response(JSON.stringify({ files: [{ url: "https://r2.syntx.ai/view-regression/file.png" }] }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
  });

  const pending = client.uploadFile({ bytes: view, filename: "view.png", mime_type: "image/png",
    destination: "hidden", check_duplicates: true, model_type: "synthetic_model" });
  await fetchStarted;
  assert.deepEqual(source, original, "snapshotting is synchronous and does not mutate the caller's backing buffer");
  source.fill(0);
  allowFileRead();
  const receipt = await pending;

  assert.deepEqual(observed, { size: 3, bytes: Buffer.from([0x11, 0x22, 0x33]) });
  assert.deepEqual(source, Buffer.alloc(source.length), "the test mutation must affect only caller-owned bytes");
  assert.equal(receipt.size, 3);
});
