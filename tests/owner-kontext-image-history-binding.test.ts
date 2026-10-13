import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_KONTEXT_IMAGE_HISTORY_INVALID_REASONS,
  correlateOwnerKontextImageHistoryBinding
} from "../src/application/owner-kontext-image-history-binding.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import type { OwnerKontextImageVariant } from "../src/application/owner-kontext-image-parameters.js";

const CHAT_UUID = "kontext-multi-history-466";
const ECHO_ID = "101";
const VARIANT = "flux-kontext-multi" as const;
const CREDENTIAL = "synthetic-kontext-history-credential";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function object(id: string, type: string, model: string | null) {
  return { message_object_id: id, object_type: type, model_type: model };
}

function row(id: string, role: string, objects: readonly unknown[], providerChatId = "412") {
  return { message_id: id, provider_chat_id: providerChatId, author_role: role, objects };
}

function snapshot(messages: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    complete: true,
    page: 1,
    page_size: 10,
    total_count: messages.length,
    total_pages: 1,
    has_next: false,
    has_previous: false,
    requested_chat_uuid: CHAT_UUID,
    provider_chat_id: "412",
    messages,
    ...overrides
  };
}

function correlate(
  history: unknown,
  variant: OwnerKontextImageVariant = VARIANT,
  requestedReferenceCount = 4,
  overrides: Record<string, unknown> = {}
) {
  return correlateOwnerKontextImageHistoryBinding({
    snapshot: history,
    requested_chat_uuid: CHAT_UUID,
    owner_echo_message_id: ECHO_ID,
    variant,
    requested_reference_count: requestedReferenceCount,
    ...overrides
  });
}

