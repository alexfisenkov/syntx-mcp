import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const CREDENTIAL = "synthetic-wan-upload-credential";

function bmp24(width: number, height: number): Buffer {
  const stride = Math.ceil(width * 24 / 32) * 4;
  const bytes = Buffer.alloc(54 + stride * height);
  bytes.write("BM", 0, "ascii");
  bytes.writeUInt32LE(bytes.byteLength, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(stride * height, 34);
  return bytes;
}

function pngChunk(name: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  chunk.write(name, 4, 4, "ascii");
  data.copy(chunk, 8);
  let crc = 0xffff_ffff;
  for (let index = 4; index < 8 + data.byteLength; index += 1) {
    crc ^= chunk[index]!;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, 8 + data.byteLength);
  return chunk;
}

function pngHeader(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", Buffer.from([0])), pngChunk("IEND", Buffer.alloc(0))]);
}

function jpegHeader(width: number, height: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff,
    width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
}

function jpegWithExactSize(byteLength: number, width: number, height: number): Buffer {
  const tail = jpegHeader(width, height).subarray(2);
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let remaining = byteLength - 2 - tail.byteLength;
  while (remaining > 65_537) {
    const marker = Buffer.alloc(65_537);
    marker[0] = 0xff; marker[1] = 0xe1; marker.writeUInt16BE(65_535, 2);
    parts.push(marker);
    remaining -= marker.byteLength;
  }
  if (remaining < 4) throw new Error("JPEG fixture is too small.");
  const finalMarker = Buffer.alloc(remaining);
  finalMarker[0] = 0xff; finalMarker[1] = 0xe1; finalMarker.writeUInt16BE(remaining - 2, 2);
  parts.push(finalMarker, tail);
  return Buffer.concat(parts);
}

function webpHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii"); bytes.writeUInt32LE(bytes.byteLength - 8, 4); bytes.write("WEBPVP8 ", 8, "ascii");
  bytes.writeUInt32LE(10, 16); bytes[23] = 0x9d; bytes[24] = 0x01; bytes[25] = 0x2a;
  bytes.writeUInt16LE(width & 0x3fff, 26); bytes.writeUInt16LE(height & 0x3fff, 28);
  return bytes;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

test("WAN upload posts one fixed multipart BMP for the exact model and returns an internal receipt", async () => {
  const bytes = bmp24(384, 384);
  const originalBytes = Buffer.from(bytes);
  let fetchCalls = 0;
  let credentialCalls = 0;
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      return operation(CREDENTIAL);
    }
  };
  const client = new SyntxChatHttpClient({
    credentialBroker: broker,
    fetchImpl: async (input, init) => {
      fetchCalls += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      const form = init?.body as FormData;
      assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("destination"), "uploaded");
      assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), "wan_27_image_pro");
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.name, "картинка.bmp");
      assert.equal(file.type, "image/bmp");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
      return jsonResponse({ files: [{ id: "wan-file-1", url: "https://r2.syntx.ai/wan/input.bmp", mime_type: "image/bmp", size: bytes.byteLength }] });
    }
  });

  const receipt = await client.uploadWanImageReference({
    bytes, filename: "картинка.bmp", mime_type: "image/bmp", model_type: "wan_27_image_pro"
  });

  assert.deepEqual(receipt, { file_id: "wan-file-1", url: "https://r2.syntx.ai/wan/input.bmp" });
  assert.equal(fetchCalls, 1);
  assert.equal(credentialCalls, 1);
  assert.deepEqual(bytes, originalBytes, "caller-owned bytes are not zeroed");
});

