import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const jpeg = Buffer.from([0xff,0xd8,0xff,0xc0,0,0x0b,8,0,1,0,1,1,1,0x11,0,0xff,0xda,0,8,1,1,0,0,0x3f,0,0,0xff,0xd9]);
const variants = ["banana", "banana2", "banana3", "banana3_light"] as const;

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-auxiliary-credential"); } };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

test("native auxiliary uploader sends fixed uploaded multipart fields and exact variant for all four models", async () => {
  const observed: Array<{ variant: string; filename: string; mime_type: string; bytes_match: boolean }> = [];
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    const file = form.get("files");
    assert.ok(file instanceof File);
    const bytes = Buffer.from(await file.arrayBuffer());
    observed.push({ variant: String(form.get("model_type")), filename: file.name, mime_type: file.type, bytes_match: bytes.equals(png) });
    bytes.fill(0);
    return jsonResponse({ files: [{ id: "aux-1", file_id: "aux-1", url: "https://r2.syntx.ai/aux/1.png",
      mime_type: "image/png", size: png.byteLength, status: "accepted" }] });
  } });
  const upload = (client as unknown as { uploadBananaInpaintAuxiliaryImage?: (request: unknown) => Promise<{ url: string }> })
    .uploadBananaInpaintAuxiliaryImage;
  assert.equal(typeof upload, "function", "MISSING_BANANA_INPAINT_AUXILIARY_NATIVE_UPLOAD");
  for (const variant of variants) {
    const receipt = await upload!.call(client, { variant, bytes: png, filename: "auxiliary.png", mime_type: "image/png" });
    assert.equal(receipt.url, "https://r2.syntx.ai/aux/1.png");
  }
  assert.deepEqual(observed.map((entry) => entry.variant), variants);
  assert.ok(observed.every((entry) => entry.filename === "auxiliary.png" && entry.mime_type === "image/png" && entry.bytes_match));
});

test("dedicated auxiliary native response guard accepts a locally validated image above 32 MiB", async () => {
  const scanDataBytes = 32 * 1024 * 1024 + 1;
  const bytes = Buffer.alloc(jpeg.byteLength - 2 + scanDataBytes + 2);
  jpeg.copy(bytes, 0, 0, jpeg.byteLength - 2);
  bytes.writeUInt16BE(0xffd9, bytes.length - 2);
  assert.ok(bytes.byteLength > 32 * 1024 * 1024 && bytes.byteLength < 50 * 1024 * 1024);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    assert.equal(file.size, bytes.byteLength);
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/aux/large.jpg", mime_type: "image/jpeg",
      size: bytes.byteLength, status: "accepted" }] });
  } });
  const upload = (client as unknown as { uploadBananaInpaintAuxiliaryImage: (request: unknown) => Promise<{ url: string }> })
    .uploadBananaInpaintAuxiliaryImage;
  const receipt = await upload.call(client, { variant: "banana3", bytes, filename: "large.jpg", mime_type: "image/jpeg" });
  assert.equal(receipt.url, "https://r2.syntx.ai/aux/large.jpg");
  bytes.fill(0);
});
