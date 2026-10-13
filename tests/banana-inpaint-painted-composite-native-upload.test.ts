import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const SECRET = "synthetic-banana-painted-upload-secret";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const VARIANTS = ["banana", "banana2", "banana3", "banana3_light"] as const;

function broker(onUse: () => void = () => undefined): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { onUse(); return operation(SECRET); } };
}
function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
function upload(client: SyntxChatHttpClient, request: unknown, signal?: AbortSignal) {
  const method = (client as unknown as { uploadBananaInpaintPaintedComposite?: (request: unknown, signal?: AbortSignal) => Promise<{ readonly url: string }> }).uploadBananaInpaintPaintedComposite;
  assert.equal(typeof method, "function", "fixed Banana painted-composite upload method must exist");
  return method!.call(client, request, signal);
}

test("native upload uses one fixed hidden multipart request for all four variants", async () => {
  let expectedVariant: typeof VARIANTS[number] = VARIANTS[0];
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST");
      const form = init?.body as FormData;
      assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("destination"), "hidden"); assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), expectedVariant);
      const file = form.get("files");
      assert.ok(file instanceof File); assert.equal(file.name, "painted.png"); assert.equal(file.type, "image/png");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
      return jsonResponse({ files: [{ url: `https://r2.syntx.ai/painted/${calls}.png`, mime_type: "image/png", size: PNG.byteLength }] });
    }
  });
  for (expectedVariant of VARIANTS) {
    const receipt = await upload(client, { variant: expectedVariant, bytes: PNG, filename: "painted.png", mime_type: "image/png" });
    assert.deepEqual(receipt, { url: `https://r2.syntx.ai/painted/${calls}.png` });
  }
  assert.equal(calls, 4);
});

test("native painted upload rejects extra fields and invalid MIME before credential or fetch", async () => {
  let credentials = 0, requests = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentials += 1; }),
    fetchImpl: async () => { requests += 1; return jsonResponse({ files: [{ url: "https://r2.syntx.ai/no.png" }] }); } });
  for (const request of [
    { variant: "banana", bytes: PNG, filename: "painted.png", mime_type: "image/png", destination: "uploaded" },
    { variant: "banana-2.1", bytes: PNG, filename: "painted.png", mime_type: "image/png" },
    { variant: "banana", bytes: PNG, filename: "painted.png", mime_type: "image/jpeg" }
  ]) await assert.rejects(upload(client, request), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentials, 0); assert.equal(requests, 0);
});

test("pre-aborted native painted upload does not send or look up credentials", async () => {
  let credentials = 0, requests = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentials += 1; }),
    fetchImpl: async () => { requests += 1; return jsonResponse({ files: [{ url: "https://r2.syntx.ai/no.png" }] }); } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(upload(client, { variant: "banana3", bytes: PNG, filename: "painted.png", mime_type: "image/png" }, controller.signal),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(credentials, 0); assert.equal(requests, 0);
});

test("native painted receipt uses its dedicated local response-size guard and is never retried", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    calls += 1;
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/painted.png", mime_type: "image/png", size: 50 * 1024 * 1024 + 1 }] });
  } });
  await assert.rejects(upload(client, { variant: "banana3", bytes: PNG, filename: "painted.png", mime_type: "image/png" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  assert.equal(calls, 1);
});

test("late native painted upload ACK after abort is canceled and multipart bytes are released", async () => {
  let calls = 0, canceled = 0, form: FormData | undefined;
  let start!: () => void;
  let resolveLate!: (response: Response) => void;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const lateResponse = new Promise<Response>((resolve) => { resolveLate = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    calls += 1; form = init?.body as FormData; start(); return lateResponse;
  } });
  const controller = new AbortController();
  const pending = upload(client, { variant: "banana", bytes: PNG, filename: "painted.png", mime_type: "image/png" }, controller.signal);
  await started;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  resolveLate(new Response(new ReadableStream<Uint8Array>({ start() {}, cancel() { canceled += 1; } }), { status: 200 }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(canceled, 1); assert.equal(form?.has("files"), false);
});
