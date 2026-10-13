import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OWNER_STANDARD_IMAGE_VARIANTS, type OwnerStandardImageVariant } from "../src/application/owner-standard-image-request-preparer.js";

const HOST = "https://r2.syntx.ai/standard/";
const CREDENTIAL = "synthetic-standard-image-result-credential";

function context(variant: OwnerStandardImageVariant = "banana") {
  return {
    chat_uuid: "standard-private-chat-123", message_id: "standard-bot-message-42", variant,
    provider_chat_id: "412", message_object_ids: ["standard-image-object-17"]
  };
}

function envelope(input: ReturnType<typeof context>, objectUrl = `${HOST}result.png`) {
  return {
    id: input.message_id,
    chat_id: 412,
    author_id: -1,
    message_object: [{
      id: input.message_object_ids[0], message_id: input.message_id, object_type: "image",
      model_type: input.variant, completed: true, object_url: objectUrl
    }]
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function client(fetchImpl: typeof fetch, calls = { credentials: 0 }) {
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      calls.credentials += 1;
      return operation(CREDENTIAL);
    }
  };
  return { client: new SyntxChatHttpClient({ credentialBroker, fetchImpl }), calls };
}

test("standard result GET binds one exact image across all ten model IDs and exposes only safe metadata", async () => {
  for (const variant of OWNER_STANDARD_IMAGE_VARIANTS) {
    const request = context(variant);
    let fetchCalls = 0;
    const harness = client(async (input, init) => {
      fetchCalls += 1;
      assert.equal(String(input), `https://api.syntx.ai/api/v1/chats/${request.chat_uuid}/${request.message_id}`);
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.body, undefined);
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${CREDENTIAL}`);
      assert.equal(new Headers(init?.headers).get("content-type"), null);
      return json({ ...envelope(request), private_echo: "must-not-escape" });
    });
    const result = await harness.client.getStandardImageResult(request);
    assert.equal(result.status, "COMPLETE");
    if (result.status === "COMPLETE") {
      assert.equal(result.model_type, variant);
      assert.equal(result.artifact.message_object_id, request.message_object_ids[0]);
      assert.equal(result.artifact.mime_type, "image/png");
      assert.equal(result.artifact.mime_source, "URL_EXTENSION");
      assert.equal(result.artifact.width, null);
      assert.equal(result.artifact.height, null);
      assert.equal(result.artifact.geometry_verified, false);
    }
    assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
    assert.equal(fetchCalls, 1);
    assert.equal(harness.calls.credentials, 1);
  }
});

test("empty and incomplete results stay pending; unknown extension remains complete with UNKNOWN MIME", async () => {
  const request = context("banana-2.1");
  const cases = [
    [{ ...envelope(request), message_object: [] }, "PENDING", "NO_RESULT_OBJECTS"],
    [{ ...envelope(request), message_object: [{ ...envelope(request).message_object[0], completed: false }] }, "PENDING", "RESULT_NOT_COMPLETED"]
  ] as const;
  for (const [body, status, reason] of cases) {
    const harness = client(async () => json(body));
    const result = await harness.client.getStandardImageResult(request);
    assert.equal(result.status, status);
    if (result.status === "PENDING") assert.equal(result.reason, reason);
  }
  const harness = client(async () => json(envelope(request, `${HOST}result.tiff`)));
  const unknown = await harness.client.getStandardImageResult(request);
  assert.equal(unknown.status, "COMPLETE");
  if (unknown.status === "COMPLETE") assert.deepEqual([unknown.artifact.mime_type, unknown.artifact.mime_source], [null, "UNKNOWN"]);
});

test("wrong IDs, chat, author, object, model, URL, and cardinality stay unverified", async () => {
  const request = context("gpt-image-2.5-flare");
  const base = envelope(request);
  const invalidCases: Array<[unknown, string]> = [
    [{ ...base, id: "other-message" }, "OUTER_MESSAGE_MISMATCH"],
    [{ ...base, chat_id: 999 }, "PROVIDER_CHAT_MISMATCH"],
    [{ ...base, author_id: 5 }, "NOT_BOT_MESSAGE"],
    [{ ...base, message_object: [{ ...base.message_object[0], id: "other-object" }] }, "OBJECT_ID_MISMATCH"],
    [{ ...base, message_object: [{ ...base.message_object[0], message_id: "other-message" }] }, "OBJECT_MESSAGE_MISMATCH"],
    [{ ...base, message_object: [{ ...base.message_object[0], object_type: "video" }] }, "OBJECT_TYPE_MISMATCH"],
    [{ ...base, message_object: [{ ...base.message_object[0], model_type: undefined }] }, "MODEL_TYPE_UNAVAILABLE"],
    [{ ...base, message_object: [{ ...base.message_object[0], model_type: "gpt-image-2" }] }, "MODEL_TYPE_MISMATCH"],
    [{ ...base, message_object: [base.message_object[0], { ...base.message_object[0], id: "second-object" }] }, "RESULT_OBJECT_CARDINALITY_INVALID"],
    [{ ...base, message_object: [{ ...base.message_object[0], object_url: "https://evil.invalid/file.png" }] }, "RESULT_URL_UNSAFE"]
  ];
  for (const [body, reason] of invalidCases) {
    const harness = client(async () => json(body));
    const result = await harness.client.getStandardImageResult(request);
    assert.equal(result.status, "UNVERIFIED");
    if (result.status === "UNVERIFIED") assert.equal(result.reason, reason);
    assert.equal(JSON.stringify(result).includes("evil.invalid"), false);
  }
});

test("result context rejects aliases, numeric IDs, extra fields, sparse arrays, accessors and proxies before GET", async () => {
  let fetchCalls = 0;
  const harness = client(async () => { fetchCalls += 1; return json(envelope(context())); });
  const numericId = { ...context(), message_id: 42 };
  const alias = { ...context(), variant: "banana-alias" };
  const extra = { ...context(), file_urls: [] };
  const sparse = { ...context(), message_object_ids: Array(1) };
  const accessor = { ...context() };
  Object.defineProperty(accessor, "variant", { enumerable: true, get() { throw new Error("must not execute"); } });
  const proxy = new Proxy(context(), { getPrototypeOf() { throw new Error("proxy trap"); } });
  for (const invalid of [numericId, alias, extra, sparse, accessor, proxy]) {
    await assert.rejects(() => harness.client.getStandardImageResult(invalid),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(fetchCalls, 0);
  assert.equal(harness.calls.credentials, 0);
});

test("abort and timeout use one GET at most and do not replay", async () => {
  const request = context();
  let abortFetches = 0;
  const abortHarness = client(async () => { abortFetches += 1; return json(envelope(request)); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => abortHarness.client.getStandardImageResult(request, controller.signal),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(abortFetches, 0);
  assert.equal(abortHarness.calls.credentials, 0);

  let timeoutFetches = 0;
  const timeoutBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation(CREDENTIAL);
    }
  };
  const timeoutClient = new SyntxChatHttpClient({
    credentialBroker: timeoutBroker,
    requestTimeoutMs: 5,
    fetchImpl: async () => { timeoutFetches += 1; return new Promise<Response>(() => undefined); }
  });
  await assert.rejects(() => timeoutClient.getStandardImageResult(request),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT");
  assert.equal(timeoutFetches, 1);
});
