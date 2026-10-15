import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { readOwnerWan26R2vUploadReferenceForClient } from "../src/adapter/syntx/wan26-r2v-upload-context.js";

const SECRET = "wan26-r2v-image-upload-test-credential";
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png384(): Buffer {
  const bytes = Buffer.from(PNG_1PX);
  bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}
function broker(onUse: () => void = () => undefined): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { onUse(); return operation(SECRET); } };
}
function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}
const IMAGE_URL = "https://r2.syntx.ai/uploaded/wan26-r2v-image.png";

test("uploads a policy-validated image for either exact R2V model and hides URL in same-client context", async () => {
  for (const [index, model_id] of ["wan_26_r2v", "wan_26_r2v_flash"].entries()) {
    const bytes = png384(), filename = `кадр-${index}.png`, mime_type = "image/png" as const;
    let credentials = 0, requests = 0, form: FormData | undefined;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentials += 1; }), fetchImpl: async (input, init) => {
      requests += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST"); assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SECRET}`);
      assert.equal(init?.redirect, "error"); assert.ok(init?.body instanceof FormData); form = init.body as FormData;
      assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), model_id);
      const file = form.get("files"); assert.ok(file instanceof File); assert.equal(file.name, filename); assert.equal(file.type, mime_type);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
      return json({ files: [{ id: index + 1, url: IMAGE_URL, filename, mime_type, content_type: mime_type,
        media_type: "image", type: "image", size: bytes.byteLength, status: "uploaded" }] });
    } });
    const context = await client.uploadWan26R2vImage({ model_id, filename, mime_type, bytes });
    assert.equal(Object.isFrozen(context), true); assert.equal(context.model_id, model_id); assert.equal(context.media_type, "image");
    assert.equal(context.filename, filename); assert.equal(context.mime_type, mime_type); assert.equal(context.size, bytes.byteLength);
    assert.equal(context.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(context.width, 384); assert.equal(context.height, 384); assert.equal(context.generation_permit, false);
    assert.equal(context.owner_upload_binding, "SAME_CLIENT_NATIVE_UPLOAD");
    assert.equal("url" in context, false); assert.equal(JSON.stringify(context).includes("r2.syntx.ai"), false);
    assert.deepEqual(readOwnerWan26R2vUploadReferenceForClient(client, context), { url: IMAGE_URL });
    assert.equal(readOwnerWan26R2vUploadReferenceForClient(new SyntxChatHttpClient({ credentialBroker: broker() }), context), null);
    assert.equal(readOwnerWan26R2vUploadReferenceForClient(client, { ...context }), null);
    assert.equal(readOwnerWan26R2vUploadReferenceForClient(client, new Proxy(context, {})), null);
    Object.defineProperty(client, "uploadWan26R2vImage", { value: () => Promise.reject(new Error("override")) });
    assert.equal(readOwnerWan26R2vUploadReferenceForClient(client, context), null);
    assert.equal(form?.get("files"), null); assert.equal(credentials, 1); assert.equal(requests, 1);
  }
});

test("rejects malformed, foreign-model, and already-aborted image requests before POST", async () => {
  let credentials = 0, requests = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentials += 1; }), fetchImpl: async () => {
    requests += 1; return json({ files: [{ id: 1, url: IMAGE_URL }] });
  } });
  await assert.rejects(client.uploadWan26R2vImage({ model_id: "wan_27_r2v", filename: "frame.png", mime_type: "image/png", bytes: png384() } as never));
  await assert.rejects(client.uploadWan26R2vImage({ model_id: "wan_26_r2v", filename: "frame.png", mime_type: "image/png", bytes: Buffer.alloc(12) }));
  await assert.rejects(client.uploadWan26R2vImage({ model_id: "wan_26_i2v", filename: "frame.png", mime_type: "image/png", bytes: png384() } as never));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.uploadWan26R2vImage({ model_id: "wan_26_r2v", filename: "frame.png", mime_type: "image/png", bytes: png384() }, controller.signal),
    (error: unknown) => error instanceof SyntxHttpError);
  assert.equal(credentials, 0); assert.equal(requests, 0);
});

test("bad or ambiguous upload acknowledgements do not mint a readable R2V context", async () => {
  let response: unknown = { files: [{ id: 1, url: IMAGE_URL, filename: "frame.png", mime_type: "image/png", media_type: "image", size: png384().byteLength }] };
  let credentials = 0, requests = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentials += 1; }), fetchImpl: async () => {
    requests += 1; return json(response);
  } });
  const input = { model_id: "wan_26_r2v_flash", filename: "frame.png", mime_type: "image/png", bytes: png384() } as const;
  const valid = await client.uploadWan26R2vImage(input);
  assert.deepEqual(readOwnerWan26R2vUploadReferenceForClient(client, valid), { url: IMAGE_URL });
  for (response of [
    { files: [{ id: 1, url: IMAGE_URL, filename: "other.png", mime_type: "image/png", media_type: "image", size: input.bytes.byteLength }] },
    { files: [{ id: 1, url: IMAGE_URL, filename: "frame.png", mime_type: "image/jpeg", media_type: "image", size: input.bytes.byteLength }] },
    { files: [{ id: 1, url: IMAGE_URL, filename: "frame.png", mime_type: "image/png", media_type: "video", size: input.bytes.byteLength }] },
    { files: [{ id: 1, url: IMAGE_URL, filename: "frame.png", mime_type: "image/png", media_type: "image", size: input.bytes.byteLength },
      { id: 2, url: "https://r2.syntx.ai/uploaded/extra.png", filename: "frame.png", mime_type: "image/png", media_type: "image", size: input.bytes.byteLength }] }
  ]) await assert.rejects(client.uploadWan26R2vImage(input), (error: unknown) => error instanceof SyntxHttpError);
  assert.deepEqual(readOwnerWan26R2vUploadReferenceForClient(client, valid), { url: IMAGE_URL });
  assert.equal(credentials, 5); assert.equal(requests, 5);
});
