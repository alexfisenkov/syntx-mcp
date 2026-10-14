import assert from "node:assert/strict";
import test from "node:test";
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
import { OwnerSunoTrackContextStore } from "../src/application/owner-suno-track-context.js";

const ATTEMPT = "link_suno_track_1289_0123456789abcdef";
const BINDING = Object.freeze({ tenant_id: "suno-track-1289-tenant", subject: "suno-track-1289-owner" });
const PROMPT = "Synthetic track context fixture";
const CREDENTIAL = "synthetic-track-context-credential";

interface NativeApi {
  createOwnerSunoGenerationChat(input: unknown): Promise<Record<string, unknown>>;
  startSunoWithOwnedCandidate(input: unknown): Promise<Record<string, unknown>>;
  listOwnedSunoGenerationCandidates(chat: unknown): Promise<Record<string, unknown>>;
  getOwnedSunoGenerationResult(context: unknown): Promise<unknown>;
  getOwnedSunoGenerationTrackMetadata(context: unknown): readonly unknown[];
}

function api(client: SyntxChatHttpClient): NativeApi { return client as unknown as NativeApi; }

async function fixture(options: { readonly maxRecords?: number } = {}) {
  let now = Date.parse("2026-10-14T00:00:00.000Z");
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-track-context", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: CREDENTIAL });
      return { state: "LINKED" };
    }
  };
  const authStore = new InMemoryAuthLinkStore(() => now);
  const linkService = new PerUserLinkService(provider, authStore, { now: () => now,
    defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING);
  await linkService.issueHandoff(BINDING, ATTEMPT);
  assert.equal((await linkService.checkAttempt(BINDING, ATTEMPT)).status, "LINKED");
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return linkService.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value));
    }
  };
  const audio = (messageId: string) => [{
    id: "suno-track-object-1289", message_id: messageId, object_type: "audio",
    object_url: "https://r2.syntx.ai/generated/synthetic-track-1289.mp3", completed: true, model_type: "V6"
  }];
  let chatUuid = "";
  let ackId = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatUuid = "suno-track-chat-1289";
      return Response.json({ uuid: chatUuid });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      ackId = "suno-track-ack-1289";
      return Response.json({ id: ackId });
    }
    if (url.pathname.endsWith("/messages") && method === "GET") return Response.json({
      messages: [
        { id: ackId, chat_id: 9001, author_id: 42, message_object: [{ id: "suno-track-owner-text-1289",
          message_id: ackId, object_type: "text", object_text: PROMPT, model_type: "V6" }] },
        { id: "suno-track-bot-message-1289", chat_id: 9001, author_id: -1,
          message_object: audio("suno-track-bot-message-1289") }
      ],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
    });
    if (/^\/api\/v1\/chats\/[^/]+\/[^/]+$/u.test(url.pathname) && method === "GET") return Response.json({
      id: "suno-track-bot-message-1289", chat_id: 9001, author_id: -1,
      message_object: [{ ...audio("suno-track-bot-message-1289")[0], metadata: { payload: {
        clip_id: "synthetic-clip-1289", task_id: "synthetic-task-1289"
      } } }], created_at: "2026-10-14T00:00:00Z", is_favorite: false
    });
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const preparer = new OwnerSunoGenerationRequestPreparer({ binding: BINDING, linkService, now: () => now });
  const oneShotPolicy = new OwnerSunoGenerationOneShotPolicy({ preparer, now: () => now });
  const normalized = normalizeOwnerSunoGenerationParameters({ model_id: "V6", mode: "generate", prompt: PROMPT,
    is_custom_mode: false, is_instrumental: true, negative_tags: "", styles: "", title: "Synthetic" });
  const candidate = await preparer.prepare({ attemptId: ATTEMPT, normalized });
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService });
  const permit = oneShotPolicy.createPermit({ candidate, attemptId: ATTEMPT, principal });
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const native = api(client);
  const chat = await native.createOwnerSunoGenerationChat({ candidate, permit, preparer, oneShotPolicy,
    principal, attemptId: ATTEMPT });
  await native.startSunoWithOwnedCandidate({ chat, candidate, permit, preparer, oneShotPolicy, principal, attemptId: ATTEMPT });
  const history = await native.listOwnedSunoGenerationCandidates(chat);
  const resultContext = (history.contexts as unknown[])[0];
  assert.ok(isOwnerSunoGenerationResultMessageContext(resultContext, client));
  await native.getOwnedSunoGenerationResult(resultContext);
  const store = new OwnerSunoTrackContextStore({ now: () => now, ...(options.maxRecords === undefined ? {} : { maxRecords: options.maxRecords }) });
  return {
    store, client, resultContext, principal, binding: BINDING, attemptId: ATTEMPT,
    issueInput(overrides: Record<string, unknown> = {}) {
      return { binding: BINDING, attemptId: ATTEMPT, principal, client, resultContext,
        messageObjectId: "suno-track-object-1289", ...overrides };
    },
    get now() { return now; }, set now(value: number) { now = value; },
    close() { store.close(); oneShotPolicy.close(); preparer.close(); }
  };
}

