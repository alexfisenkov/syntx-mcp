import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const CREDENTIAL = "synthetic-magnific-upload-credential";
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const AVIF_16X16 = "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==";
const JPEG_1X1 = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9
]);
const WEBP_1X1 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00
]);

type ModelType = "creative" | "precision_v1" | "precision_v2";
type MimeType = (typeof FORMATS)[number]["mime"];
const FORMATS = [
  { mime: "image/jpeg", filename: "photo.jpg", bytes: JPEG_1X1 },
  { mime: "image/png", filename: "photo.png", bytes: Buffer.from(PNG_1X1, "base64") },
  { mime: "image/avif", filename: "photo.avif", bytes: Buffer.from(AVIF_16X16, "base64") },
  { mime: "image/webp", filename: "photo.webp", bytes: WEBP_1X1 }
] as const;

function brokerWith(counter: { calls: number }, wait?: Promise<void>): SyntxCredentialBroker {
  return {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      counter.calls += 1;
      if (wait) await wait;
      return operation(CREDENTIAL);
    }
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers).entries()) }
  });
}

function uploadInput(bytes: Uint8Array, filename = "photo.png", mime_type: MimeType = "image/png", model_type: ModelType = "creative") {
  return { bytes, filename, mime_type, model_type };
}

function clientWith(fetchImpl: typeof fetch, credentialCalls = { calls: 0 }) {
  return new SyntxChatHttpClient({ credentialBroker: brokerWith(credentialCalls), fetchImpl });
}

function jpegWithExactSize(byteLength: number): Buffer {
  const tail = Buffer.from([
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9
  ]);
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let remaining = byteLength - 2 - tail.byteLength;
  while (remaining > 65_537) {
    const marker = Buffer.alloc(65_537);
    marker[0] = 0xff; marker[1] = 0xe1; marker.writeUInt16BE(65_535, 2);
    parts.push(marker);
    remaining -= marker.byteLength;
  }
  if (remaining < 4) throw new Error("Fixture is too small for a JPEG marker.");
  const lastMarker = Buffer.alloc(remaining);
  lastMarker[0] = 0xff; lastMarker[1] = 0xe1; lastMarker.writeUInt16BE(remaining - 2, 2);
  parts.push(lastMarker, tail);
  return Buffer.concat(parts);
}

