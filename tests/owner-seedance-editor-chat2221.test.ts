import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import type { OwnerSeedanceEditorChatContext } from "../src/adapter/syntx/owner-seedance-editor-chat-context.js";

const SECRET = "synthetic-seedance-editor-chat-secret";
const ATTEMPT = "link_0123456789abcdefghijklmnop";
const OTHER_ATTEMPT = "link_9876543210zyxwvutsrqponmlk";
const TITLE = "owner-seedance-editor-job";

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation(SECRET); } };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function create(client: SyntxChatHttpClient, input: { attemptId: string; title: string }, signal?: AbortSignal) {
  const method = (client as unknown as {
    createOwnerSeedanceEditorChat?: (input: { attemptId: string; title: string }, signal?: AbortSignal) => Promise<OwnerSeedanceEditorChatContext>;
  }).createOwnerSeedanceEditorChat;
  assert.equal(typeof method, "function", "fixed Seedance Editor context constructor must exist");
  return method!.call(client, input, signal);
}

function isOwned(client: SyntxChatHttpClient, context: unknown, attemptId: string): boolean {
  const method = (client as unknown as {
    isOwnerSeedanceEditorChat?: (context: unknown, attemptId: string) => boolean;
  }).isOwnerSeedanceEditorChat;
  assert.equal(typeof method, "function", "client-bound nominal context predicate must exist");
  return method!.call(client, context, attemptId);
}

test("Seedance Editor uses one fixed tool_video_inpaint POST and publishes a frozen context", async () => {
  const seen: Array<{ url: string; method: string; authorization: string | null; body: string | undefined }> = [];
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (input, init) => {
      seen.push({ url: String(input), method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? init.body : undefined });
      return response({ uuid: "seedance-editor-chat-001", ignored: true });
    }
  });

  const context = await create(client, { attemptId: ATTEMPT, title: TITLE });
  assert.deepEqual(context, {
    status: "created", chat_uuid: "seedance-editor-chat-001", attempt_id: ATTEMPT,
    model_id: "seedance-2.5-editor", scope: "tool_video_inpaint", generation_permit: false
  });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(isOwned(client, context, ATTEMPT), true);
  assert.deepEqual(seen, [{ url: "https://api.syntx.ai/api/v1/chats", method: "POST",
    authorization: `Bearer ${SECRET}`,
    body: JSON.stringify({ title: TITLE, scope: "tool_video_inpaint" }) }]);
});

test("Seedance Editor rejects malformed UUIDs and auth failures without retries or credential leakage", async () => {
  for (const makeResponse of [
    () => response({ uuid: "unsafe/path" }),
    () => response({ uuid: 42 }),
    () => response({ detail: SECRET }, 401)
  ]) {
    let calls = 0;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
      calls += 1;
      return makeResponse();
    } });
    await assert.rejects(() => create(client, { attemptId: ATTEMPT, title: TITLE }),
      (error: unknown) => error instanceof SyntxHttpError &&
        ["UPSTREAM_PROTOCOL_ERROR", "AUTH_OR_ACCESS_DENIED"].includes(error.code) && !String(error).includes(SECRET));
    assert.equal(calls, 1);
  }
});

test("Seedance Editor abort propagates through the shared request path without retry", async () => {
  let calls = 0;
  const controller = new AbortController();
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    calls += 1;
    return new Promise<Response>(() => { /* synthetic transport ignores abort */ });
  } });
  const pending = create(client, { attemptId: ATTEMPT, title: TITLE }, controller.signal);
  controller.abort();
  await assert.rejects(() => pending,
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(calls, 1);
});

test("Seedance Editor validates title and attempt before any request", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    calls += 1;
    return response({ uuid: "unexpected" });
  } });
  for (const input of [
    { attemptId: "wrong-attempt", title: TITLE },
    { attemptId: ATTEMPT, title: "" },
    { attemptId: ATTEMPT, title: "x".repeat(1025) }
  ]) {
    await assert.rejects(() => create(client, input));
  }
  assert.equal(calls, 0);
});

test("Seedance Editor contexts are nominal, same-client and attempt-bound", async () => {
  const createClient = () => new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () =>
    response({ uuid: "seedance-editor-chat-002" }) });
  const first = createClient();
  const second = createClient();
  const context = await create(first, { attemptId: ATTEMPT, title: TITLE });
  assert.equal(isOwned(first, context, ATTEMPT), true);
  assert.equal(isOwned(first, context, OTHER_ATTEMPT), false);
  assert.equal(isOwned(first, { ...context }, ATTEMPT), false);
  assert.equal(isOwned(first, JSON.parse(JSON.stringify(context)), ATTEMPT), false);
  assert.equal(isOwned(second, context, ATTEMPT), false);
});

test("invalidating an attempt fences a pending create from publishing stale context", async () => {
  let resolveFetch!: (value: Response) => void;
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    markFetchStarted();
    return new Promise<Response>((resolve) => { resolveFetch = resolve; });
  } });
  const pending = create(client, { attemptId: ATTEMPT, title: TITLE });
  void pending.catch(() => undefined);
  await Promise.race([fetchStarted, pending.then(() => undefined, () => undefined)]);
  assert.equal(typeof resolveFetch, "function", "constructor must reach fetch before invalidation can race create");
  const invalidate = (client as unknown as {
    invalidateOwnerSeedanceEditorChats?: (attemptId?: string) => void;
  }).invalidateOwnerSeedanceEditorChats;
  assert.equal(typeof invalidate, "function", "client-bound invalidation method must exist");
  invalidate!.call(client, ATTEMPT);
  resolveFetch(response({ uuid: "seedance-editor-chat-pending" }));
  await assert.rejects(() => pending);
});

