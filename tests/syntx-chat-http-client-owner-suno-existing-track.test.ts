import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  SyntxChatHttpClient,
  isOwnerSunoExistingTrackChatContext,
  isOwnerSunoExistingTrackResultMessageContext
} from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";

const ATTEMPT = "link_suno_existing_1325_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "suno-existing-1325-tenant", subject: "suno-existing-1325-owner" });
const CREDENTIAL = "synthetic-suno-existing-credential";
const GENERATION_TITLE = "owner-suno-generation-01234567-89ab-4def-8123-456789abcdef";
const OPERATION_TITLE = "owner-suno-track-operation-01234567-89ab-4def-8123-456789abcdef";
const stores = new Set<InMemoryAuthLinkStore>();

interface ExistingTrackNativeApi {
  listOwnedSunoExistingTrackChats(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  listOwnedSunoExistingTrackCandidates(context: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getOwnedSunoExistingTrackResult(context: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getOwnedSunoExistingTrackMetadata(context: unknown): readonly Record<string, unknown>[];
}

function api(client: SyntxChatHttpClient): ExistingTrackNativeApi { return client as unknown as ExistingTrackNativeApi; }
function code(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected;
}

interface FixtureOptions {
  readonly numericIds?: boolean;
  readonly indexHasUnknownArrays?: boolean;
  readonly indexPage?: (page: number) => unknown;
  readonly historyPage?: (chatUuid: string, page: number) => unknown;
  readonly result?: (chatUuid: string, messageId: string) => unknown;
}

async function fixture(options: FixtureOptions = {}) {
  const events: Array<{ method: string; pathname: string; query: string }> = [];
  let indexGets = 0, historyGets = 0, resultGets = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-suno-existing", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: CREDENTIAL });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(() => 1_797_000_000_000);
  stores.add(store);
  const linkService = new PerUserLinkService(provider, store, { now: () => 1_797_000_000_000,
    attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING);
  await linkService.issueHandoff(BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(BINDING, ATTEMPT)).status, "LINKED");
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return linkService.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
    }
  };
  const uuidA = "owner-suno-chat-a-1325";
  const uuidB = "owner-suno-chat-b-1325";
  const messageId: string | number = options.numericIds ? 501 : "suno-existing-bot-message";
  const objectIds = options.numericIds ? [601, 602] : ["suno-existing-object-short", "suno-existing-object-long"];
  const pageIndex = (page: number) => options.indexPage?.(page) ?? ({
    chats: page === 1 ? [
      { id: 9001, uuid: uuidA, scope: "audio", title: OPERATION_TITLE, created_at: "date", updated_at: "date", message_count: 2,
        unknown_index_field_a: "not-traversed" },
      { id: 9002, uuid: uuidB, scope: "audio", title: GENERATION_TITLE, created_at: "date", updated_at: "date", message_count: 2 }
    ] : [],
    pagination: { page, page_size: 20, total_count: page === 1 ? 2 : 0, total_pages: 1, has_next: false, has_previous: page > 1,
      unknown_pagination_field_a: "ignored" }
  });
  const audioObject = (index: number, id: string | number, resultMessageId: string | number) => ({
    id, message_id: resultMessageId, object_type: "audio", model_type: "V6_wild",
    object_text: "", object_url: `https://r2.syntx.ai/audio/${index === 0 ? "short" : "long"}.mp3`, completed: true,
    metadata: { payload: { clip_id: `clip-${index}`, task_id: `task-${index}`, unknown_payload_field: "ignored" },
      unknown_metadata_field: "ignored" }
  });
  const pageHistory = (chatUuid: string, page: number) => options.historyPage?.(chatUuid, page) ?? ({
    messages: page === 1 ? [
      { id: 401, chat_id: chatUuid === uuidA ? 9001 : 9002, author_id: 42,
        message_object: [{ id: 411, message_id: 401, object_type: "text", model_type: "V6_wild",
          object_text: "private synthetic source prompt", object_url: "", completed: true,
          metadata: { payload: { unknown_payload_field: "ignored" }, unknown_metadata_field: "ignored" } }] },
      { id: messageId, chat_id: chatUuid === uuidA ? 9001 : 9002, author_id: -1,
        message_object: objectIds.map((id, index) => audioObject(index, id, messageId)) }
    ] : [],
    pagination: { page, page_size: 10, total_count: page === 1 ? 2 : 0, total_pages: 1, has_next: false, has_previous: false,
      unknown_pagination_field_b: "ignored" }
  });
  const resultBody = (chatUuid: string, resultMessageId: string) => options.result?.(chatUuid, resultMessageId) ?? ({
    id: options.numericIds ? 501 : resultMessageId,
    chat_id: chatUuid === uuidA ? 9001 : 9002,
    author_id: -1,
    message_object: objectIds.map((id, index) => audioObject(index, id, options.numericIds ? 501 : resultMessageId)),
    created_at: "date", unknown_result_field: "ignored"
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    events.push({ method, pathname: url.pathname, query: url.search });
    if (url.pathname === "/api/v1/chats" && method === "GET") {
      indexGets += 1;
      return Response.json(options.indexHasUnknownArrays === true
        ? { ...pageIndex(Number(url.searchParams.get("page"))), items: [] }
        : pageIndex(Number(url.searchParams.get("page"))));
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      historyGets += 1;
      return Response.json(pageHistory(history[1]!, Number(url.searchParams.get("page"))));
    }
    const resultMatch = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (resultMatch && method === "GET") {
      resultGets += 1;
      return Response.json(resultBody(resultMatch[1]!, resultMatch[2]!));
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const otherClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService });
  return { client, otherClient, native: api(client), otherNative: api(otherClient), principal,
    get events() { return events; }, get counts() { return { indexGets, historyGets, resultGets }; } };
}

afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

test("existing Suno tracks are read with exact bounded GET routes and preserve each audio object's source association", async () => {
  const f = await fixture();
  const page = await f.native.listOwnedSunoExistingTrackChats({ attemptId: ATTEMPT, principal: f.principal, page: 1 });
  try {
    assert.equal(page.page, 1);
    assert.equal(page.page_size, 20);
    assert.equal(page.has_next, false);
    assert.equal((page.chats as unknown[]).length, 2);
    const chat = (page.chats as unknown[])[0];
    assert.equal(isOwnerSunoExistingTrackChatContext(chat, f.client), true);
    assert.equal(isOwnerSunoExistingTrackChatContext({ ...(chat as object) }, f.client), false);
    const listed = await f.native.listOwnedSunoExistingTrackCandidates(chat);
    assert.equal(listed.owner_ack_status, "MATCHED");
    assert.equal(listed.status, "COMPLETE");
    assert.equal((listed.contexts as unknown[]).length, 1);
    const context = (listed.contexts as unknown[])[0];
    assert.equal(isOwnerSunoExistingTrackResultMessageContext(context, f.client), true);
    assert.equal(isOwnerSunoExistingTrackResultMessageContext(context, f.otherClient), false);
    const result = await f.native.getOwnedSunoExistingTrackResult(context);
    const decoded = result.audio_result as { message_binding: string; model_echo: string; ready_audio: unknown[] };
    assert.equal(decoded.message_binding, "BOUND");
    assert.equal(decoded.model_echo, "MATCHED");
    assert.equal(decoded.ready_audio.length, 2);
    assert.deepEqual(f.native.getOwnedSunoExistingTrackMetadata(context), [
      { object_index: 0, message_object_id: "suno-existing-object-short", object_url: "https://r2.syntx.ai/audio/short.mp3",
        clip_id: "clip-0", task_id: "task-0", model_id: "V6_wild" },
      { object_index: 1, message_object_id: "suno-existing-object-long", object_url: "https://r2.syntx.ai/audio/long.mp3",
        clip_id: "clip-1", task_id: "task-1", model_id: "V6_wild" }
    ]);
    assert.equal(f.counts.indexGets, 1);
    assert.equal(f.counts.historyGets, 1);
    assert.equal(f.counts.resultGets, 1);
    assert.deepEqual(f.events.map(({ method, pathname }) => [method, pathname]), [
      ["GET", "/api/v1/chats"], ["GET", "/api/v1/chats/owner-suno-chat-a-1325/messages"],
      ["GET", "/api/v1/chats/owner-suno-chat-a-1325/suno-existing-bot-message"]
    ]);
  } finally { for (const store of stores) store.close(); stores.clear(); }
});

test("existing-track native contexts reject clones, foreign clients, and proxies without another GET", async () => {
  const f = await fixture();
  try {
    const page = await f.native.listOwnedSunoExistingTrackChats({ attemptId: ATTEMPT, principal: f.principal, page: 1 });
    const chat = (page.chats as unknown[])[0];
    await assert.rejects(f.native.listOwnedSunoExistingTrackCandidates({ ...(chat as object) }),
      (error: unknown) => code(error, "CHAT_CONTEXT_INVALID"));
    const history = await f.native.listOwnedSunoExistingTrackCandidates(chat);
    const context = (history.contexts as unknown[])[0] as object;
    await assert.rejects(f.otherNative.getOwnedSunoExistingTrackResult(context),
      (error: unknown) => code(error, "RESULT_CONTEXT_INVALID"));
    await assert.rejects(f.native.getOwnedSunoExistingTrackResult(new Proxy(context, {})),
      (error: unknown) => code(error, "RESULT_CONTEXT_INVALID"));
    assert.equal(f.counts.resultGets, 0);
  } finally { for (const store of stores) store.close(); stores.clear(); }
});

test("numeric provider IDs normalize before the exact history-to-result object join", async () => {
  const f = await fixture({ numericIds: true });
  try {
    const page = await f.native.listOwnedSunoExistingTrackChats({ attemptId: ATTEMPT, principal: f.principal, page: 1 });
    const history = await f.native.listOwnedSunoExistingTrackCandidates((page.chats as unknown[])[0]);
    const context = (history.contexts as unknown[])[0];
    await f.native.getOwnedSunoExistingTrackResult(context);
    const artifacts = f.native.getOwnedSunoExistingTrackMetadata(context);
    assert.equal(artifacts.length, 2);
    assert.equal(artifacts[0]?.message_object_id, "601");
    assert.equal(artifacts[1]?.message_object_id, "602");
    assert.equal(f.counts.resultGets, 1);
  } finally { for (const store of stores) store.close(); stores.clear(); }
});

test("ambiguous index envelopes and inconsistent pagination fail before history reads", async () => {
  const f = await fixture({ indexHasUnknownArrays: true });
  try {
    await assert.rejects(f.native.listOwnedSunoExistingTrackChats({ attemptId: ATTEMPT, principal: f.principal, page: 1 }),
      (error: unknown) => code(error, "INDEX_UNVERIFIED"));
    assert.equal(f.counts.indexGets, 1);
    assert.equal(f.counts.historyGets, 0);
  } finally { for (const store of stores) store.close(); stores.clear(); }
});

test("a foreign provider chat id prevents history candidates from being branded", async () => {
  const f = await fixture({ historyPage: (_chatUuid) => ({
    messages: [{ id: 401, chat_id: 9999, author_id: 42,
      message_object: [{ id: 411, message_id: 401, object_type: "text", model_type: "V6_wild", object_text: "synthetic",
        object_url: "", completed: true, metadata: { payload: {} } }] },
    { id: 501, chat_id: 9999, author_id: -1, message_object: [{ id: 601, message_id: 501, object_type: "audio",
      model_type: "V6_wild", object_text: "", object_url: "https://r2.syntx.ai/audio/a.mp3", completed: true,
      metadata: { payload: { clip_id: "clip", task_id: "task" } } }] }],
    pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
  }) });
  try {
    const page = await f.native.listOwnedSunoExistingTrackChats({ attemptId: ATTEMPT, principal: f.principal, page: 1 });
    await assert.rejects(f.native.listOwnedSunoExistingTrackCandidates((page.chats as unknown[])[0]),
      (error: unknown) => code(error, "HISTORY_UNVERIFIED"));
    assert.equal(f.counts.resultGets, 0);
  } finally { for (const store of stores) store.close(); stores.clear(); }
});

test("a consistent empty owned history returns a bounded non-ready gap receipt", async () => {
  const f = await fixture({ historyPage: (_chatUuid, page) => ({
    messages: [],
    pagination: { page, page_size: 10, total_count: 0, total_pages: 0, has_next: false, has_previous: false }
  }) });
  try {
    const page = await f.native.listOwnedSunoExistingTrackChats({ attemptId: ATTEMPT, principal: f.principal, page: 1 });
    const listed = await f.native.listOwnedSunoExistingTrackCandidates((page.chats as unknown[])[0]);
    assert.equal(listed.status, "INCOMPLETE");
    assert.equal(listed.owner_ack_status, "MISSING");
    assert.deepEqual(listed.contexts, []);
    assert.deepEqual(listed.gaps, ["OWNER_ACK_MISSING"]);
    assert.equal(listed.history_get_calls, 1);
    assert.equal(listed.total_count, 0);
    assert.equal(listed.total_pages, 0);
    assert.equal(listed.provider_chat_id, "9001");
    assert.equal(f.counts.resultGets, 0);
  } finally { for (const store of stores) store.close(); stores.clear(); }

  const inconsistent = await fixture({ historyPage: (_chatUuid, page) => ({
    messages: [],
    pagination: { page, page_size: 10, total_count: 0, total_pages: 1, has_next: false, has_previous: false }
  }) });
  try {
    const page = await inconsistent.native.listOwnedSunoExistingTrackChats({
      attemptId: ATTEMPT, principal: inconsistent.principal, page: 1
    });
    await assert.rejects(inconsistent.native.listOwnedSunoExistingTrackCandidates((page.chats as unknown[])[0]),
      (error: unknown) => code(error, "HISTORY_UNVERIFIED"));
    assert.equal(inconsistent.counts.historyGets, 1);
    assert.equal(inconsistent.counts.resultGets, 0);
  } finally { for (const store of stores) store.close(); stores.clear(); }
});
