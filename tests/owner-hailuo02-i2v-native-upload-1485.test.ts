import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  readValidatedOwnerHailuo02I2vImageUpload,
  releaseValidatedOwnerHailuo02I2vImageUpload,
  validateOwnerHailuo02I2vImageUpload
} from "../src/application/owner-hailuo02-i2v-image-policy.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import {
  isOwnerHailuo02I2vUploadContextForClient,
  readOwnerHailuo02I2vUploadReferenceForClient
} from "../src/adapter/syntx/hailuo02-i2v-upload-context.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,
  0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);
const CREDENTIAL = "synthetic-hailuo-upload-credential";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function broker(onUse?: () => void): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    onUse?.();
    return operation(CREDENTIAL);
  } };
}

function jpegWithExactSize(byteLength: number): Buffer {
  const tail = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,
    0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]).subarray(2);
  const chunks: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let remaining = byteLength - 2 - tail.byteLength;
  while (remaining > 65_537) {
    const marker = Buffer.alloc(65_537);
    marker[0] = 0xff; marker[1] = 0xe1; marker.writeUInt16BE(65_535, 2);
    chunks.push(marker);
    remaining -= marker.byteLength;
  }
  if (remaining < 4) throw new Error("JPEG fixture size is too small.");
  const finalMarker = Buffer.alloc(remaining);
  finalMarker[0] = 0xff; finalMarker[1] = 0xe1; finalMarker.writeUInt16BE(remaining - 2, 2);
  chunks.push(finalMarker, tail);
  return Buffer.concat(chunks);
}

test("Hailuo I2V borrows a genuine policy receipt for one fixed upload and seals its URL privately", async () => {
  const sourceBefore = Buffer.from(PNG);
  const receipt = validateOwnerHailuo02I2vImageUpload({ filename: "кадр.png", mime_type: "image/png", bytes: PNG });
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
      assert.equal(form.get("destination"), "uploaded");
      assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), "hailuo-02");
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.name, "кадр.png");
      assert.equal(file.type, "image/png");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
      return jsonResponse({ files: [{ id: "hailuo-file-1", url: "https://r2.syntx.ai/hailuo/input.png", filename: "кадр.png",
        mime_type: "image/png", size: PNG.byteLength, status: "success" }] });
    }
  });

  const context = await client.uploadHailuo02I2vImage(receipt);

  assert.equal(calls, 1);
  assert.equal(credentialCalls, 1);
  assert.equal(formAfter?.get("files"), null);
  assert.deepEqual(PNG, sourceBefore);
  assert.equal(context.status, "uploaded");
  assert.equal(context.model_id, "hailuo-02");
  assert.equal(context.mime_type, "image/png");
  assert.equal(context.size, PNG.byteLength);
  assert.equal(context.sha256, createHash("sha256").update(PNG).digest("hex"));
  assert.equal(context.width, 1);
  assert.equal(context.height, 1);
  assert.equal("url" in context, false);
  assert.equal(isOwnerHailuo02I2vUploadContextForClient(client, context), true);
  assert.deepEqual(readOwnerHailuo02I2vUploadReferenceForClient(client, context), { url: "https://r2.syntx.ai/hailuo/input.png" });
  assert.equal(isOwnerHailuo02I2vUploadContextForClient(new SyntxChatHttpClient({ credentialBroker: broker() }), context), false);
  assert.equal(readOwnerHailuo02I2vUploadReferenceForClient(client, { ...context }), null);
  assert.equal(readOwnerHailuo02I2vUploadReferenceForClient(new Proxy(client, {}), context), null);
  assert.ok(readValidatedOwnerHailuo02I2vImageUpload(receipt), "native upload does not release the caller's policy receipt");
  assert.equal(releaseValidatedOwnerHailuo02I2vImageUpload(receipt), true);
  assert.equal(isOwnerHailuo02I2vUploadContextForClient(client, context), true, "upload context survives policy receipt release");
  let overrideGetterCalls = 0;
  Object.defineProperty(client, "uploadHailuo02I2vImage", { get() { overrideGetterCalls += 1; return undefined; } });
  assert.equal(readOwnerHailuo02I2vUploadReferenceForClient(client, context), null);
  assert.equal(overrideGetterCalls, 0, "the client override getter is not invoked");
});

