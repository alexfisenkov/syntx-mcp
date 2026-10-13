import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { validateOwnerKontextImageInput, type OwnerKontextCanonicalImageMimeType } from "../src/application/owner-kontext-image-input-validator.js";

const CREDENTIAL = "synthetic-kontext-upload-credential";
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
const FORMATS = [
  { mime_type: "image/jpeg", filename: "source.jpg", content_base64: JPEG_1X1.toString("base64"), bytes: JPEG_1X1 },
  { mime_type: "image/png", filename: "source.png", content_base64: PNG_1X1, bytes: Buffer.from(PNG_1X1, "base64") },
  { mime_type: "image/avif", filename: "source.avif", content_base64: AVIF_16X16, bytes: Buffer.from(AVIF_16X16, "base64") },
  { mime_type: "image/webp", filename: "source.webp", content_base64: WEBP_1X1.toString("base64"), bytes: WEBP_1X1 }
] as const;

function clientWith(fetchImpl: typeof fetch, counts = { credentials: 0 }) {
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      counts.credentials += 1;
      return operation(CREDENTIAL);
    }
  };
  return new SyntxChatHttpClient({ credentialBroker, fetchImpl });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
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

test("Kontext upload sends one fixed multipart file for each exact variant and canonical image MIME", async () => {
  let fetchCalls = 0;
  let counts = { credentials: 0 };
  let currentVariant: "flux-kontext-pro" | "flux-kontext-max" | "flux-kontext-multi" = "flux-kontext-pro";
  let currentFormat: typeof FORMATS[number];
  const client = clientWith(async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${CREDENTIAL}`);
    assert.equal(new Headers(init?.headers).get("content-type"), null);
    assert.ok(init?.body instanceof FormData);
    const form = init.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), currentVariant);
    const files = form.getAll("files");
    assert.equal(files.length, 1);
    assert.ok(files[0] instanceof File);
    const file = files[0] as File;
    assert.equal(file.name, currentFormat.filename);
    assert.equal(file.type, currentFormat.mime_type);
    assert.equal(file.size, currentFormat.bytes.byteLength);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), currentFormat.bytes);
    return jsonResponse({ files: [{
      id: `kontext-${fetchCalls}`,
      url: `https://r2.syntx.ai/kontext/${currentVariant}-${fetchCalls}.${currentFormat.filename.split(".").at(-1)}`,
      mime_type: currentFormat.mime_type,
      size: currentFormat.bytes.byteLength
    }] });
  }, counts);

  for (currentVariant of ["flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"] as const) {
    for (const format of FORMATS) {
      currentFormat = format;
      const validated = validateOwnerKontextImageInput({
        content_base64: format.content_base64, filename: format.filename, mime_type: format.mime_type
      });
      const uploaded = await client.uploadKontextImageReference({
        bytes: validated.bytes, filename: validated.filename, mime_type: validated.mime_type, model_type: currentVariant
      });
      assert.deepEqual(uploaded, {
        file_id: `kontext-${fetchCalls}`,
        url: `https://r2.syntx.ai/kontext/${currentVariant}-${fetchCalls}.${format.filename.split(".").at(-1)}`
      });
      assert.ok(validated.bytes.every((byte) => byte === 0), "the HTTP caller clears validator-owned bytes after upload");
    }
  }
  assert.equal(fetchCalls, 12);
  assert.equal(counts.credentials, 12);
});

