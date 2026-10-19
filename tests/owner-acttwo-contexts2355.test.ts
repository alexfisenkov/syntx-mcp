import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { createOwnerActTwoCharacterImageUploadContext, readOwnerActTwoCharacterImageReference } from "../src/adapter/syntx/owner-acttwo-image-context.js";
import { createOwnerActTwoPerformanceVideoUploadContext, readOwnerActTwoPerformanceVideoReference } from "../src/adapter/syntx/owner-acttwo-video-context.js";
import { createOwnerActTwoChatContext, readOwnerActTwoChat } from "../src/adapter/syntx/owner-acttwo-chat-context.js";

const ATTEMPT = "link_acttwo2355_owner_0123456789abcdef";

test("ActTwo image and video contexts retain separate role, metadata, destination, and native-client ownership", () => {
  const client = Object.create(SyntxChatHttpClient.prototype) as SyntxChatHttpClient;
  const image = createOwnerActTwoCharacterImageUploadContext(client, { url: "https://r2.syntx.ai/acttwo2355/character.png" }, {
    model_id: "acttwo", destination: "hidden", mime_type: "image/png", size: 3_523, sha256: "a".repeat(64), width: 640, height: 640
  });
  const video = createOwnerActTwoPerformanceVideoUploadContext(client, { url: "https://r2.syntx.ai/acttwo2355/performance.mp4" }, {
    model_id: "acttwo", destination: "hidden", mime_type: "video/mp4", size: 4_096, sha256: "b".repeat(64), width: 640, height: 480,
    measured_duration_seconds: 5
  });
  assert.deepEqual(readOwnerActTwoCharacterImageReference(client, image), { type: "image", url: "https://r2.syntx.ai/acttwo2355/character.png" });
  assert.deepEqual(readOwnerActTwoPerformanceVideoReference(client, video), { type: "video", url: "https://r2.syntx.ai/acttwo2355/performance.mp4" });
  assert.equal(readOwnerActTwoCharacterImageReference(Object.create(SyntxChatHttpClient.prototype), image), null);
  assert.equal(readOwnerActTwoPerformanceVideoReference(client, { ...video }), null);
});

test("ActTwo chat context is nominal, exact-attempt, and bound to the native client method", () => {
  const client = Object.create(SyntxChatHttpClient.prototype) as SyntxChatHttpClient;
  const chat = createOwnerActTwoChatContext(client, { chat_uuid: "acttwo-chat2355", attempt_id: ATTEMPT, model_id: "acttwo" });
  assert.deepEqual(readOwnerActTwoChat(client, chat, ATTEMPT), { chat_uuid: "acttwo-chat2355", attempt_id: ATTEMPT, model_id: "acttwo" });
  assert.equal(readOwnerActTwoChat(client, chat, "link_other_0123456789abcdef"), null);
  assert.equal(readOwnerActTwoChat(client, { ...chat }, ATTEMPT), null);
});
