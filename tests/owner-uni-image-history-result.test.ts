import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { decodeOwnerUniImageResult, snapshotOwnerUniImageResultReadContext } from "../src/adapter/syntx/owner-uni-image-result.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { correlateOwnerUniImageHistoryBinding } from "../src/application/owner-uni-image-history-binding.js";

const CREDENTIAL = "synthetic-uni-result-credential";
const CHAT_UUID = "chat-uni-804";
const OWNER_MESSAGE_ID = "owner-ack-1";
const BOT_MESSAGE_ID = "bot-result-1";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function broker(onCredential: () => void): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    onCredential();
    return operation(CREDENTIAL);
  } };
}

test("binds the exact owner ACK and bot history row, then reads every observed Uni result object by GET", async () => {
  let credentialCalls = 0;
  const requests: Array<{ url: string; method: string | undefined }> = [];
  const history = {
    messages: [
      { id: OWNER_MESSAGE_ID, chat_id: 804, author_id: 42, message_object: [
        { id: "input-image-1", message_id: OWNER_MESSAGE_ID, object_type: "image", model_type: "uni-1" }
      ] },
      { id: BOT_MESSAGE_ID, chat_id: 804, author_id: -1, message_object: [
        { id: "output-image-1", message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "uni-1" },
        { id: "output-image-2", message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "uni-1" }
      ] }
    ],
    pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
  };
  const resultMessage = {
    id: BOT_MESSAGE_ID, chat_id: 804, author_id: -1,
    message_object: [
      { id: "output-image-1", message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "uni-1", completed: true, object_url: "https://r2.syntx.ai/generated/first.png" },
      { id: "output-image-2", message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "uni-1", completed: true, object_url: "https://r2.syntx.ai/generated/second.webp" }
    ]
  };
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(() => { credentialCalls += 1; }),
    fetchImpl: async (input, init) => {
      const url = String(input);
      requests.push({ url, method: init?.method });
      if (url.endsWith(`/chats/${CHAT_UUID}/messages?page=1&page_size=10`)) return jsonResponse(history);
      if (url.endsWith(`/chats/${CHAT_UUID}/${BOT_MESSAGE_ID}`)) return jsonResponse(resultMessage);
      throw new Error("unexpected synthetic route");
    }
  });

  const snapshot = await client.listMessageCandidates(CHAT_UUID, OWNER_MESSAGE_ID);
  const binding = correlateOwnerUniImageHistoryBinding({
    snapshot,
    requested_chat_uuid: CHAT_UUID,
    owner_echo_message_id: OWNER_MESSAGE_ID,
    model_id: "uni-1",
    expected_reference_count: 1,
    expected_reference_types: ["image"],
    profile_binding: {
      profile_id: "owner-uni-image-source-profile-v1",
      model_id: "uni-1",
      catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      profile_schema_hash: `sha256:${"a".repeat(64)}`,
      request_fingerprint: `sha256:${"b".repeat(64)}`,
      intent_fingerprint: `sha256:${"c".repeat(64)}`
    }
  });
  assert.equal(binding.status, "READY");
  if (binding.status !== "READY") return;
  assert.deepEqual(binding.read_context.message_object_ids, ["output-image-1", "output-image-2"]);
  assert.equal(JSON.stringify(binding).includes("https://"), false, "history binding must not enumerate URIs");

  const result = await client.getUniImageResult(binding.read_context);
  assert.equal(result.status, "COMPLETE");
  if (result.status !== "COMPLETE") return;
  assert.equal(result.observed_history_object_count, 2);
  assert.equal(result.actual_result_count, 2);
  assert.deepEqual(result.artifacts.map((artifact) => artifact.message_object_id), ["output-image-1", "output-image-2"]);
  assert.deepEqual(result.artifacts.map((artifact) => artifact.mime_type), ["image/png", "image/webp"]);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal(result.result_count_confidence, "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL");
  assert.deepEqual(requests.map(({ url, method }) => [url, method]), [
    [`https://api.syntx.ai/api/v1/chats/${CHAT_UUID}/messages?page=1&page_size=10`, "GET"],
    [`https://api.syntx.ai/api/v1/chats/${CHAT_UUID}/${BOT_MESSAGE_ID}`, "GET"]
  ]);
  assert.equal(credentialCalls, 2);
});

