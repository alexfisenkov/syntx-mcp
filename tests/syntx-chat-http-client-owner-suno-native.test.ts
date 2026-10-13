import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  SyntxChatHttpClient,
  isOwnerSunoGenerationChatContext,
  isOwnerSunoGenerationResultMessageContext
} from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import { normalizeOwnerSunoGenerationParameters } from "../src/application/owner-suno-generation-parameters.js";
import { OwnerSunoGenerationRequestPreparer } from "../src/application/owner-suno-generation-request-preparer.js";
import { OwnerSunoGenerationOneShotPolicy } from "../src/application/owner-suno-generation-one-shot-policy.js";

const ATTEMPT = "link_suno_native_1071_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "suno-native-1071-tenant", subject: "suno-native-1071-owner" });
const PROMPT = "A short warm synthetic song";
const CREDENTIAL = "synthetic-suno-native-credential";
const stores = new Set<InMemoryAuthLinkStore>();

interface SunoNativeApi {
  createOwnerSunoGenerationChat(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  startSunoWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  listOwnedSunoGenerationCandidates(chat: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getOwnedSunoGenerationResult(context: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

function api(client: SyntxChatHttpClient): SunoNativeApi { return client as unknown as SunoNativeApi; }
function code(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected;
}

interface FixtureOptions {
  readonly modelId?: "V6" | "V6_wild";
  readonly isCustomMode?: boolean;
  readonly isInstrumental?: boolean;
  readonly loseAck?: boolean;
  readonly historyBody?: (chatUuid: string, ackId: string | null, page: number, modelId: string) => unknown;
  readonly resultBody?: (messageId: string, modelId: string) => unknown;
}

async function fixture(options: FixtureOptions = {}) {
  let now = Date.parse("2026-10-13T00:00:00.000Z");
  const modelId = options.modelId ?? "V6";
  const events: Array<{ method: string; pathname: string; query: string; body: unknown }> = [];
  let chatCount = 0, audioPosts = 0, historyGets = 0, resultGets = 0;
  let latestChatUuid = "", latestAck = "";
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-suno-native", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: CREDENTIAL });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(() => now);
  stores.add(store);
  const linkService = new PerUserLinkService(provider, store, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING);
  await linkService.issueHandoff(BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(BINDING, ATTEMPT)).status, "LINKED");
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return linkService.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
    }
  };
  const audioObjects = (messageId: string, prefix: string, count = 1, model = modelId) => Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`, message_id: messageId, object_type: "audio",
    object_url: `https://r2.syntx.ai/generated/${prefix}-${index + 1}.mp3`, completed: true, model_type: model,
    metadata: { duration: 9.5, task_id: "inert-metadata" }
  }));
  const history = (chatUuid: string, ackId: string | null, page: number) => options.historyBody?.(chatUuid, ackId, page, modelId) ?? ({
    messages: [
      { id: ackId ?? "suno-owner-ack-lost-response", chat_id: 9001, author_id: 42,
        message_object: [{ id: "suno-owner-text-object", message_id: ackId ?? "suno-owner-ack-lost-response",
          object_type: "text", object_text: PROMPT, model_type: modelId }] },
      { id: "suno-bot-message-1", chat_id: 9001, author_id: -1,
        message_object: audioObjects("suno-bot-message-1", "suno-audio-object") }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push({ method, pathname: url.pathname, query: url.search, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCount += 1;
      latestChatUuid = `owner-suno-audio-chat-${chatCount}`;
      return Response.json({ uuid: latestChatUuid });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      audioPosts += 1;
      latestAck = `suno-owner-ack-${audioPosts}`;
      if (options.loseAck) throw new Error("synthetic connection lost after Suno POST start");
      return Response.json({ id: latestAck });
    }
    if (url.pathname.endsWith("/messages") && method === "GET") {
      historyGets += 1;
      return Response.json(history(url.pathname.split("/")[4]!, latestAck || null, Number(url.searchParams.get("page"))));
    }
    const message = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (message && method === "GET") {
      resultGets += 1;
      return Response.json(options.resultBody?.(message[2]!, modelId) ?? { id: message[2], chat_id: 9001, author_id: -1,
        message_object: audioObjects(message[2]!, "suno-audio-object"),
        created_at: "2026-10-13T00:00:00Z", is_favorite: false });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const preparer = new OwnerSunoGenerationRequestPreparer({ binding: BINDING, linkService, now: () => now });
  const oneShotPolicy = new OwnerSunoGenerationOneShotPolicy({ preparer, now: () => now });
  const normalized = normalizeOwnerSunoGenerationParameters({ model_id: modelId, mode: "generate", prompt: PROMPT,
    is_custom_mode: options.isCustomMode ?? false, is_instrumental: options.isInstrumental ?? true,
    negative_tags: "noise", styles: "minimal", title: "Synthetic test" });
  const candidate = await preparer.prepare({ attemptId: ATTEMPT, normalized });
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService });
  const permit = oneShotPolicy.createPermit({ candidate, attemptId: ATTEMPT, principal });
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const otherClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  return {
    client, native: api(client), otherClient, otherNative: api(otherClient), candidate, permit, preparer, oneShotPolicy, principal,
    get now() { return now; }, set now(value: number) { now = value; },
    get events() { return events; },
    get counts() { return { chats: chatCount, posts: audioPosts, history: historyGets, results: resultGets }; },
    get latestChatUuid() { return latestChatUuid; },
    async close() { oneShotPolicy.close(); preparer.close(); }
  };
}

async function createChat(f: Awaited<ReturnType<typeof fixture>>) {
  return f.native.createOwnerSunoGenerationChat({ candidate: f.candidate, permit: f.permit,
    preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
}
async function start(f: Awaited<ReturnType<typeof fixture>>, chat: Record<string, unknown>) {
  return f.native.startSunoWithOwnedCandidate({ chat, candidate: f.candidate, permit: f.permit,
    preparer: f.preparer, oneShotPolicy: f.oneShotPolicy, principal: f.principal, attemptId: ATTEMPT });
}

afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

test("SyntxChatHttpClient exposes the four purpose-built owner Suno methods", () => {
  for (const method of ["createOwnerSunoGenerationChat", "startSunoWithOwnedCandidate",
    "listOwnedSunoGenerationCandidates", "getOwnedSunoGenerationResult"]) {
    assert.equal(typeof (SyntxChatHttpClient.prototype as unknown as Record<string, unknown>)[method], "function");
  }
});

test("native owner path creates one audio chat and sends the exact private Suno body with empty file_urls", async () => {
  const f = await fixture({ modelId: "V6_wild", isCustomMode: true, isInstrumental: false });
  try {
    const chat = await createChat(f);
    assert.equal(chat.chat_uuid, "owner-suno-audio-chat-1");
    assert.equal(chat.model_id, "V6_wild");
    assert.equal(chat.dispatch_allowed, false);
    assert.equal(chat.backend_acceptance, "UNPROVEN");
    assert.equal(isOwnerSunoGenerationChatContext(chat, f.client), true);
    assert.equal(isOwnerSunoGenerationChatContext(chat, f.otherClient), false);
    const result = await start(f, chat);
    assert.deepEqual(result, { chat_uuid: "owner-suno-audio-chat-1", message_id: "suno-owner-ack-1" });
    const creates = f.events.filter(({ pathname }) => pathname === "/api/v1/chats");
    assert.deepEqual(creates.map(({ method, body }) => ({ method, body })), [{ method: "POST", body: {
      scope: "audio", title: (creates[0]?.body as { title?: string } | undefined)?.title
    } }]);
    assert.match(String((creates[0]?.body as { title?: unknown } | undefined)?.title), /^owner-suno-generation-/u);
    assert.deepEqual(f.events.filter(({ pathname }) => pathname === "/api/v1/audio/generate").map(({ method, query, body }) =>
      ({ method, query, body })), [{ method: "POST", query: "?ai_name=suno", body: {
        chat_uuid: chat.chat_uuid, prompt: PROMPT, settings: { model_type: "V6_wild", mode: "generate",
          is_custom_mode: true, is_instrumental: false, negative_tags: "noise", styles: "minimal", title: "Synthetic test",
          file_urls: [] }
      } }]);
    assert.equal(JSON.stringify(chat).includes("file_urls"), false);
    await assert.rejects(start(f, chat), (error: unknown) => code(error, "CHAT_DISPATCH_ALREADY_STARTED"));
    assert.equal(f.counts.chats, 1);
    assert.equal(f.counts.posts, 1);
  } finally { await f.close(); }
});

test("native generation preserves both supported model IDs and all explicit boolean combinations", async () => {
  for (const modelId of ["V6", "V6_wild"] as const) {
    for (const isCustomMode of [false, true]) {
      for (const isInstrumental of [false, true]) {
        const f = await fixture({ modelId, isCustomMode, isInstrumental });
        try {
          const chat = await createChat(f);
          await start(f, chat);
          const request = f.events.find(({ pathname }) => pathname === "/api/v1/audio/generate")?.body as {
            settings: Record<string, unknown>;
          } | undefined;
          assert.equal(request?.settings.model_type, modelId);
          assert.equal(request?.settings.is_custom_mode, isCustomMode);
          assert.equal(request?.settings.is_instrumental, isInstrumental);
          assert.deepEqual(request?.settings.file_urls, []);
          assert.equal(f.counts.posts, 1);
        } finally { await f.close(); }
      }
    }
  }
});

test("lost POST ACK stays reserved and exact owner history recovery is GET-only after input expiry", async () => {
  const f = await fixture({ loseAck: true });
  try {
    const chat = await createChat(f);
    await assert.rejects(start(f, chat), (error: unknown) => code(error, "OUTCOME_UNKNOWN"));
    f.now += 15 * 60_000 + 1;
    await assert.rejects(start(f, chat), (error: unknown) => code(error, "CHAT_DISPATCH_ALREADY_STARTED"));
    const history = await f.native.listOwnedSunoGenerationCandidates(chat);
    assert.equal(history.owner_ack_status, "MATCHED");
    assert.equal(history.history_binding_status, "BOUND");
    assert.equal(history.history_page_status, "COMPLETE");
    assert.equal(history.backend_acceptance, "UNPROVEN");
    assert.equal((history.contexts as unknown[]).length, 1);
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.history, 1);
    assert.equal(f.events.filter(({ method }) => method === "POST").length, 2); // chat-create plus one generate POST
  } finally { await f.close(); }
});

test("only a minted same-client result context can read a bound Suno result", async () => {
  const f = await fixture();
  try {
    const chat = await createChat(f);
    await start(f, chat);
    const history = await f.native.listOwnedSunoGenerationCandidates(chat);
    const context = (history.contexts as unknown[])[0];
    assert.equal(isOwnerSunoGenerationResultMessageContext(context, f.client), true);
    assert.equal(isOwnerSunoGenerationResultMessageContext(context, f.otherClient), false);
    await assert.rejects(f.otherNative.getOwnedSunoGenerationResult(context),
      (error: unknown) => code(error, "RESULT_CONTEXT_INVALID"));
    const revoked = Proxy.revocable(context as object, {});
    revoked.revoke();
    await assert.rejects(f.native.getOwnedSunoGenerationResult(revoked.proxy),
      (error: unknown) => code(error, "RESULT_CONTEXT_INVALID"));
    const decoded = await f.native.getOwnedSunoGenerationResult(context);
    assert.equal(decoded.message_binding, "BOUND");
    assert.equal(decoded.model_echo, "MATCHED");
    assert.equal((decoded.ready_audio as unknown[]).length, 1);
    assert.equal(decoded.backend_acceptance, "UNPROVEN");
    assert.equal(f.counts.results, 1);
  } finally { await f.close(); }
});

test("all 80 audio objects in two observed bot messages stay available through two bounded result GETs", async () => {
  const objectRows = (messageId: string, prefix: string) => Array.from({ length: 40 }, (_, index) => ({
    id: `${prefix}-${index + 1}`, message_id: messageId, object_type: "audio",
    object_url: `https://r2.syntx.ai/generated/${prefix}-${index + 1}.mp3`, completed: true, model_type: "V6",
    metadata: { duration: 12.5, task_id: `inert-${index}` }
  }));
  const f = await fixture({
    historyBody: (_chatUuid, ackId) => ({ messages: [
      { id: ackId!, chat_id: 9001, author_id: 42, message_object: [{ id: "suno-owner-text", message_id: ackId!,
        object_type: "text", object_text: PROMPT, model_type: "V6" }] },
      { id: "suno-bot-message-a", chat_id: 9001, author_id: -1, message_object: objectRows("suno-bot-message-a", "suno-a") },
      { id: "suno-bot-message-b", chat_id: 9001, author_id: -1, message_object: objectRows("suno-bot-message-b", "suno-b") }
    ], pagination: { page: 1, page_size: 10, total_count: 3, total_pages: 1, has_next: false, has_previous: false } }),
    resultBody: (messageId) => ({ id: messageId, chat_id: 9001, author_id: -1,
      message_object: objectRows(messageId, messageId === "suno-bot-message-a" ? "suno-a" : "suno-b"),
      created_at: "2026-10-13T00:00:00Z", is_favorite: false })
  });
  try {
    const chat = await createChat(f);
    await start(f, chat);
    const history = await f.native.listOwnedSunoGenerationCandidates(chat);
    const contexts = history.contexts as unknown[];
    assert.equal(contexts.length, 2);
    assert.deepEqual(contexts.map((context) => (context as { message_object_ids: string[] }).message_object_ids.length), [40, 40]);
    const results = await Promise.all(contexts.map((context) => f.native.getOwnedSunoGenerationResult(context)));
    assert.deepEqual(results.map((result) => (result.ready_audio as unknown[]).length), [40, 40]);
    assert.equal(results.reduce((sum, result) => sum + (result.ready_audio as unknown[]).length, 0), 80);
    assert.equal(f.counts.results, 2);
    assert.equal(f.counts.posts, 1);
  } finally { await f.close(); }
});

test("ambiguous exact owner prompt/model ACK does not mint a result context", async () => {
  const f = await fixture({ loseAck: true, historyBody: (_chatUuid, ackId) => ({ messages: [
    ...[ackId ?? "suno-owner-ack-lost-response", "suno-duplicate-owner-ack"].map((id) => ({ id, chat_id: 9001, author_id: 42,
      message_object: [{ id: `${id}-text`, message_id: id, object_type: "text", object_text: PROMPT, model_type: "V6" }] })),
    { id: "suno-bot-message-1", chat_id: 9001, author_id: -1,
      message_object: [{ id: "suno-audio-object-1", message_id: "suno-bot-message-1", object_type: "audio",
        object_url: "https://r2.syntx.ai/generated/test.mp3", completed: true, model_type: "V6" }] }
  ], pagination: { page: 1, page_size: 10, total_count: 3, total_pages: 1, has_next: false, has_previous: false } }) });
  try {
    const chat = await createChat(f);
    await assert.rejects(start(f, chat));
    const history = await f.native.listOwnedSunoGenerationCandidates(chat);
    assert.equal(history.owner_ack_status, "AMBIGUOUS");
    assert.equal((history.contexts as unknown[]).length, 0);
    assert.equal(f.counts.posts, 1);
    assert.equal(f.counts.results, 0);
  } finally { await f.close(); }
});
