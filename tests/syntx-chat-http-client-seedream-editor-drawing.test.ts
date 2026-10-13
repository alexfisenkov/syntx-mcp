import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-seedream-drawing-credential"); } };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const VARIANTS = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"] as const;

test("Seedream Editor drawing exposes one fixed native upload method", async () => {
  let calls = 0, expectedVariant: typeof VARIANTS[number] = VARIANTS[0];
  const forms: FormData[] = [];
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    calls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
    const form = init?.body as FormData; forms.push(form);
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "hidden"); assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), expectedVariant);
    const file = form.get("files"); assert.ok(file instanceof File); assert.equal(file.name, "drawing.png");
    assert.equal(file.type, "image/png"); assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
    return new Response(JSON.stringify({ files: [{ id: `drawing-${calls}`, url: `https://r2.syntx.ai/drawing-${calls}.png`, mime_type: "image/png", size: PNG.byteLength }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  } });
  const api = client as unknown as { uploadSeedreamEditorDrawing(input: unknown): Promise<unknown> };
  assert.equal(typeof api.uploadSeedreamEditorDrawing, "function", "MISSING_SEEDREAM_EDITOR_DRAWING_NATIVE_UPLOAD");
  for (expectedVariant of VARIANTS) {
    const bytes = Buffer.from(PNG), original = Buffer.from(bytes);
    const receipt = await api.uploadSeedreamEditorDrawing({ variant: expectedVariant, bytes, filename: "drawing.png", mime_type: "image/png" });
    assert.deepEqual(receipt, { file_id: `drawing-${calls}`, url: `https://r2.syntx.ai/drawing-${calls}.png` });
    assert.deepEqual(bytes, original, "caller-owned bytes remain intact");
  }
  assert.equal(calls, 5); assert.ok(forms.every((form) => form.get("files") === null));
});

test("drawing accepts an optional-echo receipt and rejects hostile fields before auth or POST", async () => {
  let credentials = 0, calls = 0;
  const counting: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    credentials += 1; return operation("synthetic-seedream-drawing-credential");
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: counting, fetchImpl: async () => {
    calls += 1; return new Response(JSON.stringify({ files: [{ url: "https://r2.syntx.ai/drawing.png" }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  } });
  const api = client as unknown as { uploadSeedreamEditorDrawing(input: unknown, signal?: AbortSignal): Promise<unknown> };
  assert.deepEqual(await api.uploadSeedreamEditorDrawing({ variant: "seedream-5", bytes: PNG, filename: "drawing.png", mime_type: "image/png" }),
    { url: "https://r2.syntx.ai/drawing.png" });
  const base = { variant: "seedream-5", bytes: PNG, filename: "drawing.png", mime_type: "image/png" };
  for (const request of [
    { ...base, variant: "banana" }, { ...base, destination: "uploaded" }, { ...base, model_type: "attacker" },
    { ...base, url: "https://attacker.invalid/drawing.png" }, { ...base, mime_type: "image/jpeg" },
    { ...base, extra: true }, { ...base, bytes: Buffer.from("not png") }
  ]) await assert.rejects(api.uploadSeedreamEditorDrawing(request));
  assert.equal(credentials, 1); assert.equal(calls, 1);
});

test("drawing upload strips unknown metadata and exposes only the normalized receipt", async () => {
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => new Response(JSON.stringify({
    request_id: "request-ignored",
    created_at: "2026-10-13T00:00:00Z",
    files: [{ id: "drawing-known-id", url: "https://r2.syntx.ai/drawing/known.png", mime_type: "image/png", size: PNG.byteLength,
      filename: "upstream-name.png", created_at: "2026-10-13T00:00:00Z", metadata: { trace: "must-not-leak" } }]
  }), { status: 200, headers: { "content-type": "application/json" } }) });
  const api = client as unknown as { uploadSeedreamEditorDrawing(input: unknown): Promise<unknown> };
  assert.deepEqual(await api.uploadSeedreamEditorDrawing({ variant: "seedream-5", bytes: PNG, filename: "drawing.png", mime_type: "image/png" }),
    { file_id: "drawing-known-id", url: "https://r2.syntx.ai/drawing/known.png" });
});