for (const model_id of ["uni-1.1-modify-image", "uni-1.1-remove-background"] as const) {
  test(`${model_id} retains multiple outputs without inventing a requested count`, async () => {
    const ids = [`${model_id}-out-1`, `${model_id}-out-2`];
    const resultMessage = {
      id: `${model_id}-bot`, chat_id: 804, author_id: -1,
      message_object: ids.map((id, index) => ({ id, message_id: `${model_id}-bot`, object_type: "image", model_type: model_id,
        completed: true, object_url: `https://r2.syntx.ai/generated/${model_id}-${index + 1}.png` }))
    };
    const history = {
      messages: [
        { id: `${model_id}-owner`, chat_id: 804, author_id: 42, message_object: [
          { id: `${model_id}-input`, message_id: `${model_id}-owner`, object_type: "image", model_type: model_id }
        ] },
        { id: `${model_id}-bot`, chat_id: 804, author_id: -1, message_object: ids.map((id) => ({ id, message_id: `${model_id}-bot`, object_type: "image", model_type: model_id })) }
      ],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
    };
    const client = new SyntxChatHttpClient({
      credentialBroker: broker(() => undefined),
      fetchImpl: async (input, init) => {
        const url = String(input);
        assert.equal(init?.method, "GET");
        if (url.endsWith(`/chats/${CHAT_UUID}/messages?page=1&page_size=10`)) return jsonResponse(history);
        if (url.endsWith(`/chats/${CHAT_UUID}/${model_id}-bot`)) return jsonResponse(resultMessage);
        throw new Error("unexpected synthetic route");
      }
    });
    const binding = correlateOwnerUniImageHistoryBinding({
      snapshot: await client.listMessageCandidates(CHAT_UUID, `${model_id}-owner`), requested_chat_uuid: CHAT_UUID,
      owner_echo_message_id: `${model_id}-owner`, model_id, expected_reference_count: 1, expected_reference_types: ["image"],
      profile_binding: { profile_id: "owner-uni-image-source-profile-v1", model_id,
        catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
        profile_schema_hash: `sha256:${"a".repeat(64)}`, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}` }
    });
    assert.equal(binding.status, "READY");
    if (binding.status !== "READY") return;
    const result = await client.getUniImageResult(binding.read_context);
    assert.equal(result.status, "COMPLETE");
    if (result.status !== "COMPLETE") return;
    assert.deepEqual(result.artifacts.map(({ message_object_id }) => message_object_id), ids);
    assert.equal(result.actual_result_count, 2);
    assert.equal(result.observed_history_object_count, 2);
    assert.equal(result.result_count_confidence, "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL");
  });
}

test("keeps completed artifacts visible when the exact current history row is only partly returned", () => {
  const context = {
    chat_uuid: CHAT_UUID, provider_chat_id: "804", owner_echo_message_id: OWNER_MESSAGE_ID, message_id: BOT_MESSAGE_ID,
    model_id: "uni-1" as const, message_object_ids: ["output-image-1", "output-image-2"], profile_id: "owner-uni-image-source-profile-v1" as const,
    catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    profile_schema_hash: `sha256:${"a".repeat(64)}`, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`
  };
  const partial = decodeOwnerUniImageResult({
    id: BOT_MESSAGE_ID, chat_id: 804, author_id: -1,
    message_object: [{ id: "output-image-1", message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "uni-1", completed: true,
      object_url: "https://r2.syntx.ai/generated/first.png" }]
  }, context);
  assert.equal(partial.status, "PARTIAL");
  if (partial.status !== "PARTIAL") return;
  assert.equal(partial.reason, "OBSERVED_RESULT_OBJECTS_PARTIAL");
  assert.deepEqual(partial.artifacts.map(({ message_object_id }) => message_object_id), ["output-image-1"]);
  assert.equal(partial.result_count_confidence, "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL");

  const reordered = decodeOwnerUniImageResult({
    id: BOT_MESSAGE_ID, chat_id: 804, author_id: -1,
    message_object: [
      { id: "output-image-2", message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "uni-1", completed: true,
        object_url: "https://r2.syntx.ai/generated/second.png" }
    ]
  }, context);
  assert.equal(reordered.status, "PARTIAL");
  if (reordered.status === "PARTIAL") assert.deepEqual(reordered.artifacts.map(({ message_object_id }) => message_object_id), ["output-image-2"]);
});

test("fails closed instead of truncating history-bound result sets above the local cap", () => {
  const ids = Array.from({ length: 65 }, (_, index) => `output-${index}`);
  const snapshot = {
    complete: true as const, page: 1 as const, page_size: 10 as const, total_count: 2, total_pages: 1,
    has_next: false as const, has_previous: false as const, requested_chat_uuid: CHAT_UUID, provider_chat_id: "804",
    messages: [
      { message_id: OWNER_MESSAGE_ID, provider_chat_id: "804", author_role: "owner" as const,
        objects: [{ message_object_id: "input-1", object_type: "image", model_type: "uni-1" }] },
      { message_id: BOT_MESSAGE_ID, provider_chat_id: "804", author_role: "bot" as const,
        objects: ids.map((message_object_id) => ({ message_object_id, object_type: "image", model_type: "uni-1" })) }
    ]
  };
  const binding = correlateOwnerUniImageHistoryBinding({ snapshot, requested_chat_uuid: CHAT_UUID, owner_echo_message_id: OWNER_MESSAGE_ID,
    model_id: "uni-1", expected_reference_count: 1, expected_reference_types: ["image"], profile_binding: {
      profile_id: "owner-uni-image-source-profile-v1", model_id: "uni-1",
      catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      profile_schema_hash: `sha256:${"a".repeat(64)}`, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`
    } });
  assert.equal(binding.status, "UNVERIFIED");
  if (binding.status === "UNVERIFIED") assert.equal(binding.reason, "RESULT_OBJECTS_OVER_LIMIT");
});

for (const model_id of ["uni-1", "uni-1.1-modify-image", "uni-1.1-remove-background"] as const) {
  test(`${model_id} decodes one exact observed result with URL-only MIME confidence`, () => {
    const message_id = `${model_id}-single`;
    const object_id = `${model_id}-single-image`;
    const result = decodeOwnerUniImageResult({ id: message_id, chat_id: 804, author_id: -1,
      message_object: [{ id: object_id, message_id, object_type: "image", model_type: model_id, completed: true,
        object_url: `https://r2.syntx.ai/generated/${model_id}.avif` }] }, {
      chat_uuid: CHAT_UUID, provider_chat_id: "804", owner_echo_message_id: OWNER_MESSAGE_ID, message_id, model_id,
      message_object_ids: [object_id], profile_id: "owner-uni-image-source-profile-v1",
      catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      profile_schema_hash: `sha256:${"a".repeat(64)}`, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`
    });
    assert.equal(result.status, "COMPLETE");
    if (result.status !== "COMPLETE") return;
    assert.equal(result.actual_result_count, 1);
    assert.equal(result.artifacts[0]?.mime_type, "image/avif");
    assert.equal(result.artifacts[0]?.geometry_verified, false);
  });
}

test("numeric provider ID normalization rejects unsafe values without coercion and keeps read context string-only", () => {
  let coercions = 0;
  const coercible = { valueOf() { coercions += 1; return 101; }, toString() { coercions += 1; return "101"; },
    [Symbol.toPrimitive]() { coercions += 1; return "101"; } };
  const invalidValues: unknown[] = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 101n, coercible];
  const context = {
    chat_uuid: CHAT_UUID, provider_chat_id: "804", owner_echo_message_id: OWNER_MESSAGE_ID, message_id: "102",
    model_id: "uni-1" as const, message_object_ids: ["101"], profile_id: "owner-uni-image-source-profile-v1" as const,
    catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    profile_schema_hash: `sha256:${"a".repeat(64)}`, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`
  };
  for (const value of invalidValues) {
    const result = decodeOwnerUniImageResult({ id: "102", chat_id: 804, author_id: -1,
      message_object: [{ id: value, message_id: "102", object_type: "image", model_type: "uni-1", completed: true,
        object_url: "https://r2.syntx.ai/uni/result.png" }] }, context);
    assert.equal(result.status, "UNVERIFIED");
    if (result.status === "UNVERIFIED") assert.equal(result.reason, "OBJECT_ID_MISMATCH");
  }
  assert.equal(coercions, 0);
  assert.throws(() => snapshotOwnerUniImageResultReadContext({ ...context, message_id: 102 }));
});

test("rejects mismatched model, unsafe URL, and proxy context without exposing raw locations", () => {
  const context = {
    chat_uuid: CHAT_UUID, provider_chat_id: "804", owner_echo_message_id: OWNER_MESSAGE_ID, message_id: BOT_MESSAGE_ID,
    model_id: "uni-1" as const, message_object_ids: ["output-image-1"], profile_id: "owner-uni-image-source-profile-v1" as const,
    catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    profile_schema_hash: `sha256:${"a".repeat(64)}`, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`
  };
  const mismatch = decodeOwnerUniImageResult({ id: BOT_MESSAGE_ID, chat_id: 804, author_id: -1,
    message_object: [{ id: "output-image-1", message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "wrong-model", completed: true,
      object_url: "https://r2.syntx.ai/generated/private.png" }] }, context);
  assert.equal(mismatch.status, "UNVERIFIED");
  if (mismatch.status === "UNVERIFIED") assert.equal(mismatch.reason, "MODEL_TYPE_MISMATCH");
  assert.equal(JSON.stringify(mismatch).includes("https://"), false);

  const unsafe = decodeOwnerUniImageResult({ id: BOT_MESSAGE_ID, chat_id: 804, author_id: -1,
    message_object: [{ id: "output-image-1", message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "uni-1", completed: true,
      object_url: "https://example.invalid/private.png" }] }, context);
  assert.equal(unsafe.status, "UNVERIFIED");
  if (unsafe.status === "UNVERIFIED") assert.equal(unsafe.reason, "RESULT_URL_UNSAFE");
  assert.equal(JSON.stringify(unsafe).includes("example.invalid"), false);

  assert.throws(() => decodeOwnerUniImageResult({}, new Proxy(context, {})));
  assert.throws(() => decodeOwnerUniImageResult({}, { ...context, get message_id() { throw new Error("getter must not run"); } }));
});

test("an already-aborted bounded GET does not fetch or retry", async () => {
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(() => undefined),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); }
  });
  const context = {
    chat_uuid: CHAT_UUID, provider_chat_id: "804", owner_echo_message_id: OWNER_MESSAGE_ID, message_id: BOT_MESSAGE_ID,
    model_id: "uni-1" as const, message_object_ids: ["output-image-1"], profile_id: "owner-uni-image-source-profile-v1" as const,
    catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    profile_schema_hash: `sha256:${"a".repeat(64)}`, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`
  };
  await assert.rejects(client.getUniImageResult(context, AbortSignal.abort()));
  assert.equal(fetchCalls, 0);
});

for (const model_id of ["uni-1", "uni-1.1-modify-image", "uni-1.1-remove-background"] as const) {
  test(`${model_id} binds safe numeric provider IDs after client normalization`, async () => {
    const requests: string[] = [];
    const history = { messages: [
      { id: 101, chat_id: 804, author_id: 42, message_object: [
        { id: 201, message_id: 101, object_type: "image", model_type: model_id }
      ] },
      { id: 102, chat_id: 804, author_id: -1, message_object: [
        { id: 301, message_id: 102, object_type: "image", model_type: model_id },
        { id: 302, message_id: 102, object_type: "image", model_type: model_id }
      ] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } };
    const client = new SyntxChatHttpClient({ credentialBroker: broker(() => undefined), fetchImpl: async (input) => {
      const url = String(input); requests.push(url);
      if (url.endsWith(`/chats/${CHAT_UUID}/messages?page=1&page_size=10`)) return jsonResponse(history);
      if (url.endsWith(`/chats/${CHAT_UUID}/102`)) return jsonResponse({ id: 102, chat_id: 804, author_id: -1,
        message_object: [
          { id: 301, message_id: 102, object_type: "image", model_type: model_id, completed: true, object_url: "https://r2.syntx.ai/uni/301.png" },
          { id: 302, message_id: 102, object_type: "image", model_type: model_id, completed: true, object_url: "https://r2.syntx.ai/uni/302.webp" }
        ] });
      throw new Error("unexpected synthetic route");
    } });
    const snapshot = await client.listMessageCandidates(CHAT_UUID, "101");
    assert.deepEqual(snapshot.messages.map(({ message_id }) => message_id), ["101", "102"]);
    assert.deepEqual(snapshot.messages.flatMap(({ objects }) => objects.map(({ message_object_id }) => message_object_id)), ["201", "301", "302"]);
    const binding = correlateOwnerUniImageHistoryBinding({ snapshot, requested_chat_uuid: CHAT_UUID, owner_echo_message_id: "101",
      model_id, expected_reference_count: 1, expected_reference_types: ["image"], profile_binding: {
        profile_id: "owner-uni-image-source-profile-v1", model_id,
        catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
        profile_schema_hash: `sha256:${"a".repeat(64)}`, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`
      } });
    assert.equal(binding.status, "READY");
    if (binding.status !== "READY") return;
    assert.equal(binding.read_context.message_id, "102");
    assert.deepEqual(binding.read_context.message_object_ids, ["301", "302"]);
    const result = await client.getUniImageResult(binding.read_context);
    assert.equal(result.status, "COMPLETE");
    if (result.status !== "COMPLETE") return;
    assert.deepEqual(result.artifacts.map(({ message_object_id, message_id }) => [message_object_id, message_id]), [["301", "102"], ["302", "102"]]);
    assert.deepEqual(requests, [
      `https://api.syntx.ai/api/v1/chats/${CHAT_UUID}/messages?page=1&page_size=10`,
      `https://api.syntx.ai/api/v1/chats/${CHAT_UUID}/102`
    ]);
  });
}

test("retains unique completed objects when the result omits an earlier or middle history object", () => {
  const context = {
    chat_uuid: CHAT_UUID, provider_chat_id: "804", owner_echo_message_id: OWNER_MESSAGE_ID, message_id: BOT_MESSAGE_ID,
    model_id: "uni-1" as const, message_object_ids: ["output-1", "output-2", "output-3"],
    profile_id: "owner-uni-image-source-profile-v1" as const,
    catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    profile_schema_hash: `sha256:${"a".repeat(64)}`, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`
  };
  const output = (id: string) => ({ id, message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "uni-1", completed: true,
    object_url: `https://r2.syntx.ai/generated/${id}.png` });
  const missingFirst = decodeOwnerUniImageResult({ id: BOT_MESSAGE_ID, chat_id: 804, author_id: -1,
    message_object: [output("output-2"), output("output-3")] }, context);
  assert.equal(missingFirst.status, "PARTIAL");
  if (missingFirst.status === "PARTIAL") {
    assert.deepEqual(missingFirst.artifacts.map(({ message_object_id }) => message_object_id), ["output-2", "output-3"]);
    assert.equal(missingFirst.reason, "OBSERVED_RESULT_OBJECTS_PARTIAL");
  }
  const missingMiddle = decodeOwnerUniImageResult({ id: BOT_MESSAGE_ID, chat_id: 804, author_id: -1,
    message_object: [output("output-1"), output("output-3")] }, context);
  assert.equal(missingMiddle.status, "PARTIAL");
  if (missingMiddle.status === "PARTIAL") {
    assert.deepEqual(missingMiddle.artifacts.map(({ message_object_id }) => message_object_id), ["output-1", "output-3"]);
  }
  const reversed = decodeOwnerUniImageResult({ id: BOT_MESSAGE_ID, chat_id: 804, author_id: -1,
    message_object: [output("output-3"), output("output-1")] }, context);
  assert.equal(reversed.status, "PARTIAL");
  if (reversed.status === "PARTIAL") {
    assert.deepEqual(reversed.artifacts.map(({ message_object_id }) => message_object_id), ["output-1", "output-3"]);
  }
  const unknown = decodeOwnerUniImageResult({ id: BOT_MESSAGE_ID, chat_id: 804, author_id: -1,
    message_object: [output("not-in-history")] }, context);
  assert.equal(unknown.status, "UNVERIFIED");
  const duplicate = decodeOwnerUniImageResult({ id: BOT_MESSAGE_ID, chat_id: 804, author_id: -1,
    message_object: [output("output-1"), output("output-1")] }, context);
  assert.equal(duplicate.status, "UNVERIFIED");
});

test("an unfinished object without a URL does not invalidate other completed artifacts", () => {
  const result = decodeOwnerUniImageResult({ id: BOT_MESSAGE_ID, chat_id: 804, author_id: -1,
    message_object: [
      { id: "unfinished-1", message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "uni-1", completed: false, object_url: null },
      { id: "finished-2", message_id: BOT_MESSAGE_ID, object_type: "image", model_type: "uni-1", completed: true,
        object_url: "https://r2.syntx.ai/generated/finished.png" }
    ] }, {
    chat_uuid: CHAT_UUID, provider_chat_id: "804", owner_echo_message_id: OWNER_MESSAGE_ID, message_id: BOT_MESSAGE_ID,
    model_id: "uni-1", message_object_ids: ["unfinished-1", "finished-2"], profile_id: "owner-uni-image-source-profile-v1",
    catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    profile_schema_hash: `sha256:${"a".repeat(64)}`, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`
  });
  assert.equal(result.status, "PARTIAL");
  if (result.status === "PARTIAL") {
    assert.equal(result.reason, "SOME_RESULTS_NOT_COMPLETED");
    assert.deepEqual(result.artifacts.map(({ message_object_id }) => message_object_id), ["finished-2"]);
  }
});

test("history correlation accepts only the exact fresh owner-ACK and one next bot row", () => {
  const baseSnapshot = {
    complete: true as const, page: 1 as const, page_size: 10 as const, total_count: 2, total_pages: 1,
    has_next: false as const, has_previous: false as const, requested_chat_uuid: CHAT_UUID, provider_chat_id: "804"
  };
  const owner = { message_id: OWNER_MESSAGE_ID, provider_chat_id: "804", author_role: "owner" as const,
    objects: [{ message_object_id: "input-1", object_type: "image", model_type: "uni-1" }] };
  const bot = { message_id: BOT_MESSAGE_ID, provider_chat_id: "804", author_role: "bot" as const,
    objects: [{ message_object_id: "output-1", object_type: "image", model_type: "uni-1" }] };
  const input = (messages: readonly unknown[]) => correlateOwnerUniImageHistoryBinding({
    snapshot: { ...baseSnapshot, total_count: messages.length, messages } as never,
    requested_chat_uuid: CHAT_UUID, owner_echo_message_id: OWNER_MESSAGE_ID, model_id: "uni-1",
    expected_reference_count: 1, expected_reference_types: ["image"], profile_binding: {
      profile_id: "owner-uni-image-source-profile-v1", model_id: "uni-1",
      catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      profile_schema_hash: `sha256:${"a".repeat(64)}`, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`
    }
  });
  const extraOwner = input([owner, { ...owner, message_id: "second-owner", objects: [
    { message_object_id: "input-2", object_type: "image", model_type: "uni-1" }
  ] }, bot]);
  assert.equal(extraOwner.status, "UNVERIFIED");
  if (extraOwner.status === "UNVERIFIED") assert.equal(extraOwner.reason, "HISTORY_MESSAGE_SET_INVALID");
  const unrelatedBot = input([owner, { ...bot, message_id: "unrelated-bot", objects: [
    { message_object_id: "other-output", object_type: "image", model_type: "other-model" }
  ] }, bot]);
  assert.equal(unrelatedBot.status, "UNVERIFIED");
  if (unrelatedBot.status === "UNVERIFIED") assert.equal(unrelatedBot.reason, "HISTORY_MESSAGE_SET_INVALID");
  const wrongModel = input([owner, { ...bot, objects: [{ message_object_id: "wrong-output", object_type: "image", model_type: "other-model" }] }]);
  assert.equal(wrongModel.status, "UNVERIFIED");
  if (wrongModel.status === "UNVERIFIED") assert.equal(wrongModel.reason, "RESULT_OBJECTS_INVALID");
});

test("rejects hostile author_role values without coercing them", () => {
  let coercions = 0;
  const snapshot = {
    complete: true as const, page: 1 as const, page_size: 10 as const, total_count: 2, total_pages: 1,
    has_next: false as const, has_previous: false as const, requested_chat_uuid: CHAT_UUID, provider_chat_id: "804",
    messages: [
      { message_id: OWNER_MESSAGE_ID, provider_chat_id: "804", author_role: { toString() { coercions += 1; return "owner"; } },
        objects: [{ message_object_id: "input-1", object_type: "image", model_type: "uni-1" }] },
      { message_id: BOT_MESSAGE_ID, provider_chat_id: "804", author_role: "bot",
        objects: [{ message_object_id: "output-1", object_type: "image", model_type: "uni-1" }] }
    ]
  };
  const binding = correlateOwnerUniImageHistoryBinding({ snapshot: snapshot as never, requested_chat_uuid: CHAT_UUID,
    owner_echo_message_id: OWNER_MESSAGE_ID, model_id: "uni-1", expected_reference_count: 1, expected_reference_types: ["image"],
    profile_binding: { profile_id: "owner-uni-image-source-profile-v1", model_id: "uni-1",
      catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      profile_schema_hash: `sha256:${"a".repeat(64)}`, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}` }
  });
  assert.equal(binding.status, "UNVERIFIED");
  assert.equal(coercions, 0);
});