test("issues an opaque handle for the exact native owner result and resolves its private projection", async () => {
  const f = await fixture();
  try {
    const handle = f.store.issue(f.issueInput());
    assert.match(handle, /^track_[0-9a-f-]{36}$/u);
    assert.equal(handle.includes("synthetic-clip-1289"), false);
    const projection = f.store.resolve({ binding: f.binding, attemptId: f.attemptId, principal: f.principal, trackHandle: handle });
    assert.equal(projection.track_handle, handle);
    assert.equal(projection.attempt_id, ATTEMPT);
    assert.deepEqual(projection.principal, { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
    assert.equal(projection.model_id, "V6");
    assert.equal(projection.chat_uuid, "suno-track-chat-1289");
    assert.equal(projection.message_id, "suno-track-bot-message-1289");
    assert.equal(projection.message_object_id, "suno-track-object-1289");
    assert.equal(projection.clip_id, "synthetic-clip-1289");
    assert.equal(projection.task_id, "synthetic-task-1289");
    assert.equal(projection.owner_echo_message_id, "suno-track-ack-1289");
    assert.match(projection.source_profile_schema_hash, /^sha256:[a-f0-9]{64}$/u);
  } finally { f.close(); }
});

test("does not resolve a handle under a different tenant or owner subject", async () => {
  const f = await fixture();
  try {
    const handle = f.store.issue(f.issueInput());
    for (const binding of [
      { tenant_id: "other-tenant", subject: BINDING.subject },
      { tenant_id: BINDING.tenant_id, subject: "other-owner" }
    ]) assert.throws(() => f.store.resolve({ binding, attemptId: ATTEMPT, principal: f.principal, trackHandle: handle }));
  } finally { f.close(); }
});

test("does not resolve a handle under another attempt or principal connection", async () => {
  const f = await fixture();
  try {
    const handle = f.store.issue(f.issueInput());
    assert.throws(() => f.store.resolve({ binding: BINDING, attemptId: "link_suno_track_other_0123456789",
      principal: f.principal, trackHandle: handle }));
    assert.throws(() => f.store.resolve({ binding: BINDING, attemptId: ATTEMPT, trackHandle: handle,
      principal: { ...f.principal, connection_id: "link_suno_track_other_0123456789" } }));
  } finally { f.close(); }
});

test("rejects arbitrary or cross-client native contexts and malformed issue records", async () => {
  const f = await fixture();
  try {
    assert.throws(() => f.store.issue(f.issueInput({ resultContext: Object.freeze({ ...(f.resultContext as object) }) })));
    assert.throws(() => f.store.issue(f.issueInput({ client: new SyntxChatHttpClient({ credentialBroker: {
      async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); }
    }, fetchImpl: async () => Response.json({}) }) })));
    assert.throws(() => f.store.issue({ ...f.issueInput(), clipId: "caller-supplied-clip", taskId: "caller-supplied-task" }));
    let getterCalls = 0;
    const getter = Object.defineProperty(f.issueInput(), "attemptId", { enumerable: true, get() { getterCalls += 1; return ATTEMPT; } });
    assert.throws(() => f.store.issue(getter));
    assert.equal(getterCalls, 0);
    assert.throws(() => f.store.issue(new Proxy(f.issueInput(), {})));
  } finally { f.close(); }
});

test("expires a track handle after the conservative local lifetime", async () => {
  const f = await fixture();
  try {
    const handle = f.store.issue(f.issueInput());
    f.now += 15 * 60_000;
    assert.throws(() => f.store.resolve({ binding: BINDING, attemptId: ATTEMPT, principal: f.principal, trackHandle: handle }));
  } finally { f.close(); }
});

test("invalidates every handle for one exact tenant, owner, and attempt", async () => {
  const f = await fixture();
  try {
    const first = f.store.issue(f.issueInput());
    const second = f.store.issue(f.issueInput());
    f.store.invalidateAttempt(BINDING, ATTEMPT);
    for (const handle of [first, second]) assert.throws(() => f.store.resolve({ binding: BINDING,
      attemptId: ATTEMPT, principal: f.principal, trackHandle: handle }));
  } finally { f.close(); }
});

test("close clears handles and permanently closes the store", async () => {
  const f = await fixture();
  const handle = f.store.issue(f.issueInput());
  f.store.close();
  assert.throws(() => f.store.resolve({ binding: BINDING, attemptId: ATTEMPT, principal: f.principal, trackHandle: handle }));
  assert.throws(() => f.store.issue(f.issueInput()));
  f.close();
});

test("enforces the bounded record cap without evicting a still-live handle", async () => {
  const f = await fixture({ maxRecords: 1 });
  try {
    const handle = f.store.issue(f.issueInput());
    assert.throws(() => f.store.issue(f.issueInput()));
    assert.equal(f.store.resolve({ binding: BINDING, attemptId: ATTEMPT, principal: f.principal, trackHandle: handle }).clip_id,
      "synthetic-clip-1289");
  } finally { f.close(); }
});
