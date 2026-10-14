import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerTopazAstraExistingMediaService, OwnerTopazAstraExistingMediaServiceError,
  isOwnerTopazAstraExistingMediaService } from "../src/application/owner-topaz-astra-existing-media-service.js";

const ATTEMPT = "link_topaz_existing_1524_owner_0123456789", BINDING = Object.freeze({ tenant_id: "topaz-existing-1524", subject: "owner-1524" });
const CHAT_UUID = "topaz-existing-chat-1524", OWNER_TITLE = "owner-topaz-astra-12345678-1234-4abc-8def-123456789abc";
const OUTPUT_URL = "https://r2.syntx.ai/private/topaz-existing-1524.mp4", BASE_TIME = 1_797_000_000_000;
const stores = new Set<InMemoryAuthLinkStore>();
function json(value: unknown): Response { return Response.json(value); }
function code(expected: string) { return (error: unknown): boolean => error instanceof OwnerTopazAstraExistingMediaServiceError && error.code === expected; }

async function fixture(options: { now?: () => number; afterResultGet?: () => Promise<void> | void; indexTotal?: number;
  model?: "slc-1" | "slf-2" | "slp-2" | "slp-2.5" } = {}) {
  const events: string[] = []; let resultGets = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-topaz-1524", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-topaz-1524-credential" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => BASE_TIME); stores.add(store);
  const genuinePerUserLinkService = new PerUserLinkService(provider, store, { now: () => BASE_TIME, attemptIdGenerator: () => ATTEMPT });
  await genuinePerUserLinkService.createAttempt(BINDING); await genuinePerUserLinkService.issueHandoff(BINDING, ATTEMPT); await genuinePerUserLinkService.checkAttempt(BINDING, ATTEMPT);
  const broker: SyntxCredentialBroker = { useCredential: <T>(operation: (credential: string) => Promise<T>) =>
    genuinePerUserLinkService.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value)) };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init?.method ?? "GET";
    events.push(`${method} ${url.pathname}`); if (method !== "GET") throw new Error("Existing Topaz service is GET-only.");
    if (url.pathname === "/api/v1/chats") {
      const total = options.indexTotal ?? 1;
      const chats = Array.from({ length: total }, (_, index) => ({ id: 8200 + index, uuid: `unowned-${index}`, scope: "tool_video_upscaler", title: `ordinary-${index}` }));
      chats[0] = { id: 8101, uuid: CHAT_UUID, scope: "tool_video_upscaler", title: OWNER_TITLE };
      return json({ chats, pagination: { page: 1, page_size: 20, total_count: total, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/messages`) return json({ messages: [
      { id: "owner-message", chat_id: 8101, author_id: 17, message_object: [] },
      { id: "bot-message", chat_id: 8101, author_id: -1, message_object: [{ id: "video-object", message_id: "bot-message", object_type: "video",
        model_type: options.model ?? "slp-2.5", completed: true, object_url: OUTPUT_URL }] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/bot-message`) {
      resultGets++; if (resultGets > 1) await options.afterResultGet?.();
      return json({ id: "bot-message", chat_id: 8101, author_id: -1, message_object: [{ id: "video-object", message_id: "bot-message",
        object_type: "video", model_type: options.model ?? "slp-2.5", completed: true, object_url: OUTPUT_URL }] });
    }
    throw new Error(`Unexpected GET ${url.pathname}`);
  } });
  const service = new OwnerTopazAstraExistingMediaService({ binding: BINDING, genuinePerUserLinkService,
    resolveChatClient: () => client, now: options.now });
  return { service, genuinePerUserLinkService, store, events, async cleanup() { await service.close(); store.close(); stores.delete(store); } };
}
afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

