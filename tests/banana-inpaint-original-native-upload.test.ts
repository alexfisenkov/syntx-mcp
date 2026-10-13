import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const SECRET = "synthetic-banana-inpaint-upload-secret";
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const VARIANTS = ["banana", "banana2", "banana3", "banana3_light"] as const;

function broker(onUse: () => void = () => undefined): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { onUse(); return operation(SECRET); } };
}

function jsonResponse(value: unknown, status = 200, contentType = "application/json"): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": contentType } });
}

function upload(client: SyntxChatHttpClient, request: unknown, signal?: AbortSignal) {
  const method = (client as unknown as {
    uploadBananaInpaintOriginal?: (request: unknown, signal?: AbortSignal) => Promise<{ readonly file_id?: string; readonly url: string }>;
  }).uploadBananaInpaintOriginal;
  assert.equal(typeof method, "function", "fixed Banana Inpaint original upload method must exist");
  return method!.call(client, request, signal);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.byteLength + 12);
  chunk.writeUInt32BE(data.byteLength, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
  return chunk;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function largeValidPng(): Buffer {
  const width = 4_096, height = 2_048, rowBytes = width * 4 + 1;
  const scanlines = Buffer.alloc(rowBytes * height);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const compressed = deflateSync(scanlines, { level: 0 });
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed), pngChunk("IEND", Buffer.alloc(0))]);
  scanlines.fill(0); compressed.fill(0);
  return bytes;
}

test("fixed Banana Inpaint original upload emits one hidden multipart file for all admitted family variants", async () => {
  let expectedVariant: typeof VARIANTS[number] = VARIANTS[0];
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SECRET}`);
      const form = init?.body as FormData;
      assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("destination"), "hidden");
      assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), expectedVariant);
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.name, "original.png");
      assert.equal(file.type, "image/png");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG_1X1);
      return jsonResponse({ files: [{ id: 42, file_id: "42", url: `https://r2.syntx.ai/inpaint/${calls}.png`,
        mime_type: "image/png", size: PNG_1X1.byteLength, status: "accepted", discarded: SECRET }] });
    }
  });

  for (expectedVariant of VARIANTS) {
    const receipt = await upload(client, { variant: expectedVariant, bytes: PNG_1X1,
      filename: "original.png", mime_type: "image/png" });
    assert.deepEqual(receipt, { file_id: "42", url: `https://r2.syntx.ai/inpaint/${calls}.png` });
    assert.equal(JSON.stringify(receipt).includes(SECRET), false);
  }
  assert.equal(calls, VARIANTS.length);
});

test("fixed Banana Inpaint upload accepts one structurally valid source-UI image above the standard 32 MiB ceiling", async () => {
  const bytes = largeValidPng();
  assert.ok(bytes.byteLength > 32 * 1024 * 1024);
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_input, init) => {
      calls += 1;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      assert.equal(file.size, bytes.byteLength);
      assert.ok(file.size < 50 * 1024 * 1024);
      assert.equal(file.type, "image/png");
      const uploaded = Buffer.from(await file.arrayBuffer());
      assert.equal(createHash("sha256").update(uploaded).digest("hex"), createHash("sha256").update(bytes).digest("hex"));
      uploaded.fill(0);
      return jsonResponse({ files: [{ url: "https://r2.syntx.ai/inpaint/large.png", mime_type: "image/png", size: file.size }] });
    }
  });
  const receipt = await upload(client, { variant: "banana3", bytes, filename: "large.png", mime_type: "image/png" });
  assert.deepEqual(receipt, { url: "https://r2.syntx.ai/inpaint/large.png" });
  assert.equal(calls, 1);
  assert.equal(bytes[0], 137, "caller-owned input remains unchanged");
  bytes.fill(0);
});

