import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

type Variant = "flux-kontext-pro" | "flux-kontext-max" | "flux-kontext-multi";
const CREDENTIAL = "synthetic-kontext-result-credential";

function context(variant: Variant) {
  return {
    chat_uuid: "kontext-private-chat-123",
    message_id: "kontext-bot-message-42",
    variant,
    provider_chat_id: "412",
    message_object_id: "kontext-image-object-17"
  };
}

function completeEnvelope(input: ReturnType<typeof context>) {
  return {
    id: input.message_id,
    chat_id: 412,
    author_id: -1,
    message_object: [{
      id: input.message_object_id,
      message_id: input.message_id,
      object_type: "image",
      model_type: input.variant,
      completed: true,
      object_url: `https://r2.syntx.ai/kontext/result-${input.variant}.png`
    }]
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function clientWith(fetchImpl: typeof fetch, credentialCalls = { count: 0 }) {
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls.count += 1;
      return operation(CREDENTIAL);
    }
  };
  return new SyntxChatHttpClient({ credentialBroker, fetchImpl });
}

test("Kontext result GET binds exact variant and all verified message identifiers", async () => {
  for (const variant of ["flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"] as const) {
    const request = context(variant);
    let fetchCalls = 0;
    const client = clientWith(async (input, init) => {
      fetchCalls += 1;
      assert.equal(String(input), `https://api.syntx.ai/api/v1/chats/${request.chat_uuid}/${request.message_id}`);
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.body, undefined);
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${CREDENTIAL}`);
      assert.equal(new Headers(init?.headers).get("content-type"), null);
      return jsonResponse({ ...completeEnvelope(request), extra_private: "must-not-escape" });
    });
    const result = await client.getKontextImageResult(request);
    assert.deepEqual(result, {
      status: "COMPLETE",
      chat_uuid: request.chat_uuid,
      message_id: request.message_id,
      variant,
      provider_chat_id: request.provider_chat_id,
      message_object_id: request.message_object_id,
      model_type: variant,
      completed: true,
      artifact: {
        url: `https://r2.syntx.ai/kontext/result-${variant}.png`,
        mime_type: "image/png",
        mime_source: "URL_EXTENSION"
      }
    });
    assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
    assert.equal(fetchCalls, 1);
  }
});

test("empty object lists and exact non-completion are pending, while sibling variants stay unverified", async () => {
  const request = context("flux-kontext-pro");
  const envelopes: Array<[unknown, string, string?, boolean?]> = [
    [{ ...completeEnvelope(request), message_object: [] }, "PENDING", "NO_RESULT_OBJECTS"],
    [{ ...completeEnvelope(request), message_object: [{ ...completeEnvelope(request).message_object[0], completed: false }] }, "PENDING", "RESULT_NOT_COMPLETED"],
    [{ ...completeEnvelope(request), message_object: [{ ...completeEnvelope(request).message_object[0], model_type: "flux-kontext-max" }] }, "UNVERIFIED", "MODEL_TYPE_MISMATCH", true],
    [{ ...completeEnvelope(request), message_object: [{ ...completeEnvelope(request).message_object[0], model_type: "flux-dev" }] }, "UNVERIFIED", "MODEL_TYPE_MISMATCH", false],
    [{ ...completeEnvelope(request), message_object: [{ ...completeEnvelope(request).message_object[0], model_type: undefined }] }, "UNVERIFIED", "MODEL_TYPE_UNAVAILABLE"]
  ];
  for (const [envelope, status, reason, expectedFamily] of envelopes) {
    let fetchCalls = 0;
    const client = clientWith(async () => { fetchCalls += 1; return jsonResponse(envelope); });
    const result = await client.getKontextImageResult(request);
    assert.equal(result.status, status);
    if (result.status !== "COMPLETE" && reason !== undefined) assert.equal(result.reason, reason);
    if (result.status === "UNVERIFIED" && reason === "MODEL_TYPE_MISMATCH") {
      assert.equal(result.model_eq_requested, false);
      assert.equal(result.model_eq_family, expectedFamily);
      assert.equal(JSON.stringify(result).includes("flux-dev"), false);
      assert.equal(JSON.stringify(result).includes("flux-kontext-max"), false);
    }
    assert.equal(fetchCalls, 1);
  }
});