test("Kontext image/jpg source label canonicalizes to image/jpeg for the one-file upload", async () => {
  const validated = validateOwnerKontextImageInput({
    content_base64: JPEG_1X1.toString("base64"), filename: "картинка.jpg", mime_type: "image/jpg"
  });
  assert.equal(validated.original_mime_type, "image/jpg");
  assert.equal(validated.mime_type satisfies OwnerKontextCanonicalImageMimeType, "image/jpeg");
  let fetchCalls = 0;
  const client = clientWith(async (_input, init) => {
    fetchCalls += 1;
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "картинка.jpg");
    assert.equal(file.type, "image/jpeg");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), JPEG_1X1);
    return jsonResponse({ files: [{ id: "kontext-jpg-alias", url: "https://r2.syntx.ai/kontext/canonical.jpg",
      mime_type: "image/jpeg", size: JPEG_1X1.byteLength }] });
  });
  const reference = await client.uploadKontextImageReference({
    bytes: validated.bytes, filename: validated.filename, mime_type: validated.mime_type, model_type: "flux-kontext-pro"
  });
  assert.deepEqual(reference, { file_id: "kontext-jpg-alias", url: "https://r2.syntx.ai/kontext/canonical.jpg" });
  assert.equal(fetchCalls, 1);
  assert.ok(validated.bytes.every((byte) => byte === 0));
});

test("Kontext native upload accepts exactly 10 MiB and rejects empty or one-byte-over input before credentials", async () => {
  const exact = jpegWithExactSize(10 * 1024 * 1024);
  let fetchCalls = 0;
  const counts = { credentials: 0 };
  const client = clientWith(async (_input, init) => {
    fetchCalls += 1;
    const form = init?.body as FormData;
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.size, 10 * 1024 * 1024);
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/kontext/exact.png", mime_type: "image/jpeg", size: file.size }] });
  }, counts);
  await client.uploadKontextImageReference({
    bytes: exact, filename: "exact.jpg", mime_type: "image/jpeg", model_type: "flux-kontext-pro"
  });
  assert.equal(fetchCalls, 1);
  assert.equal(counts.credentials, 1);
  assert.ok(exact.every((byte) => byte === 0));

  for (const bytes of [new Uint8Array(), new Uint8Array(10 * 1024 * 1024 + 1)]) {
    await assert.rejects(client.uploadKontextImageReference({
      bytes, filename: "invalid.jpg", mime_type: "image/jpeg", model_type: "flux-kontext-pro"
    }), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(fetchCalls, 1);
  assert.equal(counts.credentials, 1);
});

test("Kontext upload snapshots bytes before waiting for the linked credential", async () => {
  const validated = validateOwnerKontextImageInput({ content_base64: PNG_1X1, filename: "copy.png", mime_type: "image/png" });
  const expected = Buffer.from(validated.bytes);
  let releaseCredential!: () => void;
  const credentialGate = new Promise<void>((resolve) => { releaseCredential = resolve; });
  let fetchCalls = 0;
  let submitted: Buffer | undefined;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      await credentialGate;
      return operation(CREDENTIAL);
    } },
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      submitted = Buffer.from(await file.arrayBuffer());
      return jsonResponse({ files: [{ url: "https://r2.syntx.ai/kontext/copied.png", mime_type: "image/png", size: expected.byteLength }] });
    }
  });
  const pending = client.uploadKontextImageReference({
    bytes: validated.bytes, filename: validated.filename, mime_type: validated.mime_type, model_type: "flux-kontext-max"
  });
  validated.bytes.fill(0);
  releaseCredential();
  await pending;
  assert.deepEqual(submitted, expected);
  assert.equal(fetchCalls, 1);
});

