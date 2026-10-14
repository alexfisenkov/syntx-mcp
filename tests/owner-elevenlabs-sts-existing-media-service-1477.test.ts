import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerElevenLabsStsExistingMediaService, OwnerElevenLabsStsExistingMediaServiceError } from "../src/application/owner-elevenlabs-sts-existing-media-service.js";

const ATTEMPT = "link_sts_existing_service_1477_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "sts-existing-service-1477-tenant", subject: "sts-existing-service-1477-owner" });
const CHAT_UUID = "sts-existing-service-chat";
const OUTPUT_URL = "https://r2.syntx.ai/private/existing-service-output.mp3";
const stores = new Set<InMemoryAuthLinkStore>();
function json(value: unknown): Response { return Response.json(value); }
function code(expected: string) { return (error: unknown): boolean => error instanceof OwnerElevenLabsStsExistingMediaServiceError && error.code === expected; }

async function fixture(options: { readonly now?: () => number; readonly deferSecondResult?: boolean } = {}) {
  const events: string[] = [];
  let resultReads = 0, releaseDeferredResult: (() => void) | undefined, signalResultStarted: (() => void) | undefined;
  const resultStarted = new Promise<void>((resolve) => { signalResultStarted = resolve; });
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-sts-existing-service", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-sts-existing-service-credential" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => 1_797_000_000_000); stores.add(store);
  const linkService = new PerUserLinkService(provider, store, { now: () => 1_797_000_000_000, attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING); await linkService.issueHandoff(BINDING, ATTEMPT); await linkService.checkAttempt(BINDING, ATTEMPT);
  const broker: SyntxCredentialBroker = { async useCredential<T>(run: (credential: string) => Promise<T>): Promise<T> {
    return linkService.useCredential(BINDING, ATTEMPT, (credential) => run(credential.value));
  } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), method = init?.method ?? "GET";
    events.push(`${method} ${url.pathname}`);
    if (url.pathname === "/api/v1/chats" && method === "GET") return json({ chats: [
      { id: 9101, uuid: CHAT_UUID, scope: "audio", title: "owner-elevenlabs-sts-12345678-1234-4abc-8def-123456789abc" }
    ], pagination: { page: 1, page_size: 20, total_count: 1, total_pages: 1, has_next: false, has_previous: false } });
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/messages` && method === "GET") return json({ messages: [
      { id: "owner-ack", chat_id: 9101, author_id: 17, message_object: [{ id: "owner-object", message_id: "owner-ack",
        object_type: "audio", model_type: "eleven_multilingual_sts_v2" }] },
      { id: "bot-result", chat_id: 9101, author_id: -1, message_object: [{ id: "bot-object", message_id: "bot-result",
        object_type: "audio", model_type: "eleven_multilingual_sts_v2", completed: true }] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/bot-result` && method === "GET") {
      resultReads++;
      const response = () => json({ id: "bot-result", chat_id: 9101, author_id: -1,
        message_object: [{ id: "bot-object", object_type: "audio", object_url: OUTPUT_URL,
          model_type: "eleven_multilingual_sts_v2", completed: true }] });
      if (options.deferSecondResult && resultReads === 2) {
        signalResultStarted?.();
        return await new Promise<Response>((resolve) => { releaseDeferredResult = () => resolve(response()); });
      }
      return response();
    }
    throw new Error(`unexpected fixture request: ${method} ${url.pathname}`);
  };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const service = new OwnerElevenLabsStsExistingMediaService({ binding: BINDING, linkService, resolveChatClient: () => client,
    ...(options.now ? { now: options.now } : {}) });
  return { service, linkService, client, events, resultStarted, releaseDeferredResult() {
    if (!releaseDeferredResult) throw new Error("deferred result read has not started"); releaseDeferredResult();
  }, async cleanup() { await service.close(); store.close(); stores.delete(store); } };
}
afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