test("1524 lists an opaque handle for an exact existing Topaz result and fetches its bound MP4 with GET only", async () => {
  const f = await fixture();
  try {
    assert.equal(isOwnerTopazAstraExistingMediaService(f.service), true);
    const page = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    assert.deepEqual([page.page, page.page_size, page.total_count, page.total_pages, page.results.length], [1, 20, 1, 1, 1]);
    assert.equal(page.results[0]?.model_id, "slp-2.5"); assert.match(page.results[0]!.result_handle, /^existing_topaz_astra_[0-9a-f-]{36}$/u);
    assert.equal(JSON.stringify(page).includes(CHAT_UUID), false); assert.equal(JSON.stringify(page).includes(OUTPUT_URL), false);
    assert.deepEqual(page.results[0]?.proof, { owner: "CURRENT_LINK_REVALIDATED", index: "CURRENT_OWNER_TOPAZ_ASTRA_INDEX_AND_TITLE",
      history: "COMPLETE_UNIQUE_OWNER_ACK_AND_BOT_VIDEO_RESULT", model: "MATCHED_TOPAZ_ASTRA_ALLOWLIST", result: "COMPLETED_EXACT_MP4_VIDEO_OBJECT",
      source_provenance: "NOT_AVAILABLE", provider_terminal_status: "UNPROVEN" });
    const artifact = await f.service.getExistingResult({ attemptId: ATTEMPT, result_handle: page.results[0]!.result_handle });
    assert.deepEqual([artifact.model_id, artifact.object_url, artifact.mime_type, artifact.output_identity], ["slp-2.5", OUTPUT_URL, "video/mp4", "UNHASHED_URL_REFERENCE"]);
    assert.deepEqual(f.events, ["GET /api/v1/chats", `GET /api/v1/chats/${CHAT_UUID}/messages`, `GET /api/v1/chats/${CHAT_UUID}/bot-message`,
      `GET /api/v1/chats/${CHAT_UUID}/bot-message`]);
  } finally { await f.cleanup(); }
});

test("1524 keeps the raw index census when only a filtered subset is exposed and carries its native Topaz model", async () => {
  const f = await fixture({ indexTotal: 20, model: "slc-1" });
  try {
    const page = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    assert.deepEqual([page.total_count, page.total_pages, page.results.length, page.results[0]?.model_id], [20, 1, 1, "slc-1"]);
    assert.equal(JSON.stringify(page).includes("unowned-"), false);
  } finally { await f.cleanup(); }
});

test("1524 refuses a result handle from another attempt before fetching the provider result", async () => {
  const f = await fixture();
  try {
    const page = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    const before = f.events.length;
    await assert.rejects(f.service.getExistingResult({ attemptId: "link_topaz_other_0123456789", result_handle: page.results[0]!.result_handle }));
    assert.equal(f.events.length, before);
  } finally { await f.cleanup(); }
});

test("1524 rejects an unissued same-attempt handle without a provider GET", async () => {
  const f = await fixture();
  try {
    await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 }); const before = f.events.length;
    await assert.rejects(f.service.getExistingResult({ attemptId: ATTEMPT, result_handle: "existing_topaz_astra_00000000-0000-4000-8000-000000000000" }), code("RESULT_HANDLE_EXPIRED"));
    assert.equal(f.events.length, before);
  } finally { await f.cleanup(); }
});

test("1524 drops a result when its handle expires during the native GET and never returns the URL", async () => {
  let now = BASE_TIME;
  const f = await fixture({ now: () => now, afterResultGet: () => { now = BASE_TIME + 15 * 60_000; } });
  try {
    const page = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    await assert.rejects(f.service.getExistingResult({ attemptId: ATTEMPT, result_handle: page.results[0]!.result_handle }), code("RESULT_HANDLE_EXPIRED"));
  } finally { await f.cleanup(); }
});

test("1524 drops a result when the owner link is revoked during the native GET", async () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture({ afterResultGet: async () => { await f.genuinePerUserLinkService.revoke(BINDING, ATTEMPT); } });
  try {
    const page = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    await assert.rejects(f.service.getExistingResult({ attemptId: ATTEMPT, result_handle: page.results[0]!.result_handle }));
  } finally { await f.cleanup(); }
});

test("1524 is closed after cleanup and cannot read existing media again", async () => {
  const f = await fixture();
  await f.cleanup();
  assert.equal(isOwnerTopazAstraExistingMediaService(Object.create(OwnerTopazAstraExistingMediaService.prototype)), false);
  await assert.rejects(f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 }), code("SERVICE_CLOSED"));
  assert.deepEqual(f.events, []);
});