test("WAN upload supports exactly four variants and the four canonical source image formats", async () => {
  const formats = [
    { mime_type: "image/jpeg", filename: "source.jpg", bytes: jpegHeader(384, 384) },
    { mime_type: "image/png", filename: "source.png", bytes: pngHeader(384, 384) },
    { mime_type: "image/bmp", filename: "source.bmp", bytes: bmp24(384, 384) },
    { mime_type: "image/webp", filename: "source.webp", bytes: webpHeader(384, 384) }
  ] as const;
  const variants = ["wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"] as const;
  let fetchCalls = 0;
  let expected: typeof formats[number];
  let variant: typeof variants[number];
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); } },
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      const form = init?.body as FormData;
      assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("model_type"), variant);
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.type, expected.mime_type);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), expected.bytes);
      return jsonResponse({ files: [{ url: `https://r2.syntx.ai/wan/${fetchCalls}`, mime_type: expected.mime_type, size: expected.bytes.byteLength }] });
    }
  });

  for (variant of variants) {
    for (expected of formats) {
      const receipt = await client.uploadWanImageReference({
        bytes: expected.bytes, filename: expected.filename, mime_type: expected.mime_type, model_type: variant
      });
      assert.deepEqual(receipt, { url: `https://r2.syntx.ai/wan/${fetchCalls}` });
    }
  }
  assert.equal(fetchCalls, 16);
});

test("WAN upload enforces the selected source byte cap at 10 MiB and 20 MiB", async () => {
  const credentialCalls = { value: 0 };
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls.value += 1;
      return operation(CREDENTIAL);
    } },
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      return jsonResponse({ files: [{ url: `https://r2.syntx.ai/wan/cap-${fetchCalls}`, mime_type: "image/jpeg", size: file.size }] });
    }
  });

  for (const [model_type, cap, dimension] of [
    ["wan_25_i2i_preview", 10 * 1024 * 1024, 384],
    ["wan_27_image", 20 * 1024 * 1024, 240]
  ] as const) {
    const exact = jpegWithExactSize(cap, dimension, dimension);
    const receipt = await client.uploadWanImageReference({ bytes: exact, filename: "cap.jpg", mime_type: "image/jpeg", model_type });
    assert.deepEqual(receipt, { url: `https://r2.syntx.ai/wan/cap-${fetchCalls}` });
    assert.ok(exact.some((byte) => byte !== 0), "caller bytes remain owned by the caller");

    const over = jpegWithExactSize(cap + 1, dimension, dimension);
    await assert.rejects(client.uploadWanImageReference({ bytes: over, filename: "over.jpg", mime_type: "image/jpeg", model_type }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  }
  assert.equal(fetchCalls, 2);
  assert.equal(credentialCalls.value, 2);
});

test("WAN upload rejects untrusted fields, mismatched MIME, variant dimensions, and unsafe inputs before auth", async () => {
  const credentialCalls = { value: 0 };
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls.value += 1;
      return operation(CREDENTIAL);
    } },
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); }
  });
  const base = { bytes: bmp24(384, 384), filename: "source.bmp", mime_type: "image/bmp", model_type: "wan_26_image" };
  let getterCalls = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, "model_type", { enumerable: true, get() { getterCalls += 1; return base.model_type; } });
  const invalid: unknown[] = [
    { ...base, mime_type: "image/jpg" },
    { ...base, mime_type: "image/png" },
    { ...base, model_type: "wan-27-image" },
    { ...base, filename: "../private.bmp" },
    { ...base, filename: "CON.bmp" },
    { ...base, bytes: bmp24(383, 384) },
    { ...base, bytes: bmp24(5_001, 384) },
    { ...base, url: "https://r2.syntx.ai/private.bmp" },
    { ...base, destination: "hidden" },
    { ...base, extra: true },
    accessor,
    new Proxy({ ...base }, {})
  ];
  for (const request of invalid) {
    await assert.rejects(client.uploadWanImageReference(request as never),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  }
  assert.equal(getterCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(credentialCalls.value, 0);
});