test("Kontext result rejects wrong author/chat/message/object/type and multiple objects without raw echo", async () => {
  const request = context("flux-kontext-multi");
  const item = completeEnvelope(request).message_object[0];
  const cases: Array<[unknown, string]> = [
    [{ ...completeEnvelope(request), id: "different-message" }, "OUTER_MESSAGE_MISMATCH"],
    [{ ...completeEnvelope(request), chat_id: 999 }, "PROVIDER_CHAT_MISMATCH"],
    [{ ...completeEnvelope(request), author_id: 1001 }, "NOT_BOT_MESSAGE"],
    [{ ...completeEnvelope(request), message_object: [{ ...item, id: "different-object" }] }, "OBJECT_ID_MISMATCH"],
    [{ ...completeEnvelope(request), message_object: [{ ...item, message_id: "different-message" }] }, "OBJECT_MESSAGE_MISMATCH"],
    [{ ...completeEnvelope(request), message_object: [{ ...item, object_type: "video" }] }, "OBJECT_TYPE_MISMATCH"],
    [{ ...completeEnvelope(request), message_object: [item, { ...item, id: "second-object" }] }, "RESULT_OBJECT_CARDINALITY_INVALID"],
    [{ id: request.message_id, chat_id: 412, author_id: -1, message_object: "bad" }, "RESPONSE_SHAPE_INVALID"]
  ];
  for (const [envelope, reason] of cases) {
    let fetchCalls = 0;
    const result = await clientWith(async () => { fetchCalls += 1; return jsonResponse(envelope); }).getKontextImageResult(request);
    assert.equal(result.status, "UNVERIFIED");
    assert.equal(result.reason, reason);
    assert.equal(JSON.stringify(result).includes("different-object"), false);
    assert.equal(fetchCalls, 1);
  }
});

test("unsafe URLs, unknown extensions, and non-image extensions never become image results", async () => {
  const request = context("flux-kontext-max");
  const item = completeEnvelope(request).message_object[0];
  const cases: Array<[string, string]> = [
    ["https://example.invalid/result.png", "RESULT_URL_UNSAFE"],
    ["https://r2.syntx.ai/kontext/result.unknown", "RESULT_MIME_UNKNOWN"],
    ["https://r2.syntx.ai/kontext/result.mp4", "RESULT_MIME_UNKNOWN"]
  ];
  for (const [object_url, reason] of cases) {
    const result = await clientWith(async () => jsonResponse({
      ...completeEnvelope(request), message_object: [{ ...item, object_url }]
    })).getKontextImageResult(request);
    assert.equal(result.status, "UNVERIFIED");
    assert.equal(result.reason, reason);
  }
});

test("invalid, accessor-backed, or proxied contexts are rejected before credential and GET", async () => {
  const credentialCalls = { count: 0 };
  let fetchCalls = 0;
  let getterCalls = 0;
  const base = context("flux-kontext-pro");
  const accessor = { ...base };
  Object.defineProperty(accessor, "message_object_id", {
    enumerable: true, get() { getterCalls += 1; return base.message_object_id; }
  });
  const customPrototype = Object.assign(Object.create({ private: true }), base);
  const withSymbol = { ...base, [Symbol("private")]: "hidden" };
  const client = clientWith(async () => { fetchCalls += 1; return jsonResponse({}); }, credentialCalls);
  for (const input of [
    { ...base, extra: true },
    { ...base, variant: "flux-kontext" },
    { ...base, provider_chat_id: "not-numeric" },
    customPrototype,
    withSymbol,
    accessor,
    new Proxy(base, {})
  ]) {
    await assert.rejects(client.getKontextImageResult(input as never));
  }
  assert.equal(getterCalls, 0);
  assert.equal(credentialCalls.count, 0);
  assert.equal(fetchCalls, 0);
});

test("Kontext result GET aborts and times out after one native request without retry", async () => {
  let fetchCalls = 0;
  let signalSeen: AbortSignal | undefined;
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
  const abortingClient = clientWith(async (_input, init) => {
    fetchCalls += 1;
    signalSeen = init?.signal ?? undefined;
    markFetchStarted();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("synthetic abort")), { once: true });
    });
  });
  const controller = new AbortController();
  const pending = abortingClient.getKontextImageResult(context("flux-kontext-pro"), controller.signal);
  await fetchStarted;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(signalSeen?.aborted, true);
  assert.equal(fetchCalls, 1);

  let timeoutFetchCalls = 0;
  const timeoutClient = new SyntxChatHttpClient({
    credentialBroker: {
      async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); }
    },
    requestTimeoutMs: 5,
    fetchImpl: async () => { timeoutFetchCalls += 1; return new Promise<Response>(() => undefined); }
  });
  await assert.rejects(timeoutClient.getKontextImageResult(context("flux-kontext-max")),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT");
  assert.equal(timeoutFetchCalls, 1);
});