test("Magnific upload binds all three model types and all four sniffed MIME formats to the exact multipart route", async () => {
  for (const model_type of ["creative", "precision_v1", "precision_v2"] as const) {
    for (const fixture of FORMATS) {
      let fetchCalls = 0;
      const client = clientWith(async (input, init) => {
        fetchCalls += 1;
        assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
        assert.equal(init?.method, "POST");
        assert.equal(init?.redirect, "error");
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${CREDENTIAL}`);
        assert.ok(init?.body instanceof FormData);
        const form = init.body as FormData;
        assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
        assert.equal(form.get("destination"), "uploaded");
        assert.equal(form.get("check_duplicates"), "true");
        assert.equal(form.get("model_type"), model_type);
        const file = form.get("files");
        assert.ok(file instanceof File);
        assert.equal(file.name, fixture.filename);
        assert.equal(file.type, fixture.mime);
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(fixture.bytes));
        return jsonResponse({ files: [{
          id: "magnific-file-17", url: "https://r2.syntx.ai/magnific/opaque-input.png",
          mime_type: fixture.mime, size: fixture.bytes.byteLength
        }] });
      });

      const reference = await client.uploadMagnificUpscaleImageReference(
        uploadInput(fixture.bytes, fixture.filename, fixture.mime, model_type)
      );
      assert.deepEqual(reference, { file_id: "magnific-file-17", url: "https://r2.syntx.ai/magnific/opaque-input.png" });
      assert.equal(fetchCalls, 1);
    }
  }
});

test("Magnific upload accepts exactly 10 MiB and rejects empty or one byte over before auth", async () => {
  const tenMiB = jpegWithExactSize(10 * 1024 * 1024);
  let fetchCalls = 0;
  const credentialCalls = { calls: 0 };
  const client = new SyntxChatHttpClient({
    credentialBroker: brokerWith(credentialCalls),
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      assert.ok(init?.body instanceof FormData);
      const file = (init.body as FormData).get("files");
      assert.ok(file instanceof File);
      assert.equal(file.size, 10 * 1024 * 1024);
      return jsonResponse({ files: [{ url: "https://r2.syntx.ai/magnific/exact.png", mime_type: "image/jpeg", size: 10 * 1024 * 1024 }] });
    }
  });
  await client.uploadMagnificUpscaleImageReference(uploadInput(tenMiB, "exact.jpg", "image/jpeg"));
  assert.equal(fetchCalls, 1);
  assert.equal(credentialCalls.calls, 1);

  for (const bytes of [new Uint8Array(), jpegWithExactSize(10 * 1024 * 1024 + 1)]) {
    await assert.rejects(client.uploadMagnificUpscaleImageReference(uploadInput(bytes, "invalid.jpg", "image/jpeg")),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(fetchCalls, 1);
  assert.equal(credentialCalls.calls, 1);
});

test("Magnific upload copies caller bytes before waiting for credentials", async () => {
  let releaseCredential!: () => void;
  const credentialGate = new Promise<void>((resolve) => { releaseCredential = resolve; });
  const source = Buffer.from(PNG_1X1, "base64");
  const expectedBytes = Buffer.from(source);
  let uploadedBytes: Buffer | undefined;
  const credentialCalls = { calls: 0 };
  const client = new SyntxChatHttpClient({
    credentialBroker: brokerWith(credentialCalls, credentialGate),
    fetchImpl: async (_input, init) => {
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      uploadedBytes = Buffer.from(await file.arrayBuffer());
      return jsonResponse({ files: [{ url: "https://r2.syntx.ai/magnific/copy.png", mime_type: "image/png", size: expectedBytes.byteLength }] });
    }
  });
  const pending = client.uploadMagnificUpscaleImageReference(uploadInput(source));
  source.fill(0);
  releaseCredential();
  await pending;
  assert.deepEqual(uploadedBytes, expectedBytes);
  assert.equal(credentialCalls.calls, 1);
});

test("Magnific upload rejects malformed, plural, MIME/size-mismatched, and unsafe receipts without retry", async () => {
  const validFile = { id: "file-1", url: "https://r2.syntx.ai/magnific/result.png", mime_type: "image/png", size: 68 };
  const invalidReceipts: unknown[] = [
    {},
    { files: [] },
    { files: [validFile, validFile] },
    { files: [{ ...validFile, mime_type: undefined }] },
    { files: [{ ...validFile, mime_type: "image/jpeg" }] },
    { files: [{ ...validFile, size: undefined }] },
    { files: [{ ...validFile, size: 67 }] },
    { files: [{ ...validFile, url: "https://example.invalid/result.png" }] },
    { files: [{ ...validFile, id: "file-1", file_id: "file-2" }] },
    { files: [{ ...validFile, status: "error" }] }
  ];

  for (const receipt of invalidReceipts) {
    let fetchCalls = 0;
    const client = clientWith(async () => {
      fetchCalls += 1;
      return jsonResponse(receipt);
    });
    await assert.rejects(client.uploadMagnificUpscaleImageReference(uploadInput(Buffer.from(PNG_1X1, "base64"))),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" &&
        !error.message.includes("example.invalid") && !error.message.includes("file-2"));
    assert.equal(fetchCalls, 1);
  }
});

test("Magnific upload rejects a redirected response without retry", async () => {
  let fetchCalls = 0;
  const redirected = jsonResponse({ files: [{
    url: "https://r2.syntx.ai/magnific/redirect.png", mime_type: "image/png", size: 68
  }] });
  Object.defineProperty(redirected, "redirected", { value: true });
  const client = clientWith(async () => {
    fetchCalls += 1;
    return redirected;
  });
  await assert.rejects(client.uploadMagnificUpscaleImageReference(uploadInput(Buffer.from(PNG_1X1, "base64"))),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  assert.equal(fetchCalls, 1);
});

test("Magnific upload rejects caller MIME, model, filename, proxy, and accessors before auth", async () => {
  const credentialCalls = { calls: 0 };
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: brokerWith(credentialCalls),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); }
  });
  let getterCalls = 0;
  const accessor = { bytes: Buffer.from(PNG_1X1, "base64"), filename: "photo.png", model_type: "creative" };
  Object.defineProperty(accessor, "mime_type", { enumerable: true, get() { getterCalls += 1; return "image/png"; } });
  const customPrototype = Object.assign(Object.create({ private: true }), uploadInput(Buffer.from(PNG_1X1, "base64")));
  const withSymbol = { ...uploadInput(Buffer.from(PNG_1X1, "base64")), [Symbol("private")]: "secret" };
  const invalidRequests = [
    uploadInput(Buffer.from(PNG_1X1, "base64"), "photo.png", "image/jpeg"),
    uploadInput(Buffer.from(PNG_1X1, "base64"), "../private.png"),
    uploadInput(Buffer.from(PNG_1X1, "base64"), "photo.png", "image/png", "creative;private" as ModelType),
    { ...uploadInput(Buffer.from(PNG_1X1, "base64")), extra: true },
    withSymbol,
    customPrototype,
    accessor,
    new Proxy(uploadInput(Buffer.from(PNG_1X1, "base64")), {})
  ];
  for (const request of invalidRequests) {
    await assert.rejects(client.uploadMagnificUpscaleImageReference(request as never),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(getterCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(credentialCalls.calls, 0);
});

test("Magnific upload caller abort interrupts one in-flight request without retry", async () => {
  let fetchCalls = 0;
  let startFetch!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { startFetch = resolve; });
  const client = clientWith(async (_input, init) => {
    fetchCalls += 1;
    startFetch();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  });
  const controller = new AbortController();
  const pending = client.uploadMagnificUpscaleImageReference(uploadInput(Buffer.from(PNG_1X1, "base64")), controller.signal);
  await fetchStarted;
  controller.abort();
  await assert.rejects(pending, (error: unknown) =>
    error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(fetchCalls, 1);
});
