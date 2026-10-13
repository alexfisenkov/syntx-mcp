import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const CREDENTIAL = "synthetic-seedream-editor-upload-credential";

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); } };
}

function jpegHeader(width = 1, height = 1): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff,
    width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
}

function jpegWithExactSize(byteLength: number, width = 1, height = 1): Buffer {
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

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function upload(client: SyntxChatHttpClient, request: unknown, signal?: AbortSignal) {
  const seam = client as unknown as { uploadSeedreamEditorOriginal(input: unknown, signal?: AbortSignal): Promise<unknown> };
  return seam.uploadSeedreamEditorOriginal(request, signal);
}

const VARIANTS = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;

test("Seedream Editor original uses the exact fixed multipart contract for all five variants and canonicalizes JPG", async () => {
  let calls = 0;
  let expectedVariant: typeof VARIANTS[number] = VARIANTS[0];
  const forms: FormData[] = [];
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    calls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    const form = init?.body as FormData;
    forms.push(form);
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), expectedVariant);
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "original.jpg");
    assert.equal(file.type, "image/jpeg");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), jpegHeader());
    return jsonResponse({ files: [{ id: `editor-${calls}`, url: `https://r2.syntx.ai/editor/${calls}.jpg`, mime_type: "image/jpeg", size: jpegHeader().byteLength }] });
  } });

  for (expectedVariant of VARIANTS) {
    const bytes = jpegHeader();
    const original = Buffer.from(bytes);
    const receipt = await upload(client, { variant: expectedVariant, bytes, filename: "original.jpg", mime_type: "image/jpg" });
    assert.deepEqual(receipt, { file_id: `editor-${calls}`, url: `https://r2.syntx.ai/editor/${calls}.jpg` });
    assert.deepEqual(bytes, original);
  }
  assert.equal(calls, 5);
  assert.ok(forms.every((form) => form.get("files") === null), "multipart file references are released after each request");
});

test("Flash and Pro accept valid originals above ordinary Seedream's 10 MiB cap and under 30 MiB", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    calls += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    assert.equal(file.size, 12 * 1024 * 1024);
    return jsonResponse({ files: [{ url: `https://r2.syntx.ai/editor/large-${calls}.jpg`, mime_type: "image/jpeg", size: file.size }] });
  } });

  for (const variant of ["seedream-5.0-flash", "seedream-5.0-pro"] as const) {
    const bytes = jpegWithExactSize(12 * 1024 * 1024);
    const original = Buffer.from(bytes);
    const receipt = await upload(client, { variant, bytes, filename: "large.jpg", mime_type: "image/jpeg" });
    assert.deepEqual(receipt, { url: `https://r2.syntx.ai/editor/large-${calls}.jpg` });
    assert.deepEqual(bytes, original);
  }
  assert.equal(calls, 2);
});

test("Editor upload accepts a single safe receipt when upstream omits optional MIME and size echoes", async () => {
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () =>
    jsonResponse({ files: [{ id: "editor-no-echo", url: "https://r2.syntx.ai/editor/no-echo.jpg" }] }) });
  assert.deepEqual(await upload(client, {
    variant: "seedream-5.0-pro", bytes: jpegHeader(), filename: "original.jpg", mime_type: "image/jpeg"
  }), { file_id: "editor-no-echo", url: "https://r2.syntx.ai/editor/no-echo.jpg" });
});

test("Editor original strips unknown upload metadata while returning only the normalized receipt", async () => {
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => jsonResponse({
    request_id: "request-ignored",
    created_at: "2026-10-13T00:00:00Z",
    files: [{ id: "editor-known-id", url: "https://r2.syntx.ai/editor/known.jpg", mime_type: "image/jpeg", size: jpegHeader().byteLength,
      filename: "upstream-name.jpg", created_at: "2026-10-13T00:00:00Z", metadata: { trace: "must-not-leak" } }]
  }) });
  assert.deepEqual(await upload(client, { variant: "seedream-5", bytes: jpegHeader(), filename: "original.jpg", mime_type: "image/jpeg" }),
    { file_id: "editor-known-id", url: "https://r2.syntx.ai/editor/known.jpg" });
});

test("Editor upload enforces the 30 MiB source cap and rejects hostile caller fields before auth or POST", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const countingBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    credentialCalls += 1; return operation(CREDENTIAL);
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: countingBroker, fetchImpl: async () => {
    fetchCalls += 1; return jsonResponse({ files: [] });
  } });
  for (const [variant, cap] of [["seedream-5", 10 * 1024 * 1024], ["seedream-5.0-pro", 30 * 1024 * 1024]] as const) {
    const over = jpegWithExactSize(cap + 1);
    await assert.rejects(upload(client, { variant, bytes: over, filename: "over.jpg", mime_type: "image/jpeg" }),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  const base = { variant: "seedream-5.0-flash", bytes: jpegHeader(), filename: "source.jpg", mime_type: "image/jpeg" };
  const hostile: unknown[] = [
    { ...base, variant: "seedream-5.0-pro", destination: "hidden" },
    { ...base, model_type: "attacker" },
    { ...base, url: "https://attacker.invalid/image.jpg" },
    { ...base, extra: true },
    { ...base, mime_type: "image/avif" },
    { ...base, variant: "seedream-4", mime_type: "image/bmp" }
  ];
  for (const request of hostile) await assert.rejects(upload(client, request),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("Editor upload rejects plural, unsafe, conflicting, or error-status receipts", async () => {
  const good = { url: "https://r2.syntx.ai/editor/original.jpg", mime_type: "image/jpeg", size: jpegHeader().byteLength };
  const badPayloads: unknown[] = [
    { files: [] },
    { files: [good, good] },
    { files: [{ ...good, url: "https://attacker.invalid/original.jpg" }] },
    { files: [{ ...good, mime_type: "image/png" }] },
    { files: [{ ...good, size: good.size + 1 }] },
    { files: [{ ...good, id: "id-first", file_id: "id-conflict" }] },
    { files: [{ ...good, status: "error" }] }
  ];
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    const payload = badPayloads[calls]; calls += 1; return jsonResponse(payload);
  } });
  for (const _payload of badPayloads) {
    await assert.rejects(upload(client, { variant: "seedream-5", bytes: jpegHeader(), filename: "one.jpg", mime_type: "image/jpeg" }),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  }
  assert.equal(calls, badPayloads.length);
});

test("Editor upload honors pre-abort and timeout as one-shot outcomes", async () => {
  let abortedCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    abortedCalls += 1; return jsonResponse({ files: [] });
  } });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(upload(client, { variant: "seedream-5", bytes: jpegHeader(), filename: "x.jpg", mime_type: "image/jpeg" }, abort.signal),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(abortedCalls, 0);

  let timeoutCalls = 0;
  const timeoutClient = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 10, fetchImpl: async () => {
    timeoutCalls += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/editor/late.jpg", mime_type: "image/jpeg", size: jpegHeader().byteLength }] });
  } });
  await assert.rejects(upload(timeoutClient, { variant: "seedream-5", bytes: jpegHeader(), filename: "x.jpg", mime_type: "image/jpeg" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT");
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  assert.equal(timeoutCalls, 1);
});
