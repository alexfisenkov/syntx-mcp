import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readOwnerKlingKeyframesUploadReferenceForClient, SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  readValidatedOwnerKlingKeyframesImage,
  releaseValidatedOwnerKlingKeyframesImage,
  validateOwnerKlingKeyframesImage
} from "../src/application/owner-kling-keyframes-image-policy.js";

const SAFE_URL = "https://r2.syntx.ai/keyframes/frame.png";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function png300(): Buffer {
  const bytes = Buffer.from(PNG);
  bytes.writeUInt32BE(300, 16);
  bytes.writeUInt32BE(300, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

function makeBox(type: string, payload: Uint8Array): Buffer {
  const box = Buffer.alloc(8 + payload.byteLength);
  box.writeUInt32BE(box.byteLength, 0); box.write(type, 4, 4, "ascii"); Buffer.from(payload).copy(box, 8);
  return box;
}

function avif300(): Buffer {
  const full = (version: number, payload: Uint8Array) => Buffer.concat([Buffer.from([version, 0, 0, 0]), Buffer.from(payload)]);
  const u16 = (value: number) => { const bytes = Buffer.alloc(2); bytes.writeUInt16BE(value); return bytes; };
  const u32 = (value: number) => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
  const ispe = makeBox("ispe", full(0, Buffer.concat([u32(300), u32(300)])));
  const ftyp = makeBox("ftyp", Buffer.from("avif\0\0\0\0mif1avif", "ascii"));
  const hdlr = makeBox("hdlr", full(0, Buffer.from([0, 0, 0, 0, ...Buffer.from("pict", "ascii"), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
  const pitm = makeBox("pitm", full(0, u16(1)));
  const infe = makeBox("infe", Buffer.concat([full(2, Buffer.concat([u16(1), u16(0), Buffer.from("av01", "ascii"), Buffer.from([0])]))]));
  const iinf = makeBox("iinf", full(0, Buffer.concat([u16(1), infe])));
  const ipco = makeBox("ipco", Buffer.concat([ispe, ispe]));
  const ipma = makeBox("ipma", full(0, Buffer.concat([u32(1), u16(1), Buffer.from([1, 1])])));
  const iprp = makeBox("iprp", Buffer.concat([ipco, ipma]));
  const meta = makeBox("meta", full(0, Buffer.concat([hdlr, pitm, iinf, iprp])));
  return Buffer.concat([ftyp, meta, makeBox("mdat", Buffer.from([0]))]);
}

function client(onFetch: (init: RequestInit | undefined) => Promise<Response>): SyntxChatHttpClient {
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-test-credential");
  } };
  return new SyntxChatHttpClient({ credentialBroker, fetchImpl: async (_url, init) => onFetch(init), requestTimeoutMs: 1_000 });
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type KeyframesUploadClient = SyntxChatHttpClient & {
  uploadKlingKeyframesImage(receipt: unknown, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>>;
};

test("uploads one genuine keyframes image with fixed multipart fields and returns a safe private context", async () => {
  const bytes = png300();
  const original = Buffer.from(bytes);
  const receipt = validateOwnerKlingKeyframesImage({ filename: "кадр.bin", mime_type: "image/png", bytes });
  let posts = 0;
  const native = client(async (init) => {
    posts += 1;
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "кадр.png");
    assert.equal(file.type, "image/png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), original);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "kling_keyframes");
    assert.equal([...form.keys()].sort().join(","), "check_duplicates,destination,files,model_type");
    return response({ files: [{ filename: file.name, url: SAFE_URL, mime_type: file.type, size: file.size }] });
  }) as KeyframesUploadClient;
  try {
    const context = await native.uploadKlingKeyframesImage(receipt);
    assert.equal(posts, 1);
    assert.equal(Object.isFrozen(context), true);
    assert.equal(context.status, "uploaded");
    assert.equal(context.model_id, "kling_keyframes");
    assert.equal(context.source_mime_type, "image/png");
    assert.equal(context.size, bytes.byteLength);
    assert.equal(context.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(JSON.stringify(context).includes(SAFE_URL), false);
    assert.deepEqual(bytes, original);
    assert.notEqual(readValidatedOwnerKlingKeyframesImage(receipt), null);
    await assert.rejects(native.uploadKlingKeyframesImage(Object.freeze({ ...receipt })));
    await assert.rejects(native.uploadKlingKeyframesImage(new Proxy(receipt, {})));
    assert.equal(posts, 1);
    assert.deepEqual(readOwnerKlingKeyframesUploadReferenceForClient(native, context), { url: SAFE_URL });
    assert.equal(readOwnerKlingKeyframesUploadReferenceForClient(client(async () => response({ files: [] })), context), null);
    assert.equal(readOwnerKlingKeyframesUploadReferenceForClient(native, Object.freeze({ ...context })), null);
  } finally {
    releaseValidatedOwnerKlingKeyframesImage(receipt);
  }
});

test("uploads genuine AVIF with the same fixed uploaded destination", async () => {
  const bytes = avif300();
  const receipt = validateOwnerKlingKeyframesImage({ filename: "начало.avif", mime_type: "image/avif", bytes });
  let posts = 0;
  const native = client(async (init) => {
    posts += 1;
    const form = init?.body as FormData;
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/avif");
    assert.equal(form.get("model_type"), "kling_keyframes");
    return response({ files: [{ filename: file.name, url: SAFE_URL, mime_type: "image/avif", size: file.size }] });
  });
  try {
    const context = await native.uploadKlingKeyframesImage(receipt);
    assert.equal(context.mime_type, "image/avif");
    assert.equal(context.width, 300);
    assert.equal(posts, 1);
  } finally { releaseValidatedOwnerKlingKeyframesImage(receipt); }
});

test("rejects malformed, multiple, and unsafe URL upload receipts without retry", async (t) => {
  const receipt = validateOwnerKlingKeyframesImage({ filename: "кадр.png", mime_type: "image/png", bytes: png300() });
  const cases: readonly [string, unknown][] = [
    ["mismatched metadata", { files: [{ filename: "other.png", url: SAFE_URL, mime_type: "image/png", size: receipt.size }] }],
    ["multiple references", { files: [
      { filename: "кадр.png", url: SAFE_URL, mime_type: "image/png", size: receipt.size },
      { filename: "кадр.png", url: "https://r2.syntx.ai/second.png", mime_type: "image/png", size: receipt.size }
    ] }],
    ["unsafe URL", { files: [{ filename: "кадр.png", url: "https://example.invalid/file.png", mime_type: "image/png", size: receipt.size }] }]
  ];
  try {
    for (const [label, body] of cases) await t.test(label, async () => {
      let posts = 0;
      const native = client(async () => { posts += 1; return response(body); });
      await assert.rejects((native as KeyframesUploadClient).uploadKlingKeyframesImage(receipt));
      assert.equal(posts, 1);
    });
  } finally { releaseValidatedOwnerKlingKeyframesImage(receipt); }
});

test("abort after fetch starts does not retry and leaves the borrowed image receipt live", async () => {
  const receipt = validateOwnerKlingKeyframesImage({ filename: "кадр.png", mime_type: "image/png", bytes: png300() });
  let posts = 0;
  const native = client(async (init) => {
    posts += 1;
    const signal = init?.signal;
    assert.ok(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      setImmediate(() => controller.abort());
    });
  }) as KeyframesUploadClient;
  const controller = new AbortController();
  try {
    await assert.rejects(native.uploadKlingKeyframesImage(receipt, controller.signal));
    assert.equal(posts, 1);
    assert.notEqual(readValidatedOwnerKlingKeyframesImage(receipt), null);
  } finally { releaseValidatedOwnerKlingKeyframesImage(receipt); }
});