test("native history producer correlates four owner references plus text to one requested-variant bot image", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      return operation(CREDENTIAL);
    }
  };
  const client = new SyntxChatHttpClient({
    credentialBroker,
    fetchImpl: async (input, init) => {
      fetchCalls += 1;
      assert.equal(String(input), `https://api.syntx.ai/api/v1/chats/${CHAT_UUID}/messages?page=1&page_size=10`);
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${CREDENTIAL}`);
      return jsonResponse({
        messages: [
          {
            id: 101,
            chat_id: 412,
            author_id: 139413708,
            message_object: [
              { id: 201, message_id: 101, object_type: "image", model_type: VARIANT, url: "private-url-1" },
              { id: 202, message_id: 101, object_type: "image", model_type: VARIANT, url: "private-url-2" },
              { id: 203, message_id: 101, object_type: "image", model_type: VARIANT, url: "private-url-3" },
              { id: 204, message_id: 101, object_type: "image", model_type: VARIANT, url: "private-url-4" },
              { id: 205, message_id: 101, object_type: "text", model_type: null, text: "private prompt" }
            ]
          },
          {
            id: 102,
            chat_id: 412,
            author_id: -1,
            message_object: [{
              id: 301, message_id: 102, object_type: "image", model_type: VARIANT,
              completed: true, object_url: "private-output-url"
            }]
          }
        ],
        pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
      });
    }
  });

  const snapshot = await client.listMessageCandidates(CHAT_UUID, ECHO_ID);
  assert.deepEqual(snapshot.messages.map(({ message_id, provider_chat_id, author_role, objects }) => ({
    message_id, provider_chat_id, author_role, objects
  })), [
    {
      message_id: "101", provider_chat_id: "412", author_role: "owner",
      objects: [
        { message_object_id: "201", object_type: "image", model_type: VARIANT },
        { message_object_id: "202", object_type: "image", model_type: VARIANT },
        { message_object_id: "203", object_type: "image", model_type: VARIANT },
        { message_object_id: "204", object_type: "image", model_type: VARIANT },
        { message_object_id: "205", object_type: "text", model_type: null }
      ]
    },
    {
      message_id: "102", provider_chat_id: "412", author_role: "bot",
      objects: [{ message_object_id: "301", object_type: "image", model_type: VARIANT }]
    }
  ]);
  assert.equal(Object.hasOwn(snapshot.messages[1]!, "author_id"), false);

  const result = correlateOwnerKontextImageHistoryBinding({
    snapshot,
    requested_chat_uuid: CHAT_UUID,
    owner_echo_message_id: ECHO_ID,
    variant: VARIANT,
    requested_reference_count: 4
  });
  assert.deepEqual(result, {
    kind: "READY", provider_chat_id: "412", bot_message_id: "102", object_id: "301"
  });
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(fetchCalls, 1);
  assert.equal(credentialCalls, 1);
});

test("all three variants accept only their requested reference counts and one bot output", () => {
  const cases = [
    { variant: "flux-kontext-pro", references: 0, echo: [], bot: "bot-pro-0", objectId: "output-pro-0" },
    { variant: "flux-kontext-pro", references: 1, echo: [object("pro-ref", "image", "flux-kontext-pro")], bot: "bot-pro-1", objectId: "output-pro-1" },
    { variant: "flux-kontext-max", references: 0, echo: [object("max-text", "text", null)], bot: "bot-max-0", objectId: "output-max-0" },
    { variant: "flux-kontext-max", references: 1, echo: [object("max-ref", "image", null)], bot: "bot-max-1", objectId: "output-max-1" },
    { variant: "flux-kontext-multi", references: 1, echo: [object("multi-ref-1", "image", "flux-kontext-multi")], bot: "bot-multi-1", objectId: "output-multi-1" },
    { variant: "flux-kontext-multi", references: 4, echo: [
      object("multi-ref-1", "image", null), object("multi-ref-2", "image", VARIANT),
      object("multi-ref-3", "image", VARIANT), object("multi-ref-4", "image", VARIANT),
      object("multi-text", "text", null)
    ], bot: "bot-multi-4", objectId: "output-multi-4" }
  ] as const;
  for (const item of cases) {
    const owner = row(ECHO_ID, "owner", item.echo);
    const bot = row(item.bot, "bot", [object(item.objectId, "image", item.variant)]);
    const result = correlate(snapshot([bot, owner]), item.variant, item.references);
    assert.deepEqual(result, {
      kind: "READY", provider_chat_id: "412", bot_message_id: item.bot, object_id: item.objectId
    });
  }
});

test("missing bot and bot with zero objects remain pending with no guessed row selection", () => {
  assert.deepEqual(correlate(snapshot([row(ECHO_ID, "owner", [])]), VARIANT, 1), {
    kind: "PENDING", provider_chat_id: "412", bot_message_id: null
  });
  assert.deepEqual(correlate(snapshot([
    row("bot-waiting", "bot", []), row("unrelated", "other", []), row(ECHO_ID, "owner", [])
  ]), "flux-kontext-pro", 0), {
    kind: "PENDING", provider_chat_id: "412", bot_message_id: "bot-waiting"
  });
});

test("closed history reason enum is duplicate-free and every result reason belongs to it", () => {
  assert.equal(new Set(OWNER_KONTEXT_IMAGE_HISTORY_INVALID_REASONS).size,
    OWNER_KONTEXT_IMAGE_HISTORY_INVALID_REASONS.length);
  const result = correlate(snapshot([row(ECHO_ID, "owner", [object("too-many", "image", VARIANT)])]), VARIANT, 0);
  assert.equal(result.kind, "INVALID");
  if (result.kind === "INVALID") assert.ok(OWNER_KONTEXT_IMAGE_HISTORY_INVALID_REASONS.includes(result.reason));
});

test("exact owner, bot, chat, pagination and object guards return the reason for the failed predicate", () => {
  const owner = row(ECHO_ID, "owner", [object("echo-image", "image", VARIANT)]);
  const bot = row("102", "bot", [object("result-image", "image", VARIANT)]);
  const valid = snapshot([owner, bot]);
  const invalidCases: Array<[unknown, string, number, string]> = [
    [snapshot([owner, bot], { complete: false }), VARIANT, 1, "PAGE_INCOMPLETE"],
    [snapshot([owner, bot], { page_size: 9 }), VARIANT, 1, "PAGE_INCOMPLETE"],
    [snapshot([owner, bot], { has_next: true }), VARIANT, 1, "PAGE_INCOMPLETE"],
    [snapshot([owner, bot], { has_previous: true }), VARIANT, 1, "PAGE_INCOMPLETE"],
    [snapshot([owner, bot], { requested_chat_uuid: "different-chat" }), VARIANT, 1, "REQUESTED_CHAT_MISMATCH"],
    [snapshot([owner, bot], { provider_chat_id: "0412" }), VARIANT, 1, "PROVIDER_CHAT_ID_INVALID"],
    [snapshot([owner, bot], { total_count: 3 }), VARIANT, 1, "TOTAL_COUNT_MISMATCH"],
    [snapshot([owner, bot], { total_pages: 2 }), VARIANT, 1, "TOTAL_PAGES_MISMATCH"],
    [snapshot([owner, row("102", "bot", [object("other-chat-object", "image", VARIANT)], "413")]), VARIANT, 1, "PROVIDER_CHAT_MISMATCH"],
    [snapshot([owner, owner]), VARIANT, 1, "DUPLICATE_MESSAGE_ID"],
    [snapshot([row(ECHO_ID, "author", []), bot]), VARIANT, 1, "AUTHOR_ROLE_INVALID"],
    [snapshot([row(ECHO_ID, "other", []), bot]), VARIANT, 1, "OWNER_ECHO_AUTHOR_MISMATCH"],
    [snapshot([bot]), VARIANT, 1, "OWNER_ECHO_MISSING"],
    [snapshot([owner, row("second-owner", "owner", []), bot]), VARIANT, 1, "OWNER_ECHO_AMBIGUOUS"],
    [snapshot([row(ECHO_ID, "owner", [object("r1", "image", VARIANT), object("r2", "image", VARIANT)]), bot]), VARIANT, 1, "OWNER_ECHO_OBJECT_INVALID"],
    [snapshot([row(ECHO_ID, "owner", [object("t1", "text", null), object("t2", "text", null)]), bot]), VARIANT, 1, "OWNER_ECHO_OBJECT_INVALID"],
    [snapshot([row(ECHO_ID, "owner", [object("video", "video", VARIANT)]), bot]), VARIANT, 1, "OWNER_ECHO_OBJECT_INVALID"],
    [snapshot([row(ECHO_ID, "owner", [object("wrong-model", "image", "flux-kontext-pro")]), bot]), VARIANT, 1, "OWNER_ECHO_OBJECT_INVALID"],
    [snapshot([owner, row("102", "bot", [object("echo-image", "image", VARIANT)])]), VARIANT, 1, "DUPLICATE_OBJECT_ID"],
    [snapshot([owner, row("102", "bot", [object("r1", "image", VARIANT), object("r2", "image", VARIANT)])]), VARIANT, 1, "BOT_OBJECT_CARDINALITY_INVALID"],
    [snapshot([owner, row("102", "bot", [object("text-result", "text", VARIANT)])]), VARIANT, 1, "BOT_OBJECT_INVALID"],
    [snapshot([owner, row("102", "bot", [object("wrong-model-result", "image", "flux-kontext-max")])]), VARIANT, 1, "BOT_OBJECT_INVALID"],
    [snapshot([owner, row("102", "bot", []), row("103", "bot", [])]), VARIANT, 1, "BOT_CANDIDATE_CARDINALITY_INVALID"]
  ];
  for (const [history, variant, referenceCount, expectedReason] of invalidCases) {
    const result = correlate(history, variant as OwnerKontextImageVariant, referenceCount);
    assert.deepEqual(result, { kind: "INVALID", reason: expectedReason });
  }
  assert.deepEqual(correlate(valid, "flux-kontext-pro", 2), { kind: "INVALID", reason: "INPUT_SCOPE_INVALID" });
  assert.deepEqual(correlate(valid, VARIANT, 1, { owner_echo_message_id: "different-ack" }), {
    kind: "INVALID", reason: "OWNER_ECHO_AUTHOR_MISMATCH"
  });
  assert.deepEqual(correlate(valid, "flux-kontext" as OwnerKontextImageVariant, 1), {
    kind: "INVALID", reason: "INPUT_SCOPE_INVALID"
  });
  const tooManyRows = snapshot(Array.from({ length: 11 }, (_, index) =>
    row(`other-${index}`, "other", [])));
  assert.deepEqual(correlate(tooManyRows), { kind: "INVALID", reason: "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID" });
  const tooManyObjects = Array.from({ length: 65 }, (_, index) => object(`object-${index}`, "text", null));
  assert.deepEqual(correlate(snapshot([row(ECHO_ID, "owner", tooManyObjects)])), {
    kind: "INVALID", reason: "OBJECT_LIST_SHAPE_OR_LIMIT_INVALID"
  });
});

test("correlator rejects copied, accessor, proxy, sparse and foreign-prototype inputs without mutation", () => {
  const owner = row(ECHO_ID, "owner", [object("echo-image", "image", VARIANT)]);
  const bot = row("102", "bot", [object("result-image", "image", VARIANT)]);
  const source = snapshot([owner, bot]);
  const result = correlate(source, VARIANT, 1);
  assert.equal(result.kind, "READY");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(JSON.stringify(result).includes("private"), false);
  source.messages[0] = row("mutated", "other", []);
  assert.equal(result.kind, "READY");

  const accessorSnapshot = snapshot([owner, bot]);
  let getterCalls = 0;
  Object.defineProperty(accessorSnapshot, "complete", {
    enumerable: true,
    get() { getterCalls += 1; return true; }
  });
  assert.deepEqual(correlate(accessorSnapshot, VARIANT, 1), { kind: "INVALID", reason: "SNAPSHOT_SHAPE_INVALID" });
  assert.equal(getterCalls, 0);
  assert.deepEqual(correlate(new Proxy({}, {}), VARIANT, 1), { kind: "INVALID", reason: "SNAPSHOT_SHAPE_INVALID" });
  assert.deepEqual(correlate(Object.assign(Object.create({ inherited: true }), source), VARIANT, 1), {
    kind: "INVALID", reason: "SNAPSHOT_SHAPE_INVALID"
  });
  const sparse = snapshot([owner, bot]);
  sparse.messages = new Array(2);
  assert.deepEqual(correlate(sparse, VARIANT, 1), { kind: "INVALID", reason: "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID" });
});

test("normalized history rows reject raw-author aliases, extra fields, accessors, proxies and array decorations", () => {
  const owner = row(ECHO_ID, "owner", []);
  const bot = row("102", "bot", []);
  const rawAuthor = { ...owner, author_id: 123 };
  assert.deepEqual(correlate(snapshot([rawAuthor, bot]), VARIANT, 1), {
    kind: "INVALID", reason: "ROW_SHAPE_INVALID"
  });
  const accessorRow = { ...owner };
  delete (accessorRow as { message_id?: string }).message_id;
  let getterCalls = 0;
  Object.defineProperty(accessorRow, "message_id", {
    enumerable: true,
    get() { getterCalls += 1; return ECHO_ID; }
  });
  assert.deepEqual(correlate(snapshot([accessorRow, bot]), VARIANT, 1), {
    kind: "INVALID", reason: "ROW_SHAPE_INVALID"
  });
  assert.equal(getterCalls, 0);
  assert.deepEqual(correlate(snapshot([new Proxy(owner, {}), bot]), VARIANT, 1), {
    kind: "INVALID", reason: "ROW_SHAPE_INVALID"
  });
  const objectArrayOwner = row(ECHO_ID, "owner", [object("owner-image", "image", VARIANT)]);
  objectArrayOwner.objects = new Proxy(objectArrayOwner.objects, {});
  assert.deepEqual(correlate(snapshot([objectArrayOwner, bot]), VARIANT, 1), {
    kind: "INVALID", reason: "OBJECT_LIST_SHAPE_OR_LIMIT_INVALID"
  });
  const decoratedMessages = [owner, bot] as unknown[] & { unexpected?: string };
  decoratedMessages.unexpected = "extra";
  assert.deepEqual(correlate(snapshot(decoratedMessages), VARIANT, 1), {
    kind: "INVALID", reason: "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID"
  });
  assert.deepEqual(correlate({ ...snapshot([owner, bot]), requested_chat_id: CHAT_UUID }, VARIANT, 1), {
    kind: "INVALID", reason: "SNAPSHOT_SHAPE_INVALID"
  });
});
