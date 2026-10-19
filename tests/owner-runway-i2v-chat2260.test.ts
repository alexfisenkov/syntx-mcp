import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import type { OwnerRunwayI2vChatContext } from "../src/adapter/syntx/owner-runway-i2v-chat-context.js";

const SECRET = "synthetic-runway-i2v-chat-token";
const ATTEMPT = "link_runway_i2v_owner_0123456789abcdef";
const OTHER_ATTEMPT = "link_runway_i2v_other_0123456789abcdef";
const TITLE = "owner-runway-i2v-job";
type ModelId = "4genfirstframeimage" | "turbo4genfirstframeimage";
const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation(SECRET); } };
function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
function create(client: SyntxChatHttpClient, input: { attemptId: string; model_id: ModelId; title: string }, signal?: AbortSignal) {
  const method = (client as unknown as { createOwnerRunwayI2vChat?: (input: { attemptId: string; model_id: ModelId; title: string }, signal?: AbortSignal) => Promise<OwnerRunwayI2vChatContext> }).createOwnerRunwayI2vChat;
  assert.equal(typeof method, "function", "fixed Runway I2V chat constructor must exist");
  return method!.call(client, input, signal);
}
function isOwned(client: SyntxChatHttpClient, context: unknown, attemptId: string): boolean {
  const method = (client as unknown as { isOwnerRunwayI2vChat?: (context: unknown, attemptId: string) => boolean }).isOwnerRunwayI2vChat;
  assert.equal(typeof method, "function", "client-bound nominal context predicate must exist");
  return method!.call(client, context, attemptId);
}
function invalidate(client: SyntxChatHttpClient, attemptId?: string): void {
  const method = (client as unknown as { invalidateOwnerRunwayI2vChats?: (attemptId?: string) => void }).invalidateOwnerRunwayI2vChats;
  assert.equal(typeof method, "function", "attempt epoch invalidation must exist");
  method!.call(client, attemptId);
}

test("2260 posts a fixed video-scope chat and returns model-bound nominal context", async () => {
  const seen: Array<{ url: string; method: string; authorization: string | null; body: string | undefined }> = [];
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    seen.push({ url: String(input), method: init?.method ?? "GET", authorization: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? init.body : undefined });
    return response({ uuid: "runway-i2v-chat-001" });
  } });
  const context = await create(client, { attemptId: ATTEMPT, model_id: "4genfirstframeimage", title: TITLE });
  assert.deepEqual(context, { status: "created", chat_uuid: "runway-i2v-chat-001", attempt_id: ATTEMPT,
    model_id: "4genfirstframeimage", scope: "video", generation_permit: false });
  assert.equal(Object.isFrozen(context), true); assert.equal(isOwned(client, context, ATTEMPT), true);
  assert.deepEqual(seen, [{ url: "https://api.syntx.ai/api/v1/chats", method: "POST", authorization: `Bearer ${SECRET}`,
    body: JSON.stringify({ title: TITLE, scope: "video" }) }]);
});

test("2260 validates model and attempt before network and rejects malformed UUID or auth failure without retry", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => { calls++; return response({ uuid: "bad/path" }); } });
  for (const input of [
    { attemptId: "wrong", model_id: "4genfirstframeimage", title: TITLE },
    { attemptId: ATTEMPT, model_id: "runway_frames", title: TITLE },
    { attemptId: ATTEMPT, model_id: "4genfirstframeimage", title: "" },
    { attemptId: ATTEMPT, model_id: "4genfirstframeimage", title: "x".repeat(1025) }
  ]) await assert.rejects(() => create(client, input as never));
  assert.equal(calls, 0);
  await assert.rejects(() => create(client, { attemptId: ATTEMPT, model_id: "4genfirstframeimage", title: TITLE }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" && !String(error).includes(SECRET));
  assert.equal(calls, 1);

  let deniedCalls = 0;
  const denied = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => { deniedCalls++; return response({ detail: SECRET }, 401); } });
  await assert.rejects(() => create(denied, { attemptId: ATTEMPT, model_id: "turbo4genfirstframeimage", title: TITLE }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "AUTH_OR_ACCESS_DENIED" && !String(error).includes(SECRET));
  assert.equal(deniedCalls, 1);
});

test("2260 chat contexts are bound to client, attempt and invalidation epoch", async () => {
  let index = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => response({ uuid: `runway-i2v-chat-${++index}` }) });
  const other = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => response({ uuid: "runway-i2v-other" }) });
  const context = await create(client, { attemptId: ATTEMPT, model_id: "turbo4genfirstframeimage", title: TITLE });
  assert.equal(isOwned(client, context, ATTEMPT), true);
  assert.equal(isOwned(client, context, OTHER_ATTEMPT), false);
  assert.equal(isOwned(client, { ...context }, ATTEMPT), false);
  assert.equal(isOwned(other, context, ATTEMPT), false);
  invalidate(client, ATTEMPT);
  assert.equal(isOwned(client, context, ATTEMPT), false);
});

test("2260 invalidating a pending create fences stale chat publication", async () => {
  let resolveFetch!: (value: Response) => void;
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>((resolveStarted) => { markFetchStarted = resolveStarted; });
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => {
    markFetchStarted(); return new Promise<Response>((resolveResponse) => { resolveFetch = resolveResponse; });
  } });
  const pending = create(client, { attemptId: ATTEMPT, model_id: "4genfirstframeimage", title: TITLE });
  void pending.catch(() => undefined);
  await fetchStarted;
  invalidate(client, ATTEMPT);
  resolveFetch(response({ uuid: "runway-i2v-chat-stale" }));
  await assert.rejects(() => pending);
});
