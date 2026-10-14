import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";

const ATTEMPT = "link_topaz_existing_1521_owner_0123456789", BINDING = Object.freeze({ tenant_id: "topaz-existing-1521", subject: "owner-1521" });
const CHAT_UUID = "topaz-existing-chat-1521", OWNER_TITLE = "owner-topaz-astra-12345678-1234-4abc-8def-123456789abc";
const OUTPUT_URL = "https://r2.syntx.ai/private/topaz-existing.mp4", stores = new Set<InMemoryAuthLinkStore>();
function json(value: unknown): Response { return Response.json(value); }
function code(error: unknown, expected: string): boolean { return error instanceof Error && "code" in error && error.code === expected; }
function broker(links: PerUserLinkService): SyntxCredentialBroker { return { useCredential: <T>(operation: (credential: string) => Promise<T>) =>
  links.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value)) }; }
function indexPage(page: number, chats: unknown[], total: number) { const pages = Math.ceil(total / 20); return { chats,
  pagination: { page, page_size: 20, total_count: total, total_pages: pages, has_next: page < pages, has_previous: page > 1 } }; }
function historyPage(page: number, rows: unknown[], total: number) { const pages = Math.ceil(total / 10); return { messages: rows,
  pagination: { page, page_size: 10, total_count: total, total_pages: pages, has_next: page < pages, has_previous: page > 1 } }; }
function ownerRow(id = "owner-message") { return { id, chat_id: 8101, author_id: 17, message_object: [] }; }
function botRow(id = "bot-message", model = "slp-2.5", completed = true) { return { id, chat_id: 8101, author_id: -1,
  message_object: [{ id: "video-object", message_id: id, object_type: "video", model_type: model, completed, object_url: OUTPUT_URL }] }; }
async function fixture(options: { indexPages?: Map<number, unknown>; history?: (page: number) => unknown; result?: unknown } = {}) {
  const events: Array<{ method: string; path: string; query: string }> = [];
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-topaz-1521", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-topaz-credential" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => 1_797_000_000_000); stores.add(store);
  const linkService = new PerUserLinkService(provider, store, { now: () => 1_797_000_000_000, attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING); await linkService.issueHandoff(BINDING, ATTEMPT); await linkService.checkAttempt(BINDING, ATTEMPT);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(linkService), fetchImpl: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init?.method ?? "GET"; events.push({ method, path: url.pathname, query: url.search });
    if (method !== "GET") throw new Error("Existing Topaz reader must be GET-only.");
    if (url.pathname === "/api/v1/chats") { const page = Number(url.searchParams.get("page"));
      return json(options.indexPages?.get(page) ?? indexPage(page, page === 1 ? [{ id: 8101, uuid: CHAT_UUID, scope: "tool_video_upscaler", title: OWNER_TITLE }] : [], page === 1 ? 1 : 0)); }
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/messages`) return json(options.history?.(Number(url.searchParams.get("page"))) ?? historyPage(1, [ownerRow(), botRow()], 2));
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/bot-message`) return json(options.result ?? { id: "bot-message", chat_id: 8101, author_id: -1,
      message_object: [{ id: "video-object", message_id: "bot-message", object_type: "video", model_type: "slp-2.5", completed: true, object_url: OUTPUT_URL }] });
    throw new Error(`Unexpected GET ${url.pathname}`);
  } });
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService });
  return { client, linkService, principal, events };
}
afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

test("1521 reads one exact indexed Topaz chat, empty owner ACK and bound MP4 using GET only", async () => {
  const f = await fixture();
  const page = await f.client.listOwnedTopazAstraExistingChats({ attemptId: ATTEMPT, principal: f.principal, binding: BINDING, linkService: f.linkService, page: 1 });
  assert.equal(page.chats.length, 1); assert.equal(page.chats[0]?.source_kind, "EXISTING_OWNER_TOPAZ_ASTRA_CHAT");
  assert.equal(JSON.stringify(page).includes(OWNER_TITLE), false);
  const candidates = await f.client.listOwnedTopazAstraExistingCandidates(page.chats[0]);
  assert.equal(candidates.status, "COMPLETE"); assert.equal(candidates.owner_ack_status, "MATCHED");
  assert.equal(candidates.contexts[0]?.provenance, "NOT_AVAILABLE"); assert.equal(candidates.contexts[0]?.model_id, "slp-2.5");
  const result = await f.client.getOwnedTopazAstraExistingResult(candidates.contexts[0]);
  assert.equal(result.message_binding, "BOUND"); assert.equal(result.ready_videos[0]?.object_url, OUTPUT_URL);
  assert.deepEqual(f.events.map((e) => [e.method, e.path, e.query]), [["GET", "/api/v1/chats", "?scope=tool_video_upscaler&page_size=20&page=1"],
    ["GET", `/api/v1/chats/${CHAT_UUID}/messages`, "?page=1&page_size=10"], ["GET", `/api/v1/chats/${CHAT_UUID}/bot-message`, ""]]);
});

test("1521 scans the complete mixed raw index page before selecting an exact owner title", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: 8200 + i, uuid: `foreign-${i}`, scope: "tool_video_upscaler", title: `unowned-${i}` }));
  rows[13] = { id: 8101, uuid: CHAT_UUID, scope: "tool_video_upscaler", title: OWNER_TITLE };
  const f = await fixture({ indexPages: new Map([[1, indexPage(1, rows, 20)]]) });
  const page = await f.client.listOwnedTopazAstraExistingChats({ attemptId: ATTEMPT, principal: f.principal, binding: BINDING, linkService: f.linkService, page: 1 });
  assert.equal(page.chats.length, 1); assert.equal(page.chats[0]?.chat_uuid, CHAT_UUID);
});

