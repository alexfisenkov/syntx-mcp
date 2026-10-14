import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";

const ATTEMPT = "link_sts_existing_1474_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "sts-existing-1474-tenant", subject: "sts-existing-1474-owner" });
const CHAT_UUID = "sts-existing-chat-1474";
const CHAT_TITLE = "owner-elevenlabs-sts-12345678-1234-4abc-8def-123456789abc";
const OUTPUT_URL = "https://r2.syntx.ai/private/existing-sts-output.mp3";
const stores = new Set<InMemoryAuthLinkStore>();

function json(value: unknown): Response { return Response.json(value); }
function code(error: unknown, expected: string): boolean { return error instanceof Error && "code" in error && error.code === expected; }
function broker(linkService: PerUserLinkService): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return linkService.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
  } };
}

async function fixture(options: { ownerKind?: "audio" | "text" | "input_audio"; botModel?: string; pending?: boolean;
  indexTotal?: number; historyTotal?: number; ownerDuplicates?: boolean; ownerInputAudioForeignModel?: boolean;
  indexDuplicate?: "uuid" | "provider" } = {}) {
  const events: Array<{ method: string; path: string; query: string }> = [];
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-sts-existing", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-sts-existing-credential" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => 1_797_000_000_000); stores.add(store);
  const linkService = new PerUserLinkService(provider, store, { now: () => 1_797_000_000_000, attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING); await linkService.issueHandoff(BINDING, ATTEMPT); await linkService.checkAttempt(BINDING, ATTEMPT);
  const emptyPage = (page: number) => ({ chats: [], pagination: { page, page_size: 20, total_count: 0, total_pages: 0, has_next: false, has_previous: page > 1 } });
  const ownerKind = options.ownerKind ?? "audio";
  const ownerObject = ownerKind === "text" ? { id: "owner-obj", message_id: "owner-message", object_type: "text", model_type: "eleven_multilingual_sts_v2", object_text: "" }
    : ownerKind === "input_audio" ? { id: "owner-obj", message_id: "owner-message", object_type: "input_audio",
      model_type: options.ownerInputAudioForeignModel ? "eleven_turbo_v2_5" : "eleven_multilingual_sts_v2" }
      : { id: "owner-obj", message_id: "owner-message", object_type: "audio", model_type: "eleven_multilingual_sts_v2" };
  const botObject = { id: "bot-obj", message_id: "bot-message", object_type: "audio", model_type: options.botModel ?? "eleven_multilingual_sts_v2",
    completed: options.pending !== true };
  const history = (page: number) => ({ messages: page === 1 ? [
    { id: "owner-message", chat_id: 8101, author_id: 17, message_object: [ownerObject] },
    ...(options.ownerDuplicates ? [{ id: "owner-message-2", chat_id: 8101, author_id: 18, message_object: [
      { id: "owner-obj-2", message_id: "owner-message-2", object_type: "text", model_type: "eleven_multilingual_sts_v2", object_text: "echo" }
    ] }] : []),
    { id: "bot-message", chat_id: 8101, author_id: -1, message_object: [botObject] }
  ] : [], pagination: { page, page_size: 10, total_count: options.historyTotal ?? 2,
    total_pages: Math.ceil((options.historyTotal ?? 2) / 10), has_next: false, has_previous: page > 1 } });
  const client = new SyntxChatHttpClient({ credentialBroker: broker(linkService), fetchImpl: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET"; events.push({ method, path: url.pathname, query: url.search });
    if (url.pathname === "/api/v1/chats" && method === "GET") {
      const page = Number(url.searchParams.get("page"));
      if (page !== 1) return json(emptyPage(page));
      if (options.indexTotal !== undefined) return json({ chats: [{ id: 8101, uuid: CHAT_UUID, scope: "audio", title: CHAT_TITLE }],
        pagination: { page, page_size: 20, total_count: options.indexTotal, total_pages: Math.ceil(options.indexTotal / 20),
          has_next: page < Math.ceil(options.indexTotal / 20), has_previous: page > 1 } });
      if (options.indexDuplicate) return json({ chats: [
        { id: 8101, uuid: CHAT_UUID, scope: "audio", title: CHAT_TITLE },
        { id: options.indexDuplicate === "provider" ? 8101 : 8103,
          uuid: options.indexDuplicate === "uuid" ? CHAT_UUID : "sts-existing-chat-duplicate", scope: "audio", title: CHAT_TITLE }
      ], pagination: { page, page_size: 20, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
      return json({ chats: [{ id: 8101, uuid: CHAT_UUID, scope: "audio", title: CHAT_TITLE },
        { id: 8102, uuid: "foreign-chat", scope: "audio", title: "owner-elevenlabs-sts-not-a-uuid" }],
        pagination: { page, page_size: 20, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/messages` && method === "GET") return json(history(Number(url.searchParams.get("page"))));
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/bot-message` && method === "GET") return json({ id: "bot-message", chat_id: 8101, author_id: -1,
      message_object: [{ id: "bot-obj", object_type: "audio", object_url: OUTPUT_URL, completed: true,
        model_type: "eleven_multilingual_sts_v2" }] });
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  } });
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService });
  return { client, linkService, principal, events };
}
afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

test("1474 binds exact indexed STS chat, complete owner history and exact decoded result with GET-only routes", async () => {
  const f = await fixture();
  const page = await f.client.listOwnedElevenLabsStsExistingChats({ attemptId: ATTEMPT, principal: f.principal, binding: BINDING,
    linkService: f.linkService, page: 1 });
  assert.equal(page.page_size, 20); assert.equal(page.chats.length, 1);
  assert.equal(page.chats[0]?.source_kind, "EXISTING_OWNER_STS_CHAT");
  assert.equal(JSON.stringify(page).includes(CHAT_TITLE), false);
  const history = await f.client.listOwnedElevenLabsStsExistingCandidates(page.chats[0]);
  assert.equal(history.status, "COMPLETE"); assert.equal(history.owner_ack_status, "MATCHED"); assert.equal(history.contexts.length, 1);
  const result = await f.client.getOwnedElevenLabsStsExistingResult(history.contexts[0]);
  assert.equal(result.message_binding, "BOUND"); assert.equal(result.model_echo, "MATCHED");
  assert.equal(result.ready_audio[0]?.object_url, OUTPUT_URL);
  assert.deepEqual(f.events.map((event) => [event.method, event.path, event.query]), [
    ["GET", "/api/v1/chats", "?scope=audio&page=1&page_size=20"],
    ["GET", `/api/v1/chats/${CHAT_UUID}/messages`, "?page=1&page_size=10"],
    ["GET", `/api/v1/chats/${CHAT_UUID}/bot-message`, ""]
  ]);
});

test("1474 exact STS owner ACK accepts text or input-audio without requiring nonblank text", async () => {
  for (const ownerKind of ["text", "input_audio"] as const) {
    const f = await fixture({ ownerKind });
    const page = await f.client.listOwnedElevenLabsStsExistingChats({ attemptId: ATTEMPT, principal: f.principal, binding: BINDING,
      linkService: f.linkService, page: 1 });
    const history = await f.client.listOwnedElevenLabsStsExistingCandidates(page.chats[0]);
    assert.equal(history.owner_ack_status, "MATCHED"); assert.equal(history.contexts.length, 1);
  }
});

test("1474 incomplete index pagination and incomplete history never mint result contexts", async () => {
  const f = await fixture({ indexTotal: 21 });
  await assert.rejects(f.client.listOwnedElevenLabsStsExistingChats({ attemptId: ATTEMPT, principal: f.principal, binding: BINDING,
    linkService: f.linkService, page: 1 }), (error: unknown) => code(error, "INDEX_UNAVAILABLE"));
  assert.equal(f.events.length, 1);
  const g = await fixture({ historyTotal: 21 });
  const page = await g.client.listOwnedElevenLabsStsExistingChats({ attemptId: ATTEMPT, principal: g.principal, binding: BINDING,
    linkService: g.linkService, page: 1 });
  // The history fixture reports 21 rows while returning only two, so history is incomplete.
  const pending = await g.client.listOwnedElevenLabsStsExistingCandidates(page.chats[0]);
  assert.equal(pending.status, "UNVERIFIED"); assert.equal(pending.contexts.length, 0);
});

test("1474 rejects foreign client and forged helper packets without making another request", async () => {
  const f = await fixture();
  const page = await f.client.listOwnedElevenLabsStsExistingChats({ attemptId: ATTEMPT, principal: f.principal, binding: BINDING,
    linkService: f.linkService, page: 1 });
  const history = await f.client.listOwnedElevenLabsStsExistingCandidates(page.chats[0]);
  const foreign = new SyntxChatHttpClient({ credentialBroker: broker(f.linkService), fetchImpl: async () => { throw new Error("unexpected GET"); } });
  await assert.rejects(foreign.getOwnedElevenLabsStsExistingResult(history.contexts[0]), (error: unknown) => code(error, "CONTEXT_INVALID"));
  const helpers = await import("../src/adapter/syntx/owner-elevenlabs-sts-existing-media.js");
  await assert.rejects(helpers.getOwnedElevenLabsStsExistingResult(history.contexts[0], { client: f.client,
    get: async () => ({ id: "forged" }) }));
  assert.equal(f.events.length, 2);
});

test("1474 rejects owner/model ambiguity and pending bot output", async () => {
  const foreignModel = await fixture({ botModel: "eleven_turbo_v2_5" });
  const page = await foreignModel.client.listOwnedElevenLabsStsExistingChats({ attemptId: ATTEMPT, principal: foreignModel.principal,
    binding: BINDING, linkService: foreignModel.linkService, page: 1 });
  const rejected = await foreignModel.client.listOwnedElevenLabsStsExistingCandidates(page.chats[0]);
  assert.equal(rejected.contexts.length, 0); assert.ok(rejected.gaps.includes("BOT_RESULT_MISSING"));
  const pending = await fixture({ pending: true });
  const pendingPage = await pending.client.listOwnedElevenLabsStsExistingChats({ attemptId: ATTEMPT, principal: pending.principal,
    binding: BINDING, linkService: pending.linkService, page: 1 });
  const pendingHistory = await pending.client.listOwnedElevenLabsStsExistingCandidates(pendingPage.chats[0]);
  assert.equal(pendingHistory.contexts.length, 0); assert.ok(pendingHistory.gaps.includes("BOT_RESULT_MISSING"));
  assert.equal(pending.events.length, 2);
  const ambiguous = await fixture({ ownerDuplicates: true, historyTotal: 3 });
  const ambiguousPage = await ambiguous.client.listOwnedElevenLabsStsExistingChats({ attemptId: ATTEMPT, principal: ambiguous.principal,
    binding: BINDING, linkService: ambiguous.linkService, page: 1 });
  const ambiguousHistory = await ambiguous.client.listOwnedElevenLabsStsExistingCandidates(ambiguousPage.chats[0]);
  assert.equal(ambiguousHistory.owner_ack_status, "AMBIGUOUS"); assert.equal(ambiguousHistory.contexts.length, 0);
});

test("1474 duplicate index UUID or provider chat ID rejects the page before minting contexts", async () => {
  for (const indexDuplicate of ["uuid", "provider"] as const) {
    const f = await fixture({ indexDuplicate });
    await assert.rejects(f.client.listOwnedElevenLabsStsExistingChats({ attemptId: ATTEMPT, principal: f.principal,
      binding: BINDING, linkService: f.linkService, page: 1 }), (error: unknown) => code(error, "INDEX_UNAVAILABLE"));
    assert.equal(f.events.length, 1);
  }
});

test("1474 input-audio owner row with foreign model cannot authorize a result context", async () => {
  const f = await fixture({ ownerKind: "input_audio", ownerInputAudioForeignModel: true });
  const page = await f.client.listOwnedElevenLabsStsExistingChats({ attemptId: ATTEMPT, principal: f.principal,
    binding: BINDING, linkService: f.linkService, page: 1 });
  const history = await f.client.listOwnedElevenLabsStsExistingCandidates(page.chats[0]);
  assert.equal(history.owner_ack_status, "MISSING"); assert.equal(history.contexts.length, 0);
  assert.ok(history.gaps.includes("OWNER_ACK_MISSING"));
});

test("1474 revalidates the current owner link before returning cached history candidates", async () => {
  const f = await fixture();
  const page = await f.client.listOwnedElevenLabsStsExistingChats({ attemptId: ATTEMPT, principal: f.principal,
    binding: BINDING, linkService: f.linkService, page: 1 });
  const first = await f.client.listOwnedElevenLabsStsExistingCandidates(page.chats[0]);
  assert.equal(first.contexts.length, 1);
  await f.linkService.revoke(BINDING, ATTEMPT);
  await assert.rejects(f.client.listOwnedElevenLabsStsExistingCandidates(page.chats[0]),
    (error: unknown) => code(error, "PRINCIPAL_NOT_LINKED"));
  assert.equal(f.events.length, 2, "cached history must not be returned after the owner link is revoked");
});