test("1477 lists only opaque proof handles and resolves the same owner artifact through exact GETs", async () => {
  const f = await fixture();
  try {
    const page = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    assert.deepEqual([page.page, page.page_size, page.total_count, page.total_pages, page.has_next, page.has_previous], [1, 20, 1, 1, false, false]);
    assert.equal(page.results.length, 1);
    const listed = page.results[0]!;
    assert.match(listed.result_handle, /^existing_elevenlabs_sts_[0-9a-f-]{36}$/u);
    assert.equal(listed.expires_in_seconds, 900); assert.equal(listed.model_id, "eleven_multilingual_sts_v2");
    assert.equal(listed.proof.source_provenance, "NOT_AVAILABLE");
    const serialized = JSON.stringify(page);
    for (const hidden of ["owner-elevenlabs-sts-", CHAT_UUID, "9101", "owner-ack", "bot-result", "bot-object", OUTPUT_URL]) assert.equal(serialized.includes(hidden), false);
    const artifact = await f.service.getExistingResult({ attemptId: ATTEMPT, result_handle: listed.result_handle });
    assert.equal(artifact.object_url, OUTPUT_URL); assert.equal(artifact.mime_type, "audio/mpeg");
    assert.equal(artifact.output_identity, "UNHASHED_URL_REFERENCE");
    assert.equal(f.events.filter((event) => event.startsWith("POST")).length, 0);
    assert.deepEqual(f.events, ["GET /api/v1/chats", `GET /api/v1/chats/${CHAT_UUID}/messages`,
      `GET /api/v1/chats/${CHAT_UUID}/bot-result`, `GET /api/v1/chats/${CHAT_UUID}/bot-result`]);
  } finally { await f.cleanup(); }
});

test("1477 reuses a stable handle, rejects foreign attempts and clears invalidated attempts", async () => {
  const f = await fixture();
  try {
    const one = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    const two = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    assert.equal(two.results[0]?.result_handle, one.results[0]?.result_handle);
    await assert.rejects(f.service.getExistingResult({ attemptId: "link_foreign_service_1477_0123456789", result_handle: one.results[0]!.result_handle }),
      code("PRINCIPAL_NOT_LINKED"));
    await f.service.invalidateAttempt(ATTEMPT);
    await assert.rejects(f.service.getExistingResult({ attemptId: ATTEMPT, result_handle: one.results[0]!.result_handle }), code("PRINCIPAL_NOT_LINKED"));
  } finally { await f.cleanup(); }
});

test("1477 expiry and revoked owner link prevent result reads", async () => {
  let now = 1_797_000_000_000;
  const f = await fixture({ now: () => now });
  try {
    const page = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    now += 15 * 60_000 + 1;
    await assert.rejects(f.service.getExistingResult({ attemptId: ATTEMPT, result_handle: page.results[0]!.result_handle }), code("RESULT_HANDLE_EXPIRED"));
    now -= 15 * 60_000 + 1;
    const fresh = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    await f.linkService.revoke(BINDING, ATTEMPT);
    await assert.rejects(f.service.getExistingResult({ attemptId: ATTEMPT, result_handle: fresh.results[0]!.result_handle }), code("PRINCIPAL_NOT_LINKED"));
  } finally { await f.cleanup(); }
});

test("1477 does not return an artifact when a native result GET finishes after handle expiry", async () => {
  let now = 1_797_000_000_000;
  const f = await fixture({ now: () => now, deferSecondResult: true });
  try {
    const page = await f.service.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    const pending = f.service.getExistingResult({ attemptId: ATTEMPT, result_handle: page.results[0]!.result_handle });
    await f.resultStarted;
    now += 15 * 60_000 + 1;
    f.releaseDeferredResult();
    await assert.rejects(pending, code("RESULT_HANDLE_EXPIRED"));
    assert.equal(f.events.filter((event) => event.endsWith("/bot-result")).length, 2);
  } finally { await f.cleanup(); }
});

test("1477 refuses a prototype clone and a caller-created result handle without leaking a native read", async () => {
  const f = await fixture();
  const clone = Object.create(SyntxChatHttpClient.prototype) as SyntxChatHttpClient;
  try {
    const service = new OwnerElevenLabsStsExistingMediaService({ binding: BINDING, linkService: f.linkService, resolveChatClient: () => clone });
    await assert.rejects(service.listExistingResults({ attemptId: ATTEMPT, page: 1 }), code("INDEX_UNAVAILABLE"));
    await service.close();
    await assert.rejects(f.service.getExistingResult({ attemptId: ATTEMPT, result_handle: `existing_elevenlabs_sts_${"0".repeat(8)}-0000-4000-8000-000000000000` }),
      code("RESULT_HANDLE_EXPIRED"));
    assert.deepEqual(f.events, []);
  } finally { await f.cleanup(); }
});

test("1477 rejects invalid pages and out-of-range native index pages", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service.listExistingResults({ attemptId: ATTEMPT, page: 0 }), code("INVALID_REQUEST"));
    await assert.rejects(f.service.listExistingResults({ attemptId: ATTEMPT, page: 2 }), code("INDEX_UNAVAILABLE"));
    assert.deepEqual(f.events, ["GET /api/v1/chats"]);
  } finally { await f.cleanup(); }
});
