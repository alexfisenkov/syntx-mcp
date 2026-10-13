import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const SAFE_REFERENCE_URL = "https://r2.syntx.ai/owned/reference-fixture.png";
const IMAGE_REQUEST = Object.freeze({
  ai_name: "banana",
  chat_uuid: "owned-image-chat",
  prompt: "Use the supplied image as a visual reference.",
  settings: Object.freeze({ model_type: "banana-2.1", aspect_ratio: "1:1", image_size: "1K", n: 1, thinking_level: "minimal", file_urls: [] })
});

function createClient(fetchImpl: typeof fetch) {
  let credentialCalls = 0;
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential(operation) {
      credentialCalls += 1;
      return operation("synthetic-http-test-credential");
    }
  };
  return { client: new SyntxChatHttpClient({ credentialBroker, fetchImpl }), credentialCalls: () => credentialCalls };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

test("internal image bridge sends one exact tagged reference through design/generate", async () => {
  const requests: Array<{ url: string; method: string; body: string | undefined; authorization: string | null }> = [];
  const harness = createClient(async (input, init) => {
    requests.push({
      url: String(input), method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      authorization: new Headers(init?.headers).get("authorization")
    });
    return json({ id: "reference-message-1" });
  });
  const receipt = await harness.client.startImageWithInternalReferences(IMAGE_REQUEST, [{ url: SAFE_REFERENCE_URL }]);
  assert.deepEqual(receipt, { chat_uuid: "owned-image-chat", message_id: "reference-message-1" });
  assert.equal(harness.credentialCalls(), 1);
  assert.equal(requests.length, 1);
  const request = requests[0]!;
  assert.equal(request.url, "https://api.syntx.ai/api/v1/design/generate?ai_name=banana");
  assert.equal(request.method, "POST");
  assert.equal(request.authorization, "Bearer synthetic-http-test-credential");
  const body = JSON.parse(request.body!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["chat_uuid", "prompt", "settings"]);
  assert.deepEqual(body.settings, {
    model_type: "banana-2.1", aspect_ratio: "1:1", image_size: "1K", n: 1, thinking_level: "minimal",
    file_urls: [{ type: "image", url: SAFE_REFERENCE_URL }]
  });
});

test("ordinary startImage still rejects caller reference URLs before credentials or fetch", async () => {
  let fetchCalls = 0;
  const harness = createClient(async () => { fetchCalls += 1; return json({ id: "unexpected" }); });
  await assert.rejects(() => harness.client.startImage({
    ...IMAGE_REQUEST,
    settings: { ...IMAGE_REQUEST.settings, file_urls: [{ type: "image", url: SAFE_REFERENCE_URL }] }
  }), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(harness.credentialCalls(), 0);
  assert.equal(fetchCalls, 0);
});

test("internal image bridge denies foreign URLs, caller references, and non-single cardinality before credential use", async () => {
  let fetchCalls = 0;
  const harness = createClient(async () => { fetchCalls += 1; return json({ id: "unexpected" }); });
  const invalidCases = [
    { request: IMAGE_REQUEST, references: [] },
    { request: IMAGE_REQUEST, references: [{ url: SAFE_REFERENCE_URL }, { url: SAFE_REFERENCE_URL }] },
    { request: IMAGE_REQUEST, references: [{ url: "https://evil.invalid/reference.png" }] },
    { request: { ...IMAGE_REQUEST, settings: { ...IMAGE_REQUEST.settings, file_urls: ["caller-url"] } }, references: [{ url: SAFE_REFERENCE_URL }] }
  ];
  for (const invalid of invalidCases) {
    await assert.rejects(() => harness.client.startImageWithInternalReferences(
      invalid.request as typeof IMAGE_REQUEST,
      invalid.references as never
    ), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(harness.credentialCalls(), 0);
  assert.equal(fetchCalls, 0);
});

test("aborted and failed transport attempts do not retry the generation POST", async () => {
  let fetchCalls = 0;
  const aborted = createClient(async () => { fetchCalls += 1; return json({ id: "unexpected" }); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => aborted.client.startImageWithInternalReferences(IMAGE_REQUEST, [{ url: SAFE_REFERENCE_URL }], controller.signal),
    (error: unknown) => error instanceof SyntxHttpError);
  assert.equal(aborted.credentialCalls(), 0);
  assert.equal(fetchCalls, 0);

  const failed = createClient(async () => { fetchCalls += 1; throw new Error("synthetic transport failure"); });
  await assert.rejects(() => failed.client.startImageWithInternalReferences(IMAGE_REQUEST, [{ url: SAFE_REFERENCE_URL }]));
  assert.equal(failed.credentialCalls(), 1);
  assert.equal(fetchCalls, 1);
});
