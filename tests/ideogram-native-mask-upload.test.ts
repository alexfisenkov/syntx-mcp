import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { encodeOwnerIdeogramPaintedMaskVariants } from "../src/application/owner-ideogram-painted-mask-codec.js";

const CREDENTIAL = "synthetic-mask-upload-credential";
const PAINTED_RGBA_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const MASK_VARIANTS = encodeOwnerIdeogramPaintedMaskVariants(PAINTED_RGBA_PNG.toString("base64"));

function broker(onUse: () => void = () => {}): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    onUse(); return operation(CREDENTIAL);
  } };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const result = Buffer.alloc(body.byteLength + 8);
  result.writeUInt32BE(data.byteLength, 0); body.copy(result, 4); result.writeUInt32BE(crc32(body), body.byteLength + 4);
  return result;
}

function rgbaPng(pixel: readonly [number, number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const scanline = Buffer.from([0, ...pixel]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(scanline)), chunk("IEND", Buffer.alloc(0))
  ]);
}

test("mask transport uploads two codec outputs as ordered hidden files with fixed source fields and private receipts", async () => {
  const variants = [MASK_VARIANTS.source_inverted_mask_false, MASK_VARIANTS.source_inverted_mask_true];
  const originals = variants.map((variant) => Buffer.from(variant.bytes));
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    const variant = variants[calls]!;
    calls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "hidden"); assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "ideogram_45");
    const file = form.get("files"); assert.ok(file instanceof File);
    assert.equal(file.name, calls === 1 ? "mask-normal.png" : "mask-inverted.png");
    assert.equal(file.type, "image/png"); assert.equal(file.size, variant.bytes.byteLength);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), variant.bytes);
    return jsonResponse({ files: [{ id: `hidden-mask-${calls}`, url: `https://r2.syntx.ai/hidden/mask-${calls}`,
      mime_type: "image/png", size: variant.bytes.byteLength }] });
  } });

  const receipts = [];
  for (let index = 0; index < variants.length; index += 1) {
    receipts.push(await client.uploadIdeogramPaintedMaskVariant({ bytes: variants[index]!.bytes, filename: index === 0 ? "mask-normal.png" : "mask-inverted.png" }));
  }
  assert.deepEqual(receipts, [
    { file_id: "hidden-mask-1", url: "https://r2.syntx.ai/hidden/mask-1" },
    { file_id: "hidden-mask-2", url: "https://r2.syntx.ai/hidden/mask-2" }
  ]);
  assert.equal(calls, 2);
  variants.forEach((variant, index) => assert.deepEqual(variant.bytes, originals[index]));
});

test("rejects non-canonical, nonbinary, non-gray, or translucent mask PNG before credentials or fetch", async () => {
  const badBytes = [rgbaPng([0, 255, 0, 255]), rgbaPng([128, 128, 128, 255]), rgbaPng([0, 0, 0, 254]), Buffer.from("not png")];
  let credentialCalls = 0; let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentialCalls += 1; }),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); } });
  for (const bytes of badBytes) {
    await assert.rejects(client.uploadIdeogramPaintedMaskVariant({ bytes, filename: "mask.png" }),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(credentialCalls, 0); assert.equal(fetchCalls, 0);
});

