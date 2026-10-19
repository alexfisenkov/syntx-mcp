import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { createOwnerKlingMediaChatContext, readOwnerKlingMediaChat } from "../src/adapter/syntx/owner-kling-media-chat-context.js";

test("binds a fresh Kling media chat to exact client, attempt, and selected model", () => {
  const client = Object.create(SyntxChatHttpClient.prototype) as SyntxChatHttpClient;
  const context = createOwnerKlingMediaChatContext(client, { chat_uuid: "chat_2350", attempt_id: "link_abcdefghijklmnopqrst", model_id: "kling_o1_video2video" });
  assert.deepEqual(readOwnerKlingMediaChat(client, context, "link_abcdefghijklmnopqrst"), {
    chat_uuid: "chat_2350", attempt_id: "link_abcdefghijklmnopqrst", model_id: "kling_o1_video2video"
  });
  assert.equal(readOwnerKlingMediaChat(Object.create(SyntxChatHttpClient.prototype), context, "link_abcdefghijklmnopqrst"), null);
  assert.equal(readOwnerKlingMediaChat(client, context, "link_abcdefghijklmnopqrstu"), null);
});

test("refuses a chat witness for non-media aliases", () => {
  const client = Object.create(SyntxChatHttpClient.prototype) as SyntxChatHttpClient;
  assert.throws(() => createOwnerKlingMediaChatContext(client, { chat_uuid: "chat_2350", attempt_id: "link_abcdefghijklmnopqrst", model_id: "kling_image2video" }));
});