test("Kontext upload rejects uncanonicalized MIME, wrong model, unsafe filename, mismatched bytes, and URL fields before auth", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      return operation(CREDENTIAL);
    } },
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ files: [] }); }
  });
  const base = { bytes: Buffer.from(PNG_1X1, "base64"), filename: "valid.png", mime_type: "image/png", model_type: "flux-kontext-pro" };
  const invalid: unknown[] = [
    { ...base, mime_type: "image/jpg" },
    { ...base, model_type: "flux-kontext-pro;private" },
    { ...base, filename: "../private.png" },
    { ...base, filename: "control\u0000.png" },
    { ...base, bytes: Buffer.from(JPEG_1X1) },
    { ...base, url: "https://r2.syntx.ai/private.png" },
    { ...base, destination: "hidden" },
    { ...base, extra: true }
  ];
  let getterCalls = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, "model_type", { enumerable: true, get() { getterCalls += 1; return base.model_type; } });
  invalid.push(accessor, new Proxy({ ...base }, {}));
  for (const request of invalid) {
    await assert.rejects(client.uploadKontextImageReference(request as never),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(getterCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(credentialCalls, 0);
});

test("Kontext upload rejects non-single or mismatched receipts once without disclosing receipt values", async () => {
  const validFile = { id: "kontext-file-1", url: "https://r2.syntx.ai/kontext/receipt.png", mime_type: "image/png", size: 68 };
  const invalidReceipts: unknown[] = [
    {}, { files: [] }, { files: [validFile, validFile] },
    { files: [{ ...validFile, mime_type: undefined }] }, { files: [{ ...validFile, mime_type: "image/jpeg" }] },
    { files: [{ ...validFile, size: undefined }] }, { files: [{ ...validFile, size: 67 }] },
    { files: [{ ...validFile, url: "https://attacker.invalid/private.png" }] },
    { files: [{ ...validFile, id: "kontext-file-1", file_id: "other-id" }] },
    { files: [{ ...validFile, status: "error" }] }
  ];
  for (const receipt of invalidReceipts) {
    let fetchCalls = 0;
    const client = clientWith(async () => { fetchCalls += 1; return jsonResponse(receipt); });
    const validated = validateOwnerKontextImageInput({ content_base64: PNG_1X1, filename: "one.png", mime_type: "image/png" });
    await assert.rejects(client.uploadKontextImageReference({
      bytes: validated.bytes, filename: validated.filename, mime_type: validated.mime_type, model_type: "flux-kontext-multi"
    }), (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" &&
      !error.message.includes("attacker.invalid") && !error.message.includes("other-id"));
    assert.equal(fetchCalls, 1);
    assert.ok(validated.bytes.every((byte) => byte === 0));
  }
});

test("Kontext upload rejects redirected and failed requests without retry", async () => {
  const redirected = jsonResponse({ files: [{ url: "https://r2.syntx.ai/kontext/redirect.png", mime_type: "image/png", size: 68 }] });
  Object.defineProperty(redirected, "redirected", { value: true });
  let fetchCalls = 0;
  const redirectedClient = clientWith(async () => { fetchCalls += 1; return redirected; });
  const input = { bytes: Buffer.from(PNG_1X1, "base64"), filename: "one.png", mime_type: "image/png", model_type: "flux-kontext-pro" } as const;
  await assert.rejects(redirectedClient.uploadKontextImageReference(input),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  assert.equal(fetchCalls, 1);

  const failedClient = clientWith(async () => { fetchCalls += 1; throw new Error("private response URL must stay redacted"); });
  await assert.rejects(failedClient.uploadKontextImageReference({ ...input, bytes: Buffer.from(PNG_1X1, "base64") }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_UNAVAILABLE" &&
      !error.message.includes("private response URL"));
  assert.equal(fetchCalls, 2);
});

test("Kontext upload propagates pre-send and in-flight aborts without retry", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      return operation(CREDENTIAL);
    } },
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      markFetchStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
  });
  const makeValidated = () => validateOwnerKontextImageInput({
    content_base64: PNG_1X1, filename: "abort.png", mime_type: "image/png"
  });
  const uploadRequest = (validated: ReturnType<typeof makeValidated>) => ({
    bytes: validated.bytes, filename: validated.filename, mime_type: validated.mime_type, model_type: "flux-kontext-pro" as const
  });
  const beforeSend = new AbortController();
  beforeSend.abort();
  const preSendInput = makeValidated();
  await assert.rejects(client.uploadKontextImageReference(uploadRequest(preSendInput), beforeSend.signal),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(fetchCalls, 0);

  const controller = new AbortController();
  const inFlightInput = makeValidated();
  const pending = client.uploadKontextImageReference(uploadRequest(inFlightInput), controller.signal);
  await fetchStarted;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(fetchCalls, 1);
  assert.equal(credentialCalls, 1);
  assert.ok(preSendInput.bytes.every((byte) => byte === 0));
  assert.ok(inFlightInput.bytes.every((byte) => byte === 0));
});
