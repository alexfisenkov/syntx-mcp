import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const SECRET = "synthetic-video-upscaler-chat-secret";

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation(SECRET); } };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function videoUpscalerChat(client: SyntxChatHttpClient, title: string, signal?: AbortSignal) {
  const method = (client as unknown as {
    createVideoUpscalerChat?: (title: string, signal?: AbortSignal) => Promise<{ chat_uuid: string }>;
  }).createVideoUpscalerChat;
  assert.equal(typeof method, "function", "fixed video-upscaler chat method must exist");
  return method!.call(client, title, signal);
}

test("video-upscaler chat uses its fixed scope and returns the validated UUID receipt", async () => {
  const seen: Array<{ url: string; method: string; authorization: string | null; body: string | undefined }> = [];
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (input, init) => {
      seen.push({
        url: String(input), method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? init.body : undefined
      });
      return response({ uuid: "video-upscale-chat-001", private_extra: "discarded" });
    }
  });

  assert.deepEqual(await videoUpscalerChat(client, "owner-video-upscale-job"), { chat_uuid: "video-upscale-chat-001" });
  assert.deepEqual(seen, [{
    url: "https://api.syntx.ai/api/v1/chats",
    method: "POST",
    authorization: `Bearer ${SECRET}`,
    body: JSON.stringify({ title: "owner-video-upscale-job", scope: "tool_video_upscaler" })
  }]);
});

test("video-upscaler chat rejects malformed receipts and legacy createChat still rejects tool scopes", async () => {
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async () => {
      fetchCalls += 1;
      return response({ uuid: "bad/path" });
    }
  });

  await assert.rejects(() => videoUpscalerChat(client, "owner-video-upscale-job"),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" &&
      !String(error).includes(SECRET));
  await assert.rejects(() => client.createChat("tool_video_upscaler" as never, "legacy-video-upscale"),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(fetchCalls, 1);
});