test("1521 follows every bounded history page and allows the exact owner row to have an empty object array", async () => {
  const filler = Array.from({ length: 9 }, (_, i) => ({ id: `noise-${i}`, chat_id: 8101, author_id: 0, message_object: [] }));
  const f = await fixture({ history: (page) => historyPage(page, page === 1 ? [ownerRow(), ...filler] : [botRow()], 11) });
  const indexed = await f.client.listOwnedTopazAstraExistingChats({ attemptId: ATTEMPT, principal: f.principal, binding: BINDING, linkService: f.linkService, page: 1 });
  const found = await f.client.listOwnedTopazAstraExistingCandidates(indexed.chats[0]);
  assert.equal(found.status, "COMPLETE"); assert.equal(found.history_get_calls, 2); assert.equal(found.total_count, 11);
});

test("1521 does not cache or forbid a second GET of history page one for an existing context", async () => {
  const f = await fixture(), indexed = await f.client.listOwnedTopazAstraExistingChats({ attemptId: ATTEMPT, principal: f.principal,
    binding: BINDING, linkService: f.linkService, page: 1 });
  const first = await f.client.listOwnedTopazAstraExistingCandidates(indexed.chats[0]);
  const second = await f.client.listOwnedTopazAstraExistingCandidates(indexed.chats[0]);
  assert.equal(first.status, "COMPLETE"); assert.equal(second.status, "COMPLETE");
  assert.equal(f.events.filter((event) => event.path.endsWith("/messages")).length, 2);
});

test("1521 rejects malformed history and ambiguous/error-only bot video records", async () => {
  for (const history of [
    (page: number) => ({ ...historyPage(page, [], 2), pagination: { page, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } }),
    (page: number) => historyPage(page, [ownerRow(), botRow("bot-a"), botRow("bot-b")], 3),
    (page: number) => historyPage(page, [ownerRow(), botRow("bot", "slp-2.5", false)], 2)
  ]) {
    const f = await fixture({ history }); const indexed = await f.client.listOwnedTopazAstraExistingChats({ attemptId: ATTEMPT, principal: f.principal,
      binding: BINDING, linkService: f.linkService, page: 1 });
    const found = await f.client.listOwnedTopazAstraExistingCandidates(indexed.chats[0]); assert.equal(found.contexts.length, 0);
  }
});

test("1521 contexts are client-bound, auth is rechecked, and invocation packets cannot be forged", async () => {
  const f = await fixture(), indexed = await f.client.listOwnedTopazAstraExistingChats({ attemptId: ATTEMPT, principal: f.principal,
    binding: BINDING, linkService: f.linkService, page: 1 }), found = await f.client.listOwnedTopazAstraExistingCandidates(indexed.chats[0]);
  const other = new SyntxChatHttpClient({ credentialBroker: broker(f.linkService), fetchImpl: async () => { throw new Error("unexpected GET"); } });
  await assert.rejects(other.getOwnedTopazAstraExistingResult(found.contexts[0]), (e: unknown) => code(e, "CONTEXT_INVALID"));
  const helper = await import("../src/adapter/syntx/owner-topaz-astra-existing-media.js");
  await assert.rejects(helper.getOwnedTopazAstraExistingResult(found.contexts[0], { client: f.client, get: async () => ({}) }));
  await f.linkService.revoke(BINDING, ATTEMPT);
  await assert.rejects(f.client.listOwnedTopazAstraExistingCandidates(indexed.chats[0]), (e: unknown) => code(e, "PRINCIPAL_NOT_LINKED"));
  assert.equal(f.events.length, 2);
});

test("1521 malformed index pagination is rejected before ownership contexts are minted", async () => {
  const f = await fixture({ indexPages: new Map([[1, { ...indexPage(1, [{ id: 8101, uuid: CHAT_UUID, scope: "tool_video_upscaler", title: OWNER_TITLE }], 21) }]]) });
  await assert.rejects(f.client.listOwnedTopazAstraExistingChats({ attemptId: ATTEMPT, principal: f.principal, binding: BINDING,
    linkService: f.linkService, page: 1 }), (e: unknown) => code(e, "INDEX_UNAVAILABLE"));
  assert.equal(f.events.length, 1);
});

test("1521 rejects a repeated provider chat ID across otherwise complete index pages", async () => {
  const firstRows = Array.from({ length: 20 }, (_, i) => ({ id: 8200 + i, uuid: `foreign-${i}`, scope: "tool_video_upscaler", title: `unowned-${i}` }));
  firstRows[0] = { id: 8101, uuid: CHAT_UUID, scope: "tool_video_upscaler", title: OWNER_TITLE };
  const secondUuid = "topaz-existing-chat-other";
  const secondTitle = "owner-topaz-astra-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const f = await fixture({ indexPages: new Map([[1, indexPage(1, firstRows, 21)], [2, indexPage(2,
    [{ id: 8101, uuid: secondUuid, scope: "tool_video_upscaler", title: secondTitle }], 21)]]) });
  const common = { attemptId: ATTEMPT, principal: f.principal, binding: BINDING, linkService: f.linkService };
  const first = await f.client.listOwnedTopazAstraExistingChats({ ...common, page: 1 });
  assert.equal(first.chats.length, 1);
  await assert.rejects(f.client.listOwnedTopazAstraExistingChats({ ...common, page: 2 }), (e: unknown) => code(e, "INDEX_UNAVAILABLE"));
});