test("Banana Inpaint upload rejects invalid variants and malformed inputs before credential or fetch", async () => {
  let credentialCalls = 0, fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(() => { credentialCalls += 1; }),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ files: [{ url: "https://r2.syntx.ai/x.png" }] }); }
  });
  for (const request of [
    { variant: "banana-2.1", bytes: PNG_1X1, filename: "original.png", mime_type: "image/png" },
    { variant: "banana3", bytes: PNG_1X1, filename: "../original.png", mime_type: "image/png" },
    { variant: "banana3", bytes: PNG_1X1, filename: "original.png", mime_type: "image/webp" },
    { variant: "banana3", bytes: PNG_1X1, filename: "original.png", mime_type: "image/png", destination: "uploaded" }
  ]) {
    await assert.rejects(() => upload(client, request),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("Banana Inpaint upload enforces one attributable matching receipt and never retries protocol failures", async () => {
  const badPayloads = [
    { files: [] },
    { files: [{ url: "https://r2.syntx.ai/a.png" }, { url: "https://r2.syntx.ai/b.png" }] },
    { files: [{ url: "https://attacker.invalid/a.png" }] },
    { files: [{ url: "https://r2.syntx.ai/a.png", mime_type: "image/jpeg" }] },
    { files: [{ url: "https://r2.syntx.ai/a.png", size: PNG_1X1.byteLength + 1 }] },
    { files: [{ id: "one", file_id: "two", url: "https://r2.syntx.ai/a.png" }] },
    { files: [{ id: "file-1", url: "https://r2.syntx.ai/a.png", status: "error" }] }
  ];
  for (const payload of badPayloads) {
    let calls = 0;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { calls += 1; return jsonResponse(payload); } });
    await assert.rejects(() => upload(client, { variant: "banana", bytes: PNG_1X1, filename: "original.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" && !String(error).includes(SECRET));
    assert.equal(calls, 1);
  }
});

test("Banana Inpaint upload remains bounded by deadline and parent abort without retry", async () => {
  let timeoutCalls = 0;
  const timeoutClient = new SyntxChatHttpClient({
    credentialBroker: broker(), requestTimeoutMs: 5,
    fetchImpl: async () => { timeoutCalls += 1; return new Promise<Response>(() => undefined); }
  });
  await assert.rejects(() => upload(timeoutClient, { variant: "banana", bytes: PNG_1X1,
    filename: "original.png", mime_type: "image/png" }),
  (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT");
  assert.equal(timeoutCalls, 1);

  let abortCalls = 0;
  const controller = new AbortController();
  const abortClient = new SyntxChatHttpClient({
    credentialBroker: broker(), requestTimeoutMs: 30_000,
    fetchImpl: async () => { abortCalls += 1; return new Promise<Response>(() => undefined); }
  });
  const pending = upload(abortClient, { variant: "banana", bytes: PNG_1X1,
    filename: "original.png", mime_type: "image/png" }, controller.signal);
  controller.abort();
  await assert.rejects(() => pending,
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(abortCalls, 1);
});

test("pre-aborted valid original upload stops before credential lookup or fetch", async () => {
  let credentialCalls = 0, fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(() => { credentialCalls += 1; }),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ files: [{ url: "https://r2.syntx.ai/unused.png" }] }); }
  });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => upload(client, { variant: "banana3", bytes: PNG_1X1,
    filename: "original.png", mime_type: "image/png" }, controller.signal),
  (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("late upload acknowledgments after caller abort or deadline are canceled and multipart data is released", async () => {
  for (const failure of ["abort", "timeout"] as const) {
    let calls = 0, canceled = 0, form: FormData | undefined;
    let markStarted!: () => void;
    let resolveLateResponse!: (response: Response) => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const lateResponse = new Promise<Response>((resolve) => { resolveLateResponse = resolve; });
    const client = new SyntxChatHttpClient({
      credentialBroker: broker(), requestTimeoutMs: failure === "timeout" ? 10 : 30_000,
      fetchImpl: async (_input, init) => {
        calls += 1; form = init?.body as FormData; markStarted(); return lateResponse;
      }
    });
    const controller = new AbortController();
    const pending = upload(client, { variant: "banana", bytes: PNG_1X1,
      filename: "original.png", mime_type: "image/png" }, failure === "abort" ? controller.signal : undefined);
    await started;
    if (failure === "abort") {
      controller.abort();
      await assert.rejects(() => pending,
        (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
    } else {
      await assert.rejects(() => pending,
        (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT");
    }
    resolveLateResponse(new Response(new ReadableStream<Uint8Array>({
      start() {},
      cancel() { canceled += 1; }
    }), { status: 200 }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1, `${failure}: late success is not retried`);
    assert.equal(canceled, 1, `${failure}: late response body is canceled`);
    assert.equal(form?.has("files"), false, `${failure}: multipart file entry is removed on failure`);
  }
});
