import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerElevenLabsStsExistingMediaService, OwnerElevenLabsStsExistingMediaServiceError } from "../src/application/owner-elevenlabs-sts-existing-media-service.js";

const ATTEMPT = "link_sts_filtered_index_1500_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "sts-filtered-index-1500-tenant", subject: "sts-filtered-index-1500-owner" });
const stores = new Set<InMemoryAuthLinkStore>();
function json(value: unknown): Response { return Response.json(value); }
function code(expected: string) { return (error: unknown): boolean => error instanceof OwnerElevenLabsStsExistingMediaServiceError && error.code === expected; }

async function fixture(stsRows: readonly number[], malformedPagination = false) {
  const events: string[] = [], rows = Array.from({ length: 20 }, (_, index) => {
    const n = index + 1, uuid = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    return { id: 9100 + n, uuid, scope: "audio", title: stsRows.includes(n) ? `owner-elevenlabs-sts-${uuid}` : `ordinary-audio-${n}` };
  });
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-sts-filtered-index", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-sts-filtered-index-credential" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => 1_797_000_000_000); stores.add(store);
  const linkService = new PerUserLinkService(provider, store, { now: () => 1_797_000_000_000, attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING); await linkService.issueHandoff(BINDING, ATTEMPT); await linkService.checkAttempt(BINDING, ATTEMPT);
  const broker: SyntxCredentialBroker = { async useCredential<T>(run: (credential: string) => Promise<T>): Promise<T> {
    return linkService.useCredential(BINDING, ATTEMPT, (credential) => run(credential.value));
  } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init?.method ?? "GET";
    events.push(`${method} ${url.pathname}`);
    if (url.pathname === "/api/v1/chats" && method === "GET") return json({ chats: rows, pagination: {
      page: 1, page_size: 20, total_count: malformedPagination ? 19 : 20, total_pages: 1, has_next: false, has_previous: false
    } });
    const match = /^\/api\/v1\/chats\/(00000000-0000-4000-8000-\d{12})\/messages$/u.exec(url.pathname);
    if (match && method === "GET") {
      const chat = rows.find((row) => row.uuid === match[1])!;
      return json({ messages: [
        { id: `owner-ack-${chat.id}`, chat_id: chat.id, author_id: 17, message_object: [{ id: `owner-object-${chat.id}`, message_id: `owner-ack-${chat.id}`,
          object_type: "audio", model_type: "eleven_multilingual_sts_v2" }] },
        { id: `bot-result-${chat.id}`, chat_id: chat.id, author_id: -1, message_object: [{ id: `bot-object-${chat.id}`, message_id: `bot-result-${chat.id}`,
          object_type: "audio", model_type: "eleven_multilingual_sts_v2", completed: true }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(00000000-0000-4000-8000-\d{12})\/bot-result-(\d+)$/u.exec(url.pathname);
    if (resultMatch && method === "GET") {
      const chat = rows.find((row) => row.uuid === resultMatch[1])!;
      if (String(chat.id) !== resultMatch[2]) throw new Error("result chat ID did not match indexed row");
      return json({ id: `bot-result-${chat.id}`, chat_id: chat.id, author_id: -1,
        message_object: [{ id: `bot-object-${chat.id}`, object_type: "audio", object_url: `https://r2.syntx.ai/private/${chat.id}.mp3`,
          model_type: "eleven_multilingual_sts_v2", completed: true }] });
    }
    throw new Error(`unexpected fixture request: ${method} ${url.pathname}`);
  };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const service = new OwnerElevenLabsStsExistingMediaService({ binding: BINDING, linkService, resolveChatClient: () => client });
  return { service, events, async cleanup() { await service.close(); store.close(); stores.delete(store); } };
}
afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

test("1500 accepts native-validated 20-row pages after title filtering and histories only the 2 STS matches", async () => {
  const f = await fixture([3, 17]);
  try {
    const page = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    assert.deepEqual([page.total_count, page.total_pages, page.has_next, page.has_previous], [20, 1, false, false]);
    assert.equal(page.results.length, 2);
    assert.deepEqual(f.events.filter((event) => event.endsWith("/messages")).sort(), [
      "GET /api/v1/chats/00000000-0000-4000-8000-000000000003/messages",
      "GET /api/v1/chats/00000000-0000-4000-8000-000000000017/messages"
    ]);
    assert.equal(f.events.length, 5);
  } finally { await f.cleanup(); }
});

test("1500 preserves the native page census and performs no history reads when no row is an STS title", async () => {
  const f = await fixture([]);
  try {
    const page = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    assert.deepEqual([page.total_count, page.total_pages, page.has_next, page.results.length], [20, 1, false, 0]);
    assert.deepEqual(f.events, ["GET /api/v1/chats"]);
  } finally { await f.cleanup(); }
});

test("1500 still rejects malformed raw pagination before any history read", async () => {
  const f = await fixture([3, 17], true);
  try {
    await assert.rejects(f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 }), code("INDEX_UNAVAILABLE"));
    assert.deepEqual(f.events, ["GET /api/v1/chats"]);
  } finally { await f.cleanup(); }
});