test("WAN upload rejects plural, unsafe, or MIME/size-mismatched receipts after exactly one POST", async () => {
  const valid = { id: "wan-file-1", url: "https://r2.syntx.ai/wan/input.bmp", mime_type: "image/bmp", size: bmp24(384, 384).byteLength };
  const invalidReceipts: unknown[] = [
    {}, { files: [] }, { files: [valid, valid] },
    { files: [{ ...valid, mime_type: "image/png" }] },
    { files: [{ ...valid, size: valid.size + 1 }] },
    { files: [{ ...valid, url: "https://attacker.invalid/private.bmp" }] },
    { files: [{ ...valid, url: "https://r2.syntx.ai/private.bmp#fragment" }] },
    { files: [{ ...valid, id: "wan-file-1", file_id: "other-file" }] },
    { files: [{ ...valid, status: "error" }] }
  ];
  for (const receipt of invalidReceipts) {
    let fetchCalls = 0;
    const client = new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); } },
      fetchImpl: async () => { fetchCalls += 1; return jsonResponse(receipt); }
    });
    await assert.rejects(client.uploadWanImageReference({
      bytes: bmp24(384, 384), filename: "source.bmp", mime_type: "image/bmp", model_type: "wan_25_i2i_preview"
    }), (error: unknown) => error instanceof Error && "code" in error && error.code === "UPSTREAM_PROTOCOL_ERROR" &&
      !error.message.includes("attacker.invalid") && !error.message.includes("other-file"));
    assert.equal(fetchCalls, 1);
  }
});

test("WAN upload rejects redirects and honors caller abort without replay", async () => {
  let fetchCalls = 0;
  const redirected = jsonResponse({ files: [{ url: "https://r2.syntx.ai/wan/input.bmp", mime_type: "image/bmp", size: bmp24(384, 384).byteLength }] });
  Object.defineProperty(redirected, "redirected", { value: true });
  const redirectClient = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); } },
    fetchImpl: async () => { fetchCalls += 1; return redirected; }
  });
  await assert.rejects(redirectClient.uploadWanImageReference({
    bytes: bmp24(384, 384), filename: "source.bmp", mime_type: "image/bmp", model_type: "wan_25_i2i_preview"
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "UPSTREAM_PROTOCOL_ERROR");
  assert.equal(fetchCalls, 1);

  let beginFetch!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { beginFetch = resolve; });
  const abortClient = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); } },
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      beginFetch();
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    }
  });
  const controller = new AbortController();
  const pending = abortClient.uploadWanImageReference({
    bytes: bmp24(384, 384), filename: "source.bmp", mime_type: "image/bmp", model_type: "wan_25_i2i_preview"
  }, controller.signal);
  await fetchStarted;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof Error && "code" in error && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(fetchCalls, 2);
});

test("WAN upload request timeout is reported after one POST without retry", async () => {
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    requestTimeoutMs: 5,
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); } },
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timed out")), { once: true }));
    }
  });
  await assert.rejects(client.uploadWanImageReference({
    bytes: bmp24(384, 384), filename: "source.bmp", mime_type: "image/bmp", model_type: "wan_25_i2i_preview"
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "UPSTREAM_TIMEOUT");
  assert.equal(fetchCalls, 1);
});

test("WAN upload snapshots input bytes before awaiting the linked credential", async () => {
  const source = bmp24(384, 384);
  const expected = Buffer.from(source);
  let releaseCredential!: () => void;
  const credentialGate = new Promise<void>((resolve) => { releaseCredential = resolve; });
  let uploaded: Buffer | undefined;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      await credentialGate;
      return operation(CREDENTIAL);
    } },
    fetchImpl: async (_input, init) => {
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      uploaded = Buffer.from(await file.arrayBuffer());
      return jsonResponse({ files: [{ url: "https://r2.syntx.ai/wan/snapshot.bmp", mime_type: "image/bmp", size: expected.byteLength }] });
    }
  });
  const pending = client.uploadWanImageReference({ bytes: source, filename: "source.bmp", mime_type: "image/bmp", model_type: "wan_25_i2i_preview" });
  source.fill(0);
  releaseCredential();
  await pending;
  assert.deepEqual(uploaded, expected);
  assert.ok(source.every((byte) => byte === 0), "caller mutation remains caller-owned");
});
