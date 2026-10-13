import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const CREDENTIAL = "synthetic-ideogram-upload-credential";
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG_1X1 = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);
const WEBP_1X1 = Buffer.from([0x52,0x49,0x46,0x46,0x12,0x00,0x00,0x00,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x4c,0x05,0x00,0x00,0x00,0x2f,0x00,0x00,0x00,0x00,0x00]);
const AVIF_16X16 = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); } };
}
function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
function jpegWithExactSize(byteLength: number): Buffer {
  const tail = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,
    0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]).subarray(2);
  const chunks: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let remaining = byteLength - 2 - tail.byteLength;
  while (remaining > 65_537) {
    const marker = Buffer.alloc(65_537); marker[0] = 0xff; marker[1] = 0xe1; marker.writeUInt16BE(65_535, 2);
    chunks.push(marker); remaining -= marker.byteLength;
  }
  if (remaining < 4) throw new Error("JPEG fixture size is too small.");
  const finalMarker = Buffer.alloc(remaining); finalMarker[0] = 0xff; finalMarker[1] = 0xe1;
  finalMarker.writeUInt16BE(remaining - 2, 2); chunks.push(finalMarker, tail);
  return Buffer.concat(chunks);
}

test("Ideogram upload uses one fixed route and exact source model/MIME, returning only an internal reference", async () => {
  const inputs = [
    { model_id: "ideogram", bytes: PNG_1X1, filename: "base.png", mime_type: "image/png", canonical: "image/png" },
    { model_id: "ideogram", bytes: JPEG_1X1, filename: "base.jpg", mime_type: "image/jpg", canonical: "image/jpeg" },
    { model_id: "ideogram", bytes: AVIF_16X16, filename: "base.avif", mime_type: "image/avif", canonical: "image/avif" },
    { model_id: "ideogram_40", bytes: WEBP_1X1, filename: "v4.webp", mime_type: "image/webp", canonical: "image/webp" },
    { model_id: "ideogram_45", bytes: PNG_1X1, filename: "v45.png", mime_type: "image/png", canonical: "image/png" }
  ] as const;
  let current: typeof inputs[number] = inputs[0];
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    calls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), current.model_id);
    const file = form.get("files"); assert.ok(file instanceof File);
    assert.equal(file.name, current.filename); assert.equal(file.type, current.canonical);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), current.bytes);
    return jsonResponse({ files: [{ id: `ideogram-file-${calls}`, url: `https://r2.syntx.ai/ideogram/${calls}`, mime_type: current.canonical, size: current.bytes.byteLength }] });
  } });

  const callerCopies = inputs.map((item) => Buffer.from(item.bytes));
  const results = [];
  for (let index = 0; index < inputs.length; index += 1) {
    current = inputs[index]!;
    try {
      results.push(await client.uploadIdeogramImageReference({ model_id: current.model_id, bytes: current.bytes,
        filename: current.filename, mime_type: current.mime_type }));
    } catch (error) {
      throw new Error(`Valid fixture rejected: ${current.model_id}/${current.filename}`, { cause: error });
    }
  }
  assert.deepEqual(results[0], { file_id: "ideogram-file-1", url: "https://r2.syntx.ai/ideogram/1" });
  assert.equal(calls, inputs.length);
  inputs.forEach((item, index) => assert.deepEqual(item.bytes, callerCopies[index]));
});

test("V4 upload accepts 33 MiB JPEG beyond the fixed Standard 32 MiB ceiling", async () => {
  const bytes = jpegWithExactSize(33 * 1024 * 1024);
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    calls += 1;
    const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File);
    assert.equal(file.size, bytes.byteLength); assert.equal(file.type, "image/jpeg");
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/ideogram/large", size: file.size, mime_type: file.type }] });
  } });
  const receipt = await client.uploadIdeogramImageReference({ model_id: "ideogram_40", bytes, filename: "large.jpg", mime_type: "image/jpeg" });
  assert.deepEqual(receipt, { url: "https://r2.syntx.ai/ideogram/large" });
  assert.equal(calls, 1);
  assert.ok(bytes.some((byte) => byte !== 0), "caller-owned input remains unchanged");
});

test("V4 rejects AVIF and over-source-limit bytes before credentials or upload", async () => {
  let credentialCalls = 0; let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    credentialCalls += 1; return operation(CREDENTIAL);
  } }, fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); } });
  await assert.rejects(client.uploadIdeogramImageReference({ model_id: "ideogram_40", bytes: AVIF_16X16,
    filename: "v4.avif", mime_type: "image/avif" }), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  await assert.rejects(client.uploadIdeogramImageReference({ model_id: "ideogram_45", bytes: new Uint8Array(25 * 1024 * 1024 + 1),
    filename: "oversized.jpg", mime_type: "image/jpeg" }), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentialCalls, 0); assert.equal(fetchCalls, 0);
});