test("byte accessor mutation and SharedArrayBuffer-backed views cannot change the validated upload bytes", async () => {
  let credentialCalls = 0; let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentialCalls += 1; }),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ files: [{ url: "https://r2.syntx.ai/hidden/mask" }] }); } });

  const accessorBytes = Buffer.from(MASK_VARIANTS.source_inverted_mask_false.bytes);
  const accessorByteLength = accessorBytes.length;
  const byteLengthGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;
  let byteLengthReads = 0;
  Object.defineProperty(accessorBytes, "byteLength", { configurable: true, get() {
    byteLengthReads += 1;
    const mutationOffset = accessorByteLength - 5;
    if (byteLengthReads === 2) accessorBytes[mutationOffset] = accessorBytes[mutationOffset]! ^ 0xff;
    return Reflect.apply(byteLengthGetter, this, []) as number;
  } });
  await assert.rejects(client.uploadIdeogramPaintedMaskVariant({ bytes: accessorBytes, filename: "mask.png" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(byteLengthReads, 0, "shadowed typed-array accessors are rejected without execution");

  const sharedStore = new SharedArrayBuffer(MASK_VARIANTS.source_inverted_mask_false.bytes.byteLength);
  const sharedBytes = Buffer.from(sharedStore, 0, MASK_VARIANTS.source_inverted_mask_false.bytes.byteLength);
  MASK_VARIANTS.source_inverted_mask_false.bytes.copy(sharedBytes);
  await assert.rejects(client.uploadIdeogramPaintedMaskVariant({ bytes: sharedBytes, filename: "mask.png" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentialCalls, 0); assert.equal(fetchCalls, 0);
});

test("pre-abort and invalid extra authority fail before credential access", async () => {
  let credentialCalls = 0; let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentialCalls += 1; }),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.uploadIdeogramPaintedMaskVariant({ bytes: MASK_VARIANTS.source_inverted_mask_false.bytes,
    filename: "mask.png" }, controller.signal),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  await assert.rejects(client.uploadIdeogramPaintedMaskVariant({ bytes: MASK_VARIANTS.source_inverted_mask_false.bytes,
    filename: "mask.png", destination: "uploaded" } as never),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  await assert.rejects(client.uploadIdeogramPaintedMaskVariant({ bytes: MASK_VARIANTS.source_inverted_mask_false.bytes,
    filename: "mask.png", model_type: "ideogram" } as never),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentialCalls, 0); assert.equal(fetchCalls, 0);
});

test("mismatched, unsafe, multiple, and failed hidden upload acknowledgments reject once without leaking URLs", async () => {
  const receipts = [
    { files: [{ url: "https://r2.syntx.ai/hidden/mime", mime_type: "image/jpeg" }] },
    { files: [{ url: "https://r2.syntx.ai/hidden/size", size: MASK_VARIANTS.source_inverted_mask_false.bytes.byteLength + 1 }] },
    { files: [{ url: "https://evil.invalid/private-mask" }] },
    { files: [{ url: "https://r2.syntx.ai/hidden/one" }, { url: "https://r2.syntx.ai/hidden/two" }] },
    { files: [{ url: "https://r2.syntx.ai/hidden/failed", status: "error" }] }
  ];
  let index = 0; let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    calls += 1; return jsonResponse(receipts[index++]!);
  } });
  for (let attempt = 0; attempt < receipts.length; attempt += 1) {
    await assert.rejects(client.uploadIdeogramPaintedMaskVariant({ bytes: MASK_VARIANTS.source_inverted_mask_false.bytes, filename: "mask.png" }),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" && !error.message.includes("evil.invalid"));
  }
  assert.equal(calls, receipts.length, "malformed acknowledgments are never retried");
});

test("redirect rejection is one fixed-route request and never follows or retries", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    calls += 1;
    assert.equal(init?.redirect, "error");
    throw new TypeError("redirect blocked");
  } });
  await assert.rejects(client.uploadIdeogramPaintedMaskVariant({ bytes: MASK_VARIANTS.source_inverted_mask_false.bytes, filename: "mask.png" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_UNAVAILABLE" && !error.message.includes("redirect"));
  assert.equal(calls, 1);
});

test("in-flight abort cancels one upload attempt and late ACK body is canceled, not accepted or retried", async () => {
  let calls = 0; let start!: () => void; let lateAck!: (response: Response) => void; let cancelled = 0;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const lateResponse = new Promise<Response>((resolve) => { lateAck = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    calls += 1; start(); return lateResponse;
  } });
  const controller = new AbortController();
  const pending = client.uploadIdeogramPaintedMaskVariant({ bytes: MASK_VARIANTS.source_inverted_mask_false.bytes, filename: "mask.png" }, controller.signal);
  await started; controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  lateAck(new Response(new ReadableStream<Uint8Array>({ start() {}, cancel() { cancelled += 1; } }), { status: 200 }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(cancelled, 1);
});

test("deadline after send produces one timeout outcome without retry", async () => {
  let calls = 0; let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 10, fetchImpl: async (_input, init) => {
    calls += 1; started();
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  } });
  const pending = client.uploadIdeogramPaintedMaskVariant({ bytes: MASK_VARIANTS.source_inverted_mask_false.bytes, filename: "mask.png" });
  await entered;
  await assert.rejects(pending, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT");
  assert.equal(calls, 1);
});
