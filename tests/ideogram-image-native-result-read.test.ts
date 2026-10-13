import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const CREDENTIAL = "synthetic-ideogram-result-credential";
const CHAT = "ideogram-private-chat-7";
type IdeogramRead = (context: unknown, signal?: AbortSignal) => Promise<unknown>;
function context(model_id: string, mode: string, output_count: number, mask = false) {
  return { chat_uuid: CHAT, message_id: "ideogram-bot-result", model_id, mode, requested_mask_present: mask,
    provider_chat_id: "70001", message_object_ids: Array.from({ length: output_count }, (_, index) => `ideogram-object-${index + 1}`), output_count };
}
function envelope(input: ReturnType<typeof context>, ids = input.message_object_ids) {
  return { id: input.message_id, chat_id: 70001, author_id: -1,
    message_object: ids.map((id) => ({ id, message_id: input.message_id, object_type: "image", model_type: input.model_id,
      completed: true, object_url: `https://r2.syntx.ai/ideogram/${id}.png` })) };
}
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
function clientWith(fetchImpl: typeof fetch, counts = { credential: 0, fetch: 0 }) {
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    counts.credential += 1;
    return operation(CREDENTIAL);
  } };
  const wrappedFetch: typeof fetch = async (input, init) => { counts.fetch += 1; return fetchImpl(input, init); };
  return { client: new SyntxChatHttpClient({ credentialBroker, fetchImpl: wrappedFetch }), counts };
}
function read(client: SyntxChatHttpClient, input: unknown, signal?: AbortSignal): Promise<unknown> {
  return (client as unknown as { getIdeogramImageResult: IdeogramRead }).getIdeogramImageResult(input, signal);
}

test("native Ideogram result GET binds exact ordered batch IDs for counts 1, 2, and 8", async () => {
  for (const count of [1, 2, 8] as const) {
    const request = context("ideogram_45", "generate", count);
    const counts = { credential: 0, fetch: 0 };
    const { client } = clientWith(async (input, init) => {
      assert.equal(String(input), `https://api.syntx.ai/api/v1/chats/${CHAT}/${request.message_id}`);
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.body, undefined);
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${CREDENTIAL}`);
      return json({ ...envelope(request), private_field: "must-not-escape" });
    }, counts);
    const result = await read(client, request) as { status: string; artifacts?: readonly { message_object_id: string; geometry_verified: boolean }[]; mode_confidence?: string };
    assert.equal(result.status, "COMPLETE");
    assert.deepEqual(result.artifacts?.map((artifact) => artifact.message_object_id), request.message_object_ids);
    assert.equal(result.artifacts?.every((artifact) => artifact.geometry_verified === false), true);
    assert.equal(result.mode_confidence, "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO");
    assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
    assert.deepEqual(counts, { credential: 1, fetch: 1 });
  }
});

test("native result GET preserves partial outputs and exact private mode/mask context", async () => {
  const partialContext = context("ideogram_40", "transparent", 2);
  const partial = clientWith(async () => json(envelope(partialContext, ["ideogram-object-1"]))).client;
  const partialResult = await read(partial, partialContext) as { status: string; reason?: string; artifacts?: readonly unknown[] };
  assert.equal(partialResult.status, "PARTIAL");
  assert.equal(partialResult.reason, "OUTPUT_BATCH_PARTIAL");
  assert.equal(partialResult.artifacts?.length, 1);

  const maskContext = context("ideogram_45", "precise_edit", 1, true);
  const maskedMode = clientWith(async () => json(envelope(maskContext))).client;
  const maskedResult = await read(maskedMode, maskContext) as { status: string; mode: string; requested_mask_present: boolean };
  assert.equal(maskedResult.status, "COMPLETE");
  assert.equal(maskedResult.mode, "precise_edit");
  assert.equal(maskedResult.requested_mask_present, true);
});

test("native result GET rejects wrong message/chat/model/object IDs, order, and unsafe URLs", async () => {
  const request = context("ideogram", "remix", 2);
  const base = envelope(request);
  const cases: Array<[unknown, string]> = [
    [{ ...base, id: "different-message" }, "OUTER_MESSAGE_MISMATCH"],
    [{ ...base, chat_id: 9 }, "PROVIDER_CHAT_MISMATCH"],
    [{ ...base, message_object: base.message_object.map((item) => ({ ...item, model_type: "ideogram_40" })) }, "MODEL_TYPE_MISMATCH"],
    [{ ...base, message_object: base.message_object.map((item, index) => index === 0 ? { ...item, id: "unbound-object" } : item) }, "OBJECT_ID_MISMATCH"],
    [{ ...base, message_object: [...base.message_object].reverse() }, "OBJECT_ID_MISMATCH"],
    [{ ...base, message_object: base.message_object.map((item) => ({ ...item, object_url: "https://attacker.invalid/out.png" })) }, "RESULT_URL_UNSAFE"]
  ];
  for (const [response, reason] of cases) {
    const { client, counts } = clientWith(async () => json(response));
    const result = await read(client, request) as { status: string; reason?: string };
    assert.equal(result.status, "UNVERIFIED");
    assert.equal(result.reason, reason);
    assert.deepEqual(counts, { credential: 1, fetch: 1 });
  }
});

test("invalid/accessor contexts fail before credentials or fetch, and GET errors are bounded and abortable", async () => {
  const counts = { credential: 0, fetch: 0 };
  const { client } = clientWith(async () => json({}), counts);
  const valid = context("ideogram", "generate", 1);
  let getterCalls = 0;
  const accessor = { ...valid };
  Object.defineProperty(accessor, "message_id", { enumerable: true, get() { getterCalls += 1; return valid.message_id; } });
  await assert.rejects(read(client, { ...valid, surprise: true }), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  await assert.rejects(read(client, accessor), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(getterCalls, 0);
  assert.deepEqual(counts, { credential: 0, fetch: 0 });

  const secret = "synthetic-private-provider-error-marker";
  const failing = clientWith(async () => { throw new Error(secret); });
  await assert.rejects(read(failing.client, valid), (error: unknown) => error instanceof SyntxHttpError &&
    error.code === "UPSTREAM_UNAVAILABLE" && !(error as Error).message.includes(secret));

  let fetchCalls = 0;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const aborting = clientWith(async (_input, init) => {
    fetchCalls += 1;
    started();
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("synthetic abort")), { once: true }));
  }).client;
  const controller = new AbortController();
  const pending = read(aborting, valid, controller.signal);
  await startedPromise;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(fetchCalls, 1);
});
