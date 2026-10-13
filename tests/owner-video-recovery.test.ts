import assert from "node:assert/strict";
import test from "node:test";
import type { OwnerVideoChatClient } from "../src/application/owner-generate-video.js";
import {
  OwnerVideoRecoveryStore,
  reconcileOwnerVideoRecovery
} from "../src/application/owner-video-recovery.js";

const attempt = "link_recovery_test_attempt01";

function fakeClient(): OwnerVideoChatClient {
  return {
    async createChat() { return { chat_uuid: "chat-unused" }; },
    async deleteChat(chat_uuid) { return { chat_uuid, accepted: true }; },
    async startVideo(request) { return { chat_uuid: request.chat_id, message_id: "echo" }; },
    async listInProgress() {
      return [{ message_id: "bot", message_object_id: "obj", object_type: "video", model_type: "seedance-2.0" }];
    },
    async getMessage(chat_uuid, message_id) {
      return {
        chat_uuid,
        message_id,
        object_type: "video",
        model_type: "seedance-2.0",
        artifacts: [{ url: "https://r2.syntx.ai/recovered.mp4", mime_type: "video/mp4" }]
      };
    }
  };
}

test("recovery store binds opaque handles to attempt and expires records", () => {
  const store = new OwnerVideoRecoveryStore({ ttlMs: 1000, maxRecords: 2 });
  const record = store.create({ attempt_id: attempt, chat_uuid: "chat-private", model_id: "seedance-2.0", now: 10_000 });
  assert.match(record.recovery_id, /^recovery_[0-9a-f-]{36}$/u);
  assert.equal(store.get(record.recovery_id, attempt, 10_500)?.chat_uuid, "chat-private");
  assert.equal(store.get(record.recovery_id, "link_other_attempt01", 10_500), undefined);
  assert.equal(store.get(record.recovery_id, attempt, 11_001), undefined);
});

test("recovery store close clears local handles", () => {
  const store = new OwnerVideoRecoveryStore();
  const record = store.create({ attempt_id: attempt, chat_uuid: "chat-private", model_id: "seedance-2.0" });
  assert.ok(store.get(record.recovery_id, attempt));
  store.close();
  assert.equal(store.get(record.recovery_id, attempt), undefined);
});

test("recovery stores the dispatch message id when available", () => {
  const store = new OwnerVideoRecoveryStore();
  const record = store.create({ attempt_id: attempt, chat_uuid: "chat-private", model_id: "seedance-2.0", message_id: "echo-123" });
  assert.equal(record.message_id, "echo-123");
});

test("recovery reconciliation is read-only and returns validated mp4", async () => {
  const store = new OwnerVideoRecoveryStore();
  const record = store.create({ attempt_id: attempt, chat_uuid: "chat-private", model_id: "seedance-2.0" });
  const artifacts = await reconcileOwnerVideoRecovery(fakeClient(), record);
  assert.deepEqual(artifacts, [{ url: "https://r2.syntx.ai/recovered.mp4", mime_type: "video/mp4" }]);
});

test("reconciliation reads the saved dispatch message before listInProgress", async () => {
  const store = new OwnerVideoRecoveryStore();
  const record = store.create({ attempt_id: attempt, chat_uuid: "chat-private", model_id: "seedance-2.0", message_id: "echo-123" });
  let listReads = 0;
  let requestedMessage = "";
  const client = {
    ...fakeClient(),
    async listInProgress() { listReads += 1; return []; },
    async getMessage(chatUuid: string, messageId: string) {
      requestedMessage = messageId;
      return { chat_uuid: chatUuid, message_id: messageId, object_type: "video" as const, model_type: "seedance-2.0", artifacts: [{ url: "https://r2.syntx.ai/direct.mp4", mime_type: "video/mp4" }] };
    }
  };
  assert.deepEqual(await reconcileOwnerVideoRecovery(client, record), [{ url: "https://r2.syntx.ai/direct.mp4", mime_type: "video/mp4" }]);
  assert.equal(requestedMessage, "echo-123");
  assert.equal(listReads, 0);
});

test("legacy recovery without a dispatch id keeps the bounded list fallback", async () => {
  const store = new OwnerVideoRecoveryStore();
  const record = store.create({ attempt_id: attempt, chat_uuid: "chat-private", model_id: "seedance-2.0" });
  let listReads = 0;
  const client = {
    ...fakeClient(),
    async listInProgress() { listReads += 1; return [{ message_id: "legacy-bot", message_object_id: "obj", object_type: "video" as const, model_type: "seedance-2.0" }]; },
    async getMessage(chatUuid: string, messageId: string) { return { chat_uuid: chatUuid, message_id: messageId, object_type: "video" as const, model_type: "seedance-2.0", artifacts: [{ url: "https://r2.syntx.ai/legacy.mp4", mime_type: "video/mp4" }] }; }
  };
  assert.deepEqual(await reconcileOwnerVideoRecovery(client, record), [{ url: "https://r2.syntx.ai/legacy.mp4", mime_type: "video/mp4" }]);
  assert.equal(listReads, 1);
});
