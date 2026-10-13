import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const HISTORY_URL = new URL("../src/application/owner-soul-image-history-binding.js", import.meta.url).href;
const RESULT_URL = new URL("../src/adapter/syntx/owner-soul-image-result.js", import.meta.url).href;
const MODEL_ID = "higgsfield-soul";
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const PROFILE_BINDING = Object.freeze({ profile_id: "owner-soul-image-source-profile-v1", model_id: MODEL_ID,
  catalog_version: CATALOG_VERSION, profile_schema_hash: `sha256:${"a".repeat(64)}`,
  request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}` });

interface ReadContext {
  readonly chat_uuid: string;
  readonly provider_chat_id: string;
  readonly owner_echo_message_id: string;
  readonly message_id: string;
  readonly model_id: string;
  readonly requested_batch_size: 1 | 4;
  readonly message_object_ids: readonly string[];
  readonly profile_id: string;
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
}

function historySnapshot(resultObjects: readonly Record<string, unknown>[], extraRows: readonly Record<string, unknown>[] = []) {
  return {
    complete: true, page: 1, page_size: 10, total_count: 2 + extraRows.length, total_pages: 1,
    has_next: false, has_previous: false, requested_chat_uuid: "soul-chat-1", provider_chat_id: "771",
    messages: [
      { message_id: "owner-ack-1", provider_chat_id: "771", author_role: "owner", objects: [] },
      { message_id: "soul-result-1", provider_chat_id: "771", author_role: "bot", objects: resultObjects }
    , ...extraRows]
  };
}

function historyObject(id: string | number, modelType = MODEL_ID, objectType = "image") {
  return { message_object_id: id, model_type: modelType, object_type: objectType };
}

function readContext(requestedBatchSize: 1 | 4, ids: readonly string[]): ReadContext {
  return Object.freeze({ chat_uuid: "soul-chat-1", provider_chat_id: "771", owner_echo_message_id: "owner-ack-1",
    message_id: "soul-result-1", requested_batch_size: requestedBatchSize,
    message_object_ids: ids, ...PROFILE_BINDING });
}

function resultObject(id: unknown, messageId: unknown, options: {
  completed?: boolean; objectUrl?: string | null; hasUrl?: boolean; modelType?: string; objectType?: string;
} = {}) {
  const value: Record<string, unknown> = { id, message_id: messageId, object_type: options.objectType ?? "image",
    model_type: options.modelType ?? MODEL_ID, completed: options.completed ?? true };
  if (options.hasUrl !== false) value.object_url = options.objectUrl === undefined ? "https://r2.syntx.ai/result.png" : options.objectUrl;
  return value;
}

function rawResult(objects: readonly Record<string, unknown>[], tweaks: Record<string, unknown> = {}) {
  return { id: "soul-result-1", chat_id: 771, author_id: -1, message_object: objects, ...tweaks };
}

async function loadHistoryApi() {
  return await import(HISTORY_URL) as Record<string, unknown>;
}
async function loadResultApi() {
  return await import(RESULT_URL) as Record<string, unknown>;
}

test("Soul batch history/result APIs exist before the client exposes their one fixed GET", async () => {
  let history: Record<string, unknown> | undefined;
  let result: Record<string, unknown> | undefined;
  try { history = await loadHistoryApi(); } catch { /* expected initial RED before the bounded Soul binder exists */ }
  try { result = await loadResultApi(); } catch { /* expected initial RED before the requested-count decoder exists */ }
  assert.equal(typeof history?.correlateOwnerSoulImageHistoryBinding, "function", "MISSING_SOUL_BATCH_HISTORY_BINDER");
  assert.equal(typeof result?.decodeOwnerSoulImageResult, "function", "MISSING_SOUL_BATCH_RESULT_DECODER");
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-soul-result-credential");
  } }, fetchImpl: async () => Response.json({}) });
  assert.equal(typeof (client as unknown as Record<string, unknown>).getSoulImageBatchResult, "function",
    "MISSING_SOUL_BATCH_GET_METHOD");
});

test("Soul history binding requires the exact owner ACK then the unique current bot row and retains partial IDs", async () => {
  const api = await loadHistoryApi() as unknown as { correlateOwnerSoulImageHistoryBinding(input: unknown): any };
  for (const batch of [1, 4] as const) {
    const resultObjects = Array.from({ length: batch }, (_, index) => historyObject(`soul-object-${index + 1}`));
    const bound = api.correlateOwnerSoulImageHistoryBinding({ snapshot: historySnapshot(resultObjects),
      requested_chat_uuid: "soul-chat-1", owner_echo_message_id: "owner-ack-1", requested_batch_size: batch,
      profile_binding: PROFILE_BINDING });
    assert.equal(bound.status, "READY");
    assert.equal(bound.read_context.requested_batch_size, batch);
    assert.deepEqual(bound.read_context.message_object_ids, resultObjects.map((item) => item.message_object_id));
    assert.equal(bound.read_context.profile_schema_hash, PROFILE_BINDING.profile_schema_hash);
    assert.equal(bound.read_context.request_fingerprint, PROFILE_BINDING.request_fingerprint);
    assert.equal(bound.read_context.intent_fingerprint, PROFILE_BINDING.intent_fingerprint);
    assert.equal("url" in bound.read_context, false);
  }
  const partial = api.correlateOwnerSoulImageHistoryBinding({ snapshot: historySnapshot([historyObject("known-first"), historyObject("known-third")]),
    requested_chat_uuid: "soul-chat-1", owner_echo_message_id: "owner-ack-1", requested_batch_size: 4,
    profile_binding: PROFILE_BINDING });
  assert.equal(partial.status, "READY");
  assert.deepEqual(partial.read_context.message_object_ids, ["known-first", "known-third"]);
  assert.equal(partial.read_context.requested_batch_size, 4);
});

test("Soul history binding fails closed on owner media refs, unrelated rows, wrong model, chat, or profile", async () => {
  const api = await loadHistoryApi() as unknown as { correlateOwnerSoulImageHistoryBinding(input: unknown): any };
  const input = { requested_chat_uuid: "soul-chat-1", owner_echo_message_id: "owner-ack-1", requested_batch_size: 4 as const,
    profile_binding: PROFILE_BINDING };
  const result = historyObject("result-object");
  const ownerMedia = historySnapshot([result]);
  ownerMedia.messages[0]!.objects = [historyObject("unowned-upload")];
  assert.equal(api.correlateOwnerSoulImageHistoryBinding({ snapshot: ownerMedia, ...input }).reason,
    "OWNER_MEDIA_REFERENCES_NOT_SUPPORTED");
  assert.equal(api.correlateOwnerSoulImageHistoryBinding({ snapshot: historySnapshot([result], [
    { message_id: "unrelated-row", provider_chat_id: "771", author_role: "other", objects: [] }
  ]), ...input }).reason, "HISTORY_MESSAGE_SET_INVALID");
  assert.equal(api.correlateOwnerSoulImageHistoryBinding({ snapshot: historySnapshot([historyObject("result-object", "other-model")]), ...input }).reason,
    "RESULT_OBJECTS_INVALID");
  assert.equal(api.correlateOwnerSoulImageHistoryBinding({ snapshot: { ...historySnapshot([result]), requested_chat_uuid: "other-chat" }, ...input }).reason,
    "CHAT_SCOPE_MISMATCH");
  assert.equal(api.correlateOwnerSoulImageHistoryBinding({ snapshot: historySnapshot([result]), ...input,
    profile_binding: { ...PROFILE_BINDING, catalog_version: "sha256-other.json" } }).reason, "PROFILE_BINDING_INVALID");
  assert.equal(api.correlateOwnerSoulImageHistoryBinding({ snapshot: historySnapshot([historyObject("duplicate"), historyObject("duplicate")]),
    ...input }).reason, "HISTORY_SHAPE_INVALID");
});

test("Soul history binder rejects accessors without invoking them and returns pending until an object ID is observed", async () => {
  const api = await loadHistoryApi() as unknown as { correlateOwnerSoulImageHistoryBinding(input: unknown): any };
  const input = { snapshot: historySnapshot([]), requested_chat_uuid: "soul-chat-1", owner_echo_message_id: "owner-ack-1",
    requested_batch_size: 1, profile_binding: PROFILE_BINDING };
  assert.equal(api.correlateOwnerSoulImageHistoryBinding(input).status, "PENDING");
  const ackOnly = historySnapshot([]);
  ackOnly.messages = ackOnly.messages.slice(0, 1);
  ackOnly.total_count = 1;
  assert.deepEqual(api.correlateOwnerSoulImageHistoryBinding({ ...input, snapshot: ackOnly }),
    { status: "PENDING", reason: "RESULT_MESSAGE_NOT_FOUND" });
  let getterCalls = 0;
  const hostile = Object.defineProperties({}, {
    snapshot: { enumerable: true, get() { getterCalls += 1; return input.snapshot; } },
    requested_chat_uuid: { enumerable: true, value: input.requested_chat_uuid },
    owner_echo_message_id: { enumerable: true, value: input.owner_echo_message_id },
    requested_batch_size: { enumerable: true, value: input.requested_batch_size },
    profile_binding: { enumerable: true, value: input.profile_binding }
  });
  assert.equal(api.correlateOwnerSoulImageHistoryBinding(hostile).status, "UNVERIFIED");
  assert.equal(getterCalls, 0);
});

test("Soul result decoder binds exact output totals 1 and 4 and normalizes numeric provider IDs", async () => {
  const api = await loadResultApi() as unknown as { decodeOwnerSoulImageResult(raw: unknown, context: unknown): any };
  for (const batch of [1, 4] as const) {
    const ids = Array.from({ length: batch }, (_, index) => String(index + 1));
    const decoded = api.decodeOwnerSoulImageResult(rawResult(ids.map((id) => resultObject(Number(id), Number("100"))), { id: 100 }),
      { ...readContext(batch, ids), message_id: "100" });
    assert.equal(decoded.status, "COMPLETE");
    assert.equal(decoded.requested_batch_size, batch);
    assert.equal(decoded.actual_result_count, batch);
    assert.deepEqual(decoded.artifacts.map((artifact: { message_object_id: string }) => artifact.message_object_id), ids);
    assert.equal(decoded.artifacts.every((artifact: { geometry_verified: boolean; width: null; height: null }) =>
      artifact.geometry_verified === false && artifact.width === null && artifact.height === null), true);
  }
  const unknownExtension = api.decodeOwnerSoulImageResult(rawResult([resultObject("id-1", "soul-result-1",
    { objectUrl: "https://r2.syntx.ai/result-id-1.unknown" })]), readContext(1, ["id-1"]));
  assert.equal(unknownExtension.status, "COMPLETE");
  assert.equal(unknownExtension.artifacts[0]?.mime_type, null);
  assert.equal(unknownExtension.artifacts[0]?.mime_source, "UNKNOWN");
});

test("Soul result decoder preserves completed artifacts when known middle IDs remain unfinished or URI-less", async () => {
  const api = await loadResultApi() as unknown as { decodeOwnerSoulImageResult(raw: unknown, context: unknown): any };
  const context = readContext(4, ["object-a", "object-c", "object-d"]);
  const decoded = api.decodeOwnerSoulImageResult(rawResult([
    resultObject("object-a", "soul-result-1"),
    resultObject("object-c", "soul-result-1", { completed: false, objectUrl: null }),
    resultObject("object-d", "soul-result-1", { completed: true, objectUrl: null })
  ]), context);
  assert.equal(decoded.status, "PARTIAL");
  assert.equal(decoded.requested_batch_size, 4);
  assert.deepEqual(decoded.message_object_ids, ["object-a", "object-c", "object-d"]);
  assert.deepEqual(decoded.artifacts.map((artifact: { message_object_id: string }) => artifact.message_object_id), ["object-a"]);
});

test("Soul result decoder rejects duplicate, unexpected, excess, foreign-chat, or unsafe result objects without truncation", async () => {
  const api = await loadResultApi() as unknown as { decodeOwnerSoulImageResult(raw: unknown, context: unknown): any };
  const ctx = readContext(4, ["object-a", "object-b", "object-c", "object-d"]);
  assert.equal(api.decodeOwnerSoulImageResult(rawResult([resultObject("object-a", "soul-result-1"),
    resultObject("object-a", "soul-result-1")]), ctx).reason, "DUPLICATE_RESULT_OBJECT_ID");
  assert.equal(api.decodeOwnerSoulImageResult(rawResult([resultObject("unobserved", "soul-result-1")]), ctx).reason,
    "OBJECT_ID_MISMATCH");
  const excess = [...ctx.message_object_ids, "fifth"];
  assert.equal(api.decodeOwnerSoulImageResult(rawResult(excess.map((id) => resultObject(id, "soul-result-1"))), ctx).reason,
    "EXTRANEOUS_RESULT_OBJECTS");
  assert.equal(api.decodeOwnerSoulImageResult(rawResult([resultObject("object-a", "soul-result-1")], { chat_id: 772 }), ctx).reason,
    "PROVIDER_CHAT_MISMATCH");
  assert.equal(api.decodeOwnerSoulImageResult(rawResult([resultObject("object-a", "soul-result-1",
    { objectUrl: "https://attacker.example/result.png" })]), ctx).reason, "RESULT_URL_UNSAFE");
  assert.equal(api.decodeOwnerSoulImageResult(rawResult([resultObject("object-a", "soul-result-1", { modelType: "other-model" })]), ctx).reason,
    "MODEL_TYPE_MISMATCH");
  assert.equal(api.decodeOwnerSoulImageResult(rawResult([resultObject({}, "soul-result-1")]), ctx).reason, "OBJECT_ID_MISMATCH");
  assert.equal(api.decodeOwnerSoulImageResult(rawResult([resultObject(-1, "soul-result-1")]), ctx).reason, "OBJECT_ID_MISMATCH");
  assert.equal(api.decodeOwnerSoulImageResult(rawResult([resultObject(Number.MAX_SAFE_INTEGER + 1, "soul-result-1")]), ctx).reason,
    "OBJECT_ID_MISMATCH");
  let coercionCalls = 0;
  const coercibleId = { toString() { coercionCalls += 1; return "object-a"; } };
  assert.equal(api.decodeOwnerSoulImageResult(rawResult([resultObject(coercibleId, "soul-result-1")]), ctx).reason,
    "OBJECT_ID_MISMATCH");
  assert.equal(coercionCalls, 0);
  let getterCalls = 0;
  const hostileObject = Object.defineProperties({ id: "object-a", message_id: "soul-result-1", object_type: "image",
    model_type: MODEL_ID, completed: true }, {
      object_url: { enumerable: true, get() { getterCalls += 1; return "https://r2.syntx.ai/secret.png"; } }
    });
  assert.equal(api.decodeOwnerSoulImageResult(rawResult([hostileObject]), ctx).reason, "RESPONSE_SHAPE_INVALID");
  assert.equal(getterCalls, 0);
});

test("Soul result GET uses one fixed route, and pre-abort never enters credentials or fetch", async () => {
  const api = await loadResultApi() as unknown as { snapshotOwnerSoulImageResultReadContext(value: unknown): unknown };
  const snapshotContext = api.snapshotOwnerSoulImageResultReadContext as (value: unknown) => unknown;
  const context = readContext(1, ["object-a"]);
  const calls: Array<{ url: string; method: string | undefined; body: BodyInit | null | undefined }> = [];
  let credentialCalls = 0;
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    credentialCalls += 1; return operation("synthetic-soul-result-credential");
  } };
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl: async (input, init) => {
    calls.push({ url: String(input), method: init?.method, body: init?.body });
    return Response.json(rawResult([resultObject("object-a", "soul-result-1")]));
  } });
  const getResult = (client as unknown as { getSoulImageBatchResult(context: unknown, signal?: AbortSignal): Promise<unknown> })
    .getSoulImageBatchResult.bind(client);
  const decoded = await getResult(context);
  assert.equal((decoded as { status: string }).status, "COMPLETE");
  assert.deepEqual(calls, [{ url: "https://api.syntx.ai/api/v1/chats/soul-chat-1/soul-result-1", method: "GET", body: undefined }]);
  assert.equal(credentialCalls, 1);

  const controller = new AbortController(); controller.abort();
  let abortFetchCalls = 0; let abortCredentialCalls = 0;
  const preAborted = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(_operation: (credential: string) => Promise<T>) {
    abortCredentialCalls += 1; throw new Error("credential callback must not be entered");
  } }, fetchImpl: async () => { abortFetchCalls += 1; throw new Error("fetch must not be entered"); } });
  const abortGet = (preAborted as unknown as { getSoulImageBatchResult(context: unknown, signal?: AbortSignal): Promise<unknown> })
    .getSoulImageBatchResult.bind(preAborted);
  await assert.rejects(abortGet(snapshotContext(context), controller.signal),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(abortCredentialCalls, 0); assert.equal(abortFetchCalls, 0);

  let failedFetchCalls = 0;
  const noRetry = new SyntxChatHttpClient({ credentialBroker, fetchImpl: async () => {
    failedFetchCalls += 1; throw new Error("synthetic result read failure");
  } });
  const failGet = (noRetry as unknown as { getSoulImageBatchResult(context: unknown): Promise<unknown> })
    .getSoulImageBatchResult.bind(noRetry);
  await assert.rejects(failGet(context), (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_UNAVAILABLE");
  assert.equal(failedFetchCalls, 1, "GET errors must not be retried by the Soul result client");
});
