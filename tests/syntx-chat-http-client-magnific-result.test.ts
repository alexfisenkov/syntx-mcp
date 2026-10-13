import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

type Variant = "creative" | "precision_v1" | "precision_v2";
const CREDENTIAL = "synthetic-magnific-result-credential";

function context(variant: Variant = "creative", overrides: Record<string, unknown> = {}) {
  return {
    chat_uuid: "magnific-private-chat-123",
    message_id: "magnific-bot-message-42",
    variant,
    provider_chat_id: "412",
    message_object_id: "magnific-image-object-17",
    ...overrides
  };
}

function completeEnvelope(input: ReturnType<typeof context>, overrides: Record<string, unknown> = {}) {
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
      object_url: "https://r2.syntx.ai/magnific/result-creative.png"
    }],
    ...overrides
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers).entries()) }
  });
}

function clientWith(fetchImpl: typeof fetch, credentialCalls = { calls: 0 }) {
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls.calls += 1;
      return operation(CREDENTIAL);
    }
  };
  return new SyntxChatHttpClient({ credentialBroker, fetchImpl });
}

test("Magnific result GET binds exact requested variant and all verified history identifiers", async () => {
  for (const variant of ["creative", "precision_v1", "precision_v2"] as const) {
    const request = context(variant);
    const body = completeEnvelope(request, {
      private_prompt: "do not project",
      message_object: [{
        ...completeEnvelope(request).message_object[0],
        metadata: { task_id: "do-not-project" },
        private_echo: "do-not-project"
      }]
    });
    let fetchCalls = 0;
    const client = clientWith(async (input, init) => {
      fetchCalls += 1;
      assert.equal(String(input), `https://api.syntx.ai/api/v1/chats/${request.chat_uuid}/${request.message_id}`);
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.body, undefined);
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${CREDENTIAL}`);
      assert.equal(new Headers(init?.headers).get("content-type"), null);
      return jsonResponse(body);
    });

    const result = await client.getMagnificUpscaleResult(request);
    assert.deepEqual(result, {
      status: "COMPLETE",
      chat_uuid: request.chat_uuid,
      message_id: request.message_id,
      message_object_id: request.message_object_id,
      provider_chat_id: request.provider_chat_id,
      variant,
      model_type: variant,
      completed: true,
      artifact: {
        url: "https://r2.syntx.ai/magnific/result-creative.png",
        mime_type: "image/png",
        mime_source: "URL_EXTENSION"
      }
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("private_prompt"), false);
    assert.equal(serialized.includes("task_id"), false);
    assert.equal(serialized.includes("do-not-project"), false);
    assert.equal(fetchCalls, 1);
  }
});

test("unexpected sibling model types remain unverified and expose only safe equality flags", async () => {
  const cases = [
    { requested: "creative", actual: "precision_v1", family: true },
    { requested: "precision_v2", actual: "magnific_upscale", family: false }
  ] as const;
  for (const item of cases) {
    const request = context(item.requested);
    let fetchCalls = 0;
    const client = clientWith(async () => {
      fetchCalls += 1;
      return jsonResponse(completeEnvelope(request, {
        message_object: [{ ...completeEnvelope(request).message_object[0], model_type: item.actual }]
      }));
    });
    const result = await client.getMagnificUpscaleResult(request);
    assert.equal(result.status, "UNVERIFIED");
    assert.equal(result.reason, "MODEL_TYPE_MISMATCH");
    assert.equal(result.model_eq_requested, false);
    assert.equal(result.model_eq_family, item.family);
    assert.equal(JSON.stringify(result).includes(item.actual), false);
    assert.equal(fetchCalls, 1);
  }
});

test("Magnific result rejects cross-chat, cross-message, wrong-author, wrong-object, plural and non-image bindings", async () => {
  const request = context("precision_v1");
  const badEnvelopes: Array<[unknown, string]> = [
    [completeEnvelope(request, { id: "other-message" }), "OUTER_MESSAGE_MISMATCH"],
    [completeEnvelope(request, { chat_id: 413 }), "PROVIDER_CHAT_MISMATCH"],
    [completeEnvelope(request, { author_id: 7001 }), "NOT_BOT_MESSAGE"],
    [completeEnvelope(request, { author_id: 0 }), "NOT_BOT_MESSAGE"],
    [completeEnvelope(request, { message_object: [{ ...completeEnvelope(request).message_object[0], id: "other-object" }] }), "OBJECT_ID_MISMATCH"],
    [completeEnvelope(request, { message_object: [{ ...completeEnvelope(request).message_object[0], message_id: "other-message" }] }), "OBJECT_MESSAGE_MISMATCH"],
    [completeEnvelope(request, { message_object: [{ ...completeEnvelope(request).message_object[0], object_type: "video" }] }), "OBJECT_TYPE_MISMATCH"],
    [completeEnvelope(request, { message_object: [
      completeEnvelope(request).message_object[0], { ...completeEnvelope(request).message_object[0], id: "second-object" }
    ] }), "RESULT_OBJECT_CARDINALITY_INVALID"]
  ];

  for (const [envelope, reason] of badEnvelopes) {
    let fetchCalls = 0;
    const client = clientWith(async () => { fetchCalls += 1; return jsonResponse(envelope); });
    const result = await client.getMagnificUpscaleResult(request);
    assert.equal(result.status, "UNVERIFIED");
    assert.equal(result.reason, reason);
    assert.equal(fetchCalls, 1);
  }
});

test("zero objects and incomplete image object are pending, not unverified or complete", async () => {
  const request = context("creative");
  const pendingEnvelopes = [
    { ...completeEnvelope(request), message_object: [] },
    { ...completeEnvelope(request), message_object: [{ ...completeEnvelope(request).message_object[0], completed: false }] }
  ];
  for (const [index, envelope] of pendingEnvelopes.entries()) {
    let fetchCalls = 0;
    const client = clientWith(async () => { fetchCalls += 1; return jsonResponse(envelope); });
    const result = await client.getMagnificUpscaleResult(request);
    assert.equal(result.status, "PENDING");
    assert.equal(result.reason, index === 0 ? "NO_RESULT_OBJECTS" : "RESULT_NOT_COMPLETED");
    assert.equal(fetchCalls, 1);
  }
});

test("unsafe artifact URL, unknown MIME extension and malformed response shape stay unverified", async () => {
  const request = context("precision_v1");
  const envelopes: Array<[unknown, string]> = [
    [completeEnvelope(request, { message_object: [{ ...completeEnvelope(request).message_object[0], object_url: "https://example.invalid/result.png" }] }), "RESULT_URL_UNSAFE"],
    [completeEnvelope(request, { message_object: [{ ...completeEnvelope(request).message_object[0], object_url: "https://r2.syntx.ai/magnific/result.unknown" }] }), "RESULT_MIME_UNKNOWN"],
    [{ id: request.message_id, chat_id: 412, author_id: -1, message_object: "not-an-array" }, "RESPONSE_SHAPE_INVALID"]
  ];
  for (const [envelope, reason] of envelopes) {
    let fetchCalls = 0;
    const client = clientWith(async () => { fetchCalls += 1; return jsonResponse(envelope); });
    const result = await client.getMagnificUpscaleResult(request);
    assert.equal(result.status, "UNVERIFIED");
    assert.equal(result.reason, reason);
    assert.equal(fetchCalls, 1);
  }
});

test("invalid result context is rejected before credential or fetch", async () => {
  const credentialCalls = { calls: 0 };
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: {
      async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
        credentialCalls.calls += 1;
        return operation(CREDENTIAL);
      }
    },
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); }
  });
  let getterCalls = 0;
  const accessor = { ...context("creative") };
  Object.defineProperty(accessor, "message_object_id", { enumerable: true, get() { getterCalls += 1; return "object"; } });
  const customPrototype = Object.assign(Object.create({ private: true }), context("creative"));
  const withSymbol = { ...context("creative"), [Symbol("private")]: "secret" };
  for (const input of [
    { ...context("creative"), extra: true },
    { ...context("creative"), variant: "magnific" },
    customPrototype,
    withSymbol,
    accessor,
    new Proxy(context("creative"), {})
  ]) {
    await assert.rejects(client.getMagnificUpscaleResult(input as never),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(getterCalls, 0);
  assert.equal(credentialCalls.calls, 0);
  assert.equal(fetchCalls, 0);
});

test("Magnific result GET aborts or times out once without retry", async () => {
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
  const pending = abortingClient.getMagnificUpscaleResult(context("creative"), controller.signal);
  await fetchStarted;
  controller.abort();
  await assert.rejects(pending, (error: unknown) =>
    error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(signalSeen?.aborted, true);
  assert.equal(fetchCalls, 1);

  let timeoutFetchCalls = 0;
  const timeoutClient = new SyntxChatHttpClient({
    credentialBroker: {
      async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
        return operation(CREDENTIAL);
      }
    },
    requestTimeoutMs: 5,
    fetchImpl: async () => {
      timeoutFetchCalls += 1;
      return new Promise<Response>(() => undefined);
    }
  });
  await assert.rejects(timeoutClient.getMagnificUpscaleResult(context("precision_v1")), (error: unknown) =>
    error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT");
  assert.equal(timeoutFetchCalls, 1);
});
