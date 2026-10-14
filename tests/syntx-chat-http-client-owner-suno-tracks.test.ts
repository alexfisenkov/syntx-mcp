import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  SyntxChatHttpClient,
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

const ATTEMPT = "link_suno_tracks_1290_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "suno-tracks-1290-tenant", subject: "suno-tracks-1290-owner" });
const CREDENTIAL = "synthetic-suno-tracks-credential";
const stores = new Set<InMemoryAuthLinkStore>();
interface FixtureOptions { readonly numericProviderIds?: boolean; }

interface SunoNativeApi {
  createOwnerSunoGenerationChat(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  startSunoWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  listOwnedSunoGenerationCandidates(chat: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getOwnedSunoGenerationResult(context: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getOwnedSunoGenerationTrackMetadata(context: unknown): readonly Record<string, unknown>[];
}

function api(client: SyntxChatHttpClient): SunoNativeApi { return client as unknown as SunoNativeApi; }
function code(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected;
}

async function fixture(options: FixtureOptions = {}) {
  let now = Date.parse("2026-10-14T00:00:00.000Z");
  const events: Array<{ method: string; pathname: string }> = [];
  let getResultCount = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-suno-tracks", approval_url: "https://example.invalid/" }; },
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
  const numericProviderIds = options.numericProviderIds ?? false;
  const botMessageId: string | number = numericProviderIds ? 6100 : "owner-suno-track-bot-message";
  const historyObjects = (messageId: string | number) => [
    { id: numericProviderIds ? 6201 : "track-object-exact", message_id: messageId, object_type: "audio", object_url: "https://r2.syntx.ai/generated/exact.mp3",
      completed: true, model_type: "V6", metadata: { payload: { clip_id: "observed-clip-1290", task_id: "observed-task-1290" } } },
    { id: numericProviderIds ? 6202 : "track-object-missing", message_id: messageId, object_type: "audio", object_url: "https://r2.syntx.ai/generated/missing.mp3",
      completed: true, model_type: "V6", metadata: { payload: { clip_id: "clip-without-task" } } },
    { id: numericProviderIds ? 6203 : "track-object-oversized", message_id: messageId, object_type: "audio", object_url: "https://r2.syntx.ai/generated/oversized.mp3",
      completed: true, model_type: "V6", metadata: { payload: { clip_id: "x".repeat(257), task_id: "oversized-clip" } } }
  ];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    events.push({ method, pathname: url.pathname });
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: "owner-suno-track-chat" });
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") return Response.json({ id: "owner-suno-track-ack" });
    if (url.pathname.endsWith("/messages") && method === "GET") {
      const messageId = "owner-suno-track-ack";
      return Response.json({ messages: [
        { id: messageId, chat_id: 9001, author_id: 42, message_object: [{ id: "owner-text-object", message_id: messageId,
          object_type: "text", object_text: "A synthetic Suno test", model_type: "V6" }] },
        { id: botMessageId, chat_id: 9001, author_id: -1,
          message_object: historyObjects(botMessageId) }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (message && method === "GET") {
      getResultCount += 1;
      const resultObjects: Array<Record<string, unknown>> = historyObjects(numericProviderIds ? 6100 : message[2]!);
      delete resultObjects[1]!["model_type"];
      return Response.json({ id: numericProviderIds ? 6100 : message[2], chat_id: 9001, author_id: -1,
        message_object: [...resultObjects, { id: numericProviderIds ? 6299 : "foreign-result-object",
          message_id: numericProviderIds ? 6100 : message[2],
          object_type: "audio", object_url: "https://r2.syntx.ai/generated/foreign.mp3", completed: true,
          model_type: "V6", metadata: { payload: { clip_id: "foreign-clip-id", task_id: "foreign-task-id" } } }] });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const preparer = new OwnerSunoGenerationRequestPreparer({ binding: BINDING, linkService, now: () => now });
  const oneShotPolicy = new OwnerSunoGenerationOneShotPolicy({ preparer, now: () => now });
  const normalized = normalizeOwnerSunoGenerationParameters({ model_id: "V6", mode: "generate", prompt: "A synthetic Suno test",
    is_custom_mode: false, is_instrumental: true, negative_tags: "", styles: "", title: "Synthetic track metadata" });
  const candidate = await preparer.prepare({ attemptId: ATTEMPT, normalized });
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService });
  const permit = oneShotPolicy.createPermit({ candidate, attemptId: ATTEMPT, principal });
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const otherClient = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  return {
    client, native: api(client), otherNative: api(otherClient), candidate, permit, preparer, oneShotPolicy, principal,
    get events() { return events; }, get resultGets() { return getResultCount; },
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

test("native Suno result metadata is projected only from exact decoder-approved audio objects without another GET", async () => {
  const f = await fixture();
  try {
    const chat = await createChat(f);
    await start(f, chat);
    const history = await f.native.listOwnedSunoGenerationCandidates(chat);
    const context = (history.contexts as unknown[])[0];
    assert.equal(isOwnerSunoGenerationResultMessageContext(context, f.client), true);
    assert.deepEqual(f.native.getOwnedSunoGenerationTrackMetadata(context), []);

    const result = await f.native.getOwnedSunoGenerationResult(context);
    assert.equal(result.message_binding, "BOUND");
    assert.equal(result.model_echo, "UNKNOWN");
    assert.equal((result.ready_audio as unknown[]).length, 3);
    const requestCountAfterResult = f.events.length;
    const metadata = f.native.getOwnedSunoGenerationTrackMetadata(context);
    assert.deepEqual(metadata, [{ message_object_id: "track-object-exact", clip_id: "observed-clip-1290",
      task_id: "observed-task-1290", model_id: "V6" }]);
    assert.equal(Object.isFrozen(metadata), true);
    assert.equal(Object.isFrozen(metadata[0]), true);
    assert.equal(f.events.length, requestCountAfterResult);
    assert.equal(f.resultGets, 1);
    assert.equal(f.events.filter(({ method, pathname }) => method === "POST" &&
      (pathname === "/api/v1/chats" || pathname === "/api/v1/audio/generate")).length, 2);
  } finally { await f.close(); }
});

test("metadata getter preserves native context ownership and rejects forged, foreign, proxied, and revoked contexts", async () => {
  const f = await fixture();
  try {
    const chat = await createChat(f);
    await start(f, chat);
    const history = await f.native.listOwnedSunoGenerationCandidates(chat);
    const context = (history.contexts as unknown[])[0] as Record<string, unknown>;
    assert.throws(() => f.native.getOwnedSunoGenerationTrackMetadata({ ...context }),
      (error: unknown) => code(error, "RESULT_CONTEXT_INVALID"));
    assert.throws(() => f.otherNative.getOwnedSunoGenerationTrackMetadata(context),
      (error: unknown) => code(error, "RESULT_CONTEXT_INVALID"));
    assert.throws(() => f.native.getOwnedSunoGenerationTrackMetadata(new Proxy(context, {})),
      (error: unknown) => code(error, "RESULT_CONTEXT_INVALID"));
    const revoked = Proxy.revocable(context, {});
    revoked.revoke();
    assert.throws(() => f.native.getOwnedSunoGenerationTrackMetadata(revoked.proxy),
      (error: unknown) => code(error, "RESULT_CONTEXT_INVALID"));
    assert.equal(f.resultGets, 0);
  } finally { await f.close(); }
});

test("metadata projection follows the decoder's numeric provider-ID normalization", async () => {
  const f = await fixture({ numericProviderIds: true });
  try {
    const chat = await createChat(f);
    await start(f, chat);
    const history = await f.native.listOwnedSunoGenerationCandidates(chat);
    const context = (history.contexts as unknown[])[0];
    assert.equal(isOwnerSunoGenerationResultMessageContext(context, f.client), true);
    const result = await f.native.getOwnedSunoGenerationResult(context);
    assert.equal(result.message_binding, "BOUND");
    assert.equal(result.model_echo, "UNKNOWN");
    assert.equal((result.ready_audio as unknown[]).length, 3);
    assert.deepEqual(f.native.getOwnedSunoGenerationTrackMetadata(context), [{ message_object_id: "6201",
      clip_id: "observed-clip-1290", task_id: "observed-task-1290", model_id: "V6" }]);
    assert.equal(f.resultGets, 1);
  } finally { await f.close(); }
});