test("drawing checks optional receipt echoes and performs no automatic retry after abort/timeout", async () => {
  const receiptApi = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () =>
    new Response(JSON.stringify({ files: [{ url: "https://r2.syntx.ai/drawing.png", mime_type: "image/jpeg", size: PNG.byteLength }] }),
      { status: 200, headers: { "content-type": "application/json" } }) }) as unknown as { uploadSeedreamEditorDrawing(input: unknown): Promise<unknown> };
  await assert.rejects(receiptApi.uploadSeedreamEditorDrawing({ variant: "seedream-5", bytes: PNG, filename: "drawing.png", mime_type: "image/png" }));
  const wrongSizeApi = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () =>
    new Response(JSON.stringify({ files: [{ url: "https://r2.syntx.ai/drawing.png", size: PNG.byteLength + 1 }] }),
      { status: 200, headers: { "content-type": "application/json" } }) }) as unknown as { uploadSeedreamEditorDrawing(input: unknown): Promise<unknown> };
  await assert.rejects(wrongSizeApi.uploadSeedreamEditorDrawing({ variant: "seedream-5", bytes: PNG, filename: "drawing.png", mime_type: "image/png" }));
  const malformed = [
    { files: [] }, { files: [{ url: "https://r2.syntx.ai/a.png" }, { url: "https://r2.syntx.ai/b.png" }] },
    { files: [{ url: "https://attacker.invalid/a.png" }] },
    { files: [{ url: "https://r2.syntx.ai/conflict.png", id: "id-first", file_id: "id-conflict" }] },
    { files: [{ url: "https://r2.syntx.ai/error.png", status: "error" }] }
  ];
  let responseIndex = 0;
  const badReceipts = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => new Response(JSON.stringify(malformed[responseIndex++]),
    { status: 200, headers: { "content-type": "application/json" } }) }) as unknown as { uploadSeedreamEditorDrawing(input: unknown): Promise<unknown> };
  for (const _response of malformed) await assert.rejects(badReceipts.uploadSeedreamEditorDrawing({
    variant: "seedream-5", bytes: PNG, filename: "drawing.png", mime_type: "image/png"
  }));

  let abortedCalls = 0;
  const abortClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => {
    abortedCalls += 1; return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  } });
  const abortApi = abortClient as unknown as { uploadSeedreamEditorDrawing(input: unknown, signal?: AbortSignal): Promise<unknown> };
  const abort = new AbortController(); abort.abort();
  await assert.rejects(abortApi.uploadSeedreamEditorDrawing({ variant: "seedream-5", bytes: PNG, filename: "drawing.png", mime_type: "image/png" }, abort.signal));
  assert.equal(abortedCalls, 0);

  let timeoutCalls = 0;
  const timeoutClient = new SyntxChatHttpClient({ credentialBroker: broker, requestTimeoutMs: 10, fetchImpl: async () => {
    timeoutCalls += 1; await new Promise((resolve) => setTimeout(resolve, 35));
    return new Response(JSON.stringify({ files: [{ url: "https://r2.syntx.ai/late.png" }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  } });
  const timeoutApi = timeoutClient as unknown as { uploadSeedreamEditorDrawing(input: unknown, signal?: AbortSignal): Promise<unknown> };
  await assert.rejects(timeoutApi.uploadSeedreamEditorDrawing({ variant: "seedream-5", bytes: PNG, filename: "drawing.png", mime_type: "image/png" }));
  await new Promise((resolve) => setTimeout(resolve, 45)); assert.equal(timeoutCalls, 1);
});

test("drawing local 32 MiB bound is independent and does not accept caller wire controls", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => {
    calls += 1; return new Response(JSON.stringify({ files: [{ url: "https://r2.syntx.ai/drawing.png" }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  } });
  const api = client as unknown as { uploadSeedreamEditorDrawing(input: unknown): Promise<unknown> };
  await assert.rejects(api.uploadSeedreamEditorDrawing({ variant: "seedream-5.0-pro", bytes: new Uint8Array(32 * 1024 * 1024 + 1),
    filename: "large.png", mime_type: "image/png" }));
  assert.equal(calls, 0);
});