test("forged and over-limit inputs are rejected before credentials or upload", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(() => { credentialCalls += 1; }),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); }
  });
  const receipt = validateOwnerHailuo02I2vImageUpload({ filename: "frame.png", mime_type: "image/png", bytes: PNG });
  await assert.rejects(client.uploadHailuo02I2vImage({ ...receipt } as never),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");

  const oversized = jpegWithExactSize(10 * 1024 * 1024 + 1);
  assert.throws(() => validateOwnerHailuo02I2vImageUpload({ filename: "large.jpg", mime_type: "image/jpeg", bytes: oversized }));
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("image/jpg uses the receipt's canonical image/jpeg MIME on the native wire", async () => {
  const receipt = validateOwnerHailuo02I2vImageUpload({ filename: "кадр.original", mime_type: "image/jpg", bytes: JPEG });
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    const form = init?.body as FormData;
    assert.equal(form.get("model_type"), "hailuo-02");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "кадр.jpg");
    assert.equal(file.type, "image/jpeg");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), JPEG);
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/hailuo/input.jpg", mime_type: "image/jpeg", size: JPEG.byteLength }] });
  } });
  const context = await client.uploadHailuo02I2vImage(receipt);
  assert.equal(context.mime_type, "image/jpeg");
  assert.deepEqual(readOwnerHailuo02I2vUploadReferenceForClient(client, context), { url: "https://r2.syntx.ai/hailuo/input.jpg" });
  assert.equal(releaseValidatedOwnerHailuo02I2vImageUpload(receipt), true);
});

test("malformed successful HTTP upload responses never mint a context", async () => {
  const invalidResponses = [
    { files: [{ url: "https://attacker.invalid/image.png" }] },
    { files: [{ url: "https://r2.syntx.ai/hailuo/input.png", status: "error" }] },
    { files: [{ url: "https://r2.syntx.ai/hailuo/input.png", status: "pending" }] },
    { files: [{ url: "https://r2.syntx.ai/hailuo/input.png", filename: "different.png" }] },
    { files: [{ url: "https://r2.syntx.ai/hailuo/input.png", mime_type: "image/jpeg" }] },
    { files: [{ url: "https://r2.syntx.ai/hailuo/input.png", size: PNG.byteLength + 1 }] },
    { files: [{ url: "https://r2.syntx.ai/hailuo/one.png" }, { url: "https://r2.syntx.ai/hailuo/two.png" }] }
  ];
  let response = invalidResponses[0]!;
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    calls += 1;
    return jsonResponse(response);
  } });

  for (response of invalidResponses) {
    const receipt = validateOwnerHailuo02I2vImageUpload({ filename: "frame.png", mime_type: "image/png", bytes: PNG });
    await assert.rejects(client.uploadHailuo02I2vImage(receipt),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
    assert.equal(releaseValidatedOwnerHailuo02I2vImageUpload(receipt), true);
  }
  assert.equal(calls, invalidResponses.length);
});

test("upload wipes its owned byte copy even when the response is malformed", async () => {
  const receipt = validateOwnerHailuo02I2vImageUpload({ filename: "frame.png", mime_type: "image/png", bytes: PNG });
  const originalFill = Uint8Array.prototype.fill;
  let observedOwnedWipe = false;
  Uint8Array.prototype.fill = function(value: number, start?: number, end?: number) {
    const sourceCopy = this.byteLength === PNG.byteLength && this[0] === PNG[0] && this[1] === PNG[1];
    const result = Reflect.apply(originalFill, this, [value, start, end]) as Uint8Array;
    if (sourceCopy && value === 0 && this.every((byte) => byte === 0)) observedOwnedWipe = true;
    return result;
  };
  try {
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => jsonResponse({ files: [] }) });
    await assert.rejects(client.uploadHailuo02I2vImage(receipt));
  } finally {
    Uint8Array.prototype.fill = originalFill;
  }
  assert.equal(observedOwnedWipe, true);
  assert.ok(readValidatedOwnerHailuo02I2vImageUpload(receipt), "borrowed policy receipt remains available");
  assert.equal(releaseValidatedOwnerHailuo02I2vImageUpload(receipt), true);
});
