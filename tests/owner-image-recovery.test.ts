import assert from "node:assert/strict";
import test from "node:test";
import type { OwnerImageChatClient } from "../src/application/owner-generate-image.js";
import { SyntxHttpError } from "../src/adapter/syntx/http-client.js";
import {
  OwnerImageGenerationOutcomeUnknownError,
  OwnerImageRecoveryStore,
  reconcileOwnerImageRecovery
} from "../src/application/owner-image-recovery.js";

const ATTEMPT = "link_owner_image_recovery_test01";
const FOREIGN_ATTEMPT = "link_foreign_owner_image_test01";

test("image recovery storage is bounded by TTL/cap and filtered by exact attempt", () => {
  let now = 1_800_000_000_000;
  const store = new OwnerImageRecoveryStore({ now: () => now, ttlMs: 100, maxRecords: 2 });
  const first = store.create({
    attempt_id: ATTEMPT,
    chat_uuid: "private-chat-1",
    model_id: "nano-banana-pro",
    model_type: "banana",
    mime_types: ["image/png"],
    message_id: null
  });
  store.create({ attempt_id: ATTEMPT, chat_uuid: "private-chat-2", model_id: "banana", model_type: "banana", mime_types: ["image/png"] });
  assert.equal(store.get(first.recovery_id, FOREIGN_ATTEMPT), undefined);
  assert.equal(store.list(FOREIGN_ATTEMPT).length, 0);
  assert.deepEqual(Object.keys(store.list(ATTEMPT)[0]!).sort(), ["created_at", "model_id", "recovery_id"]);
  store.create({ attempt_id: ATTEMPT, chat_uuid: "private-chat-3", model_id: "banana", model_type: "banana", mime_types: ["image/png"] });
  assert.equal(store.size(), 2, "oldest record is evicted at the explicit cap");
  now += 101;
  assert.equal(store.list(ATTEMPT).length, 0, "records expire by TTL");
});

test("reconciliation reads exact stored model/message and filters MIME", async () => {
  const store = new OwnerImageRecoveryStore();
  const record = store.create({
    attempt_id: ATTEMPT, chat_uuid: "private-chat", model_id: "banana-2.1", model_type: "banana-2.1",
    mime_types: ["image/jpeg"], message_id: "bot-message-1"
  });
  let getCalls = 0;
  let listCalls = 0;
  const client = {
    async getMessage(chatUuid: string, messageId: string) {
      getCalls += 1;
      assert.equal(chatUuid, "private-chat");
      assert.equal(messageId, "bot-message-1");
      return {
        chat_uuid: chatUuid, message_id: messageId, object_type: "image", model_type: "banana-2.1",
        artifacts: [
          { url: "https://r2.syntx.ai/generated/allowed.jpg", mime_type: "image/jpeg" },
          { url: "https://r2.syntx.ai/generated/not-allowed.png", mime_type: "image/png" }
        ]
      };
    },
    async listInProgress() { listCalls += 1; return []; }
  } as unknown as Pick<OwnerImageChatClient, "getMessage" | "listInProgress">;
  const artifacts = await reconcileOwnerImageRecovery(client, record);
  assert.deepEqual(artifacts, [{ url: "https://r2.syntx.ai/generated/allowed.jpg", mime_type: "image/jpeg" }]);
  assert.equal(getCalls, 1);
  assert.equal(listCalls, 0);
});

test("foreign model or message response never yields artifacts and retains recovery handle", async () => {
  const store = new OwnerImageRecoveryStore();
  const record = store.create({
    attempt_id: ATTEMPT, chat_uuid: "private-chat", model_id: "banana", model_type: "banana",
    mime_types: ["image/png"], message_id: "echo-message"
  });
  const client = {
    async getMessage(chatUuid: string, messageId: string) {
      return { chat_uuid: chatUuid, message_id: messageId, object_type: "image", model_type: "foreign-model", artifacts: [{ url: "https://r2.syntx.ai/fake.png", mime_type: "image/png" }] };
    },
    async listInProgress() { return []; }
  } as unknown as Pick<OwnerImageChatClient, "getMessage" | "listInProgress">;
  await assert.rejects(
    reconcileOwnerImageRecovery(client, record),
    (error: unknown) => error instanceof OwnerImageGenerationOutcomeUnknownError && error.recovery_id === record.recovery_id
  );
  assert.equal(store.get(record.recovery_id, ATTEMPT)?.chat_uuid, "private-chat");
});

test("reconcile preserves an exact auth-required failure rather than calling it a missing subscription", async () => {
  const record = new OwnerImageRecoveryStore().create({
    attempt_id: ATTEMPT, chat_uuid: "private-chat", model_id: "banana", model_type: "banana",
    mime_types: ["image/png"], message_id: "bot-message"
  });
  const client = {
    async getMessage() { throw new SyntxHttpError("AUTH_REQUIRED", "private auth diagnostic"); },
    async listInProgress() { return []; }
  } as unknown as Pick<OwnerImageChatClient, "getMessage" | "listInProgress">;
  await assert.rejects(
    reconcileOwnerImageRecovery(client, record),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "AUTH_REQUIRED"
  );
});

test("fabricated recovery metadata is rejected before any GET", async () => {
  let reads = 0;
  const client = {
    async getMessage() { reads += 1; return { chat_uuid: "foreign-chat", message_id: "message", object_type: "image", model_type: "banana", artifacts: [] }; },
    async listInProgress() { reads += 1; return []; }
  } as unknown as Pick<OwnerImageChatClient, "getMessage" | "listInProgress">;
  const forged = {
    recovery_id: "recovery_00000000-0000-4000-8000-000000000001",
    attempt_id: ATTEMPT, chat_uuid: "foreign-chat", model_id: "banana", model_type: "banana",
    mime_types: ["image/png"], message_id: null, created_at: "not-a-time"
  } as never;
  await assert.rejects(
    reconcileOwnerImageRecovery(client, forged),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "RECOVERY_NOT_FOUND"
  );
  assert.equal(reads, 0);
});

test("an already-aborted reconciliation signal does not construct a GET", async () => {
  const record = new OwnerImageRecoveryStore().create({
    attempt_id: ATTEMPT, chat_uuid: "private-chat", model_id: "banana", model_type: "banana",
    mime_types: ["image/png"], message_id: "message-1"
  });
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  const client = {
    async getMessage() { reads += 1; return { chat_uuid: "private-chat", message_id: "message-1", object_type: "image", model_type: "banana", artifacts: [] }; },
    async listInProgress() { reads += 1; return []; }
  } as unknown as Pick<OwnerImageChatClient, "getMessage" | "listInProgress">;
  await assert.rejects(
    reconcileOwnerImageRecovery(client, record, controller.signal),
    (error: unknown) => error instanceof OwnerImageGenerationOutcomeUnknownError && error.recovery_id === record.recovery_id
  );
  assert.equal(reads, 0);
});
