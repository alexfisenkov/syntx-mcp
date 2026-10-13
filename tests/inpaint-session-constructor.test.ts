import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const SECRET = "synthetic-inpaint-session-secret";

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation(SECRET); } };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function createImageInpaintChat(client: SyntxChatHttpClient, title: string, signal?: AbortSignal) {
  const method = (client as unknown as {
    createImageInpaintChat?: (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  }).createImageInpaintChat;
  assert.equal(typeof method, "function", "fixed image-inpaint chat method must exist");
  return method!.call(client, title, signal);
}

test("image-inpaint session uses one fixed chats POST and returns only the validated UUID", async () => {
  const seen: Array<{ url: string; method: string; authorization: string | null; body: string | undefined }> = [];
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (input, init) => {
      seen.push({
        url: String(input), method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? init.body : undefined
      });
      return response({ uuid: "inpaint-chat-001", private_extra: "discarded" });
    }
  });

  assert.deepEqual(await createImageInpaintChat(client, "owner-inpaint-job"), { chat_uuid: "inpaint-chat-001" });
  assert.deepEqual(seen, [{
    url: "https://api.syntx.ai/api/v1/chats",
    method: "POST",
    authorization: `Bearer ${SECRET}`,
    body: JSON.stringify({ title: "owner-inpaint-job", scope: "tool_image_inpaint" })
  }]);
});

test("image-inpaint session rejects malformed or unsafe receipts without retry", async () => {
  for (const makeResponse of [
    () => new Response("not-json", { headers: { "content-type": "application/json" } }),
    () => response({ uuid: "bad/path" }),
    () => new Response(JSON.stringify({ uuid: "valid-but-wrong-content-type" }), { headers: { "content-type": "text/plain" } })
  ]) {
    let fetchCalls = 0;
    const client = new SyntxChatHttpClient({
      credentialBroker: broker(),
      fetchImpl: async () => { fetchCalls += 1; return makeResponse(); }
    });
    await assert.rejects(() => createImageInpaintChat(client, "owner-inpaint-job"),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" &&
        !String(error).includes(SECRET));
    assert.equal(fetchCalls, 1);
  }
});

test("image-inpaint session does not retry auth failures and redacts credentials", async () => {
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async () => { fetchCalls += 1; return response({ detail: SECRET }, 401); }
  });
  await assert.rejects(() => createImageInpaintChat(client, "owner-inpaint-job"),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "AUTH_OR_ACCESS_DENIED" &&
      !String(error).includes(SECRET));
  assert.equal(fetchCalls, 1);
});

test("image-inpaint session timeout and caller abort are bounded without automatic retry", async () => {
  let timeoutCalls = 0;
  const timeoutClient = new SyntxChatHttpClient({
    credentialBroker: broker(), requestTimeoutMs: 5,
    fetchImpl: async () => {
      timeoutCalls += 1;
      return new Promise<Response>(() => { /* fake transport deliberately ignores abort */ });
    }
  });
  await assert.rejects(() => createImageInpaintChat(timeoutClient, "owner-inpaint-job"),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT");
  assert.equal(timeoutCalls, 1);

  let abortCalls = 0;
  const controller = new AbortController();
  const abortClient = new SyntxChatHttpClient({
    credentialBroker: broker(), requestTimeoutMs: 30_000,
    fetchImpl: async () => {
      abortCalls += 1;
      return new Promise<Response>(() => { /* fake transport deliberately ignores abort */ });
    }
  });
  const pending = createImageInpaintChat(abortClient, "owner-inpaint-job", controller.signal);
  controller.abort();
  await assert.rejects(() => pending,
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(abortCalls, 1);
});

test("generic chat construction still rejects the image-inpaint scope", async () => {
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async () => { fetchCalls += 1; return response({ uuid: "legacy-chat-001" }); }
  });
  assert.deepEqual(await client.createChat("image", "legacy-image"), { chat_uuid: "legacy-chat-001" });
  await assert.rejects(() => client.createChat("tool_image_inpaint" as never, "legacy-inpaint"),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(fetchCalls, 1);
});