test("getter/proxy/extra authority input fails before credentials and receipt errors never expose private URLs", async () => {
  let credentialCalls = 0; let fetchCalls = 0; let getterCalls = 0; let proxyTraps = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    credentialCalls += 1; return operation(CREDENTIAL);
  } }, fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ files: [{ url: "https://evil.invalid/private" }] }); } });
  const getter = Object.defineProperty({ bytes: PNG_1X1, filename: "x.png", mime_type: "image/png" }, "model_id", {
    enumerable: true, get() { getterCalls += 1; return "ideogram"; }
  });
  const proxy = new Proxy({}, { ownKeys() { proxyTraps += 1; return []; } });
  for (const input of [getter, proxy, { model_id: "ideogram", bytes: PNG_1X1, filename: "x.png", mime_type: "image/png", url: "https://evil.invalid" }]) {
    await assert.rejects(client.uploadIdeogramImageReference(input as never),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(getterCalls, 0); assert.equal(proxyTraps, 0); assert.equal(credentialCalls, 0); assert.equal(fetchCalls, 0);
  const badClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    fetchCalls += 1; return jsonResponse({ files: [{ url: "https://evil.invalid/private" }] });
  } });
  await assert.rejects(badClient.uploadIdeogramImageReference({ model_id: "ideogram", bytes: PNG_1X1,
    filename: "x.png", mime_type: "image/png" }), (error: unknown) => error instanceof SyntxHttpError &&
      error.code === "UPSTREAM_PROTOCOL_ERROR" && !error.message.includes("evil.invalid"));
  assert.equal(fetchCalls, 1);
});

test("malformed Ideogram receipts are rejected once with a safe protocol error", async () => {
  const receipts = [
    { files: [{ url: "https://r2.syntx.ai/ideogram/mime", mime_type: "image/jpeg" }] },
    { files: [{ url: "https://r2.syntx.ai/ideogram/size", size: PNG_1X1.byteLength + 1 }] },
    { files: [{ url: "https://r2.syntx.ai/ideogram/multiple-1" }, { url: "https://r2.syntx.ai/ideogram/multiple-2" }] },
    { files: [{ id: "first", file_id: "second", url: "https://r2.syntx.ai/ideogram/ids" }] },
    { files: [{ id: "failed", status: "error", url: "https://r2.syntx.ai/ideogram/error" }] }
  ];
  let index = 0; let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    calls += 1;
    return jsonResponse(receipts[index++]!);
  } });
  for (let attempt = 0; attempt < receipts.length; attempt += 1) {
    await assert.rejects(client.uploadIdeogramImageReference({ model_id: "ideogram", bytes: PNG_1X1,
      filename: "x.png", mime_type: "image/png" }), (error: unknown) => error instanceof SyntxHttpError &&
        error.code === "UPSTREAM_PROTOCOL_ERROR" && !error.message.includes("ideogram"));
  }
  assert.equal(calls, receipts.length, "no malformed acknowledgment is retried");
});

test("abort after upload starts makes one unknown request outcome and does not retry", async () => {
  let calls = 0; let start!: () => void;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    calls += 1; start();
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  } });
  const controller = new AbortController();
  const pending = client.uploadIdeogramImageReference({ model_id: "ideogram", bytes: PNG_1X1,
    filename: "x.png", mime_type: "image/png" }, controller.signal);
  await started; controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(calls, 1);
});

test("a response arriving after caller abort is drained by cancellation and never retried", async () => {
  let calls = 0; let start!: () => void; let lateAck!: (response: Response) => void; let cancelled = 0;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const lateResponse = new Promise<Response>((resolve) => { lateAck = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    calls += 1; start(); return lateResponse;
  } });
  const controller = new AbortController();
  const pending = client.uploadIdeogramImageReference({ model_id: "ideogram", bytes: PNG_1X1,
    filename: "x.png", mime_type: "image/png" }, controller.signal);
  await started; controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  const body = new ReadableStream<Uint8Array>({
    start() {},
    cancel() { cancelled += 1; }
  });
  lateAck(new Response(body, { status: 200 }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1, "late success body is cancelled instead of read or retained");
  assert.equal(calls, 1, "unknown upload outcome is never retried");
});
