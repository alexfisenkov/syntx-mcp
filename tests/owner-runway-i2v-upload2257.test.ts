import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  readValidatedOwnerRunwayI2vImageUpload,
  releaseValidatedOwnerRunwayI2vImageUpload,
  validateOwnerRunwayI2vImageUpload
} from "../src/application/owner-runway-i2v-image-policy.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import {
  readOwnerRunwayI2vUploadReferenceForClient,
  type OwnerRunwayI2vImageUploadContext
} from "../src/adapter/syntx/owner-runway-i2v-upload-context.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const CREDENTIAL = "synthetic-runway-upload-credential";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function broker(onUse?: () => void): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    onUse?.();
    return operation(CREDENTIAL);
  } };
}

function receipt(model_id = "4genfirstframeimage") {
  return validateOwnerRunwayI2vImageUpload({
    model_id, aspect_ratio: "1:1", filename: "first-frame.png", mime_type: "image/png", bytes: PNG
  });
}

test("uploads one validated first frame to the fixed hidden route with model-bound multipart metadata", async () => {
  for (const model_id of ["4genfirstframeimage", "turbo4genfirstframeimage"]) {
    const sourceBefore = Buffer.from(PNG);
    const validated = receipt(model_id);
    let calls = 0;
    let credentialCalls = 0;
    let formAfter: FormData | undefined;
    const client = new SyntxChatHttpClient({
      credentialBroker: broker(() => { credentialCalls += 1; }),
      fetchImpl: async (input, init) => {
        calls += 1;
        assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
        assert.equal(init?.method, "POST");
        assert.equal(init?.redirect, "error");
        const form = init?.body as FormData;
        formAfter = form;
        assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
        assert.equal(form.get("destination"), "hidden");
        assert.equal(form.get("check_duplicates"), "true");
        assert.equal(form.get("model_type"), model_id);
        const file = form.get("files");
        assert.ok(file instanceof File);
        assert.equal(file.name, "first-frame.png");
        assert.equal(file.type, "image/png");
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
        return jsonResponse({ files: [{ id: `runway-file-${calls}`, url: "https://r2.syntx.ai/runway/first-frame.png",
          filename: "first-frame.png", mime_type: "image/png", size: PNG.byteLength, status: "success" }] });
      }
    });

    const context = await client.uploadOwnerRunwayI2vImage(validated);
    assert.equal(calls, 1);
    assert.equal(credentialCalls, 1);
    assert.equal(formAfter?.get("files"), null);
    assert.deepEqual(PNG, sourceBefore);
    assert.equal(context.status, "uploaded");
    assert.equal(context.model_id, model_id);
    assert.equal(context.aspect_ratio, "1:1");
    assert.equal(context.mime_type, "image/png");
    assert.equal(context.size, PNG.byteLength);
    assert.equal(context.sha256, createHash("sha256").update(PNG).digest("hex"));
    assert.equal(context.width, 1);
    assert.equal(context.height, 1);
    assert.equal("url" in context, false);
    assert.deepEqual(readOwnerRunwayI2vUploadReferenceForClient(client, context), {
      type: "image", url: "https://r2.syntx.ai/runway/first-frame.png"
    });
    assert.equal(readOwnerRunwayI2vUploadReferenceForClient(new SyntxChatHttpClient({ credentialBroker: broker() }), context), null);
    assert.equal(readOwnerRunwayI2vUploadReferenceForClient(client, { ...context }), null);
    assert.equal(readValidatedOwnerRunwayI2vImageUpload(validated), null, "native upload consumes the policy receipt");
    assert.equal(releaseValidatedOwnerRunwayI2vImageUpload(validated), false);
  }
});

test("rejects forged receipts before credentials or upload", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(() => { credentialCalls += 1; }),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); }
  });
  const valid = receipt();
  await assert.rejects(client.uploadOwnerRunwayI2vImage({ ...valid } as unknown as OwnerRunwayI2vImageUploadContext),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("rejects non-single or mismatched upload responses and never publishes a URL", async () => {
  for (const body of [
    { files: [] },
    { files: [{ url: "https://r2.syntx.ai/runway/one.png" }, { url: "https://r2.syntx.ai/runway/two.png" }] },
    { files: [{ url: "https://example.invalid/runway.png", mime_type: "image/png", size: PNG.byteLength }] },
    { files: [{ url: "https://r2.syntx.ai/runway/first-frame.png", mime_type: "image/jpeg", size: PNG.byteLength }] }
  ]) {
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => jsonResponse(body) });
    await assert.rejects(client.uploadOwnerRunwayI2vImage(receipt()),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  }
});
